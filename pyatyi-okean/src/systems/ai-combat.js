// Боевое поведение ИИ-самолётов ('attack'): выйти на цель, стрелять короткими очередями, уходить из-под огня,
// выходить из боя при повреждениях. Аркадно и с поблажками игроку. Вызывается из ai.js через G.combat.pilot(ac, a, dt).
import * as AP from '../aircraft/autopilot.js';
import { clamp, wrapPi } from '../core/util.js';
import { Vector3 } from 'three';

const _f = new Vector3(), _d = new Vector3();
const _pur = { lead: 850, range: 380, floor: 320, maxG: 6 };
const _hold = { heading: undefined, alt: undefined, speed: undefined, bank: undefined };

export function createCombatPilot(G, combat, { alive, hostile }) {
  let lockers = 0;

  function findTarget(ac) {
    let best = null, bd = 14000;
    for (let i = 0; i < G.aircraft.length; i++) {
      const e = G.aircraft[i];
      if (!alive(e) || !e.alive || !hostile(ac, e) || e.onGround) continue;
      const d = e.pos.distanceTo(ac.pos) * (e.isPlayer ? 0.8 : 1);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // сбитый самолёт: сваливается на крыло
  function fall(ac) {
    const c = ac.controls;
    c.roll = 0.5; c.pitch = -0.25; c.throttle = 0; c.yaw = 0.3;
  }

  function step(ac, a, dt) {
    if (ac.hp <= 0) { fall(ac); return true; }
    if (ac.onGround) return false;
    const k = a.cb || (a.cb = { tgt: null, pickT: 0, burst: 0, rest: 1 + Math.random() * 2, evade: 0, evadeDir: 1, seekT: 12 + Math.random() * 10, locked: false });
    k.pickT -= dt;
    if (k.pickT <= 0 || !alive(k.tgt) || !k.tgt.alive) { k.pickT = 1.5; k.tgt = a.target && alive(a.target) && a.target.alive ? a.target : findTarget(ac); }
    const t = k.tgt;
    k.locked = false;
    if (!t) return false;
    const skill = a.skill ?? 0.5;

    // сильно повреждён — выходит из боя
    if (ac.hp < 28 || a.requested === 'flee') {
      _hold.heading = Math.atan2(ac.pos.x - t.pos.x, -(ac.pos.z - t.pos.z));
      _hold.alt = Math.max(ac.pos.y, ac.pos.y - ac.agl + 500);
      _hold.speed = ac.spec.vMax * 0.9; _hold.bank = undefined;
      AP.apHold(ac, _hold, dt);
      return true;
    }

    // под огнём игрока — оборонительный манёвр на несколько секунд
    k.evade -= dt;
    if (k.evade <= 0 && t.isPlayer && t.weapons && t.weapons.gun && t.weapons.gun.firing) {
      _f.set(0, 0, -1).applyQuaternion(t.quat);
      _d.subVectors(ac.pos, t.pos);
      const dist = _d.length();
      if (dist < 1300 && _d.dot(_f) / dist > 0.96 && Math.random() < 0.5 + 0.5 * skill) { k.evade = 2.2 + skill * 1.5; k.evadeDir = Math.random() < 0.5 ? -1 : 1; }
    }
    if (k.evade > 0) {
      _hold.heading = undefined;
      _hold.bank = k.evadeDir * 1.25;
      _hold.alt = Math.max(ac.pos.y - ac.agl + 350, ac.pos.y + (ac.agl < 500 ? 200 : 0));
      _hold.speed = ac.spec.vMax * 0.85;
      AP.apHold(ac, _hold, dt);
      return true;
    }

    _pur.maxG = ac.spec.maxG * (0.5 + 0.4 * skill);
    const out = AP.apPursue(ac, t, dt, _pur);
    if (!out) return true;

    // короткие очереди, когда цель в прицеле
    k.rest -= dt;
    const aimed = out.off < 0.035 + (1 - skill) * 0.03 && out.dist < 950 && out.dist > 120;
    if (k.burst > 0) {
      k.burst -= dt;
      if (aimed) combat.fireGun(ac, dt, t, 0.012 + (1 - skill) * 0.02, t.isPlayer ? 0.55 : 1);
      if (k.burst <= 0) { k.rest = 1.6 + (1 - skill) * 2.5; if (ac.weapons && ac.weapons.gun) ac.weapons.gun.firing = false; }
    } else if (aimed && k.rest <= 0) k.burst = 0.6 + skill * 0.6;

    // изредка — ракета с предупреждением (от неё уходят энергичным разворотом)
    k.seekT -= dt;
    const sl = ac.weapons && ac.weapons.slots.find((s) => s.type === 'aam' && s.count > 0);
    if (sl && out.off < 0.25 && out.dist > 900 && out.dist < 4500) {
      if (t.isPlayer) { k.locked = true; lockers++; }
      if (k.seekT <= 0 && skill > 0.35) {
        k.seekT = 22 + Math.random() * 14;
        if (combat.launchSeeker(ac, t, 0.5 + skill * 0.25)) { sl.count--; if (t.isPlayer) combat.warnMissile(); }
      }
    }
    return true;
  }

  return {
    step(ac, a, dt) {
      return step(ac, a, dt);
    },
    lockedOnPlayer() { const v = lockers > 0; lockers = 0; return v; },
    reset() { lockers = 0; },
  };
}
