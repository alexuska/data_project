// Карта мира «Архипелаг Семи Ветров»: данные об островах, аэродромах и ориентирах.
// Мир — квадрат WORLD_SIZE × WORLD_SIZE метров с центром в (0,0). Север = −Z, восток = +X.
// ВАЖНО: id аэродромов и ориентиров стабильны — на них ссылаются миссии. Координаты можно уточнять.
import { DEG } from '../core/util.js';

export const WORLD_SIZE = 64000;

// kind: 'intl' (международный), 'military', 'regional', 'strip' (грунт/горная площадка), 'carrier'
// runways[].heading — курс взлёта с торца A (рад); полоса симметрична относительно (cx, cz)
export const AIRPORTS = [
  {
    id: 'yasny', name: 'Ясный', code: 'УЯСН', kind: 'intl', x: 0, z: 2000, elevation: 14,
    runways: [
      { name: '09/27', heading: 90 * DEG, length: 3000, width: 60, cx: 0, cz: 2000 },
      { name: '03/21', heading: 30 * DEG, length: 2200, width: 45, cx: 900, cz: 600 },
    ],
    desc: 'Главный международный аэропорт архипелага.',
  },
  {
    id: 'kamenny', name: 'Каменный Мыс', code: 'УКМН', kind: 'military', x: -14000, z: -9000, elevation: 32,
    runways: [{ name: '14/32', heading: 140 * DEG, length: 2500, width: 50, cx: -14000, cz: -9000 }],
    desc: 'Военная авиабаза на скалистом мысу.',
  },
  {
    id: 'gavan', name: 'Тихая Гавань', code: 'УТГВ', kind: 'regional', x: 11500, z: 9500, elevation: 6,
    runways: [{ name: '06/24', heading: 60 * DEG, length: 1500, width: 35, cx: 11500, cz: 9500 }],
    desc: 'Небольшой аэропорт у рыбацкого городка.',
  },
  {
    id: 'gnezdo', name: 'Орлиное Гнездо', code: 'УОГН', kind: 'strip', x: 6500, z: -12500, elevation: 860,
    runways: [{ name: '17/35', heading: 170 * DEG, length: 850, width: 25, cx: 6500, cz: -12500 }],
    desc: 'Горная площадка на плато. Короткая полоса, обрыв с обоих торцов.',
  },
  {
    id: 'mayak', name: 'Остров Маяк', code: 'УМАК', kind: 'strip', x: -9500, z: 15500, elevation: 9,
    runways: [{ name: '11/29', heading: 110 * DEG, length: 750, width: 28, cx: -9500, cz: 15500 }],
    desc: 'Грунтовая полоса на маленьком острове с маяком.',
  },
  {
    id: 'polyarny', name: 'Полярный', code: 'УПЛР', kind: 'regional', x: 2500, z: -24500, elevation: 22,
    runways: [{ name: '08/26', heading: 80 * DEG, length: 2000, width: 45, cx: 2500, cz: -24500 }],
    desc: 'Северный аэродром среди снегов.',
  },
  {
    id: 'yuzhny', name: 'Южный', code: 'УЮЖН', kind: 'regional', x: 18500, z: 21000, elevation: 8,
    runways: [{ name: '01/19', heading: 10 * DEG, length: 1900, width: 45, cx: 18500, cz: 21000 }],
    desc: 'Курортный аэропорт на тёплом южном острове.',
  },
  {
    id: 'carrier', name: 'Авианосец «Буревестник»', code: 'БРВС', kind: 'carrier', x: -21000, z: 6000, elevation: 18,
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
