// singback-view.js
// ------------------------------------------------------------
// "Sing it back": the app plays a target note, then listens while you sing
// it, and shows how many cents off you were.
//
// Order matters: the app does NOT listen while the target is playing,
// otherwise the microphone would hear the app's own tone and "score" that.
// It starts judging 0.25 s after the tone has fully faded.
// ------------------------------------------------------------

import { SING_TARGETS, SingBackJudge, describeCentsOff, noteLabel, pick } from './ear-training.js';
import { noteNumberToFrequency, frequencyToNote, formatNote } from './pitch-math.js';
import { preferPlaybackAudio } from './trainer-ui.js';

const byId = (id) => document.getElementById(id);
const LISTEN_DELAY_MS = 250;

// Whole cents with a sign: 12.4 → "+12", −0.3 → "0" (never "+0" or "−0").
function signedCents(cents) {
  const rounded = Math.round(cents) || 0; // "|| 0" turns −0 into 0
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}
const HISTORY_LENGTH = 5;

export function createSingBack({ player, getA4, isListening, startListening, savedResults, onResultsChanged }) {
  const el = {
    range: byId('singback-range'),
    needMic: byId('singback-need-mic'),
    startMic: byId('singback-start-mic'),
    play: byId('singback-play'),
    replay: byId('singback-replay'),
    target: byId('singback-target'),
    live: byId('singback-live'),
    bar: byId('singback-bar'),
    result: byId('singback-result'),
    stats: byId('singback-stats'),
    history: byId('singback-history'),
    reset: byId('singback-reset'),
  };
  let results = Array.isArray(savedResults) ? savedResults.filter((r) => Number.isFinite(r?.cents)) : [];
  let targetNote = null;
  let judge = null;
  let listenFrom = Infinity; // page time (ms) after which singing counts

  function playTarget() {
    preferPlaybackAudio(isListening());
    const ctx = player.ensureContext();
    const endsAt = player.playNote(targetNote, { duration: 1.2 }, getA4());
    // Convert the audio clock's end time into page time.
    listenFrom = performance.now() + (endsAt - ctx.currentTime) * 1000 + LISTEN_DELAY_MS;
    judge = new SingBackJudge(noteNumberToFrequency(targetNote, getA4()), { a4: getA4() });
    el.target.textContent = `Target: ${noteLabel(targetNote)} (${noteNumberToFrequency(targetNote, getA4()).toFixed(1)} Hz)`;
    el.live.textContent = 'Listen to the target…';
    el.result.textContent = '';
    setBar(null);
  }

  function newTarget() {
    targetNote = pick(SING_TARGETS[el.range.value].filter((n) => n !== targetNote));
    el.replay.disabled = false;
    el.play.textContent = 'Next target';
    playTarget();
  }

  // Bar from −100 to +100 cents; null hides the marker.
  function setBar(cents) {
    el.bar.hidden = cents === null;
    if (cents !== null) el.bar.style.left = `${50 + Math.max(-50, Math.min(50, cents / 2))}%`;
  }

  function finish(result) {
    if (!result.heard) {
      el.live.textContent = '';
      el.result.textContent = 'No steady note heard. Sing a little louder and hold the note for about a second, then try "Play again".';
      return;
    }
    const sung = frequencyToNote(result.frequency, getA4());
    const octaveNote = result.octaves === 0 ? ''
      : ` You sang ${Math.abs(result.octaves)} octave${Math.abs(result.octaves) > 1 ? 's' : ''} ${result.octaves < 0 ? 'lower' : 'higher'}. That's fine if the target is outside your comfortable range; scored ignoring the octave.`;
    const cents = result.centsIgnoringOctave;
    el.live.textContent = `You sang ${formatNote(sung)}`;
    el.result.textContent = `${describeCentsOff(cents)} (${signedCents(cents)} cents from ${noteLabel(targetNote)}).${octaveNote}`;
    setBar(cents);
    results = [{ target: noteLabel(targetNote), cents: Math.round(cents) }, ...results].slice(0, 50);
    showStats();
    onResultsChanged(results);
  }

  function showStats() {
    if (!results.length) {
      el.stats.textContent = 'No attempts yet.';
      el.history.replaceChildren();
      return;
    }
    const sizes = results.map((r) => Math.abs(r.cents));
    const average = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const within25 = sizes.filter((s) => s <= 25).length;
    el.stats.textContent = `${results.length} attempt${results.length === 1 ? '' : 's'} · average ${Math.round(average)} cents off · ${within25} within 25 cents`;
    // Built as plain text (not HTML), because these come from saved data.
    el.history.replaceChildren(...results.slice(0, HISTORY_LENGTH).map((r) => {
      const li = document.createElement('li');
      li.textContent = `${r.target}: ${signedCents(r.cents)} cents`;
      return li;
    }));
  }

  // Show or hide the "start the microphone first" part.
  function refresh() {
    const listening = isListening();
    el.needMic.hidden = listening;
    el.play.disabled = !listening;
    el.replay.disabled = !listening || targetNote === null;
  }

  el.startMic.addEventListener('click', () => startListening());
  el.play.addEventListener('click', newTarget);
  el.replay.addEventListener('click', () => targetNote !== null && playTarget());
  el.reset.addEventListener('click', () => {
    results = [];
    showStats();
    onResultsChanged(results);
  });

  showStats();
  refresh();

  return {
    refresh,
    rangeKey: () => el.range.value,
    setRangeKey(key) { if (SING_TARGETS[key]) el.range.value = key; },
    reset() { results = []; showStats(); },

    // Called by the app for every reading while this exercise is open.
    onReading(smoothedHz, now) {
      if (!judge || judge.result) return;
      if (now < listenFrom) return; // the target is still playing
      if (smoothedHz) {
        const cents = 1200 * Math.log2(smoothedHz / judge.targetHz);
        const folded = cents - 1200 * Math.round(cents / 1200);
        el.live.textContent = `Hearing ${formatNote(frequencyToNote(smoothedHz, getA4()))} · ${signedCents(folded)} cents from target`;
        setBar(folded);
      } else {
        el.live.textContent = 'Now sing the note and hold it for about a second…';
      }
      const result = judge.push(smoothedHz, now);
      if (result) finish(result);
    },
  };
}
