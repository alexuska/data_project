// БОЙ — упрощённый, аркадный. Контракт — в ARCHITECTURE.md (разделы «Вооружение», «Бой», «Дополнения»).
//   G.combat.armAircraft(ac, loadout?)      -> ac.weapons { gun, slots[], selected, lock }
//   G.combat.spawnGroundTarget({ kind, x, z, y?, heading?, team?, hp?, route?, speed? }) -> target { id, kind, pos, vel, hp, alive, team }
//       kind: truck, tank, aaa, sam, radar, depot, bunker, ship, boat, target_panel, balloon; 'convoy' — колонна из 4 машин (target.group)
//   G.combat.damage(entity, amount, source) — самолёт или цель
//   G.combat.playerTarget, G.combat.threat { missiles, locked, nearest }, G.combat.targets[], G.combat.clear(), G.combat.update(dt)
//   G.combat.pilot(ac, a, dt) — боевое поведение ИИ ('attack'), вызывается из ai.js; см. ai-combat.js
// События: weapon:fire { ac, weapon }, ac:damage { ac, amount, source }, ac:destroyed { ac, by }, target:destroyed { target, by }.
import * as THREE from 'three';
import { targetGeo, ordGeo, combatMaterials } from './combat-geo.js';
import { createCombatPilot } from './ai-combat.js';
import { clamp } from '../core/util.js';

const SHOT_SPEED = 850;      // совпадает с маркой упреждения в HUD
const SHOT_LIFE = 1.9;
const GUN_RATE = 12;         // выстрелов в секунду
const TARGET_HP = { truck: 30, tank: 90, aaa: 50, sam: 60, radar: 45, depot: 80, bunker: 160, ship: 260, boat: 70, target_panel: 14, balloon: 8 };
const TARGET_R = { truck: 7, tank: 7, aaa: 6, sam: 8, radar: 8, depot: 14, bunker: 12, ship: 38, boat: 14, target_panel: 9, balloon: 9 };

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, -1);

function defaultLoadout(spec) {
  if (spec.role !== 'military' || !spec.guns) return null;
  const slots = [];
  if (spec.cls === 'fighter') slots.push({ type: 'aam', count: Math.min(6, Math.max(2, spec.hardpoints || 2)) });
  else if (spec.cls === 'attacker') { slots.push({ type: 'rocket', count: 16 }); slots.push({ type: 'aam', count: 2 }); }
  else slots.push({ type: 'rocket', count: 8 });
  return { gun: true, ammo: spec.cls === 'attacker' ? 600 : spec.cls === 'fighter' ? 420 : 300, slots };
}
const SLOT_NAME = { aam: 'Ракеты', rocket: 'НАР' };

export function createCombat(G) {
  const mats = combatMaterials();
  const targets = [];
  const shots = [];     // снаряды пушки и НАР: { on, pos, vel, life, owner, dmg, splash }
  const seekers = [];   // самонаводящиеся ракеты: { on, pos, vel, target, life, owner, turn, mesh, trail }
  let nextId = 1, pickT = 0, radioT = 0;
  const combat = { targets, playerTarget: null, threat: { missiles: 0, locked: false, nearest: Infinity }, impactPoint: null };

  // ---------- вооружение ----------
  combat.armAircraft = function (ac, loadout) {
    const lo = loadout || defaultLoadout(ac.spec);
    if (!lo) { ac.weapons = null; return; }
    const ammo = lo.ammo || 300;
    ac.weapons = {
      gun: lo.gun === false ? null : { ammo, max: ammo, firing: false, cool: 0 },
      slots: (lo.slots || []).map((s) => ({ id: s.type, name: s.name || SLOT_NAME[s.type] || s.type, type: s.type, count: s.count, max: s.count, cool: 0 })),
      selected: 0,
      lock: null,
      evt: 0,
    };
  };

  function muzzle(ac, out) {
    const an = ac.model && ac.model.userData.anchors;
    const mz = an && an.muzzles && an.muzzles[0];
    if (mz) out.copy(mz); else out.set(0, 0, -ac.spec.length * 0.5);
    return out.applyQuaternion(ac.quat).add(ac.pos);
  }
  const alive = (e) => !!e && e.alive !== false && e.hp > 0;
  const radiusOf = (e) => (e.spec ? Math.max(e.spec.span, e.spec.length) * 0.45 : e.radius || 8);
  const hostile = (owner, e) => e !== owner && e.team !== owner.team && e.team !== 'neutral' && !(owner.team === 'player' && e.team === 'friend') && !(owner.team === 'friend' && e.team === 'player');

  function alloc(pool, make) {
    for (let i = 0; i < pool.length; i++) if (!pool[i].on) return pool[i];
    if (pool.length >= 220) return null;
    const o = make();
    pool.push(o);
    return o;
  }
  const newShot = () => ({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, owner: null, dmg: 0, splash: 0 });

  // выстрел из пушки: dir — единичное направление, spread — разброс в радианах
  function fireShot(ac, dir, spread, dmg, speed, splash) {
    const s = alloc(shots, newShot);
    if (!s) return;
    muzzle(ac, s.pos);
    _d.copy(dir);
    if (spread > 0) {
      _d.x += (Math.random() - 0.5) * 2 * spread; _d.y += (Math.random() - 0.5) * 2 * spread; _d.z += (Math.random() - 0.5) * 2 * spread;
      _d.normalize();
    }
    s.vel.copy(_d).multiplyScalar(speed).add(ac.vel);
    s.life = splash ? 4 : SHOT_LIFE; s.owner = ac; s.dmg = dmg; s.splash = splash || 0; s.on = true;
    _a.copy(s.pos).addScaledVector(s.vel, s.life * 0.6);
    G.fx?.tracer?.(s.pos, _a, splash ? { speed: s.vel.length(), length: 26, width: 0.7, color: 0xffb060 } : { speed: s.vel.length(), length: 34, width: 0.35 });
  }

  // точка упреждения для стрельбы по цели
  function leadPoint(from, tgt, speed, out) {
    out.copy(tgt.pos);
    const t = from.distanceTo(tgt.pos) / speed;
    if (tgt.vel) out.addScaledVector(tgt.vel, t);
    return out;
  }

  // огонь из пушки с небольшой помощью в прицеливании; aim — цель или null
  combat.fireGun = function (ac, dt, aim, spread, dmgK = 1) {
    const w = ac.weapons, g = w && w.gun;
    if (!g || g.ammo <= 0) return false;
    g.cool -= dt;
    g.firing = true;
    while (g.cool <= 0 && g.ammo > 0) {
      g.cool += 1 / GUN_RATE;
      g.ammo--;
      _f.set(0, 0, -1).applyQuaternion(ac.quat);
      if (aim && alive(aim)) {
        muzzle(ac, _m);
        leadPoint(_m, aim, SHOT_SPEED, _b).sub(_m);
        const dist = _b.length();
        _b.normalize();
        const off = Math.acos(clamp(_b.dot(_f), -1, 1));
        const help = ac.isPlayer ? 0.07 : 0.05;   // «магнетизм» к цели, рад
        if (dist < 1700 && off < help) _f.lerp(_b, ac.isPlayer ? 0.8 : 0.55).normalize();
      }
      fireShot(ac, _f, spread, 7 * dmgK, SHOT_SPEED, 0);
    }
    w.evt -= dt;
    if (w.evt <= 0) { w.evt = 0.2; G.bus.emit('weapon:fire', { ac, weapon: 'gun' }); }
    return true;
  };

  function launchSeeker(owner, target, turn) {
    const s = alloc(seekers, () => ({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, life: 0, owner: null, turn: 1, mesh: null, trail: null }));
    if (!s) return false;
    if (owner.pos) {
      _f.set(0, 0, -1).applyQuaternion(owner.quat || _q.identity());
      s.pos.copy(owner.pos).addScaledVector(_f, 6);
      s.pos.y -= owner.spec ? 1.5 : -4;
      s.vel.copy(_f).multiplyScalar(260).add(owner.vel || _a.set(0, 0, 0));
      if (!owner.spec) s.vel.set(0, 200, 0);     // с наземной установки — вверх
    }
    s.target = target; s.life = 10; s.owner = owner; s.turn = turn; s.on = true;
    if (!s.mesh) { s.mesh = new THREE.Mesh(ordGeo('aam'), mats.body); s.mesh.scale.setScalar(1.6); }
    s.mesh.position.copy(s.pos);
    G.scene.add(s.mesh);
    s.trail = G.fx?.trail?.({ color: 0xe8e8e8, width: 1.6, life: 2.6, glow: 0.4 }) || null;
    G.bus.emit('weapon:fire', { ac: owner, weapon: 'aam' });
    return true;
  }
  combat.launchSeeker = launchSeeker;

  function endSeeker(s, boom) {
    s.on = false;
    if (s.mesh) G.scene.remove(s.mesh);
    if (s.trail) { s.trail.end(); s.trail = null; }
    if (boom) G.fx?.explosion?.(s.pos, 0.8);
  }

  // пуск выбранного слота игроком / ИИ
  combat.fireSlot = function (ac, dt) {
    const w = ac.weapons;
    if (!w || !w.slots.length) return false;
    const sl = w.slots[clamp(w.selected | 0, 0, w.slots.length - 1)];
    if (sl.cool > 0 || sl.count <= 0) return false;
    if (sl.type === 'aam') {
      const lk = w.lock;
      if (!lk || !lk.locked || !alive(lk.target)) return false;
      if (!launchSeeker(ac, lk.target, 1.15)) return false;
      sl.count--; sl.cool = 1.2;
      if (ac.isPlayer) { lk.progress = 0; lk.locked = false; say('Корвет', 'Пуск!'); }
      return true;
    }
    if (sl.type === 'rocket') {
      _f.set(0, 0, -1).applyQuaternion(ac.quat);
      const n = Math.min(2, sl.count);
      for (let i = 0; i < n; i++) fireShot(ac, _f, 0.006, 45, 520, 22);
      sl.count -= n; sl.cool = 0.35;
      G.bus.emit('weapon:fire', { ac, weapon: 'rocket' });
      return true;
    }
    return false;
  };

  // ---------- повреждения ----------
  combat.damage = function (e, amount, source) {
    if (!e || !alive(e) || !(amount > 0)) return;
    if (e.spec) {
      if (e.isPlayer) amount *= 0.6;            // игрок живуч
      e.hp = Math.max(0, e.hp - amount);
      e.damageSource = 'shot';
      G.bus.emit('ac:damage', { ac: e, amount, source });
      if (e.isPlayer) { G.cameraRig?.shake?.(0.5); G.input?.haptic?.(40); }
      if (e.hp <= 0) {
        G.fx?.explosion?.(e.pos, 1.1);
        G.bus.emit('ac:destroyed', { ac: e, by: source || null });
        if (source === G.player && !e.isPlayer) { say('Вышка', 'Корвет, цель поражена. Три-хо-хо!'); G.bus.emit('ui:toast', { text: 'Цель поражена', kind: 'good' }); }
      }
      return;
    }
    e.hp -= amount;
    if (e.hp > 0) return;
    e.hp = 0; e.alive = false;
    e.vel.set(0, 0, 0);
    G.fx?.explosion?.(e.pos, e.kind === 'depot' || e.kind === 'ship' ? 2.4 : e.kind === 'balloon' || e.kind === 'target_panel' ? 0.6 : 1.3);
    if (e.kind === 'balloon' || e.kind === 'target_panel') e.mesh.visible = false;
    else { e.mesh.material = mats.wreck; e.fire = G.fx?.fire?.(e.pos, e.kind === 'depot' ? 2 : 1) || null; }
    G.bus.emit('target:destroyed', { target: e, by: source || null });
    if (source === G.player) G.bus.emit('ui:toast', { text: 'Цель поражена', kind: 'good' });
  };

  // ---------- наземные и воздушные цели ----------
  function makeTarget(o, kind) {
    const team = o.team || 'enemy';
    const gnd = G.world.groundAt(o.x, o.z);
    const y = kind === 'balloon' ? (o.y ?? gnd.y + 350) : gnd.y;
    const mesh = new THREE.Mesh(targetGeo(kind, team), mats.body);
    mesh.position.set(o.x, y, o.z);
    mesh.rotation.y = -(o.heading || 0);
    G.scene.add(mesh);
    const t = {
      id: 't' + nextId++, kind, team, hp: o.hp || TARGET_HP[kind] || 40, alive: true,
      pos: mesh.position, vel: new THREE.Vector3(), mesh, radius: (TARGET_R[kind] || 8) + 4,
      route: o.route || null, wp: 0, speed: o.speed || (kind === 'ship' || kind === 'boat' ? 8 : 11),
      cool: 2 + Math.random() * 3, fire: null,
    };
    targets.push(t);
    return t;
  }
  combat.spawnGroundTarget = function (o = {}) {
    if (o.kind === 'convoy') {
      const group = [];
      for (let i = 0; i < 4; i++) group.push(makeTarget({ ...o, x: o.x - Math.sin(o.heading || 0) * i * 22, z: o.z + Math.cos(o.heading || 0) * i * 22 }, i === 1 ? 'tank' : 'truck'));
      group[0].group = group;
      return group[0];
    }
    return makeTarget(o, o.kind || 'truck');
  };

  function stepTarget(t, dt) {
    if (t.route && t.route.length) {
      const w = t.route[t.wp % t.route.length];
      const dx = w.x - t.pos.x, dz = w.z - t.pos.z, d = Math.hypot(dx, dz);
      if (d < 12) { t.wp++; if (t.wp >= t.route.length && !t.loop) { t.route = null; t.vel.set(0, 0, 0); return; } }
      else {
        t.vel.set((dx / d) * t.speed, 0, (dz / d) * t.speed);
        t.pos.x += t.vel.x * dt; t.pos.z += t.vel.z * dt;
        if (t.kind !== 'balloon') t.pos.y = G.world.groundAt(t.pos.x, t.pos.z).y;
        t.mesh.rotation.y = -Math.atan2(dx, -dz);
      }
    }
    // зенитка и ЗРК работают по игроку
    const p = G.player;
    if ((t.kind !== 'aaa' && t.kind !== 'sam') || t.team !== 'enemy' || !p || !p.alive || p.onGround) return;
    t.cool -= dt;
    if (t.cool > 0) return;
    const dist = t.pos.distanceTo(p.pos);
    if (t.kind === 'aaa') {
      t.cool = 1.3 + Math.random() * 0.9;
      if (dist > 2600 || p.agl < 25) return;
      _a.copy(t.pos); _a.y += 3;
      leadPoint(_a, p, 700, _b);
      _b.x += (Math.random() - 0.5) * 60; _b.y += (Math.random() - 0.5) * 40; _b.z += (Math.random() - 0.5) * 60;
      G.fx?.tracer?.(_a, _b, { speed: 700, length: 30, width: 0.5, color: 0xff7040 });
      const chance = 0.16 * (1 - dist / 2600) * (Math.abs(p.g) > 2.3 ? 0.35 : 1);
      if (Math.random() < chance) combat.damage(p, 7, t);
    } else {
      t.cool = 14 + Math.random() * 6;
      if (dist > 6500 || dist < 900 || p.agl < 80) return;
      if (launchSeeker(t, p, 0.5)) warnMissile();
    }
  }

  // ---------- сообщения ----------
  function say(from, text) {
    if (G.time.sim - radioT < 5) return;
    radioT = G.time.sim;
    G.bus.emit('radio', { from, text });
  }
  let warnT = -99;
  function warnMissile() {
    if (G.time.sim - warnT < 3) return;
    warnT = G.time.sim;
    G.bus.emit('ui:toast', { text: 'Пуск по вам! Манёвр!', kind: 'bad' });
    G.audio?.play?.('warn_missile');
  }
  combat.warnMissile = warnMissile;
  combat.say = say;

  // ---------- выбор цели игрока и захват ----------
  function pickTarget(p) {
    _f.set(0, 0, -1).applyQuaternion(p.quat);
    let best = null, bs = 0.86;                 // cos 30°
    const test = (e, bonus) => {
      if (!alive(e) || !hostile(p, e)) return;
      _d.subVectors(e.pos, p.pos);
      const dist = _d.length();
      if (dist > 9000 || dist < 30) return;
      const c = _d.dot(_f) / dist + bonus - dist * 4e-6;
      if (c > bs) { bs = c; best = e; }
    };
    for (let i = 0; i < G.aircraft.length; i++) test(G.aircraft[i], 0.02);
    for (let i = 0; i < targets.length; i++) test(targets[i], 0);
    return best;
  }

  function stepPlayer(p, dt) {
    const w = p.weapons;
    if (!w) { combat.playerTarget = null; return; }
    pickT -= dt;
    if (pickT <= 0 || !alive(combat.playerTarget)) { pickT = 0.2; combat.playerTarget = pickTarget(p); }
    const tgt = combat.playerTarget;
    const st = G.input.state;
    if (w.gun) { if (st.fire && p.alive) combat.fireGun(p, dt, tgt, 0.0025); else { w.gun.firing = false; w.gun.cool = Math.max(w.gun.cool, 0); } }
    for (let i = 0; i < w.slots.length; i++) if (w.slots[i].cool > 0) w.slots[i].cool -= dt;
    const sl = w.slots[w.selected];
    // захват для ракет: цель-самолёт в конусе ~20° и ближе 6 км
    if (sl && sl.type === 'aam' && sl.count > 0 && tgt && tgt.spec) {
      _f.set(0, 0, -1).applyQuaternion(p.quat);
      _d.subVectors(tgt.pos, p.pos);
      const dist = _d.length();
      const inCone = dist < 6000 && _d.dot(_f) / dist > 0.94;
      if (!w.lock || w.lock.target !== tgt) w.lock = { target: tgt, progress: 0, locked: false };
      const was = w.lock.locked;
      w.lock.progress = clamp(w.lock.progress + (inCone ? dt / 1.4 : -dt * 1.5), 0, 1);
      w.lock.locked = w.lock.progress >= 1;
      if (w.lock.locked && !was) G.audio?.play?.('lock');
    } else w.lock = null;
    if (st.fireAlt && p.alive) combat.fireSlot(p, dt);
  }

  // ---------- шаг ----------
  function hitTest(s, e, r, dt) {
    // ближайшая точка отрезка пути снаряда за шаг к центру цели (в системе цели)
    _a.subVectors(s.pos, e.pos);
    _b.copy(s.vel);
    if (e.vel) _b.sub(e.vel);
    const vv = _b.lengthSq();
    const t = vv > 0 ? clamp(-_a.dot(_b) / vv, 0, dt) : 0;
    _a.addScaledVector(_b, t);
    return _a.lengthSq() < r * r;
  }

  function stepShots(dt) {
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!s.on) continue;
      let hit = null;
      const playerHelp = s.owner && s.owner.isPlayer ? 5 : 0;
      for (let k = 0; k < G.aircraft.length && !hit; k++) {
        const e = G.aircraft[k];
        if (alive(e) && e !== s.owner && e.team !== s.owner.team && hitTest(s, e, radiusOf(e) + playerHelp, dt)) hit = e;
      }
      for (let k = 0; k < targets.length && !hit; k++) {
        const e = targets[k];
        if (alive(e) && e.team !== s.owner.team && hitTest(s, e, e.radius + playerHelp + s.splash * 0.5, dt)) hit = e;
      }
      if (hit) {
        if (!hostile(s.owner, hit) && hit.team !== 'neutral') { s.on = false; continue; }
        combat.damage(hit, s.dmg, s.owner);
        if (s.splash) G.fx?.explosion?.(s.pos, 0.7); else G.fx?.smokePuff?.(s.pos, { size: 3, life: 0.5, count: 2 });
        s.on = false;
        continue;
      }
      s.pos.addScaledVector(s.vel, dt);
      s.life -= dt;
      if (s.life <= 0) { s.on = false; continue; }
      if (s.pos.y < 2500) {
        const gy = G.world.groundAt(s.pos.x, s.pos.z).y;
        if (s.pos.y <= gy) {
          s.pos.y = gy;
          if (s.splash) {
            G.fx?.explosion?.(s.pos, 0.8);
            for (let k = 0; k < targets.length; k++) {
              const e = targets[k];
              if (alive(e) && hostile(s.owner, e) && e.pos.distanceTo(s.pos) < s.splash + e.radius) combat.damage(e, s.dmg, s.owner);
            }
          } else if (Math.random() < 0.3) G.fx?.dust?.(s.pos, 0.5);
          s.on = false;
        }
      }
    }
  }

  function stepSeekers(dt) {
    let onPlayer = 0, nearest = Infinity;
    const p = G.player;
    for (let i = 0; i < seekers.length; i++) {
      const s = seekers[i];
      if (!s.on) continue;
      const t = s.target;
      s.life -= dt;
      if (s.life <= 0 || !alive(t)) { endSeeker(s, s.life <= 0); continue; }
      // простой доворот на цель с ограниченной угловой скоростью — от ракеты можно уйти манёвром
      _d.subVectors(t.pos, s.pos);
      const dist = _d.length();
      if (dist < 28 + radiusOf(t) * 0.5) { combat.damage(t, 62, s.owner); endSeeker(s, true); continue; }
      _d.multiplyScalar(1 / dist);
      const speed = Math.min(s.vel.length() + 260 * dt, 620);
      _a.copy(s.vel).normalize();
      const ang = Math.acos(clamp(_a.dot(_d), -1, 1));
      if (ang > 1.5 && s.life < 8.5) { endSeeker(s, false); continue; }   // цель ушла — промах
      const k = ang > 1e-4 ? Math.min(1, (s.turn * dt) / ang) : 1;
      _a.lerp(_d, k).normalize();
      s.vel.copy(_a).multiplyScalar(speed);
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y <= G.world.groundAt(s.pos.x, s.pos.z).y) { endSeeker(s, true); continue; }
      s.mesh.position.copy(s.pos);
      s.mesh.quaternion.setFromUnitVectors(_z, _a);
      if (s.trail) s.trail.push(s.pos);
      if (t === p) { onPlayer++; if (dist < nearest) nearest = dist; }
    }
    combat.threat.missiles = onPlayer;
    combat.threat.nearest = nearest;
  }

  const pilot = createCombatPilot(G, combat, { alive, hostile });
  combat.pilot = pilot.step;

  combat.update = function (dt) {
    const p = G.player;
    if (p && p.alive) stepPlayer(p, dt);
    for (let i = 0; i < targets.length; i++) if (targets[i].alive) stepTarget(targets[i], dt);
    stepShots(dt);
    stepSeekers(dt);
    combat.threat.locked = pilot.lockedOnPlayer();
  };

  combat.clear = function () {
    for (const t of targets) { G.scene.remove(t.mesh); if (t.fire) t.fire.stop(); }
    targets.length = 0;
    for (const s of shots) s.on = false;
    for (const s of seekers) if (s.on) endSeeker(s, false);
    combat.playerTarget = null;
    combat.threat.missiles = 0; combat.threat.locked = false; combat.threat.nearest = Infinity;
    pilot.reset();
  };

  G.bus.on('input:weapon', () => {
    const w = G.player && G.player.weapons;
    if (w && w.slots.length > 1) { w.selected = (w.selected + 1) % w.slots.length; w.lock = null; }
  });
  return combat;
}
