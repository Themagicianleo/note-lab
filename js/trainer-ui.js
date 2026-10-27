// trainer-ui.js
// ------------------------------------------------------------
// Small page helpers shared by the ear-training views: answer buttons,
// score tables, and the iPhone audio hint.
// ------------------------------------------------------------

// Replace the contents of `container` with one button per option.
// options: [{ key, label }]. onPick(key) is called when one is tapped.
export function renderAnswerButtons(container, options, onPick) {
  container.innerHTML = '';
  for (const { key, label } of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer';
    button.textContent = label;
    button.dataset.key = key;
    button.addEventListener('click', () => onPick(key));
    container.append(button);
  }
}

// Mark the right answer (and the wrong pick, if any) with colours.
export function markAnswers(container, rightKey, pickedKey) {
  for (const button of container.querySelectorAll('button.answer')) {
    button.classList.toggle('right', button.dataset.key === rightKey);
    button.classList.toggle('wrong', button.dataset.key === pickedKey && pickedKey !== rightKey);
  }
}

export function clearMarks(container) {
  for (const button of container.querySelectorAll('button.answer')) button.classList.remove('right', 'wrong');
}

// A table of attempts and accuracy per key, in the order given.
// rows: [{ key, label }], book: a ScoreBook.
export function renderScoreTable(table, rows, book) {
  const asked = rows.filter((r) => book.data[r.key]);
  if (!asked.length) {
    table.innerHTML = '<tr><td>No answers yet.</td></tr>';
    return;
  }
  const body = asked.map(({ key, label }) => {
    const { attempts, correct } = book.data[key];
    const percent = Math.round((100 * correct) / attempts);
    return `<tr><th scope="row">${label}</th><td>${correct} / ${attempts}</td><td><span class="score-bar" style="--p:${percent}%"></span> ${percent}%</td></tr>`;
  });
  const { attempts, correct } = book.totals;
  table.innerHTML =
    '<thead><tr><th scope="col">Answer</th><th scope="col">Right</th><th scope="col">Accuracy</th></tr></thead>' +
    `<tbody>${body.join('')}</tbody>` +
    `<tfoot><tr><th scope="row">Total</th><td>${correct} / ${attempts}</td><td>${Math.round((100 * correct) / attempts)}%</td></tr></tfoot>`;
}

// On iPhone, the ring/silent switch can mute web audio. Safari 16.4+ has an
// "Audio Session" setting that lets sound play anyway; older versions don't.
// This is best effort: if it's not supported, the hint on the page applies.
export function preferPlaybackAudio(listening) {
  try {
    if (navigator.audioSession && !listening) navigator.audioSession.type = 'playback';
  } catch {
    // not supported: nothing to do
  }
}
