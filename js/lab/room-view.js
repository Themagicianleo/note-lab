// room-view.js
// ------------------------------------------------------------
// Lab tool 6: room modes. CALCULATED from Rayleigh's formula for a
// rectangular room with rigid walls (see acoustics.js). Shows the axial
// modes on a frequency chart and in a table (with note names, where the
// mode is silent, Play and Compare), close pairs of modes, and optionally
// tangential/oblique modes and the Schroeder frequency.
// ------------------------------------------------------------

import { speedOfSound, axialModes, allRoomModes, axialNullPositions, coincidentModes, schroederFrequency } from '../acoustics.js';
import { frequencyToNote, formatNote } from '../pitch-math.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const SINE = [0, 1];
const DIM_LABEL = { length: 'Length', width: 'Width', height: 'Height' };

export function createRoomTool({ player, getA4, onCompare, onRoomChange }) {
  const el = {
    L: byId('room-length'), W: byId('room-width'), H: byId('room-height'),
    temperature: byId('room-temperature'), maxHz: byId('room-max'), rt60: byId('room-rt60'),
    showAll: byId('room-show-all'), error: byId('room-error'), working: byId('room-working'),
    canvas: byId('room-canvas'), table: byId('room-table'), notes: byId('room-notes'), others: byId('room-others'),
  };
  let modes = [];
  let others = [];
  let pairs = [];
  let schroeder = null;

  const num = (input) => Number(String(input.value).replace(',', '.'));
  const dims = () => [num(el.L), num(el.W), num(el.H)];

  function problem() {
    if (!dims().every((d) => d > 0 && d < 1000)) return 'Enter the room length, width and height in metres (each more than 0).';
    const t = num(el.temperature);
    if (!Number.isFinite(t) || t < -50 || t > 60) return 'Enter an air temperature between −50 and 60 °C.';
    const rt = el.rt60.value.trim();
    if (rt && !(num(el.rt60) > 0)) return 'RT60 must be a positive number of seconds (or leave it empty).';
    return '';
  }

  function calculate() {
    const error = problem();
    el.error.hidden = !error;
    el.error.textContent = error;
    if (error) { modes = []; others = []; el.table.innerHTML = ''; el.working.textContent = ''; el.notes.innerHTML = ''; draw(); return; }
    const [L, W, H] = dims();
    const c = speedOfSound(num(el.temperature));
    const maxHz = num(el.maxHz);
    modes = axialModes(c, [L, W, H], maxHz);
    others = el.showAll.checked ? allRoomModes(c, [L, W, H], maxHz).filter((m) => m.type !== 'axial') : [];
    pairs = coincidentModes(modes);
    const V = L * W * H;
    schroeder = el.rt60.value.trim() ? schroederFrequency(num(el.rt60), V) : null;
    onRoomChange?.({ L, W, H, volume: V, temperature: num(el.temperature) });

    el.working.innerHTML =
      `c = 331.3 × √(1 + ${num(el.temperature)}/273.15) = <strong>${c.toFixed(1)} m/s</strong> · volume V = ${L} × ${W} × ${H} = ${V.toFixed(1)} m³<br>` +
      `Lowest axial modes: length ${(c / (2 * L)).toFixed(1)} Hz (= ${c.toFixed(1)} / (2 × ${L})), width ${(c / (2 * W)).toFixed(1)} Hz, height ${(c / (2 * H)).toFixed(1)} Hz` +
      (schroeder ? `<br>Schroeder frequency ≈ 2000 × √(${num(el.rt60)} / ${V.toFixed(1)}) = <strong>${schroeder.toFixed(0)} Hz</strong>` : '');
    showTable();
    showNotes();
    draw();
  }

  function showTable() {
    const a4 = getA4();
    const size = { length: num(el.L), width: num(el.W), height: num(el.H) };
    const inPair = (m) => pairs.some((p) => p.includes(m));
    el.table.innerHTML =
      '<thead><tr><th scope="col">Frequency</th><th scope="col">Mode</th><th scope="col">Nearest note</th><th scope="col">Silent at (m from a wall)</th><th scope="col"></th></tr></thead><tbody>' +
      modes.map((m, i) => {
        const note = formatNote(frequencyToNote(m.hz, a4)).split(' · ');
        const nulls = axialNullPositions(m.n, size[m.dimension]).map((x) => x.toFixed(2)).join(', ');
        return `<tr class="dim-${m.dimension}"><th scope="row">${m.hz.toFixed(1)} Hz${inPair(m) ? ' <span class="pill tag-warn">close pair</span>' : ''}</th>` +
          `<td>${DIM_LABEL[m.dimension]} ${m.n}</td><td>${note[0]} ${note[2]}</td><td>${nulls}</td>` +
          `<td class="row-actions"><button type="button" class="btn btn-small" data-play="${i}">Play</button>` +
          (onCompare ? `<button type="button" class="btn btn-small" data-compare="${i}">Compare</button>` : '') + '</td></tr>';
      }).join('') + '</tbody>';
    el.others.textContent = el.showAll.checked
      ? `Also ${others.filter((m) => m.type === 'tangential').length} tangential and ${others.filter((m) => m.type === 'oblique').length} oblique modes up to ${num(el.maxHz)} Hz (grey ticks on the chart). They're usually weaker than axial modes.`
      : '';
  }

  function showNotes() {
    el.notes.innerHTML = pairs.length
      ? pairs.map(([a, b]) => `<li><strong>${a.hz.toFixed(1)} and ${b.hz.toFixed(1)} Hz</strong> (${DIM_LABEL[a.dimension]} ${a.n} and ${DIM_LABEL[b.dimension]} ${b.n}) are within 3% of each other, so expect an extra-strong boom around there.</li>`).join('')
      : '<li>No two axial modes from different dimensions are within 3% of each other.</li>';
  }

  function draw() {
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const left = 8, right = width - 10, top = 14, bottom = height - 18;
    const maxHz = num(el.maxHz) || 300;
    const xOf = (hz) => left + ((right - left) * hz) / maxHz;
    const colour = { length: c.blue, width: c.orange, height: c.green };

    // Frequency axis
    ctx.strokeStyle = c.grid; ctx.fillStyle = c.muted; ctx.lineWidth = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const step = maxHz <= 200 ? 25 : maxHz <= 400 ? 50 : 100;
    for (let hz = 0; hz <= maxHz; hz += step) {
      const x = Math.round(xOf(hz)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillText(`${hz}`, Math.min(right - 8, Math.max(left + 8, x)), height - 2);
    }
    // Tangential/oblique: short grey ticks
    ctx.strokeStyle = c.muted; ctx.globalAlpha = 0.5;
    for (const m of others) { const x = xOf(m.hz); ctx.beginPath(); ctx.moveTo(x, bottom); ctx.lineTo(x, bottom - 18); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // Axial: tall lines, coloured by dimension; height falls a little with n so close lines stay distinct
    ctx.lineWidth = 2.5;
    for (const m of modes) {
      const x = xOf(m.hz);
      const h = (bottom - top) * Math.max(0.35, 1 - (m.n - 1) * 0.12);
      ctx.strokeStyle = colour[m.dimension];
      ctx.beginPath(); ctx.moveTo(x, bottom); ctx.lineTo(x, bottom - h); ctx.stroke();
    }
    // Close pairs: a marker above
    ctx.fillStyle = c.red;
    for (const [a] of pairs) { ctx.beginPath(); ctx.arc(xOf(a.hz), top + 2, 4, 0, 2 * Math.PI); ctx.fill(); }
    // Schroeder frequency: dashed line
    if (schroeder && schroeder <= maxHz) {
      const x = xOf(schroeder);
      ctx.strokeStyle = c.purple; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c.purple; ctx.textAlign = x > width - 70 ? 'right' : 'left'; ctx.textBaseline = 'top';
      ctx.fillText('Schroeder', x + (x > width - 70 ? -4 : 4), top);
    }
    ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('Hz', right, bottom - 2);
  }

  for (const input of [el.L, el.W, el.H, el.temperature, el.rt60]) input.addEventListener('input', calculate);
  el.maxHz.addEventListener('change', calculate);
  el.showAll.addEventListener('change', calculate);
  el.table.addEventListener('click', (event) => {
    const { play, compare } = event.target.dataset;
    if (play !== undefined) player.playFrequency(modes[Number(play)].hz, { duration: 3, harmonics: SINE });
    if (compare !== undefined && onCompare) {
      const m = modes[Number(compare)];
      onCompare({ quantity: `Room mode: ${DIM_LABEL[m.dimension].toLowerCase()} ${m.n} (${dims().join(' × ')} m)`, predicted: Number(m.hz.toFixed(1)), unit: 'Hz' });
    }
  });

  return {
    id: 'room',
    title: 'Room modes',
    subtitle: 'Where a rectangular room booms, and why',
    summary: 'Axial modes from room size and temperature, and what they mean for mixing.',
    needsMic: false,
    show() { calculate(); },
    hide() {},
  };
}
