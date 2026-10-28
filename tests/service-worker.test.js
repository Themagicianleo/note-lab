// Checks that sw.js saves every file the app needs for offline use, and only
// files that exist. (Forgetting a new file here would break offline use.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const sw = readFileSync(`${root}sw.js`, 'utf8');
// Every file in a folder, including sub-folders, as "folder/sub/file" paths.
const filesIn = (folder) => readdirSync(`${root}${folder}`, { recursive: true })
  .map((f) => `${folder}/${f.split('\\').join('/')}`)
  .filter((f) => !statSync(`${root}${f}`).isDirectory());

const listed = [...sw.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every app file is in the offline list', () => {
  const appFiles = [
    'index.html', 'how-it-works.html', 'manifest.json',
    ...readdirSync(`${root}css`).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`),
    ...filesIn('js').filter((f) => f.endsWith('.js')),
    ...readdirSync(`${root}icons`).map((f) => `icons/${f}`),
  ];
  for (const file of appFiles) assert.ok(listed.includes(file), `${file} is missing from FILES in sw.js`);
});

test('every file in the offline list exists', () => {
  for (const file of listed.filter((f) => f !== './')) assert.ok(existsSync(`${root}${file}`), `${file} is listed in sw.js but doesn't exist`);
});

test('manifest points at existing icons and uses relative paths (works on GitHub Pages)', () => {
  const manifest = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} should be relative`);
    assert.ok(existsSync(`${root}${icon.src}`), `${icon.src} doesn't exist`);
  }
});
