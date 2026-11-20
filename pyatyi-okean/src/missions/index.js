// МИССИИ (заглушка v0 — заменяется агентом «Миссии»). Контракт — в ARCHITECTURE.md.
export function createMissions(G) {
  const list = [
    { id: 'first_flight', title: 'Первый вылет', category: 'training', plane: 'yak52', brief: 'Взлетите с полосы 09 аэропорта Ясный и наберите 300 метров.', reward: { money: 500, xp: 100 } },
  ];
  const missions = {
    list,
    byId: Object.fromEntries(list.map((m) => [m.id, m])),
    active: null,
    // параметры полёта для миссии: то, что передаётся в G.startFlight (planeId, airportId, air, timeOfDay, weather)
    flightParams(id) { return { planeId: 'yak52', airportId: 'yasny' }; },
    start(id) {
      const def = missions.byId[id];
      if (!def) return;
      missions.active = { def, t: 0 };
      G.hud.setObjective('Взлетите и наберите 300 м');
    },
    stop() { missions.active = null; },
    update(dt) {
      const a = missions.active;
      if (!a || !G.player) return;
      a.t += dt;
      if (G.player.agl > 300) {
        missions.active = null;
        G.career.addReward(a.def.reward);
        G.endFlight({ reason: 'mission_complete', success: true, title: 'Задание выполнено', text: a.def.title, missionId: a.def.id, stars: 3, reward: a.def.reward });
      }
    },
  };
  return missions;
}
