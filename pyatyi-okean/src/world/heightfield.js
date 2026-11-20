// Рельеф архипелага: чистая математика без three (можно импортировать в node).
// Высоты считаются один раз в сетку Float32Array; heightAt — выборка из неё по тем же треугольникам, что и у меша.
import { fbm2, noise2, clamp, lerp, smoothstep, headingVec, mulberry32 } from '../core/util.js';
import { WORLD_SIZE, AIRPORTS, POI_BY_ID, LAKE } from './layout.js';

export const GRID_N = 640; // клеток по стороне
export const CELL = WORLD_SIZE / GRID_N; // 100 м
export const HALF = WORLD_SIZE / 2;
export const SEA_FLOOR = -48;

// ---------- помощники ----------
function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
function smax(a, b, k) { return -smin(-a, -b, k); }
function bump(dx, dz) {
  const r2 = dx * dx + dz * dz;
  if (r2 >= 1) return 0;
  const t = 1 - r2;
  return t * t;
}
function ridged(x, z, oct, seed) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(2 * noise2(x * f, z * f, seed + i * 31) - 1);
    n *= n;
    sum += amp * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return sum / norm;
}
function capsule(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
// «глубина внутрь» эллипса (м): >0 внутри, <0 снаружи
function blobD(x, z, b) {
  const dx = x - b.x, dz = z - b.z;
  const u = dx * b.c + dz * b.s, v = -dx * b.s + dz * b.c;
  const q = Math.sqrt((u * u) / (b.a * b.a) + (v * v) / (b.b * b.b));
  const r = Math.sqrt(u * u + v * v);
  if (q < 1e-6) return Math.min(b.a, b.b);
  return r / q - r;
}
const B = (x, z, a, b, rotDeg = 0) => ({ x, z, a, b, c: Math.cos((rotDeg * Math.PI) / 180), s: Math.sin((rotDeg * Math.PI) / 180) });
const shore = (d, L, plain) => plain * (1 - Math.exp(-d / L));
const seabed = (d, Ls) => SEA_FLOOR * (1 - Math.exp(d / Ls));

const P = POI_BY_ID;
const AP = Object.fromEntries(AIRPORTS.map((a) => [a.id, a]));

// ---------- острова ----------
// id биома: 1 центральный, 2 Каменный, 3 Гавань, 4 вулкан, 5 Маяк, 6 Полярный, 7 Южный, 8 островки
export const ISLE = { SEA: 0, CENTRAL: 1, KAMENNY: 2, GAVAN: 3, VOLCANO: 4, MAYAK: 5, POLAR: 6, SOUTH: 7, ISLET: 8 };

const kam = AP.kamenny.runways[0], kamD = headingVec(kam.heading);
const gav = AP.gavan.runways[0], gavD = headingVec(gav.heading);

const isles = [
  {
    id: ISLE.CENTRAL, seed: 11, warpA: 850, warpL: 3400, warpB: 200, warpL2: 800, shelf: 420,
    blobs: [B(-2600, 900, 8200, 6200, 8), B(4900, -11300, 6000, 5200, 25), B(-3800, -5400, 5200, 3900, -15), B(2350, 5300, 3150, 2500, 0), B(1500, -5500, 4200, 3600, 0)],
    carve(x, z, d) {
      // пролив под Большим мостом и залив у города
      d = smin(d, capsule(x, z, 5650, 2500, 5650, 9800) - 400, 260);
      // фьорд ниже плотины
      d = smin(d, capsule(x, z, -6050, -7650, -7600, -9700) - 230, 200);
      return d;
    },
    height(x, z, d) {
      let h = shore(d, 340, 20);
      const inl = smoothstep(250, 2400, d);
      h += Math.max(0, fbm2(x / 2600, z / 2600, 4, 31) - 0.42) * 170 * inl;
      // Западный лес — холмы
      const g1 = bump((x + 6800) / 4200, (z + 1200) / 3600);
      if (g1 > 0) h += g1 * (50 + 190 * fbm2(x / 1500, z / 1500, 4, 37)) * inl;
      // северные холмы у плотины
      const g2 = bump((x + 4000) / 4600, (z + 5200) / 3700);
      if (g2 > 0) h += g2 * (150 + 380 * ridged(x / 2700, z / 2700, 4, 41)) * smoothstep(100, 1500, d);
      // горный массив
      const g3 = bump((x - 5700) / 5900, (z + 11900) / 5300);
      if (g3 > 0) {
        const m = Math.pow(g3, 0.75);
        const rd = ridged(x / 3300, z / 3300, 5, 53);
        h += m * (470 + 1500 * rd) * smoothstep(0, 1300, d);
        const pk = Math.max(0, 1 - Math.hypot(x - P.peak.x, z - P.peak.z) / 1700);
        h += 760 * Math.pow(pk, 1.5);
        const ob = bump((x - P.observatory.x) / 900, (z - P.observatory.z) / 900);
        if (ob > 0) h = lerp(h, 1090 + 60 * ob, ob * 0.9);
      }
      return h;
    },
  },
  {
    id: ISLE.KAMENNY, seed: 23, warpA: 420, warpL: 1900, warpB: 160, warpL2: 520, shelf: 140,
    blobs: [B(-14500, -9700, 4300, 2700, 50), B(-16600, -11900, 1900, 1500, 0)],
    height(x, z, d) {
      let h = shore(d, 75, 30) + (fbm2(x / 900, z / 900, 3, 67) - 0.5) * 24 * smoothstep(0, 300, d);
      const dx = x - kam.cx, dz = z - kam.cz;
      const u = dx * kamD.x + dz * kamD.z, v = dx * -kamD.z + dz * kamD.x;
      const rm = smoothstep(820, 1700, v) * smoothstep(0, 420, d) + smoothstep(1700, 2600, -u) * smoothstep(300, 900, Math.abs(v)) * smoothstep(0, 400, d) * 0.7;
      if (rm > 0) h += rm * (50 + 420 * ridged(x / 1500, z / 1500, 4, 61));
      return h;
    },
  },
  {
    id: ISLE.GAVAN, seed: 37, warpA: 480, warpL: 2300, warpB: 150, warpL2: 600, shelf: 380,
    blobs: [B(11300, 9350, 5100, 2150, -12), B(13800, 8300, 2300, 1900, 0), B(7750, 7950, 2350, 880, 40)],
    carve(x, z, d) {
      d = smin(d, capsule(x, z, 12900, 11550, 12900, 13500) - 430, 250); // бухта порта
      return d;
    },
    height(x, z, d) {
      let h = shore(d, 300, 10);
      const dx = x - gav.cx, dz = z - gav.cz;
      const v = dx * -gavD.z + dz * gavD.x;
      const hm = smoothstep(500, 1500, -v) * smoothstep(100, 900, d);
      h += hm * (30 + 260 * fbm2(x / 1300, z / 1300, 4, 71)) + Math.max(0, fbm2(x / 1100, z / 1100, 3, 73) - 0.5) * 60 * smoothstep(200, 800, d);
      return h;
    },
  },
  {
    id: ISLE.VOLCANO, seed: 43, warpA: 380, warpL: 2100, warpB: 140, warpL2: 600, shelf: 240,
    blobs: [B(P.volcano.x, P.volcano.z, 4400, 4100, 0), B(P.volcano.x - 2600, P.volcano.z + 2900, 1900, 1400, 30)],
    height(x, z, d) {
      const dx = x - P.volcano.x, dz = z - P.volcano.z;
      const r = Math.hypot(dx, dz);
      let h = shore(d, 220, 14);
      let cone = 1640 * Math.pow(Math.max(0, 1 - r / 4000), 1.75);
      const ang = Math.atan2(dz, dx);
      // радиальные борозды-барранкосы
      const gul = noise2(ang * 5.5 + 20, r / 2600, 47) - 0.5;
      cone *= 1 + gul * 0.22 * smoothstep(300, 1200, r);
      cone += (fbm2(x / 800, z / 800, 3, 49) - 0.5) * 70 * smoothstep(0.02, 0.2, cone / 1640);
      const cr = 520;
      if (r < cr + 220) {
        const rim = 1640 * Math.pow(1 - cr / 4000, 1.75);
        const bowl = rim - 190 * (1 - (r / cr) * (r / cr));
        cone = r < cr ? Math.min(cone, bowl) : lerp(Math.min(cone, rim + 14), cone, smoothstep(cr, cr + 220, r));
      }
      h += cone * smoothstep(0, 600, d);
      return h;
    },
  },
  {
    id: ISLE.MAYAK, seed: 51, warpA: 110, warpL: 900, warpB: 50, warpL2: 300, shelf: 420, k: 260,
    blobs: [B(AP.mayak.x, AP.mayak.z, 1350, 560, 20), B(P.lighthouse.x, P.lighthouse.z, 420, 360, 0), B(-9900, 15850, 500, 300, -50)],
    height(x, z, d) {
      let h = shore(d, 110, 8) + fbm2(x / 400, z / 400, 3, 53) * 5 * smoothstep(0, 200, d);
      h += 34 * bump((x - P.lighthouse.x) / 300, (z - P.lighthouse.z) / 300);
      return h;
    },
  },
  {
    id: ISLE.POLAR, seed: 59, warpA: 700, warpL: 2800, warpB: 200, warpL2: 700, shelf: 300,
    blobs: [B(2600, -25300, 6300, 3300, 4), B(-1800, -27000, 3300, 2100, -20)],
    height(x, z, d) {
      let h = shore(d, 200, 17) + Math.max(0, fbm2(x / 1700, z / 1700, 4, 61) - 0.45) * 110 * smoothstep(200, 1200, d);
      const m = bump((x + 1500) / 3900, (z + 27300) / 1900) + 0.8 * bump((x - 6500) / 2300, (z + 26400) / 1500);
      if (m > 0) h += Math.min(1, m) * (120 + 620 * ridged(x / 2300, z / 2300, 4, 63)) * smoothstep(0, 700, d);
      return h;
    },
  },
  {
    id: ISLE.SOUTH, seed: 67, warpA: 620, warpL: 2600, warpB: 180, warpL2: 650, shelf: 1100,
    blobs: [B(18700, 21000, 3700, 4500, -8), B(21300, 19300, 2100, 1700, 0)],
    carve(x, z, d) {
      d = smin(d, capsule(x, z, 21500, 23300, 23800, 24600) - 950, 500); // лагуна курорта
      return d;
    },
    height(x, z, d) {
      let h = shore(d, 520, 9);
      const m = bump((x - 20900) / 2400, (z - 19300) / 2200) + 0.6 * bump((x - 16900) / 1500, (z - 22800) / 1900);
      if (m > 0) h += Math.min(1, m) * (40 + 330 * fbm2(x / 1300, z / 1300, 4, 69)) * smoothstep(200, 1000, d);
      h += Math.max(0, fbm2(x / 1000, z / 1000, 3, 75) - 0.5) * 50 * smoothstep(300, 900, d);
      return h;
    },
  },
];

// мелкие островки и скалы
const islets = [];
(function makeIslets() {
  const rnd = mulberry32(777);
  const fixed = [
    // гряда «Семь Ветров» на юго-западе
    [-19500, 18600, 520, 95], [-18400, 19600, 380, 70], [-20400, 20000, 300, 120], [-17500, 20800, 450, 40],
    [-21300, 21300, 260, 85], [-16400, 21900, 330, 55], [-19200, 21700, 220, 60],
    // атоллы у Южного
    [24600, 26300, 620, 5], [13200, 25200, 520, 4], [25300, 17300, 430, 6],
    // скалы у Каменного и в проливах
    [-18900, -6200, 330, 110], [-11100, -13600, 280, 80], [9800, -3000, 420, 60], [19600, 1500, 520, 35],
    [-13800, 4800, 560, 45], [-2600, 12800, 520, 14], [7200, 16200, 600, 22], [-15000, 12200, 380, 70],
    // северные льдистые
    [-7500, -22000, 620, 60], [10800, -21300, 500, 90], [-9500, -27500, 700, 40], [13500, -27000, 560, 30], [-13800, -19500, 420, 100],
    [23500, -14500, 600, 75], [26000, -4000, 380, 50], [-26500, -4500, 520, 65], [-27000, 14500, 450, 30], [1500, 24500, 700, 18], [8500, 27000, 480, 9],
    [26500, 9000, 520, 28], [-4500, 22500, 360, 55],
  ];
  for (const f of fixed) {
    const a = f[2] * (0.85 + rnd() * 0.5), b = f[2] * (0.6 + rnd() * 0.4);
    islets.push({ blob: B(f[0], f[1], a, b, rnd() * 180), top: f[3], seed: 100 + islets.length * 7, R: Math.max(a, b) });
  }
})();
export const ISLETS = islets.map((i) => ({ x: i.blob.x, z: i.blob.z, r: i.R, top: i.top }));

for (const is of isles) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const b of is.blobs) {
    const r = Math.max(b.a, b.b);
    x0 = Math.min(x0, b.x - r); x1 = Math.max(x1, b.x + r); z0 = Math.min(z0, b.z - r); z1 = Math.max(z1, b.z + r);
  }
  is.margin = is.warpA + is.warpB + 4.5 * is.shelf;
  is.x0 = x0 - is.margin; is.x1 = x1 + is.margin; is.z0 = z0 - is.margin; is.z1 = z1 + is.margin;
}

// ---------- аэродромы: выравнивание и коридоры подхода ----------
function rectDist(r, x, z) {
  const dx = x - r.cx, dz = z - r.cz;
  const u = Math.abs(dx * r.ux + dz * r.uz) - r.hl, v = Math.abs(dx * -r.uz + dz * r.ux) - r.hw;
  return Math.hypot(Math.max(0, u), Math.max(0, v));
}
// вес выравнивания площадки (1 — ровно), 0 — вне зоны
export function flatWeight(a, x, z) {
  if (!a.flat) return 0;
  const R = a.radius + a.blend;
  if (Math.abs(x - a.x) > R || Math.abs(z - a.z) > R) return 0;
  let dm = 1e9;
  for (const r of a.flat) { const d = rectDist(r, x, z); if (d < dm) dm = d; }
  if (dm >= a.blend) return 0;
  return 1 - smoothstep(0, a.blend, dm);
}
const landAirports = AIRPORTS.filter((a) => a.kind !== 'carrier');

function applyAirports(x, z, h) {
  for (const a of landAirports) {
    const R = 10500;
    if (Math.abs(x - a.x) > R || Math.abs(z - a.z) > R) continue;
    // коридоры подхода: ограничение высоты рельефа вдоль продолжения оси полосы
    for (const rw of a.runways) {
      const d = headingVec(rw.heading);
      const dx = x - rw.cx, dz = z - rw.cz;
      const al = dx * d.x + dz * d.z, ac = Math.abs(dx * -d.z + dz * d.x);
      const s = Math.abs(al) - rw.length / 2;
      if (s <= 0 || s > 9000) continue;
      const gn = a.id === 'gnezdo';
      const far = gn ? 4200 : 9000;
      if (s > far) continue;
      const w = gn ? 150 + 0.1 * s : 260 + 0.24 * s;
      if (ac > w * 2.2) continue;
      let lim;
      if (gn) lim = a.elevation - clamp((s - 80) * 0.95, -6, 330) - Math.max(0, s - 500) * 0.05;
      else lim = a.elevation + 4 + Math.max(0, s - 250) * 0.03;
      if (h > lim) {
        const wc = (1 - smoothstep(w * 0.55, w * 2.2, ac)) * (1 - smoothstep(far * 0.7, far, s));
        h = lim + (h - lim) * (1 - wc);
      }
    }
    const fw = flatWeight(a, x, z);
    if (fw > 0) {
      // у воды не насыпаем «дамбу» далеко в море: вес падает на глубине (кроме самой площадки)
      h = lerp(h, a.elevation, fw >= 0.999 ? 1 : fw * fw * (3 - 2 * fw));
    }
  }
  return h;
}

// ---------- водохранилище ----------
const lakeB = B(LAKE.cx, LAKE.cz, LAKE.a, LAKE.b, 45);
export function lakeInside(x, z) {
  // >0 — внутри чаши (м от берега); учитывает линию плотины
  const al = (x - LAKE.damX) * LAKE.ax + (z - LAKE.damZ) * LAKE.az;
  if (al < 0) return -1e9;
  return blobD(x, z, lakeB) + (fbm2(x / 500, z / 500, 2, 91) - 0.5) * 260;
}
function applyLake(x, z, h) {
  if (Math.abs(x - LAKE.cx) > 3200 || Math.abs(z - LAKE.cz) > 3200) return h;
  const al = (x - LAKE.damX) * LAKE.ax + (z - LAKE.damZ) * LAKE.az; // вдоль оси от плотины
  const ac = Math.abs((x - LAKE.damX) * -LAKE.az + (z - LAKE.damZ) * LAKE.ax);
  const dl = blobD(x, z, lakeB) + (fbm2(x / 500, z / 500, 2, 91) - 0.5) * 260;
  if (al >= -60) {
    // борта чаши
    if (dl < 0 && dl > -900) {
      const need = LAKE.level + 7 + Math.min(-dl, 320) * 0.16;
      if (h < need) h = lerp(h, need, 1 - smoothstep(350, 900, -dl));
    }
    if (dl >= 0) h = Math.min(h, LAKE.level - 3 - 30 * smoothstep(0, 320, dl));
  }
  // ущелье ниже плотины
  if (al < 60 && al > -3400) {
    const s = -al;
    const floor = Math.max(SEA_FLOOR * 0.5, LAKE.level - 118 - s * 0.085);
    const half = 150 + s * 0.05;
    const wall = floor + Math.max(0, ac - half) * 0.9;
    if (h > wall) h = lerp(h, wall, smoothstep(-80, 120, s) * (1 - smoothstep(half + 250, half + 600, ac)));
  }
  return h;
}

// ---------- высота в точке (медленная: только для построения сетки) ----------
let _isle = 0;
export function rawHeight(x, z) {
  let h = SEA_FLOOR;
  _isle = 0;
  for (let i = 0; i < isles.length; i++) {
    const is = isles[i];
    if (x < is.x0 || x > is.x1 || z < is.z0 || z > is.z1) continue;
    let d = -1e9;
    const k = is.k || 700;
    for (let j = 0; j < is.blobs.length; j++) {
      const bd = blobD(x, z, is.blobs[j]);
      d = j === 0 ? bd : smax(d, bd, k);
    }
    if (d < -is.margin) continue;
    d += (fbm2(x / is.warpL, z / is.warpL, 4, is.seed) - 0.5) * 2 * is.warpA + (fbm2(x / is.warpL2, z / is.warpL2, 3, is.seed + 5) - 0.5) * 2 * is.warpB;
    if (is.carve) d = is.carve(x, z, d);
    const hi = d > 0 ? is.height(x, z, d) : seabed(d, is.shelf);
    if (hi > h) { h = hi; if (d > -300) _isle = is.id; }
  }
  for (let i = 0; i < islets.length; i++) {
    const it = islets[i], b = it.blob;
    const R = it.R + 1500;
    if (Math.abs(x - b.x) > R || Math.abs(z - b.z) > R) continue;
    let d = blobD(x, z, b);
    if (d < -1400) continue;
    d += (fbm2(x / 500, z / 500, 3, it.seed) - 0.5) * 2 * it.R * 0.3;
    let hi;
    if (d > 0) {
      const rocky = it.top > 30;
      hi = shore(d, rocky ? 40 : 130, rocky ? 12 : it.top + 2);
      if (rocky) hi += it.top * Math.pow(clamp(d / (it.R * 0.55), 0, 1), 0.8) * (0.55 + 0.9 * noise2(x / 240, z / 240, it.seed + 3));
    } else hi = seabed(d, it.top > 30 ? 130 : 520);
    if (hi > h) { h = hi; if (d > -300) _isle = ISLE.ISLET; }
  }
  h = applyLake(x, z, h);
  h = applyAirports(x, z, h);
  return h;
}

// ---------- сетка ----------
export function buildHeightfield() {
  const N = GRID_N, V = N + 1;
  const data = new Float32Array(V * V);
  const isle = new Uint8Array(V * V);
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < V; i++) {
      const x = -HALF + i * CELL;
      const k = j * V + i;
      data[k] = rawHeight(x, z);
      isle[k] = _isle;
    }
  }
  const inv = 1 / CELL;
  // Высота по тем же треугольникам, что и у меша (диагональ клетки чередуется в шахматном порядке)
  function heightAt(x, z) {
    let fx = (x + HALF) * inv, fz = (z + HALF) * inv;
    if (fx < 0 || fz < 0 || fx >= N || fz >= N) return SEA_FLOOR;
    const i = fx | 0, j = fz | 0;
    fx -= i; fz -= j;
    const k = j * V + i;
    const h00 = data[k], h10 = data[k + 1], h01 = data[k + V], h11 = data[k + V + 1];
    if ((i + j) & 1) {
      // диагональ 00–11
      if (fx >= fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
      return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    }
    // диагональ 10–01
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  function isleAt(x, z) {
    const i = clamp(Math.round((x + HALF) * inv), 0, N), j = clamp(Math.round((z + HALF) * inv), 0, N);
    return isle[j * V + i];
  }
  // уклон (0 — ровно … 1 — отвес) по центральным разностям
  function slopeAt(x, z) {
    const e = CELL * 0.6;
    const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
  }
  return { N, V, cell: CELL, data, isle, heightAt, isleAt, slopeAt };
}

// ---------- климат и растительность (для раскраски и деревьев) ----------
// 0 — умеренный, →1 арктика
export const arcticAt = (z) => smoothstep(-17500, -21500, z);
export const tropicAt = (z) => smoothstep(11000, 17500, z);
export function snowLineAt(x, z) {
  const t = clamp((z + 21500) / 11500, 0, 1); // −21500 и севернее → 0; −10000 → 1
  const base = z < -10000 ? lerp(-80, 1150, Math.pow(t, 0.8)) : 1150 + (z + 10000) * 0.05;
  return base + (fbm2(x / 900, z / 900, 2, 83) - 0.5) * 160;
}
export function treeLineAt(z) {
  return lerp(760, 60, smoothstep(-15500, -22500, z));
}
const cityP = P.city_yasny, forestP = P.forest_west;
// плотность леса 0..1
export function forestAt(x, z, h, slope, isleId) {
  if (h < 5 || slope > 0.42) return 0;
  if (isleId === ISLE.VOLCANO && h > 420) return 0;
  const tl = treeLineAt(z);
  if (h > tl) return 0;
  let f = smoothstep(0.47, 0.6, fbm2(x / 1700, z / 1700, 3, 71));
  const fw = bump((x - forestP.x) / 4300, (z - forestP.z) / 3600);
  f = Math.max(f, smoothstep(0.08, 0.35, fw));
  if (isleId === ISLE.SOUTH) f = Math.max(f * 0.8, smoothstep(0.42, 0.55, fbm2(x / 700, z / 700, 2, 77)) * 0.75);
  if (isleId === ISLE.POLAR) f *= 0.55;
  if (isleId === ISLE.KAMENNY) f *= 0.35;
  if (isleId === ISLE.MAYAK) f *= 0.3;
  f *= 1 - smoothstep(tl - 180, tl, h);
  f *= 1 - smoothstep(0.26, 0.42, slope);
  f *= smoothstep(5, 14, h);
  // вокруг города и аэродромов — без леса
  f *= smoothstep(1500, 2600, Math.hypot(x - cityP.x, z - cityP.z));
  if (f > 0) for (const a of landAirports) { const w = flatWeight(a, x, z); if (w > 0) f *= 1 - smoothstep(0.25, 0.7, w); }
  return f;
}
// «городская» зона 0..1 (для раскраски земли)
export const TOWNS = [
  { id: 'city', x: cityP.x, z: cityP.z, r: 1750 },
  { id: 'gavan', x: 12550, z: 10450, r: 650 },
  { id: 'resort', x: P.resort.x, z: P.resort.z, r: 620 },
];
export function urbanAt(x, z) {
  let u = 0;
  for (const t of TOWNS) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.r * 1.25) u = Math.max(u, 1 - smoothstep(t.r * 0.7, t.r * 1.25, d));
  }
  return u;
}
// поля (лоскутное одеяло) на равнине центрального острова: 0 — нет, иначе номер «культуры» 1..4
export function fieldAt(x, z, h, slope, isleId) {
  if (isleId !== ISLE.CENTRAL && isleId !== ISLE.GAVAN) return 0;
  if (h < 8 || h > 80 || slope > 0.03 || z < -3500) return 0;
  const m = fbm2(x / 2100, z / 2100, 2, 87);
  if (m < 0.5) return 0;
  // повёрнутая сетка участков
  const u = x * 0.921 + z * 0.39, v = -x * 0.39 + z * 0.921;
  const iu = Math.floor(u / 420), iv = Math.floor(v / 260);
  let hsh = (Math.imul(iu, 374761393) + Math.imul(iv, 668265263)) | 0;
  hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177);
  return 1 + (((hsh ^ (hsh >>> 16)) >>> 0) % 5);
}
