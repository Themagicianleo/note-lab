// monitor-window.js
// ------------------------------------------------------------
// The part of the pitch line the monitor shows: which notes (bottom to top)
// and which seconds (left to right), and how zooming and scrolling change
// that. Pure maths, tested in tests/monitor-window.test.js.
//
//   lowNote, highNote – the bottom and top edges as note numbers (decimals
//                       allowed; 60 = C4). One semitone is always the same height.
//   spanSec           – how many seconds fit across
//   endT              – the time (ms) at the right edge
//   live              – true: the right edge follows "now"
// ------------------------------------------------------------

export const NOTE_LIMITS = { low: 24, high: 108 };  // C1 … C8 (the top edge of B7)
export const SEMITONE_LIMITS = { min: 6, max: NOTE_LIMITS.high - NOTE_LIMITS.low };
export const SPAN_LIMITS = { min: 2, max: 300 };     // seconds (300 = all of the kept history)

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function createWindow({ lowNote = 43, highNote = 79, spanSec = 10 } = {}) {
  return clampWindow({ lowNote, highNote, spanSec, endT: 0, live: true });
}

// Keep the window inside the limits (and the right size).
export function clampWindow(w) {
  let semis = clamp(w.highNote - w.lowNote, SEMITONE_LIMITS.min, SEMITONE_LIMITS.max);
  let low = clamp(w.lowNote, NOTE_LIMITS.low, NOTE_LIMITS.high - semis);
  return { ...w, lowNote: low, highNote: low + semis, spanSec: clamp(w.spanSec, SPAN_LIMITS.min, SPAN_LIMITS.max) };
}

// Zoom the notes by `factor` (2 = show twice as many semitones, 0.5 = half),
// keeping `focus` (a note number) at the same height on screen.
export function zoomNotes(w, factor, focus = (w.lowNote + w.highNote) / 2) {
  const semis = clamp((w.highNote - w.lowNote) * factor, SEMITONE_LIMITS.min, SEMITONE_LIMITS.max);
  const share = (focus - w.lowNote) / (w.highNote - w.lowNote); // 0 = bottom, 1 = top
  const lowNote = focus - share * semis;
  return clampWindow({ ...w, lowNote, highNote: lowNote + semis });
}

// Scroll the notes up (+) or down (−) by some semitones.
export const scrollNotes = (w, semitones) => clampWindow({ ...w, lowNote: w.lowNote + semitones, highNote: w.highNote + semitones });

// Zoom time: 2 = twice as many seconds across. The right edge stays put.
export const zoomTime = (w, factor) => clampWindow({ ...w, spanSec: w.spanSec * factor });

// Scroll time by `ms` (− = back into the past). Can't go past the newest
// reading (then it's live again) or before the oldest (+ the window's width).
export function scrollTime(w, ms, { oldest, newest }) {
  const earliestEnd = Math.min(newest, oldest + w.spanSec * 1000);
  const endT = clamp(w.endT + ms, earliestEnd, newest);
  return { ...w, endT, live: endT >= newest };
}

// When live: if note n is outside the window (or within `margin` semitones of
// an edge), move the window just enough to show it, like VocalPitchMonitor's
// automatic scrolling.
export function follow(w, n, margin = 2) {
  if (!(Number.isFinite(n))) return w;
  if (n > w.highNote - margin) return scrollNotes(w, n - (w.highNote - margin));
  if (n < w.lowNote + margin) return scrollNotes(w, n - (w.lowNote + margin));
  return w;
}

// Screen position ↔ note number / time, for a plot `height` px tall and `width` px wide.
export const noteToY = (w, n, height) => (height * (w.highNote - n)) / (w.highNote - w.lowNote);
export const yToNote = (w, y, height) => w.highNote - (y / height) * (w.highNote - w.lowNote);
export const timeToX = (w, t, width) => width * (1 - (w.endT - t) / (w.spanSec * 1000));
export const xToTime = (w, x, width) => w.endT - (1 - x / width) * w.spanSec * 1000;
