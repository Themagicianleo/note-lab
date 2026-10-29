// audio-input.js
// ------------------------------------------------------------
// Starts and stops the microphone using the Web Audio API.
//
// Privacy: the sound goes from the microphone into an AnalyserNode, which
// lets us READ the latest 2048 samples many times a second. Nothing is
// saved or sent. Nothing is recorded either, unless you tap Record on the
// Voice tab: that recording stays in this page's memory only (js/recorder.js).
// When you press Stop, the microphone is released.
//
// Audio path:
//   microphone → MediaStreamSource ─┬→ AnalyserNode (raw: spectrum, Lab) ─────────────┬→ silent GainNode → speakers
//                                   └→ high-pass → low-pass → AnalyserNode (pitch) ───┘
// The high-pass and low-pass filters keep only the band the pitch is searched
// in (js/filters.js explains why and how), so a quiet voice stands out more
// from the microphone's hiss. Spectrum and Lab tools read the raw sound.
// The silent gain (volume 0) is there because some browsers only process
// audio nodes that are connected to the output. Volume 0 means you hear nothing.
// ------------------------------------------------------------

import { BUTTERWORTH_Q, pitchBand } from './filters.js';

// An error with a friendly message we can show on the page.
export class MicrophoneError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'insecure' | 'unsupported' | 'denied' | 'no-microphone' | 'busy' | 'unknown'
  }
}

// Check BEFORE asking for permission whether the microphone can work here at all.
// Returns a MicrophoneError, or null if everything looks fine.
export function checkMicrophoneSupport() {
  if (!window.isSecureContext) {
    return new MicrophoneError('insecure',
      'The microphone only works on a secure page (an address starting with https://, or localhost).');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return new MicrophoneError('unsupported', "This browser can't use the microphone. Try a recent Safari, Chrome, Firefox or Edge.");
  }
  if (!window.AudioContext && !window.webkitAudioContext) {
    return new MicrophoneError('unsupported', "This browser doesn't support the Web Audio API.");
  }
  return null;
}

// Turn the browser's error into one of our friendly messages.
function explainError(error) {
  switch (error && error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new MicrophoneError('denied',
        'Microphone access was blocked, so Note Lab cannot hear anything. ' +
        'To allow it: on iPhone, tap "aA" in the Safari address bar → Website Settings → Microphone → Allow. ' +
        'On a computer, click the icon at the left of the address bar and allow the microphone. Then tap Start again.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new MicrophoneError('no-microphone',
        'No microphone was found. Connect one (or check your device has one) and tap Start again.');
    case 'NotReadableError':
    case 'AbortError':
      return new MicrophoneError('busy',
        "The microphone couldn't be started. Another app (a call, a voice recorder) may be using it. Close it and tap Start again.");
    default:
      return new MicrophoneError('unknown', `The microphone couldn't be started (${error && error.message ? error.message : 'unknown error'}).`);
  }
}

// Start the microphone. MUST be called directly from a button tap:
// iPhone Safari only allows audio to start in response to a tap.
//
// Returns { context, analyser, sampleRate, stop }.
// onEnded is called if the microphone stops by itself (unplugged, taken by another app).
export async function startMicrophone({ fftSize = 2048, onEnded } = {}) {
  const problem = checkMicrophoneSupport();
  if (problem) throw problem;

  // Create the AudioContext straight away, before any "await", so it still
  // counts as part of the tap. (On iPhone, a context created later may stay silent.)
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const resuming = context.resume();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Ask the device NOT to "clean up" the sound. These filters are made for
        // phone calls and can change the pitch and loudness we measure.
        // Browsers may ignore these requests (iPhone often does).
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (error) {
    context.close();
    throw explainError(error);
  }
  await resuming;

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = fftSize; // how many samples we can read at once
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silent);
  silent.connect(context.destination);

  // The pitch path, through the band filter.
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  lowpass.type = 'lowpass';
  // Web Audio takes Q in dB for these filter types: 20·log10(1/√2) = −3.01 dB = Butterworth.
  highpass.Q.value = 20 * Math.log10(BUTTERWORTH_Q);
  lowpass.Q.value = 20 * Math.log10(BUTTERWORTH_Q);
  const pitchAnalyser = context.createAnalyser();
  pitchAnalyser.fftSize = fftSize;
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(pitchAnalyser);
  pitchAnalyser.connect(silent);
  // Set the band for a search range (minHz–maxHz).
  function setBand(minHz, maxHz) {
    const band = pitchBand(minHz, maxHz);
    highpass.frequency.value = band.highpassHz;
    lowpass.frequency.value = Math.min(band.lowpassHz, context.sampleRate / 2 - 100);
  }
  setBand(50, 1500);

  const track = stream.getAudioTracks()[0];
  if (track && onEnded) track.addEventListener('ended', onEnded);

  function stop() {
    stream.getTracks().forEach((t) => t.stop()); // releases the microphone (the browser's mic icon goes away)
    source.disconnect();
    context.close();
  }

  // `stream` is also returned for the pitch monitor's optional recorder
  // (js/recorder.js), which keeps a recording in memory only when you tap Record.
  return { context, analyser, pitchAnalyser, setBand, sampleRate: context.sampleRate, track, stream, stop };
}

// What the browser says it actually did with our "please turn off" requests.
// `settings` is track.getSettings(). Each feature is reported as:
//   'off'          – the browser confirms it's off (what we asked for)
//   'on'           – the browser kept it on anyway
//   'not reported' – the browser doesn't say (common on older Safari)
// Caution: this is the browser's own report. A phone can still process the
// sound in its hardware or operating system without the browser knowing.
export const PROCESSING_FEATURES = [
  { key: 'echoCancellation', label: 'Echo cancellation' },
  { key: 'noiseSuppression', label: 'Noise suppression' },
  { key: 'autoGainControl', label: 'Automatic gain control' },
];

export function describeMicProcessing(settings = {}) {
  return PROCESSING_FEATURES.map(({ key, label }) => {
    const value = settings[key];
    const state = value === false ? 'off' : value === true ? 'on' : 'not reported';
    return { key, label, state };
  });
}

// One line for the page, e.g. "Echo cancellation: off · Noise suppression: on · …"
export function micProcessingText(track) {
  const settings = track && track.getSettings ? track.getSettings() : {};
  return describeMicProcessing(settings).map((f) => `${f.label}: ${f.state}`).join(' · ');
}
