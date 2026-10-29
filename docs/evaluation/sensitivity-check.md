# Sensitivity check (generated signals)

Output of `node tools/sensitivity-check.js`. Generated singing and noise, not real microphones. The noise levels are guesses meant to look like built-in mics; read the results relative to them.


Voice detected (found / wrong note), by voice level while singing, with built-in-mic-like noise (hiss −75, rumble −68 dBFS):

| Setting | -30 dBFS | -40 dBFS | -50 dBFS | -55 dBFS | -60 dBFS | -65 dBFS | -70 dBFS | -75 dBFS | shown in breaths* |
|---|---|---|---|---|---|---|---|---|---|
| Before: fixed −55 dBFS, no filter (old default) | 100% / 0% | 100% / 0% | 98% / 0% | 27% / 1% | 0% / 0% | 0% / 0% | 0% / 0% | 0% / 0% | 28% |
| Fixed −70 dBFS, no filter | 100% / 0% | 100% / 0% | 99% / 0% | 95% / 1% | 23% / 1% | 0% / 0% | 0% / 0% | 0% / 0% | 28% |
| Automatic threshold, no filter | 100% / 0% | 100% / 0% | 99% / 0% | 95% / 1% | 23% / 1% | 0% / 0% | 0% / 0% | 0% / 0% | 28% |
| … + looser clarity (threshold 0.15) — rejected | 100% / 19% | 100% / 19% | 100% / 19% | 99% / 14% | 94% / 15% | 19% / 1% | 0% / 0% | 0% / 0% | 29% |
| = **High** (new default): automatic threshold + band filter | 100% / 0% | 100% / 0% | 99% / 1% | 98% / 0% | 79% / 3% | 1% / 1% | 0% / 0% | 0% / 0% | 28% |
| = **Maximum**: … + YIN fallback 0.20 | 100% / 0% | 100% / 0% | 100% / 1% | 99% / 0% | 96% / 1% | 30% / 3% | 0% / 0% | 0% / 0% | 29% |
| (… + YIN fallback 0.35, not used) | 100% / 0% | 100% / 0% | 100% / 1% | 100% / 0% | 99% / 0% | 58% / 5% | 0% / 0% | 0% / 0% | 29% |

Voice detected (found / wrong note), by voice level while singing, with built-in-mic-like noise (a quieter mic: hiss −85, rumble −78 dBFS):

| Setting | -30 dBFS | -40 dBFS | -50 dBFS | -55 dBFS | -60 dBFS | -65 dBFS | -70 dBFS | -75 dBFS | shown in breaths* |
|---|---|---|---|---|---|---|---|---|---|
| Before: fixed −55 dBFS, no filter (old default) | 100% / 0% | 100% / 0% | 99% / 0% | 21% / 0% | 0% / 0% | 0% / 0% | 0% / 0% | 0% / 0% | 28% |
| Fixed −70 dBFS, no filter | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 99% / 0% | 96% / 1% | 20% / 0% | 0% / 0% | 28% |
| Automatic threshold, no filter | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 99% / 0% | 96% / 1% | 21% / 1% | 0% / 0% | 28% |
| … + looser clarity (threshold 0.15) — rejected | 100% / 19% | 100% / 19% | 100% / 19% | 100% / 19% | 100% / 19% | 99% / 18% | 94% / 15% | 18% / 1% | 29% |
| = **High** (new default): automatic threshold + band filter | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 97% / 0% | 73% / 3% | 0% / 0% | 28% |
| = **Maximum**: … + YIN fallback 0.20 | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 99% / 0% | 96% / 0% | 25% / 2% | 29% |
| (… + YIN fallback 0.35, not used) | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 100% / 0% | 98% / 0% | 45% / 4% | 29% |

* Worst case over the levels: % of the 0.25 s breaths where a note was still shown. This is mostly the
  smoothing holding the last note for a moment (it is about the same for every setting), not noise read as a note.

False readings with NO voice (noise only, 24 s):

| Setting | Quiet room (built-in mic hiss) | Noisy room (+20 dB) | Quiet room + mains hum (−62 dBFS) | Quiet room + loud mains hum (−50 dBFS) |
|---|---|---|---|---|
| Before: fixed −55 dBFS, no filter (old default) | 0% | 0% | 0% | 0% |
| Fixed −70 dBFS, no filter | 0% | 0% | 0% | 0% |
| Automatic threshold, no filter | 0% | 0% | 0% | 0% |
| … + looser clarity (threshold 0.15) — rejected | 0% | 0% | 0% | 0% |
| = **High** (new default): automatic threshold + band filter | 0% | 0% | 0% | 0% |
| = **Maximum**: … + YIN fallback 0.20 | 0% | 0% | 0% | 0% |
| (… + YIN fallback 0.35, not used) | 0% | 0% | 0% | 0% |
