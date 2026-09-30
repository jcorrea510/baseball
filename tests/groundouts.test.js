// Outs at a base are only real when a fielder is standing on the bag WITH the ball before the runner gets there.
// (A first baseman once fielded a grounder, threw it to the pitcher - who was still on the mound - and it counted as an out.)
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { auditPlan, fielderAt } from '../src/game/playAudit.js';
import { runnerArrival } from '../src/game/runnerMotion.js';
import { BASE_XZ } from '../src/physics/field.js';
import { createRng } from '../src/util/rng.js';
import { groundballs } from '../scripts/groundcheck.mjs';

const contactOf = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900, hook: 0 });
const play = (ev, la, spray, o = {}) => {
  const c = contactOf(ev, la, spray);
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const defense = o.defense || createDefense();
  return { plan: planPlay({ sim, contact: c, bases: o.bases || [null, null, null], outs: o.outs ?? 0, defense }, CONFIG), defense };
};
const outEvent = (plan) => plan.events.find((e) => e.type === 'out');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('the referee', () => {
  it('finds nothing wrong in thousands of ground balls to every fielder', () => {
    const r = groundballs(2500, 7);
    expect(r.plays).toBeGreaterThan(2000);
    expect(r.problems).toEqual({});
    expect(Object.keys(r.byFielder)).toEqual(expect.arrayContaining(['1B', '2B', '3B', 'SS', 'P']));
  });

  it('would catch the old bug: a throw to a receiver who is nowhere near the bag', () => {
    const { plan, defense } = play(48, -2, -18);
    expect(plan.result).toBe('groundout');
    expect(auditPlan(plan, defense)).toEqual([]);
    // pretend the shortstop's throw went to a first baseman who was still at his spot, and the out was counted anyway
    const bad = JSON.parse(JSON.stringify(plan));
    bad.paths = {};
    const throws = bad.throws.filter((t) => t.toBase === 1);
    expect(throws.length).toBeGreaterThan(0);
    defense['1B'].x = 20; defense['1B'].z = -100; // (his spot, far from the bag, and he never moves in this doctored plan)
    const problems = auditPlan(bad, defense);
    expect(problems.some((p) => /from the bag/.test(p))).toBe(true);
  });
});

describe('an out needs a fielder with the ball on the bag before the runner', () => {
  it('a routine grounder: the receiver is on first, with the ball, before the batter gets there', () => {
    const { plan, defense } = play(48, -2, -18);
    expect(plan.result).toBe('groundout');
    const e = outEvent(plan);
    expect(e.base).toBe(1);
    const at = fielderAt(plan, defense, e.pos, e.t);
    expect(dist([at.x, at.z], BASE_XZ[1])).toBeLessThan(2.6); // he is on the bag
    const th = plan.throws.find((t) => t.to === e.pos && t.toBase === 1);
    expect(th.t1).toBeCloseTo(e.t, 2); // the throw is in his glove at that moment
    expect(dist([th.bx, th.bz], BASE_XZ[1])).toBeLessThan(1.5); // and it was thrown at the bag
    expect(e.t).toBeLessThan(runnerArrival(CONFIG, 0, 1)); // before the batter
  });

  it('runner beats the throw = safe', () => {
    // the same grounder, but the shortstop is slow to pick it up: the batter is on first before the ball can be
    const slow = createDefense(); slow.SS.react = 2.4; slow.SS.speed = 9;
    const { plan, defense } = play(48, -2, -18, { defense: slow });
    expect(plan.outsMade).toBe(0);
    expect(plan.result).not.toBe('groundout');
    expect(plan.moves.find((m) => m.from === 0).out).toBeFalsy();
    expect(plan.batterDest).toBeGreaterThanOrEqual(1);
    expect(auditPlan(plan, defense)).toEqual([]);
  });

  it('no one covering = no out', () => {
    // a grounder to the first baseman, who is standing far from the bag; the pitcher and second baseman are nowhere near it either
    const d = createDefense();
    d['1B'].x = 25; d['1B'].z = -115; d['1B'].homeX = 25; d['1B'].homeZ = -115;
    for (const pos of ['P', '2B']) { d[pos].x = -150; d[pos].z = -250; d[pos].homeX = -150; d[pos].homeZ = -250; }
    let checked = 0;
    for (let spray = 20; spray <= 45; spray += 1) {
      const { plan, defense } = play(46, -2, spray, { defense: d });
      if (plan.fielder !== '1B') continue;
      checked++;
      expect(plan.outsMade).toBe(0); // nobody could get to the bag with the ball in time
      expect(plan.events.some((e) => e.type === 'out')).toBe(false);
      expect(auditPlan(plan, defense)).toEqual([]);
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('a first baseman who fields the ball close to the bag takes it himself (no throw)', () => {
    let self = 0;
    for (let spray = 30; spray <= 46; spray += 1) {
      for (const ev of [40, 46, 52]) {
        const { plan } = play(ev, -2, spray);
        if (plan.fielder !== '1B' || plan.result !== 'groundout') continue;
        const e = outEvent(plan);
        if (e.pos === '1B') { self++; expect(plan.throws.filter((t) => t.toBase === 1).length).toBe(0); }
      }
    }
    expect(self).toBeGreaterThan(5);
  });

  it('a first baseman pulled far from the bag flips to the pitcher (or second baseman), who runs over and covers', () => {
    let covered = 0;
    for (let spray = 5; spray <= 46; spray += 1) {
      for (const ev of [45, 55, 65, 75]) {
        const { plan, defense } = play(ev, -2, spray);
        if (plan.fielder !== '1B' || plan.result !== 'groundout') continue;
        const e = outEvent(plan);
        if (e.pos === 'P' || e.pos === '2B') {
          covered++;
          const th = plan.throws.find((t) => t.toBase === 1);
          expect(th.from).toBe('1B'); expect(th.to).toBe(e.pos);
          expect(dist([th.bx, th.bz], BASE_XZ[1])).toBeLessThan(1.5); // thrown to the bag, not to where he stands
          const start = fielderAt(plan, defense, e.pos, 0.2), onBag = fielderAt(plan, defense, e.pos, e.t);
          expect(dist([start.x, start.z], BASE_XZ[1])).toBeGreaterThan(20); // he had to run over
          expect(dist([onBag.x, onBag.z], BASE_XZ[1])).toBeLessThan(2.6);
        }
      }
    }
    expect(covered).toBeGreaterThan(5);
  });

  it('the pitcher, second baseman, shortstop and third baseman all get their grounders and throw to a man who is on first', () => {
    for (const [pos, sprays] of [['P', [-2, 0, 2]], ['2B', [15, 20, 25]], ['SS', [-15, -20, -25]], ['3B', [-33, -38, -42]]]) {
      let n = 0;
      for (const spray of sprays) for (const ev of [40, 48, 55]) {
        const { plan, defense } = play(ev, -2, spray);
        if (plan.fielder !== pos || plan.result !== 'groundout') continue;
        n++;
        const e = outEvent(plan);
        expect(e.base).toBe(1);
        const at = fielderAt(plan, defense, e.pos, e.t);
        expect(dist([at.x, at.z], BASE_XZ[1])).toBeLessThan(2.6);
        expect(plan.throws.some((t) => t.from === pos && t.to === e.pos && t.toBase === 1)).toBe(true);
      }
      expect(n, `grounders to ${pos}`).toBeGreaterThan(0);
    }
  });
});

describe('force plays and double plays', () => {
  it('every force out and every double play has the ball and a man on the bag before the runner (random ground balls, all base situations)', () => {
    const rng = createRng(33);
    const defense = createDefense();
    const SETS = [[1, null, null], [1, 1, null], [1, 1, 1], [null, 1, null], [1, null, 1]];
    let force = 0, dp = 0;
    const problems = [];
    for (let i = 0; i < 1500; i++) {
      const c = contactOf(rng.range(40, 92), rng.range(-10, 6), rng.range(-42, 42));
      const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
      const plan = planPlay({ sim, contact: c, bases: SETS[i % SETS.length], outs: i % 3, defense }, CONFIG);
      if (plan.result === 'doublePlay') dp++;
      if (plan.result === 'fieldersChoice') force++;
      for (const p of auditPlan(plan, defense)) problems.push(p);
    }
    expect(problems).toEqual([]);
    expect(force).toBeGreaterThan(20);
    expect(dp).toBeGreaterThan(20);
  });

  it('a double play: the man on second has the ball and the bag, then the man on first gets the relay before the batter', () => {
    let seen = 0;
    for (let spray = -40; spray <= 40; spray += 2) {
      for (const ev of [50, 58, 66]) {
        const { plan, defense } = play(ev, -2, spray, { bases: [1, null, null], outs: 0 });
        if (plan.result !== 'doublePlay') continue;
        seen++;
        const outs = plan.events.filter((e) => e.type === 'out').sort((a, b) => a.t - b.t);
        expect(outs.map((e) => e.base)).toEqual([2, 1]);
        for (const e of outs) expect(dist([fielderAt(plan, defense, e.pos, e.t).x, fielderAt(plan, defense, e.pos, e.t).z], BASE_XZ[e.base])).toBeLessThan(2.6);
        expect(outs[1].t).toBeGreaterThan(outs[0].t);
        expect(outs[1].t).toBeLessThan(runnerArrival(CONFIG, 0, 1));
        expect(outs[0].t).toBeLessThan(runnerArrival(CONFIG, 1, 2));
        const relay = plan.throws.find((t) => t.toBase === 1);
        expect(relay.from).toBe(outs[0].pos); // the man who got the first out throws to first
      }
    }
    expect(seen).toBeGreaterThan(3);
  });

  it('if nobody can be on the bag in time for the force, there is no out at that base', () => {
    const d = createDefense();
    for (const pos of ['SS', '2B']) { d[pos].x = 0; d[pos].z = -300; d[pos].homeX = 0; d[pos].homeZ = -300; } // both middle infielders are nowhere near second
    for (let spray = -10; spray <= 40; spray += 5) {
      const { plan, defense } = play(46, -2, spray, { defense: d, bases: [1, null, null], outs: 0 });
      expect(plan.events.filter((e) => e.type === 'out' && e.base === 2 && (e.pos === 'SS' || e.pos === '2B')).length).toBe(0);
      expect(auditPlan(plan, defense)).toEqual([]);
    }
  });
});

describe('bunts', () => {
  it('every bunt play is a legal play, and a good sacrifice bunt usually moves the runner up', async () => {
    const { computeBunt } = await import('../src/game/contact.js');
    const rng = createRng(31);
    const defense = createDefense();
    const problems = [];
    let tries = 0, advanced = 0;
    for (let i = 0; i < 500; i++) {
      const c = computeBunt({ errorMs: rng.range(-25, 25), locX: rng.range(-0.5, 0.5), locY: rng.range(1.9, 3.0), aim: rng.next() < 0.5 ? -1 : 1, rng });
      if (!c.made) continue;
      const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
      const plan = planPlay({ sim, contact: c, bases: ['r1', null, null], outs: 0, defense }, CONFIG);
      const bad = auditPlan(plan, defense);
      if (bad.length) problems.push(`bunt ${i}: ${bad.join('; ')}`);
      if (plan.result === 'foul' || plan.caught) continue;
      tries++;
      const r1 = plan.moves.find((m) => m.from === 1);
      if (r1 && !r1.out && r1.to >= 2) advanced++;
    }
    expect(problems).toEqual([]);
    expect(tries).toBeGreaterThan(300);
    expect(advanced / tries).toBeGreaterThan(0.65);
  });
});
