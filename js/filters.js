// filters.js
// ------------------------------------------------------------
// Second-order ("biquad") high-pass and low-pass filters, used to keep only
// the frequencies a voice or instrument's pitch lives in before detection.
// Hiss above the band and rumble below it are removed, so a quiet voice
// stands out more clearly from the microphone's own noise.
//
// Formulas: R. Bristow-Johnson, "Cookbook formulae for audio EQ biquad
// filter coefficients" (the "Audio EQ Cookbook"). The Web Audio API's
// BiquadFilterNode uses the same formulas (W3C Web Audio API spec,
// section "BiquadFilterNode"), so the app (BiquadFilterNode) and the Node
// measurements (this file) filter the same way.
//
//   w0 = 2π · f0 / fs,   α = sin(w0) / (2Q)
//   low-pass:  b0 = (1 − cos w0)/2,  b1 = 1 − cos w0,    b2 = (1 − cos w0)/2
//   high-pass: b0 = (1 + cos w0)/2,  b1 = −(1 + cos w0), b2 = (1 + cos w0)/2
//   both:      a0 = 1 + α,  a1 = −2 cos w0,  a2 = 1 − α
//   y[n] = (b0·x[n] + b1·x[n−1] + b2·x[n−2] − a1·y[n−1] − a2·y[n−2]) / a0
//
// Q = 1/√2 ≈ 0.7071 gives the flattest pass band (a "Butterworth" filter):
// −3 dB at f0, then 12 dB less per octave beyond it.
// NOTE: Web Audio's BiquadFilterNode takes Q in dB for low/high-pass
// (Q_dB = 20·log10(Q)), so Q = 0.7071 is passed to it as −3.01 dB.
// ------------------------------------------------------------

export const BUTTERWORTH_Q = Math.SQRT1_2;

export function biquadCoefficients(type, f0, sampleRate, Q = BUTTERWORTH_Q) {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  let b;
  if (type === 'lowpass') b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === 'highpass') b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else throw new Error(`unknown filter type ${type}`);
  // Divide everything by a0 once, so the filter loop is simpler.
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

// A running filter (keeps its memory between calls, like a BiquadFilterNode).
export class Biquad {
  constructor(type, f0, sampleRate, Q = BUTTERWORTH_Q) {
    this.c = biquadCoefficients(type, f0, sampleRate, Q);
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  // Filter `input` (Float32Array) into a new Float32Array.
  process(input) {
    const { b0, b1, b2, a1, a2 } = this.c;
    const out = new Float32Array(input.length);
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = y;
    }
    Object.assign(this, { x1, x2, y1, y2 });
    return out;
  }
}

// The pass band used before pitch detection, from the search range:
// high-pass a little below the lowest pitch searched (so it isn't weakened),
// low-pass well above the highest (so a few harmonics remain; YIN uses them).
// The factors 0.5 and 4 are this app's choice, checked with tools/sensitivity-check.js.
export function pitchBand(minHz, maxHz) {
  return { highpassHz: 0.5 * minHz, lowpassHz: Math.min(8000, 4 * maxHz) };
}

// The pitch band filter applied to a whole recording (file analysis and the
// measurement tools). In the live app the browser's BiquadFilterNodes do this.
export function bandFilter(samples, sampleRate, minHz, maxHz) {
  const band = pitchBand(minHz, maxHz);
  const highpassed = new Biquad('highpass', band.highpassHz, sampleRate).process(samples);
  return new Biquad('lowpass', band.lowpassHz, sampleRate).process(highpassed);
}

// Gain of a biquad at frequency f (for tests): |H(e^{jw})|.
export function biquadGain(c, f, sampleRate) {
  const w = (2 * Math.PI * f) / sampleRate;
  const re = (k0, k1, k2) => k0 + k1 * Math.cos(w) + k2 * Math.cos(2 * w);
  const im = (k1, k2) => -(k1 * Math.sin(w) + k2 * Math.sin(2 * w));
  const num = Math.hypot(re(c.b0, c.b1, c.b2), im(c.b1, c.b2));
  const den = Math.hypot(re(1, c.a1, c.a2), im(c.a1, c.a2));
  return num / den;
}
