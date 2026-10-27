// spectrum-check.js
// ------------------------------------------------------------
// Runs the spectrum on the middle of some generated test files and lists
// the loudest frequencies, next to the note the file really contains.
// Run with:  npm run spectrum-check
//
// It checks two things:
//   • frequency and level accuracy on pure sine waves (known exactly)
//   • a lesson for EQ: the LOUDEST frequency is often not the NOTE you hear
// ------------------------------------------------------------

import { readWav } from './wav.js';
import { computeSpectrum, findPeaks, bandFor } from '../js/spectrum.js';
import { frequencyToNote } from '../js/pitch-math.js';

const DIR = new URL('../test-audio/generated/', import.meta.url).pathname;
const N = 8192;

// [file, the note it contains (or '–'), expected sine level in dBFS or null]
const FILES = [
  ['sine-A4', 'A4 (440 Hz)', -6.02],
  ['sine-C4', 'C4 (261.63 Hz)', -6.02],
  ['sine-E4-330Hz', 'E4 (330 Hz)', -6.02],
  ['bright-A3', 'A3 (220 Hz)', null],
  ['weak-fundamental-A2', 'A2 (110 Hz)', null],
  ['voice-low-G2-vibrato', 'G2 (≈98 Hz)', null],
  ['voice-high-A4-vibrato', 'A4 (≈440 Hz)', null],
  ['room-noise', '–', null],
  ['whisper-noise', '–', null],
];

const label = (hz) => {
  const n = frequencyToNote(hz);
  return `${hz.toFixed(1)} Hz (${n.name}${n.octave})`;
};

console.log(`Spectrum check: ${N}-sample window from the middle of each file\n`);
console.log('| File | Contains | Loudest frequency | Level | Band | Next loudest |');
console.log('|---|---|---|---|---|---|');

for (const [name, contains, expectedDb] of FILES) {
  const { sampleRate, samples } = readWav(`${DIR}${name}.wav`);
  const start = Math.floor(samples.length / 2 - N / 2);
  const peaks = findPeaks(computeSpectrum(samples.subarray(start, start + N), sampleRate), { count: 4 });
  const [top, ...rest] = peaks;
  const levelText = expectedDb === null ? `${top.db.toFixed(1)} dBFS` : `${top.db.toFixed(2)} dBFS (expected ${expectedDb})`;
  console.log(`| ${name} | ${contains} | ${label(top.hz)} | ${levelText} | ${bandFor(top.hz)?.name ?? '–'} | ` +
    `${rest.map((p) => `${Math.round(p.hz)} Hz`).join(', ') || '–'} |`);
}
