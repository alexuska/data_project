// ЭКЗЕМПЛЯР МОДЕЛИ И АНИМАЦИЯ.
// Модель = Group -> pose (стояночный наклон хвостовых колёс) -> два SkinnedMesh на общем «скелете»:
// корпус (Lambert, цвета вершин) и оверлей (огни, пламя, диски винтов). Кости — не объекты сцены,
// а просто матрицы: animate пересчитывает только те, чьё входное значение изменилось.
import * as THREE from 'three';
import { G } from '../../core/game.js';

const IDENT = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const NOCTL = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

let bodyMat = null, overlayMat = null;
export function materials() {
  if (!bodyMat) {
    bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    overlayMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
  }
  return { bodyMat, overlayMat };
}

// подготовка общих (на тип самолёта) данных скелета
export function prepareShape(shape) {
  shape.inv = shape.bones.map((b) => new THREE.Matrix4().makeTranslation(-b.pivot[0], -b.pivot[1], -b.pivot[2]));
  for (const b of shape.bones) {
    b.pivotV = new THREE.Vector3(b.pivot[0], b.pivot[1], b.pivot[2]);
    b.axisV = new THREE.Vector3(b.axis[0], b.axis[1], b.axis[2]).normalize();
    b.slideV = b.slide ? new THREE.Vector3(b.slide[0], b.slide[1], b.slide[2]) : null;
    if (b.gain == null) b.gain = 1;
  }
}

export function createInstance(shape, geo, ogeo, info) {
  const { bodyMat: bm, overlayMat: om } = materials();
  const model = new THREE.Group();
  const pose = new THREE.Group();
  model.add(pose);
  const bones = shape.bones.map((b) => ({ matrixWorld: new THREE.Matrix4().makeTranslation(b.pivot[0], b.pivot[1], b.pivot[2]) }));
  const skeleton = new THREE.Skeleton(bones, shape.inv);
  const mk = (g, m) => {
    const mesh = new THREE.SkinnedMesh(g, m);
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.bind(skeleton, IDENT);
    mesh.boundingSphere = shape.sphere;
    return mesh;
  };
  const body = mk(geo, bm);
  body.name = 'body';
  pose.add(body);
  let overlay = null;
  if (ogeo) {
    overlay = mk(ogeo, om);
    overlay.name = 'overlay';
    pose.add(overlay);
  }
  const rig = {
    shape, bones, skeleton, pose, body, overlay,
    last: new Float32Array(bones.length).fill(1e9),
    t: Math.random() * 10, propA: Math.random() * 6, propW: 0,
    sp: 0, sr: 0, sy: 0, poseK: -1, shiftA: 0,
    groundPitch: info.groundPitch || 0, pivotY: -info.gearHeight, pivotZ: info.mainZ || 0,
    fixedGear: !!info.fixedGear, jet: !!info.jet,
  };
  // служебные данные не должны мешать model.clone() (userData копируется через JSON)
  Object.defineProperty(model.userData, 'rig', { value: rig, enumerable: false, writable: true });
  if (rig.groundPitch) setPose(rig, 1);
  // исходное состояние: всё, что должно быть скрыто в покое (щитки, пламя, диски, лучи), скрываем сразу
  applyBones(rig, REST, 0, 0);
  return model;
}

// стояночная поза своими силами (ангар, «фальшивый» ac): поворот вокруг линии касания основных колёс на groundPitch·k
function setPose(rig, k) {
  if (Math.abs(k - rig.poseK) < 1e-4) return;
  rig.poseK = k;
  const a = rig.groundPitch * k, py = rig.pivotY, pz = rig.pivotZ;
  const s = Math.sin(a), c = Math.cos(a);
  rig.pose.rotation.x = a;
  rig.pose.position.set(0, py - (py * c - pz * s), pz - (py * s + pz * c));
}

// тангаж на земле задаёт физика (вращает вокруг ЦТ на высоте gearHeight) — сдвигаем модель так,
// чтобы основные колёса оставались на земле: стояночный угол хвостового колеса, подъём носа на разбеге
function setGroundShift(rig, th) {
  if (Math.abs(th - rig.shiftA) < 1e-4) return;
  rig.shiftA = th;
  rig.poseK = -1;
  const py = rig.pivotY, pz = rig.pivotZ, s = Math.sin(th), c = Math.cos(th);
  rig.pose.rotation.x = 0;
  rig.pose.position.set(0, py * c + pz * s - py, -py * s + pz * c - pz);
}

function nightFactor(model) {
  const u = model.userData.night;
  if (typeof u === 'number') return u;
  const w = G && G.world;
  if (!w) return 0;
  const e = w.env;
  if (e && typeof e.night === 'number') return typeof e.lightsOn === 'number' ? Math.max(e.night, e.lightsOn * 0.7) : e.night;
  // запасной вариант: по времени суток и высоте солнца
  let n = 0;
  if (typeof w.timeOfDay === 'number') { const h = w.timeOfDay; n = h < 5 || h > 21 ? 1 : h < 7 ? (7 - h) / 2 : h > 19 ? (h - 19) / 2 : 0; }
  if (w.sunDir && w.sunDir.y < 0.1) n = Math.max(n, Math.min(1, (0.1 - w.sunDir.y) / 0.25));
  return n;
}

// состояние «покоя» для сборки и ангара
const REST = { gear: 1, flaps: 0, pitch: 0, roll: 0, yaw: 0, thr: 0, brake: 0, blur: 0, alive: 1, night: 0, boost: 1, land: 0, t: 0.5, propA: 0, ab: 0, chute: 0 };
const ST = { ...REST };

function applyBones(rig, st, dt, force) {
  const defs = rig.shape.bones, bones = rig.bones, last = rig.last;
  for (let i = 1; i < defs.length; i++) {
    const d = defs[i];
    let key = 0, ang = 0, sx = 1, sy = 1, sz = 1, sl = 0;
    switch (d.ch) {
      case 'gear': {
        key = st.gear;
        let u = (1 - st.gear - d.t0) / (d.t1 - d.t0);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        u = u * u * (3 - 2 * u);
        ang = d.max * u;
        if (d.hide && st.gear < 0.03) sx = sy = sz = 0;
        break;
      }
      case 'flap': key = st.flaps; ang = d.max * st.flaps; sl = st.flaps; break;
      case 'elev': key = st.pitch; ang = -d.max * st.pitch; break;
      case 'ail': key = st.roll; ang = -d.max * st.roll; break;
      case 'rud': key = st.yaw; ang = d.max * st.yaw; break;
      case 'brake': key = st.brake; ang = d.max * st.brake; sl = st.brake; if (d.hide && st.brake < 0.02) sx = sy = sz = 0; break;
      case 'spoil': {
        // интерцепторы: тормоз + помощь по крену (поднимается на опускающемся крыле)
        const v = Math.min(1, st.brake + Math.max(0, -st.roll * (d.mirrored ? -1 : 1)) * 0.6);
        key = v; ang = d.max * v; if (v < 0.02) sx = sy = sz = 0;
        break;
      }
      case 'chute': {
        const v = st.chute;
        if (v < 0.02) { key = 0; sx = sy = sz = 0; } else { key = st.t; sx = sy = v * (0.94 + 0.06 * Math.sin(st.t * 9)); sz = 0.25 + 0.75 * v; ang = 0.035 * Math.sin(st.t * 3.1); }
        break;
      }
      case 'prop': key = st.propA + st.blur * 1000; ang = st.propA; if (st.blur > 0.5) sx = sy = sz = 0; break;
      case 'disc': key = st.blur; if (st.blur < 0.5) sx = sy = sz = 0; break;
      case 'glow': {
        const v = st.alive ? st.thr : 0;
        key = v;
        sx = sy = v < 0.02 ? 0 : 0.45 + 0.55 * v;
        break;
      }
      case 'flame': {
        const v = st.ab;
        if (v <= 0) { key = 0; sx = sy = sz = 0; } else { key = st.t; sx = sy = 0.9 + 0.1 * v; sz = v * (0.85 + 0.15 * Math.sin(st.t * 47 + i)); }
        break;
      }
      case 'nav': key = st.alive * (st.night + st.boost * 3); sx = sy = sz = st.alive ? (0.14 + 0.86 * st.night) * st.boost : 0; break;
      case 'beacon': {
        const ph = st.t * 1.05 + (d.phase || 0);
        const on = st.alive && ph - Math.floor(ph) < 0.16 ? 1 : 0;
        key = on * (1 + st.night + st.boost * 3);
        sx = sy = sz = on ? (0.3 + 1.0 * st.night) * st.boost : 0;
        break;
      }
      case 'strobe': {
        const ph = st.t * 0.9 + (d.phase || 0), f = ph - Math.floor(ph);
        const on = st.alive && st.night > 0.02 && (f < 0.05 || (f > 0.12 && f < 0.17)) ? 1 : 0;
        key = on * (1 + st.night + st.boost * 3);
        sx = sy = sz = on ? (0.5 + 0.9 * st.night) * st.boost : 0;
        break;
      }
      case 'land': key = st.land * (1 + st.night + st.boost * 3); sx = sy = sz = st.land ? (0.18 + 0.92 * st.night) * (1 + (st.boost - 1) * 0.6) : 0; break;
      case 'beam': { const v = st.land * st.night; key = v; sx = sy = sz = v > 0.2 ? 1 : 0; break; }
      default: continue;
    }
    if (!force && Math.abs(key - last[i]) < 1e-5) continue;
    last[i] = key;
    _q.setFromAxisAngle(d.axisV, ang * d.gain);
    _p.copy(d.pivotV);
    if (sl && d.slideV) _p.addScaledVector(d.slideV, sl);
    _s.set(sx, sy, sz);
    bones[i].matrixWorld.compose(_p, _q, _s);
  }
}

export function animate(model, ac, dt) {
  const rig = model.userData.rig;
  if (!rig || !ac) return;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  const c = ac.controls || NOCTL, spec = ac.spec;
  const st = ST;
  rig.t += dt;
  st.t = rig.t;
  st.alive = ac.alive === false ? 0 : 1;
  st.gear = rig.fixedGear ? 1 : ac.gearPos == null ? 1 : ac.gearPos;
  st.flaps = ac.flapsPos || 0;
  st.brake = ac.airbrake || 0;
  const k = 1 - Math.exp(-12 * dt);
  rig.sp += ((c.pitch || 0) - rig.sp) * k;
  rig.sr += ((c.roll || 0) - rig.sr) * k;
  rig.sy += ((c.yaw || 0) - rig.sy) * k;
  st.pitch = Math.abs(rig.sp) < 0.004 ? 0 : rig.sp;
  st.roll = Math.abs(rig.sr) < 0.004 ? 0 : rig.sr;
  st.yaw = Math.abs(rig.sy) < 0.004 ? 0 : rig.sy;
  const engOn = st.alive && ac.engineOn !== false;
  const thr = engOn ? Math.min(1, Math.max(0, ac.throttle || 0)) : 0;
  st.thr = rig.jet ? (engOn ? 0.12 + 0.88 * thr : 0) : thr;
  st.ab = !engOn ? 0 : typeof ac.afterburner === 'number' ? ac.afterburner : thr > 0.9 ? (thr - 0.9) / 0.1 : 0;
  st.chute = st.alive && ac.chute > 0 ? Math.min(1, ac.chute) : 0;
  // винт: скорость вращения тянется к цели; на больших оборотах лопасти сменяет диск
  const wT = engOn ? 9 + 60 * thr : st.alive ? Math.min(6, (ac.ias || 0) * 0.08) : 0;
  rig.propW += (wT - rig.propW) * (1 - Math.exp(-1.6 * dt));
  rig.propA = (rig.propA + rig.propW * dt) % (Math.PI * 2);
  st.propA = rig.propA;
  st.blur = rig.propW > 24 ? 1 : 0;
  // огни
  const night = nightFactor(model);
  st.night = night;
  let boost = 1;
  const cam = G && G.camera;
  if (cam && night > 0.05) {
    const p = model.position, q = cam.position;
    const dist = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    boost = 1 + night * Math.min(dist / 220, 14);
  }
  st.boost = boost;
  st.land = !st.alive ? 0 : rig.fixedGear ? (ac.onGround || (ac.flapsPos || 0) > 0.05 || (ac.agl != null && ac.agl < 120) ? 1 : 0) : (st.gear > 0.92 ? 1 : 0);
  applyBones(rig, st, dt, 0);
  // положение на земле
  const realEntity = typeof ac.pitch === 'number' && ac.quat && typeof ac.onGround === 'boolean';
  if (realEntity && (!rig.groundPitch || (spec && spec.groundPitch > 0))) {
    // тангаж ведёт физика: держим основные колёса на земле
    let th = 0;
    if (ac.onGround && !ac.onWater && st.alive && st.gear > 0.5) { th = ac.pitch - (ac._slopePitch || 0); th = th < -0.12 ? -0.12 : th > 0.5 ? 0.5 : th; }
    const cur = rig.shiftA;
    setGroundShift(rig, Math.abs(th - cur) < 0.002 ? th : cur + (th - cur) * (1 - Math.exp(-14 * dt)));
  } else if (rig.groundPitch) {
    // запасной вариант (физика без стояночного угла, ангар): хвост опущен на стоянке и поднимается с разбегом
    let target = 1;
    if (ac.onGround === false) target = 0;
    else if (ac.onGround && spec) {
      const v = (ac.ias || 0) / (spec.vStall || 30);
      target = v < 0.3 ? 1 : v > 0.62 ? 0 : 1 - (v - 0.3) / 0.32;
    }
    const cur = rig.poseK < 0 ? target : rig.poseK;
    setPose(rig, cur + (target - cur) * (1 - Math.exp(-5 * dt)));
  }
}
