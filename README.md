# ⚾ Sandlot

**A baseball batting game that runs in your web browser, on a computer or a phone.** Watch the pitcher, time your swing, aim it, and send the ball over the fence. It looks like a real ballpark - striped grass, a dirt infield, dugouts, a packed crowd, day, dusk and night lighting - and it plays fast: about two seconds between pitches.

Everything in the game is original and made by code: the logo, players, teams, stadium, crowd and every sound. Nothing is downloaded from anywhere else and nothing is copied (the only outside code is the three.js 3D engine, MIT licence - see Credits in the game).

## Play it

* **Vercel:** **https://baseball-jtc11.vercel.app** (every push to `main` updates it).
* **GitHub Pages:** **https://jcorrea510.github.io/baseball/** (also updated on every push to `main`).

On a phone, turn it sideways for the best view. You can also add it to your home screen: it then opens full screen like an app.

## How to play

| Do this | To get this |
| --- | --- |
| **Spacebar**, **click** or **tap** | Swing |
| **A / D** or **← / →** (phones: the two round arrow buttons) | Aim toward left or right field |
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

Pitches far outside the strike zone are hard to hit well, and some (way off the plate, in the dirt, high heat) cannot be hit at all. Let them go and make the pitcher throw strikes! The harder the level, the more of them he throws, and the nastier they are.

Two helpers can be switched on and off: the **pitch guide** (a soft circle that guesses where the pitch will cross the plate - on harder levels it shows up later and is less sure) and the **landing ring** (where a ball hit in the air will come down).

## What's in the game

* **Quick Game** - 3 innings against the computer, with balls and strikes, outs, runners, runs and a real scoreboard. The computer's half-innings are played out instantly as a short highlights list. Tied after 3? Extra innings, starting with a runner on second base, and walk-off wins.
* **Home Run Derby** - 10 outs. Anything that is not a home run costs an out (on Rookie, fouls and misses are free). Taking a pitch is free.
* **Practice** - pick the pitch type (fastball, changeup, curveball, slider, the rare 100+ mph *heater*), the speed and the location, and see your timing and exit speed after every swing.
* **3 levels** - *Rookie* (slow pitches, big timing windows, pitch names shown, a "swing now" cue), *Pro* (real speeds, a mix of pitches), *All-Star* (fast, tricky, tiny windows - watch the pitcher's arm for tells).
* **Unlockable bats and uniforms** for milestones (hits, home runs, wins, long bombs) in the *Locker*, and **career stats and records** saved on your device.

### Settings

From the title screen, the Play screen or the pause menu:

* **Sound:** master, effects, umpire and crowd volume (letting go of a slider plays a sample), and the umpire's voice (see below).
* **Game:** level, which side the batters hit from, time of day, strike zone, pitch guide, landing ring.
* **Controls & screen:** *Swing delay* (if your screen or TV lags, slide it up until your perfect swings read PERFECT - it takes that many milliseconds off every press), camera shake, screen flashes.
* **Reset stats** (clears career stats and records; your settings and unlocked items stay). Restart, Quit and Reset all take two taps, so a mis-tap never loses anything.

## Play it on your own computer

You need [Node.js](https://nodejs.org) (version 20 or newer). Then, in a terminal inside this folder:

```bash
npm install     # one time: downloads the tools
npm run dev     # starts the game - open the address it prints (usually http://localhost:5173)
```

Other handy commands:

```bash
npm test        # the automated checks on the game rules, physics, sound and startup
npm run build   # makes the finished website in the "dist" folder
npm run smoke   # after a build: opens the finished site in a real browser, clicks through the menus and checks every startup error screen
npm run sim     # plays hundreds of computer-controlled games and prints statistics
```

## Publishing

Every push to the **`main`** branch publishes the game in two places at once:

* **GitHub Pages** - `.github/workflows/deploy.yml` runs the tests, builds the game, opens it in a real browser (the smoke test) and only then publishes it. If anything fails, the old version stays up. One-time setting (already done): repository **Settings → Pages → Source: GitHub Actions**. Never pick "Deploy from a branch": that publishes the raw source code and the page shows "The game files didn't load".
* **Vercel** - rebuilds on its own from `main`. It does **not** run the tests, so the GitHub run (Actions tab, "Deploy to GitHub Pages", green check) is the one that tells you a push is healthy. Vercel settings (also in `vercel.json`):

| Vercel setting | Value |
| --- | --- |
| Framework Preset | **Vite** |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` |
| Root Directory | (leave empty) |
| Environment Variables | **none** - never add `BASE_PATH` |
| Production Branch | `main` (check this: GitHub's *default* branch is an old `claude/...` branch, and Vercel may have picked that) |

The build works out the web address layout by itself (GitHub Pages serves the game under `/baseball/`, Vercel at `/`), and gives link previews (the picture and text shown when someone shares the link) the right full address on each host.

If the game ever shows an error screen instead of the title, read it: it says whether the game files didn't load or the browser couldn't start 3D graphics (turn on hardware acceleration or try another browser). **Technical details** on that screen has a short note for whoever runs the site. On Vercel, "The game files didn't load" means a build made for another address was deployed: check that no `BASE_PATH` variable is set, then redeploy without the build cache.

### The logo, icons and share picture

The logo is drawn by code (`src/ui/logo.js`). After changing it, run `npm run dev` and, in another window, `node scripts/brand.mjs` - it remakes the favicon, the home-screen icons and the share picture in `public/` from the logo and the real ballpark. Commit the new files.

## The umpire's voice

The umpire is heard in three ways. Pick one in **Settings → Umpire voice** (also in the pause menu's Settings):

| Setting | What you hear |
| --- | --- |
| **Voice** (default) | Your own recordings if you added any (below); every call without a recording is spoken by the game's built-in voice, sent through a compressor and a stadium echo. |
| **Browser** | Your device's own speech voice (the game picks the deepest male English voice it can find and speaks low and slow). How good it sounds depends entirely on your device, and it cannot get an echo. |
| **Off** | No voice (the umpire still gestures). |

### Using real recordings (the most natural sound)

**The easy way - ask Claude.** Say which call it is and give a link or a file, for example *"Use this for strike three: https://.../clip.mp3"*. Claude downloads it, cuts the silence off the start and end, brings it to the same loudness as the other calls, converts it to a small mp3, saves it as `public/sounds/umpire/strike3.mp3`, and pushes it. If a link can't be downloaded (some sites block it), put the file in the repo yourself (next section) or upload it and give me the path.

**Doing it yourself (no tools needed).** Put the file in the folder `public/sounds/umpire/` and name it **exactly** like this (small letters, no spaces):

| File | Said when |
| --- | --- |
| `strike.mp3` | a called or swinging strike |
| `ball.mp3` | a ball (and ball four, unless you add `ball4.mp3`) |
| `strike3.mp3` | strike three ("Strike three! You're out!") |
| `foul.mp3` | a foul ball |
| `out.mp3` | an out |
| `safe.mp3` | a close play, safe |

- To **swap** a sound, put a new file with the same name in the folder (or use the tool below - it also removes the old copy).
- Optional: `ball4.mp3` for "Ball four!", and extra versions of any call named with an underscore and one letter - `strike_b.mp3`, `strike_c.mp3` ... - so it does not sound the same every time (one is picked at random). To go back to the built-in voice for a call, delete its file(s).
- `.wav` and `.ogg` files work too. Calls without a file keep the built-in voice, so you can start with just `strike.mp3` and `ball.mp3`.
- Trim the silence at the start yourself, or the call will land late - or let the tool below do it.
- Then push to `main` (or, on your own computer, stop and restart `npm run dev`). The game plays your files with **Settings → Umpire voice → Voice**. It adds a light stadium echo, and the mute button silences them like every other sound.

**The tool** (needs [ffmpeg](https://ffmpeg.org) installed once: `brew install ffmpeg` on a Mac, `winget install ffmpeg` on Windows, `sudo apt install ffmpeg` on Linux):

```
npm run umpire -- strike ~/Downloads/my-strike.wav
npm run umpire -- "strike three" https://example.com/strike3.mp3
npm run umpire -- ball ~/Downloads/ball2.mp3 --take b     # an extra version: ball_b.mp3
npm run umpire -- --list                                  # what is set up, what is missing
```

It trims the silence off both ends, brings the loudness to a standard level (so no call is louder than another), makes a small mono mp3 and saves it under the right name. Options: `--format ogg|wav`, `--threshold -60` (if a noisy recording is not being trimmed), `--no-trim`. Only real sound files work - a link to a web page (YouTube, a download page) does not; download the sound first.

Use sounds you have the right to use.

## Tuning the game

If something feels too hard, too easy, too slow or too fast, open **`src/config.js`**. Every tunable number is there with a plain-English comment. The most useful ones:

| Feels... | Change |
| --- | --- |
| Timing too strict / too forgiving | `timing.perfectMs`, `timing.goodMs`, `timing.earlyMs`, `timing.lateMs`, or `difficulty.<level>.windowScale` |
| Pitches too fast / too slow | `difficulty.<level>.fastball` (speed range in mph) |
| Home runs too rare / too common | `field.fencePoints` (fence distances), `contact.maxExitVelocity`, `contact.launch.perfect` |
| Fielders too good / too weak | `fielding.speed`, `fielding.reaction`, `fielding.glove` |
| Too much waiting between pitches | `pace.*` and `difficulty.<level>.windup` |
| Computer scores too much / too little | `difficulty.<level>.ai` |
| Derby too hard | `modes.derby.evBonus`, `modes.derby.pitchSpeed` |
| One sound too loud / too quiet for everyone | `audio.mix` (effects, crowd, applause, glove pop, swing, menu clicks), `audio.umpire.level` (built-in voice), `audio.umpire.files.level` (your recordings). Players can also adjust master / effects / umpire / crowd in Settings. |
| Umpire too polite / too echoey | `audio.umpire.rasp`, `audio.umpire.echo`, `audio.umpire.reverb` |
| Pitch too small to see on phones | `pitch.minScreenPx`, `pitch.minScreenFrac` (picture only - timing is unchanged) |
| Derby home runs too rare / too common | perfect swings: `modes.derby.evBonus`, `contact.launch.perfect`; good swings: `modes.derby.goodQuality`, `modes.derby.goodLaunch`; pulled balls: `modes.derby.pullBonus` (run `node scripts/hrrate.mjs` to see the percentages) |

## For developers

See **[CLAUDE.md](CLAUDE.md)** for how the code is organised, the checks to run and the known rough edges.
