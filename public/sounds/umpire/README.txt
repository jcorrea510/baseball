YOUR OWN UMPIRE RECORDINGS
==========================

Put audio files in this folder and the game plays them instead of its built-in umpire voice.

Name each file exactly like this (small letters, no spaces):

    strike.mp3     "Strike!"                       (also used for a swinging strike)
    ball.mp3       "Ball!"                         (also used for ball four)
    strike3.mp3    "Strike three! You're out!"
    foul.mp3       "Foul ball!"
    out.mp3        "Out!"
    safe.mp3       "Safe!"

Optional:

    ball4.mp3      "Ball four!"   (if missing, ball.mp3 is used)
    strike_b.mp3   a second take of "Strike!"; add strike_c.mp3, strike_d.mp3 ... for more.
                   The same works for every call above (ball_b.mp3, foul_b.mp3 ...).
                   One take is picked at random each time so it never sounds the same twice.

.wav and .ogg files work too. Calls without a file keep the built-in voice, so you can start with
just strike.mp3 and ball.mp3 and add the rest later.

Tips: keep each file short (under 2 seconds), trim the silence at the start so the call lands on time,
and record loud and clear (the game adds a little stadium echo on top).

After adding or changing files: stop and restart "npm run dev" if it is running, or push to main so the
site is rebuilt. Then open Settings -> Umpire -> Voice.
