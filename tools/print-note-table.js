// Prints a table of notes and frequencies so you can check the maths by hand.
// Run with:  npm run table          (A4 = 440)
//      or:   npm run table -- 442   (a different reference pitch)

import { NOTE_NAMES, noteToFrequency, frequencyToNote, formatNote } from '../js/pitch-math.js';

const a4 = Number(process.argv[2]) || 440;

console.log(`Note frequencies with A4 = ${a4} Hz`);
console.log('Formula: f = A4 × 2^((n − 69) / 12)\n');

for (let octave = 1; octave <= 6; octave++) {
  const row = NOTE_NAMES.map((name) => {
    const hz = noteToFrequency(name, octave, a4).toFixed(2);
    return `${(name + octave).padEnd(4)}${hz.padStart(8)}`;
  });
  console.log(row.join('  '));
}

console.log('\nExamples, frequency → note:');
for (const hz of [440, 261.63, 330, 220.5, 435, 100]) {
  console.log(`  ${String(hz).padStart(7)} Hz → ${formatNote(frequencyToNote(hz, a4))}`);
}
