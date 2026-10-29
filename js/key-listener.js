// key-listener.js
// ------------------------------------------------------------
// Turns microphone buffers into key-finding "readings" (see key-finder.js),
// in one of two ways:
//   'singer' – one voice alone: YIN finds the sung pitch; each steady reading
//              counts for the time it lasted. Octave mistakes don't matter
//              here, because the key only uses note NAMES.
//   'song'   – music through a speaker (voice + instruments): no single pitch
//              exists, so the strongest spectrum peaks (80 Hz – 2 kHz) are
//              counted instead, weighted by loudness × time.
// It remembers the last 2 minutes, so a song that changes key catches up.
// Used by the Lab's Key finder and by tools/key-check.js (same code, so the
// measured accuracy is the app's accuracy).
// ------------------------------------------------------------

import { detectPitchYin } from './yin.js';
import { PitchSmoother } from './smoothing.js';
import { levelDb } from './level.js';
import { computeSpectrum, findPeaks } from './spectrum.js';
import { frequencyToNoteNumber, DEFAULT_A4 } from './pitch-math.js';
import { findKey } from './key-finder.js';

export const KEY_MEMORY_SECONDS = 120;
export const SONG_WINDOW = 8192;

export class KeyListener {
  constructor({ mode = 'singer', a4 = DEFAULT_A4, gateDb = -55, minHz = 80, maxHz = 1000 } = {}) {
    Object.assign(this, { mode, a4, gateDb, minHz, maxHz });
    this.reset();
  }

  reset() {
    this.readings = [];   // { n, weight, t }
    this.time = 0;        // seconds since reset
    this.heard = 0;       // seconds that produced readings
    this.smoother = new PitchSmoother(); // 'Balanced'
  }

  // buffer: the newest samples (at least 8192 for song mode); dt: seconds since the last call.
  push(buffer, sampleRate, dt) {
    this.time += dt;
    const before = this.readings.length;
    if (this.mode === 'singer') {
      const recent = buffer.subarray(buffer.length - 2048);
      const f = levelDb(recent) >= this.gateDb
        ? detectPitchYin(recent, sampleRate, { minHz: this.minHz, maxHz: this.maxHz }).frequency
        : null;
      const steady = this.smoother.push(f);
      if (steady) this.readings.push({ n: frequencyToNoteNumber(steady, this.a4), weight: dt, t: this.time });
    } else {
      const window = buffer.subarray(buffer.length - SONG_WINDOW);
      if (levelDb(window) >= this.gateDb) {
        const peaks = findPeaks(computeSpectrum(window, sampleRate), { count: 12, minHz: 80, maxHz: 2000, withinDb: 40, minDb: -75 });
        for (const p of peaks) this.readings.push({ n: frequencyToNoteNumber(p.hz, this.a4), weight: Math.pow(10, p.db / 20) * dt, t: this.time });
      }
    }
    if (this.readings.length > before) this.heard += dt;
    // Forget readings older than the memory window.
    const oldest = this.time - KEY_MEMORY_SECONDS;
    let drop = 0;
    while (drop < this.readings.length && this.readings[drop].t < oldest) drop++;
    if (drop) this.readings.splice(0, drop);
  }

  // { offset, histogram, scores } (see key-finder.js), plus seconds heard.
  result() {
    return { ...findKey(this.readings), heard: Math.min(this.heard, KEY_MEMORY_SECONDS), readings: this.readings.length };
  }
}
