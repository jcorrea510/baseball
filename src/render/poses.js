// Procedural animation: functions that write a pose (see rig.js) for a given moment in time.
// All poses are expressed in person-local space: +y up, +z forward, +x = the person's left.
import { DIM, makePose } from './rig.js';
import { clamp, lerp, smoothstep } from '../util/math.js';

const ANK = DIM.ankle;
const STAND = DIM.hipStand;

// ---------------------------------------------------------------- keyframe sampling (Hermite / Catmull-Rom)
export function sampleKeys(keys, t, out = []) {
  const n = keys.length;
  const m = keys[0].length - 1;
  if (t <= keys[0][0]) { for (let c = 0; c < m; c++) out[c] = keys[0][c + 1]; return out; }
  if (t >= keys[n - 1][0]) { for (let c = 0; c < m; c++) out[c] = keys[n - 1][c + 1]; return out; }
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1][0]) i++;
  const t0 = keys[i][0], t1 = keys[i + 1][0];
  const h = t1 - t0;
  const s = (t - t0) / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let c = 1; c <= m; c++) {
    const p0 = keys[i][c], p1 = keys[i + 1][c];
    const m0 = i > 0 ? (p1 - keys[i - 1][c]) / (t1 - keys[i - 1][0]) : (p1 - p0) / h;
    const m1 = i + 2 < n ? (keys[i + 2][c] - p0) / (keys[i + 2][0] - t0) : (p1 - p0) / h;
    // limit tangents so we do not overshoot flat segments
    const d = (p1 - p0) / h;
    const lm0 = d === 0 ? 0 : m0 * d > 0 ? Math.min(Math.abs(m0), 3 * Math.abs(d)) * Math.sign(m0) : 0;
    const lm1 = d === 0 ? 0 : m1 * d > 0 ? Math.min(Math.abs(m1), 3 * Math.abs(d)) * Math.sign(m1) : 0;
    out[c - 1] = h00 * p0 + h10 * h * lm0 + h01 * p1 + h11 * h * lm1;
  }
  return out;
}
const _k = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function setVec(P, name, keys, u) {
  sampleKeys(keys, u, _k);
  P[name][0] = _k[0]; P[name][1] = _k[1]; P[name][2] = _k[2];
}
const set3 = (v, x, y, z) => { v[0] = x; v[1] = y; v[2] = z; };

export function resetPose(P) {
  const d = makePose();
  for (const k in d) {
    if (Array.isArray(d[k])) { P[k][0] = d[k][0]; P[k][1] = d[k][1]; P[k][2] = d[k][2]; } else P[k] = d[k];
  }
  return P;
}

// ---------------------------------------------------------------- batter (right-handed pose space)
// The bat handle ("knob") position in the stance.
const KNOB_STANCE = [-0.5, 4.5, 0.42];

export function batterPose(P, time, swing) {
  resetPose(P);
  const wag = Math.sin(time * 3.4);
  const breathe = Math.sin(time * 1.6);
  let hip = 2.8 + breathe * 0.02;
  let pelvisYaw = -0.05, torsoYaw = -0.06, torsoPitch = 0.3, pelvisPitch = 0.14;
  let headYawAbs = 1.5, headPitch = 0.16;
  let footLx = 0.95, footLy = ANK, footLz = 0.1, footRx = -0.95, footRz = -0.05, footRTilt = 0;
  let knob = [KNOB_STANCE[0], KNOB_STANCE[1] + wag * 0.05, KNOB_STANCE[2]];
  let batYaw = -1.4 + wag * 0.05, batPitch = 1.0 + wag * 0.07;
  let poleL = [0.8, -0.8, -0.2], poleR = [-0.6, 0.1, -0.8];
  let footLTilt = 0;

  if (swing && time >= swing.tStart) {
    const C = swing.contact; // ball position in pose space
    const early = clamp(swing.early ?? 0, -1, 1);
    const dirYaw = 0.12 + 0.5 * early;
    const sinP = clamp((C[1] - 3.0) / 2.3, -0.6, 0.5);
    const cP = Math.sqrt(1 - sinP * sinP);
    const cKnob = [C[0] - 2.3 * Math.sin(dirYaw) * cP, C[1] - 2.3 * sinP, C[2] - 2.3 * Math.cos(dirYaw) * cP];
    const cPitch = Math.asin(sinP);
    const dur = Math.max(0.03, swing.tHit - swing.tStart);
    if (time < swing.tHit) {
      const u = clamp((time - swing.tStart) / dur, 0, 1);
      const load = smoothstep(0, 0.3, u);
      const ru = clamp((u - 0.2) / 0.8, 0, 1);
      const rot = ru * ru * (1.6 - 0.6 * ru); // accelerating
      pelvisYaw = lerp(-0.05 - 0.2 * load, 0.62, rot);
      torsoYaw = lerp(-0.06 - 0.22 * load, 0.3, rot);
      torsoPitch = lerp(0.3, 0.36, rot);
      hip = 2.8 - 0.14 * load + 0.08 * rot;
      footLx = 0.95 + 0.6 * smoothstep(0, 0.32, u);
      footLy = ANK + 0.5 * Math.sin(Math.PI * clamp(u / 0.34, 0, 1));
      footRTilt = -0.9 * rot;
      const hs = rot;
      knob = [
        lerp(KNOB_STANCE[0] - 0.25 * load, cKnob[0], hs),
        lerp(KNOB_STANCE[1] - 0.05 * load, cKnob[1], hs),
        lerp(KNOB_STANCE[2] - 0.32 * load, cKnob[2], hs),
      ];
      batYaw = lerp(-1.4, dirYaw, Math.pow(rot, 1.15));
      batPitch = lerp(1.05 + 0.15 * load, cPitch, hs);
      headYawAbs = 1.5 - 0.15 * rot;
      headPitch = 0.16 + 0.1 * rot;
      poleL = [0.9, -0.5, -0.4]; poleR = [-0.8, -0.2, -0.6];
    } else {
      const f = clamp((time - swing.tHit) / Math.max(0.05, swing.follow), 0, 1);
      const e = 1 - Math.pow(1 - f, 2.2);
      pelvisYaw = lerp(0.62, 1.12, e);
      torsoYaw = lerp(0.3, 0.7, e);
      torsoPitch = lerp(0.36, 0.2, e);
      hip = lerp(2.88, 3.05, e);
      footLx = 1.55; footLy = ANK;
      footRTilt = lerp(-0.9, -1.1, e);
      knob = [lerp(cKnob[0], 0.55, e), lerp(cKnob[1], 4.6, e), lerp(cKnob[2], 0.15, e)];
      batYaw = lerp(dirYaw, 2.35, e);
      batPitch = lerp(cPitch, 0.75, e);
      headYawAbs = 1.5; headPitch = 0.24;
      poleL = [1.0, -0.4, -0.4]; poleR = [-0.6, 0.2, -0.8];
    }
  }
  P.hipY = hip;
  P.pelvisYaw = pelvisYaw; P.pelvisPitch = pelvisPitch; P.torsoYaw = torsoYaw; P.torsoPitch = torsoPitch;
  P.headYaw = clamp(headYawAbs - (pelvisYaw + torsoYaw), -0.5, 1.5);
  P.headPitch = headPitch;
  set3(P.footL, footLx, footLy, footLz);
  set3(P.footR, footRx, ANK, footRz);
  P.footRTilt = footRTilt; P.footLTilt = footLTilt;
  set3(P.kneeL, 0.3, 0.05, 1); set3(P.kneeR, -0.3, 0.05, 1);
  set3(P.bat, knob[0], knob[1], knob[2]);
  P.batYaw = batYaw; P.batPitch = batPitch; P.batVis = 1;
  P.poleL = poleL.slice(); P.poleR = poleR.slice();
  return P;
}

// ---------------------------------------------------------------- pitcher
// u runs 0..1 up to the moment of release; `post` is seconds after release.
// release = hand position at release in pose space; tell = { slot: -1..1 (arm height), lag: 0..1 (slower arm) }
export function pitcherPose(P, u, post, release, tell = { slot: 0, lag: 0 }) {
  resetPose(P);
  const slot = tell.slot || 0;
  const lag = tell.lag || 0;
  // Arm phase can lag behind the body for a changeup (subtle tell).
  const ua = clamp(u - lag * 0.06 * Math.sin(Math.PI * clamp((u - 0.5) / 0.5, 0, 1)), 0, 1);
  const fin = clamp(post / 0.36, 0, 1); // follow-through progress
  const fe = 1 - Math.pow(1 - fin, 2);

  const s = sampleKeys([
    [0, 3.1, 0.3, 0.0, 0.05, 0.0],
    [0.16, 3.14, 0.6, 0.0, -0.05, 0.0],
    [0.4, 3.3, 1.2, 0.2, -0.12, 0.1],
    [0.6, 3.02, 0.95, 0.5, 0.0, 0.05],
    [0.78, 2.72, 0.35, 0.55, 0.3, -0.1],
    [0.92, 2.52, -0.05, -0.1, 0.5, -0.25],
    [1.0, 2.46, -0.15, -0.5, 0.62, -0.32],
  ], u, []);
  P.hipY = s[0]; P.pelvisYaw = s[1]; P.torsoYaw = s[2]; P.torsoPitch = s[3]; P.pelvisPitch = s[4];
  // pelvis travels toward the plate as the stride lands
  const pz = sampleKeys([[0, 0], [0.16, -0.3], [0.4, -0.35], [0.6, 0.3], [0.78, 2.1], [0.92, 3.9], [1.0, 4.5]], u, [])[0];
  set3(P.pelvis, 0, 0, pz);
  P.headYaw = -(P.pelvisYaw + P.torsoYaw) * 0.85; // keep looking at the catcher
  P.headPitch = 0.05;

  setVec(P, 'footL', [
    [0, 0.42, ANK, 0.3], [0.16, 0.42, ANK, 0.35], [0.4, 0.8, 2.75, 0.75], [0.6, 0.85, 2.35, 1.7], [0.78, 0.6, 0.95, 4.2], [0.92, 0.5, ANK + 0.02, 5.8], [1.0, 0.5, ANK, 5.8],
  ], u);
  setVec(P, 'footR', [
    [0, -0.4, ANK, -0.05], [0.8, -0.4, ANK, -0.05], [0.95, -0.42, ANK + 0.05, 0.05], [1.0, -0.42, ANK + 0.25, 0.1],
  ], u);
  P.footRTilt = -0.9 * smoothstep(0.85, 1.0, u);

  // glove hand
  setVec(P, 'handL', [
    [0, 0.12, 4.0, 0.55], [0.4, 0.2, 4.35, 0.75], [0.62, 0.95, 4.95, 1.9], [0.85, 1.05, 4.6, 3.5], [1.0, 0.8, 4.4, 4.2],
  ], u);
  // throwing hand: down and back, cock, whip through the release point
  const sh = slot * 0.9;
  setVec(P, 'handR', [
    [0, -0.12, 4.0, 0.55],
    [0.4, -0.2, 4.35, 0.75],
    [0.62, -0.95, 3.7, -0.5],
    [0.8, -1.55, 5.3 + sh * 0.6, -1.4],
    [0.92, -1.3 - slot * 0.3, 6.15 + sh * 0.5, 1.5 + release[2] * 0.1],
    [1.0, release[0], release[1], release[2]],
  ], ua);
  if (post > 0) {
    // follow through: hand sweeps across the body toward the opposite hip
    const x = lerp(release[0], 0.6, fe), y = lerp(release[1], 3.0, fe), z = lerp(release[2], release[2] - 0.5, fe);
    set3(P.handR, x, y, z);
    P.torsoPitch = lerp(0.62, 0.95, fe);
    P.pelvisPitch = lerp(-0.32, -0.42, fe);
    P.torsoYaw = lerp(-0.5, -0.75, fe);
    set3(P.handL, lerp(0.8, 0.5, fe), lerp(4.4, 3.4, fe), lerp(4.2, 4.6, fe));
    set3(P.footR, -0.42, lerp(ANK + 0.25, ANK + 0.5, Math.sin(fe * Math.PI)), lerp(0.1, 4.3, fe));
    P.footRTilt = lerp(-0.9, -0.2, fe);
    P.hipY = lerp(2.46, 2.75, fe);
  }
  // elbows
  P.poleR = [-1.0, 0.6 + slot * 0.4, -0.3]; P.poleL = [0.8, -0.4, 0.3];
  set3(P.kneeL, 0.15, 0.1, 1); set3(P.kneeR, -0.15, 0.1, 1);
  return P;
}

// Where the ball is while the pitcher still holds it: in the glove/hands until the arm cocks.
export function pitcherBallInGlove(u) { return u < 0.5; }

// ---------------------------------------------------------------- catcher
export function catcherPose(P, time, mittLocal) {
  resetPose(P);
  const b = Math.sin(time * 1.3) * 0.02;
  P.hipY = 1.5 + b;
  P.torsoPitch = 0.62; P.pelvisPitch = -0.25;
  P.headYaw = 0; P.headPitch = -0.45;
  set3(P.footL, 0.78, ANK, 0.2); set3(P.footR, -0.78, ANK, 0.2);
  P.footLTilt = 0.1; P.footRTilt = 0.1;
  set3(P.kneeL, 0.75, 0.2, 0.8); set3(P.kneeR, -0.75, 0.2, 0.8);
  // Mitt: person's left hand. The catcher faces the pitcher, so local +z points at the pitcher.
  set3(P.handL, mittLocal[0], mittLocal[1], mittLocal[2]);
  set3(P.handR, -0.35, 2.05, 0.2);
  P.poleL = [0.7, -0.6, 0.3]; P.poleR = [-0.9, -0.5, -0.4];
  return P;
}

// ---------------------------------------------------------------- fielders
export function fielderReady(P, time, kind = 'IF') {
  resetPose(P);
  const b = Math.sin(time * 2.1) * 0.025;
  if (kind === 'OF') {
    P.hipY = 3.0 + b; P.torsoPitch = 0.3; P.pelvisPitch = 0.05;
    set3(P.handL, 0.55, 2.7, 0.75); set3(P.handR, -0.5, 2.9, 0.55);
    set3(P.footL, 0.5, ANK, 0.15); set3(P.footR, -0.5, ANK, -0.15);
  } else {
    P.hipY = 2.62 + b; P.torsoPitch = 0.55; P.pelvisPitch = 0.16;
    set3(P.handL, 0.6, 1.95, 1.0); set3(P.handR, -0.45, 2.2, 0.78);
    set3(P.footL, 0.85, ANK, 0.2); set3(P.footR, -0.85, ANK, -0.15);
  }
  P.headPitch = 0.1;
  set3(P.kneeL, 0.4, 0.05, 1); set3(P.kneeR, -0.4, 0.05, 1);
  P.poleL = [0.9, -0.6, -0.1]; P.poleR = [-0.9, -0.6, -0.1];
  return P;
}

// Idle stance for a coach / dugout fan etc.
export function standingPose(P, time) {
  resetPose(P);
  P.hipY = STAND - 0.1 + Math.sin(time * 1.5) * 0.01;
  set3(P.handL, 0.7, 3.0, 0.5); set3(P.handR, -0.7, 3.0, 0.5);
  return P;
}

// Base runner taking a lead: crouched, hands on knees.
export function runnerLeadPose(P, time) {
  resetPose(P);
  const b = Math.sin(time * 2.4) * 0.03;
  P.hipY = 2.55 + b; P.torsoPitch = 0.6; P.pelvisPitch = 0.12;
  set3(P.handL, 0.6, 2.1, 0.55); set3(P.handR, -0.6, 2.1, 0.55);
  set3(P.footL, 0.9, ANK, 0.1); set3(P.footR, -0.9, ANK, -0.1);
  set3(P.kneeL, 0.5, 0.05, 1); set3(P.kneeR, -0.5, 0.05, 1);
  P.headPitch = -0.05;
  return P;
}

// ---------------------------------------------------------------- running
// phase: radians (advance by cadence * dt), speed: ft/s
export function runPose(P, phase, speed) {
  resetPose(P);
  const sp = clamp(speed, 0, 32);
  const k = clamp(sp / 27, 0, 1.15);
  const A = 0.25 + sp * 0.078; // forward/back reach of the foot
  const H = 0.22 + sp * 0.03;  // knee lift
  const sL = Math.sin(phase), cL = Math.cos(phase);
  const sR = Math.sin(phase + Math.PI), cR = Math.cos(phase + Math.PI);
  set3(P.footL, 0.28, ANK + H * Math.max(0, cL), 0.15 + A * sL);
  set3(P.footR, -0.28, ANK + H * Math.max(0, cR), 0.15 + A * sR);
  P.footLTilt = -0.35 * Math.max(0, cL) + 0.25 * Math.max(0, -cL) * (sL > 0 ? 1 : 0);
  P.footRTilt = -0.35 * Math.max(0, cR) + 0.25 * Math.max(0, -cR) * (sR > 0 ? 1 : 0);
  P.hipY = STAND - 0.3 - 0.35 * k - 0.07 * Math.abs(Math.cos(phase)) * (0.4 + k);
  P.pelvisPitch = 0.05 + 0.13 * k; P.torsoPitch = 0.1 + 0.16 * k;
  P.pelvisYaw = -0.18 * k * sL; P.torsoYaw = 0.3 * k * sL;
  P.headYaw = -(P.pelvisYaw + P.torsoYaw) * 0.9; P.headPitch = -0.05;
  const swing = 0.5 + 0.55 * k;
  set3(P.handL, 0.68, 3.35 + 0.45 * Math.max(0, -sL) * k, 0.3 - swing * sL);
  set3(P.handR, -0.68, 3.35 + 0.45 * Math.max(0, -sR) * k, 0.3 - swing * sR);
  P.poleL = [1.0, -0.2, -0.8]; P.poleR = [-1.0, -0.2, -0.8];
  set3(P.kneeL, 0.1, 0.05, 1); set3(P.kneeR, -0.1, 0.05, 1);
  return P;
}
export function runCadence(speed) {
  return clamp(0.5 + speed * 0.066, 0.6, 2.5); // full cycles per second
}

// ---------------------------------------------------------------- throwing (right-handed pose space)
export const THROW_RELEASE_U = 0.55;
export function throwPose(P, u) {
  resetPose(P);
  const g = (keys) => sampleKeys(keys, u, []);
  const t = g([[0, 0, 0, 0], [0.3, -0.7, 0.15, 0.1], [0.55, 0.45, 0.3, 0.35], [1, 0.75, 0.15, 0.6]]);
  P.torsoYaw = t[0]; P.pelvisYaw = t[1] * 0.5; P.torsoPitch = 0.18 + t[2]; P.pelvisPitch = 0.05;
  P.hipY = 2.95 - 0.1 * smoothstep(0.35, 0.6, u);
  P.headYaw = -(P.pelvisYaw + P.torsoYaw) * 0.9;
  const h = g([[0, -0.35, 3.7, 0.55], [0.3, -1.25, 5.3, -0.9], [0.55, -0.75, 5.85, 1.75], [1, 0.35, 3.3, 1.2]]);
  set3(P.handR, h[0], h[1], h[2]);
  const gl = g([[0, 0.45, 3.6, 0.7], [0.4, 0.75, 4.7, 1.6], [1, 0.4, 3.6, 0.9]]);
  set3(P.handL, gl[0], gl[1], gl[2]);
  const fl = g([[0, 0.4, ANK, 0.1], [0.3, 0.4, ANK + 0.55, 0.9], [0.5, 0.4, ANK, 1.7], [1, 0.4, ANK, 1.7]]);
  set3(P.footL, fl[0], fl[1], fl[2]);
  set3(P.footR, -0.42, ANK, -0.45);
  P.footRTilt = -0.5 * smoothstep(0.5, 1, u);
  P.poleR = [-1.0, 0.5, -0.4]; P.poleL = [0.9, -0.4, 0.1];
  set3(P.kneeL, 0.2, 0.05, 1); set3(P.kneeR, -0.2, 0.05, 1);
  return P;
}

// ---------------------------------------------------------------- catching / fielding reach
// target: glove target in pose space. lowness 0..1 how low the ball is.
export function catchPose(P, target, crouch = 0.4) {
  resetPose(P);
  const low = clamp(crouch, 0, 1);
  P.hipY = lerp(3.0, 2.2, low);
  P.torsoPitch = lerp(0.15, 0.7, low);
  P.pelvisPitch = lerp(0.05, 0.25, low);
  set3(P.footL, 0.7, ANK, 0.35); set3(P.footR, -0.7, ANK, -0.25);
  set3(P.handL, target[0], target[1], target[2]);
  set3(P.handR, -0.3, target[1] > 4 ? 4.2 : 3.1, 0.6);
  P.poleL = [0.8, -0.3, -0.3];
  P.headPitch = 0.05;
  set3(P.kneeL, 0.35, 0.05, 1); set3(P.kneeR, -0.35, 0.05, 1);
  return P;
}

// Diving catch / stop: u 0..1 over the dive. Pose space; the caller moves the root along the dive.
export function divePose(P, u) {
  resetPose(P);
  const air = Math.sin(clamp(u / 0.5, 0, 1) * Math.PI * 0.5);
  const down = smoothstep(0.15, 0.55, u);
  P.hipY = lerp(2.9, 1.0, down);
  P.pelvis[2] = lerp(0, 3.3, down);
  P.pelvisPitch = lerp(0.2, 1.42, down);
  P.torsoPitch = lerp(0.2, 0.15, down);
  P.headPitch = -0.6 * down;
  set3(P.handL, 0.35, lerp(2.5, 1.2, down), lerp(1.2, 3.6 + air, down));
  set3(P.handR, -0.35, lerp(2.5, 1.0, down), lerp(0.9, 2.6, down));
  set3(P.footL, 0.4, lerp(ANK, 1.2, down), lerp(0.2, -3.0, down));
  set3(P.footR, -0.4, lerp(ANK, 1.0, down), lerp(-0.2, -3.2, down));
  P.footLTilt = 1.2 * down; P.footRTilt = 1.2 * down;
  set3(P.kneeL, 0.2, 1, 0.3); set3(P.kneeR, -0.2, 1, 0.3);
  P.poleL = [0.8, 0.2, 0.2]; P.poleR = [-0.8, 0.2, 0.2];
  return P;
}

// ---------------------------------------------------------------- celebration
export function celebratePose(P, t, seed = 0) {
  resetPose(P);
  const j = Math.max(0, Math.sin(t * 8 + seed * 5));
  P.hipY = STAND - 0.2 + j * 0.18;
  P.torsoPitch = -0.1;
  set3(P.footL, 0.4, ANK + j * 0.5, 0.1); set3(P.footR, -0.4, ANK + j * 0.5, 0.1);
  set3(P.handL, 0.85, 6.1 + Math.sin(t * 14 + seed) * 0.15, 0.25); set3(P.handR, -0.85, 6.1 + Math.cos(t * 14 + seed) * 0.15, 0.25);
  P.poleL = [1, 0.3, -0.2]; P.poleR = [-1, 0.3, -0.2];
  P.headPitch = -0.25;
  return P;
}
