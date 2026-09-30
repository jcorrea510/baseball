// The game engine: one pitch after another, swing handling, plays, counts, innings and modes.
// It knows nothing about graphics: it just advances a clock (update(dt)), accepts a swing
// (swingPressed) and announces what happens through events. The renderer, HUD and audio listen.
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { buildPitch, isStrike } from '../physics/pitch.js';
import { simulateBattedBall, projectDistance } from '../physics/ballistics.js';
import { resolveSwingTimes, describeError } from './timing.js';
import { computeContact, computeBunt, derbyBatting } from './contact.js';
import { choosePitch, pitchWindowScale } from './pitcherAI.js';
import { createDefense, planPlay, fielderBackTime } from './fielding.js';
import * as rules from './rules.js';
import { simulateHalf } from './aiHalf.js';
import { makeLineup, makePitcher, OPPONENTS, PLAYER_TEAM } from './teams.js';

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
    this.practice = { type: 'fastball', speed: cfg.modes.practice.speedDefault, location: 'random', ...(o.practice || {}) };
    this.opponent = o.opponent || OPPONENTS[this.rng.int(0, OPPONENTS.length - 1)];
    this.playerTeam = PLAYER_TEAM;

    this.lineup = makeLineup(this.seed, 'p');
    this.oppLineup = makeLineup(this.seed ^ 0x5bd1e995, 'o');
    if (this.handSetting !== 'auto') for (const b of this.lineup) b.hand = this.handSetting;
    this.pitcher = makePitcher(this.seed);
    this.defense = createDefense(cfg, this.rng);

    this.time = 0;
    this.phase = 'idle';
    this.phaseSince = 0;
    this.fieldersSetAt = 0; // no pitch before this time: the pitcher and catcher are back in place and set (see finishPlay)
    this.listeners = {};
    this.aim = 0;
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

    this.game = this.mode === 'quick' ? rules.createGame({ innings: cfg.modes.quick.innings, extraRunner: cfg.modes.quick.extraInningRunner }) : null;
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
  get bases() { return this.game ? this.game.bases : [null, null, null]; }
  get pitchTime() { return this.pitch ? this.time - this.pitch.tRelease : -1; }
  get playTime() { return this.play ? this.time - this.play.t0 : -1; }
  get batterHand() { return this.batter.hand || 'R'; }
  get windowScale() { return this.d.windowScale * (this.mode === 'derby' ? 1.12 : 1); }

  setPhase(p) { this.phase = p; this.phaseSince = this.time; }
  setAim(v) { this.aim = Math.max(-1, Math.min(1, v)); }

  // ------------------------------------------------------------------ lifecycle
  start() {
    if (this.phase !== 'idle') return;
    this.emit('gameStart', { mode: this.mode });
    this.beginPlateAppearance(true);
  }

  beginPlateAppearance(first = false) {
    if (this.game) {
      this.batterIndex = this.game.lineupIdx[this.game.half] % 9;
      this.batter = this.lineup[this.batterIndex];
    } else {
      this.batter = this.lineup[0];
    }
    this.pitch = null; this.swing = null; this.play = null;
    this.setPhase('ready');
    this.readyUntil = this.time + (first ? this.cfg.pace.firstPitchDelay + 0.3 : this.cfg.pace.firstPitchDelay * 0.65);
    this.batterReadyFlag = !this.waitForBatter;
    this.setBunt(false);
    this.emit('paStart', { batter: this.batter, index: this.batterIndex, count: this.count, waiting: !this.batterReadyFlag });
    this.emitCount();
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
      movementScale: this.mode === 'derby' ? 0.4 : this.d.movementScale,
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

  // Player input. `sinceUpdate` = seconds between the last engine update and the actual input event
  // (so timing does not depend on frame rate). Returns true if the swing was accepted.
  swingPressed(sinceUpdate = 0) {
    if (this.phase !== 'pitch' || this.swing || !this.pitch) return false;
    const pitch = this.pitch;
    const tPress = this.time + Math.max(-0.02, Math.min(0.05, sinceUpdate)) - this.inputDelay;
    const times = resolveSwingTimes(tPress, pitch.tCross, this.cfg);
    const loc = pitch.target;
    const bunting = this.buntStance;
    const contact = bunting ? computeBunt({ errorMs: times.errorMs, locX: loc.x, locY: loc.y, windowScale: this.windowScale, aim: this.aim, batterHand: this.batterHand, rng: this.rng }, this.cfg) : computeContact({
      errorMs: times.errorMs,
      locX: loc.x, locY: loc.y,
      pitchSpeed: pitch.speedMph,
      windowScale: this.windowScale,
      speedScale: pitchWindowScale(pitch.type),
      aim: this.aim,
      batterHand: this.batterHand,
      ...(this.mode === 'derby' ? derbyBatting(this.cfg) : {}),
      rng: this.rng,
    }, this.cfg);
    if (this.contactOverride) { delete contact.reason; Object.assign(contact, { made: true, grade: 'good' }, this.contactOverride(this)); }
    // The bat only meets the ball at the clamped time when contact is made; a miss swings through at the true time.
    const tHit = contact.made ? times.hitTime : times.barrelTime;
    this.swing = {
      tPress, tBarrel: times.barrelTime, tHit, errorMs: times.errorMs,
      grade: contact.grade, made: contact.made, contact, resolved: false,
      follow: this.cfg.timing.followThrough, bunt: bunting,
    };
    if (bunting) this.stats.bunts++; else this.stats.swings++;
    this.emit('swing', { swing: this.swing, pitch, errorText: describeError(times.errorMs) });
    return true;
  }

  updatePitch() {
    const pitch = this.pitch;
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
    if (res.paEnded) {
      this.stats.pa++;
      if (res.result === 'walk') { this.stats.walks++; this.stats.rbi += res.runs; } // a bases-loaded walk drives in a run
      if (res.result.startsWith('strikeout')) { this.stats.strikeouts++; this.stats.ab++; }
      this.creditBatter(res.result, res.runs);
      this.emit('result', {
        kind: 'pa', result: res.result, text: rules.RESULT_TEXT[res.result], runs: res.runs, outs: g.outs, halfOver: res.halfOver,
        batter: this.batter, ...info,
      });
      this.finishPitch(this.cfg.pace.callDisplay + 0.45, res.halfOver, true, res.result);
    } else {
      this.emit('result', { kind: 'pitch', call, text: rules.RESULT_TEXT[res.result], ...info });
      this.finishPitch(this.cfg.pace.callDisplay);
    }
  }

  finishPitch(pause, halfOver = false, paEnded = false, kind = null) {
    this.paEnded = paEnded;
    this.setBunt(false); // (a batter squares around again for each pitch he wants to bunt)
    this.lastPA = paEnded ? { result: kind, time: this.time } : this.lastPA;
    this.setPhase('result');
    this.resultUntil = this.time + pause;
    // a finished plate appearance brings up the next batter; otherwise the same batter sees another pitch
    this.pendingNext = halfOver ? 'half' : paEnded && this.game ? 'pa' : 'pitch';
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
    const simple = this.mode !== 'quick';
    const plan = planPlay({ sim, contact: c, bases: this.bases, outs: this.outs, defense: this.defense, simple }, this.cfg);
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
      t0: s.tHit, sim, plan, contact: c, pitch, distance, projected: proj, start,
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

  finishPlay() {
    const p = this.play;
    const plan = p.plan;
    const c = p.contact;
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
      const text = plan.result === 'foul' || plan.result === 'foulOut' ? 'FOUL BALL' : plan.homer ? 'HOME RUN' : practiceLabel(plan, c);
      this.emit('result', { kind: 'play', result: plan.homer ? 'homer' : plan.result, text, ...summary });
      this.finishPitch(this.cfg.pace.playEndPause);
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
      moves: plan.moves.filter((m) => m.from >= 1).map((m) => ({ from: m.from, to: m.to, out: !!m.out })),
      outsMade: plan.outsMade,
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
    return this.lines[id] || (this.lines[id] = { pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0 });
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
    if (g.half === 'bottom') {
      // the computer bats: simulate it and show a short highlights summary
      this.emit('inningChange', { inning: g.inning, half: g.half });
      const before = { ...g.score };
      const sim = simulateHalf(g, { difficulty: this.difficulty, rng: this.rng, lineup: this.oppLineup }, this.cfg);
      this.aiSummary = { events: sim.events, runs: sim.runs, inning: g.inning, score: { ...g.score }, before, over: g.over };
      this.setPhase('aiSummary');
      const lines = Math.max(1, sim.events.length);
      this.summaryUntil = this.time + Math.max(1.6, lines * this.cfg.pace.aiSummaryLine + 0.9);
      this.emit('aiHalf', this.aiSummary);
      return;
    }
    this.emit('inningChange', { inning: g.inning, half: g.half, newInning: true });
    this.setPhase('halfBreak');
    this.beginPlateAppearance(true);
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
      game: g ? { score: { ...g.score }, winner: g.winner, innings: g.inning, line: rules.lineScore(g), hits: { ...g.hits }, walkOff: g.walkOff } : null,
      won: g ? g.winner === 'top' : null,
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
    pitchesSeen: 0, swings: 0, bunts: 0, whiffs: 0, contacts: 0, fouls: 0, hits: 0, hr: 0, ab: 0, pa: 0, walks: 0, strikeouts: 0, rbi: 0, runs: 0,
    perfect: 0, good: 0, early: 0, late: 0, maxEV: 0, evSum: 0, evN: 0, longestHR: 0,
  };
}

function practiceLabel(plan, c) {
  const map = { single: 'SINGLE', double: 'DOUBLE', triple: 'TRIPLE', flyout: 'FLY OUT', lineout: 'LINE OUT', popout: 'POP OUT', hitSimple: 'IN PLAY' };
  if (plan.result === 'hitSimple') {
    if (c.launchAngle < 10) return 'GROUND BALL';
    if (c.launchAngle < 25) return 'LINE DRIVE';
    return 'FLY BALL';
  }
  return map[plan.result] || String(plan.result).toUpperCase();
}
function derbyOutText(plan, c) {
  if (plan.result === 'foulOut') return 'foul out';
  if (plan.caught) return 'caught';
  if (plan.result === 'hitSimple') return c.launchAngle < 10 ? 'grounder' : 'in the park';
  return 'out';
}

// Everything that will happen during a play at a fixed time (seconds after contact), for sound / effects.
function buildEventList(sim, plan) {
  const ev = [];
  if (sim.wallHit) ev.push({ t: sim.wallHit.t, type: 'wall', x: sim.wallHit.x, y: sim.wallHit.y, z: sim.wallHit.z });
  if (sim.homerun) ev.push({ t: sim.homerun.t, type: 'fence', x: sim.homerun.x, y: sim.homerun.y, z: sim.homerun.z });
  if (sim.standsLanding) ev.push({ t: sim.standsLanding.t, type: 'stands', x: sim.standsLanding.x, y: sim.standsLanding.y, z: sim.standsLanding.z });
  if (sim.firstBounce && !sim.homerun) ev.push({ t: sim.firstBounce.t, type: 'landed', x: sim.firstBounce.x, z: sim.firstBounce.z });
  for (const e of plan.events) ev.push({ ...e });
  for (const th of plan.throws) {
    ev.push({ t: th.t0, type: 'throw', from: th.from, to: th.to });
    ev.push({ t: th.t1, type: 'glovePop', pos: th.to });
  }
  for (const m of plan.moves) if (m.out && m.outAt !== undefined) ev.push({ t: m.outAt, type: 'outCall', base: m.outBase });
  ev.sort((a, b) => a.t - b.t);
  return ev;
}
