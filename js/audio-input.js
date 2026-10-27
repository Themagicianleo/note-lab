// audio-input.js
// ------------------------------------------------------------
// Starts and stops the microphone using the Web Audio API.
//
// Privacy: the sound goes from the microphone into an AnalyserNode, which
// lets us READ the latest 2048 samples many times a second. Nothing is
// recorded, saved or sent. When you press Stop, the microphone is released.
//
// Audio path:
//   microphone → MediaStreamSource → AnalyserNode → silent GainNode → speakers
// The silent gain (volume 0) is there because some browsers only process
// audio nodes that are connected to the output. Volume 0 means you hear nothing.
// ------------------------------------------------------------

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

  const track = stream.getAudioTracks()[0];
  if (track && onEnded) track.addEventListener('ended', onEnded);

  function stop() {
    stream.getTracks().forEach((t) => t.stop()); // releases the microphone (the browser's mic icon goes away)
    source.disconnect();
    context.close();
  }

  return { context, analyser, sampleRate: context.sampleRate, track, stop };
}
