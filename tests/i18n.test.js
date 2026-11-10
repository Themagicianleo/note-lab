// Tests for the language switch (js/i18n.js) and the Chinese texts (js/i18n-zh.js).
// The page-walking part needs a browser (tools/browser-test.js checks it);
// the lookup rules and the dictionary itself are checked here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup, normalise } from '../js/i18n.js';
import { ZH, ZH_PATTERNS, ZH_VOICE } from '../js/i18n-zh.js';

test('exact texts are found; unknown texts give null (they stay English)', () => {
  assert.equal(lookup('Start listening'), '开始聆听');
  assert.equal(lookup('Something the dictionary has never seen'), null);
});

test('patterns fill in the changing parts, translating them too', () => {
  assert.equal(lookup('Clarity 87%'), '清晰度 87%');
  assert.equal(lookup('+12 cents'), '+12 音分');
  assert.equal(lookup('Probably G major'), '可能是 G 大调');
});

test('numbered parts allow a different word order', () => {
  // "{} of your {} semitones overlap it" → "你的 {2} 个半音中有 {1} 个与它重叠"
  assert.equal(lookup('19 of your 24 semitones overlap it'), '你的 24 个半音中有 19 个与它重叠');
});

test('voice types: "Bass" alone is the EQ band (低音), in the voice-type sentence it is 男低音', () => {
  assert.equal(lookup('Bass'), '低音');
  assert.equal(lookup('Closest typical range: Bass (your whole range is inside it); next: Baritone. A rough guide, not a diagnosis.'),
    '最接近的典型音域：男低音（你的整个音域都在其中）；其次：男中音。仅供粗略参考，不是诊断。');
});

test('readouts joined with " · " are translated part by part', () => {
  assert.equal(lookup('E4 · 330.0 Hz · +2 cents'), 'E4 · 330.0 Hz · +2 音分');
  assert.equal(lookup('Echo cancellation: off · Noise suppression: on'), '回声消除：关 · 噪声抑制：开');
});

test('several known sentences joined together are translated one by one', () => {
  assert.equal(lookup('Enter the room volume in m³ (or copy it from Room modes). Add at least one surface with its area and absorption coefficients.'),
    ZH['Enter the room volume in m³ (or copy it from Room modes).'] + ZH['Add at least one surface with its area and absorption coefficients.']);
});

test('Train tab messages: the answer inside the sentence is translated too, and nothing is swallowed', () => {
  assert.equal(lookup('Not quite: it was High shelf +8 dB (you chose Low-pass 3 kHz). Tap any answer to hear it.'), '不太对：是 高频搁架 +8 dB（你选的是 低通 3 kHz）。点按任意答案即可试听。');
  assert.equal(lookup('Level 2: best 9 of 10 · passed'), '第 2 级：最好成绩 10 题答对 9 题 · 已通过');
  assert.equal(lookup('Level 1: not played yet · 9 of 10 needed to pass'), '第 1 级：还没练过 · 10 题答对 9 题才能通过');
  assert.equal(lookup('Round finished: 7 of 10 right. 8 are needed to pass level 1.'), '本轮结束：10 题答对 7 题。通过第 1 级需要答对 8 题。');
  assert.equal(lookup('+12 dB bell, Q 1.41 · 4 bands, two octaves apart'), '+12 dB 钟形，Q 1.41 · 4 个频段，相隔两个八度');
});

test('normalise squeezes whitespace like the page walker', () => {
  assert.equal(normalise('  a\n   b  '), 'a b');
});

// ---------- the dictionary itself ----------

const tags = (html) => (html.match(/<\/?[a-z]+/gi) || []).map((t) => t.toLowerCase()).sort().join(' ');

test('every Chinese paragraph keeps exactly the same HTML tags as its English', () => {
  for (const [en, zh] of Object.entries(ZH)) assert.equal(tags(zh), tags(en), `tags differ for: ${en.slice(0, 60)}`);
});

test('every key is already normalised (or the walker could never find it)', () => {
  for (const en of Object.keys(ZH)) assert.equal(en, normalise(en), en.slice(0, 60));
});

test('every pattern\'s Chinese uses only parts that exist in its English', () => {
  for (const [en, zh] of ZH_PATTERNS) {
    const parts = en.split('{}').length - 1;
    const tokens = zh.match(/\{(\d?|v)\}/g) || [];
    assert.ok(parts > 0, `no {} in pattern: ${en}`);
    for (const tok of tokens) {
      const n = Number(tok.slice(1, -1));
      if (n) assert.ok(n <= parts, `{${n}} but only ${parts} parts: ${en}`);
    }
    if (!tokens.some((tok) => /\d/.test(tok))) assert.ok(tokens.length <= parts, `too many {} in: ${zh}`);
  }
});

test('no translation is empty, and voice types are all there', () => {
  for (const [en, zh] of Object.entries(ZH)) assert.ok(zh.trim(), en);
  assert.deepEqual(Object.keys(ZH_VOICE).sort(), ['Baritone', 'Bass', 'Contralto', 'Mezzo-soprano', 'Soprano', 'Tenor']);
});
