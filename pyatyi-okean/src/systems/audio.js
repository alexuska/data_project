// ЗВУК. Контракт — в ARCHITECTURE.md: unlock(), play(name, opts), setVolume(sound, music), update(dtReal).
// Только WebAudio-синтез. Постоянные голоса (двигатель, ветер, тряска, качение, вода, моторчики, дождь) создаются один раз,
// в кадре меняются только параметры. Разовые звуки — audio-sfx.js, двигатели — audio-engine.js, музыка меню — audio-music.js.
// Сверх контракта: debug() -> { state, voices, engine: {freq, gain}, wind, ... }.
//
// Шины:  ui ───────────────────────────────┐
//        engine ─ pan ─ distLP ─┐          ├─ sfx (громкость «Звук») ─┐
//        loops / мир ───────────┴─ world (пауза) ─ muffle (кабина) ─┘   ├─ master (скрытая вкладка) ─ компрессор ─ выход
//        music (громкость «Музыка») ───────────────────────────────────┘
import { createEngine, createRemote, setP, mkGain, mkFilter, mkOsc, mkNoise, stats } from './audio-engine.js';
import { createSfx } from './audio-sfx.js';
import { createMusic } from './audio-music.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dampK = (rate, dt) => 1 - Math.exp(-rate * dt);
// минимальный интервал между повторами одного звука, с
const MIN_GAP = { ui_tick: 0.035, gun: 0.05, hit: 0.08, bump: 0.06, splash: 0.08, explosion: 0.04, touchdown: 0.12, radio: 0.15, gear_lock: 0.2, flap_lock: 0.2, thunder: 0.3 };
const MAX_VOICES = 72;
const SPOOL = { piston: 2.2, turboprop: 1.1, jet: 0.55 };

export function createAudio(G) {
  let ctx = null, unlocked = false, silentDone = false;
  let bufs = null, sfx = null, music = null;
  let master, comp, sfxBus, uiBus, world, muffle, engIn, engPan, engLP;
  let L = null;                         // постоянные петли
  const last = Object.create(null);     // время последнего запуска по имени
  let voices = 0, played = 0, lastName = '', missed = 0;
  const vol = { sound: 0.8, music: 0.5 };
  const S = {
    eng: null, engAc: null, n: 0, run: 0, ab: 0, dop: 1,
    wind: 0, buffet: 0, roll: 0, water: 0, rain: 0, gearMotor: 0, flapMotor: 0,
    gearPrev: -1, flapPrev: -1, gearMoving: 0, flapMoving: 0, bumpAcc: 0,
    warn: '', warnT: 0, gust: 0, gustT: 0,
    remotes: [], hidden: false, paused: false, cockpit: false,
  };

  // ------------------------------------------------------------------ построение графа
  function noiseBuffers() {
    const sr = ctx.sampleRate, n = Math.floor(sr * 2.5);
    const white = ctx.createBuffer(1, n, sr), brown = ctx.createBuffer(1, n, sr);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let lb = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      lb = (lb + 0.02 * r) / 1.02;
      b[i] = lb * 3.5;
    }
    // сгладить шов петли
    for (let i = 0; i < 256; i++) { const k = i / 256; w[n - 256 + i] *= 1 - k; b[n - 256 + i] = b[n - 256 + i] * (1 - k) + b[i] * k; }
    return { white, brown };
  }

  function build() {
    bufs = noiseBuffers();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = mkGain(ctx, 0.9, comp);
    sfxBus = mkGain(ctx, vol.sound, master);
    uiBus = mkGain(ctx, 0.9, sfxBus);
    muffle = mkFilter(ctx, 'lowpass', 18000, 0.5, sfxBus);
    world = mkGain(ctx, 1, muffle);
    engLP = mkFilter(ctx, 'lowpass', 18000, 0.5, world);
    engPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (engPan) engPan.connect(engLP);
    engIn = mkGain(ctx, 0.55, engPan || engLP);
    const musicBus = mkGain(ctx, 1, master);
    music = createMusic(ctx, musicBus);
    sfx = createSfx(ctx, bufs, (d) => { voices += d; });

    // ---- петли
    const src = [];
    L = { src };
    // ветер: шипящий шум + низкий гул обтекания
    L.windG = mkGain(ctx, 0, world);
    L.windF = mkFilter(ctx, 'bandpass', 600, 0.55, L.windG);
    mkNoise(ctx, bufs.white, L.windF, 1, src);
    L.windLoG = mkGain(ctx, 0, world);
    L.windLoF = mkFilter(ctx, 'lowpass', 220, 0.6, L.windLoG);
    mkNoise(ctx, bufs.brown, L.windLoF, 1, src);
    // тряска: низкий шум с неровной амплитудной модуляцией
    L.bufG = mkGain(ctx, 0, world);
    L.bufAm = mkGain(ctx, 0.5, L.bufG);
    L.bufF = mkFilter(ctx, 'lowpass', 95, 0.9, L.bufAm);
    mkNoise(ctx, bufs.brown, L.bufF, 0.8, src);
    L.bufL1 = mkOsc(ctx, 'square', 7.3, mkGain(ctx, 0.3, L.bufAm.gain), src);
    L.bufL2 = mkOsc(ctx, 'sine', 11.7, mkGain(ctx, 0.2, L.bufAm.gain), src);
    // качение по земле
    L.rollG = mkGain(ctx, 0, world);
    L.rollAm = mkGain(ctx, 0.7, L.rollG);
    L.rollF = mkFilter(ctx, 'lowpass', 160, 0.8, L.rollAm);
    mkNoise(ctx, bufs.brown, L.rollF, 1, src);
    L.rollLfo = mkOsc(ctx, 'sawtooth', 4, null, src);
    L.rollLfoG = mkGain(ctx, 0, L.rollAm.gain);
    L.rollLfo.connect(L.rollLfoG);
    // вода: шелест под корпусом
    L.waterG = mkGain(ctx, 0, world);
    L.waterF = mkFilter(ctx, 'bandpass', 700, 0.5, L.waterG);
    mkNoise(ctx, bufs.white, L.waterF, 0.9, src);
    // дождь по остеклению
    L.rainG = mkGain(ctx, 0, world);
    L.rainF = mkFilter(ctx, 'highpass', 2600, 0.4, L.rainG);
    mkNoise(ctx, bufs.white, L.rainF, 1.1, src);
    // электромоторы шасси и закрылков
    L.gearG = mkGain(ctx, 0, world);
    L.gearF = mkFilter(ctx, 'lowpass', 520, 1.5, L.gearG);
    L.gearO = mkOsc(ctx, 'sawtooth', 92, L.gearF, src);
    mkOsc(ctx, 'sawtooth', 93.5, L.gearF, src);
    L.flapG = mkGain(ctx, 0, world);
    L.flapF = mkFilter(ctx, 'bandpass', 900, 2.5, L.flapG);
    L.flapO = mkOsc(ctx, 'sawtooth', 150, L.flapF, src);
  }

  // ------------------------------------------------------------------ включение из жеста
  function unlock() {
    try {
      if (!ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
        readVolumes();
        build();
      }
      if (ctx.state !== 'running' && !S.hidden) { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); }
      if (!silentDone) {
        // iOS: «разбудить» вывод коротким беззвучным буфером внутри жеста
        silentDone = true;
        const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      }
      unlocked = true;
      return true;
    } catch (e) { return false; }
  }
  function gesture() {
    unlock();
    if (ctx && ctx.state === 'running') for (const t of GESTURES) window.removeEventListener(t, gesture, true);
  }
  const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'];
  if (typeof window !== 'undefined') for (const t of GESTURES) window.addEventListener(t, gesture, true);

  // ------------------------------------------------------------------ громкости
  function readVolumes() {
    const st = G.profile && G.profile.settings;
    if (st) { vol.sound = clamp(st.sound == null ? 0.8 : +st.sound || 0, 0, 1); vol.music = clamp(st.music == null ? 0.5 : +st.music || 0, 0, 1); }
  }
  function applyVolumes() {
    if (!ctx) return;
    setP(sfxBus.gain, vol.sound * vol.sound * 0.6 + vol.sound * 0.4, ctx.currentTime, 0.05);
  }
  function setVolume(sound, music_) {
    if (sound != null) vol.sound = clamp(+sound || 0, 0, 1);
    if (music_ != null) vol.music = clamp(+music_ || 0, 0, 1);
    applyVolumes();
  }

  // ------------------------------------------------------------------ разовые звуки
  const camPos = { x: 0, y: 0, z: 0 }, camR = { x: 1, y: 0, z: 0 };
  function readCamera() {
    const c = G.camera;
    if (!c) return;
    camPos.x = c.position.x; camPos.y = c.position.y; camPos.z = c.position.z;
    const e = c.matrixWorld.elements;
    camR.x = e[0]; camR.y = e[1]; camR.z = e[2];
  }
  // интерфейс и кабинные сигналы не глушатся видом из кабины и паузой
  const isUi = (name) => name.startsWith('ui_') || name.startsWith('warn_') || name === 'click' || name === 'radio';

  function play(name, opts) {
    if (!ctx || !sfx) return false;
    name = String(name || '');
    let rec = sfx.R[name];
    if (!rec) { missed++; rec = sfx.R.ui_fallback; }
    const now = ctx.currentTime;
    const gap = MIN_GAP[name] == null ? 0.025 : MIN_GAP[name];
    if (last[name] != null && now - last[name] < gap) return false;
    const ui = isUi(name);
    if (voices > MAX_VOICES && !ui) return false;
    if (S.hidden || (!ui && vol.sound <= 0)) return false;
    last[name] = now;
    const o = opts || {};
    let dest = ui ? uiBus : world, t = now + 0.005, extra = null;
    // позиционный звук: затухание, приглушение верхов, панорама, задержка звука
    if (o.x != null && o.z != null) {
      readCamera();
      const dx = o.x - camPos.x, dy = (o.y || 0) - camPos.y, dz = o.z - camPos.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const size = o.size || 1, ref = name === 'explosion' ? 90 * Math.sqrt(size) : 40 * Math.sqrt(size);
      const att = ref / (ref + Math.max(0, d - 10));
      if (att < 0.012) return false;
      o.dist = d;
      const g = mkGain(ctx, att, null), f = mkFilter(ctx, 'lowpass', clamp(16000 / (1 + d / 250), 400, 16000), 0.5, null);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      g.connect(f);
      if (p) { p.pan.value = d > 1 ? clamp((dx * camR.x + dy * camR.y + dz * camR.z) / d, -0.85, 0.85) : 0; f.connect(p); p.connect(dest); } else f.connect(dest);
      dest = g; extra = [g, f, p];
      if (d > 250 && (name === 'explosion' || name === 'splash')) t += Math.min(2.5, d / 343);
    }
    let dur = 0.5;
    try { dur = rec(dest, t, o) || 0.5; } catch (e) { return false; }
    if (extra) setTimeout(() => { for (const n of extra) if (n) try { n.disconnect(); } catch (er) { /* */ } }, (t - now + dur + 0.5) * 1000);
    played++; lastName = name;
    return true;
  }

  // ------------------------------------------------------------------ двигатель игрока и чужие самолёты
  function setPlayerEngine(ac) {
    if (S.eng) { S.eng.dispose(); S.eng = null; }
    S.engAc = ac;
    if (!ac || !ac.spec) return;
    S.n = ac.onGround && (ac.throttle || 0) < 0.05 ? 0 : clamp(ac.throttle || 0.6, 0, 1);
    S.run = ac.engineOn === false ? 0 : 1;
    S.ab = 0;
    S.eng = createEngine(ctx, ac.spec, engIn, bufs);
  }

  function updateRemotes(now, dt, flying) {
    const list = G.aircraft || [], R = S.remotes;
    // три ближайших чужих самолёта в пределах 3 км
    let a0 = null, a1 = null, a2 = null, d0 = 9e6, d1 = 9e6, d2 = 9e6;
    if (flying) for (let i = 0; i < list.length; i++) {
      const ac = list[i];
      if (ac === G.player || !ac.alive || !ac.pos) continue;
      const dx = ac.pos.x - camPos.x, dy = ac.pos.y - camPos.y, dz = ac.pos.z - camPos.z, d = dx * dx + dy * dy + dz * dz;
      if (d > 9e6) continue;
      if (d < d0) { a2 = a1; d2 = d1; a1 = a0; d1 = d0; a0 = ac; d0 = d; } else if (d < d1) { a2 = a1; d2 = d1; a1 = ac; d1 = d; } else if (d < d2) { a2 = ac; d2 = d; }
    }
    const want = a2 ? 3 : a1 ? 2 : a0 ? 1 : 0;
    while (R.length < want) R.push(createRemote(ctx, world, bufs));
    const p = G.player, ref = p && S.view !== 'flyby' ? p.vel : null;
    for (let i = 0; i < R.length; i++) {
      const ac = i === 0 ? a0 : i === 1 ? a1 : a2, V = R[i];
      if (!ac) { if (V.gain > 0) V.mute(now); continue; }
      const dx = ac.pos.x - camPos.x, dy = ac.pos.y - camPos.y, dz = ac.pos.z - camPos.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      let vr = (ac.vel.x * dx + ac.vel.y * dy + ac.vel.z * dz) / d;
      if (ref) vr -= (ref.x * dx + ref.y * dy + ref.z * dz) / d;
      const dop = clamp(343 / (343 + vr), 0.6, 1.7);
      V.update(now, ac, d, dop, (dx * camR.x + dy * camR.y + dz * camR.z) / d);
    }
  }

  // ------------------------------------------------------------------ кадр
  function update(dtReal) {
    if (!ctx || !L) return;
    const dt = clamp(+dtReal || 0, 0, 0.1), now = ctx.currentTime;
    readCamera();
    const rig = G.cameraRig, view = (rig && (rig.view || rig.mode)) || 'chase';
    S.view = view;
    const p = G.player, inFlight = G.mode === 'flight';
    const paused = !!G.paused && inFlight;
    const alive = !!(p && p.alive !== false && !p.crashed);
    const flying = inFlight && !paused;
    S.cockpit = view === 'cockpit';

    // шины: пауза и вид из кабины
    setP(world.gain, paused ? 0.1 : 1, now, 0.12);
    setP(muffle.frequency, S.cockpit ? 1500 : 18000, now, 0.12);
    // музыка: только в меню / на разборе, в полёте выключена
    const mk = G.mode === 'menu' ? 1 : G.mode === 'debrief' ? 0.7 : 0;
    music.update(S.hidden ? 0 : mk * vol.music * vol.music);

    // ---- двигатель игрока
    if (inFlight && p && p !== S.engAc) setPlayerEngine(p);
    else if ((!inFlight || !p) && S.engAc) setPlayerEngine(null);
    let thr = 0, ias = 0, onGround = false;
    if (S.eng && p) {
      const spec = p.spec;
      thr = alive ? clamp(p.throttle || 0, 0, 1) : 0;
      ias = alive ? p.ias || 0 : 0;
      onGround = !!p.onGround;
      const on = alive && p.engineOn !== false;
      // обороты догоняют РУД с инерцией типа двигателя; без двигателя винт «мельничит» от набегающего потока
      const rate = SPOOL[spec.engine] || 1;
      const target = on ? thr : spec.engine === 'jet' ? 0 : clamp(ias / (spec.vMax || 100) * 0.35, 0, 0.35);
      S.n += (target - S.n) * dampK(target > S.n ? rate : rate * 0.7, dt);
      S.run += ((on ? 1 : 0) - S.run) * dampK(on ? 3 : (alive ? 0.6 : 6), dt);
      S.ab += (clamp(p.afterburner || 0, 0, 1) - S.ab) * dampK(4, dt);
      // положение камеры: в пролётной — расстояние, доплер, панорама
      let att = 1, dop = 1, pan = 0, lpF = 18000;
      if (view === 'flyby' || view === 'crash') {
        const dx = p.pos.x - camPos.x, dy = p.pos.y - camPos.y, dz = p.pos.z - camPos.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        att = clamp(50 / (50 + Math.max(0, d - 20)), 0.02, 1);
        dop = clamp(343 / (343 + (p.vel.x * dx + p.vel.y * dy + p.vel.z * dz) / d), 0.6, 1.7);
        pan = clamp((dx * camR.x + dy * camR.y + dz * camR.z) / d, -0.8, 0.8);
        lpF = clamp(18000 / (1 + d / 300), 600, 18000);
      }
      S.dop = dop;
      setP(engIn.gain, (S.cockpit ? 0.42 : 0.55) * att, now, 0.1);
      if (engPan) setP(engPan.pan, pan, now, 0.1);
      setP(engLP.frequency, lpF, now, 0.1);
      S.eng.update(now, clamp(S.n, 0, 1), on ? thr : 0, S.ab, dop, S.run);
    }

    // ---- ветер, тряска, качение, вода, дождь
    const fl = S.eng && p && inFlight;
    const wx = G.world && G.world.weather;
    if (dt > 0) {
      S.gustT -= dt;
      if (S.gustT <= 0) { S.gustT = 0.6 + Math.random() * 1.6; S.gust = Math.random() * (0.15 + 0.6 * (wx ? wx.turbulence || 0 : 0)); }
    }
    const wv = fl ? clamp((ias - 6) / 110, 0, 1.4) : 0;
    S.wind = wv * wv * (0.75 + 0.25 * S.gust + 0.2 * (p && p.gearPos > 0.5 ? 1 : 0) + 0.15 * (p ? p.flapsPos || 0 : 0) + 0.3 * (p ? p.airbrake || 0 : 0));
    const wk = S.cockpit ? 0.55 : 1;
    setP(L.windG.gain, 0.16 * S.wind * wk, now, 0.25);
    setP(L.windF.frequency, 380 + 900 * clamp(wv, 0, 1.3) + 300 * S.gust, now, 0.3);
    setP(L.windLoG.gain, 0.22 * S.wind * wk, now, 0.25);
    S.buffet = fl && alive && !onGround ? clamp(Math.max(p.buffet || 0, (p.stallWarn || 0) * 0.6), 0, 1) : 0;
    setP(L.bufG.gain, 0.55 * S.buffet, now, 0.08);
    const gs = p ? (p.gs == null ? Math.hypot(p.vel.x, p.vel.z) : p.gs) : 0;
    const land = fl && alive && onGround && !p.onWater, wet = fl && alive && onGround && p.onWater;
    const soft = land && p.surface === 'ground';
    S.roll = land ? clamp(gs / 45, 0, 1) * (p.gearPos > 0.5 ? 1 : 1.6) : 0;
    setP(L.rollG.gain, 0.5 * S.roll, now, 0.08);
    setP(L.rollF.frequency, 90 + gs * (soft ? 5 : 3.5), now, 0.1);
    setP(L.rollLfo.frequency, 2 + gs * (soft ? 0.35 : 0.12), now, 0.2);
    setP(L.rollLfoG.gain, soft ? 0.55 : 0.12, now, 0.2);
    S.water = wet ? clamp(gs / 30, 0, 1.2) * (0.6 + 0.6 * (p.planing || 0)) : 0;
    setP(L.waterG.gain, 0.35 * S.water, now, 0.1);
    setP(L.waterF.frequency, 450 + gs * 22, now, 0.15);
    S.rain = inFlight && wx ? clamp(wx.rain || 0, 0, 1) : 0;
    setP(L.rainG.gain, 0.05 * S.rain * (S.cockpit ? 1.4 : 0.8), now, 0.5);
    // стыки плит на пробеге / кочки грунта
    if (land && gs > 4 && dt > 0) {
      S.bumpAcc += gs * dt;
      const step = soft ? 9 : 26;
      if (S.bumpAcc > step) { S.bumpAcc = Math.random() * step * 0.3; play('bump', { k: clamp(0.12 + gs / (soft ? 90 : 160), 0, 0.6) }); }
    }

    // ---- моторчики шасси и закрылков
    if (fl && alive) {
      const gp = p.gearPos || 0, fp = p.flapsPos || 0;
      if (S.gearPrev >= 0) {
        const mv = Math.abs(gp - S.gearPrev) > 1e-5;
        if (S.gearMoving && !mv && (gp < 0.001 || gp > 0.999)) play('gear_lock', { k: gp > 0.5 ? 1 : 0.7 });
        S.gearMoving = mv ? 1 : 0;
        const fm = Math.abs(fp - S.flapPrev) > 1e-5;
        if (S.flapMoving && !fm) play('flap_lock');
        S.flapMoving = fm ? 1 : 0;
      }
      S.gearPrev = gp; S.flapPrev = fp;
    } else { S.gearPrev = S.flapPrev = -1; S.gearMoving = S.flapMoving = 0; }
    S.gearMotor = S.gearMoving ? 1 : 0; S.flapMotor = S.flapMoving ? 1 : 0;
    setP(L.gearG.gain, 0.09 * S.gearMotor, now, 0.06);
    setP(L.flapG.gain, 0.05 * S.flapMotor, now, 0.06);

    // ---- сигнализация (одна за раз, по приоритету)
    let warn = '';
    if (fl && alive && !onGround && (p.agl == null || p.agl > 3)) {
      const agl = p.agl == null ? 999 : p.agl, vs = p.vs || 0, spec = p.spec;
      const landingCfg = p.gearPos > 0.9 && (p.flapsPos || 0) > 0.3;
      if (p.stalled || (p.stallWarn || 0) > 0.55) warn = 'warn_stall';
      else if (agl < 280 && vs < -4 && agl / -vs < 7 && !(landingCfg && vs > -7) && !(agl < 25 && vs > -5)) warn = 'warn_terrain';
      else if (spec.retract && p.gearPos < 0.5 && agl < 150 && vs < -1.5 && (thr < 0.45 || ias < (spec.vApproach || spec.vStall * 1.4 || 40) * 1.25)) {
        const gnd = G.world && G.world.groundAt ? G.world.groundAt(p.pos.x, p.pos.z) : null;
        if (!(spec.amphibian && gnd && gnd.surface === 'water')) warn = 'warn_gear';
      }
    }
    if (warn !== S.warn) { S.warn = warn; S.warnT = 0; }
    if (warn && dt > 0) {
      S.warnT -= dt;
      if (S.warnT <= 0) { play(warn); S.warnT = warn === 'warn_stall' ? 0.55 : warn === 'warn_terrain' ? 1.0 : 1.7; }
    }

    // ---- чужие самолёты
    updateRemotes(now, dt, flying);
  }

  // ------------------------------------------------------------------ события
  const near = (ac, r) => {
    if (!ac || !ac.pos) return false;
    if (ac === G.player) return true;
    readCamera();
    const dx = ac.pos.x - camPos.x, dy = ac.pos.y - camPos.y, dz = ac.pos.z - camPos.z;
    return dx * dx + dy * dy + dz * dz < r * r;
  };
  const posOf = (ac, o) => { if (ac !== G.player || S.view === 'flyby') { o.x = ac.pos.x; o.y = ac.pos.y; o.z = ac.pos.z; } return o; };
  const bus = G.bus;
  bus.on('ac:touchdown', (e) => {
    const ac = e && e.ac;
    if (!near(ac, 800)) return;
    if ((e.surface || ac.surface) === 'water') play('splash', posOf(ac, { size: clamp(0.6 + Math.abs(e.vs || 0) * 0.3 + (e.speed || 0) / 60, 0.6, 3) }));
    else play('touchdown', posOf(ac, { vs: e.vs, speed: e.speed, gearDown: e.gearDown }));
  });
  bus.on('ac:crash', (e) => {
    // взрыв и всплеск озвучивает fx (через play); здесь — только глушим двигатель
    if (e && e.ac === G.player) S.run = Math.min(S.run, 0.3);
  });
  bus.on('ac:damage', (e) => { if (e && e.ac === G.player && (e.amount || 0) > 0.5) play('hit'); });
  bus.on('weapon:fire', (e) => {
    const ac = e && e.ac, w = e && e.weapon;
    if (!near(ac, 1500)) return;
    const t = typeof w === 'string' ? w : (w && (w.type || w.id)) || 'gun';
    const name = t === 'gun' || t === 'cannon' ? 'gun' : t === 'aam' || t === 'rocket' || t === 'missile' ? 'missile' : t === 'flare' ? 'flare' : 'drop';
    play(name, posOf(ac, {}));
  });
  bus.on('world:lightning', (e) => {
    if (!ctx || G.mode !== 'flight') return;
    const d = e && e.dist != null ? e.dist : 3000;
    if (d > 14000) return;
    setTimeout(() => play('thunder', { dist: d }), Math.min(7, d / 343) * 1000);
  });
  bus.on('radio', () => play('radio'));
  bus.on('settings:changed', () => { readVolumes(); applyVolumes(); });
  bus.on('pause', (e) => { S.paused = !!(e && e.paused); });
  bus.on('flight:end', () => { S.warn = ''; });
  if (typeof document !== 'undefined') {
    const vis = () => {
      S.hidden = document.hidden;
      if (!ctx) return;
      try {
        if (S.hidden) ctx.suspend();
        else if (unlocked) { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); }
      } catch (e) { /* */ }
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', () => { S.hidden = true; if (ctx) try { ctx.suspend(); } catch (e) { /* */ } });
    window.addEventListener('pageshow', vis);
  }

  // ------------------------------------------------------------------ отладка
  const r3 = (v) => (v === v ? Math.round(v * 1000) / 1000 : 'NaN');
  function debug() {
    const ei = S.eng ? S.eng.info : null;
    return {
      state: ctx ? ctx.state : 'none', unlocked, voices, played, last: lastName, unknown: missed,
      engine: ei ? { type: S.eng.type, freq: r3(ei.f), gain: r3(ei.vol), n: r3(S.n), run: r3(S.run), ab: r3(S.ab), dop: r3(S.dop) } : null,
      wind: r3(S.wind), buffet: r3(S.buffet), roll: r3(S.roll), water: r3(S.water), rain: r3(S.rain),
      gearMotor: S.gearMotor, flapMotor: S.flapMotor, warn: S.warn, view: S.view || '',
      music: music ? { on: music.on, level: r3(music.level) } : null,
      remotes: S.remotes.map((v) => r3(v.info.vol)),
      volume: { sound: vol.sound, music: vol.music }, nan: stats.nan, sets: stats.sets,
    };
  }

  return {
    unlock, play, setVolume, update, debug,
    get ctx() { return ctx; },
    names() { return sfx ? Object.keys(sfx.R) : []; },
  };
}
