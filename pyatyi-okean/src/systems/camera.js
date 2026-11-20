// КАМЕРА (заглушка v0 — заменяется агентом «Управление»). Контракт — в ARCHITECTURE.md.
import * as THREE from 'three';
import { damp } from '../core/util.js';

export function createCameraRig(G) {
  const cam = G.camera;
  const _f = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
  let menuAngle = 0;
  const rig = {
    mode: 'chase', // 'chase' | 'cockpit' | 'flyby' | 'orbit'
    next() {},
    snap() { rig._snap = true; },
    update(dt) {
      const ac = G.player;
      if (G.mode === 'menu' || !ac) {
        // облёт главного аэропорта для фона меню
        menuAngle += dt * 0.05;
        cam.position.set(Math.cos(menuAngle) * 2600, 520, 2000 + Math.sin(menuAngle) * 2600);
        cam.lookAt(0, 60, 2000);
        return;
      }
      const dist = ac.spec.length * 2.6 + 6, height = ac.spec.length * 0.55 + 1.5;
      _f.set(0, 0, -1).applyQuaternion(ac.quat);
      _f.y *= 0.5;
      _f.normalize();
      _p.copy(ac.pos).addScaledVector(_f, -dist);
      _p.y += height;
      const minY = G.world.groundAt(_p.x, _p.z).y + 1.5;
      if (_p.y < minY) _p.y = minY;
      if (rig._snap) { cam.position.copy(_p); rig._snap = false; }
      cam.position.x = damp(cam.position.x, _p.x, 6, dt);
      cam.position.y = damp(cam.position.y, _p.y, 6, dt);
      cam.position.z = damp(cam.position.z, _p.z, 6, dt);
      _t.copy(ac.pos).addScaledVector(_f, ac.spec.length * 1.5);
      cam.lookAt(_t);
    },
  };
  G.bus.on('flight:start', () => rig.snap());
  return rig;
}
