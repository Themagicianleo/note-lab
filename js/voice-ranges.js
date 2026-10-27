// voice-ranges.js
// ------------------------------------------------------------
// Detection range presets for voice mode.
//
// The pitch detector only searches between minHz and maxHz. Narrowing that
// search to where your voice actually is helps in two ways:
//   1. Answers outside the range are impossible. A reading an octave below a
//      low voice, or a high harmonic above a high voice, cannot be picked.
//   2. Less work: fewer "shifts" to try, so each reading is faster.
// The catch: if the range does NOT cover your voice, the detector can be
// forced into a wrong answer (for example an octave below a too-high note),
// so choose a range that includes all of your notes.
//
// Typical ranges (they vary a lot from person to person):
//   speaking: men ≈ 85–155 Hz, women ≈ 165–255 Hz
//   singing:  bass E2–E4, baritone A2–A4, tenor C3–C5, alto F3–F5, soprano C4–C6
// ------------------------------------------------------------

import { frequencyToNote } from './pitch-math.js';

export const VOICE_PRESETS = {
  low: { label: 'Low voice', minHz: 65, maxHz: 500, hint: 'bass, baritone, most men speaking' },
  mid: { label: 'Mid voice', minHz: 100, maxHz: 800, hint: 'tenor, alto, most women speaking' },
  high: { label: 'High voice', minHz: 150, maxHz: 1200, hint: 'soprano, children' },
};

// Limits for a custom range.
//   40 Hz:   below this a 2048-sample window cannot see a whole repeat twice.
//   2000 Hz: well above the highest sung notes.
//   ×1.5:    max must be at least 1.5 × min (about 7 semitones), or
//            ordinary singing would keep falling outside the range.
export const RANGE_LIMITS = { minHz: 40, maxHz: 2000, minRatio: 1.5 };

// Check a custom range typed in by the user.
// Returns { ok: true, minHz, maxHz } or { ok: false, error: 'plain message' }.
export function validateCustomRange(minHz, maxHz) {
  const min = Number(minHz);
  const max = Number(maxHz);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { ok: false, error: 'Please enter numbers for both minimum and maximum.' };
  }
  if (min < RANGE_LIMITS.minHz) {
    return { ok: false, error: `The minimum can't be lower than ${RANGE_LIMITS.minHz} Hz.` };
  }
  if (max > RANGE_LIMITS.maxHz) {
    return { ok: false, error: `The maximum can't be higher than ${RANGE_LIMITS.maxHz} Hz.` };
  }
  if (max < min * RANGE_LIMITS.minRatio) {
    return { ok: false, error: `The maximum must be at least ${RANGE_LIMITS.minRatio} × the minimum (here ${Math.ceil(min * RANGE_LIMITS.minRatio)} Hz).` };
  }
  return { ok: true, minHz: min, maxHz: max };
}

// "C2 (65 Hz) – B4 (500 Hz)", the nearest note names, to help beginners.
export function describeRange(minHz, maxHz, a4) {
  const name = (hz) => {
    const n = frequencyToNote(hz, a4);
    return `${n.name}${n.octave} (${Math.round(hz)} Hz)`;
  };
  return `${name(minHz)} – ${name(maxHz)}`;
}
