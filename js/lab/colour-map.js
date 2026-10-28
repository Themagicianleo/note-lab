// colour-map.js
// ------------------------------------------------------------
// Turns a level in dB into a colour for the spectrogram: dark = quiet,
// bright = loud. Five colour stops in the style of the "inferno" map used in
// science plots: brightness rises steadily, so louder always looks brighter
// (also in greyscale and for most colour-blind viewers).
// ------------------------------------------------------------

const STOPS = [
  [0, 0, 4],        // quietest: near black
  [87, 16, 110],    // purple
  [188, 55, 84],    // red
  [249, 142, 9],    // orange
  [252, 255, 164],  // loudest: pale yellow
];

// db → [r, g, b] (0–255). Levels at or below minDb are darkest, at or above maxDb brightest.
export function dbToColour(db, minDb, maxDb) {
  const x = Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb))) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
}
