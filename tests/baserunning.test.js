// Runners read the ball, take one base on their own, go further only when you send them (and are tagged out or just safe), and
// hold on caught balls.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, sendOptions } from '../src/game/fielding.js';
import { runnerState, moveArrival, leadSpot } from '../src/game/runnerMotion.js';
import { BASE_XZ } from '../src/physics/field.js';
import { auditPlan } from '../src/game/playAudit.js';
import * as rules from '../src/game/rules.js';
import { createRng } from '../src/util/rng.js';

const plan = (c, o = {}) => {
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const defense = createDefense();
  if (o.slow) for (const k in defense) { defense[k].speed *= 0.05; defense[k].react += 9; } // (nobody gets to anything: the same ball drops)
  const i = { sim, contact: c, bases: o.bases || [null, null, null], outs: o.outs ?? 0, defense, orders: o.orders || [] };
  return { plan: planPlay(i, CONFIG), defense, i };
};
const C = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900, hook: 0 });

// Where every runner of a plan is at time t (the batter is 0).
const spots = (p, t) => Object.fromEntries(p.moves.map((m) => { const q = runnerState(m, t, CONFIG, {}); return [m.from, [q.x, q.z]]; }));

describe('sending runners', () => {
  it('on their own runners take one base at most (more only when it is safe by a mile): the batter stops at first', () => {
    const rng = createRng(2);
    let hits = 0, gap = 0;
    for (let k = 0; k < 600; k++) {
      const { plan: p } = plan(C(rng.range(55, 105), rng.range(-4, 30), rng.range(-40, 40)), { bases: [1, rng.chance(0.4) ? 2 : null, rng.chance(0.3) ? 3 : null] });
      if (!['single', 'double', 'triple', 'insideParkHomer', 'error'].includes(p.result)) continue;
      hits++;
      for (const m of p.moves) if (!m.back && !m.out && m.to - m.from > 1) expect(m.auto).toBe(true);
      if (p.batterDest > 1) expect(p.moves.find((m) => m.from === 0).auto).toBe(true);
      if (p.send && p.fielder && ['LF', 'CF', 'RF'].includes(p.fielder)) gap++;
    }
    expect(hits).toBeGreaterThan(100);
    expect(gap).toBeGreaterThan(30); // (balls to the outfield leave time to send runners)
  });

  it('a send is taken from the moment the ball is hit until just after the fielder is ready to throw', () => {
    const rng = createRng(5);
    let n = 0;
    for (let k = 0; k < 400 && n < 40; k++) {
      const c = C(rng.range(80, 100), rng.range(8, 22), rng.range(-30, 30));
      const base = plan(c);
      if (!base.plan.send || base.plan.result !== 'single') continue;
      n++;
      const early = plan(c, { orders: [{ base: 2, t: base.plan.send.from - 0.3 }] }).plan;
      const late = plan(c, { orders: [{ base: 2, t: base.plan.send.by + 0.3 }] }).plan;
      expect(early.batterDest).toBe(1);
      expect(late.batterDest).toBe(1);
      const ok = plan(c, { orders: [{ base: 2, t: base.plan.send.from + 0.05 }] }).plan;
      expect(ok.moves.find((m) => m.from === 0).sent).toBe(true);
    }
    expect(n).toBeGreaterThan(20);
  });

  it('nothing changes before the tap: every runner is exactly where he was until he reacts', () => {
    const rng = createRng(7);
    let n = 0;
    for (let k = 0; k < 1500 && n < 120; k++) {
      const c = C(rng.range(70, 105), rng.range(0, 28), rng.range(-42, 42));
      const bases = [rng.chance(0.5) ? 1 : null, rng.chance(0.4) ? 2 : null, rng.chance(0.3) ? 3 : null];
      const a = plan(c, { bases }).plan;
      if (!a.send) continue;
      const tap = a.send.from + rng.next() * (a.send.by - a.send.from);
      const opts = sendOptions(a, tap);
      if (!opts.length) continue;
      const o = opts[Math.floor(rng.next() * opts.length)];
      const b = plan(c, { bases, orders: [{ base: o.base, t: tap, from: o.from, back: o.kind === 'back' }] }).plan;
      if (!b.moves.some((m) => m.sent || m.wasSent)) continue;
      n++;
      for (let t = 0; t <= tap + CONFIG.runner.sendReact; t += 0.05) {
        const sa = spots(a, t), sb = spots(b, t);
        for (const k2 in sa) expect(Math.hypot(sa[k2][0] - sb[k2][0], sa[k2][1] - sb[k2][1])).toBeLessThan(0.05);
      }
      // ...and after it he never jumps: at most top speed between frames
      for (const m of b.moves) {
        let prev = null;
        for (let t = 0; t < Math.min(b.endTime, (m.outAt ?? 99) + CONFIG.runner.walkOffDelay); t += 1 / 60) {
          const q = runnerState(m, t, CONFIG, {});
          if (prev) expect(Math.hypot(q.x - prev[0], q.z - prev[1])).toBeLessThan(CONFIG.runner.speed * 1.25 / 60 + 0.02);
          prev = [q.x, q.z];
        }
      }
    }
    expect(n).toBeGreaterThan(60);
  }, 60000);

  it('across thousands of plays: runners sent too far are tagged out, the others are safe, and the referee finds nothing wrong', () => {
    const rng = createRng(9);
    let outs = 0, safe = 0, sent = 0, scored = 0;
    const problems = [];
    for (let k = 0; k < 3000; k++) {
      const c = C(rng.range(50, 105), rng.range(-6, 40), rng.range(-44, 44));
      const bases = [rng.chance(0.4) ? 1 : null, rng.chance(0.3) ? 2 : null, rng.chance(0.25) ? 3 : null];
      const outsNow = Math.floor(rng.next() * 3);
      const first = plan(c, { bases, outs: outsNow }).plan;
      if (!first.send) continue;
      // one or two taps somewhere in the window, on bases that are open to a send
      const orders = [];
      const taps = rng.chance(0.3) ? 2 : 1;
      let cur = first;
      for (let q = 0; q < taps; q++) {
        const t = Math.max(orders.length ? orders[orders.length - 1].t : 0, cur.send.from + rng.next() * (cur.send.by - cur.send.from));
        const opts = sendOptions(cur, t);
        if (!opts.length) break;
        const o = opts[Math.floor(rng.next() * opts.length)];
        orders.push({ base: o.base, t, from: o.from, back: o.kind === 'back' });
        cur = plan(c, { bases, outs: outsNow, orders }).plan;
      }
      const { plan: p, defense } = plan(c, { bases, outs: outsNow, orders });
      if (!p.moves.some((m) => m.sent || m.wasSent || m.recalled)) continue;
      sent++;
      if (p.sentOut) {
        outs++;
        // the tag goes on as he gets there (an out call at that moment), and the play lasts long enough to see it
        const mv = p.moves.find((m) => m.out && m.walkOff && m.outBase === p.outNote.base);
        expect(mv).toBeTruthy();
        expect(p.events.some((x) => x.type === 'out' && x.base === mv.outBase && Math.abs(mv.outAt - x.t) < 1e-6)).toBe(true);
        if (!(p.endTime >= mv.outAt + CONFIG.runner.outLinger - 0.36)) problems.push('play ends right after the tag');
      } else safe++;
      if (p.moves.some((m) => m.sent && m.to === 4)) scored++;
      problems.push(...auditPlan(p, defense));
      if (!(p.endTime > 0 && p.endTime < 25)) problems.push('bad end time');
      // nobody shares a base, nobody passes anybody
      const ends = p.moves.filter((m) => !m.out && !m.back && m.to < 4).map((m) => m.to);
      if (new Set(ends).size !== ends.length) problems.push('two runners on one base');
    }
    expect(problems).toEqual([]);
    expect(sent).toBeGreaterThan(300);
    expect(outs).toBeGreaterThan(20); // (most random sends are too greedy - a routine single is a single)
    expect(safe).toBeGreaterThan(100);
    expect(scored).toBeGreaterThan(10);
  }, 120000);

  it('a batter who takes an extra base while the throw goes home is credited with a single ("on the throw"), not a double', () => {
    const rng = createRng(23);
    const BASE = { single: 1, double: 2, triple: 3, insideParkHomer: 4 };
    let onThrow = 0, hits = 0;
    const problems = [];
    for (let k = 0; k < 600; k++) {
      const c = C(rng.range(80, 100), rng.range(4, 16), rng.range(-35, 35));
      const bases = [null, 2, null];
      const first = plan(c, { bases }).plan;
      if (first.result !== 'single' || !first.send) continue;
      // send the runner on second home and the batter on to second, as soon as the pad offers them
      const orders = [];
      let cur = first;
      for (let t = first.send.from; t <= cur.send.by && orders.length < 2; t += 0.1) {
        for (const o of sendOptions(cur, t)) {
          if (o.kind !== 'send' || orders.some((q) => q.from === o.from)) continue;
          if ((o.from === 2 && o.base === 4) || (o.from === 0 && o.base === 2)) { orders.push({ base: o.base, t, from: o.from }); cur = plan(c, { bases, orders }).plan; break; }
        }
      }
      const p = cur;
      if (!(p.result in BASE) || !p.batterDest) continue;
      hits++;
      if (BASE[p.result] + (p.onThrow || 0) !== p.batterDest) problems.push(`${p.result} + ${p.onThrow} on the throw != base ${p.batterDest}`);
      if (p.onThrow) onThrow++;
    }
    expect(problems).toEqual([]);
    expect(hits).toBeGreaterThan(50);
    expect(onThrow).toBeGreaterThan(5);
  }, 120000);

  it('a ball in the gap or off the wall: he makes second - by himself, or when you send him as soon as it is down', () => {
    const rng = createRng(17);
    let n = 0, made = 0, alone = 0;
    for (let k = 0; k < 3000 && n < 80; k++) {
      const c = C(rng.range(88, 108), rng.range(12, 30), rng.range(-40, 40));
      const base = plan(c).plan;
      if (!['single', 'double'].includes(base.result) || !base.send || base.ballLandDistance < 300) continue;
      n++;
      if (base.batterDest >= 2) alone++;
      const p = plan(c, { orders: [{ base: 2, t: base.send.from }] }).plan;
      if (p.batterDest >= 2) made++;
    }
    expect(n).toBeGreaterThan(30);
    expect(made / n).toBeGreaterThan(0.7);
    expect(alone / n).toBeGreaterThan(0.4); // (a plain double needs no order)
  }, 60000);

  it('the throw goes after the runner you sent when it can get him', () => {
    // a single to left-centre with a runner on second: send him home late and the throw beats him
    const rng = createRng(13);
    let tested = 0;
    for (let k = 0; k < 800 && tested < 15; k++) {
      const c = C(rng.range(85, 100), rng.range(6, 16), rng.range(-25, 5));
      const base = plan(c, { bases: [null, 2, null] }).plan;
      if (base.result !== 'single' || !base.send || base.moves.find((m) => m.from === 2).to !== 3) continue;
      const p = plan(c, { bases: [null, 2, null], orders: [{ base: 4, t: base.send.decide }] }).plan;
      const th = p.throws[p.throws.length - 1];
      if (p.sentOut) { tested++; expect(th.toBase).toBe(4); expect(p.events.some((e) => e.type === 'out' && e.base === 4)).toBe(true); }
    }
    expect(tested).toBeGreaterThan(3);
  });

  it('a time play: a run that crossed the plate before the third-out tag still counts', () => {
    const g = rules.createGame();
    g.outs = 2; g.bases = ['a', 'b', null];
    const res = rules.applyPlay(g, { result: 'single', batterDest: 0, moves: [{ from: 2, to: 4, out: false, before: true }, { from: 1, to: 3, out: false, before: false }], outsMade: 1, timePlay: true }, 'bat');
    expect(res.runs).toBe(1);
    expect(g.score.top).toBe(1);
    const h = rules.createGame();
    h.outs = 2; h.bases = ['a', null, null];
    expect(rules.applyPlay(h, { result: 'groundout', batterDest: 0, moves: [{ from: 1, to: 4, out: false, before: true }], outsMade: 1 }, 'bat').runs).toBe(0); // (a force / batter out: no run)
  });
});

describe('reading the ball', () => {
  it('on a ball in the air every runner does exactly the same whether it is caught or not, until it is', () => {
    const rng = createRng(4);
    let n = 0;
    for (let k = 0; k < 400 && n < 40; k++) {
      const c = C(rng.range(75, 98), rng.range(18, 45), rng.range(-35, 35));
      const bases = [rng.chance(0.6) ? 1 : null, rng.chance(0.5) ? 2 : null, rng.chance(0.5) ? 3 : null];
      const outsNow = rng.chance(0.3) ? 1 : 0;
      const a = plan(c, { bases, outs: outsNow }).plan;
      if (!a.caught || !a.fair) continue;
      const b = plan(c, { bases, outs: outsNow, slow: true }).plan;
      if (b.caught || b.homer) continue;
      n++;
      const tEnd = Math.min(a.catchT, b.airRes ?? b.downT);
      for (const m of a.moves) {
        const mb = b.moves.find((q) => q.from === m.from);
        expect(mb).toBeTruthy();
        for (let t = 0; t < tEnd; t += 0.1) {
          const qa = runnerState(m, t, CONFIG, {}), qb = runnerState(mb, t, CONFIG, {});
          expect(Math.hypot(qa.x - qb.x, qa.z - qb.z)).toBeLessThan(0.05);
        }
      }
      // ...and the diamond offers the same bases
      for (let t = 0.1; t < tEnd; t += 0.3) expect(sendOptions(a, t)).toEqual(sendOptions(b, t));
    }
    expect(n).toBeGreaterThan(15);
  });

  it('on a grounder runners go at once', () => {
    const rng = createRng(4);
    let ground = 0;
    for (let k = 0; k < 300; k++) {
      const b = plan(C(rng.range(60, 90), rng.range(-8, 2), rng.range(-30, 30)), { bases: [null, 2, null] }).plan;
      const g = b.moves.find((q) => q.from === 2 && !q.back);
      if (g && g.to > 2) { ground++; expect(g.tStart === undefined || g.tStart <= CONFIG.runner.startDelay + 1e-9).toBe(true); }
    }
    expect(ground).toBeGreaterThan(5);
  });

  it('a caught fly ball: runners who were not sent end up back on their bag', () => {
    const { plan: p } = plan(C(85, 34, 4), { bases: [1, 2, null] });
    expect(p.caught).toBe(true);
    for (const b of [1, 2]) {
      const m = p.moves.find((q) => q.from === b);
      expect(m).toBeTruthy();
      expect(m.to).toBe(b);
      const q = runnerState(m, p.endTime, CONFIG, {});
      expect(Math.hypot(q.x - BASE_XZ[b][0], q.z - BASE_XZ[b][1])).toBeLessThan(1);
    }
  });
});

describe('changing your mind', () => {
  const singles = (seed, bases, max = 40) => {
    const rng = createRng(seed);
    const out = [];
    for (let k = 0; k < 2000 && out.length < max; k++) {
      const c = C(rng.range(80, 100), rng.range(4, 18), rng.range(-30, 30));
      const p = plan(c, { bases }).plan;
      if (p.result === 'single' && p.fielder && ['LF', 'CF', 'RF'].includes(p.fielder)) out.push({ c, p });
    }
    return out;
  };
  it('tap the base again and the runner you sent goes back (and is safe when he can get back in time)', () => {
    let n = 0, home = 0;
    for (const { c, p } of singles(21, [null, null, null])) {
      const t1 = p.send.res !== undefined ? p.send.res + 0.2 : 0.4;
      if (!sendOptions(p, t1).some((o) => o.base === 2 && o.kind === 'send')) continue;
      const sent = plan(c, { orders: [{ base: 2, t: t1, from: 0 }] }).plan;
      const t2 = t1 + 0.5;
      const back = sendOptions(sent, t2).find((o) => o.base === 2);
      if (!back) continue;
      expect(back.kind).toBe('back');
      const q = plan(c, { orders: [{ base: 2, t: t1, from: 0 }, { base: 2, t: t2, from: 0, back: true }] });
      n++;
      const m = q.plan.moves.find((x) => x.from === 0);
      expect(m.recalled).toBe(true);
      if (!m.out) { home++; expect(m.to).toBe(1); expect(moveArrival(CONFIG, m, 1)).toBeGreaterThan(t2); }
      expect(auditPlan(q.plan, q.defense)).toEqual([]);
    }
    expect(n).toBeGreaterThan(10);
    expect(home / n).toBeGreaterThan(0.6);
  });

  it('a runner sent on a fly ball that is caught has to get back: he can be doubled off', () => {
    const rng = createRng(31);
    let n = 0, doubled = 0;
    for (let k = 0; k < 2000 && n < 60; k++) {
      const c = C(rng.range(70, 95), rng.range(15, 40), rng.range(-35, 35));
      const a = plan(c, { bases: [1, null, null] }).plan;
      if (!a.caught || !a.fair) continue;
      const t = Math.min(a.catchT - 0.2, 0.3 + rng.next() * a.catchT);
      const o = sendOptions(a, t).find((x) => x.from === 1);
      if (!o) continue;
      const q = plan(c, { bases: [1, null, null], orders: [{ base: o.base, t, from: 1 }] });
      n++;
      const m = q.plan.moves.find((x) => x.from === 1);
      expect(m.wasSent).toBe(true);
      if (m.out) { doubled++; expect(q.plan.result).toBe('doublePlay'); expect(q.plan.outsMade).toBe(2); }
      else expect(m.to).toBe(1);
      expect(auditPlan(q.plan, q.defense)).toEqual([]);
    }
    expect(n).toBeGreaterThan(30);
    expect(doubled).toBeGreaterThan(0);
  });

  it('after the catch you can send a runner to tag up; the throw gets him when it beats him', () => {
    const rng = createRng(33);
    let n = 0, scored = 0, out = 0;
    for (let k = 0; k < 3000 && n < 60; k++) {
      const c = C(rng.range(75, 95), rng.range(22, 40), rng.range(-35, 35));
      const a = plan(c, { bases: [null, null, 3] }).plan;
      if (!a.caught || !a.fair || a.result === 'sacFly') continue;
      const t = a.catchT + 0.1;
      const o = sendOptions(a, t).find((x) => x.base === 4);
      if (!o) continue;
      const q = plan(c, { bases: [null, null, 3], orders: [{ base: 4, t, from: 3 }] });
      n++;
      const m = q.plan.moves.find((x) => x.from === 3);
      if (m.out) out++; else { scored++; expect(m.to).toBe(4); expect(q.plan.result).toBe('sacFly'); }
      expect(auditPlan(q.plan, q.defense)).toEqual([]);
    }
    expect(n).toBeGreaterThan(30);
    expect(out).toBeGreaterThan(3); // (the deep ones he scores on by himself: what is left to send him on is mostly too shallow)
    void scored;
  });
});

describe('changing your mind, again and again', () => {
  it('every tap: fielders carry on exactly where they were, runners turn round for real, and every out stays legal', async () => {
    const { runnerOptions } = await import('../src/game/fielding.js');
    const { samplePath } = await import('../src/game/fielderMotion.js');
    const rng = createRng(41);
    const problems = [];
    let chains = 0, turns = 0;
    for (let k = 0; k < 2500 && chains < 250; k++) {
      const c = C(rng.range(70, 105), rng.range(-5, 35), rng.range(-40, 40));
      const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
      const bases = [rng.chance(0.5) ? 1 : null, rng.chance(0.5) ? 2 : null, rng.chance(0.3) ? 3 : null];
      const defense = createDefense();
      const i = { sim, contact: c, bases, outs: Math.floor(rng.next() * 2), defense, orders: [] };
      let cur = planPlay(i, CONFIG);
      if (!cur.send) continue;
      chains++;
      let t = cur.send.from;
      for (let q = 0; q < 4; q++) {
        t += rng.range(0.2, 0.9);
        const opts = runnerOptions(cur, t);
        const o = opts[Math.floor(rng.next() * opts.length)];
        if (!o) break;
        const kind = o.back !== null && rng.chance(0.5) ? 'back' : o.send ? 'send' : o.canTag ? 'tag' : null;
        if (!kind) break;
        const order = kind === 'send' ? { base: o.send, t, from: o.from } : kind === 'back' ? { base: o.goal, t, from: o.from, back: true } : { base: o.from, t, from: o.from, tag: o.tag !== true };
        if (kind === 'back') turns++;
        i.orders = [...i.orders, order];
        const next = planPlay({ ...i, prev: { paths: cur.paths, t } }, CONFIG);
        for (const pos in defense) {
          const a = cur.paths[pos], b = next.paths[pos];
          const pa = a && a.length ? samplePath(a, t + 0.05) : defense[pos], pb = b && b.length ? samplePath(b, t + 0.05) : defense[pos];
          if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > 0.05) problems.push(`${pos} jumps at a tap`);
        }
        problems.push(...auditPlan(next, defense));
        for (const m of next.moves) {
          let prev = null;
          for (let tt = 0; tt < Math.min(next.endTime, (m.outAt ?? 99) + 1); tt += 1 / 30) {
            const s = runnerState(m, tt, CONFIG, {});
            if (prev && Math.hypot(s.x - prev[0], s.z - prev[1]) > CONFIG.runner.speed * 1.3 / 30 + 0.05) { problems.push(`runner from ${m.from} jumps`); break; }
            prev = [s.x, s.z];
          }
        }
        cur = next;
      }
    }
    expect([...new Set(problems)].slice(0, 10)).toEqual([]);
    expect(chains).toBeGreaterThan(150);
    expect(turns).toBeGreaterThan(50);
  }, 120000);
});
