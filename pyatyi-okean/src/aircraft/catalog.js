// Каталог самолётов: паспортные данные (СИ) — из них физика выводит аэродинамические коэффициенты (physics.js: deriveAero).
// Цены/звания/улучшения — в systems/economy.js, 3D-модели — в aircraft/models (ключ = id). id стабильны.
//
// Основные поля (задаются явно):
//  role: 'civil' | 'military';  cls: 'trainer'|'utility'|'airliner'|'cargo'|'amphibian'|'fighter'|'attacker'|'bomber'|'warbird'
//  engine: 'piston'|'turboprop'|'jet';  engines: кол-во двигателей
//  mass кг (типичная полётная, с полными баками), wingArea м², span м, length м
//  thrust Н — суммарная статическая тяга (для форсажных — на полном форсаже; у винтовых — тяга винта на месте)
//  thrustDry Н — тяга на «максимале» без форсажа (только при afterburner: true); power Вт — мощность на валу (винтовые)
//  vStall — скорость сваливания в чистой конфигурации, vMax — максимальная в горизонте у земли, vCruise — крейсерская (м/с, приборная)
//  maxG, rollRate рад/с, pitchRate рад/с
//  fuel кг; burn кг/с на максимале без форсажа (игровой масштаб: полного бака хватает на 30–45 минут крейсерского полёта)
//  gearHeight — высота ЦТ над землёй на стоянке, м;  retract: шасси убирается;  flaps: есть закрылки
//  flapLift — прирост Cy max с полностью выпущенной механизацией (0.25 = +25 %)
//  ceiling м — практический потолок;  climb м/с, takeoffRun м, landingRun м — паспортные (для ангара и проверки модели)
//  afterburner — есть форсаж (зона РУД > 0.9);  airbrake — есть тормозные щитки/интерцепторы (controls.airbrake)
//  reverse — реверс тяги на пробеге (включается тормозом);  chute — площадь тормозного парашюта, м² (выпускается тормозом на пробеге)
//  ground — может работать с грунта и садиться вне полосы;  carrierCapable — годен для палубы (гак держит любого, это флаг для заданий/ИИ)
//  amphibian — садится на воду;  groundPitch — стояночный угол (рад) у самолётов с хвостовым колесом
//  bankLimit / pitchLimit: [вверх, вниз] рад — мягкие ограничения при включённой помощи (лайнеры и транспортники)
//  mCrit — число М начала волнового кризиса;  thrustLapse — падение тяги по скорости (доля на М = 1)
//  seats / cargo (кг) / water (кг воды для тушения); guns/hardpoints — для боевых
//
// Выводятся автоматически (finalize, если не заданы явно):
//  vStallLand — сваливание в посадочной конфигурации, vRotate — подъём носового колеса (закрылки во взлётном),
//  vApproach — скорость захода (1.3 vStallLand), vClimb — скорость набора, vNe — непревышаемая приборная, mNe — предельное М
const DEG = Math.PI / 180;

export const CATALOG = [
  {
    id: 'yak52', name: 'Як-52', fullName: 'Яковлев Як-52', year: 1976, role: 'civil', cls: 'trainer',
    engine: 'piston', engines: 1, mass: 1300, wingArea: 15, span: 9.3, length: 7.75, thrust: 5600, power: 265000,
    vStall: 29, vMax: 79, vCruise: 55, vClimb: 44, maxG: 7, minG: -5, rollRate: 3.1, pitchRate: 1.5,
    fuel: 90, burn: 0.058, gearHeight: 1.25, retract: true, flaps: true, flapLift: 0.3,
    ceiling: 4000, climb: 7, takeoffRun: 180, landingRun: 300,
    ground: true, seats: 2,
    desc: 'Учебно-тренировочный самолёт первоначального обучения. На нём учились летать тысячи курсантов ДОСААФ. Прощает ошибки и умеет весь высший пилотаж: перегрузки от +7 до −5. Колёса в убранном положении наполовину выступают из крыла — посадка «на брюхо» ему почти не страшна.',
  },
  {
    id: 'an2', name: 'Ан-2', fullName: 'Антонов Ан-2 «Кукурузник»', year: 1947, role: 'civil', cls: 'utility',
    engine: 'piston', engines: 1, mass: 5000, wingArea: 71.5, span: 18.2, length: 12.4, thrust: 14500, power: 735000, propEff: 0.72,
    vStall: 25, vMax: 71, vCruise: 50, vClimb: 38, maxG: 3.7, minG: -1.5, rollRate: 1.1, pitchRate: 0.9,
    fuel: 900, burn: 0.47, gearHeight: 1.9, retract: false, flaps: true, flapLift: 0.6, groundPitch: 11 * DEG,
    ceiling: 4400, climb: 3.2, takeoffRun: 170, landingRun: 215,
    ground: true, bankLimit: 60 * DEG, seats: 12, cargo: 1500,
    desc: 'Легендарный биплан: выпускался более полувека и работает до сих пор. Взлетает с любой поляны, а при сильном встречном ветре может лететь «назад» относительно земли. В его руководстве нет скорости сваливания: с автоматическими предкрылками он не срывается, а парашютирует.',
  },
  {
    id: 'l410', name: 'Л-410', fullName: 'Let L-410 УВП-Э «Турболёт»', year: 1969, role: 'civil', cls: 'utility',
    engine: 'turboprop', engines: 2, mass: 6000, wingArea: 34.9, span: 19.98, length: 14.4, thrust: 21000, power: 1120000,
    vStall: 41, vMax: 106, vCruise: 92, vClimb: 62, maxG: 3.5, minG: -1.4, rollRate: 1.2, pitchRate: 0.8,
    fuel: 1300, burn: 0.68, gearHeight: 1.6, retract: true, flaps: true, flapLift: 0.55,
    ceiling: 6300, climb: 7.5, takeoffRun: 450, landingRun: 350,
    ground: true, reverse: true, bankLimit: 60 * DEG, seats: 19, cargo: 1700,
    desc: 'Турбовинтовая «элка» местных авиалиний. Буквы УВП в названии — «укороченный взлёт и посадка»: садится на грунт и короткие полосы, идеальна для островных рейсов. Большая часть построенных машин досталась советскому «Аэрофлоту».',
  },
  {
    id: 'yak40', name: 'Як-40', fullName: 'Яковлев Як-40', year: 1966, role: 'civil', cls: 'airliner',
    engine: 'jet', engines: 3, mass: 14500, wingArea: 70, span: 25, length: 20.4, thrust: 44100, thrustLapse: 0.55,
    vStall: 52, vMax: 153, vCruise: 140, vClimb: 95, maxG: 3, minG: -1, rollRate: 0.9, pitchRate: 0.6,
    fuel: 3000, burn: 1.75, gearHeight: 1.9, retract: true, flaps: true, flapLift: 0.5,
    ceiling: 8000, climb: 8, takeoffRun: 700, landingRun: 550,
    ground: true, reverse: true, airbrake: true, bankLimit: 47 * DEG, pitchLimit: [25 * DEG, 17 * DEG], mCrit: 0.7, seats: 32,
    desc: 'Первый в мире реактивный самолёт местных линий. Три двигателя в хвосте и прямое крыло: реактивная скорость с грунтовых аэродромов. Не нуждается в аэродромной технике — собственный трап в хвосте и автономный запуск двигателей.',
  },
  {
    id: 'tu154', name: 'Ту-154', fullName: 'Туполев Ту-154М', year: 1968, role: 'civil', cls: 'airliner',
    engine: 'jet', engines: 3, mass: 90000, wingArea: 201, span: 37.55, length: 47.9, thrust: 309000, thrustLapse: 0.5,
    vStall: 72, vMax: 264, vCruise: 250, vClimb: 150, maxG: 2.5, minG: -1, rollRate: 0.55, pitchRate: 0.35,
    fuel: 39000, burn: 17.5, gearHeight: 3.4, retract: true, flaps: true, flapLift: 0.75,
    ceiling: 12100, climb: 15, takeoffRun: 1300, landingRun: 1000,
    reverse: true, airbrake: true, bankLimit: 47 * DEG, pitchLimit: [25 * DEG, 17 * DEG], mCrit: 0.84, seats: 180,
    desc: 'Самый массовый советский реактивный лайнер — «Тушка». Стреловидное крыло, три двигателя в хвосте и характерные гондолы шасси на крыле. Возил пассажиров почти полвека — с 1972 по 2020 год, а в 2010-м Ту-154 сумел сесть в тайге на заброшенную полосу Ижмы с полностью обесточенным бортом.',
  },
  {
    id: 'il76', name: 'Ил-76', fullName: 'Ильюшин Ил-76ТД', year: 1971, role: 'civil', cls: 'cargo',
    engine: 'jet', engines: 4, mass: 150000, wingArea: 300, span: 50.5, length: 46.6, thrust: 471000, thrustLapse: 0.55,
    vStall: 68, vMax: 236, vCruise: 215, vClimb: 140, maxG: 2.3, minG: -0.8, rollRate: 0.45, pitchRate: 0.3,
    fuel: 84000, burn: 25, gearHeight: 3.6, retract: true, flaps: true, flapLift: 0.8,
    ceiling: 12000, climb: 10, takeoffRun: 1400, landingRun: 900,
    ground: true, reverse: true, airbrake: true, bankLimit: 47 * DEG, pitchLimit: [22 * DEG, 15 * DEG], mCrit: 0.77, cargo: 50000, water: 42000,
    desc: 'Тяжёлый транспортник-труженик: работает с грунта, со льда и в Антарктиде. Двадцать колёс шасси держат его на раскисшей полосе, а в 1975 году на Ил-76 установили 25 мировых рекордов. В пожарном варианте сбрасывает 42 тонны воды за заход.',
  },
  {
    id: 'be200', name: 'Бе-200', fullName: 'Бериев Бе-200ЧС «Альтаир»', year: 1998, role: 'civil', cls: 'amphibian',
    engine: 'jet', engines: 2, mass: 36000, wingArea: 117.4, span: 32.8, length: 32, thrust: 147000, thrustLapse: 0.62,
    vStall: 56, vMax: 194, vCruise: 165, vClimb: 110, maxG: 2.6, minG: -1, rollRate: 0.6, pitchRate: 0.4,
    fuel: 12000, burn: 5.6, gearHeight: 2.6, hullHeight: 1.7, retract: true, flaps: true, flapLift: 0.6,
    ceiling: 8000, climb: 13, takeoffRun: 700, landingRun: 950,
    amphibian: true, reverse: true, airbrake: true, bankLimit: 47 * DEG, pitchLimit: [25 * DEG, 17 * DEG], mCrit: 0.7, seats: 44, water: 12000,
    desc: 'Реактивная летающая лодка-амфибия. Набирает 12 тонн воды за 14 секунд глиссирования и тушит лесные пожары по всему миру. Двигатели подняты над крылом, чтобы в них не попадали брызги, а взлетать умеет и с бетона, и с морской волны.',
  },
  {
    id: 'l39', name: 'Л-39', fullName: 'Aero L-39 «Альбатрос»', year: 1968, role: 'military', cls: 'trainer',
    engine: 'jet', engines: 1, mass: 4500, wingArea: 18.8, span: 9.46, length: 12.13, thrust: 16900, thrustLapse: 0.45,
    vStall: 49, vMax: 208, vCruise: 170, vClimb: 110, maxG: 8, minG: -4, rollRate: 2.6, pitchRate: 1.2,
    fuel: 980, burn: 0.72, gearHeight: 1.5, retract: true, flaps: true, flapLift: 0.25,
    ceiling: 11000, climb: 21, takeoffRun: 530, landingRun: 650,
    ground: true, airbrake: true, mCrit: 0.78, seats: 2, guns: 1, hardpoints: 2,
    desc: 'Реактивная «летающая парта» — на «элках» учились почти все военные лётчики страны. Построено около трёх тысяч машин; простой и надёжный, он остаётся основой пилотажных групп и аэроклубов.',
  },
  {
    id: 'mig21', name: 'МиГ-21', fullName: 'Микоян МиГ-21бис', year: 1959, role: 'military', cls: 'fighter',
    engine: 'jet', engines: 1, mass: 8700, wingArea: 23, span: 7.15, length: 14.7, thrust: 69600, thrustDry: 40200,
    vStall: 78, vMax: 361, vCruise: 280, vClimb: 250, maxG: 8.5, minG: -3.5, rollRate: 3.2, pitchRate: 1.0,
    fuel: 2300, burn: 2.3, gearHeight: 1.7, retract: true, flaps: true, flapLift: 0.3,
    ceiling: 17500, climb: 225, takeoffRun: 830, landingRun: 550,
    afterburner: true, airbrake: true, chute: 16, ground: true, mCrit: 0.9, seats: 1, guns: 1, hardpoints: 4,
    desc: '«Балалайка» — самый массовый сверхзвуковой истребитель в истории: построено более 11 тысяч. Треугольное крыло, высокая посадочная скорость и строгий характер: в вираже быстро теряет скорость, зато разгоняется вдвое быстрее звука.',
  },
  {
    id: 'su25', name: 'Су-25', fullName: 'Сухой Су-25 «Грач»', year: 1975, role: 'military', cls: 'attacker',
    engine: 'jet', engines: 2, mass: 14600, wingArea: 30.1, span: 14.36, length: 15.53, thrust: 88200, thrustLapse: 0.3,
    vStall: 62, vMax: 271, vCruise: 210, vClimb: 160, maxG: 6.5, minG: -3, rollRate: 1.9, pitchRate: 0.9,
    fuel: 3000, burn: 2.6, gearHeight: 1.9, retract: true, flaps: true, flapLift: 0.25,
    ceiling: 7000, climb: 58, takeoffRun: 600, landingRun: 600,
    airbrake: true, chute: 25, ground: true, mCrit: 0.8, seats: 1, guns: 1, hardpoints: 10,
    desc: 'Бронированный штурмовик — «летающий танк». Титановая кабина, десять точек подвески и живучесть, вошедшая в легенды. Работает с грунтовых площадок, а его двигатели в крайнем случае можно заправить обычной соляркой.',
  },
  {
    id: 'mig29', name: 'МиГ-29', fullName: 'Микоян МиГ-29', year: 1977, role: 'military', cls: 'fighter',
    engine: 'jet', engines: 2, mass: 15300, wingArea: 38, span: 11.36, length: 17.32, thrust: 162800, thrustDry: 98800,
    vStall: 65, vMax: 417, vCruise: 300, vClimb: 280, maxG: 9, minG: -3.5, rollRate: 3.6, pitchRate: 1.3,
    fuel: 3500, burn: 3.3, gearHeight: 1.9, retract: true, flaps: true, flapLift: 0.25,
    ceiling: 18000, climb: 330, takeoffRun: 260, landingRun: 600,
    afterburner: true, airbrake: true, chute: 17, ground: true, carrierCapable: true, mCrit: 0.9, seats: 1, guns: 1, hardpoints: 6,
    desc: 'Лёгкий фронтовой истребитель четвёртого поколения. Тяговооружённость больше единицы: уходит в небо вертикально прямо со взлёта. На земле воздухозаборники закрываются створками, а двигатели дышат через «жабры» сверху — чтобы не засосать камни с полевого аэродрома.',
  },
  {
    id: 'su27', name: 'Су-27', fullName: 'Сухой Су-27', year: 1977, role: 'military', cls: 'fighter',
    engine: 'jet', engines: 2, mass: 23400, wingArea: 62, span: 14.7, length: 21.9, thrust: 245200, thrustDry: 149000,
    vStall: 61, vMax: 389, vCruise: 300, vClimb: 280, maxG: 9, minG: -3, rollRate: 3.0, pitchRate: 1.35,
    fuel: 9400, burn: 5.6, gearHeight: 2.2, retract: true, flaps: true, flapLift: 0.25,
    ceiling: 18500, climb: 300, takeoffRun: 450, landingRun: 620,
    afterburner: true, airbrake: true, chute: 50, carrierCapable: true, mCrit: 0.9, seats: 1, guns: 1, hardpoints: 10,
    desc: 'Тяжёлый истребитель завоевания превосходства. Интегральная компоновка и знаменитая «кобра Пугачёва» — визитная карточка самолёта. Облегчённый Су-27 под именем П-42 установил десятки мировых рекордов скороподъёмности, а палубный Су-33 вырос из этой же машины.',
  },
];

// Значения по умолчанию и выводимые скорости — чтобы каждый модуль видел одни и те же цифры.
function finalize(s) {
  const jet = s.engine === 'jet';
  s.flapLift ??= s.flaps ? 0.4 : 0;
  s.afterburner = !!s.afterburner;
  s.thrustDry ??= s.thrust;
  s.thrustLapse ??= s.afterburner ? 0.2 : 0.45;
  s.propEff ??= 0.8;
  s.minG ??= s.maxG >= 6 ? -0.45 * s.maxG : -1;
  s.mCrit ??= jet ? 0.8 : 0.65;
  s.supersonic = s.vMax > 345;
  s.airbrake = !!s.airbrake;
  s.reverse = !!s.reverse;
  s.chute ??= 0;
  s.ground = !!s.ground;
  s.carrierCapable = !!s.carrierCapable;
  s.amphibian = !!s.amphibian;
  s.groundPitch ??= 0;
  s.hullHeight ??= s.gearHeight * 0.65;
  s.ceiling ??= jet ? 11000 : 5000;
  s.vStallLand ??= Math.round((s.vStall / Math.sqrt(1 + s.flapLift)) * 10) / 10;
  s.vRotate ??= Math.round(1.1 * s.vStall / Math.sqrt(1 + 0.5 * s.flapLift));
  s.vApproach ??= Math.round(1.3 * s.vStallLand);
  s.vClimb ??= Math.round(jet ? Math.max(1.6 * s.vStall, 0.5 * s.vMax) : 1.5 * s.vStall);
  s.vNe ??= Math.round(s.vMax * 1.12);
  s.mNe ??= s.supersonic ? 2.4 : s.mCrit + 0.06;
  return s;
}
CATALOG.forEach(finalize);

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((s) => [s.id, s]));
export const getSpec = (id) => CATALOG_BY_ID[id] || CATALOG[0];
