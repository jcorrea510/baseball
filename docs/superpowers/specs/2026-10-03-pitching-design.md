# Pitching: you pitch the computer's half-inning - design

Date: 2026-10-03. Owner's request: "Plan how to add pitching. I want it to be high level. Something between Baseball 9, MLB 9
Innings, MLB The Show, and Backyard Baseball. Pitcher's POV. Don't make it boring like those games usually are when pitching."
Asked what makes pitching boring, the owner picked **too slow** and **no skill involved**. Choices made in the brainstorm: aim +
timing ring; pitch every computer half with a Sim button; stamina + a one-tap bullpen; real aces + a rated staff in the League with
pitchers in the shop; approach A (a real computer batter through the same physics).

## In plain words
In Quick Game and League you now pitch when the computer bats. You look in from behind your pitcher, pick a pitch, drag a target
onto the zone and tap as a shrinking ring meets it: the better the tap, the faster, sharper and more accurate the pitch. The
computer's batter reads the pitch, decides to take or swing by the count, and swings through the same bat-and-ball physics you bat
with, so a perfect pitch on the corner really is hard to hit and a hanging one really gets crushed. Your fielders make the plays by
themselves. Your pitcher tires; one tap brings in a reliever; one tap (Sim) finishes the half instantly. A pitch takes about 4-6
seconds from choosing it to the next pitch being ready.

## What success looks like
- **Fast:** about 4-6 s per pitch (choose + aim + ring + flight + call) and the next pitch can start ~1.5 s after a take or a foul.
  No Ready card, no catcher signs, no mound visits, no camera move on a take.
- **Skill on every pitch:** the ring result visibly changes speed, break and accuracy; aiming a breaking ball off the corner gets
  chases; a changeup after fastballs gets weak, early swings; a hanging WILD pitch gets hit hard.
- **Fair, by numbers:** measured with a simulated human pitcher (`scripts/pitchfeel.mjs`): an *average* person gives up about the
  runs per half that today's simulated computer half gives up on each level; a *good* one clearly fewer; a *new* one more; the
  levels stay in order (Rookie easiest).
- **Honest physics:** every computer at-bat goes through `computeSwing` -> `bat.js` -> `ballistics.js` -> `planPlay` ->
  `rules.applyPlay`; the referee (`playAudit`) finds nothing wrong on those plays, exactly as on the player's.
- **Nothing about batting changes** (camera, aim, help, difficulty, Derby). Home Run Derby is untouched.

## Out of scope (this version)
Pickoff moves, catcher signs / shake-offs, a pitch clock, mound visits, warm-up time, controlling fielders, the computer bunting,
pitchers batting, a "never pitch" setting (Sim covers it).

## Approaches considered
1. **A real computer batter through the same physics (chosen).** Swing decision and mistakes come from the pitch's quality, then
   the shared collision / flight / fielding code decides the result and the play is shown live. Most work, but everything after
   the swing decision already exists and is audited.
2. Dice first, then act it out: pick the result from odds shaped by the pitch, then invent a batted ball that produces it. Easier
   to tune; feels scripted; reverse-solving a flight for a chosen result is fiddly.
3. Approach 1 without showing plays: faster, but you never see your defense reward a good pitch.

## Design

### 1. One pitch (what the player does)
- **Camera** `camera.pitcher` (new preset in `config.js`, branch in `cameraRig.update` beside `batting`): behind and above the
  pitcher's throwing shoulder (starting values: position x = 2.4 toward his arm side, y 8, z -67; look at [0, 2.4, 0]; fov 30),
  so the batter, the zone and the catcher's target are mid-screen and the pitcher's back and arm sit in a near corner. Mirrored for
  a left-hander. Tuned with screenshots so the pitcher never covers the zone.
- **Choose:** the pitcher's 3-4 pitches as buttons along the bottom (keys 1-4), each labelled with its name and speed. The last
  choice stays selected.
- **Aim:** mouse move / finger drag / arrow keys move a target dot over the plane at the front of the plate (same plane and clamp
  as the bat aim, `swing.reach`). A faint arc from the no-break line to the dot shows the chosen pitch's shape at full quality.
- **Throw:** click / lift the finger / Space starts the delivery; the aim and the pitch lock. A ring around the dot shrinks over
  `pitching.ring.time` (starting value 0.9 s) while the windup plays. Tap (click / tap anywhere / Space) as the ring meets the dot.
  The ring meets the dot at `ring.hitAt` (.75 of the ring time, so a late tap is still possible) and closes at the end of the ring
  time. The delivery always lasts `pitching.delivery` (1.1 s) and the ball leaves the hand at its end whatever the tap was: the
  tap only sets the grade. The error is measured in ms from the moment the ring meets the dot:
  - **PERFECT** within `ring.perfect` (40 ms): speed x1, break x1, miss sigma `miss.perfect` .05 ft.
  - **GOOD** within `ring.good` (90 ms): speed x.98, break x.9, miss .15 ft.
  - **OK** within `ring.ok` (160 ms): speed x.94, break x.7, miss .3 ft.
  - **WILD** beyond that, or no tap before the ring closes: speed x.9, and either *sails* (half the time: the miss is .7 ft, pushed
    up and to the arm side for an early tap, down and glove side for a late one - often a ball, sometimes a hit batter or a pitch in
    the dirt) or *hangs* (the spot is pulled 60% toward the middle of the zone and up, break x.3).
  - Early taps miss up / arm side and late taps miss down / glove side at every grade, so a player learns which way he is off.
- **Ring speed:** x `ringSpeed` per pitch type (fastball 1, sinker 1, changeup 1.05, cutter 1.05, slider 1.1, splitter 1.1,
  curveball 1.15, heater 1.3), x the Control rating (`ratings` style: +-15% at 99 / 1), x fatigue (below).
- **Speed and break:** the fastball's top speed comes from the Velocity rating (`pitching.velo` 86 mph at 1 -> 100 at 99, other
  types by their `speedDelta`); break = the type's movement x the Stuff rating (`pitching.stuff` .8 at 1 -> 1.2 at 99) x the grade's
  break factor. `buildPitch` is used as is (`pace` 1: real speed; you watch, you do not react).
- **Then:** the ball flies, the batter takes or swings, the umpire calls it. On a ball in play your fielders make the play (the
  play camera, the Fast button and Space work as when batting). The catcher throws the ball back at once; the next pitch can start
  `pitching.nextPitch` 1.5 s after a call. No Ready card between batters: the next batter walks up while you already aim.
- **Feedback:** the grade flashes on the ring (PERFECT / GOOD / OK / WILD); PAINTED when a PERFECT pitch is called a strike within
  .15 ft of the zone's edge; a strikeout gets the punch-out call, a short slow-motion beat and a crowd roar. The count and the
  pitch's speed show beside the zone.

### 2. The computer's batter (`src/game/cpuBatter.js`, pure)
`decide(input) -> { swing: bool, errorMs, aim: {x, y} } | { swing: false }`, with `input` = the flight, the pitch's grade and
hang/sail, the count, the last two pitches (type, speed, spot), the batter (ratings when he has them), the level and the team's
strength. Its own numbers live in `config.cpuBat` (shared) and `config.difficulty.<level>.cpuBat` (per level). It never uses the
player's batting help (`windowScale`, `aimAssist`, `batBonus`, the level's contact window): it gets `cpuBat.window` and
`cpuBat.windowScale` of its own.
1. **Read:** he judges where the pitch will cross at `cpuBat.readTime` before the swing must start, from the pitch guide's
   no-break line moving toward the true spot (`game/pitchGuide.js`) plus a gaussian error `readSd` that grows with the break
   (x(1 + `breakRead` x break in ft)), with the grade (x`gradeFactor`: perfect 1.35, good 1.15, ok 1, hang .6) and when the pitch
   starts inside the zone and finishes outside it (`fadeOut` x1.4: the slider off the corner).
2. **Take or swing** on the *perceived* spot, from a table by count:
   - Perceived strike: `swingZone` (.72); 0-2 / 1-2 / 2-2 / 3-2 protect: .9.
   - Perceived edge (zoneRatio 1-1.3): `swingEdge` .45; with two strikes .8.
   - Perceived chase (1.3-1.9): `swingChase` .22; with two strikes .4.
   - Waste: .03.
   - **3-0: take** unless perceived heart (zoneRatio < .5) and a power rating >= 70 (then .3).
   - Ahead in the count (2-0, 3-1): perceived heart x1.15, edge x.6.
   - Stars chase less: swing chances on the edge and chase rows x(1 - .3 x (contact - 50) / 50).
3. **Swing errors:**
   - **Timing** error (ms) = gaussian(`timingSd`) + a bias from the speed change: `changeBias` ms per mph slower than the average
     of the last two pitches (early, negative error) or faster (late), capped at `changeCap`; x the grade factor; +`edgeTiming` on
     the edges / up and in / down and away; protect swings (two strikes) shrink the sd by `protectSd` and drop the bat speed (more
     fouls).
   - **Aim** = the perceived spot + gaussian(`aimSd`), with the bat a little under the ball (`under`, like `bot.js`).
   - The Contact rating shrinks both sds (`ratingEffects(batter).window` used as a divisor); Power adds `ratingEffects(...).ev`; a
     batter without ratings uses the team strength k = (rating - 50) / 20 as both (Contact-like: sds x(1 - .12 k), Power-like:
     +2 k mph).
4. Then `computeSwing` with those numbers, the same as for the player (misses, fouls, foul tips, balls in play).
- Hit by pitch, ball four, strikeouts and wild pitches (`planWildPitch`, already on pitches in the dirt with runners on) work
  through `rules.js` as they do now.
- The computer never bunts in this version.

### 3. The computer's base running (`src/game/cpuRunner.js`, pure)
- **Sends:** the bot's logic moved out of `bot.js` into one shared function (`bot.js` then calls it): after `plan.send.res`,
  looks at `rng(.15, .6)` s then every .4 s until `plan.send.main`, tries each lit base lead-first through a hypothetical
  `planPlay` re-plan and taps when the runner makes it, with `cpuRun.gamble` (.015 per look) misjudgements. Runners therefore never
  freeze: forced runners run, free ones are sent when it is safe.
- **Steals:** with a runner on first or second and the base ahead empty, a chance per pitch `cpuRun.steal` (.06) x his speed
  (x2 at speed 99, x.3 at 1) x the count (x1.5 on 1-0 / 2-1, x0 with two outs and two strikes) starts a steal through the
  existing `beginSteal` / `planSteal`. Your catcher's arm: `pitching.catcherArm` per level (.9 / 1 / 1.05).
- No pickoff move: the runner's lead and jump are the existing ones.

### 4. Stamina and the bullpen
- **Stamina** (`pitching.stamina`): a pitcher starts a game with `points` = `starter` 60-95 (by his Stamina rating) or
  `reliever` 20-35. Each pitch costs 1, x1.2 with a runner in scoring position, x1.15 at three balls, x1.3 for the heater.
  Below `tireFrom` (40%) the shortfall f (0 at 40%, 1 at 0) makes the ring up to `tireRing` +35% faster, the fastball up to
  `tireVelo` 4 mph slower, breaking balls up to `tireBreak` 20% flatter and the miss sigma up to x1.3. At 0 he keeps pitching,
  badly. Starting values aim at a starter good for ~4-5 innings of a 6-inning League game and ~3 innings of a Quick Game, checked
  with `pitchfeel.mjs` pitch counts.
- **Shown:** a pitcher tag (name, pitch count, a stamina bar that turns amber then red) near the score box while you pitch.
- **Bullpen button:** one tap opens a small panel with your available relievers (name, pitches, rating, stamina); one more tap
  brings him in at once - the old pitcher walks off, the new one is on the mound for the next pitch. A pitcher taken out cannot
  come back that game. Starters are not in the bullpen. No warm-up.
- **Sim button:** finishes the half with a computer pitcher through the same engine loop, stepped without drawing (in chunks over a
  few frames behind the inning recap, `pitching.sim.chunk` plays per frame). The computer pitcher is `pitcherAI.choosePitch` with
  your pitcher's arsenal and ratings and a ring grade rolled from `pitching.sim.grades` (perfect .25, good .4, ok .27, wild .08);
  stamina is used; a tired starter is replaced by the next reliever at 15% stamina. The recap lists what happened, built from the
  engine's results (the old `describe` texts move to the recap code).

### 5. Who pitches where
- **League** (`season.js`, `mlb.js`):
  - Each club in `MLB_TEAMS` gets `arms`: 3 starters and 2 relievers as `[name, role 'SP'|'RP', throws 'R'|'L', era, k9, bb9, velo,
    [pitch types], ip]` - real pitchers and last season's lines as remembered at the time of writing (no network check; corrections
    go in this table). A club short of real names is filled by generated arms rated from its tier.
  - Ratings from the line (`pitcherRatings`): Velocity from velo (92 -> 50, 99 -> 95), Control from bb9, Stuff from k9, Stamina
    from role and innings; `overall` gets a pitcher formula. Pitches = his real arsenal mapped onto the game's types.
  - **Your staff:** `s.staff` (5 pitchers) beside the 12 hitters; `s.rotation` index; per pitcher `rest` (0-1). Each League game
    starts the next starter in the rotation whose rest is >= `season.startMin` (.8), else the most rested. After a game each
    pitcher's rest falls by the share of stamina he used and every pitcher recovers `season.restPerGame` (starter .34, reliever .6)
    per game. Season lines for pitchers: IP, H, R, ER, BB, K, ERA.
  - **Old saves:** `season.v` stays 2 (progression drops a league with another version). `ensureStaff(s)` adds a staff, rotation
    and pitcher lines to a league that has none, on load.
  - **Roster screen:** a Hitters / Pitchers switch; the Pitchers list shows Velocity / Control / Stuff / Stamina, rest, and IP / K
    / ERA. Swapping a starter and a reliever changes roles.
  - **Shop:** pitchers among the offers (journeyman arms, and with `shop.starChance` a real arm from another club), priced by the
    pitcher `overall`; buying one replaces a pitcher (same refund rule as hitters).
  - **When you bat:** the opponent's pitcher is that club's starter for the day (its own rotation by game number), shown by name,
    and `choosePitch` draws types from his arsenal instead of `d.mix`; speed, command and locations still come from the level and
    `gameConfig(level, rating)` as now, so batting difficulty is unchanged.
  - The team strength (`gameConfig`) now also scales the computer batter (section 2) instead of the `ai` odds table.
- **Quick Game:** your League club's staff, all fresh, if you have picked a club; otherwise Sandlot's own generated staff
  (`teams.js`: 2 starters, 2 relievers). Your first starter (the best overall) starts; the rotation and rest are League-only.
  The opponent's starter is that club's best.
- **Practice:** a **Bat / Pitch** switch. Pitch: you throw to a computer batter (choose his side L / R and his level); no outs, the
  count resets after each at-bat, runners are not kept, every pitch type available, no stamina.
- **Home Run Derby:** unchanged.
- **New pitch types** (`config.pitch.types`, starting values, checked with `pitchmix.mjs` and screenshots): sinker (speedDelta -2,
  breakArm .7, hop -.25, back/side spin), cutter (-4, breakArm -.35, hop .35), splitter (-9, breakArm .3, hop -1.2, low spin).
  `PITCH_ORDER`, the pitch guide and the pitch pill learn their names.

### 6. The engine: whose half is it
- A half has an **offense** (`player` | `cpu`). The engine keeps one "side" record per team: lineup, pitcher (+ stamina,
  pitch count, used pitchers), fielding numbers (error scale, catcher arm), and the stats it feeds. Everything that reads
  `this.lineup` / `this.pitcher` / `d.errorScale` / `d.catcherArm` reads the side whose turn it is.
- **Phases while the player pitches:** `aim` (waiting for the player to start the delivery) -> `delivery` (windup + ring) ->
  `pitch` -> `play` -> `result` -> `aim`. `runAiHalf` / `aiSummary` are replaced by this loop; `start()`, `endHalf()` and the extra-
  innings runner pick the loop by the side.
- **Inputs:** `setPitchAim(x, y)`, `selectPitch(type)`, `startDelivery()`, `ringTap(sinceUpdate)` (frame-rate independent, like
  `swingPressed`), `bullpen(id)`, `simHalf()`. QA hooks as today (`pitchOverride` for the player's side is not needed;
  `cpuSwingOverride` forces the batter's decision).
- **Stats:** the computer's at-bats never touch `this.stats` (your batting) or your batters' lines. New `this.pitchStats` (outs,
  H, R, ER, BB, K, HR, pitches, per pitcher). **Earned runs:** a run is unearned when the runner who scored reached on an error;
  every other run is earned.
- **Saving:** `checkpoint()` before every pitch in both halves (the rng re-seed stays per pitch). The save adds the half's side
  state: pitcher ids in use, stamina, pitch counts, the last two pitches. `resume` branches on whose half it is and re-binds runners
  from both lineups. A save from before this change (no side state) resumes at the start of the player's next turn at bat, as now.
- **Determinism:** the computer batter, runner and Sim draw only from the engine's seeded rng; renderers read state only.
- `game/aiHalf.js` (`simulateHalf`) and the `difficulty.<level>.ai` tables are removed once `pitchfeel.mjs` has recorded today's
  runs per half from them as the balance target (kept in this spec's "Balance targets" below and in `tests/pitchfeel.test.js`).

### 7. On screen
- `render/pitchAim.js`: the target dot, the break arc, the shrinking ring and the grade flash (three.js, in the zone plane, drawn
  like `batAim`). `render/cameraRig.js`: the `pitcher` preset. `render/actors.js`: uniforms by half - your fielders and pitcher
  wear your uniform and the visitors bat in theirs (the cache key includes the side); computer batters are built from the
  opponent's lineup in their uniform; the release glint uses the pitcher's real hand.
- HUD (`ui.js`, `style.css`, built from the existing pieces; checked with `hudqa.mjs` - "no overlaps"):
  - Bottom centre: the pitch buttons (in place of the timing meter).
  - Bottom right: **Bullpen** and **Sim** (in place of Bunt / Steal; the Swing button hides).
  - Near the score box: the pitcher tag (name, pitches, stamina bar).
  - The batting-order panel shows the opponent's order with the man at bat.
  - The base diamond is not shown (you do not run their runners).
- `app.js`: `isPitching(e)` beside `isBatting(e)` (which now also checks the half); pointer / touch / keys route to the pitch
  inputs while pitching; the crowd stays on the player's side - it roars for your strikeouts and outs (`celebrate` on a big out),
  groans at their hits and homers; banners for their hits use the 'bad' style.
- Labels only, as everywhere: PERFECT / GOOD / OK / WILD, PAINTED, Bullpen, Sim, pitch names.

### 8. Stats and rewards
- `progression.js` career gains `pitching`: games, outs, H, R, ER, BB, K, HR, pitches, bestK, shutouts (merged into old saves by
  `merge(DEFAULT_SAVE(), saved)`).
- Results screen: your pitching line (IP, H, R, ER, BB, K) under the batting line.
- Badges: **Strike Out the Side** (all three outs of a half by strikeout, you pitched them), **10 K** (ten strikeouts in a game by
  your pitchers), **Shutout** (they score 0 and you pitched every out - no Sim).

## Balance targets and how they are checked
- `scripts/pitchfeel.mjs [halves] [new|average|good] [level]`: simulated human pitchers (`new`: ring tap sd 75 ms, aim shake .2
  ft, sometimes the wrong pitch; `average`: 50 ms, .12 ft; `good`: 30 ms, .07 ft, mixes speeds) against the computer's batters
  through the real engine. Prints runs / H / BB / K / HR per half, pitches per half, grade shares, chase %, contact %, and the
  referee's verdict.
- Before `aiHalf.js` is removed, the same script measures runs per half of today's simulated half per level (and per League team
  rating 26 / 40 / 54 / 68) as the target. Pass bands (`tests/pitchfeel.test.js`): average within +-20% of that target on each
  level; good at most 75% of average; new at least 115% of average; Rookie < Pro < All-Star for the average pitcher; strikeouts
  20-35% of batters for the average pitcher on Pro; walks under 12%.
- `scripts/sim.mjs` gains a bot pitcher (the `average` pitchfeel player) so whole games still run headless; its baseline is
  re-recorded in CLAUDE.md.

## Testing
- `tests/pitching.test.js`: ring grades at the edges of each window; early / late miss directions; WILD splits into sail / hang;
  fatigue raises ring speed and lowers velocity monotonically; Velocity / Stuff / Control map as specified.
- `tests/cpuBatter.test.js`: 3-0 takes (except the power-heart case); two strikes widens swings; perceived chase swings rise when a
  pitch fades out of the zone; a changeup after two fastballs gives early timing on average; across many swings a PERFECT pitch on
  the edge is squared up (quality >= good) less often than a hanging WILD one; stars chase less.
- `tests/cpuRunner.test.js`: sends only when the re-plan says safe (plus the gamble rate); steal attempts by speed and count.
- `tests/engine.test.js`: whole games with bots on both sides finish with a winner; the computer's at-bats never change the
  player's batting stats; a game saved mid-pitching-half resumes on the same pitch (same batter, count, stamina, the same next
  pitch outcome with the same inputs); Sim finishes a half; an old save without side state resumes at the player's next turn; the
  referee finds nothing wrong on thousands of computer at-bats (`auditPlan`). The ~30 tests that pin `playerSide: 'top'` keep it.
- `tests/season.test.js`: every club has 5 arms with valid ratings; rotation and rest; `ensureStaff` on an old league; shop
  pitchers and the replace rule; earned / unearned runs.
- Replaced: `tests/aihalf.test.js` and the AI-summary tests (engine, errors, season, steal) move to the pitched half.
- Scripts: `smoke.mjs` taps Sim where it tapped Skip; `playqa.mjs` pitches a few real pitches with real taps and Sims the rest;
  `hudqa.mjs` covers the pitching HUD; `leakqa.mjs` stays flat; `pitchmix.mjs` lists the new types.

## Build order (each stage leaves the game playable, is tested and pushed)
1. **Engine and logic:** sides, the pitching phases with simple inputs, `pitching.js`, `cpuBatter.js`, `cpuRunner.js`, Sim, saving,
   stats; `pitchfeel.mjs` with the recorded targets; the bot pitcher in `sim.mjs`. (On screen: the existing camera behind home
   plate, a plain target dot and plain buttons, so the loop is already playable.)
2. **Look and feel:** the pitcher's camera, `pitchAim.js` (dot, arc, ring, grade flash), the HUD pieces, uniforms by half, crowd
   and banners, PAINTED / strikeout moments.
3. **Stamina and the bullpen.**
4. **League arms:** the three new pitch types, real arms per club, ratings, rotation and rest, the Pitchers roster view, the shop,
   the opponent's real starter when you bat, `ensureStaff`.
5. **Practice Pitch, career pitching stats, results line, badges.**
6. **Balance:** tune to the bands with `pitchfeel.mjs` and `sim.mjs`; remove `aiHalf.js`; update CLAUDE.md (architecture, tuning
   table, baselines) and README's tuning table.
