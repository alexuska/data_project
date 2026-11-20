// Интерфейс автопилота (свой корневой элемент .af в G.ui). Всё управление — одна полоса под верхними кнопками справа
// (на телефоне 844×390: x ≥ 520, y 58…102 — ниже живёт радио HUD, левее — карточка задачи):
//   АП выключен:  [руление →] [ВЫШКА] [ПОСАДКА | К ЦЕЛИ] [АП]
//   АП включён:   [ПОСАДКА?] [курс/высота/скорость — тап выбирает] [−] [+] [АП]
//   автопосадка:  [АВТОПОСАДКА · фаза] [АП]
// Слева вверху между мини-картой и шкалой курса — строка пункта назначения (тап — карта); на земле — метки руления.
// Раскладка для левши зеркалится (direction: rtl), как у touch/hud.
import { Vector3 } from 'three';
import { uiScale } from '../ui/touch.js';
import * as N from './autoflight-nav.js';

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/>${extra}</svg>`;
const ICON = {
  arrow: svg('M12 3l6 15-6-3.6L6 18z'),
  tower: svg('M9 21l1.5-11h3L15 21M8 10h8l-1-4H9zM12 6V3M6.5 4.5a7 7 0 000 7M17.5 4.5a7 7 0 010 7'),
  land: svg('M3 20h18M4.5 9.5l2-1 4 3 7.5-2.2c1.2-.3 2.3.3 2.5 1.2.2.8-.4 1.5-1.3 1.8L8.8 15.5 4 12.2z'),
  nav: svg('M12 2.5a6.5 6.5 0 016.5 6.5c0 4.8-6.5 12.5-6.5 12.5S5.5 13.8 5.5 9A6.5 6.5 0 0112 2.5z', '<circle cx="12" cy="9" r="2.3"/>'),
};
const NDOTS = 30;
const KEYS = ['hdg', 'alt', 'spd'];
const _v = new Vector3();

export function createAfUi(G, af) {
  const root = document.createElement('div');
  root.className = 'af';
  root.hidden = true;
  root.innerHTML = `
    <div class="af-dots">${'<i></i>'.repeat(NDOTS)}</div>
    <div class="af-tags">
      <button type="button" class="af-tag af-dest" hidden aria-label="Пункт назначения — открыть карту"><i class="af-arrow">${ICON.arrow}</i><span class="af-tx"><b></b><span></span></span></button>
    </div>
    <div class="af-row">
      <div class="af-tag af-taxi" hidden><i class="af-arrow">${ICON.arrow}</i><span class="af-tx"><b></b><span></span></span></div>
      <div class="af-phase" hidden><b></b><span></span></div>
      <button type="button" class="af-btn af-b-tower" hidden>${ICON.tower}<span><b>ВЫШКА</b><i></i></span></button>
      <button type="button" class="af-btn af-b-mode" hidden><span class="af-ico"></span><span><b></b><i></i></span></button>
      <button type="button" class="af-set" hidden aria-label="Выбрать уставку: курс, высота, скорость">
        <span data-k="hdg"></span><span data-k="alt"></span><span data-k="spd"></span>
      </button>
      <button type="button" class="af-btn af-pm" data-d="-1" hidden aria-label="Меньше">−</button>
      <button type="button" class="af-btn af-pm" data-d="1" hidden aria-label="Больше">+</button>
      <button type="button" class="af-btn af-b-ap" aria-label="Автопилот"><b>АП</b><i class="af-lamp"></i></button>
    </div>`;
  G.ui.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const el = {
    dots: [...root.querySelectorAll('.af-dots i')],
    dest: $('.af-dest'), destA: $('.af-dest .af-arrow'), destB: $('.af-dest b'), destS: $('.af-dest .af-tx > span'),
    taxi: $('.af-taxi'), taxiA: $('.af-taxi .af-arrow'), taxiB: $('.af-taxi b'), taxiS: $('.af-taxi .af-tx > span'),
    phase: $('.af-phase'), phaseB: $('.af-phase b'), phaseS: $('.af-phase span'),
    tower: $('.af-b-tower'), towerI: $('.af-b-tower i'), mode: $('.af-b-mode'), modeIco: $('.af-b-mode .af-ico'),
    modeB: $('.af-b-mode b'), modeI: $('.af-b-mode i'), ap: $('.af-b-ap'),
    set: $('.af-set'), sv: { hdg: $('.af-set [data-k="hdg"]'), alt: $('.af-set [data-k="alt"]'), spd: $('.af-set [data-k="spd"]') },
    pm: [...root.querySelectorAll('.af-pm')],
  };

  let visible = false, needLayout = true, modeAct = null, sel = 'alt';
  const txt = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  const hide = (node, h) => { if (node.hidden !== h) node.hidden = h; };
  const rot = (node, rad) => { const d = Math.round((rad * 180) / Math.PI); if (node._r !== d) { node._r = d; node.style.transform = `rotate(${d}deg)`; } };

  // кнопки срабатывают на касание (как кнопки touch), не мешая ручке и РУД
  function tap(node, fn) {
    node.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); node.classList.add('is-down'); fn(e); });
    const up = () => node.classList.remove('is-down');
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', up);
  }
  tap(el.ap, () => {
    if (af.active) af.disengage('Автопилот выключен — управление у тебя', 'info');
    else af.engage('hold');
  });
  tap(el.mode, () => { if (modeAct === 'approach') af.engage('approach'); else if (modeAct === 'nav') af.engage('nav'); });
  tap(el.tower, () => af.requestTower());
  tap(el.dest, () => G.bus.emit('input:map'));
  tap(el.set, () => {
    const keys = af.mode === 'nav' ? ['alt', 'spd'] : KEYS;
    sel = keys[(keys.indexOf(sel) + 1) % keys.length];
    update(G.player);
  });
  for (const b of el.pm) tap(b, () => { af.adjust(sel, +b.dataset.d); update(G.player); });

  function layout() {
    needLayout = false;
    const w = G.canvas.clientWidth || innerWidth, h = G.canvas.clientHeight || innerHeight;
    root.style.setProperty('--hs', uiScale(w, h).toFixed(3));
    root.classList.toggle('af-lefty', !!G.profile.settings.leftHanded);
  }

  // метки руления на земле: точки через каждые ~22 м вперёд по маршруту, повороты — крупнее
  function dots(p) {
    const X = af.taxi;
    let n = 0;
    if (visible && p && X && !X.done && G.camera) {
      const W = G.canvas.clientWidth || innerWidth, H = G.canvas.clientHeight || innerHeight;
      const y = (X.elev || 0) + 0.4;
      let px = p.pos.x, pz = p.pos.z, budget = 700, carry = 14;
      for (let i = X.idx; i < X.points.length && n < NDOTS && budget > 0; i++) {
        const q = X.points[i];
        const len = Math.hypot(q.x - px, q.z - pz);
        for (let s = carry; s < len && n < NDOTS && budget > 0; s += 22) {
          const k = s / len;
          if (put(n, px + (q.x - px) * k, y, pz + (q.z - pz) * k, false, W, H)) n++;
          budget -= 22;
        }
        carry = len <= carry ? carry - len : 22 - ((len - carry) % 22);
        if (n < NDOTS && put(n, q.x, y, q.z, true, W, H)) n++;
        px = q.x; pz = q.z;
      }
    }
    for (let i = n; i < NDOTS; i++) if (el.dots[i]._on) { el.dots[i]._on = false; el.dots[i].style.display = 'none'; }
  }
  function put(i, x, y, z, big, W, H) {
    _v.set(x, y, z).project(G.camera);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) return false;
    const d = el.dots[i];
    if (!d._on) { d._on = true; d.style.display = 'block'; }
    if (d._big !== big) { d._big = big; d.className = big ? 'is-turn' : ''; }
    d.style.transform = `translate3d(${((_v.x + 1) * 0.5 * W).toFixed(1)}px,${((1 - _v.y) * 0.5 * H).toFixed(1)}px,0)`;
    return true;
  }

  function update(p) {
    const show = G.mode === 'flight' && !G.paused && !!p && p.alive && !(G.hud && G.hud.photoMode);
    if (show !== visible) { visible = show; root.hidden = !show; if (show) needLayout = true; }
    if (!show) return;
    if (needLayout) layout();
    const on = af.active, appr = af.mode === 'approach';

    // --- кнопка АП ---
    el.ap.classList.toggle('is-on', on);
    el.ap.classList.toggle('is-armed', !on && af.armed === 'nav');
    el.ap.classList.toggle('is-off', !on && (p.onGround || p.stalled));

    // --- автопосадка: строка фазы вместо всего остального ---
    const st = af.status();
    hide(el.phase, !(st && appr));
    if (st && appr) { txt(el.phaseB, st.title); txt(el.phaseS, st.phase || ''); }

    // --- уставки (удержание / к цели): все три видны столбиком, выбранная — оранжевая, ± меняют её ---
    const setOn = !!(st && st.cols);
    hide(el.set, !setOn);
    for (const b of el.pm) hide(b, !setOn);
    if (setOn) {
      if (af.mode === 'nav' && sel === 'hdg') sel = 'alt';
      const T = af.target;
      txt(el.sv.hdg, `${af.mode === 'nav' ? 'НА ЦЕЛЬ' : 'КУРС'} ${N.fmtHdg(T.heading)}`);
      txt(el.sv.alt, `ВЫС ${Math.round(T.alt)} м`);
      txt(el.sv.spd, af.athr ? `СКОР ${Math.round(T.speed * 3.6)}` : 'СКОР — РУД');
      for (const k of KEYS) el.sv[k].classList.toggle('is-sel', k === sel);
      el.set.classList.toggle('is-terrain', !!af.terrain);
    }

    // --- «Посадка» / «К цели» ---
    let act = null;
    const apt = !p.onGround && !appr ? af.approachAirport() : null;
    if (apt) act = 'approach';
    else if ((!on || af.mode === 'hold') && af.destination && !p.onGround) act = 'nav';
    if (act !== modeAct) {
      modeAct = act;
      hide(el.mode, !act);
      if (act === 'approach') { el.modeIco.innerHTML = ICON.land; txt(el.modeB, 'ПОСАДКА'); }
      else if (act === 'nav') { el.modeIco.innerHTML = ICON.nav; txt(el.modeB, 'К ЦЕЛИ'); }
    }
    if (act === 'approach') txt(el.modeI, N.aptName(apt).slice(0, 9));
    else if (act === 'nav') txt(el.modeI, af.destination.name.slice(0, 9));
    el.mode.classList.toggle('is-compact', on);

    // --- «Вышка»: только без автопилота ---
    const ta = on ? null : af.towerAction();
    hide(el.tower, !ta);
    if (ta) txt(el.towerI, ta.label);

    // --- пункт назначения ---
    const d = af.destination;
    hide(el.dest, !d);
    if (d) {
      const dist = Math.hypot(d.x - p.pos.x, d.z - p.pos.z);
      const brg = N.bearing(p.pos.x, p.pos.z, d.x, d.z);
      const v = p.gs > 20 ? p.gs : p.spec.vCruise;
      const near = dist < 1500;
      txt(el.destB, near ? d.name : `${d.name} · ${N.fmtKm(dist)}`);
      txt(el.destS, near ? 'вы над аэродромом' : `${p.gs > 20 ? '' : '≈'}${N.fmtMin(dist / v)} · курс ${N.fmtHdg(brg)}`);
      rot(el.destA, brg - p.heading);
    }
    // --- руление: в той же полосе, левее кнопок ---
    const X = af.taxi;
    hide(el.taxi, !(X && !X.done));
    if (X && !X.done) {
      txt(el.taxiB, `К полосе ${X.name} · ${Math.round(X.left)} м`);
      txt(el.taxiS, X.fast ? 'медленнее! до 30 км/ч' : 'ручка влево-вправо');
      el.taxi.classList.toggle('is-warn', X.fast);
      rot(el.taxiA, X.bearing - p.heading);
    }
  }

  return {
    update, dots,
    reset() { modeAct = undefined; sel = 'alt'; needLayout = true; for (const d of el.dots) { d._on = false; d.style.display = 'none'; } },
    hide() { visible = false; root.hidden = true; },
    relayout() { needLayout = true; },
  };
}
