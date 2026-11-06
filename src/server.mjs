#!/usr/bin/env node
// The arena server: one process holds every match. Players reach it through
// MCP (HTTP at /mcp, or stdio via mcp-stdio.mjs), the CLI, or POST /api/tools/:name.
// Spectators get public information only until a match finishes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Arena} from './arena.mjs';
import {runTool, TOOLS} from './tools.mjs';
import {buildMcpServer} from './mcp-server.mjs';
import {ROOT_DIR, FORMAT_ID, SHOWDOWN_COMMIT} from './showdown.mjs';
import {HARNESS_VERSION} from './briefing.mjs';
import {sampleTeam} from './bots.mjs';

export function createServer({arena = new Arena()} = {}) {
  const publicDir = path.join(ROOT_DIR, 'public');

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Body must be JSON'), {status: 400}); }
  }
  const send = (res, status, data, type = 'application/json') => {
    res.writeHead(status, {'content-type': type, 'cache-control': 'no-store'});
    res.end(type === 'application/json' ? JSON.stringify(data, null, 1) : data);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      const parts = url.pathname.split('/').filter(Boolean);

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, {error: 'Stateless MCP endpoint: POST only.'});
        const payload = await body(req);
        const mcp = buildMcpServer((name, args) => runTool(arena, name, args));
        const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        res.on('close', () => { transport.close(); mcp.close(); });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, payload);
        return;
      }

      if (parts[0] === 'api') {
        if (parts[1] === 'info') return send(res, 200, {harness: HARNESS_VERSION, format: FORMAT_ID, showdownCommit: SHOWDOWN_COMMIT, tools: TOOLS.map(t => t.name)});
        if (parts[1] === 'tools' && parts[2] && req.method === 'POST') {
          const args = await body(req);
          const text = await runTool(arena, parts[2], args);
          return send(res, 200, {text});
        }
        if (parts[1] === 'matches' && !parts[2]) {
          if (req.method === 'POST') {
            const b = await body(req);
            const fixed = b.fixed_teams ? {
              p1: b.fixed_teams.p1 === 'sample' ? sampleTeam(0) : b.fixed_teams.p1,
              p2: b.fixed_teams.p2 === 'sample' ? sampleTeam(1) : b.fixed_teams.p2,
              builders: b.fixed_teams.builders || null, source: b.fixed_teams.source || null,
            } : null;
            const m = arena.createMatch({label: b.label, seed: b.seed, bestOf: b.best_of || 3, fixedTeams: fixed, createdBy: 'organizer'});
            if (b.reserved) m.reserved = true;
            for (const kind of [].concat(b.bots || [])) arena.addBot(m.id, kind);
            return send(res, 200, {id: m.id, phase: m.phase});
          }
          return send(res, 200, arena.list());
        }
        if (parts[1] === 'matches' && parts[2]) {
          const m = arena.get(parts[2]);
          if (parts[3] === 'bot' && req.method === 'POST') {
            const b = await body(req);
            arena.addBot(m.id, b.kind || 'greedy');
            return send(res, 200, {ok: true});
          }
          if (parts[3] === 'artifact') {
            if (m.phase !== 'finished') return send(res, 403, {error: 'Artifacts are available after the match finishes.'});
            return send(res, 200, m.artifact());
          }
          return send(res, 200, m.publicView());
        }
        return send(res, 404, {error: 'Not found'});
      }

      if (parts[0] === 'replay' && parts[1] && parts[2]) {
        const m = arena.get(parts[1]);
        const g = m.games[Number(parts[2]) - 1];
        if (!g) return send(res, 404, {error: 'No such game'});
        const {replayHtml} = await import('./artifacts.mjs');
        return send(res, 200, replayHtml(`${m.id} game ${g.n}`, g.game.spectatorLog()), 'text/html; charset=utf-8');
      }

      const file = path.join(publicDir, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
      if (file.startsWith(publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        return send(res, 200, fs.readFileSync(file), type);
      }
      return send(res, 404, {error: 'Not found'});
    } catch (err) {
      if (!res.headersSent) send(res, err.status || 400, {error: err.message});
    }
  });
  server.arena = arena;
  return server;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  const port = Number(process.env.PORT || 3170);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`VGC Arena ${HARNESS_VERSION} · ${FORMAT_ID} · showdown ${SHOWDOWN_COMMIT.slice(0, 10)}`);
    console.log(`  spectate:  http://${host}:${port}/`);
    console.log(`  MCP (HTTP): http://${host}:${port}/mcp`);
    console.log(`  artifacts: ${server.arena.artifactsDir}`);
  });
}
