// End-to-end: a scripted MCP client plays a full best-of-3 against the greedy
// bot through a real transport, reading only the text a model would read.
//   node test/mcp-e2e.mjs stdio    (spawns src/mcp-stdio.mjs, which starts the arena if it is not running;
//                                   after joining, the client never sends its seat: the bridge remembers it)
//   node test/mcp-e2e.mjs http     (talks to http://127.0.0.1:3170/mcp)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'stdio';
const BASE = process.env.VGC_ARENA_URL || 'http://127.0.0.1:3170';

const client = new Client({name: 'e2e', version: '1'});
const transport = mode === 'http'
  ? new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`))
  : new StdioClientTransport({command: 'node', args: [path.join(ROOT, 'src/mcp-stdio.mjs')], env: {...process.env, VGC_ARENA_URL: BASE}});
await client.connect(transport);
const call = async (name, args) => (await client.callTool({name, arguments: args})).content[0].text;

const tools = (await client.listTools()).tools.map(t => t.name);
console.log(`[${mode}] tools:`, tools.join(', '));

let text = await call('arena_join', {name: `e2e-${mode}`, model: 'scripted', harness: `mcp-${mode}`, vs_bot: 'greedy'});
// Over stdio the bridge holds the seat, so a model that loses its token keeps playing.
const seat = mode === 'stdio' ? undefined : /SEAT TOKEN: (\S+)/.exec(text)[1];
if (!/SEAT TOKEN: \S+/.test(text)) throw new Error(`join failed: ${text.slice(0, 300)}`);
// Guided teambuilding, answered from a sample team file.
const STAT = {HP: 'hp', Atk: 'atk', Def: 'def', SpA: 'spa', SpD: 'spd', Spe: 'spe'};
const sets = fs.readFileSync(path.join(ROOT, 'teams/sample-room.txt'), 'utf8').trim().split(/\n\s*\n/).map(block => {
  const lines = block.split('\n').map(l => l.trim());
  const [species, item] = lines[0].split(' @ ').map(x => x.trim());
  const sp = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
  for (const part of (lines.find(l => l.startsWith('EVs:')) || '').slice(4).split('/')) {
    const [n, k] = part.trim().split(' ');
    if (STAT[k]) sp[STAT[k]] = Number(n);
  }
  return {species, item, sp, ability: lines.find(l => l.startsWith('Ability:')).slice(8).trim(),
    nature: lines.find(l => l.endsWith('Nature')).replace(' Nature', ''), moves: lines.filter(l => l.startsWith('- ')).map(l => l.slice(2))};
});
const answer = async args => {
  const out = await call('draft_answer', {seat, ...args});
  if (out.startsWith('NOT APPLIED')) throw new Error(out.slice(0, 400));
  return out;
};
text = await answer({concept: 'Trick Room: Hatterene/Sinistcha set it, Kingambit/Tyranitar abuse it.'});
// A wrong answer must be refused without changing anything.
const bad = await call('draft_answer', {seat, species: ['Notamon', ...sets.slice(1).map(s => s.species)]});
if (!bad.startsWith('NOT APPLIED') || !/QUESTION 2 of 9/.test(bad)) throw new Error(`expected a refusal, got: ${bad.slice(0, 200)}`);
text = await answer({species: sets.map(s => s.species)});
for (const [i, s] of sets.entries()) {
  if (!new RegExp(`Set for ${s.species}`).test(text)) throw new Error(`expected the set question for ${s.species}, got: ${text.slice(-400)}`);
  if (i === 0) {
    // One illegal field: the legal ones stay on the board and only the moves are asked again.
    const part = await call('draft_answer', {seat, ability: s.ability, item: s.item, nature: s.nature, sp: s.sp, moves: ['Notamove', ...s.moves.slice(1)]});
    if (!part.startsWith('PARTLY APPLIED') || !/Still needed: \d moves\./.test(part) || /Natures:/.test(part)) throw new Error(`expected a partial answer to keep the legal fields, got: ${part.slice(0, 600)}`);
    text = await answer({moves: s.moves});
    continue;
  }
  text = await answer({ability: s.ability, item: s.item, nature: s.nature, sp: s.sp, moves: s.moves});
}
text = await answer({team_plan: 'Hatterene and Sinistcha set Trick Room behind Indeedee; Kingambit and Tyranitar sweep under it.'});

let decisions = 0;
for (let guard = 0; guard < 400; guard++) {
  if (/FINISHED/.test(text.split('\n')[0]) || /MATCH FINISHED/.test(text)) break;
  if (!/YOUR TURN/.test(text.split('\n')[0])) { text = await call('arena_wait', {seat}); continue; }
  if (/TEAM PREVIEW/.test(text)) {
    text = await call('preview_submit', {seat, bring: ['Hatterene', 'Indeedee-F', 'Kingambit', 'Tyranitar'], game_plan: 'Follow Me + Trick Room, then sweep with Kingambit and Tyranitar.'});
    continue;
  }
  // Read YOUR OPTIONS as a model would: first non-Protect option per slot, no
  // two slots sending the same Pokémon, and a "switch" prediction per foe.
  const menu = text.slice(text.indexOf('YOUR OPTIONS:'), text.indexOf('ANSWER with turn_submit:'));
  const opts = {};
  let slot = null;
  for (const line of menu.split('\n')) {
    const head = /^\s+slot(\d) /.exec(line);
    if (head) { slot = `slot${head[1]}`; opts[slot] = []; continue; }
    if (slot) opts[slot].push(...(line.match(/\d:[a-z0-9]+(>[a-z0-9]+)?/g) || []));
  }
  const used = new Set();
  const actions = Object.fromEntries(Object.entries(opts).map(([k, ids]) => {
    const id = ids.find(x => !x.endsWith(':protect') && !(x.includes(':switch>') && used.has(x.split('>')[1]))) || ids[0];
    if (id.includes(':switch>')) used.add(id.split('>')[1]);
    return [k, id];
  }));
  const answer = text.slice(text.indexOf('ANSWER with turn_submit:'));
  const foes = [...answer.matchAll(/"(foe[12])"/g)].map(m => m[1]);
  const payload = {seat, actions, predictions: Object.fromEntries(foes.map(f => [f, {action: 'switch', confidence: 0.5}])), reason: 'scripted'};
  text = await call('turn_submit', payload);
  decisions++;
  if (text.startsWith('REJECTED')) { console.log(text); throw new Error('scripted client got rejected'); }
}
console.log(text.split('\n').slice(0, 3).join('\n'));
console.log(`[${mode}] decisions submitted: ${decisions}`);
await client.close();
if (!/MATCH FINISHED/.test(text)) process.exit(1);
