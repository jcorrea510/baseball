// Procedural textures. Everything is painted with canvas 2D at start-up; nothing is downloaded.
import * as THREE from 'three';
import { createRng } from '../util/rng.js';

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function toTexture(canvas, { repeat, srgb = true, anisotropy = 8, wrap = false, mipmaps = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (wrap || repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  }
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Tileable value noise (wraps around) returning a Float32Array in 0..1.
function tileNoise(w, h, fx, fy, rng) {
  const lat = new Float32Array(fx * fy);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * fy;
    const y0 = Math.floor(gy);
    const ty = gy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * fx;
      const x0 = Math.floor(gx);
      const tx = gx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = lat[(y0 % fy) * fx + (x0 % fx)];
      const b = lat[(y0 % fy) * fx + ((x0 + 1) % fx)];
      const c = lat[(((y0 + 1) % fy) * fx) + (x0 % fx)];
      const d = lat[(((y0 + 1) % fy) * fx) + ((x0 + 1) % fx)];
      out[y * w + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Seamless grass tile (blades, blotches). Colors are neutral-ish so stripes can tint in the shader.
export function grassTexture(size = 512) {
  const rng = createRng(11);
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const n1 = tileNoise(size, size, 6, 6, rng);
  const n2 = tileNoise(size, size, 24, 24, rng);
  const n3 = tileNoise(size, size, 96, 96, rng);
  const streak = tileNoise(size, size, 128, 10, rng);
  const base = hexToRgb('#3f8a32');
  for (let i = 0; i < size * size; i++) {
    const v = 0.72 + 0.18 * n1[i] + 0.16 * n2[i] + 0.16 * n3[i] + 0.2 * (streak[i] - 0.5);
    const p = i * 4;
    img.data[p] = Math.min(255, base[0] * v * 0.98);
    img.data[p + 1] = Math.min(255, base[1] * v * 1.05);
    img.data[p + 2] = Math.min(255, base[2] * v * 0.85);
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { wrap: true, anisotropy: 12 });
}

// Seamless dirt tile with grit and pebbles.
export function dirtTexture(hex = '#a9714a', size = 512, seed = 5) {
  const rng = createRng(seed);
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const n1 = tileNoise(size, size, 5, 5, rng);
  const n2 = tileNoise(size, size, 32, 32, rng);
  const n3 = tileNoise(size, size, 128, 128, rng);
  const base = hexToRgb(hex);
  for (let i = 0; i < size * size; i++) {
    const v = 0.8 + 0.14 * n1[i] + 0.12 * n2[i] + 0.16 * (n3[i] - 0.5);
    const p = i * 4;
    img.data[p] = Math.min(255, base[0] * v);
    img.data[p + 1] = Math.min(255, base[1] * v);
    img.data[p + 2] = Math.min(255, base[2] * v);
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Pebbles
  for (let i = 0; i < size * 1.4; i++) {
    const x = rng.next() * size, y = rng.next() * size, r = 0.5 + rng.next() * 1.4;
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,235,200,0.18)' : 'rgba(60,35,20,0.22)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(canvas, { wrap: true, anisotropy: 8 });
}

// The infield: a single painted canvas (dirt with soft edges, base cut-outs, plate circle, mound circle).
// Field extent covered: x in [-120,120], z in [-165, 45] feet. Returns { texture, bounds }.
export const INFIELD_BOUNDS = { x0: -120, x1: 120, z0: -165, z1: 45 };
export function infieldTexture(dirtHex = '#a9714a') {
  const { x0, x1, z0, z1 } = INFIELD_BOUNDS;
  const pxPerFt = 8.5;
  const w = Math.round((x1 - x0) * pxPerFt);
  const h = Math.round((z1 - z0) * pxPerFt);
  const { canvas, ctx } = makeCanvas(w, h);
  const X = (x) => (x - x0) * pxPerFt;
  const Z = (z) => (z - z0) * pxPerFt;
  const S = (f) => f * pxPerFt;
  const rng = createRng(21);

  // --- dirt mask (white where dirt) ---
  const mask = makeCanvas(w, h);
  const m = mask.ctx;
  m.fillStyle = '#000'; m.fillRect(0, 0, w, h);
  m.fillStyle = '#fff';
  // Infield "skin": circle of radius 95 ft around the pitching rubber clipped to the fair wedge.
  m.save();
  m.beginPath();
  m.moveTo(X(0), Z(0));
  m.lineTo(X(-220), Z(-220));
  m.lineTo(X(220), Z(-220));
  m.closePath();
  // wedge (foul lines at 45 degrees) extended beyond the arc, then intersected with the circle
  m.clip();
  m.beginPath(); m.arc(X(0), Z(-60.5), S(95), 0, Math.PI * 2); m.fill();
  m.restore();
  // Home plate circle
  m.beginPath(); m.arc(X(0), Z(0), S(13), 0, Math.PI * 2); m.fill();
  // Catcher's box / area behind plate
  m.beginPath(); m.ellipse(X(0), Z(5.5), S(11), S(11), 0, 0, Math.PI * 2); m.fill();
  // Baselines (dirt paths, 6 ft wide) are inside the skin already; add path from home along lines
  m.lineWidth = S(6); m.lineCap = 'round'; m.strokeStyle = '#fff';
  const B = 90 / Math.SQRT2;
  m.beginPath(); m.moveTo(X(0), Z(0)); m.lineTo(X(B), Z(-B)); m.lineTo(X(0), Z(-2 * B)); m.lineTo(X(-B), Z(-B)); m.closePath(); m.stroke();
  // Grass diamond cut out of the middle
  m.fillStyle = '#000';
  const gi = 9.5; // grass edge distance from the base paths
  m.beginPath();
  // inner diamond: inset from base path by gi ft (perpendicular). Corner offsets along the diagonals.
  const k = gi * Math.SQRT2;
  m.moveTo(X(0), Z(-k * 1.0 - 8)); // near home
  m.lineTo(X(B - k), Z(-B));
  m.lineTo(X(0), Z(-2 * B + k));
  m.lineTo(X(-B + k), Z(-B));
  m.closePath();
  m.fill();
  // rounded look: dirt cut-outs around bases and mound
  m.fillStyle = '#fff';
  for (const [bx, bz, r] of [[B, -B, 9], [0, -2 * B, 9], [-B, -B, 9], [0, -60.5, 9.5]]) {
    m.beginPath(); m.arc(X(bx), Z(bz), S(r), 0, Math.PI * 2); m.fill();
  }
  // Soften edges
  const soft = makeCanvas(w, h);
  soft.ctx.filter = 'blur(' + Math.round(S(0.55)) + 'px)';
  soft.ctx.drawImage(mask.canvas, 0, 0);
  const maskData = soft.ctx.getImageData(0, 0, w, h).data;

  // --- dirt colour with noise ---
  const dirt = makeCanvas(w, h);
  const dctx = dirt.ctx;
  const dImg = dctx.createImageData(w, h);
  const base = hexToRgb(dirtHex);
  const nA = tileNoise(w, h, 9, 8, rng);
  const nB = tileNoise(w, h, 64, 56, rng);
  const nC = tileNoise(w, h, 420, 360, rng);
  for (let i = 0; i < w * h; i++) {
    const v = 0.86 + 0.16 * nA[i] + 0.1 * nB[i] + 0.12 * (nC[i] - 0.5);
    const p = i * 4;
    dImg.data[p] = Math.min(255, base[0] * v);
    dImg.data[p + 1] = Math.min(255, base[1] * v);
    dImg.data[p + 2] = Math.min(255, base[2] * v);
    dImg.data[p + 3] = maskData[p]; // red channel of blurred mask -> alpha
  }
  dctx.putImageData(dImg, 0, 0);
  // Worn spots: batter's boxes, mound front, around bases, lighter raked arcs
  dctx.globalCompositeOperation = 'source-atop';
  const wear = (cx, cz, rx, rz, a) => {
    const g = dctx.createRadialGradient(X(cx), Z(cz), 0, X(cx), Z(cz), S(Math.max(rx, rz)));
    g.addColorStop(0, `rgba(70,40,22,${a})`); g.addColorStop(1, 'rgba(70,40,22,0)');
    dctx.save(); dctx.translate(X(cx), Z(cz)); dctx.scale(rx / Math.max(rx, rz), rz / Math.max(rx, rz)); dctx.translate(-X(cx), -Z(cz));
    dctx.fillStyle = g; dctx.beginPath(); dctx.arc(X(cx), Z(cz), S(Math.max(rx, rz)), 0, Math.PI * 2); dctx.fill(); dctx.restore();
  };
  wear(-3.2, -0.6, 4.5, 5, 0.35); wear(3.2, -0.6, 4.5, 5, 0.3); wear(0, 2.5, 5, 5, 0.25);
  wear(0, -58.5, 5.5, 4, 0.3); wear(B, -B, 5, 5, 0.28); wear(0, -2 * B, 5, 5, 0.28); wear(-B, -B, 5, 5, 0.28);
  // Rake lines
  dctx.strokeStyle = 'rgba(255,225,190,0.045)'; dctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const cx = X(0), cz = Z(-60.5), r = S(20 + rng.next() * 75);
    const a0 = rng.range(-2.4, -0.7), a1 = a0 + rng.range(0.1, 0.5);
    dctx.beginPath(); dctx.arc(cx, cz, r, a0, a1); dctx.stroke();
  }
  dctx.globalCompositeOperation = 'source-over';

  const tex = toTexture(dirt.canvas, { anisotropy: 16 });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { texture: tex, bounds: INFIELD_BOUNDS };
}

// Outfield wall texture: padded green panels, distance numbers, fictional sponsor boards.
// markers: [{ s: arc-length position in ft, text: '390' }]
export function wallTexture(lengthFt, heightFt, markers = [], color = '#0f3d24', style = null) {
  const w = 4096, h = 256;
  const { canvas, ctx } = makeCanvas(w, h);
  const sx = w / lengthFt, sy = h / heightFt;
  ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
  if (style === 'ivy' || style === 'brick') {
    // Wrigley's ivy over brick (no signs on it), or a plain brick wall
    for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? -10 : 0; x < w; x += 20) {
      const v = Math.random() * 0.2;
      ctx.fillStyle = `rgb(${Math.round(120 - v * 150)},${Math.round(58 - v * 60)},${Math.round(42 - v * 45)})`;
      ctx.fillRect(x + 1, y + 1, 18, 6);
    }
    if (style === 'ivy') {
      for (let i = 0; i < 26000; i++) {
        const x = Math.random() * w, y = Math.random() * h * 1.05 - 6, r = 3 + Math.random() * 6, v = Math.random();
        ctx.fillStyle = `rgb(${Math.round(22 + v * 40)},${Math.round(70 + v * 70)},${Math.round(22 + v * 30)})`;
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const m of markers) {
      ctx.save();
      ctx.translate(m.s * sx, 0.42 * h);
      ctx.scale(sx / sy, 1);
      ctx.fillStyle = style === 'ivy' ? '#f4f4f0' : '#f2e6c4';
      ctx.font = `900 ${Math.round(3.2 * sy)}px "Arial Black", Impact, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.text, 0, 0);
      ctx.restore();
    }
    const g = ctx.createLinearGradient(0, h * 0.8, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.8, w, h * 0.2);
    return toTexture(canvas, { anisotropy: 8 });
  }
  // padded panels (a touch lighter and darker than the wall colour)
  const shade = (k) => { const n = parseInt(color.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0'); return '#' + f((n >> 16) & 255) + f((n >> 8) & 255) + f(n & 255); };
  const panelA = shade(1.14), panelB = shade(0.92);
  for (let x = 0; x < lengthFt; x += 8) {
    ctx.fillStyle = (Math.floor(x / 8) % 2) ? panelA : panelB;
    ctx.fillRect(x * sx, 0, 8 * sx, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x * sx, 0, 1.4, h);
  }
  const sponsors = [
    ['BRIGHTWATER BANK', '#f4e6b8', '#1b2f66'],
    ['SANDLOT SODA', '#ffffff', '#c0322b'],
    ['NORTHGATE MOTORS', '#111111', '#f0c419'],
    ['HARBOR & CO', '#ffffff', '#0c6b8a'],
    ['IRONVALE STEEL', '#f2f2f2', '#3b3f45'],
    ['LAKESHORE DAIRY', '#ffffff', '#2a7d3f'],
    ['PRAIRIE PIZZA', '#fff4d6', '#a3311d'],
    ['SUNPORT AIR', '#ffffff', '#3557c9'],
  ];
  const boardW = 28, boardH = 3.2;
  let si = 0;
  const nearMarker = (x0, x1) => markers.some((m) => m.s > x0 - 10 && m.s < x1 + 10);
  for (let x = 6; x < lengthFt - 34; x += boardW + 9) {
    if (nearMarker(x, x + boardW)) continue;
    const [txt, fg, bg] = sponsors[si++ % sponsors.length];
    const bx = x * sx, by = 1.1 * sy, bw = boardW * sx, bh = boardH * sy;
    ctx.fillStyle = bg; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(bx, by, bw, bh * 0.14);
    ctx.save();
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(sx / sy, 1);
    ctx.fillStyle = fg;
    ctx.font = `800 ${Math.round(bh * 0.52)}px "Arial Black", Impact, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, 0, 2);
    ctx.restore();
  }
  // distance markers (white numerals on the padding)
  for (const m of markers) {
    ctx.save();
    ctx.translate(m.s * sx, 0.5 * h + 0.9 * sy);
    ctx.scale(sx / sy, 1);
    ctx.fillStyle = '#f4f4f0';
    ctx.font = `900 ${Math.round(3.6 * sy)}px "Arial Black", Impact, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.text, 0, 0);
    ctx.restore();
  }
  // top yellow line (home-run line) and bottom shadow
  ctx.fillStyle = '#f5d523'; ctx.fillRect(0, 0, w, 0.5 * sy);
  const g = ctx.createLinearGradient(0, h * 0.75, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.75, w, h * 0.25);
  return toTexture(canvas, { anisotropy: 8 });
}

// Stand seats: a repeating cell (tread on the lower 40%, seat backs on the upper 60%).
export function seatTexture() {
  const { canvas, ctx } = makeCanvas(256, 128);
  ctx.fillStyle = '#5b5e63'; ctx.fillRect(0, 0, 256, 128);
  // tread (bottom of image = v small): canvas y grows downward; texture v=0 is the bottom.
  const treadH = 128 * 0.4;
  ctx.fillStyle = '#6d7075'; ctx.fillRect(0, 128 - treadH, 256, treadH);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 128 - treadH, 256, 3);
  // seat backs
  const seats = 8;
  for (let i = 0; i < seats; i++) {
    const x = (i / seats) * 256;
    ctx.fillStyle = '#e7e7e2';
    ctx.fillRect(x + 2, 6, 256 / seats - 4, 128 - treadH - 10);
    const g = ctx.createLinearGradient(0, 6, 0, 128 - treadH);
    g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g; ctx.fillRect(x + 2, 6, 256 / seats - 4, 128 - treadH - 10);
  }
  return toTexture(canvas, { wrap: true, anisotropy: 4 });
}

// Soft round sprite (dust, glow, flares).
export function softDotTexture(size = 128, inner = 0.0, color = '255,255,255') {
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(0.35, `rgba(${color},0.55)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { anisotropy: 1 });
}

// Crowd figure mask: R = shirt, G = skin, B = hair; alpha = silhouette.
export function crowdMaskTexture() {
  const { canvas, ctx } = makeCanvas(64, 96);
  ctx.clearRect(0, 0, 64, 96);
  // body / shoulders (shirt = red channel)
  ctx.fillStyle = 'rgb(255,0,0)';
  ctx.beginPath();
  ctx.moveTo(8, 96); ctx.lineTo(8, 60); ctx.quadraticCurveTo(10, 44, 32, 42); ctx.quadraticCurveTo(54, 44, 56, 60); ctx.lineTo(56, 96); ctx.closePath();
  ctx.fill();
  // neck + head (skin = green channel)
  ctx.fillStyle = 'rgb(0,255,0)';
  ctx.fillRect(27, 34, 10, 12);
  ctx.beginPath(); ctx.ellipse(32, 24, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
  // hair cap (blue channel)
  ctx.fillStyle = 'rgb(0,0,255)';
  ctx.beginPath(); ctx.ellipse(32, 17, 12.5, 9.5, 0, Math.PI, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// Baseball: white leather with red stitching (equirectangular).
export function ballTexture() {
  const { canvas, ctx } = makeCanvas(512, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#f6f3ea'); g.addColorStop(1, '#e6e0d0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
  // Two seam curves (approximation of the baseball seam) and stitches.
  ctx.strokeStyle = '#d02424'; ctx.lineWidth = 4; // (bold seams and stitches: the spin is easy to read - a curveball tumbles, a fastball's seams stream)
  const seam = (phase) => {
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      const x = u * 512;
      const y = 128 + Math.sin((u * 2 + phase) * Math.PI * 2) * 70;
      pts.push([x, y]);
    }
    return pts;
  };
  for (const ph of [0, 0.5]) {
    const pts = seam(ph);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    for (let i = 0; i < pts.length - 1; i += 2) {
      const a = pts[i], b = pts[i + 1];
      const nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      ctx.beginPath();
      ctx.moveTo(a[0] - (nx / l) * 8, a[1] - (ny / l) * 8);
      ctx.lineTo(a[0] + (nx / l) * 8, a[1] + (ny / l) * 8);
      ctx.stroke();
    }
  }
  return toTexture(canvas, { anisotropy: 4 });
}

// Jersey (torso) texture: team colour, piping, chest lettering, back number.
// u wraps around the torso; front is at u=0.75 and back at u=0.25 for our torso mesh.
export function jerseyTexture({ primary, secondary, trim, text = '', number = 0, stripe = false, mirror = false }) {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = primary; ctx.fillRect(0, 0, 256, 256);
  if (stripe) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let x = 0; x < 256; x += 12) ctx.fillRect(x, 0, 2, 256);
  }
  // front placket / piping
  ctx.fillStyle = secondary; ctx.fillRect(63, 0, 2, 256);
  ctx.fillStyle = trim; ctx.fillRect(61, 0, 2, 256); ctx.fillRect(65, 0, 2, 256);
  // chest text (the capsule's front (+z) is at u=0.25 -> x=64)
  ctx.save();
  ctx.fillStyle = secondary; ctx.strokeStyle = trim; ctx.lineWidth = 3;
  ctx.font = '900 30px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeText(text, 64, 96); ctx.fillText(text, 64, 96);
  ctx.restore();
  // back number (u=0.75 -> x=192)
  ctx.save();
  ctx.fillStyle = secondary; ctx.strokeStyle = trim; ctx.lineWidth = 5;
  ctx.font = '900 84px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeText(String(number), 192, 150); ctx.fillText(String(number), 192, 150);
  ctx.restore();
  // collar / hem shading
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.15, 'rgba(0,0,0,0)'); g.addColorStop(0.85, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  if (mirror) {
    // left-handed batter: the whole figure is mirrored (left-right), so pre-flip the artwork to read correctly. The flip is about
    // the FRONT of the shirt (u = 0.25), so the name stays on the chest and the number on the back: u -> 0.5 - u (wrapping round).
    const m = makeCanvas(256, 256);
    for (const off of [128, 384]) { m.ctx.setTransform(-1, 0, 0, 1, off, 0); m.ctx.drawImage(canvas, 0, 0); }
    m.ctx.setTransform(1, 0, 0, 1, 0, 0);
    return toTexture(m.canvas, { anisotropy: 4 });
  }
  return toTexture(canvas, { anisotropy: 4 });
}
