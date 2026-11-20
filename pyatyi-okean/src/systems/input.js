// ВВОД: клавиатура, сенсор (ui/touch.js), геймпад. Контракт — в ARCHITECTURE.md.
// G.input.state: { pitch, roll, yaw: −1..1; throttle: 0..1; brake: 0..1; airbrake: 0..1; fire, fireAlt: bool }
// Разовые действия — события шины: 'input:gear', 'input:flaps' {dir}, 'input:camera', 'input:pause', 'input:weapon',
// 'input:map', 'input:timescale' {scale?}, 'input:action' {id}.
// Сверх контракта: input.look (осмотр для камеры), input.haptic(ms), input.setAction(a), input.uiUpdate(dtReal).
import { clamp, damp } from '../core/util.js';
import { createTouch } from '../ui/touch.js';

// есть ли у самолёта форсаж и с какого положения РУД он включается (spec.afterburner; зона РУД > 0.9, как в физике)
export function afterburnerFrom(spec) {
  if (!spec) return 0;
  return spec.afterburner ? (typeof spec.afterburner === 'number' ? spec.afterburner : 0.9) : 0;
}

export function createInput(G) {
  const state = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, airbrake: 0, fire: false, fireAlt: false };
  // «сырые» значения сенсорных элементов (пишет ui/touch.js)
  const raw = { stickX: 0, stickY: 0, stickHeld: false, brake: false, fire: false, fireAlt: false };
  // осмотр: накопленные с прошлого кадра смещения (читает и обнуляет камера)
  const look = { dx: 0, dy: 0, zoom: 1, held: false, reset: false };
  const keys = new Set();
  const pad = { x: 0, y: 0, yaw: 0, brake: false, fire: false, fireAlt: false, prev: 0, lx: 0, ly: 0 };
  let action = null;
  let lastCombatT = -1e9;
  let tsCheck = 0;

  const settings = () => G.profile.settings;
  const k = (c) => (keys.has(c) ? 1 : 0);

  function haptic(ms) {
    try {
      if (navigator.vibrate && settings().haptics !== false) navigator.vibrate(ms);
    } catch (e) { /* нет вибромотора */ }
  }

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (G.mode !== 'flight') return;
    const c = e.code;
    if (c === 'Escape' || c === 'KeyP') { G.bus.emit('input:pause'); return; }
    if (c === 'KeyM') { G.bus.emit('input:map'); return; }
    if (G.paused) return;
    if (c === 'KeyG') G.bus.emit('input:gear');
    else if (c === 'KeyF') G.bus.emit('input:flaps', { dir: e.shiftKey ? -1 : 1 });
    else if (c === 'KeyC') G.bus.emit('input:camera');
    else if (c === 'KeyR') G.bus.emit('input:weapon');
    else if (c === 'KeyT') G.bus.emit('input:timescale');
    else if (c === 'KeyZ' && action) G.bus.emit('input:action', { id: action.id });
    if (c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); input.release(); });

  // ---------- геймпад (по желанию) ----------
  function pollGamepad() {
    let gp = null;
    try {
      const list = navigator.getGamepads ? navigator.getGamepads() : null;
      if (list) for (let i = 0; i < list.length; i++) if (list[i] && list[i].connected) { gp = list[i]; break; }
    } catch (e) { gp = null; }
    if (!gp) { pad.x = pad.y = pad.yaw = 0; pad.brake = pad.fire = pad.fireAlt = false; pad.prev = 0; return; }
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const b = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
    pad.x = dz(gp.axes[0] || 0);
    pad.y = dz(gp.axes[1] || 0);
    pad.lx = dz(gp.axes[2] || 0);
    pad.ly = dz(gp.axes[3] || 0);
    pad.yaw = b(15) - b(14);
    pad.thr = b(7) - b(6);
    pad.brake = b(1) > 0.5;
    pad.fire = b(0) > 0.5;
    pad.fireAlt = b(5) > 0.5;
    let mask = 0;
    for (let i = 0; i < 10; i++) if (b(i) > 0.5) mask |= 1 << i;
    const hit = mask & ~pad.prev;
    pad.prev = mask;
    if (G.mode !== 'flight') return;
    if (hit & (1 << 9)) G.bus.emit('input:pause');
    if (G.paused) return;
    if (hit & (1 << 2)) G.bus.emit('input:gear');
    if (hit & (1 << 3)) G.bus.emit('input:flaps', { dir: 1 });
    if (hit & (1 << 4)) G.bus.emit('input:weapon');
    if (hit & (1 << 8)) G.bus.emit('input:camera');
  }

  const input = {
    state, raw, look, haptic,
    get action() { return action; },
    touch: null,
    reset() {
      state.pitch = state.roll = state.yaw = 0;
      state.brake = state.airbrake = 0;
      state.fire = state.fireAlt = false;
      input.release();
    },
    // отпустить все удерживаемые элементы (пауза, потеря фокуса, конец полёта)
    release() {
      raw.stickX = raw.stickY = 0;
      raw.stickHeld = raw.brake = raw.fire = raw.fireAlt = false;
      look.held = false;
      if (input.touch) input.touch.release();
    },
    setThrottle(v) { state.throttle = clamp(v, 0, 1); },
    setAction(a) {
      action = a && a.id ? { id: a.id, label: a.label || 'Действие' } : null;
      if (input.touch) input.touch.setAction(action);
    },
    // шаг симуляции
    update(dt) {
      const p = G.player;
      const s = settings();
      const inv = s.invertPitch ? -1 : 1;
      // ручка на себя (вниз) = нос вверх
      const keyP = (k('ArrowDown') || k('KeyS')) - (k('ArrowUp') || k('KeyW'));
      const keyR = (k('ArrowRight') || k('KeyD')) - (k('ArrowLeft') || k('KeyA'));
      const tp = clamp((raw.stickY + pad.y) * inv + keyP, -1, 1);
      const tr = clamp(raw.stickX + pad.x + keyR, -1, 1);
      // сенсор уже «аналоговый» — следуем быстро; клавиши — мягче, чтобы не дёргать самолёт
      const rate = raw.stickHeld || pad.x || pad.y ? 22 : keyP || keyR ? 7 : 12;
      state.pitch = damp(state.pitch, tp, rate, dt);
      state.roll = damp(state.roll, tr, rate, dt);
      if (Math.abs(state.pitch) < 1e-4) state.pitch = 0;
      if (Math.abs(state.roll) < 1e-4) state.roll = 0;

      // педали: вручную (Q/E, геймпад) либо автоматически
      const manualYaw = k('KeyE') - k('KeyQ') + pad.yaw;
      let ty = manualYaw;
      if (p && p.alive) {
        if (p.onGround) ty += state.roll; // руление креном
        else if (!manualYaw && s.assist !== false) ty = state.roll * 0.3 + clamp((p.slip || 0) * 2.5, -0.6, 0.6); // координация разворота
      }
      state.yaw = damp(state.yaw, clamp(ty, -1, 1), 10, dt);

      const up = k('ShiftLeft') || k('ShiftRight') || k('Equal') || k('PageUp');
      const dn = k('ControlLeft') || k('ControlRight') || k('Minus') || k('PageDown');
      const dThr = (up - dn) * 0.6 + (pad.thr || 0) * 0.8;
      if (dThr) state.throttle = clamp(state.throttle + dThr * dt, 0, 1);

      const brake = raw.brake || !!k('KeyB') || pad.brake;
      state.brake = brake ? 1 : 0;
      state.airbrake = brake || k('KeyX') ? 1 : 0;
      state.fire = raw.fire || !!k('Space') || pad.fire;
      state.fireAlt = raw.fireAlt || !!k('Enter') || !!k('KeyV') || pad.fireAlt;
      if (state.fire || state.fireAlt) lastCombatT = G.time.sim;

      // ускорение времени: авто-сброс у земли и в бою
      if (G.time.scale > 1) {
        tsCheck -= dt;
        if (tsCheck <= 0) {
          tsCheck = 0.25;
          const why = timescaleBlock();
          if (why) {
            G.time.scale = 1;
            G.bus.emit('ui:toast', { text: `Время ×1 — ${why}`, kind: 'info' });
          }
        }
      }
    },
    // перенести ввод в controls самолёта игрока
    apply(ac) {
      const c = ac.controls;
      c.pitch = state.pitch; c.roll = state.roll; c.yaw = state.yaw;
      c.throttle = state.throttle; c.brake = state.brake; c.airbrake = state.airbrake;
    },
    // каждый кадр (зовёт HUD): сенсорные элементы и геймпад
    uiUpdate(dtReal) {
      pollGamepad();
      if (pad.lx || pad.ly) { look.dx += pad.lx * dtReal * 2; look.dy += pad.ly * dtReal * 1.4; }
      if (input.touch) input.touch.update(dtReal);
    },
    timescaleBlock,
  };

  // почему сейчас нельзя ускорять время (строка) либо null
  function timescaleBlock() {
    const p = G.player;
    if (!p || !p.alive) return 'нет управления';
    if (p.onGround) return 'самолёт на земле';
    if (p.agl < 150) return 'малая высота';
    if (p.stalled) return 'сваливание';
    if (G.time.sim - lastCombatT < 12) return 'идёт бой';
    const list = G.aircraft;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.team === 'enemy' && a.alive) {
        const dx = a.pos.x - p.pos.x, dy = a.pos.y - p.pos.y, dz = a.pos.z - p.pos.z;
        if (dx * dx + dy * dy + dz * dz < 9000 * 9000) return 'противник рядом';
      }
    }
    return null;
  }

  // ---------- разовые действия ----------
  G.bus.on('input:gear', () => {
    const p = G.player;
    if (!p || !p.alive) return;
    if (!p.spec.retract) { G.bus.emit('ui:toast', { text: 'Шасси неубирающееся', kind: 'info' }); return; }
    if (p.onGround) { G.bus.emit('ui:toast', { text: 'На земле шасси не убирают', kind: 'info' }); return; }
    p.gearDown = !p.gearDown;
    haptic(12);
  });
  G.bus.on('input:flaps', (e) => {
    const p = G.player;
    if (!p || !p.alive) return;
    if (!p.spec.flaps) { G.bus.emit('ui:toast', { text: 'Закрылков нет', kind: 'info' }); return; }
    const dir = (e && e.dir) || 1;
    let f = Math.round(p.flaps * 2) + dir;
    if (f > 2) f = 0;
    if (f < 0) f = 0;
    p.flaps = f / 2;
    haptic(10);
  });
  G.bus.on('input:timescale', (e) => {
    if (G.mode !== 'flight' || G.paused) return;
    const want = e && e.scale ? e.scale : G.time.scale >= 4 ? 1 : G.time.scale * 2;
    if (want > 1) {
      const why = timescaleBlock();
      if (why) { G.bus.emit('ui:toast', { text: `Ускорение недоступно: ${why}`, kind: 'info' }); G.time.scale = 1; return; }
    }
    G.time.scale = want === 2 || want === 4 ? want : 1;
    tsCheck = 0;
  });
  G.bus.on('ac:damage', (e) => {
    if (e && e.ac === G.player) { lastCombatT = G.time.sim; haptic(40); }
  });
  G.bus.on('weapon:fire', (e) => {
    if (e && e.ac === G.player) lastCombatT = G.time.sim;
  });
  G.bus.on('ac:touchdown', (e) => {
    if (e && e.ac === G.player) haptic(Math.round(clamp(Math.abs(e.vs || 0) * 14, 15, 90)));
  });
  G.bus.on('ac:crash', (e) => {
    if (e && e.ac === G.player) { haptic([120, 60, 200]); input.release(); }
  });
  G.bus.on('flight:start', () => {
    input.reset();
    input.setAction(null);
    lastCombatT = -1e9;
    look.dx = look.dy = 0; look.zoom = 1; look.reset = true;
    state.throttle = G.player && !G.player.onGround ? 0.7 : 0;
  });
  G.bus.on('flight:end', () => { input.reset(); input.setAction(null); });
  G.bus.on('pause', () => input.release());
  G.bus.on('menu:show', () => input.release());

  input.touch = createTouch(G, input);
  return input;
}
