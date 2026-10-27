// app.js
// ------------------------------------------------------------
// Wires the page together:
//   Start button → microphone → (about 60 times a second):
//     read 2048 samples → level in dBFS → volume gate → YIN → smoothing → display
// ------------------------------------------------------------

import { startMicrophone, checkMicrophoneSupport } from './audio-input.js';
import { detectPitchYin, YIN_DEFAULTS } from './yin.js';
import { PitchSmoother } from './smoothing.js';
import { levelDb } from './level.js';
import { frequencyToNote, DEFAULT_A4 } from './pitch-math.js';
import { createTunerView } from './tuner-view.js';

// Settings (a settings page comes in Phase 6).
const settings = {
  a4: DEFAULT_A4,      // reference pitch in Hz
  gateDb: -60,         // quieter than this = "too quiet", no detection
  windowSize: 2048,    // samples per reading (~43 ms at 48 kHz)
  minHz: YIN_DEFAULTS.minHz,
  maxHz: YIN_DEFAULTS.maxHz,
};

// Readings per second. Screens refresh 60–120 times a second; we cap it at
// about 60 so the smoothing behaves the same on every device.
const MIN_MS_BETWEEN_READINGS = 15;

const startPanel = document.getElementById('start-panel');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const tunerSection = document.getElementById('tuner');
const message = document.getElementById('message');
const view = createTunerView();

let mic = null;          // the running microphone, or null
let frameRequest = null; // the id from requestAnimationFrame, so we can cancel it
let lastReading = 0;
const smoother = new PitchSmoother();

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

// Warn early (before any tap) if the microphone cannot work on this page.
const problem = checkMicrophoneSupport();
if (problem) showMessage(problem.message);

startButton.addEventListener('click', async () => {
  showMessage('');
  startButton.disabled = true;
  startButton.textContent = 'Waiting for permission…';
  try {
    // Called directly inside the tap, as iPhone Safari requires.
    mic = await startMicrophone({
      fftSize: settings.windowSize,
      onEnded: () => {
        stopListening();
        showMessage('The microphone stopped (it may have been unplugged or taken by another app). Tap Start to try again.');
      },
    });
  } catch (error) {
    showMessage(error.message);
    startButton.disabled = false;
    startButton.textContent = 'Start listening';
    return;
  }

  startPanel.hidden = true;
  tunerSection.hidden = false;
  view.setGate(settings.gateDb);
  view.setTechInfo(
    `Sample rate ${mic.sampleRate} Hz · window ${settings.windowSize} samples ` +
    `(${((1000 * settings.windowSize) / mic.sampleRate).toFixed(0)} ms) · range ${settings.minHz}–${settings.maxHz} Hz · A4 = ${settings.a4} Hz`
  );
  listen();
});

stopButton.addEventListener('click', () => stopListening());

function stopListening() {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = null;
  if (mic) mic.stop();
  mic = null;
  smoother.reset();
  tunerSection.hidden = true;
  startPanel.hidden = false;
  startButton.disabled = false;
  startButton.textContent = 'Start listening';
}

// The main loop. requestAnimationFrame calls it before each screen refresh.
function listen() {
  const buffer = new Float32Array(mic.analyser.fftSize);

  function tick(now) {
    frameRequest = requestAnimationFrame(tick);
    if (now - lastReading < MIN_MS_BETWEEN_READINGS) return;
    lastReading = now;

    // 1. Copy the latest samples from the microphone.
    mic.analyser.getFloatTimeDomainData(buffer);

    // 2. How loud is it?
    const db = levelDb(buffer);

    // 3. Too quiet → don't even try (avoids random notes from background hiss).
    let frequency = null;
    let reason = 'quiet';
    if (db >= settings.gateDb) {
      const result = detectPitchYin(buffer, mic.sampleRate, { minHz: settings.minHz, maxHz: settings.maxHz });
      frequency = result.frequency;
      reason = 'unclear';
    }

    // 4. Smooth over the last few readings, then 5. display.
    const smoothed = smoother.push(frequency);
    view.update({ note: smoothed ? frequencyToNote(smoothed, settings.a4) : null, reason, levelDb: db });
  }

  frameRequest = requestAnimationFrame(tick);
}

// iPhone pauses audio when the app goes to the background or a call comes in.
// When the page is visible again, try to carry on.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !mic) return;
  if (mic.context.state !== 'running') {
    try {
      await mic.context.resume();
    } catch {
      // handled just below
    }
    // resume() can finish without error but leave audio paused, so check the state.
    if (mic && mic.context.state !== 'running') {
      stopListening();
      showMessage('Listening was paused while the app was in the background. Tap Start to continue.');
    }
  }
});
