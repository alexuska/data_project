// 3D-МОДЕЛИ САМОЛЁТОВ (заглушка v0 — заменяется агентом «Модели»). Контракт — в ARCHITECTURE.md.
// buildModel(specId, opts) -> THREE.Group в реальном масштабе (метры), нос −Z, правое крыло +X, верх +Y,
// начало координат — в центре тяжести. animateModel(model, ac, dt) — анимация по состоянию самолёта.
import * as THREE from 'three';
import { getSpec } from './catalog.js';

export function buildModel(specId, opts = {}) {
  const spec = getSpec(specId);
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: spec.role === 'military' ? '#7d8a94' : '#f2f2ee', flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: spec.role === 'military' ? '#4d5a63' : '#d8452e', flatShading: true });
  const L = spec.length, W = spec.span, r = L * 0.06;
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.4, L, 8).rotateX(-Math.PI / 2), body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(W, r * 0.25, L * 0.18), body);
  wing.position.z = -L * 0.02;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(W * 0.35, r * 0.2, L * 0.1), body);
  tail.position.z = L * 0.44;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(r * 0.2, L * 0.16, L * 0.12), accent);
  fin.position.set(0, L * 0.08, L * 0.43);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(r, L * 0.1, 8).rotateX(-Math.PI / 2), accent);
  nose.position.z = -L * 0.55;
  g.add(fus, wing, tail, fin, nose);
  const prop = new THREE.Mesh(new THREE.BoxGeometry(r * 3.2, r * 0.25, 0.06), accent);
  prop.position.z = -L * 0.61;
  prop.visible = spec.engine !== 'jet';
  g.add(prop);
  const gear = new THREE.Group();
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, spec.gearHeight, 0.15), accent);
    leg.position.set(sx * W * 0.12, -spec.gearHeight / 2, 0);
    gear.add(leg);
  }
  g.add(gear);
  g.userData.parts = { propellers: [prop], gear };
  g.userData.specId = spec.id;
  return g;
}

export function animateModel(model, ac, dt) {
  const p = model.userData.parts;
  if (!p) return;
  for (const pr of p.propellers) pr.rotation.z += (8 + ac.throttle * 60) * dt;
  if (p.gear) p.gear.visible = ac.gearPos > 0.5;
}
