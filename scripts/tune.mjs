// Tuning helper: how often does each kind of batted ball become a hit? (empty bases)
// usage: node scripts/tune.mjs [samples=4000] [timingSdMs=25] [difficulty=pro]
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { computeContact } from '../src/game/contact.js';
import { simulateBattedBall, battedBallType } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';

const N = +(process.argv[2] || 4000), sd = +(process.argv[3] || 25), diff = process.argv[4] || 'pro';
const rng = createRng(123);
const defense = createDefense(CONFIG, createRng(5));
const tab = {};
const bump = (k, r) => { const t = (tab[k] ||= { n: 0, hit: 0, hr: 0, out: 0, foul: 0 }); t.n++; t[r]++; };
let evSum = 0, evN = 0;
for (let i = 0; i < N; i++) {
  const c = computeContact({ errorMs: rng.gauss(0, sd), locX: rng.range(-0.6, 0.6), locY: 2.5 + rng.range(-0.7, 0.7), pitchSpeed: 84, windowScale: CONFIG.difficulty[diff].windowScale, aim: 0, batterHand: 'R', rng });
  if (!c.made) continue;
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const plan = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, CONFIG);
  const type = battedBallType(c.launchAngle);
  const r = plan.homer ? 'hr' : ['single', 'double', 'triple', 'insideParkHomer'].includes(plan.result) ? 'hit' : (plan.result === 'foul' ? 'foul' : 'out');
  bump(type, r); bump('ALL:' + c.grade, r);
  evSum += c.exitVelocity; evN++;
}
for (const [k, t] of Object.entries(tab).sort()) {
  const bip = t.n - t.foul;
  console.log(k.padEnd(14), `n=${String(t.n).padStart(5)}  HR ${(100 * t.hr / t.n).toFixed(0).padStart(3)}%  hit ${(100 * t.hit / t.n).toFixed(0).padStart(3)}%  out ${(100 * t.out / t.n).toFixed(0).padStart(3)}%  foul ${(100 * t.foul / t.n).toFixed(0).padStart(3)}%   BABIP(fair, no HR) ${(t.hit / Math.max(1, bip - t.hr)).toFixed(3)}`);
}
console.log('avg exit velocity', (evSum / evN).toFixed(1));
