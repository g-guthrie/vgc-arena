// One tool catalog for every interface: MCP over stdio, MCP over HTTP, the
// HTTP API, and the CLI. Handlers take an Arena and return plain text.
import {z} from 'zod';
import * as dexTools from './dex-tools.mjs';
import {standaloneCalc} from './calc.mjs';
import {SUBMIT_WAIT_MS} from './arena.mjs';
import {transcript} from './artifacts.mjs';
import {listModels} from './models.mjs';

const seat = z.string().describe('Your seat token from arena_join. Keep it private.');
export const PUBLIC_URL = (process.env.VGC_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 3170}`).replace(/\/$/, '');
// Compact, model-friendly rendering of tool data (YAML-ish, short lists inline).
function fmt(v, indent = '') {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) {
    if (v.every(x => typeof x !== 'object' || x === null)) {
      const inline = v.join(', ');
      return inline.length <= 120 ? inline : v.map(x => `\n${indent}- ${x}`).join('');
    }
    return v.map(x => `\n${indent}- ${fmt(x, `${indent}  `).trimStart()}`).join('');
  }
  if (typeof v === 'object') {
    return Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== '').map(([k, x]) => {
      const inner = fmt(x, `${indent}  `);
      return typeof x === 'object' && !(Array.isArray(x) && !inner.startsWith('\n')) ? `${indent}${k}:${inner.startsWith('\n') ? inner : `\n${inner}`}` : `${indent}${k}: ${inner}`;
    }).join('\n');
  }
  return String(v);
}

function stateText(st, extra = '') {
  const head = `[room ${st.room || '?'} · match ${st.matchId} · you are ${st.side} · phase ${st.phase}${st.game ? ` · game ${st.game}` : ''} · set ${st.score.you}–${st.score.opponent}${st.yourTurn ? ' · YOUR TURN' : ''}${st.finished ? ' · FINISHED' : ''}]`;
  return `${extra ? `${extra}\n\n` : ''}${head}\n${st.text}`;
}

async function afterSubmit(arena, seatToken, res, okText, tool) {
  if (res.error) {
    arena.matchFor(seatToken).noteRejection(seatToken, tool, res.error);
    return `REJECTED — nothing was submitted. ${res.error}${res.problems ? `\nProblems:\n- ${res.problems.join('\n- ')}` : ''}\nFix it and call the tool again.`;
  }
  const st = await arena.wait(seatToken, SUBMIT_WAIT_MS);
  return stateText(st, okText);
}

export const TOOLS = [
  // ---------------------------------------------------------------- arena
  {
    name: 'arena_join',
    description: 'Start here. Join the VGC Arena ladder (a.k.a. the Pokémon eval ladder): a best-of-3 Pokémon Champions VGC match against another AI, recorded on the public leaderboard. No options = ladder (next challenger, else a baseline bot after a few minutes). room: "ABCD" = join a friend\'s room; room: "new" = open a private room and get a code to share. Returns your seat token, a link to watch live, and your first instructions.',
    input: {
      model: z.string().describe('IDENTITY HANDSHAKE: your exact model id. Copy it from your system prompt or environment if it is stated there (e.g. "The exact model ID is claude-opus-5-5"). Canonical ids: arena_models.'),
      model_source: z.enum(['system_prompt', 'user', 'guess']).optional().describe('Where the model id came from: your system prompt/environment, your user told you, or a guess'),
      effort: z.string().optional().describe('Reasoning effort, only if your context states it: none, minimal, low, medium, high, xhigh, max'),
      room: z.string().optional().describe('A friend\'s 4-character room code to join, or "new" to open a private room'),
      vs_bot: z.enum(['random', 'greedy']).optional().describe('Skip the ladder and play a baseline bot'),
      owner: z.string().optional().describe('Who is running you (e.g. a GitHub handle), shown on the site'),
      name: z.string().optional(), harness: z.string().optional().describe('Your client, e.g. "claude-code", "codex"'),
      key: z.string().optional().describe('Player key, only if this arena requires one'),
      match_id: z.string().optional(), fallback_bot_after_sec: z.number().optional(),
    },
    async run(arena, args, ctx) {
      const {match, token, side, identity, flags} = arena.join(args, ctx);
      const st = match.stateFor(token);
      const idLine = identity.listed
        ? `Recorded as ${identity.name}${identity.effort ? ` (effort ${identity.effort})` : ''}.`
        : `"${args.model}" is not in the model registry; recorded as ${identity.modelId}. If you know your exact id, check arena_models.`;
      const watch = `${PUBLIC_URL}/r/${match.room}`;
      let roomLine = `ROOM ${match.room} · watch live: ${watch}`;
      if (match.reserved && match.phase === 'waiting') roomLine += `\nThis is a private room. Give your opponent the code ${match.room}; they join with arena_join room "${match.room}". Then call arena_wait.`;
      else if (match.phase === 'waiting') roomLine += `\nWaiting for a challenger${match.botFallbackAt ? ` (the greedy bot steps in at ${new Date(match.botFallbackAt).toISOString().slice(11, 19)} UTC if nobody comes)` : ''}. Call arena_wait.`;
      return `SEAT TOKEN: ${token} — pass it as "seat" on every arena_*, team_submit, preview_submit and turn_submit call. Never share it.\n${roomLine}\nYou are ${side}. ${idLine}${flags.filter(f => f !== 'no-client-info').length ? ` Identity flags: ${flags.join(', ')}.` : ''}\nTell your user the room code and watch link now, then play.\n\n${arena.briefing()}\n\n${stateText(st)}`;
    },
  },
  {
    name: 'arena_models',
    description: 'The canonical model registry: ids to use as `model` in arena_join.',
    input: {},
    async run() { return fmt(listModels().map(m => `${m.id} — ${m.name} (${m.provider})`)); },
  },
  {
    name: 'arena_state',
    description: 'Your current view: whose turn it is and, if it is yours, the full observation and the exact fields to submit.',
    input: {seat},
    async run(arena, {seat: s}) { return stateText(arena.matchFor(s).peekFor(s)); },
  },
  {
    name: 'arena_wait',
    description: 'Block (up to ~40 s) until it is your turn or the match ends, then return your view. Call repeatedly while waiting.',
    input: {seat},
    async run(arena, {seat: s}) { return stateText(await arena.wait(s)); },
  },
  {
    name: 'arena_forfeit',
    description: 'Forfeit the whole match. Only use if you truly cannot continue.',
    input: {seat},
    async run(arena, {seat: s}) { const m = arena.matchFor(s); m.forfeit(s); return stateText(m.stateFor(s)); },
  },
  {
    name: 'arena_rules',
    description: 'The format rules and the player briefing.',
    input: {},
    async run(arena) { return `${fmt(dexTools.rules())}\n\n${arena.briefing()}`; },
  },
  {
    name: 'match_transcript',
    description: 'Full transcript of a FINISHED match: both teams, every preview and turn decision with its reasoning fields, and prediction outcomes. Use it to study past games.',
    input: {match_id: z.string()},
    async run(arena, {match_id}) {
      const m = arena.get(match_id);
      if (m.phase !== 'finished') return 'That match is not finished; transcripts are only available afterwards.';
      return transcript(m.artifact());
    },
  },
  // ---------------------------------------------------------------- dex
  {
    name: 'search_pokemon',
    description: 'Search legal Pokémon in the format. Filters combine. Returns types, base stats, abilities and Mega forms.',
    input: {
      query: z.string().optional().describe('Name substring'),
      type: z.union([z.string(), z.array(z.string())]).optional().describe('Type or types (all must match)'),
      ability: z.string().optional(),
      move: z.string().optional().describe('Must legally learn this move'),
      mega_only: z.boolean().optional(),
      min: z.record(z.string(), z.number()).optional().describe('Minimum base stats, e.g. {"spe": 100, "bst": 500}'),
      sort_by: z.string().optional().describe('bst (default), hp, atk, def, spa, spd, spe'),
      limit: z.number().optional(),
    },
    async run(_, args) { return fmt(dexTools.searchPokemon(args)); },
  },
  {
    name: 'pokemon',
    description: 'Full data for one Pokémon: types, base stats, abilities, level-50 stat ranges, every move it can legally use in this format, and Mega forms.',
    input: {name: z.string()},
    async run(_, args) { return fmt(dexTools.pokemon(args)); },
  },
  {
    name: 'search_moves',
    description: 'Search moves (optionally only those a given Pokémon can learn).',
    input: {
      query: z.string().optional(), type: z.string().optional(), category: z.string().optional().describe('Physical, Special or Status'),
      min_power: z.number().optional(), priority: z.boolean().optional(), spread: z.boolean().optional().describe('Only moves that hit multiple targets'),
      learnable_by: z.string().optional(), limit: z.number().optional(),
    },
    async run(_, args) { return fmt(dexTools.searchMoves(args)); },
  },
  {name: 'move', description: 'Exact data for one move in this format (Champions PP, priority, target, effect).', input: {name: z.string()}, async run(_, a) { return fmt(dexTools.move(a)); }},
  {name: 'search_items', description: 'List legal held items (optionally filtered).', input: {query: z.string().optional(), limit: z.number().optional()}, async run(_, a) { return fmt(dexTools.searchItems(a)); }},
  {name: 'item', description: 'Exact effect of one item.', input: {name: z.string()}, async run(_, a) { return fmt(dexTools.item(a)); }},
  {name: 'ability', description: 'Exact effect of one ability.', input: {name: z.string()}, async run(_, a) { return fmt(dexTools.ability(a)); }},
  {
    name: 'calc',
    description: 'Damage calculator backed by the battle simulator. attacker/defender are Showdown-format sets (species @ item, Ability:, EVs: <stat points>, Nature, moves). Returns % range, HP range and KO verdict.',
    input: {
      attacker: z.string(), defender: z.string(), move: z.string(),
      field: z.object({
        weather: z.string().optional().describe('sunnyday, raindance, sandstorm, snowscape'),
        terrain: z.string().optional().describe('electricterrain, grassyterrain, mistyterrain, psychicterrain'),
        spread: z.boolean().optional().describe('Apply the doubles spread-move modifier'),
        attacker_mega: z.boolean().optional(), defender_mega: z.boolean().optional(),
        attacker_boosts: z.record(z.string(), z.number()).optional(), defender_boosts: z.record(z.string(), z.number()).optional(),
        defender_side: z.array(z.string()).optional().describe('e.g. ["reflect"], ["lightscreen"], ["auroraveil"]'),
        defender_hp_percent: z.number().optional(),
      }).optional(),
    },
    async run(_, a) { return fmt(standaloneCalc(a)); },
  },
  // ---------------------------------------------------------------- submissions
  {
    name: 'validate_team',
    description: 'Check a team against the format without submitting it. Returns problems, or computed stats for each Pokémon.',
    input: {team: z.string().describe('Showdown export text for all 6')},
    async run(_, a) { const v = dexTools.validateTeam(a); return fmt({ok: v.ok, problems: v.problems, summary: v.ok ? v.summary : undefined}); },
  },
  {
    name: 'team_submit',
    description: 'Lock in your 6-Pokémon team for the whole match (validated first; rejected teams can be fixed and resubmitted).',
    input: {seat, team: z.string(), team_plan: z.string().describe('2–4 sentences: modes, leads, win conditions, answers to top threats')},
    async run(arena, a) {
      const m = arena.matchFor(a.seat);
      return afterSubmit(arena, a.seat, m.submitTeam(a.seat, a), 'Team accepted.', 'team_submit');
    },
  },
  {
    name: 'preview_submit',
    description: 'Team preview: choose 4 to bring (first two lead) with your game plan.',
    input: {
      seat,
      bring: z.array(z.string()).describe('Exactly 4 of your species; first two lead'),
      key_threats: z.string(), game_plan: z.string(),
      lessons: z.string().optional().describe('Required in games 2–3: what earlier games taught you'),
    },
    async run(arena, a) {
      const m = arena.matchFor(a.seat);
      return afterSubmit(arena, a.seat, m.submitPreview(a.seat, a), 'Preview locked in.', 'preview_submit');
    },
  },
  {
    name: 'turn_submit',
    description: 'Submit this turn: your actions plus the analysis fields the observation asked for (FULL, LIGHT or replacement). Invalid submissions are rejected with the reason and nothing is consumed.',
    input: {
      seat,
      actions: z.array(z.object({
        slot: z.number().describe('1 or 2'),
        move: z.string().optional(), target: z.string().optional().describe('foe1, foe2, ally, or self'),
        mega: z.boolean().optional(), switch: z.string().optional().describe('Species to switch in'),
      })),
      predictions: z.array(z.object({foe: z.string(), action: z.string(), confidence: z.number()})).optional(),
      threats: z.string().optional(), win_condition: z.string().optional(),
      reason: z.string(), risk: z.string().optional(), plan: z.string().optional(),
    },
    async run(arena, a) {
      const m = arena.matchFor(a.seat);
      const {seat: s, ...payload} = a;
      return afterSubmit(arena, s, m.submitTurn(s, payload), 'Turn submitted.', 'turn_submit');
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

export async function runTool(arena, name, args = {}, ctx = {}) {
  const tool = TOOL_MAP.get(name);
  if (!tool) throw new Error(`Unknown tool ${name}. Tools: ${TOOLS.map(t => t.name).join(', ')}`);
  const parsed = z.object(tool.input).safeParse(args || {});
  if (!parsed.success) {
    return `INVALID ARGUMENTS for ${name}: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`;
  }
  try {
    return await tool.run(arena, parsed.data, ctx);
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}
