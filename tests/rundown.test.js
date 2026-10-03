// The play stays live until it is over: you can send a runner on or call him back as often as you like, and the defense answers
// from wherever the ball is - a runner caught between bases is run down and tagged (on the bag, or up the line).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, runnerOptions, tapOptions } from '../src/game/fielding.js';
import { samplePath } from '../src/game/fielderMotion.js';
import { runnerState } from '../src/game/runnerMotion.js';
import { auditPlan } from '../src/game/playAudit.js';
import { createRng } from '../src/util/rng.js';

const C = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900, hook: 0 });
const setup = (c, bases, outs = 0) => {
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const defense = createDefense();
  return { sim, contact: c, bases, outs, defense, orders: [] };
};
// give one more order and plan again, the way the engine does (everything before the tap stays as it was)
const order = (i, cur, o) => { i.orders = [...i.orders, o]; return planPlay({ ...i, prev: { paths: cur.paths, t: o.t } }, CONFIG); };
const moveOf = (p, from) => p.moves.find((m) => m.from === from && !m.back);

// Fielders never jump when a plan changes, runners never move faster than a sprint, and every out is a real one.
function checkStep(cur, next, t, defense, problems) {
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
  if (!(next.endTime > 0 && next.endTime < 40)) problems.push(`bad end time ${next.endTime}`);
}

describe('the live play', () => {
  it('the diamond stays up until the play is over (closed once the third out is made)', () => {
    const rng = createRng(3);
    let n = 0;
    for (let k = 0; k < 400 && n < 40; k++) {
      const i = setup(C(rng.range(80, 100), rng.range(6, 22), rng.range(-35, 35)), [1, null, null], Math.floor(rng.next() * 2));
      const p = planPlay(i, CONFIG);
      if (!['single', 'double'].includes(p.result)) continue;
      n++;
      const tLate = p.endTime - 0.2;
      expect(tapOptions(p, tLate).length + runnerOptions(p, tLate).length).toBeGreaterThan(0);
    }
    expect(n).toBeGreaterThan(20);
  });

  it('sent to third and the throw beats him: turn him back, send him again - he runs both ways, the fielders chase, every out is real', () => {
    const rng = createRng(11);
    const problems = [];
    let cases = 0, saved = 0, rundownOuts = 0, upTheLine = 0, throwsAfter = 0;
    for (let k = 0; k < 3000 && cases < 60; k++) {
      const i = setup(C(rng.range(82, 100), rng.range(4, 18), rng.range(-30, 30)), [null, 2, null], Math.floor(rng.next() * 2));
      let cur = planPlay(i, CONFIG);
      if (cur.result !== 'single' || !cur.send) continue;
      // send the runner on second to third as soon as the ball is down: find the plays where that gets him tagged at third
      const t1 = (cur.send.res ?? cur.send.from) + 0.05;
      const sent = order(i, cur, { base: 3, t: t1, from: 2 });
      const m = moveOf(sent, 2);
      if (!m || !m.out || m.outBase !== 3) { i.orders = []; continue; }
      cases++;
      checkStep(cur, sent, t1, i.defense, problems);
      cur = sent;
      // ...he is in trouble: call him back a moment before the tag (tap his dot)
      const t2 = m.outAt - 0.45;
      const back = runnerOptions(cur, t2).find((o) => o.from === 2);
      if (!back || back.back !== 2) { problems.push(`no call-back offered (${back && back.back})`); continue; }
      const b = order(i, cur, { base: 3, t: t2, from: 2, back: true });
      checkStep(cur, b, t2, i.defense, problems);
      const mb = moveOf(b, 2);
      if (mb.out && mb.outBase === 3 && mb.outAt > t2 + CONFIG.runner.sendReact) problems.push('still tagged at third after turning back');
      if (b.throws.length > cur.throws.length) throwsAfter++;
      cur = b;
      if (!mb.out) {
        saved++;
        // ...and send him again (he is safe on second, or on his way back)
        const t3 = t2 + 0.8;
        if (tapOptions(cur, t3).some((o) => o.base === 3 && o.from === 2)) {
          const again = order(i, cur, { base: 3, t: t3, from: 2 });
          checkStep(cur, again, t3, i.defense, problems);
          cur = again;
        }
      }
      for (const e of cur.events) if (e.type === 'out' && e.tag) { rundownOuts++; if (e.between) upTheLine++; }
    }
    expect([...new Set(problems)].slice(0, 10)).toEqual([]);
    expect(cases).toBeGreaterThan(20);
    expect(throwsAfter).toBeGreaterThan(5); // (the ball is thrown on to the other bag)
    expect(rundownOuts).toBeGreaterThan(5);
    expect(upTheLine).toBeGreaterThan(3); // (some tags go on up the line, not on the bag)
    void saved;
  }, 120000);

  it('random taps all through the play, back and forth: nothing ever jumps, every out stays legal, every play ends', () => {
    const rng = createRng(23);
    const problems = [];
    let chains = 0, late = 0;
    for (let k = 0; k < 2500 && chains < 160; k++) {
      const i = setup(C(rng.range(70, 105), rng.range(-5, 32), rng.range(-40, 40)), [rng.chance(0.5) ? 1 : null, rng.chance(0.5) ? 2 : null, rng.chance(0.3) ? 3 : null], Math.floor(rng.next() * 2));
      let cur = planPlay(i, CONFIG);
      if (!cur.send || cur.homer) continue;
      chains++;
      let t = cur.send.from;
      for (let q = 0; q < 7; q++) {
        t += rng.range(0.3, 1.4);
        if (t >= cur.endTime - 0.05) break;
        const opts = runnerOptions(cur, t);
        const o = opts[Math.floor(rng.next() * opts.length)];
        if (!o) continue;
        const kind = o.back !== null && rng.chance(0.5) ? 'back' : o.send ? 'send' : null;
        if (!kind) continue;
        if (t > (cur.send.main ?? Infinity)) late++;
        const next = order(i, cur, kind === 'send' ? { base: o.send, t, from: o.from } : { base: o.goal, t, from: o.from, back: true });
        checkStep(cur, next, t, i.defense, problems);
        // two runners never end on one base
        const ends = next.moves.filter((m) => !m.out && !m.back && m.to < 4).map((m) => m.to);
        if (new Set(ends).size !== ends.length) problems.push('two runners on one base');
        cur = next;
      }
    }
    expect([...new Set(problems)].slice(0, 10)).toEqual([]);
    expect(chains).toBeGreaterThan(100);
    expect(late).toBeGreaterThan(100); // (plenty of the taps come after the old send window closed)
  }, 180000);
});
