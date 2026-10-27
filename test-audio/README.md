# Test audio

These files are only for **testing and measuring** the pitch detector. The app
itself always listens live to your microphone. It never uses these files and
never records you.

## `generated/`: computer-made signals with a known pitch

Made by `npm run make-signals` (`tools/make-test-signals.js`). Running it again
recreates exactly the same files.

Each sound has two files:

- `name.wav`: 48 kHz, 16-bit, mono audio.
- `name.csv`: the truth, one row every 10 ms: `time_s,f0_hz`. `f0_hz = 0`
  means "there is no pitch here", so the app should show *no clear pitch*.

`index.json` lists every file with its category and description.

| Category | Files | What it tests |
|---|---|---|
| clean | `sine-A4`, `sine-C4`, `sine-E4-330Hz`, `bright-A3` | Basic accuracy on easy sounds |
| octave-trap | `weak-fundamental-A2` | The fundamental is 20 dB quieter than the 2nd harmonic, a common cause of octave errors |
| low | `plucked-E2`, `bass-E1` | Low notes (82 Hz and 41 Hz) and a fading pluck |
| voice | `voice-low-G2-vibrato`, `voice-mid-A3-vibrato`, `voice-high-A4-vibrato`, `voice-glide-C3-C4`, `voice-scale-C4-G4`, `speech-like` | Vowel-like tone colour, vibrato, slides, separate notes, speech with consonant hiss and pauses |
| noisy | `breathy-A3`, `room-noise-A4-snr20/10/0` | Breath and room noise at different levels |
| quiet | `quiet-A4` | A real tone that is very quiet (peak −50 dBFS), for testing the volume threshold |
| no-pitch | `whisper-noise`, `room-noise`, `near-silence` | The app should *not* show a note here |

**Be careful with results from these files.** They are much cleaner and more
regular than a real voice or instrument. Good results here do not prove good
results in real life.

## `real/`: real recordings (to be added)

Add your own recordings here (WAV), with a CSV in the same format if you know
the true notes, for example from a separate tuner or a tuned piano.
