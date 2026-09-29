import { describe, it, expect } from 'vitest';
import { CONFIG, MPH } from '../src/config.js';
import { buildPitch, isStrike, zoneRatio } from '../src/physics/pitch.js';

const mk = (type, speed, target = { x: 0, y: 2.5 }, hand = 'R') => buildPitch({ type, speedMph: speed, target, hand });

describe('pitch flight', () => {
  it('crosses the plate exactly at the chosen target', () => {
    for (const type of ['fastball', 'changeup', 'curveball', 'slider', 'heater']) {
      const p = mk(type, 88, { x: 0.4, y: 2.1 });
      const at = p.at(p.T);
      expect(at.x).toBeCloseTo(0.4, 5);
      expect(at.y).toBeCloseTo(2.1, 5);
      expect(at.z).toBeCloseTo(CONFIG.pitch.contactZ, 5);
    }
  });

  it('starts at the release point', () => {
    const p = mk('fastball', 90);
    const s = p.at(0);
    expect(s.z).toBeCloseTo(CONFIG.pitch.releaseZ, 5);
    expect(s.y).toBeCloseTo(p.release.y, 5);
  });

  it('a 90 mph fastball takes about 0.42-0.47 s to arrive', () => {
    const p = mk('fastball', 90);
    expect(p.T).toBeGreaterThan(0.41);
    expect(p.T).toBeLessThan(0.48);
  });

  it('slower pitches take longer', () => {
    expect(mk('fastball', 65).T).toBeGreaterThan(mk('fastball', 95).T);
    expect(mk('changeup', 78).T).toBeGreaterThan(mk('fastball', 90).T);
  });

  it('plate speed is a bit below release speed', () => {
    const p = mk('fastball', 90);
    expect(p.plateSpeedMph).toBeLessThan(90);
    expect(p.plateSpeedMph).toBeGreaterThan(80);
  });

  it('curveball drops more than a fastball on the way in (mid-flight height)', () => {
    const fb = mk('fastball', 88);
    const cb = mk('curveball', 71);
    // Compare the height at 80% of the way against the height at the plate: the curve falls farther.
    const dropFb = fb.at(fb.T * 0.75).y - fb.at(fb.T).y;
    const dropCb = cb.at(cb.T * 0.75).y - cb.at(cb.T).y;
    expect(dropCb).toBeGreaterThan(dropFb);
  });

  it('movement is smooth: no sideways jumps between frames', () => {
    const p = mk('slider', 82, { x: 0.3, y: 2.3 });
    let prev = p.at(0);
    const dt = 1 / 240;
    for (let t = dt; t <= p.T; t += dt) {
      const cur = p.at(t);
      const step = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
      expect(step).toBeLessThan(0.75); // ~ 180 ft/s worst case per 1/240 s
      prev = cur;
    }
  });

  it('a right-hander slider breaks to the glove side (+x) and the fastball runs arm side (-x)', () => {
    // Look at the launch direction: aiming point vs. arrival.
    const sl = mk('slider', 82, { x: 0, y: 2.5 }, 'R');
    const fb = mk('fastball', 90, { x: 0, y: 2.5 }, 'R');
    // Sideways acceleration sign: slider pushes +x, fastball pushes -x
    expect(sl.accel.x).toBeGreaterThan(0);
    expect(fb.accel.x).toBeLessThan(0);
    // Left-handers mirror it
    const slL = mk('slider', 82, { x: 0, y: 2.5 }, 'L');
    expect(slL.accel.x).toBeLessThan(0);
    expect(slL.release.x).toBeGreaterThan(0);
  });

  it('catch happens after the plate crossing', () => {
    const p = mk('fastball', 90);
    expect(p.tCatch).toBeGreaterThan(p.T);
    expect(p.tCatch - p.T).toBeLessThan(0.05);
    expect(p.at(p.tCatch).z).toBeCloseTo(CONFIG.pitch.catchZ, 3);
  });

  it('never goes underground', () => {
    const p = mk('curveball', 70, { x: 0, y: 0.3 });
    for (let t = 0; t <= p.tCatch; t += 0.01) expect(p.at(t).y).toBeGreaterThanOrEqual(CONFIG.physics.ballRadius - 1e-9);
  });

  it('velocity is consistent with the position derivative', () => {
    const p = mk('curveball', 72);
    const t = p.T * 0.5, h = 1e-5;
    const a = p.at(t - h), b = p.at(t + h), v = p.velocity(t);
    expect((b.x - a.x) / (2 * h)).toBeCloseTo(v.x, 3);
    expect((b.y - a.y) / (2 * h)).toBeCloseTo(v.y, 3);
    expect((b.z - a.z) / (2 * h)).toBeCloseTo(v.z, 3);
    expect(v.z).toBeGreaterThan(60 * MPH);
  });
});

describe('strike zone', () => {
  it('calls the middle a strike and clear misses balls', () => {
    expect(isStrike(0, 2.5)).toBe(true);
    expect(isStrike(0.7, 2.5)).toBe(true);
    expect(isStrike(1.2, 2.5)).toBe(false);
    expect(isStrike(0, 0.8)).toBe(false);
    expect(isStrike(0, 4.2)).toBe(false);
  });
  it('zoneRatio is 0 in the middle and about 1 at the edge', () => {
    expect(zoneRatio(0, CONFIG.timing.zoneCenterY)).toBeCloseTo(0, 5);
    expect(zoneRatio(CONFIG.pitch.zoneHalfWidth, CONFIG.timing.zoneCenterY)).toBeCloseTo(1, 5);
  });
});
