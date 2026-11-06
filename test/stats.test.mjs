// Ratings: the Bradley–Terry fit, and leaderboard rows split by effort or by
// connection path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fitBT, expected, rowKey, Stats} from '../src/stats.mjs';
import {StatsDB} from '../src/db.mjs';
import {Arena} from '../src/arena.mjs';

test('Bradley–Terry orders players by results and centers on 1500', () => {
  const pairs = [];
  for (let i = 0; i < 30; i++) { pairs.push(['a', 'b', 1], ['b', 'c', 1], ['a', 'c', 1]); }
  pairs.push(['b', 'a', 1], ['c', 'b', 1]);
  const r = fitBT(pairs, ['a', 'b', 'c']);
  assert.ok(r.a > r.b && r.b > r.c, JSON.stringify(r));
  const mean = (r.a + r.b + r.c) / 3;
  assert.ok(Math.abs(mean - 1500) < 1e-6);
  assert.ok(expected(r.a, r.c) > 0.9);
  assert.ok(Math.abs(expected(1500, 1500) - 0.5) < 1e-12);
  // An undefeated player stays finite thanks to the virtual half game.
  const u = fitBT([['x', 'y', 1], ['x', 'y', 1]], ['x', 'y']);
  assert.ok(Number.isFinite(u.x) && u.x > u.y);
});

test('row keys split by effort or by connection path', () => {
  assert.equal(rowKey('model', 'm', 'high', 'mcp'), 'm');
  assert.equal(rowKey('effort', 'm', 'high', 'mcp'), 'm|high');
  assert.equal(rowKey('effort', 'm', '', 'mcp'), 'm|default');
  assert.equal(rowKey('path', 'm', 'high', 'api'), 'm|api');
  assert.equal(rowKey('path', 'm', 'high', ''), 'm|http');
});

test('the leaderboard splits the same model by how it was connected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgc-stats-'));
  const db = new StatsDB(':memory:');
  const arena = new Arena({artifactsDir: dir, db, tickMs: 0, retainMs: 0});
  // Two bot matches; relabel one seat afterwards so the same "model" shows up on two paths.
  for (let i = 0; i < 2; i++) {
    const m = arena.createMatch({label: `s${i}`, seed: `s${i}`});
    arena.addBot(m.id, 'greedy');
    arena.addBot(m.id, 'random');
    await new Promise(r => m.once('finished', r));
  }
  db.db.exec(`update seats set path = 'api' where side = 'p1' and match_id = (select id from matches order by finished_at limit 1)`);
  db.version++;
  const stats = new Stats(db);
  const byModel = stats.leaderboard({group: 'model', boot: 5});
  assert.equal(byModel.rows.length, 2);
  const byPath = stats.leaderboard({group: 'path', boot: 5});
  assert.equal(byPath.rows.length, 3, byPath.rows.map(r => r.key).join(', '));
  const greedy = byPath.rows.filter(r => r.model === 'builtin:greedy');
  assert.deepEqual(greedy.map(r => r.split).sort(), ['api', 'builtin']);
  assert.ok(greedy.every(r => r.path === r.split && r.effort === null));
  const h2h = stats.headToHead({group: 'path', boot: 5});
  assert.equal(h2h.models.length, 3);
  assert.ok(h2h.models.every(mm => mm.split));
  arena.close();
});
