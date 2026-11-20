// КАРТА АРХИПЕЛАГА. Подложка рисуется один раз по world.heightAt (понемногу, чтобы не было рывка) и кэшируется;
// ею же пользуется мини-карта HUD. Полная карта открывается по 'input:map', закрывается тапом.
import { clamp, DEG, TAU } from '../core/util.js';
import { readTokens } from './hud-gauges.js';

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
        <div class="map-sub">Полётная карта · сетка 10 км</div>
        <div class="map-list"></div>
        <div class="map-legend">
          <span><i class="map-lg map-lg-me"></i>Вы</span><span><i class="map-lg map-lg-obj"></i>Задание</span>
          <span><i class="map-lg map-lg-apt"></i>Аэродром</span><span><i class="map-lg map-lg-poi"></i>Ориентир</span>
        </div>
        <div class="map-close">Коснитесь, чтобы закрыть</div>
      </div>
    </div>`;
  G.ui.appendChild(root);
  const canvas = root.querySelector('.map-canvas'), ctx = canvas.getContext('2d');
  const listEl = root.querySelector('.map-list');
  let side = 0, k = 1, acc = 0, listAcc = 9;
  const trail = new Float32Array(TRAIL_N * 2);
  let trailN = 0, trailHead = 0, lastX = 1e9, lastZ = 1e9;

  root.addEventListener('pointerdown', (e) => { e.preventDefault(); map.close(); });
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
    // ориентиры
    const pois = w.pois || [];
    for (let i = 0; i < pois.length; i++) {
      const p = pois[i], x = X(p.x), y = Z(p.z);
      c.fillStyle = K.haze; c.strokeStyle = K.night; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y - 3.5); c.lineTo(x + 3.5, y); c.lineTo(x, y + 3.5); c.lineTo(x - 3.5, y); c.closePath(); c.fill(); c.stroke();
      if (big) label(c, p.name, x + 7, y, `500 10px "Golos Text","Segoe UI",sans-serif`, K.haze);
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
      c.strokeStyle = K.cream; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, big ? 13 : 9, 0, TAU); c.stroke();
      const name = a.kind === 'carrier' ? 'Авианосец' : a.name;
      const right = x < side - 120;
      label(c, name.toUpperCase(), x + (right ? 1 : -1) * (big ? 17 : 12), y - (big ? 5 : 0), `600 ${big ? 12 : 9.5}px "Oswald","Arial Narrow",sans-serif`, K.cream, right ? 'left' : 'right');
      if (big) label(c, `${a.code || ''} · ${Math.round(a.elevation || 0)} м`, x + (right ? 17 : -17), y + 8, `500 8.5px "JetBrains Mono",Menlo,monospace`, K.haze, right ? 'left' : 'right');
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
    listEl.innerHTML = rows.map((r) => `<div class="map-row"><b>${r.a.kind === 'carrier' ? 'Авианосец' : r.a.name}</b><span>${String(Math.round(r.b) % 360).padStart(3, '0')}°</span><span>${(r.d / 1000).toFixed(1)} км</span></div>`).join('');
  }

  const map = {
    root,
    get isOpen() { return !root.hidden; },
    open() {
      if (!root.hidden) return;
      root.hidden = false;
      fit(); draw(); fillList();
      acc = 0; listAcc = 0;
    },
    close() { root.hidden = true; },
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
      if (listAcc > 2) { listAcc = 0; fillList(); }
    },
  };
  G.bus.on('input:map', () => { if (G.mode === 'flight') map.toggle(); });
  G.bus.on('flight:start', () => { trailN = 0; trailHead = 0; lastX = lastZ = 1e9; map.close(); });
  G.bus.on('flight:end', () => map.close());
  G.bus.on('menu:show', () => map.close());
  G.bus.on('resize', () => { if (!root.hidden) { fit(); draw(); } });
  return map;
}
