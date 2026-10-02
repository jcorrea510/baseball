// The app: connects the game engine to the picture, sound, menus and player input.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createScene } from './render/scene.js';
import { createBall } from './render/ball.js';
import { createEffects } from './render/effects.js';
import { Actors } from './render/actors.js';
import { CameraRig } from './render/cameraRig.js';
import { AudioEngine } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { Engine } from './game/engine.js';
import { Progress } from './game/progression.js';
import { PLAYER_TEAM } from './game/teams.js';
import { createBot } from './game/bot.js';
import { describeError, classifyTiming } from './game/timing.js';
import { lineScore, isHitResult } from './game/rules.js';
import { clamp, lerp, smoothstep } from './util/math.js';
import { zoneRatio } from './physics/pitch.js';
import { PitchGuide } from './render/pitchGuide.js';
import { pitchGuide } from './game/pitchGuide.js';
import { LandingRing } from './render/landingRing.js';
import { BatAim } from './render/batAim.js';
import { landingSpot, landingRing } from './game/landing.js';
import * as SEA from './game/season.js';
import { runnerState, runnerProfile } from './game/runnerMotion.js';
import { currentPark } from './physics/field.js';
const parkName = () => currentPark().name.toUpperCase();

// scorekeeping numbers for the error banner (E6 = an error by the shortstop)
const POSITION_NUMBER = { P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };
const LABEL = { fastball: 'Fastball', changeup: 'Changeup', curveball: 'Curveball', slider: 'Slider', heater: 'Heater' };

export class App {
  // The constructor only remembers where to draw; init() builds everything, in stages, reporting progress to the loading splash
  // (and letting the browser repaint the bar between stages).
  constructor(canvas, uiRoot, params = new URLSearchParams()) {
    this.params = params;
    this.canvas = canvas;
    this.uiRoot = uiRoot;
  }

  async init(report = () => {}) {
    const params = this.params, canvas = this.canvas;
    const step = async (f, label) => { report(f, label); await breathe(); };
    this.prog = new Progress();
    if (this.prog.data.season) SEA.freshen(this.prog.data.season); // (older saves: the real names)
    // A first visit from a device set to "reduce motion": no white flashes or camera shake (both can be turned on in Settings)
    try { if (this.prog.fresh && matchMedia('(prefers-reduced-motion: reduce)').matches) this.prog.updateSettings({ flashes: false, shake: false }); } catch (e) { /* ignore */ }
    this.audio = new AudioEngine();
    this.audio.muted = !this.prog.settings.sound;
    this.audio.umpireMode = this.prog.settings.umpire === 'off' ? 'off' : 'on';
    this.audio.volume = this.prog.settings.volume;
    for (const [ch, key] of [['sfx', 'sfxVolume'], ['umpire', 'umpireVolume'], ['crowd', 'crowdVolume']]) this.audio.setLevel(ch, this.prog.settings[key]);

    const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (touch) document.body.classList.add('touch');
    this.touch = touch;

    await step(0.42, 'Building the ballpark');
    this.S = createScene(canvas, { preserveDrawingBuffer: params.has('shot') });
    await step(0.66, 'Warming up the players');
    this.ball = createBall(this.S.scene);
    this.fx = createEffects(this.S.scene);
    this.actors = new Actors(this.S.scene, this.ball, this.fx);
    if (this.S.isMobile) this.actors.detailScale = 0.75;
    this.cam = new CameraRig(this.S.camera);
    this.cam.title = true;
    this.makeZoneOverlay();

    this.ui = new UI(this.uiRoot, (a, d) => this.onAction(a, d));
    this.ui.noFlashes = !this.prog.settings.flashes;
    this.nav = []; // menu screens to go back to (Back / Esc)
    this.gameToken = 0; // bumps with every new game / quit, so delayed effects from an old game never fire into a new one
    this.engine = null;
    this.bot = null;
    this.screen = 'title';
    this.paused = false;
    this.hitStop = 0;
    this.slowMo = null;
    this.fast = false;
    this.mode = null;
    this.lastMode = null;
    this.aimKeys = { left: false, right: false, up: false, down: false }; // arrow keys move the bat
    this.aimTouch = 0;
    this.mouse = null; // { nx, ny } the mouse over the game (normalised screen position), when the mouse is aiming
    this.aimTarget = { x: 0, y: CONFIG.timing.zoneCenterY }; // where the cursor / keys / finger put the bat's sweet spot
    this.aimShown = { x: 0, y: CONFIG.timing.zoneCenterY }; // ...and where the bat is (it follows that closely)
    this.aimMode = 'mouse'; // mouse | keys | touch
    this.touchAim = null; // a finger dragging the bat
    this.lastFrameStamp = performance.now();
    this.time = 0;
    this.rawDtMs = 16.7;

    // A quiet "demo" engine so the title screen shows a living ballpark
    this.demo = new Engine({ mode: 'practice', difficulty: 'pro', seed: 7 });
    this.actors.configure({ engine: this.demo, playerUniformKey: this.prog.data.equipped.uniform, batStyle: this.prog.data.equipped.bat });

    // Test / QA shortcuts:  ?mode=quick&diff=pro&tod=night&bot=1
    if (params.get('tod')) this.prog.settings.tod = params.get('tod');
    if (params.get('diff')) this.prog.settings.difficulty = params.get('diff');
    if (params.get('zone')) this.prog.settings.zone = params.get('zone') === '1';
    if (params.get('guide')) this.prog.settings.pitchGuide = params.get('guide') === '1';
    if (params.get('ring')) this.prog.settings.landingRing = params.get('ring') === '1';

    this.S.env.set(this.prog.settings.tod);
    await step(0.84, 'Switching on the lights');
    // Prepare every shader now (in the background where the browser can), so the first frames do not stutter.
    this.actors.update(this.demo, 0, 0);
    this.cam.update(0, null, this.actors, this.S.size.aspect);
    try {
      const r = this.S.renderer;
      if (r.extensions.has('KHR_parallel_shader_compile')) await Promise.race([r.compileAsync(this.S.scene, this.S.camera), wait(5000)]);
      else r.compile(this.S.scene, this.S.camera);
    } catch (e) { /* the first frame will compile them */ }
    report(0.96, 'Play ball!');

    this.ui.buildTitle(this.prog);
    this.ui.show('title');
    this.ui.setMuteIcon(this.audio.muted);
    this.bindInput();
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
    document.addEventListener('webkitfullscreenchange', () => this.onFullscreenChange());
    this.loop = this.loop.bind(this);
    requestAnimationFrame((t) => { this.lastFrameStamp = t; this.last = t; requestAnimationFrame(this.loop); });

    const qm = params.get('mode');
    if (qm) { this.prog.settings.howtoSeen = true; setTimeout(() => this.startGame(qm), 50); }
  }

  // ---------------------------------------------------------------- setup helpers
  makeZoneOverlay() {
    const g = new THREE.Group();
    const w = CONFIG.pitch.zoneHalfWidth * 2 - 0.24, h = CONFIG.pitch.zoneTop - CONFIG.pitch.zoneBottom;
    const cy = (CONFIG.pitch.zoneTop + CONFIG.pitch.zoneBottom) / 2;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false }));
    g.add(fill);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    );
    g.add(edge);
    // 3x3 grid lines, very faint
    const grid = new THREE.Group();
    const lm = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 });
    for (const f of [1 / 3, 2 / 3]) {
      const vg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2 + w * f, -h / 2, 0), new THREE.Vector3(-w / 2 + w * f, h / 2, 0)]);
      const hg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, -h / 2 + h * f, 0), new THREE.Vector3(w / 2, -h / 2 + h * f, 0)]);
      grid.add(new THREE.Line(vg, lm), new THREE.Line(hg, lm));
    }
    g.add(grid);
    g.position.set(0, cy, CONFIG.pitch.contactZ);
    g.renderOrder = 5;
    // Rookie "swing now" cue: a green ring that closes in on the zone (shown even when the zone box is hidden)
    const cue = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.2, 48), new THREE.MeshBasicMaterial({ color: 0x4dff8f, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    cue.position.set(0, cy, CONFIG.pitch.contactZ + 0.04);
    cue.renderOrder = 6;
    cue.visible = false;
    this.S.scene.add(cue);
    this.zoneParts = { fill, edge, cue };
    this.S.scene.add(g);
    this.zone = g;
    g.visible = false;
    // where the last pitch crossed the plate
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.2, 24), new THREE.MeshBasicMaterial({ color: 0x3ddc7c, transparent: true, opacity: 0.95, depthWrite: false }));
    ring.position.z = CONFIG.pitch.contactZ + 0.05;
    ring.visible = false;
    this.S.scene.add(ring);
    this.pitchMarker = ring;
    this.markerT = 0;
    this.guide = new PitchGuide(this.S.scene); // the soft circle that guesses where the pitch will cross the plate
    this.landing = null; // where the ball in the air will come down (see onContact)
    this.landRing = new LandingRing(this.S.scene); // ...and the ring on the grass that shows it
    this.batAim = new BatAim(this.S.scene); // the see-through bat you aim with
  }

  get settings() { return this.prog.settings; }

  // ---------------------------------------------------------------- menus
  onAction(a, d) {
    this.audio.unlock();
    switch (a) {
      case 'play':
        this.audio.uiClick();
        if (!this.settings.howtoSeen) this.openHowTo(() => this.openMenu('modes', 'title'));
        else this.openMenu('modes', 'title');
        break;
      case 'howto': this.audio.uiClick(); { const from = this.ui.current || 'title'; this.openHowTo(() => this.showMenuScreen(from)); } break;
      case 'howtoPause': this.audio.uiClick(); this.openHowTo(() => this.ui.show('pause')); break;
      case 'howtoDone': this.audio.uiClick(); this.settings.howtoSeen = true; this.prog.save(); break;
      case 'back': this.audio.uiBack(); this.goBack(); break;
      case 'locker': this.audio.uiClick(); this.openMenu('locker'); break;
      case 'career': this.audio.uiClick(); this.openMenu('career'); break;
      case 'settings': this.audio.uiClick(); this.openMenu('settings'); break;
      case 'settingsPause': this.audio.uiClick(); this.openMenu('settings', 'pause'); break;
      case 'credits': this.audio.uiClick(); this.openMenu('credits'); break;
      case 'resetStats':
        this.audio.uiBack();
        this.prog.resetStats();
        this.ui.toast('Stats erased', 1800);
        if (this.ui.current === 'career') this.ui.buildCareer(this.prog);
        if (this.ui.current === 'settings') this.ui.buildSettings(this.settings);
        break;
      case 'equip':
        if (this.prog.equip(d.kind, d.id)) {
          this.audio.uiClick();
          if (d.kind === 'bats') this.actors.setBatStyle(d.id);
          this.ui.buildLocker(this.prog);
          this.ui.show('locker');
        }
        break;
      case 'parkPrev': case 'parkNext': {
        const ids = Object.keys(CONFIG.parks.list);
        const i = Math.max(0, ids.indexOf(this.settings.park || 'sandlot'));
        this.settings.park = ids[(i + (a === 'parkNext' ? 1 : ids.length - 1)) % ids.length];
        this.prog.save(); this.audio.uiClick(); this.ui.buildModes(this.prog); break;
      }
      case 'quickNew': this.audio.uiClick(); this.clearQuickSave(); this.startGame('quick'); break;
      case 'start': this.audio.uiClick(); if (d.mode === 'season') this.openMenu('season'); else this.startGame(d.mode); break;
      // ---- season
      case 'seasonNew': this.audio.uiClick(); this.prog.data.season = SEA.newSeason(null, { level: d.level, length: d.length, team: d.team }); this.prog.save(); this.showMenuScreen('season'); break;
      case 'seasonReset': this.audio.uiBack(); this.prog.data.season = null; this.prog.save(); this.showMenuScreen('season'); break;
      case 'seasonNext': {
        this.audio.uiClick();
        const old = this.prog.data.season;
        SEA.finishSeason(old);
        this.prog.data.season = SEA.newSeason(old, {});
        this.prog.save();
        this.showMenuScreen('season');
        break;
      }
      case 'seasonPlay': this.audio.uiClick(); this.startSeasonGame(); break;
      case 'seasonHub': this.audio.uiClick(); this.quitToMenu(); break;
      case 'standings': case 'roster': case 'shop': this.audio.uiClick(); this.rosterSel = null; this.replaceFor = null; this.openMenu(a); break;
      case 'rosterTap': {
        const sea = this.prog.data.season;
        if (!this.rosterSel) this.rosterSel = d.id;
        else if (this.rosterSel === d.id) this.rosterSel = null;
        else { SEA.swapPlayers(sea, this.rosterSel, d.id); this.rosterSel = null; this.prog.save(); }
        this.audio.uiClick();
        this.showMenuScreen('roster');
        break;
      }
      case 'shopBuy': {
        const sea = this.prog.data.season;
        if (sea.roster.length >= CONFIG.season.roster.size) { this.audio.uiClick(); this.replaceFor = d.id; this.rosterSel = null; this.openMenu('roster'); break; }
        this.signPlayer(d.id, null);
        break;
      }
      case 'seasonReplace': this.signPlayer(d.shopId, d.id); break;
      case 'uiTick': this.audio.uiClick(); break;
      case 'setting': this.changeSetting(d.key, d.value, !!d.live); break;
      case 'settingDone': this.prog.save(); this.previewSound(d.key); break;
      case 'pause': this.setPaused(true); break;
      case 'resume': this.setPaused(false); break;
      case 'restart': this.setPaused(false); if (this.seasonGame) this.startSeasonGame(); else { this.clearQuickSave(); this.startGame(this.mode); } break;
      case 'playAgain': this.audio.uiClick(); this.startGame(this.lastMode); break;
      case 'quit': this.audio.uiBack(); this.quitToMenu(); break;
      case 'mute': this.toggleMute(); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'skipSummary': if (this.engine) this.engine.skipSummary(); break;
      case 'batterReady': if (this.engine) this.engine.batterReady(); break;
      case 'bunt': if (this.engine) this.engine.setBunt(!this.engine.buntStance); break;
      case 'steal': if (this.engine) this.engine.setSteal(!this.engine.stealArmed); break;
      case 'send': this.sendRunner(d); break;
      case 'runner': if (this.engine && !this.paused && !this.bot && this.engine.runnerOrder(d.from, d.kind)) this.audio.uiClick(); break;
      case 'swing': this.swingInput(d); break;
      case 'practice': if (this.engine) { Object.assign(this.engine.practice, d); } break;
      default: break;
    }
  }

  openHowTo(after) {
    this.ui.buildHowTo(after);
    this.ui.show('howto');
  }

  // Menu screens. `openMenu` remembers where you came from so Back (and Esc) return there.
  openMenu(name, from = this.ui.current || 'title') {
    if (from && from !== name) this.nav.push(from);
    if (this.nav.length > 8) this.nav.shift();
    this.showMenuScreen(name);
  }
  goBack() {
    const to = this.nav.pop() || (this.engine && !this.engine.over && this.paused ? 'pause' : 'title');
    this.showMenuScreen(to);
  }

  showMenuScreen(name) {
    if (name === 'pause') { this.ui.buildPause(this.settings, !!this.seasonGame, !!this.seasonGame || !!this.quickSave); this.ui.show('pause'); return; }
    if (!(this.engine && !this.engine.over && this.paused)) this.screen = name; // (settings opened from the pause menu: still in the game)
    if (name === 'title') { this.nav = []; this.ui.buildTitle(this.prog); }
    if (name === 'modes') this.ui.buildModes(this.prog);
    if (name === 'locker') this.ui.buildLocker(this.prog);
    if (name === 'career') this.ui.buildCareer(this.prog);
    if (name === 'settings') this.ui.buildSettings(this.settings);
    if (name === 'credits') this.ui.buildCredits(this.audio.files.list.length > 0);
    if (name === 'season') this.ui.buildSeason(this.prog.data.season, this.settings);
    if (name === 'standings') this.ui.buildStandings(this.prog.data.season);
    if (name === 'roster') this.ui.buildRoster(this.prog.data.season, this.rosterSel, this.replaceFor);
    if (name === 'shop') this.ui.buildShop(this.prog.data.season);
    this.ui.show(name);
  }

  // Season: buy a player from the shop (with a full roster he replaces `outId`)
  signPlayer(shopId, outId) {
    const sea = this.prog.data.season;
    const p = sea.shop.find((x) => x.id === shopId);
    const r = SEA.buyPlayer(sea, shopId, outId);
    if (!r.ok) { this.audio.uiBack(); this.ui.toast(r.reason === 'coins' ? 'Not enough coins' : 'Pick a player', 1600); return; }
    this.prog.save();
    this.audio.unlockChime();
    this.ui.toast(`Signed ${p.name}`, 1800);
    this.replaceFor = null;
    if (outId) { this.nav.pop(); this.showMenuScreen('shop'); } else this.showMenuScreen('shop');
  }

  // Season: your next game, against the team on the schedule (your roster, their strength)
  startSeasonGame() {
    const sea = this.prog.data.season;
    const setup = sea && SEA.gameSetup(sea);
    if (!setup) return;
    // a game that was left half-way carries on from where it was (the lineup, the seed and the state were saved at the last pitch)
    const saved = sea.inProgress || null;
    this.seasonGame = setup.game;
    this.seasonLineup = saved ? saved.lineup : setup.lineup;
    this.seasonSeed = saved ? saved.seed : setup.seed;
    this.startGame('quick', {
      engine: { difficulty: setup.level, innings: setup.innings, lineup: this.seasonLineup, opponent: setup.opponent, playerTeam: setup.playerTeam, oppLineup: setup.oppLineup, seed: this.seasonSeed, playerSide: setup.playerSide },
      park: setup.park,
      cfg: setup.cfg,
      resume: saved ? saved.state : null,
    });
  }

  // Season: save the game at every pitch, so quitting (or closing the page) never loses it or lets you start it over.
  saveSeasonGame(st) {
    const sea = this.prog.data.season;
    if (this.quickSave && !this.seasonGame) {
      // a Quick Game is saved at every pitch too (not before the first one: a game nobody has started is not worth resuming)
      if (st.pitchCount > 0) { this.prog.data.quick = { seed: this.quickSave.seed, difficulty: this.quickSave.difficulty, park: this.quickSave.park, lineup: this.quickSave.lineup, state: st }; this.prog.save(); }
      return;
    }
    if (!this.seasonGame || !sea) return;
    sea.inProgress = { lineup: this.seasonLineup, seed: this.seasonSeed, state: st };
    this.prog.save();
  }

  clearQuickSave() { this.quickSave = null; if (this.prog.data.quick) { this.prog.data.quick = null; this.prog.save(); } }

  goModes() { this.nav = ['title']; this.showMenuScreen('modes'); }

  changeSetting(key, value, live = false) {
    if (!live) this.audio.uiClick();
    if (live) Object.assign(this.settings, { [key]: value }); // (saved when the slider is let go)
    else this.prog.updateSettings({ [key]: value });
    if (key === 'tod') this.S.env.set(value, false);
    if (key === 'sound') { this.audio.setMuted(!value); this.ui.setMuteIcon(!value); }
    if (key === 'zone') { this.zone.visible = !!value && !!this.engine; if (!value) this.pitchMarker.visible = false; }
    if (key === 'umpire') this.audio.umpireMode = value === 'off' ? 'off' : 'on';
    if (key === 'volume') this.audio.setVolume(value);
    if (key === 'sfxVolume') this.audio.setLevel('sfx', value);
    if (key === 'umpireVolume') this.audio.setLevel('umpire', value);
    if (key === 'crowdVolume') this.audio.setLevel('crowd', value);
    if (key === 'flashes') this.ui.noFlashes = !value;
    if (key === 'inputDelayMs' && this.engine) this.engine.inputDelay = value / 1000;
    if (this.ui.current === 'modes') this.ui.buildModes(this.prog);
  }

  // Letting go of a volume slider plays a sample of that channel, so you hear what you set.
  previewSound(key) {
    const a = this.audio;
    if (key === 'volume' || key === 'sfxVolume') a.glovePop(0.9);
    if (key === 'umpireVolume') a.callUmpire('strike');
    if (key === 'crowdVolume') { a.crowdSwell(0.6, 1.6); a.applause(1.2, 0.6); }
  }

  toggleMute() {
    const muted = !this.audio.muted;
    this.audio.setMuted(muted);
    this.prog.updateSettings({ sound: !muted });
    this.ui.setMuteIcon(muted);
  }

  setPaused(p) {
    if (!this.engine || this.engine.over) return;
    this.paused = p;
    this.nav = [];
    if (p) { this.ui.buildPause(this.settings, !!this.seasonGame, !!this.seasonGame || !!this.quickSave); this.ui.show('pause'); }
    else { this.ui.hideAll(); this.lastFrameStamp = performance.now(); blurFocus(); }
  }

  quitToMenu() {
    const toSeason = this.returnTo === 'season';
    this.gameToken++;
    this.engine = null; this.bot = null; this.paused = false; this.fast = false; this.slowMo = null; this.hitStop = 0;
    if (this.padShown) { this.padShown = false; this.ui.setBasePad(null); }
    this.ui.hideHud(); this.hideOverlays();
    this.cam.title = true;
    this.actors.configure({ engine: this.demo, playerUniformKey: this.prog.data.equipped.uniform, batStyle: this.prog.data.equipped.bat });
    this.fx.clear();
    this.S.env.set(this.settings.tod, false);
    this.seasonGame = null;
    if (toSeason) { this.nav = ['title', 'modes']; this.showMenuScreen('season'); } else this.goModes();
  }

  hideOverlays() { this.zone.visible = false; this.pitchMarker.visible = false; this.guide.hide(); this.landRing.hide(); this.landing = null; }

  // ---------------------------------------------------------------- starting a game
  // `extra` (Season games): { engine: more Engine options, cfg: the config for this opponent }
  startGame(mode, extra = null) {
    if (!mode) mode = 'quick';
    if (!extra) this.seasonGame = null;
    this.returnTo = extra ? 'season' : 'modes';
    this.lastMode = mode;
    this.mode = mode;
    const st = this.settings;
    this.gameToken++;
    this.playOuts = 0;
    blurFocus(); // a menu button left focused would otherwise catch Space / Enter
    // a Quick Game carries on from where it was left (saved at every pitch); "New game" / Restart clears the save
    this.quickSave = null;
    let quickResume = null;
    if (mode === 'quick' && !extra && !this.params.get('bot') && !this.params.get('seed')) {
      const q = this.prog.data.quick;
      if (q && q.state && q.state.game) { quickResume = q.state; this.quickSave = { seed: q.seed, difficulty: q.difficulty, park: q.park }; }
      else this.quickSave = { seed: (Math.random() * 2 ** 32) >>> 0, difficulty: st.difficulty, park: st.park || 'sandlot' };
    }
    // your League club plays every mode: the same team, jersey and batters (a resumed Quick Game keeps the nine it started with)
    const sea = this.prog.data.season;
    let club = !extra && sea && sea.teams ? SEA.clubSetup(sea) : null;
    if (club && quickResume) club = this.prog.data.quick.lineup ? { ...club, lineup: this.prog.data.quick.lineup } : null; // (a game saved before: its own nine)
    if (club && this.quickSave) this.quickSave.lineup = club.lineup;
    // the ballpark: a League game in the home team's park, a resumed Quick Game where it started, anything else where you chose
    const park = extra ? extra.park || 'sandlot' : (this.quickSave && this.quickSave.park) || st.park || 'sandlot';
    this.S.setPark(park);
    const eng = new Engine({
      mode, difficulty: this.quickSave ? this.quickSave.difficulty : st.difficulty,
      hand: st.hand, inputDelayMs: st.inputDelayMs,
      waitForBatter: mode === 'quick' && !this.params.get('bot'), // the pitcher waits for Ready before each new batter
      practice: this.engine && this.engine.mode === 'practice' ? { ...this.engine.practice } : undefined,
      seed: this.params.get('seed') ? +this.params.get('seed') : this.quickSave ? this.quickSave.seed : undefined,
      ...(club ? { playerTeam: club.playerTeam, lineup: club.lineup } : {}),
      ...(extra ? extra.engine : {}),
    }, extra && extra.cfg ? extra.cfg : CONFIG);
    this.engine = eng;
    this.audio.setUmpire(eng.seed); // this game's umpire has his own voice
    this.engine.setAim(0);
    this.pitchesThisGame = 0;
    this.paused = false; this.fast = false; this.slowMo = null; this.hitStop = 0;
    this.screen = 'game';
    this.cam.title = false;
    this.cam.snapToBatter();
    this.fx.clear();
    this.actors.configure({ engine: eng, playerUniformKey: this.prog.data.equipped.uniform, batStyle: this.prog.data.equipped.bat });
    this.bindEngine(eng);
    this.S.env.set(st.tod, true);
    this.ui.hideAll();
    this.ui.showHud(mode);
    this.ui.setBunt(false);
    this.ui.setSteal(false, false);
    { const sd = this.sides(eng); this.ui.setTeams({ abbr: sd.away.abbr, color: sd.away.color }, { abbr: sd.home.abbr, color: sd.home.color }); } // (visitors on top)
    this.ui.setMuteIcon(this.audio.muted);
    if (eng.game) this.ui.setGameState(eng.game);
    if (mode === 'derby') this.ui.setDerby({ ...eng.derby });
    if (mode === 'practice') { this.ui.setPracticeButtons(eng.practice); this.ui.setPracticeState(eng.practiceState()); }
    this.zone.visible = !!st.zone;
    this.pitchMarker.visible = false;
    this.updateScoreboard();
    if (this.params.get('bot')) this.bot = createBot(eng, { errSd: +(this.params.get('sd') || 20), seed: 5 });
    else this.bot = null;
    if (extra && extra.resume) eng.resume(extra.resume);
    else if (quickResume) { eng.resume(quickResume); this.ui.toast('Game resumed', 1800, 'play'); }
    else {
      eng.start();
      if (mode === 'quick') this.audio.callUmpire('playball', { delay: 0.6 }); // the plate umpire opens the game
    }
    if (!this.prog.data.tipShown) {
      this.ui.hint(this.touch ? 'Drag to aim · tap to swing' : 'Mouse to aim · click to swing', 4600);
      this.prog.data.tipShown = 1; this.prog.save();
    }
  }

  // ---------------------------------------------------------------- engine -> world hooks
  bindEngine(e) {
    const ui = this.ui, audio = this.audio, cam = this.cam, fx = this.fx;
    const F = CONFIG.feel;
    e.on('paStart', ({ batter, waiting }) => {
      ui.setBatter(batter);
      this.refreshLineup();
      if (waiting) ui.showBatterUp(batter, e.lineOf(batter), this.batterChips(batter)); else ui.hideBatterUp();
      this.pitchMarker.visible = false;
      this.actors.loose.spent = false;
      this.actors.loose.active = false;
      this.actors.looseBat.visible = false;
      if (e.game) ui.setGameState(e.game);
      this.updateScoreboard();
    });
    e.on('count', (c) => { ui.setCount(c.balls, c.strikes, c.outs); this.updateScoreboard(); });
    e.on('batterReady', () => ui.hideBatterUp());
    e.on('checkpoint', (st) => this.saveSeasonGame(st));
    e.on('buntStance', ({ on }) => ui.setBunt(on));
    e.on('practice', (st) => { ui.setPracticeState(st); this.updateScoreboard(); });
    e.on('stealArmed', ({ on }) => ui.setSteal(e.canSteal, on));
    e.on('stealGo', () => audio.crowdSwell(0.3, 1.4)); // the crowd sees him go
    e.on('stealPlay', () => { this.landing = null; this.landRing.hide(); this.playOuts = 0; });
    e.on('windup', ({ pitch }) => {
      this.hrShown = false;
      this.pitchMarker.visible = false;
      ui.hideBanner();
      ui.hideCallout();
      if (pitch.announce && e.mode !== 'derby') ui.showPitchInfo(LABEL[pitch.type], 0, true, 1500);
    });
    e.on('release', ({ pitch }) => {
      this.actors.fielders.P.root.updateMatrixWorld(true);
      const rh = this.actors.fielders.P.handWorld('R');
      this.fx.releaseGlint(rh.x, rh.y, rh.z);
      ui.showPitchInfo(pitch.announce || (e.d.typeAtRelease && e.mode !== 'derby') ? LABEL[pitch.type] : '', pitch.speedMph, false, 1900);
    });
    e.on('swing', ({ swing, pitch, errorText }) => {
      if (swing.bunt) { ui.hideHint(); return; } // (a bunt is squared up and pushed by itself: no swing, no timing meter)
      audio.swingWhoosh();
      const txtGrade = { perfect: 'PERFECT', good: 'GOOD', early: 'EARLY', late: 'LATE', miss: swing.errorMs < 0 ? 'TOO EARLY' : 'TOO LATE' }[swing.grade];
      const w = classifyTiming(swing.errorMs, { windowScale: e.windowScale }).windows;
      let grade = swing.grade;
      ui.timing(swing.errorMs, grade, w, `${txtGrade}${grade === 'perfect' && Math.abs(swing.errorMs) < 3 ? '' : ' · ' + errorText}`);
      if (e.mode === 'practice') this.prog.recordPracticeSwing();
      ui.hideHint();
      void pitch;
    });
    e.on('whiff', ({ reason }) => {
      // where the bat missed it (the ring on the plate shows where the ball was)
      const say = { under: 'Under it', over: 'Over it', end: 'Off the end', hands: 'Jammed' }[reason];
      if (say) ui.hint(say, 1500);
    });
    e.on('catch', ({ pitch, swung }) => {
      audio.glovePop(clamp((pitch.speedMph - 40) / 60, 0.3, 1.2));
      ui.showPitchInfo(LABEL[pitch.type], pitch.speedMph, false, 1500);
      // mark where it crossed the plate
      const inZone = pitch.isStrike;
      this.pitchMarker.material.color.set(inZone ? 0x3ddc7c : 0xff5a4d);
      this.pitchMarker.position.set(pitch.target.x, pitch.target.y, CONFIG.pitch.contactZ + 0.04);
      this.pitchMarker.visible = this.settings.zone;
      if (this.settings.shake) cam.shake(0.05);
      void swung;
    });
    e.on('pitchCall', (p) => this.onPitchCall(p));
    e.on('contact', (c) => this.onContact(c));
    e.on('playEvent', (ev) => this.onPlayEvent(ev));
    e.on('result', (r) => this.onResult(r));
    e.on('derby', (d) => { ui.setDerby(d); this.updateScoreboard(); });
    e.on('aiHalf', (s) => {
      ui.hideBanner(); ui.hideCallout();
      ui.showSummary(s, e.opponent.name, CONFIG.pace.aiSummaryLine);
      this.updateScoreboard();
      const scored = s.runs > 0;
      if (scored) { audio.crowdGroan(0.5); } else audio.crowdSwell(0.3, 1.5);
    });
    e.on('inningChange', ({ inning, half, newInning }) => {
      ui.hideSummary();
      if (e.game) ui.setGameState(e.game);
      this.updateScoreboard();
      if (newInning && e.game && !e.over) ui.banner(`INNING ${inning}`, e.game.inning > e.game.innings ? 'Extra innings' : '', 'neutral');
    });
    e.on('gameOver', (p) => this.onGameOver(p));
  }

  onContact(c) {
    const e = this.engine, ui = this.ui, audio = this.audio, F = CONFIG.feel;
    this.playOuts = 0;
    this.landing = landingSpot(c.sim, c.plan, CONFIG); // (null for grounders, home runs and balls that hit the wall first)
    const grade = c.grade;
    if (c.contact && c.contact.bunt) {
      // a bunt: a soft tock off the bat, no sparks, no freeze-frame, no shake
      audio.batCrack(0.05, 45);
      this.lastContact = c;
      return;
    }
    const q = grade === 'perfect' ? 1 : grade === 'good' ? 0.62 : 0.25;
    audio.batCrack(q, c.exitVelocity);
    if (grade === 'perfect') this.hitStop = F.hitStopPerfect;
    else if (grade === 'good') this.hitStop = F.hitStopGood;
    if (this.settings.shake) this.cam.shake(grade === 'perfect' ? F.shakePerfect : grade === 'good' ? F.shakeGood : 0.2);
    const s = c.sim;
    const start = { x: s.x[0], y: s.y[0], z: s.z[0] };
    const dirN = new THREE.Vector3(Math.sin(c.sprayAngle * Math.PI / 180), 0.3, -Math.cos(c.sprayAngle * Math.PI / 180));
    this.fx.contactSparks(start.x, start.y, start.z, q, [dirN.x, dirN.y, dirN.z]);
    if (grade === 'perfect') ui.flash(0.22, 90);
    if (grade === 'perfect') ui.banner('PERFECT!', `${Math.round(c.exitVelocity)} mph`, 'great');
    else if (grade === 'good') ui.banner('NICE HIT', '', 'good');
    else if (c.plan.result === 'foul') { audio.tick(); }
    if (c.homer) { this.slowMo = { t: 0, dur: F.slowMoDuration, delay: this.hitStop + 0.02 }; }
    if (e.mode === 'practice') ui.callout([{ v: Math.round(c.exitVelocity), u: 'mph', l: 'Exit velo' }, { v: Math.round(c.launchAngle), u: '°', l: 'Launch' }], 2400);
    // The follow-through swoosh already played; a big hit swells the crowd - a beat after the crack, once they see it fly
    if (c.big) this.audio.crowdSwell(0.35, 2, CONFIG.audio.crowdReact);
    this.lastContact = c;
  }

  // What the plate umpire says and does for a pitch: a strike, a ball, strike three, ball four.
  onPitchCall({ call, result, strikes }) {
    const e = this.engine, audio = this.audio;
    const struckOut = !!result && /^strikeout/.test(result);
    let kind = null;
    if (call === 'ball') kind = result === 'walk' ? 'ball4' : 'ball';
    else if (call === 'calledStrike') kind = struckOut ? 'strike3' : 'strike';
    else if (call === 'swingingStrike') kind = struckOut ? 'strike3Swing' : 'strikeSwing';
    if (!kind) return;
    this.actors.strikeCall(e.time, kind); // (he always signals, even with the voice off)
    if (e.mode === 'derby') return; // batting practice: no calls
    // "Strike one!" / "Strike two!" when there is a count (the recordings for them are pooled with the plain "Strike!")
    if ((kind === 'strike' || kind === 'strikeSwing') && (strikes === 1 || strikes === 2)) kind = strikes === 1 ? 'strike1' : 'strike2';
    audio.callUmpire(kind);
  }

  // A call at a base or a foul ball. Only a play at the plate is signalled by the umpire you can see; bases are voice only,
  // panned to the side of the field they are on.
  umpireCall(kind, base = 0) {
    if (this.engine.mode === 'derby') return;
    const pan = base === 1 ? 0.55 : base === 3 ? -0.55 : base === 2 ? 0.1 : 0;
    this.audio.callUmpire(kind, { pan, delay: 0.06 });
    if (kind === 'foul' || base === 4 || base === 0) this.actors.strikeCall(this.engine.time, kind);
  }

  onPlayEvent(ev) {
    const e = this.engine, audio = this.audio, ui = this.ui;
    const c = this.lastContact;
    switch (ev.type) {
      case 'landed':
        if (c && c.plan.result === 'foul') this.umpireCall('foul');
        this.fx.dustPuff(ev.x, ev.z, 0.42, [0.42, 0.42, 0.27]); // (a small, dull puff of dirt and grass - nothing bright)
        this.fx.grassBits(ev.x, ev.z, 0.5);
        audio.dirtThud(0.6);
        if (c && c.plan.result !== 'foul' && !c.homer && (c.big || c.distance > 200)) this.showDistanceCallout(c, false);
        break;
      case 'wall':
        this.fx.dustPuff(ev.x, ev.z, 0.6);
        audio.wallThud();
        audio.crowdSwell(0.5, 1.8);
        if (this.settings.shake) this.cam.shake(0.25);
        break;
      case 'fence': {
        const dist = Math.round(c ? c.projected.distance : 400);
        audio.homeRun(dist);
        this.S.stadium.crowd.cheer(1);
        this.celebrateHomer(ev, dist);
        this.showDistanceCallout(c, true);
        ui.banner('HOME RUN!', `${dist} ft`, 'hr', true);
        this.hrShown = true; // (the result banner at the end of the play only updates this one - the celebration never plays twice)
        if (this.settings.shake) this.cam.shake(F_HR());
        break;
      }
      case 'stands':
        this.fx.confetti(ev.x, ev.y + 4, ev.z, 60, 14);
        break;
      case 'catch':
        audio.glovePop(0.8);
        // a caught ball that is an out: the umpire calls it (at a base the 'outCall' event does it)
        if (e.mode !== 'derby' && c && !c.homer && c.plan.caught && c.plan.outsMade > 0) this.later(() => this.umpireCall('out', 0), 160);
        if (c && !c.homer) { audio.crowdSwell(c.big ? 0.55 : 0.28, 2); }
        if (ev.dive) {
          // a diving catch is a highlight: big crowd reaction and a banner
          audio.crowdSwell(0.95, 2.4);
          this.S.stadium.crowd.cheer(0.6);
          ui.banner('DIVING CATCH!', '', 'good');
          this.later(() => ui.hideBanner(), 1400);
        }
        break;
      case 'dive': audio.crowdSwell(0.35, 1.2); break; // (no slow motion on a dive: it plays at full speed)
      case 'diveLand':
        this.fx.dustPuff(ev.x, ev.z, 0.55);
        this.fx.grassBits(ev.x, ev.z, 1);
        audio.dirtThud(0.85);
        if (this.settings.shake) this.cam.shake(0.3);
        break;
      case 'field':
        audio.glovePop(0.45);
        if (ev.pos !== 'P' && ev.pos !== 'C') this.fx.dustPuff(this.actors.ballPos.x, this.actors.ballPos.z, 0.4);
        break;
      case 'throw': audio.throwWhoosh(); break;
      case 'glovePop': audio.glovePop(0.9); break;
      case 'outCall':
        if (this.engine.mode === 'derby') audio.outCue();
        else this.umpireCall('out', ev.base);
        // the out light comes on when the out is made, not when the whole play is over
        if (e.game) { this.playOuts = (this.playOuts || 0) + 1; ui.setCount(e.game.balls, e.game.strikes, Math.min(3, e.game.outs + this.playOuts)); }
        break;
      case 'safe': this.umpireCall('safe', ev.base); break;
      case 'error':
        // a misplay: the crowd reacts, the ball is loose (the result banner names it when the play is over)
        audio.glovePop(ev.drop ? 0.7 : 0.4);
        audio.crowdSwell(0.6, 1.8);
        break;
      default: break;
    }
    void e;
  }

  celebrateHomer(ev, dist) {
    const n = 3 + (dist > 420 ? 2 : 0);
    for (let i = 0; i < n; i++) {
      this.later(() => {
        const a = Math.atan2(ev.x, -ev.z) + (Math.random() - 0.5) * 0.9;
        const r = 330 + Math.random() * 140;
        this.fx.firework(Math.sin(a) * r, 70 + Math.random() * 70, -Math.cos(a) * r, null, 1 + Math.random() * 0.6);
      }, 150 + i * 230);
    }
  }

  // The batting order panel: who is up, and each man's day so far.
  refreshLineup() {
    const e = this.engine;
    if (!e || e.mode !== 'quick' || !e.lineup) { this.ui.setLineup(null); return; }
    const today = {};
    for (const b of e.lineup) today[b.id] = e.lineOf(b);
    this.ui.setLineup(e.lineup, e.batterIndex ?? 0, today);
  }

  // Which team is the visitor (bats in the top half) and which the home team: you, unless it is a League road game.
  sides(e) { return e.playerSide === 'top' ? { away: e.playerTeam, home: e.opponent } : { away: e.opponent, home: e.playerTeam }; }

  toggleFullscreen() {
    const d = document;
    const on = !!(d.fullscreenElement || d.webkitFullscreenElement);
    const kb = navigator.keyboard;
    try {
      if (on) {
        this.fsLeaving = true; // (we are leaving on purpose: no pause menu for it)
        if (kb && kb.unlock) kb.unlock();
        (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      } else {
        const el = d.documentElement;
        const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        // Esc should open the pause menu, not throw you out of full screen: browsers that allow it hand the Esc key to the game while in
        // full screen (holding Esc still leaves it)
        if (p && p.then) p.then(() => { if (kb && kb.lock) kb.lock(['Escape']).catch(() => {}); }).catch(() => {});
      }
    } catch (err) { /* not allowed here: nothing to do */ }
  }

  // Full screen ended without our button (a browser that keeps Esc for itself): Esc was meant for the pause menu, so open it.
  onFullscreenChange() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) return;
    const meant = this.fsLeaving; this.fsLeaving = false;
    if (!meant && this.screen === 'game' && !this.paused && !this.ui.current) this.setPaused(true);
  }

  // Small facts on the next batter's card (bats left / right; season numbers are added in Season mode).
  batterChips(b) {
    const out = [];
    const sea = this.prog.data.season;
    if (b.con !== undefined && sea) {
      // a Season player: his season so far and his ratings
      const t = sea.stats[b.id] || {};
      out.push(`${SEA.avg(t.h || 0, t.ab || 0)} AVG`, `${t.hr || 0} HR`, `Contact ${b.con} · Power ${b.pow} · Speed ${b.spd}`);
      return out;
    }
    if (b.hand) out.push(b.hand === 'L' ? 'Bats left' : 'Bats right');
    return out;
  }

  // setTimeout that is dropped if the game it belongs to has been quit or restarted in the meantime
  later(fn, ms) {
    const token = this.gameToken;
    setTimeout(() => { if (token === this.gameToken) fn(); }, ms);
  }

  showDistanceCallout(c, isHr) {
    if (!c) return;
    const items = [{ v: Math.round(c.exitVelocity), u: 'mph', l: 'Exit velo' }, { v: Math.round(isHr ? c.projected.distance : c.distance), u: 'ft', l: 'Distance' }];
    if (isHr || c.big) items.push({ v: Math.round(c.launchAngle), u: '°', l: 'Launch' });
    this.ui.callout(items, isHr ? 4200 : 3000);
  }

  onResult(r) {
    const e = this.engine, ui = this.ui, audio = this.audio;
    if (e.game) { ui.setGameState(e.game); this.updateScoreboard(); }
    const runsText = r.runs > 0 ? ` · ${r.runs} run${r.runs > 1 ? 's' : ''}` : '';
    const count = e.game ? `${e.game.balls}-${e.game.strikes}` : '';
    if (r.kind === 'pitch') {
      const map = { ball: ['BALL', count, 'neutral'], calledStrike: ['STRIKE', count, 'bad'], swingingStrike: ['STRIKE', 'Swinging', 'bad'], foul: ['FOUL', count, 'neutral'], take: ['', '', ''], hitByPitch: ['HIT BY PITCH', runsText.replace(' · ', '') || 'Take your base', 'neutral'] };
      if (r.call === 'hitByPitch') { audio.glovePop(0.4); audio.crowdGroan(0.45); }
      const m = r.foulTip ? ['FOUL TIP', count, 'neutral'] : map[r.call] || [r.text || '', '', 'neutral'];
      if (r.foulTip) audio.glovePop(0.9);
      if (r.call === 'ball' || r.call === 'take') { /* subtle */ }
      if (m[0]) ui.banner(m[0], e.mode === 'quick' ? m[1] : (r.call === 'swingingStrike' ? 'Swinging' : ''), m[2]);
      if (r.call === 'ball' && e.game && e.game.balls === 3) audio.crowdSwell(0.2, 1.2);
      return;
    }
    if (r.kind !== 'pitch') this.refreshLineup();
    if (r.kind === 'steal') {
      const safe = r.result !== 'caughtStealing';
      const where = { 2: 'Second', 3: 'Third' }[r.base] || '';
      ui.banner(r.text, safe ? where : (r.halfOver ? 'Inning over' : where), safe ? 'good' : 'bad');
      if (safe) { audio.crowdSwell(0.55, 2); audio.applause(1.1, 0.45); } else audio.crowdGroan(0.5);
      return;
    }
    // plate appearance / play ended
    const res = r.result;
    let big = r.text, sub = '', cls = 'neutral';
    if (res === 'homer' || res === 'insideParkHomer') { cls = 'hr'; sub = `${Math.round(r.distanceFt || r.distance || 0)} ft${runsText}`; if (r.walkOff) sub = 'WALK-OFF!'; }
    else if (['single', 'double', 'triple'].includes(res)) { cls = 'good'; sub = `${Math.round(r.exitVelocity)} mph${runsText}`; audio.crowdSwell(res === 'single' ? 0.4 : 0.65, 2.2); audio.applause(1.2, 0.5); }
    else if (res === 'error') { cls = 'good'; sub = `E${POSITION_NUMBER[r.plan && r.plan.error ? r.plan.error.pos : ''] || ''}${runsText}`.replace(/^E · /, ''); audio.applause(1, 0.4); }
    else if (res === 'walk') { cls = 'neutral'; sub = runsText.replace(' · ', ''); audio.crowdSwell(0.2, 1.2); }
    else if (res === 'hitByPitch') { cls = 'neutral'; sub = runsText.replace(' · ', '') || 'Take your base'; audio.glovePop(0.4); audio.crowdGroan(0.45); }
    else if (res === 'strikeoutSwinging' || res === 'strikeoutLooking') { cls = 'bad'; sub = r.detail || (res === 'strikeoutLooking' ? 'Looking' : 'Swinging'); audio.crowdGroan(0.7); if (r.detail === 'Foul tip') audio.glovePop(0.9); }
    else if (res === 'out') { cls = 'bad'; sub = r.detail ? r.detail : ''; audio.crowdGroan(0.4); }
    else if (['groundout', 'flyout', 'lineout', 'popout', 'foulOut', 'doublePlay', 'fieldersChoice', 'sacFly', 'sacBunt'].includes(res)) {
      const sac = res === 'sacFly' || res === 'sacBunt';
      cls = sac ? 'good' : 'bad'; sub = res === 'sacFly' ? `1 run` : res === 'sacBunt' ? (r.runs > 0 ? '' : 'Runner up') : (r.text && res === 'doublePlay' ? '2 outs' : `${Math.round(r.exitVelocity || 0)} mph`);
      if (!sac) audio.crowdGroan(0.35);
      if (runsText) sub += runsText;
    }
    // a runner you sent was tagged out (or doubled off): the banner says so - the batter thrown out stretching a hit is an out, not a hit
    const note = r.plan && r.plan.outNote && e.mode !== 'derby' ? r.plan.outNote : null;
    let noteText = '';
    if (note) {
      const where = ['', '1st', '2nd', '3rd', 'home'][note.base] || '';
      const hitName = r.text ? r.text.charAt(0) + r.text.slice(1).toLowerCase() : '';
      if (note.from === 0 && isHitResult(res)) { big = `OUT AT ${where.toUpperCase()}`; sub = `${hitName} · tagged out${runsText}`; cls = 'bad'; noteText = `out at ${where}`; audio.crowdGroan(0.45); }
      else if (res === 'doublePlay') { sub = `${r.plan.doubledOff ? 'Doubled off' : 'Out at'} ${where}${runsText}`; noteText = sub; }
      else { noteText = `runner out at ${where}`; sub = `Runner out at ${where}${runsText}`; }
    }
    if (e.mode === 'practice' && r.kind === 'play') {
      big = r.text; sub = `${Math.round(r.exitVelocity)} mph · ${Math.round(r.distance)} ft${runsText}`;
      if (note) { if (note.from === 0 && isHitResult(res)) big = `OUT AT ${['', '1st', '2nd', '3rd', 'home'][note.base].toUpperCase()}`; sub = `${noteText} · ${sub}`; }
      cls = res === 'homer' || res === 'insideParkHomer' ? 'hr' : isHitResult(res) || r.runs > 0 ? 'good' : 'neutral';
    }
    if (e.mode === 'derby' && r.kind === 'play') {
      if (res === 'homer') { cls = 'hr'; big = 'HOME RUN'; sub = `${r.distanceFt} ft${r.streak > 1 ? ` · streak ${r.streak}` : ''}`; }
      else { cls = 'bad'; big = r.text.includes('FREE') ? r.text : 'OUT'; sub = r.detail || ''; }
    }
    if (res === 'homer' || res === 'insideParkHomer') {
      if (this.hrShown) {
        // the celebration is already on screen: only say what it was worth (a grand slam, a 3-run homer, a walk-off)
        const label = r.runs === 4 ? 'GRAND SLAM' : r.runs > 1 ? `${r.runs}-RUN HOMER` : null;
        if (label || r.walkOff) ui.bannerUpdate(label || 'HOME RUN!', sub);
      } else ui.banner(big, sub, cls, true);
    } else {
      // a play that drove in runs says the RUNS in big letters and the hit in smaller ones
      if (r.runs > 0 && e.mode !== 'derby') {
        const hit = note && note.from === 0 && isHitResult(res) ? r.text : big; // (SINGLE, DOUBLE, SAC FLY, WALK, ERROR ...)
        const mph = r.exitVelocity ? `${Math.round(r.exitVelocity)} mph` : '';
        big = `${r.runs} RUN${r.runs > 1 ? 'S' : ''}`;
        sub = [hit, noteText || mph].filter(Boolean).join(' · ');
        cls = 'good';
      }
      ui.banner(big, sub, cls);
    }
    if (r.runs > 0 && res !== 'homer') audio.applause(1.6, 0.8);
  }

  onGameOver(p) {
    const e = this.engine;
    this.ui.hideHud();
    this.hideOverlays();
    this.audio.applause(2.4, 0.9);
    this.clearQuickSave(); // (finished: nothing left to resume)
    // a Season game: the standings, your players' season numbers and your coins
    let seasonInfo = null;
    if (this.seasonGame) {
      const sea = this.prog.data.season;
      const lines = {};
      for (const b of e.lineup) lines[b.id] = e.lineOf(b);
      const label = this.seasonGame.label;
      sea.inProgress = null; // (finished: nothing left to resume)
      const r = SEA.recordGame(sea, { won: p.won, runsFor: p.game.pf, runsAgainst: p.game.pa, lines });
      const me = sea.teams[0];
      seasonInfo = { items: r.items, coins: sea.coins, label, record: `${me.w}–${me.l}` };
      p.season = true;
      this.seasonGame = null;
    }
    const { records, unlocked } = this.prog.recordGame(p);
    const g = p.game;
    if (g) g.line = lineScore(e.game);
    this.ui.buildTitle(this.prog);
    const sd = this.sides(e);
    const names = { away: sd.away.name.toUpperCase(), home: sd.home.name.toUpperCase(), awayAbbr: sd.away.abbr, homeAbbr: sd.home.abbr };
    this.later(() => {
      this.ui.showGameOver(p, records, unlocked, names, seasonInfo); // (new unlocks are listed on it as badges)
      if (unlocked.length) this.audio.unlockChime();
    }, 900);
    this.screen = 'over';
  }

  updateScoreboard() {
    const e = this.engine;
    const sb = this.S.stadium.scoreboard;
    if (!e) { sb.set({ mode: 'quick', title: parkName(), teams: [{ abbr: 'SLG', color: PLAYER_TEAM.color, runs: [], R: 0, H: 0, E: 0 }, { abbr: '---', runs: [], R: 0, H: 0, E: 0 }], count: { b: 0, s: 0, o: 0 }, innings: 3, message: 'PLAY BALL!', flash: 0 }); return; }
    if (e.mode === 'quick' && e.game) {
      const g = e.game;
      const ls = lineScore(g);
      const sd = this.sides(e);
      sb.set({
        mode: 'quick', title: parkName(), innings: Math.max(g.innings, g.inning), inning: g.inning, half: g.half,
        teams: [{ abbr: sd.away.abbr, color: sd.away.color, runs: ls.top, R: g.score.top, H: g.hits.top, E: (g.errors || {}).top || 0 }, { abbr: sd.home.abbr, color: sd.home.color, runs: ls.bottom, R: g.score.bottom, H: g.hits.bottom, E: (g.errors || {}).bottom || 0 }],
        count: { b: g.balls, s: g.strikes, o: g.outs },
      });
    } else if (e.mode === 'derby') {
      sb.set({ mode: 'derby', title: parkName(), derby: { hr: e.derby.hr, outsLeft: Math.max(0, e.derby.maxOuts - e.derby.outs), longest: e.derby.longest, streak: e.derby.streak } });
    } else {
      const ps = e.practiceState();
      sb.set({ mode: 'practice', title: parkName(), practice: { runs: ps.runs, hits: ps.hits } });
    }
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const swing = (ev) => this.swingInput(ev);
    window.addEventListener('keydown', (e) => {
      const inGame = this.screen === 'game' && !this.paused && !this.ui.current;
      const t = document.activeElement;
      // a focused menu control (button, switch, slider) gets the keyboard the normal way: Enter / Space press it, arrows move a slider
      const onControl = !inGame && t && t !== document.body && t.closest && !!t.closest('button, input, a, select, summary, [tabindex]:not(#game)');
      if (e.repeat) { if (inGame && ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
      this.audio.unlock();
      switch (e.code) {
        case 'Space': case 'Enter': case 'NumpadEnter':
          if (onControl) break;
          e.preventDefault();
          if (this.screen === 'game') swing(e);
          else if (this.ui.current === 'title') this.onAction('play');
          break;
        case 'Escape': case 'KeyP':
          if (e.code === 'KeyP' && onControl) break;
          this.escape();
          break;
        case 'KeyM': this.toggleMute(); break;
        case 'KeyF': if (!onControl) this.toggleFullscreen(); break;
        case 'KeyB': if (inGame && this.engine) this.engine.setBunt(!this.engine.buntStance); break;
        case 'KeyS': if (inGame && this.engine) this.engine.setSteal(!this.engine.stealArmed); break;
        case 'KeyZ': if (this.engine) { this.changeSetting('zone', !this.settings.zone); } break;
        // the arrow keys (or A / D across) move the bat
        case 'ArrowLeft': case 'KeyA': if (!inGame) break; e.preventDefault(); this.aimKeys.left = true; this.aimMode = 'keys'; break;
        case 'ArrowRight': case 'KeyD': if (!inGame) break; e.preventDefault(); this.aimKeys.right = true; this.aimMode = 'keys'; break;
        case 'ArrowUp': case 'KeyW': if (!inGame) break; e.preventDefault(); this.aimKeys.up = true; this.aimMode = 'keys'; break;
        case 'ArrowDown': if (!inGame) break; e.preventDefault(); this.aimKeys.down = true; this.aimMode = 'keys'; break;
        case 'Equal': case 'NumpadAdd': if (inGame && this.engine.mode === 'practice') this.practiceSpeed(+2); break;
        case 'Minus': case 'NumpadSubtract': if (inGame && this.engine.mode === 'practice') this.practiceSpeed(-2); break;
        case 'KeyT': // tag up (every runner who can) - press again to cancel
          if (this.screen === 'game' && !this.ui.current && this.engine && this.engine.sendOpen) {
            let any = false;
            for (const r of this.engine.runnerTargets()) if (r.canTag && this.engine.runnerOrder(r.from, 'tag')) any = true;
            if (any) this.audio.uiClick();
          }
          break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': case 'KeyH':
          // while a hit is being played: 2 / 3 / 4 (or H) send a runner to that base
          if (inGame && this.engine.sendOpen) { const b = e.code === 'KeyH' ? 4 : +e.code.slice(5); if (b >= 2 && b <= 4) this.sendRunner(b); break; }
          if (e.code === 'KeyH') break;
          if (inGame && this.engine.mode === 'practice') {
            const types = ['fastball', 'changeup', 'curveball', 'slider', 'heater', 'mixed'];
            this.engine.practice.type = types[+e.code.slice(5) - 1];
            this.ui.setPracticeButtons(this.engine.practice);
          }
          break;
        default: break;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.aimKeys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.aimKeys.right = false;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.aimKeys.up = false;
      if (e.code === 'ArrowDown') this.aimKeys.down = false;
    });
    // The mouse aims the bat (its sweet spot follows the cursor) and a click swings. A finger drags the bat (it moves with the finger
    // but a little further, so the finger never covers it) and a quick tap swings - or use the Swing button.
    const toNorm = (e) => { const r = this.canvas.getBoundingClientRect(); return { nx: ((e.clientX - r.left) / r.width) * 2 - 1, ny: -((e.clientY - r.top) / r.height) * 2 + 1 }; };
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        const t = this.touchAim;
        if (!t || t.id !== e.pointerId) return;
        const dx = e.clientX - t.lx, dy = e.clientY - t.ly;
        t.lx = e.clientX; t.ly = e.clientY;
        if (Math.hypot(e.clientX - t.x0, e.clientY - t.y0) > CONFIG.batAim.tapPx) t.moved = true;
        const k = this.ftPerPx() * CONFIG.batAim.touchGain;
        this.aimTarget.x += dx * k; this.aimTarget.y -= dy * k;
        this.clampAimTarget();
        return;
      }
      this.mouse = toNorm(e); this.aimMode = 'mouse';
    });
    this.canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.mouse = null; });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (this.screen !== 'game') return;
      e.preventDefault();
      if (e.pointerType === 'touch') {
        this.aimMode = 'touch';
        // While you are batting a finger drags the bat. A finger coming down while the pitch is on its way - or a second finger while one
        // is dragging - swings, at that very moment (the Swing button does too). Anywhere else (a play, the summary) a tap does what it
        // always did.
        if (this.cam.batting && this.engine && ['ready', 'windup', 'pitch'].includes(this.engine.phase) && !this.engine.awaitingBatter) {
          if (this.touchAim || this.engine.phase === 'pitch') swing(e);
          if (!this.touchAim) {
            this.touchAim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: e.timeStamp, moved: false };
            try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          }
          return;
        }
        swing(e);
        return;
      }
      this.mouse = toNorm(e); this.aimMode = 'mouse';
      swing(e);
    });
    this.canvas.addEventListener('pointerup', (e) => { if (this.touchAim && this.touchAim.id === e.pointerId) this.touchAim = null; });
    this.canvas.addEventListener('pointercancel', (e) => { if (this.touchAim && this.touchAim.id === e.pointerId) this.touchAim = null; });
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, () => { if (this.audio.hidden && document.hasFocus()) this.audio.setHidden(false); this.audio.unlock(); }, { passive: true });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'game' && !this.paused && this.engine && !this.engine.over) this.setPaused(true);
      this.audio.setHidden(document.hidden); // no crowd roaring from a background tab
    });
    window.addEventListener('pagehide', () => this.audio.setHidden(true));
    window.addEventListener('pageshow', () => this.audio.setHidden(document.hidden));
    // switching to another window (the tab stays visible, e.g. alt-tab) pauses too, so no pitch is thrown while you are away
    window.addEventListener('blur', () => {
      this.aimKeys.left = this.aimKeys.right = this.aimKeys.up = this.aimKeys.down = false;
      if (this.screen === 'game' && !this.paused && this.engine && !this.engine.over && !this.params.get('bot')) this.setPaused(true);
      this.audio.setHidden(true); // another app has the focus: the ballpark goes quiet (menus included)
    });
    window.addEventListener('focus', () => this.audio.setHidden(document.hidden));
  }

  // Esc: back out of whatever is showing (a menu goes back, the pause menu resumes, a game pauses).
  escape() {
    const cur = this.ui.current;
    if (cur === 'howto') { const b = this.ui.screens.howto.querySelector('[data-a=howtoDone]'); if (b) b.click(); return; }
    if (this.screen === 'game' && (!cur || cur === 'pause')) { this.setPaused(!this.paused); return; }
    if (['modes', 'locker', 'career', 'settings', 'credits', 'season', 'standings', 'roster', 'shop'].includes(cur)) this.onAction('back');
  }

  practiceSpeed(d) {
    const p = this.engine.practice;
    p.speed = clamp(p.speed + d, CONFIG.modes.practice.speedMin, CONFIG.modes.practice.speedMax);
    this.ui.setPracticeButtons(p);
  }

  // ---------------------------------------------------------------- batting: the catcher's view and the bat you aim
  // Are you up? (the catcher's view): from Ready (or the first pitch of a Derby / practice) through the pitches of the at-bat; not
  // while waiting for Ready, during a play, the computer's half-inning or between innings.
  isBatting(e) {
    if (!e || this.screen !== 'game' || e.over) return false;
    if (e.phase === 'ready') return !e.awaitingBatter && e.time - e.phaseSince > (e.pitchCount ? 0 : CONFIG.camera.catcher.firstDelay);
    if (e.phase === 'windup' || e.phase === 'pitch') return true;
    if (e.phase === 'result') return !e.play && !e.paEnded; // (a ball or a strike: the at-bat goes on)
    return false;
  }

  // feet on the plane over the plate per screen pixel (for dragging the bat with a finger)
  ftPerPx() {
    const cam = this.S.camera;
    const d = Math.max(1, cam.position.distanceTo(new THREE.Vector3(this.aimShown.x, this.aimShown.y, CONFIG.pitch.contactZ)));
    return (2 * d * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, this.S.size.h);
  }

  clampAimTarget() {
    const R = CONFIG.swing.reach;
    this.aimTarget.x = clamp(this.aimTarget.x, -R.x, R.x);
    this.aimTarget.y = clamp(this.aimTarget.y, R.yMin, R.yMax);
  }

  // Every frame: where the bat is aimed (the cursor on the plane over the plate, the arrow keys, a finger), the bat drawn there and
  // handed to the engine, the camera told whether you are batting, and the mouse pointer hidden while the bat is the cursor.
  updateBatting(e, dt) {
    const batting = this.isBatting(e) && !this.paused;
    this.cam.batting = batting;
    this.actors.cameraCatcherDist = this.cam.catcherDist;
    this.actors.cameraPos = this.S.camera.position;
    const A = CONFIG.batAim;
    if (this.aimMode === 'mouse' && this.mouse && batting) {
      // the cursor's ray onto the plane over the front of the plate
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(this.mouse.nx, this.mouse.ny), this.S.camera);
      const o = ray.ray.origin, d = ray.ray.direction;
      if (Math.abs(d.z) > 1e-6) {
        const t = (CONFIG.pitch.contactZ - o.z) / d.z;
        if (t > 0) { this.aimTarget.x = o.x + d.x * t; this.aimTarget.y = o.y + d.y * t; }
      }
    }
    if (this.aimMode === 'keys') {
      const k = A.keySpeed * dt;
      this.aimTarget.x += ((this.aimKeys.right ? 1 : 0) - (this.aimKeys.left ? 1 : 0)) * k;
      this.aimTarget.y += ((this.aimKeys.up ? 1 : 0) - (this.aimKeys.down ? 1 : 0)) * k;
    }
    this.clampAimTarget();
    // the bat follows with a touch of weight (never a lag you can feel)
    const f = 1 - Math.exp(-dt / A.follow);
    this.aimShown.x += (this.aimTarget.x - this.aimShown.x) * f;
    this.aimShown.y += (this.aimTarget.y - this.aimShown.y) * f;
    if (!this.bot) e.setBatAim(this.aimShown.x, this.aimShown.y);
    const shown = this.bot ? e.batAim : this.aimShown;
    const sw = e.swing && e.pitch && (e.phase === 'pitch' || e.phase === 'play' || e.phase === 'result') ? e.swing : null;
    this.batAim.update({
      show: batting && this.cam.catcherDist < A.showWithin && (e.phase !== 'result' || !!sw), // (squared around to bunt, it is the bat he holds out)
      bunt: !!(e.buntStance || (sw && sw.bunt)),
      aim: shown, hand: e.batterHand, swing: sw, time: e.time,
    }, dt);
    this.ui.setSwingButton(batting && this.touch && !e.buntStance && (e.phase === 'windup' || e.phase === 'pitch' || e.phase === 'ready'));
    const hideCursor = batting && this.aimMode === 'mouse' && !this.ui.current;
    if (hideCursor !== this.cursorHidden) { this.cursorHidden = hideCursor; this.canvas.style.cursor = hideCursor ? 'none' : ''; }
  }

  // ---------------------------------------------------------------- sending runners (the base diamond)
  sendRunner(base) {
    const e = this.engine;
    if (!e || this.paused || this.bot) return;
    if (e.sendRunner(base)) this.audio.uiClick();
  }

  // Every frame: the base diamond is up while you can send runners - the bases you can send someone to glow, and a dot shows every
  // runner where he is right now.
  updateBasePad(e) {
    const open = !this.paused && !this.ui.current && e.sendOpen;
    if (!open) { if (this.padShown) { this.padShown = false; this.ui.setBasePad(null); } return; }
    this.padShown = true;
    const p = e.play, t = e.time - p.t0;
    const dots = [];
    for (const m of p.plan.moves) {
      if (m.back && m.from === 0) continue;
      if (m.out && m.outAt !== undefined && t > m.outAt) continue; // (tagged out: off the diamond)
      const q = runnerState(m, t, e.cfg, this.padQ || (this.padQ = {}));
      dots.push({ x: q.x, z: q.z, sent: !!m.sent && t < (m.outAt ?? Infinity), from: m.from });
    }
    // (the batter on a ball caught in the air has no move: he is still a dot on his way to first until the catch)
    if (!p.plan.moves.some((m) => m.from === 0) && !p.plan.homer && t < (p.plan.catchT ?? 0)) {
      const q = runnerProfile(0, 1, 'run', e.cfg).at(Math.max(0, t - e.cfg.runner.batterStart), this.padQ || (this.padQ = {}));
      dots.push({ x: q.x, z: q.z, sent: false, from: 0 });
    }
    this.ui.setBasePad({ targets: e.sendTargets(), dots, runners: e.runnerTargets() });
  }

  swingInput(ev) {
    const e = this.engine;
    if (!e || this.paused || e.over) return;
    if (this.ui.current && this.ui.current !== 'game') return;
    switch (e.phase) {
      case 'ready': if (e.awaitingBatter) e.batterReady(); break;
      case 'pitch': {
        let stamp = ev && ev.timeStamp;
        if (!stamp || stamp > 1e12) stamp = performance.now();
        const since = this.hitStop > 0 ? 0 : clamp((stamp - this.lastFrameStamp) / 1000, -0.02, 0.05);
        e.swingPressed(since);
        break;
      }
      case 'play': if (ev && ev.type === 'keydown') this.fast = true; break; // (only the Space bar speeds a play up: a stray click or tap never does)
      case 'aiSummary': e.skipSummary(); break;
      case 'result': if (e.time - e.phaseSince > 0.12) { e.resultUntil = Math.min(e.resultUntil, e.time); } break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- frame loop
  loop(now) {
    if (this.halted) return;
    requestAnimationFrame(this.loop); // first, so one bad frame can never stop the loop
    try {
      const realDt = Math.min(0.05, Math.max(0.0005, (now - this.last) / 1000));
      this.rawDtMs = now - this.last;
      this.last = now;
      this.lastFrameStamp = now;
      this.S.adapt(this.rawDtMs, realDt);
      this.tick(realDt, true);
      this.frameErrors = 0;
      if (!this.running) {
        this.running = true; // the first frame drew fine: the loading splash can go
        if (window.__sandlotBoot) window.__sandlotBoot.done();
      }
    } catch (err) {
      this.frameErrors = (this.frameErrors || 0) + 1;
      if (this.frameErrors <= 3) console.error(err);
      // A few bad frames in a row before anything ever drew, or a long run of them later: stop and say so on screen.
      if (this.frameErrors >= (this.running ? 30 : 3)) {
        this.halted = true;
        if (window.__sandlotBoot) window.__sandlotBoot.fail('frame', err);
      }
    }
  }

  // Advance the whole game by `realDt` real seconds (optionally without drawing).
  tick(realDt, render = true) {
    const e = this.engine;
    this.time += realDt;
    let simDt = 0;
    // aim
    if (e) {
      this.updateBatting(e, realDt);
      this.updateBasePad(e);
      // the Steal button is only there while a runner could go
      const can = e.canSteal && !this.paused, on = e.stealArmed || !!(e.steal && (e.phase === 'windup' || e.phase === 'pitch'));
      if (can !== this.stealShown || on !== this.stealOn) { this.stealShown = can; this.stealOn = on; this.ui.setSteal(can, on); }
    }
    if (e && !this.paused && !e.over || (e && e.phase === 'gameOver')) {
      if (this.hitStop > 0) { this.hitStop -= realDt; simDt = 0; }
      else {
        let scale = 1;
        if (this.slowMo) {
          const s = this.slowMo;
          if (s.delay > 0) s.delay -= realDt;
          else {
            s.t += realDt;
            const k = clamp(s.t / s.dur, 0, 1);
            scale = lerp(s.scale ?? CONFIG.feel.slowMoScale, 1, k * k);
            if (s.t >= s.dur) this.slowMo = null;
          }
        }
        if (this.fast && (e.phase === 'play' || e.phase === 'aiSummary')) scale = CONFIG.pace.fastForward;
        else if (e.phase !== 'play') this.fast = false;
        simDt = realDt * scale;
      }
      if (simDt > 0) {
        // step in small pieces so fast-forward never skips events
        let rem = simDt;
        while (rem > 1e-6) {
          const step = Math.min(rem, 1 / 60);
          e.update(step);
          if (this.bot) this.bot.update();
          rem -= step;
        }
      }
    }
    const eng = e || this.demo;
    this.actors.viewH = this.S.size.h;
    this.actors.update(eng, simDt, eng.time);
    const camDt = this.fast ? Math.min(realDt * 3, 0.1) : realDt;
    if (this.screen === 'game' || this.screen === 'over') this.cam.update(camDt, e, this.actors, this.S.size.aspect);
    else this.cam.update(camDt, null, this.actors, this.S.size.aspect);
    const cam = this.S.camera;
    // ball trail + effects use real time
    this.ball.updateTrail(realDt, cam, this.S.size.h, this.actors.trailPts);
    this.fx.update(realDt, cam, this.S.size.h);
    this.S.env.update(realDt, cam);
    this.S.stadium.update(realDt, this.time, this.S.env);
    // Rookie "swing now" cue: the strike-zone box lights up and a green ring closes in on it at the ideal moment to press the button
    if (this.zoneParts) {
      const zp = this.zoneParts;
      let w = 0, k = 0;
      if (e && e.phase === 'pitch' && e.pitch && e.d.swingCue && !e.swing) {
        const dtIdeal = e.time - (e.pitch.tCross - CONFIG.timing.swingDelay);
        w = Math.exp(-Math.pow(dtIdeal / 0.055, 2));
        k = clamp(1 - Math.abs(dtIdeal) / 0.25, 0, 1);
      }
      zp.edge.material.color.setRGB(1 - 0.65 * w, 1, 1 - 0.55 * w);
      zp.edge.material.opacity = 0.85 + 0.15 * w;
      zp.fill.material.opacity = 0.07 + 0.3 * w;
      zp.fill.material.color.setRGB(1 - 0.6 * w, 1, 1 - 0.5 * w);
      this.zone.scale.setScalar(1 + 0.08 * w);
      zp.cue.visible = k > 0.02;
      if (zp.cue.visible) {
        zp.cue.material.opacity = 0.95 * k;
        // starts wide and closes in; when dtIdeal is 0 it sits right around the zone
        const dtI = e.time - (e.pitch.tCross - CONFIG.timing.swingDelay);
        zp.cue.scale.setScalar(1 + clamp(-dtI / 0.25, 0, 1) * 0.9 + clamp(dtI / 0.25, 0, 1) * 0.3);
      }
    }
    // pitch guide: a soft circle that guesses where the pitch will cross the plate (fades in late, a little off; every mode)
    if (e && e.phase === 'pitch' && e.pitch && e.time < e.pitch.tCross && this.settings.pitchGuide && this.screen === 'game') {
      this.guide.show(pitchGuide(e.pitch, e.time - e.pitch.tRelease, CONFIG, e.difficulty));
    } else this.guide.hide();
    // landing spot ring: shrinks as the ball in the air comes down; gone when it lands or is caught
    if (this.landing && e && e.phase === 'play' && e.play && this.settings.landingRing && this.screen === 'game') {
      this.landRing.show(landingRing(this.landing, e.time - e.play.t0, CONFIG), cam);
    } else { this.landRing.hide(); if (!(e && e.phase === 'play')) this.landing = null; }
    // pitch marker fade
    if (this.pitchMarker.visible) {
      this.markerT += realDt;
    }
    if (render) this.S.renderer.render(this.S.scene, cam);
    window.__frames = (window.__frames || 0) + 1;
  }
}

function F_HR() { return CONFIG.feel.shakeHomer; }
// Give the browser a moment to paint (the loading bar) between startup stages. Animation frames never fire in a hidden tab,
// so a short timer is the backstop.
function breathe() {
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 60);
  });
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function blurFocus() { try { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) { /* ignore */ } }
