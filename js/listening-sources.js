// listening-sources.js
// ------------------------------------------------------------
// The sounds the critical-listening exercises play. All of them are made by
// maths in the browser (nothing is downloaded), and are identical every time:
//   • pink noise: equal power in every octave, the standard sound for EQ practice
//   • a short music loop (drums, bass, chords, melody) written for this app,
//     kept as four separate parts so the "mix balance" exercise can change one
//   • the drums alone (clear hits make echo, reverb and compression easy to hear)
//   • a plain tone, for the pitch exercise
// You can also load your own track; an excerpt of it is used (sourceFromChannels).
//
// Every source is a loop (see js/listening-dsp.js) with its loudest sample at
// SOURCE_PEAK, which leaves 12 dB of room above it: a +12 dB EQ boost must not
// run into the top of the range, because that would add distortion of its own.
// ------------------------------------------------------------

import { seededRandom, pinkNoise, makeClip, emptyClip, mixClips, peakOf, scaleClip, normalisePeak, midSidePower } from './listening-dsp.js';

export const SOURCE_PEAK = 0.25; // −12 dBFS
export const SOURCES = {
  pink: { label: 'Pink noise' },
  mix: { label: 'Music loop' },
  drums: { label: 'Drum loop' },
  file: { label: 'Your own track' },
};

// ---------- pink noise ----------

// mono: the same noise in both ears (a sharp centre image);
// stereo: different noise in each ear (as wide as stereo gets).
export function pinkSource(sampleRate, { stereo = false, seconds = 6 } = {}) {
  const n = Math.round(seconds * sampleRate);
  const left = pinkNoise(n, seededRandom(11));
  const right = stereo ? pinkNoise(n, seededRandom(29)) : Float32Array.from(left);
  return normalisePeak(makeClip(sampleRate, left, right), SOURCE_PEAK);
}

// ---------- the music loop ----------
// 4 bars at 120 beats a minute = 8 seconds. Chords: A minor, F, C, G.
// Notes that ring past the end carry on at the start, so the loop is seamless.

const BPM = 120;
const BARS = 4;
const STEP = 60 / BPM / 2; // one eighth note = 0.25 s
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

const BASS_ROOTS = [33, 29, 36, 31];                  // A1 F1 C2 G1
const BASS_STEPS = [0, 2, 3, 5, 6];                   // which eighth notes of the bar
const CHORDS = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]]; // Am, F, C, G (close together)
const MELODY = [                                      // one bar each; null = rest
  [76, null, 72, 69, null, 72, 74, null],
  [72, null, 69, 72, null, 77, 76, null],
  [76, null, 79, 76, null, 72, 74, null],
  [74, null, 71, 67, null, 71, 74, 76],
];
const CHORD_HARMONICS = [0, 1, 2, 3, 4, 5].map((h) => (h ? 1 / Math.pow(h, 1.3) : 0)); // loudness of each harmonic
const KICK_STEPS = [0, 3, 4];
const SNARE_STEPS = [2, 6];

export function makeStems(sampleRate) {
  const n = Math.round(BARS * 8 * STEP * sampleRate);
  const random = seededRandom(5);
  const stems = { drums: emptyClip(sampleRate, n), bass: emptyClip(sampleRate, n), chords: emptyClip(sampleRate, n), lead: emptyClip(sampleRate, n) };
  const TWO_PI = 2 * Math.PI;

  // Add a sound starting at `time` seconds: value(t) for `seconds`, wrapped round the loop.
  const add = (clip, time, seconds, value, left = 1, right = 1) => {
    const start = Math.round(time * sampleRate);
    const count = Math.round(seconds * sampleRate);
    const [l, r] = clip.channels;
    for (let i = 0; i < count; i++) {
      const v = value(i / sampleRate, i);
      const at = (start + i) % n;
      l[at] += v * left; r[at] += v * right;
    }
  };
  // A short fade at both ends of a note, so it doesn't click.
  const edges = (t, length, fadeIn, fadeOut) => Math.min(1, t / fadeIn, (length - t) / fadeOut);

  for (let bar = 0; bar < BARS; bar++) {
    const barTime = bar * 8 * STEP;

    // Drums. Kick: a sine that drops quickly from about 150 Hz to 45 Hz.
    for (const s of KICK_STEPS) {
      let phase = 0;
      add(stems.drums, barTime + s * STEP, 0.5, (t) => {
        phase += (TWO_PI * (45 + 110 * Math.exp(-t / 0.03))) / sampleRate;
        return 0.9 * Math.sin(phase) * Math.exp(-t / 0.16) * edges(t, 0.5, 0.002, 0.05);
      });
    }
    // Snare: a burst of noise (with the lows taken out) plus a short tone.
    for (const s of SNARE_STEPS) {
      let last = 0;
      add(stems.drums, barTime + s * STEP, 0.4, (t) => {
        const white = random() * 2 - 1;
        const bright = white - 0.6 * last; last = white;
        return (0.45 * bright * Math.exp(-t / 0.07) + 0.4 * Math.sin(TWO_PI * 185 * t) * Math.exp(-t / 0.045)) * edges(t, 0.4, 0.001, 0.05);
      });
    }
    // Hi-hat: very short, very bright noise on every eighth note, a little to the right.
    for (let s = 0; s < 8; s++) {
      let a = 0, b = 0;
      const loud = s % 2 ? 0.28 : 0.16;
      add(stems.drums, barTime + s * STEP, 0.12, (t) => {
        const white = random() * 2 - 1;
        const bright = white - 2 * a + b; b = a; a = white; // removes the lows twice over
        return loud * 0.5 * bright * Math.exp(-t / 0.022) * edges(t, 0.12, 0.0005, 0.02);
      }, 0.7, 1);
    }

    // Bass: the chord's root, plucked. Higher harmonics die away faster.
    for (const s of BASS_STEPS) {
      const f = hz(BASS_ROOTS[bar]);
      add(stems.bass, barTime + s * STEP, 0.3, (t) => {
        let v = 0;
        for (let h = 1; h <= 8; h++) v += (Math.sin(TWO_PI * f * h * t) / h) * Math.exp(-t * 2.5 * (h - 1));
        return 0.55 * v * Math.exp(-t / 0.35) * edges(t, 0.3, 0.004, 0.03);
      });
    }

    // Chords: a soft held sound. The left ear's copy is tuned 5 cents below
    // the right ear's, which makes it sound wide (the two sides differ).
    for (const note of CHORDS[bar]) {
      const length = 8 * STEP + 0.15;
      for (const [detune, left, right] of [[-5, 1, 0], [5, 0, 1]]) {
        const f = hz(note) * Math.pow(2, detune / 1200);
        add(stems.chords, barTime, length, (t) => {
          let v = 0;
          for (let h = 1; h <= 5; h++) v += Math.sin(TWO_PI * f * h * t) * CHORD_HARMONICS[h];
          return 0.11 * v * edges(t, length, 0.08, 0.15);
        }, left, right);
      }
    }

    // Melody: plucked notes, a little to the left.
    MELODY[bar].forEach((note, s) => {
      if (note === null) return;
      const f = hz(note);
      add(stems.lead, barTime + s * STEP, 0.6, (t) => {
        let v = 0;
        for (let h = 1; h <= 6; h++) v += (Math.sin(TWO_PI * f * h * t) / h) * Math.exp(-t * 3 * (h - 1));
        return 0.2 * v * Math.exp(-t / 0.22) * edges(t, 0.6, 0.003, 0.05);
      }, 1, 0.6);
    });
  }

  // Scale all four parts together, so the whole mix peaks at SOURCE_PEAK.
  const names = Object.keys(stems);
  const g = SOURCE_PEAK / peakOf(mixClips(names.map((k) => stems[k])));
  for (const k of names) stems[k] = scaleClip(stems[k], g);
  return stems;
}

export const STEM_NAMES = { drums: 'Drums', bass: 'Bass', chords: 'Chords', lead: 'Melody' };

// The mix with each part at a level in dB (parts not named stay at 0 dB).
export function mixStems(stems, levelsDb = {}) {
  const names = Object.keys(STEM_NAMES);
  return mixClips(names.map((k) => stems[k]), names.map((k) => Math.pow(10, (levelsDb[k] || 0) / 20)));
}

// ---------- a tone (for the pitch exercise) ----------
// 0.8 s of a soft tone (a fundamental plus two quieter harmonics, like the
// note trainers), then 0.4 s of silence, as a loop.
export function toneSource(sampleRate, frequency) {
  const n = Math.round(1.2 * sampleRate);
  const length = 0.8;
  const wave = new Float32Array(n);
  for (let i = 0; i < Math.round(length * sampleRate); i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.02, (length - t) / 0.06);
    const w = 2 * Math.PI * frequency * t;
    wave[i] = env * (Math.sin(w) + 0.5 * Math.sin(2 * w) + 0.25 * Math.sin(3 * w));
  }
  return normalisePeak(makeClip(sampleRate, wave, Float32Array.from(wave)), SOURCE_PEAK);
}

// ---------- your own track ----------
// Up to `seconds` of the file, starting 30% of the way in (past most intros),
// with a short fade at each end so the loop doesn't click.
// channels: one or two Float32Arrays, already at `sampleRate`.
export function sourceFromChannels(channels, sampleRate, seconds = 12) {
  const total = channels[0].length;
  const n = Math.min(total, Math.round(seconds * sampleRate));
  const start = total > n ? Math.min(Math.floor(total * 0.3), total - n) : 0;
  const fade = Math.min(Math.round(0.02 * sampleRate), Math.floor(n / 2));
  const cut = (ch) => {
    const out = ch.slice(start, start + n);
    for (let i = 0; i < fade; i++) { out[i] *= i / fade; out[n - 1 - i] *= i / fade; }
    return out;
  };
  const left = cut(channels[0]);
  const right = channels.length > 1 ? cut(channels[1]) : Float32Array.from(left);
  const clip = normalisePeak(makeClip(sampleRate, left, right), SOURCE_PEAK);
  // "Mono" also covers a stereo file whose two sides are (almost) the same.
  const { mid, side } = midSidePower(clip);
  return { clip, mono: side <= mid * 1e-4, silent: peakOf(clip) === 0 };
}
