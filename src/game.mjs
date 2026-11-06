// One battle (one game of a set), driven synchronously through the simulator.
import {Battle, Teams, FORMAT_ID} from './showdown.mjs';

export const MAX_TURNS = Number(process.env.VGC_MAX_TURNS || 60);

// Showdown's log interleaves per-player secrets: "|split|p1" is followed by the
// p1-only line, then the public line.
export function channel(lines, viewer) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('|split|')) {
      const owner = line.slice(7);
      const secret = lines[i + 1];
      const pub = lines[i + 2];
      i += 2;
      if (viewer === 'omniscient' || viewer === owner) out.push(secret);
      else out.push(pub);
      continue;
    }
    out.push(line);
  }
  return out;
}

export class Game {
  constructor({seed, p1, p2}) {
    this.seed = seed;
    this.names = {p1: p1.name, p2: p2.name};
    this.errors = {p1: null, p2: null};
    this.battle = new Battle({
      formatid: FORMAT_ID,
      seed,
      send: (type, data) => {
        if (type !== 'sideupdate') return;
        const [side, ...rest] = data.split('\n');
        const msg = rest.join('\n');
        if (msg.startsWith('|error|')) this.errors[side] = msg.slice(7);
      },
    });
    this.battle.setPlayer('p1', {name: p1.name, team: Teams.pack(p1.sets)});
    this.battle.setPlayer('p2', {name: p2.name, team: Teams.pack(p2.sets)});
    this.logCursor = 0;
    this.turns = []; // [{turn, choices: {p1, p2}, start, end}] — start/end index battle.log
    this.pendingChoices = {};
    this.flushTurn();
  }

  side(id) { return this.battle.sides[id === 'p1' ? 0 : 1]; }
  request(id) {
    const req = this.side(id).activeRequest;
    if (!req || req.wait || this.battle.ended) return null;
    return req;
  }
  get turn() { return this.battle.turn; }
  get ended() { return this.battle.ended || this.battle.turn > MAX_TURNS; }
  get winnerSide() {
    if (!this.battle.ended) return null;
    const w = this.battle.winner;
    if (!w) return 'tie';
    return w === this.battle.sides[0].name ? 'p1' : w === this.battle.sides[1].name ? 'p2' : 'tie';
  }

  // Does this side owe the simulator a choice right now?
  needsChoice(id) {
    const req = this.request(id);
    if (!req) return false;
    return !this.side(id).isChoiceDone();
  }

  // Submit a raw Showdown choice. Returns {ok, error}. When the last pending
  // choice lands, the simulator resolves the turn immediately.
  choose(id, choice) {
    this.errors[id] = null;
    const req = this.side(id).activeRequest;
    const turnBefore = this.battle.turn;
    let ok;
    try { ok = this.battle.choose(id, choice); } catch (err) { ok = false; this.errors[id] ||= err.message; }
    if (!ok) {
      try { this.side(id).clearChoice(); } catch {}
      return {ok: false, error: this.errors[id] || 'Invalid choice'};
    }
    this.pendingChoices[id] = {choice, kind: req?.teamPreview ? 'preview' : req?.forceSwitch ? 'switch' : 'move', turn: turnBefore};
    if (this.battle.log.length > this.logCursor) this.flushTurn();
    if (!this.battle.ended && this.battle.turn > MAX_TURNS) this.tieOut();
    return {ok: true};
  }

  newLines() { return this.battle.log.slice(this.logCursor); }
  flushTurn() {
    const start = this.logCursor;
    this.logCursor = this.battle.log.length;
    this.turns.push({turn: this.battle.turn, choices: this.pendingChoices, start, end: this.logCursor});
    this.pendingChoices = {};
  }

  // Lines a viewer has seen since index `from` (in this.battle.log space).
  linesFor(viewer, from = 0, to = this.battle.log.length) {
    return channel(this.battle.log.slice(from, to), viewer);
  }

  spectatorLog() { return channel(this.battle.log, 'spectator').join('\n'); }
  forfeit(id) { this.battle.forceWin(id === 'p1' ? 'p2' : 'p1'); this.flushTurn(); }
  tieOut() { this.battle.tie(); this.flushTurn(); }
}

// ----------------------------------------------------------------- formatting
// Turn protocol lines into short human-readable text from one player's view.
export function describeLines(lines, viewer) {
  const me = viewer === 'p1' || viewer === 'p2' ? viewer : null;
  const who = ident => {
    const m = /^(p[12])([ab]?): (.*)$/.exec(ident || '');
    if (!m) return ident || '';
    const owner = !me ? `${m[1]}` : m[1] === me ? 'your' : 'their';
    return `${owner} ${m[3]}`;
  };
  const hp = (h, ident) => {
    if (!h) return '';
    const [frac, status] = h.split(' ');
    if (frac === '0' || frac.startsWith('0 ')) return 'fainted';
    const [cur, max] = frac.split('/').map(Number);
    const pct = max ? Math.round((cur / max) * 100) : cur;
    const exact = max && max !== 100 ? ` (${cur}/${max})` : '';
    return `${pct}%${exact}${status ? ` ${status}` : ''}`;
  };
  const from = parts => {
    const f = parts.find(p => p?.startsWith('[from]'));
    return f ? ` (${f.slice(7).replace(/^(item|ability|move): /, '')})` : '';
  };
  const out = [];
  for (const [li, line] of lines.entries()) {
    if (!line || line[0] !== '|') continue;
    const p = line.slice(1).split('|');
    const t = p[0];
    switch (t) {
    case 'turn': out.push(`— Turn ${p[1]} —`); break;
    case 'move': {
      const via = p.find(x => x?.startsWith('[from]'));
      const how = !via ? '' : via === '[from] lockedmove' ? ' (continuing)' : ` (via ${via.slice(7).replace(/^(item|ability|move): /, '')})`;
      // A spread move logs only its first target; the lines after it name everyone hit.
      const spread = p.some(x => x?.startsWith('[spread]'));
      out.push(`${who(p[1])} used ${p[2]}${spread ? ' (spread)' : p[3] && p[3] !== p[1] ? ` → ${who(p[3])}` : ''}${how}${p.includes('[miss]') ? ' (missed)' : ''}`);
      break;
    }
    case 'switch': case 'drag': out.push(`${who(p[1])} ${t === 'drag' ? 'was dragged in' : 'switched in'} (${p[2].split(',')[0]}, ${hp(p[3])})`); break;
    case '-damage': out.push(`  ${who(p[1])} → ${hp(p[2])}${from(p)}`); break;
    case '-heal': out.push(`  ${who(p[1])} healed → ${hp(p[2])}${from(p)}`); break;
    case 'faint': out.push(`  ${who(p[1])} fainted`); break;
    case '-status': out.push(`  ${who(p[1])} is now ${p[2]}${from(p)}`); break;
    case '-curestatus': out.push(`  ${who(p[1])} cured of ${p[2]}`); break;
    case '-boost': out.push(`  ${who(p[1])} ${p[2]} +${p[3]}${from(p)}`); break;
    case '-unboost': out.push(`  ${who(p[1])} ${p[2]} -${p[3]}${from(p)}`); break;
    case '-setboost': out.push(`  ${who(p[1])} ${p[2]} set to ${p[3]}${from(p)}`); break;
    case '-clearallboost': out.push('  all stat changes cleared'); break;
    case '-weather': out.push(p[1] === 'none' ? '  weather ended' : p.includes('[upkeep]') ? '' : `  weather: ${p[1]}${from(p)}`); break;
    case '-fieldstart': out.push(`  field: ${p[1].replace('move: ', '')} started`); break;
    case '-fieldend': out.push(`  field: ${p[1].replace('move: ', '')} ended`); break;
    case '-sidestart': out.push(`  ${p[1].startsWith(me || '#') ? 'your side' : me ? 'their side' : p[1]}: ${p[2].replace('move: ', '')} started`); break;
    case '-sideend': out.push(`  ${p[1].startsWith(me || '#') ? 'your side' : me ? 'their side' : p[1]}: ${p[2].replace('move: ', '')} ended`); break;
    case '-mega': out.push(`  ${who(p[1])} Mega Evolved (${p[3] || p[2]})`); break;
    case 'detailschange': break;
    case '-ability': out.push(`  ${who(p[1])}'s ${p[2]}${p[3] && !p[3].startsWith('[') ? ` (${p[3]})` : ''}`); break;
    case '-item': out.push(`  ${who(p[1])} has ${p[2]}${from(p)}`); break;
    case '-enditem': out.push(`  ${who(p[1])}'s ${p[2]} ${p.some(x => x?.startsWith('[eat]')) ? 'was eaten' : 'was used up/removed'}${from(p)}`); break;
    case '-fail': out.push(`  ${who(p[1])}: it failed${p[2] ? ` (${p[2].replace('move: ', '')})` : ''}`); break;
    case '-miss': out.push(`  missed${p[2] ? ` ${who(p[2])}` : ''} (accuracy)`); break;
    case '-immune': out.push(`  ${who(p[1])} is immune${from(p)}`); break;
    case '-supereffective': out.push(`  super effective on ${who(p[1])}`); break;
    case '-resisted': out.push(`  resisted by ${who(p[1])}`); break;
    case '-crit': out.push(`  critical hit on ${who(p[1])}`); break;
    case 'cant': out.push(`  ${who(p[1])} couldn't move (${(p[2] || '').replace('move: ', '')})`); break;
    case '-activate': out.push(`  ${who(p[1])}: ${(p[2] || '').replace(/^(move|ability|item): /, '')}${p[3] && !p[3].startsWith('[') ? ` ${p[3]}` : ''}`); break;
    case '-start': out.push(`  ${who(p[1])}: ${(p[2] || '').replace(/^(move|ability|item): /, '')} started${p[3] && !p[3].startsWith('[') ? ` (${p[3]})` : ''}`); break;
    case '-end': out.push(`  ${who(p[1])}: ${(p[2] || '').replace(/^(move|ability|item): /, '')} ended`); break;
    case '-singleturn': case '-singlemove': out.push(`  ${who(p[1])}: ${(p[2] || '').replace('move: ', '')}`); break;
    case '-transform': out.push(`  ${who(p[1])} transformed into ${who(p[2])}`); break;
    case '-formechange': out.push(`  ${who(p[1])} changed form to ${p[2]}`); break;
    case '-hitcount': out.push(`  hit ${p[2]} times`); break;
    case '-prepare': out.push(String(lines[li + 1] || '').startsWith(`|-anim|${p[1]}`) ? `  ${p[2]} charged instantly and fired this turn` : `  ${who(p[1])} is charging ${p[2]}; it fires next turn`); break;
    case 'win': out.push(`WINNER: ${p[1]}`); break;
    case 'tie': out.push('TIE'); break;
    default: break;
    }
  }
  return out.filter(Boolean);
}
