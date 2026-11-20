// ЗВУК (заглушка v0 — заменяется агентом «Эффекты и звук»). Контракт — в ARCHITECTURE.md.
export function createAudio(G) {
  return {
    unlock() {},            // вызвать из первого жеста пользователя
    play(name, opts) {},    // разовый звук
    setVolume(sound, music) {},
    update(dt) {},
  };
}
