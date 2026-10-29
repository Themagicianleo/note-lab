// Tests for the pitch monitor's maths: js/scales.js, js/pitch-stats.js,
// js/pitch-history.js, js/monitor-window.js, js/voice-types.js, js/file-analysis.js.
// Each expected value can be checked by hand (worked out in the comments).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCALES, scalePitchClasses, inScale, nearestScaleNote, scaleForMode } from '../js/scales.js';
import { pitchStats } from '../js/pitch-stats.js';
import { PitchHistory } from '../js/pitch-history.js';
import { createWindow, zoomNotes, scrollNotes, zoomTime, scrollTime, follow, noteToY, yToNote, timeToX, xToTime, NOTE_LIMITS } from '../js/monitor-window.js';
import { VOICE_TYPES, rankVoiceTypes, overlap } from '../js/voice-types.js';
import { analyseSamples, mixToMono } from '../js/file-analysis.js';
import { noteNumberToFrequency } from '../js/pitch-math.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const sorted = (set) => [...set].sort((a, b) => a - b);

// ---------- scales ----------

test('C major is the white keys', () => {
  assert.deepEqual(sorted(scalePitchClasses(0, 'major')), [0, 2, 4, 5, 7, 9, 11]);
});

test('G major has F♯ (6), not F (5)', () => {
  // G A B C D E F♯ = 7 9 11 0 2 4 6
  assert.deepEqual(sorted(scalePitchClasses(7, 'major')), [0, 2, 4, 6, 7, 9, 11]);
});

test('A natural minor has the same notes as C major (relative keys)', () => {
  assert.deepEqual(sorted(scalePitchClasses(9, 'naturalMinor')), sorted(scalePitchClasses(0, 'major')));
});

test('A harmonic minor raises G to G♯', () => {
  const pcs = scalePitchClasses(9, 'harmonicMinor');
  assert.ok(pcs.has(8) && !pcs.has(7));
});

test('scale sizes: 7, 7, 7, 5, 5, 12', () => {
  assert.deepEqual(Object.values(SCALES).map((s) => s.steps.length), [7, 7, 7, 5, 5, 12]);
});

test('an unknown scale gives null; no scale means every note fits', () => {
  assert.equal(scalePitchClasses(0, 'nope'), null);
  assert.equal(inScale(61, null), true);
});

test('nearest scale note: 61.3 (C♯4 + 30 cents) in C major is D4 (62)', () => {
  // C♯ is not in C major; C (60) is 1.3 away, D (62) is 0.7 away.
  assert.equal(nearestScaleNote(61.3, scalePitchClasses(0, 'major')), 62);
  assert.equal(nearestScaleNote(60.5, scalePitchClasses(0, 'major')), 60); // C is 0.5 away, D is 1.5
  assert.equal(nearestScaleNote(61.3, null), 61);                          // no scale: just round
});

test('a key finder mode maps to a scale', () => {
  assert.equal(scaleForMode('major'), 'major');
  assert.equal(scaleForMode('minor'), 'naturalMinor');
});

// ---------- pitch statistics ----------

// Readings every 20 ms (50 per second) for `seconds`, at frequency hz.
function steady(hz, seconds, t0 = 0) {
  return Array.from({ length: Math.round(seconds * 50) }, (_, i) => ({ t: t0 + i * 20, hz }));
}

test('a perfectly tuned A4 is 100% within ±10 cents, mean 0', () => {
  const s = pitchStats(steady(440, 2));
  close(s.voiced, 2, 1e-9);
  assert.equal(s.within[0].fraction, 1);
  close(s.meanCents, 0, 1e-9);
  assert.equal(s.lowest, 69);
  assert.equal(s.highest, 69);
  assert.equal(s.mostSung.note, 69);
});

test('A4 sung 20 cents sharp: mean +20, within ±25 but not ±10', () => {
  const hz = 440 * 2 ** (20 / 1200); // 445.1 Hz
  const s = pitchStats(steady(hz, 1));
  close(s.meanCents, 20, 1e-6);
  close(s.meanAbsCents, 20, 1e-6);
  assert.equal(s.within[0].fraction, 0);
  assert.equal(s.within[1].fraction, 1);
});

test('half the time +20 cents, half −20: mean 0 but mean distance 20', () => {
  const sharp = 440 * 2 ** (20 / 1200);
  const flat = 440 * 2 ** (-20 / 1200);
  const s = pitchStats([...steady(sharp, 1), ...steady(flat, 1, 1000)]);
  close(s.meanCents, 0, 1e-6);
  close(s.meanAbsCents, 20, 1e-6);
});

test('gaps (no pitch) count towards total time but not singing time', () => {
  const readings = [...steady(440, 1), ...steady(null, 1, 1000)];
  const s = pitchStats(readings);
  close(s.voiced, 1, 1e-9);
  close(s.total, 2, 1e-9);
});

test('a long pause between readings counts as at most 0.1 s', () => {
  const s = pitchStats([{ t: 0, hz: 440 }, { t: 5000, hz: 440 }]);
  close(s.voiced, 0.2, 1e-9); // 0.1 s for the first, 0.1 s (the same, capped) for the last
});

test('with a scale chosen, C♯ is measured against the nearest scale note', () => {
  // C♯4 exactly (61). In C major, nearest scale notes are C (60) and D (62), both 100 cents away; ties go down → +100.
  const s = pitchStats(steady(noteNumberToFrequency(61), 1), { pitchClasses: scalePitchClasses(0, 'major') });
  close(s.meanCents, 100, 1e-6);
  assert.equal(s.lowest, 61); // the sung note is still reported as C♯4
});

test('no pitched readings: fractions and means are null', () => {
  const s = pitchStats(steady(null, 1));
  assert.equal(s.meanCents, null);
  assert.equal(s.within[0].fraction, null);
  assert.equal(s.lowest, null);
});

test('reference pitch A4 = 442: 442 Hz is in tune', () => {
  const s = pitchStats(steady(442, 1), { a4: 442 });
  close(s.meanCents, 0, 1e-9);
});

// ---------- pitch history ----------

test('history keeps only the last N seconds', () => {
  const h = new PitchHistory({ seconds: 1 });
  for (let t = 0; t <= 3000; t += 10) h.add(t, 440);
  assert.equal(h.first.t, 2000);
  assert.equal(h.last.t, 3000);
  assert.equal(h.length, 101);
});

test('between() returns the readings in a time range, plus one either side', () => {
  const h = new PitchHistory();
  for (let t = 0; t <= 1000; t += 100) h.add(t, t);
  assert.deepEqual(h.between(250, 450).map((r) => r.t), [200, 300, 400, 500]);
  assert.deepEqual(h.between(5000, 6000).map((r) => r.t), [1000]); // only the last one, as the left neighbour
});

test('history survives its internal clean-up', () => {
  const h = new PitchHistory({ seconds: 10 });
  for (let t = 0; t < 200000; t += 10) h.add(t, 1);
  assert.equal(h.length, 1001);
  assert.equal(h.between(199000, 199010)[1].t, 199000);
});

// ---------- the monitor window (zoom and scroll) ----------

test('zooming notes keeps the focus note at the same height', () => {
  const w = createWindow({ lowNote: 48, highNote: 72 }); // C3–C5, 24 semitones
  const z = zoomNotes(w, 0.5, 66);                       // focus F♯4 is at 75% height
  close(z.highNote - z.lowNote, 12);
  close((66 - z.lowNote) / (z.highNote - z.lowNote), 0.75);
  close(noteToY(z, 66, 400), noteToY(w, 66, 400));       // same pixel
});

test('zoom and scroll stay within C1–C8 and 6–84 semitones', () => {
  const w = createWindow({ lowNote: 48, highNote: 72 });
  const tiny = zoomNotes(w, 0.01);
  close(tiny.highNote - tiny.lowNote, 6);
  const all = zoomNotes(w, 100);
  assert.equal(all.lowNote, NOTE_LIMITS.low);
  assert.equal(all.highNote, NOTE_LIMITS.high);
  const up = scrollNotes(w, 1000);
  assert.equal(up.highNote, NOTE_LIMITS.high);
  close(up.highNote - up.lowNote, 24);
});

test('zooming time doubles the seconds shown, within 2–300 s', () => {
  const w = createWindow({ spanSec: 10 });
  assert.equal(zoomTime(w, 2).spanSec, 20);
  assert.equal(zoomTime(w, 0.01).spanSec, 2);
  assert.equal(zoomTime(w, 1000).spanSec, 300);
});

test('scrolling back in time leaves live mode; scrolling to the newest returns to it', () => {
  let w = { ...createWindow({ spanSec: 10 }), endT: 60000 };
  const range = { oldest: 0, newest: 60000 };
  w = scrollTime(w, -5000, range);
  assert.equal(w.endT, 55000);
  assert.equal(w.live, false);
  w = scrollTime(w, -100000, range);
  assert.equal(w.endT, 10000); // can't scroll before the oldest reading + the window width
  w = scrollTime(w, 999999, range);
  assert.equal(w.endT, 60000);
  assert.equal(w.live, true);
});

test('follow: a note above the window moves it up just enough', () => {
  const w = createWindow({ lowNote: 48, highNote: 72 });
  const f = follow(w, 75);       // 2 semitones margin → top edge 77
  assert.equal(f.highNote, 77);
  assert.equal(f.lowNote, 53);
  assert.equal(follow(w, 60), w); // inside: unchanged
});

test('screen ↔ note and time conversions are inverses', () => {
  const w = { ...createWindow({ lowNote: 48, highNote: 72, spanSec: 10 }), endT: 20000 };
  assert.equal(noteToY(w, 72, 240), 0);   // top edge
  assert.equal(noteToY(w, 48, 240), 240); // bottom edge
  close(yToNote(w, noteToY(w, 57.3, 240), 240), 57.3);
  assert.equal(timeToX(w, 20000, 300), 300); // now = right edge
  assert.equal(timeToX(w, 10000, 300), 0);   // 10 s ago = left edge
  close(xToTime(w, timeToX(w, 14321, 300), 300), 14321);
});

// ---------- voice types ----------

test('voice type ranges are two octaves each, in order', () => {
  for (const v of VOICE_TYPES) assert.equal(v.high - v.low, 24);
  for (let i = 1; i < VOICE_TYPES.length; i++) assert.ok(VOICE_TYPES[i].low > VOICE_TYPES[i - 1].low);
});

test('overlap counts shared semitones', () => {
  assert.equal(overlap(48, 60, 55, 70), 5);
  assert.equal(overlap(40, 50, 60, 70), 0);
});

test('a range of G2–G4 (43–67) ranks Baritone first', () => {
  // Shared: bass 40–64 → 21, baritone 45–69 → 22, tenor 48–72 → 19.
  const ranked = rankVoiceTypes(43, 67);
  assert.equal(ranked[0].id, 'baritone');
  assert.equal(ranked[0].shared, 22);
});

test('a range of C4–A5 (60–81) ranks Mezzo-soprano first', () => {
  // Shared: mezzo 57–81 → 21, soprano 60–84 → 21 (tie); middles: mezzo 69, soprano 72; yours 70.5 → mezzo is closer.
  assert.equal(rankVoiceTypes(60, 81)[0].id, 'mezzo');
});

test('less than 7 semitones: no guess', () => {
  assert.equal(rankVoiceTypes(60, 65), null);
  assert.equal(rankVoiceTypes(null, null), null);
});

// ---------- file analysis ----------

test('mixToMono averages channels', () => {
  const m = mixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
  assert.deepEqual([...m], [0.5, 0.5]);
});

test('a 1 s A3 sine, then 0.5 s silence, gives A3 then no pitch', async () => {
  const sr = 48000;
  const samples = new Float32Array(1.5 * sr);
  for (let i = 0; i < sr; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr);
  const readings = await analyseSamples(samples, sr, { minHz: 65, maxHz: 500, gateDb: -55, smoothingLevel: 2, windowSize: 2048 });
  // (1.5 s − 2048 samples) / (1/60 s) + 1 = 88 readings
  assert.equal(readings.length, 88);
  const at = (ms) => readings.find((r) => r.t >= ms);
  close(at(500).hz, 220, 0.5);
  assert.equal(at(1400).hz, null);
});
