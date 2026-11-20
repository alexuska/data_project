// Общая «атмосфера» мира: разделяемые uniform-ы и GLSL-вставки (дымка с учётом высоты и направления на солнце,
// вода у берега), которыми патчатся все материалы мира. Значения uniform-ов каждый кадр обновляет sky.js.
import * as THREE from 'three';

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
};

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
  vec4 t1 = texture2D(uSeaTex, sp.xz * (1.0 / 70.0) + uTime * vec2(0.021, 0.013));
  vec4 t2 = texture2D(uSeaTex, sp.zx * (1.0 / 640.0) - uTime * vec2(0.0045, 0.0061));
  vec4 t3 = texture2D(uSeaTex, sp.xz * (1.0 / 5200.0) + uTime * vec2(0.0011, -0.0007));
  float nearF = 1.0 - smoothstep(250.0, 2200.0, dist);
  float midF = 1.0 - smoothstep(4000.0, 22000.0, dist);
  vec2 nxz = ((t1.rg - 0.5) * nearF * 0.3 + (t2.rg - 0.5) * midF * 0.12 + (t3.rg - 0.5) * 0.045) * uSeaP.x;
  vec3 N = normalize(vec3(nxz.x, 1.0, nxz.y));
  float ndv = clamp(-V.y + (N.x * V.x + N.z * V.z) * -0.25, 0.0, 1.0);
  float fres = pow(1.0 - ndv, 4.0);
  vec3 col = body * (1.0 + ((t2.b - 0.5) * 0.07 * midF + (t3.b - 0.5) * 0.05 + (t1.b - 0.5) * 0.1 * nearF) * uSeaP.x);
  vec3 R = reflect(V, N);
  R.y = abs(R.y);
  vec3 sky = mix(wfogColor(R), uZenith, pow(clamp(R.y, 0.0, 1.0), 0.55));
  col = mix(col, sky, clamp(0.06 + fres * 0.8, 0.0, 1.0) * uSeaP.z);
  float sd = max(dot(R, uSpecDir), 0.0);
  float sd2 = sd * sd; sd2 *= sd2; sd2 *= sd2;
  col += uSeaSpec * uSeaP.y * (pow(sd2, 14.0) * 1.3 + sd2 * sd2 * 0.16);
  return col;
}
`;

// Вставки в стандартные материалы three (Lambert/Basic/Points)
const VERT_PARS = /* glsl */ `
varying vec3 vWPos;
#ifdef W_TREE
attribute float aBaseY;
uniform vec2 uTreeR;
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
#ifdef W_SHORE
${SEA_PARS}
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
      float op = 1.0 - exp(-depth * 0.26);
      vec3 body = mix(uSeaShallow, uSeaDeep, smoothstep(0.5, 21.0, depth));
      vec3 bed = gl_FragColor.rgb * mix(vec3(1.0), uSeaShallow * 1.5, clamp(depth * 0.7, 0.0, 1.0));
      vec3 w = seaShade(mix(bed, body, op), sp, wV, wfl * tS);
      float foam = smoothstep(0.9 + wob * 0.8, 0.0, depth) * 0.9;
      float band = smoothstep(0.4, 0.0, abs(depth - (2.0 + wob * 1.7))) * 0.4 * (1.0 - smoothstep(2.5, 4.6, depth));
      gl_FragColor.rgb = mix(w, uFoam, clamp(foam + band, 0.0, 1.0));
    } else {
      gl_FragColor.rgb *= mix(0.74, 1.0, smoothstep(0.0, 0.4, vWPos.y));
    }
  }
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, wfogColor(wV), wfogAmount(vWPos, cameraPosition, wfl));
}
`;

// Патч материала three: общая дымка мира (+ вода у берега для рельефа, + «рост» деревьев вдали)
export function patchMaterial(mat, opts = {}) {
  const key = 'w' + (opts.shore ? 's' : '') + (opts.tree ? 't' : '');
  mat.fog = false;
  mat.defines = Object.assign(mat.defines || {}, opts.shore ? { W_SHORE: 1 } : null, opts.tree ? { W_TREE: 1 } : null);
  mat.onBeforeCompile = (sh) => {
    for (const k in U) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <fog_pars_vertex>', VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BEGIN)
      .replace('#include <fog_vertex>', VERT_END);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', FRAG_PARS)
      .replace('#include <fog_fragment>', '')
      .replace('#include <tonemapping_fragment>', FRAG_MAIN + '\n#include <tonemapping_fragment>');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// sRGB-hex -> линейные компоненты [r, g, b]
const _c = new THREE.Color();
export function lin(hex) {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}
