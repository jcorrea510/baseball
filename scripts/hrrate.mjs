// How often does a well-timed swing leave the park? Runs thousands of swings through the real contact model and ball physics.
//   node scripts/hrrate.mjs [swings=4000] [mode=derby|quick]
// "perfect" = timing well inside the perfect window; "good" = inside the good window but outside perfect. Pitches are the ones the
// mode really throws (Derby: batting-practice fastballs). "pulled" = also steering the ball toward the pull side (A or D).
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { choosePitch } from '../src/game/pitcherAI.js';
import { computeContact, derbyBatting } from '../src/game/contact.js';
import { classifyTiming } from '../src/game/timing.js';
import { simulateBattedBall, judgeFairFoul } from '../src/physics/ballistics.js';
import { isStrike, zoneRatio } from '../src/physics/pitch.js';

export function hrRate({ mode = 'derby', difficulty = 'pro', kind = 'perfect', side = 0, aim = 0, hand = 'R', n = 3000, seed = 5, cfg = CONFIG } = {}) {
  const rng = createRng(seed);
  const pr = createRng(seed + 1000);
  const d = cfg.difficulty[difficulty];
  const w = classifyTiming(0, { windowScale: d.windowScale }, cfg).windows; // window edges in ms
  let hr = 0, made = 0, fair = 0, sumEV = 0, sumLA = 0, sumDist = 0, hard = 0;
  for (let i = 0; i < n; i++) {
    const p = choosePitch({ mode, difficulty, count: { balls: 0, strikes: 0 }, rng: pr, batterHand: hand, pitcherHand: 'R' }, cfg);
    // a hittable pitch (in or next to the zone)
    if (zoneRatio(p.target.x, p.target.y, cfg) > cfg.timing.chaseRatio) { i--; continue; }
    const sign = side || (rng.chance(0.5) ? 1 : -1); // side: -1 = early swing (pulled), +1 = late (toward the opposite field)
    const errorMs = kind === 'perfect' ? rng.range(-0.6, 0.6) * w.perfect : sign * rng.range(w.perfect * 1.1, w.good * 0.95);
    const c = computeContact({ errorMs, locX: p.target.x, locY: p.target.y, pitchSpeed: p.speedMph, windowScale: d.windowScale, speedScale: 1, aim, batterHand: hand, ...(mode === 'derby' ? derbyBatting(cfg) : {}), rng }, cfg);
    if (!c.made) continue;
    made++;
    const sim = simulateBattedBall({ exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle, backspin: c.backspin, hook: c.hook, start: { x: p.target.x, y: Math.max(1, p.target.y), z: -1 } }, cfg);
    const isFair = judgeFairFoul(sim) ;
    if (isFair) fair++;
    if (sim.homerun && isFair) hr++;
    sumEV += c.exitVelocity; sumLA += c.launchAngle; sumDist += Math.hypot(sim.stopPos ? sim.stopPos.x : 0, sim.stopPos ? sim.stopPos.z : 0);
    if (c.exitVelocity >= 100) hard++;
  }
  return { hr: hr / Math.max(1, made), fair: fair / Math.max(1, made), ev: sumEV / Math.max(1, made), la: sumLA / Math.max(1, made), hard: hard / Math.max(1, made), n: made };
}

if (process.argv[1] && process.argv[1].endsWith('hrrate.mjs')) {
  const N = +(process.argv[2] || 4000);
  const mode = process.argv[3] || 'derby';
  const pct = (x) => (100 * x).toFixed(0).padStart(3) + '%';
  console.log(`Home run rate per swing (${mode}, ${N} swings each). RHB; "pulled" = steering toward the pull side (left field).`);
  console.log('level     timing    straight   pulled   opposite   | avg exit velo   avg launch   fair');
  for (const d of DIFFICULTIES) {
    for (const kind of ['perfect', 'good']) {
      const st = hrRate({ mode, difficulty: d, kind, aim: 0, n: N });
      const pu = hrRate({ mode, difficulty: d, kind, aim: -1, n: N });
      const op = hrRate({ mode, difficulty: d, kind, aim: 1, n: N });
      console.log(`${d.padEnd(9)} ${kind.padEnd(8)}  ${pct(st.hr)}       ${pct(pu.hr)}      ${pct(op.hr)}      | ${st.ev.toFixed(1)} mph      ${st.la.toFixed(1)} deg    ${pct(st.fair)}`);
    }
    const early = hrRate({ mode, difficulty: d, kind: 'good', side: -1, n: N });
    const late = hrRate({ mode, difficulty: d, kind: 'good', side: 1, n: N });
    console.log(`${d.padEnd(9)} good, split: early (pulled) ${pct(early.hr)}   late (opposite field) ${pct(late.hr)}`);
  }
}
