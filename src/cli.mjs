#!/usr/bin/env node
// Same tools as the MCP server, for agents that only have a shell.
//   vgc <tool> '<json args>'        e.g. vgc arena_join '{"name":"A","model":"x"}'
//   vgc <tool> --key value ...       e.g. vgc pokemon --name Incineroar
//   vgc tools                        list tools and their arguments
//   vgc match <id>                   public view of a match (JSON)
import {TOOLS} from './tools.mjs';

const BASE = (process.env.VGC_ARENA_URL || 'http://127.0.0.1:3170').replace(/\/$/, '');
const [cmd, ...rest] = process.argv.slice(2);

function parseArgs(rest) {
  if (!rest.length) return {};
  if (rest[0].trim().startsWith('{')) return JSON.parse(rest.join(' '));
  const out = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i].replace(/^--/, '');
    let v = rest[i + 1];
    i++;
    if (v === undefined) v = 'true';
    try { out[k] = JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log('usage: vgc <tool> [json | --key value ...]\n       vgc tools\n       vgc match <id>\n\nServer:', BASE);
    return;
  }
  if (cmd === 'tools') {
    for (const t of TOOLS) console.log(`${t.name}(${Object.keys(t.input).join(', ')})\n    ${t.description}`);
    return;
  }
  if (cmd === 'match' || cmd === 'matches') {
    const res = await fetch(`${BASE}/api/matches${rest[0] ? `/${rest[0]}` : ''}`);
    console.log(JSON.stringify(await res.json(), null, 1));
    return;
  }
  let args;
  if (rest[0] === '-') {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } else args = parseArgs(rest);
  const res = await fetch(`${BASE}/api/tools/${cmd}`, {method: 'POST', headers: {'content-type': 'application/json', 'x-vgc-client': JSON.stringify({name: process.env.VGC_CLIENT || 'vgc-cli', version: '1', via: 'cli'})}, body: JSON.stringify(args)});
  const data = await res.json();
  console.log(data.text ?? data.error ?? JSON.stringify(data));
}

main().catch(err => { console.error(`vgc: ${err.message}${err.cause ? ` (${err.cause.message})` : ''}`); process.exit(1); });
