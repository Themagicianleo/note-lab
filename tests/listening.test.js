// Tests for the critical-listening exercises: the sound processing
// (js/listening-dsp.js), the built-in sounds (js/listening-sources.js) and the
// exercises themselves (js/listening-games.js). Every effect is MEASURED here:
// e.g. a "+6 dB at 1 kHz" question really is +6 dB at 1 kHz.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft } from '../js/fft.js';
import {
  dbToGain, gainToDb, seededRandom, makeClip, peakOf, rmsOf, matchRms, pinkNoise, biquad, steepFilter, filterGainDb, filterClip,
  panGains, panClip, widthClip, midSidePower, compressorGainDb, compressClip, distortClip, tanhThd, echoClip, reverbClip, addReverb,
} from '../js/listening-dsp.js';
import { SOURCE_PEAK, pinkSource, makeStems, mixStems, toneSource, sourceFromChannels } from '../js/listening-sources.js';
import {
  GAMES, GROUPS, gameById, ROUND_LENGTH, OCTAVE_BANDS, THIRD_OCTAVE_BANDS, hzLabel, dbLabel, optionsFor, makeQuestion, judge, variantClip,
  scoreKey, scoreRows, chanceOfRight, chanceOfScore, passMark, GameProgress, dayKey, addRoundToday, dayStreak,
} from '../js/listening-games.js';

const FS = 48000;
const near = (actual, expected, tolerance, what) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} (expected ${expected} ± ${tolerance})`);

// A sine that fits the loop exactly (whole cycles), so the loop is seamless.
function sineClip(frequency, amplitude = 0.25, seconds = 1) {
  const n = Math.round(seconds * FS);
  const cycles = Math.round(frequency * seconds);
  const wave = Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * cycles * i) / n));
  return makeClip(FS, wave, Float32Array.from(wave));
}
const levelChangeDb = (after, before) => gainToDb(rmsOf(after) / rmsOf(before));

// Power in each band (lo–hi Hz) of one channel, averaged over many FFTs.
function bandPowers(samples, bands, size = 16384) {
  const sums = bands.map(() => 0);
  for (let start = 0; start + size <= samples.length; start += size / 2) {
    const re = Float64Array.from({ length: size }, (_, i) => samples[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)));
    const im = new Float64Array(size);
    fft(re, im);
    bands.forEach(([lo, hi], b) => {
      for (let k = Math.ceil((lo * size) / FS); k <= Math.floor((hi * size) / FS); k++) sums[b] += re[k] * re[k] + im[k] * im[k];
    });
  }
  return sums;
}
const octaveAround = (f) => [f / Math.SQRT2, f * Math.SQRT2];

// ---------- the processing ----------

test('seeded random numbers repeat exactly, and stay between 0 and 1', () => {
  const a = seededRandom(7), b = seededRandom(7);
  for (let i = 0; i < 1000; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
});

test('pink noise has the same power in every octave, 63 Hz to 8 kHz (within 1 dB)', () => {
  const noise = pinkNoise(FS * 20, seededRandom(1));
  const powers = bandPowers(noise, [63, 125, 250, 500, 1000, 2000, 4000, 8000].map(octaveAround));
  const db = powers.map((p) => 10 * Math.log10(p / powers[4]));
  db.forEach((d, i) => near(d, 0, 1, `octave ${i} relative to 1 kHz, dB`));
});

test('pink noise loops without a jump at the join', () => {
  const noise = pinkNoise(FS, seededRandom(3));
  let typical = 0;
  for (let i = 1; i < noise.length; i++) typical = Math.max(typical, Math.abs(noise[i] - noise[i - 1]));
  assert.ok(Math.abs(noise[0] - noise[noise.length - 1]) <= typical, 'the step across the loop point is no bigger than the steps inside');
});

test('EQ bell: exactly the asked gain at its centre, nothing two octaves away', () => {
  for (const hz of OCTAVE_BANDS) {
    for (const gainDb of [12, 6, -9]) {
      const bell = biquad('peaking', hz, FS, { q: 1.41, gainDb });
      near(filterGainDb(bell, hz, FS), gainDb, 0.001, `${hz} Hz ${gainDb} dB at the centre`);
      if (hz >= 250) near(filterGainDb(bell, hz / 8, FS), 0, 0.6, `${hz} Hz bell, three octaves below`);
    }
  }
});

test('EQ bell measured on real samples: a 1 kHz sine through "+6 dB at 1 kHz" comes out 6 dB louder', () => {
  const bell = biquad('peaking', 1000, FS, { q: 1.41, gainDb: 6 });
  near(levelChangeDb(filterClip(sineClip(1000), bell), sineClip(1000)), 6, 0.01, '1 kHz');
  near(levelChangeDb(filterClip(sineClip(125), bell), sineClip(125)), 0, 0.1, '125 Hz');
  // One octave away, the gain is what the formula says.
  near(levelChangeDb(filterClip(sineClip(2000), bell), sineClip(2000)), filterGainDb(bell, 2000, FS), 0.01, '2 kHz');
});

test('a third-octave bell is narrow: half its dB gain is gone a third of an octave away', () => {
  const bell = biquad('peaking', 1000, FS, { q: 4.32, gainDb: 9 });
  const side = filterGainDb(bell, 1250, FS);
  assert.ok(side < 4.5 && side > 1, `+9 dB at 1 kHz is ${side.toFixed(2)} dB at 1.25 kHz`);
});

test('steep low-pass and high-pass: −3 dB at the cutoff, about −24 dB one octave past it, flat before', () => {
  for (const hz of [250, 1000, 4000]) {
    const lp = steepFilter('lowpass', hz, FS), hp = steepFilter('highpass', hz, FS);
    near(filterGainDb(lp, hz, FS), -3.01, 0.05, `low-pass ${hz} at cutoff`);
    near(filterGainDb(hp, hz, FS), -3.01, 0.05, `high-pass ${hz} at cutoff`);
    near(filterGainDb(lp, hz * 2, FS), -24.5, 3, `low-pass ${hz} one octave above`); // a little steeper near the top of the range
    near(filterGainDb(hp, hz / 2, FS), -24.3, 1, `high-pass ${hz} one octave below`);
    near(filterGainDb(lp, hz / 4, FS), 0, 0.05, `low-pass ${hz} two octaves below`);
    near(filterGainDb(hp, hz * 4, FS), 0, 0.05, `high-pass ${hz} two octaves above`);
  }
});

test('shelves: the full gain far on one side, none on the other', () => {
  const high = biquad('highshelf', 4000, FS, { gainDb: 8 }), low = biquad('lowshelf', 250, FS, { gainDb: 8 });
  near(filterGainDb(high, 16000, FS), 8, 0.3, 'high shelf at 16 kHz');
  near(filterGainDb(high, 250, FS), 0, 0.1, 'high shelf at 250 Hz');
  near(filterGainDb(low, 30, FS), 8, 0.3, 'low shelf at 30 Hz');
  near(filterGainDb(low, 4000, FS), 0, 0.1, 'low shelf at 4 kHz');
});

test('a filtered loop still joins up: no click at the loop point', () => {
  const out = filterClip(sineClip(100), biquad('peaking', 100, FS, { q: 4.32, gainDb: 12 })).channels[0];
  const stepInside = Math.abs(out[1000] - out[999]);
  assert.ok(Math.abs(out[0] - out[out.length - 1]) < stepInside * 3 + 1e-4);
});

test('panning keeps the same power everywhere; centre is unchanged; hard left is silent on the right', () => {
  for (const p of [-1, -0.67, -0.25, 0, 0.5, 1]) {
    const { left, right } = panGains(p);
    near(left * left + right * right, 2, 1e-9, `power at ${p}`);
  }
  const src = sineClip(440);
  near(levelChangeDb(panClip(src, 0), src), 0, 1e-4, 'centre');
  near(levelChangeDb(panClip(src, 0.5), src), 0, 1e-4, 'half right');
  const left = panClip(src, -1);
  assert.equal(peakOf(makeClip(FS, left.channels[1])), 0);
  const half = panClip(src, 0.5);
  assert.ok(rmsOf(makeClip(FS, half.channels[1])) > rmsOf(makeClip(FS, half.channels[0])), 'half right is louder on the right');
});

test('stereo width: 0 is mono, 1 changes nothing, and the power never changes', () => {
  const src = pinkSource(FS, { stereo: true, seconds: 2 });
  const mono = widthClip(src, 0);
  assert.deepEqual(mono.channels[0], mono.channels[1]);
  const same = widthClip(src, 1);
  near(same.channels[0][1234], src.channels[0][1234], 1e-6, 'unchanged sample');
  for (const w of [0, 0.25, 0.5, 1.25, 1.5]) near(levelChangeDb(widthClip(src, w), src), 0, 0.01, `power at width ${w}`);
  const narrow = midSidePower(widthClip(src, 0.5)), full = midSidePower(src);
  assert.ok(narrow.side / narrow.mid < 0.3 * (full.side / full.mid), 'half width has a quarter of the side-to-mid power');
});

test('compressor: a steady tone 10 dB over the threshold at 4:1 is turned down 7.5 dB', () => {
  assert.equal(compressorGainDb(-30, -20, 4), 0);
  near(compressorGainDb(-10, -20, 4), -7.5, 1e-9, 'formula');
  // On samples. The level detector follows the wave's peaks with a fast attack and a slow release.
  const tone = sineClip(1000, dbToGain(-10));
  const out = compressClip(tone, { thresholdDb: -20, ratio: 4, attackMs: 0.1, releaseMs: 2000 });
  near(gainToDb(peakOf(out)), -17.5, 0.3, 'output peak, dBFS');
  const quiet = sineClip(1000, dbToGain(-30));
  near(levelChangeDb(compressClip(quiet, { thresholdDb: -20, ratio: 4 }), quiet), 0, 1e-6, 'below the threshold: untouched');
});

test('compressor attack: a slow attack lets the start of a hit through, a fast one doesn\'t', () => {
  // 100 ms of loud tone, then quiet, as a loop.
  const n = FS;
  const wave = Float32Array.from({ length: n }, (_, i) => (i < 4800 ? 0.5 : 0.01) * Math.sin((2 * Math.PI * 1000 * i) / FS));
  const hit = makeClip(FS, wave, Float32Array.from(wave));
  const firstMs = (clip) => rmsOf(makeClip(FS, clip.channels[0].slice(0, 960))); // the first 20 ms
  const fast = compressClip(hit, { thresholdDb: -30, ratio: 8, attackMs: 0.5, releaseMs: 100 });
  const slow = compressClip(hit, { thresholdDb: -30, ratio: 8, attackMs: 60, releaseMs: 100 });
  assert.ok(firstMs(slow) > 2 * firstMs(fast), `slow ${firstMs(slow).toFixed(3)} vs fast ${firstMs(fast).toFixed(3)}`);
});

test('matchRms gives the processed sound the same power as the original', () => {
  const src = pinkSource(FS, { seconds: 1 });
  const squashed = compressClip(src, { thresholdDb: -40, ratio: 10 });
  assert.ok(levelChangeDb(squashed, src) < -3);
  near(levelChangeDb(matchRms(squashed, src), src), 0, 1e-4, 'after matching');
});

test('distortion: more drive, more harmonics; a gentle drive leaves the sound almost alone', () => {
  const thd = [0.4, 0.75, 1.5, 3, 6].map(tanhThd);
  for (let i = 1; i < thd.length; i++) assert.ok(thd[i] > thd[i - 1]);
  near(thd[0], 0.4 * 0.4 / 12, 0.003, 'small drive matches the series: drive² / 12'); // tanh x ≈ x − x³/3
  assert.ok(thd[4] > 0.25, 'drive 6 is heavy');
  // Measured on samples: the 3rd harmonic of a distorted 1 kHz sine.
  const out = distortClip(sineClip(1000), 1.5).channels[0];
  const [fundamental, third] = bandPowers(out, [[990, 1010], [2990, 3010]]);
  near(Math.sqrt(third / fundamental), tanhThd(1.5), 0.01, '3rd harmonic vs the calculated distortion');
});

test('echo: the sound again, later and quieter (and wrapped round the loop)', () => {
  const wave = new Float32Array(FS); wave[100] = 1; wave[FS - 10] = 1;
  const out = echoClip(makeClip(FS, wave), 50, 0.5).channels[0];
  assert.equal(out[100], 1);
  assert.equal(out[100 + 2400], 0.5);       // 50 ms = 2400 samples later
  assert.equal(out[2400 - 10], 0.5);        // the hit near the end echoes at the start
});

// The decay time of a reverb response, from the −5 to −35 dB part of its
// energy decay curve (Schroeder's backward integration), extended to 60 dB.
function measuredRt60(response) {
  const energy = new Float64Array(response.length);
  let sum = 0;
  for (let i = response.length - 1; i >= 0; i--) { sum += response[i] * response[i]; energy[i] = sum; }
  const db = (i) => 10 * Math.log10(energy[i] / energy[0]);
  // Best straight line through the curve between −5 and −35 dB.
  let n = 0, st = 0, sd = 0, stt = 0, std = 0;
  for (let i = 0; i < response.length && db(i) > -35; i += 16) {
    if (db(i) > -5) continue;
    const t = i / FS, d = db(i);
    n++; st += t; sd += d; stt += t * t; std += t * d;
  }
  return -60 / ((n * std - st * sd) / (n * stt - st * st));
}

test('reverb: the measured decay time is the RT60 asked for (within 10%)', () => {
  for (const rt60 of [0.2, 0.3, 0.6, 1.2, 2.4]) {
    const click = new Float32Array(Math.round(FS * (rt60 + 0.5))); click[0] = 1;
    const wet = reverbClip(makeClip(FS, click), rt60, { loop: false });
    for (const ch of wet.channels) near(measuredRt60(ch) / rt60, 1, 0.1, `RT60 ${rt60} s, measured ratio`);
    if (process.env.SHOW) console.log(rt60, wet.channels.map((ch) => measuredRt60(ch).toFixed(3)));
  }
});

test('reverb is equally loud at every length, and different in each ear', () => {
  const src = makeStems(FS).drums;
  const dry = rmsOf(src);
  for (const rt60 of [0.3, 3]) {
    const wetOnly = addReverb(src, rt60);
    for (let c = 0; c < 2; c++) for (let i = 0; i < wetOnly.channels[c].length; i++) wetOnly.channels[c][i] -= src.channels[c][i];
    near(gainToDb(rmsOf(wetOnly) / dry), -8, 0.01, `reverb level at ${rt60} s`);
    const { mid, side } = midSidePower(wetOnly);
    assert.ok(side > 0.3 * mid, 'the reverb is wide');
  }
});

// ---------- the built-in sounds ----------

test('built-in sounds peak at −12 dBFS, leaving room for a +12 dB boost', () => {
  const stems = makeStems(FS);
  near(SOURCE_PEAK, dbToGain(-12), 0.002, 'SOURCE_PEAK');
  for (const clip of [pinkSource(FS), pinkSource(FS, { stereo: true }), mixStems(stems), toneSource(FS, 440)]) near(peakOf(clip), SOURCE_PEAK, 1e-4, 'peak');
});

test('pink noise source: mono by default, unrelated left and right for the width exercise', () => {
  const mono = pinkSource(FS, { seconds: 1 });
  assert.deepEqual(mono.channels[0], mono.channels[1]);
  const { mid, side } = midSidePower(pinkSource(FS, { stereo: true, seconds: 4 }));
  near(side / mid, 1, 0.15, 'side power / mid power');
});

test('the music loop is 8 s, is identical every time, has sound in every octave and real stereo', () => {
  const a = makeStems(FS), b = makeStems(FS);
  const mix = mixStems(a);
  assert.equal(mix.channels[0].length, 8 * FS);
  assert.deepEqual(mixStems(b).channels[0], mix.channels[0]);
  const powers = bandPowers(mix.channels[0], OCTAVE_BANDS.map(octaveAround));
  const loudest = Math.max(...powers);
  powers.forEach((p, i) => assert.ok(10 * Math.log10(p / loudest) > -45, `${OCTAVE_BANDS[i]} Hz octave is ${(10 * Math.log10(p / loudest)).toFixed(1)} dB below the loudest`));
  const { mid, side } = midSidePower(mix);
  assert.ok(side > 0.01 * mid, 'the mix has a side signal');
  for (const stem of Object.values(a)) assert.ok(rmsOf(stem) > 0.002, 'every part can be heard');
});

test('the music loop repeats without a click', () => {
  const ch = mixStems(makeStems(FS)).channels[0];
  let biggest = 0;
  for (let i = 1; i < ch.length; i++) biggest = Math.max(biggest, Math.abs(ch[i] - ch[i - 1]));
  assert.ok(Math.abs(ch[0] - ch[ch.length - 1]) <= biggest);
});

test('mix balance: turning one part up 6 dB changes only that part', () => {
  const stems = makeStems(FS);
  const up = mixStems(stems, { bass: 6 });
  const plain = mixStems(stems);
  const difference = makeClip(FS, Float32Array.from(up.channels[0], (v, i) => v - plain.channels[0][i]));
  // up − plain = bass × (10^(6/20) − 1)
  near(rmsOf(difference) / rmsOf(makeClip(FS, stems.bass.channels[0])), dbToGain(6) - 1, 1e-3, 'difference / bass');
});

test('tone for the pitch exercise has the asked frequency', () => {
  const ch = toneSource(FS, 440).channels[0];
  let crossings = 0;
  for (let i = FS * 0.1; i < FS * 0.6; i++) if (ch[i - 1] < 0 && ch[i] >= 0) crossings++;
  near(crossings / 0.5, 440, 2, 'upward zero crossings per second');
});

test('your own track: an excerpt from 30% in, faded at both ends, peak at −12 dBFS; mono is noticed', () => {
  const total = 60 * FS;
  const left = Float32Array.from({ length: total }, (_, i) => Math.sin(i / 50) * (i / total));
  const right = Float32Array.from(left, (v) => -v * 0.5);
  const stereo = sourceFromChannels([left, right], FS, 12);
  assert.equal(stereo.clip.channels[0].length, 12 * FS);
  assert.equal(stereo.clip.channels[0][0], 0);
  near(peakOf(stereo.clip), SOURCE_PEAK, 1e-4, 'peak');
  assert.equal(stereo.mono, false);
  assert.equal(sourceFromChannels([left], FS).mono, true);
  assert.equal(sourceFromChannels([left, Float32Array.from(left)], FS).mono, true);
  const short = sourceFromChannels([left.slice(0, FS)], FS);
  assert.equal(short.clip.channels[0].length, FS);
  assert.equal(sourceFromChannels([new Float32Array(FS)], FS).silent, true);
});

// ---------- the exercises ----------

const stems = makeStems(FS);
const SRC = {
  pink: { sampleRate: FS, clip: pinkSource(FS, { seconds: 2 }) },
  stereoPink: { sampleRate: FS, clip: pinkSource(FS, { stereo: true, seconds: 2 }) },
  mix: { sampleRate: FS, clip: mixStems(stems), stems },
  drums: { sampleRate: FS, clip: stems.drums },
  tone: { sampleRate: FS, clip: null },
};
const sourceFor = (game) => (game.stereoNoise ? SRC.stereoPink : SRC[game.sources[0]]);

test('every exercise has a group, texts and levels with at least two different answers', () => {
  const ids = new Set();
  for (const game of GAMES) {
    assert.ok(!ids.has(game.id)); ids.add(game.id);
    assert.ok(GROUPS.some((g) => g.id === game.group), game.id);
    for (const text of [game.title, game.summary, game.ask, game.tips]) assert.ok(text && text.length > 3, game.id);
    assert.ok(game.levels.length >= 3, game.id);
    game.levels.forEach((level, i) => {
      const options = optionsFor(game, i);
      assert.ok(options.length >= 2, `${game.id} level ${i + 1}`);
      assert.equal(new Set(options.map((o) => o.key)).size, options.length, `${game.id} level ${i + 1}: keys differ`);
      assert.equal(new Set(options.map((o) => o.label)).size, options.length, `${game.id} level ${i + 1}: labels differ`);
      assert.ok(level.about, `${game.id} level ${i + 1} has a description`);
    });
    assert.equal(gameById(game.id), game);
  }
  assert.equal(GAMES.length, 12);
});

test('labels', () => {
  assert.equal(hzLabel(63), '63 Hz');
  assert.equal(hzLabel(1000), '1 kHz');
  assert.equal(hzLabel(12500), '12.5 kHz');
  assert.equal(dbLabel(3), '+3 dB');
  assert.equal(dbLabel(-0.5), '−0.5 dB');
  assert.deepEqual(optionsFor(gameById('pan'), 1).map((o) => o.label), ['Left 100%', 'Left 50%', 'Centre', 'Right 50%', 'Right 100%']);
  assert.deepEqual(optionsFor(gameById('compression'), 2).map((o) => o.label), ['None', '2:1', '4:1', '10:1']);
  assert.deepEqual(optionsFor(gameById('compression'), 3).map((o) => o.label), ['Attack 0.5 ms', 'Attack 10 ms', 'Attack 60 ms']);
  assert.deepEqual(optionsFor(gameById('filters'), 0).map((o) => o.label), ['Low-pass 3 kHz', 'High-pass 300 Hz', 'High shelf +8 dB', 'Low shelf +8 dB']);
  assert.deepEqual(optionsFor(gameById('distortion'), 0), [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }]);
  assert.equal(THIRD_OCTAVE_BANDS.length, 25);
});

test('questions: every answer comes up equally often, and A/B are a fair coin', () => {
  const random = seededRandom(42);
  const game = gameById('eq-boost');
  const counts = {};
  for (let i = 0; i < 9000; i++) { const q = makeQuestion(game, 1, random); counts[q.answer] = (counts[q.answer] || 0) + 1; }
  assert.equal(Object.keys(counts).length, 9);
  for (const c of Object.values(counts)) near(c, 1000, 120, 'times asked');
  let a = 0;
  for (let i = 0; i < 4000; i++) if (makeQuestion(gameById('distortion'), 0, random).answer === 'A') a++;
  near(a, 2000, 150, 'times A');
  // The first answer when "random" is fixed at 0 (the browser test relies on this).
  assert.equal(makeQuestion(game, 1, () => 0).answer, '63');
  const pitch = makeQuestion(gameById('pitch'), 0, random);
  assert.ok(pitch.extra.baseHz >= 220 && pitch.extra.baseHz <= 880);
});

test('judging: exact on octave bands; one band either side counts on third-octave bands', () => {
  const game = gameById('eq-boost');
  assert.deepEqual(judge(game, 1, '1000', '1000'), { right: true, steps: 0 });
  assert.deepEqual(judge(game, 1, '1000', '2000'), { right: false, steps: 1 });
  assert.deepEqual(judge(game, 4, '1000', '1250'), { right: true, steps: 1 });
  assert.deepEqual(judge(game, 4, '1000', '1600'), { right: false, steps: 2 });
  assert.equal(judge(gameById('pitch'), 0, 'A', 'B').right, false);
});

test('passing a level: 8 of 10, or 9 of 10 with two answers; guessing passes under 2 times in 100', () => {
  assert.equal(passMark(1 / 2), 9);
  assert.equal(passMark(1 / 3), 8);
  assert.equal(passMark(1 / 9), 8);
  near(chanceOfScore(9, 0.5), 11 / 1024, 1e-12, 'two answers, 9 or 10 right by luck');
  near(chanceOfScore(0, 0.3), 1, 1e-12, 'any score');
  for (const game of GAMES) {
    game.levels.forEach((_, i) => {
      const p = chanceOfRight(game, i);
      const mark = passMark(p);
      assert.ok(mark >= 8 && mark <= ROUND_LENGTH);
      assert.ok(chanceOfScore(mark, p) < 0.02, `${game.id} level ${i + 1}: guessing passes ${(100 * chanceOfScore(mark, p)).toFixed(2)}% of the time`);
    });
  }
  assert.equal(chanceOfRight(gameById('eq-boost'), 4), 3 / 25);
});

test('every level of every exercise makes sound that is finite, not clipped and differs from the original', () => {
  for (const game of GAMES) {
    const src = sourceFor(game);
    game.levels.forEach((level, i) => {
      const random = seededRandom(i + 1);
      const q = makeQuestion(game, i, random);
      const keys = game.mode === 'which' ? ['A', 'B'] : ['original', ...optionsFor(game, i).map((o) => o.key)];
      const clips = keys.map((key) => variantClip(game, src, q, key));
      clips.forEach((clip, k) => {
        assert.equal(clip.sampleRate, FS);
        assert.ok(clip.channels.every((ch) => ch.every(Number.isFinite)), `${game.id} L${i + 1} ${keys[k]}`);
        assert.ok(peakOf(clip) <= 1, `${game.id} L${i + 1} ${keys[k]} peaks at ${peakOf(clip).toFixed(2)}`);
        assert.ok(rmsOf(clip) > 0.001, `${game.id} L${i + 1} ${keys[k]} is audible`);
      });
      // All versions have the same length, so they can play in step.
      assert.equal(new Set(clips.map((c) => c.channels[0].length)).size, 1, `${game.id} L${i + 1}`);
      if (game.mode === 'which') {
        const [a, b] = clips.map((c) => c.channels[0]);
        assert.ok(a.some((v, n) => Math.abs(v - b[n]) > 1e-5), `${game.id} L${i + 1}: A and B differ`);
      }
    });
  }
});

test('the question\'s answer is what the Changed sound really is', () => {
  // EQ boost, level 3: +9 dB at the asked band, measured on pink noise.
  const eq = gameById('eq-boost');
  for (const hz of [125, 1000, 8000]) {
    const q = { level: 2, answer: String(hz), value: hz, extra: null };
    const before = bandPowers(SRC.pink.clip.channels[0], [[hz * 0.97, hz * 1.03]], 32768)[0];
    const after = bandPowers(variantClip(eq, SRC.pink, q, String(hz)).channels[0], [[hz * 0.97, hz * 1.03]], 32768)[0];
    near(10 * Math.log10(after / before), 9, 0.25, `gain at ${hz} Hz`);
  }
  // EQ cut, level 1: −12 dB.
  const cutQ = { level: 0, answer: '500', value: 500, extra: null };
  const b = bandPowers(SRC.pink.clip.channels[0], [[485, 515]], 32768)[0];
  const a = bandPowers(variantClip(gameById('eq-cut'), SRC.pink, cutQ, '500').channels[0], [[485, 515]], 32768)[0];
  near(10 * Math.log10(a / b), -12, 0.25, 'cut at 500 Hz');
  // Loudness: exactly the asked change.
  const level = gameById('level');
  for (const db of [-2, -0.5, 1]) near(levelChangeDb(variantClip(level, SRC.pink, { level: 3 }, String(db)), SRC.pink.clip), db, 1e-4, `${db} dB`);
  // Pitch: the higher one is `cents` above the other.
  const pitch = gameById('pitch');
  const q = { level: 0, answer: 'B', value: 50, extra: { baseHz: 400 } };
  const count = (clip) => { let c = 0; const ch = clip.channels[0]; for (let i = 1; i < FS * 0.8; i++) if (ch[i - 1] < 0 && ch[i] >= 0) c++; return c / 0.8; };
  near(1200 * Math.log2(count(variantClip(pitch, SRC.tone, q, 'B')) / count(variantClip(pitch, SRC.tone, q, 'A'))), 50, 6, 'cents between B and A');
});

test('where loudness would give the answer away, both versions have the same power', () => {
  const sameLevel = (game, src, levelIndex) => {
    const q = makeQuestion(game, levelIndex, seededRandom(9));
    const keys = game.mode === 'which' ? ['A', 'B'] : optionsFor(game, levelIndex).map((o) => o.key);
    const reference = rmsOf(variantClip(game, src, q, game.mode === 'which' ? 'A' : 'original'));
    for (const key of keys) near(gainToDb(rmsOf(variantClip(game, src, q, key)) / reference), 0, 0.02, `${game.id} L${levelIndex + 1} ${key}`);
  };
  for (const id of ['compression', 'distortion', 'pan', 'width']) {
    const game = gameById(id);
    game.levels.forEach((_, i) => sameLevel(game, sourceFor(game), i));
  }
  // Echo and reverb: every answer adds the same amount, so loudness can't tell them apart.
  for (const id of ['delay', 'reverb']) {
    const game = gameById(id);
    const levels = optionsFor(game, 0).map((o) => rmsOf(variantClip(game, SRC.drums, { level: 0 }, o.key)));
    for (const l of levels) near(gainToDb(l / levels[0]), 0, 0.01, `${id}: level of each answer`);
  }
});

test('compression levels really differ: the higher the ratio, the smaller the gap between loud and quiet moments', () => {
  const game = gameById('compression');
  // The level of every 10 ms slice; the gap between the loud ones (95th percentile) and the quiet ones (20th).
  const range = (clip) => {
    const size = FS / 100, ch = clip.channels[0], levels = [];
    for (let start = 0; start + size <= ch.length; start += size) levels.push(gainToDb(rmsOf(makeClip(FS, ch.subarray(start, start + size)))));
    levels.sort((a, b) => a - b);
    return levels[Math.floor(levels.length * 0.95)] - levels[Math.floor(levels.length * 0.2)];
  };
  const [none, two, four, ten] = optionsFor(game, 2).map((o) => range(variantClip(game, SRC.drums, { level: 2 }, o.key)));
  assert.ok(none > two + 3 && two > four + 1.5 && four > ten + 1, `loud-to-quiet gap ${[none, two, four, ten].map((c) => c.toFixed(1))} dB`);
  if (process.env.SHOW) console.log('range', [none, two, four, ten].map((c) => c.toFixed(1)));
});

test('progress: rounds, best scores and passes are kept, and broken saved data is ignored', () => {
  const game = gameById('level');
  const p = new GameProgress(game, { level: 2, book: { 3: { attempts: 4, correct: 3 }, bad: 'x' }, rounds: { 0: { played: 2, best: 9, passed: true }, 99: { played: 1, best: 1 } } });
  assert.equal(p.level, 2);
  assert.equal(p.passedLevels, 1);
  assert.deepEqual(Object.keys(p.rounds), ['0']);
  assert.deepEqual(p.finishRound(1, 7), { mark: 8, passed: false });
  assert.deepEqual(p.finishRound(1, 8), { mark: 8, passed: true });
  assert.equal(p.passedLevels, 2);
  assert.deepEqual(p.rounds[1], { played: 2, best: 8, passed: true });
  const again = new GameProgress(game, JSON.parse(JSON.stringify(p)));
  assert.deepEqual(again.toJSON(), p.toJSON());
  assert.equal(new GameProgress(game, { level: 77 }).level, 0);
  assert.equal(new GameProgress(game, null).level, 0);
});

test('scores are filed per answer (or per level for A/B exercises)', () => {
  assert.equal(scoreKey(gameById('eq-boost'), { level: 1, answer: '1000' }), '1000');
  assert.equal(scoreKey(gameById('pitch'), { level: 2, answer: 'A' }), 'L3');
  assert.deepEqual(scoreRows(gameById('pitch')).map((r) => r.label), ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5']);
  assert.equal(scoreRows(gameById('eq-boost')).length, 25); // every band once
});

test('days practised and the streak', () => {
  assert.equal(dayKey(new Date(2026, 2, 9)), '2026-03-09');
  let days = {};
  days = addRoundToday(days, '2026-03-07');
  days = addRoundToday(days, '2026-03-08');
  days = addRoundToday(days, '2026-03-08');
  assert.deepEqual(days, { '2026-03-07': 1, '2026-03-08': 2 });
  assert.equal(dayStreak(days, new Date(2026, 2, 8, 23)), 2);
  assert.equal(dayStreak(days, new Date(2026, 2, 9, 8)), 2);   // today not done yet: still counts
  assert.equal(dayStreak(days, new Date(2026, 2, 10, 8)), 0);  // a whole day missed
  assert.equal(dayStreak({}, new Date()), 0);
  let many = {};
  for (let i = 1; i <= 120; i++) many = addRoundToday(many, dayKey(new Date(2026, 0, i)));
  assert.equal(Object.keys(many).length, 90);
});
