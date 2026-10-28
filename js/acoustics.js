// acoustics.js
// ------------------------------------------------------------
// The maths behind the Acoustics Lab. Pure functions, no browser code, so
// every one can be tested in Node (tests/acoustics.test.js) and checked by
// hand. Each section says where its formula comes from.
//
// Units: seconds (s), metres (m), hertz (Hz), degrees Celsius (°C),
// newtons (N), kilograms (kg). Sound levels from the microphone are dBFS:
// relative to the input's maximum, NOT calibrated sound pressure level.
// ------------------------------------------------------------

// ============================================================
// 1. Waveform: period and frequency
// ============================================================
// Definition of frequency: f = 1 / T
//   f = frequency in Hz (cycles per second), T = period in seconds (one cycle)
// Example: T = 2.2727 ms = 0.0022727 s → f = 1 / 0.0022727 = 440 Hz.

export const frequencyFromPeriod = (periodSeconds) => 1 / periodSeconds;
export const periodFromFrequency = (frequencyHz) => 1 / frequencyHz;

// Find where the wave next crosses zero going UP ("rising edge"), searching
// samples[from] … samples[to − 1]. Oscilloscopes start drawing here so a
// repeating wave stands still on screen instead of jittering ("triggering").
// `hysteresis`: the wave must first go below −hysteresis, so tiny noise
// wiggles around zero don't count as crossings.
// Returns the position in samples (with a fraction, found by drawing a
// straight line between the two samples either side of zero), or −1.
export function findRisingCrossing(samples, from = 0, to = samples.length, hysteresis = 0.01) {
  let armed = false;
  for (let i = Math.max(1, from); i < to; i++) {
    if (samples[i - 1] < -hysteresis) armed = true;
    if (armed && samples[i - 1] < 0 && samples[i] >= 0) {
      const before = samples[i - 1];
      const after = samples[i];
      return i - 1 + (0 - before) / (after - before);
    }
  }
  return -1;
}

// Largest absolute sample value (0 … 1, where 1 = full scale).
export function peakAmplitude(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}
