// The game engine: one pitch after another, swing handling, plays, counts, innings and modes.
// It knows nothing about graphics: it just advances a clock (update(dt)), accepts a swing
// (swingPressed) and announces what happens through events. The renderer, HUD and audio listen.
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { buildPitch, isStrike, zoneRatio } from '../physics/pitch.js';
import { clamp } from '../util/math.js';
import { simulateBattedBall, projectDistance } from '../physics/ballistics.js';
import { resolveSwingTimes, describeError } from './timing.js';
import { computeSwing, computeBunt, derbyBatting, contactWindow, contactPoint, scaleWindow } from './contact.js';
import { choosePitch, pitchWindowScale } from './pitcherAI.js';
import { createDefense, planPlay, sendOptions, planSteal, fielderBackTime } from './fielding.js';
import * as rules from './rules.js';
import { simulateHalf } from './aiHalf.js';
import { makeLineup, makePitcher, PLAYER_TEAM } from './teams.js';
import { MLB_TEAMS, teamName, uniformFor, teamLineup } from './mlb.js';
import { ratingEffects } from './season.js';

export class Engine {
  /**
   * @param {object} o
   * @param {'quick'|'derby'|'practice'} o.mode
   * @param {'rookie'|'pro'|'allstar'} o.difficulty
   * @param {number} [o.seed]
   * @param {'R'|'L'|'auto'} [o.hand]   the player's batting side ('auto' = each lineup batter has their own)
   * @param {object} [o.practice]       { type, speed, location }
   * @param {object} [o.opponent]       team from teams.js
   * @param {number} [o.inputDelayMs]   swing timing adjustment: ms taken off every press (laggy screens / controllers)
   * @param {boolean} [o.waitForBatter] hold the first pitch to each new batter until batterReady() is called
   * Season games also pass:
   * @param {number} [o.innings]        game length (default modes.quick.innings)
   * @param {'top'|'bottom'} [o.playerSide] which half you bat in a game: 'bottom' (you are the home team and bat last; the default) or 'top'
   * @param {Array}  [o.lineup]         your nine batters, in order (Season players carry con / pow / spd ratings)
   * @param {Array}  [o.oppLineup]      the other team's names
   * (and the config itself - `cfg` - is the Season's one for this opponent: see season.gameConfig)
   */
  constructor(o = {}, cfg = CONFIG) {
    this.cfg = cfg;
    this.mode = o.mode || 'quick';
    this.difficulty = o.difficulty || 'pro';
    this.d = cfg.difficulty[this.difficulty];
    this.seed = o.seed ?? ((Math.random() * 2 ** 32) >>> 0);
    this.rng = createRng(this.seed);
    this.handSetting = o.hand || 'auto';
    // Swing timing adjustment (Settings): a screen or controller that lags reports every press this much late, so it is taken off.
    this.inputDelay = Math.max(0, Math.min(cfg.timing.inputDelayMaxMs, o.inputDelayMs || 0)) / 1000;
    // Wait for the player before the first pitch to each new batter (a "Ready" button); off for tests and the bot.
    this.waitForBatter = !!o.waitForBatter;
    this.batterReadyFlag = true;
    this.buntStance = false; // squared around to bunt (B): the swing button then pushes the bat at the ball
    this.stealArmed = false; // the runners will go on the next pitch (S)
    this.steal = null; // this pitch's steal attempt: { bases, start: { base: engine time he took off } }
    this.practice = { type: 'fastball', speed: cfg.modes.practice.speedDefault, location: 'random', ...(o.practice || {}) };
    const oppTeam = MLB_TEAMS[this.rng.int(0, MLB_TEAMS.length - 1)];
    this.opponent = o.opponent || { id: oppTeam.id, name: teamName(oppTeam), abbr: oppTeam.abbr, color: oppTeam.color, uniform: uniformFor(oppTeam, 'away') };
    this.playerTeam = o.playerTeam || PLAYER_TEAM; // (League games: your own big-league club, with its own jersey)

    this.lineup = o.lineup ? o.lineup.map((b) => ({ ...b })) : makeLineup(this.seed, 'p');
    this.oppLineup = o.oppLineup || (o.opponent ? makeLineup(this.seed ^ 0x5bd1e995, 'o') : teamLineup(oppTeam, this.seed, 'o'));
    if (this.handSetting !== 'auto') for (const b of this.lineup) b.hand = this.handSetting;
    this.pitcher = makePitcher(this.seed);
    this.defense = createDefense(cfg, this.rng);

    this.time = 0;
    this.phase = 'idle';
    this.phaseSince = 0;
    this.fieldersSetAt = 0; // no pitch before this time: the pitcher and catcher are back in place and set (see finishPlay)
    this.listeners = {};
    this.aim = 0;
    this.batAim = { x: 0, y: cfg.timing.zoneCenterY }; // where the bat's sweet spot is aimed (see setBatAim)
    this.pitch = null;
    this.swing = null;
    this.play = null;
    this.pitchCount = 0;
    this.lastType = null;
    this.readyUntil = 0;
    this.resultUntil = 0;
    this.summaryUntil = 0;
    this.pendingNext = null;
    this.paEnded = false;
    this.lastPA = null;
    this.pitchOverride = null;
    this.contactOverride = null; // QA / demo hook: (engine) => ({ exitVelocity, launchAngle, sprayAngle, backspin, hook }) forces an exact batted ball
    this.aiSummary = null;
    this.lastPlayResult = null;
    this.over = false;

    // You are the home team: the computer bats first (its half is played out instantly) and you always get the last at-bat.
    this.playerSide = this.mode === 'quick' ? (o.playerSide || 'bottom') : 'top';
    this.oppSide = this.playerSide === 'top' ? 'bottom' : 'top';
    this.game = this.mode === 'quick' ? rules.createGame({ innings: o.innings ?? cfg.modes.quick.innings, extraRunner: cfg.modes.quick.extraInningRunner }) : null;
    // Practice keeps runners on base and counts the runs of the session - but nobody is ever out for good (outs reset every play)
    this.pgame = this.mode === 'practice' ? rules.createGame({ innings: 1e6, extraRunner: false }) : null;
    this.derby = { outs: 0, maxOuts: cfg.modes.derby.outs, hr: 0, streak: 0, bestStreak: 0, longest: 0, results: [] };
    this.stats = newStats();
    this.lines = {}; // each batter's line today: { pa, ab, h, hr, rbi, bb, k } by batter id
    this.batterIndex = 0;
    this.batter = this.lineup[0];
  }

  // ------------------------------------------------------------------ events
  on(name, fn) {
    (this.listeners[name] ||= []).push(fn);
    return () => { this.listeners[name] = this.listeners[name].filter((f) => f !== fn); };
  }
  emit(name, data) {
    const l = this.listeners[name];
    if (l) for (const fn of l) fn(data);
    const all = this.listeners['*'];
    if (all) for (const fn of all) fn(name, data);
  }

  // ------------------------------------------------------------------ helpers
  get count() { return this.game ? { balls: this.game.balls, strikes: this.game.strikes } : { balls: 0, strikes: 0 }; }
  get outs() { return this.game ? this.game.outs : this.derby.outs; }
  get bases() { return this.diamond ? this.diamond.bases : [null, null, null]; }
  get diamond() { return this.game || this.pgame; } // the game state that has runners on base (quick game, practice)
  get pitchTime() { return this.pitch ? this.time - this.pitch.tRelease : -1; }
  get playTime() { return this.play ? this.time - this.play.t0 : -1; }
  get batterHand() { return this.batter.hand || 'R'; }
  get windowScale() { return this.d.windowScale * (this.mode === 'derby' ? 1.12 : 1); }

  setPhase(p) { this.phase = p; this.phaseSince = this.time; }
  setAim(v) { this.aim = Math.max(-1, Math.min(1, v)); }
  // Where the sweet spot of the bat is aimed (ft, in the plane over the front of the plate). The cursor sets it; it is held inside
  // the area the batter can reach.
  setBatAim(x, y) {
    const R = this.cfg.swing.reach;
    this.batAim.x = Math.max(-R.x, Math.min(R.x, x));
    this.batAim.y = Math.max(R.yMin, Math.min(R.yMax, y));
    return this.batAim;
  }
  // The bat's contact window for this batter (the level, his Contact rating, the Derby's batting practice).
  get contactWindow() {
    const w = contactWindow(this.difficulty, this.cfg);
    const k = ratingEffects(this.batter, this.cfg).window * (this.mode === 'derby' ? this.cfg.modes.derby.windowGrow : 1);
    return scaleWindow(w, k);
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    if (this.phase !== 'idle') return;
    this.emit('gameStart', { mode: this.mode });
    if (this.game && this.game.half !== this.playerSide) return this.runAiHalf(); // the visitors bat first
    this.beginPlateAppearance(true);
  }

  // A save point at the start of every pitch (a Season game saves here, so quitting never throws a game away - or lets you replay
  // it): the random numbers are re-seeded from the game's seed, so a game that is resumed throws exactly the same pitch.
  checkpoint() {
    this.rngN = (this.rngN || 0) + 1;
    this.rng = createRng((this.seed ^ Math.imul(this.rngN, 0x9e3779b1)) >>> 0);
    if (this.game) this.emit('checkpoint', this.saveState());
  }
  saveState() {
    return JSON.parse(JSON.stringify({ rngN: this.rngN, game: this.game, stats: this.stats, lines: this.lines, pitchCount: this.pitchCount, lastType: this.lastType }));
  }
  // Carry on from a saved state: the same score, outs, runners, count, lineup spot and numbers; the batter's Ready card comes up first.
  resume(st) {
    if (this.phase !== 'idle') return;
    this.rngN = st.rngN;
    this.rng = createRng((this.seed ^ Math.imul(this.rngN, 0x9e3779b1)) >>> 0);
    const g = st.game;
    g.bases = g.bases.map((b) => (b && b.id !== undefined ? this.lineup.find((p) => p.id === b.id) || b : b)); // (runners are the lineup's own players again)
    this.game = g;
    this.stats = st.stats; this.lines = st.lines; this.pitchCount = st.pitchCount; this.lastType = st.lastType;
    this.emit('gameStart', { mode: this.mode, resumed: true });
    this.beginPlateAppearance(true, true);
  }

  beginPlateAppearance(first = false, quiet = false) {
    if (this.diamond) {
      this.batterIndex = this.diamond.lineupIdx[this.diamond.half] % 9;
      this.batter = this.lineup[this.batterIndex];
    } else {
      this.batter = this.lineup[0];
    }
    this.pitch = null; this.swing = null; this.play = null;
    this.setPhase('ready');
    this.readyUntil = this.time + (first ? this.cfg.pace.firstPitchDelay + 0.3 : this.cfg.pace.firstPitchDelay * 0.65);
    this.batterReadyFlag = !this.waitForBatter;
    this.setBunt(false);
    this.steal = null; this.setSteal(false);
    this.emit('paStart', { batter: this.batter, index: this.batterIndex, count: this.count, waiting: !this.batterReadyFlag });
    this.emitCount();
    if (!quiet) this.checkpoint();
  }

  emitCount() {
    this.emit('count', { balls: this.count.balls, strikes: this.count.strikes, outs: this.outs });
  }

  // ------------------------------------------------------------------ the tick
  update(dt) {
    if (this.over && this.phase === 'gameOver') return;
    this.time += dt;
    switch (this.phase) {
      case 'ready':
        // the next pitch waits for the batter AND for the pitcher (and catcher) to be back in place and set
        if (this.batterReadyFlag && this.time >= this.readyUntil && this.time >= this.fieldersSetAt) this.startWindup();
        break;
      case 'windup':
        if (this.time >= this.pitch.tRelease) this.release();
        break;
      case 'pitch':
        this.updatePitch();
        break;
      case 'play':
        this.updatePlay();
        break;
      case 'result':
        if (this.time >= this.resultUntil) this.afterResult();
        break;
      case 'aiSummary':
        if (this.time >= this.summaryUntil) this.afterAiSummary();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ pitching
  startWindup() {
    // (`pitchOverride` lets tests and demos throw an exact pitch)
    const p = this.pitchOverride ? this.pitchOverride(this) : choosePitch({
      mode: this.mode, difficulty: this.difficulty, count: this.count, rng: this.rng,
      batterHand: this.batterHand, pitcherHand: this.pitcher.hand, practice: this.practice, lastType: this.lastType,
    }, this.cfg);
    if (!p.tell) p.tell = { slot: 0, lag: 0 };
    const hand = this.pitcher.hand;
    const flight = buildPitch({
      type: p.type, speedMph: p.speedMph, hand, target: p.target,
      movementScale: this.mode === 'derby' ? 0.4 : this.d.movementScale, pace: this.d.pitchPace || 1,
    }, this.cfg);
    let windup = this.d.windup + (this.difficulty === 'allstar' ? this.rng.range(-0.03, 0.04) : 0);
    if (this.mode === 'derby') windup = 0.8;
    const tRelease = this.time + windup;
    this.lastType = p.type;
    this.pitchCount++;
    this.pitch = {
      id: this.pitchCount,
      type: p.type, speedMph: p.speedMph, plateSpeedMph: flight.plateSpeedMph, target: p.target, intendedStrike: p.intendedStrike,
      tell: p.tell, announce: p.announce, flight, hand,
      tWindup: this.time, windupDur: windup, tRelease,
      tCross: tRelease + flight.T, tCatch: tRelease + flight.tCatch,
      isStrike: isStrike(p.target.x, p.target.y, this.cfg),
      resolved: false, caught: false,
    };
    this.swing = null;
    // runners told to steal go with the pitcher's first move (a jump that is a little better or worse each time)
    this.steal = null;
    if (this.stealArmed) this.beginSteal();
    this.setPhase('windup');
    this.emit('windup', { pitch: this.pitch, duration: windup });
  }

  release() {
    this.setPhase('pitch');
    this.emit('release', { pitch: this.pitch });
  }

  // The player is ready for the first pitch to this batter. Returns true when the game was waiting for it.
  batterReady() {
    if (this.batterReadyFlag) return false;
    this.batterReadyFlag = true;
    this.readyUntil = Math.max(this.readyUntil, this.time + this.cfg.pace.afterReady);
    this.emit('batterReady', { batter: this.batter });
    return true;
  }
  get awaitingBatter() { return this.phase === 'ready' && !this.batterReadyFlag; }

  // Square around to bunt (or pull back). Any time before the swing, not in the Derby. Returns the stance now.
  setBunt(on) {
    const can = this.mode !== 'derby' && !this.swing && ['idle', 'ready', 'windup', 'pitch', 'halfBreak'].includes(this.phase);
    const v = !!on && can;
    if (v !== this.buntStance) { this.buntStance = v; this.emit('buntStance', { on: v }); }
    return this.buntStance;
  }

  // Which runners could steal right now: a runner with an empty base ahead of him (or one that is being emptied by the runner
  // ahead also going). Nobody steals home. Quick games only.
  stealBases() {
    const g = this.diamond;
    if (!g || g.outs >= 3) return [];
    const b = g.bases;
    const out = [];
    if (b[1] && !b[2]) out.push(2);
    if (b[0] && (!b[1] || out.includes(2))) out.push(1);
    return out;
  }
  get canSteal() { return this.stealBases().length > 0 && (this.phase === 'ready' || this.phase === 'windup' || this.phase === 'result' || this.phase === 'halfBreak'); }
  // Tell the runners to go on the next pitch (or call it off). Before the pitch is thrown only. Returns whether they will go.
  setSteal(on) {
    let v = !!on && this.canSteal;
    if (this.phase === 'windup') {
      if (v && !this.steal) this.beginSteal(); // decided during the windup: a late jump
      if (!v && this.steal && Object.values(this.steal.start).some((t) => t <= this.time)) v = true; // he has already gone
      if (!v) this.steal = null;
    }
    if (v !== this.stealArmed) { this.stealArmed = v; this.emit('stealArmed', { on: v, bases: v ? this.stealBases() : [] }); }
    return this.stealArmed;
  }
  // The runners take off with the pitcher's first move (a jump that is a little better or worse each time).
  beginSteal() {
    const going = this.stealBases();
    if (!going.length || !this.pitch) return;
    const S = this.cfg.steal;
    const pitch = this.pitch;
    const start = {};
    // (the pitch takes longer to arrive than a real one at its speed - `pitchPace`, to make it easier to hit: the runner's break moves
    // later by the same amount, so a steal is exactly as hard as it was tuned to be)
    const paceLag = pitch.flight.T * (1 - 1 / (pitch.flight.pace || 1));
    for (const b of going) start[b] = Math.max(this.time, pitch.tRelease - (this.d.stealBreak ?? 1) + paceLag + (S.jump[b] - S.jump[1]) + this.rng.gauss(0, S.jumpSd));
    // the catcher's exchange is rolled now too (so the whole steal can be planned as the runner goes and the infielder covering
    // the bag is seen breaking for it during the pitch); a pitch in the dirt has to be blocked first
    const dirt = pitch.target.y < 1.1;
    const transfer = Math.max(0.5, (S.transfer + this.rng.gauss(0, S.transferSd)) * (this.d.catcherArm ?? 1)) + (dirt ? S.dirtExtra : 0);
    const coverStart = Math.min(...Object.values(start)) + S.coverReact - pitch.tCatch;
    this.steal = { bases: going, start, transfer, coverStart };
    this.steal.plan = this.planStealNow();
    this.emit('stealGo', { bases: going });
  }
  planStealNow() {
    const s = this.steal;
    const running = Object.fromEntries(s.bases.map((b) => [b, s.start[b] - this.pitch.tCatch]));
    return planSteal({ bases: this.bases, outs: this.outs, defense: this.defense, running, transfer: s.transfer, coverStart: s.coverStart, speeds: this.runnerSpeeds() }, this.cfg);
  }
  // How fast the batter (0) and each runner (1-3) are (Season players' Speed rating; everyone else 1).
  runnerSpeeds() {
    const out = { 0: ratingEffects(this.batter, this.cfg).speed };
    this.bases.forEach((r, i) => { out[i + 1] = r && typeof r === 'object' ? ratingEffects(r, this.cfg).speed : 1; });
    return out;
  }

  // Player input. `sinceUpdate` = seconds between the last engine update and the actual input event
  // (so timing does not depend on frame rate). Returns true if the swing was accepted.
  swingPressed(sinceUpdate = 0) {
    if (this.phase !== 'pitch' || this.swing || !this.pitch) return false;
    if (this.buntStance) return false; // (squared around to bunt, he bunts by himself - see autoBunt)
    const tPress = this.time + Math.max(-0.02, Math.min(0.05, sinceUpdate)) - this.inputDelay;
    return this.commitSwing(tPress, { x: this.batAim.x, y: this.batAim.y }, false);
  }

  // Squared around to bunt, the batter holds the bat out and meets the pitch by himself - a little before it arrives he pushes the bat
  // at it (his timing a touch off now and then, the bat mostly on top of the ball: a good bunt, sometimes a pop-up or a foul). A pitch
  // well out of the zone he pulls the bat back on and takes. The bunt goes up the line that moves the runners (third-base line with
  // a runner on second, first-base line otherwise).
  autoBunt() {
    const pitch = this.pitch, B = this.cfg.bunt;
    pitch.buntDecided = true;
    if (zoneRatio(pitch.target.x, pitch.target.y, this.cfg) > B.offerRatio) return false; // (he pulls the bat back)
    const errorMs = clamp(this.rng.gauss(0, B.autoTimingSd), -B.windowMs[1] * 0.8, B.windowMs[1] * 0.8);
    const tPress = pitch.tCross + errorMs / 1000 - this.cfg.timing.swingDelay;
    const win = this.contactWindow, up = win.up * B.windowScale;
    const aim = { x: pitch.target.x + this.rng.gauss(0, B.autoAimSd), y: pitch.target.y + B.autoOnTop * up + this.rng.gauss(0, B.autoAimSd) };
    const thirdLine = -1; // (spray: negative = the left-field / third-base side)
    const side = this.bases[1] && !this.bases[2] ? thirdLine : -thirdLine;
    return this.commitSwing(tPress, aim, true, side);
  }

  commitSwing(tPress, aim, bunting, buntSide = 0) {
    const pitch = this.pitch;
    const times = resolveSwingTimes(tPress, pitch.tCross, this.cfg);
    const eff = ratingEffects(this.batter, this.cfg); // (Season players: Contact widens the timing windows and the bat's contact window, Power adds exit velocity)
    const windowScale = this.windowScale * eff.window;
    // where the ball is when the bat gets there (its height there is what the bat has to meet), how it is moving and spinning
    const { ball, vBall, wBall } = contactPoint(pitch.flight, times.hitTime - pitch.tRelease, times.barrelTime - pitch.tRelease, this.cfg);
    // (the bat is committed where it was aimed when he swung)
    const window = this.contactWindow;
    const contact = bunting
      ? computeBunt({ errorMs: times.errorMs, ball, aim, window, windowScale, batterHand: this.batterHand, side: buntSide, rng: this.rng }, this.cfg)
      : computeSwing({
        errorMs: times.errorMs, ball, aim, window, vBall, wBall,
        windowScale, speedScale: pitchWindowScale(pitch.type), batterHand: this.batterHand, batBonus: this.d.batBonus || 0,
        ...(this.mode === 'derby' ? derbyBatting(this.cfg) : { evBonus: eff.ev }),
        rng: this.rng,
      }, this.cfg);
    if (this.contactOverride) { delete contact.reason; Object.assign(contact, { made: true, grade: 'good' }, this.contactOverride(this)); }
    // The bat only meets the ball at the clamped time when contact is made; a miss swings through at the true time.
    const tHit = contact.made ? times.hitTime : times.barrelTime;
    this.swing = {
      tPress, tBarrel: times.barrelTime, tHit, errorMs: times.errorMs,
      grade: contact.grade, made: contact.made, contact, resolved: false,
      follow: this.cfg.timing.followThrough, bunt: bunting, aim, ball,
    };
    if (bunting) this.stats.bunts++; else this.stats.swings++;
    this.emit('swing', { swing: this.swing, pitch, errorText: describeError(times.errorMs) });
    return true;
  }

  updatePitch() {
    const pitch = this.pitch;
    if (this.buntStance && !this.swing && !pitch.buntDecided && this.time >= pitch.tCross - this.cfg.timing.swingDelay - this.cfg.bunt.autoLead) this.autoBunt();
    const s = this.swing;
    if (s && !s.resolved && this.time >= s.tHit) {
      s.resolved = true;
      if (s.made) return this.resolveContact();
      this.emit('whiff', { swing: s, pitch, reason: s.contact.reason, errorMs: s.errorMs });
    }
    if (!pitch.caught && this.time >= pitch.tCatch) {
      pitch.caught = true;
      this.emit('catch', { pitch, swung: !!s });
      this.resolvePitchNoContact();
    }
  }

  // ------------------------------------------------------------------ pitch results without contact
  resolvePitchNoContact() {
    const pitch = this.pitch;
    const swung = !!this.swing;
    this.stats.pitchesSeen++;
    if (swung) this.stats.whiffs++;
    const info = { pitch, swung, strike: pitch.isStrike, errorMs: this.swing ? this.swing.errorMs : null, grade: this.swing ? this.swing.grade : null };

    if (this.mode === 'practice') {
      const call = swung ? 'swingingStrike' : pitch.isStrike ? 'calledStrike' : 'ball';
      this.emit('pitchCall', { ...info, call });
      this.emit('result', { kind: 'pitch', call, text: swung ? 'SWING & MISS' : (pitch.isStrike ? 'STRIKE' : 'BALL'), ...info });
      if (this.steal) return this.startStealPlay({ paEnded: false, halfOver: false, result: call });
      this.finishPitch(this.cfg.pace.callDisplay);
      return;
    }
    if (this.mode === 'derby') {
      if (!swung) {
        this.emit('pitchCall', { ...info, call: 'take' });
        this.emit('result', { kind: 'pitch', call: 'take', text: 'TAKE', ...info });
        this.finishPitch(0.35);
        return;
      }
      this.emit('pitchCall', { ...info, call: 'swingingStrike' });
      return this.derbyNonHomer('swing and miss', 'whiff', info);
    }

    // quick game
    const g = this.game;
    let res;
    if (swung) res = rules.pitchStrike(g, { swinging: true });
    else if (pitch.isStrike) res = rules.pitchStrike(g, { swinging: false });
    else res = rules.pitchBall(g, this.batter);
    const call = swung ? 'swingingStrike' : pitch.isStrike ? 'calledStrike' : 'ball';
    this.emit('pitchCall', { ...info, call, result: res.result, strikes: g.strikes, balls: g.balls });
    this.emitCount();
    // runners were going: the catcher tries to throw one out (not after ball four - they are waved on - or a third out)
    const stealPlay = this.steal && !res.halfOver && res.result !== 'walk';
    if (res.paEnded) {
      this.stats.pa++;
      if (res.result === 'walk') { this.stats.walks++; this.stats.rbi += res.runs; } // a bases-loaded walk drives in a run
      if (res.result.startsWith('strikeout')) { this.stats.strikeouts++; this.stats.ab++; }
      this.creditBatter(res.result, res.runs);
      this.emit('result', {
        kind: 'pa', result: res.result, text: rules.RESULT_TEXT[res.result], runs: res.runs, outs: g.outs, halfOver: res.halfOver,
        batter: this.batter, ...info,
      });
      if (stealPlay) return this.startStealPlay(res);
      this.finishPitch(this.cfg.pace.callDisplay + 0.45, res.halfOver, true, res.result);
    } else {
      this.emit('result', { kind: 'pitch', call, text: rules.RESULT_TEXT[res.result], ...info });
      if (stealPlay) return this.startStealPlay(res);
      this.finishPitch(this.cfg.pace.callDisplay);
    }
  }

  // ------------------------------------------------------------------ stolen bases
  // The pitch is in the catcher's glove and the runners are going: play it out (the same play machinery as a ball in play).
  startStealPlay(res) {
    const pitch = this.pitch;
    const plan = this.planStealNow(); // (the same plan as when the runner went; the outs may have changed since)
    if (!plan) return this.finishPitch(res.paEnded ? this.cfg.pace.callDisplay + 0.45 : this.cfg.pace.callDisplay, res.halfOver, res.paEnded, res.result);
    this.play = {
      t0: pitch.tCatch, sim: NO_FLIGHT, plan, contact: { exitVelocity: 0, launchAngle: 0, sprayAngle: 0, grade: 'steal', steal: true }, pitch,
      distance: 0, projected: { distance: 0, hangTime: 0 }, start: null, steal: { res },
      events: buildEventList(NO_FLIGHT, plan), nextEvent: 0, prevT: 0, landedReported: false,
    };
    this.setPhase('play');
    this.emit('stealPlay', { plan, bases: this.steal.bases });
  }

  finishSteal(p) {
    const plan = p.plan;
    const g = this.diamond;
    const res = p.steal.res;
    const moves = plan.moves.map((m) => ({ from: m.from, to: m.to, out: !!m.out }));
    const before = g.bases.slice();
    const r = rules.applySteal(g, moves);
    if (this.pgame) { g.outs = 0; r.halfOver = false; } // (practice: nobody is out for good)
    for (const m of moves) {
      const runner = before[m.from - 1];
      if (m.out) this.stats.cs++;
      else if (m.to > m.from) { this.stats.sb++; if (runner && runner.id !== undefined) this.lineOf(runner).sb++; }
    }
    const lead = plan.moves[0];
    const base = lead.out ? lead.outBase : lead.to;
    const result = plan.result === 'caughtStealing' ? 'caughtStealing' : plan.doubleSteal ? 'doubleSteal' : 'stolenBase';
    this.emitCount();
    this.emit('result', { kind: 'steal', result, text: rules.RESULT_TEXT[result], base, outs: g.outs, halfOver: r.halfOver, runs: 0, plan });
    const halfOver = res.halfOver || r.halfOver;
    this.finishPitch(this.cfg.pace.playEndPause, halfOver, res.paEnded || halfOver, res.paEnded ? res.result : result);
  }

  finishPitch(pause, halfOver = false, paEnded = false, kind = null) {
    this.paEnded = paEnded;
    this.setBunt(false); // (a batter squares around again for each pitch he wants to bunt)
    if (this.stealArmed) { this.stealArmed = false; this.emit('stealArmed', { on: false, bases: [] }); } // (and the runners are sent again for each pitch)
    this.steal = null; // (the steal belongs to the pitch that has just ended: the picture must not replay it with the runners' new bases)
    this.lastPA = paEnded ? { result: kind, time: this.time } : this.lastPA;
    this.setPhase('result');
    this.resultUntil = this.time + pause;
    // a finished plate appearance brings up the next batter; otherwise the same batter sees another pitch
    this.pendingNext = halfOver ? 'half' : paEnded && this.diamond ? 'pa' : 'pitch';
  }

  afterResult() {
    const next = this.pendingNext;
    this.pendingNext = null;
    if (this.mode === 'derby' && this.derby.outs >= this.derby.maxOuts) return this.finishGame();
    if (next === 'half') return this.endHalf();
    if (next === 'pa') return this.beginPlateAppearance();
    // next pitch to the same batter
    this.pitch = null; this.swing = null; this.play = null;
    this.setPhase('ready');
    this.readyUntil = this.time + this.cfg.pace.nextPitchDelay;
    this.checkpoint();
  }

  // ------------------------------------------------------------------ contact and plays
  resolveContact() {
    const pitch = this.pitch;
    const s = this.swing;
    const c = s.contact;
    this.stats.pitchesSeen++;
    const tRel = Math.min(Math.max(0, s.tHit - pitch.tRelease), pitch.flight.tCatch);
    const start = pitch.flight.at(tRel);
    const params = {
      exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle,
      backspin: c.backspin, hook: c.hook, start: { x: start.x, y: Math.max(start.y, 1.0), z: start.z },
    };
    const sim = simulateBattedBall(params, this.cfg);
    const simple = this.mode === 'derby';
    // fielding errors: one roll per ball in play (only in real games)
    const errorRoll = simple ? undefined : this.errorRollOverride ?? this.rng.next(); // (errorRollOverride: QA hook, 0 = always an error)
    const running = this.steal && !simple ? Object.fromEntries(this.steal.bases.map((b) => [b, this.steal.start[b] - s.tHit])) : null; // runners going with the pitch
    this.rng.next(); // (kept so a game's random numbers stay in step with older saves)
    const planIn = { sim, contact: c, bases: this.bases.slice(), outs: this.outs, defense: this.defense, simple, errorRoll, errorScale: this.d.errorScale, running, speeds: this.runnerSpeeds(), orders: [] };
    const plan = planPlay(planIn, this.cfg);
    const proj = projectDistance(params, this.cfg);
    const fb = sim.firstBounce;
    const distance = plan.homer ? proj.distance : fb ? Math.hypot(fb.x, fb.z) : proj.distance;
    this.stats.contacts++;
    if (c.grade === 'perfect') this.stats.perfect++;
    else if (c.grade === 'good') this.stats.good++;
    else if (c.grade === 'early') this.stats.early++;
    else if (c.grade === 'late') this.stats.late++;
    this.stats.evSum += c.exitVelocity; this.stats.evN++;
    this.stats.maxEV = Math.max(this.stats.maxEV, c.exitVelocity);
    this.play = {
      t0: s.tHit, sim, plan, planIn, contact: c, pitch, distance, projected: proj, start,
      events: buildEventList(sim, plan), nextEvent: 0, prevT: 0, landedReported: false,
    };
    this.setPhase('play');
    this.emit('contact', {
      swing: s, pitch, contact: c, sim, plan, distance, projected: proj,
      hangTime: proj.hangTime, apex: sim.apex.y, exitVelocity: c.exitVelocity, launchAngle: c.launchAngle,
      sprayAngle: c.sprayAngle, grade: c.grade, homer: plan.homer, fair: plan.fair, result: plan.result,
      big: c.exitVelocity >= this.cfg.feel.bigHitExitVelocity || distance >= this.cfg.feel.bigHitDistance,
    });
  }

  updatePlay() {
    const p = this.play;
    const t = this.time - p.t0;
    if (!(p.plan.endTime >= 0)) p.plan.endTime = 6; // safety net: never let a play run forever
    while (p.nextEvent < p.events.length && p.events[p.nextEvent].t <= t) {
      const ev = p.events[p.nextEvent++];
      this.emit('playEvent', ev);
    }
    p.prevT = t;
    if (t >= Math.min(p.plan.endTime, 30)) this.finishPlay();
  }

  // ------------------------------------------------------------------ sending runners
  // Runners take one base on their own; you send them further by tapping a base, from the moment the ball is hit (on a ball in the
  // air everybody does the same until it is caught or down, so nothing gives a catch away) until just after the fielder is ready to
  // throw (plan.send). Tapping the base a runner you sent is heading for calls him back. The play is planned again with your orders -
  // everything up to the tap stays exactly as it was - and the defense throws at whoever it can get.
  get sendOpen() {
    const p = this.play;
    if (this.phase !== 'play' || !p || p.steal || !p.plan.send || this.paused) return false;
    const t = this.time - p.t0;
    return t >= p.plan.send.from && t <= p.plan.send.by;
  }

  // The bases you can tap right now: [{ base, from, kind: 'send' | 'back' }] (from = the runner's starting base, 0 = the batter).
  sendTargets() {
    if (!this.sendOpen) return [];
    return sendOptions(this.play.plan, this.time - this.play.t0, this.cfg);
  }

  // Tap base `base`: send the runner heading for the base before it on to it - or call back the runner you sent there. True when taken.
  sendRunner(base) {
    const opt = this.sendTargets().find((q) => q.base === base);
    if (!opt) return false;
    const p = this.play;
    const t = this.time - p.t0;
    p.planIn.orders.push({ base, t, from: opt.from, back: opt.kind === 'back' || undefined });
    const plan = planPlay(p.planIn, this.cfg);
    p.plan = plan;
    p.events = buildEventList(p.sim, plan);
    p.nextEvent = p.events.findIndex((e) => e.t > t + 1e-9);
    if (p.nextEvent < 0) p.nextEvent = p.events.length;
    if (opt.kind === 'send') this.stats.sends = (this.stats.sends || 0) + 1;
    this.emit('send', { base, t, plan, kind: opt.kind });
    return true;
  }

  finishPlay() {
    const p = this.play;
    const plan = p.plan;
    const c = p.contact;
    if (p.steal) {
      const back = Math.max(fielderBackTime(plan, 'P', this.defense, this.cfg, this.time - p.t0), fielderBackTime(plan, 'C', this.defense, this.cfg, this.time - p.t0));
      this.fieldersSetAt = back > 0 ? p.t0 + back + this.cfg.pace.pitcherSet : 0;
      return this.finishSteal(p);
    }
    // The pitcher may have fielded the ball or backed up a base, the catcher may have covered the plate: the next pitch must not
    // start until both are back where they belong (the jog home is the same one the picture shows) and have a moment to get set.
    const playEnd = this.time - p.t0;
    const back = Math.max(fielderBackTime(plan, 'P', this.defense, this.cfg, playEnd), fielderBackTime(plan, 'C', this.defense, this.cfg, playEnd));
    this.fieldersSetAt = back > 0 ? p.t0 + back + this.cfg.pace.pitcherSet : 0;
    const summary = {
      plan, contact: c, distance: p.distance, exitVelocity: c.exitVelocity, launchAngle: c.launchAngle,
      grade: c.grade, batter: this.batter,
    };

    if (this.mode === 'practice') {
      const foul = plan.result === 'foul' || plan.result === 'foulOut';
      const text = foul ? 'FOUL BALL' : plan.homer ? 'HOME RUN' : practiceLabel(plan, c);
      let runs = 0;
      if (!foul) {
        // the runners move just as in a game; the outs are forgotten straight away
        const g = this.pgame;
        const res = rules.applyPlay(g, { result: plan.result, batterDest: plan.batterDest, moves: plan.moves.filter((m) => m.from >= 1).map((m) => ({ from: m.from, to: m.to, out: !!m.out })), outsMade: plan.outsMade }, this.batter);
        runs = res.runs;
        g.outs = 0; g.balls = 0; g.strikes = 0;
        this.stats.runs += runs; this.stats.rbi += runs;
        if (rules.isHitResult(plan.result)) this.stats.hits++;
        if (plan.homer || plan.result === 'insideParkHomer') { this.stats.hr++; this.stats.longestHR = Math.max(this.stats.longestHR, Math.round(p.distance)); }
        this.emit('practice', this.practiceState());
      }
      this.emit('result', { kind: 'play', result: plan.homer ? 'homer' : plan.result, text, runs, ...summary });
      this.finishPitch(this.cfg.pace.playEndPause + (runs > 0 ? 0.35 : 0), false, !foul);
      return;
    }
    if (this.mode === 'derby') {
      if (plan.homer) return this.derbyHomer(summary);
      if (plan.result === 'foul') return this.derbyNonHomer('foul ball', 'foul', summary);
      return this.derbyNonHomer(derbyOutText(plan, c), 'out', summary);
    }

    // ---------------- quick game ----------------
    const g = this.game;
    if (plan.result === 'foul') {
      this.stats.fouls++;
      if (c.bunt && g.strikes >= 2) {
        // a bunt foul with two strikes is strike three
        const res = rules.pitchStrike(g, { swinging: true });
        this.stats.pa++; this.stats.strikeouts++; this.stats.ab++;
        this.creditBatter(res.result, 0);
        this.emitCount();
        this.emit('result', { kind: 'pa', result: res.result, text: 'STRIKEOUT', detail: 'Bunted foul', runs: 0, outs: g.outs, halfOver: res.halfOver, batter: this.batter, ...summary });
        this.finishPitch(this.cfg.pace.callDisplay + 0.45, res.halfOver, true, res.result);
        return;
      }
      rules.pitchFoul(g);
      this.emitCount();
      this.emit('result', { kind: 'pitch', call: 'foul', text: 'FOUL', ...summary });
      this.finishPitch(0.28);
      return;
    }
    const play = {
      result: plan.result === 'hitSimple' ? 'single' : plan.result,
      batterDest: plan.batterDest,
      moves: plan.moves.filter((m) => m.from >= 1 && !m.back).map((m) => ({ from: m.from, to: m.to, out: !!m.out, before: !!m.beforeOut })),
      outsMade: plan.outsMade, timePlay: !!plan.timePlay,
    };
    if (plan.result === 'foulOut') play.result = 'foulOut';
    // a bunt that is out at first but moves a runner up (with fewer than two outs) is a sacrifice: it does not count as an at-bat
    if (c.bunt && play.result === 'groundout' && g.outs < 2 && play.moves.some((m) => !m.out && m.to > m.from)) play.result = 'sacBunt';
    const outsBefore = g.outs;
    const res = rules.applyPlay(g, play, this.batter);
    this.stats.pa++;
    const isHit = rules.isHitResult(play.result);
    if (play.result !== 'sacFly' && play.result !== 'sacBunt') this.stats.ab++;
    if (isHit) {
      this.stats.hits++;
      if (play.result === 'homer' || play.result === 'insideParkHomer') {
        this.stats.hr++;
        this.stats.longestHR = Math.max(this.stats.longestHR, Math.round(p.distance));
      }
    }
    this.stats.rbi += res.runs;
    this.stats.runs += res.scoredRunners.filter((r) => r === this.batter).length;
    this.creditBatter(play.result, res.runs);
    this.emitCount();
    this.emit('result', {
      kind: 'pa', result: play.result, text: rules.RESULT_TEXT[play.result] || play.result.toUpperCase(),
      runs: res.runs, outs: g.outs, outsBefore, halfOver: res.halfOver, walkOff: res.walkOff, batter: this.batter,
      ...summary,
    });
    this.finishPitch(this.cfg.pace.playEndPause + (res.runs > 0 ? 0.35 : 0), res.halfOver || g.over, true, play.result);
    if (g.over) this.pendingNext = 'half';
  }

  // The batter's line for today (and the result of this plate appearance for season stats).
  creditBatter(result, runs = 0) {
    const b = this.batter;
    if (!b) return;
    const L = this.lineOf(b);
    L.pa++;
    if (result === 'walk') L.bb++;
    else if (result !== 'sacFly' && result !== 'sacBunt') L.ab++;
    if (rules.isHitResult(result)) L.h++;
    if (result === 'homer' || result === 'insideParkHomer') L.hr++;
    if (/^strikeout/.test(result)) L.k++;
    L.rbi += runs;
    this.emit('batterLine', { batter: b, line: { ...L }, result, runs });
  }
  lineOf(b) {
    const id = b && b.id !== undefined ? b.id : 'x';
    return this.lines[id] || (this.lines[id] = { pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, sb: 0 });
  }

  // Practice: the session so far (runs, hits, home runs) and who is on base.
  practiceState() {
    const g = this.pgame;
    return { runs: g ? g.score.top : 0, hits: this.stats.hits, hr: this.stats.hr, bases: g ? g.bases.map((b) => !!b) : [false, false, false] };
  }

  // ------------------------------------------------------------------ Home Run Derby
  derbyHomer(summary) {
    const d = this.derby;
    d.hr++; d.streak++;
    d.bestStreak = Math.max(d.bestStreak, d.streak);
    const ft = Math.round(summary.distance);
    d.longest = Math.max(d.longest, ft);
    this.stats.hits++; this.stats.hr++; this.stats.pa++; this.stats.ab++;
    this.stats.longestHR = Math.max(this.stats.longestHR, ft);
    this.emit('derby', { ...d });
    this.emit('result', { kind: 'play', result: 'homer', text: 'HOME RUN', distanceFt: ft, streak: d.streak, ...summary });
    this.finishPitch(this.cfg.pace.playEndPause);
  }

  derbyNonHomer(text, kind, summary) {
    const d = this.derby;
    d.streak = 0;
    const free = (kind === 'foul' || kind === 'whiff') && !this.d.derbyFoulIsOut;
    if (!free) d.outs++;
    this.stats.pa++; this.stats.ab++;
    this.emit('derby', { ...d });
    this.emit('result', { kind: 'play', result: 'out', text: free ? text.toUpperCase() + ' (FREE)' : 'OUT', detail: text, ...summary });
    this.finishPitch(this.cfg.pace.playEndPause);
  }

  // ------------------------------------------------------------------ half innings (quick game)
  endHalf() {
    const g = this.game;
    const res = rules.advanceHalf(g, { ghost: true, name: 'Runner' });
    this.emit('halfEnd', { game: g });
    if (res.gameOver) return this.finishGame();
    if (g.half !== this.playerSide) return this.runAiHalf();
    this.emit('inningChange', { inning: g.inning, half: g.half, newInning: true });
    this.setPhase('halfBreak');
    this.beginPlateAppearance(true);
  }

  // The computer bats: simulate its half-inning at once and show a short highlights summary.
  runAiHalf() {
    const g = this.game;
    this.emit('inningChange', { inning: g.inning, half: g.half });
    const before = { ...g.score };
    const sim = simulateHalf(g, { difficulty: this.difficulty, rng: this.rng, lineup: this.oppLineup }, this.cfg);
    this.aiSummary = { events: sim.events, runs: sim.runs, inning: g.inning, half: g.half, score: { ...g.score }, before, over: g.over };
    this.setPhase('aiSummary');
    const lines = Math.max(1, sim.events.length);
    this.summaryUntil = this.time + Math.max(1.6, lines * this.cfg.pace.aiSummaryLine + 0.9);
    this.emit('aiHalf', this.aiSummary);
  }

  // The summary screen can be skipped.
  skipSummary() {
    if (this.phase === 'aiSummary') this.summaryUntil = this.time;
  }

  afterAiSummary() {
    const g = this.game;
    this.aiSummary = null;
    const res = rules.advanceHalf(g, { ghost: true, name: 'Runner' });
    if (res.gameOver) return this.finishGame();
    this.emit('inningChange', { inning: g.inning, half: g.half, newInning: true });
    this.beginPlateAppearance(true);
  }

  // ------------------------------------------------------------------ the end
  finishGame() {
    this.over = true;
    this.setPhase('gameOver');
    const g = this.game;
    const payload = {
      mode: this.mode, difficulty: this.difficulty, stats: { ...this.stats },
      derby: this.mode === 'derby' ? { ...this.derby } : null,
      game: g ? {
        score: { ...g.score }, winner: g.winner, innings: g.inning, line: rules.lineScore(g), hits: { ...g.hits }, errors: { ...(g.errors || { top: 0, bottom: 0 }) }, walkOff: g.walkOff,
        playerSide: this.playerSide, pf: g.score[this.playerSide], pa: g.score[this.oppSide], // runs for / against YOU
      } : null,
      won: g ? g.winner === this.playerSide : null,
      opponent: this.opponent,
    };
    this.emit('gameOver', payload);
  }

  // ------------------------------------------------------------------ snapshot for UI / tests
  snapshot() {
    const g = this.game;
    return {
      phase: this.phase, mode: this.mode, time: this.time,
      balls: this.count.balls, strikes: this.count.strikes, outs: this.outs,
      inning: g ? g.inning : 0, half: g ? g.half : null, score: g ? { ...g.score } : null,
      bases: this.bases.map((b) => !!b), batter: this.batter && this.batter.name,
      over: this.over, derby: { ...this.derby },
    };
  }
}

function newStats() {
  return {
    pitchesSeen: 0, swings: 0, bunts: 0, sb: 0, cs: 0, whiffs: 0, contacts: 0, fouls: 0, hits: 0, hr: 0, ab: 0, pa: 0, walks: 0, strikeouts: 0, rbi: 0, runs: 0,
    perfect: 0, good: 0, early: 0, late: 0, maxEV: 0, evSum: 0, evN: 0, longestHR: 0,
  };
}

function practiceLabel(plan, c) {
  const map = { flyout: 'FLY OUT', lineout: 'LINE OUT' };
  if (plan.result === 'hitSimple') {
    if (c.launchAngle < 10) return 'GROUND BALL';
    if (c.launchAngle < 25) return 'LINE DRIVE';
    return 'FLY BALL';
  }
  return map[plan.result] || rules.RESULT_TEXT[plan.result] || String(plan.result).toUpperCase();
}
function derbyOutText(plan, c) {
  if (plan.result === 'foulOut') return 'foul out';
  if (plan.caught) return 'caught';
  if (plan.result === 'hitSimple') return c.launchAngle < 10 ? 'grounder' : 'in the park';
  return 'out';
}

// (a steal play has no batted ball)
const NO_FLIGHT = { firstBounce: null, wallHit: null, homerun: null, standsLanding: null, duration: 0, apex: { y: 0 } };

// Everything that will happen during a play at a fixed time (seconds after contact), for sound / effects.
function buildEventList(sim, plan) {
  const ev = [];
  if (sim.wallHit) ev.push({ t: sim.wallHit.t, type: 'wall', x: sim.wallHit.x, y: sim.wallHit.y, z: sim.wallHit.z });
  if (sim.homerun) ev.push({ t: sim.homerun.t, type: 'fence', x: sim.homerun.x, y: sim.homerun.y, z: sim.homerun.z });
  if (sim.standsLanding) ev.push({ t: sim.standsLanding.t, type: 'stands', x: sim.standsLanding.x, y: sim.standsLanding.y, z: sim.standsLanding.z });
  // (not when a fielder has the ball - or it has hit his glove - before it would have come down)
  const gloved = (plan.caught || plan.dropped) ? plan.catchT : plan.pickupT;
  if (sim.firstBounce && !sim.homerun && !(gloved !== undefined && gloved < sim.firstBounce.t)) ev.push({ t: sim.firstBounce.t, type: 'landed', x: sim.firstBounce.x, z: sim.firstBounce.z });
  for (const e of plan.events) ev.push({ ...e });
  for (const th of plan.throws) {
    ev.push({ t: th.t0, type: 'throw', from: th.from, to: th.to });
    ev.push({ t: th.t1, type: 'glovePop', pos: th.to });
  }
  for (const m of plan.moves) if (m.out && m.outAt !== undefined) ev.push({ t: m.outAt, type: 'outCall', base: m.outBase });
  ev.sort((a, b) => a.t - b.t);
  return ev;
}
