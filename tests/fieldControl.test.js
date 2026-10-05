// The live fielder (game/fieldControl.js): the outfielder you steer when the computer hits a ball to the outfield. Movement, the catch /
// dive / drop / pickup rules (the planner's own), the safety net and the auto-pilot that reproduces the automatic plan.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { isInsideField } from '../src/physics/field.js';
import { createDefense, planPlay, sampleBall } from '../src/game/fielding.js';
import { covered, samplePath } from '../src/game/fielderMotion.js';
import { FieldControl, controlEligible } from '../src/game/fieldControl.js';
import { createRng } from '../src/util/rng.js';

const F = CONFIG.fielding;
const START = { x: 0, y: 2.6, z: -1 };
const contactOf = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 });
const simOf = (ev, la, spray) => simulateBattedBall({ ...contactOf(ev, la, spray), start: START });
const TICK = 1 / 60;

// the moment (and the spot) the ball comes down to `h` ft on its way down
function downTo(sim, h) {
  let tPrev = 0;
  for (let t = 0.5; t <= sim.contactTime; t += 1 / 480) {
    const b = sampleBall(sim, t);
    if (b.y <= h && t > sim.apex.t) return { t, x: b.x, y: b.y, z: b.z };
    tPrev = t;
  }
  void tPrev;
  return null;
}
function defenseWith(pos, x, z) {
  const d = createDefense();
  d[pos].x = d[pos].homeX = x; d[pos].z = d[pos].homeZ = z;
  return d;
}
// run a control to time tEnd, calling `each(fc, t)` before every tick
function play(fc, tEnd, each = () => {}) {
  const states = [];
  for (let t = TICK; t <= tEnd + 1e-9 && !fc.finished; t += TICK) {
    each(fc, t);
    fc.advance(t);
    states.push({ t, ...fc.state });
  }
  return states;
}

describe('FieldControl: catching a fly ball', () => {
  const sim = simOf(80, 40, 0);
  const B = downTo(sim, F.catchHeight);

  it('(a) standing still under a fly ball that lands at his feet: a catch as it comes down to catch height', () => {
    const fc = new FieldControl({ sim, defense: defenseWith('CF', B.x, B.z), pos: 'CF', cfg: CONFIG, level: 'allstar' });
    play(fc, sim.duration);
    expect(fc.outcome).not.toBeNull();
    expect(fc.outcome.kind).toBe('catch');
    expect(fc.outcome.dive).toBe(false);
    expect(Math.abs(fc.outcome.t - B.t)).toBeLessThan(0.02);
    expect(fc.outcome.ball.y).toBeLessThanOrEqual(F.catchHeight + 1e-6);
    expect(fc.finished).toBe(true);
  });

  it('(b) 40 ft away and left alone: the ball drops, no pickup until the safety net, then the auto-pilot picks it up', () => {
    const fb = sim.firstBounce;
    const fc = new FieldControl({ sim, defense: defenseWith('CF', fb.x + 40, fb.z), pos: 'CF', cfg: CONFIG, level: 'allstar' });
    let downAt = null, pickupAt = null;
    play(fc, sim.contactTime + F.control.autoAfter + 12, (c) => {
      if (c.outcome && c.outcome.kind === 'down' && downAt === null) downAt = c.outcome.t;
    });
    expect(downAt).not.toBeNull();
    expect(downAt).toBeCloseTo(sim.contactTime, 3);
    expect(fc.outcome.kind).toBe('pickup');
    pickupAt = fc.outcome.t;
    expect(pickupAt).toBeGreaterThan(downAt + F.control.autoAfter);
    expect(fc.outcome.dive).toBe(false);
    const b = sampleBall(sim, pickupAt);
    expect(Math.hypot(fc.state.x - b.x, fc.state.z - b.z)).toBeLessThanOrEqual(F.groundGlove + 1e-6);
  });

  it('(c) running flat out at the catch spot from a start the planner calls catchable: a catch', () => {
    // he starts well off to the side and runs across, flat out from contact, timed to be at the spot as the ball comes down
    const r = Math.hypot(B.x, B.z), ux = -B.z / r, uz = B.x / r; // (across the field, square to the line from home)
    const D = covered(createDefense().CF.speed, B.t, F.accel) - 2;
    const sx = B.x + ux * D, sz = B.z + uz * D;
    expect(isInsideField(sx, sz, F.wallBody)).toBe(true);
    const defense = defenseWith('CF', sx, sz);
    const c = contactOf(80, 40, 0);
    const old = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, CONFIG);
    expect(old.caught).toBe(true);
    expect(old.fielder).toBe('CF');
    const fc = new FieldControl({ sim, defense, pos: 'CF', cfg: CONFIG, level: 'allstar' });
    play(fc, sim.duration, (k) => k.setInput(-ux, -uz));
    expect(fc.outcome.kind).toBe('catch');
    expect(fc.outcome.dive).toBe(false);
  });
});

describe('FieldControl: moving', () => {
  const sim = simOf(95, 12, -40); // a liner into the left-field corner: nowhere near center field

  it('(d) an input longer than 1 is clamped: never faster than his speed', () => {
    const defense = createDefense();
    const fc = new FieldControl({ sim, defense, pos: 'CF', cfg: CONFIG });
    const states = play(fc, 3, (k) => k.setInput(3, 4));
    const top = Math.max(...states.map((s) => Math.hypot(s.vx, s.vz)));
    expect(top).toBeLessThanOrEqual(defense.CF.speed + 1e-6);
    expect(top).toBeGreaterThan(defense.CF.speed * 0.95);
    // and he went the way he was pushed (3, 4) / 5
    const last = states[states.length - 1];
    expect(last.vx / Math.hypot(last.vx, last.vz)).toBeCloseTo(0.6, 2);
  });

  it('(e) full input at the wall for 8 s: he never leaves the ballpark', () => {
    for (const [dx, dz] of [[0, -1], [-0.7, -0.7], [0.7, -0.7], [1, 0]]) {
      const fc = new FieldControl({ sim, defense: createDefense(), pos: 'CF', cfg: CONFIG });
      const states = play(fc, 8, (k) => k.setInput(dx, dz));
      for (const s of states) expect(isInsideField(s.x, s.z, 0)).toBe(true);
      const last = states[states.length - 1];
      expect(isInsideField(last.x, last.z, F.wallBody - 0.05)).toBe(true);
    }
  });

  it('starts at his spot, facing home, with no runs made up', () => {
    const defense = createDefense();
    const fc = new FieldControl({ sim, defense, pos: 'RF', cfg: CONFIG });
    expect(fc.state.x).toBe(defense.RF.x);
    expect(fc.state.z).toBe(defense.RF.z);
    expect(fc.outcome).toBeNull();
    expect(fc.finished).toBe(false);
    fc.setInput(0, -1);
    fc.advance(1);
    const runs = fc.runs;
    expect(runs.length).toBe(1);
    expect(runs[0].track.length).toBeGreaterThan(50);
    expect(runs[0].track[0]).toEqual([0, defense.RF.x, defense.RF.z, 0, 0]);
    expect(runs[0].tStop).toBeCloseTo(1, 6);
  });
});

describe('FieldControl: diving', () => {
  const sim = simOf(80, 40, 0);
  const B = downTo(sim, 5);
  // standing 7 ft from where the ball comes down to 5 ft, facing it
  const r = Math.hypot(B.x, B.z), ux = B.x / r, uz = B.z / r;
  const setup = () => {
    const sx = B.x - ux * 7, sz = B.z - uz * 7;
    return new FieldControl({ sim, defense: defenseWith('CF', sx, sz), pos: 'CF', cfg: CONFIG, level: 'allstar', heading: Math.atan2(ux, uz) });
  };

  it('(f) Dive pressed at the right moment: a diving catch', () => {
    const fc = setup();
    const tPress = B.t - F.dive.airTime;
    let pressed = false;
    play(fc, sim.duration, (k, t) => { if (!pressed && t >= tPress) { k.pressDive(t); pressed = true; } });
    expect(fc.outcome.kind).toBe('catch');
    expect(fc.outcome.dive).toBe(true);
    expect(Math.abs(fc.outcome.t - B.t)).toBeLessThan(0.08);
    const runs = fc.runs;
    expect(runs.length).toBe(2);
    expect(runs[1].dive).toBeTruthy();
  });

  it('(f) ...pressed 0.5 s early: he dives, misses, and the ball drops', () => {
    const fc = setup();
    const tPress = B.t - F.dive.airTime - 0.5;
    let pressed = false, sawDive = false;
    play(fc, sim.contactTime + 0.5, (k, t) => {
      if (!pressed && t >= tPress) { k.pressDive(t); pressed = true; }
      if (k.state.diving) sawDive = true;
    });
    expect(sawDive).toBe(true);
    expect(fc.outcome.kind).toBe('down');
    expect(fc.finished).toBe(false);
    // he gets up and runs the ball down himself: his runs are [steered, dive, steered], one continuous path
    play(fc, sim.contactTime + 8, (k) => {
      const b = sampleBall(sim, k.t), s = k.state;
      k.setInput(b.x - s.x, b.z - s.z);
    });
    expect(fc.outcome.kind).toBe('pickup');
    expect(fc.outcome.dive).toBe(false);
    const runs = fc.runs;
    expect(runs.map((q) => (q.dive ? 'dive' : 'track'))).toEqual(['track', 'dive', 'track']);
    const up = runs[1].dive.tEnd;
    const a = samplePath(runs, up - 1e-6, {}), b = samplePath(runs, runs[2].tStart + 1e-6, {});
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.05);
    expect(runs[2].tStart).toBeGreaterThanOrEqual(up - 1e-9);
  });

  it('Dive pressed a little early: a Rookie (wider dive window) still makes the catch, an All-Star dives too soon', () => {
    const early = 0.19; // (beyond the All-Star's window plus the glove's own slack either side of the catch)
    const go = (level) => {
      const sx = B.x - ux * 7, sz = B.z - uz * 7;
      const fc = new FieldControl({ sim, defense: defenseWith('CF', sx, sz), pos: 'CF', cfg: CONFIG, level, heading: Math.atan2(ux, uz) });
      let pressed = false;
      play(fc, sim.contactTime + 0.2, (k, t) => { if (!pressed && t >= B.t - F.dive.airTime - early) { k.pressDive(t); pressed = true; } });
      return fc.outcome;
    };
    expect(CONFIG.difficulty.rookie.fielding.diveWindow).toBeGreaterThan(early);
    expect(CONFIG.difficulty.allstar.fielding.diveWindow + F.control.diveSlack).toBeLessThan(early);
    const rookie = go('rookie'), allstar = go('allstar');
    expect(rookie.kind).toBe('catch');
    expect(rookie.dive).toBe(true);
    expect(allstar.kind).toBe('down');
  });

  it('a dive for a ball the planner would call a diving catch goes straight at it (running he is a step short)', () => {
    // running flat out across the field, he would be 4 ft short of the ball as it comes down to 5 ft: a dive gets it
    const r2 = Math.hypot(B.x, B.z), cx = -B.z / r2, cz = B.x / r2;
    const D = covered(createDefense().CF.speed, B.t, F.accel) + 4;
    const fc = new FieldControl({ sim, defense: defenseWith('CF', B.x + cx * D, B.z + cz * D), pos: 'CF', cfg: CONFIG, level: 'allstar' });
    const probe = new FieldControl({ sim, defense: defenseWith('CF', B.x + cx * D, B.z + cz * D), pos: 'CF', cfg: CONFIG, level: 'allstar' });
    play(probe, sim.duration, (k) => k.setInput(-cx, -cz));
    expect(probe.outcome.kind).toBe('down'); // (running alone he does not get there)
    let pressed = false;
    play(fc, sim.duration, (k, t) => {
      k.setInput(-cx, -cz);
      if (!pressed && t >= B.t - F.dive.airTime) { k.pressDive(t); pressed = true; }
    });
    expect(fc.outcome.kind).toBe('catch');
    expect(fc.outcome.dive).toBe(true);
  });

  it('Dive when he can simply run under it changes nothing', () => {
    const fc = new FieldControl({ sim, defense: defenseWith('CF', B.x, B.z), pos: 'CF', cfg: CONFIG, level: 'allstar' });
    let pressed = false;
    play(fc, sim.duration, (k, t) => { if (!pressed && t >= B.t - 0.3) { k.pressDive(t); pressed = true; } });
    expect(fc.outcome.kind).toBe('catch');
    expect(fc.outcome.dive).toBe(false);
  });
});

describe('FieldControl: the auto-pilot reproduces the automatic plan', { timeout: 120000 }, () => {
  it('(g) catches >= 97% of 300 fly balls the old plan catches with an outfielder, within 0.15 s of its catch time', () => {
    const rng = createRng(20261005);
    const defense = createDefense();
    let n = 0, ok = 0, dives = 0;
    const misses = [];
    while (n < 300) {
      const c = contactOf(rng.range(70, 106), rng.range(12, 50), rng.range(-44, 44));
      const sim = simulateBattedBall({ ...c, start: START });
      const old = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, CONFIG);
      if (!old.fair || old.homer || !old.caught || !['LF', 'CF', 'RF'].includes(old.fielder)) continue;
      n++;
      if (old.fielderMoves[0].dive) dives++;
      const fc = new FieldControl({ sim, defense, pos: old.fielder, cfg: CONFIG, level: 'allstar' });
      play(fc, sim.duration + 1, (k, t) => k.autoSteer(t));
      if (fc.outcome && fc.outcome.kind === 'catch' && Math.abs(fc.outcome.t - old.catchT) <= 0.15) ok++;
      else misses.push({ c, catchT: old.catchT, dive: !!old.fielderMoves[0].dive, got: fc.outcome });
    }
    if (ok < 291) console.log('autoSteer misses', JSON.stringify(misses.slice(0, 8)));
    console.log(`autoSteer parity: ${ok} / ${n} (planner dives ${dives})`);
    expect(ok).toBeGreaterThanOrEqual(291);
  });
});

describe('controlEligible', () => {
  const base = { mode: 'quick', offense: 'cpu', fielding: 'play', simming: false, bot: false };
  const plan = { fair: true, homer: false, groundRule: false, fielder: 'CF' };
  it('is on for a fair ball an outfielder chases while you pitch', () => {
    expect(controlEligible(plan, base)).toBe(true);
    for (const pos of ['LF', 'RF']) expect(controlEligible({ ...plan, fielder: pos }, base)).toBe(true);
    expect(controlEligible(plan, { ...base, mode: 'season' })).toBe(true);
    expect(controlEligible(plan, { ...base, mode: 'practice' })).toBe(true);
  });
  it('is off for everything else', () => {
    expect(controlEligible(plan, { ...base, fielding: 'auto' })).toBe(false);
    expect(controlEligible(plan, { ...base, offense: 'player' })).toBe(false);
    expect(controlEligible(plan, { ...base, mode: 'derby' })).toBe(false);
    expect(controlEligible(plan, { ...base, simming: true })).toBe(false);
    expect(controlEligible(plan, { ...base, bot: true })).toBe(false);
    expect(controlEligible({ ...plan, fair: false }, base)).toBe(false);
    expect(controlEligible({ ...plan, homer: true }, base)).toBe(false);
    expect(controlEligible({ ...plan, groundRule: true }, base)).toBe(false);
    for (const pos of ['P', 'C', '1B', '2B', 'SS', '3B', null]) expect(controlEligible({ ...plan, fielder: pos }, base)).toBe(false);
    expect(controlEligible(null, base)).toBe(false);
  });
});
