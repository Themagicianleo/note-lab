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

// ============================================================
// 2. Harmonics
// ============================================================
// Harmonic series: an ideal periodic sound with fundamental f₀ contains only
// the frequencies
//     f_n = n · f₀      (n = 1, 2, 3, …)
// This follows from Fourier's theorem: any periodic signal is a sum of sines
// at whole-number multiples of its fundamental. Real instruments are close to
// this; stiff strings (e.g. piano) have harmonics slightly sharp
// ("inharmonicity"), which is why the measured cents offset is shown.
// Example: f₀ = 220 Hz → 220, 440, 660, 880 Hz …
//
// Relative level in decibels: L = 20 · log10(a / a_ref)
//   a, a_ref: amplitudes (any consistent unit). Half the amplitude → −6.02 dB.

export const harmonicFrequency = (f0, n) => n * f0;
export const relativeDb = (amplitude, reference) => 20 * Math.log10(amplitude / reference);

// Measure harmonics 1…count in a spectrum ({ db, binHz } from spectrum.js).
// For each harmonic, look for the loudest bin near n·f₀ (within ±3%, at least
// ±3 bins, at most ±40% of f₀ so neighbouring harmonics don't get mixed up),
// then refine its frequency between bins with a parabola.
// Returns [{ n, expectedHz, found, hz, db, centsOff }] (dB values are dBFS).
export function measureHarmonics({ db, binHz }, f0, { count = 10, floorDb = -90 } = {}) {
  const result = [];
  for (let n = 1; n <= count; n++) {
    const expectedHz = n * f0;
    const halfWidth = Math.min(0.4 * f0, Math.max(3 * binHz, 0.03 * expectedHz));
    const lo = Math.max(1, Math.floor((expectedHz - halfWidth) / binHz));
    const hi = Math.min(db.length - 2, Math.ceil((expectedHz + halfWidth) / binHz));
    if (lo >= hi) { result.push({ n, expectedHz, found: false }); continue; }
    let k = lo;
    for (let i = lo; i <= hi; i++) if (db[i] > db[k]) k = i;
    // Must be a real peak (higher than both neighbours) and above the noise floor.
    if (!(db[k] > floorDb && db[k] >= db[k - 1] && db[k] >= db[k + 1])) { result.push({ n, expectedHz, found: false }); continue; }
    const a = db[k - 1], b = db[k], c = db[k + 1];
    const curve = a - 2 * b + c;
    const offset = curve < 0 ? (0.5 * (a - c)) / curve : 0;
    const hz = (k + offset) * binHz;
    result.push({ n, expectedHz, found: true, hz, db: b - 0.25 * (a - c) * offset, centsOff: 1200 * Math.log2(hz / expectedHz) });
  }
  return result;
}

// Express each found harmonic relative to the loudest one (loudest = 0 dB).
export function relativeToLoudest(harmonics) {
  const levels = harmonics.filter((h) => h.found).map((h) => h.db);
  const loudest = levels.length ? Math.max(...levels) : 0;
  return harmonics.map((h) => ({ ...h, relDb: h.found ? h.db - loudest : null }));
}

// Calculated references: harmonic amplitudes from the Fourier series of
// standard waveforms (amplitude of harmonic n, relative to the fundamental).
//   sine:     only n = 1
//   square:   odd n only, amplitude 1/n      (Fourier series of a square wave)
//   sawtooth: every n, amplitude 1/n         (Fourier series of a sawtooth)
//   app tone: the tone Note Lab's ear training plays (js/tone-player.js)
export const REFERENCE_TONES = {
  sine: { label: 'Sine (pure tone)', amplitude: (n) => (n === 1 ? 1 : 0) },
  square: { label: 'Square wave', amplitude: (n) => (n % 2 === 1 ? 1 / n : 0) },
  sawtooth: { label: 'Sawtooth wave', amplitude: (n) => 1 / n },
  app: { label: "Note Lab's training tone", amplitude: (n) => [0, 1, 0.5, 0.25, 0.12, 0.06][n] || 0 },
};

// A reference's harmonics in the same shape as relativeToLoudest() output.
export function referenceHarmonics(key, f0, count = 10) {
  const amp = REFERENCE_TONES[key].amplitude;
  const loudest = Math.max(...Array.from({ length: count }, (_, i) => amp(i + 1)));
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const a = amp(n);
    return { n, expectedHz: n * f0, hz: n * f0, found: a > 0, relDb: a > 0 ? relativeDb(a, loudest) : null, centsOff: 0 };
  });
}

// ============================================================
// 3. Beats
// ============================================================
// Two tones played together:
//   sin(2π f₁ t) + sin(2π f₂ t) = 2 · cos(π (f₁ − f₂) t) · sin(π (f₁ + f₂) t)
// (the trigonometric sum-to-product identity). So you hear a tone at the
// average frequency (f₁ + f₂)/2 whose loudness swells and fades. The
// loudness peaks whenever |cos(…)| = 1, which happens |f₁ − f₂| times a second:
//   beat frequency  f_beat = |f₁ − f₂|      (Hz)
//   beat period     T_beat = 1 / f_beat     (s)
// Example: f₁ = 440 Hz, f₂ = 443 Hz → f_beat = 3 Hz, T_beat = 0.333 s, heard pitch 441.5 Hz.

export const beatFrequency = (f1, f2) => Math.abs(f1 - f2);
export const beatPeriod = (f1, f2) => (f1 === f2 ? Infinity : 1 / Math.abs(f1 - f2));
export const averageFrequency = (f1, f2) => (f1 + f2) / 2;

// The two tones added together (each with amplitude 1), at time t (s).
export const twoToneSum = (t, f1, f2) => Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t);
// Its envelope (the swelling and fading outline): |2 · cos(π (f₁ − f₂) t)|
export const beatEnvelope = (t, f1, f2) => Math.abs(2 * Math.cos(Math.PI * (f1 - f2) * t));
