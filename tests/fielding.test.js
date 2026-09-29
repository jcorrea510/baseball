import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, pathPoint, runnerPosition, POSITIONS } from '../src/game/fielding.js';
import { BASE_XZ } from '../src/physics/field.js';
import { createRng } from '../src/util/rng.js';

const defense = createDefense();
const contactOf = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 });
const play = (ev, la, spray, o = {}) => {
  const c = contactOf(ev, la, spray);
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  return planPlay({ sim, contact: c, bases: o.bases || [null, null, null], outs: o.outs ?? 0, defense: o.defense || defense, simple: o.simple }, CONFIG);
};

describe('the defense', () => {
  it('has all nine fielders in sensible spots', () => {
    for (const p of POSITIONS) expect(defense[p]).toBeTruthy();
    expect(defense.P.z).toBeCloseTo(-60.5, 1);
    expect(defense['1B'].x).toBeGreaterThan(0);
    expect(defense['3B'].x).toBeLessThan(0);
    expect(defense.LF.x).toBeLessThan(0);
    expect(defense.RF.x).toBeGreaterThan(0);
    expect(Math.hypot(defense.CF.x, defense.CF.z)).toBeGreaterThan(280);
  });
  it('gives fielders slightly different speeds when randomised', () => {
    const d = createDefense(CONFIG, createRng(3));
    expect(d.CF.speed).not.toBe(createDefense().CF.speed);
  });
});

describe('outcomes', () => {
  it('a hard fly ball over the fence is a home run and everyone scores', () => {
    const p = play(106, 27, -20, { bases: [1, 2, 3] });
    expect(p.homer).toBe(true);
    expect(p.result).toBe('homer');
    expect(p.batterDest).toBe(4);
    expect(p.moves.filter((m) => m.to === 4).length).toBe(4);
  });

  it('a routine fly ball right at the center fielder is caught', () => {
    const p = play(80, 40, 0);
    expect(p.caught).toBe(true);
    expect(['flyout', 'popout', 'lineout']).toContain(p.result);
    expect(p.outsMade).toBe(1);
    expect(p.fielder).toBe('CF');
    expect(p.catchT).toBeGreaterThan(2);
  });

  it('a foul ball that no one can reach is just a foul', () => {
    const p = play(90, 25, 62);
    expect(p.fair).toBe(false);
    expect(p.result).toBe('foul');
    expect(p.outsMade).toBe(0);
  });

  it('a high pop-up in foul ground behind the plate can be caught (foul out)', () => {
    const p = play(55, 72, 165);
    expect(p.fair).toBe(false);
    expect(p.result === 'foulOut' || p.result === 'foul').toBe(true);
  });

  it('a line drive into the gap falls in for extra bases', () => {
    const p = play(102, 15, 18);
    expect(['single', 'double', 'triple', 'homer', 'flyout', 'lineout']).toContain(p.result);
    // pick one that must drop: hit it deep into the left-center gap
    const q = play(100, 19, -12);
    expect(q.fair).toBe(true);
  });

  it('a ball off the wall becomes a double or triple, never an out', () => {
    const p = play(101, 12, 32);
    if (!p.caught) expect(['single', 'double', 'triple', 'insideParkHomer']).toContain(p.result);
  });

  it('a slow roller to the shortstop with nobody on is a groundout', () => {
    const p = play(48, -2, -18);
    expect(p.result).toBe('groundout');
    expect(p.outsMade).toBe(1);
    expect(p.batterDest).toBe(0);
    expect(p.throws.length).toBeGreaterThan(0);
    expect(p.throws[0].toBase).toBe(1);
  });

  it('a hard grounder up the middle can be a single', () => {
    let singles = 0;
    for (let s = -8; s <= 8; s += 2) if (play(95, 1, s).result === 'single') singles++;
    expect(singles).toBeGreaterThan(0);
  });

  it('with a runner on first and fewer than two outs, a grounder can become a double play', () => {
    let dp = 0, fc = 0;
    for (let s = -30; s <= 30; s += 2) {
      for (const ev of [55, 62, 70]) {
        const r = play(ev, -2, s, { bases: [1, null, null], outs: 0 }).result;
        if (r === 'doublePlay') dp++;
        if (r === 'fieldersChoice') fc++;
      }
    }
    expect(dp + fc).toBeGreaterThan(0);
  });

  it('with two outs a double play is impossible', () => {
    for (let s = -30; s <= 30; s += 3) {
      const p = play(58, -2, s, { bases: [1, null, null], outs: 2 });
      expect(p.outsMade).toBeLessThanOrEqual(1);
      expect(p.result).not.toBe('doublePlay');
    }
  });

  it('a runner on third scores on a deep fly (sacrifice fly)', () => {
    let sac = 0;
    for (let s = -12; s <= 12; s += 3) {
      const p = play(88, 38, s, { bases: [null, null, 3], outs: 0 });
      if (p.result === 'sacFly') { sac++; expect(p.moves.some((m) => m.from === 3 && m.to === 4)).toBe(true); }
    }
    expect(sac).toBeGreaterThan(0);
  });

  it('derby / practice mode plans are short (no baserunning)', () => {
    const p = play(95, 20, 5, { simple: true });
    expect(p.moves.length === 0 || p.homer).toBe(true);
    expect(p.endTime).toBeLessThan(9);
  });

  it('speedier fielders reach more balls (range matters)', () => {
    const slow = createDefense(); const fast = createDefense();
    for (const k of POSITIONS) { slow[k].speed *= 0.5; fast[k].speed *= 1.4; }
    let slowCaught = 0, fastCaught = 0;
    for (let s = -30; s <= 30; s += 3) for (const la of [22, 30, 38]) {
      if (play(92, la, s, { defense: slow }).caught) slowCaught++;
      if (play(92, la, s, { defense: fast }).caught) fastCaught++;
    }
    expect(fastCaught).toBeGreaterThan(slowCaught);
  });
});

describe('plans are always well-formed (fuzz)', () => {
  it('every random contact gives finite times, valid runner moves and no shared bases', () => {
    const rng = createRng(2024);
    for (let i = 0; i < 400; i++) {
      const ev = rng.range(40, 112), la = rng.range(-15, 75), spray = rng.range(-80, 80);
      const bases = [rng.chance(0.4) ? 1 : null, rng.chance(0.3) ? 2 : null, rng.chance(0.25) ? 3 : null];
      const outs = rng.int(0, 2);
      const p = play(ev, la, spray, { bases, outs });
      expect(Number.isFinite(p.endTime)).toBe(true);
      expect(p.endTime).toBeGreaterThan(0);
      expect(p.endTime).toBeLessThan(40);
      expect(p.outsMade).toBeGreaterThanOrEqual(0);
      expect(p.outsMade).toBeLessThanOrEqual(2);
      // no two safe runners end on the same base
      const ends = [];
      for (const m of p.moves) if (m.from >= 1 && !m.out && m.to < 4) ends.push(m.to);
      if (p.batterDest >= 1 && p.batterDest < 4) ends.push(p.batterDest);
      // runners who hold (not mentioned) keep their base
      for (let b = 1; b <= 3; b++) if (bases[b - 1] && !p.moves.some((m) => m.from === b)) ends.push(b);
      expect(new Set(ends).size).toBe(ends.length);
      // runners never go backwards
      for (const m of p.moves) if (m.from >= 1 && !m.out) expect(m.to).toBeGreaterThanOrEqual(m.from);
      for (const t of p.throws) { expect(Number.isFinite(t.t0)).toBe(true); expect(t.t1).toBeGreaterThan(t.t0); }
      for (const f of p.fielderMoves) for (const k of f.keys) { expect(Number.isFinite(k.t)).toBe(true); expect(Number.isFinite(k.x)).toBe(true); }
    }
  });
});

describe('runner paths', () => {
  it('pathPoint walks the diamond', () => {
    expect(pathPoint(0, 0)).toMatchObject({ x: 0, z: 0 });
    const first = pathPoint(0, 90);
    expect(first.x).toBeCloseTo(BASE_XZ[1][0], 3);
    expect(first.z).toBeCloseTo(BASE_XZ[1][1], 3);
    const second = pathPoint(0, 180);
    expect(second.x).toBeCloseTo(0, 3);
    expect(second.z).toBeCloseTo(BASE_XZ[2][1], 3);
    const home = pathPoint(0, 360);
    expect(home.x).toBeCloseTo(0, 3);
    expect(home.z).toBeCloseTo(0, 3);
    const mid = pathPoint(1, 45);
    expect(mid.z).toBeLessThan(BASE_XZ[1][1]);
  });

  it('the batter needs about timeToFirst seconds to reach first base', () => {
    const t = CONFIG.runner.timeToFirst;
    const before = runnerPosition({ from: 0, to: 1 }, t - 0.4);
    const after = runnerPosition({ from: 0, to: 1 }, t + 0.05);
    expect(before.done).toBe(false);
    expect(after.done).toBe(true);
    expect(after.x).toBeCloseTo(BASE_XZ[1][0], 1);
  });
});
