// Общая «атмосфера» мира: разделяемые uniform-ы и GLSL-вставки (дымка с учётом высоты и направления на солнце,
// вода у берега, детали рельефа, тени облаков), которыми патчатся все материалы мира. Значения uniform-ов каждый
// кадр обновляют sky.js и clouds.js. Шум — одна маленькая бесшовная DataTexture (uNoise), без файлов.
import * as THREE from 'three';

export const CLOUD_TILE = 90000; // период плитки облаков (м) — общий для облаков и их теней

export const U = {
  uTime: { value: 0 },
  uFogA: { value: new THREE.Color('#bfe0f4') }, // дымка у горизонта (в сторону от солнца)
  uFogSun: { value: new THREE.Color('#d6ecf8') }, // дымка в сторону солнца
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() }, // на источник «тёплой» дымки (солнце)
  uFogP: { value: new THREE.Vector4(2 / 45000, 1 / 3500, 0, 0) }, // x: σ = 2/видимость, y: 1/масштаб высоты, w: плотность «внутри облака»
  uZenith: { value: new THREE.Color('#2f7ed8') },
  uSeaDeep: { value: new THREE.Color('#0e5c9c') },
  uSeaShallow: { value: new THREE.Color('#3fd0c0') },
  uSeaSpec: { value: new THREE.Color('#fff6e8') }, // цвет бликов (солнце/луна)
  uFoam: { value: new THREE.Color('#ffffff') },
  uSeaTex: { value: null },
  uSeaP: { value: new THREE.Vector4(1, 1, 0, 0) }, // x: волнение, y: сила блика, z: отражение неба
  uSpecDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() }, // направление на светило для бликов
  uTreeR: { value: new THREE.Vector2(11000, 13000) }, // дальность «роста» деревьев
  uNight: { value: 0 },
  uNoise: { value: null },
  uCloudSh: { value: new THREE.Vector4(0, 0, 2, 0) }, // xy: смещение облаков ветром, z: порог шума, w: сила тени
  uCloudAlt: { value: 2000 }, // средняя высота кучевых (для сдвига тени по солнцу)
};

// ---------- бесшовный шум (RGBA, 256²) ----------
// R: fbm 4 периода на текстуру (крупные пятна), G: fbm 16 периодов, B: «облачный» шум 32 периода (тени и размещение облаков),
// A: мелкое зерно 64 периода.
const NS = 256;
let noiseData = null;
function lattice(P, seed) {
  const a = new Float32Array(P * P);
  let s = seed >>> 0;
  for (let i = 0; i < P * P; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s / 4294967296; }
  return a;
}
function addOctave(out, P, amp, seed) {
  const L = lattice(P, seed), k = P / NS;
  for (let y = 0; y < NS; y++) {
    const fy = y * k, iy = fy | 0, ty = fy - iy, uy = ty * ty * (3 - 2 * ty);
    const r0 = iy * P, r1 = ((iy + 1) % P) * P;
    for (let x = 0; x < NS; x++) {
      const fx = x * k, ix = fx | 0, tx = fx - ix, ux = tx * tx * (3 - 2 * tx), ix1 = (ix + 1) % P;
      const a = L[r0 + ix], b = L[r0 + ix1], c = L[r1 + ix], d = L[r1 + ix1];
      out[y * NS + x] += amp * (a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy);
    }
  }
}
function fbmChannel(P0, oct, seed) {
  const out = new Float32Array(NS * NS);
  let amp = 0.5, norm = 0, P = P0;
  for (let o = 0; o < oct && P <= NS; o++) { addOctave(out, P, amp, seed + o * 101); norm += amp; amp *= 0.5; P *= 2; }
  // растянуть до 0..1 по фактическому размаху
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < out.length; i++) { const v = out[i] / norm; out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const sc = 1 / (hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * sc;
  return out;
}
export function getNoiseTexture() {
  if (U.uNoise.value) return U.uNoise.value;
  const ch = [fbmChannel(4, 4, 11), fbmChannel(16, 3, 23), fbmChannel(32, 2, 37), fbmChannel(64, 2, 53)];
  const data = new Uint8Array(NS * NS * 4);
  for (let i = 0; i < NS * NS; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(ch[c][i] * 255);
  noiseData = data;
  const tex = new THREE.DataTexture(data, NS, NS, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  U.uNoise.value = tex;
  return tex;
}
// та же выборка на CPU (билинейно, как texture2D с повтором): c — канал 0..3, u, v — в долях текстуры
export function sampleNoise(c, u, v) {
  getNoiseTexture();
  const fx = (((u % 1) + 1) % 1) * NS - 0.5, fy = (((v % 1) + 1) % 1) * NS - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const x0 = (ix + NS) % NS, x1 = (ix + 1) % NS, y0 = (iy + NS) % NS, y1 = (iy + 1) % NS;
  const g = (x, y) => noiseData[(y * NS + x) * 4 + c] / 255;
  const a = g(x0, y0), b = g(x1, y0), cc = g(x0, y1), d = g(x1, y1);
  return (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
}

// ---------- качество: определение W_Q (0 — low, 1 — medium, 2 — high) во всех патченых материалах ----------
let QL = 1;
const PATCHED = [];
export function setWorldQuality(level) {
  const q = level === 'low' ? 0 : level === 'high' ? 2 : 1;
  if (q === QL) return;
  QL = q;
  for (const m of PATCHED) { m.defines.W_Q = q; m.needsUpdate = true; }
}
export const worldQ = () => QL;
// свой ShaderMaterial, которому нужно определение W_Q
export function trackQuality(mat) {
  mat.defines = Object.assign(mat.defines || {}, { W_Q: QL });
  PATCHED.push(mat);
  return mat;
}

const _c = new THREE.Color();
const g3 = (hex) => { _c.set(hex); return `vec3(${_c.r.toFixed(4)}, ${_c.g.toFixed(4)}, ${_c.b.toFixed(4)})`; };

export const FOG_PARS = /* glsl */ `
uniform vec3 uFogA;
uniform vec3 uFogSun;
uniform vec3 uSunDir;
uniform vec4 uFogP;
vec3 wfogColor(vec3 dir) {
  float s = max(dot(dir, uSunDir), 0.0);
  float s2 = s * s;
  return mix(uFogA, uFogSun, s2 * s2 * 0.8 + pow(s, 24.0) * 0.2);
}
float wfogAmount(vec3 p, vec3 cam, float d) {
  float ya = max(cam.y, 0.0) * uFogP.y, yb = max(p.y, 0.0) * uFogP.y;
  float dy = yb - ya;
  float ea = exp(-ya);
  float k = abs(dy) > 0.002 ? (ea - exp(-yb)) / dy : ea;
  float tau = d * uFogP.x * k;
  return 1.0 - exp(-tau * tau - d * uFogP.w);
}
`;

// Тень облаков: тот же шум (канал B), по которому расставлены кучевые облака (clouds.js), сдвинутый по солнцу
export const SHADOW_PARS = /* glsl */ `
uniform sampler2D uNoise;
uniform vec4 uCloudSh;
uniform float uCloudAlt;
float wCloudShadow(vec3 p) {
  vec2 xz = p.xz + uSunDir.xz / max(uSunDir.y, 0.25) * max(uCloudAlt - p.y, 0.0);
  float n = texture2D(uNoise, (xz + uCloudSh.xy) * ${(1 / CLOUD_TILE).toExponential(6)}).b;
  return 1.0 - uCloudSh.w * smoothstep(uCloudSh.z - 0.02, uCloudSh.z + 0.06, n);
}
`;

export const SEA_PARS = /* glsl */ `
uniform sampler2D uSeaTex;
uniform vec3 uSeaDeep;
uniform vec3 uSeaShallow;
uniform vec3 uSeaSpec;
uniform vec3 uFoam;
uniform vec3 uZenith;
uniform vec3 uSpecDir;
uniform vec4 uSeaP;
uniform float uTime;
// body — цвет толщи воды; sp — точка на поверхности; V — единичный вектор от камеры; dist — дальность
vec3 seaShade(vec3 body, vec3 sp, vec3 V, float dist) {
  float nearF = 1.0 - smoothstep(250.0, 2400.0, dist);
  float midF = 1.0 - smoothstep(2500.0, 16000.0, dist);
  vec4 t3 = texture2D(uSeaTex, sp.xz * (1.0 / 1730.0) + uTime * vec2(0.0019, -0.0012));
  vec4 t2 = texture2D(uSeaTex, sp.zx * (1.0 / 263.0) - uTime * vec2(0.0105, 0.0071));
  vec2 g = (t2.rg - 0.5) * midF * 0.26 + (t3.rg - 0.5) * 0.2;
  float hgt = t2.b * midF + t3.b;
#if W_Q > 0
  vec4 t1 = texture2D(uSeaTex, sp.xz * (1.0 / 47.0) + uTime * vec2(0.031, 0.019));
  g += (t1.rg - 0.5) * nearF * 0.32;
  hgt += t1.b * nearF * 0.6;
#endif
  g *= uSeaP.x;
  vec3 N = normalize(vec3(g.x, 1.0, g.y));
  float ndv = clamp(dot(N, -V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // толща: гребни чуть светлее и бирюзовее, впадины глубже
  vec3 col = body * (0.86 + 0.26 * hgt * 0.5) + uSeaShallow * 0.05 * max(hgt - 1.0, 0.0);
  vec3 R = reflect(V, N);
  R.y = max(R.y, 0.02);
  vec3 sky = mix(wfogColor(R), uZenith, pow(R.y, 0.6));
  col = mix(col, sky, clamp(fres, 0.0, 1.0) * uSeaP.z);
  // солнечная дорожка: шероховатость растёт с дальностью (мелкая рябь сливается) — дорожка вытягивается к горизонту
  float sd = max(dot(R, uSpecDir), 0.0);
  float rough = mix(0.0, 1.0, smoothstep(300.0, 9000.0, dist));
  float sharp = pow(sd, mix(1400.0, 260.0, rough));
  float broad = pow(sd, mix(90.0, 40.0, rough));
  col += uSeaSpec * uSeaP.y * (sharp * 2.6 + broad * 0.32) * (0.4 + 0.6 * fres + 0.4 * ndv);
  return col;
}
`;

// ---------- детали рельефа (W_TERRAIN) ----------
const TERRAIN_PARS = /* glsl */ `
varying vec4 vW;
varying float vSnowH;
varying vec3 vWN;
const vec3 T_ROCK = ${g3('#857c71')};
const vec3 T_ROCKN = ${g3('#727a84')};
const vec3 T_ROCKV = ${g3('#47403d')};
const vec3 T_SCREE = ${g3('#a29a8c')};
const vec3 T_SNOW = ${g3('#e2e8f0')};
const vec3 T_HEDGE = ${g3('#4f7a3c')};
vec3 wCrop(float h) {
  if (h < 0.2) return ${g3('#d6c46e')};
  if (h < 0.36) return ${g3('#9a7a55')};
  if (h < 0.52) return ${g3('#93bd5e')};
  if (h < 0.66) return ${g3('#5d9248')};
  if (h < 0.8) return ${g3('#c4b25c')};
  if (h < 0.9) return ${g3('#b7c47a')};
  return ${g3('#7d8a4f')};
}
float wHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 wTerrain(vec3 base, float dist) {
  vec3 p = vWPos;
  vec3 N = normalize(vWN);
  float slope = 1.0 - N.y;
  vec2 xz = p.xz;
  float nM = texture2D(uNoise, xz * (1.0 / 9100.0)).r;
  vec4 nmv = texture2D(uNoise, xz * (1.0 / 2300.0) + 0.37);
  float nm = nmv.g;
#if W_Q > 0
  float nf = texture2D(uNoise, xz * (1.0 / 420.0)).a;
  float nff = texture2D(uNoise, xz * (1.0 / 61.0) + 0.5).a;
  nf = mix(nf, nff, 0.45 * (1.0 - smoothstep(150.0, 900.0, dist)));
  float n25 = texture2D(uNoise, xz * (1.0 / 410.0) + 0.21).g;
#else
  float n25 = 0.5;
  float nf = 0.5;
#endif
  vec3 c = base;
  if (p.y > 0.3) {
    // крупная и средняя неоднородность: пятна сухой/сочной травы
    float lush = (1.0 - vW.w) * (1.0 - vW.z);
    c *= 0.86 + 0.28 * nM + 0.3 * (nm - 0.5) + 0.36 * (n25 - 0.5) * lush;
    c = mix(c, c * vec3(1.1, 1.05, 0.78), smoothstep(0.5, 0.78, n25) * 0.55 * lush);
    c = mix(c, c * vec3(0.8, 0.9, 0.82), smoothstep(0.55, 0.25, nm) * 0.5 * lush);
    c = mix(c, c * vec3(1.1, 1.03, 0.82), smoothstep(0.58, 0.82, nmv.b) * 0.55 * (1.0 - vW.w));
    // полог леса: тёмные просветы между кронами, кроны — комками
    float crown = nf * 0.55 + n25 * 0.45;
    c = mix(c, c * vec3(0.78, 0.86, 0.8) * (0.45 + 1.05 * smoothstep(0.3, 0.75, crown)), smoothstep(0.05, 0.6, vW.z));
    // поля: повёрнутая сетка участков, борозды, межи
    if (vW.x > 0.5) {
      vec2 uv = vec2(xz.x * 0.921 + xz.y * 0.39, -xz.x * 0.39 + xz.y * 0.921);
      vec2 sz = vec2(420.0, 260.0);
      vec2 cell = floor(uv / sz);
      vec2 f = uv - cell * sz;
      float h = wHash2(cell + 17.0);
      vec3 fc = wCrop(h) * (0.92 + 0.16 * wHash2(cell + 5.0));
      float fur = sin(mix(f.x, f.y, step(0.5, wHash2(cell + 3.0))) * 1.25);
      fc *= 1.0 + fur * 0.07 * (1.0 - smoothstep(120.0, 700.0, dist));
      fc *= 0.94 + 0.12 * nf;
      vec2 e = min(f, sz - f);
      float edge = 1.0 - smoothstep(2.5, 5.0 + dist * 0.003, min(e.x, e.y));
      c = mix(fc, T_HEDGE * (0.8 + 0.4 * nf), edge * 0.85);
    }
    // мокрый песок у воды
    c = mix(c, c * vec3(0.64, 0.66, 0.7), vW.w * (1.0 - smoothstep(0.5, 1.7 + nm * 1.4, p.y)));
    // осыпи и скалы по уклону
    float arc = smoothstep(-17500.0, -21500.0, p.z);
    vec3 rock = mix(mix(T_ROCK, T_ROCKN, arc), T_ROCKV, step(0.9, vW.y));
    rock *= 0.8 + 0.34 * nm + 0.1 * sin(p.y * 0.19 + nM * 11.0) + 0.3 * (nf - 0.5);
    float sc = smoothstep(0.08, 0.17, slope + (nm - 0.5) * 0.08) * (1.0 - vW.z) * (1.0 - vW.w) * 0.6;
    c = mix(c, mix(rock, T_SCREE, 0.45) * (0.9 + 0.2 * nf), sc);
    float rk = smoothstep(0.16, 0.27, slope + (nm - 0.5) * 0.12 + (nf - 0.5) * 0.06);
    c = mix(c, rock, rk);
    // снег: неровная граница, сползает с крутых склонов
    float sn = smoothstep(-22.0, 22.0, vSnowH + (nm - 0.5) * 130.0 + (nM - 0.5) * 90.0 + (nf - 0.5) * 24.0);
    sn *= 1.0 - smoothstep(0.34, 0.52, slope + (nm - 0.5) * 0.14);
    c = mix(c, T_SNOW * (0.9 + 0.1 * nf + 0.08 * (nm - 0.5)) * mix(vec3(1.0), vec3(0.9, 0.95, 1.04), slope * 2.0), sn);
  }
  // мелкое зерно, чтобы вблизи не было плоской заливки
  c *= 1.0 + (nf - 0.5) * 0.2;
  return c;
}
`;

// Вставки в стандартные материалы three (Lambert/Basic/Points)
const VERT_PARS = /* glsl */ `
varying vec3 vWPos;
#ifdef W_TREE
attribute float aBaseY;
uniform vec2 uTreeR;
#endif
#ifdef W_TERRAIN
attribute vec4 aW;
attribute float aSnow;
varying vec4 vW;
varying float vSnowH;
varying vec3 vWN;
#endif
`;
const VERT_BEGIN = /* glsl */ `
#ifdef W_TREE
{
  float wd = distance(cameraPosition.xz, transformed.xz);
  float wg = 1.0 - smoothstep(uTreeR.x, uTreeR.y, wd);
  transformed.y = mix(aBaseY, transformed.y, wg);
}
#endif
#ifdef W_TERRAIN
vW = aW; vSnowH = aSnow; vWN = normal;
#endif
`;
const VERT_END = /* glsl */ `
{
  vec4 wfp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wfp = instanceMatrix * wfp;
  #endif
  vWPos = (modelMatrix * wfp).xyz;
}
`;
const FRAG_PARS = /* glsl */ `
varying vec3 vWPos;
${FOG_PARS}
${SHADOW_PARS}
#ifdef W_SHORE
${SEA_PARS}
#endif
#ifdef W_TERRAIN
${TERRAIN_PARS}
#endif
`;
const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
#ifdef W_TERRAIN
diffuseColor.rgb = wTerrain(diffuseColor.rgb, length(vWPos - cameraPosition));
#endif
#ifdef W_GRAIN
// асфальт/бетон: пятна и зерно
diffuseColor.rgb *= 0.84 + 0.2 * texture2D(uNoise, vWPos.xz * (1.0 / 290.0)).a + 0.16 * (texture2D(uNoise, vWPos.xz * (1.0 / 1700.0)).g - 0.5);
#endif
`;
const FRAG_LIGHT = /* glsl */ `
#include <lights_fragment_end>
#if W_Q > 0
reflectedLight.directDiffuse *= wCloudShadow(vWPos);
#endif
`;
const FRAG_MAIN = /* glsl */ `
{
  vec3 wfd = vWPos - cameraPosition;
  float wfl = length(wfd);
  vec3 wV = wfd / wfl;
  #ifdef W_SHORE
  if (vWPos.y < 0.4) {
    float depth = -vWPos.y;
    float camH = max(cameraPosition.y, 0.5);
    float tS = camH / (camH + max(depth, 0.0));
    vec3 sp = cameraPosition + wfd * tS;
    float wob = sin(uTime * 0.7 + sp.x * 0.021 + sp.z * 0.017) * 0.5 + 0.5;
    if (depth > 0.0) {
      float op = 1.0 - exp(-depth * 0.24);
      vec3 body = mix(uSeaShallow, uSeaDeep, smoothstep(0.5, 21.0, depth));
      vec3 bed = gl_FragColor.rgb * mix(vec3(1.0), uSeaShallow * 1.5, clamp(depth * 0.6, 0.0, 1.0));
      vec3 w = seaShade(mix(bed, body, op), sp, wV, wfl * tS);
      float fn = texture2D(uNoise, sp.xz * (1.0 / 160.0) + uTime * 0.002).a;
      float foam = smoothstep(0.7 + wob * 0.8 + fn * 0.5, 0.0, depth) * 0.85;
      float band = smoothstep(0.45, 0.0, abs(depth - (2.0 + wob * 1.8))) * 0.4 * (1.0 - smoothstep(2.5, 4.8, depth)) * smoothstep(0.35, 0.65, fn);
      gl_FragColor.rgb = mix(w, uFoam, clamp(foam + band, 0.0, 1.0));
    } else {
      gl_FragColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.4, vWPos.y));
    }
  }
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, wfogColor(wV), wfogAmount(vWPos, cameraPosition, wfl));
}
`;

// Патч материала three: общая дымка мира (+ вода у берега и детали для рельефа, + «рост» деревьев вдали, + тени облаков)
export function patchMaterial(mat, opts = {}) {
  const key = 'w' + (opts.shore ? 's' : '') + (opts.tree ? 't' : '') + (opts.terrain ? 'g' : '') + (opts.grain ? 'a' : '');
  getNoiseTexture();
  mat.fog = false;
  mat.defines = Object.assign(mat.defines || {}, opts.shore ? { W_SHORE: 1 } : null, opts.tree ? { W_TREE: 1 } : null, opts.terrain ? { W_TERRAIN: 1 } : null, opts.grain ? { W_GRAIN: 1 } : null, { W_Q: QL });
  mat.onBeforeCompile = (sh) => {
    for (const k in U) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <fog_pars_vertex>', VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BEGIN)
      .replace('#include <fog_vertex>', VERT_END);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', FRAG_PARS)
      .replace('#include <fog_fragment>', '')
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <lights_fragment_end>', FRAG_LIGHT)
      .replace('#include <tonemapping_fragment>', FRAG_MAIN + '\n#include <tonemapping_fragment>');
  };
  mat.customProgramCacheKey = () => key + mat.defines.W_Q;
  PATCHED.push(mat);
  return mat;
}

// sRGB-hex -> линейные компоненты [r, g, b]
export function lin(hex) {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}
