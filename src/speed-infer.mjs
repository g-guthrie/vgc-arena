// Narrow hidden Speed from public move order. Before a turn resolves we snapshot
// every active Pokémon's effective Speed as a function of its stored Speed; after
// it resolves, each pair from opposite sides that moved in the same priority
// bracket — before anything changed speed or turn order — bounds the stored Speed
// of each one relative to the other's exact value. Ties are random, so bounds
// are inclusive. Everything used here is public: move order, the open sheet.
import {toID} from './showdown.mjs';
import {effectiveSpeed, speedTable} from './calc.mjs';
import {channel} from './game.mjs';
import {priorityOf} from './observation.mjs';

// Items and abilities that reorder within a bracket regardless of Speed.
const ORDER_ITEMS = new Set(['laggingtail', 'fullincense', 'quickclaw', 'custapberry']);
const ORDER_ABILITIES = new Set(['stall', 'myceliummight', 'quickdraw']);
// Protocol lines after which order no longer reflects the snapshot (gen 9
// re-sorts the queue whenever Speed changes).
const CUTOFF = new Set(['-setboost', '-clearallboost', '-clearboost', '-clearnegativeboost', '-clearpositiveboost', '-swapboost',
  '-copyboost', '-invertboost', '-curestatus', '-cureteam', '-sidestart', '-sideend', '-fieldstart', '-fieldend', '-weather',
  '-item', '-enditem', '-ability', '-endability', '-transform', '-formechange']);
const CUTOFF_TEXT = /Quick Claw|Quick Draw|After You|Quash|Instruct|Encore|Protosynthesis|Quark Drive|Slow Start|Unburden/i;

const posOf = ident => {
  const m = /^(p[12])([ab]):/.exec(ident || '');
  return m ? `${m[1]}${m[2]}` : null;
};

export function speedSnapshot(battle) {
  if (battle.sides.some(s => s.pokemon.some(p => toID(p.baseAbility) === 'illusion'))) return null;
  const tr = !!battle.field.pseudoWeather.trickroom;
  const mons = {};
  for (const side of battle.sides) {
    side.active.forEach((p, i) => {
      if (!p || p.fainted) return;
      if (ORDER_ITEMS.has(toID(p.item)) || ORDER_ABILITIES.has(toID(p.ability))) return;
      mons[`${side.id}${'ab'[i]}`] = {
        side: side.id, key: toID(p.species.name), exact: effectiveSpeed(p), table: speedTable(p),
        priority: Object.fromEntries(p.moveSlots.map(m => [m.id, priorityOf(p, m.id)])),
      };
    });
  }
  return {tr, mons, logLen: battle.log.length};
}

// Returns constraints [{side, key, lo?, hi?}] on stored Speed.
export function speedConstraints(battle, snap) {
  if (!snap) return [];
  const order = [];
  const dead = new Set();
  for (const line of channel(battle.log.slice(snap.logLen), 'spectator')) {
    const parts = line.split('|');
    const type = parts[1];
    if (type === 'turn' || type === 'upkeep') break;
    if (CUTOFF.has(type) || CUTOFF_TEXT.test(line)) break;
    if ((type === '-boost' || type === '-unboost') && parts[3] === 'spe') break;
    if (type === '-status' && parts[3] === 'par') break;
    if (['switch', 'drag', 'replace', 'detailschange', '-mega', 'faint'].includes(type)) { const pos = posOf(parts[2]); if (pos) dead.add(pos); continue; }
    if (type !== 'move' || line.includes('[from]')) continue;
    const pos = posOf(parts[2]);
    if (!pos || dead.has(pos) || !snap.mons[pos]) continue;
    const mon = snap.mons[pos];
    const pr = mon.priority[toID(parts[3])];
    if (pr === undefined) continue;
    if (!order.some(o => o.pos === pos)) order.push({pos, mon, pr});
  }
  const out = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const first = order[i], second = order[j];
      if (first.pr !== second.pr || first.mon.side === second.mon.side) continue;
      // Without Trick Room the first mover is at least as fast; with it, at most.
      const firstFaster = !snap.tr;
      out.push(bound(first.mon, second.mon.exact, firstFaster ? 'atLeast' : 'atMost'));
      out.push(bound(second.mon, first.mon.exact, firstFaster ? 'atMost' : 'atLeast'));
    }
  }
  return out.filter(Boolean);
}

// The stored Speeds of `mon` whose effective Speed is ≥ / ≤ `ref`.
function bound(mon, ref, dir) {
  const ok = mon.table.filter(([, eff]) => (dir === 'atLeast' ? eff >= ref : eff <= ref)).map(([s]) => s);
  if (!ok.length) return null;
  return dir === 'atLeast' ? {side: mon.side, key: mon.key, lo: ok[0]} : {side: mon.side, key: mon.key, hi: ok.at(-1)};
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
