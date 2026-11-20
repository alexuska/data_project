// Море: один диск, следующий за камерой, без записи глубины (рисуется первым, сразу после неба).
// Рябь — гладкая бесшовная карта наклонов (сумма синусоид, считается один раз), три масштаба с разным дрейфом;
// отражение неба по Френелю, солнечная дорожка, цвет мелководья и пена — в seaShade (env.js) и шейдере рельефа.
import * as THREE from 'three';
import { U, FOG_PARS, SEA_PARS, trackQuality, getNoiseTexture } from './env.js';
import { LAKE } from './layout.js';
import { mulberry32 } from '../core/util.js';

// RG — наклон поверхности (dh/dx, dh/dy), B — высота; всё бесшовно на квадрате текстуры
function makeSeaTexture() {
  const S = 128;
  const rnd = mulberry32(4242);
  const waves = [];
  const main = 0.6; // основное направление волн
  for (let i = 0; i < 22; i++) {
    const k = 1 + Math.floor(Math.pow(rnd(), 1.4) * 11); // целые волновые числа — бесшовно
    const a = main + (rnd() - 0.5) * (i < 6 ? 1.2 : 2.6);
    let kx = Math.round(Math.cos(a) * k), ky = Math.round(Math.sin(a) * k);
    if (!kx && !ky) kx = 1;
    const len = Math.hypot(kx, ky);
    waves.push({ kx, ky, amp: 1 / Math.pow(len, 1.35), ph: rnd() * Math.PI * 2 });
  }
  const gx = new Float32Array(S * S), gy = new Float32Array(S * S), hh = new Float32Array(S * S);
  let gm = 0, hlo = 1e9, hhi = -1e9;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let h = 0, dx = 0, dy = 0;
      for (const w of waves) {
        const ph = 2 * Math.PI * (w.kx * u + w.ky * v) + w.ph;
        // заострённый гребень: sin + доля гармоники
        const s = Math.sin(ph), c = Math.cos(ph);
        h += w.amp * (s + 0.5 * s * s - 0.25); // = sin − 0.25·cos 2φ: острее гребень, положе впадина
        const dd = w.amp * 2 * Math.PI * (c + 0.25 * 4 * s * c);
        dx += dd * w.kx; dy += dd * w.ky;
      }
      const o = y * S + x;
      gx[o] = dx; gy[o] = dy; hh[o] = h;
      gm = Math.max(gm, Math.abs(dx), Math.abs(dy));
      hlo = Math.min(hlo, h); hhi = Math.max(hhi, h);
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = Math.round(127.5 + (gx[i] / gm) * 127);
    data[i * 4 + 1] = Math.round(127.5 + (gy[i] / gm) * 127);
    data[i * 4 + 2] = Math.round(((hh[i] - hlo) / (hhi - hlo)) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function waterMaterial(follow) {
  const uniforms = {};
  for (const k in U) uniforms[k] = U[k];
  return trackQuality(new THREE.ShaderMaterial({
    uniforms,
    defines: follow ? { W_FOLLOW: 1 } : {},
    depthTest: !follow,
    depthWrite: !follow,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main() {
        #ifdef W_FOLLOW
        vec3 wp = vec3(position.x + cameraPosition.x, 0.0, position.z + cameraPosition.z);
        #else
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif
        vWPos = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      uniform sampler2D uNoise;
      uniform vec4 uCloudSh;
      uniform float uCloudAlt;
      ${FOG_PARS}
      ${SEA_PARS}
      void main() {
        vec3 wfd = vWPos - cameraPosition;
        float d = length(wfd);
        vec3 V = wfd / d;
        // крупные пятна цвета (течения, глубина) — чтобы море не было однотонным
        float big = texture2D(uNoise, vWPos.xz * (1.0 / 21000.0)).r;
        #ifdef W_FOLLOW
        vec3 body = uSeaDeep * (0.85 + 0.3 * big);
        #else
        vec3 body = mix(uSeaDeep, uSeaShallow, 0.22) * (0.9 + 0.2 * big);
        #endif
        vec3 col = seaShade(body, vWPos, V, d);
        #if W_Q > 0
        // тени облаков на воде
        vec2 xz = vWPos.xz + uSunDir.xz / max(uSunDir.y, 0.25) * uCloudAlt;
        float n = texture2D(uNoise, (xz + uCloudSh.xy) * (1.0 / 90000.0)).b;
        col *= 1.0 - uCloudSh.w * 0.55 * smoothstep(uCloudSh.z - 0.02, uCloudSh.z + 0.06, n);
        #endif
        col = mix(col, wfogColor(V), wfogAmount(vWPos, cameraPosition, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
}

export function createSea(group) {
  getNoiseTexture();
  U.uSeaTex.value = makeSeaTexture();
  const R = 84000;
  const geo = new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(geo, waterMaterial(true));
  sea.frustumCulled = false;
  sea.renderOrder = -900;
  sea.matrixAutoUpdate = false;
  sea.name = 'sea';
  group.add(sea);

  // водохранилище: плоский многоугольник на уровне LAKE.level, обрезанный по линии плотины
  const n = 28, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * (LAKE.a + 420), v = Math.sin(a) * (LAKE.b + 420); // вдоль оси / поперёк
    let al = 1450 + u; // от плотины
    if (al < 36) al = 36;
    pts.push(LAKE.damX + LAKE.ax * al - LAKE.az * v, LAKE.damZ + LAKE.az * al + LAKE.ax * v);
  }
  const lp = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    lp.push(LAKE.cx, LAKE.level, LAKE.cz, pts[j * 2], LAKE.level, pts[j * 2 + 1], pts[i * 2], LAKE.level, pts[i * 2 + 1]);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  lg.computeBoundingSphere();
  const lake = new THREE.Mesh(lg, waterMaterial(false));
  lake.matrixAutoUpdate = false;
  lake.name = 'lake';
  group.add(lake);
  return { sea, lake };
}
