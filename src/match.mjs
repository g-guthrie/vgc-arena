// Best-of-3 match state machine. All hidden state lives in memory here; the
// only ways out are a player's own view (by seat token), the public spectator
// view, and the artifact written after the match finishes.
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {dex, toID, FORMAT_ID, SHOWDOWN_COMMIT} from './showdown.mjs';
import {validateTeam, openSheet, openSheetText, exportTeam, parseTeam} from './dex-tools.mjs';
import {Game, describeLines} from './game.mjs';
import {renderObservation, choiceFromAnswer, predictionEnum} from './observation.mjs';
import {BRIEFING, TEAMBUILD_TEXT, HARNESS_VERSION, thinkText} from './briefing.mjs';
import {resolveModel, connectionPath} from './models.mjs';
import {newDraft, setSlot, boardText, lockCheck, boardSummary} from './draft.mjs';
import {question, questionText} from './guided.mjs';
import {watchSpeedOrder, applySpeedConstraints} from './speed-infer.mjs';
import {displayName, displayNames, sheetDex, teamName, opponentActions, rangesLine, chosenLabel, predictionHit} from './match-text.mjs';

const RESEARCH_TOOLS = new Set(['search_pokemon', 'pokemon', 'search_moves', 'move', 'search_items', 'item', 'ability', 'calc']);

// Decision clocks. A side that owes an answer for longer than this forfeits
// the game; a second timeout in the same match (or one during teambuilding,
// where there is no game to concede) forfeits the match. 0 disables a clock.
export const CLOCK = {
  decision: Number(process.env.VGC_DECISION_TIMEOUT_SEC ?? 600) * 1000,
  teambuild: Number(process.env.VGC_TEAMBUILD_TIMEOUT_SEC ?? 1800) * 1000,
};

const MAX_FIELD = 700;
// Strict events can hide live research and picks from spectators.
const SEALED = process.env.VGC_SEALED_SPECTATING === '1';
const SIDES = ['p1', 'p2'];
const other = s => (s === 'p1' ? 'p2' : 'p1');
const clip = v => (typeof v === 'string' && v.length > MAX_FIELD ? `${v.slice(0, MAX_FIELD)}…` : v);
const hash = s => crypto.createHash('sha256').update(s).digest('hex');

function gameSeed(matchSeed, n) {
  const h = hash(`${matchSeed}:game${n}`);
  return [0, 1, 2, 3].map(i => parseInt(h.slice(i * 4, i * 4 + 4), 16));
}

export class Match extends EventEmitter {
  constructor({id, room, label, seed, bestOf = 3, fixedTeams, createdBy, clock} = {}) {
    super();
    this.clock = {...CLOCK, ...(clock || {})};
    // Per side: when the current decision was first owed, and which decision that was.
    this.pendingSince = {p1: null, p2: null};
    this.pendingKey = {p1: null, p2: null};
    this.timeouts = {p1: 0, p2: 0};
    this.id = id || `m-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    this.room = room || null; // short public code, assigned by the arena
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
    // Stored-Speed bounds inferred from move order, per side, kept across games.
    this.speedBounds = {p1: {}, p2: {}};
    this.decisions = [];
    this.rejections = {p1: [], p2: []};
    this.activity = [];
    this.since = {p1: null, p2: null};
    this.events = [];
    this.winner = null;
    this.finishedAt = null;
    this.endReason = null;
    // Games given to the opponent without being played, when a side forfeits the match.
    this.awarded = [];
    this.log('match created');
  }

  log(text) { this.events.push({t: new Date().toISOString(), text}); this.emit('change'); }
  get game() { return this.games.at(-1) || null; }
  get currentGame() { return this.game?.game || null; }

  // ------------------------------------------------------------ seats
  // identity: from models.resolveModel; client: what the transport reported.
  join({name, model: modelRaw, identity, harness, client, owner, ownerVerified, flags, detectedHarness, builtin = false}) {
    identity ||= resolveModel(modelRaw);
    const side = SIDES.find(s => !this.seats[s]);
    if (!side) throw new Error('Match is full.');
    const token = `seat_${crypto.randomBytes(18).toString('base64url')}`;
    const model = identity?.modelId || 'unlisted:unknown';
    this.seats[side] = {
      token, side, name: String(name || identity?.name || side).slice(0, 40), model, identity,
      harness: String(harness || detectedHarness || '').slice(0, 80), client: client || {}, detectedHarness: detectedHarness || null,
      // How this seat is driven (mcp, api, cli, http, builtin): the leaderboard can split on it.
      builtin: !!builtin,
      path: connectionPath(harness || detectedHarness, client, builtin),
      owner: String(owner || '').slice(0, 60), ownerVerified: !!ownerVerified, flags: flags || [],
      joinedAt: new Date().toISOString(), waitingSince: Date.now(),
      team: null, teamText: null, teamPlan: null, sheet: null, teamAttempts: 0, draft: newDraft(),
    };
    this.log(`${this.seats[side].name} (${model}${identity?.effort ? `:${identity.effort}` : ''}) joined as ${side}`);
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
  // Free-form team import. Not exposed as a player tool: players build on the
  // draft board (draftAnswer). This path serves the built-in bots, organizer
  // fixed teams and tests.
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

  // ---- the draft board (procedural teambuilding)
  draftSeat(token) {
    const side = this.sideOf(token);
    const seat = this.seats[side];
    if (this.phase !== 'teambuilding') return {error: `Not in teambuilding (phase: ${this.phase}).`};
    if (seat.team) return {error: 'Your team is already locked.'};
    return {side, seat};
  }

  draftConcept(token, {concept}) {
    const d = this.draftSeat(token);
    if (d.error) return d;
    if (!concept || String(concept).trim().length < 10) return {error: 'concept needs 2–3 sentences: archetype, speed mode, win condition.'};
    d.seat.draft.concept = clip(String(concept).trim());
    this.emit('change');
    return {ok: true, board: boardText(d.seat.draft)};
  }

  draftSet(token, args) {
    const d = this.draftSeat(token);
    if (d.error) return d;
    const r = setSlot(d.seat.draft, args);
    this.emit('change');
    if (r.error) return {error: r.error, board: boardText(d.seat.draft)};
    return {ok: true, notes: r.notes, board: boardText(d.seat.draft)};
  }

  // Guided path: answer the board's current question.
  // The exact legal answer shape for whatever this seat is being asked now,
  // as a JSON schema: constrained clients can only produce legal answers.
  decisionSchema(token) {
    const side = this.sideOf(token);
    if (!this.yourTurn(side)) return {kind: 'wait'};
    const str = d => ({type: 'string', description: d});
    if (this.phase === 'teambuilding') {
      const q = question(this.seats[side].draft);
      return {kind: 'teambuilding', tool: 'draft_answer', title: q.title, prompt: q.prompt, schema: q.schema};
    }
    if (this.phase === 'preview') {
      const mine = this.seats[side].team.map(s => dex.species.get(s.species).name);
      const props = {
        bring: {type: 'array', items: {type: 'string', enum: mine}, minItems: 4, maxItems: 4, description: 'Four of YOUR six, no repeats; the first two lead'},
        game_plan: str('Leads, win condition, answers to their biggest threats; what changed from earlier games'),
      };
      return {kind: 'preview', tool: 'preview_submit', schema: {type: 'object', properties: props, required: Object.keys(props), additionalProperties: false}};
    }
    const obs = this.currentObs(side);
    return {kind: obs.options.kind, tool: 'turn_submit', schema: obs.schema};
  }

  // The current turn observation, rendered once per request.
  currentObs(side) {
    const game = this.currentGame;
    const view = this.game.view[side];
    const req = game.request(side);
    if (!view.lastObs || view.lastObs.req !== req) {
      view.lastObs = {...this.observe(side), req};
      view.cursor = game.battle.log.length;
    }
    return view.lastObs;
  }

  // A checklist in full the first time this seat meets that kind of decision,
  // then as a one-line reminder.
  think(side, kind) {
    const seen = this.seats[side].thinkShown ||= new Set();
    const full = !seen.has(kind);
    seen.add(kind);
    return thinkText(kind, full);
  }

  sheetFor(side, species) {
    const base = dex.species.get(species);
    return this.seats[side].sheet.find(s => [base.name, base.baseSpecies].some(n => toID(n) === toID(s.species)));
  }

  draftQuestion(token) {
    const side = this.sideOf(token);
    return question(this.seats[side].draft);
  }

  draftAnswer(token, args) {
    const d = this.draftSeat(token);
    if (d.error) return d;
    const draft = d.seat.draft;
    const q = question(draft);
    const need = {concept: ['concept'], species: ['species'], set: ['ability', 'item', 'nature', 'sp', 'moves'], lock: ['team_plan']}[q.step];
    const missing = need.filter(k => args[k] === undefined || args[k] === null || args[k] === '');
    if (missing.length) return {error: `This question (${q.title}) needs: ${missing.join(', ')}.`, question: q};
    let r;
    if (q.step === 'concept') r = this.draftConcept(token, {concept: args.concept});
    else if (q.step === 'lock') r = this.teamLock(token, {team_plan: args.team_plan});
    else if (q.step === 'species') {
      const list = [].concat(args.species);
      if (list.length !== 6) return {error: `Send exactly six species (got ${list.length}).`, question: q};
      // All or nothing: keep slots whose species is unchanged, place the rest.
      const before = JSON.stringify(draft.slots);
      const keep = draft.slots.map(s => s && list.some(x => toID(dex.species.get(x).name) === toID(s.species)) ? s : null);
      draft.slots = keep;
      const placed = new Set(keep.filter(Boolean).map(s => toID(s.species)));
      const todo = list.filter(x => !placed.has(toID(dex.species.get(x).name)));
      for (const name of todo) {
        const slot = draft.slots.findIndex(s => !s) + 1;
        const res = setSlot(draft, {slot, species: name});
        if (res.error) { draft.slots = JSON.parse(before); this.emit('change'); return {error: `${res.error} Nothing was changed; send all six again.`, question: q}; }
      }
      this.emit('change');
      r = {ok: true};
    } else r = this.draftSet(token, {slot: q.slot, ...Object.fromEntries(need.map(k => [k, args[k]]))});
    if (r.error) return {...r, question: q};
    return {ok: true, locked: q.step === 'lock'};
  }

  // Reopen a set (slot only) or swap the Pokémon in a slot (slot + species).
  draftRevise(token, {slot, species}) {
    const d = this.draftSeat(token);
    if (d.error) return d;
    const n = Number(slot);
    const cur = d.seat.draft.slots[n - 1];
    if (!cur) return {error: `Slot ${slot} is empty.`};
    if (species) {
      // A fresh slot for the new Pokémon; restore the old one if the swap is illegal.
      d.seat.draft.slots[n - 1] = null;
      const r = setSlot(d.seat.draft, {slot: n, species});
      if (r.error) { d.seat.draft.slots[n - 1] = cur; return {error: r.error}; }
    } else d.seat.draft.slots[n - 1] = {species: cur.species, item: '', ability: '', nature: '', sp: {}, moves: []};
    this.emit('change');
    return {ok: true};
  }

  guidedText(token) {
    const side = this.sideOf(token);
    const draft = this.seats[side].draft;
    return `${boardText(draft)}\n\n${questionText(question(draft), kind => this.think(side, kind))}`;
  }

  teamLock(token, {team_plan}) {
    const d = this.draftSeat(token);
    if (d.error) return d;
    d.seat.teamAttempts++;
    if (!team_plan || String(team_plan).trim().length < 10) return {error: 'team_plan is required (2–4 sentences).', board: boardText(d.seat.draft)};
    const v = lockCheck(d.seat.draft);
    if (!v.ok) return {error: 'The team is not ready to lock.', problems: v.problems, board: boardText(d.seat.draft, {lockProblems: v.problems})};
    this.acceptTeam(d.side, v.sets, team_plan);
    this.log(`${d.seat.name} locked a team`);
    if (SIDES.every(s => this.seats[s].team)) this.startGame();
    return {ok: true};
  }

  startGame() {
    const n = this.games.length + 1;
    const seed = gameSeed(this.seed, n);
    const game = new Game({
      seed,
      p1: {name: 'Player 1', sets: this.seats.p1.team.map(s => ({...s}))},
      p2: {name: 'Player 2', sets: this.seats.p2.team.map(s => ({...s}))},
    });
    watchSpeedOrder(game.battle, cs => applySpeedConstraints(this.speedBounds, cs));
    this.games.push({
      n, seed, game, startedAt: new Date().toISOString(), winner: null, turns: 0,
      preview: {p1: null, p2: null},
      view: SIDES.reduce((o, s) => (o[s] = {cursor: 0, plan: null, predictions: null, predLogStart: 0, history: [], oppSeen: new Set(), promptedAt: null}, o), {}),
    });
    this.phase = 'preview';
    this.log(`game ${n} team preview`);
  }

  submitPreview(token, {bring, game_plan}) {
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
    if (!game_plan || !String(game_plan).trim()) return {error: 'game_plan is required: leads, win condition, answers to their threats.'};
    const res = g.game.choose(side, `team ${idx.join(', ')}`);
    if (!res.ok) return {error: res.error};
    g.preview[side] = {bring: idx.map(i => team[i - 1].species), game_plan: clip(game_plan), at: new Date().toISOString()};
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
    const obs = this.currentObs(side);
    const conv = choiceFromAnswer(obs.menu, payload);
    if (conv.error) return {error: conv.error};
    // Predictions: one per live foe, an option from its sheet (or "switch").
    const predictions = [];
    // Built-in bots don't predict, so prediction stats stay about models.
    const predict = this.seats[side].builtin ? [] : obs.menu.predict;
    for (const f of predict) {
      const p = payload.predictions?.[f.foe];
      const allowed = predictionEnum(this.sheetFor(other(side), f.species));
      if (!p || typeof p !== 'object') return {error: `predictions.${f.foe} (${f.species}) is required: {"action": one of ${allowed.join(' | ')}, "confidence": 0–1}.`};
      const action = allowed.find(x => toID(x) === toID(p.action));
      if (!action) return {error: `predictions.${f.foe}.action must be one of: ${allowed.join(' | ')}.`};
      const confidence = Number(p.confidence);
      if (!(confidence >= 0 && confidence <= 1)) return {error: `predictions.${f.foe}.confidence must be a number from 0 to 1.`};
      predictions.push({foe: f.foe, species: f.species, action, confidence});
    }
    const turnBefore = game.turn;
    const logBefore = game.battle.log.length;
    const res = game.choose(side, conv.choice);
    if (!res.ok) return {error: res.error};
    const record = {
      kind: obs.options.kind, turn: turnBefore,
      payload: {ids: conv.ids, actions: conv.actions, predictions, reason: typeof payload.reason === 'string' ? clip(payload.reason) : null},
      choice: conv.choice, observation: obs.text,
    };
    this.recordDecision(side, record);
    if (obs.options.kind === 'move') {
      view.history.push(conv.choice);
      view.predictions = predictions;
      view.predLogStart = logBefore;
      view.lastRecord = record;
    }
    if (game.battle.log.length > logBefore) this.afterResolve(turnBefore);
    this.emit('change');
    return {ok: true};
  }

  // scope "match" concedes the set; "game" concedes only the game in progress
  // (the set goes on), which is what a player that cannot produce a legal
  // answer should lose.
  forfeit(token, {scope = 'match'} = {}) {
    const side = this.sideOf(token);
    return scope === 'game' ? this.forfeitGame(side) : this.forfeitSide(side);
  }

  // Conceding the match concedes every game still needed to decide it: the
  // game in progress, then unplayed games awarded to the opponent. Ratings are
  // fitted per game, so a side that cannot build a team or walks away takes
  // the same 0–2 it would have taken by losing on the field.
  forfeitSide(side, reason = 'forfeited') {
    if (this.phase === 'finished') return {error: 'Match already finished.'};
    // Nobody to lose to: the room simply closes.
    if (!this.seats[other(side)]) { this.abandon('the player left before an opponent joined'); return {ok: true}; }
    if (this.currentGame && !this.currentGame.ended) this.currentGame.forfeit(side);
    // The game in progress (battle or preview) is a loss for the forfeiter, not a tie.
    const g = this.game;
    if (g && !g.winner) {
      g.winner = other(side);
      g.forfeit = side;
      g.turns = g.game.turn || 0;
      this.score[other(side)]++;
    }
    while (this.score[other(side)] < this.winsNeeded) {
      this.score[other(side)]++;
      this.awarded.push({n: this.games.length + this.awarded.length + 1, winner: other(side), forfeit: side, awarded: true, turns: 0});
    }
    this.forfeitedBy = side;
    this.forfeitReason = reason;
    this.finish(other(side), `${this.seats[side].name} ${reason}`);
    return {ok: true};
  }

  forfeitGame(side, reason = 'forfeited the game') {
    if (this.phase === 'finished') return {error: 'Match already finished.'};
    const g = this.game;
    // Before the first game there is nothing smaller than the match to concede.
    if (!g || g.winner) return this.forfeitSide(side, reason.replace('the game', 'the match'));
    if (!g.game.ended) g.game.forfeit(side);
    g.forfeit = side;
    this.log(`${this.seats[side].name} ${reason}`);
    this.endGame();
    this.emit('change');
    return {ok: true};
  }

  // A match that never got going (a private room nobody joined): finished,
  // unrated, unrecorded.
  abandon(reason) {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.abandoned = true;
    this.winner = null;
    this.endReason = reason;
    this.finishedAt = new Date().toISOString();
    this.log(`match abandoned: ${reason}`);
    this.emit('abandoned');
    this.emit('change');
  }

  // ------------------------------------------------------------ clocks
  // The decision a side currently owes, as a key that changes with every new
  // decision (a new turn is a new request object).
  pendingKeyFor(side) {
    if (this.phase === 'battle') return this.currentGame.request(side);
    return `${this.phase}:${this.game?.n || 0}`;
  }

  // Start (or keep) the clock on whatever this side owes right now.
  touchClock(side, now = Date.now()) {
    if (this.phase === 'finished' || this.phase === 'waiting' || !this.yourTurn(side)) {
      this.pendingSince[side] = null;
      this.pendingKey[side] = null;
      return;
    }
    const key = this.pendingKeyFor(side);
    if (this.pendingKey[side] !== key) { this.pendingKey[side] = key; this.pendingSince[side] = now; }
  }

  clockLimit() { return this.phase === 'teambuilding' ? this.clock.teambuild : this.clock.decision; }

  deadline(side) {
    const since = this.pendingSince[side];
    const limit = this.clockLimit();
    return since != null && limit > 0 ? since + limit : null;
  }

  // Called about once a second by the arena. Forfeits whatever a side has
  // left waiting for too long.
  tick(now = Date.now()) {
    if (this.phase === 'finished' || this.phase === 'waiting') return;
    for (const s of SIDES) {
      this.touchClock(s, now);
      const due = this.deadline(s);
      if (!due || now < due) continue;
      this.timeouts[s]++;
      const what = `ran out of time (${Math.round(this.clockLimit() / 60000)} min without an answer)`;
      if (this.phase === 'teambuilding' || this.timeouts[s] >= 2) this.forfeitSide(s, what);
      else this.forfeitGame(s, what);
      if (this.phase === 'finished') return;
    }
  }

  // What each player is doing with its tools, for the live "mind" panels.
  noteActivity(token, tool, args, ok) {
    let side;
    try { side = this.sideOf(token); } catch { return; }
    const d = this.seats[side].draft;
    if (this.phase === 'teambuilding' && RESEARCH_TOOLS.has(tool) && d) {
      d.research++;
      if (tool === 'pokemon' && ok) { const sp = dex.species.get(args?.name); if (sp.exists && !(d.researched ||= []).includes(sp.name)) d.researched.push(sp.name); }
    }
    const {seat, ...a} = args || {};
    const mon = t => { const l = String(t || '').trim().split('\n')[0].split('@')[0].trim(); const m = /\(([^)]+)\)/.exec(l); return (m && !/^[MF]$/.test(m[1]) ? m[1] : l.replace(/\(.*?\)/g, '')).trim(); };
    const detail = {
      pokemon: () => a.name, move: () => a.name, item: () => a.name, ability: () => a.name,
      search_pokemon: () => Object.entries(a).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', '),
      search_moves: () => Object.entries(a).map(([k, v]) => `${k} ${v}`).join(', '), search_items: () => a.query || 'all',
      calc: () => `${mon(a.attacker)} ${a.move} → ${mon(a.defender)}`,
      preview_submit: () => (a.bring || []).join(' · '),
      draft_answer: () => (a.concept ? String(a.concept).slice(0, 90)
        : a.species ? [].concat(a.species).join(' · ')
        : a.team_plan ? 'locks the team'
        : [a.item && `@ ${a.item}`, a.ability, a.nature, a.moves && [].concat(a.moves).join(', ')].filter(Boolean).join(' · ')),
      draft_revise: () => `slot ${a.slot}${a.species ? ` → ${a.species}` : ' reopened'}`,
      // The choice itself stays sealed: the opponent may not have answered yet.
      turn_submit: () => 'locks in the turn', arena_forfeit: () => 'forfeits',
    }[tool]?.() || '';
    // Pokémon this call was about, so the page can grow candidate cards.
    const speciesOf = {
      pokemon: () => [a.name], calc: () => [mon(a.attacker), mon(a.defender)],
      draft_answer: () => (a.species ? [].concat(a.species) : []), draft_revise: () => (a.species ? [a.species] : []),
    }[tool]?.() || [];
    const species = speciesOf.map(x => { const sp = dex.species.get(x); return sp.exists ? sp.name : null; }).filter(Boolean);
    this.activity.push({side, tool, ok, detail, species, draft: tool === 'draft_answer' || tool === 'draft_revise', t: Date.now(), game: this.game?.n || 0, turn: this.currentGame?.turn || 0});
    if (this.activity.length > 400) this.activity.splice(0, 100);
    this.emit('change');
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
      if (m) g.view[other(m[2])].oppSeen.add(teamName(m[3]));
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
      // Graded against what the opponent chose, not what the log shows: a
      // flinch or a faint does not make a correct read wrong.
      d.predictionScores = d.payload.predictions.map(p => {
        const slot = p.foe === 'foe1' ? 1 : p.foe === 'foe2' ? 2 : 0;
        const actual = (theirs.payload.actions || []).find(a => Number(a.slot) === slot);
        if (!actual) return {foe: p.foe, predicted: p.action, actual: null};
        const actualLabel = chosenLabel(actual);
        const correct = predictionHit(p.action, actualLabel);
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
    if (decided) return this.finish(decided, `first to ${this.winsNeeded} game wins`);
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
    return `Game ${this.game.n} (best of ${this.bestOf}) · Set score you ${this.score[side]}–${this.score[other(side)]}`;
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
    }
    const youMega = game.battle.log.some(l => l.startsWith(`|-mega|${side}`));
    if (youMega) alerts.push('You have already used your Mega Evolution this game.');
    // Last turn's predictions, graded the same way the record is: against
    // what the opponent chose. What the log shows is added when it differs.
    const predictionReview = [];
    if (view.predictions && view.lastRecord) {
      const lines = game.linesFor('spectator', view.predLogStart, end);
      const theirs = this.decisions.find(d => d.side === other(side) && d.game === g.n && d.turn === view.lastRecord.turn && d.kind === 'move');
      for (const p of view.predictions) {
        if (!p.species) continue;
        const pos = p.foe === 'foe1' ? 'a' : 'b';
        const used = lines.map(l => new RegExp(`^\\|move\\|${other(side)}${pos}: [^|]*\\|([^|]*)`).exec(l)).find(Boolean)?.[1];
        const switched = lines.some(l => new RegExp(`^\\|switch\\|${other(side)}${pos}:`).test(l));
        const who = `${other(side)}${pos}:`;
        const cant = lines.map(l => (l.startsWith(`|cant|${who}`) ? l.split('|')[3] : null)).find(Boolean);
        const fainted = lines.some(l => l.startsWith(`|faint|${who}`));
        const why = cant ? ({flinch: 'flinched', par: 'fully paralyzed', slp: 'asleep', frz: 'frozen', recharge: 'recharging'}[cant] || `could not move (${cant.replace(/^(move|ability): /, '')})`) : fainted ? 'fainted before moving' : null;
        const chosen = chosenLabel((theirs?.payload.actions || []).find(a => Number(a.slot) === (p.foe === 'foe1' ? 1 : 2)));
        let happened;
        if (chosen) {
          happened = `they chose ${chosen} ${predictionHit(p.action, chosen) ? '✓' : '✗'}`;
          const note = used && chosen !== 'switch' && toID(used) !== toID(chosen) ? `used ${used} instead` : !used && !switched ? why : null;
          if (note) happened += ` (${note})`;
        } else happened = used ? `used ${used}` : switched ? 'switched out' : why || 'did not visibly act';
        predictionReview.push(`${p.foe} ${p.species}: you predicted ${p.action} (${Math.round(p.confidence * 100)}%) → ${happened}`);
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
      oppSpeedBounds: this.speedBounds[other(side)],
      think: kind => this.think(side, kind),
      alerts,
    });
    return obs;
  }

  // The text + flags a player gets from arena_state / arena_wait / submits.
  stateFor(token) {
    const side = this.sideOf(token);
    const seat = this.seats[side];
    const opp = this.seats[other(side)];
    const base = {matchId: this.id, room: this.room, side, phase: this.phase, score: {you: this.score[side], opponent: opp ? this.score[other(side)] : 0}, game: this.game?.n || 0};
    if (this.phase === 'waiting') return {...base, yourTurn: false, text: 'Waiting for an opponent to join this match. Call arena_wait.'};
    if (this.phase === 'finished') {
      if (this.abandoned) return {...base, yourTurn: false, finished: true, text: `MATCH ABANDONED (${this.endReason}). No games were played and nothing was recorded. You are done — no further actions.`};
      const result = this.winner === 'tie' ? 'The match was a TIE' : this.winner === side ? 'You WON the match' : 'You LOST the match';
      // Players are anonymous to each other, so a forfeit is told from this seat's side.
      const why = this.forfeitedBy ? `${this.forfeitedBy === side ? 'you' : 'your opponent'} ${this.forfeitReason || 'forfeited'}` : this.endReason;
      return {...base, yourTurn: false, finished: true, text: `MATCH FINISHED. ${result} ${this.score[side]}–${this.score[other(side)]} (${why}). You are done — no further actions.\n\n${this.gameSummaries(side)}`};
    }
    if (!this.yourTurn(side)) return {...base, yourTurn: false, text: `Waiting for your opponent (phase: ${this.phase}${this.phase === 'battle' ? `, game ${this.game.n}, turn ${this.currentGame.turn}` : ''}). Call arena_wait.`};
    const g = this.game;
    if (g?.view) g.view[side].promptedAt ||= Date.now();
    this.touchClock(side);
    base.deadline = this.deadline(side);
    if (this.phase === 'teambuilding') {
      return {...base, yourTurn: true, kind: 'teambuilding', text: `${TEAMBUILD_TEXT}\n\nYour opponent is anonymous to you (and you to them). You will see their team sheet at team preview.\n\n${this.guidedText(token)}`};
    }
    if (this.phase === 'preview') {
      const L = [];
      L.push(`=== ${this.header(side)} · TEAM PREVIEW ===`);
      if (g.n > 1) L.push('', this.gameSummaries(side));
      L.push('', 'YOUR TEAM (full sets):', seat.teamText.trim());
      L.push('', `YOUR TEAM PLAN: ${seat.teamPlan}`);
      L.push('', `OPPONENT'S OPEN TEAM SHEET:`, openSheetText(opp.sheet));
      L.push('', 'Opponent stat ranges at level 50 (any legal spread):');
      for (const s of opp.sheet) L.push(`  ${s.species}: ${rangesLine(s.species)}`);
      L.push('', this.think(side, 'preview'));
      L.push('', `ANSWER with preview_submit: {"bring": [4 of ${seat.team.map(s => `"${s.species}"`).join(', ')}], "game_plan": "…"}
  bring: the first two lead · game_plan: 2–3 sentences on leads, win condition and answers to their biggest threats${g.n > 1 ? ', and what you are changing from earlier games' : ''}`);
      return {...base, yourTurn: true, kind: 'preview', text: L.join('\n')};
    }
    const obs = this.currentObs(side);
    return {...base, yourTurn: true, kind: obs.options.kind, turn: this.currentGame.turn, text: obs.text};
  }

  // What a player remembers from finished games: result, what the opponent
  // brought and did each turn, and how the last game ended from their view.
  gameSummaries(side) {
    const done = this.games.filter(g => g.winner || g.endedAt);
    if (!done.length) return '';
    const opp = other(side);
    const L = [];
    const last = done.at(-1);
    const end = last.game.linesFor(side, last.view[side].cursor);
    const ending = describeLines(end, side);
    if (ending.length) L.push(`HOW GAME ${last.n} ENDED (since your last decision):`, ...ending.slice(-30).map(l => `  ${l}`), '');
    L.push('PREVIOUS GAMES:');
    for (const g of done) {
      const res = g.winner === 'tie' || !g.winner ? 'tie' : g.winner === side ? 'you won' : 'you lost';
      const log = g.game.linesFor('spectator');
      const oppSeen = [...new Set(log.filter(l => new RegExp(`^\\|(switch|drag)\\|${opp}[ab]:`).test(l)).map(l => teamName(l.split('|')[3].split(',')[0])))];
      L.push(`  Game ${g.n}: ${res} on turn ${g.game.turn}${g.forfeit ? ` (${g.forfeit === side ? 'you' : 'they'} forfeited)` : ''}. They brought ${oppSeen.join(', ') || 'nothing seen'}, leading ${oppSeen.slice(0, 2).join(' + ')}. You brought ${g.preview[side]?.bring.join(', ') || 'nothing (no team preview)'}.`);
      const acts = opponentActions(log, opp);
      if (acts.length) L.push('    Their actions by turn:', ...acts.map(([turn, list]) => `      T${turn}: ${list.join(' · ')}`));
    }
    return L.join('\n');
  }

  // Spectator protocol for one game with the real identities filled in
  // (players only ever see "Player 1/2").
  spectatorLines(n) {
    const g = this.games[n - 1];
    if (!g) return [];
    return displayNames(g.game.linesFor('spectator'), this.seats);
  }

  publicView({reveal = false} = {}) {
    // "Thinking for Ns" restarts with every new decision (phase, game or turn).
    const step = `${this.phase}:${this.game?.n || 0}:${this.currentGame?.turn || 0}`;
    for (const s of SIDES) {
      const mine = this.seats[s] && this.phase !== 'finished' && this.phase !== 'waiting' && this.yourTurn(s);
      if (!mine) { this.since[s] = null; continue; }
      if (!this.since[s] || this.sinceStep?.[s] !== step) { this.since[s] = Date.now(); (this.sinceStep ||= {})[s] = step; }
    }
    const showTeams = SIDES.every(s => this.seats[s]?.team);
    const finished = this.phase === 'finished';
    return {
      id: this.id, room: this.room, label: this.label, phase: this.phase, createdAt: this.createdAt, finishedAt: this.finishedAt,
      format: FORMAT_ID, bestOf: this.bestOf, score: this.score, winner: this.winner, endReason: this.endReason, awardedGames: this.awarded.length,
      players: SIDES.map(s => this.seats[s] ? {side: s, name: this.seats[s].name, model: this.seats[s].model, modelName: this.seats[s].identity?.name, effort: this.seats[s].identity?.effort || null, provider: this.seats[s].identity?.provider, owner: this.seats[s].owner, harness: this.seats[s].harness, path: this.seats[s].path, flags: this.seats[s].flags, teamSubmitted: !!this.seats[s].team,
        rejections: this.rejections[s].length, timeouts: this.timeouts[s], deadline: this.deadline(s), api: this.seats[s].api || null} : null),
      abandoned: !!this.abandoned,
      current: this.game ? {n: this.game.n, previewLocked: {p1: !!this.game.preview.p1, p2: !!this.game.preview.p2}, turn: this.game.game.turn} : null,
      sheets: showTeams ? {p1: this.seats.p1.sheet, p2: this.seats.p2.sheet} : null,
      games: this.games.map(g => ({
        n: g.n, winner: g.winner, turn: g.game.turn, endedAt: g.endedAt || null,
        log: describeLines(g.game.linesFor('spectator'), 'spectator'),
        rawLog: this.spectatorLines(g.n).join('\n'),
      })),
      events: this.events.slice(-50),
      thinking: {p1: this.since.p1, p2: this.since.p2, now: Date.now()},
      // Live research is shown as activity only; the details unlock at the end.
      activity: this.activity.slice(-120).map(a => (finished || reveal || !SEALED ? a : {...a, detail: null, species: []})),
      // Each side's latest draft and the Pokémon it has been looking at.
      research: Object.fromEntries(SIDES.map(sd => {
        if (SEALED && !finished && !reveal) return [sd, null];
        const acts = this.activity.filter(a => a.side === sd);
        const last = [...acts].reverse().find(a => a.draft && a.species?.length);
        const seen = [];
        for (const a of acts) for (const sp of a.species || []) if (!seen.includes(sp)) seen.push(sp);
        // The draft board is the source of truth; older text-team activity is the fallback.
        const board = this.seats[sd]?.draft;
        const fromBoard = board?.slots.some(Boolean) ? board.slots.filter(Boolean).map(x => x.species) : null;
        const draft = this.seats[sd]?.team ? this.seats[sd].team.map(x => dex.species.get(x.species).name) : fromBoard || (last?.species || []).slice(0, 6);
        return [sd, {draft, board: board ? boardSummary(board) : null, concept: board?.concept || '', draftOk: fromBoard ? true : last ? last.ok : null, cands: seen.filter(x => !draft.includes(x)).slice(-14), calls: acts.length, research: board?.research || 0}];
      })),
      // Each game's chosen four, once that game's battle has started.
      brings: this.games.map(g => (g.preview.p1 && g.preview.p2 && (finished || reveal || !SEALED) ? {n: g.n, p1: g.preview.p1.bring, p2: g.preview.p2.bring} : {n: g.n})),
      dex: showTeams ? sheetDex([...this.seats.p1.sheet, ...this.seats.p2.sheet]) : null,
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
      id: this.id, room: this.room, label: this.label, seed: this.seed, bestOf: this.bestOf,
      createdAt: this.createdAt, finishedAt: this.finishedAt, createdBy: this.createdBy,
      fixedTeams: this.fixedTeams ? {source: this.fixedTeams.source || null} : null,
      winner: this.winner, endReason: this.endReason, score: this.score,
      players: Object.fromEntries(SIDES.map(s => [s, this.seats[s] && {
        name: this.seats[s].name, model: this.seats[s].model, identity: this.seats[s].identity, owner: this.seats[s].owner,
        client: this.seats[s].client, detectedHarness: this.seats[s].detectedHarness, flags: this.seats[s].flags, harness: this.seats[s].harness, path: this.seats[s].path, api: this.seats[s].api || null,
        teamText: this.seats[s].teamText, teamPlan: this.seats[s].teamPlan, teamHash: this.seats[s].teamHash, teamAttempts: this.seats[s].teamAttempts, timeouts: this.timeouts[s],
      }])),
      games: this.games.map(g => ({n: g.n, seed: g.seed, winner: g.winner, forfeit: g.forfeit || null, turns: g.game.turn, startedAt: g.startedAt, endedAt: g.endedAt, preview: g.preview, spectatorLog: g.spectatorLog, displayLog: this.spectatorLines(g.n).join('\n'), omniscientLog: g.omniscientLog})),
      awardedGames: this.awarded,
      decisions: this.decisions,
      rejections: this.rejections,
      events: this.events,
      briefing: BRIEFING,
    };
  }
}

export {SIDES, other, parseTeam, displayName, displayNames};
