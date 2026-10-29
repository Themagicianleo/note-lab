// pitch-stats.js
// ------------------------------------------------------------
// Statistics of a pitch line (the readings on the pitch monitor), so you can
// see how in tune your singing was. Pure maths, tested in tests/pitch-stats.test.js.
//
// Input: readings { t (ms), hz (Hz or null) }, oldest first, as kept by
// js/pitch-history.js. Only the PITCH NUMBERS are used; no audio.
//
// For each reading with a pitch:
//   n      = 69 + 12·log2(hz / A4)           (note number, a decimal)
//   target = the nearest note (or the nearest note of the chosen scale)
//   cents  = 100 · (n − target)               (how far off; + sharp, − flat)
//
// Each reading counts for the time until the next one (capped at MAX_STEP_MS,
// so a pause in the readings doesn't count as long singing). So results are
// "fractions of singing TIME", the same on fast and slow phones.
//
// The ±10 and ±25 cent bands are this app's own choice for a quick summary,
// not a standard. Smaller is stricter.
// ------------------------------------------------------------

import { frequencyToNoteNumber, DEFAULT_A4 } from './pitch-math.js';
import { nearestScaleNote } from './scales.js';

export const MAX_STEP_MS = 100;
export const BANDS = [10, 25];

export function pitchStats(readings, { a4 = DEFAULT_A4, pitchClasses = null } = {}) {
  let voiced = 0;          // seconds with a pitch
  let total = 0;           // seconds covered by readings
  const within = BANDS.map(() => 0);
  let sumCents = 0;
  let sumAbsCents = 0;
  let lowest = null;
  let highest = null;
  const noteTime = new Map(); // target note → seconds

  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const next = readings[i + 1];
    // Time this reading stands for (the last reading: a typical step).
    const stepMs = next ? Math.min(MAX_STEP_MS, next.t - r.t) : Math.min(MAX_STEP_MS, i > 0 ? r.t - readings[i - 1].t : 0);
    const dt = Math.max(0, stepMs) / 1000;
    total += dt;
    if (!(r.hz > 0)) continue;

    const n = frequencyToNoteNumber(r.hz, a4);
    const target = nearestScaleNote(n, pitchClasses);
    const cents = 100 * (n - target);
    voiced += dt;
    BANDS.forEach((band, k) => { if (Math.abs(cents) <= band) within[k] += dt; });
    sumCents += cents * dt;
    sumAbsCents += Math.abs(cents) * dt;
    noteTime.set(target, (noteTime.get(target) || 0) + dt);
    // Lowest/highest: the note actually sung (nearest note), not the scale target.
    const sung = Math.round(n);
    if (lowest === null || sung < lowest) lowest = sung;
    if (highest === null || sung > highest) highest = sung;
  }

  if (voiced === 0) {
    return { total, voiced: 0, within: BANDS.map((band) => ({ band, fraction: null })), meanCents: null, meanAbsCents: null, lowest: null, highest: null, mostSung: null };
  }
  let mostSung = null;
  for (const [note, seconds] of noteTime) if (!mostSung || seconds > mostSung.seconds) mostSung = { note, seconds };
  return {
    total,
    voiced,
    within: BANDS.map((band, k) => ({ band, fraction: within[k] / voiced })),
    meanCents: sumCents / voiced,       // average: + means sharp overall, − flat
    meanAbsCents: sumAbsCents / voiced, // average distance, ignoring direction
    lowest,
    highest,
    mostSung,
  };
}
