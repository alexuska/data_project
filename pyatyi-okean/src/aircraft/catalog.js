// Каталог самолётов: паспортные данные (СИ) — из них физика выводит аэродинамические коэффициенты.
// Цены/звания/улучшения — в systems/economy.js, 3D-модели — в aircraft/models (ключ = id).
// Поля:
//  role: 'civil' | 'military';  cls: 'trainer'|'utility'|'airliner'|'cargo'|'amphibian'|'fighter'|'attacker'|'bomber'|'warbird'
//  engine: 'piston'|'turboprop'|'jet';  engines: кол-во двигателей
//  mass кг (типичная полётная), wingArea м², span м, length м, thrust Н (суммарная статическая, для реактивных — с форсажем)
//  vStall / vMax / vCruise — м/с у земли (vStall — в чистой конфигурации)
//  maxG, rollRate рад/с, pitchRate рад/с
//  fuel кг, burn кг/с на максимале; gearHeight — высота ЦТ над землёй на стоянке, м
//  retract: шасси убирается; flaps: есть закрылки; amphibian: садится на воду
//  seats / cargo (кг) / water (кг воды для тушения); guns/hardpoints — для боевых
export const CATALOG = [
  {
    id: 'yak52', name: 'Як-52', fullName: 'Яковлев Як-52', year: 1976, role: 'civil', cls: 'trainer',
    engine: 'piston', engines: 1, mass: 1300, wingArea: 15, span: 9.3, length: 7.75, thrust: 5200,
    vStall: 28, vMax: 79, vCruise: 55, maxG: 7, rollRate: 3.1, pitchRate: 1.5,
    fuel: 90, burn: 0.022, gearHeight: 1.25, retract: true, flaps: true, seats: 2,
    desc: 'Учебно-тренировочный самолёт первоначального обучения. На нём учились летать тысячи курсантов ДОСААФ. Прощает ошибки и умеет весь высший пилотаж.',
  },
  {
    id: 'an2', name: 'Ан-2', fullName: 'Антонов Ан-2 «Кукурузник»', year: 1947, role: 'civil', cls: 'utility',
    engine: 'piston', engines: 1, mass: 5000, wingArea: 71.5, span: 18.2, length: 12.4, thrust: 15000,
    vStall: 17, vMax: 71, vCruise: 50, maxG: 3.7, rollRate: 1.1, pitchRate: 0.9,
    fuel: 900, burn: 0.045, gearHeight: 1.9, retract: false, flaps: true, seats: 12, cargo: 1500,
    desc: 'Легендарный биплан: выпускался более 60 лет. Взлетает с любой поляны, а при сильном встречном ветре может лететь «назад» относительно земли.',
  },
  {
    id: 'l410', name: 'Л-410', fullName: 'Let L-410 «Турболёт»', year: 1969, role: 'civil', cls: 'utility',
    engine: 'turboprop', engines: 2, mass: 6000, wingArea: 34.9, span: 19.98, length: 14.4, thrust: 23000,
    vStall: 33, vMax: 106, vCruise: 95, maxG: 3.5, rollRate: 1.2, pitchRate: 0.8,
    fuel: 1300, burn: 0.09, gearHeight: 1.6, retract: true, flaps: true, seats: 19, cargo: 1700,
    desc: 'Турбовинтовая «элка» местных авиалиний. Садится на грунт и короткие полосы — идеальна для островных рейсов.',
  },
  {
    id: 'yak40', name: 'Як-40', fullName: 'Яковлев Як-40', year: 1966, role: 'civil', cls: 'airliner',
    engine: 'jet', engines: 3, mass: 14500, wingArea: 70, span: 25, length: 20.4, thrust: 44100,
    vStall: 44, vMax: 153, vCruise: 140, maxG: 3, rollRate: 0.9, pitchRate: 0.6,
    fuel: 3900, burn: 0.42, gearHeight: 1.9, retract: true, flaps: true, seats: 32,
    desc: 'Первый в мире реактивный самолёт местных линий. Три двигателя в хвосте и прямое крыло: реактивная скорость с грунтовых аэродромов.',
  },
  {
    id: 'tu154', name: 'Ту-154', fullName: 'Туполев Ту-154М', year: 1968, role: 'civil', cls: 'airliner',
    engine: 'jet', engines: 3, mass: 90000, wingArea: 201, span: 37.55, length: 47.9, thrust: 309000,
    vStall: 65, vMax: 264, vCruise: 250, maxG: 2.5, rollRate: 0.55, pitchRate: 0.35,
    fuel: 39000, burn: 3.6, gearHeight: 3.4, retract: true, flaps: true, seats: 180,
    desc: 'Самый массовый советский реактивный лайнер — «Тушка». Стреловидное крыло, три двигателя и характерные обтекатели шасси на крыле.',
  },
  {
    id: 'il76', name: 'Ил-76', fullName: 'Ильюшин Ил-76ТД', year: 1971, role: 'civil', cls: 'cargo',
    engine: 'jet', engines: 4, mass: 150000, wingArea: 300, span: 50.5, length: 46.6, thrust: 471000,
    vStall: 58, vMax: 236, vCruise: 220, maxG: 2.3, rollRate: 0.45, pitchRate: 0.3,
    fuel: 84000, burn: 5.6, gearHeight: 3.6, retract: true, flaps: true, cargo: 50000, water: 42000,
    desc: 'Тяжёлый транспортник-труженик: работает с грунта, со льда и в Антарктиде. В пожарном варианте сбрасывает 42 тонны воды за заход.',
  },
  {
    id: 'be200', name: 'Бе-200', fullName: 'Бериев Бе-200ЧС «Альтаир»', year: 1998, role: 'civil', cls: 'amphibian',
    engine: 'jet', engines: 2, mass: 36000, wingArea: 117.4, span: 32.8, length: 32, thrust: 147000,
    vStall: 50, vMax: 194, vCruise: 170, maxG: 2.6, rollRate: 0.6, pitchRate: 0.4,
    fuel: 12000, burn: 1.5, gearHeight: 2.6, retract: true, flaps: true, amphibian: true, seats: 44, water: 12000,
    desc: 'Реактивная летающая лодка. Набирает 12 тонн воды за 14 секунд глиссирования и тушит лесные пожары по всему миру.',
  },
  {
    id: 'l39', name: 'Л-39', fullName: 'Aero L-39 «Альбатрос»', year: 1968, role: 'military', cls: 'trainer',
    engine: 'jet', engines: 1, mass: 4500, wingArea: 18.8, span: 9.46, length: 12.13, thrust: 16900,
    vStall: 46, vMax: 208, vCruise: 170, maxG: 8, rollRate: 2.6, pitchRate: 1.2,
    fuel: 980, burn: 0.3, gearHeight: 1.5, retract: true, flaps: true, seats: 2, guns: 1, hardpoints: 2,
    desc: 'Реактивная «летающая парта» — на «элках» учились почти все военные лётчики страны. Основа пилотажных групп.',
  },
  {
    id: 'mig21', name: 'МиГ-21', fullName: 'Микоян МиГ-21бис', year: 1959, role: 'military', cls: 'fighter',
    engine: 'jet', engines: 1, mass: 8700, wingArea: 23, span: 7.15, length: 14.7, thrust: 69600,
    vStall: 75, vMax: 361, vCruise: 280, maxG: 8.5, rollRate: 3.2, pitchRate: 1.0,
    fuel: 2300, burn: 2.2, gearHeight: 1.7, retract: true, flaps: true, seats: 1, guns: 1, hardpoints: 4,
    desc: '«Балалайка» — самый массовый сверхзвуковой истребитель в истории. Треугольное крыло, высокая посадочная скорость и строгий характер.',
  },
  {
    id: 'su25', name: 'Су-25', fullName: 'Сухой Су-25 «Грач»', year: 1975, role: 'military', cls: 'attacker',
    engine: 'jet', engines: 2, mass: 14600, wingArea: 33.7, span: 14.36, length: 15.53, thrust: 88200,
    vStall: 58, vMax: 271, vCruise: 210, maxG: 6.5, rollRate: 1.9, pitchRate: 0.9,
    fuel: 3000, burn: 1.9, gearHeight: 1.9, retract: true, flaps: true, seats: 1, guns: 1, hardpoints: 10,
    desc: 'Бронированный штурмовик — «летающий танк». Титановая кабина, десять точек подвески и живучесть, вошедшая в легенды.',
  },
  {
    id: 'mig29', name: 'МиГ-29', fullName: 'Микоян МиГ-29', year: 1977, role: 'military', cls: 'fighter',
    engine: 'jet', engines: 2, mass: 15300, wingArea: 38, span: 11.36, length: 17.32, thrust: 162800,
    vStall: 62, vMax: 417, vCruise: 300, maxG: 9, rollRate: 3.6, pitchRate: 1.3,
    fuel: 3500, burn: 3.4, gearHeight: 1.9, retract: true, flaps: true, seats: 1, guns: 1, hardpoints: 6,
    desc: 'Лёгкий фронтовой истребитель четвёртого поколения. Тяговооружённость больше единицы: уходит в небо вертикально прямо со взлёта.',
  },
  {
    id: 'su27', name: 'Су-27', fullName: 'Сухой Су-27', year: 1977, role: 'military', cls: 'fighter',
    engine: 'jet', engines: 2, mass: 23400, wingArea: 62, span: 14.7, length: 21.9, thrust: 245200,
    vStall: 60, vMax: 389, vCruise: 300, maxG: 9, rollRate: 3.0, pitchRate: 1.35,
    fuel: 9400, burn: 4.6, gearHeight: 2.2, retract: true, flaps: true, seats: 1, guns: 1, hardpoints: 10,
    desc: 'Тяжёлый истребитель завоевания превосходства. Интегральная компоновка и знаменитая «кобра Пугачёва» — визитная карточка самолёта.',
  },
];

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((s) => [s.id, s]));
export const getSpec = (id) => CATALOG_BY_ID[id] || CATALOG[0];
