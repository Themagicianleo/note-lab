// spectrogram-view.js
// ------------------------------------------------------------
// Lab tool 4: spectrogram. Each new reading (~60 a second) becomes one thin
// column: an FFT of the latest N samples, coloured by level. Columns scroll
// left, so you see frequency (up) against time (across).
//
// The window size N sets the time–frequency trade-off (see acoustics.js):
// Δt = N/fs, Δf = fs/N. Because a new column arrives every ~17 ms while each
// one analyses N/fs seconds, long windows overlap a lot: sounds smear
// sideways (in time) but are sharp up and down (in frequency).
// ------------------------------------------------------------

import { t as tr } from '../i18n.js'; // canvas labels can't be translated by watching the page
import { stftResolution } from '../acoustics.js';
import { computeSpectrum } from '../spectrum.js';
import { dbToColour } from './colour-map.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const WINDOW_SIZES = [512, 1024, 2048, 4096, 8192];
const MIN_DB = -100;   // colour scale (dBFS, relative)
const MAX_DB = -10;    // (−20 made loud singing near the mic saturate to one colour)
const LEFT = 40;       // room for frequency labels
const BOTTOM = 16;     // room for the time label

export function createSpectrogramTool() {
  const el = {
    canvas: byId('sgram-canvas'), legend: byId('sgram-legend'),
    window: byId('sgram-window'), windowValue: byId('sgram-window-value'),
    scale: byId('sgram-scale'), maxHz: byId('sgram-max'),
    freeze: byId('sgram-freeze'), resolution: byId('sgram-resolution'),
  };
  let history = null;       // off-screen canvas holding the scrolling picture (device pixels)
  let frozen = false;
  let sampleRate = 48000;
  let lastTime = 0;
  let columnMs = 1000 / 60; // measured time between columns
  let tool = null;          // this tool (returned below); the Lab sets tool.onWindowChange

  const windowSize = () => WINDOW_SIZES[Number(el.window.value)];
  const logScale = () => el.scale.value === 'log';
  const topHz = () => Math.min(Number(el.maxHz.value), sampleRate / 2);
  const bottomHz = () => (logScale() ? 50 : 0);

  // Row y (0 = top of the plot) ↔ frequency, for the chosen scale.
  function hzAtRow(y, plotH) {
    const p = 1 - y / plotH; // 0 at the bottom, 1 at the top
    return logScale() ? bottomHz() * Math.pow(topHz() / bottomHz(), p) : topHz() * p;
  }

  function ensureHistory(width, height, ratio) {
    const w = Math.round((width - LEFT) * ratio);
    const h = Math.round((height - BOTTOM) * ratio);
    if (!history || history.width !== w || history.height !== h) {
      history = document.createElement('canvas');
      history.width = w; history.height = h;
      const hctx = history.getContext('2d');
      hctx.fillStyle = `rgb(${dbToColour(MIN_DB, MIN_DB, MAX_DB).join(',')})`;
      hctx.fillRect(0, 0, w, h);
    }
    return history;
  }

  // Add one column (the newest spectrum) at the right edge.
  function addColumn(spectrum) {
    const ratio = window.devicePixelRatio || 1;
    const width = el.canvas.clientWidth;
    const height = el.canvas.clientHeight;
    const hist = ensureHistory(width, height, ratio);
    const hctx = hist.getContext('2d');
    const step = Math.max(1, Math.round(ratio)); // column width in device pixels
    hctx.drawImage(hist, -step, 0);              // scroll everything left
    const column = hctx.createImageData(step, hist.height);
    const { db, binHz } = spectrum;
    for (let y = 0; y < hist.height; y++) {
      // The frequencies this pixel row covers.
      const fHigh = hzAtRow(y, hist.height);
      const fLow = hzAtRow(y + 1, hist.height);
      const k1 = Math.ceil(fLow / binHz);
      const k2 = Math.floor(fHigh / binHz);
      let level = MIN_DB;
      if (k2 - k1 >= 1) {
        // Several bins inside this row (high frequencies): show the loudest,
        // so narrow peaks don't disappear.
        for (let k = Math.max(1, k1); k <= Math.min(db.length - 1, k2); k++) level = Math.max(level, db[k]);
      } else {
        // The row is narrower than a bin: read the level between bins at the
        // row's centre frequency, so peaks appear where they really are.
        const pos = (fLow + fHigh) / 2 / binHz;
        const k = Math.floor(pos);
        if (k >= 1 && k + 1 < db.length) level = db[k] + (db[k + 1] - db[k]) * (pos - k);
      }
      const [r, g, b] = dbToColour(level, MIN_DB, MAX_DB);
      for (let x = 0; x < step; x++) {
        const i = (y * step + x) * 4;
        column.data[i] = r; column.data[i + 1] = g; column.data[i + 2] = b; column.data[i + 3] = 255;
      }
    }
    hctx.putImageData(column, hist.width - step, 0);
  }

  function draw() {
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const plotH = height - BOTTOM;
    // The plot area is "silence" colour until columns arrive; labels sit on the card.
    ctx.fillStyle = `rgb(${dbToColour(MIN_DB, MIN_DB, MAX_DB).join(',')})`;
    ctx.fillRect(LEFT, 0, width - LEFT, plotH);
    if (history) ctx.drawImage(history, LEFT, 0, width - LEFT, plotH);

    // Frequency labels
    ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const marks = logScale() ? [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] : [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((k) => k * 1000);
    let lastY = Infinity;
    for (const hz of marks) {
      if (hz < bottomHz() || hz > topHz()) continue;
      const p = logScale() ? Math.log(hz / bottomHz()) / Math.log(topHz() / bottomHz()) : hz / topHz();
      const y = plotH * (1 - p);
      if (lastY - y < 14) continue; // don't crowd the labels
      lastY = y;
      ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), LEFT - 4, Math.min(plotH - 6, Math.max(6, y)));
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(LEFT - 2, y); ctx.lineTo(LEFT, y); ctx.stroke();
    }
    // Time label: how much time the picture covers, from the measured column rate.
    const seconds = (((width - LEFT) * 1) * columnMs) / 1000;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText(`← about ${seconds.toFixed(1)} s`, LEFT, height - 2);
    ctx.textAlign = 'right'; ctx.fillText(tr('now'), width - 8, height - 2);
  }

  function showResolution() {
    const n = windowSize();
    const { windowSeconds, binHz } = stftResolution(n, sampleRate);
    el.windowValue.textContent = `${n} samples`;
    el.resolution.textContent =
      `At ${sampleRate} Hz: each column covers Δt = ${n}/${sampleRate} = ${(windowSeconds * 1000).toFixed(1)} ms, ` +
      `with frequency steps Δf = ${sampleRate}/${n} = ${binHz.toFixed(1)} Hz. Δt × Δf = ${(windowSeconds * binHz).toFixed(2)}.`;
  }

  function drawLegend() {
    const { ctx, width, height } = prepareCanvas(el.legend);
    const c = themeColours();
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = `rgb(${dbToColour(MIN_DB + ((MAX_DB - MIN_DB) * x) / width, MIN_DB, MAX_DB).join(',')})`;
      ctx.fillRect(x, 0, 1, height - 14);
    }
    ctx.fillStyle = c.muted; ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText(tr(`${MIN_DB} dBFS (quiet)`), 0, height);
    ctx.textAlign = 'right'; ctx.fillText(tr(`${MAX_DB} dBFS (loud)`), width, height);
  }

  const restart = () => { history = null; showResolution(); draw(); };
  el.window.addEventListener('input', () => { restart(); tool.onWindowChange?.(); });
  el.scale.addEventListener('change', restart);
  el.maxHz.addEventListener('change', restart);
  el.freeze.addEventListener('click', () => {
    frozen = !frozen;
    el.freeze.textContent = frozen ? 'Continue' : 'Freeze';
    el.freeze.setAttribute('aria-pressed', String(frozen));
  });

  // A real getter (not Object.assign, which would copy the value only once).
  tool = {
    onWindowChange: null,
    id: 'spectrogram',
    title: 'Spectrogram',
    subtitle: 'Frequency against time, as colours',
    summary: 'Watch frequencies change over time; explore the time vs frequency trade-off.',
    needsMic: true,
    get windowSize() { return windowSize(); },
    show() { showResolution(); drawLegend(); draw(); },
    hide() {},
    onSamples(buffer, rate, now) {
      if (frozen) return;
      if (rate !== sampleRate) { sampleRate = rate; restart(); }
      if (lastTime) columnMs = 0.9 * columnMs + 0.1 * (now - lastTime); // smoothed column interval
      lastTime = now;
      const n = windowSize();
      if (buffer.length < n) return; // the new window size hasn't reached the microphone yet
      addColumn(computeSpectrum(buffer.subarray(buffer.length - n), rate));
      draw();
    },
  };
  return tool;
}
