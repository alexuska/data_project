// ВВОД (заглушка v0 — заменяется агентом «Управление»). Контракт — в ARCHITECTURE.md.
// G.input.state: { pitch, roll, yaw: −1..1; throttle: 0..1; brake: 0..1; airbrake: 0..1; fire, fireAlt: bool }
// Разовые действия идут событиями шины: 'input:gear', 'input:flaps' {dir:+1|-1}, 'input:camera', 'input:pause',
// 'input:weapon' (сменить оружие), 'input:map'.
import { clamp, damp } from '../core/util.js';

export function createInput(G) {
  const state = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, airbrake: 0, fire: false, fireAlt: false };
  const keys = new Set();
  const stick = { x: 0, y: 0 };

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (G.mode !== 'flight') return;
    if (e.code === 'KeyG') G.bus.emit('input:gear');
    if (e.code === 'KeyF') G.bus.emit('input:flaps', { dir: e.shiftKey ? -1 : 1 });
    if (e.code === 'KeyC') G.bus.emit('input:camera');
    if (e.code === 'KeyM') G.bus.emit('input:map');
    if (e.code === 'KeyR') G.bus.emit('input:weapon');
    if (e.code === 'Escape' || e.code === 'KeyP') G.bus.emit('input:pause');
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // простейший сенсорный стик: левая половина экрана — тангаж/крен, правая — газ (вертикально)
  const touches = new Map();
  const canvas = G.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    if (G.mode !== 'flight') return;
    touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, left: e.clientX < innerWidth / 2, thr0: state.throttle });
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    if (t.left) {
      stick.x = clamp((e.clientX - t.x0) / 70, -1, 1);
      stick.y = clamp((e.clientY - t.y0) / 70, -1, 1);
    } else {
      state.throttle = clamp(t.thr0 - (e.clientY - t.y0) / 180, 0, 1);
    }
  });
  const up = (e) => {
    const t = touches.get(e.pointerId);
    if (t && t.left) stick.x = stick.y = 0;
    touches.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const input = {
    state,
    reset() {
      state.pitch = state.roll = state.yaw = 0;
      state.brake = 0; state.fire = state.fireAlt = false;
      stick.x = stick.y = 0;
    },
    setThrottle(v) { state.throttle = clamp(v, 0, 1); },
    update(dt) {
      const k = (c) => (keys.has(c) ? 1 : 0);
      const inv = G.profile.settings.invertPitch ? -1 : 1;
      // стик вниз (на себя) = нос вверх
      const tp = stick.y * inv + (k('ArrowDown') || k('KeyS')) - (k('ArrowUp') || k('KeyW'));
      const tr = stick.x + (k('ArrowRight') || k('KeyD')) - (k('ArrowLeft') || k('KeyA'));
      state.pitch = damp(state.pitch, clamp(tp, -1, 1), 12, dt);
      state.roll = damp(state.roll, clamp(tr, -1, 1), 12, dt);
      state.yaw = damp(state.yaw, k('KeyE') - k('KeyQ'), 10, dt);
      if (k('ShiftLeft') || k('Equal')) state.throttle = clamp(state.throttle + dt * 0.6, 0, 1);
      if (k('ControlLeft') || k('Minus')) state.throttle = clamp(state.throttle - dt * 0.6, 0, 1);
      state.brake = k('KeyB');
      state.airbrake = k('KeyX');
      state.fire = !!k('Space');
      state.fireAlt = !!k('Enter');
    },
    // перенести ввод в controls самолёта игрока
    apply(ac) {
      const c = ac.controls;
      c.pitch = state.pitch; c.roll = state.roll; c.yaw = state.yaw;
      c.throttle = state.throttle; c.brake = state.brake; c.airbrake = state.airbrake;
    },
  };

  G.bus.on('input:gear', () => {
    const p = G.player;
    if (p && p.alive && p.spec.retract && !p.onGround) p.gearDown = !p.gearDown;
  });
  G.bus.on('input:flaps', ({ dir } = { dir: 1 }) => {
    const p = G.player;
    if (!p || !p.spec.flaps) return;
    let f = p.flaps + 0.5 * (dir || 1);
    if (f > 1.01) f = 0;
    p.flaps = clamp(f, 0, 1);
  });
  G.bus.on('flight:start', () => {
    input.reset();
    state.throttle = G.player && !G.player.onGround ? 0.7 : 0;
  });
  return input;
}
