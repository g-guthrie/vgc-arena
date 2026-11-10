// Every finished match lands here. The website's statistics are queries over
// this database; match.json artifacts remain the full-fidelity record.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {ROOT_DIR, dex, toID} from './showdown.mjs';

// node:sqlite still prints an ExperimentalWarning on import; keep logs clean.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
const {DatabaseSync} = createRequire(import.meta.url)('node:sqlite');
process.emitWarning = emit;

const SCHEMA = `
create table if not exists matches (
  id text primary key, label text, created_at text, finished_at text, format text,
  harness_version text, showdown_commit text, winner text, end_reason text,
  score_p1 int, score_p2 int, ties int, fixed_teams int, rated int, artifact_dir text
);
create table if not exists seats (
  match_id text, side text, name text, owner text, owner_verified int,
  model_raw text, model_id text, model_name text, provider text, listed int, effort text,
  harness text, client_name text, client_version text, user_agent text, detected_harness text, flags text,
  builder_model_id text, team_text text, team_plan text, team_hash text, team_attempts int, rejections int,
  predictions int, predictions_correct int, brier_sum real, median_think_ms int,
  primary key (match_id, side)
);
create table if not exists games (match_id text, n int, winner text, turns int, primary key (match_id, n));
create table if not exists team_mons (
  match_id text, side text, species text, item text, ability text, nature text, moves text, sp text,
  primary key (match_id, side, species)
);
create table if not exists brings (
  match_id text, game int, side text, species text, slot int, lead int, won int,
  primary key (match_id, game, side, species)
);
create index if not exists seats_model on seats(model_id);
create index if not exists brings_species on brings(species);
`;

export class StatsDB {
  constructor(file) {
    this.file = file || process.env.VGC_DB || path.join(process.env.VGC_ARTIFACTS || path.join(ROOT_DIR, 'artifacts'), 'arena.db');
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    this.db = new DatabaseSync(this.file);
    this.db.exec('pragma journal_mode = wal;');
    this.db.exec(SCHEMA);
    const cols = t => this.db.prepare(`pragma table_info(${t})`).all().map(c => c.name);
    if (!cols('matches').includes('room')) this.db.exec('alter table matches add column room text');
    if (!cols('seats').includes('model_source')) this.db.exec('alter table seats add column model_source text');
    if (!cols('seats').includes('path')) this.db.exec('alter table seats add column path text');
    if (!cols('seats').includes('timeouts')) this.db.exec('alter table seats add column timeouts int');
    // 1 = a game given to the opponent by a match forfeit; it was never played.
    if (!cols('games').includes('awarded')) this.db.exec('alter table games add column awarded int default 0');
    this.version = 0;
  }

  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }

  recordMatch(match, artifactDir) {
    const art = match.artifact();
    const ins = (sql, ...p) => this.db.prepare(sql).run(...p);
    this.db.exec('begin');
    try {
      const rated = art.winner && art.endReason !== 'aborted' ? 1 : 0;
      ins(`insert or replace into matches (id, label, created_at, finished_at, format, harness_version, showdown_commit, winner, end_reason,
        score_p1, score_p2, ties, fixed_teams, rated, artifact_dir, room) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        art.id, art.label || '', art.createdAt, art.finishedAt, art.format, art.harnessVersion, art.showdownCommit,
        art.winner, art.endReason, art.score.p1, art.score.p2, art.score.ties, match.fixedTeams ? 1 : 0, rated, artifactDir || '', match.room || null);
      for (const side of ['p1', 'p2']) {
        const seat = match.seats[side];
        if (!seat) continue;
        const scores = art.decisions.filter(d => d.side === side).flatMap(d => (d.predictionScores || []).filter(x => x.actual !== null));
        const thinks = art.decisions.filter(d => d.side === side && d.thinkMs).map(d => d.thinkMs).sort((a, b) => a - b);
        const id = seat.identity || {};
        ins(`insert or replace into seats (match_id, side, name, owner, owner_verified, model_raw, model_id, model_name, provider, listed, effort,
          harness, client_name, client_version, user_agent, detected_harness, flags, builder_model_id, team_text, team_plan, team_hash, team_attempts, rejections,
          predictions, predictions_correct, brier_sum, median_think_ms, model_source, path, timeouts) values (${Array(30).fill('?').join(',')})`,
          art.id, side, seat.name, seat.owner || '', seat.ownerVerified ? 1 : 0,
          id.raw || seat.model, seat.model, id.name || seat.model, id.provider || 'unknown', id.listed ? 1 : 0, id.effort || '',
          seat.harness || '', seat.client?.name || '', seat.client?.version || '', seat.client?.userAgent || '', seat.detectedHarness || '', JSON.stringify(seat.flags || []),
          match.fixedTeams?.builders?.[side] || seat.model, seat.teamText || '', seat.teamPlan || '', seat.teamHash || '', seat.teamAttempts || 0, (art.rejections?.[side] || []).length,
          scores.length, scores.filter(x => x.correct).length, scores.reduce((a, x) => a + x.brier, 0), thinks.length ? thinks[Math.floor(thinks.length / 2)] : null, id.source || '',
          seat.path || '', match.timeouts?.[side] || 0);
        for (const set of seat.team || []) {
          ins(`insert or replace into team_mons values (?,?,?,?,?,?,?,?)`, art.id, side, dex.species.get(set.species).name,
            set.item ? dex.items.get(set.item).name : '', dex.abilities.get(set.ability).name, set.nature || '',
            JSON.stringify(set.moves.map(m => dex.moves.get(m).name)), JSON.stringify(set.evs || {}));
        }
      }
      for (const g of art.games) {
        ins(`insert or replace into games (match_id, n, winner, turns, awarded) values (?,?,?,?,0)`, art.id, g.n, g.winner, g.turns);
        for (const side of ['p1', 'p2']) {
          const bring = g.preview?.[side]?.bring || [];
          bring.forEach((sp, i) => ins(`insert or replace into brings values (?,?,?,?,?,?,?)`, art.id, g.n, side, dex.species.get(sp).name, i + 1, i < 2 ? 1 : 0, g.winner === side ? 1 : 0));
        }
      }
      for (const g of art.awardedGames || []) ins(`insert or replace into games (match_id, n, winner, turns, awarded) values (?,?,?,0,1)`, art.id, g.n, g.winner);
      this.db.exec('commit');
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
    this.version++;
  }
}

export {toID};
