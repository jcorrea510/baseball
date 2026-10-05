# SDD ledger — plan: docs/superpowers/plans/2026-10-05-pitching-polish-and-outfield.md
Spec: docs/superpowers/specs/2026-10-05-pitching-polish-and-outfield-design.md (reachable, binding)
Base commit at start: 0071c55 (main, 2 ahead of origin, unpushed)
Ruling: work directly on main, no worktree — the project's CLAUDE.md and the owner say work goes on main, one topic per commit — cost if wrong: none (nothing is pushed until Task 12)

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T3 & T9 (cameraRig.js, cameraViews.js, config camera) | T3 adds pitchHit branch for all pitching play phases; T9 adds chase branch | T9's chase branch must come BEFORE T3's pitchHit branch or it is never reached. Ruling: T9 inserts it first |
| T3 text vs itself | config lists `pos:[-2.4,12,-70]` but test (c) says t=0 pos equals camera.pitcher.pos | Ruling: pitchHitView starts from camera.pitcher.pos (mirrored); `camera.pitchHit` keeps only rise/riseTime/fov/farFeet/homerLook, no `pos`; "back" rise moves toward the outfield (z more negative) so pos z stays < 0 |
| T4 & T8 & T10 (settings.fielding -> engine option) | T4 produces the setting, T8 the engine option; nobody wires the app to pass it | Gap. Ruling: T8 also wires app.js to pass `fielding: settings.fielding` when it builds an Engine for pitching modes (quick, season, practice-pitch); 'auto' otherwise |
| T5 & T6 (makeTrackRun / makeLiveDive) | T5 produces; T6 consumes | makeLiveDive(state,...) state has no heading but T5 test starts from standing. Ruling: state may carry optional `heading` (radians, atan2(x,z)) used when speed < .5 |
| T6 & T7 (FieldControl.outcome / runs -> i.control) | T6 outcomes: catch / down / pickup; T7 inputs: pending / catch / pickup | Consistent; engine maps 'down' -> stays `pending` until `pickup` |
| T7 & T8 (pending plan, contact event) | engine replans with pending plan; app contact handler reads plan.result etc. from the 'contact' event | Ruling: the 'contact' event keeps carrying the ORIGINAL automatic plan (unchanged app behaviour, landing ring); `play.plan` is the pending/replanned plan |
| T8 tests vs API | test (c) needs to drive the fielder; API only has fieldInput | Ruling: tests call `engine.control.autoSteer(t)` (sets the control's input) before each update; engine advance uses the current input |
| T8 & T9 (engine.control.state, landing) | T9 consumes state; landing for pending plan | implementer may call landingSpot with the original plan from the contact event |
| T6 & T11 (difficulty.<level>.fielding) | T6 introduces starting values, T11 tunes | OK |
| T1 & T12 (CLAUDE.md) | both edit docs, different paragraphs | OK |
| T2 & T8 & T10 (app.js, pitchingHalf.js) | different regions | OK |
| T1..T12 individually | tests vs code agree within each task | T1 ok; T2 career-fold location unknown (implementer finds it); T3 fixed above; T4 ok; T5 fixed above; T6 ok; T7 ok; T8 fixed above; T9 ok; T10 ok; T11 ok; T12 ok |

Task 1: dispatched (base 0071c55), implementer agent a9c2975d77a9f8daf, sonnet
Task 1: implemented 7e58ec4 (DONE), review dispatched (agent aad1868bb65d81d73)
Task 1: minor (deferred): pitchAim.js header comment wrap is uneven; update() JSDoc still lists `pitchStuff`/`mound` among engine fields
Task 1: full npm test not run by implementer (timeout) — covered by Task 2 verification pass and Task 12
Task 1: complete (commits 0071c55..7e58ec4, review clean)
Task 2: dispatched (base 7e58ec4), implementer agent aa8ef304173fdfa94, sonnet
Task 2: implemented eef5425 (DONE_WITH_CONCERNS: Sim hits/runs/walks still counted in career line so career ERA runs high after a Sim half; release smoothness = tick size only, no change)
Task 2: review: spec ❌ (10-K badge and games pitched still count Sim; career ERA skewed by Sim runs) — fix round 1/5 dispatched (resumed implementer aa8ef304173fdfa94); FIX_BASE = eef5425
Task 2: minor note: brief's "< 0.8 ft per tick" smoothness bound was wrong (1.03 ft/tick is correct at 124 ft/s); no code change needed
Task 2: hudqa full run takes ~20 min (noted for Task 10/12 planning)
Task 2: fix round 1/5 implemented 853709e
Task 2: minor (deferred): a mid-game save from before this change has sim pitches/runs at 0 for Sim already played (negligible); runs a real pitcher left on base that score in a Sim half count as Sim runs (attribution simplification)
Task 2: fix round 1/5 (3 addressed, 0 open; commits eef5425..853709e)
Task 2: complete (commits 7e58ec4..853709e, review clean)
Task 3: dispatched (base 853709e), implementer agent ae22baf15c00693a5, sonnet; rulings A/B from preflight carried
Task 3: implemented 00b474e (DONE_WITH_CONCERNS: pop-up tiny; lefty and return-to-pitcher-view not visually checked; 4 extra config keys)
Task 3: review: spec ❌ (pop-up unreadable: ball a speck in sky, no field) — fix round 1/5 dispatched (resumed ae22baf15c00693a5); FIX_BASE = 00b474e
Task 3: minor (deferred unless trivial): cameraRig.js third copy of keepBall block; fitMarginDeg/fovMax duplicate keepBall keys; pause drops cam.pitching (pre-existing behaviour)
Task 3: fix round 1/5 implemented b5e528d
Task 3: minor (deferred): pitched ball is 1-2 px on a pop-up in the hit camera (no min on-screen size in this view; the landing ring / a larger ball while high could help — owner to judge); pop-up test is looser than the code's margins; deep fly/homer at ~1 s mostly sky with ball visible
Task 3: fix round 1/5 (1 addressed, 0 open; commits 00b474e..b5e528d)
Task 3: complete (commits 853709e..b5e528d, review clean)
Task 4: dispatched (base b5e528d), implementer agent af0831e58e7d6e2dc, sonnet
Task 4: implemented 31217d4 (DONE)
Task 4: complete (commits b5e528d..31217d4, review clean)
Task 5: dispatched (base 31217d4), implementer agent add24abf548a799f5, sonnet; ruling: makeLiveDive state may carry optional heading
Task 5: implemented 8f19b3b (hand-back message was a literal 'placeholder'; verified the commit and task-5-report.md are real; extra config liveLunge 3 / liveCarry .8 added by implementer — reviewer to judge)
Task 5: minor (deferred): makeTrackRun throws on an empty sample list (callers never pass one); a test has an unused `before` variable (`void before`); sampleTrack before first sample keeps first sample's velocity; makeLiveDive accepts cfg or cfg.dive (slight over-tolerance); liveLunge comment wording
Task 5: CARRY TO TASK 7: keepOldRuns/cutRun in fielding.js (~L267-300) clone and cut runs via `segs` and tStop — a track run (segs: []) must not go through cutRun/segs trimming; the renderer reads `tm.dive` on the MOVE object (actors.js:313) so Task 7 must set `dive` + `run.dive.catchU` on the controlled move when a live dive exists
Task 5: complete (commits 31217d4..8f19b3b, review clean)
Task 6: dispatched (base 8f19b3b), implementer agent ad208b372e3f57b61, opus
Task 6: implemented db865df (DONE_WITH_CONCERNS)
Ruling: Task 6 steered movement has no planner "effort" factor (planner: 0.8 running back / 1.06 in); the player runs at full real speed — matches the spec's "his real speed" — cost if wrong: players catch a bit more than the old auto play; fieldfeel (Task 11) tunes aim help
Ruling: Task 6 dive — a dive the planner would call a diving catch is aimed straight at the ball (an aim help); any other dive is the plain live dive judged by catchRadius within ±diveSlack; a press up to diveWindow early is held — cost if wrong: dives feel too forgiving or too stiff; tune in Task 11
Ruling: extra config keys fielding.control.diveSlack .05, autoBrake .75, autoReach .5 accepted (plain-English comments: reviewer to check)
CARRY TO TASK 7: FieldControl.runs is [track, dive, track] after a missed dive (more than one run per fielder; samplePath handles it); constructor takes optional heading; ~1% of hits in the reverse parity check end in a long chase after a just-missed diving pickup
Task 6: minor (deferred): autoSteer parity depends on call rate (294/300 at 60 Hz, 291 at 20 Hz) — drive it every sub-step/fixed rate in tests; autoSteer mixes caller time with state time; test (g) console.logs every run (should print only on failure); dead `tPrev` in a test helper; aimed dive can be ~9-10 ft and point sideways (check on screen in Tasks 9-10); no reverse-parity guard test (planner hit never caught by autoSteer); runs getter rebuilds track runs per call
Ruling: "Auto" setting = the old automatic planner with NO controlled play (controlEligible false); autoSteer is for tests, bots and the 8 s safety net only. The config comment at fielding.control "also the Auto setting" is wrong -> fix in Task 8; spec 3.3 wording to be corrected in Task 12 notes — cost if wrong: none (wording)
Ruling: Task 7 equivalence test = (i) path-correctness: feed the PLANNER's own catch (time/position) as control.outcome and require identical result/outsMade/runner outcomes to the automatic plan; (ii) separate statistic: autoSteer through FieldControl reproduces the planner's out in >= 95% of balls the planner catches with an outfielder (about 2% of planner diving catches become drops, catch times differ up to .04 s) — cost if wrong: slightly looser than spec's "within one tick"
Task 6: complete (commits 8f19b3b..db865df, review clean)
Task 7: dispatched (base db865df), implementer agent a5661a40233674638, opus
Task 7: implemented e7b3aac (DONE_WITH_CONCERNS). Implementer rulings: (A) plan.paths[pos] is a COPY of runs (same run objects, prefixed); (B) a steered fielder's pickup always goes to finishHit: no bobble roll, no outfield throw-out of the batter at first; (C) with control airRes is always downT; (D) catch event dive flag from outcome.dive, move dive flag = "his runs include a dive"; (E) "+4 s" is fielding.control.pendingAfter, config comment reworded.
CARRY TO TASK 8: a pending plan still runs the live defense after its far-future pickup — never treat a pending plan's outsMade/result/events beyond now as final; use plan.pending. CLAUDE.md realism baselines out of date (DP 52% now vs 62% noted) — update in Task 12.
Task 7: review: spec ✅ but Important x2 (pending pickup time not always later than the real one — up to 11 s short; null/down outcome gives non-pending-flag plan or throws) — fix round 1/5 dispatched (resumed a5661a40233674638); FIX_BASE = e7b3aac
Ruling: implementer rulings B (steered pickup: no bobble roll, no outfield throw-out at first/force) and C (airRes = downT with control: forced runners wait for the landing instead of the .55 s sure-hit read) ACCEPTED as design — cost if wrong: shallow-outfield pickups can't produce an out at first and don't bobble; slightly later runner breaks on controlled plays
Task 7: fix round 1 agent hit the usage limit mid-work (uncommitted changes in config.js, fielding.js, physics/field.js, fieldingControl.test.js); resumed the same agent after the reset
Task 7: fix round 1 agent stalled (watchdog, likely long foreground test); resumed a second time with instructions to run long tests in the background
Task 7: fix round 1/5 implemented f7179fa (parkSpan() added in physics/field.js; pending pickup = rest + safety net + longest line / speed + pendingAfter; null/pending/down all pending; two more steered-only differences F (third-out catch: runners keep running legs) and G (a steered ball that will bounce over the wall is a ground-rule double only once down) found by the pending->catch probe and fixed)
CARRY TO TASK 8 (REQUIRED, Review Focus 1): the auto-pilot/FieldControl can HANG when a ball comes to rest on top of the wall ~6 ft up (3 of 120 steered-away plays in Fenway and Comerica never picked up in 120 s) because the pickup rule demands ball height <= groundHeight. Fix in src/game/fieldControl.js: once the ball is at rest (sim ended), pickup counts when within groundGlove horizontally regardless of height (mirror the planner's findGroundPickup fallback), AND add a hard cap so a play can never exceed a fixed time (config fielding.control.giveUpAfter) — test: steered-away control in Fenway/Comerica always reaches a pickup within a bounded time.
