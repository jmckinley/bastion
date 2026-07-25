// Hybrid retrieval + rerank for the sovereign RAG store.
// Recipe (grounded in ruflo ADR-078/079/080): dense (MiniLM cosine over RVF) +
// multi-field BM25 (chunk text + filename, filename up-weighted) fused with
// Reciprocal Rank Fusion, then MMR-style near-duplicate dedup + a dense-distance
// threshold. No cross-encoder (30MB model download); this is the deterministic,
// dependency-free tier the ADR calls the right default for hot paths.
import { AgenticMemory } from 'agenticow';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { embedQuery } from './embed.mjs';

const STOP = new Set(('a an the of to in on for and or but with without into from by at as is are was were be been ' +
  'being this that these those it its their our your his her they we you i do does did what which who whom whose ' +
  'about over under above below then than so such not no yes can will would should could may might must have has had').split(/\s+/));

export function tokenize(s) {
  return (s || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 2 && !STOP.has(t)) || [];
}

const K1 = 1.2, B = 0.75, RRF_K = 60, PHRASE_WEIGHT = 3.0;

const bigrams = (toks) => { const b = []; for (let i = 0; i < toks.length - 1; i++) b.push(toks[i] + ' ' + toks[i + 1]); return b; };

// Build a tiny in-memory BM25 index over the sidecar chunks. Multi-field:
// filename tokens are appended twice so filename/topic queries land on the right
// document. Also indexes bigrams for phrase matching (e.g. "first mile" is a
// discriminative bigram that a unigram BM25 spreads across common terms).
// Fine to rebuild per call at this corpus size (hundreds–low thousands).
function buildBm25(sidecar) {
  const docs = [];
  for (const [id, meta] of Object.entries(sidecar)) {
    const textToks = tokenize(meta.text);
    const fnameTokens = tokenize(basename(meta.source || ''));
    const toks = textToks.concat(fnameTokens, fnameTokens); // filename x2 weight
    docs.push({ id: +id, toks, len: toks.length, biSet: new Set(bigrams(textToks)) });
  }
  const df = new Map(), dfBi = new Map();
  for (const d of docs) {
    for (const t of new Set(d.toks)) df.set(t, (df.get(t) || 0) + 1);
    for (const bg of d.biSet) dfBi.set(bg, (dfBi.get(bg) || 0) + 1);
  }
  const N = docs.length || 1;
  const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  const idfBi = (bg) => Math.log(1 + (N - (dfBi.get(bg) || 0) + 0.5) / ((dfBi.get(bg) || 0) + 0.5));
  return { docs, idf, idfBi, avgdl };
}

function bm25Scores(query, bm25) {
  const qt = tokenize(query);
  const qBi = bigrams(qt);
  const scores = new Map();
  for (const d of bm25.docs) {
    const tf = new Map();
    for (const t of d.toks) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of qt) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      s += bm25.idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / bm25.avgdl));
    }
    // phrase boost: query bigrams that appear in this doc (rare bigrams dominate)
    for (const bg of qBi) if (d.biSet.has(bg)) s += PHRASE_WEIGHT * bm25.idfBi(bg);
    if (s > 0) scores.set(d.id, s);
  }
  return scores;
}

function rankMap(idsSortedBest) {
  const m = new Map();
  idsSortedBest.forEach((id, i) => m.set(id, i)); // 0-based rank
  return m;
}

// Jaccard over token sets — used for MMR-style near-duplicate suppression.
function jaccard(aToks, bToks) {
  const A = new Set(aToks), B2 = new Set(bToks);
  let inter = 0;
  for (const t of A) if (B2.has(t)) inter++;
  const uni = A.size + B2.size - inter;
  return uni ? inter / uni : 0;
}

/**
 * Hybrid retrieve. Returns [{id, source, sensitivity, distance, score, snippet, text, matchedField}].
 * opts: {k0=20 candidate pool, threshold=1.55 dense-distance cap, dedup=0.82}
 */
export async function retrieve(storeBase, q, k = 5, opts = {}) {
  const { k0 = 20, threshold = 1.55, dedup = 0.82 } = opts;
  const sidecar = JSON.parse(readFileSync(`${storeBase}.chunks.json`, 'utf-8'));

  // dense
  const qvec = await embedQuery(q);
  const mem = AgenticMemory.open(`${storeBase}.rvf`, { dimension: 384, metric: 'cosine' });
  const denseHits = mem.query(Array.from(qvec), k0);
  mem.close();
  const distById = new Map(denseHits.map((h) => [h.id, h.distance]));
  const denseRank = rankMap([...denseHits].sort((a, b) => a.distance - b.distance).map((h) => h.id));

  // lexical (BM25 over whole corpus)
  const bm25 = buildBm25(sidecar);
  const lex = bm25Scores(q, bm25);
  const lexRank = rankMap([...lex.entries()].sort((a, b) => b[1] - a[1]).slice(0, k0).map(([id]) => id));

  // query terms/phrases for the direct boosts below
  const qtoks = tokenize(q);
  const qset = new Set(qtoks);
  const qBi = [];
  for (let i = 0; i < qtoks.length - 1; i++) qBi.push(qtoks[i] + ' ' + qtoks[i + 1]);

  // fuse (RRF) over the union of both candidate lists, then add direct
  // phrase-match + filename-match boosts. RRF alone structurally favours docs
  // present in BOTH lists; an exact phrase match (e.g. "first mile") is a far
  // stronger relevance signal and must be able to win from a single list.
  const pool = new Set([...denseRank.keys()].filter((id) => denseRank.get(id) < k0));
  for (const id of lexRank.keys()) pool.add(id);
  const scored = [];
  for (const id of pool) {
    const dr = denseRank.has(id) ? denseRank.get(id) : Infinity;
    const lr = lexRank.has(id) ? lexRank.get(id) : Infinity;
    const rrf = (dr < Infinity ? 1 / (RRF_K + dr) : 0) + (lr < Infinity ? 1 / (RRF_K + lr) : 0);
    const meta = sidecar[id] || {};
    const ctoks = tokenize(meta.text);
    const cbi = new Set();
    for (let i = 0; i < ctoks.length - 1; i++) cbi.add(ctoks[i] + ' ' + ctoks[i + 1]);
    let phraseBonus = 0;
    for (const bg of qBi) if (cbi.has(bg)) phraseBonus += 0.02 * bm25.idfBi(bg); // rare phrases dominate
    let fnameHit = 0;
    for (const t of tokenize(basename(meta.source || ''))) if (qset.has(t)) fnameHit++;
    const fnameBonus = 0.02 * fnameHit;
    // Catalog chunks are filename-only metadata (no slide/document text), so a
    // filename phrase-match can score deceptively high. Demote them below real
    // content: a metadata entry must never outrank a text chunk that can actually
    // ground an answer. Catalog still surfaces when it's the only match.
    const CATALOG_DEMOTE = 0.35;
    const rawScore = rrf + phraseBonus + fnameBonus;
    scored.push({
      id, source: meta.source, sensitivity: meta.sensitivity, kind: meta.kind,
      distance: distById.has(id) ? distById.get(id) : null,
      score: meta.kind === 'catalog' ? rawScore * CATALOG_DEMOTE : rawScore,
      rrf, phraseBonus: +phraseBonus.toFixed(4),
      matchedField: phraseBonus > 0 ? 'phrase' : (lexRank.has(id) && denseRank.has(id) ? 'hybrid' : lexRank.has(id) ? 'lexical' : 'dense'),
      text: meta.text || '',
    });
  }
  scored.sort((a, b) => b.score - a.score);

  // dense-distance threshold: drop far dense-only hits, but keep strong lexical hits
  let filtered = scored.filter((c) => c.distance == null || c.distance <= threshold || c.matchedField !== 'dense');
  if (!filtered.length) filtered = scored;

  // MMR-style greedy select with near-duplicate suppression
  const out = [];
  for (const c of filtered) {
    const ct = tokenize(c.text);
    if (out.some((o) => jaccard(ct, tokenize(o.text)) > dedup)) continue;
    out.push({ ...c, snippet: c.text.slice(0, 240).replace(/\s+/g, ' ').trim() });
    if (out.length >= k) break;
  }
  return out;
}
