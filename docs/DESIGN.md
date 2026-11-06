# Design notes

## What this measures

A VGC set measures several skills in a row. Each can be scored on its own:

| Stage | Skill | Signal |
|---|---|---|
| Teambuilding | Knowledge + synergy design under real legality constraints | builder rating (team swaps), validation attempts |
| Team preview | Reading the opponent's sheet; choosing 4 and leads | preview text, game results |
| Turns | Tactics with simultaneous moves and partial information | game wins, prediction accuracy / Brier |
| Across games | Adapting to this opponent | game plans, changes in brings/leads between games |

A single battle is only moderately long-horizon, because the state is re-sent
every turn. The long horizon is the whole chain: team plan → game plan → turns
→ next game's plan. Keep each player as **one persistent agent for the
whole set**. Never spawn a fresh agent per turn.

## Choices

- **Open team sheets.** Official VGC uses them. They remove recall-heavy set guessing while keeping real uncertainty: spreads (above all Speed and bulk) and choices.
- **Best of 3, fixed team.** Adaptation between games is the most long-horizon signal Pokémon offers.
- **The harness does the arithmetic.** Speed order, damage ranges, KO flags, timers and Protect odds all come from the simulator, so mechanical slips don't drown out the strategy. The model's tokens go to prediction and planning. Hidden spreads appear as ranges and `UNCERTAIN`, never as guesses.
- **The answer is a menu pick, not prose.** Every legal action has an ID; a turn answer is one ID per slot, an optional Mega slot, a prediction per foe (from its sheet moves or "switch") and an optional one-line reason. Text, schema and parser come from one menu, so there is no translation step to get wrong: an answer is an exact option or a rejection listing the options, and a rejection consumes nothing. Over an API the schema is sent strict, so supporting providers cannot decode an illegal answer at all. Predictions are the one field graded against the truth.
- **Thought scaffolding without essays.** Every decision ends with a short, prioritized list of judgments to weigh (separate lists for move turns, replacements, mid-turn pivots, team preview and each teambuilding question). Facts never go on these lists; facts go in the observation. Nothing on a list must be written out: reasoning models already think before answering, and forced prose mostly restates the choice after the fact. The lists live in `briefing.mjs` with the rest of the player-facing text and are versioned with it.
- **No floor-raising.** The API agent offers one answer tool, reminds once after an empty reply, and forfeits after 12 calls without a legal answer. A weak model failing is a result.
- **Procedural teambuilding.** Building a team from 269 species is a design problem, but we want a failure to mean "bad at teambuilding", not "got lost in our tools". The arena therefore holds the draft and asks nine questions (concept, all six species, one complete set per Pokémon, team plan), each with its legal answers enumerated, validates every answer on the spot, and reports facts about the team as it forms. There is no free-form import path. The model still makes every choice, and judgment such as typing and immunities stays in the prompt, not in safeguards. In a real run before this change, one model researched for 90 calls without submitting because the API agent had trimmed away its instructions, and another used 120 calls with repeated rejected submits.
- **Loop breakers.** Each turn shows: the game plan; last turn's predictions against what happened; repeated identical actions; dead Fake Out; Protect odds; and what Mega Evolution would change.
- **No model calls inside the arena.** Players connect from outside over MCP or CLI, so any subscription or agent can play, and the arena stays deterministic and cheap.

## Sealing (what would invalidate results)

1. **Opponent information.** Spreads, natures, exact HP, unrevealed brought Pokémon and pending choices are never rendered. Damage calcs for opponent Pokémon replace their real stats with the extremes of the legal range. Foul Play against an opponent is skipped, since it would use their hidden Attack.
2. **RNG.** Calculations run inside a sandbox: pinned rolls, crits off, log rolled back, and an assertion that the PRNG seed did not move. `test/harness.test.mjs` replays a game with and without observations and requires identical logs.
3. **Tool access.** Seat tokens are random and returned only to their owner. Spectator endpoints are public-information only until a match ends. Artifacts are written only after it ends. A player agent should have only the arena tools (see `.claude/agents/vgc-player.md`). Shell-based players can read the disk, so audit them.
4. **Versioning.** `HARNESS_VERSION` (briefing + scaffold) and the Showdown commit are stamped on every result, and ratings group by them.

## Statistical power

VGC is high-variance. Rough guide: separating a true 60/40 skill gap at 95%
confidence takes about 100 games; 55/45 takes about 400. Reduce the variance with:
- **team swaps**, which put the same teams in both hands;
- **many short sets** rather than a few long ones;
- **game-level ratings**, which give 2–3 data points per match.

## Known gaps

- Damage ranges assume no crit and no Helping Hand. A Mega-capable active also gets its Mega-form numbers (damage dealt and taken, Speed, any weather its ability sets), computed on a throwaway copy of the battle. Moves whose damage depends on hidden information are skipped.
- Opponent Speed ranges narrow from observed move order. The simulator sorts its queue by order, priority, fractional priority (Quick Claw, Lagging Tail, Stall…) and action Speed, and re-sorts after every action, so when a move is about to run, each queued move from the other side in the same bracket is no faster. The arena hooks that moment and bounds each side's stored Speed against the other's exact Speed (ties are random, so bounds are inclusive; Trick Room is folded in). Weather, Tailwind, Mega Evolution and paralysis need no special cases. Turns where a move jumped the queue (After You, Instruct, Round, Pledges) are skipped, as are Illusion teams. Bounds persist across the games of a set.
- A forfeit makes the game in progress a loss for the forfeiter. A forfeit before any game starts leaves no rated games.
- Under Illusion, the observation shows the disguise, as the opponent would see it, but calcs use the real Pokémon.
- No turn timer. A stalled player blocks the match; forfeit through `arena_forfeit`.
- The built-in bots use two fixed sample teams.
