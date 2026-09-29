import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { createBot } from '../src/game/bot.js';
import { resolveSwingTimes } from '../src/game/timing.js';

const DT = 1 / 120;
function drive(e, seconds, bot) {
  for (let t = 0; t < seconds && !e.over; t += DT) { e.update(DT); if (bot) bot.update(); }
}
const strikePitch = () => ({ type: 'fastball', speedMph: 84, target: { x: 0, y: 2.5 }, intendedStrike: true, tell: { slot: 0, lag: 0 } });
const ballPitch = () => ({ type: 'fastball', speedMph: 84, target: { x: 1.6, y: 2.5 }, intendedStrike: false, tell: { slot: 0, lag: 0 } });
const untilPhase = (e, phase, max = 20) => { for (let t = 0; t < max && e.phase !== phase; t += DT) e.update(DT); return e.phase === phase; };

describe('one pitch at a time', () => {
  it('a taken pitch in the zone is a called strike; outside is a ball', () => {
    const e = new Engine({ mode: 'quick', seed: 1 });
    e.pitchOverride = strikePitch;
    const calls = [];
    e.on('pitchCall', (c) => calls.push(c.call));
    e.start();
    while (calls.length < 1) e.update(DT);
    expect(calls[0]).toBe('calledStrike');
    expect(e.count.strikes).toBe(1);
    e.pitchOverride = ballPitch;
    while (calls.length < 2) e.update(DT);
    expect(calls[1]).toBe('ball');
    expect(e.count.balls).toBe(1);
  });

  it('four balls is a walk that puts a runner on first', () => {
    const e = new Engine({ mode: 'quick', seed: 2 });
    e.pitchOverride = ballPitch;
    e.start();
    const results = [];
    e.on('result', (r) => results.push(r.result || r.call));
    drive(e, 30);
    expect(results).toContain('walk');
    expect(e.game.bases[0]).toBeTruthy();
  });

  it('three called strikes is a strikeout and the third out ends the half', () => {
    const e = new Engine({ mode: 'quick', seed: 3 });
    e.pitchOverride = strikePitch;
    let halfEnded = false;
    e.on('halfEnd', () => { halfEnded = true; });
    e.start();
    drive(e, 120);
    expect(halfEnded).toBe(true);
    expect(e.stats.strikeouts).toBeGreaterThanOrEqual(3);
  });

  it('the pitch arrives at the target at pitch.tCross', () => {
    const e = new Engine({ mode: 'quick', seed: 4 });
    e.pitchOverride = () => ({ ...strikePitch(), target: { x: 0.3, y: 2.2 } });
    e.start();
    expect(untilPhase(e, 'windup')).toBe(true);
    const p = e.pitch;
    const at = p.flight.at(p.tCross - p.tRelease);
    expect(at.x).toBeCloseTo(0.3, 4);
    expect(at.y).toBeCloseTo(2.2, 4);
    expect(p.tCross).toBeGreaterThan(p.tRelease);
  });
});

describe('swing timing is frame-rate independent', () => {
  const errorAt = (dt, lateBySec) => {
    const e = new Engine({ mode: 'practice', seed: 9 });
    e.pitchOverride = strikePitch;
    e.start();
    while (e.phase !== 'windup') e.update(dt);
    const cross = e.pitch.tCross;
    const pressAt = cross - CONFIG.timing.swingDelay + lateBySec;
    while (e.phase !== 'pitch') e.update(dt);
    // step frame by frame until the frame that contains the press time
    while (e.time + dt < pressAt) e.update(dt);
    const since = pressAt - e.time; // how long after the last update the finger actually landed
    e.swingPressed(since);
    return e.swing.errorMs;
  };
  it('the same true press time gives the same error at 30, 60, 144 and 240 fps', () => {
    const want = 13;
    for (const fps of [30, 60, 144, 240]) {
      const err = errorAt(1 / fps, want / 1000);
      expect(Math.abs(err - want)).toBeLessThan(0.5);
    }
  });
  it('resolveSwingTimes only depends on timestamps', () => {
    const a = resolveSwingTimes(10.1, 10.2);
    const b = resolveSwingTimes(10.1, 10.2);
    expect(a.errorMs).toBe(b.errorMs);
  });
});

describe('swings', () => {
  it('a swing that is way early whiffs and is a strike', () => {
    const e = new Engine({ mode: 'quick', seed: 5 });
    e.pitchOverride = strikePitch;
    e.start();
    untilPhase(e, 'pitch');
    e.swingPressed(0); // immediately at release: hopelessly early
    expect(e.swing.made).toBe(false);
    const calls = [];
    e.on('pitchCall', (c) => calls.push(c.call));
    while (calls.length < 1) e.update(DT);
    expect(calls[0]).toBe('swingingStrike');
    expect(e.count.strikes).toBe(1);
  });

  it('a perfectly timed swing at a middle pitch is perfect contact', () => {
    const e = new Engine({ mode: 'quick', seed: 6, hand: 'R' });
    e.pitchOverride = strikePitch;
    e.start();
    untilPhase(e, 'pitch');
    // press so the bat arrives exactly as the ball crosses
    while (e.time < e.pitch.tCross - CONFIG.timing.swingDelay - DT) e.update(DT);
    e.swingPressed(e.pitch.tCross - CONFIG.timing.swingDelay - e.time);
    expect(e.swing.grade).toBe('perfect');
    expect(e.swing.made).toBe(true);
    expect(e.swing.contact.exitVelocity).toBeGreaterThan(90);
  });

  it('you cannot swing twice at the same pitch, or before the pitch is thrown', () => {
    const e = new Engine({ mode: 'quick', seed: 7 });
    e.pitchOverride = strikePitch;
    e.start();
    untilPhase(e, 'windup');
    expect(e.swingPressed(0)).toBe(false);
    untilPhase(e, 'pitch');
    expect(e.swingPressed(0)).toBe(true);
    expect(e.swingPressed(0)).toBe(false);
  });
});

describe('whole games', () => {
  it('a quick game with a bot always finishes with a winner and sane numbers', () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const e = new Engine({ mode: 'quick', difficulty: 'pro', seed });
      const bot = createBot(e, { errSd: 30, seed });
      let over = null;
      e.on('gameOver', (p) => { over = p; });
      e.on('count', (c) => { expect(c.balls).toBeLessThanOrEqual(3); expect(c.strikes).toBeLessThanOrEqual(2); expect(c.outs).toBeLessThanOrEqual(3); });
      e.start();
      drive(e, 3000, bot);
      expect(e.over).toBe(true);
      expect(over).toBeTruthy();
      expect(['top', 'bottom']).toContain(e.game.winner);
      expect(e.game.inning).toBeGreaterThanOrEqual(3);
      expect(e.game.score.top).not.toBe(e.game.score.bottom);
      const ls = over.game.line;
      expect(ls.top.length).toBeGreaterThanOrEqual(3);
      const sumTop = ls.top.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
      expect(sumTop).toBe(e.game.score.top);
    }
  });

  it('is repeatable: the same seed and the same bot give the same game', () => {
    const run = () => {
      const e = new Engine({ mode: 'quick', difficulty: 'pro', seed: 77 });
      const bot = createBot(e, { errSd: 25, seed: 5 });
      e.start(); drive(e, 3000, bot);
      return JSON.stringify([e.game.score, e.stats.hits, e.stats.hr, e.pitchCount]);
    };
    expect(run()).toBe(run());
  });

  it('home run derby ends after exactly 10 outs and tracks the longest homer', () => {
    const e = new Engine({ mode: 'derby', difficulty: 'pro', seed: 21 });
    const bot = createBot(e, { errSd: 25, seed: 3 });
    e.start(); drive(e, 3000, bot);
    expect(e.over).toBe(true);
    expect(e.derby.outs).toBe(10);
    if (e.derby.hr > 0) expect(e.derby.longest).toBeGreaterThan(280);
    expect(e.derby.bestStreak).toBeLessThanOrEqual(e.derby.hr);
  });

  it('derby: taking a pitch is free (no out, no strike)', () => {
    const e = new Engine({ mode: 'derby', seed: 22 });
    e.start();
    drive(e, 8);
    expect(e.derby.outs).toBe(0);
    expect(e.phase).not.toBe('gameOver');
  });

  it('derby: an early whiff on Pro costs an out; on Rookie it is free', () => {
    const pro = new Engine({ mode: 'derby', difficulty: 'pro', seed: 23 });
    pro.start(); untilPhase(pro, 'pitch'); pro.swingPressed(0); drive(pro, 3);
    expect(pro.derby.outs).toBe(1);
    const rk = new Engine({ mode: 'derby', difficulty: 'rookie', seed: 23 });
    rk.start(); untilPhase(rk, 'pitch'); rk.swingPressed(0); drive(rk, 3);
    expect(rk.derby.outs).toBe(0);
  });

  it('practice mode never ends', () => {
    const e = new Engine({ mode: 'practice', seed: 31 });
    const bot = createBot(e, { errSd: 40, seed: 2 });
    e.start(); drive(e, 300, bot);
    expect(e.over).toBe(false);
    expect(e.stats.swings).toBeGreaterThan(5);
  });

  it('practice uses the pitch type and speed that were chosen', () => {
    const e = new Engine({ mode: 'practice', seed: 32, practice: { type: 'curveball', speed: 70, location: 'center' } });
    e.start(); untilPhase(e, 'windup');
    expect(e.pitch.type).toBe('curveball');
    expect(Math.abs(e.pitch.speedMph - 70)).toBeLessThan(0.01);
    expect(e.pitch.target.x).toBe(0);
  });

  it('the computer half-inning is summarised and the game moves on', () => {
    const e = new Engine({ mode: 'quick', seed: 41 });
    e.pitchOverride = strikePitch;
    let summary = null;
    e.on('aiHalf', (s) => { summary = s; });
    e.start();
    let guard = 0;
    while (!summary && guard++ < 200 / DT) e.update(DT);
    expect(summary).toBeTruthy();
    expect(summary.events.length).toBeGreaterThan(0);
    expect(e.phase).toBe('aiSummary');
    e.skipSummary();
    e.update(DT);
    expect(e.phase).toBe('ready');
    expect(e.game.half).toBe('top');
    expect(e.game.inning).toBe(2);
  });
});
