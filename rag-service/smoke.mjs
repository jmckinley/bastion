// RVF RAG smoke test — proves ingest + query + text-payload in-boundary.
// Uses agenticow's AgenticMemory (which wraps @ruvector/rvf-node RvfDatabase).
import { AgenticMemory } from 'agenticow';
import { existsSync, rmSync } from 'node:fs';

const PATH = './mem.rvf';
if (existsSync(PATH)) rmSync(PATH, { force: true });

const mem = AgenticMemory.open(PATH, { dimension: 8, metric: 'cosine' });

// 3 hand-made 8-dim vectors, each carrying a text payload.
const records = [
  { id: 1, vector: [1, 0, 0, 0, 0, 0, 0, 0], text: 'the invoice total was $4,200' },
  { id: 2, vector: [0, 1, 0, 0, 0, 0, 0, 0], text: 'patient blood pressure was 130/85' },
  { id: 3, vector: [0, 0, 1, 0, 0, 0, 0, 0], text: 'quarterly revenue rose 12%' },
];

const ing = mem.ingest(records);
console.log('ingest result:', JSON.stringify(ing));

// Query with a vector close to record #1 (the invoice).
const q = [0.9, 0.1, 0, 0, 0, 0, 0, 0];
const hits = mem.query(q, 3);
console.log('query top hits:');
for (const h of hits) {
  console.log(`  id=${h.id}  distance=${h.distance.toFixed(4)}  text=${JSON.stringify(h.text)}`);
}

console.log('status:', JSON.stringify(mem.status()));
mem.close();
console.log('SMOKE_OK');
