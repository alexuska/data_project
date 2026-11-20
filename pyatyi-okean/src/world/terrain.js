// Меш рельефа: гранёные треугольники с цветом по высоте/уклону/климату, порезанные на блоки для отсечения.
// Подводная часть шельфа рисуется тем же мешем (шейдер красит её «водой» — см. env.js), поэтому z-fighting с морем нет.
import * as THREE from 'three';
import { fbm2, clamp, lerp, smoothstep } from '../core/util.js';
import { GRID_N, CELL, HALF, ISLE, arcticAt, tropicAt, snowLineAt, treeLineAt, forestAt, urbanAt, fieldAt, flatWeight } from './heightfield.js';
import { AIRPORTS, LAKE, POI_BY_ID } from './layout.js';
import { patchMaterial, lin } from './env.js';

const CUT = -28; // глубже — клетки не рисуем (там уже чистый цвет моря)
const CHUNKS = 8;

const PAL = {
  sand: lin('#e2cf9e'), sandT: lin('#f3e6c2'), sandV: lin('#4f4a46'), sandN: lin('#aeb4b6'),
  grass: lin('#86b356'), grassT: lin('#6fc058'), grassN: lin('#8f9870'), grassDry: lin('#a3ae62'),
  upland: lin('#7e9c56'), alpine: lin('#97a070'),
  forest: lin('#3d7040'), forestN: lin('#2f5a42'), forestT: lin('#2f8a48'),
  rock: lin('#8e857a'), rockDark: lin('#6a635d'), rockV: lin('#4c4542'), rockN: lin('#727a84'), lava: lin('#3d2b28'),
  snow: lin('#f1f5fb'), ice: lin('#d2e6f0'),
  urban: lin('#b5aea3'), mown: lin('#8fb85c'),
  fields: [lin('#d8c56c'), lin('#a98c5c'), lin('#93bf5c'), lin('#5f9548'), lin('#c2b25a')],
  seabed: lin('#c8bd94'), seabedRock: lin('#6f6a60'),
};
const landAirports = AIRPORTS.filter((a) => a.kind !== 'carrier');

function hash2i(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), { shore: true });
  const meshes = [];
  const volc = POI_BY_ID.volcano;
  let tris = 0;

  // данные на клетку (общие для двух треугольников)
  const cell = { f: 0, fld: 0, urb: 0, sl: 0, fw: 0, arc: 0, tro: 0, tl: 0, isle: 0, rnd: 0, strip: false };

  function faceColor(out, o, cx, cz, h, hmin, ny, jit) {
    const slope = 1 - ny;
    const id = cell.isle;
    const arc = cell.arc, tro = cell.tro;
    if (h < 0.3) {
      // дно: песок/камень, чуть темнее с глубиной
      mix3(id === ISLE.VOLCANO ? PAL.sandV : arc > 0.5 ? PAL.sandN : tro > 0.5 ? PAL.sandT : PAL.seabed, PAL.seabedRock, smoothstep(0.1, 0.25, slope));
    } else {
      const beachTop = 3.2 + tro * 3.2 + (id === ISLE.MAYAK ? 1 : 0);
      if (hmin < beachTop && h < beachTop + 2.5 && slope < 0.1 && cell.fw < 0.6) {
        mix3(PAL.sand, PAL.sandT, tro);
        if (id === ISLE.VOLCANO) into(PAL.sandV, 0.85);
        if (arc > 0) into(PAL.sandN, arc);
      } else {
        // трава по высоте и климату
        mix3(PAL.grass, PAL.grassT, tro);
        if (arc > 0) into(PAL.grassN, arc);
        into(PAL.grassDry, clamp((cell.rnd - 0.5) * 0.9, 0, 0.4));
        into(PAL.upland, smoothstep(120, 420, h));
        into(PAL.alpine, smoothstep(cell.tl - 150, cell.tl + 60, h));
        if (cell.fld) { const fc = PAL.fields[cell.fld - 1]; into(fc, 0.92); }
        if (cell.f > 0.02) {
          const conifer = clamp(arc + smoothstep(350, 650, h), 0, 1);
          const fc = tro > 0.5 ? PAL.forestT : conifer > 0.5 ? PAL.forestN : PAL.forest;
          into(fc, clamp(cell.f * 1.15, 0, 0.92));
        }
        if (cell.fw > 0.02) into(arc > 0.5 ? PAL.grassN : h > 700 ? PAL.alpine : PAL.mown, smoothstep(0.1, 0.8, cell.fw) * 0.9);
        if (cell.urb > 0) into(PAL.urban, cell.urb * 0.85);
        // вулкан: тёмная порода и лава у кратера
        if (id === ISLE.VOLCANO) {
          into(PAL.rockV, smoothstep(260, 760, h) * 0.95);
          const r = Math.hypot(cx - volc.x, cz - volc.z);
          if (r < 560) into(PAL.lava, 0.8);
        }
        // скалы на крутых склонах
        const rk = smoothstep(0.15, 0.3, slope);
        if (rk > 0) into(id === ISLE.VOLCANO ? PAL.rockV : arc > 0.5 ? PAL.rockN : cell.rnd > 0.6 ? PAL.rockDark : PAL.rock, rk);
        // снег
        const sn = smoothstep(cell.sl - 50, cell.sl + 90, h) * (1 - smoothstep(0.34, 0.52, slope));
        if (sn > 0) into(hmin < 2.5 && arc > 0.5 ? PAL.ice : PAL.snow, sn);
      }
    }
    const k = 0.93 + 0.14 * jit;
    out[o] = Math.min(65535, Math.sqrt(clamp(_col[0] * k, 0, 1)) * 65535);
    out[o + 1] = Math.min(65535, Math.sqrt(clamp(_col[1] * k, 0, 1)) * 65535);
    out[o + 2] = Math.min(65535, Math.sqrt(clamp(_col[2] * k, 0, 1)) * 65535);
  }

  for (let cj = 0; cj < CHUNKS; cj++) {
    for (let ci = 0; ci < CHUNKS; ci++) {
      const i0 = ci * per, j0 = cj * per;
      let count = 0;
      for (let j = j0; j < j0 + per; j++) {
        for (let i = i0; i < i0 + per; i++) {
          const k = j * V + i;
          if (data[k] > CUT || data[k + 1] > CUT || data[k + V] > CUT || data[k + V + 1] > CUT) count++;
        }
      }
      if (!count) continue;
      const pos = new Float32Array(count * 18), nor = new Int8Array(count * 18), col = new Uint16Array(count * 18);
      let o = 0, ymin = 1e9, ymax = -1e9, xmin = 1e9, xmax = -1e9, zmin = 1e9, zmax = -1e9;
      const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, jit) => {
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const l = 1 / Math.hypot(nx, ny, nz);
        nx *= l; ny *= l; nz *= l;
        pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az; pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz; pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
        const qx = Math.round(nx * 127), qy = Math.round(ny * 127), qz = Math.round(nz * 127);
        for (let q = 0; q < 9; q += 3) { nor[o + q] = qx; nor[o + q + 1] = qy; nor[o + q + 2] = qz; }
        faceColor(col, o, (ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, Math.min(ay, by, cy), ny, jit);
        col[o + 3] = col[o + 6] = col[o]; col[o + 4] = col[o + 7] = col[o + 1]; col[o + 5] = col[o + 8] = col[o + 2];
        o += 9;
      };
      for (let j = j0; j < j0 + per; j++) {
        const z0 = -HALF + j * CELL, z1 = z0 + CELL;
        for (let i = i0; i < i0 + per; i++) {
          const k = j * V + i;
          const h00 = data[k], h10 = data[k + 1], h01 = data[k + V], h11 = data[k + V + 1];
          const hmax = Math.max(h00, h10, h01, h11);
          if (hmax <= CUT) continue;
          const x0 = -HALF + i * CELL, x1 = x0 + CELL;
          const mx = x0 + CELL / 2, mz = z0 + CELL / 2, mh = (h00 + h10 + h01 + h11) / 4;
          if (hmax < ymin) ymin = Math.min(h00, h10, h01, h11);
          ymin = Math.min(ymin, h00, h10, h01, h11); ymax = Math.max(ymax, hmax);
          xmin = Math.min(xmin, x0); xmax = Math.max(xmax, x1); zmin = Math.min(zmin, z0); zmax = Math.max(zmax, z1);
          // свойства клетки
          cell.isle = isleG[k] || isleG[k + 1] || isleG[k + V] || isleG[k + V + 1];
          cell.arc = arcticAt(mz); cell.tro = tropicAt(mz); cell.tl = treeLineAt(mz);
          cell.rnd = fbm2(mx / 1300, mz / 1300, 2, 5);
          if (hmax > 0.3) {
            const gx = (h10 + h11 - h00 - h01) / (2 * CELL), gz = (h01 + h11 - h00 - h10) / (2 * CELL);
            const sl = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
            cell.fw = 0;
            for (const a of landAirports) { const w = flatWeight(a, mx, mz); if (w > cell.fw) cell.fw = w; }
            cell.f = forestAt(mx, mz, mh, sl, cell.isle);
            cell.urb = urbanAt(mx, mz);
            cell.fld = cell.urb > 0.3 || cell.fw > 0.5 || cell.f > 0.35 ? 0 : fieldAt(mx, mz, mh, sl, cell.isle);
            cell.sl = snowLineAt(mx, mz);
          } else { cell.f = 0; cell.urb = 0; cell.fld = 0; cell.fw = 0; cell.sl = 1e9; }
          const j1 = hash2i(i, j), j2 = hash2i(i + 7919, j + 104729);
          if ((i + j) & 1) {
            tri(x0, h00, z0, x1, h11, z1, x1, h10, z0, j1);
            tri(x0, h00, z0, x0, h01, z1, x1, h11, z1, j2);
          } else {
            tri(x0, h00, z0, x0, h01, z1, x1, h10, z0, j1);
            tri(x1, h10, z0, x0, h01, z1, x1, h11, z1, j2);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
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
