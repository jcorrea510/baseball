import { describe, it, expect } from 'vitest';
import { Progress, DEFAULT_SAVE, UNLOCKS } from '../src/game/progression.js';
import { CONFIG } from '../src/config.js';

const memStore = () => { const m = {}; return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; }, m }; };
const stats = (o = {}) => ({ pa: 4, ab: 4, hits: 2, hr: 1, rbi: 2, perfect: 3, swings: 10, contacts: 7, strikeouts: 1, walks: 0, maxEV: 104, longestHR: 401, ...o });
const quickResult = (o = {}) => ({ mode: 'quick', difficulty: 'pro', won: true, stats: stats(o.stats), game: { score: { top: 5, bottom: 2 }, winner: 'top' }, ...o });

describe('saved progress', () => {
  it('starts with defaults and the basic bat and uniform unlocked', () => {
    const p = new Progress(memStore());
    expect(p.data.unlocked.bats).toEqual(['ash']);
    expect(p.data.unlocked.uniforms).toEqual(['classic']);
    expect(p.settings.difficulty).toBe('pro');
  });

  it('remembers settings and stats between sessions', () => {
    const store = memStore();
    const a = new Progress(store);
    a.updateSettings({ difficulty: 'allstar', tod: 'night' });
    a.recordGame(quickResult());
    const b = new Progress(store);
    expect(b.settings.difficulty).toBe('allstar');
    expect(b.settings.tod).toBe('night');
    expect(b.data.career.hits).toBe(2);
    expect(b.data.career.games).toBe(1);
    expect(b.data.career.wins).toBe(1);
  });

  it('drops a league saved before the big-league teams (it cannot be carried over) but keeps everything else', () => {
    const store = memStore();
    store.set(CONFIG.storageKey, JSON.stringify({ career: { hits: 7 }, season: { v: 1, teams: [{ id: 'sandlot' }] } }));
    const p = new Progress(store);
    expect(p.data.season).toBe(null);
    expect(p.data.career.hits).toBe(7);
    store.set(CONFIG.storageKey, JSON.stringify({ season: { v: 2, teams: [{ id: 'nym' }] } }));
    expect(new Progress(store).data.season.v).toBe(2);
  });

  it('survives storage that throws (private windows)', () => {
    const bad = { get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); } };
    const p = new Progress(bad);
    expect(() => { p.updateSettings({ zone: false }); p.recordGame(quickResult()); }).not.toThrow();
    expect(p.data.career.hits).toBe(2);
  });

  it('ignores corrupted saved data', () => {
    const store = memStore();
    store.set(CONFIG.storageKey, '{not json');
    expect(() => new Progress(store)).not.toThrow();
    const p = new Progress(store);
    expect(p.data.career.hr).toBe(0);
  });

  it('merges older saves with new default fields', () => {
    const store = memStore();
    store.set(CONFIG.storageKey, JSON.stringify({ v: 1, career: { hits: 7 } }));
    const p = new Progress(store);
    expect(p.data.career.hits).toBe(7);
    expect(p.data.career.hr).toBe(0);
    expect(p.data.settings.difficulty).toBe('pro');
  });

  it('tracks the longest home run and best exit velocity and reports new records', () => {
    const p = new Progress(memStore());
    p.recordGame(quickResult({ stats: { longestHR: 380, maxEV: 100 } }));
    const r = p.recordGame(quickResult({ stats: { longestHR: 430, maxEV: 108 } }));
    expect(p.data.career.longestHR).toBe(430);
    expect(p.data.career.maxEV).toBe(108);
    expect(r.records.some((t) => t.includes('430'))).toBe(true);
  });

  it('records Derby bests', () => {
    const p = new Progress(memStore());
    p.recordGame({ mode: 'derby', difficulty: 'pro', stats: stats({ hr: 6 }), derby: { hr: 6, bestStreak: 4, longest: 420 } });
    expect(p.data.career.derbyBestHR).toBe(6);
    expect(p.data.career.derbyBestStreak).toBe(4);
    expect(p.data.high.derby.pro).toBe(6);
    p.recordGame({ mode: 'derby', difficulty: 'pro', stats: stats({ hr: 2 }), derby: { hr: 3, bestStreak: 1, longest: 350 } });
    expect(p.data.career.derbyBestHR).toBe(6);
  });

  it('unlocks cosmetics when milestones are reached, once', () => {
    const p = new Progress(memStore());
    const first = p.recordGame(quickResult({ stats: { hits: 6, hr: 1 } }));
    const names = first.unlocked.map((u) => u.name);
    expect(names).toContain('Road Grays'); // 1 game
    expect(names).toContain('Maple Blonde'); // 5 hits
    expect(names).toContain('Neon Lightning'); // first win
    expect(p.isUnlocked('bats', 'maple')).toBe(true);
    const again = p.recordGame(quickResult({ stats: { hits: 0, hr: 0 } }));
    expect(again.unlocked.map((u) => u.name)).not.toContain('Road Grays');
  });

  it('only equips things that are unlocked', () => {
    const p = new Progress(memStore());
    expect(p.equip('bats', 'golden')).toBe(false);
    expect(p.data.equipped.bat).toBe('ash');
    p.data.unlocked.bats.push('cherry');
    expect(p.equip('bats', 'cherry')).toBe(true);
    expect(p.data.equipped.bat).toBe('cherry');
  });

  it('every milestone has a hint and unique target', () => {
    const seen = new Set();
    for (const u of UNLOCKS) {
      expect(u.hint.length).toBeGreaterThan(3);
      const k = u.kind + ':' + (u.key || u.id);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(DEFAULT_SAVE().v).toBe(1);
  });

  it('computes the batting average', () => {
    const p = new Progress(memStore());
    expect(p.average()).toBe(0);
    p.recordGame(quickResult({ stats: { ab: 10, hits: 4 } }));
    expect(p.average()).toBeCloseTo(0.4, 5);
  });
});

describe('reset stats', () => {
  it('clears career stats and high scores but keeps settings and unlocked items', () => {
    const p = new Progress(memStore());
    p.updateSettings({ difficulty: 'allstar', umpireVolume: 0.3 });
    p.recordGame(quickResult({ stats: { hits: 6, hr: 1 } }));
    p.equip('bats', 'maple');
    p.resetStats();
    expect(p.data.career.hits).toBe(0);
    expect(p.data.career.games).toBe(0);
    expect(p.data.high.quick.pro).toBe(null);
    expect(p.settings.difficulty).toBe('allstar');
    expect(p.settings.umpireVolume).toBe(0.3);
    expect(p.isUnlocked('bats', 'maple')).toBe(true);
    expect(p.data.equipped.bat).toBe('maple');
  });

  it('gives old saves the new sound and screen settings', () => {
    const store = memStore();
    store.set(CONFIG.storageKey, JSON.stringify({ v: 1, settings: { volume: 0.5 } }));
    const p = new Progress(store);
    expect(p.settings.volume).toBe(0.5);
    expect(p.settings.sfxVolume).toBe(1);
    expect(p.settings.umpireVolume).toBe(1);
    expect(p.settings.crowdVolume).toBe(1);
    expect(p.settings.flashes).toBe(true);
    expect(p.settings.inputDelayMs).toBe(0);
  });
});

describe('first visit', () => {
  it('knows whether anything was saved before', () => {
    const store = memStore();
    expect(new Progress(store).fresh).toBe(true);
    new Progress(store).save();
    expect(new Progress(store).fresh).toBe(false);
  });
});
