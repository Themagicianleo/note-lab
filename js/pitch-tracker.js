// pitch-tracker.js
// ------------------------------------------------------------
// The whole "sound in → pitch out" pipeline in one place, used by the app,
// by tools/evaluate.js and by the tests, so they all measure the same thing.
//
// For each new buffer of samples:
//   1. level in dBFS
//   2. volume gate: quieter than gateDb → "too quiet", skip detection
//   3. YIN, searching only between minHz and maxHz
//   4. smoothing (median of recent readings)
// ------------------------------------------------------------

import { detectPitchYin, YIN_DEFAULTS } from './yin.js';
import { PitchSmoother, SMOOTHING_LEVELS, DEFAULT_SMOOTHING_LEVEL } from './smoothing.js';
import { levelDb } from './level.js';

export const DEFAULT_GATE_DB = -60;

export class PitchTracker {
  constructor(options = {}) {
    this.options = {
      minHz: YIN_DEFAULTS.minHz,
      maxHz: YIN_DEFAULTS.maxHz,
      gateDb: DEFAULT_GATE_DB,
      smoothingLevel: DEFAULT_SMOOTHING_LEVEL,
      detect: detectPitchYin, // can be swapped for comparison (see tools/evaluate.js)
    };
    this.configure(options);
  }

  // Change settings. Changing the range or the smoothing starts the history
  // afresh, so old readings from the previous setting don't linger.
  configure(changes) {
    this.options = { ...this.options, ...changes };
    const level = SMOOTHING_LEVELS[this.options.smoothingLevel] || SMOOTHING_LEVELS[DEFAULT_SMOOTHING_LEVEL];
    this.smoother = new PitchSmoother(level);
  }

  reset() {
    this.smoother.reset();
  }

  // Process one buffer. Returns:
  //   levelDb    – loudness in dBFS
  //   frequency  – this reading's pitch in Hz, or null (before smoothing)
  //   confidence – 0..1 from the detector (0 when too quiet)
  //   smoothed   – the steady pitch to display, or null
  //   reason     – when smoothed is null: 'quiet' (below the gate) or 'unclear'
  process(samples, sampleRate) {
    const { minHz, maxHz, gateDb, detect } = this.options;
    const db = levelDb(samples);

    let frequency = null;
    let confidence = 0;
    const quiet = db < gateDb;
    if (!quiet) {
      const result = detect(samples, sampleRate, { minHz, maxHz });
      frequency = result.frequency;
      confidence = result.confidence;
    }

    const smoothed = this.smoother.push(frequency);
    return {
      levelDb: db,
      frequency,
      confidence,
      smoothed,
      reason: smoothed ? null : quiet ? 'quiet' : 'unclear',
    };
  }
}
