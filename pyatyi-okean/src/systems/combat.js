// БОЙ (заглушка v0 — заменяется агентом «Бой и ИИ»). Контракт — в ARCHITECTURE.md.
export function createCombat(G) {
  return {
    targets: [],          // наземные/морские цели
    playerTarget: null,
    armAircraft(ac, loadout) { ac.weapons = null; },
    spawnGroundTarget(opts) { return null; },
    damage(entity, amount, source) {},
    clear() { this.targets.length = 0; this.playerTarget = null; },
    update(dt) {},
  };
}
