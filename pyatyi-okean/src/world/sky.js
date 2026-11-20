// Небо и свет: купол с градиентом, солнце, луна, звёзды, цикл дня и ночи. Пишет общие uniform-ы (env.js),
// управляет светом сцены и туманом, наполняет world.env.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG } from '../core/util.js';
import { U, FOG_PARS } from './env.js';
import { POI_BY_ID } from './layout.js';

// Ключевые кадры по высоте солнца над горизонтом (градусы)
const KE = [-18, -8, -3, 0, 4, 10, 25, 60];
const K = {
  zenith: ['#040918', '#0a1534', '#192a5e', '#244284', '#2a5aa6', '#2b6cc0', '#2b7bd6', '#2674d4'],
  fogA: ['#0d1830', '#1b2748', '#474a7c', '#8a7fa6', '#c9a9a8', '#cfc2c0', '#b8d6ee', '#bfe0f5'],
  fogSun: ['#0d1830', '#6a3a48', '#e0683a', '#ff9648', '#ffc070', '#ffe2ae', '#d8eaf4', '#d2eaf8'],
  sun: ['#000000', '#000000', '#ff5a2a', '#ff7c3a', '#ffae62', '#ffd69c', '#fff0d8', '#fff6ea'],
  hemiSky: ['#4a62b0', '#4e60aa', '#6c6eb4', '#8c86c0', '#9ea6d8', '#aabfe8', '#bcd6f6', '#c6e0ff'],
  hemiGnd: ['#18203c', '#202544', '#3c3248', '#5c4c4c', '#70645a', '#787062', '#7c8268', '#7d8a6a'],
  seaDeep: ['#040a1a', '#08122e', '#15254c', '#1e3766', '#1a4a80', '#13548e', '#0e5a98', '#0c5c9e'],
  seaShallow: ['#0a2634', '#0e3044', '#2a5a70', '#4a8c98', '#5ab4ac', '#52c4b8', '#42d0c2', '#3dd2c4'],
  glow: ['#000000', '#501c1c', '#d0502a', '#ff7a30', '#ffa850', '#ffd090', '#fff0d0', '#fff4e0'],
};
const KN = {
  sunInt: [0, 0, 0.12, 0.95, 2.1, 2.65, 2.95, 3.1],
  hemiInt: [0.78, 0.8, 0.9, 1.0, 1.08, 1.12, 1.15, 1.15],
  glowAmt: [0, 0.5, 1.0, 1.0, 0.9, 0.6, 0.3, 0.22],
  curve: [2.2, 2.4, 2.6, 2.8, 3.2, 3.6, 4.2, 4.6],
};
const KC = {};
for (const k in K) KC[k] = K[k].map((h) => new THREE.Color(h));

const MOON_LIGHT = new THREE.Color('#9db6ff');
const PINK = new THREE.Color('#ff8f9a');
const COOL = new THREE.Color('#9fb0d8');
const WARMWHITE = new THREE.Color('#fffaf0');
const MOON_DISC = new THREE.Color('#dfe8ff');
const GREY = new THREE.Color();
const _c = new THREE.Color(), _c2 = new THREE.Color();
const _v = new THREE.Vector3();
const LUM = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

function kf(name, i, t, out) {
  const a = KC[name];
  return out.copy(a[i]).lerp(a[i + 1], t);
}

const LAT = 45 * DEG;
function celestial(out, hourAngle, dec) {
  const sE = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(hourAngle);
  const east = -Math.cos(dec) * Math.sin(hourAngle);
  const north = Math.cos(LAT) * Math.sin(dec) - Math.sin(LAT) * Math.cos(dec) * Math.cos(hourAngle);
  return out.set(east, sE, -north).normalize();
}

export function createSky(G, world) {
  const scene = G.scene;
  const hemi = new THREE.HemisphereLight('#c6e0ff', '#7d8a6a', 1.15);
  const sun = new THREE.DirectionalLight('#fff6ea', 3);
  hemi.name = 'world-hemi';
  sun.name = 'world-sun';
  scene.add(hemi, sun, sun.target);
  scene.fog = new THREE.FogExp2('#bfe0f5', 0.00004);
  scene.background = null;
  G.renderer.setClearColor('#bfe0f5', 1);

  // ---- купол ----
  const skyU = {
    uFogA: U.uFogA, uFogSun: U.uFogSun, uSunDir: U.uSunDir, uFogP: U.uFogP, uZenith: U.uZenith,
    uSunPos: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunDisc: { value: new THREE.Color('#fff8e8') },
    uMoonCol: { value: new THREE.Color('#000000') },
    uGlow: { value: new THREE.Color('#fff4e0') },
    uSkyP: { value: new THREE.Vector4(4.5, 0.2, 0, 0) }, // x: кривая градиента, y: сила ореола, z: «в облаке», w: вспышка молнии
    uCloudCol: { value: new THREE.Color('#ffffff') },
    uCity: { value: new THREE.Vector4(0, 1, 0, 30) }, // xy: направление на город, z: сила зарева, w: спад по высоте
  };
  const dome = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1000, 3),
    new THREE.ShaderMaterial({
      uniforms: skyU,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        ${FOG_PARS}
        uniform vec3 uZenith;
        uniform vec3 uSunPos;
        uniform vec3 uMoonDir;
        uniform vec3 uSunDisc;
        uniform vec3 uMoonCol;
        uniform vec3 uGlow;
        uniform vec4 uSkyP;
        uniform vec3 uCloudCol;
        uniform vec4 uCity;
        void main() {
          vec3 d = normalize(vDir);
          vec3 hor = wfogColor(d);
          float h = max(d.y, 0.0);
          // градиент зенит → горизонт; у самого горизонта — светлая полоса
          float t = pow(1.0 - h, uSkyP.x);
          vec3 col = mix(uZenith, hor, t);
          col = mix(col, hor * 1.06, (1.0 - smoothstep(0.0, 0.06, h)) * 0.5);
          // ниже горизонта (видно с высоты) — дымка чуть темнее
          col = mix(col, hor * 0.93, smoothstep(0.0, -0.25, d.y));
          float sd = dot(d, uSunPos);
          float sdp = max(sd, 0.0);
          float above = smoothstep(-0.04, 0.02, d.y);
          // рассеяние Ми вокруг солнца (Хеньи — Гринстейн) + широкое тёплое гало
          float g = 0.8;
          float mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * sd, 1.5);
          float s8 = sdp * sdp; s8 *= s8; s8 *= s8;
          col += uGlow * uSkyP.y * (mie * 0.034 + s8 * 0.16) * (0.35 + 0.65 * above);
          // солнечный диск с потемнением к краю и короной
          float disc = smoothstep(0.99962, 0.99978, sd);
          float limb = 0.8 + 0.2 * smoothstep(0.99962, 0.99995, sd);
          col += uSunDisc * (disc * limb * 1.25 + pow(sdp, 2200.0) * 0.8) * above;
          // луна с ореолом
          float md = max(dot(d, uMoonDir), 0.0);
          float m8 = md * md; m8 *= m8; m8 *= m8;
          float m64 = m8 * m8; m64 *= m64; m64 *= m64;
          float mdisc = smoothstep(0.99975, 0.99986, md);
          col += uMoonCol * (mdisc * 1.15 + pow(m64, 5.0) * 0.25 + m64 * 0.07 + m8 * 0.015) * above;
          // зарево города у горизонта
          vec2 dh = d.xz / max(length(d.xz), 1e-4);
          float cg = max(dot(dh, uCity.xy), 0.0);
          cg = cg * cg; cg *= cg;
          col += vec3(1.0, 0.52, 0.22) * uCity.z * cg * exp(-max(d.y + 0.01, 0.0) * uCity.w);
          col = mix(col, hor, uSkyP.z);
          col += vec3(0.75, 0.8, 1.0) * uSkyP.w;
          // лёгкий дизеринг против полос градиента на 8-битном экране
          vec2 fc = gl_FragCoord.xy;
          col += (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * (1.5 / 255.0);
          gl_FragColor = vec4(max(col, 0.0), 1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.matrixAutoUpdate = false;
  world.group.add(dome);

  // ---- звёзды ----
  const NS = G.quality.level === 'low' ? 700 : 1400;
  const sp = new Float32Array(NS * 3), sa = new Float32Array(NS * 3);
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < NS; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp[i * 3] = r * Math.cos(a) * 900; sp[i * 3 + 1] = u * 900; sp[i * 3 + 2] = r * Math.sin(a) * 900;
    const m = Math.pow(rnd(), 5);
    sa[i * 3] = 1.2 + m * 3.2; // размер
    sa[i * 3 + 1] = 0.45 + 0.55 * rnd(); // яркость
    sa[i * 3 + 2] = rnd() * 6.28; // фаза мерцания
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('aStar', new THREE.BufferAttribute(sa, 3));
  const starU = { uOpacity: { value: 0 }, uTime: U.uTime, uPx: { value: 1 } };
  const stars = new THREE.Points(
    starGeo,
    new THREE.ShaderMaterial({
      uniforms: starU,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        attribute vec3 aStar;
        uniform float uTime;
        uniform float uPx;
        uniform float uOpacity;
        varying float vA;
        void main() {
          vec3 p = mat3(modelMatrix) * position;
          gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * p, 1.0);
          float tw = 0.75 + 0.25 * sin(uTime * (1.5 + aStar.z * 0.4) + aStar.z * 7.0);
          vA = aStar.y * tw * uOpacity * smoothstep(0.02, 0.22, p.y / 900.0);
          gl_PointSize = aStar.x * uPx;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(q)) * vA;
          gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * a, 1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  stars.frustumCulled = false;
  stars.renderOrder = -990;
  world.group.add(stars);

  const env = world.env;
  const sunDir = world.sunDir;
  const moonDir = env.moonDir;
  const cZen = new THREE.Color(), cFogA = new THREE.Color(), cFogSun = new THREE.Color(), cSun = new THREE.Color();
  const cHs = new THREE.Color(), cHg = new THREE.Color(), cSeaD = new THREE.Color(), cSeaS = new THREE.Color(), cGlow = new THREE.Color();
  let lightK = 1; // сглаженный множитель «под облаками»

  function update(dt, wx, cam) {
    const tod = world.timeOfDay;
    const ha = ((tod - 12.5) * 15) * DEG;
    celestial(sunDir, ha, 14.5 * DEG);
    celestial(moonDir, ha + Math.PI + 0.5, -6 * DEG);
    const elev = Math.asin(clamp(sunDir.y, -1, 1)) / DEG;
    let i = 0;
    while (i < KE.length - 2 && elev > KE[i + 1]) i++;
    const t = clamp((elev - KE[i]) / (KE[i + 1] - KE[i]), 0, 1);
    kf('zenith', i, t, cZen); kf('fogA', i, t, cFogA); kf('fogSun', i, t, cFogSun); kf('sun', i, t, cSun);
    kf('hemiSky', i, t, cHs); kf('hemiGnd', i, t, cHg); kf('seaDeep', i, t, cSeaD); kf('seaShallow', i, t, cSeaS); kf('glow', i, t, cGlow);
    let sunInt = lerp(KN.sunInt[i], KN.sunInt[i + 1], t);
    let hemiInt = lerp(KN.hemiInt[i], KN.hemiInt[i + 1], t);
    let glowAmt = lerp(KN.glowAmt[i], KN.glowAmt[i + 1], t);
    const curve = lerp(KN.curve[i], KN.curve[i + 1], t);
    const night = 1 - smoothstep(-9, -1.5, elev);
    const twilight = smoothstep(-10, -2, elev) * (1 - smoothstep(6, 14, elev));

    // рассвет — розовее и прохладнее заката
    if (tod < 12.5 && twilight > 0) {
      cFogSun.lerp(PINK, 0.3 * twilight);
      cGlow.lerp(PINK, 0.25 * twilight);
      cFogA.lerp(COOL, 0.25 * twilight);
    }

    // ---- погода ----
    const camY = cam.position.y;
    const under = wx.deck * (1 - smoothstep(wx.deckBase + (wx.deckTop - wx.deckBase) * 0.3, wx.deckTop, camY));
    lightK = dt > 0 ? lerp(lightK, under, 1 - Math.exp(-dt * 2.5)) : under;
    const uk = lightK;
    const dark = wx.dark;
    // серое небо под сплошной облачностью
    if (uk > 0.001 || wx.haze > 0.001) {
      const lz = LUM(cZen), lf = LUM(cFogA);
      const dayL = clamp(lf * 1.15 + 0.012, 0, 1);
      GREY.setRGB(dayL * 0.92, dayL * 0.96, dayL * 1.02);
      _c.copy(GREY).multiplyScalar(0.62 - 0.34 * dark);
      cZen.lerp(_c, uk * 0.96);
      _c.copy(GREY).multiplyScalar(0.8 - 0.42 * dark);
      const hz = Math.max(uk * 0.9, wx.haze * 0.75);
      cFogA.lerp(_c, hz);
      cFogSun.lerp(_c, Math.max(uk * 0.9, wx.haze * 0.55));
      _c.setRGB(lz, lz, lz);
      cHs.lerp(_c2.copy(GREY).multiplyScalar(1.5), uk * 0.6);
      cSeaD.lerp(_c.copy(GREY).multiplyScalar(0.22 - 0.08 * dark), uk * 0.8);
      cSeaS.lerp(_c.copy(GREY).multiplyScalar(0.55), uk * 0.6);
      glowAmt *= 1 - uk;
      sunInt *= 1 - uk * (0.82 + 0.12 * dark);
      hemiInt *= 1 - uk * (0.12 + 0.38 * dark);
    }
    // вспышка молнии
    const flash = wx.flash;
    hemiInt += flash * 2.2;

    // ---- луна ----
    const moonUp = smoothstep(-0.05, 0.12, moonDir.y);
    const moonInt = night * moonUp * 0.62 * (1 - uk * 0.8);
    const useMoon = sunInt < 0.02 && moonInt > 0.001;

    // ---- свет ----
    if (useMoon) {
      sun.color.copy(MOON_LIGHT);
      sun.intensity = moonInt;
      _v.copy(moonDir);
      if (_v.y < 0.5) { const hl = Math.hypot(_v.x, _v.z) || 1; _v.x *= 0.866 / hl; _v.z *= 0.866 / hl; _v.y = 0.5; }
      sun.position.copy(_v);
      env.lightDir.copy(_v);
    } else {
      sun.color.copy(cSun);
      sun.intensity = sunInt;
      // у самого горизонта свет не должен быть строго сбоку — приподнимем на пару градусов
      // «художественный» подъём света: при низком солнце равнина всё равно тепло освещена, а склоны дают контраст
      _v.copy(sunDir);
      if (_v.y < 0.42) { const hl = Math.hypot(_v.x, _v.z) || 1; _v.x *= 0.9075 / hl; _v.z *= 0.9075 / hl; _v.y = 0.42; }
      sun.position.copy(_v);
      env.lightDir.copy(_v);
    }
    sun.target.position.set(0, 0, 0);
    hemi.color.copy(cHs);
    hemi.groundColor.copy(cHg);
    hemi.intensity = hemiInt;

    // ---- дымка ----
    const inCloud = env.inCloud;
    const cloudCol = env.cloudColor;
    if (inCloud > 0.001) {
      cFogA.lerp(cloudCol, inCloud * 0.94);
      cFogSun.lerp(cloudCol, inCloud * 0.85);
    }
    U.uFogA.value.copy(cFogA);
    U.uFogSun.value.copy(cFogSun);
    U.uZenith.value.copy(cZen);
    // направление «тёплой» стороны: солнце (ночью — луна, слабее)
    U.uSunDir.value.copy(sunDir);
    const sigma = 2 / Math.max(200, wx.vis);
    U.uFogP.value.set(sigma, 1 / wx.fogH, 0, inCloud * 0.011);
    // туман сцены для чужих материалов: плотность на высоте камеры
    const k = Math.max(0.3, Math.exp(-Math.max(0, camY) / wx.fogH));
    scene.fog.density = sigma * (0.55 + 0.45 * k) * k + inCloud * 0.008;
    _c.copy(cFogA).lerp(cFogSun, 0.2);
    scene.fog.color.copy(_c);
    G.renderer.setClearColor(_c, 1);

    // ---- море ----
    U.uSeaDeep.value.copy(cSeaD);
    U.uSeaShallow.value.copy(cSeaS);
    if (useMoon) U.uSeaSpec.value.copy(MOON_LIGHT).multiplyScalar(moonInt * 0.9);
    else U.uSeaSpec.value.copy(cSun).multiplyScalar(Math.min(1.25, sunInt * 0.55));
    U.uSpecDir.value.copy(useMoon ? moonDir : sunDir);
    const light = clamp(hemiInt * 0.33 * LUM(cHs) * 1.6 + sun.intensity * 0.3 * LUM(sun.color), 0, 1.1);
    U.uFoam.value.setRGB(light, light, light).lerp(_c.copy(sun.color).multiplyScalar(light), 0.35);
    U.uSeaP.value.set(0.75 + wx.wind * 0.06, 1 - uk, 1, 0);
    U.uNight.value = night;

    // ---- купол ----
    skyU.uSunPos.value.copy(sunDir);
    skyU.uMoonDir.value.copy(moonDir);
    skyU.uSunDisc.value.copy(cSun).lerp(WARMWHITE, smoothstep(2, 20, elev) * 0.8).multiplyScalar(1.15 * (1 - uk) * smoothstep(-2.5, 0, elev) + 0.0001);
    if (uk > 0.5) skyU.uSunDisc.value.copy(cZen);
    skyU.uMoonCol.value.copy(MOON_DISC).multiplyScalar(smoothstep(-2, -8, elev) * (1 - uk) * 0.95);
    skyU.uGlow.value.copy(cGlow);
    skyU.uSkyP.value.set(curve, glowAmt, inCloud, flash * 0.5);
    skyU.uCloudCol.value.copy(cloudCol);
    // зарево города на горизонте ночью
    {
      const cp = POI_BY_ID.city_yasny;
      const cdx = cp.x - cam.position.x, cdz = cp.z - cam.position.z, cd = Math.hypot(cdx, cdz) || 1;
      const amt = smoothstep(0.25, 0.9, env.lightsOn) * (1 - uk * 0.6) * (1 - wx.haze * 0.5) * 0.085 * (1 - smoothstep(4000, 32000, cd)) * smoothstep(900, 3500, cd);
      skyU.uCity.value.set(cdx / cd, cdz / cd, amt, 9 + 6e4 / Math.max(cd, 2000));
    }
    dome.visible = true;

    // ---- звёзды ----
    starU.uOpacity.value = night * (1 - uk) * (1 - inCloud) * (1 - wx.haze * 0.8);
    starU.uPx.value = G.quality.pixelRatio || 1;
    stars.visible = starU.uOpacity.value > 0.01;
    stars.rotation.set(0.6, tod * 0.26, 0);
    stars.updateMatrixWorld();

    // ---- world.env ----
    env.night = night;
    env.twilight = twilight;
    env.sunElev = elev;
    env.under = uk;
    env.sunColor.copy(sun.color);
    env.sunIntensity = sun.intensity;
    env.skyColor.copy(cZen);
    env.fogColor.copy(cFogA);
    env.fogSunColor.copy(cFogSun);
    env.horizonColor.copy(cFogA);
    env.ambientColor.copy(cHs);
    env.ambientIntensity = hemiInt;
    env.daylight = clamp(light, 0, 1);
    env.lightsOn = clamp(Math.max(night, 1 - smoothstep(0, 9, elev), uk * 0.75 * (0.4 + dark), wx.haze * 0.7), 0, 1);
    env.flash = flash;
  }

  return { update, hemi, sun, dome, stars };
}
