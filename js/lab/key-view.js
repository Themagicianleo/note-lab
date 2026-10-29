// key-view.js
// ------------------------------------------------------------
// Lab tool: Key finder. Listens to a singer (or a song through a speaker)
// and estimates the musical key with the Krumhansl–Schmuckler method
// (js/key-finder.js), using readings from js/key-listener.js.
// It says how sure it is, and always shows the runner-up and the relative key.
// ------------------------------------------------------------

import { KeyListener } from '../key-listener.js';
import { relativeKey, keyName, PITCH_CLASS_NAMES, SURE_GAP, PROBABLY_GAP } from '../key-finder.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const UPDATE_MS = 500;      // recalculate the key twice a second
const MIN_SECONDS = 8;      // before this, "keep going"
// How sure: SURE_GAP and PROBABLY_GAP, see js/key-finder.js.

export function createKeyTool({ getA4 }) {
  const el = {
    modes: { singer: byId('key-mode-singer'), song: byId('key-mode-song') },
    result: byId('key-result'), sub: byId('key-sub'), sure: byId('key-sure'),
    heard: byId('key-heard'), heardBar: byId('key-heard-bar'),
    candidates: byId('key-candidates'), tuning: byId('key-tuning'),
    canvas: byId('key-canvas'), reset: byId('key-reset'), pause: byId('key-pause'),
  };
  let mode = 'singer';
  let listener = new KeyListener({ mode, a4: getA4() });
  let paused = false;
  let lastUpdate = 0;
  let lastTime = 0;
  let latest = null;

  function restart() {
    listener = new KeyListener({ mode, a4: getA4(), ...(mode === 'song' ? { gateDb: -60 } : {}) });
    latest = null;
    lastTime = 0;
    show();
  }

  function show() {
    const r = latest;
    const heard = r ? r.heard : 0;
    el.heard.textContent = `Heard ${heard.toFixed(0)} s of ${mode === 'singer' ? 'clear singing' : 'music'} (keeps the last 2 minutes)`;
    el.heardBar.style.width = `${Math.min(100, (100 * heard) / 30)}%`;

    if (!r || heard < MIN_SECONDS || !r.scores.length || r.scores[0].r <= 0) {
      el.result.textContent = '…';
      el.sub.textContent = paused ? 'Paused.' : mode === 'singer' ? 'Keep singing: at least a few phrases (20–30 s is best).' : 'Keep the music playing: a verse or chorus (20–30 s is best).';
      el.sure.textContent = '';
      el.candidates.innerHTML = '';
      el.tuning.textContent = '';
      drawBars(r ? r.histogram : new Array(12).fill(0), null);
      return;
    }
    const [best, second, third] = r.scores;
    const gap = best.r - second.r;
    const rel = relativeKey(best);
    if (gap >= SURE_GAP) {
      el.result.textContent = best.name;
      el.sure.textContent = 'Clear match';
    } else if (gap >= PROBABLY_GAP) {
      el.result.textContent = `Probably ${best.name}`;
      el.sure.textContent = `Fairly close to ${second.name}`;
    } else {
      el.result.textContent = `${best.name} or ${second.name}?`;
      el.sure.textContent = 'Not sure yet: these two fit almost equally well. Keep listening.';
    }
    el.sub.textContent = `${keyName(rel.tonic, rel.mode)} uses exactly the same notes. If the music feels "settled" on ${PITCH_CLASS_NAMES[rel.tonic]} rather than ${PITCH_CLASS_NAMES[best.tonic]}, it's that key instead.`;
    el.candidates.innerHTML = '';
    for (const k of [best, second, third]) {
      const li = document.createElement('li');
      li.textContent = `${k.name}: r = ${k.r.toFixed(2)}`;
      el.candidates.append(li);
    }
    const off = Math.round(r.offset);
    el.tuning.textContent = `${mode === 'singer' ? 'Singer' : 'Recording'} tuning: about ${off > 0 ? '+' : ''}${off} cents from A4 = ${getA4()} Hz (allowed for when naming the notes).`;
    drawBars(r.histogram, best);
  }

  // 12 bars: how much of each note name was heard. The best key's scale notes are coloured.
  function drawBars(histogram, key) {
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const most = Math.max(...histogram, 1e-12);
    const slot = width / 12;
    const inScale = (pc) => {
      if (!key) return false;
      const degree = (pc - key.tonic + 12) % 12;
      return (key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).includes(degree);
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let pc = 0; pc < 12; pc++) {
      const h = ((height - 22) * histogram[pc]) / most;
      ctx.fillStyle = key && pc === key.tonic ? c.orange : inScale(pc) ? c.blue : c.muted;
      ctx.globalAlpha = inScale(pc) || !key ? 1 : 0.45;
      ctx.fillRect(pc * slot + 4, height - 18 - h, slot - 8, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text;
      ctx.fillText(PITCH_CLASS_NAMES[pc], pc * slot + slot / 2, height - 2);
    }
  }

  function setMode(next) {
    mode = next;
    for (const [m, button] of Object.entries(el.modes)) button.setAttribute('aria-pressed', String(m === mode));
    restart();
  }

  for (const [m, button] of Object.entries(el.modes)) button.addEventListener('click', () => setMode(m));
  el.reset.addEventListener('click', restart);
  el.pause.addEventListener('click', () => {
    paused = !paused;
    lastTime = 0;
    el.pause.textContent = paused ? 'Continue' : 'Pause';
    el.pause.setAttribute('aria-pressed', String(paused));
    show();
  });

  return {
    id: 'key',
    title: 'Key finder',
    subtitle: 'Which key is someone singing in?',
    summary: 'Listen to a singer, or a song through a speaker, and estimate its key.',
    needsMic: true,
    windowSize: 8192,
    show() { if (listener.a4 !== getA4()) restart(); else show(); },
    hide() {},
    onSamples(buffer, sampleRate, now) {
      if (paused) return;
      // Real time since the last reading (capped, e.g. after the app was in the
      // background), so slow screen updates don't undercount what was heard.
      const dt = lastTime ? Math.min(0.25, (now - lastTime) / 1000) : 1 / 60;
      lastTime = now;
      listener.push(buffer, sampleRate, dt);
      if (now - lastUpdate > UPDATE_MS) {
        lastUpdate = now;
        latest = listener.result();
        show();
      }
    },
  };
}
