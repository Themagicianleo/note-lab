// pitch-tracker.js
// ------------------------------------------------------------
// The whole "sound in → pitch out" pipeline in one place, used by the app,
// by tools/evaluate.js and by the tests, so they all measure the same thing.
//
// For each new buffer of samples:
//   1. level in dBFS
//   2. volume gate: quieter than the threshold → "too quiet", skip detection.
//      The threshold is either fixed (gateDb) or automatic (autoGate: just
//      above the room's noise, see js/noise-floor.js)
//   3. YIN, searching only between minHz and maxHz (in "high" sensitivity,
//      with the YIN paper's fallback for less clear sounds, see js/yin.js)
//   4. smoothing (median of recent readings)
//
// (The band filter that removes hiss and rumble before all this runs in the
// browser's audio graph, see js/audio-input.js, and in tools/run-pipeline.js.)
// ------------------------------------------------------------

import { detectPitchYin, YIN_DEFAULTS } from './yin.js';
import { PitchSmoother, SMOOTHING_LEVELS, DEFAULT_SMOOTHING_LEVEL } from './smoothing.js';
import { levelDb } from './level.js';
import { NoiseFloor } from './noise-floor.js';

export const DEFAULT_GATE_DB = -60;

// The sensitivity settings (Settings page). Measured in tools/sensitivity-check.js
// and tools/polyphonic-check.js (see README, "Sensitivity"):
//   standard – fixed volume threshold (Settings sliders): the old behaviour
//   high     – automatic threshold just above the room's noise (default; this
//              plus the band filter is what makes built-in mics work)
//   maximum  – also accepts less clear sounds (the YIN fallback, 0.20): picks up
//              even quieter singing, BUT with music or chords it shows wrong
//              notes most of the time instead of "no clear pitch"
// (The band filter is used in all three.)
export const SENSITIVITY = {
  standard: { autoGate: false, fallbackThreshold: null },
  high: { autoGate: true, fallbackThreshold: null },
  maximum: { autoGate: true, fallbackThreshold: 0.20, subharmonicTolerance: 0.05 },
};

const READING_MS = 1000 / 60; // assumed time between readings when none is given

export class PitchTracker {
  constructor(options = {}) {
    this.options = {
      minHz: YIN_DEFAULTS.minHz,
      maxHz: YIN_DEFAULTS.maxHz,
      gateDb: DEFAULT_GATE_DB,
      smoothingLevel: DEFAULT_SMOOTHING_LEVEL,
      autoGate: false,
      fallbackThreshold: null,
      subharmonicTolerance: YIN_DEFAULTS.subharmonicTolerance,
      detect: detectPitchYin, // can be swapped for comparison (see tools/evaluate.js)
    };
    this.noiseFloor = new NoiseFloor();
    this.clock = 0;
    this.configure(options);
  }

  // Change settings. Changing the range or the smoothing starts the history
  // afresh, so old readings from the previous setting don't linger.
  // (The noise floor is kept: the room hasn't changed.)
  configure(changes) {
    this.options = { ...this.options, ...changes };
    const level = SMOOTHING_LEVELS[this.options.smoothingLevel] || SMOOTHING_LEVELS[DEFAULT_SMOOTHING_LEVEL];
    this.smoother = new PitchSmoother(level);
  }

  reset() {
    this.smoother.reset();
    this.noiseFloor.reset();
  }

  // Process one buffer (timeMs: when, for the automatic threshold; optional). Returns:
  //   levelDb    – loudness in dBFS
  //   gateDb     – the volume threshold used for this reading
  //   frequency  – this reading's pitch in Hz, or null (before smoothing)
  //   confidence – 0..1 from the detector (0 when too quiet)
  //   smoothed   – the steady pitch to display, or null
  //   reason     – when smoothed is null: 'quiet' (below the gate) or 'unclear'
  process(samples, sampleRate, timeMs) {
    const { minHz, maxHz, detect, autoGate, fallbackThreshold, subharmonicTolerance } = this.options;
    this.clock = timeMs === undefined ? this.clock + READING_MS : timeMs;
    const db = levelDb(samples);
    const gateDb = autoGate ? this.noiseFloor.gateDb : this.options.gateDb;

    let frequency = null;
    let confidence = 0;
    const quiet = db < gateDb;
    if (!quiet) {
      const result = detect(samples, sampleRate, { minHz, maxHz, fallbackThreshold, subharmonicTolerance });
      frequency = result.frequency;
      confidence = result.confidence;
    }

    // Only sound without a clear pitch teaches the automatic threshold what the room sounds like.
    if (frequency === null) this.noiseFloor.push(db, this.clock);

    const smoothed = this.smoother.push(frequency);
    return {
      levelDb: db,
      gateDb,
      frequency,
      confidence,
      smoothed,
      reason: smoothed ? null : quiet ? 'quiet' : 'unclear',
    };
  }
}
