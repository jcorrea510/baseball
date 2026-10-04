// You pitch the computer's half: the aim / delivery / ring phases, the computer's batter and runners, your pitching line, saving
// mid-half, and the referee on the computer's balls in play.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import { auditPlan } from '../src/game/playAudit.js';
import { staminaMax } from '../src/game/pitching.js';

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
    let over = null, aimsAfter = 0, tWalkOff = null, tOver = null;
    e.on('gameOver', (p) => { over = p; tOver = e.time; });
    e.on('result', (r) => { if (r.walkOff && tWalkOff === null) tWalkOff = e.time; });
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
    expect(tOver - tWalkOff).toBeLessThan(1.6); // (as quick as your own walk-off: no wait for the next pitch or the pitcher)
    for (let k = 0; k < 600; k++) e.update(DT);
    expect(aimsAfter).toBe(0);
    expect(e.phase).toBe('gameOver');
  });

  it('you cannot send or call back the computer\'s runners', () => {
    const e = make({ seed: 9 });
    e.start();
    e.game.bases[0] = e.oppLineup[8];
    e.cpuSwingOverride = swingMiddle;
    e.contactOverride = () => ({ exitVelocity: 96, launchAngle: 11, sprayAngle: 4, backspin: 1500, hook: 0 }); // (a liner into center)
    e.setPitchAim(0.3, 2.4);
    e.startDelivery();
    expect(until(e, () => e.phase === 'play', 10)).toBe(true);
    let looked = 0;
    while (e.phase === 'play') {
      expect(e.sendOpen).toBe(false);
      for (const b of [2, 3, 4]) expect(e.tapBase(b)).toBe(false);
      expect(e.runnerOrder(1, 'back')).toBe(false);
      expect(e.sendRunner(3)).toBe(false);
      looked++;
      e.update(DT);
    }
    expect(looked).toBeGreaterThan(60);
  });

  it('a swing he decided on is a swing, even one so late that the pitch would have hit him', () => {
    const e = make({ seed: 12 });
    e.start();
    const calls = [];
    e.on('pitchCall', (c) => calls.push(c.call));
    e.cpuSwingOverride = () => ({ swing: true, errorMs: 160, aim: { x: 0, y: 2.4 }, protect: false }); // (presses after the ball crosses)
    const inside = e.batterHand === 'L' ? 1 : -1;
    e.setPitchAim(inside * 1.9, 3);
    e.startDelivery();
    const meet = e.ring.tStart + e.ring.hitAt;
    while (e.time + DT < meet) e.update(DT);
    e.ringTap(meet - e.time); // (PERFECT: right at him)
    expect(until(e, () => e.phase === 'pitch', 5)).toBe(true);
    expect(e.pitch.hitsBatter).toBe(true);
    expect(e.cpuSwing.tPress).toBeGreaterThan(e.pitch.tCross);
    expect(until(e, () => e.phase !== 'pitch', 5)).toBe(true);
    expect(calls).toEqual(['swingingStrike']);
    expect(e.count.strikes).toBe(1);
    expect(e.game.bases.some(Boolean)).toBe(false);
  });

  it('the computer pitching for you seldom hits a batter', () => {
    let pa = 0, hbp = 0;
    for (let s = 1; s <= 150; s++) {
      const e = new Engine({ mode: 'quick', seed: s * 7919, difficulty: 'pro', cpuHalf: 'auto' });
      e.on('result', (r) => { if (r.kind === 'pa' && e.offense === 'cpu') { pa++; if (r.result === 'hitByPitch') hbp++; } });
      e.start();
      for (let t = 0; t < 900 && e.offense === 'cpu' && !e.over; t += 1 / 60) e.update(1 / 60);
    }
    expect(pa).toBeGreaterThan(400);
    expect(hbp / pa).toBeLessThanOrEqual(0.025);
  }, 240000);
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

describe('Sim', () => {
  const simDone = (e) => { const out = []; e.on('simDone', (d) => out.push(d)); return out; };

  it('the recap lines add up to the total runs over many halves, wild pitches and steals included', () => {
    let lines = 0, wild = 0, withRuns = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const e = make({ seed: seed * 7919, innings: 9 });
      const done = simDone(e);
      e.start();
      e.on('result', (r) => { if (r.kind === 'steal' && r.result === 'wildPitch') wild++; });
      for (let h = 0; h < 6 && !e.over; h++) {
        if (e.offense !== 'cpu') { until(e, () => e.offense === 'cpu' || e.over, 1); if (e.offense !== 'cpu') { for (let t = 0; t < 300 && e.offense !== 'cpu' && !e.over; t += DT) { if (e.phase === 'ready') e.batterReady(); e.update(DT); } } }
        if (e.offense !== 'cpu' || e.over) break;
        e.simHalf();
        for (let i = 0; i < 400 && e.simming && !e.over; i++) e.simStep(3);
      }
      for (const d of done) { lines += d.events.length; if (d.runs) withRuns++; expect(d.events.reduce((s, x) => s + x.runs, 0)).toBe(d.runs); }
    }
    expect(lines).toBeGreaterThan(100);
    expect(withRuns).toBeGreaterThan(0);
    void wild;
  }, 240000);

  it('a run on a wild pitch gets its own recap line', () => {
    const e = make({ seed: 3 });
    e.start();
    const done = simDone(e);
    e.simHalf();
    // (a wild pitch that scores, as the engine reports it)
    e.game.bases[2] = { id: 'x', name: 'Runner' };
    e.game.score[e.game.half] += 1;
    e.emit('result', { kind: 'steal', result: 'wildPitch', runs: 1, base: 4, outs: 0, halfOver: false });
    expect(e.simRecap.events[0].text).toBe('Wild pitch - runner scores.');
    expect(e.simRecap.events[0].runs).toBe(1);
    e.emit('result', { kind: 'steal', result: 'stolenBase', base: 2, outs: 0, halfOver: false });
    expect(e.simRecap.events[1].text).toBe('The runner steals second.');
    expect(e.simRecap.events[1].runs).toBe(0);
    expect(done.length).toBe(0);
  });

  it('finishes the half at once through simStep: a recap line per plate appearance, the runs, the stamina used', () => {
    const e = make({ seed: 21 });
    e.start();
    const pas = [], done = simDone(e), before = { ...e.game.score };
    e.on('result', (r) => { if (r.kind === 'pa') pas.push(r); });
    const inning = e.game.inning, half = e.game.half;
    expect(e.simHalf()).toBe(true);
    expect(e.simHalf()).toBe(false); // (twice does nothing extra)
    expect(e.simming).toBe(true);
    for (let i = 0; i < 400 && e.simming; i++) e.simStep(3);
    expect(e.simming).toBe(false);
    expect(e.simStep(5)).toBe(false); // (no-op when not simming)
    expect(done.length).toBe(1);
    const d = done[0];
    expect(d.inning).toBe(inning); expect(d.half).toBe(half);
    expect(d.events.length).toBe(pas.length);
    expect(d.events.length).toBeGreaterThanOrEqual(3);
    for (const ev of d.events) { expect(typeof ev.text).toBe('string'); expect(ev.text.length).toBeGreaterThan(3); }
    expect(d.runs).toBe(e.game.score[half] - before[half]);
    expect(d.events.reduce((s, x) => s + x.runs, 0)).toBe(d.runs);
    expect(d.score).toEqual({ ...e.game.score });
    expect(e.offense).toBe('player'); // (the half is over: you bat)
    expect(e.mound.pitches).toBeGreaterThanOrEqual(3);
    expect(e.pitchStats.pitches).toBe(e.mound.pitches);
  });

  it('pressed just after the release, that pitch is thrown exactly as it would have been, then the computer takes over', () => {
    const a = make({ seed: 33 }), b = make({ seed: 33 });
    const calls = (e) => { const out = []; e.on('pitchCall', (c) => out.push(c.call)); e.on('release', ({ pitch }) => out.push([pitch.type, Math.round(pitch.speedMph * 1e4), Math.round(pitch.target.x * 1e4), Math.round(pitch.target.y * 1e4)].join())); return out; };
    const ca = calls(a), cb = calls(b);
    a.start(); b.start();
    for (const e of [a, b]) { e.selectPitch('fastball'); e.setPitchAim(0.2, 2.3); e.startDelivery(); }
    for (const e of [a, b]) while (e.phase === 'delivery') e.update(DT);
    expect(a.phase).toBe('pitch');
    expect(a.simHalf()).toBe(true);
    expect(a.phase).toBe('pitch'); // (nothing changed under the ball)
    until(a, () => a.phase === 'aim' || a.phase === 'result', 20);
    until(b, () => b.phase === 'aim' || b.phase === 'result', 20);
    expect(ca.length).toBeGreaterThanOrEqual(2);
    expect(ca.slice(0, 2)).toEqual(cb.slice(0, 2)); // (the release, then the call)
    // and the computer goes on pitching
    const done = simDone(a);
    for (let i = 0; i < 400 && a.simming; i++) a.simStep(3);
    expect(done.length).toBe(1);
  });

  it('Sim is refused mid-delivery, and a Sim takes no delivery or ring tap from you', () => {
    const e = make({ seed: 33 });
    e.start();
    e.startDelivery();
    e.update(0.2);
    expect(e.phase).toBe('delivery');
    expect(e.simHalf()).toBe(false);
    expect(e.simming).toBe(false);
    while (e.phase === 'delivery') e.update(DT);
    expect(e.simHalf()).toBe(true);
    until(e, () => e.phase === 'aim' || e.phase === 'result', 20);
    const r = e.ring;
    expect(e.startDelivery()).toBe(false); // (simming: refused)
    expect(e.ring).toBe(r);
    until(e, () => e.phase === 'aim', 20);
    e.simming = false; e.simRecap = null;
    expect(e.startDelivery()).toBe(true);
    e.simming = true; // (as if a Sim were on during a delivery)
    expect(e.ringTap(0)).toBe(false);
    e.simming = false;
  });

  it('pressed during a play, the play finishes first', () => {
    const run = (sim) => {
      const e = make({ seed: 5 });
      e.cpuSwingOverride = swingMiddle;
      e.start();
      const results = [];
      e.on('result', (r) => results.push([r.kind, r.result || r.call, r.runs || 0]));
      let played = false;
      for (let i = 0; i < 12 && !played; i++) {
        e.setPitchAim(0, 2.4); e.startDelivery();
        until(e, () => e.phase === 'play' || e.phase === 'aim' || e.over, 30);
        played = e.phase === 'play';
      }
      expect(played).toBe(true);
      const n = results.length;
      if (sim) expect(e.simHalf()).toBe(true);
      until(e, () => e.phase === 'result' || e.phase === 'aim' || e.over, 60);
      expect(e.phase).not.toBe('play');
      return { first: results.slice(0, n + 1), n, e };
    };
    const a = run(true), b = run(false);
    expect(a.first).toEqual(b.first);
    expect(a.e.simming).toBe(true);
  });

  it('a road game that ends on a computer run during a Sim says gameOver and no recap', () => {
    let tested = 0;
    for (let seed = 1; seed <= 40 && !tested; seed++) {
      const e = make({ seed, playerSide: 'top', innings: 1 });
      e.cpuSwingOverride = swingMiddle; // (their batters swing at everything down the middle)
      let overs = 0; const done = simDone(e);
      e.on('gameOver', () => overs++);
      e.start();
      // you bat first and take every pitch; then it is the bottom of the last inning of a tie (nothing scored by you)
      for (let t = 0; t < 600 && e.offense !== 'cpu' && !e.over; t += DT) { if (e.phase === 'ready') e.batterReady(); e.update(DT); }
      if (e.over || e.offense !== 'cpu' || e.game.score.top !== 0 || e.game.inning !== 1) continue;
      expect(e.simHalf()).toBe(true);
      for (let i = 0; i < 400 && e.simming && !e.over; i++) e.simStep(3);
      if (!e.over) continue; // (it did not score: the game goes to extra innings)
      tested++;
      expect(overs).toBe(1);
      expect(done.length).toBe(0);
      expect(e.simming).toBe(false);
      expect(e.game.winner).toBe('bottom');
    }
    expect(tested).toBe(1);
  }, 120000);
});

describe('stamina', () => {
  const firstPitch = (e) => {
    let out = null, ring = null;
    e.on('release', ({ pitch }) => { if (!out) out = pitch; });
    e.selectPitch('fastball');
    e.setPitchAim(0.3, 2.3);
    e.startDelivery();
    ring = e.ring;
    const target = e.ring.tStart + e.ring.hitAt;
    while (e.time + DT < target) e.update(DT);
    e.ringTap(target - e.time);
    until(e, () => out, 10);
    return { pitch: out, ring };
  };

  it('every pitch takes stamina and says so', () => {
    const e = make({ seed: 21 });
    e.start();
    const seen = [];
    e.on('stamina', (s) => seen.push(s));
    const max = e.mound.max, start = e.mound.left;
    expect(start).toBe(max);
    for (let k = 0; k < 4; k++) pitchOne(e, { type: 'fastball' });
    expect(e.mound.pitches).toBe(4);
    expect(seen.length).toBe(4);
    expect(e.mound.left).toBeLessThan(max - 3.9);
    expect(e.mound.left).toBeGreaterThan(max - 4 * 1.6);
    expect(seen[3]).toEqual({ left: e.mound.left, max });
  });

  it('a tired starter throws slower and the ring shrinks faster', () => {
    const fresh = make({ seed: 9 }); fresh.start();
    const tired = make({ seed: 9 }); tired.start();
    tired.mound.left = 90 >= tired.mound.max ? 0 : tired.mound.max - 90; // (as if ninety pitches in)
    tired.mound.left = Math.max(0, tired.mound.left);
    const a = firstPitch(fresh), b = firstPitch(tired);
    expect(b.pitch.speedMph).toBeLessThan(a.pitch.speedMph);
    expect(b.ring.time).toBeLessThan(a.ring.time);
  });

  it('a reliever has a small tank and the tank is never negative', () => {
    const e = make({ seed: 3 });
    const rp = e.staff.find((p) => p.role === 'RP');
    expect(rp).toBeTruthy();
    const max = staminaMax(rp, CONFIG);
    expect(max).toBeGreaterThanOrEqual(20);
    expect(max).toBeLessThanOrEqual(35);
    e.start();
    e.mound.left = 0.3;
    pitchOne(e);
    expect(e.mound.left).toBe(0);
  });

  it('stamina is saved and restored by resume', () => {
    const e1 = make({ seed: 31 });
    let last = null;
    e1.on('checkpoint', (st) => { last = st; });
    e1.start();
    for (let k = 0; k < 5; k++) pitchOne(e1, { type: 'fastball', aim: { x: 0.4, y: 2.2 }, errMs: 20 });
    const e2 = make({ seed: 31 });
    e2.resume(JSON.parse(JSON.stringify(last)));
    expect(e2.mound.left).toBe(e1.mound.left);
    expect(e2.mound.max).toBe(e1.mound.max);
    expect(e2.mound.left).toBeLessThan(e2.mound.max);
  });
});

describe('bullpen', () => {
  const rps = (e) => e.staff.filter((p) => p.role === 'RP');

  it('offers only unused relievers; a change keeps the count, resets the tank and says so', () => {
    const e = make({ seed: 5 });
    e.start();
    expect(e.bullpenOptions().map((o) => o.pitcher.id)).toEqual(rps(e).map((p) => p.id)); // (never a starter)
    e.game.balls = 2; e.game.strikes = 1;
    const seen = [];
    e.on('pitchingChange', (c) => seen.push(c));
    const starter = e.mound.pitcher, rp = rps(e)[0];
    e.mound.left = 5; e.mound.pitches = 80;
    expect(e.bullpen(rp.id)).toBe(true);
    expect(seen).toEqual([{ from: starter, to: rp }]);
    expect(e.count).toEqual({ balls: 2, strikes: 1 });
    expect(e.myPitcher).toBe(rp);
    expect(e.mound.left).toBe(staminaMax(rp, CONFIG));
    expect(e.mound.max).toBe(staminaMax(rp, CONFIG));
    expect(e.mound.pitches).toBe(0);
    expect(e.mound.used).toContain(starter.id);
    expect(e.phase).toBe('aim');
    expect(rp.pitches).toContain(e.pitchType); // (the selected pitch is one he throws)
  });

  it('a removed pitcher never comes back; starters and unknown ids are refused', () => {
    const e = make({ seed: 5 });
    e.start();
    const [a, b] = rps(e), starter = e.mound.pitcher;
    const other = e.staff.find((p) => p.role === 'SP' && p !== starter);
    expect(e.bullpen(other.id)).toBe(false);
    expect(e.bullpen('nobody')).toBe(false);
    expect(e.bullpen(a.id)).toBe(true);
    expect(e.bullpen(a.id)).toBe(false); // (he is on the mound)
    expect(e.bullpen(starter.id)).toBe(false);
    expect(e.bullpenOptions().map((o) => o.pitcher.id)).toEqual([b.id]);
    expect(e.bullpen(b.id)).toBe(true);
    expect(e.bullpen(a.id)).toBe(false); // (used)
    expect(e.bullpenOptions()).toEqual([]);
    expect(e.bullpen(starter.id)).toBe(false);
  });

  it('is refused in delivery, in the air, in a play and while simming', () => {
    const e = make({ seed: 6 });
    e.start();
    const rp = rps(e)[0];
    e.setPitchAim(0.4, 2.2);
    e.startDelivery();
    expect(e.bullpen(rp.id)).toBe(false);
    until(e, () => e.phase === 'pitch', 10);
    expect(e.bullpen(rp.id)).toBe(false);
    until(e, () => e.phase === 'aim' || e.phase === 'play' || e.phase === 'result', 20);
    if (e.phase !== 'aim') { expect(e.bullpen(rp.id)).toBe(false); until(e, () => e.phase === 'aim' || e.over, 30); }
    expect(e.mound.pitcher).toBe(e.staff[0]);
    const s = make({ seed: 6 });
    s.start();
    s.simHalf();
    expect(s.bullpen(rps(s)[0].id)).toBe(false);
  });

  it('is refused when you are batting', () => {
    const e = make({ seed: 6, mode: 'derby' });
    expect(e.bullpenOptions()).toEqual([]);
    expect(e.bullpen(rps(e)[0].id)).toBe(false);
  });

  it('Sim pulls a tired starter only for an unused reliever', () => {
    const e = make({ seed: 8 });
    e.start();
    const starter = e.mound.pitcher, [a, b] = rps(e);
    e.mound.left = 0.5; // (nearly spent)
    e.simHalf();
    const changes = [];
    e.on('pitchingChange', (c) => changes.push(c));
    for (let i = 0; i < 400 && e.simming && !e.over; i++) e.simStep(3);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0].from).toBe(starter);
    expect(changes[0].to).toBe(a);
    for (const c of changes) expect(c.to.role).toBe('RP');
    expect(new Set(changes.map((c) => c.to.id)).size).toBe(changes.length); // (nobody twice)
    expect(changes.length).toBeLessThanOrEqual(2);
    void b;
  });

  it('Sim with no reliever left keeps the tired pitcher on', () => {
    const e = make({ seed: 8 });
    e.start();
    e.mound.used = rps(e).map((p) => p.id);
    e.mound.left = 0.5;
    const starter = e.mound.pitcher;
    e.simHalf();
    for (let i = 0; i < 400 && e.simming && !e.over; i++) e.simStep(3);
    expect(e.mound.pitcher).toBe(starter);
  });

  it('who is on the mound and who was used survives a save', () => {
    const e1 = make({ seed: 12 });
    let last = null;
    e1.on('checkpoint', (st) => { last = st; });
    e1.start();
    const rp = rps(e1)[0], starter = e1.mound.pitcher;
    expect(e1.bullpen(rp.id)).toBe(true);
    const e2 = make({ seed: 12 });
    e2.resume(JSON.parse(JSON.stringify(last)));
    expect(e2.mound.pitcher.id).toBe(rp.id);
    expect(e2.mound.used).toEqual([starter.id]);
    expect(e2.bullpen(starter.id)).toBe(false);
    expect(e2.bullpenOptions().map((o) => o.pitcher.id)).not.toContain(rp.id);
  });
});
