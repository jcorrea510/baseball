# ⚾ Sandlot

**A baseball batting game that runs in your web browser, on a computer or a phone.** Watch the pitcher from behind the catcher, put the bat on the ball with your mouse or finger, time the swing, send the ball over the fence - and send your runners round the bases. Pick one of thirty big-league clubs and play a whole league season, or just a quick game. It looks like a real ballpark (striped grass, a dirt infield, dugouts, a packed crowd, day, dusk and night lighting) and it plays fast.

Everything in the game is made by code: the logo, players, stadium, crowd and every sound effect. The teams are the thirty big-league cities with their real colours, but every nickname and every player's name is changed a little (the New York Nets, the Los Angeles Dodgems, "Shohei Otani") so nobody is the real thing. The umpire's voice is a set of recordings kept in the project, and the pictures on the Play screen are screenshots of the game itself (`public/art/`, remade with `node scripts/art.mjs`). The only outside code is the three.js 3D engine (MIT licence - see Credits in the game).

## Play it

**https://baseball-jtc11.vercel.app** - every push to `main` updates it.

On a phone, turn it sideways for the best view. You can also add it to your home screen: it then opens full screen like an app.

## How to play

When a batter comes up you see the whole field; press **Ready** and the camera zooms in behind the catcher - you bat from there.

| Do this | To get this |
| --- | --- |
| **Move the mouse** (phones: drag a finger anywhere) | Move the see-through bat - its yellow ring (the sweet spot) follows you |
| **Click** or **Spacebar** (phones: the round **Swing** button, or a tap while the pitch is on its way) | Swing (or press **Ready** when a new batter comes up) |
| **Arrow keys** | Move the bat without a mouse |
| **Tap a gold base** on the little diamond (bottom right during a hit), or **1 / 2 / 3 / H** (H or 4 = home) | The runner behind that base runs to it |
| **B** or the **Bunt** button | Square around to bunt - he puts the bunt down by himself when the pitch comes |
| **S** or the **Steal** button | Send the runners on the next pitch |
| **Space** during a play | Fast-forward the play (a click or tap never does, so sending a runner can't skip it by accident) |
| **Esc** or **P** | Pause (and back out of any menu) |
| **M** | Mute |
| **F** | Full screen (there is a button for it, too) |
| **Z** | Show / hide the strike zone |
| **+ / -** (Practice) | Pitch speed |
| **Enter** / **Space** on a menu button, **Tab** to move between them | Use the menus without a mouse |

**Two skills:** put the bat where the ball will be, and swing so the bat gets there at the same moment.

* **The pitch guide** - the soft circle over the strike zone - appears just after the ball leaves the pitcher's hand and homes in on where the pitch will cross: put the bat's yellow ring on it. (It is less sure on harder levels, and a curveball's drop shows up a moment later.)
* **Where the bat meets the ball decides where it goes.** The bat a little *under* the middle of the ball sends it up and far - that is where home runs come from. Square on the middle: a line drive. On top of the ball: a ground ball. Way under it: a pop-up. Only the middle of the barrel squares the ball up; off it you just get a piece of it (a foul tip, a pop-up, a chopper). Miss it by more than the bat's reach and you swing right through (the swing then tells you: *Under it*, *Over it*, *Off the end*, *Jammed*).
* **Timing:** PERFECT is the hardest-hit ball, GOOD is solid; early swings *pull* the ball, late swings push it the other way. A small meter shows exactly how many milliseconds early or late you were.
* After every swing the see-through bat stays where you swung for a moment, and the real bat swings through that exact spot.

**Swing or take?** Pitches far outside the strike zone are hard to hit well, and some (way off the plate, in the dirt, high heat) cannot be hit at all. The **pitch guide** (a soft circle over the strike zone) shows where the pitch is heading in time to decide - but you can also just watch the ball: it is drawn big, with a dark rim, a shadow on the ground and a streak behind it; on Rookie and Pro the pitch type is named as it leaves his hand. On harder levels the guide is less sure and curveballs and sliders reveal their break late - but it never tells you anything before the ball is thrown.

**Running the bases:** runners only move by themselves when they are **forced** - the batter runs to first and pushes the runner on first to second, and so on. A runner with an open base behind him stays put. Everything else is up to you: the moment the ball is hit a little diamond appears in the bottom-right corner with a coloured dot for every runner, and a base **lights up gold** when you can send someone there. **Tap it** and the runner behind it goes. A base only lights up when nobody is already heading for it, so send the lead runner first (with runners on first and second, tap home, then third lights up for the other one). It appears on every ball, so it never gives away whether a fly ball will be caught. A runner you sent who sees the throw is going to beat him turns back to his bag by himself when he can make it. On a fly ball your runners go part of the way and wait (the man on third goes back to tag up, and scores by himself on a deep fly when it is a sure thing); send one before the catch and he has to get back if it is caught - he can be doubled off. After a catch you can tap a base to send a runner to **tag up**. The fielders throw at whoever they can get: a runner who is beaten slides into the tag and is called out, and the banner says so (*Out at 2nd*). The diamond goes away a moment after the fielder is ready to throw. After the play runners stand on their bag, and take their lead once the pitcher is back on the rubber.

**Strategy:** bunt to move a runner up (a sacrifice), steal a base (your runner goes with the pitcher's first move - the catcher's throw decides it), or send the runners and swing for a hit-and-run. Watch out: a runner who is going when a line drive is caught can be doubled off. Fielders make the odd error, too.

**Real baseball rules:** a foul tip held by the catcher is a strike (strike three with two strikes); a high pop-up on the infield with runners on first and second and fewer than two outs is an **infield fly** (the umpire calls the batter out while it is still in the air); a ball that bounces over the wall is a **ground-rule double**; a pitch in the dirt can get past the catcher (**wild pitch**: the runners move up); a pitch that hits you sends you to first (the computer's batters get hit now and then, too); in extra innings the runner on second is the batter just before the leadoff man; a walk-off scores only the runs it needs; there is no RBI on a double play or an error; and a batter who takes an extra base while the throw goes home is credited with a single (*to 2nd on the throw*). The fielders play the situation: the first baseman holds a runner on, the middle infielders play double-play depth, the right fielder backs up throws to first and the catcher runs down the line behind them.

Two helpers can be switched on and off: the **pitch guide** and the **landing ring** (a ring on the grass where a ball hit in the air will come down).

## What's in the game

* **League** - pick one of the thirty big-league clubs, with their real names, colours and best hitters (whose Contact / Power / Speed come from last season's average, home runs and steals; the team card shows those numbers). Home games are played in your club's own ballpark. You play your four division rivals and four teams from a neighbouring division: 8 or 16 games of 6 innings, weakest teams first and the best last. The other games - in your race and around both leagues - are played out, and the **Standings** show all thirty clubs in their six divisions. The top four of your race make the playoffs: a one-game semifinal, then a best-of-three **World Series**. Every game earns **coins** (more for wins, playoff wins and a title); spend them in the **Shop** on better players - now and then a star from another team is on the block. Every player has **Contact** (bigger timing windows), **Power** (the ball comes off harder) and **Speed** (he really runs faster). The **Roster** screen shows ratings and season numbers - tap two players to swap them in the batting order or bring one off the bench. You always bat in the bottom of the inning. A game is saved at every pitch: quit whenever you like and **Resume** puts you back at the same pitch (it cannot be re-rolled). Win it all and the league gets tougher next year; your roster and coins carry over.
* **Quick Game** - 3 innings against the computer, with balls and strikes, outs, runners, runs and a real scoreboard. It is saved at every pitch: the Quick Game tile then shows **Resume** and **New game** (and the pause menu has Restart). The computer's half-innings are played out instantly as a short highlights list. Tied after 3? Extra innings, starting with a runner on second base, and walk-off wins.
* **Home Run Derby** - 10 outs. Anything that is not a home run costs an out (on Rookie, fouls and misses are free). Taking a pitch is free.
* **Practice** - pick the pitch type, speed and location. Runners stay on base and the runs of the session are counted, but nobody is ever out for good.
* **3 levels** - *Rookie* (slow pitches, big timing windows, pitch names shown), *Pro* (real speeds, a mix of pitches), *All-Star* (fast, tricky, tiny windows - watch the pitcher's arm for tells).
* **31 ballparks** - Sandlot Park and every club's park, with its real shape and wall heights (Fenway's Green Monster, the short porch in Houston, Oracle's tall right-field wall, Wrigley's ivy; Coors Field's thin air carries the ball). Pick one on the Play screen (**Park**) for a Quick Game, the Derby or Practice; League games are at your club's park.
* **Unlockable bats and uniforms** for milestones (hits, home runs, wins, long bombs) in the *Locker*, and **career stats and records** saved on your device.

### Settings

From the title screen, the Play screen or the pause menu:

* **Sound:** master, effects, umpire and crowd volume (letting go of a slider plays a sample), and the umpire's voice on or off.
* **Game:** level, which side the batters hit from, time of day (dusk unless you change it), strike zone, pitch guide, landing ring.
* **Controls & screen:** *Swing delay* (if your screen or TV lags, slide it up until your perfect swings read PERFECT - it takes that many milliseconds off every press), camera shake, screen flashes.
* **Reset stats** (clears career stats and records; your settings, unlocked items and league stay). Restart, Quit, Reset and New league all take two taps, so a mis-tap never loses anything.

Sound stops by itself when you switch to another tab or another app.

## Play it on your own computer

You need [Node.js](https://nodejs.org) (version 20 or newer). Then, in a terminal inside this folder:

```bash
npm install     # one time: downloads the tools
npm run dev     # starts the game - open the address it prints (usually http://localhost:5173)
```

Other handy commands:

```bash
npm test        # the automated checks on the game rules, physics, season, sound and startup
npm run build   # makes the finished website in the "dist" folder
npm run smoke   # after a build: opens the finished site in a real browser, clicks through the menus and checks every startup error screen
npm run sim     # plays hundreds of computer-controlled games and prints statistics
node scripts/realism.mjs   # thousands of batted balls: who fields, covers, scores - next to real big-league numbers
```

## Publishing

The game is published on **Vercel**, which rebuilds it by itself on every push to **`main`**. Vercel runs no checks of its own, so GitHub runs them: `.github/workflows/deploy.yml` ("Check the game") runs the tests, builds the game and opens it in a real browser (the smoke test) on every push to `main`. A red run in the repository's **Actions** tab means that push should not be trusted. (GitHub Pages is switched off; nothing is published there.)

Vercel settings (also in `vercel.json`):

| Vercel setting | Value |
| --- | --- |
| Framework Preset | **Vite** |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` |
| Root Directory | (leave empty) |
| Environment Variables | **none** - never add `BASE_PATH` |
| Production Branch | `main` (check this: GitHub's *default* branch is an old `claude/...` branch, and Vercel may have picked that) |

If the game ever shows an error screen instead of the title, read it: it says whether the game files didn't load or the browser couldn't start 3D graphics (turn on hardware acceleration or try another browser). **Technical details** on that screen has a short note for whoever runs the site. "The game files didn't load" on Vercel means a build made for another address was deployed: check that no `BASE_PATH` variable is set, then redeploy without the build cache.

### The logo, icons and share picture

The logo is drawn by code (`src/ui/logo.js`). After changing it, run `npm run dev` and, in another window, `node scripts/brand.mjs` - it remakes the favicon, the home-screen icons and the share picture in `public/` from the logo and the real ballpark. Commit the new files.

## The umpire's voice

The umpire speaks with the recordings in `public/sounds/umpire/` (see the `README.txt` there for which file is used for which call: strike, strike one, strike two, strike three, ball, foul, out, safe, "play ball"). Several takes of a call are mixed at random, so it never sounds the same twice. A call with no recording is silent - the umpire still makes the signal. **Settings → Umpire voice → Off** silences him.

**To add or swap a recording - ask Claude.** Say which call it is and give a link or a file, for example *"Use this for strike three: https://.../clip.mp3"*. Claude cuts the silence off the start and end, brings it to the same loudness as the other calls, saves it under the right name and pushes it. If a link can't be downloaded (some sites block it), put the file in `public/sounds/umpire/` yourself, named like the others.

**The tool** (needs [ffmpeg](https://ffmpeg.org) installed once: `brew install ffmpeg` on a Mac, `winget install ffmpeg` on Windows, `sudo apt install ffmpeg` on Linux):

```
npm run umpire -- strike ~/Downloads/my-strike.wav
npm run umpire -- "strike three" https://example.com/strike3.mp3
npm run umpire -- ball ~/Downloads/ball2.mp3 --take b     # an extra version: ball_b.mp3
npm run umpire -- --list                                  # what is set up, what is missing
```

Use sounds you have the right to use.

## Tuning the game

If something feels too hard, too easy, too slow or too fast, open **`src/config.js`**. Every tunable number is there with a plain-English comment. The most useful ones:

| Feels... | Change |
| --- | --- |
| Timing too strict / too forgiving | `timing.perfectMs`, `timing.goodMs`, `timing.earlyMs`, `timing.lateMs`, or `difficulty.<level>.windowScale` |
| Pitches too fast / too slow | `difficulty.<level>.fastball` (speed range in mph) |
| Hard to tell whether to swing | `difficulty.<level>.guide` (when the pitch guide shows up and how sure it is), `difficulty.<level>.typeAtRelease` |
| Home runs too rare / too common | `field.fencePoints` (Sandlot Park's fence), `parks.scale` (the other parks), `contact.maxExitVelocity`, `bat.*` (how the bat and ball collide) |
| Bat too hard / too easy to put on the ball | `difficulty.<level>.contactWindow` (how far from the sweet spot still touches the ball), `difficulty.<level>.sweetSpot` (the part that squares it up), `swing.*` |
| Pitches arrive too fast to react (the speed shown stays the same) | `difficulty.<level>.pitchPace` |
| The circle shows up too late / is too far off | `difficulty.<level>.guide` (`fadeIn`, `sharpen`, `floor`) |
| The see-through bat (colour, see-through, how fast it follows) | `batAim.*` |
| The batting camera | `camera.catcher` |
| Sending runners too easy / too hard | `runner.sendTag`, `runner.sendReact`, `runner.roundPast`, `runner.sendLead`, `runner.sendAfter` (how long the diamond stays up), `runner.halfway`, `runner.autoMargin` |
| A park too easy / too hard to hit it out of | `parks.list.<park>` (fence distances, wall heights, air), `parks.scale` (all the big-league parks at once) |
| How a park looks (seats, decks, roof, skyline, landmarks, grass pattern) | `parks.looks.<park>` |
| Runners too timid / too bold on their own | `runner.freeAdvance` (true: a runner who is not forced takes the next base by himself when it is safe, instead of waiting for your tap), `runner.autoExtra` (true: they take a safe extra base by themselves again), `runner.autoMargin`, `runner.retreatRead` (how soon a runner you sent turns back when the throw will beat him), `fielding.throwSpeed.OF` |
| The score box too big on phones | `--bug-scale-phone`, `--bug-scale-portrait` at the top of `src/style.css` |
| Citi Field's apple | `parks.apple` (where it stands, how long it stays up) |
| Too many / too few hit batters | `difficulty.<level>.hitBatter` |
| Too many / too few wild pitches | `wildPitch.chance` (per pitch in the dirt or way wide, with runners on) |
| Double plays too easy / too hard | `fielding.pivot` (how long the turn at second takes), `fielding.align.dpDepth` |
| Where the fielders stand | `fielding.positions`, `fielding.align` (holding a runner on, double-play depth) |
| Balls bounce too much / too little | `physics.bounceSoftFrom`, `physics.bounceSoftTo`, `physics.bounceHardKeep`, `physics.trackRestitution` |
| Runner on third too timid / too bold on grounders and fly balls | `runner.contactBreak`, `runner.leadThird`, `fielding.tagUpMargin`, `fielding.tagUpDepth` |
| The camera loses a high pop-up | `camera.keepBall` |
| Bunts too easy / too hard | `bunt.*` |
| Steals too easy / too hard | `difficulty.<level>.catcherArm`, `steal.jump`, `runner.lead` |
| Too many / too few errors | `fielding.errors`, `difficulty.<level>.errorScale` |
| Fielders too good / too weak | `fielding.speed`, `fielding.reaction`, `fielding.glove` |
| Too much waiting between pitches | `pace.*` and `difficulty.<level>.windup` |
| Computer scores too much / too little | `difficulty.<level>.ai` |
| League too easy / too hard | `season.tierRating` (how good each tier of team is), `season.strength` (what a strong team does), `season.starters` (how good your role players are), `season.yearStep` |
| Players too cheap / too dear, coins too slow | `season.price`, `season.coins` |
| What a rating is worth | `ratings.conWindow`, `ratings.powMph`, `ratings.spdSpeed` |
| Derby too hard | `modes.derby.windowGrow`, `modes.derby.evBonus`, `modes.derby.pitchSpeed` |
| One sound too loud / too quiet for everyone | `audio.mix`, `audio.umpire.files.level`. Players can also adjust master / effects / umpire / crowd in Settings. |
| Pitch too small to see on phones | `pitch.minScreenPx`, `pitch.minScreenFrac` (picture only - timing is unchanged) |

## For developers

See **[CLAUDE.md](CLAUDE.md)** for how the code is organised, the checks to run and the known rough edges.
