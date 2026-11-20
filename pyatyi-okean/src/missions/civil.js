// Гражданские рейсы и грузы: «Почта на Остров Маяк», «Рейс в Москву», «Вечерний рейс в Париж».
import { S } from './engine.js';
import { finalPoint, windPhrase, rwNum, dist2, ridge, DEG } from './lib.js';

const KEEPER = 'Смотритель маяка';
const CREW = 'Бортпроводница';

function landingWord(td) {
  if (!td) return '';
  return td.vs < 1.2 ? 'мягко' : td.vs < 2 ? 'хорошо' : td.vs < 3.2 ? 'ощутимо' : 'жёстко';
}

// ---------------------------------------------------------------- 4. Почта на Остров Маяк (Ан-2 / Л-410)
export const mailMayak = {
  def: {
    id: 'mail_mayak', title: 'Почта на Остров Маяк', category: 'cargo', planes: ['an2', 'l410'], difficulty: 2, order: 1,
    from: 'yasny', to: 'mayak', reward: { money: 1000, xp: 180 }, requires: { missions: ['first_flight'] },
    brief: 'Раз в неделю на Остров Маяк летит почтовый борт: письма, газеты, лекарства и свежий хлеб для смотрителя маяка. Взлёт с полосы 21 в Тирасполе, полёт над морем и посадка на грунтовую полосу длиной всего 750 метров. Садиться нужно у самого торца.',
  },
  session: () => ({ airportId: 'yasny', runway: 1, end: 'B', timeOfDay: 9, weather: 'cloudy' }),
  freezeTime: true,
  build(m) {
    const ap = m.ap('mayak'), rw = ap.runways[0], H = rw.heading + Math.PI; // садимся курсом 290
    const gate = finalPoint(ap, rw, H, 1800);
    const rtw = m.tw('mayak');
    return [
      S.takeoff({
        text: 'Взлёт с полосы 21',
        enter(m) { m.tower('yasny', `${m.cs}, почта и лекарства на борту. Полоса 21, ${windPhrase(m.world)}, взлёт разрешаю.`); },
      }),
      S.reach({
        text: `Курс на ${ap.name}, высота 300 м`, ...gate, label: ap.name, radius: 600,
        enter(m) { m.tower('yasny', `${m.cs}, курс двести десять, над морем держите 300 метров. Счастливого пути!`); },
        update(m) {
          const t = m.stepT;
          if (t > 40 && !m.data.r1) { m.data.r1 = 1; m.radio(rtw, `${m.cs}, ${rtw} на связи. Полоса грунтовая, 750 метров, ${windPhrase(m.world)}. Ждём!`); }
          if (t > 110 && !m.data.r2) { m.data.r2 = 1; m.radio(KEEPER, 'Корвет, а письмо от внука там есть? Неделю жду! Чайник уже ставлю.'); }
          if (t > 200 && !m.data.r3) { m.data.r3 = 1; m.radio(rtw, 'Маяк видим? Белая башня на мысу — полоса правее, вдоль берега.'); }
          if (m.ac.alt > 700) m.hint('hi', rtw, 'Высоковато идёте — облака низкие, снижайтесь до 300.', 30);
        },
      }),
      S.land('mayak', {
        text: `Посадка на грунт, полоса ${rwNum(H)}`,
        enter(m) { m.radio(rtw, `Заход разрешаю, полоса ${rwNum(H)}. Полоса короткая — касание у самого торца, сразу тормозите.`); },
      }),
    ];
  },
  onDone(m) {
    let st = m.landStars(m.landed.td, m.landed.bounces);
    if (m.t > 660) st = Math.max(1, st - 1);
    m.complete({
      stars: st, text: `Почта доставлена: ${m.name('mayak')}. Посадка — ${landingWord(m.landed.td)}.`,
      details: { cargo: 420 },
      radio: [KEEPER, st === 3 ? 'Три-хо-хо! Вот это посадка! Письмо от внука — спасибо, Корвет, заходи на чай!' : 'Спасибо, Корвет! Письмо от внука пришло. Чай уже на плите!'],
    });
  },
};

// ---------------------------------------------------------------- 5. Рейс в Москву (Л-410 / Як-40)
export const moscowSnow = {
  def: {
    id: 'moscow_snow', title: 'Рейс в Москву', category: 'civil', planes: ['l410', 'yak40'], difficulty: 3, order: 1,
    from: 'yasny', to: 'polyarny', reward: { money: 1800, xp: 280 }, requires: { missions: ['dniester_circle'] },
    brief: 'Пассажирский рейс на север. Над Тирасполем облачно, а в Москве — снегопад: видимость меньше двух километров, полоса скользкая. Пройдите над плотиной Верхней, снижайтесь к точке входа в глиссаду и сажайте самолёт по приборам и подсказкам захода.',
  },
  session: () => ({ airportId: 'yasny', runway: 1, end: 'A', timeOfDay: 13.5, weather: 'overcast' }),
  freezeTime: true,
  build(m) {
    const ap = m.ap('polyarny'), rw = ap.runways[0], H = rw.heading;
    const gate = finalPoint(ap, rw, H, 4000);
    const dam = m.poi('dam'), home = m.ap('yasny');
    const top = Math.max(ridge(m.world, home.x, home.z, dam.x, dam.z), ridge(m.world, dam.x, dam.z, gate.x, gate.z));
    const cruise = Math.max(1200, Math.ceil((top + 500) / 100) * 100);
    m.data.cruise = cruise;
    const mtw = m.tw('polyarny');
    return [
      S.takeoff({
        text: 'Взлёт с полосы 03',
        enter(m) {
          m.tower('yasny', `${m.cs}, рейс на Москву. Полоса 03, ${windPhrase(m.world)}, взлёт разрешаю. В Москве снег — одевайтесь теплее!`);
          m.radio(CREW, `Командир, салон готов, ${m.ac.spec.seats} пассажиров пристёгнуты.`);
        },
      }),
      S.reach({
        text: `Набор ${cruise} м, курс на ${dam.name}`, x: dam.x, z: dam.z, y: cruise, label: dam.name, radius: 900,
        enter(m) { m.tower('yasny', `${m.cs}, набирайте ${cruise}, на плотине — поворот на север. Связь с Москвой.`); },
      }),
      S.reach({
        text: `Москва: снижение к точке входа в глиссаду`, ...gate, label: 'Вход в глиссаду', radius: 800, maxAlt: gate.y + 700,
        altHint: (m) => m.hint('hi', mtw, `${m.cs}, вы выше глиссады. Снижайтесь до ${Math.round(gate.y / 10) * 10} метров.`, 18),
        update(m) {
          const ac = m.ac;
          if (!m.data.snow && dist2(ac.pos.x, ac.pos.z, ap.x, ap.z) < 16000) {
            m.data.snow = 1;
            m.world.setWeather('snow');
            m.radio(mtw, `${m.cs}, ${mtw}. У нас снегопад, видимость полтора километра, полоса ${rwNum(H)} расчищена, сцепление среднее. Заход разрешаю.`);
            m.later(16, () => m.radio(CREW, 'Командир, за окном метель. Пассажиры притихли — надеемся на вас!'));
          }
          if (m.stepT > 20 && m.data.snow && m.radioIdle()) m.hint('ils', mtw, 'Полосу пока не видно — идите по метке и подсказке захода внизу экрана.', 60);
        },
      }),
      S.land('polyarny', {
        text: `Посадка в снегопад, полоса ${rwNum(H)}`,
        enter(m) { m.radio(mtw, 'Шасси, закрылки — полностью. Полоса скользкая: касание мягкое, тормозите плавно.'); },
      }),
    ];
  },
  onDone(m) {
    const st = m.landStars(m.landed.td, m.landed.bounces);
    const mtw = m.tw('polyarny');
    m.complete({
      stars: st, text: `Посадка в снегопад — ${landingWord(m.landed.td)}. Пассажиров: ${m.ac.spec.seats}.`,
      details: { passengers: m.ac.spec.seats },
      radio: [mtw, st === 3 ? `${m.cs}, Три-хо-хо! В такую метель — и так мягко. Добро пожаловать в Москву!` : `${m.cs}, с прибытием в Москву! Рулите на перрон, автобус ждёт.`],
    });
  },
};

// ---------------------------------------------------------------- 6. Вечерний рейс в Париж (Як-40 / Ту-154)
export const parisEvening = {
  def: {
    id: 'paris_evening', title: 'Вечерний рейс в Париж', category: 'civil', planes: ['yak40', 'tu154'], difficulty: 4, order: 2,
    from: 'yasny', to: 'yuzhny', reward: { money: 3000, xp: 420 }, requires: { missions: ['dniester_circle'] },
    brief: 'Вечерний рейс на тёплый южный остров. Солнце садится в море, в салоне полно пассажиров — и каждый крен и рывок они почувствуют. Оцениваются комфорт (плавные развороты, крен не больше 30°, без перегрузок) и посадка. Маршрут: над портом Бендеры, затем заход на полосу 19 Парижа с севера.',
  },
  session: () => ({ airportId: 'yasny', runway: 0, end: 'A', timeOfDay: 19.2, weather: 'clear' }),
  freezeTime: true,
  start(m) { m.data.comfort = 100; m.data.c80 = m.data.c60 = 0; },
  build(m) {
    const ap = m.ap('yuzhny'), rw = ap.runways[0], H = rw.heading + Math.PI; // полоса 19
    const gate = finalPoint(ap, rw, H, 6000);
    const port = m.poi('port_gavan');
    const ptw = m.tw('yuzhny');
    return [
      S.takeoff({
        text: 'Взлёт с полосы 09',
        enter(m) {
          m.tower('yasny', `${m.cs}, вечерний на Париж. Полоса 09, ${windPhrase(m.world)}, взлёт разрешаю. Красивого заката!`);
          m.radio(CREW, `Командир, ${m.ac.spec.seats} пассажиров на борту, салон к взлёту готов.`);
        },
      }),
      S.reach({
        text: `Набор 1200 м, курс на ${port.name}`, x: port.x, z: port.z, y: 1200, label: port.name, radius: 1400,
        enter(m) { m.radio(CREW, 'Табло «пристегните ремни» горит. Развороты — плавные, пожалуйста: у нас горячий чай.'); },
      }),
      S.reach({
        text: `Снижение: вход в глиссаду, полоса ${rwNum(H)}`, ...gate, label: 'Вход в глиссаду', radius: 1100, maxAlt: gate.y + 700,
        enter(m) {
          m.radio(CREW, 'Пассажиры смотрят на закат над морем. Просили передать: спасибо, командир!');
          m.later(12, () => m.radio(ptw, `${m.cs}, ${ptw}, добрый вечер! Полоса ${rwNum(H)}, ${windPhrase(m.world)}. Снижайтесь к точке входа, заход с севера.`));
        },
        altHint: (m) => m.hint('hi', ptw, `${m.cs}, вы высоко. Снижайтесь до ${Math.round(gate.y / 10) * 10} метров, иначе не попадёте на глиссаду.`, 18),
      }),
      S.land('yuzhny', {
        text: `Посадка в Париже, полоса ${rwNum(H)}`,
        enter(m) { m.radio(ptw, 'Посадку разрешаю. Огни полосы включены.'); },
      }),
    ];
  },
  update(m, dt) {
    const ac = m.ac;
    if (ac.onGround || m.index < 1) return;
    let loss = 0;
    const g = ac.g;
    if (g > 1.5) loss += (g - 1.5) * 14;
    if (g < 0.5) loss += (0.5 - g) * 18;
    const bank = Math.abs(ac.bank) / DEG;
    if (bank > 32) loss += (bank - 32) * 0.35;
    if (ac.vs < -22) loss += 2;
    if (loss > 0) {
      m.data.comfort = Math.max(0, m.data.comfort - loss * dt);
      const c = m.data.comfort;
      if (c < 85 && !m.data.c80) { m.data.c80 = 1; m.radio(CREW, 'Командир, полегче! У нас чай по салону летает.', { now: true }); }
      else if (c < 60 && !m.data.c60) { m.data.c60 = 1; m.radio(CREW, 'Командир, пассажиры жалуются, дети плачут! Помягче, пожалуйста.', { now: true }); }
    }
  },
  onDone(m) {
    const td = m.landed.td;
    const land = td ? Math.max(0, td.score - 12 * (m.landed.bounces || 0)) : 40;
    const comfort = Math.round(m.data.comfort);
    const total = 0.5 * land + 0.5 * comfort;
    const st = total >= 84 ? 3 : total >= 64 ? 2 : 1;
    const ptw = m.tw('yuzhny');
    m.complete({
      stars: st, text: `Комфорт пассажиров: ${comfort}%, посадка: ${Math.round(land)} из 100.`,
      details: { passengers: m.ac.spec.seats, comfort },
      radio: st === 3 ? [CREW, 'Командир, пассажиры аплодируют! Три-хо-хо! Добро пожаловать в Париж.'] : [ptw, `${m.cs}, с прибытием в Париж. Хорошего вечера!`],
    });
  },
};
