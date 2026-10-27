// Tests for js/smoothing.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, PitchSmoother } from '../js/smoothing.js';

test('median of odd and even lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('needs enough valid readings before showing a pitch', () => {
  const s = new PitchSmoother({ historySize: 5, minValid: 3 });
  assert.equal(s.push(440), null);
  assert.equal(s.push(440), null);
  assert.equal(s.push(440), 440); // third valid reading
});

test('a single wrong-octave reading is ignored', () => {
  const s = new PitchSmoother({ historySize: 5, minValid: 3 });
  [440, 441, 439, 440].forEach((f) => s.push(f));
  assert.equal(s.push(220), 440); // median of 440, 441, 439, 440, 220
});

test('goes back to "no clear note" when the sound stops', () => {
  const s = new PitchSmoother({ historySize: 5, minValid: 3 });
  [440, 440, 440, 440, 440].forEach((f) => s.push(f));
  assert.equal(s.push(null), 440); // 4 of 5 still valid
  assert.equal(s.push(null), 440); // 3 of 5
  assert.equal(s.push(null), null); // only 2 of 5 → no clear note
});

test('follows a change of note after a short delay', () => {
  const s = new PitchSmoother({ historySize: 5, minValid: 3 });
  [440, 440, 440, 440, 440].forEach((f) => s.push(f));
  assert.equal(s.push(330), 440);
  assert.equal(s.push(330), 440);
  assert.equal(s.push(330), 330); // majority is now 330
});

test('zero, negative and null are all treated as "no pitch"', () => {
  const s = new PitchSmoother({ historySize: 3, minValid: 1 });
  assert.equal(s.push(0), null);
  assert.equal(s.push(-5), null);
  assert.equal(s.push(null), null);
});
