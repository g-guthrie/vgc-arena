#!/usr/bin/env node
// The arena server: one process holds every live match and the stats DB.
// Players reach it through MCP (HTTP at /mcp, or stdio via mcp-stdio.mjs), the
// CLI, or POST /api/tools/:name. Everyone else gets the public stats site.
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
import {Stats} from './stats.mjs';
import {listModels} from './models.mjs';
import {describeLines} from './game.mjs';
import {openSheet, parseTeam} from './dex-tools.mjs';
import {replayHtml} from './artifacts.mjs';

function clientFrom(req, mcpClient) {
  let fwd = {};
  try { fwd = JSON.parse(req.headers['x-vgc-client'] || '{}'); } catch {}
  return {
    name: mcpClient?.name || fwd.name || '',
    version: mcpClient?.version || fwd.version || '',
    via: fwd.via || (mcpClient ? 'mcp-http' : 'http'),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  };
}

// A finished match that is no longer in memory, rebuilt from its artifact.
function archivedView(art) {
  const sheets = {};
  for (const s of ['p1', 'p2']) {
    try { sheets[s] = openSheet(parseTeam(art.players[s].teamText)); } catch { sheets[s] = []; }
  }
  return {
    id: art.id, room: art.room || null, label: art.label, phase: 'finished', createdAt: art.createdAt, finishedAt: art.finishedAt, format: art.format, bestOf: art.bestOf,
    score: art.score, winner: art.winner, endReason: art.endReason, archived: true,
    players: ['p1', 'p2'].map(s => art.players[s] && {side: s, name: art.players[s].name, model: art.players[s].model, modelName: art.players[s].identity?.name,
      effort: art.players[s].identity?.effort || null, provider: art.players[s].identity?.provider, owner: art.players[s].owner, harness: art.players[s].harness, flags: art.players[s].flags, teamSubmitted: true}),
    sheets,
    games: art.games.map(g => ({n: g.n, winner: g.winner, turn: g.turns, endedAt: g.endedAt, log: describeLines(String(g.spectatorLog || '').split('\n'), 'spectator'), rawLog: g.displayLog || g.spectatorLog || ''})),
    teams: {p1: art.players.p1?.teamText, p2: art.players.p2?.teamText},
    teamPlans: {p1: art.players.p1?.teamPlan, p2: art.players.p2?.teamPlan},
    previews: art.games.map(g => ({n: g.n, ...g.preview})),
    decisions: art.decisions.map(({observation, ...d}) => d),
    events: art.events.slice(-50),
  };
}

// Server-sent events for spectators: public state plus new protocol lines.
function streamMatch(m, req, res) {
  res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*'});
  const sent = {};
  let pending = null;
  const push = () => {
    pending = null;
    const view = m.publicView();
    const lite = {...view, games: view.games.map(g => ({n: g.n, winner: g.winner, turn: g.turn, endedAt: g.endedAt}))};
    res.write(`event: state\ndata: ${JSON.stringify(lite)}\n\n`);
    for (const g of m.games) {
      const lines = m.spectatorLines(g.n);
      const from = sent[g.n] || 0;
      if (lines.length > from) {
        res.write(`event: lines\ndata: ${JSON.stringify({n: g.n, from, lines: lines.slice(from)})}\n\n`);
        sent[g.n] = lines.length;
      }
    }
    if (m.phase === 'finished') res.write('event: finished\ndata: {}\n\n');
  };
  const onChange = () => { pending ||= setTimeout(push, 150); };
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  m.on('change', onChange);
  m.on('finished', onChange);
  req.on('close', () => { clearInterval(ping); clearTimeout(pending); m.off('change', onChange); m.off('finished', onChange); });
  push();
}

export function createServer({arena = new Arena()} = {}) {
  const publicDir = path.join(ROOT_DIR, 'public');
  const stats = new Stats(arena.db);

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Body must be JSON'), {status: 400}); }
  }
  const send = (res, status, data, type = 'application/json') => {
    res.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*'});
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  const loadArtifact = id => {
    const row = arena.db.get('select artifact_dir from matches where id = ?', id);
    if (!row?.artifact_dir) return null;
    const file = path.join(row.artifact_dir, 'match.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      const q = Object.fromEntries(url.searchParams);
      const parts = url.pathname.split('/').filter(Boolean);

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, {error: 'Stateless MCP endpoint: POST only.'});
        const payload = await body(req);
        // Stateless mode: clientInfo only arrives with initialize, so tool calls mostly identify by user-agent.
        const mcp = buildMcpServer((name, args, info) => runTool(arena, name, args, {client: clientFrom(req, info)}));
        const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
        res.on('close', () => { transport.close(); mcp.close(); });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, payload);
        return;
      }

      // Short share links: /r/K7QX
      if (parts[0] === 'r' && parts[1]) {
        res.writeHead(302, {location: `/#/room/${encodeURIComponent(parts[1].toUpperCase())}`});
        return res.end();
      }

      if (parts[0] === 'api') {
        const [, a, b, c] = parts;
        if (a === 'info') return send(res, 200, {harness: HARNESS_VERSION, format: FORMAT_ID, showdownCommit: SHOWDOWN_COMMIT, tools: TOOLS.map(t => t.name), models: listModels()});
        if (a === 'tools' && b && req.method === 'POST') {
          const args = await body(req);
          return send(res, 200, {text: await runTool(arena, b, args, {client: clientFrom(req)})});
        }
        if (a === 'stats') {
          const opts = {by: q.by || 'pilot', group: q.group || 'model', includeUnlisted: q.unlisted === '1'};
          if (b === 'summary') return send(res, 200, stats.summary());
          if (b === 'leaderboard') return send(res, 200, stats.leaderboard(opts));
          if (b === 'h2h') return send(res, 200, stats.headToHead(opts));
          if (b === 'pokemon') return send(res, 200, stats.pokemon({model: q.model}));
          if (b === 'model' && c) return send(res, 200, stats.model(decodeURIComponent(c)));
          return send(res, 404, {error: 'Unknown stats view'});
        }
        if (a === 'rooms' && b) {
          const code = b.toUpperCase();
          const live = arena.rooms.get(code);
          if (live) return send(res, 200, {matchId: live.id, room: code, live: live.phase !== 'finished'});
          const row = arena.db.get('select id from matches where room = ?', code);
          if (row) return send(res, 200, {matchId: row.id, room: code, live: false});
          return send(res, 404, {error: `No room ${code}`});
        }
        if (a === 'matches' && !b) {
          if (req.method === 'POST') {
            const p = await body(req);
            const fixed = p.fixed_teams ? {
              p1: p.fixed_teams.p1 === 'sample' ? sampleTeam(0) : p.fixed_teams.p1,
              p2: p.fixed_teams.p2 === 'sample' ? sampleTeam(1) : p.fixed_teams.p2,
              builders: p.fixed_teams.builders || null, source: p.fixed_teams.source || null,
            } : null;
            const m = arena.createMatch({label: p.label, seed: p.seed, bestOf: p.best_of || 3, fixedTeams: fixed, createdBy: 'organizer'});
            if (p.reserved) m.reserved = true;
            for (const kind of [].concat(p.bots || [])) arena.addBot(m.id, kind);
            return send(res, 200, {id: m.id, phase: m.phase});
          }
          return send(res, 200, {live: arena.live(), finished: stats.matches({model: q.model, limit: Number(q.limit) || 100})});
        }
        if (a === 'matches' && b) {
          const m = arena.matches.get(b);
          if (!m) {
            const art = loadArtifact(b);
            if (!art) return send(res, 404, {error: 'No such match'});
            return send(res, 200, archivedView(art));
          }
          if (c === 'stream') return streamMatch(m, req, res);
          if (c === 'bot' && req.method === 'POST') { const p = await body(req); arena.addBot(m.id, p.kind || 'greedy'); return send(res, 200, {ok: true}); }
          if (c === 'artifact') {
            if (m.phase !== 'finished') return send(res, 403, {error: 'Artifacts are available after the match finishes.'});
            return send(res, 200, m.artifact());
          }
          return send(res, 200, m.publicView());
        }
        return send(res, 404, {error: 'Not found'});
      }

      if (parts[0] === 'replay' && parts[1] && parts[2]) {
        const m = arena.matches.get(parts[1]);
        if (m) {
          const g = m.games[Number(parts[2]) - 1];
          if (!g) return send(res, 404, {error: 'No such game'});
          return send(res, 200, replayHtml(`${m.id} game ${g.n}`, g.game.spectatorLog()), 'text/html; charset=utf-8');
        }
        const art = loadArtifact(parts[1]);
        const g = art?.games[Number(parts[2]) - 1];
        if (!g) return send(res, 404, {error: 'No such game'});
        return send(res, 200, replayHtml(`${art.id} game ${g.n}`, g.spectatorLog), 'text/html; charset=utf-8');
      }

      const rel = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, '');
      const file = path.join(publicDir, rel);
      if (file.startsWith(publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        return send(res, 200, fs.readFileSync(file), type);
      }
      // Single-page app: unknown paths fall back to the shell.
      if (!path.extname(url.pathname)) return send(res, 200, fs.readFileSync(path.join(publicDir, 'index.html')), 'text/html; charset=utf-8');
      return send(res, 404, {error: 'Not found'});
    } catch (err) {
      if (!res.headersSent) send(res, err.status || 400, {error: err.message});
    }
  });
  server.arena = arena;
  return server;
}

if (process.argv[1]?.endsWith('server.mjs')) {
  const port = Number(process.env.PORT || 3170);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`VGC Arena ${HARNESS_VERSION} · ${FORMAT_ID} · showdown ${SHOWDOWN_COMMIT.slice(0, 10)}`);
    console.log(`  site:       http://${host}:${port}/`);
    console.log(`  MCP (HTTP): http://${host}:${port}/mcp`);
    console.log(`  data:       ${server.arena.artifactsDir}`);
  });
}
