// Спасатели и особые задания: «Пожар у Бри-Конт-Робер» (Бе-200), «Чкаловский пролёт».
import { S } from './engine.js';
import { findLand, findScoop, finalPoint, windPhrase, rwNum, dist2, clamp, fmtTime, offset, fmtDist } from './lib.js';

const HQ = 'Штаб тушения';

// ---------------------------------------------------------------- 7. Пожар у Бри-Конт-Робер (Бе-200)
const CAP = 12000;          // кг воды за ходку
const FIRE_HP = 5000;       // кг воды на очаг
const DROP_RATE = CAP / 1.6; // кг/с при сбросе
const TIME_LIMIT = 15 * 60;

export const fireResort = {
  def: {
    id: 'fire_resort', title: 'Пожар у Бри-Конт-Робер', category: 'rescue', planes: ['be200'], difficulty: 5, order: 1,
    from: 'yuzhny', reward: { money: 4500, xp: 600 }, requires: { missions: ['dniester_circle'] },
    brief: 'Над твоим Бри-Конт-Робер горит лес, ветер гонит огонь к домам — выручай соседей. Бе-200 набирает воду прямо с моря: садитесь на воду с убранным шасси и глиссируйте на скорости — 12 тонн за 12 секунд. Затем сброс с высоты 40–80 метров точно на очаги. Очагов три, ходок понадобится несколько.',
  },
  geo(world) {
    if (this._geo) return this._geo;
    const r = world.poiById.resort;
    const scoop = findScoop(world, r.x, r.z);
    // лес над городком — с той стороны, что дальше от аэропорта и от моря
    const apt = world.airportById.yuzhny;
    let c = null, best = -1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const q = findLand(world, r.x + Math.sin(a) * 1000, r.z - Math.cos(a) * 1000, { rMax: 500, minH: 4, maxH: 400, slope: 16, step: 160 });
      if (world.groundAt(q.x, q.z).surface !== 'ground' || dist2(q.x, q.z, r.x, r.z) > 1600) continue;
      const score = Math.min(dist2(q.x, q.z, apt.x, apt.z), 3000) + dist2(q.x, q.z, scoop.x, scoop.z) * 0.3;
      if (score > best) { best = score; c = q; }
    }
    c ||= findLand(world, r.x, r.z - 900, { minH: 3, maxH: 400, slope: 16, step: 220 });
    const fires = [0, 2, 4].map((k) => findLand(world, c.x, c.z, { minH: 3, maxH: 400, slope: 16, step: 220, skip: k }));
    return (this._geo = { scoop, fires, resort: r });
  },
  session(G, world) {
    const g = this.geo(world);
    const s = offset(g.scoop.x, g.scoop.z, g.scoop.heading + Math.PI, 5000);
    return { airportId: 'yuzhny', air: { x: s.x, y: 260, z: s.z, heading: g.scoop.heading, speed: 80 }, timeOfDay: 15, weather: 'clear' };
  },
  freezeTime: true,
  start(m) {
    const g = this.geo(m.world);
    const G = m.G;
    m.data.trips = 0;
    m.data.dropping = false;
    m.data.fires = g.fires.map((p) => {
      const y = m.world.groundAt(p.x, p.z).y;
      const pos = { x: p.x, y, z: p.z };
      const fx = (G.fx && G.fx.fire && G.fx.fire(pos, 3.2)) || null;
      return { x: p.x, z: p.z, y, hp: FIRE_HP, alive: true, fx, mk: { x: p.x, y: y + 20, z: p.z, kind: 'fire', label: '' } };
    });
    m.on('input:action', (e) => {
      if (!e || e.id !== 'drop') return;
      const ac = m.ac;
      if (ac && !ac.onGround && (ac.payload || 0) > 50 && !m.data.dropping) { m.data.dropping = true; m.data.dropHit = 0; m.data.dropAll = 0; }
    });
  },
  build(m) {
    const g = this.geo(m.world);
    const scoopMk = [{ x: g.scoop.x, y: 2, z: g.scoop.z, kind: 'waypoint', label: 'Набор воды' }];
    const live = () => m.data.fires.filter((f) => f.alive);
    let fireMk = null, fireN = -1;
    return [
      {
        id: 'scoop',
        text: (m) => {
          const p = Math.round(((m.ac.payload || 0) / CAP) * 100);
          return (m.data.trips ? `Ходка ${m.data.trips + 1}: ` : '') + (p > 0 ? `Набор воды: ${p}%` : 'Набор воды: глиссирование по морю');
        },
        title: (m) => (m.data.trips ? `Ходка ${m.data.trips + 1}: набор воды` : 'Набор воды из моря'),
        how: (m) => (m.ac.onWater
          ? 'Ты на воде! Держи РУД вверху — самолёт скользит и набирает воду. Баки полные — ручку на себя, взлетай.'
          : 'Убери шасси и садись на воду у метки «Набор воды»: газ поменьше, нос чуть вверх. На воде — РУД снова вверх.'),
        progress: (m) => {
          const p = Math.round(((m.ac.payload || 0) / CAP) * 100);
          const d = dist2(m.ac.pos.x, m.ac.pos.z, g.scoop.x, g.scoop.z);
          return { value: p, max: 100, text: `вода в баках ${p}%` + (m.ac.onWater || d < 600 ? '' : ` · до места ${fmtDist(d)}`) };
        },
        ctl: (m) => (m.ac.gearDown && !m.ac.onWater && !m.ac.onGround ? 'gear' : m.ac.onWater && m.ac.throttle < 0.8 ? 'thr-up' : null),
        markers: scoopMk,
        enter(m) {
          if (!m.data.trips) {
            m.radio(HQ, `${m.cs}, горит лес над ${g.resort.name}! Ветер несёт огонь к домам. Вода — в море, отметка на экране.`);
            m.radio(HQ, 'Шасси убрать, садитесь на воду и держите скорость: на глиссировании за 12 секунд наберёте 12 тонн.');
          } else m.radio(HQ, `${m.cs}, огонь ещё есть. Ещё ходка — на воду!`);
        },
        update(m, dt) {
          const ac = m.ac;
          if (ac.onWater) {
            if (ac.planing > 0.5) {
              ac.payload = Math.min(CAP, (ac.payload || 0) + (CAP / 12) * dt);
              if (ac.payload >= CAP && !m.data.full) { m.data.full = 1; m.radio(HQ, 'Полные баки — 12 тонн! Газ полный, взлетай!', { now: true }); }
            } else if (ac.gs < 15 || Math.hypot(ac.vel.x, ac.vel.z) < 25) m.hint('slow', HQ, 'Мало скорости — газ вперёд! Вода набирается только на глиссировании.', 12);
          } else if (!ac.onGround && ac.gearDown && ac.agl < 150 && m.world.groundAt(ac.pos.x, ac.pos.z).surface === 'water') {
            m.hint('gear', HQ, 'Шасси убрать! На воду — только на лодку.', 10);
          }
          return !ac.onGround && ac.agl > 15 && (ac.payload || 0) > 2500;
        },
        exit(m) { m.data.full = 0; },
      },
      {
        id: 'drop',
        text: (m) => {
          const n = live().length;
          return `Сброс на очаги с 40–80 м · осталось ${n}`;
        },
        title: 'Сброс воды на пожар',
        how: 'Лети низко, 40–80 м, прямо на красную метку «ПОЖАР». Чуть-чуть не долетая — жми большую кнопку «Сброс воды» справа.',
        progress: (m) => {
          const n = m.data.fires.length, k = n - live().length, p = Math.round(((m.ac.payload || 0) / CAP) * 100);
          return { value: k, max: n, text: `потушено ${k} из ${n} · вода ${p}% · высота ${Math.round(m.ac.agl)} м над землёй` };
        },
        ctl: (m) => {
          const ac = m.ac;
          return m.data.btn && live().some((f) => dist2(ac.pos.x, ac.pos.z, f.x, f.z) < 900) ? 'action' : null;
        },
        markers: () => {
          const l = live();
          if (l.length !== fireN) { fireN = l.length; fireMk = l.map((f) => f.mk); }
          return fireMk;
        },
        enter(m) { m.radio(HQ, 'Видим вас! Очаги отмечены. Заходите низко, 40–80 метров, и жмите «Сброс» чуть до очага.'); },
        update(m) {
          const ac = m.ac;
          const show = !ac.onGround && (ac.payload || 0) > 50;
          if (show !== m.data.btn) { m.data.btn = show; m.setAction(show ? { id: 'drop', label: 'Сброс воды' } : null); }
          if (!m.data.dropping && (ac.payload || 0) <= 50) { m.data.trips++; return true; }
          return false;
        },
        exit(m) { m.data.btn = false; m.setAction(null); },
      },
      {
        hidden: true,
        enter(m) {
          const n = live().length;
          if (n > 0) m.goto('scoop');
          else m.next();
        },
      },
    ];
  },
  update(m, dt) {
    const ac = m.ac;
    if (m.data.dropping) dropWater(m, ac, dt);
    // огонь ждать не будет
    if (m.t > TIME_LIMIT) {
      m.fail('Огонь добрался до городка', `За ${fmtTime(TIME_LIMIT)} пожар не потушен. Попробуйте точнее сбрасывать воду.`, [HQ, `${m.cs}, огонь у домов — работают пожарные расчёты. Возвращайтесь.`]);
      return;
    }
    if (m.t > TIME_LIMIT - 120 && !m.data.warnT) { m.data.warnT = 1; m.radio(HQ, `${m.cs}, огонь подходит к домам! Осталось две минуты!`, { now: true }); }
  },
  onDone(m) {
    const trips = m.data.trips;
    const st = trips <= 3 && m.t <= 7 * 60 ? 3 : trips <= 4 && m.t <= 11 * 60 ? 2 : 1;
    m.complete({
      stars: st, title: 'Пожар потушен', text: `Ходок: ${trips}, время ${fmtTime(m.t)}. ${m.data.fires.length} очага потушены.`,
      details: { trips, water: trips * CAP },
      radio: [HQ, st === 3 ? `${m.cs}, все очаги потушены! Три-хо-хо! Городок спасён — вас ждут на ужин.` : `${m.cs}, пожар потушен. Спасибо, городок спасён!`],
    });
  },
  stop(m) {
    for (const f of m.data.fires || []) if (f.fx) f.fx.stop();
    m.setAction(null);
  },
};

function dropWater(m, ac, dt) {
  const G = m.G, d = m.data;
  const amount = Math.min(ac.payload || 0, DROP_RATE * dt);
  ac.payload = Math.max(0, (ac.payload || 0) - amount);
  if (amount <= 0 || ac.payload <= 1) {
    d.dropping = false;
    ac.payload = 0;
    const k = d.dropAll > 0 ? d.dropHit / d.dropAll : 0;
    if (live(d) > 0) m.toast(k > 0.6 ? 'Точно в цель!' : k > 0.2 ? 'Задели очаг' : 'Мимо очагов', k > 0.6 ? 'good' : k > 0.2 ? 'info' : 'warn');
    return;
  }
  const pos = d._p || (d._p = { x: 0, y: 0, z: 0 });
  pos.x = ac.pos.x; pos.y = ac.pos.y - 2; pos.z = ac.pos.z;
  if (G.fx && G.fx.waterDrop) G.fx.waterDrop(pos, ac.vel, amount);
  // точка падения — по той же модели, что и эффект: сопротивление k = 0.4, время падения tf
  const gy = m.world.groundAt(pos.x, pos.z).y, h = Math.max(1, pos.y - gy);
  const tf = clamp(h / 21 + 0.8, 0.8, 14), e = (1 - Math.exp(-0.4 * tf)) / 0.4;
  const ix = pos.x + ac.vel.x * 0.92 * e, iz = pos.z + ac.vel.z * 0.92 * e;
  const R = 45 + h * 0.15;
  const eff = h < 25 ? 0.7 : h <= 110 ? 1 : clamp(1 - (h - 110) / 160, 0.15, 1);
  d.dropAll += amount;
  for (const f of d.fires) {
    if (!f.alive) continue;
    const dd = dist2(ix, iz, f.x, f.z);
    if (dd > R) continue;
    const w = amount * eff * (1 - (0.6 * dd) / R);
    d.dropHit += amount;
    f.hp -= w;
    if (f.fx && f.fx.setIntensity) f.fx.setIntensity(0.25 + 0.75 * Math.max(0, f.hp / FIRE_HP));
    if (f.hp <= 0) {
      f.alive = false;
      if (f.fx) f.fx.stop();
      G.fx?.smokePuff?.({ x: f.x, y: f.y + 4, z: f.z }, { size: 14, life: 5, count: 8, color: 0xe8e8e8 });
      const n = live(d);
      m.toast(n ? `Очаг потушен! Осталось: ${n}` : 'Все очаги потушены!', 'good');
      if (n) m.radio(HQ, n === 1 ? 'Есть! Остался последний очаг.' : 'Очаг погашен! Работаем дальше.', { now: true });
      if (!n) { d.dropping = false; m.later(1.5, (mm) => { mm.data.trips++; mm.goto(mm.indexOf('drop') + 1); }); }
    }
  }
}
const live = (d) => d.fires.filter((f) => f.alive).length;

// ---------------------------------------------------------------- 8. Чкаловский пролёт
export const chkalov = {
  def: {
    id: 'chkalov', title: 'Чкаловский пролёт', category: 'special', planes: ['yak52', 'an2', 'l39', 'l410'], difficulty: 3, order: 1,
    from: 'yasny', to: 'gavan', reward: { money: 1800, xp: 280 }, requires: { missions: ['dniester_circle'] },
    brief: 'Говорят, Валерий Чкалов однажды пролетел под мостом. Повторите легенду: снизьтесь над Днестром до 20–25 метров, пройдите под пролётом вантового моста между опорами и сядьте в Бендерах. Чем ниже и точнее по центру — тем выше оценка. Над мостом — не считается!',
  },
  session: () => ({ airportId: 'yasny', runway: 0, end: 'A', timeOfDay: 7.2, weather: 'clear' }),
  freezeTime: true,
  geo(world) {
    if (this._geo) return this._geo;
    const H = world.heightAt, P = world.poiById.bridge, bz = P.z;
    let xa = P.x, xb = P.x;
    while (H(xa, bz) < 5 && xa > P.x - 2500) xa -= 20;
    while (H(xb, bz) < 5 && xb < P.x + 2500) xb += 20;
    const mid = (xa + xb) / 2, span = xb - xa;
    const pyl = [mid - span * 0.27, mid + span * 0.27];
    // точка выхода на реку выше по течению (со стороны Тирасполя, севернее моста)
    let ax = mid, az = bz - 1400;
    for (const d of [1400, 1100, 800]) {
      let sx = 0, n = 0;
      for (let x = mid - 700; x <= mid + 700; x += 20) if (H(x, bz - d) < -1) { sx += x; n++; }
      if (n > 3) { ax = sx / n; az = bz - d; break; }
    }
    // проём под пролётом: центр между опорой и серединой, если середина пролёта близко к опоре
    return (this._geo = { bz, xa, xb, mid, pyl, deck: 37, ax, az });
  },
  build(m) {
    const g = this.geo(m.world);
    const gv = m.ap('gavan'), grw = gv.runways[0];
    const gate = finalPoint(gv, grw, grw.heading, 2000);
    const ring = [{ x: g.mid, y: 18, z: g.bz, kind: 'ring', radius: 16, label: 'Под мост' }];
    return [
      S.takeoff({
        text: 'Взлёт с полосы 09',
        enter(m) { m.tower('yasny', `${m.cs}, взлёт разрешаю. Куда собрались в такую рань? На Днестр? Ну-ну…`); },
      }),
      S.reach({
        id: 'river', text: 'Снижайтесь к Днестру: выход на реку', x: g.ax, z: g.az, y: 40, label: 'Днестр', radius: 450, maxAlt: 110,
        enter(m) { if (!m.data.tries) m.radio('Штурман', 'Выходим на реку выше моста, снижаемся до 25 метров над водой. Мост — строго по курсу.'); },
        altHint: (m) => m.hint('alt', 'Штурман', 'Высоковато! Над рекой — 25–30 метров, иначе под мост не попасть.', 10),
      }),
      {
        id: 'pass', text: 'Под мост! Высота не больше 25 м', title: 'Пролёт под мостом',
        how: 'Снизься до 15–25 м над водой и лети прямо в кольцо «ПОД МОСТ» — между опорами, под пролётом. Ручку двигай плавно.',
        progress: (m) => {
          const ac = m.ac, d = dist2(ac.pos.x, ac.pos.z, g.mid, g.bz);
          return { value: Math.max(0, 1500 - d), max: 1500, text: `до моста ${fmtDist(d)} · высота ${Math.round(ac.agl)} м${ac.agl > 30 ? ' — ниже!' : ''}` };
        },
        markers: ring,
        enter(m) { m.data.prevZ = m.ac.pos.z; m.data.tries = (m.data.tries || 0) + 1; },
        update(m) {
          const ac = m.ac, pz = m.data.prevZ;
          m.data.prevZ = ac.pos.z;
          if (ac.agl < 40 && ac.alt > 2) m.hint('low', 'Штурман', 'Держи высоту! Ещё чуть-чуть…', 30);
          if ((pz - g.bz) * (ac.pos.z - g.bz) <= 0 && pz !== ac.pos.z) {
            const x = ac.pos.x, y = ac.pos.y;
            if (x < g.xa - 60 || x > g.xb + 60) return false;
            const clearPyl = g.pyl.every((p) => Math.abs(x - p) > 12);
            if (y < g.deck - 4 && x > g.xa + 15 && x < g.xb - 15 && clearPyl) {
              m.data.passY = y; m.data.passOff = Math.abs(x - g.mid);
              m.toast(`Пролёт под мостом: ${Math.round(y)} м`, 'good');
              return true;
            }
            if (y < g.deck + 5 || !clearPyl) {
              G_fail(m, clearPyl ? 'Задет пролёт моста' : 'Задета опора моста');
              return false;
            }
            m.radio(m.tw('gavan'), `${m.cs}, видели ваш проход. Над мостом — не считается! Заходите ещё раз.`, { now: true });
            m.goto('river');
            return false;
          }
          if (m.stepT > 15 && dist2(ac.pos.x, ac.pos.z, g.mid, g.bz) > 3000) {
            m.radio('Штурман', 'Проскочили. Разворачиваемся — ещё заход на реку.', { now: true });
            m.goto('river');
          }
          return false;
        },
      },
      S.reach({
        text: `Набор высоты, заход на ${m.name('gavan')}`, ...gate, label: 'Вход в глиссаду', radius: 600,
        enter(m) {
          const low = m.data.passY < 22;
          m.radio(m.tw('gavan'), low ? `${m.cs}, это что сейчас было?! Под мостом на ${Math.round(m.data.passY)} метрах?! Чкалов, честное слово!` : `${m.cs}, видели, видели! Под мостом прошли. Полоса ${rwNum(grw.heading)}, заход разрешаю.`, { now: true });
          m.later(8, () => m.radio(m.tw('gavan'), `Набирайте 200 метров и заходите на полосу ${rwNum(grw.heading)}, ${windPhrase(m.world)}.`));
        },
      }),
      S.land('gavan', { text: `Посадка в Бендерах` }),
    ];
  },
  onDone(m) {
    let st = m.landStars(m.landed.td, m.landed.bounces);
    const good = m.data.passY < 22 && m.data.passOff < 90;
    if (!good) st = Math.min(st, 2);
    m.complete({
      stars: st, title: 'Как Чкалов!', text: `Пролёт под мостом через Днестр на высоте ${Math.round(m.data.passY)} м, посадка в Бендерах.`,
      radio: [m.tw('gavan'), st === 3 ? `Три-хо-хо, ${m.cs}! Легенду повторили. Только начальству — ни слова!` : `${m.cs}, с посадкой. Объяснительную напишете за чаем.`],
    });
  },
};

function G_fail(m, title) {
  m.G.fx?.explosion?.(m.ac.pos, 0.6);
  m.fail(title, 'Проём под мостом узкий: держите 15–25 метров над водой и середину между опорами.', ['Штурман', 'Удар! Задели мост!']);
}
