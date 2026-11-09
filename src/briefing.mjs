// The words every player gets. Identical for every model; changing this text
// changes HARNESS_VERSION, and results across versions are not comparable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {format} from './showdown.mjs';

// The version has two parts. The number is bumped by hand when the benchmark
// changes on purpose. The hash is computed from every source file that shapes
// what a player reads (briefing, observation, teambuilding questions, log
// prose), so an edit to any of them changes the version without anyone having
// to remember.
const HARNESS_BASE = 'vgc-arena/12';
const PLAYER_FACING = ['briefing.mjs', 'observation.mjs', 'guided.mjs', 'draft.mjs', 'game.mjs', 'calc.mjs', 'speed-infer.mjs'];
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceHash = crypto.createHash('sha256');
for (const f of PLAYER_FACING) sourceHash.update(fs.readFileSync(path.join(here, f)));
export const HARNESS_VERSION = `${HARNESS_BASE}-${sourceHash.digest('hex').slice(0, 8)}`;

// Things to weigh before each kind of decision. Shown with the question, every
// time; players answer the question, not the list.
export const THINK = {
  concept: [
    'Speed mode: Tailwind, Trick Room, weather, priority, or a mix, and what you do against the others.',
    'Win condition: what your team is trying to do by turn 3–4.',
    'The common threats in this format and how the team will handle them.',
  ],
  species: [
    'Speed control and an answer to the opposing speed mode.',
    'Support: Fake Out, redirection, Intimidate, Protect-friendly roles.',
    'Type coverage and shared weaknesses across the six.',
    'Your Mega: which one and how the team plays around it.',
    'Which four you expect to bring most, and what the other two cover.',
  ],
  set: [
    "This Pokémon's job in the concept.",
    'Speed: what it must outspeed, or stay under for Trick Room.',
    'Bulk: which hits it must survive; damage: which KOs it needs.',
    'Item and ability for that job, with the item clause in mind.',
    'Moves: Protect, spread vs single-target, coverage for the threats you named.',
  ],
  lock: [
    'Leads, back line and how the team wins.',
    'Answers to the biggest threats and to each speed mode.',
  ],
  preview: [
    'Their likely four and leads, from their sheet and from earlier games.',
    'Their speed mode and your answer to it.',
    'Their biggest threats to your team and which of your four handle them.',
    'Your win condition with these four, and the lead pair that pressures their likely leads.',
    'When you plan to Mega Evolve.',
    'From game 2: what they did last game and what you change.',
  ],
  move: [
    "Each foe's most likely action this turn, given what threatens it and what it has done.",
    'Win conditions on both sides: what must survive, what must go now.',
    'Your biggest loss condition this turn, and whether your choice covers it.',
    'Speed and priority this turn and next: who moves first, Tailwind / Trick Room turns left, and that speed control used this turn (a Prankster Tailwind, Icy Wind) re-orders the rest of the same turn.',
    'Targeting: typing and immunities (Ghost vs Fake Out, Flying and Levitate vs Ground, Dark vs Prankster status), redirection, likely Protects, spread vs single, double-targeting.',
    'Resources: Mega Evolution, Fake Out, Protect, Intimidate cycling, berries and Focus Sash.',
    'Position after this turn: what you want on the field next turn.',
  ],
  replace: [
    'What is left on each side, and the endgame count.',
    'Which option matches up best against both of their actives (typing, Speed, damage both ways).',
    'What they will likely do next turn into each option.',
    'Speed control on the field and its turns left: who it favors.',
    'Who you must save for the endgame, and who you can spend.',
    'Switch-in effects: Intimidate, weather or terrain, a fresh Fake Out.',
  ],
  pivot: [
    'The incoming Pokémon takes any attack still aimed at this slot this turn.',
    'Which option matches up best against their actives next turn.',
    'Switch-in effects: Intimidate, weather or terrain, a fresh Fake Out next turn.',
    'Who you must save for the endgame.',
  ],
};

const THINK_NAMES = {concept: 'concept', species: 'six Pokémon', set: 'each set', lock: 'team plan', preview: 'team preview', move: 'move turn', replace: 'replacing a fainted Pokémon', pivot: 'mid-turn switch'};

// The full list the first time a player meets a kind of decision; after that,
// one line pointing back to it (it is also in the briefing).
export function thinkText(kind, full = true) {
  const list = THINK[kind];
  if (!list) return '';
  if (!full) return `WEIGH the ${THINK_NAMES[kind]} checklist (in your briefing) before answering.`;
  return `WEIGH BEFORE ANSWERING (no need to write about these; this list appears once, then as a one-line reminder):\n${list.map(x => `  - ${x}`).join('\n')}`;
}

const CHECKLISTS = Object.entries(THINK).map(([k, list]) => `${THINK_NAMES[k][0].toUpperCase()}${THINK_NAMES[k].slice(1)}:\n${list.map(x => `  - ${x}`).join('\n')}`).join('\n');

// The game: what every player gets, MCP or API.
export const GAME_BRIEFING = `You are a player in VGC Arena: a best-of-3 Pokémon Champions VGC match (${format.name}) against another AI.
You act only through the arena tools. Your opponent sees nothing you write except your actions in battle.

THE MATCH
1. Teambuilding: nine questions on a draft board the arena keeps (concept → your six Pokémon → one full set per Pokémon → team plan). Answer each with draft_answer; research with the dex tools whenever you like. Your team is fixed for all games.
2. Team preview (every game): you see both open team sheets (species, items, abilities, moves — not spreads or natures). Pick 4; the first two you list lead. preview_submit with bring and game_plan.
3. Battle: each turn you get one observation ending in YOUR OPTIONS, a menu with an ID for every legal action. Answer with turn_submit: one ID per slot, optional Mega, and a prediction for each foe. The opponent chooses at the same time.
4. After each game you go straight to the next game's preview. First to 2 game wins takes the match.

HOW TO THINK
The harness does the arithmetic and shows everything a player at the table could see: legal actions, exact own stats, opponent stat ranges (Speed narrowed by move order seen), who outspeeds whom, the strongest hits each way with KO flags, Mega numbers, field timers, Protect odds, status counters, last moves. Trust labeled facts; treat ranges and "UNCERTAIN" as real uncertainty. Predictions are scored against what the opponent actually chose; reason is optional.

CHECKLISTS
Before each decision, weigh the checklist for that kind of decision. You don't need to write about it. Each one is shown in full the first time, then as a one-line reminder.
${CHECKLISTS}`;

// How to drive the loop yourself, for agents connected over MCP or the CLI.
export const BRIEFING = `${GAME_BRIEFING}

IF YOU WERE JUST TOLD TO "GO PLAY"
Play this one match to the end, then report the result to your user. Only join another match if your user asked for more than one.

HOW TO WAIT
Submitting returns your next observation when it is ready. If it says you are waiting, call arena_wait (it holds up to ~40 s) and repeat until it is your turn or the match is over. Never stop until arena_state says the match is FINISHED.`;

export const TEAMBUILD_TEXT = `TEAMBUILDING — nine questions. The arena keeps your draft board and asks, in order: (1) your concept; (2) all six Pokémon; (3–8) one complete set per Pokémon — ability, item, nature, stat points and moves, choosing only from the legal options listed; (9) your team plan, which locks the team. Answer each with draft_answer; the reply shows the updated board, a team report and the next question. draft_revise changes an earlier answer.
Rules: level 50 · Stat Points 0–32 per stat, 66 total · natures as usual · no IVs · species clause · item clause · Mega Stones allowed (one Mega Evolution per battle) · no Terastallization · Champions learnsets differ from mainline games (only legal moves are offered).
Research whenever you want (compact by default): pokemon, search_pokemon, search_moves, move, item, search_items, ability, calc.`;
