// What you see while you pitch (picture only - the engine decides everything): the target dot you aim, the ring that shrinks onto
// the dot (tap when it meets it) and the grade word that pops up after the tap. Everything lies in the plane over the front of the plate (like the bat in batAim.js), drawn over the field.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../util/math.js';

const SEG = 72; // segments round the timing ring
const GRADES = ['perfect', 'good', 'ok', 'wild'];

const flat = (o) => ({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, ...o });

export class PitchAim {
  constructor(scene) {
    const A = CONFIG.pitchAim;
    this.A = A;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.position.z = CONFIG.pitch.contactZ + 0.03;
    scene.add(this.group);
    this.fade = 0;
    this.disposables = [];
    const own = (x) => { this.disposables.push(x); return x; };

    // the dot: a soft disc, a bright rim and a dark outline so it reads on grass, dirt and a white uniform
    this.dotMat = own(new THREE.MeshBasicMaterial(flat({ color: A.dotColor, opacity: A.dotOpacity })));
    this.dot = new THREE.Mesh(own(new THREE.CircleGeometry(1, 32)), this.dotMat);
    this.dot.scale.setScalar(A.dot * 0.8);
    this.dot.renderOrder = 30;
    this.rimMat = own(new THREE.MeshBasicMaterial(flat({ color: A.ringColor, opacity: 0.95 })));
    this.rim = new THREE.Mesh(own(new THREE.RingGeometry(0.82, 1, 32)), this.rimMat);
    this.rim.scale.setScalar(A.dot);
    this.rim.renderOrder = 31;
    this.outMat = own(new THREE.MeshBasicMaterial(flat({ color: A.rimColor, opacity: 0.6 })));
    this.out = new THREE.Mesh(own(new THREE.RingGeometry(1, 1.3, 32)), this.outMat);
    this.out.scale.setScalar(A.dot);
    this.out.renderOrder = 29;
    this.group.add(this.out, this.dot, this.rim);

    // the timing ring: its radius changes every frame, so its vertices are rewritten (constant width, not width that grows with it)
    this.ringGeo = own(new THREE.BufferGeometry());
    const pos = new Float32Array((SEG + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.ringGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ringGeo.setIndex(idx);
    this.ringMat = own(new THREE.MeshBasicMaterial(flat({ color: A.ringColor, opacity: A.ringOpacity })));
    this.ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 32;
    this.group.add(this.ring);
    this.ring.visible = false;

    // the grade word: a flat label, turned to face the pitcher's camera (it looks toward the plate from the pitcher's side)
    this.labels = {};
    const [fw, fh] = A.flashSize;
    this.flashGroup = new THREE.Group();
    this.flashGroup.visible = false;
    this.flashGroup.rotation.y = Math.PI;
    this.flashGroup.position.z = CONFIG.pitch.contactZ + 0.05;
    scene.add(this.flashGroup);
    for (const g of GRADES) {
      const tex = own(new THREE.CanvasTexture(document.createElement('canvas')));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = own(new THREE.MeshBasicMaterial(flat({ map: tex, opacity: 1 })));
      const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(fw, fh)), mat);
      mesh.renderOrder = 40;
      mesh.visible = false;
      this.flashGroup.add(mesh);
      this.labels[g] = { tex, mat, mesh };
      this.draw(g);
    }
    // (the display font may still be loading when the first words are drawn: draw them again once it is)
    try { if (document.fonts && document.fonts.load) document.fonts.load('64px "Lilita One"').then(() => GRADES.forEach((g) => this.draw(g))).catch(() => {}); } catch (e) { /* no font loading */ }
    this.flashT = -1; this.flashGrade = null; this.flashAim = { x: 0, y: 2.5 };
    this.last = { x: 0, y: CONFIG.timing.zoneCenterY };
  }

  draw(grade) {
    const A = this.A, L = this.labels[grade], c = L.tex.image;
    c.width = 512; c.height = Math.round(512 * A.flashSize[1] / A.flashSize[0]);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    let px = Math.round(c.height * 0.82);
    g.font = `${px}px "Lilita One", "Arial Black", sans-serif`;
    const wide = g.measureText(grade.toUpperCase()).width; // (shrink to fit, with room for the outline)
    if (wide > c.width * 0.9) { px = Math.floor(px * c.width * 0.9 / wide); g.font = `${px}px "Lilita One", "Arial Black", sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = c.height * 0.16; g.strokeStyle = '#3a2008';
    g.strokeText(grade.toUpperCase(), c.width / 2, c.height * 0.54);
    g.fillStyle = A.colors[grade];
    g.fillText(grade.toUpperCase(), c.width / 2, c.height * 0.54);
    L.tex.needsUpdate = true;
  }

  /** Pop the grade word up over where the pitch was aimed. */
  flash(grade, aim) {
    if (!this.labels[grade]) return;
    this.flashT = 0; this.flashGrade = grade;
    if (aim) this.flashAim = { x: aim.x, y: aim.y };
  }

  setRing(radius, width) {
    const p = this.ringGeo.attributes.position, r1 = Math.max(0, radius), r0 = Math.max(0, radius - width);
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      p.setXYZ(i * 2, c * r0, s * r0, 0);
      p.setXYZ(i * 2 + 1, c * r1, s * r1, 0);
    }
    p.needsUpdate = true;
  }

  /**
   * @param {object} e   the engine (pitching): phase, pitchAim, pitchType, ring, mound, time, pitchStuff
   * @param {number} dt  real seconds since the last frame
   * @param {boolean} [show=true] the aiming picture is wanted (not paused, a menu up, simming ...)
   */
  update(e, dt, show = true) {
    const A = this.A;
    const live = !!(show && e && e.pitching && (e.phase === 'aim' || e.phase === 'delivery'));
    this.fade = clamp(this.fade + (live ? dt : -dt) / A.fade, 0, 1);
    this.group.visible = this.fade > 0.01;
    if (this.group.visible && e && e.mound) {
      const ring = e.phase === 'delivery' ? e.ring : null;
      const aim = ring ? ring.aim : e.pitchAim;
      this.last.x = aim.x; this.last.y = aim.y;
      this.group.position.x = aim.x; this.group.position.y = aim.y;
      const f = this.fade;
      this.dotMat.opacity = A.dotOpacity * f; this.rimMat.opacity = 0.95 * f; this.outMat.opacity = 0.6 * f;
      // the ring: radius = dot at the moment to tap, 0 when the ring has closed
      if (ring) {
        const t = clamp(e.time - ring.tStart, 0, ring.time);
        const tr = ring.tapped ? clamp(ring.hitAt + ring.errMs / 1000, 0, ring.time) : t; // (a tap freezes it where it was)
        const radius = A.dot * (ring.time - tr) / (ring.time - ring.hitAt);
        this.setRing(radius, A.ringWidth);
        this.ring.visible = true;
        const W = CONFIG.pitching.ring;
        const near = Math.abs(tr - ring.hitAt) * 1000 <= W.perfect;
        this.ringMat.color.setHex(near ? A.ringPerfect : A.ringColor);
        this.ringMat.opacity = A.ringOpacity * f;
      } else this.ring.visible = false;
    }
    // the grade word floats up and fades
    if (this.flashT >= 0) {
      this.flashT += dt;
      const u = this.flashT / A.flashTime;
      if (u >= 1) { this.flashT = -1; this.flashGroup.visible = false; this.labels[this.flashGrade].mesh.visible = false; } else {
        const L = this.labels[this.flashGrade];
        const pop = 1 + 0.35 * Math.max(0, 1 - u * 6); // a quick pop
        L.mesh.visible = true; this.flashGroup.visible = true;
        L.mat.opacity = clamp((1 - u) * 2.2, 0, 1);
        L.mesh.scale.setScalar(pop);
        this.flashGroup.position.set(this.flashAim.x, this.flashAim.y + 0.75 + A.flashRise * (1 - (1 - u) * (1 - u)), CONFIG.pitch.contactZ + 0.05);
      }
    }
  }

  hide() {
    this.fade = 0; this.group.visible = false; this.flashT = -1; this.flashGroup.visible = false;
    for (const g of GRADES) this.labels[g].mesh.visible = false;
  }

  dispose() {
    this.group.removeFromParent(); this.flashGroup.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
