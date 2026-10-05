// The live fielder: the outfielder YOU steer when the computer hits a ball to the outfield (you are pitching). Pure logic, no graphics.
//
// He is moved in fixed sub-steps (`fielding.control.step`) toward where the stick points (field coordinates, |input| <= 1) at his own
// speed, speeding up with `fielding.accel` and slowing down with `fielding.brake`, never through the wall. Each sub-step the PLANNER's
// rules (fielding.js: `airCatchable`, glove reach, catch height, the leap at the wall, `DIVE_HEIGHT`) are checked against where he
// really is:
//   catch   the ball is catchable and within his glove (+ the level's gloveBonus): taken once it is down to catchHeight, or at once if it
//           is about to get away from him (a leap at the wall);
//   dive    Dive launches a steered dive (fielderMotion.makeLiveDive); the glove catches the ball if it is within dive.catchRadius of it
//           around the moment the glove arrives. A press up to the level's diveWindow too early waits for the right moment; a press
//           when he could simply run under the ball changes nothing; any other press is a dive that misses (he lies there, gets up);
//   down    the ball touched the ground or the wall with no catch - he keeps chasing it;
//   pickup  he is within groundGlove of the ball once it is low (or at rest). `autoAfter` s after `down` without a pickup the auto-pilot
//           takes over, and `giveUpAfter` s after it the play is ended with the pickup wherever the ball lies (a last resort).
// What he did is recorded as samples [t, x, z, vx, vz] (one per 1/60 s) and handed out as runs the planner and the renderer play back.
import { CONFIG } from '../config.js';
import { sampleBall, airCatchable, airEnd, findAirCatch, findGroundPickup, effort, DIVE_HEIGHT } from './fielding.js';
import { makeTrackRun, makeLiveDive, sampleRun, covered, timeToCover } from './fielderMotion.js';
import { clampToField, distanceToWall } from '../physics/field.js';

const OUTFIELD = new Set(['LF', 'CF', 'RF']);
const SAMPLE_EVERY = 1 / 60; // s between recorded samples
const EPS = 1e-9;

/**
 * Does the player steer this play's fielder? Only while you pitch (the computer bats), with Fielding set to Play, outside the Derby,
 * not while simming or for the bot, on a fair ball in the park that an outfielder goes after.
 */
export function controlEligible(plan, { mode, offense, fielding, simming, bot } = {}) {
  if (!plan || fielding !== 'play' || offense !== 'cpu' || mode === 'derby' || simming || bot) return false;
  return !!plan.fair && !plan.homer && !plan.groundRule && OUTFIELD.has(plan.fielder);
}

const hd = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export class FieldControl {
  /**
   * @param {object} o
   * @param {object} o.sim      the batted ball's flight (physics/ballistics.simulateBattedBall); its time = seconds after contact
   * @param {object} o.defense  createDefense(): he starts on defense[pos] (x, z) with its speed
   * @param {string} o.pos      'LF' | 'CF' | 'RF'
   * @param {object} [o.cfg]    CONFIG
   * @param {string} [o.level]  'rookie' | 'pro' | 'allstar' (difficulty.<level>.fielding: gloveBonus, diveWindow)
   * @param {number} [o.heading] the way he faces at contact (radians, atan2(x, z)); default: toward home plate
   */
  constructor({ sim, defense, pos, cfg = CONFIG, level = 'pro', heading }) {
    const F = cfg.fielding, f = defense[pos];
    const help = (cfg.difficulty[level] && cfg.difficulty[level].fielding) || { gloveBonus: 0, diveWindow: 0 };
    this.sim = sim; this.defense = defense; this.pos = pos; this.cfg = cfg; this.F = F; this.f = f;
    this.C = F.control;
    this.step = F.control.step;
    this.glove = F.glove + help.gloveBonus;
    this.diveWindow = help.diveWindow;
    this.speed = f.speed;
    this.tAir = airEnd(sim); // the last moment it can be caught in the air (it touches the ground / the wall then)
    this.n = 0; // sub-steps taken (time = n * step, so it never drifts)
    this.s = { x: f.x, z: f.z, vx: 0, vz: 0, heading: heading ?? Math.atan2(-f.x, -f.z) };
    this.input = { x: 0, z: 0 };
    this._outcome = null;
    this.downT = null; // when the ball came down uncaught
    this.done = false;
    this.pieces = []; // finished pieces in order: { samples } (a stretch he was steered) or { run } (a dive)
    this.samples = [[0, f.x, f.z, 0, 0]]; // the stretch he is being steered now (null while diving)
    this.dive = null; // the dive run while he is in a dive
    this.press = null; // a Dive press not acted on yet ({ t })
    this.diveAt = null; // a dive held back to the right moment (aim help): launch time
    this.auto = false; // the safety net has handed him to the auto-pilot
    this._plan = undefined; // the auto-pilot's planner-style target (computed when first needed)
    this._fromStart = undefined; // the auto-pilot has had him since contact
  }

  /** Where the stick points, in field coordinates (+x right field, -z toward center); a longer vector is cut to length 1. */
  setInput(dx, dz) {
    const l = Math.hypot(dx, dz);
    const k = l > 1 ? 1 / l : 1;
    this.input.x = (dx || 0) * k; this.input.z = (dz || 0) * k;
  }

  /** Dive (pressed at play time t). Ignored while he is diving, once the play is his, or while an earlier press is pending. */
  pressDive(t) {
    if (this.done || this.dive || this.press || this.diveAt !== null) return;
    this.press = { t };
  }

  get t() { return this.n * this.step; }
  get state() {
    const s = this.s;
    return { x: s.x, z: s.z, vx: s.vx, vz: s.vz, heading: s.heading, t: this.t, diving: !!this.dive };
  }
  get outcome() { return this._outcome; }
  get finished() { return this.done; }

  /** His runs so far, in order: a track run for each stretch he was steered and a dive run for each dive (fielderMotion.samplePath plays them). */
  get runs() {
    const out = [];
    for (const p of this.pieces) out.push(p.run || makeTrackRun(p.samples));
    if (this.samples) {
      const sm = this.samples.slice();
      const last = sm[sm.length - 1], t = this.t;
      if (t > last[0] + EPS) sm.push([t, this.s.x, this.s.z, this.s.vx, this.s.vz]);
      out.push(makeTrackRun(sm));
    }
    return out;
  }

  /** Move him on in fixed sub-steps up to play time t (seconds after contact). */
  advance(t) {
    while (!this.done && (this.n + 1) * this.step <= t + EPS) this._tick();
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  _tick() {
    const t0 = this.t, t1 = (this.n + 1) * this.step;
    if (this.auto) this.autoSteer(t0);
    if (!this.dive && this.press && this.press.t <= t0 + EPS) this._decidePress(t0);
    if (!this.dive && this.diveAt !== null && t0 >= this.diveAt - EPS) this._launch(t0);
    if (this.dive) {
      const p = sampleRun(this.dive, Math.min(t1, this.dive.dive.tEnd), {});
      this.s.x = p.x; this.s.z = p.z; this.s.vx = p.ux * p.speed; this.s.vz = p.uz * p.speed;
    } else {
      Object.assign(this.s, this._move(this.s, this.input, this.step));
    }
    this.n++;
    if (this.dive && t1 >= this.dive.dive.tEnd - EPS) this._getUp(t1);
    else if (this.samples) {
      const last = this.samples[this.samples.length - 1];
      if (t1 - last[0] >= SAMPLE_EVERY - EPS) this.samples.push([t1, this.s.x, this.s.z, this.s.vx, this.s.vz]);
    }
    this._judge(t1);
  }

  // One sub-step of running: his velocity chases input x speed (speeding up with the accel time constant, slowing at no more than
  // `brake`), and he never goes through the wall (he slides along it).
  _move(s, input, dt) {
    const F = this.F;
    const wx = input.x * this.speed, wz = input.z * this.speed;
    const k = 1 - Math.exp(-dt / F.accel);
    let ax = (wx - s.vx) * k, az = (wz - s.vz) * k;
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > EPS) {
      // slowing down (the part of the change against his run) goes at the braking rate, not the speeding-up curve
      const ux = s.vx / sp, uz = s.vz / sp;
      const want = (wx - s.vx) * ux + (wz - s.vz) * uz;
      if (want < 0) {
        const along = ax * ux + az * uz, brake = -Math.min(-want, F.brake * dt);
        ax += ux * (brake - along); az += uz * (brake - along);
      }
    }
    let vx = s.vx + ax, vz = s.vz + az;
    const v = Math.hypot(vx, vz);
    if (v > this.speed) { vx *= this.speed / v; vz *= this.speed / v; }
    let x = s.x + (s.vx + vx) * 0.5 * dt, z = s.z + (s.vz + vz) * 0.5 * dt;
    const [cx, cz] = clampToField(x, z, F.wallBody);
    if (cx !== x || cz !== z) {
      const nx = cx - x, nz = cz - z, nl = Math.hypot(nx, nz);
      const vn = (vx * nx + vz * nz) / nl;
      if (vn < 0) { vx -= (nx / nl) * vn; vz -= (nz / nl) * vn; } // (the part of his run into the wall stops; along it he carries on)
      x = cx; z = cz;
    }
    const heading = Math.hypot(vx, vz) > 0.3 ? Math.atan2(vx, vz) : s.heading;
    return { x, z, vx, vz, heading };
  }

  // Running (not diving) at state s at time t: does he catch it ('catch'), pick it up ('pickup'), or neither (null)?
  _runGets(s, t) {
    const F = this.F, b = sampleBall(this.sim, t, {});
    if (t < this.tAir - EPS) {
      if (!airCatchable(b, F) || hd(s.x, s.z, b.x, b.z) > this.glove) return null;
      if (b.y <= F.catchHeight) return { kind: 'catch', b };
      // above a comfortable height: he waits for it, unless it is about to get away from him (a leap - at the wall, say)
      const tn = t + this.step;
      if (tn >= this.tAir - EPS) return { kind: 'catch', b };
      const bn = sampleBall(this.sim, tn, {});
      if (!airCatchable(bn, F) || hd(s.x + s.vx * this.step, s.z + s.vz * this.step, bn.x, bn.z) > this.glove) return { kind: 'catch', b };
      return null;
    }
    // (a ball at rest counts whatever its height - one that stopped on top of a low wall, say - as in the planner's findGroundPickup)
    if ((b.y <= F.groundHeight || t >= this.sim.duration - EPS) && hd(s.x, s.z, b.x, b.z) <= F.groundGlove) return { kind: 'pickup', b };
    return null;
  }

  // In a dive, at time t: does the glove get the ball? (within catchRadius of it around the moment the glove arrives)
  _diveGets(run, t) {
    const F = this.F, d = run.dive;
    if (t < d.tCatch - this.C.diveSlack - EPS || t > d.tCatch + this.C.diveSlack + EPS) return null;
    const p = sampleRun(run, t, {});
    const gx = p.x + run.ux * F.dive.armReach, gz = p.z + run.uz * F.dive.armReach;
    const b = sampleBall(this.sim, t, {});
    if (hd(gx, gz, b.x, b.z) > F.dive.catchRadius) return null;
    if (t < this.tAir - EPS) return b.y <= DIVE_HEIGHT && airCatchable(b, F) ? { kind: 'catch', b } : null;
    return b.y <= F.groundHeight ? { kind: 'pickup', b } : null;
  }

  _judge(t) {
    if (this.done) return;
    if (!this._outcome && t >= this.tAir - EPS) { this.downT = this.tAir; this._outcome = { kind: 'down', t: this.tAir }; }
    const got = this.dive ? this._diveGets(this.dive, t) : this._runGets(this.s, t);
    if (got && got.kind === 'catch' && !this._outcome) {
      this._outcome = { kind: 'catch', t, dive: !!this.dive, ball: { x: got.b.x, y: got.b.y, z: got.b.z } };
      this.done = true;
    } else if (got && got.kind === 'pickup' && this._outcome && this._outcome.kind === 'down') {
      this._outcome = { kind: 'pickup', t, x: got.b.x, z: got.b.z, dive: !!this.dive };
      this.done = true;
    }
    if (!this.done && this.downT !== null && !this.auto && t >= this.downT + this.C.autoAfter - EPS) this.auto = true;
    // the last resort, never expected: a play can not run on forever - the ball is his where it lies
    if (!this.done && this.downT !== null && t >= this.downT + this.C.giveUpAfter - EPS) {
      const b = sampleBall(this.sim, t, {});
      this._outcome = { kind: 'pickup', t, x: b.x, z: b.z, dive: false };
      this.done = true;
    }
  }

  // The dive he would make if he left his feet at tL from state s (stick held as `input`). A dive for a ball the planner would call a
  // diving catch - at the moment the glove gets there the ball is low enough (DIVE_HEIGHT) and within glove + diveExtra of where his
  // run would have taken him (groundGlove + groundDive for a ball on the ground) - goes straight at it and puts the glove on it.
  // Any other dive goes along his run (or the way he faces when standing) and gets the ball only if it happens to be there.
  _diveFrom(s, tL, input = this.input) {
    const F = this.F, D = F.dive;
    const room = (ux, uz) => { const r = distanceToWall(s.x, s.z, ux, uz, F.wallBody); return Number.isFinite(r) ? { limitS: Math.max(0, r) } : {}; };
    const tc = tL + D.airTime, b = sampleBall(this.sim, tc, {});
    let p = { ...s };
    for (let k = 0; k * this.step < D.airTime - EPS; k++) p = this._move(p, input, this.step);
    const inAir = tc < this.tAir - EPS;
    const reach = inAir ? this.glove + F.diveExtra : F.groundGlove + F.groundDive;
    const ok = inAir ? b.y <= DIVE_HEIGHT && airCatchable(b, F) : b.y <= F.groundHeight;
    const G = hd(s.x, s.z, b.x, b.z);
    if (ok && G > EPS && hd(p.x, p.z, b.x, b.z) <= reach) {
      const ux = (b.x - s.x) / G, uz = (b.z - s.z) / G;
      const along = Math.max(0, s.vx * ux + s.vz * uz);
      const aimed = { x: s.x, z: s.z, vx: ux * along, vz: uz * along, heading: Math.atan2(ux, uz) };
      return makeLiveDive(aimed, tL, { ...D, liveLunge: Math.max(0, G - D.armReach), liveCarry: 0 }, room(ux, uz));
    }
    const v = Math.hypot(s.vx, s.vz);
    const ux = v >= 0.5 ? s.vx / v : Math.sin(s.heading), uz = v >= 0.5 ? s.vz / v : Math.cos(s.heading);
    return makeLiveDive(s, tL, F, room(ux, uz));
  }
  // Would a dive launched at tL from state s (stick held as `input`) get the ball?
  _diveWouldGet(s, tL, input = this.input) {
    const run = this._diveFrom(s, tL, input);
    const tc = run.dive.tCatch, sl = this.C.diveSlack;
    for (let k = Math.ceil((tc - sl - tL) / this.step - EPS); tL + k * this.step <= tc + sl + EPS; k++) {
      if (this._diveGets(run, tL + k * this.step)) return true;
    }
    return false;
  }
  // Would he get the ball by running on with the stick held as it is, before `tTo`?
  _runWouldGet(tTo) {
    let s = { ...this.s };
    const input = { ...this.input };
    for (let k = 0; this.t + k * this.step <= tTo + EPS; k++) {
      const t = this.t + k * this.step;
      if (k > 0) s = this._move(s, input, this.step);
      const g = this._runGets(s, t);
      if (g && (g.kind === 'catch' ? t < this.tAir - EPS : t >= this.tAir - EPS)) return true;
    }
    return false;
  }

  // A Dive press is acted on: nothing if he can simply run to the ball; else he leaves his feet at the first moment (up to diveWindow
  // later, stick held as it is) that the dive gets the ball - or at once, a dive that misses.
  _decidePress(t0) {
    this.press = null;
    const D = this.F.dive;
    if (this._runWouldGet(t0 + D.airTime + this.diveWindow + D.preferRun)) return;
    let s = { ...this.s };
    const input = { ...this.input };
    for (let k = 0; k * this.step <= this.diveWindow + EPS; k++) {
      if (k > 0) s = this._move(s, input, this.step);
      if (this._diveWouldGet(s, t0 + k * this.step, input)) { this.diveAt = t0 + k * this.step; return; }
    }
    this.diveAt = t0;
  }

  _launch(tL) {
    this.diveAt = null;
    const s = this.s;
    const last = this.samples[this.samples.length - 1];
    if (tL > last[0] + EPS) this.samples.push([tL, s.x, s.z, s.vx, s.vz]);
    this.pieces.push({ samples: this.samples });
    this.samples = null;
    this.dive = this._diveFrom(s, tL);
    this.pieces.push({ run: this.dive });
  }

  _getUp(t) {
    const end = sampleRun(this.dive, this.dive.dive.tEnd, {});
    const [x, z] = clampToField(end.x, end.z, this.F.wallBody);
    Object.assign(this.s, { x, z, vx: 0, vz: 0, heading: this.dive.heading });
    this.dive = null;
    this.samples = [[t, x, z, 0, 0]];
  }

  /**
   * What would come of the play if the computer ran him from here (the auto-pilot, from where he is now): { runs, outcome } - for the
   * computer's runners, who judge a send while you are still after the ball. He himself is not moved.
   */
  project() {
    const c = new FieldControl({ sim: this.sim, defense: this.defense, pos: this.pos, cfg: this.cfg, heading: this.s.heading });
    Object.assign(c, {
      glove: this.glove, diveWindow: this.diveWindow, n: this.n, s: { ...this.s }, input: { ...this.input },
      _outcome: this._outcome, downT: this.downT, done: this.done, pieces: this.pieces.slice(),
      samples: this.samples && this.samples.slice(), dive: this.dive, press: this.press && { ...this.press }, diveAt: this.diveAt, auto: true,
    });
    while (!c.done) c.advance(c.t + this.step);
    return { runs: c.runs, outcome: c.outcome };
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // The auto-pilot: steers toward the planner's own interception and dives when the planner would.
  /** Sets the stick (and presses Dive) for play time t as the computer would play it. */
  autoSteer(t) {
    if (this.done || this.dive) return;
    const F = this.F;
    if (this._fromStart === undefined) this._fromStart = t <= this.f.react;
    let tgt = null;
    if (this._fromStart && !this.auto) {
      // driving him from contact: the planner's own catch (or pickup) spot for this fielder
      if (this._plan === undefined) this._plan = this._plannerTarget();
      tgt = this._plan;
      if (tgt && tgt.kind === 'air' && this._outcome) tgt = null; // (it came down after all: chase it)
      if (tgt && tgt.kind === 'ground' && t > tgt.t + F.dive.preferRun) tgt = null; // (not there when the planner said: chase it)
      if (tgt && t < tgt.start) { this.setInput(0, 0); return; }
    }
    if (!tgt) tgt = this._groundTarget(t);
    const s = this.s, dx = tgt.x - s.x, dz = tgt.z - s.z, d = Math.hypot(dx, dz);
    if (d < 0.05) this.setInput(0, 0);
    else {
      const vBrake = Math.sqrt(2 * F.brake * this.C.autoBrake * d);
      const left = tgt.t - t;
      const need = left > EPS ? Math.max(0, d - tgt.reach * this.C.autoReach) / left : this.speed;
      const vd = Math.min(this.speed, Math.max(vBrake, need));
      this.setInput((dx / d) * (vd / this.speed), (dz / d) * (vd / this.speed));
    }
    // dive when running will not get there and a dive launched now will
    if (!this.press && this.diveAt === null && t >= tgt.t - F.dive.airTime - this.C.diveSlack - this.step &&
      t <= tgt.t + this.C.diveSlack && !this._runWouldGet(tgt.t + F.dive.preferRun) && this._diveWouldGet(this.s, this.t)) this.pressDive(t);
  }

  // The planner's catch (findAirCatch) or pickup (findGroundPickup) for this one fielder, and when to set off so that by then he has
  // covered exactly the ground the planner's fielder would have (its reaction time, and its slower run back / quicker run in).
  _plannerTarget() {
    const F = this.F, f = this.f;
    const hit = findAirCatch(this.sim, this.defense, this.cfg, [this.pos]);
    const p = hit || findGroundPickup(this.sim, this.defense, this.cfg, [this.pos]);
    const start0 = hit ? f.react : p.start;
    const eff = effort(f, p.ball.x, p.ball.z);
    const ground = covered(f.speed * eff, p.t - start0, F.accel);
    const start = Math.max(0, p.t - timeToCover(this.speed, ground, F.accel));
    return { kind: hit ? 'air' : 'ground', x: p.ball.x, z: p.ball.z, t: p.t, reach: hit ? this.glove : F.groundGlove, start };
  }

  // Where to meet a ball on the ground (or about to be): the first moment he could reach it running flat out from where he is.
  _groundTarget(t) {
    const F = this.F, s = this.s, sim = this.sim;
    const reach = F.groundGlove * this.C.autoReach;
    for (let tt = Math.max(t, this.tAir); tt <= sim.duration + EPS; tt += SAMPLE_EVERY) {
      const b = sampleBall(sim, tt, {});
      if (b.y > F.groundHeight) continue;
      if (hd(s.x, s.z, b.x, b.z) - reach <= covered(this.speed, tt - t, F.accel)) return { kind: 'ground', x: b.x, z: b.z, t: tt, reach: F.groundGlove };
    }
    const b = sampleBall(sim, sim.duration, {});
    return { kind: 'ground', x: b.x, z: b.z, t: t + timeToCover(this.speed, hd(s.x, s.z, b.x, b.z), F.accel), reach: F.groundGlove };
  }
}
