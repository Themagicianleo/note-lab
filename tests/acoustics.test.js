// Tests for js/acoustics.js. Each test is a worked example you can check
// with a calculator; the comments show the working.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ac from '../js/acoustics.js';
import { computeSpectrum } from '../js/spectrum.js';
import { dbToColour } from '../js/lab/colour-map.js';

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

// ---------- 3. Beats ----------

test('beats: 440 and 443 Hz → 3 Hz, period 0.333 s, heard pitch 441.5 Hz', () => {
  assert.equal(ac.beatFrequency(440, 443), 3);
  assert.equal(ac.beatFrequency(443, 440), 3);
  close(ac.beatPeriod(440, 443), 0.3333, 0.0001);
  assert.equal(ac.averageFrequency(440, 443), 441.5);
  assert.equal(ac.beatPeriod(440, 440), Infinity); // in tune: no beats
});

test('sum-to-product identity holds (checked at many times)', () => {
  for (let t = 0; t < 1; t += 0.0137) {
    const product = 2 * Math.cos(Math.PI * (440 - 443) * t) * Math.sin(Math.PI * (440 + 443) * t);
    close(ac.twoToneSum(t, 440, 443), product, 1e-9, `t=${t}`);
  }
});

test('envelope is loudest (2) every beat period and silent (0) halfway between', () => {
  close(ac.beatEnvelope(0, 440, 443), 2, 1e-12);
  close(ac.beatEnvelope(1 / 3, 440, 443), 2, 1e-9);   // one beat period later
  close(ac.beatEnvelope(1 / 6, 440, 443), 0, 1e-9);   // half a period: the tones cancel
});

// ---------- 4. Spectrogram ----------

test('STFT resolution: N = 2048 at 48 kHz → 42.7 ms and 23.4 Hz; product = 1', () => {
  const r = ac.stftResolution(2048, 48000);
  close(r.windowSeconds * 1000, 42.667, 0.001, 'ms');
  close(r.binHz, 23.4375, 1e-9, 'Hz');
  close(r.product, 1, 1e-12, 'Δt × Δf');
});

test('STFT trade-off: 4× the window → 4× longer, 4× finer', () => {
  const a = ac.stftResolution(1024, 48000);
  const b = ac.stftResolution(4096, 48000);
  close(b.windowSeconds / a.windowSeconds, 4, 1e-12);
  close(a.binHz / b.binHz, 4, 1e-12);
});

test('colour map: quiet is dark, loud is bright, brightness always rises', () => {
  assert.deepEqual(dbToColour(-200, -100, -20), [0, 0, 4]);
  assert.deepEqual(dbToColour(0, -100, -20), [252, 255, 164]);
  const brightness = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b; // relative luminance weights
  let previous = -1;
  for (let db = -100; db <= -20; db += 1) {
    const now = brightness(dbToColour(db, -100, -20));
    assert.ok(now >= previous, `brightness fell at ${db} dB`);
    previous = now;
  }
});

// ---------- 5. Pipes and strings ----------

test('speed of sound: 331.3 m/s at 0 °C, 343.2 m/s at 20 °C', () => {
  close(ac.speedOfSound(0), 331.3, 1e-9);
  close(ac.speedOfSound(20), 343.21, 0.01); // 331.3 × √(1 + 20/273.15) = 331.3 × 1.035945
  // The constant follows from √(γRT/M) at 0 °C with γ = 1.4, R = 8.314, M = 0.028964:
  close(Math.sqrt((1.4 * 8.314 * 273.15) / 0.028964), 331.3, 0.05, 'ideal-gas check');
});

test('open pipe, 0.5 m, 20 °C: 343.2, 686.4, 1029.6 Hz', () => {
  const m = ac.openPipeModes(0.5, ac.speedOfSound(20), 3);
  close(m[0].hz, 343.21, 0.01); close(m[1].hz, 686.42, 0.02); close(m[2].hz, 1029.6, 0.05);
  assert.deepEqual(m.map((x) => x.harmonic), [1, 2, 3]);
});

test('closed pipe, 0.5 m, 20 °C: odd harmonics 171.6, 514.8, 858.0 Hz', () => {
  const m = ac.closedPipeModes(0.5, ac.speedOfSound(20), 3);
  close(m[0].hz, 171.60, 0.01); close(m[1].hz, 514.81, 0.02); close(m[2].hz, 858.0, 0.05);
  assert.deepEqual(m.map((x) => x.harmonic), [1, 3, 5]);
});

test('end correction: r = 10 mm → ΔL = 6.13 mm; open 0.5 m pipe drops to 335.0 Hz', () => {
  close(ac.endCorrection(0.01) * 1000, 6.133, 0.001, 'mm');
  // L_eff = 0.5 + 2 × 0.006133 = 0.512266 m → f₁ = 343.21 / 1.02453 = 335.0 Hz
  close(ac.openPipeModes(0.5, ac.speedOfSound(20), 1, ac.endCorrection(0.01))[0].hz, 335.0, 0.1);
});

test('string: L 0.65 m, T 70 N, μ 0.0012 kg/m → v 241.5 m/s, f₁ 185.8 Hz', () => {
  close(ac.stringWaveSpeed(70, 0.0012), 241.52, 0.01);
  const m = ac.stringModes(0.65, 70, 0.0012, 2);
  close(m[0].hz, 185.79, 0.01); close(m[1].hz, 371.58, 0.02);
});

test('string mass per length from diameter: 0.43 mm at 7850 kg/m³ → 0.00114 kg/m', () => {
  close(ac.massPerLengthFromDiameter(0.00043, 7850), 0.0011400, 0.0000005);
});

test('mode shapes: open ends are antinodes, closed end and string ends are nodes', () => {
  close(Math.abs(ac.modeShape('open', 1, 0)), 1, 1e-12); close(Math.abs(ac.modeShape('open', 1, 1)), 1, 1e-12);
  close(ac.modeShape('closed', 1, 0), 0, 1e-12); close(Math.abs(ac.modeShape('closed', 1, 1)), 1, 1e-12);
  close(ac.modeShape('string', 3, 0), 0, 1e-12); close(ac.modeShape('string', 3, 1), 0, 1e-12);
});
