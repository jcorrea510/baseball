// Ballpark geometry: bases, fence shape, fair/foul, grandstand profile.
// Coordinates: origin = back tip of home plate, +x = right field side, -z = toward center field.
import { CONFIG } from '../config.js';
import { DEG } from '../util/math.js';

const B = CONFIG.field.baseDistance / Math.SQRT2;

// Index 0 = home, 1..3 = bases, 4 = home again (scoring). Each is [x, z].
export const BASE_XZ = [
  [0, 0],
  [B, -B],
  [0, -2 * B],
  [-B, -B],
  [0, 0],
];

export const MOUND_XZ = [0, -CONFIG.field.moundDistance];

export function polar(sprayDeg, dist) {
  const a = sprayDeg * DEG;
  return { x: Math.sin(a) * dist, z: -Math.cos(a) * dist };
}

// Spray angle (degrees) of a point seen from home plate. 0 = straight to center.
export function sprayOf(x, z) {
  return Math.atan2(x, -z) / DEG;
}

// ---------------------------------------------------------------------------------------------------------------
// The ballpark in use (config.parks): Sandlot Park unless setPark() picked another. Changing it changes the fence curve, the wall
// heights, the air and the outline every fielder and every ball uses; the stadium is drawn again (render/scene.js setPark).
// ---------------------------------------------------------------------------------------------------------------
const SANDLOT = { fencePoints: CONFIG.field.fencePoints.map((p) => p.slice()), fenceHeight: CONFIG.field.fenceHeight, dragK: CONFIG.physics.dragK };
const SPRAYS = [-45, -22.5, 0, 22.5, 45];
let PARK = { id: 'sandlot', ...CONFIG.parks.list.sandlot };
let WALLS = SPRAYS.map((a) => [a, SANDLOT.fenceHeight]);
export const parkId = () => PARK.id;
export const currentPark = () => PARK;
/** Use ballpark `id` (a key of config.parks.list; unknown = Sandlot Park). Returns true when it changed. */
export function setPark(id) {
  const P = CONFIG.parks.list[id] ? id : 'sandlot';
  if (P === PARK.id) return false;
  const def = CONFIG.parks.list[P];
  PARK = { id: P, ...def };
  if (P === 'sandlot' || !def.fence) {
    CONFIG.field.fencePoints = SANDLOT.fencePoints.map((p) => p.slice());
    CONFIG.field.fenceHeight = SANDLOT.fenceHeight;
    WALLS = SPRAYS.map((a) => [a, SANDLOT.fenceHeight]);
  } else {
    const k = CONFIG.parks.scale;
    const fp = SPRAYS.map((a, i) => [a, def.fence[i] * k]).concat((def.extra || []).map(([a, d]) => [a, d * k]));
    CONFIG.field.fencePoints = fp.sort((p, q) => p[0] - q[0]);
    WALLS = SPRAYS.map((a, i) => [a, def.walls[i]]);
    CONFIG.field.fenceHeight = def.walls[2];
  }
  CONFIG.physics.dragK = SANDLOT.dragK * (def.air || 1);
  PLAYABLE = buildPlayable();
  return true;
}

// Catmull-Rom through the fence control points so the wall curves smoothly.
export function fenceDistance(sprayDeg) {
  const pts = CONFIG.field.fencePoints;
  const a = Math.max(pts[0][0], Math.min(pts[pts.length - 1][0], sprayDeg));
  let i = 0;
  while (i < pts.length - 2 && a > pts[i + 1][0]) i++;
  const p0 = pts[Math.max(0, i - 1)][1];
  const p1 = pts[i][1];
  const p2 = pts[i + 1][1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)][1];
  const t = (a - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** How high the outfield wall is at this spray angle (a ball must clear it to be a home run). */
export function fenceHeightAt(sprayDeg) {
  const a = Math.max(-45, Math.min(45, sprayDeg));
  let i = 0;
  while (i < WALLS.length - 2 && a > WALLS[i + 1][0]) i++;
  const [a0, h0] = WALLS[i], [a1, h1] = WALLS[i + 1];
  const u = (a - a0) / (a1 - a0);
  // (a wall height changes over a few feet, not gradually all the way between the five points)
  const s = Math.max(0, Math.min(1, (u - 0.42) / 0.16));
  return h0 + (h1 - h0) * s;
}
/** The tallest stretch of wall (for drawing). */
export const maxFenceHeight = () => Math.max(...WALLS.map((w) => w[1]));

/** (Sandlot Park's wall height; a park's walls vary - use fenceHeightAt.) */
export const FENCE_HEIGHT = CONFIG.field.fenceHeight;

// Fair territory: in front of the plate and between the foul lines.
export function isFairXZ(x, z) {
  return z < 0 && Math.abs(x) <= -z + 1e-6;
}

// Height of the grandstand seating surface beyond the fence (`over` feet past the wall).
// It rises at a constant slope, then flattens into the "roof" level; a ball must
// clear that level to leave the park entirely.
export function standsHeight(over, sprayDeg = 0) {
  const s = CONFIG.field.stands;
  return fenceHeightAt(sprayDeg) + Math.min(Math.max(over, 0), s.depth) * s.slope;
}

export function distanceFromHome(x, z) {
  return Math.hypot(x, z);
}

// Distance between two [x,z] points.
export function distXZ(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// ---------------------------------------------------------------------------------------------------------------
// Where can a person stand? The ballpark outline: the outfield wall, the foul-territory walls and the backstop
// (the same shape the stadium is drawn with, see render/perimeter.js). Fielders are kept inside it.
// ---------------------------------------------------------------------------------------------------------------
// How far outside the foul line the foul-territory wall stands, s feet from home (the stands are drawn along the same line).
export const foulWallOffset = (s) => 12 + 58 * Math.pow(1 - s / 315, 1.15);
const lineXZ = (sd, s, w) => [sd * Math.SQRT1_2 * (s + w), Math.SQRT1_2 * (w - s)]; // s feet down the line, w feet outside it

// The dugouts: set into the foul-territory wall between s0 and s1 feet down each line, sticking `depth` feet out into foul
// territory. Shared by the picture (render/stadium.js) and the ballpark outline, so a fielder chasing a foul pop stops at the
// dugout rail instead of running through it. sd: +1 = first-base side, -1 = third-base side.
export const DUGOUT = { s0: 64, s1: 106, depth: 8 };
export function dugoutSpot(sd) {
  const wall = (s) => { // the wall runs straight between its control points at 60 and 110 ft
    const u = (s - 60) / 50, w = foulWallOffset(60) + (foulWallOffset(110) - foulWallOffset(60)) * u;
    return lineXZ(sd, s, w);
  };
  const a = wall(DUGOUT.s0), b = wall(DUGOUT.s1);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
  let nx = -uz, nz = ux; // toward the field (the foul line)
  if (nx * -sd + nz * 0 < 0 && Math.abs(nx) > 1e-6) { nx = -nx; nz = -nz; }
  const d = DUGOUT.depth;
  return {
    back0: a, back1: b, front0: [a[0] + nx * d, a[1] + nz * d], front1: [b[0] + nx * d, b[1] + nz * d],
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], along: [ux, uz], inward: [nx, nz], length: len,
  };
}

function buildPlayable() {
  const poly = [];
  for (let a = -45; a <= 45.0001; a += 1.5) { const p = polar(a, fenceDistance(a)); poly.push([p.x, p.z]); } // left pole -> right pole
  const S = Math.SQRT1_2;
  const side = (sd) => {
    const P = polar(45 * sd, fenceDistance(45 * sd));
    const c = [[P.x + sd * S * 16, P.z + S * 4]]; // just outside the pole
    for (const s of [285, 225, 165, 110, 60, 20]) {
      c.push(lineXZ(sd, s, foulWallOffset(s)));
      if (s === 110) { const g = dugoutSpot(sd); c.push(g.back1, g.front1, g.front0, g.back0); } // the dugout's front rail
    }
    return c;
  };
  const back = [[46, 78], [24, 92], [0, 96], [-24, 92], [-46, 78]];
  return poly.concat(side(1), back, side(-1).reverse());
}
let PLAYABLE = buildPlayable();
let SPAN = null; // (cached for the PLAYABLE it was measured on)

/** The longest straight line inside the ballpark outline: the farthest apart any two of its corners are (ft). */
export function parkSpan() {
  if (SPAN && SPAN.poly === PLAYABLE) return SPAN.d;
  let d = 0;
  for (let i = 0; i < PLAYABLE.length; i++) for (let j = i + 1; j < PLAYABLE.length; j++) d = Math.max(d, Math.hypot(PLAYABLE[i][0] - PLAYABLE[j][0], PLAYABLE[i][1] - PLAYABLE[j][1]));
  SPAN = { poly: PLAYABLE, d };
  return d;
}

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is this spot inside the ballpark, at least `margin` feet away from every wall? (negative margin = allow that far past) */
export function isInsideField(x, z, margin = 0) {
  const inside = pointInPolygon(x, z, PLAYABLE);
  if (margin === 0) return inside;
  const n = nearestEdge(x, z);
  return margin > 0 ? inside && n.d >= margin : inside || n.d <= -margin;
}

/**
 * Foul territory beyond the side walls and the backstop: the seats. Returns null inside the ballpark, else { over (ft past the wall),
 * wall (the wall's height there), seat (the seating surface's height here), nx, nz (outward) } - the same rake the stands are drawn
 * with (render/perimeter.js + stadium.js: the wall is 5 ft by the plate rising to 10 ft at the poles, the seats rise `stands.slope`).
 */
export function seatsAt(x, z) {
  if (pointInPolygon(x, z, PLAYABLE)) return null;
  const n = nearestEdge(x, z);
  const wall = 5 + 5 * Math.min(1, Math.abs(n.px) / 180);
  const s = CONFIG.field.stands;
  const l = n.d || 1;
  return { over: n.d, wall, seat: wall + Math.min(n.d, s.depth) * s.slope, nx: (x - n.px) / l, nz: (z - n.pz) / l };
}

/** Signed distance to the nearest wall: positive = inside the ballpark, negative = outside. */
export function wallClearance(x, z) {
  const d = nearestEdge(x, z).d;
  return pointInPolygon(x, z, PLAYABLE) ? d : -d;
}

function nearestEdge(x, z) {
  let best = { d: Infinity, px: x, pz: z };
  for (let i = 0, j = PLAYABLE.length - 1; i < PLAYABLE.length; j = i++) {
    const [ax, az] = PLAYABLE[j], [bx, bz] = PLAYABLE[i];
    const ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    const px = ax + ex * t, pz = az + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz };
  }
  return best;
}

/** The closest spot to (x, z) that is inside the ballpark and at least `margin` feet from every wall. */
export function clampToField(x, z, margin = 0) {
  const inside = pointInPolygon(x, z, PLAYABLE);
  const n = nearestEdge(x, z);
  if (inside && n.d >= margin) return [x, z];
  let ix, iz;
  if (n.d < 1e-6) { ix = -x; iz = -120 - z; } // exactly on the wall: toward the middle of the field
  else if (inside) { ix = x - n.px; iz = z - n.pz; }
  else { ix = n.px - x; iz = n.pz - z; }
  const l = Math.hypot(ix, iz) || 1;
  return [n.px + (ix / l) * margin, n.pz + (iz / l) * margin];
}

/**
 * Starting inside the park and walking along (ux, uz): how many feet until the wall? (Infinity if never)
 * With `body` (feet), stop that far short of the wall measured straight out from it - so a fielder whose centre may get
 * `body` from the wall still has that much room when he reaches it at a slant.
 */
export function distanceToWall(x0, z0, ux, uz, body = 0) {
  let best = Infinity;
  for (let i = 0, j = PLAYABLE.length - 1; i < PLAYABLE.length; j = i++) {
    const [ax, az] = PLAYABLE[j], [bx, bz] = PLAYABLE[i];
    const ex = bx - ax, ez = bz - az;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - x0) * ez - (az - z0) * ex) / den;
    const u = ((ax - x0) * uz - (az - z0) * ux) / den;
    if (t <= 1e-6 || u < 0 || u > 1) continue;
    const cos = Math.max(0.25, Math.abs(den) / Math.hypot(ex, ez)); // how squarely he meets this wall (1 = head on)
    const tt = t - body / cos;
    if (tt < best) best = tt;
  }
  return best;
}
