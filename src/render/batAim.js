// The see-through bat you aim with. Its sweet spot sits exactly where the bat is aimed (engine.batAim, in the plane over the front of
// the plate); the knob points back toward the batter and the barrel dips a little for a low pitch, the way a real bat comes through
// the zone. A faint outline around the sweet spot shows the bat's contact window: the ball's centre has to be inside it to be hit
// (a little above the sweet spot - the bat under the ball - is where fly balls and home runs come from).
// When he swings it freezes where it was and fades, and a ring marks where the ball was, so every swing shows what happened.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../util/math.js';

const SWEET = 2.3; // ft from the knob to the sweet spot (see rig.js makeBat: the barrel is widest from 2.3 to 2.6)

export class BatAim {
  constructor(scene) {
    const B = CONFIG.batAim;
    this.group = new THREE.Group();
    this.group.renderOrder = 20;
    this.group.visible = false;
    scene.add(this.group);
    // the bat: the real bat's shape, white and see-through, drawn over everything (it is the cursor)
    const pts = [
      [0.0, 0.0], [0.09, 0.0], [0.085, 0.03], [0.055, 0.12], [0.045, 0.6], [0.05, 0.9], [0.075, 1.5],
      [0.105, 1.95], [0.118, 2.3], [0.118, 2.6], [0.1, 2.72], [0.0, 2.75],
    ].map(([r, y]) => new THREE.Vector2(r, y - SWEET));
    this.batMat = new THREE.MeshBasicMaterial({ color: B.color, transparent: true, opacity: B.opacity, depthTest: false, depthWrite: false });
    this.bat = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), this.batMat);
    this.bat.renderOrder = 20;
    // a darker outline behind it so it reads against a bright sky or a white uniform
    this.edgeMat = new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: B.opacity * 0.55, depthTest: false, depthWrite: false, side: THREE.BackSide });
    const edge = new THREE.Mesh(this.bat.geometry, this.edgeMat);
    edge.scale.set(1.28, 1.01, 1.28);
    edge.renderOrder = 19;
    this.batRot = new THREE.Group();
    this.batRot.add(edge, this.bat);
    this.group.add(this.batRot);
    // the sweet spot: a small ring (a ball's size) on the barrel
    this.spotMat = new THREE.MeshBasicMaterial({ color: B.spotColor, transparent: true, opacity: B.spotOpacity, depthTest: false, depthWrite: false });
    const R = CONFIG.physics.ballRadius;
    this.spot = new THREE.Mesh(new THREE.RingGeometry(R * 0.72, R, 28), this.spotMat);
    this.spot.renderOrder = 22;
    this.group.add(this.spot);
    // the contact window: a faint rounded outline around the sweet spot (resized for the batter / level each pitch)
    this.winMat = new THREE.LineBasicMaterial({ color: B.color, transparent: true, opacity: B.windowOpacity, depthTest: false, depthWrite: false });
    this.win = new THREE.LineLoop(new THREE.BufferGeometry(), this.winMat);
    this.win.renderOrder = 21;
    this.group.add(this.win);
    // where the ball was when the bat came through (after a swing)
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this.mark = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R * 1.35, 28), this.markMat);
    this.mark.renderOrder = 23;
    scene.add(this.mark);
    this.winKey = '';
    this.fade = 1; // 1 = shown
    this.frozen = null; // { x, y, t } while showing a swing
  }

  // the outline of the contact window, in the bat's own frame (x across the plate toward the end of the bat, y up)
  setWindow(win) {
    const key = [win.up, win.tip, win.handle].map((v) => v.toFixed(3)).join('|');
    if (key === this.winKey) return;
    this.winKey = key;
    const pts = [];
    const n = 10, r = Math.min(win.up, 0.18);
    const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0)); } };
    const L = -win.handle, Rr = win.tip, T = win.up, Bt = -win.up;
    corner(Rr - r, T - r, 0); corner(L + r, T - r, Math.PI / 2); corner(L + r, Bt + r, Math.PI); corner(Rr - r, Bt + r, Math.PI * 1.5);
    this.win.geometry.dispose();
    this.win.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  /**
   * @param {object} o
   * @param {boolean} o.show       batting: the bat is up
   * @param {{x,y}} o.aim          where the sweet spot is (ft)
   * @param {'R'|'L'} o.hand
   * @param {object} o.window      the contact window (ft)
   * @param {object|null} o.swing  the engine's swing ({ aim, ball, tPress, tHit }) - freezes and fades the bat, marks the ball
   * @param {number} o.time        engine time
   * @param {number} dt            real seconds since the last frame
   */
  update(o, dt) {
    const B = CONFIG.batAim;
    const z = CONFIG.pitch.contactZ;
    let target = o.show ? 1 : 0;
    let aim = o.aim;
    const sw = o.swing;
    if (sw && o.show) {
      // a swing: the bat stays where it was swung, and fades as the real bat comes through
      aim = sw.aim;
      const since = o.time - sw.tPress;
      target = since < 0 ? 1 : clamp(1 - (since - B.holdAfterSwing) / B.fadeAfterSwing, 0, 1);
      // ...and a ring shows where the ball was when the bat got there
      const ms = o.time - sw.tHit;
      this.mark.visible = ms >= 0 && ms < B.markTime;
      if (this.mark.visible) {
        this.mark.position.set(sw.ball.x, sw.ball.y, z + 0.02);
        this.markMat.opacity = 0.9 * clamp(1 - ms / B.markTime, 0, 1);
        this.markMat.color.set(sw.made ? B.markHit : B.markMiss);
      }
    } else this.mark.visible = false;
    // a quick fade in / out (never a pop)
    this.fade += clamp(target - this.fade, -dt / B.fadeTime, dt / B.fadeTime);
    this.group.visible = this.fade > 0.01;
    if (!this.group.visible) return;
    this.batMat.opacity = B.opacity * this.fade;
    this.edgeMat.opacity = B.opacity * 0.55 * this.fade;
    this.spotMat.opacity = B.spotOpacity * this.fade;
    this.winMat.opacity = B.windowOpacity * this.fade;
    if (o.window) this.setWindow(o.window);
    // the bat lies across the plate: knob back toward the batter, the barrel dipping a little more the lower the pitch
    const side = o.hand === 'L' ? -1 : 1; // a right-hander's bat reaches across toward +x
    const dip = clamp(B.tilt + (B.tiltRefY - aim.y) * B.tiltPerFt, B.tiltRange[0], B.tiltRange[1]);
    this.group.position.set(aim.x, aim.y, z);
    // (the bat model's barrel points along +y: lay it down along +x - or -x for a lefty - then tip the barrel down by `dip`)
    this.batRot.rotation.set(0, 0, side > 0 ? -Math.PI / 2 - dip : Math.PI / 2 + dip);
    this.win.scale.set(side, 1, 1); // (the window: level, its long side toward the end of the bat)
    this.spot.position.set(0, 0, 0.01);
  }

  hide() { this.fade = 0; this.group.visible = false; this.mark.visible = false; }
}
