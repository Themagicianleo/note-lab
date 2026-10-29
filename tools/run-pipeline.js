// run-pipeline.js
// ------------------------------------------------------------
// Plays a recording through the same PitchTracker the app uses, the way the
// app would: one window of samples about 60 times a second.
// Used by tools/evaluate.js, tools/smoothing-tradeoff.js and the tests.
// ------------------------------------------------------------

import { PitchTracker } from '../js/pitch-tracker.js';
import { bandFilter } from '../js/filters.js';

export const READINGS_PER_SECOND = 60;

// Calls onReading({ time, startSample, result }) for every reading.
//   time        – seconds, at the CENTRE of the window
//   result      – what PitchTracker.process returned
//   filter: true – first remove hiss and rumble outside the pitch band, like
//                  the app's audio graph does (js/filters.js, js/audio-input.js)
export function runPipeline(samples, sampleRate, { windowSize = 2048, filter = false, ...trackerOptions } = {}, onReading) {
  const tracker = new PitchTracker(trackerOptions);
  if (filter) samples = bandFilter(samples, sampleRate, tracker.options.minHz, tracker.options.maxHz);
  const hop = sampleRate / READINGS_PER_SECOND;
  for (let start = 0; start + windowSize <= samples.length; start += hop) {
    const from = Math.round(start);
    const result = tracker.process(samples.subarray(from, from + windowSize), sampleRate, (1000 * (from + windowSize)) / sampleRate);
    onReading({ time: (from + windowSize / 2) / sampleRate, startSample: from, result });
  }
}

