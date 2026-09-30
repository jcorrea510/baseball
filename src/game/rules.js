// The rules of baseball: counts, outs, runners, runs, innings. Pure functions that change a game-state
// object. No graphics, no timing - easy to test.

export function createGame(o = {}) {
  return {
    innings: o.innings ?? 3,
    extraRunner: o.extraRunner ?? true,
    inning: 1,
    half: 'top', // the visiting team bats in the top half
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: [null, null, null], // runner on 1st, 2nd, 3rd (any truthy value identifies the runner)
    score: { top: 0, bottom: 0 },
    runsByInning: { top: [], bottom: [] },
    hits: { top: 0, bottom: 0 },
    lineupIdx: { top: 0, bottom: 0 },
    over: false,
    winner: null, // 'top' | 'bottom'
    walkOff: false,
    plateAppearances: { top: 0, bottom: 0 },
  };
}

const HIT_RESULTS = new Set(['single', 'double', 'triple', 'homer', 'insideParkHomer']);
export const isHitResult = (r) => HIT_RESULTS.has(r);
export const basesForHit = (r) => ({ single: 1, double: 2, triple: 3, homer: 4, insideParkHomer: 4 }[r] || 0);

export function runnersOn(g) {
  return g.bases.filter(Boolean).length;
}

function endPlateAppearance(g) {
  g.balls = 0;
  g.strikes = 0;
  g.lineupIdx[g.half] += 1;
  g.plateAppearances[g.half] += 1;
}

function addRuns(g, n) {
  if (n <= 0) return;
  g.score[g.half] += n;
  const arr = g.runsByInning[g.half];
  while (arr.length < g.inning) arr.push(0);
  arr[g.inning - 1] += n;
  // Walk-off: home team takes the lead in the last inning or later
  if (g.half === 'bottom' && g.inning >= g.innings && g.score.bottom > g.score.top) {
    g.over = true;
    g.winner = 'bottom';
    g.walkOff = true;
  }
}

export function halfIsOver(g) {
  return g.outs >= 3 || g.over;
}

function recordOut(g, n = 1) {
  g.outs += n;
}

// Force-advance runners one base each because the batter was awarded first base.
function forceAdvance(g, batter) {
  const b = g.bases;
  let runs = 0;
  if (b[0]) {
    if (b[1]) {
      if (b[2]) { runs++; }
      b[2] = b[1];
    }
    b[1] = b[0];
  }
  b[0] = batter || true;
  return runs;
}

/** A pitch that is not swung at and is out of the zone. */
export function pitchBall(g, batter) {
  g.balls++;
  if (g.balls >= 4) {
    const runs = forceAdvance(g, batter);
    addRuns(g, runs);
    endPlateAppearance(g);
    return { result: 'walk', paEnded: true, runs, halfOver: halfIsOver(g) };
  }
  return { result: 'ball', paEnded: false, runs: 0, halfOver: false };
}

/** Called strike or swinging strike. */
export function pitchStrike(g, { swinging = false } = {}) {
  g.strikes++;
  if (g.strikes >= 3) {
    recordOut(g);
    endPlateAppearance(g);
    return { result: swinging ? 'strikeoutSwinging' : 'strikeoutLooking', paEnded: true, runs: 0, outs: 1, halfOver: halfIsOver(g) };
  }
  return { result: swinging ? 'swingingStrike' : 'calledStrike', paEnded: false, runs: 0, halfOver: false };
}

/** Foul ball: it is a strike unless the batter already has two strikes. */
export function pitchFoul(g) {
  if (g.strikes < 2) g.strikes++;
  return { result: 'foul', paEnded: false, runs: 0, halfOver: false };
}

/**
 * Apply the outcome of a ball put in play.
 * @param {object} g
 * @param {object} play
 * @param {string} play.result   'single'|'double'|'triple'|'homer'|'insideParkHomer'|'groundout'|'flyout'|'lineout'|'popout'|
 *                               'foulOut'|'sacFly'|'doublePlay'|'fieldersChoice'
 * @param {number} play.batterDest  0 = batter is out, 1..3 = safe on that base, 4 = scored
 * @param {Array}  play.moves    runners only: { from: 1..3, to: 1..4, out?: boolean }  (to is ignored when out)
 * @param {number} play.outsMade total outs recorded on the play
 * @param {*} [batter]  identifier for the batter (put on a base)
 */
export function applyPlay(g, play, batter) {
  const moves = (play.moves || []).filter((m) => m.from >= 1);
  const newBases = [null, null, null];
  let runs = 0;
  const scoredRunners = [];
  let outsFromRunners = 0;

  for (const m of moves) {
    const runner = g.bases[m.from - 1];
    if (!runner) continue;
    if (m.out) { outsFromRunners++; continue; }
    if (m.to >= 4) { runs++; scoredRunners.push(runner); continue; }
    placeRunner(newBases, m.to, runner);
  }
  // Any runner not mentioned holds their base.
  for (let b = 1; b <= 3; b++) {
    const runner = g.bases[b - 1];
    if (!runner) continue;
    if (moves.some((m) => m.from === b)) continue;
    placeRunner(newBases, b, runner);
  }
  const batterOut = play.batterDest === 0;
  if (!batterOut) {
    if (play.batterDest >= 4) { runs++; scoredRunners.push(batter || true); } else placeRunner(newBases, play.batterDest, batter || true);
  }
  const outsMade = play.outsMade ?? (batterOut ? 1 : 0) + outsFromRunners;

  g.bases = newBases;
  recordOut(g, outsMade);
  // No runs score if the third out ends the inning on a force / batter out (all our out plays qualify).
  if (g.outs >= 3) runs = 0;
  if (isHitResult(play.result)) g.hits[g.half]++;
  addRuns(g, runs);
  endPlateAppearance(g);
  return { result: play.result, paEnded: true, runs, outs: outsMade, scoredRunners, halfOver: halfIsOver(g), walkOff: g.walkOff };
}

function placeRunner(bases, base, runner) {
  // Safety net: two runners can never share a base. The trailing runner is pushed back.
  let b = base;
  while (b >= 1 && bases[b - 1]) b--;
  if (b >= 1) bases[b - 1] = runner;
}

/**
 * Move to the next half inning (or finish the game). Call when the half is over.
 * @returns {{gameOver:boolean, winner:string|null, newInning:boolean}}
 */
export function advanceHalf(g, ghostRunner = null) {
  // make sure the half that just ended has an entry (even if it scored nothing)
  const done = g.runsByInning[g.half];
  while (done.length < g.inning) done.push(0);
  if (g.over) return { gameOver: true, winner: g.winner, newInning: false };
  let newInning = false;
  if (g.half === 'top') {
    if (g.inning >= g.innings && g.score.bottom > g.score.top) {
      g.over = true; g.winner = 'bottom';
      return { gameOver: true, winner: g.winner, newInning: false };
    }
    g.half = 'bottom';
  } else {
    if (g.inning >= g.innings && g.score.top !== g.score.bottom) {
      g.over = true; g.winner = g.score.top > g.score.bottom ? 'top' : 'bottom';
      return { gameOver: true, winner: g.winner, newInning: false };
    }
    g.inning++;
    g.half = 'top';
    newInning = true;
  }
  g.outs = 0; g.balls = 0; g.strikes = 0;
  g.bases = [null, null, null];
  if (g.extraRunner && g.inning > g.innings) g.bases[1] = ghostRunner || { ghost: true };
  return { gameOver: false, winner: null, newInning };
}

// Runs per inning for the scoreboard. Innings not yet played are undefined; a skipped bottom half is 'X'.
export function lineScore(g) {
  const out = { top: [], bottom: [] };
  const n = Math.max(g.innings, g.inning);
  for (let i = 0; i < n; i++) {
    const t = g.runsByInning.top[i];
    const b = g.runsByInning.bottom[i];
    const inTopNow = g.inning - 1 === i && g.half === 'top' && !g.over;
    out.top.push(t !== undefined ? t : inTopNow ? 0 : undefined);
    const inBotNow = g.inning - 1 === i && g.half === 'bottom' && !g.over;
    let bv = b !== undefined ? b : inBotNow ? 0 : undefined;
    if (bv === undefined && g.over && g.winner === 'bottom' && !g.walkOff && i === g.inning - 1 && g.half === 'top' && t !== undefined) bv = 'X';
    out.bottom.push(bv);
  }
  return out;
}

// Text for the scoreboard etc.
export function inningLabel(g) {
  return `${g.half === 'top' ? 'Top' : 'Bot'} ${g.inning}`;
}

export const RESULT_TEXT = {
  single: 'SINGLE', double: 'DOUBLE', triple: 'TRIPLE', homer: 'HOME RUN', insideParkHomer: 'INSIDE-THE-PARK HR',
  groundout: 'GROUNDOUT', flyout: 'FLYOUT', lineout: 'LINEOUT', popout: 'POP OUT', foulOut: 'FOUL OUT', sacFly: 'SAC FLY', sacBunt: 'SAC BUNT',
  doublePlay: 'DOUBLE PLAY', fieldersChoice: "FIELDER'S CHOICE", walk: 'WALK', strikeoutSwinging: 'STRIKEOUT', strikeoutLooking: 'STRIKEOUT',
  foul: 'FOUL', ball: 'BALL', calledStrike: 'STRIKE', swingingStrike: 'STRIKE',
};
