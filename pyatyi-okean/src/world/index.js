// МИР «Архипелаг Семи Ветров». Публичный контракт world — в ARCHITECTURE.md.
// Сверх контракта: world.env, world.timeRate, world.carrier, world.lake, world.setWeather(type, immediate),
// world.makeMapCanvas(size), world.surfaceHeight(x, z), у аэродромов — parking[], aprons[]; событие шины 'world:lightning'.
import * as THREE from 'three';
import { WORLD_SIZE, AIRPORTS, POIS, AIRPORT_BY_ID, POI_BY_ID, CARRIER, LAKE, runwayLocal as rwLocal } from './layout.js';
import { headingVec, smoothstep } from '../core/util.js';
import { buildHeightfield, lakeInside } from './heightfield.js';
import { buildTerrain, makeMapCanvas } from './terrain.js';
import { createSea } from './sea.js';
import { createSky } from './sky.js';
import { createWeather } from './weather.js';
import { createClouds } from './clouds.js';
import { createLights } from './lights.js';
import { createAirports } from './airports.js';
import { createProps } from './props.js';
import { makeWindowTextures } from './geo.js';
import { U, patchMaterial } from './env.js';

export const runwayLocal = rwLocal;
const DAY_RATE = 24 / (40 * 60); // игровых часов в секунду: сутки ≈ 40 минут

export function createWorld(G) {
  const group = new THREE.Group();
  group.name = 'world';
  G.scene.add(group);

  const T0 = performance.now();
  const hf = buildHeightfield();
  const T1 = performance.now();
  const heightAt = hf.heightAt;
  const carrierAp = AIRPORT_BY_ID.carrier, carrierRw = carrierAp.runways[0];
  const cd = headingVec(CARRIER.heading);
  const landAirports = AIRPORTS.filter((a) => a.kind !== 'carrier');
  // предвычисленные оси полос
  for (const a of AIRPORTS) for (const rw of a.runways) { const d = headingVec(rw.heading); rw._dx = d.x; rw._dz = d.z; }

  function groundAt(x, z) {
    // авианосец
    let dx = x - CARRIER.x, dz = z - CARRIER.z;
    if (dx > -200 && dx < 200 && dz > -200 && dz < 200) {
      const al = dx * cd.x + dz * cd.z, ac = dx * -cd.z + dz * cd.x;
      if (al >= -CARRIER.length / 2 && al <= CARRIER.length / 2 && ac >= -CARRIER.width / 2 && ac <= CARRIER.width / 2) {
        return { y: CARRIER.deckY, surface: 'carrier', airport: carrierAp, runway: carrierRw, along: al, across: ac };
      }
      return { y: 0, surface: 'water' };
    }
    for (let i = 0; i < landAirports.length; i++) {
      const a = landAirports[i];
      dx = x - a.x; dz = z - a.z;
      const R = a.radius;
      if (dx > R || dx < -R || dz > R || dz < -R) continue;
      const rws = a.runways;
      for (let j = 0; j < rws.length; j++) {
        const rw = rws[j];
        const rx = x - rw.cx, rz = z - rw.cz;
        const al = rx * rw._dx + rz * rw._dz, ac = rx * -rw._dz + rz * rw._dx;
        if (al <= rw.length / 2 && al >= -rw.length / 2 && ac <= rw.width / 2 && ac >= -rw.width / 2) {
          return { y: a.elevation, surface: 'runway', airport: a, runway: rw, along: al, across: ac };
        }
      }
      const aps = a.aprons;
      for (let j = 0; j < aps.length; j++) {
        const r = aps[j];
        const rx = x - r.cx, rz = z - r.cz;
        const u = rx * r.ux + rz * r.uz, v = rx * -r.uz + rz * r.ux;
        if (u <= r.hl && u >= -r.hl && v <= r.hw && v >= -r.hw) return { y: a.elevation, surface: 'apron', airport: a };
      }
      break;
    }
    const h = heightAt(x, z);
    if (h <= 0) return { y: 0, surface: 'water' };
    if (h < LAKE.level) {
      dx = x - LAKE.cx; dz = z - LAKE.cz;
      if (dx > -2600 && dx < 2600 && dz > -2600 && dz < 2600 && lakeInside(x, z) > -420) return { y: LAKE.level, surface: 'water' };
    }
    return { y: h, surface: 'ground' };
  }

  const env = {
    night: 0, twilight: 0, sunElev: 30, daylight: 1, lightsOn: 0, under: 0, inCloud: 0, flash: 0,
    sunColor: new THREE.Color('#fff6ea'), sunIntensity: 3, skyColor: new THREE.Color('#2a78d6'), fogColor: new THREE.Color('#bfe0f5'),
    fogSunColor: new THREE.Color('#d2eaf8'), horizonColor: new THREE.Color('#bfe0f5'), ambientColor: new THREE.Color('#c6e0ff'), ambientIntensity: 1.15,
    cloudColor: new THREE.Color('#ffffff'), lightDir: new THREE.Vector3(0.3, 0.8, 0.5).normalize(), moonDir: new THREE.Vector3(0, -1, 0),
  };

  const world = {
    size: WORLD_SIZE,
    group,
    airports: AIRPORTS,
    pois: POIS,
    airportById: AIRPORT_BY_ID,
    poiById: POI_BY_ID,
    carrier: CARRIER,
    lake: LAKE,
    wind: new THREE.Vector3(0, 0, 0),
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
    env,
    timeOfDay: 17.8,
    timeRate: DAY_RATE,
    weather: { type: 'clear', visibility: 45000, cloudBase: 1700, cloudTop: 2500, turbulence: 0.04, rain: 0, snow: 0, windSpeed: 3, cover: 0.2, lightning: 0 },
    heightAt,
    groundAt,
    runwayLocal,
    // высота поверхности с учётом воды, полос и палубы (для камеры, эффектов)
    surfaceHeight(x, z) { return groundAt(x, z).y; },
    nearestAirport(x, z) {
      let best = null, bd = Infinity;
      for (const a of AIRPORTS) {
        const d = Math.hypot(x - a.x, z - a.z);
        if (d < bd) { bd = d; best = a; }
      }
      return { airport: best, dist: bd };
    },
    // точка старта на полосе: end 'A' (у торца, курс heading) или 'B' (обратный курс)
    runwayStart(airportId, rwIndex = 0, end = 'A') {
      const a = AIRPORT_BY_ID[airportId] || AIRPORTS[0];
      const rw = a.runways[rwIndex] || a.runways[0];
      const hdg = end === 'B' ? rw.heading + Math.PI : rw.heading;
      const d = headingVec(hdg);
      const back = rw.length / 2 - Math.min(60, rw.length * 0.08);
      return { x: rw.cx - d.x * back, z: rw.cz - d.z * back, y: a.elevation, heading: hdg, airport: a, runway: rw };
    },
    setTimeOfDay(h) { world.timeOfDay = (((+h || 0) % 24) + 24) % 24; },
    setWeather(type, immediate) { weather.set(type, immediate || G.mode !== 'flight'); },
    makeMapCanvas(size) { return makeMapCanvas(hf, size); },
    update,
  };

  // ---- материалы мира ----
  const win = makeWindowTextures();
  const mats = {
    building: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, map: win.day, emissiveMap: win.night, emissive: '#ffffff', emissiveIntensity: 0 })),
    decal: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 1.5 })),
    mark: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true })),
    plain: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true })),
    plainDouble: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })),
  };

  const terrain = buildTerrain(hf, group);
  const T2 = performance.now();
  createSea(group);
  const weather = createWeather(G, world);
  const sky = createSky(G, world);
  const clouds = createClouds(G, world);
  const lights = createLights(G, group);
  const airports = createAirports(G, world, mats, lights);
  const props = createProps(G, world, hf, mats, lights);
  lights.build();
  world._debug = { hf, terrain, sky, clouds, weather, lights, mats, timing: { heightfield: Math.round(T1 - T0), terrain: Math.round(T2 - T1), rest: Math.round(performance.now() - T2) } };

  const TREE_R = { low: [6500, 8500], medium: [10500, 13000], high: [15000, 18000] };
  let level = G.quality.level;
  const applyQuality = () => { const r = TREE_R[G.quality.level] || TREE_R.medium; U.uTreeR.value.set(r[0], r[1]); };
  applyQuality();
  G.bus.on('quality:changed', () => {
    applyQuality();
    if (G.quality.level !== level) { level = G.quality.level; props.rebuildTrees(); }
  });
  G.bus.on('flight:start', () => { weather.snap(); world.timeRate = DAY_RATE; });
  G.bus.on('menu:show', () => { world.timeRate = DAY_RATE; });

  function update(dt) {
    const cam = G.camera;
    if (!(dt >= 0)) dt = 0;
    if (dt > 0 && world.timeRate) world.timeOfDay = (((world.timeOfDay + world.timeRate * dt) % 24) + 24) % 24;
    U.uTime.value += dt;
    weather.update(dt, cam);
    clouds.update(dt, cam, weather.wx);
    sky.update(dt, weather.wx, cam);
    lights.update(env);
    mats.building.emissiveIntensity = smoothstep(0.3, 0.95, env.lightsOn) * 2.4;
    airports.update(dt);
    props.update(dt, cam);
  }

  weather.snap();
  update(0);
  update(0);
  return world;
}
