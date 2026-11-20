// ЭФФЕКТЫ (заглушка v0 — заменяется агентом «Эффекты и звук»). Контракт — в ARCHITECTURE.md.
export function createFx(G) {
  return {
    explosion(pos, size = 1) {},
    smokePuff(pos, opts) {},
    splash(pos, size = 1) {},
    dust(pos, size = 1) {},
    tracer(from, to, opts) {},
    fire(pos, size = 1) { return { pos, size, stop() {} }; },
    waterDrop(pos, vel, amount) {},
    clear() {},
    update(dt) {},
  };
}
