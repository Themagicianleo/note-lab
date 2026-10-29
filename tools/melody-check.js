// melody-check.js
// ------------------------------------------------------------
// Measures "music mode" (js/melody.js) against the normal detector on
// GENERATED songs whose melody is known. Run with:  node tools/melody-check.js
//   --wav   writes test-audio/melody/song-melody-F4.wav for the browser test
//
// Each song: a sung "ah" melody (formants, vibrato, with rests) over piano-like
// chords (struck, decaying), a bass line, and drums (kick, snare, hi-hat).
// Melody-to-accompaniment ratio (MAR): how much louder the singer is than the
// band, +6 dB (singer clearly on top, typical of pop mixes) to −6 dB (buried).
//
// Scored like the MIREX melody-extraction task (G. Poliner et al., "Melody
// transcription from music audio: approaches and evaluation", IEEE Trans.
// Audio, Speech and Language Processing 15(4), 2007):
//   pitch right  – of the moments the singer sings, % showing the melody note (within 50 cents)
//   octave-free  – same, but an octave error counts as right (note NAME right)
//   shown right  – of the moments a note is SHOWN, % that are the melody note
//   rests shown  – of the singer's rests (band still playing), % showing a note anyway
//
// These are computer-made songs, much simpler than real recordings (no reverb,
// one singer, clean instruments). Real songs will do worse.
// ------------------------------------------------------------

import { MelodyTracker } from '../js/melody.js';
import { PitchTracker, SENSITIVITY } from '../js/pitch-tracker.js';
import { bandFilter } from '../js/filters.js';
import { centsBetween } from '../js/pitch-math.js';

const SR = 48000;
const HOP = 800; // 60 readings a second
let seed = 3;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
const hz = (n) => 440 * 2 ** ((n - 69) / 12);
const rmsOf = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

// Tunes: [semitones from the tonic, beats]; null = a rest. Two of my own, plus "Twinkle Twinkle" (public domain).
export const TUNES = [
  [[0, 1], [0, 1], [7, 1], [7, 1], [9, 1], [9, 1], [7, 2], [null, 1], [5, 1], [5, 1], [4, 1], [4, 1], [2, 1], [2, 1], [0, 2], [null, 1]],
  [[0, 1], [2, 1], [4, 1], [5, 1], [7, 2], [null, 1], [4, 1], [0, 1], [9, 1], [7, 1], [5, 1], [4, 1], [2, 2], [null, 2], [7, 1], [11, 1], [12, 2]],
  [[4, 2], [2, 1], [0, 1], [2, 2], [null, 1], [4, 1], [4, 1], [4, 2], [null, 1], [2, 1], [2, 1], [4, 1], [7, 2], [5, 1], [4, 3]],
];
const CHORDS = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [9, 12, 16]]; // I IV V vi
const BEAT = 0.5;

// chordOctave: −12 = chords an octave below the singer (like a piano left hand);
// 0 = chords in the SAME range as the singer (harder: like strings or a guitar).
export function makeSong({ tonic, tune, mar, chordOctave = -12 }) {
  const totalBeats = tune.reduce((s, [, b]) => s + b, 0) * 2; // twice through
  const n = Math.round(totalBeats * BEAT * SR);
  const voice = new Float32Array(n);
  const band = new Float32Array(n);
  const truth = new Float32Array(n);
  const notes = [];
  let t0 = 0;
  for (let rep = 0; rep < 2; rep++) for (const [deg, beats] of tune) { notes.push({ deg, t0, t1: t0 + beats * BEAT }); t0 += beats * BEAT; }
  const phases = new Float64Array(30);
  let ni = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (ni < notes.length - 1 && t >= notes[ni].t1) ni++;
    const note = notes[ni];
    // --- the singer ---
    if (note.deg !== null) {
      const f0 = hz(tonic + note.deg) * 2 ** ((25 / 1200) * Math.sin(2 * Math.PI * 5.5 * t));
      const env = Math.min(1, (t - note.t0) / 0.05, (note.t1 - t) / 0.05);
      let s = 0;
      for (let h = 1; h < 30 && h * f0 < 8000; h++) {
        phases[h] += (2 * Math.PI * h * f0) / SR;
        const f = h * f0;
        s += ((0.08 + Math.exp(-(((f - 700) / 150) ** 2)) + 0.6 * Math.exp(-(((f - 1200) / 180) ** 2)) + 0.25 * Math.exp(-(((f - 2600) / 250) ** 2))) / h) * Math.sin(phases[h]);
      }
      voice[i] = env * s;
      truth[i] = env >= 1 ? f0 : 0;
    }
    // --- the band: chords struck on every beat (decaying), bass, drums ---
    const beat = Math.floor(t / BEAT);
    const inBeat = t - beat * BEAT;
    const chord = CHORDS[Math.floor(beat / 4) % 4];
    let b = 0;
    const strike = Math.exp(-inBeat * 4);
    for (const d of chord) for (let k = 1; k <= 10; k++) b += (0.25 / k ** 1.5) * strike * Math.sin(2 * Math.PI * hz(tonic + chordOctave + d) * k * t);
    for (let k = 1; k <= 6; k++) b += (0.35 / k) * Math.sin(2 * Math.PI * hz(tonic - 24 + chord[0]) * k * t); // bass
    if (beat % 2 === 0 && inBeat < 0.15) b += 0.8 * Math.exp(-inBeat * 30) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-inBeat * 40)) * inBeat); // kick
    if (beat % 2 === 1 && inBeat < 0.12) b += 0.35 * Math.exp(-inBeat * 35) * random(); // snare
    if ((t / (BEAT / 2)) % 1 < 0.03) b += 0.12 * random(); // hi-hat
    band[i] = b;
  }
  // Mix at the melody-to-accompaniment ratio (RMS of the voice while singing vs the band).
  const sung = voice.filter((_, i) => truth[i] > 0);
  const g = (rmsOf(band) * 10 ** (mar / 20)) / rmsOf(sung);
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) { out[i] = g * voice[i] + band[i]; peak = Math.max(peak, Math.abs(out[i])); }
  for (let i = 0; i < n; i++) out[i] *= 0.5 / peak; // −6 dBFS peak
  return { out, truth };
}

// The two ways of listening, each returning one reading (Hz or null) per hop.
const METHODS = {
  'Normal (one note at a time, High sensitivity)': (x, range) => {
    const tracker = new PitchTracker({ ...range, smoothingLevel: 2, ...SENSITIVITY.high });
    const y = bandFilter(x, SR, range.minHz, range.maxHz);
    const out = [];
    for (let s = 0; s + 4096 <= y.length; s += HOP) out.push({ end: s + 4096, hz: tracker.process(y.subarray(s + 2048, s + 4096), SR, (1000 * s) / SR).smoothed });
    return out;
  },
  'Music mode (melody guess)': (x, range) => {
    const tracker = new MelodyTracker({ ...range });
    const out = [];
    for (let s = 0; s + 4096 <= x.length; s += HOP) out.push({ end: s + 4096, hz: tracker.process(x.subarray(s, s + 4096), SR).smoothed });
    return out;
  },
};

export function score(readings, truth) {
  let voiced = 0, right = 0, chroma = 0, shown = 0, shownRight = 0, rests = 0, restShown = 0;
  for (const { end, hz } of readings) {
    // The truth at the newest part of the window (what the reading mostly reflects), and stable over its last 1024 samples.
    const a = truth[end - 1024];
    const b = truth[end - 1];
    if (a > 0 && b > 0) {
      voiced++;
      if (hz) {
        shown++;
        const c = centsBetween(hz, b);
        if (Math.abs(c) <= 50) { right++; shownRight++; }
        const r = ((c % 1200) + 1200) % 1200;
        if (r <= 50 || r >= 1150) chroma++;
      }
    } else if (a === 0 && b === 0) {
      rests++;
      if (hz) { restShown++; shown++; }
    }
  }
  return { right: right / voiced, chroma: chroma / voiced, shownRight: shown ? shownRight / shown : null, restShown: rests ? restShown / rests : null };
}

export const VOICES = { 'high voice (F4 tonic)': { tonic: 65, range: { minHz: 150, maxHz: 1200 } }, 'low voice (G3 tonic)': { tonic: 55, range: { minHz: 65, maxHz: 500 } } };

const main = process.argv[1] && process.argv[1].endsWith('melody-check.js');
if (main && process.argv.includes('--wav')) {
  const { writeWav } = await import('./wav.js');
  const { mkdirSync } = await import('node:fs');
  const dir = new URL('../test-audio/melody/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const { out } = makeSong({ tonic: 65, tune: TUNES[2], mar: 3 });
  writeWav(`${dir}song-melody-F4.wav`, out, SR);
  // An overloaded microphone: a loud A4 cut off at ±1 (for the "too loud" warning).
  writeWav(`${dir}clipped-A4.wav`, Float32Array.from({ length: 3 * SR }, (_, i) => Math.max(-1, Math.min(1, 1.6 * Math.sin((2 * Math.PI * 440 * i) / SR)))), SR);
  console.log('Wrote test-audio/melody/song-melody-F4.wav (F major, singer 3 dB above the band) and clipped-A4.wav');
  process.exit(0);
}

if (main) {
  const pct = (x) => (x === null ? '–' : `${Math.round(100 * x)}%`);
  console.log('| Song | Method | Pitch right | Note name right (octave-free) | When a note is shown, it is right | Rests: a note shown anyway |');
  console.log('|---|---|---|---|---|---|');
  for (const [cname, chordOctave] of [['chords below', -12], ['chords in the same range', 0]]) for (const mar of [6, 3, 0, -6]) {
    for (const [vname, v] of Object.entries(VOICES)) {
      const totals = {};
      for (const tune of TUNES) {
        const { out, truth } = makeSong({ tonic: v.tonic, tune, mar, chordOctave });
        for (const [mname, method] of Object.entries(METHODS)) {
          const s = score(method(out, v.range), truth);
          const t = (totals[mname] ||= { right: 0, chroma: 0, shownRight: 0, shownCount: 0, restShown: 0, n: 0 });
          t.right += s.right; t.chroma += s.chroma; t.restShown += s.restShown; t.n++;
          if (s.shownRight !== null) { t.shownRight += s.shownRight; t.shownCount++; }
        }
      }
      for (const [mname, t] of Object.entries(totals)) {
        console.log(`| ${vname}, ${cname}, singer ${mar > 0 ? '+' : ''}${mar} dB vs band | ${mname} | ${pct(t.right / t.n)} | ${pct(t.chroma / t.n)} | ${t.shownCount ? pct(t.shownRight / t.shownCount) : '–'} | ${pct(t.restShown / t.n)} |`);
      }
    }
  }
  console.log('\n(Averages over 3 tunes each. "Pitch right" counts moments where the singer is singing.)');
}
