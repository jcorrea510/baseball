// Fielding + baserunning planner.
// Given a batted ball (its full simulated flight) and the defense, this decides - deterministically -
// who catches / fields it, whether throws beat runners, and how far every runner goes. It produces a
// "plan": a timeline (seconds after contact) the renderer simply plays back.
import { CONFIG } from '../config.js';
import { sampleBall, judgeFairFoul, battedBallType } from '../physics/ballistics.js';
import { BASE_XZ, polar, fenceDistance, sprayOf } from '../physics/field.js';
import { planRun, planDiveRun, sampleRun, samplePath, covered, timeToCover } from './fielderMotion.js';

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
  const tEnd = Math.min(sim.contactTime, sim.duration);
  // Who could be under the ball at time t? (a fielder who has to dive counts only if nobody can get there running)
  const candidate = (t) => {
    const b = sampleBall(sim, t);
    if (b.y > F.reachHeight || b.y < 0.5) return null;
    const spray = sprayOf(b.x, b.z);
    if (b.z < 0 && Math.abs(spray) <= 45 && Math.hypot(b.x, b.z) > fenceDistance(spray) - 0.5) return null; // over the wall
    let best = null;
    for (const pos of POSITIONS) {
      const f = defense[pos];
      const d = dist(f.x, f.z, b.x, b.z);
      const avail = covered(f.speed * effort(f, b.x, b.z), t - f.react, F.accel);
      const need = d - F.glove;
      if (need <= avail) {
        const slack = avail - need;
        if (!best || need < best.need) best = { f, need, dive: false, slack, avail, ball: { ...b } };
      } else if (b.y <= 5.2 && need - F.diveExtra <= avail) {
        if (!best) best = { f, need, dive: true, slack: -1, avail, ball: { ...b } };
      }
    }
    return best;
  };
  for (let t = 0.3; t <= tEnd + 1e-6; t += STEP) {
    const best = candidate(t);
    if (!best) continue;
    if (best.dive) {
      // nobody dives for a ball a fielder can simply run under a moment later
      for (let t2 = t + STEP; t2 <= Math.min(t + F.dive.preferRun, tEnd) + 1e-6; t2 += STEP) {
        const alt = candidate(t2);
        if (alt && !alt.dive) return { t: t2, ...alt };
      }
    }
    return { t, ...best };
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
function addMove(plan, f, toX, toZ, tArrive, opts = {}, cfg = CONFIG) {
  const F = cfg.fielding;
  const runs = (plan.paths[f.pos] = plan.paths[f.pos] || []);
  const prev = runs[runs.length - 1];
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
  let run = opts.dive
    ? planDiveRun({ x0, z0, px: toX, pz: toZ, tStart, tCatch: tArrive, vmax, accel: vmax / F.accel, brake: F.brake, dive: F.dive })
    : null;
  if (!run) run = planRun({ x0, z0, x1, z1, tStart, tArrive: Math.max(tArrive, tStart + 0.05), vmax, accel: vmax / F.accel, brake: F.brake, minEffort: opts.minEffort ?? F.minRunEffort, heading: Math.atan2(toX - x0, toZ - z0) });
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
function planPlayCore(i, cfg) {
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
    fielderMoves: [], paths: {}, throws: [], carries: [], events: [],
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
    const wallD = Math.hypot(end.x, end.z) - 2.5;
    const sp = sprayOf(end.x, end.z);
    const wx = Math.sin((sp * Math.PI) / 180) * wallD, wz = -Math.cos((sp * Math.PI) / 180) * wallD;
    const tArr = Math.min(sim.homerun.t, best.f.react + Math.hypot(best.f.x - wx, best.f.z - wz) / best.f.speed);
    addMove(plan, best.f, wx, wz, Math.max(tArr, best.f.react + 0.4), { watch: true, role: 'watch', minEffort: 0.5 }, cfg);
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
    addMove(plan, f, air.ball.x, air.ball.z, air.t, { dive: air.dive, avail: air.avail, role: 'catch' }, cfg);
    plan.ctx = { kind: 'air', x: air.ball.x, z: air.ball.z, t: air.t };
    plan.ballHitEnd = air.t;
    plan.carries.push({ pos: f.pos, t0: air.t, t1: air.t + 99 });
    plan.events.push({ t: air.t, type: 'catch', pos: f.pos, dive: !!plan.fielderMoves[0].dive });
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
  addMove(plan, f, pf.x, pf.z, tF, { dive: pick.dive, avail: pick.avail, start: pick.start, role: 'field' }, cfg);
  plan.ctx = { kind: 'ground', x: pf.x, z: pf.z, t: tF };
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
  if (isInfieldPlay && groundBall) {
    const attempt = tryInfieldOut({ f, tF, tReady, pf, bases, forced, outs, defense, cfg, plan });
    if (attempt) return finishInfieldOut(plan, attempt, { f, tF, tReady, pf, bases, forced, outs, defense, cfg });
  }

  // --- Otherwise it is a hit. Work out how far everyone goes. ---
  return finishHit(plan, { f, tF, tReady, pf, bases, forced, outs, defense, cfg });
}


// ---------------------------------------------------------------------------
// Public entry point: the core plan (who fields it, throws, runners) plus everybody else's job.
// ---------------------------------------------------------------------------
export function planPlay(i, cfg = CONFIG) {
  const plan = planPlayCore(i, cfg);
  addSupport(plan, i, cfg);
  settleThrows(plan);
  addCalls(plan, cfg);
  return plan;
}

// A close play gets a "Safe!" call: the throw reaches the base just AFTER the runner (within a beat).
function addCalls(plan, cfg) {
  const R = cfg.runner, per = cfg.field.baseDistance / R.speed;
  for (const th of plan.throws) {
    const base = th.toBase;
    if (!(base >= 1 && base <= 4)) continue;
    if (plan.events.some((e) => e.type === 'out' && e.base === base)) continue; // that one is an out
    for (const m of plan.moves) {
      if (m.out || m.to !== base) continue;
      const arrive = m.from === 0 ? R.timeToFirst + (base - 1) * per : (m.tStart ?? R.startDelay) + (base - m.from) * per;
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
  const inside = (x, z, margin) => {
    const lim = fenceDistance(sprayOf(x, z)) - margin;
    const d = Math.hypot(x, z);
    return d > lim ? [(x * lim) / d, (z * lim) / d] : [x, z];
  };
  const go = (pos, x, z, tArrive, role, limit = Infinity) => {
    const f = defense[pos];
    busy.add(pos);
    let tx = x, tz = z;
    const d = dist(f.x, f.z, x, z);
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
      go(ofs[1], o.x + (c.x - o.x) * 0.3, o.z + (c.z - o.z) * 0.3, tBall + 0.2, 'shade');
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
      if (c.tgtBase === 4) go('P', -7, 11, 2.4, 'backup');
      else if (c.tgtBase === 3) go('P', BASE_XZ[3][0] - 14, BASE_XZ[3][1] + 14, 2.4, 'backup');
    }
    if ((bases[1] || bases[2] || lead >= 4) && !busy.has('C')) cover('C', 4, 2.2);
  }
}

// A throw goes to where its receiver really is when the ball arrives (a late runner-up receiver never gets a ball
// thrown at an empty base).
function settleThrows(plan) {
  for (const th of plan.throws) {
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
  addMove(plan, recv, rp.x, rp.z, Math.max(recv.react + 0.2, choice.t - 0.25), { role: 'cover', minEffort: 0.8 }, cfg);
  plan.ctx.tgtBase = choice.base;
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
        addMove(plan, first, BASE_XZ[1][0], BASE_XZ[1][1] + 0.5, Math.max(first.react + 0.2, t2 - 0.3), { role: 'cover', minEffort: 0.8 }, cfg);
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
  plan.ctx.leadDest = leadDest;
  const tgtBase = Math.min(4, leadDest >= 4 ? 4 : leadDest + 0); // throw to the base the lead runner reaches
  plan.ctx.tgtBase = tgtBase;
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
    addMove(plan, c, cx, cz, Math.max(c.react + 0.3, t1 - 0.4), { role: 'relay', minEffort: 0.8 }, cfg);
    addMove(plan, recv, rp.x, rp.z, Math.max(recv.react + 0.3, t3 - 0.3), { role: 'cover', minEffort: 0.8 }, cfg);
    plan.throws.push({ from: f.pos, to: c.pos, t0: tReady, t1, ax: pf.x, az: pf.z, bx: cx, bz: cz, toBase: 0 });
    plan.throws.push({ from: c.pos, to: recv.pos, t0: t2, t1: t3, ax: cx, az: cz, bx: rp.x, bz: rp.z, toBase: tgtBase });
    plan.carries.push({ pos: c.pos, t0: t1, t1: t2 });
    plan.carries.push({ pos: recv.pos, t0: t3, t1: t3 + 99 });
    plan.events.push({ t: t3, type: 'throwEnd', pos: recv.pos, base: tgtBase });
    plan.ballEnd = t3;
  } else {
    const t1 = tReady + dist(pf.x, pf.z, rp.x, rp.z) / F.throwSpeed[f.type];
    addMove(plan, recv, rp.x, rp.z, Math.max(recv.react + 0.3, t1 - 0.3), { role: 'cover', minEffort: 0.8 }, cfg);
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
