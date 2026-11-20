// Аэродромы: полосы с разметкой, рулёжки, перроны, постройки, огни (кромка, подход, пороги, PAPI), ветроуказатели.
// Авианосец «Буревестник». Всё слито в 2–3 меша на аэродром (покрытие, разметка, постройки).
import * as THREE from 'three';
import { headingVec, DEG, clamp, smoothstep } from '../core/util.js';
import { AIRPORTS, CARRIER, runwayPoint } from './layout.js';
import { Builder, drawNumber } from './geo.js';
import { lin } from './env.js';

export const LC = {
  WHITE: [1, 0.93, 0.76], YEL: [1, 0.7, 0.2], GRN: [0.15, 1, 0.4], RED: [1, 0.1, 0.06], BLUE: [0.22, 0.42, 1], WARM: [1, 0.78, 0.48], COOL: [0.8, 0.9, 1], ORANGE: [1, 0.55, 0.2],
};
const C = {
  asph: lin('#3a3d43'), asphDark: lin('#2c2e33'), shoulder: lin('#55585c'), taxi: lin('#46494f'), apron: lin('#7c7e7f'), apronMil: lin('#6b6f68'),
  dirt: lin('#b39664'), dirtDark: lin('#97794e'), gravel: lin('#8f877b'), gravelDark: lin('#787066'),
  white: lin('#f2f2ee'), yellow: lin('#f0c23a'),
  wall: lin('#e9e5db'), wall2: lin('#d6d9de'), roof: lin('#66788c'), roofRed: lin('#b5553c'), glass: lin('#3f5f7c'), metal: lin('#a9b3bd'), metalDark: lin('#7e8994'),
  dark: lin('#24272c'), red: lin('#d8452e'), orange: lin('#ef7a2b'), olive: lin('#6b7352'), oliveDark: lin('#525a40'), earth: lin('#66784a'), concrete: lin('#a8a9a4'),
  hull: lin('#737e88'), hullDark: lin('#4d555d'), deck: lin('#444a51'), deckDark: lin('#34393f'), tank: lin('#eceee9'),
};
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export function createAirports(G, world, mats, lights) {
  const group = world.group;
  const rot = []; // вращающиеся антенны РЛС
  const socks = []; // {x, y, z}
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const gy = (x, z) => Math.max(0, world.heightAt(x, z));

  function runwayLights(a, rw, elev) {
    const L = rw.length, W = rw.width, d = headingVec(rw.heading);
    const strip = a.kind === 'strip', intl = a.kind === 'intl';
    const P = (u, v) => runwayPoint(rw, u, v);
    const y = elev + 0.7;
    const step = strip ? 75 : 60, es = intl ? 3 : strip ? 2 : 2.5;
    const n = Math.round(L / step);
    for (let i = 0; i <= n; i++) {
      const u = -L / 2 + (L * i) / n;
      for (const sv of [-1, 1]) { const p = P(u, sv * (W / 2 + 2)); lights.add(p.x, y, p.z, LC.WHITE, es, 0, 0, 0.22); }
    }
    if (!strip) for (let u = -L / 2 + 45; u < L / 2 - 30; u += 30) { const p = P(u, 0); lights.add(p.x, y - 0.4, p.z, LC.WHITE, 1.5, 0, 0, 0.0); }
    for (const e of [-1, 1]) {
      const ox = e * d.x, oz = e * d.z; // наружу от торца
      const nT = strip ? 5 : 9;
      for (let i = 0; i < nT; i++) {
        const v = -W / 2 + (W * i) / (nT - 1);
        const p = P(e * (L / 2 + 1), v);
        lights.add(p.x, y, p.z, LC.GRN, es * 1.25, 4, 0, 0.3, ox, oz);
        lights.add(p.x, y, p.z, LC.RED, es * 1.1, 4, 0, 0.2, -ox, -oz);
      }
      // огни подхода
      const Lapp = intl ? 900 : strip ? 0 : a.kind === 'military' ? 600 : 420;
      for (let s = 60; s <= Lapp; s += 60) {
        const nb = intl && s <= 300 ? 5 : 3;
        for (let i = 0; i < nb; i++) {
          const p = P(e * (L / 2 + s), (i - (nb - 1) / 2) * 4.5);
          lights.add(p.x, gy(p.x, p.z) + 2.2, p.z, LC.WHITE, intl ? 3.4 : 2.8, 0, 0, 0.3);
        }
        if (s === 300) {
          const nc = intl ? 14 : 8;
          for (let i = 0; i < nc; i++) {
            if (Math.abs(i - (nc - 1) / 2) < 1.6) continue;
            const p = P(e * (L / 2 + s), (i - (nc - 1) / 2) * 4.5);
            lights.add(p.x, gy(p.x, p.z) + 2.2, p.z, LC.WHITE, intl ? 3.4 : 2.8, 0, 0, 0.3);
          }
        }
        if (s >= 360 || (!intl && s >= 180)) {
          const p = P(e * (L / 2 + s), 0);
          lights.add(p.x, gy(p.x, p.z) + 3, p.z, LC.COOL, 6, 1, (Lapp - s) / Lapp, 0.7);
        }
      }
      // PAPI слева от полосы (по направлению захода)
      const sP = Math.min(320, L * 0.28);
      const glide = (a.id === 'gnezdo' ? 4 : 3) * DEG;
      for (let i = 0; i < 4; i++) {
        const p = P(e * (L / 2 - sP), e * (W / 2 + 14 + i * 9));
        lights.add(p.x, y + 0.5, p.z, LC.WHITE, 5.5, 2, 0, 1, ox, oz, glide + (0.5 - i / 3) * DEG);
      }
    }
  }

  function pavedRunway(D, M, a, rw, elev) {
    const L = rw.length, W = rw.width;
    D.setFrame(rw.cx, elev + 0.06, rw.cz, rw.heading);
    // полоса тремя продольными лентами: в зонах приземления по оси — тёмный налёт резины, по краям светлее
    const rubber = (d) => smoothstep(110, 300, d) * (1 - smoothstep(650, 1050, d));
    const cw = W * 0.46;
    for (let u = -L / 2; u < L / 2 - 1; u += 50) {
      const len = Math.min(50, L / 2 - u), um = u + len / 2;
      const rb = Math.max(rubber(um + L / 2), rubber(L / 2 - um)) * (0.7 + rnd() * 0.3);
      const k = 0.95 + rnd() * 0.1;
      D.rect(0, -um, cw, len, 0, shade(C.asph, k * (0.97 - 0.42 * rb)));
      for (const sv of [-1, 1]) D.rect(sv * (cw / 2 + (W - cw) / 4), -um, (W - cw) / 2, len, 0, shade(C.asph, k * (1.04 - 0.08 * rb)));
    }
    for (const sv of [-1, 1]) D.rect(sv * (W / 2 + 4), 0, 8, L, 0, C.shoulder);
    for (const e of [-1, 1]) D.rect(0, e * (L / 2 + 30), W + 16, 60, 0, C.asphDark);
    const big = W >= 45;
    for (const e of [-1, 1]) {
      M.setFrame(rw.cx, elev + 0.14, rw.cz, rw.heading + (e > 0 ? Math.PI : 0));
      // «зебра» порога
      const nk = Math.max(2, Math.floor((W / 2 - 4) / 3.6));
      const pitch = (W / 2 - 4) / nk;
      for (let k = 0; k < nk; k++) for (const sv of [-1, 1]) M.rect(sv * (2 + pitch * (k + 0.5)), L / 2 - 22, pitch * 0.6, 30, 0, C.white);
      // цифры
      const name = rw.name.split('/')[e < 0 ? 0 : 1];
      if (name && /^\d+$/.test(name)) drawNumber(M, name, 0, L / 2 - 62, big ? 24 : 17, 0, C.white);
      // осевая
      for (let s = 95; s < L / 2; s += 50) M.rect(0, L / 2 - s - 15, big ? 1.4 : 1.0, Math.min(30, L / 2 - s), 0, C.white);
      // зона приземления и точки прицеливания
      const sA = L > 1700 ? 320 : 210;
      for (const sv of [-1, 1]) {
        M.rect(sv * W * 0.2, L / 2 - sA, W * 0.12, 45, 0, C.white);
        for (let k = 0; k < 3; k++) M.rect(sv * (W * 0.13 + k * 3.4), L / 2 - 140, 1.9, 22, 0, C.white);
        if (L > 1700) { for (let k = 0; k < 2; k++) M.rect(sv * (W * 0.13 + k * 3.4), L / 2 - 470, 1.9, 22, 0, C.white); M.rect(sv * W * 0.13, L / 2 - 620, 1.9, 22, 0, C.white); }
      }
      // порог
      M.rect(0, L / 2 - 4, W - 4, 1.8, 0, C.white);
    }
    M.setFrame(rw.cx, elev + 0.14, rw.cz, rw.heading);
    for (const sv of [-1, 1]) M.rect(sv * (W / 2 - 1.6), 0, 0.9, L, 0, C.white);
  }

  function dirtRunway(D, M, a, rw, elev) {
    const L = rw.length, W = rw.width;
    const c0 = a.id === 'gnezdo' ? C.gravel : C.dirt, c1 = a.id === 'gnezdo' ? C.gravelDark : C.dirtDark;
    D.setFrame(rw.cx, elev + 0.06, rw.cz, rw.heading);
    for (let u = -L / 2; u < L / 2 - 1; u += 50) {
      const k = 0.94 + rnd() * 0.12;
      D.rect(0, -(u + 25), W, 50, 0, shade(c0, k));
      D.rect(-3.2, -(u + 25), 2.2, 50, 0.02, shade(c1, k));
      D.rect(3.2, -(u + 25), 2.2, 50, 0.02, shade(c1, k));
    }
    M.setFrame(rw.cx, elev + 0.16, rw.cz, rw.heading);
    for (let u = -L / 2; u <= L / 2 + 1; u += 50) for (const sv of [-1, 1]) M.rect(sv * (W / 2 + 1.5), -u, 2.4, 1.6, 0, C.white);
    for (const e of [-1, 1]) {
      M.rect(0, e * (L / 2 - 2), W, 2.2, 0, C.white);
      for (const sv of [-1, 1]) { M.rect(sv * (W / 2 + 4), e * (L / 2 + 1), 7, 2, 0, C.white); M.rect(sv * (W / 2 + 6.5), e * (L / 2 - 2.5), 2, 7, 0, C.white); }
    }
  }

  function tower(B, x, z, h, olive, a) {
    const w = olive ? C.olive : C.wall;
    B.cyl(x, 0, z, 3.4, 2.7, h - 7, 8, w);
    B.cyl(x, h - 7, z, 4.4, 6.4, 5.2, 8, C.glass, { top: C.roof });
    B.cyl(x, h - 1.8, z, 6.9, 5.2, 1.3, 8, olive ? C.oliveDark : C.roof);
    B.box(x, h - 0.6, z, 0.5, 8, 0.5, C.red);
    const p = B._w(x, z);
    lights.add(p.x, a.elevation + h + 1.2, p.z, LC.WHITE, 9, 3, 0, 0.5);
    lights.add(p.x, a.elevation + h + 1.2, p.z, LC.GRN, 9, 3, 0.5, 0.5);
    lights.add(p.x, a.elevation + h + 7.6, p.z, LC.RED, 3, 0, 0, 0.3);
  }

  function hangar(B, x, z, w, d, s, col, a) {
    B.arch(x, 0, z, w, d, w * 0.3, 7, col, { yaw: (-s * Math.PI) / 2, end: shade(col, 0.85), door: C.dark, side: shade(col, 0.9) });
    const p = B._w(x, z);
    lights.add(p.x, a.elevation + w * 0.3 + 1, p.z, LC.RED, 2.4, 0, 0, 0.2);
  }

  function build(a) {
    const rw = a.runways[0], elev = a.elevation, s = a.side, pl = a.plan;
    const D = new Builder(), M = new Builder(), B = new Builder(true);
    B._w = (x, z) => ({ x: B.ox + B.cs * x - B.sn * z, z: B.oz + B.sn * x + B.cs * z });
    const strip = a.kind === 'strip', mil = a.kind === 'military';
    for (const r of a.runways) {
      if (strip) dirtRunway(D, M, a, r, elev); else pavedRunway(D, M, a, r, elev);
      runwayLights(a, r, elev);
    }
    // рулёжки и перроны
    for (const r of a.aprons) {
      D.setFrame(r.cx, elev + 0.05, r.cz, r.heading);
      const col = strip ? shade(a.id === 'gnezdo' ? C.gravel : C.dirt, 0.92) : r.kind === 'taxi' ? C.taxi : mil ? C.apronMil : C.apron;
      D.rect(0, 0, r.hw * 2, r.hl * 2, 0, shade(col, 0.97 + rnd() * 0.06));
      if (strip) continue;
      M.setFrame(r.cx, elev + 0.13, r.cz, r.heading);
      if (r.kind === 'taxi') {
        const along = r.hl > r.hw;
        if (along) M.rect(0, 0, 0.9, r.hl * 2, 0, C.yellow); else M.rect(0, 0, r.hw * 2, 0.9, 0, C.yellow);
        // синие огни кромки рулёжки
        const d = headingVec(r.heading);
        const len = along ? r.hl : r.hw, wid = along ? r.hw : r.hl;
        for (let t = -len; t <= len; t += 55) for (const sv of [-1, 1]) {
          const lu = along ? t : sv * wid, lv = along ? sv * wid : t;
          lights.add(r.cx + d.x * lu - d.z * lv, elev + 0.5, r.cz + d.z * lu + d.x * lv, LC.BLUE, 1.5, 0, 0, 0);
        }
      } else {
        // прожекторные мачты по дальнему краю перрона
        const d = headingVec(r.heading);
        const vFar = Math.abs(r.v0) > Math.abs(r.v1) ? r.v0 : r.v1;
        B.setFrame(rw.cx, elev, rw.cz, rw.heading);
        for (let u = r.u0 + 30; u <= r.u1 - 20; u += Math.max(120, (r.u1 - r.u0 - 60) / 4)) {
          const lv = vFar - s * 4;
          B.box(lv, 0, -u, 0.7, 19, 0.7, C.metalDark);
          B.box(lv, 19, -u, 1.2, 1.2, 5, C.metal);
          const p = runwayPoint(rw, u, lv);
          lights.add(p.x, elev + 20, p.z, LC.WARM, 7, 0, 0, 0.04);
        }
        void d;
      }
    }
    // стоянки: жёлтые «Т»
    if (!strip) {
      for (const p of a.parking) {
        M.setFrame(p.x, elev + 0.13, p.z, p.heading);
        M.rect(0, 6, 0.7, 26, 0, C.yellow);
        M.rect(0, -7, 9, 0.7, 0, C.yellow);
      }
    }
    // постройки (кадр полосы 0: x = поперёк вправо, z = −вдоль)
    B.setFrame(rw.cx, elev, rw.cz, rw.heading);
    if (pl.terminal) {
      const t = pl.terminal, x = t.v * s, z = -t.u;
      if (a.kind === 'intl') {
        B.box(x, 0, z, t.depth, 15, t.len, C.wall, { win: true, top: C.wall2 });
        B.arch(x, 15, z, t.depth + 8, t.len + 12, 8, 6, C.roof, { end: C.glass, door: C.glass });
        B.box(x - s * (t.depth / 2 + 2), 0, z, 4, 11, t.len * 0.92, C.glass, { top: C.wall2 });
        B.box(x + s * 4, 15, z, t.depth * 0.3, 16, 60, C.wall2, { win: true, top: C.roof });
        for (let i = 0; i < 6; i++) {
          const u = -200 + i * 86;
          B.box(x - s * (t.depth / 2 + 21), 4.2, -u, 38, 3, 4, C.wall2, { bottom: true });
          B.box(x - s * (t.depth / 2 + 38), 0, -u, 2.2, 4.2, 2.2, C.metalDark);
        }
        // привокзальная площадь и стоянка машин
        D.setFrame(rw.cx, elev + 0.05, rw.cz, rw.heading);
        D.rect(x + s * (t.depth / 2 + 55), z, 90, t.len * 0.9, 0, C.taxi);
        const cc = [lin('#c9d2da'), lin('#b23a30'), lin('#2f4f7a'), lin('#e8e8e4'), lin('#3a3d42')];
        for (let i = 0; i < 70; i++) B.box(x + s * (t.depth / 2 + 30 + (i % 5) * 12), 0, z - t.len * 0.4 + Math.floor(i / 5) * (t.len * 0.8 / 14) + rnd() * 2, 4.4, 1.5, 2, cc[(rnd() * 5) | 0]);
      } else {
        B.box(x, 0, z, t.depth, 8, t.len, a.id === 'polyarny' ? lin('#d9dee4') : C.wall, { win: true });
        B.roof(x, 8, z, t.len + 4, t.depth + 4, 5, a.id === 'yuzhny' ? C.roofRed : a.id === 'polyarny' ? C.orange : C.roof, Math.PI / 2, C.wall);
        B.box(x - s * (t.depth / 2 + 2.5), 0, z, 5, 5, t.len * 0.7, C.glass, { top: C.wall2 });
        D.setFrame(rw.cx, elev + 0.05, rw.cz, rw.heading);
        D.rect(x + s * (t.depth / 2 + 28), z, 40, t.len, 0, C.taxi);
      }
    }
    if (pl.tower) tower(B, pl.tower.v * s, -pl.tower.u, pl.tower.h, mil, a);
    for (const h of pl.hangars || []) hangar(B, h.v * s, -h.u, h.w, h.d, s, mil ? C.olive : a.id === 'polyarny' ? lin('#c8703a') : C.metal, a);
    if (pl.tanks) for (let i = 0; i < 4; i++) B.cyl(pl.tanks.v * s + (i % 2) * 20, 0, -pl.tanks.u - Math.floor(i / 2) * 20, 7.5, 7.5, 9, 10, mil ? C.oliveDark : C.tank, { top: C.metal });
    if (pl.shelters) {
      for (const h of pl.shelters) B.arch(h.v * s, 0, -h.u, 30, 36, 10.5, 6, C.earth, { yaw: (-s * Math.PI) / 2, end: C.oliveDark, door: C.dark, side: C.earth });
    }
    if (pl.barracks) {
      for (let i = 0; i < 3; i++) {
        const x = (pl.barracks.v + i * 26) * s, z = -pl.barracks.u;
        B.box(x, 0, z, 14, 6, 60, C.olive, { win: true });
        B.roof(x, 6, z, 62, 16, 3.5, C.oliveDark, Math.PI / 2);
      }
    }
    if (pl.radar) {
      const x = pl.radar.v * s, z = -pl.radar.u;
      B.box(x, 0, z, 10, 6, 10, C.olive);
      B.cyl(x, 6, z, 2, 1.6, 12, 6, C.oliveDark);
      B.blob(x + 40 * s, 9, z + 30, 9, 9, 9, C.tank, 3, -0.9);
      B.box(x + 40 * s, 0, z + 30, 9, 3, 9, C.olive);
      const p = B._w(x, z);
      const dg = new Builder();
      dg.box(0, 0, 0, 13, 6.5, 0.8, C.metalDark, { bottom: true });
      dg.box(0, 2.8, 2, 1, 1, 4, C.oliveDark);
      const dish = new THREE.Mesh(dg.build(), mats.plain);
      dish.position.set(p.x, elev + 18.5, p.z);
      group.add(dish);
      rot.push(dish);
      lights.add(p.x, elev + 26, p.z, LC.RED, 3, 3, 0.3, 0.3);
    }
    if (pl.hut) {
      const x = pl.hut.v * s, z = -pl.hut.u;
      B.box(x, 0, z, 9, 4, 12, a.id === 'gnezdo' ? lin('#8a5a3a') : C.wall, { win: true });
      B.roof(x, 4, z, 13, 10, 3, a.id === 'gnezdo' ? C.roof : C.roofRed, Math.PI / 2);
      B.box(x + 9 * s, 0, z + 10, 0.5, 14, 0.5, C.red);
      for (let i = 0; i < 3; i++) B.cyl(x - 8 * s, 0, z - 8 + i * 2.6, 1, 1, 1.6, 6, C.orange);
      const p = B._w(x + 9 * s, z + 10);
      lights.add(p.x, elev + 14.6, p.z, LC.RED, 3, 0, 0, 0.4);
      const p2 = B._w(x, z);
      lights.add(p2.x, elev + 5, p2.z, LC.WARM, 4, 0, 0, 0.05);
    }
    // ветроуказатели у обоих порогов
    for (const r of a.runways) {
      for (const e of [-1, 1]) {
        const p = runwayPoint(r, e * (r.length / 2 - Math.min(140, r.length * 0.2)), -e * s * (r.width / 2 + 26));
        B.setFrame(p.x, elev, p.z, 0);
        B.box(0, 0, 0, 0.35, 7.5, 0.35, C.white);
        socks.push({ x: p.x, y: elev + 7.3, z: p.z });
        if (strip) break;
      }
    }
    const add = (b, mat, name, order) => {
      if (!b.count) return;
      const m = new THREE.Mesh(b.build(), mat);
      m.matrixAutoUpdate = false;
      m.name = name;
      m.renderOrder = order;
      group.add(m);
    };
    add(D, mats.decal, 'apt-surface-' + a.id, 1);
    add(M, mats.mark, 'apt-marks-' + a.id, 2);
    add(B, mats.building, 'apt-buildings-' + a.id, 0);
  }

  // ---------- авианосец ----------
  function buildCarrier() {
    const a = AIRPORTS.find((p) => p.kind === 'carrier');
    const rw = a.runways[0], Y = CARRIER.deckY;
    const B = new Builder(true), M = new Builder();
    B.setFrame(rw.cx, 0, rw.cz, rw.heading);
    const DK = [[-156, -24], [-156, 26], [-100, 34], [60, 34], [104, 22], [156, 11], [156, -11], [118, -21], [60, -32], [-60, -34], [-130, -34]];
    const WL = DK.map(([u, v]) => [u * (u > 0 ? 0.955 : 0.94), clamp(v, -19, 19) * (u > 100 ? 0.55 : 1) * (Math.abs(u) > 150 ? 0.82 : 1)]);
    const n = DK.length;
    const P = (q, y) => [q[1], y, -q[0]];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      B.tri([0, Y, 0], P(DK[i], Y), P(DK[j], Y), i % 2 ? C.deck : shade(C.deck, 1.04));
      B.quad(P(DK[i], Y - 3.2), P(DK[j], Y - 3.2), P(DK[j], Y), P(DK[i], Y), C.hullDark);
      B.quad(P(WL[i], 2.2), P(WL[j], 2.2), P(DK[j], Y - 3.2), P(DK[i], Y - 3.2), C.hull);
      B.quad(P(WL[i], 0), P(WL[j], 0), P(WL[j], 2.2), P(WL[i], 2.2), lin('#7a2a24'));
    }
    // надстройка-«остров» по правому борту
    const ix = 25, iz = -12;
    B.box(ix, Y, iz, 13, 9, 46, C.hull, { win: true });
    B.box(ix, Y + 9, iz - 3, 11, 6, 30, shade(C.hull, 1.08), { win: true });
    B.box(ix - 1, Y + 15, iz - 6, 12, 3.4, 16, C.glass, { top: C.hull });
    B.box(ix, Y + 18.4, iz - 4, 8, 3, 10, C.hull);
    B.cyl(ix, Y + 15, iz + 12, 4, 3, 9, 6, C.hullDark, { top: C.dark });
    B.box(ix, Y + 21.4, iz - 4, 0.8, 16, 0.8, C.hullDark);
    B.box(ix, Y + 30, iz - 4, 8, 0.6, 0.6, C.hullDark);
    B.box(ix, Y + 24, iz - 4, 6, 3.4, 1, C.metalDark);
    B.blob(ix, Y + 24, iz + 3, 3, 3, 3, C.tank, 5, -0.6);
    // спонсоны и мелочи
    B.box(-37, Y - 6, 40, 6, 3, 40, C.hullDark, { bottom: true });
    B.box(36, Y - 6, 70, 5, 3, 30, C.hullDark, { bottom: true });
    // разметка палубы
    M.setFrame(rw.cx, Y + 0.08, rw.cz, rw.heading);
    for (let u = -146; u < 146; u += 18) M.rect(0, -u - 5, 1.1, 10, 0, C.white);
    for (const sv of [-1, 1]) M.rect(sv * 15, 0, 0.9, 300, 0, sv < 0 ? C.yellow : C.white);
    M.rect(0, 148, 30, 1.6, 0, C.white);
    drawNumber(M, '07', 0, -118, 20, 0, C.white);
    for (let i = 0; i < 4; i++) M.rect(0, 96 - i * 13, 34, 0.5, 0.02, lin('#1c1e22')); // тросы аэрофинишёра
    for (let i = 0; i < 9; i++) { M.rect(-24 + (i % 2) * 3, 60 - i * 4, 5, 1.4, 0, C.yellow); }
    M.rect(-25.5, -20, 13, 0.6, 0, C.white); M.rect(-25.5, -50, 13, 0.6, 0, C.white); M.rect(-19, -35, 0.6, 30, 0, C.white); M.rect(-32, -35, 0.6, 30, 0, C.white);
    const mesh = new THREE.Mesh(B.build(), mats.building);
    mesh.matrixAutoUpdate = false; mesh.name = 'carrier';
    const mm = new THREE.Mesh(M.build(), mats.mark);
    mm.matrixAutoUpdate = false; mm.renderOrder = 2; mm.name = 'carrier-marks';
    group.add(mesh, mm);
    // огни
    const d = headingVec(rw.heading);
    const W = (u, v) => runwayPoint(rw, u, v);
    for (let u = -144; u <= 144; u += 12) { const p = W(u, 0); lights.add(p.x, Y + 0.4, p.z, LC.WHITE, 1.8, 0, 0, 0); }
    for (let u = -150; u <= 150; u += 15) for (const sv of [-1, 1]) { const p = W(u, sv * 15); lights.add(p.x, Y + 0.4, p.z, sv < 0 ? LC.YEL : LC.WHITE, 1.8, 0, 0, 0); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, len = Math.hypot(DK[j][0] - DK[i][0], DK[j][1] - DK[i][1]);
      for (let t = 0; t < len; t += 20) { const k = t / len; const p = W(DK[i][0] + (DK[j][0] - DK[i][0]) * k, DK[i][1] + (DK[j][1] - DK[i][1]) * k); lights.add(p.x, Y + 0.3, p.z, LC.BLUE, 1.5, 0, 0, 0); }
    }
    for (let i = 0; i < 7; i++) { const p = W(-154, -15 + i * 5); lights.add(p.x, Y + 0.4, p.z, LC.GRN, 2.6, 4, 0, 0.3, -d.x, -d.z); }
    for (let i = 0; i < 4; i++) { const p = W(-60, -37 - i * 2.5); lights.add(p.x, Y + 1 + i * 0.01, p.z, LC.WHITE, 5, 2, 0, 1, -d.x, -d.z, (3.5 + (0.6 - i * 0.4)) * DEG); }
    let p = W(-16, 25); lights.add(p.x, Y + 38, p.z, LC.RED, 3.5, 3, 0, 0.4);
    p = W(8, 25); lights.add(p.x, Y + 16, p.z, LC.WARM, 6, 0, 0, 0.04);
    p = W(30, 25); lights.add(p.x, Y + 10, p.z, LC.WARM, 5, 0, 0, 0.04);
  }

  for (const a of AIRPORTS) if (a.kind !== 'carrier') build(a);
  buildCarrier();

  // ветроуказатели — инстансы
  const sg = new THREE.CylinderGeometry(0.95, 0.4, 5.2, 6, 3, true).rotateX(Math.PI / 2).translate(0, 0, 2.6);
  const sc = [];
  const spos = sg.attributes.position;
  for (let i = 0; i < spos.count; i++) { const band = Math.floor((spos.getZ(i) / 5.21) * 3.99) % 2; sc.push(...(band ? C.white : C.orange)); }
  sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sc), 3));
  const sockMesh = new THREE.InstancedMesh(sg, mats.plainDouble, socks.length);
  sockMesh.frustumCulled = false;
  sockMesh.name = 'windsocks';
  group.add(sockMesh);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  let t = 0, lastW = -1;

  return {
    update(dt) {
      t += dt;
      for (const r of rot) r.rotation.y = t * 1.6;
      const w = world.wind, sp = Math.hypot(w.x, w.z);
      const key = Math.round(w.x * 4) * 1000 + Math.round(w.z * 4);
      if (key !== lastW) {
        lastW = key;
        const yaw = Math.atan2(w.x, w.z); // носок вытянут по ветру (+z локально)
        const droop = clamp(1 - sp / 9, 0, 1) * 1.1;
        _e.set(droop, yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        for (let i = 0; i < socks.length; i++) {
          _p.set(socks[i].x, socks[i].y, socks[i].z);
          _m.compose(_p, _q, _s);
          sockMesh.setMatrixAt(i, _m);
        }
        sockMesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
