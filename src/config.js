// ============================================================================
//  SANDLOT - config.js
//  EVERY tunable number in the game lives here. If something feels too hard,
//  too easy, too slow or too fast, this is the file to change.
//
//  Units: distances in FEET, speeds in MPH unless a name says "fps" (feet per
//  second), times in SECONDS unless a name ends in "Ms" (milliseconds).
//
//  Coordinate system (used everywhere in the game code):
//    origin  = back tip of home plate
//    +x      = toward first base / right field   (left of the screen when you
//              look from the pitcher's side; RIGHT of the screen from behind
//              the plate)
//    -z      = toward the pitcher / center field (the way the camera looks)
//    +y      = up
//    spray angle: 0 = straight to center, negative = left field, positive = right field
// ============================================================================

export const MPH = 1.4666667; // feet per second in one mph

export const CONFIG = {
  // --------------------------------------------------------------------------
  //  Ballpark geometry
  // --------------------------------------------------------------------------
  field: {
    baseDistance: 90,
    moundDistance: 60.5, // from the back tip of the plate to the rubber
    moundHeight: 0.85,
    // Fence distance (ft) at a few spray angles; the game smooths between them.
    // Make the numbers smaller to make home runs easier.
    fencePoints: [
      [-45, 315],
      [-22.5, 362],
      [0, 390],
      [22.5, 362],
      [45, 315],
    ],
    fenceHeight: 10, // ball must clear this to be a home run
    warningTrack: 18, // dirt strip in front of the wall
    foulPoleHeight: 48,
    // Grandstand behind the fence (drives both the drawing and where a home run lands)
    stands: { slope: 0.62, depth: 70 },
  },

  // --------------------------------------------------------------------------
  //  Physics for the batted ball
  // --------------------------------------------------------------------------
  physics: {
    gravity: 32.174, // ft/s^2
    ballRadius: 0.1208, // ft (1.45 in)
    dragK: 0.0019, // air drag (higher = ball dies in the air sooner)
    magnusK: 2.55e-5, // lift from backspin (higher = ball carries farther)
    groundRestitution: 0.42, // how bouncy the grass is
    groundFriction: 0.8, // fraction of sideways speed kept each bounce
    rollDecel: 13, // ft/s^2 slowing of a rolling ball
    stopSpeed: 0.8, // ft/s: below this a rolling ball is "stopped"
    wallRestitution: 0.34,
    wallFriction: 0.72,
    dt: 1 / 240, // fixed physics step (do not tie to frame rate)
    maxTime: 16,
  },

  // --------------------------------------------------------------------------
  //  Pitching
  // --------------------------------------------------------------------------
  pitch: {
    releaseZ: -54.5, // ball leaves the hand ~6 ft in front of the rubber
    contactZ: -1.0, // the plane where timing is measured (front-center of plate)
    catchZ: 1.15, // where the catcher's mitt sits
    drag: 0.085, // fraction of speed a pitch loses on the way to the plate
    zoneBottom: 1.55, // strike zone (ft above ground)
    zoneTop: 3.4,
    zoneHalfWidth: 0.708 + 0.121, // half the plate + one ball radius (edge counts)
    // How far from the middle of the zone the pitcher's targets are, in 'zone widths' (1.0 = the edge of the zone; the bat can
    // reach out to timing.reachRatio, and hits only weakly beyond timing.chaseRatio).
    locations: { edge: [0.9, 1.3], chase: [1.3, 1.9], waste: [1.9, 2.9] },
    wasteMinRatio: 1.75, // a 'waste' pitch is never wilder in the wrong direction than this: it stays out of reach
    ballScale: 1.35, // pitches are drawn a bit bigger so they are easy to track
    // Seeing the ball (all of it is picture only): a thin dark rim keeps a white ball visible against clouds, dirt and crowd; a soft
    // shadow right under it on the ground shows where it is and when it passes the plate; a short streak behind it shows its curve and
    // speed. No glow.
    rimColor: 0x0b1230, rimOpacity: 0.78, rimScale: 1.16,
    shadowOpacity: 0.6, shadowRadius: 0.5,
    trailColor: 0xdfe9ff, trailSize: 0.34, trailSeconds: 0.075, trailStrength: 0.5,
    // ...and on screen at least this many pixels across (or this fraction of the screen height, whichever is bigger) while it still
    // grows as it comes in: at release a real-size ball is only ~2.5 px on a phone held sideways. Only the picture: timing is unchanged.
    minScreenPx: 5,
    minScreenFrac: 0.009,
    // Movement is measured at the plate. breakArm: feet toward the pitcher's
    // throwing-arm side (negative = glove side). hop: feet of "extra rise"
    // (negative = extra drop) compared with plain gravity.
    types: {
      fastball: { label: 'Fastball', code: 'FB', speedDelta: 0, breakArm: 0.32, hop: 0.55, spinRpm: 2200, spin: 'back', armSlot: 0, glove: 0 },
      changeup: { label: 'Changeup', code: 'CH', speedDelta: -12, breakArm: 0.85, hop: -0.15, spinRpm: 1400, spin: 'back', armSlot: -0.05, glove: 1 },
      curveball: { label: 'Curveball', code: 'CB', speedDelta: -17, breakArm: -0.55, hop: -1.95, spinRpm: 2500, spin: 'top', armSlot: 0.22, glove: 2 },
      slider: { label: 'Slider', code: 'SL', speedDelta: -7, breakArm: -0.95, hop: -0.5, spinRpm: 2400, spin: 'side', armSlot: -0.16, glove: 3 },
      heater: { label: 'Heater', code: 'HT', speedDelta: 0, breakArm: 0.1, hop: 0.9, spinRpm: 2500, spin: 'back', armSlot: 0.05, glove: 0 },
    },
    heaterSpeed: [100, 104],
    windup: { ready: 0.3 }, // (per-difficulty windup lengths are below)
    // The pitch guide: a soft circle over the strike zone that guesses where the pitch will cross the plate. It fades in part of the
    // way through the flight, is a little off, and at first assumes the pitch will not break (curveballs and sliders only show where
    // they end up late). How early / how exact it is depends on the level: see `difficulty.<level>.guide`.
    guide: {
      color: 0xffe8a6, // soft warm white (never green or red: the colour must not give the call away)
      baseRadius: 0.22, // ft: radius of the circle when the guess is exact (a ball is 0.12 ft across at the plate)
      radiusPerError: 0.7, // ft of extra radius per ft of guess error: the less sure the guess, the bigger and softer the circle
      closeIn: 1.35, // the circle starts this much bigger than its final size and closes in as the ball arrives
      maxAlpha: 0.5, // how see-through it stays even when fully faded in
      errorShrink: 0.65, // the guess error at the plate is this fraction of the error at the start (it sharpens a little)
    },
  },

  // --------------------------------------------------------------------------
  //  Swing timing  (the heart of the game)
  //  errorMs = (when the bat reaches the plate) - (when the ball crosses it)
  //  negative = early, positive = late
  // --------------------------------------------------------------------------
  timing: {
    perfectMs: 20,
    goodMs: 42,
    earlyMs: 80, // beyond "good", up to here = weak/foul contact
    lateMs: 56, // late window is shorter (the catcher has the ball by then)
    swingDelay: 0.115, // seconds from pressing the button until the bat is at the plate
    decideTime: 0.22, // s a person needs to see where a pitch is going and press (used to judge how readable the pitch guide is)
    inputDelayMaxMs: 150, // the Settings "Swing timing" adjustment goes up to this (ms taken off every press on a laggy screen)
    inputDelayStepMs: 10,
    followThrough: 0.42,
    // Visual limits on how far in front of / behind the plate the bat can meet the ball
    reachEarly: 0.03,
    reachLate: 0.012,
    minSwingTime: 0.05,
    // Contact zone: how far outside the strike zone the bat can still reach
    reachRatio: 1.48, // 1.0 = zone edge. beyond this the bat whiffs
    chaseRatio: 1.14, // beyond this, contact is capped at "weak"
    zoneHalfHeight: 0.92,
    zoneCenterY: 2.5,
  },

  // --------------------------------------------------------------------------
  //  Contact: how timing + pitch location become exit velocity / angles
  // --------------------------------------------------------------------------
  contact: {
    maxExitVelocity: 109, // mph on a perfect hit
    exitVelocityFloor: 38,
    pitchSpeedBonus: 0.16, // extra mph of exit velocity per mph of pitch speed above 85
    qualityPerfect: [0.93, 1.0], // quality range inside each window
    qualityGood: [0.66, 0.93],
    qualityWeak: [0.25, 0.66],
    qualityCurve: 0.9,
    launch: {
      perfect: { center: 26, spread: 5 },
      good: { center: 18, spread: 9 },
      weak: { center: 8, spread: 19 },
      heightEffect: 8.5, // degrees of launch angle per foot of pitch height below the zone center
    },
    spray: {
      timingMax: 56, // degrees at the edge of the weak window
      timingCurve: 1.15,
      // Aiming (hold A/D, arrows or the touch buttons): the ball is steered toward `aimTarget` degrees (toward that gap); how much the
      // aim takes over from timing depends on the contact - a squared-up ball goes where you aim, a weak one mostly does not.
      aimTarget: 30,
      aimControl: { perfect: 0.8, good: 0.65, weak: 0.35 },
      aimPower: { pull: 0.03, oppo: -0.05 }, // exit velocity change for a fully aimed pull / opposite-field swing (a pull is strongest)
      noise: { perfect: 6, good: 8, weak: 10 },
    },
    backspin: { base: 900, perLaunchDeg: 55, max: 3400 }, // rpm
    sidespinMax: 750, // rpm at 45 degrees of spray (ball hooks toward the nearest foul line)
    locationFalloff: 0.55, // ratio (0..1) of the zone where contact stays full power
  },

  // --------------------------------------------------------------------------
  //  Bunting (B squares the batter around; the swing button pushes the bat at the ball)
  // --------------------------------------------------------------------------
  bunt: {
    windowMs: [45, 115], // ms of timing error: inside the first, a clean bunt; worse up to the second; beyond it the bunt misses
    reachRatio: 1.3, // (zone widths) pitches further out than this cannot be bunted
    exitVelocity: [24, 42], // mph: a soft, well-placed bunt .. one that got away from you
    goodLaunch: -12, // degrees: a good bunt is pushed down into the grass
    popLaunch: 32, // ...a bad one pops up
    launchSpread: 6,
    spray: [4, 22], // degrees off centre (random side) when you do not aim
    aimSpray: [16, 30], // ...and toward the line you aim at (hold left / right)
    sprayNoise: 6,
    foulChance: 0.45, // chance a poor bunt is pushed foul (scaled down for a good one)
    leadMargin: 0.35, // s: on a bunt the fielder only goes after the lead runner when he would beat him by this much (else the sure out at first)
  },

  // --------------------------------------------------------------------------
  //  Difficulty levels
  // --------------------------------------------------------------------------
  difficulty: {
    rookie: {
      label: 'Rookie',
      swingCue: true, // the strike-zone box pulses at the perfect moment to press the button
      windowScale: 1.5,
      fastball: [62, 72],
      mix: { fastball: 0.62, changeup: 0.12, curveball: 0.13, slider: 0.13, heater: 0 },
      // Where the computer pitcher throws (odds before the count changes them): 'heart' = in the zone, 'edge' = on the corners,
      // 'chase' = tempting but out of the zone, 'waste' = way out of reach (in the dirt, high heat, way off the plate).
      locations: { heart: 0.68, edge: 0.16, chase: 0.09, waste: 0.07 },
      // Pitch guide (see pitch.guide): fadeIn = fractions of the flight (0 = release, 1 = plate) where it starts and finishes fading in;
      // reveal = where it starts / finishes showing the pitch's break; error = feet the guess is typically off.
      guide: { fadeIn: [0.03, 0.18], reveal: [0.02, 0.3], error: 0.12 },
      commandSigma: 0.12, // ft of pitcher inaccuracy
      errorScale: 1.5, // how often the defense makes errors (x fielding.errors)
      catcherArm: 0.74, // x the catcher's exchange time on a steal. Set with each level's windup and pitch speed for steal success ~88% / 75% / 55%
      movementScale: 0.6,
      tellStrength: 1.0,
      announcePitch: true, // the pitch type is shown as he winds up
      typeAtRelease: true, // ...and when it leaves his hand
      windup: 1.3,
      stealBreak: 1.03, // s before the pitch is released that a runner takes off on a steal (the pitcher's first move)
      derbyFoulIsOut: false,
      // Odds for each plate appearance when the computer bats (its half-innings are simulated). error = safe on a misplay by your fielders.
      ai: { k: 0.26, bb: 0.06, groundout: 0.198, flyout: 0.18, error: 0.012, single: 0.15, double: 0.04, triple: 0.005, hr: 0.02 },
    },
    pro: {
      label: 'Pro',
      windowScale: 1.0,
      fastball: [80, 90],
      mix: { fastball: 0.46, changeup: 0.18, curveball: 0.18, slider: 0.18, heater: 0 },
      locations: { heart: 0.52, edge: 0.08, chase: 0.21, waste: 0.19 },
      guide: { fadeIn: [0.05, 0.22], reveal: [0.05, 0.45], error: 0.27 },
      commandSigma: 0.28,
      errorScale: 1.0,
      catcherArm: 1.05,
      movementScale: 1.0,
      tellStrength: 0.6,
      announcePitch: false,
      typeAtRelease: true, // the pitch type shows the moment it leaves his hand (a batter reads the spin): a curveball will drop
      windup: 1.15,
      stealBreak: 0.9,
      derbyFoulIsOut: true,
      swingCue: false,
      ai: { k: 0.22, bb: 0.08, groundout: 0.178, flyout: 0.16, error: 0.012, single: 0.19, double: 0.06, triple: 0.008, hr: 0.035 },
    },
    allstar: {
      label: 'All-Star',
      windowScale: 0.7,
      fastball: [88, 98],
      mix: { fastball: 0.36, changeup: 0.18, curveball: 0.17, slider: 0.19, heater: 0.1 },
      locations: { heart: 0.32, edge: 0.15, chase: 0.29, waste: 0.24 },
      guide: { fadeIn: [0.06, 0.22], reveal: [0.04, 0.42], error: 0.33 },
      commandSigma: 0.42,
      errorScale: 0.7,
      catcherArm: 1.1,
      movementScale: 1.25,
      tellStrength: 0.28,
      announcePitch: false,
      typeAtRelease: false, // All-Star: read it yourself (arm slot tells)
      windup: 1.05,
      stealBreak: 0.83,
      derbyFoulIsOut: true,
      swingCue: false,
      ai: { k: 0.19, bb: 0.09, groundout: 0.158, flyout: 0.15, error: 0.012, single: 0.21, double: 0.075, triple: 0.01, hr: 0.05 },
    },
  },

  // --------------------------------------------------------------------------
  //  Pacing (seconds). Keep these short: the game is meant to feel snappy.
  // --------------------------------------------------------------------------
  pace: {
    firstPitchDelay: 0.85, // batter walks up to the plate
    nextPitchDelay: 0.95, // gap between the call and the pitcher starting again (a moment to breathe between pitches)
    afterReady: 0.7, // s between pressing Ready for a new batter and the pitcher starting his windup
    callDisplay: 0.75, // how long the ball/strike call is shown
    playEndPause: 0.8, // pause after a play finishes
    pitcherSet: 0.65, // s the pitcher (and catcher) need to be set once they are back in place: no pitch before it
    fastForward: 4.5, // speed multiplier when you tap to skip a play
    aiSummaryLine: 0.55, // seconds per line of the computer's half-inning highlights
  },

  // --------------------------------------------------------------------------
  //  Game feel
  // --------------------------------------------------------------------------
  feel: {
    hitStopPerfect: 0.075, // freeze frame on perfect contact (seconds of real time)
    hitStopGood: 0.035,
    shakePerfect: 1.0,
    shakeGood: 0.5,
    shakeHomer: 0.7,
    slowMoScale: 0.28, // home-run slow motion speed (1 = normal)
    slowMoDuration: 0.85, // real seconds of slow-mo
    trailMinExitVelocity: 88, // mph needed to get a ball trail
    bigHitExitVelocity: 95, // mph at which the exit velocity/distance callout appears
    bigHitDistance: 250, // ft
  },

  // --------------------------------------------------------------------------
  //  Fielding and baserunning (used to decide hit / out / extra bases)
  // --------------------------------------------------------------------------
  fielding: {
    // Where each defender stands. Outfielders are given as [spray degrees, feet from home].
    positions: {
      P: [0, -60.5],
      C: [0, 4.0],
      '1B': [54, -70],
      '2B': [26, -113],
      SS: [-27, -113],
      '3B': [-54, -70],
    },
    outfield: { LF: [-24, 272], CF: [0, 308], RF: [24, 272] },
    speed: { IF: 20, OF: 21, P: 16, C: 16 }, // ft/s, average (effective, includes getting up to speed)
    reaction: { IF: 0.24, OF: 0.52, P: 0.36, C: 0.36 }, // seconds before a fielder reads the ball (outfielders read a ball off the bat a little slower: well-hit balls drop in more often)
    glove: 2.4, // ft: how far a fielder can reach without diving
    diveExtra: 3.0, // extra ft when diving (dive only on low balls)
    reachHeight: 8.8, // highest catchable point (ft): a leaping catch
    standReach: 6.2, // ft: how high his glove reaches with both feet on the ground (higher than this he has to jump)
    catchHeight: 5.2, // ft: a fielder who is there in time waits for the ball to come down to about this (chest / head height) before he takes it;
    // if he cannot wait he takes it at the lowest height he still can, and only jumps (up to reachHeight) for a ball he can get no other way - at the wall, say
    groundHeight: 3.2, // a ball this low counts as a ground ball for fielding
    transfer: { IF: 0.36, OF: 0.5, C: 0.4, P: 0.42 }, // catch-to-throw time
    throwSpeed: { IF: 120, OF: 132, C: 112, P: 100 }, // ft/s
    relayDistance: 200, // outfield throws longer than this use a cut-off man
    relayTransfer: 0.3,
    accel: 0.42, // seconds fielders take to get up to running speed (they cannot cover ground instantly)
    brake: 40, // ft/s^2: how hard a fielder can slow down (he eases to a stop instead of halting dead)
    minRunEffort: 0.62, // when a fielder has time to spare he still runs at least this fraction of top speed, then waits
    supportSpeed: 0.85, // backups and base-coverers run at this fraction of top speed
    backupDepth: 24, // ft behind the fielder's spot where a teammate backs him up
    backupTravel: 48, // an outfielder backing up an infield play charges in at most this far
    pitcherBackupTravel: 32, // the pitcher backing up home or third goes at most this far (he has to be back on the rubber for the next pitch)
    // The wall: a fielder's centre never gets closer than `wallMargin` ft to a wall (his glove still reaches it). Running at
    // the wall he brakes at up to `wallBrake` ft/s^2 (bracing against it), so he stops in front of it instead of through it.
    wallMargin: 1.8,
    wallBody: 1.0, // half his body width: while braking his centre may get this close to the wall
    wallBrake: 110,
    jogHome: { speed: 21, accel: 34, brake: 42 }, // ft/s: how fielders return to their spots after a play
    turnRate: 640, // degrees per second a fielder can turn his body
    // Diving: only for balls just out of running reach (glove + diveExtra). He sprints at the ball, launches `airTime` before
    // the glove meets it, lands `landAfter` after the catch, slides, lies there with the ball, then gets up.
    dive: {
      airTime: 0.32, // s airborne before the glove meets the ball
      landAfter: 0.12, // s after the catch that his body touches down
      armReach: 3.4, // ft the glove reaches in front of a layed-out body
      slideDecel: 30, // ft/s^2 sliding along the grass
      landSpeed: 11, // ft/s, top touchdown speed
      hold: 0.16, // s lying with the ball
      getUp: 0.62, // s to get back onto his feet
      throwExtra: 0.42, // extra s before a fielder who dove can throw (he throws from his knees)
      preferRun: 0.2, // nobody dives for a ball a fielder can simply run to within this many seconds
    },
    // Covering a base: an out needs a fielder standing on the bag WITH the ball before the runner gets there. Whoever is not fielding
    // the ball and is nearest to the play breaks for the bag; the fielder with the ball either carries it there himself (when he
    // is close) or throws to the covering man, and the throw is timed to reach the bag when he does.
    cover: {
      start: 0.3, // s after contact that a fielder assigned to a bag breaks for it (a pitcher covering first leaves the mound at once)
      minSpeed: 20, // ft/s: a fielder sprinting to a bag runs at least this fast (a pitcher covering first is not slow, he is hustling)
      selfDistance: 18, // ft: a fielder who picks the ball up this close to the bag steps on it himself (a first baseman near the bag)
      selfStart: 0.12, // s after he fields it before he starts for the bag with the ball
      selfBonus: 0.25, // s: how much a close fielder prefers taking the bag himself over a throw (it is the natural play)
      firstSelfDistance: 42, // ft: a first baseman who fields it this close to first base takes the bag himself (no flip to the pitcher)
      firstSelfBonus: 0.9, // s: and strongly prefers that to a throw - the pitcher only covers when the first baseman is pulled far off the bag
      traditionBonus: 0.35, // s: the usual man covers unless someone else is clearly quicker (the pitcher covers first when the first baseman is pulled off)
    },
    chaseShare: 0.72, // how much of the way to the ball the OTHER outfielder runs on a ball hit to the outfield (he runs at it too)
    thinForce: 0.1, // s: a force play that beats the runner by less than this is 'thin'...
    thinForceGain: 0.25, // s: ...and the fielder takes the batter at first instead when that out is this much safer
    tagTime: 0.4, // extra time for the catcher to receive a throw and apply the tag at home
    fastBallPenalty: 0.27, // extra reaction (s) fielders need on the hardest-hit grounders
    closePlay: 0.45, // a runner who beats the throw by less than this many seconds gets a 'Safe!' call
    outMargin: 0.02, // a throw must beat the runner by this many seconds
    runnerMargin: 0.1, // a runner must beat the throw by this to take an extra base
    // Errors (rare): a grounder bobbled, a fly ball dropped. Chance per chance, x difficulty.<level>.errorScale; hard chances (a smash,
    // a dive, a leap) are `hardFactor` times as likely. The ball pops loose `looseDist` ft and he needs `bobbleTime` / `dropTime` to
    // pick it up again - the batter and runners take whatever that delay gives them.
    errors: { ground: 0.04, fly: 0.018, hardFactor: 2, bobbleTime: 0.95, dropTime: 0.85, looseDist: 5 },
  },
  // Stealing a base (S / the Steal button before the pitch; quick games only). The runner goes with the pitcher's first move;
  // the catcher's exchange and throw race him to the bag, and the man covering needs a moment to put the tag on. Everything is
  // real timing (the same runner and fielder models as every play), with a little seeded luck in the jump and the exchange.
  steal: {
    jump: { 1: 0.02, 2: 0.03 }, // how much later a runner going to third breaks than one going to second is the difference (the level's stealBreak sets the rest)
    jumpSd: 0.09, // s: how much a jump varies (a good one, a late one)
    transfer: 0.74, // s: the catcher's exchange (catch to release)
    transferSd: 0.07,
    dirtExtra: 0.35, // s more when he has to dig a pitch out of the dirt
    tagTime: 0.12, // s to put the tag on at second or third
    coverReact: 0.35, // s after the runner goes that the infielder covering the bag breaks for it
    noThrow: 0.55, // s: if the runner would beat the throw by more than this, the catcher does not throw
    readFoul: 0.3, // s after contact a runner going with the pitch sees it is foul and pulls up
    readFly: 0.8, // s after contact he has read a fly ball (a line drive he only sees caught)
  },
  runner: {
    speed: 30.2, // ft/s top running speed
    accelTime: 0.42, // s a runner takes to get up to speed from a standstill
    brake: 55, // ft/s^2: how hard he can slow down (he brakes into a base, or slides)
    turnBrake: 30, // ft/s^2: how firmly he eases off for a corner (gentler than the stop at a bag)
    latAccel: 50, // ft/s^2: sideways grip in a turn. Speed in a turn is at most sqrt(latAccel / curvature), so he slows for the corner
    lead: 9, // ft: how far off the bag a runner stands before the pitch
    // What a runner does while the ball is in the air: he waits this long (s) before breaking for the next base (a fly ball or a pop-up
    // might be caught; a grounder he goes on at once).
    read: { ground: 0, line: 0.12, fly: 0.5, pop: 0.7 },
    holdStep: 0.22, // s a runner who was not sent keeps drifting toward the next base after a caught ball is hit, before he gets back to the bag
    // A gamble: the lead man tries for one more base than is safe when the throw only just beats him. window = how close (s) the
    // play may be, p = the chance he goes (less when it is closer to hopeless), twoOuts = x that with two outs (he is more careful).
    gamble: { window: 0.4, p: 0.6, twoOuts: 0.7 },
    leadSecond: 18, // ft: the lead off second base (nobody holds him on there, so he takes a much bigger one)
    // Rounding a base he keeps running through: he drifts out from the baseline over `turnLen` ft, goes round an arc of radius
    // `turnRadius` ft that touches the bag, and drifts back onto the next baseline over `turnLen` ft. (A smaller radius = a
    // sharper corner; he slows to at most sqrt(latAccel * radius) ft/s there.)
    turnRadius: 11,
    turnLen: 28,
    overrun: 22, // ft the batter runs on past first base when he is running through it (an out)
    batterStart: 0.34, // s after contact the batter leaves the box
    startDelay: 0.04, // runners on base leave almost as soon as the ball is hit (they are already leading off)
    trotSpeed: 21, // ft/s on a home-run trot
    jogSpeed: 20, // ft/s: the walk to first after ball four
    slide: 0.6, // s: a play is 'close' (he slides) when the throw arrives within this of him (either side)
    easeUp: 0.4, // s: once the third out is made, runners still going ease up and coast to a stop (how quickly their speed dies away)
    easeUpReact: 0.15, // s after the third out before the runners ease up
  },

  // --------------------------------------------------------------------------
  //  Modes
  // --------------------------------------------------------------------------
  modes: {
    quick: { innings: 3, extraInningRunner: true },
    derby: {
      outs: 10,
      pitchSpeed: { rookie: 58, pro: 66, allstar: 74 }, // batting-practice fastballs
      evBonus: 8, // extra exit velocity (mph): batting-practice balls jump off the bat
      // A "good" (not perfect) swing in the Derby still squares the ball up: the power range (0..1) and the launch angle
      // (degrees) it gets, in place of the Quick-game numbers above. This is what makes good timing leave the park some of the time.
      goodQuality: [0.74, 0.95],
      goodLaunch: { center: 24, spread: 7 },
      pullBonus: 6, // extra mph on a fully pulled ball (pulling is where a hitter is strongest)
      pullSpan: 30, // degrees toward the pull side that count as "fully pulled"
      locationSigma: 0.24,
    },
    practice: { speedMin: 45, speedMax: 105, speedDefault: 85 },
  },

  // --------------------------------------------------------------------------
  //  Camera and visuals
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  //  Landing spot ring: a ring lying on the grass where a ball hit in the air comes down (or under the spot where a fielder will catch
  //  it); it shrinks as the ball falls and is at its smallest the moment the flight ends. (Hidden once the ball lands or is caught.)
  // --------------------------------------------------------------------------
  landing: {
    minApex: 14, // ft: only balls hit up into the air get a ring (not grounders or low liners)
    minFlight: 1.0, // s: ...and only if they stay up at least this long
    delay: 0.45, // s after contact before the ring appears (the ball has left the bat)
    fadeIn: 0.3, // s the ring takes to fade in
    fadeOut: 0.18, // s it takes to fade away at the end of the flight (no pop)
    radiusStart: 18, // ft: how big the ring starts
    radiusEnd: 4.0, // ft: how small it is when the flight ends (a little more than a fielder's reach)
    minScreen: 0.02, // the ring is never smaller than this fraction of its distance from the camera, so it stays visible far away
    alpha: 0.85, // how see-through the ring is at its clearest (it lies flat on the grass like a chalk mark)
    color: 0xf4efc0, // soft warm white
  },

  camera: {
    batter: { pos: [0.0, 13.5, 24.0], pitch: -14.5, fov: 36 }, // camera behind the plate; pitch in degrees
    minHorizontalFov: 38, // narrow (portrait) screens widen the view to keep this
    highHome: { up: 36, back: 40 }, // ft the camera climbs / backs up from its spot behind the plate while it follows a deep ball
  },
  // --------------------------------------------------------------------------
  //  Sound
  // --------------------------------------------------------------------------
  audio: {
    // The mix: how loud each channel is at 100% on its slider (Settings has master, effects, umpire and crowd sliders).
    mix: {
      sfx: 1.0, // bat, glove, throws, thuds
      crowd: 1.0, // crowd noise, applause and the ballpark organ
      applause: 0.85, // loudness of a round of applause (before the crowd channel)
      glovePop: 2.4, // the catcher's mitt pop (x the built-in level): one of the signature sounds, so it is up front
      whoosh: 2.4, // the swing whoosh
      ui: 2.5, // menu clicks
    },
    umpire: {
      // The umpire's voice is the recordings in public/sounds/umpire/ (strike, strike1, strike2, strike3, ball, ball4, foul, out, safe,
      // playball, each with optional extra takes strike_b, strike_c...). A call without a recording is silent (he still signals).
      files: { folder: 'sounds/umpire/', level: 0.6, reverb: 0.2, echo: 0.5 }, // loudness of the recordings, stadium reverb and echo
      echo: { taps: [0.17, 0.35], levels: [0.3, 0.15], lowpassHz: 2400 }, // the slap-back off the far stands: delay (s) and loudness of each bounce
    },
  },

  quality: {
    crowdCount: 6500,
    crowdCountMobile: 3200,
    shadowMapSize: 2048,
    shadowMapSizeMobile: 1024,
    maxPixelRatio: 2,
    maxPixelRatioMobile: 1.6,
    targetFrameMs: 18.5, // if frames are slower than this, resolution scales down
    minPixelRatio: 0.7,
  },

  // --------------------------------------------------------------------------
  //  Progression
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  //  Season mode (game/season.js)
  // --------------------------------------------------------------------------
  season: {
    innings: 6, // innings in a season game
    cycles: { short: 1, full: 2 }, // how many times you play every other team (8 opponents: 8 or 16 games)
    // CPU team strength ratings (50 = the level you picked). Shuffled onto the teams each season; the schedule goes from the
    // weakest opponent to the strongest. `yearStep`: the next season's teams are this much better after a title (half after a
    // playoff trip), up to `yearCap` in all.
    tierRating: { 1: 26, 2: 33, 3: 40, 4: 47, 5: 54 }, // a team's strength from its tier (1 = rebuilding .. 5 = the team to beat); the league is a little gentler than before
    teamJitter: 3,
    yearStep: 4,
    yearCap: 24,
    // How a team's rating changes the game against it. s = (rating - 50) / spread, about -1 (weak) .. +1 (strong).
    strength: {
      spread: 20,
      fastballMph: 2.4, // their pitcher throws this much harder per unit of s
      heartShift: 0.07, // share of pitches moved from the heart of the zone to the edges/chase per unit of s
      commandSigma: 0.15, // x(1 - this*s): better teams hit their spots
      offense: 0.25, // their hits x(1 + this*s) when they bat, strikeouts x(1 - this*s/1.5)
      errors: 0.35, // their fielding errors x(1 - this*s)
      catcher: 0.07, // their catcher's exchange x(1 - this*s) (quicker against steals)
    },
    simK: 0.055, // two CPU teams: P(A wins) = 1 / (1 + e^(-simK * (ratingA - ratingB)))
    simRuns: 4.4, // average runs a CPU team scores in a simulated game (for the standings' run totals)
    playoffTeams: 4, // semifinal (1 game): 1 vs 4, 2 vs 3; World Series: best of `finalGames`
    finalGames: 3,
    // Coins: what a game is worth, and the price of players (by overall rating)
    coins: { start: 200, win: 25, marginBonus: 2, marginCap: 10, loss: 10, playoffWin: 50, playoffLoss: 20, title: 150 },
    price: { base: 30, over: 40, power: 1.6, scale: 1.25, round: 5, refund: 0.3 }, // price = base + scale * (ovr - over)^power
    roster: { size: 12, lineup: 9 },
    starters: { base: 40, perRating: 0.36 }, // the unnamed starters on your team are rated base + perRating x the team's strength (a strong team has better role players)
    bench: 44,
    ratingSd: 9,
    shop: { size: 6, refresh: 2, mean: 60, sd: 9, min: 44, max: 92, starChance: 0.4 }, // players on offer (journeymen, and now and then a star from another team); `refresh` are replaced after every game
  },
  // What a batter's ratings (0-99, 50 = average) do in a game. Only Season players have ratings; everyone else is average.
  ratings: {
    conWindow: 0.18, // Contact: timing windows x(1 + this * (con-50)/50)
    powMph: 6, // Power: exit velocity +- this many mph at 99 / 1 (on a well hit ball)
    spdSpeed: 0.08, // Speed: running speed x(1 + this * (spd-50)/50)
  },

  storageKey: 'sandlot.save.v1',
};

export const PITCH_ORDER = ['fastball', 'changeup', 'curveball', 'slider', 'heater'];
export const DIFFICULTIES = ['rookie', 'pro', 'allstar'];
