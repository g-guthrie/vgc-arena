// Damage and speed facts computed by the simulator itself, so the numbers the
// players see are the numbers the battle will use. Opponent spreads are hidden
// under open team sheets, so opponent-dependent numbers are ranges over every
// legal spread (0 SP / hindering nature .. 32 SP / boosting nature).
import {Battle, Teams, dex, FORMAT_ID} from './showdown.mjs';
import {statRange} from './dex-tools.mjs';

// Run fn with the battle's randomness pinned and every side effect rolled back.
// The real PRNG is swapped out for a throwaway clone, so nothing inside the
// simulator (speed-tie shuffles in event ordering, etc.) can advance it.
function sandboxed(battle, roll, fn) {
  const saved = {random: battle.random, randomChance: battle.randomChance, sample: battle.sample, logLen: battle.log.length, prng: battle.prng};
  battle.prng = saved.prng.clone();
  battle.random = (m, n) => {
    if (m === 16 && n === undefined) return roll === 'min' ? 15 : 0; // damage roll: 85%..100%
    if (n === undefined) return 0;
    return m;
  };
  battle.randomChance = () => false;
  battle.sample = items => items[0];
  try {
    return fn();
  } finally {
    battle.random = saved.random;
    battle.randomChance = saved.randomChance;
    battle.sample = saved.sample;
    battle.prng = saved.prng;
    battle.log.length = saved.logLen;
  }
}

function withStats(pokemon, overrides, fn) {
  if (!overrides) return fn();
  const saved = {stored: {...pokemon.storedStats}, maxhp: pokemon.maxhp, hp: pokemon.hp};
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (k === 'hp') {
        const frac = pokemon.hp / pokemon.maxhp;
        pokemon.maxhp = v;
        pokemon.hp = Math.max(1, Math.round(frac * v));
      } else pokemon.storedStats[k] = v;
    }
    return fn();
  } finally {
    pokemon.storedStats = saved.stored;
    pokemon.maxhp = saved.maxhp;
    pokemon.hp = saved.hp;
  }
}

function oneHit(battle, attacker, defender, moveId, roll, spread) {
  return sandboxed(battle, roll, () => {
    const move = battle.dex.getActiveMove(moveId);
    move.willCrit = false;
    if (spread) move.spreadHit = true;
    let dmg = battle.actions.getDamage(attacker, defender, move, true);
    if (dmg === false) return 'immune';
    if (typeof dmg !== 'number') return null;
    const hits = typeof move.multihit === 'number' ? move.multihit : Array.isArray(move.multihit) ? move.multihit[0] : 1;
    return dmg * hits;
  });
}

export function isSpread(move, battle, attacker) {
  if (move.target !== 'allAdjacentFoes' && move.target !== 'allAdjacent') return false;
  const foes = attacker.side.foe.active.filter(p => p && !p.fainted);
  const allies = move.target === 'allAdjacent' ? attacker.side.active.filter(p => p && p !== attacker && !p.fainted) : [];
  return foes.length + allies.length > 1;
}

function offenseStat(move) { return move.overrideOffensiveStat || (move.category === 'Special' ? 'spa' : 'atk'); }
function defenseStat(move) {
  if (move.overrideDefensiveStat) return move.overrideDefensiveStat;
  return move.category === 'Special' && !move.overrideOffensivePokemon ? 'spd' : 'def';
}

// Percent range of the defender's max HP. `hidden` says which side's spread is unknown.
export function damageRange(battle, attacker, defender, moveId, hidden, forceSpread) {
  const move = dex.moves.get(moveId);
  if (move.category === 'Status') return null;
  // Foul Play uses the target's hidden Attack; don't compute what we can't know.
  if (hidden === 'defender' && move.overrideOffensivePokemon === 'target') return null;
  const spread = forceSpread ?? isSpread(move, battle, attacker);
  try {
    if (hidden === 'defender') {
      const sp = defender.species;
      const ds = defenseStat(move);
      const [hpLo, hpHi] = statRange(sp, 'hp');
      const [dLo, dHi] = statRange(sp, ds);
      const lo = withStats(defender, {hp: hpHi, [ds]: dHi}, () => oneHit(battle, attacker, defender, moveId, 'min', spread));
      if (lo === 'immune') return {immune: true};
      const hi = withStats(defender, {hp: hpLo, [ds]: dLo}, () => oneHit(battle, attacker, defender, moveId, 'max', spread));
      if (lo === null || hi === null) return null;
      return {lo: (lo / hpHi) * 100, hi: (hi / hpLo) * 100, spread};
    }
    if (hidden === 'attacker') {
      const os = offenseStat(move);
      const sp = attacker.species;
      const [oLo, oHi] = statRange(sp, os);
      const lo = withStats(attacker, {[os]: oLo}, () => oneHit(battle, attacker, defender, moveId, 'min', spread));
      if (lo === 'immune') return {immune: true};
      const hi = withStats(attacker, {[os]: oHi}, () => oneHit(battle, attacker, defender, moveId, 'max', spread));
      if (lo === null || hi === null) return null;
      return {lo: (lo / defender.maxhp) * 100, hi: (hi / defender.maxhp) * 100, spread};
    }
    const lo = oneHit(battle, attacker, defender, moveId, 'min', spread);
    if (lo === 'immune') return {immune: true};
    const hi = oneHit(battle, attacker, defender, moveId, 'max', spread);
    if (lo === null || hi === null) return null;
    return {lo: (lo / defender.maxhp) * 100, hi: (hi / defender.maxhp) * 100, spread};
  } catch {
    return null;
  }
}

// Effective speed with every field/item/ability/boost modifier the sim applies.
export function effectiveSpeed(pokemon) {
  try { return sandboxed(pokemon.battle, 'max', () => pokemon.getStat('spe')); } catch { return pokemon.storedStats.spe; }
}

// `bounds` optionally narrows the stored Speed (e.g. from observed move order).
export function effectiveSpeedRange(pokemon, bounds) {
  let [lo, hi] = statRange(pokemon.species, 'spe');
  if (bounds) { lo = Math.max(lo, bounds.lo ?? lo); hi = Math.min(hi, bounds.hi ?? hi); }
  const a = withStats(pokemon, {spe: lo}, () => effectiveSpeed(pokemon));
  const b = withStats(pokemon, {spe: hi}, () => effectiveSpeed(pokemon));
  return [Math.min(a, b), Math.max(a, b)];
}

// A throwaway copy of the battle with `pokemon` Mega Evolved, as it would be
// before moves this turn (Mega abilities such as Drought included). Returns
// {mon, find(other)} mapping live Pokémon to their copies, or null.
export function megaPreview(battle, pokemon) {
  if (!pokemon.canMegaEvo || pokemon.species.isMega) return null;
  try {
    const copy = Battle.fromJSON(JSON.stringify(battle.toJSON()));
    const find = p => copy.sides[p.side.n].active[p.position];
    const mon = find(pokemon);
    copy.actions.runMegaEvo(mon);
    return mon.species.isMega ? {mon, find} : null;
  } catch {
    return null;
  }
}

// The action Speed the queue would sort by (Trick Room folded in) for every
// stored Speed this species can have: [[stored, actionSpeed], ...] ascending.
export function actionSpeedTable(pokemon) {
  const [lo, hi] = statRange(pokemon.species, 'spe');
  const rows = [];
  for (let s = lo; s <= hi; s++) rows.push([s, withStats(pokemon, {spe: s}, () => sandboxed(pokemon.battle, 'max', () => pokemon.getActionSpeed()))]);
  return rows;
}

// ------------------------------------------------------------ standalone calc
// A scratch battle for the teambuilding `calc` tool: two arbitrary sets, any field.
export function standaloneCalc({attacker, defender, move, field = {}}) {
  const atkSets = Teams.import(String(attacker || '').trim());
  const defSets = Teams.import(String(defender || '').trim());
  if (!atkSets?.length || !defSets?.length) return {error: 'attacker and defender must be Showdown-format sets (species line, Ability:, EVs:, Nature, moves).'};
  const a = {...atkSets[0], level: 50};
  const d = {...defSets[0], level: 50};
  const moveData = dex.moves.get(move);
  if (!moveData.exists) return {error: `Unknown move ${move}`};
  if (!a.moves?.length) a.moves = [moveData.name];
  if (!d.moves?.length) d.moves = ['Splash'];
  const filler = {species: 'Magikarp', ability: 'Swift Swim', moves: ['Splash'], level: 50, evs: {}, ivs: {}};
  const battle = new Battle({formatid: 'gen9championsdoublescustomgame', seed: [1, 2, 3, 4]});
  battle.setPlayer('p1', {name: 'A', team: Teams.pack([a, {...filler}])});
  battle.setPlayer('p2', {name: 'D', team: Teams.pack([d, {...filler}])});
  battle.choose('p1', 'team 1, 2');
  battle.choose('p2', 'team 1, 2');
  const att = battle.sides[0].active[0];
  const def = battle.sides[1].active[0];
  // Undo on-entry effects (Intimidate etc.) so only the requested field applies.
  for (const p of [att, def]) p.boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0};
  if (battle.field.weather) battle.field.clearWeather();
  if (battle.field.terrain) battle.field.clearTerrain();
  if (field.attacker_mega && battle.actions.canMegaEvo(att)) battle.actions.runMegaEvo(att);
  if (field.defender_mega && battle.actions.canMegaEvo(def)) battle.actions.runMegaEvo(def);
  if (!field.keep_mega_weather) { if (battle.field.weather) battle.field.clearWeather(); }
  if (field.weather) battle.field.setWeather(field.weather, att);
  if (field.terrain) battle.field.setTerrain(field.terrain, att);
  for (const sc of field.defender_side || []) battle.sides[1].addSideCondition(sc);
  if (field.attacker_boosts) Object.assign(att.boosts, field.attacker_boosts);
  if (field.defender_boosts) Object.assign(def.boosts, field.defender_boosts);
  if (field.defender_hp_percent) def.hp = Math.max(1, Math.round(def.maxhp * field.defender_hp_percent / 100));
  const spread = !!field.spread && (moveData.target === 'allAdjacentFoes' || moveData.target === 'allAdjacent');
  const r = damageRange(battle, att, def, moveData.id, null, spread);
  if (!r) return {move: moveData.name, result: 'no direct damage (status move or variable effect)'};
  if (r.immune) return {move: moveData.name, result: `${def.species.name} is immune`};
  const hp = def.maxhp;
  return {
    move: moveData.name,
    attacker: `${att.species.name} (Atk ${att.storedStats.atk}, SpA ${att.storedStats.spa})`,
    defender: `${def.species.name} (HP ${hp}, Def ${def.storedStats.def}, SpD ${def.storedStats.spd})`,
    damagePercent: `${r.lo.toFixed(1)}–${r.hi.toFixed(1)}%`,
    damageHP: `${Math.floor(r.lo * hp / 100)}–${Math.floor(r.hi * hp / 100)} of ${hp}`,
    koVerdict: r.lo >= 100 ? 'guaranteed OHKO' : r.hi >= 100 ? 'possible OHKO (high rolls)' : r.lo >= 50 ? 'guaranteed 2HKO' : r.hi >= 50 ? 'possible 2HKO' : 'not a 2HKO',
    spreadModifierApplied: r.spread,
    note: 'Non-crit, no Protect. Field effects only as specified.',
  };
}

export {FORMAT_ID};
