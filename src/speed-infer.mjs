// Narrow hidden Speed from public move order. The simulator sorts its action
// queue by (order, priority, fractional priority, action Speed) and re-sorts
// after every action, so when a move is about to run, every move still queued
// in the same bracket from the other side is no faster than it (Speed ties are
// random, so bounds are inclusive; Trick Room is already folded into action
// Speed). From that public order, each side bounds the other's stored Speed
// relative to its own exact value. Only the order is used, never the hidden
// numbers: each bound comes from the viewer's own Speed and the open sheet.
import {toID} from './showdown.mjs';
import {actionSpeedTable} from './calc.mjs';

export function watchSpeedOrder(battle, onConstraints) {
  // Under Illusion the visible species may not be the real one: infer nothing.
  if (battle.sides.some(s => s.pokemon.some(p => toID(p.baseAbility) === 'illusion'))) return;
  let reorderedTurn = 0;
  // After You, Instruct, Round, Pledges: something jumped the queue this turn.
  const prioritize = battle.queue.prioritizeAction.bind(battle.queue);
  battle.queue.prioritizeAction = (...args) => { reorderedTurn = battle.turn; return prioritize(...args); };
  const run = battle.runAction.bind(battle);
  battle.runAction = action => {
    if (action.choice === 'move' && reorderedTurn !== battle.turn && action.pokemon && !action.pokemon.fainted) {
      const out = [];
      for (const q of battle.queue.list) {
        if (q.choice !== 'move' || !q.pokemon || q.pokemon.fainted || q.pokemon.side === action.pokemon.side) continue;
        if (q.order !== action.order || q.priority !== action.priority || q.fractionalPriority !== action.fractionalPriority) continue;
        out.push(bound(q.pokemon, action.speed, 'atMost'), bound(action.pokemon, q.speed, 'atLeast'));
      }
      if (out.length) onConstraints(out.filter(Boolean));
    }
    return run(action);
  };
}

// The stored Speeds of `mon` whose action Speed is ≤ / ≥ `ref`.
function bound(mon, ref, dir) {
  const ok = actionSpeedTable(mon).filter(([, v]) => (dir === 'atLeast' ? v >= ref : v <= ref)).map(([s]) => s);
  if (!ok.length) return null;
  const key = toID(mon.species.name);
  return dir === 'atLeast' ? {side: mon.side.id, key, lo: ok[0]} : {side: mon.side.id, key, hi: ok.at(-1)};
}

// Fold constraints into bounds {side: {key: {lo, hi}}}, ignoring any that
// would contradict what is already known.
export function applySpeedConstraints(bounds, constraints) {
  for (const c of constraints) {
    const b = (bounds[c.side] ||= {})[c.key] ||= {lo: -Infinity, hi: Infinity};
    const lo = Math.max(b.lo, c.lo ?? -Infinity);
    const hi = Math.min(b.hi, c.hi ?? Infinity);
    if (lo <= hi) Object.assign(b, {lo, hi});
  }
  return bounds;
}
