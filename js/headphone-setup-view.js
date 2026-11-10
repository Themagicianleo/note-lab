// headphone-setup-view.js
// ------------------------------------------------------------
// "Headphone setup" on the Train tab: a left / centre / right check and a few
// test tones, next to the list of settings to switch off (in index.html).
// The critical-listening exercises only mean something if the headphones
// play what the app sends: no spatial audio, no equaliser, and not the
// low-quality "call" mode Bluetooth uses while the microphone is on.
// ------------------------------------------------------------

import { pinkSource } from './listening-sources.js';
import { panClip } from './listening-dsp.js';
import { hzLabel } from './listening-games.js';
import { playOnce } from './loop-player.js';
import { preferPlaybackAudio } from './trainer-ui.js';

const byId = (id) => document.getElementById(id);
// From deep bass to the top of hearing. All are pure sines at the same level.
export const CHECK_TONES = [40, 63, 125, 1000, 8000, 12500, 16000];

export function createHeadphoneSetup({ player, isListening, stopListening }) {
  const el = { micWarning: byId('setup-mic-warning'), stopMic: byId('setup-stop-mic'), tones: byId('setup-tones') };
  let noise = null;
  let playing = null;

  function stop() {
    try { if (playing) playing.stop(); } catch { /* already ended */ }
    playing = null;
  }

  // Pink noise for 1.5 s in one ear, or in the middle.
  function playSide(position) {
    const context = player.ensureContext();
    preferPlaybackAudio(isListening());
    if (!noise || noise.sampleRate !== context.sampleRate) noise = pinkSource(context.sampleRate, { seconds: 2 });
    stop();
    playing = playOnce(context, panClip(noise, position), 1.5);
  }

  byId('setup-left').addEventListener('click', () => playSide(-1));
  byId('setup-centre').addEventListener('click', () => playSide(0));
  byId('setup-right').addEventListener('click', () => playSide(1));

  for (const hz of CHECK_TONES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-small';
    button.textContent = hzLabel(hz);
    button.addEventListener('click', () => {
      preferPlaybackAudio(isListening());
      stop();
      player.playFrequency(hz, { duration: 1.2, harmonics: [0, 1] }); // [0, 1] = a pure sine
    });
    el.tones.append(button);
  }
  el.stopMic.addEventListener('click', () => stopListening());

  return {
    refresh() { el.micWarning.hidden = !isListening(); },
    hide: stop,
  };
}
