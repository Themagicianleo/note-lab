// app.js
// ------------------------------------------------------------
// Wires the page together:
//   Start button → microphone → (about 60 times a second):
//     read samples → PitchTracker (level, volume gate, YIN, smoothing) → active view
//
// Two modes (tabs), each with its own detection settings:
//   Tuner – instruments; a standard or a low range
//   Voice – a voice range preset, adjustable volume threshold and smoothing,
//           pitch graph and range finder
// ------------------------------------------------------------

import { startMicrophone, checkMicrophoneSupport } from './audio-input.js';
import { PitchTracker, DEFAULT_GATE_DB } from './pitch-tracker.js';
import { DEFAULT_SMOOTHING_LEVEL } from './smoothing.js';
import { frequencyToNote, DEFAULT_A4 } from './pitch-math.js';
import { VOICE_PRESETS, describeRange } from './voice-ranges.js';
import { RangeFinder } from './range-finder.js';
import { createTunerView } from './tuner-view.js';
import { createVoiceView } from './voice-view.js';
import { createLevelMeter } from './level-meter.js';
import { createPitchGraph } from './pitch-graph.js';

// ---------- settings (a settings page comes in Phase 6) ----------

const TUNER_RANGES = {
  standard: { minHz: 50, maxHz: 1500, windowSize: 2048 },
  low: { minHz: 30, maxHz: 400, windowSize: 4096 }, // bigger window to see very slow vibrations
};

const settings = {
  a4: DEFAULT_A4,
  tuner: { range: 'standard' },
  voice: { preset: 'mid', minHz: 80, maxHz: 400, gateDb: -55, smoothingLevel: DEFAULT_SMOOTHING_LEVEL },
};

// The detection settings for the current mode.
function currentConfig() {
  if (activeTab === 'tuner') {
    return { ...TUNER_RANGES[settings.tuner.range], gateDb: DEFAULT_GATE_DB, smoothingLevel: DEFAULT_SMOOTHING_LEVEL };
  }
  const v = settings.voice;
  const range = v.preset === 'custom' ? { minHz: v.minHz, maxHz: v.maxHz } : VOICE_PRESETS[v.preset];
  return { minHz: range.minHz, maxHz: range.maxHz, windowSize: 2048, gateDb: v.gateDb, smoothingLevel: v.smoothingLevel };
}

// Readings per second: screens refresh 60–120 times a second; we cap it at
// about 60 so the smoothing behaves the same on every device.
const MIN_MS_BETWEEN_READINGS = 15;

// ---------- page elements and views ----------

const byId = (id) => document.getElementById(id);
const startPanel = byId('start-panel');
const startButton = byId('start-button');
const stopButton = byId('stop-button');
const listeningBar = byId('listening-bar');
const message = byId('message');
const tabs = { tuner: byId('tab-tuner'), voice: byId('tab-voice') };
const panels = { tuner: byId('tuner'), voice: byId('voice') };

const tunerView = createTunerView();
const levelMeter = createLevelMeter();
const graph = createPitchGraph(byId('pitch-graph'));
const rangeFinder = new RangeFinder({ a4: settings.a4 });
const voiceView = createVoiceView({
  onRangeChange({ preset, minHz, maxHz }) {
    settings.voice.preset = preset;
    if (preset === 'custom') Object.assign(settings.voice, { minHz, maxHz });
    applyConfig();
  },
  onGateChange(db) { settings.voice.gateDb = db; applyConfig(); },
  onSmoothingChange(level) { settings.voice.smoothingLevel = level; applyConfig(); },
  onResetRange() { rangeFinder.reset(); voiceView.showRange(rangeFinder, settings.a4); },
});

let activeTab = 'tuner';
let mic = null;          // the running microphone, or null
let frameRequest = null; // the id from requestAnimationFrame, so we can cancel it
let lastReading = 0;
let buffer = null;
const tracker = new PitchTracker();

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

// Apply the current mode's settings to the tracker, microphone and display.
function applyConfig() {
  const config = currentConfig();
  tracker.configure(config);
  if (mic) {
    mic.analyser.fftSize = config.windowSize; // how many samples each reading uses
    buffer = new Float32Array(config.windowSize);
    byId('tech-info').textContent =
      `Sample rate ${mic.sampleRate} Hz · window ${config.windowSize} samples ` +
      `(${((1000 * config.windowSize) / mic.sampleRate).toFixed(0)} ms) · range ${config.minHz}–${config.maxHz} Hz · A4 = ${settings.a4} Hz`;
  }
  levelMeter.setGate(config.gateDb);
  graph.setRange(config.minHz, config.maxHz, settings.a4);
  graph.clear();
  voiceView.setRangeDescription(`Searching ${describeRange(config.minHz, config.maxHz, settings.a4)}`);
}

// ---------- tabs ----------

function showTab(name) {
  activeTab = name;
  for (const key of Object.keys(tabs)) {
    tabs[key].setAttribute('aria-selected', String(key === name));
    panels[key].hidden = !mic || key !== name;
  }
  applyConfig();
}
tabs.tuner.addEventListener('click', () => showTab('tuner'));
tabs.voice.addEventListener('click', () => showTab('voice'));

document.querySelectorAll('input[name="tuner-range"]').forEach((radio) =>
  radio.addEventListener('change', () => { settings.tuner.range = radio.value; applyConfig(); }));

// ---------- start and stop ----------

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
      fftSize: currentConfig().windowSize,
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
  listeningBar.hidden = false;
  showTab(activeTab);
  frameRequest = requestAnimationFrame(tick);
});

stopButton.addEventListener('click', () => stopListening());

function stopListening() {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = null;
  if (mic) mic.stop();
  mic = null;
  tracker.reset();
  listeningBar.hidden = true;
  panels.tuner.hidden = true;
  panels.voice.hidden = true;
  startPanel.hidden = false;
  startButton.disabled = false;
  startButton.textContent = 'Start listening';
}

// ---------- the main loop ----------

function tick(now) {
  frameRequest = requestAnimationFrame(tick);
  if (now - lastReading < MIN_MS_BETWEEN_READINGS) return;
  lastReading = now;

  // 1. Copy the latest samples from the microphone, 2. run the pipeline.
  mic.analyser.getFloatTimeDomainData(buffer);
  const result = tracker.process(buffer, mic.sampleRate);
  const note = result.smoothed ? frequencyToNote(result.smoothed, settings.a4) : null;

  // 3. Show it.
  levelMeter.update(result.levelDb);
  if (activeTab === 'tuner') {
    tunerView.update({ note, reason: result.reason });
  } else {
    voiceView.update({ note, reason: result.reason, confidence: result.confidence });
    graph.add(now, result.smoothed, result.frequency);
    graph.draw(now);
    if (rangeFinder.push(result.smoothed, now)) voiceView.showRange(rangeFinder, settings.a4);
  }
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

applyConfig();
