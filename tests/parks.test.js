// Ballparks: every club's park has its own shape, wall heights and air; plays in all of them stay legal and keep everybody inside.
import { describe, it, expect, afterAll } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { simulateBattedBall, sampleBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { samplePath } from '../src/game/fielderMotion.js';
import { auditPlan } from '../src/game/playAudit.js';
import { setPark, parkId, fenceDistance, fenceHeightAt, isInsideField } from '../src/physics/field.js';
import { MLB_TEAMS } from '../src/game/mlb.js';

afterAll(() => setPark('sandlot'));

const hit = (ev, la, spray, backspin = 1800) => simulateBattedBall({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin, hook: 0, start: { x: 0, y: 2.6, z: -1 } });

describe('ballparks', () => {
  it('every club has a park; switching changes the fence and comes back to Sandlot Park exactly', () => {
    for (const t of MLB_TEAMS) expect(CONFIG.parks.list[t.id]).toBeTruthy();
    const cf = fenceDistance(0), dk = CONFIG.physics.dragK;
    expect(setPark('det')).toBe(true);
    expect(parkId()).toBe('det');
    expect(fenceDistance(0)).toBeCloseTo(412 * CONFIG.parks.scale, 3);
    setPark('sandlot');
    expect(fenceDistance(0)).toBeCloseTo(cf, 9);
    expect(CONFIG.physics.dragK).toBe(dk);
  });

  it('a Green Monster turns a home run into a ball off the wall; thin air carries a ball farther', () => {
    setPark('bos');
    expect(fenceHeightAt(-40)).toBeGreaterThan(30);
    expect(fenceHeightAt(30)).toBeLessThan(8);
    // a line drive to left that clears a ten-foot wall at Sandlot Park's distance
    let found = 0;
    for (let la = 16; la <= 26 && !found; la += 0.5) {
      setPark('sandlot'); const a = hit(100, la, -38);
      setPark('bos'); const b = hit(100, la, -38);
      if (a.homerun && !b.homerun && b.wallHit) found++;
    }
    expect(found).toBe(1);
    setPark('sandlot'); const sea = hit(98, 30, 0);
    setPark('col'); const den = hit(98, 30, 0);
    const far = (s) => (s.firstBounce ? Math.hypot(s.firstBounce.x, s.firstBounce.z) : 0) || (s.homerun ? 999 : 0);
    expect(far(den) >= far(sea) || (den.homerun && !sea.homerun) || den.homerun).toBe(true);
    setPark('sandlot');
  });

  it('in every park: plays stay legal and every fielder stays inside the ballpark', () => {
    const problems = [];
    for (const id of Object.keys(CONFIG.parks.list)) {
      setPark(id);
      const rng = createRng(id.charCodeAt(0) * 7 + id.length);
      for (let k = 0; k < 40; k++) {
        const c = { exitVelocity: rng.range(70, 108), launchAngle: rng.range(-5, 40), sprayAngle: rng.range(-44, 44), backspin: 1600, hook: 0 };
        const sim = hit(c.exitVelocity, c.launchAngle, c.sprayAngle, c.backspin);
        const defense = createDefense();
        const plan = planPlay({ sim, contact: c, bases: [rng.chance(0.4) ? 1 : null, rng.chance(0.3) ? 2 : null, null], outs: k % 3, defense }, CONFIG);
        for (const pr of auditPlan(plan, defense)) problems.push(`${id}: ${pr}`);
        for (const pos in plan.paths) for (let t = 0; t < plan.endTime; t += 0.25) {
          const q = samplePath(plan.paths[pos], t);
          if (!isInsideField(q.x, q.z, -0.5)) { problems.push(`${id}: ${pos} outside the park at ${t.toFixed(2)}`); break; }
        }
        void sampleBall;
      }
    }
    setPark('sandlot');
    expect(problems).toEqual([]);
  }, 60000);
});
