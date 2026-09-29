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

// ---------------------------------------------------------------------------------------------------------------
// The movement model (shared by the planner's "can he get there?" search and by what is drawn):
// a fielder heading for a spot at cruise speed `vc` speeds up like v = vc * (1 - e^(-t/A)) - smooth from the first step,
// no jerk when he reaches speed - and covers vc * (t - A * (1 - e^(-t/A))) feet in t seconds.
// ---------------------------------------------------------------------------------------------------------------
export function covered(speed, tau, A) {
  if (tau <= 0) return 0;
  return speed * (tau - A * (1 - Math.exp(-tau / A)));
}
/** The time (after he starts moving) he needs to cover `d` feet. */
export function timeToCover(speed, d, A) {
  if (d <= 0) return 0;
  let lo = 0, hi = d / speed + A + 0.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (covered(speed, mid, A) < d) lo = mid; else hi = mid;
  }
  return hi;
}
const speedAt = (vc, tau, A) => vc * (1 - Math.exp(-tau / A));

/**
 * Plan one straight run.
 * @param {object} o
 * @param {number} o.x0 @param {number} o.z0   start
 * @param {number} o.x1 @param {number} o.z1   target
 * @param {number} o.tStart    when he starts moving (after his reaction time)
 * @param {number} o.tArrive   when he must be at the target (catch / pickup time)
 * @param {number} o.vmax      top speed (ft/s)
 * @param {number} o.accel     initial acceleration at top speed, ft/s^2 (sets the time constant A = vmax / accel)
 * @param {number} o.brake     ft/s^2 while slowing down
 * @param {number} [o.minEffort]  fraction of vmax he never drops below while running (he arrives early and waits)
 * @param {number} [o.heading] facing (radians, atan2(x, z)) to report when the run has zero length
 * @param {number} [o.limitS]  the farthest he may travel along the run (a wall is there): he never goes past it. If braking at
 *                             `brake` would carry him past it he brakes harder (up to `wallBrake`), and if that is not enough
 *                             he starts slowing down before the target.
 * @param {number} [o.wallBrake] ft/s^2 he can brake at when bracing against a wall
 */
export function planRun(o) {
  const { x0, z0, x1, z1, tStart, tArrive, vmax, brake: b } = o;
  const A = vmax / o.accel;
  const minEffort = o.minEffort ?? 0.62;
  const dx = x1 - x0, dz = z1 - z0;
  const D = Math.hypot(dx, dz);
  const ux = D > 1e-6 ? dx / D : Math.sin(o.heading ?? 0);
  const uz = D > 1e-6 ? dz / D : Math.cos(o.heading ?? 0);
  const segs = [];
  const run = { x0, z0, ux, uz, D, tStart, tArrive, vmax, segs, x1, z1, heading: Math.atan2(ux, uz), A, limitS: o.limitS };

  if (D < 0.05) {
    segs.push({ name: 'rest', t0: tStart, s0: 0, v0: 0, a: 0 });
    Object.assign(run, { tReach: tStart, tStop: tStart, sStop: 0, vArrive: 0, xStop: x0, zStop: z0 });
    return run;
  }

  // Where he must start braking to stop exactly on the target when heading for cruise speed vc.
  const stopPlan = (vc) => {
    let lo = 0, hi = D / vc + 4 * A + 1;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      const v = speedAt(vc, mid, A);
      if (covered(vc, mid, A) + (v * v) / (2 * b) < D) lo = mid; else hi = mid;
    }
    return { tb: hi, vb: speedAt(vc, hi, A), tTotal: hi + speedAt(vc, hi, A) / b };
  };

  const T = Math.max(0, tArrive - tStart);
  const full = stopPlan(vmax);
  if (T >= full.tTotal - 1e-9) {
    // Time to spare: run at the gentlest speed that still arrives on time (never slower than minEffort) and stop on the spot.
    const floor = minEffort * vmax;
    let vc = vmax;
    if (stopPlan(floor).tTotal <= T) vc = floor;
    else {
      let lo = floor, hi = vmax;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (stopPlan(mid).tTotal > T) lo = mid; else hi = mid; }
      vc = hi;
    }
    const sp = stopPlan(vc);
    segs.push({ name: 'accel', kind: 'exp', t0: tStart, s0: 0, vc, A });
    segs.push({ name: 'brake', t0: tStart + sp.tb, s0: covered(vc, sp.tb, A), v0: sp.vb, a: -b });
    run.vArrive = 0;
    run.tReach = tStart + sp.tTotal;
    run.tStop = tStart + sp.tTotal;
    run.sStop = D;
  } else {
    // Tight play: no time to stop before the ball gets there. He paces himself to reach the spot exactly when the ball does
    // (the gentlest speed that is still on time; flat out if that is what it takes), catches on the run and eases to a stop
    // just past it.
    let vc = vmax;
    if (timeToCover(vmax, D, A) > T + 1e-9) vc = vmax; // (cannot make it: as fast as he can, and a little late)
    else {
      let lo = Math.min(minEffort * vmax, vmax), hi = vmax;
      if (timeToCover(lo, D, A) <= T) hi = lo;
      else for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (timeToCover(mid, D, A) > T) lo = mid; else hi = mid; }
      vc = hi;
    }
    const tau = timeToCover(vc, D, A);
    const vR = speedAt(vc, tau, A);
    // Is there a wall in the way of the natural braking distance?
    const room = o.limitS !== undefined ? Math.max(0.35, o.limitS - D) : Infinity;
    const bW = Math.max(b, o.wallBrake ?? b * 2.5);
    if (vR * vR / (2 * b) <= room) {
      segs.push({ name: 'accel', kind: 'exp', t0: tStart, s0: 0, vc, A });
      segs.push({ name: 'brake', t0: tStart + tau, s0: D, v0: vR, a: -b });
      run.vArrive = vR;
      run.tReach = tStart + tau;
      run.tStop = tStart + tau + vR / b;
      run.sStop = D + (vR * vR) / (2 * b);
    } else if (vR * vR / (2 * room) <= bW) {
      // brakes harder from the target on, and stops exactly at the wall
      const bE = (vR * vR) / (2 * room);
      segs.push({ name: 'accel', kind: 'exp', t0: tStart, s0: 0, vc, A });
      segs.push({ name: 'brake', t0: tStart + tau, s0: D, v0: vR, a: -bE });
      run.vArrive = vR;
      run.tReach = tStart + tau;
      run.tStop = tStart + tau + vR / bE;
      run.sStop = D + room;
    } else {
      // too fast to stop in `room` even braking hard: start slowing down before the target so that he reaches it slowly enough
      const vCap = Math.sqrt(2 * bW * room);
      let lo = 0, hi = tau; // seconds after he starts: when the (hard) braking begins
      for (let k = 0; k < 44; k++) {
        const mid = (lo + hi) / 2;
        const v = speedAt(vc, mid, A);
        if (covered(vc, mid, A) + (v * v - vCap * vCap) / (2 * bW) < D) lo = mid; else hi = mid;
      }
      const tb = hi, vb = speedAt(vc, tb, A);
      segs.push({ name: 'accel', kind: 'exp', t0: tStart, s0: 0, vc, A });
      segs.push({ name: 'brake', t0: tStart + tb, s0: covered(vc, tb, A), v0: vb, a: -bW });
      run.vArrive = vCap;
      run.tReach = tStart + tb + (vb - vCap) / bW;
      run.tStop = tStart + tb + vb / bW;
      run.sStop = covered(vc, tb, A) + (vb * vb) / (2 * bW);
    }
    if (o.limitS !== undefined) run.limitS = o.limitS;
  }
  segs.push({ name: 'rest', t0: run.tStop, s0: run.sStop, v0: 0, a: 0 });
  run.xStop = x0 + ux * run.sStop;
  run.zStop = z0 + uz * run.sStop;
  return run;
}

const _out = { x: 0, z: 0, speed: 0, ux: 0, uz: 1, s: 0, phase: 'wait', heading: 0, done: false, u: 0 };

// ---------------------------------------------------------------------------------------------------------------
// Dives: sprint at the ball, launch, fly, land, slide, lie there, get up - one continuous motion in one direction.
// ---------------------------------------------------------------------------------------------------------------
/**
 * Plan a run that ends in a dive. Returns null when no dive is actually needed (he can just run there).
 * @param {object} o
 * @param {number} o.x0 @param {number} o.z0  where he starts
 * @param {number} o.px @param {number} o.pz  where the ball is when the glove meets it
 * @param {number} o.tStart  when he starts running
 * @param {number} o.tCatch  when the glove meets the ball
 * @param {number} o.vmax @param {number} o.accel @param {number} o.brake
 * @param {object} o.dive    config.fielding.dive
 * @param {number} [o.limitS]  farthest he may travel along the run (a wall): the slide is shortened to stop in front of it
 */
export function planDiveRun(o) {
  const dv = o.dive;
  const dx = o.px - o.x0, dz = o.pz - o.z0;
  const D = Math.hypot(dx, dz);
  if (D < 3) return null;
  const ux = dx / D, uz = dz / D;
  const vmax = o.vmax;
  const A = vmax / o.accel;
  // he is airborne for `airTime` before the glove meets the ball (less only if the ball arrives before he has even reacted,
  // but never less than a lunge's worth)
  const airPre = clamp(o.tCatch - (o.tStart + 0.05), 0.14, dv.airTime);
  const tL = o.tCatch - airPre;
  const tRun = Math.max(0, tL - o.tStart);
  const sL = covered(vmax, tRun, A); // flat-out sprint until launch
  const vL = speedAt(vmax, tRun, A);
  const sCatch = D - dv.armReach; // how far his body must have travelled when the glove meets the ball
  const sAir = Math.max(0.75, sCatch - sL); // what the flight has to cover (a ball only a stride away is still a short lunge)

  // the flight: a smooth curve that starts at his running speed and ends at touchdown speed
  const Ta = airPre + dv.landAfter;
  const vLand = clamp(0.7 * (sAir / airPre), 6, dv.landSpeed);
  const sg = airPre / Ta; // how far through the flight the glove meets the ball
  const h01 = 3 * sg * sg - 2 * sg ** 3, h10 = sg ** 3 - 2 * sg * sg + sg, h11 = sg ** 3 - sg * sg;
  const sFlight = Math.max(sAir, (sAir - h10 * Ta * vL - h11 * Ta * vLand) / h01); // total distance to touchdown

  const segs = [
    { name: 'accel', kind: 'exp', t0: o.tStart, s0: 0, vc: vmax, A },
    { name: 'rest', t0: tL, s0: sL, v0: 0, a: 0 }, // (never reached: sampleRun hands over to sampleDive at tL)
  ];
  const tLand = tL + Ta;
  let decel = dv.slideDecel;
  if (o.limitS !== undefined) {
    const room = Math.max(0.3, o.limitS - (sL + sFlight));
    if ((vLand * vLand) / (2 * decel) > room) decel = (vLand * vLand) / (2 * room); // skids to a stop before the wall
  }
  const slideDur = vLand / decel;
  const slideDist = (vLand * vLand) / (2 * decel);
  const dive = {
    tL, tCatch: o.tCatch, tLand, tSlideEnd: tLand + slideDur, tHoldEnd: tLand + slideDur + dv.hold, tEnd: tLand + slideDur + dv.hold + dv.getUp,
    Ta, airPre, catchU: sg, sL, vL, sFlight, vLand, slideDist, slideDur, decel, sAir, sCatch, armReach: dv.armReach, hold: dv.hold, getUp: dv.getUp, ux, uz,
  };
  const sEnd = sL + sFlight + slideDist;
  return {
    x0: o.x0, z0: o.z0, ux, uz, D, tStart: o.tStart, tArrive: o.tCatch, vmax, segs, x1: o.px, z1: o.pz, heading: Math.atan2(ux, uz), A, limitS: o.limitS,
    dive, tReach: o.tCatch, tStop: dive.tEnd, sStop: sEnd, vArrive: vLand, xStop: o.x0 + ux * sEnd, zStop: o.z0 + uz * sEnd,
  };
}

function sampleDive(run, t, out) {
  const d = run.dive;
  let s, v, phase, u;
  if (t < d.tLand) {
    const tau = t - d.tL;
    const sg = clamp(tau / d.Ta, 0, 1);
    const h00 = 2 * sg ** 3 - 3 * sg * sg + 1, h10 = sg ** 3 - 2 * sg * sg + sg, h01 = -2 * sg ** 3 + 3 * sg * sg, h11 = sg ** 3 - sg * sg;
    s = d.sL + h10 * d.Ta * d.vL + h01 * d.sFlight + h11 * d.Ta * d.vLand;
    // derivative of the Hermite curve
    const dh00 = (6 * sg * sg - 6 * sg) / d.Ta, dh10 = (3 * sg * sg - 4 * sg + 1) / d.Ta, dh01 = (-6 * sg * sg + 6 * sg) / d.Ta, dh11 = (3 * sg * sg - 2 * sg) / d.Ta;
    v = Math.max(0, dh10 * d.Ta * d.vL + dh01 * d.sFlight + dh11 * d.Ta * d.vLand + dh00 * 0);
    void h00;
    phase = 'air'; u = sg;
  } else if (t < d.tSlideEnd) {
    const tau = t - d.tLand;
    s = d.sL + d.sFlight + d.vLand * tau - 0.5 * d.decel * tau * tau;
    v = Math.max(0, d.vLand - d.decel * tau);
    phase = 'slide'; u = tau / d.slideDur;
  } else {
    s = d.sL + d.sFlight + d.slideDist; v = 0;
    if (t < d.tHoldEnd) { phase = 'hold'; u = (t - d.tSlideEnd) / d.hold; }
    else if (t < d.tEnd) { phase = 'getup'; u = (t - d.tHoldEnd) / d.getUp; }
    else { phase = 'done'; u = 1; }
  }
  if (run.limitS !== undefined && s > run.limitS) { s = run.limitS; v = 0; } // never through the wall
  out.x = run.x0 + run.ux * s;
  out.z = run.z0 + run.uz * s;
  out.speed = v;
  out.ux = run.ux; out.uz = run.uz;
  out.s = s;
  out.phase = phase;
  out.u = u;
  out.heading = run.heading;
  out.done = t >= d.tEnd;
  return out;
}


/** Where is this run at time t? Returns a shared object (copy what you need). */
export function sampleRun(run, t, out = _out) {
  if (run.dive && t >= run.dive.tL) return sampleDive(run, t, out);
  let s, v, phase;
  if (t <= run.tStart) { s = 0; v = 0; phase = 'wait'; }
  else {
    let i = run.segs.length - 1;
    while (i > 0 && run.segs[i].t0 > t) i--;
    const g = run.segs[i];
    const dt = t - g.t0;
    if (g.kind === 'exp') { s = covered(g.vc, dt, g.A); v = speedAt(g.vc, dt, g.A); }
    else { s = g.s0 + g.v0 * dt + 0.5 * g.a * dt * dt; v = Math.max(0, g.v0 + g.a * dt); }
    phase = g.name;
    if (i === run.segs.length - 1) { s = g.s0; v = 0; }
  }
  if (run.limitS !== undefined && s > run.limitS) { s = run.limitS; v = 0; } // never through the wall
  out.x = run.x0 + run.ux * s;
  out.z = run.z0 + run.uz * s;
  out.speed = v;
  out.ux = run.ux; out.uz = run.uz;
  out.s = s;
  out.phase = phase;
  out.u = 0;
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
    // o.bound (optional): (x, z) => [x, z] keeps him inside somewhere (the ballpark). If he ever touches the limit he stops there.
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
    if (o.bound) {
      const [bx, bz] = o.bound(this.x, this.z);
      if (bx !== this.x || bz !== this.z) { this.x = bx; this.z = bz; this.vx = this.vz = 0; this.speed = 0; }
    }
    // stepped onto or past the target: land on it (he is going slowly by now, so this is imperceptible)
    if ((this.x - this.tx) * ox + (this.z - this.tz) * oz <= 0) return this.land();
    return this;
  }
  land() {
    this.x = this.tx; this.z = this.tz; this.vx = this.vz = 0; this.speed = 0; this.parked = true;
    return this;
  }
}

/**
 * How long does the jog take (`Mover` steering, same numbers the renderer uses) from (x, z) - moving at (vx, vz) - to come to
 * rest on the spot (hx, hz)? The engine uses this to know when a fielder is back where he belongs.
 */
export function moverReturnTime(x, z, vx, vz, hx, hz, opts = {}) {
  const m = new Mover(x, z, opts);
  m.reset(x, z, vx, vz);
  m.tx = hx; m.tz = hz; m.parked = false;
  if (Math.hypot(hx - x, hz - z) < 0.05 && Math.hypot(vx, vz) < 0.5) return 0;
  const dt = 1 / 60;
  let t = 0;
  while (!m.parked && t < 60) { m.update(dt); t += dt; }
  return t;
}
/** The same from a standstill, `distance` feet away. */
export function moverTravelTime(distance, opts = {}) {
  if (!(distance > 0.05)) return 0;
  return moverReturnTime(0, 0, 0, 0, distance, 0, opts);
}

// If the play ends while a planned run still has this long to go, the fielder is handed to the jog at once (see Actors.updateFielders);
// a run that is nearly done is finished first (so he does not carry his speed through a wall or lurch to a stop).
export const TAIL_MAX = 0.7;
