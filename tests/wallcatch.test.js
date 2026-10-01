// Fly balls near the wall: everything a fielder can reach is caught (warning-track catches included), he waits for the ball to come down
// to a height his glove can reach, and he only leaves the ground for a ball he can get no other way (up at the wall).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { fenceDistance } from '../src/physics/field.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { fielderAt } from '../src/game/playAudit.js';
import { leapHeight } from '../src/render/actors.js';
import { createRng } from '../src/util/rng.js';
import { wallFlies } from '../scripts/wallcatch.mjs';

const F = CONFIG.fielding;
const defense = createDefense();
const START = { x: 0, y: 2.6, z: -1 };
const plan = (ev, la, spray, def = defense) => {
  const c = { exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * la, hook: 0 };
  const sim = simulateBattedBall({ ...c, start: START });
  return { sim, plan: planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense: def }, CONFIG) };
};

describe('every catchable fly ball near the wall is caught', { timeout: 60000 }, () => {
  const r = wallFlies({ n: 700, band: 30, seed: 21 });

  it('catch rate on the balls a fielder can get to is 100% in the last 30 ft before the wall', () => {
    expect(r.n).toBe(700);
    expect(r.catchable).toBeGreaterThan(80);
    expect(r.caughtOfCatchable).toBe(r.catchable);
    expect(r.missed).toEqual([]);
  });

  it('...and in the warning track itself (the last 10 ft)', () => {
    const k = r.byDepth['0-10 ft'];
    expect(k.catchable).toBeGreaterThan(12);
    expect(k.caughtOfCatchable).toBe(k.catchable);
  });

  it('balls nobody can reach still drop (this is not a defense that catches everything)', () => {
    expect(r.uncatchable).toBeGreaterThan(r.n * 0.4);
    expect(r.caught).toBeLessThan(r.n * 0.6);
  });

  it('the same holds for fielders with random speed and reactions (every game has its own defense)', () => {
    for (const seed of [1, 2]) {
      const def = createDefense(CONFIG, createRng(seed));
      const q = wallFlies({ n: 150, band: 30, seed: 40 + seed, defense: def });
      expect(q.catchable).toBeGreaterThan(15);
      expect(q.missed).toEqual([]);
    }
  }, 30000);
});

describe('how a fly ball is caught', () => {
  it('a fielder who is there in time waits for the ball to come down: chest-to-head height, feet on the ground', () => {
    const heights = [];
    let leaps = 0, total = 0;
    const rng = createRng(6);
    for (let i = 0; i < 400; i++) {
      const { plan: p } = plan(rng.range(62, 100), rng.range(24, 60), rng.range(-40, 40));
      if (!p.caught || !p.fair) continue;
      total++;
      heights.push(p.catchPos.y);
      if (p.leap) leaps++;
    }
    expect(total).toBeGreaterThan(200);
    const median = heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)];
    expect(median).toBeLessThan(F.catchHeight + 0.6);
    expect(leaps).toBeLessThan(total * 0.1);
  });

  it('never above his reach, never asks for a jump higher than he can make, and a catch he can make standing has no leap', () => {
    const rng = createRng(7);
    let leapsSeen = 0;
    for (let i = 0; i < 1600; i++) {
      const { plan: p } = plan(rng.range(62, 106), rng.range(18, 62), rng.range(-42, 42));
      if (!p.caught) continue;
      expect(p.catchPos.y).toBeLessThanOrEqual(F.reachHeight + 1e-9);
      if (p.catchPos.y <= F.standReach + 0.3) expect(p.leap).toBe(null);
      else if (!p.fielderMoves[0].dive) {
        leapsSeen++;
        expect(p.leap.height).toBeCloseTo(p.catchPos.y - F.standReach, 6);
        expect(p.leap.height).toBeLessThanOrEqual(F.reachHeight - F.standReach + 1e-9);
      }
      // he is within glove reach of the ball when he catches it
      const at = fielderAt(p, defense, p.fielder, p.catchT);
      const dive = !!p.fielderMoves[0].dive; // (a diving fielder reaches further)
      expect(Math.hypot(at.x - p.catchPos.x, at.z - p.catchPos.z)).toBeLessThan(F.glove + (dive ? F.diveExtra : 0) + 0.8);
    }
    expect(leapsSeen).toBeGreaterThan(3);
  });

  it('at the wall he leaps: a deep drive he can only just get to is taken up high, right at the fence', () => {
    let seen = 0;
    for (let ev = 92; ev <= 104; ev += 1) for (let la = 26; la <= 44; la += 2) for (const spray of [-20, -8, 0, 8, 20]) {
      const { plan: p } = plan(ev, la, spray);
      if (!p.caught || !p.leap) continue;
      seen++;
      const wall = fenceDistance(spray);
      expect(Math.hypot(p.catchPos.x, p.catchPos.z)).toBeGreaterThan(wall - 60); // deep, near the fence
      expect(p.leap.height).toBeGreaterThan(0.3);
    }
    expect(seen).toBeGreaterThan(5);
  });
});

describe('the jump the picture draws', () => {
  it('is on the ground before and after, and at the top exactly at the catch', () => {
    const h = 2.0;
    const half = Math.sqrt(2 * h / 32.17);
    expect(leapHeight(h, 0)).toBeCloseTo(h, 9);
    expect(leapHeight(h, -half - 0.01)).toBe(0);
    expect(leapHeight(h, half + 0.01)).toBe(0);
    expect(leapHeight(h, -half * 0.5)).toBeCloseTo(h * 0.75, 6);
    expect(leapHeight(h, half * 0.5)).toBeCloseTo(h * 0.75, 6);
    let last = -1; // rising, then falling
    for (let dt = -half; dt <= 0; dt += half / 20) { const y = leapHeight(h, dt); expect(y).toBeGreaterThanOrEqual(last - 1e-9); last = y; }
  });

  it('a bigger jump takes longer (about 0.75 s for 2.5 ft)', () => {
    const air = (h) => 2 * Math.sqrt(2 * h / 32.17);
    expect(air(2.5)).toBeGreaterThan(air(1));
    expect(air(2.5)).toBeGreaterThan(0.7); expect(air(2.5)).toBeLessThan(0.8);
  });
});
