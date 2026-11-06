// Guided teambuilding: the only way players build. The arena keeps the draft
// board and asks nine questions, each sized to one real decision:
//   1  concept
//   2  all six species (composition is decided as a whole)
//   3–8 one complete set per Pokémon (ability, item, nature, stat points, moves)
//   9  team plan → lock
// Every question carries a JSON schema whose enums are exactly the legal
// answers, and every answer is validated on the spot with specific errors.
import {dex, toID} from './showdown.mjs';
import {pickableSpecies, legalMoves, shortDesc, SP_MAX_PER_STAT, SP_MAX_TOTAL} from './dex-tools.mjs';
import {slotMissing} from './draft.mjs';

export const QUESTIONS = 9;
const NATURES = () => dex.natures.all().map(n => n.name).sort();
const natureNote = n => { const x = dex.natures.get(n); return x.plus ? `${n} (+${x.plus} −${x.minus})` : `${n} (neutral)`; };

// Items held by the other slots (item clause), as "Focus Sash (Whimsicott)".
function heldElsewhere(draft, i) {
  return draft.slots.map((s, j) => (s && j !== i && s.item ? `${dex.items.get(s.item).name} (${s.species})` : null)).filter(Boolean);
}

// "Garchompite Z" → "Garchompite Z (→ Garchomp-Mega-Z: Dragon/Ground, 108/…, Ability)".
function megaNote(name) {
  const item = dex.items.get(name);
  if (!item.megaStone) return name;
  const f = dex.species.get(Object.values(item.megaStone)[0]);
  const b = f.baseStats;
  return `${name} (→ ${f.name}: ${f.types.join('/')}, ${b.hp}/${b.atk}/${b.def}/${b.spa}/${b.spd}/${b.spe}, ${Object.values(f.abilities)[0]})`;
}

function itemsFor(draft, i) {
  const sp = dex.species.get(draft.slots[i].species);
  const used = new Set(draft.slots.map((s, j) => (s && j !== i && s.item ? toID(s.item) : null)).filter(Boolean));
  return dex.items.all().filter(it => !it.isNonstandard && it.exists && !used.has(it.id))
    .filter(it => !it.megaStone || Object.keys(it.megaStone).some(k => toID(dex.species.get(k).baseSpecies) === toID(sp.baseSpecies)))
    .map(it => it.name).sort();
}

export function question(draft) {
  if (!draft.concept) {
    return {n: 1, of: QUESTIONS, step: 'concept', title: 'Team concept',
      prompt: 'Describe the team you will build: archetype, speed mode (Tailwind / Trick Room / weather / none) and win condition, in 2–3 sentences.',
      schema: {type: 'object', properties: {concept: {type: 'string', description: '2–3 sentences'}}, required: ['concept'], additionalProperties: false}};
  }
  if (draft.slots.some(s => !s)) {
    const options = pickableSpecies().map(sp => sp.name);
    const have = draft.slots.filter(Boolean).map(s => s.species);
    return {n: 2, of: QUESTIONS, step: 'species', title: 'Your six Pokémon',
      prompt: `Choose all six Pokémon at once (no two of the same species; for a Mega, choose the base species, the stone comes with its set).${have.length ? ` Already on the board: ${have.join(', ')}; send the full six.` : ''} Research with search_pokemon / pokemon first if you need to.`,
      optionsNote: `${options.length} legal species`,
      schema: {type: 'object', properties: {species: {type: 'array', items: {type: 'string', enum: options}, minItems: 6, maxItems: 6, uniqueItems: true}}, required: ['species'], additionalProperties: false}};
  }
  for (let i = 0; i < 6; i++) {
    const s = draft.slots[i];
    if (!slotMissing(s).length) continue;
    const sp = dex.species.get(s.species);
    const moves = legalMoves(sp);
    const need = Math.min(4, moves.length);
    const abilities = Object.values(sp.abilities).filter(Boolean);
    const items = itemsFor(draft, i);
    const stat = {type: 'integer', minimum: 0, maximum: SP_MAX_PER_STAT};
    const bs = sp.baseStats;
    return {n: 3 + i, of: QUESTIONS, step: 'set', slot: i + 1, title: `Set for ${sp.name} (slot ${i + 1} of 6)`,
      prompt: `Complete ${sp.name}'s set: ability, item, nature, stat points (0–${SP_MAX_PER_STAT} per stat, ${SP_MAX_TOTAL} total) and ${need} moves. Base stats ${bs.hp}/${bs.atk}/${bs.def}/${bs.spa}/${bs.spd}/${bs.spe}; types ${sp.types.join('/')}.`,
      options: {
        abilities: abilities.map(a => `${a} — ${shortDesc(dex.abilities.get(a))}`),
        items: items.map(megaNote),
        heldElsewhere: heldElsewhere(draft, i),
        natures: NATURES().map(natureNote),
        moves: moves.map(m => `${m.name} (${m.type} ${m.category === 'Status' ? 'status' : `${m.basePower || '—'} ${m.category === 'Physical' ? 'phys' : 'spec'}`}${m.priority ? ` p${m.priority > 0 ? '+' : ''}${m.priority}` : ''}${['allAdjacentFoes', 'allAdjacent'].includes(m.target) ? ' spread' : ''})`),
      },
      schema: {type: 'object', properties: {
        ability: {type: 'string', enum: abilities},
        item: {type: 'string', enum: items},
        nature: {type: 'string', enum: NATURES()},
        sp: {type: 'object', properties: {hp: stat, atk: stat, def: stat, spa: stat, spd: stat, spe: stat}, required: ['hp', 'atk', 'def', 'spa', 'spd', 'spe'], additionalProperties: false, description: `${SP_MAX_TOTAL} total`},
        moves: {type: 'array', items: {type: 'string', enum: moves.map(m => m.name)}, minItems: need, maxItems: need, uniqueItems: true},
      }, required: ['ability', 'item', 'nature', 'sp', 'moves'], additionalProperties: false}};
  }
  return {n: QUESTIONS, of: QUESTIONS, step: 'lock', title: 'Lock the team',
    prompt: 'All six sets are complete. Write your team plan (2–4 sentences: modes, leads, win conditions, answers to big threats) to lock the team for the whole match.',
    schema: {type: 'object', properties: {team_plan: {type: 'string'}}, required: ['team_plan'], additionalProperties: false}};
}

export function questionText(q, think = () => '') {
  const L = [`QUESTION ${q.n} of ${q.of} · ${q.title}`, q.prompt];
  if (q.step === 'species') L.push(`Options: ${q.optionsNote} (search_pokemon to browse).`);
  if (q.step === 'set') {
    L.push(`Abilities: ${q.options.abilities.join(' · ')}`);
    L.push(`Items (a Mega Stone appears only for the Pokémon it belongs to${q.options.heldElsewhere.length ? `; already held, so not listed: ${q.options.heldElsewhere.join(', ')}` : ''}): ${q.options.items.join(', ')}`);
    L.push(`Natures: ${q.options.natures.join(', ')}`);
    L.push(`Legal moves: ${q.options.moves.join(' · ')}`);
  }
  const example = {
    concept: '{"concept": "…"}',
    species: '{"species": ["…", "…", "…", "…", "…", "…"]}',
    set: '{"ability": "…", "item": "…", "nature": "…", "sp": {"hp": 0, "atk": 0, "def": 0, "spa": 0, "spd": 0, "spe": 0}, "moves": ["…", "…", "…", "…"]}',
    lock: '{"team_plan": "…"}',
  }[q.step];
  L.push(think(q.step));
  L.push(`Answer with draft_answer ${example} plus your seat. To change an earlier answer: draft_revise({slot}) reopens that set, draft_revise({slot, species}) swaps the Pokémon.`);
  return L.join('\n');
}
