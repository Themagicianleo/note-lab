// monitor-view.js
// ------------------------------------------------------------
// The Voice tab's pitch monitor (inspired by the VocalPitchMonitor app):
//   • a big scrolling graph on a piano keyboard (js/monitor-graph.js)
//   • pause, scroll back, zoom, full screen
//   • key and scale lines, "find the key of what I've sung"
//   • tap-a-key reference notes and a drone
//   • pitch statistics (js/pitch-stats.js)
//   • record and play back, in memory only (js/recorder.js)
//   • analyse an audio file chosen on this device (js/file-analysis.js)
//
// Two kinds of "source" can be on the graph:
//   live   – the microphone's pitch line, the last 5 minutes (js/pitch-history.js)
//   review – a recording's or a file's pitch line, with a playhead while playing
// ------------------------------------------------------------

import { frequencyToNote, frequencyToNoteNumber, noteNumberToFrequency, noteNumberToName } from './pitch-math.js';
import { PitchHistory } from './pitch-history.js';
import { createMonitorGraph } from './monitor-graph.js';
import { SCALES, scalePitchClasses, scaleForMode } from './scales.js';
import { pitchStats } from './pitch-stats.js';
import { findKey, readingFrom, SURE_GAP, PROBABLY_GAP } from './key-finder.js';
import { xToTime } from './monitor-window.js';
import { canRecord, startRecording, discardRecording, MAX_RECORDING_SECONDS } from './recorder.js';
import { analyseSamples, mixToMono, MAX_FILE_SECONDS } from './file-analysis.js';
import { loadJSON, saveJSON } from './storage.js';

const byId = (id) => document.getElementById(id);
const OPTIONS_KEY = 'note-lab-monitor-v1';
const STATS_EVERY_MS = 250;
const KEY_MIN_SECONDS = 8; // like the Key finder: fewer seconds of singing can't show a key

// "G4" for a whole note number
const noteText = (n) => { const { name, octave } = noteNumberToName(n); return `${name}${octave}`; };
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(0)}`;
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Saved options (checked; anything odd falls back to the default).
function loadOptions() {
  const o = loadJSON(OPTIONS_KEY, {}) || {};
  return {
    tonic: Number.isInteger(o.tonic) && o.tonic >= 0 && o.tonic < 12 ? o.tonic : null,
    scale: SCALES[o.scale] ? o.scale : 'major',
    colour: o.colour !== false,
    raw: o.raw === true,
    droneNote: o.droneNote === 'key' || (Number.isInteger(o.droneNote) && o.droneNote >= 0 && o.droneNote < 12) ? o.droneNote : 'key',
    droneOctave: [2, 3, 4, 5].includes(o.droneOctave) ? o.droneOctave : 3,
  };
}

export function createMonitor({ player, getA4, getMic, getAnalysisConfig, onReviewNote }) {
  const el = {
    card: byId('monitor-card'), canvas: byId('monitor-graph'), status: byId('monitor-status'),
    pause: byId('monitor-pause'), full: byId('monitor-full'), clear: byId('monitor-clear'),
    notesIn: byId('monitor-notes-in'), notesOut: byId('monitor-notes-out'), timeIn: byId('monitor-time-in'), timeOut: byId('monitor-time-out'),
    tonic: byId('monitor-tonic'), scale: byId('monitor-scale'), findKey: byId('monitor-find-key'), keyResult: byId('monitor-key-result'),
    colour: byId('monitor-colour'), raw: byId('monitor-raw'),
    droneNote: byId('drone-note'), droneOctave: byId('drone-octave'), droneToggle: byId('drone-toggle'), droneInfo: byId('drone-info'),
    statsVisible: byId('stats-visible'), statsAll: byId('stats-all'),
    stat10: byId('stat-10'), stat25: byId('stat-25'), statMean: byId('stat-mean'), statAbs: byId('stat-abs'),
    statRange: byId('stat-range'), statMost: byId('stat-most'), statTime: byId('stat-time'),
    recStart: byId('rec-start'), recStop: byId('rec-stop'), recPlay: byId('rec-play'), recDelete: byId('rec-delete'), recStatus: byId('rec-status'),
    fileInput: byId('file-input'), fileProgress: byId('file-progress'), fileStatus: byId('file-status'), filePlay: byId('file-play'), fileClose: byId('file-close'),
  };

  const options = loadOptions();
  const live = new PitchHistory();
  let review = null;       // { kind: 'recording' | 'file', history, audio, name, duration }
  let recording = null;    // the recorder while recording
  let recorded = null;     // { url, seconds, readings } after recording
  let drone = null;
  let frame = null;
  let lastStats = 0;
  let statsScope = 'visible';
  let fileJob = 0;         // increases to cancel an analysis in progress

  const graph = createMonitorGraph(el.canvas, {
    onKeyTap: (n) => player.playNote(n, { duration: 0.8 }, getA4()),
    onWindowChange: () => showStatus(),
  });

  // ---------- options: key, scale, colours ----------

  for (const [id, s] of Object.entries(SCALES)) el.scale.append(new Option(s.label, id));
  function applyOptions() {
    saveJSON(OPTIONS_KEY, options);
    el.tonic.value = options.tonic === null ? '' : String(options.tonic);
    el.scale.value = options.scale;
    el.scale.disabled = options.tonic === null;
    el.colour.checked = options.colour;
    el.raw.checked = options.raw;
    el.droneNote.value = String(options.droneNote);
    el.droneOctave.value = String(options.droneOctave);
    graph.setOptions({
      a4: getA4(),
      tonic: options.tonic,
      pitchClasses: options.tonic === null ? null : scalePitchClasses(options.tonic, options.scale),
      colourNotes: options.colour,
      showRaw: options.raw,
    });
    updateDrone();
    lastStats = 0; // recalculate the statistics against the new scale
  }
  el.tonic.addEventListener('change', () => { options.tonic = el.tonic.value === '' ? null : Number(el.tonic.value); applyOptions(); });
  el.scale.addEventListener('change', () => { options.scale = el.scale.value; applyOptions(); });
  el.colour.addEventListener('change', () => { options.colour = el.colour.checked; applyOptions(); });
  el.raw.addEventListener('change', () => { options.raw = el.raw.checked; applyOptions(); });

  // Find the key from the pitch line (live, or the recording/file on screen),
  // with the same method as the Lab's Key finder (Krumhansl–Schmuckler).
  el.findKey.addEventListener('click', () => {
    const readings = [];
    const items = source().all();
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      const next = items[i + 1];
      if (r.hz > 0 && next) readings.push(readingFrom(r.hz, Math.min(0.1, (next.t - r.t) / 1000), getA4()));
    }
    const seconds = readings.reduce((sum, r) => sum + r.weight, 0);
    if (seconds < KEY_MIN_SECONDS) {
      el.keyResult.textContent = `Only ${seconds.toFixed(0)} s of clear singing so far. Sing a few phrases (20–30 s is best) and try again.`;
      return;
    }
    const [best, second] = findKey(readings).scores;
    const gap = best.r - second.r;
    const sure = gap >= SURE_GAP ? 'clear match' : gap >= PROBABLY_GAP ? `probably; ${second.name} is fairly close` : `not sure: ${second.name} fits almost as well`;
    el.keyResult.textContent = `From ${seconds.toFixed(0)} s of singing: ${best.name} (${sure}; r = ${best.r.toFixed(2)} vs ${second.r.toFixed(2)}). Scale lines set to it.`;
    options.tonic = best.tonic;
    options.scale = scaleForMode(best.mode);
    applyOptions();
  });

  // ---------- reference drone ----------

  function droneNoteNumber() {
    const pc = options.droneNote === 'key' ? (options.tonic ?? 0) : options.droneNote;
    return 12 * (options.droneOctave + 1) + pc; // MIDI: C4 = 60 = 12 × (4 + 1)
  }
  function updateDrone() {
    const n = droneNoteNumber();
    const hz = noteNumberToFrequency(n, getA4());
    const fallback = options.droneNote === 'key' && options.tonic === null ? ' (no key chosen, so C)' : '';
    el.droneInfo.textContent = `${drone ? 'Playing' : 'Drone note'}: ${noteText(n)} = ${hz.toFixed(1)} Hz${fallback}`;
    if (drone) drone.setFrequency(hz);
  }
  function stopDrone() {
    if (drone) drone.stop();
    drone = null;
    el.droneToggle.textContent = 'Start drone';
    el.droneToggle.setAttribute('aria-pressed', 'false');
    updateDrone();
  }
  el.droneToggle.addEventListener('click', () => {
    if (drone) { stopDrone(); return; }
    drone = player.startDrone(noteNumberToFrequency(droneNoteNumber(), getA4()));
    el.droneToggle.textContent = 'Stop drone';
    el.droneToggle.setAttribute('aria-pressed', 'true');
    updateDrone();
  });
  el.droneNote.addEventListener('change', () => { options.droneNote = el.droneNote.value === 'key' ? 'key' : Number(el.droneNote.value); applyOptions(); });
  el.droneOctave.addEventListener('change', () => { options.droneOctave = Number(el.droneOctave.value); applyOptions(); });

  // ---------- toolbar ----------

  const source = () => (review ? review.history : live);

  function showStatus() {
    const w = graph.window;
    let text;
    if (review) {
      const playing = review.audio && !review.audio.paused;
      text = `${review.kind === 'file' ? `File: ${review.name}` : 'Recording'} · ${playing ? 'playing' : 'stopped'} · ${clock(review.audio ? review.audio.currentTime * 1000 : 0)} / ${clock(review.duration * 1000)}`;
      el.pause.textContent = 'Back to live';
    } else {
      text = w.live ? 'Live' : `Paused, showing ${((performance.now() - w.endT) / 1000).toFixed(0)} s ago`;
      el.pause.textContent = w.live ? 'Pause' : 'Live';
    }
    el.pause.setAttribute('aria-pressed', String(!review && !w.live));
    if (el.status.textContent !== text) el.status.textContent = text;
  }

  el.pause.addEventListener('click', () => {
    if (review) { closeReview(); return; }
    if (graph.window.live) graph.pause(); else graph.goLive(performance.now());
  });
  el.notesIn.addEventListener('click', () => graph.zoomNotes(1 / 1.5));
  el.notesOut.addEventListener('click', () => graph.zoomNotes(1.5));
  el.timeIn.addEventListener('click', () => graph.zoomTime(1 / 2));
  el.timeOut.addEventListener('click', () => graph.zoomTime(2));
  el.clear.addEventListener('click', () => { live.clear(); lastStats = 0; });

  function setFull(on) {
    el.card.classList.toggle('monitor-full', on);
    document.documentElement.classList.toggle('monitor-open', on);
    el.full.textContent = on ? 'Exit full screen' : 'Full screen';
    el.full.setAttribute('aria-pressed', String(on));
  }
  el.full.addEventListener('click', () => setFull(!el.card.classList.contains('monitor-full')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setFull(false); });

  // ---------- statistics ----------

  function setScope(scope) {
    statsScope = scope;
    el.statsVisible.setAttribute('aria-pressed', String(scope === 'visible'));
    el.statsAll.setAttribute('aria-pressed', String(scope === 'all'));
    lastStats = 0;
  }
  el.statsVisible.addEventListener('click', () => setScope('visible'));
  el.statsAll.addEventListener('click', () => setScope('all'));

  function showStats() {
    const w = graph.window;
    const all = source().all();
    const from = xToTime(w, 0, 1);
    const readings = statsScope === 'all' ? all : all.filter((r) => r.t >= from && r.t <= w.endT);
    const s = pitchStats(readings, {
      a4: getA4(),
      pitchClasses: options.tonic === null ? null : scalePitchClasses(options.tonic, options.scale),
    });
    const pct = (f) => (f === null ? '–' : `${Math.round(100 * f)}%`);
    el.stat10.textContent = pct(s.within[0].fraction);
    el.stat25.textContent = pct(s.within[1].fraction);
    el.statMean.textContent = s.meanCents === null ? '–' : `${signed(s.meanCents)} cents`;
    el.statAbs.textContent = s.meanAbsCents === null ? '–' : `${s.meanAbsCents.toFixed(0)} cents`;
    el.statRange.textContent = s.lowest === null ? '–' : `${noteText(s.lowest)} – ${noteText(s.highest)}`;
    el.statMost.textContent = s.mostSung ? `${noteText(s.mostSung.note)} (${s.mostSung.seconds.toFixed(1)} s)` : '–';
    const against = options.tonic === null ? 'the nearest note' : `the nearest note of ${el.tonic.selectedOptions[0].textContent} ${SCALES[options.scale].label.toLowerCase()}`;
    el.statTime.textContent = s.voiced
      ? `${s.voiced.toFixed(1)} s of clear pitch out of ${s.total.toFixed(1)} s, measured against ${against}.`
      : 'No clear pitch here yet.';
  }

  // ---------- review: a recording or a file ----------

  function openReview(next) {
    closeReview();
    review = next;
    const span = graph.window.spanSec * 1000;
    graph.showTime(span); // start at the left edge
    const notes = review.history.all().filter((r) => r.hz > 0).map((r) => frequencyToNoteNumber(r.hz, getA4()));
    if (notes.length) graph.showNotes(Math.floor(Math.min(...notes)), Math.ceil(Math.max(...notes)));
    if (review.audio) review.audio.addEventListener('ended', () => { updateButtons(); showStatus(); });
    onReviewNote(null);
    lastStats = 0;
    updateButtons();
  }

  function closeReview() {
    if (!review) return;
    if (review.audio) review.audio.pause();
    if (review.kind === 'file') URL.revokeObjectURL(review.audio.src);
    review = null;
    graph.goLive(performance.now());
    lastStats = 0;
    updateButtons();
  }

  function togglePlay() {
    if (!review || !review.audio) return;
    if (review.audio.paused) {
      if (review.audio.ended || review.audio.currentTime >= review.duration - 0.05) review.audio.currentTime = 0;
      review.audio.play().catch(() => {});
    } else {
      review.audio.pause();
    }
    setTimeout(updateButtons, 50);
  }

  function updateButtons() {
    const playingRec = review && review.kind === 'recording' && !review.audio.paused;
    const playingFile = review && review.kind === 'file' && !review.audio.paused;
    el.recStart.disabled = Boolean(recording) || !canRecord();
    el.recStop.disabled = !recording;
    el.recPlay.disabled = !recorded || Boolean(recording);
    el.recPlay.textContent = playingRec ? 'Pause' : 'Play';
    el.recDelete.disabled = !recorded || Boolean(recording);
    el.filePlay.hidden = !(review && review.kind === 'file');
    el.fileClose.hidden = !(review && review.kind === 'file');
    el.filePlay.textContent = playingFile ? 'Pause' : 'Play';
  }

  // ---------- recording (memory only) ----------

  if (!canRecord()) el.recStatus.textContent = "This browser can't record audio (MediaRecorder is missing). Everything else works.";

  el.recStart.addEventListener('click', () => {
    const mic = getMic();
    if (!mic) { el.recStatus.textContent = 'Start the microphone first (the button at the top of this page).'; return; }
    deleteRecording();
    closeReview();
    try {
      recording = startRecording(mic.stream, { onLimit: () => finishRecording('Stopped at the 5-minute limit.') });
    } catch (error) {
      el.recStatus.textContent = `Recording couldn't start: ${error.message}`;
      recording = null;
    }
    updateButtons();
  });

  async function finishRecording(note = '') {
    if (!recording) return;
    const rec = recording;
    const end = performance.now();
    const result = await rec.stop();
    recording = null;
    // The pitch line of the same moments, with times from the start of the recording.
    const readings = live.between(rec.started, end).filter((r) => r.t >= rec.started && r.t <= end).map((r) => ({ ...r, t: r.t - rec.started }));
    recorded = { ...result, readings };
    el.recStatus.textContent = `${note} Recorded ${clock(result.seconds * 1000)} (in memory only). Tap Play to listen and watch the pitch line.`.trim();
    updateButtons();
  }
  el.recStop.addEventListener('click', () => finishRecording());

  el.recPlay.addEventListener('click', () => {
    if (!recorded) return;
    if (!review || review.kind !== 'recording') {
      openReview({ kind: 'recording', history: PitchHistory.from(recorded.readings), audio: new Audio(recorded.url), duration: recorded.seconds });
    }
    togglePlay();
  });

  function deleteRecording() {
    if (review && review.kind === 'recording') closeReview();
    discardRecording(recorded);
    recorded = null;
    el.recStatus.textContent = 'No recording. Up to 5 minutes; kept in memory only.';
    updateButtons();
  }
  el.recDelete.addEventListener('click', deleteRecording);

  // ---------- analyse a file ----------

  el.fileInput.addEventListener('change', async () => {
    const file = el.fileInput.files[0];
    el.fileInput.value = ''; // so choosing the same file again works
    if (!file) return;
    const job = ++fileJob;
    const bar = el.fileProgress.parentElement;
    el.fileStatus.textContent = `Reading ${file.name}…`;
    bar.hidden = false;
    el.fileProgress.style.width = '0%';
    try {
      const context = player.ensureContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration > MAX_FILE_SECONDS) throw new Error(`it's ${clock(decoded.duration * 1000)} long; the limit is ${MAX_FILE_SECONDS / 60} minutes`);
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
      el.fileStatus.textContent = `Finding the pitch in ${clock(decoded.duration * 1000)} of sound…`;
      const readings = await analyseSamples(mixToMono(channels), decoded.sampleRate, getAnalysisConfig(), {
        onProgress: (p) => { el.fileProgress.style.width = `${Math.round(100 * p)}%`; },
        shouldStop: () => job !== fileJob,
      });
      if (!readings || job !== fileJob) return;
      const voiced = readings.filter((r) => r.hz > 0).length / Math.max(1, readings.length);
      el.fileStatus.textContent = `${file.name}: ${clock(decoded.duration * 1000)}, clear pitch ${Math.round(100 * voiced)}% of the time. ` +
        (voiced < 0.3 ? 'Mostly no clear pitch: is it chords, a band, or very quiet? See Limitations. ' : '') + 'Analysed on this device; nothing uploaded.';
      openReview({ kind: 'file', name: file.name, history: PitchHistory.from(readings), audio: new Audio(URL.createObjectURL(file)), duration: decoded.duration });
    } catch (error) {
      el.fileStatus.textContent = `Couldn't read that file (${error && error.message ? error.message : 'unknown error'}). Try an MP3, M4A or WAV file.`;
    } finally {
      bar.hidden = true;
    }
  });
  el.filePlay.addEventListener('click', togglePlay);
  el.fileClose.addEventListener('click', closeReview);

  // ---------- drawing loop ----------

  function loop() {
    frame = requestAnimationFrame(loop);
    const now = performance.now();
    if (recording) el.recStatus.textContent = `Recording… ${clock(now - recording.started)} of ${MAX_RECORDING_SECONDS / 60}:00 max (in memory only)`;
    if (review) {
      const t = review.audio ? review.audio.currentTime * 1000 : 0;
      const playing = review.audio && !review.audio.paused;
      if (playing) graph.showTime(Math.max(t + 0.25 * graph.window.spanSec * 1000, graph.window.spanSec * 1000)); // keep the playhead at 3/4 of the width
      const end = Math.max(review.duration * 1000, review.history.last ? review.history.last.t : 0);
      const at = review.history.between(t, t)[0];
      const n = at && at.hz > 0 && Math.abs(at.t - t) < 200 ? frequencyToNoteNumber(at.hz, getA4()) : null;
      graph.draw(review.history, end, { playhead: t, labelFor: clock, currentNote: n === null ? null : Math.round(n) });
      if (playing) onReviewNote(n === null ? null : frequencyToNote(at.hz, getA4()));
    } else {
      const last = live.last;
      const n = last && last.hz > 0 && now - last.t < 200 ? Math.round(frequencyToNoteNumber(last.hz, getA4())) : null;
      graph.draw(live, now, { labelFor: (t) => (Math.abs(t - now) < 50 ? 'now' : `${((t - now) / 1000).toFixed(0)} s`), currentNote: graph.window.live ? n : null });
    }
    showStatus();
    if (now - lastStats > STATS_EVERY_MS) { lastStats = now; showStats(); }
  }

  applyOptions();
  updateButtons();

  return {
    // A live reading from the microphone (ignored while reviewing, so a
    // recording playing through the speaker doesn't end up in your live line).
    addLive(now, smoothed, raw) {
      if (!review) live.add(now, smoothed, raw);
    },
    get reviewing() { return Boolean(review); },
    // The tab is shown: start drawing.
    start() {
      if (!frame) frame = requestAnimationFrame(loop);
    },
    // The tab is hidden: stop drawing, the drone and any playback.
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      stopDrone();
      if (review && review.audio) review.audio.pause();
      setFull(false);
      updateButtons();
    },
    // The microphone was stopped: end and forget any recording (privacy promise).
    micStopped() {
      if (recording) { recording.stop().then(discardRecording); recording = null; }
      deleteRecording();
    },
    refreshOptions: applyOptions, // e.g. after A4 changed
  };
}
