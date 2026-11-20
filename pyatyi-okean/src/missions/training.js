// Обучение: «Первый вылет», «Круг над Днестром», «Школа пилотажа».
import { S } from './engine.js';
import { DEG, rwPoint, finalPoint, windPhrase, rwNum, dist2, kmh, wrapPi } from './lib.js';

const INS = 'Инструктор';
const kmhOf = (ac) => ac.ias * 3.6;

// ---------------------------------------------------------------- 1. Первый вылет
export const firstFlight = {
  def: {
    id: 'first_flight', title: 'Первый вылет', category: 'training', plane: 'yak52', difficulty: 1, order: 1,
    from: 'yasny', to: 'yasny', reward: { money: 500, xp: 100 },
    brief: 'Утро в Тирасполе, на стоянке ждёт учебный Як-52. Инструктор поведёт вас за руку: разбег и отрыв, уборка шасси, полёт по «коробочке» над аэродромом по меткам, выпуск шасси и закрылков, заход по планкам и посадка. Подсказки — по радио, игра не останавливается.',
  },
  session: () => ({ airportId: 'yasny', runway: 0, end: 'A', timeOfDay: 8.5, weather: 'clear' }),
  freezeTime: true,
  build(m) {
    const ap = m.ap('yasny'), rw = ap.runways[0], H = rw.heading;
    const tw = m.tw('yasny');
    const p1 = rwPoint(rw, H, 2300, -1300), p2 = rwPoint(rw, H, -1900, -1500), p4 = finalPoint(ap, rw, H, 2200);
    const alt = (ac) => ac.alt - ap.elevation;
    m.data.lastPush = 0;
    return [
      {
        text: 'Дайте полный газ: РУД до упора',
        markers: [],
        enter(m) {
          m.tower('yasny', `${m.cs}, ${tw}. Полоса ${rwNum(H)}, ${windPhrase(m.world)}. Взлёт разрешаю. С первым вылетом!`);
          m.radio(INS, 'Я рядом. Рычаг газа — РУД, ползунок справа — плавно до упора вверх. Ручку пока не трогай.');
        },
        update: (m) => m.ac.controls.throttle > 0.85 || m.ac.throttle > 0.85,
      },
      {
        text: () => `Разбег. На ${kmh(m.ac.spec.vRotate)} км/ч плавно ручку на себя`,
        enter(m) { m.radio(INS, 'Пошли! Держи самолёт по осевой линии. Скорость растёт — смотри на прибор слева.'); },
        update(m) {
          const ac = m.ac;
          if (ac.onGround && ac.ias > ac.spec.vRotate * 0.95) m.hint('rot', INS, `Есть ${kmh(ac.spec.vRotate)}! Плавно ручку на себя — нос вверх.`, 8);
          if (ac.onGround && m.stepT > 25 && ac.throttle < 0.5) m.hint('thr', INS, 'Газ! РУД до упора, иначе не взлетим.', 12);
          return !ac.onGround && ac.agl > 5;
        },
      },
      {
        text: 'Уберите шасси',
        enter(m) { m.radio(INS, 'Есть отрыв! Молодец. Теперь убираем шасси — кнопка «Шасси».', { now: true }); },
        update(m) {
          if (m.stepT > 14) m.hint('gear', INS, 'Шасси! Убери шасси — так самолёт быстрее набирает скорость.', 14);
          return !m.ac.gearDown;
        },
      },
      S.reach({
        text: 'Набирайте 300 м и летите к точке 1', ...p1, y: ap.elevation + 300, label: '1', radius: 500,
        enter(m) { m.radio(INS, 'Шасси убраны. Набираем 300 метров и держим на первую точку — она на экране.'); },
        update(m) { if (alt(m.ac) > 420) m.hint('hi1', INS, 'Хватит набирать, держи около 300 метров — нос чуть ниже.', 15); },
      }),
      S.reach({
        text: 'Разворот влево к точке 2, высота 300 м', ...p2, y: ap.elevation + 300, label: '2', radius: 500,
        enter(m) { m.radio(INS, 'Плавный разворот влево, крен не больше 30 градусов. Полоса будет слева — это «коробочка».'); },
        update(m) {
          const a = alt(m.ac);
          if (a < 200) m.hint('lo2', INS, 'Низковато! Держи 300 метров, ручку чуть на себя.', 15);
          else if (a > 450) m.hint('hi2', INS, 'Высоковато, снижайся до 300.', 15);
          if (m.stepT > 30 && m.radioIdle()) m.hint('city', INS, 'Справа внизу — наш Тирасполь. Красиво, да? Но смотрим на приборы.', 999);
        },
      }),
      {
        text: 'Выпустите шасси и закрылки',
        markers: [{ ...p4, label: 'Вход в глиссаду', kind: 'waypoint' }],
        enter(m) { m.radio(INS, 'Готовимся к посадке: выпускай шасси, потом закрылки. Газ поменьше — скорость около 160.'); },
        update(m) {
          const ac = m.ac;
          if (m.stepT > 18) m.hint('cfg', INS, ac.gearDown ? 'Шасси вышли. Теперь закрылки — кнопка «Закрылки».' : 'Шасси! Кнопка «Шасси», потом закрылки.', 14);
          return ac.gearDown && ac.flaps > 0;
        },
      },
      S.reach({
        text: 'Выход на посадочную прямую', ...p4, label: 'Вход в глиссаду', radius: 550,
        enter(m) { m.radio(INS, 'Отлично. Разворачивайся на метку — так мы выйдем точно на ось полосы.'); },
        update(m) { if (m.ac.ias > m.ac.spec.vApproach * 1.45) m.hint('spd6', INS, 'Скорость велика — убери газ.', 15); },
      }),
      {
        text: 'Заход по планкам: держите подсказку «на глиссаде»',
        markers: [],
        enter(m) {
          m.tower('yasny', `${m.cs}, посадку разрешаю, полоса ${rwNum(H)}.`);
          m.radio(INS, 'Внизу экрана подсказка захода: «выше», «ниже», «левее». Держи «на глиссаде», газ — понемногу.');
        },
        update(m) {
          const ac = m.ac;
          if (!ac.onGround && ac.agl < 14 && ac.vs < -1.6) m.hint('flare', INS, 'Выравнивай! Газ — малый, ручку чуть на себя.', 6);
          if (!ac.gearDown && ac.agl < 150) m.hint('gearL', INS, 'Шасси! Без шасси не садимся!', 6);
        },
        on: { 'ac:touchdown': (m, e) => e.ac === m.ac && !e.crash && e.bounce === 0 && e.airport && e.airport.id === 'yasny' },
      },
      S.land('yasny', {
        text: 'Тормоз — до полной остановки',
        enter(m) {
          const td = m.td;
          m.radio(INS, td && td.vs < 1.5 ? 'Есть касание — мягко! Теперь тормоз и газ на малый.' : 'Касание! Газ малый, тормози.', { now: true });
        },
      }),
    ];
  },
  update(m) {
    // посадил раньше, чем дошёл до шага посадки — засчитываем посадку
    const ac = m.ac, i = m.index;
    if (i >= 3 && i < 7 && ac.onGround && ac.airport && ac.airport.id === 'yasny' && m.td && m.t - m.td.t < 3) m.goto(8);
  },
  onDone(m) {
    const st = m.landStars(m.landed.td, m.landed.bounces);
    const tw = m.tw('yasny');
    const word = st === 3 ? 'Три-хо-хо! Посадка как по учебнику.' : st === 2 ? 'Хорошая посадка.' : 'Сели — и это главное.';
    m.complete({
      stars: st, text: 'Первый самостоятельный круг над Тирасполем',
      radio: [tw, `${m.cs}, ${word} Поздравляю с первым вылетом!`],
    });
  },
};

// ---------------------------------------------------------------- 2. Круг над Днестром
export const dniesterCircle = {
  def: {
    id: 'dniester_circle', title: 'Круг над Днестром', category: 'training', plane: 'yak52', difficulty: 2, order: 2,
    from: 'yasny', to: 'gavan', reward: { money: 1000, xp: 180 }, requires: { missions: ['first_flight'] },
    brief: 'Первый полёт по маршруту. Взлёт в Тирасполе, проход над городом, затем на красный вантовый мост через Днестр — и посадка в Бендерах на короткую полосу 06. Учимся ориентироваться по земле и держать высоту.',
  },
  session: () => ({ airportId: 'yasny', runway: 0, end: 'A', timeOfDay: 10.5, weather: 'cloudy' }),
  freezeTime: true,
  build(m) {
    const city = m.poi('city_yasny'), br = m.poi('bridge');
    const gv = m.ap('gavan'), grw = gv.runways[0], gH = grw.heading;
    const gate = finalPoint(gv, grw, gH, 2400);
    return [
      S.takeoff({
        text: 'Взлёт с полосы 09',
        enter(m) {
          m.tower('yasny', `${m.cs}, взлёт разрешаю. После взлёта — правым разворотом на город, 300 метров.`);
          m.radio(INS, 'Сегодня летим сами, я только подсказываю. Не забудь убрать шасси.');
        },
      }),
      S.reach({
        text: `Пройдите над городом ${city.name.replace(/^город /, '')}`, x: city.x, z: city.z, y: 320, label: city.name, radius: 700,
        enter(m) { m.radio(INS, 'Держи 300 метров. Город — справа впереди, метка на экране.'); },
        update(m) { if (m.ac.gearDown && m.stepT > 20) m.hint('g', INS, 'Шасси убери — летим по маршруту.', 20); },
      }),
      S.reach({
        text: `Курс на ${br.name}`, x: br.x, z: br.z, y: 250, label: 'Мост', radius: 500, maxAlt: 900,
        enter(m) { m.radio(INS, `Под нами родной город. Теперь ищи красный вантовый мост — это Днестр. Держи на него.`); },
        altHint: (m) => m.hint('alt', INS, 'Высоко! Снижайся, мост надо видеть.', 15),
      }),
      S.reach({
        text: `${m.name('gavan')}: выход на прямую, полоса ${rwNum(gH)}`, ...gate, label: 'Вход в глиссаду', radius: 600,
        enter(m) {
          m.radio(INS, 'Вот он, Днестр! За мостом — Бендеры. Снижайся до 200 и выходи на метку.');
          m.later(9, () => m.tower('gavan', `${m.cs}, ${m.tw('gavan')}. Вас вижу. Полоса ${rwNum(gH)}, ${windPhrase(m.world)}. Заход разрешаю.`));
        },
      }),
      S.land('gavan', {
        text: `Посадка в Бендерах`,
        enter(m) { m.radio(INS, 'Полоса короткая — шасси, закрылки, скорость поменьше. Держи планки.'); },
      }),
    ];
  },
  onDone(m) {
    const st = m.landStars(m.landed.td, m.landed.bounces);
    m.complete({
      stars: st, text: 'Маршрут Тирасполь — Днестр — Бендеры',
      radio: [m.tw('gavan'), st === 3 ? `${m.cs}, Три-хо-хо! Красиво сели. Добро пожаловать в Бендеры!` : `${m.cs}, посадка зачтена. Добро пожаловать в Бендеры!`],
    });
  },
};

// ---------------------------------------------------------------- 3. Школа пилотажа
const FIG = {
  roll: { name: 'бочку', text: 'Бочка: ручку вбок до упора — полный оборот', how: 'Бочка: держи 250, ручку резко вбок до упора и держи, пока самолёт не обернётся вокруг себя. Потом — ручку в центр.' },
  loop: { name: 'петлю', text: 'Мёртвая петля: разгон до 280 км/ч, ручку на себя', how: 'Мёртвая петля: разгонись снижением до 280, газ полный и ручку плавно на себя до упора. Не отпускай до самого низа.' },
  chandelle: { name: 'боевой разворот', text: 'Боевой разворот: набор с разворотом на 180°', how: 'Боевой разворот: скорость 280, крен 45 градусов и ручку на себя — самолёт идёт вверх с разворотом. Выводи на обратном курсе.' },
};
export const aeroSchool = {
  def: {
    id: 'aero_school', title: 'Школа пилотажа', category: 'training', plane: 'yak52', difficulty: 2, order: 3,
    from: 'yasny', to: 'yasny', reward: { money: 1000, xp: 180 },
    brief: 'Як-52 создан для пилотажа: выдерживает от +7 до −5. Вы уже в воздухе над пилотажной зоной у Тирасполя, высота 1200 метров. Инструктор покажет три классические фигуры: бочку, мёртвую петлю и боевой разворот. Затем — посадка дома.',
  },
  session(G, world) {
    const c = this.zone(world);
    return { airportId: 'yasny', air: { x: c.x + 1500, y: 1200, z: c.z + 1200, heading: 300 * DEG, speed: 62 }, timeOfDay: 16.5, weather: 'clear' };
  },
  zone(world) { const a = world.airportById.yasny; return { x: a.x - 3500, z: a.z - 5000 }; },
  freezeTime: true,
  start(m) {
    const ag = m.G.aerobatics;
    m.data.real = !!(ag && Object.keys(ag).length > 3);
    m.data.fb = { roll: 0, rollQ: 0, pitch: 0, pitchQ: 0, hist: [], acc: 0 };
    m.on('trick:done', (e) => { if (e && e.ac === m.G.player) { m.data.real = true; onTrick(m, e.id, e.name); } });
  },
  build(m) {
    const zone = this.zone(m.world);
    const zmk = [{ x: zone.x, y: 900, z: zone.z, kind: 'ring', radius: 900, label: 'Пилотажная зона' }];
    const fig = (id) => ({
      id, text: FIG[id].text, markers: zmk,
      enter(m) { m.data.want = id; m.radio(INS, FIG[id].how); },
      update: (m) => m.data.got === id,
    });
    return [
      fig('roll'), fig('loop'), fig('chandelle'),
      S.land('yasny', {
        text: 'Возвращайтесь: посадка в Тирасполе',
        enter(m) {
          m.data.figT = m.t;
          m.later(7, () => m.tower('yasny', `${m.cs}, пилотаж наблюдали с вышки. Заход разрешаю, полоса по вашему выбору.`));
        },
      }),
    ];
  },
  update(m, dt) {
    const ac = m.ac, zone = this.zone(m.world);
    if (m.index < 3) {
      if (!ac.onGround && ac.agl < 280 && ac.vs < -3) m.hint('low', INS, 'Высота! Выводи, ручку на себя! Пилотаж — не ниже 300 метров.', 8);
      const d = dist2(ac.pos.x, ac.pos.z, zone.x, zone.z);
      if (d > 4500) m.hint('zone', INS, 'Мы ушли из зоны. Разворачивайся обратно к метке.', 20);
      if (!m.data.real) fallbackTricks(m, dt);
    }
  },
  onDone(m) {
    let st = m.landStars(m.landed.td, m.landed.bounces);
    if (m.data.figT > 330) st = Math.max(1, st - 1);
    m.complete({
      stars: st, text: 'Бочка, мёртвая петля и боевой разворот',
      radio: [INS, st === 3 ? `Три-хо-хо, ${m.cs}! Пилотаж чистый, посадка отличная. Записываю «отлично».` : `Неплохо, ${m.cs}. Все три фигуры есть. Будем шлифовать.`],
    });
  },
};

// фигуры, которые распознаются «по дороге» к нужной (переворот внутри петли и т.п.) — не ругаем за них
const PART = { roll: ['inverted', 'knife'], loop: ['inverted', 'splits', 'immelmann', 'hammerhead'], chandelle: ['turn360', 'immelmann'] };
function onTrick(m, id, name) {
  if (m.index > 2 || !m.data.want || m.data.got === m.data.want) return;
  if (m.t - (m.data.gotT || -9) < 2) return;
  if (id === m.data.want) {
    m.data.got = id; m.data.gotT = m.t;
    const praise = { roll: 'Чистая бочка! Засчитано.', loop: 'Вот это петля! Засчитано.', chandelle: 'Боевой разворот есть. Отлично!' }[id];
    m.radio(INS, praise, { now: true });
    m.toast(`Фигура выполнена: ${FIG[id].name}`, 'good');
  } else if (name && !(PART[m.data.want] || []).includes(id)) m.hint('other', INS, `${name[0].toUpperCase() + name.slice(1)} — красиво! Но сейчас я просил ${FIG[m.data.want].name}.`, 10);
}

// Запасное распознавание (если модуль пилотажа не прислал trick:done): по угловым скоростям и курсу.
function fallbackTricks(m, dt) {
  const ac = m.ac, f = m.data.fb;
  if (ac.onGround) return;
  // бочка: накопленный крен ±360° без долгих пауз
  f.roll += ac.angVel.z * dt;
  if (Math.abs(ac.angVel.z) < 0.6) { f.rollQ += dt; if (f.rollQ > 1.2) f.roll = 0; } else f.rollQ = 0;
  if (Math.abs(f.roll) > 2 * Math.PI * 0.92) { f.roll = 0; onTrick(m, 'roll'); }
  // петля: накопленный тангаж 330°
  f.pitch += ac.angVel.x * dt;
  if (ac.angVel.x < 0.12) { f.pitchQ += dt; if (f.pitchQ > 2) f.pitch = 0; } else f.pitchQ = 0;
  if (f.pitch > 2 * Math.PI * 0.9) { f.pitch = 0; onTrick(m, 'loop'); }
  // боевой разворот: за 6–25 с курс сменился на 150°+ и набрано 120 м+, без петли
  f.acc += dt;
  if (f.acc >= 0.5) {
    f.acc = 0;
    const h = f.hist;
    const prev = h.length ? h[h.length - 1] : null;
    const hdg = prev ? prev.h + wrapPi(ac.heading - prev.raw) : ac.heading;
    h.push({ t: m.t, h: hdg, raw: ac.heading, alt: ac.alt });
    if (h.length > 50) h.shift();
    for (let i = 0; i < h.length; i++) {
      const s = h[i], age = m.t - s.t;
      if (age < 6 || age > 25) continue;
      if (Math.abs(hdg - s.h) > 150 * DEG && ac.alt - s.alt > 120 && Math.abs(ac.bank) < 50 * DEG && f.pitch < Math.PI) {
        h.length = 0;
        onTrick(m, 'chandelle');
        break;
      }
    }
  }
}
