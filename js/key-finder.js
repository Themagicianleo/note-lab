// key-finder.js
// ------------------------------------------------------------
// Finding the musical KEY of what someone sings (or of a song).
// Pure maths, testable in Node (tests/key-finder.test.js).
//
// Method: Krumhansl–Schmuckler key finding.
//   1. Make a "pitch-class profile": how much of each of the 12 note names
//      (C, C♯, D … B, ignoring octave) was heard.
//   2. Compare it with the Krumhansl–Kessler profile of each of the 24 major
//      and minor keys, using the Pearson correlation r (−1 … 1).
//   3. The key with the highest r is the best match.
//
// Sources: C. L. Krumhansl & E. J. Kessler (1982), "Tracing the dynamic changes
// in perceived tonal organization in a spatial representation of musical keys",
// Psychological Review 89, 334–368 (the probe-tone profiles); the key-finding
// algorithm is described in C. L. Krumhansl, "Cognitive Foundations of Musical
// Pitch" (1990), ch. 4. Please check these profile numbers against that book.
// ------------------------------------------------------------

import { frequencyToNoteNumber, DEFAULT_A4 } from './pitch-math.js';

// How well each note name "fits" a key, from listeners' ratings (1–7 scale),
// starting at the key's tonic: index 0 = tonic, 7 = fifth, 4 = major third …
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Key names as musicians usually write them (flats for some keys).
const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
export const PITCH_CLASS_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const keyName = (tonic, mode) => `${(mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[tonic]} ${mode}`;

// Pearson correlation:  r = Σ(x − x̄)(y − ȳ) / √( Σ(x − x̄)² · Σ(y − ȳ)² )
// r = 1: same shape, 0: unrelated, −1: opposite. Returns 0 if either is flat.
export function pearson(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

// The profile of the key whose tonic is pitch class `tonic` (0 = C … 11 = B),
// as a value for every pitch class 0 … 11.
export const profileFor = (tonic, mode) =>
  Array.from({ length: 12 }, (_, pc) => (mode === 'major' ? KK_MAJOR : KK_MINOR)[(pc - tonic + 12) % 12]);

// Score all 24 keys against a 12-value pitch-class profile. Best first.
export function keyScores(histogram) {
  const scores = [];
  for (const mode of ['major', 'minor']) {
    for (let tonic = 0; tonic < 12; tonic++) {
      scores.push({ tonic, mode, name: keyName(tonic, mode), r: pearson(histogram, profileFor(tonic, mode)) });
    }
  }
  return scores.sort((a, b) => b.r - a.r);
}

// Relative keys share exactly the same notes (C major ↔ A minor): the minor
// key's tonic is 9 semitones above the major's (3 below).
export const relativeKey = ({ tonic, mode }) =>
  mode === 'major' ? { tonic: (tonic + 9) % 12, mode: 'minor' } : { tonic: (tonic + 3) % 12, mode: 'major' };

// ---------- from readings to a profile ----------
// A "reading" is { n, weight }: n = note number as a decimal (from
// frequencyToNoteNumber, e.g. 69.2 = A4 + 20 cents), weight = how much it counts
// (seconds it was sung, or loudness × seconds for a spectrum peak).

// Singers (and some recordings) are often a little sharp or flat as a whole.
// Estimate that overall offset as an average of every reading's distance from
// its nearest note. It's a CIRCULAR average (−50 and +50 cents are neighbours),
// done by treating each offset as an angle on a circle (100 cents = 360°).
// Returns cents, −50 … +50.
export function tuningOffsetCents(readings) {
  let x = 0, y = 0;
  for (const { n, weight } of readings) {
    const angle = 2 * Math.PI * (n - Math.round(n)); // 0 at a note's centre
    x += weight * Math.cos(angle);
    y += weight * Math.sin(angle);
  }
  if (x === 0 && y === 0) return 0;
  return (100 * Math.atan2(y, x)) / (2 * Math.PI);
}

// The 12-value profile: add each reading's weight to its pitch class, after
// removing the overall tuning offset (so a singer 40 cents flat still lands on
// the notes they meant).
export function pitchClassProfile(readings, offsetCents = 0) {
  const histogram = new Array(12).fill(0);
  for (const { n, weight } of readings) {
    const pc = ((Math.round(n - offsetCents / 100) % 12) + 12) % 12;
    histogram[pc] += weight;
  }
  return histogram;
}

// Convenience: frequency (Hz) → reading.
export const readingFrom = (frequency, weight, a4 = DEFAULT_A4) => ({ n: frequencyToNoteNumber(frequency, a4), weight });

// How sure: the gap between the best and the second-best key's r.
// These cut-offs are this app's own rule of thumb, chosen from tools/key-check.js
// (a 7-note phrase gave a gap of 0.01; full tunes 0.11–0.30). Not a standard.
export const SURE_GAP = 0.10;
export const PROBABLY_GAP = 0.05;

// Everything together: readings → { offset, histogram, scores }.
export function findKey(readings) {
  const offset = tuningOffsetCents(readings);
  const histogram = pitchClassProfile(readings, offset);
  return { offset, histogram, scores: keyScores(histogram) };
}
