// Procedural animation: functions that write a pose (see rig.js) for a given moment in time.
// All poses are expressed in person-local space: +y up, +z forward, +x = the person's left.
import { DIM, makePose, mixPose, copyPose } from './rig.js';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { CONFIG } from '../config.js';

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

// ---------------------------------------------------------------- feet
// The ball of the foot, from the ankle (foot space): where a foot pivots and pushes off.
const FOOT_BALL = { y: -0.26, z: 0.4 };
// Where the ankle has to be for the ball of the foot to rest on the ground at (bx, by, bz) with the foot turned `yaw` and tipped `tilt`
// (+ = heel up, toes down; rig.js turns the foot about the ankle): a foot that pivots or rolls up onto its toes stays where it is
// planted instead of sinking into the ground or sliding.
export function footOnBall(out, bx, bz, yaw, tilt, by = 0) {
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const y = FOOT_BALL.y * ct - FOOT_BALL.z * st;
  const zl = FOOT_BALL.y * st + FOOT_BALL.z * ct;
  out[0] = bx - Math.sin(yaw) * zl; out[1] = by - y; out[2] = bz - Math.cos(yaw) * zl;
  return out;
}

// ---------------------------------------------------------------- batter (right-handed pose space)
// The stance: the bat handle ("knob") with the hands relaxed in front of the back shoulder, a little below it and back from the
// face, and the bat laid back at about 45 deg (yaw / pitch, radians). His weight sits back on the rear leg (`WEIGHT_BACK` ft).
const KNOB_STANCE = [-0.55, 3.82, 0.95];
const BAT_STANCE = { yaw: -1.5, pitch: 0.76 };
const WEIGHT_BACK = 0.12;
const FOOT_L0 = [0.95, 0.1], FOOT_R0 = [-0.95, -0.05]; // his feet in the stance (ankle x, z)
// The load at its fullest, on top of the stance: the hands go back and up a little, the bat tips a touch further back, the hips and
// shoulders coil in (the front shoulder tucks), the weight goes back and he sinks into his back leg.
const LOAD = { knob: [-0.26, 0.08, -0.1], batYaw: -0.1, batPitch: 0.1, pelvisYaw: -0.17, torsoYaw: -0.2, weight: -0.07, hip: -0.05 };
// Reaching in the swing (ft of pose space): a ball further out over the plate than `awayFrom` (forward of him) or lower than `lowFrom`
// - per foot beyond: hips shift toward it `shift`, the upper body leans `lean` (radians), the front foot strides `stride` further
// out, and for a low ball he leans `lowLean` and sinks `sink`.
const REACH = { awayFrom: 2.6, lowFrom: 2.6, shift: 0.42, lean: 0.38, stride: 0.35, lowLean: 0.14, sink: 0.24 };
// At contact (the same for every swing - the hands can reach every pitch from here; measured): hips open, shoulders square to the
// pitcher's side, the weight onto the front leg, standing up into a braced front leg, the back foot up on its toe and turned in.
const AT_CONTACT = { pelvisYaw: 0.62, torsoYaw: 0.3, torsoPitch: 0.36, hip: 2.88, backYaw: 0.9, backTilt: 0.62 };
// The swing from the press (u = 0) to contact (u = 1), as shares of the way from where he was to the contact position: the hips fire
// first while the shoulders stay closed (the stretch between them), then the shoulders unwind; the hands drop into the slot and come
// forward close to his body with the barrel lagging behind them; in the last third the barrel whips round to meet the ball.
const SW_HIPS = [[0, 0], [0.3, 0.5], [0.62, 0.86], [1, 1]];
const SW_SHOULDERS = [[0, 0], [0.3, 0.1], [0.62, 0.55], [1, 1]];
const SW_HANDS = [[0, 0], [0.3, 0.14], [0.65, 0.56], [1, 1]];
const SW_BARREL = [[0, 0], [0.45, 0.07], [0.75, 0.4], [1, 1]];
const SW_SLOT = [0.04, -0.3, -0.14]; // the hands' detour into the slot (ft, at the middle of the swing): down and in close to the body
const SW_FLAT = 0.38; // the bat's pitch in the slot: it flattens out behind him before the barrel comes round
// The follow-through after contact (e: 0 = contact .. 1 = finish): [e, knob x, y, z, bat yaw, bat pitch]. The arms extend out through
// the ball toward the pitcher, the bat climbs past the lead shoulder and wraps round behind his head - always round the body, never
// through it (measured: the bat stays clear of the head and the chest the whole way).
export const FOLLOW = [
  [0.24, 1.2, 3.4, 1.05, 1.45, 0.08], // extension: both arms long out in front, the bat pointing at the pitcher
  [0.52, 1.15, 4.5, 0.55, 2.4, 0.72], // the bat climbs past the lead shoulder
  [1, 0.3, 4.7, -0.62, 3.75, -0.12], // finish: hands high by the lead shoulder, the bat across his back
];
const FREE_HAND = [0.95, 3.95, 0.45]; // where a top hand that has let go of the bat ends up (in front of his chest)
// Coming back into his stance after the follow-through: the bat comes down over his shoulder in front of him first.
const RECOVER_KNOB = [-0.15, 3.65, 0.75];

// The load for a pitch: { hands, stride, lift, relax } at `time`, from the pitch's release and arrival times (tm = { tRelease, tCross }).
export function batterLoad(time, tm, swung = false, out = {}) {
  out.hands = 0; out.stride = 0; out.lift = 0; out.relax = 0;
  if (!tm) return out;
  const A = CONFIG.anim.batter;
  out.hands = smoothstep(tm.tRelease - A.loadStart, tm.tRelease - A.loadEnd, time);
  const t0 = tm.tCross - A.liftAt, t1 = tm.tCross - A.landAt;
  const s = clamp((time - t0) / (t1 - t0), 0, 1);
  out.stride = smoothstep(0.25, 1, s); // (up first, then out and down)
  out.lift = Math.sin(Math.PI * Math.pow(s, 0.8));
  if (!swung) out.relax = smoothstep(tm.tCross + A.relax[0], tm.tCross + A.relax[1], time);
  return out;
}
const _ld = {}, _ld0 = {};

// The stance (with the load for this pitch) at `time`: writes P and returns P.
function batterStance(P, time, aimY, ld) {
  const wag = Math.sin(time * 3.4);
  const breathe = Math.sin(time * 1.6);
  const h = ld.hands * (1 - ld.relax);
  // (aimY: where the bat is aimed - the hands come down a little and he sinks a touch for a low pitch, rise for a high one)
  const aimK = aimY === null ? 0 : clamp(aimY - 2.5, -1.4, 1.6);
  // (not frozen: the hands drift in a slow small loop, the bat waggles, and his weight rocks a little on the back leg - all of it
  // settles as he loads)
  const live = 1 - h;
  const loop = time * 1.7, rock = Math.sin(time * 0.9);
  P.hipY = 2.72 + breathe * 0.02 * live - Math.max(0, -aimK) * 0.07 + LOAD.hip * h;
  P.pelvisYaw = -0.05 + LOAD.pelvisYaw * h; P.torsoYaw = -0.06 + LOAD.torsoYaw * h;
  P.torsoPitch = 0.18; P.pelvisPitch = 0.12;
  P.pelvis[0] = -WEIGHT_BACK + rock * 0.03 * live + LOAD.weight * h; P.pelvis[2] = 0;
  P.bat[0] = KNOB_STANCE[0] + Math.cos(loop) * 0.04 * live + LOAD.knob[0] * h;
  P.bat[1] = KNOB_STANCE[1] + (wag * 0.04 + Math.sin(loop) * 0.03) * live + aimK * 0.16 + LOAD.knob[1] * h;
  P.bat[2] = KNOB_STANCE[2] + LOAD.knob[2] * h;
  P.batYaw = BAT_STANCE.yaw + wag * 0.06 * live + LOAD.batYaw * h;
  P.batPitch = BAT_STANCE.pitch + wag * 0.09 * live + LOAD.batPitch * h;
  // the front foot: up (the knee coming in toward the back knee, toes down), out toward the pitcher and down again; after a pitch he
  // let go by he steps back into his stance
  const A = CONFIG.anim.batter;
  const st = ld.stride * (1 - ld.relax);
  const stepBack = Math.sin(Math.PI * ld.relax) * (ld.stride > 0.5 ? 1 : 0);
  const lift = Math.max(ld.lift * A.liftHeight * (1 - ld.relax), stepBack * 0.18);
  set3(P.footL, FOOT_L0[0] + A.stride * st - 0.14 * ld.lift * (1 - st), ANK + lift, FOOT_L0[1]);
  P.footLTilt = lift * 1.4; P.footLYaw = 0.2 * st;
  set3(P.kneeL, 0.3 - 0.75 * ld.lift * (1 - ld.relax), 0.05, 1);
  set3(P.footR, FOOT_R0[0], ANK, FOOT_R0[1]); P.footRTilt = 0; P.footRYaw = 0;
  set3(P.kneeR, -0.3, 0.05, 1);
  P.headYaw = 1.5; P.headPitch = 0.16;
  // (the lead elbow points down in front of the chest, the back elbow down under the hands)
  set3(P.poleL, 0.3, -1, 0.45); set3(P.poleR, -0.5, -1, -0.35);
  P.batVis = 1; P.topHandOff = 0;
  return P;
}

// `tm` = { tRelease, tCross } of the pitch he is facing (his load is timed to it), or null; `oneHand` = he finishes with one hand.
export function batterPose(P, time, swing, aimY = null, tm = null, oneHand = false) {
  resetPose(P);
  if (!swing || time < swing.tStart) {
    batterStance(P, time, aimY, batterLoad(time, tm, false, _ld));
    return finishBatter(P);
  }
  // the swing starts from wherever his load had him at the press
  const s0 = batterStance(_bs0, swing.tStart, aimY, batterLoad(swing.tStart, tm, true, _ld0));
  const k0 = s0.bat;
  const C = swing.contact; // ball position in pose space
  const early = clamp(swing.early ?? 0, -1, 1);
  const dirYaw = 0.12 + 0.5 * early;
  const sinP = clamp((C[1] - 3.0) / 2.3, -0.6, 0.5);
  const cP = Math.sqrt(1 - sinP * sinP);
  const cKnob = [C[0] - 2.3 * Math.sin(dirYaw) * cP, C[1] - 2.3 * sinP, C[2] - 2.3 * Math.cos(dirYaw) * cP];
  const cPitch = Math.asin(sinP);
  const dur = Math.max(0.03, swing.tHit - swing.tStart);
  // Reaching for a pitch away from him (out over the plate) or down low: he strides a little toward it, leans out over the plate
  // and sinks, so his hands can still get the bat there - full at contact, easing off through the follow-through.
  const away = clamp(C[2] - REACH.awayFrom, 0, 1.6), low = clamp(REACH.lowFrom - C[1], 0, 1.4);
  const reach = (k) => {
    P.pelvis[2] = k * away * REACH.shift;
    P.torsoPitch += k * (away * REACH.lean + low * REACH.lowLean);
    P.hipY -= k * (low * REACH.sink + away * 0.06);
    P.footL[2] += k * away * REACH.stride;
  };
  const ballR = [FOOT_R0[0], FOOT_R0[1] + FOOT_BALL.z]; // the back foot pivots on the ball of his foot
  P.pelvisPitch = 0.12;
  if (time < swing.tHit) {
    const u = clamp((time - swing.tStart) / dur, 0, 1);
    const hp = sampleKeys(SW_HIPS, u, _k)[0];
    const sp = sampleKeys(SW_SHOULDERS, u, _k)[0];
    const kp = sampleKeys(SW_HANDS, u, _k)[0];
    const bp = sampleKeys(SW_BARREL, u, _k)[0];
    P.pelvisYaw = lerp(s0.pelvisYaw, AT_CONTACT.pelvisYaw, hp);
    const sh = lerp(s0.pelvisYaw + s0.torsoYaw, AT_CONTACT.pelvisYaw + AT_CONTACT.torsoYaw, sp);
    P.torsoYaw = sh - P.pelvisYaw;
    P.pelvis[0] = lerp(s0.pelvis[0], WEIGHT_BACK, smoothstep(0, 0.55, u)); // (the weight goes from the back leg onto the front one)
    P.torsoPitch = lerp(s0.torsoPitch, AT_CONTACT.torsoPitch, smoothstep(0, 1, u));
    P.hipY = lerp(s0.hipY, AT_CONTACT.hip, smoothstep(0.15, 1, u));
    // the front foot: if it was still on its way down at the press it lands at once (it is always down before the hips fire)
    const land = smoothstep(0, 0.28, u);
    set3(P.footL, lerp(s0.footL[0], FOOT_L0[0] + CONFIG.anim.batter.stride, land), lerp(s0.footL[1], ANK, land), FOOT_L0[1]);
    P.footLTilt = s0.footLTilt * (1 - land); P.footLYaw = lerp(s0.footLYaw, 0.2, land);
    set3(P.kneeL, lerp(s0.kneeL[0], 0.3, land), 0.05, 1);
    // the back foot turns on its toe as the back knee drives in toward the front one
    const pv = smoothstep(0.1, 1, u);
    P.footRYaw = AT_CONTACT.backYaw * pv; P.footRTilt = AT_CONTACT.backTilt * pv;
    footOnBall(P.footR, ballR[0], ballR[1], P.footRYaw, P.footRTilt);
    set3(P.kneeR, lerp(-0.3, 0.45, pv), 0.05 - 0.1 * pv, 1);
    // hands: from the load into the slot, close to the body, and on to the contact position; the barrel lags, then whips round
    const slot = Math.sin(Math.PI * Math.min(1, u / 0.92));
    for (let c = 0; c < 3; c++) P.bat[c] = lerp(k0[c], cKnob[c], kp) + SW_SLOT[c] * slot;
    P.batYaw = lerp(s0.batYaw, dirYaw, bp);
    P.batPitch = u < 0.45 ? lerp(s0.batPitch, SW_FLAT, smoothstep(0, 0.45, u)) : lerp(SW_FLAT, cPitch, smoothstep(0.45, 1, u));
    P.headYaw = 1.5 - 0.15 * smoothstep(0, 1, u); P.headPitch = 0.16 + 0.1 * u;
    set3(P.poleL, 0.9, -0.5, -0.4); set3(P.poleR, -0.8, -0.2, -0.6);
    P.batVis = 1;
    reach(smoothstep(0, 1, u));
    return finishBatter(P);
  }
  const A = CONFIG.anim.batter;
  const fol = Math.max(0.05, swing.follow);
  const f = clamp((time - swing.tHit) / fol, 0, 1);
  const e = 1 - Math.pow(1 - f, 2.2);
  P.pelvisYaw = lerp(AT_CONTACT.pelvisYaw, 1.2, e);
  P.pelvis[0] = lerp(WEIGHT_BACK, WEIGHT_BACK + 0.1, e);
  P.torsoYaw = lerp(AT_CONTACT.torsoYaw, 0.62, e);
  P.torsoPitch = lerp(AT_CONTACT.torsoPitch, 0.16, e);
  P.hipY = lerp(AT_CONTACT.hip, 3.02, e);
  set3(P.footL, FOOT_L0[0] + A.stride, ANK, FOOT_L0[1]); P.footLYaw = lerp(0.2, 0.55, e);
  set3(P.kneeL, 0.3, 0.05, 1);
  // the back foot finishes up on its toe, laces turned down toward the pitcher, the back knee in beside the front one
  P.footRYaw = lerp(AT_CONTACT.backYaw, 1.3, e); P.footRTilt = lerp(AT_CONTACT.backTilt, 1.0, e);
  footOnBall(P.footR, ballR[0], ballR[1], P.footRYaw, P.footRTilt);
  set3(P.kneeR, lerp(0.45, 0.8, e), -0.05, 1);
  // the follow-through keys, smoothly through each one (no stop at a key)
  const keys = _fk;
  keys[0] = [0, cKnob[0], cKnob[1], cKnob[2], dirYaw, cPitch];
  for (let i = 0; i < FOLLOW.length; i++) keys[i + 1] = FOLLOW[i];
  const k = sampleKeys(keys, e, _k);
  set3(P.bat, k[0], k[1], k[2]); P.batYaw = k[3]; P.batPitch = k[4];
  P.headYaw = 1.5 - 0.35 * smoothstep(0.3, 1, e); P.headPitch = lerp(0.26, 0.1, smoothstep(0.3, 1, e));
  set3(P.poleL, lerp(1.0, 0.6, e), lerp(-0.4, -1, e), lerp(-0.4, 0.3, e)); set3(P.poleR, -0.6, lerp(0.2, -0.3, e), -0.8);
  // a one-handed finish: the top hand lets go once the arms are through and drops in front of his chest
  if (oneHand) { P.topHandOff = smoothstep(A.oneHandAt[0], A.oneHandAt[1], e); set3(P.handR, FREE_HAND[0], FREE_HAND[1], FREE_HAND[2]); set3(P.poleR, -0.4, -1, -0.3); }
  P.batVis = 1;
  reach(1 - smoothstep(0, 0.45, e));
  // a moment in the finish, then back into his stance: the bat comes down over his shoulder in front of him and goes back up into the
  // stance, the hips and shoulders turn back, the front foot steps back in and the back heel comes down
  const r = clamp((time - swing.tHit - fol - 0.2) / A.recover, 0, 1);
  if (r > 0) {
    const st = batterStance(_bs0, time, aimY, batterLoad(time, null, false, _ld));
    const q = smoothstep(0, 1, r);
    const sc = ['hipY', 'pelvisYaw', 'torsoYaw', 'torsoPitch', 'pelvisPitch', 'headYaw', 'headPitch', 'footLYaw', 'footLTilt'];
    for (const s of sc) P[s] = lerp(P[s], st[s], q);
    for (const v of ['pelvis', 'kneeL', 'kneeR', 'poleL', 'poleR']) for (let c = 0; c < 3; c++) P[v][c] = lerp(P[v][c], st[v][c], q);
    P.footL[0] = lerp(P.footL[0], st.footL[0], q); P.footL[1] = ANK + 0.18 * Math.sin(Math.PI * q); P.footL[2] = lerp(P.footL[2], st.footL[2], q);
    P.footRYaw *= 1 - q; P.footRTilt *= 1 - q;
    footOnBall(P.footR, ballR[0], ballR[1], P.footRYaw, P.footRTilt);
    P.topHandOff *= 1 - smoothstep(0, 0.5, r);
    // the bat: down in front of him (the short way round to the stance), then up into the stance
    // (the stance's yaw a whole turn on, so the bat keeps turning the way it was going - back over his shoulder)
    let ey = st.batYaw; while (ey < P.batYaw) ey += TAU;
    const end = [st.bat[0], st.bat[1], st.bat[2], ey, st.batPitch];
    const rk = [[0, P.bat[0], P.bat[1], P.bat[2], P.batYaw, P.batPitch], [0.45, RECOVER_KNOB[0], RECOVER_KNOB[1], RECOVER_KNOB[2], lerp(P.batYaw, ey, 0.55), 0.9], [1, ...end]];
    const b = sampleKeys(rk, r, _k);
    set3(P.bat, b[0], b[1], b[2]); P.batYaw = b[3]; P.batPitch = b[4];
  }
  return finishBatter(P);
}
const _bs0 = makePose(), _fk = [];
function finishBatter(P) {
  // the head: eyes on the ball, the head turned back against the hips and shoulders
  P.headYaw = clamp(P.headYaw - (P.pelvisYaw + P.torsoYaw), -0.5, 1.5);
  P.batYaw = Math.atan2(Math.sin(P.batYaw), Math.cos(P.batYaw)); // (one turn of the bat: blending poses never spins it the long way)
  return P;
}

// ---------------------------------------------------------------- bunt
// Squared around to bunt: hips and shoulders turned to face the pitcher, knees bent, the bat held level across the front of the
// plate. `aim` = [x,y,z] in pose space: where you hold the bat (its sweet spot follows it, so the bat you see is the bat you aim);
// `push` = { contact:[x,y,z] (ball in pose space), tStart, tHit } when he pushes the bat out to meet the ball.
const BUNT_DIR = (() => { const yaw = 0.16, p = 0.05; return [Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p)]; })();
const BUNT_SWEET = 1.9; // how far up the bat (feet from the knob) the sweet spot is
const BUNT_BACK = 1.0; // ft his body sits back (toward the catcher) from the bat, so it is out in front of him
export function buntPose(P, time, push = null, aim = null) {
  resetPose(P);
  const breathe = Math.sin(time * 1.6);
  // Squared around like a real bunter: feet, knees, hips and shoulders all turned to the pitcher together (no twist at the waist),
  // feet about shoulder width apart, knees bent, back fairly straight, eyes level behind the bat.
  // His whole body sits `BUNT_BACK` ft back from where the bat meets the ball, so the bat is out in front of him with his arms
  // reaching to it (not tucked in his lap).
  P.hipY = 2.6 + breathe * 0.015;
  P.pelvis[0] = -BUNT_BACK;
  P.pelvisYaw = 1.3; P.torsoYaw = 0.12; P.pelvisPitch = 0.12; P.torsoPitch = 0.16;
  P.headYaw = 0.1; P.headPitch = 0.02;
  set3(P.footL, 0.42 - BUNT_BACK, ANK, -0.5); set3(P.footR, 0.3 - BUNT_BACK, ANK, 0.5);
  P.footLYaw = 1.15; P.footRYaw = 1.3; // (toes toward the pitcher)
  set3(P.kneeL, 0.12, 0.05, 1); set3(P.kneeR, -0.12, 0.05, 1); // (knees straight ahead over the toes - knee directions are in the hips' own frame)
  let knob = [0.85, 3.42, 0.3]; // (squared around: the bat level at the top of the strike zone, out over the plate)
  if (aim) knob = [aim[0] - BUNT_DIR[0] * BUNT_SWEET, aim[1] - BUNT_DIR[1] * BUNT_SWEET, aim[2] - BUNT_DIR[2] * BUNT_SWEET];
  // He goes to the bat with his body rather than reaching with straight arms, his eyes staying up on the pitch: a low bat - mostly
  // the knees, he sits down into it with his hips back the way you squat (right down into a crouch for one at his shins) and his
  // chest tips forward only a little; a bat out over the plate - he leans that way from the hips; one out in front - he shifts toward
  // the pitcher. (Feet stay planted; the rig keeps the bat in his hands whatever happens.)
  const low = clamp(3.42 - knob[1], 0, 2.6);
  const out = clamp(knob[2] - 0.3, -0.5, 1.2);
  const fwd = clamp(knob[0] - 0.85, -0.8, 1.2);
  const bend = Math.min(0.3, low * 0.09 + Math.max(0, out) * 0.12);
  P.hipY -= low * 0.44;
  P.pelvis[0] -= low * 0.12; // (hips back as he sits down)
  P.torsoPitch += bend;
  P.pelvisPitch += low * 0.1;
  P.pelvis[2] += out * 0.3;
  P.pelvis[0] += fwd * 0.2;
  P.headPitch -= (bend + low * 0.1) * 0.85;
  if (push && time >= push.tStart) {
    // the sweet spot (1.9 ft up the bat) goes out to where the ball crosses, then the bat gives a little as it "catches" the ball
    const C = push.contact;
    const meet = [C[0] - BUNT_DIR[0] * BUNT_SWEET, C[1] - BUNT_DIR[1] * BUNT_SWEET, C[2] - BUNT_DIR[2] * BUNT_SWEET];
    const u = smoothstep(push.tStart, push.tHit, time);
    const give = time > push.tHit ? smoothstep(push.tHit, push.tHit + 0.25, time) : 0;
    knob = [lerp(knob[0], meet[0], u) - 0.25 * give, lerp(knob[1], meet[1], u), lerp(knob[2], meet[2], u)];
  }
  set3(P.bat, knob[0], knob[1], knob[2]);
  P.batYaw = 0.16; P.batPitch = 0.05; P.batVis = 1;
  P.gripTop = 1.05; // (the top hand slides up toward the label to steady the bat; it slides up as he squares around)
  P.poleL = [0.6, -0.8, -0.4]; P.poleR = [0.4, -0.8, 0.6];
  return P;
}

// ---------------------------------------------------------------- pitcher
// A right-hander's delivery from the stretch, as ONE continuous timeline (a left-hander is the same figure mirrored). The phase `p`
// runs 0..1 over the windup up to the release, and on after it at the same rate (p = 1 + seconds after release / windup length), so
// the body and the arm come through the release without a hitch:
//   0     set: side on to the plate (glove-side shoulder toward it), hands together at the chest, eyes on the catcher
//   .38   balance point: front knee up to the belt, hips over the back foot, turned a little away from the plate
//   .44   the hands break (the ball goes with the throwing hand) and the hips lead down the mound
//   .72   front foot lands: hips starting to open, shoulders still closed, glove arm out at the plate, throwing arm cocked in an "L"
//   .84   the hips are open, the shoulders turn, the forearm lays back
//   1     release out in front, chest over the front knee, trunk tilted to the glove side (from here on p advances at the same rate)
//   1.4   follow-through: the arm finishes outside the front knee, the back leg swings round beside the front one
//   1.62  up into a fielding stance facing the plate, then five steps back up onto the rubber, turning side on: set again by 2.9
// Directions: person space (+z toward the plate, +x his glove side). A yaw < 0 turns his front toward third base (closed).
// Times are phases; positions in feet; angles in radians.
const PITCH = {
  set: 2.9, // phase by which he is back in his set position
  stance: 1.62, // phase of the fielding stance after the follow-through (where the walk back starts)
  walkDur: 1.1, // the walk back runs at least as slowly as after a windup this long (s)
  ballToHand: [0.36, 0.46], // phases over which the ball goes from between the hands into the throwing hand
  slotRoll: 0.8, // share the trunk's tilt to the glove side grows by per unit of arm slot (a higher slot tilts further)
  slotTall: 0.3, // ft he stays taller on his front leg through the release per unit of arm slot (so a high slot's hand reaches)
  slotCock: 0.35, // ft higher the cocked hand sits per unit of arm slot
  lag: 0.05, // phase the arm trails the body by on a changeup (a subtle tell)
};
// [phase, hipY, pelvisYaw, torsoYaw, torsoPitch, pelvisPitch, torsoRoll, pelvisX, pelvisZ]
const P_BODY = [
  [0, 3.06, -1.42, -0.06, 0.08, 0.04, 0, 0, 0.98],
  [0.14, 3.1, -1.45, -0.08, 0.06, 0.03, 0, 0, 0.62],
  [0.38, 3.18, -1.62, -0.14, 0.02, -0.04, 0.02, 0, 0.38],
  [0.5, 3.02, -1.6, -0.16, 0.0, 0.0, 0.04, 0, 0.95],
  [0.6, 2.82, -1.48, -0.22, 0.0, 0.02, 0.04, 0, 1.95],
  [0.72, 2.56, -0.9, -0.5, 0.06, 0.04, 0.0, 0, 2.75],
  [0.84, 2.5, -0.15, -0.38, 0.22, 0.06, -0.14, 0, 3.25],
  [0.93, 2.47, 0.08, -0.08, 0.44, 0.08, -0.12, 0, 3.55],
  [1.0, 2.45, 0.2, 0.05, 0.64, 0.1, -0.15, 0, 3.75],
  [1.15, 2.4, 0.4, 0.3, 0.92, 0.12, -0.1, -0.05, 4.05],
  [1.3, 2.42, 0.5, 0.45, 1.0, 0.1, -0.05, -0.25, 4.4],
  [1.45, 2.52, 0.22, 0.12, 0.72, 0.06, 0, -0.55, 4.8],
  [1.62, 2.74, 0.02, 0.0, 0.38, 0.04, 0, -0.62, 5.05],
  [1.8, 3.0, 0, 0, 0.15, 0.03, 0, -0.6, 4.95],
  [1.95, 3.08, 0, 0, 0.1, 0.02, 0, -0.5, 4.4],
  [2.15, 3.08, -0.05, 0, 0.08, 0.02, 0, -0.45, 3.45],
  [2.35, 3.08, -0.2, 0, 0.08, 0.02, 0, -0.3, 2.3],
  [2.55, 3.07, -0.7, -0.03, 0.08, 0.03, 0, -0.1, 1.6],
  [2.72, 3.06, -1.25, -0.05, 0.08, 0.04, 0, 0, 1.08],
  [2.9, 3.06, -1.42, -0.06, 0.08, 0.04, 0, 0, 0.98],
];
// feet: [phase, x, y, z, yaw, tilt (+ = toes down)]
const P_FOOT_L = [
  [0, -0.05, ANK, 1.78, -1.3, 0],
  [0.1, -0.05, ANK, 1.78, -1.3, 0],
  [0.22, -0.3, 1.05, 1.15, -1.42, 0.35],
  [0.38, -0.7, 1.72, 0.55, -1.5, 0.5],
  [0.5, -0.5, 1.3, 1.6, -1.45, 0.4],
  [0.6, -0.22, 0.72, 3.45, -1.05, 0.1],
  [0.68, -0.08, ANK + 0.12, 4.75, -0.5, -0.05],
  [0.72, -0.05, ANK, 5.0, -0.35, 0],
  [1.45, -0.05, ANK, 5.0, -0.35, 0],
  [1.7, -0.05, ANK, 5.0, -0.2, 0],
  [2.0, -0.05, ANK, 5.0, -0.2, 0],
  [2.08, -0.1, ANK + 0.35, 3.9, -0.4, 0.1],
  [2.16, -0.15, ANK, 2.8, -0.6, 0],
  [2.4, -0.15, ANK, 2.8, -0.6, 0],
  [2.47, -0.1, ANK + 0.25, 2.3, -1.0, 0.1],
  [2.54, -0.05, ANK, 1.78, -1.3, 0],
  [2.9, -0.05, ANK, 1.78, -1.3, 0],
];
const P_FOOT_R = [
  [0, 0, ANK, 0.22, -1.5, 0],
  [0.62, 0, ANK, 0.22, -1.5, 0],
  [0.72, 0, ANK + 0.02, 0.25, -1.3, 0.25],
  [0.84, -0.02, ANK + 0.06, 0.45, -0.9, 0.75],
  [1.0, -0.12, ANK + 0.08, 1.2, -0.5, 1.05],
  [1.15, -0.35, 1.05, 2.6, -0.3, 0.7],
  [1.3, -0.85, 0.85, 4.3, -0.1, 0.3],
  [1.45, -1.25, ANK, 5.25, 0, 0],
  [1.82, -1.25, ANK, 5.25, 0, 0],
  [1.9, -1.05, ANK + 0.35, 4.6, -0.1, 0.1],
  [1.98, -0.85, ANK, 3.9, -0.2, 0],
  [2.2, -0.85, ANK, 3.9, -0.2, 0],
  [2.28, -0.6, ANK + 0.35, 2.7, -0.5, 0.1],
  [2.36, -0.4, ANK, 1.5, -0.8, 0],
  [2.6, -0.4, ANK, 1.5, -0.8, 0],
  [2.68, -0.15, ANK + 0.3, 0.85, -1.2, 0.1],
  [2.76, 0, ANK, 0.22, -1.5, 0],
  [2.9, 0, ANK, 0.22, -1.5, 0],
];
// glove hand (his left)
const P_HAND_L = [
  [0, -0.62, 3.98, 1.07],
  [0.14, -0.62, 4.1, 0.75],
  [0.38, -0.64, 4.42, 0.5],
  [0.46, -0.6, 4.35, 0.85],
  [0.6, -0.3, 4.45, 2.6],
  [0.72, 0.0, 4.4, 4.45],
  [0.84, 0.35, 4.3, 4.65],
  [1.0, 0.72, 4.0, 4.65],
  [1.15, 0.8, 3.55, 4.75],
  [1.3, 0.6, 3.3, 5.0],
  [1.45, 0.1, 3.5, 5.8],
  [1.62, -0.25, 3.55, 6.05],
  [1.85, 0.05, 3.25, 5.4],
  [2.15, 0.0, 3.1, 3.7],
  [2.35, -0.1, 3.15, 2.6],
  [2.55, -0.4, 3.5, 1.7],
  [2.75, -0.58, 3.9, 1.15],
  [2.9, -0.62, 3.98, 1.07],
];
// throwing hand (his right); the keys from .93 to 1.3 are relative to the release point
const P_HAND_R = [
  [0, -0.6, 3.95, 0.88],
  [0.14, -0.6, 4.07, 0.58],
  [0.38, -0.62, 4.4, 0.33],
  [0.46, -0.58, 4.28, 0.5],
  [0.54, -0.62, 3.78, 0.75],
  [0.61, -0.6, 3.72, 0.7],
  [0.67, -0.55, 4.3, 0.75],
  [0.72, -0.45, 5.1, 1.0],
  [0.79, -1.15, 5.15, 1.55],
  [0.86, -1.7, 4.85, 2.35],
  [0.93, 0.32, 0.5, -1.55],
  [1.0, 0, 0, 0],
  [1.12, 1.25, -0.95, 0.35],
  [1.3, 2.4, -2.45, -0.55],
  [1.45, 1.2, -1.6, -0.15],
  [1.62, -0.95, 3.55, 5.95],
  [1.85, -1.2, 3.25, 5.3],
  [2.15, -1.15, 3.1, 3.5],
  [2.35, -0.95, 3.15, 2.3],
  [2.55, -0.7, 3.5, 1.35],
  [2.75, -0.62, 3.88, 0.95],
  [2.9, -0.6, 3.95, 0.88],
];
// elbow pole directions (torso space: +x his left, -z behind him) and knee directions (hip space: +z the way the hips face)
const P_POLE_R = [
  [0, -0.5, -1, -0.4], [0.46, -0.5, -1, -0.4], [0.6, -0.4, -0.3, -1], [0.72, -1, -0.25, -0.1], [0.86, -1, -0.4, 0.3],
  [1.0, -1, -0.4, 0.1], [1.2, -0.6, -0.8, 0.3], [1.62, -0.6, -0.8, -0.3], [2.9, -0.5, -1, -0.4],
];
const P_POLE_L = [
  [0, 0.5, -1, -0.4], [0.46, 0.5, -1, -0.4], [0.6, 0.9, -0.4, 0.2], [0.72, 0.9, 0.2, 0.4], [0.9, 0.8, -0.6, 0.1],
  [1.2, 0.7, -1, -0.2], [1.62, 0.6, -1, -0.3], [2.9, 0.5, -1, -0.4],
];
const P_KNEE_L = [[0, 0.1, 0, 1], [0.38, 0.05, 0.5, 1], [0.72, 0.1, 0.1, 1], [2.9, 0.1, 0, 1]];
const P_KNEE_R = [[0, -0.1, 0, 1], [0.6, -0.1, 0, 1], [0.84, 0.1, -0.4, 1], [1.3, 0, 0.2, 1], [1.62, -0.1, 0, 1], [2.9, -0.1, 0, 1]];

const _pb = [], _pf = [];
// u: 0..1 over the windup up to the release; post: seconds after it; release: the hand at release (person space);
// tell = { slot: -1..1 (arm height), lag: 0..1 (a slower arm) }; dur = the windup's length in seconds
export function pitcherPose(P, u, post, release, tell = { slot: 0, lag: 0 }, dur = 1.15) {
  resetPose(P);
  const slot = tell.slot || 0;
  const lag = tell.lag || 0;
  // (after the follow-through - from the fielding stance - the walk back keeps an unhurried pace even after a quick windup)
  const d = Math.max(0.5, dur), tUp = (PITCH.stance - 1) * d;
  const p = Math.min(PITCH.set, post <= 0 ? clamp(u, 0, 1) : post <= tUp ? 1 + post / d : PITCH.stance + (post - tUp) / Math.max(d, PITCH.walkDur));
  // (a changeup's arm trails the body a touch through the delivery and catches up at the release)
  const pa = p - lag * PITCH.lag * Math.sin(Math.PI * clamp((p - 0.45) / 0.55, 0, 1));

  const b = sampleKeys(P_BODY, p, _pb);
  P.hipY = b[0] + slot * PITCH.slotTall * smoothstep(0.7, 0.95, p) * (1 - smoothstep(1.1, 1.4, p));
  P.pelvisYaw = b[1]; P.torsoYaw = b[2]; P.torsoPitch = b[3]; P.pelvisPitch = b[4];
  P.torsoRoll = b[5] * (1 + slot * PITCH.slotRoll);
  set3(P.pelvis, b[6], 0, b[7]);
  // eyes on the catcher the whole way: the head turns back against the body and lifts against the trunk's bend
  P.headYaw = clamp(-(P.pelvisYaw + P.torsoYaw), -1.55, 1.55);
  P.headPitch = 0.05 - P.torsoPitch * 0.75 - P.pelvisPitch * 0.5;

  const fl = sampleKeys(P_FOOT_L, p, _pf);
  set3(P.footL, fl[0], fl[1], fl[2]); P.footLYaw = fl[3]; P.footLTilt = fl[4];
  const fr = sampleKeys(P_FOOT_R, p, _pf);
  set3(P.footR, fr[0], fr[1], fr[2]); P.footRYaw = fr[3]; P.footRTilt = fr[4];

  setVec(P, 'handL', P_HAND_L, p);
  // the throwing hand: absolute keys, except around the release where they are offsets from the release point (so every arm slot
  // whips through its own release on the same arc)
  // (and a higher arm slot cocks the hand a little higher at foot strike: a tell)
  const keysR = P_HAND_R.map((k) => (k[0] >= 0.93 && k[0] <= 1.45 ? [k[0], release[0] + k[1], release[1] + k[2], release[2] + k[3]]
    : k[0] === 0.72 ? [k[0], k[1], k[2] + slot * PITCH.slotCock, k[3]] : k));
  setVec(P, 'handR', keysR, pa);

  setVec(P, 'poleR', P_POLE_R, pa);
  setVec(P, 'poleL', P_POLE_L, p);
  setVec(P, 'kneeL', P_KNEE_L, p);
  setVec(P, 'kneeR', P_KNEE_R, p);
  P.gloveOpen = 0.35;
  return P;
}

// The ball sits between his hands (in the glove) until the hands break; then it goes with the throwing hand.
export const PITCHER_BALL_TO_HAND = PITCH.ballToHand;
// Seconds after the release until he is set on the rubber again, for a windup of `dur` seconds.
export function pitcherSetAfter(dur = 1.15) {
  const d = Math.max(0.5, dur);
  return (PITCH.stance - 1) * d + (PITCH.set - PITCH.stance) * Math.max(d, PITCH.walkDur);
}

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
    // an infielder's ready position: down low with the knees well bent, back fairly flat, glove out in front open and low with
    // the throwing hand beside it (not arms hanging)
    P.hipY = 2.42 + b; P.torsoPitch = 0.42; P.pelvisPitch = 0.3;
    set3(P.handL, 0.42, 1.75, 1.45); set3(P.handR, -0.3, 1.85, 1.3);
    set3(P.footL, 0.95, ANK, 0.15); set3(P.footR, -0.95, ANK, -0.1);
  }
  P.headPitch = kind === 'OF' ? 0.1 : -0.15; // (eyes up on the hitter, not on the dirt)
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
