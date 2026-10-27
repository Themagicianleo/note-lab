// pitch-math.js
// ------------------------------------------------------------
// Pure maths for converting between frequency (Hz) and musical notes.
// No audio, no browser code, so it can be tested on its own with Node.
//
// The standard equal-temperament formulas used here:
//
//   note number  n = 69 + 12 × log2(f / A4)
//   frequency    f = A4 × 2^((n − 69) / 12)
//   cents        c = 100 × (n − nearest whole n)
//
// "Note number" is the MIDI numbering: A4 = 69, middle C (C4) = 60.
// Each step of 1 is one semitone (one piano key).
// A4 is the reference pitch, 440 Hz by default, and can be changed.
// ------------------------------------------------------------

export const DEFAULT_A4 = 440;

// The 12 note names in one octave, starting from C.
// Index 0 = C, 1 = C#, ... 9 = A, 11 = B.
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Flat names that mean the same key as a sharp name (for example Bb = A#).
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

// A frequency is usable only if it is a real, positive, finite number.
function isValidFrequency(freq) {
  return typeof freq === 'number' && Number.isFinite(freq) && freq > 0;
}

// Frequency (Hz) → note number, as a decimal.
// Example: 440 Hz → 69, 330 Hz → 64.0196 (just above E4 = 64).
export function frequencyToNoteNumber(freq, a4 = DEFAULT_A4) {
  if (!isValidFrequency(freq) || !isValidFrequency(a4)) return NaN;
  return 69 + 12 * Math.log2(freq / a4);
}

// Note number → frequency (Hz). Works for decimal note numbers too.
// Example: 69 → 440 Hz, 60 → 261.6256 Hz.
export function noteNumberToFrequency(noteNumber, a4 = DEFAULT_A4) {
  return a4 * Math.pow(2, (noteNumber - 69) / 12);
}

// Whole note number → name and octave.
// Example: 64 → { name: 'E', octave: 4 }.
export function noteNumberToName(noteNumber) {
  const m = Math.round(noteNumber);
  // ((m % 12) + 12) % 12 keeps the index between 0 and 11 even for negative m.
  const name = NOTE_NAMES[((m % 12) + 12) % 12];
  // Octave numbers change at C. Note number 60 (C4) / 12 = 5, minus 1 = 4.
  const octave = Math.floor(m / 12) - 1;
  return { name, octave };
}

// Name and octave → whole note number.
// Accepts sharps ('C#') and flats ('Db'). Returns NaN for an unknown name.
// Example: ('A', 4) → 69.
export function nameToNoteNumber(name, octave) {
  const sharpName = FLAT_TO_SHARP[name] || name;
  const index = NOTE_NAMES.indexOf(sharpName);
  if (index === -1 || !Number.isInteger(octave)) return NaN;
  return (octave + 1) * 12 + index;
}

// Name and octave → frequency (Hz).
// Example: ('E', 4) → 329.628 Hz.
export function noteToFrequency(name, octave, a4 = DEFAULT_A4) {
  return noteNumberToFrequency(nameToNoteNumber(name, octave), a4);
}

// How many cents f2 is above f1 (negative means below).
// 100 cents = 1 semitone, 1200 cents = 1 octave.
// Example: centsBetween(440, 880) → 1200.
export function centsBetween(f1, f2) {
  if (!isValidFrequency(f1) || !isValidFrequency(f2)) return NaN;
  return 1200 * Math.log2(f2 / f1);
}

// The main function: frequency → everything the display needs.
// Returns null if the frequency is not usable (0, negative, NaN, ...),
// so the app can show "no clear note" instead of nonsense.
//
// Example: frequencyToNote(330) →
//   { name: 'E', octave: 4, noteNumber: 64, cents: 1.955...,
//     frequency: 330, targetFrequency: 329.628... }
export function frequencyToNote(freq, a4 = DEFAULT_A4) {
  const n = frequencyToNoteNumber(freq, a4);
  if (Number.isNaN(n)) return null;

  const nearest = Math.round(n);          // closest whole note
  const cents = 100 * (n - nearest);      // how far from it, −50 to +50
  const { name, octave } = noteNumberToName(nearest);

  return {
    name,
    octave,
    noteNumber: nearest,
    cents,
    frequency: freq,
    targetFrequency: noteNumberToFrequency(nearest, a4), // the "perfectly in tune" frequency
  };
}

// Turn a result from frequencyToNote into display text.
// Example: "E4 · 330.0 Hz · +2 cents".
// Cents are rounded to whole numbers; "0 cents" has no sign.
export function formatNote(note) {
  if (!note) return 'No clear note';
  let cents = Math.round(note.cents);
  if (cents === 0) cents = 0; // turns −0 into 0 so we never show "-0"
  const sign = cents > 0 ? '+' : '';
  return `${note.name}${note.octave} · ${note.frequency.toFixed(1)} Hz · ${sign}${cents} cents`;
}
