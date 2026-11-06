// Registry of matches + matchmaking + the operations every interface uses.
// Playing is recording: every finished match goes into the stats database.
import fs from 'node:fs';
import path from 'node:path';
import {Match} from './match.mjs';
import {writeArtifacts} from './artifacts.mjs';
import {attachBot, BOT_KINDS} from './bots.mjs';
import {BRIEFING} from './briefing.mjs';
import {ROOT_DIR} from './showdown.mjs';
import {resolveModel, identityFlags} from './models.mjs';
import {StatsDB} from './db.mjs';

export const SUBMIT_WAIT_MS = Number(process.env.VGC_SUBMIT_WAIT_MS || 25000);
export const MAX_WAIT_MS = Number(process.env.VGC_MAX_WAIT_MS || 40000);
// Mirror matches (same model both seats) only if nobody else shows up in this long.
const MIRROR_AFTER_MS = Number(process.env.VGC_MIRROR_AFTER_SEC || 90) * 1000;
const DEFAULT_BOT_FALLBACK_SEC = Number(process.env.VGC_BOT_FALLBACK_SEC ?? 180);
// A finished match stays in memory this long (so its players can read the
// result and spectators the final screen), then it is served from its artifact.
const RETAIN_MS = Number(process.env.VGC_RETAIN_FINISHED_SEC ?? 900) * 1000;
// A room nobody ever joined is abandoned after this long.
const WAITING_TTL_MS = Number(process.env.VGC_WAITING_TTL_SEC ?? 3600) * 1000;

// Optional owner keys for public deployments: VGC_KEYS="key1=alice,key2=bob".
const KEYS = new Map((process.env.VGC_KEYS || '').split(',').filter(Boolean).map(kv => kv.split('=').map(x => x.trim())));

export class Arena {
  constructor({artifactsDir, db, retainMs = RETAIN_MS, waitingTtlMs = WAITING_TTL_MS, tickMs = 1000} = {}) {
    this.matches = new Map();
    this.rooms = new Map();
    this.byToken = new Map();
    this.retainMs = retainMs;
    this.waitingTtlMs = waitingTtlMs;
    this.artifactsDir = artifactsDir || process.env.VGC_ARTIFACTS || path.join(ROOT_DIR, 'artifacts');
    fs.mkdirSync(this.artifactsDir, {recursive: true});
    this.db = db || new StatsDB(path.join(this.artifactsDir, 'arena.db'));
    // Decision clocks and housekeeping. unref'd so a test process can exit.
    if (tickMs > 0) this.timer = setInterval(() => this.tick(), tickMs).unref?.() || null;
  }

  // Run the clocks on every live match; expire rooms nobody joined.
  tick(now = Date.now()) {
    for (const m of this.matches.values()) {
      try {
        if (m.phase === 'waiting') {
          if (this.waitingTtlMs > 0 && now - Date.parse(m.createdAt) > this.waitingTtlMs && !m.botFallbackAt) m.abandon('nobody joined the room');
        } else m.tick(now);
      } catch (err) { m.log(`clock error: ${err.message}`); }
    }
  }

  close() { if (this.timer) clearInterval(this.timer); }

  // Forget a match. Its artifact and database row are the record from here on.
  release(match) {
    if (this.matches.get(match.id) !== match) return;
    this.matches.delete(match.id);
    if (this.rooms.get(match.room) === match) this.rooms.delete(match.room);
    for (const s of ['p1', 'p2']) if (match.seats[s]) this.byToken.delete(match.seats[s].token);
    match.removeAllListeners();
  }

  // The full record of a finished match that may no longer be in memory.
  artifactFor(id) {
    const live = this.matches.get(id);
    if (live) return live.phase === 'finished' && !live.abandoned ? live.artifact() : null;
    const row = this.db.get('select artifact_dir from matches where id = ?', id);
    if (!row?.artifact_dir) return null;
    const file = path.join(row.artifact_dir, 'match.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }

  newRoomCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      const code = Array.from({length: 4}, () => A[Math.floor(Math.random() * A.length)]).join('');
      if (!this.rooms.has(code) && !this.db.get('select 1 from matches where room = ?', code)) return code;
    }
  }

  createMatch(opts = {}) {
    const match = new Match({...opts, room: opts.room || this.newRoomCode()});
    if (opts.reserved) match.reserved = true;
    this.matches.set(match.id, match);
    this.rooms.set(match.room, match);
    const retire = () => { if (this.retainMs > 0) setTimeout(() => this.release(match), this.retainMs).unref?.(); else this.release(match); };
    match.on('finished', () => {
      try {
        match.artifactPaths = writeArtifacts(match, this.artifactsDir);
        this.db.recordMatch(match, match.artifactPaths.dir);
      } catch (err) { match.log(`recording failed: ${err.message}`); }
      retire();
    });
    match.on('abandoned', retire);
    if (opts.bot) this.addBot(match.id, opts.bot);
    return match;
  }

  addBot(matchId, kind = 'greedy') {
    const match = this.get(matchId);
    if (!BOT_KINDS.includes(kind)) throw new Error(`Unknown bot "${kind}". Options: ${BOT_KINDS.join(', ')}.`);
    if (match.seats.p1 && match.seats.p2) return null;
    const identity = resolveModel(`builtin:${kind}`);
    const {token} = match.join({name: `${kind}-bot`, identity, harness: 'builtin', flags: []});
    this.byToken.set(token, match);
    attachBot(match, token, kind);
    return token;
  }

  get(id) {
    const m = this.matches.get(id);
    if (!m) throw new Error(`No match ${id}.`);
    return m;
  }

  matchFor(seat) {
    const m = this.byToken.get(seat);
    if (!m) throw new Error('Unknown seat token. Use the exact `seat` value arena_join returned.');
    return m;
  }

  // Default: queue for the next challenger. Prefer a different model; accept a
  // mirror only after someone has waited a while; fall back to the greedy bot
  // if nobody comes.
  // room: a friend's 4-character code to join, or "new" to open a private room.
  join({name, model, effort, model_source, harness, owner, key, room, match_id, vs_bot, fallback_bot_after_sec}, ctx = {}) {
    const identity = resolveModel(model, effort);
    identity.source = ctx.verified ? 'arena-api' : model_source || 'unspecified';
    if (ctx.verified) identity.provider_route = ctx.verified.provider;
    const client = ctx.client || {};
    const {detectedHarness, flags} = identityFlags(identity, client);
    if (identity.source === 'guess') flags.push('model-self-guessed');
    if (ctx.verified) { flags.length = 0; flags.push('verified-api'); if (!identity.listed) flags.push('unlisted-model'); }
    let ownerName = owner || '';
    let ownerVerified = false;
    if (KEYS.size) {
      if (!key || !KEYS.has(key)) throw new Error('This arena requires a player key (ask the operator).');
      ownerName = KEYS.get(key);
      ownerVerified = true;
    }
    let match;
    const code = room && String(room).trim().toUpperCase().replace(/^#/, '');
    if (code === 'NEW' || code === 'PRIVATE') match = this.createMatch({label: 'private room', reserved: true});
    else if (code) {
      match = this.rooms.get(code);
      if (!match) throw new Error(`No open room ${code}. Check the code, or use room "new" to open one.`);
      if (match.seats.p1 && match.seats.p2) throw new Error(`Room ${code} is full.`);
    } else if (match_id) match = this.get(match_id);
    else if (vs_bot) match = this.createMatch({label: `vs ${vs_bot} bot`});
    else {
      const open = [...this.matches.values()].filter(m => m.phase === 'waiting' && !m.reserved && !m.fixedTeams && (m.seats.p1 ? !m.seats.p2 : false));
      match = open.find(m => m.seats.p1.model !== identity.modelId)
        || open.find(m => Date.now() - m.seats.p1.waitingSince > MIRROR_AFTER_MS)
        || this.createMatch({label: 'ladder'});
    }
    const {token, side} = match.join({name, identity, harness, client, owner: ownerName, ownerVerified, flags, detectedHarness});
    this.byToken.set(token, match);
    if (vs_bot) this.addBot(match.id, vs_bot);
    else if (!match_id && !code && match.phase === 'waiting') {
      const after = Number(fallback_bot_after_sec ?? DEFAULT_BOT_FALLBACK_SEC);
      if (after > 0) {
        match.botFallbackAt = Date.now() + after * 1000;
        setTimeout(() => {
          if (match.phase === 'waiting' && !match.seats.p2) { match.log('no challenger arrived — greedy bot takes the seat'); this.addBot(match.id, 'greedy'); }
        }, after * 1000).unref?.();
      }
    }
    return {match, token, side, identity, flags};
  }

  async wait(seat, ms = MAX_WAIT_MS) {
    const match = this.matchFor(seat);
    const side = match.sideOf(seat);
    const ready = () => match.phase === 'finished' || match.yourTurn(side);
    if (!ready()) {
      await new Promise(resolve => {
        const timer = setTimeout(done, Math.min(ms, MAX_WAIT_MS));
        function done() { clearTimeout(timer); match.off('change', check); match.off('finished', done); resolve(); }
        function check() { if (ready()) done(); }
        match.on('change', check);
        match.on('finished', done);
      });
    }
    return match.stateFor(seat);
  }

  briefing() { return BRIEFING; }

  live() {
    return [...this.matches.values()].filter(m => m.phase !== 'finished').map(m => ({
      id: m.id, room: m.room, label: m.label, phase: m.phase, score: m.score, createdAt: m.createdAt, private: !!m.reserved,
      actives: m.currentGame ? ['p1', 'p2'].map(s => m.currentGame.side(s).active.map(p => (p && !p.fainted ? {species: (p.illusion || p).species.name, hp: Math.round((p.hp / p.maxhp) * 100)} : null))) : null,
      players: ['p1', 'p2'].map(s => m.seats[s] && {side: s, model: m.seats[s].model, name: m.seats[s].identity?.name, effort: m.seats[s].identity?.effort, provider: m.seats[s].identity?.provider, owner: m.seats[s].owner}),
      game: m.game?.n || 0, turn: m.currentGame?.turn || 0, botFallbackAt: m.botFallbackAt || null,
    })).reverse();
  }

  list() {
    return [...this.matches.values()].map(m => ({
      id: m.id, label: m.label, phase: m.phase, score: m.score, winner: m.winner, createdAt: m.createdAt, finishedAt: m.finishedAt,
      players: ['p1', 'p2'].map(s => m.seats[s] && {side: s, name: m.seats[s].name, model: m.seats[s].model}),
      game: m.game?.n || 0, turn: m.currentGame?.turn || 0,
    })).reverse();
  }
}
