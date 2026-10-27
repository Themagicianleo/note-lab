// interval-trainer-view.js
// ------------------------------------------------------------
// "Name the interval": the app plays two notes, you name the gap.
// An interval is the distance between two notes, counted in semitones
// (piano keys): e.g. a perfect 5th is 7 semitones, C up to G.
// ------------------------------------------------------------

import { INTERVALS, DEFAULT_INTERVALS, intervalBySemitones, makeIntervalQuestion, noteLabel, ScoreBook } from './ear-training.js';
import { renderAnswerButtons, markAnswers, clearMarks, renderScoreTable, preferPlaybackAudio } from './trainer-ui.js';

const byId = (id) => document.getElementById(id);

export function createIntervalTrainer({ player, getA4, isListening, savedScores, onScoresChanged }) {
  const el = {
    choices: byId('interval-choices'),
    play: byId('interval-play'),
    replay: byId('interval-replay'),
    answers: byId('interval-answers'),
    feedback: byId('interval-feedback'),
    stats: byId('interval-stats'),
    reset: byId('interval-reset'),
  };
  const book = new ScoreBook(savedScores);
  let question = null;
  let answered = false;

  // One checkbox per interval, ticked for the gentle default set.
  el.choices.innerHTML = '';
  for (const i of INTERVALS) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${i.semitones}"${DEFAULT_INTERVALS.includes(i.semitones) ? ' checked' : ''}> ${i.name} <span class="small">(${i.semitones})</span>`;
    el.choices.append(label);
  }
  const allowed = () => [...el.choices.querySelectorAll('input:checked')].map((c) => Number(c.value));
  const direction = () => document.querySelector('input[name="interval-direction"]:checked').value;

  function playQuestion() {
    preferPlaybackAudio(isListening());
    const a4 = getA4();
    if (question.together) {
      player.playNote(question.first, { duration: 1.4 }, a4);
      player.playNote(question.second, { duration: 1.4 }, a4);
    } else {
      player.playNote(question.first, { duration: 0.8 }, a4);
      player.playNote(question.second, { start: 0.9, duration: 0.9 }, a4);
    }
  }

  function newQuestion() {
    const choices = allowed();
    if (choices.length < 2) {
      el.feedback.textContent = 'Tick at least two intervals to practise.';
      return;
    }
    question = makeIntervalQuestion(choices, direction());
    answered = false;
    clearMarks(el.answers);
    el.feedback.textContent = 'Listen…';
    el.replay.disabled = false;
    el.play.textContent = 'Next interval';
    playQuestion();
  }

  function pick(semitones) {
    if (!question || answered) return;
    answered = true;
    const right = intervalBySemitones(question.semitones);
    const correct = semitones === question.semitones;
    book.record(right.short, correct);
    markAnswers(el.answers, String(question.semitones), String(semitones));
    const notes = `${noteLabel(question.first)} → ${noteLabel(question.second)}`;
    el.feedback.textContent = (correct ? `Correct: ${right.name} (${notes}).` : `Not quite: it was a ${right.name} (${notes}), you chose ${intervalBySemitones(semitones).name}.`) +
      ` Memory aid: ${right.hint}.`;
    showStats();
    onScoresChanged(book.toJSON());
  }

  function showStats() {
    renderScoreTable(el.stats, INTERVALS.map((i) => ({ key: i.short, label: i.name })), book);
  }

  function rebuild() {
    const options = allowed().map((s) => ({ key: String(s), label: intervalBySemitones(s).name }));
    renderAnswerButtons(el.answers, options, (key) => pick(Number(key)));
    question = null;
    el.replay.disabled = true;
    el.play.textContent = 'Play an interval';
  }

  el.choices.addEventListener('change', rebuild);
  el.play.addEventListener('click', newQuestion);
  el.replay.addEventListener('click', () => question && playQuestion());
  el.reset.addEventListener('click', () => {
    book.reset();
    showStats();
    onScoresChanged(book.toJSON());
  });

  rebuild();
  showStats();
  return { reset: () => { book.reset(); showStats(); } };
}
