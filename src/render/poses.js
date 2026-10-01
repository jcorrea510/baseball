// Procedural animation: functions that write a pose (see rig.js) for a given moment in time.
// All poses are expressed in person-local space: +y up, +z forward, +x = the person's left.
import { DIM, makePose, mixPose, copyPose } from './rig.js';
import { clamp, lerp, smoothstep } from '../util/math.js';

const ANK = DIM.ankle;
const TAU = Math.PI * 2;
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
const KNOB_STANCE = [-0.72, 4.1, 0.3];

export function batterPose(P, time, swing, aimY = null) {
  resetPose(P);
  const wag = Math.sin(time * 3.4);
  const breathe = Math.sin(time * 1.6);
  let hip = 2.8 + breathe * 0.02;
  let pelvisYaw = -0.05, torsoYaw = -0.06, torsoPitch = 0.3, pelvisPitch = 0.14;
  let headYawAbs = 1.5, headPitch = 0.16;
  let footLx = 0.95, footLy = ANK, footLz = 0.1, footRx = -0.95, footRz = -0.05, footRTilt = 0;
  // (aimY: where the bat is aimed - the hands come down a little and he sinks a touch for a low pitch, rise for a high one)
  const aimK = aimY === null ? 0 : clamp(aimY - 2.5, -1.4, 1.6);
  hip -= Math.max(0, -aimK) * 0.07;
  let knob = [KNOB_STANCE[0], KNOB_STANCE[1] + wag * 0.05 + aimK * 0.16, KNOB_STANCE[2]];
  let batYaw = -1.4 + wag * 0.05, batPitch = 0.88 + wag * 0.07;
  let poleL = [0.7, -0.9, -0.1], poleR = [-0.7, -0.1, -0.7];
  let footLTilt = 0;

  const k0 = knob.slice(); // (the swing starts from his stance, wherever his hands were)
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
        lerp(k0[0] - 0.25 * load, cKnob[0], hs),
        lerp(k0[1] - 0.05 * load, cKnob[1], hs),
        lerp(k0[2] - 0.32 * load, cKnob[2], hs),
      ];
      batYaw = lerp(-1.4, dirYaw, Math.pow(rot, 1.15));
      batPitch = lerp(0.93 + 0.15 * load, cPitch, hs);
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
      // The follow-through, in steps: the arms extend out toward the pitcher, the bat climbs past the lead shoulder and finishes
      // high behind the head - always round the body, never through it (the bat is steered by its knob, its yaw and its pitch).
      const k = followKey(e, [cKnob, dirYaw, cPitch]);
      knob = k[0]; batYaw = k[1]; batPitch = k[2];
      headYawAbs = 1.5; headPitch = 0.24;
      poleL = [lerp(1.0, 0.6, e), lerp(-0.4, -1, e), lerp(-0.4, 0.3, e)]; poleR = [-0.6, lerp(0.2, -0.3, e), -0.8];
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

// Follow-through keys after contact (e: 0 = contact .. 1 = finish): [knob position, bat yaw, bat pitch]
export const FOLLOW = [
  [0.3, [1.15, 3.5, 0.53], 1.67, 0.29], // arms extended toward the pitcher
  [0.59, [1.04, 4.8, -0.25], 2.5, 0.84], // the bat climbs past the lead shoulder
  [1, [0.15, 4.25, -0.85], 4.02, 0.9], // finish: hands high by the lead shoulder, bat up behind the head
];
function followKey(e, start) {
  let prev = [0, start[0], start[1], start[2]];
  for (const key of FOLLOW) {
    if (e <= key[0]) {
      const u = smoothstep(prev[0], key[0], e);
      return [[lerp(prev[1][0], key[1][0], u), lerp(prev[1][1], key[1][1], u), lerp(prev[1][2], key[1][2], u)], lerp(prev[2], key[2], u), lerp(prev[3], key[3], u)];
    }
    prev = key;
  }
  const last = FOLLOW[FOLLOW.length - 1];
  return [last[1].slice(), last[2], last[3]];
}

// ---------------------------------------------------------------- bunt
// Squared around to bunt: hips and shoulders turned to face the pitcher, knees bent, the bat held level across the front of the
// plate at chest height. `push` = { contact:[x,y,z] (ball in pose space), tStart, tHit } when he pushes the bat out to meet the ball.
const BUNT_DIR = (() => { const yaw = 0.16, p = 0.05; return [Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p)]; })();
export function buntPose(P, time, push = null) {
  resetPose(P);
  const breathe = Math.sin(time * 1.6);
  P.hipY = 2.62 + breathe * 0.015;
  P.pelvisYaw = 1.0; P.torsoYaw = 0.42; P.pelvisPitch = 0.16; P.torsoPitch = 0.34;
  P.headYaw = 0.05; P.headPitch = 0.12;
  set3(P.footL, 0.5, ANK, -0.6); set3(P.footR, 0.15, ANK, 0.62);
  set3(P.kneeL, 1, 0.1, -0.2); set3(P.kneeR, 1, 0.1, 0.3);
  let knob = [0.85, 3.42, 0.3]; // (squared around: the bat level at the top of the strike zone, out over the plate)
  if (push && time >= push.tStart) {
    // the sweet spot (1.9 ft up the bat) goes out to where the ball crosses, then the bat gives a little as it "catches" the ball
    const C = push.contact;
    const meet = [C[0] - BUNT_DIR[0] * 1.9, C[1] - BUNT_DIR[1] * 1.9, C[2] - BUNT_DIR[2] * 1.9];
    const u = smoothstep(push.tStart, push.tHit, time);
    const give = time > push.tHit ? smoothstep(push.tHit, push.tHit + 0.25, time) : 0;
    knob = [lerp(knob[0], meet[0], u) - 0.25 * give, lerp(knob[1], meet[1], u), lerp(knob[2], meet[2], u)];
  }
  set3(P.bat, knob[0], knob[1], knob[2]);
  P.batYaw = 0.16; P.batPitch = 0.05; P.batVis = 1;
  P.poleL = [0.6, -0.8, -0.4]; P.poleR = [0.4, -0.8, 0.6];
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
  const fin = clamp(post / 0.4, 0, 1); // follow-through progress
  const fe = 1 - Math.pow(1 - fin, 3); // starts fast (the arm is still moving at release) and eases to rest

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

  // glove hand: the glove arm stays bent and leads toward the plate (elbow first), then tucks in as he throws
  setVec(P, 'handL', [
    [0, 0.12, 4.0, 0.55], [0.4, 0.2, 4.15, 0.8], [0.6, 0.55, 4.05, 1.4], [0.78, 0.7, 3.95, 2.5], [0.9, 0.75, 4.05, 3.5], [1.0, 0.7, 4.25, 4.0],
  ], u);
  // throwing hand: the hands break, the arm swings down past the hip, back and up into a cocked "L" (elbow at the shoulder,
  // forearm up) as the front foot lands, then whips forward over the top through the release point
  const sh = slot * 0.9;
  setVec(P, 'handR', [
    [0, -0.12, 4.0, 0.55],
    [0.4, -0.2, 4.35, 0.75],
    [0.55, -0.75, 3.7, 0.15],
    [0.64, -1.3, 3.55, -0.35],
    [0.72, -1.55, 3.95, -0.7],
    [0.8, -1.35, 5.7 + sh * 0.5, -0.85],
    [0.92, -1.2 - slot * 0.3, 6.15 + sh * 0.5, 1.5 + release[2] * 0.1],
    [1.0, release[0], release[1], release[2]],
  ], ua);
  if (post > 0) {
    // follow through: the arm keeps going, across the body and down to the glove-side knee
    const x = lerp(release[0], 0.75, fe), y = lerp(release[1], 2.35, fe), z = lerp(release[2], release[2] - 0.2, fe);
    set3(P.handR, x, y, z);
    P.torsoPitch = lerp(0.62, 0.95, fe);
    P.pelvisPitch = lerp(-0.32, -0.42, fe);
    P.torsoYaw = lerp(-0.5, -0.75, fe);
    set3(P.handL, lerp(0.8, 0.5, fe), lerp(4.4, 3.4, fe), lerp(4.2, 4.6, fe));
    set3(P.footR, -0.42, lerp(ANK + 0.25, ANK + 0.5, Math.sin(fe * Math.PI)), lerp(0.1, 4.3, fe));
    P.footRTilt = lerp(-0.9, -0.2, fe);
    P.hipY = lerp(2.46, 2.75, fe);
    set3(P.pelvis, 0, 0, 4.5 + 0.4 * fe); // the body carries on a little past the release instead of stopping dead
  }
  // elbows: the throwing elbow points back as the arm swings down, out to the side (at shoulder height) when it is cocked;
  // the glove elbow points at the plate
  const cock = smoothstep(0.66, 0.8, ua) * (1 - smoothstep(0.92, 1, ua));
  P.poleR = [-1.0, lerp(0.1, -0.35, cock) + slot * 0.4, lerp(-0.8, -0.2, cock)];
  P.poleL = [0.6, -0.5, lerp(0.3, 0.9, smoothstep(0.5, 0.8, u))];
  set3(P.kneeL, 0.15, 0.1, 1); set3(P.kneeR, -0.15, 0.1, 1);
  return P;
}

// Where the ball is while the pitcher still holds it: in the glove/hands until the arm cocks.
export function pitcherBallInGlove(u) { return u < 0.42; }

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
  // a living stance: a slow weight shift from foot to foot and an occasional glance around (feet stay planted)
  const sway = Math.sin(time * 0.6);
  P.pelvis[0] = sway * 0.06; P.pelvisRoll = sway * 0.02; P.torsoRoll = -sway * 0.03;
  P.headYaw = Math.sin(time * 0.35 + 1.3) * 0.16;
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
// phase: radians (advance by cadence * dt), speed: ft/s.
// o (optional): { accel: ft/s^2 (+ speeding up, - slowing down), side: sideways ft/s^2 (+ = pulled toward his right, i.e. turning right) }.
//  * bob: the body is lowest when a foot is planted under it and rises in the flight between strides (twice per cycle)
//  * lean: forward at speed, a lot more while he is getting up to speed, back while he is braking
//  * arms drive harder when accelerating; the pelvis and shoulders counter-rotate; he banks into a turn
export function runPose(P, phase, speed, look = 0, o = null) {
  resetPose(P);
  const sp = clamp(speed, 0, 34);
  const k = clamp(sp / 27, 0, 1.15);
  const acc = o ? clamp(o.accel / 70, -1, 1) : 0;
  const drive = Math.max(0, acc), sit = Math.max(0, -acc);
  const bank = o ? clamp(o.side / 55, -1, 1) : 0;
  // Each foot: a short ground contact (a sprinter is on the ground about a third of the time, a jogger about half), during which
  // it moves back at exactly the running speed (no sliding), then the swing: toe-off, the heel kicks up behind, the knee comes
  // through and the foot reaches forward to land just ahead of the hips.
  const cad = runCadence(sp);
  const duty = lerp(0.5, 0.33, clamp(k, 0, 1));
  const L = sp > 0.3 ? (sp * duty) / cad : 0; // stride on the ground (ft)
  const zf = 0.32 * L + 0.15, zb = 0.68 * L - 0.15; // (he lands nearly under his hips and pushes off well behind)
  const heel = 0.25 + 1.25 * clamp(k, 0, 1.1); // how high the heel kicks up behind
  const foot = (c, out, x) => {
    let y, z, tilt;
    if (c < duty) { // on the ground, moving back under him
      const u = c / duty;
      z = lerp(zf, -zb, u); y = ANK; tilt = -0.45 * smoothstep(0.7, 1, u); // rolls onto the toes to push off
    } else {
      const u = (c - duty) / (1 - duty);
      const e = u * u * (3 - 2 * u);
      z = lerp(-zb, zf, e); // the foot comes up behind, then swings through
      y = ANK + heel * Math.sin(Math.PI * Math.pow(u, 0.72)) * (0.35 + 0.65 * (1 - u)) + 0.08 * k * Math.sin(Math.PI * u);
      tilt = lerp(-0.7, 0.05, smoothstep(0.1, 0.85, u));
    }
    set3(out, x, y, z + 0.1);
    return tilt;
  };
  const cL = ((phase / TAU) % 1 + 1) % 1, cR = (cL + 0.5) % 1;
  P.footLTilt = foot(cL, P.footL, 0.28);
  P.footRTilt = foot(cR, P.footR, -0.28);
  // the hips are lowest as a foot takes his weight, highest in the air between steps
  const inStance = (c) => (c < duty ? Math.sin(Math.PI * (c / duty)) : 0);
  const dip = Math.max(inStance(cL), inStance(cR));
  const bob = (0.05 + 0.14 * k) * (0.5 + 0.5 * k);
  P.hipY = STAND - 0.22 - 0.2 * k - 0.32 * sit - bob * dip + 0.05 * drive;
  P.pelvisPitch = 0.05 + 0.13 * k + 0.16 * drive - 0.14 * sit;
  P.torsoPitch = 0.1 + 0.16 * k + 0.4 * drive - 0.3 * sit;
  // hips turn with the leg that is forward, shoulders the other way (-1..1: left foot back .. left foot forward)
  const sL = clamp((P.footL[2] - P.footR[2]) / Math.max(0.5, zf + zb), -1, 1);
  P.pelvisYaw = -0.16 * k * sL; P.torsoYaw = 0.26 * k * sL;
  P.pelvisRoll = 0.06 * k * sL + bank * 0.14; P.torsoRoll = -0.04 * k * sL + bank * 0.24;
  P.headYaw = -(P.pelvisYaw + P.torsoYaw) * 0.9; P.headPitch = -0.05 - 0.2 * drive;
  // arms: bent at the elbow, pumping opposite to the legs - the hand comes up toward the chin in front and back past the hip
  const pump = (0.45 + 0.5 * clamp(k, 0, 1.1) + 0.25 * drive);
  const arm = (fwd, x, out) => set3(out, x, 3.35 + (0.5 + 0.35 * drive) * k * Math.max(0, fwd) - 0.15 * Math.max(0, -fwd), 0.3 + pump * fwd);
  arm(-sL, 0.62, P.handL); // (each arm swings opposite to its own leg)
  arm(sL, -0.62, P.handR);
  P.poleL = [0.9, -0.6, -0.9]; P.poleR = [-0.9, -0.6, -0.9];
  set3(P.kneeL, 0.1, 0.05, 1); set3(P.kneeR, -0.1, 0.05, 1);
  // eyes on the ball: a running fielder keeps his body pointed where he is going but turns his head (and a little torso)
  if (look) { P.headYaw = clamp(P.headYaw + look * 0.85, -1.25, 1.25); P.torsoYaw += clamp(look, -1, 1) * 0.22; }
  return P;
}
// Running with the glove arm reaching for the ball (a running catch); the other arm keeps pumping.
export function runReachPose(P, phase, speed, target, look = 0) {
  runPose(P, phase, speed, look);
  set3(P.handL, target[0], target[1], target[2]);
  P.poleL = [0.8, -0.3, -0.3];
  P.torsoPitch = Math.max(0.05, P.torsoPitch - 0.05);
  return P;
}
export function runCadence(speed) {
  return clamp(0.5 + speed * 0.066, 0.6, 2.5); // full cycles per second
}

// ---------------------------------------------------------------- sliding into a base
// Feet-first hook slide: sitting back, one leg stretched out toward the bag, the other tucked, hands up and back.
const _slEnd = makePose(), _slStand = makePose();
function slideLayout(P, breathe = 0) {
  resetPose(P);
  P.hipY = 0.7 + breathe; P.pelvisPitch = -1.3; P.torsoPitch = -0.45; P.headPitch = 0.3;
  set3(P.footL, 0.28, 0.55, 3.0); P.footLTilt = -0.5;
  set3(P.footR, -0.4, 0.85, 1.55); P.footRTilt = -0.15;
  set3(P.kneeL, 0.15, 0.3, 1); set3(P.kneeR, -0.35, 1, 0.5);
  set3(P.handL, 0.85, 2.3, -0.9); set3(P.handR, -0.85, 2.3, -0.9);
  P.poleL = [1, 0.4, -0.3]; P.poleR = [-1, 0.4, -0.3];
  return P;
}
/** u 0..1 while he goes down (`from` = the pose the instant he starts sliding, so nothing pops); after that he stays sat on the bag. */
export function slidePose(P, u, from = null, time = 0) {
  slideLayout(_slEnd, Math.sin(time * 5) * 0.01);
  const k = smoothstep(0, 0.45, clamp(u, 0, 1));
  if (from) return mixPose(P, from, _slEnd, k);
  return copyPose(P, _slEnd);
}
/** After the slide: brushes himself off and gets to his feet (u 0..1), ready to lead off. */
export function slideGetUp(P, u, time = 0) {
  slideLayout(_slEnd, 0);
  runnerLeadPose(_slStand, time);
  const k = smoothstep(0, 1, clamp(u, 0, 1));
  return mixPose(P, _slEnd, _slStand, k);
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

// ---------------------------------------------------------------- diving
// A layout dive in four phases (the root travels along the path; these are the body shapes):
//   air    u 0..1  from the last stride to touchdown: launch, stretch out, glove meets the ball at u = 0.727
//   slide  u 0..1  belly-down slide, glove out in front
//   hold   u 0..1  lying there with the ball
//   getup  u 0..1  hands and knees, up to a crouch, back to the ready stance
// `glove` is the ball position in body space (the glove reaches for it); `from` is the pose he was in the instant he left the
// ground (the last running stride) so the launch does not pop.
const _dk = [0, 0, 0];
const dk = (keys, u) => { sampleKeys(keys, u, _dk); return _dk[0]; };
const _dAir = makePose(), _dProne = makePose(), _dKneel = makePose(), _dReady = makePose(), _dPrev = makePose();
const DIVE_GLOVE_GROUND = [0.42, 0.5, 3.35];
const DIVE_CATCH_U = 0.727; // (airTime / (airTime + landAfter))

function airLayout(P, a, glove) {
  resetPose(P);
  P.hipY = dk([[0, 3.0], [0.3, 2.7], [0.6, 2.15], [0.727, 1.85], [1, 1.0]], a);
  P.pelvisPitch = dk([[0, 0.3], [0.3, 0.8], [0.6, 1.25], [0.727, 1.35], [1, 1.45]], a);
  P.torsoPitch = dk([[0, 0.3], [0.5, 0.15], [1, 0.0]], a);
  P.headPitch = dk([[0, 0.0], [0.5, -0.6], [1, -0.85]], a);
  set3(P.footL, 0.32, dk([[0, ANK], [0.4, 1.0], [0.727, 1.8], [1, 1.3]], a), dk([[0, 0.15], [0.4, -1.4], [0.727, -2.4], [1, -2.6]], a));
  set3(P.footR, -0.32, dk([[0, ANK], [0.4, 0.9], [0.727, 1.6], [1, 1.1]], a), dk([[0, -0.1], [0.4, -1.6], [0.727, -2.6], [1, -2.8]], a));
  P.footLTilt = 0.9; P.footRTilt = 1.0;
  set3(P.kneeL, 0.2, 1, -0.2); set3(P.kneeR, -0.2, 1, -0.2);
  set3(P.handR, -0.45, dk([[0, 3.3], [0.5, 2.4], [0.727, 2.0], [1, 0.8]], a), dk([[0, 0.3], [0.5, 2.0], [0.727, 3.0], [1, 3.4]], a));
  // glove arm: reaches for the ball until the catch, then comes down with it
  const reach = smoothstep(0.02, 0.55, a);
  const g = glove || [0.45, 1.5, 3.4];
  const down = smoothstep(DIVE_CATCH_U, 1, a);
  const hx = lerp(0.68, lerp(g[0], DIVE_GLOVE_GROUND[0], down), reach);
  const hy = lerp(3.35, lerp(g[1], DIVE_GLOVE_GROUND[1], down), reach);
  const hz = lerp(0.5, lerp(g[2], DIVE_GLOVE_GROUND[2], down), reach);
  set3(P.handL, hx, hy, hz);
  P.poleL = [0.9, 0.2, 0.1]; P.poleR = [-0.9, 0.2, 0.1];
  return P;
}
function proneLayout(P, breathe = 0) {
  resetPose(P);
  P.hipY = 0.64 + breathe; P.pelvisPitch = 1.5; P.torsoPitch = 0.0; P.headPitch = -0.9;
  set3(P.footL, 0.3, 0.42, -2.6); set3(P.footR, -0.3, 0.4, -2.8);
  P.footLTilt = 1.3; P.footRTilt = 1.3;
  set3(P.kneeL, 0.2, 1, -0.1); set3(P.kneeR, -0.2, 1, -0.1);
  set3(P.handL, DIVE_GLOVE_GROUND[0], DIVE_GLOVE_GROUND[1], DIVE_GLOVE_GROUND[2]); set3(P.handR, -0.42, 0.42, 3.0);
  P.poleL = [0.9, 0.3, 0.0]; P.poleR = [-0.9, 0.3, 0.0];
  return P;
}
function kneelLayout(P) {
  resetPose(P);
  P.hipY = 1.25; P.pelvisPitch = 0.95; P.torsoPitch = -0.05; P.headPitch = -0.35;
  set3(P.footL, 0.36, 0.4, -1.5); set3(P.footR, -0.36, 0.4, -1.6);
  P.footLTilt = 1.0; P.footRTilt = 1.0;
  set3(P.kneeL, 0.2, 1, 0.8); set3(P.kneeR, -0.2, 1, 0.8);
  set3(P.handL, 0.45, 0.9, 2.3); set3(P.handR, -0.42, 0.7, 2.1);
  P.poleL = [0.9, 0.2, 0.0]; P.poleR = [-0.9, 0.2, 0.0];
  return P;
}

export function divePose(P, phase, u, glove = null, from = null, time = 0, catchU = DIVE_CATCH_U) {
  u = clamp(u, 0, 1);
  if (phase === 'air') {
    // the keyframes put the catch at DIVE_CATCH_U; stretch/squeeze time so it lands when this dive's catch really happens
    const w = u < catchU ? (u * DIVE_CATCH_U) / catchU : DIVE_CATCH_U + ((u - catchU) * (1 - DIVE_CATCH_U)) / Math.max(1e-6, 1 - catchU);
    airLayout(_dAir, w, glove);
    if (from) mixPose(P, from, _dAir, smoothstep(0, 0.32, u)); else copyPose(P, _dAir);
    return P;
  }
  const breathe = Math.sin(time * 6) * 0.012;
  if (phase === 'slide') {
    airLayout(_dAir, 1, glove); proneLayout(_dProne, 0);
    return mixPose(P, _dAir, _dProne, smoothstep(0, 0.55, u));
  }
  if (phase === 'hold') return proneLayout(P, breathe);
  // getup
  proneLayout(_dProne, 0); kneelLayout(_dKneel); fielderReady(_dReady, time, 'IF');
  const k = smoothstep(0, 1, u);
  if (k < 0.45) return mixPose(P, _dProne, _dKneel, smoothstep(0, 1, k / 0.45));
  return mixPose(P, _dKneel, _dReady, smoothstep(0, 1, (k - 0.45) / 0.55));
}
export const DIVE_CATCH_PROGRESS = DIVE_CATCH_U;

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

// ---------------------------------------------------------------- plate umpire
// Gestures for each call. `sinceCall` = seconds since the call began (or -1). kinds:
//   strike / strikeSwing  raised right fist, one punch      strike3 / strike3Swing  a big punch-out, two pumps
//   ball                  a tiny hand-flick and head shake   foul                    both arms straight up
//   safe                  both arms swept flat, palms down   out                     right fist hammered down
export function umpirePose(P, time, sinceCall = -1, kind = 'strike') {
  resetPose(P);
  const b = Math.sin(time * 1.4) * 0.02;
  P.hipY = 2.15 + b;
  P.torsoPitch = 0.52; P.pelvisPitch = -0.1; P.headPitch = -0.3;
  set3(P.footL, 0.8, ANK, 0.35); set3(P.footR, -0.7, ANK, -0.25);
  set3(P.kneeL, 0.55, 0.1, 1); set3(P.kneeR, -0.55, 0.1, 1);
  set3(P.handL, 0.62, 2.55, 0.55); set3(P.handR, -0.62, 2.55, 0.55);
  P.poleL = [0.8, -0.5, -0.2]; P.poleR = [-0.8, -0.5, -0.2];
  if (sinceCall < 0) return P;
  const stand = (up) => { P.hipY = lerp(P.hipY, 2.95, up); P.torsoPitch = lerp(P.torsoPitch, 0.05, up); P.headPitch = lerp(P.headPitch, -0.05, up); };
  const dur = kind === 'strike3' || kind === 'strike3Swing' ? 1.6 : kind === 'ball' ? 0.7 : 1.15;
  if (sinceCall > dur) return P;
  const env = smoothstep(0, 0.16, sinceCall) * (1 - smoothstep(dur - 0.3, dur, sinceCall));
  if (kind === 'ball') {
    // no big signal on a ball: a flat flick of the hand and a small shake of the head
    P.headYaw = Math.sin(sinceCall * 15) * 0.22 * env;
    set3(P.handR, lerp(-0.62, -1.15, env), lerp(2.55, 3.1, env), lerp(0.55, 0.75, env));
    return P;
  }
  stand(env);
  if (kind === 'foul') {
    // both arms straight up
    set3(P.handR, lerp(-0.62, -1.0, env), lerp(2.55, 6.2, env), lerp(0.55, 0.3, env));
    set3(P.handL, lerp(0.62, 1.0, env), lerp(2.55, 6.2, env), lerp(0.55, 0.3, env));
    P.poleR = [-1, 0.3, -0.2]; P.poleL = [1, 0.3, -0.2];
    return P;
  }
  if (kind === 'safe') {
    // arms swept out flat, palms down
    const sweep = smoothstep(0.08, 0.3, sinceCall) * env;
    set3(P.handR, lerp(-0.4, -2.4, sweep), lerp(2.55, 4.1, sweep), 0.35);
    set3(P.handL, lerp(0.4, 2.4, sweep), lerp(2.55, 4.1, sweep), 0.35);
    P.poleR = [-0.2, -0.9, -0.4]; P.poleL = [0.2, -0.9, -0.4];
    return P;
  }
  // strike / out: right fist up, then punched. The punch-out (strike three) pumps twice and leans in.
  const big = kind === 'strike3' || kind === 'strike3Swing';
  const punchT = clamp((sinceCall - 0.14) / 0.35, 0, 1);
  const punch = (Math.sin(punchT * Math.PI) + (big ? Math.sin(clamp((sinceCall - 0.62) / 0.35, 0, 1) * Math.PI) : 0)) * (big ? 0.55 : kind === 'out' ? 0.4 : 0.25);
  set3(P.handR, lerp(-0.62, -0.95, env), lerp(2.55, 5.3, env) + punch, lerp(0.55, 0.45, env));
  P.poleR = [-1, 0.2, -0.3];
  if (big) P.torsoPitch += 0.18 * Math.sin(punchT * Math.PI);
  return P;
}
