// Tests for the microphone-processing report in js/audio-input.js
// (the microphone itself needs a browser; see tools/browser-test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMicProcessing } from '../js/audio-input.js';

test('reports off, on and not reported', () => {
  const result = describeMicProcessing({ echoCancellation: false, noiseSuppression: true });
  assert.deepEqual(result.map((r) => r.state), ['off', 'on', 'not reported']);
  assert.deepEqual(result.map((r) => r.label), ['Echo cancellation', 'Noise suppression', 'Automatic gain control']);
});

test('nothing reported at all', () => {
  assert.ok(describeMicProcessing(undefined).every((r) => r.state === 'not reported'));
});
