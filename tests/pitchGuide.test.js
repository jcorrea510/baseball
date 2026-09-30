// The pitch guide: a soft circle that guesses where the pitch will cross the plate. It appears just after the ball leaves the hand (never
// before the throw), early enough to decide on, a little off, and less exact on harder levels.
import { describe, it, expect } from 'vitest';
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { buildPitch, isStrike } from '../src/physics/pitch.js';
import { pitchGuide } from '../src/game/pitchGuide.js';
import { DEFAULT_SAVE, Progress } from '../src/game/progression.js';
import { guideStats } from '../scripts/guidecheck.mjs';

const mk = (type, x, y, level = 'pro', id = 1, speed = 82) => {
  const flight = buildPitch({ type, speedMph: speed, hand: 'R', target: { x, y }, movementScale: CONFIG.difficulty[level].movementScale }, CONFIG);
  return { flight, target: { x, y }, speedMph: speed, id, type };
};
const at = (pitch, f, level) => pitchGuide(pitch, pitch.flight.T * f, CONFIG, level);

describe('when it shows', () => {
  it('is invisible at release, fades in just after the ball leaves the hand, and is gone when the ball is at the plate', () => {
    for (const lv of DIFFICULTIES) {
      const p = mk('fastball', 0.2, 2.5, lv);
      expect(at(p, 0, lv).visible).toBe(false);
      expect(at(p, 0.02, lv).alpha).toBe(0);
      let last = -1;
      for (let f = 0; f <= 0.999; f += 0.02) { const a = at(p, f, lv).alpha; expect(a).toBeGreaterThanOrEqual(last - 1e-9); last = a; }
      expect(last).toBeGreaterThan(0.4 * CONFIG.pitch.guide.maxAlpha);
      expect(last).toBeLessThanOrEqual(CONFIG.pitch.guide.maxAlpha + 1e-9);
      expect(at(p, 1, lv).visible).toBe(false);
    }
  });

  it('never shows before the ball is thrown on any level (you cannot know before the pitch)', () => {
    for (const lv of DIFFICULTIES) for (const type of ['fastball', 'curveball', 'slider', 'changeup']) {
      const p = mk(type, 0, 2.5, lv);
      expect(CONFIG.difficulty[lv].guide.fadeIn[0]).toBeGreaterThan(0);
      expect(at(p, 0, lv).visible).toBe(false);
      expect(at(p, -0.2, lv).visible).toBe(false);
    }
  });

  it('appears earlier and stronger on Rookie than on Pro, and on Pro than on All-Star', () => {
    for (const f of [0.3, 0.45, 0.6]) {
      const a = DIFFICULTIES.map((lv) => at(mk('fastball', 0.2, 2.5, lv), f, lv).alpha);
      expect(a[0]).toBeGreaterThanOrEqual(a[1]); expect(a[1]).toBeGreaterThanOrEqual(a[2]);
    }
    const start = DIFFICULTIES.map((lv) => CONFIG.difficulty[lv].guide.fadeIn[0]);
    expect(start[0]).toBeLessThan(start[1]); expect(start[1]).toBeLessThan(start[2]);
    // it is only ever semi-transparent
    for (const lv of DIFFICULTIES) for (let f = 0; f < 1; f += 0.05) expect(at(mk('slider', 0.3, 2.2, lv), f, lv).alpha).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

describe('where it points', () => {
  it('is repeatable for a pitch (no jitter), different for different pitches, and roughly right at the plate', () => {
    const p = mk('fastball', 0.4, 2.9, 'allstar', 7);
    expect(at(p, 0.8, 'allstar')).toEqual(at(p, 0.8, 'allstar'));
    const q = mk('fastball', 0.4, 2.9, 'allstar', 8);
    expect(at(q, 0.8, 'allstar').x).not.toBe(at(p, 0.8, 'allstar').x);
    for (const lv of DIFFICULTIES) {
      const g = at(mk('fastball', 0.4, 2.9, lv, 3), 0.97, lv);
      expect(Math.hypot(g.x - 0.4, g.y - 2.9)).toBeLessThan(3 * CONFIG.difficulty[lv].guide.error + 0.05);
    }
  });

  it('a breaking pitch only shows where it ends up after a moment; a fastball is nearly right sooner', () => {
    const level = 'allstar';
    const errAt = (type, f) => {
      let e = 0, n = 0;
      for (let i = 0; i < 60; i++) {
        const p = mk(type, -0.3 + (i % 5) * 0.15, 2.3 + (i % 4) * 0.2, level, i + 1, type === 'curveball' ? 68 : 84);
        const g = at(p, f, level);
        e += Math.hypot(g.x - p.target.x, g.y - p.target.y); n++;
      }
      return e / n;
    };
    expect(errAt('curveball', 0.1)).toBeGreaterThan(errAt('fastball', 0.1) + 0.3); // the curve's drop is not shown yet
    expect(errAt('curveball', 0.1)).toBeGreaterThan(1.0);
    expect(errAt('curveball', 0.98)).toBeLessThan(errAt('curveball', 0.1) - 0.4); // ...and shows up soon after
    expect(errAt('curveball', 0.98)).toBeLessThan(1.6 * CONFIG.difficulty[level].guide.error + 0.05);
  });

  it('is less exact on harder levels, and the circle is bigger and closes in as the ball arrives', () => {
    const r = DIFFICULTIES.map((lv) => at(mk('fastball', 0.2, 2.5, lv), 0.95, lv).radius);
    expect(r[0]).toBeLessThan(r[1]); expect(r[1]).toBeLessThan(r[2]);
    const p = mk('fastball', 0.2, 2.5, 'pro');
    expect(at(p, 0.45, 'pro').radius).toBeGreaterThan(at(p, 0.95, 'pro').radius);
    const err = DIFFICULTIES.map((lv) => CONFIG.difficulty[lv].guide.error);
    expect(err[0]).toBeLessThan(err[1]); expect(err[1]).toBeLessThan(err[2]);
  });
});

describe('it helps in time, but it is not a giveaway', () => {
  const N = 2500;
  const stats = Object.fromEntries(DIFFICULTIES.map((lv) => [lv, guideStats(lv, N, 9)]));
  // "when you must decide": the swing starts swingDelay before the plate, and a person needs timing.decideTime to see and press
  const decide = (lv) => stats[lv].atDecide / stats[lv].n;
  const decideEdge = (lv) => stats[lv].atDecideBorderline / stats[lv].borderline;

  it('is showing when you have to decide (the old guide came too late to act on)', () => {
    expect(stats.rookie.alphaAtDecide / stats.rookie.n).toBeGreaterThan(0.95);
    expect(stats.pro.alphaAtDecide / stats.pro.n).toBeGreaterThan(0.9);
    expect(stats.allstar.alphaAtDecide / stats.allstar.n).toBeGreaterThan(0.7);
  });

  it('when you must decide it is on the right side of the zone mostly on Rookie, less on Pro, and often not on All-Star', () => {
    expect(decide('rookie')).toBeGreaterThan(0.93);
    expect(decide('pro')).toBeGreaterThan(0.8); expect(decide('pro')).toBeLessThan(0.92);
    expect(decide('allstar')).toBeGreaterThan(0.64); expect(decide('allstar')).toBeLessThan(0.8);
    expect(decide('rookie')).toBeGreaterThan(decide('pro')); expect(decide('pro')).toBeGreaterThan(decide('allstar'));
  });

  it('borderline pitches stay hard: close to a coin flip on All-Star, far from certain on Pro', () => {
    expect(decideEdge('rookie')).toBeGreaterThan(0.85);
    expect(decideEdge('pro')).toBeLessThan(0.82);
    expect(decideEdge('allstar')).toBeLessThan(0.7); expect(decideEdge('allstar')).toBeGreaterThan(0.5);
  });

  it('never gives a clean number: no NaN, radius and position are sane', () => {
    for (const lv of DIFFICULTIES) for (let i = 0; i < 40; i++) for (let f = 0; f <= 1; f += 0.1) {
      const g = at(mk(['fastball', 'curveball', 'slider', 'changeup', 'heater'][i % 5], -1 + (i % 9) * 0.25, 1.2 + (i % 7) * 0.4, lv, i + 1, 60 + (i % 5) * 9), f, lv);
      for (const v of [g.x, g.y, g.radius, g.alpha]) expect(Number.isFinite(v)).toBe(true);
      expect(g.radius).toBeGreaterThan(0.1); expect(g.radius).toBeLessThan(1.2);
      expect(Math.abs(g.x)).toBeLessThan(6); expect(g.y).toBeGreaterThan(-3); expect(g.y).toBeLessThan(9);
    }
    void isStrike;
  });
});

describe('the setting', () => {
  it('is on by default, also for people who already have a saved game without it', () => {
    expect(DEFAULT_SAVE().settings.pitchGuide).toBe(true);
    const data = {};
    const store = { get: (k) => data[k] ?? null, set: (k, v) => { data[k] = v; } };
    const old = DEFAULT_SAVE(); delete old.settings.pitchGuide; old.settings.zone = false;
    data[CONFIG.storageKey] = JSON.stringify(old);
    const prog = new Progress(store);
    expect(prog.settings.pitchGuide).toBe(true);
    expect(prog.settings.zone).toBe(false); // (their other choices are kept)
    prog.updateSettings({ pitchGuide: false });
    expect(new Progress(store).settings.pitchGuide).toBe(false);
  });
});
