// range-finder.js
// ------------------------------------------------------------
// Remembers your lowest and highest STABLE notes.
//
// "Stable" means you stayed on the same note for at least `holdMs`
// (0.3 s by default). This ignores slides, cracks and one-off wrong
// readings, which would otherwise make your range look bigger than it is.
//
// Staying "on the same note" allows some wobble: you may drift up to
// `toleranceCents` (70 cents) away from the note's centre, so vibrato
// (often ±20–50 cents) doesn't break the hold.
// ------------------------------------------------------------

import { frequencyToNoteNumber, DEFAULT_A4 } from './pitch-math.js';

export class RangeFinder {
  constructor({ holdMs = 300, toleranceCents = 70, a4 = DEFAULT_A4 } = {}) {
    this.holdMs = holdMs;
    this.toleranceCents = toleranceCents;
    this.a4 = a4;
    this.reset();
  }

  reset() {
    this.lowest = null;    // lowest stable note number, e.g. 43 = G2
    this.highest = null;   // highest stable note number
    this.candidate = null; // the note being held right now: { note, since, counted }
  }

  // Give it each smoothed reading (Hz or null) with the time in milliseconds.
  // Returns true when a new lowest or highest note was just recorded.
  push(frequency, timeMs) {
    if (!(frequency > 0)) {
      this.candidate = null; // silence or no clear pitch breaks the hold
      return false;
    }

    const n = frequencyToNoteNumber(frequency, this.a4); // e.g. 57.08 = A3 + 8 cents
    const c = this.candidate;
    const sameNote = c && Math.abs(n - c.note) * 100 <= this.toleranceCents;

    if (!sameNote) {
      this.candidate = { note: Math.round(n), since: timeMs, counted: false };
      return false;
    }

    if (!c.counted && timeMs - c.since >= this.holdMs) {
      c.counted = true; // count each held note once
      let changed = false;
      if (this.lowest === null || c.note < this.lowest) { this.lowest = c.note; changed = true; }
      if (this.highest === null || c.note > this.highest) { this.highest = c.note; changed = true; }
      return changed;
    }
    return false;
  }

  // Range size in semitones, or null if nothing recorded yet.
  get semitones() {
    return this.lowest === null ? null : this.highest - this.lowest;
  }
}

// 19 → "1 octave + 7 semitones", 24 → "2 octaves", 5 → "5 semitones"
export function describeSpan(semitones) {
  if (semitones === null) return '';
  const octaves = Math.floor(semitones / 12);
  const rest = semitones % 12;
  const parts = [];
  if (octaves) parts.push(`${octaves} octave${octaves > 1 ? 's' : ''}`);
  if (rest || !octaves) parts.push(`${rest} semitone${rest === 1 ? '' : 's'}`);
  return parts.join(' + ');
}

// A guided two-step range test (Voice tab → "Range test"):
//   step 'low'  – slide down to your lowest comfortable note: we keep the LOWEST held note
//   step 'high' – slide up to your highest: we keep the HIGHEST held note
//   step 'done' – result: { lowest, highest, semitones }
// Each step uses its own RangeFinder, so warming up in the middle of your
// range during step 1 doesn't affect step 2 and the other way round.
export class RangeTest {
  constructor({ a4 = DEFAULT_A4 } = {}) {
    this.a4 = a4;
    this.step = 'idle';
  }

  start() {
    this.step = 'low';
    this.low = new RangeFinder({ a4: this.a4 });
    this.high = new RangeFinder({ a4: this.a4 });
  }

  // Go to the next step. Returns the new step.
  next() {
    this.step = this.step === 'low' ? 'high' : 'done';
    return this.step;
  }

  push(frequency, timeMs) {
    if (this.step === 'low') return this.low.push(frequency, timeMs);
    if (this.step === 'high') return this.high.push(frequency, timeMs);
    return false;
  }

  get lowest() { return this.low ? this.low.lowest : null; }
  get highest() { return this.high ? this.high.highest : null; }
  get semitones() { return this.lowest === null || this.highest === null ? null : this.highest - this.lowest; }
}
