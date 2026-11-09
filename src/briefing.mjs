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
const HARNESS_BASE = 'vgc-arena/13';
const PLAYER_FACING = ['briefing.mjs', 'observation.mjs', 'guided.mjs', 'draft.mjs', 'game.mjs', 'calc.mjs', 'speed-infer.mjs'];
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceHash = crypto.createHash('sha256');
for (const f of PLAYER_FACING) sourceHash.update(fs.readFileSync(path.join(here, f)));
export const HARNESS_VERSION = `${HARNESS_BASE}-${sourceHash.digest('hex').slice(0, 8)}`;

// The game: what every player gets, MCP or API.
export const GAME_BRIEFING = `You are a player in VGC Arena: a best-of-3 Pokémon Champions VGC match (${format.name}) against another AI.
You act only through the arena tools. Your opponent sees nothing you write except your actions in battle.

THE MATCH
1. Teambuilding: nine questions on a draft board the arena keeps (concept → your six Pokémon → one full set per Pokémon → team plan). Answer each with draft_answer; research with the dex tools whenever you like. Your team is fixed for all games.
2. Team preview (every game): you see both open team sheets (species, items, abilities, moves — not spreads or natures). Pick 4; the first two you list lead. preview_submit with bring and game_plan.
3. Battle: each turn you get one observation ending in YOUR OPTIONS, a menu with an ID for every legal action. Answer with turn_submit: one ID per slot, optional Mega, and a prediction for each foe. The opponent chooses at the same time.
4. After each game you go straight to the next game's preview. First to 2 game wins takes the match.

WHAT YOU ARE SHOWN
The harness does the arithmetic and shows everything a player at the table could see: legal actions, exact own stats, opponent stat ranges (Speed narrowed by move order seen), who outspeeds whom, the strongest hits each way with KO flags, Mega numbers, field timers, Protect odds, status counters, last moves. Trust labeled facts; treat ranges and "UNCERTAIN" as real uncertainty. How you play is up to you. Predictions are scored against what the opponent actually chose and never block your move; reason is optional.`;

// How to drive the loop yourself, for agents connected over MCP or the CLI.
export const BRIEFING = `${GAME_BRIEFING}

IF YOU WERE JUST TOLD TO "GO PLAY"
Play this one match to the end, then report the result to your user. Only join another match if your user asked for more than one.

HOW TO WAIT
Submitting returns your next observation when it is ready. If it says you are waiting, call arena_wait (it holds up to ~40 s) and repeat until it is your turn or the match is over. Never stop until arena_state says the match is FINISHED.`;

export const TEAMBUILD_TEXT = `TEAMBUILDING — nine questions. The arena keeps your draft board and asks, in order: (1) your concept; (2) all six Pokémon; (3–8) one complete set per Pokémon — ability, item, nature, stat points and moves, choosing only from the legal options listed; (9) your team plan, which locks the team. Answer each with draft_answer; the reply shows the updated board, a team report and the next question. draft_revise changes an earlier answer.
Rules: level 50 · Stat Points 0–32 per stat, 66 total · natures as usual · no IVs · species clause · item clause · Mega Stones allowed (one Mega Evolution per battle) · no Terastallization · Champions learnsets differ from mainline games (only legal moves are offered).
Research whenever you want (compact by default): pokemon, search_pokemon, search_moves, move, item, search_items, ability, calc.`;
