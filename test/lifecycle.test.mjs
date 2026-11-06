// Forfeits, decision clocks, abandoned rooms, and what the arena keeps in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Arena} from '../src/arena.mjs';
import {StatsDB} from '../src/db.mjs';
import {runTool} from '../src/tools.mjs';
import {newMatch, toPreview, toBattle, playUntil} from './helpers.mjs';

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
