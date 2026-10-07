// Builds the whole ballpark: field, chalk, wall, stands, dugouts, light towers, scoreboard, crowd.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { BASE_XZ, fenceDistance, polar, dugoutSpot, DUGOUT, currentPark } from '../physics/field.js';
import { MLB_TEAMS } from '../game/mlb.js';
import { buildPerimeter, ribbonGeometry, groundStripGeometry } from './perimeter.js';
import { grassTexture, dirtTexture, infieldTexture, wallTexture, seatTexture, softDotTexture, makeCanvas, toTexture } from './textures.js';
import { createScoreboard } from './scoreboard.js';
import { createCrowd } from './crowd.js';
import { buildParkLook, MOW } from './parkLook.js';
import { mergeStatic } from './mergeStatic.js';

const F = CONFIG.field;

const STRIPE_GLSL = /* glsl */ `
varying vec3 vWPos;
float aaStripe(float x, float width) {
  float f = fract(x);
  float tri = abs(f - 0.5) * 2.0; // 0..1..0 triangle wave
  float aa = fwidth(x) * 2.0 + 1e-4;
  return smoothstep(0.5 - aa, 0.5 + aa, tri);
}
uniform float uMow;
// a mowed stripe: -1 / +1 across the pattern (soft edged)
float mowS(float x) { return (aaStripe(x, 0.5) - 0.5) * 2.0; }
// Mowing: grass laid down away from you looks light, toward you dark, and the stripes fade when you look across them - so each pattern
// is stripes mowed along an axis and its brightness follows the view direction (vd: from the camera to this spot, on the ground).
float mowLight(float s, vec2 axis, vec2 vd) { return s * (0.3 + 0.7 * dot(vd, axis)); }
float grassPattern(vec3 p) {
  vec2 vd = normalize(p.xz - cameraPosition.xz + vec2(1e-3));
  const float D = 0.70710678;
  float of;
  if (uMow > 0.5 && uMow < 1.5) of = 0.5 * (mowLight(mowS(p.x / 30.0), vec2(0.0, 1.0), vd) + mowLight(mowS(p.z / 30.0), vec2(1.0, 0.0), vd)); // checkerboard
  else if (uMow > 1.5 && uMow < 2.5) { vec2 q = vec2(p.x + p.z, p.x - p.z) * D / 34.0; of = 0.5 * (mowLight(mowS(q.x), vec2(D, -D), vd) + mowLight(mowS(q.y), vec2(D, D), vd)); } // diamonds
  else if (uMow > 2.5 && uMow < 3.5) of = mowLight(mowS(length(p.xz) / 24.0), normalize(p.xz + vec2(1e-3)), vd); // rings out from home
  else if (uMow > 3.5) of = 0.25 * mowS(p.z / 15.0); // turf: printed bands
  else of = mowLight(mowS(p.x / 26.0), vec2(0.0, 1.0), vd); // stripes toward center field
  // the infield grass: a small diagonal checkerboard
  vec2 r = vec2(p.x + p.z, p.x - p.z) * D / 15.0;
  float chk = 0.5 * (mowLight(mowS(r.x * 0.5), vec2(D, -D), vd) + mowLight(mowS(r.y * 0.5), vec2(D, D), vd));
  float infield = 1.0 - smoothstep(88.0, 98.0, length(vec2(p.x, p.z + 60.5)));
  float pat = mix(of, uMow > 3.5 ? of : chk, infield);
  // slow patches (wear, watering) so it is never a perfect print
  float blot = sin(p.x * 0.031 + 1.3) * sin(p.z * 0.027) * 0.03 + sin(p.x * 0.11 + p.z * 0.07) * 0.012;
  return 1.0 + pat * 0.14 + blot;
}`;

export function buildStadium({ isMobile = false, crowdCount = 6000 } = {}) {
  const root = new THREE.Group();
  root.name = 'stadium';
  const perimeter = buildPerimeter();
  const ofPts = perimeter.filter((p) => p.kind === 'of');
  const park = currentPark();
  const look = (CONFIG.parks.looks || {})[park.id] || {};

  // ---------------------------------------------------------------- ground
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(512), roughness: 0.96, metalness: 0, color: new THREE.Color(look.grass || '#ffffff') });
  if (look.grass) grassMat.color.multiplyScalar(1 / Math.max(grassMat.color.r, grassMat.color.g, grassMat.color.b)); // (a tint, not a darkening)
  grassMat.map.repeat.set(2600 / 7, 2600 / 7);
  grassMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.uniforms.uMow = { value: MOW[look.mow] ?? 0 };
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
  const { texture: infieldTex, bounds } = infieldTexture(look.dirt || '#a86f47');
  const infield = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0),
    new THREE.MeshStandardMaterial({ map: infieldTex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }) // (pulled well in front of the grass: close to the camera, at a low angle, a small offset lost to the grass and the dirt round home plate vanished)
  );
  {
    const detail = dirtTexture('#c8c8c8', 256, 17);
    detail.repeat.set(1, 1);
    infield.material.userData.extraTextures = [detail]; // (freed with the stadium, see scene.js disposeTree)
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
  infield.renderOrder = -1; // (first of the see-through things: the dirt never paints over the pitch marker, rings, shadows or dust)
  root.add(infield);

  // Warning track + foul-territory dirt along the wall
  const trackTex = dirtTexture(look.dirt ? '#' + new THREE.Color(look.dirt).multiplyScalar(0.88).getHexString() : '#96603f', 512, 9);
  const trackMat = new THREE.MeshStandardMaterial({ map: trackTex, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const track = new THREE.Mesh(
    groundStripGeometry(perimeter, { inner: 0.3, outer: (p) => (p.kind === 'of' ? F.warningTrack : 11), y: 0.02, uPerFt: 1 / 12 }),
    trackMat
  );
  track.receiveShadow = true;
  root.add(track);

  // ---------------------------------------------------------------- field markings
  const chalk = new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 1, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16 }); // (in front of the dirt)
  // All chalk lines are collected and baked into ONE mesh (one draw call).
  const chalkSpecs = [];
  const line = (x0, z0, x1, z1, width, y = 0.032) => { chalkSpecs.push({ x0, z0, x1, z1, width, y }); };
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
  {
    const geos = chalkSpecs.map((c) => {
      const len = Math.hypot(c.x1 - c.x0, c.z1 - c.z0);
      const g = new THREE.PlaneGeometry(c.width, len);
      g.rotateX(-Math.PI / 2); // long axis along -z
      g.rotateY(Math.atan2(-(c.x1 - c.x0), -(c.z1 - c.z0)));
      g.translate((c.x0 + c.x1) / 2, c.y, (c.z0 + c.z1) / 2);
      return g;
    });
    let vc = 0, ic = 0;
    for (const g of geos) { vc += g.getAttribute('position').count; ic += g.index.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), idx = new Uint32Array(ic);
    let vo = 0, io = 0;
    for (const g of geos) {
      const n = g.getAttribute('position').count;
      pos.set(g.getAttribute('position').array, vo * 3);
      nor.set(g.getAttribute('normal').array, vo * 3);
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      vo += n; io += g.index.count;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    mg.setIndex(new THREE.BufferAttribute(idx, 1));
    const chalkMesh = new THREE.Mesh(mg, chalk);
    chalkMesh.receiveShadow = true;
    root.add(chalkMesh);
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
  // (the padded wall with its signs is as high as the lowest stretch of wall; where the park's wall is taller - a Green Monster -
  // it goes on up in the park's wall colour)
  const wallColor = park.wall || '#0f3d24';
  const baseH = Math.min(...ofPts.map((p) => p.h0));
  const wTex = wallTexture(ofLen, baseH, markers, wallColor, look.wallStyle);
  const wallOfPts = ofPts.map((p) => ({ ...p, s: p.s - ofPts[0].s }));
  const wall = new THREE.Mesh(
    ribbonGeometry(wallOfPts, { y0: 0, y1: baseH, uPerFt: 1 / ofLen, vScale: 1 }),
    new THREE.MeshStandardMaterial({ map: wTex, roughness: 0.9, side: THREE.DoubleSide })
  );
  wall.receiveShadow = true;
  root.add(wall);
  if (ofPts.some((p) => p.h0 > baseH + 0.05)) {
    const upper = new THREE.Mesh(
      ribbonGeometry(wallOfPts, { y0: baseH, y1: (p) => p.h0, uPerFt: 0.05 }),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(wallColor).multiplyScalar(1.45), roughness: 0.92, side: THREE.DoubleSide })
    );
    upper.receiveShadow = true;
    root.add(upper);
  }
  void arc;

  // foul-territory / back walls (padded, plain)
  const foulPts = perimeter.filter((p) => p.kind !== 'of');
  const foulWallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(wallColor).multiplyScalar(1.2), roughness: 0.9, side: THREE.DoubleSide });
  const foulWall = new THREE.Mesh(ribbonGeometry(foulPts, { y0: 0, y1: (p) => p.h0, uPerFt: 0.05 }), foulWallMat);
  foulWall.receiveShadow = true;
  root.add(foulWall);
  // yellow cap on the wall
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf2cf1d, roughness: 0.6, emissive: 0x3a3000 });
  const cap = new THREE.Mesh(ribbonGeometry(perimeter, { y0: (p) => p.h0, y1: (p) => p.h0 + 0.5, uPerFt: 0.1, offset: 0.1 }), capMat);
  root.add(cap);

  // ---------------------------------------------------------------- stands
  const S = F.stands;
  let seatHex = () => '#3367a6';
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
    // seats: blue at Sandlot Park; in a club's park they take a shade of the club's colour
    // (the park's own seat colour; else a shade of the club's colour; blue at Sandlot Park. A list: bands from the bottom up.)
    const club = MLB_TEAMS.find((t) => t.id === park.id);
    const base = look.seats ? (Array.isArray(look.seats) ? look.seats : [look.seats]) : [club ? '#' + new THREE.Color('#5a6270').lerp(new THREE.Color(club.color), 0.62).getHexString() : '#3367a6'];
    const kindShade = { of: 0.95, foul: 1.05, back: 0.88 };
    const purpleRow = (look.features || []).includes('purpleRow') ? Math.floor(rows * 0.62) : -1;
    seatHex = (t) => base[Math.min(base.length - 1, Math.floor(Math.max(0, t) * base.length))];
    for (let i = 0; i < n; i++) {
      const p = perimeter[i];
      for (let k = 0; k < K; k++) {
        const q = prof[k];
        c.set(q.row === purpleRow ? '#5b2c83' : seatHex(q.row / rows)).multiplyScalar(kindShade[p.kind]);
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
    const facadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.facade || '#272e3a'), roughness: 0.9, side: THREE.DoubleSide });
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

  // Batter's eye (dark backdrop behind center field so the ball is easy to see): matte dark-green panels (kept dark and low in
  // contrast on purpose - it is what the pitch is seen against) with a row of clipped juniper bushes along the top.
  {
    const eyePts = ofPts.filter((p) => Math.abs(p.a) <= 9).map((p) => ({ ...p, s: p.s - ofPts[0].s }));
    const panel = (() => {
      const { canvas, ctx } = makeCanvas(256, 256);
      ctx.fillStyle = '#0c1c13'; ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) { // faint mottling so it reads as a surface, not a hole
        const v = 12 + Math.random() * 10;
        ctx.fillStyle = `rgba(${v},${v + 14},${v + 6},0.35)`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
      ctx.fillStyle = '#050c08'; ctx.fillRect(0, 0, 3, 256); // panel seam
      ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(3, 0, 2, 256);
      return toTexture(canvas, { wrap: true, anisotropy: 4 });
    })();
    const eyeMat = new THREE.MeshStandardMaterial({ map: panel, color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    const eye = new THREE.Mesh(ribbonGeometry(eyePts, { offset: 1.5, y0: 0, y1: 34, uPerFt: 1 / 16 }), eyeMat);
    root.add(eye);
    const hedge = (() => {
      const { canvas, ctx } = makeCanvas(512, 128);
      ctx.clearRect(0, 0, 512, 128);
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * 512, bump = 18 * Math.abs(Math.sin(x / 512 * Math.PI * 9)); // a row of rounded bushes
        const y = 128 - Math.random() * (70 + bump);
        const r = 6 + Math.random() * 12, v = Math.random();
        ctx.fillStyle = `rgb(${14 + v * 20},${48 + v * 50},${24 + v * 22})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      return toTexture(canvas, { wrap: true, anisotropy: 4 });
    })();
    const top = new THREE.Mesh(ribbonGeometry(eyePts, { offset: 1.2, y0: 31.5, y1: 40, uPerFt: 1 / 40 }), new THREE.MeshStandardMaterial({ map: hedge, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false }));
    root.add(top);
    // side wings
    for (const sd of [-1, 1]) {
      const e = ofPts.reduce((b, p) => (Math.abs(p.a - sd * 9) < Math.abs(b.a - sd * 9) ? p : b), ofPts[0]);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(3, 36, 3), new THREE.MeshStandardMaterial({ color: 0x0c1a12, roughness: 1 }));
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
  // Set into the foul-territory wall (physics/field.js dugoutSpot, so fielders treat the front rail as a wall): a roof with a
  // team-colour fascia, a padded front wall with a rail, posts, a bench, bat and helmet racks and a water cooler.
  {
    const M = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const concrete = M(0x8d949c, 0.95), inside = M(0x1b212a, 1), floorM = M(0x3b4048, 1), roofM = M(0x2a323d, 0.8, 0.1);
    const pad = M(0x1d4d33, 0.9), railM = M(0xc9ced6, 0.35, 0.7), wood = M(0x8a6a45, 0.75), cooler = M(0xf07a12, 0.5), white = M(0xf2f2f2, 0.6);
    const fascia = (() => {
      const { canvas, ctx } = makeCanvas(1024, 64);
      ctx.fillStyle = '#16284a'; ctx.fillRect(0, 0, 1024, 64);
      ctx.fillStyle = '#ffb52e'; ctx.fillRect(0, 6, 1024, 4); ctx.fillRect(0, 54, 1024, 4);
      ctx.fillStyle = '#f5f7fc'; ctx.font = 'italic 900 34px Arial Black, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(currentPark().name.toUpperCase(), 512, 33);
      return new THREE.MeshStandardMaterial({ map: toTexture(canvas, { anisotropy: 4 }), roughness: 0.7 });
    })();
    const D = DUGOUT.depth, back = -3, Hh = 7.6;
    for (const sd of [-1, 1]) {
      const spot = dugoutSpot(sd);
      const L = spot.length, g = new THREE.Group();
      const add = (geo, mat, x, y, z, shadow = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = shadow; g.add(m); return m; };
      const depth = D - back;
      add(new THREE.BoxGeometry(L, 0.2, depth), floorM, 0, 0.1, (D + back) / 2);
      add(new THREE.BoxGeometry(L, Hh, 0.5), inside, 0, Hh / 2, back);
      for (const e of [-1, 1]) add(new THREE.BoxGeometry(0.8, Hh + 0.4, depth), concrete, e * (L / 2 - 0.4), (Hh + 0.4) / 2, (D + back) / 2, true);
      add(new THREE.BoxGeometry(L + 0.6, 0.6, depth + 1.2), roofM, 0, Hh + 0.3, (D + back) / 2 + 0.6, true);
      // (the fascia board: only its front face carries the team lettering - that face goes last, so the board is two draws, not six)
      const fasGeo = new THREE.BoxGeometry(L + 0.6, 1.4, 0.3);
      {
        const ix = fasGeo.index.array, mv = new ix.constructor(ix.length);
        mv.set(ix.subarray(0, 24), 0); mv.set(ix.subarray(30, 36), 24); mv.set(ix.subarray(24, 30), 30); // (faces +x -x +y -y | -z | +z)
        fasGeo.setIndex(new THREE.BufferAttribute(mv, 1));
        fasGeo.clearGroups(); fasGeo.addGroup(0, 30, 0); fasGeo.addGroup(30, 6, 1);
      }
      add(fasGeo, [roofM, fascia], 0, Hh + 0.1, D + 1.25);
      add(new THREE.BoxGeometry(L - 1.6, 3.3, 0.7), pad, 0, 1.65, D - 0.35, true); // padded front wall
      add(new THREE.CylinderGeometry(0.12, 0.12, L - 1.6, 8), railM, 0, 4.1, D - 0.35).rotation.z = Math.PI / 2;
      for (const px of [-L / 4, 0, L / 4]) add(new THREE.CylinderGeometry(0.16, 0.16, Hh - 3.3, 8), railM, px, 3.3 + (Hh - 3.3) / 2, D - 0.35);
      // bench along the back wall
      add(new THREE.BoxGeometry(L - 8, 0.3, 1.5), wood, 0, 1.6, back + 1.3);
      add(new THREE.BoxGeometry(L - 8, 1.5, 0.2), wood, 0, 2.6, back + 0.5);
      for (const bx of [-(L - 10) / 2, 0, (L - 10) / 2]) add(new THREE.BoxGeometry(0.3, 1.5, 1.2), concrete, bx, 0.75, back + 1.3);
      // bat rack (one end) and helmet shelf (the other)
      const rx = sd * (L / 2 - 3.2);
      add(new THREE.BoxGeometry(3.4, 0.25, 0.8), wood, rx, 3.2, back + 0.8);
      const batWoods = [0xc9a066, 0xe8d3a2, 0x8a2a1c, 0x151517, 0xc9a066, 0xe8d3a2, 0x3b4756];
      batWoods.forEach((c, i) => { const b = add(new THREE.CylinderGeometry(0.1, 0.04, 2.8, 6), M(c, 0.5), rx - 1.4 + i * 0.47, 1.9, back + 0.8); b.rotation.x = -0.12; });
      const hx = -sd * (L / 2 - 4);
      add(new THREE.BoxGeometry(5, 0.2, 0.9), wood, hx, 4.6, back + 0.7);
      const helm = new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), helmM = M(0x16284a, 0.35, 0.1);
      for (let i = 0; i < 5; i++) add(helm, helmM, hx - 2 + i, 4.72, back + 0.7);
      // water cooler on a stand, near the steps
      const cx = sd * (L / 2 - 8);
      add(new THREE.BoxGeometry(1.8, 2.2, 1.6), concrete, cx, 1.1, back + 1.4);
      add(new THREE.CylinderGeometry(0.7, 0.7, 1.5, 16), cooler, cx, 2.95, back + 1.4, true);
      add(new THREE.CylinderGeometry(0.72, 0.72, 0.18, 16), white, cx, 3.8, back + 1.4);
      const [ccx, ccz] = spot.center, [nx, nz] = spot.inward;
      g.position.set(ccx, 0, ccz);
      g.rotation.y = Math.atan2(nx, nz); // local +z faces the field
      mergeStatic(g); // (one mesh per surface, not one per bat and bolt)
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
  const lampTex = (() => {
    const { canvas, ctx } = makeCanvas(256, 160);
    ctx.fillStyle = '#20242a'; ctx.fillRect(0, 0, 256, 160);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
      const g = ctx.createRadialGradient(16 + c * 31, 16 + r * 31, 1, 16 + c * 31, 16 + r * 31, 14);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e8e8e8'); g.addColorStop(1, '#8a8f97');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(16 + c * 31, 16 + r * 31, 13, 0, Math.PI * 2); ctx.fill();
    }
    return toTexture(canvas, { anisotropy: 4 });
  })();
  const lampMat = new THREE.MeshBasicMaterial({ map: lampTex, color: 0x2b2f36, toneMapped: false });
  const glowMats = [];
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a919b, roughness: 0.55, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.7, metalness: 0.5 });
  const towerSpots = [polar(-53, 420), polar(53, 420), { x: -205, z: 30 }, { x: 205, z: 30 }];
  for (const tp of towerSpots) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.6, 150, 10), steel);
    pole.position.y = 75; g.add(pole);
    const bank = new THREE.Group();
    bank.position.y = 152;
    // the lamp bank: a frame with the lamps on its face, a catwalk under it, the back braced
    const frame = new THREE.Mesh(new THREE.BoxGeometry(46, 26, 2), dark);
    bank.add(frame);
    const lamps = new THREE.Mesh(new THREE.PlaneGeometry(44, 24), lampMat);
    lamps.position.z = 1.1;
    bank.add(lamps);
    for (const y of [-6.5, 0, 6.5]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(46, 0.5, 0.6), dark); bar.position.set(0, y, 1.4); bank.add(bar); }
    const walk = new THREE.Mesh(new THREE.BoxGeometry(46, 0.6, 5), dark);
    walk.position.set(0, -14, 1.2); bank.add(walk);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(46, 0.3, 0.3), steel);
    rail.position.set(0, -11, 3.6); bank.add(rail);
    for (const x of [-12, 12]) { const brace = new THREE.Mesh(new THREE.BoxGeometry(1.2, 30, 1.2), steel); brace.position.set(x, -4, -2); brace.rotation.z = x > 0 ? -0.5 : 0.5; bank.add(brace); }
    const gm = new THREE.SpriteMaterial({ map: towerGlow, color: 0xfff1d6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    glowMats.push(gm);
    const glow = new THREE.Sprite(gm);
    glow.scale.set(150, 110, 1);
    glow.position.set(0, 0, 4);
    bank.add(glow);
    g.add(bank);
    g.position.set(tp.x, 0, tp.z);
    // the lamps face the middle of the field and tilt down at it (+z of the bank is the lamp side)
    const dx = 0 - tp.x, dz = -110 - tp.z;
    bank.rotation.order = 'YXZ';
    bank.rotation.y = Math.atan2(dx, dz);
    bank.rotation.x = Math.atan2(150, Math.hypot(dx, dz)) * 0.7;
    mergeStatic(g);
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

  // ---------------------------------------------------------------- the park's own look: decks, roof, backdrop, landmarks
  const parkLook = buildParkLook(root, { perimeter, ofPts, standsDepth: rows * rd, standsRise: rows * rr, look, parkId: park.id, isMobile, seatHex, seatTexture: seatTex });

  // ---------------------------------------------------------------- crowd
  // (the home club's colours: its fans wear them; Sandlot Park's own navy and red)
  const home = MLB_TEAMS.find((t) => t.id === park.id);
  const crowd = createCrowd(perimeter, { count: crowdCount, colors: home ? [home.color, home.color2] : ['#1d3a7e', '#b8312a'], decks: parkLook.crowdDecks });
  root.add(crowd.mesh);

  return {
    root,
    perimeter,
    scoreboard,
    crowd,
    bases,
    celebrate() { parkLook.celebrate(); }, // a home run by the home team (Citi Field's apple rises)
    // Called every frame. env supplies brightness/lamp levels.
    update(dt, time, env) {
      const lamps = env ? env.lamps : 0;
      lampMat.color.setRGB(0.5 + lamps * 1.9, 0.52 + lamps * 1.8, 0.56 + lamps * 1.5); // (by day the reflectors are pale silver; lit at night)
      for (const m of glowMats) m.opacity = lamps * 0.75;
      crowd.update(dt, time, env ? env.crowdBrightness : 1, env ? env.glass : 0);
      scoreboard.update(dt);
      parkLook.update(dt, time, env);
      scoreboard.setBrightness(env && env.lamps > 0.5 ? 1 : 0.9);
    },
  };
}
