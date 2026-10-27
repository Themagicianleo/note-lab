// Tests for js/fft.js and js/spectrum.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft } from '../js/fft.js';
import { computeSpectrum, findPeaks, bandFor, EQ_BANDS, PeakHold } from '../js/spectrum.js';

const SR = 48000;
const N = 8192;
const tone = (parts, n = N) => // parts: [[hz, amplitude], ...]
  Float32Array.from({ length: n }, (_, i) => parts.reduce((s, [hz, a]) => s + a * Math.sin((2 * Math.PI * hz * i) / SR), 0));

test('FFT matches a slow, direct calculation (DFT)', () => {
  const n = 64;
  const input = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) / 10);
  const re = Float64Array.from(input);
  const im = new Float64Array(n);
  fft(re, im);
  for (let k = 0; k < n; k++) {
    let dr = 0, di = 0;
    for (let t = 0; t < n; t++) {
      dr += input[t] * Math.cos((-2 * Math.PI * k * t) / n);
      di += input[t] * Math.sin((-2 * Math.PI * k * t) / n);
    }
    assert.ok(Math.abs(re[k] - dr) < 1e-9 && Math.abs(im[k] - di) < 1e-9, `bin ${k}`);
  }
});

test('FFT refuses sizes that are not a power of two', () => {
  assert.throws(() => fft(new Float64Array(100), new Float64Array(100)));
});

test('a sine shows up at its frequency and level', () => {
  for (const [hz, amplitude, expectedDb] of [[440, 0.5, -6.02], [1000, 1, 0], [82.41, 0.1, -20]]) {
    const [peak] = findPeaks(computeSpectrum(tone([[hz, amplitude]]), SR));
    assert.ok(Math.abs(peak.hz - hz) < 0.5, `${hz} Hz: peak at ${peak.hz.toFixed(2)}`);
    assert.ok(Math.abs(peak.db - expectedDb) < 0.5, `${hz} Hz: level ${peak.db.toFixed(2)} dB, expected ${expectedDb}`);
  }
});

test('a single sine is listed once (no side-lobe "peaks")', () => {
  const peaks = findPeaks(computeSpectrum(tone([[440, 0.5]]), SR));
  assert.equal(peaks.length, 1, JSON.stringify(peaks));
});

test('harmonics: peaks at 1×, 2×, 3× with the right levels', () => {
  // 220 Hz at 1/k amplitudes: harmonic 2 is 6.02 dB down, harmonic 3 is 9.54 dB down.
  const spec = computeSpectrum(tone([[220, 0.5], [440, 0.25], [660, 0.5 / 3]]), SR);
  const peaks = findPeaks(spec);
  assert.deepEqual(peaks.map((p) => Math.round(p.hz)), [220, 440, 660]);
  assert.ok(Math.abs(peaks[0].db - peaks[1].db - 6.02) < 0.3);
  assert.ok(Math.abs(peaks[0].db - peaks[2].db - 9.54) < 0.3);
});

test('silence has no peaks', () => {
  assert.equal(findPeaks(computeSpectrum(new Float32Array(N), SR)).length, 0);
});

test('EQ bands cover 20 Hz to 20 kHz without gaps', () => {
  for (let i = 1; i < EQ_BANDS.length; i++) assert.equal(EQ_BANDS[i].from, EQ_BANDS[i - 1].to);
  assert.equal(EQ_BANDS[0].from, 20);
  assert.equal(EQ_BANDS.at(-1).to, 20000);
  assert.equal(bandFor(100).name, 'Bass');
  assert.equal(bandFor(3000).name, 'Upper mids');
  assert.equal(bandFor(10), null);
});

test('peak hold keeps the highest level and lets it fall', () => {
  const hold = new PeakHold(20); // 20 dB per second
  hold.update(Float32Array.from([-10, -50]), 0);
  const after = hold.update(Float32Array.from([-80, -40]), 500); // half a second later
  assert.equal(after[0], -20); // fell 10 dB
  assert.equal(after[1], -40); // new level is higher
});
