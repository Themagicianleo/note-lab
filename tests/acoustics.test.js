// Tests for js/acoustics.js. Each test is a worked example you can check
// with a calculator; the comments show the working.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ac from '../js/acoustics.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);

// ---------- 1. Waveform ----------

test('period ↔ frequency: T = 2.2727 ms ↔ f = 440 Hz', () => {
  close(ac.frequencyFromPeriod(0.0022727), 440, 0.01);
  close(ac.periodFromFrequency(440) * 1000, 2.2727, 0.0001, 'ms');
});

test('rising zero crossing of a sine is found where it should be', () => {
  // sin(2π·100·t) at 48 kHz: one cycle = 480 samples. Starting the wave a
  // quarter cycle in (phase 90°, value 1), it next rises through zero at
  // sample 360 (three-quarters of a cycle later).
  const sr = 48000;
  const s = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(2 * Math.PI * 100 * i / sr + Math.PI / 2));
  close(ac.findRisingCrossing(s), 360, 0.01, 'first crossing');
  close(ac.findRisingCrossing(s, 400), 840, 0.01, 'next crossing (one period later)');
});

test('no crossing in silence or a flat line', () => {
  assert.equal(ac.findRisingCrossing(new Float32Array(100)), -1);
  assert.equal(ac.findRisingCrossing(new Float32Array(100).fill(0.5)), -1);
});

test('tiny noise around zero does not trigger (hysteresis)', () => {
  const s = Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 0.001 : -0.001));
  assert.equal(ac.findRisingCrossing(s), -1);
});

test('peak amplitude', () => {
  assert.equal(ac.peakAmplitude(Float32Array.from([0.1, -0.7, 0.3])), Float32Array.from([0.7])[0]);
});
