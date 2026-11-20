// Точка входа: создаёт модули в правильном порядке и крутит игровой цикл. Владелец — ведущий (не агенты).
import { G, initCore, FIXED_DT } from './core/game.js';
import { createWorld } from './world/index.js';
import { createInput } from './systems/input.js';
import { createCameraRig } from './systems/camera.js';
import { createFx } from './systems/fx.js';
import { createAudio } from './systems/audio.js';
import { createCombat } from './systems/combat.js';
import { createAI } from './systems/ai.js';
import { createCareer } from './systems/career.js';
import { createMissions } from './missions/index.js';
import { createHud } from './ui/hud.js';
import { createMenu } from './ui/menu.js';

function boot() {
  initCore();
  G.world = createWorld(G);
  G.fx = createFx(G);
  G.audio = createAudio(G);
  G.career = createCareer(G);
  G.input = createInput(G);
  G.cameraRig = createCameraRig(G);
  G.combat = createCombat(G);
  G.ai = createAI(G);
  G.hud = createHud(G);
  G.missions = createMissions(G);
  G.menu = createMenu(G);

  // ---- отладка и тестовый стенд ----
  G.debug.advance = (seconds, render = true) => {
    // прокрутить симуляцию без ожидания реального времени (для тестов)
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n && G.mode === 'flight'; i++) G.step(FIXED_DT);
    G.frameUpdate(Math.min(seconds, 0.05), 1);
    if (render) G.render();
    return G.debug.info();
  };
  G.debug.info = () => {
    const p = G.player;
    return {
      mode: G.mode, paused: G.paused, errors: { ...G.errors }, fps: Math.round(G.time.fps),
      aircraft: G.aircraft.length,
      player: p && {
        plane: p.specId, x: Math.round(p.pos.x), y: +p.pos.y.toFixed(1), z: Math.round(p.pos.z),
        ias: +(p.ias * 3.6).toFixed(0), alt: +p.alt.toFixed(0), agl: +p.agl.toFixed(1), vs: +p.vs.toFixed(1),
        hdg: +((p.heading * 180) / Math.PI).toFixed(0), pitch: +((p.pitch * 180) / Math.PI).toFixed(1), bank: +((p.bank * 180) / Math.PI).toFixed(1),
        thr: +p.throttle.toFixed(2), gear: p.gearPos, flaps: p.flapsPos, onGround: p.onGround, alive: p.alive, stalled: p.stalled, surface: p.surface, hp: p.hp, fuel: Math.round(p.fuel),
      },
      mission: G.missions.active ? (G.missions.active.def ? G.missions.active.def.id : true) : null,
    };
  };
  G.debug.teleport = ({ x, y, z, heading = 0, speed }) => {
    const p = G.player;
    if (!p) return;
    p.pos.set(x, y, z);
    p.quat.setFromAxisAngle({ x: 0, y: 1, z: 0 }, -heading);
    const v = speed ?? p.spec.vCruise;
    p.vel.set(Math.sin(heading) * v, 0, -Math.cos(heading) * v);
    p.onGround = false;
    G.cameraRig.snap?.();
  };
  // принудительно задать управление игрока (для тестов): G.debug.hold({pitch, roll, throttle...}) / G.debug.hold(null)
  G.debug.hold = (c) => { G.debug._hold = c; };
  const origApply = G.input.apply.bind(G.input);
  G.input.apply = (ac) => {
    origApply(ac);
    if (G.debug._hold) Object.assign(ac.controls, G.debug._hold);
  };
  window.__G = G;

  G.mode = 'menu';
  G.bus.emit('menu:show');

  // автозапуск из параметров адреса (только для тестов): ?start=free&plane=an2&airport=gavan&air=1&tod=19&weather=storm
  const q = new URLSearchParams(location.search);
  if (q.get('start')) {
    const s = {};
    if (q.get('plane')) s.planeId = q.get('plane');
    if (q.get('airport')) s.airportId = q.get('airport');
    if (q.get('mission')) s.missionId = q.get('mission');
    if (q.get('tod')) s.timeOfDay = +q.get('tod');
    if (q.get('weather')) s.weather = q.get('weather');
    if (q.get('air')) {
      const st = G.world.runwayStart(s.airportId || 'yasny');
      s.air = { x: st.x, y: st.y + (+q.get('alt') || 600), z: st.z, heading: st.heading };
    }
    G.startFlight(s);
  }

  // ---- игровой цикл ----
  let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0, slowT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (G.debug.manual) return; // тесты крутят время сами через G.debug.advance
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    G.time.now = now / 1000;
    G.time.frame++;
    let dtSim = 0;
    if (G.mode === 'flight' && !G.paused) {
      acc += dtReal * G.time.scale;
      let n = 0;
      while (acc >= FIXED_DT && n < 8) {
        G.step(FIXED_DT);
        acc -= FIXED_DT;
        dtSim += FIXED_DT;
        n++;
      }
      if (n === 8) acc = 0;
    } else {
      acc = 0;
      if (G.mode !== 'flight') dtSim = dtReal;
    }
    G.frameUpdate(dtSim, dtReal);
    G.render();

    // счётчик кадров и авто-качество
    fpsAcc += dtReal; fpsN++;
    if (fpsAcc >= 1) {
      G.time.fps = fpsN / fpsAcc;
      if (G.quality.auto && G.time.fps < 27 && G.quality.pixelRatio > 0.75 && !document.hidden) {
        if (++slowT >= 3) {
          slowT = 0;
          G.quality.pixelRatio = Math.max(0.75, G.quality.pixelRatio - 0.25);
          G.renderer.setPixelRatio(G.quality.pixelRatio);
          G.resize();
          G.bus.emit('quality:changed', G.quality);
        }
      } else slowT = 0;
      fpsAcc = 0; fpsN = 0;
    }
  }
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
