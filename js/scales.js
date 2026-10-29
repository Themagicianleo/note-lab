// scales.js
// ------------------------------------------------------------
// Which notes belong to a scale, for the scale lines on the pitch monitor.
// Pure maths, testable in Node (tests/scales.test.js).
//
// A scale is a list of steps in semitones from its first note (the tonic).
// These are the standard textbook definitions, e.g. the major scale is
// whole–whole–half–whole–whole–whole–half = 0, 2, 4, 5, 7, 9, 11.
// Source: any music-theory primer, e.g. "The AB Guide to Music Theory"
// (E. Taylor, ABRSM, 1989), Part I, chapters 3–4 and 9 (scales, pentatonic).
// ------------------------------------------------------------

export const SCALES = Object.freeze({
  major:           { label: 'Major',             steps: [0, 2, 4, 5, 7, 9, 11] },
  naturalMinor:    { label: 'Natural minor',     steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor:   { label: 'Harmonic minor',    steps: [0, 2, 3, 5, 7, 8, 11] },
  majorPentatonic: { label: 'Major pentatonic',  steps: [0, 2, 4, 7, 9] },
  minorPentatonic: { label: 'Minor pentatonic',  steps: [0, 3, 5, 7, 10] },
  chromatic:       { label: 'Chromatic (all 12)', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
});

// The pitch classes (0 = C … 11 = B) in a scale, as a Set.
// scalePitchClasses(7, 'major') → G A B C D E F♯ → {7, 9, 11, 0, 2, 4, 6}
export function scalePitchClasses(tonic, scaleId) {
  const scale = SCALES[scaleId];
  if (!scale) return null;
  return new Set(scale.steps.map((s) => (tonic + s) % 12));
}

// Is note number n (a whole MIDI number, e.g. 67 = G4) in the scale?
export const inScale = (n, pitchClasses) => !pitchClasses || pitchClasses.has(((n % 12) + 12) % 12);

// The scale note nearest to a decimal note number, e.g. 61.3 in C major → 62 (D)
// (C♯ isn't in C major). Ties go down. Without a scale: the nearest note.
export function nearestScaleNote(n, pitchClasses) {
  const nearest = Math.round(n);
  if (!pitchClasses) return nearest;
  for (let d = 0; d <= 6; d++) {
    const below = Math.round(n - d);
    const above = Math.round(n + d);
    const candidates = [below, above].filter((m) => inScale(m, pitchClasses));
    if (candidates.length) return candidates.sort((a, b) => Math.abs(n - a) - Math.abs(n - b) || a - b)[0];
  }
  return nearest;
}

// The Key finder answers "C major" or "A minor": map that to a scale id.
export const scaleForMode = (mode) => (mode === 'major' ? 'major' : 'naturalMinor');
