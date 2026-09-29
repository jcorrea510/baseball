// How fielders MOVE. Pure logic (no graphics), shared by the fielding planner and the renderer so that what the
// planner promises ("he gets there in time") is exactly what the picture shows.
//
//  * planRun / sampleRun  - one planned run: wait (reaction), accelerate, cruise, brake. Speed changes smoothly, the
//                           fielder stops exactly on his spot, and on a tight play he arrives at speed and eases to a stop
//                           AFTER the catch (a running catch) instead of stopping dead.
//  * samplePath           - several runs in a row (field the ball, then cover a base ...).
//  * Mover                - a steering integrator for everything that is not a planned run (jogging back to position,
//                           repositioning). It brakes on a curve, stops inside a small arrival radius and ignores
//                           target changes smaller than a threshold, so it can never jitter or oscillate.
import { clamp, wrapAngle } from '../util/math.js';

const EPS = 1e-9;

/**
 * Plan one straight run.
 * @param {object} o
 * @param {number} o.x0 @param {number} o.z0   start
 * @param {number} o.x1 @param {number} o.z1   target
 * @param {number} o.tStart    when he starts moving (after his reaction time)
 * @param {number} o.tArrive   when he must be at the target (catch / pickup time)
 * @param {number} o.vmax      top speed (ft/s)
 * @param {number} o.accel     ft/s^2 while getting up to speed
 * @param {number} o.brake     ft/s^2 while slowing down
 * @param {number} [o.minEffort]  fraction of vmax he never drops below while running (he arrives early and waits)
 * @param {number} [o.heading] facing (radians, atan2(x, z)) to report when the run has zero length
 */
export function planRun(o) {
  const { x0, z0, x1, z1, tStart, tArrive, vmax, accel: a, brake: b } = o;
  const minEffort = o.minEffort ?? 0.62;
  const dx = x1 - x0, dz = z1 - z0;
  const D = Math.hypot(dx, dz);
  const ux = D > 1e-6 ? dx / D : Math.sin(o.heading ?? 0);
  const uz = D > 1e-6 ? dz / D : Math.cos(o.heading ?? 0);
  const segs = [];
  let t = tStart, s = 0, v = 0;
  const add = (name, dur, acc) => {
    if (!(dur > EPS)) return;
    segs.push({ name, t0: t, s0: s, v0: v, a: acc });
    s += v * dur + 0.5 * acc * dur * dur;
    v += acc * dur;
    t += dur;
  };
  const run = { x0, z0, ux, uz, D, tStart, tArrive, vmax, segs, x1, z1, heading: Math.atan2(ux, uz) };

  if (D < 0.05) {
    segs.push({ name: 'rest', t0: tStart, s0: 0, v0: 0, a: 0 });
    Object.assign(run, { tReach: tStart, tStop: tStart, sStop: 0, vArrive: 0, xStop: x0, zStop: z0 });
    return run;
  }

  const T = Math.max(0, tArrive - tStart);
  const K = 0.5 / a + 0.5 / b;
  const vStar = Math.sqrt(D / K); // fastest speed for which a stop-at-the-target run still has a cruise phase
  const vCap = Math.min(vmax, vStar);
  const tMinStop = D / vCap + vCap * K; // quickest possible run that ends at rest on the target

  if (T >= tMinStop - 1e-9) {
    // Plenty of time: run at the gentlest speed that still arrives on time (never slower than minEffort), stop on the spot.
    const disc = T * T - 4 * K * D;
    let vc = disc >= 0 ? (T - Math.sqrt(disc)) / (2 * K) : vCap;
    vc = clamp(vc, Math.min(minEffort * vmax, vCap), vCap);
    add('accel', vc / a, a);
    add('cruise', (D - vc * vc * K) / vc, 0);
    add('brake', vc / b, -b);
    run.vArrive = 0;
    run.tReach = t;
  } else {
    // Tight play: no time to stop before the ball arrives. Get there exactly on time at whatever speed that takes,
    // then ease to a stop past the spot (he catches it on the run).
    const dFull = (vmax * vmax) / (2 * a);
    const tNoBrake = D >= dFull ? vmax / a + (D - dFull) / vmax : Math.sqrt((2 * D) / a);
    const Te = Math.max(T, tNoBrake);
    let vc;
    if (Te <= tNoBrake + 1e-9) vc = D >= dFull ? vmax : Math.sqrt(2 * a * D);
    else vc = Math.min(vmax, a * (Te - Math.sqrt(Math.max(0, Te * Te - (2 * D) / a))));
    if (vc * vc / (2 * a) >= D) {
      add('accel', Math.sqrt((2 * D) / a), a); // still accelerating when he reaches the spot
    } else {
      add('accel', vc / a, a);
      add('cruise', (D - (vc * vc) / (2 * a)) / vc, 0);
    }
    run.vArrive = v;
    run.tReach = t;
    add('brake', v / b, -b);
  }
  run.sStop = s;
  run.tStop = t;
  segs.push({ name: 'rest', t0: t, s0: s, v0: 0, a: 0 });
  run.xStop = x0 + ux * s;
  run.zStop = z0 + uz * s;
  return run;
}

const _out = { x: 0, z: 0, speed: 0, ux: 0, uz: 1, s: 0, phase: 'wait', heading: 0, done: false };

/** Where is this run at time t? Returns a shared object (copy what you need). */
export function sampleRun(run, t, out = _out) {
  let s, v, phase;
  if (t <= run.tStart) { s = 0; v = 0; phase = 'wait'; }
  else {
    let i = run.segs.length - 1;
    while (i > 0 && run.segs[i].t0 > t) i--;
    const g = run.segs[i];
    const dt = t - g.t0;
    s = g.s0 + g.v0 * dt + 0.5 * g.a * dt * dt;
    v = Math.max(0, g.v0 + g.a * dt);
    phase = g.name;
    if (i === run.segs.length - 1) { s = g.s0; v = 0; }
  }
  out.x = run.x0 + run.ux * s;
  out.z = run.z0 + run.uz * s;
  out.speed = v;
  out.ux = run.ux; out.uz = run.uz;
  out.s = s;
  out.phase = phase;
  out.heading = run.heading;
  out.done = t >= run.tStop;
  return out;
}

/** Several runs in a row. Each later run starts where the earlier one came to rest. */
export function samplePath(runs, t, out = _out) {
  let r = runs[0];
  for (let i = 1; i < runs.length; i++) if (t >= runs[i].tStart) r = runs[i];
  return sampleRun(r, t, out);
}

// ---------------------------------------------------------------------------------------------------------------
// Turning
// ---------------------------------------------------------------------------------------------------------------
/** Turn `current` toward `target` (radians) by at most `maxStep`, smoothly (slows as it lines up). */
export function turnToward(current, target, maxStep, ease = 14, dt = 1 / 60) {
  const d = wrapAngle(target - current);
  const want = d * (1 - Math.exp(-ease * dt));
  const step = clamp(want, -maxStep, maxStep);
  return wrapAngle(current + step);
}

// ---------------------------------------------------------------------------------------------------------------
// Mover: steering toward a target with a braking curve, an arrival radius and target hysteresis.
// ---------------------------------------------------------------------------------------------------------------
export class Mover {
  constructor(x = 0, z = 0, o = {}) {
    this.o = { vmax: 20, accel: 34, brake: 42, radius: 0.4, retarget: 0.9, wake: 1.4, ...o };
    this.reset(x, z);
  }
  reset(x, z, vx = 0, vz = 0) {
    this.x = x; this.z = z; this.vx = vx; this.vz = vz;
    this.tx = x; this.tz = z;
    this.parked = Math.hypot(vx, vz) < 0.5; // parked = standing still with nothing to do
    this.speed = Math.hypot(vx, vz);
  }
  /** Aim for a new spot. Tiny changes are ignored so a noisy target can never make him dither. */
  setTarget(x, z) {
    if (this.parked) {
      if (Math.hypot(x - this.x, z - this.z) <= this.o.wake) return; // parked: only wake up for a real move
      this.parked = false;
    } else if (Math.hypot(x - this.tx, z - this.tz) <= this.o.retarget) return;
    this.tx = x; this.tz = z;
  }
  /** Inside the arrival radius and nearly stopped: for animation purposes he has arrived. */
  get arrived() {
    return this.parked || (Math.hypot(this.tx - this.x, this.tz - this.z) <= this.o.radius && this.speed < 1.5);
  }
  get moving() { return !this.arrived; }
  update(dt) {
    if (dt <= 0) return this;
    if (this.parked) { this.vx = this.vz = 0; this.speed = 0; return this; }
    const o = this.o;
    const dx = this.tx - this.x, dz = this.tz - this.z;
    const d = Math.hypot(dx, dz);
    const sp = Math.hypot(this.vx, this.vz);
    if (d < 0.03 && sp < 0.8) return this.land();
    // Braking curve: the fastest speed from which he can still stop exactly on the target (using 75% of his braking power,
    // so there is always a reserve and he never overshoots). The last foot is a slow glide, not a snap.
    const vd = Math.min(o.vmax, Math.sqrt(2 * o.brake * 0.75 * d));
    const nx = d > 1e-6 ? dx / d : 0, nz = d > 1e-6 ? dz / d : 0;
    const wx = nx * vd - this.vx, wz = nz * vd - this.vz;
    const wl = Math.hypot(wx, wz);
    const maxDv = (vd >= sp ? o.accel : o.brake) * dt;
    const k = wl > maxDv && wl > 1e-9 ? maxDv / wl : 1;
    this.vx += wx * k; this.vz += wz * k;
    const ox = this.x - this.tx, oz = this.z - this.tz;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.speed = Math.hypot(this.vx, this.vz);
    // stepped onto or past the target: land on it (he is going slowly by now, so this is imperceptible)
    if ((this.x - this.tx) * ox + (this.z - this.tz) * oz <= 0) return this.land();
    return this;
  }
  land() {
    this.x = this.tx; this.z = this.tz; this.vx = this.vz = 0; this.speed = 0; this.parked = true;
    return this;
  }
}
