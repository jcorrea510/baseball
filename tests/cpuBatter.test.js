// The computer's batter (game/cpuBatter.js): who he swings at, how his timing follows the pitch, and that he never gets the player's help.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { buildPitch, zoneRatio } from '../src/physics/pitch.js';
import { contactPoint, computeSwing } from '../src/game/contact.js';
import { resolveSwingTimes } from '../src/game/timing.js';
import { pitchWindowScale } from '../src/game/pitcherAI.js';
import { decideSwing, startSpot, perceivedSpot, cpuSwingInputs, wantsBunt } from '../src/game/cpuBatter.js';

const SEEDS = 2000;

// a real pitch (pace 1) wrapped like the engine's pitch object
function makePitch(type, target, o = {}) {
  const speedMph = o.speedMph ?? (type === 'changeup' ? 82 : type === 'slider' ? 86 : 94);
  const flight = buildPitch({ type, speedMph, target, pace: 1, movementScale: o.movementScale ?? 1 }, CONFIG);
  return { flight, target, type, speedMph, tRelease: 0, tCross: flight.T, grade: o.grade ?? 'ok', wildKind: o.wildKind };
}
const base = { count: { balls: 0, strikes: 0 }, recent: [], batter: { con: 50, pow: 50, spd: 50 }, level: 'pro', strength: 0 };
const run = (pitch, over = {}, n = SEEDS) => {
  const out = [];
  for (let s = 1; s <= n; s++) out.push(decideSwing({ ...base, ...over, pitch, rng: createRng(s) }, CONFIG));
  return out;
};
const rate = (rs) => rs.filter((r) => r.swing).length / rs.length;
// target at a given zoneRatio straight out from the middle of the zone (to the right)
const outRight = (ratio) => ({ x: ratio * CONFIG.pitch.zoneHalfWidth, y: CONFIG.timing.zoneCenterY });

describe('the computer batter', () => {
  it('3-0 is a take unless he is a power hitter and it is down the middle', () => {
    const heart = makePitch('fastball', { x: 0, y: CONFIG.timing.zoneCenterY });
    const take = rate(run(heart, { count: { balls: 3, strikes: 0 }, batter: { con: 50, pow: 50, spd: 50 } }));
    const power = rate(run(heart, { count: { balls: 3, strikes: 0 }, batter: { con: 50, pow: 80, spd: 50 } }));
    expect(take).toBeLessThan(0.02);
    expect(power).toBeGreaterThan(0.2);
    expect(power).toBeLessThan(0.4);
  }, 60000);

  it('two strikes widen the zone and the swing is a protect swing', () => {
    const edge = makePitch('fastball', outRight(1.15));
    const early = rate(run(edge));
    const two = run(edge, { count: { balls: 0, strikes: 2 } });
    expect(rate(two)).toBeGreaterThan(1.5 * early);
    expect(two.filter((r) => r.swing).every((r) => r.protect)).toBe(true);
    expect(run(edge).filter((r) => r.swing).every((r) => !r.protect)).toBe(true);
  }, 60000);

  it('pitches that fade out of the zone get chased', () => {
    const target = outRight(1.5);
    const slider = makePitch('slider', target);
    const s0 = startSpot(slider.flight, CONFIG);
    expect(zoneRatio(s0.x, s0.y, CONFIG)).toBeLessThan(1); // it starts as a strike
    expect(zoneRatio(target.x, target.y, CONFIG)).toBeGreaterThan(1.4);
    // the same slider with the fade-out switched off (no pull toward where it started, no extra read error)
    const noFade = { ...CONFIG, cpuBat: { ...CONFIG.cpuBat, fadePull: 0, fadeOut: 1 } };
    const run2 = (cfg) => { let n = 0; for (let s = 1; s <= SEEDS; s++) if (decideSwing({ ...base, pitch: slider, rng: createRng(s) }, cfg).swing) n++; return n / SEEDS; };
    const real = run2(CONFIG), plain = run2(noFade);
    expect(real).toBeGreaterThanOrEqual(1.3 * plain);
    // ...and a fastball (which starts outside the zone) is chased less than the slider
    expect(rate(run(slider))).toBeGreaterThan(rate(run(makePitch('fastball', target))));
  }, 60000);

  it('a changeup after two fastballs is swung at early', () => {
    const heart = { x: 0, y: CONFIG.timing.zoneCenterY };
    const change = makePitch('changeup', heart);
    const fb = { type: 'fastball', speedMph: 94 }, ch = { type: 'changeup', speedMph: 82 };
    const mean = (rs) => { const e = rs.filter((r) => r.swing).map((r) => r.errorMs); return e.reduce((a, b) => a + b, 0) / e.length; };
    expect(mean(run(change, { recent: [fb, fb] }))).toBeLessThan(-25);
    expect(Math.abs(mean(run(change, { recent: [ch, ch] })))).toBeLessThan(8);
  }, 60000);

  it('a perfect pitch on the edge is squared up less than a hang', () => {
    const target = outRight(1.05);
    const perfect = makePitch('fastball', target, { grade: 'perfect' });
    const hang = makePitch('fastball', target, { grade: 'wild', wildKind: 'hang', movementScale: 0.3 });
    const squaredShare = (pitch) => {
      const inp = cpuSwingInputs('pro', base.batter, 0, CONFIG);
      let swings = 0, good = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const rng = createRng(s);
        const d = decideSwing({ ...base, pitch, rng }, CONFIG);
        if (!d.swing) continue;
        swings++;
        const tPress = pitch.tCross + d.errorMs / 1000 - CONFIG.timing.swingDelay;
        const times = resolveSwingTimes(tPress, pitch.tCross, CONFIG);
        const { ball, vBall, wBall } = contactPoint(pitch.flight, times.hitTime - pitch.tRelease, times.barrelTime - pitch.tRelease, CONFIG);
        const c = computeSwing({
          errorMs: times.errorMs, ball, aim: d.aim, window: inp.window, vBall, wBall, windowScale: inp.windowScale,
          speedScale: pitchWindowScale(pitch.type), batterHand: 'R', batBonus: inp.batBonus, aimAssist: inp.aimAssist, evBonus: inp.evBonus, rng,
        }, CONFIG);
        if (c.made && (c.grade === 'perfect' || c.grade === 'good')) good++;
      }
      return good / swings;
    };
    expect(squaredShare(perfect)).toBeLessThan(0.7 * squaredShare(hang)); // (was 0.6 before the first balance pass: his read and aim are much sharper now - measured .57 vs .91)
  }, 120000);

  it('a strike on the corner of the zone is swung at like a strike (his zone is the umpire box, not an oval)', () => {
    const P = CONFIG.pitch;
    const corner = makePitch('fastball', { x: P.zoneHalfWidth - 0.08, y: P.zoneBottom + 0.05 }); // (a strike: inside the box)
    const middle = makePitch('fastball', { x: 0, y: CONFIG.timing.zoneCenterY - 0.5 });
    const off = makePitch('fastball', outRight(1.6));
    expect(rate(run(corner))).toBeGreaterThan(0.85 * rate(run(middle)));
    expect(rate(run(corner))).toBeGreaterThan(2 * rate(run(off)));
  }, 60000);

  it('his read is the same on every level (the pitch guide of the level is your batting help, not his)', () => {
    const same = { readSd: 0.1, timingSd: 30, aimSd: 0.05 };
    const cfg = { ...CONFIG, difficulty: Object.fromEntries(Object.entries(CONFIG.difficulty).map(([k, d]) => [k, { ...d, cpuBat: { ...d.cpuBat, ...same } }])) };
    const p = makePitch('slider', outRight(1.1));
    for (let s = 1; s <= 200; s++) {
      const r = decideSwing({ ...base, level: 'rookie', pitch: p, rng: createRng(s) }, cfg);
      const a = decideSwing({ ...base, level: 'allstar', pitch: p, rng: createRng(s) }, cfg);
      expect(a).toEqual(r);
    }
  });

  it('stars chase less', () => {
    const chase = makePitch('fastball', outRight(1.6));
    const star = rate(run(chase, { batter: { con: 90, pow: 50, spd: 50 } }));
    const weak = rate(run(chase, { batter: { con: 30, pow: 50, spd: 50 } }));
    expect(star).toBeLessThan(0.75 * weak);
  }, 60000);

  it('the player\'s batting help is never used', () => {
    const inp = cpuSwingInputs('rookie', null, 0, CONFIG);
    expect(inp.batBonus).toBe(0);
    expect(inp.aimAssist).toBe(0);
    expect(inp.window).toEqual(CONFIG.difficulty.rookie.cpuBat.window);
    expect(inp.window).not.toEqual(CONFIG.difficulty.rookie.contactWindow);
  });

  it('helpers: the no-break spot, a perceived spot near the real one, ratings and strength change his inputs', () => {
    const p = makePitch('curveball', { x: 0, y: 2.4 }, { speedMph: 78 });
    const s0 = startSpot(p.flight, CONFIG);
    expect(s0.y).toBeGreaterThan(p.target.y); // a curve drops: it starts higher than it ends
    const spots = [];
    for (let s = 1; s <= 500; s++) spots.push(perceivedSpot(p, 0.2, createRng(s), CONFIG));
    const mx = spots.reduce((a, b) => a + b.x, 0) / spots.length, my = spots.reduce((a, b) => a + b.y, 0) / spots.length;
    expect(Math.hypot(mx - p.target.x, my - p.target.y)).toBeLessThan(0.1);
    const star = cpuSwingInputs('pro', { con: 90, pow: 90, spd: 50 }, 0, CONFIG);
    const plain = cpuSwingInputs('pro', { con: 50, pow: 50, spd: 50 }, 0, CONFIG);
    expect(star.windowScale).toBeGreaterThan(plain.windowScale);
    expect(star.evBonus).toBeGreaterThan(plain.evBonus);
    const strong = cpuSwingInputs('pro', null, 1.5, CONFIG), weakT = cpuSwingInputs('pro', null, -1.5, CONFIG);
    expect(strong.evBonus).toBeGreaterThan(weakT.evBonus);
    expect(strong.windowScale).toBeGreaterThan(weakT.windowScale);
  });
});

describe('the sacrifice bunt (wantsBunt)', () => {
  const rng = { next: () => 0 }; // (always under the chance)
  const base = { bases: [{}, null, null], outs: 0, count: { balls: 0, strikes: 0 }, batter: { pow: 40, spd: 50 }, inning: 1, innings: 3, lead: 0, rng };
  it('bunts only in a bunting situation', () => {
    expect(wantsBunt(base)).toBe(true);
    expect(wantsBunt({ ...base, outs: 1 })).toBe(false);
    expect(wantsBunt({ ...base, count: { balls: 1, strikes: 2 } })).toBe(false);
    expect(wantsBunt({ ...base, bases: [null, null, null] })).toBe(false);
    expect(wantsBunt({ ...base, bases: [{}, null, {}] })).toBe(false);
    expect(wantsBunt({ ...base, batter: { pow: 80 } })).toBe(false);
    expect(wantsBunt({ ...base, bases: [null, {}, null] })).toBe(true);
  });
  it('draws no random number outside a bunting situation', () => {
    let n = 0; const r = { next: () => { n++; return 0.5; } };
    wantsBunt({ ...base, outs: 2, rng: r });
    expect(n).toBe(0);
  });
});
