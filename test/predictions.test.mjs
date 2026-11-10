// Predictions are graded against what the opponent chose, in the record and
// in the review a player reads the next turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {actionMenu, optionFor} from '../src/observation.mjs';
import {toBattle, simpleAnswer} from './helpers.mjs';

test('a correct read scores 1 and a low-confidence miss scores its Brier penalty', () => {
  const {m, a, b} = toBattle();
  const game = m.currentGame;
  // p2 (Trick Room team): Hatterene uses Trick Room, Indeedee uses Follow Me.
  const menu2 = actionMenu(game, 'p2');
  const p2 = {
    actions: {slot1: optionFor(menu2, {slot: 1, move: 'Trick Room'}), slot2: optionFor(menu2, {slot: 2, move: 'Follow Me'})},
    predictions: Object.fromEntries(menu2.predict.map(f => [f.foe, {action: 'switch', confidence: 0.2}])),
  };
  assert.ok(p2.actions.slot1 && p2.actions.slot2, JSON.stringify(menu2.slots.map(s => s.options.map(o => o.id))));
  const p1 = simpleAnswer(m, 'p1');
  p1.predictions = {foe1: {action: 'Trick Room', confidence: 0.9}, foe2: {action: 'Psychic', confidence: 0.3}};
  assert.ok(!m.submitTurn(a, p1).error);
  assert.ok(!m.submitTurn(b, p2).error);
  const d1 = m.decisions.find(d => d.side === 'p1' && d.kind === 'move');
  assert.deepEqual(d1.predictionScores.map(s => [s.foe, s.actual, s.correct]), [['foe1', 'Trick Room', true], ['foe2', 'Follow Me', false]]);
  assert.ok(Math.abs(d1.predictionScores[0].brier - 0.01) < 1e-9);
  assert.ok(Math.abs(d1.predictionScores[1].brier - 0.09) < 1e-9);
  const d2 = m.decisions.find(d => d.side === 'p2' && d.kind === 'move');
  assert.ok(d2.predictionScores.every(s => s.correct === false && s.actual !== 'switch'));
  if (m.phase === 'battle' && m.currentGame.needsChoice('p1')) {
    const text = m.stateFor(a).text;
    assert.match(text, /foe1 Hatterene: you predicted Trick Room \(90%\) → they chose Trick Room ✓/);
    assert.match(text, /foe2 Indeedee-F: you predicted Psychic \(30%\) → they chose Follow Me ✗/);
  }
});

test('a missing or malformed prediction never blocks the move; it is just not recorded', () => {
  const {m, a} = toBattle();
  const ans = simpleAnswer(m, 'p1');
  const r = m.submitTurn(a, {...ans, predictions: {foe1: {action: 'Flamethrower', confidence: 0.5}}});
  assert.ok(r.ok, r.error);
  const d = m.decisions.find(x => x.kind === 'move');
  assert.deepEqual(d.payload.predictions, []);
  assert.deepEqual(d.payload.predictionsMissed, ['foe1', 'foe2']);
  const {m: m2, a: a2} = toBattle();
  const ans2 = simpleAnswer(m2, 'p1');
  assert.ok(m2.submitTurn(a2, {...ans2, predictions: {...ans2.predictions, foe1: {action: 'Trick Room', confidence: 2}}}).ok);
  assert.deepEqual(m2.decisions.find(x => x.kind === 'move').payload.predictions.map(p => p.foe), ['foe2']);
});

test('built-in bots never predict, so prediction stats stay about models', () => {
  const {m, a} = toBattle();
  m.seats.p1.builtin = true;
  const ans = simpleAnswer(m, 'p1');
  delete ans.predictions;
  assert.ok(!m.submitTurn(a, ans).error);
  assert.deepEqual(m.decisions.find(d => d.side === 'p1' && d.kind === 'move').payload.predictions, []);
});
