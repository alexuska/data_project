// Жизнь и ориентиры: леса, город и посёлки, мост, маяк, плотина, обсерватория, порт, курорт, полярная станция,
// буровая, корабли и лодки, айсберги, дым вулкана. Статика слита в несколько мешей по площадкам.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32, headingVec, fbm2 } from '../core/util.js';
import { GRID_N, CELL, HALF, forestAt, arcticAt, tropicAt, ISLE, TOWNS, ISLETS } from './heightfield.js';
import { AIRPORTS, POI_BY_ID, LAKE, CARRIER } from './layout.js';
import { Builder } from './geo.js';
import { lin, patchMaterial, U } from './env.js';
import { LC } from './airports.js';

const C = {
  wall: [lin('#ece7dc'), lin('#e2d6c4'), lin('#d9dde2'), lin('#efe2cf'), lin('#c9cfd6'), lin('#e6c9b0')],
  tower: [lin('#9fb4c8'), lin('#c8d2dc'), lin('#8496a8'), lin('#d8d2c4'), lin('#6f8296'), lin('#b0bcc4')],
  roof: [lin('#b5553c'), lin('#a8483a'), lin('#c26a44'), lin('#8a4a3a'), lin('#5f7286'), lin('#77634f')],
  roofFlat: lin('#8d9096'), roofsFlat: [lin('#8d9096'), lin('#a6a7a9'), lin('#73777d'), lin('#9a8e80'), lin('#b2aca2')], block: lin('#4b4e53'), yard: lin('#9a9a92'), garden: lin('#7b9a58'), park: lin('#6fa052'), road: lin('#45484d'),
  concrete: lin('#a9aaa5'), concreteDark: lin('#86888a'), red: lin('#c8452e'), white: lin('#f2f2ee'), dark: lin('#25282d'), steel: lin('#8a949e'),
  orange: lin('#ef7a2b'), yellow: lin('#f0c23a'), blue: lin('#2f5f9a'), green: lin('#3f7d55'), wood: lin('#8a6a4a'), thatch: lin('#c9a66a'),
  hull: [lin('#2c3e58'), lin('#7a2a24'), lin('#2f3338'), lin('#3d6a5a')], glass: lin('#3f5f7c'), ice: lin('#e8f2f8'), iceBlue: lin('#b8dcec'),
  rig: lin('#c9a23a'), pool: lin('#49c8d8'), water: lin('#dfeef2'),
};
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const pick = (arr, r) => arr[Math.min(arr.length - 1, (r * arr.length) | 0)];

export function createProps(G, world, hf, mats, lights) {
  const group = world.group;
  const H = world.heightAt;
  const env = world.env;
  const rnd = mulberry32(90210);
  const meshes = [];
  const addMesh = (b, mat, name, order = 0) => {
    if (!b.count) return null;
    const m = new THREE.Mesh(b.build(), mat);
    m.matrixAutoUpdate = false; m.name = name; m.renderOrder = order;
    group.add(m); meshes.push(m);
    return m;
  };

  // ======================= ЛЕСА =======================
  // гладкие «округлые» нормали крон (вместо граней) — деревья читаются объёмными, а не пирамидками
  const treeMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { tree: true });
  let treeMeshes = [];
  const TC = {
    con: [lin('#2c5a3c'), lin('#3f7a4a')], conN: [lin('#3a6650'), lin('#dfe9ee')], br: [lin('#3d7038'), lin('#6aa64c')], brA: [lin('#5a7a34'), lin('#9ab04a')],
    trop: [lin('#2f7a40'), lin('#62b450')], trunk: lin('#7a6248'), palm: [lin('#3f8f44'), lin('#7cc458')],
  };
  function buildTrees() {
    for (const m of treeMeshes) { group.remove(m); m.geometry.dispose(); }
    treeMeshes = [];
    const dens = { low: 0.3, medium: 0.75, high: 1.3 }[G.quality.level] || 0.75;
    const r = mulberry32(555);
    const NB = 8, per = GRID_N / NB;
    const buckets = [];
    for (let i = 0; i < NB * NB; i++) buckets.push({ p: [], c: [], b: [], n: [], ix: [], ymin: 1e9, ymax: -1e9 });
    const data = hf.data, V = hf.V;
    const vert = (bk, x, y, z, col, by, nx = 0, ny = 1, nz = 0) => { bk.p.push(x, y, z); bk.c.push(col[0], col[1], col[2]); bk.b.push(by); const l = 127 / Math.hypot(nx, ny, nz); bk.n.push(Math.round(nx * l), Math.round(ny * l), Math.round(nz * l)); return bk.p.length / 3 - 1; };
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const k = j * V + i;
        const h00 = data[k];
        if (h00 < 4) continue;
        const h10 = data[k + 1], h01 = data[k + V], h11 = data[k + V + 1];
        const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL;
        const mx = x0 + CELL / 2, mz = z0 + CELL / 2, mh = (h00 + h10 + h01 + h11) / 4;
        const gx = (h10 + h11 - h00 - h01) / (2 * CELL), gz = (h01 + h11 - h00 - h10) / (2 * CELL);
        const sl = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
        const isle = hf.isle[k];
        const f = hf.forest ? hf.forest[j * GRID_N + i] / 255 : forestAt(mx, mz, mh, sl, isle);
        if (f < 0.06) continue;
        const nT = f * dens;
        let cnt = Math.floor(nT) + (r() < nT - Math.floor(nT) ? 1 : 0);
        const arc = arcticAt(mz), tro = tropicAt(mz);
        const bk = buckets[Math.floor(j / per) * NB + Math.floor(i / per)];
        while (cnt-- > 0) {
          const x = x0 + r() * CELL, z = z0 + r() * CELL, y = H(x, z);
          if (y < 4) continue;
          const kk = 0.85 + r() * 0.4, sh = 0.88 + r() * 0.24;
          const ph = r() * 6.28;
          if (tro > 0.5 && y < 40 && r() < 0.62) {
            // пальма
            const h = 19 * kk, lx = (r() - 0.5) * 6, lz = (r() - 0.5) * 6;
            const t0 = vert(bk, x, y + h, z, TC.trunk, y);
            const b = [];
            for (let q = 0; q < 3; q++) b.push(vert(bk, x - lx + Math.cos(q * 2.1) * 1.1, y - 0.5, z - lz + Math.sin(q * 2.1) * 1.1, shade(TC.trunk, 0.8), y, Math.cos(q * 2.1), 0.2, Math.sin(q * 2.1)));
            bk.ix.push(b[1], b[0], t0, b[2], b[1], t0, b[0], b[2], t0);
            const top = vert(bk, x, y + h + 2.5, z, shade(TC.palm[1], sh), y);
            const tips = [];
            for (let q = 0; q < 6; q++) tips.push(vert(bk, x + Math.cos(ph + q * 1.047) * 9 * kk, y + h - 2.5 - (q % 2) * 2, z + Math.sin(ph + q * 1.047) * 9 * kk, shade(TC.palm[0], sh), y, Math.cos(ph + q * 1.047), 0.8, Math.sin(ph + q * 1.047)));
            for (let q = 0; q < 6; q++) bk.ix.push(tips[(q + 1) % 6], tips[q], top);
            bk.ymax = Math.max(bk.ymax, y + h + 3);
          } else if (arc > 0.3 || y > 330 + r() * 150 || (tro < 0.5 && fbm2(x / 600, z / 600, 2, 9) > 0.55)) {
            // ель
            const h = 34 * kk, rad = 8.5 * kk;
            const cc = arc > 0.5 ? TC.conN : TC.con;
            const ap = vert(bk, x, y + h, z, shade(cc[1], sh), y);
            const ring = [];
            for (let q = 0; q < 5; q++) ring.push(vert(bk, x + Math.cos(ph + q * 1.2566) * rad, y + 1.5, z + Math.sin(ph + q * 1.2566) * rad, shade(cc[0], sh * 0.85), y, Math.cos(ph + q * 1.2566), 0.75, Math.sin(ph + q * 1.2566)));
            for (let q = 0; q < 5; q++) bk.ix.push(ring[(q + 1) % 5], ring[q], ap);
            bk.ymax = Math.max(bk.ymax, y + h);
          } else {
            // лиственное / тропическое
            const h = 21 * kk, rad = 11.5 * kk;
            const cc = tro > 0.5 ? TC.trop : r() < 0.12 ? TC.brA : TC.br;
            const top = vert(bk, x + (r() - 0.5) * 3, y + h, z + (r() - 0.5) * 3, shade(cc[1], sh), y);
            const bot = vert(bk, x, y - 1, z, shade(cc[0], sh * 0.62), y, 0, -1, 0);
            const ring = [];
            for (let q = 0; q < 5; q++) ring.push(vert(bk, x + Math.cos(ph + q * 1.2566) * rad, y + h * (0.3 + 0.12 * (q % 2)), z + Math.sin(ph + q * 1.2566) * rad, shade(cc[0], sh * 1.08), y, Math.cos(ph + q * 1.2566), 0.3, Math.sin(ph + q * 1.2566)));
            for (let q = 0; q < 5; q++) { bk.ix.push(ring[(q + 1) % 5], ring[q], top); bk.ix.push(ring[q], ring[(q + 1) % 5], bot); }
            bk.ymax = Math.max(bk.ymax, y + h);
          }
          if (y < bk.ymin) bk.ymin = y;
        }
      }
    }
    let total = 0;
    for (let bi = 0; bi < buckets.length; bi++) {
      const bk = buckets[bi];
      if (!bk.ix.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bk.p), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bk.c), 3));
      g.setAttribute('aBaseY', new THREE.BufferAttribute(new Float32Array(bk.b), 1));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bk.n), 3, true));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(bk.ix), 1));
      const cs = (HALF * 2) / NB;
      const cx = -HALF + ((bi % NB) + 0.5) * cs, cz = -HALF + (Math.floor(bi / NB) + 0.5) * cs;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (bk.ymin + bk.ymax) / 2, cz), Math.hypot(cs * 0.71, (bk.ymax - bk.ymin) / 2) + 40);
      const m = new THREE.Mesh(g, treeMat);
      m.matrixAutoUpdate = false; m.name = 'trees';
      m.userData.cx = cx; m.userData.cz = cz;
      group.add(m);
      treeMeshes.push(m);
      total += bk.ix.length / 3;
    }
    return total;
  }
  const treeTris = buildTrees();

  // ======================= ГОРОД И ПОСЁЛКИ =======================
  function town(B, D, t, o) {
    const r = mulberry32(o.seed);
    const cs = Math.cos(o.rot), sn = Math.sin(o.rot);
    const step = o.block, n = Math.ceil(t.r / step) + 1;
    for (let gj = -n; gj <= n; gj++) {
      for (let gi = -n; gi <= n; gi++) {
        const lx = gi * step, lz = gj * step;
        const px = t.x + cs * lx - sn * lz, pz = t.z + sn * lx + cs * lz;
        const dist = Math.hypot(lx, lz) / t.r;
        if (dist > 0.82 + 0.3 * fbm2(px / 500, pz / 500, 2, o.seed)) continue;
        const hs = [H(px - 45, pz - 45), H(px + 45, pz - 45), H(px - 45, pz + 45), H(px + 45, pz + 45)];
        const hmin = Math.min(...hs), hmax = Math.max(...hs);
        if (hmin < 2.2 || hmax - hmin > 14) continue;
        let apt = false;
        for (const a of AIRPORTS) if (a.kind !== 'carrier' && Math.hypot(px - a.x, pz - a.z) < a.radius - 700) for (const f of a.flat) {
          const dx = px - f.cx, dz = pz - f.cz;
          if (Math.abs(dx * f.ux + dz * f.uz) < f.hl + 60 && Math.abs(dx * -f.uz + dz * f.ux) < f.hw + 60) apt = true;
        }
        if (apt) continue;
        const core = clamp(1 - dist, 0, 1) * o.rise;
        const base = hmin - 1.5, top = hmax + 0.4 - base;
        // квартал: асфальт + двор
        D.setFrame(px, 0, pz, o.rot + Math.PI / 2);
        const q = step / 2, qi = q - o.street / 2;
        const cor = (sx, sz, m) => { const wx = px + cs * sx * m - sn * sz * m, wz = pz + sn * sx * m + cs * sz * m; return [wx - px, H(wx, wz) + 0.45, wz - pz]; };
        const fr = D.cs; D.cs = 1; const fs = D.sn; D.sn = 0;
        D.quad(cor(-1, 1, q), cor(1, 1, q), cor(1, -1, q), cor(-1, -1, q), C.block);
        const parkB = r() < 0.07;
        const yc = parkB ? C.park : core < 0.3 && r() < 0.75 ? shade(C.garden, 0.85 + r() * 0.3) : shade(C.yard, 0.9 + r() * 0.2);
        const c2 = (sx, sz) => { const v = cor(sx, sz, qi); v[1] += 0.25; return v; };
        D.quad(c2(-1, 1), c2(1, 1), c2(1, -1), c2(-1, -1), yc);
        D.cs = fr; D.sn = fs;
        if (r() < 0.55) lights.add(px + cs * q - sn * q, H(px, pz) + 9, pz + sn * q + cs * q, core > 0.5 ? LC.WHITE : LC.ORANGE, 3.2, 0, 0, 0);
        if (parkB) continue;
        B.setFrame(px, base, pz, o.rot);
        const lot = step - o.street - 8;
        if (core > 0.62 && o.rise > 0.8) {
          // высотки
          const nb = r() < 0.5 ? 1 : 2;
          for (let b = 0; b < nb; b++) {
            const w = lot * (nb === 1 ? 0.62 : 0.4) * (0.8 + r() * 0.3), d = lot * (0.5 + r() * 0.3);
            const hgt = (38 + 95 * Math.pow(r(), 1.6) * core) * (0.8 + core * 0.5);
            const col = pick(C.tower, r());
            const bx = nb === 1 ? 0 : (b - 0.5) * lot * 0.5, bz = (r() - 0.5) * lot * 0.2;
            B.box(bx, 0, bz, w, top + hgt, d, col, { win: true, top: pick(C.roofsFlat, r()) });
            if (r() < 0.6) B.box(bx, top + hgt, bz, w * 0.4, 5, d * 0.4, shade(col, 0.8));
            if (hgt > 85) { const p = { x: px + cs * bx - sn * bz, z: pz + sn * bx + cs * bz }; lights.add(p.x, base + top + hgt + 6, p.z, LC.RED, 3, 3, r(), 0.3); }
          }
        } else if (core > 0.3 && o.rise > 0.5) {
          // среднеэтажные
          for (let b = 0; b < 4; b++) {
            if (r() < 0.2) continue;
            const w = lot * 0.4 * (0.7 + r() * 0.35), d = lot * 0.4 * (0.7 + r() * 0.35), hgt = 12 + r() * 22 * (0.5 + core);
            const col = pick(C.wall, r());
            B.box(((b % 2) - 0.5) * lot * 0.5, 0, (Math.floor(b / 2) - 0.5) * lot * 0.5, w, top + hgt, d, col, { win: true, top: r() < 0.3 ? pick(C.roof, r()) : pick(C.roofsFlat, r()) });
          }
        } else {
          // частные дома с двускатными крышами
          const nx = o.houses, cell = lot / nx;
          for (let b = 0; b < nx * nx; b++) {
            if (r() < 0.34) continue;
            const hx = ((b % nx) - (nx - 1) / 2) * cell + (r() - 0.5) * 4, hz = (Math.floor(b / nx) - (nx - 1) / 2) * cell + (r() - 0.5) * 4;
            const w = cell * (0.5 + r() * 0.22), d = cell * (0.36 + r() * 0.14), hgt = 4.5 + r() * 3, yaw = r() < 0.5 ? 0 : Math.PI / 2;
            const col = pick(C.wall, r()), rc = o.roofs ? pick(o.roofs, r()) : pick(C.roof, r());
            B.box(hx, 0, hz, w, top + hgt, d, col, { yaw, win: true });
            B.roof(hx, top + hgt, hz, w + 1.5, d + 1.5, d * 0.42, rc, yaw, col);
          }
        }
      }
    }
  }

  // дорога-лента по рельефу (над водой не рисуется)
  function road(D, pts, w, col = C.road) {
    D.setFrame(0, 0, 0, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 40));
      const nx = (-(bz - az) / len) * w * 0.5, nz = ((bx - ax) / len) * w * 0.5;
      for (let s = 0; s < n; s++) {
        const x0 = lerp(ax, bx, s / n), z0 = lerp(az, bz, s / n), x1 = lerp(ax, bx, (s + 1) / n), z1 = lerp(az, bz, (s + 1) / n);
        const y00 = H(x0 - nx, z0 - nz), y01 = H(x0 + nx, z0 + nz), y10 = H(x1 - nx, z1 - nz), y11 = H(x1 + nx, z1 + nz);
        if (Math.min(y00, y01, y10, y11) < 0.6) continue;
        D.quad([x0 - nx, y00 + 0.7, z0 - nz], [x0 + nx, y01 + 0.7, z0 + nz], [x1 + nx, y11 + 0.7, z1 + nz], [x1 - nx, y10 + 0.7, z1 - nz], col);
      }
    }
  }

  const P = POI_BY_ID;
  // ---------- город Ясный + мост ----------
  {
    const B = new Builder(true), D = new Builder();
    town(B, D, TOWNS[0], { seed: 41, rot: 0.26, block: 132, street: 24, rise: 1, houses: 3 });
    // Большой мост
    const bz = P.bridge.z;
    let xa = P.bridge.x, xb = P.bridge.x;
    while (H(xa, bz) < 5 && xa > P.bridge.x - 2500) xa -= 20;
    while (H(xb, bz) < 5 && xb < P.bridge.x + 2500) xb += 20;
    const DY = 40, span = xb - xa, mid = (xa + xb) / 2;
    B.setFrame(0, 0, 0, 0);
    B.box(mid, DY - 3, bz, span + 160, 3, 24, C.red, { bottom: true, top: C.road });
    for (const e of [-1, 1]) {
      const x0 = e < 0 ? xa - 80 : xb + 80, x1 = x0 + e * 420, y1 = H(x1, bz) + 0.5;
      const a = [x0, DY, bz - 12], b = [x0, DY, bz + 12], c = [x1, y1, bz + 12], d = [x1, y1, bz - 12];
      if (e < 0) B.quad(d, c, b, a, C.road); else B.quad(a, b, c, d, C.road);
      const g0 = H(x0, bz) - 2;
      for (const sz of [-12, 12]) {
        const t = [x0, DY, bz + sz], u = [x0, g0, bz + sz], v = [x1, y1 - 3, bz + sz], w = [x1, y1, bz + sz];
        if ((e < 0) === (sz < 0)) B.quad(t, u, v, w, C.concrete); else B.quad(w, v, u, t, C.concrete);
      }
      B.quad([x0, DY, bz - 12 * e], [x0, DY, bz + 12 * e], [x0, g0, bz + 12 * e], [x0, g0, bz - 12 * e], C.concreteDark);
      // пилон
      const tx = mid + e * span * 0.27, TH = 132;
      for (const sz of [-14, 14]) B.box(tx, 0, bz + sz, 7, TH, 7, C.red, { taper: 0.25 });
      for (const yy of [DY + 22, 96, TH - 6]) B.box(tx, yy, bz, 5, 5, 28, C.red, { bottom: true });
      for (const sz of [-13, 13]) {
        lights.add(tx, TH + 3, bz + sz, LC.RED, 4, 3, 0.2, 0.4);
        // тросы: от пилона к середине и к берегу
        const N = 7;
        let prev = [tx, TH, bz + sz];
        for (let i = 1; i <= N; i++) {
          const k = i / N, x = lerp(tx, mid, k), y = DY + 4 + (TH - DY - 4) * (1 - k) * (1 - k);
          const cur = [x, y, bz + sz];
          B.beam(prev, cur, 1.1, C.red);
          if (i < N) B.box(x, DY, bz + sz, 0.5, y - DY, 0.5, C.red);
          prev = cur;
        }
        prev = [tx, TH, bz + sz];
        const xe = e < 0 ? xa - 70 : xb + 70;
        for (let i = 1; i <= 4; i++) {
          const k = i / 4, x = lerp(tx, xe, k), y = DY + 1 + (TH - DY - 1) * (1 - k) * (1 - k);
          const cur = [x, y, bz + sz];
          B.beam(prev, cur, 1.1, C.red);
          if (i < 4) B.box(x, DY, bz + sz, 0.5, y - DY, 0.5, C.red);
          prev = cur;
        }
      }
    }
    for (let x = xa - 60; x <= xb + 60; x += 55) for (const sz of [-11, 11]) lights.add(x, DY + 8, bz + sz, LC.WARM, 2.6, 0, 0, 0);
    // дороги
    const ya = AIRPORTS[0], yt = ya.plan.terminal;
    road(D, [[yt.u + 0, ya.z + yt.v + 130], [300, 3300], [1100, 4300], [2200, 5000], [3600, 5900], [xa - 500, bz]], 16);
    road(D, [[xb + 500, bz], [7600, 7600], [9200, 8800], [10600, 10250], [11600, 10650], [12500, 10700]], 14);
    road(D, [[2200, 5000], [1500, 6400], [300, 7000]], 12);
    road(D, [[300, 3300], [-2500, 3600], [-5200, 2400], [-6800, 300]], 12);
    addMesh(D, mats.decal, 'city-ground', 1);
    addMesh(B, mats.building, 'city');
  }

  // ---------- Тихая Гавань: посёлок и порт ----------
  {
    const B = new Builder(true), D = new Builder();
    town(B, D, TOWNS[1], { seed: 57, rot: -0.2, block: 96, street: 18, rise: 0.45, houses: 2 });
    let pz = P.port_gavan.z;
    const px = P.port_gavan.x;
    while (H(px, pz) > 0.5 && pz < P.port_gavan.z + 1500) pz += 15;
    B.setFrame(px, 0, pz, 0);
    B.box(0, 0, -15, 460, 3.6, 110, C.concrete, { top: shade(C.concrete, 1.05) });
    B.box(-150, 0, 150, 16, 3.2, 250, C.concreteDark);
    B.box(120, 0, 120, 14, 3.2, 190, C.concreteDark);
    for (let i = 0; i < 3; i++) {
      const x = -110 + i * 105, col = i === 1 ? C.yellow : C.orange;
      for (const sx of [-11, 11]) for (const sz of [10, 34]) B.box(x + sx, 3.6, sz, 2.2, 38, 2.2, col);
      B.box(x, 41.6, 22, 26, 5, 30, col, { bottom: true });
      B.box(x, 46, 40, 5, 4, 96, col, { bottom: true });
      B.box(x, 50, 14, 8, 12, 8, C.white, { win: true });
      lights.add(px + x, 62, pz + 14, LC.RED, 3, 0, 0, 0.3);
      lights.add(px + x, 46, pz + 60, LC.WARM, 6, 0, 0, 0.03);
    }
    const cc = [C.red, C.blue, C.green, C.orange, C.white, C.yellow, lin('#7a4a8a')];
    for (let i = 0; i < 54; i++) {
      const cxx = -190 + (i % 9) * 15.5 + (i % 9 > 4 ? 190 : 0), cz = -50 + (Math.floor(i / 9) % 3) * 9, lv = Math.floor(i / 27);
      if (r2() < 0.2) continue;
      B.box(cxx, 3.6 + lv * 5, cz, 14, 5, 5.2, pick(cc, r2()));
    }
    for (let i = 0; i < 3; i++) { B.box(-160 + i * 90, 3.6, -52 - 0, 60, 9, 26, pick(C.wall, r2()), { win: true }); B.roof(-160 + i * 90, 12.6, -52, 62, 28, 6, C.roof[4], 0); }
    for (let i = 0; i < 4; i++) B.cyl(170 + (i % 2) * 22, 3.6, -40 + Math.floor(i / 2) * 22, 9, 9, 12, 10, C.white, { top: C.steel });
    addMesh(D, mats.decal, 'gavan-ground', 1);
    addMesh(B, mats.building, 'gavan');
    world.poiById.port_gavan.quayZ = pz;
  }
  function r2() { return rnd(); }

  // ---------- корабли, лодки, айсберги, буровая (один меш «на море») ----------
  const wakes = new Builder();
  function wake(x, z, hdg, w, len) {
    wakes.setFrame(x, 0.3, z, hdg);
    const a = [0.55, 0.55, 0.55], b = [0, 0, 0];
    const v = (px, pz, c) => { wakes._v(px, 0, pz, c); };
    // центральная пена
    v(-w, 0, a); v(w, 0, a); v(w * 1.5, len * 0.5, b); v(-w, 0, a); v(w * 1.5, len * 0.5, b); v(-w * 1.5, len * 0.5, b);
    for (const s of [-1, 1]) {
      const m = [0.6, 0.6, 0.6];
      v(s * w * 0.9, -len * 0.03, m); v(s * (w * 1.4 + len * 0.2), len, b); v(s * (w * 1.1 + len * 0.178), len, b);
    }
  }
  function ship(B, x, z, hdg, kind, moving) {
    B.setFrame(x, 0, z, hdg);
    const hc = pick(C.hull, rnd());
    const hull = (L, w, h, col, deckCol) => {
      const o = [[-L / 2, -w], [-L / 2, w], [L * 0.28, w], [L / 2, 0], [L * 0.28, -w]];
      const Q = (q, y, k = 1) => [q[1] * k, y, -q[0] * (k < 1 ? 0.97 : 1)];
      for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; B.quad(Q(o[i], 0, 0.8), Q(o[j], 0, 0.8), Q(o[j], h), Q(o[i], h), col); B.tri([0, h, 0], Q(o[i], h), Q(o[j], h), deckCol); }
    };
    if (kind === 'cargo') {
      const L = 150 + rnd() * 60, w = 13;
      hull(L, w, 9, hc, shade(C.steel, 0.8));
      B.box(0, 9, L / 2 - 22, w * 1.7, 16, 18, C.white, { win: true });
      B.cyl(0, 25, L / 2 - 18, 3, 2.4, 7, 6, C.red, { top: C.dark });
      const cc = [C.red, C.blue, C.green, C.orange, C.white];
      for (let i = 0; i < 7; i++) for (let k = 0; k < 2; k++) if (rnd() > 0.15) B.box((k - 0.5) * w * 0.9, 9, L / 2 - 46 - i * 15.5, w * 0.8, 5 + ((rnd() * 2) | 0) * 5, 14, pick(cc, rnd()));
      const p = B_w(B, 0, L / 2 - 22);
      lights.add(p.x, 30, p.z, LC.WHITE, 4, 0, 0, 0.05);
      const pb = B_w(B, 0, -L / 2 + 6);
      lights.add(pb.x, 12, pb.z, LC.RED, 2.5, 0, 0, 0.05);
      if (moving) wake(B_w(B, 0, L / 2).x, B_w(B, 0, L / 2).z, hdg, w * 0.9, 520);
    } else if (kind === 'fish') {
      hull(26, 4, 3.4, pick([C.white, C.blue, C.red, C.green], rnd()), C.wood);
      B.box(0, 3.4, 5, 5, 4, 7, C.white, { win: true });
      B.box(0, 7.4, 3, 0.4, 8, 0.4, C.dark);
      const p = B_w(B, 0, 5);
      lights.add(p.x, 9, p.z, LC.WARM, 3, 0, 0, 0.03);
      if (moving) wake(B_w(B, 0, 13).x, B_w(B, 0, 13).z, hdg, 3, 150);
    } else {
      hull(15, 2.4, 1.8, C.white, C.wood);
      B.box(0, 1.8, -1, 0.3, 19, 0.3, C.steel);
      const s0 = [0, 3, -1.2], s1 = [0, 20, -1.2], s2 = [0, 3, 6.5], j0 = [0, 3, -1.6], j1 = [0, 17, -1.6], j2 = [0, 2.4, -7];
      B.tri(s0, s1, s2, C.white); B.tri(s0, s2, s1, C.white); B.tri(j0, j2, j1, pick([C.white, C.red, C.orange], rnd())); B.tri(j0, j1, j2, C.white);
    }
  }
  const B_w = (B, x, z) => ({ x: B.ox + B.cs * x - B.sn * z, z: B.oz + B.sn * x + B.cs * z });
  {
    const B = new Builder(true);
    const sea = (x, z) => H(x, z) < -20;
    const lanes = [[-3000, 11000, 1.9, 'cargo'], [8500, 13800, 1.2, 'cargo'], [16500, 3500, 0.3, 'cargo'], [-17000, 1500, 3.5, 'cargo'], [9000, -19000, 1.6, 'cargo'], [-6000, 19500, 4.6, 'cargo'], [24500, 12500, 2.9, 'cargo'], [-22000, -12000, 0.8, 'cargo']];
    for (const l of lanes) if (sea(l[0], l[1])) ship(B, l[0], l[1], l[2], l[3], true);
    // пришвартованный сухогруз у причала порта
    ship(B, P.port_gavan.x - 130, (P.port_gavan.quayZ || P.port_gavan.z) + 150, 0, 'cargo', false);
    const spots = [[13300, 12300, 26, 'fish'], [12200, 12600, 20, 'fish'], [3500, 8300, 14, 'sail'], [4700, 8600, 10, 'fish'], [22300, 24000, 18, 'sail'], [20800, 25400, 8, 'sail'], [16000, 24500, 8, 'sail'], [-9000, 16900, 6, 'fish'], [7200, 5200, 8, 'sail'], [14500, 12800, 8, 'fish'], [-1500, 9000, 8, 'sail'], [-12500, -6300, 4, 'fish']];
    for (const s of spots) {
      const n = Math.ceil(s[2] / 3.5);
      for (let i = 0; i < n; i++) {
        const x = s[0] + (rnd() - 0.5) * 1700, z = s[1] + (rnd() - 0.5) * 1700;
        if (H(x, z) > -3) continue;
        ship(B, x, z, rnd() * 6.28, s[3], s[3] === 'fish' && rnd() < 0.5);
      }
    }
    // айсберги на севере
    B.setFrame(0, 0, 0, 0);
    for (let i = 0; i < 26; i++) {
      const x = -22000 + rnd() * 44000, z = -31000 + rnd() * 9500;
      if (H(x, z) > -15) continue;
      const s = 40 + rnd() * 110;
      B.blob(x, s * 0.08, z, s, s * (0.3 + rnd() * 0.5), s * (0.6 + rnd() * 0.6), rnd() < 0.3 ? C.iceBlue : C.ice, i + 1, -0.15);
      if (rnd() < 0.5) B.blob(x + s * 0.7, 2, z + s * 0.3, s * 0.4, s * 0.2, s * 0.4, C.ice, i + 40, -0.15);
    }
    // буровая платформа
    {
      const x = P.oilrig.x, z = P.oilrig.z;
      B.setFrame(x, 0, z, 0.4);
      for (const sx of [-26, 26]) for (const sz of [-22, 22]) B.cyl(sx, 0, sz, 4.5, 4.5, 30, 8, C.rig);
      B.box(0, 30, 0, 74, 7, 62, C.steel, { bottom: true, top: shade(C.steel, 0.8) });
      B.box(-18, 37, -10, 30, 12, 26, C.white, { win: true });
      B.box(14, 37, 14, 26, 8, 20, C.rig, { win: true });
      B.box(18, 37, -14, 13, 62, 13, C.red, { taper: 0.75 });
      B.box(18, 99, -14, 4, 5, 4, C.white);
      B.cyl(-34, 44, 26, 14, 14, 1.2, 8, C.green, { top: lin('#2f6a45') });
      B.beam([34, 38, 28], [78, 62, 60], 1.6, C.steel);
      B.beam([-30, 49, -22], [-62, 66, -40], 1.4, C.yellow);
      const f = B_w(B, 78, 60);
      lights.add(f.x, 64, f.z, LC.ORANGE, 26, 3, 0, 0.9);
      lights.add(f.x, 64, f.z, LC.YEL, 14, 0, 0, 0.7);
      const t = B_w(B, 18, -14);
      lights.add(t.x, 106, t.z, LC.RED, 4, 3, 0.4, 0.4);
      for (const sx of [-36, 36]) for (const sz of [-30, 30]) { const p = B_w(B, sx, sz); lights.add(p.x, 39, p.z, LC.WARM, 5, 0, 0, 0.04); }
    }
    wake(CARRIER.x - Math.sin(CARRIER.heading) * 150, CARRIER.z + Math.cos(CARRIER.heading) * 150, CARRIER.heading, 17, 620);
    addMesh(B, mats.building, 'ships').frustumCulled = false;
  }
  const wakeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const wakeMesh = addMesh(wakes, wakeMat, 'wakes', 3);
  if (wakeMesh) wakeMesh.frustumCulled = false;

  // ---------- ориентиры на суше ----------
  let beam = null;
  {
    const B = new Builder(true), D = new Builder();
    // маяк
    {
      const x = P.lighthouse.x, z = P.lighthouse.z, y = H(x, z);
      B.setFrame(x, y - 1, z, 0.5);
      for (let i = 0; i < 5; i++) B.cyl(0, 1 + i * 7.4, 0, 5.2 - i * 0.38, 4.82 - i * 0.38, 7.4, 8, i % 2 ? C.red : C.white, { open: true });
      B.cyl(0, 38, 0, 5.2, 5.2, 1, 8, C.dark);
      B.cyl(0, 39, 0, 2.8, 2.8, 4.2, 8, lin('#ffe9a8'));
      B.cyl(0, 43.2, 0, 3.6, 0, 3.4, 8, C.red);
      B.box(14, 1, 6, 12, 5, 9, C.white, { win: true });
      B.roof(14, 6, 6, 13.5, 10.5, 3.6, C.roof[0], 0);
      lights.add(x, y + 40.5, z, LC.WHITE, 16, 0, 0, 0.5);
      // вращающийся луч
      const L = 3000, R = 85, seg = 8, pos = [], al = [];
      for (const dir of [-1, 1]) for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * 6.283, a1 = ((i + 1) / seg) * 6.283;
        pos.push(0, 0, 0, dir * L, Math.cos(a0) * R, Math.sin(a0) * R, dir * L, Math.cos(a1) * R, Math.sin(a1) * R);
        al.push(1, 0, 0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(al), 1));
      beam = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: { uOp: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform float uOp; varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0, 0.95, 0.8) * vA * vA * uOp, 1.0); }',
      }));
      beam.position.set(x, y + 40.5, z);
      beam.renderOrder = 15;
      beam.name = 'lighthouse-beam';
      group.add(beam);
    }
    // плотина: дуга поперёк ущелья, выпуклостью к водохранилищу
    {
      B.setFrame(LAKE.damX, 0, LAKE.damZ, (135 * Math.PI) / 180);
      const top = LAKE.level + 7, N = 12, Wd = 330;
      const zc = (x) => -12 - 22 * (1 - (x / Wd) * (x / Wd));
      for (let i = 0; i < N; i++) {
        const xA = -Wd + (2 * Wd * i) / N, xB = -Wd + (2 * Wd * (i + 1)) / N;
        const zA = zc(xA), zB = zc(xB);
        const bot = Math.max(8, Math.min(H(B_w(B, xA, zA + 20).x, B_w(B, xA, zA + 20).z), H(B_w(B, xB, zB + 20).x, B_w(B, xB, zB + 20).z)) - 12);
        const th = 10 + (top - bot) * 0.22;
        const spill = i >= 5 && i <= 6;
        B.quad([xA, top, zA + 10], [xB, top, zB + 10], [xB, top, zB], [xA, top, zA], C.road);
        B.quad([xA, top, zA], [xB, top, zB], [xB, bot, zB], [xA, bot, zA], C.concreteDark);
        B.quad([xB, top, zB + 10], [xA, top, zA + 10], [xA, bot, zA + th], [xB, bot, zB + th], spill ? C.water : i % 2 ? C.concrete : shade(C.concrete, 0.94));
        if (i % 2 === 0) { const p = B_w(B, xA, zA + 5); lights.add(p.x, top + 6, p.z, LC.WARM, 3.5, 0, 0, 0); }
      }
      B.box(-60, 22, 110, 70, 16, 26, C.concrete, { win: true, top: C.roofFlat });
    }
    // обсерватория
    {
      const x = P.observatory.x, z = P.observatory.z, y = H(x, z) - 1;
      B.setFrame(x, y, z, 0.7);
      B.cyl(0, 0, 0, 11, 11, 9, 10, C.white);
      B.blob(0, 9, 0, 11.6, 11.6, 11.6, lin('#f6f8fa'), 2, 0);
      B.box(0, 12, 7, 3, 9, 9, C.dark);
      B.cyl(34, 0, 12, 7, 7, 6, 8, C.white);
      B.blob(34, 6, 12, 7.4, 7.4, 7.4, lin('#f6f8fa'), 4, 0);
      B.box(16, 0, -20, 32, 6, 12, C.wall[2], { win: true, top: C.roofFlat });
      B.box(-22, 0, -14, 0.6, 26, 0.6, C.red);
      lights.add(x - 22, y + 27, z - 14, LC.RED, 3.5, 3, 0, 0.4);
    }
    addMesh(D, mats.decal, 'landmarks-ground', 1);
    addMesh(B, mats.building, 'landmarks').frustumCulled = false;
  }
  // ---------- курорт Южный ----------
  {
    const B = new Builder(true), D = new Builder();
    town(B, D, TOWNS[2], { seed: 73, rot: 0.5, block: 92, street: 16, rise: 0.4, houses: 2, roofs: [C.roof[0], C.roof[2], C.thatch, C.white] });
    const x = P.resort.x, z = P.resort.z, y = H(x, z) - 1;
    B.setFrame(x, y, z, 0.6);
    for (let i = 0; i < 3; i++) {
      const hx = -70 + i * 70, hh = 34 + (i === 1 ? 22 : 0);
      B.box(hx, 0, 0, 44, hh, 20, C.white, { win: true, top: C.wall[1] });
      B.box(hx, hh, 0, 30, 7, 14, C.wall[1], { win: true, top: C.roof[2] });
    }
    D.setFrame(x, y + 1.6, z, 0.6);
    D.rect(0, 50, 190, 46, 0, lin('#d8cdb4'));
    D.rect(-20, 50, 60, 22, 0.15, C.pool);
    D.rect(60, 52, 30, 16, 0.15, C.pool);
    // бунгало на сваях над лагуной
    let sx = x, sz = z;
    const dir = { x: 0.78, z: 0.62 };
    while (H(sx, sz) > 0.3 && Math.hypot(sx - x, sz - z) < 2500) { sx += dir.x * 15; sz += dir.z * 15; }
    const hd = Math.atan2(dir.x, -dir.z);
    B.setFrame(sx, 0, sz, hd);
    B.box(0, 1.6, -150, 4, 0.6, 330, C.wood, { bottom: true });
    for (let i = 0; i < 12; i++) {
      const zz = -60 - Math.floor(i / 2) * 44, xx = (i % 2 ? 1 : -1) * 15;
      B.box(xx, 2.2, zz, 11, 4, 11, C.wall[3], { bottom: true });
      B.cyl(xx, 6.2, zz, 9.5, 0, 6, 6, C.thatch);
      B.box(xx * 0.45, 1.6, zz, 14, 0.5, 2.4, C.wood, { bottom: true });
      for (const q of [-4, 4]) B.box(xx + q, 0, zz + q, 0.7, 2.2, 0.7, C.wood);
      const p = B_w(B, xx, zz);
      lights.add(p.x, 5, p.z, LC.WARM, 3.2, 0, 0, 0);
    }
    addMesh(D, mats.decal, 'resort-ground', 1);
    addMesh(B, mats.building, 'resort');
  }
  // ---------- полярная станция ----------
  {
    const B = new Builder(true), D = new Builder();
    const x = P.station_north.x, z = P.station_north.z, y = H(x, z) - 0.5;
    B.setFrame(x, y, z, 0.3);
    const cols = [C.orange, C.red, C.blue, C.orange, C.yellow, C.red];
    for (let i = 0; i < 6; i++) {
      const mx = (i % 3) * 30 - 30, mz = Math.floor(i / 3) * 34 - 17;
      for (const q of [-9, 9]) B.box(mx + q, 0, mz, 1, 3, 1, C.steel);
      B.box(mx, 3, mz, 24, 7, 10, cols[i], { win: true, bottom: true, top: C.white });
      lights.add(B_w(B, mx, mz + 7).x, y + 8, B_w(B, mx, mz + 7).z, LC.WARM, 3.5, 0, 0, 0.05);
    }
    B.blob(60, 6, -20, 10, 10, 10, C.white, 8, -0.6);
    B.box(60, 0, -20, 8, 4, 8, C.steel);
    B.box(-58, 0, 24, 0.7, 40, 0.7, C.red);
    for (let i = 0; i < 4; i++) B.cyl(52 + (i % 2) * 14, 0, 26 + Math.floor(i / 2) * 14, 5, 5, 7, 8, C.white, { top: C.steel });
    lights.add(B_w(B, -58, 24).x, y + 41, B_w(B, -58, 24).z, LC.RED, 4, 3, 0.1, 0.4);
    D.setFrame(x, y + 1.1, z, 0.3);
    D.rect(-10, 70, 30, 30, 0, C.block);
    D.rect(-10, 70, 3, 16, 0.1, C.white); D.rect(-10, 70, 12, 3, 0.1, C.white);
    addMesh(D, mats.decal, 'station-ground', 1);
    addMesh(B, mats.building, 'station');
  }

  // ---------- дым вулкана ----------
  const NS = 14;
  const vp = P.volcano;
  const vy = H(vp.x, vp.z) + 40;
  const sg = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = sg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const h = Math.sin(p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719) * 43758.5453;
      const k = 0.8 + 0.4 * (h - Math.floor(h));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    sg.computeVertexNormals();
  }
  const smokeMat = patchMaterial(new THREE.MeshLambertMaterial({ color: '#8d8a88' }));
  const smoke = new THREE.InstancedMesh(sg, smokeMat, NS);
  smoke.frustumCulled = false;
  smoke.name = 'volcano-smoke';
  group.add(smoke);
  lights.add(vp.x, vy - 20, vp.z, LC.ORANGE, 60, 0, 0, 0.12);
  lights.add(vp.x + 90, vy - 30, vp.z - 60, LC.RED, 36, 3, 0.3, 0.1);
  lights.add(vp.x - 110, vy - 30, vp.z + 40, LC.ORANGE, 30, 3, 0.7, 0.1);

  let t = 0;
  const _m = new THREE.Matrix4();
  function update(dt, cam) {
    t += dt;
    // дым: клубы поднимаются и сносятся ветром
    const w = world.wind;
    for (let i = 0; i < NS; i++) {
      const k = (t * 0.022 + i / NS) % 1;
      const s = (70 + 330 * k) * Math.min(1, k * 8) * (1 - smoothstep(0.82, 1, k));
      const rise = 1700 * Math.pow(k, 0.75), drift = 190 * k * k;
      const e = _m.elements;
      const a = i * 2.4 + k * 2;
      const c = Math.cos(a) * s, sn = Math.sin(a) * s;
      e[0] = c; e[1] = 0; e[2] = -sn; e[3] = 0; e[4] = 0; e[5] = s * 0.85; e[6] = 0; e[7] = 0; e[8] = sn; e[9] = 0; e[10] = c; e[11] = 0;
      e[12] = vp.x + w.x * drift + Math.sin(i * 7.1) * 60 * k; e[13] = vy + rise; e[14] = vp.z + w.z * drift + Math.cos(i * 5.3) * 60 * k; e[15] = 1;
      smoke.setMatrixAt(i, _m);
    }
    smoke.instanceMatrix.needsUpdate = true;
    // луч маяка
    if (beam) {
      beam.rotation.y = t * 0.55;
      const op = smoothstep(0.3, 0.9, env.lightsOn) * 0.6;
      beam.visible = op > 0.01;
      beam.material.uniforms.uOp.value = op;
    }
    // кильватерные следы светлеют/темнеют вместе с дневным светом
    const l = (0.006 + 0.04 * env.daylight) * (1 - env.inCloud);
    wakeMat.color.setRGB(l, l, l);
    // деревья: дальние блоки не рисуем
    const R = U.uTreeR.value.y + 5800;
    for (let i = 0; i < treeMeshes.length; i++) {
      const m = treeMeshes[i];
      const dx = m.userData.cx - cam.position.x, dz = m.userData.cz - cam.position.z;
      m.visible = dx * dx + dz * dz < R * R;
    }
  }
  void ISLE; void ISLETS; void headingVec;
  return { update, rebuildTrees: buildTrees, treeTris };
}
