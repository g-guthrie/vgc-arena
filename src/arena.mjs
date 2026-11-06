// Registry of matches + the operations every interface (MCP, HTTP, CLI) uses.
import fs from 'node:fs';
import path from 'node:path';
import {Match} from './match.mjs';
import {writeArtifacts} from './artifacts.mjs';
import {attachBot, BOT_KINDS} from './bots.mjs';
import {BRIEFING} from './briefing.mjs';
import {ROOT_DIR} from './showdown.mjs';

export const SUBMIT_WAIT_MS = Number(process.env.VGC_SUBMIT_WAIT_MS || 25000);
export const MAX_WAIT_MS = Number(process.env.VGC_MAX_WAIT_MS || 40000);

export class Arena {
  constructor({artifactsDir} = {}) {
    this.matches = new Map();
    this.byToken = new Map();
    this.artifactsDir = artifactsDir || process.env.VGC_ARTIFACTS || path.join(ROOT_DIR, 'artifacts');
    fs.mkdirSync(this.artifactsDir, {recursive: true});
  }

  createMatch(opts = {}) {
    const match = new Match(opts);
    this.matches.set(match.id, match);
    match.on('finished', () => {
      try { match.artifactPaths = writeArtifacts(match, this.artifactsDir); } catch (err) { match.log(`artifact write failed: ${err.message}`); }
    });
    if (opts.bot) this.addBot(match.id, opts.bot);
    return match;
  }

  addBot(matchId, kind = 'greedy') {
    const match = this.get(matchId);
    if (!BOT_KINDS.includes(kind)) throw new Error(`Unknown bot "${kind}". Options: ${BOT_KINDS.join(', ')}.`);
    const {token} = match.join({name: `${kind}-bot`, model: `builtin:${kind}`, harness: 'builtin'});
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

  join({name, model, harness, match_id, vs_bot}) {
    let match;
    if (match_id) match = this.get(match_id);
    else if (vs_bot) match = this.createMatch({label: `vs ${vs_bot} bot`, createdBy: 'player'});
    else {
      match = [...this.matches.values()].find(m => m.phase === 'waiting' && !m.reserved && (!m.seats.p1 || !m.seats.p2));
      match ||= this.createMatch({});
    }
    const {token, side} = match.join({name, model, harness});
    this.byToken.set(token, match);
    if (vs_bot) this.addBot(match.id, vs_bot);
    return {match, token, side};
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

  list() {
    return [...this.matches.values()].map(m => ({
      id: m.id, label: m.label, phase: m.phase, score: m.score, winner: m.winner, createdAt: m.createdAt, finishedAt: m.finishedAt,
      players: ['p1', 'p2'].map(s => m.seats[s] && {side: s, name: m.seats[s].name, model: m.seats[s].model}),
      game: m.game?.n || 0, turn: m.currentGame?.turn || 0,
    })).reverse();
  }
}
