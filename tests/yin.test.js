// Tests for js/yin.js using short signals generated right here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitchYin } from '../js/yin.js';
import { centsBetween } from '../js/pitch-math.js';

const SR = 48000;
const SIZE = 2048; // the same buffer size the app uses

// A tone with chosen harmonic loudnesses: amps[0] = fundamental, amps[1] = 2nd harmonic, ...
function tone(hz, amps = [1], size = SIZE, sampleRate = SR) {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    let s = 0;
    amps.forEach((a, k) => { s += a * Math.sin((2 * Math.PI * hz * (k + 1) * i) / sampleRate); });
    out[i] = 0.5 * s;
  }
  return out;
}

// Repeatable "random" noise.
function noise(size = SIZE, seed = 1) {
  const out = new Float32Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out[i] = (x / 2147483648) * 2 - 1;
  }
  return out;
}

test('sine waves across the range are found within 1 cent', () => {
  for (const hz of [55, 82.41, 110, 220, 261.63, 329.63, 440, 880, 1318.5]) {
    const { frequency, confidence } = detectPitchYin(tone(hz), SR);
    const error = centsBetween(hz, frequency);
    assert.ok(Math.abs(error) < 1, `${hz} Hz: got ${frequency} (${error.toFixed(2)} cents)`);
    assert.ok(confidence > 0.9, `${hz} Hz confidence ${confidence}`);
  }
});

test('also works at the 44.1 kHz sample rate', () => {
  const { frequency } = detectPitchYin(tone(440, [1], SIZE, 44100), 44100);
  assert.ok(Math.abs(centsBetween(440, frequency)) < 1, `got ${frequency}`);
});

test('a tone with many harmonics still gives the fundamental', () => {
  const amps = Array.from({ length: 12 }, (_, k) => 1 / (k + 1)); // sawtooth-like
  const { frequency } = detectPitchYin(tone(220, amps), SR);
  assert.ok(Math.abs(centsBetween(220, frequency)) < 1, `got ${frequency}`);
});

test('a weak fundamental does not cause an octave error', () => {
  // Fundamental 20 dB quieter than the 2nd harmonic.
  const { frequency } = detectPitchYin(tone(110, [0.1, 1, 0.8, 0.25, 0.2]), SR);
  assert.ok(Math.abs(centsBetween(110, frequency)) < 5, `expected ~110 Hz, got ${frequency}`);
});

test('white noise gives no pitch', () => {
  const { frequency } = detectPitchYin(noise(), SR);
  assert.equal(frequency, null);
});

test('silence gives no pitch', () => {
  const { frequency } = detectPitchYin(new Float32Array(SIZE), SR);
  assert.equal(frequency, null);
});

test('pitches outside the chosen range are not reported', () => {
  // 1000 Hz with the range set to 80–400 Hz. YIN may then find the lag of a
  // lower "sub-octave", but it must never report something outside the range.
  const { frequency } = detectPitchYin(tone(1000), SR, { minHz: 80, maxHz: 400 });
  assert.ok(frequency === null || (frequency >= 80 && frequency <= 400), `got ${frequency}`);
});
