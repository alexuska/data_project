#!/usr/bin/env node
// Проверка выполнимости и распознавания фигур пилотажа: node tools/aerobatics-test.mjs [id самолёта] [--v] [--noassist]
// Мок-мир (ровная земля), лётная модель physics.js + распознаватель TrickDetector из systems/aerobatics.js.
// «Пилот» задаёт управление так, как это делает игрок большим пальцем: ручка полностью на себя / вбок, полный газ,
// отпускание ручки по простым признакам («встал в горизонт», «вверх ногами»). Помощь пилоту включена (как у папы);
// --noassist — справочный прогон без помощи (там ручка «до упора» честно срывает самолёт). TRACE=1 — след распознавателя.
import { Vector3 } from 'three';
import { createAircraft, placeAircraft, stepAircraft } from '../src/aircraft/physics.js';
import { TrickDetector, TRICKS } from '../src/systems/aerobatics.js';

const DT = 1 / 60;
const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('-'));
const verbose = args.includes('--v');
const assist = !args.includes('--noassist');
const PLANES = only ? [only] : ['yak52', 'l39', 'mig29', 'su27'];

function makeEnv() {
  const world = {
    wind: new Vector3(), weather: { turbulence: 0, rain: 0 },
    heightAt: () => 0,
    groundAt: () => ({ y: 0, surface: 'ground' }),
  };
  return { world, bus: { emit() {} } };
}

const _f = new Vector3(), _u = new Vector3();
function att(ac) {
  _f.set(0, 0, -1).applyQuaternion(ac.quat);
  _u.set(0, 1, 0).applyQuaternion(ac.quat);
  return { fy: _f.y, uy: _u.y, uyR: 0 };
}

// Фаза: { name, ctl: {pitch, roll, throttle, yaw?} | (ac, st) => ctl, until: (ac, st) => bool, max: сек }
function fly(id, phases, { alt = 1500, speed } = {}) {
  const env = makeEnv();
  const ac = createAircraft(id, { isPlayer: true });
  ac.assist = assist;
  placeAircraft(ac, { x: 0, y: alt, z: 0, heading: 0, speed: speed ?? ac.spec.vCruise });
  ac.gearDown = false; ac.gearPos = 0;
  const got = [];
  const det = new TrickDetector((tid) => got.push(tid));
  const log = [];
  let t = 0, minIas = Infinity, maxAlt = -Infinity, minAlt = Infinity, stalled = 0;
  for (const ph of phases) {
    const st = { t0: t, a: att(ac), flags: {} };
    const n = Math.round((ph.max ?? 30) / DT);
    let i = 0;
    for (; i < n && ac.alive; i++) {
      st.a = att(ac);
      st.dt = t - st.t0;
      if (ph.until && ph.until(ac, st)) break;
      const c = typeof ph.ctl === 'function' ? ph.ctl(ac, st) : ph.ctl;
      ac.controls.pitch = c.pitch ?? 0;
      ac.controls.roll = c.roll ?? 0;
      ac.controls.yaw = c.yaw ?? 0;
      ac.controls.throttle = c.throttle ?? 1;
      stepAircraft(ac, env, DT);
      det.step(ac, DT);
      if (process.env.TRACE && i % 30 === 0) console.log(ph.name, (t).toFixed(0), 'hh', det.hhPhase, det.hhBack, (det.hhMinIas*3.6).toFixed(0), 'exc', det.exc, det.refOk, 'st', ac.stalled, 'fy', att(ac).fy.toFixed(2), 'uy', att(ac).uy.toFixed(2), 'bank', (ac.bank * 57.3).toFixed(0), 'tOn', det.tOn, 'tAcc', (det.tAcc * 57.3).toFixed(0), 'alt', ac.alt.toFixed(0), 'tAlt0', det.tAlt0.toFixed(0), 'ias', ac.ias.toFixed(0));
      t += DT;
      if (ac.stalled) stalled += DT;
      if (ph.track) { minIas = Math.min(minIas, ac.ias); maxAlt = Math.max(maxAlt, ac.alt); minAlt = Math.min(minAlt, ac.alt); }
    }
    const a = att(ac);
    log.push(`${ph.name}:${(t - st.t0).toFixed(1)}с${i >= n ? '(таймаут)' : ''}` + (verbose ? ` [V=${(ac.ias * 3.6).toFixed(0)} h=${ac.alt.toFixed(0)} нос=${(Math.asin(a.fy) * 57.3).toFixed(0)}° верх=${a.uy.toFixed(2)} Vy=${ac.vs.toFixed(0)}]` : ''));
  }
  return { got, ac, log, minIas, maxAlt, minAlt, stalled, t };
}

// ---------- сценарии (как действует игрок) ----------
const toLevel = { name: 'горизонт', ctl: { throttle: 1 }, max: 6 };
const speedUp = (k = 0.92) => ({
  name: 'разгон', max: 40,
  // небольшое снижение с полным газом до скорости входа в фигуру (k × Vmax)
  ctl: (ac) => ({ throttle: 1, pitch: ac.pitch > -0.12 ? -0.25 : 0 }),
  until: (ac) => ac.ias > k * ac.spec.vMax,
});
// выйти на скорость k × Vсв: газ/малый газ, при нехватке — пологое снижение
const speedTo = (k) => ({
  name: `скорость ${k}Vсв`, max: 60,
  ctl: (ac) => { const tgt = k * ac.spec.vStall; return { throttle: ac.ias < tgt ? 1 : 0, pitch: ac.ias < tgt - 3 && ac.pitch > -0.12 ? -0.25 : 0 }; },
  until: (ac) => Math.abs(ac.ias - k * ac.spec.vStall) < 3 && Math.abs(ac.vs) < 15,
});
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// игрок выравнивает самолёт в горизонт: крыло в горизонт, нос к горизонту
const recover = { name: 'выход', max: 12, ctl: (ac, st) => ({ throttle: 1, roll: st.a.uy > 0 ? clamp1(-ac.bank * 2) : 0, pitch: clamp1(-st.a.fy * 4 - ac.vs * 0.02) }), until: (ac, st) => st.a.uy > 0.95 && Math.abs(st.a.fy) < 0.15 && st.dt > 1 };

const SCEN = {
  roll: [
    toLevel,
    { name: 'ручка вбок', ctl: { roll: 1, throttle: 1 }, max: 2.6 },
    { name: 'отпустил', ctl: { throttle: 1 }, max: 2.5 },
  ],
  loop: [
    speedUp(),
    {
      name: 'ручка на себя', max: 40, track: true,
      ctl: { pitch: 1, throttle: 1 },
      // держим до тех пор, пока не пройдём «спину» и нос снова не встанет к горизонту
      until: (ac, st) => { if (st.a.uy < -0.5) st.flags.inv = true; if (st.flags.inv && st.a.fy < -0.3) st.flags.down = true; return st.flags.down && st.a.fy > -0.05; },
    },
    recover,
  ],
  immelmann: [
    speedUp(),
    {
      name: 'на себя до спины', max: 30, track: true, ctl: { pitch: 1, throttle: 1 },
      until: (ac, st) => { if (st.a.fy > 0.8) st.flags.up = true; return st.flags.up && st.a.uy < -0.5 && st.a.fy < 0.08; },
    },
    { name: 'полубочка', max: 6, ctl: { roll: 1, throttle: 1 }, until: (ac, st) => st.a.uy > 0.8 },
    recover,
  ],
  splits: [
    speedTo(2.2),
    { name: 'полубочка', max: 6, ctl: { roll: 1, throttle: 0.3 }, until: (ac, st) => st.a.uy < -0.9 },
    {
      name: 'на себя', max: 30, track: true, ctl: { pitch: 1, throttle: 0.3 },
      until: (ac, st) => { if (st.a.fy < -0.4) st.flags.down = true; return st.flags.down && st.a.fy > -0.05; },
    },
    recover,
  ],
  chandelle: [
    speedTo(2.6),
    { name: 'крен 60', max: 3, ctl: (ac) => ({ roll: ac.bank < 1.0 ? 1 : 0, throttle: 1 }), until: (ac) => ac.bank > 0.95 },
    {
      name: 'тянем в набор', max: 25, track: true,
      ctl: (ac, st) => ({ pitch: 0.75, roll: ac.bank > 1.05 ? -0.4 : ac.bank < 0.8 ? 0.4 : 0, throttle: 1 }),
      until: (ac, st) => { const d = Math.abs(((ac.heading - Math.PI + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); return d < 0.35; },
    },
    { name: 'выравнивание', max: 4, ctl: (ac) => ({ roll: -Math.sign(ac.bank) * Math.min(1, Math.abs(ac.bank) * 2), throttle: 1 }), until: (ac) => Math.abs(ac.bank) < 0.1 },
    { name: 'в горизонт', max: 10, ctl: (ac) => ({ pitch: ac.pitch > 0.05 ? -0.5 : 0, throttle: 1 }), until: (ac, st) => st.a.uy > 0.95 && Math.abs(st.a.fy) < 0.15 && Math.abs(ac.vs) < 6 },
  ],
  turn360: [
    speedTo(2.2),
    { name: 'крен 60', max: 3, ctl: (ac) => ({ roll: ac.bank < 1.05 ? 1 : 0, throttle: 1 }), until: (ac) => ac.bank > 1.0 },
    {
      name: 'вираж', max: 60, track: true,
      ctl: (ac) => ({ pitch: Math.max(0, Math.min(1, 0.6 - ac.vs * 0.2)), roll: ac.bank > 1.25 ? -0.3 : ac.bank < 1.1 ? 0.3 : 0, throttle: ac.ias < 2.2 * ac.spec.vStall ? 1 : 0.3 }),
    },
  ],
  inverted: [
    toLevel,
    { name: 'на спину', max: 6, ctl: { roll: 1, throttle: 1 }, until: (ac, st) => st.a.uy < -0.95 },
    // от себя — держим горизонт вверх ногами
    { name: 'держим', max: 6, track: true, ctl: (ac) => ({ pitch: Math.max(-1, Math.min(0, -0.35 - ac.vs * 0.06 + (ac.pitch > 0.1 ? 0.3 : 0))), throttle: 1 }) },
    { name: 'на ноги', max: 6, ctl: { roll: 1, throttle: 1 }, until: (ac, st) => st.a.uy > 0.5 },
  ],
  knife: [
    toLevel,
    { name: 'крен 90', max: 3, ctl: (ac) => ({ roll: 1, throttle: 1 }), until: (ac) => ac.bank > 1.5 },
    { name: 'нож', max: 4, track: true, ctl: (ac) => ({ roll: Math.max(-1, Math.min(1, (1.57 - ac.bank) * 2.5 + 0.2)), throttle: 1 }) },
    { name: 'выход', max: 4, ctl: (ac) => ({ roll: -1, throttle: 1 }), until: (ac) => Math.abs(ac.bank) < 0.2 },
  ],
  hammerhead: [
    speedTo(2.2),
    { name: 'в вертикаль', max: 10, ctl: { pitch: 1, throttle: 1 }, until: (ac, st) => st.a.fy > 0.93 },
    { name: 'горка, газ убран', max: 45, track: true, ctl: { throttle: 0 }, until: (ac, st) => st.a.fy < -0.4 },
    { name: 'вывод', max: 20, ctl: { pitch: 1, throttle: 1 }, until: (ac, st) => st.a.fy > 0 && st.dt > 1 },
    recover,
  ],
};

const MUST = ['roll', 'loop', 'immelmann', 'splits'];
const fails = [];
console.log(`Пилотаж: помощь пилоту ${assist ? 'ВКЛ' : 'ВЫКЛ'}`);
for (const id of PLANES) {
  console.log(`\n=== ${id} ===`);
  for (const [name, phases] of Object.entries(SCEN)) {
    const r = fly(id, phases, { alt: name === 'splits' || name === 'hammerhead' ? 2500 : 1500 });
    const ok = r.got.includes(name);
    if (!ok && MUST.includes(name) && assist) fails.push(`${id}: ${name} (засчитано: ${r.got.join(', ') || 'ничего'})`);
    const extra = r.minIas < Infinity ? ` minV=${(r.minIas * 3.6).toFixed(0)}км/ч h=${r.minAlt.toFixed(0)}…${r.maxAlt.toFixed(0)}м` : '';
    console.log(`${ok ? ' ok ' : (MUST.includes(name) ? 'FAIL' : ' -- ')} ${name.padEnd(11)} → ${r.got.map((g) => TRICKS[g].name).join(', ') || '—'}${extra}${r.stalled ? ` срыв ${r.stalled.toFixed(1)}с` : ''}${r.ac.alive ? '' : ' РАЗБИЛСЯ'}`);
    if (verbose) console.log('      ' + r.log.join(' · '));
  }
  // бреющий: 10 м над землёй, шасси убрано, 6 с
  {
    const r = fly(id, [{ name: 'бреющий', max: 6, ctl: (ac) => ({ pitch: Math.max(-0.3, Math.min(0.3, (10 - ac.alt) * 0.05 - ac.vs * 0.1)), throttle: 1 }) }], { alt: 10, speed: undefined });
    const ok = r.got.includes('lowpass');
    console.log(`${ok ? ' ok ' : ' -- '} lowpass     → ${r.got.map((g) => TRICKS[g].name).join(', ') || '—'}`);
  }
  // ложные срабатывания: спокойный полёт и пологие развороты — ничего не засчитывается
  {
    const r = fly(id, [
      { name: 'прямо', max: 10, ctl: { throttle: 0.7 } },
      { name: 'разворот 30°', max: 25, ctl: (ac) => ({ roll: ac.bank < 0.5 ? 0.5 : 0, throttle: 0.7 }) },
    ]);
    const ok = r.got.length === 0;
    if (!ok) fails.push(`${id}: ложное срабатывание в спокойном полёте (${r.got.join(', ')})`);
    console.log(`${ok ? ' ok ' : 'FAIL'} спокойно    → ${r.got.join(', ') || 'ничего (верно)'}`);
  }
}
console.log(fails.length ? `\nПРОВАЛЫ (${fails.length}):\n  ` + fails.join('\n  ') : '\nВсе обязательные фигуры (бочка, петля, иммельман, переворот) выполнимы и засчитаны.');
process.exit(fails.length ? 1 : 0);
