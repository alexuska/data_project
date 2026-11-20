// Обучение: «Первый вылет», «Круг над Днестром», «Школа пилотажа».
import { S } from './engine.js';
import { DEG, rwPoint, finalPoint, windPhrase, rwNum, dist2, kmh, fmtDist } from './lib.js';

const INS = 'Инструктор';
const kmhOf = (ac) => ac.ias * 3.6;

// ---------------------------------------------------------------- 1. Первый вылет
export const firstFlight = {
  def: {
    id: 'first_flight', title: 'Первый вылет', category: 'training', plane: 'yak52', difficulty: 1, order: 1,
    from: 'yasny', to: 'yasny', reward: { money: 500, xp: 100 },
    brief: 'Утро в Тирасполе, на полосе ждёт учебный Як-52. Инструктор поведёт тебя за руку: разбег и отрыв, уборка шасси, полёт по «коробочке» над аэродромом по меткам, выпуск шасси и закрылков, заход и посадка. Что делать прямо сейчас — всегда написано в карточке вверху экрана, а нужная кнопка подсвечивается.',
  },
  session: () => ({ airportId: 'yasny', runway: 0, end: 'A', timeOfDay: 8.5, weather: 'clear' }),
  freezeTime: true,
  build(m) {
    const ap = m.ap('yasny'), rw = ap.runways[0], H = rw.heading;
    const tw = m.tw('yasny');
    const p1 = rwPoint(rw, H, 2300, -1300), p2 = rwPoint(rw, H, -1900, -1500), p4 = finalPoint(ap, rw, H, 2200);
    const alt = (ac) => ac.alt - ap.elevation;
    m.data.lastPush = 0;
    const toP = (p) => dist2(m.ac.pos.x, m.ac.pos.z, p.x, p.z);
    return [
      {
        text: 'Дай полный газ: РУД до упора', title: 'Полный газ',
        how: 'РУД — рычаг газа, большой ползунок справа. Сдвинь его пальцем вверх до упора. Ручку пока не трогай.',
        ctl: 'thr-up',
        progress: (m) => { const t = Math.max(m.ac.controls.throttle, m.ac.throttle); return { value: t * 100, max: 100, text: `газ ${Math.round(t * 100)}% из 100%` }; },
        markers: [],
        enter(m) {
          m.tower('yasny', `${m.cs}, ${tw}. Полоса ${rwNum(H)}, ${windPhrase(m.world)}. Взлёт разрешаю. С первым вылетом!`);
          m.radio(INS, 'Я рядом. Рычаг газа — РУД, ползунок справа — плавно до упора вверх. Ручку пока не трогай.');
        },
        update: (m) => m.ac.controls.throttle > 0.85 || m.ac.throttle > 0.85,
      },
      {
        text: () => `Разбег. На ${kmh(m.ac.spec.vRotate)} км/ч — ручку на себя`, title: 'Разбег и отрыв',
        how: () => `Самолёт сам бежит по полосе. Смотри на скорость. На ${kmh(m.ac.spec.vRotate)} км/ч потяни ручку на себя: положи палец на левую половину экрана и веди вниз — нос поднимется.`,
        ctl: (m) => (m.ac.ias > m.ac.spec.vRotate * 0.8 || !m.ac.onGround ? 'stick-back' : null),
        progress: (m) => {
          const ac = m.ac, v = ac.ias * 3.6, vr = ac.spec.vRotate * 3.6;
          return ac.onGround ? { value: v, max: vr, text: `скорость ${Math.round(v / 5) * 5} из ${kmh(ac.spec.vRotate)} км/ч` } : { value: ac.agl, max: 5, text: 'отрыв!' };
        },
        hint: (m) => (m.ac.onGround && m.ac.ias > m.ac.spec.vRotate * 0.95 ? 'Пора! Палец вниз — нос вверх' : ''),
        enter(m) { m.radio(INS, 'Пошли! Держи самолёт по осевой линии. Скорость растёт — смотри на прибор слева.'); },
        update(m) {
          const ac = m.ac;
          if (ac.onGround && ac.ias > ac.spec.vRotate * 0.95) m.hint('rot', INS, `Есть ${kmh(ac.spec.vRotate)}! Плавно ручку на себя — нос вверх.`, 8);
          if (ac.onGround && m.stepT > 25 && ac.throttle < 0.5) m.hint('thr', INS, 'Газ! РУД до упора, иначе не взлетим.', 12);
          return !ac.onGround && ac.agl > 5;
        },
      },
      {
        text: 'Убери шасси', title: 'Убери шасси',
        how: 'Шасси — это колёса. В воздухе они мешают. Нажми круглую кнопку ШАССИ справа внизу — колёса уберутся, лампочки погаснут.',
        ctl: 'gear',
        enter(m) { m.radio(INS, 'Есть отрыв! Молодец. Теперь убираем шасси — кнопка «Шасси».', { now: true }); },
        update(m) {
          if (m.stepT > 14) m.hint('gear', INS, 'Шасси! Убери шасси — так самолёт быстрее набирает скорость.', 14);
          return !m.ac.gearDown;
        },
      },
      S.reach({
        text: 'Набирай 300 м и лети к точке 1', title: 'Набор высоты, точка 1', ...p1, y: ap.elevation + 300, label: '1', radius: 500,
        how: `Лети к оранжевому ромбу «ЛЕТИ СЮДА · 1». Высота — прибор справа внизу: набери 300 м. Ручка на себя (палец вниз) — нос вверх, от себя — нос вниз.`,
        progress: (m) => {
          const a = alt(m.ac), d = toP(p1);
          return { value: Math.min(300, Math.max(0, a)), max: 300, text: `высота ${Math.max(0, Math.round(a / 10) * 10)} / 300 м · до точки ${fmtDist(d)}` };
        },
        enter(m) { m.radio(INS, 'Шасси убраны. Набираем 300 метров и держим на первую точку — она на экране.'); },
        update(m) { if (alt(m.ac) > 420) m.hint('hi1', INS, 'Хватит набирать, держи около 300 метров — нос чуть ниже.', 15); },
      }),
      S.reach({
        text: 'Разворот влево к точке 2, высота 300 м', title: 'Разворот влево, точка 2', ...p2, y: ap.elevation + 300, label: '2', radius: 500,
        how: 'Наклони ручку влево — самолёт накренится и повернёт. Когда ромб «2» окажется впереди — ручку в центр. Крен небольшой, высота 300 м.',
        enter(m) { m.radio(INS, 'Плавный разворот влево, крен не больше 30 градусов. Полоса будет слева — это «коробочка».'); },
        update(m) {
          const a = alt(m.ac);
          if (a < 200) m.hint('lo2', INS, 'Низковато! Держи 300 метров, ручку чуть на себя.', 15);
          else if (a > 450) m.hint('hi2', INS, 'Высоковато, снижайся до 300.', 15);
          if (m.stepT > 30 && m.radioIdle()) m.hint('city', INS, 'Справа внизу — наш Тирасполь. Красиво, да? Но смотрим на приборы.', 999);
        },
      }),
      {
        text: 'Выпусти шасси и закрылки', title: 'Шасси и закрылки',
        how: (m) => (m.ac.gearDown
          ? 'Шасси вышли — три зелёные лампочки. Теперь нажми ЗАКРЫЛКИ: это щитки на крыле, с ними можно лететь медленнее. РУД — вниз до половины.'
          : 'Готовимся к посадке. Нажми ШАССИ (справа внизу) — колёса выйдут. Потом нажми ЗАКРЫЛКИ.'),
        ctl: (m) => (m.ac.gearDown ? 'flaps' : 'gear'),
        progress: (m) => ({ value: (m.ac.gearDown ? 1 : 0) + (m.ac.flaps > 0 ? 1 : 0), max: 2, text: `шасси ${m.ac.gearDown ? 'выпущены' : 'убраны'} · закрылки ${m.ac.flaps > 0 ? 'выпущены' : 'убраны'}` }),
        markers: [{ ...p4, label: 'Вход в глиссаду', kind: 'waypoint' }],
        enter(m) { m.radio(INS, 'Готовимся к посадке: выпускай шасси, потом закрылки. Газ поменьше — скорость около 160.'); },
        update(m) {
          const ac = m.ac;
          if (m.stepT > 18) m.hint('cfg', INS, ac.gearDown ? 'Шасси вышли. Теперь закрылки — кнопка «Закрылки».' : 'Шасси! Кнопка «Шасси», потом закрылки.', 14);
          return ac.gearDown && ac.flaps > 0;
        },
      },
      S.reach({
        text: 'Выход на посадочную прямую', title: 'Выход на прямую', ...p4, label: 'Вход в глиссаду', radius: 550,
        how: 'Лети к ромбу «ВХОД В ГЛИССАДУ» — оттуда полоса будет прямо перед носом. Скорость около 160 км/ч: если больше — РУД чуть вниз.',
        ctl: (m) => (m.ac.ias > m.ac.spec.vApproach * 1.45 ? 'thr-down' : null),
        enter(m) { m.radio(INS, 'Отлично. Разворачивайся на метку — так мы выйдем точно на ось полосы.'); },
        update(m) { if (m.ac.ias > m.ac.spec.vApproach * 1.45) m.hint('spd6', INS, 'Скорость велика — убери газ.', 15); },
      }),
      {
        text: 'Заход: держи подсказку «на глиссаде»', title: 'Заход на посадку',
        how: 'Внизу экрана строка захода. «Выше» — ручку чуть на себя, «ниже» — от себя, «левее/правее» — наклони ручку туда. Над полосой: РУД вниз и ручку чуть на себя.',
        hint: (m) => (!m.ac.onGround && m.ac.agl < 14 ? 'Выравнивай! Газ — малый, ручку чуть на себя' : ''),
        ctl: (m) => (!m.ac.onGround && m.ac.agl < 14 ? 'thr-down' : null),
        progress: (m) => {
          const ac = m.ac, d = dist2(ac.pos.x, ac.pos.z, rw.cx, rw.cz);
          return { value: Math.max(0, 4000 - d), max: 4000, text: `до полосы ${fmtDist(Math.max(0, d - rw.length / 2))} · ${Math.round(ac.agl)} м над землёй` };
        },
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
        text: 'Тормоз — до полной остановки', title: 'Тормози',
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
// Каждая фигура — один шаг в два этапа: «подготовка» (условие входа: высота и скорость, с индикатором) и «выполняй»
// (пошаговая инструкция для пальцев + живой прогресс от распознавателя G.aerobatics.progress(id) + подсказки по ходу).
// Сорвалось — спокойное «ещё раз» с причиной (событие trick:fail). После 3 срывов или 2,5 минут — кнопка «Пропустить фигуру».
// Пилотажной зоны нет: фигуры засчитываются где угодно, выше безопасной высоты.
const MIN_AGL = 400;
const FIG = {
  roll: {
    title: 'Бочка', name: 'бочку', minKmh: 200, ctl: 'stick',
    how: 'Ручку до упора вбок — палец влево или вправо до края круга — и держи. Самолёт обернётся вокруг себя. Когда снова будет колёсами вниз — отпусти ручку.',
    radio: 'Начнём с бочки. Ручку вбок до упора и держи, пока самолёт не обернётся. Это проще, чем кажется!',
  },
  loop: {
    title: 'Мёртвая петля', name: 'петлю', minKmh: 250, ctl: 'stick-back',
    how: 'РУД вверх до упора. Потяни ручку на себя до упора (палец вниз) и держи всё время: самолёт пойдёт вверх, вверх ногами и вниз. Увидишь горизонт — отпусти ручку.',
    radio: 'Теперь мёртвая петля. Главное — тянуть ручку на себя и не отпускать до самого низа.',
  },
  chandelle: {
    title: 'Боевой разворот: разворот на 180° с набором высоты', short: 'Боевой разворот', name: 'боевой разворот', minKmh: 230, ctl: 'stick',
    how: 'Коротко наклони ручку вбок (крен 30–45°), потом тяни ручку на себя и держи: нос вверх, самолёт поворачивает. Держи, пока курс на шкале вверху не сменится на 180°.',
    radio: 'Последняя фигура — боевой разворот: разворачиваемся назад и одновременно набираем высоту. Крен небольшой, ручку на себя.',
  },
};
const WHY = {
  released: 'ты отпустил ручку раньше времени. Держи до конца фигуры.',
  slow: 'не хватило скорости — самолёт завис. Разгонись сильнее перед входом.',
  stall: 'самолёт потерял скорость и свалился. Перед входом разгонись, а ручку тяни плавнее.',
  alt: 'самолёт пошёл вниз. Нос должен смотреть вверх — тяни ручку на себя.',
  noclimb: 'разворот есть, но без набора высоты. Тяни ручку на себя сильнее, а крен поменьше.',
  reverse: 'ты сменил сторону. Держи ручку в одну сторону.',
  drift: 'нос гулял. Держи ручку строго вбок, не на себя.',
  over: 'самолёт лёг на спину — крен был слишком большой. Наклони крыло меньше (30–45°), а если крен растёт — ручку чуть в обратную сторону.',
};
const TRIES_SKIP = 3, TIME_SKIP = 150;

export const aeroSchool = {
  def: {
    id: 'aero_school', title: 'Школа пилотажа', category: 'training', plane: 'yak52', difficulty: 2, order: 3,
    from: 'yasny', to: 'yasny', reward: { money: 1000, xp: 180 },
    brief: 'Як-52 создан для пилотажа: выдерживает от +7 до −5. Ты уже в воздухе у Тирасполя, высота 1200 метров. Инструктор покажет три классические фигуры: бочку, мёртвую петлю и боевой разворот (разворот на 180° с набором высоты). Перед каждой — карточка: что нажимать и какую скорость набрать. Затем — посадка дома.',
  },
  session(G, world) {
    const c = this.zone(world);
    return { airportId: 'yasny', air: { x: c.x + 1500, y: 1200, z: c.z + 1200, heading: 300 * DEG, speed: 62 }, timeOfDay: 16.5, weather: 'clear' };
  },
  zone(world) { const a = world.airportById.yasny; return { x: a.x - 3500, z: a.z - 5000 }; },
  freezeTime: true,
  start(m) {
    m.data.skipped = 0;
    m.on('trick:done', (e) => { if (e && e.ac === m.G.player) onTrick(m, e.id, e.name); });
    m.on('trick:fail', (e) => { if (e && e.ac === m.G.player) onFail(m, e.id, e.reason); });
    m.on('input:action', (e) => {
      if (!e || e.id !== 'skip' || m.index > 2 || !m.data.want || m.data.got === m.data.want) return;
      m.data.skipped++;
      m.data.got = m.data.want;
      m.setAction(null);
      m.toast(`Фигура пропущена: ${FIG[m.data.want].name}. Вернёмся к ней в другой раз`, 'info');
      m.radio(INS, 'Ничего страшного, пропустим. Пилотаж приходит с практикой.', { now: true });
    });
  },
  build(m) {
    const ag = () => m.G.aerobatics;
    const fig = (id) => {
      const F = FIG[id];
      const prog = () => (ag() && ag().progress ? ag().progress(id) : null);
      return {
        id, text: F.short || F.title, title: F.title, markers: [],
        enter(m) {
          m.data.want = id; m.data.tries = 0; m.data.go = false; m.data.t0 = m.t; m.data.skipOn = false;
          m.radio(INS, F.radio);
        },
        how(m) {
          if (m.data.go) return F.how;
          const ac = m.ac;
          if (ac.agl < MIN_AGL) return `Сначала высота: нужно ${MIN_AGL} м над землёй. Ручку чуть на себя (палец вниз), РУД вверх до упора.`;
          return `Сначала разгон до ${F.minKmh} км/ч: РУД вверх до упора и нос чуть ниже горизонта — ручку чуть от себя (палец вверх).`;
        },
        progress(m) {
          const ac = m.ac;
          if (!m.data.go) {
            if (ac.agl < MIN_AGL) return { value: ac.agl, max: MIN_AGL, text: `высота ${Math.round(ac.agl / 10) * 10} из ${MIN_AGL} м` };
            const v = ac.ias * 3.6;
            return { value: v, max: F.minKmh, text: `скорость ${Math.round(v / 5) * 5} из ${F.minKmh} км/ч` };
          }
          const p = prog();
          return p ? { value: p.value, max: p.max, text: p.text } : null;
        },
        hint(m) {
          if (!m.data.go) return m.ac.throttle < 0.9 ? 'РУД — вверх до упора' : '';
          const p = prog();
          return p ? p.hint : '';
        },
        ctl(m) {
          if (!m.data.go) return m.ac.throttle < 0.9 ? 'thr-up' : null;
          if (m.data.skipOn) return 'action';
          return F.ctl;
        },
        update(m) {
          const ac = m.ac, p = prog();
          const v = ac.ias * 3.6;
          if (!m.data.go && v >= F.minKmh - 5 && ac.agl >= MIN_AGL) {
            m.data.go = true;
            m.toast(`Скорость есть — ${F.short ? 'выполняй боевой разворот' : 'выполняй ' + F.name}!`, 'good');
          } else if (!m.data.go && p && p.active && p.value > 30) m.data.go = true; // уже выполняет фигуру — показываем её прогресс else if (m.data.go && !(p && p.active) && (v < F.minKmh - 45 || ac.agl < MIN_AGL - 120)) m.data.go = false; // скорость/высота ушли — снова подготовка
          if (!m.data.skipOn && (m.data.tries >= TRIES_SKIP || m.t - m.data.t0 > TIME_SKIP)) {
            m.data.skipOn = true;
            m.setAction({ id: 'skip', label: 'Пропустить фигуру' });
          }
          return m.data.got === id;
        },
        exit(m) { m.setAction(null); m.data.skipOn = false; },
      };
    };
    return [
      fig('roll'), fig('loop'), fig('chandelle'),
      S.land('yasny', {
        text: 'Возвращайся: посадка в Тирасполе', title: 'Посадка дома',
        enter(m) {
          m.data.figT = m.t;
          m.later(7, () => m.tower('yasny', `${m.cs}, пилотаж наблюдали с вышки. Заход разрешаю, полоса по вашему выбору.`));
        },
      }),
    ];
  },
  update(m) {
    const ac = m.ac;
    if (m.index < 3 && !ac.onGround && ac.agl < 280 && ac.vs < -3) m.hint('low', INS, 'Высота! Выводи, ручку на себя! Пилотаж — не ниже 300 метров.', 8);
  },
  onDone(m) {
    let st = m.landStars(m.landed.td, m.landed.bounces);
    if (m.data.figT > 330) st = Math.max(1, st - 1);
    if (m.data.skipped) st = Math.max(1, Math.min(2, st) - (m.data.skipped - 1));
    m.complete({
      stars: st, text: m.data.skipped ? `Фигуры выполнены (пропущено: ${m.data.skipped}), посадка дома` : 'Бочка, мёртвая петля и боевой разворот',
      radio: [INS, st === 3 ? `Три-хо-хо, ${m.cs}! Пилотаж чистый, посадка отличная. Записываю «отлично».` : `Неплохо, ${m.cs}! Будем шлифовать.`],
    });
  },
};

// фигуры, которые распознаются «по дороге» к нужной (переворот внутри петли и т.п.) — не ругаем за них
const PART = { roll: ['inverted', 'knife', 'roll2'], loop: ['inverted', 'splits', 'immelmann', 'hammerhead'], chandelle: ['turn360', 'immelmann', 'roll'] };
function onTrick(m, id, name) {
  if (m.index > 2 || !m.data.want || m.data.got === m.data.want) return;
  if (m.t - (m.data.gotT || -9) < 2) return;
  if (id === m.data.want || (m.data.want === 'roll' && id === 'roll2')) {
    m.data.got = m.data.want; m.data.gotT = m.t;
    m.note(null);
    const praise = { roll: 'Чистая бочка! Засчитано.', loop: 'Вот это петля! Засчитано.', chandelle: 'Боевой разворот есть. Отлично!' }[m.data.want];
    m.radio(INS, praise, { now: true });
    m.toast(`Фигура выполнена: ${FIG[m.data.want].name}`, 'good');
  } else if (name && !(PART[m.data.want] || []).includes(id)) m.hint('other', INS, `${name[0].toUpperCase() + name.slice(1)} — красиво! Но сейчас я просил ${FIG[m.data.want].name}.`, 10);
}
function onFail(m, id, reason) {
  if (m.index > 2 || id !== m.data.want || m.data.got === m.data.want) return;
  m.data.tries++;
  const why = WHY[reason] || 'не получилось.';
  m.note(`Ещё раз! Что пошло не так: ${why}`);
  m.hint('fail', INS, `Почти! ${why[0].toUpperCase() + why.slice(1)} Ещё раз — спокойно.`, 6);
}
