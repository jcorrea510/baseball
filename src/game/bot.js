// A simple computer "player" that aims and swings with a chosen accuracy. Used for automated playtesting
// (scripts/sim.mjs, scripts/pitchfeel.mjs, the browser auto-play check) - never in the real game unless ?bot is in the URL.
// When the computer bats and the engine lets you pitch (`cpuHalf: 'pitch'`), it pitches like a person too (`o.pitcher`, see
// botPitch below): it picks a pitch, aims at a corner, the knees or (two strikes) off the plate with a shaky hand, starts the
// delivery and taps the ring a human timing error away from the moment it meets the dot.
// It aims the bat's sweet spot at where it reads the pitch will cross the plate, a little under the ball (where fly balls come from),
// and times the swing with a timing error. Its read is a person's: the pitch guide's guess at the moment it must commit (fuzzier on the
// harder levels and for breaking balls, `read` of that error), plus a little hand error in moving the bat.
import { createRng } from '../util/rng.js';
import { zoneRatio } from '../physics/pitch.js';
import { pitchGuide } from './pitchGuide.js';
import { chooseSend } from './cpuRunner.js';
import { heatAt, zoneCell, cellCenter } from './scouting.js';

/** A person pitching (scripts/pitchfeel.mjs PITCHERS has the new / average / good ones): ring tap spread (ms), hand shake on the
 * aim (ft), how often he throws a pitch he did not mean to (`wrongPitch`), whether he mixes speeds on purpose (`mixSpeeds`).
 * Where he aims when behind in the count (`behindX`: share of the zone's half-width toward a corner, `behindY`: ft from the middle of
 * the zone - a person does not groove it, he aims low and toward a corner inside the zone, so a shaky hand still walks a batter now and then) and
 * how far inside the edge he paints a corner (`paint`, ft). */
export const BOT_PITCHER = { tapSd: 50, shake: 0.12, wrongPitch: 0, mixSpeeds: false, behindX: 0.7, behindY: -0.75, paint: 0.08, followCall: 0.4, avoidHot: 0.7 };
// (the scouting a person uses: how often he throws the catcher's call, and how often he steers a pitch out of the batter's hot zone)
const FAST = new Set(['fastball', 'sinker', 'heater']);

export function createBot(engine, o = {}) {
  const rng = o.rng || createRng(o.seed ?? 99);
  const errSd = o.errSd ?? 14; // ms of timing spread
  const bias = o.bias ?? 0;
  const aimSd = o.aimSd ?? 0.05; // ft of hand error moving the bat (up / down)
  const aimSdX = o.aimSdX ?? 0.08; // ft of hand error (in / out)
  const read = o.read ?? 0.7; // how much of the pitch guide's error its read of the pitch has (a person watching the ball reads a bit better than the circle)
  const under = o.under ?? (engine.mode === 'derby' ? 0.4 : 0.3); // how far under the ball it tries to get, as a share of the contact window (0 = square: line drives; the Derby: right in the home-run band)
  const underSd = o.underSd ?? 0.1;
  const swingStrike = o.swingStrike ?? 0.85;
  const swingBall = o.swingBall ?? 0.06;
  const sendGamble = o.sendGamble ?? 0.015; // the chance (per look, every 0.4 s) it sends a runner it should not have (people misjudge too)
  let plan = null;
  const sends = o.send ?? true; // false: it never sends a runner (a player who leaves the runners alone)
  let sendPlay = null, sendAt = 0;
  // pitching (the computer at bat, `cpuHalf: 'pitch'`): a second rng of its own, so its batting draws stay as they were
  const pitcher = { ...BOT_PITCHER, ...(o.pitcher || {}) };
  const prng = createRng(((o.seed ?? 99) ^ 0x2c1b3c6d) >>> 0);
  let throwPlan = null; // this pitch: { aimSince, ready (engine time it starts the delivery), type, aim, tapErr (ms), tapAt }

  // What he throws: mostly fastballs, more of them when behind in the count, more slow ones with two strikes; a good pitcher mixes
  // speeds on purpose (something slow after two fastballs, a fastball after something slow); a new one now and then hits the wrong button.
  function choosePitchType(count) {
    const ars = engine.myPitcher.pitches, last = engine.mound.recent;
    const fast = ars.filter((t) => FAST.has(t)), slow = ars.filter((t) => !FAST.has(t));
    if (!slow.length || !fast.length) return prng.pick(ars);
    if (pitcher.wrongPitch && prng.chance(pitcher.wrongPitch)) return prng.pick(ars);
    let pFast = count.balls >= 3 || count.balls - count.strikes >= 2 ? 0.75 : count.strikes === 2 ? 0.4 : 0.55;
    if (pitcher.mixSpeeds && last.length) {
      const wasFast = last.map((r) => FAST.has(r.type));
      if (wasFast.length === 2 && wasFast[0] && wasFast[1]) pFast = 0.2; // (two fastballs: now something slow)
      else if (!wasFast[wasFast.length - 1]) pFast = Math.max(pFast, 0.7); // (after something slow: a fastball)
    }
    return prng.chance(pFast) ? prng.pick(fast) : prng.pick(slow);
  }
  // Where he aims (the dot = where the pitch should cross): behind in the count, low and toward a corner inside the zone; with two strikes usually off the
  // plate (below the knees, up with a fastball, or off the outside corner); else a corner or the knees. Then his hand shakes.
  function chooseTarget(count, type) {
    const P = engine.cfg.pitch, zw = P.zoneHalfWidth, bottom = P.zoneBottom, top = P.zoneTop, mid = (bottom + top) / 2;
    const away = engine.batterHand === 'L' ? -1 : 1; // (a right-handed batter stands on the -x side: away is +x)
    const side = prng.chance(0.6) ? away : -away;
    const fast = FAST.has(type);
    let x, y;
    if (count.balls >= 3 || count.balls - count.strikes >= 2) { x = side * zw * pitcher.behindX; y = mid + pitcher.behindY; } // (a strike, please)
    else if (count.strikes === 2 && prng.chance(0.6)) {
      const r = prng.next();
      if (r < 0.45) { x = side * zw * 0.5; y = bottom - (fast ? 0.25 : 0.45); } // below the knees
      else if (r < 0.7 && fast) { x = side * zw * 0.4; y = top + 0.35; } // up out of the zone
      else { x = away * (zw + 0.3); y = mid - 0.4; } // off the outside corner
    } else {
      const r = prng.next();
      if (r < 0.55) { x = side * (zw - pitcher.paint); y = bottom + 0.1; } // a low corner (on the black)
      else if (r < 0.8) { x = side * zw * 0.3; y = bottom + 0.1; } // the knees
      else { x = side * (zw - pitcher.paint); y = top - 0.2; } // up in the zone, on a corner
    }
    return { x: x + prng.gauss(0, pitcher.shake), y: y + prng.gauss(0, pitcher.shake) };
  }
  function botPitch() {
    if (engine.phase === 'aim') {
      if (!throwPlan || throwPlan.aimSince !== engine.phaseSince) {
        let type = choosePitchType(engine.count), aim = chooseTarget(engine.count, type);
        const call = engine.call;
        if (call && pitcher.followCall && prng.chance(pitcher.followCall)) {
          // the catcher's sign: that pitch, on his spot (as well as his hand allows)
          type = call.type;
          aim = { x: call.x + prng.gauss(0, pitcher.shake), y: call.y + prng.gauss(0, pitcher.shake) };
        } else if (engine.zones && heatAt(engine.zones, aim.x, aim.y, engine.cfg) > 0 && pitcher.avoidHot && prng.chance(pitcher.avoidHot)) {
          // he sees he is aiming into the batter's hot zone: to the nearest cell that is not hot
          const from = zoneCell(aim.x, aim.y, engine.cfg);
          let best = null;
          for (let i = 0; i < 9; i++) if (engine.zones[i] <= 0) { const d = Math.abs(Math.floor(i / 3) - Math.floor(from / 3)) + Math.abs((i % 3) - (from % 3)); if (!best || d < best.d) best = { i, d }; }
          if (best) { const c = cellCenter(best.i, engine.cfg); aim = { x: c.x + prng.gauss(0, pitcher.shake), y: c.y + prng.gauss(0, pitcher.shake) }; }
        }
        throwPlan = { aimSince: engine.phaseSince, ready: engine.time + prng.range(0.5, 1.2), type, aim, tapErr: prng.gauss(0, pitcher.tapSd) };
      }
      if (engine.time < Math.max(throwPlan.ready, engine.fieldersSetAt)) return; // (a moment to think, and the pitcher is set)
      engine.selectPitch(throwPlan.type);
      engine.setPitchAim(throwPlan.aim.x, throwPlan.aim.y);
      if (engine.startDelivery()) throwPlan.tapAt = engine.ring.tStart + engine.ring.hitAt + throwPlan.tapErr / 1000;
      return;
    }
    const r = engine.ring;
    // (it taps at its exact moment, whatever the frame; a tap after the ring has closed is no tap at all: WILD)
    if (engine.phase === 'delivery' && r && !r.tapped && throwPlan && throwPlan.tapAt !== undefined && engine.time >= throwPlan.tapAt) {
      if (throwPlan.tapAt <= r.tStart + r.time) engine.ringTap(throwPlan.tapAt - engine.time);
      throwPlan.tapAt = undefined;
    }
  }
  engine.on('windup', ({ pitch }) => {
    const r = zoneRatio(pitch.target.x, pitch.target.y, engine.cfg);
    const inZone = pitch.isStrike || r < 1.15;
    const p = engine.mode === 'derby' ? 0.97 : engine.mode === 'practice' ? 0.9 : inZone ? swingStrike : swingBall;
    const win = engine.contactWindow;
    plan = {
      swing: rng.chance(p), err: rng.gauss(bias, errSd),
      dy: -(under + rng.gauss(0, underSd)) * (win.sweet || win).up + rng.gauss(0, aimSd), dx: rng.gauss(0, aimSdX),
    };
  });
  return {
    update() {
      if (engine.awaitingBatter) engine.batterReady(); // (a new batter: the bot is always ready)
      if (engine.offense === 'cpu') { if (engine.cpuHalf === 'pitch' && engine.pitching) botPitch(); return; } // (the computer is at bat: it runs its own runners; the bot pitches)
      // sending runners: a moment after the ball is down it looks at each base that is lit on the diamond (lead runner first) and
      // taps it when the runner would make it (it peeks at the planner: a well-judged send)
      if (sends && engine.phase === 'play' && engine.sendOpen) {
        const p = engine.play;
        if (sendPlay !== p) { sendPlay = p; sendAt = engine.time + rng.range(0.15, 0.6); }
        const t = engine.time - p.t0;
        const res = p.plan.send && p.plan.send.res;
        // (it waits to see the ball caught or down, and only looks while a send still decides the play - the live play after it is a
        // person's to use, and looking all through every play would multiply its misjudgements)
        if (engine.time >= sendAt && !(res !== undefined && t < res) && t <= (p.plan.send.main ?? Infinity)) {
          sendAt = engine.time + 0.4;
          const base = chooseSend({ planIn: p.planIn, t, targets: engine.baseTargets(), rng, gamble: sendGamble }, engine.cfg);
          if (base !== null) engine.tapBase(base);
        }
        return;
      }
      const pitch = engine.pitch;
      if (!pitch || !plan) return;
      if (engine.phase === 'windup' || engine.phase === 'pitch') {
        // it reads where the pitch is going and puts the bat there (its read sharpens as the ball comes; once it has swung, it is committed)
        const T = pitch.flight.T, c = pitch.flight.at(T);
        const tSeen = engine.phase === 'pitch' ? Math.min(engine.time - pitch.tRelease, T - engine.cfg.timing.swingDelay) : 0;
        const g = pitchGuide(pitch, Math.max(0, tSeen), engine.cfg, engine.difficulty);
        engine.setBatAim(c.x + (g.x - pitch.target.x) * read + plan.dx, c.y + (g.y - pitch.target.y) * read + plan.dy);
      }
      if (engine.phase !== 'pitch' || !plan.swing || engine.swing) return;
      const t = pitch.tCross + plan.err / 1000 - engine.cfg.timing.swingDelay;
      if (engine.time >= t) engine.swingPressed(0);
    },
  };
}
