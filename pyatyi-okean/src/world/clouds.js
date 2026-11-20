// Облака: кучевые — группы мягких полупрозрачных «клубов» (билборды со сферическим освещением: светлый верх, тёмное
// плоское основание, серебристый край против солнца). Все клубы — один меш и один вызов отрисовки; положение (плитка
// вокруг камеры, дрейф по ветру, рост по покрытию) считает вершинный шейдер, CPU только сортирует клубы от дальних
// к ближним. Облака стоят там, где высок шум тени (env.js) — тени на земле совпадают с облаками.
// Сплошная облачность — два смещаемых шейдером слоя (низ и верх) + «молоко» внутри; на высоте — слой перистых.
// Пролёт сквозь облако — через env.inCloud.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32 } from '../core/util.js';
import { U, FOG_PARS, CLOUD_TILE, sampleNoise } from './env.js';

const TILE = CLOUD_TILE;
const T = TILE.toFixed(1);

export function createClouds(G, world) {
  const q = G.quality.level;
  const COUNT = q === 'low' ? 56 : q === 'high' ? 170 : 115;
  const PUFF_K = q === 'low' ? 0.65 : q === 'high' ? 1.15 : 1;
  const rnd = mulberry32(31337);
  const env = world.env;

  // ---- расстановка: кандидаты с высоким облачным шумом; чем выше шум, тем раньше облако появляется ----
  const clouds = [];
  for (let i = 0; i < COUNT; i++) {
    let best = null;
    for (let t = 0; t < 14; t++) {
      const bx = rnd() * TILE, bz = rnd() * TILE;
      const n = sampleNoise(2, bx / TILE, bz / TILE);
      if (!best || n > best.n) best = { bx, bz, n };
    }
    // не ставим два облака в одно место
    let ok = true;
    for (const c of clouds) { let dx = Math.abs(c.bx - best.bx), dz = Math.abs(c.bz - best.bz); dx = Math.min(dx, TILE - dx); dz = Math.min(dz, TILE - dz); if (dx * dx + dz * dz < 1800 * 1800) { ok = false; break; } }
    if (!ok) { i--; if (clouds.length + 1 < COUNT * 0.97 || rnd() < 0.9) continue; }
    clouds.push(best);
  }
  clouds.sort((a, b) => b.n - a.n);
  const nThr = []; // шум последнего видимого облака при покрытии k/COUNT
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    c.thr = clamp((i + 0.5) / clouds.length, 0, 1);
    nThr.push(c.n);
    const big = Math.pow(rnd(), 2.0) * (0.4 + 0.6 * c.n);
    c.w = 1000 + big * 2600 + rnd() * 400; // ширина
    c.h = c.w * (0.38 + rnd() * 0.22); // высота
    c.d = c.w * (0.7 + rnd() * 0.35);
    c.alt = rnd() * 600;
  }

  // ---- клубы ----
  const puffs = [];
  for (let ci = 0; ci < clouds.length; ci++) {
    const c = clouds[ci];
    const rot = rnd() * Math.PI * 2, cs = Math.cos(rot), sn = Math.sin(rot);
    const nb = Math.max(3, Math.round((3 + c.w / 520) * PUFF_K));
    const nu = Math.max(1, Math.round((1 + c.w / 1100) * PUFF_K));
    const add = (lx, ly, lz, r) => {
      puffs.push({ c, ox: cs * lx - sn * lz, oy: ly, oz: sn * lx + cs * lz, r, hf: clamp(ly / c.h, 0, 1), rnd: rnd() });
    };
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + rnd() * 0.6, rr = Math.sqrt(rnd()) * 0.85;
      const r = c.w * (0.19 + rnd() * 0.1);
      add(Math.cos(a) * rr * (c.w * 0.5 - r * 0.6), r * 0.55, Math.sin(a) * rr * (c.d * 0.5 - r * 0.6), r);
    }
    for (let k = 0; k < nu; k++) {
      const r = c.w * (0.16 + rnd() * 0.1);
      add((rnd() - 0.5) * c.w * 0.4, c.h * (0.45 + rnd() * 0.35), (rnd() - 0.5) * c.d * 0.35, r);
    }
  }
  const NP = puffs.length;
  const pos = new Float32Array(NP * 12), aCloud = new Float32Array(NP * 16), aPuff = new Float32Array(NP * 16), aInfo = new Float32Array(NP * 8);
  const CORN = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let i = 0; i < NP; i++) {
    const p = puffs[i];
    for (let v = 0; v < 4; v++) {
      const o = i * 4 + v;
      pos[o * 3] = CORN[v * 2]; pos[o * 3 + 1] = CORN[v * 2 + 1]; pos[o * 3 + 2] = 0;
      aCloud[o * 4] = p.c.bx; aCloud[o * 4 + 1] = p.c.bz; aCloud[o * 4 + 2] = p.c.alt; aCloud[o * 4 + 3] = p.c.thr;
      aPuff[o * 4] = p.ox; aPuff[o * 4 + 1] = p.oy; aPuff[o * 4 + 2] = p.oz; aPuff[o * 4 + 3] = p.r;
      aInfo[o * 2] = p.hf; aInfo[o * 2 + 1] = p.rnd;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCloud', new THREE.BufferAttribute(aCloud, 4));
  geo.setAttribute('aPuff', new THREE.BufferAttribute(aPuff, 4));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(aInfo, 2));
  const index = new THREE.BufferAttribute(new Uint16Array(NP * 6), 1);
  index.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const cu = {
    uFogA: U.uFogA, uFogSun: U.uFogSun, uSunDir: U.uSunDir, uFogP: U.uFogP, uNoise: U.uNoise,
    uWind: { value: new THREE.Vector2() }, uCover: { value: 0.2 }, uBase: { value: 1700 },
    uSun: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uLDir: { value: new THREE.Vector3(0, 1, 0) },
    uCamR: { value: new THREE.Vector3(1, 0, 0) }, uCamU: { value: new THREE.Vector3(0, 1, 0) }, uCamB: { value: new THREE.Vector3(0, 0, 1) },
    uDark: { value: 0 },
  };
  const puffMat = new THREE.ShaderMaterial({
    uniforms: cu, transparent: true, depthWrite: false, depthTest: true, fog: false,
    vertexShader: /* glsl */ `
      attribute vec4 aCloud;
      attribute vec4 aPuff;
      attribute vec2 aInfo;
      uniform vec2 uWind; uniform float uCover; uniform float uBase;
      uniform vec3 uCamR; uniform vec3 uCamU;
      varying vec2 vC; varying vec3 vWPos; varying vec3 vInfo; varying float vBase;
      void main() {
        float s = smoothstep(aCloud.w, aCloud.w + 0.06, uCover);
        vec2 d = mod(aCloud.xy + uWind - cameraPosition.xz, ${T}) - ${(TILE / 2).toFixed(1)};
        vec3 c = vec3(cameraPosition.x + d.x, uBase + aCloud.z, cameraPosition.z + d.y);
        vec3 ctr = c + aPuff.xyz * vec3(0.55 + 0.45 * s, s, 0.55 + 0.45 * s);
        float r = aPuff.w * (0.3 + 0.7 * s);
        vec3 wp = ctr + (uCamR * position.x + uCamU * position.y) * r;
        vWPos = wp; vC = position.xy; vBase = c.y;
        float dc = distance(ctr, cameraPosition);
        vInfo = vec3(aInfo, s * smoothstep(r * 0.35, r * 1.25, dc));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        if (s < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform vec3 uSun; uniform vec3 uAmb; uniform vec3 uLDir;
      uniform vec3 uCamR; uniform vec3 uCamU; uniform vec3 uCamB;
      uniform float uDark;
      varying vec2 vC; varying vec3 vWPos; varying vec3 vInfo; varying float vBase;
      ${FOG_PARS}
      void main() {
        float r2 = dot(vC, vC);
        if (r2 > 1.0) discard;
        float n = texture2D(uNoise, vC * 0.16 + vInfo.y * 9.7).r;
        float a = smoothstep(1.0, 0.25, r2 + (n - 0.5) * 0.7);
        a *= smoothstep(vBase - 20.0, vBase + 90.0, vWPos.y);
        a *= vInfo.z;
        if (a < 0.008) discard;
        vec3 nv = vec3(vC, sqrt(1.0 - r2));
        vec3 nw = uCamR * nv.x + uCamU * nv.y + uCamB * nv.z;
        float ndl = dot(nw, uLDir);
        float h = clamp(vInfo.x * 0.8 + nw.y * 0.3 + 0.15, 0.0, 1.0);
        float lit = clamp(ndl * 0.55 + 0.45, 0.0, 1.0) * mix(0.35, 1.0, h);
        vec3 col = uAmb * mix(0.55, 1.08, h) * (1.0 - uDark * 0.4) + uSun * lit;
        vec3 wfd = vWPos - cameraPosition;
        float dist = length(wfd);
        vec3 V = wfd / dist;
        // серебристая кайма против солнца
        float fs = max(dot(V, uLDir), 0.0);
        fs = fs * fs; fs *= fs; fs *= fs;
        col += uSun * fs * (1.25 - a) * 1.1;
        col = mix(col, wfogColor(V), wfogAmount(vWPos, cameraPosition, dist));
        gl_FragColor = vec4(col, a * 0.94);
        #include <colorspace_fragment>
      }`,
  });
  const puffMesh = new THREE.Mesh(geo, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 21;
  puffMesh.name = 'clouds';
  world.group.add(puffMesh);

  // сортировка клубов (вставками — кадр к кадру порядок почти не меняется)
  const order = new Uint16Array(NP), key = new Float32Array(NP);
  for (let i = 0; i < NP; i++) order[i] = i;
  const ccx = new Float32Array(clouds.length), ccz = new Float32Array(clouds.length);
  const cloudIdx = new Uint16Array(NP);
  for (let i = 0; i < NP; i++) cloudIdx[i] = clouds.indexOf(puffs[i].c);
  const pr = new Float32Array(NP * 4);
  for (let i = 0; i < NP; i++) { const p = puffs[i]; pr[i * 4] = p.ox; pr[i * 4 + 1] = p.oy; pr[i * 4 + 2] = p.oz; pr[i * 4 + 3] = p.r; }

  // ---- перистые ----
  let cirrus = null;
  const ciU = {
    uFogA: U.uFogA, uFogSun: U.uFogSun, uSunDir: U.uSunDir, uFogP: U.uFogP, uNoise: U.uNoise,
    uOff: { value: new THREE.Vector2() }, uAmt: { value: 0 }, uSun: U.uFogSun, uCol: { value: new THREE.Color() }, uY: { value: 8200 },
  };
  if (q !== 'low') {
    const cg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    cirrus = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      uniforms: ciU, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uY;
        varying vec3 vWPos;
        void main() {
          vec3 wp = vec3(cameraPosition.x + position.x * 160000.0, uY, cameraPosition.z + position.z * 160000.0);
          vWPos = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise;
        uniform vec2 uOff; uniform float uAmt; uniform vec3 uCol;
        varying vec3 vWPos;
        ${FOG_PARS}
        void main() {
          vec2 p = vWPos.xz + uOff;
          vec2 r = vec2(p.x * 0.83 + p.y * 0.56, -p.x * 0.56 + p.y * 0.83);
          float n1 = texture2D(uNoise, r * vec2(1.0 / 70000.0, 1.0 / 16000.0)).r;
          float n2 = texture2D(uNoise, r * vec2(1.0 / 9000.0, 1.0 / 1500.0) + 0.3).g;
          float a = smoothstep(0.56, 0.95, n1 * 0.78 + n2 * 0.36) * uAmt;
          vec3 wfd = vWPos - cameraPosition;
          float dist = length(wfd);
          vec3 V = wfd / dist;
          a *= 1.0 - smoothstep(30000.0, 75000.0, dist);
          if (a < 0.004) discard;
          float fs = pow(max(dot(V, uSunDir), 0.0), 6.0);
          vec3 col = uCol * (1.0 + fs * 0.8);
          col = mix(col, wfogColor(V), wfogAmount(vWPos, cameraPosition, dist) * 0.6);
          gl_FragColor = vec4(col, a * 0.36);
          #include <colorspace_fragment>
        }`,
    }));
    cirrus.frustumCulled = false;
    cirrus.renderOrder = 5;
    cirrus.name = 'cirrus';
    world.group.add(cirrus);
  }

  // ---- сплошная облачность ----
  const deckU = {
    uFogA: U.uFogA, uFogSun: U.uFogSun, uSunDir: U.uSunDir, uFogP: U.uFogP, uNoise: U.uNoise,
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
        uniforms: u, transparent: true, depthWrite: true, fog: false, side: side > 0 ? THREE.FrontSide : THREE.BackSide,
        vertexShader: /* glsl */ `
          uniform float uY; uniform float uAmp; uniform float uSide; uniform vec2 uOff;
          varying vec3 vWPos; varying float vEdge; varying float vH; varying vec3 vN;
          float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
          float hgt(vec2 xz) {
            vec2 q = (xz + uOff) / 3600.0;
            float n = vn(q) * 0.6 + vn(q * 2.3 + 9.1) * 0.4;
            return uSide > 0.0 ? n * n * uAmp : -n * uAmp * 0.6;
          }
          void main() {
            vec2 snap = floor(cameraPosition.xz / ${CELLD.toFixed(1)}) * ${CELLD.toFixed(1)};
            vec2 xz = position.xz + snap;
            float y0 = hgt(xz);
            float e = 400.0;
            vN = normalize(vec3(y0 - hgt(xz + vec2(e, 0.0)), e, y0 - hgt(xz + vec2(0.0, e))));
            vH = clamp(uSide > 0.0 ? sqrt(max(y0, 0.0) / uAmp) : -y0 / (uAmp * 0.6), 0.0, 1.0);
            vWPos = vec3(xz.x, uY + y0, xz.y);
            vEdge = length(position.xz) / ${(CELLD * SEG * 0.5).toFixed(1)};
            gl_Position = projectionMatrix * viewMatrix * vec4(vWPos, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uNoise;
          uniform float uSide; uniform float uAlpha; uniform vec3 uSun; uniform vec3 uAmb; uniform vec3 uLDir; uniform vec2 uOff;
          varying vec3 vWPos; varying float vEdge; varying float vH; varying vec3 vN;
          ${FOG_PARS}
          void main() {
            vec3 N = normalize(vN);
            float dn = texture2D(uNoise, (vWPos.xz + uOff) * (1.0 / 5200.0)).g;
            vec3 col;
            if (uSide > 0.0) col = (uAmb * (0.72 + 0.28 * N.y) + uSun * (0.15 + 1.45 * max(dot(N, uLDir), 0.0))) * (0.66 + 0.3 * vH + 0.16 * (dn - 0.5));
            else col = uAmb * (0.32 + 0.36 * vH + 0.16 * (dn - 0.5)) + uSun * 0.03;
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

  let wox = 0, woz = 0, cirX = 0, cirZ = 0;
  const cSun = new THREE.Color(), cAmb = new THREE.Color(), cCol = new THREE.Color(), _t = new THREE.Color();
  const me = new THREE.Matrix4();

  function update(dt, cam, wx) {
    wox += world.wind.x * dt * 0.6;
    woz += world.wind.z * dt * 0.6;
    cirX += world.wind.x * dt * 1.6 + dt * 6;
    cirZ += world.wind.z * dt * 1.6;
    if (wox > TILE) wox -= TILE; else if (wox < -TILE) wox += TILE;
    if (woz > TILE) woz -= TILE; else if (woz < -TILE) woz += TILE;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const cover = wx.cover;
    const baseY = wx.deck > 0.5 ? wx.top - 150 : wx.base;
    cu.uWind.value.set(wox, woz);
    cu.uCover.value = cover;
    cu.uBase.value = baseY;
    // оси камеры для билбордов
    me.copy(cam.matrixWorld);
    const e = me.elements;
    cu.uCamR.value.set(e[0], e[1], e[2]).normalize();
    cu.uCamU.value.set(e[4], e[5], e[6]).normalize();
    cu.uCamB.value.set(e[8], e[9], e[10]).normalize();

    // центры облаков (как в шейдере)
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      let dx = (c.bx + wox - cx) % TILE; if (dx < 0) dx += TILE; dx -= TILE / 2;
      let dz = (c.bz + woz - cz) % TILE; if (dz < 0) dz += TILE; dz -= TILE / 2;
      ccx[i] = cx + dx; ccz[i] = cz + dz;
    }
    // ключи сортировки, «внутри облака»
    let inside = 0, nvis = 0;
    for (let i = 0; i < NP; i++) {
      const c = clouds[cloudIdx[i]];
      const s = smoothstep(c.thr, c.thr + 0.06, cover);
      if (s < 0.01) { key[i] = -1; continue; }
      nvis++;
      const k = 0.55 + 0.45 * s;
      const px = ccx[cloudIdx[i]] + pr[i * 4] * k - cx, py = baseY + c.alt + pr[i * 4 + 1] * s - cy, pz = ccz[cloudIdx[i]] + pr[i * 4 + 2] * k - cz;
      const d2 = px * px + py * py + pz * pz;
      key[i] = d2;
      const r = pr[i * 4 + 3] * (0.3 + 0.7 * s) * 0.92;
      if (d2 < r * r) inside = Math.max(inside, smoothstep(1, 0.45, d2 / (r * r)) * s);
    }
    // вставками по убыванию дальности (невидимые — в конец)
    for (let i = 1; i < NP; i++) {
      const v = order[i], kv = key[v];
      let j = i - 1;
      while (j >= 0 && key[order[j]] < kv) { order[j + 1] = order[j]; j--; }
      order[j + 1] = v;
    }
    const ia = index.array;
    for (let i = 0; i < nvis; i++) {
      const b = order[i] * 4, o = i * 6;
      ia[o] = b; ia[o + 1] = b + 1; ia[o + 2] = b + 2; ia[o + 3] = b; ia[o + 4] = b + 2; ia[o + 5] = b + 3;
    }
    index.needsUpdate = true;
    index.clearUpdateRanges();
    index.addUpdateRange(0, nvis * 6);
    geo.setDrawRange(0, nvis * 6);
    puffMesh.visible = nvis > 0;

    // сплошной слой
    const deck = wx.deck;
    if (deck > 0.01) {
      const b = wx.deckBase, tp = wx.deckTop;
      if (cy > b - 60 && cy < tp + 260) inside = Math.max(inside, deck * smoothstep(b - 60, b + 40, cy) * (1 - smoothstep(tp - 40, tp + 260, cy)));
    }
    env.inCloud = dt > 0 ? lerp(env.inCloud, inside, 1 - Math.exp(-dt * 5)) : inside;

    // свет облаков
    const dk = 1 - 0.45 * wx.dark * wx.deck;
    const k = env.ambientIntensity * 0.34, sI = env.sunIntensity * 0.3 * (1 - env.under);
    cAmb.copy(env.ambientColor).multiplyScalar(k * 1.75);
    cSun.copy(env.sunColor).multiplyScalar(sI);
    cu.uAmb.value.copy(cAmb).multiplyScalar(dk * 0.95).addScalar(env.flash * 0.6);
    cu.uSun.value.copy(cSun).multiplyScalar(1.05 * dk);
    cu.uLDir.value.copy(env.night > 0.5 ? env.lightDir : world.sunDir);
    if (cu.uLDir.value.y < -0.05) { cu.uLDir.value.y = -0.05; cu.uLDir.value.normalize(); }
    cu.uDark.value = wx.dark;
    cCol.copy(cAmb).multiplyScalar(0.62).add(_t.copy(cSun).multiplyScalar(0.5)).multiplyScalar(dk);
    env.cloudColor.copy(cCol);

    // тени облаков на земле: порог шума = шум последнего видимого облака
    const vi = clamp(Math.floor(cover * clouds.length), 0, clouds.length);
    const thrN = vi <= 0 ? 2 : nThr[Math.min(vi, nThr.length) - 1] - 0.07;
    U.uCloudSh.value.set(-wox, -woz, thrN, (1 - env.under) * (1 - env.night) * 0.5 * smoothstep(0.05, 0.25, cover) * smoothstep(-2, 8, env.sunElev));
    U.uCloudAlt.value = baseY + 500;

    // перистые
    if (cirrus) {
      const amt = (1 - wx.deck) * (1 - wx.haze) * (0.35 + 0.5 * smoothstep(0.1, 0.7, cover)) * (1 - env.inCloud) * (1 - 0.75 * env.night);
      ciU.uAmt.value = amt;
      cirrus.visible = amt > 0.02 && cy < 7600;
      ciU.uOff.value.set(cirX, cirZ);
      ciU.uCol.value.copy(cAmb).multiplyScalar(0.8).add(_t.copy(env.sunColor).multiplyScalar(env.sunIntensity * 0.32));
    }

    deckTop.visible = deckBot.visible = deck > 0.02;
    if (deckTop.visible) {
      const ut = deckTop.material.uniforms, ub = deckBot.material.uniforms;
      ut.uY.value = wx.deckTop - 200; ut.uAmp.value = 760;
      ub.uY.value = wx.deckBase + 40; ub.uAmp.value = 260;
      const alpha = smoothstep(0.02, 0.8, deck);
      ut.uAlpha.value = ub.uAlpha.value = alpha;
      deckU.uOff.value.set(-wox, -woz);
      // верх слоя освещён полным солнцем независимо от того, где камера
      const fullSun = env.under < 0.98 ? env.sunIntensity / Math.max(0.05, 1 - env.under * 0.9) : 0;
      deckU.uSun.value.copy(env.sunColor).multiplyScalar(Math.min(3.2, fullSun) * 0.3);
      deckU.uAmb.value.copy(cAmb).multiplyScalar(dk);
      deckU.uLDir.value.copy(env.night > 0.5 ? env.lightDir : world.sunDir); if (deckU.uLDir.value.y < 0.16) { deckU.uLDir.value.y = 0.16; deckU.uLDir.value.normalize(); }
    }
  }
  // для отладки: мировой центр основания облака i (как в шейдере)
  const cloudPos = (i, cam) => {
    const c = clouds[i];
    let dx = (c.bx + wox - cam.x) % TILE; if (dx < 0) dx += TILE; dx -= TILE / 2;
    let dz = (c.bz + woz - cam.z) % TILE; if (dz < 0) dz += TILE; dz -= TILE / 2;
    return { x: cam.x + dx, y: cu.uBase.value + c.alt, z: cam.z + dz, w: c.w, h: c.h };
  };
  return { update, mesh: puffMesh, puffs: NP, clouds: clouds.length, cloudPos };
}
