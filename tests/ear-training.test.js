// Tests for js/ear-training.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_SETS, INTERVALS, SING_TARGETS, noteLabel, noteLetter, makeNoteQuestion, makeIntervalQuestion,
  ScoreBook, SingBackJudge, describeSungResult, describeCentsOff,
} from '../js/ear-training.js';
import { noteToFrequency } from '../js/pitch-math.js';

// A fixed sequence of "random" numbers, so tests are repeatable.
const sequence = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('note sets contain the right notes', () => {
  assert.deepEqual(NOTE_SETS['c-major'].notes.map(noteLabel), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
  assert.equal(NOTE_SETS.chromatic.notes.length, 12);
  assert.equal(NOTE_SETS['two-octaves'].notes.length, 24);
  assert.equal(noteLetter(61), 'C#');
});

test('intervals are 1 to 12 semitones, each once', () => {
  assert.deepEqual(INTERVALS.map((i) => i.semitones), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('a note question avoids repeating the previous note', () => {
  const q = makeNoteQuestion('c-major', 60, sequence(0, 0, 0.5)); // first two picks would be C4 again
  assert.notEqual(q.note, 60);
});

test('interval questions: notes the right distance apart, inside C3–C5', () => {
  for (const direction of ['up', 'down', 'together']) {
    for (let i = 0; i < 200; i++) {
      const q = makeIntervalQuestion([1, 7, 12], direction);
      assert.equal(Math.abs(q.second - q.first), q.semitones);
      assert.ok(Math.min(q.first, q.second) >= 48 && Math.max(q.first, q.second) <= 72);
      if (direction === 'up') assert.ok(q.second > q.first);
      if (direction === 'down') assert.ok(q.second < q.first);
      assert.equal(q.together, direction === 'together');
    }
  }
});

test('sing-back targets sit inside each voice preset', () => {
  assert.deepEqual([SING_TARGETS.low[0], SING_TARGETS.low.at(-1)].map(noteLabel), ['G2', 'D4']);
  assert.deepEqual([SING_TARGETS.mid[0], SING_TARGETS.mid.at(-1)].map(noteLabel), ['C3', 'G4']);
  assert.deepEqual([SING_TARGETS.high[0], SING_TARGETS.high.at(-1)].map(noteLabel), ['A3', 'E5']);
});

test('score book counts per key and survives saving/loading', () => {
  const book = new ScoreBook();
  book.record('E', true);
  book.record('E', false);
  book.record('G', true);
  assert.equal(book.accuracy('E'), 0.5);
  assert.equal(book.accuracy('A'), null);
  assert.deepEqual(book.totals, { attempts: 3, correct: 2 });
  const copy = new ScoreBook(JSON.parse(JSON.stringify(book)));
  assert.equal(copy.accuracy('G'), 1);
  assert.deepEqual(new ScoreBook({ bad: 'x', E: { attempts: 'no' } }).totals, { attempts: 0, correct: 0 }); // ignores junk
});

// Feed a judge one frequency for `ms` at 60 readings per second.
function sing(judge, hz, ms, clock) {
  let result = null;
  for (let t = 0; t < ms && !result; t += 1000 / 60) result = judge.push(hz, (clock.now += 1000 / 60));
  return result;
}

test('sing-back: a steady note 12 cents sharp is reported as +12', () => {
  const target = noteToFrequency('A', 3); // 220 Hz
  const judge = new SingBackJudge(target);
  const result = sing(judge, 220 * Math.pow(2, 12 / 1200), 1000, { now: 0 });
  assert.equal(result.heard, true);
  assert.ok(Math.abs(result.cents - 12) < 0.01, `got ${result.cents}`);
});

test('sing-back: waits for a steady note (a slide does not count)', () => {
  const judge = new SingBackJudge(220);
  let now = 0;
  let result = null;
  for (let i = 0; i < 40 && !result; i++) result = judge.push(200 * Math.pow(2, i / 40), (now += 1000 / 60)); // sliding up
  assert.equal(result, null);
});

test('sing-back: an octave lower is recognised as the same note an octave down', () => {
  const judge = new SingBackJudge(220);
  const result = sing(judge, 110 * Math.pow(2, -8 / 1200), 1000, { now: 0 });
  assert.equal(result.octaves, -1);
  assert.ok(Math.abs(result.centsIgnoringOctave + 8) < 0.01);
});

test('sing-back: gives up after the timeout if nothing steady is heard', () => {
  const judge = new SingBackJudge(220, { timeoutMs: 1000 });
  let now = 0;
  let result = null;
  for (let i = 0; i < 100 && !result; i++) result = judge.push(null, (now += 20));
  assert.deepEqual(result, { heard: false });
});

test('describeSungResult and describeCentsOff', () => {
  assert.ok(Math.abs(describeSungResult(57, 220).cents) < 1e-9); // 57 = A3 = 220 Hz
  assert.equal(describeCentsOff(4), 'Excellent: within 10 cents');
  assert.equal(describeCentsOff(-20), 'Good: 20 cents flat (too low)');
  assert.equal(describeCentsOff(40), 'Close: 40 cents sharp (too high)');
  assert.equal(describeCentsOff(-210), 'About 2 semitones flat (too low)');
});
