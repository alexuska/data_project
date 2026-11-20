// Общие кирпичики меню: значки, форматирование, шкалы, карта архипелага.
import { CURRENCY } from '../systems/economy.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const NBSP = ' ';
export const fmtInt = (v) => Math.round(v || 0).toLocaleString('ru-RU').replace(/\s/g, NBSP);
export const fmtMoney = (v) => `${fmtInt(v)}${NBSP}${CURRENCY}`;
export const fmtSigned = (v) => `${v < 0 ? '−' : '+'}${fmtInt(Math.abs(v))}`;
export const fmtNum = (v, digits = 1) => (v || 0).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\s/g, NBSP);
const pad2 = (n) => String(n).padStart(2, '0');
// налёт: «2 ч 05 мин»
export function fmtHours(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}${NBSP}ч ${pad2(m)}${NBSP}мин` : `${m}${NBSP}мин`;
}
// время полёта: «04:12»
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}
export function fmtDate(ts) {
  const d = new Date(ts || 0);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// ---------- значки (24×24, линия currentColor) ----------
const S = (d, extra = '') => `<path d="${d}"/>${extra}`;
export const ICONS = {
  back: S('M15 5l-7 7 7 7'),
  next: S('M9 5l7 7-7 7'),
  close: S('M6 6l12 12M18 6L6 18'),
  check: S('M5 12.5l4.5 4.5L19 7.5'),
  lock: S('M8.5 11V8a3.5 3.5 0 017 0v3', '<rect x="5.5" y="11" width="13" height="9" rx="1.5"/>'),
  fullscreen: S('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'),
  hangar: S('M3 20V10l9-5 9 5v10M7 20v-6h10v6M7 17h10'),
  book: S('M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11M9 8h6'),
  settings: S('M4 7h9M17 7h3M4 17h3M11 17h9', '<circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  clock: S('M12 7v5l3.5 2', '<circle cx="12" cy="12" r="8.5"/>'),
  route: S('M6 17c0-6 5-3 6-7s4-2 6-4', '<circle cx="6" cy="19" r="1.6"/><circle cx="18" cy="5" r="1.6"/>'),
  landing: S('M3 20h18M4 8l2.4 4.6 11.2 3.3a1.6 1.6 0 001-3L8 9.6 6.6 7z'),
  feather: S('M20 4C12 4 7 9 6 16l-2 4M6 16c4 0 7-1 9-3M9 12h8'),
  moon: S('M19 14.5A8 8 0 019.5 5a7 7 0 109.5 9.5z'),
  sun: S('M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8', '<circle cx="12" cy="12" r="4"/>'),
  sunrise: S('M3 18h18M6.5 18a5.500 5.500 0 0111 0M12 9V4M9.800 6.200L12 4l2.200 2.200M4.600 11.600l1.700 1.700M19.400 11.600l-1.700 1.700'),
  sunset: S('M3 18h18M6.500 18a5.500 5.500 0 0111 0M12 4v5M9.800 6.800L12 9l2.200-2.200M4.600 11.600l1.700 1.700M19.400 11.600l-1.700 1.700'),
  cloud: S('M7 18a4 4 0 01-.5-8 5.500 5.500 0 0110.600 1.200A3.500 3.500 0 0117 18z'),
  cloudy: S('M7 19a3.500 3.500 0 01-.4-7 5 5 0 019.600 1A3.200 3.200 0 0116 19zM8 8.500A4 4 0 0115.500 7a3 3 0 014.300 3.600'),
  rain: S('M7 15a4 4 0 01-.5-8 5.500 5.500 0 0110.600 1.200A3.500 3.500 0 0117 15zM9 18l-1 2.500M13 18l-1 2.500M17 18l-1 2.500'),
  storm: S('M7 15a4 4 0 01-.5-8 5.500 5.500 0 0110.600 1.200A3.500 3.500 0 0117 15M12.500 13l-2.500 4h3l-1.500 4'),
  fog: S('M4 8h16M6 12h14M4 16h12M8 20h10'),
  snow: S('M12 3v18M4.200 7.500l15.600 9M19.800 7.500l-15.600 9'),
  peak: S('M3 19l6-11 3.500 6 2.500-4 6 9z'),
  anchor: S('M12 7v13M5 13a7 7 0 0014 0M8.500 11h7', '<circle cx="12" cy="5" r="2"/>'),
  wave: S('M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0'),
  fuel: S('M6 20V6a2 2 0 012-2h5a2 2 0 012 2v14M5 20h11M8.500 8h4v3.500h-4zM15 10l3 2v6a1.500 1.500 0 003 0V9l-2.500-2.500'),
  altitude: S('M12 20V5M6.500 10.500L12 5l5.500 5.500M5 20h14'),
  speed: S('M4.500 17a8.500 8.500 0 1115 0M12 14l4-5.500', '<circle cx="12" cy="14" r="1.200"/>'),
  lowpass: S('M3 19h18M3 15h3M5 7.500l11 2.800 3.800 1.400c.9.4.7 1.600-.3 1.600H9.500z'),
  aerobatics: S('M3 17h5c5 0 8-2.500 8-6a4 4 0 00-8 0c0 3.500 3 6 8 6h5'),
  bridge: S('M2 17h20M5 20V7M19 20V7M5 8c3 5.500 11 5.500 14 0M9 12v5M12 12.600V17M15 12v5'),
  pin: S('M12 21s-6-5.600-6-10.200a6 6 0 0112 0C18 15.400 12 21 12 21z', '<circle cx="12" cy="10.500" r="2"/>'),
  compass: S('M15.500 8.500l-2 5-5 2 2-5z', '<circle cx="12" cy="12" r="8.500"/>'),
  flag: S('M6 21V4M6 5h11l-2.500 3.500L17 12H6'),
  medal: S('M8 3l4 6 4-6M12 13.500v4', '<circle cx="12" cy="15.500" r="5.500"/>'),
  wrench: S('M15 4a4.500 4.500 0 00-4.200 6.200L4 17l3 3 6.800-6.800A4.500 4.500 0 0020 9l-3 1.500L15 9l1-3z'),
  target: S('M12 2v4M12 18v4M2 12h4M18 12h4', '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.500"/>'),
  camera: S('M4 8h3l1.500-2h7L17 8h3v11H4z', '<circle cx="12" cy="13" r="3.500"/>'),
  restart: S('M19 12a7 7 0 11-2.300-5.200M19 4v4h-4'),
  info: S('M12 11v5M12 8v.010', '<circle cx="12" cy="12" r="8.500"/>'),
  controls: S('M6 9h12a4 4 0 014 4v2a3 3 0 01-5.500 1.700L15.500 15h-7l-1 1.700A3 3 0 012 15v-2a4 4 0 014-4zM7 11.500v3M5.500 13h3M16.500 12.200v.010M18.200 13.800v.010'),
  exit: S('M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9'),
  play: S('M8 5l11 7-11 7z'),
  rotate: S('M4 14a8 8 0 0113.700-5.600M20 4v4.500h-4.500', '<rect x="6" y="12" width="12" height="8" rx="1.500"/>'),
  coin: S('M12 8v8M9.500 10h3.700a1.500 1.500 0 010 3H9.500M9.500 15h4', '<circle cx="12" cy="12" r="8.500"/>'),
  gift: S('M4 11h16v9H4zM3 7.500h18V11H3zM12 7.500V20M12 7.500C10 3 5.500 4.500 8 7.500M12 7.500c2-4.500 6.500-3 4 0'),
  // закрашенные
  star: '<path class="menu-ico-fill" d="M12 2.600l2.900 5.900 6.500.900-4.700 4.600 1.100 6.500L12 17.400l-5.800 3.100 1.100-6.500L2.600 9.400l6.500-.900z"/>',
  plane: '<path class="menu-ico-fill" d="M12 2.500c.900 0 1.400 1.200 1.400 2.800v3.400l7.600 4.600v2l-7.600-2.300v4.200l2.400 1.800v1.500L12 19.600l-3.800.900V19l2.400-1.800V13l-7.600 2.300v-2l7.600-4.600V5.300c0-1.600.5-2.800 1.400-2.800z"/>',
};
export function icon(name, size = 20, cls = '') {
  return `<svg class="menu-ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
}

export function stars(n, max = 3, size = 14) {
  let s = '';
  for (let i = 0; i < max; i++) s += icon('star', size, i < n ? 'menu-star is-on' : 'menu-star');
  return `<span class="menu-stars" aria-label="${n} из ${max}">${s}</span>`;
}
export function pips(n, max = 5) {
  let s = '';
  for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'is-on' : ''}"></i>`;
  return `<span class="menu-pips" aria-label="${n} из ${max}">${s}</span>`;
}
// приборная шкала: k 0..1, bonus — добавка (например, от улучшений)
export function scale(k, bonus = 0, cls = '') {
  const a = Math.max(0, Math.min(1, k)), b = Math.max(0, Math.min(1 - a, bonus));
  return `<span class="menu-scale ${cls}"><i style="width:${(a * 100).toFixed(1)}%"></i>${b > 0 ? `<b style="left:${(a * 100).toFixed(1)}%;width:${(b * 100).toFixed(1)}%"></b>` : ''}</span>`;
}
// сегментный переключатель: options [{v, label, icon?}]
export function segmented(act, options, value, cls = '') {
  return `<div class="menu-seg ${cls}" role="radiogroup">${options.map((o) => `<button type="button" role="radio" aria-checked="${o.v === value}" class="${o.v === value ? 'is-on' : ''}" data-act="${act}" data-v="${esc(o.v)}">${o.icon ? icon(o.icon, 18) : ''}<span>${esc(o.label)}</span></button>`).join('')}</div>`;
}

// ---------- справочники подписей ----------
export const CLS_NAMES = { trainer: 'учебный', utility: 'многоцелевой', airliner: 'пассажирский', cargo: 'транспортный', amphibian: 'амфибия', fighter: 'истребитель', attacker: 'штурмовик', bomber: 'бомбардировщик', warbird: 'ретро' };
export const ENGINE_NAMES = { piston: 'поршневой', turboprop: 'турбовинтовой', jet: 'реактивный' };
export const KIND_NAMES = { intl: 'международный аэропорт', military: 'военная авиабаза', regional: 'региональный аэропорт', strip: 'посадочная площадка', carrier: 'авианосец' };
export const WEATHER = [
  { v: 'clear', label: 'Ясно', icon: 'sun' }, { v: 'cloudy', label: 'Облачно', icon: 'cloudy' }, { v: 'overcast', label: 'Пасмурно', icon: 'cloud' },
  { v: 'rain', label: 'Дождь', icon: 'rain' }, { v: 'storm', label: 'Гроза', icon: 'storm' }, { v: 'fog', label: 'Туман', icon: 'fog' }, { v: 'snow', label: 'Снег', icon: 'snow' },
];
export const TIMES = [
  { v: 'dawn', label: 'Рассвет', icon: 'sunrise', h: 6.4 }, { v: 'day', label: 'День', icon: 'sun', h: 12.5 },
  { v: 'dusk', label: 'Закат', icon: 'sunset', h: 19.6 }, { v: 'night', label: 'Ночь', icon: 'moon', h: 23.5 },
];
export const shortAirport = (a) => (a ? (a.kind === 'carrier' ? '«Буревестник»' : a.name) : '');

// ---------- карта архипелага ----------
let mapUrl = null;
function tokenRgb(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  } catch (e) { /* нет стилей */ }
  return fallback;
}
// растровая подложка: суша по высотам из world.heightAt (один раз, результат кэшируется)
export function mapImage(G) {
  if (mapUrl !== null) return mapUrl;
  mapUrl = '';
  try {
    const world = G.world, N = 192, size = world.size || 64000;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const land = tokenRgb('--haze', [143, 180, 204]), high = tokenRgb('--cream', [244, 236, 216]);
    const hs = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hs[j * N + i] = world.heightAt(((i + 0.5) / N - 0.5) * size, ((j + 0.5) / N - 0.5) * size);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const h = hs[j * N + i], o = (j * N + i) * 4;
        if (h <= 0) { img.data[o + 3] = 0; continue; }
        // ступени высот, как на полётной карте: берег, равнина, предгорья, вершины
        const t = h < 150 ? 0 : h < 450 ? 0.3 : h < 800 ? 0.6 : 1;
        for (let k = 0; k < 3; k++) img.data[o + k] = land[k] + (high[k] - land[k]) * t;
        img.data[o + 3] = Math.round(255 * (0.36 + t * 0.4));
      }
    }
    g.putImageData(img, 0, 0);
    mapUrl = c.toDataURL('image/png');
  } catch (e) { mapUrl = ''; }
  return mapUrl;
}
export const mapPos = (G, x, z) => {
  const size = G.world.size || 64000;
  return { l: (x / size + 0.5) * 100, t: (z / size + 0.5) * 100 };
};
// opts: { route: [fromId, toId], selected: id, visited: {id: ts}, places: {id: ts} | null (не показывать ориентиры), act: имя действия для аэродромов }
export function mapHtml(G, opts = {}) {
  const world = G.world;
  const url = mapImage(G);
  const sel = opts.selected, visited = opts.visited || null;
  let svg = '';
  for (let k = 1; k < 4; k++) svg += `<path class="menu-map-grid" d="M${k * 25} 0V100M0 ${k * 25}H100"/>`;
  if (opts.route && opts.route[0] && opts.route[1]) {
    const a = world.airportById[opts.route[0]], b = world.airportById[opts.route[1]];
    if (a && b && a !== b) {
      const pa = mapPos(G, a.x, a.z), pb = mapPos(G, b.x, b.z);
      svg += `<path class="menu-map-route" d="M${pa.l.toFixed(2)} ${pa.t.toFixed(2)}L${pb.l.toFixed(2)} ${pb.t.toFixed(2)}"/>`;
    }
  }
  let marks = '';
  if (opts.places) {
    for (const poi of world.pois || []) {
      const p = mapPos(G, poi.x, poi.z);
      marks += `<span class="menu-map-poi ${opts.places[poi.id] ? 'is-on' : ''}" style="left:${p.l.toFixed(2)}%;top:${p.t.toFixed(2)}%"></span>`;
    }
  }
  for (const a of world.airports || []) {
    const p = mapPos(G, a.x, a.z);
    const cls = [a.id === sel ? 'is-selected' : '', visited && visited[a.id] ? 'is-visited' : '', opts.route && opts.route.includes(a.id) ? 'is-route' : '', p.l > 72 ? 'is-left' : ''].join(' ');
    const tag = opts.act ? 'button type="button"' : 'span';
    marks += `<${tag} class="menu-map-ap ${cls}" ${opts.act ? `data-act="${opts.act}" data-id="${a.id}" data-sfx="ui_tick"` : ''} style="left:${p.l.toFixed(2)}%;top:${p.t.toFixed(2)}%"><i></i><em>${esc(shortAirport(a))}</em></${opts.act ? 'button' : 'span'}>`;
  }
  return `<div class="menu-map">${url ? `<img class="menu-map-img" src="${url}" alt="">` : ''}<svg class="menu-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>${marks}<span class="menu-map-n">С</span></div>`;
}
export function routeInfo(G, fromId, toId) {
  const a = G.world.airportById[fromId], b = G.world.airportById[toId];
  if (!a || !b || a === b) return null;
  const dx = b.x - a.x, dz = b.z - a.z;
  let brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  if (brg < 0) brg += 360;
  return { km: Math.hypot(dx, dz) / 1000, course: Math.round(brg) % 360 };
}
