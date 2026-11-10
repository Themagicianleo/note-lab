// listening-check.js
// ------------------------------------------------------------
// Measures what the critical-listening exercises (Train tab) really play, and
// prints the results as tables (saved in docs/evaluation/listening-check.md):
//   node tools/listening-check.js > docs/evaluation/listening-check.md
// Everything is measured on the samples the app would send to the headphones,
// at 48 000 Hz, with the app's own FFT. Nothing here is estimated.
// ------------------------------------------------------------

import { fft } from '../js/fft.js';
import { makeClip, rmsOf, peakOf, gainToDb, reverbClip, tanhThd } from '../js/listening-dsp.js';
import { pinkSource, makeStems, mixStems } from '../js/listening-sources.js';
import { GAMES, gameById, OCTAVE_BANDS, optionsFor, variantClip, chanceOfRight, passMark, chanceOfScore, hzLabel } from '../js/listening-games.js';

const FS = 48000;
const stems = makeStems(FS);
const SRC = {
  pink: { sampleRate: FS, clip: pinkSource(FS) },
  stereoPink: { sampleRate: FS, clip: pinkSource(FS, { stereo: true }) },
  mix: { sampleRate: FS, clip: mixStems(stems), stems },
  drums: { sampleRate: FS, clip: stems.drums },
  tone: { sampleRate: FS },
};
const sourceFor = (game) => (game.stereoNoise ? SRC.stereoPink : SRC[game.sources[0]]);

// Power of one channel between lo and hi Hz.
function bandPower(samples, lo, hi, size = 32768) {
  let sum = 0;
  for (let start = 0; start + size <= samples.length; start += size / 2) {
    const re = Float64Array.from({ length: size }, (_, i) => samples[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)));
    const im = new Float64Array(size);
    fft(re, im);
    for (let k = Math.ceil((lo * size) / FS); k <= Math.floor((hi * size) / FS); k++) sum += re[k] * re[k] + im[k] * im[k];
  }
  return sum;
}
const changeAt = (after, before, hz) => 10 * Math.log10(bandPower(after.channels[0], hz * 0.97, hz * 1.03) / bandPower(before.channels[0], hz * 0.97, hz * 1.03));
const f2 = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);

console.log('# Critical listening: what the exercises really play\n');
console.log('Made by `node tools/listening-check.js`. Measured on the samples the app sends to the headphones (48 000 Hz), with the app\'s own FFT.\n');

console.log('## Pink noise: level of each octave, relative to 1 kHz\n');
console.log('| Octave | ' + OCTAVE_BANDS.map(hzLabel).join(' | ') + ' |');
console.log('|---|' + OCTAVE_BANDS.map(() => '---').join('|') + '|');
const pink = SRC.pink.clip.channels[0];
const ref = bandPower(pink, 1000 / Math.SQRT2, 1000 * Math.SQRT2);
console.log('| dB | ' + OCTAVE_BANDS.map((hz) => f2(10 * Math.log10(bandPower(pink, hz / Math.SQRT2, hz * Math.SQRT2) / ref))).join(' | ') + ' |\n');
console.log('(The 16 kHz octave reaches up to 22.6 kHz, so it is the least exact; 6 seconds of noise also varies by a few tenths of a dB.)\n');

for (const [id, level] of [['eq-boost', 1], ['eq-boost', 3], ['eq-cut', 1]]) {
  const game = gameById(id);
  console.log(`## ${game.title}, level ${level + 1} (${game.levels[level].about}), on pink noise\n`);
  console.log('| Asked band | Measured change at that band | Change two octaves below | Loudest sample |');
  console.log('|---|---|---|---|');
  for (const hz of game.levels[level].options) {
    const clip = variantClip(game, SRC.pink, { level }, String(hz));
    console.log(`| ${hzLabel(hz)} | ${f2(changeAt(clip, SRC.pink.clip, hz))} dB | ${hz >= 250 ? `${f2(changeAt(clip, SRC.pink.clip, hz / 4))} dB` : '–'} | ${gainToDb(peakOf(clip)).toFixed(1)} dBFS |`);
  }
  console.log('');
}

console.log('## Reverb time: asked and measured\n');
console.log('Measured from the reverb of a single click: the −5 to −35 dB part of the energy decay curve, extended to 60 dB.\n');
console.log('| Asked RT60 | Measured, left | Measured, right |');
console.log('|---|---|---|');
function measuredRt60(response) {
  const energy = new Float64Array(response.length);
  let sum = 0;
  for (let i = response.length - 1; i >= 0; i--) { sum += response[i] * response[i]; energy[i] = sum; }
  const db = (i) => 10 * Math.log10(energy[i] / energy[0]);
  let n = 0, st = 0, sd = 0, stt = 0, std = 0;
  for (let i = 0; i < response.length && db(i) > -35; i += 16) {
    if (db(i) > -5) continue;
    const t = i / FS, d = db(i);
    n++; st += t; sd += d; stt += t * t; std += t * d;
  }
  return -60 / ((n * std - st * sd) / (n * stt - st * st));
}
for (const rt60 of [0.2, 0.3, 0.6, 1, 1.2, 1.8, 2.4, 3]) {
  const click = new Float32Array(Math.round(FS * (rt60 + 0.5))); click[0] = 1;
  const wet = reverbClip(makeClip(FS, click), rt60, { loop: false });
  console.log(`| ${rt60} s | ${measuredRt60(wet.channels[0]).toFixed(3)} s | ${measuredRt60(wet.channels[1]).toFixed(3)} s |`);
}

console.log('\n## Loudness of the answers (dB relative to the Original)\n');
console.log('Where loudness could give the answer away, every version should read 0.00. (Echo and reverb add sound, so all their answers are louder than the Original by the same amount.)\n');
console.log('| Exercise | Level | Answers | Level of each answer vs the Original |');
console.log('|---|---|---|---|');
for (const id of ['pan', 'width', 'compression', 'distortion', 'delay', 'reverb']) {
  const game = gameById(id);
  const src = sourceFor(game);
  game.levels.forEach((_, i) => {
    const q = { level: i, answer: 'B', value: game.levels[i].value, extra: null };
    const keys = game.mode === 'which' ? ['B'] : optionsFor(game, i).map((o) => o.key);
    const original = rmsOf(variantClip(game, src, q, game.mode === 'which' ? 'A' : 'original'));
    const levels = keys.map((k) => f2(gainToDb(rmsOf(variantClip(game, src, q, k)) / original)));
    console.log(`| ${game.title} | ${i + 1} | ${game.mode === 'which' ? 'the processed one' : optionsFor(game, i).map((o) => o.label).join(', ')} | ${levels.join(', ')} |`);
  });
}

console.log('\n## Compression on the drum loop: gap between loud and quiet moments\n');
console.log('The level of every 10 ms slice; the gap between the loud ones (95th percentile) and the quiet ones (20th).\n');
console.log('| Setting | Loud-to-quiet gap |');
console.log('|---|---|');
const comp = gameById('compression');
const gap = (clip) => {
  const size = FS / 100, ch = clip.channels[0], levels = [];
  for (let start = 0; start + size <= ch.length; start += size) levels.push(gainToDb(rmsOf(makeClip(FS, ch.subarray(start, start + size)))));
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length * 0.95)] - levels[Math.floor(levels.length * 0.2)];
};
for (const i of [2, 3, 4]) for (const o of optionsFor(comp, i)) console.log(`| ${i === 2 ? 'Ratio ' : '8:1, '}${o.label} | ${gap(variantClip(comp, SRC.drums, { level: i }, o.key)).toFixed(1)} dB |`);

console.log('\n## Distortion levels\n');
console.log('| Level | Drive | Distortion (THD) of a full-level sine |');
console.log('|---|---|---|');
gameById('distortion').levels.forEach((l, i) => console.log(`| ${i + 1} | ×${l.value} | ${(100 * tanhThd(l.value)).toFixed(2)}% |`));

console.log('\n## Passing a level by luck\n');
console.log('The chance that pure guessing reaches the pass mark in a round of 10.\n');
console.log('| Exercise | Level | Answers | Pass mark | Chance by guessing |');
console.log('|---|---|---|---|---|');
for (const game of GAMES) {
  game.levels.forEach((_, i) => {
    const p = chanceOfRight(game, i), mark = passMark(p);
    console.log(`| ${game.title} | ${i + 1} | ${optionsFor(game, i).length}${game.levels[i].tolerance ? ' (±1 counts)' : ''} | ${mark} of 10 | ${(100 * chanceOfScore(mark, p)).toFixed(3)}% |`);
  });
}
