// The engine runs a play in which YOU steer the outfielder (round fifteen): who gets control, the catch and the pickup re-planned
// through the planner, the safety net when you leave him alone, the third out, the referee over many plays.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { auditPlan } from '../src/game/playAudit.js';
import { createRng } from '../src/util/rng.js';

const DT = 1 / 120;
const swingMiddle = () => ({ swing: true, errorMs: 0, aim: { x: 0, y: 2.4 }, protect: false });
const ball = (ev, la, spray) => () => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 });
const LAZY_CF = ball(84, 34, 2);
const make = (o = {}) => {
  const e = new Engine({ mode: 'quick', seed: 11, cpuHalf: 'pitch', fielding: 'play', ...o });
  e.start();
  return e;
};

// Pitch one ball he hits (`contact`), then run the play to its end; `steer(e, t)` is called before every engine step while you have
// control (t = seconds after contact). Returns what happened.
function hitOne(e, contact, steer = () => {}, maxPlay = 60) {
  const got = { start: [], end: [], contactPlan: null, results: [], plans: [] };
  const offs = [
    e.on('controlStart', (d) => got.start.push(d)),
    e.on('controlEnd', (d) => got.end.push(d)),
    e.on('contact', (d) => { got.contactPlan = d.plan; }),
    e.on('result', (d) => got.results.push(d)),
  ];
  e.cpuSwingOverride = swingMiddle;
  e.contactOverride = contact;
  for (let k = 0; k < 2400 && e.phase !== 'aim'; k++) e.update(DT);
  e.setPitchAim(0, 2.5);
  if (!e.startDelivery()) throw new Error('could not start the delivery in ' + e.phase);
  const target = e.ring.tStart + e.ring.hitAt;
  while (e.time + DT < target) e.update(DT);
  e.ringTap(target - e.time);
  for (let k = 0; k < 600 && e.phase !== 'play'; k++) e.update(DT);
  got.control = e.control;
  got.pending = e.play && e.play.plan.pending;
  const t0 = e.play ? e.play.t0 : e.time;
  for (let k = 0; k < maxPlay / DT && e.phase === 'play'; k++) {
    if (e.control) steer(e, e.time - e.play.t0);
    if (e.play) got.plan = e.play.plan;
    e.update(DT);
  }
  got.playTime = e.time - t0;
  got.phaseAfter = e.phase;
  e.cpuSwingOverride = null; e.contactOverride = null;
  for (const off of offs) if (typeof off === 'function') off();
  return got;
}
const autoPilot = (e, t) => e.control.autoSteer(t);

describe('engine: who steers the play', () => {
  it('nobody for an infield grounder, a homer, a foul, or with Fielding on Auto', () => {
    const cases = [
      [{}, ball(70, -12, 18)], // a grounder to the right side
      [{}, ball(112, 28, -15)], // a homer
      [{}, ball(80, 20, 62)], // a foul
      [{ fielding: 'auto' }, LAZY_CF],
    ];
    for (const [o, c] of cases) {
      const got = hitOne(make(o), c);
      expect(got.start).toEqual([]);
      expect(got.control).toBeNull();
    }
  });

  it('you, for a lazy fly to center: the play is open until you catch it, the contact event keeps the automatic plan', () => {
    const got = hitOne(make(), LAZY_CF, autoPilot);
    expect(got.start).toEqual([{ pos: 'CF' }]);
    expect(got.control.pos).toBe('CF');
    expect(got.pending).toBe(true);
    expect(got.contactPlan.pending).toBeFalsy();
    expect(got.contactPlan.caught).toBe(true);
  });

  it('nobody when the batter is yours, in the Derby, or by default', () => {
    const e = new Engine({ mode: 'derby', seed: 3, fielding: 'play' });
    expect(e.offense).toBe('player');
    expect(new Engine({ mode: 'quick', seed: 3 }).fielding).toBe('auto');
  });
});

describe('engine: a controlled play', () => {
  it('the auto-pilot catches the lazy fly: one out, on to the next batter', () => {
    const e = make();
    const outs = e.game.outs, batter = e.batterIdx ?? null;
    const got = hitOne(e, LAZY_CF, autoPilot);
    expect(got.end.length).toBe(1);
    expect(got.end[0].outcome.kind).toBe('catch');
    expect(got.results.length).toBe(1);
    expect(e.game.outs).toBe(outs + 1);
    expect(got.phaseAfter).not.toBe('play');
    void batter;
  });

  it('left alone: the ball falls, the safety net runs it down, the play ends as a hit (it never hangs)', () => {
    const e = make();
    const got = hitOne(e, ball(92, 22, 14));
    expect(got.start.length).toBe(1);
    expect(got.end.length).toBe(1);
    expect(got.end[0].outcome.kind).toBe('pickup');
    expect(got.end[0].outcome.t).toBeGreaterThan(CONFIG.fielding.control.autoAfter);
    expect(got.phaseAfter).not.toBe('play');
    expect(got.playTime).toBeLessThan(CONFIG.fielding.control.autoAfter + 20);
    expect(['single', 'double', 'triple', 'insideParkHomer']).toContain(got.results[0].result);
    expect(e.game.bases.some(Boolean) || got.results[0].result === 'insideParkHomer').toBe(true);
  });

  it('the catch is the third out with a runner on third: no run, the half is over', () => {
    const e = make();
    for (let k = 0; k < 2400 && e.phase !== 'aim'; k++) e.update(DT);
    const half = e.game.half, inning = e.game.inning, score = { ...e.game.score };
    e.game.outs = 2;
    e.game.bases[2] = e.oppLineup[5];
    const got = hitOne(e, ball(86, 30, -6), autoPilot);
    expect(got.end[0].outcome.kind).toBe('catch');
    for (let k = 0; k < 2400 && e.phase === 'result'; k++) e.update(DT);
    expect(e.game.score).toEqual(score);
    expect(e.game.half !== half || e.game.inning !== inning).toBe(true);
  });

  it('a Sim pressed during the play hands him to the computer at once', () => {
    const e = make();
    let pressed = false;
    const got = hitOne(e, ball(92, 22, 14), (en, t) => { if (!pressed && t > 0.5) { pressed = en.simHalf(); } });
    expect(pressed).toBe(true);
    expect(got.end.length).toBe(1);
    expect(got.end[0].outcome.t).toBeLessThan(CONFIG.fielding.control.autoAfter);
  });

  it('the referee: every out over many controlled plays (caught, run down, left alone, with runners) is a real out', () => {
    const rng = createRng(19);
    const problems = [];
    let plays = 0, catches = 0, pickups = 0, sends = 0;
    for (let g = 0; g < 16; g++) {
      const e = make({ seed: 100 + g });
      e.on('send', () => { sends++; });
      for (let n = 0; n < 12; n++) {
        for (let k = 0; k < 2400 && e.phase !== 'aim' && !e.over; k++) e.update(DT);
        if (e.over || !e.pitching) break;
        e.game.outs = rng.int(0, 2);
        e.game.bases = [rng.chance(0.5) ? e.oppLineup[1] : null, rng.chance(0.5) ? e.oppLineup[2] : null, rng.chance(0.4) ? e.oppLineup[3] : null];
        const c = ball(rng.range(72, 104), rng.range(8, 40), rng.range(-40, 40));
        const mode = rng.int(0, 2); // auto-pilot / left alone / steered late
        const steer = mode === 0 ? autoPilot : mode === 1 ? () => {} : (en, t) => { if (t > 0.9) en.control.autoSteer(t); };
        const got = hitOne(e, c, steer);
        if (!got.start.length) continue;
        plays++;
        const o = got.end[0] && got.end[0].outcome;
        if (!o) { problems.push(`play ${plays}: no outcome`); continue; }
        if (o.kind === 'catch') catches++; else pickups++;
        if (got.phaseAfter === 'play') problems.push(`play ${plays}: still in play after 60 s`);
        problems.push(...auditPlan(got.plan, e.defense).map((p) => `play ${plays}: ${p}`));
      }
    }
    console.log(`controlled plays ${plays}: catches ${catches}, pickups ${pickups}, the computer's sends ${sends}`);
    expect(plays).toBeGreaterThan(50);
    expect(catches).toBeGreaterThan(0);
    expect(pickups).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  }, 300000);
});
