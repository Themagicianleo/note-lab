// fft.js
// ------------------------------------------------------------
// The Fast Fourier Transform (FFT), radix-2 Cooley–Tukey version.
//
// What it does, in plain language:
//   Any sound can be described as a sum of sine waves of different
//   frequencies. The FFT takes N samples of sound and works out how much
//   of each of N/2 evenly spaced frequencies is in it ("bins").
//   Bin k is the frequency k × sampleRate / N.
//
// How (briefly): a direct calculation would compare the sound with every
// frequency, N × N steps. The FFT splits the job in half again and again
// (even samples / odd samples), reusing results, so it needs only about
// N × log2(N) steps: for N = 8192 that's ~100 000 instead of ~67 000 000.
//
// N must be a power of two (256, 512, …, 8192).
// ------------------------------------------------------------

// Pre-computed cos/sin tables ("twiddle factors"), one set per size.
const tables = new Map();
function twiddles(n) {
  if (!tables.has(n)) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    tables.set(n, { cos, sin });
  }
  return tables.get(n);
}

export function isPowerOfTwo(n) {
  return n >= 2 && (n & (n - 1)) === 0;
}

// In-place FFT. `re` and `im` are the real and imaginary parts
// (for sound, im starts as all zeros). Both arrays are overwritten.
export function fft(re, im) {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error('FFT size must be a power of two');

  // 1. Reorder the samples into "bit-reversed" order, so the halving steps
  //    below can work on neighbouring pairs.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // 2. Combine small FFTs into bigger ones: size 2, 4, 8, … n.
  const { cos, sin } = twiddles(n);
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const tableStep = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * tableStep];
        const wi = sin[k * tableStep];
        const a = start + k;
        const b = a + half;
        // "Butterfly": rotate the odd part, then add/subtract it.
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}
