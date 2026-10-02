// Fielding + baserunning planner.
// Given a batted ball (its full simulated flight) and the defense, this decides - deterministically -
// who catches / fields it, whether throws beat runners, and how far every runner goes. It produces a
// "plan": a timeline (seconds after contact) the renderer simply plays back.
import { CONFIG } from '../config.js';
import { sampleBall, judgeFairFoul, battedBallType } from '../physics/ballistics.js';
import { BASE_XZ, polar, fenceDistance, sprayOf, clampToField, distanceToWall, isInsideField, wallClearance } from '../physics/field.js';
import { runnerArrival, runnerFinish, runnerState, runnerProfile, retreatArrival, moveArrival, moveFinish, extendLegs, backLegs } from './runnerMotion.js';
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

/** Puts the infielders where they stand for this situation (holding a runner on, double-play depth) - see fielding.align. */
export function alignDefense(defense, bases, outs, cfg = CONFIG) {
  const F = cfg.fielding, A = F.align;
  for (const pos of POSITIONS) {
    const f = defense[pos];
    if (f.baseX === undefined) { f.baseX = f.homeX; f.baseZ = f.homeZ; }
    let [x, z] = [f.baseX, f.baseZ];
    if (pos === '1B' && bases[0] && !bases[1]) [x, z] = A.hold1B;
    if ((pos === 'SS' || pos === '2B') && bases[0] && outs < 2) [x, z] = A.dpDepth[pos];
    f.x = f.homeX = x; f.z = f.homeZ = z;
  }
  return defense;
}

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

// How close does anybody come to catching a ball in the air that nobody catches? The fewest feet any fielder is short of it at any
// moment it could be caught (Infinity: never catchable). A ball nobody gets near is a plain hit that runners read at once.
function airShortfall(sim, defense, cfg) {
  const F = cfg.fielding;
  const tEnd = Math.min(sim.contactTime, sim.duration);
  let best = Infinity;
  for (let t = 0.3; t <= tEnd + 1e-6; t += 1 / 60) {
    const b = sampleBall(sim, t);
    if (b.y > F.reachHeight || b.y < 0.5) continue;
    for (const pos of POSITIONS) {
      const f = defense[pos];
      const short = dist(f.x, f.z, b.x, b.z) - F.glove - (b.y <= 5.2 ? F.diveExtra : 0) - covered(f.speed * effort(f, b.x, b.z), t - f.react, F.accel);
      if (short < best) best = short;
    }
  }
  return best;
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
  const glove = F.groundGlove * (1 - 0.12 * fast);
  const diveX = F.groundDive * (1 - 0.75 * fast);
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

// A ground ball that gets through the infield: the infielder who came closest goes for it anyway - a lunge, or a dive if it was
// close - so a ball that skips past him looks like a hit, not like a man watching an easy out go by. (Picture only.)
function infieldAttempt(plan, sim, defense, cfg) {
  const F = cfg.fielding;
  let best = null;
  for (const pos of INFIELDERS) {
    const q = defense[pos];
    for (let t = Math.max(0.2, sim.contactTime); t < 2.6; t += 0.03) {
      const b = sampleBall(sim, t);
      if (b.y > F.groundHeight) continue;
      const need = dist(q.x, q.z, b.x, b.z) - F.groundGlove;
      const can = covered(q.speed, Math.max(0, t - q.react - F.fastBallPenalty * 0.5), F.accel);
      if (!best || need - can < best.miss) best = { q, t, b, miss: need - can, can };
    }
  }
  if (!best || best.miss > F.attemptMiss) return;
  addMove(plan, best.q, best.b.x, best.b.z, best.t, { role: 'attempt', dive: best.miss > 0.5 && best.b.y < 2.5, avail: Math.max(0.5, best.can), minEffort: 1 }, cfg);
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
  // A play planned again after you gave a runner an order: up to the moment the fielders could see it (PREV.tCut) everybody does
  // exactly what he was doing; a job that is new or different only starts then, from wherever he has got to. (A run to the same
  // spot he was already running to before then is kept exactly as it was.)
  let reuse = null;
  if (PREV && !runs.prefixed) {
    const ok = (PREV.paths[f.pos] || [])[runs.length];
    if (ok && ok.req && !ok.prefixCut && ok.tStart < PREV.tCut && Math.abs(ok.req[0] - toX) < 0.01 && Math.abs(ok.req[1] - toZ) < 0.01) reuse = { ...ok, segs: ok.segs.map((g) => ({ ...g })) };
  }
  if (PREV && !runs.prefixed && !reuse) {
    const old = PREV.paths[f.pos] || [];
    const k = runs.length;
    const start0 = Math.max(opts.start ?? f.react, k ? runs[k - 1].tStop : 0);
    const o = old[k];
    const same = o && o.req && !o.prefixCut && Math.abs(o.req[0] - toX) < 0.01 && Math.abs(o.req[1] - toZ) < 0.01 && Math.abs(o.req[2] - tArrive) < 0.01 && Math.abs(o.req[3] - (opts.start ?? -1)) < 0.01;
    if (!same && o && o.tStart < PREV.tCut) {
      for (let j = k; j < old.length && old[j].tStart < PREV.tCut; j++) {
        const r = { ...old[j], segs: old[j].segs.map((g) => ({ ...g })) };
        if (r.tStop > PREV.tCut && !r.dive) { cutRun(r, PREV.tCut); r.prefixCut = true; }
        runs.push(r);
      }
      runs.prefixed = true;
      opts = { ...opts, start: Math.max(opts.start ?? 0, PREV.tCut), cut: false };
      tArrive = Math.max(tArrive, PREV.tCut + 0.3);
    } else if (!same && start0 < PREV.tCut) { opts = { ...opts, start: PREV.tCut }; tArrive = Math.max(tArrive, PREV.tCut + 0.3); } // (a job he did not have before)
    else if (!same && opts.start !== undefined && opts.start < PREV.tCut) opts = { ...opts, start: PREV.tCut }; // (nor does a new turn in a job start before then)
  }
  const prev = runs[runs.length - 1];
  // `cut`: he heads off from wherever the last run has got him at `start` (the last run is cut short there) instead of
  // first coming to a full stop - a fielder who has the ball turns for the bag at once
  if (opts.cut && prev && opts.start !== undefined && opts.start < prev.tStop && opts.start > prev.tStart && !prev.dive) cutRun(prev, opts.start); // (never before that run has even begun)
  const x0 = prev ? prev.xStop : f.x, z0 = prev ? prev.zStop : f.z;
  const vmax = opts.vmax ?? f.speed * effort(f, toX, toZ);
  let tStart = opts.start ?? f.react;
  if (prev) tStart = Math.max(tStart, prev.tStop);
  tStart = Math.min(tStart, Math.max(prev ? prev.tStop : 0, tArrive - 0.05)); // (never before his last run is over)
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
    const ux = (bx - ax) / d, uz = (bz - az) / d;
    let w = distanceToWall(ax, az, ux, uz, F.wallBody);
    // (running along a wall at a glancing angle he can come close to it without heading into it: walk the line and stop where it gets too close)
    for (let s = Math.max(0, atLeast); s < Math.min(w, d + 40); s += 0.5) if (wallClearance(ax + ux * s, az + uz * s) < F.wallBody + 0.05) { w = s; break; }
    return Number.isFinite(w) ? Math.max(w, atLeast) : undefined;
  };
  [x1, z1] = clampToField(x1, z1, F.wallMargin);
  let run = reuse || (opts.dive
    ? planDiveRun({ x0, z0, px: toX, pz: toZ, tStart, tCatch: tArrive, vmax, accel: vmax / F.accel, brake: F.brake, dive: F.dive, limitS: wallLimit(x0, z0, toX, toZ, dist(x0, z0, toX, toZ) - F.dive.armReach + 0.5) })
    : null);
  // (`stop`: he pulls up ON the spot - a man covering a bag who has to wait there for the runner - instead of running through it)
  let limitS = wallLimit(x0, z0, x1, z1, dist(x0, z0, x1, z1) + 0.4);
  if (opts.stop) limitS = Math.min(limitS ?? Infinity, dist(x0, z0, x1, z1) + 0.25);
  if (!run) run = planRun({ x0, z0, x1, z1, tStart, tArrive: Math.max(tArrive, tStart + 0.05), vmax, accel: vmax / (opts.accelTime ?? F.accel), brake: F.brake, minEffort: opts.minEffort ?? F.minRunEffort, heading: Math.atan2(toX - x0, toZ - z0), limitS, wallBrake: F.wallBrake });
  if (!reuse) run.req = [toX, toZ, tArrive, opts.start ?? -1]; // (what was asked for: see the re-plan check above)
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
  let x0 = last ? last.xStop : q.x, z0 = last ? last.zStop : q.z;
  let t0 = last ? Math.max(tStart, last.tStop) : tStart;
  // (a play planned again: see addMove - a run he was already making to this bag is kept as it was; anything else only starts once the
  // fielders saw your order, from wherever his earlier runs had taken him by then)
  if (PREV && !(runs && runs.prefixed)) {
    const old = PREV.paths[q.pos] || [];
    const k = runs ? runs.length : 0;
    const o = old[k];
    if (o && o.req && !o.prefixCut && o.tStart < PREV.tCut && dist(o.req[0], o.req[1], BASE_XZ[base][0], BASE_XZ[base][1]) < 2.5) {
      return { t: Math.max(tStart, o.tReach ?? o.tStop), speed: o.vmax || q.speed, start: o.tStart };
    }
    if ((o && o.tStart < PREV.tCut) || t0 < PREV.tCut) {
      if (old.length) { const p = samplePath(old, Math.max(PREV.tCut, last ? last.tStop : 0)); x0 = p.x; z0 = p.z; }
      t0 = Math.max(t0, PREV.tCut);
    }
  }
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
    if (d <= (first ? F.cover.firstMaxCarry : F.cover.maxCarry)) out.push({ recv: thrower, self: true, cut: !!cut, tagged: tag > 0, tOut, t1: tOut, t0: start, tCover: tOut, coverStart: start, speed: carry, score: tOut - (closeEnough ? (first ? F.cover.firstSelfBonus : F.cover.selfBonus) : 0) });
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
  plan.landDepth = landDepth(sim);

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
    if (!i.simple) {
      // (the diamond is up while it is in the air, as on any ball - a tap changes nothing: everybody trots home)
      const recs = makeRecords(bases, new Set(), () => [{ kind: 'run', from: 0, to: 0, t0: 0 }], [{ kind: 'run', from: 0, to: 1, t0: 0 }]);
      plan.send = { from: cfg.runner.sendFrom, by: sim.homerun.t, res: sim.homerun.t + 1, pre: viewOf(recs, cfg), post: null };
    }
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
    // the infield fly rule: runners on first and second (or the bases loaded), fewer than two outs, an infielder settling under a
    // high pop-up - the batter is out whether it is caught or not (so a dropped one cannot be turned into a cheap double play)
    const IF = F.infieldFly;
    const infieldFly = fair && !i.simple && outs < 2 && !!bases[0] && !!bases[1] && f.type !== 'OF' && sim.apex.y >= IF.apex && Math.hypot(air.ball.x, air.ball.z) < IF.range;
    if (infieldFly) { plan.infieldFly = true; plan.notes.push('infield fly'); plan.events.push({ t: Math.max(0.6, air.t - IF.callBefore), type: 'infieldFly' }); }
    // a dropped fly ball (rare): it hits the glove and pops out; he picks it up and the runners take what they can
    if (fair && !i.simple && errorHappens(i, F.errors.fly * (air.dive || plan.leap ? F.errors.hardFactor : 1))) {
      if (infieldFly) return infieldFlyDrop(plan, i, f, air, bases, cfg);
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
      if (!i.simple) { runnersGoBack(plan, f, air, type, bases, outs, defense, cfg); caughtRunners(plan, i, f, air, type, bases, outs, defense, cfg); }
      return plan;
    }
    plan.result = sim.apex.y <= 24 ? 'lineout' : (type === 'pop' || sim.apex.y >= 75) && Math.hypot(air.ball.x, air.ball.z) < 150 ? 'popout' : 'flyout';
    plan.outsMade = 1;
    plan.batterDest = 0;
    plan.endTime = air.t + 0.9;
    if (i.simple) return plan;
    runnersGoBack(plan, f, air, type, bases, outs, defense, cfg);
    caughtRunners(plan, i, f, air, type, bases, outs, defense, cfg);
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
    if (!i.simple) {
      // you can send runners while it is in the air (it may stay fair): a runner you sent goes, sees it is foul and comes back
      const R = cfg.runner;
      const forced = new Set();
      if (bases[0]) { forced.add(1); if (bases[1]) { forced.add(2); if (bases[2]) forced.add(3); } }
      const recs = makeRecords(bases, forced, (b) => [{ kind: 'run', from: b, to: b, t0: 0 }], [{ kind: 'run', from: 0, to: 0, t0: 0 }]);
      const dead = plan.ballHitEnd;
      for (const o of ORD || []) if (o.t >= R.sendFrom && o.t < dead) applyOrder(recs, o, cfg);
      plan.send = { from: R.sendFrom, by: dead, res: dead + 1, pre: viewOf(recs, cfg), post: null };
      for (const r of recs) {
        if (r.from === 0 || !r.sent || plan.moves.some((m) => m.from === r.from)) continue;
        const tStart = r.legs[0].t0;
        const backAt = Math.max(tStart + 0.2, dead + R.downReact);
        plan.moves.push({ from: r.from, to: r.from, back: true, tStart, backAt });
        plan.endTime = Math.max(plan.endTime, retreatArrival(cfg, r.from, tStart, backAt, r.spd) + 0.25);
      }
    }
    return plan;
  }

  // ---------------- ground-rule double: it bounced in the field and went over the wall ----------------
  if (sim.groundRule && fair && !sim.homerun) {
    plan.groundRule = true;
    plan.result = 'double';
    plan.batterDest = 2;
    plan.ballHitEnd = sim.standsLanding ? sim.standsLanding.t : sim.duration;
    const end = sim.groundRule;
    let best = null;
    for (const pos of ['LF', 'CF', 'RF']) { const f = defense[pos]; const d = dist(f.x, f.z, end.x, end.z); if (!best || d < best.d) best = { f, d }; }
    const [wx, wz] = clampToField(end.x, end.z, F.wallMargin + 2.2);
    addMove(plan, best.f, wx, wz, Math.max(best.f.react + 0.4, Math.min(end.t, best.f.react + Math.hypot(best.f.x - wx, best.f.z - wz) / best.f.speed)), { watch: true, role: 'watch', minEffort: 0.6 }, cfg);
    plan.fielder = best.f.pos;
    // everybody is awarded two bases (from where he was when the ball was hit)
    let tEnd = end.t;
    for (let b = 3; b >= 1; b--) {
      if (!bases[b - 1]) continue;
      const to = Math.min(4, b + 2);
      const m = { from: b, to, out: false };
      if (rs(b) !== undefined) m.tStart = rs(b); // (a runner going with the pitch is already on his way)
      plan.moves.push(m);
      tEnd = Math.max(tEnd, arrivalAt(cfg, b, to, m.tStart));
    }
    plan.moves.push({ from: 0, to: 2, out: false });
    tEnd = Math.max(tEnd, arrivalAt(cfg, 0, 2, R.batterStart));
    plan.endTime = tEnd + 0.8;
    plan.events.push({ t: end.t, type: 'groundRule', x: end.x, z: end.z });
    if (!i.simple) {
      const recs = makeRecords(bases, new Set(), () => [{ kind: 'run', from: 0, to: 0, t0: 0 }], [{ kind: 'run', from: 0, to: 1, t0: 0 }]);
      plan.send = { from: R.sendFrom, by: end.t, res: end.t + 1, pre: viewOf(recs, cfg), post: null };
    }
    plan.notes.push('ground-rule double');
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
  if (f.type === 'OF' && fair) infieldAttempt(plan, sim, defense, cfg);
  plan.downT = Math.min(sim.firstBounce ? sim.firstBounce.t : Infinity, sim.wallHit ? sim.wallHit.t : Infinity, tF); // (the ball is down)
  // (until then the runners do what they do on any ball in the air - unless nobody gets anywhere near it: then they see it is a hit
  // as soon as it is past the infield and go)
  if (AIR[type]) plan.airRes = !i.simple && airShortfall(sim, defense, cfg) > cfg.runner.sureHitFeet ? Math.min(plan.downT, cfg.runner.sureHitRead) : plan.downT;
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
  for (const m of plan.moves) if (m.out && m.walkOff && m.outAt !== undefined) end = Math.max(end, m.outAt + cfg.runner.outLinger); // (a tag out stays on screen)
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
// The play as it was planned before your latest order: { paths, tCut } (see addMove). Only set while planPlay runs.
let PREV = null;
const readDelay = (cfg, from) => (from >= 1 && READ > 0 && rs(from) === undefined ? cfg.runner.startDelay + READ : undefined);
const arrivalAt = (cfg, from, to, tStart, kind = 'run') => runnerArrival(cfg, from, to, tStart ?? readDelay(cfg, from), kind, sp(from));
const finishAt = (cfg, from, to, tStart, kind = 'run') => runnerFinish(cfg, from, to, tStart ?? readDelay(cfg, from), kind, sp(from));
// the same for a whole plan move (a runner who was sent on has legs; one rounding a base runs a different route)
const mArrive = (cfg, m, base) => (m.legs || m.round ? moveArrival(cfg, m, base) : arrivalAt(cfg, m.from, base, m.tStart));
const mFinish = (cfg, m) => (m.legs || m.round ? moveFinish(cfg, m) : finishAt(cfg, m.from, m.to, m.tStart));

// Give every runner move of a going runner his real start; one who ends up staying put has to go back to his base.
function runningStarts(plan, cfg) {
  for (const m of plan.moves) {
    if (!(m.from >= 1) || rs(m.from) === undefined || m.back || m.trot || m.legs) continue; // (a move with legs has its own timing)
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

// ---------------------------------------------------------------------------
// Runner ORDERS (you tap a base on the diamond): `i.orders` = [{ base, t, from?, back? }] in the order given, t = seconds after
// contact. A plain order sends the runner heading for the base before `base` on to it (a runner ahead who is in the way goes on
// too); `back` calls a runner you sent to `base` back to the base before it. You can give orders from the moment the ball is hit
// (plan.send) - on a ball in the air every runner does exactly the same until it is caught or comes down, so nothing on the field
// or on the diamond gives away a catch.
//
// While a play is planned each runner is a record { from, to, legs, spd, sent, sentTo, recalled, forced, lockAt }: `to` = the base
// he is going to end up on as things stand, `legs` = how he moves (runnerMotion.js), `sentTo` = the base you sent him to.
// ---------------------------------------------------------------------------
const AIR = { fly: 'fly', pop: 'fly', line: 'line' };
// How deep a ball in the air comes down (the same number whether or not it is caught, so the runners' first moves are the same).
const landDepth = (sim) => { const p = sim.firstBounce || sim.wallHit || sim.homerun || sim.standsLanding; return p ? Math.hypot(p.x, p.z) : 0; };
const recMove = (r) => ({ from: r.from, to: r.to, legs: r.legs, spd: r.spd, tStart: r.legs.length ? r.legs[0].t0 : undefined });
const recArrive = (cfg, r, base) => (r.legs.length ? moveArrival(cfg, recMove(r), base) : undefined);
const cloneRec = (r) => ({ ...r, legs: r.legs.map((L) => ({ ...L })) });

// What runner `b` does on a ball in the air before anybody knows whether it is caught (the same either way). `deep`: it comes down
// deep in the outfield (runners on second tag up, like the man on third).
function airLegs(b, kind, outs, depth, cfg) {
  const R = cfg.runner;
  if (outs >= 2) return [{ kind: 'run', from: b, to: Math.min(4, b + 1), t0: R.startDelay }]; // (two outs: he runs on contact)
  if (b === 3 || (b === 2 && depth > R.tagDepth)) return backLegs([{ kind: 'run', from: b, to: b, t0: 0 }], b, b, R.startDelay + R.tagBack, cfg, sp(b)); // back to the bag to tag up
  if (kind === 'line') return [{ kind: 'half', from: b, to: b, frac: R.halfwayLine, t0: R.startDelay + R.read.line }]; // (a liner: a step or two)
  // he goes off the bag only as far as he can surely get back from: a step on a pop-up, about halfway on a deep fly
  const [d0, d1] = R.halfwayDepth;
  const frac = R.stayStep + (R.halfway - R.stayStep) * Math.max(0, Math.min(1, (depth - d0) / (d1 - d0)));
  return [{ kind: 'half', from: b, to: b, frac: +frac.toFixed(3), t0: R.startDelay }];
}

// The runner records for a play: every runner on base who is not already going with the pitch, plus the batter (`batter` = his legs,
// or null when he is out on the play anyway).
function makeRecords(bases, forced, legsOf, batter) {
  const recs = [];
  for (const b of [3, 2, 1]) {
    if (!bases[b - 1] || rs(b) !== undefined) continue;
    recs.push({ from: b, to: forced.has(b) ? b + 1 : b, legs: legsOf(b), spd: sp(b), sent: false, sentTo: null, recalled: false, forced: forced.has(b) });
  }
  recs.push({ from: 0, to: 1, legs: batter || [], spd: sp(0), sent: false, sentTo: null, recalled: false, forced: true, lockAt: batter ? undefined : -1 });
  return recs;
}
const live = (r, t) => !(r.lockAt !== undefined && t >= r.lockAt) && !r.out;

// Can runner `r` (sent to r.sentTo) still be called back at time t? (not if he is forced there, not if a runner behind is on his way
// to the base he would go back to, not once he is there)
function canBack(recs, r, t, cfg) {
  if (r.out || !live(r, t)) return false;
  const back = r.to - 1;
  if (back < (r.forced ? r.from + 1 : r.from) || back < 1 && r.from === 0) return false; // (not below the bag he started from - or must reach)
  return !recs.some((q) => q !== r && q.from < r.from && live(q, t) && q.to >= back); // (nobody passes anybody)
}

function applyOrder(recs, o, cfg) {
  const R = cfg.runner;
  const tAct = o.t + R.sendReact;
  if (o.tag !== undefined) {
    // tag up (back to the bag now, and off when it is caught) - or not
    const r = recs.find((q) => q.from >= 1 && q.from === o.from && live(q, o.t));
    if (!r) return;
    r.tag = !!o.tag; r.lastOrderAt = o.t;
    if (r.tag) { r.sent = false; r.sentTo = null; if (!r.forced) r.to = r.from; backLegs(r.legs, r.from, r.from, tAct, cfg, r.spd); }
    return;
  }
  if (o.back) {
    const r = recs.find((q) => q.to === o.base && live(q, o.t) && (o.from === undefined || q.from === o.from));
    if (!r || !canBack(recs, r, o.t, cfg)) return;
    r.sentTo = null; r.recalled = true; r.to = o.base - 1; r.lastOrderAt = o.t;
    backLegs(r.legs, r.from, o.base - 1, tAct, cfg, r.spd);
    return;
  }
  if (!(o.base >= 1 && o.base <= 4)) return;
  const r = recs.find((q) => q.to === o.base - 1 && live(q, o.t) && (o.from === undefined || q.from === o.from)) || recs.find((q) => q.to === o.base - 1 && live(q, o.t));
  if (!r || !r.legs.length) return;
  const ahead = o.base < 4 ? recs.find((q) => q !== r && q.to === o.base && live(q, o.t)) : null; // (any number of runners can score)
  if (ahead) applyOrder(recs, { base: o.base + 1, t: o.t }, cfg);
  if (ahead && ahead.to === o.base) return; // (he could not be moved on - nobody passes anybody)
  r.sent = true; r.sentTo = o.base; r.recalled = false; r.to = o.base; r.tag = false; r.lastOrderAt = o.t;
  if (r.firstSentAt === undefined) r.firstSentAt = o.t;
  extendLegs(r.legs, r.from, o.base, tAct, cfg, r.spd);
}

// What the diamond shows (see sendOptions): per runner, the base he is going to, the base you sent him to and when he gets there.
function viewOf(recs, cfg, tagOk = false) {
  return recs.map((r) => ({
    from: r.from, goal: r.to, sentTo: r.sentTo, tSent: r.sentTo ? recArrive(cfg, r, r.sentTo) ?? Infinity : 0,
    out: !!r.out, outAt: r.outAt, lockAt: r.lockAt, backOk: canBack(recs, r, -1, cfg), tag: r.tag, tagOk: tagOk && r.from >= 1 && !r.out,
    behind: recs.filter((q) => q !== r && q.from < r.from).map((q) => q.from),
  }));
}

/**
 * Every runner you can give an order to right now (t = seconds after contact), lead runner first: { from, goal (the base he is going
 * to end up on as things stand), sent (you sent him there), send (the base a Go takes him to, or null), back (the base a Back takes him
 * to, or null), tag (true / false / undefined = he decides by himself), canTag }.
 */
export function runnerOptions(plan, t, cfg = CONFIG) {
  const S = plan && plan.send;
  if (!S || !(t >= S.from && t <= S.by)) return [];
  const view = S.res !== undefined && t < S.res && S.pre ? S.pre : S.post;
  if (!view) return [];
  const gone = (q) => (q.lockAt !== undefined && t >= q.lockAt) || (q.out && q.outAt !== undefined && t >= q.outAt);
  const out = [];
  for (const v of [...view].sort((a, b) => b.from - a.from)) {
    if (gone(v)) continue;
    out.push({
      from: v.from, goal: v.goal, sent: !!v.sentTo, out: !!v.out,
      send: !v.out && v.goal < 4 ? v.goal + 1 : null,
      back: !v.out && v.backOk ? v.goal - 1 : null,
      tag: v.tag, canTag: !!v.tagOk && t < (S.res ?? Infinity),
    });
  }
  return out;
}

/**
 * The bases you can tap right now (t = seconds after contact): [{ base, from, kind: 'send' | 'back' }]. A runner you sent can be
 * called back by tapping the base he is heading for again, until he is there.
 */
export function sendOptions(plan, t, cfg = CONFIG) {
  const S = plan && plan.send;
  if (!S || !(t >= S.from && t <= S.by)) return [];
  const view = S.res !== undefined && t < S.res && S.pre ? S.pre : S.post;
  if (!view) return [];
  const out = [];
  const taken = new Set();
  const goalOf = (v) => v.goal;
  for (const v of [...view].sort((a, b) => b.from - a.from)) {
    if (v.out && v.outAt !== undefined && t >= v.outAt) continue;
    if (v.lockAt !== undefined && t >= v.lockAt) continue;
    if (v.sentTo && v.backOk && t + cfg.runner.sendReact < v.tSent && !view.some((q) => v.behind.includes(q.from) && !(q.lockAt !== undefined && t >= q.lockAt) && goalOf(q) >= v.sentTo - 1)) {
      out.push({ base: v.sentTo, from: v.from, kind: 'back' });
      taken.add(v.sentTo);
    }
    if (v.out) continue;
    const g = goalOf(v);
    if (g >= 0 && g < 4 && !taken.has(g + 1)) { out.push({ base: g + 1, from: v.from, kind: 'send' }); taken.add(g + 1); }
  }
  return out.sort((a, b) => a.base - b.base);
}

// A record back into a plan move.
function recToMove(r) {
  const m = { from: r.from, to: r.to, out: false };
  const L = r.legs;
  if (L.length === 1 && L[0].kind === 'run') { m.tStart = L[0].t0; if (L[0].to <= L[0].from) m.to = r.to; }
  else if (L.length === 1 && L[0].kind === 'round') { m.round = true; m.tStart = L[0].t0; }
  else if (L.length) { m.legs = L.map((q) => ({ ...q })); m.tStart = L[0].t0; }
  if (r.spd !== 1) m.spd = r.spd;
  if (r.sent) { m.sent = true; m.sentTo = r.sentTo ?? r.to; }
  if (r.recalled) m.recalled = true;
  if (r.auto) m.auto = true;
  if (r.wasSent) m.wasSent = true;
  if (r.out) { m.to = 0; m.out = true; m.outAt = r.outAt; m.outBase = r.outBase; m.walkOff = true; }
  return m;
}

// A runner is tagged (or doubled off) at `base`: the out is made as he gets there - the tag goes on him as he slides in - and the
// play goes on long enough to see it and to see him walk off.
function tagRunner(plan, r, base, way, cfg, tagged = true) {
  const arrive = recArrive(cfg, r, base) ?? way.tOut;
  const tOut = tagged ? Math.max(way.tOut, Math.min(arrive - cfg.runner.tagLead, way.tOut + 2)) : way.tOut; // (doubled off: the bag is touched, no tag)
  const ev = [...plan.events].reverse().find((e) => e.type === 'out' && e.base === base && Math.abs(e.t - way.tOut) < 1e-6);
  if (ev) ev.t = tOut;
  r.out = true; r.outAt = tOut; r.outBase = base; r.to = 0;
  plan.outsMade = (plan.outsMade || 0) + 1;
  if (r.sent || r.recalled || r.wasSent) plan.sentOut = true;
  plan.outNote = { base, from: r.from };
  plan.endTime = Math.max(plan.endTime, tOut + cfg.runner.outLinger);
}

// One more throw after the play's main one: whoever has the ball goes after a runner you sent (or called back) if he can get him.
function followUpThrow(plan, recs, holder, at, tHave, outs, defense, cfg, skip = null) {
  if (outs + plan.outsMade >= 3 || !holder) return false;
  const F = cfg.fielding, R = cfg.runner;
  const cands = recs.filter((r) => !r.out && r !== skip && (r.sent || r.recalled || r.wasSent || r.tagUp) && r.to >= 1 && r.to <= 4 && (r.to > r.from || r.recalled || r.wasSent)).sort((a, b) => b.to - a.to);
  for (const r of cands) {
    const base = r.to;
    const arrive = recArrive(cfg, r, base);
    if (arrive === undefined || arrive <= tHave + 0.2) continue;
    const near = dist(at.x, at.z, BASE_XZ[base][0], BASE_XZ[base][1]) < 3;
    if (near) continue; // (he is standing on that bag already: the runner went back to it before he got there - nothing to throw)
    const tReady = tHave + F.relayTransfer;
    const tag = base === 1 && r.from === 0 && !r.recalled ? 0 : R.sendTag;
    const coverStart = r.lastOrderAt > 0 ? Math.max(F.cover.start, r.lastOrderAt + R.sendReact + F.reaction.IF) : undefined; // (they go when they see him go)
    const way = coverOptions({ base, thrower: holder, tReady, from: at, runnerT: arrive, tag, coverStart }, plan, defense, cfg).filter((w) => !w.self)[0];
    if (!way) continue;
    for (const c of plan.carries) if (c.pos === holder.pos && c.t0 <= tReady + 1e-6 && c.t1 > tReady) c.t1 = way.t0;
    planOut(plan, way, base, holder, at, tReady, cfg, 'cover', true);
    tagRunner(plan, r, base, way, cfg);
    plan.ballEnd = Math.max(plan.ballEnd || 0, way.t1);
    return true;
  }
  return false;
}

// A ball caught in the air: what the runners do. Until the catch they did what they do on every ball in the air (airLegs, and your
// orders); at the catch everyone off his bag goes back to it (a runner you sent may be doubled off), then runners tag up - the man on
// third on a fly deep enough by himself, anybody you send - and a throw may get one of them.
function caughtRunners(plan, i, f, air, type, bases, outs, defense, cfg) {
  const R = cfg.runner, F = cfg.fielding;
  const tC = air.t;
  const depthLand = landDepth(i.sim) || Math.hypot(air.ball.x, air.ball.z);
  const kind = AIR[type] || 'line';
  const forced = new Set();
  if (bases[0]) { forced.add(1); if (bases[1]) { forced.add(2); if (bases[2]) forced.add(3); } }
  const recs = makeRecords(bases, forced, (b) => airLegs(b, kind, outs, depthLand, cfg), [{ kind: 'run', from: 0, to: 1, t0: R.batterStart }]);
  recs[recs.length - 1].lockAt = tC; // (the batter is out at the catch: he is here only so the diamond looks the same as on a hit)
  const orders = (ORD || []).filter((o) => o.t >= R.sendFrom - 1e-6).sort((a, b) => a.t - b.t);
  const by = tC + R.tagWindow;
  plan.send = { from: R.sendFrom, by, res: tC };
  // (a runner standing on his bag to tag up - the man on third, or second on a deep fly - who is told to go before the catch tags up
  // and goes as it is caught: he does not leave early and have to come back)
  const tagStance = (from) => kind === 'fly' && outs < 2 && (from === 3 || (from === 2 && depthLand > R.tagDepth));
  for (const o of orders) {
    if (o.t >= tC) continue;
    applyOrder(recs, !o.back && o.tag === undefined && tagStance(o.from) ? { ...o, tag: true } : o, cfg);
  }
  plan.send.pre = viewOf(recs, cfg, outs < 2);
  const runners = recs.filter((r) => r.from > 0);
  if (outs + 1 >= 3) {
    // the third out: the inning is over - runners who were going ease up
    for (const r of runners) {
      const m = recToMove(r);
      m.to = r.from; m.stopAt = tC + R.easeUpReact;
      plan.moves.push(m);
    }
    plan.send.post = viewOf(recs.map((r) => ({ ...r, lockAt: tC })), cfg);
    return;
  }
  // the catch: everybody gets back to his own bag
  for (const r of runners) {
    const off = r.to > r.from || r.legs.some((L) => L.kind === 'half' || (L.kind === 'run' && L.to > L.from) || L.kind === 'round' || L.kind === 'resume');
    if (r.sent) r.wasSent = true;
    r.sent = false; r.sentTo = null; r.recalled = false; r.to = r.from; r.forced = false;
    if (off) backLegs(r.legs, r.from, r.from, tC + R.downReact, cfg, r.spd);
    const Lz = r.legs[r.legs.length - 1];
    if (Lz && Lz.kind === 'path' && Lz.toBase !== r.from) r.to = Lz.toBase; // (called back to a bag ahead of him just before the catch: he stays there)
  }
  // tag-ups the runner makes by himself (a sure thing only): third on a fly deep enough, second on a deep one with third open
  const fair = plan.fair;
  if (fair && kind === 'fly') {
    const home = BASE_XZ[4];
    const tR = tC + F.transfer[f.type];
    const throwTo = (base) => tR + throwTime(dist(air.ball.x, air.ball.z, BASE_XZ[base][0], BASE_XZ[base][1]), f, cfg) + (base === 4 ? F.tagTime : 0);
    const auto = (r, base, margin) => {
      const hyp = cloneRec(r);
      extendLegs(hyp.legs, r.from, base, Math.max(tC + R.tagReact, (recArrive(cfg, r, r.from) ?? 0) + 0.05), cfg, r.spd);
      if (recArrive(cfg, hyp, base) < throwTo(base) - margin) { r.legs = hyp.legs; r.to = base; r.tagUp = true; r.sentTo = base; return true; }
      return false;
    };
    // (a runner you told not to tag up stays; one you told to tag up goes whatever happens - below)
    const r3 = runners.find((r) => r.from === 3 && !r.wasSent && r.tag === undefined);
    if (r3 && depthLand > 170) auto(r3, 4, F.tagUpMargin);
    const r2 = runners.find((r) => r.from === 2 && !r.wasSent && r.tag === undefined);
    if (r2 && depthLand > R.tagDepth && !(runners.some((r) => r.from === 3 && r.to === 3))) auto(r2, 3, F.tagUpMargin + 0.25);
    void home;
  }
  // runners you told to tag up: off they go as it is caught (once they are back on the bag), the lead runner first
  for (const r of [...runners].sort((a, b) => b.from - a.from)) {
    if (r.tag !== true || r.out || r.to > r.from) continue;
    if (r.from < 3 && runners.some((q) => q.from === r.from + 1 && q.to === r.from + 1)) continue; // (the bag ahead is taken)
    const tGo = Math.max(tC + R.tagReact, (recArrive(cfg, r, r.from) ?? 0) + 0.05);
    extendLegs(r.legs, r.from, r.from + 1, tGo, cfg, r.spd);
    r.to = r.from + 1; r.tagUp = true; r.sentTo = r.from + 1; r.lastOrderAt = tC;
  }
  for (const o of orders) {
    if (!(o.t >= tC && o.t <= by)) continue;
    // (a runner sent on after the catch has to touch his bag first: if he is still getting back, he goes once he is there)
    const r = recs.find((q) => q.from === o.from && q.from > 0);
    const home = r && !o.back && o.tag === undefined && r.to === r.from ? recArrive(cfg, r, r.from) : undefined;
    applyOrder(recs, home !== undefined && home + 0.05 > o.t + R.sendReact ? { ...o, t: home + 0.05 - R.sendReact } : o, cfg);
  }
  for (const r of runners) if (r.sent) r.tagUp = true;
  // the defense: one throw - behind a runner you sent before the catch (doubled off), else at a runner tagging up
  const at = { x: air.ball.x, z: air.ball.z };
  if (!plan.doubledOff) {
    const tReady = tC + F.transfer[f.type];
    let done = false;
    for (const r of runners.filter((q) => q.wasSent && q.to === q.from).sort((a, b) => b.from - a.from)) {
      const arrive = recArrive(cfg, r, r.from);
      const way = coverOptions({ base: r.from, thrower: f, tReady, from: at, tHave: tC, runnerT: arrive }, plan, defense, cfg)[0];
      if (!way) continue;
      planOut(plan, way, r.from, f, at, tReady, cfg);
      tagRunner(plan, r, r.from, way, cfg, false);
      plan.result = 'doublePlay'; plan.doubledOff = r.from;
      done = true;
      break;
    }
    if (!done) {
      for (const r of runners.filter((q) => q.to > q.from).sort((a, b) => b.to - a.to)) {
        const base = r.to;
        const arrive = recArrive(cfg, r, base);
        const way = coverOptions({ base, thrower: f, tReady, from: at, runnerT: arrive, tag: R.sendTag }, plan, defense, cfg).filter((w) => !w.self)[0];
        if (way) {
          planOut(plan, way, base, f, at, tReady, cfg, 'cover', true);
          tagRunner(plan, r, base, way, cfg);
          plan.result = 'doublePlay';
        } else if (base === 4) {
          // the throw home is late
          const t1 = tReady + throwTime(dist(at.x, at.z, BASE_XZ[4][0], BASE_XZ[4][1]), f, cfg);
          plan.throws.push({ from: f.pos, to: 'C', t0: tReady, t1, ax: at.x, az: at.z, bx: BASE_XZ[4][0], bz: BASE_XZ[4][1], toBase: 4 });
          plan.events.push({ t: t1 + F.tagTime, type: 'throwLate' });
        }
        break;
      }
    }
  }
  if (fair && plan.result !== 'doublePlay' && runners.some((r) => r.from === 3 && r.to === 4 && !r.out)) plan.result = 'sacFly';
  for (const r of runners) {
    const m = recToMove(r);
    if (r.tagUp && !r.out) m.tag = true;
    plan.moves.push(m);
    if (!r.out) plan.endTime = Math.max(plan.endTime, Math.min(mFinish(cfg, m), tC + 9) + 0.3);
  }
  plan.send.post = viewOf(recs, cfg);
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
// A wild pitch: it got past the catcher (t = 0 when it reaches him). It rolls back toward the backstop, he chases it down, the
// pitcher covers the plate, and every runner who can takes the next base. i: { bases, defense, roll (0..1, the seeded roll that
// picked this pitch), speeds }. Null when nobody can move up (then it is just a ball he retrieves).
export function planWildPitch(i, cfg = CONFIG) {
  SPD = i.speeds || null;
  try { return planWildPitchCore(i, cfg); } finally { SPD = null; }
}
function planWildPitchCore(i, cfg) {
  const W = cfg.wildPitch, F = cfg.fielding;
  const defense = i.defense, C = defense.C, Pp = defense.P;
  const plan = {
    fair: true, type: 'wildPitch', wildPitch: true,
    result: 'wildPitch', batterDest: 0, moves: [], outsMade: 0,
    fielderMoves: [], paths: {}, throws: [], carries: [], looses: [], events: [],
    ballHitEnd: 0, pickupT: 0, endTime: 0, homer: false, ctx: { kind: 'wildPitch' }, fielder: 'C', notes: [], ballLandDistance: 0,
  };
  const roll = i.roll ?? 0.5;
  const side = roll < 0.5 ? -1 : 1;
  const bx = side * (6 + 40 * Math.abs(roll - 0.5)), bz = W.rollTo;
  const tPick = chaseLoose(plan, C, { t0: 0, ax: 0, ay: 0.5, az: cfg.pitch.catchZ + 0.5, bx, bz }, W.rollTime, cfg);
  const tReady = tPick + F.transfer.C;
  const throwHome = tReady + throwTime(dist(bx, bz, BASE_XZ[4][0], BASE_XZ[4][1]), C, cfg) + F.tagTime;
  // the runners, lead man first: each takes the next base if it is free (or freed by the man ahead) - home only if he beats the throw
  const to = {};
  for (const b of [3, 2, 1]) {
    if (!i.bases[b - 1]) continue;
    const free = b === 3 || !i.bases[b] || to[b + 1] > b + 1;
    const go = free && (b < 3 || arrivalAt(cfg, b, 4, W.react) + W.homeMargin < throwHome);
    to[b] = go ? b + 1 : b;
  }
  if (!Object.entries(to).some(([b, t]) => t > +b)) return null;
  let end = tReady;
  for (const b of [3, 2, 1]) {
    if (to[b] === undefined) continue;
    const m = { from: b, to: to[b], out: false };
    if (to[b] > b) { m.tStart = W.react; end = Math.max(end, finishAt(cfg, b, to[b], W.react)); }
    plan.moves.push(m);
  }
  // the pitcher covers the plate; with a runner coming home the catcher throws him the ball (late)
  addMove(plan, Pp, 0.8, 2.5, Math.max(Pp.react + 0.4, tReady), { role: 'cover', minEffort: 0.9 }, cfg);
  if (to[3] === 4) {
    const t1 = tReady + throwTime(dist(bx, bz, 0.8, 2.5), C, cfg);
    plan.carries.push({ pos: 'C', t0: tPick, t1: tReady });
    plan.throws.push({ from: 'C', to: 'P', t0: tReady, t1, ax: bx, az: bz, bx: 0.8, bz: 2.5, toBase: 4 });
    plan.carries.push({ pos: 'P', t0: t1, t1: t1 + 99 });
    end = Math.max(end, t1);
  } else plan.carries.push({ pos: 'C', t0: tPick, t1: tPick + 99 });
  plan.endTime = end + 0.7;
  plan.events.push({ t: 0.05, type: 'wildPitch' });
  speedsOnMoves(plan);
  settleThrows(plan);
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
  plan.airRes = air.t;
  const forced = new Set();
  if (bases[0]) { forced.add(1); if (bases[1]) { forced.add(2); if (bases[2]) forced.add(3); } }
  plan.outsMade = 0; plan.batterDest = 0;
  finishHit(plan, { f, tF: tPick, tReady, pf: { x: lx, z: lz }, bases, forced, outs, defense, cfg });
  plan.result = 'error';
  return plan;
}

// An infield fly that is dropped: the batter is out anyway and nobody is forced, so the runners simply stay (a runner who was going
// with the pitch goes back to his bag).
function infieldFlyDrop(plan, i, f, air, bases, cfg) {
  const F = cfg.fielding;
  const [lx, lz] = looseSpot(i, air.ball.x, air.ball.z, cfg);
  plan.caught = false; plan.dropped = true;
  plan.pickupT = air.t;
  plan.ballHitEnd = air.t;
  plan.events.push({ t: air.t, type: 'error', pos: f.pos, drop: true });
  const tPick = chaseLoose(plan, f, { t0: air.t, ax: air.ball.x, ay: air.ball.y, az: air.ball.z, bx: lx, bz: lz }, air.t + F.errors.dropTime, cfg);
  plan.carries.push({ pos: f.pos, t0: tPick, t1: tPick + 99 });
  plan.downT = air.t; plan.airRes = air.t;
  plan.result = 'popout'; plan.outsMade = 1; plan.batterDest = 0;
  for (const b of [3, 2, 1]) {
    if (!bases[b - 1]) continue;
    if (rs(b) !== undefined) plan.moves.push({ from: b, to: b, back: true, tStart: rs(b), backAt: Math.max(rs(b) + 0.2, Math.min(air.t, cfg.steal.readFly)) });
    else plan.moves.push({ from: b, to: b });
  }
  plan.endTime = tPick + 1.0;
  const recs = makeRecords(bases, new Set(), () => [{ kind: 'run', from: 0, to: 0, t0: 0 }], null);
  plan.send = { from: cfg.runner.sendFrom, by: air.t, res: air.t + 1, pre: viewOf(recs, cfg), post: null };
  return plan;
}

// ---------------------------------------------------------------------------
// Public entry point: the core plan (who fields it, throws, runners) plus everybody else's job.
// ---------------------------------------------------------------------------
export function planPlay(i, cfg = CONFIG) {
  RUN = i.running || null;
  SPD = i.speeds || null;
  ORD = i.orders && i.orders.length ? i.orders : null;
  PREV = i.prev && i.prev.paths ? { paths: i.prev.paths, tCut: i.prev.t + cfg.fielding.replanReact } : null;
  READ = 0;
  try {
    const plan = planPlayCore(i, cfg);
    if (RUN) runningStarts(plan, cfg);
    if (PREV) keepOldRuns(plan);
    speedsOnMoves(plan);
    if (!i.simple) endInningStop(plan, i.outs || 0, cfg);
    addSupport(plan, i, cfg);
    settleThrows(plan);
    addCalls(plan, cfg);
    return plan;
  } finally { RUN = null; SPD = null; ORD = null; PREV = null; READ = 0; }
}
// A play planned again: a fielder who has no job in it any more still did what he was doing until the fielders saw the order.
function keepOldRuns(plan) {
  for (const pos in PREV.paths) {
    const runs = plan.paths[pos] || [];
    if (runs.prefixed) continue;
    // (not a man the new plan needs where he already is - say, waiting on his bag for a throw)
    if (runs.length && plan.throws.some((th) => th.to === pos || th.from === pos)) continue;
    // (the runs he still has are the same as before: any further ones he had started by then he still makes, up to the cut)
    for (let k = runs.length; k < PREV.paths[pos].length; k++) {
      const o = PREV.paths[pos][k];
      if (o.tStart >= PREV.tCut) break;
      const r = { ...o, segs: o.segs.map((g) => ({ ...g })) };
      if (r.tStop > PREV.tCut && !r.dive) { cutRun(r, PREV.tCut); r.prefixCut = true; }
      runs.push(r);
    }
    if (runs.length) plan.paths[pos] = runs;
  }
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
  // (a man waiting on the bag with the ball to tag a runner stays there until he has)
  for (const e of plan.events) if (e.type === 'out' && e.pos === pos) { t = Math.max(t, e.t + 0.6); involved = true; }
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
  const knowAt = (c && c.knowAt) || {};
  const go = (pos, x, z, tArrive, role, limit = Infinity, start = undefined) => {
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
    addMove(plan, f, tx, tz, Math.max(tArrive, (start ?? 0) + 0.3), { role, vmax: f.speed * F.supportSpeed, minEffort: 0.75, start }, cfg);
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
  // ---- a grounder to the right side that the first baseman goes after: the pitcher breaks for first anyway, in case
  if (c.kind === 'ground' && c.x > 0 && busy.has('1B') && !busy.has('P')) { const [x, z] = standAt(1); go('P', x, z, 2.0, 'cover'); }

  // ---- bases and battery on a hit that turns into a throw
  if (!i.simple && c.leadDest !== undefined) {
    const lead = c.leadDest;
    const cover = (pos, base, t) => { const [x, z] = standAt(base); go(pos, x, z, t, 'cover', Infinity, knowAt[base] > 0 ? knowAt[base] + defense[pos].react : undefined); };
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
function planOut(plan, way, base, thrower, from, tReady, cfg, role = 'cover', stop = false) {
  const F = cfg.fielding;
  const [bx, bz] = BASE_XZ[base === 0 ? 4 : base];
  const recv = way.recv;
  addMove(plan, recv, bx, bz, Math.max(way.coverStart + 0.05, way.tOut - (base === 4 ? F.tagTime : 0)), { role, start: way.coverStart, vmax: way.speed, minEffort: way.self ? 1 : 0.8, cut: way.self && way.cut, accelTime: way.self ? F.cover.carryAccel : undefined, stop: stop && !way.self }, cfg);
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
  groundoutOrders(plan, ctx);
  // the play is not over while a runner who moved up is still running (he would otherwise be cut off mid-stride)
  for (const m of plan.moves) if (!m.out && m.to > m.from) plan.endTime = Math.max(plan.endTime, mFinish(cfg, m) + 0.3);
  void leadForced; void tF;
  return plan;
}

// Your orders on a ground ball that is turned into an out: a runner you send takes the extra base, and the man who made the (last)
// out may throw at him.
function groundoutOrders(plan, ctx) {
  const { bases, outs, defense, cfg } = ctx;
  const R = cfg.runner;
  const forced = ctx.forced;
  const outEv = plan.events.filter((e) => e.type === 'out').sort((a, b) => b.t - a.t)[0];
  plan.send = { from: R.sendFrom, by: (outEv ? outEv.t : plan.endTime - 0.8) + R.sendAfter };
  const recs = [];
  const keep = [];
  for (const m of plan.moves) {
    if (m.out || m.back || (m.from >= 1 && rs(m.from) !== undefined && m.to <= m.from)) { keep.push(m); continue; }
    const t0 = m.tStart ?? (m.from === 0 ? R.batterStart : rs(m.from) ?? R.startDelay);
    recs.push({ from: m.from, to: m.to, legs: [{ kind: 'run', from: m.from, to: m.to, t0 }], spd: sp(m.from), sent: false, sentTo: null, recalled: false, forced: m.from === 0 || forced.has(m.from) });
  }
  void bases;
  recs.sort((a, b) => b.from - a.from);
  for (const o of (ORD || []).filter((q) => q.t >= R.sendFrom - 1e-6 && q.t <= plan.send.by).sort((a, b) => a.t - b.t)) applyOrder(recs, o, cfg);
  if (outEv) followUpThrow(plan, recs, defense[outEv.pos], { x: BASE_XZ[outEv.base][0], z: BASE_XZ[outEv.base][1] }, outEv.t, outs, defense, cfg);
  plan.send.post = viewOf(recs, cfg);
  plan.moves = [...keep, ...recs.map(recToMove)];
  if (plan.sentOut) plan.result = plan.outsMade >= 2 ? 'doublePlay' : plan.result;
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

  // The runners. On their own they only ever take ONE base (the next one, when it is safe - or because they are forced); anything
  // more is up to you (runner orders). On a ball in the air they first did what they do on every ball in the air (airLegs) and
  // only go on once it is down (plan.airRes).
  const R = cfg.runner;
  const outfield = f.type === 'OF';
  const air = plan.airRes !== undefined ? AIR[plan.type] : null;
  const tRes = air ? plan.airRes + R.downReact : 0;
  const t0Of = (b) => (b === 0 ? R.batterStart : rs(b) ?? R.startDelay);
  const order = [3, 2, 1].filter((b) => bases[b - 1]);
  const stay = (b) => [{ kind: 'run', from: b, to: b, t0: t0Of(b) }];
  const recs = makeRecords(bases, forced, (b) => (air ? airLegs(b, air, outs, plan.landDepth, cfg) : stay(b)), [{ kind: outfield ? 'round' : 'run', from: 0, to: 1, t0: R.batterStart }]);
  // (runners going with the pitch: on their way to the next base from the start)
  for (const b of order) if (rs(b) !== undefined) recs.push({ from: b, to: b + 1, legs: [{ kind: 'run', from: b, to: Math.min(4, b + 1), t0: rs(b) }], spd: sp(b), sent: false, sentTo: null, recalled: false, forced: forced.has(b), running: true });
  recs.sort((p, q) => q.from - p.from);
  const batter = recs.find((r) => r.from === 0);

  // --- your orders: from contact until a moment after the fielder is ready to throw; the defense decides where to throw from what
  // it sees just before he is ready (send.decide) - a runner you send after that is chased by a second throw if it can get him
  const orders = (ORD || []).filter((o) => o.t >= R.sendFrom - 1e-6).sort((p, q) => p.t - q.t);
  const decide = tReady - R.sendLead;
  const sendBy = tReady + R.sendAfter;
  plan.send = { from: R.sendFrom, by: sendBy, decide, res: air ? plan.airRes : undefined };
  let snap = null;
  const takeSnap = () => { if (!snap) snap = recs.map(cloneRec); };
  let oi = 0;
  const ordersUntil = (t) => {
    for (; oi < orders.length && orders[oi].t <= t; oi++) {
      if (orders[oi].t > decide) takeSnap();
      if (orders[oi].t <= sendBy) applyOrder(recs, orders[oi], cfg);
    }
  };
  // 1. orders while the ball is in the air
  if (air) { ordersUntil(plan.airRes - 1e-9); plan.send.pre = viewOf(recs, cfg, outs < 2); }
  // 2. the ball is down (at once on a grounder): each runner takes the next base if he is forced or it is safe, lead runner first
  if (air && plan.airRes > decide) takeSnap();
  {
    let ceiling = 5; // lowest occupied destination base ahead (exclusive); 5 = none
    // (a runner you sent or held back keeps your order; the rest take the next base when safe, and more when it is safe by a mile)
    const legsTo = (r, to) => {
      if (r.running) return [{ kind: 'run', from: r.from, to, t0: rs(r.from) }];
      if (air || r.from === 0) { const L = r.from === 0 ? [{ kind: 'run', from: 0, to: 1, t0: R.batterStart }] : r.legs.map((q) => ({ ...q })); return to > (r.from === 0 ? 1 : r.from) ? extendLegs(L, r.from, to, r.from === 0 ? R.batterStart : Math.max(tRes, t0Of(r.from)), cfg, r.spd) : L; }
      return [{ kind: 'run', from: r.from, to, t0: t0Of(r.from) }];
    };
    const extra = (r, target, ceil) => {
      for (let nb = target + 1; nb <= 4 && (nb === 4 || nb < ceil); nb++) {
        const hyp = { ...r, legs: legsTo(r, nb) };
        if (recArrive(cfg, hyp, nb) + R.autoMargin < D[nb]) target = nb; else break;
      }
      return target;
    };
    for (const r of recs) {
      if (r.from === 0) continue;
      if (r.recalled) { if (r.to < 4) ceiling = Math.min(ceiling, r.to); continue; }
      let target = r.from;
      if (r.sent) target = r.to;
      else if (r.forced) target = r.from + 1;
      else {
        const hyp = cloneRec(r);
        if (r.running) hyp.legs = [{ kind: 'run', from: r.from, to: r.from + 1, t0: rs(r.from) }];
        else extendLegs(hyp.legs, r.from, r.from + 1, Math.max(tRes, t0Of(r.from)), cfg, r.spd);
        if (recArrive(cfg, hyp, r.from + 1) + F.runnerMargin < D[r.from + 1]) target = r.from + 1;
      }
      if (!r.sent && target < 4 && target >= ceiling) target = Math.max(r.from, ceiling - 1);
      if (target <= r.from && r.forced) target = r.from + 1;
      if (!r.sent && target > r.from && !r.running) { const t2 = extra(r, target, ceiling); if (t2 > target) r.auto = true; target = t2; }
      if (!r.sent) {
        if (r.running) {
          if (target > r.from) r.legs = [{ kind: 'run', from: r.from, to: target, t0: rs(r.from) }];
          else backLegs(r.legs, r.from, r.from, Math.max(rs(r.from) + 0.2, plan.downT ?? tF), cfg, r.spd);
        } else if (target > r.from) {
          if (air) extendLegs(r.legs, r.from, target, Math.max(tRes, t0Of(r.from)), cfg, r.spd);
          else r.legs = [{ kind: outfield && target < 4 ? 'round' : 'run', from: r.from, to: target, t0: t0Of(r.from) }];
        } else if (air && r.legs.some((L) => L.kind === 'half' || (L.kind === 'run' && L.to > L.from))) backLegs(r.legs, r.from, r.from, tRes, cfg, r.spd);
        r.to = target;
      }
      r.autoTo = r.to;
      if (r.to < 4) ceiling = Math.min(ceiling, r.to);
    }
    if (!batter.sent && !batter.recalled) {
      let bt = batter.to >= ceiling ? Math.max(1, ceiling - 1) : batter.to;
      if (bt === 1 && ceiling > 2) { bt = extra(batter, 1, ceiling); if (bt > 1) batter.auto = true; } // (a ball in the corner: he takes second by himself, if it is plainly safe)
      if (bt > 1) { batter.legs = legsTo(batter, bt); if (outfield && bt < 4 && batter.legs.length === 1) batter.legs = [{ kind: 'round', from: 0, to: bt, t0: R.batterStart }]; }
      batter.to = bt;
    }
    batter.autoTo = batter.to;
  }
  // 3. orders after it is down
  ordersUntil(sendBy + 1);
  takeSnap();
  // 4. what is plainly the best thing to do happens by itself when the window closes: a runner who would make the next base by a
  // mile goes on (you have no time to think about a ball that gets past everybody)
  {
    const tAuto = sendBy + R.sendReact;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const r of [...recs].sort((p, q) => q.to - p.to)) {
        if (r.recalled || r.out || r.to >= 4 || !r.legs.length || r.running) continue;
        const nb = r.to + 1;
        if (nb < 4 && recs.some((q) => q !== r && q.to === nb)) continue;
        const hyp = cloneRec(r);
        extendLegs(hyp.legs, r.from, nb, tAuto, cfg, r.spd);
        if (recArrive(cfg, hyp, nb) + R.autoMargin < D[nb]) { r.legs = hyp.legs; r.to = nb; r.auto = true; moved = true; }
      }
      if (!moved) break;
    }
  }
  plan.send.post = viewOf(recs, cfg);
  // when could the defense first know a runner was heading for each base? (a base he only goes to because you sent him: when he went)
  const knowAt = {};
  for (let b = 2; b <= 4; b++) {
    let k = Infinity;
    for (const r of recs) if (!r.out && r.to >= b && r.from < b) k = Math.min(k, (r.autoTo ?? r.from) >= b ? 0 : (r.firstSentAt ?? 0) + R.sendReact);
    knowAt[b] = Number.isFinite(k) ? k : 0;
  }
  plan.ctx.knowAt = knowAt;
  let bd = batter.to;
  const dests = {};
  for (const r of recs) if (r.from > 0) dests[r.from] = r.to;
  plan.batterDest = bd;
  const earned = 1; // (the batter's hit is what he reached safely: first base, more if he makes it where he was sent)
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
  for (const r of [...snap].sort((p, q) => q.to - p.to)) {
    if (!(r.sent || r.recalled) || r.to < 1 || (!r.recalled && r.to <= r.from)) continue; // (a runner who was not sent only took a base he was sure to reach)
    const arrive = recArrive(cfg, r, r.to);
    const tBall = D[r.to] - (r.to === 4 ? F.tagTime : 0); // (when the throw gets there)
    if (tBall + R.sendTag + F.outMargin <= arrive) { tgtBase = r.to; break; }
  }
  plan.ctx.tgtBase = tgtBase;
  // (a throw that only goes there because you sent a runner: the men who take it only set off once he has gone)
  const kStart = knowAt[tgtBase] > 0 ? Math.max(F.cover.start, knowAt[tgtBase] + F.reaction.IF) : undefined;
  const tgt0 = Math.min(4, Math.max(...recs.map((r) => r.autoTo ?? r.from)));
  const relayNeeded = f.type === 'OF' && dist(pf.x, pf.z, BASE_XZ[tgtBase][0], BASE_XZ[tgtBase][1]) > F.relayDistance;
  const rp = { x: BASE_XZ[tgtBase][0], z: BASE_XZ[tgtBase][1] };
  const holdThrow = (thrower, tReadyT, way) => { // he holds the ball until the throw can reach the bag together with the man covering it
    const carry = plan.carries.find((c) => c.pos === thrower.pos && Math.abs(c.t1 - tReadyT) < 1e-6);
    if (carry) carry.t1 = Math.max(carry.t1, way.t0);
  };
  if (relayNeeded) {
    // cut-off man: nearest infielder standing 55% of the way back from the base (the same man who first went out for the throw where it
    // was going before you sent the runner, if there was one)
    const cutFor = (base) => {
      const bx = BASE_XZ[base][0], bz = BASE_XZ[base][1];
      const x = bx + (pf.x - bx) * 0.5, z = bz + (pf.z - bz) * 0.5;
      const guess = coverer(base, f, defense);
      let best = null;
      for (const pos of ['SS', '2B', '3B', '1B']) {
        if (pos === guess.pos) continue;
        const q = defense[pos];
        const d = dist(q.x, q.z, x, z);
        if (!best || d < best.d) best = { q, d };
      }
      return { c: best.q, x, z, guess };
    };
    const now = cutFor(tgtBase);
    const before = kStart !== undefined && tgt0 !== tgtBase && dist(pf.x, pf.z, BASE_XZ[tgt0][0], BASE_XZ[tgt0][1]) > F.relayDistance ? cutFor(tgt0) : null;
    const cx = now.x, cz = now.z;
    const c = before && before.c.pos !== now.guess.pos ? before.c : now.c;
    const t1 = tReady + dist(pf.x, pf.z, cx, cz) / F.throwSpeed.OF;
    const t2 = t1 + F.relayTransfer;
    const way = coverOptions({ base: tgtBase, thrower: c, tReady: t2, from: { x: cx, z: cz }, coverStart: kStart }, plan, defense, cfg).filter((o) => o.recv.pos !== c.pos)[0];
    const recv = way.recv;
    const t3 = way.t1;
    if (before) {
      // he first went out to take the throw for where it was going before you sent the runner, then turns for the new spot
      if (before.c.pos !== c.pos) {
        if (before.c.pos !== recv.pos) addMove(plan, before.c, before.x, before.z, Math.max(before.c.react + 0.3, t1 - 0.4), { role: 'relay', minEffort: 0.8 }, cfg);
        addMove(plan, c, cx, cz, Math.max(kStart + 0.1, t1 - 0.4), { role: 'relay', minEffort: 0.8, start: kStart }, cfg);
      } else {
        addMove(plan, c, before.x, before.z, Math.max(c.react + 0.3, t1 - 0.4), { role: 'relay', minEffort: 0.8 }, cfg);
        addMove(plan, c, cx, cz, Math.max(kStart + 0.1, t1 - 0.4), { role: 'relay', minEffort: 0.8, start: kStart, cut: true }, cfg);
      }
    } else addMove(plan, c, cx, cz, Math.max(c.react + 0.3, t1 - 0.4), { role: 'relay', minEffort: 0.8 }, cfg);
    addMove(plan, recv, rp.x, rp.z, Math.max(way.coverStart + 0.05, t3), { role: 'cover', start: way.coverStart, vmax: way.speed, minEffort: 0.8, stop: true }, cfg);
    plan.throws.push({ from: f.pos, to: c.pos, t0: tReady, t1, ax: pf.x, az: pf.z, bx: cx, bz: cz, toBase: 0 });
    plan.throws.push({ from: c.pos, to: recv.pos, t0: way.t0, t1: t3, ax: cx, az: cz, bx: rp.x, bz: rp.z, toBase: tgtBase });
    plan.carries.push({ pos: c.pos, t0: t1, t1: way.t0 });
    plan.carries.push({ pos: recv.pos, t0: t3, t1: t3 + 99 });
    plan.events.push({ t: t3, type: 'throwEnd', pos: recv.pos, base: tgtBase });
    plan.ballEnd = t3;
  } else {
    const way = coverOptions({ base: tgtBase, thrower: f, tReady, from: { x: pf.x, z: pf.z }, tHave: tF, dive: !!(plan.fielderMoves[0] && plan.fielderMoves[0].dive), coverStart: kStart }, plan, defense, cfg)[0];
    const recv = way.recv;
    addMove(plan, recv, rp.x, rp.z, Math.max(way.coverStart + 0.05, way.tOut), { role: 'cover', start: way.coverStart, vmax: way.speed, minEffort: 0.8, stop: !way.self }, cfg);
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

  // Settle the throw: a runner you sent to that base (or called back to it) is out when the ball and a fielder get to the bag before
  // he does (a tag, not a force - except the batter at first), else he is safe (a close play gets the call). Then whoever has the ball
  // may go after another runner you sent.
  const tBall = plan.ballEnd;
  const recvPos = (plan.events.find((e) => e.type === 'throwEnd' && Math.abs(e.t - tBall) < 1e-6) || {}).pos;
  const settled = recs.find((q) => !q.out && (q.sent || q.recalled) && q.to === tgtBase && (q.to > q.from || q.recalled));
  if (settled && recvPos) {
    const arrive = recArrive(cfg, settled, tgtBase);
    const tag = tgtBase === 1 && !settled.recalled ? 0 : R.sendTag;
    if (tBall + tag + F.outMargin <= arrive) {
      plan.events.push({ t: tBall, type: 'out', base: tgtBase, pos: recvPos, tag: tag > 0 });
      tagRunner(plan, settled, tgtBase, { tOut: tBall }, cfg);
    } else if (tBall - arrive <= F.closePlay) plan.events.push({ t: Math.max(tBall, arrive) + 0.1, type: 'safe', base: tgtBase });
  }
  if (recvPos) followUpThrow(plan, recs, defense[recvPos], { x: rp.x, z: rp.z }, tBall, outs, defense, cfg, settled);
  if (batter.out) { plan.batterDest = 0; plan.result = resultOf(earned); plan.infieldHit = plan.result === 'single' && f.type !== 'OF'; }
  if (plan.sentOut && outs + plan.outsMade >= 3) plan.timePlay = true; // runs that crossed the plate before the tag still count
  for (const r of recs) plan.moves.push(recToMove(r));

  // The play ends when every runner has stopped and the throw is in.
  let last = plan.ballEnd;
  for (const m of plan.moves) {
    if (m.out) { last = Math.max(last, m.outAt + R.outLinger - 0.35); continue; }
    last = Math.max(last, mFinish(cfg, m));
  }
  plan.endTime = Math.max(plan.endTime || 0, last + 0.35);
  return plan;
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
