// Огни мира (полосы, подходы, PAPI, улицы, маяки) — одним объектом Points с аддитивным смешением.
// Типы: 0 — постоянный, 1 — бегущие вспышки подхода, 2 — PAPI (цвет зависит от угла глиссады),
// 3 — проблесковый маяк, 4 — виден только с одной стороны (пороговые огни).
import * as THREE from 'three';
import { U } from './env.js';

export function createLights(G, group) {
  const pos = [], col = [], par = [], dir = [];
  let points = null;
  const uni = {
    uTime: U.uTime, uFogP: U.uFogP,
    uOn: { value: 0 }, // 0 — день, 1 — ночь/плохая видимость
    uScale: { value: 600 },
    uPx: { value: 1 },
  };
  const api = {
    count: 0,
    // col — [r,g,b] 0..1 (sRGB-подобные яркие значения), size — «сила» огня, dayVis — видимость днём 0..1
    add(x, y, z, c, size = 2, type = 0, phase = 0, dayVis = 0.25, dx = 0, dz = 0, ang = 0) {
      pos.push(x, y, z); col.push(c[0], c[1], c[2]); par.push(size, type, phase, dayVis); dir.push(dx, dz, ang);
      api.count++;
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(col), 3));
      g.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(par), 4));
      g.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array(dir), 3));
      points = new THREE.Points(
        g,
        new THREE.ShaderMaterial({
          uniforms: uni,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
          vertexShader: /* glsl */ `
            attribute vec3 aCol;
            attribute vec4 aP;
            attribute vec3 aDir;
            uniform float uTime;
            uniform float uOn;
            uniform float uScale;
            uniform float uPx;
            uniform vec4 uFogP;
            varying vec3 vCol;
            void main() {
              vec4 mv = viewMatrix * vec4(position, 1.0);
              float d = length(mv.xyz);
              float vis = mix(aP.w, 1.0, uOn);
              vec3 c = aCol;
              float size = aP.x;
              if (aP.y > 0.5 && aP.y < 1.5) {
                float ph = fract(uTime * 1.6 - aP.z);
                vis *= step(ph, 0.09) * 1.6;
              } else if (aP.y < 2.5 && aP.y > 1.5) {
                vec2 to = cameraPosition.xz - position.xz;
                float along = dot(to, aDir.xy);
                float ang = atan(cameraPosition.y - position.y, max(along, 1.0));
                c = ang > aDir.z ? vec3(1.0, 0.97, 0.9) : vec3(1.0, 0.08, 0.04);
                vis = step(0.0, along) * max(vis, 0.85);
              } else if (aP.y < 3.5 && aP.y > 2.5) {
                float ph = fract(uTime * 0.8 + aP.z);
                vis *= smoothstep(0.16, 0.02, abs(ph - 0.5)) * 1.5 + 0.05;
              } else if (aP.y > 3.5) {
                vis *= step(0.0, dot(cameraPosition.xz - position.xz, aDir.xy));
              }
              float ya = max(cameraPosition.y, 0.0) * uFogP.y;
              float tau = d * uFogP.x * exp(-ya * 0.5) * 0.55;
              vis *= exp(-tau * tau - d * uFogP.w);
              float px = size * uScale / max(d, 1.0);
              float minPx = (1.3 + 1.1 * uOn) * uPx;
              vis *= clamp(px / minPx, 0.0, 1.0) * 0.75 + 0.25;
              vis *= 1.0 - smoothstep(26000.0, 34000.0, d);
              gl_PointSize = clamp(px, minPx, mix(16.0, 46.0, uOn) * uPx);
              vCol = c * vis;
              gl_Position = projectionMatrix * mv;
              if (vis < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            varying vec3 vCol;
            void main() {
              float r = length(gl_PointCoord - 0.5) * 2.0;
              float a = smoothstep(1.0, 0.0, r);
              a = a * a * 0.55 + smoothstep(0.42, 0.0, r) * 0.75;
              gl_FragColor = vec4(vCol * a, 1.0);
              #include <colorspace_fragment>
            }`,
        })
      );
      points.frustumCulled = false;
      points.renderOrder = 20;
      points.name = 'lights';
      group.add(points);
      pos.length = col.length = par.length = dir.length = 0;
      return points;
    },
    update(env) {
      uni.uOn.value = env.lightsOn;
      uni.uPx.value = G.quality.pixelRatio || 1;
      const h = G.canvas.height || 600;
      uni.uScale.value = (h * 0.5) / Math.tan((G.camera.fov * Math.PI) / 360) * 1.0;
    },
  };
  return api;
}
