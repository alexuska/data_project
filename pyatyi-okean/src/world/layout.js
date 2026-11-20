// Карта мира «Архипелаг Семи Ветров»: данные об островах, аэродромах и ориентирах.
// Мир — квадрат WORLD_SIZE × WORLD_SIZE метров с центром в (0,0). Север = −Z, восток = +X.
// ВАЖНО: id аэродромов и ориентиров стабильны — на них ссылаются миссии. Координаты можно уточнять.
// Файл без three — его можно импортировать в node-тестах.
import { DEG, headingVec } from '../core/util.js';

export const WORLD_SIZE = 64000;

// kind: 'intl' (международный), 'military', 'regional', 'strip' (грунт/горная площадка), 'carrier'
// runways[].heading — курс взлёта с торца A (рад); полоса симметрична относительно (cx, cz)
// side — с какой стороны от полосы 0 (по курсу: +1 справа, −1 слева) стоят перрон и постройки
export const AIRPORTS = [
  {
    id: 'yasny', name: 'Ясный', code: 'УЯСН', kind: 'intl', x: 0, z: 2000, elevation: 14, side: 1,
    runways: [
      { name: '09/27', heading: 90 * DEG, length: 3000, width: 60, cx: 0, cz: 2000 },
      { name: '03/21', heading: 30 * DEG, length: 2200, width: 45, cx: 900, cz: 600 },
    ],
    desc: 'Главный международный аэропорт архипелага.',
  },
  {
    id: 'kamenny', name: 'Каменный Мыс', code: 'УКМН', kind: 'military', x: -14000, z: -9000, elevation: 32, side: 1,
    runways: [{ name: '14/32', heading: 140 * DEG, length: 2500, width: 50, cx: -14000, cz: -9000 }],
    desc: 'Военная авиабаза на скалистом мысу.',
  },
  {
    id: 'gavan', name: 'Тихая Гавань', code: 'УТГВ', kind: 'regional', x: 11500, z: 9500, elevation: 6, side: 1,
    runways: [{ name: '06/24', heading: 60 * DEG, length: 1500, width: 35, cx: 11500, cz: 9500 }],
    desc: 'Небольшой аэропорт у рыбацкого городка.',
  },
  {
    id: 'gnezdo', name: 'Орлиное Гнездо', code: 'УОГН', kind: 'strip', x: 6500, z: -12500, elevation: 860, side: -1,
    runways: [{ name: '17/35', heading: 170 * DEG, length: 850, width: 25, cx: 6500, cz: -12500 }],
    desc: 'Горная площадка на плато. Короткая полоса, обрыв с обоих торцов.',
  },
  {
    id: 'mayak', name: 'Остров Маяк', code: 'УМАК', kind: 'strip', x: -9500, z: 15500, elevation: 9, side: 1,
    runways: [{ name: '11/29', heading: 110 * DEG, length: 750, width: 28, cx: -9500, cz: 15500 }],
    desc: 'Грунтовая полоса на маленьком острове с маяком.',
  },
  {
    id: 'polyarny', name: 'Полярный', code: 'УПЛР', kind: 'regional', x: 2500, z: -24500, elevation: 22, side: -1,
    runways: [{ name: '08/26', heading: 80 * DEG, length: 2000, width: 45, cx: 2500, cz: -24500 }],
    desc: 'Северный аэродром среди снегов.',
  },
  {
    id: 'yuzhny', name: 'Южный', code: 'УЮЖН', kind: 'regional', x: 18500, z: 21000, elevation: 8, side: 1,
    runways: [{ name: '01/19', heading: 10 * DEG, length: 1900, width: 45, cx: 18500, cz: 21000 }],
    desc: 'Курортный аэропорт на тёплом южном острове.',
  },
  {
    id: 'carrier', name: 'Авианосец «Буревестник»', code: 'БРВС', kind: 'carrier', x: -21000, z: 6000, elevation: 18, side: 1,
    runways: [{ name: 'Палуба', heading: 20 * DEG, length: 300, width: 40, cx: -21000, cz: 6000 }],
    desc: 'Тяжёлый авианесущий крейсер. Посадка на палубу — экзамен для лучших.',
  },
];

// Ориентиры и объекты для миссий/свободного полёта
export const POIS = [
  { id: 'city_yasny', name: 'город Ясный', kind: 'city', x: 2500, z: 5200 },
  { id: 'port_gavan', name: 'порт Тихой Гавани', kind: 'port', x: 12800, z: 10800 },
  { id: 'lighthouse', name: 'Старый маяк', kind: 'lighthouse', x: -10200, z: 16100 },
  { id: 'volcano', name: 'вулкан Дымный', kind: 'volcano', x: 15500, z: -6500 },
  { id: 'peak', name: 'пик Орлиный', kind: 'peak', x: 5200, z: -10200 },
  { id: 'dam', name: 'плотина Верхняя', kind: 'dam', x: -4500, z: -6000 },
  { id: 'observatory', name: 'обсерватория', kind: 'observatory', x: 8200, z: -14500 },
  { id: 'forest_west', name: 'Западный лес', kind: 'forest', x: -6500, z: -1500 },
  { id: 'resort', name: 'курорт Южный', kind: 'resort', x: 19800, z: 22500 },
  { id: 'station_north', name: 'полярная станция', kind: 'station', x: 4200, z: -26500 },
  { id: 'oilrig', name: 'буровая платформа', kind: 'oilrig', x: -24000, z: -18000 },
  { id: 'bridge', name: 'Большой мост', kind: 'bridge', x: 5500, z: 6500 },
];

export const AIRPORT_BY_ID = Object.fromEntries(AIRPORTS.map((a) => [a.id, a]));
export const POI_BY_ID = Object.fromEntries(POIS.map((p) => [p.id, p]));

// ---------- геометрия аэродромов (общая для рельефа, физики и отрисовки) ----------

// Положение точки относительно полосы: along — вдоль от центра (м, + в сторону курса heading), across — поперёк (+ вправо)
export function runwayLocal(rw, x, z) {
  const d = headingVec(rw.heading);
  const dx = x - rw.cx, dz = z - rw.cz;
  return { along: dx * d.x + dz * d.z, across: dx * -d.z + dz * d.x };
}

// Точка в мировых координатах по локальным координатам полосы (u вдоль курса, v вправо)
export function runwayPoint(rw, u, v) {
  const d = headingVec(rw.heading);
  return { x: rw.cx + d.x * u - d.z * v, z: rw.cz + d.z * u + d.x * v };
}

// Ориентированный прямоугольник в локальных координатах полосы rw: u0..u1 вдоль, v0..v1 поперёк.
function mkRect(rw, u0, u1, v0, v1, extra) {
  if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
  if (v0 > v1) { const t = v0; v0 = v1; v1 = t; }
  const d = headingVec(rw.heading);
  const c = runwayPoint(rw, (u0 + u1) / 2, (v0 + v1) / 2);
  return { cx: c.x, cz: c.z, ux: d.x, uz: d.z, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2, heading: rw.heading, u0, u1, v0, v1, ...extra };
}

// Планировка: перрон, рулёжки, стоянки, места построек. Всё в локальных координатах полосы 0.
function planAirport(a) {
  const rw = a.runways[0];
  const s = a.side || 1;
  const L = rw.length, W = rw.width;
  const rects = []; // surface 'apron' (перрон и рулёжки)
  const parking = [];
  const plan = { taxi: [], apron: [], pads: [] };
  const hdgToRunway = rw.heading - s * Math.PI / 2; // носом к полосе
  const addPark = (u, v, hdg, size) => {
    const p = runwayPoint(rw, u, v * s);
    parking.push({ x: p.x, z: p.z, heading: hdg, size });
  };
  const taxi = (u0, u1, v0, v1) => { const r = mkRect(rw, u0, u1, v0 * s, v1 * s, { kind: 'taxi' }); rects.push(r); plan.taxi.push(r); return r; };
  const apron = (u0, u1, v0, v1) => { const r = mkRect(rw, u0, u1, v0 * s, v1 * s, { kind: 'apron' }); rects.push(r); plan.apron.push(r); return r; };

  if (a.kind === 'intl') {
    const tv = 230; // ось магистральной РД
    taxi(-L / 2 + 20, L / 2 - 20, tv - 14, tv + 14);
    for (const u of [-L / 2 + 34, -700, 0, 700, L / 2 - 34]) taxi(u - 14, u + 14, W / 2, tv - 14);
    apron(-560, 620, tv + 14, tv + 230);
    apron(-1060, -640, tv + 14, tv + 130); // перрон у ангаров
    plan.terminal = { u: 30, v: tv + 275, len: 520, depth: 70 };
    plan.tower = { u: 430, v: tv + 300, h: 62 };
    plan.hangars = [{ u: -960, v: tv + 175, w: 90, d: 70 }, { u: -850, v: tv + 175, w: 90, d: 70 }, { u: -730, v: tv + 175, w: 110, d: 80 }];
    plan.tanks = { u: 760, v: tv + 120 };
    for (let i = 0; i < 6; i++) addPark(-200 + i * 86, tv + 172, hdgToRunway + Math.PI, 'L'); // у телетрапов, носом к терминалу
    for (let i = 0; i < 5; i++) addPark(-470 + i * 62, tv + 70, hdgToRunway, 'M');
    for (let i = 0; i < 5; i++) addPark(-1010 + i * 70, tv + 82, hdgToRunway, 'S');
  } else if (a.kind === 'military') {
    const tv = 180;
    taxi(-L / 2 + 20, L / 2 - 20, tv - 11, tv + 11);
    for (const u of [-L / 2 + 31, -400, 400, L / 2 - 31]) taxi(u - 11, u + 11, W / 2, tv - 11);
    apron(-330, 330, tv + 11, tv + 150);
    apron(-1010, -470, tv + 11, tv + 70); // рассредоточенные стоянки у укрытий
    plan.shelters = [];
    for (let i = 0; i < 6; i++) plan.shelters.push({ u: -970 + i * 92, v: tv + 100 });
    plan.tower = { u: 250, v: tv + 190, h: 30 };
    plan.hangars = [{ u: -230, v: tv + 195, w: 80, d: 60 }, { u: -120, v: tv + 195, w: 80, d: 60 }];
    plan.barracks = { u: 60, v: tv + 215 };
    plan.radar = { u: 620, v: tv + 260 };
    plan.tanks = { u: 480, v: tv + 90 };
    plan.sam = [{ u: 900, v: tv + 160 }, { u: -1150, v: -230 }];
    for (let i = 0; i < 6; i++) addPark(-250 + i * 62, tv + 80, hdgToRunway, 'M');
    for (let i = 0; i < 6; i++) addPark(-970 + i * 92, tv + 45, hdgToRunway, 'M');
  } else if (a.kind === 'regional') {
    const tv = 130;
    const half = Math.min(260, L * 0.16);
    for (const u of [-half + 40, half - 40]) taxi(u - 10, u + 10, W / 2, tv);
    apron(-half, half, tv, tv + 120);
    plan.terminal = { u: 20, v: tv + 150, len: 150, depth: 36 };
    plan.tower = { u: half - 60, v: tv + 160, h: 28 };
    plan.hangars = [{ u: -half + 30, v: tv + 160, w: 60, d: 46 }, { u: -half + 105, v: tv + 160, w: 50, d: 40 }];
    plan.tanks = { u: half + 40, v: tv + 60 };
    for (let i = 0; i < 4; i++) addPark(-half + 60 + i * ((half * 2 - 120) / 3), tv + 62, hdgToRunway, 'M');
    for (let i = 0; i < 3; i++) addPark(-half + 40 + i * 44, tv + 100, hdgToRunway, 'S');
  } else if (a.kind === 'strip') {
    const v0 = W / 2 + 6;
    apron(-70, 70, v0, v0 + 62);
    taxi(-12, 12, W / 2, v0);
    plan.hut = { u: 96, v: v0 + 34 };
    plan.hangars = [{ u: -105, v: v0 + 36, w: 34, d: 26 }];
    for (let i = 0; i < 3; i++) addPark(-44 + i * 40, v0 + 34, hdgToRunway, 'S');
  } else if (a.kind === 'carrier') {
    // стоянки на правом борту у «острова», вне посадочной полосы
    for (let i = 0; i < 3; i++) addPark(-110 + i * 34, 25, rw.heading - 0.5, 'M');
    addPark(96, 25, rw.heading - 0.5, 'M');
  }

  // доп. рулёжка ко второй полосе Ясного: от её юго-западного торца к главной полосе
  if (a.id === 'yasny') {
    const r2 = a.runways[1];
    const r = mkRect(r2, -r2.length / 2 - 500, -r2.length / 2, -13, 13, { kind: 'taxi' });
    rects.push(r); plan.taxi.push(r);
  }

  // зона выравнивания: прямоугольники [полосы с запасом + перрон/постройки] в локальных координатах
  const flat = [];
  const strip = a.kind === 'strip';
  const endM = strip ? 70 : 220, sideM = strip ? 75 : 170;
  for (const r of a.runways) flat.push(mkRect(r, -r.length / 2 - endM, r.length / 2 + endM, -r.width / 2 - sideM, r.width / 2 + sideM));
  if (a.kind !== 'carrier') {
    let vmax = 0, umin = 0, umax = 0;
    for (const r of rects) { vmax = Math.max(vmax, Math.abs(r.v0), Math.abs(r.v1)); umin = Math.min(umin, r.u0); umax = Math.max(umax, r.u1); }
    const extra = a.kind === 'intl' ? 150 : a.kind === 'military' ? 170 : strip ? 20 : 120;
    if (a.id === 'yasny') { umin = -1160; umax = 900; }
    flat.push(mkRect(rw, umin - 60, umax + 80, 0, (vmax + extra) * s));
  }
  a.aprons = rects;
  a.parking = parking;
  a.plan = plan;
  a.flat = flat;
  a.blend = a.kind === 'strip' ? (a.id === 'gnezdo' ? 420 : 420) : a.kind === 'intl' ? 1500 : 1000;
  a.radius = Math.max(...a.runways.map((r) => Math.hypot(r.cx - a.x, r.cz - a.z) + r.length / 2)) + 1400;
}
for (const a of AIRPORTS) planAirport(a);

// Авианосец: размеры палубы (вся палуба — поверхность 'carrier')
export const CARRIER = {
  x: AIRPORT_BY_ID.carrier.x, z: AIRPORT_BY_ID.carrier.z, heading: AIRPORT_BY_ID.carrier.runways[0].heading,
  deckY: AIRPORT_BY_ID.carrier.elevation, length: 312, width: 68, speed: 0,
};

// Водохранилище у плотины: эллипс, вытянутый от плотины на юго-восток
const damP = POI_BY_ID.dam;
export const LAKE = {
  level: 150, ax: Math.SQRT1_2, az: Math.SQRT1_2, // ось от плотины вглубь
  damX: damP.x, damZ: damP.z,
  cx: damP.x + Math.SQRT1_2 * 1450, cz: damP.z + Math.SQRT1_2 * 1450, a: 1500, b: 620,
};
