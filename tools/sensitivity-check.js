// sensitivity-check.js
// ------------------------------------------------------------
// How quiet can a voice be and still be detected, with a built-in-mic-like
// noise floor? Compares the old settings with the "sensitive" ones.
// Run with:  node tools/sensitivity-check.js
//
// Test sound (generated, so the true pitch is known):
//   a sung "ah" melody (A3 C4 E4 D4 B3 G3 A3 …, mid voice, ±30 cent vibrato),
//   0.6 s notes with 0.25 s breaths between them, 24 s long,
//   at voice levels from −30 to −75 dBFS (RMS while singing),
//   plus "built-in mic" noise: white hiss at −75 dBFS RMS and low room rumble at −68 dBFS RMS.
// Also noise-only recordings (no voice) to count FALSE readings:
//   quiet room (the noise above), a noisy room (+20 dB), and mains hum
//   (50 Hz + harmonics, −62 dBFS) on top of the quiet room.
//
// The noise levels are typical-looking guesses, NOT measured from a real
// laptop or phone; read the results as "relative to the mic's noise".
//
// Measured per setting:
//   found  – of the singing moments (away from note starts/ends), % with a pitch shown
//   wrong  – % of singing moments showing a note more than 50 cents off
//   false  – % of breath / noise-only moments that showed a pitch anyway
// ------------------------------------------------------------

import { detectPitchYin } from '../js/yin.js';
import { DEFAULT_SMOOTHING_LEVEL } from '../js/smoothing.js';
import { centsBetween } from '../js/pitch-math.js';
import { runPipeline } from './run-pipeline.js';
import { SENSITIVITY } from '../js/pitch-tracker.js';
import { VOICE_PRESETS } from '../js/voice-ranges.js';

const SR = 48000;
const WINDOW = 2048;
const RANGE = VOICE_PRESETS.mid; // 100–800 Hz

let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const dbToGain = (db) => 10 ** (db / 20);
const rmsOf = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

// ---------- the test sounds ----------

const MELODY = [57, 60, 64, 62, 59, 55, 57, 60, 65, 64, 62, 60, 59, 57, 52, 55];
const NOTE_S = 0.6;
const BREATH_S = 0.25;

function singing(seconds) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const truth = new Float32Array(n); // Hz, 0 = not singing
  const phases = new Float64Array(30);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = Math.floor(t / (NOTE_S + BREATH_S));
    const inNote = t - k * (NOTE_S + BREATH_S);
    if (inNote >= NOTE_S) continue;
    const f0 = 440 * 2 ** ((MELODY[k % MELODY.length] - 69) / 12) * 2 ** ((30 / 1200) * Math.sin(2 * Math.PI * 5.5 * t));
    const env = Math.min(1, inNote / 0.04, (NOTE_S - inNote) / 0.04);
    let s = 0;
    for (let h = 1; h < 30 && h * f0 < 8000; h++) {
      phases[h] += (2 * Math.PI * h * f0) / SR;
      const hz = h * f0;
      const formant = 0.08 + Math.exp(-(((hz - 700) / 150) ** 2)) + 0.6 * Math.exp(-(((hz - 1200) / 180) ** 2)) + 0.25 * Math.exp(-(((hz - 2600) / 250) ** 2));
      s += (formant / h) * Math.sin(phases[h]);
    }
    out[i] = env * s;
    truth[i] = env >= 1 ? f0 : 0;
  }
  return { out, truth };
}

function noise(seconds, { hissDb = -75, rumbleDb = -68, humDb = null } = {}) {
  const n = Math.round(seconds * SR);
  const hiss = new Float32Array(n);
  const rumble = new Float32Array(n);
  let low = 0;
  for (let i = 0; i < n; i++) {
    const w = random() * 2 - 1;
    hiss[i] = w;
    low = 0.995 * low + 0.005 * (random() * 2 - 1);
    rumble[i] = low;
  }
  const gh = dbToGain(hissDb) / rmsOf(hiss);
  const gr = dbToGain(rumbleDb) / rmsOf(rumble);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = gh * hiss[i] + gr * rumble[i];
  if (humDb !== null) {
    // Mains hum: 50 Hz with harmonics 1/k (a buzz), RMS humDb.
    const hum = new Float32Array(n);
    for (let i = 0; i < n; i++) for (let k = 1; k <= 8; k++) hum[i] += Math.sin((2 * Math.PI * 50 * k * i) / SR) / k;
    const g = dbToGain(humDb) / rmsOf(hum);
    for (let i = 0; i < n; i++) out[i] += g * hum[i];
  }
  return out;
}

// ---------- the settings compared ----------

const SETTINGS = [
  { label: 'Before: fixed −55 dBFS, no filter (old default)', gateDb: -55 },
  { label: 'Fixed −70 dBFS, no filter', gateDb: -70 },
  { label: 'Automatic threshold, no filter', autoGate: true },
  { label: '… + looser clarity (threshold 0.15) — rejected', autoGate: true, filter: true, detect: (s, sr, o) => detectPitchYin(s, sr, { ...o, threshold: 0.15 }) },
  { label: '= **High** (new default): automatic threshold + band filter', filter: true, ...SENSITIVITY.high },
  { label: '= **Maximum**: … + YIN fallback 0.20', filter: true, ...SENSITIVITY.maximum },
  { label: '(… + YIN fallback 0.35, not used)', filter: true, ...SENSITIVITY.maximum, fallbackThreshold: 0.35 },
];

// Run the app's pipeline (the same PitchTracker and band filter as the app) on `samples`.
function run(samples, setting) {
  const { label, ...options } = setting;
  const readings = [];
  runPipeline(samples, SR, { minHz: RANGE.minHz, maxHz: RANGE.maxHz, windowSize: WINDOW, smoothingLevel: DEFAULT_SMOOTHING_LEVEL, ...options },
    ({ startSample, result }) => readings.push({ from: startSample, hz: result.smoothed }));
  return readings;
}

// Score a run against the truth (truth: Float32Array of Hz per sample, or null = no voice at all).
function score(readings, truth) {
  let voiced = 0, found = 0, wrong = 0, unvoiced = 0, falses = 0;
  for (const { from, hz } of readings) {
    if (from < SR * 2) continue; // skip the first 2 s (the auto threshold is still learning)
    if (!truth) { unvoiced++; if (hz) falses++; continue; }
    const a = truth[from];
    const b = truth[from + WINDOW - 1];
    const mid = truth[from + WINDOW / 2];
    if (a > 0 && b > 0) {
      voiced++;
      if (hz) { found++; if (Math.abs(centsBetween(hz, mid)) > 50) wrong++; }
    } else if (a === 0 && b === 0 && mid === 0) {
      unvoiced++;
      if (hz) falses++;
    }
  }
  return { found: voiced ? found / voiced : null, wrong: voiced ? wrong / voiced : null, false: unvoiced ? falses / unvoiced : null };
}

const pct = (x) => (x === null ? '–' : `${Math.round(100 * x)}%`);
const SECONDS = 24;
const { out: voice, truth } = singing(SECONDS);
const voiceRms = Math.sqrt(voice.reduce((s, v, i) => s + (truth[i] > 0 ? v * v : 0), 0) / truth.filter((x) => x > 0).length);
const quiet = noise(SECONDS);

// --wav: write a quiet test recording for the browser test, then stop:
//   test-audio/sensitivity/quiet-voice-A3.wav – 2 s of mic noise, then a sung A3 "ah"
//   at −60 dBFS (RMS) over the same noise (hiss −75, rumble −68 dBFS), 8 s in all.
if (process.argv.includes('--wav')) {
  const { writeWav } = await import('./wav.js');
  const { mkdirSync } = await import('node:fs');
  const dir = new URL('../test-audio/sensitivity/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const n = 8 * SR;
  const room = noise(8);
  const out = new Float32Array(n);
  const phases = new Float64Array(30);
  const tone = new Float32Array(n);
  for (let i = 2 * SR; i < n; i++) {
    const t = i / SR;
    const f0 = 220 * 2 ** ((30 / 1200) * Math.sin(2 * Math.PI * 5.5 * t));
    let s = 0;
    for (let h = 1; h < 30 && h * f0 < 8000; h++) {
      phases[h] += (2 * Math.PI * h * f0) / SR;
      const hz = h * f0;
      s += ((0.08 + Math.exp(-(((hz - 700) / 150) ** 2)) + 0.6 * Math.exp(-(((hz - 1200) / 180) ** 2))) / h) * Math.sin(phases[h]);
    }
    tone[i] = s * Math.min(1, (t - 2) / 0.05);
  }
  const g = dbToGain(-60) / rmsOf(tone.subarray(3 * SR));
  for (let i = 0; i < n; i++) out[i] = g * tone[i] + room[i];
  writeWav(`${dir}quiet-voice-A3.wav`, out, SR);
  console.log('Wrote test-audio/sensitivity/quiet-voice-A3.wav');
  process.exit(0);
}

const LEVELS = [-30, -40, -50, -55, -60, -65, -70, -75];
for (const [name, mic] of [['hiss −75, rumble −68 dBFS', quiet], ['a quieter mic: hiss −85, rumble −78 dBFS', noise(SECONDS, { hissDb: -85, rumbleDb: -78 })]]) {
  console.log(`\nVoice detected (found / wrong note), by voice level while singing, with built-in-mic-like noise (${name}):\n`);
  console.log(`| Setting | ${LEVELS.map((l) => `${l} dBFS`).join(' | ')} | shown in breaths* |`);
  console.log(`|---|${LEVELS.map(() => '---').join('|')}|---|`);
  for (const setting of SETTINGS) {
    const cells = [];
    let breathFalse = 0;
    for (const level of LEVELS) {
      const g = dbToGain(level) / voiceRms;
      const mix = voice.map((v, i) => g * v + mic[i]);
      const s = score(run(mix, setting), truth);
      cells.push(`${pct(s.found)} / ${pct(s.wrong)}`);
      breathFalse = Math.max(breathFalse, s.false);
    }
    console.log(`| ${setting.label} | ${cells.join(' | ')} | ${pct(breathFalse)} |`);
  }
}
console.log('\n* Worst case over the levels: % of the 0.25 s breaths where a note was still shown. This is mostly the');
console.log('  smoothing holding the last note for a moment (it is about the same for every setting), not noise read as a note.');

console.log('\nFalse readings with NO voice (noise only, 24 s):\n');
const NOISES = [
  ['Quiet room (built-in mic hiss)', quiet],
  ['Noisy room (+20 dB)', noise(SECONDS, { hissDb: -55, rumbleDb: -48 })],
  ['Quiet room + mains hum (−62 dBFS)', noise(SECONDS, { humDb: -62 })],
  ['Quiet room + loud mains hum (−50 dBFS)', noise(SECONDS, { humDb: -50 })],
];
console.log(`| Setting | ${NOISES.map(([n]) => n).join(' | ')} |`);
console.log(`|---|${NOISES.map(() => '---').join('|')}|`);
for (const setting of SETTINGS) {
  console.log(`| ${setting.label} | ${NOISES.map(([, x]) => pct(score(run(x, setting), null).false)).join(' | ')} |`);
}
