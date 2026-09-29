// When a play makes the third out, the inning is over: runners still on their way ease up and stop instead of running on
// round the bases (the picture used to show a runner crossing the plate ~1.5 s after the inning-ending out).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { runnerState } from '../src/game/runnerMotion.js';
import { createRng } from '../src/util/rng.js';

const lastOutTime = (plan) => {
  let t = -1;
  for (const m of plan.moves) if (m.out && m.outAt !== undefined) t = Math.max(t, m.outAt);
  if (plan.caught) t = Math.max(t, plan.catchT);
  return t;
};

describe('the third out ends the play', () => {
  it('runners stop soon after the third out and never reach a base they had not reached by then', () => {
    const rng = createRng(11);
    const defense = createDefense();
    const problems = [];
    let thirdOutPlays = 0, stopped = 0;
    for (let i = 0; i < 1500; i++) {
      const c = { exitVelocity: rng.range(45, 100), launchAngle: rng.range(-12, 40), sprayAngle: rng.range(-44, 44), backspin: 900, hook: 0 };
      const bases = [rng.next() < 0.7 ? 'a' : null, rng.next() < 0.6 ? 'b' : null, rng.next() < 0.6 ? 'c' : null];
      const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
      const plan = planPlay({ sim, contact: c, bases, outs: 2, defense }, CONFIG);
      if (plan.outsMade < 1 || plan.homer || plan.result === 'foul') continue;
      thirdOutPlays++;
      const tOut = lastOutTime(plan);
      if (plan.endTime > Math.max(tOut + 2.5, ...plan.throws.map((t) => t.t1 + 0.5))) problems.push(`play ${i} lasts ${plan.endTime.toFixed(2)} s, the out was at ${tOut.toFixed(2)} s`);
      for (const m of plan.moves) {
        if (m.out || m.to <= m.from) continue;
        const atOut = runnerState(m, tOut + CONFIG.runner.easeUpReact, CONFIG, {});
        const atEnd = runnerState(m, plan.endTime + 3, CONFIG, {});
        if (m.stopAt !== undefined) stopped++;
        if (!atEnd.done) problems.push(`play ${i}: runner from ${m.from} still running long after the play`);
        // the distance he covers after the out is only what it takes to ease up
        const coast = atEnd.s - atOut.s;
        if (coast > 14) problems.push(`play ${i}: runner from ${m.from} ran ${coast.toFixed(1)} ft after the third out`);
      }
      if (plan.events.some((e) => e.type === 'safe' && e.t > tOut + 0.3)) problems.push(`play ${i}: a 'safe' call after the inning was over`);
    }
    expect(thirdOutPlays).toBeGreaterThan(300);
    expect(stopped).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  }, 60000);

  it('with fewer than two outs nothing changes: runners still run to their bases', () => {
    const c = { exitVelocity: 70, launchAngle: -4, sprayAngle: -20, backspin: 900, hook: 0 };
    const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
    const plan = planPlay({ sim, contact: c, bases: ['a', 'b', 'c'], outs: 0, defense: createDefense() }, CONFIG);
    expect(plan.moves.every((m) => m.stopAt === undefined)).toBe(true);
  });
});
