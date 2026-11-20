// ПИЛОТАЖ (заглушка v0 — заменяется агентом «Пилотаж»). Контракт — в ARCHITECTURE.md.
export function createAerobatics(G) {
  return {
    score: 0,          // очки пилотажа за текущий полёт
    done: [],          // выполненные фигуры за полёт: [{ id, name, score, t }]
    update(dt) {},
  };
}
