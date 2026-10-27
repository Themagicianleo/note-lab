// autocorrelation.js
// ------------------------------------------------------------
// A simple autocorrelation pitch detector. The app does NOT use this.
// It is here only so tools/evaluate.js can compare it with YIN on the
// same test files.
//
// The idea in plain language:
//   Multiply the sound by a shifted copy of itself and add it all up.
//   When the shift equals one period, peaks line up with peaks, so the
//   total is large. We pick the shift with the largest total.
//
// Steps:
//   1. For each lag, compute the normalised correlation (−1..+1):
//        sum(x[j] × x[j+lag]) / sqrt(sum(x[j]²) × sum(x[j+lag]²))
//   2. Skip the first hump (small lags always match well), i.e. wait until
//      the correlation has dropped below zero once.
//   3. Take the highest peak after that.
//   4. Parabolic interpolation for precision, as in YIN.
//   5. The peak height is the confidence; below `minClarity` = no pitch.
//
// Its known weakness: shifts of 2, 3, … periods ALSO line up, and can
// score almost as high, so it can jump an octave (or more) too low.
// ------------------------------------------------------------

import { parabolicMinimum } from './yin.js';

export const AUTOCORRELATION_DEFAULTS = { minHz: 50, maxHz: 1500, minClarity: 0.85 };

export function detectPitchAutocorrelation(samples, sampleRate, options = {}) {
  const { minHz, maxHz, minClarity } = { ...AUTOCORRELATION_DEFAULTS, ...options };
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), Math.floor(samples.length / 2));
  const windowSize = samples.length - maxLag;

  // 1. Normalised correlation for every lag up to maxLag + 1
  const corr = new Float32Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let product = 0, energyA = 0, energyB = 0;
    for (let j = 0; j < windowSize; j++) {
      const a = samples[j];
      const b = samples[j + lag];
      product += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    corr[lag] = energyA > 0 && energyB > 0 ? product / Math.sqrt(energyA * energyB) : 0;
  }

  // 2. Find where the first hump ends (correlation goes below zero)
  let start = 1;
  while (start <= maxLag && corr[start] > 0) start++;
  start = Math.max(start, minLag);

  // 3. Highest peak after that
  let bestLag = -1;
  let bestValue = -1;
  for (let lag = start; lag <= maxLag; lag++) {
    if (corr[lag] > bestValue) {
      bestValue = corr[lag];
      bestLag = lag;
    }
  }

  if (bestLag === -1 || bestValue < minClarity) {
    return { frequency: null, confidence: Math.max(0, bestValue) };
  }

  // 4. Interpolate. parabolicMinimum finds a dip, so flip the sign to find a peak.
  const flipped = corr.map((v) => -v);
  const refinedLag = parabolicMinimum(flipped, bestLag);

  return { frequency: sampleRate / refinedLag, confidence: bestValue };
}
