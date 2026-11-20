#!/usr/bin/env node
// Проверка заданий: для каждого — старт и 12 с полёта без ошибок, затем «дымовой прогон» до успеха
// (телепорты, искусственные события посадки/фигур, G.combat.damage) с ожиданием flight:end { success, stars }.
//   node tools/missions-test.cjs [--dist out/missions] [--only id1,id2]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
let dist = 'out/missions', only = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dist') dist = argv[++i];
  else if (argv[i] === '--only') only = argv[++i].split(',');
}

// код, исполняемый в странице: драйвер дымового прогона
function pageDriver(id) {
  const G = window.__G;
  const log = [];
  const adv = (s) => G.debug.advance(s, false);
  const p = () => G.player;
  const tp = (x, y, z, heading, speed) => { G.debug.teleport({ x, y, z, heading: heading ?? p().heading, speed: speed ?? p().spec.vCruise }); p().gearDown = false; };
  const toward = (x, z) => Math.atan2(x - p().pos.x, -(z - p().pos.z));
  const fakeLand = (apId) => {
    const ap = G.world.airportById[apId], rw = ap.runways[0], ac = p();
    const e = { ac, vs: -0.7, speed: ac.spec.vApproach || 50, surface: 'runway', airport: ap, runway: rw, across: 1.5, along: -rw.length / 2 + rw.length * 0.15, bounce: 0, first: true };
    ac.vel.set(Math.sin(rw.heading) * 50, -0.7, -Math.cos(rw.heading) * 50);
    G.bus.emit('ac:touchdown', e);
    G.bus.emit('ac:stopped', { ac, surface: 'runway', airport: ap, runway: rw, along: 0, across: 1, rollout: 600, bounces: 0, touchdown: e });
  };
  let end = null;
  const off = G.bus.on('flight:end', (e) => { end = e.result; });
  G.startFlight({ missionId: id });
  adv(1);
  const custom = {
    first_flight(m, st) {
      if (m.index === 0) { G.input.setThrottle(1); G.debug.hold({ throttle: 1 }); adv(2); return; }
      if (m.index === 1) { tp(p().pos.x + 300, p().pos.y + 60, p().pos.z, p().heading, 50); p().gearDown = true; return; }
      if (m.index === 2) { p().gearDown = false; return; }
      if (m.index === 5) { p().gearDown = true; p().flaps = 1; return; }
      if (m.index === 7) { const ap = G.world.airportById.yasny; G.bus.emit('ac:touchdown', { ac: p(), vs: -0.8, speed: 40, surface: 'runway', airport: ap, runway: ap.runways[0], across: 1, along: -1100, bounce: 0 }); }
    },
    aero_school(m) { if (m.data.want) G.bus.emit('trick:done', { id: m.data.want, name: m.data.want, score: 100, ac: p() }); adv(2.5); },
    fire_resort(m, st) {
      if (st.id === 'scoop') { p().payload = 12000; tp(p().pos.x, Math.max(p().pos.y, 120), p().pos.z, p().heading, 80); return; }
      if (st.id === 'drop') {
        const f = m.data.fires.find((x) => x.alive);
        if (!f) return;
        tp(f.x, f.y + 60, f.z, 0, 0.5);
        G.bus.emit('input:action', { id: 'drop' });
        adv(2);
      }
    },
    chkalov(m, st) {
      if (st.id === 'pass') { const g = m.mission.geo(G.world); tp(g.mid, 18, g.bz - 250, Math.PI, 60); adv(6); }
    },
    range_l39(m, st) {
      for (const t of m.data[st.id] || []) {
        if (t.alive === false) continue;
        if (t.virtual) t.alive = false; else G.combat.damage(t, 9999, G.player);
      }
    },
    intercept(m, st) {
      const b = m.data.bad;
      if (!b) return;
      if (m.index === 1 || m.index === 2) {
        const h = b.heading;
        tp(b.pos.x - Math.sin(h) * 700, b.pos.y, b.pos.z + Math.cos(h) * 700, h, b.tas);
        if (m.index === 2) { m.data.rock.n = 3; m.data.rock.t = m.t; }
        return;
      }
      if (m.index === 3) {
        G.combat.damage(b, 9999, G.player);
        adv(0.5);
        if (!m.data.killed) G.bus.emit('ac:destroyed', { ac: b, by: G.player });
      }
    },
  };
  for (let i = 0; i < 80 && G.mode === 'flight' && !end; i++) {
    const r = G.missions.active;
    if (!r) { log.push('нет активного задания'); break; }
    const m = r.m, st = m.step;
    if (m.ended || !st) { adv(1); continue; }
    log.push(`${m.index}:${st.kind || st.id || '-'}`);
    if (custom[id] && (!st.kind || st.kind === 'none')) custom[id](m, st);
    else if (st.kind === 'takeoff') tp(p().pos.x, p().pos.y + 150, p().pos.z, p().heading, p().spec.vCruise);
    else if (st.kind === 'reach') {
      const q = st.pt;
      let y = q.y ?? Math.max(0, G.world.heightAt(q.x, q.z)) + 300;
      if (q.maxAlt != null) y = Math.min(y, q.maxAlt - 20);
      tp(q.x, y, q.z, toward(q.x, q.z), p().spec.vCruise);
    } else if (st.kind === 'land') fakeLand(st.ap);
    else if (custom[id]) custom[id](m, st);
    adv(0.6);
  }
  for (let i = 0; i < 8 && G.mode === 'flight' && !end; i++) adv(1);
  off();
  G.debug.hold(null);
  return { end: end && { reason: end.reason, success: end.success, stars: end.stars, title: end.title, text: end.text, payout: end.payout && end.payout.money }, log: log.join(' '), mode: G.mode };
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
  const ids = await page.evaluate(() => window.__G.missions.list.map((m) => m.id));
  const rows = [];
  for (const id of ids) {
    if (only && !only.includes(id)) continue;
    const before = consoleErr.length;
    let row = { id, start: '?', smoke: '?' };
    try {
      const s = await page.evaluate((id) => {
        const G = window.__G;
        G.startFlight({ missionId: id });
        const objs = [];
        const off = G.bus.on('mission:objective', (e) => objs.push(e.text));
        const radios = [];
        const off2 = G.bus.on('radio', (e) => radios.push(e.from + ': ' + e.text));
        for (let i = 0; i < 12; i++) G.debug.advance(1, i === 11);
        off(); off2();
        const r = G.missions.active;
        return { plane: G.player && G.player.specId, mode: G.mode, active: !!r, step: r && r.m.index, obj: document.querySelector('.hud-obj span')?.textContent, radios: radios.length, errors: { ...G.errors } };
      }, id);
      const errs = Object.keys(s.errors).length;
      row.start = s.active && s.mode === 'flight' && !errs ? 'ок' : `ошибка (${s.mode}, ${JSON.stringify(s.errors)})`;
      row.info = `${s.plane}, шаг ${s.step}, радио ${s.radios}, цель «${s.obj || ''}»`;
      const r = await page.evaluate(pageDriver, id);
      const e = r.end;
      row.smoke = e && e.success && e.stars >= 1 ? `ок ★${e.stars}` : `ошибка: ${e ? e.reason + ' ' + e.title : 'нет flight:end'} [${r.log}]`;
      row.text = e ? `${e.title} — ${e.text}${e.payout != null ? ` (+${e.payout} ₽)` : ''}` : '';
      await page.evaluate(() => { window.__G.toMenu(); });
    } catch (err) {
      row.smoke = 'исключение: ' + String(err.message).slice(0, 200);
    }
    if (consoleErr.length > before) row.console = consoleErr.slice(before).join(' | ');
    rows.push(row);
    console.log(`${id.padEnd(16)} старт: ${row.start.padEnd(6)} прогон: ${row.smoke}`);
    console.log(`${''.padEnd(16)} ${row.info || ''}`);
    if (row.text) console.log(`${''.padEnd(16)} ${row.text}`);
    if (row.console) console.log(`${''.padEnd(16)} консоль: ${row.console}`);
  }
  // провал: удар о пролёт моста в «Чкаловском пролёте» -> mission_failed
  if (!only || only.includes('chkalov')) {
    const f = await page.evaluate(() => {
      const G = window.__G;
      let end = null;
      const off = G.bus.on('flight:end', (e) => { end = e.result; });
      G.startFlight({ missionId: 'chkalov' });
      G.debug.advance(1, false);
      const m = G.missions.active.m, g = m.mission.geo(G.world);
      G.debug.teleport({ x: g.mid, y: 150, z: g.bz - 300, heading: Math.PI, speed: 60 });
      m.goto('pass');
      G.debug.teleport({ x: g.mid, y: 38, z: g.bz - 120, heading: Math.PI, speed: 60 });
      for (let i = 0; i < 8 && !end; i++) G.debug.advance(1, false);
      off();
      G.toMenu();
      return end && { reason: end.reason, success: end.success, title: end.title };
    });
    const ok = f && f.reason === 'mission_failed' && f.success === false;
    console.log(`${'провал-тест'.padEnd(16)} ${ok ? 'ок' : 'ошибка'} — ${f ? f.title : 'нет flight:end'}`);
    if (!ok) rows.push({ start: 'ошибка', smoke: 'провал-тест' });
  }
  const errs = await page.evaluate(() => window.__G.errors);
  const bad = rows.filter((r) => r.start !== 'ок' || !r.smoke.startsWith('ок')).length;
  console.log(`\nИтого: ${rows.length - bad}/${rows.length} заданий ок. Ошибки модулей: ${JSON.stringify(errs)}. Ошибок консоли: ${consoleErr.length}`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
