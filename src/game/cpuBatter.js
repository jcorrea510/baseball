// The computer's batter when YOU pitch. Pure logic: he reads the pitch, takes or swings by the count, and if he swings, makes a timing
// error and an aim error. The engine then turns those into a result through the same swing physics the player's bat uses (computeSwing),
// but with his own contact window and none of the player's batting help (cpuSwingInputs). All numbers: config.cpuBat and
// config.difficulty.<level>.cpuBat.
//   1. Read: where he THINKS the pitch will cross, from the pitch guide's early guess plus a read error that grows with the pitch's
//      break, with how well YOU threw it (the grade) and, when it starts as a strike and ends outside the zone, pulled toward where it started.
//   2. Take or swing: a chance by where he thinks it is and the count.
//   3. Errors: timing (spread by grade, a speed change from your last pitches throws it off) and aim (his read plus hand error, a bit
//      under the ball). His Contact rating shrinks the errors and widens his timing windows; Power adds exit speed. A batter with no
//      ratings uses the team's strength k instead.
import { CONFIG } from '../config.js';
import { clamp } from '../util/math.js';
import { isStrike } from '../physics/pitch.js';
import { pitchGuide } from './pitchGuide.js';
import { ratingEffects } from './season.js';

const levelOf = (level, cfg) => (cfg.difficulty[level] || cfg.difficulty.pro).cpuBat;
const hasRatings = (batter) => !!batter && batter.con !== undefined;

/** How much his errors shrink (< 1) or grow: the Contact rating, or for a batter with no ratings the team's strength k. */
function errorScale(batter, strength, cfg) {
  if (hasRatings(batter)) return 1 / ratingEffects(batter, cfg).window;
  return 1 - cfg.cpuBat.strengthSd * (strength || 0);
}

/** Where the pitch would cross the plate if it did not break at all (target minus the movement its spin adds). */
export function startSpot(flight, cfg = CONFIG) {
  const T2 = 0.5 * flight.T * flight.T;
  return {
    x: flight.target.x - flight.accel.x * T2,
    y: flight.target.y - (flight.accel.y + cfg.physics.gravity) * T2, // (gravity pulls down: -g is "no movement")
  };
}

/** The share of his errors your pitch's grade causes ('wild' counts as its kind: a hang or a sail). */
function gradeFactor(pitch, cfg) {
  const G = cfg.cpuBat.gradeFactor;
  const key = pitch.grade === 'wild' ? (pitch.wildKind || 'sail') : pitch.grade;
  return G[key] ?? 1;
}

/**
 * Where he thinks the pitch will cross (ft, in the plane over the plate): the pitch guide's guess `readTime` before his swing must
 * start, plus a gaussian error of `sd` (his base read error) x (1 + breakRead x the pitch's break in ft) x the grade factor x `fadeOut`
 * when the pitch starts in the zone and finishes outside it. The guess is the pitch guide of `cpuBat.readGuide` on every level: the
 * level's own guide is YOUR batting help (harder on All-Star), and reading with it made his eye worst on the level where he should
 * hit best - his level only shows in `sd`.
 */
export function perceivedSpot(pitch, sd, rng, cfg = CONFIG) {
  const C = cfg.cpuBat;
  const g = pitchGuide(pitch, pitch.tCross - C.readTime - (pitch.tRelease || 0), cfg, C.readGuide);
  const s0 = startSpot(pitch.flight, cfg);
  const breakFt = Math.hypot(pitch.target.x - s0.x, pitch.target.y - s0.y);
  const grade = gradeFactor(pitch, cfg);
  let sdFt = sd * (1 + C.breakRead * breakFt) * grade;
  let gx = g.x, gy = g.y;
  if (isStrike(s0.x, s0.y, cfg) && !isStrike(pitch.target.x, pitch.target.y, cfg)) {
    // it looks like a strike for most of its flight and breaks out late: his read is pulled toward where it started, and is less sure
    const pull = Math.min(1, C.fadePull * grade);
    gx += (s0.x - gx) * pull;
    gy += (s0.y - gy) * pull;
    sdFt *= C.fadeOut;
  }
  return { x: gx + rng.gauss(0, sdFt), y: gy + rng.gauss(0, sdFt) };
}

/**
 * How far from the middle of the strike zone a spot is, as the umpire's zone sees it: 1 = on its edge (the same box `isStrike` calls -
 * the plate plus a ball's width, from the knees to the letters), under 1 = a strike, 1.3 = a bit further out than that again. (The
 * oval `zoneRatio` called the corners of the zone and the low strike "on the edge": he took corner strikes like balls.)
 */
export function zoneBoxRatio(x, y, cfg = CONFIG) {
  const P = cfg.pitch, r = cfg.physics.ballRadius;
  const mid = (P.zoneBottom + P.zoneTop) / 2, half = (P.zoneTop - P.zoneBottom) / 2 + r;
  return Math.max(Math.abs(x) / P.zoneHalfWidth, Math.abs(y - mid) / half);
}

/** His chance to swing at a pitch he thinks is at `ratio` (zoneBoxRatio), for this count and batter. */
function swingChance(ratio, count, batter, cfg) {
  const W = cfg.cpuBat.swing, B = W.bands;
  const { balls, strikes } = count;
  const heart = ratio < B.heart;
  if (balls === 3 && strikes === 0) return heart && hasRatings(batter) && batter.pow >= W.threeOhPower ? W.threeOhHeart : 0;
  const two = strikes === 2;
  const ahead = balls - strikes >= W.aheadBy;
  const con = hasRatings(batter) ? batter.con : 50;
  const star = 1 - W.starChase * (con - 50) / 50; // good contact hitters chase less
  if (ratio < B.zone) return (two ? W.zoneTwo : W.zone) * (ahead && heart ? W.aheadHeart : 1);
  if (ratio < B.edge) return (two ? W.edgeTwo : W.edge) * (ahead ? W.aheadEdge : 1) * star;
  if (ratio < B.chase) return (two ? W.chaseTwo : W.chase) * star;
  return W.waste;
}

/**
 * Take or swing.
 * @param {object} i  { pitch, count: {balls, strikes}, recent: [{type, speedMph}] (last two, oldest first), batter, level, strength (k, -1.5..1.5), rng }
 * @returns {{swing:false}|{swing:true, errorMs:number, aim:{x:number,y:number}, protect:boolean}}
 */
export function decideSwing(i, cfg = CONFIG) {
  const C = cfg.cpuBat, L = levelOf(i.level, cfg), rng = i.rng, pitch = i.pitch;
  const scale = errorScale(i.batter, i.strength, cfg);
  const seen = perceivedSpot(pitch, L.readSd * scale, rng, cfg);
  const ratio = zoneBoxRatio(seen.x, seen.y, cfg);
  if (!rng.chance(swingChance(ratio, i.count, i.batter, cfg))) return { swing: false };
  const protect = i.count.strikes === 2;
  // timing: a gaussian (wider on a pitch you threw well, narrower when he just protects the plate) and the speed change from your
  // last pitches - a slower one finds him early (negative), a faster one late; he is a little late on the corners
  let bias = 0;
  const recent = i.recent || [];
  if (recent.length) {
    const mean = recent.reduce((a, r) => a + r.speedMph, 0) / recent.length;
    bias = clamp((pitch.speedMph - mean) * C.changeBias, -C.changeCap, C.changeCap);
  }
  const sd = L.timingSd * scale * gradeFactor(pitch, cfg) * (protect ? C.protectSd : 1);
  const errorMs = rng.gauss(0, sd) + bias + (ratio > C.edgeFrom ? C.edgeTiming : 0);
  const aimSd = L.aimSd * scale;
  const aim = {
    x: seen.x + rng.gauss(0, aimSd),
    y: seen.y + rng.gauss(0, aimSd) - C.under * L.window.sweet.up,
  };
  return { swing: true, errorMs, aim, protect };
}

/**
 * What the engine feeds computeSwing for his swing: his own window (never the level's player window), the timing-window scale from his
 * Contact rating (or team strength), exit speed from his Power (or team strength) and no bat bonus or aim help.
 */
export function cpuSwingInputs(level, batter, strength, cfg = CONFIG) {
  const L = levelOf(level, cfg), C = cfg.cpuBat;
  const rated = hasRatings(batter);
  const eff = ratingEffects(rated ? batter : null, cfg);
  const k = strength || 0;
  return {
    window: L.window,
    windowScale: L.windowScale * (rated ? eff.window : 1 / (1 - C.strengthSd * k)),
    evBonus: rated ? eff.ev : C.strengthEv * k,
    batBonus: 0,
    aimAssist: L.aimAssist,
  };
}
