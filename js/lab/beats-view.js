// beats-view.js
// ------------------------------------------------------------
// Lab tool 3: beats demo. Plays two pure tones, f₁ and f₂ = f₁ + Δ, and
// shows (calculated) the beat frequency |f₁ − f₂| and the summed wave with
// its swelling-and-fading envelope.
// Option: one tone in each ear (headphones). Then the two tones never meet
// in the air; any beating you hear happens in your brain ("binaural beats").
// ------------------------------------------------------------

import { beatFrequency, beatPeriod, averageFrequency, twoToneSum, beatEnvelope } from '../acoustics.js';
import { frequencyToNote, formatNote } from '../pitch-math.js';
import { prepareCanvas, themeColours } from './canvas.js';

const byId = (id) => document.getElementById(id);
const VOLUME = 0.18; // each tone; two together stay well below full scale

export function createBeatsTool({ player, getA4 }) {
  const el = {
    f1: byId('beats-f1'), f1Value: byId('beats-f1-value'),
    delta: byId('beats-delta'), deltaValue: byId('beats-delta-value'),
    play: byId('beats-play'), split: byId('beats-split'),
    result: byId('beats-result'), hint: byId('beats-hint'),
    canvas: byId('beats-canvas'),
  };
  let tones = null;   // { oscillators, gains, master } while playing
  let startedAt = 0;  // audio clock time when playing started (for the moving marker)
  let animation = null;

  const f1 = () => Number(el.f1.value);
  const delta = () => Number(el.delta.value);
  const f2 = () => f1() + delta();

  // How much time the graph shows: about 3 beats, between 0.05 and 2 s.
  const windowSeconds = () => (delta() === 0 ? 0.05 : Math.min(2, Math.max(0.05, 3 / Math.abs(delta()))));

  function draw() {
    const { ctx, width, height } = prepareCanvas(el.canvas);
    const c = themeColours();
    const mid = height / 2;
    const scale = (mid - 10) / 2; // the sum goes from −2 to +2
    const span = windowSeconds();

    ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(width, mid + 0.5); ctx.stroke();

    // The summed wave. Many cycles fit in one pixel, so sample each column
    // several times and draw its lowest-to-highest range.
    ctx.strokeStyle = c.blue; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 12; k++) {
        const t = ((x + k / 12) / width) * span;
        const v = twoToneSum(t, f1(), f2());
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      ctx.moveTo(x + 0.5, mid - hi * scale);
      ctx.lineTo(x + 0.5, mid - lo * scale);
    }
    ctx.stroke();

    // The envelope ±|2 cos(π Δf t)|, dashed.
    ctx.strokeStyle = c.orange; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    for (const sign of [1, -1]) {
      ctx.beginPath();
      for (let x = 0; x <= width; x++) {
        const y = mid - sign * beatEnvelope((x / width) * span, f1(), f2()) * scale;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Time labels
    ctx.fillStyle = c.muted; ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText('0 s', 4, height - 2);
    ctx.textAlign = 'right'; ctx.fillText(`${+span.toFixed(3)} s`, width - 8, height - 2);

    // While playing: a marker sweeping through the graph in real time.
    if (tones) {
      const t = (player.context.currentTime - startedAt) % span;
      const x = (t / span) * width;
      ctx.strokeStyle = c.text; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, height - 16); ctx.stroke();
    }
  }

  function showNumbers() {
    const a4 = getA4();
    el.f1Value.textContent = `${f1().toFixed(1)} Hz`;
    el.deltaValue.textContent = `${delta() >= 0 ? '+' : ''}${delta().toFixed(1)} Hz → f₂ = ${f2().toFixed(1)} Hz`;
    const fb = beatFrequency(f1(), f2());
    const tb = beatPeriod(f1(), f2());
    const heard = formatNote(frequencyToNote(averageFrequency(f1(), f2()), a4)).split(' · ')[0];
    el.result.textContent = fb === 0
      ? 'f_beat = |f₁ − f₂| = 0 Hz: the tones are identical, so there are no beats.'
      : `f_beat = |${f1().toFixed(1)} − ${f2().toFixed(1)}| = ${fb.toFixed(1)} Hz → one beat every ${tb.toFixed(3)} s. ` +
        `Heard pitch ≈ (f₁ + f₂)/2 = ${averageFrequency(f1(), f2()).toFixed(2)} Hz (${heard}).`;
    // Perception, not a formula: approximate and listener-dependent.
    el.hint.textContent = fb === 0 ? 'In tune: musicians tune by making the beats slower until they disappear.'
      : fb < 12 ? 'You should hear the loudness pulse. Slower beats = closer in tune.'
        : fb < 25 ? 'Around here, roughly 15–20 Hz (it varies between people and frequencies), beats get too fast to count and start to sound rough.'
          : 'Too fast to hear as beats: most people hear roughness, or two separate tones.';
  }

  function setFrequencies() {
    if (!tones) return;
    const now = player.context.currentTime;
    tones.oscillators[0].frequency.setTargetAtTime(f1(), now, 0.02); // glide over ~20 ms, no clicks
    tones.oscillators[1].frequency.setTargetAtTime(f2(), now, 0.02);
  }

  function start() {
    const ctx = player.ensureContext(); // inside the tap, as iPhone requires
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.05); // fade in
    master.connect(ctx.destination);
    const split = el.split.checked && ctx.createStereoPanner;
    const oscillators = [f1(), f2()].map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = VOLUME;
      osc.connect(gain);
      if (split) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = i === 0 ? -1 : 1; // f₁ left ear, f₂ right ear
        gain.connect(pan).connect(master);
      } else {
        gain.connect(master);
      }
      osc.start();
      return osc;
    });
    tones = { oscillators, master };
    startedAt = ctx.currentTime;
    el.play.textContent = 'Stop';
    el.play.setAttribute('aria-pressed', 'true');
    const loop = () => { draw(); animation = requestAnimationFrame(loop); };
    loop();
  }

  function stop() {
    if (!tones) return;
    const ctx = player.context;
    tones.master.gain.setTargetAtTime(0, ctx.currentTime, 0.02); // fade out, then stop
    const old = tones;
    setTimeout(() => old.oscillators.forEach((o) => o.stop()), 150);
    tones = null;
    cancelAnimationFrame(animation);
    el.play.textContent = 'Play both tones';
    el.play.setAttribute('aria-pressed', 'false');
    draw();
  }

  const update = () => { showNumbers(); setFrequencies(); draw(); };
  el.f1.addEventListener('input', update);
  el.delta.addEventListener('input', update);
  el.play.addEventListener('click', () => (tones ? stop() : start()));
  el.split.addEventListener('change', () => { if (tones) { stop(); start(); } });
  showNumbers();

  return {
    id: 'beats',
    title: 'Beats',
    subtitle: 'Two close frequencies make the loudness pulse',
    summary: 'Play two tones and hear the beat frequency |f₁ − f₂|.',
    kind: 'Tone generator',
    needsMic: false,
    show() { showNumbers(); draw(); },
    hide() { stop(); },
  };
}
