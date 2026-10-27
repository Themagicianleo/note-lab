// smoothing.js
// ------------------------------------------------------------
// Keeps a short history of recent pitch readings and turns it into one
// steady value for the display.
//
// Why: the detector gives a new reading about 60 times a second. Single
// readings can be wrong (a jump to the wrong octave, a consonant, a click),
// and showing every one would make the display flicker.
//
// How:
//   - Remember the last `historySize` readings (null = "no pitch" that frame).
//   - If fewer than `minValid` of them have a pitch → show "no clear note".
//   - Otherwise show the MEDIAN of the valid readings. The median (middle
//     value when sorted) ignores a few odd readings completely, unlike an
//     average, which would be pulled towards them.
//
// The trade-off: a longer history is steadier but reacts more slowly
// when you change note. At ~60 readings per second, 7 readings ≈ 0.12 s.
// ------------------------------------------------------------

// Choices for the "Fast ↔ Steady" control. historySize = how many readings
// are remembered; minValid = how many must have a pitch before one is shown.
// At about 60 readings a second, each reading is roughly 17 ms.
export const SMOOTHING_LEVELS = [
  { label: 'Fastest (no smoothing)', historySize: 1, minValid: 1 },
  { label: 'Fast', historySize: 3, minValid: 2 },
  { label: 'Balanced', historySize: 7, minValid: 4 },
  { label: 'Steady', historySize: 15, minValid: 8 },
  { label: 'Steadiest', historySize: 25, minValid: 13 },
];
export const DEFAULT_SMOOTHING_LEVEL = 2; // 'Balanced', the Phase 2 setting

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class PitchSmoother {
  constructor({ historySize = 7, minValid = 4 } = {}) {
    this.historySize = historySize;
    this.minValid = Math.min(minValid, historySize);
    this.history = [];
  }

  // Add the newest reading (a frequency in Hz, or null) and get the smoothed value back.
  push(frequency) {
    this.history.push(frequency > 0 ? frequency : null);
    if (this.history.length > this.historySize) this.history.shift(); // forget the oldest

    const valid = this.history.filter((f) => f !== null);
    if (valid.length < this.minValid) return null;
    return median(valid);
  }

  reset() {
    this.history = [];
  }
}
