// waveform-view.js
// ------------------------------------------------------------
// Lab tool 1: an oscilloscope. Draws the microphone signal (air pressure
// changes, as the mic sees them) against time, with time and height zoom.
//
// "Steady display" starts each picture at a rising zero crossing, so a
// repeating wave stays still instead of sliding across the screen.
// If a clear pitch is found, one period T is marked and f = 1/T is shown.
// ------------------------------------------------------------

import { t as tr } from '../i18n.js'; // canvas labels can't be translated by watching the page
import { findRisingCrossing, peakAmplitude, frequencyFromPeriod } from '../acoustics.js';
import { detectPitchYin } from '../yin.js';
import { levelDb, amplitudeToDb } from '../level.js';
import { frequencyToNote, formatNote } from '../pitch-math.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const SPANS_MS = [2, 5, 10, 20, 50, 100, 200];   // time across the screen
const GAINS = [1, 2, 5, 10, 20];                  // height zoom
const GATE_DB = -60;                              // quieter than this: don't look for a pitch

export function createWaveformTool({ getA4 }) {
  const el = {
    canvas: byId('wave-canvas'),
    span: byId('wave-span'),
    spanValue: byId('wave-span-value'),
    gain: byId('wave-gain'),
    gainValue: byId('wave-gain-value'),
    trigger: byId('wave-trigger'),
    freeze: byId('wave-freeze'),
    level: byId('wave-level'),
    period: byId('wave-period'),
  };
  let frozen = false;
  let last = null; // { samples, sampleRate } of the last picture, so Freeze/zoom can redraw it

  const spanMs = () => SPANS_MS[Number(el.span.value)];
  const gain = () => GAINS[Number(el.gain.value)];

  function draw() {
    if (!last) return;
    const { samples, sampleRate, pitch } = last;
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const mid = height / 2;
    const spanSamples = Math.min(samples.length - 1, Math.round((spanMs() * sampleRate) / 1000));

    // Where to start: a rising zero crossing near the newest part of the buffer.
    let start = samples.length - spanSamples - 1;
    let triggered = false;
    if (el.trigger.checked) {
      const searchFrom = Math.max(0, start - Math.round(sampleRate / 30)); // look back up to ~33 ms
      const t = findRisingCrossing(samples, searchFrom, start);
      if (t >= 0) { start = t; triggered = true; }
    }

    // Grid: centre line, ±0.5 and ±1 (relative to full scale ÷ zoom), and time ticks.
    ctx.strokeStyle = c.grid;
    ctx.fillStyle = c.muted;
    ctx.lineWidth = 1;
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const y = Math.round(mid - v * (mid - 6)) + 0.5;
      ctx.globalAlpha = v === 0 ? 1 : 0.6;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const tickMs = spanMs() / 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 1; i < 4; i++) {
      const x = Math.round((i / 4) * width) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      ctx.fillText(`${+(i * tickMs).toFixed(2)} ms`, x, height - 2);
    }
    ctx.textAlign = 'right'; // top right, clear of the period label on the left
    ctx.textBaseline = 'top';
    ctx.fillText(tr(`±${+(1 / gain()).toFixed(2)} of full scale`), width - 6, 3);

    // The wave. With many samples per pixel, draw each column's min–max range.
    const yOf = (v) => mid - Math.max(-1, Math.min(1, v * gain())) * (mid - 6);
    const perPixel = spanSamples / width;
    ctx.strokeStyle = c.blue;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let x = 0; x <= width; x++) {
      const a = start + x * perPixel;
      if (perPixel <= 1) {
        const i = Math.floor(a);
        const v = samples[i] + (samples[i + 1] - samples[i]) * (a - i); // between samples: a straight line
        if (x === 0) ctx.moveTo(x, yOf(v)); else ctx.lineTo(x, yOf(v));
      } else {
        let lo = Infinity, hi = -Infinity;
        for (let i = Math.floor(a); i < Math.floor(a + perPixel) && i < samples.length; i++) {
          lo = Math.min(lo, samples[i]); hi = Math.max(hi, samples[i]);
        }
        if (x === 0) ctx.moveTo(x, yOf(hi));
        ctx.lineTo(x, yOf(hi));
        ctx.lineTo(x, yOf(lo));
      }
    }
    ctx.stroke();

    // One period, marked from the trigger point (only makes sense when triggered).
    if (pitch && triggered) {
      const periodSamples = sampleRate / pitch;
      const x0 = 0;
      const x1 = (periodSamples / spanSamples) * width;
      if (x1 < width - 4 && x1 > 12) {
        ctx.strokeStyle = c.orange;
        ctx.fillStyle = c.orange;
        ctx.setLineDash([4, 3]);
        for (const x of [x0 + 1, x1]) { ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, height - 16); ctx.stroke(); }
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x0 + 1, 24); ctx.lineTo(x1, 24); ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`T = ${(1000 / pitch).toFixed(2)} ms`, Math.max(40, x1 / 2), 22);
      }
    }
  }

  function updateLabels() {
    el.spanValue.textContent = `${spanMs()} ms across`;
    el.gainValue.textContent = `×${gain()}`;
  }

  el.span.addEventListener('input', () => { updateLabels(); draw(); });
  el.gain.addEventListener('input', () => { updateLabels(); draw(); });
  el.trigger.addEventListener('change', draw);
  el.freeze.addEventListener('click', () => {
    frozen = !frozen;
    el.freeze.textContent = frozen ? 'Continue' : 'Freeze';
    el.freeze.setAttribute('aria-pressed', String(frozen));
  });
  updateLabels();

  return {
    id: 'waveform',
    title: 'Waveform',
    subtitle: 'Air pressure over time, like an oscilloscope',
    summary: 'See the shape of a sound wave and zoom in to single cycles.',
    needsMic: true,
    windowSize: 16384, // ≈ 0.34 s at 48 kHz: enough for the 200 ms zoom plus a trigger search
    show() { draw(); },
    hide() {},
    onSamples(buffer, sampleRate) {
      if (frozen) return;
      const samples = Float32Array.from(buffer); // our own copy, so Freeze keeps it
      const recent = samples.subarray(samples.length - 2048);
      const db = levelDb(recent);
      const pitch = db >= GATE_DB ? detectPitchYin(recent, sampleRate).frequency : null;
      last = { samples, sampleRate, pitch };
      draw();

      // Readouts. Everything here is MEASURED from the microphone.
      const peakDb = amplitudeToDb(peakAmplitude(recent));
      el.level.textContent = `Peak ${peakDb.toFixed(1)} dBFS · RMS ${db.toFixed(1)} dBFS (relative to the input's maximum, not calibrated)`;
      el.period.textContent = pitch
        ? `Period T = ${(1000 / pitch).toFixed(3)} ms → f = 1/T = ${frequencyFromPeriod(1 / pitch).toFixed(1)} Hz (${formatNote(frequencyToNote(pitch, getA4())).split(' · ')[0]})`
        : 'No clear repeating pattern (too quiet or not pitched), so no period is shown.';
    },
  };
}
