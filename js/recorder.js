// recorder.js
// ------------------------------------------------------------
// Optional recording on the pitch monitor, so you can listen back while
// watching your pitch line.
//
// PRIVACY: this is the only part of Note Lab that keeps microphone sound,
// and only after you tap Record. The recording:
//   • stays in this page's memory (a Blob), never on disk and never uploaded;
//   • is replaced by your next recording;
//   • is gone when you tap Delete, stop the microphone, or close the page.
// There is no "save" or "share" button on purpose.
//
// It uses the browser's MediaRecorder on the microphone stream. Formats
// differ: Safari records MP4/AAC, Chrome and Firefox record WebM/Opus.
// ------------------------------------------------------------

export const MAX_RECORDING_SECONDS = 300; // 5 minutes, like VocalPitchMonitor

// Can this browser record? (Safari 14.1+, Chrome, Firefox, Edge.)
export const canRecord = () => typeof window !== 'undefined' && typeof window.MediaRecorder === 'function';

// The first format this browser supports, or '' to let it choose.
function pickType() {
  for (const type of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Start recording `stream`. Returns { stop(): Promise<{ url, blob, seconds }> }.
// onLimit is called if MAX_RECORDING_SECONDS is reached (recording stops by itself).
export function startRecording(stream, { onLimit = () => {} } = {}) {
  const type = pickType();
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const started = performance.now();
  recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
  const finished = new Promise((resolve) => recorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/mp4' });
    // An object URL points at the Blob in memory; it is not a web address anyone else can open.
    resolve({ blob, url: URL.createObjectURL(blob), seconds: (performance.now() - started) / 1000 });
  }));
  recorder.start(1000); // hand over data every second
  const limit = setTimeout(() => { if (recorder.state !== 'inactive') { recorder.stop(); onLimit(); } }, MAX_RECORDING_SECONDS * 1000);
  return {
    started,
    get active() { return recorder.state !== 'inactive'; },
    stop() {
      clearTimeout(limit);
      if (recorder.state !== 'inactive') recorder.stop();
      return finished;
    },
  };
}

// Free the memory of a finished recording.
export function discardRecording(recording) {
  if (recording && recording.url) URL.revokeObjectURL(recording.url);
}
