// ПОРУЧЕНИЯ ВЫШКИ в свободном полёте — ответ на «а что делать?». Раз в пару минут вышка предлагает короткое дело
// по ситуации (слетать к ориентиру и вернуться, сесть на соседнем аэродроме, сделать бочку, пройти на бреющем над полосой,
// найти новое место). Карточка с кнопками «Беру» / «Не сейчас»; кнопка «Чем заняться?» — предложить сразу.
// Принял — маркер, карточка задачи (через G.hud: card()), по выполнении — небольшая награда (G.career.addReward) и похвала.
// Создаётся в missions/index.js (G.missions.errands), update(dt) — из G.missions.update на каждом шаге симуляции.
import { dist2, fmtDist, towerName } from './lib.js';

const FIRST = 40;       // с полёта до первого предложения
const EVERY = 120;      // с между предложениями
const AFTER_NO = 200;   // пауза после «Не сейчас»
const OFFER_LIFE = 35;  // с — предложение само уходит
const EXPIRE = 9 * 60;  // поручение отменяется, если тянется дольше

export function createErrands(G) {
  const W = () => G.world;
  let t = 0, nextT = FIRST, offerT = 0, seq = 0, typeIdx = 0;
  let offer = null, task = null, mk = null;
  const subs = [];

  const free = () => G.mode === 'flight' && !G.paused && G.flight && !G.flight.ended && !G.flight.session.missionId && !(G.missions && G.missions.active) && G.player && G.player.alive;
  const cs = () => (G.profile && G.profile.callsign) || 'Корвет';
  const ac = () => G.player;
  const nearAp = () => { const n = W().nearestAirport(ac().pos.x, ac().pos.z); return n && n.airport; };
  const tower = () => { const a = nearAp(); return a ? towerName(W(), a.id) : 'Вышка'; };
  const say = (text, from) => G.bus.emit('radio', { from: from || tower(), text });

  // ---------- виды поручений ----------
  // каждый: make() -> null | { type, title, offer, how(), progress(), markers(), done(dt) -> bool, reward, praise }
  const KINDS = {
    // слетать к ориентиру и вернуться к аэродрому
    poi() {
      const a = ac(), home = nearAp();
      if (!home) return null;
      const list = W().pois.filter((p) => { const d = dist2(a.pos.x, a.pos.z, p.x, p.z); return d > 3500 && d < 14000; });
      if (!list.length) return null;
      const p = list[(seq * 7) % list.length];
      let back = false;
      const goal = () => (back ? home : p);
      return {
        type: 'poi', title: `К ориентиру «${p.name}» и назад`, reward: { money: 220, xp: 40 },
        offer: `${cs()}, слетай к ориентиру «${p.name}» и вернись к аэродрому ${home.name}. Посмотришь сверху, как там.`,
        how: () => (back
          ? `Отлично, «${p.name}» позади! Теперь назад: лети к зелёной метке «${home.name}» — садиться не обязательно, пройди над аэродромом.`
          : `Лети к оранжевому ромбу «ЛЕТИ СЮДА · ${p.name}». Не видно — у края экрана стрелка: наклони ручку в её сторону.`),
        progress: () => { const g = goal(), d = dist2(ac().pos.x, ac().pos.z, g.x, g.z); return { value: back ? 1 : 0.5 * Math.max(0, 1 - d / 14000), max: 1, text: `${back ? home.name : p.name}: ${fmtDist(d)}` }; },
        markers: () => (back ? [{ x: home.x, y: home.elevation + 60, z: home.z, kind: 'airport', label: home.name }] : [{ x: p.x, z: p.z, kind: 'waypoint', label: p.name }]),
        done() {
          const g = goal(), d = dist2(ac().pos.x, ac().pos.z, g.x, g.z);
          if (!back && d < 900) { back = true; mk = null; say(`${cs()}, вижу тебя над «${p.name}». Теперь домой, к ${home.name}.`); return false; }
          return back && d < 1500;
        },
        praise: `${cs()}, с возвращением! Слетал как по нитке.`,
      };
    },
    // сесть на соседнем аэродроме
    land() {
      const a = ac(), here = nearAp();
      const list = W().airports.filter((ap) => ap.kind !== 'carrier' && (!here || ap.id !== here.id || dist2(a.pos.x, a.pos.z, ap.x, ap.z) > 6000))
        .map((ap) => ({ ap, d: dist2(a.pos.x, a.pos.z, ap.x, ap.z) })).filter((o) => o.d > 3000 && o.d < 26000).sort((x, y) => x.d - y.d);
      if (!list.length) return null;
      const ap = list[seq % Math.min(2, list.length)].ap;
      let ok = false;
      return {
        type: 'land', title: `Посадка: ${ap.name}`, reward: { money: 320, xp: 60 }, from: towerName(W(), ap.id),
        offer: `${cs()}, ${towerName(W(), ap.id)} приглашает: сядь у нас, ${ap.name}. Полоса свободна.`,
        how: () => {
          const p = ac(), d = dist2(p.pos.x, p.pos.z, ap.x, ap.z);
          if (p.onGround) return 'Ты на земле! Держи ТОРМОЗ, РУД вниз до упора — до полной остановки.';
          if (d > 6000) return `Лети к зелёной метке «ПОСАДКА · ${ap.name}». Ближе к полосе — шасси, закрылки, газ поменьше.`;
          return 'Заходи на полосу по подсказке внизу экрана («на глиссаде»). Шасси выпущены? Над полосой — РУД вниз, ручку чуть на себя.';
        },
        progress: () => { const d = dist2(ac().pos.x, ac().pos.z, ap.x, ap.z); return { value: Math.max(0, 26000 - d), max: 26000, text: `до полосы ${fmtDist(d)}` }; },
        markers: () => [{ x: ap.x, y: ap.elevation + 40, z: ap.z, kind: 'airport', label: ap.name }],
        ctl: () => { const p = ac(); return p.onGround && p.ias > 2 ? 'brake' : !p.onGround && p.spec.retract && !p.gearDown && dist2(p.pos.x, p.pos.z, ap.x, ap.z) < 6000 ? 'gear' : null; },
        on: { 'ac:stopped': (e) => { if (e && e.ac === ac() && e.airport && e.airport.id === ap.id) ok = true; } },
        done: () => ok,
        praise: `${cs()}, с посадкой! Добро пожаловать, ${ap.name}.`,
      };
    },
    // фигура пилотажа: бочка (петля — для пилотажных)
    trick() {
      const a = ac();
      if (a.onGround || a.agl < 350 || (a.spec.maxG || 0) < 4.5) return null;
      const id = a.spec.maxG >= 6 && seq % 2 ? 'loop' : 'roll';
      const name = id === 'loop' ? 'мёртвую петлю' : 'бочку';
      let ok = false;
      return {
        type: 'trick', title: id === 'loop' ? 'Мёртвая петля' : 'Бочка', reward: { money: 150, xp: 30 },
        offer: `${cs()}, у нас зрители на вышке! Покажи ${name}?`,
        how: () => (id === 'loop'
          ? 'Разгонись (РУД вверх до упора), потом потяни ручку на себя до упора (палец вниз) и держи до самого низа петли.'
          : 'Ручку до упора вбок и держи, пока самолёт не обернётся вокруг себя. Потом — ручку в центр.'),
        progress: () => { const p = G.aerobatics && G.aerobatics.progress ? G.aerobatics.progress(id) : null; return p ? { value: p.value, max: p.max, text: p.text } : null; },
        hint: () => { const p = G.aerobatics && G.aerobatics.progress ? G.aerobatics.progress(id) : null; return p ? p.hint : ''; },
        ctl: () => (id === 'loop' ? 'stick-back' : 'stick'),
        markers: () => [],
        on: { 'trick:done': (e) => { if (e && e.ac === ac() && (e.id === id || (id === 'roll' && (e.id === 'roll2' || e.id === 'lowroll')))) ok = true; } },
        done: () => ok,
        praise: `${cs()}, вышка аплодирует! Красиво.`,
      };
    },
    // бреющий проход над полосой
    lowpass() {
      const a = ac();
      if (a.onGround) return null;
      const list = W().airports.filter((ap) => ap.kind !== 'carrier' && ap.runways && ap.runways.length && dist2(a.pos.x, a.pos.z, ap.x, ap.z) < 16000);
      if (!list.length) return null;
      const ap = list[seq % list.length], rw = ap.runways[0];
      let over = 0;
      return {
        type: 'lowpass', title: `Проход над полосой: ${ap.name}`, reward: { money: 200, xp: 40 }, from: towerName(W(), ap.id),
        offer: `${cs()}, пройди на бреющем над полосой ${ap.name} — ниже 30 метров, но не садись. Мы посмотрим!`,
        how: () => 'Лети к метке «ПОСАДКА», снизься над полосой до 10–30 м и пролети вдоль неё, не касаясь колёсами. Потом — ручку на себя, вверх.',
        progress: () => {
          const p = ac(), d = dist2(p.pos.x, p.pos.z, rw.cx, rw.cz);
          return { value: over, max: 2, text: d > rw.length * 0.6 ? `до полосы ${fmtDist(d)} · высота ${Math.round(p.agl)} м` : `высота ${Math.round(p.agl)} м${p.agl > 30 ? ' — ниже!' : ' — так держать!'}` };
        },
        markers: () => [{ x: rw.cx, y: ap.elevation + 15, z: rw.cz, kind: 'airport', label: ap.name }],
        done(dt) {
          const p = ac();
          const g = W().groundAt(p.pos.x, p.pos.z);
          if (!p.onGround && p.agl < 32 && p.agl > 2 && g.airport && g.airport.id === ap.id && (g.surface === 'runway' || g.runway)) over += dt; else if (over < 2) over = Math.max(0, over - dt * 0.5);
          return over >= 2;
        },
        praise: `${cs()}, вот это проход! Чуть фуражки не сдуло.`,
      };
    },
    // найти место, где ещё не был (открытие места засчитывает карьера, мы — добавляем поручение)
    explore() {
      const a = ac(), places = (G.profile && G.profile.places) || {};
      const list = W().pois.filter((p) => !places[p.id]).map((p) => ({ p, d: dist2(a.pos.x, a.pos.z, p.x, p.z) })).filter((o) => o.d > 2500 && o.d < 22000).sort((x, y) => x.d - y.d);
      if (!list.length) return null;
      const p = list[0].p;
      return {
        type: 'explore', title: `Новое место: ${p.name}`, reward: { money: 180, xp: 40 },
        offer: `${cs()}, а ты ещё не видел «${p.name}». Слетай — не пожалеешь!`,
        how: () => `Лети к оранжевому ромбу «${p.name}». Подлетишь ближе 1,5 км — место откроется на карте.`,
        progress: () => { const d = dist2(ac().pos.x, ac().pos.z, p.x, p.z); return { value: Math.max(0, 22000 - d), max: 22000, text: `до места ${fmtDist(d)}` }; },
        markers: () => [{ x: p.x, z: p.z, kind: 'waypoint', label: p.name }],
        done: () => dist2(ac().pos.x, ac().pos.z, p.x, p.z) < 1400,
        praise: `${cs()}, ну как там, «${p.name}»? Красота же!`,
      };
    },
  };
  const ORDER = ['poi', 'trick', 'land', 'explore', 'lowpass'];

  function pick() {
    const a = ac();
    const order = a.onGround ? ['poi', 'explore', 'land'] : ORDER;
    for (let i = 0; i < order.length; i++) {
      const k = order[(typeIdx + i) % order.length];
      const e = KINDS[k]();
      if (e) { typeIdx = (typeIdx + i + 1) % order.length; seq++; return e; }
    }
    return null;
  }
  function makeOffer() {
    const e = pick();
    if (!e) { nextT = t + 30; return false; }
    offer = e;
    offerT = t;
    say(e.offer, e.from);
    G.audio?.play?.('ui_tick');
    return true;
  }
  function accept() {
    if (!offer) return;
    task = offer;
    offer = null;
    task.t0 = t;
    task.key = 'errand:' + seq;
    for (const type of Object.keys(task.on || {})) subs.push(G.bus.on(type, task.on[type]));
    say(`${cs()}, принято. Жду!`, task.from);
    mk = null;
  }
  function decline() {
    offer = null;
    nextT = t + AFTER_NO;
  }
  function endTask() {
    for (const u of subs) u();
    subs.length = 0;
    task = null;
    mk = null;
    G.hud?.setMarkers?.([]);
    nextT = t + EVERY;
  }
  function finish() {
    const e = task;
    const trial = !!(G.flight && G.flight.session && G.flight.session.trial);
    if (!trial && G.career && G.career.addReward) G.career.addReward(e.reward);
    const hoho = Math.random() < 0.25 ? ' Три-хо-хо!' : '';
    say(e.praise + hoho, e.from);
    G.bus.emit('ui:toast', { text: trial ? 'Поручение выполнено' : `Поручение выполнено: +${e.reward.money} ₽, +${e.reward.xp} опыта`, kind: 'good' });
    G.audio?.play?.('ui_star');
    G.input?.haptic?.(30);
    G.bus.emit('errand:done', { type: e.type, reward: e.reward });
    endTask();
  }

  const onButton = (id) => {
    if (id === 'take') accept();
    else if (id === 'later') decline();
    else if (id === 'what') { if (!makeOffer()) G.bus.emit('ui:toast', { text: 'Сейчас вышке нечего предложить — просто полетай!', kind: 'info' }); }
  };

  const E = {
    get active() { return task; },
    get offer() { return offer; },
    offerNow: makeOffer,
    accept, decline,
    // карточка для HUD (ui/hud-guide.js)
    card() {
      if (!free()) return null;
      if (task) {
        return { kind: 'task', key: task.key, n: 0, total: 0, title: task.title, how: task.how(), progress: task.progress ? task.progress() : null,
          hint: task.hint ? task.hint() : '', ctl: task.ctl ? task.ctl() : null };
      }
      if (offer) {
        return { kind: 'offer', key: 'offer:' + seq, title: `${offer.from || tower()} · поручение`, how: `${offer.offer} Награда: ${offer.reward.money} ₽.`,
          buttons: [{ id: 'take', label: 'Беру', main: true }, { id: 'later', label: 'Не сейчас' }], onButton };
      }
      return { kind: 'idle', key: 'idle', title: 'Свободный полёт', buttons: [{ id: 'what', label: 'Чем заняться?' }], onButton };
    },
    update(dt) {
      if (!free()) return;
      t += dt;
      if (task) {
        const m = task.markers();
        if (!mk || m.length !== mk.length || (m[0] && mk[0] && (m[0].x !== mk[0].x || m[0].kind !== mk[0].kind))) { mk = m; G.hud?.setMarkers?.(m); }
        if (task.done(dt)) finish();
        else if (t - task.t0 > EXPIRE) { say(`${cs()}, ладно, поручение снимаю — в другой раз.`, task.from); endTask(); }
        return;
      }
      if (offer) { if (t - offerT > OFFER_LIFE) decline(); return; }
      if (t >= nextT && !G.player.onGround) { if (!makeOffer()) nextT = t + 30; }
    },
    reset() {
      for (const u of subs) u();
      subs.length = 0;
      t = 0; nextT = FIRST; offer = null; task = null; mk = null;
    },
  };
  G.bus.on('flight:start', () => E.reset());
  G.bus.on('flight:end', () => E.reset());
  return E;
}
