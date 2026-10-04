// How the computer's pitching should feel. Two parts:
//   node scripts/pitchfeel.mjs --baseline [halves=20000]
//     Measures what today's instant computer half-inning (src/game/aiHalf.js) gives up per half-inning on each level
//     (and at Pro against opposing clubs of rating 26 / 40 / 54 / 68) and saves it to scripts/pitchfeelTargets.json.
//     That file is the balance target the real pitching has to match.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { createGame } from '../src/game/rules.js';
import { simulateHalf } from '../src/game/aiHalf.js';
import { gameConfig } from '../src/game/season.js';

const TARGETS = fileURLToPath(new URL('./pitchfeelTargets.json', import.meta.url));
const RATINGS = [26, 40, 54, 68]; // a club's strength: tier 1 .. tier 5 (config season.tierRating) and a very strong one
const HITS = new Set(['single', 'double', 'triple', 'hr']);

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Average runs / hits / walks (hit batsmen included) / strikeouts of `halves` empty-diamond half-innings. */
export function measureHalf({ difficulty, cfg = CONFIG, halves = 20000, seed = 11 }) {
  const rng = createRng(seed);
  let runs = 0, h = 0, bb = 0, k = 0;
  for (let i = 0; i < halves; i++) {
    const g = createGame({ innings: 9 });
    g.half = 'top';
    const res = simulateHalf(g, { difficulty, rng }, cfg);
    runs += res.runs;
    for (const e of res.events) {
      if (HITS.has(e.kind)) h++;
      else if (e.kind === 'bb') bb++;
      else if (e.kind === 'strikeout') k++;
    }
  }
  return { runs: round3(runs / halves), h: round3(h / halves), bb: round3(bb / halves), k: round3(k / halves) };
}

function baseline(halves) {
  const out = {};
  DIFFICULTIES.forEach((level, i) => { out[level] = measureHalf({ difficulty: level, halves, seed: 100 + i }); });
  out.byRating = {};
  RATINGS.forEach((r, i) => {
    const m = measureHalf({ difficulty: 'pro', cfg: gameConfig('pro', r), halves, seed: 200 + i });
    out.byRating[String(r)] = { runs: m.runs, h: m.h, bb: m.bb, k: m.k };
  });
  writeFileSync(TARGETS, JSON.stringify(out, null, 2) + '\n');

  console.log(`Today's simulated half-inning (${halves} halves each, empty diamond, 0 outs)`);
  console.log('level / rating      runs     hits    walks      Ks');
  const row = (label, m) => console.log(`${label.padEnd(16)} ${m.runs.toFixed(3).padStart(8)} ${m.h.toFixed(3).padStart(8)} ${m.bb.toFixed(3).padStart(8)} ${m.k.toFixed(3).padStart(8)}`);
  for (const level of DIFFICULTIES) row(level, out[level]);
  for (const r of RATINGS) row(`pro, rating ${r}`, out.byRating[String(r)]);
  console.log(`Saved ${TARGETS}`);
}

const args = process.argv.slice(2);
if (args[0] === '--baseline') {
  const n = Number(args[1]);
  baseline(Number.isFinite(n) && n > 0 ? Math.floor(n) : 20000);
} else {
  console.log('Usage: node scripts/pitchfeel.mjs --baseline [halves=20000]');
}
