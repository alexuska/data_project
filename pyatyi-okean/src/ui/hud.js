// HUD: приборы полёта, цель задания, радио, сообщения, предупреждения, маркеры, помощь на посадке, оценка посадки.
// Контракт — в ARCHITECTURE.md: show(), hide(), setObjective(), setMarkers(), toast(), radio(), setAction(), update(dtReal).
// Сверх контракта: setPhotoMode(bool) / событие 'input:photo' (переключить) → событие 'photo:changed' {on};
// showLandingCard(data); событие 'landing:rated' {score, title, vs, across, zone, onRunway}; hud.map (полная карта).
import { clamp, wrapPi, DEG } from '../core/util.js';
import { uiScale } from './touch.js';
import { createGauges, readTokens } from './hud-gauges.js';
import { createRadar } from './hud-radar.js';
import { createMarkers } from './hud-markers.js';
import { createMap } from './map.js';

const WARN = ['', 'ЗЕМЛЯ! ТЯНИ ВВЕРХ', 'СВАЛИВАНИЕ', 'ШАССИ!', 'ПРЕВЫШЕНИЕ СКОРОСТИ', 'МАЛО ТОПЛИВА', 'САМОЛЁТ ПОВРЕЖДЁН'];
const ILS_HINT = ['на глиссаде', 'ниже глиссады — выше!', 'выше глиссады — снижайся', 'мала скорость — добавь тягу', 'велика скорость — убери тягу', 'левее оси — доверни вправо', 'правее оси — доверни влево', 'выравнивай и сажай'];

export function createHud(G) {
  const K = readTokens();
  const root = document.createElement('div');
  root.className = 'hud';
  root.hidden = true;
  root.innerHTML = `
    <div class="hud-markers"></div>
    <div class="hud-colli" hidden><div class="hud-colli-clip"><div class="hud-colli-ladder"></div></div><div class="hud-colli-cross"></div></div>
    <div class="hud-top">
      <canvas class="hud-hdg"></canvas>
      <div class="hud-obj" hidden><b></b><span></span></div>
      <div class="hud-radio" hidden><b></b><span></span></div>
    </div>
    <div class="hud-corner"><canvas class="hud-radar"></canvas><div class="hud-ts" hidden></div></div>
    <div class="hud-warn" hidden></div>
    <div class="hud-toasts"></div>
    <div class="hud-land" hidden><div class="hud-land-t"></div><div class="hud-land-rows"></div></div>
    <div class="hud-dash">
      <div class="hud-ils" hidden></div>
      <div class="hud-strip">
        <span class="hud-s hud-s-gear">ШАССИ</span><span class="hud-s hud-s-flaps">ЗАКР 0</span><span class="hud-s hud-s-brk">ТОРМОЗ</span>
        <span class="hud-s-gap"></span>
        <span class="hud-s hud-s-hp" hidden></span><span class="hud-s hud-s-thr">ТЯГА 0%</span><span class="hud-s hud-s-g">G 1.0</span><span class="hud-s hud-s-fuel">ТОПЛ</span>
      </div>
      <canvas class="hud-dash-c"></canvas>
    </div>`;
  G.ui.appendChild(root);
  // кнопка выхода из фоторежима живёт отдельно — HUD в это время скрыт
  const photoRoot = document.createElement('div');
  photoRoot.className = 'hud-photo';
  photoRoot.hidden = true;
  photoRoot.innerHTML = '<button type="button" class="hud-photo-exit">Готово</button><div class="hud-photo-tip">Фоторежим · ведите пальцем, щипок — приближение</div>';
  G.ui.appendChild(photoRoot);

  const $ = (s) => root.querySelector(s);
  const el = {
    obj: $('.hud-obj'), objN: $('.hud-obj b'), objT: $('.hud-obj span'),
    radio: $('.hud-radio'), radioFrom: $('.hud-radio b'), radioText: $('.hud-radio span'),
    warn: $('.hud-warn'), toasts: $('.hud-toasts'), ts: $('.hud-ts'),
    land: $('.hud-land'), landT: $('.hud-land-t'), landRows: $('.hud-land-rows'),
    ils: $('.hud-ils'), sGear: $('.hud-s-gear'), sFlaps: $('.hud-s-flaps'), sBrk: $('.hud-s-brk'),
    sHp: $('.hud-s-hp'), sThr: $('.hud-s-thr'), sG: $('.hud-s-g'), sFuel: $('.hud-s-fuel'),
  };
  const gauges = createGauges(G, $('.hud-dash-c'), $('.hud-hdg'));
  const radar = createRadar(G, $('.hud-radar'), K);
  const markers = createMarkers(G, $('.hud-markers'), $('.hud-colli'));
  const map = createMap(G);

  let shown = false, needResize = true, S = 1, photoOwn = false;
  let objText = null, objCount = '';
  const toasts = [];
  const radioQ = [];
  let radioT = 0, landT = 0, slowAcc = 1, stripAcc = 1, warnCode = 0, aptBearing = NaN, aptAcc = 9;
  let airSince = 0, lastCardT = -1e9;
  const last = { gear: -1, flaps: -1, brk: -1, hp: -1, thr: -1, g: -99, fuel: -1, ts: -1, ils: -1, ilsKey: -1 };

  // помощь на посадке
  const ils = { active: false, loc: 0, gs: 0, vApp: 0, onPath: false, rw: null, ap: null, hdg: 0, tx: 0, tz: 0, elev: 0, dist: 0, len: 0, hint: 0 };
  // автоматические маркеры (торец полосы, противники)
  const auto = [];
  for (let i = 0; i < 10; i++) auto.push({ x: 0, y: 0, z: 0, label: '', kind: 'airport', radius: 0 });
  let nAuto = 0;
  const rwLabels = {};

  function resize() {
    needResize = false;
    const w = G.canvas.clientWidth || innerWidth, h = G.canvas.clientHeight || innerHeight;
    S = uiScale(w, h);
    root.style.setProperty('--hs', S.toFixed(3));
    photoRoot.style.setProperty('--hs', S.toFixed(3));
    root.classList.toggle('hud-lefty', !!G.profile.settings.leftHanded);
    gauges.resize(S);
    radar.resize(S);
    markers.resize(w, h, S, h > w);
  }

  // ---------- выбор полосы и отклонения ----------
  function pickRunway(ac) {
    const aps = G.world.airports || [];
    let best = null, bestScore = 1e9, bestEnd = 0, bestAp = null;
    for (let i = 0; i < aps.length; i++) {
      const a = aps[i];
      if (!a.runways || Math.abs(a.x - ac.pos.x) > 11000 || Math.abs(a.z - ac.pos.z) > 11000) continue;
      for (let j = 0; j < a.runways.length; j++) {
        const rw = a.runways[j];
        for (let end = 0; end < 2; end++) {
          const h = rw.heading + end * Math.PI, dx = Math.sin(h), dz = -Math.cos(h);
          const px = ac.pos.x - (rw.cx - dx * rw.length / 2), pz = ac.pos.z - (rw.cz - dz * rw.length / 2);
          const s = px * dx + pz * dz, e = px * -dz + pz * dx;
          if (s > rw.length * 0.6) continue;
          const dd = Math.hypot(s, e);
          if (dd > 8000) continue;
          const hdgErr = Math.abs(wrapPi(ac.heading - h));
          const off = Math.abs(Math.atan2(e, Math.max(-s, 60)));
          if (hdgErr > 1.75 || off > 1.2) continue;
          const score = hdgErr + off * 1.5 + dd / 20000 - (rw === ils.rw && Math.abs(wrapPi(h - ils.hdg)) < 0.1 ? 0.35 : 0);
          if (score < bestScore) { bestScore = score; best = rw; bestEnd = end; bestAp = a; }
        }
      }
    }
    const fixed = !ac.spec.retract;
    const want = !!best && !ac.onGround && ac.alive && ac.agl < 1500 && ac.gearPos > 0.5 && (!fixed || ac.flaps > 0 || ac.agl < 350);
    if (!want) { ils.active = false; ils.rw = null; return; }
    const h = best.heading + bestEnd * Math.PI;
    ils.active = true; ils.rw = best; ils.ap = bestAp; ils.hdg = h; ils.len = best.length;
    ils.tx = best.cx - Math.sin(h) * best.length / 2; ils.tz = best.cz + Math.cos(h) * best.length / 2;
    ils.elev = bestAp.elevation || 0;
    ils.vApp = ac.spec.vApproach || ac.spec.vStall * 1.3;
  }
  function updateIls(ac) {
    if (!ils.active) return;
    const dx = Math.sin(ils.hdg), dz = -Math.cos(ils.hdg);
    const px = ac.pos.x - ils.tx, pz = ac.pos.z - ils.tz;
    const s = px * dx + pz * dz, e = px * -dz + pz * dx;
    const aimIn = Math.min(300, ils.len * 0.18);
    const dAim = Math.max(aimIn - s, 1);
    ils.dist = Math.max(0, -s);
    ils.loc = clamp(-Math.atan2(e, dAim + ils.len * 0.5) / (3.5 * DEG), -1, 1);
    const hgt = ac.alt - ac.spec.gearHeight - ils.elev;
    ils.gs = s > aimIn - 40 ? 0 : clamp((3 * DEG - Math.atan2(hgt, dAim)) / (1.4 * DEG), -1, 1);
    ils.onPath = Math.abs(ils.loc) < 0.25 && Math.abs(ils.gs) < 0.3;
    const kmhErr = ac.ias / ils.vApp;
    ils.hint = hgt < 12 && s > -250 ? 7 : ils.gs > 0.55 ? 1 : ils.gs < -0.55 ? 2 : kmhErr < 0.9 ? 3 : kmhErr > 1.3 ? 4 : ils.loc > 0.5 ? 5 : ils.loc < -0.5 ? 6 : 0;
  }

  // ---------- предупреждения ----------
  function computeWarn(ac) {
    if (!ac.alive) return 0;
    if (ac.onGround) return ac.hp < 35 ? 6 : 0;
    const sp = ac.spec;
    const landing = ac.gearPos > 0.5 && ac.vs > -7 && (ils.active || ac.agl < 60);
    if (!landing && ac.agl > 4) {
      if (ac.vs < -6 && ac.agl / -ac.vs < 4.5) return 1;
      if (!ils.active && ac.ias > sp.vStall) {
        const tx = ac.pos.x + ac.vel.x * 5, tz = ac.pos.z + ac.vel.z * 5;
        if (ac.pos.y + ac.vel.y * 5 < Math.max(0, G.world.heightAt(tx, tz)) + 12) return 1;
      }
    }
    const vsNow = sp.vStall / Math.sqrt(1 + 0.5 * (ac.flapsPos || 0));
    if (ac.stalled || (typeof ac.stallWarn === 'number' ? ac.stallWarn > 0.75 : ac.agl > 3 && ac.ias < vsNow * 1.07)) return 2;
    if (sp.retract && ac.gearPos < 0.5 && !ac.gearDown && ac.agl < 160 && ac.vs < 0.5 && ac.ias < sp.vStall * 1.9 && ac.throttle < 0.8) return 3;
    if (typeof ac.overspeed === 'number' ? ac.overspeed > 0.45 : ac.ias > sp.vMax * 0.985) return 4;
    if (ac.fuelMax > 0 && ac.fuel / ac.fuelMax < 0.1) return 5;
    if (ac.hp < 35) return 6;
    return 0;
  }

  // ---------- строка состояния ----------
  function updateStrip(ac) {
    const g = !ac.spec.retract ? 3 : ac.gearPos > 0.98 ? 2 : ac.gearPos < 0.02 ? 0 : 1;
    if (g !== last.gear) { last.gear = g; el.sGear.className = 'hud-s hud-s-gear' + (g >= 2 ? ' is-ok' : g === 1 ? ' is-move' : ''); }
    const f = !ac.spec.flaps ? -1 : Math.round(ac.flaps * 2);
    if (f !== last.flaps) { last.flaps = f; el.sFlaps.textContent = f < 0 ? 'ЗАКР —' : 'ЗАКР ' + f; el.sFlaps.className = 'hud-s hud-s-flaps' + (f > 0 ? ' is-on' : ''); }
    const b = ac.onGround ? (ac.controls.brake > 0.5 ? 1 : 0) : ac.airbrake > 0.3 ? 2 : 0;
    if (b !== last.brk) { last.brk = b; el.sBrk.textContent = b === 2 ? 'ЩИТКИ' : 'ТОРМОЗ'; el.sBrk.className = 'hud-s hud-s-brk' + (b ? ' is-on' : ''); }
    const thr = Math.round(ac.throttle * 100);
    if (thr !== last.thr) { last.thr = thr; el.sThr.textContent = 'ТЯГА ' + thr + '%'; }
    const gg = Math.round(clamp(ac.g, -9, 15) * 10);
    if (gg !== last.g) { last.g = gg; el.sG.textContent = 'G ' + (gg / 10).toFixed(1); el.sG.classList.toggle('is-warn', gg > ac.spec.maxG * 8.5 || gg < -15); }
    const pct = ac.fuelMax > 0 ? Math.round((ac.fuel / ac.fuelMax) * 100) : 0;
    const rate = (ac.spec.burn || 0) * (0.15 + 0.85 * ac.throttle);
    const min = rate > 0 ? Math.min(999, Math.round(ac.fuel / rate / 60)) : 999;
    const fk = pct * 1000 + min;
    if (fk !== last.fuel) {
      last.fuel = fk;
      el.sFuel.textContent = 'ТОПЛ ' + pct + '% ' + (min >= 100 ? Math.floor(min / 60) + ' ч' : min + ' мин');
      el.sFuel.classList.toggle('is-warn', pct < 10);
    }
    const hp = Math.round(ac.hp);
    if (hp !== last.hp) {
      last.hp = hp;
      if (el.sHp.hidden !== (hp >= 100)) el.sHp.hidden = hp >= 100;
      el.sHp.textContent = 'ПЛАНЕР ' + hp + '%';
      el.sHp.classList.toggle('is-warn', hp < 40);
    }
    const ts = G.time.scale;
    if (ts !== last.ts) { last.ts = ts; el.ts.hidden = ts <= 1; el.ts.textContent = 'ВРЕМЯ ×' + ts; }
  }

  // ---------- оценка посадки ----------
  function rateLanding(e) {
    const ac = e.ac, vs = Math.abs(e.vs || 0);
    const vsScore = vs < 1.2 ? 100 : vs < 2 ? 86 : vs < 3.2 ? 66 : vs < 4.5 ? 42 : 15;
    const vsWord = vs < 1.2 ? 'мягко' : vs < 2 ? 'хорошо' : vs < 3.2 ? 'ощутимо' : vs < 4.5 ? 'жёстко' : 'очень жёстко';
    const rows = [['Верт. скорость', `−${vs.toFixed(1)} м/с`, vsWord, vsScore >= 66 ? 'good' : vsScore >= 42 ? 'warn' : 'bad']];
    const rw = e.runway;
    let score = vsScore, title, zone = null;
    if (rw && typeof e.across === 'number') {
      const ratio = Math.abs(e.across) / (rw.width / 2);
      const axScore = ratio < 0.25 ? 100 : ratio < 0.5 ? 82 : ratio < 0.85 ? 56 : 30;
      rows.push(['От оси полосы', `${Math.abs(e.across).toFixed(0)} м`, ratio < 0.25 ? 'по центру' : ratio < 0.5 ? 'близко' : ratio < 0.85 ? 'в стороне' : 'у кромки', axScore >= 82 ? 'good' : axScore >= 56 ? 'warn' : 'bad']);
      const dir = ac.vel.x * Math.sin(rw.heading) - ac.vel.z * Math.cos(rw.heading) >= 0 ? 1 : -1;
      const s = rw.length / 2 + (e.along || 0) * dir, fr = s / rw.length;
      const znScore = fr < 0.04 ? 70 : fr <= 0.34 ? 100 : fr < 0.5 ? 62 : 26;
      zone = fr < 0.04 ? 'у самого торца' : fr <= 0.34 ? 'в зоне' : fr < 0.5 ? 'перелёт' : 'большой перелёт';
      rows.push(['Касание от торца', `${Math.max(0, s).toFixed(0)} м`, zone, znScore >= 100 ? 'good' : znScore >= 62 ? 'warn' : 'bad']);
      score = Math.round(vsScore * 0.5 + axScore * 0.25 + znScore * 0.25);
      title = score >= 88 ? 'Три-хо-хо! Отличная посадка' : score >= 72 ? 'Хорошая посадка' : score >= 52 ? 'Посадка зачтена' : vs >= 4.5 ? 'Жёсткая посадка' : 'Грубая посадка';
    } else if (e.surface === 'water') {
      title = vs < 2.5 ? 'Мягкое приводнение' : 'Жёсткое приводнение';
    } else {
      score = Math.round(vsScore * 0.6);
      title = 'Посадка вне полосы';
    }
    const data = { title, score, rows, vs, across: e.across ?? null, zone, onRunway: !!rw, kind: score >= 72 ? 'good' : score >= 52 ? 'warn' : 'bad' };
    hud.showLandingCard(data);
    G.bus.emit('landing:rated', data);
  }

  const hud = {
    root, map,
    markers: [],
    photoMode: false,
    show() { shown = true; needResize = true; },
    hide() { shown = false; root.hidden = true; markers.hideAll(); },
    setObjective(text) {
      const t = text || null;
      if (t === objText) return;
      objText = t;
      el.obj.hidden = !t;
      if (t) {
        el.objT.textContent = t;
        el.objN.textContent = objCount;
        el.objN.hidden = !objCount;
        el.obj.classList.remove('is-new');
        void el.obj.offsetWidth;
        el.obj.classList.add('is-new');
      }
    },
    setMarkers(list) { hud.markers = list || []; },
    setAction(a) { if (G.input && G.input.setAction) G.input.setAction(a); },
    toast(text, kind = 'info') {
      if (!text) return;
      if (toasts.length && toasts[toasts.length - 1].text === text) { toasts[toasts.length - 1].t = 3.5; return; }
      const node = document.createElement('div');
      node.className = 'hud-toast hud-toast-' + (kind === 'good' || kind === 'warn' || kind === 'bad' ? kind : 'info');
      node.textContent = text;
      el.toasts.appendChild(node);
      toasts.push({ node, text, t: 3.5 });
      while (toasts.length > 3) toasts.shift().node.remove();
    },
    radio(from, text) {
      if (!text) return;
      if (radioQ.length > 6) radioQ.shift();
      radioQ.push({ from: from || 'Радио', text });
    },
    // data: { title, rows: [[подпись, значение, слово, 'good'|'warn'|'bad']], kind }
    showLandingCard(data) {
      el.landT.textContent = data.title;
      el.land.className = 'hud-land hud-land-' + (data.kind || 'good');
      el.landRows.innerHTML = (data.rows || []).map((r) => `<div class="hud-land-row is-${r[3] || 'good'}"><span>${r[0]}</span><b>${r[1]}</b><i>${r[2] || ''}</i></div>`).join('');
      el.land.hidden = false;
      landT = 6.5;
    },
    // фоторежим: HUD и управление скрыты, камера — свободный облёт. Кнопку выхода рисует вызывающий (меню паузы);
    // ownExit = true (событие 'input:photo') — HUD сам прячет меню и показывает свою кнопку «Готово».
    setPhotoMode(on, ownExit) {
      on = !!on && G.mode === 'flight' && !!G.player;
      if (on === hud.photoMode) return;
      hud.photoMode = on;
      if (G.cameraRig && G.cameraRig.setPhoto) G.cameraRig.setPhoto(on);
      if (on) { root.hidden = true; markers.hideAll(); map.close(); }
      if (on && ownExit) { photoOwn = true; photoRoot.hidden = false; if (G.menu && G.menu.hide) G.menu.hide(); }
      G.bus.emit('photo:changed', { on });
      if (!on) {
        photoRoot.hidden = true;
        // вернуть экран паузы: меню показывает его по событию 'pause'
        if (photoOwn && G.mode === 'flight' && G.paused) { G.setPaused(false); G.setPaused(true); }
        photoOwn = false;
      }
    },
    update(dt) {
      if (G.input && G.input.uiUpdate) G.input.uiUpdate(dt);
      map.update(dt);
      const ac = G.player;
      const vis = shown && G.mode === 'flight' && !!ac && !hud.photoMode;
      if (root.hidden === vis) { root.hidden = !vis; if (!vis) markers.hideAll(); else needResize = true; }
      if (!vis) return;
      if (needResize) resize();
      const dtc = Math.min(dt, 0.25);

      // медленные вычисления: выбор полосы, предупреждения, ближайший аэродром
      slowAcc += dt;
      if (slowAcc >= 0.2) {
        slowAcc = 0;
        pickRunway(ac);
        const wc = computeWarn(ac);
        if (wc !== warnCode) {
          warnCode = wc;
          el.warn.hidden = !wc;
          if (wc) { el.warn.textContent = WARN[wc]; el.warn.className = 'hud-warn' + (wc <= 3 ? ' is-crit' : ''); if (G.input && G.input.haptic) G.input.haptic(wc <= 3 ? 60 : 25); }
        }
      }
      aptAcc += dt;
      if (aptAcc > 1) {
        aptAcc = 0;
        const na = G.world.nearestAirport ? G.world.nearestAirport(ac.pos.x, ac.pos.z) : null;
        aptBearing = na && na.airport ? Math.atan2(na.airport.x - ac.pos.x, -(na.airport.z - ac.pos.z)) : NaN;
      }
      updateIls(ac);

      // помощь на посадке: строка и маркер торца
      nAuto = 0;
      const ia = ils.active ? 1 : 0;
      if (ia !== last.ils) { last.ils = ia; el.ils.hidden = !ia; last.ilsKey = -1; }
      let bugApt = aptBearing;
      if (ia) {
        const num = Math.round((((ils.hdg / DEG) % 360) + 360) % 360 / 10) || 36;
        const key = num * 100000 + Math.round(ils.dist / 100) * 10 + ils.hint;
        if (key !== last.ilsKey) {
          last.ilsKey = key;
          el.ils.textContent = `ПОЛОСА ${String(num).padStart(2, '0')} · ${(ils.dist / 1000).toFixed(1)} км · ${ILS_HINT[ils.hint]}`;
          el.ils.classList.toggle('is-ok', ils.hint === 0 || ils.hint === 7);
        }
        const m = auto[nAuto++];
        m.x = ils.tx; m.z = ils.tz; m.y = ils.elev + 3; m.kind = 'airport';
        m.label = rwLabels[num] || (rwLabels[num] = 'Полоса ' + String(num).padStart(2, '0'));
        bugApt = Math.atan2(ils.tx - ac.pos.x, -(ils.tz - ac.pos.z));
      }
      // противники в воздухе — рамки (если задание само не поставило маркер)
      const list = G.aircraft, mk = hud.markers;
      for (let i = 0; i < list.length && nAuto < auto.length; i++) {
        const a = list[i];
        if (a === ac || a.team !== 'enemy' || !a.alive) continue;
        const dx = a.pos.x - ac.pos.x, dz = a.pos.z - ac.pos.z;
        if (dx * dx + dz * dz > 9000 * 9000) continue;
        let dup = false;
        for (let j = 0; j < mk.length; j++) if (mk[j] && Math.abs(mk[j].x - a.pos.x) < 40 && Math.abs(mk[j].z - a.pos.z) < 40) { dup = true; break; }
        if (dup) continue;
        const m = auto[nAuto++];
        m.x = a.pos.x; m.y = a.pos.y; m.z = a.pos.z; m.kind = 'bandit'; m.label = '';
      }
      let bugObj = NaN;
      for (let j = 0; j < mk.length; j++) {
        const m = mk[j];
        if (m && m.kind !== 'friend') { bugObj = Math.atan2(m.x - ac.pos.x, -(m.z - ac.pos.z)); break; }
      }

      gauges.update(ac, ils, bugObj, bugApt);
      radar.update(dt, ac, mk, nAuto, auto);
      const view = G.cameraRig ? G.cameraRig.view : 'chase';
      const flying = view === 'chase' || view === 'cockpit' || view === 'flyby';
      if (flying) markers.update(ac, mk, auto, nAuto); else markers.update(ac, null, auto, 0);
      markers.aim(ac, view);
      markers.collimator(ac, view === 'cockpit' && !(G.cameraRig && G.cameraRig.lookActive));

      stripAcc += dt;
      if (stripAcc > 0.1) { stripAcc = 0; updateStrip(ac); }

      // сообщения
      for (let i = toasts.length - 1; i >= 0; i--) {
        const t = toasts[i];
        t.t -= dtc;
        if (t.t <= 0) { t.node.remove(); toasts.splice(i, 1); }
        else if (t.t < 0.4 && !t.out) { t.out = true; t.node.classList.add('is-out'); }
      }
      if (radioT > 0) { radioT -= dtc; if (radioT <= 0) el.radio.hidden = true; }
      if (radioT <= 0 && radioQ.length) {
        const r = radioQ.shift();
        el.radioFrom.textContent = r.from;
        el.radioText.textContent = r.text;
        el.radio.hidden = false;
        el.radio.classList.remove('is-new'); void el.radio.offsetWidth; el.radio.classList.add('is-new');
        radioT = clamp(1.8 + r.text.length * 0.055, 2.6, 7) + (radioQ.length ? 0 : 0.8);
      }
      if (landT > 0) { landT -= dtc; if (landT <= 0) el.land.hidden = true; }
    },
  };

  photoRoot.querySelector('button').addEventListener('click', () => hud.setPhotoMode(false));
  G.bus.on('input:photo', () => hud.setPhotoMode(!hud.photoMode, true));
  G.bus.on('ui:toast', (p) => { if (p) hud.toast(p.text, p.kind); });
  G.bus.on('radio', (p) => { if (p) hud.radio(p.from, p.text); });
  G.bus.on('mission:objective', (p) => {
    if (!p) return;
    objCount = p.total > 1 ? `${(p.index || 0) + 1}/${p.total}` : '';
    if (p.text === objText) { el.objN.textContent = objCount; el.objN.hidden = !objCount; } else hud.setObjective(p.text);
  });
  G.bus.on('ac:takeoff', (e) => { if (e && e.ac === G.player) airSince = G.time.sim; });
  G.bus.on('ac:touchdown', (e) => {
    if (!e || e.ac !== G.player) return;
    const t = G.time.sim;
    if (e.bounce > 0 || e.crash || t - airSince < 6 || t - lastCardT < 5) return; // подскок («козёл») — не новая посадка
    lastCardT = t;
    rateLanding(e);
  });
  G.bus.on('flight:start', () => {
    objCount = ''; hud.setObjective(null); hud.setMarkers([]);
    hud.photoMode = false; photoRoot.hidden = true;
    for (const t of toasts) t.node.remove();
    toasts.length = 0; radioQ.length = 0; radioT = 0; landT = 0;
    el.radio.hidden = true; el.land.hidden = true; el.warn.hidden = true; warnCode = 0;
    ils.active = false; ils.rw = null; slowAcc = 1; aptAcc = 9;
    airSince = G.player && !G.player.onGround ? G.time.sim - 10 : G.time.sim;
    lastCardT = -1e9;
    hud.show();
  });
  G.bus.on('flight:end', () => { if (hud.photoMode) { hud.photoMode = false; photoRoot.hidden = true; } hud.hide(); });
  G.bus.on('menu:show', () => { hud.photoMode = false; photoRoot.hidden = true; hud.hide(); });
  G.bus.on('resize', () => { needResize = true; });
  G.bus.on('settings:changed', () => { needResize = true; });
  return hud;
}
