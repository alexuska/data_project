// МАРКЕРЫ В МИРЕ: значок + подпись «что это» + имя + дистанция («ЛЕТИ СЮДА · Мост · 2,3 км»); если точка вне кадра —
// стрелка у края обзорной области с той же подписью. Форма и цвет — по смыслу: куда лететь, где садиться, что поразить.
// Здесь же прицельные марки (пушка, упреждение, кольцо захвата) и коллиматор вида из кабины.
// Элементы DOM — из пула; стиль/текст меняются только при изменении округлённых значений.
import * as THREE from 'three';
import { clamp } from '../core/util.js';

const POOL = 24;
const _v = new THREE.Vector3(), _f = new THREE.Vector3();
// подпись «что это» для каждого вида маркера
export const MARK_TAG = { waypoint: 'ЛЕТИ СЮДА', airport: 'ПОСАДКА', target: 'ЦЕЛЬ', fire: 'ПОЖАР', ring: 'ПРОЛЕТИ ЗДЕСЬ', friend: 'СВОЙ', bandit: '' };
const KINDS = MARK_TAG;
const fmtD = (dk) => (dk < 1000 ? dk * 10 + ' м' : dk < 1100 ? ((dk - 1000) / 10).toFixed(1).replace('.', ',') + ' км' : Math.round((dk - 1000) / 10) + ' км');

// onFirst(kind) — вид маркера впервые появился на экране (для одноразовой подсказки)
export function createMarkers(G, layer, colli, onFirst) {
  const shownKinds = {};
  const cam = G.camera;
  const items = [];
  for (let i = 0; i < POOL; i++) {
    const el = document.createElement('div');
    el.className = 'hud-mk';
    el.hidden = true;
    el.innerHTML = '<div class="hud-mk-ico"></div><div class="hud-mk-txt"><span class="hud-mk-tag"></span><b></b><i></i></div>';
    layer.appendChild(el);
    items.push({ el, ico: el.firstChild, tag: el.querySelector('.hud-mk-tag'), lbl: el.querySelector('b'), dst: el.querySelector('i'), on: false, x: -1, y: -1, kind: '', label: null, dk: -1, off: -1, rot: 999, sc: -1, gx: NaN, gz: NaN, gy: 0 });
  }
  const mkEl = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.hidden = true;
    layer.appendChild(el);
    return { el, on: false, x: -1, y: -1, st: -1 };
  };
  const bore = mkEl('hud-aim hud-aim-bore'), lead = mkEl('hud-aim hud-aim-lead'), lock = mkEl('hud-aim hud-aim-lock'), fpm = mkEl('hud-aim hud-aim-fpm');
  lock.el.innerHTML = '<span></span>';
  const lockTxt = lock.el.firstChild;

  // коллиматор: лестница тангажа (линии через 5°)
  const ladder = colli.querySelector('.hud-colli-ladder');
  for (let d = -85; d <= 85; d += 5) {
    const ln = document.createElement('div');
    ln.className = 'hud-colli-ln' + (d === 0 ? ' is-hor' : d % 10 === 0 ? ' is-major' : '') + (d < 0 ? ' is-neg' : '');
    ln.style.setProperty('--d', d);
    if (d !== 0 && d % 10 === 0) ln.innerHTML = `<span>${Math.abs(d)}</span><span>${Math.abs(d)}</span>`;
    ladder.appendChild(ln);
  }
  let colliOn = false, ppdLast = -1, ladKey = 1e9;

  let W = 1, H = 1, S = 1;
  let inL = 60, inR = 60, inT = 70, inB = 130, inT0 = 70, topPx = 0;

  // мир → экран. Возвращает true, если точка перед камерой; результат в sx, sy; cxv, cyv — направление в осях камеры
  let sx = 0, sy = 0, cxv = 0, cyv = 0;
  function project(x, y, z) {
    _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    cxv = _v.x; cyv = _v.y;
    if (_v.z > -0.5) return false;
    _v.applyMatrix4(cam.projectionMatrix);
    sx = (_v.x * 0.5 + 0.5) * W; sy = (-_v.y * 0.5 + 0.5) * H;
    return true;
  }
  function put(o, show, x, y) {
    if (!show) { if (o.on) { o.on = false; o.el.hidden = true; } return; }
    const qx = Math.round(x * 2), qy = Math.round(y * 2);
    if (qx !== o.x || qy !== o.y) { o.x = qx; o.y = qy; o.el.style.transform = `translate3d(${qx / 2}px,${qy / 2}px,0)`; }
    if (!o.on) { o.on = true; o.el.hidden = false; }
  }

  function place(it, m, ac) {
    let y = m.y;
    if (typeof y !== 'number') {
      if (it.gx !== m.x || it.gz !== m.z) { it.gx = m.x; it.gz = m.z; it.gy = Math.max(0, G.world.heightAt(m.x, m.z)) + 2; }
      y = it.gy;
    }
    const dx = m.x - ac.pos.x, dy = y - ac.pos.y, dz = m.z - ac.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const front = project(m.x, y, m.z);
    const kind = KINDS[m.kind] != null ? m.kind : 'waypoint';
    // верх экрана занят карточкой задачи — точки под ней показываем стрелкой у края
    let off = !front || sx < 24 * S || sx > W - 24 * S || sy < Math.max(56 * S, topPx) || sy > H - inB + 30 * S;
    let rot = 0, sc = 0;
    if (off) {
      if (kind === 'bandit' && dist > 5000) { put(it, false); return; }
      // направление от центра обзорной области
      const ccx = (inL + W - inR) / 2, ccy = (inT + H - inB) / 2;
      let ax = front ? sx - ccx : cxv, ay = front ? sy - ccy : -cyv;
      if (Math.abs(ax) + Math.abs(ay) < 1e-4) ay = 1;
      const hx = (W - inL - inR) / 2, hy = (H - inT - inB) / 2;
      const t = 1 / Math.max(Math.abs(ax) / hx, Math.abs(ay) / hy);
      sx = ccx + ax * t; sy = ccy + ay * t;
      rot = Math.round(Math.atan2(ay, ax) * 30);
    } else if (kind === 'ring') {
      const focal = (H / 2) / Math.tan((cam.fov * Math.PI) / 360);
      sc = Math.round(clamp(((m.radius || 60) / Math.max(dist, 1)) * focal / (12 * S), 0.5, 14) * 20);
    }
    if (dist < 25 && kind !== 'ring') { put(it, false); return; }
    put(it, true, sx, sy);
    if (kind !== it.kind) { it.kind = kind; it.el.className = 'hud-mk hud-mk-' + kind + (it.off === 1 ? ' is-off' : ''); it.tag.textContent = KINDS[kind]; }
    if (!shownKinds[kind]) { shownKinds[kind] = 1; if (onFirst) onFirst(kind); }
    const o = off ? 1 : 0;
    if (o !== it.off) { it.off = o; it.el.classList.toggle('is-off', off); it.rot = 999; it.sc = -1; it.ico.style.transform = ''; }
    if (off) { if (rot !== it.rot) { it.rot = rot; it.ico.style.transform = `rotate(${(rot / 30).toFixed(3)}rad)`; } }
    else if (sc !== it.sc) { it.sc = sc; it.ico.style.transform = sc ? `scale(${(sc / 20).toFixed(2)})` : ''; }
    const label = m.label || '';
    if (label !== it.label) { it.label = label; it.lbl.textContent = label; }
    const dk = dist < 1000 ? Math.round(dist / 10) : 1000 + Math.round(dist / 100);
    if (dk !== it.dk) {
      it.dk = dk;
      it.dst.textContent = fmtD(dk);
    }
  }

  return {
    resize(w, h, scale, portrait) {
      W = w; H = h; S = scale;
      inL = inR = portrait ? 34 * S : Math.max(112 * S, w * 0.285); inT0 = (portrait ? 190 : 86) * S; inB = (portrait ? 0.32 * h / S + 140 : 176) * S;
      inT = Math.max(inT0, topPx + 18 * S);
      ppdLast = -1;
    },
    // нижний край карточки задачи (px от верха экрана): стрелки и подписи — ниже неё
    setTop(px) {
      topPx = px || 0;
      inT = Math.max(inT0, topPx + 18 * S);
    },
    // list — маркеры задания, auto[0..nAuto) — автоматические (полоса, противники)
    update(ac, list, auto, nAuto) {
      let n = 0;
      for (let i = 0; i < nAuto && n < POOL; i++) place(items[n++], auto[i], ac);
      const ln = list ? list.length : 0;
      for (let i = 0; i < ln && n < POOL; i++) if (list[i]) place(items[n++], list[i], ac);
      for (let i = n; i < POOL; i++) if (items[i].on) put(items[i], false);
    },
    hideAll() {
      for (let i = 0; i < POOL; i++) put(items[i], false);
      put(bore, false); put(lead, false); put(lock, false); put(fpm, false);
      if (colliOn) { colliOn = false; colli.hidden = true; }
    },
    // прицельные марки: перекрестие пушки, точка упреждения, кольцо захвата
    aim(ac, view) {
      const w = ac.weapons;
      const ok = !!w && (view === 'chase' || view === 'cockpit');
      const gun = ok && w.gun;
      _f.set(0, 0, -1).applyQuaternion(ac.quat);
      if (gun) {
        const r = 650;
        put(bore, project(ac.pos.x + _f.x * r, ac.pos.y + _f.y * r, ac.pos.z + _f.z * r), sx, sy);
      } else put(bore, false);
      const lk = ok ? w.lock : null;
      const tgt = (lk && lk.target) || (ok && G.combat ? G.combat.playerTarget : null);
      const tp = tgt && tgt.pos && tgt.alive !== false ? tgt.pos : null;
      if (gun && tp) {
        const d = tp.distanceTo(ac.pos);
        const tv = tgt.vel, t = d / 850;
        const show = d < 1900 && project(tp.x + (tv ? tv.x * t : 0), tp.y + (tv ? tv.y * t : 0), tp.z + (tv ? tv.z * t : 0));
        put(lead, show, sx, sy);
      } else put(lead, false);
      if (lk && tp && project(tp.x, tp.y, tp.z)) {
        put(lock, true, sx, sy);
        const stt = lk.locked ? 101 : Math.round(clamp(lk.progress || 0, 0, 1) * 20);
        if (stt !== lock.st) {
          lock.st = stt;
          lock.el.classList.toggle('is-locked', stt === 101);
          lock.el.style.setProperty('--p', stt === 101 ? 1 : stt / 20);
          lockTxt.textContent = stt === 101 ? 'ЗАХВАТ' : '';
        }
      } else put(lock, false);
    },
    // коллиматор вида из кабины: лестница тангажа и вектор скорости
    collimator(ac, show) {
      if (show !== colliOn) { colliOn = show; colli.hidden = !show; }
      if (!show) { put(fpm, false); return; }
      const ppd = ((H / 2) / Math.tan((cam.fov * Math.PI) / 360)) * (Math.PI / 180);
      const q = Math.round(ppd * 20);
      if (q !== ppdLast) { ppdLast = q; colli.style.setProperty('--ppd', (q / 20).toFixed(2)); }
      const key = Math.round(ac.pitch * 2000) * 7 + Math.round(ac.bank * 1000);
      if (key !== ladKey) {
        ladKey = key;
        ladder.style.transform = `rotate(${(-ac.bank).toFixed(4)}rad) translate3d(0,${((ac.pitch * 180 / Math.PI) * ppd).toFixed(1)}px,0)`;
      }
      const v = ac.vel.length();
      if (v > 15) {
        const r = 1200 / v;
        put(fpm, project(ac.pos.x + ac.vel.x * r, ac.pos.y + ac.vel.y * r, ac.pos.z + ac.vel.z * r), sx, sy);
      } else put(fpm, false);
    },
  };
}
