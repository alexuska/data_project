// СЕНСОРНОЕ УПРАВЛЕНИЕ: плавающая ручка (левый большой палец), РУД и кнопки (правый), верхние мелкие кнопки,
// осмотр перетаскиванием по свободной части экрана и щипок. Всё на pointer events с захватом указателя:
// каждый элемент помнит свой pointerId, поэтому ручка + РУД + кнопка работают одновременно и не «залипают».
import { clamp } from '../core/util.js';
import { saveProfile } from '../core/save.js';
import { afterburnerFrom } from '../systems/input.js';

// общий масштаб интерфейса полёта: 1 на телефоне 844×390, ~1.4 на планшете
export function uiScale(w, h) {
  return clamp(Math.min(Math.max(w, h) / 844, Math.min(w, h) / 390), 0.85, 1.5);
}

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/>${extra}</svg>`;
const ICON = {
  pause: svg('M8.5 5v14M15.5 5v14'),
  camera: svg('M3 8h4l2-3h6l2 3h4v11H3z', '<circle cx="12" cy="13.2" r="3.4"/>'),
  map: svg('M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14'),
  brake: svg('M4.6 6.5a9.4 9.4 0 000 11M19.4 6.5a9.4 9.4 0 010 11M12 9.3v3.2M12 14.7v.3', '<circle cx="12" cy="12" r="5.6"/>'),
  gear: svg('M6 3.5h12M12 3.5v9', '<circle cx="12" cy="16.4" r="3.9"/>'),
  flaps: svg('M2 8.5c4-3 9.5-3 13.5 0H2zM15.5 8.5l6.5 6.5'),
  fire: svg('M12 2.5v5.5M12 16v5.5M2.5 12H8M16 12h5.5', '<circle cx="12" cy="12" r="5.6"/>'),
  launch: svg('M12 2.5l2.6 4.6v8.4l3 4h-11.2l3-4V7.1z'),
  swap: svg('M4 9h14l-3.2-3.2M20 15H6l3.2 3.2'),
  bolt: svg('M13 2.5L5.5 13.5H11l-1 8 7.5-11H12z'),
};

export function createTouch(G, input) {
  const { raw, look } = input;
  const root = document.createElement('div');
  root.className = 'touch';
  root.hidden = true;
  root.innerHTML = `
    <div class="touch-zone"></div>
    <div class="touch-stick">
      <div class="touch-stick-base"><i></i><i></i><i></i><i></i></div>
      <div class="touch-stick-knob"></div>
    </div>
    <div class="touch-thr">
      <div class="touch-thr-track">
        <div class="touch-thr-ab" hidden><span>ФОРСАЖ</span></div>
        <div class="touch-thr-scale"></div>
        <div class="touch-thr-fill"></div>
        <div class="touch-thr-real"></div>
        <div class="touch-thr-handle"><b>РУД</b></div>
      </div>
      <div class="touch-thr-val">0%</div>
    </div>
    <div class="touch-cluster">
      <button type="button" class="touch-btn touch-b-action" hidden><span class="touch-ico">${ICON.bolt}</span><span class="touch-lbl"></span></button>
      <button type="button" class="touch-btn touch-b-wsel" hidden aria-label="Сменить оружие"><span class="touch-ico">${ICON.swap}</span><span class="touch-lbl">ВЫБОР</span></button>
      <button type="button" class="touch-btn touch-b-launch" hidden><span class="touch-cap"></span><span class="touch-ico">${ICON.launch}</span><span class="touch-lbl">ПУСК</span></button>
      <button type="button" class="touch-btn touch-b-gear"><span class="touch-lamps"><i></i><i></i><i></i></span><span class="touch-ico">${ICON.gear}</span><span class="touch-lbl">ШАССИ</span></button>
      <button type="button" class="touch-btn touch-b-fire" hidden><span class="touch-cap"></span><span class="touch-ico">${ICON.fire}</span><span class="touch-lbl">ОГОНЬ</span></button>
      <button type="button" class="touch-btn touch-b-flaps"><span class="touch-lamps touch-pips"><i></i><i></i></span><span class="touch-ico">${ICON.flaps}</span><span class="touch-lbl">ЗАКРЫЛКИ</span></button>
      <button type="button" class="touch-btn touch-b-brake"><span class="touch-ico">${ICON.brake}</span><span class="touch-lbl">ТОРМОЗ</span></button>
    </div>
    <div class="touch-top">
      <button type="button" class="touch-mini touch-m-time" aria-label="Ускорение времени"><span>×1</span></button>
      <button type="button" class="touch-mini touch-m-map" aria-label="Карта">${ICON.map}</button>
      <button type="button" class="touch-mini touch-m-cam" aria-label="Камера">${ICON.camera}</button>
      <button type="button" class="touch-mini touch-m-pause" aria-label="Пауза">${ICON.pause}</button>
    </div>
    <div class="touch-hint touch-hint-stick" hidden><b>РУЧКА</b>веди пальцем: на себя — нос вверх</div>
    <div class="touch-hint touch-hint-thr" hidden><b>РУД</b>вверх — больше тяги</div>
    <div class="touch-hint touch-hint-look" hidden>Проведи по небу — осмотреться, двумя пальцами — приблизить</div>`;
  G.ui.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const el = {
    zone: $('.touch-zone'), stick: $('.touch-stick'), knob: $('.touch-stick-knob'),
    thr: $('.touch-thr'), track: $('.touch-thr-track'), handle: $('.touch-thr-handle'), thrVal: $('.touch-thr-val'), ab: $('.touch-thr-ab'),
    action: $('.touch-b-action'), wsel: $('.touch-b-wsel'), launch: $('.touch-b-launch'), gear: $('.touch-b-gear'),
    fire: $('.touch-b-fire'), flaps: $('.touch-b-flaps'), brake: $('.touch-b-brake'),
    time: $('.touch-m-time'), map: $('.touch-m-map'), cam: $('.touch-m-cam'), pause: $('.touch-m-pause'),
    hStick: $('.touch-hint-stick'), hThr: $('.touch-hint-thr'), hLook: $('.touch-hint-look'),
  };
  const timeTxt = el.time.firstElementChild;
  const actionLbl = el.action.querySelector('.touch-lbl');
  const brakeLbl = el.brake.querySelector('.touch-lbl');
  const launchLbl = el.launch.querySelector('.touch-lbl');
  const launchCap = el.launch.querySelector('.touch-cap');
  const fireCap = el.fire.querySelector('.touch-cap');

  let S = 1, W = 0, H = 0, restX = 0, restY = 0, needLayout = true;
  const releasers = [];
  const seen = () => G.profile.seen || (G.profile.seen = {});
  function markSeen(key, hintEl) {
    if (hintEl && !hintEl.hidden) hintEl.hidden = true;
    if (seen()[key]) return;
    seen()[key] = 1;
    saveProfile(G.profile);
  }

  root.addEventListener('contextmenu', (e) => e.preventDefault());
  // страница не должна скроллиться и масштабироваться жестами (iOS)
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  G.canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ---------- кнопки ----------
  // удержание: down при касании, up при отпускании/отмене/потере захвата
  function hold(node, down, up) {
    let pid = null;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      try { node.setPointerCapture(pid); } catch (err) { /* указатель уже отпущен */ }
      node.classList.add('is-down');
      down(e);
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      node.classList.remove('is-down');
      if (up) up();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('lostpointercapture', end);
    releasers.push(() => {
      if (pid === null) return;
      try { node.releasePointerCapture(pid); } catch (err) { /* уже нет */ }
      pid = null;
      node.classList.remove('is-down');
      if (up) up();
    });
  }
  const tap = (node, fn) => hold(node, () => { input.haptic(8); fn(); });

  hold(el.brake, () => { raw.brake = true; input.haptic(8); }, () => { raw.brake = false; });
  hold(el.fire, () => { raw.fire = true; input.haptic(15); }, () => { raw.fire = false; });
  hold(el.launch, () => { raw.fireAlt = true; input.haptic(25); }, () => { raw.fireAlt = false; });
  tap(el.gear, () => G.bus.emit('input:gear'));
  tap(el.flaps, () => G.bus.emit('input:flaps', { dir: 1 }));
  tap(el.wsel, () => G.bus.emit('input:weapon'));
  tap(el.action, () => { if (input.action) G.bus.emit('input:action', { id: input.action.id }); });
  tap(el.pause, () => G.bus.emit('input:pause'));
  tap(el.cam, () => G.bus.emit('input:camera'));
  tap(el.map, () => G.bus.emit('input:map'));
  tap(el.time, () => G.bus.emit('input:timescale'));

  // ---------- ручка ----------
  let sPid = null, bx = 0, by = 0, ox = 0, oy = 0, R = 56;
  const shape = (v, a) => v * (a + (1 - a) * v * v); // около центра — точнее
  function placeStick(kx, ky) {
    el.stick.style.transform = `translate3d(${bx.toFixed(1)}px,${by.toFixed(1)}px,0)`;
    el.knob.style.transform = `translate3d(${kx.toFixed(1)}px,${ky.toFixed(1)}px,0)`;
  }
  function stickMove(e) {
    let dx = e.clientX - ox - bx, dy = e.clientY - oy - by;
    const d = Math.hypot(dx, dy);
    if (d > R) { // палец ушёл дальше хода — основание едет за пальцем
      const kf = (d - R) / d;
      bx += dx * kf; by += dy * kf;
      dx -= dx * kf; dy -= dy * kf;
    }
    placeStick(dx, dy);
    const dead = 0.09;
    const dc = Math.min(d, R), n = dc / R;
    if (n <= dead) { raw.stickX = raw.stickY = 0; return; }
    const m = (n - dead) / (1 - dead);
    const sens = clamp(G.profile.settings.sensitivity || 1, 0.4, 2.5);
    const a = clamp(0.4 * sens, 0.12, 1);
    // круг → «почти квадрат», чтобы по диагонали хватало хода
    const ux = clamp((dx / Math.max(dc, 1e-3)) * m * 1.18, -1, 1), uy = clamp((dy / Math.max(dc, 1e-3)) * m * 1.18, -1, 1);
    raw.stickX = Math.sign(ux) * shape(Math.abs(ux), a);
    raw.stickY = Math.sign(uy) * shape(Math.abs(uy), a);
  }
  function stickEnd(e) {
    if (e && e.pointerId !== sPid) return;
    if (sPid === null) return;
    sPid = null;
    raw.stickX = raw.stickY = 0;
    raw.stickHeld = false;
    el.stick.classList.remove('is-active');
    bx = restX; by = restY;
    placeStick(0, 0);
  }
  el.zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (sPid !== null) return;
    sPid = e.pointerId;
    try { el.zone.setPointerCapture(sPid); } catch (err) { /* уже отпущен */ }
    const r = root.getBoundingClientRect();
    ox = r.left; oy = r.top;
    R = 56 * S;
    bx = clamp(e.clientX - ox, R * 0.7, r.width - R * 0.7);
    by = clamp(e.clientY - oy, R * 0.7, r.height - R * 0.7);
    raw.stickHeld = true;
    el.stick.classList.add('is-active');
    stickMove(e);
    markSeen('ctlStick', el.hStick);
  });
  el.zone.addEventListener('pointermove', (e) => { if (e.pointerId === sPid) stickMove(e); });
  el.zone.addEventListener('pointerup', stickEnd);
  el.zone.addEventListener('pointercancel', stickEnd);
  el.zone.addEventListener('lostpointercapture', stickEnd);
  releasers.push(() => {
    if (sPid === null) return;
    try { el.zone.releasePointerCapture(sPid); } catch (err) { /* уже нет */ }
    stickEnd();
  });

  // ---------- РУД ----------
  let tPid = null, grabOff = 0, tTop = 0, tH = 1, hH = 1, abFrom = 0;
  function thrFromY(y) {
    let t = 1 - (y - grabOff - tTop - hH / 2) / Math.max(1, tH - hH);
    t = clamp(t, 0, 1);
    if (t < 0.025) t = 0;
    if (t > 0.985) t = 1;
    const prev = input.state.throttle;
    // лёгкий «щелчок» на упорах и на входе в форсаж
    if ((t === 0 && prev > 0) || (t === 1 && prev < 1) || (abFrom && (t >= abFrom) !== (prev >= abFrom))) input.haptic(10);
    input.setThrottle(t);
  }
  el.thr.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (tPid !== null) return;
    tPid = e.pointerId;
    try { el.thr.setPointerCapture(tPid); } catch (err) { /* уже отпущен */ }
    const tr = el.track.getBoundingClientRect(), hr = el.handle.getBoundingClientRect();
    tTop = tr.top; tH = tr.height; hH = hr.height;
    // взялись за рукоятку — без скачка; мимо — рукоятка приходит под палец
    grabOff = e.clientY >= hr.top - 6 && e.clientY <= hr.bottom + 6 ? e.clientY - (hr.top + hr.height / 2) : 0;
    el.thr.classList.add('is-down');
    thrFromY(e.clientY);
    markSeen('ctlThr', el.hThr);
  });
  el.thr.addEventListener('pointermove', (e) => { if (e.pointerId === tPid) thrFromY(e.clientY); });
  const thrEnd = (e) => {
    if (e && e.pointerId !== tPid) return;
    tPid = null;
    el.thr.classList.remove('is-down');
  };
  el.thr.addEventListener('pointerup', thrEnd);
  el.thr.addEventListener('pointercancel', thrEnd);
  el.thr.addEventListener('lostpointercapture', thrEnd);
  releasers.push(() => {
    if (tPid === null) return;
    try { el.thr.releasePointerCapture(tPid); } catch (err) { /* уже нет */ }
    thrEnd();
  });

  // ---------- осмотр: перетаскивание и щипок по свободной части экрана ----------
  const pts = new Map();
  let pinch = 0, tapT = 0, tapX = 0, tapY = 0, downT = 0, downX = 0, downY = 0, moved = 0;
  const canvas = G.canvas;
  const lookOn = () => G.mode === 'flight' || G.mode === 'debrief';
  function pinchDist() {
    let a = null, b = null;
    for (const p of pts.values()) { if (!a) a = p; else if (!b) b = p; }
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!lookOn()) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* уже отпущен */ }
    look.held = true;
    pinch = pts.size === 2 ? pinchDist() : 0;
    downT = performance.now(); downX = e.clientX; downY = e.clientY; moved = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 1) {
      const kk = 0.0052 / Math.sqrt(S);
      look.dx += dx * kk;
      look.dy += dy * kk;
      if (moved > 30) markSeen('ctlLook', el.hLook);
    } else if (pts.size === 2) {
      const d = pinchDist();
      if (pinch > 10 && d > 10) look.zoom *= pinch / d;
      pinch = d;
    }
  });
  const lookEnd = (e) => {
    if (!pts.delete(e.pointerId)) return;
    look.held = pts.size > 0;
    pinch = pts.size === 2 ? pinchDist() : 0;
    // двойной тап — вернуть вид
    const now = performance.now();
    if (e.type === 'pointerup' && now - downT < 260 && moved < 12) {
      if (now - tapT < 380 && Math.hypot(downX - tapX, downY - tapY) < 40) { look.reset = true; tapT = 0; }
      else { tapT = now; tapX = downX; tapY = downY; }
    }
  };
  canvas.addEventListener('pointerup', lookEnd);
  canvas.addEventListener('pointercancel', lookEnd);
  canvas.addEventListener('lostpointercapture', lookEnd);
  canvas.addEventListener('wheel', (e) => {
    if (!lookOn()) return;
    e.preventDefault();
    look.zoom *= Math.exp(clamp(e.deltaY, -200, 200) * 0.0012);
  }, { passive: false });

  // ---------- раскладка ----------
  function layout() {
    needLayout = false;
    const r = root.getBoundingClientRect();
    W = r.width || innerWidth; H = r.height || innerHeight;
    S = uiScale(W, H);
    root.style.setProperty('--hs', S.toFixed(3));
    const lefty = !!G.profile.settings.leftHanded;
    root.classList.toggle('touch-lefty', lefty);
    const z = el.zone.getBoundingClientRect();
    if (z.width > 0) {
      const cx = Math.min(z.width * 0.5, 128 * S);
      restX = (lefty ? z.right - cx : z.left + cx) - r.left;
      restY = z.bottom - r.top - Math.min(z.height * 0.5, 104 * S);
      if (sPid === null) { bx = restX; by = restY; placeStick(0, 0); }
    } else needLayout = true;
  }
  G.bus.on('resize', () => { needLayout = true; });
  G.bus.on('settings:changed', () => { needLayout = true; });

  // ---------- покадровое обновление (только изменившееся) ----------
  const last = { thr: -1, real: -1, gear: -1, flaps: -1, brake: -1, air: -1, time: -1, ab: -1, plane: null,
    gun: -2, slot: '', slotN: -2, nslots: -1, gearHint: -1, hasGear: -1, hasFlaps: -1 };
  let visible = false, shownT = 0;

  function setHidden(node, h) { if (node.hidden !== h) node.hidden = h; }

  const touch = {
    root,
    get scale() { return S; },
    release() {
      for (let i = 0; i < releasers.length; i++) releasers[i]();
      pts.clear();
      look.held = false;
      raw.brake = raw.fire = raw.fireAlt = false;
    },
    setAction(a) {
      setHidden(el.action, !a);
      if (a) actionLbl.textContent = a.label;
    },
    update(dt) {
      const p = G.player;
      const show = G.mode === 'flight' && !G.paused && !!p && p.alive && !(G.hud && G.hud.photoMode);
      if (show !== visible) {
        visible = show;
        root.hidden = !show;
        if (!show) touch.release();
        else { needLayout = true; shownT = 0; }
      }
      if (!show) return;
      if (needLayout) layout();
      shownT += dt;

      // РУД
      const thr = Math.round(input.state.throttle * 200);
      if (thr !== last.thr) {
        last.thr = thr;
        el.thr.style.setProperty('--t', (thr / 200).toFixed(3));
        el.thrVal.textContent = Math.round(thr / 2) + '%';
      }
      const real = Math.round(clamp(p.throttle, 0, 1) * 100);
      if (real !== last.real) { last.real = real; el.thr.style.setProperty('--a', (real / 100).toFixed(2)); }
      if (p.spec !== last.plane) {
        last.plane = p.spec;
        abFrom = afterburnerFrom(p.spec);
        setHidden(el.ab, !abFrom);
        if (abFrom) el.thr.style.setProperty('--ab', (1 - abFrom).toFixed(3));
      }
      const ab = abFrom && input.state.throttle >= abFrom ? 1 : 0;
      if (ab !== last.ab) { last.ab = ab; el.thr.classList.toggle('is-ab', !!ab); }

      // шасси: три лампы
      const hasGear = p.spec.retract ? 1 : 0;
      if (hasGear !== last.hasGear) { last.hasGear = hasGear; setHidden(el.gear, !hasGear); }
      const g = p.gearPos > 0.98 ? 2 : p.gearPos < 0.02 ? 0 : 1;
      if (g !== last.gear) {
        last.gear = g;
        el.gear.classList.toggle('is-on', g === 2);
        el.gear.classList.toggle('is-move', g === 1);
      }
      // подсказка: убрать шасси после взлёта / выпустить перед посадкой
      const gearHint = hasGear && ((p.gearDown && !p.onGround && p.agl > 40 && p.vs > 1 && p.ias > p.spec.vStall * 1.25) ||
        (!p.gearDown && !p.onGround && p.agl < 180 && p.vs < -0.5 && p.ias < p.spec.vStall * 1.9)) ? 1 : 0;
      if (gearHint !== last.gearHint) { last.gearHint = gearHint; el.gear.classList.toggle('is-hint', !!gearHint); }

      // закрылки: 0/1/2
      const hasFlaps = p.spec.flaps ? 1 : 0;
      if (hasFlaps !== last.hasFlaps) { last.hasFlaps = hasFlaps; setHidden(el.flaps, !hasFlaps); }
      const f = Math.round(p.flaps * 2);
      if (f !== last.flaps) {
        last.flaps = f;
        el.flaps.classList.toggle('is-f1', f >= 1);
        el.flaps.classList.toggle('is-f2', f >= 2);
      }
      const air = p.onGround ? 0 : 1;
      if (air !== last.air) { last.air = air; brakeLbl.textContent = air && p.spec.airbrake !== false ? 'ЩИТКИ' : 'ТОРМОЗ'; }
      const br = input.state.brake ? 1 : 0;
      if (br !== last.brake) { last.brake = br; el.brake.classList.toggle('is-on', !!br); }

      // вооружение (необязательное поле ac.weapons)
      const w = p.weapons;
      const gun = w && w.gun ? Math.max(0, Math.round(w.gun.ammo)) : -1;
      if (gun !== last.gun) {
        last.gun = gun;
        setHidden(el.fire, gun < 0);
        if (gun >= 0) { fireCap.textContent = gun; el.fire.classList.toggle('is-empty', gun === 0); }
      }
      const slots = w && w.slots ? w.slots : null;
      const ns = slots ? slots.length : 0;
      if (ns !== last.nslots) {
        last.nslots = ns;
        setHidden(el.launch, ns === 0);
        setHidden(el.wsel, ns < 2);
      }
      if (ns) {
        const sl = slots[clamp(w.selected | 0, 0, ns - 1)];
        const cnt = Math.max(0, Math.round(sl.count));
        if (sl.id !== last.slot || cnt !== last.slotN) {
          last.slot = sl.id; last.slotN = cnt;
          const drop = sl.type === 'bomb' || sl.type === 'water' || sl.type === 'cargo';
          launchLbl.textContent = sl.type === 'flare' ? 'ЛОВУШКИ' : drop ? 'СБРОС' : 'ПУСК';
          launchCap.textContent = `${String(sl.name || '').slice(0, 9)} ${sl.type === 'water' ? '' : '×' + cnt}`;
          el.launch.classList.toggle('is-empty', cnt === 0);
        }
      }

      // ускорение времени
      const ts = G.time.scale;
      if (ts !== last.time) {
        last.time = ts;
        timeTxt.textContent = '×' + ts;
        el.time.classList.toggle('is-on', ts > 1);
      }

      // подсказки первого полёта
      const sn = seen();
      setHidden(el.hStick, !!sn.ctlStick);
      setHidden(el.hThr, !!sn.ctlThr || !sn.ctlStick);
      const lookHint = !sn.ctlLook && !!sn.ctlStick && !!sn.ctlThr && !p.onGround && shownT > 6;
      setHidden(el.hLook, !lookHint);
      if (lookHint && shownT > 26) markSeen('ctlLook', el.hLook);
    },
  };
  return touch;
}
