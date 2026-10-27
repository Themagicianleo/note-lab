// pitch-graph.js
// ------------------------------------------------------------
// A scrolling graph of pitch over time, drawn on a <canvas>.
//   x axis: time (newest on the right, the last `seconds` seconds)
//   y axis: pitch, with a horizontal line for every note in the range
//
// The y axis uses a LOG scale: every octave gets the same height, and so
// does every semitone. That matches how we hear pitch (A2→A3 sounds like
// the same step as A3→A4, even though it's 110 Hz vs 220 Hz).
// ------------------------------------------------------------

import { frequencyToNoteNumber, noteNumberToFrequency, noteNumberToName, DEFAULT_A4 } from './pitch-math.js';

// Pitch → y position in pixels (0 = top). minHz is at the bottom, maxHz at the top.
export function frequencyToY(frequency, minHz, maxHz, height) {
  const position = Math.log2(frequency / minHz) / Math.log2(maxHz / minHz); // 0..1
  return height * (1 - position);
}

const LEFT_MARGIN = 36;      // room for note labels
const BOTTOM_MARGIN = 16;    // room for the time label
const GAP_MS = 120;          // break the line if readings are further apart than this

export function createPitchGraph(canvas, { seconds = 8 } = {}) {
  const ctx = canvas.getContext('2d');
  let points = []; // { t, smoothed, raw }
  let range = { minHz: 100, maxHz: 800, a4: DEFAULT_A4 };

  // Make the canvas sharp on high-resolution (retina) screens.
  function fitToScreen() {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); // draw in CSS pixels
    return { width, height };
  }

  // Colours come from the CSS variables, so the graph follows light/dark mode.
  function colours() {
    const css = getComputedStyle(document.documentElement);
    const get = (name) => css.getPropertyValue(name).trim();
    return { text: get('--text'), muted: get('--muted'), grid: get('--border'), line: get('--accent'), bg: get('--meter') };
  }

  function drawGrid(c, width, plotHeight) {
    const { minHz, maxHz, a4 } = range;
    const lowNote = Math.ceil(frequencyToNoteNumber(minHz, a4));
    const highNote = Math.floor(frequencyToNoteNumber(maxHz, a4));
    const pxPerSemitone = plotHeight / (12 * Math.log2(maxHz / minHz));

    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let n = lowNote; n <= highNote; n++) {
      const { name, octave } = noteNumberToName(n);
      const isSharp = name.includes('#');
      const isC = name === 'C';
      if (isSharp && pxPerSemitone < 6) continue; // too crowded: skip sharp lines

      const y = Math.round(frequencyToY(noteNumberToFrequency(n, a4), minHz, maxHz, plotHeight)) + 0.5;
      ctx.strokeStyle = c.grid;
      ctx.globalAlpha = isC ? 1 : isSharp ? 0.35 : 0.7;
      ctx.lineWidth = isC ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(LEFT_MARGIN, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Labels: every natural note if there's room, otherwise just the Cs.
      const label = isC || (!isSharp && pxPerSemitone >= 10);
      if (label) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = isC ? c.text : c.muted;
        ctx.fillText(`${name}${octave}`, 4, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    setRange(minHz, maxHz, a4 = DEFAULT_A4) {
      range = { minHz, maxHz, a4 };
    },

    // Add a reading. smoothed/raw are Hz or null.
    add(timeMs, smoothed, raw) {
      points.push({ t: timeMs, smoothed, raw });
      const oldest = timeMs - seconds * 1000;
      while (points.length && points[0].t < oldest) points.shift();
    },

    clear() {
      points = [];
    },

    draw(nowMs) {
      const { width, height } = fitToScreen();
      const plotHeight = height - BOTTOM_MARGIN;
      const plotWidth = width - LEFT_MARGIN;
      const c = colours();
      const { minHz, maxHz } = range;
      const x = (t) => LEFT_MARGIN + plotWidth * (1 - (nowMs - t) / (seconds * 1000));
      const y = (hz) => frequencyToY(hz, minHz, maxHz, plotHeight);
      const inRange = (hz) => hz && hz >= minHz && hz <= maxHz;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = c.bg;
      ctx.fillRect(LEFT_MARGIN, 0, plotWidth, plotHeight);
      drawGrid(c, width, plotHeight);

      // Raw readings: faint dots (shows what smoothing removes)
      ctx.fillStyle = c.muted;
      ctx.globalAlpha = 0.45;
      for (const p of points) {
        if (inRange(p.raw)) ctx.fillRect(x(p.t) - 1, y(p.raw) - 1, 2, 2);
      }
      ctx.globalAlpha = 1;

      // Smoothed pitch: a line, broken wherever there was no clear pitch
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let drawing = false;
      let lastT = -Infinity;
      for (const p of points) {
        if (!inRange(p.smoothed)) { drawing = false; continue; }
        if (drawing && p.t - lastT <= GAP_MS) ctx.lineTo(x(p.t), y(p.smoothed));
        else ctx.moveTo(x(p.t), y(p.smoothed));
        drawing = true;
        lastT = p.t;
      }
      ctx.stroke();

      // Time label
      ctx.fillStyle = c.muted;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`← last ${seconds} s`, LEFT_MARGIN, height - 3);
      ctx.textAlign = 'right';
      ctx.fillText('now', width - 2, height - 3);
      ctx.textAlign = 'left';
    },
  };
}
