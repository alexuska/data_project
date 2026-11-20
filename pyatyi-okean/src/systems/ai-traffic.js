// ФОНОВЫЙ ТРАФИК: гражданские борта летают между аэродромами архипелага (взлёт — маршрут — посадка), чтобы небо было живым.
// Управляется через G.ai.setTraffic(n). Борт после посадки и остановки исчезает, вместо него появляется новый рейс.
import { getSpec } from '../aircraft/catalog.js';
import { mulberry32 } from '../core/util.js';

// тип: вес выбора, минимальная длина полосы, крейсерская высота, допустимые виды аэродромов
const TYPES = [
  { id: 'an2', w: 3, len: 500, alt: 700, kinds: { intl: 1, regional: 1, strip: 1 } },
  { id: 'l410', w: 3, len: 1000, alt: 1500, kinds: { intl: 1, regional: 1 } },
  { id: 'yak40', w: 2, len: 1400, alt: 2400, kinds: { intl: 1, regional: 1 } },
  { id: 'tu154', w: 1.5, len: 1900, alt: 3600, kinds: { intl: 1, regional: 1 } },
];

export function createTraffic(G, ai, emit) {
  const rng = mulberry32(777);
  const flights = [];
  let want = 0, tick = 0, radioT = 0, serial = 0;

  const airportsFor = (t) => (G.world.airports || []).filter((a) => t.kinds[a.kind] && a.runways && a.runways[0] && a.runways[0].length >= t.len);
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  function pickType() {
    let sum = 0;
    for (const t of TYPES) sum += t.w;
    let r = rng() * sum;
    for (const t of TYPES) { r -= t.w; if (r <= 0) return t; }
    return TYPES[0];
  }
  // крейсерская высота с запасом над рельефом вдоль прямой
  function cruiseAlt(t, a, b) {
    const h = G.world.heightAt;
    let top = 0;
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      top = Math.max(top, h(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k));
    }
    return Math.max(t.alt + Math.max(a.elevation, b.elevation), top + 450);
  }
  const farFromPlayer = (x, z, d) => !G.player || Math.hypot(G.player.pos.x - x, G.player.pos.z - z) > d;
  function clearAt(x, z, d) {
    for (let i = 0; i < G.aircraft.length; i++) {
      const p = G.aircraft[i].pos;
      if (Math.abs(p.x - x) < d && Math.abs(p.z - z) < d) return false;
    }
    return true;
  }

  function say(ac, from, text) {
    if (radioT > 0 || !G.player) return;
    if (Math.hypot(G.player.pos.x - ac.pos.x, G.player.pos.z - ac.pos.z) > 12000) return;
    radioT = 25;
    G.bus.emit('radio', { from, text });
  }
  function onEvent(type, ac, data) {
    const cs = ac.ai.callsign;
    if (type === 'takeoff') say(ac, cs, 'Взлёт произвёл, набираю по схеме.');
    else if (type === 'final' && data && data.airport) say(ac, cs, `${data.airport.name}-Вышка, на прямой, шасси выпущено, к посадке готов.`);
    else if (type === 'landed') say(ac, 'Вышка', `${cs}, посадка, освобождайте полосу.`);
  }

  function spawn(inAir, toPlayer) {
    const t = pickType();
    const aps = airportsFor(t);
    if (aps.length < 2) return false;
    let dest = pick(aps);
    if (toPlayer && G.player) {
      const near = G.world.nearestAirport(G.player.pos.x, G.player.pos.z).airport;
      if (aps.indexOf(near) >= 0) dest = near;
    }
    let from = pick(aps);
    for (let i = 0; i < 6 && from === dest; i++) from = pick(aps);
    if (from === dest) return false;
    const spec = getSpec(t.id);
    const alt = cruiseAlt(t, from, dest);
    const callsign = 'Борт ' + (t.id === 'tu154' ? 85 : t.id === 'yak40' ? 87 : t.id === 'l410' ? 67 : 40) + String(100 + ((serial++ * 37 + Math.floor(rng() * 9)) % 900));
    let ac = null;
    if (inAir) {
      const dx = dest.x - from.x, dz = dest.z - from.z, len = Math.hypot(dx, dz) || 1;
      // точка на маршруте: либо в 12 км от цели (чтобы игрок скоро увидел посадку), либо где-то в середине
      const k = toPlayer ? Math.max(0.1, 1 - 13000 / len) : 0.2 + rng() * 0.45;
      const x = from.x + dx * k, z = from.z + dz * k;
      if (!farFromPlayer(x, z, 3500) || !clearAt(x, z, 1500)) return false;
      const y = Math.max(alt, G.world.heightAt(x, z) + 500);
      ac = ai.spawn({ specId: t.id, team: 'neutral', x, y, z, heading: Math.atan2(dx, -dz), speed: spec.vCruise, behavior: 'land', airport: dest.id, alt: y, despawn: true, callsign, onEvent });
    } else {
      if (!farFromPlayer(from.x, from.z, 6000)) return false;
      const end = rng() < 0.5 ? 'A' : 'B';
      const st = G.world.runwayStart(from.id, 0, end);
      if (!clearAt(st.x, st.z, 500)) return false;
      ac = ai.spawn({ specId: t.id, team: 'neutral', onGround: true, airport: from.id, end, behavior: 'takeoff', delay: 4 + rng() * 10, alt: 150, callsign, onEvent,
        then: { behavior: 'land', airport: dest.id, alt, despawn: true } });
    }
    if (!ac) return false;
    ac.ai.trafficFlight = true;
    flights.push(ac);
    return true;
  }

  return {
    get count() { return flights.length; },
    flights,
    // n бортов; fill — сразу заполнить небо (часть бортов уже в воздухе)
    set(n, fill) {
      want = Math.max(0, Math.min(8, n | 0));
      while (flights.length > want) ai.remove(flights.pop());
      if (fill && G.mode !== 'menu' && G.world) {
        let guard = 0;
        while (flights.length < want && guard++ < 12) spawn(flights.length < 2 || guard > 6, flights.length === 0);
      }
      tick = 3;
    },
    reset() { want = 0; flights.length = 0; radioT = 0; },
    update(dt) {
      if (radioT > 0) radioT -= dt;
      tick -= dt;
      if (tick > 0) return;
      tick = 3;
      for (let i = flights.length - 1; i >= 0; i--) {
        const ac = flights[i];
        if (ac._aiGone || ai.list.indexOf(ac) < 0) flights.splice(i, 1);
      }
      if (flights.length < want) spawn(rng() < 0.35, false);
    },
  };
}
