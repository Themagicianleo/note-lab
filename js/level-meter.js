// level-meter.js
// ------------------------------------------------------------
// The input level (dBFS) meter shared by every mode, with a thin line
// showing the volume threshold.
// ------------------------------------------------------------

import { MIN_DB } from './level.js';

const METER_MIN_DB = -90;
const METER_MAX_DB = 0;

// Where on the meter (0–100%) a dB value goes.
export function meterPercent(db) {
  const clamped = Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, db));
  return (100 * (clamped - METER_MIN_DB)) / (METER_MAX_DB - METER_MIN_DB);
}

export function createLevelMeter() {
  const fill = document.getElementById('level-fill');
  const gate = document.getElementById('level-gate');
  const text = document.getElementById('level-text');

  return {
    setGate(gateDb) {
      gate.style.left = `${meterPercent(gateDb)}%`;
      gate.title = `Sounds quieter than ${gateDb} dBFS are ignored`;
    },
    update(levelDb) {
      fill.style.width = `${meterPercent(levelDb)}%`;
      text.textContent = levelDb <= MIN_DB ? 'silent' : `${levelDb.toFixed(0)} dBFS`;
    },
  };
}
