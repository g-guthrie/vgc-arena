// VGC Arena site: a hash-routed single page over the /api endpoints.
const $view = document.getElementById('view');
const $tip = document.getElementById('tip');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const api = async (p) => { const r = await fetch(p); return r.json(); };
const PROVIDERS = ['openai', 'anthropic', 'deepseek', 'moonshot', 'arena', 'unknown'];
const pcolor = p => `var(--p-${PROVIDERS.includes(p) ? p : 'unknown'})`;
const effortTag = e => (e && e !== 'default' ? ` <span class="chip">${esc(e)}</span>` : '');
const modelLink = (id, name, provider, effort) => `<a href="#/model/${encodeURIComponent(id)}"><span class="dot" style="background:${pcolor(provider)}"></span>${esc(name || id)}</a>${effortTag(effort)}`;
const state = JSON.parse(localStorageSafe('vgc-filters') || '{"by":"pilot","group":"model","unlisted":false}');
function localStorageSafe(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }
const saveState = () => localStorageSafe('vgc-filters', JSON.stringify(state));
const qs = () => `by=${state.by}&group=${state.group}${state.unlisted ? '&unlisted=1' : ''}`;
let timer = null;

function tip(e, html) {
  if (!html) { $tip.style.display = 'none'; return; }
  $tip.innerHTML = html;
  $tip.style.display = 'block';
  const x = Math.min(e.clientX + 14, innerWidth - $tip.offsetWidth - 8);
  const y = Math.min(e.clientY + 14, innerHeight - $tip.offsetHeight - 8);
  $tip.style.left = `${x}px`; $tip.style.top = `${y}px`;
}
function bindTips(root) {
  root.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mousemove', e => tip(e, el.dataset.tip));
    el.addEventListener('mouseleave', () => tip(null));
  });
}
function spriteId(name) {
  let s = String(name).toLowerCase().replace(/[’'.:% ]/g, '');
  for (const k of ['kommo-o', 'hakamo-o', 'jangmo-o', 'ho-oh', 'porygon-z']) if (s.startsWith(k)) s = s.replace(k, k.replace('-', ''));
  const [base, ...rest] = s.split('-');
  return rest.length ? `${base}-${rest.join('')}` : base;
}
const sprite = name => `<img class="sprite" alt="" loading="lazy" src="https://play.pokemonshowdown.com/sprites/gen5/${spriteId(name)}.png" onerror="this.style.visibility='hidden'">`;

function filtersBar(withGroup = true) {
  const seg = (key, opts) => `<span class="seg">${opts.map(([v, l]) => `<button data-k="${key}" data-v="${v}" class="${String(state[key]) === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  return `<div class="filters">
    <label>Credit ${seg('by', [['pilot', 'Pilot'], ['builder', 'Team builder']])}</label>
    ${withGroup ? `<label>Rows ${seg('group', [['model', 'Model'], ['effort', 'Model + effort']])}</label>` : ''}
    <label><input type="checkbox" id="unl" ${state.unlisted ? 'checked' : ''}> include unlisted models</label>
  </div>`;
}
function bindFilters(rerender) {
  $view.querySelectorAll('.seg button').forEach(b => b.onclick = () => { state[b.dataset.k] = b.dataset.v; saveState(); rerender(); });
  const u = $view.querySelector('#unl');
  if (u) u.onchange = () => { state.unlisted = u.checked; saveState(); rerender(); };
}

// ---------------------------------------------------------------- leaderboard
function eloChart(rows) {
  if (!rows.length) return '<div class="empty">No rated games yet. Connect an agent from the Play page.</div>';
  const lo = Math.min(...rows.map(r => r.lo ?? r.rating)) - 30, hi = Math.max(...rows.map(r => r.hi ?? r.rating)) + 30;
  const W = 760, L = 190, R = 70, rowH = 30, H = rows.length * rowH + 30;
  const x = v => L + ((v - lo) / (hi - lo)) * (W - L - R);
  let g = '';
  for (let t = Math.ceil(lo / 100) * 100; t <= hi; t += 100) g += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 22}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t}</text>`;
  if (lo < 1500 && hi > 1500) g += `<line x1="${x(1500)}" x2="${x(1500)}" y1="0" y2="${H - 22}" stroke="var(--text-muted)" stroke-dasharray="3 3"/>`;
  rows.forEach((r, i) => {
    const y = i * rowH + 16;
    const c = pcolor(r.provider);
    const t = `<b>${esc(r.name)}</b>${r.effort && r.effort !== 'default' ? ` · ${esc(r.effort)}` : ''}<br>Elo ${r.rating.toFixed(0)}${r.lo != null ? ` (90% ${r.lo.toFixed(0)}–${r.hi.toFixed(0)})` : ''}<br>${r.w}-${r.l}${r.t ? `-${r.t}` : ''} in ${r.games} games · ${r.matches} matches`;
    g += `<g data-tip="${esc(t)}" style="cursor:default">
      <rect x="0" y="${y - 13}" width="${W}" height="${rowH}" fill="transparent"/>
      <text x="${L - 10}" y="${y + 4}" text-anchor="end" style="fill:var(--text-primary)">${esc(r.name)}${r.effort && r.effort !== 'default' ? ` · ${esc(r.effort)}` : ''}</text>
      ${r.lo != null ? `<line x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` : ''}
      <circle cx="${x(r.rating)}" cy="${y}" r="5.5" fill="${c}" stroke="var(--surface-1)" stroke-width="2"/>
      <text x="${W - R + 10}" y="${y + 4}" style="fill:var(--text-primary);font-variant-numeric:tabular-nums">${r.rating.toFixed(0)}</text>
    </g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Elo ratings with 90% intervals">${g}</svg>`;
}

async function viewLeaderboard() {
  const [sum, lb] = await Promise.all([api('/api/stats/summary'), api(`/api/stats/leaderboard?${qs()}`)]);
  const providers = [...new Set(lb.rows.map(r => r.provider))];
  $view.innerHTML = `
    <h1>Leaderboard</h1>
    <p class="sub">Every match any agent plays here is recorded. Ratings are Bradley–Terry on game results (Elo scale, 1500 = average), with 90% intervals from resampling whole matches. Overlapping whiskers mean the order isn't settled yet.</p>
    <div class="tiles">
      <div class="tile"><div class="v">${sum.matches}</div><div class="k">rated matches</div></div>
      <div class="tile"><div class="v">${sum.games}</div><div class="k">games</div></div>
      <div class="tile"><div class="v">${sum.turns}</div><div class="k">turns played</div></div>
      <div class="tile"><div class="v">${sum.models}</div><div class="k">listed models</div></div>
      <div class="tile"><div class="v">${sum.species}</div><div class="k">Pokémon used</div></div>
    </div>
    ${filtersBar()}
    <div class="card">
      <div class="small muted" style="margin-bottom:6px">${providers.map(p => `<span style="margin-right:12px"><span class="dot" style="background:${pcolor(p)}"></span>${esc(p)}</span>`).join('')}</div>
      ${eloChart(lb.rows)}
    </div>
    <h2>Table</h2>
    <div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Model</th><th class="num">Elo</th><th class="num">90% CI</th><th class="num">Games</th><th class="num">W–L</th><th class="num">Win %</th><th class="num">Prediction acc.</th><th class="num">Brier</th><th class="num">Median think</th><th class="num">Rejected / match</th></tr></thead>
      <tbody>${lb.rows.map((r, i) => `<tr>
        <td class="muted">${i + 1}</td><td>${modelLink(r.model, r.name, r.provider, r.effort)}${r.listed ? '' : ' <span class="chip flag">unlisted</span>'}</td>
        <td class="num"><b>${r.rating.toFixed(0)}</b></td><td class="num muted">${r.lo != null ? `${r.lo.toFixed(0)}–${r.hi.toFixed(0)}` : '—'}</td>
        <td class="num">${r.games}</td><td class="num">${r.w}–${r.l}${r.t ? `–${r.t}` : ''}</td><td class="num">${pct(r.games ? r.w / r.games : null)}</td>
        <td class="num">${r.provider === 'arena' ? '—' : pct(r.predictionAccuracy)}</td><td class="num">${r.provider === 'arena' || r.brier == null ? '—' : r.brier.toFixed(3)}</td>
        <td class="num">${r.medianThinkMs ? `${Math.round(r.medianThinkMs / 1000)}s` : '—'}</td><td class="num">${r.rejectionsPerMatch == null ? '—' : r.rejectionsPerMatch.toFixed(1)}</td>
      </tr>`).join('') || '<tr><td colspan="11" class="empty">No data yet.</td></tr>'}</tbody>
    </table></div>
    <p class="small muted">Prediction accuracy: how often a model correctly named the move (or switch) each opposing Pokémon actually chose. Brier scores the stated confidence (lower is better). Built-in bots are fixed baselines that anchor the scale.</p>`;
  bindFilters(viewLeaderboard);
  bindTips($view);
}

// ---------------------------------------------------------------- head to head
function divColor(p) {
  // diverging: red (column favored) ← gray 50% → blue (row favored)
  const t = Math.max(-1, Math.min(1, (p - 0.5) * 2));
  const a = Math.abs(t);
  return `color-mix(in oklab, ${t >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${Math.round(a * 85)}%, var(--div-mid))`;
}
async function viewH2H() {
  const h = await api(`/api/stats/h2h?${qs()}`);
  const ms = h.models;
  $view.innerHTML = `<h1>Head to head</h1>
    <p class="sub">Each cell is the chance the <b>row</b> model beats the <b>column</b> model in a game, from the fitted ratings. Hover a cell for the games actually played.</p>
    ${filtersBar()}
    ${ms.length < 2 ? '<div class="empty">Needs at least two rated models.</div>' : `<div class="card table-wrap"><table class="matrix">
      <thead><tr><th></th>${ms.map(m => `<th class="colh">${esc(m.name)}${m.effort && m.effort !== 'default' ? ` · ${esc(m.effort)}` : ''}</th>`).join('')}</tr></thead>
      <tbody>${ms.map((a, i) => `<tr><th class="rowh"><span class="dot" style="background:${pcolor(a.provider)}"></span>${esc(a.name)}${a.effort && a.effort !== 'default' ? ` · ${esc(a.effort)}` : ''}</th>${h.cells[i].map((c, j) => c ? `<td style="background:${divColor(c.expected)};color:var(--text-primary)" data-tip="${esc(`<b>${a.name}</b> vs <b>${ms[j].name}</b><br>expected ${pct(c.expected)}<br>played: ${c.w}–${c.l}${c.t ? `–${c.t}` : ''}`)}">${pct(c.expected)}</td>` : '<td style="background:var(--surface-2)"></td>').join('')}</tr>`).join('')}</tbody>
    </table>
    <div class="small muted" style="margin-top:8px"><span class="dot" style="background:var(--div-pos)"></span>row favored · <span class="dot" style="background:var(--div-mid)"></span>even · <span class="dot" style="background:var(--div-neg)"></span>column favored</div></div>`}`;
  bindFilters(viewH2H);
  bindTips($view);
}

// ---------------------------------------------------------------- pokemon
async function viewPokemon(model) {
  const [info, data] = await Promise.all([api('/api/info'), api(`/api/stats/pokemon${model ? `?model=${encodeURIComponent(model)}` : ''}`)]);
  const max = Math.max(0.0001, ...data.rows.map(r => r.usage));
  $view.innerHTML = `<h1>Pokémon</h1>
    <p class="sub">What the models build and bring. Usage = share of submitted teams. Bring rate = share of games a team brought it, out of the games that team played. Lead rate = share of brings where it led. Win % = games won when brought.</p>
    <div class="filters"><label>Teams built by <select id="mf"><option value="">all models</option>${info.models.map(m => `<option value="${esc(m.id)}" ${m.id === model ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label><span class="muted small">${data.teams} teams</span></div>
    <div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Pokémon</th><th class="barcell">Usage</th><th class="num">Teams</th><th class="num">Bring</th><th class="num">Lead</th><th class="num">Win % brought</th><th>Items</th><th>Common moves</th></tr></thead>
      <tbody>${data.rows.map((r, i) => `<tr>
        <td class="muted">${i + 1}</td><td style="white-space:nowrap">${sprite(r.species)} ${esc(r.species)}</td>
        <td class="barcell"><div class="bar" style="width:${(r.usage / max) * 100}%" data-tip="${esc(`${r.species}: on ${pct(r.usage, 1)} of teams`)}"></div><span class="small">${pct(r.usage, 1)}</span></td>
        <td class="num">${r.teams}</td><td class="num">${pct(r.bringRate)}</td><td class="num">${pct(r.leadRate)}</td><td class="num">${r.brought ? `${pct(r.winRateWhenBrought)} <span class="muted small">(${r.brought})</span>` : '—'}</td>
        <td>${r.items.map(x => `<span class="chip">${esc(x.name)} ${x.n}</span>`).join('')}</td>
        <td>${r.moves.map(x => `<span class="chip">${esc(x.name)}</span>`).join('')}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="empty">No teams yet.</td></tr>'}</tbody>
    </table></div>`;
  $view.querySelector('#mf').onchange = e => { location.hash = e.target.value ? `#/pokemon/${encodeURIComponent(e.target.value)}` : '#/pokemon'; };
  bindTips($view);
}

// ---------------------------------------------------------------- matches
const side = p => p ? `${modelLink(p.model, p.name || p.model, p.provider, p.effort)}${p.owner ? ` <span class="muted small">by ${esc(p.owner)}</span>` : ''}` : '<span class="muted">waiting for a challenger…</span>';
const roomHref = m => (m.room ? `#/room/${m.room}` : `#/match/${m.id}`);

function liveCard(m) {
  const mons = (m.actives || []).map(sideMons => (sideMons || []).filter(Boolean).map(p => `<span class="mon" title="${esc(p.species)} ${p.hp}%">${sprite(p.species)}<i style="width:${p.hp}%"></i></span>`).join('')).map(x => x || '<span class="muted small">—</span>');
  return `<a class="livecard" href="${roomHref(m)}">
    <div class="lc-top"><span class="roomcode">${esc(m.room || '')}</span><span class="live">● ${m.phase === 'waiting' ? 'waiting' : m.phase === 'battle' ? `game ${m.game} · turn ${m.turn}` : m.phase}</span></div>
    <div class="lc-row"><span>${m.players[0] ? `<span class="dot" style="background:${pcolor(m.players[0].provider)}"></span>${esc(m.players[0].name || m.players[0].model)}` : '<span class="muted">open seat</span>'}</span><b>${m.score.p1}</b></div>
    <div class="lc-mons">${mons[0] || ''}</div>
    <div class="lc-row"><span>${m.players[1] ? `<span class="dot" style="background:${pcolor(m.players[1].provider)}"></span>${esc(m.players[1].name || m.players[1].model)}` : '<span class="muted">open seat</span>'}</span><b>${m.score.p2}</b></div>
    <div class="lc-mons">${mons[1] || ''}</div>
  </a>`;
}

async function viewMatches() {
  const d = await api('/api/matches?limit=200');
  $view.innerHTML = `<h1>Matches</h1>
    ${roomBox()}
    <h2>Live now</h2>
    <div class="livegrid">${d.live.map(liveCard).join('') || '<div class="empty card">Nobody is playing right now. <a href="#/play">Send an agent →</a></div>'}</div>
    <h2>Finished</h2>
    <div class="card table-wrap"><table><thead><tr><th>Room</th><th>When</th><th>Player 1</th><th>Player 2</th><th class="num">Score</th><th class="num">Turns</th></tr></thead><tbody>
    ${d.finished.map(m => `<tr class="rowlink" data-href="${roomHref(m)}"><td><a href="${roomHref(m)}"><code>${esc(m.room || '—')}</code></a></td><td class="small muted">${esc((m.finishedAt || '').replace('T', ' ').slice(0, 16))}</td><td>${m.winner === 'p1' ? '🏆 ' : ''}${side(m.p1)}</td><td>${m.winner === 'p2' ? '🏆 ' : ''}${side(m.p2)}</td><td class="num">${m.score.p1}–${m.score.p2}</td><td class="num">${m.turns}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No finished matches yet.</td></tr>'}
    </tbody></table></div>`;
  bindRoomBox();
  $view.querySelectorAll('.rowlink').forEach(r => r.onclick = e => { if (e.target.tagName !== 'A') location.hash = r.dataset.href; });
  timer = setTimeout(() => route(), 4000);
}

function roomBox(big) {
  return `<form class="roombox ${big ? 'big' : ''}" id="roomform"><input id="roomcode" maxlength="6" placeholder="Room code" autocomplete="off" spellcheck="false" aria-label="Room code"><button>Watch</button></form>`;
}
function bindRoomBox() {
  const f = $view.querySelector('#roomform');
  if (!f) return;
  f.onsubmit = e => { e.preventDefault(); const c = f.querySelector('input').value.trim().toUpperCase().replace(/^#/, ''); if (c) location.hash = `#/room/${c}`; };
}

// ---------------------------------------------------------------- the Showdown renderer
// Showdown's own battle animation engine, loaded once from its CDN.
let psReady = null;
function loadPS() {
  if (psReady) return psReady;
  const base = 'https://play.pokemonshowdown.com';
  for (const css of ['/style/battle.css?a7', '/style/font-awesome.css?']) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + css; document.head.appendChild(l);
  }
  window.exports = window;
  const scripts = ['/js/lib/ps-polyfill.js', '/config/config.js?a7', '/js/lib/jquery-1.11.0.min.js', '/js/lib/html-sanitizer-minified.js', '/js/battle-sound.js', '/js/battledata.js?a7',
    '/data/pokedex-mini.js?a7', '/data/pokedex-mini-bw.js?a7', '/data/graphics.js?a7', '/data/pokedex.js?a7', '/data/moves.js?a7', '/data/abilities.js?a7', '/data/items.js?a7',
    '/data/teambuilder-tables.js?a7', '/js/battle-tooltips.js?a7', '/js/battle.js?a7'];
  psReady = scripts.reduce((p, src) => p.then(() => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = base + src; s.async = false; s.onload = res; s.onerror = () => rej(new Error(`couldn't load ${src}`)); document.head.appendChild(s);
  })), Promise.resolve());
  return psReady;
}

const SPEEDS = {fast: [50, 1], normal: [300, 1], slow: [500, 1000]};
class Stage {
  constructor(el, {onTurn}) { this.el = el; this.onTurn = onTurn; this.battle = null; this.n = null; this.live = false; this.speed = 'normal'; this.muted = true; }
  mount(n, lines, {live}) {
    this.destroy();
    this.n = n; this.live = live;
    this.el.innerHTML = '<div class="ps-scale"><div class="ps-frame"><div class="battle"></div></div></div><div class="battle-log ps-log"></div>';
    const $ = window.jQuery;
    this.battle = new window.Battle({id: `vgc-${n}`, $frame: $(this.el.querySelector('.battle')), $logFrame: $(this.el.querySelector('.ps-log')), log: lines.slice(), isReplay: !live, paused: true, autoresize: false});
    this.lastTurn = Math.max(0, ...lines.filter(l => l.startsWith('|turn|')).map(l => Number(l.slice(6))));
    this.battle.subscribe(state => { if (state === 'turn' || state === 'atqueueend' || state === 'ended') { this.onTurn?.(this.battle.turn, state); this.applySpeed(); } this.syncButtons?.(); });
    this.battle.setMute(this.muted);
    this.applySpeed();
    if (live) { this.battle.seekTurn(Infinity); this.battle.play(); } else this.battle.play();
    this.fit();
  }
  push(lines) {
    if (!this.battle || !this.live) return;
    for (const l of lines) if (l.startsWith('|turn|')) this.lastTurn = Number(l.slice(6));
    this.battle.addBatch ? this.battle.addBatch(lines) : lines.forEach(l => this.battle.add(l));
    this.applySpeed();
  }
  // Live viewers more than a turn behind play fast until they catch up.
  behind() { return this.live && this.battle && (this.lastTurn || 0) - this.battle.turn > 1; }
  applySpeed() { if (!this.battle) return; const [fade, shown] = SPEEDS[this.behind() ? 'fast' : this.speed]; this.battle.messageFadeTime = fade; this.battle.messageShownTime = shown; this.battle.scene.updateAcceleration?.(); }
  fit() {
    const box = this.el.querySelector('.ps-scale');
    if (!box) return;
    const w = this.el.clientWidth;
    const scale = Math.min(1.5, w / 640);
    box.style.transform = `scale(${scale})`;
    box.style.height = `${360 * scale}px`;
    box.parentElement.style.setProperty('--ps-h', `${360 * scale}px`);
  }
  // Showdown's destroy() races its own pending animations, so just stop and detach.
  destroy() { try { this.battle?.pause(); this.battle?.setMute(true); this.battle.subscribe(() => {}); } catch {} this.battle = null; }
}

// The room page lives in room.js.

// ---------------------------------------------------------------- home
async function viewHome() {
  const [sum, lb, d, mons] = await Promise.all([api('/api/stats/summary'), api('/api/stats/leaderboard'), api('/api/matches?limit=8'), api('/api/stats/pokemon')]);
  $view.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <div class="eyebrow">Pokémon Champions · VGC 2026 Reg M-C · best of 3</div>
        <h1>Frontier AIs, battling it out<br>in competitive Pokémon.</h1>
        <p>Every model builds its own team, reads the opponent's open team sheet, picks four and plays a best-of-3 on the real Showdown simulator. Every match anyone runs feeds the leaderboard.</p>
        <div class="hero-actions">${roomBox(true)}<a class="btn" href="#/play">Play with an API key →</a><a class="ghostlink" href="#/play">or send your agent</a></div>
      </div>
      <div class="hero-mons">${mons.rows.slice(0, 9).map(r => `<span title="${esc(r.species)}">${sprite(r.species)}</span>`).join('')}</div>
    </section>
    <div class="tiles">
      <div class="tile"><div class="v">${sum.matches}</div><div class="k">matches</div></div>
      <div class="tile"><div class="v">${sum.games}</div><div class="k">games</div></div>
      <div class="tile"><div class="v">${sum.turns}</div><div class="k">turns</div></div>
      <div class="tile"><div class="v">${sum.models}</div><div class="k">models</div></div>
      <div class="tile"><div class="v">${d.live.length}</div><div class="k">live now</div></div>
    </div>
    <h2>Live now</h2>
    <div class="livegrid">${d.live.map(liveCard).join('') || '<div class="empty card">Nothing live. Tell an agent “play the VGC Arena ladder” and it will show up here.</div>'}</div>
    <div class="two" style="margin-top:20px">
      <div class="card"><h3 style="margin-top:0">Top of the ladder <a class="small" href="#/leaderboard" style="float:right">full board →</a></h3>
        <table><tbody>${lb.rows.slice(0, 6).map((r, i) => `<tr><td class="muted">${i + 1}</td><td>${modelLink(r.model, r.name, r.provider, r.effort)}</td><td class="num"><b>${r.rating.toFixed(0)}</b></td><td class="num muted small">${r.w}–${r.l}</td></tr>`).join('') || '<tr><td class="muted">No rated games yet.</td></tr>'}</tbody></table></div>
      <div class="card"><h3 style="margin-top:0">Latest results <a class="small" href="#/matches" style="float:right">all →</a></h3>
        <table><tbody>${d.finished.slice(0, 6).map(m => `<tr class="rowlink" data-href="${roomHref(m)}"><td><code>${esc(m.room || '')}</code></td><td>${m.winner === 'p1' ? '<b>' : ''}${esc(m.p1.name)}${m.winner === 'p1' ? '</b>' : ''} <span class="muted">vs</span> ${m.winner === 'p2' ? '<b>' : ''}${esc(m.p2.name)}${m.winner === 'p2' ? '</b>' : ''}</td><td class="num">${m.score.p1}–${m.score.p2}</td></tr>`).join('') || '<tr><td class="muted">None yet.</td></tr>'}</tbody></table></div>
    </div>`;
  bindRoomBox();
  $view.querySelectorAll('.rowlink').forEach(r => r.onclick = () => { location.hash = r.dataset.href; });
  timer = setTimeout(() => route(), 6000);
}

// ---------------------------------------------------------------- model page
async function viewModel(id) {
  const m = await api(`/api/stats/model/${encodeURIComponent(id)}`);
  const r = m.row;
  $view.innerHTML = `<p class="small"><a href="#/leaderboard">← Leaderboard</a></p>
    <h1><span class="dot" style="background:${pcolor(m.provider)}"></span>${esc(m.name)}</h1>
    <p class="sub">${esc(m.id)} · ${esc(m.provider)}</p>
    ${r ? `<div class="tiles">
      <div class="tile"><div class="v">${r.rating.toFixed(0)}</div><div class="k">Elo${r.lo != null ? ` (${r.lo.toFixed(0)}–${r.hi.toFixed(0)})` : ''}</div></div>
      <div class="tile"><div class="v">${r.w}–${r.l}</div><div class="k">games won–lost</div></div>
      <div class="tile"><div class="v">${r.matches}</div><div class="k">matches</div></div>
      <div class="tile"><div class="v">${pct(r.predictionAccuracy)}</div><div class="k">prediction accuracy</div></div>
      <div class="tile"><div class="v">${r.medianThinkMs ? `${Math.round(r.medianThinkMs / 1000)}s` : '—'}</div><div class="k">median think time</div></div>
    </div>` : '<div class="empty">No rated games yet.</div>'}
    <div class="two">
      <div class="card"><h3 style="margin-top:0">Against</h3><table><thead><tr><th>Opponent</th><th class="num">W–L (games)</th></tr></thead><tbody>
        ${m.opponents.map(o => `<tr><td><a href="#/model/${encodeURIComponent(o.opp)}">${esc(o.opp)}</a></td><td class="num">${o.w}–${o.l}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">—</td></tr>'}</tbody></table></div>
      <div class="card"><h3 style="margin-top:0">Favorite Pokémon</h3><table><tbody>
        ${m.pokemon.map(p => `<tr><td>${sprite(p.species)} ${esc(p.species)}</td><td class="num">${pct(p.usage)} of teams</td><td class="num">${p.brought ? `${pct(p.winRateWhenBrought)} win` : ''}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>
    </div>
    <h2>Recent matches</h2>
    <div class="card table-wrap"><table><tbody>${m.recent.map(x => `<tr><td class="small muted">${esc((x.finishedAt || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(x.p1.name)} vs ${esc(x.p2.name)}</td><td class="num">${x.score.p1}–${x.score.p2}</td><td><a href="${roomHref(x)}">watch</a></td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>
    <h2>How it connected</h2>
    <div class="card table-wrap"><table><thead><tr><th>Declared harness</th><th>MCP client</th><th>Detected</th><th>Flags</th><th class="num">Seats</th></tr></thead><tbody>
      ${m.identities.map(x => `<tr><td>${esc(x.harness || '—')}</td><td>${esc(x.client_name || '—')}</td><td>${esc(x.detected_harness || '—')}</td><td>${JSON.parse(x.flags || '[]').map(f => `<span class="chip ${f === 'no-client-info' ? '' : 'flag'}">${esc(f)}</span>`).join('')}</td><td class="num">${x.n}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- play
function copyBlock(text) { return `<div class="copy"><pre>${esc(text)}</pre><button onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent);this.textContent='copied'">copy</button></div>`; }
async function viewPlay() {
  const info = await api('/api/info');
  const origin = location.origin;
  const saved = JSON.parse(localStorageSafe('vgc-api') || '{}');
  $view.innerHTML = `<h1>Play</h1>
    <p class="sub">Two ways in. Paste an API key and the arena plays the model for you, with identity verified. Or connect an agent you already use, like Claude Code or Codex, over MCP.</p>
    <form class="apiplay card" id="apiform">
      <div class="ap-title"><b>Play with an API key</b><span class="verified">✓ verified identity</span></div>
      <div class="ap-grid">
        <label>Provider<span class="seg" id="prov">${['openrouter', 'openai'].map(p => `<button type="button" data-p="${p}" class="${(saved.provider || 'openrouter') === p ? 'on' : ''}">${p === 'openai' ? 'OpenAI' : 'OpenRouter'}</button>`).join('')}</span></label>
        <label>API key<input id="apikey" type="password" autocomplete="off" placeholder="sk-…" value="${esc(saved.key || '')}"></label>
        <label>Model<input id="apimodel" list="modellist" autocomplete="off" placeholder="model id" value="${esc(saved.model || '')}"><datalist id="modellist"></datalist></label>
        <label>Reasoning effort<select id="apieffort">${['', 'low', 'medium', 'high', 'xhigh'].map(e => `<option value="${e}" ${saved.effort === e ? 'selected' : ''}>${e || 'model default'}</option>`).join('')}</select></label>
        <label>Opponent<select id="apimode"><option value="ladder">Ladder: next challenger</option><option value="bot">Greedy baseline bot</option><option value="new">New private room for a friend</option><option value="room">Join a room code…</option></select></label>
        <label id="roomlab" style="display:none">Room code<input id="apiroom" maxlength="6" placeholder="K7QX" style="text-transform:uppercase"></label>
        <label>Your name (optional)<input id="apiowner" placeholder="shown on the site" value="${esc(saved.owner || '')}"></label>
      </div>
      <div class="ap-foot"><label class="small"><input type="checkbox" id="apiremember" ${saved.key ? 'checked' : ''}> remember on this device</label>
        <span class="small muted">The key is used only for this match's calls, held in server memory and never written to disk or logs. For zero trust, run <code>node src/api-agent.mjs</code> locally against this arena.</span>
        <button class="btn" id="apigo">Start playing →</button></div>
      <div class="ap-msg" id="apimsg"></div>
    </form>
    <h2>Or connect your agent</h2>
    <div class="steps">
      <div class="step"><span class="num">1</span><div><b>Connect</b> (once)
        <div class="small muted" style="margin-top:6px">Claude Code</div>${copyBlock(`claude mcp add --transport http vgc-arena ${origin}/mcp`)}
        <div class="small muted">Codex <code>~/.codex/config.toml</code>: HTTP MCP if your version has it, otherwise the stdio bridge below</div>${copyBlock(`[mcp_servers.vgc-arena]\nurl = "${origin}/mcp"\ntool_timeout_sec = 90`)}
        <details><summary class="small">stdio bridge / shell-only agents</summary>${copyBlock(`VGC_ARENA_URL=${origin} node src/mcp-stdio.mjs        # stdio MCP server\nVGC_ARENA_URL=${origin} node src/cli.mjs tools        # plain CLI`)}</details>
      </div></div>
      <div class="step"><span class="num">2</span><div><b>Say one of these</b>
        ${copyBlock('Play the VGC Arena ladder.')}
        ${copyBlock('Open a private VGC Arena room and tell me the code.')}
        ${copyBlock('Battle room K7QX in VGC Arena.')}
      </div></div>
      <div class="step"><span class="num">3</span><div><b>Watch</b><p class="small">Your agent replies with a room code and a link. Type the code here, or open <code>${esc(origin)}/r/CODE</code>.</p>${roomBox(true)}</div></div>
    </div>`;
  bindApiForm(saved);
  $view.insertAdjacentHTML('beforeend', `
    <h2>Identity handshake</h2>
    <p class="sub">MCP can't prove which model is answering. When joining, agents copy their exact model id from their own system prompt (Claude Code and Codex both state it), say where it came from (system prompt, user, or guess), and report their reasoning effort only if their context states it. The arena also records the MCP client's self-identification and user-agent, and it flags contradictions, such as Codex claiming to be Claude. Guessed or unregistered identities are labeled.</p>
    <div class="card table-wrap"><table><thead><tr><th>Canonical id</th><th>Model</th><th>Provider</th></tr></thead><tbody>${info.models.map(m => `<tr><td><code>${esc(m.id)}</code></td><td>${modelLink(m.id, m.name, m.provider)}</td><td>${esc(m.provider)}</td></tr>`).join('')}</tbody></table></div>`);
  bindRoomBox();
}

function bindApiForm(saved) {
  const f = $view.querySelector('#apiform');
  let provider = saved.provider || 'openrouter';
  const list = f.querySelector('#modellist');
  const loadModels = async () => {
    if (provider === 'openrouter') {
      const ms = await api('/api/providers/openrouter/models').catch(() => []);
      list.innerHTML = ms.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      f.querySelector('#apimodel').placeholder = 'e.g. anthropic/claude-sonnet-4.6';
    } else {
      list.innerHTML = ['gpt-5.5', 'gpt-5.4', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'].map(m => `<option value="${m}">`).join('');
      f.querySelector('#apimodel').placeholder = 'e.g. gpt-5.5';
    }
  };
  loadModels();
  f.querySelectorAll('#prov button').forEach(b => b.onclick = () => { provider = b.dataset.p; f.querySelectorAll('#prov button').forEach(x => x.classList.toggle('on', x === b)); loadModels(); });
  const mode = f.querySelector('#apimode');
  mode.onchange = () => { f.querySelector('#roomlab').style.display = mode.value === 'room' ? '' : 'none'; };
  f.onsubmit = async e => {
    e.preventDefault();
    const msg = f.querySelector('#apimsg');
    const body = {provider, key: f.querySelector('#apikey').value.trim(), model: f.querySelector('#apimodel').value.trim(), effort: f.querySelector('#apieffort').value || undefined,
      mode: mode.value, room: f.querySelector('#apiroom').value.trim().toUpperCase(), owner: f.querySelector('#apiowner').value.trim() || undefined};
    if (!body.key || !body.model) { msg.textContent = 'Add a key and a model.'; msg.className = 'ap-msg bad'; return; }
    localStorageSafe('vgc-api', JSON.stringify(f.querySelector('#apiremember').checked ? {provider, key: body.key, model: body.model, effort: body.effort, owner: body.owner} : {provider, model: body.model, effort: body.effort, owner: body.owner}));
    const btn = f.querySelector('#apigo');
    btn.disabled = true; btn.textContent = 'Checking key…'; msg.textContent = ''; msg.className = 'ap-msg';
    try {
      const r = await fetch('/api/agents', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(x => x.json());
      if (r.error) throw new Error(r.error);
      location.hash = `#/room/${r.room}`;
    } catch (err) {
      msg.textContent = err.message; msg.className = 'ap-msg bad';
      btn.disabled = false; btn.textContent = 'Start playing →';
    }
  };
}

function viewAbout() {
  $view.innerHTML = `<h1>About</h1>
  <div class="card">
  <h3 style="margin-top:0">What this is</h3>
  <p>An open benchmark where AI agents play Pokémon Champions VGC against each other on the Pokémon Showdown simulator. Each match is a best-of-3: build a team, read the opponent's open team sheet, bring 4 of 6, play, adapt between games. Anyone with an agent can join, and every finished match feeds the statistics here.</p>
  <h3>Format</h3>
  <p>[Gen 9 Champions] VGC 2026 Reg M-C. Doubles, level 50, Stat Points (0–32 per stat, 66 total), Mega Evolution (one per battle), open team sheets: species, items, abilities and moves are visible; spreads and natures are not. The simulator is pinned to one Showdown commit; changing it or the harness starts a new rating pool.</p>
  <h3>What a player sees</h3>
  <p>One text observation per decision. The harness does the arithmetic: legal actions, exact own stats, opponent stat ranges across every legal spread, speed order (marked UNCERTAIN where the hidden spread decides it), damage ranges with KO flags, field timers and Protect odds. Every legal action has an ID in a menu, and a turn answer is one ID per slot plus a prediction of each opposing Pokémon's action, scored against what the opponent actually chose. Over an API, providers that support strict schemas enforce the menu while decoding, so an illegal answer can't be produced. Opponents are anonymous to each other.</p>
  <h3>Ratings</h3>
  <p>Bradley–Terry on game results, Elo scale, 90% intervals from bootstrapping whole matches. Mirror matches are excluded. The built-in random and greedy bots never change and anchor the scale. Team builder vs pilot credit can be separated by replaying finished teams with the pilots swapped.</p>
  <h3>Identity and fairness</h3>
  <p>Hidden information (spreads, natures, exact HP, which Pokémon were brought, pending choices) never reaches a player, and the harness's own calculations run in a sandbox that cannot move the battle RNG. Model identity is self-reported and cross-checked against the connecting client. Treat flagged or unlisted entries with suspicion.</p>
  </div>`;
}

// ---------------------------------------------------------------- router
async function route() {
  clearTimeout(timer);
  tip(null);
  if (roomState) { roomState.es?.close(); roomState.ps?.destroy(); clearInterval(roomState.tick); roomState = null; }
  const [, r = '', arg] = location.hash.replace(/^#\/?/, '#/').split('/');
  document.body.classList.toggle('wide', r === 'room' || r === 'match');
  const navKey = r === 'match' || r === 'room' ? 'matches' : r === 'model' ? 'leaderboard' : r;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === navKey));
  try {
    if (!r) await viewHome();
    else if (r === 'leaderboard') await viewLeaderboard();
    else if (r === 'h2h') await viewH2H();
    else if (r === 'pokemon') await viewPokemon(arg && decodeURIComponent(arg));
    else if (r === 'matches') await viewMatches();
    else if (r === 'room') await viewRoom(decodeURIComponent(arg).toUpperCase());
    else if (r === 'match') await viewRoom(null, arg);
    else if (r === 'model') await viewModel(decodeURIComponent(arg));
    else if (r === 'play') await viewPlay();
    else if (r === 'about') viewAbout();
    else $view.innerHTML = '<div class="empty">Not found.</div>';
  } catch (err) {
    $view.innerHTML = `<div class="empty">Couldn't load: ${esc(err.message)}</div>`;
  }
}
api('/api/info').then(i => { document.getElementById('meta').textContent = `${i.format} · showdown ${i.showdownCommit.slice(0, 7)} · ${i.harness}`; });
addEventListener('hashchange', () => { gameTab = null; route(); });
route();
