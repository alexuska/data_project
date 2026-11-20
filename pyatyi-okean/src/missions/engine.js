// Движок заданий: сценарий из шагов, радиообмен с паузами, цели и маркеры, завершение и провал.
//
// Задание — объект { def, session(G, world) -> {...}, freezeTime?, start?(m), build(m) -> steps[], update?(m, dt), onDone?(m) (все шаги пройдены), stop?(m) }.
// Шаг — { text (строка | fn(m)), markers? (массив | fn(m)), enter?(m), update?(m, dt) -> true = шаг выполнен,
//          on?: { 'событие': (m, e) -> true = шаг выполнен }, exit?(m), hidden? (не считается в «2/5») }.
// Карточка задачи (HUD, ui/hud-guide.js) — сверх этого необязательные поля шага:
//   title (строка | fn(m)) — короткий заголовок карточки (иначе text),
//   how (строка | fn(m)) — «как сделать» простыми словами про пальцы и экран,
//   progress(m) -> { value, max, text } | null — живой индикатор, hint (строка | fn(m)) — подсказка по ходу,
//   ctl (строка | fn(m)) — какой элемент управления подсветить: 'thr-up' | 'thr-down' | 'stick' | 'stick-back' | 'gear' | 'flaps' | 'brake' | 'action'.
// Карточку не нужно выключать: она живёт, пока шаг не выполнен. runner.card() отдаёт её HUD.
// m — контекст задания (см. createRunner): радио, подсказки, переходы, таймеры, завершение.
import { scoreLanding, towerName, dist2, kmh, fmtDist } from './lib.js';

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
  let note = null, noteKind = 'warn';

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
    // строка-заметка в карточке задачи (не исчезает, пока шаг не сменится или не вызовут note(null)); kind: 'warn' | 'good'
    note(text, kind = 'warn') { note = text || null; noteKind = kind; },
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
    if (!st || !st.hidden) note = null;
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

  const val = (x, st) => (typeof x === 'function' ? x(m, st) : x);
  let lastCard = null;
  const runner = {
    def, m,
    // карточка текущего шага для HUD: { key, n, total, title, how, progress, hint, note, noteKind, ctl, buttons? } | null
    card() {
      if (ended || !G.player) return null;
      const st = m.step;
      if (!st || (st.hidden && !st.how)) return lastCard;
      const pr = st.progress ? st.progress(m, st) : null;
      lastCard = {
        key: def.id + ':' + m.index,
        n: st.n != null ? st.n + 1 : 0, total,
        title: val(st.title, st) || objText || '',
        how: val(st.how, st) || '',
        progress: pr || null,
        hint: val(st.hint, st) || '',
        note, noteKind,
        ctl: val(st.ctl, st) || null,
      };
      return lastCard;
    },
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

// ---------- помощники карточки ----------
const altNow = (ac) => Math.round(ac.alt / 10) * 10;
// строка про высоту: «высота 240 из 300 м — набирай»
function altLine(ac, want, lo, hi) {
  const a = altNow(ac);
  if (want != null) {
    const w = Math.round(want / 10) * 10;
    const d = a - w;
    return `высота ${a} / ${w} м` + (d < -60 ? ' — набирай' : d > 120 ? ' — снижайся' : '');
  }
  if (hi != null && ac.alt > hi) return `высота ${a} м — снижайся ниже ${Math.round(hi / 10) * 10}`;
  if (lo != null && ac.alt < lo) return `высота ${a} м — набери ${Math.round(lo / 10) * 10}`;
  return '';
}
export const HOW = {
  thr: 'РУД — рычаг газа справа: сдвинь его пальцем вверх до упора.',
  rotate: (ac) => `Самолёт разгоняется. На ${kmh(ac.spec.vRotate)} км/ч потяни ручку на себя: палец слева веди вниз — нос поднимется.`,
  climb: 'Отрыв! Ручку держи чуть на себя — самолёт набирает высоту.',
  reach: 'Лети к оранжевому ромбу «ЛЕТИ СЮДА». Не видно его — у края экрана стрелка: наклони ручку в её сторону, самолёт повернёт.',
};
export function takeoffCard(m, agl = 10) {
  const ac = m.ac, vr = ac.spec.vRotate * 3.6;
  if (ac.onGround) {
    const thr = Math.max(ac.controls.throttle, ac.throttle);
    if (thr < 0.85) return { how: HOW.thr, ctl: 'thr-up', progress: { value: thr * 100, max: 100, text: `газ ${Math.round(thr * 100)}%` } };
    const v = ac.ias * 3.6;
    return { how: HOW.rotate(ac), ctl: v > vr * 0.85 ? 'stick-back' : null, progress: { value: v, max: vr, text: `скорость ${Math.round(v / 5) * 5} из ${kmh(ac.spec.vRotate)} км/ч` } };
  }
  return { how: HOW.climb, ctl: null, progress: { value: Math.min(ac.agl, agl), max: agl, text: `${Math.round(ac.agl)} м над землёй` } };
}

// ---------- готовые шаги ----------
export const S = {
  // взлёт: шаг выполнен, когда самолёт уверенно в воздухе
  takeoff(o = {}) {
    const c = (m) => takeoffCard(m, o.agl || 10);
    return { kind: 'takeoff', id: o.id || 'takeoff', text: o.text || 'Взлетайте', title: o.title, markers: o.markers || [], enter: o.enter, on: o.on,
      how: o.how || ((m) => c(m).how), progress: o.progress || ((m) => c(m).progress), ctl: o.ctl || ((m) => c(m).ctl), hint: o.hint,
      update: (m, dt) => { if (o.update) o.update(m, dt); return !m.ac.onGround && m.ac.agl > (o.agl || 10); } };
  },
  // долететь до точки: { x, z, y?, radius, label, kind, minAlt?, maxAlt? (над морем), altFrom?, altHint? }
  reach(o) {
    const mk = [{ x: o.x, y: o.y, z: o.z, label: o.label || '', kind: o.kind || 'waypoint', radius: o.ringR }];
    let d0 = 0;
    return {
      kind: 'reach', pt: { x: o.x, y: o.y, z: o.z, minAlt: o.minAlt, maxAlt: o.maxAlt }, id: o.id, text: o.text, title: o.title, markers: o.markers || mk, exit: o.exit, on: o.on,
      enter(m) { d0 = Math.max(1, dist2(m.ac.pos.x, m.ac.pos.z, o.x, o.z)); if (o.enter) o.enter(m); },
      how: o.how || ((m) => HOW.reach + (o.y != null ? ` Держи высоту около ${Math.round(o.y / 10) * 10} м (прибор справа).` : o.maxAlt != null ? ` Не выше ${Math.round(o.maxAlt / 10) * 10} м.` : '')),
      progress: o.progress || ((m) => {
        const ac = m.ac, d = dist2(ac.pos.x, ac.pos.z, o.x, o.z);
        if (d > d0) d0 = d;
        const al = altLine(ac, o.y, o.minAlt, o.maxAlt);
        return { value: d0 - d, max: d0, text: `${o.label ? o.label + ': ' : ''}${fmtDist(d)}${al ? ' · ' + al : ''}` };
      }),
      ctl: o.ctl, hint: o.hint,
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
    const dAp = (m) => { const ap = m.ap(apId); return dist2(m.ac.pos.x, m.ac.pos.z, ap.x, ap.z); };
    let d0 = 1;
    return {
      kind: 'land', ap: apId, id: o.id || 'land', text: o.text || ((m) => `Посадка: ${m.name(apId)}`), title: o.title,
      enter(m) {
        const ap = m.ap(apId);
        far = [{ x: ap.x, y: ap.elevation + 40, z: ap.z, kind: 'airport', label: ap.name }];
        d0 = Math.max(1, dAp(m));
        if (o.enter) o.enter(m);
      },
      markers(m) {
        if (o.markers) return o.markers(m);
        return m.ac.onGround || dAp(m) < 2200 ? none : far;
      },
      how: o.how || ((m) => {
        const ac = m.ac, d = dAp(m), name = m.name(apId);
        if (ac.onGround) return 'Ты на земле! Нажми и держи ТОРМОЗ, а РУД сдвинь вниз до упора — до полной остановки.';
        if (d > 6000) return `Лети к зелёной метке «ПОСАДКА · ${name}». Ближе к полосе выпустишь шасси и закрылки.`;
        const gear = ac.spec.retract && !ac.gearDown, flaps = ac.spec.flaps && ac.flaps === 0;
        if (gear || flaps) return `Готовимся к посадке: нажми ${gear ? 'ШАССИ' : ''}${gear && flaps ? ', потом ' : ''}${flaps ? 'ЗАКРЫЛКИ' : ''} (кнопки справа внизу) и сбавь газ до половины.`;
        return 'Заходи на полосу: внизу экрана подсказка «выше / ниже / левее». Держи «на глиссаде». Над полосой — РУД вниз и ручку чуть на себя.';
      }),
      progress: o.progress || ((m) => {
        const ac = m.ac;
        if (ac.onGround) { const v = ac.ias * 3.6; return { value: Math.max(0, 120 - v), max: 120, text: `скорость ${Math.round(v)} км/ч — до остановки` }; }
        const d = dAp(m);
        if (d > d0) d0 = d;
        return { value: d0 - d, max: d0, text: `до полосы ${fmtDist(d)} · высота ${altNow(ac)} м` };
      }),
      ctl: o.ctl || ((m) => {
        const ac = m.ac;
        if (ac.onGround) return ac.ias > 2 ? (ac.throttle > 0.3 ? 'thr-down' : 'brake') : null;
        const d = dAp(m);
        if (d < 7000 && ac.spec.retract && !ac.gearDown) return 'gear';
        if (d < 5000 && ac.spec.flaps && ac.flaps === 0) return 'flaps';
        return null;
      }),
      hint: o.hint,
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
