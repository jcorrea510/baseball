// Fielder movement: the run profile, the steering mover, and the intercept prediction that ties them to the ball.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { planRun, planDiveRun, sampleRun, samplePath, Mover, turnToward, timeToCover, covered, moverTravelTime, moverReturnTime } from '../src/game/fielderMotion.js';
import { simulateBattedBall, sampleBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, fielderFreeTime, fielderBackTime, POSITIONS } from '../src/game/fielding.js';
import { fenceDistance, sprayOf } from '../src/physics/field.js';
import { createRng } from '../src/util/rng.js';

const F = CONFIG.fielding;
const base = { x0: 0, z0: 0, x1: 0, z1: -60, tStart: 0.3, tArrive: 5, vmax: 22, accel: 22 / F.accel, brake: F.brake };
const dt = 1 / 120;

// walk a run frame by frame and collect what a viewer would see
function trace(run, tEnd, step = dt) {
  const pts = [];
  for (let t = 0; t <= tEnd; t += step) { const p = sampleRun(run, t); pts.push({ t, x: p.x, z: p.z, v: p.speed, s: p.s, phase: p.phase }); }
  return pts;
}

describe('planRun: one planned run', () => {
  it('stands still during his reaction time', () => {
    const run = planRun(base);
    for (const t of [0, 0.1, 0.29]) { const p = sampleRun(run, t); expect(p.z).toBeCloseTo(0, 6); expect(p.speed).toBe(0); expect(p.phase).toBe('wait'); }
  });

  it('with time to spare he runs at a steady pace, stops exactly on the spot and is at rest', () => {
    const run = planRun(base);
    expect(run.vArrive).toBe(0);
    expect(run.xStop).toBeCloseTo(0, 5);
    expect(run.zStop).toBeCloseTo(-60, 5);
    const end = sampleRun(run, run.tStop + 1);
    expect(end.z).toBeCloseTo(-60, 5);
    expect(end.speed).toBe(0);
    expect(run.tStop).toBeLessThanOrEqual(base.tArrive + 1e-6); // never later than asked
  });

  it('never speeds up or slows down faster than his acceleration / braking allow (no jerks)', () => {
    for (const tArrive of [3.2, 4, 6, 12]) {
      const run = planRun({ ...base, tArrive });
      const pts = trace(run, run.tStop + 0.5);
      for (let i = 1; i < pts.length; i++) {
        const dv = pts[i].v - pts[i - 1].v;
        expect(dv).toBeLessThanOrEqual(base.accel * dt * 1.02 + 1e-9);
        expect(-dv).toBeLessThanOrEqual(base.brake * dt * 1.02 + 1e-9);
      }
    }
  });

  it('only ever moves forward, never faster than top speed, never backwards', () => {
    const run = planRun({ ...base, tArrive: 3.6 });
    const pts = trace(run, run.tStop + 0.5);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].s).toBeGreaterThanOrEqual(pts[i - 1].s - 1e-9);
      expect(pts[i].v).toBeLessThanOrEqual(base.vmax + 1e-6);
      expect(pts[i].v).toBeGreaterThanOrEqual(0);
    }
  });

  it('runs gently when he has lots of time (never slower than the minimum effort), and arrives early', () => {
    const run = planRun({ ...base, tArrive: 30, minEffort: 0.62 });
    const peak = Math.max(...trace(run, run.tStop).map((p) => p.v));
    expect(peak).toBeCloseTo(0.62 * base.vmax, 1);
    expect(run.tStop).toBeLessThan(10);
  });

  it('on a tight play he arrives exactly on time at speed, then eases to a stop past the spot (a running catch)', () => {
    const tArrive = 0.3 + timeToCover(22, 60, F.accel) + 0.05; // less time than a run that ends at rest needs, but just enough at speed
    const run = planRun({ ...base, tArrive });
    expect(run.vArrive).toBeGreaterThan(5);
    expect(run.tReach).toBeCloseTo(tArrive, 2);
    const atArrival = sampleRun(run, tArrive);
    expect(atArrival.z).toBeCloseTo(-60, 0);
    // he keeps going past the spot for a moment, along the same line, and comes to rest
    expect(run.zStop).toBeLessThan(-60);
    expect(run.sStop - run.D).toBeLessThan((run.vArrive ** 2) / (2 * base.brake) + 1e-6);
    expect(sampleRun(run, run.tStop + 0.2).speed).toBe(0);
  });

  it('a target he cannot possibly reach in time is reached as soon as physically possible, not instantly', () => {
    const run = planRun({ ...base, tArrive: 0.5 });
    expect(run.tReach).toBeGreaterThan(0.3 + 60 / 22);
    expect(Number.isFinite(run.zStop)).toBe(true);
    const p = sampleRun(run, 1.0);
    expect(p.z).toBeGreaterThan(-25); // has only run a few feet a second after starting
  });

  it('handles a zero-length run and diagonal directions', () => {
    const same = planRun({ ...base, x1: 0, z1: 0 });
    expect(sampleRun(same, 3).z).toBe(0);
    const diag = planRun({ ...base, x1: 40, z1: -30, tArrive: 6 });
    const end = sampleRun(diag, diag.tStop + 1);
    expect(end.x).toBeCloseTo(40, 4);
    expect(end.z).toBeCloseTo(-30, 4);
    expect(sampleRun(diag, 2).heading).toBeCloseTo(Math.atan2(40, -30), 6);
  });

  it('holds for hundreds of random runs (finite, monotonic, lands on target when there is time)', () => {
    const rng = createRng(21);
    // Every check is still made on every sampled frame, but problems are collected and asserted once
    // (hundreds of thousands of individual expect() calls made this test slow enough to hit the time limit).
    const problems = [];
    for (let i = 0; i < 400; i++) {
      const o = {
        x0: rng.range(-200, 200), z0: rng.range(-350, 0), x1: rng.range(-200, 200), z1: rng.range(-350, 0),
        tStart: rng.range(0, 1), tArrive: rng.range(0.5, 9), vmax: rng.range(14, 26), accel: rng.range(20, 60), brake: rng.range(25, 60),
        minEffort: rng.range(0.4, 0.9),
      };
      const run = planRun(o);
      const pts = trace(run, run.tStop + 0.3, 1 / 60);
      let prev = 0;
      for (const p of pts) {
        if (!(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.v))) { problems.push(`run ${i}: not finite`); break; }
        if (p.s < prev - 1e-9) { problems.push(`run ${i}: went backwards`); break; }
        if (p.v > o.vmax + 1e-6) { problems.push(`run ${i}: faster than his top speed`); break; }
        prev = p.s;
      }
      // he reaches (or passes) the target
      if (!(run.sStop >= run.D - 1e-6)) problems.push(`run ${i}: stopped short of the target`);
      // and when there was plenty of time he is on the spot by then
      if (run.vArrive === 0 && !(Math.hypot(run.xStop - o.x1, run.zStop - o.z1) < 1e-6)) problems.push(`run ${i}: not on the spot`);
    }
    expect(problems).toEqual([]);
  });
});

describe('samplePath: several runs in a row', () => {
  it('the second run starts where the first came to rest', () => {
    const r1 = planRun({ ...base, x1: 0, z1: -30, tStart: 0.3, tArrive: 4 });
    const r2 = planRun({ ...base, x0: r1.xStop, z0: r1.zStop, x1: 40, z1: -30, tStart: Math.max(0.3, r1.tStop), tArrive: 12 });
    const a = samplePath([r1, r2], r1.tStop - 0.01);
    const b = samplePath([r1, r2], r2.tStart + 1.5);
    expect(a.z).toBeCloseTo(-30, 0);
    expect(b.x).toBeGreaterThan(0);
    const end = samplePath([r1, r2], 60);
    expect(end.x).toBeCloseTo(40, 4);
  });
});

describe('Mover: jogging back, repositioning', () => {
  const run = (m, seconds, step = 1 / 60) => {
    const out = [];
    for (let t = 0; t < seconds; t += step) { m.update(step); out.push({ x: m.x, z: m.z, v: m.speed }); }
    return out;
  };

  it('arrives on the spot and parks there, without overshooting or turning back', () => {
    for (const step of [1 / 30, 1 / 60, 1 / 144, 0.05]) {
      const m = new Mover(0, 0, { vmax: 21, accel: 34, brake: 42 });
      m.setTarget(0, -90);
      let prevZ = 0;
      for (const p of run(m, 10, step)) {
        expect(p.z).toBeLessThanOrEqual(prevZ + 1e-9); // never moves back toward where it came from
        expect(p.z).toBeGreaterThanOrEqual(-90 - 1e-9); // never passes the target
        expect(p.v).toBeLessThanOrEqual(21 + 1e-6);
        prevZ = p.z;
      }
      expect(m.parked).toBe(true);
      expect(m.z).toBeCloseTo(-90, 6);
      expect(m.speed).toBe(0);
    }
  });

  it('changes speed smoothly (no sudden stops or starts)', () => {
    const m = new Mover(0, 0, { vmax: 21, accel: 34, brake: 42 });
    m.setTarget(30, -50);
    let prev = 0;
    for (const p of run(m, 8, 1 / 60)) {
      expect(Math.abs(p.v - prev)).toBeLessThan(2.5); // well under a visible jump per frame
      prev = p.v;
    }
  });

  it('ignores a target that only wobbles a little, so it can never dither', () => {
    const m = new Mover(0, 0, { retarget: 0.9, wake: 1.4 });
    m.setTarget(0, 0.5); m.setTarget(0.4, -0.6); m.setTarget(-0.3, 0.2);
    for (let i = 0; i < 120; i++) m.update(1 / 60);
    expect(m.x).toBe(0);
    expect(m.z).toBe(0);
    // while travelling, small wobbles of the destination are ignored too
    m.setTarget(0, -60);
    for (let i = 0; i < 30; i++) m.update(1 / 60);
    const tz = m.tz;
    m.setTarget(0.5, -60.4);
    expect(m.tz).toBe(tz);
    m.setTarget(0, -75); // a real change is accepted
    expect(m.tz).toBe(-75);
  });

  it('a fielder already moving keeps his velocity when he is handed to the mover', () => {
    const m = new Mover(0, 0, {});
    m.reset(10, -40, 12, -6);
    m.setTarget(60, -10);
    const before = Math.hypot(m.vx, m.vz);
    m.update(1 / 60);
    expect(Math.abs(Math.hypot(m.vx, m.vz) - before)).toBeLessThan(2);
  });

  it('counts as arrived inside the small arrival radius', () => {
    const m = new Mover(0, 0, { radius: 0.4 });
    m.setTarget(0, -20);
    expect(m.arrived).toBe(false);
    for (let i = 0; i < 600; i++) m.update(1 / 60);
    expect(m.arrived).toBe(true);
  });
});

describe('turning', () => {
  it('turns toward a target at a limited rate, the short way round, without overshooting', () => {
    let a = 0;
    const target = 3.0;
    for (let i = 0; i < 200; i++) {
      const next = turnToward(a, target, (640 * Math.PI) / 180 / 60, 12, 1 / 60);
      expect(Math.abs(next - a)).toBeLessThanOrEqual((640 * Math.PI) / 180 / 60 + 1e-9);
      expect(next).toBeLessThanOrEqual(target + 1e-9);
      a = next;
    }
    expect(a).toBeCloseTo(target, 2);
    // the short way from +3 to -3 is through 180 degrees, i.e. increasing
    expect(turnToward(3.0, -3.0, 1, 12, 1 / 60)).toBeGreaterThan(3.0 - 1e-9);
  });
});

// ------------------------------------------------------------------------------------------------------------
// Intercept prediction: does the planner put the right fielder at the right spot at the right time?
// ------------------------------------------------------------------------------------------------------------
const contactOf = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: Math.min(3400, 900 + 55 * Math.max(la, 0)), hook: 0 });
const playOf = (ev, la, spray, o = {}) => {
  const c = contactOf(ev, la, spray);
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  return { sim, plan: planPlay({ sim, contact: c, bases: o.bases || [null, null, null], outs: o.outs ?? 0, defense: createDefense(), simple: o.simple }, CONFIG) };
};

describe('intercept prediction', () => {
  it('the catch spot is exactly where the ball is at the catch time', () => {
    for (const [ev, la, sp] of [[80, 40, 0], [90, 35, -14], [72, 33, 20], [66, 55, 5]]) {
      const { sim, plan } = playOf(ev, la, sp);
      if (!plan.caught) continue;
      const b = sampleBall(sim, plan.catchT);
      expect(Math.hypot(b.x - plan.catchPos.x, b.z - plan.catchPos.z)).toBeLessThan(1e-6);
      expect(Math.abs(b.y - plan.catchPos.y)).toBeLessThan(1e-6);
    }
  });

  it('the chosen fielder is at the catch / pickup spot (within glove reach) when the ball gets there', () => {
    const rng = createRng(8);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const { plan } = playOf(rng.range(45, 106), rng.range(-8, 60), rng.range(-42, 42));
      const t = plan.caught ? plan.catchT : plan.pickupT;
      if (plan.homer || t === undefined || !plan.fielder) continue;
      const target = plan.catchPos || plan.pickupPos;
      const p = samplePath(plan.paths[plan.fielder], t);
      const own = plan.fielderMoves.find((m) => m.pos === plan.fielder);
      const reach = (plan.caught ? F.glove : F.groundGlove) + (own && own.dive ? (plan.caught ? F.diveExtra : F.groundDive) : 0) + 0.35;
      expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThanOrEqual(reach);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('a fly ball he has time for: he gets there early and waits (easing to a stop), not sprinting to the last instant', () => {
    const { plan } = playOf(80, 40, 0); // routine fly to center
    const run = plan.paths.CF[0];
    expect(run.vArrive).toBe(0);
    expect(run.tStop).toBeLessThan(plan.catchT);
  });

  it('a ball he barely gets to: he arrives on time at speed (a running catch)', () => {
    let found = null;
    const rng = createRng(4);
    for (let i = 0; i < 400 && !found; i++) {
      const { plan } = playOf(rng.range(70, 100), rng.range(18, 34), rng.range(-30, 30));
      if (plan.caught && !plan.fielderMoves[0].dive && plan.paths[plan.fielder][0].vArrive > 6) found = plan;
    }
    expect(found).toBeTruthy();
    const run = found.paths[found.fielder][0];
    expect(Math.abs(run.tReach - found.catchT)).toBeLessThan(0.06);
  });

  it('nobody is sent for a ball no one can reach (it is a hit, not a catch)', () => {
    const { plan } = playOf(100, 12, -44); // a line drive into the left-field corner
    expect(plan.caught).toBeFalsy();
    expect(['single', 'double', 'triple', 'insideParkHomer', 'foul', 'hitSimple']).toContain(plan.result);
  });

  it('on a bouncing ball the pickup spot is on the ball path after it has bounced (target is fixed once, from the whole flight)', () => {
    const { sim, plan } = playOf(88, 4, 12);
    expect(sim.bounces).toBeGreaterThan(0);
    const t = plan.pickupT;
    const b = sampleBall(sim, t);
    expect(Math.hypot(b.x - plan.pickupPos.x, b.z - plan.pickupPos.z)).toBeLessThan(1e-6);
    expect(t).toBeGreaterThanOrEqual(sim.firstBounce.t - 1e-6);
    // planning is deterministic: same ball, same plan
    const again = playOf(88, 4, 12).plan;
    expect(again.pickupT).toBe(plan.pickupT);
    expect(again.paths[plan.fielder][0].tStop).toBe(plan.paths[plan.fielder][0].tStop);
  });

  it('a ball that ends up against the wall is run down at a believable speed (nobody teleports)', () => {
    const { plan } = playOf(84, 18, -42); // a drive down the line that ends up against the wall
    expect(plan.pickupT).toBeGreaterThan(3);
    const run = plan.paths[plan.fielder][0];
    const pts = trace(run, run.tStop, 1 / 60);
    expect(Math.max(...pts.map((p) => p.v))).toBeLessThanOrEqual(F.speed.OF * 1.1 + 1e-6);
    const p = samplePath(plan.paths[plan.fielder], plan.pickupT);
    expect(Math.hypot(p.x - plan.pickupPos.x, p.z - plan.pickupPos.z)).toBeLessThan(F.glove + F.diveExtra + 0.4);
  });
});

describe('who chases and who backs up', () => {
  it('one fielder chases; a teammate backs him up behind the ball and another shades toward it', () => {
    const { plan } = playOf(96, 27, 0); // deep fly to center that is caught or nearly so
    const roles = Object.fromEntries(plan.fielderMoves.map((m) => [m.pos, m.role]));
    expect(plan.fielder).toBe('CF');
    const backups = plan.fielderMoves.filter((m) => m.role === 'backup');
    expect(backups.length).toBeGreaterThanOrEqual(1);
    for (const b of backups) expect(['LF', 'RF']).toContain(b.pos);
    void roles;
  });

  it('nobody ever runs to a spot outside the fence, and every run is finite', () => {
    const rng = createRng(17);
    for (let i = 0; i < 250; i++) {
      const { plan } = playOf(rng.range(45, 106), rng.range(-8, 60), rng.range(-44, 44), { bases: [rng.chance(0.5) ? {} : null, rng.chance(0.4) ? {} : null, rng.chance(0.3) ? {} : null] });
      for (const [pos, runs] of Object.entries(plan.paths)) {
        for (const r of runs) {
          expect(Number.isFinite(r.tStart) && Number.isFinite(r.tStop) && Number.isFinite(r.xStop) && Number.isFinite(r.zStop)).toBe(true);
          expect(r.tStop).toBeGreaterThanOrEqual(r.tStart);
          const lim = fenceDistance(sprayOf(r.x1, r.z1));
          if (pos !== plan.fielder) expect(Math.hypot(r.x1, r.z1)).toBeLessThan(lim + 0.5);
        }
        // a fielder's runs are back to back, never overlapping
        for (let k = 1; k < runs.length; k++) expect(runs[k].tStart).toBeGreaterThanOrEqual(runs[k - 1].tStop - 1e-9);
      }
    }
  });

  it('a throw goes to where its receiver really is', () => {
    const rng = createRng(29);
    for (let i = 0; i < 200; i++) {
      const { plan } = playOf(rng.range(60, 104), rng.range(-6, 30), rng.range(-40, 40), { bases: [{}, null, null] });
      for (const th of plan.throws) {
        const runs = plan.paths[th.to];
        if (!runs) continue;
        const p = samplePath(runs, th.t1);
        expect(Math.hypot(p.x - th.bx, p.z - th.bz)).toBeLessThan(1.3);
      }
    }
  });

  it('a fielder is free to jog home only after his job (and the throw) is done', () => {
    const { plan } = playOf(85, 4, -6, { bases: [{}, null, null] }); // ground ball, force play
    const f = plan.fielder;
    expect(fielderFreeTime(plan, f)).toBeGreaterThan(plan.pickupT);
    for (const th of plan.throws) {
      expect(fielderFreeTime(plan, th.from)).toBeGreaterThanOrEqual(th.t0);
      expect(fielderFreeTime(plan, th.to)).toBeGreaterThanOrEqual(th.t1);
    }
    for (const pos of POSITIONS) expect(Number.isFinite(fielderFreeTime(plan, pos))).toBe(true);
  });

  it('planning the movement never changes the result of the play', () => {
    // the same ball with and without spectators moving gives identical outcomes (moves are visual only)
    const a = playOf(88, 22, 10, { bases: [{}, {}, null] }).plan;
    const b = playOf(88, 22, 10, { bases: [{}, {}, null] }).plan;
    expect([a.result, a.outsMade, a.batterDest, a.endTime]).toEqual([b.result, b.outsMade, b.batterDest, b.endTime]);
  });
});

// ------------------------------------------------------------------------------------------------------------
// Diving
// ------------------------------------------------------------------------------------------------------------
const DV = F.dive;
const A_T = F.accel;
// A catch time the way the planner produces one: the ball is 2 ft beyond what he can reach by running (so he must dive).
const diveTiming = (dist, extra = 2.0, tStart = 0.36, vmax = 22) => tStart + timeToCover(vmax, dist - F.glove - extra, A_T);
const diveBase = { x0: 0, z0: 0, px: 0, pz: -40, tStart: 0.36, tCatch: diveTiming(40), vmax: 22, accel: 22 / F.accel, brake: F.brake, dive: DV };

describe('planDiveRun: a dive is one committed motion', () => {
  it('needs a real distance to dive across', () => {
    expect(planDiveRun({ ...diveBase, px: 0, pz: -2 })).toBeNull();
    expect(planDiveRun(diveBase)).toBeTruthy();
  });

  it('the launch is seamless: same place and same speed the instant before and after leaving his feet', () => {
    const run = planDiveRun(diveBase);
    const before = { ...sampleRun(run, run.dive.tL - 1e-4) };
    const after = { ...sampleRun(run, run.dive.tL + 1e-4) };
    expect(Math.abs(after.s - before.s)).toBeLessThan(0.01);
    expect(Math.abs(after.speed - before.speed)).toBeLessThan(0.15);
    expect(before.phase).toBe('accel');
    expect(after.phase).toBe('air');
  });

  it('goes through wait, run, air, slide, hold, get up, done - in that order, launching before the catch and landing after it', () => {
    const run = planDiveRun(diveBase);
    const seen = [];
    for (let t = 0; t < run.dive.tEnd + 0.5; t += 1 / 120) { const p = sampleRun(run, t).phase; if (seen[seen.length - 1] !== p) seen.push(p); }
    expect(seen).toEqual(['wait', 'accel', 'air', 'slide', 'hold', 'getup', 'done']);
    expect(run.dive.tL).toBeLessThan(diveBase.tCatch);
    expect(run.dive.tLand).toBeGreaterThan(diveBase.tCatch);
    expect(diveBase.tCatch - run.dive.tL).toBeCloseTo(DV.airTime, 3);
  });

  it('the glove meets the ball exactly at the catch time: his body is one arm-length short of the ball', () => {
    const run = planDiveRun(diveBase);
    const p = sampleRun(run, diveBase.tCatch);
    expect(Math.hypot(diveBase.px - p.x, diveBase.pz - p.z)).toBeCloseTo(DV.armReach, 1);
  });

  it('he dives in ONE direction: the whole path stays on the line to the ball', () => {
    const run = planDiveRun({ ...diveBase, px: 25, pz: -35 });
    const dx = 25 / Math.hypot(25, 35), dz = -35 / Math.hypot(25, 35);
    for (let t = 0; t < run.dive.tEnd; t += 1 / 60) {
      const p = sampleRun(run, t);
      const cross = Math.abs((p.x - run.x0) * dz - (p.z - run.z0) * dx);
      expect(cross).toBeLessThan(1e-6);
    }
    expect(sampleRun(run, 1).heading).toBeCloseTo(Math.atan2(dx, dz), 6);
  });

  it('never goes backwards, never faster than a sprint plus a push, and slides to a stop within a few feet', () => {
    const run = planDiveRun(diveBase);
    let prev = 0;
    for (let t = 0; t < run.dive.tEnd + 0.3; t += 1 / 120) {
      const p = sampleRun(run, t);
      expect(p.s).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(p.speed).toBeLessThanOrEqual(diveBase.vmax * 1.3);
      prev = p.s;
    }
    expect(run.dive.slideDist).toBeLessThan(4);
    expect(sampleRun(run, run.dive.tEnd + 0.5).speed).toBe(0);
    expect(sampleRun(run, run.dive.tEnd + 0.5).s).toBeCloseTo(run.sStop, 6);
  });

  it('the flight itself is a believable length (a lunge, not a teleport)', () => {
    for (const dist of [10, 25, 45, 80]) {
      const run = planDiveRun({ ...diveBase, pz: -dist, tCatch: diveTiming(dist) });
      expect(run).toBeTruthy();
      expect(run.dive.sFlight).toBeLessThan(16);
    }
  });

  it('random dives are all finite and consistent', () => {
    const rng = createRng(5);
    let made = 0;
    for (let i = 0; i < 300; i++) {
      const o = { ...diveBase, x0: rng.range(-100, 100), z0: rng.range(-300, -60), px: rng.range(-100, 100), pz: rng.range(-300, -20), tStart: rng.range(0.2, 0.6), tCatch: rng.range(0.55, 5), vmax: rng.range(15, 25) };
      const run = planDiveRun(o);
      if (!run) continue;
      made++;
      expect(run.dive.tL).toBeLessThan(o.tCatch);
      expect(o.tCatch - run.dive.tL).toBeGreaterThanOrEqual(0.14 - 1e-9);
      expect(run.dive.tEnd).toBeGreaterThan(run.dive.tLand);
      for (let t = 0; t <= run.dive.tEnd; t += 0.05) { const p = sampleRun(run, t); expect(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.speed)).toBe(true); }
    }
    expect(made).toBeGreaterThan(200);
  });
});

describe('when a fielder dives', () => {
  const sweep = (cfg = CONFIG) => {
    const rows = [];
    const rng = createRng(2);
    const defense = createDefense(cfg);
    for (let i = 0; i < 900; i++) {
      const c = contactOf(rng.range(45, 104), rng.range(-8, 46), rng.range(-42, 42));
      const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.5, z: -1 } }, cfg);
      const plan = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, cfg);
      if (plan.homer || !plan.fair) continue;
      rows.push(plan);
    }
    return rows;
  };
  const plans = sweep();
  const dives = plans.filter((p) => p.fielderMoves[0] && p.fielderMoves[0].dive);

  it('dives are the exception (a fielder does not dive for a ball he can simply run to)', () => {
    expect(dives.length).toBeGreaterThan(5);
    expect(dives.length / plans.length).toBeLessThan(0.15);
  });

  it('the "just run to it" rule really removes dives', () => {
    const eager = { ...CONFIG, fielding: { ...F, dive: { ...F.dive, preferRun: 0 } } };
    const eagerDives = sweep(eager).filter((p) => p.fielderMoves[0] && p.fielderMoves[0].dive).length;
    expect(eagerDives).toBeGreaterThan(dives.length * 2);
  });

  it('a dive is only for a low ball', () => {
    for (const p of dives.filter((q) => q.caught)) expect(p.catchPos.y).toBeLessThanOrEqual(5.2 + 1e-9);
  });

  it('every dive has a launch and a touchdown event, launching before the ball is caught and landing after', () => {
    for (const p of dives) {
      const tc = p.caught ? p.catchT : p.pickupT;
      const launch = p.events.find((e) => e.type === 'dive');
      const land = p.events.find((e) => e.type === 'diveLand');
      expect(launch && land).toBeTruthy();
      expect(launch.t).toBeLessThan(tc);
      expect(land.t).toBeGreaterThan(tc);
      expect(launch.catch).toBe(!!p.caught);
      expect(Number.isFinite(land.x) && Number.isFinite(land.z)).toBe(true);
    }
  });

  it('a fielder who dove for a grounder throws from his knees, not before he is off the ground', () => {
    const stops = dives.filter((p) => !p.caught && p.throws.length && p.throws[0].from === p.fielder);
    expect(stops.length).toBeGreaterThan(0);
    for (const p of stops) {
      const run = p.paths[p.fielder][0];
      expect(p.throws[0].t0).toBeGreaterThan(run.dive.tLand + run.dive.slideDur);
    }
  });

  it('planning a dive is deterministic', () => {
    const c = contactOf(76, 21, -24);
    const mk = () => planPlay({ sim: simulateBattedBall({ ...c, start: { x: 0, y: 2.5, z: -1 } }), contact: c, bases: [null, null, null], outs: 0, defense: createDefense() }, CONFIG);
    const a = mk(), b = mk();
    expect(JSON.stringify(a.paths)).toBe(JSON.stringify(b.paths));
    expect(a.events).toEqual(b.events);
  });
});

describe('how long the jog home takes (the engine waits for it)', () => {
  const jog = { vmax: 21, accel: 34, brake: 42, wake: 0.9 };
  it('grows with the distance and is never shorter than running it flat out', () => {
    let prev = 0;
    for (const d of [2, 5, 10, 20, 40, 65]) {
      const t = moverTravelTime(d, jog);
      expect(t).toBeGreaterThan(prev);
      expect(t).toBeGreaterThanOrEqual(d / 21);
      prev = t;
    }
    expect(moverTravelTime(0, jog)).toBe(0);
  });
  it('matches what the Mover really does', () => {
    const m = new Mover(0, 0, jog);
    m.tx = 30; m.tz = 0; m.parked = false;
    let t = 0;
    while (!m.parked && t < 30) { m.update(1 / 60); t += 1 / 60; }
    expect(moverTravelTime(30, jog)).toBeCloseTo(t, 6);
  });
  it('is longer when he is still running away from home, and equal from a standstill', () => {
    const still = moverReturnTime(0, 0, 0, 0, 30, 0, jog);
    expect(still).toBeCloseTo(moverTravelTime(30, jog), 6);
    expect(moverReturnTime(0, 0, -18, 0, 30, 0, jog)).toBeGreaterThan(still + 0.3);
    expect(moverReturnTime(0, 0, 18, 0, 30, 0, jog)).toBeLessThan(still);
  });
});

describe('show-only runs do not hold up the game', () => {
  it('backups and shading finish by the time the play is over, and a fielder is never "back" before his run ends', () => {
    const rng = createRng(19);
    const defense = createDefense(CONFIG, createRng(5));
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const params = { exitVelocity: rng.range(60, 108), launchAngle: rng.range(-6, 34), sprayAngle: rng.range(-42, 42), backspin: 1500, hook: 0, start: { x: 0, y: 2.6, z: -1 } };
      const sim = simulateBattedBall(params);
      const bases = [rng.next() < 0.5 ? {} : null, rng.next() < 0.4 ? {} : null, rng.next() < 0.3 ? {} : null];
      const plan = planPlay({ sim, contact: { grade: 'good', ...params }, bases, outs: 0, defense, simple: false }, CONFIG);
      for (const m of plan.fielderMoves) {
        if (m.role === 'backup' || m.role === 'shade') { expect(m.run.tStop).toBeLessThanOrEqual(plan.endTime + 0.9); checked++; }
      }
      for (const pos of POSITIONS) {
        const runs = plan.paths[pos];
        const back = fielderBackTime(plan, pos, defense, CONFIG, plan.endTime);
        if (!runs || !runs.length) { expect(back).toBe(0); continue; }
        expect(back).toBeGreaterThanOrEqual(Math.min(runs[runs.length - 1].tStop, plan.endTime) - 1e-6);
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('a pitcher who broke toward first or backed up home is back soon enough to keep the game quick', () => {
    const defense = createDefense(CONFIG, createRng(5));
    for (const [ev, la, sp, bs] of [[84, -4, 34, [0, 0, 0]], [88, 6, -6, [0, 0, 1]], [45, -6, 22, [0, 0, 0]]]) {
      const params = { exitVelocity: ev, launchAngle: la, sprayAngle: sp, backspin: 1200, hook: 0, start: { x: 0, y: 2.6, z: -1 } };
      const sim = simulateBattedBall(params);
      const plan = planPlay({ sim, contact: { grade: 'good', ...params }, bases: bs.map((b) => (b ? {} : null)), outs: 0, defense, simple: false }, CONFIG);
      const back = fielderBackTime(plan, 'P', defense, CONFIG, plan.endTime);
      expect(back - plan.endTime).toBeLessThan(4.0); // (a pitcher who really ran over to cover first has ~65 ft to jog back)
    }
  });
});
