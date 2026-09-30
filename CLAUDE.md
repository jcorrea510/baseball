# CLAUDE.md - Sandlot

Browser baseball batting game ("spiritual successor to the old doodle baseball game", far more polished). **Vite + vanilla JS + three.js.** Everything (textures, sound effects, people, crowd) is generated in code - the only asset files are the umpire's recordings (`public/sounds/umpire/`). The owner does not code: they judge by playing, so keep commands and explanations plain-English and never leave TODOs.

Modes: **Season** (a league, 6-inning games, standings, playoffs and a World Series, coins, a shop, a rated roster), **Quick Game** (3 innings vs the computer, extra-innings runner on 2nd, walk-offs), **Home Run Derby** (10 outs, batting-practice pitches), **Practice** (pick the pitch; runners stay on base and runs are counted, no outs). Three levels: Rookie, Pro, All-Star. The player only bats; the computer's half-innings are simulated instantly.

## Where things stand (read this first)
- **The site is on Vercel only:** https://baseball-jtc11.vercel.app, rebuilt on every push to `main`. **GitHub Pages is switched off by the owner - do not touch it.** `.github/workflows/deploy.yml` ("Check the game") runs `npm test`, a build and the smoke test on every push to `main` (it publishes nothing); a red run means that push should not be trusted. **GitHub's default branch is `claude/eloquent-carson-s5d4ay`** (an old copy of `main`); if the Vercel site ever looks stale, the owner should check Vercel's Production Branch is `main`.
- Second round of the owner's notes (Sept 30) is done and pushed: umpire recordings only (no synthesized voice), flat accurate landing ring, no ball halo, darker nights, Ready button before each new batter, sound stops when another app has focus, pitch guide readable in time to decide, aiming that matters, bunting, fielding errors, stealing + hit-and-run + runners going back / doubled off, practice with runners, Season mode, swing no longer passes through the body, new pitching delivery and run cycle, more body shape and fingers, sky environment lighting, lefty jersey fix.
- `npm test`: 28 files, 375 tests, all passing (3 ffmpeg tests skip when ffmpeg is missing). Baselines from the check scripts are in "Tuning".
- Work goes on the branch the session is given; the owner has authorised pushing to `main` (that is what publishes). One topic per commit.

## Commands
- `npm run dev` - dev server (http://localhost:5173)
- `npm test` - Vitest (`tests/*.test.js`, pure logic, no browser)
- `npm run build` - production build to `dist/`. The base path comes from `scripts/resolveBase.mjs` (see Deployment). `vercel.json` holds the Vercel settings.
- `npm run smoke` - (after a build) serves `dist/` under a `/<repo>/` sub-path and drives headless Chrome: must reach the title screen and survive a real click-through (Settings with a volume slider, Credits, Esc back twice, Play, how-to, a setting, Quick Game, pause, the zone / pitch-guide / ring switches, one tap on Quit only arms it, resume). Console warnings count as failures. Eight scenarios: (1) built game reaches the title, (2) menus with real clicks, (3) Vercel-style build served at `/`, (4) default build (`./` base) served from another folder, (5) a build made for the wrong base served at the root of a non-GitHub host -> readable error that does not mention GitHub, (6) WebGL blocked -> the "couldn't start 3D graphics" screen, (7) the raw un-built source -> the "game files didn't load" screen, (8) a pretend recordings folder (`SANDLOT_UMPIRE_DIR`) -> files found by the build, downloaded after the first click, played, a call without a file is silent, and nothing 404s. `CHROME_PATH=/path/to/chrome` picks the browser (in this sandbox `/opt/pw-browsers/chromium`; CI uses the runner's Chrome).
- `npm run sim` / `node scripts/sim.mjs [games] [timingSdMs] [difficulty]` - headless bot playtest with stats (win %, AVG, HR, outcome table by contact grade). Use it after changing physics/fielding/contact numbers.
- `node scripts/pitchmix.mjs [pitches]` - where the computer pitcher throws, per difficulty.
- `node scripts/hrrate.mjs [swings] [derby|quick]` - home run % for perfect and good swings by level. Derby targets: perfect ~70-85%, good ~25-40%; `tests/hrrate.test.js` guards the bands. Derby-only batting help lives in `modes.derby` and reaches `computeContact` through `derbyBatting(cfg)`.
- `node scripts/guidecheck.mjs [pitches]` - how readable the pitch guide is per level, at the moment the batter must DECIDE (`timing.decideTime` before the swing must start). `node scripts/guideqa.mjs <dev-server url>` checks it in the real game.
- `node scripts/landingqa.mjs <dev-server url>` - the landing ring in the real game (spot vs where the ball lands, shrink, hide, switch).
- `node scripts/groundcheck.mjs [plays]` - thousands of ground balls through the planner and the referee (`src/game/playAudit.js`): every out must have a fielder ON the bag WITH the ball before the runner. Must say "no problems". `node scripts/groundqa.mjs <dev-server url>` measures the picture at the moment of the out.
- `node scripts/wallcatch.mjs [balls] [bandFeet]` - catch rate on catchable fly balls near the wall (must be 100%, `tests/wallcatch.test.js`). `node scripts/wallqa.mjs <dev-server url>` checks the picture.
- `node scripts/wallcheck.mjs [plays]` - any fielder outside the ballpark (`tests/wall.test.js`).
- `node scripts/tune.mjs [samples] [sdMs] [difficulty]` - hit/out/HR rate by batted-ball type.
- `npm run umpire -- <call> <file or link> [--take b]`, `--list` - add/swap an umpire recording (see "The umpire").
- `node scripts/hudqa.mjs [sizes] [url]` - forces every HUD pop-up on at once in each mode and prints any two boxes that overlap (must print "no overlaps"; default 568x320, 844x390, 1280x720, 390x844; also try 768x1024, 1024x600, 360x780, 640x360). `node scripts/playqa.mjs [url] [sizes]` - plays every mode to the end from the title with real clicks/taps (presses Ready for real) and one real swing. `node scripts/leakqa.mjs [url]` - starts/quits 12 games; shape/texture counts must stay flat (currently 230/32). `node scripts/mixcheck.mjs [url]` - loudness of every sound through the real mix.
- `node scripts/brand.mjs [dev url]` - remakes the favicon, icons, `og-image.jpg` and `site.webmanifest` from `src/ui/logo.js`. Commit the outputs.
- The `*qa.mjs` scripts and `qa-output/` (git-ignored, also holds throwaway QA scripts) need a dev server running. CSS transitions crawl in headless SwiftShader: inject `*{transition:none!important;animation:none!important}` for menu screenshots; hide `.rotate` for portrait phone shots. QA camera: `app.cam.override = { pos, look, fov }`.

## Deployment
- **Vercel** (https://baseball-jtc11.vercel.app): connected to the repo; settings (also in README and `vercel.json`): Framework Vite, Install `npm ci`, Build `npm run build`, Output `dist`, Root empty, Production Branch `main`, **no environment variables (never add `BASE_PATH`)**. `vercel.json` adds long-cache headers for `/assets/*`. Vercel runs **no tests**, so run `npm test` (and `npm run build && npm run smoke` for anything touching startup, the base path, `index.html`, `vite.config.js`, `public/` or the umpire folder) before pushing. This sandbox cannot reach the site (network policy): confirm health through the GitHub Actions run ("Check the game").
- **GitHub workflow** (`.github/workflows/deploy.yml`, push to `main` + manual): checkout, Node 22, `npm ci`, `npm test`, build and smoke with `BASE_PATH=/<repo>/` (the strictest case). No Pages steps - GitHub Pages is off.
- **Base path** (`scripts/resolveBase.mjs`, used by `vite.config.js`): `BASE_PATH` env wins; else `VERCEL`/`NETLIFY`/`CF_PAGES`/`RENDER` -> `/`; else `GITHUB_ACTIONS` + `GITHUB_REPOSITORY` -> `/<repo>/`; else `./`. `npm run dev` is always `/`. Never hardcode a base path. Guarded by `tests/base.test.js`, `tests/boot.test.js` and smoke scenarios 3-5.
- **Site address for link previews** (`resolveSiteUrl`): `SITE_URL`, else Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, else `https://<owner>.github.io/<repo>/`, else none. The `sandlot-brand` plugin in `vite.config.js` writes it into the `og:image` / `twitter:image` / `og:url` tags and draws the logo SVG into the splash.
- The load-failure screen must stay host-aware: players see a plain "reload" message, and only the folded Technical details carry a site-owner hint (GitHub Actions advice only on `*.github.io`).

## Architecture (three layers)
1. **Logic (no graphics, unit tested)** - `src/game`, `src/physics`
2. **Presentation** - `src/render` (three.js), `src/audio`, `src/ui` (DOM)
3. **`src/app.js`** wires them together (input, time control, engine -> effects/audio/UI hooks, menu navigation, Season games). `src/main.js` boots it: `new App(...)` only stores the canvas, `await app.init(report)` builds everything in stages and reports progress to the splash. `src/config.js` holds ALL tunable numbers. `src/util/` = `math.js`, `rng.js` (seedable).

Module map:
- `src/physics/`: `field.js`, `pitch.js`, `ballistics.js`
- `src/game/`: `engine`, `timing`, `contact`, `fielding`, `fielderMotion`, `playAudit`, `runnerMotion`, `rules`, `pitcherAI`, `aiHalf`, `pitchGuide`, `landing`, `progression`, `teams`, `season`, `bot`
- `src/render/`: `scene`, `environment`, `stadium` (+ `perimeter`, `crowd`, `scoreboard`, `textures`), `rig`, `poses`, `actors`, `cameraRig`, `ball`, `effects`, `pitchGuide`, `landingRing`
- `src/audio/`: `audio` (engine + umpire), `umpireFiles`, `umpireNames`
- `src/ui/ui.js` + `src/style.css` + `src/ui/logo.js`
- `scripts/` (Node tools and QA), `tests/` (28 files), `public/` (icons, share picture, manifest, `sounds/umpire/`)

### Coordinates (used by every module)
Feet. Origin = back tip of home plate. `+x` = right-field side (screen-right from behind the plate), `-z` = toward the pitcher / center field, `+y` up. Spray angle 0 = center, negative = left field. The camera sits behind the plate at `+z`. Person-local axes: `+z` = the way they face, `+x` = their LEFT hand. Left-handed batters and pitchers are the same figure mirrored (`root.scale.x = -1`); their jersey artwork is pre-flipped about the FRONT of the shirt (u = 0.25).

### Logic (`src/game`, `src/physics`)
- `physics/field.js` - bases, fence curve, fair/foul test, grandstand profile, the ballpark outline for the wall code, the dugouts.
- `physics/pitch.js` - `buildPitch`: a constant-acceleration path solved to hit a chosen spot at the timing plane. `zoneRatio` = how far a spot is from the middle of the zone (1.0 = the edge).
- `physics/ballistics.js` - `simulateBattedBall`: fixed-step (1/240 s) flight with gravity, drag, lift, hook, bounces, rolling, wall, stands. Also `judgeFairFoul`.
- `game/timing.js` - timing windows and `resolveSwingTimes`. **Error = bat time - ball time (ms)**.
- `game/contact.js` - `computeContact` (pitch location + timing + aim -> exit velocity, launch, spray, spin; `evBonus` adds mph - Derby help and Season Power), and `computeBunt` (`config.bunt`: big timing window, soft ball down a line, aim picks the line, a high pitch pops up, sometimes foul). **Aim**: `contact.spray.aimTarget` / `aimControl` (per contact grade) steer the spray toward the held direction, `aimPower` a little extra when pulling.
- `game/fielding.js` - `planPlay`: given the ball flight + runners, decides catch / groundout / hit / extra bases / double play / sac fly / error and returns a **plan** (fielder paths, throws, carries, loose-ball segments, runner moves, events, `endTime`). Deterministic. Inputs beyond the ball: `errorRoll` / `errorScale` (errors), `running` (runners going with the pitch), `speeds` (each runner's speed factor). `planSteal` plans a stolen-base attempt (no ball in play). Module state (`RUN`, `SPD`) is set only while those run.
- `game/rules.js` - counts, outs, walks, force advancement, `applyPlay` (results incl. `sacBunt`, `error` - an at-bat, not a hit, charged to the fielding team in `g.errors`), `applySteal`, innings, extra innings, walk-offs, line score.
- `game/pitcherAI.js` - what to throw and where ('heart' / 'edge' / 'chase' / 'waste' odds per level, shifted by the count). `game/aiHalf.js` - the computer's half-inning from odds (`difficulty.<level>.ai`, incl. `error` = safe on your fielders' error).
- `game/engine.js` - **the orchestrator**: phases `ready -> windup -> pitch -> (play) -> result -> ...`. Ready button: `waitForBatter` holds the first pitch to each new batter until `batterReady()` (the app passes it for Quick/Season games without the bot; the bot presses it itself). Bunting: `setBunt(on)`. Stealing: `setSteal(on)` / `stealBases()` / `canSteal`; `beginSteal()` at the windup rolls the jump and the catcher's exchange and plans the steal at once (`this.steal.plan`, drawn during the pitch). No contact -> `startStealPlay` / `finishSteal` (a play with `plan.steal`, a stub flight `NO_FLIGHT`); contact -> `planPlay({ running })` (hit-and-run). Season options: `innings`, `lineup` (rated players), `opponent`, `oppLineup`, and a derived `cfg` (constructor 2nd argument). `ratingEffects(batter)` -> Contact widens `windowScale`, Power `evBonus`; `runnerSpeeds()` -> Speed. Practice keeps a game state `pgame` (runners, runs; outs reset every play); `diamond` = `game || pgame`. QA hooks: `pitchOverride`, `contactOverride`, `errorRollOverride` (0 = always an error).
- `game/progression.js` - localStorage (try/catch, in-memory fallback; key `sandlot.save.v1`), career stats, high scores, unlocks, and `data.season` (the whole Season as JSON; `resetStats()` keeps it). Season games count toward career games/wins but not Quick Game bests.
- `game/season.js` - Season mode (pure): `newSeason(prev, { level, length })` (9 teams: yours + `OPPONENTS` with shuffled `season.teamRatings` + `boost`; your 12-man roster; the shop), `makeSchedule` (circle-method round robin with a bye; your opponents weakest-first, off day mid-cycle; 1 or 2 cycles), `nextGame`, `standings`, `recordGame(s, { won, runsFor, runsAgainst, lines })` (standings, player season lines, coins, other games simulated with `simK`, off days, playoffs: 1v4 / 2v3 one-game semis then best-of-`finalGames` World Series), `isOver`, `finishSeason`, `finishOf`, `swapPlayers`, `buyPlayer` (full roster -> replaces a player, `refund`), `price`, `overall`, `gameConfig(level, rating)` (a strong team: faster fastball, fewer heart pitches, better command, more hits / fewer Ks when it bats, fewer errors, quicker catcher), `gameSetup`, `ratingEffects`. Next season: roster and coins carry over; `boost` grows by `yearStep` after a title (half after a playoff trip), capped at `yearCap`.
- `game/teams.js` - original teams/uniforms/bats/names (`FIRST`, `LAST`, `SKINS` exported for Season players). `game/bot.js` - test bot.

### Fielding, errors and outs
- `game/fielderMotion.js` is the ONE movement model (`covered`/`timeToCover`, `planRun`, `planDiveRun`, `Mover`). What the planner promises is exactly what is drawn.
- **The third out ends the play** (`endInningStop`): runners still going ease up and stop; no `safe` call for a base never reached.
- **Covering a base** (`coverOptions`): an out at a base only exists if somebody is on the bag with the ball before the runner (throw timed to the cover man, or the fielder carries it). Options: `tag` (seconds to tag a runner who is not forced - steals use `steal.tagTime`; home always `fielding.tagTime`), `coverStart` (steals: the cover man broke when the runner went). Force plays, double plays, hit plays, steals and doubling a runner off all use it. `auditPlan` (tests/groundouts, tests/steal, tests/errors) checks every out, including on caught balls and runners going back (`retreatArrival`).
- **Errors** (`fielding.errors`, x `difficulty.<level>.errorScale`, x `hardFactor` on a smash / dive / leap): a bobbled grounder (`bobble`) or a dropped fly (`dropFly`). The ball pops loose (`plan.looses` segments, drawn by `actors.ballInPlay` kind 'loose'), the fielder chases it (`chaseLoose`), then `finishHit` gives the runners what the delay allows. `plan.result = 'error'`, `plan.error = { pos, kind, t }`, event `error`. Decided by one seeded roll per ball in play (none in the Derby, none without a roll). ~1 error per 100 balls in play.
- Dives, the wall, catching fly balls at chest height, leaps at the wall: unchanged from before (see `findAirCatch`, `planDiveRun`, `wallBrake`, `CATCH_SETTLE`). Do not go back to "catch at the first reachable moment".

### Base runners (game/runnerMotion.js)
- ONE model for the planner and the picture: `runnerProfile(from, to, kind, cfg, spd)` (route with rounded corners + speed profile; `spd` = the runner's speed factor), `runnerArrival` / `runnerFinish`, `runnerState(move, t)` (moves carry `tStart`, `spd`, `back`, `backAt`, `stopAt`). Leads: `runner.lead` 9 ft, `runner.leadSecond` 18 ft (these shorten every runner's trip; `tests/runnerMotion.test.js` allows for them).
- **Going back** (`retreatState`, `retreatArrival`): a runner who went with the pitch runs on until `backAt`, pulls up, turns and runs back to the bag he left (not his lead spot). Used on fouls (`steal.readFoul`), caught balls (line drive: when it is caught; fly: `steal.readFly`) and when he ends up holding. On a caught ball one going runner may be doubled off (`runnersGoBack`), through `coverOptions`.
- **Steals** (`config.steal`): jump `steal.jump` + `jumpSd` after the windup starts; catcher exchange `steal.transfer` x `difficulty.<level>.catcherArm` (+ `dirtExtra` for a pitch in the dirt); throw to the lead runner; out only if the ball is on the bag + tag before him; no throw when hopeless (`noThrow`). Measured success (steal of second): Rookie ~88%, Pro ~76%, All-Star ~58%; of third a little lower (`qa-output`-style measurement: steal attempts through the real engine with no swings).
- A batter who is out at first runs THROUGH the bag. Home-run moves trot (a runner already going is matched onto the trot). A runner who stays put waits at his lead spot; after a play, runners walk (never glide) to their new lead.

### Presentation
- **Pitch visibility:** the pitched ball is drawn at `pitch.ballScale` and never smaller on screen than `pitch.minScreenPx` / `minScreenFrac`. No glow/halo around the ball (removed on purpose).
- **Pitch guide** (`game/pitchGuide.js` + `render/pitchGuide.js`): fades in early enough to decide (`difficulty.<level>.guide.fadeIn` fractions of the flight), slides from the no-break line to the real spot between `reveal[0]` and `reveal[1]`, off by a fixed per-pitch `error`. Never shown before release. Rookie/Pro name the pitch type as it leaves the hand (`typeAtRelease`). Measured at the decision moment (`timing.decideTime` before the swing must start): right side of the zone Rookie 97% / Pro 87% / All-Star 71% (borderline 91 / 74 / 61). `tests/pitchGuide.test.js` guards it.
- **Landing ring** (`game/landing.js` + `render/landingRing.js`): lies FLAT on the grass (a plane with polygon offset, no tilt) exactly where the ball comes down (or at the catch / drop spot), shrinks from `radiusStart` to `radiusEnd`. The deep-ball camera rises to a "high home" view (`camera.highHome`) so the flat ring is readable.
- `render/scene.js` renderer + adaptive resolution; `environment.js` sky/sun/fog/day-dusk-night presets + clouds + **image-based sky light** (`bakeEnv`: a PMREM of the preset's sky/horizon/ground/sun per time of day, `envIntensity` per preset; the hemisphere light is lower to match). Night is deliberately dim (`sunIntensity` 1.85, exposure 0.92).
- `stadium.js` (+ `perimeter.js`, `crowd.js`, `scoreboard.js` with an E column, `textures.js`), `rig.js` person model + two-bone IK, `poses.js` procedural animation, `actors.js` drives everyone and the ball from engine state (steals are drawn from `E.steal` before there is a play; the covering infielder follows `E.steal.plan` during the pitch), `cameraRig.js`, `ball.js`, `effects.js`.

### The players (rig.js, poses.js)
- Rig: V-tapered jersey torso with a trapezius slope to each shoulder, short sleeves over undershirt or bare arms with biceps and forearm shape, tapered pant legs with knees, calves in stirrup socks, cleats, a real glove / catcher's mitt, hands with four curled fingers and a thumb (batting gloves on batters), face, cap/helmet. Parts are merged per limb; `detail` lowers polygon counts for fielders/phones. Never let two parts' surfaces coincide (z-fighting).
- **Swing** (`batterPose`): load, rotation, contact; the follow-through is keyframed (`FOLLOW`: extension toward the pitcher, the bat climbs past the lead shoulder, high finish behind the head) so the bat never passes through the body - measured clearance ~0.4 ft from head and torso for every pitch location (a throwaway in-browser measurement: bat segment vs head sphere / spine points). Re-measure after touching `batterPose` or `FOLLOW`.
- **Pitching** (`pitcherPose`): leg lift, the throwing arm swings down past the hip, back and up into a cocked L at foot strike, whips over the top; glove arm bent and leading; follow-through across the body to the knee. Pole vectors change with the phase.
- **Running** (`runPose`): ground contact `duty` (0.5 jog -> 0.33 sprint) moving back at exactly the running speed (`L = speed * duty / cadence`, no sliding feet), heel kick, knee drive, landing nearly under the hips, hip dip on each landing, bent arms pumping opposite to their own leg. `runCadence` is shared with every runner/fielder.
- Bunt stance (`buntPose`), slides, dives, catches, throws as before. Renderer rules: facing only re-aims with a reason, every pose change cross-fades (`crossfadePose`); the catcher comes out of his crouch to throw.

### Audio (audio/)
- `audio.js` - Web Audio synthesis for every effect (bat crack by contact quality, a soft tock for bunts, glove pop, crowd, cheers, organ) and the umpire. Channels `sfx`, `crowd`, umpire (scaled by `levels.umpire`) under `master` and a limiter. The AudioContext is created after the first user gesture. `setHidden(true)` suspends it: tab hidden, page hidden, **and window blur** (another app has the focus).
- **The umpire = recordings only.** `callUmpire(kind)` plays a recording for the call (`playFile`: light stadium reverb + echo, `audio.umpire.files`); a call with no recording is **silent** (the gesture still plays). The synthesized and browser voices are gone. Setting `umpire`: 'on' | 'off' (older saves are migrated). Calls: `strike` (plain strike), `strike1` / `strike2` (count-aware, from `App.onPitchCall`), `strike3`, `ball` (every ball; `ball4` optional), `foul`, `out`, `safe`, `playball` (start of a Quick/Season game). Several takes per call are pooled and one picked at random (`umpireFiles.js`). The BUILD lists the folder (`scripts/umpireFiles.mjs` -> `__UMPIRE_FILES__`), so the game never probes for missing files.
- **The owner's tool**: `npm run umpire -- <call> <file or link> [--take b]` (`scripts/addumpire.mjs` + `scripts/umpireAudio.mjs`): downloads, trims silence (both ends), levels (-16 LUFS, or a -1.5 dB peak for short clips), writes a mono mp3 to `public/sounds/umpire/<call>[_take].mp3`. Needs ffmpeg (not installed in this sandbox by default; `pip install imageio-ffmpeg` gives a binary). `public/sounds/umpire/README.txt` lists every file and when it is said.

### Menus and HUD (ui/ui.js + style.css)
- Design tokens at the top of `style.css`; build from `.btn`, `.iconbtn`, `.seg`, `.switch`, `.setrow`, `.card`, `.chip`, `.panel`; icons from `ICONS` (`icon('name')`). Text rule: **labels only** - no explanatory sentences on screen.
- Screens: title, modes (4 cards: Season, Quick Game, Derby, Practice + Level / Time / Bats), how-to, locker, career, settings, credits, pause, results, **season** (hub: next game card with the matchup, records and strength stars, Play; Standings / Roster / Shop; New league (two taps); no season yet -> Level + Length + Start season; season over -> CHAMPIONS / RUNNER-UP / SEASON OVER + next season), **standings** (table, playoff cut line, bracket), **roster** (tap two players to swap; in replace mode tapping a player signs the new man in his place, rows that cannot afford it are disabled), **shop** (buy buttons disabled when even the best refund would not cover it). `App.openMenu` / `App.nav` / Esc as before. The results screen of a Season game shows the coins earned and a Continue button back to the hub.
- HUD: top-left pause/mute; top-centre pitch pill, exit-speed readout; top-right practice drawer; bottom-left score bug (Quick/Season, with the E column on the scoreboard and line score) or Derby box or **practice box** (runs, hits, HR, bases); bottom-centre timing meter; bottom-right aim gauge with the **Bunt / Steal** pair above it (`.acts`; Steal only while a runner can go; on touch the pair sits above the right aim button and hides while the Ready card or the hit readout is up). The **Ready card** (`.batterup`) shows the batter, today's line and chips (Season: AVG, HR, CON/POW/SPD); it clears the previous hit readout and sits higher on short screens. Check any HUD change with `node scripts/hudqa.mjs`.
- Keyboard: Space swing / Ready, A/D aim, B bunt, S steal, Z zone, M mute, Esc pause/back.

### Startup, loading screen and the boot guard (do not bypass)
- `index.html` has an inline classic script (`window.__sandlotBoot`) that owns the splash and the `#boot-error` screen; `App.init` reports progress, `done()` after the first frame; `fail(kind, err)` shows a readable error. State in `<html data-boot>`. Never add startup work that can throw or wait without going through this path, and never remove the splash anywhere else.

## Tuning (all in `src/config.js`; every number has a plain-English comment)
The owner's cheat sheet is the table in README.md ("Tuning the game").

| Area (config key) | Current values | How to check after a change |
| --- | --- | --- |
| Timing windows (`timing`) | perfect 20 ms, good 42, early 80, late 56; `swingDelay` 0.115 s; `decideTime` 0.22 s; windowScale rookie 1.5 / pro 1.0 / all-star 0.7 | `npm test`, `sim.mjs` |
| Pitch speed (`difficulty.<level>.fastball`) | rookie 62-72, pro 80-90, all-star 88-98 (+ heater) | `pitchmix.mjs` |
| Where pitches go (`difficulty.<level>.locations`) | strikes 80% / 61% / 47%; unhittable 13% / 30% / 40% | `pitchmix.mjs` |
| Pitch guide (`difficulty.<level>.guide`) | right side at the decision moment 97 / 87 / 71% | `guidecheck.mjs` |
| Aim (`contact.spray`) | `aimTarget` 30 deg, `aimControl` perfect .8 / good .65 / weak .35 | `sim.mjs` |
| Bunt (`bunt`) | window 45-115 ms, 24-42 mph, `leadMargin` 0.35 | tests/engine, groundouts |
| Errors (`fielding.errors`) | ground 4%, fly 1.8% per chance, x2 hard, x1.5 / 1 / 0.7 by level | tests/errors, `sim.mjs` (~1 per 100 balls in play) |
| Steals (`steal`, `difficulty.<level>.catcherArm`) | jump .02/.03 s, exchange 0.74 s x 0.74 / 1.05 / 1.1, tag 0.12 s | success ~88 / 76 / 58% (tests/steal guards the order) |
| Runners (`runner`) | 30.2 ft/s, accel 0.42 s, lead 9 ft (18 off second) | tests/runnerMotion, `sim.mjs` |
| Season (`season`) | 6 innings, 8/16 games, CPU ratings 36-68 (+boost), coins start 200 / win 25 (+margin up to 10) / loss 10 / playoff win 50 / title 150, prices ~80-470 | tests/season; bot sd 70 on Pro: ~83% vs the weakest team, ~50% vs a strong one, ~33% vs 80 |
| Ratings (`ratings`) | Contact +-18% windows, Power +-6 mph, Speed +-8% at 99 / 1 | tests/season |
| Derby help (`modes.derby`) | `evBonus` 8, perfect 73-77% HR, good 28-36% | `hrrate.mjs` |
| Fielders (`fielding`) | speed IF 20 / OF 22 ft/s, reaction IF .24 / OF .36 s, glove 2.4 ft | `sim.mjs`, `wallcatch.mjs`, `groundcheck.mjs` |
| Landing ring (`landing`) | radius 18 -> 4 ft, alpha .85, appears 0.45 s after contact | `landingqa.mjs` |
| Umpire (`audio.umpire.files`) | level .6, reverb .2, echo .5 | smoke 8, `mixcheck.mjs` |

Baselines measured at the time of writing:
- `node scripts/sim.mjs 100 30 pro`: win 85%, AVG .564, 2.82 HR/game, 9.1 runs for / 3.3 against, 19 errors in 100 games, "no violations, no stuck games"; Derby 10.6 HR per run. Sloppy bot (sd 70): win 57%, AVG .396.
- `guidecheck.mjs`: see above. `groundcheck.mjs`: "no problems". `wallcatch.mjs`: 100% of catchable balls caught (80 of 619 catches are leaps). `wallcheck.mjs`: worst penetration 0.00 ft.

## Conventions
- Put every tunable number in `src/config.js` with a plain-English comment. No magic numbers in logic.
- Logic modules must not import three.js or touch the DOM.
- Timing must never depend on frame rate: use engine time and `swingPressed(sinceUpdate)`; physics is precomputed at fixed steps.
- Renderers read engine state; they never change game outcomes. Randomness in outcomes comes only from the engine's seeded rng.
- After changing physics/fielding/contact/runner numbers: `npm test` and `node scripts/sim.mjs 100 30 pro`, compare with the baselines.
- QA hooks: `?mode=quick|derby|practice&bot=1&sd=25&seed=7&tod=night`; `?guide=0` / `?ring=0`; `window.__app.tick(dt, render)`; `app.startSeasonGame()`; engine overrides listed above.
- Commit messages: clear, one topic each. Text the owner sees is labels only.

## Known issues and unfinished ideas
- **Vercel's production branch is unverified from here** (GitHub's default branch is an old `claude/...` branch).
- **Feel is untested by the owner** for everything in the second round (steal odds, error rate, season balance and prices, the new animations, the sky light). All are plain numbers in `config.js`.
- **Season:** quitting a season game mid-way does not count it (you can replay it). No custom players or skill points (the owner said buying players is enough). The computer never steals and its half-innings are simulated (no fielding for you). Player ratings affect your batters only; CPU teams have one strength number.
- **Only the lead runner can be thrown out on a steal or doubled off**; no pickoffs, rundowns or "send the runner" control (considered, left out to keep the HUD simple - a candidate if the owner wants more strategy).
- **Umpire recordings**: every call has at least one take except `ball4` (ball four uses `ball`). Adding more takes makes it less repetitive.
- **Real-device performance was never measured** (this sandbox renders in software). The sky light adds one small PMREM bake per time-of-day change.
- **By design, the player only bats.**
- **Nothing else is queued.** Further work comes from the owner's playtest notes.

## Working in this sandbox (things that cost time before)
- **Never use `pkill -f` / `pgrep -f` with a pattern that also appears in the same shell command** - it kills the shell itself. Find a dev server with `pgrep -x node` and check `/proc/<pid>/cmdline`. If the container restarts, the dev server is gone: `nohup npx vite --port 5173 --strictPort &`.
- There is no `gh` CLI: use the GitHub MCP tools for Actions runs and checks. Git push works from the shell.
- Headless Chromium is at `/opt/pw-browsers/chromium` (use `playwright-core` with `executablePath`; never run `playwright install`). `page.evaluate` takes ONE argument. In tests collect problems and assert once; long simulation tests need an explicit timeout.
- `ffmpeg` is not installed by default (the 3 ffmpeg tests skip). The live site is blocked by the network policy.
- The smoke test builds several variants into temp folders; a scenario's folder name must not clash with another's.
- Practice's lineup[0] may be left-handed and the practice pitcher may be a lefty: set `settings.hand` and check `engine.pitcher.hand` before judging animation screenshots.
