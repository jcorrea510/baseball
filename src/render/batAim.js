// The see-through bat you aim with. Its sweet spot (the yellow ring) sits exactly where the bat is aimed (engine.batAim, in the plane
// over the front of the plate); the knob points back toward the batter and the barrel dips a little for a low pitch, the way a real
// bat comes through the zone. When he swings it freezes where it was swung and fades as the real bat comes through.
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
    this.spot.position.set(0, 0, 0.01);
    this.group.add(this.spot);
    this.fade = 1; // 1 = shown
  }

  /**
   * @param {object} o
   * @param {boolean} o.show       batting: the bat is up
   * @param {{x,y}} o.aim          where the sweet spot is (ft)
   * @param {'R'|'L'} o.hand
   * @param {boolean} o.bunt     squared around to bunt: the bat is held level
   * @param {object|null} o.swing  the engine's swing ({ aim, tPress }) - freezes and fades the bat
   * @param {number} o.time        engine time
   * @param {number} dt            real seconds since the last frame
   */
  update(o, dt) {
    const B = CONFIG.batAim;
    let target = o.show ? 1 : 0;
    let aim = o.aim;
    const sw = o.swing;
    if (sw && o.show) {
      // a swing: the bat stays where it was swung, and fades as the real bat comes through
      aim = sw.aim;
      const since = o.time - sw.tPress;
      target = since < 0 ? 1 : clamp(1 - (since - B.holdAfterSwing) / B.fadeAfterSwing, 0, 1);
    }
    // a quick fade in / out (never a pop)
    this.fade += clamp(target - this.fade, -dt / B.fadeTime, dt / B.fadeTime);
    this.group.visible = this.fade > 0.01;
    if (!this.group.visible) return;
    this.batMat.opacity = B.opacity * this.fade;
    this.edgeMat.opacity = B.opacity * 0.55 * this.fade;
    this.spotMat.opacity = B.spotOpacity * this.fade;
    // the bat lies across the plate: knob back toward the batter, the barrel dipping a little more the lower the pitch
    const side = o.hand === 'L' ? -1 : 1; // a right-hander's bat reaches across toward +x
    const dip = o.bunt ? B.buntTilt : clamp(B.tilt + (B.tiltRefY - aim.y) * B.tiltPerFt, B.tiltRange[0], B.tiltRange[1]);
    this.group.position.set(aim.x, aim.y, CONFIG.pitch.contactZ);
    // (the bat model's barrel points along +y: lay it down along +x - or -x for a lefty - then tip the barrel down by `dip`)
    this.batRot.rotation.set(0, 0, side > 0 ? -Math.PI / 2 - dip : Math.PI / 2 + dip);
  }

  hide() { this.fade = 0; this.group.visible = false; }
}
