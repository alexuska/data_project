// Боевые учения: «Стрельбы на полигоне», «Перехват». Противник — условный, учебный.
import * as THREE from 'three';
import { S } from './engine.js';
import { findLand, finalPoint, offset, windPhrase, rwNum, dist2, fmtTime, DEG, fmtDist } from './lib.js';

const RP = 'Руководитель стрельб';
const KP = 'КП';

// Учебные цели: через модуль боя; если он вернул null — «фотострельба» по своим простым мишеням
// (засчитывается удержанием цели в прицеле, как фотоконтроль в реальных учебных стрельбах).
const _f = new THREE.Vector3(), _d = new THREE.Vector3();
let geoPanel = null, geoBalloon = null, matT = null;
function virtualTarget(G, kind, x, y, z, heading) {
  geoPanel ||= new THREE.BoxGeometry(10, 7, 0.6).translate(0, 3.5, 0);
  geoBalloon ||= new THREE.SphereGeometry(4, 10, 8);
  matT ||= new THREE.MeshLambertMaterial({ color: kind === 'balloon' ? 0xd23a2a : 0xf2efe6 });
  const mesh = new THREE.Mesh(kind === 'balloon' ? geoBalloon : geoPanel, matT);
  mesh.position.set(x, y, z);
  mesh.rotation.y = -heading;
  G.scene.add(mesh);
  return { id: 'v' + Math.random().toString(36).slice(2, 7), kind, pos: mesh.position, vel: new THREE.Vector3(), hp: 1, alive: true, team: 'enemy', mesh, virtual: true, aim: 0 };
}
function spawnTarget(G, o) {
  let t = null;
  try { t = G.combat && G.combat.spawnGroundTarget ? G.combat.spawnGroundTarget(o) : null; } catch (e) { t = null; }
  if (t) return t;
  const gy = G.world.groundAt(o.x, o.z).y;
  return virtualTarget(G, o.kind, o.x, o.kind === 'balloon' ? o.y ?? gy + 300 : gy, o.z, o.heading || 0);
}
// фотоконтроль: цель в конусе прицела ближе 1200 м в течение 0.6 с
function photoHit(m, t, dt) {
  const ac = m.ac;
  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  _d.subVectors(t.pos, ac.pos);
  const dist = _d.length();
  const cone = Math.max(2.5 * DEG, Math.atan2(t.kind === 'balloon' ? 6 : 9, dist));
  if (dist < 1200 && dist > 60 && _d.dot(_f) / dist > Math.cos(cone)) t.aim += dt; else t.aim = Math.max(0, t.aim - dt * 0.5);
  if (t.aim < 0.6) return false;
  if (t.virtual) {
    t.alive = false;
    t.hp = 0;
    m.G.fx?.explosion?.(t.pos, 0.5);
    if (t.mesh) t.mesh.visible = false;
  }
  m.toast('Фотоконтроль: попадание', 'good');
  return true;
}

// ---------------------------------------------------------------- 9. Стрельбы на полигоне
export const rangeL39 = {
  def: {
    id: 'range_l39', title: 'Стрельбы на полигоне', category: 'combat', planes: ['l39', 'su25', 'mig21', 'mig29', 'su27'], difficulty: 3, order: 1,
    from: 'kamenny', to: 'kamenny', reward: { money: 1800, xp: 280 }, requires: { missions: ['first_flight'] },
    brief: 'Плановые учебные стрельбы. Взлёт с авиабазы Каменный Мыс, выход на полигон и работа по мишеням: четыре щита на земле и три аэростата. Пушка — кнопка огня, на Л-39 есть и неуправляемые ракеты. Затем — посадка на базу. Оценка: время работы на полигоне и посадка.',
  },
  session: () => ({ airportId: 'kamenny', runway: 0, end: 'A', timeOfDay: 11, weather: 'cloudy' }),
  freezeTime: true,
  geo(world) {
    if (this._geo) return this._geo;
    const ap = world.airportById.kamenny, H = ap.runways[0].heading;
    const p = offset(ap.x, ap.z, H, 6500);
    const c = findLand(world, p.x, p.z, { minH: 3, maxH: 260, slope: 9, step: 200 });
    const entry = offset(c.x, c.z, H + Math.PI, 2600);
    return (this._geo = { c, H, entry });
  },
  start(m) {
    const { c, H } = this.geo(m.world);
    const G = m.G;
    const along = (s, side) => { const q = offset(c.x, c.z, H, s); return { x: q.x + Math.cos(H) * side, z: q.z + Math.sin(H) * side }; };
    m.data.panels = [-180, -60, 60, 180].map((s, i) => { const q = along(s, (i % 2 ? 1 : -1) * 25); return spawnTarget(G, { kind: 'target_panel', x: q.x, z: q.z, heading: H, team: 'enemy' }); });
    m.data.balloons = [0, 1, 2].map((i) => {
      const q = along(700 + i * 220, (i - 1) * 260);
      const gy = m.world.groundAt(q.x, q.z).y;
      return spawnTarget(G, { kind: 'balloon', x: q.x, z: q.z, y: gy + 220 + i * 60, team: 'enemy' });
    });
    m.data.photo = !(m.ac && m.ac.weapons && m.ac.weapons.gun);
    m.on('target:destroyed', (e) => { if (e && e.target) e.target.alive = false; });
  },
  build(m) {
    const { entry } = this.geo(m.world);
    const left = (arr) => arr.filter((t) => t.alive !== false && !(t.hp <= 0)).length;
    const group = (key, title, total) => {
      let mk = [], n = -1;
      return {
        id: key,
        text: (m) => `${title}: ${total - left(m.data[key])}/${total}`,
        title,
        how: (m) => (m.data.photo
          ? 'Наведи нос самолёта на красный прицел «ЦЕЛЬ» и держи её в центре экрана секунду — фотоконтроль засчитает попадание.'
          : 'Наведи нос на красный прицел «ЦЕЛЬ»: зелёный кружок прицела — на цель. Жми и держи ОГОНЬ (кнопка справа). Ниже 100 м — выводи!'),
        progress: (m) => {
          const n = total - left(m.data[key]);
          let d = 1e9;
          for (const t of m.data[key]) if (t.alive !== false && !(t.hp <= 0)) d = Math.min(d, t.pos.distanceTo(m.ac.pos));
          return { value: n, max: total, text: `поражено ${n} из ${total}${d < 1e8 ? ' · до ближней ' + fmtDist(d) : ''}` };
        },
        ctl: (m) => (m.data.photo ? null : 'fire'),
        markers: (m) => {
          const l = m.data[key].filter((t) => t.alive !== false && !(t.hp <= 0));
          if (l.length !== n) { n = l.length; mk = l.map((t) => ({ x: t.pos.x, y: t.pos.y + (t.kind === 'balloon' ? 0 : 4), z: t.pos.z, kind: 'target', label: '' })); }
          return mk;
        },
        update(m, dt) {
          if (m.data.photo) for (const t of m.data[key]) if (t.alive !== false && t.hp > 0) photoHit(m, t, dt);
          const n2 = left(m.data[key]);
          if (n2 !== m.data[key + 'N']) {
            if (m.data[key + 'N'] != null && n2 > 0) m.radio(RP, n2 === 1 ? 'Есть попадание! Осталась одна.' : 'Есть попадание! Работаем дальше.', { now: true });
            m.data[key + 'N'] = n2;
          }
          if (m.ac.agl < 60 && m.ac.vs < -8) m.hint('pull', RP, 'Вывод! Выводи из пикирования!', 6);
          return n2 === 0;
        },
      };
    };
    return [
      S.takeoff({
        text: 'Взлёт с полосы 14',
        enter(m) { m.tower('kamenny', `${m.cs}, ${m.tw('kamenny')}. Полоса 14, ${windPhrase(m.world)}, взлёт разрешаю. Полигон — по курсу, шесть километров.`); },
      }),
      S.reach({
        text: 'Выход на полигон: высота 400 м', ...entry, y: 450, label: 'Полигон', radius: 700,
        enter(m) { m.radio(RP, `${m.cs}, полигон готов, мишени выставлены. Входите с курсом сто сорок, 400 метров.`); },
      }),
      {
        ...group('panels', 'Щиты на земле', 4),
        enter(m) {
          m.data.t0 = m.t;
          m.radio(RP, m.data.photo ? 'Боевой курс! Фотоконтроль: держите щит в прицеле — засчитаю попадание.' : 'Боевой курс разрешаю! Пикирование 20 градусов, огонь с 800 метров, вывод не ниже 100.', { now: true });
        },
      },
      {
        ...group('balloons', 'Аэростаты', 3),
        enter(m) { m.radio(RP, 'Щиты поражены, отлично! Теперь аэростаты — правее, на высоте 200–350 метров.', { now: true }); },
        exit(m) { m.data.work = m.t - m.data.t0; },
      },
      S.land('kamenny', {
        text: 'Возвращение: посадка на Каменный Мыс',
        enter(m) { m.radio(RP, `Все мишени поражены за ${fmtTime(m.data.work)}. Стрельбы окончены, возвращайтесь.`); },
      }),
    ];
  },
  update(m) {
    if (m.index >= 2 && m.index <= 3 && m.t > 14 * 60) m.fail('Полигон закрыт', 'Время стрельб вышло. Работайте по мишеням быстрее.', [RP, 'Время вышло, полигон закрываю.']);
  },
  onDone(m) {
    let st = m.landStars(m.landed.td, m.landed.bounces);
    if (m.data.work > 240) st = Math.max(1, st - 1);
    m.complete({
      stars: st, title: 'Стрельбы выполнены', text: `Мишени: 7 из 7 за ${fmtTime(m.data.work)}. Посадка на базу.`,
      radio: [m.tw('kamenny'), st === 3 ? `${m.cs}, Три-хо-хо! Отстрелялись на «отлично».` : `${m.cs}, стрельбы зачтены. Рулите на стоянку.`],
    });
  },
  stop(m) {
    for (const t of [...(m.data.panels || []), ...(m.data.balloons || [])]) if (t && t.virtual && t.mesh) m.G.scene.remove(t.mesh);
  },
};

// ---------------------------------------------------------------- 10. Перехват
export const intercept = {
  def: {
    id: 'intercept', title: 'Перехват', category: 'combat', planes: ['mig21', 'mig29', 'su27'], difficulty: 4, order: 2,
    from: 'kamenny', to: 'kamenny', reward: { money: 3000, xp: 420 }, requires: { missions: ['range_l39'] },
    brief: 'Учения ПВО. С запада к архипелагу идёт условный нарушитель — самолёт «противника» из группы имитации. Дежурное звено поднимается по тревоге: взлёт с форсажем, перехват, опознавание (подойти и покачать крыльями) и — по команде КП — уничтожение. Не дайте ему дойти до Тирасполя.',
  },
  session: () => ({ airportId: 'kamenny', runway: 0, end: 'B', timeOfDay: 14.5, weather: 'clear' }),
  freezeTime: true,
  start(m) {
    const G = m.G;
    const home = m.ap('yasny');
    const route = [{ x: -12000, z: -6500 }, { x: -4000, z: -1000 }, { x: home.x, z: home.z }];
    let bad = null;
    try {
      bad = G.ai.spawn({ specId: 'su25', team: 'enemy', x: -27000, y: 1300, z: -14500, heading: 62 * DEG, speed: 140, behavior: 'route', route, alt: 1300, skill: 0.3 });
      if (bad) bad.aim = 0;
    } catch (e) { console.error('[missions] intercept spawn', e); }
    m.data.bad = bad;
    m.data.mk = [{ x: 0, y: 0, z: 0, kind: 'target', label: 'Нарушитель' }];
    m.data.photo = !(m.ac && m.ac.weapons && m.ac.weapons.gun);
    m.data.rock = { side: 0, n: 0, t: 0 };
    m.on('ac:destroyed', (e) => {
      if (!e || e.ac !== m.data.bad || m.data.killed) return;
      m.data.killed = true;
      m.data.killT = m.t;
      if (m.index < 3) { m.data.early = true; m.radio(KP, `${m.cs}, огонь без команды?! Цель поражена, но разбор будет. Возвращайтесь.`, { now: true }); m.goto('land'); }
    });
  },
  build(m) {
    const track = (m) => {
      const b = m.data.bad, mk = m.data.mk;
      if (b) { mk[0].x = b.pos.x; mk[0].y = b.pos.y; mk[0].z = b.pos.z; }
      return b ? mk : [];
    };
    const dist = (m) => (m.data.bad ? m.data.bad.pos.distanceTo(m.ac.pos) : 1e9);
    return [
      S.takeoff({
        text: 'Тревога! Взлёт с форсажем',
        markers: track,
        enter(m) {
          m.radio(KP, `Тревога! ${m.cs}, неопознанная цель с запада, высота 1300. Взлёт немедленно, РУД — на форсаж!`);
          m.tower('kamenny', `${m.cs}, полоса 32 свободна, взлёт разрешаю.`);
        },
      }),
      {
        text: 'Перехват: сблизься с целью', title: 'Перехват',
        how: 'Лети на красную метку «ЦЕЛЬ · Нарушитель». РУД — вверх до упора (форсаж). Высота цели — 1300 м.',
        progress: (m) => ({ value: Math.max(0, 30000 - dist(m)), max: 28500, text: `до цели ${fmtDist(dist(m))}` }),
        ctl: (m) => (m.ac.throttle < 0.95 ? 'thr-up' : null),
        markers: track,
        enter(m) { m.radio(KP, 'Цель на метке. Курс на перехват, набирайте 1300. Шасси убрать!'); },
        update(m) {
          if (m.stepT > 70 && m.radioIdle()) m.hint('fast', KP, `${m.cs}, цель уходит к Тирасполю! Скорость — форсаж!`, 30);
          return dist(m) < 1500;
        },
      },
      {
        text: 'Опознавание: покачай крыльями', title: 'Опознавание',
        how: 'Подойди к нарушителю ближе 1 км и покачай крыльями: ручку влево, вправо, влево — 3 раза. Это сигнал «следуй за мной».',
        progress: (m) => ({ value: Math.min(3, m.data.rock.n), max: 3, text: `покачиваний ${Math.min(3, m.data.rock.n)} из 3 · до цели ${fmtDist(dist(m))}` }),
        ctl: 'stick',
        markers: track,
        enter(m) { m.radio(KP, 'Цель вижу. Подойдите ближе и покачайте крыльями — сигнал «Следуй за мной».'); },
        update(m) {
          const ac = m.ac, r = m.data.rock;
          const side = ac.bank > 15 * DEG ? 1 : ac.bank < -15 * DEG ? -1 : 0;
          if (side && side !== r.side) { if (m.t - r.t > 5) r.n = 0; r.side = side; r.n++; r.t = m.t; }
          if (r.n >= 3 && dist(m) < 1100) return true;
          if (m.stepT > 30) m.hint('rock', KP, 'Ближе, до 600 метров, и крен влево-вправо пару раз — покачай крыльями.', 20);
          return false;
        },
        exit(m) {
          const b = m.data.bad;
          if (b && b.alive !== false && !m.data.killed) { try { m.G.ai.setBehavior(b, 'attack', {}); } catch (e) { /* ИИ без боевого режима */ } }
        },
      },
      {
        text: (m) => (m.data.photo ? 'Цель в прицел: фотоконтроль' : 'Огонь разрешаю: порази нарушителя'), title: 'Огонь!',
        how: (m) => (m.data.photo ? 'Держи нарушителя в центре экрана секунду — фотоконтроль засчитает.' : 'Зайди нарушителю в хвост, наведи нос на красную рамку и жми ОГОНЬ. Ракеты — кнопка ПУСК, когда рамка станет сплошной.'),
        progress: (m) => ({ value: Math.max(0, 3000 - dist(m)), max: 3000, text: `до цели ${fmtDist(dist(m))}` }),
        ctl: (m) => (m.data.photo ? null : 'fire'),
        markers: track,
        enter(m) {
          m.radio('Нарушитель', '…', { now: true });
          m.radio(KP, `Цель не отвечает, маневрирует! ${m.cs}, огонь разрешаю!`, { now: true });
        },
        update(m, dt) {
          const b = m.data.bad;
          if (m.data.killed) return true;
          if (m.data.photo && b && photoHit(m, b, dt)) { m.data.killed = true; m.data.killT = m.t; try { m.G.ai.setBehavior(b, 'route', { route: [{ x: -30000, z: -20000 }], despawn: true }); } catch (e) { /* */ } return true; }
          return false;
        },
      },
      S.land('kamenny', {
        text: 'Возвращение: посадка на Каменный Мыс',
        enter(m) { if (!m.data.early) m.radio(KP, `Цель поражена! ${m.cs}, учебная задача выполнена. Возвращайтесь на базу.`, { now: true }); },
      }),
    ];
  },
  update(m) {
    const b = m.data.bad;
    if (!b || m.data.killed || m.index > 2) return;
    const home = m.ap('yasny');
    if (dist2(b.pos.x, b.pos.z, home.x, home.z) < 3500) m.fail('Нарушитель прорвался', `Цель дошла до ${home.name}. Взлетайте быстрее и идите на перехват с форсажем.`, [KP, 'Цель над Тирасполем. Задача не выполнена.']);
  },
  onDone(m) {
    let st = m.landStars(m.landed.td, m.landed.bounces);
    if ((m.data.killT || 999) > 260) st = Math.max(1, st - 1);
    if (m.data.early) st = Math.min(st, 2);
    m.complete({
      stars: st, title: 'Перехват выполнен', text: `Нарушитель поражён на ${fmtTime(m.data.killT || 0)} от тревоги. Посадка на базу.`,
      radio: [KP, st === 3 ? `${m.cs}, Три-хо-хо! Чистый перехват. Объявляю благодарность!` : `${m.cs}, задача выполнена. Разбор полёта — завтра в девять.`],
    });
  },
  stop(m) {
    const b = m.data.bad;
    if (b && m.G.aircraft.includes(b)) { try { m.G.ai.remove(b); } catch (e) { /* */ } }
  },
};
