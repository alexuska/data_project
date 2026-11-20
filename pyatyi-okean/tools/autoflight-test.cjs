#!/usr/bin/env node
// Проверка автопилота и навигации (G.autoflight) числами: удержание на трёх самолётах, «автопилот туда» Тирасполь → Бендеры,
// автопосадка до остановки, отключение ручкой, старт со стоянки (маршрут руления, вышка), запрос посадки, чек-лист.
//   node tools/autoflight-test.cjs [--dist out/af] [--only hold,nav,land,stick,park,tower,check]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
let dist = 'out/af', only = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dist') dist = argv[++i];
  else if (argv[i] === '--only') only = argv[++i].split(',');
}
const want = (k) => !only || only.includes(k);

// ---------- код, исполняемый в странице ----------
function tHold(plane) {
  const G = window.__G, D = 180 / Math.PI;
  const s0 = G.world.runwayStart('yasny', 0, 'A');
  G.startFlight({ planeId: plane, air: { x: s0.x - 6000, y: 1500, z: s0.z + 3000, heading: 1.2 } });
  const p = G.player;
  G.debug.advance(2, false);
  const ok1 = G.autoflight.engage('hold');
  const T = G.autoflight.target;
  const want1 = { hdg: T.heading * D, alt: T.alt, spd: T.speed * 3.6 };
  for (let i = 0; i < 6; i++) G.debug.advance(10, false);
  const err = () => ({
    hdg: +(((p.heading * D - T.heading * D + 540) % 360) - 180).toFixed(1),
    alt: +(p.alt - T.alt).toFixed(1),
    spd: +(p.ias * 3.6 - T.speed * 3.6).toFixed(1),
  });
  const e1 = err();
  // уставки ±: курс +30°, высота +200 м, скорость +20 км/ч
  for (let i = 0; i < 3; i++) G.autoflight.adjust('hdg', 1);
  for (let i = 0; i < 2; i++) G.autoflight.adjust('alt', 1);
  for (let i = 0; i < 2; i++) G.autoflight.adjust('spd', 1);
  for (let i = 0; i < 9; i++) G.debug.advance(10, false);
  const e2 = err();
  return { plane, engaged: ok1, active: G.autoflight.active, want1, e1, e2, alive: p.alive, errors: { ...G.errors } };
}

function tNav() {
  const G = window.__G;
  const ap = G.world.airportById.yasny, dst = G.world.airportById.gavan;
  G.startFlight({ planeId: 'yak52', air: { x: ap.x, y: 450, z: ap.z, heading: 0, speed: 50 } });
  const p = G.player;
  G.debug.advance(1, false);
  G.autoflight.setDestination('gavan');
  const ok = G.autoflight.engage('nav');
  let t = 0, minClear = 1e9, d = 1e9, reached = -1;
  while (t < 600 && p.alive) {
    G.debug.advance(5, false); t += 5;
    minClear = Math.min(minClear, p.pos.y - Math.max(0, G.world.heightAt(p.pos.x, p.pos.z)));
    d = Math.hypot(dst.x - p.pos.x, dst.z - p.pos.z);
    if (d < 4000 && reached < 0) { reached = t; break; }
  }
  return { engaged: ok, reached, dist: Math.round(d), minClear: Math.round(minClear), alive: p.alive, mode: G.autoflight.mode, tag: document.querySelector('.af-dest')?.textContent };
}

function tLand({ plane, apId, startDist, fromNav }) {
  const G = window.__G;
  const a = G.world.airportById[apId];
  const radios = [];
  const off = G.bus.on('radio', (e) => radios.push(e.from + ': ' + e.text));
  let crash = null;
  const off2 = G.bus.on('ac:crash', (e) => { if (e.ac === G.player) crash = e.reason; });
  if (!fromNav) {
    const h = 2.4; // подлёт с юго-востока, не по оси
    G.startFlight({ planeId: plane, air: { x: a.x + Math.sin(h) * startDist, y: a.elevation + 900, z: a.z - Math.cos(h) * startDist, heading: h + Math.PI } });
    G.debug.advance(1, false);
  }
  const p = G.player;
  const ok = G.autoflight.engage('approach', { airportId: apId });
  let t = 0, minClear = 1e9, phases = [], last = '', td = null;
  const off3 = G.bus.on('ac:touchdown', (e) => { if (e.ac === p && !td) td = { vs: +e.vs.toFixed(2), surface: e.surface, across: e.across != null ? +e.across.toFixed(1) : null }; });
  while (t < 900 && p.alive && G.autoflight.active) {
    G.debug.advance(2, false); t += 2;
    if (!p.onGround) minClear = Math.min(minClear, p.pos.y - p.spec.gearHeight - Math.max(0, G.world.groundAt(p.pos.x, p.pos.z).y));
    const ph = G.autoflight.approach && G.autoflight.approach.phase;
    if (ph && ph !== last) { phases.push(ph + '@' + t); last = ph; }
  }
  G.debug.advance(3, false);
  off(); off2(); off3();
  return {
    plane, apId, engaged: ok, t, phases: phases.join(' '), active: G.autoflight.active, alive: p.alive, crash,
    onGround: p.onGround, surface: p.surface, kmh: +(p.gs * 3.6).toFixed(1), minClear: +minClear.toFixed(1), td, hp: p.hp,
    radios: radios.slice(0, 8),
  };
}

function tStick() {
  const G = window.__G;
  G.startFlight({ planeId: 'l39', air: { x: -3000, y: 1200, z: 0, heading: 1, speed: 120 } });
  G.debug.advance(1, false);
  const ok = G.autoflight.engage('hold');
  G.debug.advance(3, false);
  const before = G.autoflight.active;
  const toasts = [];
  const orig = G.hud.toast;
  G.hud.toast = (t, k) => { toasts.push(t); return orig.call(G.hud, t, k); };
  G.input.raw.stickX = 0.6; G.input.raw.stickHeld = true;
  G.debug.advance(0.5, false);
  G.input.raw.stickX = 0; G.input.raw.stickHeld = false;
  G.hud.toast = orig;
  const after = G.autoflight.active;
  // РУД: автомат тяги отдаёт тягу
  G.autoflight.engage('hold');
  G.debug.advance(1, false);
  G.input.setThrottle(0.2);
  G.debug.advance(0.5, false);
  const athr = G.autoflight.athr, still = G.autoflight.active;
  // на земле не включается
  G.startFlight({ planeId: 'yak52', airportId: 'yasny' });
  G.debug.advance(1, false);
  const ground = G.autoflight.engage('hold', { silent: true });
  return { engaged: ok, before, after, toast: toasts.join(' | '), athrAfterThr: athr, stillActive: still, groundEngage: ground };
}

function tPark() {
  const G = window.__G;
  const radios = [];
  const off = G.bus.on('radio', (e) => radios.push(e.from + ': ' + e.text));
  const a = G.world.airportById.yasny;
  G.startFlight({ planeId: 'yak52', airportId: 'yasny', parking: a.parking.findIndex((q) => q.size === 'S') });
  G.debug.advance(1, false);
  const p = G.player, af = G.autoflight;
  const X = af.taxi;
  const res = { surface: p.surface, onGround: p.onGround, route: X && X.points.length, name: X && X.name, left: X && Math.round(X.left) };
  const end = X && X.points[X.points.length - 1];
  res.endIsStart = !!(end && Math.hypot(end.x - X.start.x, end.z - X.start.z) < 1);
  res.tower1 = af.towerAction() && af.towerAction().id;
  af.requestTower();
  G.debug.advance(1, false);
  res.tower2 = af.towerAction() && af.towerAction().id;
  // прокатимся по маршруту: ставим самолёт в точки маршрута (на земле)
  for (const q of X.points) {
    p.pos.x = q.x; p.pos.z = q.z; p.vel.set(0, 0, 0);
    G.debug.advance(0.3, false);
  }
  res.taxiDone = X.done;
  res.tower3 = af.towerAction() && af.towerAction().id;
  af.requestTower();
  G.debug.advance(1, false);
  off();
  res.radios = radios;
  res.dots = document.querySelectorAll('.af-dots i[style*="block"]').length;
  return res;
}

function tTower() {
  const G = window.__G;
  const radios = [];
  const off = G.bus.on('radio', (e) => radios.push(e.from + ': ' + e.text));
  const a = G.world.airportById.gavan;
  G.startFlight({ planeId: 'l410', air: { x: a.x - 9000, y: 900, z: a.z + 2000, heading: 1.4, speed: 80 } });
  G.debug.advance(45, false);
  const act = G.autoflight.towerAction();
  G.autoflight.requestTower();
  G.debug.advance(1, false);
  off();
  return { act: act && act.id, dest: G.autoflight.destination && G.autoflight.destination.name, radios };
}

function tCheck() {
  const G = window.__G;
  const seen = [];
  G.startFlight({ planeId: 'yak52', airportId: 'yasny' });
  for (let i = 0; i < 10; i++) { G.debug.advance(1, false); if (G.autoflight.checkOn) { seen.push(G.autoflight.checklist.text); break; } }
  G.player.flaps = 0.5;
  G.debug.advance(1, false);
  const gone = !G.autoflight.checkOn;
  return { seen, gone };
}

(async () => {
  const file = path.resolve(dist, 'index.html');
  if (!fs.existsSync(file)) { console.error('нет ' + file + ' — соберите: node build.mjs --out ' + dist); process.exit(2); }
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  const consoleErr = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load/.test(m.text())) consoleErr.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErr.push('pageerror: ' + String(e).slice(0, 300)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('file://' + file);
  await page.waitForFunction(() => window.__G && window.__G.mode !== 'boot', null, { timeout: 60000 });
  await page.evaluate(() => { window.__G.debug.manual = true; });
  let bad = 0;
  const check = (name, ok, info) => { if (!ok) bad++; console.log(`${ok ? 'ок    ' : 'ОШИБКА'} ${name.padEnd(30)} ${info}`); };

  if (want('hold')) {
    for (const plane of ['yak52', 'tu154', 'mig29']) {
      const r = await page.evaluate(tHold, plane);
      const good = (e) => Math.abs(e.hdg) < 3 && Math.abs(e.alt) < 30 && Math.abs(e.spd) < 15;
      check(`удержание ${plane} 60 с`, r.engaged && r.active && good(r.e1), `уставки ${JSON.stringify(r.want1)} ошибка ${JSON.stringify(r.e1)}`);
      check(`удержание ${plane} после ±`, r.active && good(r.e2), `ошибка ${JSON.stringify(r.e2)} ${JSON.stringify(r.errors)}`);
    }
  }
  if (want('nav')) {
    const r = await page.evaluate(tNav);
    check('автопилот туда Тирасполь→Бендеры', r.engaged && r.reached > 0 && r.alive && r.minClear > 100, `за ${r.reached} с, осталось ${r.dist} м, мин. запас над рельефом ${r.minClear} м · «${r.tag}»`);
    if (want('land')) {
      const l = await page.evaluate(tLand, { plane: 'yak52', apId: 'gavan', startDist: 0, fromNav: true });
      check('автопосадка yak52 в Бендерах', !l.active && l.alive && !l.crash && l.onGround && l.surface === 'runway' && l.kmh < 3 && l.minClear > -0.5, `${l.t} с · ${l.phases} · касание ${JSON.stringify(l.td)} · ${l.kmh} км/ч · мин. высота колёс ${l.minClear} м`);
      console.log('       радио: ' + l.radios.join(' | '));
    }
  }
  if (want('land')) {
    for (const [plane, ap, d] of [['tu154', 'yasny', 16000], ['mig29', 'kamenny', 14000], ['an2', 'mayak', 8000]]) {
      const l = await page.evaluate(tLand, { plane, apId: ap, startDist: d, fromNav: false });
      check(`автопосадка ${plane} → ${ap}`, !l.active && l.alive && !l.crash && l.onGround && l.surface === 'runway' && l.kmh < 3 && l.minClear > -0.5, `${l.t} с · ${l.phases} · касание ${JSON.stringify(l.td)} · ${l.kmh} км/ч · ${l.surface} · мин. высота колёс ${l.minClear} м${l.crash ? ' АВАРИЯ ' + l.crash : ''}`);
    }
  }
  if (want('stick')) {
    const r = await page.evaluate(tStick);
    check('ручка отключает автопилот', r.engaged && r.before && !r.after && /управление у тебя/.test(r.toast), `было ${r.before} → стало ${r.after} · «${r.toast}»`);
    check('РУД отключает автомат тяги', r.stillActive && !r.athrAfterThr, `АП ${r.stillActive}, автомат тяги ${r.athrAfterThr}`);
    check('на земле не включается', r.groundEngage === false, String(r.groundEngage));
  }
  if (want('park')) {
    const r = await page.evaluate(tPark);
    check('старт со стоянки + руление', r.onGround && r.surface === 'apron' && r.route >= 2 && r.endIsStart && r.taxiDone, `поверхность ${r.surface}, точек ${r.route}, полоса ${r.name}, до старта ${r.left} м, меток на экране ${r.dots}`);
    check('вышка: руление → взлёт', r.tower1 === 'taxi' && r.tower2 === null && r.tower3 === 'takeoff', `${r.tower1} → ${r.tower2} → ${r.tower3}`);
    console.log('       радио: ' + r.radios.join(' | '));
  }
  if (want('tower')) {
    const r = await page.evaluate(tTower);
    check('вышка: запрос посадки', r.act === 'landing' && !!r.dest, `цель ${r.dest}`);
    console.log('       радио: ' + r.radios.join(' | '));
  }
  if (want('check')) {
    const r = await page.evaluate(tCheck);
    check('чек-лист перед взлётом', r.seen.length === 1 && r.gone, `${JSON.stringify(r.seen)} исчез после выполнения: ${r.gone}`);
  }
  await page.evaluate(() => window.__G.toMenu());
  const errs = await page.evaluate(() => window.__G.errors);
  const nErr = Object.keys(errs).length;
  console.log(`\nИтого ошибок проверок: ${bad}. Ошибки модулей: ${JSON.stringify(errs)}. Ошибок консоли: ${consoleErr.length}`);
  if (consoleErr.length) console.log(consoleErr.slice(0, 5).join('\n'));
  await browser.close();
  process.exit(bad || nErr || consoleErr.length ? 1 : 0);
})();
