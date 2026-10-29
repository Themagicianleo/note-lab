// Older iPhone/iPad Safari (e.g. iPadOS 15) stops the WHOLE app if one file
// uses JavaScript it doesn't know. These checks keep the app's own code clear
// of the newer features that caused that once (Object.hasOwn, regex look-behind).
// The tests themselves run in Node, so they may use anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const files = [
  ...readdirSync(`${ROOT}js`).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
  ...readdirSync(`${ROOT}js/lab`).filter((f) => f.endsWith('.js')).map((f) => `js/lab/${f}`),
  'sw.js',
];
// [what, pattern, the Safari version that first supports it]
const NEWER = [
  ['regex look-behind (?<= / (?<!', /\(\?<[=!]/, 'Safari 16.4'],
  ['Object.hasOwn', /Object\.hasOwn\(/, 'Safari 15.4'],
  ['Array/String .at()', /[\w\])]\.at\(-?\d/, 'Safari 15.4'],
  ['structuredClone', /structuredClone\(/, 'Safari 15.4'],
  ['.findLast()', /\.findLast(Index)?\(/, 'Safari 15.4'],
];

for (const file of files) {
  test(`${file} avoids JavaScript that older iPhone/iPad Safari can't run`, () => {
    const code = readFileSync(`${ROOT}${file}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const [what, re, since] of NEWER) assert.ok(!re.test(code), `${file} uses ${what} (needs ${since})`);
  });
}
