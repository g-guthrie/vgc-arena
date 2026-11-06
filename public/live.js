// The living stage. One persistent scene for the whole match: the same twelve
// Pokémon entities are born at the sheet reveal, live in their trainer's tray,
// fly onto the field, take hits and fall, and the HUD around them grows and
// folds away panels as the match moves through its phases.
(function () {
  const TYPE = {Normal: '#9fa19f', Fire: '#e62829', Water: '#2980ef', Electric: '#f2b705', Grass: '#3fa129', Ice: '#3dcef3', Fighting: '#ff8000', Poison: '#9141cb', Ground: '#915121', Flying: '#81b9ef', Psychic: '#ef4179', Bug: '#91a119', Rock: '#afa981', Ghost: '#704170', Dragon: '#5060e1', Dark: '#624d4e', Steel: '#60a1b8', Fairy: '#ef70ef', Stellar: '#40b5a5'};
  const WEATHER = {sunnyday: 'sun', desolateland: 'sun', raindance: 'rain', primordialsea: 'rain', sandstorm: 'sand', snowscape: 'snow', hail: 'snow'};
  const TERRAIN = {electricterrain: 'electric', grassyterrain: 'grassy', mistyterrain: 'misty', psychicterrain: 'psychic'};
  const id = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function sid(name) {
    let s = String(name).toLowerCase().replace(/[’'.:% ]/g, '');
    for (const k of ['kommo-o', 'hakamo-o', 'jangmo-o', 'ho-oh', 'porygon-z']) if (s.startsWith(k)) s = s.replace(k, k.replace('-', ''));
    const [base, ...rest] = s.split('-');
    return rest.length ? `${base}-${rest.join('')}` : base;
  }
  const SPR = 'https://play.pokemonshowdown.com/sprites';
  function setSprite(img, species, back) {
    const s = sid(species);
    const chain = [`${SPR}/${back ? 'ani-back' : 'ani'}/${s}.gif`, `${SPR}/${back ? 'gen5-back' : 'gen5'}/${s}.png`, `${SPR}/gen5/${s.split('-')[0]}.png`];
    let i = 0;
    img.onerror = () => { if (++i < chain.length) img.src = chain[i]; else img.style.visibility = 'hidden'; };
    img.style.visibility = '';
    img.src = chain[0];
  }
  const hpOf = s => { const m = /^(\d+)\/(\d+)/.exec(s || ''); return m ? Math.round((Number(m[1]) / Number(m[2])) * 100) : (/^0/.test(s || '') ? 0 : null); };
  const statusOf = s => (String(s || '').split(' ')[1] || '').replace('fnt', '');
  const STATUS = {brn: 'BRN', par: 'PAR', slp: 'SLP', frz: 'FRZ', psn: 'PSN', tox: 'TOX'};

  class LiveStage {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts;
      this.ents = new Map();
      this.speed = 1;
      this.paused = false;
      this.queue = [];
      this.pos = 0;
      this.game = null;
      this.scene = null;
      this.reset();
      this.build();
      this.ro = new ResizeObserver(() => this.layout(true));
      this.ro.observe(this.el);
    }

    reset() {
      this.st = {turn: 0, active: {p1: [null, null], p2: [null, null]}, mons: {}, nick: {p1: {}, p2: {}}, weather: null, terrain: null, trickroom: false, side: {p1: new Set(), p2: new Set()}};
    }

    build() {
      this.root.innerHTML = `<div class="ls" data-scene="waiting">
        <div class="ls-grid"></div>
        <div class="ls-top"><div class="ls-rail"></div><div class="ls-ctrl">
          <button data-a="back" title="Previous turn">⟨⟨</button><button data-a="play" title="Play/pause">❚❚</button><button data-a="fwd" title="Next turn">⟩⟩</button>
          <span class="ls-speed">${[1, 2, 4].map(s => `<button data-speed="${s}" class="${s === 1 ? 'on' : ''}">${s}×</button>`).join('')}</span>
          <button data-a="classic" title="Showdown's classic renderer">Classic</button></div></div>
        <div class="ls-main">
          <aside class="mind" data-side="p1"></aside>
          <div class="ls-center">
            <div class="field">
              <div class="sky"></div><div class="wx"></div><div class="floor"></div>
              <div class="plat far"></div><div class="plat near"></div>
              ${['p2', 'p1'].map(s => [0, 1].map(p => `<div class="slot" data-side="${s}" data-pos="${p}"></div>`).join('')).join('')}
              <div class="fieldchips"></div>
            </div>
            <div class="overlay"></div>
            <div class="fx"></div>
            <div class="classic"></div>
          </div>
          <aside class="mind" data-side="p2"></aside>
        </div>
        <div class="ls-bottom">
          <div class="tray" data-side="p1">${[0, 1, 2, 3, 4, 5].map(i => `<div class="sock" data-i="${i}"></div>`).join('')}</div>
          <div class="ticker"></div>
          <div class="tray" data-side="p2">${[0, 1, 2, 3, 4, 5].map(i => `<div class="sock" data-i="${i}"></div>`).join('')}</div>
        </div>
        <div class="ents"></div>
      </div>`;
      this.el = this.root.querySelector('.ls');
      this.$ = sel => this.el.querySelector(sel);
      this.el.querySelectorAll('.ls-ctrl [data-a]').forEach(b => b.onclick = () => this.control(b.dataset.a, b));
      this.el.querySelectorAll('.ls-ctrl [data-speed]').forEach(b => b.onclick = () => {
        this.speed = Number(b.dataset.speed);
        this.el.querySelectorAll('.ls-ctrl [data-speed]').forEach(x => x.classList.toggle('on', x === b));
        this.el.style.setProperty('--spd', String(1 / this.speed));
      });
    }

    control(a, btn) {
      if (a === 'play') { this.paused = !this.paused; btn.textContent = this.paused ? '▶' : '❚❚'; if (!this.paused) this.run(); }
      if (a === 'back') this.seekTurn(Math.max(0, this.st.turn - 1));
      if (a === 'fwd') this.seekTurn(this.st.turn + 1);
      if (a === 'classic') { this.el.classList.toggle('classic-on'); btn.classList.toggle('on'); this.opts.onClassic?.(this.el.classList.contains('classic-on'), this.$('.classic')); }
    }

    // ---------------------------------------------------------------- view & HUD
    setView(v) {
      this.v = v;
      if (v.sheets) this.ensureEntities();
      this.renderMinds();
      this.renderTrays();
    }

    sideColor(s) { return this.opts.color(this.v.players?.find(p => p && p.side === s)?.provider); }

    ensureEntities() {
      for (const side of ['p1', 'p2']) {
        (this.v.sheets[side] || []).forEach((p, i) => {
          const key = `${side}:${id(p.species)}`;
          if (this.ents.has(key)) return;
          const info = this.v.dex?.species?.[p.species] || {types: []};
          const el = document.createElement('div');
          el.className = 'ent m-hidden';
          el.dataset.key = key;
          el.style.setProperty('--pc', this.sideColor(side));
          el.style.setProperty('--t1', TYPE[info.types[0]] || '#888');
          el.style.setProperty('--t2', TYPE[info.types[1] || info.types[0]] || '#888');
          el.innerHTML = `<div class="halo"></div><div class="body"><img class="spr" alt=""></div>
            <div class="plate"><b>${esc(p.species)}</b><span class="stat"></span><div class="hp"><i></i></div></div>
            <div class="card"><div class="types">${info.types.map(t => `<span style="background:${TYPE[t]}">${t}</span>`).join('')}</div>
              <div class="ci">${esc(p.item || '—')}</div><div class="ca">${esc(p.ability)}</div>
              <div class="cm">${p.moves.map(m => { const mv = this.v.dex?.moves?.[m] || {}; return `<span style="--mt:${TYPE[mv.type] || '#888'}">${esc(m)}</span>`; }).join('')}</div></div>`;
          setSprite(el.querySelector('.spr'), p.species, side === 'p1');
          this.$('.ents').appendChild(el);
          this.ents.set(key, {el, side, i, species: p.species, base: p.species, hp: 100, status: '', fainted: false, seen: false});
        });
      }
    }

    renderTrays() {
      for (const side of ['p1', 'p2']) {
        const tray = this.$(`.tray[data-side="${side}"]`);
        const p = this.v.players?.find(x => x && x.side === side);
        tray.style.setProperty('--pc', this.sideColor(side));
        tray.classList.toggle('locked', !!p?.teamSubmitted);
        tray.classList.toggle('picking', this.scene === 'pick' && !this.v.current?.previewLocked?.[side]);
        tray.classList.toggle('picked', this.scene === 'pick' && !!this.v.current?.previewLocked?.[side]);
      }
    }

    renderMinds() {
      for (const side of ['p1', 'p2']) {
        const el = this.$(`.mind[data-side="${side}"]`);
        const p = this.v.players?.find(x => x && x.side === side);
        el.style.setProperty('--pc', this.sideColor(side));
        const since = this.v.thinking?.[side];
        const finished = this.v.phase === 'finished';
        const head = `<div class="mh"><span class="dot"></span><b>${esc(p?.modelName || p?.model || 'Open seat')}</b>${p?.effort ? `<em>${esc(p.effort)}</em>` : ''}${(p?.flags || []).includes('verified-api') ? '<span class="vf">✓</span>' : ''}
          <div class="mstat">${p?.api ? `${((p.api.input + p.api.output) / 1000).toFixed(1)}k tok${p.api.cost ? ` · $${p.api.cost.toFixed(3)}` : ''}` : esc(p?.harness || '')}</div></div>`;
        let state = '';
        if (!p) state = '<div class="mstate idle">awaiting challenger</div>';
        else if (since && !finished) {
          const label = this.v.phase === 'teambuilding' ? 'BUILDING TEAM' : this.v.phase === 'preview' ? 'CHOOSING FOUR' : 'DECIDING';
          state = `<div class="mstate think"><div class="ring"><i></i><i></i><i></i></div><div><b>${label}</b><span class="timer" data-since="${since - (this.v.thinking.now - Date.now())}">0s</span></div></div>`;
        } else if (!finished && this.v.phase !== 'waiting') state = `<div class="mstate locked">✓ LOCKED IN</div>`;
        const acts = (this.v.activity || []).filter(a => a.side === side).slice(-7);
        const total = (this.v.activity || []).filter(a => a.side === side).length;
        const feed = acts.length ? `<div class="feed">${total > acts.length ? `<div class="fold">+${total - acts.length} earlier</div>` : ''}${acts.map(a => `<div class="fi ${a.ok ? '' : 'bad'}" data-k="${a.t}"><span class="tool">${esc(a.tool)}</span><span class="det">${a.detail ? esc(a.detail) : '<i class="scr"></i>'}</span></div>`).join('')}</div>` : '';
        const keep = el.querySelector('.thoughts');
        el.innerHTML = head + state + feed;
        if (keep) el.appendChild(keep);
        el.querySelectorAll('.fi').forEach(fi => { if (!this.seenAct?.has(fi.dataset.k)) fi.classList.add('new'); });
        this.seenAct = new Set(acts.map(a => String(a.t)));
        el.querySelectorAll('.scr').forEach(s => { s.textContent = scramble(6 + Math.floor(Math.random() * 10)); });
      }
      clearInterval(this.timerInt);
      this.timerInt = setInterval(() => {
        this.el.querySelectorAll('.timer').forEach(t => { t.textContent = `${Math.max(0, Math.round((Date.now() - Number(t.dataset.since)) / 1000))}s`; });
        this.el.querySelectorAll('.scr').forEach(s => { s.textContent = scramble(s.textContent.length || 8); });
      }, 250);
    }

    // Reasoning for the turn on screen (only after the match ends).
    showThoughts(byside) {
      for (const side of ['p1', 'p2']) {
        const el = this.$(`.mind[data-side="${side}"]`);
        el.querySelector('.thoughts')?.remove();
        const t = byside?.[side];
        if (!t) continue;
        const box = document.createElement('div');
        box.className = 'thoughts';
        box.innerHTML = t;
        el.appendChild(box);
        box.querySelectorAll('[data-type]').forEach((n, i) => typeIn(n, i * 120));
      }
    }

    // ---------------------------------------------------------------- scenes
    setScene(scene, force) {
      if (scene === this.scene && !force) { this.renderTrays(); this.layout(); return; }
      this.scene = scene;
      this.el.dataset.scene = scene;
      const ov = this.$('.overlay');
      if (scene === 'waiting') ov.innerHTML = `<div class="holo-code"><div class="radar"><i></i><i></i><i></i></div><div class="code">${[...(this.opts.code || '····')].map((c, i) => `<span style="animation-delay:${i * 110}ms">${esc(c)}</span>`).join('')}</div><p>Awaiting challenger. Share the room code.</p></div>`;
      else if (scene === 'build') ov.innerHTML = `<div class="holo-msg"><div class="hex"></div><b>TEAM BUILDING</b><p>Both models are researching the dex and assembling six. Teams stay sealed until both lock.</p></div>`;
      else if (scene === 'sheets') ov.innerHTML = `<div class="cardgrid">${['p1', 'p2'].map(s => `<div class="cards" data-side="${s}"><div class="ct">${esc(this.opts.name(s))}</div>${[0, 1, 2, 3, 4, 5].map(i => `<div class="cell" data-i="${i}"></div>`).join('')}</div>`).join('<div class="vs">VS</div>')}</div>`;
      else if (scene === 'pick') ov.innerHTML = `<div class="holo-msg small"><b>TEAM PREVIEW · GAME ${this.v.current?.n || 1}</b><p>Each side brings four. The first two lead. Picks stay hidden until they hit the field.</p></div>`;
      else if (scene === 'result') ov.innerHTML = this.opts.resultHtml();
      else ov.innerHTML = '';
      if (scene === 'sheets') this.ents.forEach(e => { e.el.classList.add('burst'); setTimeout(() => e.el.classList.remove('burst'), 900 + e.i * 120); });
      this.renderTrays();
      requestAnimationFrame(() => this.layout());
    }

    anchor(sel) {
      const a = this.$(sel);
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const o = this.el.getBoundingClientRect();
      if (!r.width) return null;
      return {x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2, w: r.width, h: r.height};
    }

    layout(instant) {
      if (!this.v?.sheets) return;
      this.el.classList.toggle('instant', !!instant);
      for (const e of this.ents.values()) {
        let mode = 'hidden', a = null;
        const s = this.scene;
        if (s === 'sheets') { mode = 'card'; a = this.anchor(`.cards[data-side="${e.side}"] .cell[data-i="${e.i}"]`); }
        else if (s === 'pick') { mode = 'tray'; a = this.anchor(`.tray[data-side="${e.side}"] .sock[data-i="${e.i}"]`); }
        else if (s === 'battle' || s === 'result') {
          const pos = this.st.active[e.side].indexOf(e.key || this.keyOf(e));
          if (pos >= 0 && s === 'battle') { mode = 'field'; a = this.anchor(`.slot[data-side="${e.side}"][data-pos="${pos}"]`); }
          else { mode = e.fainted ? 'ko' : e.seen ? 'bench' : 'tray'; a = this.anchor(`.tray[data-side="${e.side}"] .sock[data-i="${e.i}"]`); }
        }
        for (const c of [...e.el.classList]) if (c.startsWith('m-')) e.el.classList.remove(c);
        e.el.classList.add(`m-${mode}`);
        e.el.classList.toggle('fainted', e.fainted);
        e.el.classList.toggle('mega', !!e.mega);
        if (a) {
          e.el.style.setProperty('--w', `${a.w}px`);
          e.el.style.setProperty('--h', `${a.h}px`);
          e.el.style.transform = `translate(${a.x - a.w / 2}px, ${a.y - a.h / 2}px)`;
        }
        const bar = e.el.querySelector('.hp i');
        bar.style.width = `${e.hp}%`;
        bar.style.background = e.hp > 50 ? '#3ddc84' : e.hp > 20 ? '#f5b82e' : '#ff5a5a';
        e.el.querySelector('.stat').textContent = STATUS[e.status] || '';
      }
      if (instant) requestAnimationFrame(() => this.el.classList.remove('instant'));
    }
    keyOf(e) { return `${e.side}:${id(e.base)}`; }

    // ---------------------------------------------------------------- battle
    loadGame(n, lines, {live}) {
      this.game = n;
      this.live = live;
      this.queue = lines.slice();
      this.pos = 0;
      this.reset();
      for (const e of this.ents.values()) Object.assign(e, {hp: 100, status: '', fainted: false, seen: false, mega: false, species: e.base});
      this.ents.forEach(e => setSprite(e.el.querySelector('.spr'), e.base, e.side === 'p1'));
      this.clearField();
      if (live) {
        // Join a live game at its current state, then animate from here on.
        const lastTurn = lines.reduce((t, l) => (l.startsWith('|turn|') ? Number(l.slice(6)) : t), 0);
        this.fastForward(lastTurn);
      }
      this.layout(true);
      this.run();
    }

    feed(lines) { this.queue.push(...lines); if (!this.running) this.run(); }

    clearField() {
      this.$('.wx').className = 'wx';
      this.$('.floor').className = 'floor';
      this.$('.field').classList.remove('tr');
      this.$('.fieldchips').innerHTML = '';
      this.$('.ticker').innerHTML = '';
    }

    fastForward(turn) {
      while (this.pos < this.queue.length) {
        const l = this.queue[this.pos];
        if (l.startsWith('|turn|') && Number(l.slice(6)) > turn) break;
        this.apply(l, false);
        this.pos++;
      }
      this.opts.onTurn?.(this.st.turn);
    }

    seekTurn(turn) {
      if (this.game == null) return;
      const lines = this.queue;
      this.pos = 0;
      this.reset();
      for (const e of this.ents.values()) Object.assign(e, {hp: 100, status: '', fainted: false, seen: false, mega: false, species: e.base});
      this.ents.forEach(e => setSprite(e.el.querySelector('.spr'), e.base, e.side === 'p1'));
      this.clearField();
      this.queue = lines;
      this.fastForward(turn);
      this.layout(true);
      this.renderFieldChips();
      if (!this.paused) this.run();
    }

    async run() {
      if (this.running) return;
      this.running = true;
      const myGame = this.game;
      while (this.pos < this.queue.length && !this.paused && this.game === myGame) {
        const line = this.queue[this.pos++];
        const ms = this.apply(line, true);
        if (ms) await sleep(ms / this.speed);
      }
      this.running = false;
    }

    entFor(side, nick) { const key = this.st.nick[side][nick]; return key ? this.ents.get(key) : null; }

    // Apply one protocol line; returns how long its animation should hold.
    apply(line, anim) {
      const p = line.split('|');
      const cmd = p[1];
      const who = s => { const m = /^(p[12])([ab])?: (.*)$/.exec(s || ''); return m ? {side: m[1], pos: m[2] === 'b' ? 1 : 0, nick: m[3]} : null; };
      switch (cmd) {
      case 'switch': case 'drag': case 'replace': {
        const w = who(p[2]);
        if (!w) return 0;
        const species = p[3].split(',')[0];
        const sheet = [...this.ents.values()].filter(e => e.side === w.side);
        const e = sheet.find(x => id(x.base) === id(species)) || sheet.find(x => id(species).startsWith(id(x.base)) || id(x.base).startsWith(id(species)));
        if (!e) return 0;
        const key = `${w.side}:${id(e.base)}`;
        this.st.nick[w.side][w.nick] = key;
        this.st.active[w.side][w.pos] = key;
        e.seen = true;
        const hp = hpOf(p[4]);
        if (hp !== null) e.hp = hp;
        e.status = statusOf(p[4]);
        if (anim) { this.layout(); this.burstAt(w.side, w.pos); this.tick(`${this.opts.name(w.side)} sent out <b>${esc(species)}</b>`, w.side); return 750; }
        return 0;
      }
      case 'detailschange': case '-formechange': {
        const w = who(p[2]); const e = w && this.entFor(w.side, w.nick);
        if (e) { e.species = p[3].split(',')[0]; setSprite(e.el.querySelector('.spr'), e.species, e.side === 'p1'); }
        return 0;
      }
      case '-mega': {
        const w = who(p[2]); const e = w && this.entFor(w.side, w.nick);
        if (e) { e.mega = true; if (anim) { e.el.classList.add('megaburst'); setTimeout(() => e.el.classList.remove('megaburst'), 1400); this.banner(e, 'MEGA EVOLUTION', '#c77dff', true); this.tick(`<b>${esc(e.base)}</b> Mega Evolved!`, e.side); return 1300; } }
        return 0;
      }
      case 'move': {
        const w = who(p[2]); const e = w && this.entFor(w.side, w.nick);
        const move = p[3];
        if (!e) return 0;
        if (anim) {
          const mv = this.v.dex?.moves?.[move] || {};
          const t = who(p[4]);
          const te = t && this.entFor(t.side, t.nick);
          this.banner(e, move, TYPE[mv.type] || '#8aa');
          this.lunge(e, te && te !== e ? te : null);
          this.tick(`<b>${esc(e.species)}</b> used <span style="color:${TYPE[mv.type] || 'inherit'}">${esc(move)}</span>`, e.side);
          return mv.category === 'Status' ? 750 : 850;
        }
        return 0;
      }
      case '-damage': case '-heal': case '-sethp': {
        const w = who(p[2]); const e = w && this.entFor(w.side, w.nick);
        if (!e) return 0;
        const hp = hpOf(p[3]);
        const before = e.hp;
        if (hp !== null) e.hp = hp;
        e.status = statusOf(p[3]) || (hp === 0 ? '' : e.status);
        if (anim) {
          const d = e.hp - before;
          if (d) this.float(e, `${d > 0 ? '+' : ''}${d}%`, d > 0 ? 'heal' : 'dmg');
          if (d < 0) this.shake(e);
          this.layout();
          return 450;
        }
        return 0;
      }
      case 'faint': {
        const w = who(p[2]); const e = w && this.entFor(w.side, w.nick);
        if (!e) return 0;
        e.fainted = true; e.hp = 0;
        const idx = this.st.active[w.side].indexOf(`${w.side}:${id(e.base)}`);
        if (anim) {
          e.el.classList.add('falling');
          this.tick(`<b>${esc(e.species)}</b> fainted`, w.side, 'ko');
          setTimeout(() => { if (idx >= 0) this.st.active[w.side][idx] = null; e.el.classList.remove('falling'); this.layout(); }, 700 / this.speed);
          return 900;
        }
        if (idx >= 0) this.st.active[w.side][idx] = null;
        return 0;
      }
      case '-status': { const w = who(p[2]); const e = w && this.entFor(w.side, w.nick); if (e) { e.status = p[3]; if (anim) { this.float(e, STATUS[p[3]] || p[3], 'stat'); this.layout(); return 450; } } return 0; }
      case '-curestatus': { const w = who(p[2]); const e = w && this.entFor(w.side, w.nick); if (e) e.status = ''; return 0; }
      case '-boost': case '-unboost': {
        const w = who(p[2]); const e = w && this.entFor(w.side, w.nick);
        if (e && anim) { this.float(e, `${p[3].toUpperCase()} ${cmd === '-boost' ? '▲' : '▼'.repeat(1)}${Number(p[4]) > 1 ? (cmd === '-boost' ? '▲' : '▼') : ''}`, cmd === '-boost' ? 'up' : 'down'); return 380; }
        return 0;
      }
      case '-supereffective': case '-resisted': case '-crit': case '-miss': case '-immune': case '-fail': {
        const w = who(p[2]) || who(p[3]); const e = w && this.entFor(w.side, w.nick);
        const txt = {'-supereffective': 'SUPER EFFECTIVE', '-resisted': 'resisted', '-crit': 'CRITICAL HIT', '-miss': 'MISSED', '-immune': 'IMMUNE', '-fail': 'FAILED'}[cmd];
        if (e && anim) { this.float(e, txt, cmd === '-supereffective' || cmd === '-crit' ? 'big' : 'meh'); return 380; }
        return 0;
      }
      case '-activate': case '-singleturn': {
        const w = who(p[2]); const e = w && this.entFor(w.side, w.nick);
        const what = String(p[3] || '').replace(/^move: /, '');
        if (e && anim && /Protect|Detect|Wide Guard|Quick Guard|Spiky Shield|King's Shield|Baneful Bunker|Silk Trap|Burning Bulwark/.test(what)) { e.el.classList.add('shield'); setTimeout(() => e.el.classList.remove('shield'), 1200 / this.speed); return 350; }
        if (e && anim && /Follow Me|Rage Powder|Helping Hand/.test(what)) { this.float(e, what.toUpperCase(), 'stat'); return 300; }
        return 0;
      }
      case '-weather': {
        const w = WEATHER[id(p[2])];
        this.st.weather = p.includes('[upkeep]') ? this.st.weather : w || null;
        this.$('.wx').className = `wx ${this.st.weather ? `w-${this.st.weather}` : ''}`;
        if (anim && !p.includes('[upkeep]')) { this.renderFieldChips(); if (w) { this.sweep(p[2].replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()); return 900; } }
        return 0;
      }
      case '-fieldstart': case '-fieldend': {
        const f = id(String(p[2]).replace('move: ', ''));
        const on = cmd === '-fieldstart';
        if (TERRAIN[f]) { this.st.terrain = on ? TERRAIN[f] : null; this.$('.floor').className = `floor ${this.st.terrain ? `t-${this.st.terrain}` : ''}`; }
        if (f === 'trickroom') { this.st.trickroom = on; this.$('.field').classList.toggle('tr', on); }
        this.renderFieldChips();
        if (anim && on) { this.sweep(String(p[2]).replace('move: ', '').toUpperCase()); return 900; }
        return 0;
      }
      case '-sidestart': case '-sideend': {
        const side = String(p[2]).slice(0, 2);
        const what = String(p[3]).replace('move: ', '');
        if (this.st.side[side]) this.st.side[side][cmd === '-sidestart' ? 'add' : 'delete'](what);
        this.renderFieldChips();
        if (anim && cmd === '-sidestart') { this.tick(`${esc(what)} on ${esc(this.opts.name(side))}'s side`, side); return 500; }
        return 0;
      }
      case 'turn': {
        this.st.turn = Number(p[2]);
        this.opts.onTurn?.(this.st.turn);
        if (anim) { this.sweep(`TURN ${p[2]}`, 'turn'); return 950; }
        return 0;
      }
      case 'win': case 'tie': {
        if (anim) { this.sweep(cmd === 'tie' ? 'TIE' : `${p[2]} WINS`, 'win'); this.tick(cmd === 'tie' ? 'Tie game' : `<b>${esc(p[2])}</b> wins the game`); return 1600; }
        return 0;
      }
      default: return 0;
      }
    }

    renderFieldChips() {
      const chips = [];
      if (this.st.weather) chips.push(`<span class="fc">${this.st.weather.toUpperCase()}</span>`);
      if (this.st.terrain) chips.push(`<span class="fc">${this.st.terrain.toUpperCase()} TERRAIN</span>`);
      if (this.st.trickroom) chips.push('<span class="fc tr">TRICK ROOM</span>');
      for (const side of ['p1', 'p2']) for (const c of this.st.side[side]) chips.push(`<span class="fc" style="--pc:${this.sideColor(side)}">${esc(c)}</span>`);
      this.$('.fieldchips').innerHTML = chips.join('');
    }

    // ---------------------------------------------------------------- effects
    center(e) {
      const r = e.el.getBoundingClientRect();
      const o = this.$('.ls-center').getBoundingClientRect();
      return {x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2};
    }
    float(e, text, kind) {
      const c = this.center(e);
      const f = document.createElement('div');
      f.className = `float ${kind}`;
      f.textContent = text;
      f.style.left = `${c.x}px`; f.style.top = `${c.y - 30}px`;
      this.$('.fx').appendChild(f);
      setTimeout(() => f.remove(), 1500);
    }
    banner(e, text, color, big) {
      const c = this.center(e);
      const b = document.createElement('div');
      b.className = `mvbanner ${big ? 'big' : ''}`;
      b.style.setProperty('--mt', color);
      b.innerHTML = `<i></i><span>${esc(text)}</span>`;
      b.style.left = `${c.x}px`; b.style.top = `${c.y - 70}px`;
      this.$('.fx').appendChild(b);
      // The panel lives briefly, then folds into the ticker.
      setTimeout(() => {
        const t = this.$('.ticker').getBoundingClientRect(), o = this.$('.ls-center').getBoundingClientRect();
        b.style.transition = `all ${0.45 * this.speed ** -1}s cubic-bezier(.5,0,.75,0)`;
        b.style.left = `${t.left - o.left + t.width / 2}px`; b.style.top = `${t.top - o.top + 10}px`;
        b.style.opacity = '0'; b.style.transform = 'translate(-50%,-50%) scale(.3)';
        setTimeout(() => b.remove(), 600);
      }, 1100 / this.speed);
    }
    lunge(e, target) {
      const body = e.el.querySelector('.body');
      let dx = 0, dy = -24;
      if (target) { const a = this.center(e), b = this.center(target); const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; dx = ((b.x - a.x) / L) * 46; dy = ((b.y - a.y) / L) * 46; }
      body.animate([{transform: 'translate(0,0)'}, {transform: `translate(${dx}px,${dy}px) scale(1.06)`, offset: 0.35}, {transform: 'translate(0,0)'}], {duration: 520 / this.speed, easing: 'cubic-bezier(.3,.7,.4,1)'});
      e.el.animate([{filter: 'brightness(1)'}, {filter: 'brightness(1.6)'}, {filter: 'brightness(1)'}], {duration: 400 / this.speed});
    }
    shake(e) {
      e.el.querySelector('.body').animate([{transform: 'translateX(0)'}, {transform: 'translateX(-9px)'}, {transform: 'translateX(8px)'}, {transform: 'translateX(-5px)'}, {transform: 'translateX(0)'}], {duration: 380 / this.speed});
      e.el.querySelector('.body').animate([{opacity: 1}, {opacity: 0.25}, {opacity: 1}, {opacity: 0.4}, {opacity: 1}], {duration: 380 / this.speed});
    }
    burstAt(side, pos) {
      const a = this.anchor(`.slot[data-side="${side}"][data-pos="${pos}"]`);
      if (!a) return;
      const o = this.$('.ls-center').getBoundingClientRect(), l = this.el.getBoundingClientRect();
      const b = document.createElement('div');
      b.className = 'burstfx';
      b.style.left = `${a.x - (o.left - l.left)}px`; b.style.top = `${a.y - (o.top - l.top)}px`;
      b.style.setProperty('--pc', this.sideColor(side));
      this.$('.fx').appendChild(b);
      setTimeout(() => b.remove(), 900);
    }
    sweep(text, kind = '') {
      const s = document.createElement('div');
      s.className = `sweep ${kind}`;
      s.innerHTML = `<span>${esc(text)}</span>`;
      this.$('.fx').appendChild(s);
      setTimeout(() => s.remove(), 1400 / this.speed);
    }
    tick(html, side, kind = '') {
      const t = this.$('.ticker');
      const d = document.createElement('div');
      d.className = `tk ${kind}`;
      if (side) d.style.setProperty('--pc', this.sideColor(side));
      d.innerHTML = html;
      t.appendChild(d);
      while (t.children.length > 40) t.firstChild.remove();
      t.scrollTop = t.scrollHeight;
    }

    destroy() { this.game = null; this.paused = true; clearInterval(this.timerInt); this.ro.disconnect(); }
  }

  const GLYPHS = '▓▒░█▚▞◆◇◈⌁⌬⏃⏚';
  function scramble(n) { let s = ''; for (let i = 0; i < n; i++) s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; return s; }
  function typeIn(node, delay) {
    const text = node.textContent;
    node.textContent = '';
    let i = 0;
    setTimeout(function step() {
      i = Math.min(text.length, i + 3);
      node.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(step, 12);
    }, delay);
  }

  window.LiveStage = LiveStage;
})();
