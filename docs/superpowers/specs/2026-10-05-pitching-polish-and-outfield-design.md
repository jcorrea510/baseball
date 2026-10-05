# Pitching polish and playing the outfield (round fifteen)

Owner's notes (Oct 5): "the pitching ui just isn't good and looks glitched - it shows a line from the top right corner no matter what
pitch type you're on ... after any contact the camera shifts to behind the batter in an awkward way ... I also want a way to play
outfield, not just have it happen automatically. Overall it just needs a lot of work."

## What we agreed

- **Who / why:** the owner plays Sandlot to enjoy it and judges by playing. They pitch the computer's half (round fourteen) and now want
  the pitching screen to make sense and the defence to be something they *do*, not something that happens to them.
- **Three pieces, built in this order** (one plan, three commits-worth of topics):
  1. Pitching screen cleanup (the line, leftovers from round fourteen's hand-over list).
  2. A camera that makes sense after the computer's batter makes contact.
  3. **Play the outfield:** "chase and catch", steered directly.
- **Agreed answers:**
  - Outfield = when the computer hits a ball an outfielder goes after, you steer that outfielder and catch it (or miss it). The throw
    afterwards stays automatic. Not full throwing control, not a separate mode.
  - Steering = direct: arrow keys / WASD, a thumb stick on a phone, plus a Dive button. Real skill: a ball you misjudge falls in.
  - After contact the camera "looks where the ball goes" (from the mound, round toward the outfield), no cut to home plate.
- **Not in this spec:** infield fielding control, controlling throws, the computer's runners (you still never send them), Derby, bunts.
  Any further pitching notes the owner sends are added to piece 1 before the plan is written.

## 1. Pitching screen cleanup

- **Delete the break arc** (`render/pitchAim.js` `updateArc`, `arcLine`, `arcBeads`, `CONFIG.pitchAim.arc*`). Why: the target dot is already
  where the pitch crosses the plate (`buildPitch` is solved *to* the aim, break included); the arc only drew the last 40% of the flight
  flattened onto the plate plane, which from the mound is a diagonal line into the dot that looks the same for every pitch. It carries no
  information. The dot, the shrinking ring and the grade word stay.
- Remove the arc's cache key and its mention in `CLAUDE.md`'s pitching-view paragraph.
- **Leftovers from the round-fourteen hand-over (CLAUDE.md "left for the next session")**, done as a verification pass, fixing what turns up:
  full test suite file by file, `playqa`, `hudqa`, `leakqa` against a dev server; look at a delivery at 25 / 50 / 75 / 95% and a result
  (`qa-output/pf-*.png`); confirm the pitched ball leaves the hand smoothly (it moved several feet within six ticks after release - find out
  if that is the tick sub-steps or a real jump); Sim outs must not count toward career pitching, 10 K or games pitched.
- Success: no line on the pitching screen at any pitch type or size; hudqa prints "no overlaps"; the checks above are green.

## 2. Camera after contact while you pitch

Today `cameraRig` has no idea you are pitching once a ball is in play: the `play` branch uses the batting camera behind home plate (its
`basePos`), so the camera jumps from the mound to behind the batter.

- New `camera.pitchHit` view (config, picture only) used when `E.pitching` and the phase is `play` / `result` with a play:
  - It starts exactly where the pitcher's camera was (no cut) and eases up and slightly back over the mound while its look target follows
    the ball (the existing `interest` point and `keepBall` logic: a high ball never leaves the picture). You look out toward the outfield,
    the way the ball flies. Ground balls and short hits use a wider fov so the infielders and the throw are in frame.
  - Home runs: look up at the seats / fireworks as now (`homerAfter`), but from this camera.
  - A ball you can chase (piece 3) uses the chase camera instead.
  - After the play it eases back to the pitcher's view (the existing `pitching` branch), as the camera already does between pitches.
- Batting is untouched (the batting camera logic stays as is). Only the `E.pitching` case gets the new branch.
- Success: no frame where the camera sits behind home plate while you pitch; the ball is in frame on every hit type (checked with the
  existing QA camera overrides and screenshots of a grounder, a liner, a deep fly, a homer, a pop-up).

## 3. Play the outfield

### 3.1 When you get control
All of: you are pitching (Quick Game, League or Practice-Pitch; not Derby, not Sim, not the bot), `settings.fielding === 'play'`
(new setting, default `play`, in Settings; migrated into old saves), the ball is fair, not a home run, and the fielder the planner sends
after it (`plan.fielder`) is LF / CF / RF. That includes a grounder or liner that gets through the infield to an outfielder. Everything else
(infield plays, homers, fouls, Sim, bots, tests) stays on the existing automatic planner, unchanged.

### 3.2 What you see and do
- At contact the planner plans the play exactly as today (it needs the ball's flight and who chases). The engine marks the play
  `plan.control = { pos, ... }` for that outfielder. A bright ring at his feet shows he is yours. The existing landing ring shows where the
  ball comes down (and obeys the existing ring switch).
- **Chase camera** (`camera.chase`): high, on the home-plate side of the fielder looking toward him and the ball, so *up on the screen is
  away from home* (toward the wall) and left / right are left / right; it does not rotate while you steer. It keeps the fielder, the ball
  and the landing spot in frame (`keepBall`).
- **Steering:** arrow keys / WASD; on touch a floating thumb stick (appears where the left thumb lands, left half of the screen).
  **Dive:** Space or Shift on a keyboard, a round Dive button bottom-right on touch. HUD: nothing else (labels only); the pitching HUD is
  hidden during a controlled play as it already is during any play.
- **Movement** uses the one movement model (`fielderMotion.js`): his real `speed` (OF 22.5 ft/s), `fielding.accel`, `fielding.brake`,
  kept inside the field and the wall. You may move from the instant of contact (he has no artificial reaction delay: your own reaction is
  the delay), at his normal running speed.
- **Catching** (the planner's own rules, evaluated against his real position every engine tick, not a copy): a catch happens when the ball
  is catchable (above 0.5 ft, within `fielding.reachHeight`, not over the wall) and he is within `fielding.glove` of it. A ball above
  `fielding.catchHeight` is taken as soon as it comes down to that height, or at the lowest height he can reach if it is about to leave
  reach or hit the wall (a leap at the wall, as now). **Dive:** if Dive was pressed no more than `dive.airTime` before the ball arrives and
  the ball is below 5.2 ft and within glove + `diveExtra`, it is a diving catch with the existing dive animation, hold and get-up.
  Pressing Dive when you could simply have run under the ball changes nothing; pressing it too early or late makes him dive and miss
  (he then gets up with the existing `getUp` time).
- **Aim help** (`difficulty.<level>.fielding`): the same idea as the batting aim help, applied to the glove radius and the dive window, so a
  Rookie is forgiven more than an All-Star. Starting values are chosen so the fielding bot below catches the targets in 3.5.
- **A miss:** the ball drops (or gets by). You keep steering until he gets to the ball (pickup = within the glove radius of a ball that is
  on the ground or low enough); then the throw goes in by itself to the base the planner would choose, with the usual gather time.
- **Whose fault:** the result is judged exactly as in the planner: a catch is an out (and the usual tag-ups / doubled-off logic for their
  runners), a drop in front of or behind him is a hit with extra bases decided by how long the pickup took.

### 3.3 How it plugs into the engine (approach A: live chaser, the game finishes the play)
- `planPlay` gains one optional input `i.control = { pos, track, outcome }`. Without it nothing changes (every existing test and the bot
  run on the old path). With it:
  - the controlled fielder's path is his recorded `track` (samples `[t, x, z]` taken from the live steering) instead of a searched route;
  - the result for the air ball (catch at `outcome.t`, `outcome.dive`; or a drop) is *given*, not searched, then everything after is the
    existing code: the caught branch (tag-ups, doubled off), the hit branch (runners' reads, extra bases, the throw), `addSupport`.
- The engine runs the play in three steps, each a re-plan through the machinery that already exists for tapped runners
  (`planPlay({ ...planIn, prev: { paths, t } })`, `keepOldRuns`):
  1. **Contact → catch or landing:** the controlled fielder is driven live by `fieldControl` (engine, new small module, logic only).
     Other fielders and runners follow the contact plan, which for the air part is identical for a catch and a drop
     (`plan.airRes`: runners wait the same until the ball is caught or lands).
  2. **Catch / landing:** `fieldControl` tells the engine the outcome; the engine re-plans once with `control.outcome`.
  3. **Pickup after a drop:** the engine re-plans once more at the real pickup time (and position). Invariant (tested): the runners' paths
     before the pickup are the same in both plans, because a runner only moves by himself when forced or when an order exists, and the
     computer's orders are logged with times like yours.
- **Pure auto-pilot** `fieldControl.autoSteer(...)` = steer toward the planner's own best interception. Used by tests, bots and the
  safety net (3.4) only; feeding it must reproduce the old automatic plan (equivalence test, below). (As built: the setting `Auto` is
  the old automatic planner with no controlled play at all, and a fielder the player leaves alone stands still until the safety net.)
- **Presentation:** `actors` draws the controlled fielder from the live state during steps 1 and 3 (position, facing from velocity, the
  existing run / dive / catch poses) and from the plan after. `app.js` reads the keyboard / stick into `engine.fieldInput({ x, z, dive })`
  each frame (time comes from the engine, never from frame rate, like `swingPressed`).
- **Saves:** League / Quick games are saved before every pitch; a play in flight is not saved, so a resume throws the same pitch again and
  you simply field it again. Nothing about the fielding is stored.

### 3.4 Failure modes decided now
- Leaving the fielder alone: he stands still (a controlled play is not secretly automatic - that is the Auto setting) and a ball he never
  reaches is a hit. One safety net so a play can never hang: `fielding.control.autoAfter` (8 s) after the ball is down without a pickup,
  the auto-pilot takes over and runs it down.
- Pause during a controlled play: the engine already stops its clock; the input is dropped.
- Two outfielders near the ball: the planner's `plan.fielder` is yours; the other one runs its `chase` / `backup` support path as now.
- The fielder reaches the wall while steering: clamped by the field, no penetration (`scripts/wallcheck.mjs` covers it).

### 3.5 Testing and balance
- **Unit (no browser):**
  - planner equivalence: for a few hundred seeded balls, `autoSteer`'s track given as `control` gives the same result, catch time (within
    one tick) and runner outcomes as the old automatic plan.
  - a track that stands still gives a hit and the right bases; a track that arrives late gives a drop; a dive inside / outside its window.
  - the runner-path invariant of 3.3 step 3; the referee audit (`auditPlan`) over controlled plays: every out has a fielder with the ball
    before the runner.
  - eligibility: control off for infield balls, homers, fouls, Derby, Sim, bot, `fielding: 'auto'`.
- **Balance** with a new throwaway-style bot in `scripts/fieldfeel.mjs`, in the spirit of `feel.mjs`: a simulated person steers toward the
  ring with a human reaction (`react`), noise and a limited stick, dives when it thinks it needs to. Targets for catches on *catchable*
  balls (balls the old automatic play caught): casual person Rookie ≥ 85%, Pro ≥ 70%, All-Star ≥ 55%; an expert ≥ 95%. The runs per half
  an average person gives up must stay inside the existing `pitchfeel` band (the computer's batting is unchanged, so fielding by hand only
  moves it by the catches you miss or make beyond the old rate). Numbers are tuning starts, the owner's play decides.
- **Real game:** `qa-output`-style playwright checks of the chase camera and the stick (keyboard and a touch drag), `hudqa` with the stick
  and Dive button, `playqa` for a full pitching half with fielding on, `leakqa` (flat shape / texture counts).
- `npm test`, `npm run build && npm run smoke`, then CLAUDE.md updated (Where things stand, Architecture, Tuning, Known issues: feel
  untested by the owner).

## Risks
- The biggest risk is **feel**: directly steering on a phone. Mitigation: aim help per level, an Auto switch, the numbers in `config.js`.
- The planner is large (`fielding.js`, 2.2k lines); the change is one input and a branch, guarded by the equivalence test.
- The chase camera must make "up = toward the wall" true for every ball; if a ball goes to the line the camera may need a small yaw toward
  the ball's side. Decided by screenshots with the owner, not by guessing.
