// key-check.js
// ------------------------------------------------------------
// Measures the Key finder on generated music whose key is known.
// Run with:  node tools/key-check.js
//
// For each of the 12 major and 12 minor keys it makes:
//   singer       – a melody alone, sung-like (harmonics + vibrato)
//   singer-flat  – the same, 35 cents flat as a whole (an out-of-tune singer)
//   song         – the melody over chords and a bass line, analysed in song mode
// and runs the same KeyListener the app uses, ~60 readings per second.
// Counted: right key, the RELATIVE key (same notes, e.g. C major vs A minor),
// the dominant/subdominant (keys a fifth away), or another wrong answer.
//
// These are COMPUTER-MADE tunes (two short melodies of my own, plus the
// public-domain "Twinkle Twinkle"), not real singers or recordings. Real
// accuracy will be lower.
// ------------------------------------------------------------

import { KeyListener, SONG_WINDOW } from '../js/key-listener.js';
import { relativeKey } from '../js/key-finder.js';
import { writeWav } from './wav.js';
import { mkdirSync } from 'node:fs';

const SR = 48000;
const HOP = SR / 60;
const hz = (n, cents = 0) => 440 * 2 ** ((n - 69 + cents / 100) / 12);

// Melodies as [scale degree in semitones from the tonic, beats]. Tonic = 0.
const MAJOR_TUNES = [
  // "Twinkle Twinkle Little Star" (public domain)
  [[0, 1], [0, 1], [7, 1], [7, 1], [9, 1], [9, 1], [7, 2], [5, 1], [5, 1], [4, 1], [4, 1], [2, 1], [2, 1], [0, 2],
    [7, 1], [7, 1], [5, 1], [5, 1], [4, 1], [4, 1], [2, 2], [7, 1], [7, 1], [5, 1], [5, 1], [4, 1], [4, 1], [2, 2]],
  // a simple major tune written for this test
  [[0, 1], [2, 1], [4, 1], [5, 1], [7, 2], [4, 1], [0, 1], [9, 1], [7, 1], [5, 1], [4, 1], [2, 2], [7, 1], [11, 1], [12, 2], [7, 1], [4, 1], [2, 1], [0, 3]],
];
const MINOR_TUNES = [
  // natural-minor tunes written for this test
  [[0, 1], [3, 1], [7, 1], [5, 1], [3, 1], [2, 1], [0, 2], [7, 1], [8, 1], [7, 1], [5, 1], [3, 1], [2, 1], [3, 1], [0, 2], [10, 1], [0, 3]],
  [[7, 1], [3, 1], [5, 1], [3, 1], [2, 1], [0, 2], [3, 1], [7, 1], [12, 2], [10, 1], [8, 1], [7, 2], [5, 1], [3, 1], [2, 1], [0, 3]],
];
// Accompaniment: one chord per 4 beats (I IV V I, or i iv v i), notes in semitones from the tonic.
const CHORDS = { major: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], minor: [[0, 3, 7], [5, 8, 12], [7, 10, 14], [0, 3, 7]] };

// A sung-like tone: harmonics at 1/k with ±25 cent vibrato at 5.5 Hz.
// Options: centsOff (whole singer sharp/flat), drift (cents added by the end, gradually),
// accompany (chords + bass), drums (a noise hit every beat), repeats (times through the tune).
function render(tonicMidi, mode, tune, { centsOff = 0, drift = 0, accompany = false, drums = false, repeats = 2, beat = 0.45 } = {}) {
  const totalBeats = tune.reduce((s, [, b]) => s + b, 0) * repeats;
  let seed = 11; const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const len = Math.round(totalBeats * beat * SR) + SONG_WINDOW;
  const out = new Float32Array(len);
  const notes = [];
  let t0 = 0;
  for (let rep = 0; rep < repeats; rep++) for (const [deg, beats] of tune) { notes.push({ deg, t0, t1: t0 + beats * beat }); t0 += beats * beat; }
  const phase = new Float64Array(9);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const note = notes.find((n) => t >= n.t0 && t < n.t1);
    let s = 0;
    if (note) {
      const f = hz(tonicMidi + note.deg, centsOff + (drift * t) / (len / SR) + 25 * Math.sin(2 * Math.PI * 5.5 * t));
      const env = Math.min(1, (t - note.t0) / 0.03, (note.t1 - t) / 0.03);
      for (let k = 1; k <= 8; k++) { phase[k] += (2 * Math.PI * f * k) / SR; s += (env * Math.sin(phase[k])) / k; }
      s *= 0.3;
    }
    if (accompany) {
      const chord = CHORDS[mode][Math.floor(t / (4 * beat)) % 4];
      for (const d of chord) for (let k = 1; k <= 4; k++) s += (0.06 / k) * Math.sin(2 * Math.PI * hz(tonicMidi - 12 + d) * k * t);
      for (let k = 1; k <= 4; k++) s += (0.1 / k) * Math.sin(2 * Math.PI * hz(tonicMidi - 24 + chord[0]) * k * t); // bass
    }
    if (drums && (t / beat) % 1 < 0.08) s += 0.5 * noise() * (1 - ((t / beat) % 1) / 0.08);
    out[i] = s;
  }
  return out;
}

function analyse(samples, mode) {
  const listener = new KeyListener({ mode });
  for (let start = 0; start + SONG_WINDOW <= samples.length; start += HOP) {
    listener.push(samples.subarray(Math.round(start), Math.round(start) + SONG_WINDOW), SR, 1 / 60);
  }
  return listener.result();
}

function classify(best, tonic, mode) {
  if (best.tonic === tonic && best.mode === mode) return 'right';
  const rel = relativeKey({ tonic, mode });
  if (best.tonic === rel.tonic && best.mode === rel.mode) return 'relative';
  if (best.mode === mode && [5, 7].includes((best.tonic - tonic + 12) % 12)) return 'fifth';
  return 'other';
}

// --wav: just write two example recordings for the browser test, then stop.
//   test-audio/key/singer-G-major.wav  – "Twinkle Twinkle" sung alone in G major
//   test-audio/key/song-D-minor.wav    – a D-minor tune with chords, bass and drums
if (process.argv.includes('--wav')) {
  const dir = new URL('../test-audio/key/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const normalise = (x) => { const p = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0); return x.map((v) => (0.5 * v) / p); };
  writeWav(`${dir}singer-G-major.wav`, normalise(render(55, 'major', MAJOR_TUNES[0])), SR);
  writeWav(`${dir}song-D-minor.wav`, normalise(render(62, 'minor', MINOR_TUNES[1], { accompany: true, drums: true, repeats: 3 })), SR);
  console.log('Wrote test-audio/key/singer-G-major.wav and song-D-minor.wav');
  process.exit(0);
}

const results = {};
const examples = [];
for (const mode of ['major', 'minor']) {
  const tunes = mode === 'major' ? MAJOR_TUNES : MINOR_TUNES;
  for (let tonic = 0; tonic < 12; tonic++) {
    const tonicMidi = 60 + (tonic > 6 ? tonic - 12 : tonic); // keep melodies around C4
    tunes.forEach((tune, ti) => {
      for (const [label, opts, listen] of [['singer', {}, 'singer'], ['singer-flat', { centsOff: -35 }, 'singer'], ['song', { accompany: true }, 'song']]) {
        const { scores } = analyse(render(tonicMidi, mode, tune, opts), listen);
        const verdict = classify(scores[0], tonic, mode);
        const key = `${label} · ${mode}`;
        results[key] ||= { right: 0, relative: 0, fifth: 0, other: 0, total: 0 };
        results[key][verdict]++;
        results[key].total++;
        if (verdict !== 'right' && examples.length < 8) examples.push(`${label}: tune ${ti + 1} in ${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][tonic]} ${mode} → found ${scores[0].name} (${verdict})`);
      }
    });
  }
}

// Harder cases (fewer keys, to keep the run short): closer to real life.
const HARD_TONICS = [0, 2, 4, 7, 9, 10];
for (const tonic of HARD_TONICS) {
  const tonicMidi = 60 + (tonic > 6 ? tonic - 12 : tonic);
  const cases = [
    ['hard: short phrase only (7 notes, major)', 'major', MAJOR_TUNES[0].slice(0, 7), { repeats: 1 }, 'singer'],
    ['hard: singer drifting −40 → +20 cents (major)', 'major', MAJOR_TUNES[1], { centsOff: -40, drift: 60 }, 'singer'],
    ['hard: singer drifting −40 → +20 cents (minor)', 'minor', MINOR_TUNES[0], { centsOff: -40, drift: 60 }, 'singer'],
    ['hard: song with drums (major)', 'major', MAJOR_TUNES[0], { accompany: true, drums: true }, 'song'],
    ['hard: song with drums (minor)', 'minor', MINOR_TUNES[1], { accompany: true, drums: true }, 'song'],
  ];
  for (const [label, mode, tune, opts, listen] of cases) {
    const { scores } = analyse(render(tonicMidi, mode, tune, opts), listen);
    const verdict = classify(scores[0], tonic, mode);
    results[label] ||= { right: 0, relative: 0, fifth: 0, other: 0, total: 0 };
    results[label][verdict]++;
    results[label].total++;
    if (verdict !== 'right' && examples.length < 12) examples.push(`${label}: ${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][tonic]} ${mode} → found ${scores[0].name} (${verdict})`);
  }
}

console.log('| Test | Right key | Relative key (same notes) | A fifth away | Other wrong |');
console.log('|---|---|---|---|---|');
for (const [k, r] of Object.entries(results)) {
  const pct = (x) => `${Math.round((100 * x) / r.total)}%`;
  console.log(`| ${k} (${r.total} tunes) | ${pct(r.right)} | ${pct(r.relative)} | ${pct(r.fifth)} | ${pct(r.other)} |`);
}
if (examples.length) console.log(`\nSome misses:\n  ${examples.join('\n  ')}`);
