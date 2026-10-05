import { describe, it, expect } from 'vitest';
import { CONFIG, DIFFICULTIES, PITCH_ORDER } from '../src/config.js';

describe('config sanity', () => {
  it('has every difficulty and pitch type defined', () => {
    for (const d of DIFFICULTIES) {
      expect(CONFIG.difficulty[d]).toBeTruthy();
      expect(CONFIG.difficulty[d].windowScale).toBeGreaterThan(0);
      const total = Object.values(CONFIG.difficulty[d].mix).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(0.99);
      expect(total).toBeLessThan(1.01);
    }
    for (const p of PITCH_ORDER) expect(CONFIG.pitch.types[p]).toBeTruthy();
  });

  it('timing windows are ordered', () => {
    const t = CONFIG.timing;
    expect(t.perfectMs).toBeLessThan(t.goodMs);
    expect(t.goodMs).toBeLessThan(t.earlyMs);
    expect(t.goodMs).toBeLessThan(t.lateMs);
  });

  it('the pitching screen has no break arc', () => {
    expect(Object.keys(CONFIG.pitchAim).filter((k) => k.startsWith('arc'))).toEqual([]);
  });
});
