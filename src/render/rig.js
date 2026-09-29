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
const jerseyCache = new Map();
function getJerseyMat(u, mirror) {
  const key = [u.primary, u.secondary, u.trim, u.text, u.number, u.stripe, mirror].join('|');
  let m = jerseyCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: jerseyTexture({ primary: u.primary, secondary: u.secondary, trim: u.trim, text: u.text || '', number: u.number || 0, stripe: !!u.stripe, mirror }), roughness: 0.9 });
    jerseyCache.set(key, m);
  }
  return m;
}
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
function capsule(r, len, ss = 6, rs = 12) {
  const key = `c${r}|${len}|${ss}|${rs}`;
  return geoCache[key] || (geoCache[key] = new THREE.CapsuleGeometry(r, len, ss, rs));
}
function sphere(r, w = 16, h = 12) {
  const key = `s${r}|${w}|${h}`;
  return geoCache[key] || (geoCache[key] = new THREE.SphereGeometry(r, w, h));
}

let _vertexMat = null;
function vertexMat() {
  if (!_vertexMat) _vertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  return _vertexMat;
}
function cyl(rt, rb, h, seg = 12) {
  const key = `y${rt}|${rb}|${h}|${seg}`;
  return geoCache[key] || (geoCache[key] = new THREE.CylinderGeometry(rt, rb, h, seg));
}
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
    const g = p.geo.clone().applyMatrix4(_mm);
    vCount += g.getAttribute('position').count;
    iCount += g.index.count;
    return { g, color: p.color };
  });
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const { g, color } of baked) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array, vo * 3);
    nor.set(g.getAttribute('normal').array, vo * 3);
    _mc.set(color);
    for (let i = 0; i < n; i++) { col[(vo + i) * 3] = _mc.r; col[(vo + i) * 3 + 1] = _mc.g; col[(vo + i) * 3 + 2] = _mc.b; }
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
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  _buildMeshes(o) {
    const u = o.uniform;
    const skinHex = o.skin || '#e0ac82';
    const shirt = getJerseyMat(u, this.mirror);
    const pantsHex = u.pants || '#f2f2ee';
    const sleeveHex = u.sleeve || u.primary;
    const socksHex = u.socks || u.secondary;
    const capHex = u.cap || u.primary;
    const shoeHex = '#16181c';
    const beltHex = '#141414';
    const helmHex = u.helmet || u.cap || u.primary;
    this.meshes = [];

    // --- pelvis group (hip height is animated): pelvis + belt as one mesh
    this.pelvisG = new THREE.Group();
    this.root.add(this.pelvisG);
    this._merged(this.pelvisG, [
      { geo: sphere(0.5, 16, 10), color: pantsHex, y: 0.02, sx: 0.9, sy: 0.62, sz: 0.68 },
      { geo: cyl(0.5, 0.5, 0.12, 20), color: beltHex, y: 0.12, sx: 0.98, sy: 1, sz: 0.68 },
    ]);

    // --- spine / torso (textured jersey)
    this.spine = new THREE.Group();
    this.spine.position.set(0, 0.1, 0);
    this.pelvisG.add(this.spine);
    const torso = this._mesh(capsule(0.5, 0.62, 6, 16), shirt, this.spine, 0, 0.82, 0);
    torso.scale.set(0.97, 1, 0.66);
    this.torsoMesh = torso;
    if (this.role === 'catcher' || this.role === 'umpire') {
      const chest = this._mesh(capsule(0.52, 0.5, 6, 16), getMat(u.gear || '#20242b', 0.7), this.spine, 0, 0.9, 0.08);
      chest.scale.set(0.98, 1, 0.78);
    }

    // --- head group: neck, head, face, ears, cap - one mesh
    this.headG = new THREE.Group();
    this.headG.position.set(0, DIM.spine + DIM.neck * 0.5 + 0.2, 0);
    this.spine.add(this.headG);
    const headParts = [
      { geo: cyl(0.12, 0.14, DIM.neck + 0.08, 10), color: skinHex, y: -0.19 },
      { geo: sphere(DIM.headR, 18, 14), color: skinHex, y: 0.14, z: 0.02, sx: 0.9, sy: 1.06, sz: 1.0 },
      { geo: sphere(0.045, 8, 6), color: skinHex, y: 0.1, z: 0.37 },
    ];
    for (const sd of [-1, 1]) {
      headParts.push({ geo: sphere(0.03, 8, 6), color: '#1b1512', x: sd * 0.13, y: 0.2, z: 0.33 });
      headParts.push({ geo: box(0.13, 0.025, 0.03), color: '#2a1d14', x: sd * 0.13, y: 0.27, z: 0.335 });
      headParts.push({ geo: sphere(0.07, 8, 6), color: skinHex, x: sd * 0.33, y: 0.12, sx: 0.5, sy: 1, sz: 0.8 });
    }
    if (!o.helmet) {
      headParts.push({ geo: hemi(DIM.headR + 0.03, 0.52), color: capHex, y: 0.2, sx: 0.93, sy: 1.05, sz: 1.06 });
      headParts.push({ geo: cylHalf(0.4, 0.025), color: u.capBill || capHex, y: 0.28, z: 0.06, ry: -Math.PI * 0.5, rx: 0.16, sz: 0.8 });
    }
    this._merged(this.headG, headParts);
    if (o.helmet) {
      const hm = getMat(helmHex, 0.35, 0.05);
      const helm = this._mesh(hemi(DIM.headR + 0.045, 0.62), hm, this.headG, 0, 0.19, 0.0);
      helm.scale.set(0.95, 1.08, 1.05);
      const brim = this._mesh(cylHalf(0.42, 0.03), hm, this.headG, 0, 0.27, 0.05);
      brim.rotation.x = 0.08; brim.scale.set(0.9, 1, 1.0); brim.rotation.y = Math.PI;
      const flap = this._mesh(sphere(0.2, 12, 8), hm, this.headG, 0.34, 0.08, 0.02);
      flap.scale.set(0.35, 0.9, 0.9);
    }
    if (this.role === 'catcher' || this.role === 'umpire') {
      const mask = this._mesh(new THREE.SphereGeometry(DIM.headR + 0.08, 14, 10, -Math.PI * 0.55, Math.PI * 1.1, Math.PI * 0.25, Math.PI * 0.55), getMat('#1c1f24', 0.5, 0.3), this.headG, 0, 0.1, 0.05);
      void mask;
    }

    // --- arms (left = +x, right = -x): upper (sleeve + shoulder) and forearm (skin + hand / glove)
    this.arms = [];
    for (const side of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(side * DIM.shoulderW, DIM.shoulderY, 0);
      this.spine.add(sh);
      const upper = new THREE.Group(); sh.add(upper);
      this._merged(upper, [
        { geo: sphere(0.25, 12, 10), color: u.primary },
        { geo: capsule(0.17, DIM.upperArm - 0.34, 4, 10), color: sleeveHex, y: -DIM.upperArm / 2 },
      ]);
      const elbow = new THREE.Group(); elbow.position.set(0, -DIM.upperArm, 0); upper.add(elbow);
      const wrist = new THREE.Group(); wrist.position.set(0, -DIM.foreArm, 0); elbow.add(wrist);
      const foreParts = [{ geo: capsule(0.135, DIM.foreArm - 0.27, 4, 10), color: o.armSkin === false ? sleeveHex : skinHex, y: -DIM.foreArm / 2 }];
      const isGloveHand = side === 1 && (o.glove || this.role === 'catcher');
      if (isGloveHand) {
        const gcol = this.role === 'catcher' ? '#3a2416' : '#6b4226';
        const size = this.role === 'catcher' ? 0.42 : 0.3;
        foreParts.push({ geo: sphere(size, 12, 10), color: gcol, y: -DIM.foreArm - 0.08, z: 0.12, sx: 0.9, sy: 1.05, sz: 0.55 });
      } else {
        const handHex = this.role === 'batter' ? (u.gloves || '#f0f0f0') : skinHex;
        foreParts.push({ geo: sphere(0.14, 10, 8), color: handHex, y: -DIM.foreArm - 0.06 });
      }
      this._merged(elbow, foreParts);
      this.arms.push({ side, sh, upper, elbow, wrist, len1: DIM.upperArm, len2: DIM.foreArm });
    }

    // --- legs: thigh (+ knee), shin (socks) and foot
    this.legs = [];
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(side * DIM.hipW, -0.06, 0);
      this.pelvisG.add(hip);
      const thigh = new THREE.Group(); hip.add(thigh);
      this._merged(thigh, [
        { geo: capsule(0.245, DIM.thigh - 0.42, 4, 10), color: pantsHex, y: -DIM.thigh / 2 + 0.03 },
        { geo: sphere(0.235, 10, 8), color: pantsHex, y: -DIM.thigh },
      ]);
      const knee = new THREE.Group(); knee.position.set(0, -DIM.thigh, 0); thigh.add(knee);
      const shinParts = [{ geo: capsule(0.185, DIM.shin - 0.4, 4, 10), color: socksHex, y: -DIM.shin / 2 + 0.03 }];
      if (this.role === 'catcher' || this.role === 'umpire') shinParts.push({ geo: capsule(0.23, DIM.shin - 0.5, 4, 10), color: u.gear || '#20242b', y: -DIM.shin / 2 + 0.05, z: 0.1, sz: 0.8 });
      this._merged(knee, shinParts);
      const ankle = new THREE.Group(); ankle.position.set(0, -DIM.shin, 0); knee.add(ankle);
      this._merged(ankle, [{ geo: box(0.3, 0.2, 0.72), color: shoeHex, y: -0.16, z: 0.16 }]);
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
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), blobShared);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.04;
    this.blob.renderOrder = 2;
    this.root.add(this.blob);
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
export function restyleBat(grp, styleKey) {
  const st = BAT_STYLES[styleKey] || BAT_STYLES.ash;
  const m = grp.userData.material;
  m.color.set(st.wood); m.metalness = st.metal || 0.05; m.emissive.set(st.emissive || '#000000');
  grp.userData.gripMaterial.color.set(st.grip);
}
