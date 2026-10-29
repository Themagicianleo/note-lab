// monitor-graph.js
// ------------------------------------------------------------
// The pitch monitor's big graph, drawn on a <canvas>, like a piano roll:
//
//   ┌────┬────────────────────────────────────────┐
//   │ C5 │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  one row per semitone;
//   │▐   │                      ╭──╮             │  shaded rows = notes of the
//   │ A4 │ ─────────────────────╯  ╰──── ← you   │  chosen scale
//   │▐   │                                        │
//   │ C4 │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
//   └────┴────────────────────────────────────────┘
//     piano keys      time →  (right edge = now)
//
// Touch: drag to scroll (up/down = notes, left/right = time), pinch to zoom,
// tap a piano key to hear that note, double-tap the graph to go back to live.
// Desktop: mouse wheel scrolls notes, Shift+wheel scrolls time, Ctrl+wheel
// (or a trackpad pinch) zooms.
//
// The maths of zooming/scrolling is in js/monitor-window.js (tested).
// ------------------------------------------------------------

import { frequencyToNoteNumber, noteNumberToName, DEFAULT_A4 } from './pitch-math.js';
import { inScale } from './scales.js';
import { createWindow, zoomNotes, scrollNotes, zoomTime, scrollTime, follow, noteToY, yToNote, timeToX, xToTime } from './monitor-window.js';
import { prepareCanvas, themeColours } from './lab/canvas.js';

const KEYS_WIDTH = 46;   // the piano keyboard on the left
const TIME_HEIGHT = 18;  // room for time labels at the bottom
const GAP_MS = 120;      // break the line where readings are further apart than this
const TAP_MOVE_PX = 8;   // a touch that moves less than this is a tap

// One colour per note name (C red, then round the colour wheel), like
// VocalPitchMonitor's per-note colours. Lighter in dark mode.
export function noteColour(pitchClass, dark) {
  return `hsl(${pitchClass * 30}, 75%, ${dark ? 62 : 45}%)`;
}

const isBlackKey = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

// Nice steps for time labels, in seconds.
const TIME_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];

export function createMonitorGraph(canvas, { onKeyTap = () => {}, onWindowChange = () => {} } = {}) {
  let w = createWindow();
  let a4 = DEFAULT_A4;
  let pitchClasses = null; // Set of the chosen scale's pitch classes, or null
  let tonic = null;
  let colourNotes = true;
  let showRaw = false;
  let size = { width: 0, height: 0 };
  let latestRange = { oldest: 0, newest: 0 }; // the source's time span, for scrolling limits

  const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const plotW = () => size.width - KEYS_WIDTH;
  const plotH = () => size.height - TIME_HEIGHT;
  const changed = (next) => { w = next; onWindowChange(w); };

  // ---------- drawing ----------

  function drawRows(ctx, c) {
    const h = plotH();
    const rowH = h / (w.highNote - w.lowNote);
    const first = Math.ceil(w.lowNote - 0.5);
    const last = Math.floor(w.highNote + 0.5);
    for (let n = first; n <= last; n++) {
      const yTop = noteToY(w, n + 0.5, h);
      const yBottom = noteToY(w, n - 0.5, h);
      // Row background: scale notes tinted, the tonic stronger; black-key rows a little darker.
      if (pitchClasses && inScale(n, pitchClasses)) {
        ctx.fillStyle = ((n % 12) + 12) % 12 === tonic ? c.orange : c.blue;
        ctx.globalAlpha = ((n % 12) + 12) % 12 === tonic ? 0.16 : 0.08;
        ctx.fillRect(KEYS_WIDTH, yTop, plotW(), yBottom - yTop);
      } else if (isBlackKey(n)) {
        ctx.fillStyle = c.fill;
        ctx.globalAlpha = 1;
        ctx.fillRect(KEYS_WIDTH, yTop, plotW(), yBottom - yTop);
      }
      ctx.globalAlpha = 1;
      // A line through each natural note's centre, stronger on C.
      if (!isBlackKey(n) && rowH >= 4) {
        const y = Math.round(noteToY(w, n, h)) + 0.5;
        ctx.strokeStyle = c.grid;
        ctx.globalAlpha = n % 12 === 0 ? 1 : 0.5;
        ctx.lineWidth = n % 12 === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(KEYS_WIDTH, y);
        ctx.lineTo(size.width, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawKeys(ctx, c, currentNote) {
    const h = plotH();
    const rowH = h / (w.highNote - w.lowNote);
    const first = Math.ceil(w.lowNote - 0.5);
    const last = Math.floor(w.highNote + 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, KEYS_WIDTH, h);
    ctx.clip();
    // White keys first, then black keys on top (narrower), like a real keyboard.
    for (const black of [false, true]) {
      for (let n = first; n <= last; n++) {
        if (isBlackKey(n) !== black) continue;
        const yTop = noteToY(w, n + 0.5, h);
        const lit = currentNote === n;
        ctx.fillStyle = lit ? noteColour(((n % 12) + 12) % 12, dark()) : black ? (dark() ? '#111' : '#2c2c2e') : (dark() ? '#d8d8dc' : '#fff');
        ctx.fillRect(0, yTop + 0.5, black ? KEYS_WIDTH * 0.6 : KEYS_WIDTH - 2, rowH - 1);
      }
    }
    // Labels: every C, plus the scale's notes or all natural notes when there's room.
    ctx.font = `${rowH >= 13 ? 10 : 9}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let n = first; n <= last; n++) {
      const { name, octave } = noteNumberToName(n);
      const isC = name === 'C';
      const wanted = isC || (rowH >= 11 && (pitchClasses ? inScale(n, pitchClasses) : !isBlackKey(n)));
      if (!wanted || rowH < 6) continue;
      ctx.fillStyle = isBlackKey(n) ? '#fff' : '#3a3a3c';
      if (isBlackKey(n)) ctx.textAlign = 'left';
      ctx.fillText(`${name}${octave}`, isBlackKey(n) ? 2 : KEYS_WIDTH - 5, noteToY(w, n, h));
      ctx.textAlign = 'right';
    }
    ctx.restore();
    // A line between the keyboard and the graph
    ctx.fillStyle = c.grid;
    ctx.fillRect(KEYS_WIDTH - 1, 0, 1, h);
  }

  function drawLine(ctx, c, readings) {
    const h = plotH();
    const pw = plotW();
    const x = (t) => KEYS_WIDTH + timeToX(w, t, pw);
    const toN = (hz) => frequencyToNoteNumber(hz, a4);

    if (showRaw) {
      ctx.fillStyle = c.muted;
      ctx.globalAlpha = 0.45;
      for (const r of readings) if (r.raw > 0) ctx.fillRect(x(r.t) - 1, noteToY(w, toN(r.raw), h) - 1, 2, 2);
      ctx.globalAlpha = 1;
    }

    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let prev = null;
    for (const r of readings) {
      if (!(r.hz > 0)) { prev = null; continue; }
      const n = toN(r.hz);
      const point = { x: x(r.t), y: noteToY(w, n, h), t: r.t, n };
      if (prev && r.t - prev.t <= GAP_MS) {
        ctx.strokeStyle = colourNotes ? noteColour(((Math.round(n) % 12) + 12) % 12, dark()) : c.blue;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      prev = point;
    }
  }

  function drawTime(ctx, c, labelFor) {
    const h = plotH();
    const pw = plotW();
    const pxPerSec = pw / w.spanSec;
    const step = TIME_STEPS.find((s) => s * pxPerSec >= 60) || 300;
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = c.muted;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    const startT = xToTime(w, 0, pw);
    const first = Math.ceil(startT / (step * 1000)) * step * 1000;
    for (let t = first; t <= w.endT; t += step * 1000) {
      const xx = KEYS_WIDTH + timeToX(w, t, pw);
      if (xx < KEYS_WIDTH + 14 || xx > size.width - 14) continue; // don't clip at the edges
      ctx.fillRect(Math.round(xx), h, 1, 4);
      ctx.fillText(labelFor(t), xx, size.height - 3);
    }
    ctx.textAlign = 'left';
  }

  // Draw everything. `readings`: from a PitchHistory for the visible time.
  // `now`: the time at the right edge when live. Options:
  //   playhead (ms) – a vertical line (playing back a recording or file)
  //   labelFor(t)   – text for a time label
  //   currentNote   – a whole note number to light up on the keyboard
  function draw(source, now, { playhead = null, labelFor = (t) => `${Math.round((t - now) / 1000)} s`, currentNote = null } = {}) {
    const { ctx, width, height } = prepareCanvas(canvas);
    size = { width, height };
    const c = themeColours();
    latestRange = { oldest: source.first ? source.first.t : now, newest: Math.max(now, source.last ? source.last.t : now) };
    if (w.live) {
      w = { ...w, endT: now };
      // Keep the newest pitch on screen.
      const last = source.last;
      if (last && last.hz > 0 && now - last.t < 500) {
        const followed = follow(w, frequencyToNoteNumber(last.hz, a4));
        if (followed !== w) changed(followed);
      }
    }
    const readings = source.between(xToTime(w, 0, plotW()) - GAP_MS, w.endT + GAP_MS);

    ctx.save();
    ctx.beginPath();
    ctx.rect(KEYS_WIDTH, 0, plotW(), plotH());
    ctx.clip();
    drawRows(ctx, c);
    drawLine(ctx, c, readings);
    if (playhead !== null) {
      const xx = KEYS_WIDTH + timeToX(w, playhead, plotW());
      ctx.fillStyle = c.red;
      ctx.fillRect(Math.round(xx) - 1, 0, 2, plotH());
    }
    ctx.restore();
    drawKeys(ctx, c, currentNote);
    drawTime(ctx, c, labelFor);
  }

  // ---------- touch, mouse and wheel ----------

  const pointers = new Map(); // id → { x, y, startX, startY, startTime }
  let pinch = null;           // { dx, dy } at the last pinch step
  let lastTap = 0;

  const local = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const msPerPx = () => (w.spanSec * 1000) / plotW();
  const semitonesPerPx = () => (w.highNote - w.lowNote) / plotH();

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { ...p, startX: p.x, startY: p.y, startTime: performance.now() });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y) };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const old = pointers.get(e.pointerId);
    if (!old) return;
    const p = local(e);
    pointers.set(e.pointerId, { ...old, ...p });
    if (pointers.size === 2 && pinch) {
      // Pinch: horizontal spread zooms time, vertical spread zooms notes.
      const [a, b] = [...pointers.values()];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      let next = w;
      if (pinch.dx > 30 && dx > 30) next = zoomTime(next, pinch.dx / dx);
      if (pinch.dy > 30 && dy > 30) next = zoomNotes(next, pinch.dy / dy, yToNote(w, (a.y + b.y) / 2, plotH()));
      pinch = { dx, dy };
      changed(next);
    } else if (pointers.size === 1 && old.startX > KEYS_WIDTH) {
      // Drag: move the graph with the finger.
      let next = scrollNotes(w, (p.y - old.y) * semitonesPerPx());
      if (Math.abs(p.x - old.startX) > TAP_MOVE_PX) next = scrollTime(next, -(p.x - old.x) * msPerPx(), latestRange);
      changed(next);
    }
  });

  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!p) return;
    const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
    if (moved > TAP_MOVE_PX || e.type === 'pointercancel') return;
    if (p.startX <= KEYS_WIDTH) {
      onKeyTap(Math.round(yToNote(w, p.y, plotH()))); // tapped a piano key
    } else {
      const now = performance.now();
      if (now - lastTap < 350) changed({ ...w, endT: latestRange.newest, live: true }); // double-tap: back to live
      lastTap = now;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (e.ctrlKey) changed(zoomNotes(w, Math.exp(e.deltaY / 100), yToNote(w, e.clientY - rect.top, plotH())));
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) changed(scrollTime(w, (e.deltaX || e.deltaY) * msPerPx(), latestRange));
    else changed(scrollNotes(w, -e.deltaY / 40));
  }, { passive: false });

  return {
    draw,
    get window() { return w; },
    setWindow(next) { changed(next); },
    zoomNotes(factor) { changed(zoomNotes(w, factor)); },
    zoomTime(factor) { changed(zoomTime(w, factor)); },
    goLive(newest) { changed({ ...w, endT: newest, live: true }); },
    pause() { changed({ ...w, live: false }); },
    // Show a time range (ms), e.g. the start of a recording.
    showTime(endT, live = false) { changed({ ...w, endT, live }); },
    // Show the notes from low to high (whole note numbers), with a little room.
    showNotes(low, high) { changed(zoomNotes({ ...w, lowNote: low - 2, highNote: high + 2 }, 1)); },
    setOptions(options) {
      if ('a4' in options) a4 = options.a4;
      if ('pitchClasses' in options) pitchClasses = options.pitchClasses;
      if ('tonic' in options) tonic = options.tonic;
      if ('colourNotes' in options) colourNotes = options.colourNotes;
      if ('showRaw' in options) showRaw = options.showRaw;
    },
  };
}
