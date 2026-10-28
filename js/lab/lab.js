// lab.js
// ------------------------------------------------------------
// The Acoustics Lab tab: a menu of tools, one shown at a time.
//
// Every tool is an object like:
//   { id, title, subtitle, summary, needsMic, windowSize,
//     show(), hide(), onSamples(buffer, sampleRate, now) }
// Its page is the <section id="lab-<id>"> in index.html.
// Tools that need the microphone get a "Start microphone" card until it's on.
// ------------------------------------------------------------

const byId = (id) => document.getElementById(id);

export function createLab({ tools, isListening, startListening, onToolChange }) {
  const el = {
    home: byId('lab-home'),
    grid: byId('lab-grid'),
    toolbar: byId('lab-toolbar'),
    back: byId('lab-back'),
    needMic: byId('lab-need-mic'),
    startMic: byId('lab-start-mic'),
  };
  const byIdTool = Object.fromEntries(tools.map((t) => [t.id, t]));
  let current = null;

  // The menu: one tile per tool, saying whether it measures or calculates.
  tools.forEach((tool, index) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'card lab-tile';
    tile.id = `lab-open-${tool.id}`;
    const kind = tool.needsMic ? 'Microphone' : tool.kind || 'Calculator';
    tile.innerHTML = `<span class="lab-tile-number">${index + 1}</span>` +
      `<span class="lab-tile-text"><strong>${tool.title}</strong><span class="small muted">${tool.summary}</span></span>` +
      `<span class="pill ${tool.needsMic ? 'tag-measured' : 'tag-model'}">${kind}</span>`;
    tile.addEventListener('click', () => open(tool.id));
    el.grid.append(tile);
  });

  function open(id) {
    if (current) {
      current.hide?.();
      byId(`lab-${current.id}`).hidden = true;
    }
    current = byIdTool[id];
    el.home.hidden = true;
    el.toolbar.hidden = false;
    byId(`lab-${id}`).hidden = false;
    current.show?.();
    refresh();
    window.scrollTo({ top: 0 });
    onToolChange();
  }

  function close() {
    if (current) {
      current.hide?.();
      byId(`lab-${current.id}`).hidden = true;
    }
    current = null;
    el.home.hidden = false;
    el.toolbar.hidden = true;
    refresh();
    window.scrollTo({ top: 0 });
    onToolChange();
  }

  function refresh() {
    el.needMic.hidden = !(current && current.needsMic && !isListening());
  }

  el.back.addEventListener('click', close);
  el.startMic.addEventListener('click', () => startListening());

  return {
    open,
    close,
    refresh,
    get current() { return current; },
    // Leaving the Lab tab (another tab or Settings): let the open tool stop
    // any sound. Coming back: let it redraw.
    suspend() { if (current) current.hide?.(); },
    resume() { if (current) current.show?.(); },
    // How many samples the microphone should give us for the open tool.
    windowSize: () => (current && current.windowSize) || 2048,
    onSamples(buffer, sampleRate, now) {
      if (current && current.onSamples) current.onSamples(buffer, sampleRate, now);
    },
    title: () => (current ? [current.title, current.subtitle] : ['Acoustics Lab', 'See and calculate the physics of sound']),
  };
}
