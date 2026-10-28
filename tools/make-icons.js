// make-icons.js
// ------------------------------------------------------------
// Draws the app icon (a music note over a sound wave) as SVG and renders the
// PNG sizes phones need, using Chromium via Playwright (a developer tool,
// not part of the app). The PNGs are committed, so you only need to run this
// if you change the icon:  node tools/make-icons.js
//
//   icons/icon.svg               – the drawing (also used as the browser tab icon)
//   icons/icon-192.png, -512.png – home-screen icons (rounded corners)
//   icons/icon-maskable-512.png  – for Android, which cuts its own shape:
//                                  full-bleed background, drawing kept in the middle 80%
//   icons/apple-touch-icon.png   – 180×180 for iPhone, which rounds the corners itself,
//                                  so it's full-bleed too
// ------------------------------------------------------------

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = new URL('../icons/', import.meta.url).pathname;

// rounded: rounded-corner background · scale: how big the drawing is (1 = full)
function iconSvg({ rounded, scale }) {
  const offset = (512 * (1 - scale)) / 2;
  // Colours: the same deep blue gradient and glass highlight as the tuner's
  // lit tile (.hero-tile in glass.css), like the other apps' full-bleed icons.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#4f8dff"/>
      <stop offset="0.55" stop-color="#2f4fd0"/>
      <stop offset="1" stop-color="#1b1f6b"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0.6" y2="0.6">
      <stop offset="0" stop-color="#fff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#shine)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M56 336 C 112 256, 152 256, 200 336 S 288 416, 336 336 S 416 256, 456 336" fill="none" stroke="#a9c4ff" stroke-opacity="0.85" stroke-width="22" stroke-linecap="round"/>
    <ellipse cx="214" cy="338" rx="66" ry="48" transform="rotate(-22 214 338)" fill="#ffffff"/>
    <rect x="256" y="104" width="24" height="226" rx="6" fill="#ffffff"/>
    <path d="M268 104 C 312 126, 372 150, 360 236 C 348 194, 306 184, 280 180 Z" fill="#ffffff"/>
  </g>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
const normal = iconSvg({ rounded: true, scale: 1 });
const fullBleed = iconSvg({ rounded: false, scale: 0.8 });
writeFileSync(`${OUT}icon.svg`, normal);

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `${OUT}${file}`, omitBackground: true });
  console.log(`wrote icons/${file}`);
}
await render(normal, 192, 'icon-192.png');
await render(normal, 512, 'icon-512.png');
await render(fullBleed, 512, 'icon-maskable-512.png');
await render(fullBleed, 180, 'apple-touch-icon.png');
await browser.close();
