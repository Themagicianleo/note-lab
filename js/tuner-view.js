// tuner-view.js
// ------------------------------------------------------------
// Updates the tuner part of the page: note name, details line,
// sharp/flat needle and the input level (dBFS) meter.
// It only displays things; all the measuring happens elsewhere.
// ------------------------------------------------------------

import { formatNote } from './pitch-math.js';

// The needle turns green within this many cents. This is only a display
// choice for beginners, not a measured accuracy.
export const IN_TUNE_CENTS = 5;

// The level meter shows this range of dBFS.
const METER_MIN_DB = -90;
const METER_MAX_DB = 0;

const byId = (id) => document.getElementById(id);

export function createTunerView() {
  const el = {
    noteName: byId('note-name'),
    noteOctave: byId('note-octave'),
    details: byId('note-details'),
    needle: byId('needle'),
    hint: byId('tuning-hint'),
    levelFill: byId('level-fill'),
    levelGate: byId('level-gate'),
    levelText: byId('level-text'),
    techInfo: byId('tech-info'),
  };

  // Where on the meter (0–100%) a dB value goes.
  const meterPercent = (db) =>
    (100 * (Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, db)) - METER_MIN_DB)) / (METER_MAX_DB - METER_MIN_DB);

  return {
    // Show where the volume gate is on the level meter.
    setGate(gateDb) {
      el.levelGate.style.left = `${meterPercent(gateDb)}%`;
      el.levelGate.title = `Sounds quieter than ${gateDb} dBFS are ignored`;
    },

    setTechInfo(text) {
      el.techInfo.textContent = text;
    },

    // state = { note, reason, levelDb }
    //   note   – result of frequencyToNote, or null
    //   reason – why there is no note: 'quiet' or 'unclear'
    update({ note, reason, levelDb }) {
      // --- level meter ---
      el.levelFill.style.width = `${meterPercent(levelDb)}%`;
      el.levelText.textContent = levelDb <= -100 ? 'silent' : `${levelDb.toFixed(0)} dBFS`;

      // --- no note ---
      if (!note) {
        el.noteName.textContent = '–';
        el.noteOctave.textContent = '';
        el.details.textContent = reason === 'quiet' ? 'No clear note (too quiet)' : 'No clear note';
        el.needle.classList.add('idle');
        el.needle.classList.remove('in-tune');
        el.needle.style.left = '50%';
        el.hint.textContent = reason === 'quiet' ? 'Play or sing a little louder, closer to the mic.' : 'Hold one steady note.';
        return;
      }

      // --- a note ---
      const cents = note.cents;
      el.noteName.textContent = note.name;
      el.noteOctave.textContent = note.octave;
      el.details.textContent = formatNote(note);

      // −50 cents = left edge (0%), 0 = middle (50%), +50 = right edge (100%)
      el.needle.style.left = `${50 + cents}%`;
      el.needle.classList.remove('idle');

      const inTune = Math.abs(cents) <= IN_TUNE_CENTS;
      el.needle.classList.toggle('in-tune', inTune);
      if (inTune) el.hint.textContent = 'In tune';
      else if (cents < 0) el.hint.textContent = 'Flat: a little low, go up';
      else el.hint.textContent = 'Sharp: a little high, go down';
    },
  };
}
