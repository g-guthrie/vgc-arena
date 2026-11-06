// The option menu: text, schema and parser come from one list of legal actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {actionMenu, choiceFromAnswer, turnSchema, legalOptions} from '../src/observation.mjs';
import {toBattle, playUntil} from './helpers.mjs';

const foeSheet = m => foe => m.sheetFor('p2', m.currentGame.side('p2').active[foe === 'foe1' ? 0 : 1].species.name);

test('option IDs name their slot, move and target', () => {
  const {m} = toBattle();
  const menu = actionMenu(m.currentGame, 'p1');
  const ids = menu.slots.flatMap(s => s.options.map(o => o.id));
  assert.ok(ids.includes('1:heatwave'), ids.join(' '));
  assert.ok(ids.includes('2:tailwind'));
  assert.ok(ids.some(id => /^1:[a-z]+>foe1$/.test(id)));
  assert.ok(ids.some(id => /^1:switch>[a-z]+$/.test(id)));
  assert.ok(ids.every(id => /^[12]:[a-z0-9]+(>[a-z0-9]+)?$/.test(id)));
});

test('an answer is an exact option or a rejection that lists the options', () => {
  const {m} = toBattle();
  const menu = actionMenu(m.currentGame, 'p1');
  const ok = choiceFromAnswer(menu, {actions: {slot1: '1:heatwave', slot2: '2:tailwind'}});
  assert.equal(ok.choice, 'move 1, move 1');
  assert.deepEqual(ok.ids, {slot1: '1:heatwave', slot2: '2:tailwind'});
  const bad = choiceFromAnswer(menu, {actions: {slot1: '1:flamethrower', slot2: '2:tailwind'}});
  assert.match(bad.error, /not an option for slot1/);
  assert.match(bad.error, /1:heatwave/);
  const missing = choiceFromAnswer(menu, {actions: {slot1: '1:heatwave'}});
  assert.match(missing.error, /Missing slot2/);
  const shape = choiceFromAnswer(menu, {actions: ['1:heatwave']});
  assert.match(shape.error, /actions must be an object/);
  assert.match(choiceFromAnswer(menu, {actions: {slot1: ' 1:HeatWave ', slot2: '2:tailwind'}}).choice, /^move/, 'IDs are case- and space-insensitive');
});

test('two slots cannot send in the same Pokémon; Mega only on a slot that can', () => {
  const {m} = toBattle();
  const menu = actionMenu(m.currentGame, 'p1');
  const sw = menu.slots[0].options.find(o => o.action.switch).id;
  const sw2 = `2:${sw.slice(2)}`;
  assert.match(choiceFromAnswer(menu, {actions: {slot1: sw, slot2: sw2}}).error, /same Pokémon/);
  assert.match(choiceFromAnswer(menu, {actions: {slot1: '1:heatwave', slot2: '2:tailwind'}, mega: 2}).error, /mega must be|No Pokémon can Mega/);
  if (menu.megaSlots.includes(1)) {
    const r = choiceFromAnswer(menu, {actions: {slot1: '1:heatwave', slot2: '2:tailwind'}, mega: 1});
    assert.equal(r.choice, 'move 1 mega, move 1');
    assert.ok(r.actions.find(a => a.slot === 1).mega);
  }
});

test('the JSON schema enumerates exactly the menu IDs and the sheet moves', () => {
  const {m} = toBattle();
  const menu = actionMenu(m.currentGame, 'p1');
  const schema = turnSchema(menu, foeSheet(m));
  assert.deepEqual(schema.properties.actions.properties.slot1.enum, menu.slots[0].options.map(o => o.id));
  assert.deepEqual(schema.required.slice(0, 2), ['predictions', 'actions']);
  const foe1 = schema.properties.predictions.properties.foe1.properties.action.enum;
  assert.ok(foe1.includes('switch'));
  assert.ok(foe1.includes('Trick Room'), foe1.join(', '));
  assert.equal(schema.additionalProperties, false);
});

test('replacements after a faint take only the empty slot and allow "pass" when short', () => {
  const f = toBattle();
  playUntil(f, m => m.phase !== 'battle' || legalOptions(m.currentGame, 'p1')?.kind === 'switch' || legalOptions(m.currentGame, 'p2')?.kind === 'switch', 40);
  const side = ['p1', 'p2'].find(s => f.m.phase === 'battle' && legalOptions(f.m.currentGame, s)?.kind === 'switch');
  if (!side) return; // the seed ended the game without a mid-game faint; nothing to assert
  const menu = actionMenu(f.m.currentGame, side);
  assert.ok(menu.slots.length >= 1);
  assert.ok(menu.slots.every(s => s.replace || s.pivot));
  assert.ok(menu.slots.every(s => s.options.every(o => o.action.switch || o.action.pass)));
  assert.equal(menu.predict.length, 0, 'no predictions on a replacement');
});
