// Query = hybrid retrieve -> grounded augmented prompt -> Bastion governed
// gateway (/v1) -> sovereign model. Returns answer + sources + governance verdict.
import { retrieve } from './retrieval.mjs';

const BASTION = process.env.BASTION_URL || 'http://localhost:3000/v1/chat/completions';

export function buildPrompt(question, hits) {
  const ctx = hits.map((h, i) => `[${i + 1}] source: ${h.source}\n${h.text}`).join('\n\n');
  return `You are a retrieval-augmented assistant. Answer the question using ONLY the context below.
Cite the source path in brackets for each claim. If the answer is not in the context, say "Not found in the provided documents."

CONTEXT:
${ctx}

QUESTION: ${question}`;
}

export async function askBastion(prompt, { timeoutMs = 180000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(BASTION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: prompt }] }),
      signal: ac.signal,
    });
    const raw = await res.text();
    let answer = raw;
    try { const j = JSON.parse(raw); answer = j.choices?.[0]?.message?.content ?? JSON.stringify(j); } catch {}
    const h = res.headers;
    return {
      answer,
      status: res.status,
      requestId: h.get('x-bastion-request-id'),
      verdict: {
        sensitivity: h.get('x-bastion-sensitivity'),
        outcome: h.get('x-bastion-outcome'),
        model: h.get('x-bastion-model'),
        boundary: h.get('x-bastion-boundary'),
        cost: h.get('x-bastion-cost-usd'),
        deidentified: h.get('x-bastion-deidentified'),
      },
    };
  } finally { clearTimeout(t); }
}

export async function answer(storeBase, question, k = 5, opts = {}) {
  const hits = await retrieve(storeBase, question, k, opts);
  const prompt = buildPrompt(question, hits);
  const b = await askBastion(prompt);
  return {
    answer: b.answer,
    sources: hits.map((h) => ({ path: h.source, snippet: h.snippet, distance: h.distance, score: +h.score.toFixed(5), matchedField: h.matchedField, sensitivity: h.sensitivity })),
    verdict: b.verdict,
    requestId: b.requestId,
    hits,
  };
}
