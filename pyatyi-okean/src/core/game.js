// Ядро игры: общий контекст G, жизненный цикл полёта, игровой цикл. Владелец — ведущий (не агенты).
import * as THREE from 'three';
import { createBus } from './bus.js';
import { loadProfile, saveProfile } from './save.js';
import { createAircraft, placeAircraft, stepAircraft } from '../aircraft/physics.js';
import { buildModel, animateModel } from '../aircraft/models.js';
import { getSpec } from '../aircraft/catalog.js';

export const FIXED_DT = 1 / 60;

export const G = {
  // инфраструктура
  canvas: null, ui: null, renderer: null, scene: null, camera: null,
  bus: createBus(),
  profile: null,
  // состояние
  mode: 'boot',            // 'boot' | 'menu' | 'flight' | 'debrief'
  paused: false,
  time: { now: 0, sim: 0, scale: 1, frame: 0, fps: 60 },
  quality: { level: 'medium', pixelRatio: 1.5 },
  aircraft: [],            // все самолёты в воздухе/на земле (игрок + ИИ)
  player: null,
  flight: null,            // текущий полёт: { session, time, distance, maxAlt, touchdowns[], takeoffs, endTimer }
  // модули (создаются в main.js)
  world: null, input: null, cameraRig: null, hud: null, menu: null, career: null,
  missions: null, combat: null, ai: null, fx: null, audio: null,
  debug: {},
};

const env = { world: null, bus: G.bus };

// ---------- самолёты ----------
// opts: { team, isPlayer, x, y, z, heading, speed, onGround, livery }
G.spawnAircraft = function (specId, opts = {}) {
  const ac = createAircraft(specId, opts);
  placeAircraft(ac, { x: opts.x || 0, y: opts.y || 0, z: opts.z || 0, heading: opts.heading || 0, speed: opts.speed || 0, onGround: !!opts.onGround });
  if (opts.onGround) {
    const gnd = G.world.groundAt(ac.pos.x, ac.pos.z);
    ac.pos.y = gnd.y + ac.spec.gearHeight;
  }
  ac.model = buildModel(ac.specId, { livery: opts.livery, team: ac.team });
  ac.model.position.copy(ac.pos);
  ac.model.quaternion.copy(ac.quat);
  G.scene.add(ac.model);
  G.aircraft.push(ac);
  G.bus.emit('ac:spawn', { ac });
  return ac;
};

G.removeAircraft = function (ac) {
  const i = G.aircraft.indexOf(ac);
  if (i >= 0) G.aircraft.splice(i, 1);
  if (ac.model) {
    G.scene.remove(ac.model);
    ac.model.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
  }
  G.bus.emit('ac:remove', { ac });
  if (G.player === ac) G.player = null;
};

// ---------- жизненный цикл полёта ----------
// session: { planeId?, missionId?, airportId?, runway? (индекс), end? ('A'|'B'),
//            air?: {x, y, z, heading, speed}, timeOfDay?, weather?, livery? }
G.startFlight = function (session = {}) {
  G.cleanupFlight();
  if (session.missionId && G.missions.flightParams) {
    session = { ...G.missions.flightParams(session.missionId), ...session };
  }
  const planeId = session.planeId || G.profile.selectedPlane || 'yak52';
  session.planeId = getSpec(planeId).id;
  if (session.timeOfDay != null) G.world.setTimeOfDay(session.timeOfDay);
  if (session.weather) G.world.setWeather(session.weather);

  let ac;
  if (session.air) {
    const a = session.air;
    ac = G.spawnAircraft(session.planeId, { team: 'player', isPlayer: true, x: a.x, y: a.y, z: a.z, heading: a.heading || 0, speed: a.speed || getSpec(planeId).vCruise, livery: session.livery });
  } else {
    const st = G.world.runwayStart(session.airportId || 'yasny', session.runway || 0, session.end || 'A');
    ac = G.spawnAircraft(session.planeId, { team: 'player', isPlayer: true, x: st.x, y: st.y, z: st.z, heading: st.heading, speed: 0, onGround: true, livery: session.livery });
  }
  Object.assign(ac.mods, G.career.planeMods ? G.career.planeMods(session.planeId) : null);
  ac.assist = G.profile.settings.assist !== false;
  G.player = ac;
  G.combat.armAircraft(ac, session.loadout);
  G.flight = { session, time: 0, distance: 0, maxAlt: 0, maxSpeed: 0, touchdowns: [], takeoffs: 0, endTimer: -1, ended: false };
  G.mode = 'flight';
  G.paused = false;
  G.time.scale = 1;
  G.bus.emit('flight:start', { session, ac });
  if (session.missionId) G.missions.start(session.missionId);
  return ac;
};

// result: { reason: 'quit'|'crashed'|'landed'|'mission_complete'|'mission_failed', success?, missionId?, title?, text?, stars?, reward? }
G.endFlight = function (result = {}) {
  if (G.mode !== 'flight' || !G.flight || G.flight.ended) return;
  const f = G.flight;
  f.ended = true;
  result.reason = result.reason || 'quit';
  result.session = f.session;
  result.planeId = f.session.planeId;
  result.missionId = result.missionId || f.session.missionId || null;
  result.stats = { time: f.time, distance: f.distance, maxAlt: f.maxAlt, maxSpeed: f.maxSpeed, touchdowns: f.touchdowns, takeoffs: f.takeoffs };
  G.mode = 'debrief';
  G.paused = false;
  G.time.scale = 1;
  G.bus.emit('flight:end', { result });
  saveProfile(G.profile, true);
};

G.cleanupFlight = function () {
  G.missions?.stop?.();
  G.ai?.clear?.();
  G.combat?.clear?.();
  G.fx?.clear?.();
  for (const ac of [...G.aircraft]) G.removeAircraft(ac);
  G.player = null;
  G.flight = null;
};

G.toMenu = function () {
  G.cleanupFlight();
  G.mode = 'menu';
  G.paused = false;
  G.time.scale = 1;
  G.bus.emit('menu:show');
};

G.setPaused = function (p) {
  if (G.mode !== 'flight' || G.paused === p) return;
  G.paused = p;
  G.bus.emit('pause', { paused: p });
};

// ---------- шаг симуляции (фиксированный dt) ----------
function safe(name, fn) {
  try {
    fn();
  } catch (e) {
    if (!safe.seen[name]) console.error(`[${name}]`, e);
    safe.seen[name] = (safe.seen[name] || 0) + 1;
  }
}
safe.seen = {};
G.errors = safe.seen;

G.step = function (dt) {
  env.world = G.world;
  G.time.sim += dt;
  if (G.mode === 'flight') {
    const f = G.flight, p = G.player;
    safe('input', () => { G.input.update(dt); if (p && p.alive) G.input.apply(p); });
    safe('missions', () => G.missions.update(dt));
    safe('ai', () => G.ai.update(dt));
    for (let i = 0; i < G.aircraft.length; i++) {
      const ac = G.aircraft[i];
      safe('physics', () => stepAircraft(ac, env, dt));
    }
    safe('combat', () => G.combat.update(dt));
    if (G.career.update) safe('career', () => G.career.update(dt));
    if (p && f && !f.ended) {
      f.time += dt;
      if (p.alive) {
        f.distance += Math.hypot(p.vel.x, p.vel.z) * dt;
        if (p.alt > f.maxAlt) f.maxAlt = p.alt;
        if (p.ias > f.maxSpeed) f.maxSpeed = p.ias;
      }
      if (f.endTimer > 0) {
        f.endTimer -= dt;
        if (f.endTimer <= 0) G.endFlight(f.endResult || { reason: 'crashed' });
      }
    }
  }
};

// события игрока, которые ведёт ядро
G.bus.on('ac:touchdown', (e) => {
  if (e.ac === G.player && G.flight) G.flight.touchdowns.push({ t: G.flight.time, vs: e.vs, speed: e.speed, surface: e.surface, airportId: e.airport ? e.airport.id : null, across: e.across, along: e.along });
});
G.bus.on('ac:takeoff', (e) => {
  if (e.ac === G.player && G.flight) G.flight.takeoffs++;
});
G.bus.on('ac:crash', (e) => {
  if (e.ac === G.player && G.flight && !G.flight.ended && G.flight.endTimer < 0) {
    G.flight.endTimer = 3.2;
    G.flight.endResult = { reason: 'crashed', success: false, crashReason: e.reason };
  }
});
G.bus.on('input:pause', () => G.setPaused(!G.paused));
G.bus.on('settings:changed', () => {
  if (G.player) G.player.assist = G.profile.settings.assist !== false;
});

// ---------- кадр (переменный dt): визуальные системы ----------
G.frameUpdate = function (dtSim, dtReal) {
  safe('world', () => G.world.update(G.mode === 'flight' && G.paused ? 0 : dtSim || dtReal));
  for (let i = 0; i < G.aircraft.length; i++) {
    const ac = G.aircraft[i];
    if (!ac.model) continue;
    ac.model.position.copy(ac.pos);
    ac.model.quaternion.copy(ac.quat);
    if (dtSim > 0) safe('models', () => animateModel(ac.model, ac, dtSim));
  }
  safe('fx', () => G.fx.update(dtSim));
  safe('camera', () => G.cameraRig.update(dtReal));
  safe('hud', () => G.hud.update(dtReal));
  safe('audio', () => G.audio.update(dtReal));
};

G.render = function () {
  G.renderer.render(G.scene, G.camera);
};

G.setQuality = function (level) {
  const auto = level === 'auto';
  if (auto) {
    const cores = navigator.hardwareConcurrency || 4;
    level = cores >= 8 ? 'high' : cores >= 4 ? 'medium' : 'low';
  }
  const pr = { low: 1, medium: 1.5, high: 2 }[level] || 1.5;
  G.quality.level = level;
  G.quality.auto = auto;
  G.quality.pixelRatio = Math.min(window.devicePixelRatio || 1, pr);
  G.renderer.setPixelRatio(G.quality.pixelRatio);
  G.bus.emit('quality:changed', G.quality);
};

export function initCore() {
  G.canvas = document.getElementById('gl');
  G.ui = document.getElementById('ui');
  G.profile = loadProfile();
  G.renderer = new THREE.WebGLRenderer({ canvas: G.canvas, antialias: true, powerPreference: 'high-performance' });
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(60, 1, 1, 90000);
  G.scene.add(G.camera);
  const resize = () => {
    const w = G.canvas.clientWidth || innerWidth, h = G.canvas.clientHeight || innerHeight;
    G.renderer.setSize(w, h, false);
    G.camera.aspect = w / h;
    G.camera.updateProjectionMatrix();
    G.bus.emit('resize', { w, h });
  };
  G.resize = resize;
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));
  G.setQuality(G.profile.settings.quality || 'auto');
  resize();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveProfile(G.profile, true);
      if (G.mode === 'flight') G.setPaused(true);
    }
  });
  return G;
}
