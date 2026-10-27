// level.js
// ------------------------------------------------------------
// Loudness of a piece of sound, in dBFS ("decibels relative to full scale").
//
//   0 dBFS   = the loudest sound the input can represent
//   −20 dBFS = 10 times smaller in amplitude
//   −60 dBFS = 1000 times smaller (very quiet)
//
// This is NOT the "dB" of a sound level meter (dB SPL, like "70 dB").
// A phone or laptop mic is not calibrated, and the device may change its
// own sensitivity, so dBFS only tells you how loud the sound is *to this
// microphone right now*.
// ------------------------------------------------------------

// The lowest value we report. Real silence would be −∞, which is not useful on screen.
export const MIN_DB = -100;

// RMS ("root mean square") = a typical size of the samples:
// square each sample, take the average, then the square root.
export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

// Amplitude (0..1) → dBFS.  dB = 20 × log10(amplitude)
export function amplitudeToDb(amplitude) {
  if (!(amplitude > 0)) return MIN_DB;
  return Math.max(MIN_DB, 20 * Math.log10(amplitude));
}

// The level of a buffer in dBFS (based on RMS).
export function levelDb(samples) {
  return amplitudeToDb(rms(samples));
}
