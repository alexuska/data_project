// Облака: кучевые — инстансы гранёных «клубов» (мир зациклен плиткой вокруг камеры, дрейфуют по ветру);
// сплошная облачность — два смещаемых шейдером слоя (низ и верх) + «молоко» внутри. Пролёт сквозь облако — через env.inCloud.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/util.js';
import { U, FOG_PARS, patchMaterial } from './env.js';

const TILE = 90000;

function cloudGeometry(blobs, seed) {
  const rnd = mulberry32(seed);
  const base = new THREE.IcosahedronGeometry(1, 1);
  const bp = base.attributes.position.array;
  const pos = [], col = [];
  for (const b of blobs) {
    for (let i = 0; i < bp.length; i += 3) {
      let x = bp[i], y = bp[i + 1], z = bp[i + 2];
      // согласованный шум по вершине (у икосаэдра вершины продублированы)
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
      const k = 0.82 + 0.36 * (h - Math.floor(h));
      x *= k; y *= k; z *= k;
      if (y < -0.32) y = -0.32 - (y + 0.32) * 0.15; // плоское основание
      const wy = b[1] + y * b[4];
      pos.push(b[0] + x * b[3], wy, b[2] + z * b[5]);
      const sh = clamp(0.74 + (wy + 0.25) * 0.42, 0.7, 1);
      col.push(sh, sh, sh * 1.0 + (1 - sh) * 0.12);
    }
  }
  void rnd;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(pos), n = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 9) {
    const e1x = p[i + 3] - p[i], e1y = p[i + 4] - p[i + 1], e1z = p[i + 5] - p[i + 2];
    const e2x = p[i + 6] - p[i], e2y = p[i + 7] - p[i + 1], e2z = p[i + 8] - p[i + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = 1 / (Math.hypot(nx, ny, nz) || 1);
    // смягчаем грани: нормаль чуть к «наружу и вверх», чтобы низ не проваливался в черноту
    nx *= l; ny = ny * l * 0.8 + 0.25; nz *= l;
    const l2 = 1 / Math.hypot(nx, ny, nz);
    for (let q = 0; q < 9; q += 3) { n[i + q] = nx * l2; n[i + q + 1] = ny * l2; n[i + q + 2] = nz * l2; }
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  return g;
}

export function createClouds(G, world) {
  const q = G.quality.level;
  const COUNT = q === 'low' ? 60 : q === 'high' ? 190 : 120;
  const rnd = mulberry32(31337);
  const env = world.env;

  // три формы кучевого облака: [x, y, z, rx, ry, rz] клубов в единичных размерах
  const shapes = [
    [[0, 0.1, 0, 0.62, 0.5, 0.56], [0.52, -0.02, 0.1, 0.42, 0.34, 0.4], [-0.5, -0.04, -0.08, 0.44, 0.32, 0.42], [0.1, 0.02, 0.42, 0.36, 0.3, 0.34], [-0.12, 0.3, -0.1, 0.34, 0.3, 0.32]],
    [[0, 0.06, 0, 0.56, 0.4, 0.5], [0.5, -0.04, -0.12, 0.44, 0.3, 0.4], [-0.46, -0.02, 0.14, 0.46, 0.34, 0.4], [0.18, 0.26, 0.06, 0.3, 0.26, 0.3]],
    [[-0.3, 0, 0, 0.55, 0.3, 0.46], [0.36, 0.02, 0.06, 0.52, 0.34, 0.44], [0.02, 0.2, -0.05, 0.3, 0.24, 0.3]],
  ];
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.2 }));
  const sets = [];
  for (let s = 0; s < shapes.length; s++) {
    const n = Math.ceil(COUNT / shapes.length);
    const mesh = new THREE.InstancedMesh(cloudGeometry(shapes[s], 17 + s * 5), mat, n);
    mesh.frustumCulled = false;
    mesh.name = 'clouds';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.group.add(mesh);
    const slots = [];
    for (let i = 0; i < n; i++) {
      const big = Math.pow(rnd(), 2.2);
      const sx = 900 + big * 2400 + rnd() * 400;
      slots.push({ bx: rnd() * TILE, bz: rnd() * TILE, alt: rnd(), sx, sy: sx * (0.42 + rnd() * 0.25), sz: sx * (0.75 + rnd() * 0.4), rot: rnd() * 6.283, thr: rnd(), s: 0 });
    }
    // на небе в первую очередь остаются крупные облака
    slots.sort((a, b) => b.sx - a.sx);
    for (let i = 0; i < n; i++) slots[i].thr = clamp((i + rnd() * 2) / n, 0, 1);
    sets.push({ mesh, slots });
  }

  // ---- сплошная облачность ----
  const deckU = {
    uFogA: U.uFogA, uFogSun: U.uFogSun, uSunDir: U.uSunDir, uFogP: U.uFogP,
    uY: { value: 1000 }, uAmp: { value: 300 }, uSide: { value: 1 }, uAlpha: { value: 0 },
    uSun: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uLDir: { value: new THREE.Vector3(0, 1, 0) }, uOff: { value: new THREE.Vector2() },
  };
  const CELLD = 1500, SEG = 64;
  const deckGeo = new THREE.PlaneGeometry(CELLD * SEG, CELLD * SEG, SEG, SEG).rotateX(-Math.PI / 2);
  const mkDeck = (side) => {
    const u = { ...deckU, uSide: { value: side }, uY: { value: 1000 }, uAmp: { value: 300 } };
    const m = new THREE.Mesh(
      deckGeo,
      new THREE.ShaderMaterial({
        uniforms: u, transparent: true, depthWrite: false, fog: false, side: side > 0 ? THREE.FrontSide : THREE.BackSide,
        vertexShader: /* glsl */ `
          uniform float uY; uniform float uAmp; uniform float uSide; uniform vec2 uOff;
          varying vec3 vWPos; varying float vEdge;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
          void main() {
            vec2 snap = floor(cameraPosition.xz / ${CELLD.toFixed(1)}) * ${CELLD.toFixed(1)};
            vec2 xz = position.xz + snap;
            vec2 q = (xz + uOff) / 5200.0;
            float n = vn(q) * 0.62 + vn(q * 2.7 + 9.1) * 0.38;
            float y = uY + (uSide > 0.0 ? n * n * uAmp : -n * uAmp * 0.35);
            vWPos = vec3(xz.x, y, xz.y);
            vEdge = length(position.xz) / ${(CELLD * SEG * 0.5).toFixed(1)};
            gl_Position = projectionMatrix * viewMatrix * vec4(vWPos, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uSide; uniform float uAlpha; uniform vec3 uSun; uniform vec3 uAmb; uniform vec3 uLDir;
          varying vec3 vWPos; varying float vEdge;
          ${FOG_PARS}
          void main() {
            vec3 N = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
            if (N.y * uSide < 0.0) N = -N;
            vec3 col;
            if (uSide > 0.0) col = uAmb * (0.75 + 0.25 * N.y) + uSun * (0.25 + 0.75 * max(dot(N, uLDir), 0.0));
            else col = uAmb * (0.42 + 0.2 * abs(N.y)) + uSun * 0.04;
            vec3 wfd = vWPos - cameraPosition; float d = length(wfd);
            col = mix(col, wfogColor(wfd / d), wfogAmount(vWPos, cameraPosition, d));
            gl_FragColor = vec4(col, uAlpha * (1.0 - smoothstep(0.8, 0.98, vEdge)));
            #include <colorspace_fragment>
          }`,
      })
    );
    m.frustumCulled = false;
    m.renderOrder = 10;
    m.visible = false;
    m.name = 'cloud-deck';
    world.group.add(m);
    return m;
  };
  const deckTop = mkDeck(1), deckBot = mkDeck(-1);

  let wox = 0, woz = 0;
  const cCol = new THREE.Color(), cSun = new THREE.Color(), cAmb = new THREE.Color();

  function update(dt, cam, wx) {
    wox += world.wind.x * dt * 0.6;
    woz += world.wind.z * dt * 0.6;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const cover = wx.cover;
    const baseY = wx.deck > 0.5 ? wx.top - 150 : wx.base;
    const rate = dt > 0 ? 1 - Math.exp(-dt * 0.5) : 1;
    let inside = 0;
    for (const set of sets) {
      const arr = set.mesh.instanceMatrix.array;
      const slots = set.slots;
      for (let i = 0; i < slots.length; i++) {
        const c = slots[i];
        const tgt = c.thr < cover ? 1 : 0;
        c.s += (tgt - c.s) * rate;
        const o = i * 16;
        if (c.s < 0.02) { arr[o] = arr[o + 5] = arr[o + 10] = 0; arr[o + 13] = -5000; continue; }
        let dx = (c.bx + wox - cx) % TILE; if (dx < 0) dx += TILE; dx -= TILE / 2;
        let dz = (c.bz + woz - cz) % TILE; if (dz < 0) dz += TILE; dz -= TILE / 2;
        const s = c.s, sx = c.sx * s, sy = c.sy * s, sz = c.sz * s;
        const y = baseY + c.sy * 0.32 + c.alt * 650;
        const co = Math.cos(c.rot), si = Math.sin(c.rot);
        arr[o] = co * sx; arr[o + 1] = 0; arr[o + 2] = -si * sx; arr[o + 3] = 0;
        arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = si * sz; arr[o + 9] = 0; arr[o + 10] = co * sz; arr[o + 11] = 0;
        arr[o + 12] = cx + dx; arr[o + 13] = y; arr[o + 14] = cz + dz; arr[o + 15] = 1;
        // камера внутри облака?
        if (Math.abs(dx) < sx && Math.abs(dz) < sx) {
          const lx = (co * dx - si * dz) / (sx * 0.86), lz = (si * dx + co * dz) / (sz * 0.8), ly = (cy - y - sy * 0.05) / (sy * 0.5);
          const r2 = lx * lx + ly * ly + lz * lz;
          if (r2 < 1) inside = Math.max(inside, smoothstep(1, 0.55, r2));
        }
      }
      set.mesh.instanceMatrix.needsUpdate = true;
    }
    // сплошной слой
    const deck = wx.deck;
    if (deck > 0.01) {
      const b = wx.deckBase, tp = wx.deckTop;
      if (cy > b - 60 && cy < tp + 260) inside = Math.max(inside, deck * smoothstep(b - 60, b + 40, cy) * (1 - smoothstep(tp - 40, tp + 260, cy)));
    }
    env.inCloud = dt > 0 ? lerp(env.inCloud, inside, 1 - Math.exp(-dt * 5)) : inside;

    // цвет облаков по свету
    const k = env.ambientIntensity * 0.34, sI = env.sunIntensity * 0.3 * (1 - env.under);
    cAmb.copy(env.ambientColor).multiplyScalar(k * 1.75);
    cSun.copy(env.sunColor).multiplyScalar(sI);
    const dk = 1 - 0.45 * wx.dark * wx.deck;
    mat.color.setRGB(dk, dk, dk);
    mat.emissive.copy(env.ambientColor).multiplyScalar(dk);
    mat.emissiveIntensity = 0.11 * env.ambientIntensity + env.flash * 0.5;
    cCol.copy(cAmb).multiplyScalar(0.62).add(_t.copy(cSun).multiplyScalar(0.5)).multiplyScalar(dk);
    env.cloudColor.copy(cCol);

    deckTop.visible = deckBot.visible = deck > 0.02;
    if (deckTop.visible) {
      const ut = deckTop.material.uniforms, ub = deckBot.material.uniforms;
      ut.uY.value = wx.deckTop - 120; ut.uAmp.value = 420;
      ub.uY.value = wx.deckBase + 40; ub.uAmp.value = 260;
      const alpha = smoothstep(0.02, 0.8, deck);
      ut.uAlpha.value = ub.uAlpha.value = alpha;
      deckU.uOff.value.set(-wox, -woz);
      // верх слоя освещён полным солнцем независимо от того, где камера
      const fullSun = env.under < 0.98 ? env.sunIntensity / Math.max(0.05, 1 - env.under * 0.9) : 0;
      deckU.uSun.value.copy(env.sunColor).multiplyScalar(Math.min(3.2, fullSun) * 0.3);
      deckU.uAmb.value.copy(cAmb).multiplyScalar(dk);
      deckU.uLDir.value.copy(env.lightDir);
    }
  }
  const _t = new THREE.Color();
  return { update, sets, mat };
}
