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

// ============================================================
// 4. Spectrogram: the time–frequency trade-off
// ============================================================
// A spectrogram runs an FFT on short pieces ("windows") of N samples.
//   window duration   Δt = N / fs          (s)   how much time each column covers
//   frequency step    Δf = fs / N          (Hz)  the spacing of the FFT's frequency bins
//   so                Δt × Δf = 1          (always, whatever N you choose)
//   fs = sample rate (samples per second), N = window size (samples)
// A longer window sees frequency more finely but blurs time; a shorter one
// the opposite. This is the discrete-time form of the "uncertainty"
// (Gabor) limit of time-frequency analysis.
// Example: N = 2048, fs = 48 000 Hz → Δt = 2048/48000 = 42.7 ms, Δf = 48000/2048 = 23.4 Hz.
// (With a Hann window, two tones need to be about 2 bins apart to show as
// two separate peaks, so the practical frequency resolution is ~2·Δf.)

export function stftResolution(windowSize, sampleRate) {
  const windowSeconds = windowSize / sampleRate;
  const binHz = sampleRate / windowSize;
  return { windowSeconds, binHz, product: windowSeconds * binHz };
}

// ============================================================
// 5. Pipes and strings
// ============================================================
// Speed of sound in dry air (ideal gas):
//   c = √(γ R T_K / M) = 331.3 · √(1 + T / 273.15)       (m/s)
//   T = air temperature in °C, T_K = T + 273.15 (kelvin), γ = 1.4 (air),
//   R = 8.314 J/(mol·K), M = 0.028964 kg/mol (dry air) → 331.3 m/s at 0 °C.
// Example: T = 20 °C → c = 331.3 · √(1 + 20/273.15) = 343.2 m/s.
// (Humidity makes sound slightly faster, by well under 1% in normal rooms;
// this formula ignores it.)
export const SPEED_OF_SOUND_0C = 331.3;
export const speedOfSound = (temperatureC) => SPEED_OF_SOUND_0C * Math.sqrt(1 + temperatureC / 273.15);

// End correction: the air "sticks out" a little past an open end, so the pipe
// behaves as if longer. For an unflanged open end (a plain tube end):
//   ΔL ≈ 0.6133 · r        r = inner radius (m)
// (Levine & Schwinger, 1948.) Approximate; it also changes slightly with
// frequency. Example: r = 10 mm → ΔL = 6.1 mm.
export const END_CORRECTION_FACTOR = 0.6133;
export const endCorrection = (radius) => END_CORRECTION_FACTOR * radius;

// Pipe open at BOTH ends (flute, open organ pipe): all harmonics.
//   f_n = n · c / (2 · L_eff),   n = 1, 2, 3, …,   L_eff = L + 2ΔL (two open ends)
// Example: L = 0.5 m, 20 °C → f₁ = 343.2 / (2 · 0.5) = 343.2 Hz, f₂ = 686.4 Hz.
export function openPipeModes(length, c, count = 6, deltaL = 0) {
  const effective = length + 2 * deltaL;
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, harmonic: i + 1, hz: ((i + 1) * c) / (2 * effective) }));
}

// Pipe closed at ONE end (clarinet-like, stopped organ pipe): odd harmonics only.
//   f_n = (2n − 1) · c / (4 · L_eff),   L_eff = L + ΔL (one open end)
// Example: L = 0.5 m, 20 °C → f₁ = 343.2 / (4 · 0.5) = 171.6 Hz, next 514.8 Hz (3rd harmonic).
export function closedPipeModes(length, c, count = 6, deltaL = 0) {
  const effective = length + deltaL;
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, harmonic: 2 * i + 1, hz: ((2 * i + 1) * c) / (4 * effective) }));
}

// Stretched string fixed at both ends (Mersenne's laws / wave equation):
//   wave speed  v = √(T / μ)               (m/s)
//   f_n = n · v / (2 · L)                  (Hz)
//   T = tension (N), μ = mass per length (kg/m), L = vibrating length (m)
// Example: L = 0.65 m, T = 70 N, μ = 0.0012 kg/m → v = √(70/0.0012) = 241.5 m/s, f₁ = 241.5 / 1.3 = 185.8 Hz.
export const stringWaveSpeed = (tension, massPerLength) => Math.sqrt(tension / massPerLength);
export function stringModes(length, tension, massPerLength, count = 6) {
  const v = stringWaveSpeed(tension, massPerLength);
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, harmonic: i + 1, hz: ((i + 1) * v) / (2 * length) }));
}

// Mass per length of a solid round string from its diameter and the material
// density (which YOU provide, e.g. from the maker's data):
//   μ = ρ · π · (d / 2)²       ρ = density (kg/m³), d = diameter (m)
// Example: d = 0.43 mm, ρ = 7850 kg/m³ → μ = 7850 · π · (0.000215)² = 0.00114 kg/m.
// (Wound strings are heavier than this for their diameter.)
export const massPerLengthFromDiameter = (diameter, density) => density * Math.PI * (diameter / 2) ** 2;

// The standing-wave shape (displacement amplitude, −1…1) at position x
// (0 = left end, 1 = right end), for drawing:
//   open pipe:   cos(n π x)             antinodes at both open ends
//   closed pipe: sin((2n−1) π x / 2)    node at the closed end (x = 0)
//   string:      sin(n π x)             nodes at both fixed ends
export function modeShape(kind, n, x) {
  if (kind === 'open') return Math.cos(n * Math.PI * x);
  if (kind === 'closed') return Math.sin(((2 * n - 1) * Math.PI * x) / 2);
  return Math.sin(n * Math.PI * x);
}

// ============================================================
// 6. Room modes (rectangular room, rigid walls)
// ============================================================
// Rayleigh's formula for the resonances of a rectangular room with perfectly
// rigid (fully reflecting) walls:
//   f = (c / 2) · √( (n_x / L)² + (n_y / W)² + (n_z / H)² )
//   L, W, H = room length, width, height (m); n_x, n_y, n_z = 0, 1, 2, … (not all 0)
//   c = speed of sound (m/s)
// Axial modes (only one n is non-zero: sound bouncing between one pair of
// opposite walls) are usually the strongest:
//   f = n · c / (2 · L)       (and the same with W or H)
// Tangential modes have two non-zero n, oblique modes three.
// Example: 5 m long room at 20 °C → 343.2 / 10 = 34.3 Hz, then 68.6, 102.96 Hz …
//
// Where an axial mode is quiet: its pressure follows cos(n·π·x/L) along that
// dimension, loudest at the walls, with nulls (silent lines) at
//   x = (2k − 1) · L / (2n),   k = 1 … n
// Example: the 1st length mode of a 5 m room is silent at 2.5 m (the middle).
//
// Schroeder frequency: above roughly this frequency, modes overlap so densely
// that the room behaves "statistically" (no single modes stand out):
//   f_S ≈ 2000 · √(T60 / V)      T60 = reverberation time (s), V = volume (m³)
// (Schroeder, 1962; see Kuttruff, "Room Acoustics".) Example: T60 = 0.5 s, V = 50 m³ → 200 Hz.

const DIMENSIONS = ['length', 'width', 'height'];

export function roomMode(c, [L, W, H], [nx, ny, nz]) {
  return (c / 2) * Math.sqrt((nx / L) ** 2 + (ny / W) ** 2 + (nz / H) ** 2);
}

// All axial modes up to maxHz, lowest first: [{ dimension, n, hz }]
export function axialModes(c, [L, W, H], maxHz) {
  const modes = [];
  [L, W, H].forEach((size, d) => {
    for (let n = 1; (n * c) / (2 * size) <= maxHz; n++) modes.push({ dimension: DIMENSIONS[d], n, hz: (n * c) / (2 * size) });
  });
  return modes.sort((a, b) => a.hz - b.hz);
}

// All modes (axial, tangential, oblique) up to maxHz, lowest first:
// [{ indices: [nx, ny, nz], type, hz }]
export function allRoomModes(c, dims, maxHz) {
  const [L, W, H] = dims;
  const most = (size) => Math.floor((2 * size * maxHz) / c);
  const modes = [];
  for (let nx = 0; nx <= most(L); nx++) {
    for (let ny = 0; ny <= most(W); ny++) {
      for (let nz = 0; nz <= most(H); nz++) {
        const nonZero = (nx > 0) + (ny > 0) + (nz > 0);
        if (!nonZero) continue;
        const hz = roomMode(c, dims, [nx, ny, nz]);
        if (hz <= maxHz) modes.push({ indices: [nx, ny, nz], type: ['', 'axial', 'tangential', 'oblique'][nonZero], hz });
      }
    }
  }
  return modes.sort((a, b) => a.hz - b.hz);
}

// Positions (m from one wall) where an axial mode's pressure is zero.
export function axialNullPositions(n, size) {
  return Array.from({ length: n }, (_, i) => ((2 * (i + 1) - 1) * size) / (2 * n));
}

// Axial modes from DIFFERENT dimensions that land close together, which
// tends to make that frequency extra strong. "Close" = within `tolerance` as a
// fraction (0.03 = 3%, about half a semitone). This threshold is this app's
// simple rule of thumb for spotting clusters, not a published standard.
export function coincidentModes(modes, tolerance = 0.03) {
  const pairs = [];
  for (let i = 0; i < modes.length; i++) {
    for (let j = i + 1; j < modes.length; j++) {
      const a = modes[i], b = modes[j];
      if (a.dimension !== b.dimension && Math.abs(a.hz - b.hz) / Math.min(a.hz, b.hz) <= tolerance) pairs.push([a, b]);
    }
  }
  return pairs;
}

export const schroederFrequency = (rt60, volume) => 2000 * Math.sqrt(rt60 / volume);
