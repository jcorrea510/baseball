// The landing spot ring: where a ball hit in the air will come down, and how the ring looks at each moment. Pure logic (the picture is
// render/landingRing.js). The spot is the ball's real first touch of the grass from the flight simulation, so it is exact.
import { CONFIG } from '../config.js';
import { clamp } from '../util/math.js';

const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/**
 * Where does this batted ball come down on the field? Returns null when there is nothing to show: a grounder or low liner, a home run,
 * or a ball that hits the wall (or the stands) before it ever lands on the grass.
 * @returns {{x:number, z:number, tLand:number, tEnd:number, caught:boolean, tStart:number}|null}  times are seconds after contact
 */
export function landingSpot(sim, plan, cfg = CONFIG) {
  const L = cfg.landing;
  if (!sim || !sim.firstBounce || sim.homerun || (plan && plan.homer)) return null;
  const fb = sim.firstBounce;
  if (sim.wallHit && sim.wallHit.t < fb.t) return null; // it hits the wall first: it never lands on the grass
  if (sim.standsLanding && sim.standsLanding.t < fb.t) return null;
  if (sim.apex.y < L.minApex || fb.t < L.minFlight) return null;
  const caught = !!(plan && plan.caught);
  return { x: fb.x, z: fb.z, tLand: fb.t, tEnd: caught ? Math.min(plan.catchT, fb.t) : fb.t, caught, tStart: Math.min(L.delay, fb.t * 0.5) };
}

/**
 * How the ring looks `t` seconds after contact.
 * @returns {{visible:boolean, x:number, z:number, radius:number, alpha:number}}
 */
export function landingRing(spot, t, cfg = CONFIG) {
  const L = cfg.landing;
  if (!spot || t < spot.tStart || t >= spot.tEnd) return { visible: false, x: 0, z: 0, radius: L.radiusStart, alpha: 0 };
  // it shrinks all the way to the moment the ball would land (even if a fielder catches it first and the ring goes away early)
  const remaining = clamp((spot.tLand - t) / Math.max(1e-6, spot.tLand - spot.tStart), 0, 1);
  return {
    visible: true, x: spot.x, z: spot.z,
    radius: L.radiusEnd + (L.radiusStart - L.radiusEnd) * remaining,
    alpha: L.alpha * smooth((t - spot.tStart) / Math.max(1e-6, L.fadeIn)),
  };
}
