// Local ONNX MiniLM embedder (all-MiniLM-L6-v2, 384-dim, pure WASM).
// Wraps ruvector/dist/core/onnx-embedder.js. In-boundary; model downloaded
// once from HuggingFace then cached locally, no per-call egress.
import mod from 'ruvector/dist/core/onnx-embedder.js';

const {
  initOnnxEmbedder,
  embedBatch,
  embedQuery: _embedQuery,
  cosineSimilarity,
  getDimension,
} = mod;

let _inited = false;
async function ensure() {
  if (!_inited) {
    await initOnnxEmbedder();
    _inited = true;
  }
}

/** Embed passages/documents. Returns Float32Array[] (384-dim), input order. */
export async function embed(texts) {
  await ensure();
  const arr = Array.isArray(texts) ? texts : [texts];
  const results = await embedBatch(arr); // EmbeddingResult[]
  return results.map((r) => Float32Array.from(r.embedding));
}

/** Embed a single search query (query prefix per ADR-210 D4). Float32Array 384. */
export async function embedQuery(text) {
  await ensure();
  const r = await _embedQuery(text);
  return Float32Array.from(r.embedding);
}

export { cosineSimilarity, getDimension };

// Self-test: run `node embed.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = 'The cat sat quietly on the warm windowsill.';
  const b = 'A feline rested calmly by the sunny window.';
  const c = 'Quarterly revenue increased by twelve percent.';
  const [va, vb, vc] = await embed([a, b, c]);
  console.log('dimension:', va.length, '(getDimension=' + getDimension() + ')');
  const cos = (x, y) => cosineSimilarity(Array.from(x), Array.from(y));
  console.log('cosine(similar a,b):', cos(va, vb).toFixed(4));
  console.log('cosine(unrelated a,c):', cos(va, vc).toFixed(4));
  console.log('EMBED_OK');
}
