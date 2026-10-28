// spectrum-view.js
// ------------------------------------------------------------
// Draws the live spectrum on a <canvas>:
//   x axis: frequency, LOG scale from 20 Hz to 20 kHz (each octave the same width)
//   y axis: level in dBFS, −100 at the bottom to 0 at the top
// plus the EQ bands, a falling peak-hold line, the loudest peaks, and a
// readout of whatever frequency you touch or point at.
// ------------------------------------------------------------

import { EQ_BANDS, bandFor, findPeaks, PeakHold, MIN_SPECTRUM_DB } from './spectrum.js';
import { frequencyToNote } from './pitch-math.js';

const MIN_HZ = 20;
const MAX_HZ = 20000;
const TOP_DB = 0;
const BOTTOM_DB = -100;
const LEFT = 34;    // room for dB labels
const BOTTOM = 18;  // room for Hz labels
const TIME_SMOOTHING = 0.6; // 0 = no smoothing; higher = the line moves more calmly
const SHORT_BAND_NAMES = ['Sub', 'Bass', 'LowM', 'Mids', 'UpM', 'Pres', 'Brill'];

// Note names only make sense for musical pitches (piano range A0–C8).
const noteName = (hz) => {
  if (hz < 27.5 || hz > 4186) return '';
  const n = frequencyToNote(hz);
  return `${n.name}${n.octave}`;
};
// 82.4 → "82.4 Hz", 440 → "440 Hz", 999.6 → "1.00 kHz", 12345 → "12.3 kHz".
// The limits are 99.95 / 999.5 / 9995 so that rounding never shows "1000 Hz".
function hzText(hz) {
  if (hz >= 999.5) return `${(hz / 1000).toFixed(hz >= 9995 ? 1 : 2)} kHz`;
  return `${hz.toFixed(hz < 99.95 ? 1 : 0)} Hz`;
}

export function createSpectrumView({ canvas, peaksList, pointerText, freezeButton, peakHoldBox }) {
  const ctx = canvas.getContext('2d');
  const hold = new PeakHold(20);
  let current = null;     // { db, binHz } (time-smoothed)
  let held = null;        // peak-hold levels
  let peaks = [];
  let frozen = false;
  let pointerX = null;    // CSS pixels, or null when not pointing
  let size = { width: 0, height: 0 };

  // --- mapping between screen and frequency/level ---
  const maxHz = () => Math.min(MAX_HZ, current ? current.binHz * (current.db.length - 1) : MAX_HZ);
  const xOf = (hz) => LEFT + ((size.width - LEFT) * Math.log(hz / MIN_HZ)) / Math.log(maxHz() / MIN_HZ);
  const hzOf = (x) => MIN_HZ * Math.pow(maxHz() / MIN_HZ, (x - LEFT) / (size.width - LEFT));
  const yOf = (db) => ((size.height - BOTTOM) * (TOP_DB - Math.max(BOTTOM_DB, db))) / (TOP_DB - BOTTOM_DB);

  // Level at any frequency, reading between bins.
  function levelAt(levels, hz) {
    const pos = hz / current.binHz;
    const k = Math.floor(pos);
    if (k < 0 || k + 1 >= levels.length) return MIN_SPECTRUM_DB;
    return levels[k] + (levels[k + 1] - levels[k]) * (pos - k);
  }

  // Draw one spectrum as a line. Where several bins share one pixel column
  // (high frequencies), use the loudest of them so narrow peaks don't vanish.
  function tracePath(levels) {
    ctx.beginPath();
    for (let x = LEFT; x <= size.width; x++) {
      const f1 = hzOf(x);
      const f2 = hzOf(x + 1);
      let db;
      const k1 = Math.ceil(f1 / current.binHz);
      const k2 = Math.floor(f2 / current.binHz);
      if (k2 >= k1) {
        db = -Infinity;
        for (let k = k1; k <= k2 && k < levels.length; k++) db = Math.max(db, levels[k]);
      } else {
        db = levelAt(levels, f1);
      }
      if (x === LEFT) ctx.moveTo(x, yOf(db));
      else ctx.lineTo(x, yOf(db));
    }
  }

  function colours() {
    const css = getComputedStyle(document.documentElement);
    const get = (name) => css.getPropertyValue(name).trim();
    // Names from glass.css: --fg text, --line hairlines, --blue accent, --fill a soft grey wash.
    return { text: get('--fg'), muted: get('--muted'), grid: get('--line'), line: get('--blue'), bg: get('--fill'), card: 'transparent' };
  }

  function fitToScreen() {
    const ratio = window.devicePixelRatio || 1;
    size = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (canvas.width !== Math.round(size.width * ratio)) canvas.width = Math.round(size.width * ratio);
    if (canvas.height !== Math.round(size.height * ratio)) canvas.height = Math.round(size.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    fitToScreen();
    const c = colours();
    const plotBottom = size.height - BOTTOM;
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.font = '10px system-ui, sans-serif';

    // EQ bands: alternating shading, short names along the top
    EQ_BANDS.forEach((band, i) => {
      const x1 = xOf(band.from);
      const x2 = xOf(Math.min(band.to, maxHz()));
      if (x2 <= x1) return;
      ctx.fillStyle = i % 2 ? c.card : c.bg;
      ctx.fillRect(x1, 0, x2 - x1, plotBottom);
      ctx.fillStyle = c.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (x2 - x1 > 22) ctx.fillText(SHORT_BAND_NAMES[i], (x1 + x2) / 2, 3);
    });

    // Grid: dB lines every 20 dB, frequency lines at 1-2-5 steps
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let db = TOP_DB; db >= BOTTOM_DB; db -= 20) {
      const y = Math.round(yOf(db)) + 0.5;
      ctx.beginPath(); ctx.moveTo(LEFT, y); ctx.lineTo(size.width, y); ctx.stroke();
      ctx.fillText(String(db), LEFT - 4, Math.min(Math.max(y, 6), plotBottom - 4));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    let lastLabelRight = -Infinity;
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      if (hz > maxHz()) continue;
      const x = Math.round(xOf(hz)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotBottom); ctx.stroke();
      // Keep the label inside the canvas: the 20k line sits on the right edge,
      // and the chart's rounded corner would cut it off.
      const atEdge = x > size.width - 12;
      const text = hz >= 1000 ? `${hz / 1000}k` : String(hz);
      const textWidth = ctx.measureText(text).width;
      const labelX = atEdge ? size.width - 8 : x;
      const left = atEdge ? labelX - textWidth : labelX - textWidth / 2;
      if (left < lastLabelRight + 4) continue; // would overlap the previous label on a narrow screen
      ctx.textAlign = atEdge ? 'right' : 'center';
      ctx.fillText(text, labelX, size.height - 2);
      lastLabelRight = left + textWidth;
    }

    if (!current) return;

    // Peak hold (dashed)
    if (held && peakHoldBox.checked) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = c.muted;
      tracePath(held);
      ctx.stroke();
      ctx.restore();
    }

    // The live spectrum: a line with a light fill underneath
    tracePath(current.db);
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(size.width, plotBottom);
    ctx.lineTo(LEFT, plotBottom);
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = c.line;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Mark the 3 loudest peaks. Skip a label that would overlap one already drawn.
    ctx.fillStyle = c.text;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    const labelled = [];
    peaks.slice(0, 3).forEach((p) => {
      const x = xOf(p.hz);
      const y = yOf(p.db);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
      const text = hzText(p.hz);
      const halfWidth = ctx.measureText(text).width / 2 + 2;
      const overlaps = labelled.some((l) => Math.abs(l.x - x) < l.halfWidth + halfWidth && Math.abs(l.y - y) < 12);
      if (!overlaps) {
        ctx.fillText(text, x, y - 5);
        labelled.push({ x, y, halfWidth });
      }
    });

    // Pointer line and readout
    if (pointerX !== null && pointerX >= LEFT) {
      ctx.strokeStyle = c.text;
      ctx.beginPath(); ctx.moveTo(pointerX + 0.5, 0); ctx.lineTo(pointerX + 0.5, plotBottom); ctx.stroke();
      const hz = hzOf(pointerX);
      const band = bandFor(hz);
      const name = noteName(hz);
      pointerText.textContent = `${hzText(hz)}${name ? ` (near ${name})` : ''} · ${band ? band.name : 'outside the EQ bands'} · ` +
        `${levelAt(current.db, hz).toFixed(0)} dBFS here${band ? ` · ${band.hint}` : ''}`;
    }
  }

  function showPeaks() {
    peaksList.innerHTML = '';
    if (!peaks.length) {
      peaksList.innerHTML = '<li>Nothing loud enough to list.</li>';
      return;
    }
    for (const p of peaks) {
      const li = document.createElement('li');
      const name = noteName(p.hz);
      li.textContent = `${hzText(p.hz)}${name ? ` · ${name}` : ''} · ${p.db.toFixed(0)} dBFS · ${bandFor(p.hz)?.name ?? '–'}`;
      peaksList.append(li);
    }
  }

  // --- touch / mouse readout ---
  const setPointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointerX = event.clientX - rect.left;
    if (frozen) draw();
  };
  canvas.addEventListener('pointerdown', setPointer);
  canvas.addEventListener('pointermove', setPointer);
  canvas.addEventListener('pointerleave', () => { pointerX = null; pointerText.textContent = 'Touch or point at the chart to read a frequency.'; if (frozen) draw(); });

  freezeButton.addEventListener('click', () => {
    frozen = !frozen;
    freezeButton.textContent = frozen ? 'Continue' : 'Freeze';
    freezeButton.setAttribute('aria-pressed', String(frozen));
  });

  return {
    // spectrum = { db, binHz } from computeSpectrum. elapsedMs = time since the last update.
    update(spectrum, elapsedMs) {
      if (frozen) return;
      // Smooth over time so the line doesn't jitter: new = 60% old + 40% newest.
      if (current && current.db.length === spectrum.db.length) {
        for (let k = 0; k < spectrum.db.length; k++) {
          current.db[k] = TIME_SMOOTHING * current.db[k] + (1 - TIME_SMOOTHING) * spectrum.db[k];
        }
        current.binHz = spectrum.binHz;
      } else {
        current = { db: Float32Array.from(spectrum.db), binHz: spectrum.binHz };
        hold.reset();
      }
      held = hold.update(current.db, elapsedMs);
      peaks = findPeaks(current, { count: 5, minHz: MIN_HZ, maxHz: MAX_HZ, withinDb: 40, minDb: -85 });
      showPeaks();
      draw();
    },

    reset() {
      current = null;
      held = null;
      peaks = [];
      hold.reset();
      frozen = false;
      freezeButton.textContent = 'Freeze';
      freezeButton.setAttribute('aria-pressed', 'false');
    },
  };
}
