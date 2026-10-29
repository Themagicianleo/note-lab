// Tests for js/melody.js (music mode's melody guess). Each expected value can
// be worked out by hand from the formula in that file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salience, candidates, binToHz, spectralPeaks, MelodyTracker, MELODY_DEFAULTS } from '../js/melody.js';

const SR = 48000;
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);
// A tone with harmonics 1..n at loudness 1/k.
function tone(f0, n, harmonics = 10, amp = 0.2) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let k = 1; k <= harmonics; k++) x[i] += (amp / k) * Math.sin((2 * Math.PI * f0 * k * i) / SR);
  return x;
}

test('the defaults are Salamon & Gómez\'s values where the paper gives them', () => {
  assert.equal(MELODY_DEFAULTS.harmonics, 20);
  assert.equal(MELODY_DEFAULTS.alpha, 0.8);
  assert.equal(MELODY_DEFAULTS.beta, 1);
  assert.equal(MELODY_DEFAULTS.withinDb, 40);
  assert.equal(MELODY_DEFAULTS.binCents, 10);
});

test('grid: bin b is minHz · 2^(b·10/1200); bin 120 is one octave up', () => {
  close(binToHz(0), 100, 1e-9);
  close(binToHz(120), 200, 1e-9);
});

test('one peak at 200 Hz, amplitude 1: salience at 200 Hz = 1 (h = 1), at 100 Hz = 0.8 (h = 2, α¹)', () => {
  const s = salience([{ hz: 200, amplitude: 1 }]);
  close(s[120], 1, 1e-9);   // cos²(0) · 0.8⁰ · 1
  close(s[0], 0.8, 1e-9);   // 200/2 = 100 Hz → cos²(0) · 0.8¹
  // Half a semitone away (5 bins): cos²(0.5 · π/2) = 0.5
  close(s[125], 0.5, 1e-9);
  // More than a semitone away: nothing from this harmonic
  assert.equal(s[120 + 11], 0);
});

test('harmonics 220, 440, 660 Hz: the strongest candidate is 220 Hz (not 110 or 440)', () => {
  const peaks = [220, 440, 660].map((hz) => ({ hz, amplitude: 1 }));
  const [best] = candidates(salience(peaks));
  close(best.hz, 220, 1);
});

test('the pre-filter (500 Hz high-pass) turns a 100 Hz peak down by about 28 dB', () => {
  // Butterworth high-pass, 2.3 octaves below cut-off: 10·log10(1 + (500/100)⁴) ≈ 28 dB
  const x = Float32Array.from({ length: 4096 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100 * i) / SR));
  const [plain] = spectralPeaks(x, SR, { preHighpassHz: 0 });
  const [filtered] = spectralPeaks(x, SR);
  close(20 * Math.log10(filtered.amplitude / plain.amplitude), -28, 0.5);
});

test('melody over a louder low chord: music mode finds the melody (A4)', () => {
  const n = 4096;
  const melodyNote = tone(440, n, 12, 0.2);
  const chord = [130.81, 164.81, 196].map((f) => tone(f, n, 12, 0.25)); // C3 E3 G3, each louder than the melody
  const mix = melodyNote.map((v, i) => v + chord[0][i] + chord[1][i] + chord[2][i]);
  const tracker = new MelodyTracker({ minHz: 100, maxHz: 1000 });
  let r;
  for (let i = 0; i < 10; i++) r = tracker.process(mix, SR);
  close(r.smoothed, 440, 3);
});

test('silence: "quiet", no pitch', () => {
  const r = new MelodyTracker().process(new Float32Array(4096), SR);
  assert.equal(r.frequency, null);
  assert.equal(r.reason, 'quiet');
});
