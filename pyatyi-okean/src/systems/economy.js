// ЭКОНОМИКА: звания, цены самолётов, улучшения, правила начислений. Ключи = id из aircraft/catalog.js.
// Здесь только данные и чистые функции — логика начислений в career.js.
import { CATALOG_BY_ID } from '../aircraft/catalog.js';

export const CURRENCY = '₽';

// 10 званий. Индекс звания используется в requires.rank заданий и в ECONOMY[id].rank.
export const RANKS = [
  { name: 'Курсант', xp: 0 },
  { name: 'Пилот-стажёр', xp: 250 },
  { name: 'Пилот 3-го класса', xp: 700 },
  { name: 'Пилот 2-го класса', xp: 1500 },
  { name: 'Пилот 1-го класса', xp: 3000 },
  { name: 'Командир экипажа', xp: 5000 },
  { name: 'Командир звена', xp: 8000 },
  { name: 'Лётчик-инструктор', xp: 12000 },
  { name: 'Лётчик-испытатель', xp: 17000 },
  { name: 'Заслуженный пилот', xp: 24000 },
];

// Цены и требуемые звания. Две ветки растут параллельно: гражданская и военная.
// Расчёт: вечер ≈ 10–12 полётов; Ан-2 — после 2–3 учебных заданий, «тяжёлые» и Су-27 — цель 3–4-го вечера.
export const ECONOMY = {
  yak52: { price: 0, rank: 0 },
  an2: { price: 3000, rank: 1 },
  l39: { price: 7000, rank: 2 },
  l410: { price: 9000, rank: 2 },
  mig21: { price: 16000, rank: 3 },
  yak40: { price: 20000, rank: 4 },
  su25: { price: 28000, rank: 5 },
  be200: { price: 32000, rank: 5 },
  mig29: { price: 45000, rank: 6 },
  tu154: { price: 55000, rank: 7 },
  il76: { price: 75000, rank: 8 },
  su27: { price: 85000, rank: 8 },
};

// Ориентир наград за задание по сложности 1..5 (для авторов заданий): { money, xp }.
export const REWARD_GUIDE = [null, { money: 500, xp: 100 }, { money: 1000, xp: 180 }, { money: 1800, xp: 280 }, { money: 3000, xp: 420 }, { money: 4500, xp: 600 }];

// Ветки улучшений: по 3 уровня. step — прибавка за уровень к соответствующему множителю.
// roles — кому доступна ветка. mod — ключ в career.planeMods(id).
export const UPGRADE_BRANCHES = [
  { id: 'engine', name: 'Двигатель', mod: 'thrust', step: 0.04, unit: 'тяги', sign: '+', roles: ['civil', 'military'], desc: 'Переборка и регулировка силовой установки: энергичнее разбег и набор высоты.' },
  { id: 'aero', name: 'Аэродинамика', mod: 'drag', step: -0.04, unit: 'сопротивления', sign: '−', roles: ['civil', 'military'], desc: 'Зализы, герметизация щелей, полировка обшивки: выше скорость, меньше расход.' },
  { id: 'controls', name: 'Управляемость', mod: 'agility', step: 0.05, unit: 'к угловым скоростям', sign: '+', roles: ['civil', 'military'], desc: 'Бустеры и точная проводка управления: самолёт охотнее идёт за ручкой.' },
  { id: 'tanks', name: 'Баки', mod: 'fuel', step: 0.1, unit: 'топлива', sign: '+', roles: ['civil', 'military'], desc: 'Дополнительные топливные баки: дальше маршрут, спокойнее на глиссаде.' },
  { id: 'payload', name: 'Коммерческая загрузка', mod: 'payout', step: 0.05, unit: 'к оплате заданий', sign: '+', roles: ['civil'], desc: 'Новый салон и грузовое оборудование: каждый рейс на этом борту оплачивается лучше.' },
  { id: 'combat', name: 'Вооружение и броня', mod: 'ammo', step: 0.15, unit: 'боезапаса пушки', sign: '+', roles: ['military'], desc: 'Увеличенный боекомплект и бронезащита кабины: на 10% меньше повреждений за уровень.' },
];
export const UPGRADE_MAX = 3;
const UPGRADE_COST_K = [0.04, 0.07, 0.11];

export function upgradeBranches(planeId) {
  const spec = CATALOG_BY_ID[planeId];
  if (!spec) return [];
  return UPGRADE_BRANCHES.filter((b) => b.roles.includes(spec.role));
}

// цена перехода на уровень level (1..3)
export function upgradeCost(planeId, level) {
  const base = Math.max(ECONOMY[planeId]?.price || 0, 5000);
  return Math.round((base * UPGRADE_COST_K[level - 1]) / 50) * 50;
}

// ---- правила начислений ----
export const STAR_BONUS = [0, 0, 0.25, 0.5];          // надбавка к награде задания за 0/1/2/3 звезды
export const REPEAT_K = { money: 0.35, xp: 0.25 };    // повторное выполнение задания
export const FLIGHT_TIME_PAY = { money: 30, xp: 5, capMin: 30, minSec: 40 }; // за минуту налёта
export const LANDING_PAY = {
  perfect: { money: 400, xp: 60, label: 'отлично' },
  good: { money: 250, xp: 40, label: 'хорошо' },
  fair: { money: 120, xp: 20, label: 'удовлетворительно' },
  rough: { money: 40, xp: 5, label: 'грубо' },
};
export const LANDING_MAX_PAID = 3;
// сложные площадки оплачиваются выше
export const AIRPORT_K = { carrier: 3, gnezdo: 2, mayak: 1.5 };
export const FIRST_VISIT_PAY = { default: { money: 600, xp: 120 }, gnezdo: { money: 1000, xp: 200 }, carrier: { money: 1500, xp: 300 } };
export const PLACE_PAY = { money: 150, xp: 30 };     // открытый ориентир
export const KILL_PAY = { air: { money: 100, xp: 20 }, ground: { money: 60, xp: 10 } };
export const REPAIR = { k: 0.03, min: 100, max: 1500 }; // ремонт после аварии: доля цены самолёта
export const DAILY_BONUS = [300, 450, 600, 800, 1000]; // ежедневное довольствие по дням подряд
