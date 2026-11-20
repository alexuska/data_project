// ПИЛОТАЖ: распознавание фигур высшего пилотажа игрока, очки, комбо, награда и плашка на экране.
// Контракт — в ARCHITECTURE.md («Дополнения (второй этап)» → «Пилотаж»): G.aerobatics { score, done[], update(dt) },
// событие шины trick:done { id, name, score, ac }.
//
// Распознаватель (TrickDetector) — чистая логика без DOM, импортируется в node (tools/aerobatics-test.mjs).
// Считает по накопленным углам в связанных осях (интеграл угловых скоростей крена и тангажа) и по мировым
// векторам носа/верха из кватерниона, а не по ac.pitch/ac.heading — они вырождаются на вертикали.
// Распознавание намеренно щедрое: игрок держит ручку большим пальцем на сенсорном экране.
//
// Устройство:
//  • бочка — непрерывное вращение по крену в одну сторону ≥ 335° без большого ухода по курсу и тангажу;
//  • «выход из горизонта» — всё, что начинается и кончается прямым горизонтальным полётом; при возврате в горизонт
//    по итогам (тангаж, крен, курс, высота, был ли вверх ногами) решаем: петля / иммельман / переворот / боевой разворот;
//  • поворот на горке — во время выхода: вертикаль вверх → малая скорость → вертикаль вниз, не через «спину»;
//  • вираж, перевёрнутый полёт, «нож», бреющий — по таймерам состояния.
import { Vector3 } from 'three';
import { saveProfile } from '../core/save.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

// score — базовые очки, xp/money — награда за первое исполнение в полёте (дальше убывает)
export const TRICKS = {
  roll: { name: 'Бочка', score: 100, xp: 2, money: 10 },
  roll2: { name: 'Двойная бочка', score: 200, xp: 3, money: 15 },
  lowroll: { name: 'Бочка на бреющем', score: 300, xp: 6, money: 30 },
  loop: { name: 'Мёртвая петля', score: 250, xp: 5, money: 25 },
  immelmann: { name: 'Иммельман', score: 300, xp: 6, money: 30 },
  splits: { name: 'Переворот', score: 250, xp: 5, money: 25 },
  chandelle: { name: 'Боевой разворот', score: 200, xp: 4, money: 20 },
  turn360: { name: 'Глубокий вираж', score: 150, xp: 3, money: 15 },
  inverted: { name: 'Перевёрнутый полёт', score: 200, xp: 4, money: 20 },
  knife: { name: 'Полёт на ноже', score: 250, xp: 5, money: 25 },
  lowpass: { name: 'Бреющий проход', score: 150, xp: 3, money: 15 },
  hammerhead: { name: 'Поворот на горке', score: 350, xp: 7, money: 35 },
};

export const WARMUP = 1.5; // с после отрыва/старта в воздухе: фигуры не засчитываются
export const COMBO_WINDOW = 9; // с между фигурами, чтобы серия продолжалась
export const COMBO_MAX = 3;
const STREAK_K = [1, 0.6, 0.4, 0.25]; // одна и та же фигура подряд
const REWARD_K = [1, 0.5, 0.25, 0.1]; // награда за повтор фигуры в одном полёте (дальше — 0)
const REWARD_CAP = { xp: 60, money: 400 }; // потолок награды за пилотаж в одном полёте

const _f = new Vector3(), _u = new Vector3();

// Чистый распознаватель. onTrick(id, ac) зовётся при завершении фигуры. step() не выделяет память.
export class TrickDetector {
  constructor(onTrick = null) {
    this.onTrick = onTrick;
    this.reset(null);
  }

  reset(ac) {
    this.ac = ac;
    this.t = 0;
    this.validT = 0;
    this.stallT = 0;
    this.rollTot = 0; // интеграл угловой скорости крена (вправо +), рад
    this.pitchTot = 0; // интеграл угловой скорости тангажа (нос вверх +), рад
    this.trk = 0; // путевой угол (по вектору скорости), рад
    this.trkOk = false;
    this.clear();
  }

  // сброс незавершённых фигур (земля, сваливание, штопор)
  clear() {
    // бочка
    this.rRun = 0; this.rQuiet = 0; this.rCount = 0; this.rTrk0 = 0; this.rTrkOk0 = false; this.rPitch0 = 0; this.rMaxAgl = 0;
    // выход из горизонта
    this.refOk = false; this.refTrk = 0; this.refAlt = 0; this.refRoll = 0; this.refPitch = 0;
    this.exc = false; this.eMaxFy = 0; this.eMinFy = 0; this.eInv = false; this.eUsed = false; this.eTrk = 0;
    // поворот на горке
    this.hhPhase = 0; this.hhT = 0; this.hhMinIas = 0; this.hhBack = false;
    // вираж
    this.tOn = false; this.tAcc = 0; this.tQuiet = 0; this.tAlt0 = 0; this.tMaxBank = 0;
    // таймеры состояний: перевёрнутый, нож, бреющий
    this.invT = 0; this.invGap = 0; this.invDone = false;
    this.kT = 0; this.kGap = 0; this.kDone = false;
    this.lT = 0; this.lGap = 0; this.lDone = false;
  }

  emit(id) {
    if (this.validT < WARMUP) return; // сразу после старта/взлёта не засчитываем
    if (this.onTrick) this.onTrick(id, this.ac);
  }

  step(ac, dt) {
    if (ac !== this.ac) this.reset(ac);
    if (!ac) return;
    this.t += dt;
    if (!ac.alive || ac.onGround || ac.spin) {
      this.validT = 0;
      this.trkOk = false;
      this.clear();
      return;
    }
    if (ac.stalled) {
      this.stallT += dt;
      if (this.stallT > 0.6) { this.clear(); return; }
    } else this.stallT = 0;
    this.validT += dt;

    const spec = ac.spec, vS = spec.vStall;
    const p = -ac.angVel.z, q = ac.angVel.x; // крен вправо +, тангаж нос вверх +
    this.rollTot += p * dt;
    this.pitchTot += q * dt;
    _f.set(0, 0, -1).applyQuaternion(ac.quat);
    _u.set(0, 1, 0).applyQuaternion(ac.quat);
    const fy = _f.y, uy = _u.y;
    const ab = Math.abs(ac.bank);
    const ias = ac.ias, alt = ac.pos.y, agl = ac.agl;

    // путевой угол: на вертикали не определён — не накапливаем, а после неё подхватываем заново
    const vx = ac.vel.x, vy = ac.vel.y, vz = ac.vel.z;
    const vh = Math.sqrt(vx * vx + vz * vz), sp = Math.sqrt(vh * vh + vy * vy);
    const trkOk = sp > 5 && vh > 0.3 * sp;
    let dTrk = 0;
    if (trkOk) {
      const trk = Math.atan2(vx, -vz);
      if (this.trkOk) dTrk = wrapPi(trk - this.trk);
      this.trk = trk;
    }
    this.trkOk = trkOk;
    const gamma = Math.atan2(vy, vh);

    // ---------- бочка ----------
    const RR = 0.6;
    if (Math.abs(p) > RR && (this.rRun === 0 || (p > 0) === (this.rRun > 0))) {
      if (this.rRun === 0) {
        this.rTrk0 = this.trk; this.rTrkOk0 = trkOk; this.rPitch0 = this.pitchTot; this.rMaxAgl = agl; this.rCount = 0;
      }
      this.rRun += p * dt;
      this.rQuiet = 0;
      if (agl > this.rMaxAgl) this.rMaxAgl = agl;
      if (Math.abs(this.rRun) >= TAU * (this.rCount + 0.93)) {
        this.rCount++;
        const drift = this.rTrkOk0 && trkOk ? Math.abs(wrapPi(this.trk - this.rTrk0)) : 0;
        const pit = Math.abs(this.pitchTot - this.rPitch0);
        if (drift < 1.2 && pit < 2.4) {
          if (this.rCount === 1) this.emit(this.rMaxAgl < 30 ? 'lowroll' : 'roll');
          else if (this.rCount === 2) this.emit('roll2');
        }
      }
    } else if (Math.abs(p) > RR) {
      this.rRun = 0; // сменил направление — новая бочка начнётся со следующего шага
    } else {
      this.rQuiet += dt;
      if (this.rQuiet > 0.5) this.rRun = 0;
    }

    // ---------- выход из горизонта: петля, иммельман, переворот, боевой разворот, поворот на горке ----------
    const level = trkOk && uy > 0.8 && Math.abs(fy) < 0.34 && Math.abs(gamma) < 0.35 && ias > 0.8 * vS; // зависание на горке — не горизонт
    if (level) {
      if (this.exc) {
        this.exc = false;
        if (this.refOk && !this.eUsed) this.evalExcursion(alt);
      }
      this.refOk = true; this.refTrk = this.trk; this.refAlt = alt; this.refRoll = this.rollTot; this.refPitch = this.pitchTot;
    } else {
      if (!this.exc) {
        this.exc = true; this.eMaxFy = fy; this.eMinFy = fy; this.eInv = false; this.eUsed = false; this.eTrk = 0; this.hhPhase = 0;
      }
      if (fy > this.eMaxFy) this.eMaxFy = fy;
      if (fy < this.eMinFy) this.eMinFy = fy;
      if (uy < -0.5) this.eInv = true;
      this.eTrk += dTrk;
      // поворот на горке: вертикаль вверх → малая скорость → нос вниз, и нос перевалил не «через спину» (как в петле)
      if (this.hhPhase === 0 && fy > 0.8) { this.hhPhase = 1; this.hhT = this.t; this.hhMinIas = ias; this.hhBack = false; }
      if (this.hhPhase === 1) {
        if (ias < this.hhMinIas) this.hhMinIas = ias;
        if (Math.abs(fy) < 0.45 && uy < -0.6) this.hhBack = true;
        if (fy < -0.3) {
          this.hhPhase = 2;
          const slow = this.hhMinIas < 1.0 * vS, verySlow = this.hhMinIas < 0.7 * vS;
          if (this.refOk && this.t - this.hhT < 40 && ((slow && !this.hhBack) || verySlow)) {
            this.eUsed = true;
            this.emit('hammerhead');
          }
        } else if (this.t - this.hhT > 40) this.hhPhase = 2; // у истребителей горка долгая
      }
    }

    // ---------- глубокий вираж 360° ----------
    if (trkOk && uy > 0.05 && ab > 0.7 && Math.abs(fy) < 0.6) {
      if (this.tOn && dTrk !== 0 && (dTrk > 0) !== (this.tAcc > 0) && this.tAcc !== 0) this.tOn = false; // сменил сторону
      if (!this.tOn) { this.tOn = true; this.tAcc = 0; this.tAlt0 = alt; this.tMaxBank = 0; }
      this.tAcc += dTrk;
      this.tQuiet = 0;
      if (ab > this.tMaxBank) this.tMaxBank = ab;
      if (alt < this.tAlt0 - 60) this.tOn = false; // потерял высоту — вираж не засчитан
      else if (Math.abs(this.tAcc) >= TAU * 0.97) {
        this.tOn = false;
        if (this.tMaxBank > 0.785) this.emit('turn360');
      }
    } else if (this.tOn) {
      this.tQuiet += dt;
      if (this.tQuiet > 1.2) this.tOn = false;
    }

    // ---------- перевёрнутый полёт > 4 с ----------
    if (uy < -0.5 && Math.abs(fy) < 0.6 && Math.abs(q) < 0.22) { // |q| мал: не верх петли, а полёт «на спине»
      this.invT += dt; this.invGap = 0;
      if (!this.invDone && this.invT >= 4) { this.invDone = true; this.emit('inverted'); }
    } else {
      this.invGap += dt;
      if (this.invGap > 0.4) this.invT = 0;
      if (this.invGap > 1) this.invDone = false;
    }

    // ---------- полёт на ноже > 3 с (крен 70–110°, без виража) ----------
    if (ab > 1.22 && ab < 1.92 && Math.abs(fy) < 0.5 && Math.abs(ac.g) < 1.8) {
      this.kT += dt; this.kGap = 0;
      if (!this.kDone && this.kT >= 3) { this.kDone = true; this.emit('knife'); }
    } else {
      this.kGap += dt;
      if (this.kGap > 0.4) this.kT = 0;
      if (this.kGap > 1) this.kDone = false;
    }

    // ---------- бреющий проход: ниже 15 м, на скорости, шасси убрано, не над полосой, > 4 с ----------
    if (agl < 15 && ias > 1.3 * vS && (!spec.retract || ac.gearPos < 0.05) && !ac.airport && uy > 0.3) {
      this.lT += dt; this.lGap = 0;
      if (!this.lDone && this.lT >= 4) { this.lDone = true; this.emit('lowpass'); }
    } else {
      this.lGap += dt;
      if (this.lGap > 0.5) this.lT = 0;
      if (agl > 40) this.lDone = false;
    }
  }

  // вернулись в горизонтальный полёт: что это было?
  evalExcursion(alt) {
    const dTrk = Math.abs(wrapPi(this.trk - this.refTrk));
    const dAlt = alt - this.refAlt;
    const dRoll = Math.abs(this.rollTot - this.refRoll);
    const dPitch = this.pitchTot - this.refPitch;
    const half = dPitch > 2.0 && dPitch < 4.4 && dRoll > 1.9 && dRoll < 4.4; // полпетли + полбочки
    if (this.eInv && dPitch > 5.0 && this.eMaxFy > 0.5 && this.eMinFy < -0.3 && dRoll < 2.1) this.emit('loop');
    else if (this.eInv && half && dTrk > 2.2 && dAlt > 25 && this.eMaxFy > 0.6) this.emit('immelmann');
    else if (this.eInv && half && dTrk > 2.2 && dAlt < -25 && this.eMinFy < -0.4) this.emit('splits');
    else if (!this.eInv && dTrk > 2.4 && Math.abs(this.eTrk) > 2.4 && Math.abs(this.eTrk) < 4.2 && dAlt > 40 && this.eMaxFy > 0.2) this.emit('chandelle');
  }
}

// ---------- модуль игры ----------
export function createAerobatics(G) {
  const flightCount = {}; // сколько раз каждая фигура уже была в этом полёте
  let lastId = null, lastT = -1e9, streak = 0, hoho = false;
  const paid = { xp: 0, money: 0 };

  const A = {
    score: 0, // очки пилотажа за текущий полёт
    done: [], // выполненные фигуры за полёт: [{ id, name, score, combo, t }]
    combo: 1,
    tricks: TRICKS,
    detector: null,
    update,
    reset,
  };
  const det = (A.detector = new TrickDetector(onTrick));

  // ---- плашка ----
  const root = document.createElement('div');
  root.className = 'aero';
  root.innerHTML = '<div class="aero-plate" hidden><div class="aero-name"></div><div class="aero-pts"></div><div class="aero-combo"></div></div>';
  G.ui.appendChild(root);
  const plate = root.querySelector('.aero-plate');
  const elName = root.querySelector('.aero-name'), elPts = root.querySelector('.aero-pts'), elCombo = root.querySelector('.aero-combo');
  const SHOW = 2.3;
  let showT = 0;

  function show(name, score, combo, extra) {
    elName.textContent = name;
    elPts.textContent = '+' + score;
    elCombo.textContent = combo > 1 ? 'Комбо ×' + combo + (extra ? ' · ' + extra : '') : extra || '';
    elCombo.hidden = !elCombo.textContent;
    plate.classList.toggle('aero-is-combo', combo > 1);
    plate.hidden = false;
    plate.classList.remove('aero-in', 'aero-out');
    void plate.offsetWidth; // перезапуск анимации появления
    plate.classList.add('aero-in');
    showT = SHOW;
  }
  function hidePlate() {
    showT = 0;
    plate.hidden = true;
    plate.classList.remove('aero-in', 'aero-out');
  }

  function onTrick(id, ac) {
    const def = TRICKS[id];
    if (!def) return;
    const now = G.flight ? G.flight.time : G.time.sim;
    const n = flightCount[id] || 0;
    flightCount[id] = n + 1;
    streak = id === lastId ? streak + 1 : 0;
    const inWindow = lastId !== null && now - lastT < COMBO_WINDOW;
    if (id === 'roll2' && inWindow) { /* вторая бочка той же серии вращения — множитель сохраняется */ }
    else if (inWindow && id !== lastId) A.combo = Math.min(COMBO_MAX, A.combo + 1);
    else A.combo = 1;
    lastId = id;
    lastT = now;
    const score = Math.max(10, Math.round((def.score * STREAK_K[Math.min(streak, STREAK_K.length - 1)] * A.combo) / 10) * 10);
    A.score += score;
    A.done.push({ id, name: def.name, score, combo: A.combo, t: now });

    // профиль: счётчики и лучший счёт за полёт
    const prof = G.profile;
    if (prof) {
      const tr = (prof.tricks ??= { counts: {}, best: 0 });
      tr.counts ??= {};
      tr.counts[id] = (tr.counts[id] || 0) + 1;
      if (A.score > (tr.best || 0)) tr.best = A.score;
      saveProfile(prof);
    }
    // награда: небольшая, убывает за повторы, есть потолок; в пробном вылете — нет
    const trial = !!(G.flight && G.flight.session && G.flight.session.trial);
    const k = n < REWARD_K.length ? REWARD_K[n] : 0;
    if (!trial && k > 0 && G.career && G.career.addReward) {
      const xp = Math.min(Math.round(def.xp * k * (A.combo > 1 ? 1.5 : 1)), REWARD_CAP.xp - paid.xp);
      const money = Math.min(Math.round(def.money * k), REWARD_CAP.money - paid.money);
      if (xp > 0 || money > 0) {
        paid.xp += Math.max(0, xp);
        paid.money += Math.max(0, money);
        G.career.addReward({ xp: Math.max(0, xp), money: Math.max(0, money) });
      }
    }

    let extra = '';
    if (A.combo === COMBO_MAX && !hoho) { hoho = true; extra = 'Три-хо-хо!'; }
    show(def.name, score, A.combo, extra);
    G.input?.haptic?.(30);
    G.audio?.play?.('ui_star');
    G.bus.emit('trick:done', { id, name: def.name, score, ac, combo: A.combo });
  }

  function reset(ac = null) {
    A.score = 0;
    A.done.length = 0;
    A.combo = 1;
    for (const k in flightCount) flightCount[k] = 0;
    lastId = null; lastT = -1e9; streak = 0; hoho = false;
    paid.xp = paid.money = 0;
    det.reset(ac);
    hidePlate();
  }

  function update(dt) {
    if (G.mode !== 'flight' || !G.flight || G.flight.ended) return;
    const p = G.player;
    if (p && p.isPlayer) det.step(p, dt);
    if (showT > 0) {
      showT -= dt;
      if (showT <= 0.35 && !plate.classList.contains('aero-out')) { plate.classList.remove('aero-in'); plate.classList.add('aero-out'); }
      if (showT <= 0) hidePlate();
    }
  }

  G.bus.on('flight:start', (e) => reset(e && e.ac ? e.ac : null));
  G.bus.on('flight:end', hidePlate);
  G.bus.on('menu:show', hidePlate);
  return A;
}
