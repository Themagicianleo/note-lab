// spectrum.js
// ------------------------------------------------------------
// Turns a buffer of sound into a spectrum: how loud each frequency is.
// Pure maths, testable in Node.
//
// Steps:
//   1. Window: fade the buffer in and out (a "Hann" window). Without this,
//      the sudden start and end of the buffer smear energy across all
//      frequencies ("spectral leakage").
//   2. FFT: measure how much of each frequency bin is present.
//   3. Scale so that a sine wave of amplitude A reads 20·log10(A) dBFS.
//      So a full-scale sine reads 0 dBFS, and half that (0.5) reads −6 dBFS.
//
// Note: the level meter shows the RMS level of the WHOLE sound. A sine wave's
// RMS is 3 dB below its peak amplitude, so a sine that peaks at −6 dBFS in
// the spectrum shows about −9 dBFS on the level meter. Both are correct;
// they measure different things.
// ------------------------------------------------------------

import { fft } from './fft.js';

export const MIN_SPECTRUM_DB = -140; // floor instead of −∞

// Common names for parts of the frequency range, as used when talking about EQ.
// The edges are conventions (different books draw them slightly differently),
// not exact physical boundaries.
export const EQ_BANDS = [
  { name: 'Sub-bass', from: 20, to: 60, hint: 'Felt more than heard: deep rumble, the thump of a kick drum.' },
  { name: 'Bass', from: 60, to: 250, hint: 'Warmth and fullness: bass notes, the low end of piano and men\'s voices.' },
  { name: 'Low mids', from: 250, to: 500, hint: 'Body. Too much sounds muddy or boxy.' },
  { name: 'Mids', from: 500, to: 2000, hint: 'Where most instruments and vowel sounds live.' },
  { name: 'Upper mids', from: 2000, to: 4000, hint: 'Clarity and bite. Our ears are most sensitive here.' },
  { name: 'Presence', from: 4000, to: 6000, hint: 'Closeness and definition. Too much sounds harsh.' },
  { name: 'Brilliance', from: 6000, to: 20000, hint: 'Air and sparkle: cymbals, and the hiss of "s" sounds.' },
];

export function bandFor(hz) {
  return EQ_BANDS.find((b) => hz >= b.from && hz < b.to) || null;
}

// Hann window: 0 at both ends, 1 in the middle. Cached per size.
const windows = new Map();
function hannWindow(n) {
  if (!windows.has(n)) {
    const w = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      sum += w[i];
    }
    windows.set(n, { w, sum });
  }
  return windows.get(n);
}

// samples: power-of-two length. Returns { db, binHz }:
//   db[k]  – level of bin k in dBFS (k = 0 … N/2)
//   binHz  – the width of one bin in Hz (bin k is at k × binHz)
export function computeSpectrum(samples, sampleRate) {
  const n = samples.length;
  const { w, sum } = hannWindow(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i] * w[i];

  fft(re, im);

  // A sine of amplitude A gives a bin of size A × sum(window) / 2, so
  // dividing by sum/2 gets back to A.
  const db = new Float32Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) {
    const amplitude = (Math.hypot(re[k], im[k]) * 2) / sum;
    db[k] = amplitude > 0 ? Math.max(MIN_SPECTRUM_DB, 20 * Math.log10(amplitude)) : MIN_SPECTRUM_DB;
  }
  return { db, binHz: sampleRate / n };
}

// Find the loudest peaks. Returns [{ hz, db }], loudest first.
//   count      – how many peaks to return
//   minHz/maxHz – only look in this range
//   withinDb   – ignore peaks more than this far below the loudest one
//   minDb      – ignore peaks quieter than this (background noise)
export function findPeaks({ db, binHz }, { count = 5, minHz = 20, maxHz = 20000, withinDb = 50, minDb = -90 } = {}) {
  const first = Math.max(1, Math.ceil(minHz / binHz));
  const last = Math.min(db.length - 2, Math.floor(maxHz / binHz));

  // Every local maximum ("hill top"), refined between bins with a parabola.
  const candidates = [];
  for (let k = first; k <= last; k++) {
    const a = db[k - 1], b = db[k], c = db[k + 1];
    if (b > a && b >= c && b > minDb) {
      const curve = a - 2 * b + c;
      const offset = curve < 0 ? (0.5 * (a - c)) / curve : 0; // −0.5 … +0.5 bins
      candidates.push({ bin: k, hz: (k + offset) * binHz, db: b - 0.25 * (a - c) * offset });
    }
  }
  candidates.sort((x, y) => y.db - x.db);

  // Keep the loudest, skipping anything within 4 bins of a peak already kept.
  // (A single sine also makes small "side lobes" right next to its peak; this
  // rule stops them being listed as separate frequencies.)
  const peaks = [];
  for (const p of candidates) {
    if (peaks.length >= count) break;
    if (peaks.length && p.db < peaks[0].db - withinDb) break;
    if (peaks.some((q) => Math.abs(q.bin - p.bin) <= 4)) continue;
    peaks.push(p);
  }
  return peaks.map(({ hz, db: level }) => ({ hz, db: level }));
}

// "Peak hold": remembers the highest level each bin reached recently and lets
// it fall slowly (decayDbPerSecond), so short loud moments stay visible.
export class PeakHold {
  constructor(decayDbPerSecond = 20) {
    this.decay = decayDbPerSecond;
    this.levels = null;
  }

  update(db, elapsedMs) {
    if (!this.levels || this.levels.length !== db.length) {
      this.levels = Float32Array.from(db);
      return this.levels;
    }
    const drop = (this.decay * elapsedMs) / 1000;
    for (let k = 0; k < db.length; k++) this.levels[k] = Math.max(db[k], this.levels[k] - drop);
    return this.levels;
  }

  reset() {
    this.levels = null;
  }
}
