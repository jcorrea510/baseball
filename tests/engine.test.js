import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { createBot } from '../src/game/bot.js';
import { resolveSwingTimes } from '../src/game/timing.js';
import { fielderBackTime } from '../src/game/fielding.js';

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

  it('walks count as plate appearances and a bases-loaded walk is an RBI', () => {
    const e = new Engine({ mode: 'quick', seed: 2 });
    e.pitchOverride = ballPitch;
    e.start();
    let walks = 0;
    e.on('result', (r) => { if (r.result === 'walk') walks++; });
    while (walks < 4 && e.time < 120) e.update(DT);
    expect(walks).toBe(4);
    expect(e.stats.pa).toBe(4);
    expect(e.stats.walks).toBe(4);
    expect(e.stats.ab).toBe(0);
    expect(e.stats.rbi).toBe(1); // the fourth walk forced the runner on third home
    expect(e.game.score.top).toBe(1);
  });

  it('the swing timing adjustment takes a fixed delay off every press', () => {
    const errs = [];
    for (const lag of [0, 60]) {
      const e = new Engine({ mode: 'practice', seed: 9, inputDelayMs: lag });
      e.pitchOverride = strikePitch;
      e.start();
      expect(untilPhase(e, 'pitch')).toBe(true);
      while (e.time < e.pitch.tCross - 0.2) e.update(DT);
      e.swingPressed(0);
      errs.push(e.swing.errorMs);
    }
    expect(errs[0] - errs[1]).toBeCloseTo(60, 0);
  });

  it('strikeouts count as plate appearances and at-bats', () => {
    const e = new Engine({ mode: 'quick', seed: 3 });
    e.pitchOverride = strikePitch;
    e.start();
    while (e.stats.strikeouts < 2 && e.time < 120) e.update(DT);
    expect(e.stats.pa).toBe(2);
    expect(e.stats.ab).toBe(2);
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

describe('batting order', () => {
  it('the next batter steps in after each plate appearance (walk, strikeout, ball in play)', () => {
    const e = new Engine({ mode: 'quick', seed: 12 });
    e.pitchOverride = ballPitch;
    const seen = [];
    e.on('paStart', (p) => seen.push(p.batter.name));
    e.start();
    drive(e, 25);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(seen[0]).toBe(e.lineup[0].name);
    expect(seen[1]).toBe(e.lineup[1].name);
    expect(seen[2]).toBe(e.lineup[2].name);
  });

  it('the count starts fresh for every batter', () => {
    const e = new Engine({ mode: 'quick', seed: 13 });
    e.pitchOverride = strikePitch;
    const counts = [];
    e.on('paStart', (p) => counts.push(p.count));
    e.start();
    drive(e, 40);
    for (const c of counts) expect(c).toEqual({ balls: 0, strikes: 0 });
  });

  it('the same batter sees the next pitch after a ball or strike', () => {
    const e = new Engine({ mode: 'quick', seed: 14 });
    e.pitchOverride = strikePitch;
    let starts = 0;
    e.on('paStart', () => starts++);
    const calls = [];
    e.on('pitchCall', (c) => calls.push(c.call));
    e.start();
    while (calls.length < 2) e.update(DT);
    expect(starts).toBe(1); // one batter has seen two pitches
    expect(e.count.strikes).toBe(2);
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

describe('the next pitch waits for the pitcher and catcher', () => {
  const rollUpTheLine = () => ({ exitVelocity: 45, launchAngle: -6, sprayAngle: 22, backspin: 1200, hook: 0, errorMs: 0 });
  it('does not start the windup until the pitcher is back on the rubber and set', () => {
    const e = new Engine({ mode: 'quick', seed: 5 });
    e.pitchOverride = strikePitch;
    e.contactOverride = rollUpTheLine;
    e.start();
    expect(untilPhase(e, 'pitch')).toBe(true);
    while (e.time < e.pitch.tCross - e.cfg.timing.swingDelay) e.update(DT);
    e.swingPressed(0);
    expect(untilPhase(e, 'play')).toBe(true);
    const plan = e.play.plan;
    const t0 = e.play.t0;
    expect((plan.paths.P || []).length).toBeGreaterThan(0); // the pitcher is involved in this play
    e.contactOverride = null;
    // watch the next windup
    let windupAt = null;
    e.on('windup', () => { if (windupAt === null) windupAt = e.time; });
    let endedAt = null;
    for (let t = 0; t < 30 && windupAt === null; t += DT) { e.update(DT); if (endedAt === null && e.phase !== 'play') endedAt = e.time; }
    expect(windupAt).not.toBeNull();
    // he needs at least his jog home (a lot more than the usual gap) and then a moment to get set
    expect(windupAt).toBeGreaterThanOrEqual(t0 + fielderBackTime(plan, 'P', e.defense, e.cfg, endedAt - t0) + e.cfg.pace.pitcherSet - 1e-6);
    expect(windupAt - endedAt).toBeGreaterThan(1.5);
    expect(windupAt - endedAt).toBeLessThan(5); // ... but it stays quick
  });

  it('over a whole game no windup ever starts before the fielders are set, and nobody waits long for nothing', () => {
    const e = new Engine({ mode: 'quick', seed: 11 });
    const bot = createBot(e, { errSd: 30, seed: 3 });
    const windups = [];
    e.on('windup', () => windups.push({ t: e.time, set: e.fieldersSetAt, since: e.time - e.phaseSince }));
    e.start();
    drive(e, 900, bot);
    expect(windups.length).toBeGreaterThan(20);
    for (const w of windups) expect(w.t + 1e-9).toBeGreaterThanOrEqual(w.set);
  });
});
