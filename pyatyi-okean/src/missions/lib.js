// Общие помощники заданий: геометрия, позывные и фразеология, оценка посадки, поиск площадок на рельефе.
import { DEG, clamp, wrapPi, wrapTau, headingVec, vecHeading } from '../core/util.js';

export { DEG, clamp, wrapPi, wrapTau, headingVec, vecHeading };
export const KMH = 3.6;
export const kmh = (v) => Math.round((v * 3.6) / 5) * 5;
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
// расстояние для карточек и маркеров: «450 м», «2,3 км», «14 км»
export const fmtDist = (d) => (d < 1000 ? Math.round(d / 10) * 10 + ' м' : d < 10000 ? (d / 1000).toFixed(1).replace('.', ',') + ' км' : Math.round(d / 1000) + ' км');
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

// ---------- радио ----------
// Позывной диспетчера строится из названия аэродрома (названия берём из мира, не константами):
// «Тирасполь-Вышка», военный — «Каменный-Старт», площадка — «Маяк-Радио», корабль — «Буревестник».
export function towerName(world, id) {
  const a = world.airportById[id];
  if (!a) return 'Вышка';
  const words = a.name.replace(/[«»"]/g, '').split(/\s+/);
  if (a.kind === 'carrier') return words[words.length - 1];
  if (a.kind === 'strip') return words[words.length - 1] + '-Радио';
  if (a.kind === 'military') return words[0] + '-Старт';
  return a.name + '-Вышка';
}
// номер полосы по курсу: 90° -> «09»
export const rwNum = (heading) => String(Math.round((((heading / DEG) % 360) + 360) % 360 / 10) || 36).padStart(2, '0');
// «ветер 240 градусов 5» (world.wind — куда дует)
export function windPhrase(world) {
  const w = world.wind, sp = Math.hypot(w.x, w.z);
  if (sp < 1) return 'ветер тихий';
  const from = Math.round(vecHeading(-w.x, -w.z) / DEG / 10) * 10 || 360;
  const v = Math.round(sp);
  return `ветер ${from} градусов, ${v} ${plural(v, 'метр', 'метра', 'метров')}`;
}

// ---------- полосы ----------
// точка в координатах полосы: u — вдоль курса hdg от центра, v — вправо
export function rwPoint(rw, hdg, u, v) {
  const d = headingVec(hdg);
  return { x: rw.cx + d.x * u - d.z * v, z: rw.cz + d.z * u + d.x * v };
}
// торец, с которого заходят курсом hdg
export function threshold(rw, hdg) { return rwPoint(rw, hdg, -rw.length / 2, 0); }
// точка на оси захода: s метров до торца, высота по глиссаде glide°
export function finalPoint(ap, rw, hdg, s, glideDeg = 3) {
  const p = rwPoint(rw, hdg, -rw.length / 2 - s, 0);
  p.y = ap.elevation + Math.tan(glideDeg * DEG) * (s + Math.min(300, rw.length * 0.15)) + 2;
  return p;
}

// ---------- оценка посадки (те же пороги, что у карточки посадки в HUD) ----------
export function scoreLanding(e) {
  const vs = Math.abs(e.vs || 0);
  const vsScore = vs < 1.2 ? 100 : vs < 2 ? 86 : vs < 3.2 ? 66 : vs < 4.5 ? 42 : 15;
  const rw = e.runway;
  let score = Math.round(vsScore * 0.6), across = null, zone = null, from = null;
  if (rw && typeof e.across === 'number') {
    across = Math.abs(e.across);
    const ratio = across / (rw.width / 2);
    const axScore = ratio < 0.25 ? 100 : ratio < 0.5 ? 82 : ratio < 0.85 ? 56 : 30;
    const ac = e.ac;
    const dir = ac.vel.x * Math.sin(rw.heading) - ac.vel.z * Math.cos(rw.heading) >= 0 ? 1 : -1;
    from = rw.length / 2 + (e.along || 0) * dir;
    const fr = from / rw.length;
    const znScore = fr < 0.04 ? 70 : fr <= 0.34 ? 100 : fr < 0.5 ? 62 : 26;
    zone = fr <= 0.34;
    score = Math.round(vsScore * 0.5 + axScore * 0.25 + znScore * 0.25);
  } else if (e.surface === 'water') score = vsScore;
  return { score, vs, across, zone, from, surface: e.surface, airportId: e.airport ? e.airport.id : null, bounces: 0, hard: !!e.hard };
}
export const landingWord = (l) => (!l ? '' : l.vs < 1.2 ? 'мягко' : l.vs < 2 ? 'хорошо' : l.vs < 3.2 ? 'ощутимо' : 'жёстко');

// ---------- рельеф ----------
// Ищет вокруг (cx, cz) точку суши: высота в [minH, maxH], уклон не больше slope (м на 60 м). Детерминированно, по спирали.
export function findLand(world, cx, cz, { rMax = 4000, minH = 4, maxH = 500, slope = 12, step = 250, skip = 0 } = {}) {
  const H = world.heightAt;
  let found = 0;
  for (let r = 0; r <= rMax; r += step) {
    const n = r === 0 ? 1 : Math.max(6, Math.round((6.28 * r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + r * 0.0007;
      const x = cx + Math.sin(a) * r, z = cz - Math.cos(a) * r;
      const h = H(x, z);
      if (h < minH || h > maxH) continue;
      if (Math.abs(H(x + 60, z) - h) > slope || Math.abs(H(x, z + 60) - h) > slope || Math.abs(H(x - 60, z) - h) > slope || Math.abs(H(x, z - 60) - h) > slope) continue;
      const g = world.groundAt(x, z);
      if (g.surface !== 'ground') continue;
      if (found++ < skip) continue;
      return { x, z, y: h };
    }
  }
  return { x: cx, z: cz, y: Math.max(0, H(cx, cz)) };
}
// Точка открытой воды рядом с (cx, cz)
export function findWater(world, cx, cz, { rMax = 6000, step = 300, depth = -3 } = {}) {
  const H = world.heightAt;
  for (let r = 0; r <= rMax; r += step) {
    const n = r === 0 ? 1 : Math.max(6, Math.round((6.28 * r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283;
      const x = cx + Math.sin(a) * r, z = cz - Math.cos(a) * r;
      if (H(x, z) < depth && H(x + 200, z) < depth && H(x - 200, z) < depth && H(x, z + 200) < depth && H(x, z - 200) < depth && world.groundAt(x, z).surface === 'water') return { x, z, y: 0 };
    }
  }
  return { x: cx, z: cz, y: 0 };
}
// максимум рельефа на отрезке (с шагом ~150 м)
export function ridge(world, ax, az, bx, bz) {
  const n = Math.max(2, Math.ceil(dist2(ax, az, bx, bz) / 150));
  let top = 0;
  for (let i = 0; i <= n; i++) {
    const k = i / n, h = world.heightAt(ax + (bx - ax) * k, az + (bz - az) * k);
    if (h > top) top = h;
  }
  return top;
}
export const bearing = (ax, az, bx, bz) => wrapTau(Math.atan2(bx - ax, -(bz - az)));
// точка по курсу hdg на дальности d от (x, z)
export const offset = (x, z, hdg, d) => ({ x: x + Math.sin(hdg) * d, z: z - Math.cos(hdg) * d });

// Полоса воды для глиссирования: точка (x, z) и курс heading, вдоль которого len метров открытой воды (глубже depth).
export function findScoop(world, cx, cz, { rMax = 9000, step = 400, len = 2600, depth = -2 } = {}) {
  const H = world.heightAt;
  const clear = (x, z, h) => {
    const dx = Math.sin(h), dz = -Math.cos(h);
    for (let s = -len / 2; s <= len / 2; s += 130) {
      const px = x + dx * s, pz = z + dz * s;
      if (H(px, pz) > depth || H(px - dz * 120, pz + dx * 120) > depth || H(px + dz * 120, pz - dx * 120) > depth) return false;
    }
    return true;
  };
  for (let r = 1200; r <= rMax; r += step) {
    const n = Math.max(8, Math.round((6.28 * r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283;
      const x = cx + Math.sin(a) * r, z = cz - Math.cos(a) * r;
      if (H(x, z) > depth) continue;
      // курс поперёк направления на центр — проход мимо берега, а не в него
      for (let k = 0; k < 6; k++) {
        const h = wrapTau(a + Math.PI / 2 + (k % 2 ? -1 : 1) * Math.floor((k + 1) / 2) * 0.35);
        if (clear(x, z, h)) return { x, z, heading: h };
      }
    }
  }
  const w = findWater(world, cx, cz);
  return { x: w.x, z: w.z, heading: 0 };
}
