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

try {
  // 1. A fake microphone playing each test file.
  for (const [file, expected] of CASES) {
    const { browser, page, errors } = await openPage([
      '--use-fake-ui-for-media-stream',      // auto-accept the permission prompt
      '--use-fake-device-for-media-stream',  // use a fake microphone...
      `--use-file-for-fake-audio-capture=${SIGNALS}${file}`, // ...that plays this file
      '--autoplay-policy=no-user-gesture-required',
    ], ['microphone']);
    await page.click('#start-button');
    await page.waitForSelector('#tuner:not([hidden])', { timeout: 5000 });

    // Read the display 8 times over ~1.6 s and take the most common text.
    const seen = {};
    await page.waitForTimeout(600);
    for (let i = 0; i < 8; i++) {
      const text = await page.textContent('#note-details');
      seen[text] = (seen[text] || 0) + 1;
      await page.waitForTimeout(200);
    }
    const [mostCommon] = Object.entries(seen).sort((a, b) => b[1] - a[1])[0];
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
