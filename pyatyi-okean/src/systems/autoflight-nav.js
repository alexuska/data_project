// Навигационные помощники автопилота: курсы, ветер, погода для радио, выбор рабочей полосы, маршрут руления.
// Без DOM и без three — чистые функции (их же использует карта ui/map.js).
import { DEG, wrapPi } from '../core/util.js';

export const deg360 = (rad) => ((Math.round(rad / DEG) % 360) + 360) % 360;
// курс «090°» (север — 360°, как в авиации)
export const fmtHdg = (rad) => String(deg360(rad) || 360).padStart(3, '0') + '°';
// номер торца полосы по курсу: 90° → «09»
export const rwNum = (h) => String(Math.round((((h / DEG) % 360) + 360) % 360 / 10) || 36).padStart(2, '0');
export const bearing = (fx, fz, tx, tz) => Math.atan2(tx - fx, -(tz - fz));
export const fmtKm = (m) => (m < 10000 ? (m / 1000).toFixed(1).replace('.', ',') : String(Math.round(m / 1000))) + ' км';
export function fmtMin(sec) {
  if (!isFinite(sec) || sec > 5999) return '—';
  if (sec < 60) return 'меньше минуты';
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

export const aptName = (a) => (a ? (a.kind === 'carrier' ? '«Буревестник»' : a.name) : '');
export function towerName(a) {
  if (!a) return 'Вышка';
  if (a.kind === 'carrier') {
    const m = /«(.+)»/.exec(a.name);
    return (m ? m[1] : a.name) + '-Старт';
  }
  return a.name + '-Вышка';
}

// ветер: откуда дует (рад), скорость, фраза
export function windInfo(world) {
  const w = world.wind || { x: 0, z: 0 };
  const spd = Math.hypot(w.x, w.z);
  const from = Math.atan2(-w.x, w.z);
  return { spd, from, text: spd < 1 ? 'штиль' : `ветер ${fmtHdg(from)} ${Math.round(spd)} м/с` };
}

const WX = { clear: 'ясно', cloudy: 'облачно', overcast: 'сплошная облачность', rain: 'дождь', storm: 'гроза', fog: 'туман', snow: 'снег' };
const QNH = { clear: 1018, cloudy: 1014, overcast: 1009, rain: 1005, storm: 998, fog: 1016, snow: 1007 };
export function weatherInfo(world) {
  const w = world.weather || {};
  const vis = w.visibility || 20000;
  const visText = vis >= 10000 ? 'видимость больше 10 км' : vis >= 1500 ? `видимость ${Math.round(vis / 1000)} км` : `видимость ${Math.max(100, Math.round(vis / 100) * 100)} м`;
  const qnh = QNH[w.type] || 1013;
  return { type: w.type || 'clear', sky: WX[w.type] || 'ясно', vis, visText, qnh, cloudBase: w.cloudBase || 0 };
}

// рабочая полоса по ветру: { index, end, heading, name, runway, len, head }
// spec — чтобы не предлагать слишком короткую полосу (если есть длиннее)
export function bestRunway(a, world, spec) {
  const w = world.wind || { x: 0, z: 0 };
  let best = null, bs = -1e9;
  const rws = (a && a.runways) || [];
  for (let i = 0; i < rws.length; i++) {
    const rw = rws[i];
    for (let e = 0; e < 2; e++) {
      const h = rw.heading + e * Math.PI;
      const head = -(w.x * Math.sin(h) - w.z * Math.cos(h)); // встречная составляющая, м/с
      let score = head + rw.length / 1500;
      if (spec && spec.landingRun && rw.length < spec.landingRun * 1.25) score -= 50;
      if (score > bs) { bs = score; best = { index: i, end: e ? 'B' : 'A', heading: h, name: rwNum(h), runway: rw, len: rw.length, head }; }
    }
  }
  return best;
}

// полоса, по которой самолёт сейчас стоит/катится: { index, end, heading, name } либо null
export function runwayUnder(ac) {
  const a = ac.airport, rw = ac.surface === 'runway' && a ? a.runways.find((r) => {
    const dx = Math.sin(r.heading), dz = -Math.cos(r.heading);
    const rx = ac.pos.x - r.cx, rz = ac.pos.z - r.cz;
    return Math.abs(rx * dx + rz * dz) <= r.length / 2 + 5 && Math.abs(rx * -dz + rz * dx) <= r.width / 2 + 5;
  }) : null;
  if (!rw) return null;
  const e = Math.abs(wrapPi(ac.heading - rw.heading)) < Math.PI / 2 ? 0 : 1;
  const h = rw.heading + e * Math.PI;
  return { index: a.runways.indexOf(rw), end: e ? 'B' : 'A', heading: h, name: rwNum(h), runway: rw };
}

// прямая видимость: высота рельефа по линии (максимум) — для безопасной высоты маршрута
export function routeTop(world, x0, z0, x1, z1, n = 32) {
  let top = 0;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    top = Math.max(top, world.heightAt(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k));
  }
  return top;
}

// ---------- руление ----------
// Маршрут от точки (x, z) на перроне к исполнительному старту полосы 0 по рулёжкам планировки аэродрома.
// Возвращает { points: [{x, z}], end, name, start } — start = world.runwayStart(...).
export function taxiRoute(world, a, x, z, rwSel) {
  const rw = a.runways[0];
  const end = rwSel && rwSel.index === 0 ? rwSel.end : 'A';
  const start = world.runwayStart(a.id, 0, end);
  const dx = Math.sin(rw.heading), dz = -Math.cos(rw.heading);
  const toL = (px, pz) => ({ u: (px - rw.cx) * dx + (pz - rw.cz) * dz, v: (px - rw.cx) * -dz + (pz - rw.cz) * dx });
  const toW = (u, v) => ({ x: rw.cx + dx * u - dz * v, z: rw.cz + dz * u + dx * v });
  const me = toL(x, z), st = toL(start.x, start.z);
  const L = rw.length, W = rw.width;
  const taxi = (a.plan && a.plan.taxi) || [];
  let par = null, conn = null, cd = 1e9;
  for (const r of taxi) {
    const len = r.u1 - r.u0;
    if (len > L * 0.5) { par = r; continue; }
    if (len < 40 && Math.min(Math.abs(r.v0), Math.abs(r.v1)) <= W / 2 + 2) {
      const uc = (r.u0 + r.u1) / 2, d = Math.abs(uc - st.u);
      if (d < cd) { cd = d; conn = r; }
    }
  }
  const pts = [];
  if (conn) {
    const uc = (conn.u0 + conn.u1) / 2;
    const far = Math.abs(conn.v0) > Math.abs(conn.v1) ? conn.v0 : conn.v1;
    const sgn = Math.sign(far) || 1;
    const vRow = par ? (par.v0 + par.v1) / 2 : far + sgn * 12;
    pts.push(toW(me.u, vRow), toW(uc, vRow), toW(uc, 0));
  }
  pts.push({ x: start.x, z: start.z });
  // убрать слишком короткие отрезки
  const out = [];
  let px = x, pz = z;
  for (const p of pts) {
    if (Math.hypot(p.x - px, p.z - pz) < 8) continue;
    out.push(p); px = p.x; pz = p.z;
  }
  if (!out.length) out.push({ x: start.x, z: start.z });
  return { points: out, end, name: rwNum(start.heading), start };
}

