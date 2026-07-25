// CLI: hybrid-retrieve -> augment -> Bastion. Prints answer, sources, verdict.
//   RAG_STORE=archive node ask.mjs "<question>"
import { answer } from './rag.mjs';

const STORE = process.env.RAG_STORE || 'kb';
const question = process.argv.slice(2).join(' ').trim();
if (!question) { console.error('usage: RAG_STORE=<base> node ask.mjs "<question>"'); process.exit(1); }

const r = await answer(STORE, question, 5);
console.log('=== QUESTION ===\n' + question);
console.log('\n=== RETRIEVED (reranked top-5) ===');
r.sources.forEach((s, i) => console.log(`  [${i + 1}] ${s.matchedField} score=${s.score} dist=${s.distance == null ? 'n/a' : s.distance.toFixed(4)} ${s.path}`));
console.log('\n=== ANSWER (via Bastion -> sovereign model) ===\n' + r.answer);
console.log('\n=== BASTION VERDICT ===');
console.log('  ' + JSON.stringify(r.verdict) + `  requestId=${r.requestId}`);
