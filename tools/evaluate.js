// evaluate.js
// ------------------------------------------------------------
// Measures how well the pitch detectors do on WAV files that have a truth CSV.
// Run with:  npm run evaluate
//      or:   node tools/evaluate.js test-audio/real   (another folder)
// Options:   --window=4096  --threshold=0.1  --gate=-50  --min=35  --max=1500
//
// It imitates the app: it takes 2048-sample windows about 60 times a second,
// skips windows that are too quiet (the volume gate), runs the detector, and
// optionally smooths the results like the display does.
//
// What is measured, per file:
//   Found     – of the windows where the truth HAS a pitch, how many got one
//   Median    – typical error in cents, over the windows that got a pitch
//   >50c      – windows more than 50 cents off (the wrong note name)
//   Octave    – windows off by about a whole number of octaves
//   False     – of the windows where the truth has NO pitch, how many showed one anyway
//
// Windows that straddle a start or stop of the sound are skipped, because
// there the "right answer" is unclear.
// ------------------------------------------------------------

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readWav } from './wav.js';
import { detectPitchYin } from '../js/yin.js';
import { detectPitchAutocorrelation } from '../js/autocorrelation.js';
import { PitchSmoother } from '../js/smoothing.js';
import { levelDb } from '../js/level.js';
import { centsBetween } from '../js/pitch-math.js';

// Command-line options look like --window=4096. Anything else is the folder.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};

const folder = args.find((a) => !a.startsWith('--')) || new URL('../test-audio/generated/', import.meta.url).pathname;
const WINDOW = option('window', 2048);
const READINGS_PER_SECOND = 60;            // like requestAnimationFrame in the browser
const GATE_DB = option('gate', -60);       // windows quieter than this count as "no pitch"
const RANGE = { minHz: option('min', 35), maxHz: option('max', 1500) };
const threshold = option('threshold', undefined); // YIN threshold; undefined = the default
if (threshold !== undefined) RANGE.threshold = threshold;

const CONFIGS = [
  { label: 'YIN (raw)', detect: detectPitchYin, smooth: false },
  { label: 'YIN (smoothed)', detect: detectPitchYin, smooth: true },
  { label: 'Autocorrelation (raw)', detect: detectPitchAutocorrelation, smooth: false },
];

// Read "time_s,f0_hz" rows into an array of f0 values, one per 10 ms.
function readTruth(csvPath) {
  return readFileSync(csvPath, 'utf8').trim().split('\n').slice(1).map((row) => Number(row.split(',')[1]));
}

const truthAt = (truth, seconds) => truth[Math.min(truth.length - 1, Math.max(0, Math.round(seconds / 0.01)))];

function evaluateFile(wavPath, truth, config) {
  const { sampleRate, samples } = readWav(wavPath);
  // The app's real window holds 2048 samples. At 44.1 kHz that is a bit longer in time.
  const hop = sampleRate / READINGS_PER_SECOND;
  const smoother = new PitchSmoother();
  const stats = { voiced: 0, found: 0, errors: [], gross: 0, octave: 0, unvoiced: 0, falseNotes: 0 };

  for (let start = 0; start + WINDOW <= samples.length; start += hop) {
    const from = Math.round(start);
    const window = samples.subarray(from, from + WINDOW);

    // Detector + volume gate, then optional smoothing (fed every window, like the app).
    let frequency = null;
    if (levelDb(window) >= GATE_DB) {
      frequency = config.detect(window, sampleRate, RANGE).frequency;
    }
    if (config.smooth) frequency = smoother.push(frequency);

    // The truth for this window: all voiced, all unvoiced, or mixed (skip).
    const t0 = from / sampleRate;
    const t1 = (from + WINDOW) / sampleRate;
    const values = [];
    for (let t = t0; t <= t1; t += 0.01) values.push(truthAt(truth, t));
    const allVoiced = values.every((v) => v > 0);
    const allUnvoiced = values.every((v) => v === 0);

    if (allVoiced) {
      stats.voiced++;
      if (frequency) {
        stats.found++;
        const error = centsBetween(truthAt(truth, (t0 + t1) / 2), frequency);
        stats.errors.push(Math.abs(error));
        if (Math.abs(error) > 50) stats.gross++;
        const octaves = Math.round(error / 1200);
        if (octaves !== 0 && Math.abs(error - octaves * 1200) < 100) stats.octave++;
      }
    } else if (allUnvoiced) {
      stats.unvoiced++;
      if (frequency) stats.falseNotes++;
    }
  }
  return stats;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');

function row(name, s) {
  const med = median(s.errors);
  return [
    name,
    pct(s.found, s.voiced),
    med === null ? '–' : med.toFixed(1),
    pct(s.gross, s.found),
    pct(s.octave, s.found),
    pct(s.falseNotes, s.unvoiced),
  ];
}

function printTable(title, rows) {
  const header = ['File', 'Found', 'Median (cents)', '>50c', 'Octave', 'False'];
  console.log(`\n### ${title}\n`);
  console.log(`| ${header.join(' | ')} |`);
  console.log(`|${header.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
}

// ---------- run ----------

const files = readdirSync(folder).filter((f) => f.endsWith('.wav') && existsSync(join(folder, f.replace(/\.wav$/, '.csv'))));
if (!files.length) {
  console.error(`No WAV + CSV pairs found in ${folder}`);
  process.exit(1);
}

const indexPath = join(folder, 'index.json');
const categories = existsSync(indexPath)
  ? Object.fromEntries(JSON.parse(readFileSync(indexPath, 'utf8')).signals.map((s) => [s.file, s.category]))
  : {};

console.log(`Folder: ${folder}`);
console.log(`Window ${WINDOW} samples, ${READINGS_PER_SECOND} readings/s, gate ${GATE_DB} dBFS, ` +
  `range ${RANGE.minHz}–${RANGE.maxHz} Hz, YIN threshold ${RANGE.threshold ?? 'default'}`);

for (const config of CONFIGS) {
  const rows = [];
  const byCategory = {};
  for (const file of files) {
    const truth = readTruth(join(folder, file.replace(/\.wav$/, '.csv')));
    const s = evaluateFile(join(folder, file), truth, config);
    rows.push(row(basename(file, '.wav'), s));

    // Add up per category for a summary.
    const cat = categories[file] || 'other';
    const c = (byCategory[cat] ||= { voiced: 0, found: 0, errors: [], gross: 0, octave: 0, unvoiced: 0, falseNotes: 0 });
    for (const key of ['voiced', 'found', 'gross', 'octave', 'unvoiced', 'falseNotes']) c[key] += s[key];
    c.errors.push(...s.errors);
  }
  printTable(`${config.label}: per file`, rows);
  printTable(`${config.label}: per category`, Object.entries(byCategory).map(([cat, s]) => row(cat, s)));
}
