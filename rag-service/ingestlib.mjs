// Zero-egress ingest as a callable function. Streams a LucidLink filespace via
// an in-boundary fileservice, extracts text (utf-8 docs + per-slide pptx text),
// catalogs binary media, embeds locally (MiniLM 384-dim), ingests into a
// per-filespace RVF store, and writes a citation sidecar tagged with sensitivity.
// Retrieval-tuning fixes baked in: (1) every chunk's EMBEDDED text is prefixed
// with "[<deck/filename>] " so topic/filename queries land on the right doc;
// (2) pptx is chunked PER SLIDE (not a blind window across concatenated slides).
import { AgenticMemory } from 'agenticow';
import AdmZip from 'adm-zip';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { embed } from './embed.mjs';

const TEXT_EXT = /\.(md|markdown|txt|text|json|csv|tsv|srt|vtt|xml|edl|log|ya?ml|html?|rtf)$/i;
// Only OOXML (zip-based) PowerPoint formats yield extractable slide text via adm-zip.
// Legacy binary .ppt is NOT a zip — matching it here would stream the whole file over
// LucidLink only to fail adm-zip and fall back to catalog. Excluding it lets .ppt take
// the catalog-by-metadata path (no wasteful read).
const PPTX_EXT = /\.(pptx|pptm|ppsx|potx)$/i;
// Pure image/audio/video: filename-only cataloging is retrieval noise and eats the
// vector budget. Skipped in this document-focused ingest; making media searchable is a
// separate capability (local vision captioning + Whisper transcription).
const MEDIA_EXT = /\.(jpe?g|png|gif|tiff?|bmp|heic|webp|mp4|mov|m4v|avi|mkv|lrv|thm|m4a|mp3|wav|aac|flac)$/i;
const MAX_READ = 20 * 1024 * 1024;
const CHUNK = 800, OVERLAP = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFetchJson(base, headers) {
  return async function fetchJson(path, { retries = 6, backoff = 3000, timeoutMs = 120000 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const r = await fetch(base + path, { headers, keepalive: false, signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
        return await r.json();
      } catch (e) {
        lastErr = e;
        if (attempt < retries) { process.stderr.write(`  retry ${attempt + 1}/${retries} (${e.message})\n`); await sleep(backoff); }
      } finally { clearTimeout(t); }
    }
    throw lastErr;
  };
}

function windowChunks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + CHUNK));
    if (i + CHUNK >= text.length) break;
    i += CHUNK - OVERLAP;
  }
  return out;
}

// pptx -> array of per-slide text strings (slide order).
function pptxToSlides(buf) {
  const zip = new AdmZip(buf);
  const slides = zip.getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => (+a.entryName.match(/slide(\d+)/)[1]) - (+b.entryName.match(/slide(\d+)/)[1]));
  return slides.map((s) => {
    const xml = s.getData().toString('utf-8');
    return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
      .join(' ').trim();
  }).filter(Boolean);
}

const catalogText = (e) => `FILE: ${e.path} | name: ${e.name} | ext: ${(e.name.match(/\.[^.]+$/) || [''])[0]} | size: ${e.size} bytes`;

/**
 * @param {object} o
 * @param {string} o.base   fileservice base URL (e.g. http://localhost:8001)
 * @param {string} o.token  LucidLink SA token
 * @param {string} o.filespace
 * @param {string} [o.storeBase]  defaults to filespace
 * @param {string} [o.sensitivity]  tag stored on every chunk (default 'internal')
 * @param {number} [o.maxDepth]  dir recursion depth (default 0 = root only)
 * @param {number} [o.maxFiles]  cap on discovered files (default Infinity)
 * @param {number} [o.maxVectors]  cap on ingested chunks/vectors (default Infinity)
 * @param {string} [o.path]  starting dir (default '/')
 * @param {(s:string)=>void} [o.log]
 */
export async function runIngest({ base, token, filespace, storeBase, sensitivity = 'internal', maxDepth = 0, maxFiles = Infinity, maxVectors = Infinity, path = '/', log = () => {} }) {
  const store = `${storeBase || filespace}.rvf`;
  const sidecarFile = `${storeBase || filespace}.chunks.json`;
  const headers = { Authorization: `Bearer ${token}`, 'X-LucidLink-Filespace': filespace };
  const fetchJson = makeFetchJson(base, headers);
  const listDir = (p) => fetchJson(`/files?path=${encodeURIComponent(p)}`);
  const readRaw = (p) => fetchJson(`/files/read?path=${encodeURIComponent(p)}`);

  // Breadth-first: emit files at each level BEFORE descending, so the shallow
  // (most important) files — e.g. root decks — are captured before a maxFiles
  // cap is hit deep in a large subtree like Photos/.
  let capped = false;
  async function walk(dir, out = [], depth = 0) {
    const entries = await listDir(dir);
    const dirs = [];
    for (const e of entries) {
      if (out.length >= maxFiles) { capped = true; return out; }
      if (e.is_dir) dirs.push(e); else out.push(e);
    }
    if (depth < maxDepth) for (const d of dirs) { if (out.length >= maxFiles) { capped = true; break; } await walk(d.path, out, depth + 1); }
    return out;
  }

  if (existsSync(store)) rmSync(store, { force: true });
  log(`Filespace '${filespace}' via ${base} -> ${store} (sensitivity=${sensitivity}, maxDepth=${maxDepth}, maxFiles=${maxFiles}, maxVectors=${maxVectors})`);
  const files = await walk(path);
  log(`Discovered ${files.length} entries${capped ? ' (FILE CAP HIT)' : ''}.`);

  const mem = AgenticMemory.open(store, { dimension: 384, metric: 'cosine' });
  const sidecar = {};
  let id = 0;
  const counts = { pptxText: 0, textDocs: 0, catalogOnly: 0, skipped: 0, chunks: 0 };

  // Embed a batch of {clean, embedText} chunks for a source and ingest them.
  async function ingestChunks(source, kind, chunks) {
    if (!chunks.length) return;
    const vecs = await embed(chunks.map((c) => c.embedText));
    const records = chunks.map((c, k) => {
      const rid = id++;
      sidecar[rid] = { source, kind, sensitivity, text: c.clean };
      return { id: rid, vector: Array.from(vecs[k]), text: c.clean };
    });
    mem.ingest(records);
    counts.chunks += chunks.length;
  }

  let vectorCapHit = false;
  for (const e of files) {
    if (counts.chunks >= maxVectors) { vectorCapHit = true; break; }
    const name = e.name;
    if (name === '.DS_Store' || name.startsWith('~$') || e.size === 0) { counts.skipped++; continue; }
    if (MEDIA_EXT.test(name)) { counts.skipped++; continue; }
    const deck = basename(name).replace(/\.[^.]+$/, '');
    const prefix = `[${deck}] `;
    try {
      if (PPTX_EXT.test(name) && e.size < MAX_READ) {
        const raw = await readRaw(e.path);
        const buf = Buffer.from(raw.content, raw.encoding === 'base64' ? 'base64' : 'utf-8');
        let slides = [];
        try { slides = pptxToSlides(buf); } catch (err) { process.stderr.write(`  pptx parse fail ${e.path}: ${err.message}\n`); }
        if (slides.length) {
          const chunks = [];
          slides.forEach((sl, si) => {
            // per-slide; if a slide is very long, window it but keep the deck prefix
            const parts = sl.length > CHUNK * 1.5 ? windowChunks(sl) : [sl];
            for (const p of parts) chunks.push({ clean: `(slide ${si + 1}) ${p}`, embedText: `${prefix}(slide ${si + 1}) ${p}` });
          });
          await ingestChunks(e.path, 'pptx', chunks);
          counts.pptxText++;
          log(`  [pptx] ${e.path}: ${slides.length} slides -> ${chunks.length} chunks`);
        } else {
          await ingestChunks(e.path, 'catalog', [{ clean: catalogText(e), embedText: prefix + catalogText(e) }]);
          counts.catalogOnly++;
        }
      } else if (TEXT_EXT.test(name) && e.size < MAX_READ) {
        const raw = await readRaw(e.path);
        const content = raw.encoding === 'utf-8' ? raw.content : null;
        if (content && content.trim()) {
          const chunks = windowChunks(content).map((c) => ({ clean: c, embedText: prefix + c }));
          await ingestChunks(e.path, 'text', chunks);
          counts.textDocs++;
          log(`  [text] ${e.path}: ${chunks.length} chunks`);
        } else {
          await ingestChunks(e.path, 'catalog', [{ clean: catalogText(e), embedText: prefix + catalogText(e) }]);
          counts.catalogOnly++;
        }
      } else {
        await ingestChunks(e.path, 'catalog', [{ clean: catalogText(e), embedText: prefix + catalogText(e) }]);
        counts.catalogOnly++;
      }
    } catch (err) {
      process.stderr.write(`  ERROR ${e.path}: ${err.message} -> catalog fallback\n`);
      try { await ingestChunks(e.path, 'catalog', [{ clean: catalogText(e), embedText: prefix + catalogText(e) }]); counts.catalogOnly++; }
      catch { counts.skipped++; }
    }
  }

  if (vectorCapHit) log(`  VECTOR CAP HIT at ${counts.chunks} (maxVectors=${maxVectors}); remaining files catalogued/skipped.`);
  writeFileSync(sidecarFile, JSON.stringify(sidecar));
  const status = mem.status();
  mem.close();
  return { store, sidecarFile, counts, status, files: files.length, vectors: status.totalVectors, fileCapHit: capped, vectorCapHit };
}
