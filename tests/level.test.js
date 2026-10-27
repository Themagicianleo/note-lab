// Tests for js/level.js. Values you can check by hand:
//   20 × log10(1) = 0,   20 × log10(0.1) = −20,   20 × log10(0.5) = −6.02

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rms, amplitudeToDb, levelDb, MIN_DB } from '../js/level.js';

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('amplitude to dB', () => {
  close(amplitudeToDb(1), 0);
  close(amplitudeToDb(0.1), -20);
  close(amplitudeToDb(0.5), -6.02);
  assert.equal(amplitudeToDb(0), MIN_DB);
});

test('RMS of a constant and of a sine wave', () => {
  close(rms(new Float32Array(100).fill(0.5)), 0.5);
  // A sine wave of peak 1 has RMS 1/√2 = 0.7071, which is −3.01 dBFS.
  const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 100 * i) / 48000));
  close(rms(sine), 0.7071, 0.001);
  close(levelDb(sine), -3.01);
});

test('silence is reported as the minimum, not −Infinity', () => {
  assert.equal(levelDb(new Float32Array(2048)), MIN_DB);
  assert.equal(levelDb([]), MIN_DB);
});
