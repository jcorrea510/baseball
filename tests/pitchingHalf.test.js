// You pitch the computer's half: the aim / delivery / ring phases, the computer's batter and runners, your pitching line, saving
// mid-half, and the referee on the computer's balls in play.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { auditPlan } from '../src/game/playAudit.js';

const DT = 1 / 120;
const OPTS = { mode: 'quick', seed: 11, cpuHalf: 'pitch' };
const make = (o = {}) => new Engine({ ...OPTS, ...o });
const strikePitch = () => ({ type: 'fastball', speedMph: 84, target: { x: 0, y: 2.5 }, intendedStrike: true, tell: { slot: 0, lag: 0 } });
const swingMiddle = () => ({ swing: true, errorMs: 0, aim: { x: 0, y: 2.4 }, protect: false });
const until = (e, f, max = 60) => { for (let t = 0; t < max && !f(); t += DT) e.update(DT); return f(); };

// One pitch: choose it, aim, start the delivery, tap the ring `errMs` from the moment it meets the target (null = no tap), then play
// it out until you are aiming again (or the half / the game is over).
function pitchOne(e, { type, aim = { x: 0.45, y: 2.2 }, errMs = 0 } = {}) {
  const half = e.game.half, inning = e.game.inning;
  if (type) e.selectPitch(type);
  e.setPitchAim(aim.x, aim.y);
  if (!e.startDelivery()) throw new Error('could not start the delivery in ' + e.phase);
  if (errMs !== null) {
    const target = e.ring.tStart + e.ring.hitAt + errMs / 1000;
    while (e.time + DT < target) e.update(DT);
    e.ringTap(target - e.time); // (exactly at that moment, whatever the frame)
  }
  until(e, () => e.over || e.phase === 'aim' || e.game.half !== half || e.game.inning !== inning);
}
// Strike the player out three times (nobody swings at strikes down the middle): his half is over.
function strikeOutTheSide(e) {
  e.pitchOverride = strikePitch;
  const half = e.game.half, inning = e.game.inning;
  until(e, () => e.game.half !== half || e.game.inning !== inning || e.over, 200);
  e.pitchOverride = null;
}

describe('whose half it is', () => {
  it('the computer bats first and you pitch', () => {
    const e = make();
    expect(e.offense).toBe('cpu');
    e.start();
    expect(e.phase).toBe('aim');
    expect(e.offense).toBe('cpu');
    expect(e.pitching).toBe(true);
    expect(e.batter).toBe(e.oppLineup[0]);
    expect(e.battingLineup).toBe(e.oppLineup);
    expect(e.pitcher).toBe(e.staff[0]); // (your starter is on the mound)
    expect(e.myPitcher).toBe(e.staff[0]);
    expect(e.tally).toBe(e.cpuStats);
    // the player's batting inputs do nothing while he is in the field
    expect(e.setBunt(true)).toBe(false);
    expect(e.canSteal).toBe(false);
    expect(e.staff.length).toBe(4);
    expect(e.staff.filter((p) => p.role === 'SP').length).toBe(2);
    for (const p of e.staff) for (const k of ['vel', 'ctl', 'stf', 'sta']) expect(p[k]).toBeGreaterThanOrEqual(1);
  });

  it('nothing moves without update(dt): the delivery and the ring run on engine time, a tap after a pause is graded by engine time', () => {
    const e = make();
    e.start();
    let released = 0, grade = null;
    e.on('release', () => released++);
    e.on('pitchGrade', (g) => { grade = g.grade; });
    e.setPitchAim(0.3, 2.4);
    expect(e.startDelivery()).toBe(true);
    expect(e.startDelivery()).toBe(false); // (once)
    const r = e.ring, t0 = e.time;
    const meet = r.tStart + r.hitAt;
    while (e.time + DT < meet) e.update(DT);
    expect(released).toBe(0);
    // the game is paused here for as long as you like: no updates, nothing moves - the engine's clock stands still
    const tPaused = e.time;
    expect(e.phase).toBe('delivery');
    expect(e.ringTap(meet - e.time)).toBe(true); // (the tap lands exactly as the ring meets the target, by engine time)
    expect(e.time).toBe(tPaused);
    expect(Math.abs(e.ring.errMs)).toBeLessThan(1e-6);
    expect(e.ringTap(0)).toBe(false); // (one tap a delivery)
    // the ball leaves the hand only once updates add up to the delivery
    const tRel = t0 + CONFIG.pitching.delivery;
    while (!released) {
      expect(e.time).toBeLessThan(tRel);
      e.update(DT);
    }
    expect(e.time).toBeGreaterThanOrEqual(tRel);
    expect(e.time).toBeLessThan(tRel + DT + 1e-9);
    expect(grade).toBe('perfect');
    expect(e.phase).toBe('pitch');
    expect(e.pitch.tRelease).toBeCloseTo(t0 + CONFIG.pitching.delivery, 9);
    expect(e.pitch.tCross - e.pitch.tRelease).toBeCloseTo(e.pitch.flight.T, 9); // (real speed: pace 1)
  });

  it('the ring sets the grade', () => {
    const grades = [];
    for (const errMs of [0, 200, null]) {
      const e = make({ seed: 21 });
      e.on('pitchGrade', (g) => grades.push(g.grade));
      e.start();
      pitchOne(e, { type: 'fastball', errMs });
    }
    expect(grades).toEqual(['perfect', 'wild', 'wild']);
  });
});

describe('a half you pitch', () => {
  it('a whole half ends with three outs and the player\'s batting stats untouched', () => {
    const e = make();
    e.start();
    const before = JSON.stringify(e.stats), linesBefore = JSON.stringify(e.lines);
    let outsAtChange = null;
    e.on('halfEnd', () => { outsAtChange = e.pitchStats.outs; });
    for (let k = 0; k < 300 && e.offense === 'cpu' && !e.over; k++) pitchOne(e, { aim: { x: k % 2 ? 0.75 : -0.75, y: 1.9 } });
    expect(e.offense).toBe('player');
    expect(outsAtChange).toBe(3);
    expect(JSON.stringify(e.stats)).toBe(before);
    expect(JSON.stringify(e.lines)).toBe(linesBefore);
    expect(Object.keys(e.lines).some((id) => id.startsWith('o'))).toBe(false);
    expect(Object.keys(e.oppLines).length).toBeGreaterThan(0);
    expect(e.cpuStats.pa).toBeGreaterThanOrEqual(3);
    expect(e.phase).toBe('ready');
    expect(e.batter).toBe(e.lineup[0]);
    expect(e.pitcher).toBe(e.oppPitcher);
  });

  it('pitch stats match the results of the half', () => {
    const e = make({ seed: 5 });
    e.start();
    const seen = { k: 0, bb: 0, h: 0, hr: 0, r: 0 };
    let pitches = 0;
    e.on('release', () => { if (e.offense === 'cpu') pitches++; });
    e.on('result', (r) => {
      if (e.offense !== 'cpu') return;
      seen.r += r.runs || 0;
      if (r.kind !== 'pa') return;
      if (/^strikeout/.test(r.result)) seen.k++;
      if (r.result === 'walk') seen.bb++;
      if (['single', 'double', 'triple', 'homer', 'insideParkHomer'].includes(r.result)) seen.h++;
      if (r.result === 'homer' || r.result === 'insideParkHomer') seen.hr++;
    });
    // hittable pitches (some over the middle, some badly tapped) so things happen
    for (let k = 0; k < 300 && e.offense === 'cpu' && !e.over; k++) pitchOne(e, { aim: { x: (k % 3 - 1) * 0.3, y: 2.4 }, errMs: [0, 60, 130, 220][k % 4] });
    const ps = e.pitchStats;
    expect(ps.k).toBe(seen.k);
    expect(ps.bb).toBe(seen.bb);
    expect(ps.h).toBe(seen.h);
    expect(ps.hr).toBe(seen.hr);
    expect(ps.r).toBe(seen.r);
    expect(ps.er).toBe(seen.r); // (nobody reached on an error)
    expect(ps.outs).toBe(3);
    expect(ps.pitches).toBe(pitches);
    expect(e.mound.pitches).toBe(pitches);
    expect(ps.byPitcher[e.staff[0].id]).toEqual({ outs: ps.outs, h: ps.h, r: ps.r, er: ps.er, bb: ps.bb, k: ps.k, hr: ps.hr, pitches: ps.pitches });
    expect(e.mound.recent.length).toBe(2);
  });

  it('a run scored by a runner who reached on an error is unearned', () => {
    const e = make({ seed: 8 });
    e.start();
    const results = [];
    e.on('result', (r) => { if (r.kind === 'pa') results.push(r.result); });
    // the leadoff man hits a routine fly ball and your center fielder drops it
    e.cpuSwingOverride = swingMiddle;
    e.errorRollOverride = 0;
    e.contactOverride = () => ({ exitVelocity: 84, launchAngle: 34, sprayAngle: 2, backspin: 2400, hook: 0 });
    pitchOne(e);
    expect(results).toEqual(['error']);
    expect(e.game.bases.filter(Boolean).length).toBe(1);
    expect(e.pitchStats.outs).toBe(0);
    // then a two-run homer: one earned run (the batter's), one unearned (the man who reached on the error)
    e.errorRollOverride = null;
    e.contactOverride = () => ({ exitVelocity: 112, launchAngle: 28, sprayAngle: -15, backspin: 2500, hook: 0 });
    pitchOne(e);
    expect(results).toEqual(['error', 'homer']);
    expect(e.pitchStats.r).toBe(2);
    expect(e.pitchStats.er).toBe(1);
    expect(e.pitchStats.h).toBe(1);
    expect(e.pitchStats.hr).toBe(1);
    expect(e.game.errors[e.playerSide]).toBe(1); // (charged to your team)
  });

  it('the computer walks off on the road: the game ends at once as a loss', () => {
    const e = make({ playerSide: 'top', innings: 1, seed: 14 });
    let over = null, aimsAfter = 0;
    e.on('gameOver', (p) => { over = p; });
    e.on('aimStart', () => { if (over) aimsAfter++; });
    e.start();
    expect(e.offense).toBe('player');
    strikeOutTheSide(e);
    expect(e.game.half).toBe('bottom');
    expect(e.game.inning).toBe(1);
    expect(e.phase).toBe('aim');
    expect(e.game.score).toEqual({ top: 0, bottom: 0 });
    e.game.bases[2] = e.oppLineup[8];
    e.cpuSwingOverride = swingMiddle;
    e.contactOverride = () => ({ exitVelocity: 96, launchAngle: 11, sprayAngle: 4, backspin: 1500, hook: 0 }); // (a liner into center)
    pitchOne(e);
    until(e, () => e.over, 30);
    expect(over).toBeTruthy();
    expect(over.won).toBe(false);
    expect(e.game.walkOff).toBe(true);
    expect(e.game.score.bottom).toBe(1);
    expect(e.phase).toBe('gameOver');
    for (let k = 0; k < 600; k++) e.update(DT);
    expect(aimsAfter).toBe(0);
    expect(e.phase).toBe('gameOver');
  });
});

describe('saving in the middle of your half', () => {
  it('saved mid-half, resumed on the same pitch', () => {
    const e1 = make({ seed: 31 });
    let last = null;
    e1.on('checkpoint', (st) => { last = st; });
    e1.start();
    pitchOne(e1, { type: 'fastball', aim: { x: 0.5, y: 2.3 }, errMs: 30 });
    pitchOne(e1, { aim: { x: -0.6, y: 1.8 }, errMs: -70 });
    pitchOne(e1, { aim: { x: 0.2, y: 3.1 }, errMs: 120 });
    expect(e1.phase).toBe('aim');
    expect(e1.offense).toBe('cpu');
    const st = JSON.parse(JSON.stringify(last));
    const e2 = make({ seed: 31 });
    e2.resume(st);
    expect(e2.phase).toBe('aim');
    expect(e2.offense).toBe('cpu');
    expect(e2.batter.id).toBe(e1.batter.id);
    expect(e2.count).toEqual(e1.count);
    expect(e2.outs).toBe(e1.outs);
    expect(e2.mound.pitcher).toBe(e2.staff[0]);
    expect(e2.mound.left).toBe(e1.mound.left);
    expect(e2.mound.pitches).toBe(e1.mound.pitches);
    expect(e2.mound.recent).toEqual(e1.mound.recent);
    expect(e2.pitchStats).toEqual(e1.pitchStats);
    // the same pitch, thrown the same way, in both games
    // (the two games keep different clocks, so the tap's error can differ in the last bits of a float: compared to a millionth)
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const seen = (e) => {
      const out = [];
      e.on('pitchGrade', (g) => out.push(['grade', g.grade, g.wildKind]));
      e.on('release', ({ pitch }) => out.push(['pitch', pitch.type, r6(pitch.speedMph), r6(pitch.target.x), r6(pitch.target.y)]));
      e.on('pitchCall', (c) => out.push(['call', c.call]));
      e.on('contact', (c) => out.push(['contact', r6(c.exitVelocity), r6(c.launchAngle), c.result]));
      e.on('result', (r) => out.push(['result', r.result || r.call, r.runs || 0]));
      return out;
    };
    const a = seen(e1), b = seen(e2);
    for (const k of [0, 1, 2]) {
      const p = { type: 'fastball', aim: { x: 0.1 * k, y: 2.5 }, errMs: [10, -50, 90][k] };
      pitchOne(e1, p); pitchOne(e2, p);
    }
    expect(a.length).toBeGreaterThan(6);
    expect(b).toEqual(a);
  });

  it('an old save without side state resumes at your next turn at bat', () => {
    const e1 = new Engine({ mode: 'quick', seed: 4 });
    let st = null;
    e1.on('checkpoint', (s) => { if (e1.offense === 'player' && !st) st = s; });
    e1.start();
    until(e1, () => st, 400);
    expect(st).toBeTruthy();
    const old = JSON.parse(JSON.stringify(st));
    delete old.side;
    const e2 = new Engine({ mode: 'quick', seed: 4 });
    e2.resume(old);
    expect(e2.phase).toBe('ready');
    expect(e2.offense).toBe('player');
    expect(e2.batter.id).toBe(e1.batter.id);
    expect(e2.mound.pitcher).toBe(e2.staff[0]);
    expect(e2.mound.pitches).toBe(0); // (your pitchers start fresh)
  });
});

describe('the referee on the computer\'s balls in play', () => {
  it('finds nothing wrong in 200 halves the computer pitches for you', () => {
    const problems = [];
    let plays = 0, sends = 0, halves = 0;
    for (let s = 1; s <= 200; s++) {
      const e = new Engine({ mode: 'quick', seed: s * 104729, difficulty: ['rookie', 'pro', 'allstar'][s % 3], cpuHalf: 'auto' });
      e.on('result', (r) => {
        if (!r.plan || e.offense !== 'cpu') return;
        plays++;
        for (const p of auditPlan(r.plan, e.defense)) problems.push(`seed ${s}: ${p}`);
      });
      e.on('send', () => { if (e.offense === 'cpu') sends++; });
      e.start();
      let t = 0;
      while (e.offense === 'cpu' && !e.over && t < 900) { e.update(1 / 60); t += 1 / 60; }
      if (e.offense === 'cpu' && !e.over) problems.push(`seed ${s}: the half never ended`);
      else halves++;
    }
    expect(problems).toEqual([]);
    expect(halves).toBe(200);
    expect(plays).toBeGreaterThan(200);
    expect(sends).toBeGreaterThan(0); // (the computer sends its own runners)
  }, 240000); // (about 20 s on its own; much slower while every test file runs at once)
});
