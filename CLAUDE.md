# CLAUDE.md - Sandlot

Browser baseball batting and pitching game ("spiritual successor to the old doodle baseball game", far more polished). **Vite + vanilla JS + three.js.** Everything (textures, sounds, people, crowd, ballparks) is generated in code - the only asset files are the umpire's recordings (`public/sounds/umpire/`). The owner does not code: they judge by playing, so keep commands and explanations plain-English and never leave TODOs.

**The full history** (every round of the owner's notes, why each number is what it is, old baselines, long module notes) is in `docs/history.md`. Read the part you need there before changing a system; do not paste it back here.

## Cost rules (the owner asked for these)
- Work in the main session; spawn at most ONE helper agent, and only on Sonnet (`model: "sonnet"`).
- Few screenshots: check visuals at the end of a change, not after every tweak (one contact sheet beats six pictures).
- Keep this file short; new detail goes in `docs/history.md` or in `src/config.js` comments.

## Modes
**League** (Season in the code and the save: one of the 30 real big-league clubs - real names, colours, stars and five real arms each - vs division rivals + a neighbouring division, 6-inning games, standings, playoffs, World Series, coins, shop, rated roster; you bat in the bottom half at home, first on the road), **Quick Game** (3 innings, extra-innings runner on 2nd, saved every pitch), **Home Run Derby** (10 outs, batting only), **Practice** (Bat / Pitch switch). Levels Rookie / Pro / All-Star. In Quick Game and League you also PITCH the computer's half (pick a pitch, aim, hold-and-release the ring) and make every throw in the field (the throw pad: four bases + the mound); **Sim** finishes a half. Ballpark: 31 parks (Sandlot + every club's), Settings/Play "Park" = Random by default (a different park every game); League = the home club's park.

## Where things stand
- **Hosting**: Vercel only (https://baseball-jtc11.vercel.app), rebuilt from every push to `main`. GitHub Pages is off - do not touch it. `.github/workflows/deploy.yml` ("Check the game") runs `npm test`, a build and the smoke test on every push; a red run means that push should not be trusted. `main` is the only branch; the owner has authorised pushing to it. One topic per commit; no leftover branches.
- **Done**: rounds one to twenty of the owner's notes (see `docs/history.md`). Oct 7 overnight: Random park default, a seated crowd in the home club's colours with upper decks filled, a real downtown skyline (`CONFIG.parks.skyline`), light towers facing the field, view-dependent grass mowing, the computer's sacrifice bunts (`cpuBat.bunt`, `wantsBunt`), unique generated names / numbers, the opening fly-over (`render/intro.js`, `CONFIG.intro`, setting `intro`).
- **Unmerged helper branches** (stopped mid-way for cost, each ends with a "WIP" commit - review before merging, never merge blind): `worktree-agent-aae748bc82ee44bd3` (players' looks: real-player skin tones / facial hair `src/game/looks.js`, `render/face.js`, gloves, ball), `worktree-agent-a1e32c791a5271389` (animations: swing, catching, throws in `poses.js` / `actors.js`), `worktree-agent-a86c0a3a1af110cf7` (UI: pitching HUD like MLB The Show, menus, more settings, `src/util/units.js`). Worktrees under `.claude/worktrees/`.
- **Feel of most rounds is untested by the owner** - numbers live in `src/config.js` with comments.
- `npm test`: 43 files, ~610 tests. On the Fedora laptop run one file at a time (`npx vitest run --no-file-parallelism --testTimeout=900000`, ~16 min); `tests/baserunning.test.js` can hit its 120 s limits when the machine is busy. GitHub's run is the verdict.

## Commands
- `npm run dev` (http://localhost:5173), `npm test`, `npm run build`, `npm run smoke` (after a build; `CHROME_PATH=/opt/helium/helium` on the Fedora laptop).
- `node scripts/sim.mjs [games] [sdMs] [level] [park]` - bot playtest: win %, AVG, HR, the bot pitching, "no violations, no stuck games". Baseline (pro, sd 30): win ~93%, ~6.4 runs for / ~2.5-3 against, AVG ~.59-.61, ~1.6 HR/g. Run it after physics / fielding / contact / runner changes.
- `node scripts/pitchfeel.mjs [halves] [new|average|good] [level]` (bands: `PITCH_BANDS=1 npx vitest run tests/pitchfeel.test.js`), `feel.mjs`, `hrrate.mjs`, `guidecheck.mjs`, `groundcheck.mjs` (must say "no problems"), `wallcatch.mjs` (100%), `wallcheck.mjs`, `realism.mjs`, `tune.mjs`, `pitchmix.mjs` - balance checks, see `docs/history.md` "Commands" for what each prints.
- With a dev server: `node scripts/hudqa.mjs [sizes] [url]` (must print "no overlaps"), `playqa.mjs`, `leakqa.mjs` (counts stay flat), `mixcheck.mjs`, `landingqa.mjs`, `guideqa.mjs`, `groundqa.mjs`, `wallqa.mjs`, `art.mjs` / `brand.mjs` (remake the tile pictures / icons; commit outputs).
- `npm run umpire -- <call> <file or link> [--take b]` - add an umpire recording (needs ffmpeg). `npm run install-app` (Mac) - offline copy of the game.
- Throwaway QA scripts and pictures go in `qa-output/` (git-ignored). Headless: playwright-core with `executablePath` (Fedora: `/opt/helium/helium` + SwiftShader args, ~30 s a screenshot; see `qa-output/views.mjs`); inject `*{transition:none!important;animation:none!important}` for menus. QA hooks: `?mode=quick|derby|practice&bot=1&sd=25&seed=7&tod=night`, `?intro=1`, `window.__app.tick(dt, render)`, `app.cam.override = { pos, look, fov }`, engine `pitchOverride` / `contactOverride` / `errorRollOverride` / `cpuSwingOverride`, `app.openMenu(name)`.

## Deployment
Vercel settings (also README, `vercel.json`): Framework Vite, Install `npm ci`, Build `npm run build`, Output `dist`, Production Branch `main`, **no environment variables (never add `BASE_PATH`)**. Vercel runs no tests: run `npm test` (and `npm run build && npm run smoke` for anything touching startup, base path, `index.html`, `vite.config.js`, `public/`) before pushing. Base path from `scripts/resolveBase.mjs` (never hardcode one; guarded by tests/base, tests/boot, smoke 3-5). The load-failure screen stays host-aware (GitHub hints only on `*.github.io`). This sandbox cannot reach the live site: judge health by the Actions run (`gh run list`).

## Architecture (three layers)
1. **Logic** (no three.js, no DOM, unit tested): `src/game`, `src/physics`. 2. **Presentation**: `src/render` (three.js), `src/audio`, `src/ui` (DOM, `style.css`). 3. **`src/app.js`** wires them (input, time control, engine -> picture / sound / HUD, menus, League games). `src/main.js` boots it through the splash (`window.__sandlotBoot` in `index.html`: never add startup work that can throw or hang outside it). **`src/config.js` holds ALL tunable numbers**, each with a plain-English comment. `src/util/` = `math.js`, `rng.js` (seedable).
- `src/physics/`: `field.js` (bases, fences, parks: `setPark`), `pitch.js`, `ballistics.js`, `bat.js` (bat-ball collision).
- `src/game/`: `engine` (the orchestrator: phases, sides, saving `checkpoint` / `resume`), `pitchingHalf` (your pitching half, installed on Engine), `cpuBatter`, `cpuRunner`, `scouting`, `pitching`, `pitcherAI`, `timing`, `contact`, `fielding` (`planPlay` -> a deterministic plan the picture follows exactly; the manual throws), `fielderMotion` (the one movement model), `runnerMotion` (the one runner model), `playAudit` (the referee), `rules`, `pitchGuide`, `landing`, `progression` (save: `sandlot.save.v1`), `teams`, `mlb`, `season`, `bot`.
- `src/render/`: `scene`, `environment`, `stadium` (+ `perimeter`, `crowd`, `scoreboard`, `textures`, `parkLook`), `rig` + `anatomy` (the people), `poses`, `actors` (draws everyone from engine state), `cameraRig` + `cameraViews`, `intro`, `ball`, `effects`, `pitchGuide`, `landingRing`, `batAim`, `pitchAim`, `fielderRing`, `resolution`.
- Coordinates: feet, origin = back tip of home plate, `+x` right-field side, `-z` toward center field, `+y` up; the camera behind the plate is at `+z`. Person-local `+z` = facing, `+x` = their left hand; left-handers are the mirrored figure.

## Rules that must hold
- Logic never imports three.js or touches the DOM. Renderers read engine state and never change outcomes. Randomness only from the engine's seeded rng (draw it only where needed - extra draws change every seeded sequence).
- Timing never depends on frame rate (engine time, `swingPressed(sinceUpdate)`, physics precomputed at fixed steps).
- What the planner promises is exactly what is drawn: an out needs a fielder ON the bag WITH the ball before the runner (`coverOptions`, checked by `auditPlan`). The third out ends the play.
- Runners only move by themselves when forced; you send them by tapping a lit base, call back by tapping their dot. Every throw while you pitch is yours.
- Never let two surfaces coincide (z-fighting); every pose change cross-fades.
- Text the owner sees is labels only - no explanatory sentences on screen. Check HUD changes with `hudqa.mjs`.

## Known issues / open ideas
- Double plays a little common (~52-62%, MLB ~45-50), runner on third scores on fewer grounders (27%, MLB ~55-65), first-to-third rare (10%). Walks rare when you pitch (~1%). No pickoffs; you never run the computer's runners.
- The Credits say "personal use only" for the real club and player names: publishing publicly needs the owner's decision.
- Engine `pitchAim` (your aim spot) and app `pitchAim` (the renderer) share a name.
- Real-device performance never measured (this laptop renders in software).

## Machines
- **Fedora laptop** (`~/baseball`): Node 24 in `~/.local`, `gh` logged in, no Chrome - `CHROME_PATH=/opt/helium/helium`. The owner's local copy: copy `dist/` over `~/.local/share/sandlot/game` after a build.
- **Mac**: Homebrew Node / `gh`; Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. **Windows PC** (`C:\Users\Jack Correa\Projects\baseball`): Node 24 from winget; long tests time out when run all at once.
- Never `pkill -f` / `pgrep -f` with a pattern that is in the same command (it kills the shell). Find a dev server with `pgrep -x node` + `/proc/<pid>/cmdline`. Always `git fetch` and start from `origin/main`.
