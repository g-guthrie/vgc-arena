#!/usr/bin/env node
// stdio MCP bridge for clients that launch MCP servers as subprocesses
// (Claude Code, Codex, most CLIs). It holds no state: every call is forwarded
// to the arena server, so two different clients share the same matches.
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {buildMcpServer} from './mcp-server.mjs';

const BASE = (process.env.VGC_ARENA_URL || 'http://127.0.0.1:3170').replace(/\/$/, '');

// The MCP client (Claude Code, Codex, …) identifies itself at initialize;
// forward that so the arena can cross-check the self-reported model.
async function call(name, args, clientInfo) {
  try {
    const res = await fetch(`${BASE}/api/tools/${name}`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-vgc-client': JSON.stringify({name: clientInfo?.name || '', version: clientInfo?.version || '', via: 'mcp-stdio'})},
      body: JSON.stringify(args || {}),
    });
    const data = await res.json();
    return data.text ?? data.error ?? JSON.stringify(data);
  } catch (err) {
    return `ERROR: cannot reach the arena server at ${BASE} (${err.message}). Start it with \`npm start\` in the vgc-arena repo.`;
  }
}

const server = buildMcpServer(call);
await server.connect(new StdioServerTransport());
