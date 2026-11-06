// Teambuilding knowledge tools: everything is answered from the pinned
// simulator's own data for the active format, so "legal" means legal.
import {dex, validator, format, Teams, toID} from './showdown.mjs';

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABEL = {hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'};
export const SP_MAX_PER_STAT = 32;
export const SP_MAX_TOTAL = 66;

// ---------------------------------------------------------------- legality
const speciesLegalCache = new Map();
export function isSpeciesLegal(species) {
  if (speciesLegalCache.has(species.id)) return speciesLegalCache.get(species.id);
  let ok = species.exists && !species.isNonstandard;
  if (ok) {
    try {
      const problems = validator.checkSpecies({species: species.name}, species, species, {});
      ok = !problems || !problems.length;
    } catch { ok = false; }
  }
  speciesLegalCache.set(species.id, ok);
  return ok;
}

function isPickable(species) {
  return isSpeciesLegal(species) && !species.isCosmeticForme && !species.battleOnly && !species.isMega && !species.isPrimal;
}

let pickableList;
export function pickableSpecies() {
  pickableList ||= dex.species.all().filter(isPickable);
  return pickableList;
}

const learnCache = new Map();
export function legalMoves(species) {
  if (learnCache.has(species.id)) return learnCache.get(species.id);
  const pool = dex.species.getMovePool ? [...dex.species.getMovePool(species.id)] : dex.moves.all().map(m => m.id);
  const moves = [];
  for (const id of pool) {
    const move = dex.moves.get(id);
    if (!move.exists || move.isNonstandard || move.isZ || move.isMax) continue;
    let problem;
    try { problem = validator.checkCanLearn(move, species); } catch { problem = 'error'; }
    if (!problem) moves.push(move);
  }
  moves.sort((a, b) => a.name.localeCompare(b.name));
  learnCache.set(species.id, moves);
  return moves;
}

export function megaFormsOf(species) {
  const out = [];
  for (const forme of species.otherFormes || []) {
    const f = dex.species.get(forme);
    if (f.isMega && isSpeciesLegal(f)) out.push(f);
  }
  return out;
}

// Descriptions live in a separate text table in current Showdown builds.
export function shortDesc(effect) { try { const t = dex.text.get(effect); return t.shortDesc || t.desc || ''; } catch { return ''; } }
export function longDesc(effect) { try { const t = dex.text.get(effect); return t.desc || t.shortDesc || ''; } catch { return ''; } }

const legalItemList = () => dex.items.all().filter(i => !i.isNonstandard && i.exists);

// ---------------------------------------------------------------- stats
const tr = (n, bits = 0) => bits ? (n >>> 0) % (2 ** bits) : Math.trunc(n);
// Champions at level 50: HP = base + SP + 75; others = (base + SP + 20) * nature.
export function championsStat(stat, base, sp, natureMult) {
  if (stat === 'hp') return base + sp + 75;
  let v = base + sp + 20;
  if (natureMult > 1) v = tr(tr(v * 110, 16) / 100);
  else if (natureMult < 1) v = tr(tr(v * 90, 16) / 100);
  return v;
}

export function computeStats(set) {
  const species = dex.species.get(set.species);
  const nature = dex.natures.get(set.nature || 'Serious');
  const out = {};
  for (const s of STATS) {
    const mult = nature.plus === s ? 1.1 : nature.minus === s ? 0.9 : 1;
    out[s] = championsStat(s, species.baseStats[s], set.evs?.[s] || 0, mult);
  }
  return out;
}

// What an opponent's stat could be, given only the open team sheet.
export function statRange(species, stat) {
  const base = species.baseStats[stat];
  if (stat === 'hp') return [championsStat('hp', base, 0, 1), championsStat('hp', base, SP_MAX_PER_STAT, 1)];
  return [championsStat(stat, base, 0, 0.9), championsStat(stat, base, SP_MAX_PER_STAT, 1.1)];
}

// ---------------------------------------------------------------- formatting
const statLine = bs => STATS.map(s => bs[s]).join('/');
const bst = bs => STATS.reduce((a, s) => a + bs[s], 0);
const shortMove = m => `${m.name} (${m.type}, ${m.category === 'Status' ? 'status' : `${m.basePower || '—'} ${m.category === 'Physical' ? 'phys' : 'spec'}`}${m.priority ? `, prio ${m.priority > 0 ? '+' : ''}${m.priority}` : ''}${spreadTag(m)})`;
function spreadTag(m) {
  if (m.target === 'allAdjacentFoes') return ', hits both foes';
  if (m.target === 'allAdjacent') return ', hits all adjacent incl. ally';
  return '';
}
const abilityList = sp => Object.values(sp.abilities).filter(Boolean);

function speciesSummary(sp) {
  const megas = megaFormsOf(sp);
  let line = `${sp.name} — ${sp.types.join('/')} — ${statLine(sp.baseStats)} (BST ${bst(sp.baseStats)}) — ${abilityList(sp).join(' / ')}`;
  if (megas.length) line += ` — mega: ${megas.map(m => `${m.name} via ${m.requiredItem || (m.requiredItems || []).join('/')}`).join('; ')}`;
  return line;
}

// ---------------------------------------------------------------- tools
export function rules() {
  return {
    format: format.name,
    formatId: format.id,
    summary: [
      'Doubles. Bring 6 to team preview, pick 4; the first two you pick lead.',
      'Open team sheets: both players see each other\'s species, items, abilities and moves. Stat points (spreads) and natures stay hidden.',
      'Level 50. No IVs (all fixed max). Instead of EVs, Champions uses Stat Points: 0–32 per stat, 66 total. In team exports write them on the "EVs:" line, e.g. "EVs: 32 HP / 2 Atk / 32 SpD".',
      'Stats: HP = base + SP + 75. Other stats = (base + SP + 20) × nature (1.1 / 0.9).',
      'Species clause and item clause (no duplicate species, no duplicate items). No restricted legendaries or mythicals.',
      'Mega Evolution is the battle gimmick: hold the right Mega Stone; at most one Mega Evolution per battle. No Terastallization.',
      'PP: Champions caps PP lower than mainline games; check move() for exact PP.',
      'Match: best of 3, same team all three games; you may change which 4 you bring and your leads every game.',
    ],
    simulator: 'Pokemon Showdown (pinned commit); its validator is the source of truth — use validate_team.',
  };
}

export function searchPokemon(args = {}) {
  const {query, type, ability, move, mega_only, sort_by, min, limit = 40} = args;
  let list = pickableSpecies();
  if (query) { const q = toID(query); list = list.filter(s => s.id.includes(q)); }
  if (type) {
    const types = (Array.isArray(type) ? type : [type]).map(t => toID(t));
    list = list.filter(s => types.every(t => s.types.some(x => toID(x) === t)));
  }
  if (ability) { const a = toID(ability); list = list.filter(s => abilityList(s).some(x => toID(x) === a) || megaFormsOf(s).some(m => abilityList(m).some(x => toID(x) === a))); }
  if (move) { const m = toID(move); list = list.filter(s => legalMoves(s).some(x => x.id === m)); }
  if (mega_only) list = list.filter(s => megaFormsOf(s).length);
  if (min && typeof min === 'object') {
    list = list.filter(s => Object.entries(min).every(([k, v]) => (s.baseStats[toID(k)] ?? bst(s.baseStats)) >= Number(v)));
  }
  const key = toID(sort_by || 'bst');
  list = [...list].sort((a, b) => (key === 'bst' ? bst(b.baseStats) - bst(a.baseStats) : (b.baseStats[key] ?? 0) - (a.baseStats[key] ?? 0)) || a.name.localeCompare(b.name));
  const total = list.length;
  return {
    total,
    shown: Math.min(total, limit),
    columns: 'Name — Types — HP/Atk/Def/SpA/SpD/Spe (BST) — Abilities — Mega forms',
    results: list.slice(0, limit).map(speciesSummary),
  };
}

export function pokemon({name}) {
  const sp = dex.species.get(name);
  if (!sp.exists) return {error: `No Pokemon named "${name}".`};
  if (!isSpeciesLegal(sp)) return {error: `${sp.name} is not legal in ${format.name}.`};
  const base = sp.battleOnly ? dex.species.get(Array.isArray(sp.battleOnly) ? sp.battleOnly[0] : sp.battleOnly) : sp;
  const moves = legalMoves(base);
  const group = cat => moves.filter(m => m.category === cat).map(shortMove);
  const out = {
    name: sp.name,
    types: sp.types,
    baseStats: Object.fromEntries(STATS.map(s => [STAT_LABEL[s], sp.baseStats[s]])),
    bst: bst(sp.baseStats),
    abilities: abilityList(sp).map(a => `${a}: ${shortDesc(dex.abilities.get(a))}`),
    weightkg: sp.weightkg,
    statRangesAtLevel50: Object.fromEntries(STATS.map(s => [STAT_LABEL[s], statRange(sp, s).join('–')])),
    moves: {physical: group('Physical'), special: group('Special'), status: group('Status')},
  };
  if (sp.requiredItem) out.requiredItem = sp.requiredItem;
  const megas = megaFormsOf(base);
  if (megas.length) {
    out.megaForms = megas.map(m => ({
      name: m.name, stone: m.requiredItem || m.requiredItems, types: m.types,
      baseStats: statLine(m.baseStats), ability: abilityList(m).map(a => `${a}: ${shortDesc(dex.abilities.get(a))}`),
    }));
  }
  return out;
}

export function move({name}) {
  const m = dex.moves.get(name);
  if (!m.exists || m.isNonstandard) return {error: `No legal move named "${name}".`};
  return {
    name: m.name, type: m.type, category: m.category, basePower: m.basePower || null,
    accuracy: m.accuracy === true ? 'always hits' : m.accuracy, pp: m.noPPBoosts ? m.pp : (m.pp / 5 + 1) * 4,
    priority: m.priority, target: m.target, contact: !!m.flags?.contact,
    description: longDesc(m),
  };
}

export function searchMoves(args = {}) {
  const {query, type, category, min_power, priority, spread, learnable_by, limit = 60} = args;
  let list = learnable_by ? (() => {
    const sp = dex.species.get(learnable_by);
    return sp.exists ? legalMoves(sp.battleOnly ? dex.species.get(sp.battleOnly) : sp) : [];
  })() : dex.moves.all().filter(m => !m.isNonstandard && !m.isZ && !m.isMax);
  if (query) { const q = toID(query); list = list.filter(m => m.id.includes(q) || toID(shortDesc(m)).includes(q)); }
  if (type) list = list.filter(m => toID(m.type) === toID(type));
  if (category) list = list.filter(m => toID(m.category) === toID(category));
  if (min_power) list = list.filter(m => (m.basePower || 0) >= Number(min_power));
  if (priority) list = list.filter(m => m.priority > 0);
  if (spread) list = list.filter(m => m.target === 'allAdjacentFoes' || m.target === 'allAdjacent');
  return {total: list.length, results: list.slice(0, limit).map(m => `${shortMove(m)} — ${shortDesc(m)}`)};
}

export function item({name}) {
  const i = dex.items.get(name);
  if (!i.exists || i.isNonstandard) return {error: `No legal item named "${name}".`};
  return {name: i.name, description: longDesc(i), megaStoneFor: i.megaStone ? Object.keys(i.megaStone) : undefined};
}

export function searchItems({query, limit = 200} = {}) {
  let list = legalItemList();
  if (query) { const q = toID(query); list = list.filter(i => i.id.includes(q) || toID(shortDesc(i)).includes(q)); }
  return {total: list.length, results: list.slice(0, limit).map(i => `${i.name} — ${shortDesc(i)}`)};
}

export function ability({name}) {
  const a = dex.abilities.get(name);
  if (!a.exists || a.isNonstandard) return {error: `No ability named "${name}".`};
  return {name: a.name, description: longDesc(a)};
}

// ---------------------------------------------------------------- teams
export function parseTeam(text) {
  if (Array.isArray(text)) return text;
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) { try { return JSON.parse(trimmed); } catch { return null; } }
  return Teams.import(trimmed);
}

export function validateTeam({team}) {
  const sets = parseTeam(team);
  if (!sets || !sets.length) return {ok: false, problems: ['Could not parse the team. Use Showdown export format (one blank line between Pokemon).']};
  for (const set of sets) {
    set.level = 50;
    set.ivs = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};
  }
  const problems = [...(validator.validateTeam(sets) || [])];
  if (sets.length !== 6) problems.push(`Bring exactly 6 Pokemon (you have ${sets.length}).`);
  for (const set of sets) {
    const total = STATS.reduce((a, s) => a + (set.evs?.[s] || 0), 0);
    if (total > SP_MAX_TOTAL) problems.push(`${set.species} uses ${total} stat points (max ${SP_MAX_TOTAL}).`);
    for (const s of STATS) if ((set.evs?.[s] || 0) > SP_MAX_PER_STAT) problems.push(`${set.species} has ${set.evs[s]} SP in ${STAT_LABEL[s]} (max ${SP_MAX_PER_STAT}).`);
    if ((set.moves || []).length < 1) problems.push(`${set.species} has no moves.`);
  }
  const unique = [...new Set(problems)];
  return {
    ok: unique.length === 0,
    problems: unique,
    sets,
    summary: sets.map(set => {
      const stats = computeStats(set);
      const total = STATS.reduce((a, s) => a + (set.evs?.[s] || 0), 0);
      return `${set.species} @ ${set.item || '(no item)'} — ${set.ability} — ${set.nature || 'Serious'} — stats ${STATS.map(s => `${STAT_LABEL[s]} ${stats[s]}`).join(' / ')} — SP used ${total}/${SP_MAX_TOTAL} — ${set.moves.join(', ')}`;
    }),
  };
}

export function exportTeam(sets) { return Teams.export(sets); }

// What the opponent sees under open team sheets.
export function openSheet(sets) {
  return sets.map(set => ({
    species: dex.species.get(set.species).name,
    item: set.item ? dex.items.get(set.item).name : '',
    ability: dex.abilities.get(set.ability).name,
    moves: set.moves.map(m => dex.moves.get(m).name),
    gender: set.gender || undefined,
  }));
}

export function openSheetText(sheet) {
  return sheet.map((p, i) => `${i + 1}. ${p.species} @ ${p.item || '(none)'} | ${p.ability} | ${p.moves.join(', ')}`).join('\n');
}

export {STATS, STAT_LABEL};
