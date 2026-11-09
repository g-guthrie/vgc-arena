// Forfeits, decision clocks, abandoned rooms, and what the arena keeps in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Arena} from '../src/arena.mjs';
import {StatsDB} from '../src/db.mjs';
import {runTool} from '../src/tools.mjs';
import {Stats} from '../src/stats.mjs';
import {createServer} from '../src/server.mjs';
import {newMatch, toPreview, toBattle, playUntil, simpleAnswer, SUN, ROOM} from './helpers.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vgc-test-'));
const memDb = () => new StatsDB(':memory:');

test('forfeiting the game concedes one game and the set goes on', () => {
  const {m, a} = toBattle();
  assert.equal(m.game.n, 1);
  const r = m.forfeit(a, {scope: 'game'});
  assert.ok(!r.error, r.error);
  assert.equal(m.phase, 'preview');
  assert.equal(m.game.n, 2);
  assert.deepEqual(m.score, {p1: 0, p2: 1, ties: 0});
  assert.equal(m.games[0].winner, 'p2');
  assert.equal(m.games[0].forfeit, 'p1');
  assert.match(m.stateFor(a).text, /Game 1: you lost on turn \d+ \(you forfeited\)/);
});

test('a second game forfeit by the same side ends the match 0-2', () => {
  const {m, a} = toBattle();
  m.forfeit(a, {scope: 'game'});
  m.forfeit(a, {scope: 'game'});
  assert.equal(m.phase, 'finished');
  assert.equal(m.winner, 'p2');
  assert.equal(m.endReason, 'first to 2 game wins');
});

test('forfeiting during team preview or before any game loses that game / the match', () => {
  const pv = toPreview();
  pv.m.forfeit(pv.a, {scope: 'game'});
  assert.equal(pv.m.phase, 'preview');
  assert.equal(pv.m.game.n, 2);
  assert.equal(pv.m.score.p2, 1);
  const tb = newMatch();
  tb.m.forfeit(tb.a, {scope: 'game'});
  assert.equal(tb.m.phase, 'finished');
  assert.equal(tb.m.winner, 'p2');
  assert.match(tb.m.stateFor(tb.b).text, /your opponent forfeited the match/);
});

test('the decision clock forfeits a game, then the match on a second timeout', () => {
  const {m, a, b} = toBattle({clock: {decision: 1000, teambuild: 1000}});
  let now = 1e12;
  m.tick(now);
  assert.ok(m.deadline('p1') > now, 'clock started for p1');
  assert.match(m.stateFor(a).text, /DECISION/);
  m.tick(now + 500);
  assert.equal(m.phase, 'battle', 'not yet');
  m.tick(now + 1001);
  // Both sides owed turn 1; p1 is checked first and loses the game. That ends
  // the decision p2 owed, so p2's clock restarts rather than firing.
  assert.equal(m.timeouts.p1, 1);
  assert.equal(m.timeouts.p2, 0);
  assert.equal(m.game.n, 2, 'a timeout costs the game, not the set');
  assert.equal(m.phase, 'preview');
  // p2 answers the next preview; p1 goes quiet again.
  assert.ok(!m.submitPreview(b, {bring: ['Hatterene', 'Indeedee-F', 'Kingambit', 'Primarina'], game_plan: 'x'}).error);
  now += 5000;
  m.tick(now);
  m.tick(now + 1001);
  assert.equal(m.phase, 'finished', 'second timeout ends the match');
  assert.equal(m.winner, 'p2');
  assert.match(m.stateFor(b).text, /your opponent ran out of time/);
});

test('the clock restarts with every new decision, not once per phase', () => {
  const {m} = toBattle({clock: {decision: 1000, teambuild: 1000}});
  const f = {m, a: m.seats.p1.token, b: m.seats.p2.token};
  let now = 1e12;
  m.tick(now);
  playUntil(f, x => x.currentGame.turn >= 2, 2);
  m.tick(now + 900);
  assert.equal(m.pendingSince.p1, now + 900, 'turn 2 is a new decision, clock restarted');
  m.tick(now + 1500);
  assert.equal(m.phase, 'battle');
});

test('teambuilding has its own (longer) clock and a timeout there forfeits the match', () => {
  const {m} = newMatch({clock: {decision: 1000, teambuild: 5000}});
  m.tick(0);
  m.tick(2000);
  assert.equal(m.phase, 'teambuilding');
  m.tick(5001);
  assert.equal(m.phase, 'finished');
  assert.equal(m.winner, 'p2');
});

test('the state header tells a player how long they have', async () => {
  const dir = tmp();
  const arena = new Arena({artifactsDir: dir, db: memDb(), tickMs: 0});
  const m = arena.createMatch({label: 't', clock: {decision: 600000}});
  const {token} = m.join({name: 'A', model: 'a'});
  arena.byToken.set(token, m);
  m.join({name: 'B', model: 'b'});
  const text = await runTool(arena, 'arena_state', {seat: token});
  assert.match(text, /\d+ min to answer/);
  arena.close();
});

test('a room nobody joins is abandoned, unrated and unrecorded', () => {
  const dir = tmp();
  const arena = new Arena({artifactsDir: dir, db: memDb(), tickMs: 0, waitingTtlMs: 1000, retainMs: 0});
  const {match, token} = arena.join({name: 'A', model: 'a', room: 'new'}, {});
  arena.tick(Date.parse(match.createdAt) + 500);
  assert.equal(match.phase, 'waiting');
  arena.tick(Date.parse(match.createdAt) + 1500);
  assert.equal(match.phase, 'finished');
  assert.ok(match.abandoned);
  assert.ok(!arena.matches.has(match.id), 'released at once with retainMs 0');
  assert.equal(arena.db.get('select count(*) n from matches').n, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'matches', match.id)));
  assert.throws(() => arena.matchFor(token), /Unknown seat token/);
  arena.close();
});

test('a ladder seat waiting for the bot fallback is not abandoned', () => {
  const arena = new Arena({artifactsDir: tmp(), db: memDb(), tickMs: 0, waitingTtlMs: 1000});
  const {match} = arena.join({name: 'A', model: 'a', fallback_bot_after_sec: 3600}, {});
  arena.tick(Date.parse(match.createdAt) + 5000);
  assert.equal(match.phase, 'waiting');
  arena.close();
});

test('finished matches leave memory after the retain period and stay readable from the artifact', async () => {
  const arena = new Arena({artifactsDir: tmp(), db: memDb(), tickMs: 0, retainMs: 0});
  const m = arena.createMatch({label: 'gc', seed: 'gc'});
  arena.addBot(m.id, 'greedy');
  arena.addBot(m.id, 'random');
  await new Promise(r => m.once('finished', r));
  await new Promise(r => setImmediate(r));
  assert.ok(!arena.matches.has(m.id));
  assert.ok(!arena.rooms.has(m.room));
  assert.equal(arena.byToken.size, 0);
  const art = arena.artifactFor(m.id);
  assert.equal(art.id, m.id);
  assert.equal(art.players.p1.path, 'builtin');
  const text = await runTool(arena, 'match_transcript', {match_id: m.id});
  assert.match(text, new RegExp(`^# ${m.id}`));
  assert.equal(arena.db.get('select path from seats where match_id = ? and side = ?', m.id, 'p1').path, 'builtin');
  arena.close();
});

test('each seat records how it is connected', () => {
  const {m} = newMatch();
  assert.equal(m.seats.p1.path, 'mcp');
  assert.equal(m.seats.p2.path, 'api');
  assert.equal(m.publicView().players[1].path, 'api');
});

test('forfeiting the match awards the opponent every game still needed, and the ratings count them', () => {
  const arena = new Arena({artifactsDir: tmp(), db: memDb(), tickMs: 0});
  const {match, token} = arena.join({name: 'A', model: 'claude-opus-5-5', match_id: arena.createMatch({label: 'ff'}).id}, {});
  arena.join({name: 'B', model: 'claude-sonnet-5-5', match_id: match.id}, {});
  assert.equal(match.phase, 'teambuilding');
  match.forfeit(token, {scope: 'game'}); // nothing smaller than the match to concede yet
  assert.equal(match.phase, 'finished');
  assert.deepEqual([match.score.p1, match.score.p2], [0, 2]);
  assert.equal(match.awarded.length, 2);
  assert.match(match.stateFor(token).text, /You LOST the match 0–2 \(you forfeited the match\)/);
  const rows = arena.db.all('select n, winner, awarded from games where match_id = ? order by n', match.id);
  assert.deepEqual(rows.map(r => [r.n, r.winner, r.awarded]), [[1, 'p2', 1], [2, 'p2', 1]]);
  const stats = new Stats(arena.db);
  const lb = stats.leaderboard({boot: 0});
  assert.equal(lb.games, 2);
  assert.deepEqual(lb.rows.map(r => [r.model, r.w, r.l]), [['claude-sonnet-5-5', 2, 0], ['claude-opus-5-5', 0, 2]]);
  assert.equal(stats.summary().games, 0, 'awarded games are not played games');
  arena.close();
});

test('a match forfeit mid-set awards only the games still missing', () => {
  const {m, a, b} = toBattle();
  m.forfeit(b, {scope: 'game'});          // p1 leads 1–0
  m.forfeit(a);                           // p1 walks away in game 2
  assert.equal(m.winner, 'p2');
  assert.deepEqual([m.score.p1, m.score.p2], [1, 2]);
  assert.deepEqual(m.awarded.map(g => g.n), [3]);
  assert.equal(m.artifact().awardedGames.length, 1);
});

test('leaving a room before anyone joins abandons it instead of recording a win', () => {
  const arena = new Arena({artifactsDir: tmp(), db: memDb(), tickMs: 0, retainMs: 0});
  const {match, token} = arena.join({name: 'A', model: 'a', room: 'new'}, {});
  match.forfeit(token);
  assert.ok(match.abandoned);
  assert.equal(arena.db.get('select count(*) n from matches').n, 0);
  arena.close();
});

test('nobody can join as a baseline bot or claim to be builtin', () => {
  const arena = new Arena({artifactsDir: tmp(), db: memDb(), tickMs: 0});
  assert.throws(() => arena.join({name: 'x', model: 'builtin:greedy', room: 'new'}, {}), /baseline bots/);
  const {match, side} = arena.join({name: 'x', model: 'claude-opus-5-5', harness: 'builtin', room: 'new'}, {client: {via: 'http'}});
  assert.equal(match.seats[side].builtin, false);
  assert.equal(match.seats[side].path, 'http');
  // A harness name alone does not put a seat on the API path.
  const spoof = arena.join({name: 'y', model: 'claude-opus-5-5', harness: 'api:openai', room: 'new'}, {client: {via: 'http'}});
  assert.equal(spoof.match.seats[spoof.side].path, 'http');
  arena.close();
});

test('a submitted turn shows in the activity feed without the choice', () => {
  const {m, a} = toBattle();
  m.noteActivity(a, 'turn_submit', {seat: a, ...simpleAnswer(m, 'p1')}, true);
  const act = m.activity.at(-1);
  assert.equal(act.tool, 'turn_submit');
  assert.equal(act.detail, 'locks in the turn');
});

test('noWait submits acknowledge without rendering the next state', async () => {
  const arena = new Arena({artifactsDir: tmp(), db: memDb(), tickMs: 0});
  const m = arena.createMatch({label: 'nw', fixedTeams: {p1: SUN, p2: ROOM}});
  const {token} = arena.join({name: 'A', model: 'a', match_id: m.id}, {});
  arena.join({name: 'B', model: 'b', match_id: m.id}, {});
  const out = await runTool(arena, 'preview_submit', {seat: token, bring: ['Charizard', 'Whimsicott', 'Incineroar', 'Garchomp'], game_plan: 'x'}, {noWait: true});
  assert.equal(out, 'Preview locked in.');
  arena.close();
});

test('the server refuses oversized bodies and a forged hosted-agent marker', async () => {
  const server = createServer({arena: new Arena({artifactsDir: tmp(), db: memDb(), tickMs: 0})});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
  const big = await post('/api/tools/arena_state', {seat: 'x', pad: 'A'.repeat(400 * 1024)});
  assert.equal(big.status, 413);
  const join = await post('/api/tools/arena_join', {model: 'claude-opus-5-5', room: 'new'}, {'x-vgc-client': JSON.stringify({via: 'arena-api', name: 'arena-api/openai'})});
  const seat = /SEAT TOKEN: (\S+)/.exec((await join.json()).text)[1];
  const m = server.arena.matchFor(seat);
  assert.equal(m.seats.p1.path, 'http');
  assert.ok(!m.seats.p1.flags.includes('verified-api'));
  await new Promise(r => server.close(r));
});
