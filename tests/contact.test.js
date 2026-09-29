import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { computeContact } from '../src/game/contact.js';
import { createRng } from '../src/util/rng.js';

const mid = { locX: 0, locY: CONFIG.timing.zoneCenterY, pitchSpeed: 88 };
const run = (o, n = 200, seed = 7) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => computeContact({ ...mid, rng, ...o }));
};
const avg = (arr, f) => arr.reduce((a, b) => a + f(b), 0) / arr.length;

describe('contact model', () => {
  it('perfect timing in the middle of the zone is a hard-hit ball', () => {
    const rs = run({ errorMs: 0 });
    expect(rs.every((r) => r.made && r.grade === 'perfect')).toBe(true);
    expect(avg(rs, (r) => r.exitVelocity)).toBeGreaterThan(100);
    expect(avg(rs, (r) => r.launchAngle)).toBeGreaterThan(16);
    expect(avg(rs, (r) => r.launchAngle)).toBeLessThan(30);
  });

  it('weaker timing means weaker contact', () => {
    const p = avg(run({ errorMs: 0 }), (r) => r.exitVelocity);
    const g = avg(run({ errorMs: 40 }), (r) => r.exitVelocity);
    const w = avg(run({ errorMs: -80 }), (r) => r.exitVelocity);
    expect(p).toBeGreaterThan(g + 8);
    expect(g).toBeGreaterThan(w + 12);
  });

  it('way off timing is a miss', () => {
    expect(run({ errorMs: 200 }, 5).every((r) => !r.made)).toBe(true);
    expect(run({ errorMs: -200 }, 5).every((r) => !r.made)).toBe(true);
  });

  it('pitches far outside the zone cannot be reached', () => {
    const r = computeContact({ ...mid, locX: 2.0, errorMs: 0, rng: createRng(1) });
    expect(r.made).toBe(false);
    expect(r.reason).toBe('reach');
    const dirt = computeContact({ ...mid, locY: 0.4, errorMs: 0, rng: createRng(1) });
    expect(dirt.made).toBe(false);
  });

  it('chasing a pitch just off the plate is capped at weak contact', () => {
    const rs = run({ errorMs: 0, locX: 1.05 });
    expect(rs.every((r) => r.made)).toBe(true);
    expect(rs.every((r) => r.grade !== 'perfect')).toBe(true);
    expect(avg(rs, (r) => r.exitVelocity)).toBeLessThan(85);
  });

  it('right-handed batters pull early swings toward left field (negative spray), oppo when late', () => {
    expect(avg(run({ errorMs: -40, batterHand: 'R' }), (r) => r.sprayAngle)).toBeLessThan(-8);
    expect(avg(run({ errorMs: 40, batterHand: 'R' }), (r) => r.sprayAngle)).toBeGreaterThan(8);
    expect(avg(run({ errorMs: -40, batterHand: 'L' }), (r) => r.sprayAngle)).toBeGreaterThan(8);
  });

  it('aim steers the ball but not more than the config allows', () => {
    const left = avg(run({ errorMs: 0, aim: -1 }), (r) => r.sprayAngle);
    const right = avg(run({ errorMs: 0, aim: 1 }), (r) => r.sprayAngle);
    expect(left).toBeLessThan(-8);
    expect(right).toBeGreaterThan(8);
    expect(right - left).toBeLessThan(CONFIG.contact.spray.aimMax * 2 + 3);
  });

  it('big timing errors often produce foul-line or foul angles', () => {
    const rs = run({ errorMs: -74 });
    expect(rs.filter((r) => Math.abs(r.sprayAngle) > 45).length).toBeGreaterThan(rs.length * 0.5);
  });

  it('low pitches are hit higher than high pitches', () => {
    const low = avg(run({ errorMs: 0, locY: 1.8 }), (r) => r.launchAngle);
    const high = avg(run({ errorMs: 0, locY: 3.2 }), (r) => r.launchAngle);
    expect(low).toBeGreaterThan(high + 5);
  });

  it('faster pitches jump off the bat faster', () => {
    const slow = avg(run({ errorMs: 0, pitchSpeed: 60 }), (r) => r.exitVelocity);
    const fast = avg(run({ errorMs: 0, pitchSpeed: 100 }), (r) => r.exitVelocity);
    expect(fast).toBeGreaterThan(slow + 3);
  });

  it('never exceeds the physical limits', () => {
    for (const r of run({ errorMs: 0 }, 500, 99)) {
      expect(r.exitVelocity).toBeLessThanOrEqual(CONFIG.contact.maxExitVelocity + 4.01);
      expect(r.exitVelocity).toBeGreaterThanOrEqual(CONFIG.contact.exitVelocityFloor);
    }
  });
});
