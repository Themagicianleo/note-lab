// Tests for js/pitch-tracker.js: the full pipeline on short generated buffers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PitchTracker } from '../js/pitch-tracker.js';

const SR = 48000;
const sine = (hz, amplitude = 0.5) =>
  Float32Array.from({ length: 2048 }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / SR));

test('a steady tone is shown after a few readings', () => {
  const tracker = new PitchTracker(); // Balanced: needs 4 readings
  let out;
  for (let i = 0; i < 4; i++) out = tracker.process(sine(220), SR);
  assert.ok(Math.abs(out.smoothed - 220) < 0.1, `got ${out.smoothed}`);
  assert.equal(out.reason, null);
});

test('below the volume gate: no detection, reason "quiet"', () => {
  const tracker = new PitchTracker({ gateDb: -40 });
  const out = tracker.process(sine(220, 0.005), SR); // ≈ −49 dBFS
  assert.equal(out.frequency, null);
  assert.equal(out.reason, 'quiet');
  assert.ok(out.levelDb < -40);
});

test('the same tone passes a lower gate', () => {
  const tracker = new PitchTracker({ gateDb: -60, smoothingLevel: 0 });
  const out = tracker.process(sine(220, 0.005), SR);
  assert.ok(Math.abs(out.smoothed - 220) < 0.1);
});

test('"Fastest" shows the very first reading; "Steadiest" waits', () => {
  const fast = new PitchTracker({ smoothingLevel: 0 });
  const steady = new PitchTracker({ smoothingLevel: 4 });
  assert.ok(fast.process(sine(330), SR).smoothed > 0);
  assert.equal(steady.process(sine(330), SR).smoothed, null);
});

test('a frequency outside the range is never reported', () => {
  const tracker = new PitchTracker({ minHz: 65, maxHz: 500, smoothingLevel: 0 });
  const out = tracker.process(sine(900), SR);
  assert.ok(out.frequency === null || (out.frequency >= 65 && out.frequency <= 500), `got ${out.frequency}`);
});
