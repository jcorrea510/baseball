// Fielding + baserunning planner.
// Given a batted ball (its full simulated flight) and the defense, this decides - deterministically -
// who catches / fields it, whether throws beat runners, and how far every runner goes. It produces a
// "plan": a timeline (seconds after contact) the renderer simply plays back.
import { CONFIG } from '../config.js';
import { sampleBall, judgeFairFoul, battedBallType } from '../physics/ballistics.js';
import { BASE_XZ, polar, fenceDistance, sprayOf, clampToField, distanceToWall, isInsideField } from '../physics/field.js';
import { runnerArrival, runnerFinish, runnerState, runnerProfile, retreatArrival, moveArrival, moveFinish, legProfile, sameUntil } from './runnerMotion.js';
import { planRun, planDiveRun, sampleRun, samplePath, covered, timeToCover, moverReturnTime, TAIL_MAX } from './fielderMotion.js';

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

// (covered / timeToCover - the movement model - live in fielderMotion.js so the planner and the renderer share them)

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
  const STEP = 1 / 240; // (a fast ball is only within a fielder's reach for a moment: look at it finely so a real chance is never stepped over)
  const tEnd = Math.min(sim.contactTime, sim.duration);
  // Could this fielder be under the ball at time t? (a fielder who has to dive counts only if nobody can get there running)
  const catchableBall = (b) => {
    if (b.y > F.reachHeight || b.y < 0.5) return false;
    const spray = sprayOf(b.x, b.z);
    if (b.z < 0 && Math.abs(spray) <= 45 && Math.hypot(b.x, b.z) > fenceDistance(spray) - 0.5) return false; // over the wall
    return isInsideField(b.x, b.z, -0.5); // (a foul ball over a foul-territory wall or the backstop)
  };
  const tryFielder = (f, b, t) => {
    const d = dist(f.x, f.z, b.x, b.z);
    const avail = covered(f.speed * effort(f, b.x, b.z), t - f.react, F.accel);
    const need = d - F.glove;
    if (need <= avail) return { f, need, dive: false, slack: avail - need, avail, ball: { ...b } };
    if (b.y <= 5.2 && need - F.diveExtra <= avail) return { f, need, dive: true, slack: -1, avail, ball: { ...b } };
    return null;
  };
  const candidate = (t) => {
    const b = sampleBall(sim, t);
    if (!catchableBall(b)) return null;
    let best = null;
    for (const pos of POSITIONS) {
      const c = tryFielder(defense[pos], b, t);
      if (!c) continue;
      if (!c.dive) { if (!best || best.dive || c.need < best.need) best = c; }
      else if (!best) best = c;
    }
    return best;
  };
  let hit = null;
  for (let t = 0.3; t <= tEnd + 1e-6 && !hit; t += STEP) {
    const best = candidate(t);
    if (!best) continue;
    hit = { t, ...best };
    if (best.dive) {
      // nobody dives for a ball a fielder can simply run under a moment later
      for (let t2 = t + STEP; t2 <= Math.min(t + F.dive.preferRun, tEnd) + 1e-6; t2 += STEP) {
        const alt = candidate(t2);
        if (alt && !alt.dive) { hit = { t: t2, ...alt }; break; }
      }
    }
  }
  if (!hit) return null;
  // The first moment he CAN reach the ball is often when it is still far above his head (8-9 ft up). A fielder who is there in time waits
  // for it to come down to a comfortable height; if he cannot wait (it is about to hit the wall, or he is only just there) he takes it
  // at the lowest height he still can - and if that is above his standing reach he jumps for it.
  if (!hit.dive && hit.ball.y > F.catchHeight) {
    let lowest = hit;
    for (let t2 = hit.t + STEP; t2 <= tEnd + 1e-6; t2 += STEP) {
      const b = sampleBall(sim, t2);
      const c = catchableBall(b) ? tryFielder(hit.f, b, t2) : null;
      if (!c || c.dive) break; // he has lost it
      lowest = { t: t2, ...c };
      if (b.y <= F.catchHeight) break; // it has come down to a comfortable height
    }
    hit = lowest;
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Ground pickup: the ball is low; find the first moment a fielder can reach it.
// ---------------------------------------------------------------------------
function findGroundPickup(sim, defense, cfg) {
  const F = cfg.fielding;
  const t0 = Math.max(0.25, sim.contactTime);
  const tEnd = sim.duration;
  let fallback = null;
  // The harder a ball is hit, the less time fielders have to react and the shorter their dive reach.
  const fast = Math.max(0, Math.min(1, (sim.params.exitVelocity - 68) / 34));
  const react = F.fastBallPenalty * fast;
  const glove = F.glove * (1 - 0.12 * fast);
  const diveX = F.diveExtra * (1 - 0.85 * fast);
  const candidate = (t) => {
    const b = sampleBall(sim, t);
    if (b.y > F.groundHeight) return null;
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
        if (!best || arrive < best.arrive) best = { f, need, dive: false, arrive, avail, start: f.react + react, ball: { ...b } };
      } else if (need - diveX <= avail) {
        if (!best) best = { f, need, dive: true, arrive: t, avail, start: f.react + react, ball: { ...b } };
      }
    }
    return best;
  };
  for (let t = t0; t <= tEnd + STEP; t += STEP) {
    const best = candidate(t);
    if (best) {
      if (best.dive) {
        // nobody dives for a ball a fielder can simply run to a moment later
        for (let t2 = t + STEP; t2 <= Math.min(t + F.dive.preferRun, tEnd + STEP) + 1e-6; t2 += STEP) {
          const alt = candidate(t2);
          if (alt && !alt.dive) return { t: t2, ...alt };
        }
      }
      return { t, ...best };
    }
    if (sampleBall(sim, t).y <= F.groundHeight) fallback = t;
  }
  // Ball came to rest (or hit the wall and stopped): the nearest fielder runs it down.
  const b = sampleBall(sim, tEnd);
  let best = null;
  for (const pos of POSITIONS) {
    if (pos === 'C' || pos === 'P') continue;
    const f = defense[pos];
    const need = Math.max(0, dist(f.x, f.z, b.x, b.z));
    // same movement model as everywhere else (acceleration, and slower when running back), so the fielder really gets there
    const arrive = f.react + timeToCover(f.speed * effort(f, b.x, b.z), need, F.accel);
    if (!best || arrive < best.arrive) best = { f, need, dive: false, arrive, start: f.react, avail: need, ball: { ...b } };
  }
  const t = Math.max(fallback ?? tEnd, best.arrive);
  return { t, ...best, ball: { ...b } };
}

// ---------------------------------------------------------------------------
// Helpers to build timeline pieces
// ---------------------------------------------------------------------------
// Give a fielder a run to (toX, toZ) that must be finished by `tArrive`. The run is a smooth profile (see fielderMotion.js):
// he reacts, accelerates, runs and brakes. A fielder can have several jobs in one play (field the ball, then cover a base);
// each new run starts where the previous one came to rest.
//   opts.avail  how far (ft) he can really cover by tArrive - if the target is farther he stops that much short (glove reach)
//   opts.start  when he begins moving (defaults to his reaction time)
//   opts.vmax   top speed override;  opts.dive / opts.watch / opts.role are labels for the renderer
// Cut a planned run short at time t: he is wherever the run had got him, and from there the next run takes over.
function cutRun(run, t) {
  const q = sampleRun(run, t, {});
  run.segs = run.segs.filter((g) => g.t0 < t);
  run.segs.push({ name: 'rest', t0: t, s0: q.s, v0: 0, a: 0 });
  run.tStop = t; run.sStop = q.s; run.xStop = q.x; run.zStop = q.z;
  if (run.tReach > t) run.tReach = t;
}
// Where a fielder would be at time t if his last run were cut short there (see cutRun).
function cutPoint(run, t) {
  if (!run || run.dive || t >= run.tStop) return null;
  const q = sampleRun(run, Math.max(t, run.tStart), {});
  return { x: q.x, z: q.z };
}

function addMove(plan, f, toX, toZ, tArrive, opts = {}, cfg = CONFIG) {
  const F = cfg.fielding;
  // nobody ever runs to a spot in or beyond the wall: the target is pulled back inside (his glove still reaches the ball)
  [toX, toZ] = clampToField(toX, toZ, F.wallMargin);
  const runs = (plan.paths[f.pos] = plan.paths[f.pos] || []);
  const prev = runs[runs.length - 1];
  // `cut`: he heads off from wherever the last run has got him at `start` (the last run is cut short there) instead of
  // first coming to a full stop - a fielder who has the ball turns for the bag at once
  if (opts.cut && prev && opts.start !== undefined && opts.start < prev.tStop && !prev.dive) cutRun(prev, opts.start);
  const x0 = prev ? prev.xStop : f.x, z0 = prev ? prev.zStop : f.z;
  const vmax = opts.vmax ?? f.speed * effort(f, toX, toZ);
  let tStart = opts.start ?? f.react;
  if (prev) tStart = Math.max(tStart, prev.tStop);
  tStart = Math.min(tStart, Math.max(0, tArrive - 0.05));
  let x1 = toX, z1 = toZ;
  if (opts.avail !== undefined) {
    // stop short by however far he cannot reach (never more than his glove + dive reach)
    const d = dist(x0, z0, toX, toZ);
    const short = Math.min(Math.max(0, d - opts.avail) + (opts.dive ? 0 : 0.15), F.glove + (opts.dive ? F.diveExtra : 0));
    if (d > 0.01 && short > 0) { x1 = toX - ((toX - x0) / d) * Math.min(short, d); z1 = toZ - ((toZ - z0) / d) * Math.min(short, d); }
  }
  // A dive: sprint straight at the ball, launch shortly before the glove meets it, land, slide, get up. (If the sprint alone
  // already gets him there, planDiveRun says no dive is needed and he simply runs.)
  // how far can he go along this run before the wall? (he brakes in time to stop in front of it)
  const wallLimit = (ax, az, bx, bz, atLeast) => {
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 1e-6) return undefined;
    const w = distanceToWall(ax, az, (bx - ax) / d, (bz - az) / d, F.wallBody);
    return Number.isFinite(w) ? Math.max(w, atLeast) : undefined;
  };
  [x1, z1] = clampToField(x1, z1, F.wallMargin);
  let run = opts.dive
    ? planDiveRun({ x0, z0, px: toX, pz: toZ, tStart, tCatch: tArrive, vmax, accel: vmax / F.accel, brake: F.brake, dive: F.dive, limitS: wallLimit(x0, z0, toX, toZ, dist(x0, z0, toX, toZ) - F.dive.armReach + 0.5) })
    : null;
  if (!run) run = planRun({ x0, z0, x1, z1, tStart, tArrive: Math.max(tArrive, tStart + 0.05), vmax, accel: vmax / (opts.accelTime ?? F.accel), brake: F.brake, minEffort: opts.minEffort ?? F.minRunEffort, heading: Math.atan2(toX - x0, toZ - z0), limitS: wallLimit(x0, z0, x1, z1, dist(x0, z0, x1, z1) + 0.4), wallBrake: F.wallBrake });
  runs.push(run);
  const move = {
    pos: f.pos,
    keys: [{ t: 0, x: x0, z: z0 }, { t: tStart, x: x0, z: z0 }, { t: tArrive, x: toX, z: toZ }],
    run, dive: !!run.dive, watch: !!opts.watch, role: opts.role || 'field',
  };
  if (run.dive) {
    // highlight moments for the game feel: the launch and the touchdown
    const land = sampleRun(run, run.dive.tLand);
    plan.events.push({ t: run.dive.tL, type: 'dive', pos: f.pos, catch: (opts.role || 'field') === 'catch' });
    plan.events.push({ t: run.dive.tLand, type: 'diveLand', pos: f.pos, x: land.x, z: land.z });
  }
  plan.fielderMoves.push(move);
  return move;
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

// Who could take a throw at `base` from `thrower`, in the order a defense would use them.
function coverCandidates(base, thrower, defense) {
  const list = [];
  const add = (pos) => { if (pos !== thrower.pos && !list.some((q) => q.pos === pos)) list.push(defense[pos]); };
  if (base === 4 || base === 0) add('C');
  else if (base === 1) { if (thrower.pos === '1B') { add('P'); add('2B'); } else add('1B'); }
  else if (base === 3) { add('3B'); add('SS'); }
  else { add(coverer(2, thrower, defense).pos); add('SS'); add('2B'); }
  return list;
}

// When can fielder `q` be standing on `base`, if he breaks for it at `tStart`? (Same movement model as every other run.)
function coverArrival(plan, q, base, tStart, cfg) {
  const F = cfg.fielding;
  const runs = plan.paths[q.pos];
  const last = runs && runs[runs.length - 1];
  const x0 = last ? last.xStop : q.x, z0 = last ? last.zStop : q.z;
  const t0 = last ? Math.max(tStart, last.tStop) : tStart;
  const speed = Math.max(q.speed, F.cover.minSpeed);
  return { t: t0 + timeToCover(speed, dist(x0, z0, BASE_XZ[base][0], BASE_XZ[base][1]), F.accel), speed, start: t0 };
}

/**
 * Every way to record the out at `base`, best first. An option is only real if somebody is on the bag WITH the ball:
 *   - a throw to a covering fielder: the throw is timed to reach the bag when he does (the ball never goes to an empty base),
 *     so the out is made at max(when the throw could arrive, when he can get there);
 *   - the fielder with the ball takes it there himself (unassisted), if he is close enough to be quicker.
 * @param {object} o
 * @param {object} o.thrower   the fielder with the ball
 * @param {number} o.tReady    when he is ready to throw
 * @param {{x:number,z:number}} o.from  where he throws from
 * @param {number} [o.tHave]   when he first has the ball (for carrying it himself); omit to rule that out
 * @param {number} [o.runnerT] when the runner gets there (options that are too late are dropped)
 * @param {number} [o.coverStart] when the covering men break for the bag (default fielding.cover.start)
 * @param {number} [o.tag]     seconds to put a tag on a runner who is not forced (home always takes fielding.tagTime)
 */
function coverOptions(o, plan, defense, cfg) {
  const F = cfg.fielding;
  const { base, thrower, tReady, from } = o;
  const [bx, bz] = BASE_XZ[base === 0 ? 4 : base];
  const tag = base === 4 ? F.tagTime : o.tag || 0; // (a tag play: the receiver needs a moment to put the glove on the runner)
  const out = [];
  const flight = throwTime(dist(from.x, from.z, bx, bz), thrower, cfg);
  coverCandidates(base, thrower, defense).forEach((q, idx) => {
    const arr = coverArrival(plan, q, base, o.coverStart ?? F.cover.start, cfg);
    const tOut = Math.max(tReady + flight + tag, arr.t + tag);
    out.push({ recv: q, self: false, tagged: tag > 0, tOut, t1: tOut, t0: Math.max(tReady, tOut - tag - flight), tCover: arr.t, coverStart: arr.start, speed: arr.speed, score: tOut - (idx === 0 ? F.cover.traditionBonus : 0) });
  });
  if (o.tHave !== undefined) {
    // he carries it there himself (only from close by: from farther away a throw to the man covering is the play)
    const runs = plan.paths[thrower.pos];
    const last = runs && runs[runs.length - 1];
    // he turns for the bag as soon as he has the ball (still braking from the pickup is fine: that run is cut short)
    const want = o.tHave + F.cover.selfStart + (o.dive ? F.dive.throwExtra : 0);
    const cut = cutPoint(last, want);
    const x0 = cut ? cut.x : last ? last.xStop : from.x, z0 = cut ? cut.z : last ? last.zStop : from.z;
    const start = cut ? want : Math.max(want, last ? last.tStop : 0);
    const d = dist(x0, z0, bx, bz);
    const carry = Math.max(thrower.speed, F.cover.carrySpeed);
    const tOut = start + timeToCover(carry, d, F.cover.carryAccel);
    // a first baseman who has the ball near his bag runs over and steps on it (flipping to the pitcher is for balls he cannot run down)
    const first = thrower.pos === '1B' && base === 1;
    const closeEnough = d <= (first ? F.cover.firstSelfDistance : F.cover.selfDistance);
    if (d <= F.cover.maxCarry) out.push({ recv: thrower, self: true, cut: !!cut, tagged: tag > 0, tOut, t1: tOut, t0: start, tCover: tOut, coverStart: start, speed: carry, score: tOut - (closeEnough ? (first ? F.cover.firstSelfBonus : F.cover.selfBonus) : 0) });
  }
  const runnerT = o.runnerT ?? Infinity;
  return out.filter((c) => c.tOut + F.outMargin <= runnerT).sort((a, b) => a.score - b.score);
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
function planPlayCore(i, cfg) {
  const { sim, contact, defense } = i;
  const bases = i.bases || [null, null, null];
  const outs = i.outs || 0;
  const F = cfg.fielding;
  const R = cfg.runner;
  const type = battedBallType(contact.launchAngle);
  READ = R.read[type] || 0;
  const fair = judgeFairFoul(sim);
  const plan = {
    fair, type,
    result: null, batterDest: 0, moves: [], outsMade: 0,
    fielderMoves: [], paths: {}, throws: [], carries: [], looses: [], events: [],
    ballHitEnd: sim.duration, endTime: 0, homer: false, ctx: null,
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
    const [wx, wz] = clampToField(end.x, end.z, F.wallMargin + 2.2); // he watches it go from a few feet in front of the wall
    const tArr = Math.min(sim.homerun.t, best.f.react + Math.hypot(best.f.x - wx, best.f.z - wz) / best.f.speed);
    addMove(plan, best.f, wx, wz, Math.max(tArr, best.f.react + 0.4), { watch: true, role: 'watch', minEffort: 0.5 }, cfg);
    plan.fielder = best.f.pos;
    // everyone circles the bases (trot)
    for (let b = 0; b < 3; b++) {
      if (!bases[b]) continue;
      const m = { from: b + 1, to: 4, out: false, trot: true };
      // a runner who was already going with the pitch carries on from where he is, at a trot
      if (rs(b + 1) !== undefined) m.tStart = -runnerProfile(b + 1, 4, 'trot', cfg).tAtS(runnerProfile(b + 1, b + 2, 'run', cfg, sp(b + 1)).at(-rs(b + 1), {}).s);
      plan.moves.push(m);
    }
    plan.moves.push({ from: 0, to: 4, out: false, trot: true });
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
    // a ball above his standing reach is taken with a leap (feet off the ground at the catch); the renderer draws the jump
    plan.leap = !air.dive && air.ball.y - F.standReach > 0.3 ? { height: air.ball.y - F.standReach } : null;
    addMove(plan, f, air.ball.x, air.ball.z, air.t, { dive: air.dive, avail: air.avail, role: 'catch' }, cfg);
    plan.ctx = { kind: 'air', x: air.ball.x, z: air.ball.z, t: air.t };
    // a dropped fly ball (rare): it hits the glove and pops out; he picks it up and the runners take what they can
    if (fair && !i.simple && errorHappens(i, F.errors.fly * (air.dive || plan.leap ? F.errors.hardFactor : 1))) {
      return dropFly(plan, i, f, air, bases, outs, defense, cfg);
    }
    plan.ballHitEnd = air.t;
    plan.carries.push({ pos: f.pos, t0: air.t, t1: air.t + 99 });
    plan.events.push({ t: air.t, type: 'catch', pos: f.pos, dive: !!plan.fielderMoves[0].dive });
    if (!fair) {
      plan.result = 'foulOut';
      plan.outsMade = 1;
      plan.batterDest = 0;
      plan.endTime = air.t + 0.9;
      plan.notes.push('foul ball caught by ' + f.pos);
      if (!i.simple) { runnersGoBack(plan, f, air, type, bases, outs, defense, cfg); runnersHold(plan, bases, cfg); }
      return plan;
    }
    plan.result = sim.apex.y <= 24 ? 'lineout' : (type === 'pop' || sim.apex.y >= 75) && Math.hypot(air.ball.x, air.ball.z) < 150 ? 'popout' : 'flyout';
    plan.outsMade = 1;
    plan.batterDest = 0;
    plan.endTime = air.t + 0.9;
    if (i.simple) return plan;
    runnersGoBack(plan, f, air, type, bases, outs, defense, cfg);
    // Tag-ups on a caught fly ball (not on line drives; not by a runner who was going with the pitch and had to get back)
    if (type !== 'line' && outs + plan.outsMade < 3) {
      const depth = Math.hypot(air.ball.x, air.ball.z);
      const tCatch = air.t;
      const home = BASE_XZ[4];
      const throwHome = tCatch + F.transfer[f.type] + throwTime(dist(air.ball.x, air.ball.z, home[0], home[1]), f, cfg) + F.tagTime;
      // runner on 3rd
      if (bases[2] && rs(3) === undefined && depth > 170) {
        const arrive = arrivalAt(cfg, 3, 4, tCatch + 0.15);
        if (arrive < throwHome - F.runnerMargin) {
          plan.moves.push({ from: 3, to: 4, out: false, tStart: tCatch + 0.15, tag: true });
          plan.result = 'sacFly';
          plan.endTime = Math.max(plan.endTime, finishAt(cfg, 3, 4, tCatch + 0.15) + 0.35);
          plan.events.push({ t: throwHome, type: 'throwLate' });
          // the throw home (late)
          const c = defense.C;
          plan.throws.push({ from: f.pos, to: 'C', t0: tCatch + F.transfer[f.type], t1: throwHome, ax: air.ball.x, az: air.ball.z, bx: home[0], bz: home[1], toBase: 4 });
        }
      }
      // runner on 2nd goes to 3rd on a deep fly
      if (bases[1] && rs(2) === undefined && depth > 250 && !(bases[2] && plan.moves.every((m) => m.from !== 3))) {
        const d3 = dist(air.ball.x, air.ball.z, BASE_XZ[3][0], BASE_XZ[3][1]);
        const throw3 = tCatch + F.transfer[f.type] + throwTime(d3, f, cfg);
        const arrive = arrivalAt(cfg, 2, 3, tCatch + 0.15);
        if (arrive < throw3 - F.runnerMargin - 0.25) {
          plan.moves.push({ from: 2, to: 3, out: false, tStart: tCatch + 0.15, tag: true });
          plan.endTime = Math.max(plan.endTime, finishAt(cfg, 2, 3, tCatch + 0.15) + 0.35); // the play lasts until he is there
        }
      }
    }
    runnersHold(plan, bases, cfg); // everyone else stays on (or gets back to) his base
    return plan;
  }

  // ---------------- foul ball (uncaught) ----------------
  if (!fair) {
    plan.result = 'foul';
    plan.batterDest = 0;
    plan.ballHitEnd = Math.min(sim.contactTime + 0.5, sim.duration);
    plan.endTime = plan.ballHitEnd + 0.35;
    // runners who were going with the pitch pull up and go back
    for (let b = 1; b <= 3; b++) if (bases[b - 1] && rs(b) !== undefined) plan.moves.push({ from: b, to: b, back: true, tStart: rs(b), backAt: cfg.steal.readFoul });
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
  // (A ball off the wall: the pickup point is wherever the ball is when the first fielder can reach it - by then it has come off
  // the wall - and the target is kept in front of the wall, so he plays the carom, never the wall itself.)
  addMove(plan, f, pf.x, pf.z, tF, { dive: pick.dive, avail: pick.avail, start: pick.start, role: 'field' }, cfg);
  plan.ctx = { kind: 'ground', x: pf.x, z: pf.z, t: tF };
  plan.downT = Math.min(sim.firstBounce ? sim.firstBounce.t : Infinity, sim.wallHit ? sim.wallHit.t : Infinity, tF); // (the ball is down: runners can be sent)
  plan.events.push({ t: tF, type: 'field', pos: f.pos, dive: !!plan.fielderMoves[0].dive });
  const tr = F.transfer[f.type] + (plan.fielderMoves[0].dive ? F.dive.throwExtra : 0); // a fielder who dove throws from his knees
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
  const bunt = !!contact.bunt;
  plan.bunt = bunt;
  // a bobbled grounder (rare): the out is gone; he picks it up again and throws to where the lead runner is going
  if (isInfieldPlay && groundBall && errorHappens(i, F.errors.ground * (contact.exitVelocity > 95 || plan.fielderMoves[0].dive ? F.errors.hardFactor : 1))) {
    return bobble(plan, i, f, tF, pf, bases, forced, outs, defense, cfg);
  }
  if (isInfieldPlay && groundBall) {
    const attempt = tryInfieldOut({ f, tF, tReady, pf, bases, forced, outs, defense, cfg, plan, bunt });
    if (attempt) return finishInfieldOut(plan, attempt, { f, tF, tReady, pf, bases, forced, outs, defense, cfg, bunt });
  }

  // --- Otherwise it is a hit. Work out how far everyone goes. ---
  return finishHit(plan, { f, tF, tReady, pf, bases, forced, outs, defense, cfg });
}


// A play that makes the third out ends the inning right there: runners still on their way ease up and stop (they do not keep
// running round to score a run that cannot count), and the play is over soon after the out instead of when they would have stopped.
function endInningStop(plan, outs, cfg) {
  if (outs + plan.outsMade < 3 || plan.homer) return;
  let tOut = -1;
  for (const m of plan.moves) if (m.out && m.outAt !== undefined) tOut = Math.max(tOut, m.outAt);
  if (plan.caught && plan.catchT !== undefined) tOut = Math.max(tOut, plan.catchT);
  if (tOut < 0) return;
  const stopAt = tOut + cfg.runner.easeUpReact;
  let running = false;
  for (const m of plan.moves) {
    if (m.out || m.to <= m.from) continue;
    if (plan.timePlay && m.to >= 4 && mArrive(cfg, m, 4) <= tOut) { m.beforeOut = true; continue; } // scored before the tag: it counts
    if (mFinish(cfg, m) > stopAt) { m.stopAt = stopAt; running = true; }
  }
  if (!running) return;
  let end = tOut + 0.8;
  for (const th of plan.throws) end = Math.max(end, th.t1 + 0.3);
  plan.endTime = Math.min(plan.endTime, Math.max(end, stopAt + cfg.runner.easeUp * 3));
}

// ---------------------------------------------------------------------------
// Runners going with the pitch (a steal attempt or a hit-and-run): `i.running` = { base: when he took off, in the play's clock
// (negative: before contact) }. Every arrival time of such a runner uses his head start. (Module state, set only while
// planPlay runs.)
let RUN = null;
const rs = (b) => (RUN ? RUN[b] : undefined);
// Each runner's speed (x the standard runner; Season players' Speed rating): `i.speeds` = { 0: the batter, 1..3: the runners }.
let SPD = null;
const sp = (b) => (SPD && SPD[b]) || 1;
// A runner waits to see what the ball does: on a ball in the air he does not break for the next base for READ seconds.
let READ = 0;
// Your runner orders (you tapped a base): `i.orders` = [{ base, t }] in the order given, t = seconds after contact.
let ORD = null;
const readDelay = (cfg, from) => (from >= 1 && READ > 0 && rs(from) === undefined ? cfg.runner.startDelay + READ : undefined);
const arrivalAt = (cfg, from, to, tStart, kind = 'run') => runnerArrival(cfg, from, to, tStart ?? readDelay(cfg, from), kind, sp(from));
const finishAt = (cfg, from, to, tStart, kind = 'run') => runnerFinish(cfg, from, to, tStart ?? readDelay(cfg, from), kind, sp(from));
// the same for a whole plan move (a runner who was sent on has legs; one rounding a base runs a different route)
const mArrive = (cfg, m, base) => (m.legs || m.round ? moveArrival(cfg, m, base) : arrivalAt(cfg, m.from, base, m.tStart));
const mFinish = (cfg, m) => (m.legs || m.round ? moveFinish(cfg, m) : finishAt(cfg, m.from, m.to, m.tStart));

// Give every runner move of a going runner his real start; one who ends up staying put has to go back to his base.
function runningStarts(plan, cfg) {
  for (const m of plan.moves) {
    if (!(m.from >= 1) || rs(m.from) === undefined || m.back || m.trot) continue;
    if (m.tStart === undefined) m.tStart = rs(m.from);
    if (!m.out && m.to <= m.from) {
      m.back = true;
      m.backAt = Math.max(m.tStart + 0.2, plan.pickupT ?? plan.catchT ?? cfg.steal.readFoul);
      plan.endTime = Math.max(plan.endTime, retreatArrival(cfg, m.from, m.tStart, m.backAt, sp(m.from)) + 0.25);
    }
  }
  // (a going runner the plan did not mention holds his base: he goes back too)
  for (const b of [1, 2, 3]) {
    if (rs(b) === undefined || plan.moves.some((m) => m.from === b) || plan.homer) continue;
    const backAt = Math.max(rs(b) + 0.2, plan.pickupT ?? plan.catchT ?? cfg.steal.readFoul);
    plan.moves.push({ from: b, to: b, back: true, tStart: rs(b), backAt });
  }
}

// A ball in the air that is caught: runners who were not sent do not run - they take a step or two off the bag, see it
// is a fly ball, and get back (a pop-up: they stand almost still).
function runnersHold(plan, bases, cfg) {
  for (let b = 1; b <= 3; b++) {
    if (!bases[b - 1] || plan.moves.some((m) => m.from === b)) continue;
    const t0 = cfg.runner.startDelay;
    const backAt = t0 + cfg.runner.holdStep;
    plan.moves.push({ from: b, to: b, back: true, tStart: t0, backAt });
    plan.endTime = Math.max(plan.endTime, retreatArrival(cfg, b, t0, backAt, sp(b)) + 0.2);
  }
}

// A ball is caught: runners who were going with the pitch turn round and head back. On a line drive they are caught too far off
// and the fielder may double one up - but only the usual way: somebody on the bag with the ball before the runner gets back.
function runnersGoBack(plan, f, air, type, bases, outs, defense, cfg) {
  const F = cfg.fielding;
  let triedOut = false;
  for (const b of [3, 2, 1]) {
    if (!bases[b - 1] || rs(b) === undefined) continue;
    const backAt = type === 'line' ? Math.max(air.t, rs(b) + 0.2) : Math.max(rs(b) + 0.2, Math.min(air.t, cfg.steal.readFly));
    const retT = retreatArrival(cfg, b, rs(b), backAt, sp(b));
    if (!triedOut && outs + plan.outsMade < 3) {
      triedOut = true;
      const tReady = air.t + F.transfer[f.type];
      const way = coverOptions({ base: b, thrower: f, tReady, from: { x: air.ball.x, z: air.ball.z }, tHave: air.t, runnerT: retT }, plan, defense, cfg)[0];
      if (way) {
        planOut(plan, way, b, f, { x: air.ball.x, z: air.ball.z }, tReady, cfg);
        plan.moves.push({ from: b, to: 0, out: true, outAt: way.tOut, outBase: b, back: true, tStart: rs(b), backAt });
        plan.outsMade++;
        plan.result = 'doublePlay';
        plan.doubledOff = b;
        plan.endTime = Math.max(plan.endTime, way.tOut + 0.8);
        continue;
      }
    }
    plan.moves.push({ from: b, to: b, back: true, tStart: rs(b), backAt });
    plan.endTime = Math.max(plan.endTime, Math.min(retT, air.t + 2.5) + 0.3);
  }
}

// ---------------------------------------------------------------------------
// A stolen-base attempt with no ball in play. The clock starts when the catcher has the pitch (t = 0).
//   i.bases, i.outs, i.defense; i.running = { base: when that runner took off (negative) }; i.transfer = seconds until the catcher
//   can throw (his exchange, plus a moment to dig a pitch out of the dirt); i.coverStart = when the infielders broke for the bag
//   (they go when they see the runner go, so it is negative too).
// The catcher throws at the lead runner; the out is made only if the man covering the bag has the ball there before the runner
// arrives (plus the moment it takes to put the tag on). A hopeless throw is not made.
export function planSteal(i, cfg = CONFIG) {
  SPD = i.speeds || null;
  try { return planStealCore(i, cfg); } finally { SPD = null; }
}
function planStealCore(i, cfg) {
  const F = cfg.fielding;
  const defense = i.defense;
  const C = defense.C;
  const plan = {
    fair: true, type: 'steal', steal: true,
    result: 'stolenBase', batterDest: 0, moves: [], outsMade: 0,
    fielderMoves: [], paths: {}, throws: [], carries: [], looses: [], events: [],
    ballHitEnd: 0, pickupT: 0, endTime: 0, homer: false, ctx: { kind: 'steal' }, fielder: 'C', notes: [], ballLandDistance: 0,
  };
  const going = [3, 2, 1].filter((b) => i.bases[b - 1] && i.running[b] !== undefined);
  if (!going.length) return null;
  const lead = going[0], target = lead + 1;
  const tReady = i.transfer;
  const from = { x: C.x, z: C.z };
  plan.carries.push({ pos: 'C', t0: 0, t1: tReady });
  const runnerT = arrivalAt(cfg, lead, target, i.running[lead]);
  const opts = coverOptions({ base: target, thrower: C, tReady, from, tag: cfg.steal.tagTime, coverStart: i.coverStart }, plan, defense, cfg).filter((o) => !o.self);
  const way = opts[0];
  let leadMove = { from: lead, to: target, out: false, tStart: i.running[lead] };
  if (way && way.tOut + F.outMargin <= runnerT) {
    planOut(plan, way, target, C, from, tReady, cfg);
    leadMove = { from: lead, to: 0, out: true, outAt: way.tOut, outBase: target, tStart: i.running[lead] };
    plan.outsMade = 1;
    plan.result = 'caughtStealing';
  } else if (way && way.tOut - runnerT < cfg.steal.noThrow) {
    // the throw is made, but too late
    const [bx, bz] = BASE_XZ[target];
    const recv = way.recv;
    addMove(plan, recv, bx, bz, Math.max(way.coverStart + 0.05, way.tOut - cfg.steal.tagTime), { role: 'cover', start: way.coverStart, vmax: way.speed, minEffort: 0.8 }, cfg);
    plan.carries[0].t1 = Math.max(plan.carries[0].t1, way.t0);
    plan.throws.push({ from: 'C', to: recv.pos, t0: way.t0, t1: way.t1, ax: from.x, az: from.z, bx, bz, toBase: target });
    plan.carries.push({ pos: recv.pos, t0: way.t1, t1: way.t1 + 99 });
  } else plan.carries[0].t1 = 99; // no throw: he holds on to it
  plan.moves.push(leadMove);
  plan.margin = way ? way.tOut - runnerT : Infinity; // + = the runner beat the tag by this much
  // a trailing runner on a double steal takes his base (the throw went to the lead runner)
  for (const b of going.slice(1)) plan.moves.push({ from: b, to: b + 1, out: false, tStart: i.running[b] });
  if (going.length > 1) plan.doubleSteal = true;
  let end = 0;
  for (const m of plan.moves) end = Math.max(end, m.out ? m.outAt : finishAt(cfg, m.from, m.to, m.tStart));
  for (const th of plan.throws) end = Math.max(end, th.t1);
  plan.endTime = end + 0.6;
  speedsOnMoves(plan);
  endInningStop(plan, i.outs || 0, cfg);
  settleThrows(plan);
  addCalls(plan, cfg);
  return plan;
}

// ---------------------------------------------------------------------------
// Errors. `i.errorRoll` (0..1, from the engine's seeded random numbers) decides; no roll = no errors (tests, the Derby, practice).
function errorHappens(i, p) {
  return i.errorRoll !== undefined && !i.simple && i.errorRoll < p * (i.errorScale ?? 1);
}
// Where the ball squirts to (a direction fixed by the roll, so a replay is identical), kept inside the ballpark.
function looseSpot(i, x, z, cfg) {
  const a = ((i.errorRoll * 7919) % 1) * Math.PI * 2;
  return clampToField(x + Math.cos(a) * cfg.fielding.errors.looseDist, z + Math.sin(a) * cfg.fielding.errors.looseDist, cfg.fielding.wallMargin);
}
// The fielder goes after the loose ball; he has it again when the ball has stopped rolling AND he is there.
function chaseLoose(plan, f, loose, tEarliest, cfg) {
  const move = addMove(plan, f, loose.bx, loose.bz, tEarliest - 0.05, { role: 'field', minEffort: 0.95 }, cfg);
  const tPick = Math.max(tEarliest, move.run.tReach + 0.05);
  loose.t1 = tPick;
  plan.looses.push(loose);
  return tPick;
}
function bobble(plan, i, f, tF, pf, bases, forced, outs, defense, cfg) {
  const F = cfg.fielding;
  const [lx, lz] = looseSpot(i, pf.x, pf.z, cfg);
  const tOut = tF + 0.08;
  const carry = plan.carries.find((c) => c.pos === f.pos);
  if (carry) carry.t1 = tOut;
  const tPick = chaseLoose(plan, f, { t0: tOut, ax: pf.x, ay: 1.6, az: pf.z, bx: lx, bz: lz }, tF + F.errors.bobbleTime, cfg);
  const tReady = tPick + F.transfer[f.type];
  plan.carries.push({ pos: f.pos, t0: tPick, t1: tReady });
  plan.error = { pos: f.pos, kind: 'bobble', t: tF + 0.05 };
  plan.downT = tF + 0.05;
  plan.events.push({ t: tF + 0.05, type: 'error', pos: f.pos });
  finishHit(plan, { f, tF: tPick, tReady, pf: { x: lx, z: lz }, bases, forced, outs, defense, cfg });
  plan.result = 'error';
  plan.infieldHit = false;
  return plan;
}
function dropFly(plan, i, f, air, bases, outs, defense, cfg) {
  const F = cfg.fielding;
  const [lx, lz] = looseSpot(i, air.ball.x, air.ball.z, cfg);
  plan.caught = false; plan.dropped = true;
  plan.pickupT = air.t; // the ball's flight ends at his glove
  plan.ballHitEnd = air.t;
  plan.events.push({ t: air.t, type: 'error', pos: f.pos, drop: true });
  const tPick = chaseLoose(plan, f, { t0: air.t, ax: air.ball.x, ay: air.ball.y, az: air.ball.z, bx: lx, bz: lz }, air.t + F.errors.dropTime, cfg);
  const tReady = tPick + F.transfer[f.type];
  plan.carries.push({ pos: f.pos, t0: tPick, t1: tReady });
  plan.error = { pos: f.pos, kind: 'drop', t: air.t };
  plan.downT = air.t;
  const forced = new Set();
  if (bases[0]) { forced.add(1); if (bases[1]) { forced.add(2); if (bases[2]) forced.add(3); } }
  plan.outsMade = 0; plan.batterDest = 0;
  finishHit(plan, { f, tF: tPick, tReady, pf: { x: lx, z: lz }, bases, forced, outs, defense, cfg });
  plan.result = 'error';
  return plan;
}

// ---------------------------------------------------------------------------
// Public entry point: the core plan (who fields it, throws, runners) plus everybody else's job.
// ---------------------------------------------------------------------------
export function planPlay(i, cfg = CONFIG) {
  RUN = i.running || null;
  SPD = i.speeds || null;
  ORD = i.orders && i.orders.length ? i.orders : null;
  READ = 0;
  try {
    const plan = planPlayCore(i, cfg);
    if (RUN) runningStarts(plan, cfg);
    speedsOnMoves(plan);
    if (!i.simple) endInningStop(plan, i.outs || 0, cfg);
    addSupport(plan, i, cfg);
    settleThrows(plan);
    addCalls(plan, cfg);
    return plan;
  } finally { RUN = null; SPD = null; ORD = null; READ = 0; }
}
// (the renderer draws each runner at his own speed)
function speedsOnMoves(plan) {
  if (SPD) for (const m of plan.moves) { const f = sp(m.from); if (f !== 1) m.spd = f; }
}

// A close play gets a "Safe!" call: the throw reaches the base just AFTER the runner (within a beat).
function addCalls(plan, cfg) {
  for (const th of plan.throws) {
    const base = th.toBase;
    if (!(base >= 1 && base <= 4)) continue;
    if (plan.events.some((e) => (e.type === 'out' || e.type === 'safe') && e.base === base)) continue; // that one is an out (or already called safe)
    for (const m of plan.moves) {
      if (m.out || m.to !== base) continue;
      const arrive = mArrive(cfg, m, base);
      if (m.stopAt !== undefined && arrive > m.stopAt) continue; // the inning was already over: he never got there
      const margin = th.t1 - arrive;
      if (margin >= 0 && margin <= cfg.fielding.closePlay) { plan.events.push({ t: th.t1 + 0.1, type: 'safe', base }); return; }
    }
  }
}

// When is a fielder finished with his job in this play (so he can start jogging back to his spot)?
export function fielderFreeTime(plan, pos) {
  plan._free = plan._free || {};
  if (plan._free[pos] !== undefined) return plan._free[pos];
  const runs = plan.paths[pos];
  let t = 0;
  if (runs) for (const r of runs) t = Math.max(t, r.tStop);
  let involved = false;
  for (const th of plan.throws) {
    if (th.from === pos) { t = Math.max(t, th.t0 + 0.5); involved = true; }
    if (th.to === pos) { t = Math.max(t, th.t1 + 0.6); involved = true; }
  }
  if (plan.fielder === pos) {
    const tc = plan.caught ? plan.catchT : plan.pickupT;
    if (tc !== undefined) t = Math.max(t, tc + 1.3);
    involved = true;
  }
  // backups, shaders, watchers and coverers that never get a throw stay put until the play is over
  if (!involved && runs) t = Math.max(t, plan.endTime);
  plan._free[pos] = t;
  return t;
}

/**
 * When (seconds after the play began) is this fielder back on his spot and standing still again? A fielder's planned run ends
 * where it ends (say, the pitcher after fielding a comebacker, or the catcher after covering the plate); when the play is over
 * he jogs home (the same steering the renderer uses). The engine waits for this before the next pitch.
 * @param {number} playEnd  when the play ended, in the same seconds (the jog starts then, or when his run ends if that is later)
 */
export function fielderBackTime(plan, pos, defense, cfg, playEnd = 0) {
  const runs = plan.paths && plan.paths[pos];
  if (!runs || !runs.length) return 0;
  const last = runs[runs.length - 1];
  const f = defense[pos];
  const jog = { vmax: cfg.fielding.jogHome.speed, accel: cfg.fielding.jogHome.accel, brake: cfg.fielding.jogHome.brake, wake: 0.9 };
  if (last.tStop - playEnd > TAIL_MAX) {
    // the play ends while he is still running: he turns around at once, carrying the speed he has (that is what is drawn)
    const q = samplePath(runs, playEnd);
    return playEnd + moverReturnTime(q.x, q.z, q.ux * q.speed, q.uz * q.speed, f.homeX, f.homeZ, jog);
  }
  const d = Math.hypot(last.xStop - f.homeX, last.zStop - f.homeZ);
  if (d < 1.0) return last.tStop; // he never really left
  const start = Math.max(last.tStop, Math.min(fielderFreeTime(plan, pos), playEnd)); // he heads home once his job is done (or the play is over)
  return start + moverReturnTime(last.xStop, last.zStop, 0, 0, f.homeX, f.homeZ, jog);
}

// Where a fielder stands when he "covers" a base: just inside the bag, on the infield side.
function standAt(base) {
  const [bx, bz] = BASE_XZ[base];
  if (base === 0 || base === 4) return [0, 1.6];
  const cx = 0, cz = BASE_XZ[2][1] / 2;
  const d = Math.hypot(cx - bx, cz - bz) || 1;
  return [bx + ((cx - bx) / d) * 1.4, bz + ((cz - bz) / d) * 1.4];
}

// Everybody who is not fielding the ball gets a job: outfielders back the play up, infielders cover bags, the pitcher
// backs up throws home / to third, the catcher covers the plate. (Movement only - it never changes who is safe or out.)
function addSupport(plan, i, cfg) {
  const c = plan.ctx;
  if (!c || plan.homer || !plan.fair) return;
  const F = cfg.fielding;
  const defense = i.defense;
  const bases = i.bases || [null, null, null];
  const busy = new Set(plan.fielderMoves.map((m) => m.pos));
  const depth = Math.max(1, Math.hypot(c.x, c.z));
  const ux = c.x / depth, uz = c.z / depth;
  const near = (p) => dist(defense[p].x, defense[p].z, c.x, c.z);
  const idle = (list) => list.filter((p) => !busy.has(p));
  const inside = (x, z, margin) => clampToField(x, z, margin);
  const go = (pos, x, z, tArrive, role, limit = Infinity) => {
    const f = defense[pos];
    busy.add(pos);
    let tx = x, tz = z;
    const d = dist(f.x, f.z, x, z);
    // These runs are only for show, so none of them may outlast the play: he goes as far as he can get (and brake) by the time
    // it is over - the pitcher breaks toward first on a grounder to the right side, he does not run all the way there and hold up
    // the next pitch while he walks back.
    const vmaxS = f.speed * F.supportSpeed;
    const reach = covered(vmaxS, Math.max(0.2, plan.endTime + 0.1 - f.react - vmaxS / (2 * F.brake)), F.accel);
    limit = Math.min(limit, Math.max(3, reach));
    if (d > limit) { tx = f.x + ((x - f.x) / d) * limit; tz = f.z + ((z - f.z) / d) * limit; }
    if (dist(f.x, f.z, tx, tz) < 1.5) return;
    addMove(plan, f, tx, tz, tArrive, { role, vmax: f.speed * F.supportSpeed, minEffort: 0.75 }, cfg);
  };
  const tBall = Math.max(c.t, 1.2);

  // ---- outfielders
  const ofs = idle(['LF', 'CF', 'RF']).sort((a, b) => near(a) - near(b));
  if (depth > 150 && ofs.length) {
    const [bx, bz] = inside(c.x + ux * F.backupDepth, c.z + uz * F.backupDepth, 8);
    go(ofs[0], bx, bz, tBall + 0.2, 'backup');
    if (ofs[1]) {
      const o = defense[ofs[1]];
      // the other outfielder runs at the ball too (most of the way), in case it gets past or off the wall
      go(ofs[1], o.x + (c.x - o.x) * F.chaseShare, o.z + (c.z - o.z) * F.chaseShare, tBall + 0.2, 'chase');
    }
  } else if (c.kind === 'ground' && ofs.length) {
    const [bx, bz] = inside(c.x + ux * (F.backupDepth + 14), c.z + uz * (F.backupDepth + 14), 8);
    go(ofs[0], bx, bz, tBall + 0.4, 'backup', F.backupTravel);
  }

  // ---- bases and battery on a hit that turns into a throw
  if (!i.simple && c.leadDest !== undefined) {
    const lead = c.leadDest;
    const cover = (pos, base, t) => { const [x, z] = standAt(base); go(pos, x, z, t, 'cover'); };
    if (!busy.has('1B')) cover('1B', 1, 2.0);
    if (lead >= 2 || bases[0]) {
      const mid = idle(['SS', '2B']).sort((a, b) => dist(defense[a].x, defense[a].z, BASE_XZ[2][0], BASE_XZ[2][1]) - dist(defense[b].x, defense[b].z, BASE_XZ[2][0], BASE_XZ[2][1]))[0];
      if (mid) cover(mid, 2, 2.4);
    }
    if (lead >= 3 && !busy.has('3B')) cover('3B', 3, 2.6);
    if (lead >= 3 && !busy.has('P')) {
      // (he breaks toward the spot - not all the way: he has to be back on the rubber for the next pitch)
      if (c.tgtBase === 4) go('P', -7, 11, 2.4, 'backup', F.pitcherBackupTravel);
      else if (c.tgtBase === 3) go('P', BASE_XZ[3][0] - 14, BASE_XZ[3][1] + 14, 2.4, 'backup', F.pitcherBackupTravel);
    }
    if ((bases[1] || bases[2] || lead >= 4) && !busy.has('C')) cover('C', 4, 2.2);
  }
}

// A throw goes to where its receiver really is when the ball arrives (a late runner-up receiver never gets a ball
// thrown at an empty base).
function settleThrows(plan) {
  for (const th of plan.throws) {
    if (th.toBase >= 1 && th.toBase <= 4) continue; // a throw at a base goes to the base: the man covering it is standing there
    const runs = plan.paths[th.to];
    if (!runs) continue;
    const p = samplePath(runs, th.t1);
    if (dist(p.x, p.z, th.bx, th.bz) > 1.2) { th.bx = p.x; th.bz = p.z; }
  }
}

// ---------------------------------------------------------------------------
function throwArrival(f, tReady, base, fx, fz, cfg) {
  const d = dist(fx, fz, BASE_XZ[base][0], BASE_XZ[base][1]);
  return { t: tReady + throwTime(d, f, cfg) + (base === 4 ? cfg.fielding.tagTime : 0), d };
}

// Can the defense get an out at this base before the runner does? Returns the best way, or null.
function outAt(base, runnerT, ctx, plan, cfg) {
  const { f, tF, tReady, pf } = ctx;
  const dive = !!(plan.fielderMoves[0] && plan.fielderMoves[0].dive);
  const opts = coverOptions({ base, thrower: f, tReady, from: { x: pf.x, z: pf.z }, tHave: tF, dive, runnerT }, plan, ctx.defense, cfg);
  return opts[0] || null;
}

function tryInfieldOut({ f, tF, tReady, pf, bases, forced, outs, defense, cfg, plan, bunt = false }) {
  const ctx = { f, tF, tReady, pf, defense };
  const options = [];

  // Force play on the lead forced runner (the sure out with runners on, and it starts a double play)
  let leadForced = 0;
  for (const b of forced) leadForced = Math.max(leadForced, b);
  if (leadForced > 0) {
    const targetBase = leadForced + 1 > 3 ? 4 : leadForced + 1; // runner from `leadForced` heads to the next base
    const runnerArr = arrivalAt(cfg, leadForced, Math.min(4, leadForced + 1), rs(leadForced));
    const way = outAt(targetBase, runnerArr, ctx, plan, cfg);
    if (way) options.push({ kind: 'force', base: targetBase, t: way.tOut, margin: runnerArr - way.tOut, way });
  }
  // Batter at first
  const batterTo1 = arrivalAt(cfg, 0, 1);
  const way1 = outAt(1, batterTo1, ctx, plan, cfg);
  if (way1) options.push({ kind: 'first', base: 1, t: way1.tOut, margin: batterTo1 - way1.tOut, way: way1 });

  if (!options.length) return null;
  // With < 2 outs and a force available, prefer the force (starts a double play); else the surest out.
  let choice;
  const force = options.find((o) => o.kind === 'force');
  const first = options.find((o) => o.kind === 'first');
  // On a bunt the fielder charging in takes the sure out at first, unless the lead runner is clearly beaten.
  // (A thin force play is not worth it when the batter can be had easily: take the sure out.)
  const thin = force && first && force.margin < cfg.fielding.thinForce && first.margin > force.margin + cfg.fielding.thinForceGain;
  if (force && outs < 2 && !thin && (!bunt || !first || force.margin >= cfg.bunt.leadMargin)) choice = force;
  else choice = options.sort((a, b) => b.margin - a.margin)[0];
  return { choice, force, first, leadForced };
}

// Put a chosen way of making the out into the plan: the covering fielder runs to the bag, the throw is timed to reach him there
// (or the fielder carries the ball to the bag himself).
function planOut(plan, way, base, thrower, from, tReady, cfg, role = 'cover') {
  const F = cfg.fielding;
  const [bx, bz] = BASE_XZ[base === 0 ? 4 : base];
  const recv = way.recv;
  addMove(plan, recv, bx, bz, Math.max(way.coverStart + 0.05, way.tOut - (base === 4 ? F.tagTime : 0)), { role, start: way.coverStart, vmax: way.speed, minEffort: way.self ? 1 : 0.8, cut: way.self && way.cut, accelTime: way.self ? F.cover.carryAccel : undefined }, cfg);
  if (way.self) {
    const carry = plan.carries.find((c) => c.pos === thrower.pos && c.t1 - c.t0 < 5);
    if (carry) carry.t1 = way.tOut + 99;
  } else {
    // he holds the ball until the throw can arrive together with the covering man
    const carry = plan.carries.find((c) => c.pos === thrower.pos && Math.abs(c.t1 - tReady) < 1e-6);
    if (carry) carry.t1 = Math.max(carry.t1, way.t0);
    plan.throws.push({ from: thrower.pos, to: recv.pos, t0: way.t0, t1: way.t1, ax: from.x, az: from.z, bx, bz, toBase: base });
    plan.carries.push({ pos: recv.pos, t0: way.t1, t1: way.t1 + 99 });
  }
  plan.events.push({ t: way.tOut, type: 'out', base: base === 0 ? 4 : base, pos: recv.pos, tag: !!way.tagged }); // (tag: the runner is not forced: the fielder has to put the ball on him)
}

function finishInfieldOut(plan, at, ctx) {
  const { f, tF, tReady, pf, bases, forced, outs, defense, cfg, bunt = false } = ctx;
  const F = cfg.fielding;
  const { choice, leadForced } = at;

  const way = choice.way;
  const recv = way.recv;
  const rp = { x: BASE_XZ[choice.base][0], z: BASE_XZ[choice.base][1] };
  const tOut = way.tOut;
  planOut(plan, way, choice.base, f, { x: pf.x, z: pf.z }, tReady, cfg);
  plan.ctx.tgtBase = choice.base;
  plan.outsMade = 1;
  let endT = tOut;

  if (choice.kind === 'first') {
    // batter out at first; runners advance if they can
    plan.moves.push({ from: 0, to: 0, out: true, outAt: tOut, outBase: 1 });
    plan.result = 'groundout';
    plan.batterDest = 0;
    plan.moves.push(...advanceOnGroundout({ bases, forced, outsAfter: outs + 1, f, pf, tReady, cfg, bunt }));
  } else {
    // force out at `choice.base`: the runner from base-1 is out
    const outFrom = choice.base === 4 ? 3 : choice.base - 1;
    plan.moves.push({ from: outFrom, to: 0, out: true, outAt: tOut, outBase: choice.base });
    // other runners: forced ones advance one base; free ones may take an extra base
    const skip = new Set([outFrom]);
    // (computed after we know whether a second out is made; provisional with one out)
    plan._pendingRunners = { skip };
    // Try for the second out (double play): the man with the ball relays to first - if someone can be on the bag with it in time
    const secondOutPossible = outs + 1 < 3 && !bunt; // (on a bunt the fielders are out of position: no relay for two)
    plan.batterDest = 1;
    plan.moves.push({ from: 0, to: 1, out: false });
    plan.result = 'fieldersChoice';
    if (secondOutPossible) {
      const tRelay = tOut + F.transfer.IF * 0.85;
      const arrival = arrivalAt(cfg, 0, 1);
      const opts = coverOptions({ base: 1, thrower: recv, tReady: tRelay, from: rp, runnerT: arrival }, plan, defense, cfg);
      if (opts.length) {
        const w2 = opts[0];
        planOut(plan, w2, 1, recv, rp, tRelay, cfg);
        // (the pivot man holds the ball only until he throws it)
        for (const c of plan.carries) if (c.pos === recv.pos && c.t0 < w2.t0 && c.t1 > w2.t0) c.t1 = w2.t0;
        // batter is out
        const bm = plan.moves.find((m) => m.from === 0);
        bm.to = 0; bm.out = true; bm.outAt = w2.tOut; bm.outBase = 1;
        plan.batterDest = 0;
        plan.outsMade = 2;
        plan.result = 'doublePlay';
        endT = w2.tOut;
      }
    }
  }
  if (plan._pendingRunners) {
    const outsAfter = outs + plan.outsMade;
    plan.moves.push(...advanceOnGroundout({ bases, forced, outsAfter, f, pf, tReady, cfg, skip: plan._pendingRunners.skip, bunt }));
    delete plan._pendingRunners;
  }
  plan.endTime = endT + 0.8;
  // the play is not over while a runner who moved up is still running (he would otherwise be cut off mid-stride)
  for (const m of plan.moves) if (!m.out && m.to > m.from) plan.endTime = Math.max(plan.endTime, finishAt(cfg, m.from, m.to, m.tStart) + 0.3);
  void leadForced; void tF;
  return plan;
}

function advanceOnGroundout({ bases, forced, outsAfter, f, pf, tReady, cfg, skip, bunt = false }) {
  // Runners move up on a routine groundout when there is room and fewer than two outs.
  const moves = [];
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
        if (arrivalAt(cfg, 3, 4, rs(3)) + F.runnerMargin < defenseHome) d = 4;
      } else if (b === 2 && (dest[3] === 4 || !occupied[3])) {
        if (f.x > 0) d = 3; // a grounder to the right side
        else if (bunt || rs(2) !== undefined) { // (a runner going with the pitch has the same head start) // on a bunt he breaks for third as it is put down: he takes it unless a throw there would beat him
          const [tx, tz] = BASE_XZ[3];
          if (arrivalAt(cfg, 2, 3, rs(2)) + F.runnerMargin < tReady + throwTime(dist(pf.x, pf.z, tx, tz), f, cfg) + 0.3) d = 3;
        }
      } else if (b === 1 && rs(1) !== undefined && (dest[2] >= 3 || !occupied[2])) {
        // a runner going with the pitch keeps going to second unless a throw there would beat him
        const [tx, tz] = BASE_XZ[2];
        if (arrivalAt(cfg, 1, 2, rs(1)) + F.runnerMargin < tReady + throwTime(dist(pf.x, pf.z, tx, tz), f, cfg) + F.tagTime) d = 2;
      }
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

  // Defense arrival time at each base if the fielder throws there.
  const D = {};
  for (let b = 1; b <= 4; b++) D[b] = throwArrival(f, tReady, b, pf.x, pf.z, cfg).t;

  // Existing runners: process from the lead runner back so nobody passes anybody. On their own they only ever take ONE base
  // (the next one, when it is safe - or because they are forced); anything more is up to you (runner orders, below).
  const dests = {}; // from -> to
  const order = [3, 2, 1].filter((b) => bases[b - 1]);
  let ceiling = 5; // lowest occupied destination base ahead (exclusive); 5 = none
  for (const b of order) {
    let target = b;
    if (forced.has(b)) target = b + 1;
    else if (arrivalAt(cfg, b, b + 1, rs(b)) + F.runnerMargin < D[b + 1]) target = b + 1;
    if (target < 4 && target >= ceiling) target = Math.max(b, ceiling - 1);
    if (target <= b && forced.has(b)) target = b + 1;
    dests[b] = target;
    if (target < 4) ceiling = Math.min(ceiling, target);
  }
  // Batter: first base (an infield hit / safe on a close play reaches here too: no out could be made)
  let bd = 1;
  if (bd >= ceiling) bd = Math.max(1, ceiling - 1);
  plan.batterDest = bd;

  // --- runner orders: you can send runners from the moment the ball is down until just before the fielder is ready to throw
  const outfield = f.type === 'OF';
  const sendFrom = plan.downT ?? tF;
  const sendBy = tReady - cfg.runner.sendLead;
  plan.send = sendBy - sendFrom >= cfg.runner.sendMin ? { from: sendFrom, by: sendBy } : null;
  const t0Of = (b) => (b === 0 ? cfg.runner.batterStart : rs(b) ?? readDelay(cfg, b) ?? cfg.runner.startDelay);
  const runners = [...order, 0].map((b) => {
    const to = b === 0 ? bd : dests[b];
    const t0 = t0Of(b);
    // on a ball to the outfield a runner rounds his base and waits just past it, ready to be sent on
    const kind = outfield && to > b && to < 4 ? 'round' : 'run';
    return { from: b, to, sent: false, spd: sp(b), legs: to > b ? [{ kind, from: b, to, t0, fromBag: false }] : [], t0 };
  });
  if (plan.send && ORD) {
    for (const o of ORD) {
      if (!(o.t >= plan.send.from - 1e-6 && o.t <= plan.send.by + 1e-6)) continue;
      sendRunner(runners, o.base, o.t, cfg);
    }
  }
  bd = runners.find((r) => r.from === 0).to;
  for (const r of runners) if (r.from > 0) dests[r.from] = r.to;
  const moveOf = (r) => {
    const m = { from: r.from, to: r.to, out: false, tStart: r.t0 };
    if (r.spd !== 1) m.spd = r.spd;
    if (r.legs.length > 1 || (r.legs[0] && r.legs[0].kind !== 'run') || (r.legs[0] && r.legs[0].t0 !== r.t0)) {
      if (r.legs.length === 1 && r.legs[0].kind === 'round') m.round = true;
      else m.legs = r.legs.map((L) => ({ ...L }));
      m.tStart = r.legs[0].t0;
    }
    if (r.sent) m.sent = true;
    return m;
  };
  plan.batterDest = bd;
  const earned = 1; // (the batter's hit is what he reached safely: first base, more if he makes it where he was sent)

  for (const r of runners) if (r.from > 0) plan.moves.push(moveOf(r));
  plan.moves.push(moveOf(runners.find((r) => r.from === 0)));

  const resultOf = (x) => (x === 4 ? 'insideParkHomer' : x === 3 ? 'triple' : x === 2 ? 'double' : 'single');
  plan.result = resultOf(bd);
  plan.infieldHit = plan.result === 'single' && f.type !== 'OF';

  // Ball movement after the pickup: the throw goes where an out can be made (the lead-most such runner), else to the base the lead
  // runner is heading for.
  let leadDest = bd;
  for (const b of order) leadDest = Math.max(leadDest, dests[b]);
  plan.leadDest = leadDest;
  plan.ctx.leadDest = leadDest;
  let tgtBase = Math.min(4, leadDest);
  for (const m of [...plan.moves].sort((a, b) => b.to - a.to)) {
    if (!m.sent || m.to <= m.from) continue; // (a runner who was not sent only took a base he was sure to reach)
    const arrive = mArrive(cfg, m, m.to);
    const tBall = D[m.to] - (m.to === 4 ? F.tagTime : 0); // (when the throw gets there)
    if (tBall + cfg.runner.sendTag + F.outMargin <= arrive) { tgtBase = m.to; break; }
  }
  plan.ctx.tgtBase = tgtBase;
  const relayNeeded = f.type === 'OF' && dist(pf.x, pf.z, BASE_XZ[tgtBase][0], BASE_XZ[tgtBase][1]) > F.relayDistance;
  const rp = { x: BASE_XZ[tgtBase][0], z: BASE_XZ[tgtBase][1] };
  const holdThrow = (thrower, tReadyT, way) => { // he holds the ball until the throw can reach the bag together with the man covering it
    const carry = plan.carries.find((c) => c.pos === thrower.pos && Math.abs(c.t1 - tReadyT) < 1e-6);
    if (carry) carry.t1 = Math.max(carry.t1, way.t0);
  };
  if (relayNeeded) {
    // cut-off man: nearest infielder standing 55% of the way back from the base
    const cx = rp.x + (pf.x - rp.x) * 0.5, cz = rp.z + (pf.z - rp.z) * 0.5;
    const recvGuess = coverer(tgtBase, f, defense);
    let cut = null;
    for (const pos of ['SS', '2B', '3B', '1B']) {
      if (pos === recvGuess.pos) continue;
      const q = defense[pos];
      const d = dist(q.x, q.z, cx, cz);
      if (!cut || d < cut.d) cut = { q, d };
    }
    const c = cut.q;
    const t1 = tReady + dist(pf.x, pf.z, cx, cz) / F.throwSpeed.OF;
    const t2 = t1 + F.relayTransfer;
    const way = coverOptions({ base: tgtBase, thrower: c, tReady: t2, from: { x: cx, z: cz } }, plan, defense, cfg).filter((o) => o.recv.pos !== c.pos)[0];
    const recv = way.recv;
    const t3 = way.t1;
    addMove(plan, c, cx, cz, Math.max(c.react + 0.3, t1 - 0.4), { role: 'relay', minEffort: 0.8 }, cfg);
    addMove(plan, recv, rp.x, rp.z, Math.max(way.coverStart + 0.05, t3), { role: 'cover', start: way.coverStart, vmax: way.speed, minEffort: 0.8 }, cfg);
    plan.throws.push({ from: f.pos, to: c.pos, t0: tReady, t1, ax: pf.x, az: pf.z, bx: cx, bz: cz, toBase: 0 });
    plan.throws.push({ from: c.pos, to: recv.pos, t0: way.t0, t1: t3, ax: cx, az: cz, bx: rp.x, bz: rp.z, toBase: tgtBase });
    plan.carries.push({ pos: c.pos, t0: t1, t1: way.t0 });
    plan.carries.push({ pos: recv.pos, t0: t3, t1: t3 + 99 });
    plan.events.push({ t: t3, type: 'throwEnd', pos: recv.pos, base: tgtBase });
    plan.ballEnd = t3;
  } else {
    const way = coverOptions({ base: tgtBase, thrower: f, tReady, from: { x: pf.x, z: pf.z }, tHave: tF, dive: !!(plan.fielderMoves[0] && plan.fielderMoves[0].dive) }, plan, defense, cfg)[0];
    const recv = way.recv;
    addMove(plan, recv, rp.x, rp.z, Math.max(way.coverStart + 0.05, way.tOut), { role: 'cover', start: way.coverStart, vmax: way.speed, minEffort: 0.8 }, cfg);
    if (way.self) {
      // he takes the ball to the bag himself
      const carry = plan.carries.find((c) => c.pos === f.pos && Math.abs(c.t1 - tReady) < 1e-6);
      if (carry) carry.t1 = way.tOut + 99;
      plan.events.push({ t: way.tOut, type: 'throwEnd', pos: recv.pos, base: tgtBase });
      plan.ballEnd = way.tOut;
    } else {
      holdThrow(f, tReady, way);
      plan.throws.push({ from: f.pos, to: recv.pos, t0: way.t0, t1: way.t1, ax: pf.x, az: pf.z, bx: rp.x, bz: rp.z, toBase: tgtBase });
      plan.carries.push({ pos: recv.pos, t0: way.t1, t1: way.t1 + 99 });
      plan.events.push({ t: way.t1, type: 'throwEnd', pos: recv.pos, base: tgtBase });
      plan.ballEnd = way.t1;
    }
  }

  // Settle the throw: a runner you sent to that base is out when the ball and a fielder get to the bag before he does (a tag, not
  // a force - except the batter at first), else he is safe (a close play gets the call).
  {
    const mv = plan.moves.find((q) => !q.out && q.sent && q.to === tgtBase && q.to > q.from);
    const tBall = plan.ballEnd;
    const recvPos = (plan.events.find((e) => e.type === 'throwEnd' && Math.abs(e.t - tBall) < 1e-6) || {}).pos;
    if (mv && recvPos) {
      const arrive = mArrive(cfg, mv, tgtBase);
      const tag = tgtBase === 1 ? 0 : cfg.runner.sendTag;
      if (tBall + tag + F.outMargin <= arrive) {
        mv.outBase = tgtBase; mv.to = 0; mv.out = true; mv.outAt = tBall; // (the tag goes on as he arrives: he is out by `tag` s at least)
        plan.events.push({ t: tBall, type: 'out', base: tgtBase, pos: recvPos, tag: tgtBase !== 1 });
        plan.outsMade = (plan.outsMade || 0) + 1;
        if (mv.from === 0) { plan.batterDest = 0; plan.result = resultOf(earned); plan.infieldHit = plan.result === 'single' && f.type !== 'OF'; }
        plan.sentOut = true;
        if (outs + plan.outsMade >= 3) plan.timePlay = true; // runs that crossed the plate before the tag still count
      } else if (mv.sent && tBall - arrive <= F.closePlay) plan.events.push({ t: Math.max(tBall, arrive) + 0.1, type: 'safe', base: tgtBase });
    }
  }

  // The play ends when every runner has stopped and the throw is in.
  let last = plan.ballEnd;
  for (const m of plan.moves) {
    if (m.out) { last = Math.max(last, m.outAt + 0.3); continue; }
    last = Math.max(last, mFinish(cfg, m));
  }
  plan.endTime = last + 0.35;
  return plan;
}

// You tapped base `base` at time `t`: the runner on his way to (or holding at) the base before it is sent on to it; a runner ahead
// of him who would be in the way is sent on one base too. A runner who has not yet started to pull up simply keeps going; one who
// has, finishes pulling up (on the bag, or just past it if he was rounding it) and sets off again.
function sendRunner(runners, base, t, cfg) {
  if (base < 2 || base > 4) return;
  const r = runners.find((q) => q.to === base - 1);
  if (!r) return;
  const ahead = base < 4 ? runners.find((q) => q !== r && q.to === base) : null; // (any number of runners can score)
  if (ahead) sendRunner(runners, base + 1, t, cfg);
  if (ahead && ahead.to === base) return; // (he could not be moved on - nobody passes anybody)
  const tAct = t + cfg.runner.sendReact;
  const mv = { spd: r.spd };
  r.sent = true;
  r.to = base;
  if (!r.legs.length) { r.legs.push({ kind: 'run', from: r.from, to: base, t0: Math.max(tAct, r.t0), fromBag: false }); return; }
  const L = r.legs[r.legs.length - 1];
  const cand = L.kind === 'resume' ? { ...L, to: base } : { kind: 'run', from: L.from, to: base, t0: L.t0, fromBag: L.fromBag };
  const pL = legProfile({ ...L, last: false }, mv, cfg);
  const pC = legProfile({ ...cand, last: false }, mv, cfg);
  if (tAct - L.t0 <= sameUntil(pL, pC)) { r.legs[r.legs.length - 1] = cand; return; }
  const tGo = Math.max(tAct, L.t0 + pL.duration);
  if (L.kind === 'round') r.legs.push({ kind: 'resume', from: L.from, to: base, s0: pL.sEnd, t0: tGo, fromBag: L.fromBag });
  else r.legs.push({ kind: 'run', from: L.to, to: base, t0: tGo, fromBag: true });
}

// ---------------------------------------------------------------------------
// Runner timeline helper for the renderer: where is a runner at time t?
// move = { from, to, out, outAt, tStart } . Returns { x, z, base progress, running }
// ---------------------------------------------------------------------------
export function runnerPosition(move, t, cfg = CONFIG) {
  const r = runnerState(move, t, cfg, {});
  return { x: r.x, z: r.z, heading: r.heading, running: r.running, done: r.done, speed: r.speed, accel: r.accel, distance: r.s, total: r.total };
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
