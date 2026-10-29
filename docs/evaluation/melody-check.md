# Music mode (melody guess) on generated songs

Output of `node tools/melody-check.js`. Computer-made songs (one synthetic singer, piano-like chords, bass, drums; no reverb), not real recordings: real songs will do worse.

| Song | Method | Pitch right | Note name right (octave-free) | When a note is shown, it is right | Rests: a note shown anyway |
|---|---|---|---|---|---|
| high voice (F4 tonic), chords below, singer +6 dB vs band | Normal (one note at a time, High sensitivity) | 7% | 8% | 64% | 7% |
| high voice (F4 tonic), chords below, singer +6 dB vs band | Music mode (melody guess) | 72% | 79% | 80% | 39% |
| low voice (G3 tonic), chords below, singer +6 dB vs band | Normal (one note at a time, High sensitivity) | 1% | 8% | 3% | 37% |
| low voice (G3 tonic), chords below, singer +6 dB vs band | Music mode (melody guess) | 91% | 91% | 86% | 46% |
| high voice (F4 tonic), chords below, singer +3 dB vs band | Normal (one note at a time, High sensitivity) | 1% | 1% | 48% | 2% |
| high voice (F4 tonic), chords below, singer +3 dB vs band | Music mode (melody guess) | 73% | 78% | 80% | 39% |
| low voice (G3 tonic), chords below, singer +3 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 6% | 0% | 34% |
| low voice (G3 tonic), chords below, singer +3 dB vs band | Music mode (melody guess) | 87% | 87% | 82% | 46% |
| high voice (F4 tonic), chords below, singer 0 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 0% | 0% | 2% |
| high voice (F4 tonic), chords below, singer 0 dB vs band | Music mode (melody guess) | 66% | 72% | 70% | 41% |
| low voice (G3 tonic), chords below, singer 0 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 5% | 0% | 35% |
| low voice (G3 tonic), chords below, singer 0 dB vs band | Music mode (melody guess) | 82% | 82% | 77% | 46% |
| high voice (F4 tonic), chords below, singer -6 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 0% | 0% | 4% |
| high voice (F4 tonic), chords below, singer -6 dB vs band | Music mode (melody guess) | 27% | 46% | 23% | 69% |
| low voice (G3 tonic), chords below, singer -6 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 4% | 0% | 41% |
| low voice (G3 tonic), chords below, singer -6 dB vs band | Music mode (melody guess) | 68% | 72% | 61% | 50% |
| high voice (F4 tonic), chords in the same range, singer +6 dB vs band | Normal (one note at a time, High sensitivity) | 11% | 12% | 71% | 7% |
| high voice (F4 tonic), chords in the same range, singer +6 dB vs band | Music mode (melody guess) | 75% | 78% | 82% | 39% |
| low voice (G3 tonic), chords in the same range, singer +6 dB vs band | Normal (one note at a time, High sensitivity) | 2% | 9% | 5% | 48% |
| low voice (G3 tonic), chords in the same range, singer +6 dB vs band | Music mode (melody guess) | 84% | 84% | 79% | 46% |
| high voice (F4 tonic), chords in the same range, singer +3 dB vs band | Normal (one note at a time, High sensitivity) | 2% | 2% | 67% | 2% |
| high voice (F4 tonic), chords in the same range, singer +3 dB vs band | Music mode (melody guess) | 67% | 76% | 69% | 43% |
| low voice (G3 tonic), chords in the same range, singer +3 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 6% | 0% | 47% |
| low voice (G3 tonic), chords in the same range, singer +3 dB vs band | Music mode (melody guess) | 76% | 76% | 70% | 46% |
| high voice (F4 tonic), chords in the same range, singer 0 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 0% | 0% | 1% |
| high voice (F4 tonic), chords in the same range, singer 0 dB vs band | Music mode (melody guess) | 44% | 61% | 41% | 52% |
| low voice (G3 tonic), chords in the same range, singer 0 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 6% | 0% | 47% |
| low voice (G3 tonic), chords in the same range, singer 0 dB vs band | Music mode (melody guess) | 70% | 71% | 64% | 47% |
| high voice (F4 tonic), chords in the same range, singer -6 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 0% | 0% | 3% |
| high voice (F4 tonic), chords in the same range, singer -6 dB vs band | Music mode (melody guess) | 17% | 33% | 15% | 67% |
| low voice (G3 tonic), chords in the same range, singer -6 dB vs band | Normal (one note at a time, High sensitivity) | 0% | 6% | 0% | 57% |
| low voice (G3 tonic), chords in the same range, singer -6 dB vs band | Music mode (melody guess) | 43% | 50% | 36% | 66% |

(Averages over 3 tunes each. "Pitch right" counts moments where the singer is singing.)
