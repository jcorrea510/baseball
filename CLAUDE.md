# CLAUDE.md - Sandlot

Browser baseball batting game ("spiritual successor to the old doodle baseball game", far more polished). **Vite + vanilla JS + three.js.** Everything (textures, sounds, people, crowd) is generated in code - there are no asset files. The owner does not code: they judge by playing, so keep commands and explanations plain-English and never leave TODOs.

## Commands
- `npm run dev` - dev server (http://localhost:5173)
- `npm test` - Vitest (`tests/*.test.js`, pure logic, no browser)
- `npm run build` - production build to `dist/` (base path comes from `BASE_PATH`, default `/baseball/`)
- `npm run smoke` - (after a build) serves `dist/` like GitHub Pages and drives headless Chrome: must reach the title screen; with WebGL blocked and with the raw un-built source it must show the on-screen error screen. `CHROME_PATH=/path/to/chrome` picks the browser locally; CI uses the runner's Chrome. It runs in the deploy workflow before publishing.
- `npm run sim` / `node scripts/sim.mjs [games] [timingSdMs] [difficulty]` - headless bot playtest with stats (win %, AVG, HR, outcome table by contact grade). Use it after changing physics/fielding/contact numbers.
- `node scripts/tune.mjs [samples] [sdMs] [difficulty]` - hit/out/HR rate by batted-ball type (for tuning fielders).
- Deploy: push to `main` -> `.github/workflows/deploy.yml` runs tests + build + publishes to GitHub Pages (Settings -> Pages -> Source: GitHub Actions).

## Architecture (three layers)
1. **Logic (no graphics, unit tested)** - `src/game`, `src/physics`
2. **Presentation** - `src/render` (three.js), `src/audio`, `src/ui` (DOM)
3. **`src/app.js`** wires them together. `src/config.js` holds ALL tunable numbers.

### Coordinates (used by every module)
Feet. Origin = back tip of home plate. `+x` = right-field side (screen-right from behind the plate), `-z` = toward the pitcher / center field, `+y` up. Spray angle 0 = center, negative = left field. The camera sits behind the plate at `+z`. Person-local axes: `+z` = the way they face, `+x` = their LEFT hand.

### Logic (`src/game`, `src/physics`)
- `physics/field.js` - bases, fence curve, fair/foul test, grandstand profile.
- `physics/pitch.js` - `buildPitch`: a pitch is a constant-acceleration path solved to hit a chosen spot at the timing plane (`pitch.contactZ`). Movement (break/hop) is visible from release.
- `physics/ballistics.js` - `simulateBattedBall`: fixed-step (1/240 s) flight with gravity, drag, backspin lift, sidespin hook, bounces, rolling, wall, stands. Returns samples; the picture replays them (frame-rate independent). Also `judgeFairFoul`.
- `game/timing.js` - timing windows (perfect/good/early/late/miss) and `resolveSwingTimes`. **Error = bat time - ball time (ms)**. The visual contact time is clamped near the ball so bat and ball always meet.
- `game/contact.js` - pitch location + timing -> exit velocity, launch angle, spray, spin.
- `game/fielding.js` - `planPlay`: given the ball flight + runners, decides catch / groundout / hit / extra bases / double play / sac fly and returns a **plan** (a timeline: fielder paths, throws, carries, runner moves, events, `endTime`). Nothing in it is random (repeatable). `createDefense` holds fielder speed/reaction.
- `game/rules.js` - counts, outs, walks, force advancement, `applyPlay`, innings, extra innings (runner on 2nd), walk-offs, line score. Pure functions on a state object.
- `game/pitcherAI.js` - what to throw (mix by difficulty/count, strike rate, tells). `game/aiHalf.js` - the computer's half-inning, simulated instantly from odds in config.
- `game/engine.js` - **the orchestrator**: phases `ready -> windup -> pitch -> (play) -> result -> ...`, swing handling (`swingPressed(sinceUpdate)` - pass the seconds between the last update and the real input event so timing ignores frame rate), Quick/Derby/Practice rules, events (`on('contact')`, `'playEvent'`, `'result'`, ...). `engine.pitchOverride` lets tests throw exact pitches.
- `game/progression.js` - localStorage (always try/catch, in-memory fallback), career stats, high scores, unlock milestones. `game/teams.js` - original teams/uniforms/bats/names. `game/bot.js` - test bot.

### Presentation
- `render/scene.js` renderer + adaptive resolution; `environment.js` sky/sun/fog/day-dusk-night presets + clouds; `stadium.js` (+ `perimeter.js`, `crowd.js`, `scoreboard.js`, `textures.js`) the ballpark; `rig.js` person model + two-bone IK (parts merged into few meshes); `poses.js` procedural animation; `actors.js` drives every person and the ball from engine state; `cameraRig.js` broadcast camera (batter view -> follow -> snap back, shake); `ball.js` ball + trail; `effects.js` particles/fireworks.
- `audio/audio.js` - Web Audio synthesis (bat crack scaled by contact quality, glove pop, crowd, cheers, organ riff). Context is created only after the first user gesture.
- `ui/ui.js` + `style.css` - all menus/HUD. `app.js` - input, time control (hit-stop, slow-mo, fast-forward), engine->effects/audio/UI hooks.

### Fielder movement and diving
- `game/fielderMotion.js` (pure logic) is the ONE movement model. `covered`/`timeToCover` (a fielder heading for cruise speed vc covers vc*(t - A*(1-e^(-t/A))) ft, A = `fielding.accel`) are used both by the planner's "can he get there?" search and by `planRun`, which the renderer plays back - so what the planner promises is exactly what is drawn. `planRun` = react, accelerate, cruise, brake; with time to spare he arrives early and waits, on a tight play he arrives on time at speed and eases to a stop past the spot (a running catch). `Mover` (braking curve, arrival radius, retarget threshold) drives everything that is not a planned run (jogging back).
- `planPlay` gives every fielder a job: `plan.paths[pos]` = his runs in order; `plan.fielderMoves` keeps one entry per run (with `role`: catch/field/cover/relay/backup/shade/watch). Backups, base coverage and pitcher/catcher roles are added in `addSupport` (movement only, never changes outcomes); `settleThrows` points each throw at where its receiver really is; `fielderFreeTime(plan, pos)` says when he may jog home.
- A dive (`planDiveRun`) only happens when the ball is just beyond running reach (`need > avail` but within `diveExtra`) AND no fielder could simply run to it within `fielding.dive.preferRun` seconds. He sprints straight at the ball (one committed direction), launches `dive.airTime` before the glove meets it, lands, slides, lies there, gets up. A fielder who dove throws later (`dive.throwExtra`). Plan events `dive` (launch), `diveLand`, and `catch`/`field` with `dive:true` drive the highlight (slow motion, dust, "DIVING CATCH!").
- Renderer rules: facing only re-aims with a reason and turns at `fielding.turnRate`; every pose change cross-fades (`crossfadePose`); never use the ball's position as a facing target once it is in his glove.
- QA: `engine.contactOverride = () => ({exitVelocity, launchAngle, sprayAngle, backspin, hook})` forces an exact batted ball; `person.animState` names the current pose. `tests/fielderMotion.test.js` covers the run profile, mover, intercept prediction and dives.

### The players (rig.js)
- Same skeleton, IK and poses as always; only the shapes changed. Torso = a V-tapered lathe carrying the jersey texture (front at u = 0.25); short jersey sleeves over the team's undershirt colour (`uniform.sleeve`) or bare arms; side-striped pants, banded stirrup socks, molded cleats; a real glove (pocket, finger stall, thumb, laced webbing) and a bigger catcher's mitt; batting gloves, wristbands and elbow guard on batters; face with eyes/brows/nose/jaw, hair colour from skin tone + number, paneled cap with button and badge.
- Parts are merged into few meshes with vertex colours; `ao` on a part bakes a little ambient occlusion at its ends. `detail` (0..1) lowers polygon counts: fielders/coaches 0.62, everybody x0.75 on phones (`Actors.detailScale`). Keep full detail for batter/catcher/pitcher/umpire - they fill the screen.
- Caution: never make one part's surface coincide with another's (z-fighting shows as dotted rings) - make the outer part a touch wider.

### Startup and the boot guard (do not bypass)
- `index.html` has an **inline classic script** (`window.__sandlotBoot`) that owns the "Warming up the ballpark" splash and the `#boot-error` screen. It works even when the game's own files never load. `done()` hides the splash; `fail(kind, err)` shows a readable error (kinds: `load`, `start`, `frame`, `timeout`). State is mirrored in `<html data-boot="loading|ready|failed:<kind>">`.
- It catches: the module script failing to load (capture-phase `error` on `<script>`), uncaught exceptions / rejected promises while starting, and a 45 s timeout (soft "still loading" note at 12 s).
- `main.js` builds the `App` inside try/catch and starts on a timer as well as on an animation frame (frames never fire in hidden tabs). `App.loop` requests the next frame first, guards each frame with try/catch, and calls `__sandlotBoot.done()` only after the first frame draws; repeated frame errors stop the loop and call `fail('frame')`.
- Never add startup work that can throw or wait without going through this path, and never remove the splash anywhere else.
- Deploy pitfall: GitHub Pages must be set to **Source: GitHub Actions**. "Deploy from a branch" publishes the repo's raw `index.html` (pointing at `/src/main.js`, which does not exist on the site) - that once left the live game on the splash forever. `tests/boot.test.js` and `npm run smoke` guard this.

## Conventions
- Put every tunable number in `src/config.js` with a plain-English comment. No magic numbers in logic.
- Logic modules must not import three.js or touch the DOM (so Vitest and `scripts/sim.mjs` can run them in Node).
- Timing must never depend on frame rate: use engine time and `swingPressed(sinceUpdate)`; physics is precomputed at fixed steps.
- Renderers read engine state; they never change game outcomes.
- After changing physics/fielding/contact numbers: run `npm test` and `node scripts/sim.mjs 100 30 pro` and check win% / AVG still look sane (skilled bot sd 20-30 ms wins ~85-95% on Pro; sloppy sd 70 ~55-60%; All-Star is clearly harder).
- QA hooks: `?mode=quick|derby|practice&bot=1&sd=25&seed=7&tod=night` starts a game immediately (bot plays); `window.__app.tick(dt, render)` steps the simulation without waiting for real time (used by headless-browser QA).
- Commit messages: clear, one milestone/topic each.

## Tuning cheat sheet
See the table in README.md ("Tuning the game").
