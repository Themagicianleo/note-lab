// listening-dsp.js
// ------------------------------------------------------------
// The sound processing behind the critical-listening exercises (Train tab):
// equaliser, filters, level, panning, stereo width, compressor, distortion,
// echo and reverb. Plain maths on arrays of samples, no browser code, so
// every effect can be measured in Node (tests/listening.test.js).
//
// Why not the browser's built-in effects? Its compressor and reverb differ
// from browser to browser, so an exercise could sound different on a phone
// and a laptop. Here every effect is a published textbook formula:
//   • EQ and filters: "Audio EQ Cookbook" biquads, R. Bristow-Johnson
//     (the W3C Web Audio spec uses the same formulas for peaking and shelves)
//   • compressor: Giannoulis, Massberg & Reiss, "Digital Dynamic Range
//     Compressor Design", J. Audio Eng. Soc. 60(6), 2012
//   • reverb: a feedback delay network (Jot & Chaigne, 1991), where each
//     delay's gain is set from the wanted RT60
//   • pink noise: Paul Kellet's filter ("refined" version)
//
// A "clip" is { sampleRate, channels: [left, right] } (two Float32Arrays).
// Clips are LOOPS: the effects treat the end as joined to the start, so a
// processed loop repeats without a click.
// ------------------------------------------------------------

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (gain) => 20 * Math.log10(Math.max(gain, 1e-12));

// A repeatable random number generator ("mulberry32"): the same seed always
// gives the same numbers, so the built-in sounds are identical every time.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- clips ----------

export const makeClip = (sampleRate, left, right = left) => ({ sampleRate, channels: [left, right] });
export const emptyClip = (sampleRate, length) => makeClip(sampleRate, new Float32Array(length), new Float32Array(length));

// A new clip with fn(sample, index, channel) applied to every sample.
export function mapClip(clip, fn) {
  return { sampleRate: clip.sampleRate, channels: clip.channels.map((ch, c) => Float32Array.from(ch, (v, i) => fn(v, i, c))) };
}

export function peakOf(clip) {
  let peak = 0;
  for (const ch of clip.channels) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  return peak;
}

// Root mean square over both channels: the usual measure of signal power.
export function rmsOf(clip) {
  let sum = 0, count = 0;
  for (const ch of clip.channels) { for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]; count += ch.length; }
  return Math.sqrt(sum / Math.max(count, 1));
}

export const scaleClip = (clip, gain) => mapClip(clip, (v) => v * gain);
export const applyGainDb = (clip, db) => scaleClip(clip, dbToGain(db));

// Scale a clip so its largest sample is `peak`.
export function normalisePeak(clip, peak) {
  const now = peakOf(clip);
  return now > 0 ? scaleClip(clip, peak / now) : clip;
}

// Scale `clip` so it has the same power (RMS) as `reference`. Used after the
// compressor and the distortion: otherwise you could pick the processed sound
// just because it's louder or quieter, without hearing what the effect does.
export function matchRms(clip, reference) {
  const now = rmsOf(clip);
  return now > 0 ? scaleClip(clip, rmsOf(reference) / now) : clip;
}

export function mixClips(clips, gains = clips.map(() => 1)) {
  const out = emptyClip(clips[0].sampleRate, clips[0].channels[0].length);
  clips.forEach((clip, k) => {
    for (let c = 0; c < 2; c++) {
      const from = clip.channels[c], to = out.channels[c], g = gains[k];
      for (let i = 0; i < to.length; i++) to[i] += g * from[i];
    }
  });
  return out;
}

// Both channels become the average of left and right.
export function toMono(clip) {
  const [l, r] = clip.channels;
  const m = Float32Array.from(l, (v, i) => 0.5 * (v + r[i]));
  return makeClip(clip.sampleRate, m, Float32Array.from(m));
}

// ---------- noise ----------

// Pink noise: equal power in every octave (white noise has equal power per
// hertz, so it sounds hissy). It's the standard test sound for EQ training
// because every band is equally "full". Paul Kellet's filter turns white
// noise pink to within about ±0.05 dB from 10 Hz up.
// The end is cross-faded into the start, so the loop repeats seamlessly.
export function pinkNoise(length, random, fade = 2048) {
  const total = length + fade;
  const raw = new Float32Array(total);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const warmUp = 8192; // let the filter settle before keeping samples
  for (let i = -warmUp; i < total; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    if (i >= 0) raw[i] = pink;
  }
  const out = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const angle = (0.5 * Math.PI * i) / fade; // equal-power cross-fade (the two pieces are unrelated noise)
    out[i] = raw[i] * Math.sin(angle) + raw[length + i] * Math.cos(angle);
  }
  return out;
}

// ---------- equaliser and filters (biquads) ----------
// A biquad is a small filter: each output sample is a weighted sum of the
// last 3 input and last 2 output samples. The weights (b0 b1 b2 a1 a2) below
// are the Audio EQ Cookbook's.
//   type: 'peaking' (a bell boost or cut), 'lowshelf', 'highshelf',
//         'lowpass' (removes highs), 'highpass' (removes lows)
//   q: how narrow. For a bell, bandwidth ≈ frequency / q.

export function biquad(type, frequency, sampleRate, { q = Math.SQRT1_2, gainDb = 0 } = {}) {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peaking') {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else if (type === 'lowpass' || type === 'highpass') {
    const alpha = sin / (2 * q);
    if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
    else { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'lowshelf' || type === 'highshelf') {
    const alpha = (sin / 2) * Math.SQRT2; // shelf slope S = 1 (the steepest without a bump)
    const k = 2 * Math.sqrt(A) * alpha;
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cos + k); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - k);
      a0 = (A + 1) + (A - 1) * cos + k; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - k;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cos + k); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - k);
      a0 = (A + 1) - (A - 1) * cos + k; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - k;
    }
  } else {
    throw new Error(`Unknown filter type: ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// A steep (24 dB per octave) low-pass or high-pass: two biquads in a row with
// the Q values of a 4th-order Butterworth filter (flat up to the cutoff).
export const steepFilter = (type, frequency, sampleRate) =>
  [0.5412, 1.3066].map((q) => biquad(type, frequency, sampleRate, { q }));

// How much a filter (one biquad or several in a row) changes the level of a
// frequency, in dB. This is the exact answer from the filter's weights.
export function filterGainDb(filters, frequency, sampleRate) {
  const w = (2 * Math.PI * frequency) / sampleRate;
  let db = 0;
  for (const f of [].concat(filters)) {
    const nr = f.b0 + f.b1 * Math.cos(w) + f.b2 * Math.cos(2 * w);
    const ni = -(f.b1 * Math.sin(w) + f.b2 * Math.sin(2 * w));
    const dr = 1 + f.a1 * Math.cos(w) + f.a2 * Math.cos(2 * w);
    const di = -(f.a1 * Math.sin(w) + f.a2 * Math.sin(2 * w));
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}

// Run a clip through filters. The loop is played through twice and the second
// pass is kept: by then the filter "remembers" the end of the loop, so the
// start joins on without a click.
export function filterClip(clip, filters) {
  const list = [].concat(filters);
  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((input) => {
      let x = Float64Array.from(input);
      for (const f of list) {
        const y = new Float64Array(x.length);
        let z1 = 0, z2 = 0;
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < x.length; i++) {
            const out = f.b0 * x[i] + z1;
            z1 = f.b1 * x[i] - f.a1 * out + z2;
            z2 = f.b2 * x[i] - f.a2 * out;
            y[i] = out;
          }
        }
        x = y;
      }
      return Float32Array.from(x);
    }),
  };
}

// ---------- panning and stereo width ----------

// Equal-power pan of a mono sound. position: −1 = hard left, 0 = centre,
// +1 = hard right. left² + right² is the same at every position, so the sound
// moves without getting louder or quieter. (Scaled so the centre is unchanged.)
export function panGains(position) {
  const angle = ((position + 1) * Math.PI) / 4;
  return { left: Math.SQRT2 * Math.cos(angle), right: Math.SQRT2 * Math.sin(angle) };
}
export function panClip(clip, position) {
  const mono = toMono(clip).channels[0];
  const { left, right } = panGains(position);
  return makeClip(clip.sampleRate, Float32Array.from(mono, (v) => v * left), Float32Array.from(mono, (v) => v * right));
}

// Mid = what both channels share (the centre); side = what differs.
export function midSidePower(clip) {
  const [l, r] = clip.channels;
  let mid = 0, side = 0;
  for (let i = 0; i < l.length; i++) {
    const m = 0.5 * (l[i] + r[i]), s = 0.5 * (l[i] - r[i]);
    mid += m * m; side += s * s;
  }
  return { mid: mid / l.length, side: side / l.length };
}

// Stereo width: scale the side signal. 0 = mono, 1 = unchanged, above 1 =
// wider. Narrowing removes sound, so the result is turned up (or down, when
// widening) to keep the same total power: you judge width, not loudness.
export function widthClip(clip, width) {
  const [l, r] = clip.channels;
  const { mid, side } = midSidePower(clip);
  const after = mid + width * width * side;
  const g = after > 0 ? Math.sqrt((mid + side) / after) : 1;
  const left = new Float32Array(l.length), right = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) {
    const m = 0.5 * (l[i] + r[i]), s = 0.5 * (l[i] - r[i]) * width;
    left[i] = g * (m + s); right[i] = g * (m - s);
  }
  return makeClip(clip.sampleRate, left, right);
}

// ---------- compressor ----------
// A compressor turns loud moments down. Above the threshold, the level rises
// only 1 dB for every `ratio` dB of input.

// How many dB a steady level is turned down (0 or negative).
export function compressorGainDb(levelDb, thresholdDb, ratio) {
  return levelDb <= thresholdDb ? 0 : (thresholdDb - levelDb) * (1 - 1 / ratio);
}

// attackMs: how quickly it turns down when the sound gets loud;
// releaseMs: how quickly it lets go again. Both channels get the same gain
// (from the louder one), so the stereo picture doesn't move.
export function compressClip(clip, { thresholdDb, ratio, attackMs = 1, releaseMs = 150 }) {
  const [l, r] = clip.channels;
  const n = l.length;
  const attack = Math.exp(-1 / ((attackMs / 1000) * clip.sampleRate));
  const release = Math.exp(-1 / ((releaseMs / 1000) * clip.sampleRate));
  const left = new Float32Array(n), right = new Float32Array(n);
  let smoothed = 0; // the gain in dB, after attack/release smoothing
  for (let pass = 0; pass < 2; pass++) { // twice round the loop; the second pass is kept
    for (let i = 0; i < n; i++) {
      const level = gainToDb(Math.max(Math.abs(l[i]), Math.abs(r[i])));
      const wanted = compressorGainDb(level, thresholdDb, ratio);
      const k = wanted < smoothed ? attack : release;
      smoothed = k * smoothed + (1 - k) * wanted;
      const g = dbToGain(smoothed);
      left[i] = l[i] * g; right[i] = r[i] * g;
    }
  }
  return makeClip(clip.sampleRate, left, right);
}

// ---------- distortion ----------
// Soft clipping with tanh: quiet parts pass almost unchanged, loud parts are
// rounded off, which adds harmonics that weren't in the sound. `drive` is how
// hard the loudest sample (`peak`) is pushed into the curve.
export function distortClip(clip, drive, peak = peakOf(clip)) {
  const k = drive / Math.max(peak, 1e-9);
  return mapClip(clip, (v) => Math.tanh(k * v) / k);
}

// Total harmonic distortion of that curve for a sine wave at the peak level:
// the power of the added harmonics relative to the fundamental, as a fraction
// (0.1 = 10%). Found by comparing one cycle with each harmonic.
export function tanhThd(drive) {
  const steps = 4096;
  const amplitude = (h) => {
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const angle = (2 * Math.PI * (i + 0.5)) / steps;
      sum += Math.tanh(drive * Math.sin(angle)) * Math.sin(h * angle);
    }
    return (2 * sum) / steps;
  };
  let harmonics = 0;
  for (let h = 3; h <= 31; h += 2) harmonics += amplitude(h) ** 2; // a symmetric curve only adds odd harmonics
  return Math.sqrt(harmonics) / Math.abs(amplitude(1));
}

// ---------- echo and reverb ----------

// One echo: the sound again, `delayMs` later and `gain` times as loud.
export function echoClip(clip, delayMs, gain = 0.5) {
  const d = Math.round((delayMs / 1000) * clip.sampleRate);
  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((ch) => {
      const n = ch.length;
      return Float32Array.from(ch, (v, i) => v + gain * ch[(((i - d) % n) + n) % n]);
    }),
  };
}

// Reverb from a feedback delay network: 8 delay lines feed back into each
// other through a mixing matrix that keeps the energy the same (Householder).
// Each line loses a little level every trip, chosen so the whole reverb has
// decayed by 60 dB after `rt60` seconds: gain = 10^(−3 × delay / rt60).
// The delays stand for the paths between walls, so a short reverb (a small
// room) uses shorter ones: its echoes come closer together, as in a real room.
// Returns only the reverb (the "wet" sound). loop = false gives the plain
// response (silence before the start), used to measure the decay in tests.
const FDN_DELAYS_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.9];
const roomScale = (rt60) => Math.min(1, Math.max(0.3, Math.sqrt(rt60 / 2)));
export function reverbClip(clip, rt60, { loop = true } = {}) {
  const fs = clip.sampleRate;
  const [l, r] = clip.channels;
  const n = l.length;
  const delays = FDN_DELAYS_MS.map((ms) => Math.round(((ms * roomScale(rt60)) / 1000) * fs) | 1); // odd lengths, all different
  const gains = delays.map((d) => Math.pow(10, (-3 * d) / (rt60 * fs)));
  const lines = delays.map((d) => new Float64Array(d));
  const at = delays.map(() => 0);
  const left = new Float32Array(n), right = new Float32Array(n);
  const outs = new Float64Array(8);
  for (let pass = loop ? 0 : 1; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < 8; k++) { outs[k] = lines[k][at[k]]; sum += outs[k]; }
      const mix = sum * 0.25; // Householder matrix: out − (2/8) × (sum of all)
      let wl = 0, wr = 0;
      for (let k = 0; k < 8; k++) {
        const input = k % 2 ? r[i] : l[i];
        lines[k][at[k]] = input + gains[k] * (outs[k] - mix);
        at[k] = at[k] + 1 === delays[k] ? 0 : at[k] + 1;
        // Lines alternate left/right, with alternating signs, so the two ears get unrelated reverb.
        if (k % 2) wr += k % 4 === 1 ? outs[k] : -outs[k]; else wl += k % 4 === 0 ? outs[k] : -outs[k];
      }
      left[i] = wl; right[i] = wr;
    }
  }
  return makeClip(fs, left, right);
}

// The sound plus its reverb, with the reverb always the same amount quieter
// than the sound (wetDb) whatever its length. A long reverb is then longer,
// not louder, so the decay time is what you learn to hear.
export function addReverb(clip, rt60, wetDb = -8) {
  const wet = reverbClip(clip, rt60);
  const wetRms = rmsOf(wet);
  const g = wetRms > 0 ? (rmsOf(clip) * dbToGain(wetDb)) / wetRms : 0;
  return mixClips([clip, wet], [1, g]);
}

// Scale a clip to a given power (RMS).
export function setRms(clip, target) {
  const now = rmsOf(clip);
  return now > 0 ? scaleClip(clip, target / now) : clip;
}
