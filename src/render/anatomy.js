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
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < cols; j++) {
      const v = i * cols + j;
      pos.set(rows[i][j], v * 3);
      uv[v * 2] = j / seg; uv[v * 2 + 1] = 1 - i / (R - 1);
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
const L = (rings, dl, key, extra = {}) => { const o = lod(dl); return loft(rings, { ...o, ...extra, key: `${key}|${o.seg}|${o.sub}` }); };

/** The upper arm (from the shoulder joint down, the elbow at -upperArm): skin or undershirt with a deltoid, biceps and triceps, and a
 *  short jersey sleeve over the top with its piping. */
export function upperArmParts({ side, dl, len, arm, sleeve, trim }) {
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
    { geo: L(skin, dl, `uarm${side}|${len}`), color: arm, ao: 0.06 },
    { geo: L(sl, dl, `sleeve${side}`, { dome: 0.3 }), color: sleeve },
    { geo: L(hem, dl, 'hem', { cap: false, sub: 1 }), color: trim },
  ];
}

/** The forearm (from the elbow down, the wrist at -foreArm): the point of the elbow, the brachioradialis bulging by the elbow on the
 *  outside, the flexors on the inside, tapering to a slim, flat wrist. */
export function foreArmParts({ side, dl, len, arm }) {
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
  return [{ geo: L(rings, dl, `farm${side}|${len}`), color: arm, ao: 0.05 }];
}

/** The thigh (from the hip joint down, the knee at -thigh): a baggy pant leg over the quads and hamstrings, with the side stripe. */
export function thighParts({ side, dl, len, pants, trim }) {
  const rings = [
    { y: 0.08, rx: 0.27, rz: 0.27 },
    { y: -0.18, rx: 0.302, rz: 0.31, bumps: [{ a: 0, w: 1.1, h: 0.05 }] },
    { y: -0.6, rx: 0.282, rz: 0.285, bumps: [{ a: 0, w: 1.1, h: 0.08 }, { a: Math.PI, w: 1.0, h: 0.05 }] },
    { y: -1.0, rx: 0.252, rz: 0.255, bumps: [{ a: 0, w: 0.9, h: 0.05 }] },
    { y: -1.3, rx: 0.226, rz: 0.234 },
    { y: -len, rx: 0.212, rz: 0.228, bumps: [{ a: 0, w: 0.8, h: 0.1 }] },
    { y: -len - 0.1, rx: 0.2, rz: 0.2 },
  ];
  // the stripe down the outside seam: a thin ribbon that follows the leg's surface
  const stripe = rings.slice(1, 6).map((r) => ({ y: r.y, rx: 0.016, rz: 0.055, x: side * (r.rx + 0.004) }));
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
  const cuff = [{ y: 0.08, rx: 0.24, rz: 0.245 }, { y: -0.08, rx: 0.25, rz: 0.255 }, { y: -0.2, rx: 0.232, rz: 0.238 }, { y: -0.24, rx: 0.205, rz: 0.21 }];
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
    { y: 0.25, rx: 0.022, rz: 0.018, z: 0.338 },
    { y: 0.17, rx: 0.03 * nose, rz: 0.03, z: 0.36 },
    { y: 0.095, rx: 0.042 * nose, rz: 0.042, z: 0.382 },
    { y: 0.06, rx: 0.05 * nose, rz: 0.03, z: 0.37, bumps: [{ a: 1.5, w: 0.7, h: 0.26 }, { a: -1.5, w: 0.7, h: 0.26 }] }, // the wings of the nose
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
    { geo: L(skull, dl, `skull${q}`, { dome: 0.3 }), color: skin, ao: 0.04 },
    { geo: L(neck, dl, 'neck', { dome: 0.2 }), color: skin, ao: 0.15 },
    { geo: L(noseRings, dl, `nose${q}`, { seg: fine ? 10 : 6, sub: 1, dome: 0.5 }), color: skin },
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
      { geo: cap(0.016, 0.1, 2, 6), color: brow, x: sd * 0.125, y: 0.262 + 0.008 * browH, z: 0.34, rz: Math.PI / 2 + sd * 0.14, sz: 0.55 }, // eyebrow
      { geo: sph(0.088, fine ? 12 : 8, fine ? 10 : 6), color: skin, x: sd * 0.31, y: 0.15, z: -0.02, sx: 0.34, sy: 1.0, sz: 0.72 }, // ear
      { geo: tor(0.05, 0.011, Math.PI * 1.5, 4, fine ? 12 : 8), color: shade(skin, 0.92), x: sd * 0.322, y: 0.16, z: -0.02, ry: Math.PI / 2, rz: 0.9 }, // the ear's rim
    );
    if (fine) parts.push({ geo: sph(0.011, 6, 5), color: shade(skin, 0.45), x: sd * 0.022, y: 0.056, z: 0.378, sy: 0.6 }); // nostril
  }
  return parts;
}
