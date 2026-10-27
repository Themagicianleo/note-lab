// Tests for js/voice-ranges.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_PRESETS, validateCustomRange, describeRange } from '../js/voice-ranges.js';
import { noteToFrequency } from '../js/pitch-math.js';

test('presets cover typical speaking and singing ranges', () => {
  const covers = (preset, lowHz, highHz) => preset.minHz <= lowHz && preset.maxHz >= highHz;
  assert.ok(covers(VOICE_PRESETS.low, 85, noteToFrequency('E', 4)), 'low: men speaking up to bass top E4');
  assert.ok(covers(VOICE_PRESETS.low, noteToFrequency('E', 2), 155), 'low: bass bottom E2');
  assert.ok(covers(VOICE_PRESETS.mid, noteToFrequency('C', 3), noteToFrequency('F', 5)), 'mid: tenor C3 to alto F5');
  assert.ok(covers(VOICE_PRESETS.high, 165, noteToFrequency('C', 6)), 'high: women speaking to soprano C6');
});

test('every preset passes the custom-range rules too', () => {
  for (const p of Object.values(VOICE_PRESETS)) {
    assert.equal(validateCustomRange(p.minHz, p.maxHz).ok, true, p.label);
  }
});

test('custom range: good values are accepted', () => {
  assert.deepEqual(validateCustomRange('80', '400'), { ok: true, minHz: 80, maxHz: 400 });
});

test('custom range: bad values give a plain message', () => {
  assert.match(validateCustomRange('abc', 400).error, /numbers/);
  assert.match(validateCustomRange(20, 400).error, /lower than 40/);
  assert.match(validateCustomRange(100, 3000).error, /higher than 2000/);
  assert.match(validateCustomRange(200, 250).error, /at least 1.5/);
  assert.match(validateCustomRange(400, 100).error, /at least 1.5/); // min and max swapped
});

test('describeRange gives note names', () => {
  assert.equal(describeRange(65, 500), 'C2 (65 Hz) – B4 (500 Hz)');
  assert.equal(describeRange(110, 440), 'A2 (110 Hz) – A4 (440 Hz)');
});
