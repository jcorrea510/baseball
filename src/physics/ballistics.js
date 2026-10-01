// Batted-ball flight. Given exit speed, launch angle and spray angle we simulate the
// WHOLE flight up front (gravity, air drag, backspin lift, bounces, rolling, the wall
// and the grandstand). The result is a list of samples at a fixed time step, so the
// picture just replays it - it never depends on frame rate.
import { CONFIG, MPH } from '../config.js';
import { DEG } from '../util/math.js';
import { fenceDistance, sprayOf, standsHeight, isFairXZ, isInsideField, BASE_XZ, FENCE_HEIGHT } from './field.js';

const BASE_DEPTH = BASE_XZ[1][1] * -1; // how far from the plate the 1st/3rd base bags are (in -z)

/**
 * @param {object} p
 * @param {number} p.exitVelocity  mph
 * @param {number} p.launchAngle   degrees above horizontal
 * @param {number} p.sprayAngle    degrees (0 = center, negative = left field)
 * @param {number} [p.backspin]    rpm
 * @param {number} [p.hook]        rpm of sidespin; positive curves toward +x (right field)
 * @param {{x:number,y:number,z:number}} [p.start]
 * @param {object} [opts]  { ideal: true } = ignore wall/stands (used to project distance)
 */
export function simulateBattedBall(p, cfg = CONFIG, opts = {}) {
  const ph = cfg.physics;
  const r = ph.ballRadius;
  const dt = ph.dt;
  const start = p.start || { x: 0, y: 3, z: cfg.pitch.contactZ };
  const ev = p.exitVelocity * MPH;
  const la = p.launchAngle * DEG;
  const sp = p.sprayAngle * DEG;
  const dx = Math.sin(sp);
  const dz = -Math.cos(sp);

  let x = start.x, y = start.y, z = start.z;
  let vx = ev * Math.cos(la) * dx;
  let vy = ev * Math.sin(la);
  let vz = ev * Math.cos(la) * dz;

  // Spin vector (rpm) = backspin about (d x up) + sidespin about the vertical axis.
  const back = p.backspin ?? 0;
  const hook = p.hook ?? 0;
  const wx = back * -dz;
  const wy = -hook;
  const wz = back * dx;

  const ts = [0], xs = [x], ys = [y], zs = [z];
  let t = 0;
  let airborne = true; // spin only matters before the first bounce
  let firstBounce = null;
  let bounces = 0;
  let wallHit = null;
  let homerun = null;
  let standsLanding = null;
  let cleared = false;
  let apex = { t: 0, y };
  let stopped = false;
  let rolling = false;
  let contactTime = null; // first time the ball touches anything (ground / wall / stands)
  let netHit = null; // a foul ball back over the catcher that hits the backstop net (or flies over it into the crowd)

  const accel = (vxx, vyy, vzz, out) => {
    const spd = Math.sqrt(vxx * vxx + vyy * vyy + vzz * vzz);
    let ax = -ph.dragK * spd * vxx;
    let ay = -ph.gravity - ph.dragK * spd * vyy;
    let az = -ph.dragK * spd * vzz;
    if (airborne) {
      // Magnus: k * (w x v)
      ax += ph.magnusK * (wy * vzz - wz * vyy);
      ay += ph.magnusK * (wz * vxx - wx * vzz);
      az += ph.magnusK * (wx * vyy - wy * vxx);
    }
    out[0] = ax; out[1] = ay; out[2] = az;
  };
  const a = [0, 0, 0];
  const am = [0, 0, 0];

  const maxSteps = Math.ceil(ph.maxTime / dt);
  for (let i = 0; i < maxSteps && !stopped; i++) {
    if (rolling) {
      const spd = Math.hypot(vx, vz);
      const ns = spd - ph.rollDecel * dt;
      if (ns <= ph.stopSpeed) {
        vx = 0; vz = 0; stopped = true;
      } else {
        const k = ns / spd;
        vx *= k; vz *= k;
        x += vx * dt; z += vz * dt;
      }
      y = r;
    } else {
      // midpoint (RK2) step
      accel(vx, vy, vz, a);
      const mx = vx + 0.5 * a[0] * dt, my = vy + 0.5 * a[1] * dt, mz = vz + 0.5 * a[2] * dt;
      accel(mx, my, mz, am);
      x += mx * dt; y += my * dt; z += mz * dt;
      vx += am[0] * dt; vy += am[1] * dt; vz += am[2] * dt;
    }
    t += dt;
    if (y > apex.y) apex = { t, y };

    if (!opts.ideal && !stopped) {
      const rho = Math.hypot(x, z);
      const spray = sprayOf(x, z);
      const inFenceArc = Math.abs(spray) <= 45 && z < 0;
      if (inFenceArc) {
        const dW = fenceDistance(spray);
        if (!cleared && rho >= dW - r * 0.5) {
          if (y > FENCE_HEIGHT) {
            cleared = true;
            homerun = { t, x, y, z };
          } else {
            // Bounce off the padded wall.
            const nx = x / rho, nz = z / rho; // outward normal
            const vn = vx * nx + vz * nz;
            if (vn > 0) {
              const tx = vx - vn * nx, tz = vz - vn * nz;
              vx = -ph.wallRestitution * vn * nx + tx * ph.wallFriction;
              vz = -ph.wallRestitution * vn * nz + tz * ph.wallFriction;
              vy *= 0.85;
            }
            x = nx * (dW - r);
            z = nz * (dW - r);
            if (!wallHit) wallHit = { t, x, y, z };
            if (contactTime === null) contactTime = t;
            airborne = false;
            rolling = false;
          }
        }
        if (cleared) {
          const over = rho - dW;
          if (over > 0 && y <= standsHeight(over) + r) {
            standsLanding = { t, x, y, z };
            if (contactTime === null) contactTime = t;
            stopped = true;
          }
        }
      }
    }

    // A foul ball back behind the plate: the backstop net stops it (it drops straight down the net), or it sails over into the crowd.
    if (!opts.ideal && !stopped && !netHit && z > 30 && !isInsideField(x, z)) {
      netHit = { t, x, y, z, over: y > ph.netHeight };
      if (contactTime === null) contactTime = t;
      if (netHit.over) stopped = true;
      else { vx *= -0.12; vz *= -0.12; vy = Math.min(vy, 0) * 0.3; airborne = false; }
    }

    // Ground contact
    if (!stopped && y <= r && !cleared) {
      if (vy < 0) {
        if (!firstBounce) {
          firstBounce = { t, x, y: r, z, speedH: Math.hypot(vx, vz) };
          if (contactTime === null) contactTime = t;
          if (opts.ideal) {
            stopped = true;
          }
        }
        airborne = false;
        const vin = -vy;
        if (vin > 6) {
          vy = ph.groundRestitution * vin;
          vx *= ph.groundFriction;
          vz *= ph.groundFriction;
          bounces++;
        } else {
          vy = 0;
          rolling = true;
        }
      }
      y = r;
    }

    ts.push(t); xs.push(x); ys.push(y); zs.push(z);
    if (Math.hypot(x, z) > 900) stopped = true;
    if (opts.ideal && y < r - 1) stopped = true;
  }

  const n = ts.length;
  const sim = {
    dt,
    count: n,
    t: Float32Array.from(ts),
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    duration: t,
    firstBounce,
    bounces,
    wallHit,
    homerun,
    standsLanding,
    netHit,
    apex,
    contactTime: contactTime ?? t,
    params: { ...p },
    stopPos: { x, y, z },
  };
  return sim;
}

// Where the ball would have come down over flat, empty ground (used for the distance callout).
export function projectDistance(p, cfg = CONFIG) {
  const ideal = simulateBattedBall(p, cfg, { ideal: true });
  const fb = ideal.firstBounce || { x: ideal.stopPos.x, z: ideal.stopPos.z, t: ideal.duration };
  return { distance: Math.hypot(fb.x, fb.z), x: fb.x, z: fb.z, hangTime: fb.t, apex: ideal.apex.y };
}

// Position of the ball at time t (seconds since contact). Writes into `out`.
export function sampleBall(sim, t, out = { x: 0, y: 0, z: 0 }) {
  if (t <= 0) {
    out.x = sim.x[0]; out.y = sim.y[0]; out.z = sim.z[0];
    return out;
  }
  const f = t / sim.dt;
  const i = Math.floor(f);
  if (i >= sim.count - 1) {
    const k = sim.count - 1;
    out.x = sim.x[k]; out.y = sim.y[k]; out.z = sim.z[k];
    return out;
  }
  const u = f - i;
  out.x = sim.x[i] + (sim.x[i + 1] - sim.x[i]) * u;
  out.y = sim.y[i] + (sim.y[i + 1] - sim.y[i]) * u;
  out.z = sim.z[i] + (sim.z[i + 1] - sim.z[i]) * u;
  return out;
}

// Is the ball fair or foul? Rule of thumb used by real umpires: a ball that lands past
// first/third base is judged where it lands; one that stops short of the bases is
// judged where it crosses the base line (or where it stops).
export function judgeFairFoul(sim) {
  if (sim.homerun || sim.wallHit) return true;
  const fb = sim.firstBounce;
  if (fb && -fb.z >= BASE_DEPTH) return isFairXZ(fb.x, fb.z);
  const start = fb ? Math.max(0, Math.floor(fb.t / sim.dt)) : 0;
  for (let i = start; i < sim.count; i++) {
    if (-sim.z[i] >= BASE_DEPTH) return isFairXZ(sim.x[i], sim.z[i]);
  }
  const k = sim.count - 1;
  return isFairXZ(sim.x[k], sim.z[k]);
}

// Batted-ball type from launch angle.
export function battedBallType(launchAngle) {
  if (launchAngle < 10) return 'ground';
  if (launchAngle < 25) return 'line';
  if (launchAngle < 50) return 'fly';
  return 'pop';
}
