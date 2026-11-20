// ПРИБОРНАЯ ДОСКА HUD: два canvas — лента курса (сверху) и доска (снизу по центру):
// указатель скорости, авиагоризонт с директорными планками, высотомер с радиовысотой и вариометром.
// Перерисовка только когда изменились округлённые показания; строки чисел кэшируются.
import { clamp, wrapPi, DEG, TAU } from '../core/util.js';

const MONO = '"JetBrains Mono","SFMono-Regular",Menlo,Consolas,monospace';
const DISP = '"Oswald","Arial Narrow","Roboto Condensed",sans-serif';
export const DASH_W = 300, DASH_H = 96, HDG_W = 236, HDG_H = 38;

// токены оформления из CSS (цвета — только оттуда)
export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return {
    night: g('--night', '#0b1626'), night2: g('--night-2', '#13243a'), night3: g('--night-3', '#1d3552'),
    haze: g('--haze', '#8fb4cc'), cream: g('--cream', '#f4ecd8'), dawn: g('--dawn', '#ff9a3d'), dawn2: g('--dawn-2', '#ffc56b'),
    signal: g('--signal', '#ef4f3f'), ok: g('--ok', '#6fd08c'), sky: g('--sky', '#57b6d9'),
    glass: g('--glass', 'rgba(11,22,38,0.62)'), line: g('--glass-line', 'rgba(244,236,216,0.16)'),
    ballSky: g('--hud-ball-sky', '#3f8fc0'), ballSky2: g('--hud-ball-sky-2', '#8cc4de'),
    ballEarth: g('--hud-ball-earth', '#8a5a34'), ballEarth2: g('--hud-ball-earth-2', '#5d3b22'),
    dim: g('--hud-dim', 'rgba(244,236,216,0.55)'), panel: g('--hud-panel', 'rgba(11,22,38,0.72)'),
  };
}

const numCache = {};
let numCount = 0;
export function numStr(n) {
  let s = numCache[n];
  if (s === undefined) {
    if (numCount > 600) { for (const key in numCache) delete numCache[key]; numCount = 0; }
    s = numCache[n] = String(n);
    numCount++;
  }
  return s;
}
const HDG_LBL = [];
for (let i = 0; i < 36; i++) HDG_LBL.push(i === 0 ? 'С' : i === 9 ? 'В' : i === 18 ? 'Ю' : i === 27 ? 'З' : String(i).padStart(2, '0'));
const HDG_NUM = [];
for (let i = 0; i < 360; i++) HDG_NUM.push(String(i).padStart(3, '0'));
const BANK_TICKS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function createGauges(G, dash, hdg) {
  const K = readTokens();
  const dc = dash.getContext('2d'), hc = hdg.getContext('2d');
  let k = 1;
  const keyD = new Int32Array(16).fill(-99999), keyH = new Int32Array(6).fill(-99999), cur = new Int32Array(16);

  function resize(scale) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    k = dpr * scale;
    dash.width = Math.round(DASH_W * k); dash.height = Math.round(DASH_H * k);
    dash.style.width = DASH_W * scale + 'px'; dash.style.height = DASH_H * scale + 'px';
    hdg.width = Math.round(HDG_W * k); hdg.height = Math.round(HDG_H * k);
    hdg.style.width = HDG_W * scale + 'px'; hdg.style.height = HDG_H * scale + 'px';
    keyD.fill(-99999); keyH.fill(-99999);
  }

  function panel(c, x, y, w, h) {
    rr(c, x + 0.5, y + 0.5, w - 1, h - 1, 9);
    c.fillStyle = K.glass; c.fill();
    c.strokeStyle = K.line; c.lineWidth = 1; c.stroke();
  }
  function valueBox(c, x, y, w, h, notchRight) {
    const m = y + h / 2;
    c.beginPath();
    if (notchRight) { c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, m - 5); c.lineTo(x + w + 6, m); c.lineTo(x + w, m + 5); c.lineTo(x + w, y + h); c.lineTo(x, y + h); }
    else { c.moveTo(x + w, y); c.lineTo(x, y); c.lineTo(x, m - 5); c.lineTo(x - 6, m); c.lineTo(x, m + 5); c.lineTo(x, y + h); c.lineTo(x + w, y + h); }
    c.closePath();
    c.fillStyle = K.night; c.fill();
    c.strokeStyle = K.cream; c.lineWidth = 1.2; c.stroke();
  }

  // ---------- скорость ----------
  function drawSpeed(c, ac, ils) {
    const w = 82, h = DASH_H, cy = h / 2;
    panel(c, 0, 0, w, h);
    const kmh = ac.ias * 3.6, vmax = ac.spec.vMax * 3.6;
    const step = vmax < 450 ? 10 : vmax < 1100 ? 20 : 50;
    const pps = 11 / step;
    const fl = ac.flapsPos || 0;
    const vs0 = ac.spec.vStall * 3.6, vs = vs0 / Math.sqrt(1 + 0.5 * fl);
    const vfe = (ac.spec.vFlaps || ac.spec.vStall * 2.1) * 3.6;
    const yOf = (v) => cy - (v - kmh) * pps;
    c.save();
    rr(c, 1, 1, w - 2, h - 2, 8); c.clip();
    // цветные секторы у правой кромки
    const bx = w - 7;
    let y1 = yOf(0), y2 = yOf(vs);
    c.fillStyle = K.signal; c.fillRect(bx, y2, 5, y1 - y2);
    if (ac.spec.flaps) { y1 = y2; y2 = yOf(vfe); c.fillStyle = K.dim; c.fillRect(bx + 2, y2, 3, y1 - y2); }
    y1 = yOf(vmax);
    if (y1 > 0) { c.fillStyle = K.signal; c.fillRect(bx, 0, 5, y1); }
    // шкала
    c.strokeStyle = K.cream; c.fillStyle = K.dim; c.lineWidth = 1;
    c.font = `500 9px ${MONO}`; c.textAlign = 'right'; c.textBaseline = 'middle';
    const first = Math.max(0, Math.ceil((kmh - (cy + 4) / pps) / step) * step);
    c.beginPath();
    for (let v = first; ; v += step) {
      const y = yOf(v);
      if (y < -4) break;
      const major = v % (step * 2) === 0;
      c.moveTo(bx - 2, y); c.lineTo(bx - (major ? 11 : 6), y);
      if (major) c.fillText(numStr(v), bx - 14, y);
    }
    c.stroke();
    // скорость захода
    if (ils.active) {
      const y = clamp(yOf(ils.vApp * 3.6), 4, h - 4);
      c.fillStyle = K.dawn; c.beginPath(); c.moveTo(bx - 1, y); c.lineTo(bx - 9, y - 5); c.lineTo(bx - 9, y + 5); c.closePath(); c.fill();
    }
    c.restore();
    // значение
    const warn = (!ac.onGround && kmh < vs * 1.06) || kmh > vmax * 0.985;
    valueBox(c, 5, cy - 14, 56, 28, true);
    c.fillStyle = warn ? K.signal : K.cream;
    c.font = `600 19px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(numStr(Math.round(kmh)), 33, cy + 1);
    // нижняя строка: число М / скорость захода / единицы
    c.fillStyle = K.night; c.fillRect(5, cy + 14, 56, 13);
    c.strokeStyle = K.line; c.strokeRect(5.5, cy + 14.5, 55, 12);
    c.font = `500 8.5px ${DISP}`; c.fillStyle = K.haze;
    if (ils.active) { c.fillStyle = K.dawn2; c.fillText('ЗАХОД ' + numStr(Math.round(ils.vApp * 3.6)), 33, cy + 21); }
    else if (ac.mach > 0.6) c.fillText('М ' + (Math.round(ac.mach * 100) / 100).toFixed(2), 33, cy + 21);
    else c.fillText('КМ/Ч', 33, cy + 21);
  }

  // ---------- авиагоризонт ----------
  function drawBall(c, ac, ils) {
    const cx = DASH_W / 2, cy = DASH_H / 2, r = 44;
    const ppr = r / (26 * DEG);
    c.save();
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.clip();
    c.translate(cx, cy); c.rotate(-ac.bank);
    const py = clamp(ac.pitch, -1.5, 1.5) * ppr;
    let g = c.createLinearGradient(0, py - r * 1.6, 0, py);
    g.addColorStop(0, K.ballSky); g.addColorStop(1, K.ballSky2);
    c.fillStyle = g; c.fillRect(-r * 2, py - r * 6, r * 4, r * 6);
    g = c.createLinearGradient(0, py, 0, py + r * 1.6);
    g.addColorStop(0, K.ballEarth); g.addColorStop(1, K.ballEarth2);
    c.fillStyle = g; c.fillRect(-r * 2, py, r * 4, r * 6);
    c.strokeStyle = K.cream; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(-r * 2, py); c.lineTo(r * 2, py); c.stroke();
    c.lineWidth = 1; c.fillStyle = K.cream; c.font = `500 7px ${MONO}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.beginPath();
    for (let d = -90; d <= 90; d += 5) {
      if (d === 0) continue;
      const y = py - d * DEG * ppr;
      if (y < -r - 3 || y > r + 3) continue;
      const half = d % 10 === 0 ? 11 : 5;
      c.moveTo(-half, y); c.lineTo(half, y);
      if (d % 10 === 0) c.fillText(numStr(Math.abs(d)), half + 3, y + 0.5);
    }
    c.stroke();
    c.restore();
    // ободок и шкала крена
    c.save();
    c.translate(cx, cy);
    c.strokeStyle = K.night; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
    c.strokeStyle = K.dim; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, r + 1.5, 0, TAU); c.stroke();
    c.strokeStyle = K.cream; c.lineWidth = 1.2;
    c.beginPath();
    for (let i = 0; i < BANK_TICKS.length; i++) {
      const a = BANK_TICKS[i] * DEG, sn = Math.sin(a), cs = Math.cos(a);
      const r2 = BANK_TICKS[i] % 30 === 0 ? r - 7 : r - 4;
      c.moveTo(sn * (r - 1), -cs * (r - 1)); c.lineTo(sn * r2, -cs * r2);
    }
    c.stroke();
    // указатель крена
    c.rotate(-ac.bank);
    c.fillStyle = K.dawn; c.beginPath(); c.moveTo(0, -r + 8); c.lineTo(-4, -r + 15); c.lineTo(4, -r + 15); c.closePath(); c.fill();
    c.rotate(ac.bank);
    // директорные планки: вертикальная — курс, горизонтальная — глиссада («лети к перекрестию»)
    if (ils.active) {
      const lx = clamp(ils.loc, -1, 1) * 30, gy = -clamp(ils.gs, -1, 1) * 30;
      c.lineCap = 'round';
      c.strokeStyle = K.night; c.lineWidth = 4.2;
      c.beginPath(); c.moveTo(lx, -27); c.lineTo(lx, 27); c.moveTo(-27, gy); c.lineTo(27, gy); c.stroke();
      c.strokeStyle = ils.onPath ? K.ok : K.dawn2; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(lx, -27); c.lineTo(lx, 27); c.moveTo(-27, gy); c.lineTo(27, gy); c.stroke();
      c.lineCap = 'butt';
    }
    // силуэт самолёта
    c.strokeStyle = K.night; c.lineWidth = 4.5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-24, 0); c.lineTo(-9, 0); c.lineTo(-9, 4); c.moveTo(24, 0); c.lineTo(9, 0); c.lineTo(9, 4); c.stroke();
    c.strokeStyle = K.dawn; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(-24, 0); c.lineTo(-9, 0); c.lineTo(-9, 4); c.moveTo(24, 0); c.lineTo(9, 0); c.lineTo(9, 4); c.stroke();
    c.fillStyle = K.dawn; c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fill();
    c.lineCap = 'butt';
    c.restore();
  }

  // ---------- высота, радиовысота, вариометр ----------
  function drawAlt(c, ac) {
    const w = 82, x0 = DASH_W - w, h = DASH_H, cy = h / 2;
    panel(c, x0, 0, w, h);
    const alt = ac.alt, step = 50, ppm = 11 / step;
    const yOf = (v) => cy - (v - alt) * ppm;
    c.save();
    rr(c, x0 + 1, 1, w - 2, h - 2, 8); c.clip();
    // земля поднимается по ленте
    const yg = yOf(alt - ac.agl);
    if (yg < h) { c.fillStyle = K.ballEarth; c.fillRect(x0 + 1, yg, 13, h - yg); c.fillStyle = K.dawn; c.fillRect(x0 + 1, yg, 13, 1.5); }
    c.strokeStyle = K.cream; c.fillStyle = K.dim; c.lineWidth = 1;
    c.font = `500 9px ${MONO}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    const first = Math.ceil((alt - (cy + 4) / ppm) / step) * step;
    c.beginPath();
    for (let v = first; ; v += step) {
      const y = yOf(v);
      if (y < -4) break;
      const major = v % 100 === 0;
      c.moveTo(x0 + 3, y); c.lineTo(x0 + (major ? 12 : 8), y);
      if (major) c.fillText(numStr(v), x0 + 16, y);
    }
    c.stroke();
    c.restore();
    // вариометр: столбик справа
    const vx = x0 + w - 11, vh = h / 2 - 7;
    c.fillStyle = K.night; rr(c, vx, 4, 7, h - 8, 3); c.fill();
    const vsv = ac.vs, vy = -Math.sign(vsv) * Math.sqrt(Math.min(Math.abs(vsv), 15) / 15) * vh;
    c.fillStyle = vsv >= 0 ? K.ok : vsv < -6 && ac.agl < 300 ? K.signal : K.dawn;
    if (vy < 0) c.fillRect(vx + 1.5, cy + vy, 4, -vy); else c.fillRect(vx + 1.5, cy, 4, vy);
    c.fillStyle = K.cream; c.fillRect(vx - 1, cy - 0.5, 9, 1);
    // значение
    const bx = x0 + 15, bw = 53;
    valueBox(c, bx, cy - 14, bw, 28, false);
    c.fillStyle = K.cream; c.font = `600 ${alt >= 9999.5 ? 15 : 17}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(numStr(Math.round(alt)), bx + bw / 2, cy + 1);
    // верхняя строка: радиовысота у земли
    c.font = `500 8.5px ${DISP}`;
    c.fillStyle = K.night; c.fillRect(bx, cy - 27, bw, 13); c.fillRect(bx, cy + 14, bw, 13);
    c.strokeStyle = K.line; c.strokeRect(bx + 0.5, cy - 26.5, bw - 1, 12); c.strokeRect(bx + 0.5, cy + 14.5, bw - 1, 12);
    if (!ac.onGround && ac.agl < 600) { c.fillStyle = K.dawn2; c.fillText('РВ ' + numStr(Math.round(ac.agl < 50 ? ac.agl : ac.agl / 5) * (ac.agl < 50 ? 1 : 5)), bx + bw / 2, cy - 20); }
    else { c.fillStyle = K.haze; c.fillText('ВЫСОТА М', bx + bw / 2, cy - 20); }
    // нижняя строка: вертикальная скорость
    const v10 = Math.round(vsv * 10);
    c.fillStyle = v10 >= 0 ? K.cream : vsv < -6 && ac.agl < 300 ? K.signal : K.dawn2;
    c.font = `500 8.5px ${MONO}`;
    c.fillText((v10 > 0 ? '+' : v10 < 0 ? '−' : ' ') + numStr(Math.abs(v10 / 10 | 0)) + '.' + numStr(Math.abs(v10) % 10) + ' м/с', bx + bw / 2, cy + 21);
  }

  // ---------- лента курса ----------
  function drawHdg(ac, bugObj, bugApt) {
    const c = hc, W = HDG_W, th = 23;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.clearRect(0, 0, W, HDG_H);
    panel(c, 0, 0, W, th);
    const hd = ac.heading / DEG, ppd = 2.2;
    c.save();
    rr(c, 1, 1, W - 2, th - 2, 8); c.clip();
    c.strokeStyle = K.cream; c.lineWidth = 1; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.beginPath();
    const d0 = Math.floor((hd - 56) / 5) * 5;
    for (let d = d0; d <= hd + 56; d += 5) {
      const x = W / 2 + (d - hd) * ppd;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 30 === 0;
      c.moveTo(x, th); c.lineTo(x, th - (major ? 7 : dd % 10 === 0 ? 5 : 3));
      if (major) {
        const card = dd % 90 === 0;
        c.font = card ? `600 11px ${DISP}` : `500 9px ${MONO}`;
        c.fillStyle = card ? K.dawn2 : K.dim;
        c.fillText(HDG_LBL[dd / 10], x, 8.5);
      }
    }
    c.stroke();
    c.restore();
    // метки направлений: аэродром (квадрат) и цель задания (ромб)
    if (bugApt === bugApt) {
      const x = clamp(W / 2 + (wrapPi(bugApt - ac.heading) / DEG) * ppd, 7, W - 7);
      c.fillStyle = K.sky; c.fillRect(x - 3.5, th - 4, 7, 7);
      c.strokeStyle = K.night; c.lineWidth = 1; c.strokeRect(x - 3.5, th - 4, 7, 7);
    }
    if (bugObj === bugObj) {
      const x = clamp(W / 2 + (wrapPi(bugObj - ac.heading) / DEG) * ppd, 7, W - 7);
      c.fillStyle = K.dawn; c.beginPath(); c.moveTo(x, th - 6); c.lineTo(x + 5, th); c.lineTo(x, th + 6); c.lineTo(x - 5, th); c.closePath(); c.fill();
      c.strokeStyle = K.night; c.lineWidth = 1; c.stroke();
    }
    // текущий курс
    const bw = 46, bx = W / 2 - bw / 2, by = th - 3;
    c.beginPath(); c.moveTo(W / 2, by - 5); c.lineTo(W / 2 + 5, by); c.lineTo(bx + bw, by); c.lineTo(bx + bw, by + 17); c.lineTo(bx, by + 17); c.lineTo(bx, by); c.lineTo(W / 2 - 5, by); c.closePath();
    c.fillStyle = K.night; c.fill(); c.strokeStyle = K.cream; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = K.cream; c.font = `600 13px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(HDG_NUM[((Math.round(hd) % 360) + 360) % 360] + '°', W / 2 + 1, by + 9);
  }

  return {
    resize,
    // ils: { active, loc −1..1 (полоса правее +), gs −1..1 (глиссада выше +), vApp м/с, onPath }
    update(ac, ils, bugObj, bugApt) {
      // доска
      cur[0] = Math.round(ac.ias * 7.2); cur[1] = Math.round(ac.alt * 2); cur[2] = Math.round(ac.vs * 10);
      cur[3] = Math.round(ac.pitch * 400); cur[4] = Math.round(ac.bank * 300); cur[5] = Math.round(ac.agl < 600 ? ac.agl : 600);
      cur[6] = Math.round((ac.flapsPos || 0) * 20); cur[7] = ils.active ? 1 : 0;
      cur[8] = ils.active ? Math.round(ils.loc * 60) : 0; cur[9] = ils.active ? Math.round(ils.gs * 60) : 0;
      cur[10] = ac.onGround ? 1 : 0; cur[11] = Math.round((ac.mach || 0) * 100); cur[12] = ils.onPath ? 1 : 0;
      let ch = false;
      for (let i = 0; i < 13; i++) if (cur[i] !== keyD[i]) { keyD[i] = cur[i]; ch = true; }
      if (ch) {
        dc.setTransform(k, 0, 0, k, 0, 0);
        dc.clearRect(0, 0, DASH_W, DASH_H);
        drawSpeed(dc, ac, ils);
        drawAlt(dc, ac);
        drawBall(dc, ac, ils);
      }
      // курс
      const h0 = Math.round(ac.heading * 500);
      const h1 = bugObj === bugObj ? Math.round(wrapPi(bugObj - ac.heading) * 200) : 9999;
      const h2 = bugApt === bugApt ? Math.round(wrapPi(bugApt - ac.heading) * 200) : 9999;
      if (h0 !== keyH[0] || h1 !== keyH[1] || h2 !== keyH[2]) {
        keyH[0] = h0; keyH[1] = h1; keyH[2] = h2;
        drawHdg(ac, bugObj, bugApt);
      }
    },
  };
}
