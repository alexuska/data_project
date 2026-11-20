// Море: один диск, следующий за камерой, без записи глубины (рисуется первым, сразу после неба).
// Гранёные «волны» и блики — из маленькой процедурной текстуры; цвет мелководья делает шейдер рельефа (env.js).
import * as THREE from 'three';
import { U, FOG_PARS, SEA_PARS } from './env.js';
import { LAKE } from './layout.js';
import { mulberry32 } from '../core/util.js';

function makeSeaTexture() {
  const S = 128, C = 12;
  const rnd = mulberry32(4242);
  const pts = [];
  for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) pts.push({ x: (i + 0.15 + rnd() * 0.7) / C, y: (j + 0.15 + rnd() * 0.7) / C, nx: rnd() * 2 - 1, nz: rnd() * 2 - 1, b: rnd() });
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      const ci = Math.floor(u * C), cj = Math.floor(v * C);
      let best = null, bd = 9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const p = pts[((cj + dj + C) % C) * C + ((ci + di + C) % C)];
        let dx = Math.abs(p.x - u), dy = Math.abs(p.y - v);
        if (dx > 0.5) dx = 1 - dx;
        if (dy > 0.5) dy = 1 - dy;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      }
      const o = (y * S + x) * 4;
      data[o] = 127.5 + best.nx * 127; data[o + 1] = 127.5 + best.nz * 127; data[o + 2] = best.b * 255; data[o + 3] = 255;
    }
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
  return new THREE.ShaderMaterial({
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
      ${FOG_PARS}
      ${SEA_PARS}
      void main() {
        vec3 wfd = vWPos - cameraPosition;
        float d = length(wfd);
        vec3 V = wfd / d;
        #ifdef W_FOLLOW
        vec3 col = seaShade(uSeaDeep, vWPos, V, d);
        #else
        vec3 col = seaShade(mix(uSeaDeep, uSeaShallow, 0.3), vWPos, V, d);
        #endif
        col = mix(col, wfogColor(V), wfogAmount(vWPos, cameraPosition, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function createSea(group) {
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
  const c45 = Math.SQRT1_2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let u = Math.cos(a) * (LAKE.a + 420), v = Math.sin(a) * (LAKE.b + 420); // вдоль оси / поперёк
    let al = 1450 + u; // от плотины
    if (al < 6) al = 6;
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
  void c45;
  return { sea, lake };
}
