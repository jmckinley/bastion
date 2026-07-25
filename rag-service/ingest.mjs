// CLI wrapper around ingestlib.runIngest.
//   LL_BASE=http://localhost:8001 LL_TOKEN=<sa> SENSITIVITY=regulated MAX_DEPTH=0 \
//     node ingest.mjs <filespace>
import { runIngest } from './ingestlib.mjs';

const base = process.env.LL_BASE || 'http://localhost:8000';
const token = process.env.LL_TOKEN ||
  'sa_live:REPLACE_ME';
const filespace = process.argv[2] || 'agenticow';
const storeBase = process.env.STORE_BASE || filespace;  // stage into a side store for zero-downtime swap
const sensitivity = process.env.SENSITIVITY || 'internal';
const maxDepth = parseInt(process.env.MAX_DEPTH ?? '0', 10);
const maxFiles = process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : Infinity;
const maxVectors = process.env.MAX_VECTORS ? parseInt(process.env.MAX_VECTORS, 10) : Infinity;

const r = await runIngest({ base, token, filespace, storeBase, sensitivity, maxDepth, maxFiles, maxVectors, log: (s) => console.log(s) });
console.log('---');
console.log(`pptx-text: ${r.counts.pptxText}  text-docs: ${r.counts.textDocs}  catalog-only: ${r.counts.catalogOnly}  skipped: ${r.counts.skipped}`);
console.log(`chunks/vectors: ${r.counts.chunks}  (RVF totalVectors=${r.status.totalVectors})`);
console.log(`store: ${r.store}  sidecar: ${r.sidecarFile}`);
console.log('INGEST_OK');
