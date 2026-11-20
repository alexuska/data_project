// ИИ-САМОЛЁТЫ (мирная часть): рейс по точкам, взлёт, заход и посадка, строй за ведущим, вираж над точкой, фоновый трафик.
// Контракт — в ARCHITECTURE.md. Самолёты создаются через G.spawnAircraft (модель и физику ведёт ядро),
// ИИ только пишет ac.controls и команды шасси/закрылков через регуляторы aircraft/autopilot.js.
//
//   G.ai.spawn({ specId, team, x, y, z, heading, speed, behavior, ... }) -> ac        (ac.ai = { behavior, ... })
//   G.ai.setBehavior(ac, behavior, opts)   behavior: 'route' | 'patrol' | 'orbit' | 'follow' | 'escort' | 'land' | 'takeoff'
//   G.ai.setTraffic(n)                     n гражданских бортов между аэродромами (см. ai-traffic.js)
//   G.ai.remove(ac), G.ai.clear(), G.ai.update(dt), G.ai.list
// Параметры поведения (в spawn и setBehavior):
//   route/patrol: route [{x, z, y?, speed?}], loop, alt, speed, land (id аэродрома после маршрута), despawn
//   orbit: x, z (центр; по умолчанию — текущее место), radius, alt, speed
//   follow/escort: leader (по умолчанию игрок), offset {x вправо, y вверх, z назад}
//   land: airport (id; по умолчанию ближайший), runway (индекс), end ('A'|'B'; по умолчанию — с ближней стороны), alt, despawn
//   takeoff: airport/runway/end (в spawn вместе с onGround: true — ставит на исполнительный), delay, then: { behavior, ... }
// События: opts.onEvent(type, ac, data) и шина 'ai:event' { ac, type, data };
//   type: 'takeoff' | 'airborne' | 'waypoint' {index} | 'route_end' | 'final' | 'touchdown' | 'landed' | 'removed'.
// Боевые поведения ('attack', 'ground_attack', 'flee') здесь не реализованы: такой борт встаёт в вираж (ac.ai.requested хранит запрос).
import * as AP from '../aircraft/autopilot.js';
import { getSpec } from '../aircraft/catalog.js';
import { clamp, wrapPi, mulberry32 } from '../core/util.js';
import { createTraffic } from './ai-traffic.js';

const PEACEFUL = { route: 1, patrol: 1, orbit: 1, follow: 1, escort: 1, land: 1, takeoff: 1 };
const _pt = { x: 0, y: 0, z: 0, speed: 0, bankMax: undefined };
const _h = { heading: undefined, alt: undefined, speed: undefined, vs: undefined, bank: undefined, throttle: undefined, bankMax: undefined };
function hold() { _h.heading = _h.alt = _h.speed = _h.vs = _h.bank = _h.throttle = _h.bankMax = undefined; return _h; }

export function createAI(G) {
  const list = [];
  const rng = mulberry32(20241);
  const ai = { list, traffic: null };

  function emit(ac, type, data) {
    const a = ac.ai;
    if (a && typeof a.onEvent === 'function') {
      try { a.onEvent(type, ac, data); } catch (e) { console.error('[ai.onEvent]', e); }
    }
    G.bus.emit('ai:event', { ac, type, data });
  }

  function autoOffset(leader, self) {
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i] !== self && list[i].ai.leader === leader) n++;
    const row = (n >> 1) + 1, side = n % 2 ? -1 : 1;
    const k = Math.max(1, (leader.spec ? leader.spec.span : 12) / 12);
    return { x: side * 38 * row * k, y: -3 * row, z: 32 * row * k };
  }

  ai.setBehavior = function (ac, behavior, o = {}) {
    const a = ac.ai;
    if (!a) return;
    const world = G.world;
    a.requested = behavior;
    if (!PEACEFUL[behavior]) behavior = 'orbit';
    a.behavior = behavior;
    a.t = 0;
    a.final = a.landed = a.td = a.airborne = false;
    a.stopT = 0;
    if (o.onEvent) a.onEvent = o.onEvent;
    if (o.despawn != null) a.despawn = !!o.despawn;
    a.speed = o.speed ?? a.speed ?? null;
    if (behavior === 'route' || behavior === 'patrol') {
      if (Array.isArray(o.route) && o.route.length) {
        a.route = o.route; a.wp = 0;
        a.loop = o.loop ?? behavior === 'patrol';
        a.alt = o.alt ?? (ac.onGround ? ac.pos.y + 600 : ac.pos.y);
        a.landAt = o.land || null;
      } else behavior = a.behavior = 'orbit';
    }
    if (behavior === 'orbit') {
      a.cx = o.x ?? (o.center ? o.center.x : ac.pos.x);
      a.cz = o.z ?? (o.center ? o.center.z : ac.pos.z);
      const v = ac.spec.vCruise;
      a.radius = o.radius ?? clamp((v * v) / 4.5, 900, 6000);
      a.alt = o.alt ?? (ac.onGround ? ac.pos.y + 600 : ac.pos.y);
    } else if (behavior === 'follow' || behavior === 'escort') {
      a.leader = o.leader || o.target || G.player;
      a.offset = o.offset || (a.leader ? autoOffset(a.leader, ac) : { x: 40, y: 0, z: 40 });
    } else if (behavior === 'land') {
      let apt = o.airport ? (world.airportById ? world.airportById[o.airport] : null) : null;
      if (!apt) apt = world.nearestAirport(ac.pos.x, ac.pos.z).airport;
      const rwi = o.runway || 0;
      a.land = o.end ? world.runwayStart(apt.id, rwi, o.end) : { airport: apt, runway: apt.runways[rwi] || apt.runways[0] };
      a.apt = apt;
      a.cruiseAlt = o.alt ?? Math.max(ac.pos.y, apt.elevation + 500);
    } else if (behavior === 'takeoff') {
      a.rwHeading = o.heading ?? ac.heading;
      a.outAlt = o.alt || 150;
      a.delay = o.delay || 0;
      a.then = o.then || { behavior: 'orbit', alt: ac.pos.y + 600 };
      if (ac.ap) ac.ap.to = null;
    }
  };

  ai.spawn = function (o = {}) {
    const world = G.world;
    const spec = getSpec(o.specId);
    let x = o.x || 0, y = o.y || 0, z = o.z || 0, heading = o.heading || 0;
    const onGround = !!o.onGround;
    if (onGround && o.airport) {
      const st = world.runwayStart(o.airport, o.runway || 0, o.end || 'A');
      x = st.x; y = st.y; z = st.z; heading = st.heading;
    }
    const ac = G.spawnAircraft(spec.id, { team: o.team || 'neutral', x, y, z, heading, speed: onGround ? 0 : (o.speed ?? spec.vCruise), onGround, livery: o.livery });
    if (G.combat && G.combat.armAircraft && o.armed !== false && spec.role === 'military') G.combat.armAircraft(ac, o.loadout);
    ac.ai = {
      behavior: null, requested: null, skill: clamp(o.skill ?? 0.5, 0, 1), callsign: o.callsign || null,
      onEvent: o.onEvent || null, autoRemove: o.autoRemove !== false, despawn: !!o.despawn,
      t: 0, gT: rng() * 0.3, floor: 0, deadT: 0, stopT: 0, speed: null,
      route: null, wp: 0, loop: false, alt: y, landAt: null,
      cx: 0, cz: 0, radius: 2000, leader: null, offset: null,
      land: null, apt: null, cruiseAlt: y, final: false, landed: false, td: false,
      rwHeading: heading, outAlt: 150, delay: 0, then: null, airborne: false,
    };
    list.push(ac);
    let behavior = o.behavior || 'orbit';
    if (onGround && behavior !== 'takeoff' && behavior !== 'follow' && behavior !== 'escort' && o.hold !== true) {
      // с земли: сначала взлёт, потом заказанное поведение
      ai.setBehavior(ac, 'takeoff', { heading, delay: o.delay, alt: o.takeoffAlt, then: { ...o, behavior, onGround: false } });
    } else ai.setBehavior(ac, behavior, o);
    return ac;
  };

  ai.remove = function (ac) {
    if (!ac) return;
    const i = list.indexOf(ac);
    if (i >= 0) { list.splice(i, 1); emit(ac, 'removed'); }
    if (G.aircraft.indexOf(ac) >= 0) G.removeAircraft(ac);
  };

  ai.clear = function () {
    ai.traffic.reset();
    for (const ac of [...list]) ai.remove(ac);
    list.length = 0;
  };

  ai.setTraffic = function (n) { ai.traffic.set(n); };

  // безопасная высота по курсу (обновляется раз в 0.3 с со сдвигом)
  function floorOf(ac, a, dt, margin) {
    a.gT -= dt;
    if (a.gT <= 0) {
      a.gT = 0.3;
      a.floor = AP.apTerrainFloor(ac, G.world, margin, ac.spec.climb < 12 ? 26 : 14);
    }
    return a.floor;
  }

  // полёт на точку с запасом над рельефом: если впереди выше, чем успеваем набрать, — набор по кругу
  function cruiseTo(ac, a, x, z, alt, speed, dt) {
    const fl = floorOf(ac, a, dt, 150);
    if (fl - ac.alt > 70) {
      const h = hold();
      h.bank = 0.4; h.alt = fl + 60; h.speed = ac.spec.vClimb;
      AP.apHold(ac, h, dt);
    } else {
      _pt.x = x; _pt.z = z; _pt.y = Math.max(alt, fl); _pt.speed = speed || ac.spec.vCruise; _pt.bankMax = undefined;
      AP.apFlyTo(ac, _pt, dt);
    }
    if (ac.spec.retract && ac.agl > 40) ac.gearDown = false;
    if (ac.agl > 120) ac.flaps = 0;
    return Math.hypot(x - ac.pos.x, z - ac.pos.z);
  }

  function orbit(ac, a, cx, cz, radius, alt, dt) {
    const dx = cx - ac.pos.x, dz = cz - ac.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const toC = Math.atan2(dx, -dz);
    const h = hold();
    h.heading = toC - Math.PI / 2 + clamp((dist - radius) / radius, -1, 1) * 1.4;
    h.alt = Math.max(alt, floorOf(ac, a, dt, 150));
    h.speed = a.speed || ac.spec.vCruise * 0.9;
    AP.apHold(ac, h, dt);
    if (ac.spec.retract && ac.agl > 40) ac.gearDown = false;
  }

  function stepRoute(ac, a, dt) {
    const wp = a.route ? a.route[a.wp] : null;
    if (!wp) {
      const h = hold();
      h.heading = ac.heading; h.alt = Math.max(a.alt, floorOf(ac, a, dt, 150)); h.speed = a.speed || ac.spec.vCruise;
      AP.apHold(ac, h, dt);
      if (a.despawn && (Math.abs(ac.pos.x) > 31000 || Math.abs(ac.pos.z) > 31000)) ai.remove(ac);
      return;
    }
    const d = cruiseTo(ac, a, wp.x, wp.z, wp.y ?? a.alt, wp.speed || a.speed, dt);
    if (d < Math.max(350, 5 * ac.tas)) {
      emit(ac, 'waypoint', { index: a.wp });
      a.wp++;
      if (a.wp >= a.route.length) {
        if (a.loop) a.wp = 0;
        else {
          emit(ac, 'route_end');
          if (a.landAt) ai.setBehavior(ac, 'land', { airport: a.landAt, despawn: a.despawn });
          else a.route = null;
        }
      }
    }
  }

  function stepLand(ac, a, dt) {
    const apt = a.apt, c = ac.controls;
    const dist = Math.hypot(apt.x - ac.pos.x, apt.z - ac.pos.z);
    if (!a.final && dist > 11000) {
      const alt = dist > 17000 ? a.cruiseAlt : Math.min(a.cruiseAlt, apt.elevation + 650);
      cruiseTo(ac, a, apt.x, apt.z, alt, null, dt);
      return;
    }
    if (!a.final) { a.final = true; emit(ac, 'final', { airport: apt }); }
    const phase = AP.apLand(ac, a.land, dt);
    if (phase === 'approach' && !ac.onGround) {
      const fl = floorOf(ac, a, dt, 90);
      if (fl - ac.alt > 20) {
        const h = hold();
        h.bank = ac.bank; h.alt = fl + 30; h.speed = 1.35 * ac.spec.vApproach;
        AP.apHold(ac, h, dt);
      }
    } else if (phase === 'rollout' && !a.td) {
      a.td = true;
      emit(ac, 'touchdown', { airport: apt });
    } else if (phase === 'stopped') {
      if (!a.landed) { a.landed = true; emit(ac, 'landed', { airport: apt }); }
      c.throttle = 0; c.brake = 1;
      a.stopT += dt;
      if (a.despawn && a.stopT > 15) ai.remove(ac);
    }
  }

  function stepTakeoff(ac, a, dt) {
    const c = ac.controls;
    if (a.t < a.delay) { c.throttle = 0; c.brake = 1; c.pitch = c.roll = c.yaw = 0; return; }
    const phase = AP.apTakeoff(ac, dt, { heading: a.rwHeading, alt: a.outAlt });
    if (phase === 'climb' && !a.airborne) { a.airborne = true; emit(ac, 'takeoff'); }
    if (phase === 'done') {
      emit(ac, 'airborne');
      const then = a.then || { behavior: 'orbit' };
      ai.setBehavior(ac, then.behavior || 'orbit', then);
    }
  }

  function stepFollow(ac, a, dt) {
    const L = a.leader, c = ac.controls;
    if (!L || !L.alive || L._aiGone) {
      // ведущего нет: на земле — стоим, в воздухе — вираж на безопасной высоте
      if (ac.onGround && !a.airborne) { c.throttle = 0; c.brake = 1; c.pitch = c.roll = c.yaw = 0; return; }
      if (a.behavior !== 'orbit') ai.setBehavior(ac, 'orbit', { alt: Math.max(ac.pos.y, ac.pos.y - ac.agl + 450) });
      return;
    }
    if (ac.onGround && ac.gs < 3 && !a.airborne) {
      // ждём, пока ведущий взлетит
      if (L.onGround || L.agl < 25) { c.throttle = 0; c.brake = 1; c.pitch = c.roll = c.yaw = 0; return; }
      a.airborne = true;
      a.rwHeading = ac.heading;
      if (ac.ap) ac.ap.to = null;
    }
    if (a.airborne && (ac.onGround || ac.agl < 120)) {
      if (AP.apTakeoff(ac, dt, { heading: a.rwHeading, alt: 120 }) !== 'done') return;
    }
    a.airborne = false;
    if (L.onGround) { orbit(ac, a, L.pos.x, L.pos.z, 1800, L.pos.y + 450, dt); return; }
    AP.apFollow(ac, L, a.offset, dt);
    if (ac.spec.retract) ac.gearDown = L.gearDown && L.agl < 300 && ac.agl < 300;
    const fl = floorOf(ac, a, dt, 110);
    if (fl - ac.alt > 25) {
      const h = hold();
      h.bank = ac.bank; h.alt = fl + 30; h.throttle = 1;
      AP.apHold(ac, h, dt);
    }
  }

  ai.update = function (dt) {
    ai.traffic.update(dt);
    for (let i = list.length - 1; i >= 0; i--) {
      const ac = list[i], a = ac.ai;
      if (!ac.alive) {
        a.deadT += dt;
        if (a.autoRemove && a.deadT > 8) ai.remove(ac);
        continue;
      }
      a.t += dt;
      // боевые поведения ведёт модуль боя (ai-combat.js); если цели нет — обычное поведение ниже
      const fight = a.requested === 'attack' || a.requested === 'flee' || ac.hp <= 0;
      if (fight && G.combat && G.combat.pilot && G.combat.pilot(ac, a, dt)) continue;
      switch (a.behavior) {
        case 'route': case 'patrol': stepRoute(ac, a, dt); break;
        case 'land': stepLand(ac, a, dt); break;
        case 'takeoff': stepTakeoff(ac, a, dt); break;
        case 'follow': case 'escort': stepFollow(ac, a, dt); break;
        default: orbit(ac, a, a.cx, a.cz, a.radius, a.alt, dt);
      }
      // последняя защита от земли вне взлёта/посадки
      if (a.behavior !== 'land' && a.behavior !== 'takeoff' && !ac.onGround && ac.agl < 70 && ac.vs < -1 && !a.airborne) {
        ac.controls.pitch = Math.max(ac.controls.pitch, 0.7);
        ac.controls.throttle = 1;
      }
    }
  };

  ai.traffic = createTraffic(G, ai, emit);

  G.bus.on('ac:remove', (e) => {
    if (!e || !e.ac) return;
    e.ac._aiGone = true;
    const i = list.indexOf(e.ac);
    if (i >= 0) list.splice(i, 1);
  });
  G.bus.on('flight:start', (e) => {
    const s = e && e.session;
    ai.traffic.set(s && s.missionId ? 0 : 3, true);
  });
  return ai;
}
