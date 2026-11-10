// train-menu.js
// ------------------------------------------------------------
// The Train tab: a menu of exercises in groups, one shown at a time (the
// same idea as the Lab's menu, js/lab/lab.js).
//
// items: [{ id, group, title, summary, panel, badge?, wide?, soundHint?, show?, hide?, resume? }]
//   panel: the id of the page element to show for this exercise (several
//          exercises may share one page, as the critical-listening ones do)
//   badge(): a short text for the tile's corner, e.g. "2/6" levels passed
//   show() / hide(): opening and leaving the exercise; hide() also runs when
//   another tab or Settings covers it, and resume() when it is back in view
// ------------------------------------------------------------

const byId = (id) => document.getElementById(id);

export function createTrainMenu({ groups, items, onChange }) {
  const el = { home: byId('ear-home'), menu: byId('ear-menu'), toolbar: byId('ear-toolbar'), back: byId('ear-back'), hint: byId('ear-sound-hint'), today: byId('ear-today') };
  const byItemId = Object.fromEntries(items.map((i) => [i.id, i]));
  const badges = new Map();
  let current = null;

  const makeTile = (item) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `card train-tile${item.wide ? ' wide' : ''}`;
    tile.id = `ear-open-${item.id}`;
    // (The id keeps the title and the summary as two separate texts for the language switch.)
    tile.innerHTML = `<strong id="ear-title-${item.id}">${item.title}</strong><span class="small muted">${item.summary}</span>`;
    if (item.badge) {
      const badge = document.createElement('span');
      badge.className = 'pill train-badge';
      tile.append(badge);
      badges.set(item.id, badge);
    }
    tile.addEventListener('click', () => open(item.id));
    return tile;
  };

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'train-group';
    if (group.title) section.innerHTML = `<h2>${group.title}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'train-grid';
    grid.append(...items.filter((i) => i.group === group.id).map(makeTile));
    section.append(grid);
    el.menu.append(section);
  }

  function showPanels() {
    for (const item of items) byId(item.panel).hidden = true;
    if (current) byId(current.panel).hidden = false;
    el.home.hidden = Boolean(current);
    el.toolbar.hidden = !current;
    el.hint.hidden = !(current && current.soundHint); // the iPhone silent-switch hint
  }

  function open(id) {
    if (current) current.hide?.();
    current = byItemId[id];
    showPanels();
    current.show?.();
    window.scrollTo({ top: 0 });
    onChange();
  }

  function close() {
    if (current) current.hide?.();
    current = null;
    showPanels();
    refreshBadges();
    window.scrollTo({ top: 0 });
    onChange();
  }

  function refreshBadges() {
    for (const [id, badge] of badges) {
      const text = byItemId[id].badge();
      badge.textContent = text;
      badge.hidden = !text;
    }
  }

  el.back.addEventListener('click', close);
  showPanels();
  refreshBadges();

  return {
    open,
    close,
    refreshBadges,
    setToday(text) { el.today.textContent = text; el.today.hidden = !text; },
    get current() { return current ? current.id : null; },
    // Leaving the Train tab (another tab or Settings): let the open exercise stop its sound.
    suspend() { if (current) current.hide?.(); },
    resume() { if (current) current.resume?.(); },
    title: () => (current ? [current.title, current.subtitle || current.summary] : ['Train', 'Train your ears: critical listening and pitch']),
  };
}
