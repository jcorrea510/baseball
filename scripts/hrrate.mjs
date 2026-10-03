// How often does a swing leave the park? Runs thousands of swings through the real pitches, swing model, bat-ball collision and
// ball flight.
//   node scripts/hrrate.mjs [swings=3000] [mode=derby|quick]
// timing: "perfect" = well inside the perfect window; "good" = inside the good window but outside perfect.
// contact: where the bat meets the ball - "power" = a little under the middle of the ball (where home runs come from),
// "square" = dead centre (line drives), "top" = on top of it (grounders). Pitches are the ones the mode really throws.
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { choosePitch } from '../src/game/pitcherAI.js';
import { computeSwing, derbyBatting, contactWindow, contactPoint, scaleWindow } from '../src/game/contact.js';
import { classifyTiming } from '../src/game/timing.js';
import { simulateBattedBall, judgeFairFoul } from '../src/physics/ballistics.js';
import { buildPitch, zoneRatio } from '../src/physics/pitch.js';

export const CONTACT_U = { power: [0.4, 0.04], square: [0, 0.04], top: [-0.45, 0.05] }; // [mean, spread] of the bat's offset (share of the window)

export function hrRate({ mode = 'derby', difficulty = 'pro', kind = 'perfect', contact = 'power', side = 0, hand = 'R', n = 3000, seed = 5, cfg = CONFIG } = {}) {
  const rng = createRng(seed);
  const pr = createRng(seed + 1000);
  const d = cfg.difficulty[difficulty];
  const w = classifyTiming(0, { windowScale: d.windowScale }, cfg).windows; // timing window edges in ms
  const win0 = contactWindow(difficulty, cfg), grow = mode === 'derby' ? cfg.modes.derby.windowGrow : 1;
  const win = scaleWindow(win0, grow);
  const [uMean, uSd] = CONTACT_U[contact];
  let hr = 0, made = 0, fair = 0, sumEV = 0, sumLA = 0, hard = 0;
  for (let i = 0; i < n; i++) {
    const p = choosePitch({ mode, difficulty, count: { balls: 0, strikes: 0 }, rng: pr, batterHand: hand, pitcherHand: 'R' }, cfg);
    if (zoneRatio(p.target.x, p.target.y, cfg) > cfg.swing.chase.from) { i--; continue; } // (a hittable pitch, in or next to the zone)
    const flight = buildPitch({ type: p.type, speedMph: p.speedMph, hand: 'R', target: p.target, movementScale: mode === 'derby' ? 0.4 : d.movementScale, pace: d.pitchPace || 1 }, cfg);
    const sign = side || (rng.chance(0.5) ? 1 : -1); // side: -1 = early swing (pulled), +1 = late (toward the opposite field)
    const errorMs = kind === 'perfect' ? rng.range(-0.6, 0.6) * w.perfect : sign * rng.range(w.perfect * 1.1, w.good * 0.95);
    const tHit = flight.T + Math.max(-cfg.timing.reachEarly, Math.min(cfg.timing.reachLate, errorMs / 1000));
    const pt = contactPoint(flight, tHit, flight.T + errorMs / 1000, cfg);
    const u = uMean + rng.gauss(0, uSd);
    const aim = { x: pt.ball.x + rng.gauss(0, 0.05), y: pt.ball.y - u * win.sweet.up };
    const c = computeSwing({ errorMs, aim, ...pt, window: win, windowScale: d.windowScale, batterHand: hand, batBonus: d.batBonus || 0, aimAssist: d.aimAssist || 0, ...(mode === 'derby' ? derbyBatting(cfg) : {}), rng }, cfg);
    if (!c.made) continue;
    made++;
    const start = flight.at(tHit);
    const sim = simulateBattedBall({ exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle, backspin: c.backspin, hook: c.hook, start: { x: start.x, y: Math.max(1, start.y), z: start.z } }, cfg);
    const isFair = judgeFairFoul(sim);
    if (isFair) fair++;
    if (sim.homerun && isFair) hr++;
    sumEV += c.exitVelocity; sumLA += c.launchAngle;
    if (c.exitVelocity >= 100) hard++;
  }
  const k = Math.max(1, made);
  return { hr: hr / k, fair: fair / k, ev: sumEV / k, la: sumLA / k, hard: hard / k, n: made };
}

if (process.argv[1] && process.argv[1].endsWith('hrrate.mjs')) {
  const N = +(process.argv[2] || 3000);
  const mode = process.argv[3] || 'derby';
  const pct = (x) => (100 * x).toFixed(0).padStart(3) + '%';
  console.log(`Home run rate per swing that makes contact (${mode}, ${N} swings each, right-handed batter).`);
  console.log('level     timing    power (under)   square   on top   | power: avg exit velo, launch, fair');
  for (const d of DIFFICULTIES) {
    for (const kind of ['perfect', 'good']) {
      const pw = hrRate({ mode, difficulty: d, kind, contact: 'power', n: N });
      const sq = hrRate({ mode, difficulty: d, kind, contact: 'square', n: N });
      const tp = hrRate({ mode, difficulty: d, kind, contact: 'top', n: N });
      console.log(`${d.padEnd(9)} ${kind.padEnd(8)}  ${pct(pw.hr)}            ${pct(sq.hr)}     ${pct(tp.hr)}    | ${pw.ev.toFixed(1)} mph, ${pw.la.toFixed(1)} deg, ${pct(pw.fair)}`);
    }
  }
}
