// Guided teambuilding: the nine questions, on-the-spot validation, revisions and the lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {newMatch, ROOM} from './helpers.mjs';
import {question} from '../src/guided.mjs';
import {setSlot, newDraft} from '../src/draft.mjs';

// The sample Trick Room team as draft answers.
const STAT = {HP: 'hp', Atk: 'atk', Def: 'def', SpA: 'spa', SpD: 'spd', Spe: 'spe'};
const SETS = ROOM.trim().split(/\n\s*\n/).map(block => {
  const lines = block.split('\n').map(l => l.trim());
  const [species, item] = lines[0].split(' @ ').map(x => x.trim());
  const sp = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
  for (const part of (lines.find(l => l.startsWith('EVs:')) || '').slice(4).split('/')) {
    const [n, k] = part.trim().split(' ');
    if (STAT[k]) sp[STAT[k]] = Number(n);
  }
  return {species, item, sp, ability: lines.find(l => l.startsWith('Ability:')).slice(8).trim(),
    nature: lines.find(l => l.endsWith('Nature')).replace(' Nature', ''), moves: lines.filter(l => l.startsWith('- ')).map(l => l.slice(2))};
});

test('the questions come in order and each answer is checked where it lands', () => {
  const {m, a} = newMatch();
  assert.equal(question(m.seats.p1.draft).n, 1);
  assert.match(m.draftAnswer(a, {species: SETS.map(s => s.species)}).error, /needs: concept/);
  assert.ok(!m.draftAnswer(a, {concept: 'Trick Room: Hatterene and Sinistcha set it, Kingambit and Tyranitar abuse it.'}).error);
  assert.equal(question(m.seats.p1.draft).n, 2);
  const bad = m.draftAnswer(a, {species: ['Notamon', ...SETS.slice(1).map(s => s.species)]});
  assert.match(bad.error, /not a Pokémon/);
  assert.match(bad.error, /Nothing was changed/);
  assert.ok(m.seats.p1.draft.slots.every(s => !s), 'all-or-nothing');
  assert.match(m.draftAnswer(a, {species: SETS.slice(0, 5).map(s => s.species)}).error, /exactly six/);
  assert.ok(!m.draftAnswer(a, {species: SETS.map(s => s.species)}).error);
  for (const [i, s] of SETS.entries()) {
    const q = question(m.seats.p1.draft);
    assert.equal(q.n, 3 + i);
    assert.equal(q.step, 'set');
    assert.match(q.title, new RegExp(`Set for ${s.species.replace('-', '\\-')}`));
    // Every legal answer is in the schema's enums.
    assert.ok(q.schema.properties.ability.enum.includes(s.ability));
    assert.ok(q.schema.properties.item.enum.includes(s.item), `${s.item} offered for ${s.species}`);
    for (const mv of s.moves) assert.ok(q.schema.properties.moves.items.enum.includes(mv), `${mv} legal for ${s.species}`);
    const r = m.draftAnswer(a, {ability: s.ability, item: s.item, nature: s.nature, sp: s.sp, moves: s.moves});
    assert.ok(!r.error, r.error);
  }
  const q9 = question(m.seats.p1.draft);
  assert.equal(q9.n, 9);
  assert.equal(q9.step, 'lock');
  assert.match(m.draftAnswer(a, {team_plan: 'short'}).error, /team_plan/);
  const lock = m.draftAnswer(a, {team_plan: 'Follow Me + Trick Room, then sweep with Kingambit and Tyranitar.'});
  assert.ok(lock.locked, JSON.stringify(lock));
  assert.ok(m.seats.p1.team);
  assert.equal(m.seats.p1.sheet.length, 6);
  assert.match(m.draftAnswer(a, {team_plan: 'again'}).error, /already locked/);
});

test('validation errors name the rule and offer legal alternatives', () => {
  const d = newDraft();
  assert.match(setSlot(d, {slot: 1, species: 'Incineroar'}).ok ? '' : 'x', /^$/);
  assert.match(setSlot(d, {slot: 1, moves: ['Knock Off']}).error || '', /Incineroar can't learn Knock Off in Champions\. Legal Dark physical moves:/);
  assert.match(setSlot(d, {slot: 1, moves: ['Flare Blitz', 'Flare Blitz']}).error, /listed twice/);
  assert.match(setSlot(d, {slot: 1, ability: 'Levitate'}).error, /can't have Levitate\. Legal abilities: .*Intimidate/);
  assert.match(setSlot(d, {slot: 1, item: 'Garchompite Z'}).error, /Mega Stone, not Incineroar's/);
  assert.match(setSlot(d, {slot: 1, sp: {atk: 40}}).error, /At most 32/);
  assert.match(setSlot(d, {slot: 1, sp: {hp: 32, atk: 32, spe: 32}}).error, /limit is 66/);
  assert.match(setSlot(d, {slot: 1, sp: {speed: 32, hp: 2}}).ok ? 'ok' : '', /ok/, 'stat aliases are accepted');
  assert.deepEqual(d.slots[0].sp, {spe: 32, hp: 2});
  assert.ok(setSlot(d, {slot: 1, item: 'Sitrus Berry'}).ok);
  assert.ok(setSlot(d, {slot: 2, species: 'Garchomp'}).ok);
  assert.match(setSlot(d, {slot: 2, item: 'Sitrus Berry'}).error, /Item clause: Sitrus Berry is already held by Incineroar/);
  assert.match(setSlot(d, {slot: 3, species: 'Incineroar'}).error, /Species clause/);
  assert.match(setSlot(d, {slot: 3, species: 'Garchomp-Mega-Z'}).error || setSlot(d, {slot: 3, species: 'Garchomp-Mega'}).error || '', /Mega form|not a Pokémon|Species clause/);
});

test('revising reopens a set or swaps the Pokémon, and the question goes back to it', () => {
  const {m, a} = newMatch();
  m.draftAnswer(a, {concept: 'Trick Room: Hatterene and Sinistcha set it, Kingambit and Tyranitar abuse it.'});
  m.draftAnswer(a, {species: SETS.map(s => s.species)});
  for (const s of SETS) m.draftAnswer(a, {ability: s.ability, item: s.item, nature: s.nature, sp: s.sp, moves: s.moves});
  assert.equal(question(m.seats.p1.draft).step, 'lock');
  assert.ok(!m.draftRevise(a, {slot: 2}).error);
  const q = question(m.seats.p1.draft);
  assert.equal(q.n, 4);
  assert.equal(q.slot, 2);
  assert.ok(!m.draftRevise(a, {slot: 2, species: 'Rillaboom'}).error);
  assert.equal(m.seats.p1.draft.slots[1].species, 'Rillaboom');
  assert.match(m.draftRevise(a, {slot: 2, species: 'Hatterene'}).error, /Species clause/);
  assert.equal(m.seats.p1.draft.slots[1].species, 'Rillaboom', 'an illegal swap changes nothing');
  assert.match(m.draftRevise(a, {slot: 9}).error, /empty/);
});
