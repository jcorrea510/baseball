// How pitching feels. Two parts:
//   node scripts/pitchfeel.mjs [halves=600] [new|average|good] [level]   (no level: every level)
//     A simulated PERSON pitches the computer's half-innings through the real engine (src/game/bot.js pitching: he picks a pitch,
//     aims at a corner / the knees / off the plate with two strikes with a shaky hand, and taps the ring with a human timing
//     spread) against the computer's batters. Prints runs / hits / walks (+ hit batters) / strikeouts / home runs per half,
//     pitches per half, the share of each ring grade, chase % (swings at pitches out of the zone), contact % (bat on ball per
//     swing), K / BB / HBP per batter and the referee's verdict on every ball in play - next to the target from --baseline.
//   The targets (scripts/pitchfeelTargets.json) are what the old instant computer half-inning gave up per half-inning on each level
//   (and at Pro against opposing clubs of rating 26 / 40 / 54 / 68), measured over 20000 halves each before it was removed (the
//   pitching balance stage). They are fixed now: --baseline only prints them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { gameConfig } from '../src/game/season.js';
import { Engine } from '../src/game/engine.js';
import { createBot } from '../src/game/bot.js';
import { auditPlan } from '../src/game/playAudit.js';
import { isHitResult } from '../src/game/rules.js';

const TARGETS = fileURLToPath(new URL('./pitchfeelTargets.json', import.meta.url));
const RATINGS = [26, 40, 54, 68]; // a club's strength: tier 1 .. tier 5 (config season.tierRating) and a very strong one

const round3 = (x) => Math.round(x * 1000) / 1000;

// How good the simulated person pitching is: ring tap spread (ms), hand shake on the aim (ft), how often he throws the wrong pitch,
// whether he mixes speeds on purpose, how often he throws the catcher's call and steers clear of a hot zone (see bot.js).
export const PITCHERS = {
  new: { tapSd: 75, shake: 0.2, wrongPitch: 0.15, followCall: 0.15, avoidHot: 0.2 },
  average: { tapSd: 50, shake: 0.12, followCall: 0.4, avoidHot: 0.7 },
  good: { tapSd: 30, shake: 0.07, mixSpeeds: true, followCall: 0.6, avoidHot: 0.9 },
};

/** The balance target (runs / hits / walks / Ks per half) for a level, or for a League club's rating at Pro. */
export function targetFor(level, rating) {
  const t = JSON.parse(readFileSync(TARGETS, 'utf8'));
  return rating ? t.byRating[String(rating)] : t[level];
}

/**
 * `halves` of the computer's half-innings (each a fresh Quick Game's first half: empty bases, nobody out, a fresh starter), pitched
 * by the simulated person `player` (a key of PITCHERS) on `level`; `rating` = a League club's strength (gameConfig) instead of a
 * Quick Game opponent. Returns averages per half and the shares.
 */
export function runHalves({ halves = 600, player = 'average', level = 'pro', rating = null, seed = 1, dt = 1 / 60 } = {}) {
  const cfg = rating ? gameConfig(level, rating) : CONFIG;
  const T = { runs: 0, h: 0, bb: 0, hbp: 0, k: 0, hr: 0, pa: 0, pitches: 0, swings: 0, made: 0, outPitches: 0, outSwings: 0, plays: 0, stuck: 0 };
  const grades = { perfect: 0, good: 0, ok: 0, wild: 0 };
  const audit = [];
  for (let i = 0; i < halves; i++) {
    const s = (seed * 7919 + i * 104729) >>> 0;
    const e = new Engine({ mode: 'quick', difficulty: level, seed: s, cpuHalf: 'pitch' }, cfg);
    const bot = createBot(e, { seed: s + 1, pitcher: PITCHERS[player] });
    e.on('release', ({ pitch }) => { if (e.offense !== 'cpu') return; T.pitches++; if (!pitch.isStrike) T.outPitches++; });
    e.on('pitchGrade', ({ grade }) => { grades[grade]++; });
    e.on('swing', ({ swing, pitch }) => {
      if (e.offense !== 'cpu') return;
      T.swings++; if (swing.made) T.made++;
      if (!pitch.isStrike) T.outSwings++;
    });
    e.on('result', (r) => {
      if (e.offense !== 'cpu') return;
      if (r.plan) { T.plays++; for (const p of auditPlan(r.plan, e.defense)) audit.push(`seed ${s}: ${p}`); }
      if (r.kind !== 'pa') return;
      T.pa++;
      if (isHitResult(r.result)) T.h++;
      if (r.result === 'walk') T.bb++;
      if (r.result === 'hitByPitch') T.hbp++;
      if (/^strikeout/.test(r.result)) T.k++;
      if (r.result === 'homer' || r.result === 'insideParkHomer') T.hr++;
    });
    e.start();
    let t = 0;
    while (e.offense === 'cpu' && !e.over && t < 900) { e.update(dt); bot.update(); t += dt; }
    if (e.offense === 'cpu' && !e.over) { T.stuck++; audit.push(`seed ${s}: the half never ended (phase ${e.phase})`); }
    T.runs += e.game.score[e.oppSide];
  }
  const n = halves, per = (x) => round3(x / n), share = (a, b) => round3(b ? a / b : 0);
  const totalGrades = Object.values(grades).reduce((a, b) => a + b, 0);
  return {
    runs: per(T.runs), h: per(T.h), bb: per(T.bb + T.hbp), walks: per(T.bb), hbp: per(T.hbp), k: per(T.k), hr: per(T.hr), pa: per(T.pa),
    pitches: per(T.pitches),
    grades: Object.fromEntries(Object.entries(grades).map(([g, v]) => [g, share(v, totalGrades)])),
    chase: share(T.outSwings, T.outPitches), contact: share(T.made, T.swings), swingRate: share(T.swings, T.pitches),
    kRate: share(T.k, T.pa), bbRate: share(T.bb, T.pa), hbpRate: share(T.hbp, T.pa),
    plays: T.plays, audit,
  };
}

function report(halves, player, levels) {
  const pct = (x) => (100 * x).toFixed(0).padStart(3) + '%';
  const f = (x) => x.toFixed(2).padStart(5);
  console.log(`A ${player} person pitching ${halves} of the computer's half-innings per level (target = today's simulated half).`);
  console.log('level      runs (target)   H (tgt)     BB+HBP (tgt)   K (tgt)    HR  | pitches | grades P / G / OK / W  | chase contact | per batter K  BB  HBP | referee');
  for (const level of levels) {
    const r = runHalves({ halves, player, level });
    const t = targetFor(level);
    const g = r.grades;
    console.log(`${level.padEnd(9)} ${f(r.runs)} (${f(t.runs)})  ${f(r.h)} (${f(t.h)})  ${f(r.bb)} (${f(t.bb)})   ${f(r.k)} (${f(t.k)})  ${f(r.hr)} |  ${r.pitches.toFixed(1).padStart(5)}  | ${pct(g.perfect)} ${pct(g.good)} ${pct(g.ok)} ${pct(g.wild)}  |  ${pct(r.chase)}  ${pct(r.contact)}  |        ${pct(r.kRate)} ${pct(r.bbRate)} ${pct(r.hbpRate)} | ${r.audit.length ? r.audit.length + ' PROBLEMS: ' + r.audit.slice(0, 3).join('; ') : 'no problems'} (${r.plays} balls in play)`);
    console.log(`          runs vs target ${pct(r.runs / t.runs)}`);
  }
}

/** The recorded targets (the old simulated half, measured before it was removed). */
function baseline() {
  const t = JSON.parse(readFileSync(TARGETS, 'utf8'));
  console.log('The targets are recorded (the old simulated half-inning, 20000 halves each, empty diamond, 0 outs) in ' + TARGETS);
  console.log('level / rating      runs     hits    walks      Ks');
  const row = (label, m) => console.log(`${label.padEnd(16)} ${m.runs.toFixed(3).padStart(8)} ${m.h.toFixed(3).padStart(8)} ${m.bb.toFixed(3).padStart(8)} ${m.k.toFixed(3).padStart(8)}`);
  for (const level of DIFFICULTIES) row(level, t[level]);
  for (const r of RATINGS) row(`pro, rating ${r}`, t.byRating[String(r)]);
}

const args = process.argv.slice(2);
if (process.argv[1] && process.argv[1].endsWith('pitchfeel.mjs')) {
  if (args[0] === '--baseline') baseline();
  else {
    const n = Number(args[0]);
    const player = args[1] || 'average';
    if (!PITCHERS[player] || (args[2] && !DIFFICULTIES.includes(args[2]))) {
      console.log('Usage: node scripts/pitchfeel.mjs [halves=600] [new|average|good] [rookie|pro|allstar]   or   --baseline (prints the recorded targets)');
    } else report(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 600, player, args[2] ? [args[2]] : DIFFICULTIES);
  }
}
