// The head of a player (rig.js headG space: the face toward +z, the skull's middle ~0.14 ft up), made in code: a sculpted skull, the
// features placed ON its surface, and everything that sits on the head - hair, facial hair, the cap and its bill, the batting helmet -
// as thin shells that follow the skull's own surface a set distance out (so nothing floats and no two surfaces ever coincide).
// Geometry only (no game logic). Parts are { geo, color, x, y, z, rx, ry, rz, sx, sy, sz, mat, paint } for rig.js mergeParts.
import * as THREE from 'three';
import { loft, ringPoint, cr } from './anatomy.js';

const cache = new Map();
const cached = (key, make) => cache.get(key) || cache.set(key, make()).get(key);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const PI = Math.PI;

// ---------------------------------------------------------------------------------------------------------------- the skull
/**
 * The skull's cross-sections from the chin up (see anatomy.loft; `n` > 2 = flatter in front, squarer at the sides, like a real head).
 * `face` (0..1, from the player's name) varies the jaw, the chin and the brow a little: the players are not twins.
 */
export function skullRings(face = 0.5) {
  const f2 = (face * 7.31) % 1, f3 = (face * 13.7) % 1;
  const jaw = 1 + (face - 0.5) * 0.16, chin = 1 + (f2 - 0.5) * 0.3, brow = 1 + (f3 - 0.5) * 0.6;
  return [
    { y: -0.205, rx: 0.07 * jaw, rz: 0.06, z: 0.18 + 0.012 * chin },
    { y: -0.175, rx: 0.13 * jaw, rz: 0.14, z: 0.12 + 0.01 * chin, n: 2.3, bumps: [{ a: 0, w: 0.5, h: 0.1 * chin }] }, // chin
    { y: -0.115, rx: 0.188 * jaw, rz: 0.235, z: 0.055, n: 2.5, bumps: [{ a: 0, w: 0.45, h: 0.06 * chin }, { a: 1.7, w: 0.5, h: 0.05 * jaw }, { a: -1.7, w: 0.5, h: 0.05 * jaw }] }, // jaw line, its corners
    { y: -0.04, rx: 0.215 * jaw, rz: 0.285, z: 0.03, n: 2.6 },
    { y: 0.04, rx: 0.232, rz: 0.31, z: 0.02, n: 2.7, bumps: [{ a: 0.85, w: 0.45, h: 0.025 }, { a: -0.85, w: 0.45, h: 0.025 }] },
    { y: 0.115, rx: 0.247, rz: 0.325, z: 0.012, n: 2.7, bumps: [{ a: 0.75, w: 0.42, h: 0.05 }, { a: -0.75, w: 0.42, h: 0.05 }] }, // cheekbones
    { y: 0.2, rx: 0.255, rz: 0.338, z: 0.004, n: 2.6, bumps: [{ a: 0.31, w: 0.24, h: -0.05 }, { a: -0.31, w: 0.24, h: -0.05 }, { a: PI, w: 1.2, h: 0.02 }] }, // eye sockets
    { y: 0.282, rx: 0.264, rz: 0.35, n: 2.4, bumps: [{ a: 0, w: 0.95, h: 0.03 * brow }, { a: PI, w: 1.3, h: 0.045 }] }, // brow ridge, the back of the skull
    { y: 0.4, rx: 0.262, rz: 0.345, z: -0.01, n: 2.2, bumps: [{ a: PI, w: 1.2, h: 0.03 }] },
    { y: 0.485, rx: 0.218, rz: 0.295, z: -0.02 },
    { y: 0.545, rx: 0.115, rz: 0.155, z: -0.02 },
  ].map((r) => ({ ...r, rx: r.rx * 1.06 }));
}

/** A sampler of the skull's surface (exactly the surface loft() builds, between its columns): by height y and angle th round it. */
export function skullSurface(rings) {
  const n = rings.length;
  const ys = rings.map((r) => r.y);
  const yAt = (s) => { const i = Math.min(n - 2, Math.max(0, Math.floor(s))), t = s - i; return cr(ys[Math.max(0, i - 1)], ys[i], ys[i + 1], ys[Math.min(n - 1, i + 2)], t); };
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
  const P = (s, th, out = [0, 0, 0]) => {
    s = Math.max(0, Math.min(n - 1, s));
    const i = Math.min(n - 2, Math.floor(s)), t = s - i;
    ringPoint(rings[Math.max(0, i - 1)], th, a); ringPoint(rings[i], th, b); ringPoint(rings[i + 1], th, c); ringPoint(rings[Math.min(n - 1, i + 2)], th, d);
    for (let q = 0; q < 3; q++) out[q] = cr(a[q], b[q], c[q], d[q], t);
    return out;
  };
  const sAt = (y) => { // (the rings climb: y(s) only goes up)
    if (y <= ys[0]) return 0;
    if (y >= ys[n - 1]) return n - 1;
    let lo = 0, hi = n - 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (yAt(m) < y) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const centre = (s) => { const i = Math.min(n - 2, Math.max(0, Math.floor(s))), t = s - i; return [lerp(rings[i].x || 0, rings[i + 1].x || 0, t), lerp(rings[i].z || 0, rings[i + 1].z || 0, t)]; };
  const p1 = [0, 0, 0], p2 = [0, 0, 0], p3 = [0, 0, 0], p4 = [0, 0, 0];
  /** { p: [x, y, z], n: the outward normal } at (s, th). */
  const atS = (s, th) => {
    const e = 0.01;
    const p = P(s, th);
    P(Math.min(n - 1, s + e), th, p1); P(Math.max(0, s - e), th, p2); P(s, th + e, p3); P(s, th - e, p4);
    const ds = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]], dt = [p3[0] - p4[0], p3[1] - p4[1], p3[2] - p4[2]];
    let nx = dt[1] * ds[2] - dt[2] * ds[1], ny = dt[2] * ds[0] - dt[0] * ds[2], nz = dt[0] * ds[1] - dt[1] * ds[0];
    const [cx, cz] = centre(s);
    if (nx * (p[0] - cx) + nz * (p[2] - cz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    return { p, n: [nx / L, ny / L, nz / L] };
  };
  const top = rings[n - 1];
  const pole = [top.x || 0, top.y + 0.3 * (top.rx + top.rz) / 2, top.z || 0];
  return { P, sAt, atS, at: (y, th) => atS(sAt(y), th), pole, rings, yTop: ys[n - 1], yBottom: ys[0] };
}

/**
 * A thin shell over the skull: for each column at angle th (from a0 to a1) it covers the skull from height lo(th) up to hi(th) (or to the
 * crown when `top`), `off(f, th)` ft out along the surface (f = 0 at its lower edge, 1 at its upper edge), moved by `push(f, th)` ->
 * [dx, dy, dz] (a beard hanging below the chin). Its edges turn in under the surface (a rim `rim` ft inside it), so the edge has a
 * little thickness and never a gap. Columns `cols`, rows `rows`. Cached by `key`.
 */
export function shell(surf, o) {
  return cached(o.key, () => {
    const { a0, a1, lo, hi, off, push = null, top = false, rows, cols, rim = 0.01, uScale = 1 } = o;
    const R = rows + 1 + (top ? 1 : 0), C = cols + 1;
    const RR = R + 2, CC = C + 2; // + the rim rows / columns
    const pos = new Float32Array(RR * CC * 3), uv = new Float32Array(RR * CC * 2);
    const put = (ri, ci, x, y, z, u, v) => { const k = ri * CC + ci; pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; uv[k * 2] = u; uv[k * 2 + 1] = v; };
    for (let cj = 0; cj < CC; cj++) {
      const j = Math.max(0, Math.min(C - 1, cj - 1));
      const th = a0 + ((a1 - a0) * j) / cols;
      const edgeCol = cj === 0 || cj === CC - 1;
      const yl = lo(th), yh = top ? surf.yTop : hi(th);
      for (let ri = 0; ri < RR; ri++) {
        const i = Math.max(0, Math.min(R - 1, ri - 1));
        const edge = edgeCol || ri === 0 || (ri === RR - 1 && !top);
        const u = (j / cols) * uScale;
        if (top && i === R - 1) { // the crown: one point
          const d = edge ? -rim : off(1, th);
          put(ri, cj, surf.pole[0], surf.pole[1] + d, surf.pole[2], u, 1);
          continue;
        }
        const f = Math.min(1, i / rows);
        const y = lerp(yl, yh, f);
        const { p, n } = surf.at(y, th);
        const d = edge ? -rim : off(f, th);
        const m = !edge && push ? push(f, th) : null;
        put(ri, cj, p[0] + n[0] * d + (m ? m[0] : 0), p[1] + n[1] * d + (m ? m[1] : 0), p[2] + n[2] * d + (m ? m[2] : 0), u, f);
      }
    }
    const idx = [];
    for (let ri = 0; ri < RR - 1; ri++) for (let cj = 0; cj < CC - 1; cj++) {
      const a = ri * CC + cj, b = a + CC, c = b + 1, d = a + 1;
      idx.push(a, d, b, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // face it outward: the normal in the middle must point away from the skull
    const mid = Math.floor(RR / 2) * CC + Math.floor(CC / 2);
    const nor = g.getAttribute('normal');
    const pm = [pos[mid * 3], pos[mid * 3 + 1], pos[mid * 3 + 2]];
    const sN = surf.at(pm[1], Math.atan2(pm[0], pm[2] - 0.01)).n;
    if (nor.getX(mid) * sN[0] + nor.getY(mid) * sN[1] + nor.getZ(mid) * sN[2] < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    g.computeBoundingSphere();
    return g;
  });
}

// A smooth bumpy number from an angle and a height (beards are clumpy, hair is uneven): -1..1, the same every time.
const wobble = (th, f, k) => 0.5 * Math.sin(th * 9.1 + k * 1.7 + f * 3.3) + 0.3 * Math.sin(th * 17.3 - f * 7.9 + k) + 0.2 * Math.sin(th * 31 + f * 13 + k * 2.3);

// ---------------------------------------------------------------------------------------------------------------- facial hair
// Where facial hair grows (the same map for real hair and for stubble paint): x = |th|, the angle away from the front.
// The lower edge of the mustache and the upper edge of the beard leave the lips bare.
const beardTop = (ax, style) => { // the beard's upper edge on the face (the cheek line), from the chin round to the sideburn
  const lift = style === 'full' ? 0.03 : 0;
  if (ax < 0.23) return -0.06;
  if (ax < 0.38) return lerp(-0.06, 0.035, smooth(0.23, 0.38, ax));
  if (ax < 1.42) return lerp(0.045, 0.2, Math.pow(smooth(0.38, 1.42, ax), 0.85)) + lift * smooth(0.45, 0.9, ax);
  return lerp(0.2 + lift * 0.4, 0.245, smooth(1.42, 1.62, ax));
};
const mustacheLo = (ax) => 0.018 - 0.034 * smooth(0.12, 0.42, ax);
const mustacheHi = (ax) => 0.064 - 0.03 * Math.pow(ax / 0.42, 2);
/** How much a point of the face (head space) is in the beard area (0..1; style 'stubble' covers the area of a short beard). */
export function beardCover(x, y, z, style) {
  if (style === 'none') return 0;
  const th = Math.atan2(x, z - 0.02), ax = Math.abs(th);
  const soft = 0.02;
  const mus = ax < 0.44 ? smooth(mustacheLo(ax) - soft, mustacheLo(ax), y) * (1 - smooth(mustacheHi(ax), mustacheHi(ax) + soft, y)) * (1 - smooth(0.36, 0.44, ax)) : 0;
  if (style === 'mustache') return mus;
  if (style === 'goatee') {
    const chinTop = ax < 0.22 ? -0.06 : lerp(-0.06, 0.03, smooth(0.22, 0.4, ax));
    return Math.max(mus, (1 - smooth(chinTop, chinTop + soft, y)) * (1 - smooth(0.36, 0.44, ax)));
  }
  const jaw = (1 - smooth(beardTop(ax, style) - 0.005, beardTop(ax, style) + soft, y)) * (1 - smooth(1.55, 1.68, ax));
  return Math.max(mus, jaw);
}

/**
 * Facial hair as shells on the skull: style 'mustache' | 'goatee' | 'short' | 'full' ('none' / 'stubble' = nothing: stubble is paint).
 * Fewer columns and rows at low detail.
 */
export function beardParts(surf, { style, color, dl, q }) {
  if (style === 'none' || style === 'stubble') return [];
  const fine = dl > 0.7;
  const k = (name) => `beard|${name}|${q}|${fine ? 1 : 0}`;
  const parts = [];
  const shade = (hex, f) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();
  // (the hair is a little lighter at its tips and darker at the roots: vertex colour from how far out it is)
  const paint = (x, y, z) => { const w = 1 + 0.12 * Math.sin(x * 90 + y * 70) * Math.sin(z * 80 - y * 40); return [w, w, w]; };
  const thick = { mustache: 0.016, goatee: 0.02, short: 0.016, full: 0.034 }[style];
  // the mustache
  const mt = style === 'full' ? 0.022 : style === 'mustache' ? 0.018 : 0.015;
  parts.push({
    geo: shell(surf, {
      key: k('mus' + style), a0: -0.42, a1: 0.42, cols: fine ? 18 : 8, rows: fine ? 5 : 3, rim: 0.008,
      lo: (th) => mustacheLo(Math.abs(th)), hi: (th) => mustacheHi(Math.abs(th)),
      off: (f, th) => 0.006 + mt * (1 - Math.pow(Math.abs(th) / 0.42, 2)) * (0.55 + 0.45 * Math.sin(PI * Math.min(1, f * 1.15))) * (1 + 0.15 * wobble(th, f, 1)),
      push: (f, th) => [0, -0.01 * (1 - f) * (1 - Math.abs(th) / 0.42), 0],
    }), color, mat: 'hair', paint,
  });
  if (style === 'mustache') return parts;
  if (style === 'goatee') {
    const chinTop = (ax) => (ax < 0.22 ? -0.06 : lerp(-0.06, 0.028, smooth(0.22, 0.4, ax)));
    parts.push({
      geo: shell(surf, {
        key: k('goatee'), a0: -0.42, a1: 0.42, cols: fine ? 18 : 8, rows: fine ? 9 : 4, rim: 0.008,
        lo: () => surf.yBottom, hi: (th) => chinTop(Math.abs(th)),
        off: (f, th) => 0.006 + thick * (1 - 0.5 * Math.pow(Math.abs(th) / 0.42, 4)) * (0.6 + 0.4 * Math.sin(PI * Math.min(1, 0.25 + f))) * (1 + 0.18 * wobble(th, f, 2)),
        push: (f, th) => [0, -0.012 * Math.pow(1 - f, 2) * (1 - Math.abs(th) / 0.5), 0.008 * (1 - f)],
      }), color: shade(color, 1.03), mat: 'hair', paint,
    });
    return parts;
  }
  // a short or full beard: the jaw from ear to ear, up the cheeks to the sideburns
  const full = style === 'full';
  const drop = full ? 0.07 : 0.018;
  parts.push({
    geo: shell(surf, {
      key: k('jaw' + style), a0: -1.64, a1: 1.64, cols: fine ? 44 : 18, rows: fine ? 12 : 5, rim: 0.01,
      lo: () => surf.yBottom, hi: (th) => beardTop(Math.abs(th), style),
      off: (f, th) => {
        const ax = Math.abs(th);
        const edge = (0.35 + 0.65 * smooth(1, 0.72, f)) * (0.45 + 0.55 * smooth(1.64, 1.4, ax));
        return 0.007 + thick * edge * (1 + (full ? 0.25 : 0.15) * wobble(th, f, 3)) * (full ? 1 - 0.35 * smooth(0.6, 1.4, ax) * f : 1);
      },
      push: (f, th) => { const ax = Math.abs(th), w = Math.pow(Math.max(0, 1 - f / 0.45), 2) * smooth(1.5, 0.4, ax); return [0, -drop * w, drop * 0.45 * w]; },
    }), color, mat: 'hair', paint,
  });
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------- hair
const hairLine = (ax) => { // the lower edge of the hair round the head (the hairline, round the ears, the nape)
  if (ax < 0.9) return 0.42;
  if (ax < 1.28) return lerp(0.42, 0.29, smooth(0.9, 1.28, ax));
  if (ax < 1.44) return lerp(0.29, 0.17, smooth(1.28, 1.42, ax)); // the sideburn
  if (ax < 1.52) return lerp(0.17, 0.27, smooth(1.44, 1.52, ax));
  if (ax < 1.9) return 0.27; // over the ear
  return lerp(0.27, -0.035, smooth(1.9, 2.45, ax)); // behind the ear down to the nape
};
/** The hair on the head (under the cap it only shows at the sides and the back): a shell with an uneven surface; `long` adds hair
 * that falls behind the neck. */
export function hairParts(surf, { color, dl, long, q }) {
  const fine = dl > 0.7;
  const parts = [{
    geo: shell(surf, {
      key: `hair|${q}|${fine ? 1 : 0}`, a0: -PI, a1: PI, cols: fine ? 80 : 28, rows: fine ? 10 : 5, top: true, rim: 0.008,
      lo: (th) => hairLine(Math.abs(th)), off: (f, th) => 0.012 + 0.006 * f + 0.004 * wobble(th, f, 5) * smooth(0, 0.3, f),
    }), color, mat: 'hair',
  }];
  if (long) {
    // hair falling from under the cap at the back down to the collar (it sits behind the neck; its front is inside the head)
    const rings = [
      { y: 0.2, rx: 0.24, rz: 0.2, z: -0.1 },
      { y: 0.05, rx: 0.25, rz: 0.2, z: -0.13 },
      { y: -0.12, rx: 0.23, rz: 0.15, z: -0.16, bumps: [{ a: PI, w: 1.2, h: 0.08 }] },
      { y: -0.3, rx: 0.2, rz: 0.1, z: -0.2, bumps: [{ a: PI, w: 1.1, h: 0.15 }] },
      { y: -0.38, rx: 0.16, rz: 0.06, z: -0.22 },
    ];
    parts.push({ geo: loft(rings, { seg: fine ? 16 : 8, sub: fine ? 2 : 1, dome: 0.3, key: `longhair|${fine ? 1 : 0}` }), color, mat: 'hair' });
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------- the cap and the helmet
const capEdge = (th) => 0.2 + 0.105 * Math.pow((1 + Math.cos(th)) / 2, 1.25); // the cap's lower edge: on the forehead, over the ears, the back
/**
 * A plate (the bill of a cap or a helmet) along an arc of the head's front: its back edge follows `root(u)` (u -1..1 across) and its
 * front edge `tip(u)`; `thick` ft thick. Two surfaces (top `color`, underside `under`) and the front edge.
 */
function billGeometry(key, root, tip, thick, U, V, part) {
  return cached(key + '|' + part, () => {
    const pos = [], idx = [];
    const rowsTop = [], rowsBot = [];
    for (let s = 0; s <= 1; s++) {
      const rows = s ? rowsBot : rowsTop;
      for (let i = 0; i <= U; i++) {
        const u = -1 + (2 * i) / U, r = root(u), t = tip(u);
        const row = [];
        for (let j = 0; j <= V; j++) {
          const v = j / V, arch = Math.sin(PI * v) * 0.01;
          const x = lerp(r[0], t[0], v), y = lerp(r[1], t[1], v) + arch - (s ? thick * (1 - 0.4 * v) : 0), z = lerp(r[2], t[2], v);
          row.push(pos.length / 3); pos.push(x, y, z);
        }
        rows.push(row);
      }
    }
    for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
      if (part === 'top') { const a = rowsTop[i][j], b = rowsTop[i + 1][j], c = rowsTop[i + 1][j + 1], d = rowsTop[i][j + 1]; idx.push(a, d, b, b, d, c); }
      else { const A = rowsBot[i][j], B = rowsBot[i + 1][j], C2 = rowsBot[i + 1][j + 1], D = rowsBot[i][j + 1]; idx.push(A, B, D, B, C2, D); }
    }
    if (part === 'top') for (let i = 0; i < U; i++) { // the front edge
      const a = rowsTop[i][V], b = rowsTop[i + 1][V], c = rowsBot[i + 1][V], d = rowsBot[i][V];
      idx.push(a, b, d, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // the top must face up (+y) and the underside down: flip a surface that came out the other way
    const nor = g.getAttribute('normal'), mid = (U >> 1) * (V + 1) + (V >> 1) + (part === 'top' ? 0 : (U + 1) * (V + 1));
    if ((part === 'top') !== (nor.getY(mid) > 0)) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    g.computeBoundingSphere();
    return g;
  });
}
/** A bill: its top (and front edge) in `color`, the underside in `under`. */
function billParts(key, root, tip, thick, U, V, color, under, mat) {
  return [
    { geo: billGeometry(key, root, tip, thick, U, V, 'top'), color, mat },
    { geo: billGeometry(key, root, tip, thick, U, V, 'bottom'), color: under, mat },
  ];
}

/**
 * The ball cap: the crown hugging the head, a button on top, the team badge on the front and the curved bill. `backward` (the
 * catcher) turns it round. Under it the hair shows at the sides and the back.
 */
export function capParts(surf, { color, bill, badge, dl, q, backward = false }) {
  const fine = dl > 0.7;
  const T = 0.034;
  const rot = backward ? PI : 0;
  const crown = shell(surf, {
    key: `cap|${q}|${fine ? 1 : 0}`, a0: -PI, a1: PI, cols: fine ? 48 : 22, rows: fine ? 8 : 4, top: true, rim: 0.004,
    lo: (th) => capEdge(th - rot), off: (f) => T + 0.008 * Math.sin(PI * f) - 0.004 * f * f,
  });
  const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
  const parts = [{ geo: crown, color, mat: 'fabric', paint: (x, y, z) => { const a = Math.atan2(x, z), seam = Math.abs(Math.sin(a * 3)) < 0.06 && y > 0.4 ? 0.82 : 1; return [seam, seam, seam]; } }];
  parts.push({ geo: sphG(0.035, fine ? 10 : 6, fine ? 6 : 4), color, x: surf.pole[0], y: surf.pole[1] + T - 0.004, z: surf.pole[2], sy: 0.55, mat: 'fabric' }); // button
  // the team badge on the front panel, lying on the cap
  const bth = backward ? PI : 0;
  const b = surf.at(0.43, bth);
  const bp = [b.p[0] + b.n[0] * (T + 0.008), b.p[1] + b.n[1] * (T + 0.008), b.p[2] + b.n[2] * (T + 0.008)];
  if (!backward) parts.push({ geo: sphG(0.062, fine ? 14 : 8, fine ? 8 : 5), color: badge, x: bp[0], y: bp[1], z: bp[2], rx: -Math.asin(b.n[1]), sx: 1.0, sy: 0.92, sz: 0.06, mat: 'fabric' });
  // the bill: from the cap's front edge, out and a little down, curved down at the sides (seen from above: half an ellipse)
  const W = 1.0; // (how far round the head it reaches, radians each side)
  const dir = backward ? -1 : 1;
  const root = (u) => {
    const th = u * W + rot, y = capEdge(u * W) + 0.006;
    const { p, n } = surf.at(y, th);
    return [p[0] + n[0] * (T - 0.008), p[1], p[2] + n[2] * (T - 0.008)];
  };
  const r0 = root(0);
  const tip = (u) => {
    const ph = (u * PI) / 2, rr = root(u);
    const out = [0.215 * Math.sin(ph) * dir, r0[1] - 0.075 - 0.045 * u * u, r0[2] + dir * 0.26 * Math.cos(ph)];
    const w = smooth(1, 0.78, Math.abs(u));
    return [lerp(rr[0], out[0], w), lerp(rr[1], out[1], w), lerp(rr[2], out[2], w)];
  };
  parts.push(...billParts(`bill|${q}|${backward ? 1 : 0}|${fine ? 1 : 0}`, root, tip, 0.02, fine ? 18 : 8, fine ? 5 : 2, bill, shade(bill, 0.45), 'fabric'));
  return parts;
}

/**
 * The batting helmet: a hard shell over the head (down over the ear on the side that faces the pitcher - the figure's left, +x), a
 * short brim, the ear hole and the team badge.
 */
export function helmetParts(surf, { color, badge, dl, q }) {
  const fine = dl > 0.7;
  const T = 0.06;
  const lo = (th) => {
    const ax = Math.abs(th);
    const front = 0.37, back = 0.04;
    if (th > 0) { // the flap side: down over the ear to the jaw
      if (th < 0.95) return front;
      if (th < 1.2) return lerp(front, -0.06, smooth(0.95, 1.2, th));
      if (th < 2.2) return -0.06;
      return lerp(-0.06, back, smooth(2.2, 2.7, th));
    }
    if (ax < 0.95) return front;
    if (ax < 1.25) return lerp(front, 0.26, smooth(0.95, 1.25, ax)); // the open side: the ear shows
    if (ax < 1.85) return 0.26;
    return lerp(0.26, back, smooth(1.85, 2.5, ax));
  };
  const parts = [{
    geo: shell(surf, { key: `helmet|${q}|${fine ? 1 : 0}`, a0: -PI, a1: PI, cols: fine ? 56 : 26, rows: fine ? 10 : 5, top: true, rim: 0.012, lo, off: (f) => T + 0.012 * Math.sin(PI * Math.min(1, f * 1.3)) }),
    color, mat: 'helmet',
  }];
  // the ear hole on the flap
  const e = surf.at(0.15, 1.6);
  parts.push({ geo: sphG(0.05, fine ? 12 : 6, fine ? 8 : 4), color: '#0d0e10', x: e.p[0] + e.n[0] * (T + 0.004), y: e.p[1] + e.n[1] * (T + 0.004), z: e.p[2] + e.n[2] * (T + 0.004), ry: Math.atan2(e.n[0], e.n[2]), sz: 0.15, mat: 'helmet' });
  // the badge on the front
  const b = surf.at(0.47, 0);
  parts.push({ geo: sphG(0.072, fine ? 14 : 8, fine ? 8 : 5), color: badge, x: b.p[0], y: b.p[1] + b.n[1] * (T + 0.012), z: b.p[2] + b.n[2] * (T + 0.012), rx: -Math.asin(b.n[1]), sx: 1.05, sy: 0.9, sz: 0.1, mat: 'helmet' });
  // the brim
  const root = (u) => { const th = u * 0.95, { p, n } = surf.at(0.372, th); return [p[0] + n[0] * (T - 0.012), p[1] + 0.008, p[2] + n[2] * (T - 0.012)]; };
  const r0 = root(0);
  const tip = (u) => {
    const ph = (u * PI) / 2, rr = root(u);
    const out = [0.235 * Math.sin(ph), r0[1] - 0.03 - 0.03 * u * u, r0[2] + 0.14 * Math.cos(ph)];
    const w = smooth(1, 0.75, Math.abs(u));
    return [lerp(rr[0], out[0], w), lerp(rr[1], out[1], w), lerp(rr[2], out[2], w)];
  };
  parts.push(...billParts(`brim|${q}|${fine ? 1 : 0}`, root, tip, 0.024, fine ? 16 : 8, fine ? 3 : 2, color, color, 'helmet'));
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------- the face
const sphCache = new Map();
function sphG(r, w, h, p0 = 0, pl = PI * 2, t0 = 0, tl = PI) { const k = `${r}|${w}|${h}|${p0}|${pl}|${t0}|${tl}`; return sphCache.get(k) || sphCache.set(k, new THREE.SphereGeometry(r, w, h, p0, pl, t0, tl)).get(k); }
const capsCache = new Map();
const capsG = (r, len, ss, rs) => { const k = `${r}|${len}|${ss}|${rs}`; return capsCache.get(k) || capsCache.set(k, new THREE.CapsuleGeometry(r, len, ss, rs)).get(k); };
const torCache = new Map();
const torG = (r, t, arc, ts, rs) => { const k = `${r}|${t}|${arc}|${ts}|${rs}`; return torCache.get(k) || torCache.set(k, new THREE.TorusGeometry(r, t, ts, rs, arc)).get(k); };

/**
 * Colour across the face (multipliers on the skin colour): shade in the eye sockets and under the brow and the nose, warmer cheeks,
 * nose and ears, and where facial hair grows, stubble or the shadow of a shave (blended toward the hair colour).
 */
export function facePaint({ skin, hair, beard, stubble }) {
  const g = (dx, dy, s) => Math.exp(-(dx * dx + dy * dy) / (s * s));
  const S = new THREE.Color(skin), Hc = new THREE.Color(hair);
  // how strongly the beard area is shaded toward the hair colour: stubble, under a beard (so its edge never shows bare skin), or a
  // clean shave (a faint shadow, only for dark hair on fair skin)
  const dark = 1 - (0.3 * Hc.r + 0.59 * Hc.g + 0.11 * Hc.b) / Math.max(0.05, 0.3 * S.r + 0.59 * S.g + 0.11 * S.b);
  const amt = beard === 'stubble' ? stubble : beard === 'none' ? 0.18 * stubble * Math.max(0, dark) : 0.75;
  const area = beard === 'none' ? 'stubble' : beard === 'mustache' || beard === 'goatee' ? beard : 'short';
  const ratio = [Hc.r / Math.max(0.004, S.r), Hc.g / Math.max(0.004, S.g), Hc.b / Math.max(0.004, S.b)];
  return (x, y, z) => {
    const front = Math.max(0, Math.min(1, (z - 0.1) / 0.14));
    const ax = Math.abs(x);
    let k = 1, warm = 0;
    k -= 0.26 * front * g(ax - 0.104, y - 0.2, 0.06); // eye sockets
    k -= 0.1 * front * g(0, y - 0.255, 0.045) * (ax < 0.22 ? 1 : 0); // under the brow
    k -= 0.07 * front * g(ax, y + 0.055, 0.03); // under the lower lip
    k -= 0.05 * front * g(ax - 0.03, y - 0.05, 0.03); // beside the nose
    k -= 0.08 * Math.max(0, Math.min(1, (-0.13 - y) / 0.06)); // under the jaw
    warm += 0.12 * front * g(ax - 0.165, y - 0.075, 0.07); // cheeks
    k += 0.035 * Math.max(0, Math.min(1, (y - 0.3) / 0.12)); // a lighter forehead
    let r = k * (1 + warm), gg = k * (1 - warm * 0.25), b = k * (1 - warm * 0.35);
    const c = amt * beardCover(x, y, z, area);
    if (c > 0) { r *= 1 + c * (ratio[0] - 1); gg *= 1 + c * (ratio[1] - 1); b *= 1 + c * (ratio[2] - 1); }
    return [r, gg, b];
  };
}

/**
 * The face, skull, neck and ears, and what grows on them (hair, facial hair) - not the cap or helmet (see capParts / helmetParts).
 * @param {object} o { dl, skin, lip, eye, hair, beard, long, face, stubble, hairOn }
 * @returns {{ parts: Array, surf: object, q: number }}
 */
export function headParts({ dl, skin, lip, eye, hair, beard = 'none', long = false, face = 0.5, stubble = 0.3, hairOn = true }) {
  const q = Math.round(face * 4) / 4;
  const rings = skullRings(q);
  const surf = cached(`surf|${q}`, () => skullSurface(rings));
  const fine = dl > 0.7;
  const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
  const f2 = (face * 7.31) % 1, f3 = (face * 3.77) % 1;
  const nose = 1 + (f3 - 0.5) * 0.3, noseLen = 1 + (f2 - 0.5) * 0.2;
  const zf = (y) => surf.at(y, 0).p[2]; // the front of the face at height y
  const parts = [
    { geo: loft(rings, { seg: Math.max(12, Math.round(34 * dl)), sub: fine ? 2 : 1, dome: 0.3, key: `skull3|${q}|${Math.round(34 * dl)}|${fine ? 1 : 0}` }), color: skin, ao: 0.03, paint: facePaint({ skin, hair, beard, stubble }), mat: 'skin' },
  ];
  // the neck: from the collar up into the head, the cords of the neck at the front-sides and the Adam's apple
  const neck = [
    { y: -0.5, rx: 0.19, rz: 0.175 },
    { y: -0.32, rx: 0.158, rz: 0.142, bumps: [{ a: 0.6, w: 0.4, h: 0.07 }, { a: -0.6, w: 0.4, h: 0.07 }, { a: 0, w: 0.2, h: 0.07 }] },
    { y: -0.18, rx: 0.15, rz: 0.14, z: 0.0 },
    { y: -0.05, rx: 0.16, rz: 0.16, z: -0.02 },
  ];
  parts.push({ geo: loft(neck, { seg: fine ? 18 : 10, sub: fine ? 2 : 1, dome: 0.2, key: `neck2|${fine ? 1 : 0}` }), color: skin, ao: 0.15, mat: 'skin' });
  // the nose: the bridge between the eyes, the line of it, the tip, the wings and the nostrils
  const nz = (y, out) => zf(y) + out;
  const noseRings = [
    { y: 0.262, rx: 0.02, rz: 0.018, z: nz(0.262, -0.012) },
    { y: 0.205, rx: 0.024 * nose, rz: 0.026, z: nz(0.205, 0.0) },
    { y: 0.15, rx: 0.028 * nose, rz: 0.034, z: nz(0.15, 0.016 * noseLen) },
    { y: 0.105, rx: 0.036 * nose, rz: 0.04, z: nz(0.105, 0.03 * noseLen) },
    { y: 0.078, rx: 0.036 * nose, rz: 0.034, z: nz(0.078, 0.028 * noseLen) },
    { y: 0.062, rx: 0.016, rz: 0.016, z: nz(0.062, 0.016) },
  ];
  parts.push({ geo: loft(noseRings, { seg: fine ? 14 : 8, sub: fine ? 2 : 1, dome: 0.4, key: `nose3|${q}|${nose.toFixed(2)}|${noseLen.toFixed(2)}|${fine ? 1 : 0}` }), color: skin, mat: 'skin', paint: (x, y) => { const w = 0.06 * Math.max(0, Math.min(1, (0.14 - y) / 0.06)); return [1 + w, 1 - w * 0.3, 1 - w * 0.4]; } });
  for (const sd of [-1, 1]) {
    const wy = 0.078, wz = zf(wy) + 0.006;
    parts.push({ geo: sphG(0.026, fine ? 12 : 6, fine ? 8 : 5), color: shade(skin, 1.0), x: sd * 0.033 * nose, y: wy, z: wz - 0.004, sx: 0.75, sy: 0.7, sz: 0.9, mat: 'skin' }); // wing of the nose
    if (fine) parts.push({ geo: sphG(0.012, 8, 6), color: shade(skin, 0.35), x: sd * 0.019, y: 0.066, z: zf(0.066) + 0.022 * noseLen, sx: 1.1, sy: 0.45, sz: 1.2, mat: 'skin' }); // nostril
  }
  // lips: a soft upper and a fuller lower lip only a little in front of the face, the line of the mouth between them
  parts.push(
    { geo: sphG(0.05, fine ? 16 : 8, fine ? 8 : 5), color: lip, y: 0.014, z: zf(0.014) - 0.008, sx: 1.55, sy: 0.28, sz: 0.3, mat: 'skin' },
    { geo: sphG(0.05, fine ? 16 : 8, fine ? 8 : 5), color: shade(lip, 1.06), y: -0.017, z: zf(-0.017) - 0.007, sx: 1.4, sy: 0.36, sz: 0.32, mat: 'skin' },
    { geo: sphG(0.05, fine ? 12 : 8, 4), color: shade(lip, 0.4), y: -0.0015, z: zf(-0.002) - 0.004, sx: 1.5, sy: 0.04, sz: 0.3, mat: 'skin' },
  );
  for (const sd of [-1, 1]) {
    // the eye: set back in its socket, the upper lid over its top, the lower lid under it, so only an almond of white shows
    const s = surf.at(0.198, sd * 0.31);
    const R = 0.042;
    const ec = [s.p[0] - s.n[0] * (R - 0.012), 0.198, s.p[2] - s.n[2] * (R - 0.012)];
    const look = { x: ec[0], y: ec[1], z: ec[2] };
    parts.push(
      { geo: sphG(R, fine ? 14 : 8, fine ? 10 : 6), color: '#cbc2b4', ...look, mat: 'skin' }, // eye white
      { geo: sphG(R * 1.012, fine ? 14 : 8, 3, 0, PI * 2, 0, 0.56), color: eye, ...look, rx: PI / 2, mat: 'skin' }, // iris
      { geo: sphG(R * 1.018, 10, 2, 0, PI * 2, 0, 0.22), color: '#070605', ...look, rx: PI / 2, mat: 'skin' }, // pupil
      { geo: sphG(R * 1.13, fine ? 16 : 8, fine ? 8 : 4, 0, PI * 2, 0, PI * 0.5), color: shade(skin, 0.96), ...look, rx: -0.22, sx: 1.08, mat: 'skin' }, // upper lid
      { geo: sphG(R * 1.1, fine ? 16 : 8, fine ? 6 : 3, 0, PI * 2, PI * 0.64, PI * 0.36), color: shade(skin, 0.97), ...look, rx: -0.06, sx: 1.06, mat: 'skin' }, // lower lid
    );
    // the ear, a little behind the middle of the head, tilted back, with its rim
    const e = surf.at(0.14, sd * 1.6);
    parts.push(
      { geo: sphG(0.085, fine ? 14 : 8, fine ? 10 : 6), color: skin, x: e.p[0] + sd * 0.002, y: 0.15, z: e.p[2] - 0.015, sx: 0.28, sy: 1.12, sz: 0.62, rx: -0.2, ry: -sd * 0.25, mat: 'skin' },
      { geo: torG(0.05, 0.009, PI * 1.4, 4, fine ? 12 : 8), color: shade(skin, 0.95), x: e.p[0] + sd * 0.02, y: 0.16, z: e.p[2] - 0.018, ry: PI / 2, rz: 1.0, sy: 1.3, mat: 'skin' },
      { geo: sphG(0.03, 8, 6), color: shade(skin, 0.55), x: e.p[0] + sd * 0.014, y: 0.14, z: e.p[2] - 0.01, sx: 0.3, sy: 1.1, sz: 0.8, mat: 'skin' },
    );
  }
  // eyebrows: thin shells on the brow ridge, thicker toward the nose, in the hair colour
  for (const sd of [-1, 1]) {
    const a0 = sd > 0 ? 0.12 : -0.6, a1 = sd > 0 ? 0.6 : -0.12;
    parts.push({
      geo: shell(surf, {
        key: `brow|${q}|${sd}|${fine ? 1 : 0}`, a0, a1, cols: fine ? 10 : 4, rows: 2, rim: 0.004,
        lo: (th) => 0.257 + 0.016 * Math.sin(PI * smooth(0.1, 0.65, Math.abs(th))) - 0.004 * smooth(0.4, 0.6, Math.abs(th)),
        hi: (th) => 0.257 + 0.016 * Math.sin(PI * smooth(0.1, 0.65, Math.abs(th))) + 0.027 - 0.014 * smooth(0.12, 0.6, Math.abs(th)),
        off: (f, th) => 0.006 + 0.003 * Math.sin(PI * f) * (1 - Math.abs(th)),
      }), color: shade(hair, 1.05), mat: 'hair',
    });
  }
  if (hairOn) parts.push(...hairParts(surf, { color: hair, dl, long, q }));
  parts.push(...beardParts(surf, { style: beard, color: hair, dl, q }));
  return { parts, surf, q };
}
