// Everything the website shows, computed from the stats database.
// Ratings: Bradley–Terry on game results (Elo scale, 1500 = average of rated
// entries), 90% intervals from refitting on bootstrap resamples of whole
// matches. Mirror matches carry no information and are skipped. Unlisted
// (unregistered) models are excluded unless asked for.
import {modelInfo} from './models.mjs';

export function fitBT(pairs, players, iters = 250) {
  const r = Object.fromEntries(players.map(p => [p, 1]));
  for (let it = 0; it < iters; it++) {
    for (const p of players) {
      // A virtual half-win/half-loss against a 1500 anchor keeps undefeated entries finite.
      let wins = 0.5, denom = 1 / (r[p] + 1);
      for (const [a, b, s] of pairs) {
        if (a === p) { wins += s; denom += 1 / (r[a] + r[b]); }
        else if (b === p) { wins += 1 - s; denom += 1 / (r[a] + r[b]); }
      }
      r[p] = wins / denom;
    }
    const g = Math.exp(players.reduce((acc, p) => acc + Math.log(r[p]), 0) / players.length);
    for (const p of players) r[p] /= g;
  }
  return Object.fromEntries(players.map(p => [p, 1500 + 400 * Math.log10(r[p])]));
}
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

// A leaderboard row's identity: the model alone, or the model plus the
// reasoning effort or the connection path (mcp / api / cli / http / builtin).
export function rowKey(group, model, effort, path) {
  if (group === 'effort') return `${model}|${effort || 'default'}`;
  if (group === 'path') return `${model}|${path || 'http'}`;
  return model;
}

const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

export class Stats {
  constructor(db) { this.db = db; this.cache = new Map(); }

  memo(key, fn) {
    const hit = this.cache.get(key);
    if (hit && hit.v === this.db.version) return hit.data;
    const data = fn();
    this.cache.set(key, {v: this.db.version, data});
    return data;
  }

  seatsWhere({includeUnlisted = false} = {}) { return includeUnlisted ? '1=1' : 's.listed = 1'; }

  summary() {
    return this.memo('summary', () => {
      const d = this.db;
      const m = d.get(`select count(*) n, max(finished_at) last from matches where rated = 1`);
      const g = d.get(`select count(*) n, coalesce(sum(turns),0) turns from games g join matches m on m.id = g.match_id where m.rated = 1`);
      const models = d.get(`select count(distinct model_id) n from seats where listed = 1 and provider != 'arena'`);
      const owners = d.get(`select count(distinct owner) n from seats where owner != ''`);
      const species = d.get(`select count(distinct species) n from team_mons`);
      return {matches: m.n, games: g.n, turns: g.turns, models: models.n, owners: owners.n, species: species.n, lastMatchAt: m.last};
    });
  }

  // Rows: one per game, with both seats' keys.
  gameRows({by = 'pilot', group = 'model', includeUnlisted = false} = {}) {
    const col = by === 'builder' ? 'builder_model_id' : 'model_id';
    const rows = this.db.all(`
      select g.match_id, g.n, g.winner, a.${col} a_model, a.effort a_effort, a.path a_path, a.listed a_listed, b.${col} b_model, b.effort b_effort, b.path b_path, b.listed b_listed
      from games g join matches m on m.id = g.match_id and m.rated = 1
      join seats a on a.match_id = g.match_id and a.side = 'p1'
      join seats b on b.match_id = g.match_id and b.side = 'p2'
      where g.winner in ('p1', 'p2', 'tie')`);
    const key = (model, effort, p) => rowKey(group, model, effort, p);
    return rows
      .filter(r => includeUnlisted || ((r.a_listed || String(r.a_model).startsWith('builtin:')) && (r.b_listed || String(r.b_model).startsWith('builtin:'))))
      .map(r => ({match: r.match_id, a: key(r.a_model, r.a_effort, r.a_path), b: key(r.b_model, r.b_effort, r.b_path), s: r.winner === 'p1' ? 1 : r.winner === 'p2' ? 0 : 0.5}))
      .filter(r => r.a !== r.b);
  }

  leaderboard(opts = {}) {
    const {by = 'pilot', group = 'model', includeUnlisted = false, boot = 200} = opts;
    return this.memo(`lb:${by}:${group}:${includeUnlisted}`, () => {
      const games = this.gameRows({by, group, includeUnlisted});
      const players = [...new Set(games.flatMap(g => [g.a, g.b]))];
      if (!players.length) return {rows: [], games: 0};
      const pairs = games.map(g => [g.a, g.b, g.s]);
      const point = players.length > 1 ? fitBT(pairs, players) : {[players[0]]: 1500};
      // Bootstrap over whole matches.
      const byMatch = new Map();
      for (const g of games) { if (!byMatch.has(g.match)) byMatch.set(g.match, []); byMatch.get(g.match).push([g.a, g.b, g.s]); }
      const matchList = [...byMatch.values()];
      const samples = Object.fromEntries(players.map(p => [p, []]));
      for (let i = 0; i < boot && players.length > 1; i++) {
        const sample = [];
        for (let j = 0; j < matchList.length; j++) sample.push(...matchList[Math.floor(Math.random() * matchList.length)]);
        const sp = [...new Set(sample.flatMap(([a, b]) => [a, b]))];
        if (sp.length < 2) continue;
        const rr = fitBT(sample, sp, 100);
        for (const p of sp) samples[p].push(rr[p]);
      }
      const rec = Object.fromEntries(players.map(p => [p, {w: 0, l: 0, t: 0, matches: new Set()}]));
      for (const g of games) {
        rec[g.a].matches.add(g.match); rec[g.b].matches.add(g.match);
        if (g.s === 1) { rec[g.a].w++; rec[g.b].l++; } else if (g.s === 0) { rec[g.b].w++; rec[g.a].l++; } else { rec[g.a].t++; rec[g.b].t++; }
      }
      const col = by === 'builder' ? 'builder_model_id' : 'model_id';
      const splitCol = {effort: 's.effort', path: 's.path'}[group];
      const seatStats = this.db.all(`select s.${col} model, s.effort, s.path, sum(s.predictions) preds, sum(s.predictions_correct) correct, sum(s.brier_sum) brier,
        group_concat(s.median_think_ms) thinks, sum(s.rejections) rejections, count(*) seats, group_concat(distinct s.owner) owners
        from seats s join matches m on m.id = s.match_id and m.rated = 1 group by s.${col}${splitCol ? `, ${splitCol}` : ''}`);
      const statFor = key => seatStats.find(x => rowKey(group, x.model, x.effort, x.path) === key) || {};
      const rows = players.map(p => {
        const bs = samples[p].sort((x, y) => x - y);
        const st = statFor(p);
        const [model, split = null] = p.split('|');
        const info = modelInfo(model);
        return {
          // split: the second half of the row key (reasoning effort or connection path), shown as a chip.
          key: p, model, split, effort: group === 'effort' ? split : null, path: group === 'path' ? split : null,
          name: info?.name || model.replace(/^unlisted:/, ''), provider: info?.provider || 'unknown', listed: !!info,
          rating: point[p], lo: bs.length ? bs[Math.floor(bs.length * 0.05)] : null, hi: bs.length ? bs[Math.floor(bs.length * 0.95)] : null,
          games: rec[p].w + rec[p].l + rec[p].t, w: rec[p].w, l: rec[p].l, t: rec[p].t, matches: rec[p].matches.size,
          predictionAccuracy: st.preds ? st.correct / st.preds : null, brier: st.preds ? st.brier / st.preds : null, predictions: st.preds || 0,
          medianThinkMs: median(String(st.thinks || '').split(',').map(Number).filter(Boolean)),
          rejectionsPerMatch: st.seats ? st.rejections / st.seats : null,
          owners: String(st.owners || '').split(',').filter(Boolean).length,
        };
      }).sort((a, b) => b.rating - a.rating);
      return {rows, games: games.length, matches: byMatch.size};
    });
  }

  headToHead(opts = {}) {
    return this.memo(`h2h:${JSON.stringify(opts)}`, () => {
      const lb = this.leaderboard(opts);
      const games = this.gameRows(opts);
      const keys = lb.rows.map(r => r.key);
      const cell = (a, b) => {
        let w = 0, l = 0, t = 0;
        for (const g of games) {
          if (g.a === a && g.b === b) { if (g.s === 1) w++; else if (g.s === 0) l++; else t++; }
          if (g.a === b && g.b === a) { if (g.s === 0) w++; else if (g.s === 1) l++; else t++; }
        }
        return {w, l, t};
      };
      const rating = Object.fromEntries(lb.rows.map(r => [r.key, r.rating]));
      return {
        models: lb.rows.map(r => ({key: r.key, name: r.name, provider: r.provider, effort: r.effort, split: r.split})),
        cells: keys.map(a => keys.map(b => (a === b ? null : {expected: expected(rating[a], rating[b]), ...cell(a, b)}))),
      };
    });
  }

  pokemon({model} = {}) {
    return this.memo(`mons:${model || ''}`, () => {
      const filter = model ? `and s.model_id = ?` : '';
      const args = model ? [model] : [];
      const teams = this.db.get(`select count(*) n from seats s join matches m on m.id = s.match_id and m.rated = 1 where s.provider != 'arena' ${filter}`, ...args).n;
      const mons = this.db.all(`
        select t.species, count(*) teams,
          sum((select count(*) from games g where g.match_id = t.match_id)) games_available,
          sum((select count(*) from brings b where b.match_id = t.match_id and b.side = t.side and b.species = t.species)) brought,
          sum((select count(*) from brings b where b.match_id = t.match_id and b.side = t.side and b.species = t.species and b.lead = 1)) leads,
          sum((select coalesce(sum(b.won),0) from brings b where b.match_id = t.match_id and b.side = t.side and b.species = t.species)) wins
        from team_mons t join seats s on s.match_id = t.match_id and s.side = t.side join matches m on m.id = t.match_id and m.rated = 1
        where s.provider != 'arena' ${filter}
        group by t.species order by teams desc, t.species`, ...args);
      const detail = this.db.all(`select t.species, t.item, t.ability, t.moves from team_mons t join seats s on s.match_id = t.match_id and s.side = t.side
        join matches m on m.id = t.match_id and m.rated = 1 where s.provider != 'arena' ${filter}`, ...args);
      const top = (sp, field) => {
        const counts = new Map();
        for (const d of detail.filter(x => x.species === sp)) {
          const vals = field === 'moves' ? JSON.parse(d.moves) : [d[field]];
          for (const v of vals) if (v) counts.set(v, (counts.get(v) || 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, field === 'moves' ? 6 : 3).map(([name, n]) => ({name, n}));
      };
      return {
        teams,
        rows: mons.map(m => ({
          species: m.species, teams: m.teams, usage: teams ? m.teams / teams : 0,
          bringRate: m.games_available ? m.brought / m.games_available : 0, leadRate: m.brought ? m.leads / m.brought : 0,
          brought: m.brought, winRateWhenBrought: m.brought ? m.wins / m.brought : null,
          items: top(m.species, 'item'), abilities: top(m.species, 'ability'), moves: top(m.species, 'moves'),
        })),
      };
    });
  }

  matches({model, limit = 100} = {}) {
    const filter = model ? `where m.id in (select match_id from seats where model_id = ?)` : '';
    const rows = this.db.all(`select m.*, a.model_id a_model, a.effort a_effort, a.owner a_owner, b.model_id b_model, b.effort b_effort, b.owner b_owner,
      (select coalesce(sum(turns),0) from games g where g.match_id = m.id) turns
      from matches m left join seats a on a.match_id = m.id and a.side = 'p1' left join seats b on b.match_id = m.id and b.side = 'p2'
      ${filter} order by m.finished_at desc limit ?`, ...(model ? [model, limit] : [limit]));
    return rows.map(r => ({
      id: r.id, room: r.room, label: r.label, finishedAt: r.finished_at, winner: r.winner, score: {p1: r.score_p1, p2: r.score_p2}, turns: r.turns, endReason: r.end_reason,
      p1: {model: r.a_model, name: modelInfo(r.a_model)?.name || r.a_model, effort: r.a_effort, owner: r.a_owner},
      p2: {model: r.b_model, name: modelInfo(r.b_model)?.name || r.b_model, effort: r.b_effort, owner: r.b_owner},
    }));
  }

  model(id) {
    const lb = this.leaderboard({includeUnlisted: true});
    const row = lb.rows.find(r => r.key === id) || null;
    const h2h = this.db.all(`select o.model_id opp, sum(case when g.winner = s.side then 1 else 0 end) w, sum(case when g.winner != s.side and g.winner in ('p1','p2') then 1 else 0 end) l
      from seats s join seats o on o.match_id = s.match_id and o.side != s.side join games g on g.match_id = s.match_id join matches m on m.id = s.match_id and m.rated = 1
      where s.model_id = ? group by o.model_id order by (w + l) desc`, id);
    const identities = this.db.all(`select harness, client_name, detected_harness, flags, count(*) n from seats where model_id = ? group by harness, client_name, detected_harness, flags`, id);
    return {id, name: modelInfo(id)?.name || id, provider: modelInfo(id)?.provider || 'unknown', row, opponents: h2h, pokemon: this.pokemon({model: id}).rows.slice(0, 15), recent: this.matches({model: id, limit: 20}), identities};
  }
}
