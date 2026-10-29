// noise-floor.js
// ------------------------------------------------------------
// "Auto" volume threshold: listens to how loud the room (and the
// microphone's own hiss) is when nobody is singing, and puts the threshold
// just above that. In a quiet room with a quiet built-in mic, that's much
// lower (more sensitive) than a fixed threshold; in a noisy room it rises.
//
// How (a "minimum statistics" estimate, the usual idea in speech processing,
// e.g. R. Martin, "Noise power spectral density estimation based on optimal
// smoothing and minimum statistics", IEEE Trans. Speech and Audio Proc. 9(5),
// 2001; this is a much simplified version):
//   1. Average the level (in power, not dB) over short blocks of BLOCK_MS.
//   2. The noise floor = the QUIETEST block in the last WINDOW_SECONDS.
//      Singing makes blocks louder, never quieter, so as long as there's a
//      short pause (a breath) now and then, the quietest block is the room.
//   3. Threshold = noise floor + MARGIN_DB, kept between LIMITS.
// Only readings WITHOUT a clear pitch are added (the pitch tracker decides),
// so a long held note never raises the threshold above itself.
// The numbers below are this app's own choices, measured with
// tools/sensitivity-check.js; they are not from the paper.
// ------------------------------------------------------------

export const BLOCK_MS = 250;
export const WINDOW_SECONDS = 15;
export const MARGIN_DB = 6;
export const LIMITS = { min: -95, max: -40 };

export class NoiseFloor {
  constructor({ marginDb = MARGIN_DB, fallbackDb = -70 } = {}) {
    this.marginDb = marginDb;
    this.fallbackDb = fallbackDb; // used until the first block is complete
    this.reset();
  }

  reset() {
    this.blocks = [];        // { t, db } finished blocks, oldest first
    this.sum = 0;            // power sum of the current block
    this.count = 0;
    this.blockStart = null;
  }

  // Add one reading: its level in dBFS and the time in ms.
  push(levelDb, timeMs) {
    if (this.blockStart === null) this.blockStart = timeMs;
    this.sum += 10 ** (levelDb / 10); // dB → power, so averaging is fair
    this.count++;
    if (timeMs - this.blockStart >= BLOCK_MS) {
      this.blocks.push({ t: timeMs, db: 10 * Math.log10(this.sum / this.count) });
      this.sum = 0;
      this.count = 0;
      this.blockStart = timeMs;
      const oldest = timeMs - WINDOW_SECONDS * 1000;
      while (this.blocks.length && this.blocks[0].t < oldest) this.blocks.shift();
    }
  }

  // The estimated noise floor in dBFS, or null before the first block.
  get floorDb() {
    if (!this.blocks.length) return null;
    return Math.min(...this.blocks.map((b) => b.db));
  }

  // The volume threshold to use now.
  get gateDb() {
    const floor = this.floorDb;
    const gate = floor === null ? this.fallbackDb : floor + this.marginDb;
    return Math.min(LIMITS.max, Math.max(LIMITS.min, gate));
  }
}
