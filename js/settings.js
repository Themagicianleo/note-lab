// settings.js
// ------------------------------------------------------------
// All user settings in one place, with their defaults, and checks so a
// broken or old saved value can never break the app (it falls back to the
// default instead). Saved on this device only, via js/storage.js.
// ------------------------------------------------------------

import { DEFAULT_A4 } from './pitch-math.js';
import { VOICE_PRESETS, validateCustomRange } from './voice-ranges.js';
import { SMOOTHING_LEVELS, DEFAULT_SMOOTHING_LEVEL } from './smoothing.js';
import { DEFAULT_GATE_DB, SENSITIVITY } from './pitch-tracker.js';

export const SETTINGS_KEY = 'note-lab-settings-v1';

// Reference pitch limits. 440 Hz is the modern standard; orchestras often use
// 441–443; "baroque pitch" is about 415 Hz; some people like 432.
export const A4_LIMITS = { min: 400, max: 480 };
export const A4_SUGGESTIONS = [415, 432, 440, 442];
export const GATE_LIMITS = { min: -80, max: -20 };

export const DEFAULT_SETTINGS = Object.freeze({
  a4: DEFAULT_A4,
  tunerRange: 'standard',       // 'standard' | 'low'
  tunerGateDb: DEFAULT_GATE_DB, // −60 dBFS
  voicePreset: 'mid',           // 'low' | 'mid' | 'high' | 'custom'
  voiceMinHz: 80,
  voiceMaxHz: 400,
  voiceGateDb: -55,             // also used by sing-back
  smoothingLevel: DEFAULT_SMOOTHING_LEVEL,
  sensitivity: 'high',          // 'standard' | 'high' | 'maximum' (see js/pitch-tracker.js)
  voiceSource: 'single',        // Voice tab: 'single' (one voice/instrument) | 'music' (melody guess, js/melody.js)
});

const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

// Take anything (saved data, maybe from an older version, maybe broken) and
// return a complete, valid settings object.
export function validateSettings(input) {
  const s = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== 'object') return s;

  if (inRange(input.a4, A4_LIMITS.min, A4_LIMITS.max)) s.a4 = input.a4;
  if (['standard', 'low'].includes(input.tunerRange)) s.tunerRange = input.tunerRange;
  if (inRange(input.tunerGateDb, GATE_LIMITS.min, GATE_LIMITS.max)) s.tunerGateDb = input.tunerGateDb;
  if (inRange(input.voiceGateDb, GATE_LIMITS.min, GATE_LIMITS.max)) s.voiceGateDb = input.voiceGateDb;
  if (Number.isInteger(input.smoothingLevel) && SMOOTHING_LEVELS[input.smoothingLevel]) s.smoothingLevel = input.smoothingLevel;
  if (Object.prototype.hasOwnProperty.call(SENSITIVITY, input.sensitivity ?? '')) s.sensitivity = input.sensitivity; // (not Object.hasOwn: iOS 15.4+)
  if (['single', 'music'].includes(input.voiceSource)) s.voiceSource = input.voiceSource;

  if (input.voicePreset === 'custom') {
    const check = validateCustomRange(input.voiceMinHz, input.voiceMaxHz);
    if (check.ok) Object.assign(s, { voicePreset: 'custom', voiceMinHz: check.minHz, voiceMaxHz: check.maxHz });
  } else if (VOICE_PRESETS[input.voicePreset]) {
    s.voicePreset = input.voicePreset;
  }
  return s;
}

// Check a reference pitch typed by the user. Returns { ok, a4 } or { ok: false, error }.
export function validateA4(value) {
  const a4 = Number(value);
  if (!inRange(a4, A4_LIMITS.min, A4_LIMITS.max)) {
    return { ok: false, error: `Please enter a number from ${A4_LIMITS.min} to ${A4_LIMITS.max} Hz (440 is standard).` };
  }
  return { ok: true, a4: Math.round(a4 * 10) / 10 }; // one decimal place is plenty
}

// The detection range for voice mode, from the settings.
export function voiceRange(settings) {
  return settings.voicePreset === 'custom'
    ? { minHz: settings.voiceMinHz, maxHz: settings.voiceMaxHz }
    : { minHz: VOICE_PRESETS[settings.voicePreset].minHz, maxHz: VOICE_PRESETS[settings.voicePreset].maxHz };
}
