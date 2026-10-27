// Tests for js/range-finder.js, including one run on a generated recording.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RangeFinder, describeSpan } from '../js/range-finder.js';
import { readWav } from '../tools/wav.js';
import { runPipeline } from '../tools/run-pipeline.js';
import { VOICE_PRESETS } from '../js/voice-ranges.js';

// Feed one frequency for `ms` milliseconds at 60 readings per second.
function hold(finder, hz, ms, clock) {
  for (let t = 0; t < ms; t += 1000 / 60) finder.push(hz, clock.now += 1000 / 60);
}

test('a note held for 0.3 s is recorded', () => {
  const f = new RangeFinder();
  const clock = { now: 0 };
  hold(f, 220, 400, clock);
  assert.equal(f.lowest, 57);  // A3
  assert.equal(f.highest, 57);
});

test('a note held for only 0.2 s is ignored', () => {
  const f = new RangeFinder();
  hold(f, 220, 200, { now: 0 });
  assert.equal(f.lowest, null);
});

test('vibrato of ±30 cents still counts as one held note', () => {
  const f = new RangeFinder();
  let now = 0;
  for (let i = 0; i < 30; i++) { // 0.5 s
    const cents = 30 * Math.sin(i / 2);
    f.push(220 * Math.pow(2, cents / 1200), now += 1000 / 60);
  }
  assert.equal(f.lowest, 57);
});

test('silence breaks the hold', () => {
  const f = new RangeFinder();
  const clock = { now: 0 };
  hold(f, 220, 200, clock);
  f.push(null, clock.now += 17);
  hold(f, 220, 200, clock);
  assert.equal(f.lowest, null);
});

test('records lowest and highest across several notes', () => {
  const f = new RangeFinder();
  const clock = { now: 0 };
  for (const hz of [196, 440, 110, 330]) { hold(f, hz, 400, clock); f.push(null, clock.now += 17); }
  assert.equal(f.lowest, 45);  // A2 = 110 Hz
  assert.equal(f.highest, 69); // A4 = 440 Hz
  assert.equal(f.semitones, 24);
});

test('a quick slide through notes does not count them', () => {
  const f = new RangeFinder();
  let now = 0;
  for (let i = 0; i < 60; i++) f.push(110 * Math.pow(2, i / 60), now += 1000 / 60); // A2→A3 in 1 s
  assert.equal(f.lowest, null);
});

test('describeSpan', () => {
  assert.equal(describeSpan(19), '1 octave + 7 semitones');
  assert.equal(describeSpan(24), '2 octaves');
  assert.equal(describeSpan(1), '1 semitone');
  assert.equal(describeSpan(0), '0 semitones');
});

test('generated scale C4–G4 through the full pipeline gives range C4 to G4', () => {
  const { sampleRate, samples } = readWav(new URL('../test-audio/generated/voice-scale-C4-G4.wav', import.meta.url).pathname);
  const finder = new RangeFinder();
  const preset = VOICE_PRESETS.mid;
  runPipeline(samples, sampleRate, { minHz: preset.minHz, maxHz: preset.maxHz }, ({ time, result }) => {
    finder.push(result.smoothed, time * 1000);
  });
  assert.equal(finder.lowest, 60);  // C4
  assert.equal(finder.highest, 67); // G4
});

test('generated slide C3→C4: only the held ends count, not the notes slid through', () => {
  const { sampleRate, samples } = readWav(new URL('../test-audio/generated/voice-glide-C3-C4.wav', import.meta.url).pathname);
  const finder = new RangeFinder();
  const recorded = new Set();
  runPipeline(samples, sampleRate, { minHz: 65, maxHz: 500 }, ({ time, result }) => {
    finder.push(result.smoothed, time * 1000);
    if (finder.candidate && finder.candidate.counted) recorded.add(finder.candidate.note);
  });
  assert.equal(finder.lowest, 48);  // C3
  assert.equal(finder.highest, 60); // C4
  assert.deepEqual([...recorded].sort(), [48, 60], `notes counted as held: ${[...recorded]}`);
});
