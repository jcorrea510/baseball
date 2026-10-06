// Scouting the computer's batter while you pitch (pure logic): his HOT and COLD zones, and the catcher's call.
//
// Hot / cold zones: the strike zone as a 3 x 3 grid (row 0 = up, column 0 = the third-base side, -x), each cell -1 (cold:
// he hits it worse), 0 or +1 (hot: he hits it better). Every batter has his own, the same every time he comes up (made from his
// name): two hot cells side by side, two cold ones side by side well away from them - a third hot one for a slugger (Power), a third
// cold one for a weak contact hitter. They only change how well he hits a pitch there (cpuBatter: his errors, his exit speed), never
// whether it is a strike; on average they cancel out, so the game is no harder or easier - it only pays to aim well.
//
// The catcher's call: before every pitch he puts down a sign - a pitch type from your pitcher's arsenal and a spot - from the count,
// your last pitches and the batter's cold zones. Throw that pitch on his spot (within `scout.call.radius`) and the batter reads it a
// little worse (cpuBat.callBonus). It is only advice: any pitch anywhere is yours to throw. Made from the game's seed and the pitch
// number (never the engine's random numbers, so a game plays out the same with or without it).
import { CONFIG } from '../config.js';
import { clamp } from '../util/math.js';

const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// a tiny deterministic random sequence (0..1) from a number
function seq(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const NEIGH = (i) => { const r = Math.floor(i / 3), c = i % 3, out = []; for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const R = r + dr, C = c + dc; if (R >= 0 && R < 3 && C >= 0 && C < 3) out.push(R * 3 + C); } return out; };
const far = (a, b) => Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) + Math.abs((a % 3) - (b % 3));

/** His hot and cold zones: 9 numbers (-1 / 0 / +1), row by row from the top, columns from the third-base side (-x) to the first-base side. */
export function hotZones(batter, cfg = CONFIG) {
  const rnd = seq(hash(String((batter && (batter.name || batter.id)) ?? 'batter') + ':zones'));
  const z = new Array(9).fill(0);
  const hot = Math.floor(rnd() * 9);
  z[hot] = 1;
  const hn = NEIGH(hot);
  z[hn[Math.floor(rnd() * hn.length)]] = 1;
  // cold: a cell well away from the hot ones, and one next to it
  const away = [...Array(9).keys()].filter((i) => z[i] === 0 && far(i, hot) >= 2);
  const cold = away.length ? away[Math.floor(rnd() * away.length)] : z.indexOf(0);
  z[cold] = -1;
  const cn = NEIGH(cold).filter((i) => z[i] === 0);
  if (cn.length) z[cn[Math.floor(rnd() * cn.length)]] = -1;
  const S = cfg.scout;
  const pow = batter && batter.pow !== undefined ? batter.pow : 50, con = batter && batter.con !== undefined ? batter.con : 50;
  const free = () => [...Array(9).keys()].filter((i) => z[i] === 0);
  if (pow >= S.sluggerPower) { const f = free().filter((i) => NEIGH(i).some((j) => z[j] === 1)); if (f.length) z[f[Math.floor(rnd() * f.length)]] = 1; }
  if (con <= S.weakContact) { const f = free().filter((i) => NEIGH(i).some((j) => z[j] === -1)); if (f.length) z[f[Math.floor(rnd() * f.length)]] = -1; }
  return z;
}

/** Which cell of the zone a spot is in (0..8), or -1 when it is not in the strike zone. */
export function zoneCell(x, y, cfg = CONFIG) {
  const P = cfg.pitch, w = P.zoneHalfWidth;
  if (Math.abs(x) > w || y < P.zoneBottom || y > P.zoneTop) return -1;
  const c = clamp(Math.floor(((x + w) / (2 * w)) * 3), 0, 2);
  const r = clamp(Math.floor(((P.zoneTop - y) / (P.zoneTop - P.zoneBottom)) * 3), 0, 2);
  return r * 3 + c;
}
/** The middle of a cell (ft, in the plane over the plate). */
export function cellCenter(i, cfg = CONFIG) {
  const P = cfg.pitch, w = P.zoneHalfWidth, r = Math.floor(i / 3), c = i % 3;
  return { x: -w + (c + 0.5) * (2 * w) / 3, y: P.zoneTop - (r + 0.5) * (P.zoneTop - P.zoneBottom) / 3 };
}
/** How hot a pitch crossing at (x, y) is for him: -1 cold .. +1 hot (0 off the plate or in a plain cell). */
export function heatAt(zones, x, y, cfg = CONFIG) {
  const i = zoneCell(x, y, cfg);
  return i < 0 || !zones ? 0 : zones[i];
}

const FAST = new Set(['fastball', 'sinker', 'cutter', 'heater']);

/**
 * The catcher's sign for the next pitch: { type, x, y, why } - why = 'ahead' | 'even' | 'behind' | 'putaway' (a word for the screen).
 * @param {object} i { pitches (your pitcher's arsenal), count {balls, strikes}, recent [{type, speedMph}], zones, batterHand 'L'|'R', seed, n (pitch number) }
 */
export function catcherCall(i, cfg = CONFIG) {
  const S = cfg.scout.call, P = cfg.pitch;
  const rnd = seq(hash(`${i.seed}:${i.n}:call`));
  const pitches = i.pitches && i.pitches.length ? i.pitches : ['fastball'];
  const fast = pitches.filter((t) => FAST.has(t)), slow = pitches.filter((t) => !FAST.has(t));
  const last = i.recent && i.recent.length ? i.recent[i.recent.length - 1] : null;
  const { balls, strikes } = i.count;
  const away = i.batterHand === 'L' ? -1 : 1; // (+x is away from a right-handed batter as you look in)
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  let type, spot, why;
  if (strikes === 2 && balls < 3) {
    // put him away: a breaking ball just off the plate, low and away (or a fastball up out of the zone)
    why = 'putaway';
    if (slow.length && rnd() < S.putawayBreaking) { type = pick(slow); spot = { x: away * (P.zoneHalfWidth + S.offPlate), y: P.zoneBottom - S.belowZone }; }
    else { type = fast.length ? pick(fast) : pick(pitches); spot = { x: away * P.zoneHalfWidth * 0.5, y: P.zoneTop + S.aboveZone }; }
  } else {
    why = balls - strikes >= 2 ? 'behind' : strikes > balls ? 'ahead' : 'even';
    // what to throw: behind in the count, the fastball; else change speeds off the last pitch
    if (why === 'behind' || !slow.length) type = fast.length ? pick(fast) : pick(pitches);
    else if (last && FAST.has(last.type)) type = rnd() < S.changeAfterFast ? pick(slow) : pick(fast.length ? fast : pitches);
    else type = fast.length && rnd() < S.fastAfterSlow ? pick(fast) : pick(pitches);
    // where: a cold cell of his on the edge of the zone if he has one there, else a corner - low, and away more often than in
    const zones = i.zones || new Array(9).fill(0);
    const edges = [0, 1, 2, 3, 5, 6, 7, 8];
    const cold = edges.filter((k) => zones[k] < 0);
    let cell;
    if (cold.length && rnd() < S.coldShare) cell = pick(cold);
    else {
      const low = rnd() < S.lowShare;
      const awayCol = away > 0 ? 2 : 0;
      const col = rnd() < S.awayShare ? awayCol : 2 - awayCol;
      cell = (low ? 6 : rnd() < 0.5 ? 3 : 0) + col;
      if (zones[cell] > 0) cell = (cell + 3) % 9; // (never right into a hot one)
    }
    const c = cellCenter(cell, cfg);
    // (on the edge cells, a touch toward the edge of the zone: a pitcher's spot, not the middle of a box)
    const w = P.zoneHalfWidth;
    spot = { x: c.x + Math.sign(c.x) * (Math.abs(c.x) > 0.01 ? w / 6 * S.toEdge : 0), y: c.y + (cell < 3 ? 1 : cell > 5 ? -1 : 0) * ((P.zoneTop - P.zoneBottom) / 6) * S.toEdge };
    if (why === 'behind') spot = { x: spot.x * S.behindIn, y: (spot.y - (P.zoneTop + P.zoneBottom) / 2) * S.behindIn + (P.zoneTop + P.zoneBottom) / 2 }; // (behind: nearer the middle - a strike)
  }
  if (!pitches.includes(type)) type = pitches[0];
  return { type, x: spot.x, y: spot.y, why };
}

/** Did you throw the catcher's call? (the same pitch, aimed within `scout.call.radius` of his spot) */
export function onCall(call, type, aim, cfg = CONFIG) {
  return !!call && call.type === type && Math.hypot(aim.x - call.x, aim.y - call.y) <= cfg.scout.call.radius;
}
