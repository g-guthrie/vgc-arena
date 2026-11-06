#!/usr/bin/env node
// Bradley-Terry ratings (Elo scale) from artifacts/results.jsonl, with
// bootstrap 95% intervals. Results are grouped by harness version + Showdown
// commit, because changing either changes the benchmark.
//   node src/ratings.mjs [results.jsonl] [--unit game|match] [--by pilot|builder]
import fs from 'node:fs';
import path from 'node:path';
import {ROOT_DIR} from './showdown.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--')) || path.join(process.env.VGC_ARTIFACTS || path.join(ROOT_DIR, 'artifacts'), 'results.jsonl');
const unit = args.includes('--unit') ? args[args.indexOf('--unit') + 1] : 'game';
const by = args.includes('--by') ? args[args.indexOf('--by') + 1] : 'pilot';

function fit(pairs, players, iters = 300) {
  // MM algorithm; ties count as half a win each. A weak prior (one virtual
  // draw against a mean-rated anchor) keeps undefeated players finite.
  const r = Object.fromEntries(players.map(p => [p, 1]));
  for (let it = 0; it < iters; it++) {
    for (const p of players) {
      let wins = 0.5, denom = 1 / (r[p] + 1);
      for (const [a, b, s] of pairs) {
        if (a === p) { wins += s; denom += 1 / (r[a] + r[b]); }
        else if (b === p) { wins += 1 - s; denom += 1 / (r[a] + r[b]); }
      }
      r[p] = wins / denom;
    }
    const g = Math.exp(players.reduce((acc, p) => acc + Math.log(r[p]), 0) / players.length);
    for (const p of players) r[p] /= g;
  }
  return Object.fromEntries(players.map(p => [p, 1500 + 400 * Math.log10(r[p])]));
}

if (!fs.existsSync(file)) { console.log(`No results yet at ${file}.`); process.exit(0); }
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const groups = new Map();
for (const row of rows) {
  const key = `${row.harnessVersion} · ${row.format} · showdown ${String(row.showdownCommit).slice(0, 10)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

for (const [key, list] of groups) {
  const who = (row, s) => (by === 'builder' ? row[s].builder : row[s].model);
  const pairs = [];
  for (const row of list) {
    const a = who(row, 'p1'), b = who(row, 'p2');
    if (a === b) continue; // mirror matches carry no rating information
    if (unit === 'match') pairs.push([a, b, row.winner === 'p1' ? 1 : row.winner === 'p2' ? 0 : 0.5]);
    else for (const g of row.games) pairs.push([a, b, g.winner === 'p1' ? 1 : g.winner === 'p2' ? 0 : 0.5]);
  }
  const players = [...new Set(pairs.flatMap(([a, b]) => [a, b]))];
  if (players.length < 2) continue;
  const point = fit(pairs, players);
  const boots = Object.fromEntries(players.map(p => [p, []]));
  for (let i = 0; i < 200; i++) {
    const sample = pairs.map(() => pairs[Math.floor(Math.random() * pairs.length)]);
    const sp = [...new Set(sample.flatMap(([a, b]) => [a, b]))];
    if (sp.length < 2) continue;
    const rr = fit(sample, sp, 120);
    for (const p of sp) boots[p].push(rr[p]);
  }
  const stats = {};
  for (const row of list) for (const s of ['p1', 'p2']) {
    const m = who(row, s);
    stats[m] ||= {preds: 0, correct: 0, brier: 0, brierN: 0, think: []};
    const p = row[s];
    if (p.predictions) { stats[m].preds += p.predictions; stats[m].correct += (p.predictionAccuracy || 0) * p.predictions; }
    if (p.brier !== null && p.brier !== undefined) { stats[m].brier += p.brier * p.predictions; stats[m].brierN += p.predictions; }
    if (p.medianThinkMs) stats[m].think.push(p.medianThinkMs);
  }
  const record = Object.fromEntries(players.map(p => [p, {w: 0, l: 0, t: 0}]));
  for (const [a, b, s] of pairs) {
    if (s === 1) { record[a].w++; record[b].l++; } else if (s === 0) { record[b].w++; record[a].l++; } else { record[a].t++; record[b].t++; }
  }
  console.log(`\n${key}\nBradley–Terry by ${by}, per ${unit} (${pairs.length} ${unit}s, ${list.length} matches)\n`);
  console.log('rating   95% CI        W-L-T      pred.acc  brier  median think  model');
  for (const p of players.sort((a, b) => point[b] - point[a])) {
    const bs = boots[p].sort((x, y) => x - y);
    const lo = bs[Math.floor(bs.length * 0.025)] ?? NaN, hi = bs[Math.floor(bs.length * 0.975)] ?? NaN;
    const st = stats[p] || {};
    const acc = st.preds ? `${((st.correct / st.preds) * 100).toFixed(0)}% (${st.preds})` : '—';
    const brier = st.brierN ? (st.brier / st.brierN).toFixed(3) : '—';
    const think = st.think?.length ? `${(st.think.sort((x, y) => x - y)[Math.floor(st.think.length / 2)] / 1000).toFixed(0)}s` : '—';
    const rec = record[p];
    console.log(`${point[p].toFixed(0).padStart(6)}   ${`${lo.toFixed(0)}–${hi.toFixed(0)}`.padEnd(12)}  ${`${rec.w}-${rec.l}-${rec.t}`.padEnd(9)}  ${acc.padEnd(9)} ${brier.padEnd(6)} ${think.padEnd(12)}  ${p}`);
  }
}
