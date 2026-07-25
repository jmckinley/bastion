import fs from 'node:fs';
// Sovereign RAG service — in-boundary HTTP API (bind 127.0.0.1:8090).
// Reuses embed.mjs + agenticow + ingestlib + retrieval + rag. Connection records
// (incl. LucidLink tokens) live in root-readable-only connections.json; tokens
// are NEVER returned in responses (masked hint only).
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { AgenticMemory } from 'agenticow';
import { runIngest } from './ingestlib.mjs';
import { retrieve } from './retrieval.mjs';
import { answer } from './rag.mjs';

const HOST = '127.0.0.1', PORT = 8090;
const CONN_FILE = new URL('./connections.json', import.meta.url).pathname;

// ---- Bastion live data (read-only; markt owns these files) -----------------
const AUDIT_FILE = `${homedir()}/bastion-app/out/audit.jsonl`;
const ROUTER_FILE = `${homedir()}/bastion-app/config/router.config.json`;
const BASTION_MODELS_URL = 'http://localhost:3000/v1/models';
const SAVED_PER_INBOUNDARY_USD = 0.01; // nominal frontier-baseline saving per in-boundary request
// Registry overlay: the /v1/models endpoint has no host/boundary/capability.
const FLEET_REG = {
  'selfhosted/gpt-oss-120b': { host: 'ba71', boundary: 'customer', capability: 88, state: 'resident' },
  'selfhosted/qwen2.5-32b': { host: 'spark-47d8', boundary: 'customer', capability: 70, state: 'available' },
  'selfhosted/llama-3.1-70b': { host: 'spark-47d8', boundary: 'customer', capability: 75, state: 'available' },
  'local/qwen2.5-7b': { host: 'nutanix-ada', boundary: 'customer', capability: 55, state: 'available' },
  'local/llama-3.1-8b': { host: 'nutanix-ada', boundary: 'customer', capability: 45, state: 'available' },
  'local/phi-4-14b': { host: 'nutanix-ada', boundary: 'customer', capability: 60, state: 'available' },
  'cloud/claude-opus-4-8': { host: 'cloud/anthropic', boundary: 'third_party', capability: 96, state: 'cloud' },
};
function readAuditLines() {
  if (!existsSync(AUDIT_FILE)) return [];
  return readFileSync(AUDIT_FILE, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---- connections store -----------------------------------------------------
function loadConns() {
  if (!existsSync(CONN_FILE)) {
    const seed = [
      { id: 'my-cloud', workspace: 'my-cloud', daemon: 'http://localhost:8000',
        token: 'sa_live:REPLACE_ME',
        filespaces: [], status: 'active' },
      { id: 'media', workspace: 'media', daemon: 'http://localhost:8001',
        token: 'sa_live:REPLACE_ME',
        filespaces: [], status: 'active' },
    ];
    saveConns(seed);
    return seed;
  }
  return JSON.parse(readFileSync(CONN_FILE, 'utf-8'));
}
function saveConns(conns) {
  writeFileSync(CONN_FILE, JSON.stringify(conns, null, 2));
  try { chmodSync(CONN_FILE, 0o600); } catch {}
}
const maskToken = (t) => (t ? t.slice(0, 12) + '…' + t.slice(-4) : null);
const maskConn = (c) => ({ id: c.id, workspace: c.workspace, daemon: c.daemon, filespaces: c.filespaces, status: c.status, tokenHint: maskToken(c.token) });
const provId = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The LucidLink daemon occasionally drops a connection; retry with backoff.
async function daemonFetch(url, headers, { retries = 4, backoff = 2500 } = {}) {
  let last;
  for (let a = 0; a <= retries; a++) {
    try {
      const r = await fetch(url, { headers, keepalive: false });
      return r;
    } catch (e) { last = e; if (a < retries) await sleep(backoff); }
  }
  throw last;
}

async function daemonFilespaces(daemon, token) {
  const r = await daemonFetch(`${daemon}/filespaces`, { Authorization: `Bearer ${token}` });
  if (!r.ok) throw new Error(`daemon /filespaces -> ${r.status}`);
  const j = await r.json();
  return (j.filespaces || []).map((f) => f.name);
}

// ---- helpers ---------------------------------------------------------------
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ---- endpoints -------------------------------------------------------------
const routes = {
  'GET /health': async () => ({ code: 200, body: { status: 'ok', service: 'sovereign-rag', ts: new Date().toISOString() } }),

  'GET /connections': async () => ({ code: 200, body: { connections: loadConns().map(maskConn) } }),

  'POST /connections': async (req) => {
    const { workspace, token, daemon } = await readBody(req);
    if (!workspace || !token) return { code: 400, body: { error: 'workspace and token required' } };
    const conns = loadConns();
    let rec = conns.find((c) => c.workspace === workspace) || { id: workspace, workspace };
    rec.token = token;
    if (daemon) {
      rec.daemon = daemon;
      try { rec.filespaces = await daemonFilespaces(daemon, token); rec.status = 'active'; }
      catch (e) { return { code: 502, body: { error: `validation failed: ${e.message}` } }; }
    } else if (!rec.daemon) {
      // daemon-spawn hook not yet implemented — register as pending
      rec.status = 'pending';
      rec.daemon = null;
      rec.filespaces = rec.filespaces || [];
    }
    if (!conns.includes(rec)) conns.push(rec);
    saveConns(conns);
    return { code: 200, body: { connection: maskConn(rec), note: rec.status === 'pending' ? 'daemon-spawn not yet implemented (stub)' : undefined } };
  },

  'GET /browse': async (req, url) => {
    const conn = loadConns().find((c) => c.id === url.searchParams.get('conn'));
    if (!conn) return { code: 404, body: { error: 'unknown conn' } };
    const filespace = url.searchParams.get('filespace');
    const path = url.searchParams.get('path') || '/';
    const r = await daemonFetch(`${conn.daemon}/files?path=${encodeURIComponent(path)}`,
      { Authorization: `Bearer ${conn.token}`, 'X-LucidLink-Filespace': filespace });
    const body = await r.json().catch(() => ({ error: 'bad daemon response' }));
    return { code: r.status, body: { conn: conn.id, filespace, path, entries: body } };
  },

  'POST /ingest': async (req) => {
    const { conn, filespace, path = '/', sensitivity = 'internal', maxDepth = 0, maxFiles, maxVectors, storeBase } = await readBody(req);
    const c = loadConns().find((x) => x.id === conn);
    if (!c) return { code: 404, body: { error: 'unknown conn' } };
    if (!filespace) return { code: 400, body: { error: 'filespace required' } };
    const r = await runIngest({ base: c.daemon, token: c.token, filespace, storeBase, sensitivity, maxDepth,
      maxFiles: maxFiles ?? Infinity, maxVectors: maxVectors ?? Infinity, path, log: () => {} });
    return { code: 200, body: { store: r.store, files: r.files, chunks: r.counts.chunks, vectors: r.vectors, counts: r.counts, fileCapHit: r.fileCapHit, vectorCapHit: r.vectorCapHit } };
  },

  'GET /library': async (req, url) => {
    const store = url.searchParams.get('store');
    if (!store || !existsSync(`${store}.chunks.json`)) return { code: 404, body: { error: 'unknown store' } };
    const sidecar = JSON.parse(readFileSync(`${store}.chunks.json`, 'utf-8'));
    const bySrc = new Map();
    for (const meta of Object.values(sidecar)) {
      const k = meta.source;
      const e = bySrc.get(k) || { source: k, chunks: 0, sensitivity: meta.sensitivity, kind: meta.kind, provenanceId: provId(k) };
      e.chunks++; bySrc.set(k, e);
    }
    return { code: 200, body: { store, sources: [...bySrc.values()].sort((a, b) => b.chunks - a.chunks) } };
  },

  'POST /forget': async (req) => {
    const { store, source } = await readBody(req);
    if (!store || !source || !existsSync(`${store}.chunks.json`)) return { code: 404, body: { error: 'unknown store' } };
    const sidecar = JSON.parse(readFileSync(`${store}.chunks.json`, 'utf-8'));
    const ids = Object.entries(sidecar).filter(([, m]) => m.source === source).map(([id]) => +id);
    if (!ids.length) return { code: 404, body: { error: 'source not found in store' } };
    const mem = AgenticMemory.open(`${store}.rvf`, { dimension: 384, metric: 'cosine' });
    const del = mem.delete(ids);
    mem.close();
    for (const id of ids) delete sidecar[id];
    writeFileSync(`${store}.chunks.json`, JSON.stringify(sidecar));
    const receiptId = 'forget_' + createHash('sha1').update(store + source + Date.now()).digest('hex').slice(0, 16);
    return { code: 200, body: { store, source, purged: ids.length, rvf: del, receiptId } };
  },

  'POST /retrieval-test': async (req) => {
    const { store, q, k = 5 } = await readBody(req);
    if (!store || !q) return { code: 400, body: { error: 'store and q required' } };
    const hits = await retrieve(store, q, k);
    return { code: 200, body: { store, q, hits: hits.map((h) => ({ source: h.source, score: +h.score.toFixed(5), distance: h.distance, matchedField: h.matchedField, sensitivity: h.sensitivity, snippet: h.snippet })) } };
  },

  'POST /query': async (req) => {
    const { store, q, k = 5 } = await readBody(req);
    if (!store || !q) return { code: 400, body: { error: 'store and q required' } };
    const r = await answer(store, q, k);
    return { code: 200, body: { answer: r.answer, sources: r.sources, verdict: r.verdict, requestId: r.requestId } };
  },

  // ---- Bastion live-data surfaces (read-only) ------------------------------
  'GET /overview': async () => {
    const a = readAuditLines();
    const requests = a.length;
    const inBoundary = a.filter((e) => e.chosenBoundary === 'customer').length;
    const cloudSpendUsd = a.reduce((s, e) => s + (e.costUsd || 0), 0);
    const savedUsd = +(inBoundary * SAVED_PER_INBOUNDARY_USD).toFixed(4);
    // A leak = data that was actually SERVED to a boundary its sensitivity forbids.
    // Only regulated/restricted are hard-blocked to customer-boundary (confidential
    // MAY escalate to cloud de-identified; a 'blocked' outcome is the policy working,
    // not a leak — so both are excluded).
    const hardBlocked = new Set(['regulated', 'restricted']);
    const leaks = a.filter((e) => e.outcome === 'served' && hardBlocked.has(e.sensitivity) && e.chosenBoundary !== 'customer').length;
    const blocked = a.filter((e) => e.outcome === 'blocked').length;
    const lats = a.map((e) => e.latencyMs).filter((x) => typeof x === 'number').sort((x, y) => x - y);
    const kpis = {
      requests,
      inBoundaryPct: requests ? +(100 * inBoundary / requests).toFixed(1) : 0,
      cloudSpendUsd: +cloudSpendUsd.toFixed(5),
      savedUsd,
      leaks,
      blocked,
      ...(lats.length ? { medianLatencyMs: lats[Math.floor(lats.length / 2)] } : {}),
    };
    const recent = a.slice(-8).reverse().map((e) => ({ sensitivity: e.sensitivity, model: e.chosenModel, boundary: e.chosenBoundary, cost: e.costUsd, requestId: e.requestId, at: e.at }));
    const chained = a.length && a[a.length - 1].hash ? 'signed' : 'unsigned';
    return { code: 200, body: { kpis, recent, integrity: { auditChain: chained, entries: requests } } };
  },

  'GET /fleet': async () => {
    let models = [];
    try { const r = await daemonFetch(BASTION_MODELS_URL, {}); const j = await r.json(); models = j.data || []; }
    catch (e) { return { code: 502, body: { error: `bastion /v1/models: ${e.message}` } }; }
    const fleet = models.map((m) => {
      const reg = FLEET_REG[m.id] || {};
      const locality = m.id.split('/')[0];
      return {
        id: m.id,
        model: m.id.split('/').pop(),
        host: reg.host || m.owned_by || locality,
        boundary: reg.boundary || (locality === 'cloud' ? 'third_party' : 'customer'),
        capability: reg.capability ?? null,
        state: reg.state || 'available',
      };
    });
    return { code: 200, body: fleet };
  },

  'GET /policy': async () => {
    if (!existsSync(ROUTER_FILE)) return { code: 404, body: { error: 'router.config.json not found' } };
    const cfg = JSON.parse(readFileSync(ROUTER_FILE, 'utf-8'));
    const rules = cfg.policy?.rules || [];
    return { code: 200, body: {
      name: cfg.policy?.name,
      routingStrategy: cfg.routingStrategy,
      minCompetency: cfg.minCompetency,
      confidenceThreshold: cfg.confidenceThreshold,
      deidentifyByDefault: cfg.deidentifyByDefault ?? rules.some((r) => /deidentif/i.test(r.id + (r.description || ''))),
      tiers: rules.map((r) => ({
        id: r.id,
        sensitivity: r.whenSensitivityAtLeast,
        allowLocalities: r.allowLocalities,
        allowBoundaries: r.allowBoundaries,
        cloudEscalation: r.allowCloudEscalation,
        ...(r.whenWorkloadIn ? { workloads: r.whenWorkloadIn } : {}),
        ...(r.denyProviders ? { denyProviders: r.denyProviders } : {}),
      })),
    } };
  },

  'GET /audit': async (req, url) => {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 500);
    const a = readAuditLines().slice(-limit).reverse();
    return { code: 200, body: { count: a.length, entries: a.map((e) => ({
      ts: e.at, seq: e.seq, sensitivity: e.sensitivity, model: e.chosenModel,
      boundary: e.chosenBoundary, cost: e.costUsd, outcome: e.outcome, hash: e.hash,
    })) } };
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const key = `${req.method} ${url.pathname}`;
    if (req.method==='GET' && (url.pathname==='/'||url.pathname==='/console.html')) { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(fs.readFileSync(new URL('./console.html', import.meta.url).pathname)); }
    const handler = routes[key];
    if (!handler) return send(res, 404, { error: `no route ${key}` });
    const { code, body } = await handler(req, url);
    send(res, code, body);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});
loadConns(); // ensure seed + chmod
server.listen(PORT, HOST, () => console.log(`sovereign-rag listening on http://${HOST}:${PORT}`));
