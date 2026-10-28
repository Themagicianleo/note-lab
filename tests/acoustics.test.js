// Tests for js/acoustics.js. Each test is a worked example you can check
// with a calculator; the comments show the working.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ac from '../js/acoustics.js';
import { computeSpectrum } from '../js/spectrum.js';

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

// ---------- 2. Harmonics ----------

const SR = 48000;
const toneFrom = (f0, amplitude, count = 20, n = 8192) =>
  Float32Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let k = 1; k <= count; k++) s += 0.3 * amplitude(k) * Math.sin(2 * Math.PI * k * f0 * i / SR);
    return s;
  });

test('harmonic series: f_n = n · f0 (220 Hz → 220, 440, 660)', () => {
  assert.deepEqual([1, 2, 3].map((n) => ac.harmonicFrequency(220, n)), [220, 440, 660]);
});

test('relative dB: half amplitude = −6.02 dB, a third = −9.54 dB', () => {
  close(ac.relativeDb(0.5, 1), -6.02, 0.01);
  close(ac.relativeDb(1 / 3, 1), -9.54, 0.01);
});

test('measured harmonics of a sawtooth match its Fourier series (1/n)', () => {
  const spectrum = computeSpectrum(toneFrom(220, (k) => 1 / k), SR);
  const h = ac.relativeToLoudest(ac.measureHarmonics(spectrum, 220, { count: 6 }));
  for (const { n, hz, relDb, centsOff } of h) {
    close(hz, 220 * n, 0.5, `harmonic ${n} frequency`);
    close(relDb, 20 * Math.log10(1 / n), 0.4, `harmonic ${n} level`);
    close(centsOff, 0, 2, `harmonic ${n} cents`);
  }
});

test('a pure sine has only the fundamental', () => {
  const h = ac.measureHarmonics(computeSpectrum(toneFrom(440, (k) => (k === 1 ? 1 : 0)), SR), 440, { count: 5 });
  assert.deepEqual(h.map((x) => x.found), [true, false, false, false, false]);
});

test('calculated reference: square wave has odd harmonics at 1/n', () => {
  const h = ac.referenceHarmonics('square', 100, 5);
  assert.deepEqual(h.map((x) => x.found), [true, false, true, false, true]);
  close(h[2].relDb, -9.54, 0.01, '3rd harmonic');
  close(h[4].relDb, -13.98, 0.01, '5th harmonic');
});
