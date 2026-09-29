// The computer's half-inning. It is not fielded - it is simulated instantly from odds in config.js
// and returned as a short list of "highlights" for the summary screen.
import { CONFIG } from '../config.js';
import * as rules from './rules.js';

const DIRS = ['to left', 'to center', 'to right', 'up the middle', 'down the left-field line', 'down the right-field line', 'into the gap'];

function describe(kind, name, rng, extra = {}) {
  const dir = rng.pick(DIRS);
  switch (kind) {
    case 'single': return `${name} singles ${dir}.`;
    case 'double': return `${name} doubles ${dir}.`;
    case 'triple': return `${name} triples ${dir}!`;
    case 'homer': return `${name} crushes a home run${extra.runs > 1 ? ` (${extra.runs}-run)` : ''}!`;
    case 'groundout': return `${name} grounds out.`;
    case 'doublePlay': return `${name} grounds into a double play.`;
    case 'flyout': return `${name} flies out ${dir.replace('down the', 'near the').replace('into the gap', 'to deep center')}.`;
    case 'sacFly': return `${name} hits a sacrifice fly.`;
    case 'walk': return `${name} works a walk.`;
    case 'strikeout': return `${name} strikes out.`;
    default: return `${name} is out.`;
  }
}

/**
 * Play out the current half-inning of `g` (which must be the computer's half).
 * @param {object} g   game state from rules.createGame()
 * @param {object} o   { difficulty, rng, lineup: [{name}] }
 * @returns {{events: Array<{text:string, kind:string, runs:number}>, runs:number}}
 */
export function simulateHalf(g, o, cfg = CONFIG) {
  const rng = o.rng;
  const table = cfg.difficulty[o.difficulty].ai;
  const half = g.half;
  const events = [];
  let totalRuns = 0;
  let guard = 0;
  while (!rules.halfIsOver(g) && guard++ < 40) {
    const idx = g.lineupIdx[half] % 9;
    const batter = { id: `${half}-${g.plateAppearances[half]}`, name: (o.lineup && o.lineup[idx] && o.lineup[idx].name) || `Batter ${idx + 1}` };
    const name = batter.name;
    const kind = rng.weighted(table);
    let res;
    let text;
    if (kind === 'k') {
      g.strikes = 2;
      res = rules.pitchStrike(g, { swinging: rng.chance(0.65) });
      text = describe('strikeout', name, rng);
    } else if (kind === 'bb') {
      g.balls = 3;
      res = rules.pitchBall(g, batter);
      text = describe('walk', name, rng);
    } else {
      const play = buildPlay(g, kind, rng);
      res = rules.applyPlay(g, play, batter);
      text = describe(play.result === 'homer' ? 'homer' : play.result, name, rng, { runs: res.runs });
    }
    totalRuns += res.runs || 0;
    events.push({ text, kind: kind === 'k' ? 'strikeout' : kind, runs: res.runs || 0 });
  }
  return { events, runs: totalRuns };
}

function buildPlay(g, kind, rng) {
  const b = g.bases;
  const on1 = !!b[0], on2 = !!b[1], on3 = !!b[2];
  const outs = g.outs;
  const moves = [];
  const push = (from, to, out = false) => moves.push({ from, to, out });
  switch (kind) {
    case 'single': {
      if (on3) push(3, 4);
      if (on2) push(2, rng.chance(0.62) ? 4 : (on3 ? 3 : 3));
      if (on1) {
        const to2 = moves.find((m) => m.from === 2);
        push(1, !on2 || (to2 && to2.to === 4) ? (rng.chance(0.22) && (!to2 || to2.to === 4) ? 3 : 2) : 2);
      }
      // resolve: if runner from 2 is going to 3 and runner from 3 holds? (3 always scores above)
      return { result: 'single', batterDest: 1, moves, outsMade: 0 };
    }
    case 'double': {
      if (on3) push(3, 4);
      if (on2) push(2, 4);
      if (on1) push(1, rng.chance(0.4) ? 4 : 3);
      return { result: 'double', batterDest: 2, moves, outsMade: 0 };
    }
    case 'triple': {
      for (const f of [3, 2, 1]) if (b[f - 1]) push(f, 4);
      return { result: 'triple', batterDest: 3, moves, outsMade: 0 };
    }
    case 'hr': {
      for (const f of [3, 2, 1]) if (b[f - 1]) push(f, 4);
      return { result: 'homer', batterDest: 4, moves, outsMade: 0 };
    }
    case 'groundout': {
      if (on1 && outs < 2 && rng.chance(0.35)) {
        // double play: runner from 1st is out at second
        push(1, 0, true);
        if (on2) push(2, 3);
        if (on3 && outs + 2 < 3) push(3, 4);
        return { result: 'doublePlay', batterDest: 0, moves, outsMade: 2 };
      }
      if (outs < 2) {
        if (on3 && rng.chance(0.5)) push(3, 4);
        if (on2 && (!on3 || moves.some((m) => m.from === 3)) && rng.chance(0.5)) push(2, 3);
        if (on1 && !moves.some((m) => m.from === 2) && !on2) push(1, 2);
        else if (on1 && on2 && moves.some((m) => m.from === 2)) push(1, 2);
        else if (on1 && on2) { /* runner on 2nd holds, so the runner on 1st is forced: put both up */ moves.length = 0; if (on3) push(3, 4); push(2, 3); push(1, 2); }
      }
      return { result: 'groundout', batterDest: 0, moves, outsMade: 1 };
    }
    case 'flyout': {
      if (on3 && outs < 2 && rng.chance(0.45)) {
        push(3, 4);
        return { result: 'sacFly', batterDest: 0, moves, outsMade: 1 };
      }
      return { result: 'flyout', batterDest: 0, moves, outsMade: 1 };
    }
    default:
      return { result: 'groundout', batterDest: 0, moves, outsMade: 1 };
  }
}
