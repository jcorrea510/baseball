// You pitch and you are in the field (Fielding on Play): the fielders run to the ball and field it by themselves, and then EVERY
// throw is yours - whoever has the ball holds it until you tap a base (engine.throwChoice / chooseThrow, fielding's MANUAL).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { auditPlan } from '../src/game/playAudit.js';
import { createRng } from '../src/util/rng.js';

const DT = 1 / 120;
const swingMiddle = () => ({ swing: true, errorMs: 0, aim: { x: 0, y: 2.4 }, protect: false });
const ball = (ev, la, spray) => () => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 });
const GROUNDER_SS = ball(78, -6, -14);
const LINER_LEFT_CENTER = ball(96, 12, -22);
const DEEP_FLY_CF = ball(90, 30, 8); // (caught ~345 ft out)

const make = (o = {}, bases = [null, null, null], outs = 0) => {
  const e = new Engine({ mode: 'quick', seed: 11, cpuHalf: 'pitch', fielding: 'play', ...o });
  e.start();
  const L = e.battingLineup;
  e.game.bases = bases.map((b, i) => (b ? L[(i + 3) % L.length] : null));
  e.game.outs = outs;
  return e;
};

// Pitch one ball he hits (`contact`) and run the play to its end. `tap(choice, t, taps)` is asked every step while you can throw
// (return a base to throw there, or nothing). Returns what happened.
function hitOne(e, contact, tap = () => null) {
  const got = { choices: [], taps: [], results: [], contactPlan: null };
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
      const b = tap(c, e.time - e.play.t0, got.taps);
      if (b !== null && b !== undefined && e.chooseThrow(b)) got.taps.push(b); // (0 = the mound)
    }
    if (e.play) got.plan = e.play.plan;
    e.update(DT);
  }
  got.phaseAfter = e.phase;
  e.cpuSwingOverride = null; e.contactOverride = null;
  for (const off of offs) if (typeof off === 'function') off();
  return got;
}
// tap these bases in turn, as soon as each can be tapped
const inTurn = (...bases) => (c, t, taps) => (taps.length < bases.length ? bases[taps.length] : null);
const outsAt = (plan) => plan.events.filter((ev) => ev.type === 'out').sort((a, b) => a.t - b.t).map((ev) => ev.base);

describe('your throws: when you can throw', () => {
  it('from the moment the ball is hit until the play is over; never with Fielding on Auto or while you bat', () => {
    const got = hitOne(make(), GROUNDER_SS);
    expect(got.choices.length).toBeGreaterThan(0);
    const c = got.choices[0];
    expect(c.holder).toBe('SS');
    expect(c.first).toBe(true);
    expect(c.now).toBeLessThan(got.plan.pickupT); // (from the moment the ball is hit: long before he has it)
    expect(c.now).toBeGreaterThanOrEqual(CONFIG.fielding.throwChoice.earliest - 1e-9);
    expect(c.bases.map((q) => q.base)).toEqual([0, 1, 2, 3, 4]);
    expect(c.bases.map((q) => q.ok)).toEqual([true, true, true, true, true]);
    expect(hitOne(make({ fielding: 'auto' }), GROUNDER_SS).choices).toEqual([]);
    const e = new Engine({ mode: 'quick', seed: 3, fielding: 'play', playerSide: 'top' });
    e.start();
    expect(e.offense).toBe('player');
    expect(e.throwChoice).toBeNull();
  });
});

describe('your throws: nothing is automatic', () => {
  it('a grounder to short and no tap: he holds it, nobody is thrown out, the batter is safe', () => {
    const got = hitOne(make(), GROUNDER_SS);
    expect(got.plan.throws).toEqual([]);
    expect(got.plan.outsMade || 0).toBe(0);
    expect(got.plan.batterDest).toBeGreaterThanOrEqual(1);
    expect(got.phaseAfter).not.toBe('play');
  });

  it('tap first (even before he has the ball): the batter is out at first', () => {
    const got = hitOne(make(), GROUNDER_SS, inTurn(1));
    expect(got.taps).toEqual([1]);
    expect(got.plan.result).toBe('groundout');
    expect(outsAt(got.plan)).toEqual([1]);
  });

  it('a man on first: second, then first, is a double play you turned yourself; second alone only gets the lead runner', () => {
    const two = hitOne(make({}, [1, null, null]), GROUNDER_SS, inTurn(2, 1));
    expect(two.taps).toEqual([2, 1]);
    expect(outsAt(two.plan)).toEqual([2, 1]);
    expect(two.plan.result).toBe('doublePlay');
    const one = hitOne(make({}, [1, null, null]), GROUNDER_SS, inTurn(2));
    expect(outsAt(one.plan)).toEqual([2]);
    expect(one.plan.result).toBe('fieldersChoice');
    expect(one.plan.batterDest).toBe(1);
  });

  it('a deep fly with a man on third: no tap and he scores with nobody throwing; tap home and the throw goes home', () => {
    const none = hitOne(make({}, [null, null, 1]), DEEP_FLY_CF);
    expect(none.contactPlan.caught).toBe(true);
    expect(none.plan.throws).toEqual([]);
    expect(none.plan.moves.find((m) => m.from === 3).to).toBe(4);
    const home = hitOne(make({}, [null, null, 1]), DEEP_FLY_CF, inTurn(4));
    expect(home.taps).toEqual([4]);
    expect(home.plan.throws[0].toBase).toBe(4);
  });

  it('a hit to the outfield: the throws go where you tap, in turn (a relay you make yourself)', () => {
    const got = hitOne(make({}, [null, 1, null]), LINER_LEFT_CENTER, inTurn(2, 3));
    expect(got.taps).toEqual([2, 3]);
    expect(got.plan.throws.map((t) => t.toBase)).toEqual([2, 3]);
  });

  it('the mound: the ball back to the pitcher ends the play - nobody is thrown out, nothing more can be thrown', () => {
    const plain = hitOne(make({}, [1, null, null]), LINER_LEFT_CENTER);
    const got = hitOne(make({}, [1, null, null]), LINER_LEFT_CENTER, inTurn(0));
    expect(got.taps).toEqual([0]);
    expect(got.plan.throws.map((t) => [t.to, t.toBase])).toEqual([['P', 0]]);
    expect(got.plan.mounded).toBeGreaterThan(0);
    expect(got.plan.outsMade || 0).toBe(0);
    expect(got.plan.endTime).toBeLessThan(plain.plan.endTime); // (it is over sooner than when nobody throws at all)
    expect(got.choices.filter((c) => c.now > got.plan.mounded)).toEqual([]);
  });

  it('the base the man with the ball stands on is not offered', () => {
    const got = hitOne(make(), GROUNDER_SS, inTurn(1));
    const after = got.choices.filter((c) => !c.first);
    expect(after.length).toBeGreaterThan(0);
    for (const c of after) expect(c.bases.find((q) => q.base === 1).ok).toBe(false);
  });
});

describe('your throws: the referee over many plays', () => {
  it('random balls, runners and taps: every out is a real one and every play ends', () => {
    const rng = createRng(21);
    const bad = [];
    let tapped = 0, outs = 0;
    for (let n = 0; n < 70; n++) {
      const bases = [rng.chance(0.4) ? 1 : null, rng.chance(0.35) ? 1 : null, rng.chance(0.3) ? 1 : null];
      const e = make({ seed: 100 + n }, bases, n % 3);
      const contact = ball(rng.range(60, 104), rng.range(-14, 36), rng.range(-40, 40));
      const gap = rng.range(0.1, 1.5), count = Math.floor(rng.range(0, 4));
      let next = null;
      const got = hitOne(e, contact, (c, t, taps) => {
        if (taps.length >= count) return null;
        if (next === null) next = t + (taps.length ? gap : rng.range(0, 0.8));
        if (t < next) return null;
        next = null;
        const ok = c.bases.filter((q) => q.ok);
        return ok[Math.floor(rng.next() * ok.length)].base;
      });
      tapped += got.taps.length;
      outs += got.plan.outsMade || 0;
      if (got.phaseAfter === 'play') bad.push(`ball ${n}: the play never ended`);
      for (const p of auditPlan(got.plan, e.defense, CONFIG)) bad.push(`ball ${n}: ${p}`);
    }
    expect(bad).toEqual([]);
    expect(tapped).toBeGreaterThan(40);
    expect(outs).toBeGreaterThan(10);
  }, 180000);
});
