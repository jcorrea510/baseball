// A procedural human figure built from primitives, with a joint hierarchy and two-bone IK
// for arms and legs. Poses are described by a small set of numbers (see poses.js); the rig turns
// them into joint rotations every frame. Person-local axes: +y up, +z = the way the person faces,
// +x = the person's LEFT hand side.
import * as THREE from 'three';
import { jerseyTexture, makeCanvas, toTexture } from './textures.js';

// ---------------------------------------------------------------- proportions (feet)
export const DIM = {
  ankle: 0.26, shin: 1.5, thigh: 1.5,
  hipW: 0.34,
  spine: 1.75, shoulderY: 1.62, shoulderW: 0.74,
  neck: 0.22, headR: 0.37,
  upperArm: 1.05, foreArm: 0.98,
};
DIM.hipStand = DIM.ankle + DIM.shin + DIM.thigh; // hip height with straight legs (3.26)

// ---------------------------------------------------------------- pose format
export const SCALARS = ['hipY', 'pelvisYaw', 'pelvisPitch', 'pelvisRoll', 'torsoPitch', 'torsoYaw', 'torsoRoll', 'headYaw', 'headPitch', 'footLTilt', 'footRTilt', 'batYaw', 'batPitch', 'batVis', 'gloveOpen'];
export const VECTORS = ['pelvis', 'footL', 'footR', 'handL', 'handR', 'poleL', 'poleR', 'kneeL', 'kneeR', 'bat'];

export function makePose(o = {}) {
  const p = {
    hipY: DIM.hipStand - 0.12, pelvisYaw: 0, pelvisPitch: 0, pelvisRoll: 0,
    torsoPitch: 0, torsoYaw: 0, torsoRoll: 0, headYaw: 0, headPitch: 0,
    footLTilt: 0, footRTilt: 0, batYaw: 0, batPitch: 0, batVis: 0, gloveOpen: 0.5,
    pelvis: [0, 0, 0],
    footL: [0.34, DIM.ankle, 0], footR: [-0.34, DIM.ankle, 0],
    handL: [0.78, 2.6, 0.12], handR: [-0.78, 2.6, 0.12],
    poleL: [0.9, -0.6, -0.5], poleR: [-0.9, -0.6, -0.5],
    kneeL: [0.12, 0.05, 1], kneeR: [-0.12, 0.05, 1],
    bat: [0, 3, 0],
  };
  for (const k in o) {
    if (Array.isArray(o[k])) p[k] = o[k].slice();
    else p[k] = o[k];
  }
  return p;
}
export function copyPose(dst, src) {
  for (const k of SCALARS) dst[k] = src[k];
  for (const k of VECTORS) { dst[k][0] = src[k][0]; dst[k][1] = src[k][1]; dst[k][2] = src[k][2]; }
  return dst;
}
export function mixPose(out, a, b, t) {
  for (const k of SCALARS) out[k] = a[k] + (b[k] - a[k]) * t;
  for (const k of VECTORS) {
    out[k][0] = a[k][0] + (b[k][0] - a[k][0]) * t;
    out[k][1] = a[k][1] + (b[k][1] - a[k][1]) * t;
    out[k][2] = a[k][2] + (b[k][2] - a[k][2]) * t;
  }
  return out;
}

// ---------------------------------------------------------------- shared materials / geometry
const matCache = new Map();
export function getMat(hex, rough = 0.88, metal = 0) {
  const key = hex + '|' + rough + '|' + metal;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
    matCache.set(key, m);
  }
  return m;
}
// Jersey materials are shared by everybody wearing the same shirt and counted: when the last figure wearing one is
// disposed (a new game builds new teams), its texture is freed from the graphics card too.
const jerseyCache = new Map();
function getJerseyMat(u, mirror) {
  const key = [u.primary, u.secondary, u.trim, u.text, u.number, u.stripe, mirror].join('|');
  let e = jerseyCache.get(key);
  if (!e) {
    const m = new THREE.MeshStandardMaterial({ map: jerseyTexture({ primary: u.primary, secondary: u.secondary, trim: u.trim, text: u.text || '', number: u.number || 0, stripe: !!u.stripe, mirror }), roughness: 0.9 });
    e = { m, key, users: 0 };
    jerseyCache.set(key, e);
  }
  e.users++;
  return e;
}
function releaseJersey(e) {
  if (!e || --e.users > 0) return;
  jerseyCache.delete(e.key);
  if (e.m.map) e.m.map.dispose();
  e.m.dispose();
}
export const jerseyCacheSize = () => jerseyCache.size;
let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.5, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  blobTex = toTexture(canvas, { anisotropy: 1 });
  return blobTex;
}
const geoCache = {};
function capsuleGeo(r, len, ss = 6, rs = 12) {
  const key = `c${r}|${len}|${ss}|${rs}`;
  return geoCache[key] || (geoCache[key] = new THREE.CapsuleGeometry(r, len, ss, rs));
}
function sphereGeo(r, w = 16, h = 12) {
  const key = `s${r}|${w}|${h}`;
  return geoCache[key] || (geoCache[key] = new THREE.SphereGeometry(r, w, h));
}

let _vertexMat = null;
function vertexMat() {
  if (!_vertexMat) _vertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  return _vertexMat;
}
function cylGeo(rt, rb, h, seg = 12) {
  const key = `y${rt}|${rb}|${h}|${seg}`;
  return geoCache[key] || (geoCache[key] = new THREE.CylinderGeometry(rt, rb, h, seg));
}
const capsule = capsuleGeo, sphere = sphereGeo, cyl = cylGeo;
function box(w, h, d) {
  const key = `b${w}|${h}|${d}`;
  return geoCache[key] || (geoCache[key] = new THREE.BoxGeometry(w, h, d));
}
function hemi(r, frac) {
  const key = `h${r}|${frac}`;
  return geoCache[key] || (geoCache[key] = new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * frac));
}
function cylHalf(r, h) {
  const key = `ch${r}|${h}`;
  return geoCache[key] || (geoCache[key] = new THREE.CylinderGeometry(r, r, h, 18, 1, false, 0, Math.PI));
}
function torus(r, tube, arc = Math.PI * 2, ts = 6, rs = 16) {
  const key = `t${r}|${tube}|${arc}|${ts}|${rs}`;
  return geoCache[key] || (geoCache[key] = new THREE.TorusGeometry(r, tube, ts, rs, arc));
}
// A jersey torso: a lathe (so it can carry the jersey texture, front at u = 0.25 like the old capsule) whose half-width
// follows a real V-taper - broad chest and shoulders narrowing to the waist. Scaled in z for the body's depth.
const TORSO_PROFILE = [[0, 0.34], [0.06, 0.46], [0.22, 0.5], [0.5, 0.55], [0.8, 0.63], [1.1, 0.7], [1.35, 0.75], [1.52, 0.73], [1.62, 0.62], [1.7, 0.36], [1.76, 0.16], [1.79, 0.0]];
function torsoGeometry(dl = 1) {
  const key = 'torso' + Math.round(dl * 10);
  if (geoCache[key]) return geoCache[key];
  const P = TORSO_PROFILE, top = P[P.length - 1][0], N = Math.max(10, Math.round(26 * dl));
  const r = (y) => { // smooth interpolation through the profile
    let i = 0;
    while (i < P.length - 2 && y > P[i + 1][0]) i++;
    const [y0, r0] = P[i], [y1, r1] = P[i + 1];
    const t = (y - y0) / (y1 - y0);
    const m0 = i > 0 ? (r1 - P[i - 1][1]) / (y1 - P[i - 1][0]) : (r1 - r0) / (y1 - y0);
    const m1 = i + 2 < P.length ? (P[i + 2][1] - r0) / (P[i + 2][0] - y0) : (r1 - r0) / (y1 - y0);
    const h = y1 - y0, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * r0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * r1 + (t3 - t2) * h * m1;
  };
  const pts = [];
  for (let i = 0; i < N; i++) { const y = (top * i) / (N - 1); pts.push(new THREE.Vector2(Math.max(0.001, r(y)), y)); }
  return (geoCache[key] = new THREE.LatheGeometry(pts, Math.max(12, Math.round(28 * dl)), -Math.PI / 2, Math.PI * 2));
}
const _mm = new THREE.Matrix4(), _mq = new THREE.Quaternion(), _me = new THREE.Euler(), _mp = new THREE.Vector3(), _ms = new THREE.Vector3();
const _mc = new THREE.Color();
// Bake primitives into one geometry with per-vertex colours.
function mergeParts(parts) {
  let vCount = 0, iCount = 0;
  const baked = parts.map((p) => {
    _mp.set(p.x || 0, p.y || 0, p.z || 0);
    _me.set(p.rx || 0, p.ry || 0, p.rz || 0);
    _mq.setFromEuler(_me);
    _ms.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    _mm.compose(_mp, _mq, _ms);
    // baked ambient occlusion: the ends of a part (where it meets the next one) are darkened a little
    let shade = null;
    if (p.ao) {
      const gl = p.geo;
      if (!gl.boundingBox) gl.computeBoundingBox();
      const cy = (gl.boundingBox.max.y + gl.boundingBox.min.y) / 2, hy = Math.max(1e-6, (gl.boundingBox.max.y - gl.boundingBox.min.y) / 2);
      const pa = gl.getAttribute('position');
      shade = new Float32Array(pa.count);
      for (let i = 0; i < pa.count; i++) shade[i] = 1 - p.ao * Math.pow(Math.min(1, Math.abs(pa.getY(i) - cy) / hy), 3);
    }
    const g = p.geo.clone().applyMatrix4(_mm);
    vCount += g.getAttribute('position').count;
    iCount += g.index.count;
    return { g, color: p.color, shade };
  });
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const { g, color, shade } of baked) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array, vo * 3);
    nor.set(g.getAttribute('normal').array, vo * 3);
    _mc.set(color);
    for (let i = 0; i < n; i++) {
      const k = shade ? shade[i] : 1;
      col[(vo + i) * 3] = _mc.r * k; col[(vo + i) * 3 + 1] = _mc.g * k; col[(vo + i) * 3 + 2] = _mc.b * k;
    }
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += n; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------- two-bone IK
const _d = new THREE.Vector3(), _pole = new THREE.Vector3(), _elbow = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q1i = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

// `from`: joint origin, `target`: wanted end position, both in the limb parent's space.
// Writes rotations for the upper limb (relative to parent) and lower limb (relative to upper).
export function solveTwoBone(len1, len2, from, target, poleDir, qUpper, qLower) {
  _d.copy(target).sub(from);
  let dist = _d.length();
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1e-5; }
  const dir = _d.clone().divideScalar(dist);
  const maxR = len1 + len2 - 1e-3;
  const minR = Math.abs(len1 - len2) + 1e-3;
  const dd = Math.min(maxR, Math.max(minR, dist));
  const cosA = (len1 * len1 + dd * dd - len2 * len2) / (2 * len1 * dd);
  const A = Math.acos(Math.min(1, Math.max(-1, cosA)));
  _pole.copy(poleDir);
  _pole.addScaledVector(dir, -_pole.dot(dir));
  if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, 1).addScaledVector(dir, -dir.z);
  _pole.normalize();
  _elbow.copy(from).addScaledVector(dir, len1 * Math.cos(A)).addScaledVector(_pole, len1 * Math.sin(A));
  _u.copy(_elbow).sub(from).normalize();
  const end = _l.copy(from).addScaledVector(dir, dd);
  _l.sub(_elbow).normalize();
  qUpper.setFromUnitVectors(DOWN, _u);
  _q1i.copy(qUpper).invert();
  const lowerLocal = _l.applyQuaternion(_q1i);
  qLower.setFromUnitVectors(DOWN, lowerLocal);
  void end;
}

// ---------------------------------------------------------------- the person
// Hair colour from skin tone and jersey number (deterministic, so a player always looks the same).
function hairColor(skinHex, number = 0) {
  _mc.set(skinHex);
  const lum = 0.3 * _mc.r + 0.59 * _mc.g + 0.11 * _mc.b;
  const dark = ['#0e0b09', '#17110d', '#241a12'];
  const mid = ['#1a120c', '#2b1d12', '#3a2716', '#5b3a1e', '#0e0b09'];
  const light = ['#2b1d12', '#5b3a1e', '#8a5a2b', '#b8863f', '#d4b56a', '#7a2f1a', '#4a4a4e'];
  const list = lum < 0.27 ? dark : lum < 0.5 ? mid : light;
  return list[(Math.abs(number) * 13 + Math.round(lum * 97)) % list.length];
}
let blobShared = null;

export class Person {
  /**
   * @param {object} o
   * @param {'batter'|'fielder'|'pitcher'|'catcher'|'runner'|'coach'} o.role
   * @param {object} o.uniform  { primary, secondary, trim, pants, cap, socks, number, text, stripe }
   * @param {string} [o.skin]
   * @param {number} [o.scale]   overall height scale
   * @param {number} [o.build]   width scale
   * @param {boolean} [o.helmet]
   * @param {boolean} [o.glove]
   * @param {boolean} [o.mirror] left-handed batter (mirrors the whole figure)
   */
  constructor(o) {
    this.role = o.role || 'fielder';
    this.scale = o.scale || 1;
    this.build = o.build || 1;
    this.mirror = !!o.mirror;
    this.pose = makePose();
    this.root = new THREE.Group();
    this.root.name = 'person-' + this.role;
    this.root.scale.set(this.scale * (this.mirror ? -1 : 1) * this.build, this.scale, this.scale * this.build);
    this._buildMeshes(o);
    this.setShadows(true);
    this._fk = { qU: new THREE.Quaternion(), qL: new THREE.Quaternion() };
    this.batWorldPos = new THREE.Vector3();
    this.ballHand = new THREE.Vector3();
  }

  _mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  // Merge several coloured primitives into ONE mesh (one draw call) attached to `parent`.
  // Each part: { geo, color, x, y, z, sx, sy, sz, rx, ry, rz }
  _merged(parent, parts, mat = vertexMat()) {
    const geo = mergeParts(parts);
    this.ownGeos.push(geo); // made for this figure only: freed in dispose()
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  _buildMeshes(o) {
    const u = o.uniform;
    const skinHex = o.skin || '#e0ac82';
    this.ownGeos = [];
    this.jersey = getJerseyMat(u, this.mirror);
    const shirt = this.jersey.m;
    const pantsHex = u.pants || '#f2f2ee';
    // Jersey sleeves are short; where a team wears a contrasting long-sleeve undershirt (u.sleeve) it shows on the arms.
    const underHex = u.sleeve && u.sleeve !== u.primary ? u.sleeve : null;
    const armHex = o.armSkin === false ? (u.sleeve || u.primary) : (underHex || skinHex);
    const socksHex = u.socks || u.secondary;
    const trimHex = u.trim || u.secondary;
    const capHex = u.cap || u.primary;
    const shoeHex = u.shoes || '#15171b';
    const beltHex = '#141414';
    const helmHex = u.helmet || u.cap || u.primary;
    const hairHex = hairColor(skinHex, u.number);
    const isCatcher = this.role === 'catcher', isUmpire = this.role === 'umpire';
    this.meshes = [];
    // level of detail: 1 = full, lower = fewer polygons (distant fielders, phones)
    const dl = o.detail ?? 1;
    const sphere = (r, w = 16, h = 12) => sphereGeo(r, Math.max(6, Math.round(w * dl)), Math.max(4, Math.round(h * dl)));
    const capsule = (r, len, ss = 6, rs = 12) => capsuleGeo(r, len, Math.max(2, Math.round(ss * dl)), Math.max(6, Math.round(rs * dl)));
    const cyl = (rt, rb, h, seg = 12) => cylGeo(rt, rb, h, Math.max(6, Math.round(seg * dl)));

    // --- pelvis group (hip height is animated): hips, seat, belt and buckle as one mesh
    this.pelvisG = new THREE.Group();
    this.root.add(this.pelvisG);
    this._merged(this.pelvisG, [
      { geo: sphere(0.5, 16, 10), color: pantsHex, y: 0.02, sx: 0.9, sy: 0.62, sz: 0.68, ao: 0.08 },
      { geo: sphere(0.3, 10, 8), color: pantsHex, x: 0.2, y: -0.12, z: -0.13, sy: 0.9 },
      { geo: sphere(0.3, 10, 8), color: pantsHex, x: -0.2, y: -0.12, z: -0.13, sy: 0.9 },
      { geo: cyl(0.5, 0.5, 0.12, 22), color: beltHex, y: 0.12, sx: 0.98, sz: 0.68 },
      { geo: box(0.15, 0.1, 0.04), color: '#c8ccd2', y: 0.12, z: 0.345 },
    ]);

    // --- spine / torso: a V-tapered jersey (textured) plus a collar
    this.spine = new THREE.Group();
    this.spine.position.set(0, 0.1, 0);
    this.pelvisG.add(this.spine);
    const torso = this._mesh(torsoGeometry(dl), shirt, this.spine, 0, 0, 0);
    torso.scale.set(1.0, 1, 0.62);
    this.torsoMesh = torso;
    this._merged(this.spine, [
      { geo: torus(0.2, 0.05, Math.PI * 2, 6, 18), color: trimHex, y: 1.7, rx: Math.PI / 2, sx: 1.08, sy: 1, sz: 0.85 },
      // the slope of the trapezius from the neck out to each shoulder (so the shoulders are not balls stuck on a vase)
      { geo: sphere(0.3, 12, 8), color: u.primary, x: 0.33, y: 1.56, z: -0.04, sx: 1.25, sy: 0.5, sz: 0.85 },
      { geo: sphere(0.3, 12, 8), color: u.primary, x: -0.33, y: 1.56, z: -0.04, sx: 1.25, sy: 0.5, sz: 0.85 },
    ]);
    if (isCatcher || isUmpire) {
      const chest = this._mesh(capsule(0.66, 0.4, 6, 18), getMat(u.gear || '#20242b', 0.7), this.spine, 0, 0.98, 0.04);
      chest.scale.set(1.03, 1, 0.72);
    }

    // --- head group: neck, skull, face, ears, hair, cap - one mesh
    this.headG = new THREE.Group();
    this.headG.position.set(0, DIM.spine + DIM.neck * 0.5 + 0.2, 0);
    this.spine.add(this.headG);
    const R = DIM.headR;
    const headParts = [
      { geo: cyl(0.125, 0.145, DIM.neck + 0.12, 10), color: skinHex, y: -0.2, ao: 0.2 },
      { geo: sphere(R, 22, 16), color: skinHex, y: 0.14, z: 0.02, sx: 0.88, sy: 1.08, sz: 1.0 },
      { geo: sphere(0.24, 14, 10), color: skinHex, y: 0.02, z: 0.14, sx: 0.85, sy: 0.9, sz: 0.85 }, // jaw and chin
      { geo: sphere(0.05, 8, 6), color: skinHex, y: 0.09, z: 0.375, sx: 0.9, sy: 1.15, sz: 1.2 }, // nose
      { geo: box(0.13, 0.02, 0.03), color: '#8a4b3d', y: -0.02, z: 0.335 }, // mouth
      { geo: hemi(R + 0.022, 0.64), color: hairHex, y: 0.14, z: -0.03, rx: -0.3, sx: 0.9, sy: 1.08, sz: 1.0 }, // hair: a cap of hair over the top and back (shows under the cap at the back and sides)
    ];
    for (const sd of [-1, 1]) {
      headParts.push({ geo: sphere(0.052, 10, 8), color: '#f4f1ea', x: sd * 0.13, y: 0.2, z: 0.325, sz: 0.5 }); // eye white
      headParts.push({ geo: sphere(0.03, 8, 6), color: '#2a1d14', x: sd * 0.13, y: 0.2, z: 0.348 }); // iris
      headParts.push({ geo: box(0.14, 0.028, 0.04), color: hairHex, x: sd * 0.13, y: 0.275, z: 0.328, rz: -sd * 0.12 }); // eyebrow
      headParts.push({ geo: sphere(0.07, 8, 6), color: skinHex, x: sd * 0.325, y: 0.13, sx: 0.5, sy: 1, sz: 0.8 }); // ear
      headParts.push({ geo: box(0.05, 0.15, 0.06), color: hairHex, x: sd * 0.315, y: 0.2, z: 0.1 }); // sideburn
    }
    if (!o.helmet) {
      headParts.push({ geo: hemi(R + 0.035, 0.53), color: capHex, y: 0.2, sx: 0.93, sy: 1.05, sz: 1.06 });
      headParts.push({ geo: sphere(0.045, 8, 6), color: capHex, y: 0.62 }); // button
      headParts.push({ geo: sphere(0.09, 10, 8), color: trimHex, y: 0.35, z: 0.385, sx: 1.05, sy: 0.9, sz: 0.2 }); // team badge
      headParts.push({ geo: torus(0.375, 0.014, Math.PI * 2, 4, 20), color: capHex, y: 0.235, rx: Math.PI / 2, sx: 0.93, sz: 1.04 }); // band
      headParts.push({ geo: cylHalf(0.4, 0.028), color: u.capBill || capHex, y: 0.28, z: 0.06, ry: -Math.PI * 0.5, rx: 0.16, sz: 0.8 });
    }
    this._merged(this.headG, headParts);
    if (o.helmet) {
      const hm = getMat(helmHex, 0.32, 0.06);
      const helm = this._mesh(hemi(R + 0.045, 0.62), hm, this.headG, 0, 0.19, 0.0);
      helm.scale.set(0.95, 1.08, 1.05);
      const brim = this._mesh(cylHalf(0.42, 0.03), hm, this.headG, 0, 0.27, 0.05);
      brim.rotation.x = 0.08; brim.scale.set(0.9, 1, 1.0); brim.rotation.y = Math.PI;
      const flap = this._mesh(sphere(0.2, 12, 8), hm, this.headG, 0.34, 0.08, 0.02);
      flap.scale.set(0.35, 0.9, 0.9);
      // team badge on the front and a stripe over the top
      this._merged(this.headG, [
        { geo: sphere(0.085, 10, 8), color: trimHex, y: 0.42, z: 0.4, sx: 1.05, sy: 0.9, sz: 0.2 },
        { geo: box(0.05, 0.02, 0.86), color: trimHex, y: 0.62, z: 0.0, rx: 0.0 },
      ]);
    }
    if (isCatcher || isUmpire) {
      const key = 'mask' + R;
      const maskGeo = geoCache[key] || (geoCache[key] = new THREE.SphereGeometry(R + 0.08, 14, 10, -Math.PI * 0.55, Math.PI * 1.1, Math.PI * 0.25, Math.PI * 0.55));
      this._mesh(maskGeo, getMat('#1c1f24', 0.5, 0.3), this.headG, 0, 0.1, 0.05);
    }

    // --- arms (left = +x, right = -x): short jersey sleeve over (undershirt | bare) arm, forearm, hand / glove
    this.arms = [];
    const gloveLeather = ['#6b4226', '#7a4a2a', '#4a3020', '#8a5a2e'][(u.number || 0) % 4];
    for (const side of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(side * DIM.shoulderW, DIM.shoulderY, 0);
      this.spine.add(sh);
      const upper = new THREE.Group(); sh.add(upper);
      this._merged(upper, [
        { geo: sphere(0.235, 12, 10), color: u.primary, sy: 0.95 }, // shoulder
        { geo: capsule(0.152, DIM.upperArm - 0.3, 4, 10), color: armHex, y: -DIM.upperArm / 2, ao: 0.1 },
        { geo: sphere(0.16, 10, 8), color: armHex, y: -DIM.upperArm * 0.62, z: 0.035, sx: 1.0, sy: 1.7, sz: 1.08 }, // biceps / triceps
        { geo: capsule(0.2, 0.42, 4, 12), color: u.primary, y: -0.33 }, // short sleeve
        { geo: cyl(0.205, 0.205, 0.05, 12), color: trimHex, y: -0.7 }, // sleeve piping
      ]);
      const elbow = new THREE.Group(); elbow.position.set(0, -DIM.upperArm, 0); upper.add(elbow);
      const wrist = new THREE.Group(); wrist.position.set(0, -DIM.foreArm, 0); elbow.add(wrist);
      const foreParts = [
        { geo: sphere(0.15, 10, 8), color: armHex }, // elbow
        { geo: cyl(0.138, 0.1, DIM.foreArm - 0.24, 10), color: armHex, y: -DIM.foreArm / 2 - 0.02, ao: 0.08 }, // tapered forearm
        { geo: sphere(0.145, 10, 8), color: armHex, y: -0.3, z: 0.01, sx: 1.02, sy: 1.8, sz: 0.95 }, // forearm muscle (thick by the elbow)
      ];
      const isGloveHand = side === 1 && (o.glove || isCatcher);
      if (isGloveHand) {
        const big = isCatcher;
        const gcol = big ? '#3a2416' : gloveLeather;
        const lace = big ? '#7a5a3a' : '#d2b070';
        const k = big ? 1.45 : 1;
        const gy = -DIM.foreArm;
        foreParts.push(
          { geo: cyl(0.125, 0.13, 0.09, 10), color: '#2b1c12', y: gy + 0.05 }, // wrist strap
          { geo: sphere(0.3 * k, 14, 10), color: gcol, y: gy - 0.1 * k, z: 0.1 * k, sx: 0.95, sy: 1.2, sz: 0.42, ao: 0.12 }, // palm / heel
          { geo: sphere(0.28 * k, 14, 10), color: gcol, y: gy - 0.36 * k, z: 0.13 * k, sx: 0.98, sy: 1.0, sz: 0.4 }, // finger stall
          { geo: capsule(0.075 * k, 0.26 * k, 4, 8), color: gcol, x: -0.19 * k, y: gy - 0.08 * k, z: 0.2 * k, rz: 0.55 }, // thumb
          { geo: torus(0.15 * k, 0.026 * k, Math.PI, 5, 12), color: lace, y: gy - 0.46 * k, z: 0.2 * k, rx: 0.35, rz: Math.PI }, // laced webbing
          { geo: box(0.02, 0.5 * k, 0.03), color: lace, x: 0.0, y: gy - 0.2 * k, z: 0.238 * k }, // palm lace (sits on the leather)
        );
      } else {
        const hand = this.role === 'batter' ? (u.gloves || '#f0f0f0') : skinHex;
        const gy = -DIM.foreArm;
        foreParts.push(
          { geo: sphere(0.12, 10, 8), color: hand, y: gy - 0.07, sx: 1.0, sy: 1.05, sz: 0.72 }, // palm
          { geo: capsule(0.04, 0.1, 3, 6), color: hand, x: -0.095 * side, y: gy - 0.06, z: 0.085, rx: 0.5, rz: 0.5 * side }, // thumb
        );
        // four fingers, curled a little (a loose fist that closes round a bat or a ball)
        for (let f = 0; f < 4; f++) {
          const fx = (-0.075 + f * 0.05) * side;
          foreParts.push({ geo: capsule(0.029, 0.1 - Math.abs(f - 1.5) * 0.012, 3, 6), color: hand, x: fx, y: gy - 0.2, z: 0.05, rx: 0.65 });
          foreParts.push({ geo: sphere(0.03, 6, 5), color: hand, x: fx, y: gy - 0.26, z: 0.12 }); // curled fingertip
        }
        if (this.role === 'batter') {
          foreParts.push(
            { geo: cyl(0.122, 0.122, 0.07, 10), color: '#22252b', y: gy + 0.02 }, // glove cuff
            { geo: box(0.13, 0.16, 0.03), color: u.trim || '#c62828', y: gy - 0.05, z: -0.1 }, // strap
          );
          if (side === 1) foreParts.push({ geo: capsule(0.165, 0.22, 4, 10), color: '#191b20', y: -0.16, sz: 1.05, ao: 0.1 }); // elbow guard on the lead arm
        }
      }
      this._merged(elbow, foreParts);
      this.arms.push({ side, sh, upper, elbow, wrist, len1: DIM.upperArm, len2: DIM.foreArm });
    }

    // --- legs: baggy pants with a side stripe, stirrup socks with bands, and molded cleats
    this.legs = [];
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(side * DIM.hipW, -0.06, 0);
      this.pelvisG.add(hip);
      const thigh = new THREE.Group(); hip.add(thigh);
      this._merged(thigh, [
        { geo: sphere(0.3, 12, 8), color: pantsHex, y: -0.12, sy: 1.1, ao: 0.06 }, // top of the thigh (a baggy pant leg)
        { geo: cyl(0.3, 0.225, DIM.thigh - 0.3, 14), color: pantsHex, y: -DIM.thigh / 2 - 0.02 }, // thigh, tapering to the knee
        { geo: sphere(0.235, 10, 8), color: pantsHex, y: -DIM.thigh, sz: 1.04 }, // knee
        { geo: box(0.045, DIM.thigh - 0.34, 0.16), color: trimHex, x: side * 0.262, y: -DIM.thigh / 2 - 0.02 }, // side stripe
      ]);
      const knee = new THREE.Group(); knee.position.set(0, -DIM.thigh, 0); thigh.add(knee);
      const shinParts = [
        { geo: capsule(0.16, DIM.shin - 0.4, 4, 10), color: socksHex, y: -DIM.shin / 2 + 0.03, ao: 0.1 },
        { geo: sphere(0.17, 10, 8), color: socksHex, y: -0.52, z: -0.05, sx: 1.02, sy: 2.1, sz: 1.1 }, // calf
        { geo: cyl(0.268, 0.236, 0.19, 14), color: pantsHex, y: -0.1 }, // pant cuff below the knee (a touch wider than the knee so the two never z-fight)
        { geo: cyl(0.176, 0.176, 0.07, 10), color: trimHex, y: -0.62 }, // sock bands
        { geo: cyl(0.176, 0.176, 0.05, 10), color: u.secondary || '#ffffff', y: -0.74 },
      ];
      if (isCatcher || isUmpire) shinParts.push({ geo: capsule(0.23, DIM.shin - 0.5, 4, 10), color: u.gear || '#20242b', y: -DIM.shin / 2 + 0.05, z: 0.1, sz: 0.8 });
      this._merged(knee, shinParts);
      const ankle = new THREE.Group(); ankle.position.set(0, -DIM.shin, 0); knee.add(ankle);
      const accent = u.secondary && u.secondary !== shoeHex ? u.secondary : '#d8dbe0';
      this._merged(ankle, [
        { geo: box(0.29, 0.07, 0.86), color: '#0b0c0f', y: -0.225, z: 0.2 }, // sole
        { geo: capsule(0.13, 0.4, 4, 10), color: shoeHex, y: -0.1, z: 0.16, rx: Math.PI / 2, sx: 1.05, sy: 0.9 }, // upper
        { geo: sphere(0.135, 10, 8), color: shoeHex, y: -0.13, z: 0.5, sy: 0.75 }, // toe cap
        { geo: sphere(0.12, 10, 8), color: shoeHex, y: -0.13, z: -0.12 }, // heel
        { geo: cyl(0.115, 0.13, 0.12, 10), color: '#0e1013', y: 0.0 }, // shoe collar
        { geo: box(0.018, 0.07, 0.34), color: accent, x: 0.138, y: -0.1, z: 0.2 }, // side accent
        { geo: box(0.018, 0.07, 0.34), color: accent, x: -0.138, y: -0.1, z: 0.2 },
      ]);
      this.legs.push({ side, hip, thigh, knee, ankle });
    }

    // --- bat (batter only; positioned in root space)
    this.bat = null;
    if (this.role === 'batter') {
      this.bat = makeBat(o.batStyle);
      this.root.add(this.bat);
    }

    // soft blob shadow under the feet
    if (!blobShared) {
      blobShared = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    }
    this.blob = new THREE.Mesh(geoCache.blob || (geoCache.blob = new THREE.PlaneGeometry(3.4, 3.4)), blobShared);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.04;
    this.blob.renderOrder = 2;
    this.root.add(this.blob);
  }

  // Free everything made for this figure alone (shared shapes and colours stay cached). Call once it leaves the scene.
  dispose() {
    for (const g of this.ownGeos) g.dispose();
    this.ownGeos = [];
    releaseJersey(this.jersey);
    this.jersey = null;
    if (this.bat) { disposeBat(this.bat); this.bat = null; }
  }

  setShadows(on) {
    if (this._shadowsOn === on) return;
    this._shadowsOn = on;
    for (const m of this.meshes) m.castShadow = on;
  }

  // Place in the world. yaw = direction the person faces (radians about +y; 0 faces +z).
  place(x, y, z, yaw) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  // Apply the current `this.pose` to the joints (call after place()).
  apply() {
    const p = this.pose;
    const pg = this.pelvisG;
    pg.position.set(p.pelvis[0], p.hipY + p.pelvis[1], p.pelvis[2]);
    pg.rotation.set(p.pelvisPitch, p.pelvisYaw, p.pelvisRoll, 'YXZ');
    this.spine.rotation.set(p.torsoPitch, p.torsoYaw, p.torsoRoll, 'YXZ');
    this.headG.rotation.set(p.headPitch, p.headYaw, 0, 'YXZ');
    this.root.updateMatrixWorld(true);

    // legs: foot targets are given in root space; convert into pelvis space
    const tmp = _t1;
    for (const leg of this.legs) {
      const foot = leg.side === 1 ? p.footL : p.footR;
      tmp.set(foot[0], foot[1], foot[2]);
      pg.worldToLocal(this.root.localToWorld(tmp));
      const hipPos = _t2.copy(leg.hip.position);
      const kp = leg.side === 1 ? p.kneeL : p.kneeR;
      solveTwoBone(DIM.thigh, DIM.shin, hipPos, tmp, _pole.set(kp[0], kp[1], kp[2]), leg.thigh.quaternion, leg.knee.quaternion);
      // foot orientation: flat to the ground (root yaw) with an optional pitch
      leg.hip.updateMatrixWorld(true);
      leg.thigh.updateMatrixWorld(true);
      leg.knee.updateMatrixWorld(true);
      const tilt = leg.side === 1 ? p.footLTilt : p.footRTilt;
      _qw.setFromEuler(_e.set(tilt, 0, 0));
      this.root.getWorldQuaternion(_qr);
      _qw.premultiply(_qr);
      leg.knee.getWorldQuaternion(_qk);
      leg.ankle.quaternion.copy(_qk.invert().multiply(_qw));
    }

    // bat placement (root space) and grip targets
    let gripA = null, gripB = null;
    if (this.bat) {
      this.bat.visible = p.batVis > 0.5;
      const cp = Math.cos(p.batPitch);
      _bd.set(Math.sin(p.batYaw) * cp, Math.sin(p.batPitch), Math.cos(p.batYaw) * cp).normalize();
      this.bat.position.set(p.bat[0], p.bat[1], p.bat[2]);
      this.bat.quaternion.setFromUnitVectors(_up, _bd);
      gripA = _ga.set(p.bat[0], p.bat[1], p.bat[2]).addScaledVector(_bd, 0.18);
      gripB = _gb.set(p.bat[0], p.bat[1], p.bat[2]).addScaledVector(_bd, 0.5);
    }

    // arms
    for (const arm of this.arms) {
      const hand = arm.side === 1 ? p.handL : p.handR;
      const polev = arm.side === 1 ? p.poleL : p.poleR;
      tmp.set(hand[0], hand[1], hand[2]);
      if (this.bat && p.batVis > 0.5) {
        // Hands hold the bat: the "bottom" hand is the person's left (right-handed batter).
        tmp.copy(arm.side === 1 ? gripA : gripB);
      }
      this.spine.worldToLocal(this.root.localToWorld(tmp));
      const shPos = arm.sh.position;
      const pole = _pole.set(polev[0], polev[1], polev[2]);
      solveTwoBone(arm.len1, arm.len2, shPos, tmp, pole, arm.upper.quaternion, arm.elbow.quaternion);
    }
    this.root.updateMatrixWorld(true);
  }

  // World position of a hand (for the ball, glove, bat toss, etc.).
  handWorld(side, out = new THREE.Vector3()) {
    const arm = this.arms[side === 'L' ? 0 : 1];
    arm.wrist.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(arm.wrist.matrixWorld);
  }
  gloveWorld(out = new THREE.Vector3()) {
    const arm = this.arms[0];
    arm.wrist.updateWorldMatrix(true, false);
    out.set(0, -0.1, 0.25);
    return arm.wrist.localToWorld(out);
  }
  batBarrelWorld(out = new THREE.Vector3()) {
    if (!this.bat) return out.set(0, 0, 0);
    out.set(0, 2.35, 0);
    this.bat.updateWorldMatrix(true, false);
    return this.bat.localToWorld(out);
  }
  batWorldMatrix() { this.bat.updateWorldMatrix(true, false); return this.bat.matrixWorld; }
}

const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const _qw = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _qk = new THREE.Quaternion();
const _e = new THREE.Euler();
const _bd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _ga = new THREE.Vector3(), _gb = new THREE.Vector3();

// ---------------------------------------------------------------- bat model (knob at the origin, barrel along +y)
export const BAT_STYLES = {
  ash: { wood: '#c9a066', grip: '#1a1a1a' },
  maple: { wood: '#e8d3a2', grip: '#2a2a2a' },
  midnight: { wood: '#151517', grip: '#c0392b' },
  cherry: { wood: '#8a2a1c', grip: '#111111' },
  golden: { wood: '#e3b93c', grip: '#3a2a08', metal: 0.6 },
  neon: { wood: '#22d3ee', grip: '#111827', emissive: '#0a5566' },
  sunset: { wood: '#f97316', grip: '#1f1400', emissive: '#4a1b00' },
  carbon: { wood: '#2b3440', grip: '#e5e7eb', metal: 0.5 },
};
export function makeBat(styleKey = 'ash') {
  const st = BAT_STYLES[styleKey] || BAT_STYLES.ash;
  const pts = [
    [0.0, 0.0], [0.09, 0.0], [0.085, 0.03], [0.055, 0.12], [0.045, 0.6], [0.05, 0.9], [0.075, 1.5],
    [0.105, 1.95], [0.118, 2.3], [0.118, 2.6], [0.1, 2.72], [0.0, 2.75],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 14);
  const m = new THREE.MeshStandardMaterial({ color: st.wood, roughness: 0.45, metalness: st.metal || 0.05, emissive: st.emissive || '#000000' });
  const bat = new THREE.Mesh(g, m);
  bat.castShadow = true;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.62, 10), new THREE.MeshStandardMaterial({ color: st.grip, roughness: 0.9 }));
  grip.position.y = 0.34;
  bat.add(grip);
  const grp = new THREE.Group();
  grp.add(bat);
  grp.userData.material = m;
  grp.userData.gripMaterial = grip.material;
  return grp;
}
export function disposeBat(grp) {
  grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}
export function restyleBat(grp, styleKey) {
  const st = BAT_STYLES[styleKey] || BAT_STYLES.ash;
  const m = grp.userData.material;
  m.color.set(st.wood); m.metalness = st.metal || 0.05; m.emissive.set(st.emissive || '#000000');
  grp.userData.gripMaterial.color.set(st.grip);
}
