// The League's real arms: every club's three starters and two relievers, rated from last season's lines.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { MLB_TEAMS, armsOf, allArms, pitcherRatings, armPlayer } from '../src/game/mlb.js';
import { overall } from '../src/game/season.js';

const row = (o = {}) => ['Test Arm', o.role || 'SP', 'R', 3.5, o.k9 ?? 9, o.bb9 ?? 3, o.velo ?? 95, ['fastball', 'slider', 'changeup'], o.ip ?? 160];

describe('real arms for every club', () => {
  it('every club has exactly three starters and two relievers, rated 1-99, throwing only the game\'s pitch types', () => {
    const ids = new Set();
    for (const t of MLB_TEAMS) {
      const arms = armsOf(t);
      expect(arms.filter((p) => p.role === 'SP').length).toBe(3);
      expect(arms.filter((p) => p.role === 'RP').length).toBe(2);
      expect(arms.length).toBe(5);
      for (const p of arms) {
        for (const k of ['vel', 'ctl', 'stf', 'sta']) { expect(Number.isInteger(p[k])).toBe(true); expect(p[k]).toBeGreaterThanOrEqual(1); expect(p[k]).toBeLessThanOrEqual(99); }
        expect(p.pitches.length).toBeGreaterThanOrEqual(2);
        for (const ty of p.pitches) expect(Object.keys(CONFIG.pitch.types)).toContain(ty);
        expect(new Set(p.pitches).size).toBe(p.pitches.length);
        expect(p.pitches.some((ty) => ty === 'fastball' || ty === 'sinker')).toBe(true); // everyone has a fastball or a sinker
        if (p.role === 'SP') { expect(p.pitches.length).toBeLessThanOrEqual(4); expect(p.pitches).not.toContain('heater'); }
        else expect(p.pitches.length).toBeLessThanOrEqual(3);
        expect(['L', 'R']).toContain(p.hand);
        expect(typeof p.name).toBe('string');
        expect(ids.has(p.id)).toBe(false);
        ids.add(p.id);
      }
      expect(new Set(arms.map((p) => p.name)).size).toBe(5);
    }
    expect(ids.size).toBe(150);
  });

  it('the table rows are real lines: sensible numbers, the heater only for a reliever averaging 98+', () => {
    for (const t of MLB_TEAMS) {
      expect(Array.isArray(t.arms)).toBe(true);
      expect(t.arms.filter((r) => r[1] === 'SP').length).toBeLessThanOrEqual(3);
      expect(t.arms.filter((r) => r[1] === 'RP').length).toBeLessThanOrEqual(2);
      for (const [name, role, throws, era, k9, bb9, velo, pitches, ip] of t.arms) {
        expect(name.length).toBeGreaterThan(3);
        expect(['SP', 'RP']).toContain(role);
        expect(['L', 'R']).toContain(throws);
        expect(era).toBeGreaterThan(0.5); expect(era).toBeLessThan(8);
        expect(k9).toBeGreaterThan(4); expect(k9).toBeLessThan(16);
        expect(bb9).toBeGreaterThan(0.5); expect(bb9).toBeLessThan(6);
        expect(velo).toBeGreaterThan(80); expect(velo).toBeLessThan(102);
        expect(ip).toBeGreaterThan(20); expect(ip).toBeLessThan(230);
        if (pitches.includes('heater')) { expect(role).toBe('RP'); expect(velo).toBeGreaterThanOrEqual(98); }
      }
    }
    // most clubs are all real names
    expect(MLB_TEAMS.filter((t) => t.arms.length === 5).length).toBeGreaterThanOrEqual(20);
  });

  it('real arms carry their line; a generated arm fills a short club and is rated by its tier', () => {
    const t = MLB_TEAMS.find((x) => x.arms.length === 5);
    const p = armsOf(t)[0];
    expect(p.id).toBe(`${t.id}-p0`);
    expect(p.real).toEqual({ era: t.arms[0][3], k9: t.arms[0][4], bb9: t.arms[0][5], velo: t.arms[0][6], ip: t.arms[0][8] });
    expect(p).toMatchObject(pitcherRatings(t.arms[0]));
    expect(armPlayer(t, t.arms[0], 0)).toEqual(p);
    const short = MLB_TEAMS.find((x) => x.arms.length < 5);
    if (short) {
      const arms = armsOf(short);
      const gen = arms.filter((a) => !a.real);
      expect(gen.length).toBe(5 - short.arms.length);
      expect(armsOf(short)).toEqual(arms); // the same every time
    }
    // allArms: every club's real arms
    expect(allArms().length).toBe(MLB_TEAMS.reduce((n, x) => n + x.arms.length, 0));
    expect(allArms().every((a) => a.real)).toBe(true);
  });

  it('the line decides the ratings', () => {
    expect(pitcherRatings(row({ velo: 98 })).vel).toBeGreaterThan(pitcherRatings(row({ velo: 93 })).vel);
    expect(pitcherRatings(row({ bb9: 1.8 })).ctl).toBeGreaterThan(pitcherRatings(row({ bb9: 3.8 })).ctl);
    expect(pitcherRatings(row({ k9: 11.5 })).stf).toBeGreaterThan(pitcherRatings(row({ k9: 7.5 })).stf);
    expect(pitcherRatings(row({ ip: 200 })).sta).toBeGreaterThan(pitcherRatings(row({ ip: 120 })).sta);
    expect(pitcherRatings(row({ role: 'SP', ip: 70 })).sta).toBeGreaterThan(pitcherRatings(row({ role: 'RP', ip: 70 })).sta);
    const R = CONFIG.season.realArms;
    expect(pitcherRatings(row({ velo: R.velo.from[0] })).vel).toBe(R.velo.to[0]);
    expect(pitcherRatings(row({ velo: R.velo.from[1] })).vel).toBe(R.velo.to[1]);
  });

  it('overall works for pitchers and is unchanged for hitters', () => {
    expect(overall({ con: 80, pow: 60, spd: 50 })).toBe(Math.round(0.4 * 80 + 0.4 * 60 + 0.2 * 50));
    expect(overall({ role: 'SP', vel: 80, ctl: 60, stf: 70, sta: 90 })).toBe(Math.round(0.3 * 80 + 0.3 * 60 + 0.3 * 70 + 0.1 * 90));
    for (const t of MLB_TEAMS) for (const p of armsOf(t)) { expect(overall(p)).toBeGreaterThanOrEqual(1); expect(overall(p)).toBeLessThanOrEqual(99); }
  });
});
