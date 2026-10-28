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

// ---------- 6. Room modes ----------
// Room 5 m × 4 m × 2.5 m at 20 °C, c = 343.21 m/s.
const ROOM = [5, 4, 2.5];
const C20 = ac.speedOfSound(20);

test('axial modes of a 5 × 4 × 2.5 m room', () => {
  const m = ac.axialModes(C20, ROOM, 100);
  const pick = (d, n) => m.find((x) => x.dimension === d && x.n === n).hz;
  close(pick('length', 1), 34.32, 0.01);   // 343.21 / (2 × 5)
  close(pick('length', 2), 68.64, 0.01);
  close(pick('width', 1), 42.90, 0.01);    // 343.21 / (2 × 4)
  close(pick('height', 1), 68.64, 0.01);   // 343.21 / (2 × 2.5)
  assert.ok(m.every((x, i) => i === 0 || x.hz >= m[i - 1].hz), 'sorted low to high');
  assert.ok(m.every((x) => x.hz <= 100), 'none above the limit');
});

test('Rayleigh: tangential (1,1,0) mode = 54.94 Hz; axial matches n·c/2L', () => {
  // (343.21/2) × √((1/5)² + (1/4)²) = 171.6 × 0.32016 = 54.94
  close(ac.roomMode(C20, ROOM, [1, 1, 0]), 54.94, 0.01);
  close(ac.roomMode(C20, ROOM, [0, 0, 1]), C20 / (2 * 2.5), 1e-9);
  const all = ac.allRoomModes(C20, ROOM, 60);
  assert.deepEqual(all.map((x) => x.type), ['axial', 'axial', 'tangential']); // 34.3 (L1), 42.9 (W1), 54.9 (1,1,0)
});

test('pressure nulls of axial modes', () => {
  assert.deepEqual(ac.axialNullPositions(1, 5), [2.5]);         // the middle of the room
  assert.deepEqual(ac.axialNullPositions(2, 5), [1.25, 3.75]);  // a quarter of the way in from each wall
});

test('coincident modes: 2nd length mode and 1st height mode both 68.6 Hz', () => {
  const pairs = ac.coincidentModes(ac.axialModes(C20, ROOM, 100));
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].map((x) => `${x.dimension}${x.n}`).sort(), ['height1', 'length2']);
});

test('Schroeder frequency: T60 0.5 s, V 50 m³ → 200 Hz', () => {
  close(ac.schroederFrequency(0.5, 50), 200, 1e-9);
});

// ---------- 7. RT60 ----------
// Example room: V = 100 m³, two surfaces: 50 m² with α = 0.10 and 80 m² with α = 0.1875.
// A = 50 × 0.10 + 80 × 0.1875 = 5 + 15 = 20 m²; S = 130 m².

test('Sabine constant: 24·ln(10)/c = 0.1610 at c = 343.2 m/s', () => {
  close(ac.sabineConstant(343.2), 0.16101, 0.00001);
});

test('total absorption A = Σ S·α (and missing α → no result)', () => {
  const surfaces = [{ area: 50, alpha: { 500: 0.1 } }, { area: 80, alpha: { 500: 0.1875 } }];
  close(ac.totalAbsorption(surfaces, 500), 20, 1e-12);
  assert.equal(ac.totalAbsorption(surfaces, 1000), null);
});

test('Sabine: V 100 m³, A 20 m² → 0.805 s', () => {
  close(ac.sabineRT60(100, 20, 343.2), 0.8051, 0.0001); // 0.16101 × 100 / 20
});

test('Eyring: same room, S 130 m² → 0.741 s, and always ≤ Sabine', () => {
  // ᾱ = 20/130 = 0.153846; −ln(1 − ᾱ) = 0.167054; 130 × 0.167054 = 21.717
  close(ac.eyringRT60(100, 130, 20 / 130, 343.2), 0.7414, 0.0001);
  for (const a of [0.05, 0.2, 0.5, 0.8]) assert.ok(ac.eyringRT60(100, 130, a, 343.2) < ac.sabineRT60(100, 130 * a, 343.2));
  assert.equal(ac.eyringRT60(100, 130, 1, 343.2), null); // fully absorbing: formula undefined
});

test('RT60 by band: bands with a missing coefficient are marked, not guessed', () => {
  const surfaces = [{ area: 50, alpha: { 125: 0.1, 500: 0.1 } }, { area: 80, alpha: { 125: 0.1875, 500: 0.1875 } }];
  const r = ac.rt60ByBand(100, surfaces, 343.2);
  assert.deepEqual(r.map((x) => x.band), [125, 250, 500, 1000, 2000, 4000]);
  close(r[0].sabine, 0.8051, 0.0001);
  assert.equal(r[1].missing, true);
});
