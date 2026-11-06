// Best-of-3 match state machine. All hidden state lives in memory here; the
// only ways out are a player's own view (by seat token), the public spectator
// view, and the artifact written after the match finishes.
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {toID, FORMAT_ID, SHOWDOWN_COMMIT} from './showdown.mjs';
import {validateTeam, openSheet, openSheetText, exportTeam, parseTeam} from './dex-tools.mjs';
import {Game, describeLines} from './game.mjs';
import {renderObservation, legalOptions, toShowdownChoice, REQUIRED_FIELDS} from './observation.mjs';
import {BRIEFING, TEAMBUILD_TEXT, HARNESS_VERSION} from './briefing.mjs';

const MAX_FIELD = 700;
const SIDES = ['p1', 'p2'];
const other = s => (s === 'p1' ? 'p2' : 'p1');
const clip = v => (typeof v === 'string' && v.length > MAX_FIELD ? `${v.slice(0, MAX_FIELD)}…` : v);
const hash = s => crypto.createHash('sha256').update(s).digest('hex');

function gameSeed(matchSeed, n) {
  const h = hash(`${matchSeed}:game${n}`);
  return [0, 1, 2, 3].map(i => parseInt(h.slice(i * 4, i * 4 + 4), 16));
}

export class Match extends EventEmitter {
  constructor({id, label, seed, bestOf = 3, fixedTeams, createdBy} = {}) {
    super();
    this.id = id || `m-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    this.label = label || '';
    this.seed = seed || crypto.randomBytes(8).toString('hex');
    this.bestOf = bestOf;
    this.winsNeeded = Math.floor(bestOf / 2) + 1;
    this.createdAt = new Date().toISOString();
    this.createdBy = createdBy || 'player';
    this.fixedTeams = fixedTeams || null; // {p1: text, p2: text, source?}
    this.phase = 'waiting';
    this.seats = {p1: null, p2: null};
    this.games = [];
    this.score = {p1: 0, p2: 0, ties: 0};
    this.decisions = [];
    this.rejections = {p1: [], p2: []};
    this.events = [];
    this.winner = null;
    this.finishedAt = null;
    this.endReason = null;
    this.log('match created');
  }

  log(text) { this.events.push({t: new Date().toISOString(), text}); this.emit('change'); }
  get game() { return this.games.at(-1) || null; }
  get currentGame() { return this.game?.game || null; }

  // ------------------------------------------------------------ seats
  join({name, model, harness}) {
    const side = SIDES.find(s => !this.seats[s]);
    if (!side) throw new Error('Match is full.');
    const token = `seat_${crypto.randomBytes(18).toString('base64url')}`;
    this.seats[side] = {
      token, side, name: clip(String(name || model || side)).slice(0, 40), model: String(model || 'unknown').slice(0, 80),
      harness: String(harness || '').slice(0, 80), joinedAt: new Date().toISOString(),
      team: null, teamText: null, teamPlan: null, sheet: null, teamAttempts: 0,
    };
    this.log(`${this.seats[side].name} (${this.seats[side].model}) joined as ${side}`);
    if (this.seats.p1 && this.seats.p2) this.startTeambuilding();
    return {token, side};
  }

  sideOf(token) {
    const side = SIDES.find(s => this.seats[s]?.token === token);
    if (!side) throw new Error('Unknown seat token for this match.');
    return side;
  }

  startTeambuilding() {
    this.phase = 'teambuilding';
    if (this.fixedTeams) {
      for (const s of SIDES) {
        const v = validateTeam({team: this.fixedTeams[s]});
        if (!v.ok) throw new Error(`Fixed team for ${s} is invalid: ${v.problems.join('; ')}`);
        this.acceptTeam(s, v.sets, 'Fixed team assigned by the match organizer.');
      }
      this.log('teams assigned by organizer');
      this.startGame();
      return;
    }
    this.log('teambuilding started');
  }

  acceptTeam(side, sets, plan) {
    const seat = this.seats[side];
    seat.team = sets;
    seat.teamText = exportTeam(sets);
    seat.teamPlan = clip(plan || '');
    seat.sheet = openSheet(sets);
    seat.teamHash = hash(seat.teamText).slice(0, 16);
  }

  // ------------------------------------------------------------ actions
  submitTeam(token, {team, team_plan}) {
    const side = this.sideOf(token);
    if (this.phase !== 'teambuilding') return {error: `Not in teambuilding (phase: ${this.phase}).`};
    const seat = this.seats[side];
    if (seat.team) return {error: 'Team already submitted.'};
    seat.teamAttempts++;
    const v = validateTeam({team});
    if (!v.ok) return {error: 'Team is not legal.', problems: v.problems};
    if (!team_plan || String(team_plan).trim().length < 10) return {error: 'team_plan is required (2–4 sentences).'};
    this.acceptTeam(side, v.sets, team_plan);
    this.log(`${seat.name} submitted a team`);
    if (SIDES.every(s => this.seats[s].team)) this.startGame();
    return {ok: true};
  }

  startGame() {
    const n = this.games.length + 1;
    const seed = gameSeed(this.seed, n);
    const game = new Game({
      seed,
      p1: {name: this.seats.p1.name, sets: this.seats.p1.team.map(s => ({...s}))},
      p2: {name: this.seats.p2.name, sets: this.seats.p2.team.map(s => ({...s}))},
    });
    this.games.push({
      n, seed, game, startedAt: new Date().toISOString(), winner: null, turns: 0,
      preview: {p1: null, p2: null},
      view: SIDES.reduce((o, s) => (o[s] = {cursor: 0, plan: null, predictions: null, predLogStart: 0, history: [], oppSeen: new Set(), promptedAt: null}, o), {}),
    });
    this.phase = 'preview';
    this.log(`game ${n} team preview`);
  }

  submitPreview(token, {bring, game_plan, key_threats, lessons}) {
    const side = this.sideOf(token);
    const g = this.game;
    if (this.phase !== 'preview' || !g) return {error: `Not in team preview (phase: ${this.phase}).`};
    if (g.preview[side]) return {error: 'Preview already submitted for this game.'};
    const team = this.seats[side].team;
    if (!Array.isArray(bring) || bring.length !== 4) return {error: '`bring` must list exactly 4 of your Pokémon; the first two lead.'};
    const idx = [];
    for (const name of bring) {
      const i = team.findIndex((s, j) => !idx.includes(j + 1) && (toID(s.species) === toID(name) || toID(s.name || '') === toID(name)));
      if (i < 0) return {error: `"${name}" is not on your team (or listed twice). Your team: ${team.map(s => s.species).join(', ')}.`};
      idx.push(i + 1);
    }
    const missing = [];
    if (!game_plan) missing.push('game_plan');
    if (!key_threats) missing.push('key_threats');
    if (g.n > 1 && !lessons) missing.push('lessons');
    if (missing.length) return {error: `Missing required fields: ${missing.join(', ')}.`};
    const res = g.game.choose(side, `team ${idx.join(', ')}`);
    if (!res.ok) return {error: res.error};
    g.preview[side] = {bring: idx.map(i => team[i - 1].species), game_plan: clip(game_plan), key_threats: clip(key_threats), lessons: clip(lessons), at: new Date().toISOString()};
    g.view[side].plan = clip(game_plan);
    this.recordDecision(side, {kind: 'preview', payload: g.preview[side], choice: `team ${idx.join(', ')}`});
    this.log(`${this.seats[side].name} locked in team preview`);
    if (g.preview.p1 && g.preview.p2) {
      this.phase = 'battle';
      this.afterResolve();
    }
    this.emit('change');
    return {ok: true};
  }

  submitTurn(token, payload = {}) {
    const side = this.sideOf(token);
    const g = this.game;
    if (this.phase !== 'battle' || !g) return {error: `Not in battle (phase: ${this.phase}).`};
    const game = g.game;
    if (!game.needsChoice(side)) return {error: 'It is not your turn to act. Call arena_wait.'};
    const view = g.view[side];
    const req = game.request(side);
    let obs = view.lastObs && view.lastObs.req === req ? view.lastObs : null;
    if (!obs) { obs = {...this.observe(side), req}; view.cursor = game.battle.log.length; view.lastObs = obs; }
    const depth = obs.depth;
    const missing = REQUIRED_FIELDS[depth].filter(f => payload[f] === undefined || payload[f] === null || payload[f] === '');
    if (missing.length) return {error: `Missing required fields for a ${depth.toUpperCase()} turn: ${missing.join(', ')}.`};
    let predictions = null;
    if (depth === 'full' || depth === 'light') {
      if (!Array.isArray(payload.predictions)) return {error: '`predictions` must be an array like [{"foe":"foe1","action":"Protect","confidence":0.6}].'};
      predictions = payload.predictions.slice(0, 2).map(p => ({
        foe: String(p?.foe || '').toLowerCase(), action: clip(String(p?.action || '')),
        confidence: Math.max(0, Math.min(1, Number(p?.confidence))),
      }));
      if (predictions.some(p => !['foe1', 'foe2'].includes(p.foe) || !p.action || Number.isNaN(p.confidence))) {
        return {error: 'Each prediction needs foe ("foe1"/"foe2"), action (move name or "switch"), confidence (0–1).'};
      }
      const opp = game.side(other(side));
      for (const p of predictions) {
        const mon = opp.active[p.foe === 'foe1' ? 0 : 1];
        p.species = mon && !mon.fainted ? (mon.illusion ? mon.illusion.species.name : mon.species.name) : null;
      }
    }
    const conv = toShowdownChoice(game, side, obs.options, payload.actions);
    if (conv.error) return {error: conv.error};
    const turnBefore = game.turn;
    const logBefore = game.battle.log.length;
    const res = game.choose(side, conv.choice);
    if (!res.ok) return {error: res.error};
    const record = {
      kind: obs.options.kind, depth, turn: turnBefore,
      payload: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, typeof v === 'string' ? clip(v) : v])),
      choice: conv.choice, observation: obs.text,
    };
    this.recordDecision(side, record);
    if (obs.options.kind === 'move') {
      view.history.push(conv.choice);
      view.predictions = predictions;
      view.predLogStart = logBefore;
      view.lastRecord = record;
    }
    if (typeof payload.plan === 'string' && payload.plan.trim() && !/^on[ -]?track\.?$/i.test(payload.plan.trim())) {
      view.plan = `${clip(payload.plan)} (revised turn ${turnBefore})`;
    }
    if (game.battle.log.length > logBefore) this.afterResolve(turnBefore);
    this.emit('change');
    return {ok: true};
  }

  forfeit(token) {
    const side = this.sideOf(token);
    if (this.phase === 'finished') return {error: 'Match already finished.'};
    if (this.currentGame && !this.currentGame.ended) this.currentGame.forfeit(side);
    this.finish(other(side), `${this.seats[side].name} forfeited`);
    return {ok: true};
  }

  noteRejection(token, tool, error) {
    try {
      const side = this.sideOf(token);
      this.rejections[side].push({tool, error: String(error).slice(0, 300), game: this.game?.n || 0, turn: this.currentGame?.turn || 0, at: new Date().toISOString()});
    } catch {}
  }

  recordDecision(side, rec) {
    const g = this.game;
    const view = g.view[side];
    const now = Date.now();
    rec.side = side;
    rec.game = g.n;
    rec.at = new Date(now).toISOString();
    rec.thinkMs = view.promptedAt ? now - view.promptedAt : null;
    view.promptedAt = null;
    this.decisions.push(rec);
  }

  // Called whenever the battle log advanced: score predictions, track reveals,
  // end games, start the next one.
  afterResolve(resolvedTurn) {
    const g = this.game;
    const game = g.game;
    const pub = game.linesFor('spectator');
    for (const line of pub) {
      const m = /^\|(switch|drag)\|(p[12])[ab]: [^|]*\|([^,|]+)/.exec(line);
      if (m) g.view[other(m[2])].oppSeen.add(m[3]);
    }
    if (resolvedTurn !== undefined) this.scorePredictions(resolvedTurn);
    g.turns = game.turn;
    if (game.ended) this.endGame();
  }

  scorePredictions(turn) {
    const g = this.game;
    const byTurn = this.decisions.filter(d => d.game === g.n && d.turn === turn && d.kind === 'move');
    for (const d of byTurn) {
      const theirs = byTurn.find(x => x.side === other(d.side));
      if (!theirs || !Array.isArray(d.payload.predictions)) continue;
      d.predictionScores = d.payload.predictions.map(p => {
        const slot = p.foe === 'foe1' ? 1 : p.foe === 'foe2' ? 2 : 0;
        const actual = (theirs.payload.actions || []).find(a => Number(a.slot) === slot);
        if (!actual) return {foe: p.foe, predicted: p.action, actual: null};
        const actualLabel = actual.switch ? 'switch' : actual.move;
        const correct = toID(p.action) === toID(actualLabel) || (toID(p.action).startsWith('switch') && !!actual.switch);
        const conf = Math.max(0, Math.min(1, Number(p.confidence) || 0));
        return {foe: p.foe, predicted: p.action, actual: actualLabel, correct, confidence: conf, brier: (conf - (correct ? 1 : 0)) ** 2};
      });
    }
  }

  endGame() {
    const g = this.game;
    const w = g.game.winnerSide;
    g.winner = w;
    g.endedAt = new Date().toISOString();
    g.spectatorLog = g.game.spectatorLog();
    g.omniscientLog = g.game.battle.log.join('\n');
    if (w === 'tie' || !w) this.score.ties++;
    else this.score[w]++;
    this.log(`game ${g.n} ${w && w !== 'tie' ? `won by ${this.seats[w].name}` : 'tied'} on turn ${g.game.turn}`);
    const decided = SIDES.find(s => this.score[s] >= this.winsNeeded);
    if (decided) return this.finish(decided, 'won the set');
    if (this.games.length >= this.bestOf + 2) return this.finish(this.score.p1 > this.score.p2 ? 'p1' : this.score.p2 > this.score.p1 ? 'p2' : 'tie', 'game cap reached');
    this.startGame();
  }

  finish(winner, reason) {
    if (this.phase === 'finished') return;
    const g = this.game;
    if (g && !g.spectatorLog) { g.spectatorLog = g.game.spectatorLog(); g.omniscientLog = g.game.battle.log.join('\n'); g.endedAt = new Date().toISOString(); }
    this.phase = 'finished';
    this.winner = winner;
    this.endReason = reason;
    this.finishedAt = new Date().toISOString();
    this.log(`match finished: ${winner === 'tie' ? 'tie' : `${this.seats[winner]?.name} wins`} (${reason}) ${this.score.p1}-${this.score.p2}`);
    this.emit('finished');
  }

  // ------------------------------------------------------------ views
  yourTurn(side) {
    if (this.phase === 'teambuilding') return !this.seats[side].team;
    if (this.phase === 'preview') return !this.game.preview[side];
    if (this.phase === 'battle') return this.currentGame.needsChoice(side);
    return false;
  }

  header(side) {
    const opp = this.seats[other(side)];
    return `Game ${this.game.n} (best of ${this.bestOf}) · Set score you ${this.score[side]}–${this.score[other(side)]} vs ${opp.name}`;
  }

  observe(side) {
    const g = this.game;
    const game = g.game;
    const view = g.view[side];
    const end = game.battle.log.length;
    const sinceRaw = game.linesFor(side, view.cursor, end);
    const sinceText = describeLines(sinceRaw, side);
    const alerts = [];
    if (view.history.length >= 3 && view.history.slice(-3).every(c => c === view.history.at(-1))) {
      alerts.push('You have submitted the exact same actions three turns in a row. Make sure the situation still calls for it.');
    }
    const opp = game.side(other(side));
    const theyMega = game.battle.log.some(l => l.startsWith(`|-mega|${other(side)}`));
    if (!theyMega) {
      const live = this.seats[other(side)].sheet.filter(s => s.item && dex.items.get(s.item).megaStone);
      if (live.length) alerts.push(`They have not Mega Evolved this game. Mega Stone holders on their sheet: ${live.map(s => `${s.species} (${s.item})`).join(', ')}.`);
      for (const p of opp.active) {
        if (!p || p.fainted || p.species.isMega) continue;
        const form = megaForm(p);
        if (form) alerts.push(`Their ${p.species.name} can Mega Evolve THIS turn into ${form}. Its damage and Speed above are for the current form; Mega Evolution applies before moves, including the Speed change.`);
      }
    }
    if (!game.battle.log.some(l => l.startsWith(`|-mega|${side}`))) {
      for (const p of game.side(side).active) {
        if (!p || p.fainted || p.species.isMega) continue;
        const form = megaForm(p);
        if (form) alerts.push(`Your ${p.species.name} can Mega Evolve into ${form}. Numbers above are for the current form.`);
      }
    }
    const youMega = game.battle.log.some(l => l.startsWith(`|-mega|${side}`));
    if (youMega) alerts.push('You have already used your Mega Evolution this game.');
    const predictionReview = [];
    if (view.predictions) {
      const lines = game.linesFor('spectator', view.predLogStart, end);
      for (const p of view.predictions) {
        if (!p.species) continue;
        const pos = p.foe === 'foe1' ? 'a' : 'b';
        const used = lines.map(l => new RegExp(`^\\|move\\|${other(side)}${pos}: [^|]*\\|([^|]*)`).exec(l)).find(Boolean);
        const switched = lines.some(l => new RegExp(`^\\|switch\\|${other(side)}${pos}:`).test(l));
        const happened = used ? `used ${used[1]}` : switched ? 'switched out' : 'did not visibly act (fainted, flinched, or blocked before moving)';
        const hit = used ? toID(used[1]) === toID(p.action) : switched && toID(p.action).startsWith('switch');
        predictionReview.push(`${p.foe} ${p.species}: you predicted ${p.action} (${Math.round(p.confidence * 100)}%) → ${happened}${used || switched ? (hit ? ' ✓' : ' ✗') : ''}`);
      }
    }
    const obs = renderObservation(game, side, {
      header: this.header(side),
      gamePlan: view.plan,
      sinceLastRaw: sinceRaw,
      sinceLastText: sinceText,
      predictionReview,
      oppSheet: this.seats[other(side)].sheet,
      oppSeen: view.oppSeen,
      alerts,
    });
    return obs;
  }

  // The text + flags a player gets from arena_state / arena_wait / submits.
  stateFor(token) {
    const side = this.sideOf(token);
    const seat = this.seats[side];
    const opp = this.seats[other(side)];
    const base = {matchId: this.id, side, phase: this.phase, score: {you: this.score[side], opponent: opp ? this.score[other(side)] : 0}, game: this.game?.n || 0};
    if (this.phase === 'waiting') return {...base, yourTurn: false, text: 'Waiting for an opponent to join this match. Call arena_wait.'};
    if (this.phase === 'finished') {
      const result = this.winner === 'tie' ? 'The match was a TIE' : this.winner === side ? 'You WON the match' : 'You LOST the match';
      return {...base, yourTurn: false, finished: true, text: `MATCH FINISHED. ${result} ${this.score[side]}–${this.score[other(side)]} (${this.endReason}). You are done — no further actions.\n\n${this.gameSummaries(side)}`};
    }
    if (!this.yourTurn(side)) return {...base, yourTurn: false, text: `Waiting for ${opp.name} (phase: ${this.phase}${this.phase === 'battle' ? `, game ${this.game.n}, turn ${this.currentGame.turn}` : ''}). Call arena_wait.`};
    const g = this.game;
    if (g?.view) g.view[side].promptedAt ||= Date.now();
    if (this.phase === 'teambuilding') {
      return {...base, yourTurn: true, kind: 'teambuilding', text: `${TEAMBUILD_TEXT}\n\nYour opponent: ${opp.name} (${opp.model}). You will see their team sheet at team preview.`};
    }
    if (this.phase === 'preview') {
      const L = [];
      L.push(`=== ${this.header(side)} · TEAM PREVIEW ===`);
      if (g.n > 1) L.push('', this.gameSummaries(side));
      L.push('', 'YOUR TEAM (full sets):', seat.teamText.trim());
      L.push('', `YOUR TEAM PLAN: ${seat.teamPlan}`);
      L.push('', `OPPONENT'S OPEN TEAM SHEET (${opp.name}):`, openSheetText(opp.sheet));
      L.push('', 'Opponent stat ranges at level 50 (any legal spread):');
      for (const s of opp.sheet) L.push(`  ${s.species}: ${rangesLine(s.species)}`);
      L.push('', `preview_submit fields:
  bring: exactly 4 of your species; the first two lead (e.g. ["${seat.team[0].species}", "${seat.team[1].species}", "${seat.team[2].species}", "${seat.team[3].species}"])
  key_threats: their 2–3 most dangerous Pokémon/modes for your team and how you handle each — 2–3 sentences
  game_plan: your lead plan, win condition and what you must preserve — 2–3 sentences${g.n > 1 ? '\n  lessons: what earlier games taught you about this opponent and what you are changing — 1–2 sentences' : ''}`);
      return {...base, yourTurn: true, kind: 'preview', text: L.join('\n')};
    }
    const view = g.view[side];
    const req = this.currentGame.request(side);
    if (!view.lastObs || view.lastObs.req !== req) {
      view.lastObs = {...this.observe(side), req};
      view.cursor = this.currentGame.battle.log.length;
    }
    const obs = view.lastObs;
    return {...base, yourTurn: true, kind: obs.options.kind, depth: obs.depth, turn: this.currentGame.turn, text: obs.text};
  }

  // Re-render without advancing the "since last decision" cursor.
  peekFor(token) {
    const side = this.sideOf(token);
    const g = this.game;
    return this.stateFor(token);
  }

  gameSummaries(side) {
    const done = this.games.filter(g => g.winner || g.endedAt);
    if (!done.length) return '';
    const L = ['PREVIOUS GAMES:'];
    for (const g of done) {
      const res = g.winner === 'tie' || !g.winner ? 'tie' : g.winner === side ? 'you won' : 'you lost';
      const opp = other(side);
      const oppLeads = g.game.battle.log.filter(l => new RegExp(`^\\|switch\\|${opp}[ab]:`).test(l)).map(l => l.split('|')[3].split(',')[0]);
      const oppBrought = [...new Set(oppLeads)];
      L.push(`  Game ${g.n}: ${res} on turn ${g.game.turn}. They revealed ${oppBrought.join(', ') || 'nothing'}; their leads: ${oppBrought.slice(0, 2).join(' + ')}. You brought ${g.preview[side]?.bring.join(', ')}.`);
    }
    return L.join('\n');
  }

  publicView({reveal = false} = {}) {
    const showTeams = SIDES.every(s => this.seats[s]?.team);
    const finished = this.phase === 'finished';
    return {
      id: this.id, label: this.label, phase: this.phase, createdAt: this.createdAt, finishedAt: this.finishedAt,
      format: FORMAT_ID, bestOf: this.bestOf, score: this.score, winner: this.winner, endReason: this.endReason,
      players: SIDES.map(s => this.seats[s] ? {side: s, name: this.seats[s].name, model: this.seats[s].model, harness: this.seats[s].harness, teamSubmitted: !!this.seats[s].team} : null),
      sheets: showTeams ? {p1: this.seats.p1.sheet, p2: this.seats.p2.sheet} : null,
      games: this.games.map(g => ({
        n: g.n, winner: g.winner, turn: g.game.turn, endedAt: g.endedAt || null,
        log: describeLines(g.game.linesFor('spectator'), 'spectator'),
        rawLog: g.game.spectatorLog(),
      })),
      events: this.events.slice(-50),
      ...(finished || reveal ? {
        teams: showTeams ? {p1: this.seats.p1.teamText, p2: this.seats.p2.teamText} : null,
        teamPlans: {p1: this.seats.p1?.teamPlan, p2: this.seats.p2?.teamPlan},
        previews: this.games.map(g => ({n: g.n, ...g.preview})),
        decisions: this.decisions.map(({observation, ...d}) => d),
      } : {}),
    };
  }

  artifact() {
    return {
      schema: 'vgc-arena-match.v1',
      harnessVersion: HARNESS_VERSION,
      showdownCommit: SHOWDOWN_COMMIT,
      format: FORMAT_ID,
      id: this.id, label: this.label, seed: this.seed, bestOf: this.bestOf,
      createdAt: this.createdAt, finishedAt: this.finishedAt, createdBy: this.createdBy,
      fixedTeams: this.fixedTeams ? {source: this.fixedTeams.source || null} : null,
      winner: this.winner, endReason: this.endReason, score: this.score,
      players: Object.fromEntries(SIDES.map(s => [s, this.seats[s] && {
        name: this.seats[s].name, model: this.seats[s].model, harness: this.seats[s].harness,
        teamText: this.seats[s].teamText, teamPlan: this.seats[s].teamPlan, teamHash: this.seats[s].teamHash, teamAttempts: this.seats[s].teamAttempts,
      }])),
      games: this.games.map(g => ({n: g.n, seed: g.seed, winner: g.winner, turns: g.game.turn, startedAt: g.startedAt, endedAt: g.endedAt, preview: g.preview, spectatorLog: g.spectatorLog, omniscientLog: g.omniscientLog})),
      decisions: this.decisions,
      rejections: this.rejections,
      events: this.events,
      briefing: BRIEFING,
    };
  }
}

import {statRange} from './dex-tools.mjs';
import {dex} from './showdown.mjs';
function megaForm(p) {
  const stone = p.item && dex.items.get(p.item);
  const name = stone?.megaStone?.[p.species.name] || stone?.megaStone?.[p.baseSpecies.name];
  if (!name) return null;
  const f = dex.species.get(name);
  const bs = f.baseStats;
  return `${f.name} (${f.types.join('/')}, ability ${Object.values(f.abilities)[0]}, base ${bs.hp}/${bs.atk}/${bs.def}/${bs.spa}/${bs.spd}/${bs.spe})`;
}

function rangesLine(species) {
  const sp = dex.species.get(species);
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(s => `${s === 'hp' ? 'HP' : s[0].toUpperCase() + s.slice(1)} ${statRange(sp, s).join('–')}`).join(' · ');
}

export {SIDES, other, parseTeam};
