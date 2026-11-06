// Many bot-vs-bot matches across seeds; fails on any harness error event.
import {Arena} from '../src/arena.mjs';
const N = Number(process.argv[2] || 30);
const arena = new Arena({artifactsDir: process.env.VGC_ARTIFACTS || 'artifacts/stress'});
let bad = 0, games = 0, turns = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const m = arena.createMatch({label: `stress ${i}`, seed: `stress-${i}`});
  arena.addBot(m.id, i % 2 ? 'greedy' : 'random');
  arena.addBot(m.id, 'random');
  await new Promise((resolve, reject) => { m.once('finished', resolve); setTimeout(() => reject(new Error(`match ${i} stalled in ${m.phase} game ${m.game?.n} turn ${m.currentGame?.turn}`)), 30000); });
  const errs = m.events.filter(e => /error|crash/i.test(e.text));
  if (errs.length) { bad++; console.log(`match ${i}:`, errs.slice(0, 3).map(e => e.text)); }
  games += m.games.length; turns += m.games.reduce((a, g) => a + g.game.turn, 0);
}
console.log(`${N} matches, ${games} games, ${turns} turns, ${bad} with errors, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(bad ? 1 : 0);
