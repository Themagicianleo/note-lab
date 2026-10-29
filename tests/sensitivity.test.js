// Tests for the sensitivity features: js/filters.js (band filter),
// js/noise-floor.js (automatic threshold), the YIN fallback in js/yin.js,
// and how js/pitch-tracker.js puts them together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biquadCoefficients, biquadGain, Biquad, pitchBand, bandFilter, BUTTERWORTH_Q } from '../js/filters.js';
import { NoiseFloor, LIMITS, MARGIN_DB } from '../js/noise-floor.js';
import { detectPitchYin } from '../js/yin.js';
import { PitchTracker, SENSITIVITY } from '../js/pitch-tracker.js';
import { levelDb } from '../js/level.js';
import { validateSettings, DEFAULT_SETTINGS } from '../js/settings.js';

const SR = 48000;
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);
const dB = (gain) => 20 * Math.log10(gain);
const sine = (hz, n, amp = 0.5, sr = SR) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));
// Repeatable white noise with RMS `rms`.
function noise(n, rms, seed = 1) {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; out[i] = (s / 2147483648 * 2 - 1) * rms * Math.sqrt(3); }
  return out;
}

// ---------- band filter ----------

test('Butterworth Q is 1/√2, and −3.01 dB in Web Audio units', () => {
  close(BUTTERWORTH_Q, 0.7071, 1e-4);
  close(20 * Math.log10(BUTTERWORTH_Q), -3.0103, 1e-4);
});

test('a Butterworth low-pass is −3 dB at its cut-off, flat below, −12 dB per octave above', () => {
  const c = biquadCoefficients('lowpass', 1000, SR);
  close(dB(biquadGain(c, 1000, SR)), -3.01, 0.01);
  close(dB(biquadGain(c, 100, SR)), 0, 0.01);
  close(dB(biquadGain(c, 4000, SR)), -24, 0.5); // two octaves above: about −24 dB
});

test('a Butterworth high-pass is −3 dB at its cut-off and flat well above', () => {
  const c = biquadCoefficients('highpass', 50, SR);
  close(dB(biquadGain(c, 50, SR)), -3.01, 0.01);
  close(dB(biquadGain(c, 500, SR)), 0, 0.01);
  close(dB(biquadGain(c, 25, SR)), -12.3, 0.2); // one octave below: 10·log10(1 + 2⁴) = −12.3 dB
});

test('the filter itself does what the formula says (a 4 kHz sine through a 1 kHz low-pass)', () => {
  const out = new Biquad('lowpass', 1000, SR).process(sine(4000, SR));
  const tail = out.subarray(SR / 2); // after it has settled
  close(levelDb(tail) - levelDb(sine(4000, SR / 2)), dB(biquadGain(biquadCoefficients('lowpass', 1000, SR), 4000, SR)), 0.1);
});

test('pitch band: high-pass at half the lowest pitch, low-pass at 4× the highest (max 8 kHz)', () => {
  assert.deepEqual(pitchBand(100, 800), { highpassHz: 50, lowpassHz: 3200 });
  assert.deepEqual(pitchBand(50, 2500), { highpassHz: 25, lowpassHz: 8000 });
});

test('band filter keeps a 220 Hz note and removes most white hiss (≈ 13 dB less for 100–800 Hz)', () => {
  const note = sine(220, SR);
  close(levelDb(bandFilter(note, SR, 100, 800).subarray(SR / 2)), levelDb(note.subarray(SR / 2)), 0.1);
  // White noise: power spread evenly over 0–24 kHz; the band keeps about 50–3200 Hz → 10·log10(3150/24000) ≈ −8.8 dB,
  // plus the filters' slopes let a little more through above 3200 Hz; measured about −8 to −9 dB.
  const hiss = noise(SR, 0.01);
  const drop = levelDb(bandFilter(hiss, SR, 100, 800).subarray(SR / 2)) - levelDb(hiss.subarray(SR / 2));
  assert.ok(drop < -7 && drop > -10, `drop ${drop.toFixed(1)} dB`);
});

// ---------- automatic threshold (noise floor) ----------

test('noise floor: the quietest 250 ms block; threshold 6 dB above it', () => {
  const f = new NoiseFloor();
  assert.equal(f.floorDb, null);
  assert.equal(f.gateDb, -70); // fallback before the first block
  let t = 0;
  for (let i = 0; i < 60; i++) f.push(-72, (t += 1000 / 60)); // 1 s of −72 dBFS
  for (let i = 0; i < 60; i++) f.push(-30, (t += 1000 / 60)); // 1 s of singing
  close(f.floorDb, -72, 1e-9);
  close(f.gateDb, -72 + MARGIN_DB, 1e-9);
});

test('noise floor forgets after 15 s, and stays within its limits', () => {
  const f = new NoiseFloor();
  let t = 0;
  for (let i = 0; i < 60; i++) f.push(-120, (t += 1000 / 60));
  assert.equal(f.gateDb, LIMITS.min); // −120 + 6 is below the lowest allowed threshold
  for (let i = 0; i < 20 * 60; i++) f.push(-20, (t += 1000 / 60));
  assert.equal(f.gateDb, LIMITS.max); // the quiet part is forgotten; −20 + 6 is above the highest allowed
});

test('averaging is done in power: blocks of −60 and −70 dBFS readings average to −62.6 dBFS', () => {
  // 10·log10((10⁻⁶ + 10⁻⁷)/2) = −62.6
  const f = new NoiseFloor();
  let t = 0;
  for (let i = 0; i < 6; i++) f.push(i % 2 ? -70 : -60, (t += 50)); // 6 readings, 50 ms apart = one 250 ms block
  close(f.floorDb, -62.6, 0.05);
});

// ---------- YIN fallback ----------

test('YIN fallback off (default): a 220 Hz tone in strong noise gives no pitch; on: gives 220 Hz', () => {
  // SNR about 3 dB: strict YIN's dips don't go below 0.10.
  const x = sine(220, 2048, 0.1).map((v, i) => v + noise(2048, 0.05, 5)[i]);
  const strict = detectPitchYin(x, SR, { minHz: 100, maxHz: 800 });
  assert.equal(strict.frequency, null);
  const sensitive = detectPitchYin(x, SR, { minHz: 100, maxHz: 800, fallbackThreshold: 0.35, subharmonicTolerance: 0.05 });
  close(sensitive.frequency, 220, 3);
});

test('YIN fallback still says "no pitch" for noise alone', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    assert.equal(detectPitchYin(noise(2048, 0.05, seed), SR, { minHz: 100, maxHz: 800, fallbackThreshold: 0.35 }).frequency, null);
  }
});

test('YIN with no options behaves exactly as before (fallback off)', () => {
  const x = sine(220, 2048, 0.1).map((v, i) => v + noise(2048, 0.05, 5)[i]);
  assert.deepEqual(detectPitchYin(x, SR, { minHz: 100, maxHz: 800, fallbackThreshold: undefined }), detectPitchYin(x, SR, { minHz: 100, maxHz: 800 }));
});

// ---------- the tracker with "high" sensitivity ----------

test('high sensitivity: after 1 s of quiet room, a −62 dBFS note is detected (standard: too quiet)', () => {
  const room = noise(SR, 10 ** (-80 / 20), 9);           // −80 dBFS hiss
  const note = sine(220, SR, Math.SQRT2 * 10 ** (-62 / 20)); // −62 dBFS RMS
  const run = (options) => {
    const tracker = new PitchTracker({ minHz: 100, maxHz: 800, smoothingLevel: 0, gateDb: -55, ...options });
    let t = 0;
    const results = [];
    for (const part of [room, note.map((v, i) => v + room[i])]) {
      for (let s = 0; s + 2048 <= part.length; s += 800) results.push(tracker.process(part.subarray(s, s + 2048), SR, (t += 1000 / 60)));
    }
    return results.at(-1);
  };
  const standard = run(SENSITIVITY.standard);
  assert.equal(standard.reason, 'quiet');
  const high = run(SENSITIVITY.high);
  close(high.frequency, 220, 1);
  assert.ok(high.gateDb < -66 && high.gateDb > -76, `gate ${high.gateDb}`); // about −80 + 6 (hiss in each window varies a bit)
});

test('a long held note does not raise the automatic threshold above itself', () => {
  const tracker = new PitchTracker({ minHz: 100, maxHz: 800, ...SENSITIVITY.high });
  const note = sine(220, 2048, 0.01); // −43 dBFS, held for 20 s
  let last;
  for (let t = 0; t < 20000; t += 1000 / 60) last = tracker.process(note, SR, t);
  close(last.smoothed, 220, 1);
});

// ---------- settings ----------

test('sensitivity setting: default high; only known values kept', () => {
  assert.equal(DEFAULT_SETTINGS.sensitivity, 'high');
  assert.equal(validateSettings({ sensitivity: 'maximum' }).sensitivity, 'maximum');
  assert.equal(validateSettings({ sensitivity: 'standard' }).sensitivity, 'standard');
  assert.equal(validateSettings({ sensitivity: 'loud' }).sensitivity, 'high');
  assert.equal(validateSettings({ sensitivity: 'toString' }).sensitivity, 'high');
});
