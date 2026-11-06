// Fills a SEPARATE demo database with bot-driven matches under made-up model
// labels, for developing the website. Never point this at real data.
//   VGC_ARTIFACTS=artifacts/demo node scripts/demo-data.mjs 60
import {Arena} from '../src/arena.mjs';
import {attachBot} from '../src/bots.mjs';
if (!process.env.VGC_ARTIFACTS?.includes('demo')) { console.error('Set VGC_ARTIFACTS to a *demo* directory.'); process.exit(1); }
const arena = new Arena();
const pool = [['claude-opus-5-5', 'greedy', 'high'], ['gpt-6-astra', 'greedy', 'high'], ['claude-sonnet-5-5', 'greedy', 'medium'], ['deepseek-v4', 'random', null], ['kimi-k2-6', 'random', null], ['gpt-5-6-luna', 'greedy', 'low']];
const n = Number(process.argv[2] || 40);
for (let i = 0; i < n; i++) {
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = pool[Math.floor(Math.random() * pool.length)];
  while (b === a) b = pool[Math.floor(Math.random() * pool.length)];
  const m = arena.createMatch({label: 'DEMO DATA', reserved: true});
  for (const [model, kind, effort] of [a, b]) {
    const {token} = arena.join({model, effort, name: model, owner: 'demo', harness: 'demo', match_id: m.id}, {client: {name: 'demo'}});
    attachBot(m, token, kind);
  }
  await new Promise(r => m.once('finished', r));
}
console.log(`${n} demo matches written to ${arena.artifactsDir}`);
