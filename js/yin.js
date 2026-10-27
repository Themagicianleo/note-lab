// yin.js
// ------------------------------------------------------------
// The YIN pitch detector (de Cheveigné & Kawahara, 2002).
// Pure maths: give it a short piece of sound (samples), get back a pitch.
// No browser code, so it can be tested with Node on generated signals.
//
// The idea in plain language:
//   A pitched sound repeats itself. If we shift it in time by exactly one
//   repeat (one "period"), the shifted copy lines up with the original.
//   YIN tries many shifts ("lags", counted in samples) and measures how
//   DIFFERENT the sound is from its shifted copy. The first shift where the
//   difference is very small is the period. Frequency = sampleRate / period.
//
// Steps (numbers match the comments below):
//   1. Difference: for each lag, add up (x[j] − x[j + lag])².
//   2. Normalise: divide by the average difference of all smaller lags,
//      so the score is around 1 for "no match" and near 0 for "perfect match".
//   3. Threshold: take the FIRST lag whose score drops below the threshold,
//      then slide down to the bottom of that dip. Taking the first good dip
//      (not the deepest) is what avoids most "octave too low" mistakes.
//   4. Interpolate: fit a parabola through the dip to find the lag between
//      whole samples. That gives a much more precise frequency.
//   5. Confidence: 1 − score at the dip. Near 1 = clearly pitched.
// ------------------------------------------------------------

// Default settings. They are a starting point and are checked by tests/evaluate.js.
export const YIN_DEFAULTS = {
  minHz: 50,        // lowest pitch to look for
  maxHz: 1500,      // highest pitch to look for
  // A dip must go below this to count. The YIN paper uses 0.10. On our test
  // signals 0.15 read a sung E4 as E5 (its 2nd harmonic was ~6× louder than
  // the fundamental); 0.10 fixed that and found pitch just as often elsewhere.
  threshold: 0.10,
};

// Detect the pitch of `samples` (an array of numbers between −1 and +1).
// Returns { frequency, confidence }:
//   frequency  – pitch in Hz, or null if there is no clear pitch
//   confidence – 0..1, how periodic (note-like) the sound is
export function detectPitchYin(samples, sampleRate, options = {}) {
  const { minHz, maxHz, threshold } = { ...YIN_DEFAULTS, ...options };

  // Lags to search. A high pitch has a short period (small lag), a low pitch a long one.
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  // We need room for the lag plus a comparison window, so use at most half the buffer.
  const maxLag = Math.min(Math.ceil(sampleRate / minHz), Math.floor(samples.length / 2));
  const windowSize = samples.length - maxLag; // how many samples we compare at each lag

  if (maxLag <= minLag + 1) return { frequency: null, confidence: 0 };

  // 1. Difference function d(lag)
  const diff = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1 && lag + windowSize <= samples.length; lag++) {
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const delta = samples[j] - samples[j + lag];
      sum += delta * delta;
    }
    diff[lag] = sum;
  }

  // 2. Cumulative mean normalised difference d'(lag)
  const norm = new Float32Array(maxLag + 2);
  norm[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag < norm.length; lag++) {
    runningSum += diff[lag];
    norm[lag] = runningSum > 0 ? (diff[lag] * lag) / runningSum : 1;
  }

  // 3. Absolute threshold: first lag (from the short end) that dips below it
  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (norm[lag] < threshold) {
      // Slide down to the bottom of this dip.
      while (lag + 1 <= maxLag && norm[lag + 1] < norm[lag]) lag++;
      bestLag = lag;
      break;
    }
  }

  if (bestLag === -1) {
    // Nothing was clear enough. Report how close the best dip came, but no pitch.
    let lowest = 1;
    for (let lag = minLag; lag <= maxLag; lag++) lowest = Math.min(lowest, norm[lag]);
    return { frequency: null, confidence: Math.max(0, 1 - lowest) };
  }

  // 4. Parabolic interpolation around the dip
  const refinedLag = parabolicMinimum(norm, bestLag);

  return {
    frequency: sampleRate / refinedLag,
    confidence: Math.max(0, Math.min(1, 1 - norm[bestLag])), // 5.
  };
}

// Fit a parabola through three points (lag−1, lag, lag+1) and return
// where its lowest point is. This finds the dip "between" whole samples.
export function parabolicMinimum(values, index) {
  if (index <= 0 || index >= values.length - 1) return index;
  const left = values[index - 1];
  const centre = values[index];
  const right = values[index + 1];
  const curvature = left - 2 * centre + right;
  if (curvature <= 0) return index; // not a proper dip shape; keep the whole-sample answer
  return index + (left - right) / (2 * curvature);
}
