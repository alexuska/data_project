// Движок заданий: сценарий из шагов, радиообмен с паузами, цели и маркеры, завершение и провал.
//
// Задание — объект { def, session(G, world) -> {...}, freezeTime?, start?(m), build(m) -> steps[], update?(m, dt), onDone?(m) (все шаги пройдены), stop?(m) }.
// Шаг — { text (строка | fn(m)), markers? (массив | fn(m)), enter?(m), update?(m, dt) -> true = шаг выполнен,
//          on?: { 'событие': (m, e) -> true = шаг выполнен }, exit?(m), hidden? (не считается в «2/5») }.
// m — контекст задания (см. createRunner): радио, подсказки, переходы, таймеры, завершение.
import { scoreLanding, towerName, dist2 } from './lib.js';

const GAP_MIN = 6, GAP_MAX = 8;

export function createRunner(G, mission) {
  const world = G.world;
  const def = mission.def;
  const subs = [];
  let stepSubs = [];
  const queue = [];
  const timers = [];
  const hints = {};
  let lastRadio = -99, lastLen = 0;
  let steps = [];
  let total = 0;
  let objText = null;
  let markersRef = null;
  let ended = false, endT = 0, endResult = null;

  const m = {
    G, world, def, mission, data: {},
    t: 0, stepT: 0, index: -1, step: null,
    td: null,         // первое касание последней посадки: scoreLanding(...) + { bounces, t, airportId }
    landed: null,     // { td, stop } — данные завершённой посадки (из шага land)
    get ac() { return G.player; },
    get cs() { return (G.profile && G.profile.callsign) || 'Корвет'; },
    get ended() { return ended; },
    ap: (id) => world.airportById[id],
    poi: (id) => world.poiById[id],
    name: (id) => (world.airportById[id] || world.poiById[id] || { name: id }).name,
    tw: (id) => towerName(world, id),

    // ---------- радио ----------
    // opts.now — вне очереди (короткие срочные подсказки); иначе — по очереди с паузой 6–8 с
    radio(from, text, o) {
      if (ended || !text) return;
      const msg = { from, text };
      if (o && o.now) queue.unshift(msg); else queue.push(msg);
      if (queue.length > 5) queue.splice(1, 1);
    },
    tower(id, text, o) { m.radio(towerName(world, id), text, o); },
    // подсказка: не чаще раза в every с и только если эфир свободен; true — если ушла в эфир
    hint(key, from, text, every = 18) {
      if (ended) return false;
      const t = hints[key];
      if (t != null && m.t - t < every) return false;
      if (queue.length || m.t - lastRadio < 4.5) return false;
      hints[key] = m.t;
      send({ from, text });
      return true;
    },
    radioIdle: () => queue.length === 0 && m.t - lastRadio > GAP_MIN,
    toast(text, kind = 'info') { G.bus.emit('ui:toast', { text, kind }); },

    // ---------- шаги ----------
    next() { enter(m.index + 1); },
    goto(i) { enter(typeof i === 'string' ? steps.findIndex((s) => s.id === i) : i); },
    indexOf: (id) => steps.findIndex((s) => s.id === id),
    objective(text) {
      if (text === objText) return;
      objText = text;
      const st = m.step;
      G.bus.emit('mission:objective', { text, index: st && st.n != null ? st.n : 0, total });
    },
    markers(list) {
      if (list === markersRef) return;
      markersRef = list;
      G.hud.setMarkers(list || []);
    },
    setAction(a) { G.hud.setAction ? G.hud.setAction(a) : G.input?.setAction?.(a); },
    on(type, fn) { subs.push(G.bus.on(type, (e) => { if (!ended) fn(e); })); },
    later(sec, fn) { timers.push({ t: m.t + sec, fn }); },

    // ---------- итог ----------
    landStars(td, bounces) {
      if (!td) return 1;
      const s = td.score - 12 * Math.max(0, bounces ?? td.bounces ?? 0);
      return s >= 82 ? 3 : s >= 62 ? 2 : 1;
    },
    // r: { stars, title?, text?, details?, radio?: [from, text], delay? }
    complete(r) {
      if (ended) return;
      const stars = Math.max(1, Math.min(3, Math.round(r.stars ?? 3)));
      finish(r.radio, r.delay ?? 2.6, {
        reason: 'mission_complete', success: true, missionId: def.id, stars, reward: def.reward,
        title: r.title || 'Задание выполнено', text: r.text || def.title,
        details: { ...(r.details || {}), time: Math.round(m.t) },
      });
      G.bus.emit('mission:complete', { missionId: def.id, stars });
    },
    fail(title, text, radio) {
      if (ended) return;
      finish(radio, 2.6, { reason: 'mission_failed', success: false, missionId: def.id, stars: 0, title: title || 'Задание не выполнено', text: text || '' });
      G.bus.emit('mission:fail', { missionId: def.id, reason: title });
    },
  };

  function send(msg) {
    lastRadio = m.t;
    lastLen = msg.text.length;
    G.bus.emit('radio', msg);
  }
  function finish(radio, delay, result) {
    ended = true;
    queue.length = 0;
    if (radio) send({ from: radio[0], text: radio[1] });
    m.setAction(null);
    m.markers([]);
    G.bus.emit('mission:objective', { text: result.success ? 'Задание выполнено' : 'Задание не выполнено', index: 0, total: 1 });
    endT = delay;
    endResult = result;
  }

  function enter(i) {
    const prev = m.step;
    for (const u of stepSubs) u();
    stepSubs = [];
    if (prev && prev.exit) prev.exit(m);
    if (ended) return;
    m.index = i;
    const st = (m.step = steps[i] || null);
    m.stepT = 0;
    if (!st) { if (mission.onDone) mission.onDone(m); return; }
    if (st.on) {
      for (const type of Object.keys(st.on)) {
        const fn = st.on[type];
        stepSubs.push(G.bus.on(type, (e) => { if (!ended && m.step === st && fn(m, e)) enter(m.index + 1); }));
      }
    }
    refreshStep(st);
    if (st.enter) st.enter(m);
    if (m.step === st) refreshStep(st);
  }
  function refreshStep(st) {
    if (st.text) m.objective(typeof st.text === 'function' ? st.text(m) : st.text);
    if (st.markers !== undefined) m.markers(typeof st.markers === 'function' ? st.markers(m) : st.markers);
  }

  // посадки игрока: запоминаем первое касание и считаем «козлы»
  m.on('ac:touchdown', (e) => {
    if (!e || e.ac !== G.player || e.crash) return;
    if (e.bounce > 0) { if (m.td && m.t - m.td.t < 12) m.td.bounces++; return; }
    m.td = { ...scoreLanding(e), bounces: 0, t: m.t, speed: e.speed };
  });
  m.on('flight:end', () => { ended = true; endResult = null; });

  const runner = {
    def, m,
    start() {
      steps = mission.build(m) || [];
      let n = 0;
      for (const s of steps) if (s.text && !s.hidden) s.n = n++;
      total = n;
      if (mission.freezeTime) world.timeRate = 0;
      if (mission.start) mission.start(m);
      enter(0);
    },
    update(dt) {
      if (endResult) {
        endT -= dt;
        if (endT <= 0) { const r = endResult; endResult = null; G.endFlight(r); }
        return;
      }
      if (ended || !G.player) return;
      m.t += dt;
      m.stepT += dt;
      // радио
      if (queue.length) {
        const gap = Math.min(GAP_MAX, Math.max(GAP_MIN, 2.5 + lastLen * 0.05));
        if (m.t - lastRadio >= gap) send(queue.shift());
      }
      // таймеры
      for (let i = timers.length - 1; i >= 0; i--) {
        if (m.t >= timers[i].t) { const tm = timers.splice(i, 1)[0]; tm.fn(m); if (ended) return; }
      }
      if (mission.update) mission.update(m, dt);
      if (ended) return;
      const st = m.step;
      if (st) {
        if (typeof st.text === 'function') m.objective(st.text(m));
        if (typeof st.markers === 'function') m.markers(st.markers(m));
        if (st.update && st.update(m, dt) && m.step === st && !ended) enter(m.index + 1);
      }
    },
    stop() {
      for (const u of stepSubs) u();
      stepSubs = [];
      for (const u of subs) u();
      subs.length = 0;
      try { if (mission.stop) mission.stop(m); } catch (e) { console.error('[missions.stop]', e); }
      ended = true;
      endResult = null;
      queue.length = 0;
      timers.length = 0;
    },
  };
  return runner;
}

// ---------- готовые шаги ----------
export const S = {
  // взлёт: шаг выполнен, когда самолёт уверенно в воздухе
  takeoff(o = {}) {
    return { id: o.id || 'takeoff', text: o.text || 'Взлетайте', markers: o.markers || [], enter: o.enter, on: o.on,
      update: (m, dt) => { if (o.update) o.update(m, dt); return !m.ac.onGround && m.ac.agl > (o.agl || 10); } };
  },
  // долететь до точки: { x, z, y?, radius, label, kind, minAlt?, maxAlt? (над морем), altFrom?, altHint? }
  reach(o) {
    const mk = [{ x: o.x, y: o.y, z: o.z, label: o.label || '', kind: o.kind || 'waypoint', radius: o.ringR }];
    return {
      id: o.id, text: o.text, markers: o.markers || mk, enter: o.enter, exit: o.exit, on: o.on,
      update(m, dt) {
        if (o.update && o.update(m, dt)) return true;
        const ac = m.ac;
        const d = dist2(ac.pos.x, ac.pos.z, o.x, o.z);
        if (d > (o.radius || 400)) return false;
        const lo = o.minAlt != null && ac.alt < o.minAlt, hi = o.maxAlt != null && ac.alt > o.maxAlt;
        if (lo || hi) {
          if (o.altHint) o.altHint(m, lo);
          return false;
        }
        return true;
      },
    };
  },
  // сесть на аэродром и остановиться (событие ac:stopped). o: { text, onWrong?(m, e) }
  land(apId, o = {}) {
    let far = null;
    const none = [];
    return {
      id: o.id || 'land', text: o.text || ((m) => `Посадка: ${m.name(apId)}`),
      enter(m) {
        const ap = m.ap(apId);
        far = [{ x: ap.x, y: ap.elevation + 40, z: ap.z, kind: 'airport', label: ap.name }];
        if (o.enter) o.enter(m);
      },
      markers(m) {
        if (o.markers) return o.markers(m);
        const ap = m.ap(apId), ac = m.ac;
        return dist2(ac.pos.x, ac.pos.z, ap.x, ap.z) > 3500 ? far : none;
      },
      update: o.update,
      on: {
        'ac:stopped': (m, e) => {
          if (!e || e.ac !== m.ac) return false;
          if (e.airport && e.airport.id === apId && e.surface !== 'water') {
            m.landed = { td: m.td, stop: e, bounces: m.td ? m.td.bounces : 0 };
            return true;
          }
          if (o.onWrong) o.onWrong(m, e);
          else m.radio(m.tw(apId), `${m.cs}, вы сели не там. Нам нужен аэродром ${m.name(apId)} — взлетайте и следуйте к нам.`, { now: true });
          return false;
        },
        ...(o.on || {}),
      },
    };
  },
  // пустой шаг-пауза: ждёт sec секунд (без текста цели)
  wait(sec, enter) { return { hidden: true, enter, update: (m) => m.stepT >= sec }; },
};
