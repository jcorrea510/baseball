// Broadcast-style camera: behind the batter during the pitch, follows the ball after contact,
// then smoothly snaps back for the next pitch. Also handles screen shake and narrow screens.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { damp, clamp, lerp, smoothstep, DEG } from '../util/math.js';

const FIELD_CAM = new THREE.Vector3(0, 44, 58);
const _look = new THREE.Vector3();
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
  minVFov(aspect) {
    const h = CONFIG.camera.minHorizontalFov * DEG;
    return (2 * Math.atan(Math.tan(h / 2) / aspect)) / DEG;
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
    this.followK = 1;
    const look = this.batterLook(_look).clone();

    const phase = E ? E.phase : 'title';
    if (this.batting && E && !this.title) {
      // batting: the catcher's view (it eases in from wherever the camera was - the broadcast view after Ready, or the field after a play)
      const C = cfg.catcher;
      tPos = _tmp.set(C.pos[0], C.pos[1], C.pos[2]).clone();
      look.set(C.look[0], C.look[1], C.look[2]);
      tFov = C.fov; posL = C.zoom; lookL = C.zoom * 1.4; fovL = C.zoom;
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
    if (cfg && E && E.phase === 'aiSummary') { posL = 5; }

    if (this.followK !== undefined && E && E.phase === 'play' && this.followK < 1) {
      const bl = this.batterLook(new THREE.Vector3());
      look.lerp(bl, 1 - this.followK);
    }
    this.pos.set(damp(this.pos.x, tPos.x, posL, dt), damp(this.pos.y, tPos.y, posL, dt), damp(this.pos.z, tPos.z, posL, dt));
    this.look.set(damp(this.look.x, look.x, lookL, dt), damp(this.look.y, look.y, lookL, dt), damp(this.look.z, look.z, lookL, dt));
    this.fov = damp(this.fov, tFov, fovL, dt);

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
    cam.fov = Math.max(this.fov, this.minVFov(aspect));
    cam.updateProjectionMatrix();
  }
}
