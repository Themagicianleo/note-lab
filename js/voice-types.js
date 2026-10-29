// voice-types.js
// ------------------------------------------------------------
// A ROUGH voice-type guess from a range test. Pure maths, tested in
// tests/voice-types.test.js.
//
// Typical ranges of the six main classical voice types, as listed in the
// Wikipedia articles "Voice type", "Soprano", "Mezzo-soprano", "Contralto",
// "Tenor", "Baritone" and "Bass (voice type)" (checked against them when this
// was written; sources differ by a note or two, please verify).
//
// Voice teachers classify voices by much more than range: where the voice
// sounds most comfortable (tessitura), its tone colour (timbre) and where it
// changes register. So this is a practice reference, not a diagnosis.
// ------------------------------------------------------------

// Note numbers: 60 = C4 (middle C).
export const VOICE_TYPES = Object.freeze([
  { id: 'bass',     label: 'Bass',          low: 40, high: 64 }, // E2–E4
  { id: 'baritone', label: 'Baritone',      low: 45, high: 69 }, // A2–A4
  { id: 'tenor',    label: 'Tenor',         low: 48, high: 72 }, // C3–C5
  { id: 'contralto', label: 'Contralto',    low: 53, high: 77 }, // F3–F5
  { id: 'mezzo',    label: 'Mezzo-soprano', low: 57, high: 81 }, // A3–A5
  { id: 'soprano',  label: 'Soprano',       low: 60, high: 84 }, // C4–C6
]);

// Fewer semitones than this, and the test can't tell types apart.
export const MIN_TEST_SEMITONES = 7;

// How many semitones two ranges share (0 if none).
export const overlap = (aLow, aHigh, bLow, bHigh) => Math.max(0, Math.min(aHigh, bHigh) - Math.max(aLow, bLow));

// Rank the voice types for a found range (lowest and highest note numbers).
// Best first: the most shared semitones; on a tie, the type whose middle
// is closest to the middle of your range.
// Returns null if the range is too small to say anything.
export function rankVoiceTypes(lowest, highest) {
  if (lowest === null || highest === null || highest - lowest < MIN_TEST_SEMITONES) return null;
  const middle = (lowest + highest) / 2;
  return VOICE_TYPES.map((v) => ({
    ...v,
    shared: overlap(lowest, highest, v.low, v.high),
    centreDistance: Math.abs((v.low + v.high) / 2 - middle),
  })).sort((a, b) => b.shared - a.shared || a.centreDistance - b.centreDistance);
}
