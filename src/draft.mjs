// The draft board: teambuilding as a procedure. The arena holds the six slots,
// validates every change the moment it is made (with legal alternatives when
// something is wrong), reports facts about the team as it forms, and always
// says what the next step is. The model makes every choice; it never has to
// remember its own team or decode a wall of validator errors at the end.
import {dex, toID, Teams} from './showdown.mjs';
import {isSpeciesLegal, legalMoves, megaFormsOf, computeStats, validateTeam, shortDesc, SP_MAX_PER_STAT, SP_MAX_TOTAL, STATS, STAT_LABEL} from './dex-tools.mjs';

export const RESEARCH_BUDGET = 30;
const SLOTS = 6;
const STAT_ALIASES = {hp: 'hp', atk: 'atk', attack: 'atk', def: 'def', defense: 'def', spa: 'spa', spatk: 'spa', specialattack: 'spa', spd: 'spd', spdef: 'spd', specialdefense: 'spd', spe: 'spe', speed: 'spe'};
const ROLE_MOVES = {
  'speed control': ['Tailwind', 'Trick Room', 'Icy Wind', 'Electroweb', 'Thunder Wave', 'Scary Face', 'Bleakwind Storm', 'Rock Tomb', 'Glare'],
  'Fake Out': ['Fake Out'],
  redirection: ['Follow Me', 'Rage Powder', 'Ally Switch'],
  'spread attacks': null,
  priority: null,
  Protect: ['Protect', 'Detect', 'Spiky Shield', "King's Shield", 'Baneful Bunker', 'Silk Trap', 'Burning Bulwark'],
};

export function newDraft() {
  return {concept: '', slots: Array.from({length: SLOTS}, () => null), research: 0, edits: 0};
}

const blank = () => ({species: '', item: '', ability: '', nature: '', sp: {}, moves: []});

function suggestSpecies(name) {
  const q = toID(name);
  const all = dex.species.all().filter(s => isSpeciesLegal(s) && !s.battleOnly && !s.isMega && !s.isCosmeticForme);
  return all.filter(s => s.id.includes(q.slice(0, 4)) || q.includes(s.id.slice(0, 5))).slice(0, 6).map(s => s.name);
}

function normSP(sp) {
  const out = {};
  if (!sp || typeof sp !== 'object') return {out, bad: []};
  const bad = [];
  for (const [k, v] of Object.entries(sp)) {
    const key = STAT_ALIASES[toID(k)];
    if (!key) { bad.push(k); continue; }
    out[key] = Math.max(0, Math.round(Number(v) || 0));
  }
  return {out, bad};
}

// Merge a partial change into one slot; return what's wrong with that slot.
export function setSlot(draft, args) {
  const n = Number(args.slot);
  if (!(n >= 1 && n <= SLOTS)) return {error: `slot must be 1–${SLOTS}.`};
  const prev = draft.slots[n - 1] || blank();
  const s = {...prev, sp: {...prev.sp}, moves: [...prev.moves]};
  const notes = [];
  if (args.species !== undefined) {
    const sp = dex.species.get(args.species);
    if (!sp.exists) return {error: `"${args.species}" is not a Pokémon. Similar: ${suggestSpecies(args.species).join(', ') || 'none'}.`};
    if (sp.isMega) return {error: `${sp.name} is a Mega form. Draft ${sp.baseSpecies} and give it ${sp.requiredItem || 'its Mega Stone'}; it Mega Evolves in battle.`};
    if (sp.battleOnly) return {error: `${sp.name} only exists in battle. Draft ${Array.isArray(sp.battleOnly) ? sp.battleOnly[0] : sp.battleOnly}.`};
    if (!isSpeciesLegal(sp)) return {error: `${sp.name} is not legal in this format.`};
    const clash = draft.slots.findIndex((x, i) => x && i !== n - 1 && toID(dex.species.get(x.species).baseSpecies) === toID(sp.baseSpecies));
    if (clash >= 0) return {error: `Species clause: ${draft.slots[clash].species} is already in slot ${clash + 1}.`};
    if (toID(prev.species) !== sp.id) {
      // A new species resets everything that depended on the old one.
      Object.assign(s, blank(), {species: sp.name});
      if (prev.species) notes.push(`slot ${n} reset for ${sp.name}`);
      const abilities = Object.values(sp.abilities).filter(Boolean);
      if (abilities.length === 1) s.ability = abilities[0];
    }
  }
  if (!s.species) return {error: `Choose a species for slot ${n} first (species: "…").`};
  const species = dex.species.get(s.species);
  if (args.ability !== undefined) {
    const abilities = Object.values(species.abilities).filter(Boolean);
    const hit = abilities.find(a => toID(a) === toID(args.ability));
    if (!hit) return {error: `${species.name} can't have ${args.ability}. Legal abilities: ${abilities.map(a => `${a} (${shortDesc(dex.abilities.get(a))})`).join('; ')}.`};
    s.ability = hit;
  }
  if (args.item !== undefined) {
    if (!args.item || toID(args.item) === 'none') s.item = '';
    else {
      const it = dex.items.get(args.item);
      if (!it.exists || it.isNonstandard) {
        const q = toID(args.item);
        const near = dex.items.all().filter(i => !i.isNonstandard && (i.id.includes(q.slice(0, 4)) || toID(shortDesc(i)).includes(q.slice(0, 5)))).slice(0, 6).map(i => i.name);
        return {error: `"${args.item}" is not a legal item here. Similar: ${near.join(', ') || 'none'}. search_items lists everything legal.`};
      }
      const clash = draft.slots.findIndex((x, i) => x && i !== n - 1 && toID(x.item) === it.id);
      if (clash >= 0) return {error: `Item clause: ${it.name} is already held by ${draft.slots[clash].species} (slot ${clash + 1}).`};
      if (it.megaStone && !it.megaStone[species.name] && !Object.keys(it.megaStone).some(k => toID(dex.species.get(k).baseSpecies) === species.id)) {
        return {error: `${it.name} is ${Object.keys(it.megaStone).join('/')}'s Mega Stone, not ${species.name}'s.${megaFormsOf(species).length ? ` ${species.name}'s: ${megaFormsOf(species).map(m => m.requiredItem).join(', ')}.` : ''}`};
      }
      s.item = it.name;
    }
  }
  if (args.nature !== undefined) {
    const nat = dex.natures.get(args.nature);
    if (!nat.exists) return {error: `"${args.nature}" is not a nature.`};
    s.nature = nat.name;
  }
  if (args.sp !== undefined) {
    const {out, bad} = normSP(args.sp);
    if (bad.length) return {error: `Unknown stat name(s) ${bad.join(', ')}. Use hp, atk, def, spa, spd, spe.`};
    const over = Object.entries(out).filter(([, v]) => v > SP_MAX_PER_STAT);
    if (over.length) return {error: `At most ${SP_MAX_PER_STAT} stat points per stat (${over.map(([k, v]) => `${STAT_LABEL[k]} ${v}`).join(', ')}).`};
    const total = Object.values(out).reduce((a, b) => a + b, 0);
    if (total > SP_MAX_TOTAL) return {error: `That's ${total} stat points; the limit is ${SP_MAX_TOTAL} in total.`};
    s.sp = out;
  }
  if (args.moves !== undefined) {
    const list = (Array.isArray(args.moves) ? args.moves : [args.moves]).filter(Boolean);
    if (list.length > 4) return {error: 'At most 4 moves.'};
    const legal = legalMoves(species);
    const out = [];
    for (const m of list) {
      const mv = dex.moves.get(m);
      if (!mv.exists) return {error: `"${m}" is not a move.`};
      if (!legal.some(x => x.id === mv.id)) {
        const same = legal.filter(x => x.type === mv.type && x.category === mv.category).map(x => x.name);
        return {error: `${species.name} can't learn ${mv.name} in Champions. Legal ${mv.type} ${mv.category.toLowerCase()} moves: ${same.slice(0, 10).join(', ') || 'none'}.`};
      }
      if (out.includes(mv.name)) return {error: `${mv.name} is listed twice.`};
      out.push(mv.name);
    }
    s.moves = out;
  }
  draft.slots[n - 1] = s;
  draft.edits++;
  return {ok: true, notes};
}

export function clearSlot(draft, slot) {
  const n = Number(slot);
  if (!(n >= 1 && n <= SLOTS)) return {error: `slot must be 1–${SLOTS}.`};
  draft.slots[n - 1] = null;
  return {ok: true};
}

function slotMissing(s) {
  const miss = [];
  if (!s.ability) miss.push('ability');
  if (!s.item) miss.push('item');
  if (!s.nature) miss.push('nature');
  const used = Object.values(s.sp).reduce((a, b) => a + b, 0);
  if (used < SP_MAX_TOTAL) miss.push(`stat points (${used}/${SP_MAX_TOTAL} used)`);
  if (s.moves.length < 4) miss.push(`${4 - s.moves.length} move${s.moves.length === 3 ? '' : 's'}`);
  return miss;
}

function toSet(s) {
  return {species: s.species, name: '', item: s.item, ability: s.ability, nature: s.nature || 'Serious', evs: Object.fromEntries(STATS.map(k => [k, s.sp[k] || 0])), ivs: Object.fromEntries(STATS.map(k => [k, 31])), moves: s.moves, level: 50, gender: ''};
}

export function draftExport(draft) {
  return Teams.export(draft.slots.filter(Boolean).map(toSet));
}

// Facts, not advice: what the team covers and where it is exposed.
function report(draft) {
  const filled = draft.slots.filter(Boolean);
  if (!filled.length) return [];
  const L = [];
  const mons = filled.map(s => ({s, sp: dex.species.get(s.species)}));
  L.push(`Types: ${mons.map(({sp}) => `${sp.name} ${sp.types.join('/')}`).join(' · ')}`);
  const weak = [], open = [];
  for (const type of dex.types.names().filter(t => t !== 'Stellar')) {
    const w = [], r = [];
    for (const {s, sp} of mons) {
      const immune = !dex.getImmunity(type, sp.types) || (type === 'Ground' && toID(s.ability) === 'levitate');
      const eff = immune ? -9 : dex.getEffectiveness(type, sp.types);
      if (eff > 0) w.push(sp.name); else if (eff < 0) r.push(sp.name);
    }
    if (w.length >= 2) weak.push(`${type} ×${w.length} (${w.join(', ')})${r.length ? '' : ' — nothing resists'}`);
    else if (w.length && !r.length && mons.length >= 4) open.push(type);
  }
  if (weak.length) L.push(`Shared weaknesses: ${weak.join(' · ')}`);
  if (open.length) L.push(`Also unresisted: ${open.join(', ')}`);
  const speeds = mons.map(({s, sp}) => {
    const st = s.nature || Object.keys(s.sp).length ? computeStats(toSet(s)).spe : null;
    return `${sp.name} ${st ?? `base ${sp.baseStats.spe}`}`;
  });
  L.push(`Speed: ${speeds.join(' · ')}`);
  const roles = [];
  for (const [role, list] of Object.entries(ROLE_MOVES)) {
    let who;
    if (role === 'spread attacks') who = filled.filter(s => s.moves.some(m => ['allAdjacentFoes', 'allAdjacent'].includes(dex.moves.get(m).target) && dex.moves.get(m).category !== 'Status'));
    else if (role === 'priority') who = filled.filter(s => s.moves.some(m => dex.moves.get(m).priority > 0 && dex.moves.get(m).category !== 'Status'));
    else who = filled.filter(s => s.moves.some(m => list.includes(dex.moves.get(m).name)));
    roles.push(role === 'Protect' ? `Protect on ${who.length}/${filled.length}` : `${role}: ${who.map(x => x.species).join(', ') || 'none'}`);
  }
  const intim = filled.filter(s => toID(s.ability) === 'intimidate').map(s => s.species);
  roles.push(`Intimidate: ${intim.join(', ') || 'none'}`);
  L.push(`Roles: ${roles.join(' · ')}`);
  const megas = filled.filter(s => s.item && dex.items.get(s.item).megaStone).map(s => `${s.species} (${s.item})`);
  if (megas.length) L.push(`Mega Stones: ${megas.join(', ')} — only one Pokémon can Mega Evolve per battle.`);
  return L;
}

export function nextStep(draft) {
  const filled = draft.slots.map((s, i) => [s, i + 1]).filter(([s]) => s);
  const empty = draft.slots.map((s, i) => (s ? null : i + 1)).filter(Boolean);
  if (!draft.concept) return 'Step 1 · CONCEPT — call draft_concept with your archetype, speed mode and win condition (2–3 sentences).';
  if (filled.length < 3) return `Step 2 · CORE — choose your 2–3 core Pokémon: draft_set({slot: ${empty[0]}, species: "…"}). Research with pokemon / search_pokemon as needed.`;
  if (empty.length) return `Step 3 · FILL — choose species for slot${empty.length > 1 ? 's' : ''} ${empty.join(', ')}. Check the team report for missing roles and shared weaknesses.`;
  const incomplete = filled.find(([s]) => slotMissing(s).length);
  if (incomplete) return `Step 4 · SETS — finish slot ${incomplete[1]} (${incomplete[0].species}): ${slotMissing(incomplete[0]).join(', ')}. One draft_set call can set item, ability, nature, sp and moves together.`;
  return 'Step 5 · LOCK — every slot is complete. Call team_lock with your team_plan (2–4 sentences).';
}

export function boardText(draft, {lockProblems} = {}) {
  const L = ['DRAFT BOARD — the arena keeps this for you; it is restated after every call.'];
  L.push(`Concept: ${draft.concept || '(not set)'}`);
  draft.slots.forEach((s, i) => {
    if (!s) { L.push(`  ${i + 1} ·  (empty)`); return; }
    const miss = slotMissing(s);
    const spTxt = Object.keys(s.sp).length ? STATS.filter(k => s.sp[k]).map(k => `${s.sp[k]} ${STAT_LABEL[k]}`).join(' / ') : '—';
    const st = computeStats(toSet(s));
    L.push(`  ${i + 1} ${miss.length ? '…' : '✓'} ${s.species} @ ${s.item || '—'} · ${s.ability || '—'} · ${s.nature || '—'} · SP ${spTxt} · ${s.moves.join(', ') || 'no moves'}`);
    L.push(`      stats ${STATS.map(k => `${STAT_LABEL[k]} ${st[k]}`).join(' ')}${miss.length ? ` · missing: ${miss.join(', ')}` : ''}`);
  });
  const rep = report(draft);
  if (rep.length) L.push('', 'TEAM REPORT', ...rep.map(x => `  ${x}`));
  if (lockProblems?.length) L.push('', 'LOCK REJECTED — fix these:', ...lockProblems.map(p => `  - ${p}`));
  L.push('', `NEXT → ${nextStep(draft)}`);
  L.push(`Research used: ${draft.research} of ~${RESEARCH_BUDGET} suggested lookups.${draft.researched?.length ? ` Already looked up: ${draft.researched.join(', ')} (no need to repeat).` : ''}`);
  return L.join('\n');
}

export function lockCheck(draft) {
  const filled = draft.slots.filter(Boolean);
  if (filled.length < SLOTS) return {ok: false, problems: [`Only ${filled.length} of 6 slots are filled.`]};
  const v = validateTeam({team: draftExport(draft)});
  return {ok: v.ok, problems: v.problems, sets: v.sets};
}

export function boardSummary(draft) {
  return draft.slots.map(s => (s ? {species: s.species, item: s.item, ability: s.ability, moves: s.moves, complete: !slotMissing(s).length} : null));
}
