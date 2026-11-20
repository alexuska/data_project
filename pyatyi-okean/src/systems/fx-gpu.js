// ЭФФЕКТЫ: GPU-системы. Четыре вызова отрисовки на всё:
//   частицы (инстансированные гранёные «клубы», движение считается в вершинном шейдере — на CPU только запись при рождении),
//   ленты (инверсионные следы, жгуты, шлейфы ракет), трассеры, тени-«блобы» самолётов.
// Ни одной аллокации после создания: кольцевые буферы, загрузка в GPU только изменённого диапазона.
import * as THREE from 'three';
import * as Env from '../world/env.js';

const WU = Env.U || {};
const FOG_PARS = Env.FOG_PARS || /* glsl */ `
uniform vec3 uFogA; uniform vec3 uFogSun; uniform vec3 uSunDir; uniform vec4 uFogP;
vec3 wfogColor(vec3 d) { return uFogA; }
float wfogAmount(vec3 p, vec3 cam, float d) { float t = d * uFogP.x; return 1.0 - exp(-t * t); }
`;

// общие uniform-ы всех систем эффектов
export const FXU = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3() },
  uPx: { value: 400 },                                   // пикселей на метр на дальности 1 м
  uSunV: { value: new THREE.Vector3(0.3, 0.8, 0.5) },    // направление на свет в координатах камеры
  uLight: { value: new THREE.Color(0.5, 0.5, 0.5) },
  uAmb: { value: new THREE.Color(0.6, 0.6, 0.6) },
  uFogA: WU.uFogA || { value: new THREE.Color('#bfe0f4') },
  uFogSun: WU.uFogSun || { value: new THREE.Color('#d6ecf8') },
  uSunDir: WU.uSunDir || { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
  uFogP: WU.uFogP || { value: new THREE.Vector4(2 / 45000, 1 / 3500, 0, 0) },
};

function quadGeo() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// диапазон «грязных» записей кольцевого буфера -> updateRanges (объекты диапазонов переиспользуются)
function makeDirty(ib, stride, count) {
  const r1 = { start: 0, count: 0 }, r2 = { start: 0, count: 0 };
  let lo = -1, hi = -1, all = false;
  return {
    mark(i) {
      if (lo < 0) { lo = hi = i; return; }
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    },
    markAll() { all = true; },
    // кольцевой диапазон [from, from + n)
    ring(from, n) {
      if (n >= count) { all = true; return; }
      const to = from + n;
      if (to <= count) { this.mark(from); this.mark(to - 1); } else all = true;
    },
    flush() {
      if (all) { ib.clearUpdateRanges(); ib.needsUpdate = true; all = false; lo = hi = -1; return; }
      if (lo < 0) return;
      r1.start = lo * stride; r1.count = (hi - lo + 1) * stride;
      ib.updateRanges.length = 0;
      ib.updateRanges.push(r1);
      ib.needsUpdate = true;
      lo = hi = -1;
      void r2;
    },
  };
}

// =====================================================================================================================
// ЧАСТИЦЫ
// запись: aP (x, y, z, рождение) aV (vx, vy, vz, жизнь) aC (r, g, b, альфа) aS (размер0, размер1, торможение, ускорение по Y)
//         aM (вид: 0 дым / 1 свечение, фаза 0..1, «остывание» 0..1, пол Y)
// =====================================================================================================================
const PS = 20;

const P_VERT = /* glsl */ `
attribute vec4 aP; attribute vec4 aV; attribute vec4 aC; attribute vec4 aS; attribute vec4 aM;
uniform float uTime; uniform vec3 uWind; uniform float uPx;
varying vec2 vUv; varying vec4 vCol; varying vec4 vFog; varying vec3 vM;
${FOG_PARS}
void main() {
  float t = uTime - aP.w;
  float life = aV.w;
  float age = t / max(life, 0.0001);
  if (t < 0.0 || age >= 1.0 || life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = aS.z;
  float e = k > 0.001 ? (1.0 - exp(-k * t)) / k : t;
  float h = k > 0.001 ? (t - e) / k : 0.5 * t * t;
  vec3 p = aP.xyz + aV.xyz * e + vec3(0.0, aS.w, 0.0) * h + uWind * (t - e);
  p.y = max(p.y, aM.w);
  float g = 1.0 - age;
  float sz = mix(aS.x, aS.y, 1.0 - g * g);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = length(mv.xyz);
  if (sz * uPx < 0.7 * dist) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  mv.xy += position.xy * sz;
  gl_Position = projectionMatrix * mv;
  float em = aM.x;
  float a = aC.a * smoothstep(0.0, mix(0.1, 0.03, em), age) * mix(1.0 - smoothstep(0.4, 1.0, age), g * sqrt(g), em);
  a *= smoothstep(sz * 0.35, sz * 1.6, dist);          // не закрывать экран, когда камера влетает в клуб
  vec3 col = aC.rgb;
  if (em > 0.5) col *= mix(vec3(1.0), vec3(1.0, 0.42, 0.13), age * aM.z);
  else col *= 1.0 - 0.45 * age * aM.z;
  vCol = vec4(col, a);
  vUv = position.xy;
  vM = vec3(em, aM.y * 6.2832 + t * (aM.y - 0.5) * 0.7, age);
  vec3 wd = p - cameraPosition;
  vFog = vec4(wfogColor(wd / max(dist, 0.001)), wfogAmount(p, cameraPosition, dist));
}`;

const P_FRAG = /* glsl */ `
uniform vec3 uSunV; uniform vec3 uLight; uniform vec3 uAmb;
varying vec2 vUv; varying vec4 vCol; varying vec4 vFog; varying vec3 vM;
void main() {
  float r = length(vUv);
  if (r > 1.0 || vCol.a < 0.004) discard;
  float cs = cos(vM.y), sn = sin(vM.y);
  vec2 ru = vec2(vUv.x * cs - vUv.y * sn, vUv.x * sn + vUv.y * cs);
  // гранёный силуэт: семиугольник
  float seg = 0.8976;
  float pr = r * cos(mod(atan(ru.y, ru.x), seg) - seg * 0.5) / 0.9010;
  vec3 col; float a; float add;
  if (vM.x < 0.5) {
    a = vCol.a * (1.0 - smoothstep(0.86, 1.0, pr));
    // гранёный «шар»: нормаль по крупным клеткам
    vec2 q = (floor(ru * 1.7 + 0.5)) / 1.7;
    q = vec2(q.x * cs + q.y * sn, -q.x * sn + q.y * cs);
    vec3 n = normalize(vec3(q, sqrt(max(0.08, 1.0 - dot(q, q)))));
    float l = dot(n, uSunV) * 0.5 + 0.5;
    col = vCol.rgb * (uAmb + uLight * l);
    col = mix(col, vFog.rgb, vFog.a);
    a *= 1.0 - vFog.a * 0.6;
    add = 0.0;
  } else {
    float f = 1.0 - smoothstep(0.25, 1.0, pr);
    a = vCol.a * f;
    col = vCol.rgb * (1.0 + 0.7 * (1.0 - smoothstep(0.0, 0.55, r)));
    a *= 1.0 - vFog.a;
    add = 1.0;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - add));
}`;

export function createParticles(max) {
  const data = new Float32Array(max * PS);
  const ib = new THREE.InstancedInterleavedBuffer(data, PS, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = quadGeo();
  const names = ['aP', 'aV', 'aC', 'aS', 'aM'];
  for (let i = 0; i < 5; i++) geo.setAttribute(names[i], new THREE.InterleavedBufferAttribute(ib, 4, i * 4));
  geo.instanceCount = max;
  const mat = new THREE.ShaderMaterial({
    uniforms: FXU, vertexShader: P_VERT, fragmentShader: P_FRAG,
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.name = 'fx-particles';
  const dirty = makeDirty(ib, PS, max);
  let head = 0, pending = 0, lastDeath = -1;

  return {
    mesh, max,
    spawned: 0,
    // живых частиц не больше, чем прошло времени жизни (оценка для диагностики)
    get busyUntil() { return lastDeath; },
    // x,y,z, vx,vy,vz, life, size0,size1, r,g,b,a, drag, accY, kind, heat, floorY
    spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag, accY, kind, heat, floorY) {
      const o = head * PS, d = data, now = FXU.uTime.value;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = now;
      d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
      d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
      d[o + 12] = s0; d[o + 13] = s1; d[o + 14] = drag; d[o + 15] = accY;
      d[o + 16] = kind; d[o + 17] = Math.random(); d[o + 18] = heat; d[o + 19] = floorY === undefined ? -1e6 : floorY;
      head = head + 1 === max ? 0 : head + 1;
      pending++;
      this.spawned++;
      if (now + life > lastDeath) lastDeath = now + life;
    },
    flush() {
      if (!pending) return;
      const from = head - pending;
      if (pending >= max || from < 0) dirty.markAll(); else dirty.ring(from, pending);
      pending = 0;
      dirty.flush();
      mesh.visible = true;
    },
    // можно ли не рисовать совсем
    idle() { if (FXU.uTime.value > lastDeath + 0.1) mesh.visible = false; },
    clear() {
      for (let i = 7; i < data.length; i += PS) data[i] = 0;
      dirty.markAll(); dirty.flush();
      head = 0; pending = 0; lastDeath = -1;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// =====================================================================================================================
// ЛЕНТЫ: слоты по K сегментов. Сегмент: aA (xyz, рождение A) aB (xyz, рождение B) aPrev (xyz, ширина0) aNext (xyz, рост ширины)
//        aCol (rgb, альфа) aPar (жизнь, нарастание с, волнистость, свечение)
// =====================================================================================================================
const RS = 24;

const R_VERT = /* glsl */ `
attribute vec4 aA; attribute vec4 aB; attribute vec4 aPrev; attribute vec4 aNext; attribute vec4 aCol; attribute vec4 aPar;
uniform float uTime; uniform vec3 uWind; uniform float uPx; uniform vec3 uLight; uniform vec3 uAmb;
varying vec4 vCol; varying float vSide; varying vec4 vFog; varying float vAdd;
${FOG_PARS}
void main() {
  float life = aPar.x;
  float endB = step(0.5, position.x * 0.5 + 0.5);
  vec3 P = mix(aA.xyz, aB.xyz, endB);
  float born = mix(aA.w, aB.w, endB);
  vec3 T = mix(aB.xyz - aPrev.xyz, aNext.xyz - aA.xyz, endB);
  float age = uTime - born;
  if (life <= 0.0 || uTime - aB.w >= life || dot(T, T) < 0.000001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  age = max(age, 0.0);
  // снос ветром и «расползание» старого следа
  float wob = aPar.z * min(age * 0.35, 4.0);
  P += uWind * age + vec3(sin(born * 2.3), cos(born * 1.7) * 0.6, cos(born * 2.9)) * wob;
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 side = cross(normalize(T), toCam / max(dist, 0.001));
  float sl = length(side);
  side = sl > 0.02 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = aPrev.w + aNext.w * sqrt(age);
  w = max(w, 1.3 * dist / uPx);                          // не тоньше ~1.3 пикселя
  P += side * position.y * w * 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  float a = aCol.a * smoothstep(0.0, max(aPar.y, 0.0001), age) * (1.0 - smoothstep(0.35 * life, life, age));
  a *= min(1.0, (aPrev.w + aNext.w * sqrt(age)) * uPx / (1.3 * dist));   // тонкий далёкий след бледнеет, а не рябит
  vAdd = aPar.w;
  vec3 col = aCol.rgb * mix(uAmb + uLight * 0.8, vec3(1.0), vAdd);
  vCol = vec4(col, a);
  vSide = position.y;
  vFog = vec4(wfogColor(-toCam / max(dist, 0.001)), wfogAmount(P, cameraPosition, dist));
}`;

const R_FRAG = /* glsl */ `
varying vec4 vCol; varying float vSide; varying vec4 vFog; varying float vAdd;
void main() {
  float s = 1.0 - vSide * vSide;
  float a = vCol.a * s * (0.55 + 0.45 * s);
  if (a < 0.004) discard;
  vec3 col = mix(vCol.rgb, vFog.rgb, vFog.a * (1.0 - vAdd));
  a *= 1.0 - vFog.a * mix(0.5, 1.0, vAdd);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
}`;

export function createRibbons(slots, K) {
  const total = slots * K;
  const data = new Float32Array(total * RS);
  const ib = new THREE.InstancedInterleavedBuffer(data, RS, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = quadGeo();
  const names = ['aA', 'aB', 'aPrev', 'aNext', 'aCol', 'aPar'];
  for (let i = 0; i < 6; i++) geo.setAttribute(names[i], new THREE.InterleavedBufferAttribute(ib, 4, i * 4));
  geo.instanceCount = total;
  const mat = new THREE.ShaderMaterial({
    uniforms: FXU, vertexShader: R_VERT, fragmentShader: R_FRAG,
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.name = 'fx-ribbons';
  mesh.visible = false;
  const dirty = makeDirty(ib, RS, total);
  let lastDeath = -1;

  // слот-след. Точки: фиксированные (каждые interval секунд) + «живая» голова, которая каждый кадр тянется к источнику.
  function makeTrail(slot) {
    const base = slot * K;
    const t = {
      slot, active: false, ended: true, freeAt: -1,
      life: 1, interval: 0.1, width: 1, grow: 0, r: 1, g: 1, b: 1, a: 1, fadeIn: 0.1, wobble: 0, glow: 0,
      n: 0, seg: 0, lastFix: 0, lx: 0, ly: 0, lz: 0, px: 0, py: 0, pz: 0, owner: null,
      // записать сегмент j: A = (ax..), B = (bx..), prev, next
      _write(j, ax, ay, az, ta, bx, by, bz, tb, px, py, pz, nx, ny, nz) {
        const o = (base + j) * RS, d = data;
        d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = ta;
        d[o + 4] = bx; d[o + 5] = by; d[o + 6] = bz; d[o + 7] = tb;
        d[o + 8] = px; d[o + 9] = py; d[o + 10] = pz; d[o + 11] = t.width;
        d[o + 12] = nx; d[o + 13] = ny; d[o + 14] = nz; d[o + 15] = t.grow;
        d[o + 16] = t.r; d[o + 17] = t.g; d[o + 18] = t.b; d[o + 19] = t.a;
        d[o + 20] = t.life; d[o + 21] = t.fadeIn; d[o + 22] = t.wobble; d[o + 23] = t.glow;
        dirty.mark(base + j);
      },
      setAlpha(a) { t.a = a; },
      // вести след за точкой (звать каждый кадр)
      push(p) { t.pushXYZ(p.x, p.y, p.z); },
      pushXYZ(x, y, z) {
        if (t.ended) return;
        const now = FXU.uTime.value;
        if (t.n === 0) {
          t.lx = t.px = x; t.ly = t.py = y; t.lz = t.pz = z;
          t.lastFix = now; t.n = 1; t.seg = 0; t.tFix = now;
          return;
        }
        const o = (base + t.seg) * RS, d = data;
        // голова: от последней фиксированной точки до источника
        d[o] = t.lx; d[o + 1] = t.ly; d[o + 2] = t.lz; d[o + 3] = t.tFix;
        d[o + 4] = x; d[o + 5] = y; d[o + 6] = z; d[o + 7] = now;
        d[o + 8] = t.px; d[o + 9] = t.py; d[o + 10] = t.pz; d[o + 11] = t.width;
        d[o + 12] = x * 2 - t.lx; d[o + 13] = y * 2 - t.ly; d[o + 14] = z * 2 - t.lz; d[o + 15] = t.grow;
        d[o + 16] = t.r; d[o + 17] = t.g; d[o + 18] = t.b; d[o + 19] = t.a;
        d[o + 20] = t.life; d[o + 21] = t.fadeIn; d[o + 22] = t.wobble; d[o + 23] = t.glow;
        dirty.mark(base + t.seg);
        if (now + t.life > lastDeath) lastDeath = now + t.life;
        mesh.visible = true;
        if (now - t.lastFix >= t.interval) {
          // зафиксировать точку: у предыдущего сегмента уточнить «следующую», завести новую голову
          if (t.n > 1) {
            const po = (base + (t.seg + K - 1) % K) * RS;
            d[po + 12] = x; d[po + 13] = y; d[po + 14] = z;
            dirty.mark(base + (t.seg + K - 1) % K);
          }
          t.px = t.lx; t.py = t.ly; t.pz = t.lz;
          t.lx = x; t.ly = y; t.lz = z; t.tFix = now;
          t.lastFix = now; t.n++;
          t.seg = (t.seg + 1) % K;
          d[(base + t.seg) * RS + 20] = 0;             // новый сегмент пока пуст
          dirty.mark(base + t.seg);
        }
      },
      // оборвать след (хвост дотает сам)
      end() {
        if (t.ended) return;
        t.ended = true;
        t.freeAt = FXU.uTime.value + t.life + 0.05;
        t.owner = null;
      },
    };
    return t;
  }
  const trails = [];
  for (let i = 0; i < slots; i++) trails.push(makeTrail(i));

  return {
    mesh, slots, K, trails,
    // opts: { color: [r,g,b] (линейный), alpha, width (м), grow (м/√с), life (с), fadeIn (с), wobble (м), glow 0..1, owner }
    acquire(o) {
      const now = FXU.uTime.value;
      let t = null;
      for (let i = 0; i < slots; i++) { const c = trails[i]; if (c.ended && now >= c.freeAt) { t = c; break; } }
      if (!t) return null;
      // очистить слот
      const base = t.slot * K;
      for (let j = 0; j < K; j++) data[(base + j) * RS + 20] = 0;
      dirty.mark(base); dirty.mark(base + K - 1);
      t.ended = false; t.n = 0; t.seg = 0;
      t.life = o.life || 2;
      t.interval = Math.max(t.life / (K - 2), 0.03);
      t.width = o.width || 1; t.grow = o.grow || 0;
      const c = o.color;
      t.r = c ? c[0] : 1; t.g = c ? c[1] : 1; t.b = c ? c[2] : 1;
      t.a = o.alpha == null ? 0.8 : o.alpha;
      t.fadeIn = o.fadeIn == null ? 0.08 : o.fadeIn;
      t.wobble = o.wobble || 0; t.glow = o.glow || 0;
      t.owner = o.owner || null;
      return t;
    },
    activeCount() { let n = 0; const now = FXU.uTime.value; for (let i = 0; i < slots; i++) if (!trails[i].ended || now < trails[i].freeAt) n++; return n; },
    flush() { dirty.flush(); if (FXU.uTime.value > lastDeath + 0.1) mesh.visible = false; },
    clear() {
      for (let i = 20; i < data.length; i += RS) data[i] = 0;
      for (let i = 0; i < slots; i++) { trails[i].ended = true; trails[i].freeAt = -1; trails[i].owner = null; }
      dirty.markAll(); dirty.flush();
      lastDeath = -1; mesh.visible = false;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// =====================================================================================================================
// ТРАССЕРЫ: летящий светящийся штрих от A к B. aA (xyz, рождение) aB (xyz, скорость) aC (rgb, длина) aW (ширина, -, -, -)
// =====================================================================================================================
const TS = 13;

const T_VERT = /* glsl */ `
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute float aW;
uniform float uTime; uniform float uPx;
varying vec3 vCol; varying vec2 vUv; varying float vFogK;
${FOG_PARS}
void main() {
  float t = uTime - aA.w;
  vec3 d = aB.xyz - aA.xyz;
  float len = length(d);
  float sp = aB.w;
  float headS = sp * t;
  if (sp <= 0.0 || t < 0.0 || headS > len + aC.w || len < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  d /= len;
  float e = position.x * 0.5 + 0.5;
  float s = e > 0.5 ? min(headS, len) : clamp(headS - aC.w, 0.0, len);
  vec3 P = aA.xyz + d * s;
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 side = cross(d, toCam / max(dist, 0.001));
  float sl = length(side);
  side = sl > 0.02 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = max(aW, 2.2 * dist / uPx);
  P += side * position.y * w * 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vCol = aC.rgb;
  vUv = vec2(e, position.y);
  vFogK = 1.0 - wfogAmount(P, cameraPosition, dist);
}`;

const T_FRAG = /* glsl */ `
varying vec3 vCol; varying vec2 vUv; varying float vFogK;
void main() {
  float s = 1.0 - abs(vUv.y);
  float a = s * s * (0.25 + 0.75 * vUv.x) * vFogK;
  vec3 col = mix(vCol, vec3(1.0), smoothstep(0.55, 1.0, s) * 0.8 * vUv.x);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a * 1.6, 0.0);
}`;

export function createTracers(max) {
  const data = new Float32Array(max * TS);
  const ib = new THREE.InstancedInterleavedBuffer(data, TS, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = quadGeo();
  geo.setAttribute('aA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  geo.setAttribute('aB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
  geo.setAttribute('aC', new THREE.InterleavedBufferAttribute(ib, 4, 8));
  geo.setAttribute('aW', new THREE.InterleavedBufferAttribute(ib, 1, 12));
  geo.instanceCount = max;
  const mat = new THREE.ShaderMaterial({
    uniforms: FXU, vertexShader: T_VERT, fragmentShader: T_FRAG,
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 13;
  mesh.name = 'fx-tracers';
  mesh.visible = false;
  const dirty = makeDirty(ib, TS, max);
  let head = 0, pending = 0, lastDeath = -1;
  return {
    mesh, max,
    spawn(ax, ay, az, bx, by, bz, speed, length, width, r, g, b) {
      const o = head * TS, d = data, now = FXU.uTime.value;
      d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = now;
      d[o + 4] = bx; d[o + 5] = by; d[o + 6] = bz; d[o + 7] = speed;
      d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = length;
      d[o + 12] = width;
      head = head + 1 === max ? 0 : head + 1;
      pending++;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const end = now + (Math.sqrt(dx * dx + dy * dy + dz * dz) + length) / speed;
      if (end > lastDeath) lastDeath = end;
    },
    flush() {
      if (pending) {
        const from = head - pending;
        if (pending >= max || from < 0) dirty.markAll(); else dirty.ring(from, pending);
        pending = 0;
        dirty.flush();
        mesh.visible = true;
      } else if (mesh.visible && FXU.uTime.value > lastDeath + 0.05) mesh.visible = false;
    },
    clear() {
      for (let i = 7; i < data.length; i += TS) data[i] = 0;
      dirty.markAll(); dirty.flush();
      head = 0; pending = 0; lastDeath = -1; mesh.visible = false;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// =====================================================================================================================
// ТЕНИ САМОЛЁТОВ: один InstancedMesh, силуэт «крест» (фюзеляж + крыло + оперение), размывается с высотой
// =====================================================================================================================
const S_VERT = /* glsl */ `
attribute vec2 aSh;
varying vec2 vUv; varying vec2 vSh; varying float vFogK;
${FOG_PARS}
void main() {
  vUv = position.xz;
  vSh = aSh;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  vFogK = 1.0 - wfogAmount(wp.xyz, cameraPosition, distance(wp.xyz, cameraPosition));
}`;

const S_FRAG = /* glsl */ `
varying vec2 vUv; varying vec2 vSh; varying float vFogK;
void main() {
  vec2 p = vUv * 1.3;                                   // запас под размытие
  float soft = vSh.y;
  float body = length(vec2(p.x / (0.14 + soft * 0.5), p.y));
  float wing = length(vec2(p.x, (p.y - 0.06) / (0.2 + soft * 0.55)));
  float tail = length(vec2(p.x / 0.4, (p.y - 0.84) / (0.11 + soft * 0.3)));
  float d = min(min(body, wing), mix(tail, 9.0, step(1.0, tail * 0.3 + soft)));
  float a = vSh.x * (1.0 - smoothstep(1.0 - min(0.9, 0.12 + soft), 1.0 + soft * 0.25, d)) * vFogK;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.01, 0.03, a);
}`;

export function createShadows(max) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const sh = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
  sh.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aSh', sh);
  const mat = new THREE.ShaderMaterial({
    uniforms: FXU, vertexShader: S_VERT, fragmentShader: S_FRAG,
    transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.InstancedMesh(g, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.count = 0;
  mesh.name = 'fx-shadows';
  return { mesh, max, attr: sh, dispose() { g.dispose(); mat.dispose(); } };
}
