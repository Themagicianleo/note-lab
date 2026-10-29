// app.js
// ------------------------------------------------------------
// Wires the page together:
//   Start button → microphone → (about 60 times a second):
//     read samples → PitchTracker (level, volume gate, YIN, smoothing) → active view
//
// Four modes (tabs), each with its own settings:
//   Tuner    – instruments; a standard or a low range
//   Voice    – the pitch monitor (js/monitor-view.js): a scrolling pitch graph
//              on a piano keyboard, scale lines, drone, statistics, record and
//              play back, file analysis; plus the range finder and range test
//   Spectrum – no pitch detection; an FFT shows how loud each frequency is
//   Train    – ear training. Notes and intervals only PLAY sounds (no mic);
//              sing-back plays a note, then listens with the voice settings
// Plus a Settings page (reference pitch, sensitivity, voice range, …),
// saved on this device.
// ------------------------------------------------------------

import { startMicrophone, checkMicrophoneSupport, micProcessingText } from './audio-input.js';
import { PitchTracker, SENSITIVITY } from './pitch-tracker.js';
import { MelodyTracker, MELODY_DEFAULTS } from './melody.js';
import { SMOOTHING_LEVELS, DEFAULT_SMOOTHING_LEVEL } from './smoothing.js';
import { frequencyToNote } from './pitch-math.js';
import { levelDb } from './level.js';
import { pitchBand } from './filters.js';
import { computeSpectrum } from './spectrum.js';
import { VOICE_PRESETS, describeRange } from './voice-ranges.js';
import { RangeFinder, RangeTest } from './range-finder.js';
import { createTunerView } from './tuner-view.js';
import { createVoiceView } from './voice-view.js';
import { createLevelMeter } from './level-meter.js';
import { createMonitor } from './monitor-view.js';
import { createSpectrumView } from './spectrum-view.js';
import { createTonePlayer } from './tone-player.js';
import { createNoteTrainer } from './note-trainer-view.js';
import { createIntervalTrainer } from './interval-trainer-view.js';
import { createSingBack } from './singback-view.js';
import { createSettingsView } from './settings-view.js';
import { SETTINGS_KEY, DEFAULT_SETTINGS, validateSettings, voiceRange } from './settings.js';
import { loadJSON, saveJSON, removeKey } from './storage.js';
import { registerServiceWorker } from './register-sw.js';
import { savedLang, applyLang, setUpLangSwitch } from './i18n.js';
import { createLab } from './lab/lab.js';
import { createWaveformTool } from './lab/waveform-view.js';
import { createHarmonicsTool } from './lab/harmonics-view.js';
import { createBeatsTool } from './lab/beats-view.js';
import { createSpectrogramTool } from './lab/spectrogram-view.js';
import { createPipeTool } from './lab/pipe-view.js';
import { createRoomTool } from './lab/room-view.js';
import { createRt60Tool } from './lab/rt60-view.js';
import { createRealityTool } from './lab/reality-view.js';
import { createKeyTool } from './lab/key-view.js';

// ---------- settings ----------

const TUNER_RANGES = {
  standard: { minHz: 50, maxHz: 1500, windowSize: 2048 },
  low: { minHz: 30, maxHz: 400, windowSize: 4096 }, // bigger window to see very slow vibrations
};

// Spectrum: 8192 samples (~170 ms) gives bins about 6 Hz wide, enough to
// separate low notes. Fewer samples would react faster but blur the bass.
const SPECTRUM_WINDOW = 8192;

// Saved settings, checked (broken values fall back to defaults).
let settings = validateSettings(loadJSON(SETTINGS_KEY, null));
function changeSettings(changes) {
  settings = validateSettings({ ...settings, ...changes });
  saveJSON(SETTINGS_KEY, settings);
  applyConfig();
}

// The detection settings for the current mode.
function currentConfig() {
  if (activeTab === 'lab') {
    // Lab tools do their own analysis; they only tell us how many samples they need.
    return { minHz: 50, maxHz: 1500, windowSize: lab.windowSize(), gateDb: settings.tunerGateDb, smoothingLevel: DEFAULT_SMOOTHING_LEVEL };
  }
  if (activeTab === 'spectrum') {
    return { minHz: 20, maxHz: 20000, windowSize: SPECTRUM_WINDOW, gateDb: settings.tunerGateDb, smoothingLevel: DEFAULT_SMOOTHING_LEVEL };
  }
  const sensitivity = SENSITIVITY[settings.sensitivity]; // automatic threshold, YIN fallback (or not)
  if (activeTab === 'tuner') {
    return { ...TUNER_RANGES[settings.tunerRange], gateDb: settings.tunerGateDb, smoothingLevel: DEFAULT_SMOOTHING_LEVEL, ...sensitivity };
  }
  // Voice, and sing-back (which searches the range of its target notes).
  const range = activeTab === 'ear' ? VOICE_PRESETS[singBack.rangeKey()] : voiceRange(settings);
  if (activeTab === 'voice' && settings.voiceSource === 'music') {
    // Music from a speaker: the melody guess (js/melody.js) reads the raw sound, 4096 samples at a time.
    return { minHz: range.minHz, maxHz: range.maxHz, windowSize: MELODY_DEFAULTS.windowSize, gateDb: MUSIC_GATE_DB, smoothingLevel: settings.smoothingLevel, music: true };
  }
  return { minHz: range.minHz, maxHz: range.maxHz, windowSize: 2048, gateDb: settings.voiceGateDb, smoothingLevel: settings.smoothingLevel, ...sensitivity };
}

// Music mode's volume threshold: music through a speaker is loud, so a fixed one is enough.
const MUSIC_GATE_DB = -60;
// The microphone input is "clipped" (overloaded) when samples reach the top of the range.
const CLIP_LEVEL = 0.98;

// Readings per second: screens refresh 60–120 times a second; we cap it at
// about 60 so the smoothing behaves the same on every device.
const MIN_MS_BETWEEN_READINGS = 15;

// ---------- state ----------

let activeTab = 'tuner';
let settingsOpen = false;
let mic = null;          // the running microphone, or null
let frameRequest = null; // the id from requestAnimationFrame, so we can cancel it
let lastReading = 0;
let buffer = null;
const tracker = new PitchTracker();
const melody = new MelodyTracker();
let lastClip = -Infinity; // when the input was last clipped (ms)

// ---------- page elements and views ----------

const byId = (id) => document.getElementById(id);
const startPanel = byId('start-panel');
const startButton = byId('start-button');
const stopButton = byId('stop-button');
const listeningBar = byId('listening-bar');
const message = byId('message');
const tabList = byId('tabbar');
const settingsPanel = byId('settings');
const tabs = { tuner: byId('tab-tuner'), voice: byId('tab-voice'), spectrum: byId('tab-spectrum'), ear: byId('tab-ear'), lab: byId('tab-lab') };
const panels = { tuner: byId('tuner'), voice: byId('voice'), spectrum: byId('spectrum'), ear: byId('ear'), lab: byId('lab') };
// Tabs that work without the microphone (they ask for it themselves when needed).
const WORKS_WITHOUT_MIC = ['ear', 'lab', 'voice']; // voice: file analysis works without it

const tunerView = createTunerView();
const levelMeter = createLevelMeter();
const rangeFinder = new RangeFinder({ a4: settings.a4 });
let rangeTest = null; // the guided range test, while it runs
const spectrumView = createSpectrumView({
  canvas: byId('spectrum-chart'),
  peaksList: byId('spectrum-peaks'),
  pointerText: byId('spectrum-pointer'),
  freezeButton: byId('spectrum-freeze'),
  peakHoldBox: byId('spectrum-peak-hold'),
});
const voiceView = createVoiceView({
  onRangeChange({ preset, minHz, maxHz }) {
    changeSettings(preset === 'custom' ? { voicePreset: preset, voiceMinHz: minHz, voiceMaxHz: maxHz } : { voicePreset: preset });
  },
  onGateChange: (db) => changeSettings({ voiceGateDb: db }),
  onSmoothingChange: (level) => changeSettings({ smoothingLevel: level }),
  onResetRange() { rangeFinder.reset(); endRangeTest(); voiceView.showRange(rangeFinder, settings.a4); },
});

// ---------- ear training ----------
// Scores are saved on this device (never audio): see js/storage.js.
const SCORES_KEY = 'note-lab-scores-v1';
const scores = loadJSON(SCORES_KEY, {});
const saveScores = (part, value) => { scores[part] = value; saveJSON(SCORES_KEY, scores); };
const player = createTonePlayer();
const monitor = createMonitor({
  player,
  getA4: () => settings.a4,
  getMic: () => mic,
  getAnalysisConfig: () => (settings.voiceSource === 'music'
    ? { ...voiceRange(settings), windowSize: MELODY_DEFAULTS.windowSize, music: true }
    : { ...voiceRange(settings), windowSize: 2048, gateDb: settings.voiceGateDb, smoothingLevel: settings.smoothingLevel, filter: true, ...SENSITIVITY[settings.sensitivity] }),
  onReviewNote: (note) => voiceView.showReviewNote(note),
});
const trainerOptions = { player, getA4: () => settings.a4, isListening: () => Boolean(mic) };
const noteTrainer = createNoteTrainer({ ...trainerOptions, savedScores: scores.notes, onScoresChanged: (v) => saveScores('notes', v) });
const intervalTrainer = createIntervalTrainer({ ...trainerOptions, savedScores: scores.intervals, onScoresChanged: (v) => saveScores('intervals', v) });
const singBack = createSingBack({
  ...trainerOptions,
  startListening: () => startListening(),
  savedResults: scores.singback,
  onResultsChanged: (v) => saveScores('singback', v),
});
singBack.setRangeKey(settings.voicePreset); // start with the user's voice range (if it's a preset)
byId('singback-range').addEventListener('change', () => applyConfig());

const exercises = { notes: byId('ear-notes'), intervals: byId('ear-intervals'), singback: byId('ear-singback') };
let activeExercise = 'notes';
function showExercise(name) {
  activeExercise = name;
  for (const [key, panel] of Object.entries(exercises)) {
    panel.hidden = key !== name;
    byId(`ear-mode-${key}`).setAttribute('aria-pressed', String(key === name));
  }
  singBack.refresh();
}
for (const key of Object.keys(exercises)) byId(`ear-mode-${key}`).addEventListener('click', () => showExercise(key));

// ---------- acoustics lab ----------
// "Compare" buttons in the calculators open the compare page with the prediction filled in.
const realityTool = createRealityTool({ isListening: () => Boolean(mic), startListening: () => startListening() });
const compare = (entry) => { realityTool.prefill(entry); lab.open('reality'); };
const roomTool = createRoomTool({ player, getA4: () => settings.a4, onCompare: compare });
const lab = createLab({
  tools: [
    createWaveformTool({ getA4: () => settings.a4 }),
    createHarmonicsTool({ player, getA4: () => settings.a4 }),
    createBeatsTool({ player, getA4: () => settings.a4 }),
    createSpectrogramTool(),
    createPipeTool({ player, getA4: () => settings.a4, onCompare: compare }),
    roomTool,
    createRt60Tool({
      getRoom: () => roomTool.currentRoom(),
      onUseInRoom: (seconds) => { roomTool.setRT60(seconds); lab.open('room'); },
      onCompare: compare,
    }),
    realityTool,
    createKeyTool({ getA4: () => settings.a4 }),
  ],
  isListening: () => Boolean(mic),
  startListening: () => startListening(),
  onToolChange: () => showTab('lab'),
});

// ---------- settings page ----------

const settingsView = createSettingsView({
  onA4Change(a4) {
    changeSettings({ a4 });
    rangeFinder.a4 = settings.a4;
    rangeFinder.reset(); // old notes were named with the old reference
    voiceView.showRange(rangeFinder, settings.a4);
    monitor.refreshOptions();
  },
  onPlayA4: () => player.playFrequency(settings.a4, { duration: 1.5 }),
  onTunerGateChange: (db) => changeSettings({ tunerGateDb: db }),
  onSensitivityChange: (sensitivity) => changeSettings({ sensitivity }),
  onResetScores() {
    removeKey(SCORES_KEY);
    for (const key of Object.keys(scores)) delete scores[key];
    noteTrainer.reset();
    intervalTrainer.reset();
    singBack.reset();
  },
  onResetSettings() {
    settings = { ...DEFAULT_SETTINGS };
    removeKey(SETTINGS_KEY);
    showSettingsInControls();
    applyConfig();
  },
});

function showSettingsInControls() {
  settingsView.setControls(settings);
  voiceView.setControls(settings);
  document.querySelectorAll('input[name="tuner-range"]').forEach((radio) => { radio.checked = radio.value === settings.tunerRange; });
}

function openSettings() {
  settingsOpen = true;
  showTab(activeTab);
  window.scrollTo({ top: 0 });
}
function closeSettings() {
  settingsOpen = false;
  showTab(activeTab);
}
byId('open-settings').addEventListener('click', openSettings);
byId('voice-open-settings').addEventListener('click', openSettings);
byId('close-settings').addEventListener('click', closeSettings);
// Voice tab shortcut to the Lab's Key finder.
byId('voice-open-key').addEventListener('click', () => { showTab('lab'); lab.open('key'); });

// ---------- guided range test (Voice tab) ----------
const RANGE_STEPS = {
  low: 'Step 1 of 2: slide DOWN to your lowest comfortable note and hold it. Then tap Next.',
  high: 'Step 2 of 2: slide UP to your highest comfortable note and hold it. Then tap Next.',
};
function endRangeTest() {
  rangeTest = null;
  byId('range-step').hidden = true;
  byId('range-next').hidden = true;
  byId('range-test').textContent = 'Range test';
}
byId('range-test').addEventListener('click', () => {
  if (rangeTest) { endRangeTest(); return; }
  if (!mic) { startListening(); return; } // the test needs the microphone (this tap asks for it)
  rangeTest = new RangeTest({ a4: settings.a4 });
  rangeTest.start();
  byId('range-step').textContent = RANGE_STEPS.low;
  byId('range-step').hidden = false;
  byId('range-next').hidden = false;
  byId('range-test').textContent = 'Cancel test';
});
byId('range-next').addEventListener('click', () => {
  if (!rangeTest) return;
  if (rangeTest.next() === 'high') { byId('range-step').textContent = RANGE_STEPS.high; return; }
  // Done: show the test's result in the range finder boxes.
  const result = { lowest: rangeTest.lowest, highest: rangeTest.highest, semitones: rangeTest.semitones };
  endRangeTest();
  if (result.lowest === null || result.highest === null) {
    byId('voice-type').textContent = 'No held notes were heard in one of the steps. Try again, holding each note for about half a second.';
    return;
  }
  rangeFinder.lowest = result.lowest;
  rangeFinder.highest = result.highest;
  voiceView.showRange(rangeFinder, settings.a4);
});

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

// Apply the current mode's settings to the tracker, microphone and display.
function applyConfig() {
  const config = currentConfig();
  tracker.configure(config);
  melody.configure({ minHz: config.minHz, maxHz: config.maxHz, gateDb: MUSIC_GATE_DB });
  melody.reset();
  showSource();
  if (mic) {
    mic.analyser.fftSize = config.windowSize; // how many samples each reading uses
    mic.pitchAnalyser.fftSize = config.windowSize;
    mic.setBand(config.minHz, config.maxHz);   // the band filter before pitch detection
    buffer = new Float32Array(config.windowSize);
    const windowText = `Sample rate ${mic.sampleRate} Hz · window ${config.windowSize} samples ` +
      `(${((1000 * config.windowSize) / mic.sampleRate).toFixed(0)} ms)`;
    byId('tech-info').textContent = activeTab === 'spectrum'
      ? `${windowText} · each frequency bin is ${(mic.sampleRate / config.windowSize).toFixed(1)} Hz wide`
      : activeTab === 'lab' ? windowText
      : config.music ? `${windowText} · music mode (melody guess) · range ${config.minHz}–${config.maxHz} Hz · A4 = ${settings.a4} Hz`
      : `${windowText} · range ${config.minHz}–${config.maxHz} Hz · A4 = ${settings.a4} Hz · sensitivity ${settings.sensitivity}` +
        ` · band filter ${pitchBand(config.minHz, config.maxHz).highpassHz}–${pitchBand(config.minHz, config.maxHz).lowpassHz} Hz`;
  }
  spectrumView.reset();
  if (!config.autoGate) levelMeter.setGate(config.gateDb); // the automatic one is set with every reading

  // Describe the voice settings (on the Settings page and the Voice tab).
  const v = voiceRange(settings);
  const presetName = settings.voicePreset === 'custom' ? 'Custom range' : VOICE_PRESETS[settings.voicePreset].label;
  voiceView.setRangeDescription(`Searching ${describeRange(v.minHz, v.maxHz, settings.a4)}`);
  byId('voice-settings-summary').textContent =
    `${presetName}: ${describeRange(v.minHz, v.maxHz, settings.a4)} · threshold ${settings.voiceGateDb} dBFS · ` +
    `smoothing ${SMOOTHING_LEVELS[settings.smoothingLevel].label}`;
}

// ---------- tabs ----------

// The large title at the top of the page changes with the tab.
const PAGE_TITLES = {
  tuner: ['Tuner', 'Play or sing one steady note'],
  voice: ['Voice', 'Pitch monitor: your pitch over time'],
  spectrum: ['Spectrum', 'Which frequencies are loudest'],
  ear: ['Train', 'Ear training with generated tones'],
  settings: ['Settings', 'Saved on this device only'],
};
function showTitle(key) {
  const [title, subtitle] = key === 'lab' ? lab.title() : PAGE_TITLES[key];
  byId('page-title').textContent = title;
  byId('page-subtitle').textContent = subtitle;
}

// Show a tab. Every tab except Train needs the microphone to be on; the
// Train tab works without it (only sing-back asks for it).
// While the Settings page is open, it's shown instead of the tabs.
function showTab(name) {
  activeTab = name;
  for (const key of Object.keys(tabs)) {
    tabs[key].setAttribute('aria-selected', String(key === name));
    panels[key].hidden = settingsOpen || key !== name || (!mic && !WORKS_WITHOUT_MIC.includes(key));
  }
  tabList.hidden = settingsOpen;
  settingsPanel.hidden = !settingsOpen;
  // Voice shows the start card above the monitor (a file can be analysed without the mic).
  startPanel.hidden = settingsOpen || Boolean(mic) || (WORKS_WITHOUT_MIC.includes(name) && name !== 'voice');
  listeningBar.hidden = settingsOpen || !mic;
  stopButton.hidden = !mic; // the Stop button lives in the top bar
  showTitle(settingsOpen ? 'settings' : name);
  singBack.refresh();
  lab.refresh();
  if (name === 'lab' && !settingsOpen) lab.resume(); else lab.suspend(); // e.g. stop the beats tones
  if (name === 'voice' && !settingsOpen) monitor.start(); else monitor.stop(); // e.g. stop the drone
  applyConfig();
}
// Tapping a tab starts at the top of that page, like iPhone apps.
for (const name of Object.keys(tabs)) {
  tabs[name].addEventListener('click', () => { showTab(name); window.scrollTo({ top: 0 }); });
}

document.querySelectorAll('input[name="tuner-range"]').forEach((radio) =>
  radio.addEventListener('change', () => changeSettings({ tunerRange: radio.value })));

// ---------- start and stop ----------

// Warn early (before any tap) if the microphone cannot work on this page.
const problem = checkMicrophoneSupport();
if (problem) showMessage(problem.message);

startButton.addEventListener('click', () => startListening());

// Start the microphone. Must run inside a tap (Start button, or sing-back's
// "Start microphone" button), because iPhone Safari requires that.
async function startListening() {
  if (mic) return;
  showMessage('');
  startButton.disabled = true;
  startButton.textContent = 'Waiting for permission…';
  try {
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

  // What the browser says it did with our "turn off processing" requests.
  byId('mic-processing').textContent = `Microphone processing, as reported by this browser: ${micProcessingText(mic.track)}.`;
  showTab(activeTab);
  window.scrollTo({ top: 0 }); // the start card is gone; show the new page from the top
  frameRequest = requestAnimationFrame(tick);
}

stopButton.addEventListener('click', () => stopListening());

function stopListening() {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = null;
  if (mic) mic.stop();
  mic = null;
  byId('clip-warning').hidden = true;
  monitor.micStopped(); // a recording is forgotten when the microphone stops
  endRangeTest();
  tracker.reset();
  startButton.disabled = false;
  startButton.textContent = 'Start listening';
  showTab(activeTab); // hides the panels that need the microphone
}

// ---------- the main loop ----------

function tick(now) {
  frameRequest = requestAnimationFrame(tick);
  if (settingsOpen) return; // nothing to show while the Settings page is open
  if (now - lastReading < MIN_MS_BETWEEN_READINGS) return;
  const elapsed = now - lastReading;
  lastReading = now;

  // 1. Copy the latest samples from the microphone: raw for the Lab and
  //    Spectrum, band-filtered for pitch detection.
  const pitchMode = activeTab !== 'lab' && activeTab !== 'spectrum';
  const musicMode = pitchMode && tracker.options.music;
  (pitchMode && !musicMode ? mic.pitchAnalyser : mic.analyser).getFloatTimeDomainData(buffer);
  checkClipping(buffer, now);

  // Lab tools analyse the samples themselves.
  if (activeTab === 'lab') {
    levelMeter.update(levelDb(buffer.subarray(buffer.length - 2048)));
    lab.onSamples(buffer, mic.sampleRate, now);
    return;
  }

  // Spectrum mode: no pitch detection, just the FFT.
  if (activeTab === 'spectrum') {
    levelMeter.update(levelDb(buffer));
    spectrumView.update(computeSpectrum(buffer, mic.sampleRate), elapsed);
    return;
  }

  // 2. Run the pitch pipeline.
  const result = musicMode ? melodyReading(buffer) : tracker.process(buffer, mic.sampleRate, now);
  const note = result.smoothed ? frequencyToNote(result.smoothed, settings.a4) : null;

  // 3. Show it.
  levelMeter.update(result.levelDb);
  if (tracker.options.autoGate && !musicMode) levelMeter.setGate(Math.round(result.gateDb));
  if (activeTab === 'tuner') {
    tunerView.update({ note, reason: result.reason });
  } else if (activeTab === 'ear') {
    if (activeExercise === 'singback') singBack.onReading(result.smoothed, now);
  } else {
    // (The monitor draws itself; while a recording or file plays back, the
    // readout shows the playback's note instead of the live one.)
    if (!monitor.reviewing) voiceView.update({ note, reason: result.reason, confidence: result.confidence });
    monitor.addLive(now, result.smoothed, result.frequency);
    if (musicMode) return; // the range finder is for your own voice, not a song
    if (rangeTest) rangeTest.push(result.smoothed, now);
    else if (rangeFinder.push(result.smoothed, now)) voiceView.showRange(rangeFinder, settings.a4);
  }
}

// Music mode: the melody guess, in the same shape as a PitchTracker result
// (confidence null = there's no clarity measure; the display says "melody guess").
function melodyReading(samples) {
  const r = melody.process(samples, mic.sampleRate);
  return { levelDb: r.levelDb, frequency: r.frequency, smoothed: r.smoothed, confidence: null, reason: r.smoothed ? null : r.reason };
}

// Warn while the input is clipped (any sample at the top of the range),
// e.g. a device right next to a loud speaker. Stays up 1.5 s after the last clip.
function checkClipping(samples, now) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak >= CLIP_LEVEL) lastClip = now;
  byId('clip-warning').hidden = now - lastClip > 1500;
}

// ---------- Voice tab: one voice, or music from a speaker ----------
function showSource() {
  const music = settings.voiceSource === 'music';
  byId('source-single').setAttribute('aria-pressed', String(!music));
  byId('source-music').setAttribute('aria-pressed', String(music));
  byId('source-help').hidden = !music;
}
byId('source-single').addEventListener('click', () => changeSettings({ voiceSource: 'single' }));
byId('source-music').addEventListener('click', () => changeSettings({ voiceSource: 'music' }));

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

// "Reduce Transparency" (iPhone/Mac accessibility setting): solid surfaces
// instead of glass. glass.css does the rest when <html> has class "solid".
const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
const applyTransparency = () => document.documentElement.classList.toggle('solid', reduceTransparency.matches);
reduceTransparency.addEventListener?.('change', applyTransparency);
applyTransparency();

showSettingsInControls();
showTab(activeTab);
registerServiceWorker(byId('offline-status'));

// Language: English or 简体中文 (js/i18n.js). Applied last, after the page is built.
applyLang(savedLang());
setUpLangSwitch(byId('lang-switch'));
