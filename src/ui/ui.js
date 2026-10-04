// All menus and on-screen overlays (title, mode select, HUD, pause, summaries...). Plain DOM, no libraries.
import { CONFIG, DIFFICULTIES } from '../config.js';
import { UNIFORMS, BATS } from '../game/teams.js';
import { UNLOCKS, unlockKey } from '../game/progression.js';
import { logoSVG, wordSVG } from './logo.js';
import * as SEA from '../game/season.js';
import { MLB_TEAMS, teamById, teamName, starsOf, leagueFor, lum } from '../game/mlb.js';

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
  go: '<path d="M5 6.5l5.5 5.5L5 17.5M12.5 6.5L18 12l-5.5 5.5"/>',
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
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.9-2.8 2.1 0 2.8 5.8 1.4 5.8 4.2 0 1.2-1.3 2.1-3 2.1-1.3 0-2.4-.6-2.9-1.5M12 6v1.8M12 16.2V18"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.7c1.6.6 2.7 2.2 3 4.8"/>',
  cart: '<path d="M3.5 4.5h2.2l2.2 10.2h10.4l1.9-7.2H6.6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  swap: '<path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fullExit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
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

const PITCH_LABEL = { fastball: 'Fastball', changeup: 'Changeup', curveball: 'Curveball', slider: 'Slider', heater: 'Heater', sinker: 'Sinker', cutter: 'Cutter', splitter: 'Splitter', mixed: 'Mixed' };
const avgText = (hits, ab) => (ab > 0 ? (hits / ab).toFixed(3).replace(/^0/, '') : '.000');
const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
// each runner's colour on the runner panel and the diamond (batter, first, second, third)
const RUNNER_COLORS = ['#ffffff', '#45d4ff', '#ff9a3c', '#a6ff4d'];

// a team's strength as 1-5 stars
const stars = (rating, bare = false) => {
  const n = Math.max(1, Math.min(5, Math.round(((rating ?? 50) - 22) / 8)));
  const st = `<span class="stars" aria-label="${n} of 5">${'<b>★</b>'.repeat(n)}${'<i>★</i>'.repeat(5 - n)}</span>`;
  return bare ? st : `<span class="chip">${st}</span>`;
};
const tierStars = (tier) => `<span class="stars" aria-label="${tier} of 5">${'<b>★</b>'.repeat(tier)}${'<i>★</i>'.repeat(5 - tier)}</span>`;
// a team's badge: its colours and its letters
const crest = (t, size = '') => `<span class="crest ${size} ${lum(t.color) > 0.62 ? 'light' : ''}" style="--c:${t.color};--c2:${t.color2 || '#ffffff'}">${t.abbr}</span>`;
// a player's Contact / Power / Speed, each with a little bar (the words are spelled out in the column heads)
const ratingCells = (p) => ['con', 'pow', 'spd'].map((k) => `<span class="rt ${p[k] >= 70 ? 'hi' : p[k] <= 40 ? 'lo' : ''}" title="${{ con: 'Contact', pow: 'Power', spd: 'Speed' }[k]}">${p[k]}<i style="--v:${p[k]}%"></i></span>`).join('');
const ratingHead = '<span class="rt">Contact</span><span class="rt">Power</span><span class="rt">Speed</span>';
// a pitcher's Velocity / Control / Stuff / Stamina, the same way
const PK = { vel: 'Velocity', ctl: 'Control', stf: 'Stuff', sta: 'Stamina' };
const pitchCells = (p) => Object.keys(PK).map((k) => `<span class="rt ${p[k] >= 70 ? 'hi' : p[k] <= 40 ? 'lo' : ''}" title="${PK[k]}">${p[k]}<i style="--v:${p[k]}%"></i></span>`).join('');
const pitchHead = Object.values(PK).map((l) => `<span class="rt">${l}</span>`).join('');
// innings pitched from outs (12.1), earned run average
const ipText = (outs) => `${Math.floor((outs || 0) / 3)}.${(outs || 0) % 3}`;
const eraText = (er, outs) => (outs > 0 ? ((er * 27) / outs).toFixed(2) : '-.--');
const throwsText = (p) => (p.hand === 'L' ? 'Throws L' : 'Throws R');
// the Hitters / Pitchers switch above the roster and the shop
const tabsHtml = (key, cur, nPitch) => `<div class="seg tabs" data-tabs="${key}"><button data-tab="hit" class="${cur === 'hit' ? 'on' : ''}">Hitters</button><button data-tab="pit" class="${cur === 'pit' ? 'on' : ''}">Pitchers${nPitch ? ' · ' + nPitch : ''}</button></div>`;
const artUrl = (name) => { let base = '/'; try { base = (import.meta.env && import.meta.env.BASE_URL) || '/'; } catch (e) { /* tests */ } return `url('${base}art/${name}.jpg')`; };
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
      <div class="hudbtns"><button class="iconbtn" data-a="pause" aria-label="Pause" title="Pause (Esc)">${icon('pause')}</button><button class="iconbtn" data-a="mute" aria-label="Sound" title="Mute (M)">${icon('soundOn')}</button><button class="iconbtn" data-a="fullscreen" data-fs aria-label="Full screen" title="Full screen (F)">${icon('full')}</button></div>
      <div class="lineup"><div class="lh"><span>Batting order</span></div><ol></ol></div>
      <div class="pitchinfo"><span class="cnt"></span><span class="type"></span><span class="mph"></span></div>
      <div class="banner"><div class="big"></div><div class="sub"></div></div>
      <div class="callout"></div>
      <div class="hint"></div>
      <div class="bugwrap">
        <div class="batter-tag"></div>
        <div class="pitchtag"><div class="pt1"><b class="pn"></b><span class="pc"></span></div><div class="stam"><i></i></div></div>
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
      <div class="practbox">
        <div class="cell"><div class="v runs">0</div><div class="l">Runs</div></div>
        <div class="cell"><div class="v hits">0</div><div class="l">Hits</div></div>
        <div class="cell"><div class="v hr">0</div><div class="l">HR</div></div>
        <div class="cell pp"><div class="v np">0</div><div class="l">Pitches</div></div>
        <div class="cell pp"><div class="v nk">0</div><div class="l">K</div></div>
        <div class="cell pp"><div class="v nbb">0</div><div class="l">BB</div></div>
        <div class="cell pp"><div class="v nh">0</div><div class="l">H</div></div>
        <svg class="diamond" viewBox="0 0 60 60"><rect class="base b2" x="21" y="4" width="18" height="18" transform="rotate(45 30 13)"/><rect class="base b3" x="3" y="22" width="18" height="18" transform="rotate(45 12 31)"/><rect class="base b1" x="39" y="22" width="18" height="18" transform="rotate(45 48 31)"/></svg>
      </div>
      <div class="derbybox">
        <div class="cell"><div class="v hr">0</div><div class="l">HR</div></div>
        <div class="cell"><div class="v red outs">10</div><div class="l">Outs left</div></div>
        <div class="cell"><div class="v longest">--</div><div class="l">Longest</div></div>
        <div class="cell"><div class="v streak">0</div><div class="l">Streak</div></div>
      </div>
      <div class="batterup"><div class="bcard"><div class="who"></div><div class="line"></div></div><div class="bextra"></div><button class="btn" data-a="batterReady">${icon('play')}Ready</button></div>
      <div class="meter"><div class="bar"><div class="tick"></div><div class="mark"></div></div><div class="lab"><span>EARLY</span><span>LATE</span></div><div class="txt"></div></div>
      <button class="swingbtn" data-swing aria-label="Swing">${icon('bat')}<span>Swing</span></button>
      <div class="basepad" aria-label="Runners">
        <svg class="bpfield" viewBox="0 0 160 160" aria-hidden="true"><path class="lines" d="M80 140 L140 80 L80 20 L20 80 Z"/></svg>
        <button class="bpbase" data-base="1" tabindex="-1" aria-label="1st"></button><button class="bpbase" data-base="2" tabindex="-1" aria-label="2nd"></button><button class="bpbase" data-base="3" tabindex="-1" aria-label="3rd"></button><button class="bpbase home" data-base="4" tabindex="-1" aria-label="Home"></button>
        <svg class="bpfield bpover" viewBox="0 0 160 160" aria-hidden="true"><g class="dots"></g></svg>
        <svg class="bpfield bphits" viewBox="0 0 160 160" aria-hidden="true"><g class="hits"></g></svg>
      </div>
      <button class="ffbtn" data-a="fast" aria-pressed="false" title="Speed up (Space)">${icon('ff')}<span>Fast</span></button>
      <div class="pitchbar" aria-label="Pitches"></div>
      <div class="bullback" data-bb></div><div class="bullpanel" role="dialog" aria-label="Bullpen"><div class="bphead">${icon('swap')}<span>Bullpen</span></div><div class="bplist"></div></div>
      <div class="pitchside"><button class="btn small ghost bullbtn" data-a="bullpen" disabled title="Bullpen">${icon('swap')}<span>Bullpen</span></button><button class="btn small ghost simbtn" data-a="sim" title="Sim this inning">${icon('ff')}<span>Sim</span></button></div>
      <div class="acts"><button class="stealbtn" data-a="steal" aria-pressed="false" title="Steal (S)">${icon('go')}<span>Steal</span></button><button class="buntbtn" data-a="bunt" aria-pressed="false" title="Bunt (B)">${icon('bat')}<span>Bunt</span></button></div>
      <div class="practice panel collapsed">
        <button class="prhead" aria-label="Practice settings">${icon('sliders')}<span>Practice</span>${icon('chevDown', 'chev')}</button>
        <div class="prbody">
          <div class="seg role"><button data-role="bat" class="on">Bat</button><button data-role="pitch">Pitch</button></div>
          <div class="seg bh"><button data-bh="R" class="on">Righty</button><button data-bh="L">Lefty</button></div>
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
      lineup: $(hud, '.lineup'), swingBtn: $(hud, '.swingbtn'), batterUp: $(hud, '.batterup'), basepad: $(hud, '.basepad'),
    };
    // the base diamond (sending runners): a lit base is taken the moment it is touched - the runner behind it goes there
    this.q.basepad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      // (a runner you sent: tap his dot to call him back - the dots' tap areas sit on top of everything)
      const r = e.target.closest('.bphit.canback');
      if (r) { this.act('runnerBack', { from: +r.dataset.from }); return; }
      const b = e.target.closest('.bpbase.open');
      if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 220); this.act('base', { base: +b.dataset.base }); }
    });
    hud.addEventListener('click', (e) => {
      const row = e.target.closest('.bprow[data-id]');
      if (row) { this.closeBullpen(); this.act('bullpenPick', { id: row.dataset.id }); return; }
      if (e.target.closest('[data-bb]')) { this.closeBullpen(); return; }
      const b = e.target.closest('[data-a]');
      if (b && b.dataset.a === 'bullpen' && this.bullpenOpen) { this.closeBullpen(); return; } // (the button again closes it)
      if (b) this.act(b.dataset.a);
    });
    // the Swing button (phones): it swings the moment it is touched (timed from the touch, like a key)
    this.q.swingBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.q.swingBtn.classList.add('on'); this.act('swing', e); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.q.swingBtn.addEventListener(ev, () => this.q.swingBtn.classList.remove('on'));
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
    $(hud, '.practice .role').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.act('practice', { role: b.dataset.role }); });
    $(hud, '.practice .bh').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.act('practice', { batterHand: b.dataset.bh }); });
    $(hud, '.practice .prhead').addEventListener('click', () => this.q.practice.classList.toggle('collapsed'));
    // your pitch choice (labels only): a tap picks it; the buttons never count as a click on the field
    this.q.pitchbar = $(hud, '.pitchbar');
    this.q.pitchbar.addEventListener('click', (e) => { const b = e.target.closest('button[data-type]'); if (b) this.act('pitchSel', { type: b.dataset.type }); });
    for (const el of hud.querySelectorAll('.practice, .hudbtns, .batterup, .acts, .lineup, .ffbtn, .pitchbar, .pitchside, .bullpanel, .bullback')) el.addEventListener('pointerdown', (e) => e.stopPropagation());

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
    // full screen (not offered where the browser has none, e.g. an iPhone)
    this.fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    this.syncFullscreen = () => { this.setFullscreenAvailable(this.fsOk); this.setFullscreenIcon(!!(document.fullscreenElement || document.webkitFullscreenElement)); };
    document.addEventListener('fullscreenchange', this.syncFullscreen);
    document.addEventListener('webkitfullscreenchange', this.syncFullscreen);
    this.syncFullscreen();
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
  backHead(title, extra = '', eyebrow = '') {
    return `<div class="head"><button class="iconbtn" data-a="back" aria-label="Back">${icon('back')}</button><h1 class="ttl">${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}${title}</h1><span class="spacer"></span>${extra}</div>`;
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
    const top = h('div', 'title-top', `<button class="iconbtn" data-a="fullscreen" data-fs aria-label="Full screen" title="Full screen (F)">${icon('full')}</button>`);
    s.appendChild(top);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
    this.syncFullscreen();
  }

  // ---------------- mode select
  buildModes(prog) {
    const s = this.fresh('modes');
    const st = prog.settings;
    const hs = prog.data.high;
    const c = prog.data.career;
    const q = hs.quick[st.difficulty];
    const derbyBest = hs.derby[st.difficulty] || 0;
    const sea = prog.data.season;
    const qg = prog.data.quick;
    const me = sea ? sea.teams[0] : null;
    const tiles = [
      { mode: 'season', cls: 't-league', art: 'league', eyebrow: `${CONFIG.season.innings} innings · Playoffs`, title: 'League', sub: sea ? `Year ${sea.year} · ${me.w}–${me.l} · ${CONFIG.difficulty[sea.level].label}` : 'Pick your team', tag: sea ? (sea.inProgress ? 'Resume' : me.abbr) : 'New', accent: me ? me.color : null, ic: 'trophy' },
      { mode: 'quick', cls: 't-quick', art: 'quick', eyebrow: qg ? 'Game in progress' : '3 innings · vs CPU', title: 'Quick Game', sub: qg ? `${qg.state.game.half === 'top' ? 'Top' : 'Bottom'} ${qg.state.game.inning} · ${qg.state.game.score.top}–${qg.state.game.score.bottom}` : q ? `Best ${q.runs}–${q.against}` : '', tag: qg ? 'Resume' : q ? '' : 'New', ic: 'ball', fresh: !!qg },
      { mode: 'derby', cls: 't-derby', art: 'derby', eyebrow: '10 outs', title: 'Home Run Derby', sub: derbyBest ? `Best ${derbyBest} HR` : '', tag: derbyBest ? '' : 'New', ic: 'bolt' },
      { mode: 'practice', cls: 't-practice', art: 'practice', eyebrow: 'Pick the pitch', title: 'Practice', sub: c.practiceSwings ? `${c.practiceSwings} swings` : '', tag: c.practiceSwings ? '' : 'New', ic: 'target' },
    ];
    const seg = (key, items, cur) => `<div class="seg" data-set="${key}">${items.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const prev = s.querySelector('.play-wrap');
    const wrap = h('div', 'play-wrap rise');
    wrap.innerHTML = `
      ${this.backHead('Play', `<button class="iconbtn" data-a="howto" aria-label="How to play" title="How to play">${icon('help')}</button><button class="iconbtn" data-a="settings" aria-label="Settings" title="Settings">${icon('gear')}</button>`)}
      <div class="tiles">
        ${tiles.map((m) => `<button class="tile ${m.cls}${m.fresh ? ' has-new' : ''}" data-a="start" data-mode="${m.mode}" style="${m.accent ? `--accent:${m.accent};` : ''}"><span class="art" style="background-image:${artUrl(m.art)}"></span>${m.tag ? `<span class="tag ${m.tag === 'New' ? '' : ''}">${m.tag}</span>` : ''}<span class="eyebrow">${m.eyebrow}</span><h3>${m.title}</h3>${m.sub ? `<span class="sub">${m.sub}</span>` : ''}${m.fresh ? `<span class="tilebtn" role="button" tabindex="0" data-a="quickNew" aria-label="New game">${icon('restart')}New</span>` : ''}<span class="go">${icon('chevRight')}</span></button>`).join('')}
      </div>
      <div class="opts">
        <div class="grp"><span class="label">Level <small>Quick · Derby · Practice</small></span>${seg('difficulty', DIFFICULTIES.map((d) => [d, CONFIG.difficulty[d].label]), st.difficulty)}</div>
        <div class="grp"><span class="label">Time</span>${seg('tod', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], st.tod)}</div>
        <div class="grp"><span class="label">Bats</span>${seg('hand', [['auto', 'Mixed'], ['R', 'Right'], ['L', 'Left']], st.hand)}</div>
        <div class="grp"><span class="label">Park</span><div class="cycler"><button data-a="parkPrev" aria-label="Previous park">${icon('chevLeft')}</button><span>${(CONFIG.parks.list[st.park] || CONFIG.parks.list.sandlot).name}</span><button data-a="parkNext" aria-label="Next park">${icon('chevRight')}</button></div></div>
      </div>`;
    s.appendChild(wrap);
    if (prev) wrap.scrollTop = prev.scrollTop;
    this.refocus(s);
    s.onclick = (e) => {
      if (this.settingClick(e, true)) return;
      const b = e.target.closest('[data-a]');
      if (b) this.act(b.dataset.a, { mode: b.dataset.mode || (b.closest('[data-mode]') || {dataset: {}}).dataset.mode });
    };
    s.onkeydown = (e) => { const t = e.target; if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('tilebtn')) { e.preventDefault(); e.stopPropagation(); this.act(t.dataset.a); } };
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
        <div class="step"><span class="n">1</span><svg class="pic" viewBox="0 0 120 70"><rect x="40" y="8" width="40" height="50" fill="rgba(255,255,255,.06)" stroke="#fff" stroke-opacity=".5"/><path d="M18 46 L74 34" stroke="#fff" stroke-opacity=".55" stroke-width="7" stroke-linecap="round"/><circle cx="66" cy="36" r="4.5" fill="none" stroke="#ffe08a" stroke-width="2"/><circle cx="67" cy="30" r="5" fill="#fff" stroke="#c62828" stroke-width="1.2"/></svg><h4>Aim</h4><p>${touch ? 'Drag the bat' : 'Move the mouse'}</p></div>
        <div class="step"><span class="n">2</span><svg class="pic" viewBox="0 0 120 70"><circle cx="26" cy="35" r="11" fill="#fff" stroke="#c62828" stroke-width="1.5"/><path d="M40 30 Q60 8 78 12" stroke="#ffb52e" stroke-width="2.5" fill="none"/><path d="M40 35 L78 35" stroke="#fff" stroke-width="2.5" opacity=".8"/><path d="M40 40 Q58 52 72 60" stroke="#8fb3ff" stroke-width="2.5" fill="none"/><text x="82" y="15" font-size="7.5" font-weight="800" fill="#ffb52e">FLY</text><text x="82" y="38" font-size="7.5" font-weight="800" fill="#fff">LINER</text><text x="76" y="64" font-size="7.5" font-weight="800" fill="#8fb3ff">GROUNDER</text></svg><h4>Contact</h4><p>Under · middle · top</p></div>
        <div class="step"><span class="n">3</span><svg class="pic" viewBox="0 0 120 70"><rect x="14" y="24" width="92" height="10" rx="2" fill="url(#hg)"/><defs><linearGradient id="hg"><stop offset="0" stop-color="#7a2a2a"/><stop offset=".5" stop-color="#3ddc7c"/><stop offset="1" stop-color="#7a2a2a"/></linearGradient></defs><rect x="58" y="18" width="4" height="22" rx="1" fill="#fff"/><rect x="32" y="48" width="56" height="14" rx="7" fill="#ffb52e"/><text x="60" y="58" text-anchor="middle" font-size="9" font-weight="800" fill="#1b1204">${touch ? 'TAP' : 'CLICK'}</text></svg><h4>Swing</h4><p>On time</p></div>
        <div class="step"><span class="n">4</span><svg class="pic" viewBox="0 0 120 70"><path d="M60 64 L88 36 L60 8 L32 36 Z" fill="rgba(255,255,255,.08)" stroke="#fff" stroke-opacity=".55" stroke-width="2"/><rect x="53" y="1" width="14" height="14" transform="rotate(45 60 8)" fill="rgba(255,255,255,.3)" stroke="#fff"/><rect x="81" y="29" width="14" height="14" transform="rotate(45 88 36)" fill="rgba(255,255,255,.3)" stroke="#fff"/><circle cx="76" cy="22" r="4.5" fill="#ffe08a" stroke="#0a1020" stroke-width="1.5"/><path d="M80 18 L70 10" stroke="#ffb52e" stroke-width="2" stroke-dasharray="3 3"/></svg><h4>Run</h4><p>Base: go · Runner: back</p></div>
      </div>
      <div class="keys">${touch ? key(['Drag'], 'Aim') + key(['Swing'], 'Swing') + key(['Base'], 'Send runner') + key(['Runner'], 'Back') : key(['Mouse'], 'Aim') + key(['Click', 'Space'], 'Swing') + key(['Arrows'], 'Aim') + key(['1', '2', '3', 'H'], 'Send runner') + key(['Shift', '1-H'], 'Back') + key(['B'], 'Bunt') + key(['S'], 'Steal') + key(['Z'], 'Zone') + key(['M'], 'Mute') + key(['Esc'], 'Pause')}</div>
      <div class="row"><button class="btn" data-a="howtoDone">${icon('check')}Got it</button></div>`;
    s.appendChild(d);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) { this.act('howtoDone'); if (onDone) onDone(); } };
  }

  // ---------------- pause
  buildPause(st, season = false, saves = season) { // season: a League game (no restart); saves: quitting keeps the game to resume later
    const s = this.fresh('pause');
    const d = h('div', 'dialog panel pause rise');
    // (the four switches are big icon tiles that light up green; they keep the .switch class the rest of the game and the tests use)
    const tg = (key, ic, label, on) => `<button class="switch tgl ${on ? 'on' : ''}" data-set="${key}" data-bool="1" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${label}">${icon(ic)}<span>${label}</span><i class="lamp"></i></button>`;
    d.innerHTML = `<div class="ribbon"><h2>Paused</h2></div>
      <button class="btn big" data-a="resume">${icon('play')}Resume</button>
      <div class="tgls">
        ${tg('zone', 'zone', 'Strike zone', st.zone)}
        ${tg('pitchGuide', 'guide', 'Pitch guide', st.pitchGuide)}
        ${tg('landingRing', 'landing', 'Landing ring', st.landingRing)}
        ${tg('sound', 'soundOn', 'Sound', st.sound)}
      </div>
      <div class="pbtns"><button class="btn small ghost" data-a="settingsPause">${icon('gear')}Settings</button><button class="btn small ghost" data-a="howtoPause">${icon('help')}Help</button>${season ? '' : `<button class="btn small ghost" data-a="restart" data-confirm="Restart?">${icon('restart')}Restart</button>`}<button class="btn small ghost warn" data-a="quit" data-confirm="${saves ? 'Save & quit?' : 'Quit game?'}">${icon('home')}${saves ? 'Save &amp; quit' : 'Quit'}</button></div>`;
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
        ${seg('difficulty', 'star', 'Level · Quick, Derby, Practice', DIFFICULTIES.map((k) => [k, CONFIG.difficulty[k].label]), st.difficulty)}
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
      ['Teams and players', 'Real names and last season\'s numbers · personal use only, not affiliated with MLB'],
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
    // (Skip sits in the header: always on screen, however many lines the inning had)
    d.innerHTML = `<div class="sumhead"><div><div class="label">${data.half === 'top' ? 'Top' : 'Bottom'} ${data.inning}</div><h2>${teamName}</h2></div><button class="btn small" data-a="skipSummary">${icon('ff')}Skip</button></div><div class="lines"></div><div class="total"></div>`;
    s.appendChild(d);
    const lines = $(d, '.lines');
    data.events.forEach((ev, i) => {
      const ln = h('div', 'ln' + (ev.runs > 0 ? ' run' : ''), ev.text + (ev.runs > 0 ? ` <b>+${ev.runs}</b>` : ''));
      lines.appendChild(ln);
      setTimeout(() => { ln.classList.add('show'); lines.scrollTop = lines.scrollHeight; }, 250 + i * lineStart * 1000); // (newest line in view)
    });
    const tot = $(d, '.total');
    setTimeout(() => { tot.textContent = data.runs > 0 ? `${data.runs} run${data.runs > 1 ? 's' : ''}` : 'No runs'; }, 250 + data.events.length * lineStart * 1000);
    s.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
    this.overlay('summary', true);
  }
  hideSummary() { this.overlay('summary', false); }

  // ---------------- game over
  showGameOver(p, records, unlocked, teamNames, seasonInfo = null) {
    const s = this.fresh('over');
    const d = h('div', 'over panel rise');
    const st = p.stats;
    let head = '', table = '', grid = '';
    if (p.mode === 'quick') {
      const g = p.game;
      const win = p.won;
      head = `<div class="label">${seasonInfo ? `${seasonInfo.label} · ` : ''}${p.game.walkOff ? 'Walk-off' : 'Final'}${seasonInfo ? ` · Record ${seasonInfo.record}` : ''}</div><div class="result ${win ? 'win' : 'loss'}">${headline(win ? 'YOU WIN' : 'YOU LOSE', win ? 'gold' : 'red')}</div>`;
      const n = Math.max(g.line.top.length, 3);
      let hdr = '<tr><th></th>' + Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('') + '<th>R</th><th>H</th><th>E</th></tr>';
      const row = (name, ab, arr, R, H, E) => `<tr><td class="tn"><span class="full">${name}</span><span class="ab">${ab}</span></td>` + Array.from({ length: n }, (_, i) => `<td>${arr[i] === undefined ? '' : arr[i]}</td>`).join('') + `<td class="r">${R}</td><td>${H}</td><td>${E}</td></tr>`;
      table = `<table class="linescore">${hdr}${row(teamNames.away, teamNames.awayAbbr, g.line.top, g.score.top, g.hits.top, (g.errors || {}).top || 0)}${row(teamNames.home, teamNames.homeAbbr, g.line.bottom, g.score.bottom, g.hits.bottom, (g.errors || {}).bottom || 0)}</table>`;
      grid = [[avgText(st.hits, st.ab), 'AVG'], [`${st.hits}/${st.ab}`, 'Hits'], [st.hr, 'HR'], [st.rbi, 'RBI'], [st.perfect, 'Perfect'], [st.longestHR ? st.longestHR + ' ft' : '--', 'Longest'], [st.maxEV ? Math.round(st.maxEV) + ' mph' : '--', 'Exit velo'], [`${st.strikeouts} / ${st.walks}`, 'K / BB']];
    } else if (p.mode === 'derby') {
      const d2 = p.derby;
      head = `<div class="label">Derby</div><div class="result win">${headline(`${d2.hr} HOME RUN${d2.hr === 1 ? '' : 'S'}`, 'gold')}</div>`;
      grid = [[d2.hr, 'HR'], [d2.longest ? d2.longest + ' ft' : '--', 'Longest'], [d2.bestStreak, 'Streak'], [st.perfect, 'Perfect'], [st.maxEV ? Math.round(st.maxEV) + ' mph' : '--', 'Exit velo'], [`${Math.round(100 * d2.hr / Math.max(1, st.swings))}%`, 'HR rate'], [st.swings, 'Swings'], [st.whiffs, 'Misses']];
    }
    // (the buttons stay in view on any screen: the rest scrolls above them when a phone is too short for it all)
    const badges = records.map((r) => `<span class="badge">${icon('star')}${r}</span>`).join('') + unlocked.map((u) => `<span class="badge unlock">${icon('unlock')}${u.name}</span>`).join('')
      + (seasonInfo ? seasonInfo.items.map(([l, c]) => `<span class="badge">${l} +${c}</span>`).join('') + `<span class="badge coinbadge">${icon('coin')}${seasonInfo.coins}</span>` : '');
    d.innerHTML = `<div class="overbody">${head}${table}<div class="statgrid">${grid.map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      ${badges ? `<div class="badges">${badges}</div>` : ''}</div>
      <div class="row overacts">${seasonInfo
    ? `<button class="btn" data-a="seasonHub">${icon('play')}Continue</button>`
    : `<button class="btn" data-a="playAgain">${icon('play')}Again</button><button class="btn ghost" data-a="quit">${icon('home')}Menu</button>`}</div>`;
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

  // ---------------------------------------------------------------- league
  // The League hub: your next game, your record, and the way to the standings, the roster and the shop. With no league yet it is
  // where you pick your team, the level and the length.
  buildSeason(sea, st) {
    const s = this.fresh('season');
    const d = h('div', 'league panel rise');
    if (!sea) {
      const pick = (this.pick ||= { team: 'nym', level: st.difficulty, length: 'short', div: null });
      const team = teamById(pick.team);
      const div = pick.div || `${team.league} ${team.division}`;
      pick.div = div;
      const [lg, dv] = div.split(' ');
      const inDiv = MLB_TEAMS.filter((t) => t.league === lg && t.division === dv);
      const divs = ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West'];
      const stars5 = starsOf(team).sort((a, b) => SEA.overall(b) - SEA.overall(a));
      const rivals = MLB_TEAMS.filter((t) => t.league === team.league && t.division === team.division && t.id !== team.id);
      const seg = (key, items, cur) => `<div class="seg" data-pick="${key}">${items.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      const n = (k) => (CONFIG.season.cycles[k] * 8);
      d.style.setProperty('--accent', team.color);
      d.innerHTML = `${this.backHead('Pick your team', '', 'League')}
        <div class="picker">
          <div>
            <div class="divtabs">${divs.map((x) => `<button data-div="${x}" class="${x === div ? 'on' : ''}">${x}</button>`).join('')}</div>
            <div class="teamlist">${inDiv.map((t) => `<button class="teamrow ${t.id === team.id ? 'sel' : ''}" data-team="${t.id}" style="--c:${t.color}">${crest(t)}<span class="nm"><small>${t.city}</small><b>${t.nick}</b></span>${tierStars(t.tier)}</button>`).join('')}</div>
          </div>
          <div class="teamcard" style="--c:${team.color}">
            <div class="top">${crest(team, 'xl')}<div><small>${team.league === 'AL' ? 'American' : 'National'} League · ${team.division}</small><h3>${team.city}<br>${team.nick}</h3>${tierStars(team.tier)}</div></div>
            <div class="sect split"><span>Stars</span><span class="rate">${ratingHead}</span></div>
            <div class="starlist">${stars5.map((p) => `<div class="starrow"><span class="pos">${p.pos}</span><span class="nm">${p.name}${p.real ? `<small class="real">${p.real.avg.toFixed(3).replace(/^0/, '')} · ${p.real.hr} HR · ${p.real.sb} SB</small>` : ''}</span><span class="rate">${ratingCells(p)}</span></div>`).join('')}</div>
            <div class="sect">Division rivals</div>
            <div class="rivals">${rivals.map((t) => crest(t, 'sm')).join('')}</div>
          </div>
        </div>
        <div class="setup">
          <div class="grp"><span class="label">League level</span>${seg('level', DIFFICULTIES.map((k) => [k, CONFIG.difficulty[k].label]), pick.level)}</div>
          <div class="grp"><span class="label">Length</span>${seg('length', [['short', `${n('short')} games`], ['full', `${n('full')} games`]], pick.length)}</div>
          <button class="btn" data-a="seasonNew">${icon('play')}Start league</button>
        </div>`;
    } else {
      const me = sea.teams[0];
      const mine = teamById(me.id);
      const g = SEA.nextGame(sea);
      const table = SEA.standings(sea);
      const place = table.findIndex((x) => x.i === 0) + 1;
      d.style.setProperty('--accent', me.color);
      let hero;
      if (g) {
        const t = sea.teams[g.opp];
        const series = g.kind === 'final' ? `<span class="chip">Series ${g.series[0]}–${g.series[1]}</span>` : '';
        const ip = sea.inProgress;
        const mine1 = SEA.pickStarter(sea), theirs1 = SEA.opposingStarter(teamById(t.id), sea.games.length + (t.lineupSeed || 0));
        const starters = mine1 && theirs1 ? `<div class="starters"><span><small>${me.abbr}</small>${mine1.name}</span><span class="vs">vs</span><span><small>${t.abbr}</small>${theirs1.name}</span></div>` : '';
        hero = `<div class="next" style="--me:${me.color};--them:${t.color}">
          <div class="label">${g.label} · ${g.home !== false ? 'Home' : 'Away'}</div>
          <div class="match">
            ${(g.home !== false ? [t, me] : [me, t]).map((x, k) => `${k ? '<span class="vs">at</span>' : ''}<div class="side">${crest(x, 'xl')}<b>${x.abbr}</b><small>${x.w}–${x.l}</small></div>`).join('')}
          </div>
          <div class="parkname">${(CONFIG.parks.list[g.home !== false ? me.id : t.id] || CONFIG.parks.list.sandlot).name}</div>
          <div class="oppname">${t.name}${stars(t.rating, true)}${series}</div>
          ${starters}
          <button class="btn wide" data-a="seasonPlay">${icon('play')}${ip ? 'Resume' : 'Play'}</button>${ip ? `<div class="chips"><span class="chip">${ip.state.game.half === 'top' ? 'Top' : 'Bottom'} ${ip.state.game.inning}</span><span class="chip">${ip.state.game.score.top}–${ip.state.game.score.bottom}</span></div>` : ''}
        </div>`;
      } else {
        const fin = SEA.finishOf(sea);
        const champ = sea.champion !== null && sea.champion !== undefined ? sea.teams[sea.champion] : null;
        hero = `<div class="next done" style="--me:${me.color};--them:#1a2a4a">
          <div class="label">Year ${sea.year} · ${me.w}–${me.l}</div>
          <div class="result ${fin === 'Champions' ? 'win' : 'loss'}">${headline(fin === 'Champions' ? 'CHAMPIONS' : fin === 'Runner-up' ? 'RUNNER-UP' : 'SEASON OVER', fin === 'Champions' ? 'gold' : 'red')}</div>
          ${champ && sea.champion !== 0 ? `<div class="oppname">${icon('trophy')}${champ.name}</div>` : ''}
          <button class="btn wide" data-a="seasonNext">${icon('play')}Year ${sea.year + 1}</button>
        </div>`;
      }
      const last = sea.games[sea.games.length - 1];
      const lastTxt = last ? `<span class="chip ${last.won ? 'w' : 'l'}">${last.won ? 'W' : 'L'} ${last.rf}–${last.ra} ${sea.teams[last.opp].abbr}</span>` : '';
      const chips = `<span class="summary-row"><span class="chip">League level · ${CONFIG.difficulty[sea.level].label}</span><span class="chip">${me.w}–${me.l}</span>${me.w + me.l ? `<span class="chip">${ordinal(place)}</span>` : ''}${lastTxt}</span>`;
      const nav = (a, ic, title, small) => `<button class="navtile" data-a="${a}"><span class="ico">${icon(ic)}</span><span><h4>${title}</h4><small>${small}</small></span><span class="go">${icon('chevRight')}</span></button>`;
      d.innerHTML = `${this.backHead(teamName(mine), chips + `<span class="coins">${icon('coin')}${sea.coins}</span>`, `League · Year ${sea.year}`)}
        <div class="hubgrid">
          ${hero}
          <div class="hubnav">
            ${nav('standings', 'list', 'Standings', `${ordinal(place)} of ${sea.teams.length}`)}
            ${nav('roster', 'users', 'Roster', `${sea.roster.length} players`)}
            ${nav('shop', 'cart', 'Shop', `${sea.coins} coins`)}
          </div>
        </div>
        <div class="row foot"><button class="btn small ghost warn" data-a="seasonReset" data-confirm="Start over?">${icon('trash')}New league</button></div>`;
    }
    s.appendChild(d);
    this.refocus(s);
    s.onclick = (e) => {
      const pick = this.pick;
      const tab = e.target.closest('.divtabs button');
      if (tab && pick) { pick.div = tab.dataset.div; const [lg, dv] = pick.div.split(' '); const cur = teamById(pick.team); if (!(cur.league === lg && cur.division === dv)) pick.team = MLB_TEAMS.find((t) => t.league === lg && t.division === dv).id; this.act('uiTick'); this.buildSeason(null, { difficulty: pick.level }); return; }
      const row = e.target.closest('.teamrow');
      if (row && pick) { pick.team = row.dataset.team; this.act('uiTick'); this.buildSeason(null, { difficulty: pick.level }); return; }
      const pk = e.target.closest('.seg[data-pick] button');
      if (pk) { pick[pk.parentNode.dataset.pick] = pk.dataset.v; for (const b of pk.parentNode.children) b.classList.toggle('on', b === pk); this.act('uiTick'); return; }
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.confirm && !this.confirmed(b)) return;
      this.act(b.dataset.a, pick ? { ...pick } : undefined);
    };
  }

  buildStandings(sea, tab = this.standTab || 'race') {
    this.standTab = tab;
    const s = this.fresh('standings');
    const d = h('div', 'league panel rise');
    d.style.setProperty('--accent', sea.teams[0].color);
    const rows = SEA.standings(sea);
    const cut = CONFIG.season.playoffTeams;
    const tr = (x) => `<tr class="${x.i === 0 ? 'me' : ''} ${x.rank === cut ? 'cut' : ''}"><td>${x.rank}</td><td class="tn">${crest(x.team, 'sm')}<span class="full">${x.team.name}</span><span class="ab">${x.team.abbr}</span></td><td>${x.team.w}</td><td>${x.team.l}</td><td>${x.gb ? x.gb : '–'}</td><td class="st">${x.i === 0 ? '' : stars(x.team.rating, true)}</td></tr>`;
    let bracket = '';
    const po = sea.playoffs;
    if (po) {
      const nm = (i) => sea.teams[i].abbr;
      const semi = (m) => `<div class="mu"><span class="${m.winner === m.a ? 'won' : ''}">${nm(m.a)}</span><span class="${m.winner === m.b ? 'won' : ''}">${nm(m.b)}</span></div>`;
      const f = po.final;
      bracket = `<div class="bracket"><div><div class="label">Semifinals</div>${po.semis.map(semi).join('')}</div>
        <div><div class="label">World Series</div>${f ? `<div class="mu"><span class="${sea.champion === f.a ? 'won' : ''}">${nm(f.a)} ${f.wa}</span><span class="${sea.champion === f.b ? 'won' : ''}">${nm(f.b)} ${f.wb}</span></div>` : '<div class="mu"><span>–</span><span>–</span></div>'}</div></div>`;
    }
    // tabs: your playoff race (the table the playoffs come from), then every club by division
    const tabs = `<div class="divtabs standtabs">${[['race', 'Race'], ['AL', 'American'], ['NL', 'National']].map(([k, l]) => `<button data-stab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let body;
    if (tab === 'race') body = `${bracket}<table class="standings"><tr><th></th><th></th><th>W</th><th>L</th><th>GB</th><th></th></tr>${rows.map(tr).join('')}</table>`;
    else {
      const all = SEA.divisionTables(sea)[tab] || {};
      body = `<div class="divgrid">${['East', 'Central', 'West'].map((dv) => `<div class="divblock"><div class="label">${dv}</div><table class="standings small"><tr><th></th><th>W</th><th>L</th><th>GB</th></tr>${(all[dv] || []).map((x) => `<tr class="${x.team.mine ? 'me' : ''}"><td class="tn">${crest(x.team, 'sm')}<span class="nick">${teamById(x.team.id).nick}</span></td><td>${x.team.w}</td><td>${x.team.l}</td><td>${x.gb ? x.gb : '–'}</td></tr>`).join('')}</table></div>`).join('')}</div>`;
    }
    d.innerHTML = `${this.backHead('Standings', '', `League · Year ${sea.year}`)}${tabs}${body}`;
    s.appendChild(d);
    s.onclick = (e) => {
      const t = e.target.closest('[data-stab]');
      if (t) { this.act('uiTick'); this.buildStandings(sea, t.dataset.stab); return; }
      const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a);
    };
  }

  // The roster: tap a player, then another, to swap them (batting order, or bench <-> lineup). With `replaceFor` (buying a
  // player when the roster is full) tapping a player lets him go and the new man takes his place.
  buildRoster(sea, sel = null, replaceFor = null) {
    const s = this.fresh('roster');
    const d = h('div', 'league panel rise');
    d.style.setProperty('--accent', sea.teams[0].color);
    const n = CONFIG.season.roster.lineup;
    const buying = replaceFor ? sea.shop.find((p) => p.id === replaceFor) : null;
    const tab = buying ? (buying.role ? 'pit' : 'hit') : (this.rosterTab || 'hit');
    const row = (p, i) => {
      const t = sea.stats[p.id] || {};
      const extra = buying ? '' : `<span class="line">${SEA.avg(t.h || 0, t.ab || 0)}</span><span class="line">${t.hr || 0}</span><span class="line">${t.rbi || 0}</span>`;
      return `${i === n ? '<div class="label benchlab">Bench</div>' : ''}<button class="prow ${p.star ? 'star' : ''} ${sel === p.id ? 'sel' : ''}" data-id="${p.id}"><span class="ord">${i < n ? i + 1 : ''}</span><span class="who"><b>${p.name}</b><small>${p.pos} · #${p.number} · ${p.hand === 'L' ? 'Bats L' : 'Bats R'}${p.team ? ' · ' + p.team : ''}</small></span>${ratingCells(p)}${extra}</button>`;
    };
    const next = SEA.pickStarter(sea);
    const prow = (p) => {
      const t = (sea.pstats && sea.pstats[p.id]) || {};
      const rest = sea.rest[p.id] ?? 1;
      const tired = p.role === 'SP' ? rest < CONFIG.season.startMin : rest < CONFIG.season.relieverMin;
      const chip = tired ? '<span class="chip warn">Rest</span>' : next && next.id === p.id ? '<span class="chip">Next</span>' : '';
      const extra = buying ? '' : `<span class="line">${ipText(t.outs)}</span><span class="line">${t.k || 0}</span><span class="line">${eraText(t.er || 0, t.outs || 0)}</span>`;
      const bar = buying ? '' : `<span class="rt restbar ${tired ? 'lo' : ''}" title="Rest">${Math.round(rest * 100)}<i style="--v:${Math.round(rest * 100)}%"></i></span>`;
      return `<button class="prow pit ${p.star ? 'star' : ''} ${sel === p.id ? 'sel' : ''}" data-id="${p.id}"><span class="ord">${p.role}</span><span class="who"><b>${p.name}</b><small>${chip}${throwsText(p)} · #${p.number}${p.team ? ' · ' + p.team : ''}</small></span>${pitchCells(p)}${bar}${extra}</button>`;
    };
    const head = buying ? 'Replace who?' : 'Roster';
    const buyRow = buying ? (buying.role
      ? `<div class="prow buying pit"><span class="ord">${icon('cart')}</span><span class="who"><b>${buying.name}</b><small>${buying.role} · ${throwsText(buying)} · ${SEA.price(buying)} coins</small></span>${pitchCells(buying)}</div>`
      : `<div class="prow buying"><span class="ord">${icon('cart')}</span><span class="who"><b>${buying.name}</b><small>${buying.pos} · ${SEA.price(buying)} coins</small></span>${ratingCells(buying)}</div>`) : '';
    const list = tab === 'pit'
      ? `<div class="phead pit"><span class="ord">Job</span><span class="who">Pitcher</span>${pitchHead}${buying ? '' : '<span class="rt restbar">Rest</span><span class="line">IP</span><span class="line">K</span><span class="line">ERA</span>'}</div><div class="plist">${sea.staff.map(prow).join('')}</div>`
      : `<div class="phead"><span class="ord">#</span><span class="who">Player</span>${ratingHead}${buying ? '' : '<span class="line">AVG</span><span class="line">HR</span><span class="line">RBI</span>'}</div><div class="plist">${sea.roster.map(row).join('')}</div>`;
    d.innerHTML = `${this.backHead(head, `<span class="coins">${icon('coin')}${sea.coins}</span>`, `League · Year ${sea.year}`)}
      ${buying ? '' : tabsHtml('roster', tab, 0)}
      ${buyRow}
      ${list}`;
    s.appendChild(d);
    this.refocus(s);
    s.onclick = (e) => {
      const tb = e.target.closest('.tabs [data-tab]');
      if (tb) { this.rosterTab = tb.dataset.tab; this.act('rosterTab'); return; }
      const r = e.target.closest('.prow[data-id]');
      if (r) { this.act(buying ? 'seasonReplace' : 'rosterTap', { id: r.dataset.id, shopId: replaceFor }); return; }
      const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a);
    };
  }

  buildShop(sea) {
    const s = this.fresh('shop');
    const d = h('div', 'league panel rise');
    d.style.setProperty('--accent', sea.teams[0].color);
    const tab = this.shopTab || 'hit';
    const buy = (p) => {
      const cost = SEA.price(p);
      const afford = sea.coins >= cost; // (he costs exactly his price, out of the coins you have)
      return `<button class="btn small ${afford ? '' : 'ghost'}" data-a="shopBuy" data-id="${p.id}" ${afford ? '' : 'disabled'}>${icon('coin')}${cost}</button>`;
    };
    const card = (p) => (p.role
      ? `<div class="prow shopp ${p.star ? 'star' : ''}"><span class="ord ovr">${SEA.overall(p)}</span><span class="who"><b>${p.name}</b><small>${p.role} · ${throwsText(p)} · #${p.number}${p.team ? ' · ' + p.team : ''}</small></span>${pitchCells(p)}${buy(p)}</div>`
      : `<div class="prow shopp ${p.star ? 'star' : ''}"><span class="ord ovr">${SEA.overall(p)}</span><span class="who"><b>${p.name}</b><small>${p.pos} · #${p.number} · ${p.hand === 'L' ? 'Bats L' : 'Bats R'}${p.team ? ' · ' + p.team : ''}</small></span>${ratingCells(p)}${buy(p)}</div>`);
    const pit = sea.shop.filter((p) => p.role), hit = sea.shop.filter((p) => !p.role);
    d.innerHTML = `${this.backHead('Shop', `<span class="coins">${icon('coin')}${sea.coins}</span>`, `League · Year ${sea.year}`)}
      ${tabsHtml('shop', tab, pit.length)}
      <div class="phead"><span class="ord">OVR</span><span class="who">Player</span>${tab === 'pit' ? pitchHead : ratingHead}<span class="price" style="min-width:96px"></span></div>
      <div class="plist">${(tab === 'pit' ? pit : hit).map(card).join('')}</div>`;
    s.appendChild(d);
    this.refocus(s);
    s.onclick = (e) => {
      const tb = e.target.closest('.tabs [data-tab]');
      if (tb) { this.shopTab = tb.dataset.tab; this.act('shopTab'); return; }
      const bb = e.target.closest('[data-a]'); if (bb && !bb.disabled) this.act(bb.dataset.a, { id: bb.dataset.id });
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
  // The batting order on the left: all nine, the one at the plate lit, the ones who have been up dimmed. `today` = { id: { ab, h } } (optional).
  setLineup(lineup, idx, today = null) {
    const ol = this.q.lineup.querySelector('ol');
    if (!lineup) { ol.innerHTML = ''; this.lineupKey = null; return; }
    const key = lineup.map((b) => b.id).join(',');
    if (this.lineupKey !== key) {
      this.lineupKey = key;
      ol.innerHTML = lineup.map((b, i) => `<li data-i="${i}"><b>${i + 1}</b><span>${b.short || b.name}</span><small></small></li>`).join('');
    }
    ol.querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('on', i === idx);
      const t = today && today[lineup[i].id];
      li.querySelector('small').textContent = t && t.ab ? `${t.h}-${t.ab}` : '';
    });
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
    this.hideTiming(); // (the last swing's meter and the hit readout belong to the previous batter)
    this.hideCallout();
  }
  hideBatterUp() { this.q.batterUp.classList.remove('show'); }
  // the Steal button shows only while a runner could go (can), and is lit while they are going (on)
  setSteal(can, on) {
    const b = this.hud.querySelector('.stealbtn');
    b.classList.toggle('can', !!(can || on)); b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  setBunt(on) { const b = this.hud.querySelector('.buntbtn'); b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  // Practice: runs this session, hits, home runs, and who is on base
  setPracticeState(st) {
    const q = this.hud.querySelector('.practbox');
    q.querySelector('.runs').textContent = st.runs;
    q.querySelector('.hits').textContent = st.hits;
    q.querySelector('.hr').textContent = st.hr;
    if (st.pitching) { q.querySelector('.np').textContent = st.pitches; q.querySelector('.nk').textContent = st.k; q.querySelector('.nbb').textContent = st.bb; q.querySelector('.nh').textContent = st.h; }
    ['b1', 'b2', 'b3'].forEach((k, i) => q.querySelector('.' + k).classList.toggle('on', !!st.bases[i]));
  }
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
    this.pitchPinned = false;
    clearTimeout(this.pitchTimer);
    this.pitchTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  hidePitchInfo() { this.q.pitchinfo.classList.remove('show'); this.pitchPinned = false; }
  // While you aim: the pill stays up with the selected pitch's name and top speed (and the count); null lets it go.
  pinPitchInfo(o) {
    const el = this.q.pitchinfo;
    if (!o) { if (this.pitchPinned) { this.pitchPinned = false; el.classList.remove('show'); } return; }
    clearTimeout(this.pitchTimer);
    this.pitchPinned = true;
    el.querySelector('.type').textContent = o.type;
    el.querySelector('.mph').textContent = `${Math.round(o.mph)} mph`;
    el.classList.add('show');
  }
  banner(big, sub = '', cls = 'neutral', hold = false) {
    const el = this.q.banner;
    el.className = 'banner ' + cls + (hold ? ' hold' : '');
    // the home-run celebration is drawn in the logo's letters (the same on every device); anything else is text
    const art = cls === 'hr' ? wordSVG(big, { id: 'hr' + (this.artN = (this.artN || 0) + 1) }) : null;
    el.dataset.big = big;
    if (art) el.querySelector('.big').innerHTML = art; else el.querySelector('.big').textContent = big;
    el.querySelector('.sub').textContent = sub;
    void el.offsetWidth;
    el.classList.add('show');
  }
  // Change what a banner that is already showing says, without playing its entrance again (so the home-run celebration never repeats).
  bannerUpdate(big, sub = '') {
    const el = this.q.banner;
    if (!el.classList.contains('show')) return;
    el.querySelector('.sub').textContent = sub;
    if (el.dataset.big === big) return; // (already says it: do not redraw the letters)
    el.dataset.big = big;
    const art = el.classList.contains('hr') ? wordSVG(big, { id: 'hr' + (this.artN = (this.artN || 0) + 1) }) : null;
    if (art) el.querySelector('.big').innerHTML = art; else el.querySelector('.big').textContent = big;
    el.querySelector('.sub').textContent = sub;
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
  // the fast-forward button: up while a play runs (show), lit while the play is sped up (on)
  setFast(show, on) {
    const b = this.hud && this.hud.querySelector('.ffbtn');
    if (!b) return;
    b.classList.toggle('show', !!show);
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  // Pitching (you pitch the computer's half): o = null hides it all, else { open: boolean (the pitch buttons, Bullpen and Sim are up),
  // pitches: [{ type, label, mph }], selected: type, canSim, canBullpen }. Labels only.
  setPitching(o) {
    this.hud.classList.toggle('pitching', !!o); // (you are in the field: Bunt / Steal / Swing are gone)
    const on = !!(o && o.open);
    this.hud.classList.toggle('ctl', on);
    if (!on) { this.hud.classList.remove('canSim'); this.closeBullpen(); if (!o) this.pitchKey = null; return; }
    this.hud.classList.toggle('canSim', !!o.canSim);
    this.hud.querySelector('.bullbtn').disabled = !o.canBullpen;
    if (!o.canBullpen) this.closeBullpen();
    const key = o.pitches.map((p) => p.type).join(',');
    if (key !== this.pitchKey) {
      this.pitchKey = key;
      this.q.pitchbar.dataset.n = o.pitches.length;
      this.q.pitchbar.innerHTML = o.pitches.map((p) => `<button data-type="${p.type}" tabindex="-1"><span class="pn">${p.label}</span><span class="pm">${Math.round(p.mph)}</span></button>`).join('');
    }
    for (const b of this.q.pitchbar.children) b.classList.toggle('on', b.dataset.type === o.selected);
  }
  // The bullpen panel: list = [{ id, name, hand, pitches: [labels], rating, stamina (0..1) }], one row each - a tap on a row brings him
  // in (act 'bullpenPick'). Labels only. An empty list closes it.
  showBullpen(list) {
    if (!list || !list.length) { this.closeBullpen(); return; }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    this.hud.querySelector('.bplist').innerHTML = list.map((p) => `<button class="bprow" data-id="${esc(p.id)}" tabindex="-1"><span class="bpr">${Math.round(p.rating)}</span><span class="bpn">${esc(p.name)}<em>${esc(p.hand || '')}</em></span><span class="bpp">${p.pitches.map(esc).join(' · ')}</span><span class="stam"><i style="width:${Math.round(Math.max(0, Math.min(1, p.stamina)) * 100)}%"></i></span></button>`).join('');
    this.hud.classList.add('bullopen');
  }
  closeBullpen() { if (this.hud) this.hud.classList.remove('bullopen'); }
  get bullpenOpen() { return !!this.hud && this.hud.classList.contains('bullopen'); }
  // Your pitcher's tag by the score box: o = null hides it, else { name, pitches (thrown so far), stamina (0..1) } - the bar goes green,
  // amber under .4 and red under .15.
  setPitcherTag(o) {
    const el = this.hud.querySelector('.pitchtag');
    el.classList.toggle('show', !!o);
    if (!o) return;
    el.querySelector('.pn').textContent = o.name;
    el.querySelector('.pc').textContent = `${o.pitches} P`;
    const st = Math.max(0, Math.min(1, o.stamina));
    el.querySelector('.stam i').style.width = `${Math.round(st * 100)}%`;
    el.classList.toggle('mid', st < 0.4 && st >= 0.15);
    el.classList.toggle('low', st < 0.15);
  }
  // The count by the zone while you pitch (it rides on the pitch pill): '' removes it.
  setPitchCount(text) { this.q.pitchinfo.querySelector('.cnt').textContent = text || ''; }
  // the Swing button shows (phones) while you are up
  setSwingButton(on) { this.q.swingBtn.classList.toggle('show', !!on); }
  // The base diamond while you can send runners: o = null hides it, else { open: [bases that light up], dots: [{ x, z, sent, from,
  // canBack }] } (canBack: a runner you sent - his dot wears a ring and a tap on it calls him back).
  setBasePad(o) {
    const el = this.q.basepad;
    const on = !!o;
    if (on !== this.padOn) { this.padOn = on; el.classList.toggle('show', on); this.hud.classList.toggle('sending', on); }
    if (!on) return;
    for (const b of el.querySelectorAll('.bpbase')) b.classList.toggle('open', o.open.includes(+b.dataset.base));
    const g = el.querySelector('.dots');
    const h = el.querySelector('.hits');
    while (g.children.length < o.dots.length) g.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
    while (h.children.length < o.dots.length) h.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i], hit = h.children[i], d = o.dots[i];
      if (!d) { c.setAttribute('r', 0); hit.setAttribute('r', 0); hit.setAttribute('class', 'bphit'); continue; }
      // field feet -> the diamond's picture: home (80,140), first (140,80), second (80,20), third (20,80)
      const k = 60 / 63.64;
      const cx = (80 + d.x * k).toFixed(1), cy = (140 + d.z * k).toFixed(1);
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 8);
      c.setAttribute('class', 'bpdot' + (d.sent ? ' sent' : '') + (d.canBack ? ' canback' : ''));
      hit.setAttribute('cx', cx); hit.setAttribute('cy', cy); hit.setAttribute('r', 17);
      hit.setAttribute('class', d.canBack ? 'bphit canback' : 'bphit');
      hit.dataset.from = d.from;
      c.style.fill = RUNNER_COLORS[d.from] || '#fff';
    }
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
  setFullscreenIcon(on) { for (const b of this.root.querySelectorAll('[data-fs]')) { b.innerHTML = icon(on ? 'fullExit' : 'full'); b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); } }
  setFullscreenAvailable(ok) { for (const b of this.root.querySelectorAll('[data-fs]')) b.style.display = ok ? '' : 'none'; }
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
    this.hud.classList.toggle('ppitch', p.role === 'pitch'); // (Practice, pitching: the batting choices and the runs box give way)
    for (const b of pt.querySelectorAll('.role button')) b.classList.toggle('on', b.dataset.role === (p.role || 'bat'));
    for (const b of pt.querySelectorAll('.bh button')) b.classList.toggle('on', b.dataset.bh === (p.batterHand || 'R'));
    for (const b of pt.querySelectorAll('.pt button')) b.classList.toggle('on', b.dataset.type === p.type);
    const r = pt.querySelector('input'); r.value = p.speed; pt.querySelector('.sv').textContent = Math.round(p.speed) + ' mph';
    for (const b of pt.querySelectorAll('.loc button')) b.classList.toggle('on', b.dataset.loc === p.location);
  }
}
