// Tests for js/pitch-math.js. Run with:  npm test
// Each test uses a value you can check by hand with a calculator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frequencyToNoteNumber,
  noteNumberToFrequency,
  noteNumberToName,
  nameToNoteNumber,
  noteToFrequency,
  centsBetween,
  frequencyToNote,
  formatNote,
} from '../js/pitch-math.js';

// Floating-point maths is never exact, so compare with a small tolerance.
function assertClose(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, got ${actual}`
  );
}

test('440 Hz is A4, exactly in tune', () => {
  const note = frequencyToNote(440);
  assert.equal(note.name, 'A');
  assert.equal(note.octave, 4);
  assert.equal(note.noteNumber, 69);
  assertClose(note.cents, 0, 1e-9, 'cents');
});

test('261.63 Hz is C4 (middle C), within 0.1 cent', () => {
  const note = frequencyToNote(261.63);
  assert.equal(note.name, 'C');
  assert.equal(note.octave, 4);
  assert.equal(note.noteNumber, 60);
  // Exact C4 is 261.6256 Hz, so 261.63 is about +0.03 cents.
  assertClose(note.cents, 0.03, 0.01, 'cents');
});

test('330 Hz is E4, about 2 cents sharp (worked example)', () => {
  const note = frequencyToNote(330);
  assert.equal(note.name, 'E');
  assert.equal(note.octave, 4);
  // n = 69 + 12 × log2(330/440) = 64.01955 → +1.955 cents
  assertClose(note.cents, 1.955, 0.001, 'cents');
  assertClose(note.targetFrequency, 329.628, 0.001, 'E4 target frequency');
  assert.equal(formatNote(note), 'E4 · 330.0 Hz · +2 cents');
});

test('220 Hz is A3 at 0 cents; A3 at +4 cents is about 220.5 Hz', () => {
  assert.equal(formatNote(frequencyToNote(220)), 'A3 · 220.0 Hz · 0 cents');
  const sharpA3 = 220 * Math.pow(2, 4 / 1200);
  assertClose(sharpA3, 220.509, 0.001, 'A3 + 4 cents in Hz');
  assert.equal(formatNote(frequencyToNote(sharpA3)), 'A3 · 220.5 Hz · +4 cents');
});

test('flat notes show a minus sign', () => {
  // 435 Hz is below A4: 1200 × log2(435/440) = −19.79 cents
  const note = frequencyToNote(435);
  assert.equal(note.name, 'A');
  assertClose(note.cents, -19.79, 0.01, 'cents');
  assert.equal(formatNote(note), 'A4 · 435.0 Hz · -20 cents');
});

test('changing the reference pitch to A4 = 442 Hz', () => {
  // 440 Hz is now slightly flat: 1200 × log2(440/442) = −7.85 cents
  const note = frequencyToNote(440, 442);
  assert.equal(note.name, 'A');
  assert.equal(note.octave, 4);
  assertClose(note.cents, -7.85, 0.01, 'cents');
  assertClose(noteToFrequency('A', 4, 442), 442, 1e-9, 'A4 at 442');
});

test('known note frequencies (A4 = 440)', () => {
  // Standard equal-temperament values, rounded to 3 decimal places.
  const known = [
    ['E', 1, 41.203],  // bass guitar low E
    ['E', 2, 82.407],  // guitar low E
    ['A', 2, 110],
    ['C', 4, 261.626],
    ['E', 4, 329.628],
    ['A', 4, 440],
    ['C', 5, 523.251],
    ['A', 5, 880],
    ['C', 8, 4186.009], // highest piano key
  ];
  for (const [name, octave, hz] of known) {
    assertClose(noteToFrequency(name, octave), hz, 0.001, `${name}${octave}`);
  }
});

test('octaves double the frequency', () => {
  assertClose(noteToFrequency('A', 3), 220, 1e-9, 'A3');
  assertClose(noteToFrequency('A', 5), 880, 1e-9, 'A5');
  assertClose(centsBetween(440, 880), 1200, 1e-9, 'one octave in cents');
  assertClose(centsBetween(440, 220), -1200, 1e-9, 'one octave down');
});

test('octave number changes at C, not at A', () => {
  assert.deepEqual(noteNumberToName(59), { name: 'B', octave: 3 });
  assert.deepEqual(noteNumberToName(60), { name: 'C', octave: 4 });
  assert.deepEqual(noteNumberToName(0), { name: 'C', octave: -1 });
});

test('flat names give the same note as sharp names', () => {
  assert.equal(nameToNoteNumber('Bb', 3), nameToNoteNumber('A#', 3));
  assert.equal(nameToNoteNumber('Db', 4), 61);
  assert.ok(Number.isNaN(nameToNoteNumber('H', 4)), 'unknown name gives NaN');
});

test('round trip: note → frequency → note gives the same note at 0 cents', () => {
  for (let n = 21; n <= 108; n++) { // every piano key, A0 to C8
    const note = frequencyToNote(noteNumberToFrequency(n));
    assert.equal(note.noteNumber, n);
    assertClose(note.cents, 0, 1e-9, `cents for note ${n}`);
  }
});

test('round trip: frequency → note number → frequency', () => {
  for (const hz of [50, 98.7, 233.08, 440, 1234.5]) {
    assertClose(noteNumberToFrequency(frequencyToNoteNumber(hz)), hz, 1e-9, `${hz} Hz`);
  }
});

test('cents always stay between −50 and +50', () => {
  for (let hz = 40; hz < 2000; hz += 0.37) {
    const { cents } = frequencyToNote(hz);
    assert.ok(cents >= -50 && cents <= 50, `${hz} Hz gave ${cents} cents`);
  }
});

test('halfway between two notes is ±50 cents', () => {
  // Exactly halfway between A4 (69) and A#4 (70) is note number 69.5.
  const halfway = noteNumberToFrequency(69.5);
  const note = frequencyToNote(halfway);
  assertClose(Math.abs(note.cents), 50, 1e-9, 'distance from nearest note');
});

test('unusable frequencies give "No clear note" instead of a guess', () => {
  for (const bad of [0, -100, NaN, Infinity, undefined, null, '440']) {
    assert.equal(frequencyToNote(bad), null, `input ${bad}`);
  }
  assert.equal(formatNote(null), 'No clear note');
});
