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
import { lineScore } from './game/rules.js';
import { clamp, lerp, smoothstep } from './util/math.js';
import { zoneRatio } from './physics/pitch.js';

const LABEL = { fastball: 'Fastball', changeup: 'Changeup', curveball: 'Curveball', slider: 'Slider', heater: 'Heater' };

export class App {
  constructor(canvas, uiRoot, params = new URLSearchParams()) {
    this.params = params;
    this.canvas = canvas;
    this.prog = new Progress();
    this.audio = new AudioEngine();
    this.audio.muted = !this.prog.settings.sound;
    this.audio.volume = this.prog.settings.volume;

    const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (touch) document.body.classList.add('touch');
    this.touch = touch;

    this.S = createScene(canvas, { preserveDrawingBuffer: params.has('shot') });
    this.ball = createBall(this.S.scene);
    this.fx = createEffects(this.S.scene);
    this.actors = new Actors(this.S.scene, this.ball, this.fx);
    this.cam = new CameraRig(this.S.camera);
    this.cam.title = true;
    this.makeZoneOverlay();

    this.ui = new UI(uiRoot, (a, d) => this.onAction(a, d));
    this.engine = null;
    this.bot = null;
    this.screen = 'title';
    this.paused = false;
    this.hitStop = 0;
    this.slowMo = null;
    this.fast = false;
    this.mode = null;
    this.lastMode = null;
    this.aimKeys = { left: false, right: false };
    this.aimTouch = 0;
    this.lastFrameStamp = performance.now();
    this.time = 0;
    this.rawDtMs = 16.7;
    this.pitchesThisGame = 0;
    this.callTimer = 0;

    // A quiet "demo" engine so the title screen shows a living ballpark
    this.demo = new Engine({ mode: 'practice', difficulty: 'pro', seed: 7 });
    this.actors.configure({ engine: this.demo, playerUniformKey: this.prog.data.equipped.uniform, batStyle: this.prog.data.equipped.bat });

    this.S.env.set(this.prog.settings.tod);
    this.applyStadiumMood();
    this.ui.buildTitle(this.prog);
    this.ui.show('title');
    this.ui.setMuteIcon(this.audio.muted);

    this.bindInput();
    this.loop = this.loop.bind(this);
    requestAnimationFrame((t) => { this.lastFrameStamp = t; this.last = t; requestAnimationFrame(this.loop); });

    // Test / QA shortcuts:  ?mode=quick&diff=pro&tod=night&bot=1&skiphow=1
    const qm = params.get('mode');
    if (params.get('tod')) { this.prog.settings.tod = params.get('tod'); this.S.env.set(params.get('tod')); }
    if (params.get('diff')) this.prog.settings.difficulty = params.get('diff');
    if (params.get('zone')) this.prog.settings.zone = params.get('zone') === '1';
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
  }

  applyStadiumMood() {
    // scoreboard gets the mode text / crowd reacts later
  }

  get settings() { return this.prog.settings; }

  // ---------------------------------------------------------------- menus
  onAction(a, d) {
    this.audio.unlock();
    switch (a) {
      case 'play':
        this.audio.uiClick();
        if (!this.settings.howtoSeen) { this.openHowTo(() => { this.goModes(); }); } else this.goModes();
        break;
      case 'howto': this.audio.uiClick(); this.openHowTo(() => { this.returnFrom = null; this.showMenuScreen(this.screen === 'game' ? 'pause' : (this.screen === 'modes' ? 'modes' : 'title')); }); break;
      case 'howtoPause': this.audio.uiClick(); this.openHowTo(() => this.ui.show('pause')); break;
      case 'howtoDone': this.audio.uiClick(); this.settings.howtoSeen = true; this.prog.save(); break;
      case 'back': this.audio.uiBack(); this.showMenuScreen(this.screen === 'locker' || this.screen === 'career' ? 'modes' : 'title'); break;
      case 'locker': this.audio.uiClick(); this.screen = 'locker'; this.ui.buildLocker(this.prog); this.ui.show('locker'); break;
      case 'career': this.audio.uiClick(); this.screen = 'career'; this.ui.buildCareer(this.prog); this.ui.show('career'); break;
      case 'resetSave': this.prog.reset(); this.ui.buildCareer(this.prog); break;
      case 'equip':
        if (this.prog.equip(d.kind, d.id)) {
          this.audio.uiClick();
          if (d.kind === 'bats') this.actors.setBatStyle(d.id);
          this.ui.buildLocker(this.prog);
          this.ui.show('locker');
        }
        break;
      case 'start': this.audio.uiClick(); this.startGame(d.mode); break;
      case 'setting': this.changeSetting(d.key, d.value); break;
      case 'pause': this.setPaused(true); break;
      case 'resume': this.setPaused(false); break;
      case 'restart': this.setPaused(false); this.startGame(this.mode); break;
      case 'playAgain': this.audio.uiClick(); this.startGame(this.lastMode); break;
      case 'quit': this.audio.uiBack(); this.quitToMenu(); break;
      case 'mute': this.toggleMute(); break;
      case 'skipSummary': if (this.engine) this.engine.skipSummary(); break;
      case 'aim': this.aimTouch = d; break;
      case 'practice': if (this.engine) { Object.assign(this.engine.practice, d); } break;
      default: break;
    }
  }

  openHowTo(after) {
    this.ui.buildHowTo(after);
    this.ui.show('howto');
  }

  showMenuScreen(name) {
    this.screen = name === 'pause' ? 'game' : name;
    if (name === 'title') { this.ui.buildTitle(this.prog); }
    if (name === 'modes') { this.ui.buildModes(this.prog); }
    this.ui.show(name);
  }

  goModes() {
    this.screen = 'modes';
    this.ui.buildModes(this.prog);
    this.ui.show('modes');
  }

  changeSetting(key, value) {
    this.audio.uiClick();
    this.prog.updateSettings({ [key]: value });
    if (key === 'tod') this.S.env.set(value, false);
    if (key === 'sound') { this.audio.setMuted(!value); this.ui.setMuteIcon(!value); }
    if (key === 'zone') { this.zone.visible = !!value && !!this.engine; }
    if (this.screen === 'modes') { this.ui.buildModes(this.prog); this.ui.show('modes'); }
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
    if (p) { this.ui.buildPause(this.settings); this.ui.show('pause'); }
    else { this.ui.hideAll(); this.lastFrameStamp = performance.now(); }
  }

  quitToMenu() {
    this.engine = null; this.bot = null; this.paused = false; this.fast = false; this.slowMo = null; this.hitStop = 0;
    this.ui.hideHud(); this.hideOverlays();
    this.cam.title = true;
    this.actors.configure({ engine: this.demo, playerUniformKey: this.prog.data.equipped.uniform, batStyle: this.prog.data.equipped.bat });
    this.fx.clear();
    this.S.env.set(this.settings.tod, false);
    this.goModes();
  }

  hideOverlays() { this.zone.visible = false; this.pitchMarker.visible = false; }

  // ---------------------------------------------------------------- starting a game
  startGame(mode) {
    if (!mode) mode = 'quick';
    this.lastMode = mode;
    this.mode = mode;
    const st = this.settings;
    const eng = new Engine({
      mode, difficulty: st.difficulty, hand: st.hand,
      practice: this.engine && this.engine.mode === 'practice' ? { ...this.engine.practice } : undefined,
      seed: this.params.get('seed') ? +this.params.get('seed') : undefined,
    });
    this.engine = eng;
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
    this.ui.setTeams({ abbr: PLAYER_TEAM.abbr, color: PLAYER_TEAM.color }, { abbr: eng.opponent.abbr, color: eng.opponent.color });
    this.ui.setMuteIcon(this.audio.muted);
    if (eng.game) this.ui.setGameState(eng.game);
    if (mode === 'derby') this.ui.setDerby({ ...eng.derby });
    if (mode === 'practice') this.ui.setPracticeButtons(eng.practice);
    this.zone.visible = !!st.zone;
    this.pitchMarker.visible = false;
    this.updateScoreboard();
    if (this.params.get('bot')) this.bot = createBot(eng, { errSd: +(this.params.get('sd') || 20), seed: 5 });
    else this.bot = null;
    eng.start();
    if (!this.prog.data.tipShown) {
      this.ui.hint(this.touch ? 'Tap anywhere to swing as the ball reaches the plate' : 'Press SPACE (or click) to swing as the ball reaches the plate', 4200);
      this.prog.data.tipShown = 1; this.prog.save();
    }
  }

  // ---------------------------------------------------------------- engine -> world hooks
  bindEngine(e) {
    const ui = this.ui, audio = this.audio, cam = this.cam, fx = this.fx;
    const F = CONFIG.feel;
    e.on('paStart', ({ batter }) => {
      ui.setBatter(batter);
      this.pitchMarker.visible = false;
      this.actors.loose.spent = false;
      this.actors.loose.active = false;
      this.actors.looseBat.visible = false;
      if (e.game) ui.setGameState(e.game);
      this.updateScoreboard();
    });
    e.on('count', (c) => { ui.setCount(c.balls, c.strikes, c.outs); this.updateScoreboard(); });
    e.on('windup', ({ pitch }) => {
      this.pitchMarker.visible = false;
      ui.hideBanner();
      ui.hideCallout();
      if (pitch.announce && e.mode !== 'derby') ui.showPitchInfo(LABEL[pitch.type], 0, true, 1500);
    });
    e.on('release', ({ pitch }) => {
      this.actors.fielders.P.root.updateMatrixWorld(true);
      const rh = this.actors.fielders.P.handWorld('R');
      this.fx.releaseGlint(rh.x, rh.y, rh.z);
      ui.showPitchInfo(pitch.announce ? LABEL[pitch.type] : '', pitch.speedMph, false, 1900);
    });
    e.on('swing', ({ swing, pitch, errorText }) => {
      audio.swingWhoosh();
      const txtGrade = { perfect: 'PERFECT', good: 'GOOD', early: 'EARLY', late: 'LATE', miss: swing.errorMs < 0 ? 'TOO EARLY' : 'TOO LATE' }[swing.grade];
      const w = classifyTiming(swing.errorMs, { windowScale: e.windowScale }).windows;
      let grade = swing.grade;
      ui.timing(swing.errorMs, grade, w, `${txtGrade}${grade === 'perfect' && Math.abs(swing.errorMs) < 3 ? '' : ' · ' + errorText}`);
      if (e.mode === 'practice') this.prog.recordPracticeSwing();
      ui.hideHint();
      void pitch;
    });
    e.on('whiff', ({ swing, reason }) => {
      if (reason === 'reach') ui.hint('Out of reach - lay off pitches away from the zone', 1600);
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
    e.on('pitchCall', ({ call }) => {
      if (call === 'ball') audio.ballCue();
      else if (call === 'calledStrike' || call === 'swingingStrike') { audio.strikeCue(); this.actors.strikeCall(e.time, e.count.strikes >= 2 || call === 'swingingStrike'); }
    });
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
      if (newInning && e.game && !e.over) ui.banner(`INNING ${inning}`, e.game.inning > e.game.innings ? 'Extra innings · runner on second' : `${e.opponent.name} in the field`, 'neutral');
    });
    e.on('gameOver', (p) => this.onGameOver(p));
  }

  onContact(c) {
    const e = this.engine, ui = this.ui, audio = this.audio, F = CONFIG.feel;
    const grade = c.grade;
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
    if (e.mode === 'practice') ui.callout([{ v: Math.round(c.exitVelocity), u: 'mph', l: 'Exit velocity' }, { v: Math.round(c.launchAngle), u: '°', l: 'Launch angle' }], 2400);
    // The follow-through swoosh already played; a big hit swells the crowd a little right away
    if (c.big) this.audio.crowdSwell(0.35, 2);
    this.lastContact = c;
  }

  onPlayEvent(ev) {
    const e = this.engine, audio = this.audio, ui = this.ui;
    const c = this.lastContact;
    switch (ev.type) {
      case 'landed':
        this.fx.dustPuff(ev.x, ev.z, 0.7, [0.6, 0.72, 0.42]);
        this.fx.grassBits(ev.x, ev.z, 1);
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
        if (this.settings.shake) this.cam.shake(F_HR());
        break;
      }
      case 'stands':
        this.fx.confetti(ev.x, ev.y + 4, ev.z, 60, 14);
        break;
      case 'catch':
        audio.glovePop(0.8);
        if (c && !c.homer) { audio.crowdSwell(c.big ? 0.55 : 0.28, 2); }
        if (ev.dive) {
          // a diving catch is a highlight: big crowd reaction and a banner
          audio.crowdSwell(0.95, 2.4);
          this.S.stadium.crowd.cheer(0.6);
          ui.banner('DIVING CATCH!', '', 'good');
          setTimeout(() => ui.hideBanner(), 1400);
        }
        break;
      case 'dive': {
        // launch: a beat of slow motion so you see the fielder leave his feet
        const H = CONFIG.fielding.dive.highlightSlowMo;
        this.slowMo = ev.catch ? { t: 0, dur: H.catchDur, delay: 0, scale: H.catchScale } : { t: 0, dur: H.stopDur, delay: 0, scale: H.stopScale };
        audio.crowdSwell(0.35, 1.2);
        break;
      }
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
      case 'outCall': audio.outCue(); break;
      default: break;
    }
    void e;
  }

  celebrateHomer(ev, dist) {
    const n = 3 + (dist > 420 ? 2 : 0);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const a = Math.atan2(ev.x, -ev.z) + (Math.random() - 0.5) * 0.9;
        const r = 330 + Math.random() * 140;
        this.fx.firework(Math.sin(a) * r, 70 + Math.random() * 70, -Math.cos(a) * r, null, 1 + Math.random() * 0.6);
      }, 150 + i * 230);
    }
    this.ui.flash(0.3, 160);
  }

  showDistanceCallout(c, isHr) {
    if (!c) return;
    const items = [{ v: Math.round(c.exitVelocity), u: 'mph', l: 'Exit velocity' }, { v: Math.round(isHr ? c.projected.distance : c.distance), u: 'ft', l: 'Distance' }];
    if (isHr || c.big) items.push({ v: Math.round(c.launchAngle), u: '°', l: 'Launch' });
    this.ui.callout(items, isHr ? 4200 : 3000);
  }

  onResult(r) {
    const e = this.engine, ui = this.ui, audio = this.audio;
    if (e.game) { ui.setGameState(e.game); this.updateScoreboard(); }
    const runsText = r.runs > 0 ? ` · ${r.runs} run${r.runs > 1 ? 's' : ''} score${r.runs > 1 ? '' : 's'}` : '';
    const count = e.game ? `${e.game.balls}-${e.game.strikes}` : '';
    if (r.kind === 'pitch') {
      const map = { ball: ['BALL', count, 'neutral'], calledStrike: ['STRIKE', count, 'bad'], swingingStrike: ['STRIKE', 'Swing and a miss', 'bad'], foul: ['FOUL', count, 'neutral'], take: ['', '', ''] };
      const m = map[r.call] || [r.text || '', '', 'neutral'];
      if (r.call === 'ball' || r.call === 'take') { /* subtle */ }
      if (m[0]) ui.banner(m[0], e.mode === 'quick' ? m[1] : (r.call === 'swingingStrike' ? 'Swing and a miss' : ''), m[2]);
      if (r.call === 'ball' && e.game && e.game.balls === 3) audio.crowdSwell(0.2, 1.2);
      return;
    }
    // plate appearance / play ended
    const res = r.result;
    let big = r.text, sub = '', cls = 'neutral';
    if (res === 'homer' || res === 'insideParkHomer') { cls = 'hr'; sub = `${Math.round(r.distanceFt || r.distance || 0)} ft${runsText}`; if (r.walkOff) sub = 'WALK-OFF!'; }
    else if (['single', 'double', 'triple'].includes(res)) { cls = 'good'; sub = `${Math.round(r.exitVelocity)} mph${runsText}`; audio.crowdSwell(res === 'single' ? 0.4 : 0.65, 2.2); audio.applause(1.2, 0.5); }
    else if (res === 'walk') { cls = 'neutral'; sub = runsText.replace(' · ', ''); audio.crowdSwell(0.2, 1.2); }
    else if (res === 'strikeoutSwinging' || res === 'strikeoutLooking') { cls = 'bad'; sub = res === 'strikeoutLooking' ? 'Caught looking' : 'Swinging'; audio.crowdGroan(0.7); }
    else if (res === 'out') { cls = 'bad'; sub = r.detail ? r.detail : ''; audio.crowdGroan(0.4); }
    else if (['groundout', 'flyout', 'lineout', 'popout', 'foulOut', 'doublePlay', 'fieldersChoice', 'sacFly'].includes(res)) {
      cls = res === 'sacFly' ? 'good' : 'bad'; sub = res === 'sacFly' ? `Run scores` : (r.text && res === 'doublePlay' ? 'Two outs on the play' : `${Math.round(r.exitVelocity || 0)} mph`);
      if (res !== 'sacFly') audio.crowdGroan(0.35);
      if (runsText) sub += runsText;
    }
    if (e.mode === 'practice' && r.kind === 'play') { big = r.text; sub = `${Math.round(r.exitVelocity)} mph · ${Math.round(r.distance)} ft`; cls = res === 'homer' ? 'hr' : 'neutral'; }
    if (e.mode === 'derby' && r.kind === 'play') {
      if (res === 'homer') { cls = 'hr'; big = 'HOME RUN'; sub = `${r.distanceFt} ft${r.streak > 1 ? ` · streak ${r.streak}` : ''}`; }
      else { cls = 'bad'; big = r.text.includes('FREE') ? r.text : 'OUT'; sub = r.detail || ''; }
    }
    if (res === 'homer' || res === 'insideParkHomer') { if (e.mode !== 'derby') ui.banner(big, sub, cls, true); else ui.banner(big, sub, cls, true); }
    else ui.banner(big, sub, cls);
    if (r.runs > 0 && res !== 'homer') audio.applause(1.6, 0.8);
  }

  onGameOver(p) {
    const e = this.engine;
    this.ui.hideHud();
    this.hideOverlays();
    this.audio.applause(2.4, 0.9);
    const { records, unlocked } = this.prog.recordGame(p);
    const g = p.game;
    if (g) g.line = lineScore(e.game);
    this.ui.buildTitle(this.prog);
    const names = { away: PLAYER_TEAM.name.toUpperCase().slice(0, 16), home: e.opponent.name.toUpperCase().slice(0, 18) };
    setTimeout(() => {
      this.ui.showGameOver(p, records, unlocked, names);
      if (unlocked.length) { this.audio.unlockChime(); this.ui.toast('🔓 Unlocked: ' + unlocked.map((u) => u.name).join(', '), 4200); }
    }, 900);
    this.screen = 'over';
  }

  updateScoreboard() {
    const e = this.engine;
    const sb = this.S.stadium.scoreboard;
    if (!e) { sb.set({ mode: 'quick', title: 'SANDLOT PARK', teams: [{ abbr: 'SLG', color: PLAYER_TEAM.color, runs: [], R: 0, H: 0, E: 0 }, { abbr: '---', runs: [], R: 0, H: 0, E: 0 }], count: { b: 0, s: 0, o: 0 }, innings: 3, message: 'PLAY BALL!', flash: 0 }); return; }
    if (e.mode === 'quick' && e.game) {
      const g = e.game;
      const ls = lineScore(g);
      sb.set({
        mode: 'quick', title: 'SANDLOT PARK', innings: Math.max(g.innings, g.inning), inning: g.inning, half: g.half,
        teams: [{ abbr: PLAYER_TEAM.abbr, color: PLAYER_TEAM.color, runs: ls.top, R: g.score.top, H: g.hits.top, E: 0 }, { abbr: e.opponent.abbr, color: e.opponent.color, runs: ls.bottom, R: g.score.bottom, H: g.hits.bottom, E: 0 }],
        count: { b: g.balls, s: g.strikes, o: g.outs },
      });
    } else if (e.mode === 'derby') {
      sb.set({ mode: 'derby', title: 'SANDLOT PARK', derby: { hr: e.derby.hr, outsLeft: Math.max(0, e.derby.maxOuts - e.derby.outs), longest: e.derby.longest, streak: e.derby.streak } });
    } else {
      sb.set({ mode: 'practice', title: 'SANDLOT PARK', practice: {} });
    }
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const swing = (ev) => this.swingInput(ev);
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
      this.audio.unlock();
      switch (e.code) {
        case 'Space': case 'Enter': e.preventDefault(); if (this.screen === 'game') swing(e); else if (this.screen === 'title') { this.onAction('play'); } break;
        case 'Escape': case 'KeyP': if (this.screen === 'game') this.setPaused(!this.paused); else if (['howto', 'locker', 'career'].includes(this.screen)) this.onAction('back'); break;
        case 'KeyM': this.toggleMute(); break;
        case 'KeyZ': this.changeSetting('zone', !this.settings.zone); this.zone.visible = this.settings.zone && !!this.engine; if (!this.settings.zone) this.pitchMarker.visible = false; break;
        case 'ArrowLeft': case 'KeyA': e.preventDefault(); this.aimKeys.left = true; break;
        case 'ArrowRight': case 'KeyD': e.preventDefault(); this.aimKeys.right = true; break;
        case 'ArrowUp': if (this.engine && this.engine.mode === 'practice') { e.preventDefault(); this.practiceSpeed(+2); } break;
        case 'ArrowDown': if (this.engine && this.engine.mode === 'practice') { e.preventDefault(); this.practiceSpeed(-2); } break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6':
          if (this.engine && this.engine.mode === 'practice') {
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
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (this.screen === 'game') { e.preventDefault(); swing(e); }
    });
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(ev, () => this.audio.unlock(), { passive: true });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.screen === 'game' && !this.paused && this.engine && !this.engine.over) this.setPaused(true); });
    window.addEventListener('blur', () => { this.aimKeys.left = this.aimKeys.right = false; });
  }

  practiceSpeed(d) {
    const p = this.engine.practice;
    p.speed = clamp(p.speed + d, CONFIG.modes.practice.speedMin, CONFIG.modes.practice.speedMax);
    this.ui.setPracticeButtons(p);
  }

  swingInput(ev) {
    const e = this.engine;
    if (!e || this.paused || e.over) return;
    if (this.ui.current && this.ui.current !== 'game') return;
    switch (e.phase) {
      case 'pitch': {
        let stamp = ev && ev.timeStamp;
        if (!stamp || stamp > 1e12) stamp = performance.now();
        const since = this.hitStop > 0 ? 0 : clamp((stamp - this.lastFrameStamp) / 1000, -0.02, 0.05);
        e.swingPressed(since);
        break;
      }
      case 'play': this.fast = true; break;
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
      const aim = clamp((this.aimKeys.right ? 1 : 0) - (this.aimKeys.left ? 1 : 0) + this.aimTouch, -1, 1);
      e.setAim(aim);
      this.ui.setAim(aim, e.batterHand);
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
    this.actors.update(eng, simDt, eng.time);
    const camDt = this.fast ? Math.min(realDt * 3, 0.1) : realDt;
    if (this.screen === 'game' || this.screen === 'over') this.cam.update(camDt, e, this.actors, this.S.size.aspect);
    else this.cam.update(camDt, null, this.actors, this.S.size.aspect);
    const cam = this.S.camera;
    // ball trail + effects use real time
    this.ball.updateTrail(realDt, cam, this.S.size.h, this.actors.trailPts);
    this.fx.update(realDt, cam, this.S.size.h);
    this.S.env.update(realDt, cam);
    const night = this.S.env.name === 'night' ? 1 : this.S.env.name === 'dusk' ? 0.4 : 0;
    this.ball.setHaloBoost(1 + night * 0.6);
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
    // pitch marker fade
    if (this.pitchMarker.visible) {
      this.markerT += realDt;
    }
    if (render) this.S.renderer.render(this.S.scene, cam);
    window.__frames = (window.__frames || 0) + 1;
  }
}

function F_HR() { return CONFIG.feel.shakeHomer; }
