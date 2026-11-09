#!/usr/bin/env node
// stdio MCP bridge for clients that launch MCP servers as subprocesses
// (Claude Code, Codex, most CLIs). Every call is forwarded to the arena
// server, so two different clients share the same matches.
//
// Two things make it hands-off:
//  - If the arena is local and not running, the bridge starts it. Whichever
//    client asks first wins; the others find it already up.
//  - It remembers the seat it was given, so a model that drops or garbles its
//    seat token (after a long match, or a context compaction) keeps playing.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {buildMcpServer} from './mcp-server.mjs';

const BASE = (process.env.VGC_ARENA_URL || 'http://127.0.0.1:3170').replace(/\/$/, '');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(BASE);
const LOCAL = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
const AUTOSTART = LOCAL && process.env.VGC_NO_AUTOSTART !== '1';

const up = () => fetch(`${BASE}/api/info`, {signal: AbortSignal.timeout(1500)}).then(r => r.ok, () => false);

let starting = null;
// Start the local arena, detached so it outlives this client, and wait for it.
function ensureArena() {
  return starting ||= (async () => {
    if (await up()) return null;
    if (!AUTOSTART) return `cannot reach the arena server at ${BASE}.`;
    if (!fs.existsSync(path.join(ROOT, 'vendor/pokemon-showdown/dist'))) {
      return `the arena is not set up yet. Ask your user to run \`npm install && npm run setup\` in ${ROOT} once, then try again.`;
    }
    const log = fs.openSync(path.join(ROOT, 'arena.log'), 'a');
    const child = spawn(process.execPath, [path.join(ROOT, 'src/server.mjs')], {
      cwd: ROOT, detached: true, stdio: ['ignore', log, log],
      env: {...process.env, PORT: url.port || '3170', HOST: '127.0.0.1'},
    });
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (await up()) return null;
    }
    return `the arena server did not start at ${BASE}. See ${path.join(ROOT, 'arena.log')}.`;
  })().finally(() => { starting = null; });
}

const seats = new Set();
const post = async (name, args, clientInfo) => {
  const res = await fetch(`${BASE}/api/tools/${name}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-vgc-client': JSON.stringify({name: clientInfo?.name || '', version: clientInfo?.version || '', via: 'mcp-stdio'})},
    body: JSON.stringify(args || {}),
  });
  const data = await res.json();
  return data.text ?? data.error ?? JSON.stringify(data);
};

// The MCP client (Claude Code, Codex, …) identifies itself at initialize;
// forward that so the arena can cross-check the self-reported model.
async function call(name, args = {}, clientInfo, tool) {
  const takesSeat = !!tool?.input?.seat;
  const only = seats.size === 1 ? [...seats][0] : null;
  const sent = {...args};
  if (takesSeat && !sent.seat && only) sent.seat = only;
  try {
    let text;
    try { text = await post(name, sent, clientInfo); } catch (err) {
      const problem = await ensureArena();
      if (problem) return `ERROR: ${problem}`;
      text = await post(name, sent, clientInfo);
    }
    // A mistyped token, when this bridge holds exactly one seat, is that seat.
    if (takesSeat && only && sent.seat !== only && /Unknown seat token/.test(text)) text = await post(name, {...sent, seat: only}, clientInfo);
    if (name === 'arena_join') { const m = /SEAT TOKEN: (\S+)/.exec(text); if (m) seats.add(m[1]); }
    if (/MATCH (FINISHED|ABANDONED)/.test(text) && sent.seat) seats.delete(sent.seat);
    return text;
  } catch (err) {
    return `ERROR: cannot reach the arena server at ${BASE} (${err.message}).`;
  }
}

const server = buildMcpServer(call, {seatOptional: true});
await server.connect(new StdioServerTransport());
