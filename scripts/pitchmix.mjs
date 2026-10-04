// Where does the computer pitcher throw? Prints, for each difficulty, how many pitches are in the strike zone, borderline,
// tempting-but-out-of-the-zone ("chase") and way out of reach ("unhittable" = the bat cannot reach it), plus Derby.
// usage: node scripts/pitchmix.mjs [pitches=20000]
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { choosePitch } from '../src/game/pitcherAI.js';
import { isStrike, zoneRatio } from '../src/physics/pitch.js';

const N = +(process.argv[2] || 20000);
const cfg = CONFIG;
const pct = (n, d) => (100 * n / d).toFixed(1).padStart(5) + '%';
function classify(t) {
  const r = zoneRatio(t.x, t.y, cfg);
  return { strike: isStrike(t.x, t.y, cfg), r };
}
export function mixFor(mode, difficulty, counts = [{ balls: 0, strikes: 0 }], seed = 1, arsenal) {
  const rng = createRng(seed);
  const s = { n: 0, strike: 0, edge: 0, chase: 0, unhittable: 0, far: 0, dirt: 0, high: 0, wide: 0, byType: {} };
  let last;
  for (let i = 0; i < N; i++) {
    const count = counts[i % counts.length];
    const p = choosePitch({ mode, difficulty, count, rng, batterHand: i % 3 === 0 ? 'L' : 'R', arsenal, pitcherHand: i % 5 === 0 ? 'L' : 'R', lastType: last }, cfg);
    last = p.type;
    const c = classify(p.target);
    s.n++;
    if (c.strike) s.strike++;
    if (c.r <= cfg.timing.chaseRatio) s.edge++; // hittable properly (the bat can drive it)
    else if (c.r <= cfg.timing.reachRatio) s.chase++; // can only be hit weakly
    else s.unhittable++;
    if (c.r > 1.8) s.far++;
    if (p.target.y < 1.0) s.dirt++;
    if (p.target.y > 4.0) s.high++;
    if (Math.abs(p.target.x) > 1.6) s.wide++;
    (s.byType[p.type] ||= { n: 0, out: 0 }).n++;
    if (!c.strike) s.byType[p.type].out++;
  }
  return s;
}
if (process.argv[1] && process.argv[1].endsWith('pitchmix.mjs')) {
  const mixed = [{ balls: 0, strikes: 0 }, { balls: 1, strikes: 0 }, { balls: 0, strikes: 1 }, { balls: 1, strikes: 1 }, { balls: 2, strikes: 1 }, { balls: 0, strikes: 2 }, { balls: 1, strikes: 2 }, { balls: 2, strikes: 0 }, { balls: 2, strikes: 2 }, { balls: 3, strikes: 1 }];
  console.log('Quick game, counts mixed. "hittable" = the bat can drive it, "weak" = only a weak swing is possible, "unhittable" = out of reach');
  for (const d of DIFFICULTIES) {
    const s = mixFor('quick', d, mixed);
    console.log(`${d.padEnd(8)} strikes ${pct(s.strike, s.n)}  hittable ${pct(s.edge, s.n)}  weak-only ${pct(s.chase, s.n)}  unhittable ${pct(s.unhittable, s.n)}  (clearly out, well past reach: ${pct(s.far, s.n)})   (in the dirt ${pct(s.dirt, s.n)}, high heat ${pct(s.high, s.n)}, way wide ${pct(s.wide, s.n)})`);
  }
  for (const d of DIFFICULTIES) {
    const s = mixFor('quick', d, mixed);
    console.log(`  ${d.padEnd(8)} out of the zone by type: ` + Object.entries(s.byType).map(([k, v]) => `${k} ${pct(v.out, v.n)}`).join('  '));
  }
  // Pitchers' arsenals (not the level mixes): a pitcher who also throws the three new types
  for (const d of DIFFICULTIES) {
    const s = mixFor('quick', d, mixed, 1, ['fastball', 'sinker', 'cutter', 'splitter', 'curveball']);
    console.log(`  ${d.padEnd(8)} arsenal FB/SI/CT/SP/CB, share (out of the zone): ` + Object.entries(s.byType).map(([k, v]) => `${k} ${pct(v.n, s.n)} (${pct(v.out, v.n)})`).join('  '));
  }
  for (const d of DIFFICULTIES) {
    const s = mixFor('derby', d);
    console.log(`derby ${d.padEnd(8)} strikes ${pct(s.strike, s.n)}  hittable ${pct(s.edge, s.n)}  unhittable ${pct(s.unhittable, s.n)}`);
  }
}
