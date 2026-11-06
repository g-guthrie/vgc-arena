// End-to-end: a scripted MCP client plays a full best-of-3 against the greedy
// bot through a real transport, reading only the text a model would read.
//   node test/mcp-e2e.mjs stdio    (spawns src/mcp-stdio.mjs; server must be running)
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
const seat = /SEAT TOKEN: (\S+)/.exec(text)[1];
const team = fs.readFileSync(path.join(ROOT, 'teams/sample-room.txt'), 'utf8');

// A deliberately invalid team must be rejected without consuming anything.
text = await call('team_submit', {seat, team: 'Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt', team_plan: 'testing rejection path'});
if (!text.startsWith('REJECTED')) throw new Error(`expected rejection, got: ${text.slice(0, 200)}`);
text = await call('team_submit', {seat, team, team_plan: 'Trick Room: Hatterene/Sinistcha set it, Kingambit/Tyranitar abuse it.'});

let decisions = 0;
for (let guard = 0; guard < 400; guard++) {
  if (/FINISHED/.test(text.split('\n')[0]) || /MATCH FINISHED/.test(text)) break;
  if (!/YOUR TURN/.test(text.split('\n')[0])) { text = await call('arena_wait', {seat}); continue; }
  if (/TEAM PREVIEW/.test(text)) {
    text = await call('preview_submit', {seat, bring: ['Hatterene', 'Indeedee-F', 'Kingambit', 'Tyranitar'], key_threats: 'Charizard-Mega-Y sun spread damage; Garchomp Scarf.', game_plan: 'Follow Me + Trick Room, then sweep.', lessons: 'Keep Trick Room up.'});
    continue;
  }
  // Parse the LEGAL ACTIONS block exactly as a model would see it.
  const legal = text.slice(text.indexOf('LEGAL ACTIONS:')).split('\n').slice(1).filter(l => /^\s+slot \d/.test(l));
  const actions = [];
  const used = new Set();
  for (const line of legal) {
    const slot = Number(/slot (\d)/.exec(line)[1]);
    if (/fainted — no action/.test(line)) continue;
    const sw = /switch to (.+)$/.exec(line);
    if (sw) {
      const pickSw = sw[1].split(' | ').map(x => x.trim()).find(x => !used.has(x));
      if (pickSw) { used.add(pickSw); actions.push({slot, switch: pickSw}); }
      continue;
    }
    const body = line.slice(line.indexOf(':') + 1).split(' · ').map(x => x.trim());
    const mv = body.find(x => !x.startsWith('switch:') && !x.startsWith('MEGA') && x !== 'Protect' && !x.startsWith('(trapped)')) || body[0];
    const [name, targets] = mv.split(' →');
    const a = {slot, move: name.trim()};
    if (targets) a.target = targets.split('|')[0].trim();
    actions.push(a);
  }
  const payload = {seat, actions, reason: 'scripted', plan: 'on track', threats: 'scripted', win_condition: 'scripted', risk: 'scripted',
    predictions: [{foe: 'foe1', action: 'Protect', confidence: 0.4}, {foe: 'foe2', action: 'switch', confidence: 0.2}]};
  text = await call('turn_submit', payload);
  decisions++;
  if (text.startsWith('REJECTED')) { console.log(text); throw new Error('scripted client got rejected'); }
}
console.log(text.split('\n').slice(0, 3).join('\n'));
console.log(`[${mode}] decisions submitted: ${decisions}`);
await client.close();
if (!/MATCH FINISHED/.test(text)) process.exit(1);
