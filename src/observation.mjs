// What one player is allowed to know, plus the facts the harness computes for
// them, rendered as one compact text block. Hidden information never leaves
// this file: opponent spreads, natures, exact HP, unrevealed bench picks, and
// the opponent's pending choice are never read into the output.
import {dex, toID} from './showdown.mjs';
import {statRange} from './dex-tools.mjs';
import {damageRange, effectiveSpeed, effectiveSpeedRange, megaPreview} from './calc.mjs';
import {describeLines} from './game.mjs';
import {thinkText} from './briefing.mjs';

const STAT_SHORT = {atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva'};
const STATUS_NAME = {brn: 'burned', par: 'paralyzed', slp: 'asleep', frz: 'frozen', psn: 'poisoned', tox: 'badly poisoned'};
const HIDDEN_VOLATILES = new Set(['stall']);
const FIELD_NAMES = {trickroom: 'Trick Room (slower Pokémon move first within a priority bracket)', gravity: 'Gravity', wonderroom: 'Wonder Room', magicroom: 'Magic Room', fairylock: 'Fairy Lock'};
const TARGETED = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

const pct = n => `${Math.round(n)}%`;
const r1 = n => (Math.round(n * 10) / 10).toFixed(n < 10 ? 1 : 0);
const boostText = b => Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${STAT_SHORT[k]} ${v > 0 ? '+' : ''}${v}`).join(', ');
const speciesName = p => (p.illusion ? p.illusion.species.name : p.species.name);

// Status as a player sees it, with the counters they can keep from the log.
function statusText(p) {
  if (!p.status) return '';
  const st = p.statusState || {};
  if (p.status === 'slp' && st.startTime) return `asleep (${Math.max(0, st.startTime - st.time)} turn${st.startTime - st.time === 1 ? '' : 's'} so far)`;
  if (p.status === 'tox' && st.stage) return `badly poisoned (next tick ${Math.min(15, st.stage + 1)}/16)`;
  return STATUS_NAME[p.status] || p.status;
}

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
  if (f.weather) out.push(`${weatherName(f.weather)}${f.weatherState.duration ? ` (${f.weatherState.duration} turns left incl. this one)` : ''}`);
  if (f.terrain) out.push(`${dex.conditions.get(f.terrain).name}${f.terrainState.duration ? ` (${f.terrainState.duration} turns left incl. this one)` : ''}`);
  for (const [id, state] of Object.entries(f.pseudoWeather)) {
    out.push(`${FIELD_NAMES[id] || dex.conditions.get(id).name || id}${state.duration ? ` — ${state.duration} turn${state.duration === 1 ? '' : 's'} left incl. this one` : ''}`);
  }
  return out;
}

const WEATHER = {sunnyday: 'Sun', desolateland: 'Harsh Sun', raindance: 'Rain', primordialsea: 'Heavy Rain', sandstorm: 'Sandstorm', snowscape: 'Snow', snow: 'Snow', deltastream: 'Strong Winds'};
const weatherName = id => WEATHER[id] || dex.conditions.get(id).name;

export function priorityOf(p, moveId) {
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
function speedFacts(battle, mine, theirs, known = {}) {
  const tr = !!battle.field.pseudoWeather.trickroom;
  const rows = [];
  const all = [];
  const range = t => effectiveSpeedRange(t, known[toID(t.species.name)]);
  const narrowed = t => {
    const b = known[toID(t.species.name)];
    if (!b) return '';
    const [lo, hi] = statRange(t.species, 'spe');
    const parts = [b.lo > lo ? `≥${b.lo}` : '', b.hi < hi ? `≤${b.hi}` : ''].filter(Boolean);
    return parts.length ? ` (stored Speed ${parts.join(' ')} from move order)` : '';
  };
  for (const p of mine) all.push({label: `your ${speciesName(p)}`, lo: effectiveSpeed(p), hi: effectiveSpeed(p), exact: true});
  for (const p of theirs) {
    const [lo, hi] = range(p);
    all.push({label: `their ${speciesName(p)}`, lo, hi, exact: lo === hi, note: narrowed(p)});
  }
  all.sort((a, b) => tr ? a.hi - b.hi : b.lo - a.lo);
  rows.push(`Effective Speed now (all modifiers; opponent = range over legal spreads, narrowed by move order seen): ${all.map(x => `${x.label} ${x.lo === x.hi ? x.lo : `${x.lo}–${x.hi}`}${x.note || ''}`).join(' · ')}`);
  for (const m of mine) {
    const s = effectiveSpeed(m);
    for (const t of theirs) {
      const [lo, hi] = range(t);
      let verdict;
      if (s > hi) verdict = tr ? `they move first (Trick Room)` : `you move first`;
      else if (s < lo) verdict = tr ? `you move first (Trick Room)` : `they move first`;
      else if (lo === hi) verdict = `SPEED TIE (${s}) — random`;
      else verdict = `UNCERTAIN (their ${lo}–${hi} contains your ${s})`;
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
      if (pr && !dex.moves.get(slot.id).stallingMove) rows.push(`your ${speciesName(p)}: ${slot.move} (priority ${pr > 0 ? '+' : ''}${pr})`);
    }
  }
  for (const p of theirs) {
    const sheet = oppSheetBySpecies(p);
    for (const m of sheet?.moves || []) {
      const pr = priorityOf(p, toID(m));
      if (pr && !dex.moves.get(m).stallingMove) rows.push(`their ${speciesName(p)}: ${m} (priority ${pr > 0 ? '+' : ''}${pr})`);
    }
  }
  return rows;
}

function koTag(range, hpPct, defender) {
  if (!range) return '';
  const sash = defender && hpPct >= 100 && (toID(defender.item) === 'focussash' || toID(defender.ability) === 'sturdy') && !defender.volatiles?.substitute;
  if (sash && range.hi >= hpPct) return ` (${toID(defender.item) === 'focussash' ? 'Focus Sash' : 'Sturdy'} survives at 1 HP)`;
  if (range.lo >= hpPct) return ' KO';
  if (range.hi >= hpPct) return ' KO on high rolls';
  if (range.lo * 2 >= hpPct) return ' 2HKO';
  return '';
}

// One line per attacker → target: the two strongest hits, plus immunities.
// Everything else is one calc call away.
function hitsLine(battle, a, d, moveIds, hidden, hpPct) {
  const hits = [];
  const immune = [];
  for (const id of moveIds) {
    const move = dex.moves.get(id);
    if (move.category === 'Status') continue;
    const r = damageRange(battle, a, d, id, hidden);
    if (!r) continue;
    if (r.immune) { immune.push(move.name); continue; }
    hits.push({move, r});
  }
  hits.sort((x, y) => y.r.hi - x.r.hi);
  const parts = hits.slice(0, 2).map(({move, r}) => {
    let ally = '';
    if (move.target === 'allAdjacent') {
      const mate = a.side.active.find(p => p && p !== a && !p.fainted);
      const ar = mate && damageRange(battle, a, mate, move.id, hidden === 'attacker' ? 'attacker' : null);
      if (ar && !ar.immune) ally = `, ally takes ${r1(ar.lo)}–${r1(ar.hi)}%`;
    }
    return `${move.name}${isSpreadTag(move)} ${r1(r.lo)}–${r1(r.hi)}%${koTag(r, hpPct, d)}${ally}`;
  });
  if (immune.length) parts.push(`immune to ${immune.join(', ')}`);
  return parts.join(' · ');
}

// The single strongest hit, for compact matchup rows.
function bestHit(battle, a, d, moveIds, hidden, hpPct) {
  let best = null;
  for (const id of moveIds) {
    const move = dex.moves.get(id);
    if (move.category === 'Status') continue;
    const r = damageRange(battle, a, d, id, hidden);
    if (r && !r.immune && (!best || r.hi > best.r.hi)) best = {move, r};
  }
  return best ? `${best.move.name} ${r1(best.r.lo)}–${r1(best.r.hi)}%${koTag(best.r, hpPct, d)}` : '';
}

function damageFacts(battle, mine, theirs, oppSheetBySpecies) {
  const sheetMoves = p => (oppSheetBySpecies(p)?.moves || []).map(toID);
  const ownMoves = p => p.moveSlots.map(m => m.id);
  const rows = [];
  for (const a of mine) for (const d of theirs) {
    const line = hitsLine(battle, a, d, ownMoves(a), 'defender', publicHpPercent(d));
    if (line) rows.push(`your ${speciesName(a)} → ${speciesName(d)} [${publicHpPercent(d)}%]: ${line}`);
  }
  for (const a of theirs) for (const d of mine) {
    const hp = (d.hp / d.maxhp) * 100;
    const line = hitsLine(battle, a, d, sheetMoves(a), 'attacker', hp);
    if (line) rows.push(`their ${speciesName(a)} → ${speciesName(d)} [${Math.round(hp)}%]: ${line}`);
  }
  // A Mega-capable active, as it would be after Mega Evolving at the start of this turn.
  const mega = [];
  for (const p of [...mine, ...theirs]) {
    const view = megaPreview(battle, p);
    if (!view) continue;
    const own = mine.includes(p);
    const m = view.mon;
    const copy = m.battle;
    const [sLo, sHi] = own ? [effectiveSpeed(m), effectiveSpeed(m)] : effectiveSpeedRange(m);
    const weather = copy.field.weather && copy.field.weather !== battle.field.weather ? `, sets ${weatherName(copy.field.weather)}` : '';
    mega.push(`${own ? 'your' : 'their'} ${m.species.name} (${m.getAbility().name}${weather}; effective Speed ${sLo === sHi ? sLo : `${sLo}–${sHi}`}${own ? `; Atk ${m.storedStats.atk} SpA ${m.storedStats.spa}` : ''}):`);
    for (const d of (own ? theirs : mine).map(view.find).filter(Boolean)) {
      const hp = own ? publicHpPercent(d) : (d.hp / d.maxhp) * 100;
      const out = hitsLine(copy, m, d, own ? ownMoves(m) : sheetMoves(p), own ? 'defender' : 'attacker', hp);
      if (out) mega.push(`    → ${speciesName(d)}: ${out}`);
      const back = hitsLine(copy, d, m, own ? sheetMoves(d) : ownMoves(d), own ? 'attacker' : 'defender', own ? (m.hp / m.maxhp) * 100 : publicHpPercent(m));
      if (back) mega.push(`    ← ${speciesName(d)}: ${back}`);
    }
  }
  return {rows, mega};
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
        pivot: !!(must && side.active[i] && !side.active[i].fainted),
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

// ---------------------------------------------------------------- the menu
// Every legal action for every slot gets a short ID ("1a", "2c"). The text the
// player reads, the JSON schema, and the parser are all built from this one
// menu, so an answer is either an exact ID from it or an error listing them.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function actionMenu(game, sideId, options = legalOptions(game, sideId)) {
  const side = game.side(sideId);
  const foes = side.foe.active;
  const foeLabel = i => `foe${i} ${foes[i - 1] ? speciesName(foes[i - 1]) : ''}`.trim();
  const liveFoes = [1, 2].filter(i => foes[i - 1] && !foes[i - 1].fainted);
  const req = game.request(sideId);
  const slots = [];
  const mustSlots = options.kind === 'switch' ? options.slots.filter(s => s.mustSwitch) : [];
  const shortage = new Set(mustSlots.flatMap(s => s.switches.map(x => x.index))).size < mustSlots.length;
  for (const s of options.slots) {
    if (options.kind === 'switch' ? !s.mustSwitch : s.fainted) continue;
    const opts = [];
    const add = (label, choice, action, group, short) => opts.push({id: `${s.slot}${LETTERS[opts.length]}`, label, choice, action, group, short});
    const allyPos = s.slot === 1 ? 2 : 1;
    const ally = side.active[allyPos - 1];
    const allyLive = ally && !ally.fainted;
    for (const m of s.moves || []) {
      const idx = req.active[s.slot - 1].moves.findIndex(x => x.id === m.id) + 1;
      const base = {slot: s.slot, move: m.name};
      if (!m.needsTarget) {
        const note = m.target === 'allAdjacentFoes' ? ' (both foes)' : m.target === 'allAdjacent' ? ' (both foes + your ally)' : '';
        add(`${m.name}${note}`, `move ${idx}`, base, `${m.name}${note}`, '');
      } else if (m.target === 'adjacentAlly') {
        if (allyLive) add(`${m.name} → ally ${speciesName(ally)}`, `move ${idx} -${allyPos}`, {...base, target: 'ally'}, m.name, 'ally');
      } else if (m.target === 'adjacentAllyOrSelf') {
        add(`${m.name} → self`, `move ${idx} -${s.slot}`, {...base, target: 'self'}, m.name, 'self');
        if (allyLive) add(`${m.name} → ally ${speciesName(ally)}`, `move ${idx} -${allyPos}`, {...base, target: 'ally'}, m.name, 'ally');
      } else {
        for (const i of liveFoes.length ? liveFoes : [1]) add(`${m.name} → ${foeLabel(i)}`, `move ${idx} ${i}`, {...base, target: `foe${i}`}, m.name, `foe${i}`);
        if (m.target !== 'adjacentFoe' && allyLive) add(`${m.name} → ally ${speciesName(ally)}`, `move ${idx} -${allyPos}`, {...base, target: 'ally'}, m.name, 'ally');
      }
    }
    for (const x of s.switches || []) add(`switch → ${x.species}`, `switch ${x.index}`, {slot: s.slot, switch: x.species, index: x.index}, 'switch', x.species);
    if (shortage) add('stay empty', 'pass', {slot: s.slot, pass: true}, 'stay empty', '');
    slots.push({slot: s.slot, species: s.species, trapped: !!s.trapped, canMega: !!s.canMega, options: opts});
  }
  const predict = options.kind === 'move'
    ? liveFoes.map(i => ({foe: `foe${i}`, species: speciesName(foes[i - 1])}))
    : [];
  return {kind: options.kind, slots, megaSlots: slots.filter(s => s.canMega).map(s => s.slot), predict, actingSlots: options.slots.map(s => s.slot)};
}

// The prediction options for a foe: its sheet moves, or "switch".
export function predictionEnum(sheet) {
  return [...(sheet?.moves || []), 'switch'];
}

// {actions: {slot1: id, ...}, mega?: slot} → Showdown choice + readable actions.
export function choiceFromAnswer(menu, answer = {}) {
  const ids = answer.actions;
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) return {error: `actions must be an object like {${menu.slots.map(s => `"slot${s.slot}": "${s.options[0]?.id}"`).join(', ')}}.`};
  const picked = new Map();
  for (const s of menu.slots) {
    const raw = ids[`slot${s.slot}`];
    if (raw === undefined || raw === null || raw === '') return {error: `Missing slot${s.slot} (${s.species}). Options: ${s.options.map(o => o.id).join(', ')}.`};
    const opt = s.options.find(o => o.id === String(raw).trim().toLowerCase());
    if (!opt) return {error: `"${raw}" is not an option for slot${s.slot} (${s.species}). Options: ${s.options.map(o => `${o.id} ${o.label}`).join(' · ')}.`};
    picked.set(s.slot, opt);
  }
  const switches = [...picked.values()].filter(o => o.action.switch).map(o => o.action.index);
  if (new Set(switches).size < switches.length) return {error: 'Both slots cannot switch to the same Pokémon.'};
  const mega = answer.mega === undefined || answer.mega === null || answer.mega === false ? null : Number(answer.mega);
  if (mega !== null) {
    if (!menu.megaSlots.includes(mega)) return {error: menu.megaSlots.length ? `mega must be ${menu.megaSlots.join(' or ')} (or omitted).` : 'No Pokémon can Mega Evolve now; omit mega.'};
    if (!picked.get(mega)?.action.move) return {error: `slot${mega} must use a move to Mega Evolve.`};
  }
  const parts = menu.actingSlots.map(n => {
    const o = picked.get(n);
    if (!o) return 'pass';
    return n === mega ? `${o.choice} mega` : o.choice;
  });
  const actions = [...picked.values()].map(o => ({...o.action, ...(o.action.slot === mega ? {mega: true} : {}), index: undefined}));
  return {choice: parts.join(', '), actions, ids: Object.fromEntries([...picked].map(([n, o]) => [`slot${n}`, o.id]))};
}

// Readable action ({slot, move, target} | {slot, switch}) → its menu ID. For bots and tests.
export function optionFor(menu, action) {
  const s = menu.slots.find(x => x.slot === action.slot);
  const opts = s?.options || [];
  if (action.switch) return opts.find(o => toID(o.action.switch) === toID(action.switch))?.id;
  const same = opts.filter(o => o.action.move && toID(o.action.move) === toID(action.move));
  return (same.find(o => o.action.target === action.target) || same[0])?.id;
}

// JSON schema of a turn answer, from the same menu. Every field is listed as
// required (nullable where optional) so providers can enforce it strictly.
// Predictions come first, so a model commits to its read before its move.
export function turnSchema(menu, sheetFor) {
  const props = {};
  if (menu.predict.length) {
    props.predictions = {type: 'object', additionalProperties: false, required: menu.predict.map(f => f.foe),
      properties: Object.fromEntries(menu.predict.map(f => [f.foe, {type: 'object', additionalProperties: false, required: ['action', 'confidence'],
        properties: {action: {type: 'string', enum: predictionEnum(sheetFor(f.foe)), description: `What ${f.species} does this turn`}, confidence: {type: 'number', description: '0–1'}}}]))};
  }
  Object.assign(props, {
    actions: {type: 'object', properties: Object.fromEntries(menu.slots.map(s => [`slot${s.slot}`, {type: 'string', enum: s.options.map(o => o.id), description: s.species}])),
      required: menu.slots.map(s => `slot${s.slot}`), additionalProperties: false},
  });
  if (menu.megaSlots.length) props.mega = {type: ['integer', 'null'], enum: [...menu.megaSlots, null], description: 'Slot that Mega Evolves this turn, or null'};
  props.reason = {type: ['string', 'null'], description: 'One sentence, optional'};
  return {type: 'object', properties: props, required: Object.keys(props), additionalProperties: false};
}

function menuText(menu, sheetFor) {
  const L = ['', 'YOUR OPTIONS:'];
  for (const s of menu.slots) {
    L.push(`  slot${s.slot} ${s.species}${s.trapped ? ' (trapped)' : ''}${s.canMega ? ' — can Mega Evolve' : ''}:`);
    const groups = [];
    for (const o of s.options) {
      const g = groups.find(x => x.name === o.group) || (groups.push({name: o.group, opts: []}), groups.at(-1));
      g.opts.push(o);
    }
    for (const g of groups) L.push(`    ${g.name}: ${g.opts.map(o => (o.short ? `${o.id} ${o.short}` : o.id)).join(' · ')}`);
  }
  const ex = {};
  if (menu.predict.length) ex.predictions = Object.fromEntries(menu.predict.map(f => [f.foe, {action: predictionEnum(sheetFor(f.foe))[0], confidence: 0.5}]));
  ex.actions = Object.fromEntries(menu.slots.map(s => [`slot${s.slot}`, s.options[0]?.id]));
  if (menu.megaSlots.length) ex.mega = null;
  ex.reason = '…';
  L.push('', `ANSWER with turn_submit: ${JSON.stringify(ex)}`);
  const notes = [];
  if (menu.predict.length) notes.push(`predictions: for each foe, one of its sheet moves or "switch", with your confidence 0–1 (scored against what they chose)`);
  notes.push('actions: one option ID per slot');
  if (menu.megaSlots.length) notes.push(`mega: ${menu.megaSlots.join(' or ')} to Mega Evolve that slot this turn, else null`);
  notes.push('reason: optional, one sentence');
  L.push(`  ${notes.join(' · ')}`);
  return L;
}

export function renderObservation(game, sideId, ctx) {
  const battle = game.battle;
  const me = game.side(sideId);
  const opp = me.foe;
  const options = legalOptions(game, sideId);
  const menu = actionMenu(game, sideId, options);
  const sheetBySpecies = p => {
    const base = p.illusion ? p.illusion : p;
    return ctx.oppSheet.find(s => toID(s.species) === toID(base.baseSpecies.baseSpecies) || toID(s.species) === toID(base.baseSpecies.name) || toID(s.species) === toID(base.set.species));
  };
  const mine = me.active.filter(p => p && !p.fainted);
  const theirs = opp.active.filter(p => p && !p.fainted);
  const L = [];
  L.push(`=== ${ctx.header} · Turn ${battle.turn} ===`);
  if (options.kind === 'switch') {
    const pivot = options.slots.some(s => s.pivot);
    L.push(pivot
      ? `DECISION: mid-turn switch. Your ${options.slots.filter(s => s.pivot).map(s => s.species).join(' and ')} is leaving the field; choose who comes in. The rest of this turn still happens.`
      : 'DECISION: replace your fainted Pokémon. The next turn starts after both sides have sent theirs in.');
  } else {
    L.push('DECISION: choose an action for each of your active Pokémon.');
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
    if (p.status) bits.push(statusText(p));
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
    if (p.activeMoveActions > 0 && p.moveSlots.some(m => m.id === 'fakeout' || m.id === 'firstimpression')) L.push('      note: Fake Out / First Impression only work on its first turn out — they will fail now.');
  });
  const bench = me.pokemon.filter(p => !p.isActive);
  L.push(`YOUR BENCH: ${bench.length ? bench.map(p => p.fainted ? `${p.species.name} (fainted)` : `${p.species.name} ${pct((p.hp / p.maxhp) * 100)}${p.status ? ` ${statusText(p)}` : ''} @ ${p.item ? dex.items.get(p.item).name : '(none)'}`).join(' · ') : 'none'}`);

  // Opponent
  L.push('', 'OPPONENT ACTIVE (open team sheet + public info; spreads hidden):');
  opp.active.forEach((p, i) => {
    if (!p || p.fainted) { L.push(`  [foe${i + 1}] (empty)`); return; }
    const sheet = sheetBySpecies(p);
    const bits = [`HP ${publicHpPercent(p)}%`];
    if (p.status) bits.push(statusText(p));
    const boosts = boostText(p.boosts);
    if (boosts) bits.push(`boosts ${boosts}`);
    // Under Illusion, show exactly what the opponent's client would show: the disguise.
    const disp = p.illusion || p;
    const itemNow = p.illusion ? (sheet?.item || '?') : p.item ? dex.items.get(p.item).name : '(none — used up or removed)';
    bits.push(`item ${itemNow}`);
    bits.push(`ability ${p.illusion ? sheet?.ability || '?' : dex.abilities.get(p.ability).name}`);
    bits.push(`types ${p.illusion ? disp.species.types.join('/') : p.getTypes().join('/')}`);
    const known = ctx.oppSpeedBounds?.[toID(disp.species.name)];
    const ranges = ['atk', 'def', 'spa', 'spd', 'spe'].map(s => {
      let [lo, hi] = statRange(disp.species, s);
      if (s === 'spe' && known && !p.illusion) { lo = Math.max(lo, known.lo); hi = Math.min(hi, known.hi); }
      return `${STAT_SHORT[s]} ${lo === hi ? lo : `${lo}–${hi}`}`;
    }).join(' ');
    bits.push(`possible stats ${ranges}`);
    if (p.lastMove) bits.push(`last used ${p.lastMove.name}`);
    L.push(`  [foe${i + 1}] ${speciesName(p)} — ${bits.join(' · ')}`);
    if (sheet) L.push(`      moves (sheet): ${sheet.moves.join(' · ')}`);
    const vol = volatileText(p, false);
    if (vol.length) L.push(`      effects: ${vol.join('; ')}`);
    if (p.activeMoveActions === 0 && sheet?.moves?.some(m => toID(m) === 'fakeout')) L.push('      note: has not moved since coming in — its Fake Out is live this turn.');
  });
  const seen = ctx.oppSeen;
  const oppBench = [...seen].filter(sp => !opp.active.some(p => p && !p.fainted && toID(speciesName(p)) === toID(sp)));
  const oppFainted = opp.pokemon.filter(p => p.fainted).map(p => speciesName(p));
  const unseenCount = 4 - seen.size;
  L.push(`THEIR BROUGHT 4: seen ${[...seen].join(', ') || 'none'}${oppFainted.length ? ` (fainted: ${oppFainted.join(', ')})` : ''}; ${unseenCount > 0 ? `${unseenCount} not yet seen, from: ${ctx.oppSheet.map(s => s.species).filter(sp => ![...seen].some(x => toID(x).startsWith(toID(sp)) || toID(sp).startsWith(toID(x)))).join(', ')}` : 'all four seen'}.`);
  if (oppBench.length) {
    const benchInfo = opp.pokemon.filter(p => !p.isActive && !p.fainted && [...seen].some(x => toID(speciesName(p)).startsWith(toID(x))));
    if (benchInfo.length) L.push(`THEIR BENCH (seen): ${benchInfo.map(p => `${speciesName(p)} ${publicHpPercent(p)}%${p.status ? ` ${statusText(p)}` : ''}`).join(' · ')}`);
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
    for (const row of speedFacts(battle, mine, theirs, ctx.oppSpeedBounds)) L.push(`  ${row}`);
    const pri = priorityFacts(mine, theirs, sheetBySpecies);
    if (pri.length) L.push(`PRIORITY MOVES: ${pri.join(' · ')}`);
    if (options.kind === 'move') {
      const dmg = damageFacts(battle, mine, theirs, sheetBySpecies);
      L.push('', 'DAMAGE (% of target max HP, two strongest hits per target, non-crit; opponent spreads hidden so their side is a range; anything else: calc):');
      for (const row of dmg.rows) L.push(`  ${row}`);
      if (dmg.mega.length) {
        L.push('IF IT MEGA EVOLVES (happens before moves, Speed included):');
        for (const row of dmg.mega) L.push(`  ${row}`);
      }
    }
  }

  if (ctx.alerts?.length) {
    L.push('', 'ALERTS:');
    for (const a of ctx.alerts) L.push(`  ! ${a}`);
  }

  const foeSheet = foe => { const p = opp.active[foe === 'foe1' ? 0 : 1]; return p ? sheetBySpecies(p) : null; };
  if (options.kind === 'switch' && theirs.length && !illusionRisk) {
    const candidates = me.pokemon.filter(p => !p.isActive && !p.fainted);
    if (candidates.length) {
      L.push('', 'YOUR OPTIONS AGAINST THEIR ACTIVES (best hit each way; Speed vs theirs):');
      for (const c of candidates) {
        const spe = effectiveSpeed(c);
        L.push(`  ${c.species.name} [${pct((c.hp / c.maxhp) * 100)}] Speed ${spe}:`);
        for (const f of theirs) {
          const [lo, hi] = effectiveSpeedRange(f, ctx.oppSpeedBounds?.[toID(f.species.name)]);
          const tr = !!battle.field.pseudoWeather.trickroom;
          const order = spe > hi ? (tr ? 'faster, so moves later under Trick Room' : 'faster') : spe < lo ? (tr ? 'slower, so moves first under Trick Room' : 'slower') : 'speed uncertain';
          const out = bestHit(battle, c, f, c.moveSlots.map(m => m.id), 'defender', publicHpPercent(f));
          const back = bestHit(battle, f, c, (sheetBySpecies(f)?.moves || []).map(toID), 'attacker', (c.hp / c.maxhp) * 100);
          L.push(`    vs ${speciesName(f)} (${order}): deals ${out || 'nothing'} · takes ${back || 'nothing'}`);
        }
      }
    }
  }
  const think = thinkText(options.kind === 'move' ? 'move' : options.slots.some(s => s.pivot) ? 'pivot' : 'replace');
  if (think) L.push('', think);
  if (options.kind === 'switch' && menu.slots.some(s => s.options.some(o => o.action.pass))) L.push('', 'Fewer healthy Pokémon than empty slots: send what you have; a slot may stay empty.');
  L.push(...menuText(menu, foeSheet));
  return {text: L.join('\n'), options, menu, schema: turnSchema(menu, foeSheet)};
}
