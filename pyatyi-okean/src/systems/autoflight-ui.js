// Интерфейс автопилота (свой корневой элемент .af в G.ui): кнопки «АП», «Посадка»/«К цели», «Вышка» под верхними
// кнопками справа; панель уставок с ± под ними; слева вверху у мини-карты — строка пункта назначения, руление, чек-лист;
// метки маршрута руления на земле. Раскладка для левши зеркалится (direction: rtl), как у touch/hud.
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
      <button type="button" class="af-btn af-b-tower" hidden>${ICON.tower}<span><b>ВЫШКА</b><i></i></span></button>
      <button type="button" class="af-btn af-b-mode" hidden><span class="af-ico"></span><span><b></b><i></i></span></button>
      <button type="button" class="af-btn af-b-ap" aria-label="Автопилот"><b>АП</b><i class="af-lamp"></i></button>
    </div>
    <div class="af-side">
      <div class="af-panel" hidden>
        <div class="af-p-head"><b></b><span></span></div>
        <div class="af-p-cols">
          <div class="af-col" data-k="hdg"><button type="button" data-d="1" aria-label="Курс плюс 10">+</button><div class="af-val"><i>КУРС</i><b></b></div><button type="button" data-d="-1" aria-label="Курс минус 10">−</button></div>
          <div class="af-col" data-k="alt"><button type="button" data-d="1" aria-label="Высота плюс 100">+</button><div class="af-val"><i>ВЫСОТА</i><b></b></div><button type="button" data-d="-1" aria-label="Высота минус 100">−</button></div>
          <div class="af-col" data-k="spd"><button type="button" data-d="1" aria-label="Скорость плюс 10">+</button><div class="af-val"><i>СКОРОСТЬ</i><b></b></div><button type="button" data-d="-1" aria-label="Скорость минус 10">−</button></div>
        </div>
        <div class="af-p-phase" hidden></div>
      </div>
      <div class="af-tag af-taxi" hidden><i class="af-arrow">${ICON.arrow}</i><span class="af-tx"><b></b><span></span></span></div>
      <div class="af-tag af-check" hidden><span class="af-tx"><b>Чек-лист</b><span></span></span><button type="button" class="af-check-x" aria-label="Выключить подсказки чек-листа">×</button></div>
    </div>`;
  G.ui.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const el = {
    dots: [...root.querySelectorAll('.af-dots i')],
    dest: $('.af-dest'), destA: $('.af-dest .af-arrow'), destB: $('.af-dest b'), destS: $('.af-dest .af-tx > span'),
    taxi: $('.af-taxi'), taxiA: $('.af-taxi .af-arrow'), taxiB: $('.af-taxi b'), taxiS: $('.af-taxi .af-tx > span'),
    check: $('.af-check'), checkS: $('.af-check .af-tx > span'), checkX: $('.af-check-x'),
    row: $('.af-row'), side: $('.af-side'), tower: $('.af-b-tower'), towerI: $('.af-b-tower i'), mode: $('.af-b-mode'), modeIco: $('.af-b-mode .af-ico'),
    modeB: $('.af-b-mode b'), modeI: $('.af-b-mode i'), ap: $('.af-b-ap'),
    panel: $('.af-panel'), head: $('.af-p-head b'), sum: $('.af-p-head span'), cols: $('.af-p-cols'), phase: $('.af-p-phase'),
    vHdg: $('[data-k="hdg"] b'), vAlt: $('[data-k="alt"] b'), vSpd: $('[data-k="spd"] b'), colHdg: $('[data-k="hdg"]'), colSpd: $('[data-k="spd"]'),
  };

  let visible = false, needLayout = true, modeAct = null, layoutAcc = 0;
  const txt = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  const hide = (node, h) => { if (node.hidden !== h) node.hidden = h; };
  const rot = (node, rad) => { const d = Math.round((rad * 180) / Math.PI); if (node._r !== d) { node._r = d; node.style.transform = `rotate(${d}deg)`; } };

  // кнопки: срабатывают на касание (как кнопки touch), не мешая ручке и РУД
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
  tap(el.mode, () => {
    if (modeAct === 'approach') af.engage('approach');
    else if (modeAct === 'nav') af.engage('nav');
  });
  tap(el.tower, () => af.requestTower());
  tap(el.dest, () => G.bus.emit('input:map'));
  tap(el.checkX, () => af.hideChecklists());
  for (const col of root.querySelectorAll('.af-col')) {
    for (const b of col.querySelectorAll('button')) tap(b, () => { af.adjust(col.dataset.k, +b.dataset.d); update(G.player); });
  }

  // правая колонка (панель, руление, чек-лист) не должна наезжать на кнопки справа (в заданиях их больше) —
  // тогда уходит левее; на радиообмен HUD — тогда опускается под него, а если места мало, панель сворачивается до строки
  let shift = 0, down = 0, squeezed = false;
  function layout() {
    needLayout = false;
    const w = G.canvas.clientWidth || innerWidth, h = G.canvas.clientHeight || innerHeight;
    root.style.setProperty('--hs', uiScale(w, h).toFixed(3));
    root.classList.toggle('af-lefty', !!G.profile.settings.leftHanded);
    shift = 0;
    root.style.setProperty('--af-shift', '0px');
    const cl = G.ui.querySelector('.touch-cluster');
    const pr = el.side.getBoundingClientRect();
    if (!cl || !pr.height) return;
    const base = { top: pr.top - down, bottom: pr.bottom - down + (squeezed ? 110 : 0), left: pr.left, right: pr.right };
    let r = null;
    for (const b of cl.children) {
      if (b.hidden) continue;
      const br = b.getBoundingClientRect();
      if (br.width && br.bottom > base.top && br.top < base.bottom - 2 && br.left < base.right && br.right > base.left) {
        r = r ? { left: Math.min(r.left, br.left), right: Math.max(r.right, br.right) } : { left: br.left, right: br.right };
      }
    }
    if (!r) return;
    const lefty = root.classList.contains('af-lefty');
    const s = lefty ? r.right + 8 - base.left : base.right - (r.left - 8);
    if (s > 0) { shift = Math.ceil(s); root.style.setProperty('--af-shift', shift + 'px'); }
  }
  function dodgeRadio() {
    const ra = G.ui.querySelector('.hud-radio');
    let d = 0;
    const pr = el.side.getBoundingClientRect();
    if (ra && pr.height) {
      const rr = ra.getBoundingClientRect();
      const top0 = pr.top - down;
      if (rr.height && rr.left < pr.right && rr.right > pr.left && rr.bottom > top0 && rr.top < top0 + 40) d = Math.ceil(rr.bottom + 6 - top0);
    }
    if (d !== down) { down = d; root.style.setProperty('--af-down', d + 'px'); }
    const H = G.canvas.clientHeight || innerHeight;
    const full = el.side.scrollHeight + (squeezed ? 110 : 0);
    const sq = d > 0 && pr.top - down + d + full > H * 0.66;
    if (sq !== squeezed) { squeezed = sq; root.classList.toggle('af-squeezed', sq); }
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
    dodgeRadio();
    layoutAcc += 0.1;
    if (layoutAcc > 1) { layoutAcc = 0; needLayout = true; }

    // --- кнопка АП ---
    el.ap.classList.toggle('is-on', af.active);
    el.ap.classList.toggle('is-armed', !af.active && af.armed === 'nav');
    el.ap.classList.toggle('is-off', !af.active && (p.onGround || p.stalled));

    // --- «Посадка» / «К цели» ---
    let act = null;
    const apt = !p.onGround ? af.approachAirport() : null;
    if (af.mode !== 'approach' && apt) act = 'approach';
    else if (!af.active || af.mode === 'hold') { if (af.destination && !p.onGround) act = 'nav'; }
    if (act !== modeAct) {
      modeAct = act;
      hide(el.mode, !act);
      if (act === 'approach') { el.modeIco.innerHTML = ICON.land; txt(el.modeB, 'ПОСАДКА'); }
      else if (act === 'nav') { el.modeIco.innerHTML = ICON.nav; txt(el.modeB, 'К ЦЕЛИ'); }
    }
    if (act === 'approach') txt(el.modeI, N.aptName(apt).slice(0, 10));
    else if (act === 'nav') txt(el.modeI, af.destination.name.slice(0, 10));

    // --- «Вышка» ---
    const ta = af.towerAction();
    hide(el.tower, !ta);
    if (ta) txt(el.towerI, ta.label);

    // --- панель ---
    const st = af.status();
    hide(el.panel, !st);
    if (st) {
      txt(el.head, st.title);
      txt(el.sum, st.sum || '');
      el.panel.classList.toggle('has-cols', !!st.cols);
      hide(el.cols, !st.cols);
      hide(el.phase, !st.phase);
      if (st.phase) txt(el.phase, st.phase);
      if (st.cols) {
        const T = af.target;
        txt(el.vHdg, N.fmtHdg(T.heading));
        txt(el.vAlt, Math.round(T.alt) + ' м');
        txt(el.vSpd, af.athr ? Math.round(T.speed * 3.6) + '' : 'РУД');
        el.colHdg.classList.toggle('is-auto', !!st.hdgAuto);
        el.colSpd.classList.toggle('is-manual', !af.athr);
      }
      if (el.panel._was !== true) { el.panel._was = true; needLayout = true; }
    } else el.panel._was = false;

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
    // --- руление ---
    const X = af.taxi;
    hide(el.taxi, !(X && !X.done));
    if (X && !X.done) {
      txt(el.taxiB, `Рули к полосе ${X.name}`);
      txt(el.taxiS, X.fast ? `${Math.round(X.left)} м · медленнее! до 30 км/ч` : `до старта ${Math.round(X.left)} м · ручка влево-вправо — поворот`);
      el.taxi.classList.toggle('is-warn', X.fast);
      rot(el.taxiA, X.bearing - p.heading);
    }
    // --- чек-лист ---
    const ct = af.checkOn ? af.checklist.text : '';
    hide(el.check, !ct);
    if (ct) txt(el.checkS, ct);
  }

  return {
    update, dots,
    reset() { modeAct = undefined; needLayout = true; for (const d of el.dots) { d._on = false; d.style.display = 'none'; } },
    hide() { visible = false; root.hidden = true; },
    relayout() { needLayout = true; },
  };
}
