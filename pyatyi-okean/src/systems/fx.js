// ЭФФЕКТЫ. Контракт — в ARCHITECTURE.md; GPU-часть — в fx-gpu.js.
// Вызываемое API:
//   explosion(pos, size)            — вспышка + огненный шар + дым + искры (+ пыль у земли), тряска камеры, звук
//   smokePuff(pos, opts)            — opts { size, color, alpha, life, vel, rise, count, spread, grow }
//   splash(pos, size), dust(pos, size)
//   tracer(from, to, opts)          — opts { color, speed (м/с), length (м), width (м) }
//   fire(pos, size, opts) -> { pos, size, stop(), setIntensity(k), alive }   opts { ttl (с), smoke: bool }
//   waterDrop(pos, vel, amount)     — amount: кг воды за этот вызов (можно звать каждый кадр)
//   trail(opts) -> { push(pos), end() }   opts { color, width, life, grow, alpha, wobble, glow }
//   flare(pos, vel) -> { pos, alive }     debris(pos, opts { count, speed, size })
//   sparks(pos, opts { count, speed, dir })   clear(), update(dt), debug()
// Автоматически (сами следят за G.aircraft и шиной): инверсионный след, законцовочные жгуты, дымление старых двигателей,
// дым/огонь повреждений, касание (дым покрышек / пыль / брызги), пыль на грунте, брызги глиссирования, конус пара у M≈1,
// авария (взрыв + горящие обломки или всплеск), сбитые самолёты и уничтоженные цели, тени самолётов на земле.
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/util.js';
import { FXU, createParticles, createRibbons, createTracers, createShadows } from './fx-gpu.js';

const QUALITY = {
  low: { particles: 1400, density: 0.6, slots: 10, K: 32, tracers: 96, contrailLife: 16, shadows: 12 },
  medium: { particles: 2800, density: 1, slots: 18, K: 48, tracers: 192, contrailLife: 24, shadows: 20 },
  high: { particles: 5200, density: 1.4, slots: 30, K: 64, tracers: 320, contrailLife: 34, shadows: 28 },
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _c = new THREE.Color(), _sc = new THREE.Vector3();
const rnd = Math.random;
const rs = () => rnd() * 2 - 1;
const HUMID = { fog: 1, overcast: 1, rain: 1, storm: 1, snow: 1 };
const NOOP_TRAIL = { push() {}, pushXYZ() {}, end() {}, setAlpha() {}, dummy: true };

export function createFx(G) {
  const group = new THREE.Group();
  group.name = 'fx';
  G.scene.add(group);

  let Q = QUALITY[G.quality.level] || QUALITY.medium;
  let P = null, R = null, T = null, S = null;
  function build() {
    for (const s of [P, R, T, S]) if (s) { group.remove(s.mesh); s.dispose(); }
    Q = QUALITY[G.quality.level] || QUALITY.medium;
    P = createParticles(Q.particles);
    R = createRibbons(Q.slots, Q.K);
    T = createTracers(Q.tracers);
    S = createShadows(Q.shadows);
    group.add(S.mesh, R.mesh, P.mesh, T.mesh);
  }
  build();

  let time = 0;
  const cam = { x: 0, y: 0, z: 0 };
  const camD2 = (x, y, z) => { const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z; return dx * dx + dy * dy + dz * dz; };
  const groundY = (x, z) => { const w = G.world; return w && w.groundAt ? w.groundAt(x, z).y : 0; };
  // число частиц с учётом качества (дробная часть — вероятностью)
  const cnt = (n) => { const v = n * Q.density, f = Math.floor(v); return f + (rnd() < v - f ? 1 : 0); };

  // ------------------------------------------------------------------ разовые эффекты
  const recentEx = [];
  for (let i = 0; i < 8; i++) recentEx.push({ t: -9, x: 0, y: 0, z: 0, s: 0 });
  let exHead = 0;
  function explosionNear(x, y, z, r, dt) {
    for (let i = 0; i < 8; i++) {
      const e = recentEx[i];
      if (time - e.t > dt) continue;
      const dx = e.x - x, dy = e.y - y, dz = e.z - z, rr = r + e.s * 6;
      if (dx * dx + dy * dy + dz * dz < rr * rr) return true;
    }
    return false;
  }

  function explosion(pos, size = 1) {
    const x = pos.x, y = pos.y, z = pos.z, s = clamp(+size || 1, 0.2, 12);
    if (explosionNear(x, y, z, 2, 0.12)) return;
    const e = recentEx[exHead]; exHead = (exHead + 1) % 8;
    e.t = time; e.x = x; e.y = y; e.z = z; e.s = s;
    const d = Math.sqrt(camD2(x, y, z));
    if (d < 4000 + s * 2500) {
      const gy = groundY(x, z), low = y - gy < 5 * s, fl = gy - 0.5, q = Math.sqrt(s);
      // вспышка
      P.spawn(x, y + s, z, 0, 0, 0, 0.16, 7 * s, 15 * s, 1, 0.85, 0.5, 1, 0, 0, 1, 0, fl);
      // огненный шар
      for (let i = cnt(8); i > 0; i--) {
        const vx = rs() * 7 * q, vy = (low ? rnd() * 0.9 + 0.2 : rs()) * 8 * q, vz = rs() * 7 * q;
        P.spawn(x + rs() * s, y + rnd() * s, z + rs() * s, vx, vy, vz, 0.55 + rnd() * 0.6, 2.2 * s, (4.5 + rnd() * 2) * s,
          1, 0.34 + rnd() * 0.25, 0.05, 0.95, 2.6, 3, 1, 1, fl);
      }
      // дым
      for (let i = cnt(9); i > 0; i--) {
        const g = 0.025 + rnd() * 0.04;
        P.spawn(x + rs() * 1.5 * s, y + rnd() * 1.5 * s, z + rs() * 1.5 * s, rs() * 5 * q, (low ? rnd() : rs()) * 5 * q + 2, rs() * 5 * q,
          (2.6 + rnd() * 2.6) * q, 2.5 * s, (7 + rnd() * 4) * s, g, g, g * 1.1, 0.85, 1.1, 1.6, 0, 0.2, fl);
      }
      // искры и мелкие обломки
      if (d < 2500) for (let i = cnt(12); i > 0; i--) {
        const a = rnd() * 6.283, el = low ? rnd() * 1.2 + 0.15 : rs() * 1.5, sp = (14 + rnd() * 26) * q, ce = Math.cos(el);
        P.spawn(x, y + 0.5, z, Math.cos(a) * ce * sp, Math.sin(el) * sp, Math.sin(a) * ce * sp, 0.9 + rnd() * 1.3, 0.45 * q, 0.12 * q,
          1, 0.6 + rnd() * 0.3, 0.2, 1, 0.35, -9.8, 1, 0.9, fl);
      }
      // кольцо пыли у земли
      if (low) for (let i = cnt(7); i > 0; i--) {
        const a = rnd() * 6.283, sp = (5 + rnd() * 6) * q;
        P.spawn(x, gy + 0.6 * s, z, Math.cos(a) * sp, 0.8, Math.sin(a) * sp, 2.2 + rnd() * 1.5, 1.6 * s, 5.5 * s, 0.36, 0.28, 0.2, 0.55, 1.8, 0.5, 0, 0, fl);
      }
    }
    const k = (s * 55) / (d + 25);
    if (k > 0.04) G.cameraRig?.shake?.(clamp(k, 0, 1));
    G.audio?.play?.('explosion', { x, y, z, size: s });
  }

  function setColor(c, dr, dg, db) {
    if (c == null) { _c.setRGB(dr, dg, db); return _c; }
    if (Array.isArray(c)) { _c.setRGB(c[0], c[1], c[2]); return _c; }
    if (c.isColor) return _c.copy(c);
    return _c.set(c);
  }

  function smokePuff(pos, o) {
    o = o || NOOP_TRAIL;
    const size = o.size || 3;
    if (camD2(pos.x, pos.y, pos.z) > 3e7 + size * size * 4e5) return;
    const c = setColor(o.color, 0.3, 0.3, 0.32), life = o.life || 2.5, sp = o.spread == null ? size * 0.4 : o.spread;
    const v = o.vel, rise = o.rise == null ? 1.2 : o.rise, n = o.count || 1, a = o.alpha == null ? 0.6 : o.alpha, grow = o.grow || 2.4;
    for (let i = 0; i < n; i++) {
      P.spawn(pos.x + rs() * sp, pos.y + rs() * sp, pos.z + rs() * sp, (v ? v.x : 0) + rs() * 0.6, (v ? v.y : 0) + rnd() * 0.6, (v ? v.z : 0) + rs() * 0.6,
        life * (0.8 + rnd() * 0.4), size, size * grow, c.r, c.g, c.b, a, 1.4, rise * 1.4, 0, 0.1, -1e6);
    }
  }

  function splash(pos, size = 1, quiet) {
    const x = pos.x, z = pos.z, s = clamp(+size || 1, 0.2, 14), q = Math.sqrt(s);
    if (camD2(x, pos.y, z) > 2.5e7 + s * 4e6) return;
    const y = pos.y;
    for (let i = cnt(10); i > 0; i--) {
      const a = rnd() * 6.283, h = rnd() * 3 * q, up = (7 + rnd() * 9) * q;
      P.spawn(x + Math.cos(a) * s * 0.6, y + 0.3, z + Math.sin(a) * s * 0.6, Math.cos(a) * h, up, Math.sin(a) * h, 1.1 + rnd() * 0.9 + q * 0.25,
        0.9 * s, (1.8 + rnd()) * s, 0.82, 0.9, 0.97, 0.9, 0.5, -9.8, 0, 0, y - 0.2);
    }
    for (let i = cnt(6); i > 0; i--) {
      const a = rnd() * 6.283, h = (3 + rnd() * 4) * q;
      P.spawn(x, y + 0.5 * s, z, Math.cos(a) * h, 0.6, Math.sin(a) * h, 2 + rnd() * 1.4, 1.8 * s, 5.5 * s, 0.85, 0.92, 0.98, 0.42, 2, 0.2, 0, 0, y);
    }
    if (!quiet) G.audio?.play?.('splash', { x, y, z, size: s });
  }

  function dust(pos, size = 1, vx = 0, vz = 0) {
    const x = pos.x, y = pos.y, z = pos.z, s = clamp(+size || 1, 0.2, 12);
    if (camD2(x, y, z) > 1.6e7) return;
    for (let i = cnt(5); i > 0; i--) {
      const a = rnd() * 6.283, h = 1.5 + rnd() * 3.5, g = 0.85 + rnd() * 0.3;
      P.spawn(x + rs() * s, y + 0.4 * s, z + rs() * s, vx + Math.cos(a) * h, 1 + rnd(), vz + Math.sin(a) * h, 2.4 + rnd() * 1.8,
        1.4 * s, (4 + rnd() * 2) * s, 0.4 * g, 0.31 * g, 0.21 * g, 0.5, 1.5, 0.5, 0, 0, y - 0.3);
    }
  }

  function sparks(pos, o) {
    o = o || NOOP_TRAIL;
    const n = cnt(o.count || 8), sp = o.speed || 14, dir = o.dir, fl = groundY(pos.x, pos.z) - 0.2;
    if (camD2(pos.x, pos.y, pos.z) > 4e6) return;
    for (let i = 0; i < n; i++) {
      P.spawn(pos.x, pos.y, pos.z, (dir ? dir.x * sp * 0.6 : 0) + rs() * sp * 0.5, (dir ? dir.y * sp * 0.6 : 0) + rnd() * sp * 0.6, (dir ? dir.z * sp * 0.6 : 0) + rs() * sp * 0.5,
        0.35 + rnd() * 0.6, 0.3, 0.08, 1, 0.65 + rnd() * 0.3, 0.25, 1, 0.6, -9.8, 1, 0.8, fl);
    }
  }

  function tracer(from, to, o) {
    if (camD2(from.x, from.y, from.z) > 5e7 && camD2(to.x, to.y, to.z) > 5e7) return;
    const c = setColor(o && o.color, 1, 0.62, 0.18);
    T.spawn(from.x, from.y, from.z, to.x, to.y, to.z, (o && o.speed) || 950, (o && o.length) || 42, (o && o.width) || 0.32, c.r, c.g, c.b);
  }

  // ------------------------------------------------------------------ очаги огня
  const fires = [];
  function fire(pos, size = 1, o) {
    const f = {
      pos: new THREE.Vector3(pos.x, pos.y, pos.z), size: clamp(+size || 1, 0.2, 12), intensity: 1, alive: true,
      ttl: o && o.ttl ? o.ttl : Infinity, smoke: !(o && o.smoke === false), flames: !(o && o.flames === false),
      _f: rnd(), _s: rnd(), _e: 0, _auto: !!(o && o.auto),
      stop() { f.alive = false; },
      setIntensity(k) { f.intensity = clamp(+k || 0, 0, 3); },
    };
    if (fires.length >= 40) { fires[0].alive = false; fires.shift(); }
    fires.push(f);
    return f;
  }
  function fireNear(x, y, z, r) {
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      if (f.alive && Math.abs(f.pos.x - x) < r && Math.abs(f.pos.z - z) < r && Math.abs(f.pos.y - y) < r * 2) return f;
    }
    return null;
  }
  function updateFires(dt) {
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i];
      f.ttl -= dt;
      if (!f.alive || f.ttl <= 0) { f.alive = false; fires.splice(i, 1); continue; }
      const k = f.intensity * (f.ttl < 8 ? f.ttl / 8 : 1);
      if (k <= 0.02) continue;
      const p = f.pos, s = f.size, q = Math.sqrt(s), d2 = camD2(p.x, p.y, p.z);
      if (d2 > 1.7e8) continue;
      const lod = d2 < 6e5 ? 1 : d2 < 9e6 ? 0.55 : 0.28;
      if (f.flames && d2 < 1.2e7) {
        f._f += dt * 9 * lod * (0.4 + 0.6 * k) * Q.density;
        while (f._f >= 1) {
          f._f -= 1;
          const hot = rnd() < 0.3;
          P.spawn(p.x + rs() * 0.55 * s, p.y + rnd() * 0.4 * s, p.z + rs() * 0.55 * s, rs() * 0.6, (2.2 + rnd() * 2) * q, rs() * 0.6, 0.55 + rnd() * 0.5,
            (1.3 + rnd() * 0.6) * s * (0.6 + 0.4 * k) / Math.sqrt(lod), 0.4 * s, 1, hot ? 0.6 : 0.3, hot ? 0.14 : 0.04, 0.9, 0.4, 3, 1, 0.85, -1e6);
        }
        // тлеющее основание — чтобы очаг не «мигал»
        f._e += dt;
        if (f._e > 0.2) {
          f._e = 0;
          P.spawn(p.x, p.y + 0.5 * s, p.z, 0, 0.4, 0, 0.5, 2.6 * s * (0.5 + 0.5 * k), 2.2 * s, 1, 0.26, 0.04, 0.5, 0, 0, 1, 0.3, -1e6);
          if (lod === 1 && rnd() < 0.5) P.spawn(p.x + rs() * s, p.y + s, p.z + rs() * s, rs() * 2, (4 + rnd() * 5) * q, rs() * 2, 1 + rnd(), 0.22, 0.08, 1, 0.6, 0.2, 1, 0.5, -2, 1, 0.8, -1e6);
        }
      }
      if (f.smoke) {
        f._s += dt * 2.6 * lod * (0.5 + 0.5 * k) * Q.density;
        while (f._s >= 1) {
          f._s -= 1;
          const g = 0.022 + rnd() * 0.03, rise = (3 + rnd() * 1.5) * q, far = 1 / Math.sqrt(lod);
          P.spawn(p.x + rs() * 0.5 * s, p.y + (1 + rnd()) * s, p.z + rs() * 0.5 * s, rs() * 0.7, rise, rs() * 0.7, (7 + rnd() * 4) * Math.min(2.2, q),
            1.7 * s * far, (6 + rnd() * 3) * s * far, g, g, g * 1.15, 0.78 * (0.5 + 0.5 * Math.min(1, k)), 0.16, rise * 0.16, 0, 0.1, -1e6);
        }
      }
    }
  }

  // ------------------------------------------------------------------ вода пожарного самолёта
  const sched = [];
  for (let i = 0; i < 32; i++) sched.push({ t: -1, x: 0, y: 0, z: 0, s: 1, kind: 0 });
  let lastMist = -1;
  function schedule(t, x, y, z, s, kind) {
    for (let i = 0; i < 32; i++) if (sched[i].t < 0) { const e = sched[i]; e.t = t; e.x = x; e.y = y; e.z = z; e.s = s; e.kind = kind; return; }
  }
  function waterDrop(pos, vel, amount) {
    const gy = groundY(pos.x, pos.z), h = Math.max(1, pos.y - gy), k = 0.4;
    const tf = clamp(h / 21 + 0.8, 0.8, 14);
    const vx = vel ? vel.x : 0, vy = vel ? vel.y : 0, vz = vel ? vel.z : 0;
    const am = +amount > 1 ? +amount : 300;
    if (camD2(pos.x, pos.y, pos.z) < 6e7) {
      for (let i = cnt(clamp(am / 110, 1, 9)); i > 0; i--) {
        const b = 0.8 + rnd() * 0.2;
        P.spawn(pos.x + rs() * 2, pos.y - 1 + rs(), pos.z + rs() * 2, vx * 0.92 + rs() * 2.5, vy * 0.5 - 2 + rs() * 2, vz * 0.92 + rs() * 2.5, tf * 1.25 + rnd(),
          2.2, 7 + rnd() * 4, 0.74 * b, 0.86 * b, 0.97 * b, 0.6, k, -9.8, 0, 0, gy + 0.4);
      }
    }
    if (time - lastMist > 0.12) {
      lastMist = time;
      const e = (1 - Math.exp(-k * tf)) / k;
      schedule(time + tf, pos.x + vx * 0.92 * e, 0, pos.z + vz * 0.92 * e, clamp(am / 400, 1, 4), 1);
    }
  }
  function updateSched() {
    for (let i = 0; i < 32; i++) {
      const e = sched[i];
      if (e.t < 0 || time < e.t) continue;
      e.t = -1;
      if (e.kind === 1) {
        // облако водяной пыли у земли
        const gy = groundY(e.x, e.z);
        if (camD2(e.x, gy, e.z) > 5e7) continue;
        for (let j = cnt(3); j > 0; j--) {
          const a = rnd() * 6.283, h = 2 + rnd() * 4;
          P.spawn(e.x + rs() * 5, gy + 1.5, e.z + rs() * 5, Math.cos(a) * h, 1 + rnd() * 2, Math.sin(a) * h, 2.5 + rnd() * 2, 4 * e.s, 11 * e.s, 0.8, 0.88, 0.96, 0.4, 1.5, 0.5, 0, 0, gy);
        }
      }
    }
  }

  // ------------------------------------------------------------------ летящие источники: ловушки и горящие обломки
  const movers = [];
  for (let i = 0; i < 28; i++) movers.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), alive: false, life: 0, kind: 0, size: 1, acc: 0, floor: 0 });
  function mover(kind) {
    let best = movers[0];
    for (let i = 0; i < movers.length; i++) { const m = movers[i]; if (!m.alive) { best = m; break; } if (m.life < best.life) best = m; }
    best.alive = true; best.kind = kind; best.acc = 0;
    return best;
  }
  function flare(pos, vel) {
    const m = mover(1);
    m.pos.set(pos.x, pos.y, pos.z);
    if (vel) m.vel.set(vel.x, vel.y, vel.z); else m.vel.set(0, -5, 0);
    m.life = 4.5; m.size = 1; m.floor = groundY(pos.x, pos.z);
    G.audio?.play?.('flare', { x: pos.x, y: pos.y, z: pos.z });
    return m;
  }
  function debris(pos, o) {
    const n = Math.min(10, cnt((o && o.count) || 5)), sp = (o && o.speed) || 16, s = (o && o.size) || 1, fl = groundY(pos.x, pos.z);
    for (let i = 0; i < n; i++) {
      const m = mover(2), a = rnd() * 6.283, el = 0.3 + rnd() * 1.1, v = sp * (0.5 + rnd() * 0.8);
      m.pos.set(pos.x, Math.max(pos.y, fl + 0.5), pos.z);
      m.vel.set(Math.cos(a) * Math.cos(el) * v + ((o && o.vx) || 0), Math.sin(el) * v, Math.sin(a) * Math.cos(el) * v + ((o && o.vz) || 0));
      m.life = 2.5 + rnd() * 2.5; m.size = s * (0.6 + rnd() * 0.7); m.floor = fl;
    }
  }
  function updateMovers(dt) {
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i];
      if (!m.alive) continue;
      m.life -= dt;
      const p = m.pos, v = m.vel, dr = Math.exp(-(m.kind === 1 ? 0.9 : 0.25) * dt);
      v.x *= dr; v.z *= dr; v.y = v.y * dr - 9.8 * dt * (m.kind === 1 ? 0.55 : 1);
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      if (m.life <= 0 || p.y <= m.floor) {
        m.alive = false;
        if (m.kind === 2 && p.y <= m.floor + 0.5 && camD2(p.x, p.y, p.z) < 4e6) {
          const g = 0.05;
          P.spawn(p.x, m.floor + 0.5, p.z, 0, 1, 0, 2.5, 1.2 * m.size, 4 * m.size, g, g, g, 0.6, 1, 1.2, 0, 0.2, m.floor);
        }
        continue;
      }
      const d2 = camD2(p.x, p.y, p.z);
      if (d2 > 3.6e7) continue;
      m.acc += dt;
      if (m.kind === 1) {
        P.spawn(p.x, p.y, p.z, v.x, v.y, v.z, Math.max(0.07, dt * 2.2), 3.2, 2.4, 1, 0.8, 0.5, 1, 0, 0, 1, 0, -1e6);
        if (m.acc > 0.05 && d2 < 9e6) { m.acc = 0; P.spawn(p.x, p.y, p.z, v.x * 0.2, v.y * 0.2, v.z * 0.2, 1.4 + rnd() * 0.6, 0.5, 2.2, 0.7, 0.7, 0.72, 0.4, 1.5, 0.6, 0, 0, -1e6); }
      } else if (m.acc > 0.045 && d2 < 6e6) {
        m.acc = 0;
        const s = m.size;
        P.spawn(p.x, p.y, p.z, v.x * 0.3, v.y * 0.3, v.z * 0.3, 0.3 + rnd() * 0.2, 0.9 * s, 0.3 * s, 1, 0.42, 0.06, 0.95, 1, 2, 1, 0.9, -1e6);
        P.spawn(p.x, p.y, p.z, v.x * 0.15, v.y * 0.15, v.z * 0.15, 1.6 + rnd() * 0.8, 0.7 * s, 2.6 * s, 0.05, 0.05, 0.055, 0.6, 1.2, 1.5, 0, 0.1, -1e6);
      }
    }
  }

  // ------------------------------------------------------------------ ленты-следы
  function trail(o) {
    o = o || NOOP_TRAIL;
    const c = setColor(o.color, 0.72, 0.72, 0.74);
    _col3[0] = c.r; _col3[1] = c.g; _col3[2] = c.b;
    _tro.color = _col3; _tro.alpha = o.alpha == null ? 0.6 : o.alpha; _tro.width = o.width || 1.2; _tro.grow = o.grow == null ? 1.6 : o.grow;
    _tro.life = o.life || 3; _tro.fadeIn = o.fadeIn == null ? 0.05 : o.fadeIn; _tro.wobble = o.wobble == null ? 0.35 : o.wobble; _tro.glow = o.glow || 0;
    _tro.owner = o.owner || null;
    return R.acquire(_tro) || NOOP_TRAIL;
  }
  const _col3 = [1, 1, 1], _tro = { color: _col3, alpha: 1, width: 1, grow: 0, life: 1, fadeIn: 0.05, wobble: 0, glow: 0, owner: null };
  function own(owner, r, g, b, alpha, width, grow, life, fadeIn, wobble) {
    _col3[0] = r; _col3[1] = g; _col3[2] = b;
    _tro.color = _col3; _tro.alpha = alpha; _tro.width = width; _tro.grow = grow; _tro.life = life; _tro.fadeIn = fadeIn; _tro.wobble = wobble; _tro.glow = 0;
    _tro.owner = owner;
    return R.acquire(_tro);
  }

  // ------------------------------------------------------------------ автоматические эффекты самолётов
  const states = new Map();
  function stateOf(ac) {
    let st = states.get(ac);
    if (st) return st;
    const spec = ac.spec, A = (ac.model && ac.model.userData.anchors) || {};
    const eng = A.engines && A.engines.length ? A.engines : [new THREE.Vector3(0, 0, spec.length * 0.45)];
    // двигатели, стоящие рядом, дают общий след
    const merge = ac.isPlayer && Q !== QUALITY.low ? 3.5 : Q === QUALITY.low ? 1e3 : 13;
    const groups = [];
    for (const e of eng) {
      let g = null;
      for (const c of groups) if (Math.abs(c.p.x / c.n - e.x) < merge) { g = c; break; }
      if (!g) { g = { p: new THREE.Vector3(), n: 0, trail: null }; groups.push(g); }
      g.p.add(e); g.n++;
    }
    let cx = 0, cy = 0, cz = 0;
    for (const g of groups) { g.p.multiplyScalar(1 / g.n); g.p.z += spec.length * 0.12; cx += g.p.x; cy += g.p.y; cz += g.p.z; }
    const hs = spec.span / 2;
    const tips = A.wingtips && A.wingtips.length >= 2 ? [A.wingtips[0].clone(), A.wingtips[1].clone()] : [new THREE.Vector3(-hs, 0, spec.length * 0.08), new THREE.Vector3(hs, 0, spec.length * 0.08)];
    const gear = A.gearMain && A.gearMain.length ? A.gearMain.map((v) => v.clone()) : [new THREE.Vector3(-hs * 0.25, -spec.gearHeight, 0), new THREE.Vector3(hs * 0.25, -spec.gearHeight, 0)];
    st = {
      groups, tips, gear, tipTrail: [null, null],
      center: new THREE.Vector3(cx / groups.length, cy / groups.length, cz / groups.length),
      smokeTrail: null, dmgTrail: null, dmgAcc: 0, fireAcc: 0, rollAcc: 0, wakeAcc: 0, gearI: 0,
      contrailAlt: spec.engine === 'jet' ? 2500 : spec.engine === 'turboprop' ? 3000 : 3400,
      smoky: spec.engine === 'jet' && (spec.year || 2000) <= 1977,
      scale: clamp(Math.sqrt(spec.mass / 6000), 0.7, 2.6),
      wreck: null,
    };
    states.set(ac, st);
    return st;
  }
  const local = (ac, v) => _v.copy(v).applyQuaternion(ac.quat).add(ac.pos);
  function endTrails(st) {
    for (const g of st.groups) if (g.trail) { g.trail.end(); g.trail = null; }
    for (let i = 0; i < 2; i++) if (st.tipTrail[i]) { st.tipTrail[i].end(); st.tipTrail[i] = null; }
    if (st.smokeTrail) { st.smokeTrail.end(); st.smokeTrail = null; }
    if (st.dmgTrail) { st.dmgTrail.end(); st.dmgTrail = null; }
  }

  function updateAircraft(ac, dt) {
    const st = stateOf(ac), spec = ac.spec, p = ac.pos, v = ac.vel;
    if (!ac.alive) { endTrails(st); return; }
    const d2 = camD2(p.x, p.y, p.z);
    const thr = ac.throttle || 0, wx = G.world && G.world.weather;
    const humid = wx ? (wx.rain > 0.1 || HUMID[wx.type] ? 1 : 0) : 0;
    const speed = ac.tas || 0;

    // --- инверсионный след
    const ck = ac.engineOn === false || thr < 0.2 || d2 > 9e8 ? 0 : smoothstep(st.contrailAlt, st.contrailAlt + 450, p.y);
    for (let i = 0; i < st.groups.length; i++) {
      const g = st.groups[i];
      if (ck > 0.02) {
        if (!g.trail) g.trail = own(ac, 0.93, 0.95, 1, 0.8, 1.6 + st.scale * 0.9 * Math.sqrt(g.n), 2.3 + st.scale * 0.5, Q.contrailLife, 0.3, 0.55);
        if (g.trail) { g.trail.setAlpha(0.8 * ck); g.trail.push(local(ac, g.p)); }
      } else if (g.trail) { g.trail.end(); g.trail = null; }
    }

    // --- жгуты с законцовок
    const gThr = humid ? 2.1 : 3.4, gl = Math.abs(ac.g || 1);
    const tk = !ac.onGround && speed > 45 && d2 < 4e6 ? clamp((gl - gThr) / 1.8, 0, 1) : 0;
    for (let i = 0; i < 2; i++) {
      if (tk > 0.03) {
        if (!st.tipTrail[i]) st.tipTrail[i] = own(ac, 0.95, 0.97, 1, 0.5, 0.3, 0.55, 1.3, 0.03, 0.05);
        if (st.tipTrail[i]) { st.tipTrail[i].setAlpha(0.2 + 0.45 * tk); st.tipTrail[i].push(local(ac, st.tips[i])); }
      } else if (st.tipTrail[i]) { st.tipTrail[i].end(); st.tipTrail[i] = null; }
    }

    // --- копоть старых двигателей на максимале
    const sk = st.smoky && ac.engineOn !== false && !(ac.afterburner > 0.05) && d2 < 1.6e7 && ck < 0.5 ? clamp((thr - 0.72) / 0.2, 0, 1) : 0;
    if (sk > 0.05) {
      if (!st.smokeTrail) st.smokeTrail = own(ac, 0.07, 0.065, 0.06, 0.2, 0.9 + st.scale * 0.5, 1.5 + st.scale * 0.4, 3.2, 0.12, 0.5);
      if (st.smokeTrail) { st.smokeTrail.setAlpha(0.3 * sk); st.smokeTrail.push(local(ac, st.center)); }
    } else if (st.smokeTrail) { st.smokeTrail.end(); st.smokeTrail = null; }

    // --- повреждения: дым (< 50) и огонь (< 25)
    const hp = ac.hp == null ? 100 : ac.hp;
    if (hp < 50 && d2 < 6.4e7) {
      const dk = clamp((50 - hp) / 30, 0.25, 1), sc = st.scale;
      if (!st.dmgTrail) st.dmgTrail = own(ac, 0.035, 0.035, 0.04, 0.5, 1.2 * sc, 2.6 * sc, 4.5, 0.06, 0.9);
      local(ac, st.groups[0].p);
      if (st.dmgTrail) { st.dmgTrail.setAlpha(0.3 + 0.4 * dk); st.dmgTrail.pushXYZ(_v.x, _v.y, _v.z); }
      if (d2 < 9e6) {
        st.dmgAcc += dt * (6 + 8 * dk) * Q.density;
        while (st.dmgAcc >= 1) {
          st.dmgAcc -= 1;
          const g = 0.03 + rnd() * 0.05 * (1 - dk * 0.6);
          P.spawn(_v.x + rs() * 0.4, _v.y + rs() * 0.4, _v.z + rs() * 0.4, v.x * 0.35 + rs() * 1.5, v.y * 0.35 + rs() * 1.5, v.z * 0.35 + rs() * 1.5,
            1.4 + rnd() * 1.2, 1.1 * sc, 4.2 * sc, g, g, g * 1.1, 0.7, 2.2, 2.5, 0, 0.15, -1e6);
        }
        if (hp < 25) {
          st.fireAcc += dt * 22 * Q.density;
          while (st.fireAcc >= 1) {
            st.fireAcc -= 1;
            P.spawn(_v.x + rs() * 0.3, _v.y + rs() * 0.3, _v.z + rs() * 0.3, v.x * 0.86 + rs() * 2, v.y * 0.86 + rs() * 2, v.z * 0.86 + rs() * 2,
              0.22 + rnd() * 0.22, 1.5 * sc, 0.5 * sc, 1, 0.34 + rnd() * 0.2, 0.05, 0.95, 1.2, 2, 1, 0.9, -1e6);
          }
        }
      }
    } else if (st.dmgTrail) { st.dmgTrail.end(); st.dmgTrail = null; }

    // --- конус пара у M ≈ 1
    const mach = ac.mach || 0;
    if (mach > 0.95 && mach < 1.05 && p.y < 6000 && d2 < 9e6) {
      const mk = 1 - Math.abs(mach - 1) / 0.05, f = spec.length * 0.12;
      _v2.set(0, 0, f).applyQuaternion(ac.quat);
      P.spawn(p.x + _v2.x, p.y + _v2.y, p.z + _v2.z, v.x, v.y, v.z, 0.13, spec.span * 0.45, spec.span * 0.8, 0.95, 0.97, 1, 0.3 * mk * (0.5 + 0.5 * humid), 0, 0, 0, 0, -1e6);
    }

    // --- на земле и на воде
    if (ac.onGround && d2 < 6e6) {
      const gs = ac.gs == null ? Math.hypot(v.x, v.z) : ac.gs, sc = st.scale;
      if (ac.onWater) {
        if (gs > 3) {
          st.wakeAcc += gs * dt;
          const step = 3.5 / Q.density;
          while (st.wakeAcc >= step) {
            st.wakeAcc -= step;
            const k = clamp(gs / 30, 0.2, 1), side = (st.gearI++ & 1) ? 1 : -1;
            _x.set(1, 0, 0).applyQuaternion(ac.quat); _x.y = 0;
            const hx = p.x - (v.x / gs) * spec.length * 0.05, hz = p.z - (v.z / gs) * spec.length * 0.05, wy = p.y - (spec.hullHeight || 1) - 0.2;
            // веер брызг от скулы
            P.spawn(hx + _x.x * side * 1.2, wy + 0.3, hz + _x.z * side * 1.2, v.x * 0.45 + _x.x * side * (4 + rnd() * 5) * k, (3 + rnd() * 5) * k, v.z * 0.45 + _x.z * side * (4 + rnd() * 5) * k,
              0.8 + rnd() * 0.7, 1.1 * sc, 3.4 * sc, 0.85, 0.92, 0.98, 0.75, 0.9, -9.8, 0, 0, wy);
            // пенный кильватер
            P.spawn(p.x - (v.x / gs) * spec.length * 0.35 + rs(), wy + 0.15, p.z - (v.z / gs) * spec.length * 0.35 + rs(), _x.x * side * 1.5, 0, _x.z * side * 1.5,
              2.8 + rnd() * 1.5, 1.6 * sc, 4.5 * sc, 0.9, 0.95, 1, 0.34, 1.2, 0, 0, 0, wy);
          }
        }
      } else {
        const soft = ac.surface === 'ground', wet = wx ? wx.rain || 0 : 0;
        if ((soft && gs > 6) || (!soft && wet > 0.3 && gs > 18)) {
          st.rollAcc += gs * dt;
          const step = (soft ? 7 : 9) / Q.density;
          while (st.rollAcc >= step) {
            st.rollAcc -= step;
            const w = st.gear[st.gearI++ % st.gear.length];
            local(ac, w);
            const k = clamp(gs / 35, 0.3, 1);
            if (soft) P.spawn(_v.x, _v.y + 0.4, _v.z, v.x * 0.2 + rs(), 0.8 + rnd(), v.z * 0.2 + rs(), 2 + rnd() * 1.6, 1.1 * sc, (3 + rnd() * 2) * sc * k + 1, 0.4, 0.31, 0.21, 0.42 * k + 0.1, 1.6, 0.5, 0, 0, _v.y - 0.2);
            else P.spawn(_v.x, _v.y + 0.3, _v.z, v.x * 0.35 + rs(), 1.5 + rnd() * 1.5, v.z * 0.35 + rs(), 0.9 + rnd() * 0.6, 0.9 * sc, 3.2 * sc, 0.8, 0.86, 0.92, 0.3 * wet, 1.6, -2, 0, 0, _v.y - 0.2);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ события
  const off = [];
  off.push(G.bus.on('ac:touchdown', (e) => {
    const ac = e && e.ac;
    if (!ac || !ac.pos) return;
    const p = ac.pos;
    if (camD2(p.x, p.y, p.z) > 1.2e7) return;
    const st = stateOf(ac), vs = Math.abs(e.vs || 0), sp = e.speed || 0, sc = st.scale;
    const surf = e.surface || ac.surface;
    if (surf === 'water') {
      _v.set(p.x, p.y - (ac.spec.hullHeight || 1), p.z);
      splash(_v, sc * clamp(0.8 + vs * 0.35 + sp / 60, 0.8, 3.5), true);
      return;
    }
    for (let i = 0; i < st.gear.length; i++) {
      local(ac, st.gear[i]);
      const gy = groundY(_v.x, _v.z);
      _v.y = gy + 0.2;
      if (surf === 'ground') { dust(_v, sc * clamp(0.6 + vs * 0.25 + sp / 90, 0.6, 2.2), ac.vel.x * 0.2, ac.vel.z * 0.2); continue; }
      if (e.gearDown === false) { _v.y += 0.3; sparks(_v, { count: 10, speed: 8 + sp * 0.15, dir: _v2.copy(ac.vel).normalize() }); continue; }
      // дымок покрышек
      const k = clamp(sp / 55, 0.25, 1) * clamp(0.6 + vs * 0.2, 0.6, 1.4);
      for (let j = cnt(4 * k + 1); j > 0; j--) {
        P.spawn(_v.x + rs() * 0.5, _v.y + 0.2, _v.z + rs() * 0.5, ac.vel.x * (0.12 + rnd() * 0.25) + rs(), 0.6 + rnd() * 1.2, ac.vel.z * (0.12 + rnd() * 0.25) + rs(),
          1.3 + rnd() * 1.2, 0.8 * sc, (2.8 + rnd() * 1.6) * sc, 0.72, 0.74, 0.8, 0.5 * k, 2.2, 1, 0, 0, _v.y - 0.2);
      }
    }
  }));

  off.push(G.bus.on('ac:crash', (e) => {
    const ac = e && e.ac;
    if (!ac || !ac.pos) return;
    const st = stateOf(ac), p = ac.pos, sc = clamp(st.scale * 1.5, 1.2, 4.5);
    endTrails(st);
    const gy = groundY(p.x, p.z), gnd = G.world && G.world.groundAt ? G.world.groundAt(p.x, p.z) : null;
    const low = p.y - gy < 25;
    if (e.reason === 'water' || (low && gnd && gnd.surface === 'water')) {
      _v2.set(p.x, gy, p.z);
      splash(_v2, sc * 2.6);
      splash(_v2, sc * 1.2, true);
      if (e.reason !== 'water') explosion(p, sc * 0.6);
      return;
    }
    explosion(p, e.reason === 'gearup' ? sc * 0.6 : sc);
    if (low) {
      _v2.set(p.x, gy + 0.5, p.z);
      st.wreck = fire(_v2, sc * 0.8, { ttl: 50, auto: true });
      dust(_v2, sc * 1.5);
    }
    _v2.set(p.x, p.y + 1, p.z);
    debris(_v2, { count: 6, speed: 9 + sc * 5, size: sc * 0.7 });
  }));

  // сбитые самолёты и уничтоженные цели: реагируем в следующем кадре и только если бой сам уже не взорвал
  const pend = [];
  for (let i = 0; i < 12; i++) pend.push({ on: false, x: 0, y: 0, z: 0, s: 1, burn: 0, water: false });
  function queue(x, y, z, s, burn) {
    for (let i = 0; i < pend.length; i++) if (!pend[i].on) { const q = pend[i]; q.on = true; q.x = x; q.y = y; q.z = z; q.s = s; q.burn = burn; return; }
  }
  off.push(G.bus.on('ac:destroyed', (e) => {
    const ac = e && e.ac;
    if (ac && ac.pos) queue(ac.pos.x, ac.pos.y, ac.pos.z, clamp(stateOf(ac).scale * 1.3, 1, 4), 0);
  }));
  off.push(G.bus.on('target:destroyed', (e) => {
    const t = e && e.target, p = t && t.pos;
    if (!p) return;
    const big = /ship|boat|tanker|carrier|depot|fuel|radar|bunker/.test(String(t.kind || ''));
    queue(p.x, p.y == null ? groundY(p.x, p.z) : p.y, p.z, big ? 3.2 : 1.8, 40);
  }));
  function updatePending() {
    for (let i = 0; i < pend.length; i++) {
      const q = pend[i];
      if (!q.on) continue;
      q.on = false;
      _v.set(q.x, q.y, q.z);
      if (!explosionNear(q.x, q.y, q.z, 12, 0.6)) explosion(_v, q.s);
      if (q.burn > 0 && !fireNear(q.x, q.y, q.z, 10)) { _v.set(q.x, q.y + 0.5, q.z); fire(_v, q.s * 0.6, { ttl: q.burn, auto: true }); }
    }
  }
  off.push(G.bus.on('ac:remove', (e) => {
    const st = e && states.get(e.ac);
    if (!st) return;
    endTrails(st);
    states.delete(e.ac);
  }));
  off.push(G.bus.on('quality:changed', () => {
    if ((QUALITY[G.quality.level] || QUALITY.medium) === Q) return;
    for (const st of states.values()) endTrails(st);
    states.clear();
    build();
  }));

  // ------------------------------------------------------------------ тени
  function updateShadows() {
    const list = G.aircraft, w = G.world, mesh = S.mesh, attr = S.attr.array;
    let n = 0;
    if (w && w.groundAt && list) {
      const sun = (w.env && w.env.lightDir) || w.sunDir;
      const day = w.env && w.env.daylight != null ? w.env.daylight : 1;
      let sx = 0, sy = 1, sz = 0;
      if (sun && sun.y > 0.05) { sy = Math.max(sun.y, 0.32); const hl = Math.hypot(sun.x, sun.z) || 1, k = Math.sqrt(1 - sy * sy) / hl; sx = sun.x * k; sz = sun.z * k; }
      const base = 0.2 + 0.3 * day;
      for (let i = 0; i < list.length && n < S.max; i++) {
        const ac = list[i];
        if (!ac.model || !ac.pos || ac.crashed) continue;
        const p = ac.pos, spec = ac.spec;
        if (camD2(p.x, p.y, p.z) > 1.6e7) continue;
        const H = 260 + spec.span * 11;
        let gx = p.x, gz = p.z, g = w.groundAt(gx, gz), h = p.y - g.y;
        if (h > H) continue;
        if (h > 2 && (sx || sz)) {
          gx = p.x - (sx / sy) * h; gz = p.z - (sz / sy) * h;
          g = w.groundAt(gx, gz); h = Math.max(0, p.y - g.y);
          gx = p.x - (sx / sy) * h; gz = p.z - (sz / sy) * h;
          g = w.groundAt(gx, gz);
        }
        h = Math.max(0, p.y - g.y - (spec.gearHeight || 1));
        const k = h / H;
        if (k >= 1) continue;
        // плоскость рельефа под тенью
        _y.set(0, 1, 0);
        if (g.surface === 'ground' && w.heightAt) {
          const d = Math.max(4, spec.span * 0.3);
          _y.set(w.heightAt(gx - d, gz) - w.heightAt(gx + d, gz), 2 * d, w.heightAt(gx, gz - d) - w.heightAt(gx, gz + d)).normalize();
        }
        _z.set(0, 0, 1).applyQuaternion(ac.quat);
        _z.addScaledVector(_y, -_z.dot(_y));
        if (_z.lengthSq() < 1e-4) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
        _z.normalize();
        _x.crossVectors(_y, _z);
        const grow = 1.3 * (1 + k * 0.7);
        const cb = Math.max(0.35, Math.abs(Math.cos(ac.bank || 0)));
        _m.makeBasis(_x, _y, _z);
        _sc.set(spec.span * 0.5 * grow * cb, 1, spec.length * 0.5 * grow);
        _m.scale(_sc);
        _m.setPosition(gx, g.y + 0.12 + h * 0.004, gz);
        mesh.setMatrixAt(n, _m);
        const fade = 1 - k;
        attr[n * 2] = base * fade * fade;
        attr[n * 2 + 1] = 0.02 + k * 0.85;
        n++;
      }
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) { mesh.instanceMatrix.needsUpdate = true; S.attr.needsUpdate = true; }
  }

  // ------------------------------------------------------------------ кадр
  function uniforms() {
    const c = G.camera, w = G.world;
    cam.x = c.position.x; cam.y = c.position.y; cam.z = c.position.z;
    FXU.uTime.value = time;
    const hpx = G.renderer ? G.renderer.domElement.height : 800;
    FXU.uPx.value = hpx / (2 * Math.tan((c.fov * Math.PI) / 360));
    if (w) {
      if (w.wind) FXU.uWind.value.copy(w.wind);
      const env = w.env, sun = (env && env.lightDir) || w.sunDir;
      if (sun) FXU.uSunV.value.copy(sun).transformDirection(c.matrixWorldInverse);
      const day = env && env.daylight != null ? env.daylight : 1;
      if (env && env.sunColor) {
        const sc = env.sunColor, mx = Math.max(sc.r, sc.g, sc.b, 0.001), k = (0.12 + 0.5 * day) / mx;
        FXU.uLight.value.setRGB(sc.r * k, sc.g * k, sc.b * k);
      } else FXU.uLight.value.setScalar(0.12 + 0.5 * day);
      if (env && env.ambientColor) {
        const a = env.ambientColor, mx = Math.max(a.r, a.g, a.b, 0.001), k = (0.1 + 0.52 * day) / mx;
        FXU.uAmb.value.setRGB(0.5 * (a.r * k + 0.1 + 0.52 * day), 0.5 * (a.g * k + 0.1 + 0.52 * day), 0.5 * (a.b * k + 0.1 + 0.52 * day));
      } else FXU.uAmb.value.setScalar(0.1 + 0.52 * day);
    }
  }

  const fx = {
    group,
    explosion, smokePuff, splash, dust, tracer, fire, waterDrop, trail, flare, debris, sparks,
    clear() {
      P.clear(); R.clear(); T.clear();
      fires.length = 0;
      for (const m of movers) m.alive = false;
      for (const e of sched) e.t = -1;
      for (const q of pend) q.on = false;
      for (const st of states.values()) { for (const g of st.groups) g.trail = null; st.tipTrail[0] = st.tipTrail[1] = null; st.smokeTrail = st.dmgTrail = null; }
      states.clear();
      S.mesh.count = 0; S.mesh.visible = false;
    },
    update(dt) {
      dt = dt > 0 ? Math.min(dt, 0.25) : 0;
      time += dt;
      uniforms();
      if (dt > 0) {
        updatePending();
        const list = G.aircraft;
        for (let i = 0; i < list.length; i++) if (list[i].spec && list[i].pos) updateAircraft(list[i], dt);
        updateFires(dt);
        updateMovers(dt);
        updateSched();
      }
      updateShadows();
      P.flush(); P.idle();
      R.flush();
      T.flush();
    },
    debug() {
      return {
        quality: G.quality.level, time: +time.toFixed(2), particlesMax: P.max, spawned: P.spawned, particlesVisible: P.mesh.visible,
        ribbons: R.activeCount() + '/' + R.slots + 'x' + R.K, ribbonsVisible: R.mesh.visible, tracersVisible: T.mesh.visible,
        fires: fires.length, movers: movers.filter((m) => m.alive).length, shadows: S.mesh.count, states: states.size,
        drawCalls: (P.mesh.visible ? 1 : 0) + (R.mesh.visible ? 1 : 0) + (T.mesh.visible ? 1 : 0) + (S.mesh.visible ? 1 : 0),
      };
    },
  };
  return fx;
}
