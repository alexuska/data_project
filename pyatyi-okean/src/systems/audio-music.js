// ЗВУК: генеративная эмбиент-подложка для меню — медленные тёплые аккорды-пэды и редкие тихие «капли» нот.
// Граф создаётся при включении и полностью останавливается после затухания (в полёте музыка не тратит процессор).
import { setP, mkGain, mkFilter } from './audio-engine.js';

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// D-мажор, мягкие септ- и нон-аккорды (MIDI-ноты, 4 голоса)
const CHORDS = [
  [50, 57, 61, 64],   // D  (D A C# E)  — Dadd9/maj7
  [47, 54, 57, 62],   // Bm7
  [43, 55, 59, 62],   // Gmaj
  [45, 52, 57, 61],   // A
  [42, 54, 57, 61],   // F#m
  [43, 50, 59, 66],   // Gmaj7
];
const SCALE = [74, 76, 78, 81, 83, 86, 88];   // пентатоника для редких нот

export function createMusic(ctx, out) {
  let g = null, nodes = [], voices = [], lp = null, dly = null, alive = false;
  let chord = 0, nextChord = 0, nextNote = 0, target = 0, offAt = -1;

  function build() {
    g = mkGain(ctx, 0, out);
    lp = mkFilter(ctx, 'lowpass', 900, 0.4, g);
    // простое «пространство»: задержка с обратной связью через фильтр
    dly = ctx.createDelay(1.5); dly.delayTime.value = 0.61;
    const fb = mkGain(ctx, 0.38, null), dF = mkFilter(ctx, 'lowpass', 1600, 0.5, null), wet = mkGain(ctx, 0.35, g);
    dly.connect(dF); dF.connect(fb); fb.connect(dly); dF.connect(wet);
    nodes = [g, lp, dly, fb, dF, wet];
    voices = [];
    for (let i = 0; i < 4; i++) {
      const vg = mkGain(ctx, 0, lp);
      vg.connect(dly);
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'triangle'; o2.type = 'sine';
      o2.detune.value = 6 + i * 2;
      o1.connect(vg); o2.connect(vg);
      o1.start(); o2.start();
      voices.push({ vg, o1, o2 });
      nodes.push(vg, o1, o2);
    }
    // медленное «дыхание» фильтра
    const lfo = ctx.createOscillator(), lg = mkGain(ctx, 260, lp.frequency);
    lfo.frequency.value = 0.045; lfo.connect(lg); lfo.start();
    nodes.push(lfo, lg);
    alive = true;
    chord = Math.floor(Math.random() * CHORDS.length);
    nextChord = ctx.currentTime; nextNote = ctx.currentTime + 5;
  }
  function destroy() {
    for (const n of nodes) { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* уже */ } }
    nodes = []; voices = []; g = null; alive = false;
  }
  function setChord(t) {
    const c = CHORDS[chord];
    for (let i = 0; i < 4; i++) {
      const v = voices[i], f = midi(c[i]);
      // голоса переплывают медленно (portamento) — без щелчков
      v.o1.frequency.setTargetAtTime(f, t, 0.8);
      v.o2.frequency.setTargetAtTime(f * 0.5 * (i === 0 ? 1 : 2), t, 0.8);
      v.vg.gain.setTargetAtTime(i === 0 ? 0.11 : 0.075 - i * 0.008, t, 1.6);
    }
    chord = (chord + 1 + (Math.random() < 0.3 ? 1 : 0)) % CHORDS.length;
  }
  function note(t) {
    const f = midi(SCALE[Math.floor(Math.random() * SCALE.length)]);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.035, t + 0.02); og.gain.setTargetAtTime(0, t + 0.03, 0.7);
    o.connect(og); og.connect(lp); og.connect(dly);
    o.start(t); o.stop(t + 4);
    o.onended = () => { try { og.disconnect(); } catch (e) { /* */ } };
  }

  return {
    get on() { return alive; },
    get level() { return g ? g.gain._v || 0 : 0; },
    // k — желаемая громкость 0..1 (уже с учётом настройки)
    update(k) {
      const now = ctx.currentTime;
      if (k > 0.001 && !alive) build();
      if (!alive) return;
      if (k !== target) { target = k; setP(g.gain, k * 0.5, now, k > 0 ? 2.5 : 0.8); offAt = k > 0.001 ? -1 : now + 4; }
      if (offAt > 0 && now > offAt) { destroy(); offAt = -1; return; }
      if (now >= nextChord) { setChord(now); nextChord = now + 7 + Math.random() * 4; }
      if (now >= nextNote) { if (target > 0.01) note(now + 0.05); nextNote = now + 4 + Math.random() * 7; }
    },
  };
}
