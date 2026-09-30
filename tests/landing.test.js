// The landing spot ring: exact spot, shrinks as the ball falls, smallest when it lands, gone when it lands or is caught.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall, sampleBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { landingSpot, landingRing } from '../src/game/landing.js';
import { DEFAULT_SAVE } from '../src/game/progression.js';
import { createRng } from '../src/util/rng.js';

const defense = createDefense();
const hit = (ev, la, spray, o = {}) => {
  const c = { exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: o.hook ?? 0 };
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const plan = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, CONFIG);
  return { sim, plan, spot: landingSpot(sim, plan) };
};
const L = CONFIG.landing;

describe('when there is a ring', () => {
  it('a fly ball gets one; a grounder, a low liner and a home run do not', () => {
    expect(hit(90, 32, 5).spot).not.toBe(null); // a high fly
    expect(hit(60, 65, -8).spot).not.toBe(null); // a pop-up
    expect(hit(70, -3, 5).spot).toBe(null); // grounder
    expect(hit(95, 6, 0).spot).toBe(null); // a low line drive: never gets high enough
    expect(hit(105, 30, 0).plan.homer).toBe(true);
    expect(hit(105, 30, 0).spot).toBe(null); // home run: it lands in the stands
  });

  it('a ball that hits the wall on the fly never lands on the grass, so no ring', () => {
    let wall = 0;
    for (const spray of [-30, -20, -10, 0, 10, 20, 30]) for (let la = 12; la <= 30; la += 3) for (let ev = 88; ev <= 104; ev += 4) {
      const { sim, spot, plan } = hit(ev, la, spray);
      if (sim.wallHit && !plan.homer && sim.wallHit.t < (sim.firstBounce ? sim.firstBounce.t : Infinity)) { wall++; expect(spot).toBe(null); }
    }
    expect(wall).toBeGreaterThan(3);
  });

  it('foul fly balls get a ring too (it shows where the ball will come down, fair or not)', () => {
    const r = hit(80, 45, -60);
    expect(r.plan.fair).toBe(false);
    expect(r.spot).not.toBe(null);
  });
});

describe('where the ring is', () => {
  it('is exactly where the flight ends: where the ball first touches the grass, or under the catch when a fielder takes it', () => {
    const rng = createRng(12);
    let landed = 0, caught = 0;
    for (let i = 0; i < 400; i++) {
      const { sim, spot, plan } = hit(rng.range(60, 104), rng.range(14, 70), rng.range(-40, 40));
      if (!spot) continue;
      if (spot.caught) {
        caught++;
        expect(spot.x).toBe(plan.catchPos.x); expect(spot.z).toBe(plan.catchPos.z);
        const b = sampleBall(sim, spot.tEnd); // the ball is right above the ring at the catch
        expect(Math.hypot(b.x - spot.x, b.z - spot.z)).toBeLessThan(0.6);
        continue;
      }
      landed++;
      expect(spot.x).toBe(sim.firstBounce.x); expect(spot.z).toBe(sim.firstBounce.z);
      // walking the flight ball by ball: the last moment it is in the air is right before tLand, and it is at the ring
      const b = sampleBall(sim, spot.tLand);
      expect(Math.hypot(b.x - spot.x, b.z - spot.z)).toBeLessThan(0.6);
      expect(b.y).toBeLessThan(0.6);
      const before = sampleBall(sim, spot.tLand - 0.2);
      expect(before.y).toBeGreaterThan(0.3);
    }
    expect(landed).toBeGreaterThan(40);
    expect(caught).toBeGreaterThan(40);
  });
});

describe('how the ring looks', () => {
  const { spot } = hit(88, 38, 12);
  it('appears after a moment, fades in, shrinks all the way down and is smallest when the ball lands', () => {
    expect(spot).not.toBe(null);
    expect(landingRing(spot, 0.1).visible).toBe(false); // the ball has only just left the bat
    expect(landingRing(spot, spot.tStart - 0.01).visible).toBe(false);
    const first = landingRing(spot, spot.tStart + 0.001);
    expect(first.visible).toBe(true);
    expect(first.alpha).toBeLessThan(0.05); // fading in
    expect(first.radius).toBeGreaterThan(L.radiusStart - 0.3);
    let last = Infinity;
    for (let t = spot.tStart + 0.01; t < spot.tEnd; t += 0.05) {
      const r = landingRing(spot, t);
      expect(r.radius).toBeLessThan(last + 1e-9); last = r.radius;
      expect(r.alpha).toBeLessThanOrEqual(L.alpha + 1e-9);
    }
    expect(landingRing(spot, spot.tEnd - 0.02).radius).toBeLessThan(L.radiusEnd + 0.15 * (L.radiusStart - L.radiusEnd) * 0.1 + 0.3);
    expect(landingRing(spot, spot.tEnd - 0.5).alpha).toBeCloseTo(L.alpha, 2); // fully faded in well before the end
    expect(landingRing(spot, spot.tEnd).visible).toBe(false); // gone the moment the ball lands
    expect(landingRing(spot, spot.tEnd + 1).visible).toBe(false);
  });

  it('is gone the moment a fielder catches the ball (before it lands), still on its way down', () => {
    let seen = 0;
    for (let ev = 70; ev <= 96; ev += 2) for (const la of [28, 34, 40, 50]) {
      const { plan, spot: s } = hit(ev, la, 3);
      if (!plan.caught || !s) continue;
      seen++;
      expect(s.caught).toBe(true);
      expect(s.tEnd).toBeCloseTo(plan.catchT, 6);
      expect(s.tEnd).toBeLessThanOrEqual(s.tLand + 1e-6);
      expect(landingRing(s, s.tEnd - 0.01).visible).toBe(true);
      expect(landingRing(s, s.tEnd).visible).toBe(false);
      if (s.tEnd < s.tLand - 0.2) expect(landingRing(s, s.tEnd - 0.01).radius).toBeGreaterThan(L.radiusEnd + 0.2); // the ring is sized by when the ball would land
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('is off for a ball that is not landing on grass, and the setting is on by default', () => {
    expect(landingRing(null, 1).visible).toBe(false);
    expect(DEFAULT_SAVE().settings.landingRing).toBe(true);
  });
});
