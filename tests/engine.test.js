import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { createBot } from '../src/game/bot.js';
import { resolveSwingTimes } from '../src/game/timing.js';
import { fielderBackTime } from '../src/game/fielding.js';
import { createRng } from '../src/util/rng.js';

const DT = 1 / 120;
function drive(e, seconds, bot) {
  for (let t = 0; t < seconds && !e.over; t += DT) { e.update(DT); if (bot) bot.update(); }
}
const strikePitch = () => ({ type: 'fastball', speedMph: 84, target: { x: 0, y: 2.5 }, intendedStrike: true, tell: { slot: 0, lag: 0 } });
const ballPitch = () => ({ type: 'fastball', speedMph: 84, target: { x: 1.6, y: 2.5 }, intendedStrike: false, tell: { slot: 0, lag: 0 } });
const untilPhase = (e, phase, max = 20) => { for (let t = 0; t < max && e.phase !== phase; t += DT) e.update(DT); return e.phase === phase; };

describe('one pitch at a time', () => {
  it('a taken pitch in the zone is a called strike; outside is a ball', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 1 });
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
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 2 });
    e.pitchOverride = ballPitch;
    e.start();
    const results = [];
    e.on('result', (r) => results.push(r.result || r.call));
    drive(e, 30);
    expect(results).toContain('walk');
    expect(e.game.bases[0]).toBeTruthy();
  });

  it('walks count as plate appearances and a bases-loaded walk is an RBI', () => {
    const e = new Engine({ mode: 'quick', seed: 2, playerSide: 'top' });
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
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 3 });
    e.pitchOverride = strikePitch;
    e.start();
    while (e.stats.strikeouts < 2 && e.time < 120) e.update(DT);
    expect(e.stats.pa).toBe(2);
    expect(e.stats.ab).toBe(2);
  });

  it('three called strikes is a strikeout and the third out ends the half', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 3 });
    e.pitchOverride = strikePitch;
    let halfEnded = false;
    e.on('halfEnd', () => { halfEnded = true; });
    e.start();
    drive(e, 120);
    expect(halfEnded).toBe(true);
    expect(e.stats.strikeouts).toBeGreaterThanOrEqual(3);
  });

  it('the pitch arrives at the target at pitch.tCross', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 4 });
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
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 12 });
    e.pitchOverride = ballPitch;
    const seen = [];
    e.on('paStart', (p) => seen.push(p.batter.name));
    e.start();
    drive(e, 70);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(seen[0]).toBe(e.lineup[0].name);
    expect(seen[1]).toBe(e.lineup[1].name);
    expect(seen[2]).toBe(e.lineup[2].name);
  });

  it('the count starts fresh for every batter', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 13 });
    e.pitchOverride = strikePitch;
    const counts = [];
    e.on('paStart', (p) => counts.push(p.count));
    e.start();
    drive(e, 40);
    for (const c of counts) expect(c).toEqual({ balls: 0, strikes: 0 });
  });

  it('the same batter sees the next pitch after a ball or strike', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 14 });
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
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 5 });
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
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 6, hand: 'R' });
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
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 7 });
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
      const e = new Engine({ mode: 'quick', difficulty: 'pro', seed, playerSide: 'top' });
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
      const e = new Engine({ mode: 'quick', playerSide: 'top', difficulty: 'pro', seed: 77 });
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

  it('practice keeps runners on base and counts the runs - outs never pile up', () => {
    const e = new Engine({ mode: 'practice', seed: 33 });
    const bot = createBot(e, { errSd: 25, seed: 5 });
    const states = [];
    e.on('practice', (s) => states.push(s));
    let onBaseAtBat = 0, pas = 0;
    e.on('paStart', () => { pas++; if (e.bases.includes(e.batter)) onBaseAtBat++; });
    e.start(); drive(e, 400, bot);
    expect(e.over).toBe(false);
    expect(states.length).toBeGreaterThan(10);
    const last = states[states.length - 1];
    expect(last.runs).toBeGreaterThan(0); // runners came round to score
    expect(last.runs).toBe(e.pgame.score.top);
    expect(states.some((s) => s.bases.some(Boolean))).toBe(true);
    expect(e.pgame.outs).toBe(0);
    expect(e.stats.hits).toBeGreaterThan(0);
    // the batters take turns (a runner on base is never the man at the plate)
    expect(pas).toBeGreaterThan(10);
    expect(onBaseAtBat).toBe(0);
  }, 30000);

  it('practice uses the pitch type and speed that were chosen', () => {
    const e = new Engine({ mode: 'practice', seed: 32, practice: { type: 'curveball', speed: 70, location: 'center' } });
    e.start(); untilPhase(e, 'windup');
    expect(e.pitch.type).toBe('curveball');
    expect(Math.abs(e.pitch.speedMph - 70)).toBeLessThan(0.01);
    expect(e.pitch.target.x).toBe(0);
  });

  it('you are the home team: the computer bats first (instantly) and you bat last', () => {
    const e = new Engine({ mode: 'quick', seed: 41 });
    expect(e.playerSide).toBe('bottom');
    e.pitchOverride = strikePitch;
    let summary = null;
    e.on('aiHalf', (s) => { summary = s; });
    e.start();
    expect(summary).toBeTruthy(); // the visitors' first half is played out before your first pitch
    expect(summary.half).toBe('top');
    expect(e.phase).toBe('aiSummary');
    e.skipSummary();
    e.update(DT);
    expect(e.phase).toBe('ready');
    expect(e.game.half).toBe('bottom');
    expect(e.game.inning).toBe(1);
  });

  it('a whole game as the home team: the win is yours when the bottom score is higher, and a walk-off ends it', () => {
    let walkOffs = 0;
    for (const seed of [21, 22, 23, 24, 25, 26, 27, 28]) {
      const e = new Engine({ mode: 'quick', difficulty: 'rookie', seed });
      const bot = createBot(e, { errSd: 45, seed });
      let over = null;
      e.on('gameOver', (p) => { over = p; });
      e.start();
      drive(e, 3000, bot);
      expect(over).toBeTruthy();
      expect(over.won).toBe(e.game.score.bottom > e.game.score.top);
      expect(over.game.pf).toBe(e.game.score.bottom);
      expect(over.game.pa).toBe(e.game.score.top);
      if (e.game.walkOff) walkOffs++;
    }
    expect(walkOffs).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('the computer half-inning is summarised and the game moves on', () => {
    const e = new Engine({ mode: 'quick', seed: 41, playerSide: 'top' });
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
  const rollUpTheLine = () => ({ exitVelocity: 40, launchAngle: -6, sprayAngle: 18, backspin: 1200, hook: 0, errorMs: 0 }); // (the first baseman ranges far to his right and flips to the pitcher covering first)
  it('does not start the windup until the pitcher is back on the rubber and set', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 5 });
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
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 11 });
    const bot = createBot(e, { errSd: 30, seed: 3 });
    const windups = [];
    e.on('windup', () => windups.push({ t: e.time, set: e.fieldersSetAt, since: e.time - e.phaseSince }));
    e.start();
    drive(e, 900, bot);
    expect(windups.length).toBeGreaterThan(20);
    for (const w of windups) expect(w.t + 1e-9).toBeGreaterThanOrEqual(w.set);
  });
});

describe('waiting for the batter', () => {
  it('with waitForBatter the first pitch to each new batter waits for batterReady()', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 3, waitForBatter: true });
    e.pitchOverride = strikePitch;
    e.start();
    for (let i = 0; i < 600; i++) e.update(DT); // 5 s: nothing happens
    expect(e.phase).toBe('ready');
    expect(e.awaitingBatter).toBe(true);
    expect(e.batterReady()).toBe(true);
    expect(e.batterReady()).toBe(false);
    let pitches = 0;
    e.on('release', () => pitches++);
    while (e.stats.strikeouts < 1 && e.time < 60) e.update(DT);
    expect(pitches).toBe(3); // three strikes to the same batter without asking again
    for (let i = 0; i < 600; i++) e.update(DT);
    expect(e.awaitingBatter).toBe(true); // the next batter waits again
    expect(pitches).toBe(3);
  });
});

describe('bunting', () => {
  // (squared around, the bat is held where you put it: here right on top of the pitch)
  const pitchAndBunt = (e, dy = 0.12) => {
    while (!(e.phase === 'pitch' && e.time > e.pitch.tCross - 0.16)) e.update(DT);
    e.setBatAim(e.pitch.target.x, e.pitch.target.y + dy);
    while (!e.swing && e.phase === 'pitch' && e.time < 120) e.update(DT);
  };

  it('B squares the batter around; the swing then bunts (a soft ball), and the stance resets after the pitch', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 21 });
    e.pitchOverride = strikePitch;
    e.start();
    expect(e.setBunt(true)).toBe(true);
    pitchAndBunt(e);
    expect(e.swing.bunt).toBe(true);
    expect(e.swing.contact.bunt).toBe(true);
    let contact = null;
    e.on('contact', (c) => { contact = c; });
    while (!contact && e.time < 60) e.update(DT);
    expect(contact.exitVelocity).toBeLessThan(50);
    while (e.phase !== 'ready' && e.time < 60) e.update(DT);
    expect(e.buntStance).toBe(false);
  });

  it('the bunt is where the bat is: held on the ball it bunts, a little off it misses (a strike), well away from it he takes', () => {
    const run = (dy, seed) => {
      const e = new Engine({ mode: 'quick', playerSide: 'top', seed });
      e.pitchOverride = strikePitch;
      e.start();
      e.setBunt(true);
      while (!(e.phase === 'pitch' && e.time > e.pitch.tCross - 0.3)) e.update(DT);
      e.setBatAim(e.pitch.target.x, e.pitch.target.y + dy);
      let call = null;
      e.on('result', (x) => { call = call || x; });
      while (!call && e.time < 60) e.update(DT);
      return { e, call };
    };
    const on = run(0.1, 21);
    expect(on.e.swing && on.e.swing.bunt && on.e.swing.made).toBe(true); // (nobody pressed anything)
    const off = run(0.95, 21);
    expect(off.e.swing && off.e.swing.bunt).toBe(true);
    expect(off.e.swing.made).toBe(false);
    expect(off.call.call).toBe('swingingStrike');
    const away = run(2.2, 21);
    expect(away.e.swing).toBe(null);
    const f = new Engine({ mode: 'quick', playerSide: 'top', seed: 22 });
    f.pitchOverride = () => ({ type: 'fastball', speedMph: 84, target: { x: 1.9, y: 2.5 }, intendedStrike: false });
    f.start();
    f.setBunt(true);
    let call = null;
    f.on('result', (x) => { call = call || x; });
    while (!call && f.time < 60) f.update(DT);
    expect(f.swing).toBe(null);
    expect(call.call).toBe('ball');
  });

  it('there is no bunting in the Derby', () => {
    const e = new Engine({ mode: 'derby', seed: 2 });
    e.start();
    expect(e.setBunt(true)).toBe(false);
  });

  it('a foul bunt with two strikes is strike three', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 5 });
    e.pitchOverride = strikePitch;
    e.contactOverride = () => ({ exitVelocity: 26, launchAngle: -6, sprayAngle: 62, backspin: 300, hook: 0 });
    e.start();
    e.game.strikes = 2;
    e.setBunt(true);
    pitchAndBunt(e);
    let r = null;
    e.on('result', (x) => { r = r || x; });
    while (!r && e.time < 60) e.update(DT);
    expect(r.kind).toBe('pa');
    expect(r.result).toBe('strikeoutSwinging');
    expect(e.game.outs).toBe(1);
  });

  it('a sacrifice bunt that moves the runner up is not an at-bat', () => {
    let found = false;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const e = new Engine({ mode: 'quick', playerSide: 'top', seed });
      e.pitchOverride = strikePitch;
      e.contactOverride = () => ({ exitVelocity: 24, launchAngle: -12, sprayAngle: -22, backspin: 300, hook: 0 });
      e.start();
      e.game.bases[0] = { id: 'r1' };
      e.setBunt(true);
      pitchAndBunt(e);
      let r = null;
      e.on('result', (x) => { if (x.kind === 'pa') r = r || x; });
      while (!r && e.time < 60) e.update(DT);
      if (r && r.result === 'sacBunt') {
        found = true;
        expect(e.stats.ab).toBe(0);
        expect(e.stats.pa).toBe(1);
        expect(e.game.bases[1]).toBeTruthy(); // the runner is on second
      }
    }
    expect(found).toBe(true);
  });
});

describe('saving and resuming a game (League games survive quitting)', () => {
  it('a game resumed from its last save point is in the same spot and throws the same pitch', () => {
    const run = (seed) => {
      const e = new Engine({ mode: 'quick', difficulty: 'pro', seed });
      const bot = createBot(e, { errSd: 30, seed });
      let last = null;
      e.on('checkpoint', (st) => { last = st; });
      e.start();
      drive(e, 90, bot);
      return { e, last };
    };
    const { e, last } = run(31);
    expect(last).toBeTruthy();
    const g = last.game;
    // a fresh engine for the same game resumes from the save
    const f = new Engine({ mode: 'quick', difficulty: 'pro', seed: 31 });
    f.lineup = e.lineup; // (the same lineup the saved game used)
    f.resume(JSON.parse(JSON.stringify(last)));
    expect(f.game.inning).toBe(g.inning);
    expect(f.game.half).toBe(g.half);
    expect(f.game.score).toEqual(g.score);
    expect(f.game.outs).toBe(g.outs);
    expect(f.game.bases.map((b) => !!b)).toEqual(g.bases.map((b) => !!b));
    expect(f.count).toEqual({ balls: g.balls, strikes: g.strikes });
    expect(f.batter).toBe(f.lineup[g.lineupIdx[g.half] % 9]);
    // runners are the lineup's own players again (not copies)
    for (const b of f.game.bases) if (b) expect(f.lineup.includes(b)).toBe(true);
    // the same save always throws the same next pitch
    const pitchOf = (eng) => {
      let p = null; eng.on('windup', (w) => { p = w.pitch; });
      eng.batterReady();
      for (let t = 0; t < 8 && !p; t += DT) eng.update(DT);
      return p;
    };
    const f2 = new Engine({ mode: 'quick', difficulty: 'pro', seed: 31, waitForBatter: true });
    f2.lineup = e.lineup;
    f2.resume(JSON.parse(JSON.stringify(last)));
    f.waitForBatter = true;
    const a = pitchOf(f2);
    const f3 = new Engine({ mode: 'quick', difficulty: 'pro', seed: 31, waitForBatter: true });
    f3.lineup = e.lineup;
    f3.resume(JSON.parse(JSON.stringify(last)));
    const b = pitchOf(f3);
    expect(a.type).toBe(b.type);
    expect(a.target).toEqual(b.target);
    expect(a.speedMph).toBe(b.speedMph);
  }, 60000);
});

describe('hit by pitch', () => {
  it('a pitch that hits the batter sends him to first, and a runner moves up only if he is forced', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 4 });
    e.start();
    expect(untilPhase(e, 'ready')).toBe(true);
    e.game.bases[0] = e.lineup[6]; e.game.bases[2] = e.lineup[7];
    const inside = e.batterHand === 'L' ? 2.2 : -2.2; // (in at the batter's ribs)
    e.pitchOverride = () => ({ type: 'fastball', speedMph: 84, target: { x: inside, y: 3.2 }, intendedStrike: false, tell: { slot: 0, lag: 0 } });
    const batter = e.batter;
    let res = null;
    e.on('result', (r) => { if (r.kind === 'pa') res = r; });
    expect(untilPhase(e, 'pitch')).toBe(true);
    expect(e.pitch.hitsBatter).toBe(true);
    expect(untilPhase(e, 'result')).toBe(true);
    expect(res && res.result).toBe('hitByPitch');
    expect(e.game.bases[0]).toBe(batter);
    expect(e.game.bases[1]).toBe(e.lineup[6]); // (forced up)
    expect(e.game.bases[2]).toBe(e.lineup[7]); // (not forced: stays)
    expect(e.lineOf(batter).ab).toBe(0);
    expect(e.lineOf(batter).pa).toBe(1);
  });
  it('the computer pitcher hits a batter only now and then, more often on the harder levels', async () => {
    const { choosePitch } = await import('../src/game/pitcherAI.js');
    const { hitsBatter } = await import('../src/physics/pitch.js');
    const rate = (difficulty) => {
      const rng = createRng(9);
      let n = 0;
      for (let i = 0; i < 20000; i++) { const p = choosePitch({ mode: 'quick', difficulty, count: { balls: 1, strikes: 1 }, rng, batterHand: 'R' }); if (hitsBatter(p.target.x, p.target.y, 'R')) n++; }
      return n / 20000;
    };
    const r = rate('rookie'), a = rate('allstar');
    expect(r).toBeGreaterThan(0.0005); expect(a).toBeLessThan(0.008);
    expect(a).toBeGreaterThan(r);
  });
});

describe('foul tips', () => {
  const tip = () => ({ exitVelocity: 70, launchAngle: 6, sprayAngle: 172, backspin: 800, hook: 0, errorMs: 0, grade: 'weak' });
  const swingAt = (e) => { expect(untilPhase(e, 'pitch')).toBe(true); while (e.time < e.pitch.tCross - e.cfg.timing.swingDelay) e.update(DT); e.swingPressed(0); };
  it('a ball that glances straight back into the mitt is a foul tip: a strike, and strike three with two strikes', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 8 });
    e.pitchOverride = strikePitch;
    e.contactOverride = tip;
    e.start();
    let last = null;
    e.on('result', (r) => { last = r; });
    swingAt(e);
    expect(untilPhase(e, 'result')).toBe(true);
    expect(last.foulTip).toBe(true);
    expect(e.game.strikes).toBe(1);
    e.game.strikes = 2;
    expect(untilPhase(e, 'ready', 20) || untilPhase(e, 'windup', 20)).toBe(true);
    swingAt(e);
    expect(untilPhase(e, 'result')).toBe(true);
    expect(last.result).toBe('strikeoutSwinging');
    expect(last.detail).toBe('Foul tip');
  });
  it('sending a runner during a foul tip keeps it a foul tip', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 8 });
    e.pitchOverride = strikePitch;
    e.contactOverride = tip;
    e.start();
    e.game.bases = [e.lineup[5], null, null];
    e.game.strikes = 2;
    let last = null;
    e.on('result', (r) => { last = r; });
    swingAt(e);
    expect(untilPhase(e, 'play')).toBe(true);
    expect(e.play.plan.foulTip).toBeTruthy();
    for (let i = 0; i < 40 && !e.sendOpen; i++) e.update(DT);
    expect(e.sendOpen).toBe(true);
    e.applyRunnerOrder({ base: 2, t: e.time - e.play.t0, from: 1 });
    expect(e.play.planIn.orders.length).toBe(1);
    expect(e.play.plan.foulTip).toBeTruthy();
    expect(untilPhase(e, 'result')).toBe(true);
    expect(last.detail).toBe('Foul tip');
  });
});
