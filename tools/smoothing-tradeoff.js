// smoothing-tradeoff.js
// ------------------------------------------------------------
// Measures the trade-off between a STEADY display and a RESPONSIVE one,
// for each smoothing level. Run with:  npm run tradeoff
//
//   Response  – after a new note starts, how long until the display shows it (ms)
//   Release   – after a note stops, how long until the display clears (ms)
//   Gaps shown – of the short 0.1 s gaps between notes, how many the display
//               showed at all (steadier settings hold the note through them)
//   Wobble    – how much the cents reading moves on a held note
//               (standard deviation in cents; smaller = steadier needle)
//                 • vibrato file: the voice really wobbles ±30 cents
//                   (true wobble ≈ 21 cents), so very small = vibrato hidden
//                 • noisy file:   the true pitch is perfectly steady (0)
//
// Times are measured to the END of each 2048-sample window, because that
// is when the newest sound has arrived. That's closer to what you'd feel.
// ------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { readWav } from './wav.js';
import { runPipeline } from './run-pipeline.js';
import { SMOOTHING_LEVELS } from '../js/smoothing.js';
import { VOICE_PRESETS } from '../js/voice-ranges.js';
import { frequencyToNoteNumber } from '../js/pitch-math.js';

const DIR = new URL('../test-audio/generated/', import.meta.url).pathname;
const WINDOW = 2048;
const RANGE = VOICE_PRESETS.mid;

const load = (name) => ({
  ...readWav(`${DIR}${name}.wav`),
  truth: readFileSync(`${DIR}${name}.csv`, 'utf8').trim().split('\n').slice(1).map((r) => Number(r.split(',')[1])),
});

// Run the pipeline and collect { time (window end, s), smoothed } for each reading.
function readings(file, smoothingLevel) {
  const out = [];
  runPipeline(file.samples, file.sampleRate, { windowSize: WINDOW, minHz: RANGE.minHz, maxHz: RANGE.maxHz, smoothingLevel },
    ({ startSample, result }) => out.push({ time: (startSample + WINDOW) / file.sampleRate, smoothed: result.smoothed }));
  return out;
}

const average = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdDev = (xs) => { const m = average(xs); return Math.sqrt(average(xs.map((x) => (x - m) ** 2))); };
const centsOf = (hz) => 100 * (frequencyToNoteNumber(hz) - Math.round(frequencyToNoteNumber(hz)));

// Note starts and stops from the truth file (rows are 10 ms apart).
function events(truth) {
  const starts = [];
  const stops = [];
  for (let i = 1; i < truth.length; i++) {
    if (truth[i] > 0 && truth[i - 1] === 0) starts.push({ time: i * 0.01, note: Math.round(frequencyToNoteNumber(truth[i])) });
    if (truth[i] === 0 && truth[i - 1] > 0) stops.push({ time: i * 0.01 });
  }
  return { starts, stops };
}

const scale = load('voice-scale-C4-G4');
const vibrato = load('voice-mid-A3-vibrato');
const noisy = load('room-noise-A4-snr10');
const { starts, stops } = events(scale.truth);

console.log(`Smoothing trade-off (range ${RANGE.minHz}–${RANGE.maxHz} Hz, window ${WINDOW}, ~60 readings/s)\n`);
console.log('| Smoothing | Readings kept | Response (ms) | Release (ms) | Gaps shown | Wobble, vibrato (cents) | Wobble, noisy steady note (cents) |');
console.log('|---|---|---|---|---|---|---|');

for (const [index, level] of SMOOTHING_LEVELS.entries()) {
  // Response and release on the 5-note scale
  const r = readings(scale, index);
  const response = starts.map(({ time, note }) => {
    const hit = r.find((x) => x.time >= time && x.smoothed && Math.round(frequencyToNoteNumber(x.smoothed)) === note);
    return hit ? (hit.time - time) * 1000 : NaN;
  });
  // Release: did the display clear before the next note started? (gaps are 0.1 s)
  const release = [];
  for (const { time } of stops) {
    const nextStart = starts.find((s) => s.time > time)?.time ?? Infinity;
    const clear = r.find((x) => x.time >= time && x.time < nextStart && !x.smoothed);
    if (clear) release.push((clear.time - time) * 1000);
  }
  const releaseText = release.length ? `${average(release).toFixed(0)}` : '–';
  const gapsText = `${release.length} of ${stops.length}`;

  // Wobble on held notes (skip the first and last 0.3 s)
  const wobble = (file) => {
    const end = file.samples.length / file.sampleRate - 0.3;
    const cents = readings(file, index).filter((x) => x.smoothed && x.time > 0.3 && x.time < end).map((x) => centsOf(x.smoothed));
    return stdDev(cents);
  };

  console.log(`| ${level.label} | ${level.historySize} (~${Math.round((level.historySize * 1000) / 60)} ms) | ` +
    `${average(response).toFixed(0)} | ${releaseText} | ${gapsText} | ${wobble(vibrato).toFixed(1)} | ${wobble(noisy).toFixed(2)} |`);
}
