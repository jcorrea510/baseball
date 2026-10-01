// How does batting feel for a PERSON? A simulated player watches the pitch guide (the circle), moves the bat there with a human
// reaction delay and a little hand shake, and times the swing with a human timing spread. It swings at every hittable pitch
// (in or near the zone) the computer really throws, through the real swing model, collision, ball flight and fielders.
//   node scripts/feel.mjs [swings=3000] [player=average|good|new] [mode=quick|derby]
// Prints, per level: contact % (bat on ball, fair or foul), miss %, and per swing: fair balls, hits, home runs.
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { choosePitch } from '../src/game/pitcherAI.js';
import { computeSwing, derbyBatting, contactWindow, contactPoint, scaleWindow } from '../src/game/contact.js';
import { resolveSwingTimes } from '../src/game/timing.js';
import { pitchGuide } from '../src/game/pitchGuide.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { buildPitch, zoneRatio } from '../src/physics/pitch.js';
import { createDefense, planPlay } from '../src/game/fielding.js';

// How good the simulated person is: timing spread (ms), reaction (s from what the eye sees to where the hand puts the bat),
// hand shake (ft), and how far under the circle he aims (share of the bat's contact window: a little under = fly balls).
export const PLAYERS = {
  new: { timingSd: 55, react: 0.26, hand: 0.11, under: 0.15 },
  average: { timingSd: 40, react: 0.22, hand: 0.08, under: 0.2 },
  good: { timingSd: 28, react: 0.18, hand: 0.05, under: 0.3 },
};

export function feel({ difficulty = 'pro', player = 'average', mode = 'quick', n = 3000, seed = 3, cfg = CONFIG } = {}) {
  const P = PLAYERS[player];
  const rng = createRng(seed), pr = createRng(seed + 77);
  const d = cfg.difficulty[difficulty];
  const defense = createDefense(cfg, createRng(5));
  const win0 = contactWindow(difficulty, cfg), grow = mode === 'derby' ? cfg.modes.derby.windowGrow : 1;
  const win = scaleWindow(win0, grow);
  const out = { swings: 0, contact: 0, fair: 0, foul: 0, hard: 0, hit: 0, hr: 0, why: {} };
  for (let i = 0; i < n; i++) {
    const p = choosePitch({ mode, difficulty, count: { balls: 0, strikes: 0 }, rng: pr, batterHand: 'R', pitcherHand: 'R' }, cfg);
    if (zoneRatio(p.target.x, p.target.y, cfg) > cfg.swing.chase.from) { i--; continue; } // (he only swings at hittable pitches)
    const flight = buildPitch({ type: p.type, speedMph: p.speedMph, hand: 'R', target: p.target, movementScale: mode === 'derby' ? 0.4 : d.movementScale, pace: d.pitchPace || 1 }, cfg);
    const pitch = { flight, target: p.target, speedMph: p.speedMph, id: i + 1 };
    const err = rng.gauss(0, P.timingSd);
    const tPress = flight.T + err / 1000 - cfg.timing.swingDelay; // (seconds after release)
    // the bat is where he put it in answer to what he saw `react` seconds before he pressed
    const g = pitchGuide(pitch, Math.max(0, tPress - P.react), cfg, difficulty);
    const seen = g.alpha > 0.02 ? g : { x: 0, y: cfg.timing.zoneCenterY }; // (no circle yet: the middle of the zone)
    const aim = { x: seen.x + rng.gauss(0, P.hand * 1.3), y: seen.y - P.under * win.sweet.up + rng.gauss(0, P.hand) };
    const times = resolveSwingTimes(tPress, flight.T, cfg);
    const pt = contactPoint(flight, times.hitTime, times.barrelTime, cfg);
    const c = computeSwing({ errorMs: times.errorMs, aim, ...pt, window: win, windowScale: d.windowScale, batterHand: 'R', batBonus: d.batBonus || 0, ...(mode === 'derby' ? derbyBatting(cfg) : {}), rng }, cfg);
    out.swings++;
    if (!c.made) { out.why[c.reason] = (out.why[c.reason] || 0) + 1; continue; }
    out.contact++;
    const start = flight.at(times.hitTime);
    const sim = simulateBattedBall({ ...c, start: { x: start.x, y: Math.max(1, start.y), z: start.z } }, cfg);
    const plan = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, cfg);
    if (plan.result === 'foul' || (plan.result === 'foulOut' && !plan.fair)) { out.foul++; continue; }
    out.fair++;
    if (c.exitVelocity >= 95) out.hard++;
    if (plan.homer) out.hr++;
    else if (['single', 'double', 'triple', 'insideParkHomer'].includes(plan.result)) out.hit++;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('feel.mjs')) {
  const N = +(process.argv[2] || 3000), player = process.argv[3] || 'average', mode = process.argv[4] || 'quick';
  const pct = (x) => (100 * x).toFixed(0).padStart(3) + '%';
  console.log(`A ${player} player swinging at ${N} hittable pitches per level (${mode}).`);
  console.log('level     contact  miss   | per swing: fair   hit    HR   | of contact: foul  hard-hit | misses: why');
  for (const d of DIFFICULTIES) {
    const r = feel({ difficulty: d, player, mode, n: N });
    const why = Object.entries(r.why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / r.swings).trim()}`).join(', ');
    console.log(`${d.padEnd(9)} ${pct(r.contact / r.swings)}    ${pct(1 - r.contact / r.swings)}   |          ${pct(r.fair / r.swings)}  ${pct(r.hit / r.swings)}  ${pct(r.hr / r.swings)}  |            ${pct(r.foul / Math.max(1, r.contact))}  ${pct(r.hard / Math.max(1, r.contact))}    | ${why}`);
  }
}
