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
  const caught = !!(plan && (plan.caught || plan.dropped) && plan.catchPos && plan.catchT <= fb.t);
  // The ring marks where the ball's flight really ends: the grass where it lands, or - when a fielder catches it - the spot under the
  // catch (a running catch is often several feet short of where it would have landed, and the ring must agree with the picture).
  const x = caught ? plan.catchPos.x : fb.x, z = caught ? plan.catchPos.z : fb.z;
  const tEnd = caught ? plan.catchT : fb.t;
  return { x, z, tLand: tEnd, tEnd, caught, tStart: Math.min(L.delay, tEnd * 0.5) };
}

/**
 * How the ring looks `t` seconds after contact.
 * @returns {{visible:boolean, x:number, z:number, radius:number, alpha:number}}
 */
export function landingRing(spot, t, cfg = CONFIG) {
  const L = cfg.landing;
  if (!spot || t < spot.tStart || t >= spot.tEnd) return { visible: false, x: 0, z: 0, radius: L.radiusStart, alpha: 0 };
  // it shrinks all the way to the moment the flight ends (the landing, or the catch)
  const remaining = clamp((spot.tLand - t) / Math.max(1e-6, spot.tLand - spot.tStart), 0, 1);
  return {
    visible: true, x: spot.x, z: spot.z,
    radius: L.radiusEnd + (L.radiusStart - L.radiusEnd) * remaining,
    alpha: L.alpha * smooth((t - spot.tStart) / Math.max(1e-6, L.fadeIn)),
  };
}
