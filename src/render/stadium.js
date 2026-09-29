// Builds the whole ballpark: field, chalk, wall, stands, dugouts, light towers, scoreboard, crowd.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { BASE_XZ, fenceDistance, polar } from '../physics/field.js';
import { buildPerimeter, ribbonGeometry, groundStripGeometry } from './perimeter.js';
import { grassTexture, dirtTexture, infieldTexture, wallTexture, seatTexture, softDotTexture, makeCanvas, toTexture } from './textures.js';
import { createScoreboard } from './scoreboard.js';
import { createCrowd } from './crowd.js';

const F = CONFIG.field;

const STRIPE_GLSL = /* glsl */ `
varying vec3 vWPos;
float aaStripe(float x, float width) {
  float f = fract(x);
  float tri = abs(f - 0.5) * 2.0; // 0..1..0 triangle wave
  float aa = fwidth(x) * 2.0 + 1e-4;
  return smoothstep(0.5 - aa, 0.5 + aa, tri);
}
float grassPattern(vec3 p) {
  float band = aaStripe(p.x / 26.0, 0.5);
  vec2 r = vec2(p.x + p.z, p.x - p.z) * 0.70710678 / 15.0;
  float chk = abs(aaStripe(r.x * 0.5, 0.5) - aaStripe(r.y * 0.5, 0.5));
  float infield = 1.0 - smoothstep(88.0, 98.0, length(vec2(p.x, p.z + 60.5)));
  float pat = mix(band, chk, infield);
  float blot = sin(p.x * 0.031 + 1.3) * sin(p.z * 0.027) * 0.035;
  return 1.0 + (pat - 0.5) * 0.30 + blot;
}`;

export function buildStadium({ isMobile = false, crowdCount = 6000 } = {}) {
  const root = new THREE.Group();
  root.name = 'stadium';
  const perimeter = buildPerimeter();
  const ofPts = perimeter.filter((p) => p.kind === 'of');
  const updaters = [];

  // ---------------------------------------------------------------- ground
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(512), roughness: 0.96, metalness: 0 });
  grassMat.map.repeat.set(2600 / 7, 2600 / 7);
  grassMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + STRIPE_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= grassPattern(vWPos);');
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -300);
  ground.receiveShadow = true;
  root.add(ground);

  // Infield dirt (painted, soft edged)
  const { texture: infieldTex, bounds } = infieldTexture('#a86f47');
  const infield = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0),
    new THREE.MeshStandardMaterial({ map: infieldTex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  );
  {
    const detail = dirtTexture('#c8c8c8', 256, 17);
    detail.repeat.set(1, 1);
    infield.material.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: detail };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uDetail;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 dt = texture2D(uDetail, vWPos.xz / 5.0).rgb + texture2D(uDetail, vWPos.xz / 1.7 + 0.37).rgb * 0.6; diffuseColor.rgb *= 0.35 + 0.62 * dt; }');
    };
  }
  infield.rotation.x = -Math.PI / 2;
  infield.position.set((bounds.x0 + bounds.x1) / 2, 0.012, (bounds.z0 + bounds.z1) / 2);
  infield.receiveShadow = true;
  infield.renderOrder = 1;
  root.add(infield);

  // Warning track + foul-territory dirt along the wall
  const trackTex = dirtTexture('#96603f', 512, 9);
  const trackMat = new THREE.MeshStandardMaterial({ map: trackTex, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const track = new THREE.Mesh(
    groundStripGeometry(perimeter, { inner: 0.3, outer: (p) => (p.kind === 'of' ? F.warningTrack : 11), y: 0.02, uPerFt: 1 / 12 }),
    trackMat
  );
  track.receiveShadow = true;
  root.add(track);

  // ---------------------------------------------------------------- field markings
  const chalk = new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const chalkGroup = new THREE.Group();
  root.add(chalkGroup);
  const line = (x0, z0, x1, z1, width, y = 0.032) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), chalk);
    m.rotation.x = -Math.PI / 2; // long axis along -z
    m.receiveShadow = true;
    g.add(m);
    g.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    // yaw so that -z points from p0 to p1
    g.rotation.y = Math.atan2(-(x1 - x0), -(z1 - z0));
    chalkGroup.add(g);
    return g;
  };
  const poleDist = fenceDistance(45);
  const pR = polar(45, poleDist), pL = polar(-45, poleDist);
  line(0, 0, pR.x, pR.z, 0.36);
  line(0, 0, pL.x, pL.z, 0.36);
  // batter's boxes
  const bx0 = 0.708 + 0.5, bx1 = bx0 + 4, bz0 = -0.708 - 3, bz1 = -0.708 + 3;
  for (const s of [-1, 1]) {
    line(s * bx0, bz0, s * bx1, bz0, 0.2); line(s * bx0, bz1, s * bx1, bz1, 0.2);
    line(s * bx0, bz0, s * bx0, bz1, 0.2); line(s * bx1, bz0, s * bx1, bz1, 0.2);
  }
  // catcher's box
  line(-1.4, 1.2, -1.4, 8.4, 0.2); line(1.4, 1.2, 1.4, 8.4, 0.2); line(-1.4, 8.4, 1.4, 8.4, 0.2);
  // running lane (3 ft wide, outer line only) on the first-base side
  {
    const s = 45 / Math.SQRT2, e = 90 / Math.SQRT2;
    const off = 3 * 0.7071;
    line(s + off, -s + off, e + off, -e + off, 0.2);
  }
  // coach's boxes
  for (const sgn of [-1, 1]) {
    const c = BASE_XZ[sgn === 1 ? 1 : 3];
    const ox = sgn * 14 * 0.7071, oz = 14 * 0.7071;
    // 10x10 box straddling the foul line 15 ft past the bag (simple square outline)
    const cx = c[0] + sgn * 7, cz = c[1] - 7; // toward the outfield along the foul line
    const w = 5;
    const ax = cx + sgn * 4, az = cz + 4;
    line(ax - w, az - w, ax + w, az - w, 0.16); line(ax - w, az + w, ax + w, az + w, 0.16);
    line(ax - w, az - w, ax - w, az + w, 0.16); line(ax + w, az - w, ax + w, az + w, 0.16);
    void ox; void oz;
  }
  // home plate
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.708, 1.417); shape.lineTo(0.708, 1.417); shape.lineTo(0.708, 0.708); shape.lineTo(0, 0); shape.lineTo(-0.708, 0.708); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xfafaf5, roughness: 0.8 }));
    m.position.set(0, 0.03, 0);
    m.receiveShadow = true; m.castShadow = false;
    root.add(m);
  }
  // bases
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const bases = [];
  for (let i = 1; i <= 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 1.25), baseMat);
    const dx = i === 1 ? -0.55 : i === 3 ? 0.55 : 0;
    const dz = i === 2 ? 0.55 : 0;
    b.position.set(BASE_XZ[i][0] + dx * 0.7, 0.14, BASE_XZ[i][1] + dz * 0.7);
    b.rotation.y = Math.PI / 4;
    b.castShadow = true; b.receiveShadow = true;
    root.add(b);
    bases.push(b);
  }
  // pitcher's mound
  {
    const pts = [];
    const R = 9, H = F.moundHeight;
    for (let i = 0; i <= 16; i++) {
      const r = (i / 16) * R;
      const t = Math.max(0, (r - 2.5) / (R - 2.5));
      pts.push(new THREE.Vector2(r, H * (1 - t * t * (3 - 2 * t))));
    }
    const g = new THREE.LatheGeometry(pts.reverse(), 40);
    const tex = dirtTexture('#a86f47', 256, 3);
    tex.repeat.set(3, 3);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide }));
    m.position.set(0, 0.012, -F.moundDistance + 1.5);
    m.receiveShadow = true;
    root.add(m);
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.18, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }));
    rubber.position.set(0, H + 0.03, -F.moundDistance);
    rubber.receiveShadow = true;
    root.add(rubber);
  }

  // ---------------------------------------------------------------- outfield wall
  let arc = 0;
  const ofLen = ofPts[ofPts.length - 1].s - ofPts[0].s;
  const markerAngles = [[-45, 'LF'], [-30, ''], [-15, ''], [0, 'CF'], [15, ''], [30, ''], [45, 'RF']];
  const markers = markerAngles.map(([a]) => {
    let best = ofPts[0];
    for (const p of ofPts) if (Math.abs(p.a - a) < Math.abs(best.a - a)) best = p;
    const inset = a === -45 ? 12 : a === 45 ? -12 : 0;
    return { s: best.s - ofPts[0].s + inset, text: String(Math.round(fenceDistance(a))) };
  });
  const wTex = wallTexture(ofLen, F.fenceHeight, markers);
  const wallOfPts = ofPts.map((p) => ({ ...p, s: p.s - ofPts[0].s }));
  const wall = new THREE.Mesh(
    ribbonGeometry(wallOfPts, { y0: 0, y1: F.fenceHeight, uPerFt: 1 / ofLen, vScale: 1 }),
    new THREE.MeshStandardMaterial({ map: wTex, roughness: 0.9, side: THREE.DoubleSide })
  );
  wall.receiveShadow = true;
  root.add(wall);
  void arc;

  // foul-territory / back walls (padded, plain)
  const foulPts = perimeter.filter((p) => p.kind !== 'of');
  const foulWallMat = new THREE.MeshStandardMaterial({ color: 0x14361f, roughness: 0.9, side: THREE.DoubleSide });
  const foulWall = new THREE.Mesh(ribbonGeometry(foulPts, { y0: 0, y1: (p) => p.h0, uPerFt: 0.05 }), foulWallMat);
  foulWall.receiveShadow = true;
  root.add(foulWall);
  // yellow cap on the wall
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf2cf1d, roughness: 0.6, emissive: 0x3a3000 });
  const cap = new THREE.Mesh(ribbonGeometry(perimeter, { y0: (p) => p.h0, y1: (p) => p.h0 + 0.5, uPerFt: 0.1, offset: 0.1 }), capMat);
  root.add(cap);

  // ---------------------------------------------------------------- stands
  const S = F.stands;
  const rd = 2.5;
  const rows = Math.floor(S.depth / rd);
  const rr = rd * S.slope;
  const seatTex = seatTexture();
  const standsMat = new THREE.MeshStandardMaterial({ map: seatTex, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  {
    const n = perimeter.length;
    const prof = [{ d: 0, h: 0, v: 0, row: 0 }];
    for (let i = 0; i < rows; i++) {
      prof.push({ d: (i + 1) * rd, h: i * rr, v: i + 0.4, row: i });
      prof.push({ d: (i + 1) * rd, h: (i + 1) * rr, v: i + 1, row: i + 1 });
    }
    const K = prof.length;
    const pos = new Float32Array(n * K * 3);
    const uv = new Float32Array(n * K * 2);
    const col = new Float32Array(n * K * 3);
    const idx = [];
    const c = new THREE.Color();
    const seatColor = { of: '#2f5f9f', foul: '#3a6fb0', back: '#284a7c' };
    for (let i = 0; i < n; i++) {
      const p = perimeter[i];
      c.set(seatColor[p.kind]);
      for (let k = 0; k < K; k++) {
        const q = prof[k];
        const j = i * K + k;
        pos[j * 3] = p.x + p.nx * q.d;
        pos[j * 3 + 1] = p.h0 + q.h;
        pos[j * 3 + 2] = p.z + p.nz * q.d;
        uv[j * 2] = p.s / 15;
        uv[j * 2 + 1] = q.v;
        const shade = 1 - 0.38 * (q.row / rows);
        col[j * 3] = c.r * shade; col[j * 3 + 1] = c.g * shade; col[j * 3 + 2] = c.b * shade;
        if (i < n - 1 && k < K - 1) {
          const a = j, b = j + 1, cc = j + K, d = j + K + 1;
          idx.push(a, b, cc, b, d, cc);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const stands = new THREE.Mesh(g, standsMat);
    root.add(stands);

    // back facade + roof lip
    const facadeMat = new THREE.MeshStandardMaterial({ color: 0x272e3a, roughness: 0.9, side: THREE.DoubleSide });
    const facade = new THREE.Mesh(ribbonGeometry(perimeter, { offset: rows * rd + 0.3, y0: (p) => p.h0 + rows * rr, y1: (p) => p.h0 + rows * rr + 9, uPerFt: 0.05 }), facadeMat);
    root.add(facade);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1b212b, roughness: 0.9, side: THREE.DoubleSide });
    const roof = new THREE.Mesh(groundStripGeometry(perimeter.map((p) => ({ ...p, x: p.x + p.nx * (rows * rd + 0.3), z: p.z + p.nz * (rows * rd + 0.3) })), { inner: 0, outer: -18, y: 0, uPerFt: 0.05 }), roofMat);
    // (roof strip is positioned per-point in height below)
    const rp = roof.geometry.getAttribute('position');
    for (let i = 0; i < perimeter.length; i++) {
      const y = perimeter[i].h0 + rows * rr + 9;
      rp.setY(i * 2, y); rp.setY(i * 2 + 1, y);
    }
    rp.needsUpdate = true;
    root.add(roof);
  }

  // Batter's eye (dark backdrop behind center field so the ball is easy to see)
  {
    const eyePts = ofPts.filter((p) => Math.abs(p.a) <= 9).map((p) => ({ ...p, s: p.s - ofPts[0].s }));
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x07110c, roughness: 1, side: THREE.DoubleSide });
    const eye = new THREE.Mesh(ribbonGeometry(eyePts, { offset: 1.5, y0: 0, y1: 36, uPerFt: 0.1 }), eyeMat);
    root.add(eye);
    // trees/hedge texture strip on top
    const top = new THREE.Mesh(ribbonGeometry(eyePts, { offset: 1.5, y0: 33, y1: 37.5, uPerFt: 0.1 }), new THREE.MeshStandardMaterial({ color: 0x0f2a16, roughness: 1, side: THREE.DoubleSide }));
    root.add(top);
    // side wings
    for (const s of [-1, 1]) {
      const e = ofPts.reduce((b, p) => (Math.abs(p.a - s * 9) < Math.abs(b.a - s * 9) ? p : b), ofPts[0]);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(3, 36, 3), eyeMat);
      wing.position.set(e.x + e.nx * 3, 18, e.z + e.nz * 3);
      root.add(wing);
    }
  }

  // ---------------------------------------------------------------- foul poles
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xf2cf1d, roughness: 0.5, emissive: 0x2a2400 });
  for (const s of [-1, 1]) {
    const P = polar(45 * s, fenceDistance(45));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, F.foulPoleHeight, 10), poleMat);
    pole.position.set(P.x, F.foulPoleHeight / 2, P.z);
    pole.castShadow = true;
    root.add(pole);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 14), new THREE.MeshStandardMaterial({ color: 0xf2cf1d, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    mesh.position.set(P.x - s * 1.1 * 0.7, F.foulPoleHeight - 7, P.z - 1.1 * 0.7 * -1 * 0);
    mesh.rotation.y = Math.PI / 4 * -s;
    root.add(mesh);
  }

  // ---------------------------------------------------------------- dugouts
  {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5b6779, roughness: 0.7, metalness: 0.2 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x7c8797, roughness: 0.9 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 1 });
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const L = 44, D = 12, Hh = 7.2;
      const back = new THREE.Mesh(new THREE.BoxGeometry(L, Hh, 0.6), darkMat); back.position.set(0, Hh / 2, -D / 2); g.add(back);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.4, D), wallMat); floor.position.set(0, 0.2, 0); g.add(floor);
      const roofB = new THREE.Mesh(new THREE.BoxGeometry(L + 1.5, 0.7, D + 2.5), roofMat); roofB.position.set(0, Hh + 0.3, 0.6); roofB.castShadow = true; g.add(roofB);
      for (const e of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(0.6, Hh, D), wallMat); sw.position.set(e * (L / 2), Hh / 2, 0); g.add(sw); }
      const bench = new THREE.Mesh(new THREE.BoxGeometry(L - 4, 0.6, 1.4), benchMat); bench.position.set(0, 1.5, -D / 2 + 1.6); g.add(bench);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.35, 0.35), new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.4, metalness: 0.5 })); rail.position.set(0, 3.9, D / 2 - 0.4); g.add(rail);
      const front = new THREE.Mesh(new THREE.BoxGeometry(L, 3.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x24406e, roughness: 0.85 })); front.position.set(0, 1.6, D / 2 - 0.25); g.add(front);
      // Sit along the foul line, on the outside of it, facing the field.
      const dir = new THREE.Vector3(side * 0.7071, 0, -0.7071);
      const out = new THREE.Vector3(side * 0.7071, 0, 0.7071);
      const p = dir.clone().multiplyScalar(74).addScaledVector(out, 22);
      g.position.set(p.x, 0, p.z);
      // local +z of the group should face the field: field direction = -out
      g.rotation.y = Math.atan2(-out.x, -out.z);
      g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
      root.add(g);
    }
  }

  // ---------------------------------------------------------------- backstop net
  {
    const { canvas, ctx } = makeCanvas(256, 256);
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(20,24,30,0.9)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 256; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
    const tex = toTexture(canvas, { wrap: true, anisotropy: 4 });
    const backPts = perimeter.filter((p) => p.z > 55);
    const geo = ribbonGeometry(backPts, { offset: -3, y0: 0, y1: 28, uPerFt: 0.1, vScale: 3 });
    const net = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: true }));
    root.add(net);
  }

  // ---------------------------------------------------------------- light towers
  const towerGlow = softDotTexture(128, 0, '255,244,220');
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x2b2f36, toneMapped: false });
  const glowMats = [];
  const towerSpots = [polar(-53, 420), polar(53, 420), { x: -205, z: 30 }, { x: 205, z: 30 }];
  for (const tp of towerSpots) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.0, 150, 8), new THREE.MeshStandardMaterial({ color: 0x8a919b, roughness: 0.6, metalness: 0.6 }));
    pole.position.y = 75; g.add(pole);
    const bank = new THREE.Group();
    bank.position.y = 150;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(46, 26, 2), new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.7, metalness: 0.5 }));
    bank.add(frame);
    const lampGeo = new THREE.PlaneGeometry(4.2, 3.6);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
      const l = new THREE.Mesh(lampGeo, lampMat);
      l.position.set(-19.5 + c * 5.6, -9.5 + r * 4.8, 1.1);
      bank.add(l);
    }
    const gm = new THREE.SpriteMaterial({ map: towerGlow, color: 0xfff1d6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    glowMats.push(gm);
    const glow = new THREE.Sprite(gm);
    glow.scale.set(150, 110, 1);
    glow.position.set(0, 0, 4);
    bank.add(glow);
    g.add(bank);
    g.position.set(tp.x, 0, tp.z);
    // face the field center
    bank.rotation.y = Math.atan2(-tp.x, -(tp.z + 90)) + Math.PI;
    root.add(g);
  }

  // ---------------------------------------------------------------- scoreboard
  const scoreboard = createScoreboard();
  {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(78, 35), scoreboard.material);
    const bz = -(fenceDistance(0) + 30);
    board.position.set(0, 52, bz);
    root.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(81, 38, 2.5), new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.7 }));
    frame.position.set(0, 52, bz - 1.7);
    root.add(frame);
    for (const x of [-30, 30]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 26, 3), new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.8 }));
      leg.position.set(x, 32, bz - 2);
      root.add(leg);
    }
  }

  // ---------------------------------------------------------------- crowd
  const crowd = createCrowd(perimeter, { count: crowdCount });
  root.add(crowd.mesh);

  return {
    root,
    perimeter,
    scoreboard,
    crowd,
    bases,
    // Called every frame. env supplies brightness/lamp levels.
    update(dt, time, env) {
      const lamps = env ? env.lamps : 0;
      lampMat.color.setRGB(0.17 + lamps * 2.2, 0.18 + lamps * 2.1, 0.21 + lamps * 1.8);
      for (const m of glowMats) m.opacity = lamps * 0.75;
      crowd.update(dt, time, env ? env.crowdBrightness : 1, env ? env.glass : 0);
      scoreboard.update(dt);
      scoreboard.setBrightness(env && env.lamps > 0.5 ? 1 : 0.9);
    },
  };
}
