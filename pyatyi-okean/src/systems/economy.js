// ЭКОНОМИКА (заглушка v0 — владелец: агент «Меню и карьера»). Цены, звания, улучшения. Ключи = id из catalog.js.
export const RANKS = [
  { name: 'Курсант', xp: 0 },
  { name: 'Пилот 3-го класса', xp: 500 },
  { name: 'Пилот 2-го класса', xp: 1500 },
  { name: 'Пилот 1-го класса', xp: 4000 },
  { name: 'Командир экипажа', xp: 9000 },
  { name: 'Лётчик-снайпер', xp: 18000 },
  { name: 'Заслуженный пилот', xp: 32000 },
];

export const ECONOMY = {
  yak52: { price: 0, rank: 0 },
  an2: { price: 4000, rank: 0 },
  l39: { price: 9000, rank: 1 },
  l410: { price: 12000, rank: 1 },
  yak40: { price: 26000, rank: 2 },
  mig21: { price: 30000, rank: 2 },
  su25: { price: 48000, rank: 3 },
  be200: { price: 60000, rank: 3 },
  tu154: { price: 85000, rank: 4 },
  mig29: { price: 95000, rank: 4 },
  il76: { price: 140000, rank: 5 },
  su27: { price: 160000, rank: 5 },
};
