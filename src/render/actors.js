// Actors: every visible person and the ball, driven each frame by the game engine's state.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Person, makeBat, restyleBat, mixPose, makePose, copyPose } from './rig.js';
import { batterPose, pitcherPose, catcherPose, fielderReady, runPose, runReachPose, runCadence, runnerLeadPose, throwPose, catchPose, divePose, celebratePose, standingPose, umpirePose, THROW_RELEASE_U } from './poses.js';
import { UNIFORMS } from '../game/teams.js';
import { BASE_XZ, MOUND_XZ } from '../physics/field.js';
import { sampleBall } from '../physics/ballistics.js';
import { runnerPosition, pathPoint, POSITIONS, fielderFreeTime } from '../game/fielding.js';
import { Mover, samplePath, turnToward } from '../game/fielderMotion.js';
import { clamp, lerp, smoothstep, damp, wrapAngle, TAU, DEG } from '../util/math.js';

const P0 = CONFIG.field;
const V = () => new THREE.Vector3();
const BOX_X = 2.9; // batter's box x offset
const BOX_Z = -0.7;

function moundY(x, z) {
  const R = 9, H = P0.moundHeight;
  const cz = -P0.moundDistance + 1.5;
  const r = Math.hypot(x, z - cz);
  const t = Math.max(0, (r - 2.5) / (R - 2.5));
  return t >= 1 ? 0 : H * (1 - t * t * (3 - 2 * t)) + 0.012;
}

export class Actors {
  constructor(scene, ball, effects) {
    this.scene = scene;
    this.ball = ball;
    this.fx = effects;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.fielders = {};
    this.players = new Map();
    this.coaches = [];
    this.tmpV = V(); this.tmpV2 = V(); this.tmpV3 = V();
    this.cfgKey = '';
    this.detailScale = 1; // set below 1 on phones (fewer polygons per figure)
    this.ballPos = V();
    this.looseBat = null;
    this.batStyle = 'ash';
    this.lastPhase = '';
    this.state = new WeakMap(); // per-person animation state
    this.blendPose = makePose();
    this.prevPose = makePose();
    this.tmpPose = makePose();
    this.celebrate = 0;
    this.playerUniform = UNIFORMS.classic;
    this.defenseUniform = null;
    this.handMarker = { pitchHand: V() };
    this.ballKind = 'hidden';
    this.trailPts = [];
    this.pitcherHandPos = V();
  }

  // ---------------------------------------------------------------- setup
  configure({ engine, playerUniformKey = 'classic', batStyle = 'ash' }) {
    const key = [engine.opponent.id, engine.pitcher.hand, engine.seed, playerUniformKey, batStyle].join('|');
    this.batStyle = batStyle;
    if (key === this.cfgKey) return;
    this.cfgKey = key;
    // dispose old
    for (const p of Object.values(this.fielders)) this.group.remove(p.root);
    for (const p of this.players.values()) this.group.remove(p.root);
    for (const c of this.coaches) this.group.remove(c.root);
    if (this.umpire) this.group.remove(this.umpire.root);
    this.fielders = {}; this.players.clear(); this.coaches = [];
    if (this.looseBat) { this.group.remove(this.looseBat); this.looseBat = null; }

    const opp = engine.opponent.uniform;
    this.playerUniform = UNIFORMS[playerUniformKey] || UNIFORMS.classic;
    this.defenseUniform = opp;
    const skins = ['#f2c9a0', '#e0ac82', '#c68642', '#a3683b', '#7b4a2a', '#f7d7b5', '#5d3a22', '#d9a066'];
    const opts = (pos, i) => ({
      role: pos === 'P' ? 'pitcher' : pos === 'C' ? 'catcher' : 'fielder',
      uniform: { ...opp, number: pos === 'P' ? engine.pitcher.number : 10 + i * 4 },
      glove: true, detail: (pos === 'P' || pos === 'C' ? 1 : 0.62) * this.detailScale, skin: pos === 'P' ? engine.pitcher.skin : skins[(i * 3 + 1) % skins.length],
      scale: pos === 'P' ? engine.pitcher.scale : 0.97 + ((i * 7) % 6) * 0.012,
      build: 0.97 + ((i * 5) % 5) * 0.02,
      mirror: pos === 'P' ? engine.pitcher.hand === 'L' : false,
      helmet: false,
    });
    POSITIONS.forEach((pos, i) => {
      const person = new Person(opts(pos, i));
      person.pos = pos;
      this.fielders[pos] = person;
      this.group.add(person.root);
      this.state.set(person, { phase: Math.random() * TAU, x: 0, z: 0, yaw: 0, init: false });
    });
    // plate umpire (dark uniform), crouched behind the catcher
    this.umpire = new Person({ role: 'umpire', detail: this.detailScale, uniform: { primary: '#22262e', secondary: '#c9d1dc', trim: '#c9d1dc', pants: '#5c6473', cap: '#171a20', capBill: '#171a20', socks: '#171a20', gear: '#1a1d24', text: '', number: 23 }, skin: '#e0ac82', scale: 1.02 });
    this.umpire.place(1.95, 0, 6.6, Math.PI);
    this.umpire.root.updateMatrixWorld(true);
    this.group.add(this.umpire.root);
    this.umpCall = { t: -10, kind: 'strike' };
    // batters / runners (player's team)
    for (const b of engine.lineup) this.getPlayer(b, engine);
    // base coaches
    for (const [i, base] of [[1, 1], [3, 3]]) {
      const c = new Person({ role: 'runner', detail: 0.62 * this.detailScale, uniform: { ...this.playerUniform, number: 60 + i }, helmet: true, skin: skins[i], scale: 1 });
      const bx = BASE_XZ[base][0], bz = BASE_XZ[base][1];
      const side = base === 1 ? 1 : -1;
      c.place(bx + side * 9, 0, bz - 9, Math.atan2(-side, 0.6));
      c.coach = true;
      this.coaches.push(c);
      this.group.add(c.root);
    }
    const lb = makeBat(batStyle);
    lb.visible = false;
    this.looseBat = lb;
    this.group.add(lb);
    this.loose = { active: false, pos: V(), vel: V(), rot: V(), t: 0 };
  }

  getPlayer(entry, engine) {
    const id = entry && entry.id !== undefined ? entry.id : 'ghost';
    let p = this.players.get(id);
    if (!p) {
      const ghost = !entry || entry.ghost;
      const u = { ...this.playerUniform, number: ghost ? 0 : entry.number };
      p = new Person({
        role: 'batter', detail: this.detailScale, uniform: u, helmet: true, skin: ghost ? '#d9a066' : entry.skin, scale: ghost ? 1 : entry.scale, build: ghost ? 1 : entry.build,
        mirror: !ghost && entry.hand === 'L', batStyle: this.batStyle,
      });
      p.entry = entry;
      p.root.visible = false;
      this.players.set(id, p);
      this.group.add(p.root);
      this.state.set(p, { phase: Math.random() * TAU, x: 0, z: 0, yaw: 0, init: false });
    }
    void engine;
    return p;
  }

  // The umpire punches out strikes.
  // The umpire signals a call (kind: strike | strikeSwing | strike3 | strike3Swing | ball | ball4 | foul | safe | out).
  strikeCall(time, kind = 'strike') { this.umpCall = { t: time, kind: kind === 'ball4' ? 'ball' : kind }; }

  setBatStyle(style) {
    this.batStyle = style;
    for (const p of this.players.values()) if (p.bat) restyleBat(p.bat, style);
    if (this.looseBat) restyleBat(this.looseBat, style);
  }

  // ---------------------------------------------------------------- per-frame
  update(E, dt, time) {
    const cfg = E.cfg;
    const phase = E.phase;
    const pitch = E.pitch;
    const play = E.play;
    const inPlay = phase === 'play' && play;
    const playT = inPlay ? time - play.t0 : -1;
    const plan = inPlay ? play.plan : null;

    // ---- hide everybody who is not needed, then show the ones that are
    for (const p of this.players.values()) p.active = false;

    // ---- pitcher & catcher & fielders
    this.updateFielders(E, dt, time, pitch, plan, playT);

    // ---- plate umpire
    if (this.umpire) {
      const since = this.umpCall.t > -5 ? time - this.umpCall.t : -1;
      umpirePose(this.umpire.pose, time, since, this.umpCall.kind);
      this.umpire.apply();
    }

    // ---- batter / runners
    this.updateOffense(E, dt, time, pitch, plan, playT);

    // ---- ball
    this.updateBall(E, dt, time, pitch, play, plan, playT);

    for (const p of this.players.values()) p.root.visible = !!p.active;
    this.lastPhase = phase;
  }

  // ------------------------------------------------ fielders (incl. pitcher & catcher)
  // Positions come from the play's planned runs (fielderMotion.js) while a fielder has a job, and from a steering Mover
  // (brakes on a curve, stops inside a small radius) for everything else - jogging back, repositioning. Facing turns at a
  // limited rate and only re-aims when it has a reason to, so nothing snaps or dithers.
  updateFielders(E, dt, time, pitch, plan, playT) {
    const phase = E.phase;
    const F = E.cfg.fielding;
    const turn = F.turnRate * DEG * dt;
    for (const pos of POSITIONS) {
      const person = this.fielders[pos];
      const def = E.defense[pos];
      const st = this.state.get(person);
      const runs = plan ? plan.paths[pos] : null;
      const move = plan ? plan.fielderMoves.find((m) => m.pos === pos) || null : null;
      const root = person.root;

      // ---- his spot (the pitcher and catcher also shift a little for every pitch; that is kept as a separate small offset)
      let fx = 0, fz = 0;
      if (pos === 'P') { fx = (E.pitcher.hand === 'R' ? -0.35 : 0.35) - def.homeX; fz = -P0.moundDistance - def.homeZ; }
      if (pos === 'C') {
        const tx = pitch ? pitch.target.x : 0;
        fx = clamp(tx * 0.5, -1.0, 1.0) * (phase === 'ready' ? 0 : 1) - def.homeX;
      }
      if (!st.init) {
        st.mover = new Mover(def.homeX, def.homeZ, { vmax: F.jogHome.speed, accel: F.jogHome.accel, brake: F.jogHome.brake, wake: 0.9 });
        st.cx = def.homeX; st.cz = def.homeZ; st.vx = 0; st.vz = 0; st.fx = fx; st.fz = fz; st.yaw = pos === 'C' ? Math.PI : 0; st.init = true; st.inPlay = false;
      }
      st.fx = damp(st.fx, fx, 7, dt); st.fz = damp(st.fz, fz, 7, dt);

      // a new play begins: every planned run starts from his spot, so a fielder still jogging back pops onto it
      const live = !!plan && playT >= 0;
      if (live && !st.inPlay && runs && Math.hypot(st.cx - def.homeX, st.cz - def.homeZ) > 0.3) {
        st.mover.reset(def.homeX, def.homeZ); st.cx = def.homeX; st.cz = def.homeZ; st.vx = st.vz = 0;
      }
      st.inPlay = live;

      let speed = 0, vx = 0, vz = 0, dive = null;
      if (live && runs && playT < fielderFreeTime(plan, pos)) {
        const p = samplePath(runs, playT);
        st.cx = p.x; st.cz = p.z; vx = p.ux * p.speed; vz = p.uz * p.speed; speed = p.speed;
        if (move && move.dive && (p.phase === 'air' || p.phase === 'slide' || p.phase === 'hold' || p.phase === 'getup')) dive = { phase: p.phase, u: p.u, ux: p.ux, uz: p.uz, catchU: move.run.dive.catchU };
        st.mover.reset(p.x, p.z, vx, vz); // keep the jog in step so the hand-off after his job is seamless
      } else {
        st.mover.setTarget(def.homeX, def.homeZ); // only re-aims if the spot moved meaningfully
        st.mover.update(dt);
        st.cx = st.mover.x; st.cz = st.mover.z; vx = st.mover.vx; vz = st.mover.vz; speed = st.mover.speed;
      }
      st.vx = vx; st.vz = vz;
      const x = st.cx + st.fx, z = st.cz + st.fz;
      const y = pos === 'P' ? moundY(x, z) : 0;
      const moving = speed > 0.5;

      // ---- facing
      const bx = this.ballPos.x, bz = this.ballPos.z;
      const ballD = Math.hypot(bx - x, bz - z);
      const catchT = plan && plan.fielder === pos ? (plan.caught ? plan.catchT : plan.pickupT) : undefined;
      let want = st.yaw, rate = turn;
      // the ball is in his hands: square up to wherever he is about to throw
      let face = null;
      if (plan) {
        const th = plan.throws.find((q) => q.from === pos && playT <= q.t0 + 0.4);
        const carry = plan.carries.some((c) => c.pos === pos && playT >= c.t0 - 0.3 && playT <= c.t1);
        if (th && ((carry && playT >= (catchT ?? 0) - 0.2) || playT >= th.t0 - 0.45)) face = th;
      }
      if (dive && dive.phase !== 'getup') { want = Math.atan2(dive.ux, dive.uz); rate = turn * 2.5; } // committed: he faces the way he is diving
      else if (pos === 'C' && !(moving && speed > 2)) want = Math.PI;
      else if (pos === 'P' && !runs && !(moving && speed > 2)) want = 0;
      else if (face) { want = Math.atan2(face.bx - x, face.bz - z); rate = turn * 1.3; }
      else if (moving && speed > 2) {
        want = Math.atan2(vx, vz);
        // on a fly ball he turns to face it for the last half second before the catch (keeps his eyes and glove on it)
        if (plan && plan.caught && catchT !== undefined && playT > catchT - 0.7 && ballD > 5) want = Math.atan2(bx - x, bz - z);
      } else if (plan && playT > 0.2 && ballD > 8) want = Math.atan2(bx - x, bz - z);
      else if (!plan || playT <= 0.2) want = Math.atan2(-x, -z); // watching the batter
      st.yaw = turnToward(st.yaw, want, rate, 12, dt);
      const yaw = st.yaw;
      // eyes on the ball while he runs (head turns, body keeps pointing where he is going)
      const lookYaw = plan && playT > 0.1 && ballD > 6 && !face ? clamp(wrapAngle(Math.atan2(bx - x, bz - z) - yaw), -1.1, 1.1) : 0;
      root.position.set(x, y, z);
      root.rotation.y = yaw;
      root.updateMatrixWorld(true);
      if (dive && dive.phase === 'slide' && this.fx && Math.random() < dt * 14) this.fx.slideDust(x - dive.ux * 2.4, z - dive.uz * 2.4, dive.ux, dive.uz);

      // ---- pose
      const P = person.pose;
      const time0 = time + person.root.id * 0.37;
      let done = false;
      if (pos === 'P') done = this.pitcherPoseUpdate(E, person, P, time, pitch, plan, playT, move, moving, speed, st, dt);
      else if (pos === 'C') done = this.catcherPoseUpdate(E, person, P, time, pitch, plan, playT, move, moving, speed, st, dt);
      if (!done) this.fielderPoseUpdate(E, person, P, time0, pos, plan, playT, move, speed, st, dt, lookYaw, dive);
      this.crossfadePose(person, P, done ? (pos === 'P' ? 'pitching' : 'catching-crouch') : person.animState, st, dt);
      person.setShadows(Math.hypot(x, z + 62) < 120);
      person.apply();
    }
  }

  pitcherPoseUpdate(E, person, P, time, pitch, plan, playT, move, moving, speed, st, dt) {
    if (move && playT >= 0 && (moving || playT > move.keys[1].t)) return false; // fielding the ball: generic fielder logic
    const phase = E.phase;
    const relW = this.tmpV;
    let u = 0, post = 0;
    if (pitch && (phase === 'windup')) u = clamp((time - pitch.tWindup) / pitch.windupDur, 0, 1);
    else if (pitch && (phase === 'pitch' || phase === 'result' || phase === 'play')) { u = 1; post = Math.max(0, time - pitch.tRelease); }
    else u = 0;
    // after the follow-through settles, return toward the ready pose
    const R = pitch ? pitch.flight.release : { x: -1.5, y: 5.8, z: -54.5 };
    relW.set(R.x, R.y, R.z);
    const rel = person.root.worldToLocal(relW.clone());
    const tell = pitch ? pitch.tell : { slot: 0, lag: 0 };
    if (phase === 'ready' && !plan) { u = 0; post = 0; }
    pitcherPose(P, u, post, [rel.x, rel.y - 0.0, rel.z], tell);
    // stay on the ground of the mound slope
    P.footL[1] += Math.max(-0.3, moundY(person.root.position.x + P.footL[0], person.root.position.z + P.footL[2]) - person.root.position.y);
    if (P.footL[1] > 0.3 + 0.1) { /* lifted foot: leave */ }
    P.footR[1] += Math.max(-0.3, moundY(person.root.position.x + P.footR[0], person.root.position.z + P.footR[2]) - person.root.position.y) * (P.footR[1] < 0.5 ? 1 : 0);
    // relax back toward ready after a moment
    if (post > 0.9) {
      const k = smoothstep(0.9, 1.5, post);
      const r = makePose();
      pitcherPose(r, 0, 0, [rel.x, rel.y, rel.z], tell);
      mixPose(P, P, r, k);
    }
    void moving; void speed; void st; void dt; void plan;
    return true;
  }

  catcherPoseUpdate(E, person, P, time, pitch, plan, playT, move, moving, speed, st, dt) {
    if (move && playT >= 0 && moving) return false;
    const cfg = E.cfg;
    let mx = 0, my = 2.4, mz = cfg.pitch.catchZ;
    if (pitch) {
      mx = pitch.target.x; my = Math.max(0.9, pitch.target.y);
      if (E.phase === 'pitch' || E.phase === 'result' || E.phase === 'play') {
        const pt = time - pitch.tRelease;
        if (pt > pitch.flight.tCatch && !E.swing?.made) {
          // catch: the glove is jolted back a touch then settles
          const k = clamp((pt - pitch.flight.tCatch) / 0.25, 0, 1);
          mz = cfg.pitch.catchZ + 0.25 * (1 - k) * 0 - 0.12 * Math.sin(k * Math.PI);
          my += 0.1 * Math.sin(k * Math.PI);
        }
      }
    }
    person.root.updateMatrixWorld(true);
    const local = person.root.worldToLocal(this.tmpV.set(mx, my, mz));
    catcherPose(P, time, [local.x, local.y, local.z]);
    void st; void dt; void speed; void plan; void playT; void moving; void move;
    return true;
  }

  // Chooses the pose (running / catching / throwing / diving / ready).
  fielderPoseUpdate(E, person, P, time, pos, plan, playT, move, speed, st, dt, look = 0, dive = null) {
    this.computeFielderPose(E, person, P, time, pos, plan, playT, move, speed, st, dt, look, dive);
  }

  // Whenever what a person is doing changes (pitching -> fielding, running -> catching, ...), cross-fade over ~0.16 s so a
  // pose can never pop, even for a very short stop between two runs.
  crossfadePose(person, P, label, st, dt) {
    if (!st.snap) { st.snap = makePose(); st.from = makePose(); st.lastAnim = label; st.blendT = 1; }
    if (label !== st.lastAnim) { st.lastAnim = label; st.blendT = 0; copyPose(st.from, st.snap); }
    st.blendT += dt;
    if (st.blendT < 0.16) mixPose(P, st.from, P, smoothstep(0, 0.16, st.blendT));
    copyPose(st.snap, P);
  }

  computeFielderPose(E, person, P, time, pos, plan, playT, move, speed, st, dt, look = 0, dive = null) {
    const kind = person.role === 'fielder' && (pos === 'LF' || pos === 'CF' || pos === 'RF') ? 'OF' : 'IF';
    const scratch = this.tmpPose;
    if (speed > 0.8) st.phase += runCadence(speed) * TAU * dt; // stride follows his real speed (continuous, no sliding feet)
    st.runOn = st.runOn ? speed > 1.6 : speed > 3.0; // hysteresis: no flicker between running and standing
    const runW = smoothstep(1.4, 4.2, speed); // how much running is mixed into a catch / throw pose
    // throws this fielder makes
    let throwing = null;
    if (plan) for (const th of plan.throws) if (th.from === pos) { if (playT >= th.t0 - 0.32 && playT <= th.t0 + 0.32) throwing = th; }
    // catch / field moments
    let catchT = null;
    if (plan && move && plan.fielder === pos) catchT = plan.caught ? plan.catchT : (plan.pickupT !== undefined ? plan.pickupT : null);
    if (dive) {
      // the glove reaches for the ball until it is caught, then stays where the catch happened and comes down with it
      if (dive.phase === 'air' && dive.u < dive.catchU) {
        person.root.updateMatrixWorld(true);
        const l = person.root.worldToLocal(this.tmpV2.copy(this.ballPos));
        st.diveGlove = [clamp(l.x, -1.2, 1.6), Math.max(0.55, Math.min(l.y, 5.2)), clamp(l.z, 0.6, 7)];
      }
      let from = null;
      if (dive.phase === 'air' && dive.u < 0.34) {
        const g = st.diveGlove || [0.5, 2.0, 3.0];
        runReachPose(scratch, st.phase, Math.max(speed, 6), g, 0);
        from = scratch;
      }
      divePose(P, dive.phase, dive.u, st.diveGlove || null, from, time, dive.catchU);
      if (throwing && dive.phase === 'getup') {
        // throws from his knees as he gets up
        const uT = clamp((playT - (throwing.t0 - 0.32)) / 0.32, 0, 1) * THROW_RELEASE_U + clamp((playT - throwing.t0) / 0.3, 0, 1) * (1 - THROW_RELEASE_U);
        const tp = this.tmpPose2 || (this.tmpPose2 = makePose());
        throwPose(tp, uT);
        mixPose(P, P, tp, smoothstep(0.1, 0.6, dive.u) * smoothstep(0, 0.5, uT + 0.2));
      }
      person.animState = 'dive';
      return;
    }
    if (throwing) {
      const uT = clamp((playT - (throwing.t0 - 0.32)) / 0.32, 0, 1) * THROW_RELEASE_U + clamp((playT - throwing.t0) / 0.3, 0, 1) * (1 - THROW_RELEASE_U);
      throwPose(P, uT);
      if (runW > 0.01) { runPose(scratch, st.phase, speed, 0); mixPose(P, P, scratch, runW); }
      person.animState = 'throw';
      return;
    }
    if (catchT !== null && playT >= 0) {
      const dtC = playT - catchT;
      // the catch pose ends when his throw begins (afterwards he is following through, not catching again)
      const nextThrow = plan.throws.find((q) => q.from === pos && q.t0 > catchT - 0.05);
      const catchEnd = nextThrow ? nextThrow.t0 - 0.32 - catchT : 1.2;
      if (dtC > -0.5 && dtC < Math.min(1.2, catchEnd)) {
        // glove up to meet the ball, then to the chest
        person.root.updateMatrixWorld(true);
        const b = this.ballPos;
        const local = person.root.worldToLocal(this.tmpV2.copy(b));
        let tx = local.x, ty = local.y, tz = local.z;
        const sh = 4.55;
        const lim = 2.0;
        const dx = tx - 0.74, dy = ty - sh, dz = tz;
        const dl = Math.hypot(dx, dy, dz);
        if (dl > lim) { const k = lim / dl; tx = 0.74 + dx * k; ty = sh + dy * k; tz = dz * k; }
        const settle = smoothstep(0, 0.5, dtC);
        tx = lerp(tx, 0.5, settle); ty = lerp(ty, 3.6, settle); tz = lerp(tz, 0.7, settle);
        catchPose(P, [tx, ty, tz], clamp(1 - ty / 4.2, 0, 1) * 0.9);
        if (runW > 0.01) {
          // a running catch: keep striding with the glove out, settle into the catch pose as he slows
          runReachPose(scratch, st.phase, speed, [tx, ty, tz], look);
          mixPose(P, P, scratch, runW);
        }
        person.animState = 'catch';
        return;
      }
    }
    if (st.runOn) {
      runPose(P, st.phase, speed, look);
      person.animState = 'run';
      return;
    }
    fielderReady(P, time, kind);
    person.animState = 'ready';
  }

  // ------------------------------------------------ batter and base runners
  updateOffense(E, dt, time, pitch, plan, playT) {
    const phase = E.phase;
    const cfg = E.cfg;
    const batter = E.batter;
    const game = E.game;
    const inPlay = !!plan;
    const swing = E.swing;

    // --- the batter at the plate
    const batterP = this.getPlayer(batter, E);
    const hand = batter.hand || 'R';
    const boxX = hand === 'R' ? -BOX_X : BOX_X;
    const stB = this.state.get(batterP);

    let batterRunning = false;
    let batterMove = null;
    if (inPlay) batterMove = plan.moves.find((m) => m.from === 0) || null;
    // For fair balls the batter always runs (even on outs) unless it is a foul ball.
    const runsOnPlay = inPlay && plan.result !== 'foul' && plan.result !== 'foulOut' && plan.result !== 'hitSimple';
    const tRunStart = cfg.runner.timeToFirst - cfg.field.baseDistance / cfg.runner.speed;
    const tRun = plan && plan.homer ? 1.0 : tRunStart;

    const quick = E.mode === 'quick';
    const paDone = quick && phase === 'result' && E.paEnded;
    const lastKind = paDone && E.lastPA ? E.lastPA.result : '';
    const isK = /strikeout/.test(lastKind);
    const isWalk = lastKind === 'walk';
    let showBatter = phase !== 'aiSummary' && phase !== 'idle' && phase !== 'gameOver';
    if (paDone) showBatter = isWalk || (isK && E.time - E.phaseSince < 0.55);
    batterP.active = showBatter;
    if (showBatter) {
      const yawBox = hand === 'R' ? Math.PI / 2 : -Math.PI / 2;
      if (isWalk) {
        this.batterWalk(E, batterP, stB, dt, boxX, yawBox);
      } else if (quick && runsOnPlay && playT >= tRun) {
        batterRunning = true;
        this.batterRun(E, batterP, stB, plan, batterMove, playT, dt, boxX, yawBox, hand, tRun);
      } else {
        // at the plate
        batterP.place(boxX, 0, BOX_Z, yawBox);
        batterP.root.updateMatrixWorld(true);
        this.batterAtPlate(E, batterP, time, swing, pitch, phase);
        stB.running = false;
        if (this.loose.active && (phase === 'ready' || phase === 'windup')) { this.loose.active = false; this.loose.spent = false; this.looseBat.visible = false; }
      }
      batterP.setShadows(true);
      batterP.apply();
    }

    // --- base runners
    if (game) {
      const onBase = game.bases;
      for (let b = 1; b <= 3; b++) {
        const r = onBase[b - 1];
        if (!r) continue;
        const rp = this.getPlayer(r, E);
        if (rp === batterP && batterP.active) continue; // (drawn as the batter this frame)
        rp.active = true;
        const st = this.state.get(rp);
        const mv = inPlay ? plan.moves.find((m) => m.from === b) : null;
        this.runnerUpdate(E, rp, st, b, mv, plan, playT, dt, time);
        rp.apply();
      }
    }

    // --- players who reached base on this play stay visible after it (result phase) as runners
    if (game && !inPlay && phase !== 'aiSummary') {
      // (covered by game.bases above: applyPlay places the batter on base)
    }
    for (const c of this.coaches) {
      const st = { };
      void st;
      standingPose(c.pose, time);
      c.apply();
    }
    void batterRunning;
  }

  batterAtPlate(E, person, time, swing, pitch, phase) {
    const P = person.pose;
    let sw = null;
    if (swing && (phase === 'pitch' || phase === 'play' || phase === 'result') && pitch) {
      // contact point in the batter's pose space
      const tt = clamp(swing.tHit - pitch.tRelease, 0, pitch.flight.tCatch);
      const bp = pitch.flight.at(swing.made ? tt : clamp(swing.tHit - pitch.tRelease, 0, pitch.flight.T));
      let c;
      if (swing.made) c = bp;
      else c = { x: pitch.target.x, y: pitch.target.y, z: E.cfg.pitch.contactZ };
      const local = person.root.worldToLocal(this.tmpV.set(c.x, c.y, c.z).clone());
      sw = { tStart: swing.tPress, tHit: swing.tHit, follow: swing.follow, contact: [local.x, local.y, local.z], early: clamp(-swing.errorMs / 60, -1, 1) };
      if (!swing.made) sw.early = clamp(-swing.errorMs / 100, -0.6, 0.6);
    }
    batterPose(P, time, sw);
    // ease back to the stance for the next pitch after the swing is over
    if (sw && (phase === 'result' || phase === 'ready')) {
      const doneT = sw.tHit + sw.follow;
      const k = smoothstep(doneT + 0.25, doneT + 0.7, time);
      if (k > 0) {
        const stance = makePose();
        batterPose(stance, time, null);
        mixPose(P, P, stance, k);
      }
    }
    // Derby / practice: after a home run the batter flips the bat and celebrates instead of running.
    const pl = E.play;
    if (E.mode !== 'quick' && pl && pl.plan.homer && (phase === 'play' || phase === 'result')) {
      const tt = time - pl.t0;
      if (tt > 0.7) {
        if (!this.loose.spent) this.spawnLooseBat(person, (E.batter.hand || 'R'), pl.plan);
        const c = makePose();
        celebratePose(c, time, 2);
        c.batVis = 0;
        mixPose(P, P, c, smoothstep(0.7, 1.3, tt) * (phase === 'result' ? 1 - smoothstep(0.1, 0.5, E.time - E.phaseSince) : 1));
        P.batVis = 0;
      }
    }
    if (person.bat) person.bat.visible = P.batVis > 0.5 && !(this.loose.active && this.loose.owner === person);
  }

  batterRun(E, person, st, plan, move, playT, dt, boxX, yawBox, hand, tRun) {
    const cfg = E.cfg;
    const R = cfg.runner;
    const trot = plan.homer;
    // ---- bat toss
    if (!this.loose.active && !this.loose.spent) {
      this.spawnLooseBat(person, hand, plan);
    }
    if (person.bat) person.bat.visible = false;
    // ---- path
    let x, z, dirx = 0, dirz = 0, speed = 0;
    const to = move ? (move.out && move.to === 0 ? move.outBase : move.to) : plan.homer ? 4 : 1;
    const elapsed = Math.max(0, playT - tRun);
    let sp = trot ? R.trotSpeed : R.speed;
    let d;
    if (!move && !trot) {
      // out on a fly ball etc.: run a few strides then ease up when the ball is caught
      const stopAt = (plan.catchT ?? plan.pickupT ?? 2.0) + 0.5;
      const e = Math.max(0, Math.min(playT, stopAt) - tRun);
      const slow = playT > stopAt ? Math.max(0, 1 - (playT - stopAt) * 1.6) : 1;
      d = Math.min(e * sp * 0.92, 60) ;
      sp = sp * slow;
      speed = slow > 0.02 ? sp : 0;
      d = Math.min(d, 55);
    } else {
      d = Math.min(elapsed * sp, to * cfg.field.baseDistance);
      const total = to * cfg.field.baseDistance;
      speed = d < total ? sp : 0;
    }
    const pp = pathPoint(0, d);
    // blend from the box to the base path
    const blend = smoothstep(0, 22, d);
    x = lerp(boxX, pp.x, blend); z = lerp(BOX_Z, pp.z, blend);
    dirx = pp.dir[0]; dirz = pp.dir[1];
    const yawRun = Math.atan2(dirx, dirz);
    st.yaw = speed > 1 ? yawRun : st.yaw || yawRun;
    const yawBlend = smoothstep(0, 10, d);
    const yaw = speed > 0.5 || d > 0 ? lerpAngle(yawBox, st.yaw, yawBlend) : yawBox;
    person.place(x, 0, z, yaw);
    person.root.updateMatrixWorld(true);
    if (speed > 1) {
      st.phase += runCadence(speed) * TAU * dt;
      runPose(person.pose, st.phase, speed);
    } else if (plan.homer && playT > 3) {
      celebratePose(person.pose, playT, 1);
    } else {
      standingPose(person.pose, playT);
    }
    // very first strides: still in the follow-through pose
    const early = smoothstep(tRun, tRun + 0.25, playT);
    if (early < 1 && d < 3) {
      const swingPose = makePose();
      const sw = E.swing;
      if (sw && E.pitch) this.batterFollowPose(E, person, swingPose, sw);
      mixPose(person.pose, swingPose, person.pose, early);
    }
    person.pose.batVis = 0;
    st.x = x; st.z = z; st.yaw = yaw; st.init = true;
    this.fx && speed > 8 && Math.random() < dt * 10 && this.fx.dustPuff(x, z, 0.3);
  }

  batterWalk(E, person, st, dt, boxX, yawBox) {
    // ball four: toss the bat aside and jog toward first
    const t = Math.max(0, E.time - E.phaseSince);
    if (t > 0.12 && !this.loose.spent) this.spawnLooseBat(person, (E.batter.hand || 'R'), null);
    if (person.bat) person.bat.visible = false;
    const d = Math.min(90, Math.max(0, t - 0.15) * 22);
    const pp = pathPoint(0, d);
    const blend = smoothstep(0, 16, d);
    const x = lerp(boxX, pp.x, blend), z = lerp(BOX_Z, pp.z, blend);
    const yaw = lerpAngle(yawBox, Math.atan2(pp.dir[0], pp.dir[1]), smoothstep(0, 8, d));
    person.place(x, 0, z, yaw);
    person.root.updateMatrixWorld(true);
    if (d > 0.5) { st.phase += runCadence(20) * TAU * dt; runPose(person.pose, st.phase, 20); }
    else standingPose(person.pose, t);
    person.pose.batVis = 0;
    st.x = x; st.z = z; st.yaw = yaw; st.init = true;
  }

  batterFollowPose(E, person, out, sw) {
    const pitch = E.pitch;
    const tt = clamp(sw.tHit - pitch.tRelease, 0, pitch.flight.tCatch);
    const bp = pitch.flight.at(tt);
    const local = person.root.worldToLocal(this.tmpV3.set(bp.x, bp.y, bp.z).clone());
    batterPose(out, sw.tHit + sw.follow, { tStart: sw.tPress, tHit: sw.tHit, follow: sw.follow, contact: [local.x, local.y, local.z], early: 0 });
    out.batVis = 0;
  }

  spawnLooseBat(person, hand, plan) {
    this.loose.spent = true;
    const bat = person.bat;
    if (!bat) return;
    bat.updateWorldMatrix(true, false);
    const lb = this.looseBat;
    lb.visible = true;
    bat.matrixWorld.decompose(lb.position, lb.quaternion, lb.scale);
    this.loose.active = true;
    this.loose.owner = person;
    this.loose.vel.set(hand === 'R' ? -3 : 3, 6, 4.5);
    this.loose.rot.set(rnd(-6, 6), rnd(-3, 3), rnd(-8, 8));
    this.loose.t = 0;
    this.loose.rest = false;
    void plan;
  }

  updateLooseBat(dt) {
    const L = this.loose;
    if (!L.active || L.rest) return;
    const lb = this.looseBat;
    L.vel.y -= 32 * dt;
    lb.position.addScaledVector(L.vel, dt);
    lb.rotateX(L.rot.x * dt); lb.rotateY(L.rot.y * dt); lb.rotateZ(L.rot.z * dt);
    if (lb.position.y < 0.15) {
      lb.position.y = 0.15;
      if (Math.abs(L.vel.y) > 3) { L.vel.y *= -0.35; L.vel.x *= 0.6; L.vel.z *= 0.6; L.rot.multiplyScalar(0.5); }
      else { L.rest = true; lb.rotation.set(Math.PI / 2, lb.rotation.y, lb.rotation.z); this.fx && this.fx.dustPuff(lb.position.x, lb.position.z, 0.3); }
    }
  }

  runnerUpdate(E, rp, st, base, move, plan, playT, dt, time) {
    const cfg = E.cfg;
    const R = cfg.runner;
    const baseXZ = BASE_XZ[base];
    // resting spot: a short lead toward the next base
    const nb = BASE_XZ[base === 3 ? 4 : base + 1];
    const ldx = nb[0] - baseXZ[0], ldz = nb[1] - baseXZ[1];
    const ll = Math.hypot(ldx, ldz);
    const lead = 5.5;
    const sideOff = base === 1 ? 1.2 : base === 3 ? -1.2 : 0;
    const leadX = baseXZ[0] + (ldx / ll) * lead + sideOff, leadZ = baseXZ[1] + (ldz / ll) * lead;
    const face = Math.atan2(MOUND_XZ[0] - leadX, MOUND_XZ[1] - leadZ);
    if (!st.init) { st.x = leadX; st.z = leadZ; st.yaw = face; st.init = true; }
    if (move && playT >= 0) {
      const t0 = move.tStart ?? R.startDelay;
      const to = move.out && move.to === 0 ? move.outBase : move.to;
      const total = Math.max(0, to - base) * cfg.field.baseDistance;
      const el = Math.max(0, playT - t0);
      const sp = plan.trot ? R.trotSpeed : R.speed;
      const d = Math.min(total, el * sp);
      const pp = pathPoint(base, d);
      const speed = d > 0 && d < total ? sp : 0;
      st.x = pp.x; st.z = pp.z;
      if (speed > 1) st.yaw = Math.atan2(pp.dir[0], pp.dir[1]);
      rp.place(st.x, 0, st.z, st.yaw);
      rp.root.updateMatrixWorld(true);
      if (speed > 1) { st.phase += runCadence(speed) * TAU * dt; runPose(rp.pose, st.phase, speed); }
      else if (d === 0) runnerLeadPose(rp.pose, time);
      else standingPose(rp.pose, time);
      rp.pose.batVis = 0;
      if (rp.bat) rp.bat.visible = false;
      st.running = speed > 0;
    } else {
      // relax to the lead-off spot (players who just arrived at base ease into it)
      st.x = damp(st.x, leadX, 5, dt); st.z = damp(st.z, leadZ, 5, dt);
      st.yaw = lerpAngle(st.yaw, face, Math.min(1, dt * 6));
      rp.place(st.x, 0, st.z, st.yaw);
      rp.root.updateMatrixWorld(true);
      runnerLeadPose(rp.pose, time);
      rp.pose.batVis = 0;
      if (rp.bat) rp.bat.visible = false;
    }
    rp.setShadows(true);
  }

  // ------------------------------------------------ ball
  updateBall(E, dt, time, pitch, play, plan, playT) {
    const ball = this.ball;
    const phase = E.phase;
    const cfg = E.cfg;
    let kind = 'hidden';
    const bp = this.ballPos;
    let spinRate = 0;
    let trail = 0;
    this.trailPts = null;

    const pitcherP = this.fielders.P;
    const catcherP = this.fielders.C;

    if (phase === 'ready' || phase === 'windup') {
      // in the pitcher's hands
      const u = pitch && phase === 'windup' ? clamp((time - pitch.tWindup) / pitch.windupDur, 0, 1) : 0;
      pitcherP.root.updateMatrixWorld(true);
      const rh = pitcherP.handWorld('R', this.tmpV);
      if (u < 0.5) {
        const lh = pitcherP.handWorld('L', this.tmpV2);
        bp.copy(rh).add(lh).multiplyScalar(0.5);
      } else bp.copy(rh);
      bp.y += 0.05;
      kind = 'hand';
    } else if (phase === 'pitch' || (phase === 'result' && pitch && !play)) {
      const pt = time - pitch.tRelease;
      const f = pitch.flight;
      if (pt < f.tCatch) {
        const q = f.at(pt);
        bp.set(q.x, q.y, q.z);
        kind = 'pitch';
        spinRate = pitch.flight.spin.rpm * 0.0105 * (pitch.type === 'changeup' ? 0.6 : 1);
        this.ballSpinAxis(pitch.flight.spin.axis);
      } else {
        catcherP.root.updateMatrixWorld(true);
        const g = catcherP.gloveWorld(this.tmpV);
        bp.copy(g); bp.y += 0.05;
        kind = 'glove';
      }
    } else if (phase === 'play' && play) {
      const r = this.ballInPlay(E, play, plan, playT, bp);
      kind = r.kind;
      trail = r.trail;
      if (r.pts) this.trailPts = r.pts;
      spinRate = r.spin || 0;
    } else if (phase === 'result' && play) {
      // after the play: hold the ball with whoever has it, otherwise where it stopped
      const r = this.ballInPlay(E, play, play.plan, Math.min(time - play.t0, play.plan.endTime + 5), bp);
      kind = r.kind;
    } else if (phase === 'result' && pitch) {
      catcherP.root.updateMatrixWorld(true);
      bp.copy(catcherP.gloveWorld(this.tmpV)); bp.y += 0.05;
      kind = 'glove';
    }
    // after a take the next windup places the ball in the pitcher's hands again
    ball.setVisible(kind !== 'hidden');
    ball.setScale(kind === 'pitch' ? cfg.pitch.ballScale : 1);
    ball.setPosition(bp.x, bp.y, bp.z);
    if (spinRate) ball.spin(this.spinAxis || new THREE.Vector3(1, 0, 0), spinRate, dt);
    ball.setTrail(trail);
    this.ballKind = kind;
    this.updateLooseBat(dt);
  }

  ballSpinAxis(a) {
    if (!this.spinAxis) this.spinAxis = new THREE.Vector3();
    this.spinAxis.set(a[0], a[1], a[2]);
  }

  ballInPlay(E, play, plan, t, out) {
    const cfg = E.cfg;
    const sim = play.sim;
    const ev = play.contact.exitVelocity;
    const trailOn = ev >= cfg.feel.trailMinExitVelocity ? 1 : ev >= cfg.feel.trailMinExitVelocity - 12 ? 0.5 : 0;
    // find the active ball segment
    const segs = plan.ballSegments || (plan.ballSegments = buildBallSegments(plan, sim));
    let seg = segs[0];
    for (const s of segs) if (t >= s.t0) seg = s;
    if (seg.kind === 'hit') {
      const q = sampleBall(sim, t);
      out.set(q.x, q.y, q.z);
      let pts = null;
      if (trailOn && t < 4.5) {
        pts = [];
        for (let i = 0; i < 30; i++) {
          const tt = Math.max(0, t - i * 0.011);
          const s2 = sampleBall(sim, tt);
          pts.push(new THREE.Vector3(s2.x, s2.y, s2.z));
        }
      }
      const spd = 0;
      void spd;
      return { kind: 'hit', trail: trailOn * (t < 3.6 ? 1 : Math.max(0, 1 - (t - 3.6))), pts, spin: 12 };
    }
    if (seg.kind === 'carry') {
      const person = this.fielders[seg.pos];
      person.root.updateMatrixWorld(true);
      person.gloveWorld(out);
      out.y = Math.max(out.y, person.animState === 'dive' ? 0.3 : 1.2);
      return { kind: 'carry', trail: 0 };
    }
    if (seg.kind === 'throw') {
      const th = seg.th;
      const u = clamp((t - th.t0) / Math.max(0.05, th.t1 - th.t0), 0, 1);
      const from = this.fielders[th.from], to = this.fielders[th.to];
      // start from the thrower's hand, end at the receiver's glove position (nominal height)
      const a = this.tmpV2, b = this.tmpV3;
      a.set(th.ax, 5.2, th.az);
      b.set(th.bx, th.toBase === 0 ? 4.4 : 3.2, th.bz);
      // if the thrower is still animating, start at his real hand
      if (from) { from.root.updateMatrixWorld(true); const h = from.handWorld('R', this.tmpV); a.lerp(h, 1 - smoothstep(0, 0.35, u)); }
      const dd = Math.hypot(th.bx - th.ax, th.bz - th.az);
      const arc = Math.min(14, 0.5 + dd * 0.055);
      out.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u) + 4 * arc * u * (1 - u), lerp(a.z, b.z, u));
      void to;
      return { kind: 'throw', trail: 0 };
    }
    return { kind: 'hidden', trail: 0 };
  }
}

// Ball timeline for a play: hit -> (carry -> throw -> carry ...) in chronological order.
export function buildBallSegments(plan, sim) {
  const segs = [];
  let hitEnd = Infinity;
  if (plan.homer) hitEnd = Infinity;
  else if (plan.caught) hitEnd = plan.catchT;
  else if (plan.pickupT !== undefined) hitEnd = plan.pickupT;
  segs.push({ kind: 'hit', t0: 0, t1: hitEnd });
  const items = [];
  for (const c of plan.carries) items.push({ kind: 'carry', pos: c.pos, t0: c.t0, t1: c.t1 });
  for (const th of plan.throws) items.push({ kind: 'throw', th, t0: th.t0, t1: th.t1 });
  items.sort((a, b) => a.t0 - b.t0 || (a.kind === 'throw' ? 1 : -1));
  // A carry that starts at the same time as a later throw ends when the throw begins.
  for (const it of items) segs.push(it);
  void sim;
  return segs;
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}
function rnd(a, b) { return a + Math.random() * (b - a); }
