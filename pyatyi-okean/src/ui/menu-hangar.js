// Ангар: самолёт стоит в живом 3D-мире на стоянке Ясного, вокруг него — паспорт, улучшения и окраска.
import * as Models from '../aircraft/models.js';
import { esc, icon, fmtInt, fmtMoney, fmtNum, scale, pips, segmented, CLS_NAMES, ENGINE_NAMES } from './menu-kit.js';
import { CATALOG, getSpec } from '../aircraft/catalog.js';
import { ECONOMY } from '../systems/economy.js';
import { headingVec } from '../core/util.js';

const ROLES = [{ v: 'civil', label: 'Гражданские' }, { v: 'military', label: 'Военные' }];
const TABS = [{ v: 'passport', label: 'Паспорт' }, { v: 'upgrades', label: 'Улучшения' }, { v: 'livery', label: 'Окраска' }];
const byPrice = (a, b) => (ECONOMY[a.id]?.price ?? 0) - (ECONOMY[b.id]?.price ?? 0);
const planesOf = (role) => CATALOG.filter((s) => s.role === role).sort(byPrice);

// ---------- характеристики для шкал (всё выводится из каталога) ----------
const MAXV = Math.max(...CATALOG.map((s) => s.vMax));
const rangeKm = (s, fuelK = 1) => ((s.fuel * fuelK) / s.burn) * s.vCruise * 1.4 / 1000;
const MAXR = Math.max(...CATALOG.map((s) => rangeKm(s)));
const agilityOf = (s) => (s.rollRate / 3.6) * 0.45 + (s.pitchRate / 1.5) * 0.3 + (s.maxG / 9) * 0.25;
const payloadKg = (s) => (s.seats || 0) * 95 + (s.cargo || 0) + (s.water || 0) * 0.3;
const MAXP = Math.max(...CATALOG.map(payloadKg));
function difficultyOf(s) {
  const k = ((s.vStall - 17) / (75 - 17)) * 0.6 + (Math.log10(s.mass / 1300) / Math.log10(150000 / 1300)) * 0.25 + (s.engine === 'jet' ? 0.15 : 0);
  return Math.max(1, Math.min(5, Math.round(1 + k * 4.4)));
}
const DIFF_NAMES = ['', 'прощает ошибки', 'послушный', 'требует внимания', 'строгий', 'для опытных'];
function statRows(spec, mods) {
  const rows = [];
  const vK = Math.sqrt(spec.vMax / MAXV);
  const vBonus = Math.sqrt((spec.vMax * (1 + (mods.thrust - 1) * 0.5 + (1 - mods.drag) * 0.5)) / MAXV) - vK;
  rows.push({ label: 'Скорость', k: vK, bonus: vBonus, value: `${fmtInt(spec.vMax * 3.6)} км/ч` });
  const ag = agilityOf(spec);
  rows.push({ label: 'Манёвренность', k: ag, bonus: ag * (mods.agility - 1), value: `${fmtNum(spec.maxG, spec.maxG % 1 ? 1 : 0)} g` });
  const r = rangeKm(spec);
  rows.push({ label: 'Дальность', k: Math.sqrt(r / MAXR), bonus: Math.sqrt(rangeKm(spec, mods.fuel) / MAXR) - Math.sqrt(r / MAXR), value: `${fmtInt(Math.round(rangeKm(spec, mods.fuel) / 10) * 10)} км` });
  if (spec.role === 'military') {
    const hp = spec.hardpoints || 0;
    rows.push({ label: 'Вооружение', k: 0.15 + (hp / 10) * 0.85, bonus: (mods.ammo - 1) * 0.3, value: `пушка · ${hp} подв.` });
  } else {
    const parts = [];
    if (spec.seats) parts.push(`${spec.seats} мест`);
    if (spec.cargo) parts.push(`${fmtNum(spec.cargo / 1000, spec.cargo % 1000 ? 1 : 0)} т`);
    else if (spec.water) parts.push(`${fmtNum(spec.water / 1000, 0)} т воды`);
    rows.push({ label: 'Вместимость', k: Math.max(0.06, Math.sqrt(payloadKg(spec) / MAXP)), bonus: 0, value: parts.join(' · ') });
  }
  return rows;
}

// ---------- 3D-витрина ----------
function createShowcase(G) {
  let model = null, spot = null, active = false, wrapped = false, dragging = false;
  const orbit = { yaw: 0.75, pitch: 0.16, radius: 30, want: 30, x: 0, y: 0, z: 0 };
  const rig = () => G.cameraRig || {};
  function parking() {
    if (spot) return spot;
    const w = G.world;
    const s = w.airportById?.yasny?.parking?.[0];
    if (s && typeof s.x === 'number' && typeof s.z === 'number') spot = { x: s.x, z: s.z, heading: s.heading ?? 0 };
    else {
      // запасной вариант: на полосе Ясного, чуть впереди исполнительного старта
      const st = w.runwayStart('yasny', 0, 'A');
      const d = headingVec(st.heading);
      spot = { x: st.x + d.x * 160, z: st.z + d.z * 160, heading: st.heading };
    }
    return spot;
  }
  function removeModel() {
    if (!model) return;
    G.scene.remove(model);
    try {
      if (typeof model.userData.dispose === 'function') model.userData.dispose();
      else model.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
    } catch (e) { /* ignore */ }
    model = null;
  }
  // самолёт на стоянке «живой»: шасси выпущено, огни по времени суток
  const parked = { throttle: 0, gearPos: 1, gearDown: true, flapsPos: 0, flaps: 0, airbrake: 0, engineOn: false, onGround: true, alive: true, controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 1, airbrake: 0 } };
  let raf = 0, last = 0, animOk = true;
  function tick(now) {
    raf = active ? requestAnimationFrame(tick) : 0;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!model || !animOk || typeof Models.animateModel !== 'function') return;
    try {
      const tod = G.world.timeOfDay ?? 12;
      model.userData.night = tod < 6 || tod > 19.5;
      Models.animateModel(model, parked, dt);
    } catch (e) { animOk = false; }
  }
  // запасной облёт, если камера-витрина ещё не реализована в cameraRig
  function fallbackOrbit(dt) {
    if (!dragging) orbit.yaw += dt * 0.1;
    orbit.radius += (orbit.want - orbit.radius) * Math.min(1, dt * 4);
    const cp = Math.cos(orbit.pitch), cam = G.camera;
    let y = orbit.y + Math.sin(orbit.pitch) * orbit.radius;
    const x = orbit.x + Math.sin(orbit.yaw) * cp * orbit.radius, z = orbit.z + Math.cos(orbit.yaw) * cp * orbit.radius;
    const gy = G.world.groundAt(x, z).y + 1.2;
    if (y < gy) y = gy;
    cam.position.set(x, y, z);
    cam.lookAt(orbit.x, orbit.y, orbit.z);
  }
  function ensureFallback() {
    const r = rig();
    if (wrapped || typeof r.setShowcase === 'function' || typeof r.setHangar === 'function' || typeof r.update !== 'function') return;
    wrapped = true;
    const orig = r.update.bind(r);
    r.update = (dt) => { orig(dt); if (active && G.mode === 'menu') fallbackOrbit(dt); };
  }
  return {
    show(planeId, livery) {
      removeModel();
      active = true;
      const spec = getSpec(planeId), s = parking();
      const y = G.world.groundAt(s.x, s.z).y + spec.gearHeight;
      try {
        model = Models.buildModel(planeId, livery ? { livery } : {});
        model.position.set(s.x, y, s.z);
        model.rotation.set(model.userData.groundPitch || 0, -s.heading, 0, 'YXZ');
        G.scene.add(model);
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      } catch (e) { console.error('[menu] модель', e); model = null; }
      const radius = Math.max(spec.length, spec.span) * 1.05 + 5;
      const target = { x: s.x, y: y + spec.length * 0.02, z: s.z, radius };
      Object.assign(orbit, { x: target.x, y: target.y, z: target.z, want: radius });
      const r = rig();
      try {
        if (typeof r.setShowcase === 'function') r.setShowcase(target);
        else if (typeof r.setHangar === 'function') r.setHangar(target);
        else ensureFallback();
      } catch (e) { console.error('[menu] камера', e); }
    },
    rotate(dx, dy) {
      const r = rig();
      if (typeof r.showcaseRotate === 'function') { try { r.showcaseRotate(dx * 0.008, dy * 0.006); } catch (e) { /* ignore */ } return; }
      orbit.yaw -= dx * 0.008;
      orbit.pitch = Math.max(0.03, Math.min(1.25, orbit.pitch + dy * 0.006));
    },
    setDragging(v) { dragging = v; },
    // сдвиг кадра: самолёт — в центре свободной от панели области
    frame(el) {
      const cam = G.camera, w = G.canvas.clientWidth, h = G.canvas.clientHeight;
      const panel = el.querySelector('.menu-hangar-panel'), bar = el.querySelector('.menu-bar');
      if (!panel || !w || !h) return;
      const pr = panel.getBoundingClientRect(), top = bar ? bar.getBoundingClientRect().bottom : 0;
      let cx = w / 2, cy = h / 2;
      if (pr.left > w * 0.3) { cx = pr.left / 2; cy = (top + h) / 2 - h * 0.04; } // панель справа
      else { cy = (top + pr.top) / 2; }                                           // панель снизу (портрет)
      try { cam.setViewOffset(w, h, Math.round(w / 2 - cx), Math.round(h / 2 - cy), w, h); } catch (e) { /* ignore */ }
    },
    hide() {
      active = false;
      cancelAnimationFrame(raf);
      raf = 0;
      removeModel();
      const r = rig();
      try {
        if (typeof r.setShowcase === 'function') r.setShowcase(null);
        else if (typeof r.setHangar === 'function') r.setHangar(null);
      } catch (e) { /* ignore */ }
      try { G.camera.clearViewOffset(); G.camera.updateProjectionMatrix(); } catch (e) { /* ignore */ }
    },
  };
}

export function hangarScreen(ctx) {
  const { G } = ctx;
  const showcase = createShowcase(G);
  let el = null, st = null, shown = null;
  const liveries = (id) => { const l = Models.LIVERIES?.[id]; return Array.isArray(l) ? l : []; };
  const currentLivery = (id) => { const l = liveries(id); const saved = G.career.livery(id); return l.find((x) => x.id === saved)?.id || l[0]?.id || null; };

  function show3d() {
    const lv = st.previewLivery || currentLivery(st.planeId);
    const key = `${st.planeId}/${lv}`;
    if (shown === key) return;
    shown = key;
    showcase.show(st.planeId, lv);
  }

  function panelBody(spec) {
    const career = G.career, owned = career.owns(spec.id);
    if (st.tab === 'upgrades') {
      const ups = career.upgrades(spec.id);
      return `${owned ? '' : `<p class="menu-note is-warn">${icon('lock', 16)} Улучшения доступны после покупки самолёта.</p>`}
        ${ups.map((u) => `<div class="menu-up ${u.level >= u.max ? 'is-max' : ''}">
          <div class="menu-up-head"><b>${esc(u.name)}</b>${pips(u.level, u.max)}</div>
          <p class="menu-up-desc">${esc(u.desc)}</p>
          <div class="menu-up-foot"><span class="menu-up-now">${esc(u.now)}</span>
            ${u.cost != null ? `<button type="button" class="menu-btn menu-btn--small ${u.can.ok ? '' : 'is-off'}" data-act="upgrade" data-v="${u.id}" data-sfx="${u.can.ok ? 'ui_buy' : 'ui_error'}"><span>${esc(u.next)}</span><b>${fmtMoney(u.cost)}</b></button>`
    : '<span class="menu-stamp menu-stamp--small">максимум</span>'}</div>
        </div>`).join('')}`;
    }
    if (st.tab === 'livery') {
      const list = liveries(spec.id);
      if (!list.length) return '<p class="menu-note">У этого самолёта одна окраска — заводская.</p>';
      const cur = st.previewLivery || currentLivery(spec.id);
      return `<p class="menu-note">${owned ? 'Окраска бесплатна — выбирайте по настроению.' : 'Можно примерить; сохранится после покупки.'}</p>
        <div class="menu-livery">${list.map((l) => `<button type="button" class="menu-chip ${l.id === cur ? 'is-on' : ''}" data-act="livery" data-v="${esc(l.id)}" data-sfx="ui_tick">${esc(l.name || l.id)}</button>`).join('')}</div>`;
    }
    const mods = career.planeMods(spec.id);
    const d = difficultyOf(spec);
    return `<p class="menu-hangar-desc">${esc(spec.desc)}</p>
      <div class="menu-stats">
        ${statRows(spec, mods).map((r) => `<div class="menu-stat"><span>${r.label}</span>${scale(r.k, r.bonus)}<b>${esc(r.value)}</b></div>`).join('')}
        <div class="menu-stat"><span>Пилотирование</span>${pips(d)}<b>${DIFF_NAMES[d]}</b></div>
      </div>
      <dl class="menu-specs">
        <div><dt>Двигатель</dt><dd>${ENGINE_NAMES[spec.engine] || ''}${spec.engines > 1 ? ` × ${spec.engines}` : ''}</dd></div>
        <div><dt>Масса</dt><dd>${fmtInt(spec.mass)} кг</dd></div>
        <div><dt>Размах</dt><dd>${fmtNum(spec.span, 1)} м</dd></div>
        <div><dt>Длина</dt><dd>${fmtNum(spec.length, 1)} м</dd></div>
        <div><dt>Посадочная</dt><dd>${fmtInt(spec.vStall * 3.6 * 1.25)} км/ч</dd></div>
        <div><dt>Шасси</dt><dd>${spec.amphibian ? 'лодка-амфибия' : spec.retract ? 'убирается' : 'неубирающееся'}</dd></div>
      </dl>`;
  }

  function footer(spec) {
    const career = G.career, p = G.profile;
    if (career.owns(spec.id)) {
      const selected = p.selectedPlane === spec.id;
      return `<div class="menu-hangar-state">${selected ? '<span class="menu-stamp">выбран</span>' : '<span class="menu-note">В ангаре</span>'}</div>
        ${selected ? '<button type="button" class="menu-btn menu-btn--primary" data-act="fly">В полёт</button>'
    : '<button type="button" class="menu-btn menu-btn--primary" data-act="select">Выбрать</button>'}`;
    }
    const price = career.price(spec.id), can = career.canBuy(spec.id);
    let state;
    if (can.ok) state = `<span class="menu-hangar-price">${fmtMoney(price)}</span><span class="menu-note is-ok">${icon('check', 14)} допуск есть</span>`;
    else if (can.lock === 'rank') state = `<span class="menu-hangar-price">${fmtMoney(price)}</span><span class="menu-note is-warn">${icon('lock', 14)} ${esc(can.reason)}</span>`;
    else state = `<span class="menu-hangar-price">${fmtMoney(price)}</span>${scale(p.money / Math.max(1, price))}<span class="menu-note">${esc(can.reason)}</span>`;
    return `<div class="menu-hangar-state">${state}</div>
      <button type="button" class="menu-btn" data-act="trial">Пробный вылет</button>
      <button type="button" class="menu-btn menu-btn--primary ${can.ok ? '' : 'is-off'}" data-act="buy" data-sfx="${can.ok ? 'ui_click' : 'ui_error'}">Купить</button>`;
  }

  function draw() {
    const career = G.career;
    const spec = getSpec(st.planeId);
    const list = planesOf(spec.role);
    const idx = list.findIndex((s) => s.id === spec.id);
    const owned = career.owns(spec.id);
    const keepScroll = el.querySelector('[data-scroll="hangar-body"]')?.scrollTop || 0;
    const sameBody = el.dataset.bodyKey === `${spec.id}/${st.tab}`;
    el.dataset.bodyKey = `${spec.id}/${st.tab}`;
    el.innerHTML = `${ctx.bar('Ангар', { mid: segmented('role', ROLES, spec.role, 'menu-seg--bar') })}
      <div class="menu-hangar">
        <div class="menu-hangar-stage" data-stage>
          <button type="button" class="menu-hangar-arrow is-prev" data-act="prev" data-sfx="ui_tick" aria-label="Предыдущий самолёт">${icon('back', 26)}</button>
          <button type="button" class="menu-hangar-arrow is-next" data-act="next" data-sfx="ui_tick" aria-label="Следующий самолёт">${icon('next', 26)}</button>
          <div class="menu-hangar-id" data-swipe>
            <div class="menu-label">${spec.role === 'military' ? 'Военный' : 'Гражданский'} · ${esc(CLS_NAMES[spec.cls] || '')} · ${spec.year} <span class="menu-hangar-count">${String(idx + 1).padStart(2, '0')}/${String(list.length).padStart(2, '0')}</span></div>
            <h3 class="menu-hangar-name">${esc(spec.name)}</h3>
            <div class="menu-hangar-full">${esc(spec.fullName)}</div>
          </div>
          <div class="menu-hangar-strip menu-scroll-x" data-scroll="hangar-strip">
            ${list.map((s) => `<button type="button" class="menu-hangar-pick ${s.id === spec.id ? 'is-on' : ''} ${career.owns(s.id) ? 'is-owned' : ''}" data-act="pick" data-v="${s.id}" data-sfx="ui_tick">${career.owns(s.id) ? '' : icon('lock', 12)}${esc(s.name)}</button>`).join('')}
          </div>
        </div>
        <aside class="menu-panel menu-hangar-panel">
          ${segmented('tab', TABS, st.tab, 'menu-seg--tabs')}
          <div class="menu-scroll menu-hangar-body" data-scroll="hangar-body">${panelBody(spec)}</div>
          <footer class="menu-hangar-foot ${owned ? 'is-owned' : ''}">${footer(spec)}</footer>
        </aside>
      </div>`;
    if (sameBody) { const b = el.querySelector('[data-scroll="hangar-body"]'); if (b) b.scrollTop = keepScroll; }
    const on = el.querySelector('.menu-hangar-pick.is-on');
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* ignore */ } }
    bindStage();
    show3d();
    showcase.frame(el);
  }

  // вращение пальцем по свободной области; свайп по табличке с именем — листание
  function bindStage() {
    const stage = el.querySelector('[data-stage]');
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, swipe: !!e.target.closest('[data-swipe]') };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (!drag.swipe) showcase.setDragging(true);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.swipe) showcase.rotate(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const up = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0, swipe = drag.swipe;
      drag = null;
      showcase.setDragging(false);
      if (swipe && Math.abs(dx) > 48) step(dx < 0 ? 1 : -1);
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  }

  function step(dir) {
    const list = planesOf(getSpec(st.planeId).role);
    const i = list.findIndex((s) => s.id === st.planeId);
    pick(list[(i + dir + list.length) % list.length].id);
  }
  function pick(id) {
    st.planeId = getSpec(id).id;
    st.previewLivery = null;
    draw();
  }
  const onResize = () => { if (el) showcase.frame(el); };

  return {
    render(root, params) {
      el = root;
      st = (ctx.state.hangar ??= { planeId: null, tab: 'passport', previewLivery: null });
      st.planeId = getSpec(params.planeId || st.planeId || G.profile.selectedPlane).id;
      st.previewLivery = null;
      shown = null;
      draw();
      const off = G.bus.on('resize', onResize);
      addEventListener('resize', onResize);
      return () => { off(); removeEventListener('resize', onResize); showcase.hide(); shown = null; el = null; };
    },
    actions: {
      role: (d) => { const list = planesOf(d.v); const own = list.find((s) => s.id === G.profile.selectedPlane); pick((own || list[0]).id); },
      tab: (d) => { st.tab = d.v; draw(); },
      prev: () => step(-1),
      next: () => step(1),
      pick: (d) => pick(d.v),
      select: () => { G.career.select(st.planeId); ctx.sfx('ui_select'); draw(); },
      fly: () => { (ctx.state.free ??= {}).planeId = st.planeId; ctx.go('free'); },
      livery: (d) => {
        if (G.career.owns(st.planeId)) G.career.setLivery(st.planeId, d.v);
        st.previewLivery = d.v;
        draw();
      },
      upgrade: (d) => {
        const u = G.career.upgrades(st.planeId).find((x) => x.id === d.v);
        if (!u) return;
        if (!u.can.ok) { ctx.toast(u.can.reason, 'warn'); return; }
        if (G.career.buyUpgrade(st.planeId, d.v)) { ctx.toast(`${u.name}: ${u.next}`, 'good'); draw(); }
      },
      trial: () => {
        const lv = st.previewLivery || currentLivery(st.planeId);
        ctx.startFlight({ planeId: st.planeId, airportId: 'yasny', trial: true, ...(lv ? { livery: lv } : {}) });
      },
      buy: () => {
        const id = st.planeId, spec = getSpec(id), can = G.career.canBuy(id);
        if (!can.ok) { ctx.toast(can.reason, 'warn'); return; }
        const price = G.career.price(id);
        ctx.confirm({
          over: 'Покупка самолёта', title: spec.name,
          text: `${spec.fullName}. После покупки на счёте останется ${fmtMoney(G.profile.money - price)}.`,
          html: `<p class="menu-dialog-sum">${fmtMoney(price)}</p>`, ok: 'Купить', cancel: 'Не сейчас',
        }).then((yes) => {
          if (!yes || !el) return;
          if (G.career.buy(id)) {
            if (st.previewLivery) G.career.setLivery(id, st.previewLivery);
            ctx.sfx('ui_buy');
            ctx.toast(`${spec.name} — теперь в вашем ангаре`, 'good');
            draw();
          }
        });
      },
    },
  };
}
