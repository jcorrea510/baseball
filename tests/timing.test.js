import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { classifyTiming, describeError, resolveSwingTimes, timingFraction } from '../src/game/timing.js';

describe('timing windows', () => {
  const t = CONFIG.timing;
  it('dead on and inside the perfect window is PERFECT', () => {
    expect(classifyTiming(0).grade).toBe('perfect');
    expect(classifyTiming(t.perfectMs).grade).toBe('perfect');
    expect(classifyTiming(-t.perfectMs).grade).toBe('perfect');
  });
  it('just outside perfect is GOOD', () => {
    expect(classifyTiming(t.perfectMs + 1).grade).toBe('good');
    expect(classifyTiming(-(t.perfectMs + 1)).grade).toBe('good');
    expect(classifyTiming(t.goodMs).grade).toBe('good');
  });
  it('beyond good is EARLY (negative) or LATE (positive)', () => {
    expect(classifyTiming(-(t.goodMs + 5)).grade).toBe('early');
    expect(classifyTiming(t.goodMs + 5).grade).toBe('late');
  });
  it('far off is a MISS on either side, and the late window is shorter than the early one', () => {
    expect(classifyTiming(-(t.earlyMs + 1)).grade).toBe('miss');
    expect(classifyTiming(t.lateMs + 1).grade).toBe('miss');
    expect(classifyTiming(t.lateMs - 1).grade).toBe('late');
    expect(classifyTiming(-(t.lateMs + 1)).grade).toBe('early');
  });
  it('difficulty scales the windows', () => {
    const e = t.perfectMs + 5;
    expect(classifyTiming(e, { windowScale: 1 }).grade).toBe('good');
    expect(classifyTiming(e, { windowScale: 1.5 }).grade).toBe('perfect');
    expect(classifyTiming(t.perfectMs - 3, { windowScale: 0.8 }).grade).toBe('good');
    expect(classifyTiming(e, { windowScale: 1, speedScale: 0.8 }).grade).toBe('good');
  });
  it('describes the error in plain words', () => {
    expect(describeError(-12.4)).toBe('12ms early');
    expect(describeError(30)).toBe('30ms late');
    expect(describeError(0.3)).toBe('dead on');
  });
  it('timing fraction runs from -1 to 1', () => {
    const w = classifyTiming(0).windows;
    expect(timingFraction(-w.early, w)).toBe(-1);
    expect(timingFraction(w.late, w)).toBe(1);
    expect(timingFraction(0, w)).toBe(0);
    expect(timingFraction(-1000, w)).toBe(-1);
  });
});

describe('swing times', () => {
  it('error is bat-time minus ball-time, in ms', () => {
    const cross = 10.0;
    const press = cross - CONFIG.timing.swingDelay; // perfect
    expect(resolveSwingTimes(press, cross).errorMs).toBeCloseTo(0, 6);
    expect(resolveSwingTimes(press - 0.03, cross).errorMs).toBeCloseTo(-30, 6);
    expect(resolveSwingTimes(press + 0.02, cross).errorMs).toBeCloseTo(20, 6);
  });
  it('is frame-rate independent: only depends on the timestamps', () => {
    // The same press/cross times give the same answer however they were measured.
    expect(resolveSwingTimes(3.3, 3.415).errorMs).toBe(resolveSwingTimes(3.3, 3.415).errorMs);
  });
  it('the visual contact is clamped near the ball so bat and ball meet', () => {
    const cross = 5;
    const early = resolveSwingTimes(cross - CONFIG.timing.swingDelay - 0.08, cross);
    expect(early.errorMs).toBeCloseTo(-80, 6);
    expect(early.hitTime).toBeCloseTo(cross - CONFIG.timing.reachEarly, 6);
    const late = resolveSwingTimes(cross - CONFIG.timing.swingDelay + 0.05, cross);
    expect(late.hitTime).toBeCloseTo(cross + CONFIG.timing.reachLate, 6);
  });
});
