// Base runners: smooth curved routes through the bases, speed that builds from a standstill, slows for corners and brakes to a stop,
// and the same numbers used by the fielding planner (so the picture always agrees with the safe/out call).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { BASE_XZ } from '../src/physics/field.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { buildRoute, runnerProfile, runnerArrival, runnerFinish, runnerState, leadSpot, moveKind } from '../src/game/runnerMotion.js';

const R = CONFIG.runner;
const trace = (p, dt = 1 / 60) => { const out = []; const o = {}; for (let t = 0; t <= p.duration + 0.2; t += dt) out.push({ t, ...p.at(t, o) }); return out; };

describe('the route', () => {
  it('starts at the lead-off spot (or the plate) and touches every base on the way', () => {
    for (const [from, to] of [[0, 1], [0, 3], [0, 4], [1, 2], [1, 4], [2, 4], [3, 4]]) {
      const r = buildRoute(from, to);
      const start = from === 0 ? [0, 0] : leadSpot(from);
      expect(Math.hypot(r.x[0] - start[0], r.z[0] - start[1])).toBeLessThan(1e-6);
      for (let k = from + 1; k <= to; k++) {
        let best = Infinity;
        for (let i = 0; i < r.n; i++) best = Math.min(best, Math.hypot(r.x[i] - BASE_XZ[k][0], r.z[i] - BASE_XZ[k][1]));
        expect(best, `${from}>${to} base ${k}`).toBeLessThan(0.6);
      }
      expect(Math.hypot(r.x[r.n - 1] - BASE_XZ[to][0], r.z[r.n - 1] - BASE_XZ[to][1])).toBeLessThan(1e-6);
    }
  });

  it('goes round a corner in a smooth arc, not a sharp turn, and stays close to the baselines', () => {
    const r = buildRoute(1, 4);
    let minRadius = Infinity, maxTurn = 0;
    for (let i = 1; i < r.n; i++) {
      if (Math.abs(r.kappa[i]) > 1e-4) minRadius = Math.min(minRadius, 1 / Math.abs(r.kappa[i]));
      let dh = r.heading[i] - r.heading[i - 1]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      maxTurn = Math.max(maxTurn, Math.abs(dh));
    }
    expect(minRadius).toBeGreaterThan(R.turnRadius * 0.85);
    expect(maxTurn * (180 / Math.PI)).toBeLessThan(6); // a few degrees between neighbouring samples at most
    // never strays far outside the diamond: within a few feet of the line to the next base
    const legs = [[leadSpot(1), BASE_XZ[2]], [BASE_XZ[2], BASE_XZ[3]], [BASE_XZ[3], BASE_XZ[4]]];
    for (let i = 0; i < r.n; i++) {
      let best = Infinity;
      for (const [a, b] of legs) {
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((r.x[i] - a[0]) * ex + (r.z[i] - a[1]) * ez) / (ex * ex + ez * ez)));
        best = Math.min(best, Math.hypot(r.x[i] - (a[0] + ex * t), r.z[i] - (a[1] + ez * t)));
      }
      expect(best).toBeLessThan(6);
    }
  });
});

describe('the speed profile', () => {
  const p = runnerProfile(1, 4, 'run');
  const pts = trace(p);

  it('starts from a standstill and builds up speed', () => {
    expect(pts[0].speed).toBeLessThan(0.5);
    const at = (t) => p.at(t, {});
    expect(at(0.25).speed).toBeLessThan(R.speed * 0.6);
    expect(at(0.25).accel).toBeGreaterThan(20);
    expect(at(2.2).speed).toBeGreaterThan(R.speed * 0.93);
    // he has covered less ground than an instant start at top speed would
    expect(at(1).s).toBeLessThan(R.speed * 1);
  });

  it('never runs faster than his top speed, never goes backwards, and the position is continuous', () => {
    let prevS = -1, prevX = null;
    for (const q of pts) {
      expect(q.speed).toBeLessThanOrEqual(R.speed + 1e-6);
      expect(q.s).toBeGreaterThanOrEqual(prevS - 1e-9);
      if (prevX) expect(Math.hypot(q.x - prevX[0], q.z - prevX[1])).toBeLessThan(R.speed / 60 + 0.05);
      prevS = q.s; prevX = [q.x, q.z];
    }
  });

  it('slows down for each corner and speeds up again coming out of it', () => {
    for (const k of [2, 3]) {
      const tb = p.tBase[k];
      const vAt = p.at(tb, {}).speed;
      expect(vAt).toBeLessThan(R.speed * 0.86);
      expect(vAt).toBeGreaterThan(R.speed * 0.55);
      expect(p.at(tb - 1.0, {}).speed).toBeGreaterThan(vAt + 3); // faster on the straight before it
      expect(p.at(tb + 1.0, {}).speed).toBeGreaterThan(vAt + 3); // and after it
    }
  });

  it('never asks for more sideways grip than a runner has, and never brakes harder than he can', () => {
    for (const q of pts) expect(Math.abs(q.side)).toBeLessThanOrEqual(R.latAccel * 1.06);
    let worst = 0;
    for (let i = 1; i < pts.length; i++) worst = Math.max(worst, (pts[i - 1].speed - pts[i].speed) * 60);
    expect(worst).toBeLessThanOrEqual(R.brake * 1.15);
  });

  it('brakes to a stop exactly on the last base', () => {
    const end = p.at(p.duration + 0.5, {});
    expect(end.speed).toBe(0);
    expect(Math.hypot(end.x - BASE_XZ[4][0], end.z - BASE_XZ[4][1])).toBeLessThan(0.05);
    expect(end.done).toBe(true);
    // ... and slows down before it rather than stopping dead
    expect(p.at(p.duration - 0.3, {}).speed).toBeGreaterThan(2);
    expect(p.at(p.duration - 0.05, {}).speed).toBeLessThan(R.brake * 0.05 + 4);
  });

  it('a runner going through first base (an out) does not slow down for it', () => {
    const through = runnerProfile(0, 1, 'through');
    const stop = runnerProfile(0, 1, 'run');
    expect(through.at(through.tBase[1], {}).speed).toBeGreaterThan(R.speed * 0.9);
    expect(stop.at(stop.tBase[1] - 0.02, {}).speed).toBeLessThan(6);
    expect(through.tBase[1]).toBeLessThan(stop.tBase[1]);
  });
});

describe('the planner and the picture use the same times', () => {
  it('reaching more bases takes longer, one base at a time, and about as long as it always has', () => {
    for (const from of [0, 1, 2, 3]) {
      let prev = 0;
      for (let to = from + 1; to <= 4; to++) {
        const t = runnerArrival(CONFIG, from, to);
        expect(t).toBeGreaterThan(prev);
        prev = t;
        // calibration guard: within a third of a second of the constant-speed model the game was balanced on
        const old = from === 0 ? 3.95 + (to - 1) * (90 / 27) : 0.12 + (to - from) * (90 / 27);
        expect(Math.abs(t - old)).toBeLessThan(0.35);
      }
    }
  });

  it('a batter who is out at first runs through the bag but touches it exactly when the planner says', () => {
    const move = { from: 0, to: 0, out: true, outBase: 1 };
    expect(moveKind(move)).toBe('through');
    const plannerTouch = runnerArrival(CONFIG, 0, 1);
    const o = {};
    const before = runnerState(move, plannerTouch - 0.05, CONFIG, o);
    expect(Math.hypot(o.x - BASE_XZ[1][0], o.z - BASE_XZ[1][1])).toBeGreaterThan(0.3);
    expect(before.speed).toBeGreaterThan(R.speed * 0.9);
    const after = runnerState(move, plannerTouch + 0.03, CONFIG, o);
    expect(Math.hypot(after.x - BASE_XZ[1][0], after.z - BASE_XZ[1][1])).toBeGreaterThan(0.3);
    const at = runnerState(move, plannerTouch, CONFIG, {});
    expect(Math.hypot(at.x - BASE_XZ[1][0], at.z - BASE_XZ[1][1])).toBeLessThan(0.9);
  });

  it('every planned play lasts until its runners have stopped', () => {
    const rng = createRng(31);
    const defense = createDefense(CONFIG, createRng(5));
    for (let i = 0; i < 150; i++) {
      const params = { exitVelocity: rng.range(70, 108), launchAngle: rng.range(-6, 30), sprayAngle: rng.range(-40, 40), backspin: 1500, hook: 0, start: { x: 0, y: 2.6, z: -1 } };
      const sim = simulateBattedBall(params);
      const bases = [rng.next() < 0.5 ? {} : null, rng.next() < 0.4 ? {} : null, rng.next() < 0.3 ? {} : null];
      const plan = planPlay({ sim, contact: { grade: 'good', ...params }, bases, outs: 0, defense, simple: false }, CONFIG);
      if (plan.homer || plan.result === 'foul') continue;
      for (const m of plan.moves) {
        if (m.out) continue;
        expect(plan.endTime + 1e-6).toBeGreaterThanOrEqual(runnerFinish(CONFIG, m.from, m.to, m.tStart) - 0.4);
      }
    }
  });
});
