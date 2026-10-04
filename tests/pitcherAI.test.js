// Where does the computer pitcher throw? Laying off bad pitches has to matter: more of them, and further out, as the level goes up;
// the Derby stays hittable.
import { describe, it, expect } from 'vitest';
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { choosePitch, pickTarget } from '../src/game/pitcherAI.js';
import { buildPitch, isStrike, zoneRatio } from '../src/physics/pitch.js';

const cfg = CONFIG;
const N = 6000;
const MIXED = [{ balls: 0, strikes: 0 }, { balls: 1, strikes: 0 }, { balls: 0, strikes: 1 }, { balls: 1, strikes: 1 }, { balls: 2, strikes: 1 }, { balls: 0, strikes: 2 }, { balls: 1, strikes: 2 }, { balls: 2, strikes: 0 }, { balls: 2, strikes: 2 }, { balls: 3, strikes: 1 }];
function sample(mode, difficulty, { counts = MIXED, seed = 1, batterHand = null, pitcherHand = 'R', n = N } = {}) {
  const rng = createRng(seed);
  const out = [];
  let last;
  for (let i = 0; i < n; i++) {
    const p = choosePitch({ mode, difficulty, count: counts[i % counts.length], rng, batterHand: batterHand || (i % 3 === 0 ? 'L' : 'R'), pitcherHand, lastType: last }, cfg);
    last = p.type;
    out.push({ ...p, r: zoneRatio(p.target.x, p.target.y, cfg), strike: isStrike(p.target.x, p.target.y, cfg) });
  }
  return out;
}
const share = (a, f) => a.filter(f).length / a.length;
const unhittable = (p) => p.r > cfg.timing.reachRatio;

describe('quick game pitch locations', () => {
  const S = Object.fromEntries(DIFFICULTIES.map((d) => [d, sample('quick', d)]));

  it('more pitches are out of reach as the level goes up', () => {
    const u = DIFFICULTIES.map((d) => share(S[d], unhittable));
    expect(u[0]).toBeLessThan(u[1]);
    expect(u[1]).toBeLessThan(u[2]);
    expect(u[0]).toBeGreaterThan(0.06); expect(u[0]).toBeLessThan(0.18);
    expect(u[1]).toBeGreaterThan(0.22); expect(u[1]).toBeLessThan(0.38);
    expect(u[2]).toBeGreaterThan(0.32); expect(u[2]).toBeLessThan(0.5);
  });

  it('and fewer are strikes', () => {
    const k = DIFFICULTIES.map((d) => share(S[d], (p) => p.strike));
    expect(k[0]).toBeGreaterThan(k[1]);
    expect(k[1]).toBeGreaterThan(k[2]);
    expect(k[1]).toBeGreaterThan(0.5); // (it is still a game you can hit in)
  });

  it('clearly out-of-the-zone pitches (well past the bat\'s reach) are common on Pro and All-Star, rare on Rookie', () => {
    const far = DIFFICULTIES.map((d) => share(S[d], (p) => p.r > 1.8));
    expect(far[0]).toBeLessThan(0.12);
    expect(far[1]).toBeGreaterThan(0.14);
    expect(far[2]).toBeGreaterThan(0.2);
  });

  it('there are pitches in the dirt, high heat and way off the plate', () => {
    for (const d of ['pro', 'allstar']) {
      expect(share(S[d], (p) => p.target.y < 1.0)).toBeGreaterThan(0.04);
      expect(share(S[d], (p) => p.target.y > 4.2)).toBeGreaterThan(0.025);
      expect(share(S[d], (p) => Math.abs(p.target.x) > 1.7)).toBeGreaterThan(0.03);
    }
  });

  it('the count matters: throws strikes with three balls, tries to make you chase with two strikes', () => {
    const three = sample('quick', 'pro', { counts: [{ balls: 3, strikes: 1 }] });
    const twoStrikes = sample('quick', 'pro', { counts: [{ balls: 0, strikes: 2 }] });
    const fresh = sample('quick', 'pro', { counts: [{ balls: 0, strikes: 0 }] });
    expect(share(three, (p) => p.strike)).toBeGreaterThan(0.85);
    expect(share(twoStrikes, (p) => !p.strike)).toBeGreaterThan(share(fresh, (p) => !p.strike) + 0.08);
  });

  it('every kind of pitch misses the way it moves', () => {
    const a = sample('quick', 'allstar', { counts: [{ balls: 0, strikes: 2 }], n: 12000, batterHand: 'R', pitcherHand: 'R' });
    const out = (t) => a.filter((p) => p.type === t && p.r > 1.4);
    const low = (t) => share(out(t), (p) => p.target.y < cfg.timing.zoneCenterY - 0.6);
    expect(low('curveball')).toBeGreaterThan(0.75); // curveballs drop out of the bottom
    expect(low('changeup')).toBeGreaterThan(0.6);
    // a righty's slider goes toward the glove side, away from a right-handed batter
    expect(share(out('slider'), (p) => p.target.x > 0.6)).toBeGreaterThan(0.6);
    // fastballs go up (or in)
    expect(share(out('heater'), (p) => p.target.y > cfg.timing.zoneCenterY + 0.6)).toBeGreaterThan(0.7);
    expect(share(out('fastball'), (p) => p.target.y > cfg.timing.zoneCenterY + 0.6 || p.target.x < -0.9)).toBeGreaterThan(0.6);
  });

  it('a lefty\'s slider breaks the other way, and so do his misses', () => {
    const a = sample('quick', 'allstar', { counts: [{ balls: 0, strikes: 2 }], n: 12000, batterHand: 'R', pitcherHand: 'L' });
    const sl = a.filter((p) => p.type === 'slider' && p.r > 1.4);
    expect(share(sl, (p) => p.target.x < -0.6)).toBeGreaterThan(0.6);
  });

  it('wasted pitches stay well out of reach, however wild he is', () => {
    const rng = createRng(3);
    const g = { zoneMidY: cfg.timing.zoneCenterY, hw: cfg.pitch.zoneHalfWidth, halfH: cfg.timing.zoneHalfHeight };
    for (const type of ['fastball', 'heater', 'curveball', 'slider', 'changeup']) {
      for (let i = 0; i < 300; i++) {
        const t = pickTarget('waste', type, 1, cfg, rng, g, 1);
        expect(zoneRatio(t.x, t.y, cfg)).toBeGreaterThanOrEqual(cfg.pitch.locations.waste[0] - 1e-9);
      }
    }
  });

  it('every pitch can actually be thrown, and reaches its target', () => {
    for (const p of S.allstar.slice(0, 1500)) {
      const f = buildPitch({ type: p.type, speedMph: p.speedMph, hand: 'R', target: p.target, movementScale: 1.25 }, cfg);
      const at = f.at(f.T);
      expect(at.x).toBeCloseTo(p.target.x, 3);
      expect(at.y).toBeCloseTo(p.target.y, 3);
      expect(f.tCatch).toBeGreaterThan(f.T);
    }
  });

  it('is repeatable for the same seed', () => {
    const a = sample('quick', 'pro', { seed: 7, n: 200 }), b = sample('quick', 'pro', { seed: 7, n: 200 });
    expect(a.map((p) => [p.type, p.target.x, p.target.y])).toEqual(b.map((p) => [p.type, p.target.x, p.target.y]));
  });
});

describe('a pitcher with his own pitches', () => {
  const draw = (arsenal, n = 2000, seed = 3) => {
    const rng = createRng(seed);
    const out = [];
    let last;
    for (let i = 0; i < n; i++) {
      const p = choosePitch({ mode: 'quick', difficulty: 'allstar', count: MIXED[i % MIXED.length], rng, batterHand: 'R', pitcherHand: 'R', lastType: last, arsenal }, cfg);
      last = p.type;
      out.push(p.type);
    }
    return out;
  };
  it('only throws what is in his arsenal, the fastball about .45 of the time', () => {
    for (const arsenal of [['fastball', 'slider'], ['fastball', 'changeup', 'curveball'], ['curveball', 'slider'], ['fastball']]) {
      const types = draw(arsenal);
      expect(types.every((t) => arsenal.includes(t))).toBe(true);
      for (const t of arsenal) expect(types).toContain(t);
    }
    const three = draw(['fastball', 'changeup', 'curveball'], 4000);
    const fb = three.filter((t) => t === 'fastball').length / three.length;
    expect(fb).toBeGreaterThan(0.36);
    expect(fb).toBeLessThan(0.54);
  });
  it('without an arsenal the level\'s mix is used, exactly as before', () => {
    const a = draw(undefined, 400, 9), b = draw([], 400, 9);
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set(['fastball', 'changeup', 'curveball', 'slider', 'heater'])); // (All-Star throws the heater)
  });
  it('the heater only when it is listed', () => {
    expect(draw(['fastball', 'slider', 'curveball']).includes('heater')).toBe(false);
    expect(draw(['fastball', 'heater']).includes('heater')).toBe(true);
  });
});

describe('Home Run Derby pitches', () => {
  it('are all hittable: every one in or right next to the zone', () => {
    for (const d of DIFFICULTIES) {
      const a = sample('derby', d, { n: 3000 });
      expect(share(a, (p) => p.strike)).toBe(1);
      expect(Math.max(...a.map((p) => p.r))).toBeLessThan(cfg.timing.chaseRatio);
    }
  });
});

describe('sinker, cutter and splitter miss the way they move', () => {
  const g = { zoneMidY: cfg.timing.zoneCenterY, hw: cfg.pitch.zoneHalfWidth, halfH: cfg.timing.zoneHalfHeight };
  const targets = (kind, type, breakDir = 1) => { const rng = createRng(5); return Array.from({ length: 3000 }, () => pickTarget(kind, type, 1, cfg, rng, g, breakDir)); };
  const share = (ts, f) => ts.filter(f).length / ts.length;
  const above = (t) => t.y > g.zoneMidY + g.halfH * 0.5;
  const below = (t) => t.y < g.zoneMidY - g.halfH * 0.5;
  it('a splitter that is off the zone is mostly below it, like a changeup, and never up', () => {
    for (const kind of ['chase', 'waste']) {
      const ts = targets(kind, 'splitter');
      expect(share(ts, below)).toBeGreaterThan(0.6);
      expect(share(ts, above)).toBe(0);
      expect(share(targets(kind, 'fastball'), above)).toBeGreaterThan(0.3); // (a fastball goes up: not the fallback any more)
    }
  });
  it('a sinker that is off the zone is down and away, rarely up', () => {
    for (const kind of ['chase', 'waste']) {
      const ts = targets(kind, 'sinker');
      expect(share(ts, above)).toBeLessThan(0.02);
      expect(share(ts, below)).toBeGreaterThan(0.5);
      expect(share(ts, (t) => t.x > 0)).toBeGreaterThan(0.9); // away from the batter (away = 1)
    }
  });
  it('a cutter goes the slider\'s way: out to its break side, level', () => {
    for (const kind of ['chase', 'waste']) for (const dir of [1, -1]) {
      const ts = targets(kind, 'cutter', dir);
      expect(share(ts, (t) => t.x * dir > 0)).toBe(1);
      expect(share(ts, above)).toBeLessThan(0.15); // (the slider's row reaches only a little above the belt)
      expect(share(ts, (t) => Math.abs(t.y - g.zoneMidY) < g.halfH * 1.5)).toBeGreaterThan(0.6);
    }
  });
});
