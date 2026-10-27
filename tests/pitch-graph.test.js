// Tests for the y-axis maths in js/pitch-graph.js (the drawing itself needs a browser).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frequencyToY } from '../js/pitch-graph.js';

test('bottom of the range is at the bottom, top at the top', () => {
  assert.equal(frequencyToY(100, 100, 800, 300), 300);
  assert.equal(frequencyToY(800, 100, 800, 300), 0);
});

test('each octave gets the same height (log scale)', () => {
  // 100 → 800 Hz is 3 octaves, so each octave is 100 px of 300.
  // (allow for tiny floating-point rounding, e.g. 200.00000000000003)
  assert.ok(Math.abs(frequencyToY(200, 100, 800, 300) - 200) < 1e-9);
  assert.ok(Math.abs(frequencyToY(400, 100, 800, 300) - 100) < 1e-9);
});
