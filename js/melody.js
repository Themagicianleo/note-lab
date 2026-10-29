// melody.js
// ------------------------------------------------------------
// "Music mode": a GUESS at the melody (usually the singer) in music played
// through a speaker, where several notes sound at once and the normal
// detector (YIN, one note at a time) says "no clear pitch".
// Pure maths, tested in tests/melody.test.js, measured in tools/melody-check.js.
//
// Method: harmonic summation "salience", from J. Salamon & E. Gómez (2012),
// "Melody extraction from polyphonic music signals using pitch contour
// characteristics", IEEE Trans. Audio, Speech and Language Processing 20(6),
// 1759–1770, section II-B (please check the parameter values against the paper):
//
//   0. The paper first applies an "equal loudness" filter, which mainly turns
//      down the low frequencies (bass, kick drum) and keeps 1–5 kHz, where a
//      voice's formants are. This app uses a simpler stand-in: a 2nd-order
//      Butterworth high-pass at 500 Hz (js/filters.js), applied to the spectrum
//      peaks' amplitudes. 500 Hz is this app's choice from tools/melody-check.js
//      (150, 300 and 500 Hz were tried). It turns down low FUNDAMENTALS too, but
//      the harmonic sum still finds the pitch from the harmonics above.
//   1. Spectrum of the latest sound; find its peaks (frequency fᵢ, amplitude aᵢ).
//   2. For every candidate pitch f0 (a grid of 10-cent steps), add up the
//      peaks that could be its harmonics h·f0:
//        S(f0) = Σᵢ Σₕ  g(δ, h) · aᵢ^β,   h = 1 … N_h
//        δ     = distance in semitones between fᵢ / h and f0 (only |δ| ≤ 1 counts)
//        g     = cos²(δ · π/2) · α^(h−1)
//      with N_h = 20, α = 0.8, β = 1, and only peaks within γ = 40 dB of the
//      loudest one. A pitch whose harmonics are all present and loud scores high.
//   3. The candidates are the local maxima of S. The paper then follows
//      whole "pitch contours" over time and picks the melody with rules about
//      their shape. THIS APP DOES MUCH LESS: it takes the strongest candidate,
//      preferring one close to the previous note (continuity), and says
//      "no melody" when the strongest salience is weak compared with recent
//      moments. These choices are this app's own, checked with tools/melody-check.js.
//
// It can't separate instruments, so expect it to follow a loud instrument
// line sometimes, and to jump an octave. Measured accuracy is in the README.
// ------------------------------------------------------------

import { computeSpectrum, findPeaks } from './spectrum.js';
import { levelDb } from './level.js';
import { biquadCoefficients, biquadGain } from './filters.js';
import { PitchSmoother } from './smoothing.js';

export const MELODY_DEFAULTS = Object.freeze({
  minHz: 100,          // the melody search range (a singing voice)
  maxHz: 1000,
  harmonics: 20,       // N_h  (Salamon & Gómez)
  alpha: 0.8,          // α    (Salamon & Gómez)
  beta: 1,             // β    (Salamon & Gómez)
  withinDb: 40,        // γ    (Salamon & Gómez)
  binCents: 10,        // grid step (Salamon & Gómez)
  maxPeaks: 40,        // spectrum peaks used (this app)
  peakMaxHz: 5000,     // highest peak used (this app)
  continuitySemitones: 3,   // prefer a candidate this close to the last note (this app)
  continuityBonus: 1.5,     // … if its salience is at least 1/1.5 of the best (this app)
  voicingRatio: 0.6,   // "melody" only if salience ≥ this × the recent typical (this app)
  preHighpassHz: 500,  // step 0 (this app's stand-in for the equal-loudness filter)
  windowSize: 4096,    // samples per reading (85 ms at 48 kHz)
});

// Salience on a grid: bin b is the pitch minHz · 2^(b · binCents / 1200).
export function salience(peaks, options = {}) {
  const o = { ...MELODY_DEFAULTS, ...options };
  const bins = Math.floor((1200 * Math.log2(o.maxHz / o.minHz)) / o.binCents) + 1;
  const s = new Float64Array(bins);
  const spread = Math.round(100 / o.binCents); // ±1 semitone in bins
  for (const { hz, amplitude } of peaks) {
    const a = amplitude ** o.beta;
    for (let h = 1; h <= o.harmonics; h++) {
      const f0 = hz / h;
      if (f0 < o.minHz / 1.06) break; // later harmonics give even lower f0
      if (f0 > o.maxHz * 1.06) continue;
      const centre = (1200 * Math.log2(f0 / o.minHz)) / o.binCents; // fractional bin
      const weight = o.alpha ** (h - 1) * a;
      for (let b = Math.ceil(centre - spread); b <= Math.floor(centre + spread); b++) {
        if (b < 0 || b >= bins) continue;
        const delta = ((b - centre) * o.binCents) / 100; // semitones
        s[b] += Math.cos((delta * Math.PI) / 2) ** 2 * weight;
      }
    }
  }
  return s;
}

export const binToHz = (b, options = {}) => {
  const o = { ...MELODY_DEFAULTS, ...options };
  return o.minHz * 2 ** ((b * o.binCents) / 1200);
};

// The local maxima of the salience, strongest first: [{ hz, salience }].
export function candidates(s, options = {}, count = 5) {
  const out = [];
  for (let b = 1; b < s.length - 1; b++) {
    if (s[b] > 0 && s[b] >= s[b - 1] && s[b] > s[b + 1]) {
      // Parabola through the three bins, for a pitch between grid steps.
      const curve = s[b - 1] - 2 * s[b] + s[b + 1];
      const offset = curve < 0 ? (0.5 * (s[b - 1] - s[b + 1])) / curve : 0;
      out.push({ hz: binToHz(b + offset, options), salience: s[b] });
    }
  }
  return out.sort((x, y) => y.salience - x.salience).slice(0, count);
}

// Peaks of a buffer's spectrum, as { hz, amplitude }.
// With the step-0 high-pass applied to each peak's amplitude (its gain at that
// frequency, from the filter formula), so there is no filter "start-up" in a
// short buffer and the browser and the measurements compute exactly the same.
export function spectralPeaks(samples, sampleRate, options = {}) {
  const o = { ...MELODY_DEFAULTS, ...options };
  const hp = o.preHighpassHz ? biquadCoefficients('highpass', o.preHighpassHz, sampleRate) : null;
  return findPeaks(computeSpectrum(samples, sampleRate), { count: o.maxPeaks, minHz: 50, maxHz: o.peakMaxHz, withinDb: o.withinDb, minDb: -100 })
    .map((p) => ({ hz: p.hz, amplitude: 10 ** (p.db / 20) * (hp ? biquadGain(hp, p.hz, sampleRate) : 1) }));
}

// Follows the melody over time. process() takes the newest samples (a power
// of two long, e.g. 4096) and returns { frequency (this reading), smoothed
// (median of the last 7, at least 4 with a pitch, as shown), salience, levelDb, reason }.
export class MelodyTracker {
  constructor(options = {}) {
    this.options = { ...MELODY_DEFAULTS, gateDb: -60, ...options };
    this.reset();
  }

  reset() {
    this.last = null;      // the last melody pitch (Hz) or null
    this.recent = [];      // the strongest salience of recent frames (for voicing)
    this.smoother = new PitchSmoother({ historySize: 7, minValid: 4 });
  }

  configure(changes) {
    this.options = { ...this.options, ...changes };
  }

  process(samples, sampleRate) {
    const r = this.detect(samples, sampleRate);
    return { ...r, smoothed: this.smoother.push(r.frequency) };
  }

  detect(samples, sampleRate) {
    const o = this.options;
    const db = levelDb(samples);
    if (db < o.gateDb) { this.last = null; return { frequency: null, salience: 0, levelDb: db, reason: 'quiet' }; }

    const found = candidates(salience(spectralPeaks(samples, sampleRate, o), o), o);
    if (!found.length) { this.last = null; return { frequency: null, salience: 0, levelDb: db, reason: 'unclear' }; }

    // Continuity: a strong-enough candidate near the last note beats a slightly stronger one far away.
    let pick = found[0];
    if (this.last) {
      const near = found.find((c) => Math.abs(12 * Math.log2(c.hz / this.last)) <= o.continuitySemitones);
      if (near && near.salience * o.continuityBonus >= found[0].salience) pick = near;
    }

    // Voicing: is this moment's salience strong compared with the last few seconds?
    // (Compare with the median of the recent strongest values, in the same units.)
    this.recent.push(pick.salience);
    if (this.recent.length > 300) this.recent.shift(); // ~5 s at 60 readings a second
    const typical = [...this.recent].sort((a, b) => a - b)[Math.floor(this.recent.length * 0.75)];
    if (pick.salience < o.voicingRatio * typical) { this.last = null; return { frequency: null, salience: pick.salience, levelDb: db, reason: 'unclear' }; }

    this.last = pick.hz;
    return { frequency: pick.hz, salience: pick.salience, levelDb: db, reason: null };
  }
}
