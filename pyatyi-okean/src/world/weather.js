// Погода: плавные переходы между типами, ветер, осадки частицами вокруг камеры, молнии.
import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from '../core/util.js';
import { U } from './env.js';

export const WEATHER = {
  clear: { vis: 45000, fogH: 3500, cover: 0.2, deck: 0, base: 1700, top: 2500, dark: 0, haze: 0, rain: 0, snow: 0, wind: 3, turb: 0.04, lightning: 0 },
  cloudy: { vis: 36000, fogH: 3200, cover: 0.62, deck: 0, base: 1400, top: 2300, dark: 0.08, haze: 0.08, rain: 0, snow: 0, wind: 6, turb: 0.14, lightning: 0 },
  overcast: { vis: 22000, fogH: 2600, cover: 0.3, deck: 1, base: 1100, top: 1700, dark: 0.15, haze: 0.3, rain: 0, snow: 0, wind: 8, turb: 0.2, lightning: 0 },
  rain: { vis: 9000, fogH: 2200, cover: 0.25, deck: 1, base: 800, top: 1700, dark: 0.45, haze: 0.5, rain: 0.7, snow: 0, wind: 10, turb: 0.35, lightning: 0 },
  storm: { vis: 6500, fogH: 2200, cover: 0.4, deck: 1, base: 650, top: 2100, dark: 0.9, haze: 0.5, rain: 1, snow: 0, wind: 17, turb: 0.8, lightning: 1 },
  fog: { vis: 1500, fogH: 230, cover: 0.12, deck: 0, base: 1800, top: 2600, dark: 0, haze: 0.85, rain: 0, snow: 0, wind: 1.5, turb: 0.03, lightning: 0 },
  snow: { vis: 5500, fogH: 2000, cover: 0.2, deck: 1, base: 900, top: 1600, dark: 0.2, haze: 0.6, rain: 0, snow: 1, wind: 7, turb: 0.25, lightning: 0 },
};
const KEYS = ['vis', 'fogH', 'cover', 'deck', 'base', 'top', 'dark', 'haze', 'rain', 'snow', 'wind', 'turb', 'lightning'];

export function createWeather(G, world) {
  const wx = { ...WEATHER.clear, flash: 0, deckBase: 1700, deckTop: 2500 };
  let target = WEATHER.clear;
  let t = 0, windDir = 4.1, flashT = 99, nextBolt = 6;
  const rnd = mulberry32(2024);
  const q = G.quality.level;
  const NR = q === 'low' ? 700 : q === 'high' ? 2600 : 1500;
  const BOX = 56;

  // ---- дождь: отрезки, «завёрнутые» в куб вокруг камеры ----
  const rp = new Float32Array(NR * 6), re = new Float32Array(NR * 2);
  for (let i = 0; i < NR; i++) {
    const x = rnd(), y = rnd(), z = rnd();
    rp.set([x, y, z, x, y, z], i * 6);
    re[i * 2] = 0; re[i * 2 + 1] = 1;
  }
  const pu = {
    uOff: { value: new THREE.Vector3() }, uStreak: { value: new THREE.Vector3(0, -1, 0) }, uAmt: { value: 0 },
    uCol: { value: new THREE.Color('#c8d4e0') }, uPx: { value: 1 }, uSnow: { value: 0 }, uTime: U.uTime,
  };
  const PV = /* glsl */ `
    attribute float aEnd;
    uniform vec3 uOff;
    uniform vec3 uStreak;
    uniform float uAmt;
    uniform float uPx;
    uniform float uSnow;
    uniform float uTime;
    varying float vA;
    void main() {
      vec3 p = mod(position * ${BOX.toFixed(1)} + uOff - cameraPosition, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
      p.x += uSnow * sin(uTime * 1.3 + position.y * 40.0) * 0.6;
      float d = length(p);
      p += uStreak * aEnd;
      vec4 mv = viewMatrix * vec4(p + cameraPosition, 1.0);
      gl_Position = projectionMatrix * mv;
      vA = uAmt * smoothstep(${(BOX / 2).toFixed(1)}, ${(BOX / 3).toFixed(1)}, d) * smoothstep(0.5, 3.0, d);
      gl_PointSize = clamp(uPx * 150.0 / max(-mv.z, 1.0), 1.5 * uPx, 7.0 * uPx);
    }`;
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.ShaderMaterial({
      uniforms: pu, transparent: true, depthWrite: false, fog: false,
      vertexShader: PV,
      fragmentShader: /* glsl */ `uniform vec3 uCol; varying float vA;
        void main() {
          gl_FragColor = vec4(uCol, vA * 0.42);
          #include <colorspace_fragment>
        }`,
    })
  );
  const snowGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(NR * 3);
  for (let i = 0; i < NR * 3; i++) sp[i] = rnd();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  snowGeo.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(NR), 1));
  const snow = new THREE.Points(
    snowGeo,
    new THREE.ShaderMaterial({
      uniforms: pu, transparent: true, depthWrite: false, fog: false,
      vertexShader: PV,
      fragmentShader: /* glsl */ `uniform vec3 uCol; varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(uCol * 1.2, vA * smoothstep(0.5, 0.2, r) * 0.9);
          #include <colorspace_fragment>
        }`,
    })
  );
  for (const o of [rain, snow]) { o.frustumCulled = false; o.renderOrder = 30; o.visible = false; world.group.add(o); }
  const off = new THREE.Vector3(), camPrev = new THREE.Vector3(), camVel = new THREE.Vector3();
  let camInit = false;

  // ---- молния: ломаная лента ----
  const SEGS = 14;
  const bp = new Float32Array(SEGS * 2 * 18);
  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
  boltGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const bolt = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: '#dfe8ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
  bolt.frustumCulled = false;
  bolt.visible = false;
  bolt.renderOrder = 25;
  world.group.add(bolt);
  function strike(cam) {
    const a = rnd() * Math.PI * 2, d = 2500 + rnd() * 7000;
    const x0 = cam.position.x + Math.sin(a) * d, z0 = cam.position.z + Math.cos(a) * d;
    const top = wx.base + 150, gy = Math.max(0, world.heightAt(x0, z0));
    let px = x0 + (rnd() - 0.5) * 600, pz = z0 + (rnd() - 0.5) * 600, py = top, o = 0;
    const w = 5 + d * 0.0022;
    for (let i = 0; i < SEGS; i++) {
      const k = (i + 1) / SEGS;
      const nx = lerp(px, x0, 0.35) + (rnd() - 0.5) * 260 * (1 - k), nz = lerp(pz, z0, 0.35) + (rnd() - 0.5) * 260 * (1 - k), ny = lerp(top, gy, k);
      // две скрещённые ленты
      for (let c = 0; c < 2; c++) {
        const wx_ = c ? w : 0, wz_ = c ? 0 : w;
        bp[o++] = px - wx_; bp[o++] = py; bp[o++] = pz - wz_; bp[o++] = px + wx_; bp[o++] = py; bp[o++] = pz + wz_; bp[o++] = nx + wx_; bp[o++] = ny; bp[o++] = nz + wz_;
        bp[o++] = px - wx_; bp[o++] = py; bp[o++] = pz - wz_; bp[o++] = nx + wx_; bp[o++] = ny; bp[o++] = nz + wz_; bp[o++] = nx - wx_; bp[o++] = ny; bp[o++] = nz - wz_;
      }
      px = nx; py = ny; pz = nz;
    }
    boltGeo.attributes.position.needsUpdate = true;
    flashT = 0;
    G.bus.emit('world:lightning', { x: x0, z: z0, dist: d });
  }

  function publish() {
    const w = world.weather;
    w.visibility = wx.vis; w.cloudBase = wx.base; w.cloudTop = wx.top; w.turbulence = wx.turb; w.rain = wx.rain; w.snow = wx.snow;
    w.windSpeed = wx.wind; w.cover = Math.max(wx.cover, wx.deck); w.lightning = wx.lightning;
  }

  const api = {
    wx,
    set(type, immediate) {
      if (!WEATHER[type]) type = 'clear';
      target = WEATHER[type];
      world.weather.type = type;
      if (immediate) api.snap();
    },
    snap() {
      for (const k of KEYS) wx[k] = target[k];
      wx.deckBase = wx.base; wx.deckTop = wx.top;
      publish();
    },
    update(dt, cam) {
      t += dt;
      const a = 1 - Math.exp(-dt / 3.5);
      for (const k of KEYS) wx[k] += (target[k] - wx[k]) * a;
      wx.deckBase = wx.base; wx.deckTop = wx.top;
      publish();

      // ветер: медленно гуляет по направлению, порывы в непогоду
      const dir = windDir + Math.sin(t * 0.013) * 0.5 + Math.sin(t * 0.21) * 0.08 * wx.turb;
      const sp = wx.wind * (1 + 0.3 * wx.turb * Math.sin(t * 0.7) + 0.15 * wx.turb * Math.sin(t * 2.3));
      world.wind.set(Math.sin(dir) * sp, 0, -Math.cos(dir) * sp);

      // осадки
      const below = cam.position.y < wx.deckTop ? 1 : 0;
      const rainAmt = wx.rain * below * wx.deck, snowAmt = wx.snow * below * wx.deck;
      rain.visible = rainAmt > 0.02;
      snow.visible = snowAmt > 0.02;
      if (rain.visible || snow.visible) {
        if (!camInit) { camPrev.copy(cam.position); camInit = true; }
        if (dt > 0) {
          camVel.subVectors(cam.position, camPrev).multiplyScalar(1 / dt);
          if (camVel.lengthSq() > 500 * 500) camVel.set(0, 0, 0);
        }
        camPrev.copy(cam.position);
        const snowing = snow.visible && !rain.visible;
        const fall = snowing ? 2.2 : 24;
        off.x += world.wind.x * dt; off.y -= fall * dt; off.z += world.wind.z * dt;
        if (off.y < -BOX * 64) off.y += BOX * 64;
        pu.uOff.value.copy(off);
        pu.uSnow.value = snowing ? 1 : 0;
        pu.uAmt.value = snowing ? snowAmt : rainAmt;
        pu.uStreak.value.set(world.wind.x - camVel.x, -fall - camVel.y, world.wind.z - camVel.z).multiplyScalar(snowing ? 0 : 0.028);
        if (pu.uStreak.value.lengthSq() > 16) pu.uStreak.value.setLength(4);
        const l = clamp(world.env.daylight * 1.3 + 0.12, 0.1, 1);
        pu.uCol.value.setRGB(0.78 * l, 0.83 * l, 0.9 * l);
        pu.uPx.value = G.quality.pixelRatio || 1;
        rain.geometry.setDrawRange(0, Math.floor(NR * clamp(rainAmt, 0, 1)) * 2);
        snow.geometry.setDrawRange(0, Math.floor(NR * clamp(snowAmt, 0, 1)));
      } else camInit = false;

      // молнии
      if (wx.lightning > 0.5 && dt > 0) {
        nextBolt -= dt;
        if (nextBolt <= 0) { strike(cam); nextBolt = 3.5 + rnd() * 9; }
      }
      if (flashT < 2) {
        flashT += dt;
        const f = Math.max(Math.exp(-flashT * 11), flashT > 0.14 ? 0.75 * Math.exp(-(flashT - 0.14) * 13) : 0, flashT > 0.34 ? 0.4 * Math.exp(-(flashT - 0.34) * 9) : 0);
        wx.flash = f;
        bolt.visible = f > 0.03;
        bolt.material.opacity = Math.min(1, f * 1.6);
      } else { wx.flash = 0; bolt.visible = false; }
    },
  };
  return api;
}
