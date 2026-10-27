// Tests for js/settings.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings, validateA4, voiceRange } from '../js/settings.js';

test('nothing saved → defaults', () => {
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings('broken'), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.a4, 440);
});

test('good saved values are kept', () => {
  const s = validateSettings({ a4: 442, tunerRange: 'low', tunerGateDb: -50, voicePreset: 'high', voiceGateDb: -45, smoothingLevel: 4 });
  assert.equal(s.a4, 442);
  assert.equal(s.tunerRange, 'low');
  assert.equal(s.tunerGateDb, -50);
  assert.equal(s.voicePreset, 'high');
  assert.equal(s.voiceGateDb, -45);
  assert.equal(s.smoothingLevel, 4);
});

test('bad saved values fall back to the default, one by one', () => {
  const s = validateSettings({ a4: 9999, tunerRange: 'huge', tunerGateDb: 5, voicePreset: 'alien', smoothingLevel: 99, voiceGateDb: 'loud' });
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('custom voice range is kept only if valid', () => {
  assert.deepEqual(voiceRange(validateSettings({ voicePreset: 'custom', voiceMinHz: 90, voiceMaxHz: 300 })), { minHz: 90, maxHz: 300 });
  const bad = validateSettings({ voicePreset: 'custom', voiceMinHz: 300, voiceMaxHz: 310 });
  assert.equal(bad.voicePreset, 'mid');
  assert.deepEqual(voiceRange(bad), { minHz: 100, maxHz: 800 });
});

test('typed reference pitch', () => {
  assert.deepEqual(validateA4('442'), { ok: true, a4: 442 });
  assert.deepEqual(validateA4('441.25'), { ok: true, a4: 441.3 });
  assert.equal(validateA4('44').ok, false);
  assert.equal(validateA4('abc').ok, false);
});
