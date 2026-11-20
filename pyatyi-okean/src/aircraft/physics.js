// Лётная модель «золотая середина». Чистая математика на three.js-векторах, без DOM — запускается в node-тестах.
// Контракт сущности самолёта (ac) описан в ARCHITECTURE.md. Оси модели: нос −Z, правое крыло +X, верх +Y.
// Угловые скорости в связанных осях: angVel.x — тангаж (нос вверх +), .y — рыскание (нос влево +), .z — крен (левый +).
//
// Устройство модели:
//  • Силы — честные: подъёмная (Cy по углу атаки, срыв, закрылки, экранный эффект), сопротивление (Cx0 + индуктивное +
//    волновой кризис + шасси/закрылки/щитки/повреждения), боковая сила, тяга (винт / ТРД / форсаж, высотность), вес.
//    Cx0 выводится из паспортной максимальной скорости, Cy max — из скорости сваливания (deriveAero).
//  • Вращение — «скоростное»: ручка задаёт угол атаки (а через него перегрузку), нос сам идёт за вектором скорости,
//    поэтому раскачки и расходящейся фугоиды нет. Ручка по крену задаёт угловую скорость крена.
//  • Помощь пилоту (assist): удержание траектории при отпущенной ручке (автотриммер), ограничитель угла атаки
//    («упирается», а не срывается), координация разворота, мягкие ограничения крена/тангажа у лайнеров.
//    Без помощи: классическая балансировка по скорости (газ — высота, ручка — скорость), срыв с валёжкой, штопор при грубой ошибке.
//  • Земля/вода/палуба: разбег, подъём носа, трение и торможение, реверс и тормозной парашют, боковой ветер,
//    грунт, глиссирование амфибии, аэрофинишёр и катапульта, оценка касания и аварии.
//
// Расширения ac сверх контракта (все — только для чтения, кроме assist/payload):
//  assist (bool|undefined — помощь; undefined = да), payload (кг дополнительного груза/воды),
//  stallWarn 0..1, overspeed 0..1, overG 0..1, buffet 0..1 (общая «тряска» для камеры/звука), afterburner 0..1,
//  spin (−1|0|1), planing 0..1 (глиссирование), chute 0..1, reverse 0..1, arrested, catapult, gs (путевая скорость),
//  airTime / groundTime (с), bounces, fuelOut, lastTouchdown (данные последнего касания), ctl (служебное для автопилота).
// События: ac:touchdown (каждое касание; bounce = 0 у первого касания посадки), ac:takeoff, ac:stall, ac:crash,
//  ac:damage {ac, amount, source: 'landing'|'overstress'|'terrain'|'gearup'}, ac:stopped (остановился после посадки),
//  ac:engine {ac, on, reason: 'fuel'}, ac:arrest, ac:catapult.
import { Vector3, Quaternion, Euler } from 'three';
import { getSpec } from './catalog.js';
import { clamp, damp, approach, wrapTau, smoothstep, G0 } from '../core/util.js';

export const RHO0 = 1.225;
export const A0 = 340.3;
// Стандартная атмосфера
export function airDensity(alt) {
  const h = alt > 0 ? alt : 0;
  if (h < 11000) return RHO0 * Math.pow(1 - h / 44330.8, 4.2559);
  return 0.3639 * Math.exp(-(h - 11000) / 6341.6);
}
export function soundSpeed(alt) {
  const h = alt < 0 ? 0 : alt > 11000 ? 11000 : alt;
  return A0 * Math.sqrt(1 - h / 44330.8);
}

export const AB_ZONE = 0.9; // РУД выше — форсаж (у самолётов с afterburner)
const AB_BURN = 2.4; // прибавка расхода на полном форсаже (в долях burn)
const CY_BETA = 0.9;

const _f = new Vector3(), _u = new Vector3(), _r = new Vector3();
const _va = new Vector3(), _vaHat = new Vector3(), _lift = new Vector3(), _force = new Vector3();
const _dq = new Quaternion(), _e = new Euler(0, 0, 0, 'YXZ'), _axis = new Vector3();
const _slope = { hx: 0, hz: 0 };

let nextId = 1;

// прирост Cx0 от сжимаемости: (1 + waveRise) — множитель
function waveRise(spec, M) {
  const x = M - spec.mCrit;
  if (x <= 0) return 0;
  if (spec.supersonic) {
    const t = x >= 0.25 ? 1 : x / 0.25;
    return t * t * (3 - 2 * t);
  }
  return 40 * x * x;
}

// Тяга, Н. throttle 0..1 (у форсажных 0.9..1 — форсаж). a — скорость звука.
export function thrustAt(spec, throttle, V, rho, a = A0) {
  const sigma = rho / RHO0;
  if (spec.engine === 'jet') {
    const M = V / a;
    const kq = spec.afterburner ? 0.3 : 0.4 * spec.thrustLapse;
    const speedF = Math.max(0.3, 1 - spec.thrustLapse * M + kq * M * M);
    let t0;
    if (spec.afterburner) {
      const dry = throttle >= AB_ZONE ? 1 : throttle / AB_ZONE;
      const ab = throttle > AB_ZONE ? (throttle - AB_ZONE) / (1 - AB_ZONE) : 0;
      t0 = spec.thrustDry * dry + (spec.thrust - spec.thrustDry) * ab;
    } else t0 = spec.thrust * throttle;
    return t0 * Math.pow(sigma, 0.72) * speedF;
  }
  // винт: на месте — статическая тяга, на скорости — располагаемая мощность / скорость
  const pf = spec.engine === 'piston' ? Math.pow(sigma, 0.95) : Math.pow(sigma, 0.75);
  const vc = (spec.power * spec.propEff) / spec.thrust;
  const x = V / vc;
  return (spec.thrust * throttle * pf) / Math.sqrt(1 + x * x);
}

// Расход топлива, кг/с
export function fuelFlow(spec, throttle) {
  if (spec.afterburner) {
    const dry = throttle >= AB_ZONE ? 1 : throttle / AB_ZONE;
    const ab = throttle > AB_ZONE ? (throttle - AB_ZONE) / (1 - AB_ZONE) : 0;
    return spec.burn * (0.08 + 0.92 * dry + AB_BURN * ab);
  }
  return spec.burn * (0.08 + 0.92 * throttle);
}

// Вывод аэродинамики и «характера» из паспортных данных
export function deriveAero(spec) {
  const S = spec.wingArea, W = spec.mass * G0;
  const clMax = (2 * W) / (RHO0 * S * spec.vStall * spec.vStall);
  const AR = (spec.span * spec.span) / S;
  const cl0 = spec.cl0 ?? (spec.supersonic ? 0.04 : 0.1);
  let clAlpha = Math.min(5.6, (2 * Math.PI * AR) / (2 + Math.sqrt(4 + AR * AR)));
  // критический угол атаки держим в разумных пределах (предкрылки и т.п. — через наклон кривой)
  clAlpha = clamp(clAlpha, (clMax - cl0) / 0.33, (clMax - cl0) / 0.2);
  const alphaStall = (clMax - cl0) / clAlpha;
  const k = 1 / (Math.PI * AR * (AR < 3 ? 0.72 : 0.8));
  const qMax = 0.5 * RHO0 * spec.vMax * spec.vMax;
  const tMax = thrustAt(spec, 1, spec.vMax, RHO0);
  const clV = W / (qMax * S);
  const cd0 = Math.max(0.011, (tMax / (qMax * S) - k * clV * clV) / (1 + waveRise(spec, spec.vMax / A0)));
  const flapLift = spec.flaps ? spec.flapLift : 0;
  // крейсерский режим и продолжительность полёта (для проверки расхода)
  const qC = 0.5 * RHO0 * spec.vCruise * spec.vCruise;
  const clC = W / (qC * S);
  const dC = qC * S * (cd0 * (1 + waveRise(spec, spec.vCruise / A0)) + k * clC * clC);
  const dryTop = spec.afterburner ? AB_ZONE : 1;
  const thrCruise = clamp((dC / thrustAt(spec, dryTop, spec.vCruise, RHO0)) * dryTop, 0.05, 1);
  const clBest = Math.sqrt(cd0 / k);
  const heavy = spec.mass > 30000;
  const carrier = spec.carrierCapable;
  const vsSoft = spec.vsLimit ?? (carrier ? 5 : heavy ? 3.2 : spec.cls === 'airliner' ? 3.4 : 4);
  return {
    clMax, clAlpha, cl0, alphaStall, k, cd0, AR,
    flapLift, flapCl0: 0.6 * flapLift * clMax, flapDrag: spec.flaps ? 0.03 + 0.05 * flapLift : 0,
    gearCd: spec.retract ? spec.gearCd ?? 0.018 : 0,
    airbrakeCd: spec.airbrake ? spec.airbrakeCd ?? 0.05 : 0,
    bellyH: spec.bellyHeight ?? spec.gearHeight * 0.45,
    bankCrash: clamp(Math.atan2(spec.gearHeight, spec.span / 2) * 2.2, 0.3, 0.6),
    vsSoft, vsCrash: vsSoft * 2.35,
    rotMax: spec.rotAngle ?? clamp(alphaStall * 0.78 + 0.02, 0.15, 0.24),
    kAlpha: clamp(2 + 2 * spec.pitchRate, 2.4, 5),
    lagP: clamp(3 + 3.5 * spec.pitchRate, 3.6, 8),
    lagR: clamp(3 + 2.2 * spec.rollRate, 3.6, 10),
    gustF: clamp(160 / (spec.mass / S), 0.3, 1.6),
    thrCruise, endurance: spec.fuel / fuelFlow(spec, thrCruise) / 60,
    ldMax: 1 / (2 * Math.sqrt(cd0 * k)),
    vGlide: Math.sqrt((2 * W) / (RHO0 * S * clBest)),
  };
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
    ias: 0, tas: 0, alt: 0, agl: 0, vs: 0, heading: 0, pitch: 0, bank: 0, aoa: 0, slip: 0, g: 1, mach: 0, gs: 0,
    surface: 'air', airport: null,
    model: null,
    weapons: null, ai: null, mods: { thrust: 1, drag: 1, agility: 1 },
    time: 0,
    // расширения
    assist: opts.assist,
    payload: 0,
    stallWarn: 0, overspeed: 0, overG: 0, buffet: 0, afterburner: 0,
    spin: 0, planing: 0, chute: 0, reverse: 0, arrested: false, catapult: false,
    airTime: 0, groundTime: 0, bounces: 0, fuelOut: false, lastTouchdown: null,
    ctl: { nN: 1, nHi: 1, nLo: 1, rollMax: 0, bankLim: 0, vsCfg: spec.vStall, assist: true },
    // внутреннее состояние
    _trimQ: 0, _stallT: 0, _stallDir: 0, _spinT: 0, _flying: false, _landing: false, _rollout: 0,
    _arrestA: 0, _dmgAcc: 0, _slopePitch: 0,
  };
  return ac;
}

// Поставить самолёт: на землю (speed = 0) или в воздух
export function placeAircraft(ac, { x, y, z, heading = 0, speed = 0, onGround = false }) {
  const spec = ac.spec;
  ac.pos.set(x, y, z);
  // в воздухе — сразу с балансировочным углом атаки, чтобы не было «просадки» на первой секунде
  const q0 = 0.5 * airDensity(y) * speed * speed * spec.wingArea;
  const aTrim = onGround || speed < 1 ? 0 : clamp((spec.mass * G0 / q0 - ac.aero.cl0) / ac.aero.clAlpha, -0.05, ac.aero.alphaStall * 0.85);
  _e.set(onGround ? spec.groundPitch : aTrim, -heading, 0);
  ac.quat.setFromEuler(_e);
  ac.vel.set(Math.sin(heading) * speed, 0, -Math.cos(heading) * speed);
  ac.angVel.set(0, 0, 0);
  ac.onGround = onGround;
  ac.onWater = false;
  ac.gearDown = onGround || !spec.retract;
  ac.gearPos = ac.gearDown ? 1 : 0;
  ac.throttle = ac.controls.throttle = onGround ? 0 : ac.aero.thrCruise;
  ac.flaps = ac.flapsPos = 0;
  ac.heading = wrapTau(heading);
  ac.pitch = onGround ? spec.groundPitch : aTrim;
  ac.bank = 0;
  ac.tas = ac.ias = ac.gs = speed;
  ac.alt = y;
  ac.agl = onGround ? 0 : 500;
  ac.stalled = false;
  ac.spin = 0;
  ac._stallT = 0;
  ac._trimQ = 0;
  ac._flying = !onGround;
  ac._landing = false;
  ac.airTime = onGround ? 0 : 10;
  ac.groundTime = onGround ? 10 : 0;
  ac.arrested = false;
  ac.catapult = false;
  ac.bounces = 0;
}

function assistFor(ac, env) {
  if (ac.assist != null) return !!ac.assist;
  if (!ac.isPlayer) return true;
  if (env.assist != null) return !!env.assist;
  const g = globalThis.__G; // запасной вариант, пока ядро не передаёт настройку
  const s = g && g.profile && g.profile.settings;
  return s ? s.assist !== false : true;
}

function heightOf(world, x, z) {
  return world.heightAt ? world.heightAt(x, z) : world.groundAt(x, z).y;
}
function terrainSlope(world, x, z) {
  const d = 5;
  _slope.hx = (heightOf(world, x + d, z) - heightOf(world, x - d, z)) / (2 * d);
  _slope.hz = (heightOf(world, x, z + d) - heightOf(world, x, z - d)) / (2 * d);
  return _slope;
}

export function damageAircraft(ac, env, amount, source) {
  if (!ac.alive || !(amount > 0)) return;
  ac.hp = Math.max(0, ac.hp - amount);
  if (env.bus) env.bus.emit('ac:damage', { ac, amount, source });
}

// Один шаг. env: { world, bus, assist? }. world.groundAt(x,z) -> {y, surface, airport?, runway?, along?, across?}, world.wind (Vector3)
export function stepAircraft(ac, env, dt) {
  if (!ac.alive) return;
  const spec = ac.spec, aero = ac.aero, c = ac.controls, world = env.world, bus = env.bus, ctl = ac.ctl;
  ac.time += dt;
  const assist = assistFor(ac, env);
  const wasGround = ac.onGround;
  const m = (ac.mass = Math.max(spec.mass * 0.5, spec.mass + (ac.payload || 0) - 0.6 * (spec.fuel - ac.fuel)));
  const W = m * G0, S = spec.wingArea;
  const hpK = ac.hp >= 100 ? 0 : clamp(1 - ac.hp / 100, 0, 1); // 0 — цел, 1 — разбит
  const agility = ac.mods.agility * (1 - 0.5 * smoothstep(0.3, 0.9, hpK));

  // ---------- двигатель, топливо, механизация ----------
  const hasFuel = ac.fuel > 0;
  if (!hasFuel && !ac.fuelOut) {
    ac.fuelOut = true;
    if (bus) bus.emit('ac:engine', { ac, on: false, reason: 'fuel' });
  } else if (hasFuel && ac.fuelOut) ac.fuelOut = false;
  const running = ac.engineOn && hasFuel && ac.hp > 0;
  const thrTarget = running ? clamp(c.throttle, 0, 1) : 0;
  const spool = spec.engine === 'jet' ? (spec.mass > 30000 ? 0.7 : 1.0) : spec.engine === 'turboprop' ? 1.6 : 2.4;
  ac.throttle = damp(ac.throttle, thrTarget, thrTarget < ac.throttle ? spool * 1.6 : spool, dt);
  if (ac.throttle < 0.002 && thrTarget === 0) ac.throttle = 0;
  ac.afterburner = spec.afterburner && ac.throttle > AB_ZONE ? (ac.throttle - AB_ZONE) / (1 - AB_ZONE) : 0;
  if ((ac.isPlayer || ac.burnsFuel) && running) ac.fuel = Math.max(0, ac.fuel - fuelFlow(spec, ac.throttle) * dt);

  if (!spec.retract || (ac.onGround && !ac.onWater && ac.gearPos > 0.5)) ac.gearDown = true;
  ac.gearPos = approach(ac.gearPos, ac.gearDown ? 1 : 0, dt / (spec.mass > 30000 ? 4.5 : 2.5));
  ac.flapsPos = approach(ac.flapsPos, spec.flaps ? clamp(ac.flaps, 0, 1) : 0, dt / (spec.mass > 30000 ? 5 : 3));
  ac.airbrake = approach(ac.airbrake, spec.airbrake ? clamp(c.airbrake || 0, 0, 1) : 0, dt * 2.5);

  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  _u.set(0, 1, 0).applyQuaternion(ac.quat);
  _r.set(1, 0, 0).applyQuaternion(ac.quat);

  // ---------- воздушная скорость: ветер (слабее у земли), порывы ----------
  const wind = world.wind;
  const turb = world.weather ? world.weather.turbulence || 0 : 0;
  _va.copy(ac.vel);
  if (wind) _va.addScaledVector(wind, -(ac.agl < 250 ? 0.6 + 0.4 * (ac.agl / 250) : 1));
  let gRoll = 0, gPitch = 0;
  if (turb > 0) {
    const t = ac.time, p = ac.id * 1.7, A = turb * 4.5 * (ac.onGround ? 0.35 : 1);
    _va.x -= A * (0.6 * Math.sin(0.9 * t + p) + 0.4 * Math.sin(2.3 * t + 2 * p));
    _va.y -= A * (0.6 * Math.sin(1.3 * t + 3 * p) + 0.4 * Math.sin(3.1 * t + p));
    _va.z -= A * (0.6 * Math.sin(0.7 * t + 5 * p) + 0.4 * Math.sin(1.9 * t + 4 * p));
    if (!ac.onGround) {
      gRoll = turb * aero.gustF * 0.3 * (Math.sin(2.7 * t + p) + 0.6 * Math.sin(5.3 * t + 2 * p));
      gPitch = turb * aero.gustF * 0.07 * (Math.sin(2.1 * t + 4 * p) + 0.6 * Math.sin(4.7 * t + p));
    }
  }
  const V = _va.length();
  const rho = airDensity(ac.pos.y), aSnd = soundSpeed(ac.pos.y);
  const qbar = 0.5 * rho * V * V;
  const mach = V / aSnd;
  const ias = V * Math.sqrt(rho / RHO0);

  let alpha = 0, beta = 0;
  if (V > 1) {
    _vaHat.copy(_va).multiplyScalar(1 / V);
    alpha = Math.atan2(-_va.dot(_u), _va.dot(_f));
    beta = Math.asin(clamp(_va.dot(_r) / V, -1, 1));
  } else {
    _vaHat.copy(_f);
  }

  // ---------- коэффициенты ----------
  const fl = ac.flapsPos;
  const clMax = aero.clMax * (1 + aero.flapLift * fl);
  const cl0 = aero.cl0 + aero.flapCl0 * fl;
  const clA = aero.clAlpha;
  const aStall = (clMax - cl0) / clA;
  const clMin = -0.75 * aero.clMax;
  const aStallN = (clMin - cl0) / clA; // отрицательный критический угол
  // экранный эффект
  const hWing = (ac.agl + spec.gearHeight * 0.7) / spec.span;
  let ge = 1;
  if (hWing < 1) { const x = 16 * hWing; ge = (x * x) / (1 + x * x); }
  let cl, stallDepth = 0;
  if (alpha > aStall) {
    stallDepth = alpha - aStall;
    cl = clMax * Math.max(0.55, 1 - 1.7 * stallDepth);
    const w = smoothstep(aStall + 0.15, aStall + 0.55, alpha);
    if (w > 0) cl += (1.05 * Math.sin(2 * alpha) - cl) * w;
  } else if (alpha < aStallN) {
    stallDepth = aStallN - alpha;
    cl = clMin * Math.max(0.55, 1 - 1.7 * stallDepth);
    const w = smoothstep(-aStallN + 0.15, -aStallN + 0.55, -alpha);
    if (w > 0) cl += (1.05 * Math.sin(2 * alpha) - cl) * w;
  } else {
    cl = cl0 + clA * alpha;
    cl *= 1 + 0.08 * (1 - ge);
  }
  const airborne = !ac.onGround;
  const stalled = airborne && stallDepth > 0.012 && V > 4;
  if (stalled && !ac.stalled && bus) bus.emit('ac:stall', { ac });
  ac.stalled = stalled;
  const liftDump = ac.onGround && (c.brake || 0) > 0.1 ? 0.55 : 0.12 * ac.airbrake * (spec.mass > 12000 ? 1 : 0);
  cl *= 1 - liftDump;

  // предупреждения: сваливание, превышение скорости
  const aRatio = alpha >= 0 ? alpha / aStall : alpha / aStallN;
  ac.stallWarn = airborne && V > 4 ? clamp((aRatio - 0.74) / 0.22, 0, 1) : 0;
  const over = Math.max(ias / spec.vNe, mach / spec.mNe);
  ac.overspeed = clamp((over - 0.96) / 0.1, 0, 1);

  let cd = aero.cd0 * ac.mods.drag * (1 + waveRise(spec, mach)) + aero.k * (0.3 + 0.7 * ge) * cl * cl;
  cd += aero.gearCd * ac.gearPos + aero.flapDrag * fl * (0.35 + 0.65 * fl) + aero.airbrakeCd * ac.airbrake + liftDump * 0.05;
  if (stallDepth > 0) { const sa = Math.sin(alpha), s0 = Math.sin(aStall); cd += 1.4 * Math.max(0, sa * sa - s0 * s0) + Math.min(0.05, stallDepth * 0.5); }
  if (over > 1) cd += (over - 1) * (0.08 + 2.5 * (over - 1)); // флаттер: тряска и стена сопротивления, без разрушения
  if (hpK > 0) cd += aero.cd0 * 0.8 * hpK;
  if (!running) cd += 0.004;

  const L = qbar * S * cl;
  const D = qbar * S * cd;
  const Y = -qbar * S * CY_BETA * clamp(beta, -0.45, 0.45);
  let T = thrustAt(spec, ac.throttle, V, rho, aSnd) * ac.mods.thrust * (1 - 0.55 * smoothstep(0.35, 0.95, hpK));
  T *= clamp((spec.ceiling - ac.pos.y) / 2500 + 0.22, 0, 1); // практический потолок

  _lift.crossVectors(_r, _vaHat).normalize();
  _force.set(0, -W, 0);
  _force.addScaledVector(_lift, L).addScaledVector(_vaHat, -D).addScaledVector(_r, Y).addScaledVector(_f, T);

  // тормозной парашют и реверс (на пробеге, тормозом)
  const brake = clamp(c.brake || 0, 0, 1);
  const gsNow = Math.hypot(ac.vel.x, ac.vel.z);
  const wantChute = spec.chute > 0 && ac.onGround && !ac.onWater && brake > 0.5 && (ac.chute > 0 ? gsNow > 12 : gsNow > 30);
  ac.chute = approach(ac.chute, wantChute ? 1 : 0, dt * 1.5);
  if (ac.chute > 0) _force.addScaledVector(_vaHat, -qbar * spec.chute * 1.1 * ac.chute);
  const wantRev = spec.reverse && ac.onGround && brake > 0.2 && gsNow > 12 && running;
  ac.reverse = approach(ac.reverse, wantRev ? brake : 0, dt * 1.2);
  if (ac.reverse > 0) _force.addScaledVector(_f, -spec.thrust * 0.28 * ac.reverse);

  // перегрузка по нормали (для приборов и ограничений)
  const tl = T * _f.dot(_lift); // составляющая тяги по нормали к потоку
  const gNow = (L + tl) / W;
  ac.g = ac.onGround ? 1 : gNow;

  // ---------- вращение ----------
  const vS = spec.vStall;
  const effQ = clamp((V * V) / (0.72 * vS * vS), 0, 1); // эффективность рулей
  const eff = Math.max(effQ, 0.12);
  const vRef = Math.max(V, 0.45 * vS);
  const qS = Math.max(qbar * S, 1);
  const sP = clamp(c.pitch, -1, 1), sR = clamp(c.roll, -1, 1), sY = clamp(c.yaw, -1, 1);
  ctl.assist = assist;
  ctl.vsCfg = vS / Math.sqrt(1 + aero.flapLift * fl);

  if (airborne) {
    const liner = !!spec.pitchLimit;
    // --- нейтраль ручки: какая перегрузка держится сама ---
    const gl = _lift.y;
    const cg = Math.sqrt(Math.max(0, 1 - _vaHat.y * _vaHat.y)); // cos угла наклона траектории
    let nHold;
    if (assist) {
      // удержание траектории + частичная компенсация крена (в крене нос плавно опускается)
      if (gl >= 0) {
        const cphi = clamp(gl / Math.max(cg, 0.2), 0, 1);
        const w = smoothstep(0.34, 0.62, cphi);
        nHold = cg * (cphi + 0.6 * w * (1 / Math.max(cphi, 0.5) - cphi));
        // почти горизонтальный полёт сам выравнивается в горизонт («отпустил — летит ровно»)
        const gam = _vaHat.y, gCap = 0.012 + 0.6 / vRef;
        if (Math.abs(sP) < 0.04 && Math.abs(gam) < gCap && cphi > 0.9) nHold -= (0.6 * gam * vRef) / G0;
      } else nHold = gl * 0.3;
    } else {
      // классика: постоянный Cy (балансировочная скорость) + демпфирование фугоиды
      const qNow = 0.5 * rho * V * V;
      const qLo = 0.5 * RHO0 * 1.44 * ctl.vsCfg * ctl.vsCfg, qHi = 0.5 * RHO0 * spec.vMax * spec.vMax;
      if (!(ac._trimQ > 0)) ac._trimQ = clamp(qNow, qLo, qHi);
      const gam = _vaHat.y;
      if (Math.abs(sP) > 0.08) {
        // «пилот снимает усилия триммером»: балансировка плавно идёт за ручкой
        const nNow = ctl.nN + (sP > 0 ? sP * (ctl.nHi - ctl.nN) : sP * (ctl.nN - ctl.nLo));
        const wTrim = clamp(1 - Math.abs(gNow - 1) / 0.6, 0, 1);
        const target = clamp(qNow / Math.max(0.3, nNow + 1.4 * gam), qLo, qHi);
        ac._trimQ = damp(ac._trimQ, target, 0.6 * wTrim, dt);
      }
      ac._trimQ = clamp(ac._trimQ, qLo, qHi);
      nHold = clamp(qNow / ac._trimQ - 1.4 * gam, -0.3, 2.2);
    }
    // --- ручка по тангажу: угол атаки от нейтрали до ограничения ---
    const aLimHi = assist ? aStall * 0.9 : aStall * 1.3;
    const aLimLo = assist ? aStallN * 0.85 : aStallN * 1.25;
    const gHi = spec.maxG * (assist ? 1 : 1.2);
    const gLo = assist && liner ? 0 : spec.minG * (assist ? 1 : 1.15);
    const aOfN = (n) => ((n * W - tl) / qS - cl0) / clA;
    const nOfA = (a) => (qS * (cl0 + clA * a) + tl) / W;
    const aHi = Math.min(aOfN(gHi), aLimHi);
    const aLo = Math.max(aOfN(gLo), aLimLo);
    const aN = clamp(aOfN(nHold), aLo, Math.min(aHi, aStall * 0.9));
    let aCmd = sP >= 0 ? aN + sP * (aHi - aN) : aN + sP * (aN - aLo);
    ctl.nN = nOfA(aN); ctl.nHi = nOfA(aHi); ctl.nLo = nOfA(aLo);

    // --- срыв и штопор ---
    let stallRoll = 0, stallYaw = 0, ailK = 1;
    if (stalled) {
      ac._stallT += dt;
      if (ac._stallDir === 0) ac._stallDir = Math.abs(sY) > 0.15 ? Math.sign(sY) : Math.abs(beta) > 0.03 ? -Math.sign(beta) : Math.abs(sR) > 0.2 ? Math.sign(sR) : ac.id % 2 ? 1 : -1;
      if (assist) {
        aCmd = Math.min(aCmd, aStall * 0.55);
      } else {
        const depth = clamp(stallDepth / 0.2, 0.3, 1);
        aCmd = alpha > 0 ? aStall * (0.6 + 0.75 * Math.max(0, sP)) : aStallN * (0.6 + 0.75 * Math.max(0, -sP));
        stallRoll = ac._stallDir * spec.rollRate * 0.45 * depth * (alpha > 0 ? 1 : -1);
        stallYaw = ac._stallDir * 0.35 * depth;
        ailK = 0.3;
        if (ac.spin === 0 && ac._stallT > 1.1 && alpha > 0 && sP > 0.55 && (Math.abs(sY) > 0.3 || Math.abs(sR) > 0.6 || Math.abs(beta) > 0.14)) {
          ac.spin = ac._stallDir;
          ac._spinT = 0;
        }
      }
    } else {
      ac._stallT = 0;
      if (ac.spin === 0) ac._stallDir = 0;
    }

    // --- тангаж: нос идёт за вектором скорости + отработка заданного угла атаки ---
    const fn = L + tl - W * gl;
    let wPitch = fn / (m * vRef) + aero.kAlpha * (aCmd - alpha) * eff + gPitch;
    if (stalled && !assist) wPitch -= 0.3 * clamp(stallDepth / 0.15, 0, 1);
    if (assist && liner && Math.abs(ac.bank) < 1.1) {
      wPitch = clamp(wPitch, (-spec.pitchLimit[1] - ac.pitch) * 1.5, (spec.pitchLimit[0] - ac.pitch) * 1.5);
    }
    const prMax = spec.pitchRate * agility * (0.25 + 0.75 * effQ);
    wPitch = clamp(wPitch, -prMax, prMax);

    // --- рыскание: флюгерная устойчивость, координация разворота, педали ---
    const fr = Y - W * _r.y;
    const bCmd = -sY * 0.17 * effQ;
    let wYaw = -(assist ? 1 : 0.3) * fr / (m * vRef) - 3 * (beta - bCmd) * eff;
    if (!assist) wYaw += 0.14 * sR * clamp(cl / clMax, 0, 1) * effQ; // момент рыскания от элеронов
    wYaw -= stallYaw;

    // --- крен ---
    const rollMax = spec.rollRate * agility * Math.pow(effQ, 0.75) * ailK;
    let pr = sR * rollMax; // вправо +
    ctl.rollMax = rollMax;
    ctl.bankLim = assist && spec.bankLimit ? spec.bankLimit : 0;
    if (assist && Math.abs(ac.pitch) < 1.1) {
      if (spec.bankLimit) pr = clamp(pr, (-spec.bankLimit - ac.bank) * 2.5, (spec.bankLimit - ac.bank) * 2.5);
      if (Math.abs(sR) < 0.04 && Math.abs(ac.bank) < 0.14) pr -= ac.bank * 0.9; // малый крен убирается сам
    }
    let wRoll = -pr + 0.6 * beta * effQ + stallRoll + gRoll;
    if (hpK > 0.45) wRoll += (ac.id % 2 ? 1 : -1) * 0.25 * (hpK - 0.45) * effQ; // повреждённое крыло «тянет»

    // --- штопор (только без помощи) ---
    if (ac.spin !== 0) {
      ac._spinT += dt;
      const recovering = sP < 0.25 || assist;
      if (recovering) ac._spinT += dt * (sY * ac.spin < -0.3 ? 3 : 1.5);
      if (recovering && ac._spinT > 2.2) { ac.spin = 0; ac._stallDir = 0; }
      else {
        const k = recovering ? 0.45 : 1;
        if (!recovering) wPitch = clamp(fn / (m * vRef) + aero.kAlpha * (0.6 - alpha) * 0.6, -1, 1); // нос висит на закритическом угле
        wYaw = -ac.spin * 2.1 * k;
        wRoll = -ac.spin * 1.2 * k;
      }
    }

    ac.angVel.x = damp(ac.angVel.x, wPitch, aero.lagP, dt);
    ac.angVel.y = damp(ac.angVel.y, wYaw, 5, dt);
    ac.angVel.z = damp(ac.angVel.z, wRoll, aero.lagR, dt);

    // превышение перегрузки (без помощи): конструкция терпит недолго
    const gEx = Math.max(gNow / spec.maxG, gNow / (spec.minG * 1.3));
    ac.overG = clamp((gEx - 0.92) / 0.2, 0, 1);
    if (gEx > 1.08) {
      ac._dmgAcc += (gEx - 1.08) * 60 * dt;
      if (ac._dmgAcc >= 1) { damageAircraft(ac, env, ac._dmgAcc, 'overstress'); ac._dmgAcc = 0; }
    }

    const wLen = ac.angVel.length();
    if (wLen > 1e-6) {
      _axis.copy(ac.angVel).multiplyScalar(1 / wLen);
      _dq.setFromAxisAngle(_axis, wLen * dt);
      ac.quat.multiply(_dq).normalize();
    }
    ac.airTime += dt;
    ac.groundTime = 0;
  } else {
    ac.overG = 0;
    ac.stallWarn = 0;
    ac.spin = 0;
    ac._stallT = 0;
    ctl.nN = 1; ctl.nHi = 1; ctl.nLo = 1; ctl.rollMax = 0;
    ac.groundTime += dt;
  }
  ac.buffet = Math.max(ac.stallWarn > 0.5 ? (ac.stallWarn - 0.5) * 2 : 0, ac.overspeed, stalled ? 1 : 0, ac.overG * 0.6);

  // ---------- интегрирование ----------
  ac.vel.addScaledVector(_force, dt / m);
  ac.pos.addScaledVector(ac.vel, dt);

  // ---------- земля / вода / палуба ----------
  const gnd = world.groundAt(ac.pos.x, ac.pos.z);
  const water = gnd.surface === 'water';
  const floatW = water && spec.amphibian;
  const contactH = floatW ? spec.hullHeight + 0.45 * ac.planing : aero.bellyH + (spec.gearHeight - aero.bellyH) * ac.gearPos;
  let h = ac.pos.y - contactH - gnd.y;
  let hx = 0, hz = 0;
  if (gnd.surface === 'ground' && h < 4) { const sl = terrainSlope(world, ac.pos.x, ac.pos.z); hx = sl.hx; hz = sl.hz; }
  const slopeRate = hx * ac.vel.x + hz * ac.vel.z; // скорость подъёма рельефа под самолётом
  ac.agl = Math.max(0, h);
  ac.airport = gnd.airport || null;

  if (h <= 0) {
    const nLen = Math.sqrt(hx * hx + 1 + hz * hz);
    const ny = 1 / nLen;
    const vn = -(ac.vel.y - slopeRate) * ny; // скорость сближения с поверхностью по нормали
    const belly = !floatW && ac.gearPos < 0.5;
    let bounceV = 0;
    if (!wasGround) {
      // --- касание ---
      const gs = Math.hypot(ac.vel.x, ac.vel.z);
      _e.setFromQuaternion(ac.quat, 'YXZ');
      const bankT = -_e.z, pitchT = _e.x, hdg = -_e.y;
      const fx0 = Math.sin(hdg), fz0 = -Math.cos(hdg);
      const drift = ac.vel.x * -fz0 + ac.vel.z * fx0; // боковая скорость (вправо +)
      const crab = gs > 2 ? Math.atan2(drift, ac.vel.x * fx0 + ac.vel.z * fz0) : 0;
      const first = ac._flying;
      let reason = null, dmg = 0, src = 'landing';
      if (water && !spec.amphibian) reason = 'water';
      else if (ny < 0.82 && vn > 5) reason = 'terrain';
      else if (vn > aero.vsCrash) reason = ny < 0.95 || slopeRate > 0.5 * vn ? 'terrain' : 'hard';
      else if (Math.abs(bankT) > aero.bankCrash) reason = 'wing';
      else if (pitchT < -0.3 || (pitchT < -0.16 && vn > 2.2)) reason = 'nose';
      else if (gnd.surface === 'ground' && gs > (spec.ground ? 2.0 : 1.5) * vS) reason = 'terrain';
      else if (belly && vn > aero.vsCrash * 0.6) reason = 'gearup';
      if (!reason) {
        if (vn > aero.vsSoft) dmg += 10 + 55 * ((vn - aero.vsSoft) / (aero.vsCrash - aero.vsSoft));
        if (Math.abs(bankT) > aero.bankCrash * 0.6) dmg += 15;
        if (pitchT < -0.07) dmg += 12;
        if (Math.abs(drift) > 6 && !water) dmg += Math.min(30, (Math.abs(drift) - 6) * 3);
        if (pitchT > aero.rotMax + 0.1 && !water) dmg += 8; // касание хвостом
        if (belly) { dmg += (spec.id === 'yak52' ? 12 : 30) + gs * 0.12; src = 'gearup'; }
        if (floatW && ac.gearPos > 0.5 && gs > 25) dmg += 20; // амфибия с выпущенным шасси на воду
        if (dmg > 0) {
          damageAircraft(ac, env, dmg, src);
          if (ac.hp <= 0) reason = belly ? 'gearup' : 'hard';
        }
      }
      if (reason && ac.fuel <= 0 && (reason === 'water' || reason === 'terrain')) reason = 'fuel';
      if (reason && ac.hp <= 0 && ac.damageSource) reason = 'shot';
      const td = {
        ac, vs: -vn, speed: gs, surface: gnd.surface, airport: gnd.airport || null, runway: gnd.runway || null,
        across: gnd.across ?? null, along: gnd.along ?? null,
        gforce: 1 + (vn * vn) / (2 * G0 * 0.35), bank: bankT, pitch: pitchT, sideslip: crab, drift, ias,
        gearDown: !belly, bounce: first ? 0 : ac.bounces + 1, first, damage: dmg, hard: vn > aero.vsSoft, arrested: false, crash: reason,
      };
      if (reason) {
        ac.pos.y = gnd.y + contactH;
        ac.lastTouchdown = td;
        crashAircraft(ac, env, reason);
        return;
      }
      const quiet = !first && ac.airTime < 0.25; // колесо едва оторвалось — не событие
      if (first) { ac.bounces = 0; ac._rollout = 0; } else if (!quiet) ac.bounces++;
      ac._flying = false;
      ac._landing = true;
      // аэрофинишёр: гак цепляет трос, если впереди достаточно палубы
      if (gnd.surface === 'carrier' && !belly && gs > 18 && gnd.runway) {
        const rw = gnd.runway;
        const dir = ac.vel.x * Math.sin(rw.heading) - ac.vel.z * Math.cos(rw.heading) >= 0 ? 1 : -1;
        const remain = rw.length / 2 - (gnd.along || 0) * dir;
        if (remain > 55) {
          ac.arrested = true;
          ac._arrestA = clamp((gs * gs) / (2 * Math.min(remain - 25, 85)), 8, 45);
          td.arrested = true;
          if (bus) bus.emit('ac:arrest', { ac });
        }
      }
      // «козёл»: жёсткое касание подбрасывает
      if (!belly && !ac.arrested && vn > 1.7) bounceV = vn * (floatW ? 0.3 : 0.42);
      ac.onGround = true;
      ac.onWater = water;
      if (!quiet) {
        ac.lastTouchdown = td;
        if (bus) bus.emit('ac:touchdown', td);
      }
    } else if (water && !spec.amphibian) {
      crashAircraft(ac, env, ac.fuel <= 0 ? 'fuel' : 'water'); // выкатился в воду
      return;
    } else if (gnd.surface === 'ground' && hx * hx + hz * hz > 0.2 && slopeRate > 6) {
      crashAircraft(ac, env, 'terrain'); // на скорости в крутой склон
      return;
    }
    ac.onWater = water;
    ac.pos.y = gnd.y + contactH;
    if (ac.vel.y < slopeRate + bounceV) ac.vel.y = slopeRate + bounceV;

    const paved = gnd.surface === 'runway' || gnd.surface === 'carrier' || gnd.surface === 'apron';
    const rain = world.weather ? world.weather.rain || 0 : 0;
    const gs = Math.hypot(ac.vel.x, ac.vel.z);
    const wow = clamp(1 - (_force.y + W) / W, 0, 1); // доля веса на колёсах
    _e.setFromQuaternion(ac.quat, 'YXZ');
    let hdg = -_e.y;
    const fx = Math.sin(hdg), fz = -Math.cos(hdg);
    let vF = ac.vel.x * fx + ac.vel.z * fz;
    let vSd = ac.vel.x * -fz + ac.vel.z * fx;

    // --- сопротивление качению / воды, тормоза ---
    let mu, latK;
    if (floatW) {
      const x = gs / vS;
      ac.planing = smoothstep(0.35, 0.75, x);
      const hump = Math.exp(-((x - 0.38) * (x - 0.38)) / 0.045);
      mu = 0.035 + 0.15 * hump + 0.07 * ac.planing + brake * 0.12 + (ac.gearPos > 0.5 ? 0.1 : 0);
      latK = 2.2;
    } else {
      ac.planing = 0;
      if (belly) { mu = paved ? 0.45 : 0.6; latK = 4; }
      else {
        mu = paved ? 0.02 : spec.ground ? 0.045 : 0.09;
        mu += brake * (paved ? 0.4 * (1 - 0.35 * rain) : 0.3);
        latK = paved ? 10 - 4 * rain : 7;
      }
    }
    let dec = mu * G0 * (floatW ? Math.max(wow, 0.05) : wow) * dt;
    if (ac.arrested) {
      dec += ac._arrestA * dt;
      if (gs < 1.5) ac.arrested = false;
    }
    // уклон грунта
    if (hx !== 0 || hz !== 0) vF -= G0 * (hx * fx + hz * fz) * dt;
    vF = Math.abs(vF) <= dec ? 0 : vF - Math.sign(vF) * dec;
    vSd *= Math.exp(-latK * Math.max(wow, floatW ? 0.4 : 0.15) * dt);

    // --- катапульта: на палубе полный газ без тормоза ---
    ac.catapult = false;
    if (gnd.surface === 'carrier' && gnd.runway && !belly && !ac.arrested && c.throttle > 0.88 && brake < 0.1) {
      const rw = gnd.runway;
      const dx = Math.sin(rw.heading), dz = -Math.cos(rw.heading);
      const cosA = fx * dx + fz * dz;
      if (Math.abs(cosA) > 0.9) {
        const dir = cosA > 0 ? 1 : -1;
        const remain = rw.length / 2 - (gnd.along || 0) * dir - 12;
        const vT = 1.22 * ctl.vsCfg + 4;
        if (remain > 5 && vF < vT && vF > -1) {
          const aNeed = (vT * vT - vF * vF) / (2 * remain);
          const aOwn = Math.max(0, (T - D) / m - mu * G0);
          const extra = clamp(aNeed * 1.1 - aOwn, 0, 40);
          if (extra > 0.3) {
            vF += extra * dt;
            if (!ac._catOn && bus) bus.emit('ac:catapult', { ac });
            ac.catapult = true;
          }
        }
      }
    }
    ac._catOn = ac.catapult;

    // --- руление: педали + ручка по крену; на скорости ограничено боковой перегрузкой ---
    const steer = clamp(sY + sR * 0.7, -1, 1);
    const rMin = floatW ? spec.length * 3 : spec.length * 0.9;
    let yawRate = steer * Math.min(Math.abs(vF) / rMin, (floatW ? 1.5 : 3.2) / Math.max(Math.abs(vF), 1)) * Math.sign(vF || 1);
    if (V > 5) yawRate += (assist ? 0.06 : 0.3) * beta * effQ * (belly ? 0 : 1); // флюгер: боковой ветер разворачивает нос
    hdg += yawRate * dt;
    const fx2 = Math.sin(hdg), fz2 = -Math.cos(hdg); // колёса ведут: скорость поворачивается вместе с курсом
    ac.vel.x = fx2 * vF - fz2 * vSd;
    ac.vel.z = fz2 * vF + fx2 * vSd;

    // --- положение на земле: крен к нулю, тангаж — стойки/хвост/подъём носа ---
    const slopeP = Math.atan(hx * fx + hz * fz);
    ac._slopePitch = damp(ac._slopePitch, slopeP, 8, dt);
    const auth = clamp((ias - 0.55 * spec.vRotate) / (0.35 * spec.vRotate), 0, 1); // эффективность руля высоты
    let gp = spec.groundPitch;
    if (gp > 0) gp *= 1 - clamp((ias - 0.3 * vS) / (0.3 * vS), 0, 1) * (sP > 0.3 ? 0 : 1); // хвост поднимается на разбеге
    if (floatW) gp = 0.035 + 0.05 * Math.exp(-((gs / vS - 0.4) * (gs / vS - 0.4)) / 0.05);
    if (belly) gp = 0;
    const pTarget = belly ? 0 : gp + Math.min(1, Math.max(0, sP) * 1.6) * auth * (aero.rotMax - gp);
    let pitchG = _e.x - ac._slopePitch;
    if (pitchG < pTarget) pitchG = Math.min(pTarget, pitchG + (pitchG < gp ? 0.6 : spec.pitchRate * 0.45 * auth + 0.02) * dt);
    else pitchG = Math.max(pTarget, pitchG - (0.1 + 0.35 * (1 - auth) + 0.3 * Math.max(0, -sP)) * dt);
    if (pitchG > aero.rotMax + 0.02) pitchG = aero.rotMax + 0.02;
    _e.x = pitchG + ac._slopePitch;
    _e.z = damp(_e.z, 0, 8, dt);
    _e.y = -hdg;
    ac.quat.setFromEuler(_e);
    ac.angVel.set(0, 0, 0);

    // --- урон на пробеге: лайнер по грунту, скольжение на брюхе ---
    if (!floatW) {
      let rate = 0;
      if (gnd.surface === 'ground' && !belly) {
        const vOk = spec.ground ? 1.7 * vS : 14;
        if (gs > vOk) rate = spec.ground ? (gs - vOk) * 0.5 : 2 + (gs - vOk) * 0.14;
      }
      if (belly && gs > 8) rate += paved ? 1.5 : 3;
      if (rate > 0) {
        ac._dmgAcc += rate * dt;
        if (ac._dmgAcc >= 1) {
          damageAircraft(ac, env, ac._dmgAcc, belly ? 'gearup' : 'terrain');
          ac._dmgAcc = 0;
          if (ac.hp <= 0) { crashAircraft(ac, env, belly ? 'gearup' : 'terrain'); return; }
        }
      }
    }

    // --- остановка после посадки ---
    if (ac._landing) {
      ac._rollout += gs * dt;
      if (gs < 0.6) {
        ac._landing = false;
        if (bus) bus.emit('ac:stopped', { ac, surface: gnd.surface, airport: gnd.airport || null, runway: gnd.runway || null, along: gnd.along ?? null, across: gnd.across ?? null, rollout: ac._rollout, bounces: ac.bounces, touchdown: ac.lastTouchdown });
      }
    }
    ac.airTime = 0;
    ac.surface = gnd.surface;
  } else {
    if (ac.onGround && h > 0.2) {
      ac.onGround = false;
      ac.onWater = false;
      ac.arrested = false;
      ac.catapult = false;
      ac.planing = 0;
      if (!assist || !(ac._trimQ > 0)) ac._trimQ = Math.max(0.5 * RHO0 * V * V, 0.5 * RHO0 * 1.7 * vS * vS);
    }
    if (!ac.onGround) {
      ac.surface = 'air';
      // взлёт засчитывается, когда самолёт уверенно в воздухе (подскок на посадке — не взлёт)
      if (!ac._flying && ac.airTime > 0.9 && h > 1.5) {
        ac._flying = true;
        ac._landing = false;
        ac.bounces = 0;
        if (bus) bus.emit('ac:takeoff', { ac });
      }
    } else ac.surface = gnd.surface;
  }

  // ---------- производные величины ----------
  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  _u.set(0, 1, 0).applyQuaternion(ac.quat);
  _r.set(1, 0, 0).applyQuaternion(ac.quat);
  ac.tas = V;
  ac.ias = ias;
  ac.gs = Math.hypot(ac.vel.x, ac.vel.z);
  ac.alt = ac.pos.y;
  ac.vs = ac.vel.y;
  ac.heading = wrapTau(Math.atan2(_f.x, -_f.z));
  ac.pitch = Math.asin(clamp(_f.y, -1, 1));
  ac.bank = Math.atan2(-_r.y, _u.y);
  ac.aoa = alpha;
  ac.slip = beta;
  ac.mach = mach;
}

export function crashAircraft(ac, env, reason) {
  if (!ac.alive) return;
  ac.alive = false;
  ac.crashed = true;
  ac.hp = 0;
  ac.vel.set(0, 0, 0);
  ac.angVel.set(0, 0, 0);
  ac.throttle = 0;
  ac.afterburner = 0;
  ac.stallWarn = ac.buffet = ac.overspeed = 0;
  if (env.bus) env.bus.emit('ac:crash', { ac, reason });
}
