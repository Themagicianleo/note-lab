// listening-view.js
// ------------------------------------------------------------
// The page for the critical-listening exercises (Train tab). One page serves
// all of them: the exercises themselves are described in
// js/listening-games.js, the sound processing is in js/listening-dsp.js.
//
// A question: two versions of the same loop play in step and you switch
// between them (js/loop-player.js), then tap an answer. After answering you
// can tap any answer to hear what it would have sounded like.
//
// Only scores are saved (on this device). A track you choose is read inside
// the page, used while the page is open, and never uploaded or stored.
// ------------------------------------------------------------

import {
  gameById, GAMES, ROUND_LENGTH, optionsFor, makeQuestion, judge, variantClip, scoreKey, scoreRows,
  chanceOfRight, passMark, GameProgress, dayKey, addRoundToday, dayStreak,
} from './listening-games.js';
import { SOURCES, SOURCE_PEAK, pinkSource, makeStems, mixStems, sourceFromChannels } from './listening-sources.js';
import { peakOf, scaleClip, normalisePeak } from './listening-dsp.js';
import { createLoopPlayer } from './loop-player.js';
import { renderAnswerButtons, renderScoreTable, preferPlaybackAudio } from './trainer-ui.js';

const byId = (id) => document.getElementById(id);
// Let the page draw (e.g. "Preparing the sound…") before a calculation that takes a moment.
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 30));

export function createListening({ player, isListening, stopListening, saved, onChanged }) {
  const el = {
    micWarning: byId('ls-mic-warning'), stopMic: byId('ls-stop-mic'),
    ask: byId('ls-ask'), progress: byId('ls-progress'),
    level: byId('ls-level'), source: byId('ls-source'), sourceField: byId('ls-source-field'), about: byId('ls-about'),
    fileRow: byId('ls-file-row'), file: byId('ls-file'), fileStatus: byId('ls-file-status'),
    play: byId('ls-play'), a: byId('ls-ab-a'), b: byId('ls-ab-b'),
    answers: byId('ls-answers'), feedback: byId('ls-feedback'), summary: byId('ls-summary'), next: byId('ls-next'),
    best: byId('ls-best'), stats: byId('ls-stats'), reset: byId('ls-reset'), tips: byId('ls-tips'),
  };

  // ---------- saved progress ----------
  const progress = {};
  const loadProgress = (data) => { for (const g of GAMES) progress[g.id] = new GameProgress(g, data?.games?.[g.id]); };
  loadProgress(saved);
  let days = saved?.days && typeof saved.days === 'object' ? saved.days : {};
  const save = () => onChanged({ games: Object.fromEntries(GAMES.map((g) => [g.id, progress[g.id].toJSON()])), days });

  // ---------- sounds ----------
  const loop = createLoopPlayer(() => player.ensureContext());
  let built = { sampleRate: 0 };  // the built-in sounds, made once per sample rate
  let fileSource = null;          // { clip, mono, name, sampleRate }
  function builtIn(sampleRate) {
    if (built.sampleRate !== sampleRate) built = { sampleRate };
    return built;
  }
  // The sound for the chosen source, or a message saying why there is none.
  function getSource(sampleRate) {
    const cache = builtIn(sampleRate);
    if (sourceKind === 'tone') return { sampleRate };
    if (sourceKind === 'file') {
      if (!fileSource || fileSource.sampleRate !== sampleRate) return { message: 'Choose an audio file first.' };
      if (game.needsStereo && fileSource.mono) return { message: 'This track is mono (both sides are the same), so its width can\'t be changed. Choose a stereo track.' };
      return { sampleRate, clip: fileSource.clip };
    }
    if (sourceKind === 'pink') {
      const key = game.stereoNoise ? 'stereoPink' : 'pink';
      cache[key] = cache[key] || pinkSource(sampleRate, { stereo: Boolean(game.stereoNoise) });
      return { sampleRate, clip: cache[key] };
    }
    cache.stems = cache.stems || makeStems(sampleRate);
    if (sourceKind === 'drums') {
      cache.drums = cache.drums || normalisePeak(cache.stems.drums, SOURCE_PEAK);
      return { sampleRate, clip: cache.drums };
    }
    cache.mix = cache.mix || mixStems(cache.stems);
    return { sampleRate, clip: cache.mix, stems: cache.stems };
  }

  // ---------- state ----------
  let game = GAMES[0];
  let levelIndex = 0;
  let sourceKind = 'pink';
  let src = null;
  let round = null;       // { asked, right, question, answered, finished, clips, scale, keys: [a, b] }
  let nextLevel = null;   // the level to move to after a passed round
  let shown = false;

  const currentProgress = () => progress[game.id];
  const labelOf = (key) => (optionsFor(game, levelIndex).find((o) => o.key === key) || { label: key }).label;

  // ---------- drawing ----------
  function showLevels() {
    const p = currentProgress();
    el.level.replaceChildren(...game.levels.map((_, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `Level ${i + 1}${p.rounds[i]?.passed ? ' ✓' : ''}`;
      return option;
    }));
    el.level.value = String(levelIndex);
  }

  function showBest() {
    const r = currentProgress().rounds[levelIndex];
    const mark = passMark(chanceOfRight(game, levelIndex));
    el.best.textContent = `Level ${levelIndex + 1}: ${r ? `best ${r.best} of ${ROUND_LENGTH}` : 'not played yet'} · ` +
      (r?.passed ? 'passed' : `${mark} of ${ROUND_LENGTH} needed to pass`);
    renderScoreTable(el.stats, scoreRows(game), currentProgress().book);
  }

  function showAnswers() {
    renderAnswerButtons(el.answers, optionsFor(game, levelIndex), pick);
    el.answers.classList.toggle('long', optionsFor(game, levelIndex).some((o) => o.label.length > 8)); // wider buttons
    setAnswersEnabled(false);
  }
  const setAnswersEnabled = (on) => { for (const b of el.answers.querySelectorAll('button')) b.disabled = !on; };

  // Which version is sounding: the switch, and (after answering) the answer buttons.
  function showSelected() {
    const key = loop.playing ? loop.selected : null;
    const [a, b] = round ? round.keys : [null, null];
    el.a.setAttribute('aria-pressed', String(Boolean(round) && (key ? key === a : round.last === a)));
    el.b.setAttribute('aria-pressed', String(Boolean(round) && (key ? key === b : round.last === b)));
    el.play.textContent = loop.playing ? 'Stop' : 'Play';
    for (const button of el.answers.querySelectorAll('button')) {
      button.classList.toggle('sounding', Boolean(round && round.answered && key && button.dataset.key === key));
    }
  }

  // Back to "no round running" (also when the level or the sound is changed).
  function toIdle() {
    loop.stop();
    round = null;
    nextLevel = null;
    el.about.textContent = game.levels[levelIndex].about;
    const which = game.mode === 'which';
    el.a.textContent = which ? 'A' : 'Original';
    el.b.textContent = which ? 'B' : 'Changed';
    el.a.disabled = el.b.disabled = el.play.disabled = true;
    el.progress.hidden = true;
    el.feedback.textContent = '';
    el.summary.textContent = '';
    el.next.textContent = 'Start round';
    el.next.disabled = false;
    el.fileRow.hidden = sourceKind !== 'file';
    showAnswers();
    showSelected();
    showBest();
  }

  // ---------- a round ----------
  async function startRound() {
    const context = player.ensureContext();
    preferPlaybackAudio(isListening());
    if (nextLevel !== null) { levelIndex = nextLevel; currentProgress().level = levelIndex; save(); showLevels(); }
    toIdle();
    const first = getSource(context.sampleRate);
    if (first.message) { el.feedback.textContent = first.message; return; }
    el.next.disabled = true;
    el.feedback.textContent = 'Preparing the sound…';
    await nextFrame();
    if (!shown) return;
    src = first;
    round = { asked: 0, right: 0 };
    nextQuestion();
  }

  function nextQuestion() {
    const question = makeQuestion(game, levelIndex);
    const keys = game.mode === 'which' ? ['A', 'B'] : ['original', question.answer];
    const clips = { [keys[0]]: variantClip(game, src, question, keys[0]), [keys[1]]: variantClip(game, src, question, keys[1]) };
    // Never let a version reach the top of the range (that would add distortion
    // of its own). If one would, all versions of this question are turned down together.
    const peak = Math.max(peakOf(clips[keys[0]]), peakOf(clips[keys[1]]));
    const scale = peak > 0.98 ? 0.98 / peak : 1;
    if (scale < 1) for (const k of keys) clips[k] = scaleClip(clips[k], scale);
    Object.assign(round, { question, keys, clips, scale, answered: false, last: keys[0], asked: round.asked + 1 });

    for (const b of el.answers.querySelectorAll('button')) b.classList.remove('right', 'wrong', 'close');
    setAnswersEnabled(true);
    el.a.disabled = el.b.disabled = el.play.disabled = false;
    el.progress.hidden = false;
    el.progress.textContent = `${round.asked} / ${ROUND_LENGTH}`;
    el.feedback.textContent = game.mode === 'which' ? 'Switch between A and B, then choose.' : 'Switch between Original and Changed, then choose.';
    el.next.textContent = 'Next question';
    el.next.disabled = true;
    loop.start(clips, keys[0]);
    showSelected();
  }

  // Hear one version: a switch position, or (after answering) any answer.
  function listenTo(key) {
    if (!round) return;
    if (!round.clips[key]) {
      const clip = variantClip(game, src, round.question, key);
      round.clips[key] = round.scale < 1 ? scaleClip(clip, round.scale) : clip;
    }
    round.last = key;
    if (!loop.playing) loop.start(round.clips, key);
    else { loop.add(key, round.clips[key]); loop.select(key); }
    showSelected();
  }

  function pick(key) {
    if (!round) return;
    if (round.answered) { listenTo(key); return; } // after answering, the buttons let you compare
    const { question } = round;
    const result = judge(game, levelIndex, question.answer, key);
    round.answered = true;
    if (result.right) round.right++;
    currentProgress().book.record(scoreKey(game, question), result.right);

    for (const b of el.answers.querySelectorAll('button')) {
      b.classList.toggle('right', b.dataset.key === question.answer);
      b.classList.toggle('wrong', b.dataset.key === key && !result.right);
      b.classList.toggle('close', b.dataset.key === key && result.right && key !== question.answer);
    }
    const right = labelOf(question.answer);
    el.feedback.textContent = game.mode === 'which'
      ? (result.right ? `Correct: it was ${right}.` : `Not quite: it was ${right}.`)
      : (key === question.answer ? `Correct: ${right}.`
        : result.right ? `Close enough: it was ${right} (you chose ${labelOf(key)}, one band away).`
          : `Not quite: it was ${right} (you chose ${labelOf(key)}).`) + ' Tap any answer to hear it.';

    if (round.asked >= ROUND_LENGTH) finishRound();
    else el.next.disabled = false;
    showBest();
    showSelected();
    save();
  }

  function finishRound() {
    const { mark, passed } = currentProgress().finishRound(levelIndex, round.right);
    days = addRoundToday(days, dayKey(new Date()));
    round.finished = true;
    const canMoveUp = passed && levelIndex + 1 < game.levels.length;
    nextLevel = canMoveUp ? levelIndex + 1 : null;
    el.summary.textContent = `Round finished: ${round.right} of ${ROUND_LENGTH} right. ` +
      (passed ? `Level ${levelIndex + 1} passed.` : `${mark} are needed to pass level ${levelIndex + 1}.`);
    el.next.textContent = canMoveUp ? `Start level ${levelIndex + 2}` : 'New round';
    el.next.disabled = false;
    showLevels();
  }

  // ---------- your own track ----------
  async function loadFile(file) {
    if (!file) return;
    toIdle();
    el.fileStatus.textContent = 'Reading the file…';
    try {
      const context = player.ensureContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => decoded.getChannelData(i));
      const made = sourceFromChannels(channels, decoded.sampleRate);
      if (made.silent) throw new Error('silent');
      fileSource = { ...made, sampleRate: decoded.sampleRate };
      const seconds = Math.round(made.clip.channels[0].length / decoded.sampleRate);
      el.fileStatus.textContent = `Using ${seconds} s from ${file.name}${made.mono ? ' (mono)' : ''}. Read on this device; nothing uploaded.`;
    } catch {
      fileSource = null;
      el.fileStatus.textContent = 'This file couldn\'t be read as audio. Try an MP3, M4A or WAV file.';
    }
  }

  // ---------- events ----------
  el.next.addEventListener('click', () => {
    if (!round || round.finished) startRound();
    else if (round.answered) nextQuestion();
  });
  el.play.addEventListener('click', () => {
    if (!round) return;
    if (loop.playing) loop.stop(); else loop.start(round.clips, round.last);
    showSelected();
  });
  el.a.addEventListener('click', () => round && listenTo(round.keys[0]));
  el.b.addEventListener('click', () => round && listenTo(round.keys[1]));
  el.level.addEventListener('change', () => {
    levelIndex = Number(el.level.value);
    currentProgress().level = levelIndex;
    save();
    toIdle();
  });
  el.source.addEventListener('change', () => { sourceKind = el.source.value; toIdle(); });
  el.file.addEventListener('change', () => loadFile(el.file.files[0]));
  el.reset.addEventListener('click', () => {
    progress[game.id] = new GameProgress(game);
    levelIndex = 0;
    save();
    showLevels();
    toIdle();
  });
  el.stopMic.addEventListener('click', () => stopListening());

  function refresh() {
    el.micWarning.hidden = !isListening();
  }

  return {
    // Open one exercise (called by the Train menu).
    open(id) {
      game = gameById(id);
      shown = true;
      levelIndex = currentProgress().level;
      el.ask.textContent = game.ask;
      el.tips.innerHTML = game.tips;
      const kinds = game.sources.filter((k) => SOURCES[k]);
      el.source.replaceChildren(...kinds.map((k) => {
        const option = document.createElement('option');
        option.value = k;
        option.textContent = SOURCES[k].label;
        return option;
      }));
      el.sourceField.hidden = kinds.length < 2;
      sourceKind = game.sources[0];
      if (!fileSource) el.fileStatus.textContent = 'Choose a track from this device. About 12 seconds of it are used. It\'s read here in the page and never uploaded.';
      showLevels();
      toIdle();
      refresh();
    },
    // Leaving the page: stop the sound; an unfinished round is dropped.
    hide() {
      shown = false;
      if (round && !round.finished) toIdle(); else loop.stop();
      showSelected();
    },
    // Back in view after another tab or Settings covered the page.
    resume() { shown = true; },
    refresh,
    // For the Train menu: "2/6" levels passed, and the line about today.
    badge: (id) => `${progress[id].passedLevels}/${gameById(id).levels.length}`,
    todayText() {
      const today = Number(days[dayKey(new Date())]) || 0;
      const streak = dayStreak(days);
      if (!today && !streak) return '';
      return `Today: ${today} ${today === 1 ? 'round' : 'rounds'}` + (streak > 1 ? ` · ${streak} days in a row` : '');
    },
    // "Reset all training scores" on the Settings page.
    reset() {
      loadProgress(null);
      days = {};
      levelIndex = 0;
      if (shown) { showLevels(); toIdle(); }
    },
  };
}
