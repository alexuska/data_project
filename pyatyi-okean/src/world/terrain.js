// Меш рельефа: общая сетка вершин (диагонали клеток — в том же шахматном порядке, что и heightAt), гладкие нормали
// из сетки высот, порезан на блоки для отсечения. В вершинах — базовый цвет (климат, трава, лес, песок, город)
// и веса материалов; детали (поля, скалы, осыпи, снег, мокрый песок, зерно, тени облаков) рисует шейдер (env.js, W_TERRAIN).
// Подводная часть шельфа рисуется тем же мешем (шейдер красит её «водой»), поэтому z-fighting с морем нет.
import * as THREE from 'three';
import { fbm2, clamp, lerp, smoothstep } from '../core/util.js';
import { GRID_N, CELL, HALF, ISLE, arcticAt, tropicAt, snowLineAt, treeLineAt, forestAt, urbanAt, fieldAt, flatWeight } from './heightfield.js';
import { AIRPORTS, POI_BY_ID } from './layout.js';
import { patchMaterial, lin } from './env.js';

const CUT = -22; // глубже — клетки не рисуем (там уже чистый цвет моря)
const CHUNKS = 8;

const PAL = {
  sand: lin('#dccb9c'), sandT: lin('#f0e2bf'), sandV: lin('#4f4a46'), sandN: lin('#aeb4b6'),
  grass: lin('#7fae52'), grassT: lin('#6cb956'), grassN: lin('#8c9670'), grassDry: lin('#a6ac64'),
  upland: lin('#7a9752'), grassDeep: lin('#5b9449'), alpine: lin('#94996e'),
  forest: lin('#3a6a3c'), forestN: lin('#2d5640'), forestT: lin('#2c8244'),
  rock: lin('#8e857a'), rockDark: lin('#6a635d'), rockV: lin('#4c4542'), lava: lin('#3d2b28'),
  urban: lin('#aaa59b'), mown: lin('#86ad5c'),
  seabed: lin('#c8bd94'), seabedRock: lin('#6f6a60'),
};
const landAirports = AIRPORTS.filter((a) => a.kind !== 'carrier');

const _col = [0, 0, 0];
function mix3(a, b, t) {
  _col[0] = a[0] + (b[0] - a[0]) * t; _col[1] = a[1] + (b[1] - a[1]) * t; _col[2] = a[2] + (b[2] - a[2]) * t;
}
function into(b, t) {
  _col[0] += (b[0] - _col[0]) * t; _col[1] += (b[1] - _col[1]) * t; _col[2] += (b[2] - _col[2]) * t;
}

export function buildTerrain(hf, group) {
  const N = GRID_N, V = hf.V, data = hf.data, isleG = hf.isle;
  const per = N / CHUNKS;
  const volc = POI_BY_ID.volcano;

  // ---- свойства вершин сетки (один раз на всю карту) ----
  const NV = V * V;
  const vNor = new Int8Array(NV * 3);
  const vCol = new Uint16Array(NV * 3);
  const vW = new Uint8Array(NV * 4); // x: поле, y: вулканическая порода, z: лес, w: песок
  const vSnow = new Int16Array(NV); // высота над снеговой линией, м
  const vForest = new Float32Array(NV);
  const need = new Uint8Array(NV);
  // нужны только вершины клеток, которые будем рисовать
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * V + i;
    if (data[k] > CUT || data[k + 1] > CUT || data[k + V] > CUT || data[k + V + 1] > CUT) need[k] = need[k + 1] = need[k + V] = need[k + V + 1] = 1;
  }
  const inv2 = 1 / (2 * CELL);
  for (let j = 0; j < V; j++) {
    const z = -HALF + j * CELL;
    const arc = arcticAt(z), tro = tropicAt(z), tl = treeLineAt(z);
    for (let i = 0; i < V; i++) {
      const k = j * V + i;
      if (!need[k]) continue;
      const x = -HALF + i * CELL;
      const h = data[k];
      // гладкая нормаль по центральным разностям
      const hl = data[i > 0 ? k - 1 : k], hr = data[i < N ? k + 1 : k], hd = data[j > 0 ? k - V : k], hu = data[j < N ? k + V : k];
      const gx = (hr - hl) * inv2, gz = (hu - hd) * inv2;
      const ln = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      vNor[k * 3] = Math.round(-gx * ln * 127); vNor[k * 3 + 1] = Math.round(ln * 127); vNor[k * 3 + 2] = Math.round(-gz * ln * 127);
      const slope = 1 - ln;
      const id = isleG[k];
      let fw = 0, f = 0, urb = 0, fld = 0, sand = 0, sl = 1e9;
      if (h < 0.3) {
        mix3(id === ISLE.VOLCANO ? PAL.sandV : arc > 0.5 ? PAL.sandN : tro > 0.5 ? PAL.sandT : PAL.seabed, PAL.seabedRock, smoothstep(0.1, 0.25, slope));
        sand = 1;
      } else {
        for (const a of landAirports) { const w = flatWeight(a, x, z); if (w > fw) fw = w; }
        f = forestAt(x, z, h, slope, id);
        urb = urbanAt(x, z);
        fld = urb > 0.3 || fw > 0.5 || f > 0.35 ? 0 : fieldAt(x, z, h, slope, id);
        sl = snowLineAt(x, z);
        const rnd = fbm2(x / 1300, z / 1300, 2, 5);
        // трава по высоте и климату
        mix3(PAL.grass, PAL.grassT, tro);
        if (arc > 0) into(PAL.grassN, arc);
        into(PAL.grassDry, clamp((rnd - 0.46) * 2.4, 0, 0.6));
        into(PAL.grassDeep, clamp((0.44 - rnd) * 2.6, 0, 0.55));
        into(PAL.upland, smoothstep(120, 420, h));
        into(PAL.alpine, smoothstep(tl - 150, tl + 60, h));
        if (id === ISLE.KAMENNY) { into(PAL.grassDry, 0.45); into(rnd > 0.5 ? PAL.rock : PAL.rockDark, clamp((rnd - 0.3) * 2.2, 0.1, 0.8) * (1 - fw * 0.6)); }
        if (id === ISLE.ISLET && h > 25) into(PAL.rock, 0.5);
        if (f > 0.02) {
          const conifer = clamp(arc + smoothstep(350, 650, h), 0, 1);
          const fc = tro > 0.5 ? PAL.forestT : conifer > 0.5 ? PAL.forestN : PAL.forest;
          into(fc, clamp(f * 1.15, 0, 0.92));
        }
        if (fw > 0.02) into(arc > 0.5 ? PAL.grassN : h > 700 ? PAL.alpine : PAL.mown, smoothstep(0.1, 0.8, fw) * 0.9);
        if (urb > 0) into(PAL.urban, urb * 0.85);
        if (id === ISLE.VOLCANO) {
          into(PAL.rockV, smoothstep(260, 760, h) * 0.95);
          if (Math.hypot(x - volc.x, z - volc.z) < 560) into(PAL.lava, 0.8);
        }
        // песчаный пляж
        const beachTop = 3.2 + tro * 3.2 + (id === ISLE.MAYAK ? 1 : 0);
        sand = (1 - smoothstep(beachTop, beachTop + 2.5, h)) * (1 - smoothstep(0.07, 0.13, slope)) * (1 - smoothstep(0.3, 0.6, fw)) * (1 - urb);
        if (sand > 0) {
          const sc = id === ISLE.VOLCANO ? PAL.sandV : arc > 0.5 ? PAL.sandN : null;
          const tmp0 = _col[0], tmp1 = _col[1], tmp2 = _col[2];
          mix3(PAL.sand, PAL.sandT, tro);
          if (sc) into(sc, id === ISLE.VOLCANO ? 0.85 : arc);
          const s0 = _col[0], s1 = _col[1], s2 = _col[2];
          _col[0] = lerp(tmp0, s0, sand); _col[1] = lerp(tmp1, s1, sand); _col[2] = lerp(tmp2, s2, sand);
        }
      }
      vCol[k * 3] = clamp(_col[0], 0, 1) * 65535; vCol[k * 3 + 1] = clamp(_col[1], 0, 1) * 65535; vCol[k * 3 + 2] = clamp(_col[2], 0, 1) * 65535;
      vW[k * 4] = fld ? 255 : 0;
      vW[k * 4 + 1] = id === ISLE.VOLCANO ? 255 : id === ISLE.KAMENNY ? 90 : 0;
      vW[k * 4 + 2] = clamp(f, 0, 1) * 255;
      vW[k * 4 + 3] = clamp(sand, 0, 1) * 255;
      vSnow[k] = clamp(h - sl, -3000, 3000);
      vForest[k] = f;
    }
  }
  // лес по клеткам (для деревьев в props.js) — среднее по углам
  const forest = (hf.forest = new Uint8Array(N * N));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * V + i;
    forest[j * N + i] = ((vForest[k] + vForest[k + 1] + vForest[k + V] + vForest[k + V + 1]) / 4) * 255;
  }

  const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 }), { shore: true, terrain: true });
  const meshes = [];
  let tris = 0;
  const PV = per + 1;
  for (let cj = 0; cj < CHUNKS; cj++) {
    for (let ci = 0; ci < CHUNKS; ci++) {
      const i0 = ci * per, j0 = cj * per;
      let count = 0;
      for (let j = j0; j < j0 + per; j++) for (let i = i0; i < i0 + per; i++) {
        const k = j * V + i;
        if (data[k] > CUT || data[k + 1] > CUT || data[k + V] > CUT || data[k + V + 1] > CUT) count++;
      }
      if (!count) continue;
      const nv = PV * PV;
      const pos = new Float32Array(nv * 3), nor = new Int8Array(nv * 3), col = new Uint16Array(nv * 3), w = new Uint8Array(nv * 4), sn = new Float32Array(nv);
      for (let lj = 0; lj < PV; lj++) for (let li = 0; li < PV; li++) {
        const k = (j0 + lj) * V + i0 + li, o = lj * PV + li;
        pos[o * 3] = -HALF + (i0 + li) * CELL; pos[o * 3 + 1] = data[k]; pos[o * 3 + 2] = -HALF + (j0 + lj) * CELL;
        nor[o * 3] = vNor[k * 3]; nor[o * 3 + 1] = vNor[k * 3 + 1] || 127; nor[o * 3 + 2] = vNor[k * 3 + 2];
        col[o * 3] = vCol[k * 3]; col[o * 3 + 1] = vCol[k * 3 + 1]; col[o * 3 + 2] = vCol[k * 3 + 2];
        w[o * 4] = vW[k * 4]; w[o * 4 + 1] = vW[k * 4 + 1]; w[o * 4 + 2] = vW[k * 4 + 2]; w[o * 4 + 3] = vW[k * 4 + 3];
        sn[o] = need[k] ? vSnow[k] : -3000;
      }
      const idx = new Uint16Array(count * 6);
      let o = 0, ymin = 1e9, ymax = -1e9, xmin = 1e9, xmax = -1e9, zmin = 1e9, zmax = -1e9;
      for (let j = j0; j < j0 + per; j++) {
        for (let i = i0; i < i0 + per; i++) {
          const k = j * V + i;
          const h00 = data[k], h10 = data[k + 1], h01 = data[k + V], h11 = data[k + V + 1];
          const hmax = Math.max(h00, h10, h01, h11);
          if (hmax <= CUT) continue;
          ymin = Math.min(ymin, h00, h10, h01, h11); ymax = Math.max(ymax, hmax);
          const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL;
          xmin = Math.min(xmin, x0); xmax = Math.max(xmax, x0 + CELL); zmin = Math.min(zmin, z0); zmax = Math.max(zmax, z0 + CELL);
          const a = (j - j0) * PV + (i - i0), b = a + 1, c = a + PV, d = c + 1; // 00, 10, 01, 11
          if ((i + j) & 1) { idx[o++] = a; idx[o++] = d; idx[o++] = b; idx[o++] = a; idx[o++] = c; idx[o++] = d; }
          else { idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
      g.setAttribute('aW', new THREE.BufferAttribute(w, 4, true));
      g.setAttribute('aSnow', new THREE.BufferAttribute(sn, 1));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(xmin, ymin, zmin), new THREE.Vector3(xmax, ymax, zmax));
      g.boundingSphere = new THREE.Sphere();
      g.boundingBox.getBoundingSphere(g.boundingSphere);
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      m.name = 'terrain';
      group.add(m);
      meshes.push(m);
      tris += count * 2;
    }
  }
  return { meshes, mat, tris };
}

// Карта архипелага сверху (для HUD/меню): canvas size×size, север сверху
export function makeMapCanvas(hf, size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const step = (HALF * 2) / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -HALF + (px + 0.5) * step, z = -HALF + (py + 0.5) * step;
      const h = hf.heightAt(x, z);
      let r, g, b;
      if (h <= 0) {
        const t = clamp(-h / 26, 0, 1);
        r = lerp(96, 22, t); g = lerp(196, 78, t); b = lerp(196, 128, t);
      } else {
        const hx = hf.heightAt(x + step, z), hz = hf.heightAt(x, z + step);
        const sh = clamp(0.86 + ((h - hx) * 0.7 + (h - hz) * 0.7) / step, 0.55, 1.25);
        const sl = snowLineAt(x, z);
        if (h < 4) { r = 226; g = 210; b = 164; }
        else if (h > sl) { r = 240; g = 244; b = 250; }
        else {
          const t = clamp(h / 900, 0, 1);
          r = lerp(122, 150, t); g = lerp(168, 138, t); b = lerp(84, 118, t);
        }
        r *= sh; g *= sh; b *= sh;
      }
      const o = (py * size + px) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
