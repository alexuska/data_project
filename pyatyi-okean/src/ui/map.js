// КАРТА АРХИПЕЛАГА. Подложка рисуется один раз по world.heightAt (понемногу, чтобы не было рывка) и кэшируется;
// ею же пользуется мини-карта HUD. Полная карта открывается по 'input:map', закрывается тапом.
import { clamp, DEG, TAU } from '../core/util.js';
import { readTokens } from './hud-gauges.js';
import * as NV from '../systems/autoflight-nav.js';

const KIND = { intl: 'Международный аэропорт', military: 'Военная авиабаза', regional: 'Региональный аэропорт', strip: 'Посадочная площадка', carrier: 'Авианосец' };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const N = 384;
let tex = null;

function mix(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
}
// палитра подложки (это «рисунок карты», не элементы интерфейса)
const C_DEEP = [20, 42, 70], C_SHOAL = [44, 92, 126], C_SAND = [214, 198, 148], C_LOW = [116, 152, 92], C_HILL = [84, 122, 78],
  C_ROCK = [136, 124, 104], C_SNOW = [236, 238, 240], C_COAST = [16, 28, 44];
const _c = [0, 0, 0];
function colorAt(h) {
  if (h <= 0) mix(_c, C_SHOAL, C_DEEP, clamp(-h / 90, 0, 1));
  else if (h < 6) mix(_c, C_SAND, C_LOW, h / 6);
  else if (h < 260) mix(_c, C_LOW, C_HILL, (h - 6) / 254);
  else if (h < 620) mix(_c, C_HILL, C_ROCK, (h - 260) / 360);
  else mix(_c, C_ROCK, C_SNOW, clamp((h - 620) / 260, 0, 1));
  return _c;
}

// подложка карты: { canvas, ready, progress, step(мс), finish() }
export function mapTexture(G) {
  const world = G.world;
  if (tex && tex.world === world) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  const rowImg = ctx.createImageData(N, 1);
  let cur = new Float32Array(N), prev = new Float32Array(N);
  const size = world.size || 64000, cell = size / N;
  const t = {
    world, canvas, size, row: 0, ready: false,
    get progress() { return t.row / N; },
    step(budgetMs) {
      if (t.ready) return;
      const t0 = performance.now();
      const d = rowImg.data;
      while (t.row < N) {
        const z = -size / 2 + (t.row + 0.5) * cell;
        for (let i = 0; i < N; i++) cur[i] = world.heightAt(-size / 2 + (i + 0.5) * cell, z);
        for (let i = 0; i < N; i++) {
          const h = cur[i], hw = i ? cur[i - 1] : h, hn = t.row ? prev[i] : h;
          const c = colorAt(h);
          let sh = 1;
          if (h > 0) sh = clamp(1 + ((h - hw) + (h - hn)) / cell * 1.5, 0.62, 1.32);
          const coast = (h > 0) !== (hw > 0) || (h > 0) !== (hn > 0);
          const o = i * 4;
          if (coast) { d[o] = (c[0] + C_COAST[0]) / 2; d[o + 1] = (c[1] + C_COAST[1]) / 2; d[o + 2] = (c[2] + C_COAST[2]) / 2; }
          else { d[o] = c[0] * sh; d[o + 1] = c[1] * sh; d[o + 2] = c[2] * sh; }
          d[o + 3] = 255;
        }
        ctx.putImageData(rowImg, 0, t.row);
        const sw = prev; prev = cur; cur = sw;
        t.row++;
        if (budgetMs > 0 && (t.row & 3) === 0 && performance.now() - t0 > budgetMs) return;
      }
      t.ready = true;
    },
    finish() { t.step(0); },
  };
  tex = t;
  return t;
}

const TRAIL_N = 720;

export function createMap(G) {
  const K = readTokens();
  const root = document.createElement('div');
  root.className = 'map';
  root.hidden = true;
  root.innerHTML = `<div class="map-frame">
      <div class="map-chart"><canvas class="map-canvas"></canvas></div>
      <div class="map-side">
        <div class="map-title">Архипелаг Семи Ветров</div>
        <div class="map-sub">Сетка 10 км · коснись аэродрома — карточка и автопилот</div>
        <div class="map-list"></div>
        <div class="map-legend">
          <span><i class="map-lg map-lg-me"></i>Вы</span><span><i class="map-lg map-lg-obj"></i>Задание</span>
          <span><i class="map-lg map-lg-apt"></i>Аэродром</span><span><i class="map-lg map-lg-poi"></i>Ориентир</span>
          <span><i class="map-lg map-lg-dest"></i>Цель</span>
        </div>
        <div class="map-card" hidden></div>
        <button type="button" class="map-close">Закрыть карту</button>
      </div>
    </div>`;
  G.ui.appendChild(root);
  const canvas = root.querySelector('.map-canvas'), ctx = canvas.getContext('2d');
  const listEl = root.querySelector('.map-list');
  const cardEl = root.querySelector('.map-card');
  let side = 0, k = 1, acc = 0, listAcc = 9, cardId = null;
  const placed = []; // прямоугольники подписей текущей отрисовки — чтобы не наезжали друг на друга
  const trail = new Float32Array(TRAIL_N * 2);
  let trailN = 0, trailHead = 0, lastX = 1e9, lastZ = 1e9;

  // касание аэродрома — карточка; мимо — закрыть карточку, вне карты — закрыть карту
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.map-card, .map-close')) return;
    e.preventDefault();
    const row = e.target.closest('.map-row');
    if (row) { openCard(row.dataset.apt); return; }
    if (e.target === canvas) {
      const a = hitAirport(e.clientX, e.clientY);
      if (a) { openCard(a.id); return; }
      if (cardId) { closeCard(); return; }
    }
    map.close();
  });
  root.querySelector('.map-close').addEventListener('click', () => map.close());
  cardEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || !cardId) return;
    const af = G.autoflight, a = b.dataset.a;
    if (a === 'back') { closeCard(); return; }
    if (!af) return;
    if (a === 'dest') { af.setDestination(cardId); map.close(); }
    else if (a === 'clear') { af.setDestination(null); fillCard(); draw(); }
    else if (a === 'ap') { af.setDestination(cardId); af.engage('nav'); map.close(); }
    else if (a === 'land') { af.setDestination(cardId); af.engage('approach', { airportId: cardId }); map.close(); }
  });
  function hitAirport(cx, cy) {
    const r = canvas.getBoundingClientRect(), size = G.world.size || 64000, s = side / size;
    let best = null, bd = 26;
    for (const a of G.world.airports || []) {
      const d = Math.hypot(r.left + (a.x + size / 2) * s - cx, r.top + (a.z + size / 2) * s - cy);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function openCard(id) { cardId = id; root.classList.add('map-has-card'); fillCard(); draw(); }
  function closeCard() { cardId = null; root.classList.remove('map-has-card'); cardEl.hidden = true; draw(); }
  function fillCard() {
    const a = G.world.airportById[cardId], p = G.player, af = G.autoflight;
    if (!a) { closeCard(); return; }
    const wi = NV.windInfo(G.world), wx = NV.weatherInfo(G.world), sel = NV.bestRunway(a, G.world, p && p.spec);
    const rws = (a.runways || []).map((r) => `<b>${esc(r.name)}</b> · ${NV.fmtHdg(r.heading)}/${NV.fmtHdg(r.heading + Math.PI)} · ${Math.round(r.length)} м`).join('<br>');
    let route = '';
    if (p) {
      const d = Math.hypot(a.x - p.pos.x, a.z - p.pos.z), v = p.gs > 20 ? p.gs : p.spec.vCruise;
      route = d < 1500 ? 'вы здесь' : `${NV.fmtKm(d)} · курс ${NV.fmtHdg(NV.bearing(p.pos.x, p.pos.z, a.x, a.z))} · ${p.gs > 20 ? '' : '≈'}${NV.fmtMin(d / v)}`;
    }
    const isDest = af && af.destination && af.destination.airportId === a.id;
    const air = p && p.alive && !p.onGround;
    const canLand = air && a.kind !== 'carrier' && p && Math.hypot(a.x - p.pos.x, a.z - p.pos.z) < 30000;
    cardEl.innerHTML = `
      <div class="map-card-k">${esc(KIND[a.kind] || '')} · ${esc(a.code || '')}</div>
      <div class="map-card-n">${esc(a.kind === 'carrier' ? 'Авианосец «Буревестник»' : a.name)}</div>
      <div class="map-card-rows">
        <div><span>Полосы</span><i>${rws}</i></div>
        <div><span>Высота</span><i>${Math.round(a.elevation || 0)} м над морем</i></div>
        <div><span>Погода</span><i>${esc(wx.sky)}, ${esc(wi.text)}, ${esc(wx.visText)}</i></div>
        ${sel && a.kind !== 'carrier' ? `<div><span>Посадка</span><i>по ветру — полоса <b>${sel.name}</b></i></div>` : ''}
        ${route ? `<div><span>Путь</span><i>${route}</i></div>` : ''}
      </div>
      <div class="map-card-btns">
        ${isDest ? '<button type="button" data-a="clear">Сбросить цель</button>' : '<button type="button" data-a="dest">Лететь сюда</button>'}
        ${canLand ? '<button type="button" class="is-main" data-a="land">Автопосадка</button>' : '<button type="button" class="is-main" data-a="ap">Автопилот туда</button>'}
      </div>
      <button type="button" class="map-card-back" data-a="back">← Ко всем аэродромам</button>`;
    cardEl.hidden = false;
  }
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  function fit() {
    const chart = canvas.parentElement.getBoundingClientRect();
    side = Math.max(120, Math.floor(Math.min(chart.width, chart.height)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    k = dpr;
    canvas.width = canvas.height = Math.round(side * dpr);
    canvas.style.width = canvas.style.height = side + 'px';
  }
  const hdgName = (h) => String(Math.round(((h / DEG) % 360 + 360) % 360 / 10) || 36).padStart(2, '0');

  function label(c, text, x, y, font, color, align) {
    c.font = font; c.textAlign = align || 'left'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = K.night; c.lineJoin = 'round';
    c.strokeText(text, x, y);
    c.fillStyle = color; c.fillText(text, x, y);
  }
  // подпись без наложений: пробует места вокруг точки (справа, слева, сверху, снизу); fs — высота шрифта
  const SLOTS = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  function smartLabel(c, text, x, y, font, color, fs, gap, force) {
    c.font = font;
    const w = c.measureText(text).width, h = fs + 2;
    for (let i = 0; i < SLOTS.length; i++) {
      const sx = SLOTS[i][0], sy = SLOTS[i][1];
      const lx = sx > 0 ? x + gap : sx < 0 ? x - gap - w : x - w / 2;
      const ly = sy < 0 ? y - gap - h : sy > 0 ? y + gap : y - h / 2;
      if (lx < 2 || lx + w > side - 2 || ly < 2 || ly + h > side - 2) continue;
      let hit = false;
      for (let j = 0; j < placed.length; j++) {
        const r = placed[j];
        if (lx < r[2] && lx + w > r[0] && ly < r[3] && ly + h > r[1]) { hit = true; break; }
      }
      if (hit) continue;
      placed.push([lx - 1, ly - 1, lx + w + 1, ly + h + 1]);
      label(c, text, lx, ly + h / 2, font, color, 'left');
      return [lx, ly, w, h];
    }
    if (force) label(c, text, x + gap, y, font, color, 'left');
    return null;
  }
  function draw() {
    const w = G.world, size = w.size || 64000, t = mapTexture(G);
    t.finish();
    const c = ctx, s = side / size;
    const X = (x) => (x + size / 2) * s, Z = (z) => (z + size / 2) * s;
    const big = side > 520;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(t.canvas, 0, 0, side, side);
    // сетка 10 км
    c.strokeStyle = K.line; c.lineWidth = 1;
    c.beginPath();
    for (let g = -30000; g <= 30000; g += 10000) { c.moveTo(X(g), 0); c.lineTo(X(g), side); c.moveTo(0, Z(g)); c.lineTo(side, Z(g)); }
    c.stroke();
    placed.length = 0;
    // занятые места: аэродромы и игрок (подписи их не перекрывают)
    const aps0 = w.airports || [];
    for (let i = 0; i < aps0.length; i++) { const x = X(aps0[i].x), y = Z(aps0[i].z); placed.push([x - 11, y - 11, x + 11, y + 11]); }
    if (G.player) { const x = X(G.player.pos.x), y = Z(G.player.pos.z); placed.push([x - 10, y - 10, x + 10, y + 10]); }
    const pois = w.pois || [];
    for (let i = 0; i < pois.length; i++) {
      const p = pois[i], x = X(p.x), y = Z(p.z);
      c.fillStyle = K.haze; c.strokeStyle = K.night; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y - 3.5); c.lineTo(x + 3.5, y); c.lineTo(x, y + 3.5); c.lineTo(x - 3.5, y); c.closePath(); c.fill(); c.stroke();
    }
    // аэродромы: полосы с курсами и названия
    const aps = w.airports || [];
    for (let i = 0; i < aps.length; i++) {
      const a = aps[i];
      for (let j = 0; j < (a.runways ? a.runways.length : 0); j++) {
        const rw = a.runways[j], dx = Math.sin(rw.heading), dz = -Math.cos(rw.heading);
        const half = Math.max(rw.length / 2, 5 / s);
        const x1 = X(rw.cx - dx * half), y1 = Z(rw.cz - dz * half), x2 = X(rw.cx + dx * half), y2 = Z(rw.cz + dz * half);
        c.lineCap = 'butt';
        c.strokeStyle = K.night; c.lineWidth = 5; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        c.strokeStyle = K.cream; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        if (big && j === 0) {
          label(c, hdgName(rw.heading), x1 - dx * 9, y1 - dz * 9, `600 8px "JetBrains Mono",Menlo,monospace`, K.cream, 'center');
          label(c, hdgName(rw.heading + Math.PI), x2 + dx * 9, y2 + dz * 9, `600 8px "JetBrains Mono",Menlo,monospace`, K.cream, 'center');
        }
      }
      const x = X(a.x), y = Z(a.z);
      const sel = a.id === cardId;
      c.strokeStyle = sel ? K.dawn2 : K.cream; c.lineWidth = sel ? 2.4 : 1.2; c.beginPath(); c.arc(x, y, big ? 13 : 9, 0, TAU); c.stroke();
    }
    // подписи аэродромов — первыми (важнее), затем ориентиры, если есть место
    for (let i = 0; i < aps.length; i++) {
      const a = aps[i], x = X(a.x), y = Z(a.z);
      const name = a.kind === 'carrier' ? 'Авианосец' : a.name;
      const fs = big ? 12 : 10;
      const r = smartLabel(c, name.toUpperCase(), x, y, `600 ${fs}px "Oswald","Arial Narrow",sans-serif`, a.id === cardId ? K.dawn2 : K.cream, fs, big ? 15 : 11, true);
      if (big && r) {
        const t = `${a.code || ''} · ${Math.round(a.elevation || 0)} м`;
        const ty = r[1] + r[3] + 1;
        c.font = `500 8.5px "JetBrains Mono",Menlo,monospace`;
        const tw = c.measureText(t).width;
        let free = true;
        for (let j = 0; j < placed.length; j++) { const q = placed[j]; if (r[0] < q[2] && r[0] + tw > q[0] && ty < q[3] && ty + 10 > q[1]) { free = false; break; } }
        if (free) { placed.push([r[0], ty, r[0] + tw, ty + 10]); label(c, t, r[0], ty + 5, c.font, K.haze, 'left'); }
      }
    }
    for (let i = 0; i < pois.length; i++) {
      const p = pois[i], fs = big ? 10 : 8.5;
      smartLabel(c, p.name, X(p.x), Z(p.z), `500 ${fs}px "Golos Text","Segoe UI",sans-serif`, K.haze, fs, 6, false);
    }
    // след
    if (trailN > 1) {
      c.strokeStyle = K.dawn2; c.lineWidth = 1.6; c.setLineDash([4, 3]); c.lineJoin = 'round';
      c.beginPath();
      for (let i = 0; i < trailN; i++) {
        const idx = ((trailHead - trailN + i + TRAIL_N) % TRAIL_N) * 2;
        if (i === 0) c.moveTo(X(trail[idx]), Z(trail[idx + 1])); else c.lineTo(X(trail[idx]), Z(trail[idx + 1]));
      }
      if (G.player) c.lineTo(X(G.player.pos.x), Z(G.player.pos.z));
      c.stroke(); c.setLineDash([]);
    }
    // пункт назначения автопилота: пунктир от самолёта и кольцо
    const dst = G.autoflight && G.autoflight.destination;
    if (dst) {
      const x = X(dst.x), y = Z(dst.z);
      if (G.player) {
        c.strokeStyle = K.sky; c.lineWidth = 2; c.setLineDash([7, 5]);
        c.beginPath(); c.moveTo(X(G.player.pos.x), Z(G.player.pos.z)); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
      }
      c.strokeStyle = K.night; c.lineWidth = 5; c.beginPath(); c.arc(x, y, big ? 18 : 14, 0, TAU); c.stroke();
      c.strokeStyle = K.sky; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, big ? 18 : 14, 0, TAU); c.stroke();
    }
    // маркеры задания
    const mk = (G.hud && G.hud.markers) || [];
    for (let i = 0; i < mk.length; i++) {
      const m = mk[i], x = X(m.x), y = Z(m.z);
      const col = m.kind === 'target' ? K.signal : m.kind === 'friend' ? K.sky : m.kind === 'airport' ? K.cream : K.dawn;
      c.strokeStyle = K.night; c.lineWidth = 4; c.beginPath(); c.arc(x, y, 6, 0, TAU); c.stroke();
      c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 6, 0, TAU); c.stroke();
      c.fillStyle = col; c.beginPath(); c.arc(x, y, 2, 0, TAU); c.fill();
      if (m.label) label(c, m.label, x + 10, y - 8, `600 10px "Golos Text","Segoe UI",sans-serif`, col);
    }
    // другие самолёты и наземные цели
    const p = G.player;
    for (let i = 0; i < G.aircraft.length; i++) {
      const a = G.aircraft[i];
      if (a === p || !a.alive) continue;
      plane(c, X(a.pos.x), Z(a.pos.z), a.heading, 5, a.team === 'enemy' ? K.signal : a.team === 'friend' ? K.sky : K.cream);
    }
    const tg = (G.combat && G.combat.targets) || [];
    for (let i = 0; i < tg.length; i++) {
      const g = tg[i];
      if (!g || !g.alive || !g.pos) continue;
      c.fillStyle = g.team === 'enemy' || !g.team ? K.signal : K.sky; c.strokeStyle = K.night; c.lineWidth = 1;
      c.fillRect(X(g.pos.x) - 3, Z(g.pos.z) - 3, 6, 6); c.strokeRect(X(g.pos.x) - 3, Z(g.pos.z) - 3, 6, 6);
    }
    // игрок
    if (p) {
      const x = X(p.pos.x), y = Z(p.pos.z);
      c.strokeStyle = K.dawn; c.lineWidth = 1; c.globalAlpha = 0.6; c.beginPath(); c.arc(x, y, 16, 0, TAU); c.stroke(); c.globalAlpha = 1;
      plane(c, x, y, p.heading, 9, K.dawn);
    }
    // север и масштаб
    label(c, 'С', side - 16, 24, `600 12px "Oswald","Arial Narrow",sans-serif`, K.cream, 'center');
    c.fillStyle = K.cream; c.beginPath(); c.moveTo(side - 16, 5); c.lineTo(side - 12, 14); c.lineTo(side - 20, 14); c.closePath(); c.fill();
    const bar = 10000 * s;
    c.strokeStyle = K.night; c.lineWidth = 4; c.beginPath(); c.moveTo(12, side - 12); c.lineTo(12 + bar, side - 12); c.stroke();
    c.strokeStyle = K.cream; c.lineWidth = 2; c.beginPath(); c.moveTo(12, side - 12); c.lineTo(12 + bar, side - 12); c.stroke();
    label(c, '10 км', 12 + bar + 6, side - 12, `500 9px "JetBrains Mono",Menlo,monospace`, K.cream);
  }
  function plane(c, x, y, hdg, r, col) {
    c.save();
    c.translate(x, y); c.rotate(hdg || 0);
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.72, r * 0.8); c.lineTo(0, r * 0.38); c.lineTo(-r * 0.72, r * 0.8); c.closePath();
    c.fillStyle = col; c.fill(); c.strokeStyle = K.night; c.lineWidth = 1.2; c.stroke();
    c.restore();
  }

  function fillList() {
    const p = G.player, aps = G.world.airports || [];
    if (!p) { listEl.textContent = ''; return; }
    const rows = aps.map((a) => {
      const dx = a.x - p.pos.x, dz = a.z - p.pos.z;
      return { a, d: Math.hypot(dx, dz), b: ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360 };
    }).sort((u, v) => u.d - v.d).slice(0, 5);
    listEl.innerHTML = rows.map((r) => `<button type="button" class="map-row" data-apt="${r.a.id}"><b>${r.a.kind === 'carrier' ? 'Авианосец' : esc(r.a.name)}</b><span>${String(Math.round(r.b) % 360 || 360).padStart(3, '0')}°</span><span>${(r.d / 1000).toFixed(1)} км</span></button>`).join('');
  }

  const map = {
    root,
    get isOpen() { return !root.hidden; },
    open() {
      if (!root.hidden) return;
      root.hidden = false;
      cardId = null; root.classList.remove('map-has-card'); cardEl.hidden = true;
      fit(); draw(); fillList();
      acc = 0; listAcc = 0;
    },
    close() { root.hidden = true; },
    openCard(id) { if (root.hidden) map.open(); openCard(id); },
    toggle() { if (root.hidden) map.open(); else map.close(); },
    // каждый кадр: след игрока, достройка подложки, обновление открытой карты
    update(dt) {
      const p = G.player;
      if (p && G.mode === 'flight') {
        const dx = p.pos.x - lastX, dz = p.pos.z - lastZ;
        if (dx * dx + dz * dz > 160 * 160) {
          lastX = p.pos.x; lastZ = p.pos.z;
          trail[trailHead * 2] = lastX; trail[trailHead * 2 + 1] = lastZ;
          trailHead = (trailHead + 1) % TRAIL_N;
          if (trailN < TRAIL_N) trailN++;
        }
      }
      if (root.hidden) return;
      acc += dt; listAcc += dt;
      if (acc > 0.5) { acc = 0; draw(); }
      if (listAcc > 2) { listAcc = 0; if (cardId) fillCard(); else fillList(); }
    },
  };
  G.bus.on('input:map', () => { if (G.mode === 'flight') map.toggle(); });
  G.bus.on('flight:start', () => { trailN = 0; trailHead = 0; lastX = lastZ = 1e9; map.close(); });
  G.bus.on('flight:end', () => map.close());
  G.bus.on('menu:show', () => map.close());
  G.bus.on('resize', () => { if (!root.hidden) { fit(); draw(); } });
  return map;
}
