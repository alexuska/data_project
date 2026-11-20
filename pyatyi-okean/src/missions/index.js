// ЗАДАНИЯ. Контракт — в ARCHITECTURE.md (раздел «Миссии» и «Описание задания»).
// Сценарии — в training.js, civil.js, rescue.js, combat.js; движок шагов — engine.js; помощники — lib.js.
import { createRunner } from './engine.js';
import { createErrands } from './errands.js';
import { firstFlight, dniesterCircle, aeroSchool } from './training.js';
import * as civil from './civil.js';
import * as special from './special.js';
import * as combat from './combat.js';

const ALL = [
  firstFlight, dniesterCircle, aeroSchool,
  civil.mailMayak, civil.moscowSnow, civil.parisEvening,
  special.fireResort, special.chkalov,
  combat.rangeL39, combat.intercept,
].filter(Boolean);

export function createMissions(G) {
  const byMission = Object.fromEntries(ALL.map((x) => [x.def.id, x]));
  const list = ALL.map((x) => x.def);
  let runner = null;

  function pickPlane(def) {
    if (def.plane) return def.plane;
    const mp = G.career && G.career.missionPlanes ? G.career.missionPlanes(def.id) : null;
    if (mp && mp.pick) return mp.pick;
    return (def.planes && def.planes[0]) || 'yak52';
  }

  const missions = {
    list,
    byId: Object.fromEntries(list.map((d) => [d.id, d])),
    active: null,
    // параметры полёта для G.startFlight: planeId, airportId/runway/end или air, timeOfDay, weather
    flightParams(id) {
      const mi = byMission[id];
      if (!mi) return {};
      const s = mi.session ? mi.session(G, G.world) : {};
      return { planeId: pickPlane(mi.def), ...s };
    },
    start(id) {
      missions.stop();
      const mi = byMission[id];
      if (!mi) return;
      runner = createRunner(G, mi);
      missions.active = runner;
      runner.start();
    },
    stop() {
      if (runner) runner.stop();
      runner = null;
      missions.active = null;
      G.hud?.setAction?.(null);
    },
    update(dt) {
      if (runner) runner.update(dt);
      else if (missions.errands) missions.errands.update(dt);
    },
  };
  // поручения вышки в свободном полёте (missions/errands.js)
  missions.errands = createErrands(G);
  return missions;
}
