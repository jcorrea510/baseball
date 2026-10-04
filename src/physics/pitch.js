// Pitch flight. Every pitch is a smooth curved path that is solved so it arrives
// exactly at the chosen spot over the plate. Movement (break/drop) is a constant
// sideways / vertical acceleration, so the curve is visible from the moment the
// ball leaves the hand - never a late "teleport".
import { CONFIG, MPH } from '../config.js';

export function releasePoint(type, hand = 'R', cfg = CONFIG) {
  const def = cfg.pitch.types[type];
  const slot = def ? def.armSlot : 0;
  const side = hand === 'R' ? -1 : 1; // pitcher's throwing hand as seen from behind the plate
  return {
    x: side * (1.55 - slot * 0.9),
    y: 5.75 + slot * 1.7,
    z: cfg.pitch.releaseZ,
  };
}

/**
 * @param {object} p
 * @param {string} p.type          pitch type key
 * @param {number} p.speedMph      speed leaving the hand
 * @param {'R'|'L'} [p.hand]       pitcher's throwing hand
 * @param {{x:number,y:number}} p.target  where it crosses the plate plane (ft)
 * @param {number} [p.movementScale]
 */
export function buildPitch(p, cfg = CONFIG) {
  const def = cfg.pitch.types[p.type];
  if (!def) throw new Error('Unknown pitch type ' + p.type);
  const hand = p.hand || 'R';
  const mv = p.movementScale ?? 1;
  const R = releasePoint(p.type, hand, cfg);
  // pace: the ball takes this many times longer to reach the plate than a real pitch of this speed (an easier pitch to read; the
  // speed shown and the speed the bat feels stay p.speedMph - see contact.contactPoint)
  const pace = p.pace ?? 1;
  const v0 = (p.speedMph * MPH) / pace;
  const drag = cfg.pitch.drag;
  const L = cfg.pitch.contactZ - R.z; // distance to the timing plane
  const T = L / (v0 * (1 - drag / 2));
  const g = cfg.physics.gravity;

  const armSign = hand === 'R' ? -1 : 1; // world x direction of "arm side"
  const ax = (2 * armSign * def.breakArm * mv) / (T * T);
  const ay = -g + (2 * def.hop * mv) / (T * T);
  const az = (-drag * v0) / T;

  const vx0 = (p.target.x - R.x - 0.5 * ax * T * T) / T;
  const vy0 = (p.target.y - R.y - 0.5 * ay * T * T) / T;
  const vz0 = v0;

  const vzPlate = vz0 + az * T;
  // Time at which z reaches the catcher's mitt (solve 0.5*az*t^2 + v0*t = D exactly).
  const D = cfg.pitch.catchZ - R.z;
  const tCatch = (-v0 + Math.sqrt(v0 * v0 + 2 * az * D)) / az;
  const rad = cfg.physics.ballRadius;

  const flight = {
    type: p.type,
    hand,
    speedMph: p.speedMph,
    plateSpeedMph: (Math.hypot(vx0 + ax * T, vy0 + ay * T, vzPlate) / MPH) * pace,
    pace,
    release: R,
    target: { x: p.target.x, y: p.target.y },
    T,
    tCatch,
    accel: { x: ax, y: ay, z: az },
    v0: { x: vx0, y: vy0, z: vz0 },
    // Spin axis (unit vector) and rate for drawing the ball's rotation.
    spin: spinVector(def, hand),
    at(t, out = { x: 0, y: 0, z: 0 }) {
      const tt = Math.max(0, Math.min(t, tCatch));
      out.x = R.x + vx0 * tt + 0.5 * ax * tt * tt;
      out.y = Math.max(rad, R.y + vy0 * tt + 0.5 * ay * tt * tt);
      out.z = R.z + vz0 * tt + 0.5 * az * tt * tt;
      return out;
    },
    velocity(t, out = { x: 0, y: 0, z: 0 }) {
      const tt = Math.max(0, Math.min(t, tCatch));
      out.x = vx0 + ax * tt;
      out.y = vy0 + ay * tt;
      out.z = vz0 + az * tt;
      return out;
    },
  };
  return flight;
}

function spinVector(def, hand) {
  // Back-spin axis is -x (ball moving toward +z), top-spin +x, sidespin about y.
  let axis;
  if (def.spin === 'top') axis = [1, 0, 0];
  else if (def.spin === 'side') axis = [0, hand === 'R' ? 1 : -1, 0];
  else axis = [-1, 0, 0];
  return { axis, rpm: def.spinRpm };
}

// Would the umpire call this a strike if it is not swung at?
export function isStrike(x, y, cfg = CONFIG) {
  const r = cfg.physics.ballRadius;
  return Math.abs(x) <= cfg.pitch.zoneHalfWidth && y >= cfg.pitch.zoneBottom - r && y <= cfg.pitch.zoneTop + r;
}

/** Does a pitch crossing at (x, y) hit a batter of this hand? (a right-hander stands on the -x side of the plate) */
export function hitsBatter(x, y, hand = 'R', cfg = CONFIG) {
  const H = cfg.pitch.hitBatter;
  const inside = hand === 'L' ? x : -x; // how far toward the batter it crosses
  return inside >= H.inner && inside <= H.outer && y >= H.low && y <= H.high;
}

// Pitch location relative to the middle of the zone, normalised so 1.0 = edge of the zone.
export function zoneRatio(x, y, cfg = CONFIG) {
  const t = cfg.timing;
  const nx = x / cfg.pitch.zoneHalfWidth;
  const ny = (y - t.zoneCenterY) / t.zoneHalfHeight;
  return Math.hypot(nx, ny);
}

/** How far (ft) a pitch crossing at (x, y) is from the EDGE of the strike zone: 0 on the edge, positive inside, negative outside. */
export function zoneEdgeDistance(x, y, cfg = CONFIG) {
  const P = cfg.pitch;
  const dx = P.zoneHalfWidth - Math.abs(x), dy = Math.min(y - P.zoneBottom, P.zoneTop - y);
  if (dx >= 0 && dy >= 0) return Math.min(dx, dy);
  return -Math.hypot(Math.min(dx, 0), Math.min(dy, 0));
}
