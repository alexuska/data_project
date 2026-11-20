// 3D-МОДЕЛИ САМОЛЁТОВ. Контракт — в ARCHITECTURE.md.
//   buildModel(specId, { livery?, team? }) -> THREE.Group (реальный масштаб, нос −Z, правое крыло +X, верх +Y, начало в ЦТ)
//   animateModel(model, ac, dt) — винты, шасси, закрылки, рули, тормозные щитки, сопла/форсаж, огни
//   LIVERIES = { [specId]: [{ id, name }] } — первая ливрея по умолчанию; team: 'enemy' -> окраска «агрессора»
// Устройство: models/kit.js (конструктор геометрии), models/paint.js (ливреи), models/rig.js (экземпляр и анимация),
// models/planes/*.js (описания самолётов), models/registry.js (реестр).
// Геометрия и материалы общие для всех экземпляров типа (geometry.userData.shared = true): самолёт = 2 вызова отрисовки.
import * as THREE from 'three';
import { CATALOG, getSpec } from './catalog.js';
import { G } from '../core/game.js';
import { Builder } from './models/kit.js';
import { paintShape, aggressor } from './models/paint.js';
import { prepareShape, createInstance, animate, materials } from './models/rig.js';
import { DEFS } from './models/registry.js';
import { genericDef } from './models/planes/generic.js';

const defCache = {}, shapeCache = {}, geoCache = {};
let enemyScheme = null, hooked = false;

// у каждого экземпляра своя маленькая текстура матриц костей — освобождаем её, когда ядро удаляет самолёт
function hookBus() {
  if (hooked || !G || !G.bus) return;
  hooked = true;
  G.bus.on('ac:remove', (e) => {
    const d = e && e.ac && e.ac.model && e.ac.model.userData.dispose;
    if (typeof d === 'function') d();
  });
}

function defFor(spec) {
  return defCache[spec.id] || (defCache[spec.id] = DEFS[spec.id] || genericDef(spec));
}

function shapeFor(spec) {
  let sh = shapeCache[spec.id];
  if (sh) return sh;
  const def = defFor(spec);
  const b = new Builder();
  def.build(b, spec);
  sh = b.finish([0, spec.gearHeight, def.cgZ ?? spec.length * 0.42]);
  prepareShape(sh);
  let r2 = 0;
  for (const arr of [sh.pos, sh.opos]) for (let i = 0; i < arr.length; i += 3) r2 = Math.max(r2, arr[i] * arr[i] + arr[i + 1] * arr[i + 1] + arr[i + 2] * arr[i + 2]);
  sh.sphere = new THREE.Sphere(new THREE.Vector3(), Math.sqrt(r2) * 1.1 + 1);
  sh.aPos = new THREE.BufferAttribute(sh.pos, 3);
  sh.aSkinI = new THREE.BufferAttribute(sh.skinIndex, 4);
  sh.aSkinW = new THREE.BufferAttribute(sh.skinWeight, 4, true);
  sh.ogeo = null;
  if (sh.opos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sh.opos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(sh.ocol, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(sh.oskinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sh.oskinWeight, 4, true));
    g.boundingSphere = sh.sphere;
    g.userData.shared = true;
    sh.ogeo = g;
  }
  sh.mainZ = sh.anchors.gearMain.length ? sh.anchors.gearMain.reduce((a, p) => a + p[2], 0) / sh.anchors.gearMain.length : 0;
  sh.dims = { L: spec.length, W: spec.span / 2 };
  shapeCache[spec.id] = sh;
  return sh;
}

function liveryOf(def, id) {
  return def.liveries.find((l) => l.id === id) || def.liveries[0];
}

function geoFor(spec, def, sh, liv, enemy) {
  const key = spec.id + '|' + (enemy ? '~enemy' : liv.id);
  let g = geoCache[key];
  if (g) return g;
  const scheme = enemy ? (def.enemyPaint || enemyScheme || (enemyScheme = aggressor())) : liv.paint;
  g = new THREE.BufferGeometry();
  g.setAttribute('position', sh.aPos);
  g.setAttribute('skinIndex', sh.aSkinI);
  g.setAttribute('skinWeight', sh.aSkinW);
  g.setAttribute('color', new THREE.BufferAttribute(paintShape(sh, scheme, sh.dims), 3));
  g.boundingSphere = sh.sphere;
  g.userData.shared = true;
  geoCache[key] = g;
  return g;
}

export const LIVERIES = {};
for (const spec of CATALOG) LIVERIES[spec.id] = defFor(spec).liveries.map((l) => ({ id: l.id, name: l.name }));

export function buildModel(specId, opts = {}) {
  const spec = getSpec(specId);
  const def = defFor(spec);
  if (!LIVERIES[spec.id]) LIVERIES[spec.id] = def.liveries.map((l) => ({ id: l.id, name: l.name }));
  const sh = shapeFor(spec);
  const liv = liveryOf(def, opts.livery);
  const enemy = opts.team === 'enemy';
  const model = createInstance(sh, geoFor(spec, def, sh, liv, enemy), sh.ogeo, {
    groundPitch: def.groundPitch || 0, gearHeight: spec.gearHeight, mainZ: sh.mainZ, fixedGear: !spec.retract, jet: spec.engine === 'jet',
  });
  const A = sh.anchors, v = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const ud = model.userData;
  hookBus();
  ud.dispose = () => ud.rig.skeleton.dispose(); // для тех, кто убирает модель сам (ангар): геометрия и материалы общие, их не трогать
  ud.specId = spec.id;
  ud.livery = enemy ? 'enemy' : liv.id;
  ud.team = opts.team || null;
  ud.anchors = {
    cockpit: A.cockpit ? v(A.cockpit) : new THREE.Vector3(0, 0.8, -spec.length * 0.2),
    engines: A.engines.map(v), props: A.props.map(v), muzzles: A.muzzles.map(v), hardpoints: A.hardpoints.map(v),
    wingtips: A.wingtips.map(v), gearMain: A.gearMain.map(v), gearNose: A.gearNose ? v(A.gearNose) : null,
  };
  ud.groundPitch = def.groundPitch || 0;
  ud.radius = Math.max(spec.span, spec.length) * 0.55;
  ud.tris = sh.tris;
  return model;
}

export function animateModel(model, ac, dt) {
  animate(model, ac, dt);
}

// Общие материалы всех моделей: { bodyMat (Lambert, цвета вершин, гранёный), overlayMat (огни, пламя, диски винтов) }.
// Нужны миру, если он патчит материалы своей дымкой: patchMaterial(modelMaterials().bodyMat) до первого кадра.
export function modelMaterials() {
  return materials();
}
