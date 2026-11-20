// Автопилот: готовые регуляторы для ИИ-самолётов и помощи игроку. Пишут в ac.controls (и в команды шасси/закрылков),
// состояние держат в ac.ap. Без DOM и без аллокаций в шаге. Рассчитаны на включённую помощь (у ИИ ac.assist не задаётся = включена):
// стик по тангажу пересчитывается из нужной перегрузки через ac.ctl (его заполняет physics.js), поэтому один и тот же
// регулятор одинаково устойчив на Ан-2 и на МиГ-29.
//
//   apHold(ac, { heading?, alt?, speed?, vs?, bank?, throttle?, bankMax?, vsMax? }, dt)   — удержание режима
//   apFlyTo(ac, { x, y, z, speed? }, dt) -> расстояние до точки, м
//   apTakeoff(ac, dt, opts?) -> 'roll' | 'rotate' | 'climb' | 'done'
//   apLand(ac, target, dt, opts?) -> 'approach' | 'final' | 'flare' | 'rollout' | 'stopped' | 'goaround'
//        target — результат world.runwayStart(...) ({x, y, z, heading, airport, runway}), либо аэродром, либо { airport, runway, heading? }
//   apFollow(ac, leader, { x: вправо, y: вверх, z: назад }, dt) -> расстояние до места в строю, м
//   apPursue(ac, target, dt, opts?) -> { dist, off, closure, inCone }  — нос на упреждённую точку (target: { pos, vel? })
//   apTerrainFloor(ac, world, margin?, seconds?) -> минимальная безопасная высота по курсу;  apReset(ac)
import { Vector3, Quaternion } from 'three';
import { clamp, damp, wrapPi, smoothstep, G0 } from '../core/util.js';

const _d = new Vector3(), _l = new Vector3(), _e = new Vector3(), _v = new Vector3(), _q = new Quaternion();
const DEG = Math.PI / 180;

function state(ac) {
  return ac.ap || (ac.ap = {
    thrI: -1, vPrev: 0, acc: 0, t: 0,
    to: null, land: null, pursue: { dist: 0, off: 0, closure: 0, inCone: false },
  });
}
export function apReset(ac) { ac.ap = null; }

const transport = (spec) => spec.cls === 'airliner' || spec.cls === 'cargo' || spec.cls === 'amphibian';
const defBank = (ac) => {
  const lim = ac.ctl.bankLim > 0 ? ac.ctl.bankLim - 0.12 : 9;
  return Math.min(lim, transport(ac.spec) ? 30 * DEG : ac.spec.cls === 'utility' ? 40 * DEG : ac.spec.role === 'military' ? 60 * DEG : 45 * DEG);
};

// ---------- каналы ----------
// стик по тангажу для заданной нормальной перегрузки
function pitchForG(ac, n) {
  const c = ac.ctl;
  if (ac.onGround) return 0;
  return n >= c.nN ? clamp((n - c.nN) / Math.max(c.nHi - c.nN, 0.08), 0, 1) : clamp((n - c.nN) / Math.max(c.nN - c.nLo, 0.08), -1, 0);
}
// стик по крену для заданного крена (рад, вправо +)
function rollForBank(ac, bank, gain = 2.6) {
  const rm = ac.ctl.rollMax > 0.05 ? ac.ctl.rollMax : ac.spec.rollRate;
  return clamp((gain * wrapPi(bank - ac.bank)) / rm, -1, 1);
}
// продольный канал: вертикальная скорость -> перегрузка -> стик
function pitchForVs(ac, vsT, gainG = 1.1, nMin = 0.35, nMax = 2.2) {
  const V = Math.max(ac.tas, 0.5 * ac.spec.vStall);
  const gam = Math.asin(clamp(ac.vs / V, -1, 1));
  const gamT = Math.asin(clamp(vsT / V, -0.7, 0.7));
  const cphi = Math.max(Math.cos(ac.bank), 0.4);
  const n = (Math.cos(gam) + (V * gainG * (gamT - gam)) / G0) / cphi;
  return pitchForG(ac, clamp(n, nMin, Math.max(nMax, 1.2 / cphi)));
}
// автомат тяги
function throttleFor(ac, vT, dt, allowAB) {
  const ap = state(ac), spec = ac.spec;
  if (ap.thrI < 0) ap.thrI = clamp(ac.controls.throttle, 0, 1);
  const top = spec.afterburner && !allowAB ? 0.9 : 1;
  const err = vT - ac.ias;
  const kp = 2.6 / spec.vStall;
  ap.thrI = clamp(ap.thrI + err * (0.5 / spec.vStall) * dt, 0, top);
  return clamp(ap.thrI + kp * err - (3.2 / spec.vStall) * ap.acc, 0, top);
}
function track(ap, ac, dt) {
  // сглаженное продольное ускорение (по приборной скорости)
  if (ap.t !== ac.time) {
    const a = dt > 0 ? (ac.ias - ap.vPrev) / dt : 0;
    ap.acc = Math.abs(ac.time - ap.t) > 0.5 ? 0 : damp(ap.acc, clamp(a, -30, 30), 3, dt);
    ap.vPrev = ac.ias;
    ap.t = ac.time;
  }
}

// ---------- удержание режима ----------
// heading/alt/speed/vs — что задано, то и держится. bank — прямой крен вместо курса. throttle — фиксированный газ:
// если при этом задана speed, а alt/vs нет — скорость держится тангажом (набор/снижение на заданной приборной).
// bankFF / vsFF — упреждение (строй). bankMax, vsMax — ограничения.
export function apHold(ac, tgt, dt) {
  const ap = state(ac), c = ac.controls, spec = ac.spec;
  track(ap, ac, dt);
  if (!ac.alive) return;
  const vsCfg = ac.ctl.vsCfg || spec.vStall;
  const V = Math.max(ac.tas, 0.5 * spec.vStall);
  // --- боковой канал ---
  const bMax = Math.min(tgt.bankMax ?? defBank(ac), ac.ctl.bankLim > 0 ? ac.ctl.bankLim - 0.05 : 9);
  let bank = 0;
  if (tgt.bank != null) bank = clamp(tgt.bank, -bMax, bMax);
  else if (tgt.heading != null) bank = clamp(Math.atan((0.55 * wrapPi(tgt.heading - ac.heading) * V) / G0) + (tgt.bankFF || 0), -bMax, bMax);
  c.roll = rollForBank(ac, bank);
  c.yaw = 0;
  // --- продольный канал ---
  const slow = ac.ias < 1.13 * vsCfg;
  if (tgt.alt != null || tgt.vs != null) {
    const up = tgt.vsMax ?? clamp(0.75 * spec.climb, 2.5, 0.3 * V);
    const dn = tgt.vsDown ?? Math.max(4, 0.14 * V);
    let vsT = tgt.vs != null ? tgt.vs : clamp(0.22 * (tgt.alt - ac.alt), -dn, up) + (tgt.vsFF || 0);
    // запас по скорости: медленно — не лезем вверх
    if (vsT > 0) vsT *= clamp((ac.ias - 1.1 * vsCfg) / (0.15 * vsCfg), 0, 1);
    if (slow && !ac.onGround) vsT = Math.min(vsT, -1.5 - (1.13 * vsCfg - ac.ias) * 0.8);
    c.pitch = pitchForVs(ac, vsT, 1.1, transport(spec) ? 0.6 : 0.3, transport(spec) ? 1.6 : 3);
  } else if (tgt.speed != null && tgt.throttle != null) {
    // скорость тангажом
    const gam = Math.asin(clamp(ac.vs / V, -1, 1));
    const gd = clamp(0.0125 * (ac.ias - tgt.speed) + 0.064 * ap.acc, -0.1, 0.1);
    c.pitch = pitchForG(ac, clamp((Math.cos(gam) + (V * gd) / G0) / Math.max(Math.cos(ac.bank), 0.4), 0.3, 2.5));
  } else c.pitch = 0;
  // --- газ ---
  if (tgt.throttle != null) c.throttle = clamp(tgt.throttle, 0, 1);
  else if (tgt.speed != null) c.throttle = throttleFor(ac, Math.max(tgt.speed, 1.15 * vsCfg), dt, tgt.afterburner);
  c.airbrake = tgt.speed != null && tgt.throttle == null && ac.ias > tgt.speed + Math.max(12, 0.12 * tgt.speed) && c.throttle < 0.05 ? 1 : 0;
  c.brake = 0;
}

// ---------- полёт на точку ----------
export function apFlyTo(ac, p, dt) {
  const dx = p.x - ac.pos.x, dz = p.z - ac.pos.z;
  const bearing = Math.atan2(dx, -dz);
  // поправка на снос: держим путевой угол, а не курс
  let hdg = bearing;
  if (ac.gs > 12) hdg += clamp(wrapPi(ac.heading - Math.atan2(ac.vel.x, -ac.vel.z)), -0.5, 0.5);
  _hold.heading = hdg;
  _hold.alt = p.y ?? ac.alt;
  _hold.speed = p.speed ?? ac.spec.vCruise;
  _hold.bankMax = p.bankMax;
  apHold(ac, _hold, dt);
  const dy = (p.y ?? ac.pos.y) - ac.pos.y;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
const _hold = { heading: 0, alt: 0, speed: 0, bankMax: undefined };
const _h2 = {};
function clear(o) { o.heading = o.alt = o.speed = o.vs = o.bank = o.throttle = o.bankMax = o.vsMax = o.vsDown = o.bankFF = o.vsFF = o.afterburner = undefined; return o; }

// ---------- взлёт ----------
// opts: { heading? (курс полосы; по умолчанию — текущий), alt? (высота выхода над местом старта, по умолчанию 150 м) }
export function apTakeoff(ac, dt, opts) {
  const ap = state(ac), c = ac.controls, spec = ac.spec;
  track(ap, ac, dt);
  let s = ap.to;
  if (!s) {
    s = ap.to = { phase: 'roll', hdg: opts && opts.heading != null ? opts.heading : ac.heading, x: ac.pos.x, z: ac.pos.z, y: ac.pos.y, t: 0 };
    ap.land = null;
  }
  if (!ac.alive) return s.phase;
  const out = (opts && opts.alt) || 150;
  const dH = wrapPi(s.hdg - ac.heading);
  const onSurf = ac.onGround;
  if (s.phase === 'roll' || s.phase === 'rotate') {
    if (spec.flaps) ac.flaps = 0.5;
    ac.gearDown = !ac.onWater || !spec.retract ? true : ac.gearDown;
    c.throttle = 1; c.brake = 0; c.airbrake = 0;
    // по оси: курс + боковое уклонение от линии разбега
    const xtk = (ac.pos.x - s.x) * Math.cos(s.hdg) + (ac.pos.z - s.z) * Math.sin(s.hdg);
    c.yaw = clamp(3 * dH - 0.03 * xtk, -1, 1);
    c.roll = 0;
    if (s.phase === 'roll') {
      c.pitch = 0;
      if (ac.ias >= spec.vRotate) s.phase = 'rotate';
    } else c.pitch = onSurf ? 0.75 : 0.2;
    if (!onSurf && ac.agl > 1.5) s.phase = 'climb';
    return s.phase;
  }
  if (s.phase === 'climb') {
    if (onSurf && ac.groundTime > 1) { s.phase = 'roll'; return s.phase; }
    const h = ac.pos.y - s.y;
    if (spec.retract && h > 12 && ac.vs > 0.5 && !ac.onWater) ac.gearDown = false;
    if (h > 90 && ac.ias > 1.3 * spec.vStall) ac.flaps = 0;
    clear(_h2);
    _h2.heading = s.hdg; _h2.throttle = 1;
    _h2.bankMax = h < 40 ? 8 * DEG : 20 * DEG;
    // набираем на безопасной скорости: тангажом держим её, пока есть избыток тяги
    const vT = Math.max(1.3 * (ac.ctl.vsCfg || spec.vStall), Math.min(spec.vClimb, 1.55 * spec.vStall));
    if (ac.ias < vT - 2) { _h2.vs = clamp(0.25 * spec.climb, 1.5, 8) * clamp((ac.ias - 1.08 * (ac.ctl.vsCfg || spec.vStall)) / (0.1 * spec.vStall), 0.15, 1); }
    else _h2.speed = vT;
    apHold(ac, _h2, dt);
    if (h > out && ac.flaps === 0 && (!spec.retract || ac.gearPos < 0.05)) s.phase = 'done';
    return s.phase;
  }
  // done: продолжаем набор, пока вызывающий не переключит режим
  clear(_h2);
  _h2.heading = s.hdg; _h2.throttle = 1; _h2.speed = spec.vClimb;
  apHold(ac, _h2, dt);
  return s.phase;
}

// ---------- заход и посадка ----------
function landSetup(ac, tgt, opts) {
  let rw = tgt.runway, ap = tgt.airport, hdg = tgt.heading;
  if (!rw && tgt.runways) { ap = tgt; rw = tgt.runways[0]; }
  if (!rw) return null;
  if (hdg == null) {
    // торец выбираем так, чтобы самолёт уже был со стороны захода
    const dx = Math.sin(rw.heading), dz = -Math.cos(rw.heading);
    const side = (ac.pos.x - rw.cx) * dx + (ac.pos.z - rw.cz) * dz;
    hdg = tgt.end === 'B' ? rw.heading + Math.PI : tgt.end === 'A' ? rw.heading : side <= 0 ? rw.heading : rw.heading + Math.PI;
  }
  const elev = ap && ap.elevation != null ? ap.elevation : tgt.y != null ? tgt.y : 0;
  const dx = Math.sin(hdg), dz = -Math.cos(hdg);
  const carrier = !!(ap && ap.kind === 'carrier');
  const short = rw.length < 1100;
  const vApp = ac.spec.vApproach;
  const glide = (opts && opts.glide) || (carrier ? 3.5 : short ? 3.4 : 3) * DEG;
  const aim = carrier ? rw.length * 0.22 : clamp(rw.length * 0.12, 50, 320);
  const df = clamp(vApp * 65, 2400, 7000);
  const R = (1.4 * vApp * 1.4 * vApp) / (G0 * Math.tan(25 * DEG));
  return {
    key: tgt, rw, airport: ap || null, hdg, elev, dx, dz, carrier, glide, aim, df, R,
    tx: rw.cx - dx * rw.length / 2, tz: rw.cz - dz * rw.length / 2, // торец
    phase: 'approach', side: 0, t: 0, ga: 0,
  };
}

export function apLand(ac, tgt, dt, opts) {
  const ap = state(ac), c = ac.controls, spec = ac.spec;
  track(ap, ac, dt);
  let L = ap.land;
  if (!L || L.key !== tgt) {
    L = ap.land = landSetup(ac, tgt, opts);
    ap.to = null;
    if (!L) return 'approach';
    if (ac.onGround) L.phase = 'rollout';
  }
  if (!ac.alive) return L.phase;
  const vApp = spec.vApproach, gearH = spec.gearHeight;
  // положение относительно торца: s — удаление до торца по оси захода (м, + до торца), lat — боковое (вправо по полёту +)
  const rx = ac.pos.x - L.tx, rz = ac.pos.z - L.tz;
  const s = -(rx * L.dx + rz * L.dz);
  const lat = rx * -L.dz + rz * L.dx;
  const tanG = Math.tan(L.glide);
  const hFaf = L.elev + gearH + (L.df + L.aim) * tanG;
  const trk = ac.gs > 8 ? Math.atan2(ac.vel.x, -ac.vel.z) : ac.heading;
  const crab = clamp(wrapPi(ac.heading - trk), -0.5, 0.5);
  clear(_h2);

  if (L.phase === 'approach' || L.phase === 'goaround') {
    if (L.phase === 'goaround') {
      // уход на второй круг: прямо по курсу полосы с набором
      L.ga += dt;
      if (spec.retract && ac.vs > 1) ac.gearDown = false;
      ac.flaps = spec.flaps ? 0.5 : 0;
      _h2.heading = L.hdg + crab; _h2.alt = hFaf; _h2.speed = 1.3 * vApp; _h2.bankMax = 15 * DEG;
      apHold(ac, _h2, dt);
      c.throttle = 1;
      if (L.ga > 12 && ac.alt > L.elev + 60) { L.phase = 'approach'; L.side = 0; }
      return L.phase;
    }
    const inFunnel = s > L.df * 0.7 && Math.abs(lat) < (s - L.df * 0.5) * 0.9 + 150 && Math.abs(wrapPi(trk - L.hdg)) < 100 * DEG;
    if (inFunnel) L.phase = 'final';
    else {
      // выход в точку начала захода: на оси дальше ДПРМ, со смещением вбок для разворота
      if (L.side === 0) L.side = lat >= 0 ? 1 : -1;
      const sI = L.df * 1.25 + L.R, latI = L.side * (s > L.df ? 0 : 2.1 * L.R);
      const px = L.tx - L.dx * sI + -L.dz * latI, pz = L.tz - L.dz * sI + L.dx * latI;
      const dist = Math.hypot(px - ac.pos.x, pz - ac.pos.z);
      _h2.heading = Math.atan2(px - ac.pos.x, -(pz - ac.pos.z)) + crab;
      _h2.alt = hFaf;
      _h2.speed = dist > 2.5 * L.df ? Math.min(spec.vCruise, 1.9 * vApp) : 1.35 * vApp;
      if (dist < 2.5 * L.df) ac.flaps = spec.flaps ? 0.5 : 0;
      apHold(ac, _h2, dt);
      if (dist < L.R * 1.2 || (s > L.df * 1.1 && Math.abs(lat) < 2.6 * L.R && Math.abs(wrapPi(trk - L.hdg)) < 120 * DEG)) L.phase = 'final';
      return L.phase;
    }
  }

  const wheelH = ac.pos.y - gearH - L.elev;
  if (L.phase === 'final') {
    // --- курсовой канал: выход на ось под углом, пропорциональным уклонению ---
    const look = clamp(ac.gs * 9, 300, 2200);
    const cut = clamp(Math.atan(lat / look), -45 * DEG, 45 * DEG);
    _h2.heading = L.hdg - cut + crab;
    _h2.bankMax = s < 1200 ? 15 * DEG : 25 * DEG;
    // --- глиссада ---
    const sAim = s + L.aim;
    const hT = L.elev + gearH + Math.min(sAim, L.df + L.aim) * tanG;
    const onSlope = sAim < L.df + L.aim;
    const vsGs = onSlope ? -ac.gs * tanG : 0;
    _h2.vs = clamp(vsGs + 0.3 * (hT - ac.alt), -Math.max(5, 0.16 * ac.tas), Math.max(2, 0.05 * ac.tas));
    // --- конфигурация и скорость ---
    const near = s < L.df * 1.15;
    if (near) { ac.gearDown = true; ac.flaps = spec.flaps ? 1 : 0; } else ac.flaps = spec.flaps ? 0.5 : 0;
    _h2.speed = near ? vApp : 1.3 * vApp;
    apHold(ac, _h2, dt);
    // --- уход на второй круг, если заход не получился ---
    if (s < 0.2 * L.df && s > -L.aim && (Math.abs(lat) > Math.max(L.rw.width * 0.6, 12) + 0.12 * Math.max(s, 0) || ac.alt - hT > 25 + 0.12 * Math.max(s, 0))) {
      L.phase = 'goaround'; L.ga = 0;
      return L.phase;
    }
    if (s < -L.rw.length * 0.5) { L.phase = 'goaround'; L.ga = 0; return L.phase; }
    const hFlare = clamp(-ac.vs * 2.4, 4, 16);
    if (wheelH < hFlare && s < 400) L.phase = 'flare';
    if (ac.onGround) L.phase = 'rollout';
    return L.phase;
  }

  if (L.phase === 'flare') {
    const cut = clamp(Math.atan(lat / clamp(ac.gs * 7, 250, 1500)), -20 * DEG, 20 * DEG);
    _h2.heading = L.hdg - cut + crab * (wheelH > 2 ? 1 : 0.3);
    _h2.bankMax = wheelH > 3 ? 8 * DEG : 4 * DEG;
    // выравнивание: вертикальная скорость гаснет пропорционально высоте (палуба — без выравнивания)
    _h2.vs = L.carrier ? -ac.gs * Math.tan(L.glide) : -Math.max(0.5, 0.42 * Math.max(wheelH, 0));
    apHold(ac, _h2, dt);
    c.pitch = pitchForVs(ac, _h2.vs, 2.6, 0.5, 2);
    c.throttle = L.carrier ? c.throttle : wheelH < 6 ? 0 : Math.min(c.throttle, 0.3);
    c.airbrake = 0;
    if (ac.onGround) { L.phase = 'rollout'; L.t = 0; }
    else if (s < -L.rw.length * 0.65) { L.phase = 'goaround'; L.ga = 0; }
    return L.phase;
  }

  // --- пробег ---
  if (!ac.onGround && ac.agl > 2.5 && L.phase === 'rollout' && ac.gs > 0.8 * spec.vStallLand) { L.phase = 'flare'; return L.phase; }
  L.t += dt;
  c.throttle = 0;
  c.roll = 0;
  c.pitch = ac.onGround ? -0.1 : pitchForVs(ac, -0.6, 2.6, 0.5, 2);
  c.airbrake = 1;
  c.brake = L.t > 0.6 ? 1 : 0;
  c.yaw = ac.onWater ? clamp(2 * wrapPi(L.hdg - ac.heading), -1, 1) : clamp(3 * wrapPi(L.hdg - ac.heading) - 0.04 * lat, -1, 1);
  if (ac.gs < 0.8 && ac.onGround) L.phase = 'stopped';
  return L.phase;
}

// ---------- строй ----------
// offset — место относительно ведущего в его осях: x вправо, y вверх, z назад (м)
export function apFollow(ac, leader, offset, dt) {
  const lh = leader.heading, fx = Math.sin(lh), fz = -Math.cos(lh);
  const ox = offset.x || 0, oy = offset.y || 0, oz = offset.z || 0;
  const sx = leader.pos.x + -fz * ox - fx * oz, sz = leader.pos.z + fx * ox - fz * oz, sy = leader.pos.y + oy;
  const ex = sx - ac.pos.x, ez = sz - ac.pos.z, ey = sy - ac.pos.y;
  const along = ex * fx + ez * fz; // + мы позади места
  const cross = ex * -fz + ez * fx; // + место правее
  const V = Math.max(ac.tas, 20);
  const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
  clear(_h2);
  if (dist > 14 * V || Math.abs(along) > 10 * V) {
    // далеко: догоняем напрямую
    _h2.heading = Math.atan2(ex + fx * V * 3, -(ez + fz * V * 3));
    _h2.alt = sy;
    _h2.speed = clamp(leader.ias + 0.12 * along, ac.spec.vStall * 1.3, ac.spec.vMax * 0.97);
    _h2.afterburner = along > 25 * V;
  } else {
    // близко: держим курс ведущего с поправкой на боковое уклонение, скорость — по продольному
    const look = clamp(V * 5, 200, 1500);
    _h2.heading = lh + clamp(Math.atan(cross / look), -35 * DEG, 35 * DEG);
    _h2.bankFF = leader.bank * 0.8;
    _h2.alt = sy;
    _h2.vsFF = leader.vs;
    _h2.speed = clamp(leader.ias + clamp(0.22 * along, -0.2 * V, 0.25 * V), ac.spec.vStall * 1.2, ac.spec.vMax);
    _h2.afterburner = along > 3 * V;
  }
  apHold(ac, _h2, dt);
  return dist;
}

// ---------- преследование цели ----------
// target: { pos, vel? } (самолёт или наземная цель). opts: { lead: скорость снаряда для упреждения (м/с, 0 — без упреждения; по умолчанию 850),
//   speed: приборная, которую держать; range: желаемая дистанция (по умолчанию 350 м); floor: высота над землёй, ниже которой вниз не тянем (250 м);
//   maxG: ограничение перегрузки }. Возвращает ac.ap.pursue: { dist, off (рад, угол от носа до точки прицеливания), closure (м/с), inCone }.
export function apPursue(ac, target, dt, opts) {
  const ap = state(ac), c = ac.controls, spec = ac.spec, out = ap.pursue;
  track(ap, ac, dt);
  const tv = target.vel;
  _d.subVectors(target.pos, ac.pos);
  const dist0 = _d.length();
  const lead = opts && opts.lead != null ? opts.lead : 850;
  if (lead > 0 && tv) {
    const tL = Math.min(dist0 / (lead + ac.tas), 3);
    _d.addScaledVector(tv, tL).addScaledVector(ac.vel, -tL * 0); // цель уйдёт за время полёта снаряда
    _d.y += 0.5 * G0 * tL * tL * 0.5; // и снаряд просядет
  }
  const dist = _d.length() || 1;
  out.dist = dist0;
  out.closure = tv ? -((tv.x - ac.vel.x) * _d.x + (tv.y - ac.vel.y) * _d.y + (tv.z - ac.vel.z) * _d.z) / dist : ac.tas;
  if (!ac.alive) return out;
  _d.multiplyScalar(1 / dist);
  // направление полёта и «ошибка» — составляющая направления на цель поперёк скорости
  const V = Math.max(ac.tas, 0.5 * spec.vStall);
  _v.copy(ac.vel).multiplyScalar(1 / Math.max(ac.vel.length(), 1));
  _q.copy(ac.quat).invert();
  _l.copy(_d).applyQuaternion(_q); // в связанных осях: x вправо, y вверх, z назад
  const off = Math.atan2(Math.hypot(_l.x, _l.y), -_l.z);
  out.off = off;
  out.inCone = off < 2.5 * DEG;
  _e.copy(_d).addScaledVector(_v, -_d.dot(_v));
  const eLen = _e.length();
  const offV = Math.atan2(eLen, _d.dot(_v));
  if (eLen > 1e-5) _e.multiplyScalar(1 / eLen); else _e.set(0, 1, 0);
  // у земли вниз не тянем
  const floor = (opts && opts.floor) || 250;
  const low = clamp((ac.agl - 0.4 * floor) / (0.6 * floor), 0, 1);
  let pullUp = 0;
  if (_e.y < 0) { _e.y *= low; }
  if (ac.agl < floor * 0.6 && ac.vs < -0.05 * V * (ac.agl / (floor * 0.6))) pullUp = 1 - ac.agl / (floor * 0.6);
  // нужная нормальная перегрузка: довернуть вектор скорости за ~0.7 с на оставшийся угол, но не больше располагаемой
  const gMax = Math.min((opts && opts.maxG) || spec.maxG, ac.ctl.nHi > 1.2 ? ac.ctl.nHi : spec.maxG);
  const aN = Math.min((1.6 * offV * V) / G0, gMax);
  // вектор тяги крыла = манёвр + компенсация веса
  _l.copy(_e).multiplyScalar(aN);
  _l.y += 1 + 3 * pullUp;
  const nTot = _l.length();
  _l.applyQuaternion(_q);
  let rollErr = Math.atan2(_l.x, _l.y); // + — крениться вправо
  // малые ошибки — не крутим бочки ради полградуса
  const fine = smoothstep(1.5 * DEG, 6 * DEG, offV);
  if (fine < 1 && pullUp === 0) rollErr = rollErr * fine + wrapPi(clamp(Math.atan2(_l.x, 1) * 2, -0.6, 0.6) - ac.bank * 0) * (1 - fine) * 0.5;
  const rm = ac.ctl.rollMax > 0.05 ? ac.ctl.rollMax : spec.rollRate;
  c.roll = clamp((3.2 * rollErr) / rm, -1, 1);
  // тянем, только когда подъёмная сила смотрит куда надо
  const align = Math.cos(clamp(rollErr, -Math.PI / 2, Math.PI / 2));
  const n = Math.abs(rollErr) < 1.2 ? Math.max(nTot * align, 0.4) : 0.4;
  c.pitch = pitchForG(ac, clamp(n, -1, gMax));
  c.yaw = clamp(-_l.x * 0 + (offV < 8 * DEG ? Math.atan2((_d.applyQuaternion(_q)).x, -_d.z) * 4 : 0), -1, 1);
  // скорость: не теряем энергию в вираже, не проскакиваем цель
  const vCorner = spec.vStall * Math.sqrt(spec.maxG) * 0.95;
  const range = (opts && opts.range) || 350;
  let vT = opts && opts.speed != null ? opts.speed : tv ? clamp(Math.hypot(tv.x, tv.y, tv.z) + clamp((dist0 - range) * 0.12, -40, 120), 1.5 * spec.vStall, spec.vMax * 0.98) : Math.min(spec.vCruise * 1.1, spec.vMax);
  if (!(opts && opts.speed != null) && offV > 25 * DEG) vT = Math.max(vT, Math.min(vCorner, spec.vMax * 0.9));
  c.throttle = throttleFor(ac, vT, dt, true);
  c.airbrake = ac.ias > vT + 30 && c.throttle < 0.05 ? 1 : 0;
  c.brake = 0;
  return out;
}

// Минимальная безопасная высота по направлению полёта: максимум рельефа на ближайшие seconds секунд + запас
export function apTerrainFloor(ac, world, margin = 150, seconds = 20) {
  const h = world.heightAt || ((x, z) => world.groundAt(x, z).y);
  let top = h(ac.pos.x, ac.pos.z);
  for (let i = 1; i <= 4; i++) {
    const t = (seconds * i) / 4;
    const y = h(ac.pos.x + ac.vel.x * t, ac.pos.z + ac.vel.z * t);
    if (y > top) top = y;
  }
  return Math.max(top, 0) + margin;
}
