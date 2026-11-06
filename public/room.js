// The room page: one living page that re-forms around the match. Every
// Pokémon card keeps the same identity (view-transition-name) from the moment
// a model first looks it up to the moment it faints, so the browser morphs it
// between layouts: candidate chip → draft slot → team sheet → chosen four →
// battle roster. The battle itself is Showdown's own renderer.
let roomState = null;
const toId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const TYPE_C = {Normal: '#9fa19f', Fire: '#e62829', Water: '#2980ef', Electric: '#f2b705', Grass: '#3fa129', Ice: '#3dcef3', Fighting: '#ff8000', Poison: '#9141cb', Ground: '#915121', Flying: '#81b9ef', Psychic: '#ef4179', Bug: '#91a119', Rock: '#afa981', Ghost: '#704170', Dragon: '#5060e1', Dark: '#624d4e', Steel: '#60a1b8', Fairy: '#ef70ef'};
const morph = fn => (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches ? document.startViewTransition(fn) : fn());
const vtn = (side, species) => `mc-${side}-${toId(species)}`;
const nameOf = (v, side) => v.players?.find(p => p && p.side === side)?.modelName || (side === 'p1' ? 'Player 1' : 'Player 2');
const playerOf = (v, side) => v.players?.find(p => p && p.side === side);

async function viewRoom(code, matchId) {
  let id = matchId;
  if (!id) {
    const r = await api(`/api/rooms/${encodeURIComponent(code)}`);
    if (r.error) { $view.innerHTML = `<div class="empty"><h2>No room ${esc(code)}</h2><p>Check the code. Rooms appear the moment an agent opens one.</p>${roomBox(true)}</div>`; bindRoomBox(); return; }
    id = r.matchId;
  }
  const rs = roomState = {id, code, logs: {}, follow: true, view: null, full: null, scene: null, seenSheets: false, revealed: new Set(), sig: ''};
  $view.innerHTML = `<div class="rm">
    <div class="rm-head"><a class="small" href="#/matches">← Matches</a><span class="roomcode big" id="rcode">${esc(code || '')}</span><span id="rstatus"></span><span class="grow"></span><button class="ghost" id="copylink">Copy link</button></div>
    <div class="rm-board" id="board"></div>
    <nav class="rm-rail" id="rail"></nav>
    <div class="rm-stage" id="rstage" data-scene="waiting">
      <section class="col" data-side="p1"></section>
      <section class="mid"><div class="midc" id="midc"></div><div class="psbox" id="psbox"><div class="stage" id="psstage"></div><div class="pscontrols" id="psctl"></div></div></section>
      <section class="col" data-side="p2"></section>
    </div>
    <div class="rm-below" id="below"></div>
  </div>`;
  $view.querySelector('#copylink').onclick = e => { navigator.clipboard.writeText(`${location.origin}/r/${rs.code || ''}`); e.target.textContent = 'Copied'; };
  const full = await api(`/api/matches/${id}`);
  if (roomState !== rs) return;
  rs.code ||= full.room;
  $view.querySelector('#rcode').textContent = rs.code || '';
  rs.view = full;
  for (const g of full.games || []) rs.logs[g.n] = String(g.rawLog || '').split('\n').filter(Boolean);
  if (full.phase === 'finished') { rs.full = full; rs.follow = false; rs.seenSheets = true; rs.scene = 'result'; (full.games || []).forEach(g => rs.revealed.add(g.n)); }
  refresh(rs);
  clearInterval(rs.tick);
  rs.tick = setInterval(() => $view.querySelectorAll('[data-since]').forEach(t => { t.textContent = `${Math.max(0, Math.round((Date.now() - Number(t.dataset.since)) / 1000))}s`; }), 500);
  if (full.phase === 'finished') return;
  const es = rs.es = new EventSource(`/api/matches/${id}/stream`);
  es.addEventListener('state', e => {
    if (roomState !== rs) return es.close();
    const v = JSON.parse(e.data);
    rs.view = {...rs.view, ...v, games: v.games.map(g => ({...(rs.view.games || []).find(x => x.n === g.n), ...g}))};
    rs.clockSkew = Date.now() - (v.thinking?.now || Date.now());
    refresh(rs);
  });
  es.addEventListener('lines', e => {
    if (roomState !== rs) return es.close();
    const {n, from, lines} = JSON.parse(e.data);
    const arr = rs.logs[n] ||= [];
    if (from > arr.length) return;
    const fresh = lines.slice(arr.length - from);
    arr.push(...fresh);
    if (rs.ps?.n === n && rs.ps.live) { rs.ps.push(fresh); updateRosters(rs); }
  });
  es.addEventListener('finished', async () => {
    es.close();
    if (roomState !== rs) return;
    rs.full = await api(`/api/matches/${id}`);
    rs.view = rs.full;
    for (const g of rs.full.games || []) rs.logs[g.n] = String(g.rawLog || '').split('\n').filter(Boolean);
    setTimeout(() => { if (roomState !== rs) return; if (rs.follow) rs.scene = 'result'; refresh(rs, true); }, rs.follow ? 4000 : 0);
  });
}

// ---------------------------------------------------------------- scenes
function liveScene(v, rs) {
  if (v.phase === 'waiting') return 'waiting';
  if (v.phase === 'teambuilding') return 'build';
  if (v.phase === 'finished') return 'result';
  if (v.sheets && !rs.seenSheets) return 'sheets';
  const n = v.current?.n || 1;
  if (v.phase === 'preview') return `pick-${n}`;
  // A fresh battle first shows which four each side chose.
  if (!rs.revealed.has(n) && v.brings?.find(b => b.n === n)?.p1) return `reveal-${n}`;
  return `game-${n}`;
}

function refresh(rs, force) {
  const v = rs.view;
  renderBoard(rs);
  if (rs.follow) {
    const t = liveScene(v, rs);
    if (t === 'sheets' && rs.scene !== 'sheets') setTimeout(() => { if (roomState === rs && rs.scene === 'sheets' && rs.follow) { rs.seenSheets = true; refresh(rs); } }, 6000);
    if (t.startsWith('reveal-') && rs.scene !== t) { const n = Number(t.slice(7)); setTimeout(() => { if (roomState === rs && rs.scene === t) { rs.revealed.add(n); refresh(rs); } }, 3200); }
    rs.scene = t;
  }
  renderRail(rs);
  const sig = sceneSig(rs);
  if (sig !== rs.sig || force) { rs.sig = sig; morph(() => renderScene(rs)); }
  else renderLive(rs);
}

// Anything that changes card layout gets a morph; everything else updates in place.
function sceneSig(rs) {
  const v = rs.view;
  const drafts = ['p1', 'p2'].map(s => buildState(v, s)).map(b => `${b.draft.join(',')}|${b.cands.join(',')}|${b.locked}`).join('/');
  return `${rs.scene}|${rs.scene === 'build' ? drafts : ''}|${v.phase}|${JSON.stringify(v.current?.previewLocked || {})}|${!!rs.full}`;
}

function renderScene(rs) {
  const s = rs.scene || 'waiting';
  const stage = $view.querySelector('#rstage');
  const kind = s.replace(/-\d+$/, '');
  stage.dataset.scene = kind;
  const n = Number(s.split('-')[1]) || rs.view.current?.n || 1;
  for (const side of ['p1', 'p2']) $view.querySelector(`.col[data-side="${side}"]`).innerHTML = column(rs, side, kind, n);
  $view.querySelector('#midc').innerHTML = middle(rs, kind, n);
  if (kind === 'game') mountBattle(rs, n);
  else { rs.ps?.destroy(); rs.ps = null; $view.querySelector('#psstage').innerHTML = ''; }
  renderBelow(rs, kind, n);
  renderLive(rs);
  updateRosters(rs);
}

// Things that tick without re-layout: thinking timers, research feed text.
function renderLive(rs) {
  const v = rs.view;
  for (const side of ['p1', 'p2']) {
    const el = $view.querySelector(`.col[data-side="${side}"] .think`);
    if (el) el.innerHTML = thinking(v, side, rs);
    const feed = $view.querySelector(`.col[data-side="${side}"] .feed`);
    if (feed) feed.innerHTML = feedHtml(v, side);
  }
}

function thinking(v, side, rs) {
  const since = v.thinking?.[side];
  const p = playerOf(v, side);
  if (!p) return '<span class="muted">waiting for a challenger…</span>';
  if (v.phase === 'finished') return v.winner === side ? '<span class="won">🏆 winner</span>' : '';
  if (since) {
    const what = v.phase === 'teambuilding' ? 'building' : v.phase === 'preview' ? 'choosing four' : 'deciding';
    return `<span class="spin"></span>${what} <b data-since="${since + (rs.clockSkew || 0)}">0s</b>`;
  }
  return v.phase === 'waiting' ? '' : '<span class="ok">✓ locked in</span>';
}

function feedHtml(v, side) {
  const acts = (v.activity || []).filter(a => a.side === side && a.tool !== 'turn_submit').slice(-5).reverse();
  return acts.map((a, i) => `<div class="fd ${a.ok ? '' : 'bad'}" style="--i:${i}"><code>${esc(a.tool)}</code> ${a.detail ? esc(a.detail) : '<span class="muted">sealed</span>'}</div>`).join('');
}

// What a side has been building, from its tool activity.
function buildState(v, side) {
  const r = v.research?.[side];
  if (r) return {draft: r.draft, cands: r.cands, locked: !!playerOf(v, side)?.teamSubmitted, invalid: r.draftOk === false, calls: r.calls};
  const acts = (v.activity || []).filter(a => a.side === side);
  const lastDraft = [...acts].reverse().find(a => a.draft && a.species?.length);
  const draft = (lastDraft?.species || []).slice(0, 6);
  const seen = [];
  for (const a of acts) for (const sp of a.species || []) if (!seen.includes(sp)) seen.push(sp);
  const cands = seen.filter(sp => !draft.includes(sp)).slice(-12);
  return {draft, cands, locked: !!playerOf(v, side)?.teamSubmitted, invalid: lastDraft && !lastDraft.ok && lastDraft.tool === 'validate_team'};
}

function monCard(side, species, sheet, v, opts = {}) {
  const info = v.dex?.species?.[species] || {types: []};
  const t1 = TYPE_C[info.types?.[0]] || 'var(--line)', t2 = TYPE_C[info.types?.[1] || info.types?.[0]] || t1;
  const cls = ['mc', opts.cls || ''].join(' ');
  return `<div class="${cls}" style="view-transition-name:${vtn(side, species)};--t1:${t1};--t2:${t2}" data-sp="${esc(toId(species))}">
    ${opts.badge ? `<span class="badge2">${opts.badge}</span>` : ''}
    <div class="mc-spr">${sprite(species)}</div>
    <div class="mc-body"><div class="mc-name">${esc(species)}</div>
      ${sheet ? `<div class="mc-sub">${esc(sheet.item || '—')} · ${esc(sheet.ability)}</div>
      <div class="mc-types">${(info.types || []).map(t => `<span style="background:${TYPE_C[t]}">${t}</span>`).join('')}</div>
      <div class="mc-moves">${sheet.moves.map(m => `<span style="--mt:${TYPE_C[v.dex?.moves?.[m]?.type] || 'var(--line)'}">${esc(m)}</span>`).join('')}</div>` : ''}
      <div class="mc-hp"><i></i></div></div>
  </div>`;
}

function colHead(rs, side) {
  const v = rs.view;
  const p = playerOf(v, side);
  const verified = (p?.flags || []).includes('verified-api');
  const usage = p?.api ? `${((p.api.input + p.api.output) / 1000).toFixed(1)}k tokens${p.api.cost ? ` · $${p.api.cost.toFixed(3)}` : ''}` : '';
  return `<div class="ch" style="--pc:${pcolor(p?.provider)}"><div class="ch-name">${p ? modelLink(p.model, p.modelName || p.model, p.provider, p.effort) : '<span class="muted">Open seat</span>'}${verified ? ' <span class="verified" title="Played through its API by the arena: identity verified">✓<span class="vt"> verified</span></span>' : ''}</div>
    <div class="ch-meta small muted">${p?.owner ? `by ${esc(p.owner)}` : ''}${usage ? ` · ${usage}` : ''}</div><div class="think small">${thinking(v, side, rs)}</div></div>`;
}

function column(rs, side, kind, n) {
  const v = rs.view;
  const sheet = v.sheets?.[side] || [];
  const bySp = sp => sheet.find(x => toId(x.species) === toId(sp));
  const head = colHead(rs, side);
  if (kind === 'waiting') return head;
  if (kind === 'build') {
    const b = buildState(v, side);
    const slots = Array.from({length: 6}, (_, i) => (b.draft[i] ? monCard(side, b.draft[i], null, v, {cls: `slotcard ${b.locked ? 'locked' : ''}`}) : '<div class="mc empty"></div>')).join('');
    return `${head}<div class="lbl">${b.locked ? '🔒 Team locked' : b.draft.length ? `Draft${b.invalid ? ' <span class="bad">· validator found problems</span>' : ''}` : 'Draft'}</div>
      <div class="draft ${b.invalid ? 'shake' : ''}">${slots}</div>
      <div class="lbl">Considering${b.calls ? ` <span class="muted">· ${b.calls} tool calls</span>` : ''}</div><div class="cands">${b.cands.map(sp => monCard(side, sp, null, v, {cls: 'chip2'})).join('') || '<span class="muted small">looking through the dex…</span>'}</div>
      <div class="feed"></div>`;
  }
  if (kind === 'sheets' || kind === 'pick') {
    const locked = v.current?.previewLocked?.[side];
    const status = kind === 'pick' ? `<div class="lbl">${locked ? '🔒 Four chosen' : 'Choosing four…'}</div>` : '<div class="lbl">Open team sheet</div>';
    return `${head}${status}<div class="sheetgrid ${kind === 'pick' && !locked ? 'scanning' : ''}">${sheet.map((x, i) => monCard(side, x.species, x, v, {cls: 'full', badge: ''})).join('')}</div>`;
  }
  const bring = v.brings?.find(b => b.n === n)?.[side] || [];
  if (kind === 'reveal') {
    return `${head}<div class="lbl">Bringing</div><div class="sheetgrid reveal">${sheet.map(x => {
      const i = bring.findIndex(b => toId(b) === toId(x.species));
      return monCard(side, x.species, x, v, {cls: `full ${i < 0 ? 'out' : 'in'}`, badge: i < 0 ? '' : i < 2 ? 'LEAD' : 'BACK'});
    }).join('')}</div>`;
  }
  if (kind === 'game' || kind === 'result') {
    const order = bring.length ? [...bring, ...sheet.map(x => x.species).filter(sp => !bring.some(b => toId(b) === toId(sp)))] : sheet.map(x => x.species);
    return `${head}<div class="roster">${order.map((sp, i) => monCard(side, sp, null, v, {cls: `row ${bring.length && i >= bring.length ? 'home' : ''}`, badge: bring.length && i < 2 ? 'LEAD' : ''})).join('')}</div>`;
  }
  return head;
}

function middle(rs, kind, n) {
  const v = rs.view;
  if (kind === 'waiting') return `<div class="waitmid"><div class="radar2"><i></i><i></i><i></i></div><div class="bigcode2">${[...(rs.code || '····')].map((c, i) => `<span style="animation-delay:${i * 100}ms">${esc(c)}</span>`).join('')}</div><p>Waiting for a challenger. Their agent joins with <code>arena_join room "${esc(rs.code || '')}"</code></p></div>`;
  if (kind === 'build') return `<div class="vsmid"><div class="vs2">VS</div><p class="small muted">Both models are researching the dex and drafting six. Cards appear as they look Pokémon up; the draft fills in as they validate.</p></div>`;
  if (kind === 'sheets' || kind === 'pick') return `<div class="vsmid"><div class="vs2">VS</div>${kind === 'pick' ? `<div class="small muted">Game ${n} · team preview</div>` : ''}${compare(v)}</div>`;
  if (kind === 'reveal') return `<div class="vsmid"><div class="vs2">GAME ${n}</div><p class="small muted">Leads and back line chosen. The two left at home sit this one out.</p></div>`;
  if (kind === 'result') return resultMid(rs);
  return '';
}

// A quick, honest read of both sheets: what each team brings to the table.
function compare(v) {
  if (!v.sheets) return '';
  const tags = side => {
    const sh = v.sheets[side] || [];
    const who = pred => sh.filter(pred).map(x => x.species);
    const hasMove = ms => p => p.moves.some(m => ms.includes(m));
    const rows = {
      'Speed control': who(hasMove(['Tailwind', 'Trick Room', 'Icy Wind', 'Electroweb', 'Thunder Wave', 'Scary Face'])),
      'Fake Out': who(hasMove(['Fake Out'])),
      'Redirection': who(hasMove(['Follow Me', 'Rage Powder'])),
      'Intimidate': who(p => p.ability === 'Intimidate'),
      'Weather / terrain': who(p => /Drought|Drizzle|Sand Stream|Snow Warning|Surge/.test(p.ability) || /ite( [XYZ])?$/.test(p.item) && ['Charizardite Y'].includes(p.item)),
      'Mega': who(p => /ite( [XYZ])?$/.test(p.item || '') && p.item !== 'Eviolite'),
      'Spread attacks': who(hasMove(['Earthquake', 'Rock Slide', 'Heat Wave', 'Dazzling Gleam', 'Hyper Voice', 'Muddy Water', 'Blizzard', 'Make It Rain', 'Discharge', 'Surf', 'Bleakwind Storm', 'Icy Wind', 'Snarl'])),
    };
    return rows;
  };
  const a = tags('p1'), b = tags('p2');
  return `<div class="cmp">${Object.keys(a).map(k => `<div class="cmpr"><div class="cl">${a[k].map(s => sprite(s)).join('') || '<span class="muted">—</span>'}</div><div class="ck">${k}</div><div class="cr">${b[k].map(s => sprite(s)).join('') || '<span class="muted">—</span>'}</div></div>`).join('')}</div>`;
}

function resultMid(rs) {
  const v = rs.view;
  const w = v.winner;
  const preds = s => {
    const ds = (rs.full?.decisions || []).filter(d => d.side === s).flatMap(d => (d.predictionScores || []).filter(x => x.actual));
    return ds.length ? `${Math.round((ds.filter(x => x.correct).length / ds.length) * 100)}% of ${ds.length} reads` : '—';
  };
  const confetti = Array.from({length: 30}, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 9) * 0.12}s;--c:${['var(--p-openai)', 'var(--p-anthropic)', 'var(--p-deepseek)', 'var(--p-moonshot)', '#eda100'][i % 5]}"></i>`).join('');
  return `<div class="resmid">${w && w !== 'tie' ? `<div class="confetti">${confetti}</div>` : ''}<div class="trophy">${w === 'tie' ? '🤝' : '🏆'}</div>
    <h2>${w === 'tie' ? 'A tie' : `${esc(nameOf(v, w))} wins`}</h2><div class="finalscore">${v.score.p1} – ${v.score.p2}</div><div class="small muted">${esc(v.endReason || '')}</div>
    <div class="games">${(v.games || []).map(g => `<button class="gamechip" data-s="game-${g.n}">Game ${g.n} · ${g.winner === 'tie' ? 'tie' : esc(nameOf(v, g.winner))} · ${g.turn} turns ▸</button>`).join('')}</div>
    <div class="small">${['p1', 'p2'].map(s => `${esc(nameOf(v, s))}: prediction accuracy ${preds(s)}`).join('<br>')}</div></div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('.gamechip');
  if (b && roomState) { roomState.follow = false; roomState.scene = b.dataset.s; roomState.revealed.add(Number(b.dataset.s.split('-')[1])); refresh(roomState, true); }
});

// ---------------------------------------------------------------- battle
function mountBattle(rs, n) {
  if (rs.ps?.n === n) return;
  rs.ps?.destroy();
  const el = $view.querySelector('#psstage');
  el.innerHTML = '<div class="empty">Loading Showdown…</div>';
  const ctl = $view.querySelector('#psctl');
  ctl.innerHTML = `<button data-a="first" title="Start of game">⏮</button><button data-a="back" title="Previous turn">◀</button><button data-a="play" id="playbtn">⏸</button><button data-a="fwd" title="Next turn">▶</button><span class="grow"></span><span class="seg">${Object.keys(SPEEDS).map(sp => `<button data-speed="${sp}" class="${sp === 'normal' ? 'on' : ''}">${sp}</button>`).join('')}</span><button data-a="sound">🔇</button>`;
  loadPS().then(() => {
    if (roomState !== rs || rs.scene !== `game-${n}`) return;
    const live = rs.view.phase !== 'finished' && !rs.view.games?.find(g => g.n === n)?.endedAt;
    const ps = rs.ps = new Stage(el, {onTurn: t => { updateRosters(rs); renderReasoning(rs, t); }});
    ps.syncButtons = () => { const pb = ctl.querySelector('#playbtn'); if (pb && ps.battle) pb.textContent = ps.battle.paused ? '▶︎' : '⏸'; };
    window.onresize = () => ps.fit();
    ps.mount(n, rs.logs[n] || [], {live});
    ctl.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const bt = ps.battle; if (!bt) return;
      const a = b.dataset.a;
      if (a === 'play') bt.paused ? bt.play() : bt.pause();
      if (a === 'back') { rs.follow = false; bt.seekBy(-1); }
      if (a === 'fwd') bt.seekBy(1);
      if (a === 'first') { rs.follow = false; bt.seekTurn(0); bt.play(); }
      if (a === 'sound') { ps.muted = !ps.muted; bt.setMute(ps.muted); b.textContent = ps.muted ? '🔇' : '🔊'; }
      ps.syncButtons();
    });
    ctl.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { ps.speed = b.dataset.speed; ps.applySpeed(); ctl.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b)); });
    updateRosters(rs);
  }).catch(err => { el.innerHTML = `<div class="empty">Couldn't load Showdown's renderer (${esc(err.message)}).</div>`; });
}

// Roster state from the public protocol, up to the turn on screen.
function updateRosters(rs) {
  const n = rs.ps?.n;
  if (!n) return;
  const shown = rs.ps.battle?.turn ?? Infinity;
  const st = {p1: {}, p2: {}}, nick = {p1: {}, p2: {}}, active = {p1: {}, p2: {}};
  for (const line of rs.logs[n] || []) {
    const p = line.split('|');
    if (p[1] === 'turn' && Number(p[2]) > shown) break;
    const m = /^(p[12])([ab])?: (.*)$/.exec(p[2] || '');
    if (!m) continue;
    const [, side, pos, nk] = m;
    if (p[1] === 'switch' || p[1] === 'drag') {
      const sp = toId(p[3].split(',')[0]);
      const keys = (rs.view.sheets?.[side] || []).map(x => toId(x.species));
      const key = keys.find(x => sp === x) || keys.find(x => sp.startsWith(x) || x.startsWith(sp)) || sp;
      nick[side][nk] = key;
      if (active[side][pos] && st[side][active[side][pos]]) st[side][active[side][pos]].active = false;
      active[side][pos] = key;
      st[side][key] = {...(st[side][key] || {}), seen: true, active: true, hp: hpOf2(p[4]) ?? st[side][key]?.hp ?? 100};
    } else if (['-damage', '-heal', '-sethp'].includes(p[1]) && nick[side][nk]) {
      const h = hpOf2(p[3]); if (h !== null) st[side][nick[side][nk]].hp = h;
    } else if (p[1] === 'faint' && nick[side][nk]) Object.assign(st[side][nick[side][nk]], {fainted: true, active: false, hp: 0});
  }
  for (const side of ['p1', 'p2']) {
    $view.querySelectorAll(`.col[data-side="${side}"] .roster .mc`).forEach(el => {
      const s = st[side][el.dataset.sp];
      el.classList.toggle('active', !!s?.active);
      el.classList.toggle('fainted', !!s?.fainted);
      el.classList.toggle('seen', !!s?.seen);
      const bar = el.querySelector('.mc-hp i');
      const hp = s ? s.hp ?? 100 : 100;
      bar.style.width = `${hp}%`;
      bar.style.background = hp > 50 ? 'var(--good)' : hp > 20 ? '#e8a317' : 'var(--critical)';
    });
  }
}
const hpOf2 = s => { const m = /^(\d+)\/(\d+)/.exec(s || ''); return m ? Math.round((Number(m[1]) / Number(m[2])) * 100) : /^0/.test(s || '') ? 0 : null; };

// ---------------------------------------------------------------- below the stage
function renderBelow(rs, kind, n) {
  const el = $view.querySelector('#below');
  if (kind === 'game') {
    if (!rs.full?.decisions) el.innerHTML = '<div class="sealed">🔒 Each model\'s reasoning and predictions unlock when the match ends.</div>';
    else renderReasoning(rs, rs.ps?.battle?.turn ?? 0);
  } else if (kind === 'pick' && rs.full?.previews) {
    const prev = rs.full.previews.find(p => p.n === n);
    el.innerHTML = prev ? `<div class="two">${['p1', 'p2'].map(s => prev[s] ? `<div class="rcol" style="--pc:${pcolor(playerOf(rs.view, s)?.provider)}"><div class="rhead">${esc(nameOf(rs.view, s))}: game ${n} plan</div><div class="k">brings</div><div>${prev[s].bring.map(esc).join(' · ')}</div><div class="k">threats</div><div>${esc(prev[s].key_threats)}</div><div class="k">plan</div><div>${esc(prev[s].game_plan)}</div>${prev[s].lessons ? `<div class="k">lessons</div><div>${esc(prev[s].lessons)}</div>` : ''}</div>` : '').join('')}</div>` : '';
  } else if ((kind === 'build' || kind === 'sheets') && rs.full?.teamPlans) {
    el.innerHTML = `<div class="two">${['p1', 'p2'].map(s => `<div class="rcol" style="--pc:${pcolor(playerOf(rs.view, s)?.provider)}"><div class="rhead">${esc(nameOf(rs.view, s))}: team plan</div><div>${esc(rs.full.teamPlans[s] || '')}</div></div>`).join('')}</div>`;
  } else el.innerHTML = '';
}

function renderReasoning(rs, turn) {
  const el = $view.querySelector('#below');
  if (!el || !rs.full?.decisions || !rs.scene?.startsWith('game-')) return;
  const n = Number(rs.scene.slice(5));
  const prev = (rs.full.previews || []).find(p => p.n === n);
  const col = side => {
    const ds = rs.full.decisions.filter(d => d.game === n && d.side === side && d.turn === turn && d.kind !== 'preview');
    if (turn <= 0 && prev?.[side]) {
      const pv = prev[side];
      return `<div class="rcol" style="--pc:${pcolor(playerOf(rs.view, side)?.provider)}"><div class="rhead">${esc(nameOf(rs.view, side))}</div><div class="k">brings</div><div>${pv.bring.map(b => sprite(b)).join('')}</div><div class="k">key threats</div><div>${esc(pv.key_threats)}</div><div class="k">game plan</div><div>${esc(pv.game_plan)}</div>${pv.lessons ? `<div class="k">lessons</div><div>${esc(pv.lessons)}</div>` : ''}</div>`;
    }
    const body = ds.map(d => {
      const p = d.payload || {};
      return `<div class="dec"><div class="acts">${(p.actions || []).map(a => `<code>${esc(a.switch ? `↻ ${a.switch}` : `${a.move}${a.target ? ` → ${a.target}` : ''}${a.mega ? ' ✦mega' : ''}`)}</code>`).join(' ')} <span class="small muted">${d.kind === 'switch' ? 'replacement' : esc(d.depth)}${d.thinkMs ? ` · ${Math.round(d.thinkMs / 1000)}s` : ''}</span></div>
        ${['threats', 'win_condition', 'reason', 'risk', 'plan'].filter(k => p[k] && !(k === 'plan' && /^on[ -]?track/i.test(p[k]))).map(k => `<div class="k">${k.replace('_', ' ')}</div><div>${esc(p[k])}</div>`).join('')}
        ${(p.predictions || []).length ? `<div class="k">predicted</div><div>${p.predictions.map((q, i) => { const sc = d.predictionScores?.[i]; return `<span class="pred ${sc?.actual ? (sc.correct ? 'ok' : 'bad') : ''}">${esc(q.foe)}: ${esc(q.action)} · ${Math.round((q.confidence || 0) * 100)}%${sc?.actual && !sc.correct ? ` → ${esc(sc.actual)}` : ''}</span>`; }).join(' ')}</div>` : ''}</div>`;
    }).join('');
    return `<div class="rcol" style="--pc:${pcolor(playerOf(rs.view, side)?.provider)}"><div class="rhead">${esc(nameOf(rs.view, side))}</div>${body || '<div class="muted small">No decision this turn.</div>'}</div>`;
  };
  el.innerHTML = `<div class="rtitle">${turn <= 0 ? `Game ${n}: start` : `Game ${n} · turn ${turn}`}: what each model was thinking</div><div class="two">${col('p1')}${col('p2')}</div>`;
}

// ---------------------------------------------------------------- board & rail
function renderBoard(rs) {
  const v = rs.view;
  $view.querySelector('#rstatus').innerHTML = v.phase === 'finished' ? '<span class="badge">Final</span>' : '<span class="badge live">● LIVE</span>';
  const pips = s => Array.from({length: Math.ceil((v.bestOf || 3) / 2)}, (_, i) => `<i class="pip ${i < v.score[s] ? 'on' : ''}" style="--pc:${pcolor(playerOf(v, s)?.provider)}"></i>`).join('');
  $view.querySelector('#board').innerHTML = `<div class="bside" style="--pc:${pcolor(playerOf(v, 'p1')?.provider)}"><b>${esc(nameOf(v, 'p1'))}</b><span class="pips">${pips('p1')}</span></div>
    <div class="bscore">${v.score.p1}<span>–</span>${v.score.p2}</div>
    <div class="bside r" style="--pc:${pcolor(playerOf(v, 'p2')?.provider)}"><span class="pips">${pips('p2')}</span><b>${esc(nameOf(v, 'p2'))}</b></div>`;
}

function renderRail(rs) {
  const v = rs.view;
  const games = Math.max(v.games?.length || 0, v.phase === 'finished' ? 1 : 2);
  const steps = [['waiting', 'Opponent'], ['build', 'Team building'], ['sheets', 'Team sheets']];
  for (let n = 1; n <= games; n++) steps.push([`pick-${n}`, n === 1 ? 'Pick 4' : `Pick 4`], [`game-${n}`, `Game ${n}`]);
  steps.push(['result', 'Result']);
  const live = liveScene(v, {seenSheets: true, revealed: {has: () => true}});
  const order = steps.map(s => s[0]);
  const liveIdx = v.phase === 'finished' ? order.length : order.indexOf(live);
  const sel = (rs.scene || '').replace(/^reveal-/, 'game-');
  const sub = sid => {
    const g = /^game-(\d)$/.exec(sid);
    if (!g) return '';
    const gm = v.games?.find(x => x.n === Number(g[1]));
    if (gm?.winner) return gm.winner === 'tie' ? 'tie' : nameOf(v, gm.winner);
    if (v.current?.n === Number(g[1]) && v.phase === 'battle') return `turn ${v.current.turn}`;
    return '';
  };
  const rail = $view.querySelector('#rail');
  rail.innerHTML = steps.map(([sid, label], i) => {
    const ok = v.phase === 'finished' ? sid !== 'waiting' : i <= liveIdx && (sid !== 'waiting' || v.phase === 'waiting');
    return `<button class="st ${i < liveIdx ? 'done' : i === liveIdx ? 'now' : ''} ${sid === sel ? 'sel' : ''}" data-s="${sid}" ${ok ? '' : 'disabled'}><i></i><span>${esc(label)}</span>${sub(sid) ? `<em>${esc(sub(sid))}</em>` : ''}</button>`;
  }).join('<b class="ln"></b>') + (v.phase !== 'finished' ? `<button class="golive ${rs.follow ? 'on' : ''}" data-s="live">● LIVE</button>` : '');
  rail.querySelectorAll('button:not([disabled])').forEach(b => b.onclick = () => {
    if (b.dataset.s === 'live') { rs.follow = true; rs.seenSheets = true; }
    else {
      rs.follow = false; rs.scene = b.dataset.s;
      if (b.dataset.s === 'sheets') rs.seenSheets = true;
      if (b.dataset.s.startsWith('game-')) rs.revealed.add(Number(b.dataset.s.slice(5)));
    }
    refresh(rs, true);
  });
}
