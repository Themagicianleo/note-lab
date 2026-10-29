// i18n-check.js
// ------------------------------------------------------------
// Finds English text that has no Chinese translation yet (js/i18n-zh.js).
// Run with:  node tools/i18n-check.js          (needs Playwright, like browser-test.js)
//            node tools/i18n-check.js --keys   (print the missing keys as JSON, for adding them)
//
// 1. Static text: every key the translator looks up on index.html and
//    how-it-works.html (including hidden sections).
// 2. Changing text: switches to Chinese, then opens every tab and Lab tool
//    with a test sound as the microphone, and lists text still in English.
// ------------------------------------------------------------

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8126;
const server = spawn(process.execPath, [`${ROOT}tools/serve.js`], { env: { ...process.env, PORT: String(PORT) } });
await new Promise((resolve) => server.stdout.once('data', resolve));

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${ROOT}test-audio/key/singer-G-major.wav`] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
const page = await context.newPage();
const missing = new Set();
try {
  for (const path of ['', 'how-it-works.html']) {
    await page.goto(`http://localhost:${PORT}/${path}`);
    const keys = await page.evaluate(async () => {
      const i18n = await import('/js/i18n.js');
      return i18n.collectKeys().filter((k) => /[A-Za-z]{2}/.test(k) && i18n.lookup(k) === null);
    });
    keys.forEach((k) => missing.add(k));
  }

  // Changing text, in Chinese.
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.setItem('note-lab-lang', 'zh'));
  await page.reload();
  const leftovers = new Set();
  const grab = async () => {
    const found = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const el = n.parentElement;
        if (!el || el.closest('script,style,svg,pre,em,cite') || !el.offsetParent) continue; // pre: formulas; em: book titles
        const text = n.data.replace(/\s+/g, ' ').trim();
        if (/[\u4e00-\u9fff]/.test(text)) continue; // already Chinese (English names inside are fine)
        // English words of 3+ letters, ignoring units and names kept as they are.
        const words = text.replace(/\b(Hz|kHz|dBFS|dB|YIN|FFT|RT60|CSV|Note Lab|MIDI|A4|ms|EN|Sabine|Eyring|Schroeder|RMS|SPL|Krumhansl|Kessler|Schmuckler)\b/g, '').match(/[A-Za-z]{3,}/g);
        if (words) out.push(el.closest('[id]')?.id + ': ' + (el.innerHTML.replace(/\s+/g, ' ').trim()));
      }
      return out;
    });
    found.forEach((f) => leftovers.add(f));
  };
  await grab();
  await page.click('#start-button');
  await page.waitForTimeout(1500);
  for (const tab of ['tuner', 'voice', 'spectrum', 'ear', 'lab']) {
    await page.click(`#tab-${tab}`);
    await page.waitForTimeout(1500);
    await grab();
  }
  const tools = await page.$$eval('[id^="lab-open-"]', (els) => els.map((e) => e.id));
  for (const id of tools) {
    await page.click('#tab-lab');
    if (await page.isVisible('#lab-back')) await page.click('#lab-back');
    await page.click(`#${id}`);
    await page.waitForTimeout(1200);
    await grab();
  }
  await page.click('#open-settings');
  await grab();
  await page.click('#close-settings');
  await page.goto(`http://localhost:${PORT}/how-it-works.html`);
  await grab();
  console.log(`Static texts without a translation: ${missing.size}`);
  if (process.argv.includes('--keys')) console.log(JSON.stringify([...missing], null, 1));
  else for (const k of missing) console.log(`  ${k.slice(0, 140)}`);
  console.log(`\nVisible English left after switching to Chinese: ${leftovers.size}`);
  for (const k of leftovers) console.log(`  ${k.slice(0, 160)}`);
} finally {
  await browser.close();
  server.kill();
}
