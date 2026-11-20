// КАМЕРА. Контракт — в ARCHITECTURE.md: mode, next(), snap(), update(dtReal), setShowcase(), showcaseRotate().
// Режимы полёта: 'chase' (сзади), 'cockpit' (из кабины), 'flyby' (пролётная / «с вышки»).
// Автоматически: облёт в паузе, фоторежим (rig.photo), отъезд после аварии, облёт на разборе полёта.
// В меню — кинематографичные планы мира либо витрина ангара.
// Сверх контракта: rig.view (фактический вид), rig.shake(сила), rig.setPhoto(bool), rig.setHangar (= setShowcase).
import * as THREE from 'three';
import { clamp, damp, smoothstep, wrapPi, DEG } from '../core/util.js';
import { afterburnerFrom } from './input.js';

const VIEW_NAMES = { chase: 'Вид сзади', cockpit: 'Вид из кабины', flyby: 'Пролётная камера' };
const ORDER = ['chase', 'cockpit', 'flyby'];

export function createCameraRig(G) {
  const cam = G.camera;
  const UP = new THREE.Vector3(0, 1, 0);
  const P = new THREE.Vector3(), T = new THREE.Vector3(), Q = new THREE.Quaternion();
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _p = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4();

  const st = {
    t: 0, eff: '', snap: true,
    yaw: 0, pit: 0, up: new THREE.Vector3(0, 1, 0),
    lookYaw: 0, lookPit: 0, zoom: 1, idle: 9,
    trauma: 0, rumble: 0, fov: 56, near: 1,
    orbYaw: 0, orbPit: 0.2, orbDist: 40, orbDist0: 40,
    blend: 0, blendDur: 0.55, fromRel: new THREE.Vector3(), fromQuat: new THREE.Quaternion(),
    fly: { pos: new THREE.Vector3(), t: 0, valid: false, tower: null },
    hidden: null,
    // меню
    shots: null, shot: 0, shotT: 0, kick: 1, fade: -1,
    show: null,
  };

  // затемнение для смены планов (под всеми слоями интерфейса)
  const fadeEl = document.createElement('div');
  fadeEl.className = 'hud-camfade';
  G.ui.insertBefore(fadeEl, G.ui.firstChild);
  function setFade(a) {
    const q = Math.round(clamp(a, 0, 1) * 50);
    if (q === st.fade) return;
    st.fade = q;
    fadeEl.style.opacity = (q / 50).toFixed(2);
  }

  const groundY = (x, z) => {
    const g = G.world.groundAt(x, z);
    return g ? g.y : 0;
  };
  const baseFov = () => {
    const a = cam.aspect || 1.8;
    return a >= 1.5 ? 56 : (2 * Math.atan(Math.tan(28 * DEG) * clamp(1.5 / a, 1, 1.9))) / DEG;
  };
  const sizeOf = (ac) => Math.max(ac.spec.length, ac.spec.span * 0.8);
  function lookQuat(out, eye, target, up) {
    _m.lookAt(eye, target, up);
    out.setFromRotationMatrix(_m);
  }
  function restoreModel() {
    if (st.hidden) { st.hidden.visible = true; st.hidden = null; }
  }

  // ---------- осмотр пальцем ----------
  let ldx = 0, ldy = 0, lzoom = 1, held = false;
  function readLook(active) {
    const lk = G.input && G.input.look;
    ldx = ldy = 0; lzoom = 1; held = false;
    if (!lk) return;
    if (active) { ldx = lk.dx; ldy = lk.dy; lzoom = lk.zoom; held = lk.held; }
    if (lk.reset) { lk.reset = false; st.lookYaw = st.lookPit = 0; st.zoom = 1; }
    lk.dx = lk.dy = 0; lk.zoom = 1;
  }
  function relaxLook(dt, delay) {
    if (held || ldx || ldy) { st.idle = 0; return; }
    st.idle += Math.min(dt, 0.1);
    if (st.idle > delay) {
      st.lookYaw = damp(st.lookYaw, 0, 3.2, dt);
      st.lookPit = damp(st.lookPit, 0, 3.2, dt);
      if (Math.abs(st.lookYaw) < 1e-3) st.lookYaw = 0;
      if (Math.abs(st.lookPit) < 1e-3) st.lookPit = 0;
    }
  }

  // ---------- вид сзади ----------
  function chase(ac, dt) {
    _f.set(0, 0, -1).applyQuaternion(ac.quat);
    const h2 = _f.x * _f.x + _f.z * _f.z;
    const yawT = Math.atan2(_f.x, -_f.z);
    const pitT = Math.asin(clamp(_f.y, -1, 1)) * 0.55;
    if (st.snap) { st.yaw = yawT; st.pit = pitT; st.up.set(0, 1, 0); }
    // у вертикали курс не определён — там за ним не гонимся
    st.yaw += wrapPi(yawT - st.yaw) * (1 - Math.exp(-5.5 * h2 * dt));
    st.pit = damp(st.pit, pitT, 4, dt);
    st.lookYaw = wrapPi(st.lookYaw + ldx);
    st.lookPit = clamp(st.lookPit + ldy, -0.9, 1.15);
    st.zoom = clamp(st.zoom * lzoom, 0.55, 3.2);
    relaxLook(dt, 1.4);

    const size = sizeOf(ac);
    const sp = clamp(ac.ias / ac.spec.vMax, 0, 1.2);
    const portrait = clamp(1.25 / (cam.aspect || 1.8), 1, 1.7);
    const dist = (size * 1.5 + 9) * st.zoom * (1 + 0.14 * sp) * portrait;
    const yaw = st.yaw + st.lookYaw;
    const el = clamp(0.21 - st.pit + st.lookPit, -1.25, 1.45);
    const ce = Math.cos(el);
    P.set(ac.pos.x - Math.sin(yaw) * ce * dist, ac.pos.y + Math.sin(el) * dist, ac.pos.z + Math.cos(yaw) * ce * dist);
    const gy = groundY(P.x, P.z) + 1.6;
    if (P.y < gy) P.y = gy;

    // точка взгляда: чуть впереди по фактическому курсу и ниже самолёта — он стоит выше центра и не закрыт приборами
    const lookFree = 1 - clamp(Math.abs(st.lookYaw) + Math.abs(st.lookPit), 0, 1);
    const ahead = dist * 0.25 * lookFree, down = dist * (cam.aspect > 1.6 ? 0.125 : 0.09) * lookFree;
    T.set(ac.pos.x + Math.sin(yawT) * ahead * Math.sqrt(h2), ac.pos.y - down + size * 0.06, ac.pos.z - Math.cos(yawT) * ahead * Math.sqrt(h2));
    // лёгкий наклон горизонта вслед за креном
    _u.set(0, 1, 0).applyQuaternion(ac.quat);
    if (_u.y > -0.2) _u.lerp(UP, 0.8).normalize(); else _u.copy(UP);
    st.up.x = damp(st.up.x, _u.x, 3.5, dt); st.up.y = damp(st.up.y, _u.y, 3.5, dt); st.up.z = damp(st.up.z, _u.z, 3.5, dt);
    st.up.normalize();
    lookQuat(Q, P, T, st.up);

    const ab = afterburnerFrom(ac.spec);
    const fovT = baseFov() + 13 * smoothstep(0.45, 1.05, sp) + (ab && ac.throttle >= ab ? 3 : 0);
    st.fov = st.snap ? fovT : damp(st.fov, fovT, 2.2, dt);
    st.near = clamp((dist - size * 0.8) * 0.5, 0.4, 14);
    const hCam = P.y - (gy - 1.6);
    if (st.near > hCam * 0.5) st.near = Math.max(0.3, hCam * 0.5);
  }

  // ---------- из кабины ----------
  function cockpit(ac, dt) {
    const an = ac.model && ac.model.userData && ac.model.userData.anchors;
    const a = an && an.cockpit;
    const L = ac.spec.length;
    if (a && typeof a.x === 'number') _v.set(a.x, a.y, a.z);
    else _v.set(0, L * 0.075 + 0.45, -L * 0.26);
    P.copy(_v).applyQuaternion(ac.quat).add(ac.pos);
    st.lookYaw = clamp(st.lookYaw - ldx, -2.5, 2.5);
    st.lookPit = clamp(st.lookPit + ldy, -0.7, 1.15);
    relaxLook(dt, 1.8);
    _e.set(st.lookPit, -st.lookYaw, 0, 'YXZ');
    Q.copy(ac.quat).multiply(_q.setFromEuler(_e));
    // свою модель скрываем: чистый обзор + коллиматор HUD
    if (ac.model && st.hidden !== ac.model) { restoreModel(); ac.model.visible = false; st.hidden = ac.model; }
    const fovT = baseFov() + 8;
    st.fov = st.snap ? fovT : damp(st.fov, fovT, 4, dt);
    st.near = clamp(ac.agl * 0.25, 0.35, 5);
  }

  // ---------- пролётная / «с вышки» ----------
  function placeFly(ac) {
    const fl = st.fly, size = sizeOf(ac);
    const v = ac.vel.length();
    fl.valid = true; fl.t = 0;
    const na = G.world.nearestAirport ? G.world.nearestAirport(ac.pos.x, ac.pos.z) : null;
    if (na && na.airport && na.dist < 3200 && ac.agl < 450 && na.airport.runways && na.airport.runways[0]) {
      const ap = na.airport;
      if (fl.tower === ap) return;
      fl.tower = ap;
      const rw = ap.runways[0];
      if (ap.tower && typeof ap.tower.x === 'number') fl.pos.set(ap.tower.x, (ap.elevation || 0) + (ap.tower.height || ap.tower.h || 34), ap.tower.z);
      else fl.pos.set(rw.cx - Math.cos(rw.heading) * 200, (ap.elevation || 0) + 36, rw.cz - Math.sin(rw.heading) * 200);
      const gy = groundY(fl.pos.x, fl.pos.z) + 12;
      if (fl.pos.y < gy) fl.pos.y = gy;
      return;
    }
    fl.tower = null;
    if (v > 3) _f.copy(ac.vel).multiplyScalar(1 / v); else _f.set(0, 0, -1).applyQuaternion(ac.quat);
    _u.set(-_f.z, 0, _f.x); // вправо от траектории
    if (_u.lengthSq() < 1e-4) _u.set(1, 0, 0); else _u.normalize();
    const r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
    const lead = v * (2.2 + r1 * 1.4) + size * 2.5;
    const side = (r2 < 0.5 ? -1 : 1) * (size * 1.1 + 10 + r3 * 45);
    fl.pos.copy(ac.pos).addScaledVector(_f, lead).addScaledVector(_u, side);
    fl.pos.y += (r3 - 0.65) * size * 1.6;
    const gy = groundY(fl.pos.x, fl.pos.z);
    if (ac.agl < 80) fl.pos.y = Math.min(fl.pos.y, gy + 3 + r1 * 6);
    if (fl.pos.y < gy + 2.2) fl.pos.y = gy + 2.2;
  }
  function flyby(ac, dt) {
    const fl = st.fly, size = sizeOf(ac);
    fl.t += Math.min(dt, 0.1);
    _v.subVectors(ac.pos, fl.pos);
    const d = _v.length();
    const v = ac.vel.length();
    const away = _v.dot(ac.vel) > 0;
    const maxD = Math.max(320, v * 5) + size * 4;
    if (!fl.valid || (fl.tower ? d > 4200 || ac.agl > 600 : (away && d > maxD) || d > maxD * 2.6 || fl.t > 18)) placeFly(ac);
    else if (!fl.tower && fl.t > 2 && ac.agl < 450 && v < 90) {
      const na = G.world.nearestAirport ? G.world.nearestAirport(ac.pos.x, ac.pos.z) : null;
      if (na && na.dist < 2500 && away) placeFly(ac);
    }
    P.copy(fl.pos);
    T.copy(ac.pos);
    lookQuat(Q, P, T, UP);
    const dd = Math.max(P.distanceTo(T), 1);
    const fovT = clamp((2 * Math.atan((size * 1.7) / dd)) / DEG, 6, baseFov());
    st.fov = st.snap || fl.t === 0 ? fovT : damp(st.fov, fovT, 3, dt);
    st.near = clamp(dd * 0.2, 0.5, 30);
    const hCam = P.y - groundY(P.x, P.z);
    if (st.near > hCam * 0.5) st.near = Math.max(0.3, hCam * 0.5);
  }

  // ---------- облёт: пауза, фоторежим, разбор, авария ----------
  function enterOrbit(ac, fromCockpit) {
    const size = sizeOf(ac);
    _v.subVectors(cam.position, ac.pos);
    let d = _v.length();
    if (fromCockpit || d < size * 0.8 || d > size * 14 + 300) {
      _f.set(0, 0, -1).applyQuaternion(ac.quat);
      const yaw = Math.atan2(_f.x, -_f.z);
      d = size * 1.5 + 9;
      _v.set(-Math.sin(yaw) * d, d * 0.22, Math.cos(yaw) * d);
      d = _v.length();
    }
    st.orbDist = st.orbDist0 = d;
    st.orbYaw = Math.atan2(_v.x, _v.z);
    st.orbPit = Math.asin(clamp(_v.y / d, -1, 1));
  }
  function orbit(ac, dt, kind) {
    const size = sizeOf(ac), dtc = Math.min(dt, 0.1);
    st.orbYaw -= ldx;
    st.orbPit = clamp(st.orbPit + ldy, -0.35, 1.45);
    st.orbDist = clamp(st.orbDist * lzoom, size * 0.75 + 3, size * 14 + 300);
    if (held || ldx || ldy) st.idle = 0; else st.idle += dtc;
    if (kind === 'crash') {
      st.orbDist = damp(st.orbDist, Math.max(st.orbDist0 * 2.3, size * 4 + 45), 0.9, dtc);
      st.orbPit = damp(st.orbPit, 0.42, 0.8, dtc);
      st.orbYaw += 0.1 * dtc;
    } else if (kind !== 'photo' && st.idle > 0.6) {
      st.orbYaw += (kind === 'debrief' ? 0.1 : 0.06) * dtc;
      if (kind === 'debrief') { st.orbPit = damp(st.orbPit, 0.24, 0.5, dtc); st.orbDist = damp(st.orbDist, size * 2 + 14, 0.5, dtc); }
    }
    const ce = Math.cos(st.orbPit);
    T.copy(ac.pos);
    P.set(T.x + Math.sin(st.orbYaw) * ce * st.orbDist, T.y + Math.sin(st.orbPit) * st.orbDist, T.z + Math.cos(st.orbYaw) * ce * st.orbDist);
    const gy = groundY(P.x, P.z) + 1.2;
    if (P.y < gy) P.y = gy;
    lookQuat(Q, P, T, UP);
    const fovT = kind === 'photo' ? baseFov() - 8 : baseFov() - 4;
    st.fov = damp(st.fov, fovT, 3, dt);
    st.near = clamp((st.orbDist - size * 0.8) * 0.4, 0.3, 10);
    const hCam = P.y - (gy - 1.2);
    if (st.near > hCam * 0.5) st.near = Math.max(0.25, hCam * 0.5);
  }

  // ---------- меню: кинематографичные планы ----------
  function buildShots() {
    const w = G.world, A = w.airportById || {}, O = w.poiById || {};
    const list = [];
    const add = (o, r, h, look, a0, om, fov, summit) => { if (o && typeof o.x === 'number') list.push({ o, r, h, look, a0, om, fov, summit: !!summit }); };
    add(A.yasny, 2300, 360, 20, 0.7, 0.034, 46);            // главный аэропорт
    add(O.city_yasny, 1700, 400, 50, 2.5, -0.04, 48);       // город
    add(O.lighthouse, 520, 95, 30, 4.1, 0.07, 44);          // маяк
    add(O.peak, 2700, 260, -120, 1.2, -0.03, 44, true);     // горы
    add(A.gnezdo, 1350, 230, 10, 5.2, 0.045, 46);           // горная площадка
    add(O.port_gavan, 1150, 210, 15, 3.3, -0.05, 46);       // порт
    add(O.volcano, 3600, 420, -160, 0.3, 0.024, 46, true);  // вулкан
    add(A.carrier, 640, 105, 14, 2.0, 0.06, 44);            // авианосец
    add(O.bridge, 900, 140, 20, 5.6, -0.055, 46);           // мост
    add(A.kamenny, 1900, 300, 15, 4.4, 0.04, 46);           // авиабаза
    if (!list.length) list.push({ o: { x: 0, z: 0 }, r: 3000, h: 600, look: 0, a0: 0, om: 0.03, fov: 50, summit: false });
    st.shots = list;
  }
  const SHOT_DUR = 25;
  function cinematic(dt) {
    if (!st.shots) buildShots();
    const dtc = Math.min(dt, 0.1);
    st.shotT += dtc;
    if (st.shotT >= SHOT_DUR) { st.shotT = 0; st.shot = (st.shot + 1) % st.shots.length; }
    const s = st.shots[st.shot], k = st.shotT / SHOT_DUR;
    const gy = Math.max(0, typeof s.o.elevation === 'number' ? s.o.elevation : G.world.heightAt(s.o.x, s.o.z));
    const a = s.a0 + s.om * st.shotT;
    const r = s.r * (1 - 0.1 * k);
    P.set(s.o.x + Math.sin(a) * r, gy + s.h * (1 + 0.12 * Math.sin(k * 3.1)), s.o.z + Math.cos(a) * r);
    const floor = Math.max(0, G.world.heightAt(P.x, P.z)) + 60;
    if (P.y < floor) P.y = floor;
    T.set(s.o.x, gy + s.look, s.o.z);
    lookQuat(Q, P, T, UP);
    st.fov = clamp(s.fov * clamp(1.5 / (cam.aspect || 1.8), 1, 1.6), 30, 80);
    st.near = 8;
    st.kick = Math.max(st.kick, smoothstep(SHOT_DUR - 0.9, SHOT_DUR - 0.05, st.shotT));
  }

  // ---------- меню: витрина ангара ----------
  function showcase(dt) {
    const s = st.show, dtc = Math.min(dt, 0.1);
    s.cx = damp(s.cx, s.x, 5, dt); s.cy = damp(s.cy, s.y, 5, dt); s.cz = damp(s.cz, s.z, 5, dt);
    s.r = damp(s.r, s.radius, 4, dt);
    s.idle += dtc;
    if (s.idle > 2.5) { s.yaw += 0.11 * dtc; s.pit = damp(s.pit, 0.15, 0.6, dtc); }
    const aspect = cam.aspect || 1.8;
    const dist = s.r * 2.75 * Math.max(1, 1.3 / aspect) * s.zoom;
    const ce = Math.cos(s.pit);
    T.set(s.cx, s.cy + s.r * 0.04, s.cz);
    P.set(T.x + Math.sin(s.yaw) * ce * dist, T.y + Math.sin(s.pit) * dist, T.z + Math.cos(s.yaw) * ce * dist);
    const gy = groundY(P.x, P.z) + 0.5;
    if (P.y < gy) P.y = gy;
    lookQuat(Q, P, T, UP);
    st.fov = 38;
    st.near = clamp(dist * 0.05, 0.2, 3);
  }

  // ---------- тряска ----------
  function applyShake(ac, dt) {
    const dtc = Math.min(dt, 0.1);
    st.trauma = Math.max(0, st.trauma - dtc * 1.6);
    let rumble = 0;
    if (ac && ac.alive && G.mode === 'flight' && !G.paused) {
      if (ac.stalled) rumble = 0.38;
      const ab = afterburnerFrom(ac.spec);
      if (ab && ac.throttle >= ab) rumble = Math.max(rumble, 0.1);
      if (ac.ias > ac.spec.vMax * 0.97) rumble = Math.max(rumble, 0.22);
      if (ac.onGround) rumble = Math.max(rumble, clamp(ac.ias / ac.spec.vStall, 0, 1) * (ac.surface === 'ground' ? 0.3 : 0.07));
      if (ac.airbrake > 0.5 && !ac.onGround) rumble = Math.max(rumble, 0.08);
    }
    st.rumble = damp(st.rumble, rumble, 6, dtc);
    const s = Math.max(st.trauma * st.trauma, st.rumble);
    if (s < 0.004) return;
    const t = st.t * 31;
    const k = s * (st.eff === 'cockpit' ? 0.014 : 0.02);
    _e.set(Math.sin(t * 1.13 + 1.7) * k, Math.sin(t * 0.97) * k, Math.sin(t * 1.31 + 4.1) * k * 0.8, 'YXZ');
    Q.multiply(_q.setFromEuler(_e));
  }

  function finish() {
    cam.position.copy(P);
    cam.quaternion.copy(Q);
    const fov = Math.round(st.fov * 20) / 20;
    let dirty = false;
    if (Math.abs(cam.fov - fov) > 0.04) { cam.fov = fov; dirty = true; }
    if (Math.abs(cam.near - st.near) > cam.near * 0.04) { cam.near = st.near; dirty = true; }
    if (dirty) cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  const rig = {
    mode: 'chase',          // выбранный игроком вид: 'chase' | 'cockpit' | 'flyby'
    view: 'menu',           // фактический: + 'pause' | 'photo' | 'debrief' | 'crash' | 'menu' | 'showcase'
    photo: false,
    get lookActive() { return Math.abs(st.lookYaw) + Math.abs(st.lookPit) > 0.04; },
    next() {
      rig.setMode(ORDER[(ORDER.indexOf(rig.mode) + 1) % ORDER.length]);
      G.bus.emit('ui:toast', { text: VIEW_NAMES[rig.mode], kind: 'info' });
    },
    setMode(m) {
      if (ORDER.indexOf(m) < 0 && m !== 'orbit') return;
      rig.mode = m === 'orbit' ? 'chase' : m;
      if (m === 'orbit') rig.setPhoto(true);
    },
    setPhoto(on) { rig.photo = !!on; },
    snap() { st.snap = true; },
    shake(amount) { st.trauma = clamp(st.trauma + (amount || 0.4), 0, 1); },
    // витрина ангара: камера облетает точку; null — вернуться к видам мира
    setShowcase(t) {
      if (!t) { if (st.show) { st.show = null; st.kick = 1; } return; }
      const r = t.radius || 12;
      if (!st.show) {
        st.show = { x: t.x, y: t.y, z: t.z, radius: r, cx: t.x, cy: t.y, cz: t.z, r, yaw: 0.75, pit: 0.15, zoom: 1, idle: 0 };
        st.kick = 1;
      } else { st.show.x = t.x; st.show.y = t.y; st.show.z = t.z; st.show.radius = r; }
    },
    // поворот пальцем: dYaw > 0 — палец вправо (камера уходит влево), dPitch > 0 — палец вниз (камера поднимается)
    showcaseRotate(dYaw, dPitch) {
      const s = st.show;
      if (!s) return;
      s.yaw -= dYaw || 0;
      s.pit = clamp(s.pit + (dPitch || 0), -0.04, 1.2);
      s.idle = 0;
    },
    showcaseZoom(f) { if (st.show) st.show.zoom = clamp(st.show.zoom * (f || 1), 0.6, 2.2); },
    update(dtReal) {
      const dt = Math.max(0, dtReal || 0);
      st.t += Math.min(dt, 0.1);
      const ac = G.player;
      if (G.mode !== 'flight' && G.mode !== 'debrief' || !ac) {
        restoreModel();
        readLook(false);
        const eff = st.show ? 'showcase' : 'menu';
        if (eff !== st.eff) { st.eff = rig.view = eff; st.kick = 1; }
        if (st.show) showcase(dt); else cinematic(dt);
        st.blend = 0;
        st.kick = Math.max(0, st.kick - Math.min(dt, 0.1) / 1.1);
        setFade(st.kick);
        st.trauma = 0; st.rumble = 0;
        finish();
        return;
      }
      let eff = rig.mode;
      if (!ac.alive) eff = 'crash';
      else if (G.mode === 'debrief') eff = 'debrief';
      else if (rig.photo) eff = 'photo';
      else if (G.paused) eff = 'pause';
      if (eff !== st.eff) {
        const from = st.eff;
        const fromFlight = from !== 'menu' && from !== 'showcase' && from !== '';
        if (fromFlight && !st.snap) {
          st.fromRel.subVectors(cam.position, ac.pos);
          st.fromQuat.copy(cam.quaternion);
          st.blend = 1;
          st.blendDur = eff === 'crash' ? 0.01 : 0.55;
        } else { st.snap = true; st.kick = 1; }
        if (eff === 'crash' || eff === 'debrief' || eff === 'photo' || eff === 'pause') {
          if (!(from === 'pause' || from === 'photo' || (from === 'crash' && eff === 'debrief'))) enterOrbit(ac, from === 'cockpit' || !fromFlight);
          st.idle = eff === 'photo' ? 0 : 9;
        } else {
          st.lookYaw = st.lookPit = 0;
          st.fly.valid = false; st.fly.tower = null;
        }
        if (eff !== 'cockpit') restoreModel();
        st.eff = rig.view = eff;
      }
      readLook(true);
      if (eff === 'chase') chase(ac, dt);
      else if (eff === 'cockpit') cockpit(ac, dt);
      else if (eff === 'flyby') flyby(ac, dt);
      else orbit(ac, dt, eff);

      // не подходить вплотную к другим самолётам ближней плоскостью
      const list = G.aircraft;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === ac || !o.pos) continue;
        const d = P.distanceTo(o.pos) - (o.spec ? o.spec.length : 15);
        if (d * 0.4 < st.near) st.near = Math.max(0.3, d * 0.4);
      }

      if (st.blend > 0) {
        st.blend = Math.max(0, st.blend - Math.min(dt, 0.1) / st.blendDur);
        const k = 1 - st.blend, e = k * k * (3 - 2 * k);
        _p.copy(ac.pos).add(st.fromRel);
        P.lerpVectors(_p, P, e);
        Q.copy(_q.copy(st.fromQuat).slerp(Q, e));
      }
      applyShake(ac, dt);
      st.kick = Math.max(0, st.kick - Math.min(dt, 0.1) / 0.6);
      setFade(st.kick);
      st.snap = false;
      finish();
    },
  };
  rig.setHangar = rig.setShowcase;

  G.bus.on('input:camera', () => { if (G.mode === 'flight' && !G.paused && G.player && G.player.alive && !rig.photo) rig.next(); });
  G.bus.on('flight:start', () => {
    rig.photo = false;
    if (rig.mode === 'flyby') rig.mode = 'chase';
    st.lookYaw = st.lookPit = 0; st.zoom = 1; st.trauma = 0;
    st.fly.valid = false; st.fly.tower = null;
    st.eff = '';
    rig.snap();
  });
  G.bus.on('flight:end', () => { rig.photo = false; });
  G.bus.on('menu:show', () => { restoreModel(); rig.photo = false; st.shotT = 0; st.shot = st.shots ? (st.shot + 1) % st.shots.length : 0; st.kick = 1; });
  G.bus.on('ac:remove', (e) => { if (e && e.ac && e.ac.model === st.hidden) restoreModel(); });
  G.bus.on('ac:touchdown', (e) => { if (e && e.ac === G.player) rig.shake(clamp(Math.abs(e.vs || 0) / 5, 0.2, 0.9)); });
  G.bus.on('ac:damage', (e) => { if (e && e.ac === G.player) rig.shake(clamp(0.3 + (e.amount || 0) / 40, 0.3, 0.9)); });
  G.bus.on('ac:crash', (e) => { if (e && e.ac === G.player) rig.shake(1); });
  G.bus.on('ac:stall', (e) => { if (e && e.ac === G.player) rig.shake(0.35); });
  return rig;
}
