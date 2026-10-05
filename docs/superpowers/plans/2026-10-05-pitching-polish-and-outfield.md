# Pitching polish and playing the outfield - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confusing break line from the pitching screen, give the pitcher a camera that follows the ball after contact, and let the player steer the outfielder who chases a ball the computer hits (chase and catch).

**Architecture:** The planner (`planPlay`) keeps planning plays at contact; for an outfield ball while you pitch it plans a *pending* play (ball in the air, nobody has the ball yet) and the engine drives the one controlled outfielder live with a new logic module (`fieldControl.js`). When the live fielder catches the ball, or later picks it up after a drop, the engine re-plans through the same `planPlay({ ...planIn, prev })` path used for tapped runners, with an `i.control` input that *gives* the planner the result instead of searching for it. Pure view functions (`cameraViews.js`) hold the new camera maths so it is unit-testable.

**Tech Stack:** Vite, vanilla JS, three.js, Vitest (`npm test`), Playwright-core QA scripts in `scripts/` and `qa-output/`.

**Spec:** `docs/superpowers/specs/2026-10-05-pitching-polish-and-outfield-design.md`

## Global Constraints

- Work on `main`; `git fetch` first. One topic per commit, ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Push to `main` only after the final task's checks are green (the owner authorised pushing; CI "Check the game" is the verdict).
- Every tunable number goes in `src/config.js` with a plain-English comment. No magic numbers in logic. Logic modules (`src/game`, `src/physics`) never import three.js or touch the DOM.
- Timing never depends on frame rate: engine time only, fixed sub-steps for the live fielder (`fielding.control.step` = 1/120 s).
- Renderers read engine state and never change outcomes. Outcomes' randomness only from the engine's seeded rng.
- Text the owner sees is **labels only** (no explanatory sentences). The owner does not code: the final message and any docs speak plain English; never leave TODOs.
- The default engine behaviour must not change: `fielding: 'auto'` (engine default) leaves every existing test and bot result untouched; the app passes the setting only for pitching modes (Quick Game, League, Practice-Pitch). Not in Derby, Sim, bot runs.
- Controlled play only when: you are pitching, `settings.fielding === 'play'`, fair ball, not a home run / ground-rule double, and `plan.fielder` is `LF`, `CF` or `RF`.
- Fielder numbers come from existing config: OF speed 22.5 ft/s, `fielding.accel`, `fielding.brake`, `fielding.glove` 2.4 ft, `fielding.reachHeight`, `fielding.catchHeight`, `fielding.diveExtra`, `fielding.dive.*` (airTime .32, hold .1, getUp .45, throwSet .35).
- After tasks that change fielding or the engine run `npm test` (files one at a time with `npx vitest run <file> --no-file-parallelism` if the full run times out), and `node scripts/sim.mjs 100 30 pro` must stay near the round-fourteen baseline (win ~93%, ~6.65 runs for / ~3.07 against).
- Camera values (`camera.pitchHit`, `camera.chase`) are starting values, tuned by screenshot in Task 9; the owner's playing decides the rest.

## Review Focus

Input classes the spec implies but no obvious task test covers; each has a test in the owning task:
1. Player never touches the controls on a controlled play -> the play still ends (a hit), never hangs (Task 8: `autoAfter`).
2. Pause or window blur while a key is held -> engine clock stops, input is dropped, no stuck movement on resume (Task 10).
3. The catch is the third out with runners on -> inning ends, no runs on tag-ups, runners do not keep running (Task 8, via `endInningStop`).
4. Dive pressed with no ball in reach, or at the wall -> he dives, misses, gets up (existing `dive.getUp`), the ball falls; he never ends outside the ballpark (Tasks 6 and 7).
5. Small phones (360x640, 568x320, 390x844) -> stick and Dive button do not overlap other HUD or the swing/pitch UI (Task 10: `hudqa`).

## File Structure

- Create `src/game/fieldControl.js` - the live controlled fielder (movement, catch / drop / pickup rules, dive, auto-pilot). Logic only.
- Create `src/render/cameraViews.js` - pure functions `pitchHitView`, `chaseView` returning `{ pos, look, fov }`.
- Create `scripts/fieldfeel.mjs` - balance bot for controlled fielding.
- Create tests: `tests/fieldControl.test.js`, `tests/fieldingControl.test.js` (planner), `tests/engineControl.test.js`, `tests/cameraViews.test.js`.
- Modify: `src/render/pitchAim.js`, `src/config.js`, `src/game/fielderMotion.js`, `src/game/fielding.js`, `src/game/engine.js`, `src/game/progression.js`, `src/game/pitchingHalf.js`, `src/render/cameraRig.js`, `src/render/actors.js`, `src/app.js`, `src/ui/ui.js`, `src/style.css`, `CLAUDE.md`, `README.md` (tuning table if it lists camera/pitching keys).

---

### Task 1: Delete the break arc

**Files:** Modify `src/render/pitchAim.js`, `src/config.js:407-420`, `CLAUDE.md`; Test `tests/config.test.js`.

**Interfaces:** Produces: `CONFIG.pitchAim` without any `arc*` key. `PitchAim.update(e, dt, show)` is unchanged.

- [ ] **Step 1: Failing test** in `tests/config.test.js`: `it('the pitching screen has no break arc')` asserts `Object.keys(CONFIG.pitchAim).filter((k) => k.startsWith('arc'))` equals `[]`.
- [ ] **Step 2:** Run `npx vitest run tests/config.test.js` - FAIL (arc keys exist).
- [ ] **Step 3:** In `src/render/pitchAim.js` remove `arcGeo`, `arcMat`, `arcLine`, `arcBeadMat`, `arcBeads`, `arcKey`, `updateArc`, the arc opacity lines in `update`, the `arcLine.position` / `updateArc` / `visible` lines, and any now-unused imports (`buildPitch`, `pitchTopMph`, `pitcherStuff`) and the header comment's arc mention. Remove `arcSteps`, `arcFrom`, `arcColor`, `arcOpacity`, `arcPointPx` from `CONFIG.pitchAim`. In `CLAUDE.md` delete "a faint arc of the chosen pitch's bend at the pitcher's Stuff (last stretch, cached)" and "the dot / break arc / ring / grade word" -> "the dot / ring / grade word".
- [ ] **Step 4:** Run `npx vitest run tests/config.test.js` - PASS. Run `npm run build` - succeeds.
- [ ] **Step 5:** Visual check: start `npm run dev`, load `http://localhost:5173/?mode=quick`, get to the pitching aim screen for each pitch type (keys 1-4), screenshot with playwright-core (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`); no line from any corner. Save shots under `qa-output/` (git-ignored).
- [ ] **Step 6: Commit** `Pitching screen: remove the break line (the dot already is where the pitch crosses; the line was the last stretch of flight flattened onto the plate)`.

---

### Task 2: Round-fourteen hand-over leftovers

**Files:** Modify `src/game/pitchingHalf.js` (and `src/app.js` / `src/game/progression.js` where career pitching is credited); Test `tests/pitchingHalf.test.js`.

**Interfaces:** Consumes `stats.simmedOuts` (outs the computer got for you in a Sim, set in `creditPitching`, `pitchingHalf.js:363`). Produces: career pitching outs / `bestK` / games pitched exclude Sim outs.

- [ ] **Step 1: Failing test** in `tests/pitchingHalf.test.js`: `it('outs from a Sim do not count toward the career pitching outs')` - pitch one real out, then `e.simHalf()` the rest; the value the app writes to `career.pitching.outs` (find where `newPitchStats` data is folded into the save - grep `career.pitching` in `src/app.js` / `src/game/progression.js`; if the fold lives in the app, move its arithmetic into a pure exported function `careerPitchingFrom(stats)` in `pitchingHalf.js` and test that) equals real outs only.
- [ ] **Step 2:** Run it - FAIL.
- [ ] **Step 3:** Implement the exclusion (subtract `simmedOuts`; strikeouts credited during a Sim must not feed `bestK`). Keep Shutout logic (already excludes Sims).
- [ ] **Step 4:** Run the file - PASS.
- [ ] **Step 5: Verification pass**, fixing any failure at its cause (use superpowers:systematic-debugging): `npx vitest run <each file> --no-file-parallelism`; then with a dev server up, `node scripts/playqa.mjs http://localhost:5173`, `node scripts/hudqa.mjs` (must print "no overlaps"), `node scripts/leakqa.mjs http://localhost:5173` (flat counts).
- [ ] **Step 6: Release smoothness.** Write a throwaway `qa-output/releasecheck.mjs` that pitches one ball and logs the pitched ball's world position every engine tick for the first 12 ticks after release; the step between ticks must be about `speed * dt` (< 0.8 ft at 120 Hz for a 90 mph pitch). If it jumps several feet, find the cause (tick sub-steps vs a real jump in `actors.ballInPlay` / `releasePoint`) and fix it; if it is only the sub-steps, say so in the commit message.
- [ ] **Step 7: Commit** `Pitching: Sim outs no longer count toward career pitching; round-fourteen checks run and fixed`.

---

### Task 3: A camera that follows the ball after the computer's contact

**Files:** Create `src/render/cameraViews.js`; Modify `src/render/cameraRig.js` (the `play` and `result` branches), `src/config.js` (`camera.pitchHit`); Test `tests/cameraViews.test.js`.

**Interfaces:**
- Produces: `pitchHitView(ball, t, plan, hand, cfg = CONFIG) -> { pos: [x,y,z], look: [x,y,z], fov }` where `ball` = `{x,y,z}` (the ball now), `t` seconds since contact, `hand` 'L'|'R' (mirrors x), `plan` the engine play plan (uses `plan.homer`, `plan.ballLandDistance`, `plan.type`). `chaseView` is added in Task 9 to the same file.
- Config: `camera.pitchHit = { pos: [-2.4, 12, -70], rise: [24, 18], riseTime: 1.6, fovNear: 46, fovFar: 30, farFeet: 300, homerLook: 18 }` (starting values: eye starts at the pitcher's camera spot, rises by `rise` = [up, back-toward-second] ft over `riseTime` s; the fov narrows from `fovNear` to `fovFar` as the ball goes to `farFeet`).

- [ ] **Step 1: Failing tests** in `tests/cameraViews.test.js`: (a) for balls at (0,1,-30) grounder, (60,40,-150) liner, (0,120,-260) fly, (0,60,-420) homer at t = .2 / 1 / 3 s, the ball's angle from the view axis is under `fov/2` minus 4 degrees; (b) `pos[2] < 0` always (the camera is never behind home plate, `z > 0`); (c) at t = 0 `pos` equals `camera.pitcher.pos` (mirrored for 'L'): no jump; (d) mirrored for a lefty (`pos[0]` sign flips, `look[0]` mirrored).
- [ ] **Step 2:** Run `npx vitest run tests/cameraViews.test.js` - FAIL (module missing).
- [ ] **Step 3:** Implement `pitchHitView` (pure maths, no three.js import; use `smoothstep` / `lerp` from `src/util/math.js`).
- [ ] **Step 4:** In `cameraRig.js`, add a branch before the generic `play` branch: `else if (this.pitching && E && E.play && (phase === 'play' || phase === 'result'))` - take `{pos,look,fov}` from `pitchHitView(actors.ballPos, E.time - E.play.t0, E.play.plan, this.pitcherHand, CONFIG)`, set `tPos/look/tFov`, keep `keepBallOn` logic and `posL = 4, lookL = 6, fovL = 4`; the batting-only branches stay for `!this.pitching`. Make sure `this.pitching` stays true through `play` (check `App.isPitchView`, `app.js:1312`; extend it to cover a play when `e.pitching && !e.simming`).
- [ ] **Step 5:** `npx vitest run tests/cameraViews.test.js` - PASS.
- [ ] **Step 6:** With a dev server, use `app.cam.override` / `window.__app.tick` to force a grounder, a liner, a deep fly, a homer and a pop-up while pitching (`?mode=quick&seed=..` plus `e.contactOverride`), screenshot each at 0.3 / 1 / 2.5 s; adjust `camera.pitchHit` until the ball is readable and nothing looks like it is behind the plate. Keep the shots in `qa-output/`.
- [ ] **Step 7: Commit** `Pitching: after contact the camera rises from the mound and follows the ball (no cut to home plate)`.

---

### Task 4: The Fielding setting

**Files:** Modify `src/game/progression.js` (DEFAULT_SAVE.settings, migration), `src/ui/ui.js` (Settings screen, near the `hand` / `landingRing` rows ~line 437-493), `src/app.js` (setting change handler); Test `tests/progression.test.js`.

**Interfaces:** Produces `settings.fielding: 'play' | 'auto'`, default `'play'`; old saves load with `'play'`. Engine option `fielding` (Task 8) is fed from it.

- [ ] **Step 1: Failing tests** in `tests/progression.test.js`: `DEFAULT_SAVE().settings.fielding === 'play'`; loading a save blob whose settings lack `fielding` gives `'play'`; an invalid value (`'x'`) loads as `'play'`.
- [ ] **Step 2:** Run - FAIL.
- [ ] **Step 3:** Add the default, normalise on load (follow how `umpire` 'on' | 'off' is migrated). In `ui.js` add a two-option `.seg` row labelled **Fielding** with **Play** and **Auto** (copy the pattern of the `hand` row; label only, no sentence); wire the same `data-set` flow the other settings use so `app.settings.fielding` updates and saves.
- [ ] **Step 4:** Run `npx vitest run tests/progression.test.js` - PASS; `npm run build && npm run smoke` - the click-through still passes.
- [ ] **Step 5: Commit** `Settings: Fielding Play / Auto (default Play)`.

---

### Task 5: Live runs in the one movement model

**Files:** Modify `src/game/fielderMotion.js`, `src/config.js` (`fielding.dive.catchRadius`); Test `tests/fielderMotion.test.js`.

**Interfaces:**
- Produces `makeTrackRun(samples: Array<[t, x, z, vx, vz]>) -> run` - a run with `track`, `tStart` (first sample time), `tStop` / `tArrive` (last), `x0,z0`, `xStop,zStop`, `ux,uz,heading` (from the last velocity, or the last move), `segs: []`; `sampleRun(run, t, out)` handles `run.track` (linear interpolation, clamped; `phase` = 'wait' while speed < 0.3 else 'accel'; `speed`, `ux,uz` from interpolated velocity; `done = t >= tStop`).
- Produces `makeLiveDive(state, tL, cfg) -> run` where `state = { x, z, vx, vz }` at launch `tL`: the same shape `planDiveRun` returns (`dive` block with `tL, tLand, tSlideEnd, tHoldEnd, tEnd, Ta, sL: 0, vL = current speed, sFlight, vLand, slideDist, slideDur, decel, hold, getUp, ux, uz, armReach, catchU`), direction = velocity direction (heading if still), `tStart = tL`, so `sampleRun` / `sampleDive` draw it unchanged.
- Config: `fielding.dive.catchRadius` 1.6 ft (the ball must be within this of the glove, which is `armReach` ahead of the body along the dive line, when the glove meets it).

- [ ] **Step 1: Failing tests** in `tests/fielderMotion.test.js`: a track of a straight constant-speed run samples back to within .01 ft at and between samples; clamps before / after; `makeLiveDive` from a standing start at (0,-300) heading +x: body at `tL` is (0,-300), the glove point at `tCatch = tL + airPre` is `armReach` ahead of the body path, `tEnd - tL` equals `airTime-ish + landAfter + slide + hold + getUp`, and `samplePath([track, dive], t)` is continuous at `tL` (< 0.05 ft jump).
- [ ] **Step 2:** Run - FAIL.
- [ ] **Step 3:** Implement both; reuse the Hermite flight maths of `planDiveRun` (extract the shared part into a local helper rather than copying it).
- [ ] **Step 4:** Run `npx vitest run tests/fielderMotion.test.js` - PASS, and `grep -n "\.phase" src/render/actors.js` to confirm every `phase` string the renderer reads is produced (note any in the commit).
- [ ] **Step 5: Commit** `Fielder motion: runs made from a live track, and a dive launched from where he is`.

---

### Task 6: The live fielder (`fieldControl.js`)

**Files:** Create `src/game/fieldControl.js`; Modify `src/game/fielding.js` (export `sampleBall`), `src/config.js` (`fielding.control`, `difficulty.<level>.fielding`); Test `tests/fieldControl.test.js`.

**Interfaces:**
- Consumes `makeTrackRun`, `makeLiveDive`, `Mover`-style limits from Task 5; `sampleBall(sim, t) -> {x, y, z}` (export it); `clampToField`, `fenceDistance` from `physics/field.js`; `defense[pos]` (`x,z,speed,react,type`).
- Produces:
  - `controlEligible(plan, { mode, offense, fielding, simming, bot }) -> boolean` (the rules in Global Constraints; false in Derby).
  - `class FieldControl { constructor({ sim, defense, pos, cfg, level }); setInput(dx, dz) /* field coords, |v| <= 1 */; pressDive(t); advance(t) /* fixed sub-steps to play time t */; get state() /* { x, z, vx, vz, heading, t, diving } */; get outcome() /* null | { kind: 'catch', t, dive, ball } | { kind: 'down', t } | { kind: 'pickup', t, x, z, dive } */; get runs() /* [track run, optional dive run] built from the samples so far */; get finished(); autoSteer(t) /* sets input to the best interception */ }`.
  - Config: `fielding.control = { step: 1/120, autoAfter: 8 }` - `step` 1/120 s is the fixed sub-step, `autoAfter` 8 s is the safety net; `difficulty.<level>.fielding = { gloveBonus, diveWindow }` starting values Rookie `{ 1.2 ft, .22 s }`, Pro `{ .6, .16 }`, All-Star `{ 0, .1 }`.
- Rules (the planner's own, evaluated each sub-step against his real position): catch when `b.y` in [0.5, `reachHeight`], not over the wall, horizontal distance <= `glove + gloveBonus`, and either `b.y <= catchHeight` or the ball is about to leave reach / hit the wall (leap); dive: `pressDive` <= `diveWindow` s before the ball would be within `glove + diveExtra` and `b.y <= 5.2` launches `makeLiveDive`; a diving glove catches when the ball is within `dive.catchRadius` of the glove at any step from `tCatch - .05` to `tCatch + .05`. Movement: velocity chases `input * speed` with `fielding.accel` / `fielding.brake`, inside the field and at least `wallBody` from the wall. After the ball is down (`firstBounce` / `wallHit` / on the ground, `y <= groundHeight`) outcome `down`, then `pickup` when within `groundGlove` of the ball; `autoAfter` seconds after `down` the auto-pilot takes over.

- [ ] **Step 1: Failing tests** in `tests/fieldControl.test.js`: (a) standing still under a fly ball that lands at his feet -> `catch` at about the time it comes down to `catchHeight`; (b) standing 40 ft from the landing spot -> `down` then no pickup while idle until `autoAfter`, then `pickup` by the auto-pilot; (c) moving full speed toward the landing spot from a start the planner says is catchable -> `catch`; (d) input vector longer than 1 is clamped (never faster than `defense[pos].speed`); (e) he never ends outside the ballpark with full input toward the wall for 8 s (`isInsideField(x, z, 0)`); (f) dive: ball 7 ft from a runner at 5 ft height with `pressDive` at the right moment -> `catch` with `dive: true`; pressed 0.5 s early -> a dive that misses, then `down`; (g) `autoSteer` run on 300 seeded fly balls the old automatic plan catches (use `simulateBattedBall` with `defense` from `createDefense`) catches >= 97% of them within 0.15 s of the planner's `catchT`.
- [ ] **Step 2:** Run - FAIL (module missing).
- [ ] **Step 3:** Implement `FieldControl` as described; `autoSteer` = aim at the planner-style interception point (the spot where `tryFielder` from `findAirCatch` first succeeds for this fielder; for a ground ball, `findGroundPickup`'s spot). Samples recorded every sub-step as `[t, x, z, vx, vz]` (thin to one per 1/60 s).
- [ ] **Step 4:** Run `npx vitest run tests/fieldControl.test.js` - PASS.
- [ ] **Step 5: Commit** `Fielding: a live, steerable outfielder (movement, catch / dive / drop / pickup rules, auto-pilot)`.

---

### Task 7: The planner takes the result from the live fielder

**Files:** Modify `src/game/fielding.js` (`planPlay` input, `planPlayCore` air-catch and pickup branches); Test `tests/fieldingControl.test.js`.

**Interfaces:**
- Consumes `FieldControl` outputs (Task 6): `runs`, `outcome`.
- Produces an optional planner input `i.control = { pos, runs, outcome }` where `outcome` is one of `{ kind: 'pending' }`, `{ kind: 'catch', t, dive, ball }`, `{ kind: 'pickup', t, x, z, dive }`. Without `i.control` nothing changes.
- Behaviour:
  - `pending` (planned at contact): skip `findAirCatch`; plan the fair ball as a *ground-style hit* whose pickup is at `sim.duration + fielding.control.autoAfter + 4` s by the controlled fielder at the ball's resting spot, `plan.pending = true`, `plan.endTime` = that time + 1; the controlled fielder's path is `i.control.runs` (his live run); other fielders get `addSupport` jobs as in any hit; runners are forced-only as always; the air read (`plan.airRes`) is the one a drop would give (identical to a catch's, by the existing design).
  - `catch`: synthesise `air = { t, f: defense[pos], ball, dive, avail: Infinity }` (no random error roll for the controlled catch), use the existing caught branch unchanged (outs, `runnersGoBack`, `caughtRunners`, infield-fly not applicable), and set `plan.paths[pos] = i.control.runs`.
  - `pickup`: synthesise `pick = { f, t, ball: { x, z, y: 0 }, dive, avail: Infinity, start: 0 }` for `findGroundPickup`'s result and continue with the existing ground branch; `paths[pos] = runs`.
- Invariant for the engine: planning `pending` then `pickup` with the same `prev` leaves every runner's moves before the pickup identical.

- [ ] **Step 1: Failing tests** in `tests/fieldingControl.test.js` (build a seeded fly ball to CF with `simulateBattedBall`, `createDefense`, empty bases and then runner on first / second): (a) `pending` plan: `plan.pending === true`, `plan.caught` falsy, `plan.fielder === 'CF'`, `plan.paths.CF === runs`, `plan.outsMade === 0`; (b) `catch` plan equals the old automatic plan on `result`, `outsMade`, `caught`, and `catchT` within 0.15 s, for 100 seeded balls the old plan catches (use `FieldControl.autoSteer` to produce the outcome); (c) a stand-still track with a drop -> `pending` then `pickup` yields `result` in `single|double|...` per the existing hit rules and `auditPlan` (from `playAudit.js`) reports no problem; (d) **invariant**: with runners on first and second, every `moves` entry's path prefix before the pickup time is the same between the `pending` plan and the `pickup` plan (compare `runnerPosition(move, t)` for t in 0..tPickup - .01); (e) with two outs and a runner on third, a controlled catch ends the inning (`plan.outsMade === 1`, no run scores: `plan.moves` have no `to: 4` that scores) via `endInningStop`.
- [ ] **Step 2:** Run - FAIL.
- [ ] **Step 3:** Implement. Keep the code at the three branch points (`planPlay` stores `CTRL = i.control || null` like `ORD`, reset in `finally`); a helper `controlledFielder(plan, defense)` returns the person; use `PREV` / `keepOldRuns` as for orders. Do not touch the code paths used when `CTRL` is null.
- [ ] **Step 4:** Run `npx vitest run tests/fieldingControl.test.js tests/fielding.test.js tests/groundouts.test.js tests/baserunning.test.js --no-file-parallelism` - PASS.
- [ ] **Step 5: Commit** `Planner: take the catch / pickup from a live fielder (i.control); nothing changes without it`.

---

### Task 8: The engine runs a controlled play

**Files:** Modify `src/game/engine.js` (constructor option `fielding`, `resolveContact`, `updatePlay`, `finishPlay` guard), `src/game/pitchingHalf.js` if the play hooks live there; Test `tests/engineControl.test.js`.

**Interfaces:**
- Consumes Tasks 6-7. Produces on `Engine`: constructor option `fielding: 'auto' | 'play'` (default `'auto'`); `engine.control` getter -> the live `FieldControl` of the current play or `null`; `engine.fieldInput(dx, dz, dive)` (field coordinates; `dive` true = a press this frame); events `emit('controlStart', { pos })` at contact and `emit('controlEnd', { outcome })`; `play.control` holds the `FieldControl`.
- Flow: in `resolveContact`, after the normal `planPlay`, if `controlEligible(plan, ...)` and `this.fielding === 'play'`: build `FieldControl`, re-plan with `control: { pos, runs, outcome: { kind: 'pending' } }`, then each tick in `updatePlay` call `control.advance(t)`; when `outcome` first becomes `catch` or `pickup`, re-plan (`planPlay({ ...planIn, control, prev: { paths, t } })`), rebuild `p.events` with `nextEvent` at the first event with `e.t >= t`, emit the same events as any play; while `control` is not finished `updatePlay` never calls `finishPlay` and ignores `plan.endTime`. Orders from the computer's runners keep working through `applyRunnerOrder` (include `control` in the re-plan input so it persists).

- [ ] **Step 1: Failing tests** in `tests/engineControl.test.js` (engine with `cpuHalf: 'pitch'`, `fielding: 'play'`, seeded, `contactOverride` to force a fly ball to CF): (a) eligibility: infield ground ball, a homer, a foul, `mode: 'derby'`, `fielding: 'auto'`, `simming` -> `engine.control === null`; (b) a lazy fly to CF -> `engine.control` set with `pos 'CF'` and `controlStart` emitted; (c) feeding `autoSteer` -> an out is recorded, `outs` +1, the half proceeds to the next batter; (d) **idle player**: no input at all -> within `autoAfter + 10` engine seconds the play ends as a hit and the game proceeds (no hang), `e.phase` leaves `play`; (e) third out on the catch with a runner on third: no run scored, inning over; (f) the referee: `auditPlan(plan)` is clean for 200 seeded controlled plays with auto-pilot input; (g) pausing: `engine.paused` true -> no state change over 5 s of `update`.
- [ ] **Step 2:** Run - FAIL.
- [ ] **Step 3:** Implement as described. Keep the `fielding` option out of `saveState`; a resumed game starts the pitch again.
- [ ] **Step 4:** `npx vitest run tests/engineControl.test.js tests/engine.test.js tests/pitchingHalf.test.js tests/rundown.test.js --no-file-parallelism` - PASS; `node scripts/sim.mjs 100 30 pro` stays near baseline (it runs with the default `'auto'`).
- [ ] **Step 5: Commit** `Engine: a controlled outfield play (live fielder, re-plan at the catch and at the pickup, safety net)`.

---

### Task 9: What you see - the controlled fielder, the ring, the chase camera

**Files:** Modify `src/render/cameraViews.js` (`chaseView`), `src/render/cameraRig.js`, `src/render/actors.js` (`updateFielders`), `src/config.js` (`camera.chase`, `fielderRing`), `src/app.js` (landing ring and `engine.control` wiring); Test `tests/cameraViews.test.js`.

**Interfaces:**
- Produces `chaseView(fielder, ball, landing, cfg = CONFIG) -> { pos, look, fov, yaw }` where `fielder` = `{x,z}`, `ball` = `{x,y,z}`, `landing` = `{x,z}|null`, and `yaw` is the fixed angle (radians) the screen axes are rotated by: **up on the screen = away from home plate along the line home -> landing spot, fixed at contact** (`cameraRig.chaseYaw`, read by the app in Task 10). `camera.chase = { back: 55, up: 38, fovMin: 34, fovMax: 60 }` starting values: the camera stands `back` ft on the home side of the fielder, `up` ft high, looking at the midpoint of fielder and ball, widening to keep both in frame.
- Consumes `engine.control.state`.

- [ ] **Step 1: Failing tests** in `tests/cameraViews.test.js`: for fielders and balls over 12 seeded fly balls both the fielder and the ball are within `fov/2 - 4` degrees of the view axis at 0 / 1 / 2.5 s; `yaw` is constant across the play (pass the same `landing`) and a unit "up" vector rotated by `yaw` points from home toward the landing spot (dot product > .99).
- [ ] **Step 2:** Run - FAIL.
- [ ] **Step 3:** Implement `chaseView`. In `cameraRig` add the branch `else if (this.pitching && E && E.control)` with the view and store `this.chaseYaw`. In `actors.updateFielders`: for `pos === E.control.pos` while the control is live, use `E.control.state` for position / facing / dive pose instead of `plan.paths` (the plan's `paths[pos]` already equals `control.runs`, so drawing from it after the catch / pickup needs no change); add a bright ring mesh at his feet (`CONFIG.fielderRing`, picture only, hidden otherwise, disposed with the stadium like other meshes). In `app.js` show the landing ring as now (the engine's `landing` comes from `landingSpot(sim, plan)`; for the pending plan compute it from the sim directly).
- [ ] **Step 4:** Run `npx vitest run tests/cameraViews.test.js` - PASS.
- [ ] **Step 5:** With a dev server, force a fly ball to each outfield position (and a gapper, and a ball down the line) under `fielding=play`, drive input with `window.__app.engine.fieldInput(...)`, screenshot at 0 / 1 / 2 / 3 s; tune `camera.chase` until the ball, the fielder and the ring are always in frame. `node scripts/leakqa.mjs` stays flat.
- [ ] **Step 6: Commit** `Fielding view: your outfielder wears a ring, the landing ring shows where it comes down, a chase camera keeps both in frame`.

---

### Task 10: Controls - keys, thumb stick, Dive

**Files:** Modify `src/app.js` (input), `src/ui/ui.js` (`setFielding`, stick and Dive button), `src/style.css`; Test: `scripts/hudqa.mjs` additions and a playwright check in `qa-output/`.

**Interfaces:**
- Consumes `engine.control`, `engine.fieldInput(dx, dz, dive)`, `cameraRig.chaseYaw`.
- Produces `ui.setFielding({ active })` showing / hiding `.fieldstick` (floating thumb stick, appears under the left thumb, left half of the screen, touch only) and `.divebtn` (round Dive button, bottom-right, touch only; Space / Shift on keyboards); `ui.onFieldStick(cb)` reports a vector `{x, y}` in screen axes (x right, y up, |v| <= 1). The app rotates it by `chaseYaw` into field axes each frame and calls `engine.fieldInput`. Arrow keys / WASD use the same path (`aimKeys` are not reused: while `engine.control` is live they feed the fielder, not the bat).

- [ ] **Step 1:** Extend `scripts/hudqa.mjs` so it forces a controlled play on (`fielding: play`, a fly ball to CF while pitching) in each mode, shows the stick and Dive button, and prints any overlap with other boxes; run before the change and see it fail to find the new boxes (the element is missing), after it passes "no overlaps" at 568x320, 844x390, 1280x720, 390x844, 360x780, 640x360.
- [ ] **Step 2:** Implement the UI (touch pointer events; the stick is relative to where the thumb lands; releasing sets the vector to zero), the keyboard (hold state, released on `keyup`, `blur`, `visibilitychange` and when the app pauses - Review Focus 2) and the app wiring (`setFielding({ active: !!e.control && !paused })` every frame; hide pitch buttons / Bullpen / Sim during a controlled play as during any play). Labels only: **Dive**.
- [ ] **Step 3:** Playwright check (`qa-output/fieldinput.mjs`, throwaway): keyboard run toward the landing spot catches; holding ArrowUp then pausing (Esc) then resuming does not keep moving him; a touch drag with a synthetic `PointerEvent` sequence moves him; Space triggers a dive.
- [ ] **Step 4:** `node scripts/hudqa.mjs`, `node scripts/playqa.mjs http://localhost:5173`, `npm run build && npm run smoke` - all clean.
- [ ] **Step 5: Commit** `Fielding controls: arrow keys / WASD, a thumb stick on phones, Dive`.

---

### Task 11: Balance with a simulated person

**Files:** Create `scripts/fieldfeel.mjs`; Modify `src/config.js` (`difficulty.<level>.fielding`, `fielding.control`); Test `tests/fieldControl.test.js` (a guard).

**Interfaces:** `node scripts/fieldfeel.mjs [balls] [casual|average|expert] [rookie|pro|allstar]` prints, per level, the share of *catchable balls* (balls the old automatic play caught with an outfielder) the simulated person catches, plus misses by cause (late start, wrong line, dive too early / late). The person: reaction delay `react` (casual .35 s, average .25, expert .15), stick noise (casual 12 deg), steers toward the landing ring, dives when within `diveExtra` of the ball and below 5.2 ft with its own timing error.

- [ ] **Step 1:** Write the script (use `FieldControl` and seeded `simulateBattedBall`, no browser).
- [ ] **Step 2:** Run it; tune `difficulty.<level>.fielding` (`gloveBonus`, `diveWindow`) until casual >= Rookie 85% / Pro 70% / All-Star 55% and expert >= 95%.
- [ ] **Step 3:** Add a guard test in `tests/fieldControl.test.js`: with a fixed-seed casual person at 200 balls, catch rate on Pro is between 60% and 85% (wide band so tuning does not break it).
- [ ] **Step 4:** `node scripts/pitchfeel.mjs 600 average` stays inside its bands (the auto path is unchanged; with `fielding: 'play'` run it once with the auto-pilot input to confirm parity).
- [ ] **Step 5: Commit** `Fielding balance: aim help by level, a simulated person to measure it`.

---

### Task 12: Real-game checks, notes, release

**Files:** Modify `CLAUDE.md`, `README.md` (the tuning table, plain English); QA scripts in `qa-output/` (throwaway).

- [ ] **Step 1:** Full verification, fixing causes not symptoms: `npm test` (file by file if needed), `npm run build && npm run smoke`, with a dev server `node scripts/hudqa.mjs`, `node scripts/playqa.mjs http://localhost:5173`, `node scripts/leakqa.mjs http://localhost:5173`, `node scripts/wallcheck.mjs` (no fielder outside the park, including controlled ones: add a controlled run into each wall corner to `qa-output`), `node scripts/sim.mjs 100 30 pro`, `node scripts/groundcheck.mjs` ("no problems").
- [ ] **Step 2:** Play one full pitching half in a headless browser at 844x390 with real taps (pitch, then a controlled catch by touch, then a miss and a run-down) and look at the screenshots.
- [ ] **Step 3:** Update `CLAUDE.md`: a "Round fifteen" entry under "Where things stand" (what was removed / added, plain words), the new modules in the Architecture module map (`fieldControl.js`, `cameraViews.js`), the engine's `fielding` option and `i.control` in the Logic section, the Tuning table rows (`fielding.control`, `difficulty.<level>.fielding`, `camera.pitchHit`, `camera.chase`), baselines from `fieldfeel.mjs`, and Known issues: feel of the fielding controls, the chase camera and the thumb stick on a real phone is untested by the owner. Update `README.md`'s tuning table likewise.
- [ ] **Step 4: Commit** `Notes: round fifteen (pitching cleanup, hit camera, playing the outfield)`; `git fetch`, rebase if needed, `git push origin main`; check the "Check the game" run with `gh run list --limit 1` until green (`gh run watch`).
- [ ] **Step 5:** Tell the owner in plain English what changed, how to try it (Play -> Quick Game, pitch, wait for a ball to the outfield; Settings -> Fielding to switch it off), and that feel is untested.
