# ⚾ Sandlot

**A baseball batting game that runs in your web browser.** Watch the pitcher, time your swing, and try to send the ball over the fence. It looks like a real ballpark (grass with mowing stripes, a dirt infield, a packed crowd, day and night lighting) and plays fast: about two seconds between pitches.

Everything in the game is original and made by code: the players, teams, sounds, crowd and stadium. Nothing is downloaded and nothing is copied from anywhere.

## How to play

| Do this | To get this |
| --- | --- |
| **Spacebar**, **click**, or **tap** | Swing |
| **A / D** or **← / →** (phones: the two round arrow buttons) | Aim the ball toward left or right field |
| **Z** | Show / hide the strike zone |
| **Esc** or **P** | Pause |
| **M** | Mute |
| Tap / click during a play | Fast-forward the play |

**The one skill:** swing so the bat reaches home plate at the same moment the ball does.

* **PERFECT** - dead on. The ball explodes off the bat (and is often a home run).
* **GOOD** - a solid hit.
* **EARLY / LATE** - weak contact or a foul. Early swings *pull* the ball, late swings push it the other way.
* Too early or too late - a miss.

After every swing a small meter shows exactly how many milliseconds early or late you were.

Pitches that are far outside the strike zone are hard to hit well. Let them go and make the pitcher throw strikes!

## What's in the game

* **Quick Game** - 3 innings against the computer. Full count (balls, strikes), outs, runners on base, runs and a real scoreboard. The computer's half-innings are played out instantly as a short highlights list. Tied after 3? Extra innings, starting with a runner on second base.
* **Home Run Derby** - 10 outs. Anything that is not a home run costs you an out (on Rookie, fouls and misses are free). Taking a pitch is free. Tracks your longest home run and best streak.
* **Practice** - pick the pitch type (fastball, changeup, curveball, slider, the rare 100+ mph *heater*), pick the speed, and see your timing after every swing.
* **3 difficulty levels** - *Rookie* (slow pitches, big timing windows, pitch names shown), *Pro* (real speeds, mix of pitches), *All-Star* (fast, tricky, tiny windows - watch the pitcher's arm for tells).
* **Day, dusk and night** ballparks, with fireworks after home runs.
* **Unlockable bats and uniforms** for reaching milestones (hits, home runs, wins, long bombs). They live in the *Locker*.
* **Career stats and records** saved on your device.

## Play it

The published game lives at **https://jcorrea510.github.io/baseball/** (it goes live after the one-time GitHub setting described below).

### Play it on your own computer

You need [Node.js](https://nodejs.org) (version 20 or newer). Then, in a terminal inside this folder:

```bash
npm install     # one time: downloads the tools
npm run dev     # starts the game - open the address it prints (usually http://localhost:5173)
```

Other handy commands:

```bash
npm test        # runs the automated checks on the game rules and physics
npm run build   # makes the finished website in the "dist" folder
npm run smoke   # after a build: opens the finished site in a real browser and checks it reaches the title screen
npm run sim     # plays hundreds of computer-controlled games and prints statistics
```

## Publishing (GitHub Pages)

Every time something is pushed to the **`main`** branch, GitHub automatically tests, builds and publishes the game (see `.github/workflows/deploy.yml`).

**One-time setup on the GitHub website:**

1. Open the repository page → **Settings** (top row of tabs).
2. In the left sidebar click **Pages**.
3. Under **Build and deployment**, open the **Source** drop-down and choose **GitHub Actions**. **Do not** pick "Deploy from a branch": that publishes the raw source code instead of the finished game, and the page shows an error screen ("The game files didn't load").
4. Go to the **Actions** tab, click **Deploy to GitHub Pages** in the left list, then **Run workflow** → **Run workflow**. Wait for the green check mark (about two minutes) - the game is then live.

**How to tell it worked:** the run named "Deploy to GitHub Pages" is green and has no yellow warning. If you still see a second run named "pages build and deployment" (with a "Build with Jekyll" step) after each push, or a yellow "Set GitHub Pages to GitHub Actions" warning on the run, Pages is still on "Deploy from a branch" - go back to step 3.

If the game ever shows an error screen instead of the title screen, read the message on it: it says whether the game files didn't load (the Pages setting above) or the browser couldn't start 3D graphics (turn on hardware acceleration or try another browser).

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

## For developers

See **[CLAUDE.md](CLAUDE.md)** for how the code is organised.
