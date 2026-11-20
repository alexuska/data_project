// ОКРАСКА: превращает «заплатки» формы в цвета вершин по схеме ливреи.
// Схема — функция (c) -> '#rrggbb' | undefined. c — описание грани:
//   part ('fus', 'wing', 'htail', 'fin', 'nac', 'radome', …), x, y, z (чертёжные: z от носа, y от земли), ax = |x|,
//   zn = z / длина, xn = |x| / полуразмах, nx, ny, nz (нормаль), a (по обводу фюзеляжа: 0 верх … 1 низ), k, i,
//   sp (по размаху крыла/киля: 0 корень … 1 законцовка), ch (по хорде: 0 носок … 1 задняя кромка), top, ctl, side, tip, cap, tag.
// undefined -> цвет «служебной» части из FIXED либо scheme.base.
import { Color } from 'three';

const _c = new Color();
const cache = new Map();
export function lin(hex) {
  let v = cache.get(hex);
  if (!v) { _c.set(hex); v = [_c.r, _c.g, _c.b]; cache.set(hex, v); }
  return v;
}

export const FIXED = {
  tire: '#1d1d20', hub: '#9ba1a6', strut: '#aab0b5', oleo: '#dfe3e6', dark: '#2b2e33', intake: '#121417',
  nozzle: '#57524d', nozzleIn: '#1b1816', metal: '#a4abb1', prop: '#27292c', propTip: '#e9b91f', wire: '#50555b',
  window: '#14202b', exhaust: '#3a3430', pitot: '#8a9096', gun: '#2a2c30', lamp: '#f6f2de', rubber: '#26272a',
  navR: '#1fa54a', navL: '#c62828', seat: '#3a3f45', pilot: '#e6e2d6', chuteA: '#f1efe6', chuteB: '#e8641c', chuteIn: '#c9c6bc',
  winRim: '#4e555c', cone: '#3b3631', fan: '#2a2d31', antenna: '#2c2f33', reg: '#1d2a3c',
};

// отделка поверхности: [шероховатость 0..1, металличность 0..1, «стекло» 0..1]
export const FIN = {
  gloss: [0.3, 0, 0], paint: [0.42, 0, 0], matte: [0.62, 0, 0], metal: [0.3, 0.72, 0], bare: [0.26, 0.8, 0],
  tire: [0.9, 0, 0], rubber: [0.88, 0, 0], hub: [0.32, 0.75, 0], strut: [0.3, 0.75, 0], oleo: [0.12, 1, 0], dark: [0.75, 0, 0],
  intake: [0.85, 0, 0], nozzle: [0.42, 0.8, 0], nozzleIn: [0.75, 0.3, 0], prop: [0.5, 0.15, 0], propTip: [0.4, 0, 0], wire: [0.4, 0.7, 0],
  window: [0.05, 0, 1], glass: [0.04, 0, 1], exhaust: [0.6, 0.55, 0], pitot: [0.22, 0.95, 0], gun: [0.45, 0.65, 0], lamp: [0.08, 0, 1],
  seat: [0.8, 0, 0], pilot: [0.7, 0, 0], chuteA: [0.9, 0, 0], chuteB: [0.9, 0, 0], chuteIn: [0.9, 0, 0], winRim: [0.6, 0, 0],
  cone: [0.55, 0.7, 0], fan: [0.5, 0.75, 0], antenna: [0.5, 0, 0], radome: [0.48, 0, 0], navR: [0.1, 0, 1], navL: [0.1, 0, 1],
};

const GLASS_LO = lin('#09121a'), GLASS_HI = lin('#3d5a6e');

function hash(i) {
  let t = (i * 0x9e3779b1) >>> 0;
  t ^= t >>> 15; t = Math.imul(t, 0x2c1b3c6d); t ^= t >>> 12;
  return (t >>> 0) / 4294967296;
}
const hash3 = (a, b, c) => hash((a * 73856093) ^ (b * 19349663) ^ (c * 83492791));
// плавный шум (вариации краски, потёртости) — по значению в узлах решётки
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const h = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

const SOOT = lin('#221e1b'), HEAT = lin('#5a4a3c');
const SKIN_PART = { fus: 1, wing: 1, htail: 1, fin: 1, nac: 1, pylon: 1, tank: 1, float: 1, cowl: 1, spinner: 1, frame: 1, door: 1, radome: 1, lip: 1, pod: 1, strutS: 1, boom: 1, vfin: 1, wing2: 1, emblemA: 1, emblemB: 1, reg: 1 };

// Возвращает { col: Float32Array(RGB на вершину), surf: Uint8Array(RGBA: шероховатость, металл, стекло, объём) }.
export function paintShape(shape, scheme, dims) {
  const { pos, nrm, ao, patches, cg } = shape;
  const nv = pos.length / 3;
  const col = new Float32Array(nv * 3), surf = new Uint8Array(nv * 4);
  const c = { L: dims.L, W: dims.W };
  const skinFin = scheme.finish ? FIN[scheme.finish] || scheme.finish : FIN.paint;
  const engines = shape.anchors.engines, jet = shape.jet;
  const wear = scheme.wear ?? 1;
  for (let pi = 0; pi < patches.length; pi++) {
    const p = patches[pi], v0 = p.v, n = p.n;
    let cx = 0, cy = 0, cz = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = v0; i < v0 + n; i++) {
      cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2];
      if (pos[i * 3 + 1] < y0) y0 = pos[i * 3 + 1];
      if (pos[i * 3 + 1] > y1) y1 = pos[i * 3 + 1];
    }
    cx /= n; cy /= n; cz /= n;
    const a = v0 * 3;
    const ux = pos[a + 3] - pos[a], uy = pos[a + 4] - pos[a + 1], uz = pos[a + 5] - pos[a + 2];
    const wx = pos[a + 6] - pos[a], wy = pos[a + 7] - pos[a + 1], wz = pos[a + 8] - pos[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    let fin;
    if (p.part === 'glass') {
      const span = Math.max(1e-3, y1 - y0);
      fin = FIN.glass;
      for (let i = v0; i < v0 + n; i++) {
        const t = (pos[i * 3 + 1] - y0) / span;
        const f = Math.min(1, 0.05 + 0.3 * Math.max(0, nrm[i * 3 + 1]) + 0.35 * t * t);
        col[i * 3] = GLASS_LO[0] + (GLASS_HI[0] - GLASS_LO[0]) * f;
        col[i * 3 + 1] = GLASS_LO[1] + (GLASS_HI[1] - GLASS_LO[1]) * f;
        col[i * 3 + 2] = GLASS_LO[2] + (GLASS_HI[2] - GLASS_LO[2]) * f;
        surf[i * 4] = fin[0] * 255; surf[i * 4 + 1] = 0; surf[i * 4 + 2] = 255; surf[i * 4 + 3] = 255 * Math.max(0.55, ao[i]);
      }
      continue;
    }
    c.part = p.part; c.x = cx + cg[0]; c.y = cy + cg[1]; c.z = cz + cg[2]; c.ax = Math.abs(c.x);
    c.zn = c.z / c.L; c.xn = c.ax / c.W;
    c.nx = nx; c.ny = ny; c.nz = nz;
    c.k = p.k; c.a = p.a; c.i = p.i; c.sp = p.sp; c.ch = p.ch; c.top = p.top; c.ctl = p.ctl; c.side = p.side || 1;
    c.tip = p.tip; c.cap = p.cap; c.tag = p.tag; c.wing = p.wing; c.decal = p.decal;
    c.fin = null;
    let hex = scheme(c);
    let jit = 0.045;
    const skin = !!SKIN_PART[p.part];
    if (hex == null) {
      if (FIXED[p.part]) { hex = FIXED[p.part]; jit = 0.025; } else hex = scheme.base || '#c9cdd1';
    }
    fin = c.fin ? (FIN[c.fin] || c.fin) : skin || !FIN[p.part] ? skinFin : FIN[p.part];
    if (p.decal) jit = 0;
    const rgb = lin(hex);
    // «панели»: мягкие различия тона по ячейкам ~1.5 м (обшивку красили и меняли листами)
    const f = 1 + (hash3(Math.floor(c.x / 1.3 + 0.5) + (p.mir ? 1000 : 0), Math.floor(c.y / 1.1), Math.floor(c.z / 1.7)) - 0.5) * jit * wear;
    const metal = fin[1] > 0.4;
    for (let i = v0; i < v0 + n; i++) {
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      // объём: в нишах и у корней — темнее (часть затенения — в шейдере, здесь — «грязь» в углах)
      const o = ao[i];
      let k = f * (0.55 + 0.45 * o);
      // потёртость/неравномерность краски
      if (skin || metal) k *= 1 + (vnoise(px * 0.55, py * 0.55, pz * 0.55) - 0.5) * (metal ? 0.16 : 0.07) * wear;
      let r = rgb[0] * k, g = rgb[1] * k, b = rgb[2] * k;
      // копоть у сопел реактивных двигателей
      if (jet && (skin || p.part === 'nozzle' || metal)) {
        let s = 0;
        for (const e of engines) {
          const dz = e[2] - pz;
          if (dz < -0.3 || dz > 4) continue;
          const dr = Math.hypot(px - e[0], py - e[1]);
          if (dr > 2.2) continue;
          s = Math.max(s, (1 - dz / 4) * Math.max(0, 1 - dr / 2.2));
        }
        if (s > 0) {
          s = Math.min(1, s * (p.part === 'nozzle' ? 1.1 : 0.75));
          const hc = p.part === 'nozzle' ? HEAT : SOOT;
          r += (hc[0] * k - r) * s; g += (hc[1] * k - g) * s; b += (hc[2] * k - b) * s;
        }
      }
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      surf[i * 4] = Math.min(255, fin[0] * 255 * (1 + (1 - o) * 0.4));
      surf[i * 4 + 1] = fin[1] * 255;
      surf[i * 4 + 2] = fin[2] * 255;
      surf[i * 4 + 3] = 255 * o;
    }
  }
  return { col, surf };
}

// ---------- генераторы схем ----------
const SKIN = { fus: 1, wing: 1, htail: 1, fin: 1, nac: 1, pylon: 1, tank: 1, float: 1, cowl: 1, spinner: 1, frame: 1, door: 1, radome: 1, lip: 1, pod: 1, strutS: 1, boom: 1, vfin: 1, wing2: 1 };

// «лайнерная»: светлый верх, цветная полоса вдоль иллюминаторов, серый низ, полоса на киле.
// o: { top, belly, cheat, a0, a1 (полоса по обводу), ab (с какого a начинается низ), z0, z1 (зона полосы, доли длины),
//      cheat2 + b0, b1 (вторая тонкая полоса), wing, wingTip (цвет законцовок) , fin, finBand: [sp0, sp1, цвет] | [[…],[…]],
//      rudder, nac, radome, lip, le (цвет носка крыла; null — не выделять), extra(c) — доработка }
export function civil(o) {
  const top = o.top || '#f2f2ed', belly = o.belly ?? '#aab1b8', wing = o.wing || '#c3c9ce';
  const bands = o.finBand ? (Array.isArray(o.finBand[0]) ? o.finBand : [o.finBand]) : [];
  const f = (c) => {
    if (o.extra) { const r = o.extra(c); if (r) return r; }
    switch (c.part) {
      case 'fus': case 'door':
        if (c.a == null) return top;
        if (c.a > (o.ab ?? 0.7)) return belly;
        if (o.cheat && c.a > o.a0 && c.a < o.a1 && c.zn > (o.z0 ?? 0.02) && c.zn < (o.z1 ?? 0.98)) return o.cheat;
        if (o.cheat2 && c.a > o.b0 && c.a < o.b1 && c.zn > (o.z0 ?? 0.02) && c.zn < (o.z1 ?? 0.98)) return o.cheat2;
        return top;
      case 'wing': case 'htail': case 'wing2':
        if (o.le !== null && c.ch < 0.05 && !c.tip && c.wing) { c.fin = 'bare'; return o.le || '#e2e5e7'; }
        if (o.wingTip && c.part !== 'htail' && c.sp > (o.wingTipFrom ?? 0.9)) return o.wingTip;
        if (o.tailTip && c.part === 'htail' && c.sp > 0.8) return o.tailTip;
        return wing;
      case 'fin': case 'vfin':
        if (c.ctl && o.rudder) return o.rudder;
        for (const b of bands) if (c.sp > b[0] && c.sp < b[1]) return b[2];
        return o.fin || top;
      case 'nac': case 'pod': return o.nac || top;
      case 'pylon': return o.pylon || o.nac || wing;
      case 'lip': return o.lip || '#b9bfc4';
      case 'radome': return o.radome || '#3d4147';
      case 'cowl': return o.cowl || top;
      case 'spinner': return o.spinner || o.cheat || top;
      case 'frame': return o.frame || top;
      case 'tank': return o.tank || top;
      case 'float': return o.float || top;
      case 'strutS': return o.strutS || wing;
      default: return undefined;
    }
  };
  f.base = top;
  f.finish = o.finish || 'gloss';
  return f;
}

// камуфляж: пятна по граням сверху, однотонный низ. o: { cols: [..2–4], under, scale, seed, radome, extra(c) }
export function camo(o) {
  const cols = o.cols, under = o.under || '#9fc4dc', sc = o.scale || 1, seed = o.seed || 0;
  const f = (c) => {
    if (o.extra) { const r = o.extra(c); if (r) return r; }
    if (c.part === 'radome') return o.radome || '#4a4f55';
    if (c.part === 'emblemA') return o.emblemA || '#f3f2ea';
    if (c.part === 'emblemB') return o.emblemB || '#1f6fc2';
    if (!SKIN[c.part]) return undefined;
    if (c.part === 'lip') return o.lip;
    if (c.ny < -0.42 && !o.noUnder) return under;
    const v = Math.sin(c.x * 0.83 * sc + Math.sin(c.z * 0.61 * sc + seed) * 1.7 + seed * 1.3) + Math.sin(c.z * 0.47 * sc + c.x * 0.31 * sc + seed * 2.1) * 0.9 + Math.sin(c.y * 1.1 * sc + c.z * 0.2 + seed) * 0.35;
    const t = (v + 2.25) / 4.5;
    return cols[Math.max(0, Math.min(cols.length - 1, Math.floor(t * cols.length)))];
  };
  f.base = cols[0];
  f.finish = o.finish || 'matte';
  return f;
}

// одноцветная с акцентами: o: { base, under, radome, extra(c) }
export function plain(o) {
  const f = (c) => {
    if (o.extra) { const r = o.extra(c); if (r) return r; }
    if (c.part === 'radome') return o.radome || '#4a4f55';
    if (c.part === 'emblemA') return o.emblemA || '#f3f2ea';
    if (c.part === 'emblemB') return o.emblemB || '#1f6fc2';
    if (!SKIN[c.part]) return undefined;
    if (o.under && c.ny < -0.42) return o.under;
    return o.base;
  };
  f.base = o.base;
  f.finish = o.finish || 'paint';
  if (o.wear != null) f.wear = o.wear;
  return f;
}

// «агрессор» условного противника: тёмно-серый ломаный камуфляж с красно-оранжевыми носом, законцовками и килями
export function aggressor() {
  const base = camo({ cols: ['#33383f', '#454b54', '#2a2e34'], under: '#555c66', scale: 1.3, seed: 4.2, radome: '#d8431f', emblemA: '#f29a1c', emblemB: '#201c1a' });
  const f = (c) => {
    if (c.part === 'fin' || c.part === 'vfin') { if (c.sp > 0.6) return c.sp > 0.8 ? '#d8431f' : '#f08a1c'; }
    if (c.part === 'wing' && c.sp > 0.84) return '#e8611c';
    if (c.part === 'htail' && c.sp > 0.78) return '#d8431f';
    if (c.part === 'tank') return '#e8611c';
    if ((c.part === 'fus' || c.part === 'cowl' || c.part === 'spinner') && c.zn < 0.075) return '#d8431f';
    return base(c);
  };
  f.base = '#33383f';
  f.finish = 'matte';
  return f;
}
