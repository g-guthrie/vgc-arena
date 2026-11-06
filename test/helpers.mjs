// Shared fixtures: a match driven to a chosen phase with the two sample teams.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Match} from '../src/match.mjs';
import {legalOptions, actionMenu, optionFor} from '../src/observation.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SUN = fs.readFileSync(path.join(ROOT, 'teams/sample-sun.txt'), 'utf8');
export const ROOM = fs.readFileSync(path.join(ROOT, 'teams/sample-room.txt'), 'utf8');

export function newMatch(opts = {}) {
  const m = new Match({seed: 'test', ...opts});
  const a = m.join({name: 'A', model: 'a', harness: 'mcp-test', client: {via: 'mcp-stdio'}}).token;
  const b = m.join({name: 'B', model: 'b', harness: 'api:openai', client: {via: 'arena-api'}}).token;
  return {m, a, b};
}

export function toPreview(opts) {
  const f = newMatch(opts);
  f.m.submitTeam(f.a, {team: SUN, team_plan: 'Sun offense with Tailwind support.'});
  f.m.submitTeam(f.b, {team: ROOM, team_plan: 'Trick Room with Hatterene and Sinistcha.'});
  return f;
}

export function toBattle(opts) {
  const f = toPreview(opts);
  f.m.submitPreview(f.a, {bring: ['Charizard', 'Whimsicott', 'Incineroar', 'Garchomp'], game_plan: 'x'});
  f.m.submitPreview(f.b, {bring: ['Hatterene', 'Indeedee-F', 'Kingambit', 'Primarina'], game_plan: 'x'});
  return f;
}

// A legal, non-Protect answer for a side, in the shape turn_submit takes.
export function simpleAnswer(m, side, prediction = 'switch') {
  const game = m.currentGame;
  const opts = legalOptions(game, side);
  const menu = actionMenu(game, side);
  const used = new Set();
  const actions = {};
  for (const s of menu.slots) {
    const o = opts.slots.find(x => x.slot === s.slot);
    let id;
    if (opts.kind === 'switch') {
      const sw = o.switches.find(x => !used.has(x.index));
      if (sw) { used.add(sw.index); id = optionFor(menu, {slot: s.slot, switch: sw.species}); }
    } else {
      const mv = o.moves.find(x => x.id !== 'protect') || o.moves[0];
      id = optionFor(menu, {slot: s.slot, move: mv.name, target: mv.needsTarget ? 'foe1' : undefined});
    }
    actions[`slot${s.slot}`] = id || s.options[0].id;
  }
  const predictions = Object.fromEntries(menu.predict.map(f => [f.foe, {action: prediction, confidence: 0.5}]));
  return {actions, predictions};
}

// Play whole turns until a condition holds (or a turn cap).
export function playUntil(f, done, maxTurns = 40) {
  for (let i = 0; i < maxTurns && !done(f.m); i++) {
    for (const [tok, side] of [[f.a, 'p1'], [f.b, 'p2']]) {
      if (f.m.phase !== 'battle' || !f.m.currentGame.needsChoice(side)) continue;
      const r = f.m.submitTurn(tok, simpleAnswer(f.m, side));
      if (r.error) throw new Error(r.error);
    }
  }
}
