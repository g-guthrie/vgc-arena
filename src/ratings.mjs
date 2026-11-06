#!/usr/bin/env node
// Print the leaderboard from the stats database.
//   node src/ratings.mjs [--by pilot|builder] [--group model|effort|path] [--unlisted] [--db path]
import {StatsDB} from './db.mjs';
import {Stats} from './stats.mjs';

const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const db = new StatsDB(opt('--db'));
const stats = new Stats(db);
const lb = stats.leaderboard({by: opt('--by') || 'pilot', group: opt('--group') || 'model', includeUnlisted: args.includes('--unlisted')});
const s = stats.summary();
console.log(`${s.matches} rated matches · ${s.games} games · ${s.turns} turns · ${s.models} listed models\n`);
console.log('rating  90% CI       W-L-T     pred.acc  brier  think  model');
for (const r of lb.rows) {
  const ci = r.lo == null ? '—' : `${r.lo.toFixed(0)}–${r.hi.toFixed(0)}`;
  const acc = r.predictionAccuracy == null ? '—' : `${(r.predictionAccuracy * 100).toFixed(0)}%`;
  console.log(`${r.rating.toFixed(0).padStart(6)}  ${ci.padEnd(11)}  ${`${r.w}-${r.l}-${r.t}`.padEnd(8)}  ${acc.padEnd(8)}  ${r.brier == null ? '—    ' : r.brier.toFixed(3)}  ${r.medianThinkMs ? `${Math.round(r.medianThinkMs / 1000)}s`.padEnd(5) : '—    '}  ${r.name}${r.split && r.split !== 'default' ? ` (${r.split})` : ''}`);
}
