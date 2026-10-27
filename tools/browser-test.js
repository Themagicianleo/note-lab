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
  `--use-file-for-fake-audio-capture=${SIGNALS}${file}`, // ...that plays this file
  '--autoplay-policy=no-user-gesture-required',
], ['microphone']);

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
      await page.fill('#custom-min', '200');
      await page.fill('#custom-max', '250');
      await page.click('#custom-apply');
      const error = await page.textContent('#range-error');
      report(await page.isVisible('#range-error') && error.includes('1.5'), 'voice: too-narrow custom range is refused', `"${error}"`);
      await page.fill('#custom-max', '500');
      await page.click('#custom-apply');
      const info = await page.textContent('#tech-info');
      report(!(await page.isVisible('#range-error')) && info.includes('200–500 Hz'), 'voice: valid custom range is applied', info);
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
