// Broadcast-style camera: behind the batter during the pitch, follows the ball after contact,
// then smoothly snaps back for the next pitch. Also handles screen shake and narrow screens.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { damp, clamp, lerp, smoothstep, DEG } from '../util/math.js';
import { pitchHitView, playView, playAim, homerView } from './cameraViews.js';
import { sampleBall } from '../game/fielding.js';
import { samplePath } from '../game/fielderMotion.js';
import { BASE_XZ } from '../physics/field.js';

const FIELD_CAM = new THREE.Vector3(0, 44, 58);
const _look = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    const c = CONFIG.camera.batter;
    this.basePos = new THREE.Vector3(...c.pos);
    this.pos = this.basePos.clone();
    this.look = this.pos.clone().add(new THREE.Vector3(0, Math.sin(c.pitch * DEG), -Math.cos(c.pitch * DEG)).multiplyScalar(60));
    this.fov = c.fov;
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.mode = 'batter';
    this.aspect = 16 / 9;
    this.interest = new THREE.Vector3(0, 3, -60);
    this.title = false;
    this.titleT = 0;
    this.override = null; // { pos:[x,y,z], look:[x,y,z], fov } - used by automated screenshots
    this.batting = false; // the batting (catcher's) view: set by the app while you are up
    this.catcherDist = Infinity;
    this.pitching = false; // the pitcher's view: set by the app while you pitch
    this.pitcherHand = 'R';
  }

  shake(amount) { this.shakeAmt = Math.min(1.6, Math.max(this.shakeAmt, amount)); }

  snapToBatter() {
    const c = CONFIG.camera.batter;
    this.pos.copy(this.basePos);
    this.look.copy(this.pos).add(new THREE.Vector3(0, Math.sin(c.pitch * DEG), -Math.cos(c.pitch * DEG)).multiplyScalar(60));
    this.fov = c.fov;
  }

  batterLook(out) {
    const c = CONFIG.camera.batter;
    return out.copy(this.basePos).add(_dir.set(0, Math.sin(c.pitch * DEG), -Math.cos(c.pitch * DEG)).multiplyScalar(60));
  }

  // Minimum vertical FOV so that a narrow (portrait) screen still shows enough width.
  minVFov(aspect, minH = CONFIG.camera.minHorizontalFov) {
    const h = minH * DEG;
    return (2 * Math.atan(Math.tan(h / 2) / aspect)) / DEG;
  }

  // Where the camera films the play from while you pitch - chosen ONCE per play, so it never jumps: behind where the play happens
  // (the catch or the pickup, or where a home run leaves the park), framing home, the bases, the fielder's run and the ball's whole
  // flight up to then (cameraViews.playView). null for a foul nobody catches (the pitching view just widens to watch it).
  playCam(play) {
    if (this.camPlay === play) return this.camSpot;
    this.camPlay = play;
    this.camSpot = null;
    const plan = play.plan, sim = play.sim;
    if (plan.groundRule || plan.homer || !plan.fair && !plan.caught) return null;
    const spot = plan.catchPos ? { x: plan.catchPos.x, z: plan.catchPos.z } : plan.pickupPos ? { x: plan.pickupPos.x, z: plan.pickupPos.z } : null;
    if (!spot) return null;
    const tEnd = plan.caught ? plan.catchT : plan.pickupT;
    const pts = [[0, 0, 0]];
    const q = {};
    for (let t = 0; t <= tEnd; t += 0.25) {
      const b = sampleBall(sim, t, q);
      pts.push([b.x, Math.max(0.5, b.y), b.z]);
    }
    const runs = plan.fielder && plan.paths[plan.fielder];
    if (runs) for (let t = 0; t <= tEnd; t += 0.5) { const p = samplePath(runs, t); pts.push([p.x, 3, p.z]); }
    const extra = [1, 2, 3].map((b) => [BASE_XZ[b][0], 0, BASE_XZ[b][1]]);
    this.camSpot = { spot, pos: playView(spot, pts, CONFIG, extra).pos };
    return this.camSpot;
  }

  update(dt, E, actors, aspect) {
    this.aspect = aspect;
    const cam = this.camera;
    if (this.override) {
      const o = this.override;
      const tgt = o.follow ? actors.ballPos : null;
      cam.position.set(...o.pos);
      if (tgt) cam.lookAt(tgt.x, tgt.y, tgt.z); else cam.lookAt(...o.look);
      cam.fov = o.fov || 40;
      cam.updateProjectionMatrix();
      const Cp = CONFIG.camera.catcher.pos;
      this.catcherDist = Math.hypot(o.pos[0] - Cp[0], o.pos[1] - Cp[1], o.pos[2] - Cp[2]);
      return;
    }
    const cfg = CONFIG.camera;
    let tPos = this.basePos;
    let tFov = cfg.batter.fov;
    let posL = 4, lookL = 8, fovL = 4;
    let minH = cfg.minHorizontalFov;
    this.followK = 1;
    const look = this.batterLook(_look).clone();

    const phase = E ? E.phase : 'title';
    this.keepBallOn = false;
    if (this.batting && E && !this.title) {
      // batting: the catcher's view (it eases in from wherever the camera was - the broadcast view after Ready, or the field after a play)
      const C = cfg.catcher;
      tPos = _tmp.set(C.pos[0], C.pos[1], C.pos[2]).clone();
      look.set(C.look[0], C.look[1], C.look[2]);
      tFov = C.fov; posL = C.zoom; lookL = C.zoom * 1.4; fovL = C.zoom;
    } else if (this.pitching && E && E.play && !this.title && (phase === 'play' || phase === 'result')) {
      // pitching, the computer has hit it - one camera that never cuts and never turns round: from the pitching view (behind the
      // mound, looking in) it glides back to film the play from behind where it happens, still looking in (cameraViews.playView):
      // the ball comes toward you, the fielder runs under it, and home, the bases and the runners stay in the picture for the throw
      // and the tag. (A foul nobody catches: the pitching view just widens to watch it - cameraViews.pitchHitView.)
      const ball = actors.ballPos;
      const plan = E.play.plan;
      const t = E.time - E.play.t0;
      this.interest.set(ball.x, Math.max(1.5, ball.y), ball.z);
      const cs = plan.homer ? null : this.playCam(E.play);
      if (plan.homer) {
        const V = homerView(ball, t, this.pitcherHand, CONFIG);
        tPos = _tmp.set(V.pos[0], V.pos[1], V.pos[2]).clone();
        look.set(V.look[0], V.look[1], V.look[2]);
        tFov = V.fov; posL = 3; lookL = 4; fovL = 3;
      } else if (cs) {
        // (the spot is fixed for the play; the aim and the width follow what is happening now: home and the ball always, the fielder
        // with it, the other bases when they fit)
        const pts = [[0, 0, 0], [cs.spot.x, 3, cs.spot.z]], extra = [1, 2, 3].map((b) => [BASE_XZ[b][0], 0, BASE_XZ[b][1]]);
        const runs = plan.fielder && plan.paths[plan.fielder];
        if (runs) { const q = samplePath(runs, t); pts.push([q.x, 3, q.z]); }
        pts.push([ball.x, Math.max(0.5, ball.y), ball.z]);
        const V = playAim(cs.pos, pts, CONFIG, extra);
        tPos = _tmp.set(cs.pos[0], cs.pos[1], cs.pos[2]).clone();
        look.set(V.look[0], V.look[1], V.look[2]);
        const PV = cfg.playView;
        tFov = V.fov; posL = PV.ease; lookL = PV.ease * 1.3; fovL = PV.ease;
      } else {
        const V = pitchHitView(ball, t, plan, this.pitcherHand, CONFIG);
        tPos = _tmp.set(V.pos[0], V.pos[1], V.pos[2]).clone();
        look.set(V.look[0], V.look[1], V.look[2]);
        tFov = V.fov; posL = 3; lookL = 5; fovL = 3.5;
      }
      // a ball high in the air never leaves the picture (same rule as the batting views) - except a home run on its way out
      this.keepBallOn = ball.y > 12 && !plan.homer && t < plan.ballHitEnd; // (a home run: homerView lets it go on purpose)
      if (this.keepBallOn) {
        const K = cfg.keepBall;
        _a.subVectors(ball, this.pos); _b.subVectors(look, this.pos);
        const off = _a.angleTo(_b) / DEG + K.marginDeg;
        if (2 * off > tFov) tFov = Math.min(K.maxFov, 2 * off);
        const over = off - K.maxFov / 2;
        if (over > 0) look.lerp(_c.copy(ball), clamp(over / Math.max(1, off), 0, 1));
      }
    } else if (this.pitching && E && !this.title) {
      // pitching: behind and above the throwing shoulder (mirrored for a left-hander)
      const P = cfg.pitcher, m = this.pitcherHand === 'L' ? -1 : 1;
      tPos = _tmp.set(P.pos[0] * m, P.pos[1], P.pos[2]).clone();
      look.set(P.look[0], P.look[1], P.look[2]);
      tFov = P.fov; posL = P.ease; lookL = P.ease * 1.4; fovL = P.ease;
      minH = P.minHorizontalFov; // (the long lens: a narrow screen still shows the zone and the batter, not the whole infield)
    } else if (this.title) {
      // slow orbit around the ballpark for the title screen
      this.titleT += dt;
      const a = this.titleT * 0.09;
      const r = 62;
      tPos = _tmp.set(Math.sin(a) * r * 0.55 + 6, 15 + Math.sin(a * 1.3) * 2, 26 + Math.cos(a) * 14).clone();
      look.set(Math.sin(a * 0.7) * 28, 8, -95);
      tFov = 38; posL = 1.5; lookL = 2; fovL = 2;
    } else if (E && phase === 'windup' && E.pitch) {
      const u = clamp((E.time - E.pitch.tWindup) / E.pitch.windupDur, 0, 1);
      tFov = cfg.batter.fov * (1 - 0.05 * smoothstep(0.3, 1, u));
    } else if (E && phase === 'play' && E.play) {
      const play = E.play;
      const plan = play.plan;
      const t = E.time - play.t0;
      const ball = actors.ballPos;
      const deep = plan.homer || plan.caught || plan.ballLandDistance > 170 || (plan.pickupPos && Math.hypot(plan.pickupPos.x, plan.pickupPos.z) > 170);
      const homerAfter = plan.homer && t > plan.ballHitEnd;
      // for a beat after contact the camera stays on the batter, then eases into following the ball
      const followK = smoothstep(0.1, 0.5, t);
      // interest point: the ball (which is carried by fielders / thrown once the hit is over)
      this.followK = followK;
      this.interest.set(ball.x, Math.max(1.5, ball.y), ball.z);
      look.copy(this.interest);
      // While the ball is way up, aim between the ball and where it will come down so the fielders stay in frame.
      const sim = play.sim;
      const land = sim.firstBounce || sim.wallHit || sim.homerun;
      if (land && t < (sim.firstBounce ? sim.firstBounce.t : sim.duration) && ball.y > 12 && !plan.homer) {
        const remain = Math.max(0, (sim.firstBounce ? sim.firstBounce.t : land.t) - t);
        const k = clamp(remain / 2.4, 0, 1) * 0.5;
        look.x = lerp(ball.x, land.x, k); look.z = lerp(ball.z, land.z, k); look.y = lerp(ball.y, 4, k * 1.3);
      } else if (plan.homer && t < plan.ballHitEnd && ball.y > 25) {
        look.y = Math.max(8, ball.y * 0.75);
      }
      if (homerAfter) {
        // ball is in the seats: look up at the crowd / fireworks
        look.set(this.interest.x * 0.9, this.interest.y + 18, this.interest.z * 0.9);
      }
      const dist = Math.hypot(ball.x - this.pos.x, ball.y - this.pos.y, ball.z - this.pos.z);
      if (deep) {
        // stay behind the plate and pan; zoom in as the ball recedes, out when it is over
        tPos = this.basePos;
        // ...rising to a broadcast "high home" camera, so a ball in the air is seen against the grass it will land on (and the
        // landing ring, lying flat on that grass, is not a sliver seen edge-on)
        const rise = smoothstep(0.3, 1.8, t);
        const H = CONFIG.camera.highHome;
        tPos = _tmp.copy(this.basePos).add(new THREE.Vector3(0, H.up * rise, H.back * rise));
        tFov = lerp(34, 20, smoothstep(70, 380, dist));
        if (t > plan.ballHitEnd || homerAfter) tFov = homerAfter ? 44 : 34;
        posL = 1.6; lookL = 6.5; fovL = 3;
      } else {
        const w = smoothstep(0.1, 0.9, t);
        tPos = _tmp.copy(this.basePos).lerp(FIELD_CAM, w);
        tFov = lerp(34, 46, w);
        posL = 2.4; lookL = 7; fovL = 3;
      }
      // a ball high in the air never leaves the picture: the view widens until it fits, and past the widest it tilts up to it
      this.keepBallOn = ball.y > 12 && !homerAfter && t < plan.ballHitEnd;
      if (this.keepBallOn) {
        const K = cfg.keepBall;
        _a.subVectors(ball, this.pos); _b.subVectors(look, this.pos);
        const off = _a.angleTo(_b) / DEG + K.marginDeg; // degrees from the middle of the picture
        if (2 * off > tFov) tFov = Math.min(K.maxFov, 2 * off);
        const over = off - K.maxFov / 2;
        if (over > 0) look.lerp(_c.copy(ball), clamp(over / Math.max(1, off), 0, 1));
      }
    } else if (E && (phase === 'result') && E.play && E.play.plan.homer) {
      look.set(this.interest.x * 0.9, this.interest.y + 18, this.interest.z * 0.9);
      tPos = _tmp.copy(this.basePos).add(new THREE.Vector3(0, 6, 4));
      tFov = 44; posL = 1.5; lookL = 3; fovL = 2;
    } else if (E && phase === 'result' && E.play) {
      // linger briefly on the action, then head back
      const since = E.time - E.phaseSince;
      if (since < 0.32) {
        look.copy(this.interest);
        tPos = this.pos.clone();
        posL = 8; lookL = 6; fovL = 6;
        tFov = this.fov;
      } else { posL = 5.5; lookL = 9; fovL = 6; }
    } else if (E && (phase === 'ready' || phase === 'result' || phase === 'windup')) {
      posL = 6; lookL = 9; fovL = 6;
    }

    if (this.followK !== undefined && E && E.phase === 'play' && this.followK < 1) {
      const bl = this.batterLook(new THREE.Vector3());
      look.lerp(bl, 1 - this.followK);
    }
    this.pos.set(damp(this.pos.x, tPos.x, posL, dt), damp(this.pos.y, tPos.y, posL, dt), damp(this.pos.z, tPos.z, posL, dt));
    this.look.set(damp(this.look.x, look.x, lookL, dt), damp(this.look.y, look.y, lookL, dt), damp(this.look.z, look.z, lookL, dt));
    this.fov = damp(this.fov, tFov, fovL, dt);
    // (the eased view can lag a ball that shoots straight up: it widens at once rather than lose it)
    if (this.keepBallOn) {
      const ball = actors.ballPos, K = cfg.keepBall;
      _a.subVectors(ball, this.pos); _b.subVectors(this.look, this.pos);
      const off = _a.angleTo(_b) / DEG + K.marginDeg;
      if (2 * off > this.fov) this.fov = Math.min(K.maxFov, 2 * off);
      const over = off - K.maxFov / 2;
      if (over > 0) this.look.lerp(ball, clamp(over / Math.max(1, off), 0, 1));
    }

    // shake
    this.shakeT += dt * 60;
    this.shakeAmt *= Math.exp(-7.5 * dt);
    if (this.shakeAmt < 0.002) this.shakeAmt = 0;
    const s = this.shakeAmt;
    cam.position.copy(this.pos);
    if (s > 0) {
      cam.position.x += (Math.sin(this.shakeT * 1.7) + Math.sin(this.shakeT * 3.1)) * 0.11 * s;
      cam.position.y += (Math.sin(this.shakeT * 2.3) + Math.cos(this.shakeT * 3.7)) * 0.1 * s;
    }
    cam.lookAt(this.look);
    const Cp = cfg.catcher.pos;
    this.catcherDist = Math.hypot(this.pos.x - Cp[0], this.pos.y - Cp[1], this.pos.z - Cp[2]); // (the actors hide the catcher when we are in his eyes)
    if (s > 0) cam.rotateZ(Math.sin(this.shakeT * 2.9) * 0.008 * s);
    // (the narrowest view a narrow screen may have eases between the pitching view's and everyone else's, so nothing jumps)
    this.minH = this.minH === undefined ? minH : damp(this.minH, minH, fovL, dt);
    cam.fov = Math.max(this.fov, this.minVFov(aspect, this.minH));
    cam.updateProjectionMatrix();
  }
}
