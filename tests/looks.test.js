// How the players look (game/looks.js): the real players' table, generated looks from a name, the defense from a lineup.
import { describe, it, expect } from 'vitest';
import { lookOf, realLook, realNames, generatedLook, skinHex, umpireLook, fieldersFrom, BEARDS } from '../src/game/looks.js';
import { MLB_TEAMS, starsOf, armsOf } from '../src/game/mlb.js';
import { CONFIG } from '../src/config.js';

describe('looks', () => {
  it('every real star and arm in the League has a row in the look table', () => {
    const missing = [];
    for (const t of MLB_TEAMS) {
      for (const s of t.stars) if (!realLook(s[0])) missing.push(s[0]);
      for (const a of t.arms) if (!realLook(a[0])) missing.push(a[0]);
    }
    expect(missing).toEqual([]);
  });

  it('table rows are sane: tone 1-10, a known beard and hair colour', () => {
    for (const n of realNames()) {
      const l = realLook(n);
      expect(l.tone).toBeGreaterThanOrEqual(1);
      expect(l.tone).toBeLessThanOrEqual(10);
      expect(BEARDS).toContain(l.beard);
      expect(CONFIG.looks.hair[l.hairCode]).toBeTruthy();
    }
  });

  it('no two real players on a club wear the same number', () => {
    const clashes = [];
    for (const t of MLB_TEAMS) {
      const seen = new Map();
      for (const p of [...starsOf(t), ...armsOf(t)]) {
        if (!p.real) continue;
        const l = realLook(p.name);
        if (!l || l.number == null) continue;
        if (seen.has(l.number)) clashes.push(`${t.abbr} #${l.number}: ${seen.get(l.number)} / ${p.name}`);
        seen.set(l.number, p.name);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('a real star wears his real number', () => {
    const nyy = MLB_TEAMS.find((t) => t.id === 'nyy');
    expect(starsOf(nyy).find((p) => p.name === 'Aaron Judge').number).toBe(99);
  });

  it('the same name always looks the same; looks are complete', () => {
    const a = lookOf({ name: 'J. Tanaka' }), b = lookOf({ name: 'J. Tanaka' });
    expect(a).toEqual(b);
    for (const l of [a, lookOf({ name: 'Aaron Judge' }), lookOf({}), umpireLook()]) {
      expect(l.skin).toMatch(/^#[0-9a-f]{6}$/);
      expect(l.hair).toMatch(/^#[0-9a-f]{6}$/);
      expect(BEARDS).toContain(l.beard);
      expect(l.face).toBeGreaterThanOrEqual(0);
      expect(l.face).toBeLessThanOrEqual(1);
    }
  });

  it('generated players are varied: many skin tones and every facial hair style', () => {
    const tones = new Set(), beards = new Set();
    for (let i = 0; i < 400; i++) { const l = generatedLook('Player ' + i); tones.add(Math.round(l.tone)); beards.add(l.beard); }
    expect(tones.size).toBeGreaterThanOrEqual(7);
    expect(beards.size).toBe(BEARDS.length);
  });

  it('skin tones run light to deep', () => {
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
    for (let t = 1; t < 10; t++) expect(lum(skinHex(t))).toBeGreaterThan(lum(skinHex(t + 1)));
  });

  it('the defense: everyone at his own position, the rest fill the gaps', () => {
    const lineup = [{ name: 'a', pos: 'SS' }, { name: 'b', pos: 'DH' }, { name: 'c', pos: 'C' }, { name: 'd' }, { name: 'e', pos: 'SS' }];
    const d = fieldersFrom(lineup);
    expect(d.SS.name).toBe('a');
    expect(d.C.name).toBe('c');
    expect(Object.values(d).map((p) => p.name).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
