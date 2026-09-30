THE UMPIRE'S RECORDINGS
=======================

These files are the umpire's voice. A call with no file here is silent (the umpire still signals it).

What is here now, and when each is said:

    strike.mp3, strike_b.mp3        "Strike!" / "Strrrike!"          any strike (mixed in with the two below)
    strike1.mp3                     "Strike one!"                    the first strike of a count
    strike2.mp3, strike2_b.mp3      "Strike two!"                    the second strike
    strike3.mp3, strike3_b.mp3      "Strike three, you're out!"      strike three
    ball.mp3                        "Ball!"                          every ball, including ball four
    foul.mp3, foul_b.mp3            "Foul ball!"
    out.mp3, out_b.mp3, out_c.mp3   "Out!" / "You're out!"           outs at a base
    safe.mp3                        "Safe!"                          close plays
    playball.mp3                    "Play ball!"                     the start of a game

Optional: ball4.mp3 ("Ball four!") would be used for ball four instead of ball.mp3.

Extra takes: add _b, _c, _d ... to any name (out_d.mp3). All the takes that fit a call are mixed and
one is picked at random each time, so it never sounds the same twice.

EASIEST: tell Claude which call it is and give a link or a file. It cuts the silence off both ends,
sets the loudness to match the other calls, saves it here under the right name and pushes it.

Or do it yourself with the tool (needs ffmpeg installed once):

    npm run umpire -- "strike two" ~/Downloads/strike-two.m4a --take c
    npm run umpire -- --list

.wav and .ogg work too. After adding or changing files, push to main so the site is rebuilt.
