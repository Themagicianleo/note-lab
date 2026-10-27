// make-test-signals.js
// ------------------------------------------------------------
// Generates WAV test files whose true pitch is known exactly, so the
// pitch detector can be scored. Run with:  npm run make-signals
//
// These are COMPUTER-MADE signals, not real recordings. They are cleaner
// and more regular than a real voice or instrument, so accuracy measured
// on them will look better than real use. Real recordings can be added
// to test-audio/ later.
//
// For every WAV file we also write a CSV file with the "truth":
//   time_s,f0_hz      (one row every 10 ms; f0_hz = 0 means "no pitch here")
//
// How the sounds are built (additive synthesis):
//   A pitched sound = a fundamental (f0) plus harmonics at 2×f0, 3×f0, ...
//   We add sine waves for each harmonic, each with its own loudness.
//   Changing those loudnesses changes the tone colour (timbre).
// ------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeWav } from './wav.js';
import { noteToFrequency, frequencyToNote, formatNote } from '../js/pitch-math.js';

const SAMPLE_RATE = 48000;      // the rate most phones and laptops use
const TRUTH_STEP = 0.01;        // write the truth every 10 ms
const OUT_DIR = new URL('../test-audio/generated/', import.meta.url).pathname;

// ---------- small helpers ----------

// Repeatable random numbers (same "random" noise every run), so the
// files don't change each time they are regenerated.
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {             // "mulberry32", a tiny standard generator
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dbToGain = (db) => Math.pow(10, db / 20);   // −6 dB ≈ 0.5, −20 dB = 0.1

function rms(samples) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

function peak(samples) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  return max;
}

// A smooth 0→1→0 envelope: fades in and out over `fade` seconds so the
// sound does not click when it starts and stops.
function fadeInOut(start, end, fade = 0.02) {
  return (t) => {
    if (t < start || t > end) return 0;
    return Math.min(1, (t - start) / fade, (end - t) / fade);
  };
}

// Vibrato: the pitch wobbles up and down by `depthCents`, `rate` times a second.
// Singers typically use about 5–7 wobbles per second.
function withVibrato(baseHz, depthCents = 30, rate = 5.5) {
  return (t) => baseHz * Math.pow(2, (depthCents / 1200) * Math.sin(2 * Math.PI * rate * t));
}

// ---------- tone colours (how loud each harmonic is) ----------
// Each function gets the harmonic number k (1 = fundamental) and its
// frequency in Hz, and returns that harmonic's loudness.

const pureSine = (k) => (k === 1 ? 1 : 0);

// Bright, buzzy tone (like a sawtooth): harmonic k has loudness 1/k.
const bright = (k) => 1 / k;

// Weak fundamental: the fundamental is much quieter than harmonics 2 and 3.
// This happens with small speakers, phone mics and some low voices, and is
// a classic cause of "octave too high" mistakes.
const weakFundamental = (k) => (k === 1 ? 0.1 : k === 2 ? 1 : k === 3 ? 0.8 : 1 / k);

// A sung "ah" vowel. The voice makes harmonics that get quieter as they go up
// (about 1/k). The mouth and throat then boost some frequency regions, called
// formants. For "ah" they are near 700, 1200 and 2600 Hz.
function vowelAh(k, hz) {
  const bump = (centre, width, gain) => gain * Math.exp(-(((hz - centre) / width) ** 2));
  const formants = 0.08 + bump(700, 150, 1) + bump(1200, 180, 0.6) + bump(2600, 250, 0.25);
  return formants / k;
}

// ---------- building a signal ----------

// Makes the pitched part of a sound.
//   f0At(t)    → pitch in Hz at time t
//   levelAt(t) → loudness 0..1 at time t (0 = silent)
//   colour     → one of the tone colour functions above
function makeTone(duration, f0At, levelAt, colour) {
  const length = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(length);
  const maxHarmonics = 60;
  const phases = new Float64Array(maxHarmonics + 1); // one running phase per harmonic

  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const level = levelAt(t);
    const f0 = f0At(t);
    let sample = 0;
    for (let k = 1; k <= maxHarmonics; k++) {
      const hz = k * f0;
      if (hz >= SAMPLE_RATE / 2 - 1000) break; // stay below the highest frequency a file can hold
      // Advance the phase by the CURRENT frequency, so gliding pitches stay smooth.
      phases[k] += (2 * Math.PI * hz) / SAMPLE_RATE;
      if (level > 0) sample += colour(k, hz) * Math.sin(phases[k]);
    }
    out[i] = level * sample;
  }
  return out;
}

// Makes noise.
//   'white'   – hiss with all frequencies equally loud (breath, "sss")
//   'room'    – mostly low rumble with some hiss (fans, traffic, air conditioning)
//   'whisper' – hiss with the deepest and highest parts removed
// levelAt(t) works like in makeTone.
function makeNoise(duration, type, levelAt, seed) {
  const random = makeRandom(seed);
  const length = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(length);
  let low = 0;    // a running average = a simple low-pass filter (keeps the rumble)
  let prev = 0;   // previous white value, for a simple high-pass filter

  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1;
    let value;
    if (type === 'white') {
      value = white;
    } else if (type === 'room') {
      low = 0.995 * low + 0.005 * white;      // heavy low-pass → rumble
      value = 20 * low + 0.15 * white;
    } else if (type === 'whisper') {
      const highPassed = white - prev;          // removes the deepest sounds
      low = 0.7 * low + 0.3 * highPassed;       // gentle low-pass removes the harshest hiss
      value = low;
    }
    prev = white;
    out[i] = levelAt(i / SAMPLE_RATE) * value;
  }
  return out;
}

// Mix noise into a tone at a given signal-to-noise ratio (SNR) in dB.
// SNR 20 dB = noise is much quieter than the tone. SNR 0 dB = equally loud.
function mixAtSnr(tone, noise, snrDb) {
  const noiseGain = rms(tone) / (rms(noise) * dbToGain(snrDb));
  return tone.map((s, i) => s + noise[i] * noiseGain);
}

// Scale a signal so its loudest point is at `peakDb` dBFS (0 dBFS = maximum).
function normalise(samples, peakDb) {
  const p = peak(samples);
  if (p === 0) return samples;
  const gain = dbToGain(peakDb) / p;
  return samples.map((s) => s * gain);
}

// The truth file: f0 every 10 ms, or 0 where the tone is too quiet to count
// (below 10% of its full level, or less than 20 ms into a fade).
function truthCsv(duration, f0At, levelAt) {
  const rows = ['time_s,f0_hz'];
  const frames = Math.round(duration / TRUTH_STEP);
  for (let frame = 0; frame <= frames; frame++) {
    const t = frame * TRUTH_STEP; // counting whole frames avoids rounding drift
    const voiced = levelAt(t) >= 0.1;
    rows.push(`${t.toFixed(2)},${voiced ? f0At(t).toFixed(3) : 0}`);
  }
  return rows.join('\n') + '\n';
}

// ---------- the list of test signals ----------
// Each entry: name, category, description, duration, and a build() that
// returns { samples, f0At, levelAt }.

const C4 = noteToFrequency('C', 4);
const silent = () => 0;
const always = () => 1;

const SIGNALS = [];
function add(name, category, description, duration, build) {
  SIGNALS.push({ name, category, description, duration, build });
}

// --- clean single notes ---
for (const [label, hz] of [['A4', 440], ['C4', C4], ['E4-330Hz', 330]]) {
  add(`sine-${label}`, 'clean', `Pure sine wave at ${hz.toFixed(2)} Hz.`, 2, () => {
    const f0At = () => hz;
    const levelAt = fadeInOut(0, 2);
    return { samples: normalise(makeTone(2, f0At, levelAt, pureSine), -6), f0At, levelAt };
  });
}

add('bright-A3', 'clean', 'Buzzy tone at 220 Hz with many harmonics (like a sawtooth).', 2, () => {
  const f0At = () => 220;
  const levelAt = fadeInOut(0, 2);
  return { samples: normalise(makeTone(2, f0At, levelAt, bright), -6), f0At, levelAt };
});

// --- octave-error traps ---
add('weak-fundamental-A2', 'octave-trap',
  '110 Hz tone whose fundamental is 20 dB quieter than its 2nd harmonic. Easy to misread as A3.', 2, () => {
    const f0At = () => 110;
    const levelAt = fadeInOut(0, 2);
    return { samples: normalise(makeTone(2, f0At, levelAt, weakFundamental), -6), f0At, levelAt };
  });

// --- low notes ---
add('plucked-E2', 'low', 'Guitar-like low E (82.41 Hz) that fades away after being plucked.', 2.5, () => {
  const hz = noteToFrequency('E', 2);
  const f0At = () => hz;
  const fade = fadeInOut(0, 2.5, 0.005);
  const levelAt = (t) => fade(t) * Math.exp(-t / 0.8); // dies away like a plucked string
  return { samples: normalise(makeTone(2.5, f0At, levelAt, bright), -6), f0At, levelAt };
});

add('bass-E1', 'low', 'Very low bass E (41.20 Hz), held steady.', 3, () => {
  const hz = noteToFrequency('E', 1);
  const f0At = () => hz;
  const levelAt = fadeInOut(0, 3);
  return { samples: normalise(makeTone(3, f0At, levelAt, bright), -6), f0At, levelAt };
});

// --- voice-like ---
add('voice-low-G2-vibrato', 'voice', 'Low "ah" around G2 (98 Hz) with ±30 cent vibrato.', 2.5, () => {
  const f0At = withVibrato(noteToFrequency('G', 2));
  const levelAt = fadeInOut(0, 2.5, 0.08);
  return { samples: normalise(makeTone(2.5, f0At, levelAt, vowelAh), -6), f0At, levelAt };
});

add('voice-mid-A3-vibrato', 'voice', 'Mid "ah" around A3 (220 Hz) with ±30 cent vibrato.', 2.5, () => {
  const f0At = withVibrato(220);
  const levelAt = fadeInOut(0, 2.5, 0.08);
  return { samples: normalise(makeTone(2.5, f0At, levelAt, vowelAh), -6), f0At, levelAt };
});

add('voice-high-A4-vibrato', 'voice', 'High "ah" around A4 (440 Hz) with ±30 cent vibrato.', 2.5, () => {
  const f0At = withVibrato(440);
  const levelAt = fadeInOut(0, 2.5, 0.08);
  return { samples: normalise(makeTone(2.5, f0At, levelAt, vowelAh), -6), f0At, levelAt };
});

add('voice-glide-C3-C4', 'voice', 'Sung slide from C3 up to C4 over 2 seconds.', 3, () => {
  const c3 = noteToFrequency('C', 3);
  // Hold C3 for 0.5 s, slide up an octave over 2 s, hold C4 for 0.5 s.
  const f0At = (t) => c3 * Math.pow(2, Math.min(1, Math.max(0, (t - 0.5) / 2)));
  const levelAt = fadeInOut(0, 3, 0.08);
  return { samples: normalise(makeTone(3, f0At, levelAt, vowelAh), -6), f0At, levelAt };
});

add('voice-scale-C4-G4', 'voice', 'Five sung notes C4 D4 E4 F4 G4, 0.5 s each with short gaps. For the range finder.', 3, () => {
  const notes = ['C', 'D', 'E', 'F', 'G'].map((n) => noteToFrequency(n, 4));
  const slot = 0.6;                                  // 0.5 s note + 0.1 s gap
  const index = (t) => Math.min(notes.length - 1, Math.floor(t / slot));
  const f0At = (t) => notes[index(t)];
  const levelAt = (t) => {
    const start = index(t) * slot;
    return t < notes.length * slot ? fadeInOut(start, start + 0.5, 0.03)(t) : 0;
  };
  return { samples: normalise(makeTone(3, f0At, levelAt, vowelAh), -6), f0At, levelAt };
});

add('speech-like', 'voice',
  'Speech-like pattern: short voiced syllables with falling pitch (about 140→110 Hz), "s" hiss between them, and pauses.', 3, () => {
    // Each syllable: 0.08 s hiss (consonant), 0.22 s voiced vowel, 0.1 s pause.
    const syllable = 0.4;
    const pos = (t) => t % syllable;
    const f0At = (t) => {
      const whole = 140 - 30 * (t / 3);                     // the sentence falls overall
      return whole * (1 + 0.06 * Math.sin((Math.PI * (pos(t) - 0.08)) / 0.22)); // each syllable rises a little
    };
    const levelAt = (t) => fadeInOut(0.08, 0.3, 0.02)(pos(t));
    const hissAt = (t) => fadeInOut(0, 0.08, 0.01)(pos(t));
    const voiced = makeTone(3, f0At, levelAt, vowelAh);
    const hiss = makeNoise(3, 'white', hissAt, 11);
    const hissGain = (0.5 * peak(voiced)) / peak(hiss);
    const samples = voiced.map((s, i) => s + hiss[i] * hissGain);
    return { samples: normalise(samples, -6), f0At, levelAt };
  });

// --- breath and noise mixed with pitch ---
add('breathy-A3', 'noisy', 'Breathy "ah" at 220 Hz: as much breath hiss as voice (SNR 0 dB).', 2, () => {
  const f0At = () => 220;
  const levelAt = fadeInOut(0, 2, 0.08);
  const tone = makeTone(2, f0At, levelAt, vowelAh);
  const breath = makeNoise(2, 'whisper', levelAt, 21);
  return { samples: normalise(mixAtSnr(tone, breath, 0), -6), f0At, levelAt };
});

for (const snr of [20, 10, 0]) {
  add(`room-noise-A4-snr${snr}`, 'noisy',
    `"Ah" at 440 Hz in room noise, signal-to-noise ratio ${snr} dB${snr === 0 ? ' (noise as loud as the voice)' : ''}.`, 2, () => {
      const f0At = () => 440;
      const levelAt = fadeInOut(0, 2, 0.08);
      const tone = makeTone(2, f0At, levelAt, vowelAh);
      const room = makeNoise(2, 'room', always, 30 + snr);
      return { samples: normalise(mixAtSnr(tone, room, snr), -6), f0At, levelAt };
    });
}

// --- quiet ---
add('quiet-A4', 'quiet', 'Sine at 440 Hz, very quiet (peak −50 dBFS). Tests the volume threshold.', 2, () => {
  const f0At = () => 440;
  const levelAt = fadeInOut(0, 2);
  return { samples: normalise(makeTone(2, f0At, levelAt, pureSine), -50), f0At, levelAt };
});

// --- no pitch at all (the app should say "no clear pitch") ---
add('whisper-noise', 'no-pitch', 'Whisper-like hiss with no pitch.', 2, () => {
  const samples = normalise(makeNoise(2, 'whisper', fadeInOut(0, 2, 0.08), 41), -12);
  return { samples, f0At: silent, levelAt: silent };
});

add('room-noise', 'no-pitch', 'Room rumble and hiss with no pitch.', 2, () => {
  const samples = normalise(makeNoise(2, 'room', always, 42), -20);
  return { samples, f0At: silent, levelAt: silent };
});

add('near-silence', 'no-pitch', 'Almost silent: faint hiss at about −80 dBFS.', 2, () => {
  const samples = normalise(makeNoise(2, 'white', always, 43), -80);
  return { samples, f0At: silent, levelAt: silent };
});

// ---------- write everything ----------

mkdirSync(OUT_DIR, { recursive: true });
const index = [];

for (const signal of SIGNALS) {
  const { samples, f0At, levelAt } = signal.build();
  writeWav(join(OUT_DIR, `${signal.name}.wav`), samples, SAMPLE_RATE);
  writeFileSync(join(OUT_DIR, `${signal.name}.csv`), truthCsv(signal.duration, f0At, levelAt));
  index.push({
    file: `${signal.name}.wav`,
    truth: `${signal.name}.csv`,
    category: signal.category,
    description: signal.description,
    durationSeconds: signal.duration,
    peakDbfs: Number((20 * Math.log10(peak(samples) || 1e-12)).toFixed(1)),
  });
  const mid = f0At(signal.duration / 2);
  const label = mid > 0 ? formatNote(frequencyToNote(mid)) : 'no pitch';
  console.log(`${signal.name.padEnd(26)} ${signal.category.padEnd(12)} ${label}`);
}

writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ sampleRate: SAMPLE_RATE, signals: index }, null, 2) + '\n');
console.log(`\nWrote ${SIGNALS.length} WAV files + truth CSVs to test-audio/generated/`);
