// Headless playtest: run many simulated games/derbies with a bot and print statistics + sanity checks.
// usage: node scripts/sim.mjs [games=200] [errSd=14] [difficulty=pro]
import { Engine } from '../src/game/engine.js';
import { createBot } from '../src/game/bot.js';

const games = +(process.argv[2] || 200);
const errSd = +(process.argv[3] || 14);
const difficulty = process.argv[4] || 'pro';
const DT = 1 / 120;

function run(mode, seed, extra = {}) {
  const e = new Engine({ mode, difficulty, seed, ...extra });
  const bot = createBot(e, { errSd, seed: seed + 1 });
  const counts = { pitches: 0, results: {} };
  const byGrade = {};
  e.on('result', (r) => { if (r.grade && r.result && r.kind !== 'pitch') { byGrade[r.grade] ||= {}; const k = ['homer','insideParkHomer'].includes(r.result) ? 'HR' : ['single','double','triple'].includes(r.result) ? 'hit' : 'out'; byGrade[r.grade][k] = (byGrade[r.grade][k] || 0) + 1; byGrade[r.grade].n = (byGrade[r.grade].n || 0) + 1; } });
  let violations = [];
  e.on('windup', () => counts.pitches++);
  e.on('result', (r) => { counts.results[r.result || r.call || r.kind] = (counts.results[r.result || r.call || r.kind] || 0) + 1; });
  e.on('count', (c) => {
    if (c.balls < 0 || c.balls > 3 || c.strikes < 0 || c.strikes > 2 || c.outs < 0 || c.outs > 3) violations.push('bad count ' + JSON.stringify(c));
  });
  let fin = null;
  e.on('gameOver', (p) => { fin = p; });
  e.start();
  let t = 0;
  const limit = 20000; // sim seconds
  while (!e.over && t < limit) {
    e.update(DT); bot.update(); t += DT;
    if (e.game && (e.game.outs > 3 || e.game.bases.filter(Boolean).length > 3)) violations.push('bad game state');
  }
  if (!e.over) violations.push('STUCK in phase ' + e.phase);
  return { e, fin, counts, violations, t, byGrade };
}

let totalPitches = 0, wins = 0, runsFor = 0, runsAgainst = 0, hrs = 0, hits = 0, ab = 0, so = 0, bb = 0, gameSecs = 0, allViol = [];
const res = {};
const byGrade = {};
for (let i = 0; i < games; i++) {
  const r = run('quick', 1000 + i);
  allViol.push(...r.violations);
  totalPitches += r.counts.pitches;
  const g = r.e.game;
  runsFor += g.score[r.e.playerSide]; runsAgainst += g.score[r.e.oppSide]; if (g.winner === r.e.playerSide) wins++;
  hrs += r.e.stats.hr; hits += r.e.stats.hits; ab += r.e.stats.ab; so += r.e.stats.strikeouts; bb += r.e.stats.walks;
  gameSecs += r.t;
  for (const k in r.counts.results) res[k] = (res[k] || 0) + r.counts.results[k];
  for (const g in r.byGrade) { byGrade[g] ||= {}; for (const k in r.byGrade[g]) byGrade[g][k] = (byGrade[g][k] || 0) + r.byGrade[g][k]; }
}
console.log(`QUICK (${difficulty}, bot timing sd ${errSd}ms) ${games} games`);
console.log(`  win% ${(100 * wins / games).toFixed(0)}  runs/g for ${(runsFor / games).toFixed(2)} against ${(runsAgainst / games).toFixed(2)}`);
console.log(`  AVG ${(hits / ab).toFixed(3)}  HR/g ${(hrs / games).toFixed(2)}  K/g ${(so / games).toFixed(1)}  BB/g ${(bb / games).toFixed(1)}  pitches/g ${(totalPitches / games).toFixed(0)}  game length ${(gameSecs / games / 60).toFixed(1)} min`);
console.log('  results:', Object.entries(res).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));

for (const g of ['perfect', 'good', 'early', 'late']) { const b = byGrade[g]; if (!b) continue; console.log(`  ${g.padEnd(8)} n=${String(b.n).padStart(4)}  HR ${((b.HR||0)/b.n*100).toFixed(0)}%  hit ${((b.hit||0)/b.n*100).toFixed(0)}%  out ${((b.out||0)/b.n*100).toFixed(0)}%`); }

// Derby
let dHR = 0, dLong = 0, dStreak = 0;
for (let i = 0; i < Math.min(games, 100); i++) {
  const r = run('derby', 5000 + i);
  allViol.push(...r.violations);
  dHR += r.e.derby.hr; dLong = Math.max(dLong, r.e.derby.longest); dStreak = Math.max(dStreak, r.e.derby.bestStreak);
}
console.log(`DERBY ${Math.min(games, 100)} runs: avg HR ${(dHR / Math.min(games, 100)).toFixed(1)}  longest ${dLong}  best streak ${dStreak}`);
console.log(allViol.length ? 'VIOLATIONS:\n' + [...new Set(allViol)].slice(0, 10).join('\n') : 'no violations, no stuck games');
