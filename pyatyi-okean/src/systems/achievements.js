// ДОСТИЖЕНИЯ: список и слежение за полётом. Владелец — «Меню и карьера».
// Достижение либо считается по профилю (value(p) / goal), либо выставляется событием (трекер зовёт unlock(id)).
import { CATALOG } from '../aircraft/catalog.js';

const civil = CATALOG.filter((s) => s.role === 'civil').map((s) => s.id);
const military = CATALOG.filter((s) => s.role === 'military').map((s) => s.id);
const ownedOf = (p, ids) => ids.filter((id) => p.owned.includes(id)).length;
const R = (money, xp) => ({ money, xp });

// icon — имя значка из ui/menu-kit.js (ICONS)
export const ACHIEVEMENTS = [
  // --- первые шаги и налёт ---
  { id: 'first_flight', title: 'Первый вылет', desc: 'Завершить первый полёт.', icon: 'plane', reward: R(200, 50), goal: 1, value: (p) => p.stats.flights },
  { id: 'hours_1', title: 'Первый час', desc: 'Налетать 1 час.', icon: 'clock', reward: R(500, 100), goal: 60, unit: 'мин', value: (p) => p.stats.flightTime / 60 },
  { id: 'hours_5', title: 'Пять часов в небе', desc: 'Налетать 5 часов.', icon: 'clock', reward: R(2000, 400), goal: 300, unit: 'мин', value: (p) => p.stats.flightTime / 60 },
  { id: 'hours_10', title: 'Десять часов налёта', desc: 'Налетать 10 часов.', icon: 'clock', reward: R(5000, 800), goal: 600, unit: 'мин', value: (p) => p.stats.flightTime / 60 },
  { id: 'dist_100', title: 'Дальний перелёт', desc: 'Пролететь 100 км за один полёт.', icon: 'route', reward: R(800, 150), goal: 100, unit: 'км', value: (p) => (p.stats.bestDistance || 0) / 1000 },
  { id: 'dist_1000', title: 'Тысяча километров', desc: 'Пролететь в сумме 1000 км.', icon: 'route', reward: R(1500, 300), goal: 1000, unit: 'км', value: (p) => p.stats.distance / 1000 },
  // --- посадки ---
  { id: 'landings_10', title: 'Десять посадок', desc: 'Выполнить 10 посадок.', icon: 'landing', reward: R(500, 100), goal: 10, value: (p) => p.stats.landings },
  { id: 'landings_50', title: 'Полсотни посадок', desc: 'Выполнить 50 посадок.', icon: 'landing', reward: R(1500, 300), goal: 50, value: (p) => p.stats.landings },
  { id: 'landings_100', title: 'Сто посадок', desc: 'Выполнить 100 посадок.', icon: 'landing', reward: R(4000, 600), goal: 100, value: (p) => p.stats.landings },
  { id: 'perfect_1', title: 'Притёр!', desc: 'Идеальная посадка: мягко и точно по оси полосы.', icon: 'feather', reward: R(400, 80), goal: 1, value: (p) => p.stats.perfectLandings },
  { id: 'perfect_10', title: 'Мастер мягкой посадки', desc: '10 идеальных посадок.', icon: 'feather', reward: R(2000, 400), goal: 10, value: (p) => p.stats.perfectLandings },
  { id: 'touch_go', title: 'Конвейер', desc: 'Три посадки за один полёт.', icon: 'landing', reward: R(500, 100) },
  { id: 'heavy_perfect', title: 'Тяжёлая, а как пёрышко', desc: 'Идеальная посадка на Ту-154 или Ил-76.', icon: 'feather', reward: R(1500, 300) },
  { id: 'night_landing', title: 'Ночной гость', desc: 'Посадка ночью.', icon: 'moon', reward: R(600, 120) },
  { id: 'storm_landing', title: 'Сквозь грозу', desc: 'Посадка в грозу.', icon: 'storm', reward: R(1000, 200) },
  { id: 'fog_landing', title: 'По приборам', desc: 'Посадка в тумане.', icon: 'fog', reward: R(800, 150) },
  { id: 'gnezdo_landing', title: 'Орлиное Гнездо', desc: 'Сесть на горную площадку Орлиное Гнездо.', icon: 'peak', reward: R(1200, 250) },
  { id: 'carrier_landing', title: 'Палубный лётчик', desc: 'Сесть на авианосец «Буревестник».', icon: 'anchor', reward: R(2500, 500) },
  { id: 'water_landing', title: 'Летающая лодка', desc: 'Приводниться на амфибии.', icon: 'wave', reward: R(800, 150) },
  { id: 'fumes', title: 'На последних каплях', desc: 'Посадка с остатком топлива меньше 5%.', icon: 'fuel', reward: R(1500, 300) },
  { id: 'deadstick', title: 'Планёр поневоле', desc: 'Посадка с неработающим двигателем.', icon: 'fuel', reward: R(1500, 300) },
  // --- высота, скорость, пилотаж ---
  { id: 'alt_5k', title: 'Выше облаков', desc: 'Набрать 5000 метров.', icon: 'altitude', reward: R(400, 80) },
  { id: 'alt_10k', title: 'Потолок', desc: 'Набрать 10 000 метров.', icon: 'altitude', reward: R(1000, 200) },
  { id: 'speed_1000', title: 'Тысяча в час', desc: 'Разогнаться до 1000 км/ч.', icon: 'speed', reward: R(600, 120) },
  { id: 'supersonic', title: 'Звуковой барьер', desc: 'Превысить скорость звука.', icon: 'speed', reward: R(1000, 200) },
  { id: 'low_pass', title: 'Бреющий полёт', desc: '10 секунд ниже 20 метров на скорости больше 250 км/ч.', icon: 'lowpass', reward: R(800, 150) },
  { id: 'roll', title: 'Бочка', desc: 'Выполнить полный оборот по крену.', icon: 'aerobatics', reward: R(300, 60) },
  { id: 'loop', title: 'Петля Нестерова', desc: 'Выполнить мёртвую петлю.', icon: 'aerobatics', reward: R(500, 100) },
  { id: 'bridge', title: 'Чкаловский пролёт', desc: 'Пролететь под Большим мостом.', icon: 'bridge', reward: R(1500, 300) },
  // --- география ---
  { id: 'all_airports', title: 'Знаю каждую полосу', desc: 'Сесть на всех аэродромах архипелага.', icon: 'pin', reward: R(5000, 1000), goal: 8, value: (p) => Object.keys(p.visited || {}).length },
  { id: 'explorer', title: 'Картограф', desc: 'Открыть все ориентиры архипелага.', icon: 'compass', reward: R(3000, 600), goal: 12, value: (p) => Object.keys(p.places || {}).length },
  // --- карьера ---
  { id: 'missions_10', title: 'Десять заданий', desc: 'Выполнить 10 разных заданий.', icon: 'flag', reward: R(1000, 200), goal: 10, value: (p) => doneCount(p) },
  { id: 'missions_30', title: 'Тридцать заданий', desc: 'Выполнить 30 разных заданий.', icon: 'flag', reward: R(4000, 800), goal: 30, value: (p) => doneCount(p) },
  { id: 'stars_10', title: 'Отличник', desc: '10 заданий на три звезды.', icon: 'star', reward: R(1500, 300), goal: 10, value: (p) => threeStars(p) },
  { id: 'stars_30', title: 'Круглый отличник', desc: '30 заданий на три звезды.', icon: 'star', reward: R(5000, 1000), goal: 30, value: (p) => threeStars(p) },
  { id: 'rank_5', title: 'Командир экипажа', desc: 'Дослужиться до командира экипажа.', icon: 'medal', reward: R(2000, 0), goal: 5, value: (p, c) => c.rank().index },
  { id: 'rank_9', title: 'Заслуженный пилот', desc: 'Получить высшее звание.', icon: 'medal', reward: R(10000, 0), goal: 9, value: (p, c) => c.rank().index },
  { id: 'streak_3', title: 'Три вечера подряд', desc: 'Заходить в игру три дня подряд.', icon: 'sunrise', reward: R(1500, 300), goal: 3, value: (p) => p.daily?.best || 0 },
  // --- ангар ---
  { id: 'fleet_3', title: 'Свой ангар', desc: 'Иметь 3 самолёта.', icon: 'hangar', reward: R(500, 100), goal: 3, value: (p) => p.owned.length },
  { id: 'fleet_6', title: 'Авиапарк', desc: 'Иметь 6 самолётов.', icon: 'hangar', reward: R(2000, 400), goal: 6, value: (p) => p.owned.length },
  { id: 'fleet_civil', title: 'Гражданский флот', desc: 'Собрать все гражданские самолёты.', icon: 'hangar', reward: R(6000, 1000), goal: civil.length, value: (p) => ownedOf(p, civil) },
  { id: 'fleet_military', title: 'Боевой полк', desc: 'Собрать все военные самолёты.', icon: 'hangar', reward: R(6000, 1000), goal: military.length, value: (p) => ownedOf(p, military) },
  { id: 'fleet_all', title: 'Полный ангар', desc: 'Собрать все самолёты.', icon: 'hangar', reward: R(10000, 2000), goal: CATALOG.length, value: (p) => ownedOf(p, CATALOG.map((s) => s.id)) },
  { id: 'upgrade_max', title: 'До последнего винтика', desc: 'Полностью улучшить один самолёт.', icon: 'wrench', reward: R(2000, 400), goal: 1, value: (p, c) => (c.fullyUpgraded?.() ? 1 : 0) },
  // --- бой ---
  { id: 'ace', title: 'Ас', desc: 'Сбить 5 самолётов условного противника.', icon: 'target', reward: R(1500, 300), goal: 5, value: (p) => p.stats.kills },
  { id: 'ace_25', title: 'Гроза неба', desc: 'Сбить 25 самолётов условного противника.', icon: 'target', reward: R(5000, 1000), goal: 25, value: (p) => p.stats.kills },
  { id: 'ground_10', title: 'Штурмовик', desc: 'Поразить 10 наземных и морских целей.', icon: 'target', reward: R(1500, 300), goal: 10, value: (p) => p.stats.groundKills },
];
export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

function doneCount(p) { let n = 0; for (const k in p.missions) if (p.missions[k]?.done) n++; return n; }
function threeStars(p) { let n = 0; for (const k in p.missions) if (p.missions[k]?.stars >= 3) n++; return n; }

// Слежение за полётом. api: { unlock(id), discover(poi), landing(e), bounce(e) }.
// update(dt) зовётся из career.update на каждом шаге симуляции — никаких аллокаций.
export function createTracker(G, api) {
  const T = {
    active: false, acc: 0, airT: 0, lowT: 0, poiT: 0,
    rollAcc: 0, rollSign: 0, rollIdle: 0, loopAcc: 0, loopIdle: 0, loopInv: false,
    kills: 0, groundKills: 0, realLandings: 0,
  };
  function reset(active) {
    T.active = active; T.acc = 0; T.airT = 0; T.lowT = 0; T.poiT = 0;
    T.rollAcc = 0; T.rollSign = 0; T.rollIdle = 0; T.loopAcc = 0; T.loopIdle = 0; T.loopInv = false;
    T.kills = 0; T.groundKills = 0; T.realLandings = 0;
  }
  const isPlayer = (by) => !!by && (by === G.player || by.isPlayer === true);

  G.bus.on('ac:destroyed', (e) => { if (T.active && e && isPlayer(e.by) && e.ac !== G.player) T.kills++; });
  G.bus.on('target:destroyed', (e) => { if (T.active && e && isPlayer(e.by)) T.groundKills++; });
  G.bus.on('ac:touchdown', (e) => {
    const ac = e && e.ac;
    if (!T.active || !ac || ac !== G.player) return;
    const real = T.airT >= 8; // иначе — подскок («козёл») или стартовая постановка
    T.airT = 0;
    if (!real) { api.bounce(e); return; }
    T.realLandings++;
    api.landing(e);
    const w = G.world || {};
    const tod = w.timeOfDay ?? 12;
    const wx = w.weather ? w.weather.type : 'clear';
    if (tod < 5.5 || tod >= 21) api.unlock('night_landing');
    if (wx === 'storm') api.unlock('storm_landing');
    if (wx === 'fog') api.unlock('fog_landing');
    const apId = e.airport ? e.airport.id : null;
    if (apId === 'carrier' || e.surface === 'carrier') api.unlock('carrier_landing');
    if (apId === 'gnezdo') api.unlock('gnezdo_landing');
    if (e.surface === 'water' && ac.spec && ac.spec.amphibian) api.unlock('water_landing');
    if (apId) {
      if (ac.fuelMax > 0 && ac.fuel / ac.fuelMax < 0.05) api.unlock('fumes');
      if (ac.engineOn === false || ac.fuel <= 0) api.unlock('deadstick');
    }
    if (T.realLandings >= 3) api.unlock('touch_go');
  });

  return {
    state: T,
    start(active) { reset(active); },
    stop() { T.active = false; },
    update(dt) {
      const ac = G.player;
      if (!T.active || !ac || !ac.alive) return;
      if (ac.onGround) { T.rollAcc = 0; T.loopAcc = 0; T.loopInv = false; T.lowT = 0; T.acc += dt; if (T.acc >= 0.5) T.acc = 0; return; }
      T.airT += dt;
      // пилотаж: интегрируем угловые скорости в связанных осях
      const rz = ac.angVel.z, rx = ac.angVel.x;
      if (rz > 0.6 || rz < -0.6) {
        const s = rz > 0 ? 1 : -1;
        if (s !== T.rollSign) { T.rollSign = s; T.rollAcc = 0; }
        T.rollAcc += rz * s * dt; T.rollIdle = 0;
        if (T.rollAcc >= 6.1) { T.rollAcc = 0; api.unlock('roll'); }
      } else { T.rollIdle += dt; if (T.rollIdle > 1) T.rollAcc = 0; }
      if (rx > 0.12) {
        T.loopAcc += rx * dt; T.loopIdle = 0;
        const q = ac.quat;
        if (1 - 2 * (q.x * q.x + q.z * q.z) < -0.5) T.loopInv = true; // побывали «на спине»
        if (T.loopAcc >= 5.9 && T.loopInv) { T.loopAcc = 0; T.loopInv = false; api.unlock('loop'); }
      } else { T.loopIdle += dt; if (T.loopIdle > 1.5) { T.loopAcc = 0; T.loopInv = false; } }

      // редкие проверки
      T.acc += dt;
      if (T.acc < 0.5) return;
      const step = T.acc; T.acc = 0;
      if (ac.mach >= 1) api.unlock('supersonic');
      if (ac.tas * 3.6 >= 1000) api.unlock('speed_1000');
      if (ac.alt >= 5000) api.unlock('alt_5k');
      if (ac.alt >= 10000) api.unlock('alt_10k');
      if (ac.agl < 20 && ac.tas > 69.4) { T.lowT += step; if (T.lowT >= 10) { T.lowT = 0; api.unlock('low_pass'); } } else T.lowT = 0;
      T.poiT += step;
      if (T.poiT >= 1) {
        T.poiT = 0;
        const pois = G.world && G.world.pois;
        const places = G.profile.places;
        if (pois && places) {
          for (let i = 0; i < pois.length; i++) {
            const poi = pois[i];
            const dx = ac.pos.x - poi.x, dz = ac.pos.z - poi.z;
            const d2 = dx * dx + dz * dz;
            if (poi.id === 'bridge' && d2 < 160 * 160 && ac.agl < 40 && ac.tas > 30) api.unlock('bridge');
            if (!places[poi.id] && d2 < 1800 * 1800) api.discover(poi);
          }
        }
      }
    },
  };
}
