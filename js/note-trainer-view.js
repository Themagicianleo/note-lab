// note-trainer-view.js
// ------------------------------------------------------------
// "Guess the note": the app plays a note, you pick its name.
// Optionally it plays C4 first as a reference. Most people can't name
// notes without one ("perfect pitch" is rare), but with a reference you can
// learn to judge the distance from it. After answering, tapping any answer
// button plays that note, so you can compare.
// ------------------------------------------------------------

import { NOTE_SETS, makeNoteQuestion, noteLetter, noteLabel, ScoreBook } from './ear-training.js';
import { renderAnswerButtons, markAnswers, clearMarks, renderScoreTable, preferPlaybackAudio } from './trainer-ui.js';
import { NOTE_NAMES, nameToNoteNumber } from './pitch-math.js';

const byId = (id) => document.getElementById(id);
const REFERENCE_NOTE = 60; // C4

export function createNoteTrainer({ player, getA4, isListening, savedScores, onScoresChanged }) {
  const el = {
    set: byId('note-set'),
    reference: byId('note-reference'),
    play: byId('note-play'),
    replay: byId('note-replay'),
    answers: byId('note-answers'),
    feedback: byId('note-feedback'),
    stats: byId('note-stats'),
    reset: byId('note-reset'),
  };
  const book = new ScoreBook(savedScores);
  let question = null;   // { note }
  let answered = false;

  // The answer choices for the current set: unique note names, in C-to-B order.
  const options = () => {
    const letters = new Set(NOTE_SETS[el.set.value].notes.map(noteLetter));
    return NOTE_NAMES.filter((n) => letters.has(n)).map((n) => ({ key: n, label: n }));
  };

  function playQuestion() {
    preferPlaybackAudio(isListening());
    const a4 = getA4();
    let start = 0;
    if (el.reference.checked) {
      player.playNote(REFERENCE_NOTE, { start: 0, duration: 0.8 }, a4);
      start = 1.3; // a short gap after the reference
    }
    player.playNote(question.note, { start, duration: 1 }, a4);
  }

  function newQuestion() {
    question = makeNoteQuestion(el.set.value, question?.note);
    answered = false;
    clearMarks(el.answers);
    el.feedback.textContent = el.reference.checked ? 'Listen: C4 (reference), then the mystery note…' : 'Listen…';
    el.replay.disabled = false;
    el.play.textContent = 'Next note';
    playQuestion();
  }

  function pick(letter) {
    if (!question) return;
    if (answered) {
      // After answering, buttons play that note so you can compare.
      const octave = Math.floor(question.note / 12) - 1;
      player.playNote(nameToNoteNumber(letter, octave), { duration: 0.8 }, getA4());
      return;
    }
    answered = true;
    const right = noteLetter(question.note);
    const correct = letter === right;
    book.record(right, correct);
    markAnswers(el.answers, right, letter);
    el.feedback.textContent = correct
      ? `Correct: ${noteLabel(question.note)}! Tap any note to hear it, or "Next note".`
      : `Not quite: it was ${noteLabel(question.note)} (you chose ${letter}). Tap the notes to compare them.`;
    showStats();
    onScoresChanged(book.toJSON());
  }

  function showStats() {
    renderScoreTable(el.stats, NOTE_NAMES.map((n) => ({ key: n, label: n })), book);
  }

  function rebuild() {
    renderAnswerButtons(el.answers, options(), pick);
    question = null;
    el.replay.disabled = true;
    el.play.textContent = 'Play a note';
    el.feedback.textContent = '';
  }

  el.play.addEventListener('click', newQuestion);
  el.replay.addEventListener('click', () => question && playQuestion());
  el.set.addEventListener('change', rebuild);
  el.reset.addEventListener('click', () => {
    book.reset();
    showStats();
    onScoresChanged(book.toJSON());
  });

  rebuild();
  showStats();
  return { reset: () => { book.reset(); showStats(); } };
}
