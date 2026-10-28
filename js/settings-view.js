// settings-view.js
// ------------------------------------------------------------
// The parts of the Settings page that aren't voice settings: reference pitch
// (A4), the tuner's volume threshold, and resetting saved data.
// (The voice controls on the same page are handled by voice-view.js.)
// ------------------------------------------------------------

import { A4_SUGGESTIONS, validateA4 } from './settings.js';
import { noteToFrequency } from './pitch-math.js';

const byId = (id) => document.getElementById(id);

export function createSettingsView({ onA4Change, onPlayA4, onTunerGateChange, onResetScores, onResetSettings }) {
  const el = {
    a4: byId('a4-input'),
    suggestions: byId('a4-suggestions'),
    error: byId('a4-error'),
    preview: byId('a4-preview'),
    play: byId('a4-play'),
    gate: byId('tuner-gate-slider'),
    gateValue: byId('tuner-gate-value'),
    resetScores: byId('reset-scores'),
    resetSettings: byId('reset-settings'),
    dataMessage: byId('data-message'),
  };

  // e.g. "With A4 = 442 Hz: C4 = 262.8 Hz, E4 = 330.6 Hz"
  function showPreview(a4) {
    const hz = (name, octave) => noteToFrequency(name, octave, a4).toFixed(1);
    el.preview.textContent = `With A4 = ${a4} Hz: C4 = ${hz('C', 4)} Hz, E4 = ${hz('E', 4)} Hz, A3 = ${hz('A', 3)} Hz`;
  }

  function applyA4(value) {
    const check = validateA4(value);
    el.error.hidden = check.ok;
    el.error.textContent = check.ok ? '' : check.error;
    if (!check.ok) return;
    el.a4.value = check.a4;
    showPreview(check.a4);
    onA4Change(check.a4);
  }

  for (const hz of A4_SUGGESTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-small';
    button.textContent = `${hz} Hz`;
    button.addEventListener('click', () => applyA4(hz));
    el.suggestions.append(button);
  }

  el.a4.addEventListener('change', () => applyA4(el.a4.value));
  el.play.addEventListener('click', () => onPlayA4());
  el.gate.addEventListener('input', () => {
    el.gateValue.textContent = `${el.gate.value} dBFS`;
    onTunerGateChange(Number(el.gate.value));
  });
  el.resetScores.addEventListener('click', () => {
    onResetScores();
    el.dataMessage.textContent = 'Training scores reset.';
  });
  el.resetSettings.addEventListener('click', () => {
    onResetSettings();
    el.dataMessage.textContent = 'Settings reset to defaults.';
  });

  return {
    setControls({ a4, tunerGateDb }) {
      el.a4.value = a4;
      el.error.hidden = true;
      showPreview(a4);
      el.gate.value = tunerGateDb;
      el.gateValue.textContent = `${tunerGateDb} dBFS`;
    },
  };
}
