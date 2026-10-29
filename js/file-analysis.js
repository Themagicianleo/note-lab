// file-analysis.js
// ------------------------------------------------------------
// Draw the pitch line of an audio FILE (one you choose on your device),
// using exactly the same pipeline as the live monitor (js/pitch-tracker.js).
// The file is read and analysed in this page; it is never uploaded.
//
// It steps through the sound like the live monitor does: every `hopSec`
// seconds, take the `windowSize` samples ending there and detect the pitch.
// The work is split into chunks, with a pause between them, so the page
// stays responsive and can show progress.
// ------------------------------------------------------------

import { PitchTracker } from './pitch-tracker.js';

export const FILE_HOP_SEC = 1 / 60;       // same reading rate as the live monitor
export const MAX_FILE_SECONDS = 600;      // 10 minutes

// Average the channels into one (mono).
export function mixToMono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

// samples: Float32Array (mono). trackerOptions: { minHz, maxHz, gateDb, smoothingLevel, windowSize }.
// Returns readings [{ t (ms from the start), hz (smoothed or null), raw }].
// onProgress(0..1) is called between chunks; shouldStop() can cancel (returns null).
export async function analyseSamples(samples, sampleRate, trackerOptions, { hopSec = FILE_HOP_SEC, onProgress = () => {}, shouldStop = () => false } = {}) {
  const { windowSize = 2048, ...options } = trackerOptions;
  const tracker = new PitchTracker(options);
  const hop = hopSec * sampleRate;
  const readings = [];
  const total = Math.max(0, Math.floor((samples.length - windowSize) / hop) + 1);
  const CHUNK = 240; // readings per chunk (4 s of sound)
  for (let k = 0; k < total; k++) {
    const start = Math.round(k * hop);
    const result = tracker.process(samples.subarray(start, start + windowSize), sampleRate);
    // Time of the reading = the END of its window (as live: the newest samples).
    readings.push({ t: (1000 * (start + windowSize)) / sampleRate, hz: result.smoothed, raw: result.frequency });
    if (k % CHUNK === CHUNK - 1) {
      onProgress(k / total);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (shouldStop()) return null;
    }
  }
  onProgress(1);
  return readings;
}
