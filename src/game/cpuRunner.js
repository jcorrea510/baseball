// The computer's base running (pure; the engine passes its own seeded rng): which runner to send on a ball in play, and when a runner steals.
// `chooseSend` is the judgement the test bot has always used (bot.js calls it): it peeks at the planner, so it sends a runner who makes it,
// and now and then (`cpuRun.gamble`) one who does not - people misjudge too.
import { planPlay } from './fielding.js';

/**
 * Which lit base to tap, or null for none. `targets` = the lit bases [{ base, from }] (engine.baseTargets()), `t` = seconds since
 * contact, `planIn` = what the ball in play was planned from. Lead runner first; the first base whose runner makes it (in a re-plan
 * with that order added) is taken, and a base whose runner would be put out is taken only on a gamble.
 */
export function chooseSend({ planIn, t, targets, rng, gamble }, cfg) {
  const g = gamble ?? cfg.cpuRun.gamble;
  for (const tg of [...targets].reverse()) {
    const hyp = planPlay({ ...planIn, orders: [...(planIn.orders || []), { base: tg.base, t, from: tg.from }] }, cfg);
    const goes = hyp.moves.some((m) => m.from === tg.from && m.sent && !m.out && m.to === tg.base);
    if ((goes && !hyp.sentOut) || (hyp.sentOut && rng.chance(g))) return tg.base;
  }
  return null;
}

/**
 * Whether the runners go on this pitch. `bases` = [first, second, third] (anything truthy = a runner), `count` = { balls, strikes },
 * `speeds` = each runner's speed factor keyed by base 1-3 (engine.runnerSpeeds()). The runner who decides is the one furthest along who
 * is allowed to go (nobody steals home; a runner on first needs second empty, or the man on second going too) - the same rule as
 * engine.stealBases(). A quicker runner goes more often, a slow one rarely, and a count that favours the runner
 * (1-0, 2-1) a little more; never with two outs and two strikes.
 */
export function stealDecision({ bases, count, outs, speeds, rng }, cfg) {
  const C = cfg.cpuRun;
  if (outs >= 3 || (outs >= 2 && count.strikes >= 2)) return false;
  let who = 0; // the base of the runner who decides (0 = nobody can go)
  if (bases[1] && !bases[2]) who = 2;
  else if (bases[0] && !bases[1]) who = 1;
  if (!who) return false;
  // a speed factor of 1 +- ratings.spdSpeed (a Speed rating of 99 / 1) -> -1..1, then between stealSlow, 1 and stealFast times the usual chance
  const u = Math.max(-1, Math.min(1, ((speeds?.[who] ?? 1) - 1) / cfg.ratings.spdSpeed));
  const factor = u >= 0 ? 1 + (C.stealFast - 1) * u : 1 + (1 - C.stealSlow) * u;
  const favoured = (count.balls === 1 && count.strikes === 0) || (count.balls === 2 && count.strikes === 1);
  return rng.chance(Math.min(1, C.steal * factor * (favoured ? C.stealCount : 1)));
}
