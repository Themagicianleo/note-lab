// pipe-view.js
// ------------------------------------------------------------
// Lab tool 5: resonances of an open pipe, a closed pipe, or a string.
// Everything here is CALCULATED from the formulas in acoustics.js; each
// resonance is named with Note Lab's pitch code and can be played.
// ------------------------------------------------------------

import {
  speedOfSound, endCorrection, openPipeModes, closedPipeModes, stringModes,
  stringWaveSpeed, massPerLengthFromDiameter, modeShape,
} from '../acoustics.js';
import { frequencyToNote, formatNote } from '../pitch-math.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const COUNT = 6;
const SINE = [0, 1]; // play resonances as pure tones

export function createPipeTool({ player, getA4, onCompare }) {
  const el = {
    kinds: { open: byId('pipe-kind-open'), closed: byId('pipe-kind-closed'), string: byId('pipe-kind-string') },
    pipeInputs: byId('pipe-inputs'), stringInputs: byId('string-inputs'),
    length: byId('pipe-length'), temperature: byId('pipe-temperature'),
    diameter: byId('pipe-diameter'), useEnd: byId('pipe-end-correction'),
    sLength: byId('string-length'), tension: byId('string-tension'), mu: byId('string-mu'),
    sDiameter: byId('string-diameter'), density: byId('string-density'), muFromD: byId('string-mu-from-d'),
    error: byId('pipe-error'), working: byId('pipe-working'), table: byId('pipe-table'),
    playAll: byId('pipe-play-all'), canvas: byId('pipe-canvas'), shapeLabel: byId('pipe-shape-label'),
  };
  let kind = 'open';
  let modes = [];
  let selected = 1; // mode drawn in the diagram

  const num = (input) => Number(String(input.value).replace(',', '.'));

  // Check inputs; returns an error message or ''.
  function problem() {
    if (kind === 'string') {
      if (!(num(el.sLength) > 0)) return 'Enter the vibrating length in metres (more than 0).';
      if (!(num(el.tension) > 0)) return 'Enter the string tension in newtons (more than 0).';
      if (!(num(el.mu) > 0)) return 'Enter the mass per length μ in kg/m, or work it out from diameter and density below.';
      return '';
    }
    if (!(num(el.length) > 0)) return 'Enter the pipe length in metres (more than 0).';
    const t = num(el.temperature);
    if (!Number.isFinite(t) || t < -50 || t > 60) return 'Enter an air temperature between −50 and 60 °C.';
    if (el.useEnd.checked && !(num(el.diameter) > 0)) return 'Enter the inner diameter in millimetres for the end correction (or untick it).';
    return '';
  }

  function calculate() {
    const error = problem();
    el.error.hidden = !error;
    el.error.textContent = error;
    if (error) { modes = []; el.table.innerHTML = ''; el.working.textContent = ''; draw(); return; }

    if (kind === 'string') {
      const L = num(el.sLength), T = num(el.tension), mu = num(el.mu);
      const v = stringWaveSpeed(T, mu);
      modes = stringModes(L, T, mu, COUNT);
      el.working.innerHTML =
        `v = √(T/μ) = √(${T} / ${mu}) = <strong>${v.toFixed(1)} m/s</strong><br>` +
        `f₁ = 1 × v / (2L) = ${v.toFixed(1)} / (2 × ${L}) = <strong>${modes[0].hz.toFixed(1)} Hz</strong>; f_n = n × f₁`;
    } else {
      const L = num(el.length), t = num(el.temperature);
      const c = speedOfSound(t);
      const dL = el.useEnd.checked ? endCorrection(num(el.diameter) / 2000) : 0; // mm diameter → m radius
      const ends = kind === 'open' ? 2 : 1;
      const Leff = L + ends * dL;
      modes = kind === 'open' ? openPipeModes(L, c, COUNT, dL) : closedPipeModes(L, c, COUNT, dL);
      el.working.innerHTML =
        `c = 331.3 × √(1 + ${t}/273.15) = <strong>${c.toFixed(1)} m/s</strong><br>` +
        (dL ? `End correction ΔL = 0.6133 × r = 0.6133 × ${(num(el.diameter) / 2).toFixed(2)} mm = ${(dL * 1000).toFixed(2)} mm per open end → L_eff = ${L} + ${ends} × ${(dL).toFixed(5)} = ${Leff.toFixed(4)} m<br>` : '') +
        (kind === 'open'
          ? `f₁ = 1 × c / (2 × L${dL ? '_eff' : ''}) = ${c.toFixed(1)} / (2 × ${Leff.toFixed(4)}) = <strong>${modes[0].hz.toFixed(1)} Hz</strong>; f_n = n × f₁ (all harmonics)`
          : `f₁ = 1 × c / (4 × L${dL ? '_eff' : ''}) = ${c.toFixed(1)} / (4 × ${Leff.toFixed(4)}) = <strong>${modes[0].hz.toFixed(1)} Hz</strong>; then 3×, 5×, 7× … (odd harmonics only)`);
    }
    showTable();
    draw();
  }

  function showTable() {
    const a4 = getA4();
    el.table.innerHTML =
      '<thead><tr><th scope="col">Mode</th><th scope="col">Harmonic</th><th scope="col">Frequency</th><th scope="col">Nearest note</th><th scope="col"></th></tr></thead><tbody>' +
      modes.map((m) => {
        const note = m.hz >= 8 && m.hz <= 20000 ? formatNote(frequencyToNote(m.hz, a4)).split(' · ') : null;
        return `<tr${m.n === selected ? ' class="selected"' : ''}><th scope="row">${m.n}</th><td>${m.harmonic}×</td><td>${m.hz.toFixed(1)} Hz</td>` +
          `<td>${note ? `${note[0]} ${note[2]}` : '–'}</td>` +
          `<td class="row-actions"><button type="button" class="btn btn-small" data-play="${m.n}">Play</button>` +
          (onCompare ? `<button type="button" class="btn btn-small" data-compare="${m.n}">Compare</button>` : '') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  // Diagram of the selected mode's standing wave (displacement amplitude).
  function draw() {
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const left = 20, right = width - 20, mid = height / 2, amp = height * 0.32;
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.muted;
    if (kind === 'string') {
      ctx.fillStyle = c.muted;
      ctx.fillRect(left - 6, mid - 14, 6, 28); ctx.fillRect(right, mid - 14, 6, 28); // fixed ends
    } else {
      // the tube walls; a closed pipe gets a wall at the left end
      ctx.beginPath(); ctx.moveTo(left, mid - amp - 10); ctx.lineTo(right, mid - amp - 10);
      ctx.moveTo(left, mid + amp + 10); ctx.lineTo(right, mid + amp + 10); ctx.stroke();
      if (kind === 'closed') { ctx.beginPath(); ctx.moveTo(left, mid - amp - 10); ctx.lineTo(left, mid + amp + 10); ctx.stroke(); }
    }
    if (!modes.length) return;
    ctx.lineWidth = 2;
    for (const [sign, colour] of [[1, c.blue], [-1, c.orange]]) {
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (let px = 0; px <= right - left; px++) {
        const y = mid - sign * amp * modeShape(kind, selected, px / (right - left));
        if (px === 0) ctx.moveTo(left + px, y); else ctx.lineTo(left + px, y);
      }
      ctx.stroke();
    }
    const m = modes[selected - 1];
    el.shapeLabel.textContent = `Mode ${m.n} (${m.harmonic}× the lowest), ${m.hz.toFixed(1)} Hz. ` +
      (kind === 'string' ? 'The string moves most at the antinodes; it can\'t move at the fixed ends.'
        : kind === 'open' ? 'The air moves most at both open ends; the curves show how far the air moves back and forth.'
          : 'The air can\'t move at the closed end (a node), and moves most at the open end.');
  }

  function setKind(next) {
    kind = next;
    for (const [k, button] of Object.entries(el.kinds)) button.setAttribute('aria-pressed', String(k === kind));
    el.pipeInputs.hidden = kind === 'string';
    el.stringInputs.hidden = kind !== 'string';
    selected = 1;
    calculate();
  }

  for (const [k, button] of Object.entries(el.kinds)) button.addEventListener('click', () => setKind(k));
  for (const input of [el.length, el.temperature, el.diameter, el.sLength, el.tension, el.mu]) input.addEventListener('input', calculate);
  el.useEnd.addEventListener('change', calculate);
  el.muFromD.addEventListener('click', () => {
    const d = num(el.sDiameter), rho = num(el.density);
    if (!(d > 0) || !(rho > 0)) { el.error.hidden = false; el.error.textContent = 'Enter the string diameter (mm) and its material density (kg/m³) first.'; return; }
    el.mu.value = massPerLengthFromDiameter(d / 1000, rho).toPrecision(4);
    calculate();
  });
  el.table.addEventListener('click', (event) => {
    const play = event.target.dataset.play;
    const compare = event.target.dataset.compare;
    if (play) {
      selected = Number(play);
      player.playFrequency(modes[selected - 1].hz, { duration: 1.5, harmonics: SINE });
      showTable(); draw();
    } else if (compare && onCompare) {
      const m = modes[Number(compare) - 1];
      const what = kind === 'string' ? 'String' : kind === 'open' ? 'Open pipe' : 'Closed pipe';
      onCompare({ quantity: `${what} resonance, mode ${m.n}`, predicted: Number(m.hz.toFixed(1)), unit: 'Hz' });
    }
  });
  el.playAll.addEventListener('click', () => {
    modes.forEach((m, i) => player.playFrequency(m.hz, { start: i * 0.7, duration: 0.6, harmonics: SINE }));
  });

  return {
    id: 'pipes',
    title: 'Pipes and strings',
    subtitle: 'Resonant frequencies from length, temperature or tension',
    summary: 'Calculate and play the resonances of open pipes, closed pipes and strings.',
    needsMic: false,
    show() { calculate(); },
    hide() {},
  };
}
