// Tests for js/key-finder.js. Comments show how to check the numbers by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as kf from '../js/key-finder.js';

const close = (a, b, tol, label = '') => assert.ok(Math.abs(a - b) <= tol, `${label} expected ${b} ± ${tol}, got ${a}`);

test('Pearson correlation: identical shape = 1, opposite = −1, flat = 0', () => {
  close(kf.pearson([1, 2, 3], [2, 4, 6]), 1, 1e-12);
  close(kf.pearson([1, 2, 3], [3, 2, 1]), -1, 1e-12);
  assert.equal(kf.pearson([5, 5, 5], [1, 2, 3]), 0);
  // By hand: x = [1, 2, 4] (mean 7/3), y = [1, 3, 2] (mean 2)
  //   deviations x: −1.333, −0.333, +1.667   y: −1, +1, 0
  //   Σ(dx·dy) = 1.333 − 0.333 + 0 = 1.0;  Σdx² = 4.667;  Σdy² = 2
  //   r = 1.0 / √(4.667 × 2) = 0.3273
  close(kf.pearson([1, 2, 4], [1, 3, 2]), 0.3273, 0.0001);
});

test('a profile matching a key exactly gives r = 1 for that key', () => {
  const gMajor = kf.profileFor(7, 'major'); // G = pitch class 7
  const best = kf.keyScores(gMajor)[0];
  assert.equal(best.name, 'G major');
  close(best.r, 1, 1e-12);
  assert.equal(kf.keyScores(kf.profileFor(2, 'minor'))[0].name, 'D minor');
});

test('profiles are the Krumhansl–Kessler values, starting at the tonic', () => {
  assert.equal(kf.KK_MAJOR.length, 12);
  assert.equal(kf.profileFor(0, 'major')[0], 6.35);  // C major: C is the tonic
  assert.equal(kf.profileFor(0, 'major')[7], 5.19);  // G, the fifth
  // A minor: C is 3 semitones above A, so A minor's value for C is KK_MINOR[3] = 5.38
  assert.equal(kf.profileFor(9, 'minor')[0], 5.38);
});

test('relative keys: C major ↔ A minor, E♭ major ↔ C minor', () => {
  assert.deepEqual(kf.relativeKey({ tonic: 0, mode: 'major' }), { tonic: 9, mode: 'minor' });
  assert.deepEqual(kf.relativeKey({ tonic: 0, mode: 'minor' }), { tonic: 3, mode: 'major' });
  assert.equal(kf.keyName(3, 'major'), 'E♭ major');
  assert.equal(kf.keyName(1, 'minor'), 'C♯ minor');
});

test('tuning offset: a singer 40 cents flat is detected and corrected', () => {
  // Notes C4, E4, G4 (60, 64, 67) all sung 40 cents flat
  const readings = [60, 64, 67].map((n) => ({ n: n - 0.4, weight: 1 }));
  close(kf.tuningOffsetCents(readings), -40, 1e-9);
  assert.deepEqual(kf.pitchClassProfile(readings, -40).map((w, pc) => (w ? pc : null)).filter((x) => x !== null), [0, 4, 7]);
  // A limit, stated honestly: 60 cents flat is the same as 40 cents SHARP of the
  // notes a semitone lower, so it can't tell which was meant (it picks +40).
  close(kf.tuningOffsetCents([60, 64, 67].map((n) => ({ n: n - 0.6, weight: 1 }))), 40, 1e-9);
});

test('tuning offset averages across the ±50 cent wrap-around', () => {
  // +45 and −45 cents are 10 cents apart on the circle; the average is ±50, not 0.
  close(Math.abs(kf.tuningOffsetCents([{ n: 60.45, weight: 1 }, { n: 60.55, weight: 1 }])), 50, 1e-9);
});

test('pitch-class profile adds weights per note name, ignoring octave', () => {
  const h = kf.pitchClassProfile([{ n: 60, weight: 2 }, { n: 72, weight: 1 }, { n: 67.1, weight: 3 }]);
  assert.equal(h[0], 3); // C4 + C5
  assert.equal(h[7], 3); // G4 (+10 cents)
  assert.equal(h.reduce((a, b) => a + b, 0), 6);
});

test('worked example: "Twinkle Twinkle" in C, by note durations → C major', () => {
  // C C G G A A G(2) F F E E D D C(2) — durations in beats
  const tune = [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2]];
  const { scores } = kf.findKey(tune.map(([n, w]) => ({ n, weight: w })));
  assert.equal(scores[0].name, 'C major');
});
