// ear-training.js
// ------------------------------------------------------------
// The logic behind the ear-training exercises (no sound, no page code, so it
// can be tested in Node):
//   • note sets and intervals to practise
//   • making random questions
//   • a score book that counts right/wrong answers per note or interval
//   • a judge for the sing-back exercise: waits for a steady sung note and
//     says how many cents it is from the target
// ------------------------------------------------------------

import { nameToNoteNumber, noteNumberToName, frequencyToNoteNumber, DEFAULT_A4 } from './pitch-math.js';

// ---------- note sets for "guess the note" ----------

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const naturals = (notes) => notes.filter((n) => !noteNumberToName(n).name.includes('#'));

export const NOTE_SETS = {
  'c-major': { label: 'C major scale, one octave (C4–B4, white keys)', notes: naturals(range(60, 71)) },
  chromatic: { label: 'All 12 notes, one octave (C4–B4)', notes: range(60, 71) },
  'two-octaves': { label: 'All 12 notes, two octaves (C3–B4); answer the name only', notes: range(48, 71) },
};

// The note name a learner answers with, e.g. 61 → "C#".
export const noteLetter = (noteNumber) => noteNumberToName(noteNumber).name;
// e.g. 61 → "C#4"
export const noteLabel = (noteNumber) => {
  const { name, octave } = noteNumberToName(noteNumber);
  return `${name}${octave}`;
};

// ---------- intervals ----------
// "Memory aid" songs are commonly used by music teachers to recognise
// intervals; they're hints, not rules.
export const INTERVALS = [
  { semitones: 1, name: 'minor 2nd', short: 'm2', hint: 'the "Jaws" theme' },
  { semitones: 2, name: 'major 2nd', short: 'M2', hint: '"Happy Birthday" (Hap-py → Birth)' },
  { semitones: 3, name: 'minor 3rd', short: 'm3', hint: '"Greensleeves" (first two notes)' },
  { semitones: 4, name: 'major 3rd', short: 'M3', hint: '"When the Saints Go Marching In" (Oh → when)' },
  { semitones: 5, name: 'perfect 4th', short: 'P4', hint: '"Here Comes the Bride"' },
  { semitones: 6, name: 'tritone', short: 'TT', hint: '"The Simpsons" theme (The → Simp)' },
  { semitones: 7, name: 'perfect 5th', short: 'P5', hint: '"Twinkle Twinkle Little Star" (Twin-kle → twin-kle)' },
  { semitones: 8, name: 'minor 6th', short: 'm6', hint: '"The Entertainer" (a jump in the opening run)' },
  { semitones: 9, name: 'major 6th', short: 'M6', hint: '"My Bonnie Lies Over the Ocean" (My → Bon)' },
  { semitones: 10, name: 'minor 7th', short: 'm7', hint: '"Somewhere" from West Side Story (There\'s a)' },
  { semitones: 11, name: 'major 7th', short: 'M7', hint: '"Take On Me" chorus (Take → on)' },
  { semitones: 12, name: 'octave', short: 'P8', hint: '"Somewhere Over the Rainbow" (Some → where)' },
];
export const DEFAULT_INTERVALS = [2, 4, 5, 7, 12]; // a gentle start: M2, M3, P4, P5, octave
export const intervalBySemitones = (s) => INTERVALS.find((i) => i.semitones === s);

// ---------- questions ----------
// `random` returns 0 ≤ x < 1 (Math.random by default; tests pass a fixed one).

export function pick(list, random = Math.random) {
  return list[Math.floor(random() * list.length)];
}

// A "guess the note" question. Avoids asking the same note twice in a row.
export function makeNoteQuestion(setKey, previous = null, random = Math.random) {
  const notes = NOTE_SETS[setKey].notes;
  let note = pick(notes, random);
  if (notes.length > 1) {
    for (let tries = 0; note === previous && tries < 10; tries++) note = pick(notes, random);
  }
  return { note };
}

// An interval question: two notes `semitones` apart.
//   direction: 'up' (low then high), 'down' (high then low), 'together' (both at once)
// The lower note is chosen so both notes stay between C3 (48) and C5 (72).
export function makeIntervalQuestion(allowed, direction = 'up', random = Math.random) {
  const semitones = pick(allowed, random);
  const lowest = 48;
  const highest = 72 - semitones;
  const low = lowest + Math.floor(random() * (highest - lowest + 1));
  const high = low + semitones;
  const [first, second] = direction === 'down' ? [high, low] : [low, high];
  return { semitones, first, second, together: direction === 'together' };
}

// Notes to choose a sing-back target from, for each voice preset:
// a comfortable middle part of the range, natural notes only.
export const SING_TARGETS = {
  low: naturals(range(nameToNoteNumber('G', 2), nameToNoteNumber('D', 4))),
  mid: naturals(range(nameToNoteNumber('C', 3), nameToNoteNumber('G', 4))),
  high: naturals(range(nameToNoteNumber('A', 3), nameToNoteNumber('E', 5))),
};

// ---------- score book ----------
// Counts attempts and correct answers per key (a note name or interval).
// toJSON/fromJSON let the page save scores in localStorage (scores only,
// never audio).

export class ScoreBook {
  constructor(data = {}) {
    this.data = {}; // key → { attempts, correct }
    for (const [key, v] of Object.entries(data)) {
      if (Number.isFinite(v?.attempts) && Number.isFinite(v?.correct)) this.data[key] = { attempts: v.attempts, correct: v.correct };
    }
  }

  record(key, correct) {
    const entry = (this.data[key] ||= { attempts: 0, correct: 0 });
    entry.attempts++;
    if (correct) entry.correct++;
  }

  // 0..1, or null if never asked
  accuracy(key) {
    const e = this.data[key];
    return e && e.attempts ? e.correct / e.attempts : null;
  }

  get totals() {
    let attempts = 0, correct = 0;
    for (const e of Object.values(this.data)) { attempts += e.attempts; correct += e.correct; }
    return { attempts, correct };
  }

  reset() {
    this.data = {};
  }

  toJSON() {
    return this.data;
  }
}

// ---------- sing-back judge ----------
// Feed it smoothed pitch readings while the learner sings. It waits for a
// STEADY note: readings held for `holdMs` that stay within `steadyCents` of
// each other (wide enough for gentle vibrato). Then it reports the median
// pitch and how many cents it is from the target.

export class SingBackJudge {
  constructor(targetHz, { holdMs = 700, steadyCents = 60, timeoutMs = 8000, a4 = DEFAULT_A4 } = {}) {
    this.targetHz = targetHz;
    this.holdMs = holdMs;
    this.steadyCents = steadyCents;
    this.timeoutMs = timeoutMs;
    this.a4 = a4;
    this.startTime = null;
    this.run = []; // current steady run: [{ t, n }] (n = note number, decimal)
    this.result = null;
  }

  // Returns null while still listening, or the final result:
  //   { heard: true, frequency, cents, centsIgnoringOctave, octaves }
  //   { heard: false }  (timed out)
  push(frequency, timeMs) {
    if (this.result) return this.result;
    if (this.startTime === null) this.startTime = timeMs;

    if (frequency > 0) {
      const n = frequencyToNoteNumber(frequency, this.a4);
      this.run.push({ t: timeMs, n });
      // Drop older readings until the run is steady again.
      const spread = () => {
        const values = this.run.map((r) => r.n);
        return (Math.max(...values) - Math.min(...values)) * 100;
      };
      while (this.run.length > 1 && spread() > this.steadyCents) this.run.shift();

      if (timeMs - this.run[0].t >= this.holdMs) {
        const sorted = this.run.map((r) => r.n).sort((a, b) => a - b);
        const medianN = sorted[Math.floor(sorted.length / 2)];
        this.result = describeSungResult(medianN, this.targetHz, this.a4);
        return this.result;
      }
    } else {
      this.run = []; // a break (silence, breath) starts the hold again
    }

    if (timeMs - this.startTime >= this.timeoutMs) this.result = { heard: false };
    return this.result;
  }
}

// How far a sung note (as a decimal note number) is from the target.
export function describeSungResult(sungNoteNumber, targetHz, a4 = DEFAULT_A4) {
  const targetN = frequencyToNoteNumber(targetHz, a4);
  const cents = (sungNoteNumber - targetN) * 100;
  const octaves = Math.round(cents / 1200);
  return {
    heard: true,
    frequency: a4 * Math.pow(2, (sungNoteNumber - 69) / 12),
    cents,                                    // e.g. −1188 = an octave low, then 12 cents sharp
    octaves,                                  // −1 = sang an octave below
    centsIgnoringOctave: cents - octaves * 1200, // −600 … +600
  };
}

// Plain words for a cents difference. These bands are a beginner-friendly
// display choice, not a measured standard.
export function describeCentsOff(cents) {
  const size = Math.abs(cents);
  const direction = cents > 0 ? 'sharp (too high)' : 'flat (too low)';
  if (size <= 10) return 'Excellent: within 10 cents';
  if (size <= 25) return `Good: ${Math.round(size)} cents ${direction}`;
  if (size <= 50) return `Close: ${Math.round(size)} cents ${direction}`;
  const semitones = Math.round(size / 100);
  return `About ${semitones} semitone${semitones === 1 ? '' : 's'} ${direction}`;
}
