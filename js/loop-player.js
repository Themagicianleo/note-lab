// loop-player.js
// ------------------------------------------------------------
// Plays several versions of the same loop exactly in step, with one of them
// audible, and switches between them instantly (a 15 ms cross-fade, so there
// is no click and no gap). This is how the critical-listening exercises let
// you compare "Original" and "Changed" at the same moment in the music.
//
// A clip is { sampleRate, channels: [left, right] } (js/listening-dsp.js);
// all clips given to one player must have the same length.
// ------------------------------------------------------------

const FADE = 0.015; // seconds

export function createLoopPlayer(getContext) {
  let context = null;
  let master = null;
  let startedAt = 0;      // the context time when the loop started
  let loopSeconds = 0;
  let voices = new Map(); // key → { source, gain }
  let selected = null;

  function toBuffer(clip) {
    const buffer = context.createBuffer(2, clip.channels[0].length, clip.sampleRate);
    buffer.getChannelData(0).set(clip.channels[0]);
    buffer.getChannelData(1).set(clip.channels[1]);
    return buffer;
  }

  function addVoice(key, clip, when, offset) {
    const source = context.createBufferSource();
    source.buffer = toBuffer(clip);
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(master);
    source.start(when, offset);
    voices.set(key, { source, gain });
  }

  function stop() {
    if (!master) return;
    const t = context.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + 0.03); // fade out, no click
    for (const { source } of voices.values()) source.stop(t + 0.05);
    const old = master;
    setTimeout(() => old.disconnect(), 200);
    master = null;
    voices = new Map();
    selected = null;
  }

  // Make one version audible (the others keep running, silently).
  function select(key) {
    if (!master || !voices.has(key)) return;
    selected = key;
    const t = context.currentTime;
    for (const [k, { gain }] of voices) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(k === key ? 1 : 0, t + FADE);
    }
  }

  return {
    // Start all the clips together: clips = { key: clip, … }; `first` is the one you hear.
    start(clips, first) {
      stop();
      context = getContext();
      master = context.createGain();
      master.gain.setValueAtTime(0, context.currentTime);
      master.gain.linearRampToValueAtTime(1, context.currentTime + 0.08);
      master.connect(context.destination);
      startedAt = context.currentTime + 0.06;
      for (const [key, clip] of Object.entries(clips)) {
        loopSeconds = clip.channels[0].length / clip.sampleRate;
        addVoice(key, clip, startedAt, 0);
      }
      select(first);
    },
    // Add another version while playing; it joins at the same place in the loop.
    add(key, clip) {
      if (!master || voices.has(key)) return;
      const when = context.currentTime + 0.05;
      const offset = (((when - startedAt) % loopSeconds) + loopSeconds) % loopSeconds;
      addVoice(key, clip, when, offset);
    },
    has: (key) => voices.has(key),
    select,
    stop,
    get playing() { return Boolean(master); },
    get selected() { return selected; },
  };
}

// Play a clip once (not looped), with a short fade at both ends.
export function playOnce(context, clip, seconds) {
  const buffer = context.createBuffer(2, clip.channels[0].length, clip.sampleRate);
  buffer.getChannelData(0).set(clip.channels[0]);
  buffer.getChannelData(1).set(clip.channels[1]);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = context.createGain();
  const t = context.currentTime + 0.02;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + 0.03);
  gain.gain.setValueAtTime(1, t + seconds - 0.05);
  gain.gain.linearRampToValueAtTime(0, t + seconds);
  source.connect(gain);
  gain.connect(context.destination);
  source.start(t);
  source.stop(t + seconds + 0.02);
  return source;
}
