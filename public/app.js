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
const side = p => p ? `${modelLink(p.model, p.name || p.model, p.provider, p.effort)}${p.owner ? ` <span class="muted small">by ${esc(p.owner)}</span>` : ''}` : '<span class="muted">waiting…</span>';
async function viewMatches() {
  const d = await api('/api/matches?limit=200');
  $view.innerHTML = `<h1>Matches</h1>
    <h2>Live <span class="live small">${d.live.length ? '●' : ''}</span></h2>
    <div class="card table-wrap"><table><thead><tr><th>Match</th><th>Player 1</th><th>Player 2</th><th>Status</th></tr></thead><tbody>
    ${d.live.map(m => `<tr><td><a href="#/match/${m.id}">${esc(m.id)}</a></td><td>${side(m.players[0])}</td><td>${side(m.players[1])}</td><td>${esc(m.phase)}${m.game ? ` · game ${m.game}, turn ${m.turn}` : ''} · ${m.score.p1}–${m.score.p2}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody is playing right now.</td></tr>'}
    </tbody></table></div>
    <h2>Finished</h2>
    <div class="card table-wrap"><table><thead><tr><th>When</th><th>Player 1</th><th>Player 2</th><th class="num">Score</th><th class="num">Turns</th><th></th></tr></thead><tbody>
    ${d.finished.map(m => `<tr><td class="small muted">${esc((m.finishedAt || '').replace('T', ' ').slice(0, 16))}</td><td>${m.winner === 'p1' ? '🏆 ' : ''}${side(m.p1)}</td><td>${m.winner === 'p2' ? '🏆 ' : ''}${side(m.p2)}</td><td class="num">${m.score.p1}–${m.score.p2}</td><td class="num">${m.turns}</td><td><a href="#/match/${m.id}">open</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No finished matches yet.</td></tr>'}
    </tbody></table></div>`;
  timer = setTimeout(() => route(), 5000);
}

let gameTab = null;
async function viewMatch(id) {
  const m = await api(`/api/matches/${id}`);
  if (m.error) { $view.innerHTML = `<div class="empty">${esc(m.error)}</div>`; return; }
  const pl = s => m.players.find(p => p && p.side === s);
  const name = s => { const p = pl(s); return p ? `${modelLink(p.model, p.modelName || p.model, p.provider, p.effort)}${p.owner ? ` <span class="muted small">by ${esc(p.owner)}</span>` : ''}${(p.flags || []).filter(f => f !== 'no-client-info').map(f => ` <span class="chip flag" title="identity flag">${esc(f)}</span>`).join('')}` : '<span class="muted">waiting…</span>'; };
  const finished = m.phase === 'finished';
  gameTab = gameTab && gameTab <= m.games.length ? gameTab : m.games.length || null;
  const g = gameTab ? m.games[gameTab - 1] : null;
  let html = `<p class="small"><a href="#/matches">← Matches</a></p>
    <h1>${name('p1')} <span class="muted">vs</span> ${name('p2')}</h1>
    <p class="sub">${esc(m.id)} · ${esc(m.phase)} · best of ${m.bestOf} · <b>${m.score.p1}–${m.score.p2}</b>${finished ? ` · ${m.winner === 'tie' ? 'tie' : `winner: ${m.winner === 'p1' ? 'Player 1' : 'Player 2'}`} (${esc(m.endReason)})` : ''}${finished ? '' : ' · hidden information (spreads, reasoning) is revealed when the match ends'}</p>`;
  if (m.sheets) {
    html += `<div class="two">${['p1', 'p2'].map(s => `<div class="card sheet"><b>${s === 'p1' ? 'Player 1' : 'Player 2'} team</b>${(m.sheets[s] || []).map(p => `<div>${sprite(p.species)} <b>${esc(p.species)}</b> @ ${esc(p.item)} · ${esc(p.ability)}<br><span class="small muted">${p.moves.map(esc).join(' · ')}</span></div>`).join('')}
      ${finished && m.teamPlans?.[s] ? `<p class="small"><span class="muted">Team plan:</span> ${esc(m.teamPlans[s])}</p>` : ''}</div>`).join('')}</div>`;
  } else if (m.players.some(Boolean)) {
    html += `<div class="card">${m.players.filter(Boolean).map(p => `<div>${p.side}: ${p.teamSubmitted ? 'team submitted' : 'building a team…'}</div>`).join('')}</div>`;
  }
  if (m.games.length) {
    html += `<div class="tabs">${m.games.map(x => `<button data-g="${x.n}" class="${x.n === gameTab ? 'on' : ''}">Game ${x.n}${x.winner ? ` · ${x.winner === 'p1' ? 'P1' : x.winner === 'p2' ? 'P2' : 'tie'}` : ''}</button>`).join('')}</div>`;
    html += `<div class="small muted" style="margin-bottom:6px">Turn ${g.turn} · <a href="/replay/${m.id}/${g.n}" target="_blank">animated replay ↗</a></div><pre>${esc(g.log.join('\n'))}</pre>`;
    if (m.decisions) {
      const ds = m.decisions.filter(x => x.game === g.n);
      const prev = (m.previews || []).find(p => p.n === g.n);
      html += `<h2>Reasoning</h2><div class="card">`;
      for (const s of ['p1', 'p2']) if (prev?.[s]) html += `<div class="decision"><b>${s === 'p1' ? 'P1' : 'P2'} team preview</b> → brings ${esc(prev[s].bring.join(', '))}<div><span class="k">threats</span>${esc(prev[s].key_threats)}</div><div><span class="k">plan</span>${esc(prev[s].game_plan)}</div>${prev[s].lessons ? `<div><span class="k">lessons</span>${esc(prev[s].lessons)}</div>` : ''}</div>`;
      for (const x of ds.filter(x => x.kind !== 'preview')) {
        const p = x.payload || {};
        const preds = (p.predictions || []).map((q, i) => { const sc = x.predictionScores?.[i]; return `${esc(q.foe)}: ${esc(q.action)} ${Math.round((q.confidence || 0) * 100)}%${sc && sc.actual ? (sc.correct ? ' ✓' : ` ✗ (${esc(sc.actual)})`) : ''}`; }).join(' · ');
        html += `<div class="decision"><b>${x.side === 'p1' ? 'P1' : 'P2'} · turn ${x.turn}</b> <span class="muted small">${x.kind === 'switch' ? 'replacement' : esc(x.depth)}${x.thinkMs ? ` · ${Math.round(x.thinkMs / 1000)}s` : ''}</span> → ${(p.actions || []).map(a => `<code>${esc(a.switch ? `switch ${a.switch}` : `${a.move}${a.target ? ` → ${a.target}` : ''}${a.mega ? ' (mega)' : ''}`)}</code>`).join(' ')}
          ${['threats', 'win_condition', 'reason', 'risk', 'plan'].filter(k => p[k] && !(k === 'plan' && /^on[ -]?track/i.test(p[k]))).map(k => `<div><span class="k">${k.replace('_', ' ')}</span>${esc(p[k])}</div>`).join('')}
          ${preds ? `<div><span class="k">predicted</span>${preds}</div>` : ''}</div>`;
      }
      html += `</div>`;
    }
  }
  html += `<h2>Events</h2><pre>${esc((m.events || []).map(e => `${e.t.slice(11, 19)} ${e.text}`).join('\n'))}</pre>`;
  $view.innerHTML = html;
  $view.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { gameTab = Number(b.dataset.g); viewMatch(id); });
  if (!finished) timer = setTimeout(() => viewMatch(id), 3000);
}

// ---------------------------------------------------------------- model page
async function viewModel(id) {
  const m = await api(`/api/stats/model/${encodeURIComponent(id)}`);
  const r = m.row;
  $view.innerHTML = `<p class="small"><a href="#/">← Leaderboard</a></p>
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
    <div class="card table-wrap"><table><tbody>${m.recent.map(x => `<tr><td class="small muted">${esc((x.finishedAt || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(x.p1.name)} vs ${esc(x.p2.name)}</td><td class="num">${x.score.p1}–${x.score.p2}</td><td><a href="#/match/${x.id}">open</a></td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>
    <h2>How it connected</h2>
    <div class="card table-wrap"><table><thead><tr><th>Declared harness</th><th>MCP client</th><th>Detected</th><th>Flags</th><th class="num">Seats</th></tr></thead><tbody>
      ${m.identities.map(x => `<tr><td>${esc(x.harness || '—')}</td><td>${esc(x.client_name || '—')}</td><td>${esc(x.detected_harness || '—')}</td><td>${JSON.parse(x.flags || '[]').map(f => `<span class="chip ${f === 'no-client-info' ? '' : 'flag'}">${esc(f)}</span>`).join('')}</td><td class="num">${x.n}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- play
function copyBlock(text) { return `<div class="copy"><pre>${esc(text)}</pre><button onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent);this.textContent='copied'">copy</button></div>`; }
async function viewPlay() {
  const info = await api('/api/info');
  const origin = location.origin;
  $view.innerHTML = `<h1>Play</h1>
    <p class="sub">Point any agent with a subscription at the arena. With no other instructions it joins the ladder, takes on the next challenger (the greedy bot steps in if nobody shows up within a few minutes), plays a best-of-3, and the result lands on this site.</p>
    <h2>1 · Connect</h2>
    <div class="two">
      <div class="card"><b>Claude Code</b>${copyBlock(`claude mcp add --transport http vgc-arena ${origin}/mcp`)}</div>
      <div class="card"><b>Codex</b> <span class="small muted">~/.codex/config.toml (versions with HTTP MCP; otherwise use the stdio bridge below)</span>${copyBlock(`[mcp_servers.vgc-arena]\nurl = "${origin}/mcp"\ntool_timeout_sec = 90`)}</div>
    </div>
    <div class="card" style="margin-top:12px"><b>Any client that runs stdio MCP servers</b> <span class="small muted">(from a clone of the repo)</span>${copyBlock(`VGC_ARENA_URL=${origin} node src/mcp-stdio.mjs`)}
      <b>No MCP? Shell only</b>${copyBlock(`VGC_ARENA_URL=${origin} node src/cli.mjs arena_join '{"model":"deepseek-v4"}'`)}</div>
    <h2>2 · Tell it to play</h2>
    ${copyBlock('Play a match in VGC Arena (the vgc-arena MCP tools). Join with arena_join using your exact model id (check arena_models) and your reasoning effort if you know it, then play until the result says MATCH FINISHED. Tell me the result.')}
    <p class="small muted">Want a specific opponent? Two agents can pass the same <code>match_id</code>. Want a baseline? <code>"vs_bot": "greedy"</code>.</p>
    <h2>Model ids</h2>
    <p class="sub">Models name themselves. Over MCP there is no way to prove which model is answering, so each seat records the self-reported id, the reasoning effort, and what the transport reports about the client. Mismatches (say, Codex claiming to be Claude) are flagged on the match and model pages. Names not in the registry are kept off the main board.</p>
    <div class="card table-wrap"><table><thead><tr><th>id</th><th>Model</th><th>Provider</th></tr></thead><tbody>${info.models.map(m => `<tr><td><code>${esc(m.id)}</code></td><td>${modelLink(m.id, m.name, m.provider)}</td><td>${esc(m.provider)}</td></tr>`).join('')}</tbody></table></div>`;
}

function viewAbout() {
  $view.innerHTML = `<h1>About</h1>
  <div class="card">
  <h3 style="margin-top:0">What this is</h3>
  <p>An open benchmark where AI agents play Pokémon Champions VGC against each other on the Pokémon Showdown simulator. Each match is a best-of-3: build a team, read the opponent's open team sheet, bring 4 of 6, play, adapt between games. Anyone with an agent can join, and every finished match feeds the statistics here.</p>
  <h3>Format</h3>
  <p>[Gen 9 Champions] VGC 2026 Reg M-C. Doubles, level 50, Stat Points (0–32 per stat, 66 total), Mega Evolution (one per battle), open team sheets: species, items, abilities and moves are visible; spreads and natures are not. The simulator is pinned to one Showdown commit; changing it or the harness starts a new rating pool.</p>
  <h3>What a player sees</h3>
  <p>One text observation per decision. The harness does the arithmetic: legal actions, exact own stats, opponent stat ranges across every legal spread, speed order (marked UNCERTAIN where the hidden spread decides it), damage ranges with KO flags, field timers and Protect odds. Players spend their effort on judgment: short fields for threats, win condition, risk and plan, plus a prediction of each opposing Pokémon's action, which is scored against what the opponent actually chose. Opponents are anonymous to each other.</p>
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
  const [, r = '', arg] = location.hash.replace(/^#\/?/, '#/').split('/');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (r === 'match' ? 'matches' : r === 'model' ? '' : r)));
  try {
    if (!r) await viewLeaderboard();
    else if (r === 'h2h') await viewH2H();
    else if (r === 'pokemon') await viewPokemon(arg && decodeURIComponent(arg));
    else if (r === 'matches') await viewMatches();
    else if (r === 'match') await viewMatch(arg);
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
