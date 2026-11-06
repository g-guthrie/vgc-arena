// Guided teambuilding: one small question at a time, derived from the draft
// board, each with its legal answers attached. Order: concept → the six
// species (composition first) → for each slot: ability → item → moves →
// nature & stat points → lock. Every question carries a JSON schema whose
// enums are exactly the legal answers, so a constrained client cannot give an
// illegal one; free-form clients get the same options as text.
import {dex, toID} from './showdown.mjs';
import {pickableSpecies, legalMoves, shortDesc, SP_MAX_PER_STAT, SP_MAX_TOTAL} from './dex-tools.mjs';
import {slotMissing} from './draft.mjs';

const NATURES = () => dex.natures.all().map(n => n.name).sort();
const statEffect = n => { const x = dex.natures.get(n); return x.plus ? `+${x.plus} −${x.minus}` : 'neutral'; };
const TOTAL = 1 + 6 + 6 * 4 + 1;

function usedBase(draft, except) {
  return new Set(draft.slots.map((s, i) => (s && i !== except ? toID(dex.species.get(s.species).baseSpecies) : null)).filter(Boolean));
}
function usedItems(draft, except) {
  return new Set(draft.slots.map((s, i) => (s && i !== except && s.item ? toID(s.item) : null)).filter(Boolean));
}
function legalItemsFor(draft, i) {
  const sp = dex.species.get(draft.slots[i].species);
  const used = usedItems(draft, i);
  return dex.items.all().filter(it => !it.isNonstandard && it.exists && !used.has(it.id))
    .filter(it => !it.megaStone || Object.keys(it.megaStone).some(k => toID(dex.species.get(k).baseSpecies) === toID(sp.baseSpecies)))
    .map(it => it.name).sort();
}

// The one thing the model is being asked right now.
export function question(draft) {
  const done = n => ({n, of: TOTAL});
  if (!draft.concept) {
    return {...done(1), step: 'concept', title: 'Team concept',
      prompt: 'Describe the team you want to build: archetype, speed mode (Tailwind / Trick Room / weather / none) and win condition, in 2–3 sentences.',
      schema: {type: 'object', properties: {concept: {type: 'string', description: '2–3 sentences'}}, required: ['concept'], additionalProperties: false}};
  }
  const empty = draft.slots.findIndex(s => !s);
  if (empty >= 0) {
    const used = usedBase(draft, empty);
    const options = pickableSpecies().filter(sp => !used.has(toID(sp.baseSpecies))).map(sp => sp.name);
    const picked = draft.slots.filter(Boolean).map(s => s.species);
    return {...done(2 + empty), step: 'species', slot: empty + 1, title: `Pokémon ${empty + 1} of 6`,
      prompt: `Choose Pokémon ${empty + 1} of 6.${picked.length ? ` So far: ${picked.join(', ')}.` : ''} Pick what the concept needs next (check the team report for missing roles and shared weaknesses). Mega forms: pick the base species; the stone comes later.`,
      options, optionsNote: `${options.length} legal species (search_pokemon to browse)`,
      schema: {type: 'object', properties: {species: {type: 'string', enum: options}}, required: ['species'], additionalProperties: false}};
  }
  let n = 8;
  for (let i = 0; i < 6; i++) {
    const s = draft.slots[i];
    const sp = dex.species.get(s.species);
    const miss = slotMissing(s);
    const label = `Slot ${i + 1} · ${sp.name}`;
    if (!s.ability) {
      const options = Object.values(sp.abilities).filter(Boolean);
      return {n, of: TOTAL, step: 'ability', slot: i + 1, title: `${label}: ability`, prompt: `Which ability for ${sp.name}?`,
        options: options.map(a => `${a} — ${shortDesc(dex.abilities.get(a))}`),
        schema: {type: 'object', properties: {ability: {type: 'string', enum: options}}, required: ['ability'], additionalProperties: false}};
    }
    n++;
    if (!s.item) {
      const options = legalItemsFor(draft, i);
      return {n, of: TOTAL, step: 'item', slot: i + 1, title: `${label}: item`, prompt: `Which item for ${sp.name}? (Items already held by your other Pokémon are excluded: item clause.)`,
        options, optionsNote: `${options.length} legal items (search_items to read effects)`,
        schema: {type: 'object', properties: {item: {type: 'string', enum: options}}, required: ['item'], additionalProperties: false}};
    }
    n++;
    if (miss.some(m => /move/.test(m))) {
      const moves = legalMoves(sp);
      const need = Math.min(4, moves.length);
      const options = moves.map(m => m.name);
      return {n, of: TOTAL, step: 'moves', slot: i + 1, title: `${label}: moves`, prompt: `Choose ${need} moves for ${sp.name} @ ${s.item} (${s.ability}). Only moves it can legally use in Champions are offered.`,
        options: moves.map(m => `${m.name} (${m.type} ${m.category === 'Status' ? 'status' : `${m.basePower || '—'} ${m.category === 'Physical' ? 'phys' : 'spec'}`}${m.priority ? ` p${m.priority > 0 ? '+' : ''}${m.priority}` : ''}${['allAdjacentFoes', 'allAdjacent'].includes(m.target) ? ' spread' : ''})`),
        schema: {type: 'object', properties: {moves: {type: 'array', items: {type: 'string', enum: options}, minItems: need, maxItems: need, uniqueItems: true}}, required: ['moves'], additionalProperties: false}};
    }
    n++;
    if (!s.nature || !s.spSet) {
      const stat = {type: 'integer', minimum: 0, maximum: SP_MAX_PER_STAT};
      const bs = sp.baseStats;
      return {n, of: TOTAL, step: 'spread', slot: i + 1, title: `${label}: nature & stat points`,
        prompt: `Nature and stat points for ${sp.name} (base ${bs.hp}/${bs.atk}/${bs.def}/${bs.spa}/${bs.spd}/${bs.spe}, moves: ${s.moves.join(', ')}). Stat points: 0–${SP_MAX_PER_STAT} per stat, ${SP_MAX_TOTAL} total. Common shapes: fast attacker {atk or spa: 32, spe: 32, hp: 2}; bulky support {hp: 32, def or spd: 32, +2 elsewhere}; Trick Room attacker {hp: 32, atk or spa: 32, spe: 0} with a −Spe nature.`,
        options: NATURES().map(x => `${x} (${statEffect(x)})`),
        schema: {type: 'object', properties: {nature: {type: 'string', enum: NATURES()}, sp: {type: 'object', properties: {hp: stat, atk: stat, def: stat, spa: stat, spd: stat, spe: stat}, required: ['hp', 'atk', 'def', 'spa', 'spd', 'spe'], additionalProperties: false}}, required: ['nature', 'sp'], additionalProperties: false}};
    }
    n++;
  }
  return {n: TOTAL, of: TOTAL, step: 'lock', title: 'Lock the team',
    prompt: 'Every slot is complete. Write your team plan (2–4 sentences: modes, leads, win conditions, answers to big threats) to lock the six for the whole match.',
    schema: {type: 'object', properties: {team_plan: {type: 'string'}}, required: ['team_plan'], additionalProperties: false}};
}

// Text form of the question for clients that read it (MCP, CLI).
export function questionText(q) {
  const L = [`QUESTION ${q.n} of ~${q.of} · ${q.title}`, q.prompt];
  if (q.options) {
    const list = q.options.length > 60 ? `${q.options.slice(0, 60).join(' · ')} … (${q.options.length} total)` : q.options.join(' · ');
    L.push(q.step === 'species' ? `Options: ${q.optionsNote}.` : `Options${q.optionsNote ? ` (${q.optionsNote})` : ''}: ${list}`);
  }
  const example = {concept: '{"concept": "…"}', species: '{"species": "…"}', ability: '{"ability": "…"}', item: '{"item": "…"}', moves: '{"moves": ["…", "…", "…", "…"]}', spread: '{"nature": "…", "sp": {"hp": 0, "atk": 0, "def": 0, "spa": 0, "spd": 0, "spe": 0}}', lock: '{"team_plan": "…"}'}[q.step];
  L.push(`Answer with draft_answer ${example} (plus your seat). Research tools are available first if you need them. To change an earlier choice instead, use draft_set or draft_clear.`);
  return L.join('\n');
}
