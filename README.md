# VGC Arena

An AI-native benchmark harness for **Pokémon Champions VGC**. Two AI players
each build a team, read each other's open team sheets, bring 4 of 6 and play a
**best-of-3** doubles set on the real Pokémon Showdown simulator. Any agent that
can call MCP tools, or run a shell command, can play: Claude Code against Codex,
two Claude subagents, or a DeepSeek CLI against a built-in bot.

- **Format:** `[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)`, with open team sheets, level 50, Stat Points, Mega Evolution. The simulator is pinned to Showdown `567c1ce`.
- **No API keys.** The arena never calls a model. Players connect to it.
- **Hidden information is sealed.** Opponent spreads, natures, exact HP, unrevealed back Pokémon and pending choices never reach a player. Tests check this, including one proving the harness's own calculations never touch the battle RNG.

## Quick start

```sh
npm install
npm run setup        # clones + builds the pinned Pokemon Showdown simulator
npm start            # http://127.0.0.1:3170  (spectator UI, /mcp, /api)
npm test             # fairness tests
npm run e2e          # bot vs bot full Bo3 in-process
```

## Connecting players

Every interface exposes the same 18 tools (`arena_join`, `arena_wait`,
`team_submit`, `preview_submit`, `turn_submit`, the dex/teambuilding tools,
`calc`, …).

**Claude Code.** This repo's `.mcp.json` registers the stdio bridge. Or, from any directory:

```sh
claude mcp add vgc-arena -- node /path/to/vgc-arena/src/mcp-stdio.mjs
# or over HTTP:
claude mcp add --transport http vgc-arena http://127.0.0.1:3170/mcp
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.vgc-arena]
command = "node"
args = ["/path/to/vgc-arena/src/mcp-stdio.mjs"]
env = { VGC_ARENA_URL = "http://127.0.0.1:3170" }
tool_timeout_sec = 90
```

**Anything with a shell** (DeepSeek CLI, aider, a script):

```sh
node src/cli.mjs tools
node src/cli.mjs arena_join '{"name":"DS","model":"deepseek-v4"}'
node src/cli.mjs turn_submit - <<'JSON'
{"seat":"seat_…","actions":[{"slot":1,"move":"Fake Out","target":"foe2"},{"slot":2,"move":"Protect"}],
 "predictions":[{"foe":"foe1","action":"Protect","confidence":0.6}],"reason":"…","plan":"on track"}
JSON
```

Then tell each agent: *"Join VGC Arena with arena_join (model: &lt;your model&gt;) and
play the match to the end."* Two agents calling `arena_join` without a
`match_id` are paired automatically. To play a baseline instead, pass
`"vs_bot": "greedy"` or `"random"`.

### Claude Code subagents (Opus vs Sonnet, etc.)

`.claude/agents/vgc-player.md` defines a player whose **only** tools are the
arena tools: no file reads, no shell. Create a match, then launch two players
with different models:

```sh
curl -s -X POST localhost:3170/api/matches -H 'content-type: application/json' \
  -d '{"label":"opus vs sonnet #1","reserved":true}'      # → {"id":"m-…"}
```

> Use the vgc-player agent twice in parallel, one with model opus and one with
> model sonnet. Tell each: join match m-… with model "claude-opus-5-5" (or
> "claude-sonnet-5-5") and play it to the end.

Restricting tools is the sealing guarantee. A general-purpose agent with Bash
could read things it shouldn't, so only use the CLI path with agents you
trust, or audit their transcripts.

## What a player sees

**Teambuilding.** The dex tools answer only from the format's own data. Champions
learnsets differ from mainline: Incineroar can't learn Knock Off, for example.
`validate_team` is Showdown's own validator plus the Stat Point rules.
`calc` runs damage calculations through the simulator itself.

**Team preview** (every game) shows:
- your full team and team plan;
- the opponent's open sheet, with the stat range each opponent Pokémon could have under any legal spread;
- in games 2–3, what the opponent revealed and led with in earlier games.

You submit `bring` (4 Pokémon, first two lead), `key_threats`, `game_plan`, and from game 2 on, `lessons`.

**Each turn**, one text observation (about 1,500 tokens) contains:
- what happened since your last decision, and how your last predictions fared (✓/✗);
- field, side conditions and timers, counted as turns left including this one;
- your active Pokémon (exact stats, PP, effects, Protect odds) and your bench;
- the opponent's active Pokémon: HP %, boosts, sheet item/ability/moves and possible stat ranges. Which of their 4 you've seen, and which sheet species could still be in the back;
- **Speed order**: exact for you, a range for them, with `UNCERTAIN` where their hidden spread decides it. Trick Room and Tailwind are applied;
- **damage ranges** in both directions with KO flags, computed by the simulator across every legal opponent spread (Focus Sash and Sturdy are flagged);
- alerts: Mega Evolution availability and its effect on Speed, repeated identical actions, dead Fake Out;
- the exact legal actions, and the fields to fill.

**The scaffold has three depths, chosen by the harness:**
- **FULL**: on turn 1, after a faint or switch, or when the field changes. Asks for `threats`, `win_condition`, `predictions`, `actions`, `reason`, `risk`, `plan`.
- **LIGHT**: all other turns. Asks for `predictions`, `actions`, `reason`, `plan`.
- **Replacement**: after a faint. Asks for `actions` and `reason`.

Each field is 1–2 sentences. Predictions are scored against what the opponent actually chose.

## Results

When a match finishes, it writes:
- `artifacts/matches/<id>/match.json`: everything, including every observation each player saw, every submission, and timings;
- `transcript.md`: readable, for post-game analysis by an AI;
- `game-N.html`: an animated Showdown replay;
- one line in `artifacts/results.jsonl`.

```sh
npm run ratings                          # Bradley–Terry per game, 95% bootstrap CI
node src/ratings.mjs --unit match        # per match
node src/ratings.mjs --by builder        # credit the team's builder instead of its pilot
```

The ratings table also reports prediction accuracy, Brier score and median
decision time per model. Results are grouped by harness version and Showdown
commit, because changing either changes the benchmark.

### Separating teambuilding from piloting

Replay finished teams with the pilots swapped:

```sh
curl -s -X POST localhost:3170/api/matches -H 'content-type: application/json' -d '{
  "label": "swap: sonnet pilots opus team",
  "fixed_teams": {"p1": "<export>", "p2": "<export>", "builders": {"p1": "claude-opus-5-5", "p2": "claude-sonnet-5-5"}}
}'
```

`--by builder` and `--by pilot` then score the two skills separately.

## Layout

```
src/showdown.mjs     pinned simulator + format
src/dex-tools.mjs    teambuilding lookups, validation, open sheets, Champions stat math
src/calc.mjs         simulator-backed damage/speed, RNG-sandboxed, spread-range aware
src/game.mjs         one battle; protocol → readable text
src/observation.mjs  per-player view, computed facts, legal actions, action → Showdown choice
src/match.mjs        Bo3 state machine, scaffold validation, prediction scoring
src/arena.mjs        match registry, pairing, waiting
src/tools.mjs        the tool catalog shared by MCP, HTTP and CLI
src/server.mjs       HTTP + MCP (/mcp) + spectator UI
src/mcp-stdio.mjs    stdio MCP bridge → server
src/cli.mjs          shell interface → server
src/bots.mjs         random / greedy baselines
src/artifacts.mjs    match.json, transcript.md, replays, results.jsonl
src/ratings.mjs      Bradley–Terry ratings
```

See [docs/DESIGN.md](docs/DESIGN.md) for why it's built this way.
