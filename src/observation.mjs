// What one player is allowed to know, plus the facts the harness computes for
// them, rendered as one compact text block. Hidden information never leaves
// this file: opponent spreads, natures, exact HP, unrevealed bench picks, and
// the opponent's pending choice are never read into the output.
import {dex, toID} from './showdown.mjs';
import {statRange} from './dex-tools.mjs';
import {damageRange, effectiveSpeed, effectiveSpeedRange} from './calc.mjs';
import {describeLines} from './game.mjs';

const STAT_SHORT = {atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva'};
const STATUS_NAME = {brn: 'burned', par: 'paralyzed', slp: 'asleep', frz: 'frozen', psn: 'poisoned', tox: 'badly poisoned'};
const HIDDEN_VOLATILES = new Set(['stall']);
const FIELD_NAMES = {trickroom: 'Trick Room (slower Pokémon move first within a priority bracket)', gravity: 'Gravity', wonderroom: 'Wonder Room', magicroom: 'Magic Room', fairylock: 'Fairy Lock'};
const TARGETED = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

const pct = n => `${Math.round(n)}%`;
const r1 = n => (Math.round(n * 10) / 10).toFixed(n < 10 ? 1 : 0);
const boostText = b => Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${STAT_SHORT[k]} ${v > 0 ? '+' : ''}${v}`).join(', ');
const speciesName = p => (p.illusion ? p.illusion.species.name : p.species.name);

function publicHpPercent(p) {
  if (p.fainted || p.hp <= 0) return 0;
  return Math.max(1, Math.round((p.hp / p.maxhp) * 100));
}

function volatileText(p, mine) {
  const out = [];
  for (const [id, state] of Object.entries(p.volatiles)) {
    if (HIDDEN_VOLATILES.has(id)) continue;
    const name = state.id ? (dex.conditions.get(id).name || id) : id;
    let extra = '';
    if (id === 'choicelock' && state.move) extra = ` → ${dex.moves.get(state.move).name}`;
    if (id === 'encore' && state.move) extra = ` → ${dex.moves.get(state.move).name}`;
    if (id === 'perishsong' && state.duration) extra = ` (${state.duration - 1} turns to faint)`;
    if (id === 'disable' && state.move) extra = ` → ${dex.moves.get(state.move).name}`;
    if (id === 'confusion' && mine) extra = '';
    out.push(`${name}${extra}`);
  }
  if (p.volatiles.stall) {
    const counter = p.volatiles.stall.counter || 3;
    out.push(`used a Protect-type move last turn (another one now succeeds only 1/${counter} of the time)`);
  }
  return out;
}

function protectedTurnsMove(p) { return p.activeTurns; }

function sideConditionsText(side) {
  const out = [];
  for (const [id, state] of Object.entries(side.sideConditions)) {
    const name = dex.conditions.get(id).name || id;
    const turns = state.duration ? ` (${state.duration} turn${state.duration === 1 ? '' : 's'} left incl. this one)` : state.layers ? ` ×${state.layers}` : '';
    out.push(`${name}${turns}`);
  }
  return out;
}

function fieldText(battle) {
  const out = [];
  const f = battle.field;
  if (f.weather) out.push(`${dex.conditions.get(f.weather).name}${f.weatherState.duration ? ` (${f.weatherState.duration} turns left incl. this one)` : ''}`);
  if (f.terrain) out.push(`${dex.conditions.get(f.terrain).name}${f.terrainState.duration ? ` (${f.terrainState.duration} turns left incl. this one)` : ''}`);
  for (const [id, state] of Object.entries(f.pseudoWeather)) {
    out.push(`${FIELD_NAMES[id] || dex.conditions.get(id).name || id}${state.duration ? ` — ${state.duration} turn${state.duration === 1 ? '' : 's'} left incl. this one` : ''}`);
  }
  return out;
}

function priorityOf(p, moveId) {
  const move = dex.moves.get(moveId);
  let pr = move.priority;
  const ability = toID(p.ability);
  if (ability === 'prankster' && move.category === 'Status') pr += 1;
  if (ability === 'galewings' && move.type === 'Flying' && p.hp === p.maxhp) pr += 1;
  if (ability === 'triage' && move.flags?.heal) pr += 3;
  if (move.id === 'grassyglide' && p.battle.field.isTerrain('grassyterrain')) pr += 1;
  return pr;
}

// ---------------------------------------------------------------- facts
function speedFacts(battle, mine, theirs) {
  const tr = !!battle.field.pseudoWeather.trickroom;
  const rows = [];
  const all = [];
  for (const p of mine) all.push({label: `your ${speciesName(p)}`, lo: effectiveSpeed(p), hi: effectiveSpeed(p), exact: true});
  for (const p of theirs) {
    const [lo, hi] = effectiveSpeedRange(p);
    all.push({label: `their ${speciesName(p)}`, lo, hi, exact: false});
  }
  all.sort((a, b) => tr ? a.hi - b.hi : b.lo - a.lo);
  rows.push(`Effective Speed now (boosts, paralysis, Tailwind, items, abilities applied; opponent = range over every legal spread): ${all.map(x => `${x.label} ${x.exact ? x.lo : `${x.lo}–${x.hi}`}`).join(' · ')}`);
  for (const m of mine) {
    const s = effectiveSpeed(m);
    for (const t of theirs) {
      const [lo, hi] = effectiveSpeedRange(t);
      let verdict;
      if (s > hi) verdict = tr ? `they move first (Trick Room)` : `you move first`;
      else if (s < lo) verdict = tr ? `you move first (Trick Room)` : `they move first`;
      else verdict = `UNCERTAIN — depends on their hidden spread (their range ${lo}–${hi} contains your ${s})`;
      rows.push(`your ${speciesName(m)} vs their ${speciesName(t)}: ${verdict}`);
    }
  }
  return rows;
}

function priorityFacts(mine, theirs, oppSheetBySpecies) {
  const rows = [];
  for (const p of mine) {
    for (const slot of p.moveSlots) {
      const pr = priorityOf(p, slot.id);
      if (pr) rows.push(`your ${speciesName(p)}: ${slot.move} (priority ${pr > 0 ? '+' : ''}${pr})`);
    }
  }
  for (const p of theirs) {
    const sheet = oppSheetBySpecies(p);
    for (const m of sheet?.moves || []) {
      const pr = priorityOf(p, toID(m));
      if (pr) rows.push(`their ${speciesName(p)}: ${m} (priority ${pr > 0 ? '+' : ''}${pr})`);
    }
  }
  return rows;
}

function koTag(range, hpPct, defender) {
  if (!range) return '';
  const sash = defender && hpPct >= 100 && (toID(defender.item) === 'focussash' || toID(defender.ability) === 'sturdy') && !defender.volatiles?.substitute;
  if (sash && range.hi >= hpPct) return ` → enough to KO, but ${toID(defender.item) === 'focussash' ? 'Focus Sash' : 'Sturdy'} leaves it at 1 HP from full`;
  if (range.lo >= hpPct) return ' → KOs from current HP';
  if (range.hi >= hpPct) return ' → can KO from current HP (high rolls/weak spread)';
  if (range.lo * 2 >= hpPct) return ' → 2 hits KO';
  return '';
}

function damageFacts(battle, mine, theirs, oppSheetBySpecies) {
  const ours = [];
  for (const a of mine) {
    for (const slot of a.moveSlots) {
      const move = dex.moves.get(slot.id);
      if (move.category === 'Status') continue;
      const parts = [];
      for (const d of theirs) {
        const r = damageRange(battle, a, d, slot.id, 'defender');
        if (!r) continue;
        if (r.immune) { parts.push(`${speciesName(d)} immune`); continue; }
        parts.push(`${speciesName(d)} [${publicHpPercent(d)}%] ${r1(r.lo)}–${r1(r.hi)}%${koTag(r, publicHpPercent(d), d)}`);
      }
      if (move.target === 'allAdjacent') {
        const ally = a.side.active.find(p => p && p !== a && !p.fainted);
        if (ally) {
          const r = damageRange(battle, a, ally, slot.id, null);
          if (r && !r.immune) parts.push(`ALSO your ${speciesName(ally)} ${r1(r.lo)}–${r1(r.hi)}%`);
          else if (r?.immune) parts.push(`your ${speciesName(ally)} immune`);
        }
      }
      if (parts.length) ours.push(`your ${speciesName(a)} ${move.name}${isSpreadTag(move)}: ${parts.join(' | ')}`);
    }
  }
  const theirsOut = [];
  for (const a of theirs) {
    const sheet = oppSheetBySpecies(a);
    for (const name of sheet?.moves || []) {
      const move = dex.moves.get(name);
      if (move.category === 'Status') continue;
      const parts = [];
      for (const d of mine) {
        const r = damageRange(battle, a, d, move.id, 'attacker');
        if (!r) continue;
        if (r.immune) { parts.push(`${speciesName(d)} immune`); continue; }
        const hpNow = (d.hp / d.maxhp) * 100;
        parts.push(`${speciesName(d)} [${Math.round(hpNow)}%] ${r1(r.lo)}–${r1(r.hi)}%${koTag(r, hpNow, d)}`);
      }
      if (parts.length) theirsOut.push(`their ${speciesName(a)} ${move.name}${isSpreadTag(move)}: ${parts.join(' | ')}`);
    }
  }
  return {ours, theirs: theirsOut};
}
const isSpreadTag = m => m.target === 'allAdjacentFoes' ? ' (spread)' : m.target === 'allAdjacent' ? ' (spread, hits ally too)' : '';

// ---------------------------------------------------------------- legal options
export function legalOptions(game, sideId) {
  const req = game.request(sideId);
  if (!req) return null;
  if (req.teamPreview) {
    return {kind: 'preview', pick: req.maxChosenTeamSize || 4, team: req.side.pokemon.map(p => p.details.split(',')[0])};
  }
  const side = game.side(sideId);
  const switchable = req.side.pokemon
    .map((p, i) => ({index: i + 1, species: p.details.split(',')[0], active: p.active, fainted: p.condition.endsWith(' fnt') || p.condition.startsWith('0')}))
    .filter(p => !p.active && !p.fainted);
  if (req.forceSwitch) {
    return {
      kind: 'switch',
      slots: req.forceSwitch.map((must, i) => ({
        slot: i + 1,
        species: side.active[i] ? speciesName(side.active[i]) : null,
        mustSwitch: !!must,
        switches: must ? switchable : [],
      })),
    };
  }
  return {
    kind: 'move',
    slots: (req.active || []).map((a, i) => {
      const poke = side.active[i];
      if (!poke || poke.fainted) return {slot: i + 1, species: poke ? speciesName(poke) : null, fainted: true};
      return {
        slot: i + 1,
        species: speciesName(poke),
        moves: a.moves.filter(m => !m.disabled).map(m => ({name: m.move, id: m.id, target: m.target, pp: m.pp, maxpp: m.maxpp, needsTarget: TARGETED.has(m.target)})),
        canMega: !!a.canMegaEvo,
        trapped: !!(a.trapped || a.maybeTrapped),
        switches: a.trapped ? [] : switchable,
      };
    }),
  };
}

// Model-facing action objects → one Showdown choice string.
export function toShowdownChoice(game, sideId, options, actions) {
  if (!Array.isArray(actions)) return {error: '`actions` must be an array, one entry per active slot.'};
  if (options.kind === 'preview') return {error: 'Use preview_submit during team preview.'};
  const side = game.side(sideId);
  const bySlot = new Map();
  for (const a of actions) {
    const slot = Number(a?.slot);
    if (!slot || bySlot.has(slot)) return {error: `Each action needs a unique "slot" (1 or 2). Got ${JSON.stringify(a)}.`};
    bySlot.set(slot, a);
  }
  const parts = [];
  const usedSwitch = new Set();
  let megaCount = 0;
  // With fewer healthy Pokémon than empty slots, only that many switches are owed.
  const must = options.kind === 'switch' ? options.slots.filter(s => s.mustSwitch) : [];
  const benchCount = new Set(must.flatMap(s => s.switches.map(x => x.index))).size;
  const owed = Math.min(must.length, benchCount);
  const given = must.filter(s => bySlot.get(s.slot)?.switch).length;
  for (const s of options.slots) {
    const a = bySlot.get(s.slot);
    if (options.kind === 'switch') {
      if (!s.mustSwitch) { parts.push('pass'); continue; }
      if (!a?.switch && given >= owed) { parts.push('pass'); continue; }
      if (!a?.switch) return {error: `Slot ${s.slot} must switch: give {"slot": ${s.slot}, "switch": "<species>"}. Options: ${s.switches.map(x => x.species).join(', ')}.`};
      const target = s.switches.find(x => toID(x.species) === toID(a.switch) || String(x.index) === String(a.switch));
      if (!target) return {error: `Slot ${s.slot} cannot switch to "${a.switch}". Options: ${s.switches.map(x => x.species).join(', ')}.`};
      if (usedSwitch.has(target.index)) return {error: `Both slots cannot switch to ${target.species}.`};
      usedSwitch.add(target.index);
      parts.push(`switch ${target.index}`);
      continue;
    }
    if (s.fainted) { parts.push('pass'); continue; }
    if (!a) return {error: `Missing action for slot ${s.slot} (${s.species}).`};
    if (a.switch) {
      if (!s.switches.length) return {error: `Slot ${s.slot} (${s.species}) cannot switch${s.trapped ? ' (trapped)' : ' (no healthy bench)'}.`};
      const target = s.switches.find(x => toID(x.species) === toID(a.switch) || String(x.index) === String(a.switch));
      if (!target) return {error: `Slot ${s.slot} cannot switch to "${a.switch}". Options: ${s.switches.map(x => x.species).join(', ')}.`};
      if (usedSwitch.has(target.index)) return {error: `Both slots cannot switch to ${target.species}.`};
      usedSwitch.add(target.index);
      parts.push(`switch ${target.index}`);
      continue;
    }
    if (!a.move) return {error: `Slot ${s.slot} needs "move" or "switch".`};
    const idx = s.moves.findIndex(m => m.id === toID(a.move));
    if (idx < 0) return {error: `Slot ${s.slot} (${s.species}) cannot use "${a.move}" now. Usable: ${s.moves.map(m => m.name).join(', ')}.`};
    const m = s.moves[idx];
    const realIndex = game.request(sideId).active[s.slot - 1].moves.findIndex(x => x.id === m.id) + 1;
    let choice = `move ${realIndex}`;
    if (m.needsTarget) {
      const loc = resolveTarget(game, sideId, s.slot, m, a.target);
      if (loc.error) return {error: `Slot ${s.slot} ${m.name}: ${loc.error}`};
      choice += ` ${loc.loc}`;
    }
    if (a.mega) {
      if (!s.canMega) return {error: `Slot ${s.slot} (${s.species}) cannot Mega Evolve.`};
      megaCount++;
      choice += ' mega';
    }
    parts.push(choice);
  }
  if (megaCount > 1) return {error: 'Only one Pokémon can Mega Evolve per battle.'};
  return {choice: parts.join(', ')};
}

function resolveTarget(game, sideId, slot, move, target) {
  const side = game.side(sideId);
  const foes = side.foe.active;
  const allyPos = slot === 1 ? 2 : 1;
  const liveFoes = [1, 2].filter(i => foes[i - 1] && !foes[i - 1].fainted);
  const t = target === undefined || target === null ? '' : String(target).toLowerCase().trim();
  if (move.target === 'adjacentAlly') {
    if (!t || t === 'ally') return {loc: -allyPos};
    return {error: 'only targets your ally ("ally").'};
  }
  if (move.target === 'adjacentAllyOrSelf') {
    if (t === 'self' || !t) return {loc: -slot};
    if (t === 'ally') return {loc: -allyPos};
    return {error: 'target "self" or "ally".'};
  }
  if (!t) {
    if (liveFoes.length === 1) return {loc: liveFoes[0]};
    return {error: `needs a target: "foe1" (${foes[0] ? speciesName(foes[0]) : 'empty'}), "foe2" (${foes[1] ? speciesName(foes[1]) : 'empty'})${move.target !== 'adjacentFoe' ? ', or "ally"' : ''}.`};
  }
  if (t === 'foe1' || t === '1') return {loc: 1};
  if (t === 'foe2' || t === '2') return {loc: 2};
  if (t === 'ally' && move.target !== 'adjacentFoe') return {loc: -allyPos};
  const byName = [1, 2].find(i => foes[i - 1] && toID(speciesName(foes[i - 1])) === toID(t));
  if (byName) return {loc: byName};
  return {error: `unknown target "${target}". Use "foe1", "foe2"${move.target !== 'adjacentFoe' ? ', or "ally"' : ''}.`};
}

// ---------------------------------------------------------------- rendering
export function decisionDepth(ctx) {
  if (ctx.kind === 'switch') return 'switch';
  if (ctx.kind === 'preview') return 'preview';
  if (ctx.turn <= 1) return 'full';
  if (ctx.sinceLast?.some(l => /^\|(faint|switch|drag|-mega|-fieldstart|-fieldend|-weather\|(?!.*\[upkeep\]))/.test(l))) return 'full';
  return 'light';
}

export const RESPONSE_SPECS = {
  full: `turn_submit fields — FULL analysis this turn (a Pokémon fainted/switched, the field changed, or it's turn 1):
  threats: the 1–2 biggest dangers to you right now and why (sweeper set-ups, speed control, spread damage, status) — 1–2 sentences
  win_condition: how you win from here and what you must preserve — 1 sentence
  predictions: [{foe:"foe1", action:"<move or 'switch'>", confidence:0–1}, {foe:"foe2", ...}]
  actions: [{slot:1, move:"<move>", target:"foe1|foe2|ally"?, mega:true?} | {slot:1, switch:"<species>"}, {slot:2, ...}]
  reason: why this beats their likely play — 1–2 sentences
  risk: what punishes this and what would make you change it — 1 sentence
  plan: "on track", or your revised game plan in ≤2 sentences`,
  light: `turn_submit fields — LIGHT analysis this turn:
  predictions: [{foe:"foe1", action:"<move or 'switch'>", confidence:0–1}, ...]
  actions: [{slot:1, move:"<move>", target:"foe1|foe2|ally"?, mega:true?} | {slot:1, switch:"<species>"}, ...]
  reason: 1 sentence
  plan: "on track", or a revised plan in ≤2 sentences`,
  switch: `turn_submit fields — replacement:
  actions: [{slot:N, switch:"<species>"}] for each slot that must switch
  reason: 1 sentence`,
};

export const REQUIRED_FIELDS = {
  full: ['threats', 'win_condition', 'predictions', 'actions', 'reason', 'risk', 'plan'],
  light: ['predictions', 'actions', 'reason', 'plan'],
  switch: ['actions', 'reason'],
};

export function renderObservation(game, sideId, ctx) {
  const battle = game.battle;
  const me = game.side(sideId);
  const opp = me.foe;
  const options = legalOptions(game, sideId);
  const depth = decisionDepth({kind: options.kind, turn: battle.turn, sinceLast: ctx.sinceLastRaw});
  const sheetBySpecies = p => {
    const base = p.illusion ? p.illusion : p;
    return ctx.oppSheet.find(s => toID(s.species) === toID(base.baseSpecies.baseSpecies) || toID(s.species) === toID(base.baseSpecies.name) || toID(s.species) === toID(base.set.species));
  };
  const mine = me.active.filter(p => p && !p.fainted);
  const theirs = opp.active.filter(p => p && !p.fainted);
  const L = [];
  L.push(`=== ${ctx.header} · Turn ${battle.turn} ===`);
  if (options.kind === 'switch') {
    L.push('DECISION: choose a replacement for your fainted / switching Pokémon.');
  } else {
    L.push(`DECISION: choose actions for your active Pokémon. Analysis depth: ${depth.toUpperCase()}.`);
  }
  if (ctx.gamePlan) L.push(`YOUR GAME PLAN: ${ctx.gamePlan}`);

  // Last turn
  if (ctx.sinceLastText?.length) {
    L.push('', 'SINCE YOUR LAST DECISION:');
    for (const l of ctx.sinceLastText.slice(-40)) L.push(`  ${l}`);
  }
  if (ctx.predictionReview?.length) {
    L.push('', 'YOUR LAST PREDICTIONS vs WHAT HAPPENED:');
    for (const l of ctx.predictionReview) L.push(`  ${l}`);
  }

  // Field
  const field = fieldText(battle);
  const mySide = sideConditionsText(me);
  const theirSide = sideConditionsText(opp);
  L.push('', `FIELD: ${field.length ? field.join(' · ') : 'nothing active'}`);
  if (mySide.length) L.push(`  your side: ${mySide.join(' · ')}`);
  if (theirSide.length) L.push(`  their side: ${theirSide.join(' · ')}`);

  // Our side
  L.push('', 'YOUR ACTIVE:');
  me.active.forEach((p, i) => {
    if (!p || p.fainted) { L.push(`  [slot ${i + 1}] (empty)`); return; }
    const st = p.storedStats;
    const bits = [`HP ${p.hp}/${p.maxhp} (${pct((p.hp / p.maxhp) * 100)})`];
    if (p.status) bits.push(STATUS_NAME[p.status] || p.status);
    const boosts = boostText(p.boosts);
    if (boosts) bits.push(`boosts ${boosts}`);
    bits.push(`item ${p.item ? dex.items.get(p.item).name : '(none)'}`);
    bits.push(`ability ${dex.abilities.get(p.ability).name}`);
    bits.push(`types ${p.getTypes().join('/')}`);
    bits.push(`stats Atk ${st.atk} Def ${st.def} SpA ${st.spa} SpD ${st.spd} Spe ${st.spe}`);
    L.push(`  [slot ${i + 1}] ${speciesName(p)} — ${bits.join(' · ')}`);
    L.push(`      moves: ${p.moveSlots.map(m => `${m.move} ${m.pp}/${m.maxpp}pp${m.disabled ? ' (disabled)' : ''}`).join(' · ')}`);
    const vol = volatileText(p, true);
    if (vol.length) L.push(`      effects: ${vol.join('; ')}`);
    if (p.activeTurns > 0 && p.moveSlots.some(m => m.id === 'fakeout' || m.id === 'firstimpression')) L.push('      note: Fake Out / First Impression only work on its first turn out — they will fail now.');
  });
  const bench = me.pokemon.filter(p => !p.isActive);
  L.push(`YOUR BENCH: ${bench.length ? bench.map(p => p.fainted ? `${p.species.name} (fainted)` : `${p.species.name} ${pct((p.hp / p.maxhp) * 100)}${p.status ? ` ${STATUS_NAME[p.status]}` : ''} @ ${p.item ? dex.items.get(p.item).name : '(none)'}`).join(' · ') : 'none'}`);

  // Opponent
  L.push('', 'OPPONENT ACTIVE (open team sheet + public info; spreads hidden):');
  opp.active.forEach((p, i) => {
    if (!p || p.fainted) { L.push(`  [foe${i + 1}] (empty)`); return; }
    const sheet = sheetBySpecies(p);
    const bits = [`HP ${publicHpPercent(p)}%`];
    if (p.status) bits.push(STATUS_NAME[p.status] || p.status);
    const boosts = boostText(p.boosts);
    if (boosts) bits.push(`boosts ${boosts}`);
    // Under Illusion, show exactly what the opponent's client would show: the disguise.
    const disp = p.illusion || p;
    const itemNow = p.illusion ? (sheet?.item || '?') : p.item ? dex.items.get(p.item).name : '(none — used up or removed)';
    bits.push(`item ${itemNow}`);
    bits.push(`ability ${p.illusion ? sheet?.ability || '?' : dex.abilities.get(p.ability).name}`);
    bits.push(`types ${p.illusion ? disp.species.types.join('/') : p.getTypes().join('/')}`);
    const ranges = ['atk', 'def', 'spa', 'spd', 'spe'].map(s => `${STAT_SHORT[s]} ${statRange(disp.species, s).join('–')}`).join(' ');
    bits.push(`possible stats ${ranges}`);
    L.push(`  [foe${i + 1}] ${speciesName(p)} — ${bits.join(' · ')}`);
    if (sheet) L.push(`      moves (sheet): ${sheet.moves.join(' · ')}`);
    const vol = volatileText(p, false);
    if (vol.length) L.push(`      effects: ${vol.join('; ')}`);
    if (p.activeTurns === 0 && sheet?.moves?.some(m => toID(m) === 'fakeout')) L.push('      note: just came in — Fake Out is live for it this turn.');
  });
  const seen = ctx.oppSeen;
  const oppBench = [...seen].filter(sp => !opp.active.some(p => p && !p.fainted && toID(speciesName(p)) === toID(sp)));
  const oppFainted = opp.pokemon.filter(p => p.fainted).map(p => speciesName(p));
  const unseenCount = 4 - seen.size;
  L.push(`THEIR BROUGHT 4: seen ${[...seen].join(', ') || 'none'}${oppFainted.length ? ` (fainted: ${oppFainted.join(', ')})` : ''}; ${unseenCount > 0 ? `${unseenCount} not yet seen, from: ${ctx.oppSheet.map(s => s.species).filter(sp => ![...seen].some(x => toID(x).startsWith(toID(sp)) || toID(sp).startsWith(toID(x)))).join(', ')}` : 'all four seen'}.`);
  if (oppBench.length) {
    const benchInfo = opp.pokemon.filter(p => !p.isActive && !p.fainted && [...seen].some(x => toID(speciesName(p)).startsWith(toID(x))));
    if (benchInfo.length) L.push(`THEIR BENCH (seen): ${benchInfo.map(p => `${speciesName(p)} ${publicHpPercent(p)}%${p.status ? ` ${STATUS_NAME[p.status]}` : ''}`).join(' · ')}`);
  }
  const myLeft = me.pokemon.filter(p => !p.fainted).length;
  const theirLeft = 4 - opp.pokemon.filter(p => p.fainted).length;
  L.push(`REMAINING: you ${myLeft} · them ${theirLeft}`);

  // Computed facts. If their sheet has an Illusion user, any of their Pokémon
  // could be disguised, so opponent-dependent numbers would leak or mislead.
  const illusionRisk = ctx.oppSheet.some(s => toID(s.ability) === 'illusion');
  if (illusionRisk && theirs.length) {
    L.push('', 'NOTE: their sheet includes an Illusion user, so any of their Pokémon may be a disguise. Opponent speed ranges and damage numbers are withheld; use the calc tool with the sheet if needed.');
  }
  if (mine.length && theirs.length && !illusionRisk) {
    L.push('', 'SPEED (same priority bracket):');
    for (const row of speedFacts(battle, mine, theirs)) L.push(`  ${row}`);
    const pri = priorityFacts(mine, theirs, sheetBySpecies);
    if (pri.length) L.push(`PRIORITY MOVES: ${pri.join(' · ')}`);
    if (options.kind === 'move') {
      const dmg = damageFacts(battle, mine, theirs, sheetBySpecies);
      L.push('', 'DAMAGE (% of target max HP; non-crit; opponent side = range over their possible spreads × rolls; Protect, Helping Hand, Intimidate-to-come not included):');
      for (const row of dmg.ours) L.push(`  ${row}`);
      for (const row of dmg.theirs) L.push(`  ${row}`);
    }
  }

  if (ctx.alerts?.length) {
    L.push('', 'ALERTS:');
    for (const a of ctx.alerts) L.push(`  ! ${a}`);
  }

  // Legal actions
  L.push('', 'LEGAL ACTIONS:');
  if (options.kind === 'switch') {
    const mustSlots = options.slots.filter(s => s.mustSwitch);
    const bench = new Set(mustSlots.flatMap(s => s.switches.map(x => x.index))).size;
    if (bench < mustSlots.length) L.push(`  (only ${bench} healthy Pokémon left: send ${bench === 1 ? 'it into one slot' : 'them'}; the other slot stays empty)`);
  }
  for (const s of options.slots) {
    if (options.kind === 'switch') {
      if (s.mustSwitch) L.push(`  slot ${s.slot}: switch to ${s.switches.map(x => x.species).join(' | ')}`);
      continue;
    }
    if (s.fainted) { L.push(`  slot ${s.slot}: (fainted — no action)`); continue; }
    const moves = s.moves.map(m => `${m.name}${m.needsTarget ? (m.target === 'adjacentAlly' ? ' →ally' : m.target === 'adjacentAllyOrSelf' ? ' →self|ally' : m.target === 'adjacentFoe' ? ' →foe1|foe2' : ' →foe1|foe2|ally') : ''}`);
    L.push(`  slot ${s.slot} ${s.species}: ${moves.join(' · ')}${s.switches.length ? ` · switch: ${s.switches.map(x => x.species).join(' | ')}` : s.trapped ? ' · (trapped)' : ''}${s.canMega ? ' · MEGA available (add "mega": true)' : ''}`);
  }
  L.push('', RESPONSE_SPECS[depth]);
  return {text: L.join('\n'), depth, options};
}
