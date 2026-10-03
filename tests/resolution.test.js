import { describe, it, expect } from 'vitest';
import { createResolution } from '../src/render/resolution.js';
import { CONFIG } from '../src/config.js';

const Q = CONFIG.quality;

// Feed `seconds` of frames that each take `ms`; returns the ratio at the end.
function run(res, ms, seconds, max = 2) {
  for (let t = 0; t < seconds; t += ms / 1000) res.sample(ms, max);
  return res.ratio;
}

describe('adaptive resolution', () => {
  it('starts at the sharpest allowed', () => {
    expect(createResolution(2).ratio).toBe(2);
  });

  it('a phone at a steady 60 frames a second stays sharp', () => {
    expect(run(createResolution(2), 16.7, 30)).toBe(2);
  });

  it('one long hiccup (a park loading, a hidden tab) does not lower it', () => {
    const res = createResolution(2);
    run(res, 16.7, 2);
    res.sample(2500, 2);
    expect(run(res, 16.7, 10)).toBe(2);
  });

  it('a phone that is really too slow drops, then climbs back once it is smooth', () => {
    const res = createResolution(2);
    // A frame's cost follows the number of dots drawn: too slow at full resolution, fine one step down.
    for (let t = 0; t < 15; t += 0.02) res.sample(28 * (res.ratio / 2) ** 2, 2);
    expect(res.ratio).toBeLessThan(2);
    expect(res.ratio).toBeGreaterThanOrEqual(Q.minPixelRatio);
    const low = res.ratio;
    expect(run(res, 16.7, 15)).toBeGreaterThan(low);
    expect(res.ratio).toBe(2);
  });

  it('a phone locked at 30 frames a second (battery saver) is not made blurry', () => {
    const res = createResolution(2);
    for (let t = 0; t < 60; t += 1 / 30) {
      res.sample(33.3, 2);
      // Fewer pixels never help: the drop must be undone within one check.
      if (t > 3) expect(res.ratio).toBeGreaterThanOrEqual(2 * Q.stepDown - 1e-9);
    }
    expect(res.ratio).toBe(2);
  });

  it('never goes under the floor - and a plain 1x screen can still step down when it is too slow', () => {
    const res = createResolution(2);
    for (let t = 0; t < 120; t += 0.05) res.sample(res.ratio > Q.minPixelRatio ? 45 : 15, 2);
    expect(res.ratio).toBeGreaterThanOrEqual(Q.minPixelRatio - 1e-9);
    const one = createResolution(1);
    for (let t = 0; t < 30; t += 0.03) one.sample(28 * one.ratio ** 2, 1); // (a frame costs what its dots cost)
    expect(one.ratio).toBeLessThan(1);
    expect(one.ratio).toBeGreaterThanOrEqual(Q.minShare - 1e-9);
  });

  it('phones draw at least 2 dots per point and smooth edges', () => {
    expect(Q.maxPixelRatioMobile).toBeGreaterThanOrEqual(2);
    expect(Q.minPixelRatio).toBeGreaterThanOrEqual(1);
  });
});
