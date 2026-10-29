// i18n.js
// ------------------------------------------------------------
// The language switch: English (the app is written in English) or
// Simplified Chinese (简体中文). The Chinese texts are in js/i18n-zh.js.
//
// How it works, without changing every line of the app:
//   • Static text: the page is walked once. A paragraph, label, button… whose
//     contents are only text and simple formatting (<strong>, <em>, <code>…)
//     is looked up as a whole (its HTML), so a sentence with a bold word is
//     translated as one sentence. Other elements are walked into, and each
//     piece of text is looked up on its own. Attributes read aloud by screen
//     readers (aria-label, title, placeholder, alt) are translated too.
//   • Changing text: the app keeps writing English (e.g. "Clarity 87%").
//     A MutationObserver sees each change and translates it straight away,
//     using exact texts and patterns with numbers in them.
//   • Switching back to English puts every original text back.
// Anything without a translation simply stays in English.
// The language choice is saved on this device (it's a setting, not audio).
// ------------------------------------------------------------

import { ZH, ZH_PATTERNS, ZH_VOICE } from './i18n-zh.js';

export const LANG_KEY = 'note-lab-lang';
const INLINE = new Set(['STRONG', 'EM', 'B', 'I', 'CODE', 'BR', 'SUB', 'SUP', 'SPAN', 'A', 'KBD', 'SMALL', 'ABBR']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'CANVAS', 'TEXTAREA', 'INPUT', 'SELECT', 'PRE']); // PRE: formulas keep their layout (and stay as written)
const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'];

export const normalise = (text) => text.replace(/\s+/g, ' ').trim();

// The saved language, or the device's language the first time.
export function savedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'zh' || v === 'en') return v;
  } catch { /* private mode: fall through */ }
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

// Compile the patterns once: "Clarity {}%" → /^Clarity (.+?)%$/.
const escape = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
const compiled = ZH_PATTERNS.map(([en, zh]) => [new RegExp(`^${en.split('{}').map(escape).join('(.*?)')}$`), zh]);

// Translate one normalised English text, or return null.
//   1. an exact text;
//   2. a pattern: each {} in the Chinese gets the matching part, in order, or
//      {1} {2}… a numbered part (Chinese word order often differs); each part
//      is itself translated if it can be (so "G major" inside a sentence works);
//   3. several sentences joined together: each sentence, if every one is known;
//   4. a readout made of parts joined by " · " (e.g. "E4 · 330.0 Hz · +2 cents"):
//      each part on its own.
export function lookup(text) {
  if (Object.hasOwn(ZH, text)) return ZH[text];
  for (const [re, zh] of compiled) {
    const m = text.match(re);
    if (m) {
      let i = 0;
      const part = (n) => { const p = m[n] ?? ''; return lookup(p) ?? p; };
      return zh.replace(/\{(\d?|v)\}/g, (_, d) => {
        if (d === 'v') { const p = m[++i] ?? ''; return ZH_VOICE[p] ?? part(i); } // a voice type
        return part(d ? Number(d) : ++i);
      });
    }
  }
  // Several messages joined into one ("Enter the volume. Add a surface."): each sentence, if all are known.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  if (sentences.length > 1) {
    const done = sentences.map((p) => lookup(p));
    if (done.every((d) => d !== null)) return done.join('');
  }
  if (text.includes(' · ')) {
    const parts = text.split(' · ');
    const done = parts.map((p) => lookup(p));
    if (done.some((d) => d !== null)) return parts.map((p, k) => done[k] ?? p).join(' · ');
  }
  return null;
}

// Translate an English text for code that draws on a canvas (no DOM to watch).
let current = 'en';
export const t = (text) => (current === 'zh' ? lookup(normalise(text)) ?? text : text);
export const lang = () => current;

// ---------- walking the page ----------

const originalText = new WeakMap();  // text node → its English
const originalHtml = new WeakMap();  // element → its English inner HTML
const originalAttr = new WeakMap();  // element → { attribute: English }
let busy = false;                    // true while we change the page ourselves

function isLeafBlock(el) {
  if (!el.firstElementChild) return false;
  for (const child of el.querySelectorAll('*')) {
    if (!INLINE.has(child.tagName) || child.id) return false;
  }
  return normalise(el.textContent) !== '';
}

function translateText(node) {
  const key = normalise(node.data);
  if (!key) return;
  const zh = lookup(key);
  if (zh === null) return;
  const lead = node.data.match(/^\s*/)[0];
  const tail = node.data.match(/\s*$/)[0];
  originalText.set(node, node.data);
  node.data = lead + zh + tail;
}

function translateAttributes(el) {
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const zh = lookup(normalise(value));
    if (zh === null) continue;
    const saved = originalAttr.get(el) || {};
    saved[name] = value;
    originalAttr.set(el, saved);
    el.setAttribute(name, zh);
  }
}

function walk(el) {
  if (SKIP.has(el.tagName)) {
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT') translateAttributes(el);
    if (el.tagName === 'SELECT') for (const option of el.options) walk(option);
    return;
  }
  translateAttributes(el);
  if (isLeafBlock(el)) {
    const zh = lookup(normalise(el.innerHTML));
    if (zh !== null) {
      originalHtml.set(el, el.innerHTML);
      el.innerHTML = zh;
      return;
    }
  }
  for (const node of [...el.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node);
    else if (node.nodeType === Node.ELEMENT_NODE) walk(node);
  }
}

function restore(el) {
  if (originalHtml.has(el)) { el.innerHTML = originalHtml.get(el); originalHtml.delete(el); }
  const attrs = originalAttr.get(el);
  if (attrs) { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); originalAttr.delete(el); }
  for (const node of [...el.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE && originalText.has(node)) { node.data = originalText.get(node); originalText.delete(node); }
    else if (node.nodeType === Node.ELEMENT_NODE) restore(node);
  }
}

// ---------- watching for changes ----------

const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
  if (busy) return;
  busy = true;
  for (const r of records) {
    if (r.type === 'characterData') translateText(r.target);
    else if (r.type === 'attributes') translateAttributes(r.target);
    else if (r.target.nodeType === Node.ELEMENT_NODE) {
      // New children: translate the parent as a whole if it's a simple paragraph, else the new nodes.
      const parent = r.target;
      originalHtml.delete(parent); // the app replaced its contents: the saved English is out of date
      if (isLeafBlock(parent) && lookup(normalise(parent.innerHTML)) !== null) walk(parent);
      else for (const node of r.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) translateText(node);
        else if (node.nodeType === Node.ELEMENT_NODE) walk(node);
      }
    }
  }
  observer.takeRecords(); // our own changes above: don't process them again
  busy = false;
});

// Switch the whole page (and future changes) to a language.
export function applyLang(next, root = document.body) {
  current = next;
  document.documentElement.lang = next === 'zh' ? 'zh-Hans' : 'en';
  busy = true;
  if (next === 'zh') {
    walk(root);
    document.title = lookup(document.title) ?? document.title;
    observer?.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ATTRIBUTES });
  } else {
    observer?.disconnect();
    restore(root);
    document.title = document.title === lookup('Note Lab') ? 'Note Lab' : (Object.entries(ZH).find(([, zh]) => zh === document.title)?.[0] ?? document.title);
  }
  observer?.takeRecords();
  busy = false;
}

// Hook up a switch button: shows the OTHER language's name; tapping switches and saves.
export function setUpLangSwitch(button, onChange = () => {}) {
  const show = () => { button.textContent = current === 'zh' ? 'EN' : '中文'; };
  button.addEventListener('click', () => {
    const next = current === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem(LANG_KEY, next); } catch { /* not saved; still switches */ }
    applyLang(next);
    show();
    onChange(next);
  });
  show();
}

// For finding untranslated text (tools/i18n-check.js): every key the walker would look up.
export function collectKeys(root = document.body) {
  const keys = new Set();
  const visit = (el) => {
    if (SKIP.has(el.tagName)) {
      if (el.tagName === 'SELECT') for (const o of el.options) visit(o);
      for (const name of ATTRIBUTES) if (el.getAttribute(name)) keys.add(normalise(el.getAttribute(name)));
      return;
    }
    for (const name of ATTRIBUTES) if (el.getAttribute(name)) keys.add(normalise(el.getAttribute(name)));
    if (isLeafBlock(el)) { keys.add(normalise(el.innerHTML)); return; }
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) { const k = normalise(node.data); if (k) keys.add(k); }
      else if (node.nodeType === Node.ELEMENT_NODE) visit(node);
    }
  };
  visit(root);
  return [...keys];
}
