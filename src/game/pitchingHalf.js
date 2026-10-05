// You pitch the computer's half-inning. The engine's own methods for that half, installed onto Engine.prototype (engine.js calls
// installPitchingHalf at the bottom of the file): no graphics, engine time only, every random draw from the engine's seeded rng.
//   aim      - you choose a pitch (selectPitch) and move the target (setPitchAim); startDelivery() begins the windup
//   delivery - a ring shrinks onto the target; ringTap() as it meets it grades the pitch; the ball leaves the hand after
//              `pitching.delivery` s whatever the tap was (the tap only sets the grade)
//   pitch    - the computer's batter has read it and decided at the release (cpuBatter.decideSwing); a swing goes through the same
//              swing physics as yours (engine.commitSwing) - then the existing play / result machinery
//   play     - your fielders make the play; the computer sends its own runners (cpuRunner.chooseSend)
//   result   - your pitcher's line is credited (creditPitching); the next pitch is aimed `pitching.nextPitch` s after the call
// With `cpuHalf: 'auto'` the computer pitches for you (choosePitch with your pitcher's arsenal, a ring grade from `pitching.sim.grades`).
import { clamp } from '../util/math.js';
import { buildPitch, isStrike, hitsBatter, releasePoint } from '../physics/pitch.js';
import { alignDefense, tapOptions } from './fielding.js';
import * as rules from './rules.js';
import { ringTiming, throwPitch, gradeTap, fatigue, pitchCost, staminaMax } from './pitching.js';
import { decideSwing } from './cpuBatter.js';
import { chooseSend, stealDecision } from './cpuRunner.js';
import { choosePitch } from './pitcherAI.js';

/** One pitching line: outs, hits, runs, earned runs, walks, strikeouts, home runs, pitches. */
export function newPitchLine() {
  return { outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, pitches: 0 };
}
/** Your pitchers' numbers in a game: the whole staff's line plus one per pitcher (`byPitcher[id]`). */
export function newPitchStats() {
  // (`spent[id]` = the stamina a pitcher has used today; `simmedOuts` / `simmedKs` = outs and strikeouts the computer got for you in a
  //  Sim; `sim` = everything the Sim pitched (hits, runs, walks, pitches ... on the same line shape) - none of it is your career
  //  pitching, and the 10 K badge counts real strikeouts only; `halfOuts` / `halfKs` / `halfBad` follow the half in progress - three
  //  outs that were all your own strikeouts = a side struck out, counted in `sides`)
  return { ...newPitchLine(), byPitcher: {}, spent: {}, sim: newPitchLine(), simmedOuts: 0, simmedKs: 0, halfOuts: 0, halfKs: 0, halfBad: false, sides: 0 };
}

/** What one finished game adds to your career pitching (progression.js folds it into the save), from `engine.pitchingSummary()`:
 *  everything the computer pitched for you in a Sim (`sim`: hits, runs, walks, home runs, pitches; `simmedOuts`, `simmedKs`) is left
 *  out, so the career line is only what you pitched. `games` is 1 when you threw a pitch yourself, else 0 (a game that was all Sim).
 *  Old numbers without the Sim fields count as no Sim. Null when you did not pitch. */
export function careerPitchingFrom(sum) {
  if (!sum) return null;
  const sim = sum.sim || {};
  const real = (all, simmed) => Math.max(0, (all || 0) - (simmed || 0));
  const k = real(sum.k, sum.simmedKs);
  const pitches = real(sum.pitches, sim.pitches);
  return {
    games: pitches > 0 ? 1 : 0,
    outs: real(sum.outs, sum.simmedOuts), h: real(sum.h, sim.h), r: real(sum.r, sim.r), er: real(sum.er, sim.er), bb: real(sum.bb, sim.bb), k,
    hr: real(sum.hr, sim.hr), pitches, bestK: k, shutout: (sum.badges || []).includes('shutout'),
  };
}

/** The recap line for a finished plate appearance of the computer's half, from the real result and where the ball went (spray angle,
 *  degrees: negative = left field). */
export function recapText(result, batter, runs = 0, spray = 0) {
  const name = (batter && batter.name) || 'The batter';
  const side = spray < -25 ? 'to left' : spray > 25 ? 'to right' : 'to center';
  const line = spray < -25 ? 'down the left-field line' : spray > 25 ? 'down the right-field line' : 'up the middle';
  const n = runs > 1 ? ` (${runs}-run)` : '';
  switch (result) {
    case 'single': return `${name} singles ${side}.`;
    case 'double': return `${name} doubles ${Math.abs(spray) > 25 ? side : 'into the gap'}.`;
    case 'triple': return `${name} triples ${side}!`;
    case 'homer': return `${name} crushes a home run${n}!`;
    case 'insideParkHomer': return `${name} hits an inside-the-park home run${n}!`;
    case 'groundout': return `${name} grounds out ${Math.abs(spray) > 25 ? side : line}.`;
    case 'doublePlay': return `${name} grounds into a double play.`;
    case 'flyout': return `${name} flies out ${side}.`;
    case 'lineout': return `${name} lines out ${side}.`;
    case 'popout': return `${name} pops out.`;
    case 'foulOut': return `${name} fouls out.`;
    case 'sacFly': return `${name} hits a sacrifice fly.`;
    case 'sacBunt': return `${name} lays down a sacrifice bunt.`;
    case 'fieldersChoice': return `${name} reaches on a fielder's choice.`;
    case 'error': return `${name} reaches on an error.`;
    case 'walk': return `${name} works a walk.`;
    case 'hitByPitch': return `${name} is hit by a pitch.`;
    case 'strikeoutSwinging': case 'strikeoutLooking': return `${name} strikes out.`;
    default: return `${name} is out.`;
  }
}

/** The recap line for a play that is not a plate appearance: a wild pitch or a steal. */
export function recapStealText(result, base, runs = 0) {
  const bag = { 2: 'second', 3: 'third', 4: 'home' }[base] || 'the next base';
  switch (result) {
    case 'wildPitch': return runs > 0 ? 'Wild pitch - runner scores.' : 'Wild pitch.';
    case 'stolenBase': return `The runner steals ${bag}.`;
    case 'doubleSteal': return 'Double steal.';
    case 'caughtStealing': return 'The runner is caught stealing.';
    default: return 'The runners move.';
  }
}

const methods = {
  // ------------------------------------------------------------------ the half and its batters
  // The computer comes up to bat: your pitcher is on the mound (the starter, the first time) and its first batter steps in.
  beginCpuHalf(newInning = false) {
    const g = this.game;
    this.emit('inningChange', { inning: g.inning, half: g.half, newInning });
    this.outsSeen = g.outs;
    this.beginCpuPA(true);
  },

  // A computer batter steps in. No Ready card: you are straight back at the aiming screen (`quiet`: no save point - a resumed game).
  beginCpuPA(first = false, quiet = false) {
    const g = this.game;
    if (this.practicePitch) { g.outs = 0; g.balls = 0; g.strikes = 0; g.bases = [null, null, null]; this.outsSeen = 0; } // (practice: no outs, nobody stays on)
    this.batterIndex = g.lineupIdx[g.half] % 9;
    this.batter = this.oppLineup[this.batterIndex];
    this.pitch = null; this.swing = null; this.play = null; this.ring = null; this.cpuSwing = null;
    alignDefense(this.defense, this.bases, this.outs, this.cfg); // (your fielders take up their spots for the situation)
    this.batterReadyFlag = true;
    this.setBunt(false);
    this.steal = null; this.setSteal(false);
    this.setPhase('aim');
    this.emit('paStart', { batter: this.batter, index: this.batterIndex, count: this.count, waiting: false, offense: 'cpu', first });
    this.emitCount();
    if (!quiet) this.checkpoint();
    this.emit('aimStart', { pitcher: this.mound.pitcher, batter: this.batter });
  },

  // The next pitch to the same batter.
  nextCpuPitch() {
    this.pitch = null; this.swing = null; this.play = null; this.ring = null; this.cpuSwing = null;
    this.setPhase('aim');
    this.checkpoint();
    this.emit('aimStart', { pitcher: this.mound.pitcher, batter: this.batter });
  },

  // ------------------------------------------------------------------ your inputs
  // Choose a pitch (one your pitcher throws). The choice stays for the next pitches. True when taken.
  selectPitch(type) {
    if (!this.pitching || !this.mound.pitcher.pitches.includes(type)) return false;
    this.pitchType = type;
    return true;
  },

  // Where you aim the pitch (ft, in the plane over the front of the plate - the same area as the bat's reach). Returns the aim.
  setPitchAim(x, y) {
    const R = this.cfg.swing.reach;
    this.pitchAim.x = clamp(x, -R.x, R.x);
    this.pitchAim.y = clamp(y, R.yMin, R.yMax);
    return this.pitchAim;
  },

  // Start the delivery: the pitch and the aim are locked and the ring starts to shrink. Only at the aiming screen, once the pitcher and
  // fielders are set again, and never while simming (only the auto pitcher, `auto`, starts one then). True when started.
  startDelivery({ auto = false } = {}) {
    if (this.phase !== 'aim' || !this.pitching || (this.simming && !auto) || this.time < this.fieldersSetAt) return false;
    const P = this.cfg.pitching, pitcher = this.mound.pitcher;
    const type = pitcher.pitches.includes(this.pitchType) ? this.pitchType : pitcher.pitches[0];
    alignDefense(this.defense, this.bases, this.outs, this.cfg); // (a steal may have changed the situation)
    this.ring = { tStart: this.time, ...ringTiming(pitcher, type, this.fatigueF(), this.cfg), tapped: false, errMs: null, type, aim: { ...this.pitchAim }, release: releasePoint(type, pitcher.hand || 'R', this.cfg) }; // (release: where the hand lets go - drawn from the first move)
    this.setPhase('delivery');
    // their runners may go with your delivery: they break `stealBreak` before the release (the rest is rolled at the release)
    this.steal = null;
    if (this.diamond && stealDecision({ bases: this.bases, count: this.count, outs: this.outs, speeds: this.runnerSpeeds(), rng: this.rng }, this.cfg)) {
      const going = this.stealBases();
      if (going.length) this.steal = { bases: going, start: this.stealStarts(going, this.time + P.delivery, null) };
    }
    this.emit('delivery', { ring: this.ring });
    return true;
  },

  // Tap as the ring meets the target. `sinceUpdate` = seconds between the last engine update and the actual tap (frame-rate
  // independent, like swingPressed). Once per delivery, before the ring closes (no tap = WILD). True when taken.
  ringTap(sinceUpdate = 0) {
    const r = this.ring;
    if (this.phase !== 'delivery' || !r || r.tapped || this.simming) return false;
    const t = this.time + clamp(sinceUpdate, -0.02, 0.05) - this.inputDelay;
    if (t > r.tStart + r.time) return false; // (the ring has closed)
    return this.tapRing((t - (r.tStart + r.hitAt)) * 1000);
  },
  tapRing(errMs) {
    const r = this.ring;
    r.tapped = true; r.errMs = errMs;
    this.emit('ringTap', { grade: gradeTap(errMs, this.cfg), errMs });
    return true;
  },

  // ------------------------------------------------------------------ the bullpen
  // The relievers you can still bring in: on the staff, never used this game and not on the mound ([{ pitcher, stamina }], stamina =
  // his full tank). Starters are never offered. Empty outside your pitching half.
  bullpenOptions() {
    if (!this.pitching || !this.mound) return [];
    const m = this.mound;
    return this.staff
      .filter((p) => p.role === 'RP' && !p.unavailable && p.id !== m.pitcher.id && !m.used.includes(p.id))
      .map((p) => ({ pitcher: p, stamina: staminaMax(p, this.cfg) }));
  },

  // Bring in a reliever (by id) at once: only on the aiming screen (between pitches, the count stays), not while simming. He starts
  // with a full tank and no pitches; the man he replaces joins `mound.used` and never comes back. True when done.
  bullpen(id, { auto = false } = {}) {
    if (!this.pitching || this.over || this.phase !== 'aim' || (this.simming && !auto)) return false;
    const opt = this.bullpenOptions().find((o) => o.pitcher.id === id);
    if (!opt) return false;
    const m = this.mound, from = m.pitcher, to = opt.pitcher;
    m.used = [...m.used, from.id];
    this.mound = { pitcher: to, left: opt.stamina, max: opt.stamina, pitches: 0, used: m.used, recent: [] };
    if (!to.pitches.includes(this.pitchType)) this.pitchType = to.pitches[0];
    this.emit('pitchingChange', { from, to });
    this.checkpoint();
    return true;
  },

  // Sim / the auto pitcher: a pitcher nearly spent gives way to the next unused reliever, at the start of a plate appearance.
  autoRelief() {
    const m = this.mound, c = this.count;
    if (c.balls || c.strikes || m.max <= 0 || m.left / m.max >= this.cfg.pitching.sim.pullAt) return;
    const next = this.bullpenOptions()[0];
    if (next) this.bullpen(next.pitcher.id, { auto: true });
  },

  // How tired your pitcher is (0 fresh .. 1 spent).
  fatigueF() {
    return fatigue(this.mound.left, this.mound.max, this.cfg);
  },

  // ------------------------------------------------------------------ the tick
  updateAim() {
    // the computer pitches for you ('auto'): it picks and starts at once (once the pitcher is back on the rubber)
    if ((this.cpuHalf === 'auto' || this.simming) && this.pitching && this.time >= this.fieldersSetAt) this.autoPitch();
  },

  updateDelivery() {
    const r = this.ring, P = this.cfg.pitching;
    if (r.autoErrMs !== undefined && !r.tapped && this.time >= r.tStart + r.hitAt + r.autoErrMs / 1000) this.tapRing(r.autoErrMs);
    if (this.time >= r.tStart + P.delivery) this.releaseCpuPitch();
  },

  // The computer pitching for you: a pitch from your pitcher's arsenal aimed at the level's locations, and a ring grade drawn from
  // `pitching.sim.grades` (the tap's error drawn inside that grade's window, early or late at random).
  autoPitch() {
    this.autoRelief();
    const pitcher = this.mound.pitcher, P = this.cfg.pitching, W = P.ring;
    const last = this.mound.recent[this.mound.recent.length - 1];
    const p = choosePitch({
      mode: 'quick', difficulty: this.difficulty, count: this.count, rng: this.rng, batterHand: this.batterHand, pitcherHand: pitcher.hand,
      lastType: last ? last.type : undefined, arsenal: pitcher.pitches, intended: true, // (where he aims: the ring grade makes the miss)
    }, this.cfg);
    this.pitchType = p.type;
    const inside = this.batterHand === 'L' ? 1 : -1, most = this.cfg.pitch.hitBatter.inner - P.sim.clearBatter; // (toward the batter)
    const x = inside * p.target.x > most ? inside * most : p.target.x;
    this.setPitchAim(x, p.target.y);
    const grade = this.rng.weighted(P.sim.grades);
    const band = { perfect: [0, W.perfect], good: [W.perfect, W.good], ok: [W.good, W.ok], wild: [W.ok, P.sim.wildMax] }[grade];
    const mag = this.rng.range(band[0], band[1]);
    const errMs = this.rng.chance(0.5) ? -mag : mag;
    if (this.startDelivery({ auto: true })) this.ring.autoErrMs = errMs;
  },

  // The ball leaves your pitcher's hand: the pitch you aimed, as well as you tapped (pitching.throwPitch), at full real speed.
  releaseCpuPitch() {
    const r = this.ring, cfg = this.cfg, P = cfg.pitching, m = this.mound, pitcher = m.pitcher;
    const tRelease = r.tStart + P.delivery;
    const th = throwPitch({ pitcher, type: r.type, aim: r.aim, errMs: r.tapped ? r.errMs : null, fatigueF: this.fatigueF(), rng: this.rng }, cfg);
    const hand = pitcher.hand || 'R';
    const flight = buildPitch({ type: th.type, speedMph: th.speedMph, hand, target: th.target, movementScale: th.movementScale, pace: 1 }, cfg);
    this.pitchCount++;
    this.pitch = {
      id: this.pitchCount,
      type: th.type, speedMph: th.speedMph, plateSpeedMph: flight.plateSpeedMph, target: th.target, intendedStrike: isStrike(r.aim.x, r.aim.y, cfg),
      tell: { slot: 0, lag: 0 }, announce: false, flight, hand,
      tWindup: r.tStart, windupDur: P.delivery, tRelease,
      tCross: tRelease + flight.T, tCatch: tRelease + flight.tCatch,
      isStrike: isStrike(th.target.x, th.target.y, cfg),
      hitsBatter: hitsBatter(th.target.x, th.target.y, this.batterHand, cfg), // (if he lets it go: hit by pitch)
      resolved: false, caught: false,
      grade: th.grade, wildKind: th.wildKind, errMs: th.errMs, aim: { ...r.aim }, mine: true,
    };
    this.swing = null;
    m.pitches++;
    // the pitch costs stamina (more with a runner in scoring position, at three balls, for the heater)
    const cost = pitchCost({ type: th.type, balls: this.count.balls, risp: !!(this.bases[1] || this.bases[2]) }, cfg);
    if (!this.practicePitch) m.left = Math.max(0, m.left - cost); // (practice: no stamina)
    const spent = (this.pitchStats.spent ||= {});
    spent[pitcher.id] = (spent[pitcher.id] || 0) + cost;
    this.emit('stamina', { left: m.left, max: m.max });
    this.pitchStats.pitches++; this.pitchLine(pitcher.id).pitches++;
    if (this.simming) this.pitchStats.sim.pitches++; // (a Sim's pitches are not yours)
    if (this.practicePitch) this.emit('practice', this.practiceState());
    // runners who broke during the delivery: the catcher's exchange and the throw are rolled now (engine.beginSteal)
    if (this.steal && !this.steal.plan) this.beginSteal(this.steal.bases, this.steal.start);
    // the batter reads it from the release and decides: take or swing (and if he swings, how early or late and where)
    const dec = this.cpuSwingOverride ? this.cpuSwingOverride(this) : decideSwing({
      pitch: this.pitch, count: this.count, recent: m.recent.slice(-2), batter: this.batter, level: this.difficulty,
      strength: this.d.cpuStrength ?? 0, rng: this.rng,
    }, cfg);
    this.cpuSwing = null;
    if (dec && dec.swing) {
      const R = cfg.swing.reach;
      const aim = { x: clamp(dec.aim.x, -R.x, R.x), y: clamp(dec.aim.y, R.yMin, R.yMax) }; // (his bat reaches as far as yours)
      this.cpuSwing = { tPress: this.pitch.tCross + dec.errorMs / 1000 - cfg.timing.swingDelay, aim, protect: !!dec.protect };
    }
    m.recent = [...m.recent, { type: th.type, speedMph: th.speedMph }].slice(-2);
    this.setPhase('pitch');
    this.emit('pitchGrade', { grade: th.grade, wildKind: th.wildKind });
    this.emit('release', { pitch: this.pitch });
  },

  // The computer sends its runners on a ball in play: a first look a moment after contact (drawn when the ball was hit), then every
  // `cpuRun.every` s, once the ball is caught or down (`plan.send.res`) and while a send still decides the play (`plan.send.main`).
  // Each look happens at its exact moment, whatever the frame rate.
  cpuRunnerLooks() {
    const p = this.play, R = this.cfg.cpuRun;
    if (!p || p.steal || p.wild || !p.planIn || !p.plan.send || p.cpuLook == null) return;
    for (let guard = 0; guard < 200 && this.phase === 'play' && p.cpuLook != null && p.t0 + p.cpuLook <= this.time; guard++) {
      const S = p.plan.send;
      const t = p.cpuLook; // (seconds after contact)
      if (t > (S.main ?? Infinity) || t > S.by || t >= (S.closeAt ?? Infinity) || t >= p.plan.endTime) { p.cpuLook = null; break; }
      const opens = Math.max(S.from, S.res ?? S.from);
      if (t < opens) { p.cpuLook = opens; continue; }
      p.cpuLook += R.every;
      // (everything up to this moment has happened: the events of the play so far are out before a send re-plans the rest)
      while (p.nextEvent < p.events.length && p.events[p.nextEvent].t <= t) this.emit('playEvent', p.events[p.nextEvent++]);
      const targets = tapOptions(p.plan, t);
      // (while you are still after the ball, they judge it as if you get to it as quickly as you can from where you are)
      const fc = p.control && !p.control.finished ? p.control : null;
      const planIn = fc && targets.length ? { ...p.planIn, control: { pos: fc.pos, ...fc.project() } } : p.planIn;
      const base = chooseSend({ planIn, t, targets, rng: this.rng }, this.cfg);
      if (base !== null) {
        const opt = targets.find((q) => q.base === base);
        this.applyRunnerOrder({ base, t, from: opt.from });
      }
    }
  },

  // ------------------------------------------------------------------ Sim
  // The computer pitches the rest of this half for you (the same auto pitcher, the same engine - nothing is drawn). A pitch in the air
  // or a play in progress finishes exactly as it would have; the computer takes the next pitch. True when accepted (once, while pitching).
  simHalf() {
    if (!this.pitching || this.simming || this.phase === 'delivery') return false; // (not mid-delivery: your ring would never be tapped)
    const g = this.game;
    this.simming = true;
    this.simRecap = { events: [], seen: g.score[g.half], inning: g.inning, half: g.half, before: { ...g.score } };
    return true;
  },

  // Advance a Sim without drawing: big steps, every play fast-forwarded, until `maxPlays` more plate appearances are done, the half
  // is over or the game ends. No-op when not simming. True while the Sim is still going.
  simStep(maxPlays = Infinity) {
    if (!this.simming) return false;
    const step = this.cfg.pitching.sim.step, start = this.simRecap.events.length;
    for (let guard = 0; guard < 20000 && this.simming && !this.over && this.simRecap.events.length - start < maxPlays; guard++) this.update(step);
    return this.simming && !this.over;
  },

  // The half has ended during a Sim: the recap (one line per plate appearance, the runs the computer scored, the score).
  finishSim() {
    const R = this.simRecap, g = this.game;
    this.simming = false; this.simRecap = null;
    const runs = g.score[R.half] - R.before[R.half];
    this.emit('simDone', { events: R.events, runs, inning: R.inning, half: R.half, score: { ...g.score }, before: R.before });
  },

  // ------------------------------------------------------------------ your pitching line
  pitchLine(id) {
    return this.pitchStats.byPitcher[id] || (this.pitchStats.byPitcher[id] = newPitchLine());
  },

  // After every result in the computer's half: outs, strikeouts, walks, hits, home runs and runs go on your pitcher's line (and the
  // staff's). A run is unearned when the runner who scored reached on an error.
  creditPitching(r) {
    if (!this.game || this.offense !== 'cpu' || !r) return;
    if (this.simming && this.simRecap && (r.kind === 'pa' || r.kind === 'steal')) {
      // (the runs of a line = the computer's runs since the last line, so the lines always add up to the recap's total)
      const R = this.simRecap, now = this.game.score[R.half], runs = now - R.seen;
      R.seen = now;
      const text = r.kind === 'pa' ? recapText(r.result, r.batter, runs, r.contact ? r.contact.sprayAngle : 0) : recapStealText(r.result, r.base, runs);
      R.events.push({ text, kind: r.result, runs });
    }
    const g = this.game, ps = this.pitchStats, line = this.pitchLine(this.mound.pitcher.id);
    if (r.kind === 'pa' && r.batter && typeof r.batter === 'object') r.batter.roe = r.result === 'error'; // (whenever a batter reaches)
    const outs = Math.max(0, g.outs - this.outsSeen);
    this.outsSeen = g.outs;
    const runs = r.runs || 0;
    const unearned = (r.scoredRunners || []).filter((x) => x && typeof x === 'object' && x.roe).length;
    const add = { outs, r: runs, er: Math.max(0, runs - unearned) };
    if (r.kind === 'pa') {
      if (/^strikeout/.test(r.result)) add.k = 1;
      if (r.result === 'walk') add.bb = 1;
      if (rules.isHitResult(r.result)) add.h = 1;
      if (r.result === 'homer' || r.result === 'insideParkHomer') add.hr = 1;
    }
    for (const [k, v] of Object.entries(add)) { ps[k] += v; line[k] += v; if (this.simming) ps.sim[k] += v; }
    if (outs > 0) {
      if (this.simming) { ps.simmedOuts += outs; ps.simmedKs += add.k || 0; }
      if (this.simming || outs !== 1 || add.k !== 1) ps.halfBad = true; else ps.halfKs++;
      ps.halfOuts += outs;
      if (ps.halfOuts >= 3) { // (the half is over)
        if (!ps.halfBad && ps.halfKs >= 3) ps.sides++;
        ps.halfOuts = 0; ps.halfKs = 0; ps.halfBad = false;
      }
    }
  },
};

/** Puts the pitched-half methods onto the engine (engine.js). */
export function installPitchingHalf(Engine) {
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(Engine.prototype, name, { value: fn, writable: true, configurable: true, enumerable: false });
  }
}
