// АВТОПИЛОТ И НАВИГАЦИЯ (заглушка v0 — заменяется агентом «Системы самолёта»). Контракт — в ARCHITECTURE.md.
export function createAutoflight(G) {
  return {
    active: false,        // автопилот включён
    mode: null,           // 'hold' | 'nav' | 'approach' | null
    destination: null,    // { airportId, name, x, z } | null — пункт назначения свободного полёта
    engage(mode, opts) {},
    disengage() {},
    setDestination(airportId) {},
    update(dt) {},        // ядро зовёт каждый шаг симуляции сразу после ручного ввода
  };
}
