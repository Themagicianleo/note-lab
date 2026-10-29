// pitch-history.js
// ------------------------------------------------------------
// Keeps the pitch line of the last few minutes, so you can pause the
// monitor and scroll back, or see statistics. It stores NUMBERS only
// (time, smoothed pitch, raw pitch), never sound.
//
// About 60 readings a second × 5 minutes = 18 000 small objects: fine
// on a phone. Older readings are dropped.
// ------------------------------------------------------------

export const HISTORY_SECONDS = 300;

export class PitchHistory {
  constructor({ seconds = HISTORY_SECONDS } = {}) {
    this.seconds = seconds;
    this.clear();
  }

  clear() {
    this.items = [];
    this.start = 0; // index of the oldest kept item (dropping from the front of an array is slow, so we skip instead)
  }

  // t in ms (increasing), hz and raw in Hz or null.
  add(t, hz, raw = null) {
    this.items.push({ t, hz, raw });
    const oldest = t - this.seconds * 1000;
    while (this.start < this.items.length && this.items[this.start].t < oldest) this.start++;
    // Now and then, really remove the skipped items.
    if (this.start > 4096) {
      this.items = this.items.slice(this.start);
      this.start = 0;
    }
  }

  get length() { return this.items.length - this.start; }
  get first() { return this.length ? this.items[this.start] : null; }
  get last() { return this.length ? this.items[this.items.length - 1] : null; }

  // All readings, oldest first (a copy).
  all() { return this.items.slice(this.start); }

  // Readings with from ≤ t ≤ to, plus one on each side so a line can be drawn to the edges.
  between(from, to) {
    const items = this.items;
    let lo = this.start;
    let hi = items.length;
    while (lo < hi) { // binary search: first item with t ≥ from
      const mid = (lo + hi) >> 1;
      if (items[mid].t < from) lo = mid + 1; else hi = mid;
    }
    const out = [];
    for (let i = Math.max(this.start, lo - 1); i < items.length; i++) {
      out.push(items[i]);
      if (items[i].t > to) break;
    }
    return out;
  }

  // Make a history from saved readings (e.g. a recording's or a file's pitch line).
  static from(readings, seconds = Infinity) {
    const h = new PitchHistory({ seconds });
    h.items = readings.slice();
    return h;
  }
}
