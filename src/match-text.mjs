// Pure helpers that turn match state into text or compact data for players,
// spectators and artifacts. Nothing here mutates a match.
import {dex, toID} from './showdown.mjs';
import {statRange} from './dex-tools.mjs';

export function displayName(seat) {
  if (!seat) return '';
  const id = seat.identity || {};
  return `${id.name || seat.model}${id.effort ? ` (${id.effort})` : ''}`.replace(/\|/g, '/');
}

// Spectator protocol with the real identities filled in (players only ever
// see "Player 1/2").
export function displayNames(lines, seats) {
  const names = {p1: displayName(seats.p1), p2: displayName(seats.p2)};
  return lines.map(l => {
    if (l.startsWith('|player|')) return l.replace(/^\|player\|(p[12])\|Player [12]\|/, (m, side) => `|player|${side}|${names[side]}|`);
    if (l === '|win|Player 1') return `|win|${names.p1}`;
    if (l === '|win|Player 2') return `|win|${names.p2}`;
    return l;
  });
}

// Types, base stats, Mega forms and move data for every Pokémon on both sheets,
// so the room page can draw cards without its own dex.
export function sheetDex(sheet) {
  const species = {}, moves = {};
  for (const p of sheet) {
    const sp = dex.species.get(p.species);
    species[p.species] = {types: sp.types, bs: sp.baseStats, mega: (sp.otherFormes || []).map(f => dex.species.get(f)).filter(f => f.isMega).map(f => f.name)};
    for (const m of p.moves) { const mv = dex.moves.get(m); moves[mv.name] = {type: mv.type, category: mv.category, bp: mv.basePower || 0}; }
  }
  return {species, moves};
}

// The name a Pokémon has on its team sheet: Mega and other in-battle forms
// count as the Pokémon they came from.
export function teamName(name) {
  const sp = dex.species.get(name);
  if (sp.isMega) return sp.baseSpecies;
  return sp.battleOnly ? (Array.isArray(sp.battleOnly) ? sp.battleOnly[0] : sp.battleOnly) : sp.name;
}

// The opponent's visible actions per turn of a finished game: moves with
// targets, switches and Mega Evolution, from the public log.
export function opponentActions(log, opp) {
  const out = [];
  let turn = 0;
  let acts = [];
  const name = ident => ident.split(': ')[1];
  const flush = () => { if (turn && acts.length) out.push([turn, acts]); acts = []; };
  for (const line of log) {
    const p = line.split('|');
    if (p[1] === 'turn') { flush(); turn = Number(p[2]); continue; }
    if (!turn || !p[2]?.startsWith(opp)) continue;
    if (p[1] === 'move' && !/\[from\](?! lockedmove)/.test(line)) acts.push(`${name(p[2])} ${p[3]}${p[4] && !p[4].startsWith(opp) ? ` → ${name(p[4])}` : p[4] && p[4] !== p[2] ? ` → its ally ${name(p[4])}` : ''}`);
    else if (p[1] === 'switch' || p[1] === 'drag') acts.push(`in: ${p[3].split(',')[0]}`);
    else if (p[1] === '-mega') acts.push(`${name(p[2])} Mega Evolved`);
  }
  flush();
  return out;
}

export function rangesLine(species) {
  const sp = dex.species.get(species);
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(s => `${s === 'hp' ? 'HP' : s[0].toUpperCase() + s.slice(1)} ${statRange(sp, s).join('–')}`).join(' · ');
}

// What an opponent's recorded action is called when graded against a
// prediction: the move's name, or "switch".
export const chosenLabel = action => (action ? (action.switch ? 'switch' : action.move) : null);
export const predictionHit = (predicted, chosen) => toID(predicted) === toID(chosen) || (toID(predicted).startsWith('switch') && chosen === 'switch');
