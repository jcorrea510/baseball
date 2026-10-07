// What makes each ballpark look like itself (config.parks.looks): upper decks, a dome or a retractable roof, what you see
// beyond the outfield (a skyline, mountains, hills, trees, water) and the park's landmarks - Camden's warehouse, Wrigley's
// rooftops, Kauffman's fountains, the Gateway Arch, PNC's yellow bridge, the Citi Field apple, Chase Field's pool, the Coke
// bottle and McCovey Cove at Oracle Park, the pines at Coors Field, and so on. Only the picture: nothing here changes play.
// Most pieces are plain coloured shapes merged into one mesh (one draw call); a few have their own textures.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { fenceDistance, polar } from '../physics/field.js';
import { ribbonGeometry } from './perimeter.js';
import { makeCanvas, toTexture } from './textures.js';

const TAU = Math.PI * 2;

// a small seeded random source (the same park always looks the same)
function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- textures
// Building facades for the skyline: one tile = FACADE.bays window bays x FACADE.floors floors (a floor ~12.5 ft, a bay ~10 ft,
// so windows are the real size on every building). Styles: 0 glass curtain wall, 1 stone office, 2 brick, 3 dark glass.
// `glow` draws only the lit windows (the emissive map: the city comes on at dusk) - the same layout from the same seed.
const FACADE = { px: 256, bays: 8, floors: 8, tileW: 80, tileH: 100 };
function facadeTexture(style, seed, glow) {
  const N = FACADE.px, bw = N / FACADE.bays, fh = N / FACADE.floors;
  const { canvas, ctx } = makeCanvas(N, N);
  const r = rand(seed * 7 + style * 131 + 1);
  const shade = (hex, k) => { const c = new THREE.Color(hex).multiplyScalar(k); return '#' + c.getHexString(); };
  ctx.fillStyle = glow ? '#000000' : ['#5d7286', '#cfc8b8', '#7b4433', '#262c35'][style];
  ctx.fillRect(0, 0, N, N);
  const lit = () => r() < [0.34, 0.4, 0.45, 0.28][style];
  const warm = () => ['#ffe2a8', '#ffd58a', '#fff1d2', '#d8e6ff', '#ffe9bd'][Math.floor(r() * 5)];
  for (let f = 0; f < FACADE.floors; f++) {
    const y = f * fh;
    // whole floors dark or lit together more often than not (offices)
    const floorLit = r() < 0.5;
    for (let b = 0; b < FACADE.bays; b++) {
      const x = b * bw;
      const on = floorLit ? r() < 0.75 && lit() || r() < 0.5 : lit() && r() < 0.6;
      if (style === 0 || style === 3) {
        // curtain wall: the whole bay is glass between thin mullions, a dark spandrel band at each floor
        if (glow) { if (on) { ctx.fillStyle = warm(); ctx.fillRect(x + 2, y + 6, bw - 4, fh - 8); } continue; }
        const base = style === 0 ? ['#4f6880', '#58728c', '#466077', '#6a8299', '#3f566c'] : ['#20262e', '#262d37', '#1b2028', '#2c3440'];
        const g = ctx.createLinearGradient(x, y, x + bw, y + fh);
        const c0 = base[Math.floor(r() * base.length)];
        g.addColorStop(0, shade(c0, 1.15)); g.addColorStop(1, shade(c0, 0.85));
        ctx.fillStyle = g; ctx.fillRect(x + 1, y + 5, bw - 2, fh - 6);
        ctx.fillStyle = style === 0 ? '#2e3d4c' : '#14181e'; ctx.fillRect(x, y, bw, 5); // spandrel
        ctx.fillStyle = style === 0 ? '#9fb0bf' : '#3a434f'; ctx.fillRect(x, y, 1.5, fh); // mullion
        ctx.fillRect(x + bw / 2, y + 5, 1, fh - 6);
      } else if (style === 1) {
        // stone office: a band of windows per floor, stone between
        if (glow) { if (on) { ctx.fillStyle = warm(); ctx.fillRect(x + 3, y + 9, bw - 6, fh - 16); } continue; }
        ctx.fillStyle = r() < 0.15 ? '#3b4656' : '#28313d'; ctx.fillRect(x + 3, y + 9, bw - 6, fh - 16);
        ctx.fillStyle = 'rgba(160,180,200,0.25)'; ctx.fillRect(x + 3, y + 9, bw - 6, 3); // a glint along the top of the glass
        ctx.fillStyle = '#b9b2a2'; ctx.fillRect(x + bw / 2 - 1, y + 9, 2, fh - 16);
        ctx.fillStyle = '#e2dccd'; ctx.fillRect(x, y + fh - 7, bw, 2); // sill line
      } else {
        // brick: bricks, then punched windows with stone sills and lintels
        if (glow) { if (on) { ctx.fillStyle = warm(); ctx.fillRect(x + 9, y + 7, bw - 18, fh - 13); } continue; }
        for (let yy = y; yy < y + fh; yy += 4) for (let xx = x + ((yy / 4) % 2 ? -4 : 0); xx < x + bw; xx += 8) {
          const v = r() * 0.2;
          ctx.fillStyle = `rgb(${Math.round(124 - v * 120)},${Math.round(64 - v * 60)},${Math.round(48 - v * 45)})`;
          ctx.fillRect(xx + 0.5, yy + 0.5, 7, 3);
        }
        ctx.fillStyle = '#1f252d'; ctx.fillRect(x + 9, y + 7, bw - 18, fh - 13);
        ctx.fillStyle = '#5a6574'; ctx.fillRect(x + 9, y + 7 + (fh - 13) / 2, bw - 18, 1.5); // sash
        ctx.fillStyle = '#d8d0bf'; ctx.fillRect(x + 7, y + fh - 6, bw - 14, 2.5); ctx.fillRect(x + 8, y + 5, bw - 16, 2);
      }
    }
  }
  return toTexture(canvas, { wrap: true, anisotropy: 8 });
}
function brickTexture(withWindows) {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#7a3d2b'; ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < 256; x += 16) {
    const v = Math.random() * 0.18;
    ctx.fillStyle = `rgb(${Math.round(128 - v * 160)},${Math.round(62 - v * 70)},${Math.round(45 - v * 50)})`;
    ctx.fillRect(x + 1, y + 1, 14, 6);
  }
  if (withWindows) for (let y = 20; y < 256; y += 64) for (let x = 14; x < 256; x += 42) {
    ctx.fillStyle = '#1c2128'; ctx.fillRect(x, y, 22, 34);
    ctx.fillStyle = '#c9c2b0'; ctx.fillRect(x - 2, y + 34, 26, 3);
  }
  return toTexture(canvas, { wrap: true, anisotropy: 4 });
}
function waterTexture() {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#2a5f86'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, l = 6 + Math.random() * 16;
    ctx.strokeStyle = `rgba(${170 + Math.random() * 60},${210 + Math.random() * 40},255,${0.08 + Math.random() * 0.18})`;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (Math.random() - 0.5) * 2); ctx.stroke();
  }
  return toTexture(canvas, { wrap: true, anisotropy: 4 });
}
function signTexture(text, fg, bg, logo = null) {
  const { canvas, ctx } = makeCanvas(512, 256);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 256);
  if (logo === 'triangle') {
    ctx.fillStyle = '#e8262b'; ctx.beginPath(); ctx.moveTo(256, 18); ctx.lineTo(370, 160); ctx.lineTo(142, 160); ctx.closePath(); ctx.fill();
    ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(256, 62); ctx.lineTo(330, 150); ctx.lineTo(182, 150); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8262b'; ctx.beginPath(); ctx.moveTo(256, 96); ctx.lineTo(300, 150); ctx.lineTo(212, 150); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = fg;
  ctx.font = `900 ${logo ? 74 : 64}px "Arial Black", Impact, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, logo ? 210 : 128, 490);
  return toTexture(canvas, { anisotropy: 4 });
}
function ribsTexture(base = '#d9dde2') {
  // roof panels: light panels with darker ribs
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) { ctx.fillStyle = 'rgba(40,46,56,0.55)'; ctx.fillRect(x, 0, 4, 256); }
  for (let y = 0; y < 256; y += 64) { ctx.fillStyle = 'rgba(40,46,56,0.3)'; ctx.fillRect(0, y, 256, 2); }
  return toTexture(canvas, { wrap: true, anisotropy: 4 });
}
function friezeTexture() {
  // Yankee Stadium's white frieze: a row of arches hanging from the roof
  const { canvas, ctx } = makeCanvas(256, 64);
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(0, 0, 256, 10);
  for (let x = 0; x < 256; x += 32) {
    ctx.fillRect(x, 0, 4, 64);
    ctx.beginPath(); ctx.lineWidth = 4; ctx.strokeStyle = '#f2f2ee';
    ctx.arc(x + 16, 10, 14, 0, Math.PI); ctx.stroke();
  }
  return toTexture(canvas, { wrap: true, anisotropy: 4 });
}
// ---------------------------------------------------------------- shapes
// A coloured piece for the merged mesh: transform a geometry and paint it one colour.
function piece(geo, o = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')),
    new THREE.Vector3(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1));
  geo.applyMatrix4(m);
  const g = geo.index ? geo.toNonIndexed() : geo; // (some shapes come without an index: all go in un-indexed so they merge)
  if (g !== geo) geo.dispose();
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(o.color || '#888888');
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
// a box whose texture repeats by its size (windows / bricks stay the right size on any building)
function texturedBox(w, h, d, tile, o) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // faces in order +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return piece(g, o);
}
const faceHome = (x, z) => Math.atan2(x, z); // (a box's +z face turned toward home plate)

// a stepped bowl of seats along perimeter points (like the lower stands, for upper decks)
function bowlGeometry(points, { offset, depth, base, slope, rowDepth = 2.5, colors }) {
  const rows = Math.max(2, Math.floor(depth / rowDepth));
  const rr = rowDepth * slope;
  const prof = [];
  for (let i = 0; i < rows; i++) {
    prof.push({ d: offset + i * rowDepth, h: i * rr, v: i, row: i });
    prof.push({ d: offset + (i + 1) * rowDepth, h: i * rr, v: i + 0.4, row: i });
    prof.push({ d: offset + (i + 1) * rowDepth, h: (i + 1) * rr, v: i + 1, row: i + 1 });
  }
  const K = prof.length, n = points.length;
  const pos = new Float32Array(n * K * 3), uv = new Float32Array(n * K * 2), col = new Float32Array(n * K * 3);
  const idx = [];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = points[i];
    for (let k = 0; k < K; k++) {
      const q = prof[k], j = i * K + k;
      pos[j * 3] = p.x + p.nx * q.d; pos[j * 3 + 1] = base(p) + q.h; pos[j * 3 + 2] = p.z + p.nz * q.d;
      uv[j * 2] = p.s / 15; uv[j * 2 + 1] = q.v;
      c.set(colors(q.row / rows));
      const shade = 1 - 0.3 * (q.row / rows);
      col[j * 3] = c.r * shade; col[j * 3 + 1] = c.g * shade; col[j * 3 + 2] = c.b * shade;
      if (i < n - 1 && k < K - 1) { const a = j, b = j + 1, cc = j + K, d = j + K + 1; idx.push(a, b, cc, b, d, cc); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, top: rows * rr, outer: offset + rows * rowDepth };
}

/**
 * Adds the park's look to the stadium.
 * @param {THREE.Group} root
 * @param {object} c { perimeter, ofPts, standsDepth, standsRise (height of the top row), look, parkId, isMobile, seatHex(t) }
 * @returns {{ update(dt, time, env): void }}
 */
export function buildParkLook(root, c) {
  const L = c.look || {};
  const r = rand([...(c.parkId || 'x')].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  const parts = []; // plain coloured pieces (one merged mesh)
  const glowParts = []; // pieces that light up at night (signs, neon)
  const updaters = [];
  const crowdDecks = []; // the upper decks' seats, for the crowd
  const has = (f) => (L.features || []).includes(f);
  const back = new Set(Array.isArray(L.backdrop) ? L.backdrop : L.backdrop ? [L.backdrop] : []);
  const outR = (a) => fenceDistance(Math.max(-45, Math.min(45, a))) + c.standsDepth; // back of the outfield stands
  const topY = c.standsRise + 9; // the roof lip of the lower stands
  const many = c.isMobile ? 0.55 : 1;
  const P = (a, d) => polar(a, d);

  // ---------------- upper decks round the infield (behind the plate and down the lines)
  const infieldPts = c.perimeter.filter((p) => p.kind !== 'of');
  const deckCount = L.decks ?? 1;
  let deckTop = c.standsRise; // height of the top of the highest deck at its back
  if (deckCount > 0 && infieldPts.length > 2) {
    const seatsMat = new THREE.MeshStandardMaterial({ map: c.seatTexture, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const fasciaMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.facade || '#272e3a'), roughness: 0.8, side: THREE.DoubleSide });
    for (let d = 0; d < deckCount; d++) {
      const offset = c.standsDepth * 0.58 + d * 26;
      const baseY = (p) => p.h0 + c.standsRise + 14 + d * 38;
      const bowl = bowlGeometry(infieldPts, { offset, depth: 46, base: baseY, slope: 0.78, colors: (t) => c.seatHex(0.55 + 0.45 * t + d * 0.3) });
      crowdDecks.push({ points: infieldPts, offset, base: baseY, rows: Math.max(2, Math.floor(46 / 2.5)), rowDepth: 2.5, slope: 0.78 });
      root.add(new THREE.Mesh(bowl.geometry, seatsMat));
      // the front of the deck (a fascia) and the back wall + roof
      root.add(new THREE.Mesh(ribbonGeometry(infieldPts, { offset: offset - 0.2, y0: (p) => baseY(p) - 7, y1: (p) => baseY(p) + 0.6, uPerFt: 0.05 }), fasciaMat));
      root.add(new THREE.Mesh(ribbonGeometry(infieldPts, { offset: bowl.outer + 0.2, y0: (p) => baseY(p) - 8, y1: (p) => baseY(p) + bowl.top + 10, uPerFt: 0.05 }), fasciaMat));
      deckTop = Math.max(deckTop, c.standsRise + 14 + d * 38 + bowl.top + 10);
      if (L.frieze && d === deckCount - 1) {
        // a roof over the top deck with the white frieze hanging from its front edge
        const roofY = (p) => baseY(p) + bowl.top + 10;
        const roofPts = infieldPts.map((p) => ({ ...p, x: p.x + p.nx * (offset + 8), z: p.z + p.nz * (offset + 8) }));
        root.add(new THREE.Mesh(ribbonGeometry(roofPts, { y0: (p) => roofY(p) - 0.5, y1: roofY, uPerFt: 0.05 }), fasciaMat));
        const fz = new THREE.Mesh(ribbonGeometry(roofPts, { offset: -0.3, y0: (p) => roofY(p) - 9, y1: (p) => roofY(p) - 0.4, uPerFt: 1 / 24 }),
          new THREE.MeshStandardMaterial({ map: friezeTexture(), roughness: 0.7, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false }));
        root.add(fz);
        // the roof itself, from the frieze back over the deck
        const g = new THREE.BufferGeometry();
        const n = infieldPts.length, pos = new Float32Array(n * 6), idx = [];
        for (let i = 0; i < n; i++) {
          const p = infieldPts[i], y = roofY(p);
          pos.set([p.x + p.nx * (offset + 8), y, p.z + p.nz * (offset + 8), p.x + p.nx * (bowl.outer + 0.2), y, p.z + p.nz * (bowl.outer + 0.2)], i * 6);
          if (i < n - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
        }
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        root.add(new THREE.Mesh(g, fasciaMat));
      }
    }
  }

  // ---------------- what is beyond the outfield
  if (back.has('skyline')) {
    // A downtown: a cluster of towers in one direction beyond the outfield (tallest in the middle of it), lower blocks round it,
    // each building with real-size windows (four facade styles), set-backs, a roof, a penthouse, now and then an antenna,
    // a spire or a wooden water tank. The windows light up at dusk.
    const SK = CONFIG.parks.skyline;
    const keepClear = has('arch') ? 16 : 10; // (nothing tall right behind the batter's eye - or in front of the Arch)
    const centre = (r() < 0.5 ? -1 : 1) * (SK.centre[0] + r() * (SK.centre[1] - SK.centre[0]));
    const walls = [[], [], [], []]; // facades by style
    const tile = (g) => {
      // box uvs in tiles of FACADE.tileW x tileH ft (faces +x, -x, +y, -y, +z, -z)
      const uv = g.getAttribute('uv'), p = g.parameters, dims = [[p.depth, p.height], [p.depth, p.height], [p.width, p.depth], [p.width, p.depth], [p.width, p.height], [p.width, p.height]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / FACADE.tileW, uv.getY(i) * dims[f][1] / FACADE.tileH); }
      return g;
    };
    const tone = (k) => { const v = 0.88 + r() * 0.2 * k; return '#' + new THREE.Color(v, v, v * (0.98 + r() * 0.04)).getHexString(); };
    const building = (a, d, h, w, dd, style) => {
      const p = P(a, d), ry = faceHome(p.x, p.z) + (r() - 0.5) * 0.6;
      const at = (lx, lz) => ({ x: p.x + lx * Math.cos(ry) + lz * Math.sin(ry), z: p.z - lx * Math.sin(ry) + lz * Math.cos(ry) });
      // the floors snap to whole storeys so a set-back sits on a floor line
      const storey = FACADE.tileH / FACADE.floors;
      let hb = Math.max(storey * 3, Math.round(h / storey) * storey);
      const setback = h > 220 && r() < 0.55;
      const h1 = setback ? Math.round((hb * (0.55 + r() * 0.2)) / storey) * storey : hb;
      walls[style].push(piece(tile(new THREE.BoxGeometry(w, h1, dd)), { x: p.x, y: h1 / 2, z: p.z, ry, color: tone(1) }));
      let top = h1, tw = w, td = dd;
      if (setback) {
        tw = w * (0.62 + r() * 0.2); td = dd * (0.62 + r() * 0.2);
        const h2 = hb - h1;
        walls[style].push(piece(tile(new THREE.BoxGeometry(tw, h2, td)), { x: p.x, y: h1 + h2 / 2, z: p.z, ry, color: tone(1) }));
        parts.push(piece(new THREE.BoxGeometry(w + 1, 1.6, dd + 1), { x: p.x, y: h1 + 0.6, z: p.z, ry, color: '#4b5058' }));
        top = hb;
      }
      // the roof: a parapet cap, a penthouse for the lifts and air conditioning
      const roofCol = style === 2 ? '#3d3330' : style === 1 ? '#8f8a80' : '#2f363f';
      parts.push(piece(new THREE.BoxGeometry(tw + 1.2, 2.2, td + 1.2), { x: p.x, y: top + 1.0, z: p.z, ry, color: roofCol }));
      const ph = 10 + r() * 14, pw = tw * (0.3 + r() * 0.25), pd = td * (0.3 + r() * 0.25);
      const off = at((r() - 0.5) * (tw - pw) * 0.6, (r() - 0.5) * (td - pd) * 0.6);
      parts.push(piece(new THREE.BoxGeometry(pw, ph, pd), { x: off.x, y: top + ph / 2, z: off.z, ry, color: style === 1 ? '#a9a395' : '#4a525d' }));
      if (style === 0 && top > 300 && r() < 0.35) {
        // a glass crown
        parts.push(piece(new THREE.ConeGeometry(Math.min(tw, td) * 0.6, 40 + r() * 50, 4, 1), { x: p.x, y: top + 25, z: p.z, ry: ry + Math.PI / 4, color: '#56708a' }));
      } else if (top > 260 && r() < 0.5) {
        // an antenna mast with a red light
        const mh = 40 + r() * 90;
        parts.push(piece(new THREE.CylinderGeometry(0.8, 1.4, mh, 5), { x: p.x, y: top + ph + mh / 2, z: p.z, color: '#9aa0a8' }));
        glowParts.push(piece(new THREE.SphereGeometry(2.2, 6, 4), { x: p.x, y: top + ph + mh, z: p.z, color: '#ff3a2a' }));
      } else if (style === 2 && top < 200 && r() < 0.6) {
        // a wooden water tank on legs
        const tx = at((r() - 0.5) * tw * 0.5, (r() - 0.5) * td * 0.5);
        parts.push(piece(new THREE.CylinderGeometry(6, 6, 12, 10), { x: tx.x, y: top + 14, z: tx.z, color: '#6e5642' }));
        parts.push(piece(new THREE.ConeGeometry(6.6, 5, 10), { x: tx.x, y: top + 22.5, z: tx.z, color: '#4c3d30' }));
        parts.push(piece(new THREE.BoxGeometry(9, 8, 9), { x: tx.x, y: top + 4, z: tx.z, color: '#3a3532' }));
      }
    };
    const angle = (spread) => {
      let a = centre + (r() + r() + r() - 1.5) * spread;
      a = Math.max(-66, Math.min(66, a));
      if (Math.abs(a) < keepClear) a = (a < 0 ? -1 : 1) * (keepClear + r() * 6);
      return a;
    };
    // the towers
    for (let i = 0; i < Math.round(SK.towers * many); i++) {
      const a = angle(SK.spread), near = 1 - Math.min(1, Math.abs(a - centre) / SK.spread);
      const d = outR(a) + SK.dist[0] + r() * (SK.dist[1] - SK.dist[0]);
      const h = SK.height[0] + (SK.height[1] - SK.height[0]) * (0.35 * r() + 0.65 * near * r() ** 0.6) + (d - 900) * 0.08;
      const style = h < 200 && r() < 0.35 ? 2 : r() < 0.45 ? 0 : r() < 0.55 ? 1 : 3; // (tall brick buildings are rare: brick is for the lower blocks)
      building(a, d, h, 55 + r() * 60, 55 + r() * 55, style);
    }
    // the lower blocks round them (brick and stone, some glass)
    for (let i = 0; i < Math.round(SK.blocks * many); i++) {
      const a = angle(SK.spread * 1.7);
      const d = outR(a) + SK.dist[0] * 0.6 + r() * (SK.dist[1] - SK.dist[0] * 0.6);
      const style = r() < 0.45 ? 2 : r() < 0.6 ? 1 : 0;
      building(a, d, 50 + r() * 110, 60 + r() * 80, 50 + r() * 60, style);
    }
    const lamps = [];
    for (let st = 0; st < 4; st++) {
      if (!walls[st].length) continue;
      const seed = Math.floor(r() * 1e6);
      const glass = st === 0 || st === 3;
      const mat = new THREE.MeshStandardMaterial({
        map: facadeTexture(st, seed, false), emissiveMap: facadeTexture(st, seed, true), emissive: 0xffffff, emissiveIntensity: 0,
        vertexColors: true, roughness: glass ? 0.32 : 0.85, metalness: glass ? 0.35 : 0,
      });
      lamps.push(mat);
      root.add(new THREE.Mesh(mergeGeometries(walls[st]), mat));
    }
    updaters.push((dt, t, env) => { for (const m of lamps) m.emissiveIntensity = 0.03 + (env ? env.lamps : 0) * 0.95; });
  }
  const ridge = (count, rMin, rMax, hMin, hMax, colors, cap = null, flat = false) => {
    for (let i = 0; i < Math.round(count * many); i++) {
      const a = -85 + (170 * (i + r() * 0.7)) / count;
      const d = rMin + r() * (rMax - rMin);
      const h = hMin + r() * (hMax - hMin), rad = h * (flat ? 1.1 : 1.15 + 0.6 * r());
      const p = P(a, d);
      const col = colors[Math.floor(r() * colors.length)];
      const geo = flat ? new THREE.CylinderGeometry(rad * 0.75, rad, h, 7, 1) : new THREE.ConeGeometry(rad, h, 7, 1);
      parts.push(piece(geo, { x: p.x, y: h / 2 - 2, z: p.z, ry: r() * TAU, sx: 1, sz: 0.6 + r() * 0.5, color: col }));
      if (cap) parts.push(piece(new THREE.ConeGeometry(rad * 0.32, h * 0.32, 7, 1), { x: p.x, y: h - h * 0.16 - 1, z: p.z, ry: r() * TAU, sz: 0.6 + r() * 0.5, color: cap }));
    }
  };
  if (back.has('mountains')) ridge(14, 2600, 3400, 280, 560, ['#6d6a5f', '#5f6670', '#77705f']);
  if (back.has('snowpeaks')) ridge(18, 2800, 3600, 420, 820, ['#5a6472', '#4f5a68', '#66707c'], '#f2f4f7');
  if (back.has('desert')) ridge(12, 2000, 3000, 160, 340, ['#a8653d', '#9a5a36', '#b8774a'], null, true);
  if (back.has('hills')) {
    for (let i = 0; i < Math.round(12 * many); i++) {
      const a = -80 + (160 * (i + r() * 0.8)) / 12, d = 1300 + r() * 900, p = P(a, d);
      const s = 260 + r() * 260;
      parts.push(piece(new THREE.SphereGeometry(1, 12, 6, 0, TAU, 0, Math.PI / 2), { x: p.x, y: -4, z: p.z, sx: s * 1.6, sy: s * 0.42, sz: s, ry: r() * TAU, color: ['#4f6b3b', '#5a7442', '#62703f'][Math.floor(r() * 3)] }));
    }
  }
  const tree = (x, z, h, col = '#24452b') => {
    parts.push(piece(new THREE.CylinderGeometry(h * 0.04, h * 0.05, h * 0.35, 5), { x, y: h * 0.17, z, color: '#4a3524' }));
    parts.push(piece(new THREE.SphereGeometry(h * 0.3, 7, 5), { x, y: h * 0.58, z, sy: 1.15, color: col }));
  };
  if (back.has('trees')) {
    for (let i = 0; i < Math.round(70 * many); i++) {
      const a = -70 + r() * 140, p = P(a, outR(a) + 25 + r() * 220);
      tree(p.x, p.z, 45 + r() * 40, ['#24452b', '#2d5233', '#1f3d27'][Math.floor(r() * 3)]);
    }
  }
  const water = (a0, a1, near, far) => {
    const segs = 24, pos = [], idx = [], uv = [];
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((a1 - a0) * i) / segs;
      const p0 = P(a, outR(a) + near), p1 = P(a, outR(a) + far);
      pos.push(p0.x, 0.4, p0.z, p1.x, 0.4, p1.z);
      uv.push(p0.x / 60, p0.z / 60, p1.x / 60, p1.z / 60);
      if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const tex = waterTexture();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.22, metalness: 0.15, side: THREE.DoubleSide }));
    root.add(m);
    updaters.push((dt) => { tex.offset.x = (tex.offset.x + dt * 0.01) % 1; });
  };
  if (back.has('water')) {
    if (c.parkId === 'sf') water(-10, 80, 60, 1600); // San Francisco Bay
    else if (c.parkId === 'sea') water(-70, -20, 600, 2000); // Puget Sound
    else water(-60, 60, 260, 900); // a river beyond center field (Pittsburgh, Cincinnati)
  }

  // ---------------- a roof
  if (L.roof === 'dome') {
    // a closed dome over the whole park: rim just above the stands, a shallow cap of ribbed panels, the walls of the building
    const rimR = 392, rimY = Math.max(topY, deckTop) + 12, rise = 150;
    const R = (rimR * rimR + rise * rise) / (2 * rise), th = Math.asin(rimR / R);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 56, 14, 0, TAU, 0, th),
      new THREE.MeshStandardMaterial({ map: ribsTexture('#cfd4da'), roughness: 0.9, side: THREE.BackSide, emissive: 0x20242b }));
    cap.material.map.repeat.set(24, 4);
    cap.position.set(0, rimY + rise - R, -200);
    root.add(cap);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, rimY + 2, 56, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.95, side: THREE.BackSide }));
    wall.position.set(0, (rimY + 2) / 2 - 1, -200);
    root.add(wall);
    // the ring of lights round the rim
    parts.push(piece(new THREE.TorusGeometry(rimR - 6, 2.2, 6, 72), { x: 0, y: rimY - 4, z: -200, rx: Math.PI / 2, color: '#e9e4d2' }));
  }
  if (L.roof === 'open') {
    // a retractable roof stacked open beyond the outfield: a huge arched shell on its trusses
    const zc = -(outR(0) + 150);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(330, 330, 260, 40, 1, true, -1.05, 2.1),
      new THREE.MeshStandardMaterial({ map: ribsTexture('#c3c8cf'), roughness: 0.85, side: THREE.DoubleSide }));
    shell.material.map.repeat.set(10, 3);
    shell.rotation.z = Math.PI / 2; shell.rotation.y = Math.PI / 2;
    shell.position.set(0, 230 - 330, zc);
    root.add(shell);
    for (const sx of [-1, 1]) {
      parts.push(piece(new THREE.TorusGeometry(330, 4, 6, 40, Math.PI * 0.67), { x: sx * 128, y: 230 - 330, z: zc, ry: Math.PI / 2, rz: Math.PI * 0.165, color: '#59616d' }));
      parts.push(piece(new THREE.BoxGeometry(12, 130, 12), { x: sx * 150, y: 65, z: zc + 200, color: '#59616d' }));
      parts.push(piece(new THREE.BoxGeometry(12, 130, 12), { x: sx * 150, y: 65, z: zc - 200, color: '#59616d' }));
    }
  }

  // ---------------- landmarks
  if (has('warehouse')) {
    // the long brick warehouse beyond the right-field stands, along the right-field line
    const p = P(52, 560);
    const g = texturedBox(900, 96, 52, 48, { x: p.x, y: 48, z: p.z, ry: -Math.PI / 4, color: '#ffffff' });
    root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: brickTexture(true), vertexColors: true, roughness: 0.9 })));
    parts.push(piece(new THREE.BoxGeometry(904, 3, 56), { x: p.x, y: 97, z: p.z, ry: -Math.PI / 4, color: '#3b2a22' }));
  }
  if (has('citgo')) {
    const p = P(-24, 980);
    parts.push(piece(new THREE.BoxGeometry(160, 110, 90), { x: p.x, y: 55, z: p.z, ry: faceHome(p.x, p.z), color: '#8d7f6e' }));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: signTexture('CITGO', '#1d3f8f', '#f4f4f4', 'triangle'), emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide }));
    s.material.emissiveMap = s.material.map;
    s.position.set(p.x, 175, p.z); s.rotation.y = faceHome(p.x, p.z);
    root.add(s);
    updaters.push((dt, t, env) => { s.material.emissiveIntensity = (env ? env.lamps : 0) * 0.9; });
  }
  if (has('cntower')) {
    const p = P(-34, 1900);
    parts.push(piece(new THREE.CylinderGeometry(9, 34, 760, 10), { x: p.x, y: 380, z: p.z, color: '#b9b5ad' }));
    parts.push(piece(new THREE.SphereGeometry(44, 14, 8), { x: p.x, y: 560, z: p.z, sy: 0.55, color: '#8e959e' }));
    parts.push(piece(new THREE.TorusGeometry(46, 6, 6, 20), { x: p.x, y: 560, z: p.z, rx: Math.PI / 2, color: '#e8e6e0' }));
    parts.push(piece(new THREE.CylinderGeometry(3, 6, 260, 6), { x: p.x, y: 890, z: p.z, color: '#d8d6d0' }));
  }
  if (has('catwalks')) for (const [rad, y] of [[120, 172], [220, 160], [310, 140]]) parts.push(piece(new THREE.TorusGeometry(rad, 1.6, 4, 64), { x: 0, y, z: -200, rx: Math.PI / 2, color: '#e7ebf0' }));
  const jets = [];
  const fountainRow = (a0, a1, n, h) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xe9f5ff, transparent: true, opacity: 0.55, roughness: 0.2, emissive: 0x335a7a, depthWrite: false });
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / Math.max(1, n - 1), p = P(a, fenceDistance(a) + 9);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 1, 8, 1, true), mat);
      m.position.set(p.x, 0, p.z);
      root.add(m);
      jets.push({ m, h, ph: i * 0.7 });
      parts.push(piece(new THREE.BoxGeometry(14, 1.5, 10), { x: p.x, y: 9, z: p.z, ry: faceHome(p.x, p.z), color: '#3d78a8' }));
    }
  };
  if (has('fountains')) { fountainRow(16, 40, 8, 38); fountainRow(-40, -16, 8, 38); }
  if (has('fountain')) { fountainRow(-15, -11, 3, 30); fountainRow(11, 15, 3, 30); }
  if (jets.length) updaters.push((dt, t) => { for (const j of jets) { const k = j.h * (0.75 + 0.25 * Math.sin(t * 1.3 + j.ph)); j.m.scale.y = k; j.m.position.y = 9 + k / 2; } });
  if (has('crown')) {
    const bz = -(fenceDistance(0) + 30);
    for (let i = -3; i <= 3; i++) parts.push(piece(new THREE.ConeGeometry(4, 16, 4), { x: i * 11, y: 78 + (i % 2 ? 0 : 5), z: bz - 1, color: '#d9b23c' }));
    parts.push(piece(new THREE.BoxGeometry(80, 6, 3), { x: 0, y: 72, z: bz - 1, color: '#d9b23c' }));
  }
  if (has('train')) {
    // a locomotive on a track along the top of the left-field stands, running to and fro
    const a0 = -44, a1 = -14, y = topY + 3;
    const track = [];
    for (let a = a0; a <= a1 + 0.01; a += 1) track.push(P(a, outR(a) + 6));
    for (let i = 0; i < track.length - 1; i++) {
      const p = track[i], q = track[i + 1], len = Math.hypot(q.x - p.x, q.z - p.z);
      parts.push(piece(new THREE.BoxGeometry(len + 0.5, 1.4, 9), { x: (p.x + q.x) / 2, y, z: (p.z + q.z) / 2, ry: Math.atan2(-(q.z - p.z), q.x - p.x), color: '#3a3e44' }));
    }
    const loco = new THREE.Group();
    const lm = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.6, metalness: 0.4 });
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 22, 12), lm); boiler.rotation.z = Math.PI / 2; boiler.position.y = 6.5; loco.add(boiler);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 9), lm); cab.position.set(-14, 7.5, 0); loco.add(cab);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.2, 6, 8), lm); stack.position.set(8, 12, 0); loco.add(stack);
    const tender = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 8.5), new THREE.MeshStandardMaterial({ color: 0x7a2a20, roughness: 0.7 })); tender.position.set(-28, 5, 0); loco.add(tender);
    root.add(loco);
    updaters.push((dt, t) => {
      const u = 0.5 + 0.5 * Math.sin(t * 0.06);
      const a = a0 + 4 + (a1 - a0 - 8) * u, p = P(a, outR(a) + 6), q = P(a + 1, outR(a + 1) + 6);
      loco.position.set(p.x, y + 0.7, p.z);
      loco.rotation.y = Math.atan2(-(q.z - p.z), q.x - p.x);
    });
  }
  if (has('rocks')) {
    for (let i = 0; i < 26; i++) {
      const a = 12 + r() * 14, p = P(a, fenceDistance(a) + 6 + r() * 30);
      parts.push(piece(new THREE.DodecahedronGeometry(5 + r() * 9, 0), { x: p.x, y: 4 + r() * 10, z: p.z, ry: r() * TAU, rx: r(), color: ['#8a7d6b', '#776b5a', '#9a8c76'][Math.floor(r() * 3)] }));
    }
    for (let i = 0; i < 4; i++) { const a = 14 + i * 3.5, p = P(a, fenceDistance(a) + 12); tree(p.x, p.z, 40 + r() * 15); }
  }
  if (has('bigA')) {
    const p = P(-52, 1000), ry = faceHome(p.x, p.z);
    const red = '#c8202f';
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = ry;
    const legs = [[-1, 0.2], [1, -0.2]];
    for (const [sx, rz] of legs) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(14, 230, 8), new THREE.MeshStandardMaterial({ color: red, roughness: 0.6 }));
      leg.position.set(sx * 24, 112, 0); leg.rotation.z = rz; g.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(56, 10, 8), new THREE.MeshStandardMaterial({ color: red, roughness: 0.6 })); bar.position.y = 90; g.add(bar);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(26, 3, 6, 28), new THREE.MeshStandardMaterial({ color: 0xffd34a, emissive: 0x5a4300, roughness: 0.4 }));
    halo.position.y = 238; halo.rotation.x = Math.PI / 2; g.add(halo);
    root.add(g);
  }
  if (has('palms')) {
    const n = Math.round(18 * many);
    for (let i = 0; i < n; i++) {
      const a = -55 + (110 * (i + r() * 0.6)) / n;
      if (Math.abs(a) < 9) continue;
      const p = P(a, outR(a) + 12 + r() * 50), h = 55 + r() * 30;
      parts.push(piece(new THREE.CylinderGeometry(1.2, 2, h, 6), { x: p.x, y: h / 2, z: p.z, rz: (r() - 0.5) * 0.12, color: '#8a6e4d' }));
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * TAU;
        parts.push(piece(new THREE.ConeGeometry(2.6, 22, 4), { x: p.x + Math.cos(ang) * 8, y: h - 2, z: p.z + Math.sin(ang) * 8, ry: -ang, rz: Math.PI / 2 - 0.45, color: '#2f6b35' }));
      }
    }
  }
  let celebrate = null;
  if (has('apple')) {
    // the home-run apple: a black top hat just behind the batter's eye (its brim shows over the hedge); the apple waits inside it
    // and only rises out of it after a home run by the home team, then sinks back (`parks.apple`)
    const A = CONFIG.parks.apple;
    const p = P(A.angle, fenceDistance(A.angle) + A.back);
    parts.push(piece(new THREE.CylinderGeometry(A.hatR, A.hatR, A.hatTop, 18), { x: p.x, y: A.hatTop / 2, z: p.z, color: '#141518' }));
    parts.push(piece(new THREE.CylinderGeometry(A.hatR + 6, A.hatR + 6, 1.5, 18), { x: p.x, y: A.hatTop, z: p.z, color: '#141518' }));
    const apple = new THREE.Group();
    const appleMat = new THREE.MeshStandardMaterial({ color: 0xd2232a, roughness: 0.35, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(A.r, 20, 14), appleMat); body.scale.y = 0.92; apple.add(body);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 4, 5), new THREE.MeshStandardMaterial({ color: 0x4a3020 })); stem.position.y = A.r + 1; apple.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 5), new THREE.MeshStandardMaterial({ color: 0x3b8f3a })); leaf.scale.y = 0.35; leaf.rotation.z = 0.5; leaf.position.set(2.4, A.r + 1.5, 0); apple.add(leaf);
    const downY = A.hatTop - A.r - 3, upY = A.hatTop + A.r + 2; // (down: wholly inside the hat; up: sitting clear of the brim)
    apple.position.set(p.x, downY, p.z);
    root.add(apple);
    let since = Infinity;
    celebrate = () => { since = 0; };
    updaters.push((dt) => {
      since += dt;
      const k = since < A.rise ? since / A.rise : since < A.rise + A.stay ? 1 : since < A.rise + A.stay + A.sink ? 1 - (since - A.rise - A.stay) / A.sink : 0;
      const e = k * k * (3 - 2 * k);
      apple.position.y = downY + (upY - downY) * e;
      apple.rotation.y = since < A.rise + A.stay + A.sink ? since * 0.8 : 0;
    });
  }
  if (has('bell')) {
    const p = P(36, outR(36) + 30), y = topY + 60;
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(6 + 12 * Math.pow(t, 2.2), 26 - 26 * t)); }
    const g = piece(new THREE.LatheGeometry(pts, 18), { x: p.x, y, z: p.z, color: '#f4d35e' });
    glowParts.push(g);
    parts.push(piece(new THREE.CylinderGeometry(1, 1, y, 6), { x: p.x, y: y / 2, z: p.z, color: '#4b4f56' }));
  }
  if (has('capitol')) {
    const p = P(-14, 2500);
    parts.push(piece(new THREE.BoxGeometry(420, 90, 120), { x: p.x, y: 45, z: p.z, ry: faceHome(p.x, p.z), color: '#e8e6df' }));
    parts.push(piece(new THREE.CylinderGeometry(52, 58, 70, 18), { x: p.x, y: 125, z: p.z, color: '#eceae3' }));
    parts.push(piece(new THREE.SphereGeometry(55, 18, 10, 0, TAU, 0, Math.PI / 2), { x: p.x, y: 160, z: p.z, sy: 1.25, color: '#f2f0ea' }));
  }
  if (has('rooftops')) {
    // the rooftop bleachers across the street beyond left and right field
    for (const sd of [-1, 1]) {
      for (let a = 20; a <= 52; a += 6.5) {
        const p = P(sd * a, outR(sd * a) + 60), ry = faceHome(p.x, p.z), h = 58 + r() * 14;
        parts.push(piece(new THREE.BoxGeometry(56, h, 46), { x: p.x, y: h / 2, z: p.z, ry, color: ['#8a4b35', '#a0805e', '#6f4a3c', '#c4b9a3'][Math.floor(r() * 4)] }));
        for (let k = 0; k < 4; k++) parts.push(piece(new THREE.BoxGeometry(52, 3, 7), { x: p.x - Math.sin(ry) * (k * 6 - 8), y: h + 2 + k * 3, z: p.z - Math.cos(ry) * (k * 6 - 8), ry, color: k % 2 ? '#2c5a8a' : '#3a3f46' }));
      }
    }
  }
  if (has('smokestacks')) {
    for (const da of [-2.5, 2.5]) {
      const a = 27 + da, p = P(a, fenceDistance(a) + 70);
      parts.push(piece(new THREE.CylinderGeometry(5, 6.5, 90, 12), { x: p.x, y: 45, z: p.z, color: '#f1f1ee' }));
      parts.push(piece(new THREE.CylinderGeometry(5.4, 5.4, 6, 12), { x: p.x, y: 87, z: p.z, color: '#c4202a' }));
    }
  }
  if (has('bridge')) {
    // the yellow suspension bridge across the river beyond right-center field
    const p0 = P(8, 980), p1 = P(62, 1050), cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z), ry = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
    const yellow = '#f2c018';
    parts.push(piece(new THREE.BoxGeometry(len, 8, 34), { x: cx, y: 36, z: cz, ry, color: yellow }));
    const dx = Math.cos(ry), dz = -Math.sin(ry);
    for (const t of [-0.3, 0.3]) parts.push(piece(new THREE.BoxGeometry(8, 90, 34), { x: cx + dx * len * t, y: 45, z: cz + dz * len * t, ry, color: yellow }));
    for (const side of [-15, 15]) {
      const pts = [];
      for (let i = 0; i <= 20; i++) { const t = -0.5 + i / 20; const y = 40 + 50 * Math.pow(Math.abs(t) / 0.5, 2); pts.push(new THREE.Vector3(cx + dx * len * t + Math.sin(ry) * side, Math.min(90, y), cz + dz * len * t + Math.cos(ry) * side)); }
      parts.push(piece(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 1.4, 5), { color: yellow }));
    }
  }
  if (has('arch')) {
    // the Gateway Arch, far beyond center field
    const p = P(-6, 1800), ry = faceHome(p.x, p.z);
    const pts = [];
    const H = 520, W = 260;
    for (let i = 0; i <= 40; i++) {
      const t = -1 + (2 * i) / 40;
      const x = t * W, y = H - H * ((Math.cosh(1.6 * t) - 1) / (Math.cosh(1.6) - 1));
      pts.push(new THREE.Vector3(p.x + Math.cos(ry) * x, y, p.z - Math.sin(ry) * x));
    }
    parts.push(piece(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 16, 6), { color: '#d7dce2' }));
  }
  if (has('pool')) {
    const p = P(24, fenceDistance(24) + 16), ry = faceHome(p.x, p.z), y = 10;
    parts.push(piece(new THREE.BoxGeometry(34, 2, 18), { x: p.x, y, z: p.z, ry, color: '#2fa9d6' }));
    parts.push(piece(new THREE.BoxGeometry(38, 4, 22), { x: p.x, y: y - 2.6, z: p.z, ry, color: '#d9d2c2' }));
  }
  if (has('pines')) {
    for (let i = 0; i < 18; i++) {
      const sd = i % 2 ? 1 : -1, a = sd * (10 + r() * 9), p = P(a, fenceDistance(a) + 6 + r() * 22), h = 26 + r() * 22;
      parts.push(piece(new THREE.ConeGeometry(h * 0.28, h, 7), { x: p.x, y: h / 2 + 2, z: p.z, color: '#1f3d2a' }));
    }
    for (let i = 0; i < 16; i++) { const a = -18 + r() * 36; if (Math.abs(a) < 9.5) continue; const p = P(a, fenceDistance(a) + 4 + r() * 10); parts.push(piece(new THREE.DodecahedronGeometry(3 + r() * 4, 0), { x: p.x, y: 2, z: p.z, ry: r() * TAU, color: '#8f8270' })); }
  }
  if (has('pavilions')) {
    // the wavy pavilion roofs over the outfield bleachers
    for (const sd of [-1, 1]) {
      for (let a = 14; a <= 44; a += 3) {
        const aa = sd * a, p = P(aa, outR(aa) - c.standsDepth * 0.5), ry = faceHome(p.x, p.z);
        parts.push(piece(new THREE.ConeGeometry(14, 9, 4, 1), { x: p.x, y: topY + 6, z: p.z, ry: ry + Math.PI / 4, sx: 1.4, color: '#f4f4f1' }));
      }
    }
  }
  if (has('westernMetal')) {
    const p = P(-46, fenceDistance(-45) + 26), ry = faceHome(p.x, p.z);
    const g = texturedBox(110, 64, 70, 32, { x: p.x, y: 32, z: p.z, ry, color: '#ffffff' });
    root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: brickTexture(true), vertexColors: true, roughness: 0.9 })));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(90, 14), new THREE.MeshStandardMaterial({ map: signTexture('WESTERN METAL SUPPLY CO.', '#f2e6c4', '#2a2420'), side: THREE.DoubleSide }));
    s.position.set(p.x + Math.sin(ry) * 35.5, 54, p.z + Math.cos(ry) * 35.5); s.rotation.y = ry;
    root.add(s);
  }
  if (has('cove')) water(30, 80, 4, 140); // McCovey Cove, right behind the right-field wall
  if (has('bottle')) {
    // the giant bottle with its slides and the old-style glove, in the left-field bleachers
    const p = P(-36, outR(-36) + 18);
    const pts = [];
    const prof = [[0, 0], [11, 0], [12, 10], [10, 26], [12.5, 40], [12, 52], [6, 64], [4.2, 80], [4.6, 84], [0, 84]];
    for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
    parts.push(piece(new THREE.LatheGeometry(pts, 18), { x: p.x, y: topY - 8, z: p.z, color: '#c8202a' }));
    parts.push(piece(new THREE.CylinderGeometry(12.2, 12.2, 8, 18, 1, true), { x: p.x, y: topY - 8 + 33, z: p.z, color: '#f4f4f1' }));
    const q = P(-30, outR(-30) + 22);
    parts.push(piece(new THREE.SphereGeometry(16, 14, 10), { x: q.x, y: topY + 4, z: q.z, sz: 0.5, ry: faceHome(q.x, q.z), color: '#8a5a2b' }));
    for (let k = 0; k < 4; k++) parts.push(piece(new THREE.CapsuleGeometry(3.2, 12, 3, 6), { x: q.x + Math.cos(faceHome(q.x, q.z)) * (k - 1.5) * 6.5, y: topY + 20, z: q.z - Math.sin(faceHome(q.x, q.z)) * (k - 1.5) * 6.5, color: '#8a5a2b' }));
  }

  if (parts.length) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    root.add(mesh);
  }
  if (glowParts.length) {
    const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0xffd36a, emissiveIntensity: 0.1 });
    root.add(new THREE.Mesh(mergeGeometries(glowParts), gm));
    updaters.push((dt, t, env) => { gm.emissiveIntensity = 0.1 + (env ? env.lamps : 0) * 0.9; });
  }
  return { crowdDecks, update(dt, time, env) { for (const u of updaters) u(dt, time, env); }, celebrate() { if (celebrate) celebrate(); } }; // (celebrate: a home run by the home team)
}

/** Shader code for the grass: the park's mowing pattern (0 stripes, 1 checkerboard, 2 diamonds, 3 waves from home, 4 turf). */
export const MOW = { stripes: 0, checker: 1, diamond: 2, waves: 3, turf: 4 };
