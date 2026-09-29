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
};
const GAP = 7;

// Lay out a word and bend it: slant (italic) and an arch that lifts the middle letters.
function wordPaths(word, { slant = 0.2, arch = 16 } = {}) {
  const chars = [...word.toUpperCase()].filter((c) => LETTERS[c]);
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
