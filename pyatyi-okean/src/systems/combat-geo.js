// БОЙ: low-poly геометрия боеприпасов, подвесок и наземных/морских целей. Всё процедурно, цвета — в вершинах,
// один общий материал (с дымкой мира). Модели: нос/перёд −Z, верх +Y. Геометрии общие (userData.shared) — их нельзя dispose.
import * as THREE from 'three';
import * as ENV from '../world/env.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3(), _c = new THREE.Color();
const HALF = Math.PI / 2;

export class Kit {
  constructor() { this.pos = []; this.col = []; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
    const a = g.attributes.position;
    _c.set(color);
    for (let i = 0; i < a.count; i++) {
      _v.fromBufferAttribute(a, i).applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
    geo.dispose();
    if (g !== geo) g.dispose();
    return this;
  }
  box(w, h, d, color, x, y, z, rx, ry, rz) { return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz); }
  // цилиндр/усечённый конус вдоль Y (rTop, rBot)
  cyl(rTop, rBot, h, color, x, y, z, rx, ry, rz, seg = 6) { return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), color, x, y, z, rx, ry, rz); }
  // то же, но вдоль −Z (нос — rTop)
  tube(rNose, rTail, len, color, x, y, z, seg = 6) { return this.cyl(rNose, rTail, len, color, x, y, z, -HALF, 0, 0, seg); }
  ball(r, color, x, y, z, detail = 0) { return this.add(new THREE.IcosahedronGeometry(r, detail), color, x, y, z); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.userData.shared = true;
    return g;
  }
}

const patch = (m) => (typeof ENV.patchMaterial === 'function' ? ENV.patchMaterial(m) : m);
let mats = null;
export function combatMaterials() {
  if (mats) return mats;
  mats = {
    body: patch(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
    wreck: patch(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: 0x3a3632 })),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }),
    tracer: new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    water: new THREE.MeshBasicMaterial({ color: 0xd8ecf6, fog: false, transparent: true, opacity: 0.55, depthWrite: false }),
    ring: new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false, toneMapped: false, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  };
  for (const k in mats) mats[k].userData.shared = true;
  return mats;
}

// ---------- боеприпасы ----------
const ORD = {};
function fins(k, r, len, z, color) {
  k.box(r * 2, 0.02, len, color, 0, 0, z);
  k.box(0.02, r * 2, len, color, 0, 0, z);
}
export function ordGeo(kind) {
  if (ORD[kind]) return ORD[kind];
  const k = new Kit();
  if (kind === 'aam') {
    k.tube(0.02, 0.085, 0.4, '#3b3f44', 0, 0, -1.45);
    k.tube(0.085, 0.085, 2.5, '#eef0f2', 0, 0, 0);
    fins(k, 0.3, 0.45, 1.0, '#c9ccd0');
    fins(k, 0.16, 0.25, -0.9, '#c9ccd0');
    k.box(0.1, 0.1, 0.12, '#ff9a3c', 0, 0, 1.3);
  } else if (kind === 'rocket') {
    k.tube(0.01, 0.06, 0.25, '#2c2f33', 0, 0, -0.8);
    k.tube(0.06, 0.06, 1.4, '#7d8288', 0, 0, 0, 5);
    k.box(0.08, 0.08, 0.1, '#ffb347', 0, 0, 0.74);
  } else if (kind === 'bomb') {
    k.tube(0.03, 0.2, 0.45, '#4b5148', 0, 0, -0.85);
    k.tube(0.2, 0.2, 1.25, '#5d6457', 0, 0, 0);
    k.tube(0.2, 0.07, 0.5, '#5d6457', 0, 0, 0.85);
    fins(k, 0.26, 0.4, 1.0, '#3d423b');
    k.tube(0.205, 0.205, 0.12, '#d9c23a', 0, 0, -0.45);
  } else if (kind === 'pod') {
    k.tube(0.14, 0.22, 0.3, '#2c2f33', 0, 0, -0.95, 8);
    k.tube(0.22, 0.22, 1.6, '#b9bec4', 0, 0, 0, 8);
    k.tube(0.22, 0.1, 0.4, '#9da2a8', 0, 0, 1.0, 8);
  } else if (kind === 'crate' || kind === 'crateChute') {
    k.box(1.5, 1.2, 1.5, '#b9772e', 0, 0.6, 0);
    k.box(1.56, 0.14, 1.56, '#6e4a22', 0, 0.3, 0);
    k.box(1.56, 0.14, 1.56, '#6e4a22', 0, 0.9, 0);
    if (kind === 'crateChute') {
      k.cyl(0.6, 3.4, 1.9, '#f4f1e8', 0, 8.6, 0, 0, 0, 0, 8);
      k.cyl(3.4, 3.2, 0.5, '#e8641c', 0, 7.4, 0, 0, 0, 0, 8);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4, x = Math.cos(a) * 1.55, z = Math.sin(a) * 1.55;
        k.box(0.05, 6.4, 0.05, '#d9d5c8', x, 4.3, z, Math.sin(a) * 0.42, 0, -Math.cos(a) * 0.42);
      }
    }
  } else if (kind === 'flare') {
    k.ball(0.55, '#ffffff', 0, 0, 0, 0);
  } else if (kind === 'water') {
    k.ball(1, '#ffffff', 0, 0, 0, 1);
  } else {
    k.box(1, 1, 1, '#ffffff', 0, 0, 0);
  }
  return (ORD[kind] = k.build());
}

// ---------- цели ----------
const TEAM_COL = {
  enemy: { base: '#6f6a58', dark: '#4a473c', mark: '#e0651c' },
  friend: { base: '#55704a', dark: '#3b4f35', mark: '#f1efe6' },
};
const TG = {};
function wheels(k, len, w, n, y = 0.45) {
  for (let i = 0; i < n; i++) {
    const z = -len / 2 + 0.7 + (i * (len - 1.4)) / Math.max(1, n - 1);
    k.box(0.4, 0.9, 0.9, '#1f2124', -w / 2, y, z);
    k.box(0.4, 0.9, 0.9, '#1f2124', w / 2, y, z);
  }
}
function tracks(k, len, w, col) {
  k.box(0.6, 0.9, len, '#26282b', -w / 2, 0.45, 0);
  k.box(0.6, 0.9, len, '#26282b', w / 2, 0.45, 0);
  k.box(w - 0.4, 0.9, len * 0.94, col, 0, 1.0, 0);
}
export function targetGeo(kind, team) {
  const key = kind + '|' + (team === 'enemy' ? 'enemy' : 'friend');
  if (TG[key]) return TG[key];
  const C = TEAM_COL[team === 'enemy' ? 'enemy' : 'friend'];
  const k = new Kit();
  if (kind === 'truck') {
    wheels(k, 6.6, 2.3, 3);
    k.box(2.4, 0.5, 6.8, C.dark, 0, 1.0, 0);
    k.box(2.4, 1.5, 1.8, C.base, 0, 2.0, -2.3);
    k.box(2.2, 0.6, 0.1, '#9fc3d6', 0, 2.3, -3.22);
    k.box(2.5, 1.9, 4.2, C.mark === '#e0651c' ? '#8a8468' : '#7d8f6b', 0, 2.2, 1.1);
    k.box(2.52, 0.3, 4.22, C.mark, 0, 3.0, 1.1);
  } else if (kind === 'tank') {
    tracks(k, 7.2, 3.3, C.base);
    k.box(3.0, 0.5, 6.0, C.dark, 0, 1.6, 0.2);
    k.cyl(1.25, 1.6, 0.9, C.base, 0, 2.2, 0.2, 0, 0, 0, 8);
    k.tube(0.13, 0.15, 4.6, C.dark, 0, 2.25, -3.3);
    k.box(0.7, 0.12, 0.7, C.mark, 0, 2.7, 0.5);
  } else if (kind === 'aaa') {
    tracks(k, 6.6, 3.1, C.base);
    k.box(2.6, 1.2, 2.8, C.dark, 0, 2.1, 0.3);
    for (const x of [-0.75, -0.3, 0.3, 0.75]) k.cyl(0.07, 0.09, 3.4, '#2a2c2f', x, 3.3, -1.6, -0.75, 0, 0, 5);
    k.cyl(0.9, 0.9, 0.15, C.mark, 0, 3.2, 1.2, 0.5, 0, 0, 8);
  } else if (kind === 'sam') {
    wheels(k, 8.4, 2.6, 4);
    k.box(2.7, 0.7, 8.6, C.dark, 0, 1.15, 0);
    k.box(2.6, 1.5, 2.0, C.base, 0, 2.2, -3.1);
    k.box(1.9, 0.3, 5.4, C.dark, 0, 2.9, 1.4, 0.42, 0, 0);
    for (const x of [-0.55, 0.55]) {
      k.cyl(0.02, 0.24, 0.9, '#d8452b', x, 4.95, -2.2, -HALF + 0.42, 0, 0);
      k.cyl(0.24, 0.24, 5.2, '#f1efe6', x, 3.72, 0.55, -HALF + 0.42, 0, 0);
    }
  } else if (kind === 'radar') {
    wheels(k, 6.4, 2.4, 3);
    k.box(2.6, 2.2, 6.6, C.base, 0, 2.0, 0);
    k.cyl(0.18, 0.25, 3.2, C.dark, 0, 4.6, 0.6);
    k.box(6.4, 3.0, 0.3, '#c9cdd1', 0, 7.0, 0.5, 0.25, 0, 0);
    k.box(6.6, 0.25, 0.4, C.mark, 0, 8.45, 0.9, 0.25, 0, 0);
    k.box(0.3, 3.0, 0.35, C.dark, 0, 7.0, 0.75, 0.25, 0, 0);
  } else if (kind === 'depot') {
    for (const [x, z, r, h] of [[-9, -4, 5.2, 7.5], [3, -7, 5.2, 7.5], [-3, 7, 4.2, 6]]) {
      k.cyl(r, r, h, '#d9dcd6', x, h / 2, z, 0, 0, 0, 10);
      k.cyl(r * 0.25, r, 1.1, '#bfc3bd', x, h + 0.55, z, 0, 0, 0, 10);
      k.cyl(r + 0.06, r + 0.06, 0.7, C.mark, x, h * 0.72, z, 0, 0, 0, 10);
    }
    k.box(11, 4.2, 7, C.base, 11, 2.1, 6);
    k.box(11.4, 0.5, 7.4, C.dark, 11, 4.4, 6);
    for (const [x, z] of [[12, -6], [14.2, -6], [13.1, -4]]) k.cyl(0.9, 0.9, 2.2, '#b4472c', x, 1.1, z, 0, 0, 0, 7);
    k.box(30, 0.25, 26, '#77756b', 2, 0.1, 0);
  } else if (kind === 'bunker') {
    k.cyl(6.5, 9.5, 3.4, '#8d8c84', 0, 1.7, 0, 0, Math.PI / 4, 0, 4);
    k.box(5.5, 0.7, 0.6, '#1d1e20', 0, 2.2, -6.2);
    k.box(9.4, 0.4, 9.4, '#6f6e67', 0, 3.5, 0);
    k.box(1.2, 0.14, 1.2, C.mark, 0, 3.75, 0);
  } else if (kind === 'ship') {
    k.box(13, 6, 84, '#70777d', 0, 2, 4);
    k.cyl(0.4, 6.5, 22, '#70777d', 0, 2.2, -48, -HALF, 0, 0, 4).box(13, 1.2, 84, '#3c4146', 0, -0.4, 4);
    k.box(13.2, 0.5, 84.2, C.mark, 0, 0.6, 4);
    k.box(9, 6, 20, '#8a9197', 0, 8, -6);
    k.box(7, 4, 10, '#9aa1a7', 0, 13, -8);
    k.cyl(0.25, 0.4, 11, '#5d6368', 0, 20, -8);
    k.box(5, 0.4, 0.4, '#5d6368', 0, 22, -8);
    k.cyl(1.7, 2.1, 6, '#4a4f54', 0, 12, 6, 0.2, 0, 0, 8);
    k.cyl(1.72, 1.72, 0.9, C.mark, 0, 14.3, 6.5, 0.2, 0, 0, 8);
    k.box(4, 2.2, 5, '#5d6368', 0, 6, -30);
    k.tube(0.25, 0.3, 7, '#3c4146', 0, 6.6, -36);
    k.box(3.4, 2, 4, '#5d6368', 0, 6, 32);
    k.box(12, 0.3, 16, '#565b60', 0, 5.2, 38);
  } else if (kind === 'boat') {
    k.box(5.2, 2.4, 20, '#7b8288', 0, 0.9, 1);
    k.cyl(0.3, 2.9, 7, '#7b8288', 0, 1.0, -12.4, -HALF, 0, 0, 4);
    k.box(5.3, 0.4, 20.1, C.mark, 0, 0.5, 1);
    k.box(3.6, 2.4, 6, '#a3aab0', 0, 3.3, -1);
    k.box(3.7, 0.7, 0.1, '#27323a', 0, 3.8, -4.02);
    k.cyl(0.1, 0.14, 4, '#4a4f54', 0, 6.4, -0.5);
    k.tube(0.1, 0.12, 2.6, '#33373b', 0, 2.8, -7.6);
  } else if (kind === 'target_panel') {
    k.box(0.5, 6, 0.5, '#5b4a35', -5, 3, 0.4).box(0.5, 6, 0.5, '#5b4a35', 5, 3, 0.4);
    k.box(13, 9, 0.3, '#f4f1e8', 0, 7, 0);
    k.cyl(3.6, 3.6, 0.36, '#d8452b', 0, 7, 0, HALF, 0, 0, 12);
    k.cyl(2.3, 2.3, 0.42, '#f4f1e8', 0, 7, 0, HALF, 0, 0, 12);
    k.cyl(1.0, 1.0, 0.48, '#d8452b', 0, 7, 0, HALF, 0, 0, 12);
    // круг на земле — видно сверху
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      k.box(7, 0.2, 2.2, i % 2 ? '#f4f1e8' : '#d8452b', Math.cos(a) * 24, 0.25, Math.sin(a) * 24, 0, -a + HALF, 0);
    }
    k.box(10, 0.2, 2.4, '#f4f1e8', 0, 0.25, 6).box(2.4, 0.2, 10, '#f4f1e8', 0, 0.26, 6);
  } else if (kind === 'balloon') {
    const cols = ['#d8452b', '#f4f1e8'];
    const seg = 8, R = 7;
    for (let i = 0; i < seg; i++) {
      const g = new THREE.SphereGeometry(R, 2, 5, (i / seg) * Math.PI * 2, (Math.PI * 2) / seg);
      k.add(g, cols[i % 2], 0, 0, 0);
    }
    k.cyl(1.6, 0.6, 3.2, '#d8452b', 0, -7.6, 0, 0, 0, 0, 8);
    k.box(1.6, 1.3, 1.6, '#7a5a34', 0, -11, 0);
    for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) k.box(0.06, 2.6, 0.06, '#3a3632', x, -9.3, z);
  } else {
    k.box(4, 3, 4, C.base, 0, 1.5, 0);
  }
  return (TG[key] = k.build());
}
