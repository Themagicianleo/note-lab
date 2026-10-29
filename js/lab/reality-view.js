// reality-view.js
// ------------------------------------------------------------
// Lab tool 8: compare with reality. A log of your own measurements next to
// what the models predicted, with the difference in units, % and cents.
// Entries are saved on this device; they can be downloaded as a CSV file.
// The calculators' "Compare" buttons fill in the predicted value.
// If the microphone is on, you can fill in the measured value from the pitch
// it hears (MEASURED, with YIN and a steady-reading check).
// ------------------------------------------------------------

import { t as tr } from '../i18n.js';
import { compareValues, summariseComparisons, toCsv } from '../acoustics.js';
import { detectPitchYin } from '../yin.js';
import { PitchSmoother } from '../smoothing.js';
import { levelDb } from '../level.js';
import { loadJSON, saveJSON, removeKey } from '../storage.js';

const byId = (id) => document.getElementById(id);
const STORE_KEY = 'note-lab-reality-v1';
const GATE_DB = -60;

export function createRealityTool({ isListening, startListening }) {
  const el = {
    prefilled: byId('reality-prefilled'), quantity: byId('reality-quantity'), unit: byId('reality-unit'),
    predicted: byId('reality-predicted'), measured: byId('reality-measured'), method: byId('reality-method'),
    notes: byId('reality-notes'), add: byId('reality-add'), error: byId('reality-error'),
    useMic: byId('reality-use-mic'), micReading: byId('reality-mic-reading'), startMic: byId('reality-start-mic'),
    table: byId('reality-table'), summary: byId('reality-summary'),
    exportCsv: byId('reality-export'), clear: byId('reality-clear'),
  };
  let entries = loadJSON(STORE_KEY, []);
  if (!Array.isArray(entries)) entries = [];
  const smoother = new PitchSmoother({ historySize: 15, minValid: 12 }); // steady readings only
  let micHz = null;

  const num = (v) => (String(v).trim() === '' ? NaN : Number(String(v).replace(',', '.')));
  const save = () => saveJSON(STORE_KEY, entries);
  const fmt = (v, unit) => `${+v.toFixed(unit === 's' ? 2 : 1)} ${unit}`;

  function render() {
    if (!entries.length) {
      el.table.innerHTML = '<tbody><tr><td class="muted">No comparisons yet.</td></tr></tbody>';
      el.summary.textContent = '';
      return;
    }
    // Rows are built with textContent, because everything in them was typed by the user.
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th scope="col">What</th><th scope="col">Predicted</th><th scope="col">Measured</th><th scope="col">Difference</th><th scope="col"></th></tr>';
    const body = document.createElement('tbody');
    entries.forEach((e, i) => {
      const r = compareValues(e.predicted, e.measured, e.unit);
      const tr = document.createElement('tr');
      const cell = (text, tag = 'td') => { const c = document.createElement(tag); c.textContent = text; tr.append(c); return c; };
      const what = cell(e.quantity, 'th');
      what.scope = 'row';
      const meta = document.createElement('div');
      meta.className = 'small muted';
      meta.textContent = `${e.method}${e.notes ? ` · ${e.notes}` : ''} · ${e.date}`;
      what.append(meta);
      cell(fmt(e.predicted, e.unit));
      cell(fmt(e.measured, e.unit));
      cell(`${r.difference >= 0 ? '+' : ''}${fmt(r.difference, e.unit)} (${r.percent >= 0 ? '+' : ''}${r.percent.toFixed(1)} %)` +
        (r.cents !== null ? `, ${r.cents >= 0 ? '+' : ''}${r.cents.toFixed(0)} cents` : ''));
      const actions = cell('');
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn btn-small btn-danger'; del.textContent = 'Delete'; del.dataset.delete = String(i);
      actions.append(del);
      body.append(tr);
    });
    el.table.replaceChildren(head, body);

    const s = summariseComparisons(entries);
    el.summary.textContent = Object.entries(s).map(([unit, u]) =>
      `${u.count} in ${unit}: the model was off by ${u.meanAbsPercent.toFixed(1)} % on average` +
      (u.meanAbsCents !== null ? ` (${u.meanAbsCents.toFixed(0)} cents)` : '')).join(' · ');
  }

  el.add.addEventListener('click', () => {
    const predicted = num(el.predicted.value);
    const measured = num(el.measured.value);
    const quantity = el.quantity.value.trim();
    const problems = [];
    if (!quantity) problems.push('Say what you compared (e.g. "Room mode: length 1").');
    if (!(predicted > 0)) problems.push('Enter the predicted value (a positive number).');
    if (!(measured > 0)) problems.push('Enter your measured or heard value (a positive number).');
    el.error.hidden = !problems.length;
    el.error.textContent = problems.join(' ');
    if (problems.length) return;
    entries.unshift({
      quantity, unit: el.unit.value, predicted, measured, method: el.method.value,
      notes: el.notes.value.trim(), date: new Date().toISOString().slice(0, 10),
    });
    save();
    el.measured.value = ''; el.notes.value = ''; el.prefilled.hidden = true;
    render();
  });

  el.table.addEventListener('click', (event) => {
    const i = event.target.dataset.delete;
    if (i !== undefined) { entries.splice(Number(i), 1); save(); render(); }
  });

  el.useMic.addEventListener('click', () => {
    if (micHz) { el.measured.value = micHz.toFixed(1); el.unit.value = 'Hz'; el.method.value = 'Measured with Note Lab (microphone pitch)'; }
  });

  el.exportCsv.addEventListener('click', () => {
    const rows = [['Date', 'What', 'Unit', 'Predicted', 'Measured', 'Difference', 'Percent', 'Cents', 'How measured', 'Notes']];
    for (const e of entries) {
      const r = compareValues(e.predicted, e.measured, e.unit);
      rows.push([e.date, e.quantity, e.unit, e.predicted, e.measured, r.difference.toFixed(3), r.percent.toFixed(2), r.cents === null ? '' : r.cents.toFixed(1), e.method, e.notes]);
    }
    // Made into a file in the browser and saved on this device; nothing is uploaded.
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'note-lab-comparisons.csv';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  el.clear.addEventListener('click', () => {
    if (!entries.length || !confirm(tr('Delete all your comparisons from this device?'))) return;
    entries = []; removeKey(STORE_KEY); render();
  });

  function refreshMic() {
    const listening = isListening();
    el.useMic.disabled = !(listening && micHz);
    el.startMic.hidden = listening;
    el.micReading.textContent = !listening ? 'To fill this in from a pitch (a pipe or string), start the microphone.'
      : micHz ? `Microphone hears a steady ${micHz.toFixed(1)} Hz (measured).` : 'Microphone on: hold a steady note (blow the pipe, pluck the string) to get a reading.';
  }

  el.startMic.addEventListener('click', async () => { await startListening(); refreshMic(); });
  render();

  return {
    id: 'reality',
    title: 'Compare with reality',
    subtitle: 'Your measurements next to the models',
    summary: 'Log what you measured or heard next to the prediction, and see how close the model is.',
    kind: 'Your notes',
    needsMic: false,
    windowSize: 2048,
    show() { render(); refreshMic(); },
    hide() {},
    // A calculator's "Compare" button: fill in what was predicted.
    prefill({ quantity, predicted, unit }) {
      el.quantity.value = quantity;
      el.predicted.value = predicted;
      el.unit.value = unit;
      el.measured.value = '';
      el.prefilled.hidden = false;
      el.prefilled.textContent = `Predicted value filled in from the calculator: ${quantity} = ${predicted} ${unit}. Now enter what you measured or heard.`;
    },
    // While the mic is on: keep a steady pitch reading for "Use the pitch the mic hears".
    onSamples(buffer, sampleRate) {
      const recent = buffer.subarray(buffer.length - 2048);
      const f = levelDb(recent) >= GATE_DB ? detectPitchYin(recent, sampleRate, { minHz: 30, maxHz: 1500 }).frequency : null;
      micHz = smoother.push(f);
      refreshMic();
    },
  };
}
