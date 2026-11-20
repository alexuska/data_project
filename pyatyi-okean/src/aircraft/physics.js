// Лётная модель. Чистая математика на three.js-векторах, без DOM — запускается в node-тестах.
// Контракт сущности самолёта (ac) описан в ARCHITECTURE.md. Оси модели: нос −Z, правое крыло +X, верх +Y.
// Угловые скорости в связанных осях: angVel.x — тангаж (нос вверх +), .y — рыскание (нос влево +), .z — крен (левый +).
import { Vector3, Quaternion, Euler } from 'three';
import { getSpec } from './catalog.js';
import { clamp, damp, approach, wrapTau, G0 } from '../core/util.js';

export const RHO0 = 1.225;
export const airDensity = (alt) => RHO0 * Math.exp(-Math.max(alt, 0) / 8500);

const _f = new Vector3(), _u = new Vector3(), _r = new Vector3();
const _va = new Vector3(), _vaHat = new Vector3(), _lift = new Vector3(), _force = new Vector3();
const _dq = new Quaternion(), _e = new Euler(0, 0, 0, 'YXZ'), _axis = new Vector3();

let nextId = 1;

// Вывод аэродинамики из паспортных данных
export function deriveAero(spec) {
  const S = spec.wingArea, m = spec.mass;
  const clMax = (2 * m * G0) / (RHO0 * S * spec.vStall * spec.vStall);
  const AR = (spec.span * spec.span) / S;
  const clAlpha = Math.min(5.5, (2 * Math.PI * AR) / (2 + Math.sqrt(4 + AR * AR)) * 1.05);
  const cl0 = 0.12;
  const alphaStall = (clMax - cl0) / clAlpha;
  const k = 1 / (Math.PI * AR * 0.75);
  const thrustAtVmax = thrustAt(spec, 1, spec.vMax, RHO0);
  const qMax = 0.5 * RHO0 * spec.vMax * spec.vMax;
  const clAtVmax = (m * G0) / (qMax * S);
  const cd0 = Math.max(0.012, thrustAtVmax / (qMax * S) - k * clAtVmax * clAtVmax);
  return { clMax, clAlpha, cl0, alphaStall, k, cd0, AR };
}

export function thrustAt(spec, throttle, V, rho) {
  const dens = rho / RHO0;
  if (spec.engine === 'jet') return spec.thrust * throttle * Math.pow(dens, 0.7);
  // винт: тяга падает со скоростью
  return spec.thrust * throttle * dens * clamp(1 - 0.62 * (V / spec.vMax), 0.1, 1);
}

export function createAircraft(specId, opts = {}) {
  const spec = getSpec(specId);
  const ac = {
    id: nextId++,
    specId: spec.id,
    spec,
    aero: deriveAero(spec),
    team: opts.team || 'neutral',
    isPlayer: !!opts.isPlayer,
    pos: new Vector3(),
    vel: new Vector3(),
    quat: new Quaternion(),
    angVel: new Vector3(),
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, airbrake: 0 },
    throttle: 0,
    gearDown: true, gearPos: 1,
    flaps: 0, flapsPos: 0,
    airbrake: 0,
    engineOn: true,
    fuel: spec.fuel, fuelMax: spec.fuel,
    mass: spec.mass,
    hp: 100, alive: true, crashed: false,
    onGround: false, onWater: false, stalled: false,
    // производные (обновляются каждый шаг)
    ias: 0, tas: 0, alt: 0, agl: 0, vs: 0, heading: 0, pitch: 0, bank: 0, aoa: 0, slip: 0, g: 1, mach: 0,
    surface: 'air', airport: null,
    model: null,
    weapons: null, ai: null, mods: { thrust: 1, drag: 1, agility: 1 },
    time: 0,
  };
  return ac;
}

// Поставить самолёт: на землю (speed = 0) или в воздух
export function placeAircraft(ac, { x, y, z, heading = 0, speed = 0, onGround = false }) {
  ac.pos.set(x, y, z);
  _e.set(0, -heading, 0);
  ac.quat.setFromEuler(_e);
  ac.vel.set(Math.sin(heading) * speed, 0, -Math.cos(heading) * speed);
  ac.angVel.set(0, 0, 0);
  ac.onGround = onGround;
  ac.gearDown = onGround || !ac.spec.retract;
  ac.gearPos = ac.gearDown ? 1 : 0;
  ac.throttle = ac.controls.throttle = onGround ? 0 : 0.7;
  ac.flaps = ac.flapsPos = 0;
  ac.heading = wrapTau(heading);
}

// Один шаг. env: { world, bus }. world.groundAt(x,z) -> {y, surface, airport?}, world.wind (Vector3)
export function stepAircraft(ac, env, dt) {
  if (!ac.alive) return;
  const spec = ac.spec, aero = ac.aero, c = ac.controls, world = env.world;
  ac.time += dt;

  // исполнительные механизмы
  const spool = spec.engine === 'jet' ? 0.9 : 2.2;
  const thrTarget = ac.engineOn && ac.fuel > 0 ? clamp(c.throttle, 0, 1) : 0;
  ac.throttle = damp(ac.throttle, thrTarget, spool, dt);
  if (!spec.retract) ac.gearDown = true;
  ac.gearPos = approach(ac.gearPos, ac.gearDown ? 1 : 0, dt / 2.5);
  ac.flapsPos = approach(ac.flapsPos, spec.flaps ? ac.flaps : 0, dt / 3);
  ac.airbrake = approach(ac.airbrake, c.airbrake || 0, dt * 2);

  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  _u.set(0, 1, 0).applyQuaternion(ac.quat);
  _r.set(1, 0, 0).applyQuaternion(ac.quat);

  const wind = world.wind;
  _va.copy(ac.vel);
  if (wind && !ac.onGround) _va.sub(wind);
  const V = _va.length();
  const rho = airDensity(ac.pos.y);
  const qbar = 0.5 * rho * V * V;
  const S = spec.wingArea, m = ac.mass;

  let alpha = 0, beta = 0;
  if (V > 1) {
    _vaHat.copy(_va).multiplyScalar(1 / V);
    alpha = Math.atan2(-_va.dot(_u), _va.dot(_f));
    beta = Math.asin(clamp(_va.dot(_r) / V, -1, 1));
  } else {
    _vaHat.copy(_f);
  }

  // коэффициенты
  const fl = ac.flapsPos;
  const clMax = aero.clMax * (1 + 0.5 * fl);
  const cl0 = aero.cl0 + 0.35 * fl;
  const aStall = (clMax - cl0) / aero.clAlpha;
  let cl = cl0 + aero.clAlpha * alpha;
  let stalled = false;
  if (alpha > aStall) {
    cl = clMax * Math.max(0.45, 1 - (alpha - aStall) * 2.2);
    stalled = !ac.onGround;
  } else if (alpha < -aStall) {
    cl = -clMax * 0.8 * Math.max(0.45, 1 - (-alpha - aStall) * 2.2);
    stalled = !ac.onGround;
  }
  if (stalled && !ac.stalled && env.bus) env.bus.emit('ac:stall', { ac });
  ac.stalled = stalled;
  let cd = aero.cd0 * ac.mods.drag + aero.k * cl * cl + ac.gearPos * 0.018 + fl * 0.04 + ac.airbrake * 0.06;
  if (stalled) cd += 0.25 * Math.sin(Math.abs(alpha)) ** 2 + 0.05;

  const L = qbar * S * cl;
  const D = qbar * S * cd;
  const Y = -qbar * S * 1.4 * beta;
  const T = thrustAt(spec, ac.throttle, V, rho) * ac.mods.thrust;

  _lift.crossVectors(_r, _vaHat).normalize();
  _force.set(0, -m * G0, 0);
  _force.addScaledVector(_lift, L).addScaledVector(_vaHat, -D).addScaledVector(_r, Y).addScaledVector(_f, T);

  // перегрузка (для приборов)
  ac.g = L / (m * G0);

  // топливо
  if (ac.isPlayer && ac.engineOn) ac.fuel = Math.max(0, ac.fuel - spec.burn * (0.15 + 0.85 * ac.throttle) * dt);

  // вращение: управление задаёт угловые скорости + устойчивость
  const eff = clamp(V / (1.25 * spec.vStall), 0, 1);
  const eff2 = eff * eff;
  const agility = ac.mods.agility;
  // ограничение по перегрузке
  const gAvail = Math.max(0.5, Math.min(spec.maxG, (qbar * S * clMax) / (m * G0)));
  const pitchLimit = V > 5 ? ((gAvail - 0.2) * G0) / V : spec.pitchRate;
  let wPitch = clamp(c.pitch, -1, 1) * Math.min(spec.pitchRate * agility, pitchLimit) * eff2;
  let wRoll = -clamp(c.roll, -1, 1) * spec.rollRate * agility * eff2;
  let wYaw = -clamp(c.yaw, -1, 1) * 0.35 * eff2;
  if (!ac.onGround && V > 5) {
    // автотриммирование: угол атаки для горизонтального полёта
    const clNeed = clamp((m * G0 * Math.max(0.2, _u.y)) / Math.max(qbar * S, 1), -clMax, clMax * 0.95);
    const aTrim = (clNeed - cl0) / aero.clAlpha;
    wPitch += -2.2 * (alpha - aTrim) * eff2 * (1 - 0.6 * Math.abs(c.pitch));
    wYaw += -2.5 * beta * eff2; // флюгерная устойчивость: нос к потоку
    wRoll += 0.25 * beta * eff2; // лёгкий поперечный момент
    if (stalled) {
      wPitch -= 0.5;
      wRoll += Math.sin(ac.time * 3.1 + ac.id) * 0.6;
    }
  }
  const rate = ac.onGround ? 6 : 5;
  ac.angVel.x = damp(ac.angVel.x, wPitch, rate, dt);
  ac.angVel.y = damp(ac.angVel.y, wYaw, rate, dt);
  ac.angVel.z = damp(ac.angVel.z, wRoll, rate, dt);

  const wLen = ac.angVel.length();
  if (wLen > 1e-6) {
    _axis.copy(ac.angVel).multiplyScalar(1 / wLen);
    _dq.setFromAxisAngle(_axis, wLen * dt);
    ac.quat.multiply(_dq).normalize();
  }

  // интегрирование
  ac.vel.addScaledVector(_force, dt / m);
  ac.pos.addScaledVector(ac.vel, dt);

  // земля / вода
  const gnd = world.groundAt(ac.pos.x, ac.pos.z);
  const gearH = spec.gearHeight * (0.45 + 0.55 * ac.gearPos);
  const h = ac.pos.y - gearH - gnd.y;
  ac.agl = Math.max(0, h);
  ac.surface = h > 0.3 ? 'air' : gnd.surface;
  ac.airport = gnd.airport || null;

  if (h <= 0) {
    const wasAir = !ac.onGround;
    const water = gnd.surface === 'water';
    if (wasAir) {
      const vsTouch = ac.vel.y;
      const gs = Math.hypot(ac.vel.x, ac.vel.z);
      _e.setFromQuaternion(ac.quat, 'YXZ');
      const bankAbs = Math.abs(_e.z), pitchNow = _e.x;
      let crash = null;
      if (water && !spec.amphibian) crash = 'water';
      else if (vsTouch < -7.5) crash = 'hard';
      else if (bankAbs > 0.4) crash = 'wing';
      else if (pitchNow < -0.16) crash = 'nose';
      else if (ac.gearPos < 0.5 && !water) crash = gs > 25 ? 'gearup' : null;
      else if (gnd.surface === 'ground' && gs > spec.vStall * 1.6) crash = 'terrain';
      if (crash) {
        crashAircraft(ac, env, crash);
        ac.pos.y = gnd.y + gearH;
        return;
      }
      ac.onGround = true;
      ac.onWater = water;
      if (env.bus) env.bus.emit('ac:touchdown', { ac, vs: vsTouch, speed: gs, surface: gnd.surface, airport: gnd.airport || null, runway: gnd.runway || null, across: gnd.across ?? null, along: gnd.along ?? null });
    }
    ac.pos.y = gnd.y + gearH;
    if (ac.vel.y < 0) ac.vel.y = 0;

    // трение
    const gs = Math.hypot(ac.vel.x, ac.vel.z);
    const weightOnWheels = clamp(1 - L / (m * G0), 0, 1);
    let mu = water ? 0.12 + gs * 0.004 : gnd.surface === 'runway' || gnd.surface === 'carrier' || gnd.surface === 'apron' ? 0.025 : 0.07;
    mu += clamp(c.brake || 0, 0, 1) * (water ? 0.1 : 0.45);
    if (ac.gearPos < 0.5 && !water) mu = 0.6;
    const fx = Math.sin(_headingOf(ac)), fz = -Math.cos(_headingOf(ac));
    let vF = ac.vel.x * fx + ac.vel.z * fz;
    let vS = ac.vel.x * -fz + ac.vel.z * fx;
    const dec = mu * G0 * weightOnWheels * dt;
    vF = Math.abs(vF) <= dec ? 0 : vF - Math.sign(vF) * dec;
    vS *= Math.exp(-(water ? 3 : 9) * weightOnWheels * dt);
    ac.vel.x = fx * vF - fz * vS;
    ac.vel.z = fz * vF + fx * vS;

    // положение на земле: крен -> 0, тангаж не ниже стояночного, руление
    _e.setFromQuaternion(ac.quat, 'YXZ');
    _e.z = damp(_e.z, 0, 10, dt);
    const canRotate = V > spec.vStall * 0.75;
    const minPitch = 0, maxPitch = canRotate ? 0.26 : 0;
    if (_e.x < minPitch) _e.x = damp(_e.x, minPitch, 12, dt);
    if (_e.x > maxPitch) _e.x = damp(_e.x, maxPitch, 6, dt);
    const steer = clamp(c.yaw + c.roll * 0.6, -1, 1);
    const steerRate = steer * clamp(gs / 6, 0, 1) * 0.55 / (1 + gs / 35);
    _e.y -= steerRate * dt;
    ac.quat.setFromEuler(_e);
    ac.angVel.y = 0;
    ac.angVel.z = 0;
    if (!canRotate) ac.angVel.x = Math.min(ac.angVel.x, 0);
  } else if (ac.onGround && h > 0.4) {
    ac.onGround = false;
    ac.onWater = false;
    if (env.bus) env.bus.emit('ac:takeoff', { ac });
  }

  // производные величины
  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  _u.set(0, 1, 0).applyQuaternion(ac.quat);
  _r.set(1, 0, 0).applyQuaternion(ac.quat);
  ac.tas = V;
  ac.ias = V * Math.sqrt(rho / RHO0);
  ac.alt = ac.pos.y;
  ac.vs = ac.vel.y;
  ac.heading = wrapTau(Math.atan2(_f.x, -_f.z));
  ac.pitch = Math.asin(clamp(_f.y, -1, 1));
  ac.bank = Math.atan2(-_r.y, _u.y);
  ac.aoa = alpha;
  ac.slip = beta;
  ac.mach = V / 340;
}

function _headingOf(ac) {
  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  return Math.atan2(_f.x, -_f.z);
}

export function crashAircraft(ac, env, reason) {
  if (!ac.alive) return;
  ac.alive = false;
  ac.crashed = true;
  ac.hp = 0;
  ac.vel.set(0, 0, 0);
  if (env.bus) env.bus.emit('ac:crash', { ac, reason });
}
