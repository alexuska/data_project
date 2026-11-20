// ЗВУК: синтез двигателей (поршневой / турбовинтовой / реактивный) и общие помощники WebAudio.
// Каждый голос — постоянный граф узлов, создаётся один раз; в кадре меняются только параметры (setTargetAtTime).
export const stats = { nan: 0, sets: 0 };

// плавная установка параметра; пропускает незначимые изменения и не пускает NaN в граф
export function setP(param, value, now, tc = 0.06) {
  if (!(value === value) || value === Infinity || value === -Infinity) { stats.nan++; return; }
  const last = param._v;
  if (last !== undefined && Math.abs(value - last) <= Math.abs(last) * 0.004 + 1e-5) return;
  param._v = value;
  stats.sets++;
  param.setTargetAtTime(value, now, tc);
}

export function mkGain(ctx, v, dest) {
  const g = ctx.createGain();
  g.gain.value = v;
  g.gain._v = v;
  if (dest) g.connect(dest);
  return g;
}
export function mkFilter(ctx, type, f, q, dest) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.frequency._v = f; b.Q.value = q == null ? 0.7 : q;
  if (dest) b.connect(dest);
  return b;
}
export function mkOsc(ctx, type, f, dest, list) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = f; o.frequency._v = f;
  if (dest) o.connect(dest);
  o.start();
  if (list) list.push(o);
  return o;
}
export function mkNoise(ctx, buf, dest, rate, list) {
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true;
  s.playbackRate.value = rate || 1; s.playbackRate._v = rate || 1;
  if (dest) s.connect(dest);
  s.start(0, Math.random() * (buf.duration - 0.1));
  if (list) list.push(s);
  return s;
}
function shaper(ctx, drive) {
  const w = ctx.createWaveShaper(), n = 257, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  w.curve = c;
  return w;
}

// Паспорта звучания. Поршневые: число цилиндров, обороты вала (мал. газ / взлётный), редукция, лопасти.
const PISTON = {
  yak52: { cyl: 9, idle: 720, max: 2900, gear: 0.658, blades: 2, lp: [420, 2300], am: 0.34, sub: 0.35, noise: 0.16, drive: 2.2, level: 0.95 },   // М-14П: звонкий, «рычащий»
  an2: { cyl: 9, idle: 520, max: 2200, gear: 0.6875, blades: 4, lp: [300, 1500], am: 0.5, sub: 0.7, noise: 0.3, drive: 3, level: 1.1 },         // АШ-62ИР: низкий, тяжёлый, «тарахтит»
  def: { cyl: 12, idle: 650, max: 2800, gear: 0.5, blades: 3, lp: [380, 2000], am: 0.4, sub: 0.5, noise: 0.22, drive: 2.5, level: 1 },
};
const TPROP = {
  l410: { rpm: 2080, blades: 5, whine: 3900, level: 0.9 },   // Walter M601 + В-510
  def: { rpm: 1100, blades: 4, whine: 3200, level: 1 },
};

// out — узел-приёмник. Возвращает { type, update(now, n, thr, ab, dop, vol), dispose(), info }
// n — «обороты» 0..1 (уже сглаженные), thr — тяга 0..1, ab — форсаж 0..1, dop — доплеровский множитель частоты, vol — громкость
export function createEngine(ctx, spec, out, bufs) {
  const src = [];
  const g = mkGain(ctx, 0, out);
  const E = { type: spec.engine, out: g, info: { f: 0, vol: 0, n: 0 } };
  const ne = spec.engines || 1, dens = 1 + 0.14 * Math.min(3, ne - 1);

  if (spec.engine === 'piston') {
    const c = PISTON[spec.id] || PISTON.def;
    const am = mkGain(ctx, 0.7, g);
    const lp = mkFilter(ctx, 'lowpass', c.lp[0], 1.1, am);
    const ws = shaper(ctx, c.drive);
    ws.connect(lp);
    const mix = mkGain(ctx, 0.5, ws);
    const oA = mkOsc(ctx, 'sawtooth', 60, mkGain(ctx, 0.6, mix), src);
    const oB = mkOsc(ctx, 'square', 30, mkGain(ctx, c.sub, mix), src);
    const oC = mkOsc(ctx, 'sawtooth', 90, mkGain(ctx, 0.22, mix), src);      // «неровность» звезды: полуторная гармоника
    const lfo = mkOsc(ctx, 'sawtooth', 10, null, src);
    const lfoG = mkGain(ctx, c.am, am.gain);
    lfo.connect(lfoG);
    // выхлоп
    const nG = mkGain(ctx, 0, am);
    const nF = mkFilter(ctx, 'bandpass', 300, 0.8, nG);
    mkNoise(ctx, bufs.brown, nF, 1, src);
    // винт
    const pG = mkGain(ctx, 0, g);
    const pF = mkFilter(ctx, 'lowpass', 400, 0.7, pG);
    const oP = mkOsc(ctx, 'triangle', 40, pF, src);
    const oP2 = ne > 1 ? mkOsc(ctx, 'triangle', 40, pF, src) : null;
    E.update = (now, n, thr, ab, dop, vol) => {
      const rpm = c.idle + (c.max - c.idle) * n, crank = rpm / 60, f = crank * c.cyl * 0.5 * dop;
      setP(oA.frequency, f, now); setP(oB.frequency, f * 0.5, now); setP(oC.frequency, f * 1.5 * 1.003, now);
      setP(lfo.frequency, crank * 0.5 * dop, now);
      setP(lfoG.gain, c.am * (1 - 0.45 * n), now, 0.2);
      setP(lp.frequency, (c.lp[0] + (c.lp[1] - c.lp[0]) * (0.25 * n + 0.75 * thr * n)) * dop, now, 0.1);
      setP(nF.frequency, Math.min(4000, f * 2.2), now, 0.1);
      setP(nG.gain, c.noise * (0.4 + 0.9 * thr), now, 0.1);
      const bp = crank * c.gear * c.blades * dop;
      setP(oP.frequency, bp, now); if (oP2) setP(oP2.frequency, bp * 1.011, now);
      setP(pF.frequency, bp * 5, now, 0.1);
      setP(pG.gain, 0.2 + 0.5 * n, now, 0.1);
      setP(g.gain, vol * c.level * dens * (0.3 + 0.7 * (0.35 * n + 0.65 * thr)), now, 0.08);
      E.info.f = f; E.info.vol = g.gain._v; E.info.n = n; E.info.rpm = Math.round(rpm);
    };
  } else if (spec.engine === 'turboprop') {
    const c = TPROP[spec.id] || TPROP.def;
    const bp0 = (c.rpm / 60) * c.blades;
    const pG = mkGain(ctx, 0, g);
    const pF = mkFilter(ctx, 'lowpass', 600, 0.9, pG);
    const ws = shaper(ctx, 1.6);
    ws.connect(pF);
    const mix = mkGain(ctx, 0.5, ws);
    const o1 = mkOsc(ctx, 'sawtooth', bp0, mkGain(ctx, 0.5, mix), src);
    const o2 = mkOsc(ctx, 'sawtooth', bp0, mkGain(ctx, 0.5, mix), src);      // второй винт чуть расстроен — характерные биения
    const o3 = mkOsc(ctx, 'sine', bp0 * 0.5, mkGain(ctx, 0.3, mix), src);
    const wG = mkGain(ctx, 0, g);
    const w1 = mkOsc(ctx, 'sine', c.whine, wG, src);
    const w2 = mkOsc(ctx, 'triangle', c.whine * 1.335, mkGain(ctx, 0.4, wG), src);
    const hG = mkGain(ctx, 0, g);
    const hF = mkFilter(ctx, 'bandpass', 3200, 0.6, hG);
    mkNoise(ctx, bufs.white, hF, 1, src);
    const rG = mkGain(ctx, 0, g);
    const rF = mkFilter(ctx, 'lowpass', 260, 0.7, rG);
    mkNoise(ctx, bufs.brown, rF, 1, src);
    E.update = (now, n, thr, ab, dop, vol) => {
      const k = 0.72 + 0.28 * n, f = bp0 * k * dop;
      setP(o1.frequency, f, now); setP(o2.frequency, f * 1.0065, now); setP(o3.frequency, f * 0.5, now);
      setP(pF.frequency, (500 + 1100 * thr) * dop, now, 0.1);
      setP(pG.gain, 0.3 + 0.7 * thr, now, 0.1);
      const fw = c.whine * (0.5 + 0.5 * n) * dop;
      setP(w1.frequency, fw, now); setP(w2.frequency, fw * 1.335, now);
      setP(wG.gain, 0.035 + 0.02 * (1 - thr), now, 0.1);
      setP(hF.frequency, (2400 + 1600 * n) * dop, now, 0.1);
      setP(hG.gain, 0.08 + 0.14 * n, now, 0.1);
      setP(rG.gain, 0.25 * thr + 0.05, now, 0.1);
      setP(g.gain, vol * c.level * dens * (0.35 + 0.65 * (0.4 * n + 0.6 * thr)), now, 0.08);
      E.info.f = f; E.info.vol = g.gain._v; E.info.n = n;
    };
  } else {
    // реактивный: размер двигателя задаёт «рост» — большие Д-30 ниже и гуще, маленький АИ-25 свистит
    const per = (spec.thrustDry || spec.thrust || 50000) / ne;
    const big = Math.max(0, Math.min(1, (Math.log10(per) - 4.15) / 0.95));   // 14 кН -> 0, 125 кН -> 1
    const mil = spec.role === 'military' ? 1 : 0;
    const whine0 = 5200 - 2500 * big;
    const rG = mkGain(ctx, 0, g);
    const rF = mkFilter(ctx, 'lowpass', 200, 0.6, rG);
    mkNoise(ctx, bufs.brown, rF, 1, src);
    const hG = mkGain(ctx, 0, g);
    const hF = mkFilter(ctx, 'bandpass', 1800, 0.5, hG);
    mkNoise(ctx, bufs.white, hF, 1, src);
    let h2F = null;
    if (ne > 1) { h2F = mkFilter(ctx, 'bandpass', 1300, 0.9, mkGain(ctx, 0.6, hG)); mkNoise(ctx, bufs.white, h2F, 0.83, src); }
    const wG = mkGain(ctx, 0, g);
    const w1 = mkOsc(ctx, 'sine', whine0, wG, src);
    const w2 = mkOsc(ctx, 'triangle', whine0 * 1.5, mkGain(ctx, 0.35, wG), src);
    const w3 = ne > 1 ? mkOsc(ctx, 'sine', whine0 * 1.01, mkGain(ctx, 0.7, wG), src) : null;
    const cG = mkGain(ctx, 0, g);
    const c1 = mkOsc(ctx, 'sine', 70, cG, src);
    // «пила» вентилятора у больших двигателей
    const bG = mkGain(ctx, 0, g);
    const bF = mkFilter(ctx, 'bandpass', 500, 2, bG);
    const b1 = big > 0.45 ? mkOsc(ctx, 'sawtooth', 110, bF, src) : null;
    // форсаж
    let aG = null, aF = null, kG = null, kAm = null;
    if (spec.afterburner) {
      aG = mkGain(ctx, 0, g);
      aF = mkFilter(ctx, 'lowpass', 150, 1.6, aG);
      mkNoise(ctx, bufs.brown, aF, 0.7, src);
      kG = mkGain(ctx, 0, g);
      kAm = mkGain(ctx, 0.5, kG);
      const kF = mkFilter(ctx, 'bandpass', 520, 0.7, kAm);
      mkNoise(ctx, bufs.white, kF, 0.6, src);
      const l1 = mkOsc(ctx, 'sawtooth', 13.3, null, src), l2 = mkOsc(ctx, 'triangle', 7.7, null, src);
      const lg = mkGain(ctx, 0.3, kAm.gain);
      l1.connect(lg); l2.connect(lg);
    }
    E.update = (now, n, thr, ab, dop, vol) => {
      const t2 = thr * thr;
      setP(rF.frequency, (150 + (700 + 500 * mil - 250 * big) * Math.pow(thr, 1.4)) * dop, now, 0.12);
      setP(rG.gain, (0.12 + 0.95 * t2) * (0.85 + 0.3 * big), now, 0.12);
      setP(hF.frequency, (1500 + 1500 * n - 500 * big) * dop, now, 0.12);
      if (h2F) setP(h2F.frequency, (1100 + 900 * n) * dop, now, 0.12);
      setP(hG.gain, 0.035 + 0.24 * t2, now, 0.12);
      const fw = whine0 * (0.42 + 0.58 * n) * dop;
      setP(w1.frequency, fw, now); setP(w2.frequency, fw * 1.5, now); if (w3) setP(w3.frequency, fw * 1.013, now);
      setP(wG.gain, (0.05 - 0.036 * thr) * (1.25 - 0.5 * big) * (0.3 + 0.7 * n), now, 0.15);
      setP(c1.frequency, (48 + 40 * n) * dop, now);
      setP(cG.gain, 0.06 + 0.1 * thr, now, 0.15);
      if (b1) {
        const fb = (70 + 90 * n) * dop;
        setP(b1.frequency, fb, now); setP(bF.frequency, fb * 4, now, 0.1);
        setP(bG.gain, 0.05 * big * Math.max(0, thr - 0.35), now, 0.2);
      }
      if (aG) {
        setP(aG.gain, 1.5 * ab, now, 0.1);
        setP(aF.frequency, (120 + 80 * ab) * dop, now, 0.1);
        setP(kG.gain, 0.5 * ab, now, 0.1);
      }
      setP(g.gain, vol * dens * (0.9 + 0.2 * mil), now, 0.08);
      E.info.f = fw; E.info.vol = g.gain._v; E.info.n = n; E.info.roar = rG.gain._v; E.info.ab = ab;
    };
  }

  E.dispose = () => {
    const t = ctx.currentTime;
    try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.05); } catch (e) { /* контекст закрыт */ }
    setTimeout(() => {
      for (const s of src) { try { s.stop(); s.disconnect(); } catch (e) { /* уже остановлен */ } }
      try { g.disconnect(); } catch (e) { /* */ }
    }, 400);
  };
  return E;
}

// Упрощённый голос чужого самолёта: шум + тон, панорама, доплер, приглушение расстоянием.
export function createRemote(ctx, out, bufs) {
  const src = [];
  const g = mkGain(ctx, 0, out);
  const dl = mkFilter(ctx, 'lowpass', 8000, 0.5, g);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) pan.connect(dl);
  const bus = pan || dl;
  const nG = mkGain(ctx, 0, bus);
  const nF = mkFilter(ctx, 'bandpass', 500, 0.5, nG);
  mkNoise(ctx, bufs.brown, nF, 1, src);
  const hG = mkGain(ctx, 0, bus);
  const hF = mkFilter(ctx, 'bandpass', 1800, 0.6, hG);
  mkNoise(ctx, bufs.white, hF, 1, src);
  const oG = mkGain(ctx, 0, bus);
  const oF = mkFilter(ctx, 'lowpass', 700, 0.8, oG);
  const o1 = mkOsc(ctx, 'sawtooth', 100, oF, src);
  const o2 = mkOsc(ctx, 'sawtooth', 101, oF, src);
  const V = { ac: null, gain: 0, info: { vol: 0, dop: 1, pan: 0 } };
  // dist м, dop — доплер, p — панорама −1..1
  V.update = (now, ac, dist, dop, p) => {
    const spec = ac.spec, thr = 0.3 + 0.7 * (ac.throttle || 0), ne = spec.engines || 1;
    const size = Math.min(2.2, 0.6 + Math.sqrt((spec.thrust || 20000) / 60000));
    const vol = Math.min(1, (60 * size) / (60 + dist)) * thr;
    if (spec.engine === 'jet') {
      setP(nF.frequency, (280 + 500 * thr) * dop, now, 0.1);
      setP(nG.gain, 1, now, 0.1);
      setP(hF.frequency, 1900 * dop, now, 0.1);
      setP(hG.gain, 0.3 * thr, now, 0.1);
      setP(o1.frequency, 2600 * dop, now, 0.1); setP(o2.frequency, 2630 * dop, now, 0.1);
      setP(oF.frequency, 6000, now, 0.1);
      setP(oG.gain, 0.012, now, 0.1);
    } else {
      const f = (spec.engine === 'turboprop' ? 150 : 95 + 60 * thr) * dop * (ne > 1 ? 1.1 : 1);
      setP(o1.frequency, f, now, 0.1); setP(o2.frequency, f * 1.008, now, 0.1);
      setP(oF.frequency, (500 + 700 * thr) * dop, now, 0.1);
      setP(oG.gain, 0.5, now, 0.1);
      setP(nF.frequency, 300 * dop, now, 0.1);
      setP(nG.gain, 0.5, now, 0.1);
      setP(hG.gain, spec.engine === 'turboprop' ? 0.12 : 0.02, now, 0.1);
    }
    setP(dl.frequency, Math.max(350, 9000 / (1 + dist / 350)), now, 0.1);
    if (pan) setP(pan.pan, Math.max(-0.9, Math.min(0.9, p)), now, 0.1);
    setP(g.gain, vol, now, 0.12);
    V.gain = vol; V.info.vol = vol; V.info.dop = dop; V.info.pan = p;
  };
  V.mute = (now) => { setP(g.gain, 0, now, 0.15); V.gain = 0; V.info.vol = 0; };
  return V;
}
