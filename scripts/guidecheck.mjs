// How good is the pitch guide? For the pitches each level really throws: how often does the circle sit on the right side of the strike
// zone (a strike shows inside, a ball outside), how far off is it at the plate, and how early is it there at all?
//   node scripts/guidecheck.mjs [pitches=6000]
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { choosePitch } from '../src/game/pitcherAI.js';
import { buildPitch, isStrike } from '../src/physics/pitch.js';
import { pitchGuide } from '../src/game/pitchGuide.js';

export function guideStats(level, n = 6000, seed = 3, cfg = CONFIG) {
  const rng = createRng(seed);
  const d = cfg.difficulty[level];
  const out = { level, n, readRight: 0, readRightBorderline: 0, borderline: 0, atSwing: 0, atSwingBorderline: 0, alphaAtSwing: 0, err: 0, errBreaking: 0, breaking: 0, earlyRight: {}, seconds: 0 };
  const marks = [0.3, 0.5, 0.7, 0.9];
  for (const m of marks) out.earlyRight[m] = 0;
  let T = 0;
  for (let i = 0; i < n; i++) {
    const p = choosePitch({ mode: 'quick', difficulty: level, count: { balls: rng.int ? rng.int(0, 3) : 0, strikes: 0 }, rng, batterHand: rng.chance(0.5) ? 'R' : 'L', pitcherHand: 'R' }, cfg);
    const flight = buildPitch({ type: p.type, speedMph: p.speedMph, hand: 'R', target: p.target, movementScale: d.movementScale }, cfg);
    const pitch = { flight, target: p.target, speedMph: p.speedMph, id: i + 1, type: p.type };
    const truth = isStrike(p.target.x, p.target.y, cfg);
    const g = pitchGuide(pitch, flight.T * 0.98, cfg, level);
    const reads = isStrike(g.x, g.y, cfg);
    if (reads === truth) out.readRight++;
    const edge = Math.abs(Math.hypot(p.target.x / cfg.pitch.zoneHalfWidth, (p.target.y - cfg.timing.zoneCenterY) / cfg.timing.zoneHalfHeight) - 1) < 0.25;
    if (edge) { out.borderline++; if (reads === truth) out.readRightBorderline++; }
    // ... and at the moment the swing has to start (the bat takes `swingDelay` to arrive): this is what the player actually has to go on
    const gs = pitchGuide(pitch, flight.T - cfg.timing.swingDelay, cfg, level);
    out.alphaAtSwing += gs.alpha / cfg.pitch.guide.maxAlpha;
    if (isStrike(gs.x, gs.y, cfg) === truth) { out.atSwing++; if (edge) out.atSwingBorderline++; }
    const e = Math.hypot(g.x - p.target.x, g.y - p.target.y);
    out.err += e;
    if (['curveball', 'slider', 'changeup'].includes(p.type)) { out.breaking++; out.errBreaking += e; }
    for (const m of marks) { const gm = pitchGuide(pitch, flight.T * m, cfg, level); if (isStrike(gm.x, gm.y, cfg) === truth) out.earlyRight[m]++; }
    T += flight.T;
  }
  out.seconds = T / n;
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('guidecheck.mjs')) {
  const n = +(process.argv[2] || 6000);
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(0).padStart(3) + '%';
  console.log('level     circle on the right side of the zone at the moment the swing must start: overall / borderline pitches, how visible it is then | at the plate: overall / borderline | miss at the plate (ft)');
  for (const lv of DIFFICULTIES) {
    const s = guideStats(lv, n);
    const L = CONFIG.difficulty[lv].guide;
    console.log(`${lv.padEnd(9)} ${pct(s.atSwing, s.n)} / ${pct(s.atSwingBorderline, s.borderline)}   ${(100 * s.alphaAtSwing / s.n).toFixed(0)}% visible | ${pct(s.readRight, s.n)} / ${pct(s.readRightBorderline, s.borderline)} | ${(s.err / s.n).toFixed(2)} ft   (starts fading in ${((1 - L.fadeIn[0]) * s.seconds).toFixed(2)} s before the plate, full ${((1 - L.fadeIn[1]) * s.seconds).toFixed(2)} s before; a ${s.seconds.toFixed(2)} s flight)`);
  }
}
