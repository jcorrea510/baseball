// All menus and on-screen overlays (title, mode select, HUD, pause, summaries...). Plain DOM, no libraries.
import { CONFIG, DIFFICULTIES } from '../config.js';
import { UNIFORMS, BATS } from '../game/teams.js';
import { UNLOCKS, unlockKey } from '../game/progression.js';
import { logoSVG, wordSVG } from './logo.js';

function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const $ = (root, sel) => root.querySelector(sel);

// Small line icons, drawn here so nothing has to be downloaded. `f` marks a solid shape.
const ICONS = {
  pause: '<path class="f" d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z"/>',
  soundOn: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.2 6.3a8.5 8.5 0 0 1 0 11.4"/>',
  soundOff: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevRight: '<path d="M9 5l7 7-7 7"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M6.4 5.4c3 2.6 3 10.6 0 13.2M17.6 5.4c-3 2.6-3 10.6 0 13.2"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle class="f" cx="12" cy="12" r="1.4"/>',
  shirt: '<path d="M8.5 4L3 7l2 4.2 2.5-1V20h9V10.2l2.5 1L21 7l-5.5-3a3.5 3.5 0 0 1-7 0z"/>',
  chart: '<path d="M5 20v-8M12 20V5M19 20v-9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 1.9M12 17h.01"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4 4v4.5h4.5"/>',
  home: '<path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.4-2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  play: '<path class="f" d="M8 5.5v13l11-6.5z"/>',
  ff: '<path class="f" d="M4 6v12l8-6zM12 6v12l8-6z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  zone: '<rect x="6" y="4" width="12" height="16" rx="1.5"/><path d="M10 4v16M14 4v16M6 9.3h12M6 14.7h12"/>',
  landing: '<ellipse cx="12" cy="15" rx="8" ry="3.6"/><circle cx="12" cy="6.5" r="2.2"/>',
  guide: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/>',
  shake: '<path d="M3 9l2 3-2 3M21 9l-2 3 2 3M8 7v10M12 4v16M16 7v10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/>',
  star: '<path class="f" d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  gear: '<path d="M19.15 10.55L21.23 10.89L21.23 13.11L19.15 13.45L18.08 16.03L19.32 17.74L17.74 19.32L16.03 18.08L13.45 19.15L13.11 21.23L10.89 21.23L10.55 19.15L7.97 18.08L6.26 19.32L4.68 17.74L5.92 16.03L4.85 13.45L2.77 13.11L2.77 10.89L4.85 10.55L5.92 7.97L4.68 6.26L6.26 4.68L7.97 5.92L10.55 4.85L10.89 2.77L13.11 2.77L13.45 4.85L16.03 5.92L17.74 4.68L19.32 6.26L18.08 7.97Z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  flash: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/>',
  timing: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  bat: '<path d="M4 20l2-2M6.5 17.5l10.8-10.8a2.6 2.6 0 0 1 3.7 3.7L10.2 21.2"/>',
  crowd: '<circle cx="7" cy="9" r="2.4"/><circle cx="17" cy="9" r="2.4"/><circle cx="12" cy="7.5" r="2.8"/><path d="M2.5 19c.4-3 2.2-4.8 4.5-4.8M21.5 19c-.4-3-2.2-4.8-4.5-4.8M6.5 20c.5-3.8 2.8-6 5.5-6s5 2.2 5.5 6"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// A results headline in the logo's letters, or plain text if it cannot be drawn.
let headlineN = 0;
const headline = (text, tone) => wordSVG(text, { id: 'hl' + ++headlineN, tone }) || text;

// A selector that finds "the same" control again after its screen is rebuilt.
function focusSelector(el) {
  const d = el.dataset || {};
  if (d.v !== undefined && el.parentNode && el.parentNode.dataset && el.parentNode.dataset.set) return `[data-set="${el.parentNode.dataset.set}"] [data-v="${d.v}"]`;
  if (d.set) return `[data-set="${d.set}"]`;
  if (d.mode) return `[data-mode="${d.mode}"]`;
  if (d.kind && d.key) return `[data-kind="${d.kind}"][data-key="${d.key}"]`;
  if (d.slide) return `[data-slide="${d.slide}"]`;
  if (d.a) return `[data-a="${d.a}"]`;
  return null;
}

const PITCH_LABEL = { fastball: 'Fastball', changeup: 'Changeup', curveball: 'Curveball', slider: 'Slider', heater: 'Heater', mixed: 'Mixed' };
const avgText = (hits, ab) => (ab > 0 ? (hits / ab).toFixed(3).replace(/^0/, '') : '.000');
// Small screens fold the practice chooser away so it never covers the play.
const smallScreen = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-height: 520px), (max-width: 900px)').matches;

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
      <div class="hudbtns"><button class="iconbtn" data-a="pause" aria-label="Pause" title="Pause (Esc)">${icon('pause')}</button><button class="iconbtn" data-a="mute" aria-label="Sound" title="Mute (M)">${icon('soundOn')}</button></div>
      <div class="pitchinfo"><span class="type"></span><span class="mph"></span></div>
      <div class="banner"><div class="big"></div><div class="sub"></div></div>
      <div class="callout"></div>
      <div class="hint"></div>
      <div class="bugwrap">
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
      </div>
      <div class="derbybox">
        <div class="cell"><div class="v hr">0</div><div class="l">HR</div></div>
        <div class="cell"><div class="v red outs">10</div><div class="l">Outs left</div></div>
        <div class="cell"><div class="v longest">--</div><div class="l">Longest</div></div>
        <div class="cell"><div class="v streak">0</div><div class="l">Streak</div></div>
      </div>
      <div class="batterup"><div class="bcard"><div class="who"></div><div class="line"></div></div><div class="bextra"></div><button class="btn" data-a="batterReady">${icon('play')}Ready</button></div>
      <div class="meter"><div class="bar"><div class="tick"></div><div class="mark"></div></div><div class="lab"><span>EARLY</span><span>LATE</span></div><div class="txt"></div></div>
      <div class="aimgauge"><span>Aim</span><div class="track"><div class="knob"></div></div><span class="aimlab">CENTER</span></div>
      <button class="buntbtn" data-a="bunt" aria-pressed="false" title="Bunt (B)">${icon('bat')}<span>Bunt</span></button>
      <button class="touchaim l" data-aim="-1" aria-label="Aim left">${icon('chevLeft')}</button><button class="touchaim r" data-aim="1" aria-label="Aim right">${icon('chevRight')}</button>
      <div class="practice panel collapsed">
        <button class="prhead" aria-label="Pitch settings">${icon('sliders')}<span>Pitch</span>${icon('chevDown', 'chev')}</button>
        <div class="prbody">
          <div class="pt"></div>
          <div class="spd"><span class="label">Speed</span><span class="sv">85 mph</span></div>
          <input type="range" min="${CONFIG.modes.practice.speedMin}" max="${CONFIG.modes.practice.speedMax}" value="${CONFIG.modes.practice.speedDefault}" aria-label="Pitch speed" />
          <div class="seg loc"><button data-loc="random" class="on">Any</button><button data-loc="center">Middle</button><button data-loc="edges">Edges</button></div>
        </div>
      </div>
      <div class="flash"></div>`;
    r.appendChild(hud);
    this.hud = hud;
    this.q = {
      pitchinfo: $(hud, '.pitchinfo'), banner: $(hud, '.banner'), callout: $(hud, '.callout'), meter: $(hud, '.meter'), hint: $(hud, '.hint'),
      derby: $(hud, '.derbybox'), bug: $(hud, '.bug'), tag: $(hud, '.batter-tag'), practice: $(hud, '.practice'), flash: $(hud, '.flash'),
      aimKnob: $(hud, '.aimgauge .knob'), aimLab: $(hud, '.aimlab'), aimGauge: $(hud, '.aimgauge'), batterUp: $(hud, '.batterup'),
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
    $(hud, '.practice .prhead').addEventListener('click', () => this.q.practice.classList.toggle('collapsed'));
    for (const el of hud.querySelectorAll('.practice, .hudbtns, .batterup, .buntbtn')) el.addEventListener('pointerdown', (e) => e.stopPropagation());

    // ---------------- toast + rotate hint
    this.toastEl = h('div', 'toast');
    r.appendChild(this.toastEl);
    this.rotateEl = h('div', 'rotate', `<div class="ph">${icon('phone')}</div><div class="ttl">Rotate phone</div><button class="btn small ghost" data-a="dismissRotate">Play anyway</button>`);
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
    // who is driving the menus: the keyboard (focus follows the screens) or a mouse / finger (no focus rings)
    window.addEventListener('keydown', (e) => { if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) this.keyboard = true; }, true);
    window.addEventListener('pointerdown', () => { this.keyboard = false; }, true);
  }

  // ---------------------------------------------------------------- screens
  makeScreen(name, dim = true) {
    const s = h('div', 'screen' + (dim ? ' dim' : ''));
    this.root.appendChild(s);
    this.screens[name] = s;
    return s;
  }
  // An empty screen ready to be filled. If it is already on screen (a setting was tapped) it is
  // rebuilt without replaying the entrance animation, so nothing flickers.
  fresh(name, dim = true) {
    const s = this.screens[name] || this.makeScreen(name, dim);
    s.classList.toggle('still', s.classList.contains('show'));
    // remember which control had keyboard focus, so the rebuilt screen can give it back (refocus)
    const a = document.activeElement;
    this.focusSel = a && s.contains(a) ? focusSelector(a) : null;
    s.innerHTML = '';
    return s;
  }
  refocus(s) {
    if (!this.focusSel) return;
    const el = s.querySelector(this.focusSel);
    this.focusSel = null;
    if (el) el.focus({ preventScroll: true });
  }
  show(name) {
    for (const [k, s] of Object.entries(this.screens)) {
      s.classList.toggle('show', k === name);
      if (k !== name) s.classList.remove('still');
    }
    this.current = name;
    this.moveFocus(this.screens[name]);
  }
  hideAll() {
    for (const s of Object.values(this.screens)) { s.classList.remove('show'); s.classList.remove('still'); }
    this.current = null;
    this.moveFocus(null);
  }
  // Focus never stays on a button of a screen that has gone (Enter would press it). Someone using the keyboard gets the
  // first button of the new screen focused, so they can carry on without the mouse.
  moveFocus(screen) {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (a && a !== document.body && a.closest && a.closest('.screen') && a.closest('.screen') !== screen) a.blur();
    if (screen && this.keyboard) {
      const first = screen.querySelector('button:not([disabled]), input, [tabindex="0"]');
      if (first && !(document.activeElement && screen.contains(document.activeElement))) first.focus({ preventScroll: true });
    }
  }
  overlay(name, on) { const s = this.screens[name]; if (s) s.classList.toggle('show', on); }

  // Clicks on a setting inside a screen. Returns true when it handled one.
  settingClick(e, inPlace = true) {
    const sw = e.target.closest('.switch[data-set]');
    if (sw) {
      const v = !sw.classList.contains('on');
      if (inPlace) { sw.classList.toggle('on', v); sw.setAttribute('aria-checked', v ? 'true' : 'false'); }
      this.act('setting', { key: sw.dataset.set, value: v });
      return true;
    }
    const seg = e.target.closest('.seg button');
    if (seg && seg.parentNode.dataset.set) {
      const p = seg.parentNode;
      let v = seg.dataset.v;
      if (p.dataset.bool) v = v === 'true';
      if (inPlace) for (const b of p.children) { b.classList.toggle('on', b === seg); if (b.hasAttribute('aria-checked')) b.setAttribute('aria-checked', b === seg ? 'true' : 'false'); }
      this.act('setting', { key: p.dataset.set, value: v });
      return true;
    }
    return false;
  }
  backHead(title, extra = '') {
    return `<div class="head"><button class="iconbtn" data-a="back" aria-label="Back">${icon('back')}</button><h1 class="ttl">${title}</h1><span class="spacer"></span>${extra}</div>`;
  }

  // ---------------- title
  buildTitle() {
    const s = this.fresh('title', false);
    const stack = h('div', 'title-stack rise');
    stack.innerHTML = `<h1 class="logo">${logoSVG({ id: 'title' })}</h1>
      <div class="col actions">
        <button class="btn wide" data-a="play">${icon('play')}Play ball</button>
        <div class="row"><button class="btn small ghost" data-a="howto">${icon('help')}How to play</button><button class="btn small ghost" data-a="locker">${icon('shirt')}Locker</button><button class="btn small ghost" data-a="career">${icon('chart')}Career</button><button class="btn small ghost" data-a="settings">${icon('gear')}Settings</button></div>
      </div>`;
    s.appendChild(stack);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
  }

  // ---------------- mode select
  buildModes(prog) {
    const s = this.fresh('modes');
    const st = prog.settings;
    const hs = prog.data.high;
    const c = prog.data.career;
    const q = hs.quick[st.difficulty];
    const derbyBest = hs.derby[st.difficulty] || 0;
    const modes = [
      { mode: 'quick', ic: 'ball', title: 'Quick Game', chips: ['3 innings', 'vs CPU'], best: q ? `Best ${q.runs}–${q.against}` : '' },
      { mode: 'derby', ic: 'bolt', title: 'Home Run Derby', chips: ['10 outs', 'Homers only'], best: derbyBest ? `Best ${derbyBest} HR` : '' },
      { mode: 'practice', ic: 'target', title: 'Practice', chips: ['Pick the pitch', 'Timing meter'], best: c.practiceSwings ? `${c.practiceSwings} swings` : '' },
    ];
    const seg = (key, items, cur) => `<div class="seg" data-set="${key}">${items.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const prev = s.querySelector('.menu-wrap');
    const wrap = h('div', 'menu-wrap rise');
    wrap.innerHTML = `
      ${this.backHead('Play', `<button class="iconbtn" data-a="howto" aria-label="How to play" title="How to play">${icon('help')}</button><button class="iconbtn" data-a="settings" aria-label="Settings" title="Settings">${icon('gear')}</button>`)}
      <div class="cards">
        ${modes.map((m) => `<button class="card" data-a="start" data-mode="${m.mode}"><span class="go">${icon('chevRight')}</span><span class="ico">${icon(m.ic)}</span><span class="cbody"><h3>${m.title}</h3><span class="chips">${m.chips.map((x) => `<span class="chip">${x}</span>`).join('')}</span></span><span class="best ${m.best ? '' : 'none'}">${m.best || 'New'}</span></button>`).join('')}
      </div>
      <div class="opts panel">
        <div class="grp"><span class="label">Level</span>${seg('difficulty', DIFFICULTIES.map((d) => [d, CONFIG.difficulty[d].label]), st.difficulty)}</div>
        <div class="grp"><span class="label">Time</span>${seg('tod', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], st.tod)}</div>
        <div class="grp"><span class="label">Bats</span>${seg('hand', [['auto', 'Mixed'], ['R', 'Right'], ['L', 'Left']], st.hand)}</div>
      </div>`;
    s.appendChild(wrap);
    if (prev) wrap.scrollTop = prev.scrollTop;
    this.refocus(s);
    s.onclick = (e) => {
      if (this.settingClick(e, true)) return;
      const b = e.target.closest('[data-a]');
      if (b) this.act(b.dataset.a, { mode: b.dataset.mode });
    };
  }

  // ---------------- how to play
  buildHowTo(onDone) {
    const s = this.fresh('howto');
    const touch = document.body.classList.contains('touch');
    const d = h('div', 'howto panel rise');
    const key = (keys, label) => `<span class="key">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}${label}</span>`;
    d.innerHTML = `
      <div class="head"><h1 class="ttl">How to play</h1></div>
      <div class="steps">
        <div class="step"><span class="n">1</span><svg class="pic" viewBox="0 0 120 70"><circle cx="24" cy="30" r="9" fill="#e0ac82"/><rect x="15" y="40" width="18" height="24" rx="7" fill="#e8ecf5"/><path d="M36 30 Q60 12 88 34" stroke="#ffb52e" stroke-width="2" fill="none" stroke-dasharray="4 4"/><circle cx="96" cy="38" r="6" fill="#fff" stroke="#c62828" stroke-width="1.5"/></svg><h4>Watch</h4><p>The pitch</p></div>
        <div class="step"><span class="n">2</span><svg class="pic" viewBox="0 0 120 70"><rect x="38" y="6" width="44" height="44" rx="6" fill="rgba(255,255,255,.08)" stroke="#fff" stroke-dasharray="4 3"/><circle cx="60" cy="28" r="6" fill="#fff" stroke="#c62828" stroke-width="1.5"/><rect x="32" y="54" width="56" height="12" rx="6" fill="#ffb52e"/><text x="60" y="63" text-anchor="middle" font-size="9" font-weight="800" fill="#1b1204">SWING</text></svg><h4>Swing</h4><p>At the plate</p></div>
        <div class="step"><span class="n">3</span><svg class="pic" viewBox="0 0 120 70"><path d="M60 64 L12 12 M60 64 L108 12" stroke="#fff" stroke-width="2" opacity=".55"/><path d="M60 62 L40 22" stroke="#ffb52e" stroke-width="4" stroke-linecap="round"/><path d="M60 62 L80 22" stroke="#ffb52e" stroke-width="4" stroke-linecap="round" opacity=".45"/><circle cx="60" cy="64" r="4" fill="#fff"/></svg><h4>Aim</h4><p>${touch ? 'Arrow buttons' : 'Hold A or D'}</p></div>
      </div>
      <div class="keys">${touch ? key(['Tap'], 'Swing') + key(['◀', '▶'], 'Aim') : key(['Space'], 'Swing') + key(['A', 'D'], 'Aim') + key(['B'], 'Bunt') + key(['Z'], 'Zone') + key(['M'], 'Mute') + key(['Esc'], 'Pause')}</div>
      <div class="row"><button class="btn" data-a="howtoDone">${icon('check')}Got it</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) { this.act('howtoDone'); if (onDone) onDone(); } };
  }

  // ---------------- pause
  buildPause(st) {
    const s = this.fresh('pause');
    const d = h('div', 'dialog panel pause rise');
    const sw = (key, ic, label, on) => `<div class="setrow"><span class="nm">${icon(ic)}${label}</span><button class="switch ${on ? 'on' : ''}" data-set="${key}" data-bool="1" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${label}"></button></div>`;
    d.innerHTML = `<h2>Paused</h2>
      <button class="btn" data-a="resume">${icon('play')}Resume</button>
      <div class="setgrid">
        ${sw('zone', 'zone', 'Strike zone', st.zone)}
        ${sw('pitchGuide', 'guide', 'Pitch guide', st.pitchGuide)}
        ${sw('landingRing', 'landing', 'Landing ring', st.landingRing)}
        ${sw('sound', 'soundOn', 'Sound', st.sound)}
      </div>
      <div class="row"><button class="btn small ghost" data-a="settingsPause">${icon('gear')}Settings</button><button class="btn small ghost" data-a="howtoPause">${icon('help')}Help</button></div>
      <div class="row"><button class="btn small ghost" data-a="restart" data-confirm="Restart?">${icon('restart')}Restart</button><button class="btn small ghost warn" data-a="quit" data-confirm="Quit game?">${icon('home')}Quit</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => {
      if (this.settingClick(e, true)) return;
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.confirm && !this.confirmed(b)) return;
      this.act(b.dataset.a);
    };
  }

  // A button that loses something (quit, restart, reset) takes two taps: the first arms it ("Sure?"), the second does it.
  // Returns true on the second tap.
  confirmed(b) {
    if (b.classList.contains('armed')) return true;
    for (const x of this.root.querySelectorAll('.armed')) this.disarm(x);
    b.dataset.label = b.innerHTML;
    b.classList.add('armed');
    b.innerHTML = `${icon('check')}${b.dataset.confirm}`;
    clearTimeout(b._armT);
    b._armT = setTimeout(() => this.disarm(b), 3000);
    return false;
  }
  disarm(b) {
    if (!b.classList.contains('armed')) return;
    b.classList.remove('armed');
    if (b.dataset.label) b.innerHTML = b.dataset.label;
  }

  // ---------------- settings (from the title, the Play screen or the pause menu)
  buildSettings(st) {
    const s = this.fresh('settings');
    const d = h('div', 'settings panel rise');
    const sw = (key, ic, label, on) => `<div class="setrow"><span class="nm">${icon(ic)}${label}</span><button class="switch ${on ? 'on' : ''}" data-set="${key}" data-bool="1" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${label}"></button></div>`;
    const seg = (key, ic, label, items, cur) => `<div class="setrow stack"><span class="nm">${icon(ic)}${label}</span><div class="seg" data-set="${key}" role="radiogroup" aria-label="${label}">${items.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}" role="radio" aria-checked="${cur === v ? 'true' : 'false'}">${l}</button>`).join('')}</div></div>`;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const slider = (key, ic, label, v) => `<div class="setrow slide"><span class="nm">${icon(ic)}${label}</span><input type="range" min="0" max="100" step="5" value="${Math.round(v * 100)}" data-slide="${key}" aria-label="${label}"><span class="val">${pct(v)}</span></div>`;
    const lag = st.inputDelayMs || 0;
    d.innerHTML = `${this.backHead('Settings', `<button class="iconbtn" data-a="credits" aria-label="Credits" title="Credits">${icon('info')}</button>`)}
      <div class="label">Sound</div>
      <div class="setgrid">
        ${slider('volume', 'soundOn', 'Master', st.volume)}
        ${slider('sfxVolume', 'bat', 'Effects', st.sfxVolume)}
        ${slider('umpireVolume', 'mic', 'Umpire', st.umpireVolume)}
        ${slider('crowdVolume', 'crowd', 'Crowd', st.crowdVolume)}
        ${seg('umpire', 'mic', 'Umpire voice', [['on', 'On'], ['off', 'Off']], st.umpire === 'off' ? 'off' : 'on').replace('setrow stack', 'setrow wide')}
      </div>
      <div class="label">Game</div>
      <div class="setgrid">
        ${seg('difficulty', 'star', 'Level', DIFFICULTIES.map((k) => [k, CONFIG.difficulty[k].label]), st.difficulty)}
        ${seg('hand', 'bat', 'Bats', [['auto', 'Mixed'], ['R', 'Right'], ['L', 'Left']], st.hand)}
        ${seg('tod', 'sun', 'Time', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], st.tod)}
        ${sw('zone', 'zone', 'Strike zone', st.zone)}
        ${sw('pitchGuide', 'guide', 'Pitch guide', st.pitchGuide)}
        ${sw('landingRing', 'landing', 'Landing ring', st.landingRing)}
      </div>
      <div class="label">Controls &amp; screen</div>
      <div class="setgrid">
        <div class="setrow slide"><span class="nm">${icon('timing')}Swing delay</span><input type="range" min="0" max="${CONFIG.timing.inputDelayMaxMs}" step="${CONFIG.timing.inputDelayStepMs}" value="${lag}" data-slide="inputDelayMs" data-unit="ms" aria-label="Swing delay"><span class="val">${lag} ms</span></div>
        ${sw('shake', 'shake', 'Shake', st.shake)}
        ${sw('flashes', 'flash', 'Flashes', st.flashes)}
      </div>
      <div class="row foot"><button class="btn small ghost warn" data-a="resetStats" data-confirm="Erase stats?">${icon('trash')}Reset stats</button></div>`;
    s.appendChild(d);
    this.refocus(s);
    for (const r of d.querySelectorAll('input[data-slide]')) {
      const out = r.parentNode.querySelector('.val');
      const unit = r.dataset.unit;
      const value = () => (unit ? +r.value : +r.value / 100);
      r.addEventListener('input', () => {
        out.textContent = unit ? `${r.value} ${unit}` : `${r.value}%`;
        this.act('setting', { key: r.dataset.slide, value: value(), live: true });
      });
      r.addEventListener('change', () => this.act('settingDone', { key: r.dataset.slide, value: value() }));
    }
    s.onclick = (e) => {
      if (this.settingClick(e, true)) return;
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.confirm && !this.confirmed(b)) return;
      this.act(b.dataset.a);
    };
  }

  // ---------------- credits
  buildCredits(recordings) {
    const s = this.fresh('credits');
    const d = h('div', 'credits panel rise');
    const rows = [
      ['Game', 'Sandlot'],
      ['3D engine', 'three.js'],
      ['three.js license', 'MIT · © 2010–2025 three.js authors'],
      ['Built with', 'Vite'],
      ['Players, ballpark, crowd', 'Drawn in code'],
      ['Sound', 'Synthesized live in your browser'],
      ['Umpire', recordings ? 'Recorded calls' : 'Signals only'],
    ];
    d.innerHTML = `${this.backHead('Credits')}
      <div class="mini-logo">${logoSVG({ id: 'credits', swoosh: false })}</div>
      <dl class="credit-list">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    s.appendChild(d);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
  }

  // ---------------- computer's half-inning
  showSummary(data, teamName, lineStart = 0.55) {
    const s = this.fresh('summary');
    const d = h('div', 'summary panel rise');
    d.innerHTML = `<div class="label">Bottom ${data.inning}</div><h2>${teamName}</h2><div class="lines"></div><div class="total"></div><div class="row"><button class="btn small ghost" data-a="skipSummary">${icon('ff')}Skip</button></div>`;
    s.appendChild(d);
    const lines = $(d, '.lines');
    data.events.forEach((ev, i) => {
      const ln = h('div', 'ln' + (ev.runs > 0 ? ' run' : ''), ev.text + (ev.runs > 0 ? ` <b>+${ev.runs}</b>` : ''));
      lines.appendChild(ln);
      setTimeout(() => ln.classList.add('show'), 250 + i * lineStart * 1000);
    });
    const tot = $(d, '.total');
    setTimeout(() => { tot.textContent = data.runs > 0 ? `${data.runs} run${data.runs > 1 ? 's' : ''}` : 'No runs'; }, 250 + data.events.length * lineStart * 1000);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
    this.overlay('summary', true);
  }
  hideSummary() { this.overlay('summary', false); }

  // ---------------- game over
  showGameOver(p, records, unlocked, teamNames) {
    const s = this.fresh('over');
    const d = h('div', 'over panel rise');
    const st = p.stats;
    let head = '', table = '', grid = '';
    if (p.mode === 'quick') {
      const g = p.game;
      const win = p.won;
      head = `<div class="label">${p.game.walkOff ? 'Walk-off' : 'Final'}</div><div class="result ${win ? 'win' : 'loss'}">${headline(win ? 'YOU WIN' : 'YOU LOSE', win ? 'gold' : 'red')}</div>`;
      const n = Math.max(g.line.top.length, 3);
      let hdr = '<tr><th></th>' + Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('') + '<th>R</th><th>H</th></tr>';
      const row = (name, ab, arr, R, H) => `<tr><td class="tn"><span class="full">${name}</span><span class="ab">${ab}</span></td>` + Array.from({ length: n }, (_, i) => `<td>${arr[i] === undefined ? '' : arr[i]}</td>`).join('') + `<td class="r">${R}</td><td>${H}</td></tr>`;
      table = `<table class="linescore">${hdr}${row(teamNames.away, teamNames.awayAbbr, g.line.top, g.score.top, g.hits.top)}${row(teamNames.home, teamNames.homeAbbr, g.line.bottom, g.score.bottom, g.hits.bottom)}</table>`;
      grid = [[avgText(st.hits, st.ab), 'AVG'], [`${st.hits}/${st.ab}`, 'Hits'], [st.hr, 'HR'], [st.rbi, 'RBI'], [st.perfect, 'Perfect'], [st.longestHR ? st.longestHR + ' ft' : '--', 'Longest'], [st.maxEV ? Math.round(st.maxEV) + ' mph' : '--', 'Exit velo'], [`${st.strikeouts} / ${st.walks}`, 'K / BB']];
    } else if (p.mode === 'derby') {
      const d2 = p.derby;
      head = `<div class="label">Derby</div><div class="result win">${headline(`${d2.hr} HOME RUN${d2.hr === 1 ? '' : 'S'}`, 'gold')}</div>`;
      grid = [[d2.hr, 'HR'], [d2.longest ? d2.longest + ' ft' : '--', 'Longest'], [d2.bestStreak, 'Streak'], [st.perfect, 'Perfect'], [st.maxEV ? Math.round(st.maxEV) + ' mph' : '--', 'Exit velo'], [`${Math.round(100 * d2.hr / Math.max(1, st.swings))}%`, 'HR rate'], [st.swings, 'Swings'], [st.whiffs, 'Misses']];
    }
    d.innerHTML = `${head}${table}<div class="statgrid">${grid.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <div class="badges">${records.map((r) => `<span class="badge">${icon('star')}${r}</span>`).join('')}${unlocked.map((u) => `<span class="badge unlock">${icon('unlock')}${u.name}</span>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn" data-a="playAgain">${icon('play')}Again</button><button class="btn ghost" data-a="quit">${icon('home')}Menu</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
    this.show('over');
  }

  // ---------------- locker
  buildLocker(prog) {
    const s = this.fresh('locker');
    const d = h('div', 'locker panel rise');
    const eq = prog.data.equipped;
    const mk = (kind, key, name, sw) => {
      const un = prog.isUnlocked(kind, key);
      const on = (kind === 'bats' ? eq.bat : eq.uniform) === key;
      return `<button class="item ${un ? '' : 'locked'} ${on ? 'equipped' : ''}" data-kind="${kind}" data-key="${key}"><div class="sw" style="background:${sw}"></div><div class="n">${name}</div><div class="h">${un ? '' : icon('lock') + prog.lockedHint(kind, key)}</div>${on ? `<span class="tick">${icon('check')}</span>` : ''}</button>`;
    };
    const batSw = { ash: 'linear-gradient(90deg,#c9a066,#a97f45)', maple: 'linear-gradient(90deg,#efdcae,#d8bf88)', cherry: 'linear-gradient(90deg,#a03222,#6c1a10)', midnight: 'linear-gradient(90deg,#26262a,#0c0c0e)', golden: 'linear-gradient(90deg,#ffd75e,#c9962b)', neon: 'linear-gradient(90deg,#22d3ee,#0ea5c9)', sunset: 'linear-gradient(90deg,#f97316,#ec4899)', carbon: 'linear-gradient(90deg,#3b4756,#1c232d)' };
    d.innerHTML = `${this.backHead('Locker')}<div class="label">Bats</div><div class="grid">${Object.entries(BATS).map(([k, v]) => mk('bats', k, v.label, batSw[k])).join('')}</div>
      <div class="label">Uniforms</div><div class="grid">${Object.entries(UNIFORMS).map(([k, v]) => mk('uniforms', k, v.label, `linear-gradient(90deg, ${v.primary} 55%, ${v.secondary} 55%, ${v.secondary} 75%, ${v.trim} 75%)`)).join('')}</div>`;
    s.appendChild(d);
    this.refocus(s);
    s.onclick = (e) => {
      const it = e.target.closest('.item');
      if (it) { if (!it.classList.contains('locked')) this.act('equip', { kind: it.dataset.kind, id: it.dataset.key }); return; }
      const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a);
    };
  }

  buildCareer(prog) {
    const s = this.fresh('career');
    const c = prog.data.career;
    const d = h('div', 'locker panel rise');
    const cells = [[avgText(c.hits, c.ab), 'AVG'], [c.hits, 'Hits'], [c.hr, 'HR'], [c.longestHR ? c.longestHR + ' ft' : '--', 'Longest HR'], [c.maxEV ? Math.round(c.maxEV) + ' mph' : '--', 'Exit velo'], [c.perfects, 'Perfect'], [`${c.wins}/${c.games}`, 'Wins'], [c.derbyBestHR, 'Derby best'], [c.derbyBestStreak, 'HR streak'], [c.rbi, 'RBI'], [c.strikeouts, 'Strikeouts'], [c.practiceSwings, 'Practice']];
    d.innerHTML = `${this.backHead('Career', `<button class="btn small ghost warn" data-a="resetStats" data-confirm="Erase stats?">${icon('trash')}Reset</button>`)}<div class="statgrid">${cells.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>`;
    s.appendChild(d);
    this.refocus(s);
    s.onclick = (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.confirm && !this.confirmed(b)) return;
      this.act(b.dataset.a);
    };
  }

  // ---------------------------------------------------------------- HUD updates
  showHud(mode) {
    this.hud.classList.add('show');
    this.hud.dataset.mode = mode; // the style sheet decides what each mode shows
    if (mode === 'practice') this.q.practice.classList.toggle('collapsed', smallScreen());
  }
  hideHud() {
    this.hud.classList.remove('show');
    for (const k of ['banner', 'meter', 'callout', 'pitchinfo', 'hint', 'batterUp']) this.q[k].classList.remove('show');
  }

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
  setBatter(b) { this.q.tag.innerHTML = b ? `<b>#${b.number}</b>${b.name}` : ''; }
  // The next batter's card and the Ready button (the pitcher waits for it). line = today's { ab, h, hr, rbi, bb }; info = extra chips.
  showBatterUp(b, line, info = []) {
    const el = this.q.batterUp;
    el.querySelector('.who').innerHTML = `<b>#${b.number}</b>${b.name}${b.pos ? `<span class="pos">${b.pos}</span>` : ''}`;
    const today = !line || !line.pa ? 'First at-bat' : [`${line.h} for ${line.ab}`, line.hr ? `${line.hr} HR` : '', line.rbi ? `${line.rbi} RBI` : '', line.bb ? `${line.bb} BB` : ''].filter(Boolean).join(' · ');
    el.querySelector('.line').textContent = today;
    el.querySelector('.bextra').innerHTML = info.map((c) => `<span class="chip">${c}</span>`).join('');
    el.classList.add('show');
    this.hideTiming(); // (the last swing's meter belongs to the previous batter)
  }
  hideBatterUp() { this.q.batterUp.classList.remove('show'); }
  setBunt(on) { const b = this.hud.querySelector('.buntbtn'); b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
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
    // the home-run celebration is drawn in the logo's letters (the same on every device); anything else is text
    const art = cls === 'hr' ? wordSVG(big, { id: 'hr' + (this.artN = (this.artN || 0) + 1) }) : null;
    if (art) el.querySelector('.big').innerHTML = art; else el.querySelector('.big').textContent = big;
    el.querySelector('.sub').textContent = sub;
    void el.offsetWidth;
    el.classList.add('show');
  }
  hideBanner() { this.q.banner.classList.remove('show'); }
  callout(items, ms = 3200) {
    const el = this.q.callout;
    this.hideHint();
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
    if (this.noFlashes) return;
    const f = this.q.flash;
    f.style.transition = 'none'; f.style.opacity = String(a); void f.offsetWidth;
    f.style.transition = `opacity ${ms * 2}ms ease-out`; f.style.opacity = '0';
  }
  setMuteIcon(muted) { const b = this.hud.querySelector('[data-a=mute]'); if (b) b.innerHTML = icon(muted ? 'soundOff' : 'soundOn'); }
  toast(text, ms = 2600, ic = '') {
    this.toastEl.innerHTML = ic ? icon(ic) : '';
    this.toastEl.appendChild(document.createTextNode(text));
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
