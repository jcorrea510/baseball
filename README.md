# ⚾ Sandlot

**A baseball batting game that runs in your web browser, on a computer or a phone.** Watch the pitcher, decide whether to swing, time it, aim it, and send the ball over the fence. Play a whole season with your own team, or just a quick game. It looks like a real ballpark (striped grass, a dirt infield, dugouts, a packed crowd, day, dusk and night lighting) and it plays fast.

Everything in the game is original and made by code: the logo, players, teams, stadium, crowd and every sound effect. The umpire's voice is a set of recordings kept in the project. The only outside code is the three.js 3D engine (MIT licence - see Credits in the game).

## Play it

**https://baseball-jtc11.vercel.app** - every push to `main` updates it.

On a phone, turn it sideways for the best view. You can also add it to your home screen: it then opens full screen like an app.

## How to play

| Do this | To get this |
| --- | --- |
| **Spacebar**, **click** or **tap** | Swing (or press **Ready** when a new batter comes up) |
| **A / D** or **← / →** (phones: the two round arrow buttons) | Aim toward left or right field |
| **B** or the **Bunt** button | Square around to bunt (the swing then pushes the bat at the ball) |
| **S** or the **Steal** button | Send the runners on the next pitch |
| Tap / click during a play | Fast-forward the play |
| **Esc** or **P** | Pause (and back out of any menu) |
| **M** | Mute |
| **Z** | Show / hide the strike zone |
| **Enter** / **Space** on a menu button, **Tab** to move between them | Use the menus without a mouse |

**The one skill:** swing so the bat reaches home plate at the same moment the ball does.

* **PERFECT** - dead on. The ball explodes off the bat (and is often a home run).
* **GOOD** - a solid hit.
* **EARLY / LATE** - weak contact or a foul. Early swings *pull* the ball, late swings push it the other way.
* Too early or too late - a miss.

After every swing a small meter shows exactly how many milliseconds early or late you were.

**Swing or take?** Pitches far outside the strike zone are hard to hit well, and some (way off the plate, in the dirt, high heat) cannot be hit at all. The **pitch guide** (a soft circle over the strike zone) shows where the pitch is heading in time to decide; on Rookie and Pro the pitch type is named as it leaves his hand. On harder levels the guide is less sure and curveballs and sliders reveal their break late - but it never tells you anything before the ball is thrown.

**Aim:** hold a direction and a well-hit ball goes into that gap. The better the contact, the more the aim wins; pulling adds a little power.

**Strategy:** bunt to move a runner up (a sacrifice), steal a base (your runner goes with the pitcher's first move - the catcher's throw decides it), or send the runners and swing for a hit-and-run. Watch out: a runner who is going when a line drive is caught can be doubled off. Fielders make the odd error, too.

Two helpers can be switched on and off: the **pitch guide** and the **landing ring** (a ring on the grass where a ball hit in the air will come down).

## What's in the game

* **Season** - your team, the Sandlot Sluggers, against eight other teams, some good and some bad. 8 or 16 games of 6 innings; you meet the weakest teams first and the best last. The other games are played out for the standings. The top four make the playoffs: a one-game semifinal, then a best-of-three **World Series**. Every game earns **coins** (more for wins, playoff wins and a title); spend them in the **Shop** on better players. Every player has **Contact** (bigger timing windows), **Power** (the ball comes off harder) and **Speed** (he really runs faster). The **Roster** screen shows ratings and season numbers - tap two players to swap them in the batting order or bring one off the bench. When a batter comes up, his card shows his average, home runs and ratings. Win it all and the league gets tougher next season; your roster and coins carry over.
* **Quick Game** - 3 innings against the computer, with balls and strikes, outs, runners, runs and a real scoreboard. The computer's half-innings are played out instantly as a short highlights list. Tied after 3? Extra innings, starting with a runner on second base, and walk-off wins.
* **Home Run Derby** - 10 outs. Anything that is not a home run costs an out (on Rookie, fouls and misses are free). Taking a pitch is free.
* **Practice** - pick the pitch type, speed and location. Runners stay on base and the runs of the session are counted, but nobody is ever out for good.
* **3 levels** - *Rookie* (slow pitches, big timing windows, pitch names shown), *Pro* (real speeds, a mix of pitches), *All-Star* (fast, tricky, tiny windows - watch the pitcher's arm for tells).
* **Unlockable bats and uniforms** for milestones (hits, home runs, wins, long bombs) in the *Locker*, and **career stats and records** saved on your device.

### Settings

From the title screen, the Play screen or the pause menu:

* **Sound:** master, effects, umpire and crowd volume (letting go of a slider plays a sample), and the umpire's voice on or off.
* **Game:** level, which side the batters hit from, time of day, strike zone, pitch guide, landing ring.
* **Controls & screen:** *Swing delay* (if your screen or TV lags, slide it up until your perfect swings read PERFECT - it takes that many milliseconds off every press), camera shake, screen flashes.
* **Reset stats** (clears career stats and records; your settings, unlocked items and season stay). Restart, Quit, Reset and New league all take two taps, so a mis-tap never loses anything.

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
| Home runs too rare / too common | `field.fencePoints` (fence distances), `contact.maxExitVelocity`, `contact.launch.perfect` |
| Aiming too strong / too weak | `contact.spray.aimControl`, `contact.spray.aimTarget` |
| Bunts too easy / too hard | `bunt.*` |
| Steals too easy / too hard | `difficulty.<level>.catcherArm`, `steal.jump`, `runner.lead` |
| Too many / too few errors | `fielding.errors`, `difficulty.<level>.errorScale` |
| Fielders too good / too weak | `fielding.speed`, `fielding.reaction`, `fielding.glove` |
| Too much waiting between pitches | `pace.*` and `difficulty.<level>.windup` |
| Computer scores too much / too little | `difficulty.<level>.ai` |
| Season too easy / too hard | `season.teamRatings` (how good the other teams are), `season.strength` (what a strong team does), `season.yearStep` |
| Players too cheap / too dear, coins too slow | `season.price`, `season.coins` |
| What a rating is worth | `ratings.conWindow`, `ratings.powMph`, `ratings.spdSpeed` |
| Derby too hard | `modes.derby.evBonus`, `modes.derby.pitchSpeed` |
| One sound too loud / too quiet for everyone | `audio.mix`, `audio.umpire.files.level`. Players can also adjust master / effects / umpire / crowd in Settings. |
| Pitch too small to see on phones | `pitch.minScreenPx`, `pitch.minScreenFrac` (picture only - timing is unchanged) |

## For developers

See **[CLAUDE.md](CLAUDE.md)** for how the code is organised, the checks to run and the known rough edges.
