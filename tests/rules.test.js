import { describe, it, expect } from 'vitest';
import * as rules from '../src/game/rules.js';

const g0 = (o) => rules.createGame(o);
const runner = (n) => ({ id: n, name: 'R' + n });

describe('balls, strikes and fouls', () => {
  it('starts with a clean count', () => {
    const g = g0();
    expect([g.balls, g.strikes, g.outs, g.inning, g.half]).toEqual([0, 0, 0, 1, 'top']);
  });

  it('counts balls and walks the batter on ball four', () => {
    const g = g0();
    for (let i = 0; i < 3; i++) expect(rules.pitchBall(g, runner('b')).paEnded).toBe(false);
    expect(g.balls).toBe(3);
    const r = rules.pitchBall(g, runner('b'));
    expect(r.result).toBe('walk');
    expect(r.paEnded).toBe(true);
    expect(g.balls).toBe(0);
    expect(g.strikes).toBe(0);
    expect(g.bases[0]).toBeTruthy();
    expect(g.outs).toBe(0);
  });

  it('strike three is an out (looking or swinging)', () => {
    const g = g0();
    rules.pitchStrike(g, { swinging: false });
    rules.pitchStrike(g, { swinging: true });
    expect(g.strikes).toBe(2);
    const r = rules.pitchStrike(g, { swinging: true });
    expect(r.result).toBe('strikeoutSwinging');
    expect(g.outs).toBe(1);
    expect(g.strikes).toBe(0);
    const g2 = g0();
    g2.strikes = 2;
    expect(rules.pitchStrike(g2, { swinging: false }).result).toBe('strikeoutLooking');
  });

  it('a foul is a strike with fewer than two strikes', () => {
    const g = g0();
    rules.pitchFoul(g); expect(g.strikes).toBe(1);
    rules.pitchFoul(g); expect(g.strikes).toBe(2);
  });

  it('a foul with two strikes does NOT end the at-bat', () => {
    const g = g0();
    g.strikes = 2;
    const r = rules.pitchFoul(g);
    expect(g.strikes).toBe(2);
    expect(g.outs).toBe(0);
    expect(r.paEnded).toBe(false);
    rules.pitchFoul(g); rules.pitchFoul(g);
    expect(g.strikes).toBe(2);
    expect(g.outs).toBe(0);
  });

  it('a full count (3-2) walk still works', () => {
    const g = g0();
    g.balls = 3; g.strikes = 2;
    expect(rules.pitchFoul(g).paEnded).toBe(false);
    expect(rules.pitchBall(g, runner('x')).result).toBe('walk');
  });

  it('the batting order advances after every plate appearance', () => {
    const g = g0();
    rules.pitchBall(g, 1); rules.pitchBall(g, 1); rules.pitchBall(g, 1); rules.pitchBall(g, 1);
    expect(g.lineupIdx.top).toBe(1);
    g.strikes = 2; rules.pitchStrike(g, { swinging: true });
    expect(g.lineupIdx.top).toBe(2);
  });
});

describe('walks push runners only when forced', () => {
  const walk = (bases) => {
    const g = g0();
    g.bases = bases.map((b) => (b ? runner(b) : null));
    g.balls = 3;
    const r = rules.pitchBall(g, runner('B'));
    return { g, r };
  };
  it('runner on first only -> first and second', () => {
    const { g } = walk([1, 0, 0]);
    expect(g.bases.map(Boolean)).toEqual([true, true, false]);
  });
  it('runner on second only is not forced', () => {
    const { g } = walk([0, 2, 0]);
    expect(g.bases.map(Boolean)).toEqual([true, true, false]);
    expect(g.bases[1].id).toBe(2);
  });
  it('first and third -> loaded? no: first and second, runner on third stays', () => {
    const { g } = walk([1, 0, 3]);
    expect(g.bases.map(Boolean)).toEqual([true, true, true]);
    expect(g.score.top).toBe(0);
  });
  it('bases loaded walk forces in a run', () => {
    const { g, r } = walk([1, 2, 3]);
    expect(r.runs).toBe(1);
    expect(g.score.top).toBe(1);
    expect(g.bases.every(Boolean)).toBe(true);
    expect(g.bases[2].id).toBe(2);
  });
});

describe('balls in play', () => {
  const play = (g, result, batterDest, moves = [], outsMade) => rules.applyPlay(g, { result, batterDest, moves, outsMade }, runner('B'));

  it('a single puts the batter on first', () => {
    const g = g0();
    const r = play(g, 'single', 1);
    expect(g.bases.map(Boolean)).toEqual([true, false, false]);
    expect(g.hits.top).toBe(1);
    expect(r.paEnded).toBe(true);
  });

  it('a runner from second scores on a single', () => {
    const g = g0();
    g.bases = [null, runner(2), null];
    const r = play(g, 'single', 1, [{ from: 2, to: 4 }]);
    expect(r.runs).toBe(1);
    expect(g.score.top).toBe(1);
    expect(g.runsByInning.top[0]).toBe(1);
    expect(g.bases.map(Boolean)).toEqual([true, false, false]);
  });

  it('a grand slam scores four', () => {
    const g = g0();
    g.bases = [runner(1), runner(2), runner(3)];
    const r = play(g, 'homer', 4, [{ from: 1, to: 4 }, { from: 2, to: 4 }, { from: 3, to: 4 }]);
    expect(r.runs).toBe(4);
    expect(g.score.top).toBe(4);
    expect(g.bases.some(Boolean)).toBe(false);
  });

  it('a solo homer scores one and clears nobody else', () => {
    const g = g0();
    expect(play(g, 'homer', 4).runs).toBe(1);
  });

  it('a triple and a double leave the batter on the right base', () => {
    const g = g0(); play(g, 'triple', 3);
    expect(g.bases.map(Boolean)).toEqual([false, false, true]);
    const h = g0(); play(h, 'double', 2);
    expect(h.bases.map(Boolean)).toEqual([false, true, false]);
  });

  it('unmentioned runners hold their base', () => {
    const g = g0();
    g.bases = [null, null, runner(3)];
    play(g, 'single', 1);
    expect(g.bases.map(Boolean)).toEqual([true, false, true]);
  });

  it('a flyout is one out and the batter does not reach', () => {
    const g = g0();
    const r = play(g, 'flyout', 0, [], 1);
    expect(g.outs).toBe(1);
    expect(g.bases.some(Boolean)).toBe(false);
    expect(r.halfOver).toBe(false);
  });

  it('a double play records two outs and removes the runner', () => {
    const g = g0();
    g.bases = [runner(1), null, null];
    play(g, 'doublePlay', 0, [{ from: 1, to: 0, out: true }], 2);
    expect(g.outs).toBe(2);
    expect(g.bases.some(Boolean)).toBe(false);
  });

  it("a fielder's choice: runner out, batter safe", () => {
    const g = g0();
    g.bases = [runner(1), null, null];
    play(g, 'fieldersChoice', 1, [{ from: 1, to: 0, out: true }], 1);
    expect(g.outs).toBe(1);
    expect(g.bases.map(Boolean)).toEqual([true, false, false]);
    expect(g.bases[0].id).toBe('B');
  });

  it('a sacrifice fly scores the runner from third and records an out', () => {
    const g = g0();
    g.bases = [null, null, runner(3)];
    const r = play(g, 'sacFly', 0, [{ from: 3, to: 4 }], 1);
    expect(r.runs).toBe(1);
    expect(g.outs).toBe(1);
  });

  it('no run scores when the third out is made on the play', () => {
    const g = g0();
    g.outs = 2;
    g.bases = [null, null, runner(3)];
    const r = play(g, 'flyout', 0, [{ from: 3, to: 4 }], 1);
    expect(r.runs).toBe(0);
    expect(g.score.top).toBe(0);
    expect(r.halfOver).toBe(true);
  });

  it('never lets two runners share a base', () => {
    const g = g0();
    g.bases = [runner(1), runner(2), null];
    // a bad plan: both runners end on third
    play(g, 'single', 1, [{ from: 1, to: 3 }, { from: 2, to: 3 }]);
    const ids = g.bases.filter(Boolean).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('innings and game flow', () => {
  const finishHalf = (g) => { g.outs = 3; return rules.advanceHalf(g); };

  it('three outs ends the half; top -> bottom -> next inning', () => {
    const g = g0();
    finishHalf(g);
    expect([g.inning, g.half, g.outs]).toEqual([1, 'bottom', 0]);
    finishHalf(g);
    expect([g.inning, g.half]).toEqual([2, 'top']);
  });

  it('clears the bases, count and outs at each half', () => {
    const g = g0();
    g.bases = [runner(1), null, null]; g.balls = 2; g.strikes = 1;
    finishHalf(g);
    expect(g.bases.some(Boolean)).toBe(false);
    expect([g.balls, g.strikes, g.outs]).toEqual([0, 0, 0]);
  });

  it('the game is over after the bottom of the last inning if not tied', () => {
    const g = g0({ innings: 3 });
    g.inning = 3; g.half = 'bottom'; g.score = { top: 2, bottom: 1 };
    const r = finishHalf(g);
    expect(r.gameOver).toBe(true);
    expect(g.winner).toBe('top');
  });

  it('the home team does not bat in the last inning when already ahead', () => {
    const g = g0({ innings: 3 });
    g.inning = 3; g.half = 'top'; g.score = { top: 1, bottom: 4 };
    const r = finishHalf(g);
    expect(r.gameOver).toBe(true);
    expect(g.winner).toBe('bottom');
    expect(g.half).toBe('top');
  });

  it('a tie after regulation goes to extra innings with a runner on second', () => {
    const g = g0({ innings: 3, extraRunner: true });
    g.inning = 3; g.half = 'bottom'; g.score = { top: 2, bottom: 2 };
    const r = finishHalf(g);
    expect(r.gameOver).toBe(false);
    expect([g.inning, g.half]).toEqual([4, 'top']);
    expect(g.bases.map(Boolean)).toEqual([false, true, false]);
    finishHalf(g);
    expect(g.bases.map(Boolean)).toEqual([false, true, false]);
  });

  it('extra innings without the automatic runner start empty', () => {
    const g = g0({ innings: 3, extraRunner: false });
    g.inning = 3; g.half = 'bottom'; g.score = { top: 0, bottom: 0 };
    finishHalf(g);
    expect(g.bases.some(Boolean)).toBe(false);
  });

  it('walk-off: the home team ends it the moment it takes the lead in the last inning', () => {
    const g = g0({ innings: 3 });
    g.inning = 3; g.half = 'bottom'; g.score = { top: 2, bottom: 2 };
    g.bases = [null, null, runner(3)];
    const r = rules.applyPlay(g, { result: 'single', batterDest: 1, moves: [{ from: 3, to: 4 }], outsMade: 0 }, runner('B'));
    expect(g.over).toBe(true);
    expect(g.winner).toBe('bottom');
    expect(r.walkOff).toBe(true);
    expect(rules.halfIsOver(g)).toBe(true);
  });

  it('home runs in the bottom of an early inning are not walk-offs', () => {
    const g = g0({ innings: 3 });
    g.inning = 1; g.half = 'bottom';
    rules.applyPlay(g, { result: 'homer', batterDest: 4, moves: [], outsMade: 0 }, runner('B'));
    expect(g.over).toBe(false);
  });

  it('records runs per inning for the line score', () => {
    const g = g0();
    rules.applyPlay(g, { result: 'homer', batterDest: 4, moves: [] }, runner('a'));
    finishHalf(g);
    rules.applyPlay(g, { result: 'homer', batterDest: 4, moves: [] }, runner('b'));
    rules.applyPlay(g, { result: 'homer', batterDest: 4, moves: [] }, runner('c'));
    finishHalf(g);
    rules.applyPlay(g, { result: 'single', batterDest: 1, moves: [] }, runner('d'));
    const ls = rules.lineScore(g);
    expect(ls.top[0]).toBe(1);
    expect(ls.bottom[0]).toBe(2);
    expect(ls.top[1]).toBe(0);
    expect(ls.bottom[1]).toBeUndefined();
    expect(g.score).toEqual({ top: 1, bottom: 2 });
  });

  it('an unplayed bottom half shows an X when the home team wins without batting', () => {
    const g = g0({ innings: 3 });
    g.inning = 3; g.half = 'top'; g.score = { top: 0, bottom: 2 };
    g.runsByInning = { top: [0, 0], bottom: [1, 1] };
    finishHalf(g);
    expect(rules.lineScore(g).bottom[2]).toBe('X');
  });
});

describe('walk-offs, RBIs and scoring credit', () => {
  const lastBottom = (top, bottom) => { const g = g0({ innings: 3 }); g.inning = 3; g.half = 'bottom'; g.score = { top, bottom }; return g; };
  it('a walk-off hit ends the game the moment the winning run scores: only the runs needed count', () => {
    const g = lastBottom(3, 3);
    g.bases = [runner(1), runner(2), runner(3)];
    const r = rules.applyPlay(g, { result: 'double', batterDest: 2, moves: [{ from: 3, to: 4 }, { from: 2, to: 4 }, { from: 1, to: 4 }], outsMade: 0 }, runner(9));
    expect(r.runs).toBe(1);
    expect(g.score.bottom).toBe(4);
    expect(g.over && g.walkOff).toBe(true);
    expect(r.result).toBe('single'); // (the winning run only needed one base from third)
  });
  it('a walk-off home run counts every run', () => {
    const g = lastBottom(3, 3);
    g.bases = [runner(1), null, runner(3)];
    const r = rules.applyPlay(g, { result: 'homer', batterDest: 4, moves: [{ from: 3, to: 4 }, { from: 1, to: 4 }], outsMade: 0 }, runner(9));
    expect(r.runs).toBe(3);
    expect(r.result).toBe('homer');
  });
  it('down two with the bases loaded: the winning run comes from first, so a double that scores all three counts three and stays a double', () => {
    const g = lastBottom(5, 3);
    g.bases = [runner(1), runner(2), runner(3)];
    const r = rules.applyPlay(g, { result: 'double', batterDest: 2, moves: [{ from: 3, to: 4 }, { from: 2, to: 4 }, { from: 1, to: 4 }], outsMade: 0 }, runner(9));
    expect(r.runs).toBe(3); // (two to tie, the third - from first - wins it)
    expect(r.result).toBe('double');
  });
  it('no runs batted in on a double play or when the batter reached on an error', () => {
    const g = g0();
    g.bases = [runner(1), null, runner(3)];
    const dp = rules.applyPlay(g, { result: 'doublePlay', batterDest: 0, moves: [{ from: 3, to: 4 }, { from: 1, out: true }], outsMade: 2 }, runner(9));
    expect(dp.runs).toBe(1);
    expect(dp.rbi).toBe(0);
    const g2 = g0();
    g2.bases = [null, null, runner(3)];
    const e = rules.applyPlay(g2, { result: 'error', batterDest: 1, moves: [{ from: 3, to: 4 }], outsMade: 0 }, runner(9));
    expect(e.rbi).toBe(0);
    const g3 = g0();
    g3.bases = [null, null, runner(3)];
    expect(rules.applyPlay(g3, { result: 'single', batterDest: 1, moves: [{ from: 3, to: 4 }], outsMade: 0 }, runner(9)).rbi).toBe(1);
  });
});

describe('extra innings', () => {
  it('an extra inning starts with a runner on second: whoever the caller picks for that half', () => {
    const g = g0({ innings: 3 });
    g.inning = 3; g.half = 'bottom'; g.score = { top: 2, bottom: 2 }; g.outs = 3;
    const r = rules.advanceHalf(g, (half) => ({ id: 'last-' + half }));
    expect(r.gameOver).toBe(false);
    expect([g.inning, g.half]).toEqual([4, 'top']);
    expect(g.bases[1]).toEqual({ id: 'last-top' });
  });
});
