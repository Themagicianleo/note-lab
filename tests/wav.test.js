// Tests for tools/wav.js: write a file, read it back, check nothing changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWav, readWav } from '../tools/wav.js';

test('a WAV file reads back with the same sample rate and samples', () => {
  const dir = mkdtempSync(join(tmpdir(), 'note-lab-'));
  try {
    const path = join(dir, 'tone.wav');
    const sampleRate = 48000;
    const samples = new Float32Array(4800);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    writeWav(path, samples, sampleRate);
    const result = readWav(path);

    assert.equal(result.sampleRate, sampleRate);
    assert.equal(result.samples.length, samples.length);
    // 16-bit storage rounds each sample by at most 1/32768.
    for (let i = 0; i < samples.length; i++) {
      assert.ok(Math.abs(result.samples[i] - samples[i]) < 1 / 32000, `sample ${i}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
