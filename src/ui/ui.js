// All menus and on-screen overlays (title, mode select, HUD, pause, summaries...). Plain DOM, no libraries.
import { CONFIG, DIFFICULTIES } from '../config.js';
import { UNIFORMS, BATS } from '../game/teams.js';
import { UNLOCKS, unlockKey } from '../game/progression.js';

function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const $ = (root, sel) => root.querySelector(sel);

const STITCH_SVG = (() => {
  let s = '<svg class="stitches" viewBox="0 0 560 14" preserveAspectRatio="none"><path d="M0 7 H560" stroke="#c62828" stroke-width="2.2" fill="none"/>';
  for (let x = 6; x < 560; x += 14) s += `<path d="M${x} 1 L${x + 5} 13 M${x + 5} 1 L${x} 13" stroke="#c62828" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  return s + '</svg>';
})();

const PITCH_LABEL = { fastball: 'Fastball', changeup: 'Changeup', curveball: 'Curveball', slider: 'Slider', heater: 'Heater', mixed: 'Mixed' };

export class UI {
  constructor(root, on) {
    this.root = root;
    this.on = on; // (action, data) => void
    this.screens = {};
    this.toastT = 0;
    this.build();
  }

  act(a, d) { this.on(a, d); }

  build() {
    const r = this.root;
    // ---------------- HUD (always present, hidden when not in a game)
    const hud = h('div', 'hud');
    hud.innerHTML = `
      <div class="vignette"></div>
      <div class="hudbtns"><button class="iconbtn" data-a="pause" title="Pause (Esc)">❚❚</button><button class="iconbtn" data-a="mute" title="Mute (M)">🔊</button></div>
      <div class="pitchinfo"><span class="type"></span><span class="mph"></span></div>
      <div class="derbybox">
        <div class="cell"><div class="v hr">0</div><div class="l">Home Runs</div></div>
        <div class="cell"><div class="v red outs">10</div><div class="l">Outs Left</div></div>
        <div class="cell"><div class="v longest">--</div><div class="l">Longest ft</div></div>
        <div class="cell"><div class="v streak">0</div><div class="l">Streak</div></div>
      </div>
      <div class="banner"><div class="big"></div><div class="sub"></div></div>
      <div class="callout"></div>
      <div class="batter-tag"></div>
      <div class="bug">
        <div class="teams">
          <div class="team away"><i></i><span class="abbr">AWY</span><span class="runs">0</span></div>
          <div class="team home"><i></i><span class="abbr">HME</span><span class="runs">0</span></div>
        </div>
        <div class="state">
          <div class="inning">▲ 1</div>
          <div class="dots">
            <span class="grp"><span>B</span><span class="dot b"></span><span class="dot b"></span><span class="dot b"></span><span class="dot b"></span></span>
            <span class="grp"><span>S</span><span class="dot s"></span><span class="dot s"></span><span class="dot s"></span></span>
            <span class="grp"><span>O</span><span class="dot o"></span><span class="dot o"></span><span class="dot o"></span></span>
          </div>
        </div>
        <svg class="diamond" viewBox="0 0 60 60"><rect class="base b2" x="21" y="4" width="18" height="18" transform="rotate(45 30 13)"/><rect class="base b3" x="3" y="22" width="18" height="18" transform="rotate(45 12 31)"/><rect class="base b1" x="39" y="22" width="18" height="18" transform="rotate(45 48 31)"/></svg>
      </div>
      <div class="meter"><div class="bar"><div class="tick"></div><div class="mark"></div></div><div class="lab"><span>EARLY</span><span>LATE</span></div><div class="txt"></div></div>
      <div class="aimgauge"><span>Aim</span><div class="track"><div class="knob"></div></div><span class="aimlab">CENTER</span></div>
      <button class="touchaim l" data-aim="-1">◀</button><button class="touchaim r" data-aim="1">▶</button>
      <div class="hint"></div>
      <div class="practice panel">
        <div class="label">Pitch type</div>
        <div class="pt"></div>
        <div class="label">Speed</div>
        <div class="spd"><span class="sv">85 mph</span></div>
        <input type="range" min="${CONFIG.modes.practice.speedMin}" max="${CONFIG.modes.practice.speedMax}" value="${CONFIG.modes.practice.speedDefault}" />
        <div class="label">Location</div>
        <div class="seg loc"><button data-loc="random" class="on">Random</button><button data-loc="center">Center</button><button data-loc="edges">Edges</button></div>
      </div>
      <div class="flash"></div>`;
    r.appendChild(hud);
    this.hud = hud;
    this.q = {
      pitchinfo: $(hud, '.pitchinfo'), banner: $(hud, '.banner'), callout: $(hud, '.callout'), meter: $(hud, '.meter'), hint: $(hud, '.hint'),
      derby: $(hud, '.derbybox'), bug: $(hud, '.bug'), tag: $(hud, '.batter-tag'), practice: $(hud, '.practice'), flash: $(hud, '.flash'),
      aimKnob: $(hud, '.aimgauge .knob'), aimLab: $(hud, '.aimlab'), aimGauge: $(hud, '.aimgauge'),
    };
    hud.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) this.act(b.dataset.a);
    });
    for (const b of hud.querySelectorAll('.touchaim')) {
      const v = +b.dataset.aim;
      const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); this.act('aim', v); };
      const up = (e) => { e.preventDefault(); b.classList.remove('on'); this.act('aim', 0); };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
    // practice panel
    const pt = $(hud, '.practice .pt');
    for (const k of ['fastball', 'changeup', 'curveball', 'slider', 'heater', 'mixed']) {
      const b = h('button', k === 'fastball' ? 'on' : '', PITCH_LABEL[k]);
      b.dataset.type = k;
      pt.appendChild(b);
    }
    pt.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      for (const x of pt.children) x.classList.toggle('on', x === b);
      this.act('practice', { type: b.dataset.type });
    });
    const rng = $(hud, '.practice input');
    rng.addEventListener('input', () => { $(hud, '.practice .sv').textContent = rng.value + ' mph'; this.act('practice', { speed: +rng.value }); });
    $(hud, '.practice .loc').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
      this.act('practice', { location: b.dataset.loc });
    });
    for (const el of hud.querySelectorAll('.practice, .hudbtns')) el.addEventListener('pointerdown', (e) => e.stopPropagation());

    // ---------------- toast + rotate hint
    this.toastEl = h('div', 'toast');
    r.appendChild(this.toastEl);
    this.rotateEl = h('div', 'rotate', '<div class="ph">📱</div><div class="h1">Rotate your phone</div><div class="dim-text">Sandlot plays best in landscape.</div><button class="btn small ghost" data-a="dismissRotate">Play anyway</button>');
    this.rotateEl.addEventListener('click', (e) => { if (e.target.closest('[data-a]')) { this.rotateEl.style.display = 'none'; this.rotateDismissed = true; } });
    r.appendChild(this.rotateEl);
    this.checkRotate = () => {
      const mobile = document.body.classList.contains('touch');
      const portrait = window.innerHeight > window.innerWidth * 1.05;
      this.rotateEl.style.display = mobile && portrait && !this.rotateDismissed ? 'flex' : 'none';
    };
    window.addEventListener('resize', this.checkRotate);
    window.addEventListener('orientationchange', () => setTimeout(this.checkRotate, 150));
    this.checkRotate();
  }

  // ---------------------------------------------------------------- screens
  makeScreen(name, dim = true) {
    const s = h('div', 'screen' + (dim ? ' dim' : ''));
    this.root.appendChild(s);
    this.screens[name] = s;
    return s;
  }
  show(name) {
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('show', k === name);
    this.current = name;
  }
  hideAll() {
    for (const s of Object.values(this.screens)) s.classList.remove('show');
    this.current = null;
  }
  overlay(name, on) { const s = this.screens[name]; if (s) s.classList.toggle('show', on); }

  // ---------------- title
  buildTitle(prog) {
    const s = this.screens.title || this.makeScreen('title', false);
    const c = prog.data.career;
    s.innerHTML = '';
    s.appendChild(h('div', 'logo', 'SANDLOT'));
    s.appendChild(h('div', '', STITCH_SVG));
    s.appendChild(h('div', 'tagline', 'Time it. Crush it.'));
    const row = h('div', 'col');
    row.innerHTML = `<button class="btn wide" data-a="play">Play Ball</button>
      <div class="row"><button class="btn small ghost" data-a="howto">How to play</button><button class="btn small ghost" data-a="locker">Locker</button><button class="btn small ghost" data-a="career">Career</button></div>`;
    s.appendChild(row);
    const avg = c.ab > 0 ? (c.hits / c.ab).toFixed(3).replace(/^0/, '') : '.000';
    s.appendChild(h('div', 'title-stats', c.hr || c.games || c.derbyGames ? `Career: ${avg} AVG · ${c.hr} HR · Longest ${c.longestHR} ft` : 'Spacebar, click or tap to swing'));
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
  }

  // ---------------- mode select
  buildModes(prog) {
    const s = this.screens.modes || this.makeScreen('modes');
    const st = prog.settings;
    const hs = prog.data.high;
    const c = prog.data.career;
    const q = hs.quick[st.difficulty];
    s.innerHTML = '';
    const wrap = h('div', 'menu-wrap');
    wrap.innerHTML = `
      <h1 class="h1">Choose your game</h1>
      <div class="cards">
        <button class="card" data-a="start" data-mode="quick"><div class="icon">⚾</div><h3>Quick Game</h3><p>3 innings against the computer. Full count, outs, bases and a real scoreboard. Tied? Extra innings.</p><div class="best">${q ? `Best: ${q.runs}–${q.against}` : 'Not played yet'}</div></button>
        <button class="card" data-a="start" data-mode="derby"><div class="icon">💥</div><h3>Home Run Derby</h3><p>10 outs. Anything that is not a home run costs you an out. How far can you send it?</p><div class="best">Best: ${hs.derby[st.difficulty] || 0} HR · Longest ${c.longestHR} ft</div></button>
        <button class="card" data-a="start" data-mode="practice"><div class="icon">🎯</div><h3>Practice</h3><p>Pick the pitch and the speed. See exactly how early or late every swing was.</p><div class="best">${c.practiceSwings} swings taken</div></button>
      </div>
      <div class="opts panel">
        <div class="grp"><span class="label">Difficulty</span><div class="seg" data-set="difficulty">${DIFFICULTIES.map((d) => `<button data-v="${d}" class="${st.difficulty === d ? 'on' : ''}">${CONFIG.difficulty[d].label}</button>`).join('')}</div><span class="dim-text" style="font-size:12px">${CONFIG.difficulty[st.difficulty].blurb}</span></div>
        <div class="grp"><span class="label">Time of day</span><div class="seg" data-set="tod">${['day', 'dusk', 'night'].map((d) => `<button data-v="${d}" class="${st.tod === d ? 'on' : ''}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
        <div class="grp"><span class="label">Strike zone</span><div class="seg" data-set="zone" data-bool="1"><button data-v="true" class="${st.zone ? 'on' : ''}">Show</button><button data-v="false" class="${!st.zone ? 'on' : ''}">Hide</button></div></div>
        <div class="grp"><span class="label">Batting side</span><div class="seg" data-set="hand">${[['auto', 'Mixed'], ['R', 'Right'], ['L', 'Left']].map(([v, l]) => `<button data-v="${v}" class="${st.hand === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      </div>
      <div class="row"><button class="btn ghost small" data-a="back">◀ Back</button><button class="btn ghost small" data-a="howto">How to play</button></div>`;
    s.appendChild(wrap);
    s.onclick = (e) => {
      const seg = e.target.closest('.seg button');
      if (seg && seg.parentNode.dataset.set) {
        const p = seg.parentNode;
        let v = seg.dataset.v;
        if (p.dataset.bool) v = v === 'true';
        this.act('setting', { key: p.dataset.set, value: v });
        return;
      }
      const b = e.target.closest('[data-a]');
      if (b) this.act(b.dataset.a, { mode: b.dataset.mode });
    };
  }

  // ---------------- how to play
  buildHowTo(onDone) {
    const s = this.screens.howto || this.makeScreen('howto');
    s.innerHTML = '';
    const d = h('div', 'howto panel');
    d.innerHTML = `
      <h1 class="h1">How to play</h1>
      <div class="steps">
        <div class="step"><svg viewBox="0 0 120 70"><circle cx="60" cy="14" r="8" fill="#e0ac82"/><rect x="52" y="22" width="16" height="26" rx="6" fill="#e8ecf5"/><circle cx="82" cy="30" r="4.5" fill="#fff" stroke="#c62828"/><path d="M76 30 Q68 24 62 26" stroke="#ffb52e" stroke-width="1.6" fill="none" stroke-dasharray="3 3"/></svg><div class="n">1</div><h4>Watch the pitcher</h4><p>Follow the ball from his hand. Fastballs are quick, curveballs drop, changeups are slow.</p></div>
        <div class="step"><svg viewBox="0 0 120 70"><rect x="40" y="10" width="40" height="50" rx="6" fill="rgba(255,255,255,.08)" stroke="#fff" stroke-dasharray="4 3"/><circle cx="60" cy="35" r="6" fill="#fff" stroke="#c62828"/><rect x="34" y="52" width="52" height="12" rx="6" fill="#ffb52e"/><text x="60" y="61" text-anchor="middle" font-size="9" font-weight="800" fill="#0b1220">SWING</text></svg><div class="n">2</div><h4>Swing as it crosses the plate</h4><p>Press <b>Space</b>, click, or tap. Right on time is <b style="color:#ffd36b">PERFECT</b> - the ball explodes off the bat.</p></div>
        <div class="step"><svg viewBox="0 0 120 70"><path d="M60 62 L10 14 M60 62 L110 14" stroke="#fff" stroke-width="2" opacity=".6"/><path d="M60 60 L38 20" stroke="#ffb52e" stroke-width="3" stroke-linecap="round"/><path d="M60 60 L82 20" stroke="#ffb52e" stroke-width="3" stroke-linecap="round" opacity=".5"/><circle cx="60" cy="62" r="4" fill="#fff"/></svg><div class="n">3</div><h4>Aim and read the count</h4><p>Hold <kbd>A</kbd>/<kbd>D</kbd> or <kbd>◀</kbd>/<kbd>▶</kbd> to steer left or right. Early swings pull, late swings go the other way. Do not chase balls!</p></div>
      </div>
      <div class="keys"><kbd>Space</kbd> / click / tap = swing &nbsp; <kbd>A</kbd> <kbd>D</kbd> = aim &nbsp; <kbd>Z</kbd> = strike zone &nbsp; <kbd>M</kbd> = mute &nbsp; <kbd>Esc</kbd> = pause &nbsp; tap during a play to fast-forward</div>
      <div class="row"><button class="btn" data-a="howtoDone">Got it - let's play</button><button class="btn ghost small" data-a="howtoDone">Skip</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) { this.act('howtoDone'); if (onDone) onDone(); } };
  }

  // ---------------- pause
  buildPause(st) {
    const s = this.screens.pause || this.makeScreen('pause');
    s.innerHTML = '';
    const d = h('div', 'dialog panel');
    d.innerHTML = `<h2>Paused</h2>
      <button class="btn" data-a="resume">Resume</button>
      <button class="btn ghost" data-a="restart">Restart game</button>
      <div class="row"><div class="seg" data-set="zone" data-bool="1"><button data-v="true" class="${st.zone ? 'on' : ''}">Zone on</button><button data-v="false" class="${!st.zone ? 'on' : ''}">Zone off</button></div>
      <div class="seg" data-set="sound" data-bool="1"><button data-v="true" class="${st.sound ? 'on' : ''}">Sound on</button><button data-v="false" class="${!st.sound ? 'on' : ''}">Sound off</button></div></div>
      <div class="row"><div class="seg" data-set="shake" data-bool="1"><button data-v="true" class="${st.shake ? 'on' : ''}">Shake on</button><button data-v="false" class="${!st.shake ? 'on' : ''}">Shake off</button></div>
      <div class="seg" data-set="umpire"><button data-v="synth" class="${st.umpire === 'synth' ? 'on' : ''}">Ump voice</button><button data-v="speech" class="${st.umpire === 'speech' ? 'on' : ''}">Ump (browser)</button><button data-v="off" class="${st.umpire === 'off' ? 'on' : ''}">Ump off</button></div></div>
      <div class="row"><button class="btn small ghost" data-a="howtoPause">How to play</button><button class="btn small ghost" data-a="quit">Quit to menu</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => {
      const seg = e.target.closest('.seg button');
      if (seg && seg.parentNode.dataset.set) {
        const p = seg.parentNode;
        let v = seg.dataset.v; if (p.dataset.bool) v = v === 'true';
        this.act('setting', { key: p.dataset.set, value: v });
        for (const b of p.children) b.classList.toggle('on', b === seg);
        return;
      }
      const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a);
    };
  }

  // ---------------- computer's half-inning
  showSummary(data, teamName, lineStart = 0.55) {
    const s = this.screens.summary || this.makeScreen('summary');
    s.innerHTML = '';
    const d = h('div', 'summary panel');
    d.innerHTML = `<div class="label">Bottom of inning ${data.inning}</div><h2>${teamName} bat</h2><div class="lines"></div><div class="total"></div><div class="row"><button class="btn small ghost" data-a="skipSummary">Skip ▶▶</button></div>`;
    s.appendChild(d);
    const lines = $(d, '.lines');
    data.events.forEach((ev, i) => {
      const ln = h('div', 'ln' + (ev.runs > 0 ? ' run' : ''), ev.text + (ev.runs > 0 ? ` <b>+${ev.runs}</b>` : ''));
      lines.appendChild(ln);
      setTimeout(() => ln.classList.add('show'), 250 + i * lineStart * 1000);
    });
    const tot = $(d, '.total');
    setTimeout(() => { tot.textContent = data.runs > 0 ? `${teamName}: ${data.runs} run${data.runs > 1 ? 's' : ''}` : 'Three up, three down... no runs.'; }, 250 + data.events.length * lineStart * 1000);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
    this.overlay('summary', true);
  }
  hideSummary() { this.overlay('summary', false); }

  // ---------------- game over
  showGameOver(p, records, unlocked, teamNames) {
    const s = this.screens.over || this.makeScreen('over');
    s.innerHTML = '';
    const d = h('div', 'over panel');
    const st = p.stats;
    const avg = st.ab > 0 ? (st.hits / st.ab).toFixed(3).replace(/^0/, '') : '.000';
    let head = '', table = '', grid = '';
    if (p.mode === 'quick') {
      const g = p.game;
      const win = p.won;
      head = `<div class="label">${p.game.walkOff ? 'Walk-off!' : 'Final'}</div><div class="result ${win ? 'win' : 'loss'}">${win ? 'YOU WIN' : 'YOU LOSE'}</div>`;
      const n = Math.max(g.line.top.length, 3);
      let hdr = '<tr><th></th>' + Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('') + '<th>R</th><th>H</th></tr>';
      const row = (name, arr, R, H) => `<tr><td class="tn">${name}</td>` + Array.from({ length: n }, (_, i) => `<td>${arr[i] === undefined ? '' : arr[i]}</td>`).join('') + `<td class="r">${R}</td><td>${H}</td></tr>`;
      table = `<table class="linescore">${hdr}${row(teamNames.away, g.line.top, g.score.top, g.hits.top)}${row(teamNames.home, g.line.bottom, g.score.bottom, g.hits.bottom)}</table>`;
      grid = [[avg, 'AVG'], [`${st.hits}/${st.ab}`, 'Hits / AB'], [st.hr, 'Home runs'], [st.rbi, 'RBI'], [st.perfect, 'Perfect swings'], [st.longestHR ? st.longestHR + ' ft' : '--', 'Longest HR'], [st.maxEV ? Math.round(st.maxEV) + ' mph' : '--', 'Best exit velo'], [`${st.strikeouts}K ${st.walks}BB`, 'K / BB']];
    } else if (p.mode === 'derby') {
      const d2 = p.derby;
      head = `<div class="label">Home Run Derby</div><div class="result win">${d2.hr} HOME RUN${d2.hr === 1 ? '' : 'S'}</div>`;
      grid = [[d2.hr, 'Home runs'], [d2.longest ? d2.longest + ' ft' : '--', 'Longest'], [d2.bestStreak, 'Best streak'], [st.perfect, 'Perfect swings'], [st.maxEV ? Math.round(st.maxEV) + ' mph' : '--', 'Best exit velo'], [`${Math.round(100 * d2.hr / Math.max(1, st.swings))}%`, 'HR per swing'], [st.swings, 'Swings'], [st.whiffs, 'Misses']];
    }
    d.innerHTML = `${head}${table}<div class="statgrid">${grid.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <div class="badges">${records.map((r) => `<span class="badge">★ ${r}</span>`).join('')}${unlocked.map((u) => `<span class="badge unlock">🔓 Unlocked: ${u.name}</span>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn" data-a="playAgain">Play again</button><button class="btn ghost" data-a="quit">Menu</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
    this.show('over');
  }

  // ---------------- locker
  buildLocker(prog) {
    const s = this.screens.locker || this.makeScreen('locker');
    s.innerHTML = '';
    const d = h('div', 'locker panel');
    const eq = prog.data.equipped;
    const mk = (kind, key, name, sw) => {
      const un = prog.isUnlocked(kind, key);
      const on = (kind === 'bats' ? eq.bat : eq.uniform) === key;
      return `<div class="item ${un ? '' : 'locked'} ${on ? 'equipped' : ''}" data-kind="${kind}" data-key="${key}"><div class="sw" style="background:${sw}"></div><div class="n">${name}${on ? ' ✓' : ''}</div><div class="h">${un ? (on ? 'Equipped' : 'Tap to equip') : '🔒 ' + prog.lockedHint(kind, key)}</div></div>`;
    };
    const batSw = { ash: 'linear-gradient(90deg,#c9a066,#a97f45)', maple: 'linear-gradient(90deg,#efdcae,#d8bf88)', cherry: 'linear-gradient(90deg,#a03222,#6c1a10)', midnight: 'linear-gradient(90deg,#26262a,#0c0c0e)', golden: 'linear-gradient(90deg,#ffd75e,#c9962b)', neon: 'linear-gradient(90deg,#22d3ee,#0ea5c9)', sunset: 'linear-gradient(90deg,#f97316,#ec4899)', carbon: 'linear-gradient(90deg,#3b4756,#1c232d)' };
    d.innerHTML = `<h1 class="h1">Locker</h1><div class="label">Bats</div><div class="grid">${Object.entries(BATS).map(([k, v]) => mk('bats', k, v.label, batSw[k])).join('')}</div>
      <div class="label">Uniforms</div><div class="grid">${Object.entries(UNIFORMS).map(([k, v]) => mk('uniforms', k, v.label, `linear-gradient(90deg, ${v.primary} 55%, ${v.secondary} 55%, ${v.secondary} 75%, ${v.trim} 75%)`)).join('')}</div>
      <div class="row"><button class="btn ghost" data-a="back">◀ Back</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => {
      const it = e.target.closest('.item');
      if (it && !it.classList.contains('locked')) { this.act('equip', { kind: it.dataset.kind, id: it.dataset.key }); return; }
      const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a);
    };
  }

  buildCareer(prog) {
    const s = this.screens.career || this.makeScreen('career');
    s.innerHTML = '';
    const c = prog.data.career;
    const avg = c.ab > 0 ? (c.hits / c.ab).toFixed(3).replace(/^0/, '') : '.000';
    const d = h('div', 'locker panel');
    const cells = [[avg, 'Batting avg'], [c.hits, 'Hits'], [c.hr, 'Home runs'], [c.longestHR ? c.longestHR + ' ft' : '--', 'Longest HR'], [c.maxEV ? Math.round(c.maxEV) + ' mph' : '--', 'Best exit velo'], [c.perfects, 'Perfect swings'], [`${c.wins}/${c.games}`, 'Quick wins'], [c.derbyBestHR, 'Best Derby HR'], [c.derbyBestStreak, 'Best HR streak'], [c.rbi, 'RBI'], [c.strikeouts, 'Strikeouts'], [c.practiceSwings, 'Practice swings']];
    d.innerHTML = `<h1 class="h1">Career</h1><div class="statgrid">${cells.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <div class="row"><button class="btn ghost" data-a="back">◀ Back</button><button class="btn ghost small" data-a="resetSave">Reset progress</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
  }

  // ---------------------------------------------------------------- HUD updates
  showHud(mode) {
    this.hud.classList.add('show');
    this.hud.dataset.mode = mode;
    this.q.bug.style.display = mode === 'quick' ? 'flex' : 'none';
    this.q.tag.style.display = mode === 'quick' ? 'block' : 'none';
    this.q.derby.style.display = mode === 'derby' ? 'flex' : 'none';
    this.q.practice.style.display = mode === 'practice' ? 'flex' : 'none';
  }
  hideHud() { this.hud.classList.remove('show'); this.hud.querySelector('.banner').classList.remove('show'); this.q.meter.classList.remove('show'); }

  setTeams(away, home) {
    const t = this.q.bug.querySelectorAll('.team');
    t[0].querySelector('.abbr').textContent = away.abbr; t[0].querySelector('i').style.background = away.color;
    t[1].querySelector('.abbr').textContent = home.abbr; t[1].querySelector('i').style.background = home.color;
  }
  setGameState(g) {
    const b = this.q.bug;
    const t = b.querySelectorAll('.team');
    t[0].querySelector('.runs').textContent = g.score.top; t[1].querySelector('.runs').textContent = g.score.bottom;
    t[0].classList.toggle('active', g.half === 'top'); t[1].classList.toggle('active', g.half === 'bottom');
    b.querySelector('.inning').textContent = `${g.half === 'top' ? '▲' : '▼'} ${g.inning}`;
    this.setCount(g.balls, g.strikes, g.outs);
    const bs = b.querySelectorAll('.diamond .base');
    bs.forEach((x) => x.classList.remove('on'));
    if (g.bases[0]) b.querySelector('.b1').classList.add('on');
    if (g.bases[1]) b.querySelector('.b2').classList.add('on');
    if (g.bases[2]) b.querySelector('.b3').classList.add('on');
  }
  setCount(balls, strikes, outs) {
    const b = this.q.bug;
    b.querySelectorAll('.dot.b').forEach((d, i) => d.classList.toggle('on', i < balls));
    b.querySelectorAll('.dot.s').forEach((d, i) => d.classList.toggle('on', i < strikes));
    b.querySelectorAll('.dot.o').forEach((d, i) => d.classList.toggle('on', i < outs));
  }
  setBatter(b, index) { this.q.tag.innerHTML = b ? `<b>#${b.number}</b>${b.name} <span class="dim-text">· ${b.hand === 'L' ? 'bats left' : 'bats right'}</span>` : ''; void index; }
  setDerby(d) {
    const q = this.q.derby;
    q.querySelector('.hr').textContent = d.hr;
    q.querySelector('.outs').textContent = Math.max(0, d.maxOuts - d.outs);
    q.querySelector('.longest').textContent = d.longest || '--';
    q.querySelector('.streak').textContent = d.streak;
  }
  showPitchInfo(type, mph, announceOnly = false, ms = 1700) {
    const el = this.q.pitchinfo;
    el.querySelector('.type').textContent = type;
    el.querySelector('.mph').textContent = announceOnly ? '' : `${Math.round(mph)} mph`;
    el.classList.add('show');
    clearTimeout(this.pitchTimer);
    this.pitchTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  hidePitchInfo() { this.q.pitchinfo.classList.remove('show'); }
  banner(big, sub = '', cls = 'neutral', hold = false) {
    const el = this.q.banner;
    el.className = 'banner ' + cls + (hold ? ' hold' : '');
    el.querySelector('.big').textContent = big;
    el.querySelector('.sub').textContent = sub;
    void el.offsetWidth;
    el.classList.add('show');
  }
  hideBanner() { this.q.banner.classList.remove('show'); }
  callout(items, ms = 3200) {
    const el = this.q.callout;
    el.innerHTML = items.map((i) => `<div class="item"><div class="v">${i.v}<small>${i.u || ''}</small></div><div class="l">${i.l}</div></div>`).join('');
    el.classList.add('show');
    clearTimeout(this.calloutTimer);
    this.calloutTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  hideCallout() { this.q.callout.classList.remove('show'); }
  timing(errorMs, grade, windows, text) {
    const m = this.q.meter;
    const span = 120;
    const p = (v) => 50 + 50 * Math.max(-1, Math.min(1, v / span));
    const bar = m.querySelector('.bar');
    const pf = windows.perfect, gd = windows.good;
    bar.style.background = `linear-gradient(90deg, #7a2a2a 0%, #7a2a2a ${p(-gd) - 8}%, #c9a12e ${p(-gd)}%, #3aa86a ${p(-pf) - 4}%, #45f08d ${p(-pf)}%, #45f08d ${p(pf)}%, #3aa86a ${p(pf) + 4}%, #c9a12e ${p(gd)}%, #7a2a2a ${p(gd) + 8}%, #7a2a2a 100%)`;
    const mark = m.querySelector('.mark');
    mark.style.transition = 'none'; mark.style.left = '50%'; void mark.offsetWidth; mark.style.transition = ''; mark.style.left = p(errorMs) + '%';
    const txt = m.querySelector('.txt');
    txt.textContent = text;
    txt.style.color = grade === 'perfect' ? '#7dffb0' : grade === 'good' ? '#c8f5d5' : grade === 'miss' ? '#ff8a80' : '#ffd36b';
    m.classList.add('show');
    clearTimeout(this.meterTimer);
    this.meterTimer = setTimeout(() => m.classList.remove('show'), 2200);
  }
  hideTiming() { this.q.meter.classList.remove('show'); }
  setAim(v, handLabelPull) {
    this.q.aimKnob.style.left = 50 + v * 46 + '%';
    this.q.aimLab.textContent = Math.abs(v) < 0.1 ? 'CENTER' : v < 0 ? (handLabelPull === 'L' ? 'PULL ◀' : 'LEFT ◀') : (handLabelPull === 'R' ? 'PULL ▶' : 'RIGHT ▶');
  }
  hint(text, ms = 2600) {
    const el = this.q.hint;
    el.textContent = text; el.classList.add('show');
    clearTimeout(this.hintTimer);
    if (ms) this.hintTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  hideHint() { this.q.hint.classList.remove('show'); }
  flash(a = 0.5, ms = 120) {
    const f = this.q.flash;
    f.style.transition = 'none'; f.style.opacity = String(a); void f.offsetWidth;
    f.style.transition = `opacity ${ms * 2}ms ease-out`; f.style.opacity = '0';
  }
  setMuteIcon(muted) { const b = this.hud.querySelector('[data-a=mute]'); if (b) b.textContent = muted ? '🔇' : '🔊'; }
  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
  setPracticeButtons(p) {
    const pt = this.q.practice;
    for (const b of pt.querySelectorAll('.pt button')) b.classList.toggle('on', b.dataset.type === p.type);
    const r = pt.querySelector('input'); r.value = p.speed; pt.querySelector('.sv').textContent = Math.round(p.speed) + ' mph';
    for (const b of pt.querySelectorAll('.loc button')) b.classList.toggle('on', b.dataset.loc === p.location);
  }
}
