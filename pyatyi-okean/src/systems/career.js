// КАРЬЕРА: звания, покупки, улучшения, начисления за полёт, журнал, достижения. Контракт — в ARCHITECTURE.md.
// Награды платит только карьера: обработчик flight:end считает итог и пишет его в result.payout (см. settle()).
import {
  RANKS, ECONOMY, UPGRADE_MAX, upgradeBranches, upgradeCost,
  STAR_BONUS, REPEAT_K, FLIGHT_TIME_PAY, LANDING_PAY, LANDING_MAX_PAID, AIRPORT_K, FIRST_VISIT_PAY, PLACE_PAY, KILL_PAY, REPAIR, DAILY_BONUS,
} from './economy.js';
import { ACHIEVEMENTS, ACH_BY_ID, createTracker } from './achievements.js';
import { saveProfile, defaultProfile } from '../core/save.js';
import { CATALOG, CATALOG_BY_ID, getSpec } from '../aircraft/catalog.js';

export const CATEGORY_ORDER = ['training', 'civil', 'cargo', 'rescue', 'combat', 'special'];
const LOGBOOK_MAX = 50;
const STAT_KEYS = ['flights', 'flightTime', 'distance', 'landings', 'perfectLandings', 'crashes', 'kills', 'groundKills', 'passengers', 'cargo',
  'nightLandings', 'maxAlt', 'maxSpeed', 'bestDistance', 'earned', 'missionsDone'];

// новые поля профиля — с запасными значениями (формат core/save.js не ломаем)
function ensureProfile(p) {
  p.owned ??= ['yak52'];
  p.upgrades ??= {};
  p.liveries ??= {};
  p.missions ??= {};
  p.achievements ??= {};
  p.logbook ??= [];
  p.seen ??= {};
  p.visited ??= {};          // { [airportId]: timestamp } — аэродромы, где садились
  p.places ??= {};           // { [poiId]: timestamp } — открытые ориентиры
  p.daily ??= {};            // ежедневный бонус и задание дня
  p.daily.last ??= '';
  p.daily.streak ??= 0;
  p.daily.best ??= 0;
  p.daily.missionDay ??= '';
  p.daily.missionId ??= null;
  p.daily.missionDone ??= '';
  const s = (p.stats ??= {});
  for (const k of STAT_KEYS) s[k] ??= 0;
  s.perPlane ??= {};
  return p;
}

const pad2 = (n) => String(n).padStart(2, '0');
function dayKey(shift = 0) {
  const d = new Date();
  d.setDate(d.getDate() + shift);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const round10 = (v) => Math.round(v / 10) * 10;

function rankOf(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  return i;
}

// Оценка посадки: мягкость (вертикальная скорость касания) и точность (отклонение от оси полосы).
export function gradeLanding(l) {
  const a = Math.abs(l.vs || 0);
  const paved = l.surface === 'runway' || l.surface === 'carrier';
  const centered = l.surface === 'water' ? true : l.across != null && Math.abs(l.across) <= 6;
  const order = ['perfect', 'good', 'fair', 'rough'];
  let i = a <= 1.2 ? 0 : a <= 2.5 ? 1 : a <= 4.5 ? 2 : 3;
  if (i === 0 && !((paved || l.surface === 'water') && centered)) i = 1;
  if (l.bounces >= 2 && i < 3) i++;
  return order[i];
}

export function createCareer(G) {
  const p = () => G.profile;
  ensureProfile(p());
  const missionsApi = () => G.missions || { list: [], byId: {} };
  const missionDef = (id) => (id ? missionsApi().byId?.[id] || missionsApi().list?.find((m) => m.id === id) || null : null);
  const airportName = (id) => G.world?.airportById?.[id]?.name || id;

  // состояние текущего полёта (вне профиля)
  const flight = { landings: [], achievements: [], places: [], paidMoney: 0, paidXp: 0, armor: 0, trial: false };

  // ---------- достижения ----------
  function unlock(id) {
    const a = ACH_BY_ID[id];
    const pr = p();
    if (!a || pr.achievements[id]) return false;
    if (flight.trial && G.mode === 'flight') return false;
    pr.achievements[id] = Date.now();
    const r = a.reward || {};
    pr.money += r.money || 0;
    pr.xp += r.xp || 0;
    pr.stats.earned += r.money || 0;
    if (G.mode === 'flight' || G.mode === 'debrief') {
      flight.achievements.push(a);
      flight.paidMoney += r.money || 0;
      flight.paidXp += r.xp || 0;
    }
    saveProfile(pr);
    G.bus.emit('ui:toast', { text: `Достижение: ${a.title}`, kind: 'good' });
    G.bus.emit('career:achievement', { achievement: a });
    return true;
  }
  function discover(poi) {
    const pr = p();
    if (pr.places[poi.id] || flight.trial) return;
    pr.places[poi.id] = Date.now();
    pr.money += PLACE_PAY.money;
    pr.xp += PLACE_PAY.xp;
    pr.stats.earned += PLACE_PAY.money;
    flight.places.push(poi);
    flight.paidMoney += PLACE_PAY.money;
    flight.paidXp += PLACE_PAY.xp;
    saveProfile(pr);
    G.bus.emit('ui:toast', { text: `Открыто место: ${poi.name}`, kind: 'good' });
  }
  function achievementProgress(a) {
    const got = !!p().achievements[a.id];
    if (!a.value) return { got, cur: got ? 1 : 0, goal: 1, k: got ? 1 : 0 };
    let cur = 0;
    try { cur = a.value(p(), career) || 0; } catch (e) { cur = 0; }
    const goal = a.goal || 1;
    return { got, cur: Math.min(cur, goal), goal, k: got ? 1 : Math.max(0, Math.min(1, cur / goal)) };
  }
  // достижения, которые считаются по профилю
  function checkAchievements() {
    let any = false;
    for (let pass = 0; pass < 2; pass++) { // второй проход: награда могла дать звание
      for (const a of ACHIEVEMENTS) {
        if (!a.value || p().achievements[a.id]) continue;
        const pr = achievementProgress(a);
        if (pr.cur >= pr.goal) any = unlock(a.id) || any;
      }
    }
    return any;
  }

  // ---------- посадки (свой учёт: трекер отличает посадку от подскока) ----------
  let lastLanding = null;
  function onLanding(e) {
    const w = G.world || {};
    const tod = w.timeOfDay ?? 12;
    lastLanding = {
      vs: e.vs || 0, speed: e.speed || 0, surface: e.surface, airportId: e.airport ? e.airport.id : null,
      across: e.across ?? null, along: e.along ?? null, bounces: 0, night: tod < 5.5 || tod >= 21, weather: w.weather ? w.weather.type : 'clear',
    };
    flight.landings.push(lastLanding);
  }
  function onBounce(e) {
    if (!lastLanding) return;
    lastLanding.bounces++;
    if (e.vs < lastLanding.vs) lastLanding.vs = e.vs;
  }
  const tracker = createTracker(G, { unlock, discover, landing: onLanding, bounce: onBounce });

  // бронезащита из ветки «Вооружение и броня»: часть полученного урона возвращаем
  G.bus.on('ac:damage', (e) => {
    if (!e || e.ac !== G.player || !flight.armor || !(e.amount > 0)) return;
    const ac = e.ac;
    if (ac.alive && ac.hp > 0) ac.hp = Math.min(100, ac.hp + e.amount * flight.armor);
  });

  G.bus.on('flight:start', ({ session, ac } = {}) => {
    flight.landings = []; flight.achievements = []; flight.places = [];
    flight.paidMoney = 0; flight.paidXp = 0;
    flight.trial = !!(session && session.trial);
    lastLanding = null;
    tracker.start(true);
    // улучшения сверх контракта ac.mods {thrust, drag, agility}: баки и боезапас применяем сами
    const mods = ac ? career.planeMods(ac.specId) : null;
    flight.armor = mods ? 1 - mods.armor : 0;
    if (ac && mods && !flight.trial) {
      if (mods.fuel > 1 && ac.fuelMax > 0) { ac.fuelMax *= mods.fuel; ac.fuel *= mods.fuel; }
      const gun = ac.weapons && ac.weapons.gun;
      if (gun && mods.ammo > 1 && gun.max > 0) { gun.max = Math.round(gun.max * mods.ammo); gun.ammo = Math.round(gun.ammo * mods.ammo); }
    }
  });

  // ---------- итог полёта ----------
  function settle(result) {
    const pr = ensureProfile(p());
    const st = pr.stats;
    const s = result.stats || {};
    const session = result.session || {};
    const spec = getSpec(result.planeId);
    const def = missionDef(result.missionId);
    const trial = !!session.trial;
    const crashed = result.reason === 'crashed';
    const completed = result.reason === 'mission_complete' && result.success !== false && !!result.missionId;
    const rankBefore = rankOf(pr.xp - flight.paidXp);
    const lines = [];
    const add = (label, money = 0, xp = 0, kind) => { lines.push({ label, money: Math.round(money), xp: Math.round(xp), kind }); };
    tracker.stop();

    // посадки
    const landings = flight.landings.map((l) => ({ ...l, grade: gradeLanding(l) }));
    for (const l of landings) l.label = LANDING_PAY[l.grade].label;
    const lastL = landings.length ? landings[landings.length - 1] : null;
    let stars = 0;

    if (!trial) {
      // задание
      if (completed) {
        const base = result.reward || (def && def.reward) || { money: 0, xp: 0 };
        const bm = base.money || 0, bx = base.xp || 0;
        stars = Math.max(0, Math.min(3, Math.round(result.stars ?? 3)));
        const rec = pr.missions[result.missionId] || { stars: 0, best: 0, done: 0 };
        const daily = career.dailyMission();
        const isDaily = !!daily && daily.id === result.missionId && !daily.done;
        const first = !rec.done;
        let mMoney = 0, mXp = 0;
        const addM = (label, money, xp, kind) => { mMoney += money; mXp += xp; add(label, money, xp, kind); };
        if (first || isDaily) {
          addM(first ? 'Задание выполнено' : 'Задание дня', bm, bx, 'mission');
          if (STAR_BONUS[stars] > 0) addM(`Оценка: ${stars} звезды (+${Math.round(STAR_BONUS[stars] * 100)}%)`, bm * STAR_BONUS[stars], bx * STAR_BONUS[stars], 'stars');
          if (isDaily) addM('Задание дня: оплата вдвойне', mMoney, mXp, 'daily');
        } else {
          addM('Повторное выполнение', bm * REPEAT_K.money, bx * REPEAT_K.xp, 'mission');
          if (stars > (rec.stars || 0)) {
            const k = STAR_BONUS[stars] - STAR_BONUS[rec.stars || 0];
            if (k > 0) addM('Улучшен результат', bm * k, bx * k, 'stars');
          }
        }
        if (isDaily) pr.daily.missionDone = dayKey();
        const payK = career.planeMods(result.planeId).payout;
        if (payK > 1 && mMoney > 0) add(`Коммерческая загрузка (+${Math.round((payK - 1) * 100)}%)`, mMoney * (payK - 1), 0, 'bonus');
        rec.done = (rec.done || 0) + 1;
        rec.stars = Math.max(rec.stars || 0, stars);
        const score = typeof result.score === 'number' ? result.score : mMoney;
        rec.best = Math.max(rec.best || 0, Math.round(score));
        pr.missions[result.missionId] = rec;
        if (first) st.missionsDone++;
        // перевозки
        const d = result.details && typeof result.details === 'object' ? result.details : {};
        const cat = def && def.category;
        if (typeof d.passengers === 'number') st.passengers += d.passengers;
        else if (cat === 'civil' && spec.seats) st.passengers += Math.max(1, spec.seats - (spec.seats > 4 ? 0 : 1));
        if (typeof d.cargo === 'number') st.cargo += d.cargo;
        else if (cat === 'cargo' && spec.cargo) st.cargo += spec.cargo;
      }

      // налёт
      const tSec = s.time || 0;
      if (tSec >= FLIGHT_TIME_PAY.minSec && ((s.takeoffs || 0) > 0 || session.air || (s.distance || 0) > 1500)) {
        const min = Math.min(FLIGHT_TIME_PAY.capMin, tSec / 60);
        add(`Налёт: ${fmtDuration(tSec)}`, round10(min * FLIGHT_TIME_PAY.money), Math.round(min * FLIGHT_TIME_PAY.xp), 'time');
      }

      // посадки
      if (!crashed) {
        landings.slice(-LANDING_MAX_PAID).forEach((l) => {
          const pay = LANDING_PAY[l.grade];
          const onField = !!l.airportId;
          const k = onField ? AIRPORT_K[l.airportId] || 1 : l.surface === 'water' ? 1 : 0.5;
          const where = onField ? airportName(l.airportId) : l.surface === 'water' ? 'на воду' : 'вне аэродрома';
          add(`Посадка «${pay.label}» — ${where}`, pay.money * k, pay.xp * k, 'landing');
        });
        // первооткрыватель
        for (const l of landings) {
          if (!l.airportId || pr.visited[l.airportId]) continue;
          pr.visited[l.airportId] = Date.now();
          const fp = FIRST_VISIT_PAY[l.airportId] || FIRST_VISIT_PAY.default;
          add(`Первооткрыватель: ${airportName(l.airportId)}`, fp.money, fp.xp, 'first');
        }
      }

      // бой
      const ts = tracker.state;
      if (ts.kills > 0) add(`Сбито самолётов: ${ts.kills}`, ts.kills * KILL_PAY.air.money, ts.kills * KILL_PAY.air.xp, 'combat');
      if (ts.groundKills > 0) add(`Поражено целей: ${ts.groundKills}`, ts.groundKills * KILL_PAY.ground.money, ts.groundKills * KILL_PAY.ground.xp, 'combat');
      st.kills += ts.kills;
      st.groundKills += ts.groundKills;

      // ремонт после аварии — небольшой и никогда не в минус
      if (crashed) {
        const earned = lines.reduce((a, l) => a + l.money, 0);
        const cost = Math.max(REPAIR.min, Math.min(REPAIR.max, Math.round(((ECONOMY[result.planeId]?.price || 0) * REPAIR.k) / 10) * 10));
        const pay = Math.min(cost, Math.max(0, pr.money + earned));
        if (pay > 0) add('Ремонт самолёта', -pay, 0, 'repair');
      }
    } else {
      add('Пробный вылет — без начислений', 0, 0, 'note');
    }

    // зачисляем
    let money = 0, xp = 0;
    for (const l of lines) { money += l.money; xp += l.xp; }
    pr.money = Math.max(0, pr.money + money);
    pr.xp += xp;
    if (money > 0) st.earned += money;

    // статистика
    st.flights++;
    st.flightTime += s.time || 0;
    st.distance += s.distance || 0;
    st.bestDistance = Math.max(st.bestDistance, s.distance || 0);
    st.maxAlt = Math.max(st.maxAlt, s.maxAlt || 0);
    st.maxSpeed = Math.max(st.maxSpeed, s.maxSpeed || 0);
    if (crashed) st.crashes++;
    const pp = (st.perPlane[result.planeId] ??= { time: 0, flights: 0, landings: 0 });
    pp.time += s.time || 0;
    pp.flights++;
    if (!crashed) {
      st.landings += landings.length;
      pp.landings += landings.length;
      for (const l of landings) {
        if (l.grade === 'perfect') st.perfectLandings++;
        if (l.night) st.nightLandings++;
        if (!trial && l.grade === 'perfect' && (result.planeId === 'tu154' || result.planeId === 'il76')) unlock('heavy_perfect');
      }
    }

    // достижения по профилю (награды за них зачисляются сразу, в unlock)
    if (!trial) checkAchievements();
    for (const poi of flight.places) lines.push({ label: `Открыто место: ${poi.name}`, money: PLACE_PAY.money, xp: PLACE_PAY.xp, kind: 'place' });
    for (const a of flight.achievements) lines.push({ label: `Достижение «${a.title}»`, money: a.reward?.money || 0, xp: a.reward?.xp || 0, kind: 'achievement' });
    money += flight.paidMoney;
    xp += flight.paidXp;

    const rankAfter = rankOf(pr.xp);
    const payout = {
      money, xp, lines, stars, trial,
      landings,
      landing: crashed || !lastL ? null : lastL,
      achievements: flight.achievements.map((a) => ({ id: a.id, title: a.title, desc: a.desc, icon: a.icon, money: a.reward?.money || 0, xp: a.reward?.xp || 0 })),
      xpBefore: pr.xp - xp, xpAfter: pr.xp, moneyAfter: pr.money,
    };
    if (rankAfter > rankBefore) {
      payout.rankUp = {
        index: rankAfter, name: RANKS[rankAfter].name,
        planes: CATALOG.filter((c) => { const r = ECONOMY[c.id]?.rank ?? 0; return r > rankBefore && r <= rankAfter && !pr.owned.includes(c.id); }).map((c) => c.name),
      };
    }
    result.payout = payout;

    // журнал
    pr.logbook.unshift({
      t: Date.now(), plane: result.planeId, mission: result.missionId || null,
      title: def ? def.title : trial ? 'Пробный вылет' : 'Свободный полёт',
      result: result.reason, time: Math.round(s.time || 0), landing: payout.landing ? payout.landing.grade : null,
      to: payout.landing ? payout.landing.airportId : null, money, xp, stars,
    });
    if (pr.logbook.length > LOGBOOK_MAX) pr.logbook.length = LOGBOOK_MAX;

    flight.landings = []; flight.achievements = []; flight.places = []; flight.paidMoney = 0; flight.paidXp = 0;
    lastLanding = null;
    saveProfile(pr, true);
    G.bus.emit('career:changed');
  }
  G.bus.on('flight:end', ({ result } = {}) => { if (result) settle(result); });

  // ---------- публичный интерфейс ----------
  const career = {
    // --- контракт ---
    rank() {
      const xp = p().xp;
      const i = rankOf(xp);
      const next = RANKS[i + 1] || null;
      return {
        index: i, name: RANKS[i].name, xp, nextXp: next ? next.xp : null,
        prevXp: RANKS[i].xp, nextName: next ? next.name : null,
        progress: next ? Math.max(0, Math.min(1, (xp - RANKS[i].xp) / (next.xp - RANKS[i].xp))) : 1,
      };
    },
    owns(id) { return !!p().settings.unlockAll || p().owned.includes(id); },
    canBuy(id) {
      const e = ECONOMY[id];
      if (!e || !CATALOG_BY_ID[id]) return { ok: false, reason: 'Недоступно' };
      if (career.owns(id)) return { ok: false, reason: 'Уже в ангаре' };
      if (career.rank().index < e.rank) return { ok: false, reason: `Нужно звание «${RANKS[e.rank].name}»`, lock: 'rank' };
      if (p().money < e.price) return { ok: false, reason: `Не хватает ${(e.price - p().money).toLocaleString('ru-RU')} ₽`, lock: 'money' };
      return { ok: true };
    },
    buy(id) {
      if (!career.canBuy(id).ok) return false;
      p().money -= ECONOMY[id].price;
      p().owned.push(id);
      p().selectedPlane = id;
      checkAchievements();
      career.changed();
      return true;
    },
    select(id) { if (career.owns(id) && p().selectedPlane !== id) { p().selectedPlane = id; career.changed(); } },
    addReward({ money = 0, xp = 0 } = {}) { p().money = Math.max(0, p().money + Math.round(money)); p().xp += Math.round(xp); career.changed(); },
    // множители улучшений. Ядро кладёт их в ac.mods; thrust/drag/agility — контракт, остальное — расширение:
    // fuel (запас топлива), ammo (боезапас пушки), armor (доля получаемого урона), payout (оплата заданий).
    planeMods(id) {
      const u = p().upgrades[id] || {};
      const lv = (k) => Math.max(0, Math.min(UPGRADE_MAX, u[k] | 0));
      return {
        thrust: 1 + 0.04 * lv('engine'),
        drag: 1 - 0.04 * lv('aero'),
        agility: 1 + 0.05 * lv('controls'),
        fuel: 1 + 0.1 * lv('tanks'),
        ammo: 1 + 0.15 * lv('combat'),
        armor: 1 - 0.1 * lv('combat'),
        payout: 1 + 0.05 * lv('payload'),
      };
    },
    changed() { saveProfile(p()); G.bus.emit('career:changed'); },
    // доступность и звёзды задания
    missionState(id) {
      const def = missionDef(id);
      const rec = p().missions[id] || {};
      const out = { unlocked: true, reason: '', lock: null, stars: rec.stars || 0, done: rec.done || 0, best: rec.best || 0 };
      if (!def) { out.unlocked = false; out.reason = 'Задание недоступно'; out.lock = 'none'; return out; }
      const req = p().settings.unlockAll ? {} : (def.requires || {});
      if (req.rank != null && career.rank().index < req.rank) {
        out.unlocked = false; out.lock = 'rank';
        out.reason = `Нужно звание «${RANKS[Math.min(req.rank, RANKS.length - 1)].name}»`;
        return out;
      }
      if (Array.isArray(req.missions)) {
        const miss = req.missions.find((m) => !p().missions[m]?.done);
        if (miss) {
          out.unlocked = false; out.lock = 'missions';
          out.reason = `Сначала пройдите «${missionDef(miss)?.title || miss}»`;
          return out;
        }
      }
      if (!def.plane) {
        const a = career.missionPlanes(id);
        if (!a.options.length) {
          out.unlocked = false; out.lock = 'plane';
          const names = a.all.slice(0, 3).map((x) => getSpec(x).name);
          out.reason = `Нужен самолёт: ${names.join(', ')}${a.all.length > 3 ? '…' : ''}`;
        }
      }
      return out;
    },

    // --- расширения ---
    update(dt) { tracker.update(dt); },
    price(id) { return ECONOMY[id]?.price ?? 0; },
    requiredRank(id) { const r = ECONOMY[id]?.rank ?? 0; return { index: r, name: RANKS[r].name }; },
    ranks: RANKS,
    // самолёты для задания: fixed — жёстко задан; all — разрешённые; options — разрешённые и купленные; pick — что предложить
    missionPlanes(id) {
      const def = missionDef(id);
      if (!def) return { fixed: null, all: [], options: [], pick: null };
      if (def.plane) return { fixed: def.plane, all: [def.plane], options: [def.plane], pick: def.plane };
      let all = CATALOG.map((c) => c.id);
      if (Array.isArray(def.planes) && def.planes.length) all = def.planes.filter((x) => CATALOG_BY_ID[x]);
      else if (Array.isArray(def.cls) && def.cls.length) all = CATALOG.filter((c) => def.cls.includes(c.cls)).map((c) => c.id);
      const options = all.filter((x) => career.owns(x));
      const sel = p().selectedPlane;
      return { fixed: null, all, options, pick: options.includes(sel) ? sel : options[options.length - 1] || null };
    },
    // следующее задание по порядку (после afterId), ещё не пройденное и доступное
    nextMission(afterId) {
      const list = career.sortedMissions();
      const free = (m) => { const s = career.missionState(m.id); return s.unlocked && !s.done; };
      const i = afterId ? list.findIndex((m) => m.id === afterId) : -1;
      for (let k = i + 1; k < list.length; k++) if (free(list[k])) return list[k];
      for (let k = 0; k <= i && k < list.length; k++) if (free(list[k])) return list[k];
      return null;
    },
    sortedMissions() {
      const cat = (m) => { const i = CATEGORY_ORDER.indexOf(m.category); return i < 0 ? 99 : i; };
      return [...(missionsApi().list || [])].sort((a, b) => cat(a) - cat(b) || (a.order ?? 0) - (b.order ?? 0));
    },
    missionSummary() {
      const list = missionsApi().list || [];
      let done = 0, stars = 0;
      for (const m of list) { const r = p().missions[m.id]; if (r?.done) done++; stars += r?.stars || 0; }
      return { total: list.length, done, stars, maxStars: list.length * 3 };
    },
    // улучшения
    upgradeLevel(id, branch) { return Math.max(0, Math.min(UPGRADE_MAX, (p().upgrades[id]?.[branch]) | 0)); },
    upgrades(id) {
      return upgradeBranches(id).map((b) => {
        const level = career.upgradeLevel(id, b.id);
        const cost = level < UPGRADE_MAX ? upgradeCost(id, level + 1) : null;
        const pct = (l) => `${b.sign}${Math.round(Math.abs(b.step) * l * 100)}% ${b.unit}`;
        let can = { ok: true };
        if (!career.owns(id)) can = { ok: false, reason: 'Сначала купите самолёт' };
        else if (cost == null) can = { ok: false, reason: 'Максимальный уровень' };
        else if (p().money < cost) can = { ok: false, reason: 'Не хватает средств' };
        return { id: b.id, name: b.name, desc: b.desc, level, max: UPGRADE_MAX, cost, now: level ? pct(level) : 'заводское состояние', next: cost != null ? pct(level + 1) : null, can };
      });
    },
    buyUpgrade(id, branch) {
      const u = career.upgrades(id).find((x) => x.id === branch);
      if (!u || !u.can.ok) return false;
      p().money -= u.cost;
      (p().upgrades[id] ??= {})[branch] = u.level + 1;
      checkAchievements();
      career.changed();
      return true;
    },
    fullyUpgraded() {
      return p().owned.some((id) => upgradeBranches(id).every((b) => career.upgradeLevel(id, b.id) >= UPGRADE_MAX));
    },
    // ливреи
    livery(id) { return p().liveries[id] || null; },
    setLivery(id, liveryId) { p().liveries[id] = liveryId; career.changed(); },
    // достижения
    achievements() { return ACHIEVEMENTS.map((a) => ({ ...a, ...achievementProgress(a), at: p().achievements[a.id] || 0 })); },
    achievementCount() { return { got: ACHIEVEMENTS.filter((a) => p().achievements[a.id]).length, total: ACHIEVEMENTS.length }; },
    checkAchievements,
    // ежедневное довольствие: раз в день; возвращает { money, streak } или null
    claimDaily() {
      const d = p().daily, t = dayKey();
      if (d.last === t) return null;
      d.streak = d.last === dayKey(-1) ? (d.streak || 0) + 1 : 1;
      d.best = Math.max(d.best || 0, d.streak);
      d.last = t;
      if (p().stats.flights === 0) { saveProfile(p()); return null; } // первый запуск — без бонуса, его заменяет приветствие
      const money = DAILY_BONUS[Math.min(d.streak, DAILY_BONUS.length) - 1];
      p().money += money;
      p().stats.earned += money;
      checkAchievements();
      career.changed();
      return { money, streak: d.streak };
    },
    // задание дня: одно из уже пройденных, оплата как за первое выполнение ×2. { id, done } или null
    dailyMission() {
      const d = p().daily, t = dayKey();
      if (d.missionDay === t && d.missionId && missionDef(d.missionId)) return { id: d.missionId, done: d.missionDone === t };
      const pool = (missionsApi().list || []).filter((m) => p().missions[m.id]?.done && career.missionState(m.id).unlocked);
      if (pool.length < 3) return null;
      d.missionDay = t;
      d.missionId = pool[hashStr(t) % pool.length].id;
      saveProfile(p());
      return { id: d.missionId, done: d.missionDone === t };
    },
    // сброс прогресса (настройки сохраняем); профиль меняется на месте — ссылки на G.profile остаются верными
    reset() {
      const pr = p();
      const settings = pr.settings;
      const fresh = defaultProfile();
      for (const k of Object.keys(pr)) delete pr[k];
      Object.assign(pr, fresh);
      pr.settings = { ...fresh.settings, ...settings };
      ensureProfile(pr);
      saveProfile(pr, true);
      G.bus.emit('career:changed');
    },
  };
  return career;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h} ч ${pad2(m)} мин`;
  if (m > 0) return `${m} мин ${pad2(s)} с`;
  return `${s} с`;
}
