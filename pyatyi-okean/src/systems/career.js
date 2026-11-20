// КАРЬЕРА (заглушка v0 — заменяется агентом «Меню и карьера»). Контракт — в ARCHITECTURE.md.
import { RANKS, ECONOMY } from './economy.js';
import { saveProfile } from '../core/save.js';

export function createCareer(G) {
  const p = () => G.profile;
  const career = {
    rank() {
      let i = 0;
      while (i + 1 < RANKS.length && p().xp >= RANKS[i + 1].xp) i++;
      return { index: i, name: RANKS[i].name, xp: p().xp, nextXp: RANKS[i + 1] ? RANKS[i + 1].xp : null };
    },
    owns(id) { return p().owned.includes(id); },
    canBuy(id) {
      const e = ECONOMY[id];
      if (!e) return { ok: false, reason: 'Недоступно' };
      if (career.owns(id)) return { ok: false, reason: 'Уже в ангаре' };
      if (career.rank().index < e.rank) return { ok: false, reason: `Нужно звание «${RANKS[e.rank].name}»` };
      if (p().money < e.price) return { ok: false, reason: 'Не хватает средств' };
      return { ok: true };
    },
    buy(id) {
      if (!career.canBuy(id).ok) return false;
      p().money -= ECONOMY[id].price;
      p().owned.push(id);
      career.changed();
      return true;
    },
    select(id) { if (career.owns(id)) { p().selectedPlane = id; career.changed(); } },
    addReward({ money = 0, xp = 0 } = {}) { p().money += Math.round(money); p().xp += Math.round(xp); career.changed(); },
    // модификаторы улучшений для ac.mods
    planeMods(id) { return { thrust: 1, drag: 1, agility: 1 }; },
    changed() { saveProfile(p()); G.bus.emit('career:changed'); },
  };
  return career;
}
