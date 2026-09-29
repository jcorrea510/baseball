// Fielding + baserunning planner.
// Given a batted ball (its full simulated flight) and the defense, this decides - deterministically -
// who catches / fields it, whether throws beat runners, and how far every runner goes. It produces a
// "plan": a timeline (seconds after contact) the renderer simply plays back.
import { CONFIG } from '../config.js';
import { sampleBall, judgeFairFoul, battedBallType } from '../physics/ballistics.js';
import { BASE_XZ, polar, fenceDistance, sprayOf } from '../physics/field.js';

export const POSITIONS = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
const INFIELDERS = ['1B', '2B', 'SS', '3B'];
const STEP = 1 / 60;

export function fielderType(pos) {
  if (pos === 'LF' || pos === 'CF' || pos === 'RF') return 'OF';
  if (pos === 'P') return 'P';
  if (pos === 'C') return 'C';
  return 'IF';
}

// Build the defense. `rng` (optional) gives each fielder slightly different speed / reactions.
export function createDefense(cfg = CONFIG, rng = null) {
  const F = cfg.fielding;
  const out = {};
  const jit = (v, a) => (rng ? v * (1 + rng.range(-a, a)) : v);
  for (const pos of POSITIONS) {
    let x, z;
    if (F.outfield[pos]) {
      const p = polar(F.outfield[pos][0], F.outfield[pos][1]);
      x = p.x; z = p.z;
    } else {
      [x, z] = F.positions[pos];
    }
    const type = fielderType(pos);
    out[pos] = {
      pos, type,
      x, z, homeX: x, homeZ: z,
      speed: jit(F.speed[type], 0.06),
      react: jit(F.reaction[type], 0.12),
    };
  }
  return out;
}

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// How far a fielder can run in `tau` seconds after reacting: they accelerate, then hold top speed.
function covered(speed, tau, A) {
  if (tau <= 0) return 0;
  return speed * (tau - A * (1 - Math.exp(-tau / A)));
}
// Inverse: the time (after reacting) needed to cover `d` feet.
function timeToCover(speed, d, A) {
  if (d <= 0) return 0;
  let lo = 0, hi = d / speed + A + 0.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (covered(speed, mid, A) < d) lo = mid; else hi = mid;
  }
  return hi;
}

// Fielders run in easier than back: a ball hit over their head is harder to run down.
function effort(f, bx, bz) {
  const dBall = Math.hypot(bx, bz);
  const dF = Math.hypot(f.x, f.z);
  if (dBall > dF + 8) return 0.8;
  if (dBall < dF - 8) return 1.06;
  return 1;
}

function throwTime(d, f, cfg) {
  const F = cfg.fielding;
  const v = F.throwSpeed[f.type];
  let t = d / v;
  if (f.type === 'OF' && d > F.relayDistance) t += F.relayTransfer + 0.12; // cut-off man
  return t;
}

// ---------------------------------------------------------------------------
// Air catch: earliest moment any fielder can be under the ball while it is still catchable.
// ---------------------------------------------------------------------------
function findAirCatch(sim, defense, cfg) {
  const F = cfg.fielding;
  const tEnd = Math.min(sim.contactTime, sim.duration);
  for (let t = 0.3; t <= tEnd + 1e-6; t += STEP) {
    const b = sampleBall(sim, t);
    if (b.y > F.reachHeight || b.y < 0.5) continue;
    const spray = sprayOf(b.x, b.z);
    if (b.z < 0 && Math.abs(spray) <= 45 && Math.hypot(b.x, b.z) > fenceDistance(spray) - 0.5) continue; // over the wall
    let best = null;
    for (const pos of POSITIONS) {
      const f = defense[pos];
      const d = dist(f.x, f.z, b.x, b.z);
      const avail = covered(f.speed * effort(f, b.x, b.z), t - f.react, F.accel);
      const need = d - F.glove;
      if (need <= avail) {
        const slack = avail - need;
        if (!best || need < best.need) best = { f, need, dive: false, slack, ball: { ...b } };
      } else if (b.y <= 5.2 && need - F.diveExtra <= avail) {
        if (!best) best = { f, need, dive: true, slack: -1, ball: { ...b } };
      }
    }
    if (best) return { t, ...best };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ground pickup: the ball is low; find the first moment a fielder can reach it.
// ---------------------------------------------------------------------------
function findGroundPickup(sim, defense, cfg) {
  const F = cfg.fielding;
  const t0 = Math.max(0.25, sim.contactTime);
  const tEnd = sim.duration;
  let fallback = null;
  for (let t = t0; t <= tEnd + STEP; t += STEP) {
    const b = sampleBall(sim, t);
    if (b.y > F.groundHeight) continue;
    // The harder a ball is hit, the less time fielders have to react and the shorter their dive reach.
    const fast = Math.max(0, Math.min(1, (sim.params.exitVelocity - 68) / 34));
    const react = F.fastBallPenalty * fast;
    const glove = F.glove * (1 - 0.12 * fast);
    const diveX = F.diveExtra * (1 - 0.85 * fast);
    let best = null;
    for (const pos of POSITIONS) {
      if (pos === 'C' && sim.firstBounce && -sim.firstBounce.z > 20) continue; // catcher stays home on deep balls
      const f = defense[pos];
      const d = dist(f.x, f.z, b.x, b.z);
      const eff = f.speed * effort(f, b.x, b.z);
      const avail = covered(eff, t - f.react - react, F.accel);
      const need = d - glove;
      if (need <= avail) {
        const arrive = f.react + react + timeToCover(eff, Math.max(0, need), F.accel);
        if (!best || arrive < best.arrive) best = { f, need, dive: false, arrive, ball: { ...b } };
      } else if (need - diveX <= avail) {
        if (!best) best = { f, need, dive: true, arrive: t, ball: { ...b } };
      }
    }
    if (best) return { t, ...best };
    fallback = t;
  }
  // Ball came to rest (or hit the wall and stopped): the nearest fielder runs it down.
  const b = sampleBall(sim, tEnd);
  let best = null;
  for (const pos of POSITIONS) {
    if (pos === 'C' || pos === 'P') continue;
    const f = defense[pos];
    const need = Math.max(0, dist(f.x, f.z, b.x, b.z));
    const arrive = f.react + need / f.speed;
    if (!best || arrive < best.arrive) best = { f, need, dive: false, arrive, ball: { ...b } };
  }
  const t = Math.max(fallback ?? tEnd, best.arrive);
  return { t, ...best, ball: { ...b } };
}

// ---------------------------------------------------------------------------
// Helpers to build timeline pieces
// ---------------------------------------------------------------------------
function fielderMove(f, toX, toZ, tArrive, dive = false) {
  // constant speed from reaction time to arrival; never faster than needed
  const t0 = Math.min(f.react, Math.max(0, tArrive - 0.05));
  return { pos: f.pos, keys: [{ t: 0, x: f.x, z: f.z }, { t: t0, x: f.x, z: f.z }, { t: tArrive, x: toX, z: toZ }], dive };
}

function runnerPathTimes(fromBase, toBase, startDelay, cfg, isBatter = false) {
  // Returns array of {base, t} arrival times at each base passed.
  const R = cfg.runner;
  const per = cfg.field.baseDistance / R.speed;
  const out = [];
  for (let b = fromBase + 1; b <= toBase; b++) {
    let t;
    if (isBatter) t = R.timeToFirst + (b - 1) * per;
    else t = startDelay + (b - fromBase) * per;
    out.push({ base: b, t });
  }
  return out;
}

const baseDist = (f, base) => dist(f.x, f.z, BASE_XZ[base][0], BASE_XZ[base][1]);

function coverer(base, fielder, defense) {
  if (base === 4 || base === 0) return defense.C;
  if (base === 1) return fielder.pos === '1B' ? defense.P : defense['1B'];
  if (base === 3) return fielder.pos === '3B' ? defense.SS : defense['3B'];
  // second base: the middle infielder on the far side of the play
  const pick = fielder.x < 0 ? defense['2B'] : defense.SS;
  return pick.pos === fielder.pos ? (pick.pos === 'SS' ? defense['2B'] : defense.SS) : pick;
}

// ---------------------------------------------------------------------------
// The main entry point.
// ---------------------------------------------------------------------------
/**
 * @param {object} i
 * @param {object} i.sim       simulateBattedBall() result
 * @param {object} i.contact   computeContact() result (exit velocity etc.)
 * @param {Array}  i.bases     [runnerOn1st, runnerOn2nd, runnerOn3rd] (truthy = occupied)
 * @param {number} i.outs
 * @param {object} i.defense   createDefense()
 * @param {boolean} [i.simple] derby / practice: no baserunning, stop after the ball is fielded
 */
export function planPlay(i, cfg = CONFIG) {
  const { sim, contact, defense } = i;
  const bases = i.bases || [null, null, null];
  const outs = i.outs || 0;
  const F = cfg.fielding;
  const R = cfg.runner;
  const type = battedBallType(contact.launchAngle);
  const fair = judgeFairFoul(sim);
  const plan = {
    fair, type,
    result: null, batterDest: 0, moves: [], outsMade: 0,
    fielderMoves: [], throws: [], carries: [], events: [],
    ballHitEnd: sim.duration, endTime: 0, homer: false,
    fielder: null, notes: [],
    ballLandDistance: 0,
  };

  const firstBounce = sim.firstBounce;
  plan.ballLandDistance = firstBounce ? Math.hypot(firstBounce.x, firstBounce.z) : 0;

  // ---------------- home run ----------------
  if (sim.homerun && fair) {
    plan.homer = true;
    plan.result = 'homer';
    plan.batterDest = 4;
    plan.ballHitEnd = sim.standsLanding ? sim.standsLanding.t : sim.duration;
    // nearest outfielder drifts to the wall and watches it go
    const end = sim.homerun;
    let best = null;
    for (const pos of ['LF', 'CF', 'RF']) {
      const f = defense[pos];
      const d = dist(f.x, f.z, end.x, end.z);
      if (!best || d < best.d) best = { f, d };
    }
    const wallD = Math.hypot(end.x, end.z) - 2.5;
    const sp = sprayOf(end.x, end.z);
    const wx = Math.sin((sp * Math.PI) / 180) * wallD, wz = -Math.cos((sp * Math.PI) / 180) * wallD;
    const tArr = Math.min(sim.homerun.t, best.f.react + Math.hypot(best.f.x - wx, best.f.z - wz) / best.f.speed);
    plan.fielderMoves.push({ pos: best.f.pos, keys: [{ t: 0, x: best.f.x, z: best.f.z }, { t: best.f.react, x: best.f.x, z: best.f.z }, { t: tArr, x: wx, z: wz }], dive: false, watch: true });
    plan.fielder = best.f.pos;
    // everyone circles the bases (trot)
    for (let b = 0; b < 3; b++) if (bases[b]) plan.moves.push({ from: b + 1, to: 4, out: false });
    plan.moves.push({ from: 0, to: 4, out: false });
    plan.endTime = plan.ballHitEnd + 1.6;
    plan.trot = true;
    return plan;
  }

  // ---------------- caught in the air ----------------
  const air = findAirCatch(sim, defense, cfg);
  if (air) {
    const f = air.f;
    plan.fielder = f.pos;
    plan.caught = true;
    plan.catchT = air.t;
    plan.catchPos = { x: air.ball.x, y: air.ball.y, z: air.ball.z };
    plan.fielderMoves.push(fielderMove(f, air.ball.x, air.ball.z, air.t, air.dive));
    plan.ballHitEnd = air.t;
    plan.carries.push({ pos: f.pos, t0: air.t, t1: air.t + 99 });
    plan.events.push({ t: air.t, type: 'catch', pos: f.pos });
    if (!fair) {
      plan.result = 'foulOut';
      plan.outsMade = 1;
      plan.batterDest = 0;
      plan.endTime = air.t + 0.9;
      plan.notes.push('foul ball caught by ' + f.pos);
      return plan;
    }
    plan.result = sim.apex.y <= 24 ? 'lineout' : (type === 'pop' || sim.apex.y >= 75) && Math.hypot(air.ball.x, air.ball.z) < 150 ? 'popout' : 'flyout';
    plan.outsMade = 1;
    plan.batterDest = 0;
    plan.endTime = air.t + 0.9;
    if (i.simple) return plan;
    // Tag-ups on a caught fly ball (not on line drives)
    if (type !== 'line' && outs + 1 < 3) {
      const depth = Math.hypot(air.ball.x, air.ball.z);
      const tCatch = air.t;
      const home = BASE_XZ[4];
      const throwHome = tCatch + F.transfer[f.type] + throwTime(dist(air.ball.x, air.ball.z, home[0], home[1]), f, cfg) + F.tagTime;
      // runner on 3rd
      if (bases[2] && depth > 170) {
        const arrive = tCatch + 0.15 + cfg.field.baseDistance / R.speed;
        if (arrive < throwHome - F.runnerMargin) {
          plan.moves.push({ from: 3, to: 4, out: false, tStart: tCatch + 0.15, tag: true });
          plan.result = 'sacFly';
          plan.endTime = Math.max(plan.endTime, arrive + 0.4);
          plan.events.push({ t: throwHome, type: 'throwLate' });
          // the throw home (late)
          const c = defense.C;
          plan.throws.push({ from: f.pos, to: 'C', t0: tCatch + F.transfer[f.type], t1: throwHome, ax: air.ball.x, az: air.ball.z, bx: home[0], bz: home[1], toBase: 4 });
        }
      }
      // runner on 2nd goes to 3rd on a deep fly
      if (bases[1] && depth > 250 && !(bases[2] && plan.moves.every((m) => m.from !== 3))) {
        const d3 = dist(air.ball.x, air.ball.z, BASE_XZ[3][0], BASE_XZ[3][1]);
        const throw3 = tCatch + F.transfer[f.type] + throwTime(d3, f, cfg);
        const arrive = tCatch + 0.15 + cfg.field.baseDistance / R.speed;
        if (arrive < throw3 - F.runnerMargin - 0.25) plan.moves.push({ from: 2, to: 3, out: false, tStart: tCatch + 0.15, tag: true });
      }
    }
    return plan;
  }

  // ---------------- foul ball (uncaught) ----------------
  if (!fair) {
    plan.result = 'foul';
    plan.batterDest = 0;
    plan.ballHitEnd = Math.min(sim.contactTime + 0.5, sim.duration);
    plan.endTime = plan.ballHitEnd + 0.35;
    return plan;
  }

  // ---------------- fair ball on the ground / bouncing / off the wall ----------------
  const pick = findGroundPickup(sim, defense, cfg);
  const f = pick.f;
  const tF = pick.t;
  const pf = pick.ball;
  plan.fielder = f.pos;
  plan.pickupT = tF;
  plan.pickupPos = { x: pf.x, z: pf.z };
  plan.ballHitEnd = tF;
  plan.fielderMoves.push(fielderMove(f, pf.x, pf.z, tF, pick.dive));
  plan.events.push({ t: tF, type: 'field', pos: f.pos });
  const tr = F.transfer[f.type];
  const tReady = tF + tr;
  plan.carries.push({ pos: f.pos, t0: tF, t1: tReady });

  if (i.simple) {
    // Derby / practice: report the play type from where it landed; no baserunning.
    plan.result = 'hitSimple';
    plan.batterDest = 1;
    plan.endTime = tF + 0.7;
    return plan;
  }

  const runners = [];
  for (let b = 1; b <= 3; b++) if (bases[b - 1]) runners.push(b);
  const forced = new Set();
  if (bases[0]) { forced.add(1); if (bases[1]) { forced.add(2); if (bases[2]) forced.add(3); } }

  const isInfieldPlay = f.type !== 'OF' || Math.hypot(pf.x, pf.z) < 150;
  const groundBall = pick.ball.y < 2 && (type === 'ground' || sim.bounces > 0 || type === 'line' || type === 'fly');

  // --- Try to record an out on an infield play ---
  if (isInfieldPlay && groundBall) {
    const attempt = tryInfieldOut({ f, tF, tReady, pf, bases, forced, outs, defense, cfg, plan });
    if (attempt) return finishInfieldOut(plan, attempt, { f, tF, tReady, pf, bases, forced, outs, defense, cfg });
  }

  // --- Otherwise it is a hit. Work out how far everyone goes. ---
  return finishHit(plan, { f, tF, tReady, pf, bases, forced, outs, defense, cfg });
}

// ---------------------------------------------------------------------------
function throwArrival(f, tReady, base, fx, fz, cfg) {
  const d = dist(fx, fz, BASE_XZ[base][0], BASE_XZ[base][1]);
  return { t: tReady + throwTime(d, f, cfg) + (base === 4 ? cfg.fielding.tagTime : 0), d };
}

function tryInfieldOut({ f, tF, tReady, pf, bases, forced, outs, defense, cfg }) {
  const F = cfg.fielding;
  const R = cfg.runner;
  const per = cfg.field.baseDistance / R.speed;
  const batterTo1 = R.timeToFirst;
  const options = [];

  // Force play on the lead forced runner (only if fewer than 2 outs makes a double play worth it, or as the sure out)
  let leadForced = 0;
  for (const b of forced) leadForced = Math.max(leadForced, b);
  if (leadForced > 0) {
    const targetBase = leadForced + 1; // runner from `leadForced` heads to the next base
    const runnerArr = R.startDelay + per;
    const th = throwArrival(f, tReady, targetBase > 3 ? 4 : targetBase, pf.x, pf.z, cfg);
    if (th.t + F.outMargin <= runnerArr) options.push({ kind: 'force', base: targetBase > 3 ? 4 : targetBase, t: th.t, margin: runnerArr - th.t, d: th.d });
  }
  // Batter at first
  const th1 = throwArrival(f, tReady, 1, pf.x, pf.z, cfg);
  if (th1.t + F.outMargin <= batterTo1) options.push({ kind: 'first', base: 1, t: th1.t, margin: batterTo1 - th1.t, d: th1.d });

  if (!options.length) return null;
  // With < 2 outs and a force available, prefer the force (starts a double play); else the surest out.
  let choice;
  const force = options.find((o) => o.kind === 'force');
  const first = options.find((o) => o.kind === 'first');
  if (force && outs < 2) choice = force;
  else choice = options.sort((a, b) => b.margin - a.margin)[0];
  return { choice, force, first, leadForced };
}

function finishInfieldOut(plan, at, ctx) {
  const { f, tF, tReady, pf, bases, forced, outs, defense, cfg } = ctx;
  const F = cfg.fielding;
  const R = cfg.runner;
  const per = cfg.field.baseDistance / R.speed;
  const { choice, leadForced } = at;

  const coverFor = (base) => coverer(base, f, defense);
  const recv = coverFor(choice.base);
  const rp = { x: BASE_XZ[choice.base][0], z: BASE_XZ[choice.base][1] };
  // Receiving fielder covers the bag
  plan.fielderMoves.push(fielderMove(recv, rp.x, rp.z, Math.max(recv.react + 0.2, choice.t - 0.25)));
  plan.throws.push({ from: f.pos, to: recv.pos, t0: tReady, t1: choice.t, ax: pf.x, az: pf.z, bx: rp.x, bz: rp.z, toBase: choice.base });
  plan.events.push({ t: choice.t, type: 'out', base: choice.base, pos: recv.pos });
  plan.carries.push({ pos: recv.pos, t0: choice.t, t1: choice.t + 99 });
  plan.outsMade = 1;
  let endT = choice.t;

  if (choice.kind === 'first') {
    // batter out at first; runners advance if they can
    plan.moves.push({ from: 0, to: 0, out: true, outAt: choice.t, outBase: 1 });
    plan.result = 'groundout';
    plan.batterDest = 0;
    plan.moves.push(...advanceOnGroundout({ bases, forced, outsAfter: outs + 1, f, pf, tReady, cfg }));
  } else {
    // force out at `choice.base`: the runner from base-1 is out
    const outFrom = choice.base === 4 ? 3 : choice.base - 1;
    plan.moves.push({ from: outFrom, to: 0, out: true, outAt: choice.t, outBase: choice.base });
    // other runners: forced ones advance one base; free ones may take an extra base
    const skip = new Set([outFrom]);
    // (computed after we know whether a second out is made; provisional with one out)
    plan._pendingRunners = { skip };
    // Try for the second out (double play): relay to first
    const secondOutPossible = outs + 1 < 3;
    plan.batterDest = 1;
    plan.moves.push({ from: 0, to: 1, out: false });
    plan.result = 'fieldersChoice';
    if (secondOutPossible) {
      const tRelay = choice.t + F.transfer.IF * 0.85;
      const d = dist(rp.x, rp.z, BASE_XZ[1][0], BASE_XZ[1][1]);
      const t2 = tRelay + d / F.throwSpeed.IF;
      const first = defense['1B'].pos === recv.pos ? defense.P : defense['1B'];
      const arrival = R.timeToFirst;
      if (t2 + F.outMargin <= arrival && first.pos !== recv.pos && recv.pos !== '1B') {
        plan.fielderMoves.push(fielderMove(first, BASE_XZ[1][0], BASE_XZ[1][1] + 0.5, Math.max(first.react + 0.2, t2 - 0.3)));
        plan.throws.push({ from: recv.pos, to: first.pos, t0: tRelay, t1: t2, ax: rp.x, az: rp.z, bx: BASE_XZ[1][0], bz: BASE_XZ[1][1], toBase: 1 });
        plan.events.push({ t: t2, type: 'out', base: 1, pos: first.pos });
        plan.carries.push({ pos: first.pos, t0: t2, t1: t2 + 99 });
        // batter is out
        const bm = plan.moves.find((m) => m.from === 0);
        bm.to = 0; bm.out = true; bm.outAt = t2; bm.outBase = 1;
        plan.batterDest = 0;
        plan.outsMade = 2;
        plan.result = 'doublePlay';
        endT = t2;
      }
    }
  }
  if (plan._pendingRunners) {
    const outsAfter = outs + plan.outsMade;
    plan.moves.push(...advanceOnGroundout({ bases, forced, outsAfter, f, pf, tReady, cfg, skip: plan._pendingRunners.skip }));
    delete plan._pendingRunners;
  }
  plan.endTime = endT + 0.8;
  void leadForced;
  return plan;
}

function advanceOnGroundout({ bases, forced, outsAfter, f, pf, tReady, cfg, skip }) {
  // Runners move up on a routine groundout when there is room and fewer than two outs.
  const moves = [];
  const R = cfg.runner;
  const per = cfg.field.baseDistance / R.speed;
  const F = cfg.fielding;
  const canAdvance = outsAfter < 3;
  const occupied = { 1: !!bases[0], 2: !!bases[1], 3: !!bases[2] };
  const dest = {};
  for (const b of [3, 2, 1]) {
    if (!occupied[b] || (skip && skip.has(b))) continue;
    let d = b;
    if (forced.has(b)) d = b + 1;
    else if (canAdvance) {
      if (b === 3) {
        const defenseHome = tReady + throwTime(dist(pf.x, pf.z, 0, 0), f, cfg) + F.tagTime;
        if (R.startDelay + per + F.runnerMargin < defenseHome) d = 4;
      } else if (b === 2 && f.x > 0 && (dest[3] === 4 || !occupied[3])) d = 3;
    }
    dest[b] = d;
  }
  for (const b of [3, 2, 1]) if (dest[b] !== undefined) moves.push({ from: b, to: dest[b], out: false });
  return moves;
}

// ---------------------------------------------------------------------------
function finishHit(plan, ctx) {
  const { f, tF, tReady, pf, bases, forced, outs, defense, cfg } = ctx;
  const F = cfg.fielding;
  const R = cfg.runner;
  const per = cfg.field.baseDistance / R.speed;

  // Defense arrival time at each base if the fielder throws there.
  const D = {};
  for (let b = 1; b <= 4; b++) D[b] = throwArrival(f, tReady, b, pf.x, pf.z, cfg).t;

  // Existing runners: process from the lead runner back so nobody passes anybody.
  const dests = {}; // from -> to
  const order = [3, 2, 1].filter((b) => bases[b - 1]);
  let ceiling = 5; // lowest occupied destination base ahead (exclusive); 5 = none
  for (const b of order) {
    let target = b;
    if (forced.has(b)) target = b + 1;
    for (let m = 4; m > target; m--) {
      const arrive = R.startDelay + (m - b) * per;
      if (arrive + F.runnerMargin < D[m]) { target = m; break; }
    }
    if (target < 4 && target >= ceiling) target = Math.max(b, ceiling - 1);
    if (target <= b && forced.has(b)) target = b + 1;
    dests[b] = target;
    if (target < 4) ceiling = Math.min(ceiling, target);
  }
  // Batter
  let bd = 0;
  for (let m = 4; m >= 1; m--) {
    const arrive = R.timeToFirst + (m - 1) * per;
    if (arrive + F.runnerMargin < D[m]) { bd = m; break; }
  }
  if (bd === 0) bd = 1; // an infield hit / safe on a close play (we only reach here when no out could be made)
  if (bd < 4 && bd >= ceiling) bd = Math.max(1, ceiling - 1);
  // Batter cannot be on the same base as a trailing runner's destination handled by ceiling.
  plan.batterDest = bd;

  for (const b of order) plan.moves.push({ from: b, to: dests[b], out: false });
  plan.moves.push({ from: 0, to: bd, out: false });

  plan.result = bd === 4 ? 'insideParkHomer' : bd === 3 ? 'triple' : bd === 2 ? 'double' : 'single';
  plan.infieldHit = plan.result === 'single' && f.type !== 'OF';

  // Ball movement after the pickup: throw toward where the lead runner is heading.
  let leadDest = bd;
  for (const b of order) leadDest = Math.max(leadDest, dests[b]);
  plan.leadDest = leadDest;
  const tgtBase = Math.min(4, leadDest >= 4 ? 4 : leadDest + 0); // throw to the base the lead runner reaches
  const relayNeeded = f.type === 'OF' && dist(pf.x, pf.z, BASE_XZ[tgtBase][0], BASE_XZ[tgtBase][1]) > F.relayDistance;
  const recv = coverer(tgtBase, f, defense);
  const rp = { x: BASE_XZ[tgtBase][0], z: BASE_XZ[tgtBase][1] };
  if (relayNeeded) {
    // cut-off man: nearest infielder standing 55% of the way back from the base
    const cx = rp.x + (pf.x - rp.x) * 0.5, cz = rp.z + (pf.z - rp.z) * 0.5;
    let cut = null;
    for (const pos of ['SS', '2B', '3B', '1B']) {
      if (pos === recv.pos) continue;
      const q = defense[pos];
      const d = dist(q.x, q.z, cx, cz);
      if (!cut || d < cut.d) cut = { q, d };
    }
    const c = cut.q;
    const t1 = tReady + dist(pf.x, pf.z, cx, cz) / F.throwSpeed.OF;
    const t2 = t1 + F.relayTransfer;
    const t3 = t2 + dist(cx, cz, rp.x, rp.z) / F.throwSpeed.IF;
    plan.fielderMoves.push(fielderMove(c, cx, cz, Math.max(c.react + 0.3, t1 - 0.4)));
    plan.fielderMoves.push(fielderMove(recv, rp.x, rp.z, Math.max(recv.react + 0.3, t3 - 0.3)));
    plan.throws.push({ from: f.pos, to: c.pos, t0: tReady, t1, ax: pf.x, az: pf.z, bx: cx, bz: cz, toBase: 0 });
    plan.throws.push({ from: c.pos, to: recv.pos, t0: t2, t1: t3, ax: cx, az: cz, bx: rp.x, bz: rp.z, toBase: tgtBase });
    plan.carries.push({ pos: c.pos, t0: t1, t1: t2 });
    plan.carries.push({ pos: recv.pos, t0: t3, t1: t3 + 99 });
    plan.events.push({ t: t3, type: 'throwEnd', pos: recv.pos, base: tgtBase });
    plan.ballEnd = t3;
  } else {
    const t1 = tReady + dist(pf.x, pf.z, rp.x, rp.z) / F.throwSpeed[f.type];
    plan.fielderMoves.push(fielderMove(recv, rp.x, rp.z, Math.max(recv.react + 0.3, t1 - 0.3)));
    plan.throws.push({ from: f.pos, to: recv.pos, t0: tReady, t1, ax: pf.x, az: pf.z, bx: rp.x, bz: rp.z, toBase: tgtBase });
    plan.carries.push({ pos: recv.pos, t0: t1, t1: t1 + 99 });
    plan.events.push({ t: t1, type: 'throwEnd', pos: recv.pos, base: tgtBase });
    plan.ballEnd = t1;
  }

  // The play ends when every runner has stopped and the throw is in.
  let last = plan.ballEnd;
  for (const m of plan.moves) {
    if (m.from === 0) last = Math.max(last, R.timeToFirst + (m.to - 1) * per);
    else last = Math.max(last, R.startDelay + (m.to - m.from) * per);
  }
  plan.endTime = last + 0.35;
  void outs; void tF;
  return plan;
}

// ---------------------------------------------------------------------------
// Runner timeline helper for the renderer: where is a runner at time t?
// move = { from, to, out, outAt, tStart } . Returns { x, z, base progress, running }
// ---------------------------------------------------------------------------
export function runnerPosition(move, t, cfg = CONFIG) {
  const R = cfg.runner;
  const per = cfg.field.baseDistance / R.speed;
  const isBatter = move.from === 0;
  let t0, speed = R.speed;
  const fromBase = isBatter ? 0 : move.from;
  const toBase = move.out && move.to === 0 ? (move.outBase === 4 ? 4 : move.outBase) : move.to;
  if (isBatter) {
    // The batter takes R.timeToFirst to reach first: leaves the box after a short delay.
    t0 = R.timeToFirst - per;
    speed = R.speed;
  } else t0 = move.tStart ?? R.startDelay;
  if (move.trot) speed = R.trotSpeed;
  const dist0 = isBatter ? -0 : 0;
  void dist0;
  const totalBases = Math.max(0, toBase - fromBase);
  const total = totalBases * cfg.field.baseDistance;
  const elapsed = Math.max(0, t - t0);
  let d = Math.min(total, elapsed * speed);
  return { ...pathPoint(fromBase, d), running: d > 0 && d < total, done: d >= total, speed: d > 0 && d < total ? speed : 0, distance: d, total };
}

// Position at `d` feet along the base path starting at base `fromBase` (0 = home plate).
export function pathPoint(fromBase, d) {
  let base = fromBase;
  let rem = d;
  const len = CONFIG.field.baseDistance;
  while (rem > len && base < 4) { rem -= len; base++; }
  const a = BASE_XZ[base % 4 === 0 && base > 0 ? 4 : base];
  const nb = Math.min(4, base + 1);
  const b = BASE_XZ[nb];
  const u = base >= 4 ? 0 : Math.min(1, rem / len);
  return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, base, u, dir: [b[0] - a[0], b[1] - a[1]] };
}
