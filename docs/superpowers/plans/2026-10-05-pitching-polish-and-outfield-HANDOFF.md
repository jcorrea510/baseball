# Round fifteen - handoff (Oct 5, stopped by the owner mid-plan)

> **Finished by the next session (Oct 5, evening).** f7179fa re-reviewed (park span cache, real pickups before the pending one, the
> no-control planner byte-identical: realism 3000, groundcheck, sim 100 games unchanged); the hang fix and `giveUpAfter`; Tasks 8-12
> (engine, view, controls, balance, notes). What was built and what is left is in CLAUDE.md ("Round fifteen" under Where things stand,
> and Known issues). The rest of this file is the record of the first session.

Read this first, then the spec (`docs/superpowers/specs/2026-10-05-pitching-polish-and-outfield-design.md`) and the plan
(`docs/superpowers/plans/2026-10-05-pitching-polish-and-outfield.md`). The full running log of every decision is the ledger next to this file
(`2026-10-05-pitching-polish-and-outfield-ledger.md`, a committed copy of the git-ignored `.superpowers/sdd/2026-10-05-pitching-polish-and-outfield/progress.md`
that only exists on the Mac where the work was done, with every task brief / implementer report / review diff).

**Nothing is pushed.** Twelve commits sit on local `main` after `origin/main` (`500bf09` .. `f7179fa`). The owner has NOT played any of it.
Nothing the owner can play for the outfield exists yet: the fielding is built as logic, but the engine, the picture and the controls do not use it.

## What the owner asked for (Oct 5)
1. The pitching screen "looks glitched, a line from the top right corner" -> DONE (Task 1).
2. After contact (while pitching) the camera jumped behind the batter -> DONE (Task 3), feel untested.
3. "A way to play the outfield, not just have it happen automatically" -> chase and catch, steered directly (arrow keys / WASD, thumb stick, Dive).
   Logic layers DONE (Tasks 5, 6, 7); engine, picture, controls, balance and notes NOT DONE (Tasks 8-12).
4. "Overall it just needs a lot of work" -> the owner was asked for more pitching notes and had none yet; add any new ones to the plan.

## Task status (plan tasks 1-12)
| # | Task | State | Commits |
|---|---|---|---|
| 1 | Delete the break arc | done, reviewed clean | 7e58ec4 |
| 2 | Round-fourteen leftovers (Sim stats out of career pitching, checks) | done, reviewed clean after 1 fix round | eef5425, 853709e |
| 3 | Hit camera while pitching (`render/cameraViews.js` `pitchHitView`, `cameraRig` branch, `camera.pitchHit`) | done, reviewed clean after 1 fix round | 00b474e, b5e528d |
| 4 | Fielding setting Play / Auto (default Play) | done, reviewed clean | 31217d4 |
| 5 | Live runs (`makeTrackRun`, `makeLiveDive` in `fielderMotion.js`) | done, reviewed clean | 8f19b3b |
| 6 | The live fielder (`game/fieldControl.js`: `FieldControl`, `controlEligible`, `autoSteer`) | done, reviewed clean | db865df |
| 7 | Planner takes the result from the live fielder (`planPlay` input `i.control`, `plan.pending`, `field.parkSpan()`) | implemented + fixed; **the fix commit f7179fa has NOT been re-reviewed** (the re-review was stopped) | e7b3aac, f7179fa |
| 8 | Engine runs a controlled play (`fielding` engine option, `engine.control`, `fieldInput`, re-plan at the catch / pickup, app passes the setting) | NOT STARTED | |
| 9 | What you see: ring on the fielder, chase camera (`chaseView`), actors draw the live fielder | NOT STARTED | |
| 10 | Controls: keys, thumb stick, Dive button, `hudqa` additions | NOT STARTED | |
| 11 | Balance with a simulated person (`scripts/fieldfeel.mjs`, `difficulty.<level>.fielding`) | NOT STARTED | |
| 12 | Real-game checks, CLAUDE.md / README notes, push, CI | NOT STARTED (CLAUDE.md only got a handoff note) | |

## How to continue (recommended)
Run `superpowers:subagent-driven-development` on the plan. The `.superpowers/sdd/...` workspace is git-ignored; if it is missing (another machine), recreate it
and start a ledger with the first line `# SDD ledger - plan: docs/superpowers/plans/2026-10-05-pitching-polish-and-outfield.md`, copying the committed ledger
for the record. Resume at: (a) re-review `f7179fa` against the Task 7 findings below, then (b) Task 8. Tasks 1-6 are complete; do not redo them.
Models used: sonnet for Tasks 1-5 and their reviews, opus for Tasks 6-7 and their reviews. The owner is new to the terminal: plain-English summaries, exact commands.

## Task 7 fix round 1 - what the re-review must check (it was stopped mid-way)
Commit f7179fa (fix base e7b3aac). The earlier review found two Important issues; the fix claims:
1. The pending pickup time is now ball-at-rest + `fielding.control.autoAfter` + (longest line in the park via `field.parkSpan()`) / fielder speed + `pendingAfter`.
   Check that `parkSpan()` caches correctly when `setPark` rebuilds the outline (`SPAN.poly === PLAYABLE`), and that the test "steered away, then autoSteer" really asserts real pickup < pending pickup.
2. A null / `{kind:'pending'}` / `{kind:'down'}` outcome all give `plan.pending = true` and never throw.
3. Also in the commit: the `field` event dive flag uses `pick.dive` under control; a seeded loop for the runner-prefix invariant; a new pending -> CATCH test; the tautological
   "nothing changes without control" test replaced by a golden check of 10 plans captured from db865df.
4. Two extra planner changes active ONLY for steered (CTRL) plays, found by the pending->catch probe: **F** on a catch that makes the third out, runners who ran on contact
   keep their running legs; **G** a steered ball that will bounce over the wall is a ground-rule double only once it has come down (until then it is a pending hit).
   Confirm both are confined to the CTRL path (the no-control planner must stay byte-identical: `realism.mjs 3000`, `groundcheck.mjs`, `sim.mjs 100 30 pro` unchanged).

## Required items carried into Task 8 (do not skip)
- **Hang fix (Review Focus 1):** `FieldControl` can hang when a ball comes to rest on top of the wall ~6 ft up (3 of 120 steered-away plays in Fenway and Comerica never
  picked up in 120 s) because its pickup rule requires the ball at or below `groundHeight`. In `src/game/fieldControl.js` make a ball at rest (sim ended) count as picked up when
  within `groundGlove` horizontally whatever its height (mirror the planner's `findGroundPickup` fallback) AND add a hard cap `fielding.control.giveUpAfter` so a controlled
  play can never run on forever. Test: steered-away control in Fenway and Comerica always reaches a pickup in bounded time.
- A pending plan (`plan.pending`) is NOT final: its `outsMade`, `result` and events beyond "now" must never be used (its live defense runs at a made-up far-future pickup).
- The engine re-plans at the catch and at the pickup with `planPlay({ ...planIn, control: { pos, runs, outcome }, prev: { paths, t } })`; `FieldControl.outcome` kinds are exactly
  `{kind:'catch',t,dive,ball}`, `{kind:'down',t}`, `{kind:'pickup',t,x,z,dive}`; `down` keeps the plan pending until the pickup. `runs` may be `[track, dive, track]`.
- The app must pass `fielding: settings.fielding` when it builds an Engine for pitching modes (Quick Game, League, Practice-Pitch), 'auto' otherwise; the engine default is 'auto'
  so tests and bots are untouched. The 'contact' event keeps carrying the ORIGINAL automatic plan (app handlers and the landing ring read it); `play.plan` is the pending / re-planned one.
- Tests drive the live fielder with `engine.control.autoSteer(t)` each 1/120 s sub-step (autoSteer results depend on how often it is called).
- Spec wording to fix in Task 12: the setting "Auto" means the old automatic planner with no controlled play; `autoSteer` is for tests, bots and the safety net only (spec 3.3 said otherwise).

## Rulings made on the owner's behalf (all in the ledger; what each costs if wrong)
- Work directly on `main`, no worktree (project rule). Nothing pushed.
- Steered movement has no planner "effort" factor: the player runs at full real speed. If wrong: players catch a bit more than the old automatic play; Task 11 tunes aim help.
- A dive the planner would call a diving catch is aimed straight at the ball (an aim help); other dives are judged by `dive.catchRadius` within `diveSlack`; a press up to
  `diveWindow` early is held back; a press when he could simply run under the ball does nothing. If wrong: dives feel too forgiving or too stiff (Task 11).
- Extra config keys accepted: `fielding.dive.catchRadius` 1.6, `liveLunge` 3, `liveCarry` .8; `fielding.control` `step`, `autoAfter` 8, `diveSlack`, `autoBrake`, `autoReach`, `pendingAfter`;
  `camera.pitchHit` (`rise`, `riseTime`, `fovNear`, `fovFar`, `farFeet`, `homerLook`, `lowLook`, `lowFrom`, plus a pull for high balls); `difficulty.<level>.fielding` (`gloveBonus`, `diveWindow`).
- A controlled pickup always goes to `finishHit`: no bobble roll, no outfield throw-out of the batter at first. With control `airRes` is always the landing time (no early "sure hit" read).
  If wrong: shallow-outfield pickups cannot produce an out at first; runners break a little later.
- Spec change made during planning: a safety net - 8 s after the ball is down with no pickup the auto-pilot takes over (the spec first said "no timeout").
- Task 2: Sim hits, runs, walks, home runs and pitches are also kept out of the career pitching line (not only outs / strikeouts), so career ERA is not skewed by a Sim.
- The "equivalence" test between the live fielder and the old planner is path-correctness from the planner's own catch plus a >= 95% statistic for autoSteer (spec said "within one tick").

## Deferred minor findings (from the reviews; none blocks)
- Task 1: pitchAim.js header comment wrap uneven; `update()` JSDoc lists `pitchStuff` / `mound`.
- Task 2: a game saved mid-way before the change has zero Sim pitches / runs for any Sim already played; runs left on base by a real pitcher that score in a Sim half count as Sim runs.
- Task 3: the pitched ball is only 1-2 px on a pop-up in the hit camera (no minimum on-screen size there; the landing ring, or a larger ball while high, could help - owner to judge);
  `cameraRig.js` has a third copy of the keepBall block; deep fly and homer at ~1 s are mostly sky with the ball visible.
- Task 5: `makeTrackRun` throws on an empty sample list (callers never pass one); an unused `before` variable in a test; `makeLiveDive` accepts either `cfg` or `cfg.dive`.
- Task 6: aimed dive can be ~9-10 ft and point sideways (check on screen in Tasks 9-10); test (g) `console.log`s on every run (should only on failure); a dead `tPrev` in a test helper;
  no reverse-parity guard (a planner hit is never caught by autoSteer); the `runs` getter rebuilds track runs per call.
- Task 7 (reviewer's minors): the renderer reads only `fielderMoves[0]` per position (with two dives the move's run is the last dive; `catchU` is the same, so the picture is right).
- Pre-existing: CLAUDE.md realism baselines are stale (double-play rate is 52% now, CLAUDE.md says 62%): refresh in Task 12.

## Verification state of local `main` (f7179fa)
- Each task's covering test files passed one at a time when its task was committed. `tests/fieldingControl.test.js` 12 tests, `tests/fieldControl.test.js` 14, `tests/fielderMotion.test.js` 58, progression 22, pitchingHalf 47, cameraViews 6.
- The whole suite in one go times out in this tool (~600 s); a run before the Task 7 fix showed 623 passed, 9 skipped, no failure. **Run the files one at a time (`npx vitest run <file> --no-file-parallelism`)
  and run slow ones in the background; baserunning's "across thousands of plays" takes ~110-140 s.** `npm run build && npm run smoke` last passed at Task 4. Not re-run since: `hudqa`
  (about 20 minutes), `playqa`, `leakqa` after Tasks 3-7 (Task 2 ran them clean).
- Never use `cat >> file` without a heredoc and never `pkill -f` / `pgrep -f` (a stray `cat` hung one shell command during this session).
