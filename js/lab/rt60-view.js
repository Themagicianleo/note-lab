// rt60-view.js
// ------------------------------------------------------------
// Lab tool 7: RT60 estimate (Sabine, with Eyring for comparison).
// The user enters every surface's area and absorption coefficients, with a
// SOURCE for the coefficients. The app never supplies coefficients.
// Surfaces are saved on this device so they don't have to be typed again.
// ------------------------------------------------------------

import { RT60_BANDS, rt60ByBand, speedOfSound, sabineConstant } from '../acoustics.js';
import { loadJSON, saveJSON } from '../storage.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const STORE_KEY = 'note-lab-rt60-v1';
const bandLabel = (b) => (b >= 1000 ? `${b / 1000}k` : String(b));

export function createRt60Tool({ getRoom, onUseInRoom, onCompare }) {
  const el = {
    volume: byId('rt-volume'), temperature: byId('rt-temperature'), fromRoom: byId('rt-from-room'),
    list: byId('rt-surfaces'), add: byId('rt-add'), error: byId('rt-error'), warnings: byId('rt-warnings'),
    table: byId('rt-table'), canvas: byId('rt-canvas'), useInRoom: byId('rt-use-in-room'), working: byId('rt-working'),
  };
  const saved = loadJSON(STORE_KEY, null);
  let surfaces = Array.isArray(saved?.surfaces) ? saved.surfaces : [];
  if (saved?.volume) el.volume.value = saved.volume;
  if (saved?.temperature !== undefined) el.temperature.value = saved.temperature;
  let roomSurfaceArea = Number.isFinite(saved?.roomSurfaceArea) ? saved.roomSurfaceArea : null; // when copied from Room modes
  let results = [];

  const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(',', '.')));
  const save = () => saveJSON(STORE_KEY, { volume: el.volume.value, temperature: el.temperature.value, surfaces, roomSurfaceArea });

  // One editable block per surface. Values are kept as typed text (so "0,3" or blanks survive).
  function renderSurfaces() {
    el.list.replaceChildren(...surfaces.map((s, i) => {
      const box = document.createElement('div');
      box.className = 'surface';
      box.innerHTML =
        `<div class="surface-top"><input class="input" data-field="name" aria-label="Surface name" placeholder="Surface, e.g. Carpet on concrete"><input class="input area" data-field="area" inputmode="decimal" aria-label="Area in square metres" placeholder="Area m²"><button type="button" class="btn btn-small btn-danger" data-remove="${i}" aria-label="Remove surface">✕</button></div>` +
        `<div class="alpha-grid">${RT60_BANDS.map((b) => `<label><span>${bandLabel(b)} Hz</span><input class="input" data-band="${b}" inputmode="decimal" aria-label="Absorption coefficient at ${b} Hz" placeholder="α"></label>`).join('')}</div>` +
        `<input class="input" data-field="source" aria-label="Source of the coefficients" placeholder="Source of these α values (book, maker's data sheet, page…)">`;
      // Fill in the values as plain text (not HTML), since they come from typing or saved data.
      box.querySelector('[data-field="name"]').value = s.name || '';
      box.querySelector('[data-field="area"]').value = s.area ?? '';
      box.querySelector('[data-field="source"]').value = s.source || '';
      for (const b of RT60_BANDS) box.querySelector(`[data-band="${b}"]`).value = s.alpha?.[b] ?? '';
      box.addEventListener('input', (event) => {
        const t = event.target;
        if (t.dataset.field) s[t.dataset.field] = t.value;
        if (t.dataset.band) s.alpha = { ...s.alpha, [t.dataset.band]: t.value };
        save();
        calculate();
      });
      return box;
    }));
  }

  function calculate() {
    const V = num(el.volume.value);
    const T = num(el.temperature.value);
    const problems = [];
    if (!(V > 0)) problems.push('Enter the room volume in m³ (or copy it from Room modes).');
    if (!Number.isFinite(T) || T < -50 || T > 60) problems.push('Enter an air temperature between −50 and 60 °C.');
    if (!surfaces.length) problems.push('Add at least one surface with its area and absorption coefficients.');

    // Turn the typed text into numbers, and collect warnings about the data.
    const warnings = [];
    const parsed = surfaces.map((s, i) => {
      const label = s.name?.trim() || `Surface ${i + 1}`;
      const area = num(s.area);
      if (!(area > 0)) problems.push(`${label}: enter its area in m².`);
      const alpha = {};
      for (const b of RT60_BANDS) {
        const a = num(s.alpha?.[b] ?? '');
        if (Number.isFinite(a)) {
          if (a < 0 || a > 1.5) problems.push(`${label}: α at ${b} Hz must be between 0 and 1 (lab data can slightly exceed 1).`);
          else if (a > 1) warnings.push(`${label}: α = ${a} at ${b} Hz is above 1. That can appear in lab measurements (edge effects), but Eyring can't use it.`);
          alpha[b] = a;
        }
      }
      if (!s.source?.trim()) warnings.push(`${label}: no source given for its coefficients, so results that use it are unsourced.`);
      return { area, alpha };
    });
    el.error.hidden = !problems.length;
    el.error.textContent = problems.join(' ');
    if (problems.length) { results = []; el.table.innerHTML = ''; el.working.textContent = ''; el.warnings.innerHTML = ''; draw(); return; }

    const c = speedOfSound(T);
    const S = parsed.reduce((sum, s) => sum + s.area, 0);
    results = rt60ByBand(V, parsed, c);

    if (roomSurfaceArea && Math.abs(S - roomSurfaceArea) / roomSurfaceArea > 0.05) {
      warnings.push(`Your surfaces add up to ${S.toFixed(1)} m², but the room's walls, floor and ceiling are ${roomSurfaceArea.toFixed(1)} m². Is a surface missing or counted twice?`);
    }
    for (const r of results) {
      if (!r.missing && r.meanAlpha > 0.3) warnings.push(`At ${bandLabel(r.band)} Hz the average α is ${r.meanAlpha.toFixed(2)}: above about 0.2–0.3 Sabine's formula overestimates, so the Eyring value is likely closer.`);
    }
    el.warnings.innerHTML = '';
    for (const w of warnings) { const li = document.createElement('li'); li.textContent = w; el.warnings.append(li); }

    const k = sabineConstant(c);
    el.working.innerHTML = `c = ${c.toFixed(1)} m/s → Sabine constant 24 × ln(10) / c = <strong>${k.toFixed(4)}</strong> s/m · total surface S = ${S.toFixed(1)} m² · V = ${V} m³`;
    el.table.innerHTML =
      '<thead><tr><th scope="col">Band</th><th scope="col">A = Σ S·α</th><th scope="col">ᾱ</th><th scope="col">Sabine T60</th><th scope="col">Eyring T60</th><th scope="col"></th></tr></thead><tbody>' +
      results.map((r) => (r.missing
        ? `<tr><th scope="row">${bandLabel(r.band)} Hz</th><td colspan="5" class="muted">not calculated: a surface has no α for this band</td></tr>`
        : `<tr><th scope="row">${bandLabel(r.band)} Hz</th><td>${r.A.toFixed(2)} m²</td><td>${r.meanAlpha.toFixed(3)}</td>` +
          `<td><strong>${r.sabine.toFixed(2)} s</strong></td><td>${r.eyring === null ? '–' : `${r.eyring.toFixed(2)} s`}</td>` +
          (onCompare ? `<td class="row-actions"><button type="button" class="btn btn-small" data-compare="${r.band}">Compare</button></td>` : '<td></td>') + '</tr>')).join('') + '</tbody>';
    const mid = results.find((r) => r.band === 500 && !r.missing);
    el.useInRoom.disabled = !mid;
    el.useInRoom.textContent = mid ? `Use the 500 Hz value (${mid.sabine.toFixed(2)} s) in Room modes` : 'Use the 500 Hz value in Room modes';
    draw();
  }

  function draw() {
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const ok = results.filter((r) => !r.missing);
    const top = 10, bottom = height - 20, left = 30;
    const most = Math.max(0.5, ...ok.map((r) => Math.max(r.sabine, r.eyring || 0))) * 1.1;
    const yOf = (t) => bottom - ((bottom - top) * t) / most;
    const slot = (width - left) / RT60_BANDS.length;
    ctx.strokeStyle = c.grid; ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const step = most > 4 ? 1 : most > 2 ? 0.5 : most > 1 ? 0.25 : 0.1;
    for (let t = 0; t <= most; t += step) {
      const y = Math.round(yOf(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillText(`${+t.toFixed(2)}`, left - 4, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    RT60_BANDS.forEach((b, i) => {
      const x = left + (i + 0.5) * slot;
      ctx.fillStyle = c.muted; ctx.fillText(bandLabel(b), x, height - 2);
      const r = results.find((q) => q.band === b);
      if (!r || r.missing) return;
      ctx.fillStyle = c.purple;
      ctx.fillRect(x - slot * 0.25, yOf(r.sabine), slot * 0.5, bottom - yOf(r.sabine));
      if (r.eyring !== null) { ctx.fillStyle = c.orange; ctx.beginPath(); ctx.arc(x, yOf(r.eyring), 4, 0, 2 * Math.PI); ctx.fill(); }
    });
    ctx.fillStyle = c.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('s', 4, top - 6);
  }

  el.add.addEventListener('click', () => { surfaces.push({ name: '', area: '', alpha: {}, source: '' }); save(); renderSurfaces(); calculate(); });
  el.list.addEventListener('click', (event) => {
    const i = event.target.dataset.remove;
    if (i !== undefined) { surfaces.splice(Number(i), 1); save(); renderSurfaces(); calculate(); }
  });
  for (const input of [el.volume, el.temperature]) input.addEventListener('input', () => { save(); calculate(); });
  el.fromRoom.addEventListener('click', () => {
    const room = getRoom();
    if (!room) { el.error.hidden = false; el.error.textContent = 'Enter a valid room in the Room modes tool first.'; return; }
    const { L, W, H } = room;
    el.volume.value = +room.volume.toFixed(3);
    el.temperature.value = room.temperature;
    roomSurfaceArea = 2 * (L * W + L * H + W * H);
    // Add the six room surfaces with their areas. Coefficients stay EMPTY for you to fill in with sources.
    const add = (name, area) => surfaces.push({ name, area: String(+area.toFixed(3)), alpha: {}, source: '' });
    if (!surfaces.length) {
      add('Floor', L * W); add('Ceiling', L * W);
      add('Front + back walls', 2 * W * H); add('Side walls', 2 * L * H);
    }
    save(); renderSurfaces(); calculate();
  });
  el.useInRoom.addEventListener('click', () => {
    const mid = results.find((r) => r.band === 500 && !r.missing);
    if (mid) onUseInRoom(mid.sabine);
  });
  el.table.addEventListener('click', (event) => {
    const band = event.target.dataset.compare;
    if (band && onCompare) {
      const r = results.find((q) => q.band === Number(band));
      onCompare({ quantity: `RT60 at ${bandLabel(r.band)} Hz (Sabine, V = ${el.volume.value} m³)`, predicted: Number(r.sabine.toFixed(2)), unit: 's' });
    }
  });

  renderSurfaces();

  return {
    id: 'rt60',
    title: 'RT60 estimate',
    subtitle: 'How long sound takes to die away (Sabine)',
    summary: 'Estimate reverberation time from volume and absorption coefficients you provide.',
    needsMic: false,
    show() { calculate(); },
    hide() {},
  };
}
