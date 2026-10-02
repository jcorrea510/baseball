import { describe, it, expect } from 'vitest';
import { CONFIG, MPH } from '../src/config.js';
import { simulateBattedBall, projectDistance, sampleBall, judgeFairFoul, battedBallType } from '../src/physics/ballistics.js';
import { fenceDistance, sprayOf, polar, isFairXZ, BASE_XZ } from '../src/physics/field.js';

const vacuum = { ...CONFIG, physics: { ...CONFIG.physics, dragK: 0, magnusK: 0 } };
const r = CONFIG.physics.ballRadius;

describe('trajectory math', () => {
  it('matches the textbook range formula with no air (v^2 sin(2a)/g)', () => {
    const ev = 100, la = 30;
    const v = ev * MPH;
    const expected = (v * v * Math.sin((2 * la * Math.PI) / 180)) / vacuum.physics.gravity;
    const d = projectDistance({ exitVelocity: ev, launchAngle: la, sprayAngle: 0, backspin: 0, start: { x: 0, y: r, z: 0 } }, vacuum);
    expect(Math.abs(d.distance - expected) / expected).toBeLessThan(0.01);
  });

  it('air drag shortens the flight a lot', () => {
    const p = { exitVelocity: 100, launchAngle: 28, sprayAngle: 0, backspin: 0, start: { x: 0, y: r, z: 0 } };
    const noAir = projectDistance(p, vacuum).distance;
    const air = projectDistance(p, CONFIG).distance;
    expect(air).toBeLessThan(noAir * 0.85);
  });

  it('backspin makes the ball carry farther', () => {
    const base = { exitVelocity: 100, launchAngle: 28, sprayAngle: 0 };
    expect(projectDistance({ ...base, backspin: 2400 }).distance).toBeGreaterThan(projectDistance({ ...base, backspin: 0 }).distance + 15);
  });

  it('realistic distances: 100 mph at 28 degrees goes roughly 350-410 ft', () => {
    const d = projectDistance({ exitVelocity: 100, launchAngle: 28, sprayAngle: 0, backspin: 2400 }).distance;
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(410);
  });

  it('harder = farther, and the spray angle rotates the landing point', () => {
    const a = projectDistance({ exitVelocity: 90, launchAngle: 27, sprayAngle: 0, backspin: 2300 }).distance;
    const b = projectDistance({ exitVelocity: 105, launchAngle: 27, sprayAngle: 0, backspin: 2300 }).distance;
    expect(b).toBeGreaterThan(a + 40);
    const c = projectDistance({ exitVelocity: 100, launchAngle: 27, sprayAngle: 30, backspin: 0 });
    expect(Math.abs(sprayOf(c.x, c.z) - 30)).toBeLessThan(0.5);
  });

  it('is deterministic', () => {
    const p = { exitVelocity: 97, launchAngle: 24, sprayAngle: -12, backspin: 2000, hook: 300 };
    const a = simulateBattedBall(p), b = simulateBattedBall(p);
    expect(a.count).toBe(b.count);
    expect(a.x[a.count - 1]).toBe(b.x[b.count - 1]);
  });

  it('sidespin curves the ball toward the foul line it is hit toward', () => {
    const base = { exitVelocity: 98, launchAngle: 26, sprayAngle: 20, backspin: 2000 };
    const straight = projectDistance({ ...base, hook: 0 });
    const hooked = projectDistance({ ...base, hook: 700 });
    expect(hooked.x).toBeGreaterThan(straight.x);
  });
});

describe('ground, bounces and rolling', () => {
  it('never goes below the ground', () => {
    const s = simulateBattedBall({ exitVelocity: 85, launchAngle: -5, sprayAngle: 8, backspin: 0 });
    for (let i = 0; i < s.count; i++) expect(s.y[i]).toBeGreaterThanOrEqual(r - 1e-4);
  });

  it('a grounder bounces, then rolls to a stop', () => {
    const s = simulateBattedBall({ exitVelocity: 70, launchAngle: 2, sprayAngle: -15, backspin: 200 });
    expect(s.bounces).toBeGreaterThan(0);
    expect(s.duration).toBeLessThan(CONFIG.physics.maxTime);
    expect(s.firstBounce).toBeTruthy();
    const k = s.count - 1;
    expect(Math.hypot(s.x[k] - s.x[k - 1], s.z[k] - s.z[k - 1])).toBeLessThan(0.005);
  });

  it('bounces lose energy: second bounce is lower than the first', () => {
    const s = simulateBattedBall({ exitVelocity: 60, launchAngle: -10, sprayAngle: 0, backspin: 0 });
    let peaks = [], prev = s.y[0], rising = false;
    for (let i = 1; i < s.count; i++) {
      if (s.y[i] > prev) rising = true;
      else if (rising && s.y[i] < prev) { peaks.push(prev); rising = false; }
      prev = s.y[i];
    }
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(peaks[1]).toBeLessThan(peaks[0]);
  });

  it('sampleBall interpolates between samples', () => {
    const s = simulateBattedBall({ exitVelocity: 90, launchAngle: 20, sprayAngle: 0, backspin: 1500 });
    const a = sampleBall(s, 1.0);
    const mid = sampleBall(s, 1.0 + s.dt / 2);
    const b = sampleBall(s, 1.0 + s.dt);
    expect(mid.y).toBeCloseTo((a.y + b.y) / 2, 4);
    expect(sampleBall(s, -1).z).toBe(s.z[0]);
    expect(sampleBall(s, 999).z).toBe(s.z[s.count - 1]);
  });
});

describe('fence, wall and home runs', () => {
  it('fence is shortest at the poles and deepest in center', () => {
    expect(fenceDistance(0)).toBeGreaterThan(fenceDistance(30));
    expect(fenceDistance(30)).toBeGreaterThan(fenceDistance(45) - 0.001);
    expect(fenceDistance(-45)).toBeCloseTo(CONFIG.field.fencePoints[0][1], 5);
    expect(fenceDistance(0)).toBeCloseTo(390, 5);
    expect(fenceDistance(-20)).toBeCloseTo(fenceDistance(20), 5);
  });

  it('a hard, high fly ball is a home run and ends in the stands', () => {
    const s = simulateBattedBall({ exitVelocity: 106, launchAngle: 27, sprayAngle: -20, backspin: 2400 });
    expect(s.homerun).toBeTruthy();
    expect(s.homerun.y).toBeGreaterThan(CONFIG.field.fenceHeight);
    expect(s.standsLanding).toBeTruthy();
    expect(s.wallHit).toBeNull();
    expect(judgeFairFoul(s)).toBe(true);
  });

  it('a hard low liner hits the wall instead of clearing it', () => {
    const s = simulateBattedBall({ exitVelocity: 100, launchAngle: 9, sprayAngle: 10, backspin: 1200 });
    expect(s.homerun).toBeNull();
    expect(s.wallHit).toBeTruthy();
    // after hitting the wall it comes back toward the infield
    const k = s.count - 1;
    expect(Math.hypot(s.x[k], s.z[k])).toBeLessThan(Math.hypot(s.wallHit.x, s.wallHit.z));
  });

  it('a routine fly ball falls in the field', () => {
    const s = simulateBattedBall({ exitVelocity: 78, launchAngle: 35, sprayAngle: 0, backspin: 2600 });
    expect(s.homerun).toBeNull();
    expect(s.firstBounce).toBeTruthy();
    expect(!s.wallHit || s.wallHit.t > s.firstBounce.t).toBe(true); // (it comes down in the field - it may roll to the wall)
  });
});

describe('fair / foul', () => {
  it('fly ball inside the lines is fair, outside is foul', () => {
    expect(judgeFairFoul(simulateBattedBall({ exitVelocity: 80, launchAngle: 30, sprayAngle: 20, backspin: 0 }))).toBe(true);
    expect(judgeFairFoul(simulateBattedBall({ exitVelocity: 80, launchAngle: 30, sprayAngle: 55, backspin: 0 }))).toBe(false);
    expect(judgeFairFoul(simulateBattedBall({ exitVelocity: 80, launchAngle: 30, sprayAngle: -60, backspin: 0 }))).toBe(false);
  });

  it('a ball hit backward is foul', () => {
    expect(judgeFairFoul(simulateBattedBall({ exitVelocity: 60, launchAngle: 50, sprayAngle: 150, backspin: 0 }))).toBe(false);
  });

  it('a grounder that bounces foul before first base is foul, even if it rolls fair later', () => {
    // hit toward the line: starts near foul territory
    const s = simulateBattedBall({ exitVelocity: 70, launchAngle: -8, sprayAngle: 50, backspin: 0 });
    expect(judgeFairFoul(s)).toBe(false);
  });

  it('a grounder down the middle is fair', () => {
    expect(judgeFairFoul(simulateBattedBall({ exitVelocity: 80, launchAngle: -3, sprayAngle: 5, backspin: 0 }))).toBe(true);
  });

  it('isFairXZ is consistent with the base geometry', () => {
    expect(isFairXZ(BASE_XZ[1][0] - 0.01, BASE_XZ[1][1])).toBe(true);
    expect(isFairXZ(BASE_XZ[1][0] + 1, BASE_XZ[1][1])).toBe(false);
    expect(isFairXZ(0, 5)).toBe(false);
    const p = polar(44, 200);
    expect(isFairXZ(p.x, p.z)).toBe(true);
  });
});

describe('ball types', () => {
  it('classifies by launch angle', () => {
    expect(battedBallType(2)).toBe('ground');
    expect(battedBallType(15)).toBe('line');
    expect(battedBallType(35)).toBe('fly');
    expect(battedBallType(65)).toBe('pop');
  });
});

describe('ground-rule double', () => {
  it('a fair ball that bounces in the field and then goes over the wall is a ground-rule double, not a home run', async () => {
    const { createDefense, planPlay } = await import('../src/game/fielding.js');
    const { CONFIG } = await import('../src/config.js');
    let found = null;
    for (let sp = -44; sp <= 44 && !found; sp += 4) for (let la = -5; la <= 40 && !found; la += 1) for (let ev = 70; ev <= 120 && !found; ev += 2) {
      const c = { exitVelocity: ev, launchAngle: la, sprayAngle: sp, backspin: 900 + 55 * Math.max(la, 0), hook: 0 };
      const s = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
      if (s.groundRule && planPlay({ sim: s, contact: c, bases: [null, null, null], outs: 0, defense: createDefense() }, CONFIG).groundRule) found = { s, c };
    }
    expect(found).toBeTruthy(); // (one nobody catches before it bounces)
    expect(found.s.homerun).toBeNull();
    expect(found.s.firstBounce.t).toBeLessThan(found.s.groundRule.t);
    const plan = planPlay({ sim: found.s, contact: found.c, bases: ['a', null, 'c'], outs: 0, defense: createDefense() }, CONFIG);
    expect(plan.result).toBe('double');
    expect(plan.groundRule).toBe(true);
    expect(plan.homer).toBe(false);
    expect(plan.batterDest).toBe(2);
    expect(plan.moves.find((m) => m.from === 1).to).toBe(3); // (two bases: first to third, not home)
    expect(plan.moves.find((m) => m.from === 3).to).toBe(4);
  });
});
