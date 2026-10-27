# Note Lab

A personal, non-commercial web app that listens **live** to your microphone and
shows which musical note is playing, its frequency and how many cents sharp or
flat it is, for example `A3 · 220.0 Hz · 0 cents`. It is meant for single notes
from instruments and the human voice. Ear training is coming in a later phase.

**Privacy:** all audio processing happens on your device, in the browser.
Microphone audio is never recorded, stored, uploaded or sent anywhere. There is
no server, no account and no tracking.

> **Status:** Phase 2 of 6 (tuner) is done. Voice mode, the spectrum view, ear
> training and offline/iPhone install are still to come.

![Tuner screenshot](docs/screenshots/tuner.png)

*Screenshot from the automated Chromium test, with a generated vibrato voice as the "microphone".*

## How to use

1. Run it locally: `npm start`, then open <http://localhost:8000>. (Or use the
   GitHub Pages address once it's enabled.)
2. Tap **Start listening**. Your browser asks for microphone permission.
3. Play or sing **one steady note**. You'll see:
   - the note name and octave (big),
   - `note · frequency · cents` (one decimal place for Hz),
   - a needle: left is flat (too low), middle is in tune, right is sharp (too high).
     It turns green within ±5 cents. That band is a beginner-friendly display
     choice, not a measured accuracy.
   - the **input level in dBFS**. 0 dBFS is the loudest sound the input can
     take, so normal sounds read below 0, e.g. −30 dBFS. This is **not** a
     calibrated sound level meter (dB SPL).
4. If the sound is too quiet or isn't clearly pitched, the app shows
   **No clear note** instead of guessing.

## How the detection works

### From frequency to note (`js/pitch-math.js`)

Standard equal-temperament formulas, with A4 = 440 Hz by default:

```
note number  n = 69 + 12 × log2(f / 440)      (A4 = 69, middle C = C4 = 60)
nearest note m = round(n)
cents          = 100 × (n − m)                 (−50 … +50)
name           = C C# D D# E F F# G G# A A# B  [m mod 12]
octave         = floor(m / 12) − 1
back again:  f = 440 × 2^((m − 69) / 12)
```

**Worked example, 330 Hz:** 330/440 = 0.75 → log2(0.75) = −0.41504 → × 12 =
−4.98045 → n = 64.01955 → m = 64 → cents = +1.96 → 64 mod 12 = 4 = **E**,
octave = floor(64/12) − 1 = **4** → `E4 · 330.0 Hz · +2 cents`.
(Perfect E4 = 440 × 2^(−5/12) = 329.628 Hz.)

Run `npm run table` to print every note's frequency and check it with a calculator.

### Finding the frequency: YIN (`js/yin.js`)

A pitched sound repeats itself. YIN shifts the sound against a copy of itself
and measures how *different* the two are at each shift. The **first** shift
where they're almost identical is one period, and frequency = sample rate ÷
period. Normalising the score and taking the first good dip, rather than the
deepest, avoids most octave mistakes. A small curve fit between samples gives
sub-cent precision on clean tones. The depth of the dip is a confidence score.
If no dip is deep enough, the answer is "no clear pitch".

Each reading uses the latest **2048 samples** (about 43–46 ms), about 60 times
a second.

### Volume gate and smoothing

- **Volume gate:** readings quieter than **−60 dBFS** aren't analysed at all,
  so background hiss doesn't produce random notes. The gate is the thin line
  on the level meter.
- **Smoothing (`js/smoothing.js`):** the display shows the **median** of the
  last 7 readings (about 0.12 s), and only when at least 4 of them found a
  pitch. A median ignores a few odd readings, such as a one-off octave jump.
  The cost is a short delay when you change note.

### Why YIN and not autocorrelation? (measured)

Both were run on the same test files (`npm run evaluate`). Columns: **Found** =
share of pitched moments where a pitch was reported. **Median** = typical error
in cents. **>50c** = share of reported pitches that were the wrong note.

| Test group | YIN: Found | YIN: Median | YIN: >50c | Autocorrelation: >50c |
|---|---|---|---|---|
| Clean tones | 100% | 0.1 | 0% | 50%: C4 and E4 sine waves read an octave low |
| Weak fundamental (A2) | 100% | 0.0 | 0% | 99%: read as A3 |
| Voice-like (vibrato, glide, scale, speech) | 100% | 2.5 | 0% | 24% |

The simple autocorrelation (`js/autocorrelation.js`, kept only for this
comparison) often locks onto 2 periods instead of 1. Better autocorrelation
variants exist (e.g. McLeod's MPM). YIN does well here and is well documented,
so the app uses YIN.

## Measured accuracy

> ⚠️ **These numbers come from computer-generated test signals**
> (`test-audio/generated/`, made by `npm run make-signals`). They are cleaner
> than real voices and instruments, so **real-world accuracy will be lower**.
> Measurements on real recordings will be added separately.

YIN as used by the app (2048-sample window, −60 dBFS gate), before smoothing.
Full tables: [`docs/evaluation/`](docs/evaluation/).

| Test group | Found | Median error | Wrong note (>50c) | Octave errors | False notes in no-pitch sounds |
|---|---|---|---|---|---|
| Clean tones (sine, bright) | 100% | 0.1 cents | 0% | 0% | – |
| Weak fundamental | 100% | 0.0 cents | 0% | 0% | – |
| Voice-like | 100% | 2.5 cents | 0% | 0% | 0% |
| Room noise, SNR 20 dB / 10 dB | 100% / 98% | 0.2 / 0.5 cents | 0% | 0% | – |
| Room noise, SNR 0 dB | 0%: "no clear note" | – | – | – | – |
| Breathy voice (breath as loud as voice) | 0%: "no clear note" | – | – | – | – |
| Quiet tone (−50 dBFS peak) | 100% | 0.1 cents | 0% | 0% | – |
| Guitar low E2 (82 Hz) | 100% | 0.0 cents | 0% | 0% | – |
| Bass low E1 (41 Hz) | 2% (out of range) | – | – | – | – |
| Whisper, room noise, near-silence | – | – | – | – | **0%** |

**What the smoothing does to these numbers:** the smoothed display holds each
note a little longer (about 0.1 s) and evens out vibrato. Measured against the
moment-by-moment true pitch, smoothed voice readings are off by a median of
**23 cents**, versus 2.5 raw. That's mostly the display trailing behind vibrato
and slides, not wrong notes: the wrong-note rate stays at 1%. Voice mode
(Phase 3) will let you choose between steadier and faster.

**A tuning decision made from these tests:** YIN's threshold started at 0.15.
That read a vowel-like E4, whose 2nd harmonic was ~6× louder than its
fundamental, as **E5**. Lowering it to 0.10 (the value in the YIN paper) fixed
that and changed nothing else on these files. Because the choice was made on
generated signals, it still needs checking on real recordings.

## Limitations

- **One note at a time.** Chords and several notes at once are not supported.
  The app will show one of the notes, or "no clear note", and shouldn't be trusted.
- **Octave errors** are reduced, not eliminated. A sound whose 2nd harmonic is
  much louder than the fundamental can still be read an octave high.
- **Breathy or whispered sound** has little or no pitch. At equal breath and
  voice level the app says "no clear note". That's intended, but it means very
  breathy singing may not register.
- **Very low notes:** with the 2048-sample window the lowest detectable pitch
  is about 47 Hz at 48 kHz (50 Hz is the set minimum). A bass guitar's low E
  (41 Hz) isn't detected. A 4096-sample window detects it (100% on the test
  file), but it's slower and handled vibrato worse (90% found), so it will be
  a low-range option in Phase 3.
- **Noisy rooms:** fine at 10–20 dB SNR on the test files, nothing at 0 dB.
- **The dB meter** is relative to this microphone (dBFS), not a calibrated
  sound level. iPhones may also adjust the mic level automatically.
- **Accuracy numbers** are from generated signals only, so far.

## Desktop vs iPhone

| | Desktop Chromium | iPhone Safari |
|---|---|---|
| Tested by | Automated test (`tools/browser-test.js`) with test WAVs as a fake microphone | **Not tested yet.** Needs a real iPhone |
| Sample rate seen | 44 100 Hz (fake mic) | Usually 48 000 Hz (to be confirmed) |

Things to check on iPhone (please report back):

1. Open the page over **https** (GitHub Pages). The mic won't work on plain http.
2. Tap Start: you should see the permission prompt, then the tuner.
3. Tap "Don't Allow" once: you should get the "blocked" message with steps to fix it.
4. Hum a steady note: the note should be steady, and the level should move with your voice.
5. Switch to another app and back: the tuner should continue, or tell you to tap Start.
6. Whether iOS respects "no echo cancellation / noise suppression / auto gain".
   If quiet sounds get louder by themselves, it doesn't.

## Running the tests

Needs [Node.js](https://nodejs.org) 18 or newer. There are no packages to install.

```sh
npm test               # unit tests: pitch maths, YIN, smoothing, dB level, WAV files
npm run table          # note/frequency table for checking by hand
npm run make-signals   # regenerate the test WAV files (identical every time)
npm run evaluate       # score the detectors on test-audio/generated
npm run evaluate -- --window=4096   # try other settings (also --threshold, --gate, --min, --max)
node tools/browser-test.js          # optional; needs Playwright + Chromium installed
```

## Dependencies

None for the app. It uses only the browser's built-in Web Audio API. Tests use
Node's built-in test runner. The optional browser check uses Playwright, which
isn't part of the app and isn't installed by this project.

## How AI help was used

This project is being built with Claude Code (an AI coding assistant), working
phase by phase at the owner's direction:

- The AI wrote the code, tests, test-signal generator and this README, and
  explained each step. The owner approves each phase before the next.
- The formulas are the standard equal-temperament relationships. YIN follows
  de Cheveigné & Kawahara (2002). Nothing was invented.
- The accuracy numbers come from running the code (`npm run evaluate`) and
  weren't estimated. The AI also caught and fixed its own mistakes this way:
  a wrong truth label for the plucked note, a threshold that caused an octave
  error, and a needle animation that pointed the wrong way during vibrato.
- The AI can't hear and has no iPhone, so iPhone behaviour and real-world
  accuracy have to be checked by a person.
