// ЗВУК: разовые синтезированные звуки (интерфейс, удары, взрывы, гром, сигнализация).
// Каждый вызов строит маленький граф из 2–6 узлов, который сам останавливается и отключается.
// Рецепт: (S, dest, t, o) -> длительность, с.  S — помощники ниже; o — опции вызова (size, vs, speed, dist, ...).

export function createSfx(ctx, bufs, onVoice) {
  // огибающая без щелчков: 0 -> пик за a, затем экспоненциальный спад к концу
  function env(g, t, a, dur, vol, curve) {
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vol, t + a);
    if (curve === 'lin') p.linearRampToValueAtTime(0, t + dur);
    else { p.setTargetAtTime(0, t + a, Math.max(0.005, (dur - a) / 4.5)); p.setValueAtTime(0, t + dur + 0.02); }
  }
  function finish(nodes, src, end) {
    onVoice(1);
    src.onended = () => { onVoice(-1); for (const n of nodes) { try { n.disconnect(); } catch (e) { /* уже отключён */ } } };
    src.stop(end + 0.05);
  }
  const S = {
    // тон: { type, f, f2 (конечная частота), dur, a, vol, lp, detune }
    tone(dest, t, o) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
      if (o.detune) osc.detune.value = o.detune;
      let tail = g;
      const nodes = [osc, g];
      if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.5; osc.connect(f); f.connect(g); nodes.push(f); } else osc.connect(g);
      tail.connect(dest);
      env(g, t, o.a || 0.005, o.dur, o.vol == null ? 0.3 : o.vol, o.curve);
      osc.start(t);
      finish(nodes, osc, t + o.dur);
      return o.dur;
    },
    // шум: { buf: 'white'|'brown', type, f, f2, q, dur, a, vol, rate }
    noise(dest, t, o) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = bufs[o.buf || 'white']; s.loop = true;
      s.playbackRate.value = o.rate || 1;
      f.type = o.type || 'bandpass';
      f.frequency.setValueAtTime(o.f, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
      f.Q.value = o.q == null ? 1 : o.q;
      s.connect(f); f.connect(g); g.connect(dest);
      env(g, t, o.a || 0.005, o.dur, o.vol == null ? 0.3 : o.vol, o.curve);
      s.start(t, Math.random() * 1.5);
      finish([s, f, g], s, t + o.dur);
      return o.dur;
    },
    // нота «колокольчик»: основной тон + обертоны
    bell(dest, t, f, vol, dur) {
      S.tone(dest, t, { f, dur, vol, a: 0.004 });
      S.tone(dest, t, { f: f * 2.01, dur: dur * 0.6, vol: vol * 0.35, a: 0.004 });
      S.tone(dest, t, { f: f * 3.02, dur: dur * 0.3, vol: vol * 0.12, a: 0.003 });
      return dur;
    },
    // мягкая «деревянная» нота
    pluck(dest, t, f, vol, dur) {
      S.tone(dest, t, { type: 'triangle', f, dur, vol, a: 0.004, lp: f * 4 });
      return dur;
    },
  };

  const R = {
    // ---------------- интерфейс (тихо, мягко)
    ui_click: (d, t) => { S.tone(d, t, { f: 1250, f2: 820, dur: 0.05, vol: 0.18 }); S.noise(d, t, { f: 3500, q: 2, dur: 0.02, vol: 0.05 }); return 0.06; },
    ui_tick: (d, t) => S.tone(d, t, { f: 1900, dur: 0.03, vol: 0.09 }),
    ui_back: (d, t) => { S.tone(d, t, { f: 880, f2: 700, dur: 0.05, vol: 0.14 }); S.tone(d, t + 0.055, { f: 620, f2: 520, dur: 0.07, vol: 0.13 }); return 0.13; },
    ui_error: (d, t) => { S.tone(d, t, { type: 'triangle', f: 196, dur: 0.08, vol: 0.2, lp: 900 }); S.tone(d, t + 0.11, { type: 'triangle', f: 185, dur: 0.12, vol: 0.2, lp: 900 }); return 0.24; },
    ui_select: (d, t) => { S.pluck(d, t, 660, 0.16, 0.12); S.pluck(d, t + 0.06, 990, 0.14, 0.18); return 0.24; },
    ui_buy: (d, t) => { S.bell(d, t, 1318, 0.12, 0.25); S.bell(d, t + 0.07, 1760, 0.12, 0.45); S.noise(d, t, { f: 6000, q: 0.8, dur: 0.25, vol: 0.03 }); return 0.5; },
    ui_start: (d, t) => {
      const n = [523, 659, 784, 1046];
      for (let i = 0; i < 4; i++) S.pluck(d, t + i * 0.07, n[i], 0.13, 0.35);
      S.noise(d, t, { f: 600, f2: 2400, q: 0.7, dur: 0.5, a: 0.25, vol: 0.05, curve: 'lin' });
      return 0.6;
    },
    ui_coin: (d, t) => { S.tone(d, t, { type: 'triangle', f: 988, dur: 0.07, vol: 0.12 }); S.tone(d, t + 0.07, { type: 'triangle', f: 1319, dur: 0.3, vol: 0.12 }); return 0.38; },
    ui_star: (d, t) => S.bell(d, t, 1568, 0.13, 0.6),
    ui_success: (d, t) => {
      const n = [523, 659, 784, 1046];
      for (let i = 0; i < 4; i++) S.pluck(d, t + i * 0.11, n[i], 0.12, 0.9 - i * 0.1);
      S.bell(d, t + 0.44, 2093, 0.05, 0.9);
      return 1.4;
    },
    ui_fail: (d, t) => { const n = [392, 330, 262]; for (let i = 0; i < 3; i++) S.pluck(d, t + i * 0.16, n[i], 0.13, 0.5); return 1; },
    ui_debrief: (d, t) => { S.pluck(d, t, 587, 0.12, 0.4); S.pluck(d, t + 0.14, 784, 0.12, 0.6); return 0.8; },
    ui_rankup: (d, t) => {
      const n = [392, 523, 659];
      for (let i = 0; i < 3; i++) S.tone(d, t + i * 0.12, { type: 'sawtooth', f: n[i], dur: 0.16, vol: 0.06, lp: 1400 });
      for (const f of [523, 659, 784, 1046]) S.tone(d, t + 0.36, { type: 'sawtooth', f, dur: 1.1, a: 0.03, vol: 0.045, lp: 1800 });
      S.bell(d, t + 0.36, 2093, 0.04, 1);
      return 1.5;
    },
    ui_achievement: (d, t) => { S.bell(d, t, 1046, 0.1, 0.7); S.bell(d, t + 0.09, 1318, 0.1, 0.7); S.bell(d, t + 0.18, 1568, 0.1, 1); return 1.2; },
    ui_fallback: (d, t) => S.tone(d, t, { f: 1000, dur: 0.025, vol: 0.06 }),

    // ---------------- сигнализация кабины (короткие, не резкие тоны)
    warn_stall: (d, t) => { S.tone(d, t, { type: 'triangle', f: 880, dur: 0.13, a: 0.01, vol: 0.16, curve: 'lin' }); S.tone(d, t + 0.16, { type: 'triangle', f: 700, dur: 0.13, a: 0.01, vol: 0.16, curve: 'lin' }); return 0.3; },
    warn_gear: (d, t) => S.tone(d, t, { type: 'triangle', f: 420, dur: 0.38, a: 0.03, vol: 0.14, curve: 'lin', lp: 1200 }),
    warn_terrain: (d, t) => { S.tone(d, t, { f: 1150, dur: 0.07, a: 0.006, vol: 0.14, curve: 'lin' }); S.tone(d, t + 0.11, { f: 1150, dur: 0.07, a: 0.006, vol: 0.14, curve: 'lin' }); return 0.2; },
    radio: (d, t) => {
      S.noise(d, t, { f: 2600, q: 1.4, dur: 0.06, a: 0.002, vol: 0.06 });
      S.tone(d, t + 0.01, { type: 'square', f: 1400, dur: 0.035, vol: 0.025, lp: 2500 });
      return 0.08;
    },

    // ---------------- механика и касания (o.k — сила 0..1)
    gear_lock: (d, t, o) => { const k = o.k == null ? 1 : o.k; S.tone(d, t, { f: 120, f2: 55, dur: 0.14, vol: 0.4 * k }); S.noise(d, t, { buf: 'brown', type: 'lowpass', f: 600, dur: 0.1, vol: 0.5 * k }); S.noise(d, t, { f: 2200, q: 3, dur: 0.035, vol: 0.06 * k }); return 0.15; },
    flap_lock: (d, t) => { S.noise(d, t, { f: 1500, q: 2, dur: 0.04, vol: 0.08 }); S.tone(d, t, { f: 180, f2: 120, dur: 0.06, vol: 0.12 }); return 0.07; },
    bump: (d, t, o) => { const k = o.k == null ? 0.5 : o.k; S.tone(d, t, { f: 75, f2: 50, dur: 0.09, vol: 0.25 * k }); S.noise(d, t, { buf: 'brown', type: 'lowpass', f: 400, dur: 0.06, vol: 0.3 * k }); return 0.1; },
    touchdown: (d, t, o) => {
      const vs = Math.min(6, Math.abs(o.vs || 1)), sp = o.speed || 50, k = Math.min(1, 0.25 + vs / 3.5);
      // удар
      S.tone(d, t, { f: 95, f2: 42, dur: 0.22, vol: 0.25 + 0.35 * k });
      S.noise(d, t, { buf: 'brown', type: 'lowpass', f: 300 + 200 * k, dur: 0.18, vol: 0.4 * k });
      // визг резины
      if (o.gearDown !== false && sp > 15) {
        const sq = Math.min(1, sp / 70), dur = 0.12 + 0.18 * sq;
        S.noise(d, t + 0.01, { f: 2300 + 400 * sq, f2: 1700, q: 7, dur, a: 0.01, vol: 0.13 * sq });
        S.tone(d, t + 0.01, { type: 'triangle', f: 1750 + 250 * sq, f2: 1350, dur: dur * 0.8, a: 0.01, vol: 0.035 * sq });
      } else if (o.gearDown === false) {
        S.noise(d, t, { f: 3200, f2: 1500, q: 0.9, dur: 1.6, a: 0.01, vol: 0.2 });
        S.noise(d, t, { buf: 'brown', type: 'lowpass', f: 500, dur: 1.2, vol: 0.5 });
      }
      return 0.4;
    },
    splash: (d, t, o) => {
      const s = Math.min(4, o.size || 1), k = Math.min(1, 0.35 + s * 0.2);
      S.noise(d, t, { f: 1400, f2: 450, q: 0.8, dur: 0.5 + 0.25 * s, a: 0.01, vol: 0.3 * k });
      S.noise(d, t, { buf: 'brown', type: 'lowpass', f: 380, f2: 120, dur: 0.4 + 0.2 * s, vol: 0.45 * k });
      S.noise(d, t + 0.15, { f: 3500, q: 1, dur: 0.6 + 0.3 * s, a: 0.1, vol: 0.06 * k });   // капли
      return 1 + 0.5 * s;
    },
    explosion: (d, t, o) => {
      const s = Math.min(6, o.size || 1), near = o.dist == null ? 1 : Math.max(0, 1 - o.dist / 1200), dur = 1.4 + 0.5 * s;
      S.noise(d, t, { buf: 'brown', type: 'lowpass', f: 700 + 600 * near, f2: 90, glide: dur * 0.7, q: 0.7, dur, a: 0.006, vol: 0.9 });
      S.tone(d, t, { f: 70, f2: 28, dur: 0.6, vol: 0.55 });
      if (near > 0.2) S.noise(d, t, { f: 2200, q: 0.6, dur: 0.12, a: 0.002, vol: 0.25 * near });
      S.noise(d, t + 0.25, { buf: 'brown', type: 'lowpass', f: 220, dur: dur * 1.3, a: 0.3, vol: 0.3 });   // догорающий гул
      return dur * 1.3 + 0.3;
    },
    thunder: (d, t, o) => {
      const near = o.dist == null ? 0.5 : Math.max(0, 1 - o.dist / 6000);
      if (near > 0.55) S.noise(d, t, { type: 'highpass', f: 1200, q: 0.5, dur: 0.25, a: 0.004, vol: 0.18 * near });
      let tt = t;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const dur = 0.9 + Math.random() * 1.6;
        S.noise(d, tt, { buf: 'brown', type: 'lowpass', f: 160 + 260 * near * Math.random(), f2: 70, q: 0.6, dur, a: 0.05 + Math.random() * 0.25, vol: (0.35 + 0.4 * near) * (1 - i / (n + 1)) });
        tt += 0.25 + Math.random() * 0.6;
      }
      return tt - t + 2.5;
    },
    hit: (d, t) => { S.noise(d, t, { f: 1700, q: 3, dur: 0.12, vol: 0.25 }); S.tone(d, t, { type: 'square', f: 310, f2: 180, dur: 0.12, vol: 0.06, lp: 1500 }); return 0.13; },
    gun: (d, t) => { S.noise(d, t, { f: 900, q: 0.8, dur: 0.06, a: 0.002, vol: 0.3 }); S.tone(d, t, { f: 140, f2: 60, dur: 0.05, vol: 0.25 }); return 0.07; },
    missile: (d, t) => { S.noise(d, t, { f: 500, f2: 2600, q: 0.8, dur: 1.6, a: 0.04, vol: 0.3 }); S.noise(d, t, { buf: 'brown', type: 'lowpass', f: 300, dur: 1.2, vol: 0.35 }); return 1.6; },
    drop: (d, t) => { S.tone(d, t, { f: 160, f2: 70, dur: 0.15, vol: 0.25 }); S.noise(d, t, { f: 1200, q: 2, dur: 0.05, vol: 0.08 }); return 0.16; },
    flare: (d, t) => { S.noise(d, t, { f: 1500, q: 1, dur: 0.05, a: 0.002, vol: 0.18 }); S.noise(d, t + 0.03, { type: 'highpass', f: 2500, q: 0.5, dur: 0.9, a: 0.05, vol: 0.05 }); return 1; },
    water_drop: (d, t) => { S.noise(d, t, { f: 700, f2: 300, q: 0.6, dur: 1.4, a: 0.15, vol: 0.25 }); return 1.4; },
  };
  // синонимы, которые могут звать соседи
  R.click = R.ui_click; R.ui_ok = R.ui_select; R.ui_open = R.ui_click; R.ui_close = R.ui_back; R.ui_toggle = R.ui_tick;
  R.crash = R.explosion; R.lightning = R.thunder; R.damage = R.hit; R.cannon = R.gun; R.rocket = R.missile; R.bomb = R.drop;
  R.gear = R.gear_lock; R.flaps = R.flap_lock; R.stall = R.warn_stall;

  return { R, S };
}
