// Fairness tests: the things that would silently invalidate results.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Match} from '../src/match.mjs';
import {Game} from '../src/game.mjs';
import {parseTeam, validateTeam, computeStats} from '../src/dex-tools.mjs';
import {legalOptions, toShowdownChoice} from '../src/observation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUN = fs.readFileSync(path.join(ROOT, 'teams/sample-sun.txt'), 'utf8');
const ROOM = fs.readFileSync(path.join(ROOT, 'teams/sample-room.txt'), 'utf8');
const NATURES = ['Brave', 'Quiet', 'Relaxed', 'Calm', 'Modest', 'Careful', 'Jolly', 'Timid'];

function setup() {
  const m = new Match({seed: 'test'});
  const a = m.join({name: 'A', model: 'a'}).token;
  const b = m.join({name: 'B', model: 'b'}).token;
  return {m, a, b};
}

test('opponent team is hidden until both teams are submitted', () => {
  const {m, a} = setup();
  assert.equal(m.publicView().sheets, null);
  m.submitTeam(a, {team: SUN, team_plan: 'Sun offense with Tailwind support.'});
  assert.equal(m.publicView().sheets, null);
  assert.ok(!m.stateFor(a).text.includes('Hatterene'));
});

test('observations never reveal opponent spreads, natures, or which 4 they brought', () => {
  const {m, a, b} = setup();
  m.submitTeam(a, {team: SUN, team_plan: 'Sun offense with Tailwind support.'});
  m.submitTeam(b, {team: ROOM, team_plan: 'Trick Room with Hatterene and Sinistcha.'});
  const preview = m.stateFor(a).text;
  for (const n of ['Brave', 'Quiet', 'Relaxed', 'Calm']) assert.ok(!preview.includes(`${n} Nature`), `preview leaks ${n}`);
  assert.ok(!/EVs: 32 HP \/ 32 Atk/.test(preview.split("OPPONENT'S OPEN TEAM SHEET")[1]), 'preview leaks opponent spreads');
  m.submitPreview(a, {bring: ['Charizard', 'Whimsicott', 'Incineroar', 'Garchomp'], game_plan: 'x', key_threats: 'x'});
  m.submitPreview(b, {bring: ['Hatterene', 'Indeedee-F', 'Kingambit', 'Primarina'], game_plan: 'x', key_threats: 'x'});
  const obs = m.stateFor(a).text;
  for (const n of NATURES.filter(x => !['Modest', 'Careful', 'Jolly', 'Timid'].includes(x))) assert.ok(!obs.includes(n), `observation leaks nature ${n}`);
  // The unseen list must include every unseen sheet species (brought or not).
  const unseen = /not yet seen, from: ([^.]*)\./.exec(obs)[1];
  for (const sp of ['Kingambit', 'Primarina', 'Tyranitar', 'Sinistcha']) assert.ok(unseen.includes(sp), `unseen list missing ${sp}`);
  // Opponent HP is shown as a percentage only.
  assert.ok(!/\[foe1\][^\n]*HP \d+\/\d+/.test(obs));
  // Opponent exact Speed (Hatterene 44 with Quiet/0 Spe) must not appear as a single value.
  const hat = computeStats(parseTeam(ROOM).find(s => s.species === 'Hatterene'));
  assert.ok(!new RegExp(`their Hatterene ${hat.spe}\\b(?!–)`).test(obs));
});

test('harness computations never change battle outcomes (RNG untouched)', () => {
  const run = observe => {
    const m = new Match({seed: 'determinism'});
    const a = m.join({name: 'A', model: 'a'}).token;
    const b = m.join({name: 'B', model: 'b'}).token;
    m.submitTeam(a, {team: SUN, team_plan: 'Sun offense with Tailwind support.'});
    m.submitTeam(b, {team: ROOM, team_plan: 'Trick Room with Hatterene and Sinistcha.'});
    m.submitPreview(a, {bring: ['Charizard', 'Venusaur', 'Garchomp', 'Rotom-Wash'], game_plan: 'x', key_threats: 'x'});
    m.submitPreview(b, {bring: ['Kingambit', 'Tyranitar', 'Primarina', 'Sinistcha'], game_plan: 'x', key_threats: 'x'});
    for (let i = 0; i < 40 && m.phase === 'battle' && m.game.n === 1; i++) {
      for (const [tok, side] of [[a, 'p1'], [b, 'p2']]) {
        if (!m.currentGame.needsChoice(side)) continue;
        if (observe) m.stateFor(tok);
        const opts = legalOptions(m.currentGame, side);
        const used = new Set();
        const actions = opts.slots.flatMap(s => {
          if (opts.kind === 'switch') {
            if (!s.mustSwitch) return [];
            const sw = s.switches.find(x => !used.has(x.index));
            if (!sw) return [];
            used.add(sw.index);
            return [{slot: s.slot, switch: sw.species}];
          }
          if (s.fainted) return [];
          const mv = s.moves.find(x => x.id !== 'protect') || s.moves[0];
          return [{slot: s.slot, move: mv.name, target: mv.needsTarget ? 'foe1' : undefined}];
        });
        const r = m.submitTurn(tok, {actions, reason: 'r', plan: 'on track', threats: 't', win_condition: 'w', risk: 'r', predictions: [{foe: 'foe1', action: 'x', confidence: 0.5}]});
        assert.ok(!r.error, r.error);
      }
    }
    return m.games[0].game.battle.log.filter(l => !l.startsWith('|t:|')).join('\n');
  };
  assert.equal(run(true), run(false));
});

test('choice translation: targets, mega, and rejections', () => {
  const g = new Game({seed: [1, 2, 3, 4], p1: {name: 'A', sets: parseTeam(SUN)}, p2: {name: 'B', sets: parseTeam(ROOM)}});
  g.choose('p1', 'team 1, 5, 3, 4');
  g.choose('p2', 'team 2, 3, 1, 4');
  const opts = legalOptions(g, 'p1');
  assert.equal(opts.kind, 'move');
  const ok = toShowdownChoice(g, 'p1', opts, [{slot: 1, move: 'Air Slash', target: 'foe2', mega: true}, {slot: 2, move: 'Tailwind'}]);
  assert.equal(ok.choice, 'move 3 2 mega, move 1');
  assert.match(toShowdownChoice(g, 'p1', opts, [{slot: 1, move: 'Air Slash'}, {slot: 2, move: 'Tailwind'}]).error, /needs a target/);
  assert.match(toShowdownChoice(g, 'p1', opts, [{slot: 1, move: 'Earthquake'}, {slot: 2, move: 'Tailwind'}]).error, /cannot use/);
  assert.match(toShowdownChoice(g, 'p1', opts, [{slot: 1, move: 'Protect'}, {slot: 2, move: 'Moonblast', target: 'foe1', mega: true}]).error, /cannot Mega/);
  assert.match(toShowdownChoice(g, 'p1', opts, [{slot: 1, switch: 'Garchomp'}, {slot: 2, switch: 'Garchomp'}]).error, /Both slots/);
});

test('teambuilding validation catches Champions-specific rules', () => {
  const tooMany = SUN.replace('EVs: 2 HP / 32 SpA / 32 Spe', 'EVs: 32 HP / 32 SpA / 32 Spe');
  assert.ok(validateTeam({team: tooMany}).problems.some(p => /stat points|66/i.test(p)));
  const badMove = ROOM.replace('- Kowtow Cleave', '- Knock Off').replace('Kingambit @ Black Glasses', 'Incineroar @ Black Glasses').replace('Ability: Defiant', 'Ability: Intimidate');
  assert.ok(validateTeam({team: badMove}).problems.some(p => /can't learn Knock Off/.test(p)));
  assert.ok(validateTeam({team: SUN}).ok);
});

test('Illusion: the opponent sees the disguise and no opponent-dependent numbers', () => {
  const zoro = ROOM.replace(/Primarina @ Mystic Water[\s\S]*?- Protect/, `Zoroark-Hisui @ Life Orb
Ability: Illusion
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Hyper Voice
- Shadow Ball
- Flamethrower
- Focus Blast`);
  const v = validateTeam({team: zoro});
  assert.ok(v.ok, v.problems.join('; '));
  const m = new Match({seed: 'illusion'});
  const a = m.join({name: 'A', model: 'a'}).token;
  const b = m.join({name: 'B', model: 'b'}).token;
  m.submitTeam(a, {team: SUN, team_plan: 'Sun offense with Tailwind support.'});
  m.submitTeam(b, {team: zoro, team_plan: 'Trick Room with an Illusion trick.'});
  m.submitPreview(a, {bring: ['Charizard', 'Whimsicott', 'Incineroar', 'Garchomp'], game_plan: 'x', key_threats: 'x'});
  m.submitPreview(b, {bring: ['Zoroark-Hisui', 'Indeedee-F', 'Kingambit', 'Hatterene'], game_plan: 'x', key_threats: 'x'});
  const obs = m.stateFor(a).text;
  assert.ok(!/\[foe1\] Zoroark/.test(obs), 'disguise broken in observation');
  assert.ok(/\[foe1\] Hatterene/.test(obs), 'expected Zoroark disguised as the last Pokémon brought');
  assert.ok(!/types Normal\/Ghost/.test(obs), 'real Zoroark-Hisui typing leaked');
  assert.ok(/Illusion user/.test(obs));
  assert.ok(!/^DAMAGE/m.test(obs));
});

test('Fake Out guidance is right on turn 1 and after the first move', () => {
  const {m, a, b} = setup();
  m.submitTeam(a, {team: SUN, team_plan: 'Sun offense with Tailwind support.'});
  m.submitTeam(b, {team: ROOM, team_plan: 'Trick Room with Hatterene and Sinistcha.'});
  m.submitPreview(a, {bring: ['Incineroar', 'Whimsicott', 'Charizard', 'Garchomp'], game_plan: 'x', key_threats: 'x'});
  m.submitPreview(b, {bring: ['Kingambit', 'Hatterene', 'Primarina', 'Sinistcha'], game_plan: 'x', key_threats: 'x'});
  const t1 = m.stateFor(a).text;
  assert.ok(!/will fail now/.test(t1), 'turn 1 must not call Fake Out dead');
  const common = {reason: 'r', plan: 'on track', threats: 't', win_condition: 'w', risk: 'r', predictions: [{foe: 'foe1', action: 'Protect', confidence: 0.5}]};
  assert.ok(!m.submitTurn(a, {...common, actions: [{slot: 1, move: 'Fake Out', target: 'foe1'}, {slot: 2, move: 'Protect'}]}).error);
  m.stateFor(b);
  assert.ok(!m.submitTurn(b, {...common, actions: [{slot: 1, move: 'Protect'}, {slot: 2, move: 'Protect'}]}).error);
  const t2 = m.stateFor(a).text;
  assert.match(t2, /Fake Out \/ First Impression only work on its first turn out/);
});
