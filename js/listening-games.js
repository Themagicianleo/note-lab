// listening-games.js
// ------------------------------------------------------------
// The critical-listening exercises (Train tab): what each one changes in the
// sound, its levels, how questions are made and how answers are judged.
// No browser code, so all of it is tested in Node (tests/listening.test.js).
// The sound processing is in js/listening-dsp.js, the page in js/listening-view.js.
//
// Two kinds of exercise:
//   'identify': you can switch between the Original and a Changed version,
//               and say WHAT was changed (which frequency, how many dB, …).
//   'which':    you can switch between A and B. One of them (picked at
//               random) is processed; you say which. Used where the question
//               is "can you hear it at all?" (distortion, small pitch steps).
//
// A round is 10 questions. A level is passed with 8 right, or 9 when there
// are only two possible answers: with those marks, pure guessing passes less
// than 2 times in 100 (see passMark below).
// ------------------------------------------------------------

import { pick, ScoreBook } from './ear-training.js';
import {
  biquad, steepFilter, filterClip, applyGainDb, panClip, widthClip, compressClip, distortClip, tanhThd,
  echoClip, addReverb, matchRms, setRms, rmsOf, dbToGain, gainToDb, peakOf,
} from './listening-dsp.js';
import { mixStems, toneSource, STEM_NAMES } from './listening-sources.js';

export const ROUND_LENGTH = 10;

// ---------- labels ----------

// 63 → "63 Hz", 1000 → "1 kHz", 12500 → "12.5 kHz"
export const hzLabel = (hz) => (hz >= 1000 ? `${Number((hz / 1000).toFixed(2))} kHz` : `${hz} Hz`);
// 3 → "+3 dB", −1.5 → "−1.5 dB" (a real minus sign, as elsewhere in the app)
export const dbLabel = (db) => `${db > 0 ? '+' : '−'}${Math.abs(db)} dB`;
const panLabel = (p) => (p === 0 ? 'Centre' : `${p < 0 ? 'Left' : 'Right'} ${Math.abs(p)}%`);
const widthLabel = (w) => (w === 0 ? 'Mono' : w === 100 ? '100% (unchanged)' : `${w}%`);

// ---------- the frequency bands ----------
// Standard centre frequencies (ISO 266). 63 Hz – 16 kHz: below and above
// that, headphones and ears differ too much for a fair question.
export const OCTAVE_BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const WIDE_BANDS = [125, 500, 2000, 8000];
export const THIRD_OCTAVE_BANDS = [63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
const OCTAVE_Q = 1.41;  // a bell about one octave wide
const THIRD_Q = 4.32;   // about a third of an octave wide

const eqLevel = (gainDb, bands) => {
  const third = bands === THIRD_OCTAVE_BANDS;
  const spacing = bands === WIDE_BANDS ? 'two octaves apart' : third ? 'a third of an octave apart (one band off still counts)' : 'one octave apart';
  return { options: bands, gainDb, q: third ? THIRD_Q : OCTAVE_Q, tolerance: third ? 1 : 0,
    about: `${dbLabel(gainDb)} bell, Q ${third ? THIRD_Q : OCTAVE_Q} · ${bands.length} bands, ${spacing}` };
};
const eqGame = (extra) => ({
  group: 'frequency', mode: 'identify', sources: ['pink', 'mix', 'drums', 'file'],
  key: (hz) => String(hz), label: hzLabel,
  changed: (src, hz, level) => filterClip(src.clip, biquad('peaking', hz, src.clip.sampleRate, { q: level.q, gainDb: level.gainDb })),
  ...extra,
});

// ---------- filters ----------
// A filter answer is { type, hz }: lp = low-pass, hp = high-pass (both steep),
// hs / ls = a high / low shelf of +8 dB.
const F = (type, hz) => ({ type, hz });
const FILTER_NAMES = { lp: 'Low-pass', hp: 'High-pass', hs: 'High shelf +8 dB', ls: 'Low shelf +8 dB' };
const filterFor = (f, sampleRate) => (
  f.type === 'lp' ? steepFilter('lowpass', f.hz, sampleRate)
    : f.type === 'hp' ? steepFilter('highpass', f.hz, sampleRate)
      : biquad(f.type === 'hs' ? 'highshelf' : 'lowshelf', f.hz, sampleRate, { gainDb: 8 }));
const LOW_PASS = [1000, 2000, 4000, 8000, 12000].map((hz) => F('lp', hz));
const HIGH_PASS = [60, 120, 250, 500, 1000].map((hz) => F('hp', hz));

// ---------- compressor ----------
// Threshold 20 dB below the loudest sample, so every setting works hard and
// the differences are in the ratio, attack and release.
const COMP_THRESHOLD_BELOW_PEAK = 20;
const C = (ratio, attackMs = 1, releaseMs = 150) => ({ ratio, attackMs, releaseMs });
const compKey = (c) => `${c.ratio}:${c.attackMs}:${c.releaseMs}`;

// ---------- echo and reverb ----------
// The echo is half as loud as the sound (−6 dB), the reverb 8 dB below it.
// Depending on the rhythm, an echo can add a little more or less power at one
// delay time than another. Every answer is set to the same power (the sound
// plus an unrelated copy `gain` times as loud), so loudness can't give it away.
const ECHO_GAIN = 0.5;
const REVERB_DB = -8;
const sameAddedPower = (clip, dry, gain) => setRms(clip, rmsOf(dry) * Math.sqrt(1 + gain * gain));

// ---------- the exercises ----------

export const GAMES = [
  eqGame({
    id: 'eq-boost', title: 'EQ boost', summary: 'Find the boosted frequency', ask: 'Which frequency is boosted?',
    levels: [eqLevel(12, WIDE_BANDS), eqLevel(12, OCTAVE_BANDS), eqLevel(9, OCTAVE_BANDS), eqLevel(6, OCTAVE_BANDS), eqLevel(9, THIRD_OCTAVE_BANDS), eqLevel(6, THIRD_OCTAVE_BANDS)],
    tips: 'Switch between Original and Changed and ask where the extra sound sits. A rough guide: <strong>63–125 Hz</strong> boom and weight · <strong>250–500 Hz</strong> warmth, then boxiness or mud · <strong>1–2 kHz</strong> honky, nasal, like a telephone · <strong>4 kHz</strong> presence, then harshness · <strong>8 kHz</strong> sizzle and "s" sounds · <strong>16 kHz</strong> air. Pink noise is the fairest test; then try the music loop and your own tracks.',
  }),
  eqGame({
    id: 'eq-cut', title: 'EQ cut', summary: 'Find the missing frequency', ask: 'Which frequency is cut?',
    levels: [eqLevel(-12, WIDE_BANDS), eqLevel(-12, OCTAVE_BANDS), eqLevel(-9, OCTAVE_BANDS), eqLevel(-6, OCTAVE_BANDS), eqLevel(-9, THIRD_OCTAVE_BANDS)],
    tips: 'A cut is harder to hear than a boost. Listen for what goes missing when you switch to Changed, then check by switching back. The same bands apply: a hole at 250–500 Hz sounds thin or hollow, at 2–4 kHz distant and soft-edged, at 8 kHz less crisp.',
  }),
  {
    id: 'filters', group: 'frequency', mode: 'identify', sources: ['pink', 'mix', 'drums', 'file'],
    title: 'Filters', summary: 'Name the filter and its cutoff', ask: 'Which filter is on the changed sound?',
    key: (f) => `${f.type}:${f.hz}`,
    label: (f) => (f.type === 'lp' || f.type === 'hp' ? `${FILTER_NAMES[f.type]} ${hzLabel(f.hz)}` : FILTER_NAMES[f.type]),
    changed: (src, f) => filterClip(src.clip, filterFor(f, src.clip.sampleRate)),
    levels: [
      { options: [F('lp', 3000), F('hp', 300), F('hs', 4000), F('ls', 250)], about: 'Four very different filters' },
      { options: LOW_PASS, about: 'Low-pass (highs removed): find the cutoff' },
      { options: HIGH_PASS, about: 'High-pass (lows removed): find the cutoff' },
      { options: [...HIGH_PASS, ...LOW_PASS], about: 'Low-pass or high-pass, and the cutoff' },
    ],
    tips: 'A <strong>low-pass</strong> filter lets the lows pass and removes the highs above its cutoff: the sound gets duller. A <strong>high-pass</strong> removes the lows below its cutoff: thinner. A <strong>shelf</strong> turns everything above (high shelf) or below (low shelf) a frequency up by the same amount. The low-pass and high-pass here are steep: 24 dB per octave.',
  },
  {
    id: 'level', group: 'space', mode: 'identify', sources: ['pink', 'mix', 'drums', 'file'],
    title: 'Loudness', summary: 'Judge level changes in dB', ask: 'How much louder or quieter is the changed sound?',
    key: (db) => String(db), label: dbLabel,
    changed: (src, db) => applyGainDb(src.clip, db),
    levels: [
      { options: [-6, -3, 3, 6], about: '±3 or ±6 dB' },
      { options: [-4, -2, 2, 4], about: '±2 or ±4 dB' },
      { options: [-3, -2, -1, 1, 2, 3], about: '±1, ±2 or ±3 dB' },
      { options: [-2, -1, -0.5, 0.5, 1, 2], about: '±0.5, ±1 or ±2 dB' },
    ],
    tips: 'Set a comfortable volume and don\'t touch it during a round. With practice, about 1 dB can be heard on steady sound when switching back and forth; 0.5 dB is near the limit. Small level differences matter: of two otherwise identical sounds, the slightly louder one usually seems "better".',
  },
  {
    id: 'pan', group: 'space', mode: 'identify', sources: ['pink', 'drums', 'mix', 'file'],
    title: 'Panning', summary: 'Place a sound between your ears', ask: 'Where is the changed sound?',
    key: (p) => String(p), label: panLabel,
    reference: (src) => panClip(src.clip, 0),
    changed: (src, p) => panClip(src.clip, p / 100),
    levels: [
      { options: [-100, 0, 100], about: '3 positions' },
      { options: [-100, -50, 0, 50, 100], about: '5 positions' },
      { options: [-100, -67, -33, 0, 33, 67, 100], about: '7 positions' },
      { options: [-100, -75, -50, -25, 0, 25, 50, 75, 100], about: '9 positions' },
    ],
    tips: 'The sound is made mono and placed with an equal-power pan, so it is just as loud wherever it sits. Original is the centre. Positions near the centre are the hardest to tell apart. Spatial audio and head tracking must be off, or the positions are wrong.',
  },
  {
    id: 'width', group: 'space', mode: 'identify', sources: ['pink', 'mix', 'file'], stereoNoise: true, needsStereo: true,
    title: 'Stereo width', summary: 'Hear how wide the picture is', ask: 'How wide is the changed sound?',
    key: (w) => String(w), label: widthLabel,
    changed: (src, w) => widthClip(src.clip, w / 100),
    levels: [
      { options: [0, 50, 100], about: '3 widths' },
      { options: [0, 25, 50, 75, 100], about: '5 widths' },
      { options: [0, 25, 50, 75, 100, 125, 150], about: '7 widths' },
    ],
    tips: 'At 0% both ears get exactly the same sound and it sits in the middle of your head (mono). Wider settings spread it out towards your ears, and above 100% it is wider than the original. The loudness is kept the same, so listen to the size of the picture, not the volume.',
  },
  {
    id: 'mix', group: 'space', mode: 'identify', sources: ['mix'],
    title: 'Mix balance', summary: 'Spot which part changed level', ask: 'Which part of the mix was changed?',
    key: (stem) => stem, label: (stem) => STEM_NAMES[stem],
    changed: (src, stem, level) => mixStems(src.stems, { [stem]: level.changeDb }),
    levels: [6, 4, 3, 2, -4, -3].map((db) => ({ options: Object.keys(STEM_NAMES), changeDb: db, about: `One part is ${Math.abs(db)} dB ${db > 0 ? 'louder' : 'quieter'}` })),
    tips: 'The music loop has four parts: drums, bass, chords and melody. In Changed, one of them has been turned up or down. Switch back and forth and follow one part at a time.',
  },
  {
    id: 'compression', group: 'dynamics', mode: 'identify', sources: ['drums', 'mix', 'file'],
    title: 'Compression', summary: 'Hear ratio, attack and release', ask: 'How is the changed sound compressed?',
    key: compKey,
    label: (c, level) => (level.what === 'attack' ? `Attack ${c.attackMs} ms` : level.what === 'release' ? `Release ${c.releaseMs} ms` : c.ratio === 1 ? 'None' : `${c.ratio}:1`),
    changed: (src, c) => (c.ratio === 1 ? src.clip : matchRms(compressClip(src.clip, { ...c, thresholdDb: gainToDb(peakOf(src.clip)) - COMP_THRESHOLD_BELOW_PEAK }), src.clip)),
    levels: [
      { options: [C(1), C(10)], about: 'No compression, or 10:1' },
      { options: [C(1), C(3), C(10)], about: 'None, 3:1 or 10:1' },
      { options: [C(1), C(2), C(4), C(10)], about: 'None, 2:1, 4:1 or 10:1' },
      { options: [C(8, 0.5), C(8, 10), C(8, 60)], what: 'attack', about: 'Attack time, at 8:1' },
      { options: [C(8, 2, 40), C(8, 2, 200), C(8, 2, 1000)], what: 'release', about: 'Release time, at 8:1' },
    ],
    tips: 'A compressor turns loud moments down. Listen to the drum hits: with heavy compression they lose their punch, and the quiet sound between them (tails, hi-hats) comes up. A slow attack lets the start of each hit through; a long release keeps the level held down after it. Original and Changed are matched in loudness, so only the dynamics differ.',
  },
  {
    id: 'distortion', group: 'dynamics', mode: 'which', sources: ['mix', 'drums', 'file'],
    title: 'Distortion', summary: 'Detect ever cleaner distortion', ask: 'Which one is distorted?',
    changed: (src, drive) => matchRms(distortClip(src.clip, drive), src.clip),
    levels: [6, 3, 1.5, 0.75, 0.4].map((drive) => ({ value: drive, about: `Drive ×${drive}: about ${(100 * tanhThd(drive)).toFixed(drive < 1 ? 1 : 0)}% distortion on a full-level sine` })),
    tips: 'One of A and B has been pushed into a soft clipper, which adds harmonics that weren\'t there: the sound gets grittier, the bass buzzes and loud hits flatten. Both are matched in loudness. At the last levels this is at the edge of what anyone can hear.',
  },
  {
    id: 'delay', group: 'dynamics', mode: 'identify', sources: ['drums', 'mix', 'file'],
    title: 'Delay time', summary: 'Estimate an echo in milliseconds', ask: 'How late is the echo?',
    key: (ms) => String(ms), label: (ms) => `${ms} ms`,
    changed: (src, ms) => sameAddedPower(echoClip(src.clip, ms, ECHO_GAIN), src.clip, ECHO_GAIN),
    levels: [
      { options: [50, 150, 400], about: '3 echo times' },
      { options: [30, 60, 120, 240, 480], about: '5 echo times' },
      { options: [20, 40, 80, 120, 160, 240, 320, 480], about: '8 echo times' },
    ],
    tips: 'One echo, half as loud as the sound. Long times are heard as a separate repeat. Under about 30–40 ms the echo fuses with the sound: you hear a change of tone colour (hollow, comb-like) instead of a repeat.',
  },
  {
    id: 'reverb', group: 'dynamics', mode: 'identify', sources: ['drums', 'mix', 'file'],
    title: 'Reverb time', summary: 'Judge how long the tail lasts', ask: 'How long is the reverb?',
    key: (s) => String(s), label: (s) => `${s} s`,
    changed: (src, s) => sameAddedPower(addReverb(src.clip, s, REVERB_DB), src.clip, dbToGain(REVERB_DB)),
    levels: [
      { options: [0.3, 1, 3], about: '3 reverb times' },
      { options: [0.3, 0.6, 1.2, 2.4], about: '4 reverb times' },
      { options: [0.2, 0.4, 0.6, 0.9, 1.3, 1.8, 2.5], about: '7 reverb times' },
    ],
    tips: 'The times are RT60: how long the reverb takes to die away by 60 dB (the Lab\'s RT60 tool estimates it for a real room). The reverb is equally loud at every setting, so judge the length of the tail after each drum hit, not how much reverb there is.',
  },
  {
    id: 'pitch', group: 'music', mode: 'which', sources: ['tone'],
    title: 'Pitch difference', summary: 'Hear a few cents apart', ask: 'Which one is higher?',
    // Each question uses a new note between A3 and A5, so you can't learn one tone by heart.
    setup: (random) => ({ baseHz: 220 * Math.pow(2, 2 * random()) }),
    reference: (src, level, q) => toneSource(src.sampleRate, q.extra.baseHz),
    changed: (src, cents, level, q) => toneSource(src.sampleRate, q.extra.baseHz * Math.pow(2, cents / 1200)),
    levels: [50, 25, 12, 6, 3].map((cents) => ({ value: cents, about: `${cents} cents apart (100 cents = one semitone)` })),
    tips: 'A and B are the same tone a few cents apart. Switch while it sounds and listen for which way the pitch steps. With practice most people manage 10–25 cents; under 5 cents is hard for anyone.',
  },
];

export const gameById = (id) => GAMES.find((g) => g.id === id);

export const GROUPS = [
  { id: 'frequency', title: 'Frequency' },
  { id: 'space', title: 'Level and space' },
  { id: 'dynamics', title: 'Dynamics and effects' },
  { id: 'music', title: 'Pitch and music' },
];

// ---------- questions and answers ----------

const optionKey = (game, value) => (game.key ? game.key(value) : String(value));

// The answer buttons of a level: [{ key, label }].
export function optionsFor(game, levelIndex) {
  if (game.mode === 'which') return [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }];
  const level = game.levels[levelIndex];
  return level.options.map((value) => ({ key: optionKey(game, value), label: game.label(value, level) }));
}

// A new question. `random` returns 0 ≤ x < 1 (tests pass a fixed one).
// Every answer is equally likely every time, also the one just asked:
// "it won't be the same twice" would be a clue that has nothing to do with listening.
export function makeQuestion(game, levelIndex, random = Math.random) {
  const level = game.levels[levelIndex];
  const extra = game.setup ? game.setup(random) : null;
  if (game.mode === 'which') return { level: levelIndex, answer: random() < 0.5 ? 'A' : 'B', value: level.value, extra };
  const value = pick(level.options, random);
  return { level: levelIndex, answer: optionKey(game, value), value, extra };
}

// Is the picked answer right? On levels with a tolerance (third-octave
// bands), one step either side counts. `steps` is how far off it was.
export function judge(game, levelIndex, answerKey, pickedKey) {
  if (game.mode === 'which') return { right: answerKey === pickedKey, steps: answerKey === pickedKey ? 0 : 1 };
  const keys = optionsFor(game, levelIndex).map((o) => o.key);
  const steps = Math.abs(keys.indexOf(answerKey) - keys.indexOf(pickedKey));
  return { right: steps <= (game.levels[levelIndex].tolerance || 0), steps };
}

// The sound for one switch position or answer button.
//   'which' games:    key 'A' or 'B' (the processed one is question.answer)
//   'identify' games: key 'original', or an answer key (question.answer is the Changed sound)
export function variantClip(game, src, question, key) {
  const level = game.levels[question.level];
  const reference = () => (game.reference ? game.reference(src, level, question) : src.clip);
  if (game.mode === 'which') return key === question.answer ? game.changed(src, level.value, level, question) : reference();
  if (key === 'original') return reference();
  const value = level.options.find((v) => optionKey(game, v) === key);
  return game.changed(src, value, level, question);
}

// What a saved score is filed under, and its name in the results table.
// 'identify': per answer (so you see which bands you miss); 'which': per level.
export const scoreKey = (game, question) => (game.mode === 'which' ? `L${question.level + 1}` : question.answer);
export function scoreRows(game) {
  if (game.mode === 'which') return game.levels.map((_, i) => ({ key: `L${i + 1}`, label: `Level ${i + 1}` }));
  const rows = new Map();
  game.levels.forEach((level, i) => { for (const o of optionsFor(game, i)) if (!rows.has(o.key)) rows.set(o.key, o); });
  return [...rows.values()];
}

// ---------- passing a level ----------

// The chance that a pure guess is counted right.
export function chanceOfRight(game, levelIndex) {
  const count = optionsFor(game, levelIndex).length;
  const tolerance = game.levels[levelIndex].tolerance || 0;
  return Math.min(1, (2 * tolerance + 1) / count);
}

const choose = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i; return c; };
// The chance of getting `score` or more right out of `questions` by guessing (binomial).
export function chanceOfScore(score, p, questions = ROUND_LENGTH) {
  let sum = 0;
  for (let k = score; k <= questions; k++) sum += choose(questions, k) * Math.pow(p, k) * Math.pow(1 - p, questions - k);
  return sum;
}
// Right answers needed to pass: at least 8 of 10, and enough that guessing
// gets there less than 2 times in 100 (9 of 10 when there are two answers).
export function passMark(p, questions = ROUND_LENGTH) {
  let mark = Math.ceil(questions * 0.8);
  while (mark < questions && chanceOfScore(mark, p, questions) >= 0.02) mark++;
  return mark;
}

// ---------- progress (saved on the device: numbers only, never audio) ----------

export class GameProgress {
  constructor(game, saved = {}) {
    this.game = game;
    this.book = new ScoreBook(saved?.book || {});
    this.rounds = {}; // level index → { played, best, passed }
    for (const [i, r] of Object.entries(saved?.rounds || {})) {
      if (game.levels[i] && Number.isFinite(r?.played) && Number.isFinite(r?.best)) this.rounds[i] = { played: r.played, best: r.best, passed: Boolean(r.passed) };
    }
    this.level = game.levels[saved?.level] ? Number(saved.level) : 0;
  }

  // Record a finished round. Returns { mark, passed }.
  finishRound(levelIndex, score) {
    const mark = passMark(chanceOfRight(this.game, levelIndex));
    const r = (this.rounds[levelIndex] ||= { played: 0, best: 0, passed: false });
    r.played++;
    r.best = Math.max(r.best, score);
    const passed = score >= mark;
    if (passed) r.passed = true;
    return { mark, passed };
  }

  // How many of the levels have been passed.
  get passedLevels() {
    return Object.values(this.rounds).filter((r) => r.passed).length;
  }

  toJSON() {
    return { level: this.level, book: this.book.toJSON(), rounds: this.rounds };
  }
}

// ---------- days practised ----------

// "2026-03-09" for a Date, in the device's own time zone.
export const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Add one finished round to today's count (keeps the last 90 days).
export function addRoundToday(days, today) {
  const next = { ...days, [today]: (Number(days?.[today]) || 0) + 1 };
  const keep = Object.keys(next).sort().slice(-90);
  return Object.fromEntries(keep.map((k) => [k, next[k]]));
}

// How many days in a row have a round, ending today (or yesterday, if today
// has none yet: the streak isn't lost until the day is over).
export function dayStreak(days, now = new Date()) {
  const has = (d) => Number(days?.[dayKey(d)]) > 0;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!has(d)) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (has(d)) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
