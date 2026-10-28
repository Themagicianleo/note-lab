// tone-player.js
// ------------------------------------------------------------
// Plays notes with generated tones (Web Audio oscillators). No recorded
// samples and nothing downloaded: the sound is made by maths in the browser.
//
// The tone: a fundamental plus a few quieter harmonics (a soft, organ-like
// sound that is easier to hear the pitch of than a plain sine), shaped by an
// envelope so it fades in and out smoothly instead of clicking:
//
//   loudness
//     │   ┌──┐
//     │  /    ╲______________        attack 15 ms, then settle to 70%
//     │ /                    ╲       release 150 ms at the end
//     └──────────────────────────► time
// ------------------------------------------------------------

import { noteNumberToFrequency, DEFAULT_A4 } from './pitch-math.js';

// Harmonic loudness: index 1 = fundamental, 2 = 2nd harmonic, ...
const HARMONICS = [0, 1, 0.5, 0.25, 0.12, 0.06];
const VOLUME = 0.3;      // keep well below full scale, so two notes at once don't distort
const ATTACK = 0.015;    // seconds
const RELEASE = 0.15;    // seconds

export function createTonePlayer(existingContext = null) {
  let context = existingContext;
  let wave = null;
  const customWaves = new Map(); // other harmonic recipes, e.g. for the Lab's reference tones

  // The AudioContext must be created (or resumed) during a tap on iPhone,
  // so call this from a button's click handler.
  function ensureContext() {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      context = new AudioContextClass();
    }
    // Resume a paused (live) context. Offline contexts, used in tests, can't be resumed.
    const offline = typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext;
    if (context.state === 'suspended' && !offline) context.resume().catch(() => {});
    if (!wave) {
      const real = new Float32Array(HARMONICS.length);
      const imag = Float32Array.from(HARMONICS);
      wave = context.createPeriodicWave(real, imag);
    }
    return context;
  }

  // A wave with other harmonic loudnesses: harmonics[n] = loudness of harmonic n
  // (index 0 is unused). [0, 1] is a pure sine.
  function waveFor(harmonics) {
    const key = harmonics.join(',');
    if (!customWaves.has(key)) {
      customWaves.set(key, context.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics)));
    }
    return customWaves.get(key);
  }

  // Play one frequency. `start` is in seconds from now. `harmonics` (optional)
  // changes the tone colour, e.g. [0, 1] for a pure sine.
  // Returns the time (in the context's clock) when the note has fully ended.
  function playFrequency(frequency, { start = 0, duration = 1, harmonics = null } = {}) {
    const ctx = ensureContext();
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.setPeriodicWave(harmonics ? waveFor(harmonics) : wave);
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(VOLUME, t0 + ATTACK);
    gain.gain.linearRampToValueAtTime(VOLUME * 0.7, t0 + Math.min(duration, 0.3));
    gain.gain.setValueAtTime(VOLUME * 0.7, t0 + duration);
    gain.gain.linearRampToValueAtTime(0, t0 + duration + RELEASE);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + RELEASE + 0.02);
    return t0 + duration + RELEASE;
  }

  return {
    ensureContext,
    playFrequency,
    // Play a note number (e.g. 69 = A4) at the given reference pitch.
    playNote(noteNumber, options = {}, a4 = DEFAULT_A4) {
      return playFrequency(noteNumberToFrequency(noteNumber, a4), options);
    },
    get context() {
      return context;
    },
  };
}
