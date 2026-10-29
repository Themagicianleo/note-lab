// polyphonic-check.js
// ------------------------------------------------------------
// What happens with MUSIC (a melody with other instruments), not a single
// note? Builds 8 s of a C-major melody (C5 → G5) over chords / bass / drums,
// runs YIN at several clarity settings, and counts how often it finds the
// MELODY note, a wrong note, or nothing. Run with:  node tools/polyphonic-check.js
//
// Result (recorded in the README): alone, the melody is found 99% of the time.
// With accompaniment, lowering the clarity requirement mostly adds WRONG notes
// (the mixture repeats at a rate set by the whole chord, not the melody), which
// is why Note Lab keeps the strict setting and says "no clear pitch".
// ------------------------------------------------------------

import { detectPitchYin } from '../js/yin.js';
import { levelDb } from '../js/level.js';
import { SENSITIVITY } from '../js/pitch-tracker.js';
import { bandFilter } from '../js/filters.js';

const SR = 48000;
const N = 2048;
let seed = 7; // repeatable "random" drum noise
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
const hz = (n) => 440 * 2 ** ((n - 69) / 12);

// An instrument-like tone: harmonics 1–8 at 1/k.
const tone = (f, t, amp) => {
  let s = 0;
  for (let k = 1; k <= 8; k++) s += Math.sin(2 * Math.PI * f * k * t) / k;
  return amp * s;
};

function make(kind) {
  const melody = [72, 74, 76, 77, 79, 77, 76, 74];                  // C5 D5 E5 F5 G5 F5 E5 D5, 1 s each
  const chords = [[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]]; // C, F, G, C (low), 2 s each
  const len = SR * 8;
  const out = new Float32Array(len);
  const truth = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const m = melody[Math.floor(t)];
    truth[i] = hz(m);
    let s = tone(hz(m), t, 0.3);
    if (kind !== 'solo') {
      for (const n of chords[Math.floor(t / 2)]) s += tone(hz(n), t, kind === 'loud-chords' ? 0.25 : 0.12);
    }
    if (kind === 'band') {
      s += tone(hz(36 + (Math.floor(t / 2) % 2) * 5), t, 0.2); // bass
      if ((t * 2) % 1 < 0.03) s += 0.4 * random();              // a drum hit twice a second
    }
    out[i] = s * 0.5;
  }
  return { out, truth };
}

for (const kind of ['solo', 'soft-chords', 'loud-chords', 'band']) {
  const { out, truth } = make(kind);
  const rows = [];
  const settings = [0.10, 0.15, 0.20, 0.25, 0.30].map((threshold) => [`clarity ≥ ${Math.round((1 - threshold) * 100)}%`, { threshold }]);
  // The sensitivity settings (YIN fallback for unclear sounds; see js/pitch-tracker.js).
  // (With the app's band filter, as live; the music here is loud, so the volume threshold doesn't matter.)
  for (const name of ['high', 'maximum']) settings.push([`${name} sensitivity`, { fallbackThreshold: SENSITIVITY[name].fallbackThreshold, subharmonicTolerance: SENSITIVITY[name].subharmonicTolerance, filter: true }]);
  const filtered = bandFilter(out, SR, 50, 1500);
  for (const [label, { filter, ...options }] of settings) {
    let frames = 0, found = 0, right = 0;
    const input = filter ? filtered : out;
    for (let s = 0; s + N < out.length; s += 800) {
      const w = input.subarray(s, s + N);
      if (levelDb(w) < -60) continue;
      frames++;
      const f = detectPitchYin(w, SR, { minHz: 50, maxHz: 1500, ...options }).frequency;
      if (!f) continue;
      found++;
      if (Math.abs(1200 * Math.log2(f / truth[s + N / 2])) <= 50) right++;
    }
    const pct = (x) => `${Math.round((100 * x) / frames)}%`;
    rows.push(`${label}: shows a note ${pct(found)}, melody right ${pct(right)}, wrong note ${pct(found - right)}`);
  }
  console.log(`== ${kind}\n  ${rows.join('\n  ')}`);
}
