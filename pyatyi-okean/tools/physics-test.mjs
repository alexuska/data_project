#!/usr/bin/env node
// Тесты лётной модели и автопилота: node tools/physics-test.mjs [id самолёта] [--v]
// Мок-мир: плоская земля, одна полоса (курс 0 = на север), опционально вода или авианосец.
// Для каждого самолёта каталога: разбег и отрыв, скороподъёмность, Vmax, сваливание, «руки убраны», вираж 360°,
// оборот по крену, посадка автопилотом, планирование без двигателя, запас топлива. Плюс особые случаи.
import { Vector3 } from 'three';
import { CATALOG } from '../src/aircraft/catalog.js';
import { createAircraft, placeAircraft, stepAircraft } from '../src/aircraft/physics.js';
import { apHold, apTakeoff, apLand, apFlyTo, apFollow, apPursue } from '../src/aircraft/autopilot.js';

const DT = 1 / 60, DEG = Math.PI / 180;
const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('-'));
const verbose = args.includes('--v');

function makeWorld(o = {}) {
  const elev = o.elev ?? 100;
  const rw = { name: '36', heading: 0, length: o.length || 3500, width: o.width || 60, cx: 0, cz: 0 };
  const airport = { id: 'test', kind: o.carrier ? 'carrier' : 'intl', elevation: elev, runways: [rw], x: 0, z: 0 };
  const world = {
    wind: new Vector3(), weather: { turbulence: 0, rain: 0 }, airport, rw,
    heightAt: () => (o.water || o.carrier ? -5 : elev),
    groundAt(x, z) {
      if (!o.water && Math.abs(x) <= rw.width / 2 && Math.abs(z) <= rw.length / 2) {
        return { y: elev, surface: o.carrier ? 'carrier' : 'runway', airport, runway: rw, along: -z, across: x };
      }
      return o.water || o.carrier ? { y: 0, surface: 'water' } : { y: elev, surface: 'ground' };
    },
    runwayStart() { return { x: 0, y: elev, z: rw.length / 2 - Math.min(60, rw.length * 0.08), heading: 0, airport, runway: rw }; },
  };
  return world;
}
function makeEnv(o) {
  const world = makeWorld(o);
  const events = [];
  return { world, events, bus: { emit(t, p) { events.push({ t, ...p }); } }, of(t) { return events.filter((e) => e.t === t); } };
}
function onRunway(env, id, assist = true) {
  const ac = createAircraft(id, { isPlayer: true });
  ac.assist = assist;
  const st = env.world.runwayStart();
  placeAircraft(ac, { x: st.x, y: st.y + ac.spec.gearHeight, z: st.z, heading: 0, speed: 0, onGround: true });
  return ac;
}
function inAir(env, id, { alt = 1000, speed, x = 0, z = 0, heading = 0, assist = true } = {}) {
  const ac = createAircraft(id, { isPlayer: true });
  ac.assist = assist;
  placeAircraft(ac, { x, y: alt, z, heading, speed: speed ?? ac.spec.vCruise });
  return ac;
}
// крутить симуляцию; fn(t) — управление до шага; вернёт false — стоп
function run(ac, env, sec, fn) {
  const n = Math.round(sec / DT);
  let t = 0;
  for (let i = 0; i < n && ac.alive; i++, t += DT) {
    if (fn && fn(t) === false) break;
    stepAircraft(ac, env, DT);
  }
  return t;
}
const fails = [];
function check(id, name, ok, text) {
  if (!ok) fails.push(`${id}: ${name} — ${text}`);
  return ok ? '' : '!';
}
const f0 = (v) => (Number.isFinite(v) ? v.toFixed(0) : '—');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');

// ---------- отдельные проверки ----------
function tTakeoff(s) {
  const env = makeEnv({ length: 6000 });
  const ac = onRunway(env, s.id);
  const z0 = ac.pos.z;
  let lift = null, phase = '';
  run(ac, env, 150, () => {
    phase = apTakeoff(ac, DT);
    if (!lift && !ac.onGround) lift = { d: z0 - ac.pos.z, v: ac.ias };
    return phase !== 'done';
  });
  const r = { run: lift ? lift.d : NaN, v: lift ? lift.v : NaN, ok: phase === 'done' && ac.alive, xErr: Math.abs(ac.pos.x) };
  r.flag = check(s.id, 'взлёт', r.ok && r.run > 0.5 * s.takeoffRun && r.run < 1.6 * s.takeoffRun && r.v < 1.45 * s.vStall && r.xErr < 60,
    `разбег ${f0(r.run)} м (паспорт ${s.takeoffRun}), отрыв ${f1(r.v)} м/с, фаза ${phase}, увод ${f0(r.xErr)} м, ${env.of('ac:crash').map((e) => e.reason)}`);
  return r;
}
function tClimb(s) {
  const env = makeEnv();
  const ac = inAir(env, s.id, { alt: 400, speed: s.vClimb });
  let roc = 0, aPrev = ac.alt, k = 0;
  const tgt = { heading: 0, speed: s.vClimb, throttle: 1 };
  // лучшая установившаяся вертикальная (среднее за 4 с), как в паспорте — у земли
  run(ac, env, 40, (t) => { apHold(ac, tgt, DT); if (++k % 240 === 0) { if (t > 7) roc = Math.max(roc, (ac.alt - aPrev) / 4); aPrev = ac.alt; } });
  return { roc, v: ac.ias, flag: check(s.id, 'набор', ac.alive && roc > 0.6 * s.climb && roc < 1.8 * s.climb && Math.abs(ac.ias - s.vClimb) < 0.2 * s.vClimb, `Vy ${f1(roc)} м/с (паспорт ${s.climb}), скорость ${f1(ac.ias)} (нужно ${s.vClimb})`) };
}
function tVmax(s) {
  const env = makeEnv({ elev: 0 });
  const ac = inAir(env, s.id, { alt: 150, speed: s.vMax * 0.85 });
  const tgt = { heading: 0, alt: 150, throttle: 1 };
  let prev = 0, v = 0;
  run(ac, env, 400, (t) => {
    apHold(ac, tgt, DT);
    if (t > 30 && Math.abs((t % 10)) < DT / 2) { if (Math.abs(ac.tas - prev) < 0.05) return false; prev = ac.tas; }
  });
  v = ac.tas;
  return { v, flag: check(s.id, 'Vmax', ac.alive && Math.abs(v / s.vMax - 1) < 0.07 && Math.abs(ac.alt - 150) < 40, `${f1(v)} м/с (паспорт ${s.vMax}), высота ${f0(ac.alt)}`) };
}
function tStall(s) {
  // без помощи: малый газ, держим высоту, пока не сорвётся
  const env = makeEnv();
  const ac = inAir(env, s.id, { alt: 2000, speed: s.vStall * 1.4, assist: false });
  let I = 0, vSt = NaN, minAlt = 2000, rec = NaN, warnV = NaN;
  ac.controls.throttle = 0;
  const t1 = run(ac, env, 120, () => {
    I = Math.max(0, Math.min(1, I - ac.vs * 0.06 * DT));
    ac.controls.pitch = Math.max(-0.2, Math.min(1, I - 0.08 * ac.vs));
    if (Number.isNaN(warnV) && ac.stallWarn > 0.3) warnV = ac.ias;
    if (ac.stalled) { vSt = ac.ias; return false; }
  });
  // вывод: отдать ручку, дать газ
  const hSt = ac.alt;
  run(ac, env, 25, (t) => {
    ac.controls.pitch = t < 1.5 ? -0.3 : ac.pitch < -0.02 && ac.ias > 1.25 * s.vStall ? 0.35 : 0;
    ac.controls.throttle = 1;
    minAlt = Math.min(minAlt, ac.alt);
    if (Number.isNaN(rec) && !ac.stalled && ac.ias > 1.2 * s.vStall && ac.vs > -1) { rec = t; return false; }
  });
  // с помощью: ручка полностью на себя 25 с — срыва быть не должно
  const env2 = makeEnv();
  const b = inAir(env2, s.id, { alt: 2000, speed: s.vStall * 1.4 });
  b.controls.throttle = 0;
  let minV = 999, maxBank = 0;
  run(b, env2, 25, () => { b.controls.pitch = 1; minV = Math.min(minV, b.ias); maxBank = Math.max(maxBank, Math.abs(b.bank)); });
  const stallsA = env2.of('ac:stall').length;
  const r = { v: vSt, warnV, loss: hSt - minAlt, rec, minV, t1 };
  r.flag = check(s.id, 'сваливание', Math.abs(vSt / s.vStall - 1) < 0.12 && warnV > vSt && rec < 20 && ac.alive, `срыв на ${f1(vSt)} м/с (паспорт ${s.vStall}), предупреждение с ${f1(warnV)}, вывод ${f1(rec)} с, потеря ${f0(r.loss)} м`)
    + check(s.id, 'защита от сваливания', stallsA === 0 && b.alive && maxBank < 0.2 && minV > 0.72 * s.vStall, `с помощью: срывов ${stallsA}, мин. скорость ${f1(minV)}, крен до ${f1(maxBank / DEG)}°`);
  return r;
}
function tHandsOff(s) {
  const out = {};
  for (const assist of [true, false]) {
    const env = makeEnv();
    const ac = inAir(env, s.id, { alt: 1500, assist });
    ac.controls.throttle = ac.aero.thrCruise;
    let aMin = 1e9, aMax = -1e9, vMin = 1e9, vMax = 0, e0 = 1e9, e1 = -1e9, l0 = 1e9, l1 = -1e9;
    run(ac, env, 100, (t) => {
      // на 5-й секунде — возмущение: короткий рывок ручки на себя и вбок, потом руки убраны
      ac.controls.pitch = t > 5 && t < 6 ? 0.15 : 0;
      ac.controls.roll = t > 5 && t < 5.3 ? 0.25 / Math.max(1, s.rollRate) : 0;
      if (t > 8) {
        aMin = Math.min(aMin, ac.alt); aMax = Math.max(aMax, ac.alt); vMin = Math.min(vMin, ac.ias); vMax = Math.max(vMax, ac.ias);
        if (t < 40) { e0 = Math.min(e0, ac.vs); e1 = Math.max(e1, ac.vs); } else if (t > 70) { l0 = Math.min(l0, ac.vs); l1 = Math.max(l1, ac.vs); }
      }
    });
    const r = { dAlt: aMax - aMin, dV: (vMax - vMin) / s.vCruise, late: l1 - l0, early: e1 - e0, bank: Math.abs(ac.bank) };
    // после возмущения колебания не растут: размах Vy в конце меньше, чем в начале (или пренебрежимо мал)
    const ok = ac.alive && !ac.stalled && r.bank < 0.12 && r.dV < 0.4 && r.late < Math.max(assist ? 0.6 : 1.5, 0.6 * r.early);
    r.flag = check(s.id, assist ? 'руки убраны' : 'руки убраны (без помощи)', ok, `разброс высоты ${f0(r.dAlt)} м, скорости ${f0(r.dV * 100)}%, размах Vy ${f1(r.early)} → ${f1(r.late)}, крен ${f1(r.bank / DEG)}°`);
    out[assist ? 'on' : 'off'] = r;
  }
  // строго прямолинейный полёт 60 с
  const env = makeEnv();
  const ac = inAir(env, s.id, { alt: 1500 });
  ac.controls.throttle = ac.aero.thrCruise;
  run(ac, env, 60);
  out.level = { dAlt: ac.alt - 1500, dV: ac.tas - s.vCruise };
  out.flag = out.on.flag + out.off.flag + check(s.id, 'прямолинейный полёт 60 с', Math.abs(out.level.dAlt) < 25 && Math.abs(ac.bank) < 0.02 && Math.abs(ac.heading > Math.PI ? ac.heading - 2 * Math.PI : ac.heading) < 0.02, `уход высоты ${f1(out.level.dAlt)} м, крен ${f1(ac.bank / DEG)}°`);
  return out;
}
function tTurn(s) {
  const env = makeEnv();
  const v0 = Math.min(s.vCruise, Math.max(1.9 * s.vStall, 0.6 * s.vMax));
  const ac = inAir(env, s.id, { alt: 1500, speed: v0 });
  const bank = Math.min(55 * DEG, (s.bankLimit || 9) - 3 * DEG);
  const tgt = { bank, alt: 1500, speed: v0 };
  const tIdeal = (2 * Math.PI * v0) / (9.81 * Math.tan(bank));
  let turned = 0, hPrev = 0, vMin = 999, dAlt = 0, done = NaN;
  run(ac, env, 200, (t) => {
    apHold(ac, tgt, DT);
    let d = ac.heading - hPrev; if (d < -Math.PI) d += 2 * Math.PI; if (d > Math.PI) d -= 2 * Math.PI;
    turned += d; hPrev = ac.heading;
    vMin = Math.min(vMin, ac.ias); dAlt = Math.max(dAlt, Math.abs(ac.alt - 1500));
    if (turned >= 2 * Math.PI) { done = t; return false; }
  });
  const r = { t: done, bank: bank / DEG, loss: v0 - vMin, dAlt, g: ac.g };
  r.flag = check(s.id, 'вираж 360°', done < tIdeal * 1.25 + 8 && done > tIdeal * 0.7 && dAlt < 60 && env.of('ac:stall').length === 0 && ac.alive, `время ${f1(done)} с, крен ${f0(r.bank)}°, потеря скорости ${f1(r.loss)} м/с, уход высоты ${f0(dAlt)} м`);
  return r;
}
function tRoll(s) {
  const env = makeEnv();
  const ac = inAir(env, s.id, { alt: 2500, assist: false });
  ac.controls.throttle = ac.aero.thrCruise;
  let ang = 0, done = NaN;
  run(ac, env, 40, (t) => {
    ac.controls.roll = 1;
    ang += -ac.angVel.z * DT;
    if (ang >= 2 * Math.PI) { done = t; return false; }
  });
  const ideal = (2 * Math.PI) / s.rollRate;
  return { t: done, flag: check(s.id, 'оборот по крену', done < ideal * 1.5 + 1 && done > ideal * 0.9, `${f1(done)} с (идеал ${f1(ideal)})`) };
}
function landing(id, o = {}) {
  const env = makeEnv(o.world);
  const s = createAircraft(id).spec;
  const elev = env.world.airport.elevation;
  const ac = inAir(env, id, { alt: elev + (o.alt ?? 450), speed: 1.5 * s.vApproach, x: o.x ?? 500, z: o.z ?? 9000, heading: o.heading ?? 0 });
  if (o.wind) env.world.wind.set(o.wind[0], 0, o.wind[1]);
  if (o.turb) env.world.weather.turbulence = o.turb;
  const tgt = env.world.runwayStart();
  let phase = '', tStop = NaN;
  run(ac, env, o.time || 600, (t) => { phase = apLand(ac, tgt, DT); if (phase === 'stopped') { tStop = t; return false; } });
  const td = env.of('ac:touchdown');
  const first = td[0];
  const g = env.world.groundAt(ac.pos.x, ac.pos.z);
  return { env, ac, phase, td, first, vs: first ? first.vs : NaN, speed: first ? first.speed : NaN, along: first ? first.along : NaN, across: first ? first.across : NaN,
    roll: first ? Math.hypot(ac.pos.x - first.ac.pos.x, 0) + Math.abs((first.along ?? 0) - (g.along ?? 0)) : NaN, surface: g.surface, bounces: ac.bounces, tStop, crash: env.of('ac:crash').map((e) => e.reason).join(',') };
}
function tLanding(s) {
  const r = landing(s.id);
  const ok = r.phase === 'stopped' && r.ac.alive && r.first && r.vs > -3 && r.first.surface === 'runway' && r.surface === 'runway' && r.ac.hp >= 99 && Math.abs(r.across) < 12;
  r.flag = check(s.id, 'посадка apLand', ok, `фаза ${r.phase}, Vy касания ${f1(r.vs)}, скорость ${f1(r.speed)}, от оси ${f1(r.across)} м, пробег ${f0(r.roll)} м, поверхность ${r.surface}, hp ${f0(r.ac.hp)}, подскоков ${r.bounces}, авария: ${r.crash || 'нет'}`);
  return r;
}
function tGlide(s) {
  const env = makeEnv();
  const vG = Math.max(s.vStall * 1.25, createAircraft(s.id).aero.vGlide);
  const ac = inAir(env, s.id, { alt: 3000, speed: vG });
  ac.engineOn = false;
  const tgt = { heading: 0, speed: vG, throttle: 0 };
  let a0 = 0, z0 = 0;
  run(ac, env, 70, (t) => { apHold(ac, tgt, DT); if (Math.abs(t - 30) < DT / 2) { a0 = ac.alt; z0 = ac.pos.z; } });
  const ld = (z0 - ac.pos.z) / (a0 - ac.alt);
  return { ld, vs: (ac.alt - a0) / 40, v: ac.ias, flag: check(s.id, 'планирование', ac.alive && ld > 0.75 * ac.aero.ldMax && ld < 1.15 * ac.aero.ldMax && Math.abs(ac.ias - vG) < 0.1 * vG && !ac.stalled, `качество ${f1(ld)} (расчёт ${f1(ac.aero.ldMax)}), скорость ${f1(ac.ias)} (нужно ${f1(vG)}), Vy ${f1((ac.alt - a0) / 40)}`) };
}

// ---------- прогон по каталогу ----------
const rows = [];
for (const s of CATALOG) {
  if (only && s.id !== only) continue;
  const aero = createAircraft(s.id).aero;
  const to = tTakeoff(s), cl = tClimb(s), vm = tVmax(s), st = tStall(s), ho = tHandsOff(s), tu = tTurn(s), ro = tRoll(s), la = tLanding(s), gl = tGlide(s);
  const fuelFlag = check(s.id, 'топливо', aero.endurance >= 28 && aero.endurance <= 75, `хватает на ${f0(aero.endurance)} мин крейсерского полёта`);
  rows.push({
    'самолёт': s.name,
    'разбег, м': f0(to.run) + to.flag, '(пасп.)': s.takeoffRun, 'отрыв': f0(to.v * 3.6) + '',
    'Vy, м/с': f1(cl.roc) + cl.flag, '(пасп.) ': s.climb,
    'Vmax': f0(vm.v * 3.6) + vm.flag, '(пасп.)  ': f0(s.vMax * 3.6),
    'срыв': f0(st.v * 3.6) + st.flag, '(пасп.)   ': f0(s.vStall * 3.6),
    'руки убр. ΔH': f0(ho.level.dAlt) + ho.flag,
    'вираж, с': f1(tu.t) + tu.flag, 'крен°': f0(tu.bank), '−V': f0(tu.loss * 3.6),
    'бочка, с': f1(ro.t) + ro.flag,
    'касание Vy': f1(la.vs) + la.flag, 'V кас.': f0(la.speed * 3.6), 'пробег': f0(la.roll),
    'K план.': f1(gl.ld) + gl.flag,
    'топл., мин': f0(aero.endurance) + fuelFlag,
  });
}
console.log('\nЛТХ по результатам тестов (скорости — км/ч):');
console.table(rows);

// ---------- особые случаи ----------
function special(name, fn) {
  if (only) return;
  let text;
  try { text = fn(); } catch (e) { text = null; fails.push(`${name}: исключение ${e.stack}`); }
  console.log(`  ${text === null ? '✗' : '✓'} ${name}${text ? ' — ' + text : ''}`);
}
const expect = (name, ok, text) => { if (!ok) fails.push(`${name}: ${text}`); return ok; };
console.log('\nОсобые случаи:');

special('Бе-200: взлёт с воды и посадка на воду', () => {
  const env = makeEnv({ water: true });
  const ac = createAircraft('be200', { isPlayer: true });
  placeAircraft(ac, { x: 0, y: ac.spec.hullHeight, z: 0, heading: 0, speed: 0, onGround: true });
  ac.gearDown = false; ac.gearPos = 0;
  let lift = NaN, ph = '';
  run(ac, env, 200, () => { ph = apTakeoff(ac, DT); if (Number.isNaN(lift) && !ac.onGround) lift = -ac.pos.z; return ph !== 'done'; });
  const okTo = expect('Бе-200 вода', ph === 'done' && ac.alive && lift > 400 && lift < 2200, `взлёт с воды: фаза ${ph}, разбег ${f0(lift)} м`);
  // посадка на воду вручную: снижение 2 м/с на скорости захода
  ac.flaps = 1; ac.gearDown = false;
  const tgt = { heading: 0, speed: ac.spec.vApproach, vs: -2.5 };
  let stopped = false;
  run(ac, env, 400, () => {
    if (ac.onGround) { ac.controls.throttle = 0; ac.controls.pitch = 0; ac.controls.roll = 0; ac.controls.brake = 1; if (ac.gs < 1) { stopped = true; return false; } }
    else { tgt.vs = ac.agl < 12 ? -Math.max(0.6, 0.3 * ac.agl) : -3; apHold(ac, tgt, DT); if (ac.agl < 5) ac.controls.throttle = 0; }
  });
  const td = env.of('ac:touchdown')[0];
  const ok = expect('Бе-200 вода', stopped && ac.alive && ac.onWater && td && td.surface === 'water' && ac.hp >= 99, `посадка на воду: жив ${ac.alive}, hp ${ac.hp}, касание ${td && f1(td.vs)}, ${env.of('ac:crash').map((e) => e.reason)}`);
  return okTo && ok ? `разбег по воде ${f0(lift)} м, касание ${f1(td.vs)} м/с на ${f0(td.speed * 3.6)} км/ч` : null;
});

special('сухопутный самолёт на воду — авария «water»', () => {
  const env = makeEnv({ water: true });
  const ac = inAir(env, 'yak52', { alt: 30, speed: 40 });
  run(ac, env, 60, () => { ac.controls.throttle = 0; });
  const cr = env.of('ac:crash')[0];
  return expect('вода', cr && cr.reason === 'water', `причина ${cr && cr.reason}`) ? '' : null;
});

for (const id of ['mig29', 'su27', 'l39', 'yak52']) {
  special(`авианосец: ${id} — катапульта и аэрофинишёр`, () => {
    const env = makeEnv({ carrier: true, length: 300, width: 40, elev: 18 });
    const ac = onRunway(env, id);
    let ph = '';
    run(ac, env, 120, () => { ph = apTakeoff(ac, DT); return ph !== 'done'; });
    const minAgl = ac.alive ? 1 : 0;
    if (!expect(`палуба ${id}`, ph === 'done' && ac.alive, `взлёт с палубы: фаза ${ph}, ${env.of('ac:crash').map((e) => e.reason)}`)) return null;
    const cat = env.of('ac:catapult').length;
    // посадка на палубу
    const r = landing(id, { world: { carrier: true, length: 300, width: 40, elev: 18 }, z: 7000, x: 200, alt: 300 });
    const ok = expect(`палуба ${id}`, r.phase === 'stopped' && r.ac.alive && r.surface === 'carrier' && r.vs > -6, `посадка: фаза ${r.phase}, Vy ${f1(r.vs)}, поверхность ${r.surface}, авария ${r.crash || 'нет'}, hp ${f0(r.ac.hp)}`);
    return ok && minAgl ? `катапульта ${cat ? 'сработала' : 'не нужна'}; касание ${f1(r.vs)} м/с на ${f0(r.speed * 3.6)} км/ч, трос ${r.first.arrested ? 'пойман' : 'нет'}, hp ${f0(r.ac.hp)}` : null;
  });
}

special('жёсткая посадка — «козёл» и урон, но не катастрофа; очень жёсткая — «hard»', () => {
  const res = [];
  for (const [id, vs, wantCrash] of [['tu154', -4.5, false], ['yak52', -5.5, false], ['tu154', -10, true], ['yak52', -12, true]]) {
    const env = makeEnv({ elev: 0 });
    const s = createAircraft(id).spec;
    const ac = inAir(env, id, { alt: s.gearHeight + 3, speed: s.vApproach });
    ac.gearDown = true; ac.gearPos = 1; ac.flaps = ac.flapsPos = 1;
    ac.vel.y = vs; ac.controls.throttle = 0;
    let touched = false;
    run(ac, env, 40, () => { if (ac.onGround) touched = true; if (!touched) ac.vel.y = vs; ac.controls.brake = ac.onGround ? 1 : 0; });
    const cr = env.of('ac:crash')[0], td = env.of('ac:touchdown');
    if (!expect('жёсткая посадка', wantCrash ? cr && cr.reason === 'hard' : !cr && ac.hp < 100 && ac.hp > 20 && td.length >= 2, `${id} Vy ${vs}: авария ${cr && cr.reason}, hp ${f0(ac.hp)}, касаний ${td.length}`)) return null;
    res.push(`${id} ${vs} м/с → ${cr ? 'авария ' + cr.reason : 'hp ' + f0(ac.hp) + ', касаний ' + td.length}`);
  }
  return res.join('; ');
});

special('посадка с убранным шасси — на брюхо, урон без взрыва', () => {
  const res = [];
  for (const id of ['yak52', 'tu154', 'mig29']) {
    const env = makeEnv({ elev: 0 });
    const s = createAircraft(id).spec;
    const ac = inAir(env, id, { alt: 6, speed: s.vApproach });
    ac.gearDown = false; ac.flaps = ac.flapsPos = 1;
    const tgt = { heading: 0, vs: -1, throttle: 0 };
    run(ac, env, 80, () => { if (!ac.onGround) apHold(ac, tgt, DT); else { ac.controls.pitch = 0; if (ac.gs < 0.5) return false; } });
    const cr = env.of('ac:crash')[0], td = env.of('ac:touchdown')[0];
    if (!expect('брюхо', !cr && ac.hp < 95 && ac.hp > 15 && td && td.gearDown === false, `${id}: авария ${cr && cr.reason}, hp ${f0(ac.hp)}`)) return null;
    res.push(`${id}: hp ${f0(ac.hp)}, скольжение ${f0(ac._rollout)} м`);
  }
  return res.join('; ');
});

special('аварии: крыло, нос, склон', () => {
  const cases = [['wing', (ac) => { ac.quat.setFromAxisAngle(new Vector3(0, 0, 1), 0.7); }], ['nose', (ac) => { ac.quat.setFromAxisAngle(new Vector3(1, 0, 0), -0.4); ac.vel.y = -8; }]];
  for (const [want, prep] of cases) {
    const env = makeEnv({ elev: 0 });
    const ac = inAir(env, 'l39', { alt: 4, speed: 60 });
    ac.gearDown = true; ac.gearPos = 1; ac.assist = false;
    prep(ac);
    run(ac, env, 10, () => { ac.controls.pitch = want === 'nose' ? -1 : 0; });
    const cr = env.of('ac:crash')[0];
    if (!expect('аварии', cr && cr.reason === want, `ждали ${want}, получили ${cr && cr.reason}`)) return null;
  }
  // склон горы
  const env = makeEnv({ elev: 0 });
  env.world.heightAt = (x, z) => Math.max(0, (-z - 500) * 0.6);
  env.world.groundAt = (x, z) => ({ y: env.world.heightAt(x, z), surface: 'ground' });
  const ac = inAir(env, 'an2', { alt: 120, speed: 50 });
  run(ac, env, 40);
  const cr = env.of('ac:crash')[0];
  return expect('аварии', cr && cr.reason === 'terrain', `склон: ${cr && cr.reason}`) ? '' : null;
});

special('посадка на грунт: Ан-2 — можно, Ту-154 — урон', () => {
  const res = [];
  for (const [id, fine] of [['an2', true], ['yak52', true], ['tu154', false]]) {
    const env = makeEnv({ elev: 0 });
    env.world.groundAt = () => ({ y: 0, surface: 'ground' });
    const s = createAircraft(id).spec;
    const ac = inAir(env, id, { alt: s.gearHeight + 8, speed: s.vApproach });
    ac.gearDown = true; ac.gearPos = 1; ac.flaps = ac.flapsPos = 1;
    const tgt = { heading: 0, vs: -1, throttle: 0 };
    run(ac, env, 120, () => { if (!ac.onGround) { tgt.vs = -Math.max(0.6, 0.3 * ac.agl); apHold(ac, tgt, DT); } else { ac.controls.pitch = 0; ac.controls.brake = 1; if (ac.gs < 0.5) return false; } });
    const cr = env.of('ac:crash')[0];
    if (!expect('грунт', !cr && (fine ? ac.hp >= 99 : ac.hp < 90), `${id}: авария ${cr && cr.reason}, hp ${f0(ac.hp)}`)) return null;
    res.push(`${id}: hp ${f0(ac.hp)}`);
  }
  return res.join('; ');
});

special('пустой бак: двигатель встаёт, самолёт планирует и управляется', () => {
  const env = makeEnv();
  const ac = inAir(env, 'l410', { alt: 1200 });
  ac.fuel = 2;
  const tgt = { heading: 0, speed: ac.aero.vGlide, throttle: 1 };
  run(ac, env, 60, () => apHold(ac, tgt, DT));
  const ev = env.of('ac:engine')[0];
  return expect('топливо', ev && ev.reason === 'fuel' && ac.throttle === 0 && ac.alive && ac.vs < -1 && ac.vs > -8 && !ac.stalled, `событие ${ev && ev.reason}, тяга ${ac.throttle}, Vy ${f1(ac.vs)}`) ? `Vy ${f1(ac.vs)} м/с на ${f0(ac.ias * 3.6)} км/ч` : null;
});

special('форсаж: тяга и расход', () => {
  const env = makeEnv();
  const a = inAir(env, 'mig29', { alt: 1000, speed: 250 }), b = inAir(env, 'mig29', { alt: 1000, speed: 250 });
  const ta = { heading: 0, alt: 1000, throttle: 0.9 }, tb = { heading: 0, alt: 1000, throttle: 1 };
  run(a, env, 30, () => apHold(a, ta, DT));
  run(b, env, 30, () => apHold(b, tb, DT));
  const fa = a.fuelMax - a.fuel, fb = b.fuelMax - b.fuel;
  return expect('форсаж', b.tas > a.tas + 25 && fb > 2.5 * fa && b.afterburner > 0.95 && a.afterburner === 0, `скорость ${f0(a.tas)} / ${f0(b.tas)}, расход ${f0(fa)} / ${f0(fb)} кг`) ? `максимал ${f0(a.tas * 3.6)} км/ч, форсаж ${f0(b.tas * 3.6)} км/ч за 30 с; расход ×${f1(fb / fa)}` : null;
});

special('повреждения: тяга и манёвренность падают', () => {
  const env = makeEnv();
  const a = inAir(env, 'su25', { alt: 1000 }), b = inAir(env, 'su25', { alt: 1000 });
  b.hp = 25;
  const t = { heading: 0, alt: 1000, throttle: 1 };
  run(a, env, 60, () => apHold(a, t, DT));
  run(b, env, 60, () => apHold(b, t, DT));
  return expect('повреждения', b.alive && b.tas < a.tas * 0.9 && Math.abs(b.alt - 1000) < 60, `скорость ${f0(a.tas)} / ${f0(b.tas)}, высота ${f0(b.alt)}`) ? `целый ${f0(a.tas * 3.6)} км/ч, hp 25 — ${f0(b.tas * 3.6)} км/ч` : null;
});

special('превышение скорости: тряска и стена сопротивления, без разрушения', () => {
  const env = makeEnv();
  const ac = inAir(env, 'yak40', { alt: 6000 });
  ac.assist = false;
  let maxOver = 0, vTop = 0;
  run(ac, env, 40, () => { ac.controls.throttle = 1; ac.controls.pitch = ac.pitch > -0.9 ? -0.5 : 0; maxOver = Math.max(maxOver, ac.overspeed); vTop = Math.max(vTop, ac.ias); });
  return expect('флаттер', ac.alive && maxOver === 1 && vTop < ac.spec.vNe * 1.25 && ac.hp === 100, `overspeed ${maxOver}, скорость ${f0(vTop)} (vNe ${ac.spec.vNe})`) ? `в пикировании не более ${f0(vTop * 3.6)} км/ч` : null;
});

special('потолок', () => {
  const res = [];
  for (const id of ['an2', 'tu154']) {
    const env = makeEnv();
    const s = createAircraft(id).spec;
    const ac = inAir(env, id, { alt: s.ceiling - 300, speed: s.vCruise });
    const t = { heading: 0, speed: Math.max(1.5 * s.vStall, s.vClimb * 0.9), throttle: 1 };
    let top = 0;
    run(ac, env, 500, () => { apHold(ac, t, DT); top = Math.max(top, ac.alt); });
    if (!expect('потолок', ac.alive && top < s.ceiling + 900 && top > s.ceiling - 1500, `${id}: достиг ${f0(top)} (паспорт ${s.ceiling})`)) return null;
    res.push(`${id}: ${f0(top)} м (паспорт ${s.ceiling})`);
  }
  return res.join('; ');
});

special('штопор: только при грубой ошибке без помощи, выход — отдать ручку', () => {
  const env = makeEnv();
  const ac = inAir(env, 'yak52', { alt: 2500, speed: 40, assist: false });
  let spun = false, minAlt = 9999, tOut = NaN;
  run(ac, env, 14, () => { ac.controls.throttle = 0; ac.controls.pitch = 1; ac.controls.yaw = 1; if (ac.spin) spun = true; });
  const hIn = ac.alt;
  run(ac, env, 25, (t) => {
    ac.controls.yaw = 0; ac.controls.throttle = 1;
    ac.controls.pitch = ac.spin || ac.stalled ? -0.2 : ac.pitch < -0.03 && ac.ias > 38 ? 0.4 : 0;
    minAlt = Math.min(minAlt, ac.alt);
    if (Number.isNaN(tOut) && !ac.spin && !ac.stalled && ac.vs > -1 && ac.ias > 36) { tOut = t; return false; }
  });
  // с помощью — та же ошибка не приводит к штопору
  const env2 = makeEnv();
  const b = inAir(env2, 'yak52', { alt: 2500, speed: 40 });
  let spunB = false;
  run(b, env2, 14, () => { b.controls.throttle = 0; b.controls.pitch = 1; b.controls.yaw = 1; if (b.spin || b.stalled) spunB = true; });
  return expect('штопор', spun && tOut < 20 && ac.alive && !spunB, `вошёл ${spun}, вывод ${f1(tOut)} с, с помощью срыв ${spunB}`) ? `вывод за ${f1(tOut)} с, потеря высоты ${f0(hIn - minAlt)} м` : null;
});

special('посадка в болтанку с боковым ветром 8 м/с (Ан-2, Ту-154, МиГ-21)', () => {
  const res = [];
  for (const id of ['an2', 'tu154', 'mig21']) {
    const r = landing(id, { wind: [8, 3], turb: 0.5 });
    if (!expect('ветер', r.phase === 'stopped' && r.ac.alive && r.vs > -3.5 && r.surface === 'runway', `${id}: фаза ${r.phase}, Vy ${f1(r.vs)}, от оси ${f1(r.across)}, авария ${r.crash || 'нет'}, hp ${f0(r.ac.hp)}`)) return null;
    res.push(`${id}: Vy ${f1(r.vs)}, от оси ${f1(r.across)} м, hp ${f0(r.ac.hp)}`);
  }
  return res.join('; ');
});

special('заход с неудобной стороны (с обратного курса) — apLand сам строит коробочку', () => {
  const res = [];
  for (const id of ['l410', 'su27']) {
    const r = landing(id, { x: -3000, z: -6000, heading: 0, alt: 600, time: 900 });
    if (!expect('коробочка', r.phase === 'stopped' && r.ac.alive && r.vs > -3 && r.surface === 'runway', `${id}: фаза ${r.phase}, Vy ${f1(r.vs)}, авария ${r.crash || 'нет'}`)) return null;
    res.push(`${id}: ${f0(r.tStop)} с, Vy ${f1(r.vs)}`);
  }
  return res.join('; ');
});

special('apFlyTo, apFollow, apPursue', () => {
  const env = makeEnv();
  // на точку
  const a = inAir(env, 'yak40', { alt: 1200 });
  const p = { x: 6000, y: 1800, z: -9000 };
  let d = 1e9, dMin = 1e9;
  run(a, env, 240, () => { d = apFlyTo(a, p, DT); dMin = Math.min(dMin, d); return d > 150; });
  if (!expect('apFlyTo', dMin < 160 && a.alive, `мин. расстояние ${f0(dMin)}`)) return null;
  // строй: ведомые разных типов за ведущим, который меняет курс
  const out = [];
  for (const [lead, wing] of [['tu154', 'su27'], ['l39', 'l39'], ['an2', 'yak52']]) {
    const L = inAir(env, lead, { alt: 1500, speed: createAircraft(lead).spec.vCruise * 0.85 });
    const Wm = inAir(env, wing, { alt: 1400, speed: L.tas, x: 300, z: 900 });
    const off = { x: 40, y: -5, z: 60 }, tl = { heading: 0, alt: 1500, speed: L.tas };
    let dd = 0, worst = 0;
    const n = Math.round(150 / DT);
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      tl.heading = t > 40 ? 1.2 : 0; tl.alt = t > 90 ? 1800 : 1500;
      apHold(L, tl, DT); dd = apFollow(Wm, L, off, DT);
      stepAircraft(L, env, DT); stepAircraft(Wm, env, DT);
      if (t > 120) worst = Math.max(worst, dd);
    }
    if (!expect('apFollow', worst < 60 && Wm.alive && L.alive, `${wing} за ${lead}: отклонение от места ${f0(worst)} м`)) return null;
    out.push(`${wing} за ${lead}: ±${f0(worst)} м`);
  }
  // преследование: истребитель выходит в хвост маневрирующей цели
  for (const [hunter, prey] of [['mig29', 'su25'], ['su27', 'mig21'], ['l39', 'yak52']]) {
    const T = inAir(env, prey, { alt: 2000, x: 2500, z: -4000, heading: 1.5 });
    const H = inAir(env, hunter, { alt: 1500 });
    const tt = { bank: 0.8, alt: 2000, speed: T.spec.vCruise * 0.9 };
    let cone = 0, minAgl = 1e9;
    const n = Math.round(120 / DT);
    for (let i = 0; i < n && H.alive; i++) {
      const t = i * DT;
      tt.bank = Math.sin(t / 9) > 0 ? 0.9 : -0.9;
      apHold(T, tt, DT);
      const r = apPursue(H, T, DT);
      stepAircraft(T, env, DT); stepAircraft(H, env, DT);
      if (r.inCone && r.dist < 900) cone += DT;
      minAgl = Math.min(minAgl, H.agl);
    }
    if (!expect('apPursue', H.alive && cone > 4 && minAgl > 100 && env.of('ac:stall').length === 0, `${hunter} за ${prey}: в прицеле ${f1(cone)} с, мин. высота ${f0(minAgl)}, жив ${H.alive}`)) return null;
    out.push(`${hunter} → ${prey}: в прицеле ${f1(cone)} с из 120`);
  }
  return out.join('; ');
});

if (fails.length) {
  console.log(`\nНЕ ПРОШЛО (${fails.length}):`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else console.log('\nВсе проверки пройдены.');
