// МИР (заглушка v0 — заменяется агентом «Мир»). Публичный контракт world — в ARCHITECTURE.md.
import * as THREE from 'three';
import { WORLD_SIZE, AIRPORTS, POIS, AIRPORT_BY_ID, POI_BY_ID } from './layout.js';
import { fbm2, clamp, smoothstep, headingVec } from '../core/util.js';

const GRID = 192;

// Положение точки относительно полосы: along — вдоль от центра (м, + в сторону курса heading), across — поперёк
export function runwayLocal(rw, x, z) {
  const d = headingVec(rw.heading);
  const dx = x - rw.cx, dz = z - rw.cz;
  return { along: dx * d.x + dz * d.z, across: dx * -d.z + dz * d.x };
}

function rawHeight(x, z) {
  // острова = сумма «холмов» вокруг аэродромов + шум
  let mask = 0;
  for (const a of AIRPORTS) {
    if (a.kind === 'carrier') continue;
    const d = Math.hypot(x - a.x, z - a.z);
    const r = a.kind === 'intl' ? 9000 : 5500;
    mask = Math.max(mask, 1 - smoothstep(r * 0.5, r, d));
  }
  const n = fbm2(x / 5000, z / 5000, 5, 7);
  const ridge = fbm2(x / 1800, z / 1800, 4, 23);
  let h = (mask * 1.25 + n * 0.55 - 0.62) * 900;
  if (h > 0) h += ridge * ridge * mask * 700;
  return h;
}

export function createWorld(G) {
  const group = new THREE.Group();
  group.name = 'world';
  G.scene.add(group);

  function flattenInfo(x, z) {
    // возвращает {w, elev} — вес выравнивания площадки аэродрома
    let best = null;
    for (const a of AIRPORTS) {
      if (a.kind === 'carrier') continue;
      for (const rw of a.runways) {
        const l = runwayLocal(rw, x, z);
        const dx = Math.max(0, Math.abs(l.along) - rw.length / 2 - 250);
        const dz = Math.max(0, Math.abs(l.across) - 320);
        const d = Math.hypot(dx, dz);
        const w = 1 - smoothstep(0, a.kind === 'strip' ? 500 : 1100, d);
        if (w > 0 && (!best || w > best.w)) best = { w, elev: a.elevation };
      }
    }
    return best;
  }

  function heightAt(x, z) {
    let h = rawHeight(x, z);
    const f = flattenInfo(x, z);
    if (f) h = h + (f.elev - h) * f.w;
    return h;
  }

  function groundAt(x, z) {
    for (const a of AIRPORTS) {
      if (Math.abs(x - a.x) > 4000 || Math.abs(z - a.z) > 4000) continue;
      for (const rw of a.runways) {
        const l = runwayLocal(rw, x, z);
        if (Math.abs(l.along) <= rw.length / 2 && Math.abs(l.across) <= rw.width / 2) {
          return { y: a.elevation, surface: a.kind === 'carrier' ? 'carrier' : 'runway', airport: a, runway: rw, along: l.along, across: l.across };
        }
      }
    }
    const h = heightAt(x, z);
    if (h <= 0) return { y: 0, surface: 'water' };
    return { y: h, surface: 'ground' };
  }

  // рельеф
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID, GRID);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
    if (h < 3) col.set('#d9c58f');
    else if (h < 350) col.set('#5f9a4a').lerp(new THREE.Color('#3f7a3d'), clamp(h / 350, 0, 1));
    else if (h < 800) col.set('#7c7466');
    else col.set('#f2f4f7');
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  group.add(terrain);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE * 3, WORLD_SIZE * 3).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#2a6f97' })
  );
  group.add(water);

  // полосы
  for (const a of AIRPORTS) {
    for (const rw of a.runways) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(rw.width, 0.6, rw.length),
        new THREE.MeshLambertMaterial({ color: a.kind === 'carrier' ? '#4a5560' : '#3a3d42' })
      );
      m.position.set(rw.cx, a.elevation - 0.3 + 0.05, rw.cz);
      m.rotation.y = -rw.heading;
      group.add(m);
    }
  }

  // свет и небо
  const hemi = new THREE.HemisphereLight('#cfe8ff', '#5b6b4a', 1.1);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(0.4, 0.8, 0.3);
  G.scene.add(hemi, sun);
  G.scene.background = new THREE.Color('#8fc4e8');
  G.scene.fog = new THREE.Fog('#a9d0ea', 2000, 42000);

  const world = {
    size: WORLD_SIZE,
    group,
    airports: AIRPORTS,
    pois: POIS,
    airportById: AIRPORT_BY_ID,
    poiById: POI_BY_ID,
    wind: new THREE.Vector3(0, 0, 0),
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
    timeOfDay: 10,
    weather: { type: 'clear', visibility: 42000, cloudBase: 1800, turbulence: 0, rain: 0 },
    heightAt,
    groundAt,
    runwayLocal,
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
      const hdg = end === 'A' ? rw.heading : rw.heading + Math.PI;
      const d = headingVec(hdg);
      const back = rw.length / 2 - Math.min(60, rw.length * 0.08);
      return { x: rw.cx - d.x * back, z: rw.cz - d.z * back, y: a.elevation, heading: hdg, airport: a, runway: rw };
    },
    setTimeOfDay(h) { world.timeOfDay = h; },
    setWeather(type) { world.weather.type = type; },
    update(dt) {},
  };
  return world;
}
