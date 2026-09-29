// Nobody ever runs through the wall or out of the ballpark, and the ball bounces back off the wall.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { simulateBattedBall, sampleBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { planRun, planDiveRun, sampleRun, samplePath, Mover } from '../src/game/fielderMotion.js';
import { fenceDistance, isInsideField, clampToField, distanceToWall, wallClearance } from '../src/physics/field.js';

const F = CONFIG.fielding;

describe('the ballpark outline', () => {
  it('knows what is inside and what is not', () => {
    expect(isInsideField(0, -100)).toBe(true); // infield
    expect(isInsideField(0, -(fenceDistance(0) - 5))).toBe(true); // just in front of the center-field wall
    expect(isInsideField(0, -(fenceDistance(0) + 5))).toBe(false); // in the stands
    expect(isInsideField(0, 60)).toBe(true); // behind the plate
    expect(isInsideField(0, 140)).toBe(false); // beyond the backstop
    expect(isInsideField(-400, 0)).toBe(false);
  });

  it('clamps to a spot a set distance in front of the wall, and leaves inside spots alone', () => {
    const wall = fenceDistance(0);
    const [x, z] = clampToField(0, -(wall + 30), F.wallMargin);
    expect(x).toBeCloseTo(0, 1);
    expect(-z).toBeCloseTo(wall - F.wallMargin, 1);
    expect(clampToField(10, -120, F.wallMargin)).toEqual([10, -120]);
    // (across the whole outfield; the corners at the foul poles are the only places a straight push-back cannot give the full margin)
    for (let sp = -40; sp <= 40; sp += 5) {
      const a = (sp * Math.PI) / 180;
      const [cx, cz] = clampToField(Math.sin(a) * 500, -Math.cos(a) * 500, F.wallMargin);
      expect(wallClearance(cx, cz)).toBeGreaterThan(F.wallMargin - 0.05);
    }
    for (let sp = -70; sp <= 70; sp += 5) {
      const a = (sp * Math.PI) / 180;
      const [cx, cz] = clampToField(Math.sin(a) * 500, -Math.cos(a) * 500, F.wallMargin);
      expect(isInsideField(cx, cz)).toBe(true);
    }
  });

  it('measures how far it is to the wall along a line', () => {
    expect(distanceToWall(0, -200, 0, -1)).toBeCloseTo(fenceDistance(0) - 200, 0);
    expect(distanceToWall(0, 0, 0, 1)).toBeGreaterThan(80); // the backstop
    expect(wallClearance(0, -(fenceDistance(0) - 3))).toBeCloseTo(3, 0);
    expect(wallClearance(0, -(fenceDistance(0) + 3))).toBeCloseTo(-3, 0);
  });
});

describe('a run toward a wall', () => {
  const base = { x0: 0, z0: -200, tStart: 0.3, vmax: 24, accel: 24 / F.accel, brake: F.brake, wallBrake: F.wallBrake };

  it('never goes past its limit, even flat out on a tight play', () => {
    const rng = createRng(4);
    const problems = [];
    for (let i = 0; i < 300; i++) {
      const D = rng.range(10, 120);
      const room = rng.range(0.4, 6);
      const run = planRun({ ...base, x1: 0, z1: -200 - D, tArrive: 0.3 + rng.range(1, 6), limitS: D + room, vmax: rng.range(16, 26), accel: rng.range(20, 60) });
      if (run.sStop > D + room + 1e-6) problems.push(`run ${i}: stops ${run.sStop - D - room} ft past the limit`);
      let prev = -1, prevV = 0;
      for (let t = 0; t < run.tStop + 0.5; t += 1 / 60) {
        const p = sampleRun(run, t);
        if (p.s > D + room + 1e-6) { problems.push(`run ${i}: sampled past the limit at t=${t}`); break; }
        if (p.s < prev - 1e-9) { problems.push(`run ${i}: went backwards`); break; }
        prev = p.s; prevV = p.speed;
      }
      void prevV;
    }
    expect(problems).toEqual([]);
  });

  it('brakes harder for a nearby wall but is unchanged when the wall is far away', () => {
    const far = planRun({ ...base, x1: 0, z1: -260, tArrive: 3.2, limitS: 400 });
    const none = planRun({ ...base, x1: 0, z1: -260, tArrive: 3.2 });
    expect(far.sStop).toBeCloseTo(none.sStop, 9);
    expect(far.tStop).toBeCloseTo(none.tStop, 9);
    const near = planRun({ ...base, x1: 0, z1: -260, tArrive: 3.2, limitS: 60 + 1.5 });
    expect(near.sStop).toBeLessThanOrEqual(61.5 + 1e-6);
    expect(near.vArrive).toBeLessThan(none.vArrive + 1e-9);
  });

  it('a dive stops in front of the wall too', () => {
    const run = planDiveRun({ x0: 0, z0: -370, px: 0, pz: -385, tStart: 0.3, tCatch: 2.2, vmax: 22, accel: 22 / F.accel, brake: F.brake, dive: F.dive, limitS: 17.5 });
    expect(run).toBeTruthy();
    for (let t = 0; t < run.dive.tEnd; t += 1 / 60) expect(sampleRun(run, t).s).toBeLessThanOrEqual(17.5 + 1e-6);
  });
});

describe('the jog back to position', () => {
  it('a mover carrying speed toward the wall is held inside it', () => {
    const wall = fenceDistance(0);
    const m = new Mover(0, -(wall - 30), { vmax: 21, accel: 34, brake: 42, bound: (x, z) => clampToField(x, z, F.wallBody) });
    m.reset(0, -(wall - 30), 0, -22); // running full speed at the wall
    m.setTarget(0, -250); // ... but heading home, which is behind him
    let closest = Infinity;
    for (let i = 0; i < 300; i++) { m.update(1 / 60); closest = Math.min(closest, wallClearance(m.x, m.z)); }
    expect(closest).toBeGreaterThanOrEqual(F.wallBody - 1e-6);
  });
});

describe('planned plays', () => {
  const defense = createDefense(CONFIG, createRng(5));
  const POS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

  it('never put a fielder outside the ballpark, over hundreds of deep hits, wall balls and fouls', () => {
    const rng = createRng(77);
    const problems = [];
    for (let i = 0; i < 400; i++) {
      const params = {
        exitVelocity: rng.range(88, 112), launchAngle: rng.range(6, 42), sprayAngle: rng.range(-48, 48),
        backspin: rng.range(800, 3200), hook: rng.range(-1, 1), start: { x: 0, y: 2.6, z: -1 },
      };
      const sim = simulateBattedBall(params);
      const bases = [rng.next() < 0.5 ? {} : null, rng.next() < 0.3 ? {} : null, rng.next() < 0.2 ? {} : null];
      const plan = planPlay({ sim, contact: { grade: 'good', ...params }, bases, outs: rng.int(0, 2), defense, simple: false }, CONFIG);
      for (const pos of POS) {
        const runs = plan.paths[pos];
        if (!runs || !runs.length) continue;
        const tEnd = Math.max(...runs.map((r) => r.tStop)) + 0.3;
        for (let t = 0; t <= tEnd; t += 1 / 20) {
          const p = samplePath(runs, t);
          if (wallClearance(p.x, p.z) < F.wallBody - 0.05) { problems.push(`play ${i} (${plan.result}): ${pos} is ${wallClearance(p.x, p.z).toFixed(2)} ft from the wall at t=${t.toFixed(2)}`); break; }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('an outfielder who catches a deep ball at the wall stops in front of it', () => {
    // a high drive that lands right at the wall: catchable only if he gets there
    let found = null;
    for (let ev = 90; ev <= 104 && !found; ev += 1) {
      const params = { exitVelocity: ev, launchAngle: 36, sprayAngle: 0, backspin: 2200, hook: 0, start: { x: 0, y: 2.6, z: -1 } };
      const sim = simulateBattedBall(params);
      const plan = planPlay({ sim, contact: { grade: 'good', ...params }, bases: [null, null, null], outs: 0, defense, simple: false }, CONFIG);
      if (plan.caught && plan.fielder === 'CF' && Math.hypot(plan.catchPos?.x ?? 0, plan.catchPos?.z ?? 0) > fenceDistance(0) - 25) found = plan;
    }
    if (found) {
      const runs = found.paths.CF;
      const last = runs[runs.length - 1];
      expect(wallClearance(last.xStop, last.zStop)).toBeGreaterThanOrEqual(F.wallBody - 1e-6);
    }
  });

  it('a home run watcher stands well in front of the wall', () => {
    let plan = null;
    for (let ev = 100; ev <= 112 && !plan; ev += 1) {
      const params = { exitVelocity: ev, launchAngle: 28, sprayAngle: 8, backspin: 2000, hook: 0, start: { x: 0, y: 2.6, z: -1 } };
      const sim = simulateBattedBall(params);
      const p = planPlay({ sim, contact: { grade: 'perfect', ...params }, bases: [null, null, null], outs: 0, defense, simple: false }, CONFIG);
      if (p.homer) plan = p;
    }
    expect(plan).toBeTruthy();
    const run = plan.paths[plan.fielder][0];
    expect(wallClearance(run.x1, run.z1)).toBeGreaterThan(F.wallMargin + 1);
  });
});

describe('the ball off the wall', () => {
  it('bounces back into the field', () => {
    let checked = 0;
    for (let sp = -40; sp <= 40; sp += 8) {
      const sim = simulateBattedBall({ exitVelocity: 104, launchAngle: 12, sprayAngle: sp, backspin: 1500, hook: 0, start: { x: 0, y: 2.6, z: -1 } });
      if (!sim.wallHit) continue;
      const w = sim.wallHit;
      const wallD = Math.hypot(w.x, w.z);
      const later = sampleBall(sim, Math.min(sim.duration, w.t + 0.6));
      // half a second later the ball is nearer home than the wall
      expect(Math.hypot(later.x, later.z)).toBeLessThan(wallD - 0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });
});
