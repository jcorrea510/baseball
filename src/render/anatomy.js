// Body-part shapes for the players (rig.js), made in code: smooth surfaces lofted through cross-sections, so an arm has a deltoid,
// biceps and a slim wrist, a calf bulges, a face has a brow, cheekbones and a jaw. Geometry only (no game logic); the parts are
// merged per bone by rig.js exactly like its other primitives.
import * as THREE from 'three';

const cache = new Map();

// How far out a ring reaches at angle `th` (radians; 0 = +z, the front; +PI/2 = +x, the figure's left): 1 + the bumps there.
function bumpAt(bumps, th) {
  let k = 1;
  if (!bumps) return k;
  for (const b of bumps) {
    let d = th - b.a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < b.w) k += b.h * 0.5 * (1 + Math.cos((Math.PI * d) / b.w));
  }
  return k;
}

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * A smooth closed surface swept through `rings` (in order along the part, usually from the joint down).
 * Ring: { y, rx, rz, x = 0, z = 0, bumps = [{ a, w, h }] } - an ellipse of half-widths rx (left-right) and rz (front-back) centred at
 * (x, y, z); a bump pushes it out by h x the radius around angle a (+- w, a cosine bump). Between rings the surface follows a
 * Catmull-Rom curve (`sub` steps per span). Columns start at the figure's right (-x) and go round through the front, so the
 * front is at u = 0.25 (the jersey texture's convention). Ends are closed with a rounded cap (`dome` x the end radius).
 * @returns {THREE.BufferGeometry} (cached when `key` is given - never dispose a cached one)
 */
export function loft(rings, { seg = 16, sub = 2, cap = true, dome = 0.35, key = null } = {}) {
  if (key && cache.has(key)) return cache.get(key);
  const n = rings.length, cols = seg + 1;
  // each original ring as points round its outline
  const P = rings.map((r) => {
    const pts = [];
    for (let j = 0; j < cols; j++) {
      const th = -Math.PI / 2 + (2 * Math.PI * j) / seg;
      const k = bumpAt(r.bumps, th);
      pts.push([(r.x || 0) + Math.sin(th) * r.rx * k, r.y, (r.z || 0) + Math.cos(th) * r.rz * k]);
    }
    return pts;
  });
  const rows = [];
  for (let i = 0; i < n - 1; i++) {
    const steps = sub;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(n - 1, i + 2)];
      rows.push(b.map((_, j) => [0, 1, 2].map((q) => cr(a[j][q], b[j][q], c[j][q], d[j][q], t))));
    }
  }
  rows.push(P[n - 1].map((p) => p.slice()));
  const R = rows.length;
  const nv = R * cols + (cap ? 2 : 0);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  // (v runs up the part: 0 at its lowest ring, 1 at its highest, like a lathe - so a texture is never upside down)
  const y0 = rings[0].y, y1 = rings[n - 1].y;
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < cols; j++) {
      const v = i * cols + j;
      pos.set(rows[i][j], v * 3);
      const t = i / (R - 1);
      uv[v * 2] = j / seg; uv[v * 2 + 1] = y1 >= y0 ? t : 1 - t;
    }
  }
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = (i + 1) * cols + j, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const centre = (row) => { const c = [0, 0, 0]; for (let j = 0; j < seg; j++) for (let q = 0; q < 3; q++) c[q] += row[j][q] / seg; return c; };
  const radius = (row, c) => { let s = 0; for (let j = 0; j < seg; j++) s += Math.hypot(row[j][0] - c[0], row[j][2] - c[2]); return s / seg; };
  if (cap) {
    for (const [end, other, slot] of [[0, 1, R * cols], [R - 1, R - 2, R * cols + 1]]) {
      const c = centre(rows[end]), o = centre(rows[other]);
      const ax = [c[0] - o[0], c[1] - o[1], c[2] - o[2]], L = Math.hypot(...ax) || 1;
      const r = radius(rows[end], c) * dome;
      pos.set([c[0] + (ax[0] / L) * r, c[1] + (ax[1] / L) * r, c[2] + (ax[2] / L) * r], slot * 3);
      uv[slot * 2] = 0.5; uv[slot * 2 + 1] = end === 0 ? 1 : 0;
      for (let j = 0; j < seg; j++) idx.push(slot, end * cols + j + 1, end * cols + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  // wind every face outward (the rings may run up or down the part)
  const side = (i) => { // a side vertex in the middle: does its face normal point away from the axis?
    const a = new THREE.Vector3().fromArray(pos, idx[i] * 3), b = new THREE.Vector3().fromArray(pos, idx[i + 1] * 3), c = new THREE.Vector3().fromArray(pos, idx[i + 2] * 3);
    const nrm = b.clone().sub(a).cross(c.clone().sub(a));
    const mid = a.add(b).add(c).divideScalar(3);
    const row = Math.floor(idx[i] / cols), ctr = centre(rows[Math.min(R - 1, row)]);
    return nrm.x * (mid.x - ctr[0]) + nrm.z * (mid.z - ctr[2]);
  };
  const midTri = Math.floor((R - 1) / 2) * seg * 6 + Math.floor(seg / 4) * 6;
  if (side(midTri) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam: the first and last column are the same place - give them the same (averaged) normal
  const nor = g.getAttribute('normal');
  for (let i = 0; i < R; i++) {
    const a = i * cols, b = i * cols + seg;
    const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), L = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / L, y / L, z / L); nor.setXYZ(b, x / L, y / L, z / L);
  }
  g.computeBoundingSphere();
  if (key) cache.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------- limbs and body
// Angles round a part (see loft): 0 = front (+z), PI = back, +PI/2 = the figure's left (+x). `side` = +1 for the left arm / leg, -1
// for the right, so `side * PI / 2` is always the outside of the limb.
const H = Math.PI / 2;
const lod = (dl) => ({ seg: Math.max(8, Math.round(18 * dl)), sub: dl > 0.7 ? 2 : 1 });
const L = (rings, dl, key, extra = {}) => { const o = { ...lod(dl), ...extra }; return loft(rings, { ...o, key: `${key}|${o.seg}|${o.sub}|${o.dome ?? ''}|${o.cap ?? ''}` }); }; // (the key says exactly what is built)

/** The upper arm (from the shoulder joint down, the elbow at -upperArm): skin or undershirt with a deltoid, biceps and triceps, and a
 *  short jersey sleeve over the top with its piping. */
export function upperArmParts({ side, dl, len, arm, armMat = 'skin', sleeve, trim }) {
  const out = H * side;
  const skin = [
    { y: 0.1, rx: 0.16, rz: 0.16 },
    { y: -0.05, rx: 0.2, rz: 0.19, bumps: [{ a: out, w: 1.1, h: 0.12 }] },
    { y: -0.25, rx: 0.178, rz: 0.17, bumps: [{ a: out, w: 0.9, h: 0.13 }, { a: 0, w: 0.9, h: 0.05 }] },
    { y: -0.45, rx: 0.152, rz: 0.158, bumps: [{ a: out, w: 0.6, h: 0.06 }, { a: Math.PI, w: 1.1, h: 0.1 }] },
    { y: -0.6, rx: 0.146, rz: 0.168, bumps: [{ a: 0, w: 1.0, h: 0.17 }, { a: Math.PI, w: 1.2, h: 0.12 }] },
    { y: -0.78, rx: 0.138, rz: 0.15, bumps: [{ a: 0, w: 1.0, h: 0.1 }, { a: Math.PI, w: 1.0, h: 0.05 }] },
    { y: -0.95, rx: 0.125, rz: 0.122 },
    { y: -len - 0.05, rx: 0.116, rz: 0.116 },
  ];
  // (the sleeve's top is a round cap over the shoulder joint: it closes in a dome, never a point)
  const sl = [
    { y: 0.27, rx: 0.06, rz: 0.06 },
    { y: 0.24, rx: 0.15, rz: 0.145 },
    { y: 0.15, rx: 0.218, rz: 0.21 },
    { y: 0.02, rx: 0.245, rz: 0.235, bumps: [{ a: out, w: 1.2, h: 0.06 }] },
    { y: -0.25, rx: 0.232, rz: 0.222 },
    { y: -0.5, rx: 0.212, rz: 0.212 },
    { y: -0.52, rx: 0.2, rz: 0.2 },
  ];
  const hem = [{ y: -0.47, rx: 0.218, rz: 0.218 }, { y: -0.52, rx: 0.218, rz: 0.218 }];
  return [
    { geo: L(skin, dl, `uarm${side}|${len}`), color: arm, ao: 0.06, mat: armMat },
    { geo: L(sl, dl, `sleeve${side}`, { dome: 0.3 }), color: sleeve },
    { geo: L(hem, dl, 'hem', { cap: false, sub: 1 }), color: trim },
  ];
}

/** The forearm (from the elbow down, the wrist at -foreArm): the point of the elbow, the brachioradialis bulging by the elbow on the
 *  outside, the flexors on the inside, tapering to a slim, flat wrist. */
export function foreArmParts({ side, dl, len, arm, armMat = 'skin' }) {
  const out = H * side;
  const rings = [
    { y: 0.07, rx: 0.12, rz: 0.12 },
    { y: -0.04, rx: 0.13, rz: 0.126, bumps: [{ a: Math.PI, w: 0.7, h: 0.16 }] },
    { y: -0.2, rx: 0.142, rz: 0.13, bumps: [{ a: out * 0.75, w: 0.95, h: 0.15 }, { a: -out * 0.75, w: 0.85, h: 0.09 }] },
    { y: -0.42, rx: 0.126, rz: 0.11, bumps: [{ a: out * 0.75, w: 0.8, h: 0.06 }] },
    { y: -0.66, rx: 0.104, rz: 0.088 },
    { y: -0.86, rx: 0.092, rz: 0.074 },
    { y: -len, rx: 0.088, rz: 0.07 },
  ];
  return [{ geo: L(rings, dl, `farm${side}|${len}`), color: arm, ao: 0.05, mat: armMat }];
}

/** The thigh (from the hip joint down, the knee at -thigh): a baggy pant leg over the quads and hamstrings, with the side stripe. */
export function thighParts({ side, dl, len, pants, trim }) {
  const rings = [
    { y: 0.18, rx: 0.19, rz: 0.19 },
    { y: 0.0, rx: 0.285, rz: 0.295 },
    { y: -0.18, rx: 0.302, rz: 0.31, bumps: [{ a: 0, w: 1.1, h: 0.05 }] },
    { y: -0.6, rx: 0.282, rz: 0.285, bumps: [{ a: 0, w: 1.1, h: 0.08 }, { a: Math.PI, w: 1.0, h: 0.05 }] },
    { y: -1.0, rx: 0.252, rz: 0.255, bumps: [{ a: 0, w: 0.9, h: 0.05 }] },
    { y: -1.3, rx: 0.226, rz: 0.234 },
    { y: -len, rx: 0.212, rz: 0.228, bumps: [{ a: 0, w: 0.8, h: 0.1 }] },
    { y: -len - 0.1, rx: 0.2, rz: 0.2 },
  ];
  // the stripe down the outside seam: a thin ribbon that follows the leg's surface
  const stripe = rings.slice(2, 7).map((r) => ({ y: r.y, rx: 0.016, rz: 0.055, x: side * (r.rx + 0.004) }));
  return [
    { geo: L(rings, dl, `thigh|${len}`), color: pants, ao: 0.05 },
    { geo: L(stripe, dl, `stripe${side}|${len}`, { seg: 6, sub: 1 }), color: trim },
  ];
}

/** The shin (from the knee down, the ankle at -shin): stirrup socks over a calf that bulges high at the back and tapers to the
 *  Achilles, the pant cuff gathered under the knee, and the sock bands. */
export function shinParts({ dl, len, pants, socks, trim, band }) {
  const calf = (h) => [{ a: Math.PI, w: 1.15, h }, { a: 0, w: 0.5, h: 0.03 }];
  const rings = [
    { y: 0.02, rx: 0.17, rz: 0.17 },
    { y: -0.3, rx: 0.164, rz: 0.17, bumps: calf(0.26) },
    { y: -0.55, rx: 0.158, rz: 0.162, bumps: calf(0.2) },
    { y: -0.85, rx: 0.128, rz: 0.122, bumps: calf(0.05) },
    { y: -1.15, rx: 0.11, rz: 0.104 },
    { y: -1.4, rx: 0.1, rz: 0.098 },
    { y: -len - 0.04, rx: 0.102, rz: 0.11 },
  ];
  const cuff = [{ y: 0.1, rx: 0.25, rz: 0.262 }, { y: -0.06, rx: 0.262, rz: 0.27 }, { y: -0.2, rx: 0.24, rz: 0.248 }, { y: -0.25, rx: 0.21, rz: 0.215 }];
  // the bands follow the sock's shape, a hair outside it
  const at = (y) => { let i = 0; while (i < rings.length - 2 && rings[i + 1].y > y) i++; const a = rings[i], b = rings[i + 1], t = (a.y - y) / (a.y - b.y); return { rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, bumps: calf((a.bumps ? a.bumps[0].h : 0) * (1 - t) + (b.bumps ? b.bumps[0].h : 0) * t) }; };
  const bandAt = (y0, y1) => [y0, y1].map((y) => { const r = at(y); return { y, rx: r.rx * 1.035, rz: r.rz * 1.035, bumps: r.bumps }; });
  return [
    { geo: L(rings, dl, `shin|${len}`), color: socks, ao: 0.05 },
    { geo: L(cuff, dl, 'cuff', { dome: 0.2 }), color: pants },
    { geo: L(bandAt(-0.6, -0.67), dl, 'band1', { cap: false, sub: 1 }), color: trim },
    { geo: L(bandAt(-0.72, -0.76), dl, 'band2', { cap: false, sub: 1 }), color: band },
  ];
}

// The jersey torso (spine space, from the waist up): a V-taper with the chest, the shoulder blades and the groove of the spine,
// lofted so it carries the jersey texture (front at u = 0.25). Depth is ~60% of the width, like the lathe it replaces.
const TORSO = [[0, 0.34], [0.06, 0.46], [0.22, 0.5], [0.5, 0.54], [0.8, 0.62], [1.1, 0.7], [1.35, 0.75], [1.52, 0.73], [1.62, 0.62], [1.7, 0.36], [1.76, 0.16], [1.79, 0.02]];
export function torsoGeometry(dl = 1) {
  const rings = TORSO.map(([y, r]) => {
    const up = Math.max(0, Math.min(1, (y - 0.85) / 0.6)) * (y < 1.6 ? 1 : 0);
    return {
      y, rx: r, rz: r * 0.6,
      bumps: up > 0 ? [{ a: 0.55, w: 0.55, h: 0.07 * up }, { a: -0.55, w: 0.55, h: 0.07 * up }, { a: Math.PI - 0.62, w: 0.5, h: 0.06 * up }, { a: Math.PI + 0.62, w: 0.5, h: 0.06 * up }, { a: Math.PI, w: 0.22, h: -0.03 * up }] : [],
    };
  });
  const seg = Math.max(14, Math.round(30 * dl));
  return loft(rings, { seg, sub: dl > 0.7 ? 2 : 1, cap: true, dome: 0.1, key: `torso2|${seg}` });
}

// ---------------------------------------------------------------------------------------------------------------- the head
// Head-group space (rig.js headG): the skull's centre ~0.14 ft up, the face toward +z. `variant` (0..1, from the jersey number) widens
// or narrows the nose, jaw and brow a little so the players are not twins.
const sphereCache = new Map();
const sph = (r, w, h) => { const k = `${r}|${w}|${h}`; return sphereCache.get(k) || sphereCache.set(k, new THREE.SphereGeometry(r, w, h)).get(k); };
const capCache = new Map();
const cap = (r, len, ss, rs) => { const k = `${r}|${len}|${ss}|${rs}`; return capCache.get(k) || capCache.set(k, new THREE.CapsuleGeometry(r, len, ss, rs)).get(k); };
const torCache = new Map();
const tor = (r, t, arc, ts, rs) => { const k = `${r}|${t}|${arc}|${ts}|${rs}`; return torCache.get(k) || torCache.set(k, new THREE.TorusGeometry(r, t, ts, rs, arc)).get(k); };

// Colour across the face (multipliers on the skin colour): shadow in the eye sockets and under the brow, warmer cheeks, nose tip and
// ears, a touch of shade under the nose and the lower lip, and on some players the shadow of a beard on the jaw.
function facePaint(variant) {
  const g = (dx, dy, s) => Math.exp(-(dx * dx + dy * dy) / (s * s));
  const beard = variant > 0.62 ? 0.12 + (variant - 0.62) * 0.4 : 0;
  return (x, y, z) => {
    const front = Math.max(0, Math.min(1, (z - 0.12) / 0.12));
    const ax = Math.abs(x);
    let k = 1, warm = 0;
    k -= 0.28 * front * g(ax - 0.122, y - 0.205, 0.075); // eye sockets
    k -= 0.08 * front * g(0, y - 0.255, 0.05) * (ax < 0.25 ? 1 : 0); // under the brow
    k -= 0.06 * front * g(ax, y + 0.062, 0.035); // under the lower lip
    warm += 0.14 * front * g(ax - 0.19, y - 0.075, 0.085); // cheeks
    if (beard) k -= beard * Math.max(0, Math.min(1, (0.035 - y) / 0.06)) * (z > -0.05 ? 1 : 0) * (1 - g(ax, y + 0.03, 0.05) * 0.6);
    k += 0.04 * Math.max(0, Math.min(1, (y - 0.3) / 0.15)); // a lighter forehead
    return [k * (1 + warm), k * (1 - warm * 0.25), k * (1 - warm * 0.35)];
  };
}

/**
 * The face, skull, neck and ears (hair, cap and helmet are rig.js's).
 * @param {object} o { dl, skin, lip, eye, brow, variant }
 */
export function headParts({ dl, skin, lip, eye, brow, variant = 0.5 }) {
  const v = (k) => 1 + (variant - 0.5) * k; // a little per-player variation
  const jaw = v(0.12), nose = v(0.3), browH = v(0.5);
  const q = Math.round(variant * 4); // (geometry is cached per variant step)
  const skull = [
    { y: -0.2, rx: 0.1, rz: 0.1, z: 0.12 },
    { y: -0.155, rx: 0.19 * jaw, rz: 0.2, z: 0.07, bumps: [{ a: 0, w: 0.5, h: 0.12 }] }, // chin
    { y: -0.065, rx: 0.255 * jaw, rz: 0.27, z: 0.03, bumps: [{ a: 0, w: 0.55, h: 0.05 }, { a: 1.45, w: 0.4, h: 0.04 * jaw }, { a: -1.45, w: 0.4, h: 0.04 * jaw }] }, // jaw line
    { y: 0.02, rx: 0.288, rz: 0.315, z: 0.015 },
    { y: 0.1, rx: 0.305, rz: 0.335, bumps: [{ a: 0.8, w: 0.42, h: 0.055 }, { a: -0.8, w: 0.42, h: 0.055 }] }, // cheekbones
    { y: 0.2, rx: 0.318, rz: 0.352, bumps: [{ a: 0.36, w: 0.26, h: -0.035 }, { a: -0.36, w: 0.26, h: -0.035 }, { a: Math.PI, w: 1.2, h: 0.02 }] }, // eye sockets
    { y: 0.285, rx: 0.322, rz: 0.36, bumps: [{ a: 0, w: 1.05, h: 0.038 * browH }, { a: Math.PI, w: 1.3, h: 0.045 }] }, // brow ridge, the back of the skull
    { y: 0.4, rx: 0.31, rz: 0.348, bumps: [{ a: Math.PI, w: 1.2, h: 0.03 }] },
    { y: 0.5, rx: 0.255, rz: 0.29 },
    { y: 0.56, rx: 0.13, rz: 0.15 },
  ];
  const noseRings = [
    { y: 0.235, rx: 0.02, rz: 0.016, z: 0.33 },
    { y: 0.16, rx: 0.026 * nose, rz: 0.026, z: 0.348 },
    { y: 0.1, rx: 0.036 * nose, rz: 0.036, z: 0.365 },
    { y: 0.065, rx: 0.046 * nose, rz: 0.026, z: 0.355, bumps: [{ a: 1.5, w: 0.7, h: 0.26 }, { a: -1.5, w: 0.7, h: 0.26 }] }, // the wings of the nose
  ];
  const neck = [
    { y: -0.48, rx: 0.17, rz: 0.16 },
    { y: -0.3, rx: 0.138, rz: 0.13, bumps: [{ a: 0.55, w: 0.4, h: 0.06 }, { a: -0.55, w: 0.4, h: 0.06 }] },
    { y: -0.16, rx: 0.13, rz: 0.128, z: 0.0 },
    { y: -0.04, rx: 0.15, rz: 0.15, z: -0.02 },
  ];
  const fine = dl > 0.7;
  const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
  const parts = [
    { geo: L(skull, dl, `skull${q}`, { dome: 0.3, seg: Math.max(10, Math.round(30 * dl)) }), color: skin, ao: 0.04, paint: facePaint(variant) },
    { geo: L(neck, dl, 'neck', { dome: 0.2 }), color: skin, ao: 0.15 },
    { geo: L(noseRings, dl, `nose${q}`, { seg: fine ? 12 : 6, sub: fine ? 2 : 1, dome: 0.5 }), color: skin, paint: (x, y) => { const w = 0.07 * Math.max(0, Math.min(1, (0.13 - y) / 0.07)); return [1 + w, 1 - w * 0.3, 1 - w * 0.4]; } },
    // lips: soft ellipsoids that thin out at the corners, a darker line between them
    { geo: sph(0.05, fine ? 14 : 8, fine ? 8 : 6), color: lip, y: 0.004, z: 0.322, sx: 1.0, sy: 0.27, sz: 0.34 }, // upper lip
    { geo: sph(0.046, fine ? 14 : 8, fine ? 8 : 6), color: shade(lip, 1.08), y: -0.03, z: 0.316, sx: 0.94, sy: 0.33, sz: 0.37 }, // lower lip
    { geo: sph(0.048, fine ? 12 : 8, 4), color: shade(lip, 0.45), y: -0.013, z: 0.325, sx: 1.0, sy: 0.05, sz: 0.3 }, // the line of the mouth
  ];
  for (const sd of [-1, 1]) {
    const ex = sd * 0.122;
    parts.push(
      // the eye sits back in its socket, mostly under the lids: only an almond of white shows round the iris
      { geo: sph(0.046, fine ? 12 : 8, fine ? 10 : 6), color: '#e9e4da', x: ex, y: 0.2, z: 0.292, sz: 0.55 }, // eye white
      { geo: sph(0.028, fine ? 10 : 6, fine ? 8 : 5), color: eye, x: ex, y: 0.2, z: 0.312, sz: 0.5 }, // iris
      { geo: sph(0.013, 8, 6), color: '#0a0806', x: ex, y: 0.2, z: 0.321, sz: 0.45 }, // pupil
      { geo: sph(0.056, fine ? 12 : 8, 6), color: skin, x: ex, y: 0.224, z: 0.293, sx: 1.08, sy: 0.6, sz: 0.62 }, // upper lid
      { geo: sph(0.052, fine ? 12 : 8, 6), color: shade(skin, 0.97), x: ex, y: 0.175, z: 0.29, sx: 1.05, sy: 0.42, sz: 0.58 }, // lower lid
      { geo: cap(0.011, 0.1, 2, 6), color: brow, x: sd * 0.125, y: 0.258 + 0.008 * browH, z: 0.336, rz: Math.PI / 2 + sd * 0.12, sy: 1.0, sz: 0.45 }, // eyebrow
      { geo: sph(0.088, fine ? 12 : 8, fine ? 10 : 6), color: skin, x: sd * 0.31, y: 0.15, z: -0.02, sx: 0.34, sy: 1.0, sz: 0.72 }, // ear
      { geo: tor(0.05, 0.011, Math.PI * 1.5, 4, fine ? 12 : 8), color: shade(skin, 0.92), x: sd * 0.322, y: 0.16, z: -0.02, ry: Math.PI / 2, rz: 0.9 }, // the ear's rim
    );
    if (fine) parts.push({ geo: sph(0.01, 6, 5), color: shade(skin, 0.45), x: sd * 0.02, y: 0.06, z: 0.36, sy: 0.6 }); // nostril
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------- hands
// Wrist space (rig.js arm.wrist): the hand hangs down -y from the wrist, the fingers curl toward +z (the palm side), the thumb is on the
// -side x side, toward +z.
const cyl = (rt, rb, h, s) => { const k = `y${rt}|${rb}|${h}|${s}`; return capCache.get(k) || capCache.set(k, new THREE.CylinderGeometry(rt, rb, h, s)).get(k); };

// A finger as a chain of phalanges from its knuckle: each bends `curl[i]` radians toward the palm (+z) from the one before (rx), the
// first is also splayed `splay` radians sideways. Returns capsule + joint parts.
function fingerChain(x0, y0, z0, lens, rads, curl, splay, color, fine, mid) {
  const out = [];
  let x = x0, y = y0, z = z0, a = 0;
  for (let i = 0; i < lens.length; i++) {
    a += curl[i];
    const dx = Math.sin(splay) * (i === 0 ? 1 : 0.6), dy = -Math.cos(a), dz = Math.sin(a);
    const n = Math.hypot(dx, dy, dz);
    const ux = dx / n, uy = dy / n, uz = dz / n;
    const cx = x + (ux * lens[i]) / 2, cy = y + (uy * lens[i]) / 2, cz = z + (uz * lens[i]) / 2;
    // a capsule along +y turned onto (ux, uy, uz): first about x (pitch), then about z (the small sideways splay)
    out.push({ geo: cap(rads[i], Math.max(0.005, lens[i] - rads[i]), fine ? 3 : 2, fine ? 8 : 6), color, x: cx, y: cy, z: cz, rx: Math.PI - a, rz: -Math.asin(Math.max(-1, Math.min(1, ux))) });
    if (fine && i > 0) out.push({ geo: sph(rads[i] * 1.12, 8, 6), color: mid, x, y, z }); // the joint
    x += ux * lens[i]; y += uy * lens[i]; z += uz * lens[i];
  }
  return out;
}

/**
 * A hand. kind: 'relaxed' (fielders, runners, the pitcher's throwing hand - fingers loosely curled), 'fist' (a batter's hand closed
 * round the handle through `gp`, in a batting glove).
 * @param {object} o { side, dl, color, cuff, strap, gp }
 */
export function handParts(kind, o) {
  const parts = handParts0(kind, o);
  if (kind === 'fist') for (const p of parts) p.mat = 'leather';
  return parts;
}
function handParts0(kind, { side, dl, color, cuff, strap, gp }) {
  const fine = dl > 0.7;
  const s = side;
  const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
  const dark = shade(color, 0.9);
  if (kind === 'fist') {
    const parts = [
      // the back of the hand, a little arched, and the row of knuckles along the top of the fist
      { geo: L([{ y: 0.02, rx: 0.085, rz: 0.065 }, { y: -0.06, rx: 0.112, rz: 0.06, z: -0.012 }, { y: -0.14, rx: 0.12, rz: 0.058, z: -0.02 }, { y: gp.y + 0.075, rx: 0.115, rz: 0.05, z: gp.z - 0.035 }], dl, 'fistback', { dome: 0.25 }), color },
      { geo: cap(0.046, 0.15, 3, 8), color, x: 0, y: gp.y + 0.075, z: gp.z - 0.035, rz: Math.PI / 2 },
      // the thumb: from the base of the palm round the front of the handle
      { geo: cap(0.042, 0.06, 3, 8), color, x: -0.08 * s, y: gp.y + 0.05, z: gp.z + 0.04, rx: -0.6, rz: 0.4 * s },
      { geo: cap(0.036, 0.06, 3, 8), color, x: -0.1 * s, y: gp.y - 0.015, z: gp.z + 0.09, rx: -0.35, rz: 0.25 * s },
      { geo: cyl(0.112, 0.124, 0.07, fine ? 14 : 8), color: cuff, y: 0.03 }, // glove cuff
      { geo: L([{ y: 0.0, rx: 0.07, rz: 0.03 }, { y: -0.13, rx: 0.07, rz: 0.03 }], dl, 'strap', { seg: 8, sub: 1, dome: 0.4 }), color: strap, y: -0.02, z: -0.085 }, // the strap over the back of the hand
    ];
    // four fingers wrapped right round the handle (rings round the grip line, open only on the palm), each a little thinner toward the little finger
    for (let f = 0; f < 4; f++) parts.push({ geo: tor(0.088 - f * 0.004, 0.03 - f * 0.002, Math.PI * 1.5, fine ? 6 : 4, fine ? 14 : 10), color: f % 2 ? dark : color, x: (-0.075 + f * 0.05) * s, y: gp.y, z: gp.z, ry: Math.PI / 2, rz: 1.2 });
    return parts;
  }
  // a bare (or gloved) open hand: palm with the pad of the thumb, four fingers of three bones, a thumb of two
  const parts = [
    { geo: L([{ y: 0.03, rx: 0.078, rz: 0.055 }, { y: -0.06, rx: 0.106, rz: 0.056, bumps: [{ a: -s * 0.75, w: 0.8, h: 0.24 }] }, { y: -0.16, rx: 0.12, rz: 0.048, bumps: [{ a: -s * 0.8, w: 0.7, h: 0.14 }, { a: Math.PI, w: 0.9, h: -0.1 }] }, { y: -0.25, rx: 0.114, rz: 0.04 }], dl, `palm2${s}`, { dome: 0.45 }), color },
  ];
  if (!fine) {
    // (far away or on a phone: the fingers together, like a mitten, loosely curled)
    parts.push({ geo: cap(0.045, 0.14, 2, 6), color, x: 0.0, y: -0.33, z: 0.045, rx: 0.5, sx: 2.4, sz: 0.85 });
    parts.push({ geo: cap(0.034, 0.08, 2, 6), color, x: -0.1 * s, y: -0.08, z: 0.07, rx: 0.5, rz: 0.55 * s });
    return parts;
  }
  const lens = [[0.098, 0.062, 0.05], [0.11, 0.072, 0.054], [0.104, 0.068, 0.052], [0.08, 0.052, 0.044]];
  for (let f = 0; f < 4; f++) {
    const fx = (-0.075 + f * 0.05) * s;
    parts.push({ geo: sph(0.031, 8, 6), color: dark, x: fx, y: -0.248, z: -0.01 }); // knuckle
    parts.push(...fingerChain(fx, -0.252, 0.0, lens[f], [0.028, 0.025, 0.021], [0.32, 0.48, 0.34], (f - 1.5) * 0.06 * s, color, fine, dark));
  }
  parts.push(...fingerChain(-0.09 * s, -0.085, 0.045, [0.075, 0.062], [0.032, 0.028], [0.85, 0.3], -0.55 * s, color, fine, dark)); // thumb
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------- gloves
// In the forearm's space, `gy` = the wrist (rig.js puts the glove on the forearm). The glove's palm faces +z, its fingers point down
// (-y), the thumb is on the -x side. Its pocket is where Person.gloveWorld() says (0.1 below the wrist, 0.25 in front): the ball is
// drawn there on a catch.
/**
 * kind 'glove' (a fielder's: finger stalls, a thumb, a laced H-web, a deep pocket) or 'mitt' (the catcher's: round and heavily padded).
 * @param {object} o { dl, gy, leather, lace, web, patch }
 */
export function gloveParts(kind, o) {
  const parts = gloveParts0(kind, o);
  for (const p of parts) p.mat = 'leather';
  return parts;
}
function gloveParts0(kind, { dl, gy, leather, lace, web, patch }) {
  const fine = dl > 0.7;
  const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
  const dark = shade(leather, 0.72), pocket = shade(leather, 1.12);
  const at = (p) => ({ ...p, y: (p.y || 0) + gy });
  const parts = [];
  if (kind === 'mitt') {
    const shell = [
      { y: 0.08, rx: 0.13, rz: 0.1, z: 0.02 },
      { y: -0.04, rx: 0.27, rz: 0.15, z: 0.07 },
      { y: -0.22, rx: 0.36, rz: 0.19, z: 0.08 },
      { y: -0.44, rx: 0.36, rz: 0.18, z: 0.08 },
      { y: -0.62, rx: 0.27, rz: 0.15, z: 0.07 },
      { y: -0.72, rx: 0.12, rz: 0.1, z: 0.06 },
    ];
    parts.push(
      at({ geo: L(shell, dl, 'mitt', { dome: 0.4 }), color: leather, ao: 0.12 }),
      at({ geo: tor(0.27, fine ? 0.065 : 0.07, Math.PI * 2, fine ? 8 : 5, fine ? 22 : 12), color: shade(leather, 0.9), y: -0.3, z: 0.2, sx: 1.1, sy: 1.15 }), // the padded rim round the face
      at({ geo: sph(0.25, fine ? 18 : 10, fine ? 12 : 8), color: pocket, y: -0.3, z: 0.19, sx: 1.05, sy: 1.15, sz: 0.2 }), // the pocket
      at({ geo: cap(0.08, 0.3, 3, 8), color: leather, x: -0.33, y: -0.12, z: 0.13, rz: -0.35 }), // the thumb
      at({ geo: cyl(0.135, 0.14, 0.1, fine ? 14 : 8), color: dark, y: 0.07 }), // wrist strap
      at({ geo: sph(0.06, 10, 8), color: patch, x: 0.05, y: -0.12, z: -0.11, sz: 0.25 }), // the patch on the back
    );
    if (fine) for (let k = 0; k < 14; k++) { // laces round the rim
      const a = (k / 14) * Math.PI * 2;
      parts.push(at({ geo: cap(0.014, 0.045, 2, 5), color: lace, x: Math.cos(a) * 0.3 * 1.1, y: -0.3 + Math.sin(a) * 0.3 * 1.15, z: 0.25, rz: a }));
    }
    return parts;
  }
  // the fielder's glove: a padded heel, the palm (its face is the pocket), four finger stalls fanning out, a thumb, the web
  const shell = [
    { y: 0.07, rx: 0.12, rz: 0.085, z: 0.04 },
    { y: -0.04, rx: 0.19, rz: 0.115, z: 0.07 },
    { y: -0.2, rx: 0.235, rz: 0.1, z: 0.085 },
    { y: -0.36, rx: 0.225, rz: 0.085, z: 0.09 },
    { y: -0.44, rx: 0.2, rz: 0.07, z: 0.09 },
  ];
  parts.push(
    at({ geo: L(shell, dl, 'gloveshell', { dome: 0.35 }), color: leather, ao: 0.1 }),
    at({ geo: sph(0.17, fine ? 16 : 8, fine ? 10 : 6), color: pocket, y: -0.17, z: 0.168, sx: 1.05, sy: 1.25, sz: 0.18 }), // the pocket
    at({ geo: cap(0.055, 0.26, 3, 8), color: shade(leather, 0.94), y: -0.01, z: 0.14, rz: Math.PI / 2 }), // the heel's padded roll
    at({ geo: cyl(0.128, 0.134, 0.09, fine ? 14 : 8), color: dark, y: 0.06 }), // wrist strap
    at({ geo: box3(0.09, 0.06, 0.012), color: patch, x: 0.04, y: 0.0, z: -0.04 }), // the maker's patch on the back
  );
  // four finger stalls, each a little longer toward the middle, fanning out and curling forward to make the pocket
  const stall = [0.3, 0.34, 0.33, 0.28];
  for (let f = 0; f < 4; f++) {
    const x = -0.12 + f * 0.085, len = stall[f], fan = (f - 1.2) * 0.07;
    parts.push(at({ geo: cap(0.056, len, fine ? 3 : 2, fine ? 10 : 6), color: f % 2 ? leather : shade(leather, 0.95), x: x + Math.sin(fan) * len * 0.45, y: -0.4 - len * 0.45, z: 0.12, rx: 0.16, rz: -fan, sz: 0.85 }));
    if (fine) parts.push(at({ geo: cap(0.012, 0.05, 2, 5), color: lace, x: x + Math.sin(fan) * len * 0.92, y: -0.42 - len * 0.92, z: 0.16, rz: Math.PI / 2 - fan })); // the lace across the tip
  }
  // the thumb stall: down the -x side and forward
  parts.push(at({ geo: cap(0.066, 0.3, fine ? 3 : 2, fine ? 10 : 6), color: leather, x: -0.25, y: -0.3, z: 0.15, rx: 0.2, rz: -0.32, sz: 0.85 }));
  // the H-web between the thumb and the first finger: two uprights and three cross straps
  const wx = -0.19, wy = -0.55, wz = 0.18;
  parts.push(
    at({ geo: box3(0.025, 0.3, 0.02), color: web, x: wx - 0.035, y: wy, z: wz, rz: -0.18 }),
    at({ geo: box3(0.025, 0.3, 0.02), color: web, x: wx + 0.035, y: wy, z: wz, rz: -0.12 }),
  );
  for (let k = 0; k < 3; k++) parts.push(at({ geo: box3(0.11, 0.022, 0.018), color: web, x: wx + 0.01 * k, y: wy + 0.1 - k * 0.1, z: wz + 0.004, rz: -0.15 }));
  if (fine) {
    // the lace stitched down the little-finger side (half sunk into the leather)
    for (let k = 0; k < 5; k++) parts.push(at({ geo: cap(0.012, 0.035, 2, 5), color: lace, x: 0.226 - k * 0.004, y: -0.1 - k * 0.07, z: 0.09, rx: Math.PI / 2 }));
  }
  return parts;
}
const boxCache = new Map();
function box3(w, h, d) { const k = `${w}|${h}|${d}`; return boxCache.get(k) || boxCache.set(k, new THREE.BoxGeometry(w, h, d)).get(k); }

// A catcher's (or umpire's) mask in head space: a padded frame round the face, curved steel bars across it, a bar down the middle, a
// throat guard hanging below and the straps round the back of the head - the face shows between the bars.
export function maskParts({ dl, frame = '#1e2126', bars = '#2c3036', pad = '#3a3d44' }) {
  const fine = dl > 0.7;
  const parts = [
    { geo: tor(0.27, 0.05, Math.PI * 2, fine ? 8 : 5, fine ? 24 : 12), color: pad, y: 0.1, z: 0.33, sx: 1.1, sy: 1.32, sz: 0.8, mat: 'leather' }, // padding round the face
    { geo: cap(0.016, 0.42, 2, 6), color: bars, y: 0.08, z: 0.445, mat: 'leather' }, // the middle bar
    { geo: sph(0.12, 10, 8), color: frame, y: -0.3, z: 0.34, sx: 0.85, sy: 0.75, sz: 0.2, rx: 0.4, mat: 'leather' }, // throat guard
    { geo: tor(0.36, 0.022, Math.PI * 2, 4, fine ? 20 : 12), color: frame, y: 0.22, rx: Math.PI / 2, sx: 0.92, sz: 1.0, mat: 'leather' }, // the strap round the head
  ];
  // the bars: arcs round the front of the face, shorter toward the chin
  [[0.3, 0.33], [0.18, 0.345], [0.05, 0.34], [-0.08, 0.31], [-0.18, 0.26]].forEach(([y, r]) => {
    parts.push({ geo: tor(r, 0.017, Math.PI * 0.8, 4, fine ? 16 : 10), color: bars, y, z: 0.44 - r, rx: Math.PI / 2, rz: Math.PI * 0.1, mat: 'leather' });
  });
  return parts;
}
