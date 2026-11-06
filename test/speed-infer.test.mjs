// Speed bounds from move order: they only ever narrow, never contradict, and
// the real hidden Speed always stays inside them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applySpeedConstraints} from '../src/speed-infer.mjs';
import {statRange} from '../src/dex-tools.mjs';
import {toBattle, playUntil} from './helpers.mjs';

test('constraints fold into bounds and contradictions are ignored', () => {
  const b = applySpeedConstraints({}, [{side: 'p2', key: 'hatterene', hi: 60}, {side: 'p2', key: 'hatterene', lo: 40}]);
  assert.deepEqual(b.p2.hatterene, {lo: 40, hi: 60});
  applySpeedConstraints(b, [{side: 'p2', key: 'hatterene', hi: 55}]);
  assert.deepEqual(b.p2.hatterene, {lo: 40, hi: 55});
  applySpeedConstraints(b, [{side: 'p2', key: 'hatterene', lo: 70}]);
  assert.deepEqual(b.p2.hatterene, {lo: 40, hi: 55}, 'a bound that would empty the range is dropped');
  applySpeedConstraints(b, [{side: 'p1', key: 'charizard', lo: 100}]);
  assert.deepEqual(b.p1.charizard, {lo: 100, hi: Infinity});
});

test('after a few turns the inferred bounds contain every real stored Speed', () => {
  const f = toBattle();
  playUntil(f, m => m.phase !== 'battle' || m.currentGame.turn >= 6, 6);
  const {m} = f;
  const all = Object.entries(m.speedBounds).flatMap(([side, bySpecies]) => Object.entries(bySpecies).map(([key, b]) => ({side, key, ...b})));
  assert.ok(all.length > 0, 'move order should have produced at least one bound');
  for (const b of all) {
    const game = m.games[0].game;
    const mon = game.side(b.side).pokemon.find(p => p.species.id === b.key || p.baseSpecies?.id === b.key);
    assert.ok(mon, `bound for ${b.key} refers to a Pokémon on ${b.side}`);
    const real = mon.storedStats.spe;
    const [lo, hi] = statRange(mon.species, 'spe');
    assert.ok(b.lo >= -Infinity && b.hi >= b.lo);
    assert.ok(real >= b.lo && real <= b.hi, `${b.key}: real ${real} outside [${b.lo}, ${b.hi}] (legal ${lo}–${hi})`);
  }
  // The observation shows a narrowed range, never the exact number, for a bounded foe.
  const bounded = all.find(b => b.side === 'p2' && (b.lo > -Infinity || b.hi < Infinity));
  if (bounded && m.phase === 'battle' && m.currentGame.needsChoice('p1')) {
    const text = m.stateFor(m.seats.p1.token).text;
    assert.match(text, /from move order|possible stats/);
  }
});
