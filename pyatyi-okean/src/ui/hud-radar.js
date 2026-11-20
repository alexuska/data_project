// МИНИ-КАРТА HUD: круг «курсом вверх», игрок в центре. Подложка — из ui/map.js (когда готова),
// поверх: полосы аэродромов, маркеры задания, самолёты по командам, наземные цели. Обновляется ~8 раз в секунду.
import { TAU } from '../core/util.js';
import { mapTexture } from './map.js';

export const RADAR_SIZE = 92;

export function createRadar(G, canvas, K) {
  const ctx = canvas.getContext('2d');
  let k = 1, acc = 1, tex = null;
  const SZ = RADAR_SIZE, R = SZ / 2 - 2, C = SZ / 2;

  function tri(c, x, y, hdg, r, col) {
    const sn = Math.sin(hdg), cs = Math.cos(hdg);
    c.beginPath();
    c.moveTo(x + sn * r, y - cs * r);
    c.lineTo(x + cs * r * 0.7 - sn * r * 0.8, y + sn * r * 0.7 + cs * r * 0.8);
    c.lineTo(x - cs * r * 0.7 - sn * r * 0.8, y - sn * r * 0.7 + cs * r * 0.8);
    c.closePath();
    c.fillStyle = col; c.fill();
    c.strokeStyle = K.night; c.lineWidth = 0.8; c.stroke();
  }

  function draw(ac, markers, nAuto, auto) {
    const c = ctx, w = G.world;
    const range = ac.spec.vMax < 120 ? 5000 : ac.spec.vMax < 280 ? 10000 : 16000;
    const sc = R / range, px = ac.pos.x, pz = ac.pos.z;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.direction = 'ltr';
    c.clearRect(0, 0, SZ, SZ);
    c.save();
    c.beginPath(); c.arc(C, C, R, 0, TAU); c.clip();
    c.fillStyle = K.night2; c.fillRect(0, 0, SZ, SZ);
    c.translate(C, C); c.rotate(-ac.heading);
    if (tex && tex.row > 0) {
      const size = tex.size;
      c.globalAlpha = 0.82;
      c.drawImage(tex.canvas, (-size / 2 - px) * sc, (-size / 2 - pz) * sc, size * sc, size * sc);
      c.globalAlpha = 1;
    }
    // аэродромы
    const aps = w.airports || [];
    c.lineCap = 'butt';
    for (let i = 0; i < aps.length; i++) {
      const a = aps[i];
      const dx = a.x - px, dz = a.z - pz;
      if (dx * dx + dz * dz > (range + 4000) * (range + 4000) || !a.runways) continue;
      for (let j = 0; j < a.runways.length; j++) {
        const rw = a.runways[j], sx = Math.sin(rw.heading), sz = -Math.cos(rw.heading), half = Math.max(rw.length / 2, 3.5 / sc);
        const x1 = (rw.cx - sx * half - px) * sc, y1 = (rw.cz - sz * half - pz) * sc, x2 = (rw.cx + sx * half - px) * sc, y2 = (rw.cz + sz * half - pz) * sc;
        c.strokeStyle = K.night; c.lineWidth = 3.4; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        c.strokeStyle = K.cream; c.lineWidth = 1.7; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      }
    }
    // маркеры задания (за пределами дальности — на ободе)
    const total = (markers ? markers.length : 0) + nAuto;
    for (let i = 0; i < total; i++) {
      const m = i < nAuto ? auto[i] : markers[i - nAuto];
      if (!m || m.kind === 'bandit') continue;
      let x = (m.x - px) * sc, y = (m.z - pz) * sc;
      const d = Math.hypot(x, y);
      if (d > R - 4) { x *= (R - 4) / d; y *= (R - 4) / d; }
      const col = m.kind === 'target' ? K.signal : m.kind === 'friend' ? K.sky : m.kind === 'airport' ? K.cream : K.dawn;
      c.fillStyle = col; c.strokeStyle = K.night; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(x, y - 3.6); c.lineTo(x + 3.6, y); c.lineTo(x, y + 3.6); c.lineTo(x - 3.6, y); c.closePath(); c.fill(); c.stroke();
    }
    // наземные цели
    const tg = (G.combat && G.combat.targets) || [];
    for (let i = 0; i < tg.length; i++) {
      const g = tg[i];
      if (!g || !g.alive || !g.pos) continue;
      const x = (g.pos.x - px) * sc, y = (g.pos.z - pz) * sc;
      if (x * x + y * y > R * R) continue;
      c.fillStyle = g.team === 'friend' || g.team === 'player' ? K.sky : K.signal;
      c.fillRect(x - 1.8, y - 1.8, 3.6, 3.6);
    }
    // самолёты
    const list = G.aircraft;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a === ac || !a.alive) continue;
      const x = (a.pos.x - px) * sc, y = (a.pos.z - pz) * sc;
      if (x * x + y * y > R * R) continue;
      tri(c, x, y, a.heading, 3.6, a.team === 'enemy' ? K.signal : a.team === 'friend' || a.team === 'player' ? K.sky : K.cream);
    }
    c.restore();
    // кольцо половины дальности, обод, север, игрок
    c.strokeStyle = K.line; c.lineWidth = 1;
    c.beginPath(); c.arc(C, C, R / 2, 0, TAU); c.stroke();
    c.strokeStyle = K.dim; c.lineWidth = 1.2;
    c.beginPath(); c.arc(C, C, R, 0, TAU); c.stroke();
    const nx = C + Math.sin(-ac.heading) * (R - 7), ny = C - Math.cos(-ac.heading) * (R - 7);
    c.fillStyle = K.night; c.beginPath(); c.arc(nx, ny, 6, 0, TAU); c.fill();
    c.fillStyle = K.dawn2; c.font = '600 8.5px "Oswald","Arial Narrow",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('С', nx, ny + 0.5);
    tri(c, C, C, 0, 5.2, K.dawn);
    c.fillStyle = K.dim; c.font = '500 7px "JetBrains Mono",Menlo,monospace';
    c.fillText(range / 1000 + ' км', C, SZ - 9);
  }

  return {
    resize(scale) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      k = dpr * scale;
      canvas.width = canvas.height = Math.round(SZ * k);
      canvas.style.width = canvas.style.height = SZ * scale + 'px';
      acc = 1;
    },
    update(dt, ac, markers, nAuto, auto) {
      if (!tex) tex = mapTexture(G);
      if (!tex.ready) tex.step(2.5);
      acc += dt;
      if (acc < 0.12) return;
      acc = 0;
      draw(ac, markers, nAuto, auto);
    },
  };
}
