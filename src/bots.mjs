// Built-in baseline players. They go through the same submit path as models,
// so a bot match exercises the whole harness. `random` is a floor; `greedy`
// (best type-adjusted base power each turn) is the bar any model should clear.
import fs from 'node:fs';
import path from 'node:path';
import {dex, ROOT_DIR} from './showdown.mjs';
import {legalOptions} from './observation.mjs';

export const BOT_KINDS = ['random', 'greedy'];
const TEAM_FILES = ['sample-sun.txt', 'sample-room.txt'];
let teamCounter = 0;
export function sampleTeam(i = teamCounter++) {
  return fs.readFileSync(path.join(ROOT_DIR, 'teams', TEAM_FILES[i % TEAM_FILES.length]), 'utf8');
}

const pick = xs => xs[Math.floor(Math.random() * xs.length)];
function shuffle(xs) { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function moveScore(game, side, slot, move) {
  const me = game.side(side).active[slot - 1];
  const data = dex.moves.get(move.id);
  if (data.category === 'Status') return {score: data.id === 'protect' ? 5 : 15, target: 'foe1'};
  let best = {score: -1, target: 'foe1'};
  game.side(side).foe.active.forEach((foe, i) => {
    if (!foe || foe.fainted) return;
    if (!dex.getImmunity(data.type, foe.getTypes())) return;
    let s = (data.basePower || 60) * Math.pow(2, dex.getEffectiveness(data.type, foe.getTypes()));
    if (me.getTypes().includes(data.type)) s *= 1.5;
    if (data.target === 'allAdjacentFoes') s *= 1.3;
    if (data.id === 'fakeout' && me.activeTurns > 0) s = 0;
    if (s > best.score) best = {score: s, target: `foe${i + 1}`};
  });
  return best;
}

function decideTurn(game, side, kind) {
  const opts = legalOptions(game, side);
  const actions = [];
  const used = new Set();
  for (const s of opts.slots) {
    if (opts.kind === 'switch') {
      if (!s.mustSwitch) continue;
      const choice = s.switches.find(x => !used.has(x.index));
      if (choice) { used.add(choice.index); actions.push({slot: s.slot, switch: choice.species}); }
      continue;
    }
    if (s.fainted) continue;
    let move;
    let target;
    if (kind === 'random') {
      if (s.switches.length && Math.random() < 0.1) {
        const choice = s.switches.find(x => !used.has(x.index));
        if (choice) { used.add(choice.index); actions.push({slot: s.slot, switch: choice.species}); continue; }
      }
      move = pick(s.moves);
      target = pick(['foe1', 'foe2']);
    } else {
      const scored = s.moves.map(m => ({m, ...moveScore(game, side, s.slot, m)})).sort((a, b) => b.score - a.score);
      ({m: move, target} = scored[0]);
    }
    const a = {slot: s.slot, move: move.name};
    if (move.needsTarget && move.target !== 'adjacentAlly' && move.target !== 'adjacentAllyOrSelf') {
      const live = game.side(side).foe.active.map((p, i) => (p && !p.fainted ? `foe${i + 1}` : null)).filter(Boolean);
      a.target = live.includes(target) ? target : live[0] || 'foe1';
    }
    actions.push(a);
  }
  return {
    actions,
    predictions: [{foe: 'foe1', action: 'attack', confidence: 0.5}, {foe: 'foe2', action: 'attack', confidence: 0.5}],
    reason: `${kind} bot`, plan: 'on track', threats: 'n/a', win_condition: 'n/a', risk: 'n/a',
  };
}

export function attachBot(match, token, kind) {
  const side = match.sideOf(token);
  let busy = false;
  let failures = 0;
  const step = () => {
    if (busy || match.phase === 'finished') return;
    if (!match.yourTurn(side)) return;
    busy = true;
    setImmediate(() => {
      try {
        if (match.phase === 'teambuilding') {
          match.submitTeam(token, {team: sampleTeam(), team_plan: `Built-in ${kind} bot using a fixed sample team.`});
        } else if (match.phase === 'preview') {
          const team = match.seats[side].team.map(s => s.species);
          match.submitPreview(token, {bring: shuffle(team).slice(0, 4), game_plan: 'n/a', key_threats: 'n/a', lessons: 'n/a'});
        } else if (match.phase === 'battle') {
          const payload = decideTurn(match.currentGame, side, kind);
          const res = match.submitTurn(token, payload);
          if (res.error) {
            // Never stall a match: fall back to the first legal option per slot.
            const opts = legalOptions(match.currentGame, side);
            const actions = opts.slots.filter(s => !s.fainted && (opts.kind !== 'switch' || s.mustSwitch)).map(s => (opts.kind === 'switch' || !s.moves?.length
              ? {slot: s.slot, switch: s.switches[0]?.species}
              : {slot: s.slot, move: s.moves[0].name, target: 'foe1'}));
            const res2 = match.submitTurn(token, {...payload, actions});
            if (res2.error) {
              failures++;
              match.log(`${kind} bot error: ${res.error} / ${res2.error}`);
              if (failures >= 3) match.forfeit(token);
              return;
            }
          }
          failures = 0;
        }
      } catch (err) {
        match.log(`${kind} bot crashed: ${err.message}`);
      } finally {
        busy = false;
        if (failures && failures < 3) setTimeout(step, 50);
        else if (!failures) step();
      }
    });
  };
  match.on('change', step);
  step();
}
