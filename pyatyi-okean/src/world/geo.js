// Сборщик low-poly геометрии: накапливает треугольники с цветами вершин (и uv для «окон») и выдаёт один BufferGeometry.
// Локальная система кадра: +x вправо, +y вверх, −z вперёд (как у моделей самолётов); setFrame задаёт точку и курс.
import * as THREE from 'three';

export const UV0 = 0.5 / 64; // texel «стена без окна»

export class Builder {
  constructor(uv = false) {
    this.p = [];
    this.c = [];
    this.uv = uv ? [] : null;
    this.ox = 0; this.oy = 0; this.oz = 0; this.cs = 1; this.sn = 0;
  }
  // точка (x, y, z) мира и курс (рад): локальный «вперёд» (−z) смотрит по курсу
  setFrame(x = 0, y = 0, z = 0, heading = 0) {
    this.ox = x; this.oy = y; this.oz = z; this.cs = Math.cos(heading); this.sn = Math.sin(heading);
    return this;
  }
  _v(x, y, z, col, u, v) {
    this.p.push(this.ox + this.cs * x - this.sn * z, this.oy + y, this.oz + this.sn * x + this.cs * z);
    this.c.push(col[0], col[1], col[2]);
    if (this.uv) this.uv.push(u === undefined ? UV0 : u, v === undefined ? UV0 : v);
  }
  tri(a, b, c, col) {
    this._v(a[0], a[1], a[2], col); this._v(b[0], b[1], b[2], col); this._v(c[0], c[1], c[2], col);
  }
  // четырёхугольник a-b-c-d (обход против часовой, если смотреть снаружи)
  quad(a, b, c, d, col, uvs) {
    if (uvs) {
      this._v(a[0], a[1], a[2], col, uvs[0], uvs[1]); this._v(b[0], b[1], b[2], col, uvs[2], uvs[1]); this._v(c[0], c[1], c[2], col, uvs[2], uvs[3]);
      this._v(a[0], a[1], a[2], col, uvs[0], uvs[1]); this._v(c[0], c[1], c[2], col, uvs[2], uvs[3]); this._v(d[0], d[1], d[2], col, uvs[0], uvs[3]);
    } else {
      this.tri(a, b, c, col); this.tri(a, c, d, col);
    }
  }
  // горизонтальный прямоугольник на высоте y (смотрит вверх): центр (x, z), размеры sx × sz, поворот yaw вокруг Y
  rect(x, z, sx, sz, y, col, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hz = sz / 2;
    const P = (lx, lz) => [x + c * lx - s * lz, y, z + s * lx + c * lz];
    this.quad(P(-hx, hz), P(hx, hz), P(hx, -hz), P(-hx, -hz), col);
  }
  // коробка: (x, z) — центр, y — низ; o: { yaw, top (цвет крыши), win (окна на стенах), bottom, taper (сужение верха 0..1) }
  box(x, y, z, sx, sy, sz, col, o = {}) {
    const yaw = o.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hz = sz / 2, k = 1 - (o.taper || 0);
    const P = (lx, ly, lz) => [x + c * lx - s * lz, y + ly, z + s * lx + c * lz];
    const b0 = P(-hx, 0, hz), b1 = P(hx, 0, hz), b2 = P(hx, 0, -hz), b3 = P(-hx, 0, -hz);
    const t0 = P(-hx * k, sy, hz * k), t1 = P(hx * k, sy, hz * k), t2 = P(hx * k, sy, -hz * k), t3 = P(-hx * k, sy, -hz * k);
    let ux = null, uz = null;
    if (o.win && this.uv) {
      const u0 = Math.floor(Math.random() * 8) / 8, v0 = Math.floor(Math.random() * 8) / 8;
      const fl = Math.max(1, Math.round(sy / 3.3)) / 8;
      ux = [u0, v0, u0 + Math.max(1, Math.round(sx / 3.6)) / 8, v0 + fl];
      uz = [u0 + 0.25, v0, u0 + 0.25 + Math.max(1, Math.round(sz / 3.6)) / 8, v0 + fl];
    }
    this.quad(b0, b1, t1, t0, col, ux); // +z
    this.quad(b2, b3, t3, t2, col, ux); // −z
    this.quad(b1, b2, t2, t1, col, uz); // +x
    this.quad(b3, b0, t0, t3, col, uz); // −x
    this.quad(t0, t1, t2, t3, o.top || col);
    if (o.bottom) this.quad(b3, b2, b1, b0, col);
  }
  // двускатная крыша: конёк вдоль локальной оси x
  roof(x, y, z, sx, sz, h, col, yaw = 0, wallCol) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hz = sz / 2;
    const P = (lx, ly, lz) => [x + c * lx - s * lz, y + ly, z + s * lx + c * lz];
    const a = P(-hx, 0, hz), b = P(hx, 0, hz), cc = P(hx, 0, -hz), d = P(-hx, 0, -hz), r0 = P(-hx, h, 0), r1 = P(hx, h, 0);
    this.quad(a, b, r1, r0, col);
    this.quad(cc, d, r0, r1, col);
    this.tri(b, cc, r1, wallCol || col);
    this.tri(d, a, r0, wallCol || col);
  }
  // вертикальный усечённый конус/цилиндр: y — низ, r0 — радиус низа, r1 — верха
  cyl(x, y, z, r0, r1, h, n, col, o = {}) {
    const top = o.top || col, ph = o.phase || 0;
    for (let i = 0; i < n; i++) {
      const a0 = ph + (i / n) * Math.PI * 2, a1 = ph + ((i + 1) / n) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const b0 = [x + c0 * r0, y, z + s0 * r0], b1 = [x + c1 * r0, y, z + s1 * r0];
      if (r1 > 0.001) {
        const t0 = [x + c0 * r1, y + h, z + s0 * r1], t1 = [x + c1 * r1, y + h, z + s1 * r1];
        this.quad(b1, b0, t0, t1, col);
        if (!o.open) this.tri([x, y + h, z], t1, t0, top);
      } else this.tri(b1, b0, [x, y + h, z], col);
    }
  }
  // арочный ангар: ось вдоль локальной z (длина len), ширина w, высота h; торец −z открыт тёмным «проёмом»
  arch(x, y, z, w, len, h, n, col, o = {}) {
    const yaw = o.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), hl = len / 2;
    const P = (lx, ly, lz) => [x + c * lx - s * lz, y + ly, z + s * lx + c * lz];
    const end = o.end || col, door = o.door || end;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI, a1 = ((i + 1) / n) * Math.PI;
      const x0 = -Math.cos(a0) * w / 2, y0 = Math.sin(a0) * h, x1 = -Math.cos(a1) * w / 2, y1 = Math.sin(a1) * h;
      this.quad(P(x0, y0, hl), P(x1, y1, hl), P(x1, y1, -hl), P(x0, y0, -hl), i === 0 || i === n - 1 ? (o.side || col) : col);
      this.tri(P(0, 0, hl), P(x1, y1, hl), P(x0, y0, hl), end);
      this.tri(P(0, 0, -hl), P(x0, y0, -hl), P(x1, y1, -hl), door);
    }
  }
  // «капля» — неровный многогранник (скалы, кроны, айсберги): икосаэдр с шумом
  blob(x, y, z, rx, ry, rz, col, seed = 1, flat = -2) {
    const t = (1 + Math.sqrt(5)) / 2;
    const vs = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const fs = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const L = Math.hypot(1, t);
    const pv = vs.map((v, i) => {
      const k = 0.8 + 0.4 * (((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1);
      return [x + (v[0] / L) * rx * k, y + Math.max(flat, (v[1] / L) * k) * ry, z + (v[2] / L) * rz * k];
    });
    for (const f of fs) this.tri(pv[f[0]], pv[f[1]], pv[f[2]], col);
  }
  // брус квадратного сечения между двумя точками
  beam(a, b, w, col) {
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    // n1 = d × up (или ось x для вертикали), n2 = d × n1
    let n1x = -dz, n1y = 0, n1z = dx;
    const nl = Math.hypot(n1x, n1z);
    if (nl < 1e-4) { n1x = 1; n1z = 0; } else { n1x /= nl; n1z /= nl; }
    const n2x = dy * n1z - dz * n1y, n2y = dz * n1x - dx * n1z, n2z = dx * n1y - dy * n1x;
    const h = w / 2;
    const cs = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([p, q]) => [(n1x * p + n2x * q) * h, (n1y * p + n2y * q) * h, (n1z * p + n2z * q) * h]);
    for (let i = 0; i < 4; i++) {
      const c0 = cs[i], c1 = cs[(i + 1) % 4];
      this.quad([a[0] + c0[0], a[1] + c0[1], a[2] + c0[2]], [a[0] + c1[0], a[1] + c1[1], a[2] + c1[2]], [b[0] + c1[0], b[1] + c1[1], b[2] + c1[2]], [b[0] + c0[0], b[1] + c0[1], b[2] + c0[2]], col);
    }
  }
  get count() { return this.p.length / 9; }
  build() {
    const pos = new Float32Array(this.p), n = pos.length;
    const nor = new Float32Array(n);
    for (let i = 0; i < n; i += 9) {
      const e1x = pos[i + 3] - pos[i], e1y = pos[i + 4] - pos[i + 1], e1z = pos[i + 5] - pos[i + 2];
      const e2x = pos[i + 6] - pos[i], e2y = pos[i + 7] - pos[i + 1], e2z = pos[i + 8] - pos[i + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = 1 / (Math.hypot(nx, ny, nz) || 1);
      nx *= l; ny *= l; nz *= l;
      for (let q = 0; q < 9; q += 3) { nor[i + q] = nx; nor[i + q + 1] = ny; nor[i + q + 2] = nz; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    if (this.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere();
    this.p = this.c = this.uv = null;
    return g;
  }
}

// Семисегментные цифры для разметки: рисует число s в кадре сборщика (центр cx, cz; «верх» цифры — локальное −z)
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };
export function drawNumber(b, str, cx, cz, h, y, col) {
  const w = h * 0.5, t = h * 0.14, gap = h * 0.22;
  const total = str.length * w + (str.length - 1) * gap;
  let x0 = cx - total / 2;
  for (const ch of str) {
    const seg = SEG[ch];
    if (seg) {
      const xc = x0 + w / 2;
      const hz = h / 2;
      for (const s of seg) {
        if (s === 'a') b.rect(xc, cz - hz + t / 2, w, t, y, col);
        else if (s === 'g') b.rect(xc, cz, w, t, y, col);
        else if (s === 'd') b.rect(xc, cz + hz - t / 2, w, t, y, col);
        else if (s === 'f') b.rect(x0 + t / 2, cz - hz / 2, t, hz, y, col);
        else if (s === 'b') b.rect(x0 + w - t / 2, cz - hz / 2, t, hz, y, col);
        else if (s === 'e') b.rect(x0 + t / 2, cz + hz / 2, t, hz, y, col);
        else if (s === 'c') b.rect(x0 + w - t / 2, cz + hz / 2, t, hz, y, col);
      }
    }
    x0 += w + gap;
  }
}

// Текстуры «окон»: дневная (тёмные стёкла на белой стене) и ночная (светящиеся окна)
export function makeWindowTextures() {
  const S = 64;
  const mk = (night) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = night ? '#000' : '#fff';
    ctx.fillRect(0, 0, S, S);
    let seed = 99;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const r = rnd();
      if (night) {
        if (r > 0.42) continue;
        ctx.fillStyle = r < 0.07 ? '#cfe4ff' : r < 0.25 ? '#ffd58a' : '#ffbe66';
      } else ctx.fillStyle = r < 0.3 ? '#5c6f86' : '#6f8298';
      ctx.fillRect(i * 8 + 2, j * 8 + 2, 5, 4);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  };
  return { day: mk(false), night: mk(true) };
}
