// КОНСТРУКТОР НИЗКОПОЛИГОНАЛЬНЫХ САМОЛЁТОВ.
// Builder копит треугольники (неиндексированная геометрия, гранёный вид) двух слоёв:
//   «корпус»  — непрозрачный, красится потом ливреей по «заплаткам» (patch = грань/четырёхугольник + метаданные);
//   «оверлей» — огни, пламя форсажа, диски винтов (аддитивно/полупрозрачно, цвет RGBA задан сразу).
// Подвижные части привязаны к «костям» (жёсткая привязка: одна кость на вершину) — весь самолёт рисуется
// двумя вызовами отрисовки, а анимация — это пересчёт нескольких матриц (см. rig.js).
//
// Чертёжная система координат (в ней описываются самолёты): X вправо, Y вверх ОТ ЗЕМЛИ (колёса касаются y = 0),
// Z назад ОТ НОСА (нос в z = 0, хвост в z = длина). finish() переводит всё в систему модели
// (начало в центре тяжести, нос −Z): z' = z − cgZ, y' = y − gearHeight.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
// цвет оверлея с альфой: смешивание идёт в экранном (sRGB) пространстве, поэтому умножаем на альфу там же
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const pm = (r, g, b, a) => [s2l(r * a), s2l(g * a), s2l(b * a), a];
export const V = { sub, add, mul, cross, len, norm, lerp3 };

// каналы, у которых зеркальная (левая) копия отклоняется в противоположную сторону
const ANTISYM = { ail: 1, rud: 1 };

function mirrorName(n) {
  if (/R(\d*)$/.test(n)) return n.replace(/R(\d*)$/, 'L$1');
  return n + '_m';
}

// сечение фюзеляжа: [z, y, w, h, e=2, hb=h, eb=e] или объект {z, y, w, h, hb, e, eb, x, pts}
//   y — высота «оси» сечения, w — полуширина, h — полувысота вверх, hb — вниз, e/eb — показатель суперэллипса
//   (2 — эллипс, 3..5 — «квадратнее»), pts — явный полуконтур [[x, y]…] от верха до низа (n/2 + 1 точек),
//   rk — скос сечения: z += rk · (высота над осью) (клиновидный воздухозаборник: верхняя губа впереди при rk < 0)
function normSec(s) {
  if (Array.isArray(s)) s = { z: s[0], y: s[1], w: s[2], h: s[3], e: s[4], hb: s[5], eb: s[6], rk: s[7] };
  const e = s.e ?? 2;
  return { z: s.z, y: s.y ?? 0, w: s.w ?? 0, h: s.h ?? 0, hb: s.hb ?? s.h ?? 0, e, eb: s.eb ?? e, x: s.x || 0, pts: s.pts || null, rk: s.rk || 0 };
}

// m — дробление каждой грани обвода на m (круглое остаётся круглым, а «пояса» k для окраски — прежними)
function ringPts(s, n, flat, x0, m = 1) {
  const out = [];
  if (s.pts) {
    const h = n / 2;
    for (let k = 0; k <= h; k++) out.push([x0 + s.x + s.pts[k][0], s.pts[k][1], s.z]);
    for (let k = h - 1; k >= 1; k--) out.push([x0 + s.x - s.pts[k][0], s.pts[k][1], s.z]);
    return out;
  }
  for (let K = 0; K < n * m; K++) {
    const th = ((K / m + (flat ? 0.5 : 0)) / n) * Math.PI * 2;
    const sn = Math.sin(th), cs = Math.cos(th);
    const x = s.w * spow(sn, 2 / s.e);
    const y = cs >= 0 ? s.h * Math.pow(cs, 2 / s.e) : -s.hb * Math.pow(-cs, 2 / s.eb);
    out.push([x0 + s.x + x, s.y + y, s.z + s.rk * y]);
  }
  return out;
}

// наклоны монотонного кубического сплайна (Фритч–Карлсон): плавный обвод через сечения без «перехлёстов»
function pchip(xs, ys) {
  const n = xs.length, d = new Array(n).fill(0), h = [], dl = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; dl[i] = h[i] > 1e-9 ? (ys[i + 1] - ys[i]) / h[i] : 0; }
  if (n < 3) { d[0] = d[n - 1] = dl[0] || 0; return d; }
  for (let i = 1; i < n - 1; i++) {
    if (h[i - 1] < 1e-9 || h[i] < 1e-9 || dl[i - 1] * dl[i] <= 0) continue;
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    d[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]);
  }
  const end = (h0, h1, d0, d1) => {
    if (h0 < 1e-9) return 0;
    let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(v) !== Math.sign(d0)) v = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > Math.abs(3 * d0)) v = 3 * d0;
    return v;
  };
  d[0] = end(h[0], h[1], dl[0], dl[1]);
  d[n - 1] = end(h[n - 2], h[n - 3], dl[n - 2], dl[n - 3]);
  return d;
}

// углы сглаживания нормалей по умолчанию (градусы): грани с меньшим углом между собой сглаживаются, с большим — остаются острой кромкой
const PART_SA = { tire: 60, hub: 5, prop: 20, propTip: 20, door: 20, strutS: 20, chuteA: 50, chuteB: 50, chuteIn: 50 };
// каналы костей, чьи части не затеняют корпус при запекании объёма (убираются, крутятся, прячутся)
const AO_SKIP = { gear: 1, prop: 1, disc: 1, chute: 1, brake: 1, spoil: 1 };

// ближайшая к (px,py,pz) точка треугольника t (неиндексированный массив P): out = [x, y, z, d², u, w] (барицентры при B и C)
function closestOnTri(P, t, px, py, pz, out) {
  const i = t * 9;
  const ax = P[i], ay = P[i + 1], az = P[i + 2];
  const abx = P[i + 3] - ax, aby = P[i + 4] - ay, abz = P[i + 5] - az, acx = P[i + 6] - ax, acy = P[i + 7] - ay, acz = P[i + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d3a = acx * apx + acy * apy + acz * apz;
  let u, w;
  const aa = abx * abx + aby * aby + abz * abz, bb = acx * acx + acy * acy + acz * acz, ab = abx * acx + aby * acy + abz * acz;
  const den = aa * bb - ab * ab;
  if (den < 1e-14) { u = 0; w = 0; } else {
    u = (bb * d1 - ab * d3a) / den; w = (aa * d3a - ab * d1) / den;
    if (u < 0 || w < 0 || u + w > 1) {
      // проекция вне треугольника: зажимаем к ближайшему ребру (приближённо)
      u = Math.max(0, u); w = Math.max(0, w);
      const s = u + w; if (s > 1) { u /= s; w /= s; }
    }
  }
  const x = ax + abx * u + acx * w, y = ay + aby * u + acy * w, z = az + abz * u + acz * w;
  out[0] = x; out[1] = y; out[2] = z; out[3] = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2; out[4] = u; out[5] = w;
  return out;
}

export class Builder {
  constructor() {
    this.pos = []; this.bone = []; this.patch = [];
    this.opos = []; this.obone = []; this.ocol = [];
    this.bones = [{ name: 'root', pivot: [0, 0, 0], axis: [1, 0, 0], ch: null, gain: 1 }];
    this.bi = { root: 0 };
    this.curBone = 0;
    this.curPart = 'fus';
    this.anchors = { cockpit: null, engines: [], props: [], muzzles: [], hardpoints: [], wingtips: [], gearMain: [], gearNose: null };
    this.sgN = 1; // группы сглаживания: грани разных групп не сглаживаются между собой (0 — общая группа лофтов)
  }
  sg() { return this.sgN++; }

  // ---------- кости ----------
  // def: { pivot, axis, ch (канал анимации), max (рад на единицу канала), slide ([x,y,z] на единицу канала),
  //        hide (скрывать при убранном положении), t0, t1 (участок хода канала), ...доп. поля канала }
  addBone(name, def) {
    if (this.bi[name] != null) return this.bi[name];
    const b = { name, pivot: [0, 0, 0], axis: [1, 0, 0], ch: null, gain: 1, ...def };
    b.axis = norm(b.axis);
    this.bi[name] = this.bones.length;
    this.bones.push(b);
    return this.bi[name];
  }
  withBone(idx, fn) {
    const prev = this.curBone;
    this.curBone = typeof idx === 'string' ? this.bi[idx] : idx;
    fn();
    this.curBone = prev;
  }
  withPart(part, fn) {
    const prev = this.curPart;
    this.curPart = part;
    fn();
    this.curPart = prev;
  }

  // ---------- базовые грани ----------
  // многоугольник (веер) одной «заплаткой»; inside — точка «внутри тела»: нормаль разворачивается от неё
  face(pts, inside, meta) {
    const P = [];
    for (const p of pts) { const q = P[P.length - 1]; if (!q || d2(p, q) > 1e-10) P.push(p); }
    if (P.length > 1 && d2(P[0], P[P.length - 1]) < 1e-10) P.pop();
    const n = P.length;
    if (n < 3) return;
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    if (inside && nx * (cx / n - inside[0]) + ny * (cy / n - inside[1]) + nz * (cz / n - inside[2]) < 0) P.reverse();
    const v0 = this.pos.length / 3;
    for (let i = 1; i < n - 1; i++) {
      for (const p of [P[0], P[i], P[i + 1]]) { this.pos.push(p[0], p[1], p[2]); this.bone.push(this.curBone); }
    }
    this.patch.push({ v: v0, n: (n - 2) * 3, part: this.curPart, ...meta });
  }

  // ---------- зеркало по X ----------
  mirror(fn) {
    const v0 = this.pos.length / 3, p0 = this.patch.length, o0 = this.opos.length / 3, b0 = this.bones.length;
    const A = this.anchors;
    const a0 = { engines: A.engines.length, props: A.props.length, muzzles: A.muzzles.length, hardpoints: A.hardpoints.length, wingtips: A.wingtips.length, gearMain: A.gearMain.length };
    fn();
    const v1 = this.pos.length / 3, p1 = this.patch.length, o1 = this.opos.length / 3, b1 = this.bones.length;
    const map = {};
    for (let i = b0; i < b1; i++) {
      const s = this.bones[i];
      const m = { ...s, name: mirrorName(s.name), pivot: [-s.pivot[0], s.pivot[1], s.pivot[2]], axis: [s.axis[0], -s.axis[1], -s.axis[2]], gain: s.gain * (ANTISYM[s.ch] ? -1 : 1), mirrored: true };
      if (s.slide) m.slide = [-s.slide[0], s.slide[1], s.slide[2]];
      this.bi[m.name] = this.bones.length;
      map[i] = this.bones.length;
      this.bones.push(m);
    }
    const copy = (pos, bone, from, to, col) => {
      for (let t = from; t < to; t += 3) {
        for (const j of [0, 2, 1]) {
          const i = t + j;
          pos.push(-pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          bone.push(map[bone[i]] ?? bone[i]);
          if (col) col.push(col[i * 4], col[i * 4 + 1], col[i * 4 + 2], col[i * 4 + 3]);
        }
      }
    };
    copy(this.pos, this.bone, v0, v1);
    copy(this.opos, this.obone, o0, o1, this.ocol);
    for (let i = p0; i < p1; i++) {
      const p = this.patch[i];
      this.patch.push({ ...p, v: p.v + (v1 - v0), side: -(p.side || 1), mir: true });
    }
    for (const k in a0) {
      const arr = A[k], n = arr.length;
      for (let i = a0[k]; i < n; i++) arr.push([-arr[i][0], arr[i][1], arr[i][2]]);
    }
  }

  // ---------- фюзеляж / гондолы: лофт по сечениям вдоль Z ----------
  // o: { n (граней по кругу, чётное), flat (грань, а не ребро наверху), x (смещение оси), part,
  //      partOf(i, k, side, a, frame, z) -> часть для грани (i — номер участка между исходными сечениями, k — номер пояса
  //      от верха, a — 0 верх … 1 низ, frame — грань переплёта), frames: [z…] + fw — переплёты остекления,
  //      capA / capB: true | { inset, s, part, rim } — торцы (плоский или утопленный: воздухозаборник, сопло) }
  loft(secsIn, o = {}) {
    const n = o.n || 12, half = n / 2, flat = !!o.flat, x0 = o.x || 0;
    const src = secsIn.map(normSec);
    const hasPts = src.some((s) => s.pts);
    let rmax = 0;
    for (const s of src) rmax = Math.max(rmax, s.w, s.h, s.hb);
    // дробление обвода: крупные тела — до ~24–32 граней по кругу
    const m = hasPts ? 1 : (o.rs ?? Math.max(1, Math.min(3, Math.round((rmax > 1.2 ? 32 : rmax > 0.35 ? 22 : rmax > 0.12 ? 16 : 8) / n))));
    const N = n * m;
    // промежуточные сечения по монотонному сплайну: плавные носы, хвосты и обтекатели
    const smooth = o.smooth !== false && src.length > 2;
    const F = ['y', 'w', 'h', 'hb', 'x'];
    const zsA = src.map((s) => s.z), slope = {};
    if (smooth) for (const f of F) slope[f] = pchip(zsA, src.map((s) => s[f]));
    const orig = (z) => { let i = 0; while (i < src.length - 2 && z >= src[i + 1].z - 1e-9) i++; return i; };
    const mix = (z) => {
      const i = orig(z), a = src[i], b = src[i + 1], L = b.z - a.z, t = L > 1e-9 ? Math.min(1, Math.max(0, (z - a.z) / L)) : 0;
      const lin = (k) => a[k] + (b[k] - a[k]) * t;
      const her = (k) => {
        if (!smooth) return lin(k);
        const d = slope[k], t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * a[k] + (t3 - 2 * t2 + t) * L * d[i] + (-2 * t3 + 3 * t2) * b[k] + (t3 - t2) * L * d[i + 1];
      };
      const pts = a.pts && b.pts ? a.pts.map((p, j) => [p[0] + (b.pts[j][0] - p[0]) * t, p[1] + (b.pts[j][1] - p[1]) * t]) : null;
      return { z, y: her('y'), w: Math.max(0, her('w')), h: Math.max(0, her('h')), hb: Math.max(0, her('hb')), e: lin('e'), eb: lin('eb'), x: her('x'), rk: lin('rk'), pts };
    };
    const zs = src.map((q) => [q.z, 0, q]);
    const maxSeg = o.maxSeg ?? Math.max(1.6, rmax * 1.8);
    for (let i = 0; i < src.length - 1; i++) {
      const a = src[i], b = src[i + 1], L = b.z - a.z;
      if (L < 1e-6) continue;
      let k = Math.ceil(L / maxSeg) - 1;
      if (smooth) {
        let dev = 0;
        for (const f of ['y', 'w', 'h', 'hb']) dev = Math.max(dev, Math.abs(((slope[f][i] - slope[f][i + 1]) * L) / 8));
        const tol = Math.max(0.005, 0.012 * Math.max(a.w, a.h, a.hb, b.w, b.h, b.hb));
        k = Math.max(k, Math.min(3, Math.ceil(Math.sqrt(dev / tol)) - 1));
      }
      for (let j = 1; j <= k; j++) zs.push([a.z + (L * j) / (k + 1), 3]);
    }
    // переплёты: узкие пояса шириной fw вокруг заданных z
    const fw = o.fw ?? 0.07, strips = [];
    for (const z of o.frames || []) { zs.push([z - fw / 2, 1], [z + fw / 2, 2]); strips.push([z - fw / 2, z + fw / 2]); }
    zs.sort((a, b) => a[0] - b[0]);
    const secs = [], segI = [], segF = [];
    for (let i = 0; i < zs.length; i++) {
      const [z, kind, q] = zs[i];
      if ((kind === 0 || kind === 3) && i > 0 && i < zs.length - 1 && strips.some((s) => z > s[0] + 1e-6 && z < s[1] - 1e-6)) continue; // внутри переплёта
      if (kind === 3 && secs.length && Math.abs(secs[secs.length - 1].z - z) < 1e-4) continue;
      secs.push(kind === 0 ? q : mix(z));
      segI.push(orig(z + 1e-6));
      segF.push(kind === 1);
    }
    const rings = secs.map((s) => ringPts(s, n, flat, x0, m));
    const ctr = secs.map((s) => [x0 + s.x, s.pts ? (s.pts[0][1] + s.pts[half][1]) / 2 : s.y + (s.h - s.hb) / 2, s.z]);
    const part = o.part || this.curPart;
    const bandOf = (k) => {
      let th = (k + 0.5 + (flat ? 0.5 : 0)) / n;
      th -= Math.floor(th);
      const a = th > 0.5 ? 2 - 2 * th : 2 * th;
      return { a, kk: flat ? Math.round(a * half) : Math.min(half - 1, Math.floor(a * half)), side: th > 0.5 ? -1 : 1 };
    };
    const bands = [];
    for (let k = 0; k < n; k++) bands.push(bandOf(k));
    const lsg = o.sg ?? 0;
    for (let i = 0; i < secs.length - 1; i++) {
      const inside = lerp3(ctr[i], ctr[i + 1], 0.5);
      for (let K = 0; K < N; K++) {
        const K1 = (K + 1) % N, bd = bands[Math.floor(K / m)];
        let p = part;
        if (o.partOf) { const r = o.partOf(segI[i], bd.kk, bd.side, bd.a, segF[i], secs[i].z); if (r) p = r; }
        this.face([rings[i][K], rings[i][K1], rings[i + 1][K1], rings[i + 1][K]], inside, { part: p, k: bd.kk, a: bd.a, i, side: bd.side, sg: lsg, ...(o.meta || null) });
      }
    }
    const cap = (ri, dz, spec) => {
      if (!spec) return;
      const ring = rings[ri], c = ctr[ri];
      if (spec === true || !spec.inset) {
        this.face(ring, [c[0], c[1], c[2] - dz], { part: (spec && spec.part) || part, cap: 1, sg: this.sg() });
        return;
      }
      const s = spec.s ?? 0.8, d = spec.inset;
      const inner = ring.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s, p[2] - dz * d]);
      const rsg = this.sg();
      for (let k = 0; k < N; k++) {
        const k1 = (k + 1) % N;
        const q = [ring[k], ring[k1], inner[k1], inner[k]];
        const mm = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2, q[0][2]];
        this.face(q, [c[0] + (mm[0] - c[0]) * 3, c[1] + (mm[1] - c[1]) * 3, mm[2] - dz * d], { part: spec.rim || spec.part || part, cap: 1, sg: rsg, sa: 70 });
      }
      const ip = spec.part || part;
      this.face(inner, [c[0], c[1], c[2] - dz * (d + 1)], { part: ip, cap: 1, sg: this.sg() });
      // глубина: обтекатель турбины в сопле, кок компрессора в воздухозаборнике
      if (ip === 'nozzleIn' || ip === 'intake') {
        let r = 0;
        for (const p of inner) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1]));
        const ic = [c[0], c[1], inner[0][2]], nz = ip === 'nozzleIn';
        const tip = [ic[0], ic[1], ic[2] + dz * (nz ? Math.min(d * 0.7, r * 0.9) : Math.min(d * 0.5, r * 0.6))];
        this.withPart(nz ? 'cone' : 'fan', () => this.cyl(lerp3(ic, tip, -0.02), tip, r * (nz ? 0.42 : 0.34), 0.0, 8, { capB: false, capPart: nz ? 'nozzleIn' : 'intake' }));
      }
    };
    cap(0, -1, o.capA);
    cap(secs.length - 1, 1, o.capB);

    // точка на поверхности: z, a (0 верх … 1 низ), side (+1 правый борт, −1 левый) -> { p, n, t (вдоль −Z… +Z), b («вверх» по борту) }
    const at = (z, a, side = 1) => {
      let i = 0;
      while (i < secs.length - 2 && z > secs[i + 1].z) i++;
      const t = Math.min(1, Math.max(0, (z - secs[i].z) / ((secs[i + 1].z - secs[i].z) || 1)));
      const kf = (a * half - (flat ? 0.5 : 0)) * m;
      const k0 = Math.floor(Math.min(kf, (half - (flat ? 0.5 : 0)) * m - 1e-6)), f = kf - k0;
      const idx = (k) => ((k % N) + N) % N;
      const q = (r, k) => rings[r][idx(k)];
      const A0 = q(i, k0), A1 = q(i, k0 + 1), B0 = q(i + 1, k0), B1 = q(i + 1, k0 + 1);
      const pa = lerp3(A0, A1, f), pb = lerp3(B0, B1, f);
      const p = lerp3(pa, pb, t);
      let tz = norm(sub(pb, pa));
      let bb = norm(sub(lerp3(A0, B0, t), lerp3(A1, B1, t)));
      let nn = norm(cross(bb, tz));
      const c = lerp3(ctr[i], ctr[i + 1], t);
      if (nn[0] * (p[0] - c[0]) + nn[1] * (p[1] - c[1]) < 0) nn = mul(nn, -1);
      if (side < 0) {
        const xm = 2 * x0;
        return { p: [xm - p[0], p[1], p[2]], n: [-nn[0], nn[1], nn[2]], t: [-tz[0], tz[1], tz[2]], b: [-bb[0], bb[1], bb[2]] };
      }
      return { p, n: nn, t: tz, b: bb };
    };
    return { rings, secs, ctr, n, at };
  }

  // плоская «наклейка» на поверхности: s = { p, n, t, b } из at(); shape: 'rect' | 'diamond' | 'oct' | 'tri'
  decal(s, w, h, part, shape = 'rect', eps = 0.02, meta) {
    const c = add(s.p, mul(s.n, eps));
    const T = mul(s.t, w / 2), B = mul(s.b, h / 2);
    let pts;
    if (shape === 'diamond') pts = [add(c, T), add(c, B), sub(c, T), sub(c, B)];
    else if (shape === 'tri') pts = [add(c, T), add(sub(c, T), B), sub(sub(c, T), B)];
    else if (shape === 'oct') {
      pts = [];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(add(c, add(mul(T, Math.cos(a)), mul(B, Math.sin(a))))); }
    } else pts = [add(add(c, T), B), add(sub(c, T), B), sub(sub(c, T), B), sub(add(c, T), B)];
    this.face(pts, sub(c, s.n), { part, decal: 1, ...meta });
  }

  // ряд иллюминаторов на лофте: { z0, z1, count, a, w, h, sides: [1,-1], part, shape, skip(i) }
  windows(lf, o) {
    const sides = o.sides || [1, -1];
    for (let i = 0; i < o.count; i++) {
      if (o.skip && o.skip(i)) continue;
      const z = o.count === 1 ? o.z0 : o.z0 + ((o.z1 - o.z0) * i) / (o.count - 1);
      for (const sd of sides) {
        const at = lf.at(z, o.a, sd), e = o.eps || 0.025;
        if (o.rim !== false) this.decal(at, o.w + 0.07, o.h + 0.07, o.rimPart || 'winRim', o.shape || 'rect', e - 0.009);
        this.decal(at, o.w, o.h, o.part || 'window', o.shape || 'rect', e);
      }
    }
  }

  // ---------- крыло / оперение / пилон ----------
  // o: { root: [x, y, z0], dih (рад: 0 — вправо, π/2 — вверх (киль), −π/2 — вниз), part, tr (отн. толщина), sym (симметричный профиль),
  //      st: [[s, zLE, chord, yOff?, tr?]…] — станции по размаху (s — вдоль размаха от root),
  //      ctl: [{ name, ch, s0, s1, f (доля хорды), max, slide, … }] — рули/закрылки (кости создаются сами),
  //      bone: { name, ch, max, pu } — цельноповоротная поверхность, round (скругление законцовки, м), sub (макс. шаг панелей, м),
  //      capRoot, tipAnchor, meta }
  wing(o) {
    const dih = o.dih || 0, d = [Math.cos(dih), Math.sin(dih), 0], nr = [-Math.sin(dih), Math.cos(dih), 0];
    const root = o.root.length === 2 ? [o.root[0], o.root[1], 0] : o.root;
    const part = o.part || 'wing', sym = !!o.sym, tr0 = o.tr ?? 0.1;
    const vT = sym ? 0.5 : 0.6, vB = sym ? -0.5 : -0.4, vT1 = sym ? 0.3 : 0.33, vB1 = sym ? -0.3 : -0.27;
    const st = o.st.map((a) => ({ s: a[0], z: a[1], c: a[2], y: a[3] || 0, tr: a[4] ?? tr0 }));
    if (o.round) {
      const l = st[st.length - 1], r = o.round;
      st.push({ s: l.s + r, z: l.z + l.c * 0.22, c: l.c * 0.56, y: l.y, tr: l.tr * 0.55 });
    }
    const sMax = st[st.length - 1].s, sMin = st[0].s;
    const evalSt = (s) => {
      let i = 0;
      while (i < st.length - 2 && s > st[i + 1].s) i++;
      const a = st[i], b = st[i + 1], t = Math.min(1, Math.max(0, (s - a.s) / ((b.s - a.s) || 1)));
      return { s, z: a.z + (b.z - a.z) * t, c: a.c + (b.c - a.c) * t, y: a.y + (b.y - a.y) * t, tr: a.tr + (b.tr - a.tr) * t };
    };
    const P = (S, u, v) => {
      const off = S.y + v * S.tr * S.c;
      return [root[0] + d[0] * S.s + nr[0] * off, root[1] + d[1] * S.s + nr[1] * off, root[2] + S.z + u * S.c];
    };
    const ctl = (o.ctl || []).map((c) => ({ f: 0.28, max: 0.5, ...c }));
    for (const c of ctl) {
      const uh = 1 - c.f, A = evalSt(c.s0), B = evalSt(c.s1), vm = ((vT + vB) * (1 - uh)) / 0.7 / 2;
      const h0 = P(A, uh, vm), h1 = P(B, uh, vm);
      const { s0, s1, f, name, ...rest } = c;
      c.bone = this.addBone(name, { pivot: lerp3(h0, h1, 0.5), axis: sub(h1, h0), ...rest });
    }
    let wb = 0;
    if (o.bone) {
      const S = st[0], pu = o.bone.pu ?? 0.45;
      const { name, pu: _pu, ...rest } = o.bone;
      wb = this.addBone(name, { pivot: P(S, pu, 0), axis: d, ...rest });
    }
    // точки разбиения по размаху
    let bp = st.map((s) => s.s);
    for (const c of ctl) bp.push(c.s0, c.s1);
    bp = [...new Set(bp.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
    if (o.sub) {
      const out = [bp[0]];
      for (let i = 1; i < bp.length; i++) {
        const a = bp[i - 1], b = bp[i], m = Math.ceil((b - a) / o.sub - 1e-6);
        for (let j = 1; j <= m; j++) out.push(a + ((b - a) * j) / m);
      }
      bp = out;
    }
    // профиль: 10 точек (скруглённый носок: у толстых крыльев сглаживается, у тонких остаётся острым)
    const vT0 = vT * 0.3, vB0 = vB * 0.3;
    const loop = (S, uh) => {
      const k = (1 - uh) / 0.7;
      return [P(S, 0, 0), P(S, 0.012, vT0), P(S, 0.06, vT1), P(S, 0.3, vT), P(S, uh, vT * k), P(S, 1, 0), P(S, uh, vB * k), P(S, 0.3, vB), P(S, 0.06, vB1), P(S, 0.012, vB0)];
    };
    const wsg = o.sg ?? this.sg(), csg = this.sg();
    const build = () => {
      for (let i = 0; i < bp.length - 1; i++) {
        const sa = bp[i], sb = bp[i + 1], sm = (sa + sb) / 2;
        const c = ctl.find((q) => sm > q.s0 && sm < q.s1);
        const uh = c ? 1 - c.f : 1 - (o.f ?? 0.28);
        const A = evalSt(sa), B = evalSt(sb), LA = loop(A, uh), LB = loop(B, uh);
        const inside = lerp3(P(A, 0.4, (vT + vB) / 2), P(B, 0.4, (vT + vB) / 2), 0.5);
        const uc = [0.006, 0.036, 0.18, (0.3 + uh) / 2, (uh + 1) / 2, (1 + uh) / 2, (uh + 0.3) / 2, 0.18, 0.036, 0.006];
        const sp = (sm - sMin) / ((sMax - sMin) || 1);
        const m = (j, extra) => ({ part, sp, ch: uc[j], top: j < 5, wing: 1, sg: wsg, sa: 89, ...(o.meta || null), ...extra });
        const q = (j, j1, extra) => this.face([LA[j], LA[j1], LB[j1], LB[j]], inside, m(j, extra));
        const hard = () => ({ sg: this.sg() });
        if (!c) {
          for (let j = 0; j < 10; j++) q(j, (j + 1) % 10);
        } else {
          q(0, 1); q(1, 2); q(2, 3); q(3, 4); q(6, 7); q(7, 8); q(8, 9); q(9, 0);
          this.face([LA[4], LA[6], LB[6], LB[4]], inside, m(4, { part: 'dark', ...hard() }));
          const ci = lerp3(lerp3(LA[4], LA[6], 0.5), lerp3(LB[4], LB[6], 0.5), 0.5);
          const cin = lerp3(ci, lerp3(LA[5], LB[5], 0.5), 0.3);
          this.withBone(c.bone, () => {
            this.face([LA[4], LA[5], LB[5], LB[4]], cin, m(4, { ctl: c.ch, sg: csg }));
            this.face([LA[5], LA[6], LB[6], LB[5]], cin, m(5, { ctl: c.ch, sg: csg }));
            this.face([LA[4], LA[5], LA[6]], cin, m(4, { ctl: c.ch, ...hard() }));
            this.face([LB[4], LB[5], LB[6]], cin, m(4, { ctl: c.ch, ...hard() }));
          });
        }
        // торцы неподвижной части рядом с рулём
        const prev = i > 0 ? ctl.find((q2) => (bp[i - 1] + sa) / 2 > q2.s0 && (bp[i - 1] + sa) / 2 < q2.s1) : null;
        const next = i < bp.length - 2 ? ctl.find((q2) => (bp[i + 2] + sb) / 2 > q2.s0 && (bp[i + 2] + sb) / 2 < q2.s1) : null;
        if (!c && prev) this.face([LA[4], LA[5], LA[6]], inside, m(4, { part: 'dark', ...hard() }));
        if (!c && next) this.face([LB[4], LB[5], LB[6]], inside, m(4, { part: 'dark', ...hard() }));
        if (i === 0 && o.capRoot) this.face(LA, inside, m(2, hard()));
        if (i === bp.length - 2 && o.capTip !== false) this.face(LB, inside, m(2, { tip: 1, ...hard() }));
      }
    };
    if (wb) this.withBone(wb, build); else build();
    const tipS = evalSt(sMax);
    if (o.tipAnchor) this.anchors.wingtips.push(P(tipS, 0.5, 0));
    // точка на поверхности крыла: s, u (доля хорды), top
    const vAt = (u, top) => {
      const pk = top ? [[0, 0], [0.012, vT0], [0.06, vT1], [0.3, vT], [1, 0]] : [[0, 0], [0.012, vB0], [0.06, vB1], [0.3, vB], [1, 0]];
      for (let i = 0; i < 4; i++) if (u <= pk[i + 1][0]) return pk[i][1] + ((pk[i + 1][1] - pk[i][1]) * (u - pk[i][0])) / (pk[i + 1][0] - pk[i][0]);
      return 0;
    };
    const at = (s, u, top = true) => {
      const S = evalSt(s), S2 = evalSt(s + 0.05 <= sMax ? s + 0.05 : s - 0.05);
      const p = P(S, u, vAt(u, top));
      const tc = norm(sub(P(S, u + 0.02, vAt(u + 0.02, top)), p));
      let ts = norm(sub(P(S2, u, vAt(u, top)), p));
      if (s + 0.05 > sMax) ts = mul(ts, -1);
      let n = norm(cross(tc, ts));
      const sign = top ? 1 : -1;
      if (n[0] * nr[0] * sign + n[1] * nr[1] * sign < 0) n = mul(n, -1);
      return { p, n, t: tc, b: ts };
    };
    return { st, P, evalSt, at, d, nr, root, sMax };
  }

  // ---------- примитивы ----------
  // усечённый конус/цилиндр между произвольными точками
  cyl(p0, p1, r0, r1 = r0, n = 6, o = {}) {
    const ax = norm(sub(p1, p0));
    let u = cross(ax, Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
    u = norm(u);
    const v = cross(ax, u);
    const ring = (c, r) => {
      const out = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + (o.rot || 0); out.push(add(c, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)))); }
      return out;
    };
    const A = ring(p0, r0), B = ring(p1, r1), mid = lerp3(p0, p1, 0.5);
    const meta = o.meta || null, csg = this.sg();
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; this.face([A[k], A[k1], B[k1], B[k]], mid, { part: o.part || this.curPart, sg: csg, sa: o.sa ?? 100, ...meta }); }
    if (o.capA !== false && r0 > 1e-4) this.face(A, mid, { part: o.capPart || o.part || this.curPart, sg: this.sg(), ...meta });
    if (o.capB !== false && r1 > 1e-4) this.face(B, mid, { part: o.capPart || o.part || this.curPart, sg: this.sg(), ...meta });
  }

  // балка прямоугольного сечения: полуразмеры a (поперёк, в плоскости с hint) и b
  beam(p0, p1, a, b, o = {}) {
    const ax = norm(sub(p1, p0));
    const hint = o.hint || [0, 0, 1];
    let u = cross(ax, hint);
    if (len(u) < 1e-3) u = cross(ax, [1, 0, 0]);
    u = norm(u);
    const v = norm(cross(ax, u)); // v лежит в плоскости (ax, hint)
    const ring = (c, k) => [add(c, add(mul(u, a * k), mul(v, b * k))), add(c, add(mul(u, -a * k), mul(v, b * k))), add(c, add(mul(u, -a * k), mul(v, -b * k))), add(c, add(mul(u, a * k), mul(v, -b * k)))];
    const A = ring(p0, 1), B = ring(p1, o.taper ?? 1), mid = lerp3(p0, p1, 0.5);
    const meta = { part: o.part || this.curPart, sa: 20, ...(o.meta || null) };
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; this.face([A[k], A[k1], B[k1], B[k]], mid, meta); }
    this.face(A, mid, meta);
    this.face(B, mid, meta);
  }

  box(mn, mx, part) {
    const c = lerp3(mn, mx, 0.5), m = { part: part || this.curPart, sa: 20 };
    const p = (i, j, k) => [i ? mx[0] : mn[0], j ? mx[1] : mn[1], k ? mx[2] : mn[2]];
    this.face([p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0)], c, m);
    this.face([p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)], c, m);
    this.face([p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)], c, m);
    this.face([p(1, 0, 0), p(1, 0, 1), p(1, 1, 1), p(1, 1, 0)], c, m);
    this.face([p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], c, m);
    this.face([p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1)], c, m);
  }

  // колесо (ось вдоль X)
  wheel(c, r, w, n = 10, simple = false) {
    const ring = (x, rr) => { const out = []; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; out.push([x, c[1] + Math.cos(a) * rr, c[2] + Math.sin(a) * rr]); } return out; };
    const xs = simple ? [-w / 2, w / 2] : [-w / 2, -w * 0.28, w * 0.28, w / 2];
    const rs = simple ? [r, r] : [r * 0.84, r, r, r * 0.84];
    const R = xs.map((x, i) => ring(c[0] + x, rs[i]));
    const tsg = this.sg();
    for (let i = 0; i < R.length - 1; i++) for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; this.face([R[i][k], R[i][k1], R[i + 1][k1], R[i + 1][k]], c, { part: 'tire', sg: tsg }); }
    for (const sgn of [-1, 1]) {
      const x = c[0] + (sgn * w) / 2, edge = sgn < 0 ? R[0] : R[R.length - 1];
      this.face(edge, c, { part: 'tire', sg: this.sg() });
      // колёсный диск: выпуклая ступица с тёмным центром
      const hr = ring(x + sgn * 0.012, r * 0.56), hc = [x + sgn * (0.012 + r * 0.1), c[1], c[2]], hsg = this.sg();
      for (let k = 0; k < n; k++) this.face([hr[k], hr[(k + 1) % n], hc], c, { part: 'hub', sg: hsg, sa: 80 });
    }
  }

  // стойка шасси.
  // o: { name (кость; null — неубирающееся), pivot [x,y,z], axle [x,z] (центр оси; низ колёс на y = 0), r, w,
  //      wheels: [[dx, dz]…] (смещения колёс от центра оси; по умолчанию одно), side (±1: одиночное колесо сбоку от стойки,
  //      0 — в вилке), axis, max (угол уборки, рад), t0, t1, strut (радиус), simple, nose (носовая стойка),
  //      door: 'front' | 'side' (щиток на стойке) | {pts…}, doorDir, doorPart, brace: [x,y,z] (подкос к точке на корпусе), noHide }
  gear(o) {
    const r = o.r, ax = [o.axle[0], r, o.axle[1]];
    const wheels = o.wheels || [[0, 0]];
    const sr = o.strut || Math.max(0.035, r * 0.16);
    const single = wheels.length === 1, side = o.side || 0;
    let bone = 0;
    if (o.name) bone = this.addBone(o.name, { pivot: o.pivot, axis: o.axis || [1, 0, 0], ch: 'gear', max: o.max ?? 1.5, hide: !o.noHide, t0: o.t0 ?? 0, t1: o.t1 ?? 1 });
    const off = single && side ? side * (o.w * 0.5 + sr * 1.2) : 0;
    this.withBone(bone, () => {
      const top = o.pivot;
      let foot = ax;
      if (single && !side) {
        // вилка: стойка кончается над колесом
        const t = Math.min(0.95, Math.max(0.3, (top[1] - r * 2.2) / ((top[1] - r) || 1)));
        foot = lerp3(top, ax, t);
        const hw = o.w * 0.5 + sr;
        for (const sg of [-1, 1]) this.cyl([foot[0] + sg * hw, foot[1], foot[2]], [ax[0] + sg * hw, ax[1], ax[2]], sr * 0.7, sr * 0.7, 4, { part: 'strut' });
        this.cyl([foot[0] - hw, foot[1], foot[2]], [foot[0] + hw, foot[1], foot[2]], sr * 0.9, sr * 0.9, 4, { part: 'strut' });
      }
      const mid = lerp3(top, foot, 0.55);
      this.cyl(top, mid, sr * 1.25, sr * 1.25, 6, { part: 'strut' });
      this.cyl(mid, foot, sr * 0.8, sr * 0.8, 5, { part: 'oleo', capA: false });
      let minDx = 0, maxDx = 0, minDz = 0, maxDz = 0;
      for (const [dx, dz] of wheels) { minDx = Math.min(minDx, dx); maxDx = Math.max(maxDx, dx); minDz = Math.min(minDz, dz); maxDz = Math.max(maxDz, dz); }
      if (maxDz - minDz > 1e-3) this.beam([ax[0], ax[1], ax[2] + minDz], [ax[0], ax[1], ax[2] + maxDz], sr * 1.1, sr * 1.3, { part: 'strut', hint: [0, 1, 0] });
      if (maxDx - minDx > 1e-3) for (const dz of [...new Set(wheels.map((w) => w[1]))]) this.cyl([ax[0] + minDx, ax[1], ax[2] + dz], [ax[0] + maxDx, ax[1], ax[2] + dz], sr * 0.7, sr * 0.7, 5, { part: 'strut' });
      if (off) this.cyl(ax, [ax[0] + off, ax[1], ax[2]], sr * 0.7, sr * 0.7, 5, { part: 'strut' });
      for (const [dx, dz] of wheels) this.wheel([ax[0] + dx + off, r, ax[2] + dz], r, o.w, o.simple ? 8 : 10, !!o.simple);
      if (o.brace) this.cyl(lerp3(top, foot, 0.5), o.brace, sr * 0.6, sr * 0.6, 4, { part: 'strut' });
      if (o.door === 'front' || o.door === 'side') {
        // щиток-створка на стойке: 'front' — перед стойкой (носовая), 'side' — с внешней стороны (основная)
        const a = lerp3(top, foot, 0.04), e = lerp3(top, foot, 0.62), off = sr * 1.7;
        if (o.door === 'front') {
          const hw = Math.max(o.w * 0.75, sr * 2.2), dz = o.doorDir ?? -1;
          this.door({ pts: [[a[0] - hw, a[1], a[2] + dz * off], [a[0] + hw, a[1], a[2] + dz * off], [e[0] + hw * 0.8, e[1], e[2] + dz * off], [e[0] - hw * 0.8, e[1], e[2] + dz * off]], th: 0.03, part: o.doorPart || 'fus', inner: 'dark', out: [0, 0, dz], meta: { a: 0.9 } });
        } else {
          const hw = r * 0.62, dx = (o.doorDir ?? (side || 1)) * off;
          this.door({ pts: [[a[0] + dx, a[1], a[2] - hw], [a[0] + dx, a[1], a[2] + hw], [e[0] + dx, e[1], e[2] + hw * 0.85], [e[0] + dx, e[1], e[2] - hw * 0.85]], th: 0.03, part: o.doorPart || 'fus', inner: 'dark', out: [dx, 0, 0], meta: { a: 0.9 } });
        }
      } else if (o.door) for (const d of [].concat(o.door)) this.door(d);
    });
    const contact = [ax[0] + off, 0, ax[2]];
    if (o.nose) this.anchors.gearNose = contact; else this.anchors.gearMain.push(contact);
    return bone;
  }

  // тонкая пластина по контуру (створка, щиток): pts — контур, th — толщина, out — куда смотрит наружная сторона
  // (внутренняя красится в 'dark' / o.inner)
  door(o) {
    const pts = o.pts, th = o.th ?? 0.03;
    let n = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
    n = norm(n);
    if (o.out && n[0] * o.out[0] + n[1] * o.out[1] + n[2] * o.out[2] < 0) n = mul(n, -1);
    const A = pts.map((p) => add(p, mul(n, th / 2))), B = pts.map((p) => sub(p, mul(n, th / 2)));
    const c = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length);
    const m = { part: o.part || 'fus', sa: 20, ...(o.meta || null) };
    this.face(A, c, m);
    this.face(B, c, { ...m, part: o.inner || 'dark' });
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; this.face([A[i], A[j], B[j], B[i]], c, { ...m, sg: this.sg() }); }
  }

  // воздушный винт: { c, r, blades, chord, name, pitch, tip (жёлтые законцовки), dir }
  prop(o) {
    const c = o.c, r = o.r, nb = o.blades || 2, ch = o.chord || r * 0.13, pitch = o.pitch ?? 0.55;
    const i = this.anchors.props.length;
    const bone = this.addBone(o.name || 'prop' + i, { pivot: c, axis: [0, 0, -1], ch: 'prop', gain: o.dir || 1 });
    this.withBone(bone, () => {
      for (let b = 0; b < nb; b++) {
        const ph = (b / nb) * Math.PI * 2 + (o.phase || 0);
        const e = [Math.cos(ph), Math.sin(ph), 0], t = [-Math.sin(ph), Math.cos(ph), 0];
        const cd = norm([t[0] * Math.cos(pitch), t[1] * Math.cos(pitch), -Math.sin(pitch)]);
        const nrm = norm(cross(e, cd));
        const prof = [[0.1, 0.45], [0.4, 1], [0.75, 0.85], [0.9, 0.6], [1, 0.3]];
        const edge = (k, sg) => add(add(c, mul(e, prof[k][0] * r)), mul(cd, (sg * prof[k][1] * ch) / 2));
        const seg = (k0, k1, part) => {
          const q = [edge(k0, 1), edge(k1, 1), edge(k1, -1), edge(k0, -1)];
          const m = lerp3(q[0], q[2], 0.5);
          this.face(q.map((p) => add(p, mul(nrm, 0.015))), sub(m, nrm), { part });
          this.face(q.map((p) => sub(p, mul(nrm, 0.015))), add(m, nrm), { part });
        };
        seg(0, 1, 'prop'); seg(1, 2, 'prop'); seg(2, 3, 'prop'); seg(3, 4, o.tip === false ? 'prop' : 'propTip');
      }
    });
    // размытый диск
    const disc = this.addBone('disc' + i, { pivot: c, axis: [0, 0, -1], ch: 'disc' });
    const prev = this.curBone;
    this.curBone = disc;
    const N = 20, R = [0.12 * r, 0.5 * r, 0.88 * r, 0.95 * r, r];
    const g1 = pm(0.1, 0.1, 0.11, 0.1), g2 = pm(0.1, 0.1, 0.11, 0.24), g3 = pm(0.1, 0.1, 0.11, 0.2), y1 = pm(0.92, 0.74, 0.12, 0.3), y0 = pm(0.92, 0.74, 0.12, 0.04);
    const col = o.tip === false ? [g1, g2, g3, g3, pm(0.1, 0.1, 0.11, 0.03)] : [g1, g2, g3, y1, y0];
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      const pt = (a, rr) => [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2]];
      for (let j = 0; j < 4; j++) {
        this.otri(pt(a0, R[j]), pt(a1, R[j]), pt(a1, R[j + 1]), col[j], col[j], col[j + 1]);
        this.otri(pt(a0, R[j]), pt(a1, R[j + 1]), pt(a0, R[j + 1]), col[j], col[j + 1], col[j + 1]);
      }
    }
    this.curBone = prev;
    this.anchors.props.push(c);
    return bone;
  }

  // ---------- оверлей ----------
  otri(a, b, c, ca, cb, cc) {
    this.opos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.obone.push(this.curBone, this.curBone, this.curBone);
    this.ocol.push(ca[0], ca[1], ca[2], ca[3] ?? 0, cb[0], cb[1], cb[2], cb[3] ?? 0, cc[0], cc[1], cc[2], cc[3] ?? 0);
  }

  // светящаяся «звёздочка» (три скрещённых ромба, аддитивно). def — параметры кости: { ch: 'nav'|'beacon'|'strobe'|'land', … }
  light(name, c, r, rgb, def = {}) {
    const bone = this.addBone(name, { pivot: c, ch: 'nav', ...def });
    const prev = this.curBone;
    this.curBone = bone;
    const z = [0, 0, 0, 0], ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const core = [rgb[0], rgb[1], rgb[2], 0];
    for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
      const A = mul(ax[i], r), B = mul(ax[j], r);
      const q = [add(c, A), add(c, B), sub(c, A), sub(c, B)];
      for (let k = 0; k < 4; k++) this.otri(c, q[k], q[(k + 1) % 4], core, z, z);
    }
    // яркое ядро
    const r2 = r * 0.28, hot = [Math.min(1, rgb[0] + 0.5), Math.min(1, rgb[1] + 0.5), Math.min(1, rgb[2] + 0.5), 0];
    for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
      const A = mul(ax[i], r2), B = mul(ax[j], r2);
      const q = [add(c, A), add(c, B), sub(c, A), sub(c, B)];
      for (let k = 0; k < 4; k++) this.otri(c, q[k], q[(k + 1) % 4], hot, z, z);
    }
    this.curBone = prev;
    return bone;
  }

  // луч посадочной фары (конус вперёд-вниз), виден ночью
  beamCone(name, c, dir, length, r1, rgb = [0.5, 0.48, 0.38]) {
    const bone = this.addBone(name, { pivot: c, ch: 'beam' });
    const prev = this.curBone;
    this.curBone = bone;
    const ax = norm(dir);
    let u = norm(cross(ax, [0, 1, 0]));
    const v = cross(ax, u), N = 6, end = add(c, mul(ax, length));
    const c0 = [rgb[0] * 0.035, rgb[1] * 0.035, rgb[2] * 0.035, 0], z = [0, 0, 0, 0];
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      const p0 = add(end, add(mul(u, Math.cos(a0) * r1), mul(v, Math.sin(a0) * r1)));
      const p1 = add(end, add(mul(u, Math.cos(a1) * r1), mul(v, Math.sin(a1) * r1)));
      this.otri(c, p0, p1, c0, z, z);
    }
    this.curBone = prev;
  }

  // сопло: свечение и факел форсажа. { c: центр среза, r, ab: длина факела (0 — без форсажа) }
  nozzleGlow(c, r, ab = 0) {
    const i = this.anchors.engines.length;
    const bone = this.addBone('glow' + i, { pivot: c, ch: 'glow', ab: ab > 0 });
    const prev = this.curBone;
    this.curBone = bone;
    const N = 8, z = [0, 0, 0, 0];
    const pt = (a, rr, dz) => [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2] + dz];
    const hot = ab > 0 ? [1, 0.55, 0.2, 0] : [0.85, 0.35, 0.1, 0];
    const rim = ab > 0 ? [0.6, 0.2, 0.05, 0] : [0.25, 0.07, 0.02, 0];
    const cc = [c[0], c[1], c[2] - 0.05];
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      this.otri(cc, pt(a0, r * 0.82, -0.05), pt(a1, r * 0.82, -0.05), hot, rim, rim);
    }
    if (ab > 0) {
      this.curBone = this.addBone('flame' + i, { pivot: c, ch: 'flame' });
      const tip = [c[0], c[1], c[2] + ab], tip2 = [c[0], c[1], c[2] + ab * 0.45];
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
        this.otri(pt(a0, r * 0.8, 0), pt(a1, r * 0.8, 0), tip, [0.42, 0.13, 0.03, 0], [0.42, 0.13, 0.03, 0], z);
        this.otri(pt(a0, r * 0.5, 0), pt(a1, r * 0.5, 0), tip2, [0.3, 0.32, 0.6, 0], [0.3, 0.32, 0.6, 0], [0.22, 0.09, 0.03, 0]);
      }
    }
    this.curBone = prev;
    this.anchors.engines.push(c);
    return bone;
  }

  // фонарь кабины: лофт из «стекла» с переплётами. frames — z переплётов (вставляются узкие пояса 'frame'),
  // fw — ширина переплёта, sill — с какого a (0 верх … 1 низ) идёт непрозрачный борт
  canopy(secsIn, o = {}) {
    const sill = o.sill ?? 0.5, top = o.top ?? -1;
    return this.loft(secsIn, {
      n: o.n || 10, flat: o.flat, part: 'glass', capA: o.capA, capB: o.capB, frames: o.frames, fw: o.fw,
      partOf: (i, k, side, a, fr, z) => (fr || a > sill || a < top || (o.solid && o.solid(i, a, z)) ? (o.framePart || 'frame') : null),
    });
  }

  // стандартный набор огней. o: { tip: [x,y,z] правой законцовки, tail: [x,y,z], top: [x,y,z] | null, bottom: [x,y,z] | null,
  //   land: [[x,y,z]…], strobe (bool), scale }
  lights(o) {
    const k = o.scale || 1;
    if (o.tip) {
      this.light('navR', o.tip, 0.5 * k, [0.1, 1, 0.3], { ch: 'nav' });
      this.light('navL', [-o.tip[0], o.tip[1], o.tip[2]], 0.5 * k, [1, 0.08, 0.06], { ch: 'nav' });
      if (o.strobe) {
        this.light('stbR', o.tip, 0.9 * k, [1, 1, 1], { ch: 'strobe', phase: 0 });
        this.light('stbL', [-o.tip[0], o.tip[1], o.tip[2]], 0.9 * k, [1, 1, 1], { ch: 'strobe', phase: 0 });
      }
    }
    if (o.tail) this.light('navT', o.tail, 0.45 * k, [0.9, 0.9, 0.85], { ch: 'nav' });
    if (o.top) this.light('bcnT', o.top, 0.75 * k, [1, 0.1, 0.05], { ch: 'beacon', phase: 0 });
    if (o.bottom) this.light('bcnB', o.bottom, 0.75 * k, [1, 0.1, 0.05], { ch: 'beacon', phase: 0.5 });
    (o.land || []).forEach((p, i) => {
      this.light('land' + i, p, 1.0 * k, [1, 0.96, 0.8], { ch: 'land' });
      this.beamCone('beam' + i, p, o.landDir || [0, -0.12, -1], 45 * k, 5 * k);
    });
  }

  // опознавательный знак: ромб в ромбе (цвета задаёт ливрея: emblemA — кайма, emblemB — середина)
  emblem(s, size) {
    s = { p: s.p, n: s.n, t: s.t, b: norm(cross(s.n, s.t)) };
    this.decal(s, size, size, 'emblemA', 'diamond', 0.02);
    this.decal(s, size * 0.56, size * 0.56, 'emblemB', 'diamond', 0.035);
  }

  // подкрыльевой пилон + точка подвески. w — результат wing(), s — по размаху, u — доля хорды начала, len, depth
  pylon(w, s, u = 0.3, len = 1.2, depth = 0.22, hard = true) {
    const p = w.at(s, u, false).p;
    this.wing({ part: 'pylon', root: [p[0], p[1] + 0.04, 0], dih: -Math.PI / 2, sym: true, tr: 0.08, f: 0.3, st: [[0, p[2], len], [depth, p[2] + len * 0.1, len * 0.82]] });
    if (hard) this.anchors.hardpoints.push([p[0], p[1] - depth - 0.02, p[2] + len * 0.5]);
  }

  // интерцептор (тормозной щиток на верхней поверхности крыла): w — результат wing(), s0..s1 по размаху, u0..u1 по хорде
  spoiler(w, name, s0, s1, u0 = 0.6, u1 = 0.72, max = -0.85) {
    const A = w.at(s0, u0, true).p, B = w.at(s1, u0, true).p, C = w.at(s1, u1, true).p, E = w.at(s0, u1, true).p;
    const bone = this.addBone(name, { pivot: A, axis: sub(B, A), ch: 'spoil', max });
    this.withBone(bone, () => this.door({ pts: [A, B, C, E].map((p) => [p[0], p[1] + 0.035, p[2]]), th: 0.045, part: 'wing', inner: 'dark', out: [0, 1, 0], meta: { wing: 1, top: true, sp: 0.5, ch: 0.66 } }));
  }

  // тормозной парашют: купол на стропах за хвостом. at — точка крепления, R — радиус купола, len — длина строп
  dragChute(at, R, len = 9) {
    const bone = this.addBone('chute', { pivot: at, axis: [1, 0, 0], ch: 'chute' });
    const prev = this.curBone;
    this.curBone = bone;
    const cy = Math.max(at[1], R + 0.35), c = [at[0], cy, at[2] + len], N = 8;
    const rim = [], mid = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      rim.push([c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, c[2]]);
      mid.push([c[0] + Math.cos(a) * R * 0.62, c[1] + Math.sin(a) * R * 0.62, c[2] + R * 0.5]);
    }
    const apex = [c[0], c[1], c[2] + R * 0.62], inside = [c[0], c[1], c[2] - 0.2];
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N, part = k % 2 ? 'chuteA' : 'chuteB';
      this.face([rim[k], rim[k1], mid[k1], mid[k]], inside, { part });
      this.face([mid[k], mid[k1], apex], inside, { part });
      // изнанка купола видна спереди
      this.face([rim[k], rim[k1], mid[k1], mid[k]], [c[0], c[1], c[2] + R * 3], { part: 'chuteIn' });
      this.cyl(at, rim[k], 0.012, 0.012, 3, { part: 'wire', capA: false, capB: false });
    }
    this.curBone = prev;
  }

  // ---------- гладкие нормали ----------
  // Вершины с общим положением, костью и группой сглаживания усредняют нормали граней, отличающихся не больше
  // чем на угол сглаживания (sa грани; по умолчанию 50°, крыло — 89°: скруглённый носок, острая задняя кромка).
  // «Наклейки» (иллюминаторы, знаки) берут нормаль подлежащей поверхности — иначе плоская наклейка «светится» на круглом борту.
  smoothNormals() {
    const P = this.pos, nv = P.length / 3, nt = nv / 3, pats = this.patch;
    const fn = new Float32Array(nt * 3), cosT = new Float32Array(nt), sgT = new Int32Array(nt), dec = new Uint8Array(nt), ang = new Float32Array(nv);
    for (const p of pats) {
      const sa = p.sa ?? (p.wing ? 89 : PART_SA[p.part] ?? 50), c = Math.cos((sa * Math.PI) / 180);
      for (let t = p.v / 3; t < (p.v + p.n) / 3; t++) { cosT[t] = c; sgT[t] = p.sg || 0; dec[t] = p.decal ? 1 : 0; }
    }
    for (let t = 0; t < nt; t++) {
      const a = t * 9;
      const ux = P[a + 3] - P[a], uy = P[a + 4] - P[a + 1], uz = P[a + 5] - P[a + 2];
      const wx = P[a + 6] - P[a], wy = P[a + 7] - P[a + 1], wz = P[a + 8] - P[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
      for (let c = 0; c < 3; c++) {
        const i = t * 3 + c, j = t * 3 + ((c + 1) % 3), k = t * 3 + ((c + 2) % 3);
        const ax = P[j * 3] - P[i * 3], ay = P[j * 3 + 1] - P[i * 3 + 1], az = P[j * 3 + 2] - P[i * 3 + 2];
        const bx = P[k * 3] - P[i * 3], by = P[k * 3 + 1] - P[i * 3 + 1], bz = P[k * 3 + 2] - P[i * 3 + 2];
        const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
        ang[i] = la > 1e-9 && lb > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)))) : 0;
      }
    }
    const nrm = new Float32Array(nv * 3);
    const groups = new Map(), q = 1e4;
    for (let v = 0; v < nv; v++) {
      const t = (v / 3) | 0;
      if (dec[t]) continue;
      const key = Math.round(P[v * 3] * q) + ',' + Math.round(P[v * 3 + 1] * q) + ',' + Math.round(P[v * 3 + 2] * q) + ',' + this.bone[v] + ',' + sgT[t];
      const g = groups.get(key);
      if (g) g.push(v); else groups.set(key, [v]);
    }
    for (const g of groups.values()) {
      for (const v of g) {
        const t = (v / 3) | 0;
        let sx = 0, sy = 0, sz = 0;
        for (const u of g) {
          const t2 = (u / 3) | 0;
          const d = fn[t * 3] * fn[t2 * 3] + fn[t * 3 + 1] * fn[t2 * 3 + 1] + fn[t * 3 + 2] * fn[t2 * 3 + 2];
          if (t2 !== t && d < Math.max(cosT[t], cosT[t2]) - 1e-6) continue;
          const w = t2 === t ? Math.max(ang[u], 1e-3) : ang[u];
          sx += fn[t2 * 3] * w; sy += fn[t2 * 3 + 1] * w; sz += fn[t2 * 3 + 2] * w;
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        nrm[v * 3] = sx / l; nrm[v * 3 + 1] = sy / l; nrm[v * 3 + 2] = sz / l;
      }
    }
    // наклейки: нормаль ближайшей точки подлежащей (не наклеечной) поверхности той же кости
    const box = new Float32Array(nt * 6);
    for (let t = 0; t < nt; t++) {
      const a = t * 9;
      box[t * 6] = Math.min(P[a], P[a + 3], P[a + 6]); box[t * 6 + 1] = Math.min(P[a + 1], P[a + 4], P[a + 7]); box[t * 6 + 2] = Math.min(P[a + 2], P[a + 5], P[a + 8]);
      box[t * 6 + 3] = Math.max(P[a], P[a + 3], P[a + 6]); box[t * 6 + 4] = Math.max(P[a + 1], P[a + 4], P[a + 7]); box[t * 6 + 5] = Math.max(P[a + 2], P[a + 5], P[a + 8]);
    }
    const cp = [0, 0, 0, 0, 0, 0];
    for (const p of pats) {
      if (!p.decal) continue;
      const t0 = p.v / 3, bone = this.bone[p.v], E = 0.12;
      const nd = [fn[t0 * 3], fn[t0 * 3 + 1], fn[t0 * 3 + 2]];
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let v = p.v; v < p.v + p.n; v++) {
        x0 = Math.min(x0, P[v * 3]); y0 = Math.min(y0, P[v * 3 + 1]); z0 = Math.min(z0, P[v * 3 + 2]);
        x1 = Math.max(x1, P[v * 3]); y1 = Math.max(y1, P[v * 3 + 1]); z1 = Math.max(z1, P[v * 3 + 2]);
      }
      const cand = [];
      for (let t = 0; t < nt; t++) {
        if (dec[t] || this.bone[t * 3] !== bone) continue;
        if (box[t * 6] > x1 + E || box[t * 6 + 3] < x0 - E || box[t * 6 + 1] > y1 + E || box[t * 6 + 4] < y0 - E || box[t * 6 + 2] > z1 + E || box[t * 6 + 5] < z0 - E) continue;
        if (fn[t * 3] * nd[0] + fn[t * 3 + 1] * nd[1] + fn[t * 3 + 2] * nd[2] < 0.4) continue;
        cand.push(t);
      }
      for (let v = p.v; v < p.v + p.n; v++) {
        let best = Infinity, bt = -1, bu = 0, bw = 0;
        for (const t of cand) {
          closestOnTri(P, t, P[v * 3], P[v * 3 + 1], P[v * 3 + 2], cp);
          if (cp[3] < best) { best = cp[3]; bt = t; bu = cp[4]; bw = cp[5]; }
        }
        let nx = nd[0], ny = nd[1], nz = nd[2];
        if (bt >= 0) {
          const i = bt * 9, a = 1 - bu - bw;
          nx = nrm[i] * a + nrm[i + 3] * bu + nrm[i + 6] * bw; ny = nrm[i + 1] * a + nrm[i + 4] * bu + nrm[i + 7] * bw; nz = nrm[i + 2] * a + nrm[i + 5] * bu + nrm[i + 8] * bw;
          const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        }
        nrm[v * 3] = nx; nrm[v * 3 + 1] = ny; nrm[v * 3 + 2] = nz;
      }
    }
    this.fn = fn;
    return nrm;
  }

  // ---------- запекание объёма (ambient occlusion) в вершины ----------
  // Каждая грань — излучатель-«диск» (крупные дробятся), приёмник — вершина с нормалью: затенение = Σ A·cosθe·cosθr / (π d² + A).
  // Затемняются корни крыльев, ниши, места под крылом, воздухозаборники, стыки. Убираемые/вращающиеся части не затеняют.
  bakeAO(nrm) {
    const P = this.pos, nv = P.length / 3, nt = nv / 3, fn = this.fn, bones = this.bones, pats = this.patch;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); }
    const size = Math.max(hi[0] - lo[0], hi[2] - lo[2]);
    const R = Math.min(2.6, Math.max(1.0, size * 0.06)), R2 = R * R, ES = Math.max(0.35, R * 0.45);
    const dec = new Uint8Array(nt);
    for (const p of pats) if (p.decal) for (let t = p.v / 3; t < (p.v + p.n) / 3; t++) dec[t] = 1;
    // излучатели
    const E = [];
    for (let t = 0; t < nt; t++) {
      if (dec[t] || AO_SKIP[bones[this.bone[t * 3]].ch]) continue;
      const a = t * 9;
      const A = [P[a], P[a + 1], P[a + 2]], B = [P[a + 3], P[a + 4], P[a + 5]], C = [P[a + 6], P[a + 7], P[a + 8]];
      const area = len(cross(sub(B, A), sub(C, A))) / 2;
      if (area < 1e-6) continue;
      const k = Math.min(6, Math.max(1, Math.ceil(Math.max(Math.sqrt(d2(A, B)), Math.sqrt(d2(B, C)), Math.sqrt(d2(C, A))) / ES)));
      const cnt = (k * (k + 1)) / 2, ea = area / cnt;
      for (let i = 0; i < k; i++) for (let j = 0; i + j < k; j++) {
        const u = (i + 1 / 3) / k, w = (j + 1 / 3) / k, v0 = 1 - u - w;
        E.push(A[0] * v0 + B[0] * u + C[0] * w, A[1] * v0 + B[1] * u + C[1] * w, A[2] * v0 + B[2] * u + C[2] * w, fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2], ea);
      }
    }
    const grid = new Map(), cell = (x) => Math.floor(x / R);
    for (let e = 0; e < E.length; e += 7) {
      const key = cell(E[e]) + ',' + cell(E[e + 1]) + ',' + cell(E[e + 2]);
      const g = grid.get(key);
      if (g) g.push(e); else grid.set(key, [e]);
    }
    const ao = new Float32Array(nv).fill(1), cache = new Map();
    for (let v = 0; v < nv; v++) {
      const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
      const px = P[v * 3] + nx * 0.015, py = P[v * 3 + 1] + ny * 0.015, pz = P[v * 3 + 2] + nz * 0.015;
      const key = Math.round(px * 500) + ',' + Math.round(py * 500) + ',' + Math.round(pz * 500) + ',' + Math.round(nx * 8) + ',' + Math.round(ny * 8) + ',' + Math.round(nz * 8);
      const hit = cache.get(key);
      if (hit !== undefined) { ao[v] = hit; continue; }
      let occ = 0;
      const cx = cell(px), cy = cell(py), cz = cell(pz);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const g = grid.get((cx + i) + ',' + (cy + j) + ',' + (cz + k));
        if (!g) continue;
        for (const e of g) {
          const dx = E[e] - px, dy = E[e + 1] - py, dz = E[e + 2] - pz, dd = dx * dx + dy * dy + dz * dz;
          if (dd > R2 || dd < 1e-8) continue;
          const il = 1 / Math.sqrt(dd);
          const cr = (dx * nx + dy * ny + dz * nz) * il;
          if (cr <= 0.03) continue;
          const ce = -(dx * E[e + 3] + dy * E[e + 4] + dz * E[e + 5]) * il;
          if (ce <= 0) continue;
          const A = E[e + 6], fall = 1 - dd / R2;
          occ += ((A * ce * cr) / (Math.PI * dd + A)) * fall;
        }
      }
      const r = Math.max(0, 1 - occ);
      cache.set(key, r);
      ao[v] = r;
    }
    return ao;
  }

  // ---------- итог ----------
  finish(cg) {
    const sh = (p) => [p[0] - cg[0], p[1] - cg[1], p[2] - cg[2]];
    const fix = (arr) => { for (let i = 0; i < arr.length; i += 3) { arr[i] -= cg[0]; arr[i + 1] -= cg[1]; arr[i + 2] -= cg[2]; } };
    fix(this.pos); fix(this.opos);
    for (const b of this.bones) b.pivot = sh(b.pivot);
    const A = this.anchors, out = {};
    out.cockpit = A.cockpit ? sh(A.cockpit) : null;
    for (const k of ['engines', 'props', 'muzzles', 'hardpoints', 'wingtips', 'gearMain']) out[k] = A[k].map(sh);
    out.wingtips.sort((a, b) => a[0] - b[0]);
    out.gearNose = A.gearNose ? sh(A.gearNose) : null;
    const nv = this.pos.length / 3, no = this.opos.length / 3;
    const nrm = this.smoothNormals();
    const ao = this.bakeAO(nrm);
    const skin = (bone, n) => { const a = new Uint8Array(n * 4); for (let i = 0; i < n; i++) a[i * 4] = bone[i]; return a; };
    const weight = (n) => { const a = new Uint8Array(n * 4); for (let i = 0; i < n; i++) a[i * 4] = 255; return a; };
    return {
      cg,
      pos: new Float32Array(this.pos), nrm, ao, skinIndex: skin(this.bone, nv), skinWeight: weight(nv), patches: this.patch,
      opos: new Float32Array(this.opos), oskinIndex: skin(this.obone, no), oskinWeight: weight(no), ocol: new Float32Array(this.ocol),
      bones: this.bones, anchors: out, tris: nv / 3,
    };
  }
}
