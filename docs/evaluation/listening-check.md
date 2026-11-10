# Critical listening: what the exercises really play

Made by `node tools/listening-check.js`. Measured on the samples the app sends to the headphones (48 000 Hz), with the app's own FFT.

## Pink noise: level of each octave, relative to 1 kHz

| Octave | 63 Hz | 125 Hz | 250 Hz | 500 Hz | 1 kHz | 2 kHz | 4 kHz | 8 kHz | 16 kHz |
|---|---|---|---|---|---|---|---|---|---|
| dB | +0.20 | +0.09 | +0.02 | +0.05 | +0.00 | +0.10 | +0.11 | +0.07 | +0.11 |

(The 16 kHz octave reaches up to 22.6 kHz, so it is the least exact; 6 seconds of noise also varies by a few tenths of a dB.)

## EQ boost, level 2 (+12 dB bell, Q 1.41 · 9 bands, one octave apart), on pink noise

| Asked band | Measured change at that band | Change two octaves below | Loudest sample |
|---|---|---|---|
| 63 Hz | +11.91 dB | – | -9.2 dBFS |
| 125 Hz | +11.97 dB | – | -8.2 dBFS |
| 250 Hz | +11.96 dB | +0.54 dB | -8.4 dBFS |
| 500 Hz | +11.97 dB | +0.53 dB | -8.6 dBFS |
| 1 kHz | +11.96 dB | +0.54 dB | -9.2 dBFS |
| 2 kHz | +11.96 dB | +0.53 dB | -9.5 dBFS |
| 4 kHz | +11.96 dB | +0.51 dB | -9.9 dBFS |
| 8 kHz | +11.95 dB | +0.44 dB | -10.5 dBFS |
| 16 kHz | +11.79 dB | +0.20 dB | -10.6 dBFS |

## EQ boost, level 4 (+6 dB bell, Q 1.41 · 9 bands, one octave apart), on pink noise

| Asked band | Measured change at that band | Change two octaves below | Loudest sample |
|---|---|---|---|
| 63 Hz | +5.96 dB | – | -11.1 dBFS |
| 125 Hz | +5.99 dB | – | -10.7 dBFS |
| 250 Hz | +5.98 dB | +0.22 dB | -10.7 dBFS |
| 500 Hz | +5.99 dB | +0.22 dB | -11.0 dBFS |
| 1 kHz | +5.98 dB | +0.22 dB | -10.8 dBFS |
| 2 kHz | +5.98 dB | +0.22 dB | -11.0 dBFS |
| 4 kHz | +5.98 dB | +0.21 dB | -11.5 dBFS |
| 8 kHz | +5.98 dB | +0.18 dB | -11.8 dBFS |
| 16 kHz | +5.91 dB | +0.08 dB | -11.9 dBFS |

## EQ cut, level 2 (−12 dB bell, Q 1.41 · 9 bands, one octave apart), on pink noise

| Asked band | Measured change at that band | Change two octaves below | Loudest sample |
|---|---|---|---|
| 63 Hz | −11.90 dB | – | -12.5 dBFS |
| 125 Hz | −11.97 dB | – | -12.7 dBFS |
| 250 Hz | −11.96 dB | −0.54 dB | -12.8 dBFS |
| 500 Hz | −11.97 dB | −0.53 dB | -13.0 dBFS |
| 1 kHz | −11.96 dB | −0.54 dB | -13.2 dBFS |
| 2 kHz | −11.96 dB | −0.53 dB | -12.7 dBFS |
| 4 kHz | −11.96 dB | −0.51 dB | -12.5 dBFS |
| 8 kHz | −11.95 dB | −0.44 dB | -12.2 dBFS |
| 16 kHz | −11.78 dB | −0.20 dB | -12.3 dBFS |

## Reverb time: asked and measured

Measured from the reverb of a single click: the −5 to −35 dB part of the energy decay curve, extended to 60 dB.

| Asked RT60 | Measured, left | Measured, right |
|---|---|---|
| 0.2 s | 0.201 s | 0.199 s |
| 0.3 s | 0.301 s | 0.298 s |
| 0.6 s | 0.604 s | 0.601 s |
| 1 s | 1.004 s | 1.002 s |
| 1.2 s | 1.205 s | 1.203 s |
| 1.8 s | 1.803 s | 1.805 s |
| 2.4 s | 2.400 s | 2.403 s |
| 3 s | 3.000 s | 2.999 s |

## Loudness of the answers (dB relative to the Original)

Where loudness could give the answer away, every version should read 0.00. (Echo and reverb add sound, so all their answers are louder than the Original by the same amount.)

| Exercise | Level | Answers | Level of each answer vs the Original |
|---|---|---|---|
| Panning | 1 | Left 100%, Centre, Right 100% | −0.00, +0.00, −0.00 |
| Panning | 2 | Left 100%, Left 50%, Centre, Right 50%, Right 100% | −0.00, +0.00, +0.00, +0.00, −0.00 |
| Panning | 3 | Left 100%, Left 67%, Left 33%, Centre, Right 33%, Right 67%, Right 100% | −0.00, +0.00, +0.00, +0.00, +0.00, +0.00, −0.00 |
| Panning | 4 | Left 100%, Left 75%, Left 50%, Left 25%, Centre, Right 25%, Right 50%, Right 75%, Right 100% | −0.00, +0.00, +0.00, +0.00, +0.00, +0.00, +0.00, +0.00, −0.00 |
| Stereo width | 1 | Mono, 50%, 100% (unchanged) | −0.00, +0.00, +0.00 |
| Stereo width | 2 | Mono, 25%, 50%, 75%, 100% (unchanged) | −0.00, +0.00, +0.00, −0.00, +0.00 |
| Stereo width | 3 | Mono, 25%, 50%, 75%, 100% (unchanged), 125%, 150% | −0.00, +0.00, +0.00, −0.00, +0.00, +0.00, −0.00 |
| Compression | 1 | None, 10:1 | +0.00, +0.00 |
| Compression | 2 | None, 3:1, 10:1 | +0.00, +0.00, +0.00 |
| Compression | 3 | None, 2:1, 4:1, 10:1 | +0.00, +0.00, −0.00, +0.00 |
| Compression | 4 | Attack 0.5 ms, Attack 10 ms, Attack 60 ms | −0.00, −0.00, −0.00 |
| Compression | 5 | Release 40 ms, Release 200 ms, Release 1000 ms | +0.00, −0.00, −0.00 |
| Distortion | 1 | the processed one | +0.00 |
| Distortion | 2 | the processed one | −0.00 |
| Distortion | 3 | the processed one | −0.00 |
| Distortion | 4 | the processed one | −0.00 |
| Distortion | 5 | the processed one | −0.00 |
| Delay time | 1 | 50 ms, 150 ms, 400 ms | +0.97, +0.97, +0.97 |
| Delay time | 2 | 30 ms, 60 ms, 120 ms, 240 ms, 480 ms | +0.97, +0.97, +0.97, +0.97, +0.97 |
| Delay time | 3 | 20 ms, 40 ms, 80 ms, 120 ms, 160 ms, 240 ms, 320 ms, 480 ms | +0.97, +0.97, +0.97, +0.97, +0.97, +0.97, +0.97, +0.97 |
| Reverb time | 1 | 0.3 s, 1 s, 3 s | +0.64, +0.64, +0.64 |
| Reverb time | 2 | 0.3 s, 0.6 s, 1.2 s, 2.4 s | +0.64, +0.64, +0.64, +0.64 |
| Reverb time | 3 | 0.2 s, 0.4 s, 0.6 s, 0.9 s, 1.3 s, 1.8 s, 2.5 s | +0.64, +0.64, +0.64, +0.64, +0.64, +0.64, +0.64 |

## Compression on the drum loop: gap between loud and quiet moments

The level of every 10 ms slice; the gap between the loud ones (95th percentile) and the quiet ones (20th).

| Setting | Loud-to-quiet gap |
|---|---|
| Ratio None | 27.7 dB |
| Ratio 2:1 | 22.3 dB |
| Ratio 4:1 | 19.5 dB |
| Ratio 10:1 | 17.8 dB |
| 8:1, Attack 0.5 ms | 17.8 dB |
| 8:1, Attack 10 ms | 20.5 dB |
| 8:1, Attack 60 ms | 23.9 dB |
| 8:1, Release 40 ms | 15.3 dB |
| 8:1, Release 200 ms | 19.6 dB |
| 8:1, Release 1000 ms | 24.1 dB |

## Distortion levels

| Level | Drive | Distortion (THD) of a full-level sine |
|---|---|---|
| 1 | ×6 | 35.70% |
| 2 | ×3 | 25.07% |
| 3 | ×1.5 | 12.24% |
| 4 | ×0.75 | 4.12% |
| 5 | ×0.4 | 1.28% |

## Passing a level by luck

The chance that pure guessing reaches the pass mark in a round of 10.

| Exercise | Level | Answers | Pass mark | Chance by guessing |
|---|---|---|---|---|
| EQ boost | 1 | 4 | 8 of 10 | 0.042% |
| EQ boost | 2 | 9 | 8 of 10 | 0.000% |
| EQ boost | 3 | 9 | 8 of 10 | 0.000% |
| EQ boost | 4 | 9 | 8 of 10 | 0.000% |
| EQ boost | 5 | 25 (±1 counts) | 8 of 10 | 0.000% |
| EQ boost | 6 | 25 (±1 counts) | 8 of 10 | 0.000% |
| EQ cut | 1 | 4 | 8 of 10 | 0.042% |
| EQ cut | 2 | 9 | 8 of 10 | 0.000% |
| EQ cut | 3 | 9 | 8 of 10 | 0.000% |
| EQ cut | 4 | 9 | 8 of 10 | 0.000% |
| EQ cut | 5 | 25 (±1 counts) | 8 of 10 | 0.000% |
| Filters | 1 | 4 | 8 of 10 | 0.042% |
| Filters | 2 | 5 | 8 of 10 | 0.008% |
| Filters | 3 | 5 | 8 of 10 | 0.008% |
| Filters | 4 | 10 | 8 of 10 | 0.000% |
| Loudness | 1 | 4 | 8 of 10 | 0.042% |
| Loudness | 2 | 4 | 8 of 10 | 0.042% |
| Loudness | 3 | 6 | 8 of 10 | 0.002% |
| Loudness | 4 | 6 | 8 of 10 | 0.002% |
| Panning | 1 | 3 | 8 of 10 | 0.340% |
| Panning | 2 | 5 | 8 of 10 | 0.008% |
| Panning | 3 | 7 | 8 of 10 | 0.001% |
| Panning | 4 | 9 | 8 of 10 | 0.000% |
| Stereo width | 1 | 3 | 8 of 10 | 0.340% |
| Stereo width | 2 | 5 | 8 of 10 | 0.008% |
| Stereo width | 3 | 7 | 8 of 10 | 0.001% |
| Mix balance | 1 | 4 | 8 of 10 | 0.042% |
| Mix balance | 2 | 4 | 8 of 10 | 0.042% |
| Mix balance | 3 | 4 | 8 of 10 | 0.042% |
| Mix balance | 4 | 4 | 8 of 10 | 0.042% |
| Mix balance | 5 | 4 | 8 of 10 | 0.042% |
| Mix balance | 6 | 4 | 8 of 10 | 0.042% |
| Compression | 1 | 2 | 9 of 10 | 1.074% |
| Compression | 2 | 3 | 8 of 10 | 0.340% |
| Compression | 3 | 4 | 8 of 10 | 0.042% |
| Compression | 4 | 3 | 8 of 10 | 0.340% |
| Compression | 5 | 3 | 8 of 10 | 0.340% |
| Distortion | 1 | 2 | 9 of 10 | 1.074% |
| Distortion | 2 | 2 | 9 of 10 | 1.074% |
| Distortion | 3 | 2 | 9 of 10 | 1.074% |
| Distortion | 4 | 2 | 9 of 10 | 1.074% |
| Distortion | 5 | 2 | 9 of 10 | 1.074% |
| Delay time | 1 | 3 | 8 of 10 | 0.340% |
| Delay time | 2 | 5 | 8 of 10 | 0.008% |
| Delay time | 3 | 8 | 8 of 10 | 0.000% |
| Reverb time | 1 | 3 | 8 of 10 | 0.340% |
| Reverb time | 2 | 4 | 8 of 10 | 0.042% |
| Reverb time | 3 | 7 | 8 of 10 | 0.001% |
| Pitch difference | 1 | 2 | 9 of 10 | 1.074% |
| Pitch difference | 2 | 2 | 9 of 10 | 1.074% |
| Pitch difference | 3 | 2 | 9 of 10 | 1.074% |
| Pitch difference | 4 | 2 | 9 of 10 | 1.074% |
| Pitch difference | 5 | 2 | 9 of 10 | 1.074% |
