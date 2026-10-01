// How base runners MOVE. Pure logic (no graphics), shared by the fielding planner ("does he beat the throw?") and the
// renderer (what is drawn), so the picture always agrees with the result.
//
//  * The route: from where he starts (the lead-off spot, or the plate for the batter) through each base. At a base he
//    keeps running through he does not turn on a dime: he swings wide, touches the inside corner of the bag and heads on
//    straight (a smooth curve through the base, see buildRoute).
//  * The speed: he starts from a standstill and speeds up like v = vmax * (1 - e^(-t/A)); on a curve he can only go as
//    fast as his sideways grip allows (v <= sqrt(latAccel / curvature)), so he slows into a turn and speeds up coming out
//    of it; at the last base he brakes (or slides) and stops on the bag.
import { CONFIG } from '../config.js';
import { BASE_XZ, dugoutSpot } from '../physics/field.js';

const STEP = 0.5; // ft between route samples
const DT = 1 / 240; // s between speed samples

const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const right = (d) => [-d[1], d[0]]; // to his right when he faces d = (dx, dz) with +x = right field and -z = toward center field

/** Where a runner stands before the pitch: a short lead toward the next base. (The renderer draws him here too.) */
export function leadSpot(base, cfg = CONFIG) {
  const b = BASE_XZ[base], n = BASE_XZ[base === 3 ? 4 : base + 1];
  const [ux, uz] = norm(n[0] - b[0], n[1] - b[1]);
  const side = base === 1 ? 1.2 : base === 3 ? -1.2 : 0;
  const lead = base === 2 ? cfg.runner.leadSecond ?? cfg.runner.lead : cfg.runner.lead; // (off second base nobody holds him on: a bigger lead)
  return [b[0] + ux * lead + side, b[1] + uz * lead];
}

/**
 * The route from `from` (0 = the plate, i.e. the batter; 1..3 = a runner leading off that base) to base `to` (1..4, 4 = home).
 * `through`: he runs on through the last base (batter at first) and stops after it.
 * Returns { x[], z[], s[], heading[], kappa[], sBase{ k: arc length where he touches base k }, sEnd }.
 */
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const smooth01 = (u) => u * u * (3 - 2 * u);

// The curve a runner takes around the corner at base V (coming from `prev`, heading on to `next`): drift out from the baseline,
// go round a circular arc of radius R that just touches the bag, drift back onto the next baseline. Returns the geometry.
function corner(prev, V, next, R, LtMax) {
  const d1 = norm(V[0] - prev[0], V[1] - prev[1]);
  const d2 = norm(next[0] - V[0], next[1] - V[1]);
  const r1 = right(d1), r2 = right(d2);
  const theta = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
  const delta = R * (1 - Math.cos(theta / 2)); // how far outside the baseline he runs so the arc's middle is the bag itself
  const w = [delta * (r2[0] - r1[0]), delta * (r2[1] - r1[1])];
  const mb = [-d2[0], -d2[1]];
  const den = cross(d1, mb) || 1e-9;
  const sX = cross(w, mb) / den;
  const X = [V[0] + delta * r1[0] + sX * d1[0], V[1] + delta * r1[1] + sX * d1[1]];
  const T = R * Math.tan(theta / 2);
  const A = [X[0] - d1[0] * T, X[1] - d1[1] * T];
  const B = [X[0] + d2[0] * T, X[1] + d2[1] * T];
  const C = [A[0] - r1[0] * R, A[1] - r1[1] * R];
  const reach = (P, d) => (P[0] - V[0]) * d[0] + (P[1] - V[1]) * d[1];
  return { d1, d2, r1, r2, delta, A, B, C, theta, before: -reach(A, d1), after: reach(B, d2), R };
}

/**
 * The route from `from` (0 = the plate, i.e. the batter; 1..3 = a runner leading off that base) to base `to` (1..4, 4 = home).
 * `through`: he runs on through the last base (batter at first) and stops after it.
 * Returns { x[], z[], s[], heading[], kappa[], sBase{ k: arc length where he touches base k }, sEnd }.
 */
export function buildRoute(from, to, { through = false, fromBag = false } = {}, cfg = CONFIG) {
  const R = cfg.runner;
  const start = from === 0 ? [0, 0] : fromBag ? BASE_XZ[from].slice() : leadSpot(from, cfg); // (fromBag: he stopped on the bag and was sent on)
  const pts = [start.slice()];
  const baseAt = {}; // sample index of each base
  const lineTo = (p) => { // straight, sampled
    const a = pts[pts.length - 1];
    const len = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const m = Math.max(1, Math.ceil(len / STEP));
    for (let k = 1; k <= m; k++) pts.push([a[0] + ((p[0] - a[0]) * k) / m, a[1] + ((p[1] - a[1]) * k) / m]);
  };
  // corners first (so each knows how much room it has on both sides), then walk the route
  const corners = {};
  let prev = start;
  for (let k = from + 1; k < to; k++) { corners[k] = corner(prev, BASE_XZ[k], BASE_XZ[k + 1], R.turnRadius, R.turnLen); prev = BASE_XZ[k]; }
  prev = start;
  for (let k = from + 1; k <= to; k++) {
    const cur = BASE_XZ[k];
    if (k < to) {
      const c = corners[k];
      const legIn = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      const legOut = Math.hypot(BASE_XZ[k + 1][0] - cur[0], BASE_XZ[k + 1][1] - cur[1]);
      const nextC = corners[k + 1];
      const prevC = corners[k - 1];
      // drift-out / drift-back distance: as long as configured, but never more than the leg has room for
      const LtIn = Math.max(4, Math.min(R.turnLen, (legIn - c.before - (prevC ? prevC.after : 0)) / (prevC ? 2 : 1)));
      const LtOut = Math.max(4, Math.min(R.turnLen, (legOut - c.after - (nextC ? nextC.before : 0)) / (nextC ? 2 : 1)));
      const Q0 = [c.A[0] - c.d1[0] * LtIn - c.r1[0] * c.delta, c.A[1] - c.d1[1] * LtIn - c.r1[1] * c.delta];
      lineTo(Q0);
      const nIn = Math.max(6, Math.ceil(LtIn / STEP));
      for (let q = 1; q <= nIn; q++) {
        const u = q / nIn, o = c.delta * smooth01(u);
        pts.push([Q0[0] + c.d1[0] * LtIn * u + c.r1[0] * o, Q0[1] + c.d1[1] * LtIn * u + c.r1[1] * o]);
      }
      // the arc (turning left: the centre is on his left)
      const a0 = [c.A[0] - c.C[0], c.A[1] - c.C[1]];
      const nArc = Math.max(8, Math.ceil((R.turnRadius * c.theta) / STEP));
      const rot = (sgn) => { const psi = sgn * c.theta; return [c.C[0] + a0[0] * Math.cos(psi) - a0[1] * Math.sin(psi), c.C[1] + a0[0] * Math.sin(psi) + a0[1] * Math.cos(psi)]; };
      const e1 = rot(1), e2 = rot(-1);
      const sgn = Math.hypot(e1[0] - c.B[0], e1[1] - c.B[1]) < Math.hypot(e2[0] - c.B[0], e2[1] - c.B[1]) ? 1 : -1;
      let bestI = pts.length, bestD = Infinity;
      for (let q = 1; q <= nArc; q++) {
        const psi = (sgn * c.theta * q) / nArc;
        const p = [c.C[0] + a0[0] * Math.cos(psi) - a0[1] * Math.sin(psi), c.C[1] + a0[0] * Math.sin(psi) + a0[1] * Math.cos(psi)];
        const d = Math.hypot(p[0] - cur[0], p[1] - cur[1]);
        if (d < bestD) { bestD = d; bestI = pts.length; }
        pts.push(p);
      }
      baseAt[k] = bestI;
      const nOut = Math.max(6, Math.ceil(LtOut / STEP));
      const Bb = [c.B[0] - c.r2[0] * c.delta, c.B[1] - c.r2[1] * c.delta]; // the spot on the baseline right across from where the arc ends
      for (let q = 1; q <= nOut; q++) {
        const u = q / nOut, o = c.delta * (1 - smooth01(u));
        pts.push([Bb[0] + c.d2[0] * LtOut * u + c.r2[0] * o, Bb[1] + c.d2[1] * LtOut * u + c.r2[1] * o]);
      }
    } else {
      const d1 = norm(cur[0] - prev[0], cur[1] - prev[1]);
      lineTo(cur);
      baseAt[k] = pts.length - 1;
      if (through) lineTo([cur[0] + d1[0] * R.overrun, cur[1] + d1[1] * R.overrun]);
    }
    prev = cur;
  }
  const n = pts.length;
  const x = new Float64Array(n), z = new Float64Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = pts[i][0]; z[i] = pts[i][1];
    if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  }
  const heading = new Float64Array(n), kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    heading[i] = Math.atan2(x[b] - x[a], z[b] - z[a]);
  }
  const W = 3; // smooth the curvature over a few samples
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n - 1, i + W);
    let dh = heading[b] - heading[a];
    while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    kappa[i] = dh / Math.max(1e-6, s[b] - s[a]); // + = turning toward his right (heading is atan2(x, z))
  }
  const sBase = {};
  for (const k in baseAt) {
    let idx = baseAt[k];
    if (idx === 'nearest') {
      let best = Infinity; idx = 0;
      for (let i = 0; i < n; i++) { const d = Math.hypot(x[i] - BASE_XZ[k][0], z[i] - BASE_XZ[k][1]); if (d < best) { best = d; idx = i; } }
    }
    sBase[k] = s[idx];
  }
  return { x, z, s, heading, kappa, sBase, sEnd: s[n - 1], n, to };
}

/**
 * The speed along a route: get up to speed from rest, never faster than the curve allows, brake to a stop at the end.
 * Returns { duration, tBase{ k: time he touches base k }, at(t, out) }.
 */
export function buildProfile(route, { vmax, accelTime, brake, turnBrake = brake, latAccel, v0 = 0 }) {
  const n = route.n;
  // speed limit from the curve: he eases into a corner gently (`turnBrake`)...
  const vcap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(route.kappa[i]);
    vcap[i] = Math.min(vmax, k > 1e-4 ? Math.sqrt(latAccel / k) : vmax);
  }
  for (let i = n - 2; i >= 0; i--) vcap[i] = Math.min(vcap[i], Math.sqrt(vcap[i + 1] * vcap[i + 1] + 2 * turnBrake * (route.s[i + 1] - route.s[i])));
  const T = [0], S = [0], V = [v0];
  let t = 0, s = 0, v = v0, idx = 0;
  const sEnd = route.sEnd;
  for (let guard = 0; guard < 240 * 40; guard++) {
    while (idx < n - 2 && route.s[idx + 1] <= s) idx++;
    const u = (s - route.s[idx]) / Math.max(1e-9, route.s[idx + 1] - route.s[idx]);
    // ... and from the end of the route: he must be able to stop on the bag with `brake` (exact, not interpolated)
    // (the speed from which braking at `brake` stops him on the bag, taken over one step so the last instant is not harsher)
    const bd = brake * DT;
    const lim = Math.min(vcap[idx] + (vcap[idx + 1] - vcap[idx]) * Math.min(1, Math.max(0, u)), Math.sqrt(bd * bd + 2 * brake * Math.max(0, sEnd - s)) - bd);
    v = Math.min(v + ((vmax - v) / accelTime) * DT, lim);
    s += v * DT; t += DT;
    if (sEnd - s < 0.0015 || (v < 0.02 && s > sEnd - 0.3)) {
      // the last few hundredths of a second: let the speed run down to nothing instead of snapping to zero
      const vl = v;
      for (let q = 1; q <= 6; q++) { t += DT; v = vl * (1 - q / 6); s = Math.min(sEnd, s + v * DT); T.push(t); S.push(s); V.push(v); }
      S[S.length - 1] = sEnd; V[V.length - 1] = 0;
      break;
    }
    T.push(t); S.push(s); V.push(v);
  }
  const duration = T[T.length - 1];
  const tAtS = (target) => {
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid] < target) lo = mid + 1; else hi = mid; }
    return T[lo];
  };
  const tBase = {};
  for (const k in route.sBase) tBase[k] = tAtS(route.sBase[k] - 1e-6);
  const lookup = (sv, i0) => {
    let i = Math.max(0, Math.min(route.n - 2, i0));
    while (i < route.n - 2 && route.s[i + 1] < sv) i++;
    while (i > 0 && route.s[i] > sv) i--;
    return i;
  };
  const prof = {
    duration, tBase, route, sEnd, brake, tAtS,
    /** State at time t (seconds after the run began). `out` is reused if given. */
    at(tt, out = {}) {
      const c = Math.max(0, tt);
      let i = Math.min(T.length - 2, Math.floor(c / DT));
      if (i < 0) i = 0;
      const f = T.length < 2 ? 0 : Math.min(1, Math.max(0, (c - T[i]) / DT));
      const done = c >= duration;
      const sv = done ? sEnd : S[i] + (S[Math.min(i + 1, S.length - 1)] - S[i]) * f;
      const vv = done ? 0 : V[i] + (V[Math.min(i + 1, V.length - 1)] - V[i]) * f;
      const j = lookup(sv, out._j ?? Math.floor(sv / STEP));
      out._j = j;
      const uu = Math.min(1, Math.max(0, (sv - route.s[j]) / Math.max(1e-9, route.s[j + 1] - route.s[j])));
      out.x = route.x[j] + (route.x[j + 1] - route.x[j]) * uu;
      out.z = route.z[j] + (route.z[j + 1] - route.z[j]) * uu;
      let dh = route.heading[j + 1] - route.heading[j];
      while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      out.heading = route.heading[j] + dh * uu;
      out.kappa = route.kappa[j] + (route.kappa[j + 1] - route.kappa[j]) * uu;
      out.speed = vv;
      // acceleration (ft/s^2): how the speed changes right now
      const i2 = Math.min(T.length - 1, i + 6);
      out.accel = i2 > i ? (V[i2] - V[i]) / (T[i2] - T[i]) : 0;
      out.s = sv;
      out.sLeft = sEnd - sv;
      out.turn = out.kappa * vv; // yaw rate (rad/s, + = toward his right)
      out.side = vv * vv * out.kappa; // sideways acceleration (ft/s^2, + = pulling toward his right)
      out.done = done;
      return out;
    },
  };
  return prof;
}

// A runner who does not go anywhere: he waits at his lead-off spot (or in the box).
function stationary(from, cfg) {
  const [x, z] = from === 0 ? [0, 0] : leadSpot(from, cfg);
  return {
    duration: 0, tBase: { [from]: 0 }, sEnd: 0, brake: cfg.runner.brake, route: null,
    at(tt, out = {}) {
      Object.assign(out, { x, z, heading: 0, kappa: 0, speed: 0, accel: 0, s: 0, sLeft: 0, turn: 0, side: 0, done: true });
      return out;
    },
  };
}

const cache = new Map();
/**
 * The (cached) profile for a runner going from base `from` to base `to`.
 * kind: 'run' (top speed, stops on the last base) | 'through' (batter running through first) | 'trot' (home-run trot) | 'jog' (walk to first).
 */
export function runnerProfile(from, to, kind = 'run', cfg = CONFIG, spd = 1, fromBag = false, v0 = 0) {
  const R = cfg.runner;
  if (to <= from) return stationary(from, cfg); // a runner who stays where he is
  const key = `${from}>${to}|${kind}|${spd}|${fromBag ? 'bag' : ''}|${v0}|${R.speed}|${R.accelTime}|${R.brake}|${R.latAccel}|${R.turnBrake}|${R.turnLen}|${R.turnRadius}|${R.lead}|${R.leadSecond}|${R.overrun}|${R.trotSpeed}`;
  let p = cache.get(key);
  if (!p) {
    const route = buildRoute(from, to, { through: kind === 'through', fromBag }, cfg);
    const vmax = kind === 'trot' ? R.trotSpeed : kind === 'jog' ? R.jogSpeed : R.speed * spd; // (spd: a fast or slow runner, Season ratings)
    p = buildProfile(route, { vmax, v0, accelTime: kind === 'trot' ? R.accelTime * 1.4 : R.accelTime, brake: kind === 'trot' ? R.brake * 0.6 : R.brake, turnBrake: R.turnBrake, latAccel: R.latAccel });
    cache.set(key, p);
  }
  return p;
}

/** When (seconds after the play's contact) does he touch base `to`? tStart = when he leaves (default: reaction delay, or the batter's). spd = his speed (x). */
export function runnerArrival(cfg, from, to, tStart, kind = 'run', spd = 1) {
  const R = cfg.runner;
  const t0 = tStart ?? (from === 0 ? R.batterStart : R.startDelay);
  return t0 + (runnerProfile(from, to, kind, cfg, spd).tBase[to] ?? 0);
}

/** When has he finished (stopped)? */
export function runnerFinish(cfg, from, to, tStart, kind = 'run', spd = 1) {
  const R = cfg.runner;
  const t0 = tStart ?? (from === 0 ? R.batterStart : R.startDelay);
  return t0 + runnerProfile(from, to, kind, cfg, spd).duration;
}

/** Which profile does a move use? (`move` is a plan.moves entry: { from, to, out, outBase, tStart, trot }.) */
export function moveKind(move) {
  if (move.trot) return 'trot';
  const toBase = move.out && move.to === 0 ? move.outBase : move.to;
  return move.from === 0 && move.out && toBase === 1 ? 'through' : 'run';
}

// A runner ROUNDING a base on a ball to the outfield: he takes the turn exactly as if he were going on (the route toward the next
// base), pulls up `roundPast` ft beyond the bag and waits there, ready to be sent on (see fielding.js, runner orders).
export function roundProfile(from, to, cfg = CONFIG, spd = 1, fromBag = false) {
  const R = cfg.runner;
  const key = `round|${from}>${to}|${spd}|${fromBag}|${R.speed}|${R.accelTime}|${R.brake}|${R.latAccel}|${R.turnBrake}|${R.turnLen}|${R.turnRadius}|${R.lead}|${R.leadSecond}|${R.roundPast}`;
  let p = cache.get(key);
  if (!p) {
    const full = buildRoute(from, to + 1, { fromBag }, cfg);
    const route = sliceRoute(full, 0, full.sBase[to] + R.roundPast);
    p = buildProfile(route, { vmax: R.speed * spd, accelTime: R.accelTime, brake: R.roundBrake, turnBrake: R.turnBrake, latAccel: R.latAccel });
    cache.set(key, p);
  }
  return p;
}

// The rest of the way after he pulled up past a bag he rounded: from where he stands (`s0` ft along the route he was on) on to
// base `to`, from a standstill.
export function resumeProfile(from, to, s0, cfg = CONFIG, spd = 1, fromBag = false, v0 = 0) {
  const R = cfg.runner;
  const key = `resume|${from}>${to}|${s0.toFixed(3)}|${v0.toFixed(3)}|${spd}|${fromBag}|${R.speed}|${R.accelTime}|${R.brake}|${R.latAccel}|${R.turnBrake}|${R.turnLen}|${R.turnRadius}|${R.lead}|${R.leadSecond}`;
  let p = cache.get(key);
  if (!p) {
    const full = buildRoute(from, to, { fromBag }, cfg);
    p = buildProfile(sliceRoute(full, s0, full.sEnd), { vmax: R.speed * spd, v0, accelTime: R.accelTime, brake: R.brake, turnBrake: R.turnBrake, latAccel: R.latAccel });
    cache.set(key, p);
  }
  return p;
}

// A runner going part of the way on a ball in the air (it may be caught): from his lead toward the next base, he pulls up `frac` of
// the way there and waits to see what happens - the same on a ball that drops and on one that is caught, so nothing gives it away.
export function halfProfile(from, frac, cfg = CONFIG, spd = 1) {
  const R = cfg.runner;
  const key = `half|${from}|${frac}|${spd}|${R.speed}|${R.accelTime}|${R.roundBrake}|${R.latAccel}|${R.turnBrake}|${R.turnLen}|${R.turnRadius}|${R.lead}|${R.leadSecond}`;
  let p = cache.get(key);
  if (!p) {
    const full = buildRoute(from, from + 1, {}, cfg);
    const route = sliceRoute(full, 0, Math.max(1, full.sBase[from + 1] * frac));
    p = buildProfile(route, { vmax: R.speed * spd, accelTime: R.accelTime, brake: R.roundBrake, turnBrake: R.turnBrake, latAccel: R.latAccel });
    cache.set(key, p);
  }
  return p;
}

// Part of a route, from arc length s0 to s1 (arc lengths re-measured from the new start; bases outside it are dropped).
function sliceRoute(r, s0, s1) {
  let i0 = 0; while (i0 < r.n - 2 && r.s[i0 + 1] <= s0) i0++;
  let i1 = r.n - 1; while (i1 > i0 + 1 && r.s[i1 - 1] >= s1) i1--;
  const n = i1 - i0 + 1;
  const x = new Float64Array(n), z = new Float64Array(n), s = new Float64Array(n), heading = new Float64Array(n), kappa = new Float64Array(n);
  for (let k = 0; k < n; k++) { x[k] = r.x[i0 + k]; z[k] = r.z[i0 + k]; heading[k] = r.heading[i0 + k]; kappa[k] = r.kappa[i0 + k]; s[k] = r.s[i0 + k] - r.s[i0]; }
  const sBase = {};
  for (const k in r.sBase) { const v = r.sBase[k] - r.s[i0]; if (v >= 0 && v <= s[n - 1] + 1e-6) sBase[k] = v; }
  return { x, z, s, heading, kappa, sBase, sEnd: s[n - 1], n, to: r.to };
}

/**
 * The legs of a move. Most moves are one run (from -> to), or one rounding of a base (`move.round`). A runner who is SENT on
 * (fielding.js, runner orders) after he had started to pull up gets explicit `legs`:
 *   { kind: 'run', from, to, t0, fromBag }   a run (fromBag: from the bag itself, after he had stopped on it)
 *   { kind: 'round', from, to, t0, fromBag }  he rounds base `to` and pulls up just past it
 *   { kind: 'resume', from, to, s0, t0, fromBag }  on from where he pulled up (s0 ft along the route from `from`) to base `to`
 *   { kind: 'half', from, to: from, frac, t0 }  part of the way toward the next base on a ball in the air, and wait there
 *   { kind: 'reverse', tb, toBase, t0 }  he turns back at `tb` on the leg before and runs back to the bag of base `toBase`
 * Returns them with `last` set on the final one (t0 = seconds after contact when that leg starts).
 */
export function moveLegs(move, cfg = CONFIG) {
  const R = cfg.runner;
  const toBase = move.out && move.to === 0 ? move.outBase : move.to;
  const t0 = move.tStart ?? (move.from === 0 ? R.batterStart : R.startDelay);
  if (move.legs && move.legs.length) {
    const legs = move.legs.map((L) => ({ ...L, last: false }));
    legs[0].t0 = t0; // (the renderer may re-time the batter's start: the first leg follows the move)
    for (let i = 1; i < legs.length; i++) if (legs[i].kind === 'reverse') { legs[i - 1].cut = legs[i].tb; legs[i].of = { ...legs[i - 1], last: false }; } // (he turns back on the leg before)
    const L = legs[legs.length - 1];
    L.last = true;
    if (move.out && move.to === 0 && L.kind !== 'reverse') L.to = move.outBase;
    return legs;
  }
  const to = Math.max(toBase, move.from);
  if (move.round && !move.out && to < 4) return [{ kind: 'round', from: move.from, to, t0, fromBag: false, last: true }];
  return [{ kind: 'run', from: move.from, to, t0, fromBag: false, last: true }];
}

/** The speed profile of one leg (see moveLegs). (A 'reverse' leg has none of its own: this is the leg he turned back on.) */
export function legProfile(L, move, cfg = CONFIG) {
  const spd = move.spd || 1;
  if (L.kind === 'reverse') return legProfile({ ...L.of, last: false }, move, cfg);
  if (L.kind === 'round') return roundProfile(L.from, L.to, cfg, spd, L.fromBag);
  if (L.kind === 'half') return halfProfile(L.from, L.frac, cfg, spd);
  if (L.kind === 'resume') return resumeProfile(L.from, L.to, L.s0, cfg, spd, L.fromBag, L.v0 || 0);
  return runnerProfile(L.from, L.to, L.last ? moveKind(move) : 'run', cfg, spd, L.fromBag, L.v0 || 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Turning back: a runner on his way (leg `of`) is told at `tb` (seconds after contact) to get back to base `toBase` behind him - you
// called him back, or the ball was caught. He brakes, turns and runs back along the way he came to the bag (the bag itself, even when
// he started from his lead-off spot), and reaches it at full tilt (he dives back in). L = { kind: 'reverse', of, tb, toBase }.
// ---------------------------------------------------------------------------------------------------------------
// Where along a route is a base's bag? (negative: behind where the route starts - a lead-off spot is in front of its bag)
function bagS(route, base) {
  if (route.sBase[base] !== undefined) return route.sBase[base];
  const [bx, bz] = BASE_XZ[base];
  let best = Infinity, bi = 0;
  for (let i = 0; i < route.n; i++) { const d = Math.hypot(route.x[i] - bx, route.z[i] - bz); if (d < best) { best = d; bi = i; } }
  return bi === 0 && best > 0.3 ? -best : route.s[bi];
}
const revCache = new Map();
function reversePlan(L, move, cfg) {
  const key = `${L.tb}|${L.toBase}|${move.spd || 1}|${L.of.kind}|${L.of.from}|${L.of.to}|${L.of.t0}|${L.of.s0 || 0}|${L.of.fromBag}|${L.of.of ? 'r' : ''}`;
  const hit = revCache.get(key);
  if (hit && hit.cfg === cfg) return hit;
  if (revCache.size > 400) revCache.clear();
  const R = cfg.runner;
  const p = legProfile({ ...L.of, last: false }, move, cfg);
  const q = p.at(Math.max(0, L.tb - L.of.t0), {});
  const V = R.speed * (move.spd || 1);
  const B = R.brake * 0.8;
  const v1 = q.speed, s1 = q.s;
  const tb = v1 / B, s2 = s1 + (v1 * v1) / (2 * B);
  const route = p.route;
  const sT = route ? bagS(route, L.toBase) : -Math.hypot(q.x - BASE_XZ[L.toBase][0], q.z - BASE_XZ[L.toBase][1]);
  const dir = s2 >= sT ? -1 : 1; // (back the way he came - or, if he can pull up short of the bag, on to it)
  const dist = Math.abs(s2 - sT);
  let lo = 0, hi = dist / V + 4 * R.accelTime + 1;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (covered(V, mid, R.accelTime) < dist) lo = mid; else hi = mid; }
  // a point `s` ft along the route (behind its start: on the straight line back to the bag)
  const start = route ? [route.x[0], route.z[0]] : [q.x, q.z];
  const bag = BASE_XZ[L.toBase];
  const along = (s, out) => {
    if (route && s >= 0) return p.at(p.tAtS(Math.min(s, p.sEnd)), out);
    const k = Math.min(1, -s / Math.max(1e-6, Math.hypot(bag[0] - start[0], bag[1] - start[1])));
    out.x = start[0] + (bag[0] - start[0]) * k; out.z = start[1] + (bag[1] - start[1]) * k;
    return out;
  };
  // (from a standstill at his lead-off spot there is no route: he simply faces the bag)
  const heading0 = route ? q.heading : Math.atan2(start[0] - bag[0], start[1] - bag[1]);
  const rp = { cfg, dir, p, s1, v1, B, tTurn: L.tb + tb, s2, sT, dist, tRun: hi, tHome: L.tb + tb + hi, V, heading0, along };
  revCache.set(key, rp);
  return rp;
}
function reverseState(L, move, t, cfg, out) {
  const rp = reversePlan(L, move, cfg);
  const R = cfg.runner;
  out.kind = 'back'; out.profile = rp.p; out.total = rp.dist; out.tStart = L.of.t0;
  if (t <= L.tb) { rp.p.at(t - L.of.t0, out); out.running = out.speed > 0.05; out.waiting = false; out.done = false; return out; }
  if (t < rp.tTurn) {
    const u = t - L.tb;
    rp.along(rp.s1 + rp.v1 * u - 0.5 * rp.B * u * u, out);
    out.heading = rp.heading0; out.speed = Math.max(0, rp.v1 - rp.B * u); out.accel = -rp.B;
    out.sLeft = rp.dist; out.side = 0; out.turn = 0; out.waiting = false; out.running = true; out.done = false;
    return out;
  }
  const tau = t - rp.tTurn;
  const d = Math.min(rp.dist, covered(rp.V, tau, R.accelTime));
  rp.along(rp.s2 + rp.dir * d, out);
  const done = tau >= rp.tRun;
  out.heading = rp.heading0 + (rp.dir < 0 ? Math.PI : 0);
  out.speed = done ? 0 : rp.V * (1 - Math.exp(-tau / R.accelTime));
  out.accel = done ? 0 : (rp.V - out.speed) / R.accelTime;
  out.sLeft = rp.dist - d; out.side = 0; out.turn = 0; out.waiting = false; out.running = !done; out.done = done;
  return out;
}

/** When (seconds after contact) does the runner of this move touch `base`? (undefined if his run does not reach it) */
export function moveArrival(cfg, move, base) {
  // (the LAST time he touches it: a runner who turned back touched second on the way out and touches first again on the way back)
  let res;
  for (const L of moveLegs(move, cfg)) {
    if (L.kind === 'reverse') { if (base === L.toBase) res = reversePlan(L, move, cfg).tHome; continue; }
    const kind = L.kind === 'run' && L.last ? moveKind(move) : L.kind;
    if (kind === 'through' && base === 1) { res = L.t0 + runnerProfile(0, 1, 'run', cfg, move.spd || 1).tBase[1]; continue; } // (timed as if he stopped on it: see runnerState)
    if (base > L.to || (L.kind !== 'resume' && base <= L.from)) continue;
    const tb = legProfile(L, move, cfg).tBase[base];
    if (tb !== undefined && L.t0 + tb <= (L.cut ?? Infinity)) res = L.t0 + tb;
  }
  return res;
}

/** When has the runner of this move stopped for good? */
export function moveFinish(cfg, move) {
  const legs = moveLegs(move, cfg);
  const L = legs[legs.length - 1];
  if (L.kind === 'reverse') return reversePlan(L, move, cfg).tHome;
  return L.t0 + legProfile(L, move, cfg).duration;
}

/**
 * Where is the runner of this move `t` seconds after contact, how fast, how hard is he accelerating or turning?
 * A batter who is out at first runs THROUGH the bag; his start is delayed a touch so that he touches it at exactly the time
 * the planner used (the planner times every runner as if he stops on the bag), so the picture agrees with the safe/out call.
 */
export function runnerState(move, t, cfg = CONFIG, out = {}) {
  if (move.walkOff && move.out && move.outAt !== undefined && t > move.outAt + cfg.runner.walkOffDelay) return walkOffState(move, t, cfg, out);
  if (move.back) return retreatState(move, t, cfg, out);
  const R = cfg.runner;
  const spd = move.spd || 1;
  const legs = moveLegs(move, cfg);
  let L = legs[0];
  for (const q of legs) if (t >= q.t0 && !(move.stopAt !== undefined && q.t0 > move.stopAt)) L = q; // (the inning ended before he set off again: he stays)
  if (L.kind === 'reverse') { reverseState(L, move, t, cfg, out); out.waiting = t <= legs[0].t0; out.leg = legs.indexOf(L); return out; }
  const kind = L.kind === 'run' ? (L.last ? moveKind(move) : 'run') : L.kind;
  let t0 = L.t0;
  if (kind === 'through') t0 += runnerProfile(0, 1, 'run', cfg, spd).tBase[1] - runnerProfile(0, 1, 'through', cfg, spd).tBase[1];
  const p = legProfile(L, move, cfg);
  const tt = t - t0;
  p.at(tt, out);
  // The inning ended while he was still running (move.stopAt, seconds after contact): he eases up and coasts to a stop
  // along his route instead of running on to the next bag.
  if (move.stopAt !== undefined && t > move.stopAt && p.route && move.stopAt - t0 < p.duration && move.stopAt >= t0) {
    const s0 = p.at(Math.max(0, move.stopAt - t0), out);
    const v0 = s0.speed, sStop = s0.s, after = t - move.stopAt, tau = R.easeUp;
    const extra = v0 * tau * (1 - Math.exp(-after / tau));
    p.at(p.tAtS(Math.min(p.sEnd, sStop + extra)), out);
    out.speed = v0 * Math.exp(-after / tau);
    out.accel = -out.speed / tau;
    out.side = 0; out.turn = 0;
    if (out.speed < 0.3) { out.speed = 0; out.done = true; }
  }
  out.kind = kind;
  out.waiting = t <= legs[0].t0;
  out.running = tt > 0 && !out.done && out.speed > 0.05;
  out.tStart = legs[0].t0;
  out.total = p.sEnd;
  out.profile = p;
  out.leg = legs.indexOf(L);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Changing a runner's mind (your orders, or the ball being caught). `legs` are a move's explicit legs (see moveLegs), changed in place.
// ---------------------------------------------------------------------------------------------------------------
const stillLeg = (L) => L.kind === 'run' && L.to <= L.from; // (waiting at his lead-off spot)
/** Where does the leg in progress end, as a runner who keeps on going? (the base he is on, or will stop at) */
export function legsGoal(legs) {
  const L = legs[legs.length - 1];
  if (!L) return 0;
  if (L.kind === 'reverse') return L.toBase;
  if (L.kind === 'half') return L.from;
  return L.to;
}
/**
 * He goes on to base `base`, reacting at `tAct`. A runner who has not yet started to pull up simply keeps going on the longer route;
 * one who has (or who has stopped) finishes pulling up and sets off again from there; one going back finishes getting back to the bag.
 */
export function extendLegs(legs, from, base, tAct, cfg = CONFIG, spd = 1) {
  const mv = { spd };
  if (!legs.length) { legs.push({ kind: 'run', from, to: base, t0: tAct, fromBag: false }); return legs; }
  const L = legs[legs.length - 1];
  if (stillLeg(L)) { legs[legs.length - 1] = { kind: 'run', from: L.from, to: base, t0: Math.max(tAct, L.t0), fromBag: L.fromBag }; return legs; }
  if (L.kind !== 'reverse' && L.kind !== 'half' && L.to >= base) return legs; // (he is on his way there already)
  if (L.kind === 'reverse') {
    const tHome = moveFinish(cfg, { from, legs: legs.map((q) => ({ ...q })), spd, tStart: legs[0].t0 });
    // (one who has been standing on the bag waiting - a tag-up - leaves with a rocking start)
    const leg = { kind: 'run', from: L.toBase, to: base, t0: Math.max(tAct, tHome), fromBag: true };
    if (tAct > tHome + 0.3) leg.v0 = cfg.runner.tagRoll;
    legs.push(leg);
    return legs;
  }
  const cand = L.kind === 'resume' ? { ...L, to: base } : { kind: 'run', from: L.from, to: base, t0: L.t0, fromBag: L.fromBag };
  const pL = legProfile({ ...L, last: false }, mv, cfg);
  const pC = legProfile({ ...cand, last: false }, mv, cfg);
  if (tAct - L.t0 <= sameUntil(pL, pC)) { legs[legs.length - 1] = cand; return legs; }
  const tGo = Math.max(tAct, L.t0 + pL.duration);
  if ((L.kind === 'round' || L.kind === 'half') && tAct < L.t0 + pL.duration) {
    // still pulling up: he goes on from where he is, at the speed he still has
    const q = pL.at(tAct - L.t0, {});
    legs.push({ kind: 'resume', from: L.from, to: base, s0: q.s, v0: q.speed, t0: tAct, fromBag: L.fromBag });
  } else if (L.kind === 'round' || L.kind === 'half') legs.push({ kind: 'resume', from: L.from, to: base, s0: pL.sEnd, t0: tGo, fromBag: L.fromBag });
  else legs.push({ kind: 'run', from: L.to, to: base, t0: tGo, fromBag: true });
  return legs;
}
/**
 * He gets back to base `base` (behind him, or the one he is heading for if he can still pull up on it), reacting at `tAct`: if he can
 * simply stop there he does; otherwise he brakes, turns and runs back to the bag.
 */
export function backLegs(legs, from, base, tAct, cfg = CONFIG, spd = 1) {
  const mv = { spd };
  const L = legs[legs.length - 1];
  if (!L || L.kind === 'reverse') return legs;
  if (stillLeg(L) || L.kind === 'half') {
    if (base > L.from) return extendLegs(legs, from, base, tAct, cfg, spd); // (the bag "back" is the one ahead of him: he goes on to it)
    legs.push({ kind: 'reverse', tb: Math.max(tAct, L.t0), toBase: base, t0: Math.max(tAct, L.t0) });
    return legs;
  }
  const p = legProfile({ ...L, last: false }, mv, cfg);
  const tb = p.tBase[base];
  if (base > L.from && tb !== undefined && L.t0 + tb > tAct) {
    // a bag he has not reached yet: he stops on it, if he can still do so without stopping short of where he already is
    const cand = L.kind === 'resume' ? { ...L, to: base } : { kind: 'run', from: L.from, to: base, t0: L.t0, fromBag: L.fromBag };
    if (tAct - L.t0 <= sameUntil(p, legProfile({ ...cand, last: false }, mv, cfg))) { legs[legs.length - 1] = cand; return legs; }
  }
  legs.push({ kind: 'reverse', tb: tAct, toBase: base, t0: tAct });
  return legs;
}

// A runner who was tagged out gets up and walks off toward the dugout (the third-base side, where the home team sits).
let DUGOUT_DOOR = null;
function walkOffState(move, t, cfg, out) {
  const R = cfg.runner;
  const tOff = move.outAt + R.walkOffDelay;
  runnerState({ ...move, walkOff: false }, tOff, cfg, out);
  if (!DUGOUT_DOOR) { const g = dugoutSpot(-1); DUGOUT_DOOR = [(g.front0[0] + g.front1[0]) / 2, (g.front0[1] + g.front1[1]) / 2]; }
  const [dx, dz] = [DUGOUT_DOOR[0] - out.x, DUGOUT_DOOR[1] - out.z];
  const D = Math.hypot(dx, dz) || 1;
  const tau = t - tOff;
  const d = Math.min(D, R.walkOffSpeed * Math.max(0, tau - 0.25 * (1 - Math.exp(-tau / 0.25))));
  out.x += (dx / D) * d; out.z += (dz / D) * d;
  out.heading = Math.atan2(dx, dz);
  out.speed = d >= D ? 0 : R.walkOffSpeed * (1 - Math.exp(-tau / 0.25));
  out.accel = 0; out.side = 0; out.turn = 0;
  out.s = (out.s || 0) + d;
  out.walk = true; out.running = out.speed > 0.05; out.done = d >= D; out.waiting = false;
  return out;
}

/**
 * Until when (seconds after the leg's start) do two speed profiles put the runner on the same spot at the same speed? Up to then a
 * runner who is sent on simply keeps going on the new route - after it he has already started to pull up, and he finishes doing
 * so before he goes again.
 */
const sameCache = new WeakMap();
export function sameUntil(a, b) {
  let m = sameCache.get(a);
  if (!m) sameCache.set(a, (m = new Map()));
  if (m.has(b)) return m.get(b);
  const qa = {}, qb = {};
  let t = 0;
  for (; t < a.duration; t += 1 / 120) {
    a.at(t, qa); b.at(t, qb);
    if (Math.hypot(qa.x - qb.x, qa.z - qb.z) > 0.08 || Math.abs(qa.speed - qb.speed) > 0.25) break;
  }
  const res = Math.max(0, t - 1 / 120);
  m.set(b, res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// Going back: a runner who took off with the pitch (a steal, a hit-and-run) and has to return to his base - the ball was
// fouled off or caught. He runs toward the next base until `backAt`, brakes, turns and runs back to the bag he left
// (the bag itself, not his lead-off spot). move = { from, back: true, tStart, backAt } (times in the play's clock).
// ---------------------------------------------------------------------------------------------------------------
const covered = (v, tau, A) => v * (tau - A * (1 - Math.exp(-tau / A)));
function retreatPlan(from, tStart, backAt, cfg, spd = 1) {
  const R = cfg.runner;
  const V = R.speed * spd;
  const p = runnerProfile(from, from + 1, 'run', cfg, spd);
  const q = p.at(Math.max(0, backAt - tStart), {});
  const B = R.brake * 0.8; // (he pulls up hard, but not as hard as a slide into a bag)
  const tb = q.speed / B;
  const s2 = q.s + (q.speed * q.speed) / (2 * B);
  const [lx, lz] = leadSpot(from, cfg);
  const [bx, bz] = BASE_XZ[from];
  const lead = Math.hypot(lx - bx, lz - bz);
  const dist = s2 + lead; // back to the bag
  // time to run `dist` from a standstill (same get-up-to-speed curve as every run)
  let lo = 0, hi = dist / V + 4 * R.accelTime + 1;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (covered(V, mid, R.accelTime) < dist) lo = mid; else hi = mid; }
  return { p, s1: q.s, v1: q.speed, B, tb, s2, lead, dist, tRun: hi, tTurn: backAt + tb, tHome: backAt + tb + hi, bx, bz, V };
}
/** When is a runner who is going back on the bag again? */
export function retreatArrival(cfg, from, tStart, backAt, spd = 1) {
  return retreatPlan(from, tStart, backAt, cfg, spd).tHome;
}
// a point `s` ft along his way to the next base (negative = between his lead-off spot and the bag)
function alongRoute(rp, s, out) {
  if (s >= 0) return rp.p.at(rp.p.tAtS(Math.min(s, rp.p.sEnd)), out);
  const q = rp.p.at(0, out);
  const k = Math.min(1, -s / Math.max(1e-6, rp.lead));
  out.x = q.x + (rp.bx - q.x) * k; out.z = q.z + (rp.bz - q.z) * k;
  return out;
}
export function retreatState(move, t, cfg = CONFIG, out = {}) {
  const t0 = move.tStart ?? cfg.runner.startDelay;
  const key = `${move.from}|${t0}|${move.backAt}|${move.spd || 1}`;
  const rp = move._rp && move._rp.key === key ? move._rp : (move._rp = Object.assign(retreatPlan(move.from, t0, move.backAt, cfg, move.spd || 1), { key }));
  out.kind = 'back'; out.tStart = t0; out.profile = rp.p; out.total = rp.dist;
  if (t <= move.backAt) {
    rp.p.at(t - t0, out);
    out.waiting = t <= t0; out.running = !out.waiting && out.speed > 0.05; out.done = false;
    return out;
  }
  const heading0 = rp.p.at(Math.max(0, move.backAt - t0), {}).heading;
  if (t < rp.tTurn) {
    // pulling up
    const u = t - move.backAt;
    const s = rp.s1 + rp.v1 * u - 0.5 * rp.B * u * u;
    alongRoute(rp, s, out);
    out.heading = heading0; out.speed = Math.max(0, rp.v1 - rp.B * u); out.accel = -rp.B;
    out.sLeft = 0; out.side = 0; out.turn = 0;
    out.waiting = false; out.running = true; out.done = false;
    return out;
  }
  const tau = t - rp.tTurn;
  const d = Math.min(rp.dist, covered(rp.V, tau, cfg.runner.accelTime));
  alongRoute(rp, rp.s2 - d, out);
  const done = tau >= rp.tRun;
  out.heading = heading0 + Math.PI;
  out.speed = done ? 0 : rp.V * (1 - Math.exp(-tau / cfg.runner.accelTime));
  out.accel = done ? 0 : (rp.V - out.speed) / cfg.runner.accelTime;
  out.sLeft = rp.dist - d; out.side = 0; out.turn = 0;
  out.waiting = false; out.running = !done; out.done = done;
  return out;
}
