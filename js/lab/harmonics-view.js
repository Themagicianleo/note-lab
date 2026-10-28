// harmonics-view.js
// ------------------------------------------------------------
// Lab tool 2: harmonics viewer.
//   Live (measured): find the fundamental f₀ with YIN, then measure the level
//   of each harmonic n·f₀ in the spectrum. Bars are dB relative to the
//   loudest harmonic (0 dB = loudest).
//   Compare: capture A and B (e.g. your voice, and a tone). B can also be a
//   CALCULATED reference (Fourier series of a sine, square, sawtooth, or the
//   app's own tone), which you can play and also measure with the mic.
// ------------------------------------------------------------

import { measureHarmonics, relativeToLoudest, referenceHarmonics, REFERENCE_TONES } from '../acoustics.js';
import { computeSpectrum } from '../spectrum.js';
import { detectPitchYin } from '../yin.js';
import { levelDb } from '../level.js';
import { frequencyToNote } from '../pitch-math.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const COUNT = 10;          // harmonics shown
const BOTTOM_DB = -60;     // bottom of the chart
const GATE_DB = -60;
const TABLE_EVERY_MS = 150; // update the numbers ~7 times a second so they're readable

const noteName = (hz, a4) => {
  if (hz < 27.5 || hz > 4186) return '';
  const n = frequencyToNote(hz, a4);
  return `${n.name}${n.octave}`;
};

export function createHarmonicsTool({ player, getA4 }) {
  const el = {
    canvas: byId('harm-canvas'),
    f0: byId('harm-f0'),
    table: byId('harm-table'),
    labelA: byId('harm-label-a'),
    labelB: byId('harm-label-b'),
    captureA: byId('harm-capture-a'),
    captureB: byId('harm-capture-b'),
    ref: byId('harm-ref'),
    useRef: byId('harm-use-ref'),
    playRef: byId('harm-play-ref'),
    clear: byId('harm-clear'),
    message: byId('harm-message'),
    compare: byId('harm-compare'),
  };
  let live = null;   // { f0, harmonics } from the microphone, or null
  let A = null;      // snapshots: { label, f0, harmonics, kind: 'measured' | 'calculated' }
  let B = null;
  let lastTable = 0;

  // Reference tones (calculated). Fill the drop-down from acoustics.js.
  for (const [key, ref] of Object.entries(REFERENCE_TONES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = ref.label;
    el.ref.append(option);
  }
  const referenceF0 = () => (A && A.f0) || (live && live.f0) || 220;

  function draw() {
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const left = 34, bottom = 22, top = 8;
    const plotH = height - bottom - top;
    const groupW = (width - left) / COUNT;
    const yOf = (db) => top + plotH * (Math.min(0, Math.max(BOTTOM_DB, db)) / BOTTOM_DB);

    // dB grid
    ctx.strokeStyle = c.grid; ctx.fillStyle = c.muted; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let db = 0; db >= BOTTOM_DB; db -= 20) {
      const y = Math.round(yOf(db)) + 0.5;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillText(`${db}`, left - 4, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let n = 1; n <= COUNT; n++) ctx.fillText(n === 1 ? '1 (f₀)' : String(n), left + (n - 0.5) * groupW, height - 4);

    // Series: live (light), A (blue), B (orange)
    const series = [
      live && { data: live.harmonics, colour: c.muted, alpha: 0.45 },
      A && { data: A.harmonics, colour: c.blue, alpha: 1 },
      B && { data: B.harmonics, colour: c.orange, alpha: 1 },
    ].filter(Boolean);
    const barW = Math.max(3, (groupW - 6) / Math.max(1, series.length));
    series.forEach((s, i) => {
      ctx.fillStyle = s.colour;
      ctx.globalAlpha = s.alpha;
      s.data.forEach((h) => {
        const x = left + (h.n - 1) * groupW + 3 + i * barW;
        if (h.relDb === null) {
          // not found: a small mark on the floor
          ctx.fillRect(x + barW / 2 - 1, yOf(BOTTOM_DB) - 3, 2, 3);
        } else {
          const y = yOf(h.relDb);
          ctx.fillRect(x, y, barW - 1, yOf(BOTTOM_DB) - y);
        }
      });
    });
    ctx.globalAlpha = 1;
  }

  // The detailed numbers for the live sound (all measured).
  function showTable() {
    if (!live) {
      el.f0.textContent = 'No clear pitch. Sing or play one steady note.';
      el.table.innerHTML = '';
      return;
    }
    const a4 = getA4();
    el.f0.textContent = `Fundamental f₀ = ${live.f0.toFixed(1)} Hz (${noteName(live.f0, a4)})`;
    el.table.innerHTML =
      '<thead><tr><th scope="col">n</th><th scope="col">n·f₀</th><th scope="col">Found</th><th scope="col">Cents</th><th scope="col">Level</th></tr></thead><tbody>' +
      live.harmonics.map((h) => h.found
        ? `<tr><th scope="row">${h.n}</th><td>${h.expectedHz.toFixed(0)} Hz</td><td>${h.hz.toFixed(1)} Hz ${noteName(h.hz, a4)}</td><td>${h.centsOff >= 0 ? '+' : ''}${h.centsOff.toFixed(0)}</td><td>${h.relDb.toFixed(1)} dB</td></tr>`
        : `<tr><th scope="row">${h.n}</th><td>${h.expectedHz.toFixed(0)} Hz</td><td colspan="3" class="muted">not found (below the noise)</td></tr>`).join('') +
      '</tbody>';
  }

  // A / B comparison, in words and numbers.
  function showCompare() {
    if (!A && !B) { el.compare.innerHTML = ''; return; }
    const head = (s, name) => (s ? `${name}: ${s.label} · f₀ ${s.f0.toFixed(1)} Hz · ${s.kind}` : `${name}: –`);
    const rows = [];
    for (let n = 1; n <= COUNT; n++) {
      const a = A && A.harmonics[n - 1].relDb;
      const b = B && B.harmonics[n - 1].relDb;
      const fmt = (v) => (v === null || v === undefined ? '–' : `${v.toFixed(1)} dB`);
      const diff = a !== null && a !== undefined && b !== null && b !== undefined ? `${(a - b) >= 0 ? '+' : ''}${(a - b).toFixed(1)} dB` : '';
      rows.push(`<tr><th scope="row">${n}</th><td>${fmt(a)}</td><td>${fmt(b)}</td><td>${diff}</td></tr>`);
    }
    el.compare.innerHTML =
      `<caption class="small">${head(A, 'A')}<br>${head(B, 'B')}</caption>` +
      '<thead><tr><th scope="col">n</th><th scope="col">A</th><th scope="col">B</th><th scope="col">A − B</th></tr></thead>' +
      `<tbody>${rows.join('')}</tbody>`;
  }

  function capture(which) {
    if (!live) { el.message.textContent = 'Nothing to capture yet: there is no clear pitch.'; return; }
    const label = (which === 'A' ? el.labelA : el.labelB).value.trim() || (which === 'A' ? 'Sound A' : 'Sound B');
    const snap = { label, f0: live.f0, harmonics: live.harmonics.map((h) => ({ ...h })), kind: 'measured' };
    if (which === 'A') A = snap; else B = snap;
    el.message.textContent = `Captured ${which}: ${label}.`;
    showCompare();
    draw();
  }

  el.captureA.addEventListener('click', () => capture('A'));
  el.captureB.addEventListener('click', () => capture('B'));
  el.useRef.addEventListener('click', () => {
    const key = el.ref.value;
    const f0 = referenceF0();
    B = { label: REFERENCE_TONES[key].label, f0, harmonics: referenceHarmonics(key, f0, COUNT), kind: 'calculated (Fourier series)' };
    el.message.textContent = `B is now the calculated ${REFERENCE_TONES[key].label.toLowerCase()} at ${f0.toFixed(1)} Hz.`;
    showCompare();
    draw();
  });
  el.playRef.addEventListener('click', () => {
    const amplitude = REFERENCE_TONES[el.ref.value].amplitude;
    const harmonics = [0, ...Array.from({ length: 20 }, (_, i) => amplitude(i + 1))];
    player.playFrequency(referenceF0(), { duration: 2, harmonics });
  });
  el.clear.addEventListener('click', () => { A = null; B = null; el.message.textContent = ''; showCompare(); draw(); });

  return {
    id: 'harmonics',
    title: 'Harmonics',
    subtitle: 'The fundamental and its harmonics, side by side',
    summary: 'See which harmonics make up a sound, and compare two sounds.',
    needsMic: true,
    windowSize: 8192, // spectrum resolution ≈ 5.9 Hz at 48 kHz
    show() { draw(); showTable(); showCompare(); },
    hide() {},
    onSamples(buffer, sampleRate, now) {
      const recent = buffer.subarray(buffer.length - 2048);
      const f0 = levelDb(recent) >= GATE_DB ? detectPitchYin(recent, sampleRate, { minHz: 50, maxHz: 1500 }).frequency : null;
      live = f0 ? { f0, harmonics: relativeToLoudest(measureHarmonics(computeSpectrum(buffer, sampleRate), f0, { count: COUNT })) } : null;
      draw();
      if (now - lastTable > TABLE_EVERY_MS) { lastTable = now; showTable(); }
    },
  };
}
