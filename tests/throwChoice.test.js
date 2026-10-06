// You pitch and you are in the field (Fielding on Play): the fielder who gets the ball runs to it by himself and YOU pick where his
// first throw goes (engine.throwChoice / chooseThrow, fielding's i.throwTo). No pick = the throw he would have made anyway.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { auditPlan } from '../src/game/playAudit.js';
import { createRng } from '../src/util/rng.js';
import { firstThrow } from '../src/game/fielding.js';

const DT = 1 / 120;
const swingMiddle = () => ({ swing: true, errorMs: 0, aim: { x: 0, y: 2.4 }, protect: false });
const ball = (ev, la, spray) => () => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 });
const GROUNDER_SS = ball(78, -6, -14);
const LINER_LEFT_CENTER = ball(96, 12, -22);
const DEEP_FLY_CF = ball(90, 30, 8); // (caught ~345 ft out: deep enough that a man on second tags up too)

const make = (o = {}, bases = [null, null, null], outs = 0) => {
  const e = new Engine({ mode: 'quick', seed: 11, cpuHalf: 'pitch', fielding: 'play', ...o });
  e.start();
  const L = e.battingLineup;
  e.game.bases = bases.map((b, i) => (b ? L[(i + 3) % L.length] : null));
  e.game.outs = outs;
  return e;
};

// Pitch one ball he hits (`contact`) and run the play to its end. `pick(choice, t)` is asked every step while a throw can be chosen
// (return a base to throw there, or nothing). Returns what happened.
function hitOne(e, contact, pick = () => null) {
  const got = { choices: [], picked: null, results: [], contactPlan: null };
  const offs = [e.on('contact', (d) => { got.contactPlan = d.plan; }), e.on('result', (d) => got.results.push(d))];
  e.cpuSwingOverride = swingMiddle;
  e.contactOverride = contact;
  for (let k = 0; k < 2400 && e.phase !== 'aim'; k++) e.update(DT);
  e.setPitchAim(0, 2.5);
  if (!e.startDelivery()) throw new Error('could not start the delivery in ' + e.phase);
  const target = e.ring.tStart + e.ring.hitAt;
  while (e.time + DT < target) e.update(DT);
  e.ringTap(target - e.time);
  for (let k = 0; k < 600 && e.phase !== 'play'; k++) e.update(DT);
  for (let k = 0; k < 60 / DT && e.phase === 'play'; k++) {
    const c = e.throwChoice;
    if (c) {
      got.choices.push({ ...c, now: e.time - e.play.t0 });
      const b = pick(c, e.time - e.play.t0);
      if (b && e.chooseThrow(b)) got.picked = b;
    }
    if (e.play) got.plan = e.play.plan;
    e.update(DT);
  }
  got.phaseAfter = e.phase;
  e.cpuSwingOverride = null; e.contactOverride = null;
  for (const off of offs) if (typeof off === 'function') off();
  return got;
}

describe('choosing the throw: when it is offered', () => {
  it('a grounder to short with a man on first: offered before he throws (and only then), second (the double play) is his own pick', () => {
    const got = hitOne(make({}, [1, null, null]), GROUNDER_SS);
    expect(got.choices.length).toBeGreaterThan(0);
    const c = got.choices[0];
    expect(c.pos).toBe('SS');
    expect(c.base).toBe(2);
    for (const q of got.choices) { expect(q.now).toBeLessThan(q.t); expect(q.now).toBeGreaterThanOrEqual(q.opens - 1e-9); }
    expect(c.t - c.opens).toBeCloseTo(Math.min(CONFIG.fielding.throwChoice.lead, c.t - CONFIG.fielding.throwChoice.earliest), 6);
    expect(c.bases.filter((q) => q.ok).map((q) => q.base)).toEqual([1, 2]);
    expect(got.contactPlan.result).toBe('doublePlay');
  });

  it('never with Fielding on Auto, never while you bat', () => {
    expect(hitOne(make({ fielding: 'auto' }, [1, null, null]), GROUNDER_SS).choices).toEqual([]);
    const e = new Engine({ mode: 'quick', seed: 3, fielding: 'play', playerSide: 'top' });
    e.start();
    expect(e.offense).toBe('player');
    expect(e.throwChoice).toBeNull();
  });

  it('no pick: exactly the play the automatic fielding makes', () => {
    for (const [bases, contact] of [[[null, null, null], GROUNDER_SS], [[1, null, null], GROUNDER_SS], [[null, 1, null], LINER_LEFT_CENTER], [[null, null, 1], DEEP_FLY_CF]]) {
      const mine = hitOne(make({}, bases), contact);
      const auto = hitOne(make({ fielding: 'auto' }, bases), contact);
      expect(mine.plan.result).toBe(auto.plan.result);
      expect(mine.plan.outsMade).toBe(auto.plan.outsMade);
      expect(mine.plan.throws.map((t) => [t.toBase, t.t0.toFixed(3)])).toEqual(auto.plan.throws.map((t) => [t.toBase, t.t0.toFixed(3)]));
    }
  });
});

describe('choosing the throw: what it does', () => {
  it('a grounder to short with a man on first: second starts the double play, first gets only the batter', () => {
    const two = hitOne(make({}, [1, null, null]), GROUNDER_SS, () => 2);
    expect(two.picked).toBe(2);
    expect(two.plan.outsMade).toBeGreaterThanOrEqual(1);
    expect(firstThrow(two.plan).base).toBe(2);
    const one = hitOne(make({}, [1, null, null]), GROUNDER_SS, () => 1);
    expect(one.picked).toBe(1);
    expect(firstThrow(one.plan).base).toBe(1);
    const outs = one.plan.events.filter((ev) => ev.type === 'out').sort((a, b) => a.t - b.t);
    expect(outs[0].base).toBe(1); // (the batter first - the man with the ball may still go after the runner, no longer forced, at second)
  });

  it('a routine grounder with nobody on: nothing to choose (only the batter is running - to first)', () => {
    const got = hitOne(make(), GROUNDER_SS);
    expect(got.choices).toEqual([]);
    expect(got.plan.result).toBe('groundout');
  });

  it('a hit to left-center with a man on second who holds: first (the batter) and his own pick are offered; the throw goes where you pick', () => {
    const offered = hitOne(make({}, [null, 1, null]), LINER_LEFT_CENTER).choices[0];
    const ok = offered.bases.filter((q) => q.ok).map((q) => q.base);
    expect(ok).toContain(1);
    expect(ok).toContain(offered.base);
    expect(ok.length).toBeGreaterThanOrEqual(2);
    for (const b of ok) {
      const got = hitOne(make({}, [null, 1, null]), LINER_LEFT_CENTER, () => b);
      expect(got.picked).toBe(b);
      expect(firstThrow(got.plan).base).toBe(b);
    }
  });

  it('whatever is offered can be picked, and the first throw goes there (grounders, liners, a deep fly with men tagging up)', () => {
    const cases = [[[1, null, null], GROUNDER_SS], [[1, 1, null], GROUNDER_SS], [[null, 1, null], LINER_LEFT_CENTER], [[1, null, 1], LINER_LEFT_CENTER], [[null, 1, 1], DEEP_FLY_CF], [[1, null, 1], DEEP_FLY_CF]];
    let tried = 0;
    for (const [bases, contact] of cases) {
      const offered = hitOne(make({}, bases), contact).choices[0];
      if (!offered) continue;
      for (const b of offered.bases.filter((q) => q.ok).map((q) => q.base)) {
        const got = hitOne(make({}, bases), contact, () => b);
        expect(got.picked).toBe(b);
        expect(firstThrow(got.plan).base).toBe(b);
        tried++;
      }
    }
    expect(tried).toBeGreaterThanOrEqual(8);
  });

  it('a pick changes nothing that already happened, and one pick per play', () => {
    let first = null;
    const got = hitOne(make({}, [1, null, null]), GROUNDER_SS, (c, t) => { if (!first) { first = t; return 1; } return 2; });
    expect(got.picked).toBe(1); // (the second try was refused)
    expect(got.choices.length).toBe(1); // (once you pick, the choice is gone)
  });
});

describe('choosing the throw: the referee over many plays', () => {
  it('random balls, random runners, random picks: every out is a real one and every play ends', () => {
    const rng = createRng(21);
    const bad = [];
    let picked = 0, offered = 0;
    for (let n = 0; n < 70; n++) {
      const bases = [rng.chance(0.4) ? 1 : null, rng.chance(0.35) ? 1 : null, rng.chance(0.3) ? 1 : null];
      const e = make({ seed: 100 + n }, bases, n % 3);
      const contact = ball(rng.range(60, 104), rng.range(-14, 36), rng.range(-40, 40));
      const when = rng.range(0, 1);
      const got = hitOne(e, contact, (c, t) => {
        if ((t - c.opens) / (c.t - c.opens) < when) return null;
        const ok = c.bases.filter((q) => q.ok);
        return ok.length ? ok[Math.floor(rng.next() * ok.length)].base : null;
      });
      if (got.choices.length) offered++;
      if (got.picked) picked++;
      if (got.phaseAfter === 'play') bad.push(`ball ${n}: the play never ended`);
      for (const p of auditPlan(got.plan, e.defense, CONFIG)) bad.push(`ball ${n}: ${p}`);
    }
    expect(bad).toEqual([]);
    expect(offered).toBeGreaterThan(25);
    expect(picked).toBeGreaterThan(15);
  }, 120000);
});
