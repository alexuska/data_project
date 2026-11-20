// АВТОПИЛОТ И НАВИГАЦИЯ (G.autoflight). Контракт — в ARCHITECTURE.md («Дополнения, третий этап»).
// Ядро зовёт update(dt) каждый шаг симуляции сразу после input.apply: модуль пишет в G.player.controls поверх ручного ввода.
//   active, mode ('hold' | 'nav' | 'approach' | null), destination ({ airportId, name, x, z } | null)
//   engage(mode, opts?) -> bool   opts: { airportId?, silent? };   disengage(msg?, kind?);   setDestination(airportId | null)
// Сверх контракта: target { heading, alt, speed } (уставки), athr (автомат тяги), adjust('hdg'|'alt'|'spd', ±1),
//   approach (состояние автопосадки), taxi (маршрут руления), towerAction() / requestTower(), checklist { text } (подсказки
//   чек-листа — через G.hud.toast, только в свободном полёте; выключаются G.profile.settings.checklists = false),
//   approachAirport(), status() — строки для панели. Событие шины 'autoflight:changed' { active, mode }.
// Регуляторы — готовые из aircraft/autopilot.js (apHold, apFlyTo, apLand, apTerrainFloor); ИИ-самолёты не трогаем.
import { apHold, apFlyTo, apLand, apTerrainFloor, apReset } from '../aircraft/autopilot.js';
import { clamp, wrapPi, DEG } from '../core/util.js';
import { saveProfile } from '../core/save.js';
import * as N from './autoflight-nav.js';
import { createAfUi } from './autoflight-ui.js';

const KMH = 3.6;
const TAU = Math.PI * 2;
const PHASE = {
  enroute: 'полёт к аэродрому', approach: 'выход на посадочную прямую', final: 'посадочная прямая', flare: 'выравнивание',
  rollout: 'пробег и торможение', stopped: 'остановились', goaround: 'уход на второй круг',
};

export function createAutoflight(G) {
  const T = { heading: 0, alt: 0, speed: 0 }; // уставки автопилота
  const tgt = { heading: undefined, alt: undefined, speed: undefined };
  let engagedT = 0, lastThr = -1, arrived = false, armed = null, uiAcc = 1, simT = 0;
  // связь с вышкой
  const tw = { taxi: false, takeoff: false, landing: null, pendT: 0, pendA: null, pendRw: null, lastReq: -1e9 };
  // чек-листы: текущий пункт, время показа, когда можно следующий, показанные в этой фазе
  const ck = { cur: null, t: 0, next: 0, shown: {}, acc: 0, landed: false, said: 0, n: 0 };

  const cs = () => G.profile.callsign || 'Корвет';
  const toast = (text, kind = 'info') => { if (G.hud && G.hud.toast) G.hud.toast(text, kind); else G.bus.emit('ui:toast', { text, kind }); };
  const radio = (from, text) => G.bus.emit('radio', { from, text });
  const free = () => !(G.missions && G.missions.active) && !(G.flight && G.flight.session && G.flight.session.missionId);
  const fmtAlt = (m) => `${Math.round(m)} м`;
  const kmh = (v) => Math.round(v * KMH);
  const minSpd = (p) => (Math.ceil((1.3 * p.spec.vStall * KMH) / 10) * 10) / KMH;
  const maxSpd = (p) => (Math.floor((0.95 * Math.min(p.spec.vMax, p.spec.vNe || 1e9) * KMH) / 10) * 10) / KMH;
  const dist2 = (p, x, z) => Math.hypot(x - p.pos.x, z - p.pos.z);
  function setTgt(h, alt, spd) { tgt.heading = h; tgt.alt = alt; tgt.speed = spd; }
  function hhmm() {
    const t = ((G.world.timeOfDay || 12) % 24 + 24) % 24;
    const h = Math.floor(t), m = Math.floor((t - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function blockReason(p, mode) {
    if (!p || !p.alive) return 'нет самолёта';
    if (p.onGround) return 'на земле не включается — сначала взлети';
    if (p.stalled) return 'сваливание — опусти нос и разгонись';
    if (p.ias < 1.12 * p.spec.vStall) return 'мала скорость — разгонись';
    if (mode !== 'approach' && p.agl < 40) return 'слишком низко — набери хотя бы 50 м';
    return null;
  }

  // аэродром для автопосадки/вышки: заданный, пункт назначения (до 60 км) или ближайший (до maxD)
  function pickAirport(p, opts, maxD = 30000) {
    const w = G.world;
    let a = opts && opts.airportId ? w.airportById[opts.airportId] : null;
    if (!a && af.destination) {
      const d = w.airportById[af.destination.airportId];
      if (d && dist2(p, d.x, d.z) < 60000) a = d;
    }
    if (!a) {
      const n = w.nearestAirport(p.pos.x, p.pos.z);
      if (n.airport && n.dist < maxD) a = n.airport;
    }
    return a;
  }

  // безопасная высота над рельефом по курсу (кешируется на 0.25 с)
  let floorT = -1, floorV = 0, floorK = '';
  function terrainFloor(p, margin, sec) {
    const k = margin + ':' + sec;
    if (simT - floorT > 0.25 || k !== floorK) { floorT = simT; floorK = k; floorV = apTerrainFloor(p, G.world, margin, sec); }
    return floorV;
  }

  // ближайший ИИ-борт, заходящий на посадку на аэродром a (или на его полосе)
  function traffic(a, r = 9000, low = 900) {
    let best = null, bd = 1e9;
    for (let i = 0; i < G.aircraft.length; i++) {
      const ac = G.aircraft[i];
      if (ac === G.player || ac.isPlayer || !ac.alive || !ac.ai) continue;
      const d = Math.hypot(ac.pos.x - a.x, ac.pos.z - a.z);
      if (d > r) continue;
      const onRw = ac.onGround && ac.surface === 'runway' && ac.airport === a;
      const landing = !ac.onGround && ac.ai.behavior === 'land' && (ac.ai.apt === a || d < r) && ac.agl < low + 600;
      if ((onRw || landing) && d < bd) { bd = d; best = ac; }
    }
    return best ? { ac: best, dist: bd, name: best.spec.name, onRw: best.onGround } : null;
  }

  function navAlt(p, d) {
    const a = G.world.airportById[d.airportId];
    const top = N.routeTop(G.world, p.pos.x, p.pos.z, d.x, d.z);
    const want = Math.max(top + 350, (a ? a.elevation : 0) + 600);
    return Math.round(Math.max(want, Math.min(p.alt, (p.spec.ceiling || 6000) * 0.8)) / 50) * 50;
  }

  function setupApproach(p, a) {
    const pref = tw.landing && tw.landing.apt === a ? tw.landing.rw : null;
    const sel = pref || N.bestRunway(a, G.world, p.spec);
    const rs = G.world.runwayStart(a.id, sel.index, sel.end);
    return {
      airport: a, sel, rs, name: sel.name, tower: N.towerName(a),
      phase: dist2(p, a.x, a.z) > 12000 ? 'enroute' : 'approach', said: {}, gear: p.gearDown, flaps: Math.round(p.flaps * 2), t: 0, s: 0,
    };
  }

  // ---------------- включение / выключение ----------------
  function engage(mode = 'hold', opts = {}) {
    const p = G.player;
    if (G.mode !== 'flight') return false;
    const why = blockReason(p, mode);
    if (why) {
      if (mode === 'nav' && p && p.alive && p.onGround && (opts.airportId || af.destination)) {
        if (opts.airportId) af.setDestination(opts.airportId);
        armed = 'nav';
        toast(`Автопилот поведёт к цели «${af.destination.name}» после взлёта, выше 150 м`, 'info');
        changed();
        return false;
      }
      if (!opts.silent) toast('Автопилот: ' + why, 'warn');
      return false;
    }
    let A = null;
    if (mode === 'approach') {
      const a = pickAirport(p, opts);
      if (!a) { toast('Автопосадка: рядом нет аэродрома — выбери его на карте', 'warn'); return false; }
      if (a.kind === 'carrier') { toast('На палубу авианосца садятся только вручную', 'warn'); return false; }
      A = setupApproach(p, a);
      if (A.sel.len < (p.spec.landingRun || 0) * 1.1) { toast(`Полоса аэродрома ${a.name} коротка для ${p.spec.name}`, 'warn'); return false; }
    }
    if (mode === 'nav') {
      const id = opts.airportId || (af.destination && af.destination.airportId);
      if (!id || !G.world.airportById[id]) { toast('Выбери аэродром на карте и нажми «Лететь сюда»', 'warn'); return false; }
      if (!af.destination || af.destination.airportId !== id) setDest(id);
    }
    if (!af.active || af.mode !== mode) apReset(p);
    af.active = true; af.mode = mode; armed = null; engagedT = 0; lastThr = -1;
    af.approach = A; af.terrain = false;
    if (mode === 'hold') {
      T.heading = ((Math.round(p.heading / DEG) * DEG) % TAU + TAU) % TAU;
      T.alt = Math.round(p.alt / 10) * 10;
      T.speed = clamp(Math.round((p.ias * KMH) / 10) * 10 / KMH, minSpd(p), maxSpd(p));
      af.athr = true;
      toast(`Автопилот: курс ${N.fmtHdg(T.heading)} · ${fmtAlt(T.alt)} · ${kmh(T.speed)} км/ч. Двинешь ручку — отключится`, 'good');
    } else if (mode === 'nav') {
      const d = af.destination;
      T.alt = navAlt(p, d);
      T.speed = clamp(Math.round((p.spec.vCruise * KMH) / 10) * 10 / KMH, minSpd(p), maxSpd(p));
      T.heading = N.bearing(p.pos.x, p.pos.z, d.x, d.z);
      af.athr = true; arrived = false;
      toast(`Автопилот ведёт к цели: ${d.name}, высота ${fmtAlt(T.alt)}`, 'good');
    } else {
      af.athr = true;
      if (!af.destination || af.destination.airportId !== A.airport.id) setDest(A.airport.id);
      const wi = N.windInfo(G.world), wx = N.weatherInfo(G.world);
      radio(cs(), `${A.tower}, ${cs()}, прошу заход на посадку`);
      radio(A.tower, `${cs()}, ${A.tower}, заход по приборам разрешаю, полоса ${A.name}, ${wi.text}, давление ${wx.qnh}`);
      toast('Автопосадка: самолёт сам зайдёт и сядет. Возьми ручку — управление вернётся к тебе', 'good');
    }
    if (G.input && G.input.haptic) G.input.haptic(15);
    changed();
    return true;
  }

  function disengage(msg, kind) {
    armed = null;
    if (!af.active) return;
    const p = G.player;
    if (p && G.input) {
      if (af.athr || af.mode === 'approach') G.input.setThrottle(p.controls.throttle); // РУД остаётся там, где его держал автомат
      apReset(p);
    }
    af.active = false; af.mode = null; af.approach = null; af.terrain = false;
    if (msg) toast(msg, kind || 'info');
    if (G.input && G.input.haptic) G.input.haptic([20, 40, 20]);
    changed();
  }

  function setDest(id) {
    const a = id ? G.world.airportById[id] : null;
    af.destination = a ? { airportId: a.id, name: N.aptName(a), x: a.x, z: a.z } : null;
    return a;
  }

  // ---------------- шаг автопилота ----------------
  function step(p, dt) {
    const c = p.controls, inp = G.input;
    // игрок двинул РУД: автомат тяги отдаёт тягу пилоту (автопосадка — целиком)
    if (lastThr >= 0 && Math.abs(inp.state.throttle - lastThr) > 0.03) {
      if (af.mode === 'approach') { disengage('Автопосадка отключена — управление у тебя', 'warn'); return; }
      if (af.athr) { af.athr = false; toast('Автомат тяги отключён — тягой управляешь ты (кнопки скорости ± включат его снова)', 'info'); changed(); }
    }
    if (af.mode !== 'approach' && p.stalled) { disengage('Автопилот отключён: сваливание! Нос вниз, РУД вперёд', 'bad'); return; }
    if (af.mode === 'hold') {
      if (p.onGround || (p.agl < 25 && p.vs < 0)) { disengage('Автопилот отключён: мало высоты — управляй сам', 'warn'); return; }
      const floor = terrainFloor(p, 120, 20);
      af.terrain = floor > T.alt + 5;
      setTgt(T.heading, Math.max(T.alt, floor), af.athr ? T.speed : undefined);
      apHold(p, tgt, dt);
    } else if (af.mode === 'nav') navStep(p, dt);
    else approachStep(p, dt);
    if (!af.active) return;
    if (af.athr || af.mode === 'approach') inp.setThrottle(c.throttle); // рукоятка РУД на экране ходит за автоматом
    lastThr = inp.state.throttle;
  }

  function navStep(p, dt) {
    const d = af.destination;
    if (!d) { disengage('Автопилот: маршрут сброшен', 'info'); return; }
    if (p.onGround || (p.agl < 25 && p.vs < 0)) { disengage('Автопилот отключён: мало высоты — управляй сам', 'warn'); return; }
    const dist = dist2(p, d.x, d.z);
    const floor = terrainFloor(p, 200, 30);
    af.terrain = floor > T.alt + 5;
    const alt = Math.max(T.alt, floor);
    const R = clamp(p.tas * 40, 2000, 5000);
    if (!arrived && dist < R * 1.15) {
      arrived = true;
      const a = G.world.airportById[d.airportId];
      if (a && free()) radio(N.towerName(a), `${cs()}, вы над аэродромом. Для посадки нажмите «Посадка»`);
      toast(`Мы над целью: ${d.name}. Кружу над аэродромом — нажми «Посадка», и автопилот посадит самолёт`, 'good');
      changed();
    }
    if (!arrived) {
      if (af.athr) apFlyTo(p, { x: d.x, y: alt, z: d.z, speed: T.speed }, dt);
      else {
        let h = N.bearing(p.pos.x, p.pos.z, d.x, d.z);
        if (p.gs > 12) h += clamp(wrapPi(p.heading - Math.atan2(p.vel.x, -p.vel.z)), -0.5, 0.5);
        setTgt(h, alt, undefined); apHold(p, tgt, dt);
      }
      T.heading = N.bearing(p.pos.x, p.pos.z, d.x, d.z);
    } else {
      // круг над аэродромом правым разворотом
      const brg = N.bearing(p.pos.x, p.pos.z, d.x, d.z);
      const corr = clamp((dist - R) / R, -1, 1) * 60 * DEG;
      const h = brg - (90 * DEG - corr);
      setTgt(h, alt, af.athr ? T.speed : undefined);
      apHold(p, tgt, dt);
      T.heading = h;
    }
  }

  function approachStep(p, dt) {
    const A = af.approach, a = A.airport;
    A.t += dt;
    if (A.phase === 'enroute') {
      if (p.onGround) { disengage(); return; }
      const floor = terrainFloor(p, 200, 30);
      const alt = Math.max(floor, a.elevation + 700);
      apFlyTo(p, { x: A.rs.x, y: alt, z: A.rs.z, speed: Math.min(p.spec.vCruise, 2 * p.spec.vApproach) }, dt);
      T.heading = N.bearing(p.pos.x, p.pos.z, a.x, a.z);
      if (dist2(p, a.x, a.z) < 11000) { A.phase = 'approach'; changed(); }
      return;
    }
    const ph = apLand(p, A.rs, dt, { world: G.world });
    const L = p.ap && p.ap.land;
    if (L) A.s = -((p.pos.x - L.tx) * L.dx + (p.pos.z - L.tz) * L.dz);
    if (ph !== A.phase) { onPhase(p, A, ph); A.phase = ph; changed(); }
    if (!af.active) return;
    const talk = free();
    if (L && ph === 'final' && talk) {
      const hT = L.elev + p.spec.gearHeight + Math.min(A.s + L.aim, L.df + L.aim) * Math.tan(L.glide);
      if (!A.said.gs && A.s < 7500 && A.s > 2700 && (Math.abs(p.alt - hT) < 30 || A.s < 4000)) {
        A.said.gs = true;
        const e = p.alt - hT;
        radio(A.tower, `${cs()}, на курсе, ${Math.abs(e) < 30 ? 'на глиссаде' : e > 0 ? 'выше глиссады' : 'ниже глиссады'}, удаление ${N.fmtKm(A.s)}`);
      }
      if (!A.said.clr && A.s < 2500) {
        A.said.clr = true;
        const tr = traffic(a, 2500, 0);
        radio(A.tower, tr && tr.onRw ? `${cs()}, полоса ${A.name} занята — ${tr.name} на пробеге. Посадку разрешаю после него` : `${cs()}, полоса ${A.name} свободна, посадку разрешаю`);
      }
    }
    // автопилот сам выпускает шасси и закрылки — рассказываем об этом
    if (p.gearDown !== A.gear) { A.gear = p.gearDown; if (p.spec.retract) toast(p.gearDown ? 'Автопилот: шасси выпущено' : 'Автопилот: шасси убрано'); }
    const f = Math.round(p.flaps * 2);
    if (f !== A.flaps) { A.flaps = f; if (p.spec.flaps) toast(`Автопилот: закрылки ${f}`); }
  }

  function onPhase(p, A, ph) {
    const talk = free();
    if (ph === 'final' && !A.said.final) {
      A.said.final = true;
      if (talk) radio(A.tower, `${cs()}, выход на посадочную прямую полосы ${A.name}, снижение по глиссаде`);
    } else if (ph === 'goaround') {
      A.said.gs = A.said.clr = A.said.final = false;
      if (talk) radio(A.tower, `${cs()}, уход на второй круг, набор по схеме`);
      toast('Уход на второй круг — заход не получился, автопилот попробует ещё раз', 'warn');
    } else if (ph === 'rollout' && !A.said.roll) {
      A.said.roll = true;
      if (talk) radio(A.tower, `${cs()}, посадка в ${hhmm()}, освобождайте полосу. Добро пожаловать!`);
    } else if (ph === 'stopped') {
      G.input.setThrottle(0);
      p.controls.throttle = 0;
      disengage(`Автопосадка выполнена — самолёт остановился.${Math.random() < 0.35 ? ' Три-хо-хо!' : ''}`, 'good');
    }
  }

  // ---------------- руление ----------------
  function startTaxi(p) {
    const n = G.world.nearestAirport(p.pos.x, p.pos.z);
    const a = n.airport;
    if (!a || !a.runways || a.kind === 'carrier') return;
    const sel = N.bestRunway(a, G.world, p.spec);
    const r = N.taxiRoute(G.world, a, p.pos.x, p.pos.z, sel);
    af.taxi = { airport: a, points: r.points, idx: 0, name: r.name, start: r.start, done: false, left: 0, bearing: 0, fast: false, elev: a.elevation };
  }
  function taxiStep(p) {
    const X = af.taxi;
    if (!X || X.done) return;
    if (!p.onGround) { X.done = true; changed(); return; }
    let pt = X.points[X.idx];
    let d = dist2(p, pt.x, pt.z);
    const last = X.idx === X.points.length - 1;
    if (!last) {
      // точка пройдена: близко или уже позади по направлению участка
      const prev = X.idx ? X.points[X.idx - 1] : null;
      let passed = d < 22;
      if (!passed && prev && d < 70) {
        const sx = pt.x - prev.x, sz = pt.z - prev.z;
        passed = (p.pos.x - pt.x) * sx + (p.pos.z - pt.z) * sz > 0;
      }
      if (passed) { X.idx++; pt = X.points[X.idx]; d = dist2(p, pt.x, pt.z); }
    } else if (d < 35) {
      X.done = true;
      toast(`Ты на исполнительном старте полосы ${X.name}. Запроси взлёт — кнопка «Вышка»`, 'good');
      changed();
      return;
    }
    let rem = d;
    for (let i = X.idx; i < X.points.length - 1; i++) rem += Math.hypot(X.points[i + 1].x - X.points[i].x, X.points[i + 1].z - X.points[i].z);
    X.left = rem;
    X.bearing = N.bearing(p.pos.x, p.pos.z, pt.x, pt.z);
    X.fast = p.gs > 9.5;
  }

  // ---------------- вышка ----------------
  function towerAction() {
    const p = G.player;
    if (!free() || !p || !p.alive || G.time.sim - tw.lastReq < 1.5) return null;
    if (p.onGround) {
      if (p.gs > 12) return null;
      let a = p.airport;
      if (!a) { const n = G.world.nearestAirport(p.pos.x, p.pos.z); a = n.dist < 3000 ? n.airport : null; }
      if (!a || a.kind === 'carrier') return null;
      if (af.taxi && !af.taxi.done && !tw.taxi) return { id: 'taxi', a, label: 'руление' };
      if (!tw.takeoff && tw.pendT <= 0) return { id: 'takeoff', a, label: 'взлёт' };
      return null;
    }
    if (p.airTime < 40 || p.agl > 4000) return null;
    const a = pickAirport(p, null, 25000);
    if (!a || a.kind === 'carrier' || dist2(p, a.x, a.z) > 30000) return null;
    if (tw.landing && tw.landing.apt === a) return null;
    return { id: 'landing', a, label: 'посадка' };
  }

  function requestTower() {
    const p = G.player, act = towerAction();
    if (!act) return false;
    const a = act.a, tn = N.towerName(a), me = cs();
    const wi = N.windInfo(G.world), wx = N.weatherInfo(G.world);
    tw.lastReq = G.time.sim;
    if (act.id === 'taxi') {
      tw.taxi = true;
      radio(me, `${tn}, ${me}, на стоянке, прошу руление`);
      radio(tn, `${me}, ${tn}, руление к полосе ${af.taxi.name} разрешаю, ${wi.text}, давление ${wx.qnh}. Следуйте по оранжевым меткам`);
    } else if (act.id === 'takeoff') {
      const under = N.runwayUnder(p);
      // на полосе — тот торец, куда смотрит нос; после руления — назначенный вышкой
      const sel = af.taxi && af.taxi.airport === a ? { name: af.taxi.name } : under || N.bestRunway(a, G.world, p.spec);
      radio(me, `${tn}, ${me}, ${under ? 'на исполнительном, к взлёту готов' : 'прошу взлёт'}`);
      const tr = traffic(a, 7000, 700);
      if (tr) {
        tw.pendT = 22; tw.pendA = a; tw.pendRw = sel.name;
        radio(tn, `${me}, ожидайте: ${tr.name} ${tr.onRw ? 'на полосе' : 'на посадочной прямой'}`);
      } else {
        tw.takeoff = true;
        radio(tn, under
          ? `${me}, ${tn}, полоса ${sel.name}, ${wi.text}, взлёт разрешаю`
          : `${me}, ${tn}, выруливайте на полосу ${sel.name}, ${wi.text}, взлёт по готовности разрешаю`);
      }
    } else {
      const sel = N.bestRunway(a, G.world, p.spec);
      tw.landing = { apt: a, rw: sel };
      setDest(a.id); changed();
      radio(me, `${tn}, ${me}, прошу посадку`);
      radio(tn, `${me}, ${tn}, посадка полоса ${sel.name}, ${wi.text}, давление ${wx.qnh}, ${wx.visText}. Заход разрешаю`);
      const tr = traffic(a, 12000, 1200);
      if (tr) radio(tn, `${me}, внимание: впереди ${tr.name} ${tr.onRw ? 'на полосе' : 'заходит на посадку'}, вы номер два`);
      toast(`Пункт назначения: ${N.aptName(a)}, полоса ${sel.name}`, 'info');
    }
    if (G.input && G.input.haptic) G.input.haptic(10);
    changed();
    return true;
  }

  function towerStep(p, dt) {
    if (tw.pendT > 0) {
      tw.pendT -= dt;
      const tr = tw.pendA ? traffic(tw.pendA, 7000, 700) : null;
      if (tw.pendT <= 0 || (!tr && tw.pendT < 18)) {
        tw.pendT = 0; tw.takeoff = true;
        if (free() && tw.pendA) radio(N.towerName(tw.pendA), `${cs()}, полоса ${tw.pendRw} свободна, ${N.windInfo(G.world).text}, взлёт разрешаю`);
        changed();
      }
    }
  }

  // ---------------- чек-листы ----------------
  const CHECK = [
    {
      id: 'before_to',
      when: (p) => p.onGround && p.spec.flaps && p.surface === 'runway' && p.gs < 20 && Math.round(p.flaps * 2) === 0,
      done: (p) => !p.onGround || p.flaps >= 0.5,
      text: () => 'Перед взлётом: закрылки 1 (кнопка «Закрылки»)',
    },
    {
      id: 'after_to',
      when: (p) => !p.onGround && p.airTime > 4 && p.airTime < 120 && p.agl > 60 && p.vs > 0 && ((p.spec.retract && p.gearDown) || p.flaps > 0),
      done: (p) => p.onGround || ((!p.spec.retract || !p.gearDown) && p.flaps === 0),
      text: (p) => 'После взлёта: ' + [p.spec.retract && p.gearDown ? 'убери шасси' : '', p.flaps > 0 ? 'убери закрылки' : ''].filter(Boolean).join(', '),
    },
    {
      id: 'before_land',
      when: (p) => {
        if (p.onGround || p.airTime < 60 || p.agl > 450 || p.vs > -1) return false;
        const n = G.world.nearestAirport(p.pos.x, p.pos.z);
        return n.dist < 7000 && ((p.spec.retract && !p.gearDown) || (p.spec.flaps && p.flaps < 1));
      },
      done: (p) => p.onGround || ((!p.spec.retract || p.gearDown) && (!p.spec.flaps || p.flaps >= 1)),
      text: (p) => 'Перед посадкой: ' + [p.spec.retract ? (p.gearDown ? 'шасси выпущено ✓' : 'выпусти шасси') : '', p.spec.flaps ? (p.flaps >= 1 ? 'закрылки 2 ✓' : 'закрылки 2') : ''].filter(Boolean).join(', '),
    },
    {
      id: 'after_land',
      when: (p) => ck.landed && p.onGround && p.gs < 22 && (p.flaps > 0 || G.input.state.throttle > 0.3),
      done: (p) => !p.onGround || (p.flaps === 0 && G.input.state.throttle <= 0.3),
      text: (p) => 'После посадки: ' + [p.flaps > 0 ? 'убери закрылки' : '', G.input.state.throttle > 0.3 ? 'РУД — малый газ' : ''].filter(Boolean).join(', '),
    },
  ];
  function checkStep(p, dt) {
    ck.acc += dt;
    if (ck.acc < 0.25) return;
    const h = ck.acc; ck.acc = 0;
    const on = G.profile.settings.checklists !== false && free() && !af.active;
    if (!on) { if (ck.cur) { ck.cur = null; changed(); } return; }
    if (ck.cur) {
      ck.t += h;
      if (ck.cur.done(p)) { toast('Чек-лист выполнен', 'good'); ck.cur = null; ck.next = simT + 20; changed(); }
      else if (ck.t > 30) { ck.cur = null; ck.next = simT + 20; changed(); }
      else {
        // напоминание повторяется, пока пункт не выполнен (не чаще раза в 10 с, до трёх раз)
        const t = ck.cur.text(p);
        if (t !== af.checklist.text || (ck.t - ck.said > 10 && ck.n < 3)) { af.checklist.text = t; ck.said = ck.t; ck.n++; toast('Чек-лист · ' + t, 'warn'); }
      }
      return;
    }
    if (simT < ck.next) return;
    for (const it of CHECK) {
      if (ck.shown[it.id] || !it.when(p)) continue;
      ck.shown[it.id] = true; ck.cur = it; ck.t = 0; ck.said = 0; ck.n = 1;
      af.checklist.text = it.text(p);
      toast('Чек-лист · ' + af.checklist.text, 'warn');
      changed();
      break;
    }
  }

  // ---------------- состояние для панели ----------------
  function approachAirport() {
    const p = G.player;
    if (!p || !p.alive || p.onGround) return null;
    const a = pickAirport(p, null, 30000);
    return a && a.kind !== 'carrier' && dist2(p, a.x, a.z) < 30000 ? a : null;
  }
  function status() {
    const p = G.player, A = af.approach;
    if (!af.active || !p) return null;
    if (af.mode === 'approach') {
      const ph = A.phase === 'final' && A.s > 0 ? `${PHASE.final} · ${N.fmtKm(A.s)}` : PHASE[A.phase] || A.phase;
      return { title: `АВТОПОСАДКА · ${N.aptName(A.airport)} ${A.name}`, phase: ph[0].toUpperCase() + ph.slice(1), cols: false };
    }
    const sum = `курс ${N.fmtHdg(T.heading)} · ${fmtAlt(T.alt)} · ${af.athr ? kmh(T.speed) + ' км/ч' : 'тяга вручную'}`;
    const title = af.mode === 'nav' ? `АП → ${af.destination ? af.destination.name : ''}` : 'АП · УДЕРЖАНИЕ';
    let phase = null;
    if (af.terrain) phase = 'Обхожу рельеф — набираю высоту';
    else if (af.mode === 'nav' && arrived) phase = 'Кружу над аэродромом — нажми «Посадка»';
    return { title, sum, phase, cols: true, hdgAuto: af.mode === 'nav' };
  }

  function changed() {
    G.bus.emit('autoflight:changed', { active: af.active, mode: af.mode });
    uiAcc = 1;
  }

  function reset() {
    af.active = false; af.mode = null; af.destination = null; af.approach = null; af.taxi = null; af.terrain = false;
    af.checklist.text = '';
    armed = null; arrived = false; engagedT = 0; lastThr = -1; simT = 0; floorT = -1;
    tw.taxi = tw.takeoff = false; tw.landing = null; tw.pendT = 0; tw.pendA = null; tw.lastReq = -1e9;
    ck.cur = null; ck.t = 0; ck.next = 6; ck.shown = {}; ck.landed = false;
  }

  const af = {
    active: false,
    mode: null,
    destination: null,
    target: T,
    athr: true,
    approach: null,
    taxi: null,
    terrain: false,
    checklist: { text: '' },
    get armed() { return armed; },
    engage,
    disengage(msg, kind) { disengage(msg, kind); },
    setDestination(id) {
      const a = setDest(id);
      if (!a) { armed = null; if (af.active && af.mode === 'nav') disengage('Автопилот: маршрут сброшен', 'info'); }
      else if (af.active && af.mode === 'nav' && G.player) { arrived = false; T.alt = navAlt(G.player, af.destination); }
      changed();
    },
    adjust(k, dir) {
      const p = G.player;
      if (!af.active || !p || af.mode === 'approach') return;
      dir = dir > 0 ? 1 : -1;
      if (k === 'hdg' && af.mode === 'hold') T.heading = ((T.heading + dir * 10 * DEG) % TAU + TAU) % TAU;
      else if (k === 'alt') T.alt = clamp(Math.round((T.alt + dir * 100) / 10) * 10, Math.round(p.alt - p.agl + 60), (p.spec.ceiling || 8000));
      else if (k === 'spd') { T.speed = clamp(T.speed + (dir * 10) / KMH, minSpd(p), maxSpd(p)); af.athr = true; lastThr = -1; }
      else return;
      if (G.input && G.input.haptic) G.input.haptic(6);
      changed();
    },
    towerAction,
    requestTower,
    approachAirport,
    status,
    hideChecklists() {
      G.profile.settings.checklists = false;
      saveProfile(G.profile);
      ck.cur = null; af.checklist.text = '';
      toast('Подсказки чек-листа выключены', 'info');
      changed();
    },
    get checkOn() { return !!ck.cur; },
    update(dt) {
      if (G.mode !== 'flight') return;
      simT += dt;
      const p = G.player;
      if (!p || !p.alive) {
        if (af.active) { af.active = false; af.mode = null; af.approach = null; changed(); }
        armed = null;
      } else {
        if (armed === 'nav' && !af.active && !p.onGround && p.agl > 150 && af.destination) engage('nav', { silent: true });
        if (af.active) {
          engagedT += dt;
          const st = G.input.state;
          // заметное движение ручки — пилот берёт управление (как кнопка отключения на штурвале)
          if (engagedT > 0.4 && (Math.abs(st.pitch) > 0.3 || Math.abs(st.roll) > 0.3)) disengage('Автопилот отключён — управление у тебя', 'warn');
          else step(p, dt);
        }
        taxiStep(p);
        towerStep(p, dt);
        checkStep(p, dt);
      }
      ui.dots(p);
      uiAcc += dt;
      if (uiAcc >= 0.1) { uiAcc = 0; ui.update(p); }
    },
  };

  const ui = createAfUi(G, af);

  G.bus.on('flight:start', (e) => {
    reset();
    const p = e && e.ac;
    const s = e && e.session;
    if (p && s && s.parking != null && s.parking !== false && !s.missionId && p.onGround) {
      startTaxi(p);
      if (af.taxi) toast(`Рули к полосе ${af.taxi.name} по оранжевым меткам: РУД чуть вперёд, ручка влево-вправо — поворот`, 'info');
    }
    ui.reset();
    changed();
  });
  const off = () => { reset(); ui.hide(); };
  G.bus.on('flight:end', off);
  G.bus.on('menu:show', off);
  G.bus.on('pause', () => { uiAcc = 1; ui.update(G.player); });
  G.bus.on('ac:crash', (e) => { if (e && e.ac === G.player) disengage(); });
  G.bus.on('ac:takeoff', (e) => {
    if (!e || e.ac !== G.player) return;
    tw.takeoff = false; tw.taxi = false; tw.pendT = 0;
    if (af.taxi) af.taxi.done = true;
    ck.shown.after_to = false; ck.shown.before_land = false; ck.landed = false;
    changed();
  });
  G.bus.on('ac:touchdown', (e) => {
    if (!e || e.ac !== G.player || (e.bounce > 0)) return;
    tw.landing = null; tw.takeoff = false;
    ck.landed = true; ck.shown.before_to = false; ck.shown.after_land = false;
  });
  G.bus.on('resize', () => ui.relayout());
  G.bus.on('settings:changed', () => ui.relayout());
  return af;
}
