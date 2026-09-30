// The Sandlot logo, drawn in code: athletic block letters defined here as shapes (so the logo looks the same on every device,
// no font needed), slanted and arched like a jersey script, with a stitched baseball swoosh underneath.
// Pure (no DOM): the game's title screen, the loading splash (inlined into index.html at build time) and the favicon /
// share-image script (scripts/brand.mjs) all use it.

const H = 100; // letter height
const T = 26; // stroke thickness
// Each letter: width + polygons (outer contours and holes; drawn with the even-odd rule so holes cut out).
const LETTERS = {
  S: { w: 70, polys: [[[10, 0], [70, 0], [70, T], [T, T], [T, 37], [60, 37], [70, 47], [70, 90], [60, 100], [0, 100], [0, 74], [44, 74], [44, 63], [10, 63], [0, 53], [0, 10]]] },
  A: { w: 76, polys: [[[0, 100], [0, 22], [22, 0], [54, 0], [76, 22], [76, 100], [50, 100], [50, 70], [26, 70], [26, 100]], [[26, 26], [50, 26], [50, 44], [26, 44]]] },
  N: { w: 76, polys: [[[0, 100], [0, 0], [T, 0], [50, 58], [50, 0], [76, 0], [76, 100], [50, 100], [T, 42], [T, 100]]] },
  D: { w: 74, polys: [[[0, 0], [50, 0], [74, 24], [74, 76], [50, 100], [0, 100]], [[T, T], [40, T], [48, 34], [48, 66], [40, 74], [T, 74]]] },
  L: { w: 62, polys: [[[0, 0], [T, 0], [T, 74], [62, 74], [62, 100], [0, 100]]] },
  O: { w: 76, polys: [[[24, 0], [52, 0], [76, 24], [76, 76], [52, 100], [24, 100], [0, 76], [0, 24]], [[34, T], [42, T], [50, 34], [50, 66], [42, 74], [34, 74], [T, 66], [T, 34]]] },
  T: { w: 72, polys: [[[0, 0], [72, 0], [72, T], [49, T], [49, 100], [23, 100], [23, T], [0, T]]] },
  // the rest of the headline alphabet (HOME RUN!, YOU WIN, YOU LOSE, 12 HOME RUNS, INSIDE-THE-PARK HR ...)
  H: { w: 74, polys: [[[0, 0], [T, 0], [T, 37], [48, 37], [48, 0], [74, 0], [74, 100], [48, 100], [48, 63], [T, 63], [T, 100], [0, 100]]] },
  M: { w: 92, polys: [[[0, 100], [0, 0], [25, 0], [46, 34], [67, 0], [92, 0], [92, 100], [66, 100], [66, 48], [46, 76], [T, 48], [T, 100]]] },
  E: { w: 62, polys: [[[0, 0], [62, 0], [62, T], [T, T], [T, 37], [52, 37], [52, 63], [T, 63], [T, 74], [62, 74], [62, 100], [0, 100]]] },
  R: { w: 76, polys: [[[0, 0], [52, 0], [74, 20], [74, 44], [62, 56], [76, 100], [49, 100], [39, 64], [T, 64], [T, 100], [0, 100]], [[T, 24], [44, 24], [48, 28], [48, 36], [44, 40], [T, 40]]] },
  U: { w: 74, polys: [[[0, 0], [T, 0], [T, 70], [32, 74], [42, 74], [48, 70], [48, 0], [74, 0], [74, 78], [52, 100], [22, 100], [0, 78]]] },
  Y: { w: 76, polys: [[[0, 0], [27, 0], [38, 34], [49, 0], [76, 0], [51, 58], [51, 100], [25, 100], [25, 58]]] },
  W: { w: 102, polys: [[[0, 0], [25, 0], [32, 58], [43, 24], [59, 24], [70, 58], [77, 0], [102, 0], [89, 100], [63, 100], [51, 62], [39, 100], [13, 100]]] },
  I: { w: T, polys: [[[0, 0], [T, 0], [T, 100], [0, 100]]] },
  P: { w: 70, polys: [[[0, 0], [48, 0], [70, 22], [70, 46], [48, 66], [T, 66], [T, 100], [0, 100]], [[T, 24], [40, 24], [44, 28], [44, 38], [40, 42], [T, 42]]] },
  K: { w: 76, polys: [[[0, 0], [T, 0], [T, 38], [46, 0], [74, 0], [47, 50], [76, 100], [47, 100], [T, 62], [T, 100], [0, 100]]] },
  C: { w: 68, polys: [[[22, 0], [68, 0], [68, T], [34, T], [T, 34], [T, 66], [34, 74], [68, 74], [68, 100], [22, 100], [0, 78], [0, 22]]] },
  F: { w: 62, polys: [[[0, 0], [62, 0], [62, T], [T, T], [T, 38], [54, 38], [54, 64], [T, 64], [T, 100], [0, 100]]] },
  G: { w: 74, polys: [[[22, 0], [70, 0], [70, T], [34, T], [T, 34], [T, 66], [34, 74], [48, 74], [48, 62], [40, 62], [40, 42], [74, 42], [74, 78], [52, 100], [22, 100], [0, 78], [0, 22]]] },
  '!': { w: 28, polys: [[[1, 0], [27, 0], [22, 68], [6, 68]], [[3, 76], [25, 76], [25, 100], [3, 100]]] },
  '-': { w: 40, polys: [[[0, 38], [40, 38], [40, 62], [0, 62]]] },
  '0': { w: 70, polys: [[[20, 0], [50, 0], [70, 20], [70, 80], [50, 100], [20, 100], [0, 80], [0, 20]], [[32, T], [38, T], [44, 32], [44, 68], [38, 74], [32, 74], [T, 68], [T, 32]]] },
  '1': { w: 50, polys: [[[6, 0], [42, 0], [42, 74], [50, 74], [50, 100], [0, 100], [0, 74], [16, 74], [16, 28], [6, 28]]] },
  '2': { w: 70, polys: [[[0, 0], [56, 0], [70, 14], [70, 50], [58, 62], [T, 62], [T, 74], [70, 74], [70, 100], [0, 100], [0, 48], [12, 36], [44, 36], [44, T], [0, T]]] },
  '3': { w: 70, polys: [[[0, 0], [56, 0], [70, 14], [70, 86], [56, 100], [0, 100], [0, 74], [44, 74], [44, 63], [14, 63], [14, 37], [44, 37], [44, T], [0, T]]] },
  '4': { w: 70, polys: [[[0, 0], [T, 0], [T, 44], [44, 44], [44, 0], [70, 0], [70, 100], [44, 100], [44, 70], [0, 70]]] },
  '5': { w: 70, polys: [[[0, 0], [70, 0], [70, T], [T, T], [T, 37], [56, 37], [70, 51], [70, 86], [56, 100], [0, 100], [0, 74], [44, 74], [44, 63], [0, 63]]] },
  '6': { w: 70, polys: [[[14, 0], [66, 0], [66, T], [T, T], [T, 37], [56, 37], [70, 51], [70, 86], [56, 100], [14, 100], [0, 86], [0, 14]], [[T, 61], [44, 61], [44, 76], [T, 76]]] },
  '7': { w: 70, polys: [[[0, 0], [70, 0], [70, T], [44, 100], [16, 100], [41, T], [0, T]]] },
  '8': { w: 70, polys: [[[14, 0], [56, 0], [70, 14], [70, 40], [62, 50], [70, 60], [70, 86], [56, 100], [14, 100], [0, 86], [0, 60], [8, 50], [0, 40], [0, 14]], [[T, 24], [44, 24], [44, 39], [T, 39]], [[T, 61], [44, 61], [44, 76], [T, 76]]] },
  '9': { w: 70, polys: [[[14, 0], [56, 0], [70, 14], [70, 86], [56, 100], [4, 100], [4, 74], [44, 74], [44, 63], [14, 63], [0, 49], [0, 14]], [[T, 24], [44, 24], [44, 39], [T, 39]]] },
  ' ': { w: 30, polys: [] },
};
/** Can this text be drawn in the logo's letters? */
export const canDrawWord = (text) => [...String(text).toUpperCase()].every((c) => LETTERS[c]);
const GAP = 7;

// Lay out a word and bend it: slant (italic) and an arch that lifts the middle letters.
function wordPaths(word, { slant = 0.2, arch = 16 } = {}) {
  const chars = [...word.toUpperCase()].filter((c) => LETTERS[c]);
  if (!chars.length) return { d: '', width: 0, top: 0 };
  const total = chars.reduce((s, c) => s + LETTERS[c].w, 0) + GAP * (chars.length - 1);
  const cx = total / 2;
  const warp = (x, y) => {
    const u = (x - cx) / cx;
    return [x + (H - y) * slant, y - arch * (1 - u * u)];
  };
  let x0 = 0;
  const polys = [];
  for (const c of chars) {
    const L = LETTERS[c];
    for (const poly of L.polys) {
      const pts = [];
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6)); // subdivide so the arch bends straight edges
        for (let k = 0; k < n; k++) pts.push(warp(x0 + ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
      }
      polys.push(pts);
    }
    x0 += L.w + GAP;
  }
  const d = polys.map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z').join('');
  return { d, width: total + H * slant, top: -arch };
}

/**
 * The logo as an SVG string.
 * @param {object} [o]
 * @param {string} [o.id]      unique prefix for gradient ids (several logos on one page)
 * @param {boolean} [o.swoosh] draw the stitched baseball swoosh under the word
 * @param {string} [o.cls]     class for the <svg>
 */
export function logoSVG({ id = 'sl', swoosh = true, cls = 'logo-svg', title = 'Sandlot' } = {}) {
  const w = wordPaths('SANDLOT');
  const pad = 22;
  const vx = -pad, vy = w.top - pad, vw = w.width + pad * 2, vh = H - w.top + pad * 2 + (swoosh ? 40 : 0);
  // the swoosh: a tapered band sweeping under the word from the S to past the T, with red stitches along it
  const sx0 = 8, sx1 = w.width + 6, sy = H + 14;
  const band = `M${sx0} ${sy + 2} Q ${w.width * 0.45} ${sy + 44} ${sx1} ${sy - 14} Q ${w.width * 0.47} ${sy + 14} ${sx0} ${sy + 2} Z`;
  let stitches = '';
  if (swoosh) {
    for (let i = 1; i < 16; i++) {
      const t = i / 16;
      const x = (1 - t) * (1 - t) * sx0 + 2 * (1 - t) * t * (w.width * 0.46) + t * t * sx1;
      const y = (1 - t) * (1 - t) * (sy + 2) + 2 * (1 - t) * t * (sy + 29) + t * t * (sy - 14);
      const k = 0.5 + 0.5 * Math.sin(Math.PI * t); // stitches are bigger where the band is wider
      stitches += `<path d="M${(x - 4 * k).toFixed(1)} ${(y - 3.5 * k).toFixed(1)}l${(4 * k).toFixed(1)} ${(3.5 * k).toFixed(1)}l${(4 * k).toFixed(1)} ${(-3.5 * k).toFixed(1)}" />`;
    }
  }
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(0)} ${vy.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}" role="img" aria-label="${title}">
<defs>
<linearGradient id="${id}-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset=".38" stop-color="#ffe08a"/><stop offset=".72" stop-color="#ffb52e"/><stop offset="1" stop-color="#f07d12"/></linearGradient>
<linearGradient id="${id}-s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#e9e1cf"/></linearGradient>
</defs>
${swoosh ? `<g transform="translate(0 6)"><path d="${band}" fill="#140903" opacity=".55"/></g><path d="${band}" fill="url(#${id}-s)" stroke="#140903" stroke-width="5" stroke-linejoin="round"/><g fill="none" stroke="#d32f2f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${stitches}</g>` : ''}
<path d="${w.d}" fill="#140903" stroke="#140903" stroke-width="24" stroke-linejoin="round" fill-rule="evenodd" transform="translate(0 8)" opacity=".6"/>
<path d="${w.d}" fill="#140903" stroke="#140903" stroke-width="24" stroke-linejoin="round" fill-rule="evenodd"/>
<path d="${w.d}" fill="#fff4dc" stroke="#fff4dc" stroke-width="11" stroke-linejoin="round" fill-rule="evenodd"/>
<path d="${w.d}" fill="#7a2a0c" stroke="#7a2a0c" stroke-width="5" stroke-linejoin="round" fill-rule="evenodd"/>
<path d="${w.d}" fill="url(#${id}-f)" fill-rule="evenodd"/>
</svg>`;
}

/**
 * A headline in the logo's letters (the home-run celebration, the result of a game), as an SVG string - or null when the text
 * has a character the alphabet does not have (the caller then shows plain text). tone: 'gold' | 'red'.
 */
export function wordSVG(text, { id = 'w', tone = 'gold', arch = 8, slant = 0.18, cls = 'wordart' } = {}) {
  if (!canDrawWord(text)) return null;
  const w = wordPaths(String(text), { arch, slant });
  const pad = 16;
  const stops = tone === 'red'
    ? '<stop offset="0" stop-color="#fff1ee"/><stop offset=".45" stop-color="#ffb3a8"/><stop offset="1" stop-color="#e5483b"/>'
    : '<stop offset="0" stop-color="#fffaf0"/><stop offset=".38" stop-color="#ffe08a"/><stop offset=".72" stop-color="#ffb52e"/><stop offset="1" stop-color="#f07d12"/>';
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${(w.top - pad).toFixed(0)} ${(w.width + pad * 2).toFixed(0)} ${(H - w.top + pad * 2 + 6).toFixed(0)}" role="img" aria-label="${String(text).replace(/"/g, '')}">`
    + `<defs><linearGradient id="${id}-f" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`
    + `<path d="${w.d}" fill="#140903" stroke="#140903" stroke-width="22" stroke-linejoin="round" fill-rule="evenodd" transform="translate(0 7)" opacity=".55"/>`
    + `<path d="${w.d}" fill="#140903" stroke="#140903" stroke-width="22" stroke-linejoin="round" fill-rule="evenodd"/>`
    + `<path d="${w.d}" fill="#fff4dc" stroke="#fff4dc" stroke-width="9" stroke-linejoin="round" fill-rule="evenodd"/>`
    + `<path d="${w.d}" fill="url(#${id}-f)" fill-rule="evenodd"/></svg>`;
}

/** A square badge (favicon, app icon): a baseball with a block "S" on it. */
export function badgeSVG({ size = 64, round = 14 } = {}) {
  const S = LETTERS.S;
  const k = 0.36, ox = 32 - (S.w * k) / 2, oy = 32 - (H * k) / 2;
  const d = S.polys.map((p) => 'M' + p.map(([x, y]) => `${(ox + x * k).toFixed(2)} ${(oy + y * k).toFixed(2)}`).join('L') + 'Z').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
<defs><radialGradient id="b" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d2c2"/></radialGradient>
<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#f07d12"/></linearGradient></defs>
<rect width="64" height="64" rx="${round}" fill="#0b1a12"/>
<circle cx="32" cy="32" r="25" fill="url(#b)"/>
<path d="M14.5 17c6.5 6 6.5 24 0 30M49.5 17c-6.5 6-6.5 24 0 30" fill="none" stroke="#d32f2f" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="2.6 2.2"/>
<path d="${d}" fill="url(#f)" stroke="#140903" stroke-width="3.2" stroke-linejoin="round" paint-order="stroke"/>
</svg>`;
}
