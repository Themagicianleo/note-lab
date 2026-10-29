// browser-test.js
// ------------------------------------------------------------
// Optional check in a real (desktop Chromium) browser. Chromium can pretend
// a WAV file is the microphone, so we can check the whole app end to end:
// Start button → permission → detection → what the page shows.
//
// Needs Playwright (https://playwright.dev), which is NOT a dependency of the
// app. To run it yourself:  npm install --no-save playwright && npx playwright install chromium
// Then:                     node tools/browser-test.js
//
// This cannot test iPhone Safari. That needs a real iPhone (see README).
// ------------------------------------------------------------

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8123;
const URL_ = `http://localhost:${PORT}/`;
const SIGNALS = `${ROOT}test-audio/generated/`;

// [file, what the details line should start with]
const CASES = [
  ['sine-A4.wav', 'A4 · 440.0 Hz · 0 cents'],
  ['sine-E4-330Hz.wav', 'E4 · 330.0 Hz · +2 cents'],
  ['weak-fundamental-A2.wav', 'A2 · 110.0 Hz'],
  ['bright-A3.wav', 'A3 · 220.0 Hz'],
  ['voice-mid-A3-vibrato.wav', 'A3'],
  ['whisper-noise.wav', 'No clear note'],
  ['near-silence.wav', 'No clear note (too quiet)'],
];

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
}

// Start the local server and wait until it answers.
const server = spawn(process.execPath, [`${ROOT}tools/serve.js`], { env: { ...process.env, PORT: String(PORT) } });
await new Promise((resolve) => server.stdout.once('data', resolve));

async function openPage(args, permissions) {
  const browser = await chromium.launch({ args });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_);
  return { browser, page, errors };
}

// A page whose "microphone" plays one of the test files (on a loop).
const fakeMic = (file) => openPage([
  '--use-fake-ui-for-media-stream',      // auto-accept the permission prompt
  '--use-fake-device-for-media-stream',  // use a fake microphone...
  // ...that plays this file (a clean absolute path: Chromium doesn't resolve "..")
  `--use-file-for-fake-audio-capture=${file.startsWith('/') ? file : SIGNALS + file}`,
  '--autoplay-policy=no-user-gesture-required',
], ['microphone']);

// Screenshot of a Lab tool page from the top (the page header is sticky, so
// element screenshots further down would have it drawn over them).
async function labScreenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${ROOT}docs/screenshots/${name}.png` });
}

// Read an element 8 times over ~1.6 s; return the most common text and all readings.
async function mostCommonText(page, selector) {
  const seen = {};
  await page.waitForTimeout(600);
  for (let i = 0; i < 8; i++) {
    const text = await page.textContent(selector);
    seen[text] = (seen[text] || 0) + 1;
    await page.waitForTimeout(200);
  }
  return { text: Object.entries(seen).sort((a, b) => b[1] - a[1])[0][0], seen };
}

try {
  // 1. Tuner: a fake microphone playing each test file.
  for (const [file, expected] of CASES) {
    const { browser, page, errors } = await fakeMic(file);
    await page.click('#start-button');
    await page.waitForSelector('#tuner:not([hidden])', { timeout: 5000 });

    const { text: mostCommon, seen } = await mostCommonText(page, '#note-details');
    const level = await page.textContent('#level-text');
    report(mostCommon.startsWith(expected) && errors.length === 0, file,
      `"${mostCommon}" (level ${level}; all readings ${JSON.stringify(seen)})${errors.length ? ` errors: ${errors}` : ''}`);

    if (file === 'voice-mid-A3-vibrato.wav') {
      mkdirSync(`${ROOT}docs/screenshots`, { recursive: true });
      await page.screenshot({ path: `${ROOT}docs/screenshots/tuner.png` });
    }

    // Stop must release the microphone and show the start panel again.
    await page.click('#stop-button');
    report(await page.isVisible('#start-button'), `${file}: Stop returns to start panel`);
    await browser.close();
  }

  // 1b. Tuner low range: a 41 Hz bass E1 needs the "Low instruments" option.
  {
    const { browser, page, errors } = await fakeMic('bass-E1.wav');
    await page.click('#start-button');
    await page.check('input[name="tuner-range"][value="low"]');
    const { text, seen } = await mostCommonText(page, '#note-details');
    const info = await page.textContent('#tech-info');
    report(text.startsWith('E1 · 41.2 Hz') && info.includes('4096') && !errors.length,
      'tuner low range finds bass E1', `"${text}" ${JSON.stringify(seen)} · ${info}`);
    await browser.close();
  }

  // 1c. Voice mode: the 5-note scale, range finder, graph.
  {
    const { browser, page, errors } = await fakeMic('voice-scale-C4-G4.wav');
    await page.click('#tab-voice');
    await page.click('#start-button');
    await page.waitForSelector('#voice:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(3500); // the file is 3 s long
    const low = await page.textContent('#range-low');
    const high = await page.textContent('#range-high');
    const span = await page.textContent('#range-span');
    report(low === 'C4 (261.6 Hz)' && high === 'G4 (392.0 Hz)' && !errors.length,
      'voice: range finder on scale C4–G4', `${low} → ${high}, ${span}${errors.length ? ` errors: ${errors}` : ''}`);
    await page.screenshot({ path: `${ROOT}docs/screenshots/voice.png`, fullPage: true });

    // Reset clears the range.
    await page.click('#range-reset');
    report((await page.textContent('#range-low')) === '–', 'voice: Reset range clears it');

    // Switching tabs keeps listening.
    await page.click('#tab-tuner');
    report(await page.isVisible('#tuner') && await page.isVisible('#stop-button'), 'switching to Tuner keeps listening');
    await browser.close();
  }

  // 1d. Voice mode: no clear pitch messages, and custom range validation.
  for (const [file, expected] of [
    ['whisper-noise.wav', 'No clear pitch: breath, noise or a consonant'],
    ['near-silence.wav', 'No clear pitch: too quiet (below the volume threshold)'],
  ]) {
    const { browser, page } = await fakeMic(file);
    await page.click('#tab-voice');
    await page.click('#start-button');
    const { text } = await mostCommonText(page, '#voice-details');
    report(text === expected, `voice: ${file}`, `"${text}"`);

    if (file === 'whisper-noise.wav') {
      // The voice settings live on the Settings page; the Voice tab links to it.
      await page.click('#voice-open-settings');
      await page.fill('#custom-min', '200');
      await page.fill('#custom-max', '250');
      await page.click('#custom-apply');
      const error = await page.textContent('#range-error');
      report(await page.isVisible('#range-error') && error.includes('1.5'), 'settings: too-narrow custom range is refused', `"${error}"`);
      await page.fill('#custom-max', '500');
      await page.click('#custom-apply');
      await page.click('#close-settings');
      const info = await page.textContent('#tech-info');
      const summary = await page.textContent('#voice-settings-summary');
      report(!(await page.isVisible('#range-error')) && info.includes('200–500 Hz') && summary.startsWith('Custom range') && await page.isVisible('#voice'),
        'settings: valid custom range is applied and shown on the Voice tab', `${summary} · ${info}`);
    }
    await browser.close();
  }

  // 1e. Spectrum mode: harmonics of a bright A3, pointer readout, freeze.
  {
    const { browser, page, errors } = await fakeMic('bright-A3.wav');
    await page.click('#tab-spectrum');
    await page.click('#start-button');
    await page.waitForSelector('#spectrum:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(1200);
    const peaks = await page.$$eval('#spectrum-peaks li', (items) => items.map((li) => li.textContent));
    const info = await page.textContent('#tech-info');
    // Allow 2%: on a busy machine Chromium's fake microphone has once delivered
    // all frequencies ~1% low (218/436/663 Hz). The ratios must still be 1:2.
    const hz = peaks.map((p) => parseFloat(p));
    const fundamentalOk = Math.abs(hz[0] / 220 - 1) < 0.02 && peaks[0].includes('A3');
    const harmonicOk = hz.some((h) => Math.abs(h / hz[0] - 2) < 0.01);
    report(fundamentalOk && harmonicOk && info.includes('8192') && !errors.length,
      'spectrum: bright A3 shows 220 Hz and its harmonic 440 Hz', `${JSON.stringify(peaks.slice(0, 3))} · ${info}${errors.length ? ` errors: ${errors}` : ''}`);

    // Point at the chart near 1 kHz (x is on a log scale between the margins).
    const box = await page.locator('#spectrum-chart').boundingBox();
    const left = box.x + 34;
    const x = left + (box.width - 34) * Math.log(1000 / 20) / Math.log(20000 / 20);
    await page.mouse.move(x, box.y + box.height / 2);
    await page.waitForTimeout(100);
    const pointer = await page.textContent('#spectrum-pointer');
    report(/^(9\d\d Hz|1\.0\d kHz)/.test(pointer) && pointer.includes('Mids'), 'spectrum: pointer readout near 1 kHz', `"${pointer.slice(0, 60)}…"`);

    await page.click('#spectrum-freeze');
    const frozenPeaks = await page.textContent('#spectrum-peaks');
    await page.waitForTimeout(500);
    report((await page.textContent('#spectrum-peaks')) === frozenPeaks && (await page.getAttribute('#spectrum-freeze', 'aria-pressed')) === 'true',
      'spectrum: Freeze stops updates');
    await page.click('#spectrum-freeze');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    await page.locator('#spectrum').screenshot({ path: `${ROOT}docs/screenshots/spectrum.png` });
    await browser.close();
  }

  // 1f. Ear training: notes and intervals (no microphone needed).
  {
    const { browser, page, errors } = await openPage([], []);
    // Record every frequency the page plays, so the test knows the right answer.
    await page.evaluate(() => {
      window.__played = [];
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const osc = original.call(this);
        const start = osc.start.bind(osc);
        osc.start = (when) => { window.__played.push(osc.frequency.value); start(when); };
        return osc;
      };
    });
    const nameOf = (hz) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12];

    await page.click('#tab-ear');
    report(await page.isVisible('#ear-notes') && !(await page.isVisible('#start-panel')), 'train: opens without the microphone');

    await page.click('#note-play');
    let played = await page.evaluate(() => window.__played);
    report(Math.abs(played[0] - 261.63) < 0.01 && played.length === 2, 'train: plays C4 reference, then the note', JSON.stringify(played.map((f) => f.toFixed(1))));
    await page.click(`#note-answers button[data-key="${nameOf(played[1])}"]`);
    const right = await page.textContent('#note-feedback');
    await page.evaluate(() => { window.__played = []; });
    await page.click('#note-play');
    played = await page.evaluate(() => window.__played);
    const wrongName = nameOf(played[1]) === 'C' ? 'D' : 'C';
    await page.click(`#note-answers button[data-key="${wrongName}"]`);
    const wrong = await page.textContent('#note-feedback');
    const total = await page.textContent('#note-stats tfoot');
    report(right.startsWith('Correct') && wrong.startsWith('Not quite') && total.includes('1 / 2'),
      'train: note answers are scored', `"${right.slice(0, 30)}…" / "${wrong.slice(0, 40)}…" / total ${total.trim()}`);

    await page.click('#ear-mode-intervals');
    await page.evaluate(() => { window.__played = []; });
    await page.click('#interval-play');
    played = await page.evaluate(() => window.__played);
    const semitones = Math.round(Math.abs(12 * Math.log2(played[1] / played[0])));
    await page.click(`#interval-answers button[data-key="${semitones}"]`);
    const intervalFeedback = await page.textContent('#interval-feedback');
    report(intervalFeedback.startsWith('Correct') && intervalFeedback.includes('Memory aid'),
      'train: interval answer is scored', `${semitones} semitones → "${intervalFeedback.slice(0, 60)}…"`);

    // Scores are saved on the device and come back after a reload.
    await page.reload();
    await page.click('#tab-ear');
    const saved = await page.textContent('#note-stats tfoot');
    report(saved.includes('1 / 2') && !errors.length, 'train: scores survive a reload', `${saved.trim()}${errors.length ? ` errors: ${errors}` : ''}`);
    await browser.close();
  }

  // 1g. Sing-back: target fixed to C4, the "microphone" sings a C4 sine (and E4 at 330 Hz = +2 cents).
  for (const [file, targetIndex, expected] of [['sine-C4.wav', 7, /^Excellent.*\(0 cents from C4\)/], ['sine-E4-330Hz.wav', 9, /^Excellent.*\(\+2 cents from E4\)/]]) {
    const { browser, page, errors } = await fakeMic(file);
    await page.click('#tab-ear');
    await page.click('#ear-mode-singback');
    report(await page.isVisible('#singback-need-mic') && await page.isDisabled('#singback-play'), `sing-back (${file}): asks for the microphone first`);
    await page.click('#singback-start-mic');
    await page.waitForSelector('#singback-play:not([disabled])', { timeout: 5000 });
    await page.evaluate((i) => { Math.random = () => (i + 0.5) / 12; }, targetIndex); // mid targets: C3 D3 E3 F3 G3 A3 B3 C4 D4 E4 F4 G4
    await page.click('#singback-play');
    await page.waitForFunction(() => document.getElementById('singback-result').textContent.length > 0, null, { timeout: 12000 });
    const result = await page.textContent('#singback-result');
    report(expected.test(result) && !errors.length, `sing-back (${file}): scored`, `"${result}"`);
    if (file === 'sine-E4-330Hz.wav') await page.locator('#ear').screenshot({ path: `${ROOT}docs/screenshots/singback.png` });
    await browser.close();
  }

  // 1h. Settings: reference pitch A4 = 442 changes the reading of a 440 Hz tone; saved after reload; reset.
  {
    const { browser, page, errors } = await fakeMic('sine-A4.wav');
    await page.click('#open-settings');
    await page.fill('#a4-input', '44');
    await page.dispatchEvent('#a4-input', 'change');
    const a4Error = await page.isVisible('#a4-error');
    await page.click('#a4-suggestions button:has-text("442 Hz")');
    const preview = await page.textContent('#a4-preview');
    await page.fill('#tuner-gate-slider', '-50');
    await page.dispatchEvent('#tuner-gate-slider', 'input');
    await page.click('#close-settings');
    await page.click('#start-button');
    const { text } = await mostCommonText(page, '#note-details');
    report(a4Error && preview.includes('C4 = 262.8 Hz') && text === 'A4 · 440.0 Hz · -8 cents',
      'settings: A4 = 442 Hz → a 440 Hz tone reads −8 cents', `"${text}" · ${preview}`);

    await page.reload();
    await page.click('#open-settings');
    const savedA4 = await page.inputValue('#a4-input');
    const savedGate = await page.textContent('#tuner-gate-value');
    report(savedA4 === '442' && savedGate === '-50 dBFS', 'settings: saved after a reload', `A4 ${savedA4}, gate ${savedGate}`);
    await page.locator('#settings').screenshot({ path: `${ROOT}docs/screenshots/settings.png` });

    await page.click('#reset-settings');
    report((await page.inputValue('#a4-input')) === '440' && !errors.length, 'settings: reset to defaults', errors.join(' '));
    await browser.close();
  }

  // 1i. How-it-works page, manifest and offline use.
  {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${URL_}how-it-works.html`);
    const guide = await page.textContent('main');
    report(guide.includes('E4 · 330.0 Hz · +2 cents') && guide.includes('dBFS'), 'how-it-works page loads with the worked example');

    const manifest = await page.evaluate(async () => (await fetch('manifest.json')).json());
    const iconStatus = await page.evaluate(async (icons) => Promise.all(icons.map(async (i) => (await fetch(i.src)).status)), manifest.icons);
    report(manifest.display === 'standalone' && iconStatus.every((s) => s === 200), 'manifest and icons are served', JSON.stringify(iconStatus));

    await page.goto(URL_);
    await page.waitForFunction(() => document.getElementById('offline-status').textContent.includes('Ready'), null, { timeout: 10000 });
    await page.waitForTimeout(500); // let the cache finish filling
    await context.setOffline(true);
    await page.reload();
    await page.click('#tab-ear');
    const offlineOk = await page.isVisible('#ear-notes');
    await page.goto(`${URL_}how-it-works.html`);
    const offlineGuide = (await page.textContent('h1')) === 'How it works';
    report(offlineOk && offlineGuide && !errors.length, 'works offline after the first visit (app and guide page)', errors.join(' '));
    await browser.close();
  }

  // 3. Acoustics Lab ------------------------------------------------------

  // 3.1 Waveform: a 440 Hz sine should show T = 2.273 ms → 440 Hz.
  {
    const { browser, page, errors } = await fakeMic('sine-A4.wav');
    await page.click('#tab-lab');
    report(await page.isVisible('#lab-grid') && !(await page.isVisible('#start-panel')), 'lab: menu opens without the microphone');
    await labScreenshot(page, 'lab-menu');
    await page.click('#lab-open-waveform');
    report(await page.isVisible('#lab-need-mic'), 'lab waveform: asks for the microphone first');
    await page.click('#lab-start-mic');
    await page.waitForTimeout(1200);
    const { text: period } = await mostCommonText(page, '#wave-period');
    const processing = await page.textContent('#mic-processing');
    const info = await page.textContent('#tech-info');
    report(period.startsWith('Period T = 2.27') && period.includes('440.') && info.includes('16384') && !errors.length,
      'lab waveform: measured period of a 440 Hz tone', `"${period}" · ${info}${errors.length ? ` errors: ${errors}` : ''}`);
    console.log(`      Chromium (desktop, fake mic) reports: ${processing}`);
    await page.fill('#wave-span', '0');
    await page.dispatchEvent('#wave-span', 'input');
    report((await page.textContent('#wave-span-value')) === '2 ms across', 'lab waveform: time zoom');
    await page.click('#wave-freeze');
    report((await page.getAttribute('#wave-freeze', 'aria-pressed')) === 'true', 'lab waveform: freeze');
    await page.click('#wave-freeze');
    await page.fill('#wave-span', '2');
    await page.dispatchEvent('#wave-span', 'input');
    await page.waitForTimeout(300);
    await labScreenshot(page, 'lab-waveform');
    await page.click('#lab-back');
    report(await page.isVisible('#lab-grid'), 'lab: back to the menu');
    await browser.close();
  }

  // 3.2 Harmonics: bright-A3 is a 220 Hz tone with harmonics at 1/n (like a sawtooth).
  {
    const { browser, page, errors } = await fakeMic('bright-A3.wav');
    await page.click('#tab-lab');
    await page.click('#lab-open-harmonics');
    await page.click('#lab-start-mic');
    await page.waitForTimeout(1500);
    const f0 = await page.textContent('#harm-f0');
    const level = async (n) => parseFloat((await page.textContent(`#harm-table tbody tr:nth-child(${n}) td:last-child`)) || 'NaN');
    const [l1, l2, l3] = [await level(1), await level(2), await level(3)];
    report(f0.includes('220.0 Hz') && Math.abs(l1) < 0.5 && Math.abs(l2 + 6.02) < 1 && Math.abs(l3 + 9.54) < 1,
      'lab harmonics: measured levels of a 1/n tone', `${f0} · n1 ${l1} dB, n2 ${l2} dB, n3 ${l3} dB`);

    await page.fill('#harm-label-a', 'Test file bright-A3');
    await page.click('#harm-capture-a');
    await page.selectOption('#harm-ref', 'sawtooth');
    await page.click('#harm-use-ref');
    const diffs = await page.$$eval('#harm-compare tbody tr td:last-child', (cells) => cells.slice(0, 5).map((td) => parseFloat(td.textContent)));
    report(diffs.every((d) => Math.abs(d) < 1.5) && !errors.length,
      'lab harmonics: measured A vs calculated sawtooth B differ by < 1.5 dB (n = 1–5)', JSON.stringify(diffs));
    await page.click('#harm-play-ref');
    await labScreenshot(page, 'lab-harmonics');
    await browser.close();
  }

  // 3.3 Beats: f1 = 440, Δ = +3 → plays 440 and 443 Hz, beat frequency 3 Hz.
  {
    const { browser, page, errors } = await openPage([], []);
    // Record each oscillator's frequency when it starts, and count stops.
    await page.evaluate(() => {
      window.__osc = { started: [], stopped: 0 };
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const osc = original.call(this);
        const start = osc.start.bind(osc);
        const stop = osc.stop.bind(osc);
        osc.start = (...a) => { window.__osc.started.push(osc.frequency.value); start(...a); };
        osc.stop = (...a) => { window.__osc.stopped++; stop(...a); };
        return osc;
      };
    });
    await page.click('#tab-lab');
    await page.click('#lab-open-beats');
    const result = await page.textContent('#beats-result');
    report(result.includes('= 3.0 Hz') && result.includes('0.333 s') && result.includes('441.50 Hz'), 'lab beats: calculated beat frequency', `"${result}"`);
    await page.click('#beats-play');
    await page.waitForTimeout(300);
    const started = await page.evaluate(() => window.__osc.started);
    report(started.length === 2 && started[0] === 440 && started[1] === 443, 'lab beats: plays 440 and 443 Hz', JSON.stringify(started));
    await labScreenshot(page, 'lab-beats');
    await page.click('#tab-tuner'); // leaving the Lab must stop the tones
    await page.waitForTimeout(400);
    const stopped = await page.evaluate(() => window.__osc.stopped);
    report(stopped === 2 && !errors.length, 'lab beats: leaving the Lab tab stops both tones', `${stopped} stopped${errors.length ? ` errors: ${errors}` : ''}`);
    await browser.close();
  }

  // 3.4 Spectrogram: a 440 Hz tone must be brightest at the 440 Hz row; window size changes the mic setup.
  {
    const { browser, page, errors } = await fakeMic('sine-A4.wav');
    await page.click('#tab-lab');
    await page.click('#lab-open-spectrogram');
    await page.click('#lab-start-mic');
    await page.waitForTimeout(1500);
    const found = await page.evaluate(() => {
      const canvas = document.getElementById('sgram-canvas');
      const ratio = canvas.width / canvas.clientWidth;
      const plotH = canvas.clientHeight - 16;
      const ctx = canvas.getContext('2d');
      const x = Math.round((canvas.clientWidth - 3) * ratio);
      // Brightness of each row in the newest column; then the centre of the brightest band.
      const rows = [];
      for (let y = 0; y < plotH * ratio; y++) {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        rows.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
      const best = Math.max(...rows);
      const band = rows.map((v, y) => (v >= best - 1 ? y : null)).filter((y) => y !== null);
      const bestY = (band[0] + band[band.length - 1]) / 2 / ratio;
      const yOf = (hz) => plotH * (1 - Math.log(hz / 50) / Math.log(5000 / 50)); // log scale 50 Hz – 5 kHz
      const binHz = 44100 / 2048;
      // The method can't place a peak better than about half a frequency bin.
      return { bestY, expected: yOf(440), allowed: Math.abs(yOf(440) - yOf(440 + binHz / 2)) + 1 };
    });
    report(Math.abs(found.bestY - found.expected) <= found.allowed, 'lab spectrogram: 440 Hz tone is brightest at the 440 Hz row (within half a bin)',
      `brightest at y=${found.bestY.toFixed(1)}, 440 Hz row y=${found.expected.toFixed(1)}, allowed ±${found.allowed.toFixed(1)}`);
    const res = await page.textContent('#sgram-resolution');
    await page.fill('#sgram-window', '4');
    await page.dispatchEvent('#sgram-window', 'input');
    await page.waitForTimeout(600);
    const res2 = await page.textContent('#sgram-resolution');
    const info = await page.textContent('#tech-info');
    report(res.includes('Δf = 44100/2048 = 21.5 Hz') && res2.includes('Δt = 8192/44100 = 185.8 ms') && info.includes('window 8192') && !errors.length,
      'lab spectrogram: window size changes Δt, Δf and the mic window', `${res2.slice(0, 90)}… · ${info}${errors.length ? ` errors: ${errors}` : ''}`);
    await page.fill('#sgram-window', '2');
    await page.dispatchEvent('#sgram-window', 'input');
    await browser.close();
  }
  {
    const { browser, page } = await fakeMic('voice-scale-C4-G4.wav');
    await page.click('#tab-lab');
    await page.click('#lab-open-spectrogram');
    await page.click('#lab-start-mic');
    await page.waitForTimeout(4500);
    await page.click('#sgram-freeze');
    await labScreenshot(page, 'lab-spectrogram');
    await browser.close();
  }

  // 3.5 Pipes and strings: the worked examples, note names, playing and input checks.
  {
    const { browser, page, errors } = await openPage([], []);
    await page.evaluate(() => {
      window.__played = [];
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const osc = original.call(this);
        const start = osc.start.bind(osc);
        osc.start = (...a) => { window.__played.push(osc.frequency.value); start(...a); };
        return osc;
      };
    });
    await page.click('#tab-lab');
    await page.click('#lab-open-pipes');
    const row = (n) => page.textContent(`#pipe-table tbody tr:nth-child(${n})`);
    const open1 = await row(1);
    report(open1.includes('343.2 Hz') && open1.includes('F4') && open1.includes('-30 cents'), 'lab pipes: open 0.5 m at 20 °C = 343.2 Hz ≈ F4 −30 cents', open1);
    await page.click('#pipe-table button[data-play="1"]');
    const played = await page.evaluate(() => window.__played[0]);
    report(Math.abs(played - 343.21) < 0.05, 'lab pipes: Play plays the calculated frequency', String(played));
    await page.fill('#pipe-temperature', '30');
    await page.dispatchEvent('#pipe-temperature', 'input');
    const warm = await row(1);
    report(warm.includes('349.0 Hz'), 'lab pipes: 30 °C raises it to 349.0 Hz', warm); // 331.3·√(1+30/273.15)/1.0
    await page.fill('#pipe-temperature', '20');
    await page.dispatchEvent('#pipe-temperature', 'input');
    await page.click('#pipe-kind-closed');
    const closed = [await row(1), await row(2)];
    report(closed[0].includes('171.6 Hz') && closed[1].includes('3×') && closed[1].includes('514.8 Hz'), 'lab pipes: closed pipe has odd harmonics 171.6, 514.8 Hz', closed.join(' / '));
    await labScreenshot(page, 'lab-pipes');
    await page.click('#pipe-kind-string');
    const str = await row(1);
    report(str.includes('185.8 Hz'), 'lab strings: 0.65 m, 70 N, 0.0012 kg/m = 185.8 Hz', str);
    await page.fill('#string-diameter', '0.43');
    await page.fill('#string-density', '7850');
    await page.click('#string-mu-from-d');
    report((await page.inputValue('#string-mu')) === '0.001140', 'lab strings: μ from diameter and density', await page.inputValue('#string-mu'));
    await page.fill('#string-length', '0');
    await page.dispatchEvent('#string-length', 'input');
    report(await page.isVisible('#pipe-error') && !errors.length, 'lab strings: a zero length shows a message, not a number', await page.textContent('#pipe-error'));
    await browser.close();
  }

  // 3.6 Room modes: 5 × 4 × 2.5 m at 20 °C.
  {
    const { browser, page, errors } = await openPage([], []);
    await page.evaluate(() => {
      window.__played = [];
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const osc = original.call(this);
        const start = osc.start.bind(osc);
        osc.start = (...a) => { window.__played.push(osc.frequency.value); start(...a); };
        return osc;
      };
    });
    await page.click('#tab-lab');
    await page.click('#lab-open-room');
    const first = await page.textContent('#room-table tbody tr:nth-child(1)');
    const pairRows = await page.$$eval('#room-table tbody tr', (rows) => rows.filter((r) => r.textContent.includes('close pair')).map((r) => r.querySelector('th').textContent.split(' ')[0]));
    report(first.includes('34.3 Hz') && first.includes('Length 1') && first.includes('2.50'), 'lab room: 1st length mode 34.3 Hz, silent at 2.50 m', first);
    // Up to 300 Hz this room (5, 4, 2.5 m share simple ratios) has several coinciding pairs:
    // 68.6 (L2 = H1), 137.3 (L4 = H2), 171.6 (L5 = W4), … each pair marks two rows.
    report(pairRows.filter((f) => f === '68.6').length === 2 && pairRows.includes('171.6') && pairRows.length % 2 === 0,
      'lab room: coinciding modes (e.g. 68.6 Hz = length 2 + height 1) marked as close pairs', JSON.stringify(pairRows));
    await page.fill('#room-rt60', '0.5');
    await page.dispatchEvent('#room-rt60', 'input');
    report((await page.textContent('#room-working')).includes('= 200 Hz'), 'lab room: Schroeder frequency 200 Hz (T60 0.5 s, V 50 m³)');
    await page.check('#room-show-all');
    report((await page.textContent('#room-others')).includes('tangential'), 'lab room: tangential and oblique modes counted', await page.textContent('#room-others'));
    await page.click('#room-table button[data-play="0"]');
    const played = await page.evaluate(() => window.__played[0]);
    report(Math.abs(played - 34.32) < 0.01, 'lab room: Play plays the 34.3 Hz mode', String(played));
    await labScreenshot(page, 'lab-room');
    await page.fill('#room-height', '-1');
    await page.dispatchEvent('#room-height', 'input');
    report(await page.isVisible('#room-error') && !errors.length, 'lab room: a negative height shows a message', errors.join(' '));
    await browser.close();
  }

  // 3.7 RT60. NOTE: α = 0.1 below is a made-up TEST value to check the arithmetic,
  //     not real material data.
  {
    const { browser, page, errors } = await openPage([], []);
    await page.click('#tab-lab');
    await page.click('#lab-open-rt60');
    await page.click('#rt-from-room'); // default room 5 × 4 × 2.5 m
    const volume = await page.inputValue('#rt-volume');
    const areas = await page.$$eval('#rt-surfaces .area', (inputs) => inputs.map((i) => Number(i.value)));
    report(volume === '50' && JSON.stringify(areas) === '[20,20,20,25]', 'lab rt60: room copied (V 50 m³; floor, ceiling, walls)', `${volume} m³, ${JSON.stringify(areas)}`);
    const alphaInputs = await page.$$('#rt-surfaces input[data-band="500"]');
    for (const input of alphaInputs) await input.fill('0.1');
    await page.waitForTimeout(100);
    const row500 = await page.textContent('#rt-table tbody tr:nth-child(3)');
    const row125 = await page.textContent('#rt-table tbody tr:nth-child(1)');
    const warnings = await page.$$eval('#rt-warnings li', (li) => li.map((x) => x.textContent));
    report(row500.includes('8.50 m²') && row500.includes('0.95 s') && row125.includes('not calculated'),
      'lab rt60: Sabine 0.161 × 50 / 8.5 = 0.95 s at 500 Hz; bands without α are not calculated', `${row500} | ${row125}`);
    report(warnings.filter((w) => w.includes('no source')).length === 4, 'lab rt60: surfaces without a source are flagged', `${warnings.length} warnings`);
    const sourceInputs = await page.$$('#rt-surfaces input[data-field="source"]');
    for (const input of sourceInputs) await input.fill('Test value for the automated check, not real data');
    await page.waitForTimeout(100);
    report((await page.$$eval('#rt-warnings li', (li) => li.length)) === 0, 'lab rt60: warnings clear once sources are given');
    await labScreenshot(page, 'lab-rt60');
    await page.click('#rt-use-in-room');
    await page.waitForTimeout(100);
    const working = await page.textContent('#room-working');
    // The value is passed as shown (0.95 s): 2000 × √(0.95/50) = 275.7 → 276 Hz.
    report(await page.isVisible('#lab-room') && working.includes('√(0.95 / 50.0) = 276 Hz'), 'lab rt60 → room modes: Schroeder frequency 2000 × √(0.95/50) = 276 Hz', working.split('Schroeder')[1]);
    await page.reload();
    await page.click('#tab-lab');
    await page.click('#lab-open-rt60');
    const kept = await page.$$eval('#rt-surfaces .surface', (s) => s.length);
    report(kept === 4 && !errors.length, 'lab rt60: surfaces are saved on the device', `${kept} surfaces after reload${errors.length ? ` errors: ${errors}` : ''}`);
    await browser.close();
  }

  // 3.8 Compare with reality.
  {
    const { browser, page, errors } = await fakeMic('sine-A4.wav');
    await page.click('#tab-lab');
    await page.click('#lab-open-room');
    await page.click('#room-table button[data-compare="0"]');
    const prefilled = [await page.inputValue('#reality-quantity'), await page.inputValue('#reality-predicted'), await page.inputValue('#reality-unit')];
    report(await page.isVisible('#lab-reality') && prefilled[1] === '34.3' && prefilled[2] === 'Hz' && prefilled[0].startsWith('Room mode: length 1'),
      'lab compare: Room modes "Compare" fills in the prediction', JSON.stringify(prefilled));
    await page.fill('#reality-measured', '36.0');
    await page.click('#reality-add');
    const row = await page.textContent('#reality-table tbody tr:nth-child(1)');
    const summary = await page.textContent('#reality-summary');
    report(row.includes('+1.7 Hz (+5.0 %), +84 cents') && summary.includes('off by 5.0 %'), 'lab compare: 34.3 vs 36.0 Hz → +1.7 Hz, +5.0 %, +84 cents', `${row} · ${summary}`);

    await page.click('#reality-start-mic');
    await page.waitForTimeout(1500);
    await page.click('#reality-use-mic');
    report((await page.inputValue('#reality-measured')) === '440.0', 'lab compare: measured value from the microphone (440 Hz tone)', await page.inputValue('#reality-measured'));
    await labScreenshot(page, 'lab-reality');

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#reality-export')]);
    const csv = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
    report(csv.startsWith('"Date","What","Unit","Predicted","Measured"') && csv.includes('"34.3","36"'), 'lab compare: CSV download', csv.split('\r\n')[1]);

    await page.reload();
    await page.click('#tab-lab');
    await page.click('#lab-open-reality');
    const kept = await page.$$eval('#reality-table tbody tr', (r) => r.length);
    await page.click('#reality-table button[data-delete="0"]');
    const empty = await page.textContent('#reality-table');
    report(kept === 1 && empty.includes('No comparisons yet') && !errors.length, 'lab compare: saved after reload, and Delete works', `${kept} kept${errors.length ? ` errors: ${errors}` : ''}`);
    await browser.close();
  }

  // 3.9 Key finder: a sung G-major tune (singer mode) and a D-minor band (song mode), in real time.
  const KEY_AUDIO = `${ROOT}test-audio/key/`;
  for (const [file, button, expected] of [[`${KEY_AUDIO}singer-G-major.wav`, '#key-mode-singer', 'G major'], [`${KEY_AUDIO}song-D-minor.wav`, '#key-mode-song', 'D minor']]) {
    const { browser, page, errors } = await fakeMic(file);
    if (file.includes('singer')) {
      // Also checks the Voice tab shortcut.
      await page.click('#tab-voice');
      await page.click('#start-button');
      await page.click('#voice-open-key');
    } else {
      await page.click('#tab-lab');
      await page.click('#lab-open-key');
      await page.click('#lab-start-mic');
    }
    await page.click(button);
    // Wait (in real time) until it names a key, up to 60 s.
    await page.waitForFunction(() => document.getElementById('key-result').textContent !== '…', null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(6000); // then a little longer, so the answer has settled
    const result = await page.textContent('#key-result');
    const sure = await page.textContent('#key-sure');
    const tuning = await page.textContent('#key-tuning');
    report(result === expected && !errors.length, `lab key finder (${button.includes('song') ? 'song' : 'singer'} mode): ${expected}`,
      `"${result}" · ${sure} · ${tuning}${errors.length ? ` errors: ${errors}` : ''}`);
    if (file.includes('song')) await labScreenshot(page, 'lab-key');
    await browser.close();
  }

  // 4. Pitch monitor (Voice tab): live line, statistics, key from the line,
  //    record / play back (memory only), drone, full screen, file analysis.
  {
    const { browser, page, errors } = await fakeMic(`${KEY_AUDIO}singer-G-major.wav`);
    await page.click('#tab-voice');
    report(await page.isVisible('#start-button') && await page.isVisible('#monitor-graph'), 'monitor: start card and graph shown before the mic starts');
    await page.click('#start-button');
    await page.click('#rec-start');
    await page.waitForTimeout(12000);
    await page.click('#rec-stop');
    await page.waitForFunction(() => document.getElementById('rec-status').textContent.startsWith('Recorded'), null, { timeout: 5000 }).catch(() => {});
    report((await page.textContent('#rec-status')).includes('in memory only') && !(await page.isDisabled('#rec-play')), 'monitor: record 12 s (memory only)', await page.textContent('#rec-status'));

    await page.click('#stats-all');
    await page.waitForTimeout(400);
    const range = await page.textContent('#stat-range');
    const within25 = await page.textContent('#stat-25');
    // The tune (Twinkle Twinkle in G) goes from G3 to E4; the test file is perfectly in tune, with ±25 cent vibrato.
    report(range === 'G3 – E4' && parseInt(within25, 10) >= 90, 'monitor: statistics of a G3–E4 tune', `${range}, within ±25 cents: ${within25}`);

    await page.click('#monitor-find-key');
    const keyText = await page.textContent('#monitor-key-result');
    report(keyText.includes('G major') && (await page.inputValue('#monitor-tonic')) === '7' && (await page.inputValue('#monitor-scale')) === 'major',
      'monitor: find the key of the sung line (G major) and set the scale lines', keyText);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${ROOT}docs/screenshots/monitor.png` });

    await page.click('#rec-play');
    await page.waitForTimeout(2000);
    const status = await page.textContent('#monitor-status');
    report(status.startsWith('Recording · playing'), 'monitor: play back the recording with its pitch line', status);
    await page.click('#monitor-pause'); // "Back to live"
    report((await page.textContent('#monitor-status')) === 'Live', 'monitor: back to live');

    await page.click('#monitor-pause');
    report((await page.textContent('#monitor-status')).startsWith('Paused'), 'monitor: pause');
    await page.click('#monitor-full');
    await page.waitForTimeout(400);
    report(!(await page.isVisible('#tabbar')), 'monitor: full screen hides the tab bar');
    await page.screenshot({ path: `${ROOT}docs/screenshots/monitor-full.png` });
    await page.click('#monitor-full');

    await page.selectOption('#drone-octave', '3');
    await page.click('#drone-toggle');
    report((await page.textContent('#drone-info')) === 'Playing: G3 = 196.0 Hz', 'monitor: drone on the key\'s tonic (G3)', await page.textContent('#drone-info'));
    await page.click('#drone-toggle');

    // Stopping the microphone forgets the recording (the privacy promise).
    await page.click('#stop-button');
    report(await page.isDisabled('#rec-play'), 'monitor: stopping the microphone deletes the recording');
    report(!errors.length, 'monitor: no page errors', errors.join(' | '));
    await browser.close();
  }
  {
    // File analysis, without the microphone: a glide C3 → C4, and a band (D minor) which is mostly "no clear pitch".
    const { browser, page, errors } = await openPage([], []);
    await page.click('#tab-voice');
    for (const [file, check, label] of [
      [`${SIGNALS}voice-glide-C3-C4.wav`, (t) => /clear pitch (9\d|100)%/.test(t), 'a sung glide: clear pitch ≥ 90% of the time'],
      [`${KEY_AUDIO}song-D-minor.wav`, (t) => t.includes('Mostly no clear pitch'), 'a band with chords: warns "mostly no clear pitch"'],
    ]) {
      const name = file.split('/').pop();
      await page.setInputFiles('#file-input', file);
      await page.waitForFunction((n) => document.getElementById('file-status').textContent.startsWith(`${n}:`), name, { timeout: 60000 }).catch(() => {});
      const text = await page.textContent('#file-status');
      report(check(text) && await page.isVisible('#file-close'), `monitor file analysis: ${label}`, text);
      if (name.startsWith('voice-glide')) {
        await page.waitForTimeout(800);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${ROOT}docs/screenshots/monitor-file.png` });
      }
    }
    await page.click('#file-close');
    report((await page.textContent('#monitor-status')) === 'Live' && !errors.length, 'monitor: close the file, back to live', errors.join(' | '));
    await browser.close();
  }

  // 5. Sensitivity: a sung A3 at −60 dBFS over built-in-mic-like noise
  //    (tools/sensitivity-check.js --wav). High (default) should show A3;
  //    Standard (the old behaviour) should say it's too quiet.
  {
    const { browser, page, errors } = await fakeMic(`${ROOT}test-audio/sensitivity/quiet-voice-A3.wav`);
    await page.click('#tab-voice');
    await page.click('#start-button');
    await page.waitForTimeout(3500); // past the 2 s of noise at the start (the threshold learns the room), into the singing; the file loops every 8 s
    const high = await mostCommonText(page, '#voice-note');
    const info = await page.textContent('#tech-info');
    report(high.text === 'A3' && info.includes('sensitivity high') && info.includes('band filter 50–3200 Hz'),
      'sensitivity High: a −60 dBFS sung A3 is detected', `${JSON.stringify(high.seen)} · ${info}`);
    await page.click('#open-settings');
    await page.check('input[name="sensitivity"][value="standard"]');
    await page.click('#close-settings');
    const standard = await mostCommonText(page, '#voice-details');
    report(standard.text.includes('too quiet'), 'sensitivity Standard: the same sound is "too quiet" (as before)', JSON.stringify(standard.seen));
    await page.click('#open-settings');
    await page.check('input[name="sensitivity"][value="maximum"]');
    await page.click('#close-settings');
    // The file loops every 8 s and starts with 2 s of noise, so read for a whole loop
    // and only count the moments that aren't "too quiet" (the singing part).
    const seen = {};
    for (let i = 0; i < 40; i++) {
      const [note, details] = await page.evaluate(() => [document.getElementById('voice-note').textContent, document.getElementById('voice-details').textContent]);
      if (!details.includes('too quiet')) seen[note] = (seen[note] || 0) + 1;
      await page.waitForTimeout(200);
    }
    const counted = Object.values(seen).reduce((a, b) => a + b, 0);
    report((await page.textContent('#tech-info')).includes('sensitivity maximum') && (seen.A3 || 0) >= 0.6 * counted && counted >= 10 && !errors.length,
      'sensitivity Maximum: A3 detected too (while singing)', `${JSON.stringify(seen)} ${errors.join(' | ')}`);
    await browser.close();
  }

  // 6. Music from a speaker: a generated song (F major melody F4–C5 over chords,
  //    bass and drums; tools/melody-check.js --wav). Normal mode should mostly
  //    say "no clear pitch"; music mode should follow the melody's notes.
  {
    const { browser, page, errors } = await fakeMic(`${ROOT}test-audio/melody/song-melody-F4.wav`);
    await page.click('#tab-voice');
    await page.click('#start-button');
    await page.click('#source-music');
    report(await page.isVisible('#source-help') && (await page.textContent('#tech-info')).includes('music mode'), 'music mode: switched on and explained');
    await page.click('#monitor-clear');
    await page.waitForTimeout(14000); // the song is ~14 s
    await page.click('#stats-all');
    await page.waitForTimeout(400);
    const most = await page.textContent('#stat-most');
    const range = await page.textContent('#stat-range');
    const clarity = await page.textContent('#voice-clarity');
    // The tune (in F major) uses F4 G4 A4 C5; its most-sung note is A4.
    report(['F4', 'G4', 'A4', 'C5'].some((n) => most.startsWith(n)) && clarity.startsWith('Music mode'),
      'music mode: follows the melody of a song', `most sung ${most}, range ${range}, "${clarity}"`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${ROOT}docs/screenshots/monitor-music.png` });
    await page.click('#source-single');
    report(await page.isHidden('#source-help') && !errors.length, 'music mode: back to one voice', errors.join(' | '));
    await browser.close();
  }
  {
    // An overloaded microphone shows the "too loud" warning; a normal level doesn't.
    const { browser, page, errors } = await fakeMic(`${ROOT}test-audio/melody/clipped-A4.wav`);
    await page.click('#start-button');
    await page.waitForTimeout(1000);
    report(await page.isVisible('#clip-warning') && !errors.length, 'clipping: "too loud" warning shown for an overloaded input');
    await browser.close();
    const quiet = await fakeMic('sine-A4.wav');
    await quiet.page.click('#start-button');
    await quiet.page.waitForTimeout(1000);
    report(await quiet.page.isHidden('#clip-warning'), 'clipping: no warning at a normal level (−6 dBFS sine)');
    await quiet.browser.close();
  }

  // 7. Stop button in the top bar, and the language switch (English ↔ 简体中文).
  {
    const { browser, page, errors } = await fakeMic('sine-A4.wav');
    report(await page.isHidden('#stop-button') && await page.isVisible('#top-start'), 'top bar: Start (not Stop) before listening');
    await page.click('#top-start'); // the top bar's Start works like the big one
    await page.waitForSelector('#stop-button:not([hidden])', { timeout: 5000 }).catch(() => {});
    report(await page.isHidden('#top-start') && (await page.evaluate(() => window.noteLabStarted)) === true, 'top bar: Start starts listening, then turns into Stop');
    const box = await page.locator('#stop-button').boundingBox();
    report(await page.isVisible('#stop-button') && box && box.y < 80, 'top bar: Stop button at the top while listening', JSON.stringify(box));
    const staticBefore = await page.evaluate(() => document.getElementById('settings').innerHTML + document.getElementById('lab').innerHTML);
    await page.click('#lang-switch');
    await page.waitForTimeout(800);
    const title = await page.textContent('#page-title');
    const details = await page.textContent('#note-details');
    report(title === '调音器' && (await page.getAttribute('html', 'lang')) === 'zh-Hans' && (await page.textContent('#lang-switch')) === 'EN',
      'language: switches to Chinese', `${title} · ${details}`);
    report(details.includes('音分') && await page.isVisible('#stop-button'), 'language: live readings are translated and the microphone keeps running', details);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${ROOT}docs/screenshots/tuner-zh.png` });
    await page.click('#tab-voice');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${ROOT}docs/screenshots/monitor-zh.png` });
    await page.reload();
    report((await page.textContent('#page-title')) === '调音器', 'language: remembered after reload');
    await page.click('#lang-switch');
    await page.waitForTimeout(300);
    const staticAfter = await page.evaluate(() => document.getElementById('settings').innerHTML + document.getElementById('lab').innerHTML);
    report((await page.textContent('#page-title')) === 'Tuner' && staticAfter.replace(/\s+/g, ' ') === staticBefore.replace(/\s+/g, ' ') && !errors.length,
      'language: back to English restores the original page exactly', errors.join(' | '));
    await page.click('#start-button');
    await page.click('#stop-button');
    report(await page.isVisible('#start-button'), 'top bar: Stop stops listening');
    await browser.close();
  }

  // 2. Permission denied. Headless Chromium has no permission prompt to refuse, so we
  //    make getUserMedia fail with the same error a real "Don't Allow" gives (NotAllowedError).
  {
    const { browser, page } = await openPage(['--use-fake-device-for-media-stream'], []);
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await page.click('#start-button');
    await page.waitForSelector('#message:not([hidden])', { timeout: 5000 });
    const text = await page.textContent('#message');
    report(text.includes('blocked'), 'permission denied (simulated) shows a message', text.slice(0, 70) + '…');
    report(await page.isEnabled('#start-button'), 'permission denied: Start can be tapped again');
    await browser.close();
  }

  // 3. No microphone at all.
  {
    const { browser, page } = await openPage(['--use-fake-ui-for-media-stream'], ['microphone']);
    await page.click('#start-button');
    await page.waitForSelector('#message:not([hidden])', { timeout: 5000 });
    const text = await page.textContent('#message');
    report(text.includes('No microphone') || text.includes("couldn't be started"), 'no microphone shows a message', text.slice(0, 70) + '…');
    await browser.close();
  }
} finally {
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
