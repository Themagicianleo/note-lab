// voice-view.js
// ------------------------------------------------------------
// The voice part of the page: the current pitch, its clarity, the range
// finder results and the voice settings (range, volume threshold, smoothing).
// When a setting changes, it calls the matching function passed in.
// ------------------------------------------------------------

import { formatNote, noteNumberToName, noteNumberToFrequency } from './pitch-math.js';
import { validateCustomRange } from './voice-ranges.js';
import { SMOOTHING_LEVELS } from './smoothing.js';
import { describeSpan } from './range-finder.js';

const byId = (id) => document.getElementById(id);

// 43 → "G2 (98.0 Hz)"
function noteLabel(noteNumber, a4) {
  const { name, octave } = noteNumberToName(noteNumber);
  return `${name}${octave} (${noteNumberToFrequency(noteNumber, a4).toFixed(1)} Hz)`;
}

export function createVoiceView({ onRangeChange, onGateChange, onSmoothingChange, onResetRange }) {
  const el = {
    note: byId('voice-note'),
    details: byId('voice-details'),
    clarity: byId('voice-clarity'),
    low: byId('range-low'),
    high: byId('range-high'),
    span: byId('range-span'),
    reset: byId('range-reset'),
    presets: document.querySelectorAll('input[name="voice-preset"]'),
    customMin: byId('custom-min'),
    customMax: byId('custom-max'),
    customApply: byId('custom-apply'),
    rangeError: byId('range-error'),
    rangeDescription: byId('range-description'),
    gateSlider: byId('gate-slider'),
    gateValue: byId('gate-value'),
    smoothingSlider: byId('smoothing-slider'),
    smoothingValue: byId('smoothing-value'),
  };

  // --- detection range ---
  function applyCustom() {
    const check = validateCustomRange(el.customMin.value, el.customMax.value);
    el.rangeError.hidden = check.ok;
    el.rangeError.textContent = check.ok ? '' : check.error;
    if (check.ok) onRangeChange({ preset: 'custom', minHz: check.minHz, maxHz: check.maxHz });
  }
  el.presets.forEach((radio) => radio.addEventListener('change', () => {
    if (radio.value === 'custom') applyCustom();
    else {
      el.rangeError.hidden = true;
      onRangeChange({ preset: radio.value });
    }
  }));
  el.customApply.addEventListener('click', () => {
    document.querySelector('input[name="voice-preset"][value="custom"]').checked = true;
    applyCustom();
  });

  // --- volume threshold ---
  el.gateSlider.addEventListener('input', () => {
    const db = Number(el.gateSlider.value);
    el.gateValue.textContent = `${db} dBFS`;
    onGateChange(db);
  });

  // --- smoothing ---
  el.smoothingSlider.addEventListener('input', () => {
    const level = Number(el.smoothingSlider.value);
    el.smoothingValue.textContent = SMOOTHING_LEVELS[level].label;
    onSmoothingChange(level);
  });

  el.reset.addEventListener('click', () => onResetRange());

  return {
    // note: from frequencyToNote or null · reason: 'quiet' | 'unclear' · confidence: 0..1
    update({ note, reason, confidence }) {
      if (note) {
        el.note.textContent = `${note.name}${note.octave}`;
        el.details.textContent = formatNote(note).split(' · ').slice(1).join(' · '); // "98.0 Hz · −3 cents"
      } else {
        el.note.textContent = '–';
        el.details.textContent = reason === 'quiet'
          ? 'No clear pitch: too quiet (below the volume threshold)'
          : 'No clear pitch: breath, noise or a consonant';
      }
      // Clarity = how periodic the latest sound is (the detector's confidence).
      el.clarity.textContent = reason === 'quiet' && !note ? 'Clarity –' : `Clarity ${Math.round(confidence * 100)}%`;
    },

    showRange(finder, a4) {
      el.low.textContent = finder.lowest === null ? '–' : noteLabel(finder.lowest, a4);
      el.high.textContent = finder.highest === null ? '–' : noteLabel(finder.highest, a4);
      el.span.textContent = finder.semitones === null ? '–' : describeSpan(finder.semitones);
    },

    setRangeDescription(text) {
      el.rangeDescription.textContent = text;
    },

    // Show saved settings in the controls (they live on the Settings page).
    setControls({ voicePreset, voiceMinHz, voiceMaxHz, voiceGateDb, smoothingLevel }) {
      el.presets.forEach((radio) => { radio.checked = radio.value === voicePreset; });
      el.customMin.value = voiceMinHz;
      el.customMax.value = voiceMaxHz;
      el.rangeError.hidden = true;
      el.gateSlider.value = voiceGateDb;
      el.gateValue.textContent = `${voiceGateDb} dBFS`;
      el.smoothingSlider.value = smoothingLevel;
      el.smoothingValue.textContent = SMOOTHING_LEVELS[smoothingLevel].label;
    },
  };
}
