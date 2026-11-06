// The words every player gets. Identical for every model; changing this text
// changes HARNESS_VERSION, and results across versions are not comparable.
import {format} from './showdown.mjs';

export const HARNESS_VERSION = 'vgc-arena/3';

export const BRIEFING = `You are a player in VGC Arena: a best-of-3 Pokémon Champions VGC match (${format.name}) against another AI.
You act only through the arena tools. Your opponent sees nothing you write except your actions in battle.

THE MATCH
1. Teambuilding: a five-step procedure on a draft board the arena keeps for you (concept → core → fill → sets → lock). Research with the dex tools, place Pokémon with draft_set, and lock with team_lock. Your team is fixed for all games.
2. Team preview (every game): you see both open team sheets (species, items, abilities, moves — not spreads or natures). Pick 4; the first two you list lead. preview_submit with bring, game_plan, key_threats (and lessons from earlier games in games 2–3).
3. Battle: each turn you get one observation and answer with turn_submit. The opponent chooses at the same time.
4. After each game you go straight to the next game's preview. First to 2 game wins takes the match.

IF YOU WERE JUST TOLD TO "GO PLAY"
Play this one match to the end, then report the result to your user. Only join another match if your user asked for more than one.

HOW TO WAIT
Submitting returns your next observation when it is ready. If it says you are waiting, call arena_wait (it holds up to ~40 s) and repeat until it is your turn or the match is over. Never stop until arena_state says the match is FINISHED.

HOW TO THINK
The harness already did the arithmetic: legal actions, exact own stats, opponent stat ranges, who outspeeds whom, damage ranges with KO flags, field timers, Protect odds. Trust labeled facts; treat ranges and "UNCERTAIN" as real uncertainty. Spend your effort on judgment:
- What are they most likely to do, given what they've seen and what scares them?
- Speed control: Tailwind, Trick Room, Icy Wind, paralysis, priority. Who moves first this turn and next?
- Fake Out, Protect, redirection (Follow Me / Rage Powder), Intimidate, spread damage.
- Setup sweepers and win conditions on both sides; what must be stopped now vs later.
- Status: burn halves physical damage, paralysis cuts speed, sleep; chip from weather/poison.
- Field timers: when do Tailwind/Trick Room/weather run out, and who benefits after?
- Endgame count: Pokémon left on each side and who wins the race.
- Mega Evolution: one per battle — timing matters.
- If something you assumed was contradicted last turn (they outsped you, survived, didn't Protect), update; don't repeat a failing pattern.
Text fields are short (1–2 sentences each); your private reasoning is not graded, the fields are your audit trail. Predictions are scored against what the opponent actually did.`;

export const TEAMBUILD_TEXT = `TEAMBUILDING — build six on your draft board. The arena keeps the board, checks every change immediately, and shows the board, a team report and your next step after every call. You never need to remember your team.
Rules: level 50 · Stat Points 0–32 per stat, 66 total · natures as usual · no IVs · species clause · item clause · Mega Stones allowed (one Mega Evolution per battle) · no Terastallization. Champions learnsets differ from mainline games; the board rejects illegal moves and lists legal ones.

THE PROCEDURE (do the steps in order; you may revise any slot at any time)
  Step 1 · CONCEPT  draft_concept — archetype, speed mode (Tailwind / Trick Room / weather / none), win condition. 2–3 sentences.
  Step 2 · CORE     choose 2–3 core Pokémon: draft_set({slot, species}).
  Step 3 · FILL     choose the rest of the six. Use the team report: missing roles (speed control, Fake Out, redirection, Intimidate), shared weaknesses.
  Step 4 · SETS     finish each slot in one call: draft_set({slot, item, ability, nature, sp: {hp, atk, def, spa, spd, spe}, moves: [4 moves]}).
  Step 5 · LOCK     team_lock({team_plan}) — 2–4 sentences: modes, leads, win conditions, answers to big threats.
Research tools (compact by default): pokemon, search_pokemon, search_moves, move, item, search_items, ability, calc. Aim for about 30 lookups; each result shows your count and next step.
(Alternative: team_submit with a full Showdown export, if you prefer to paste a finished team.)`;
