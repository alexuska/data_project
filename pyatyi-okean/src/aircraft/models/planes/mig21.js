// МиГ-21бис: фюзеляж-«труба» с лобовым воздухозаборником и конусом, треугольное крыло,
// цельноповоротный стабилизатор, широкий киль с гребнем под хвостом, гаргрот от фонаря до киля.
import { camo, plain } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'mig21', cgZ: 7.35,
  liveries: [
    { id: 'silver', name: 'Серебристая (неокрашенный металл)', paint: plain({ base: '#b9c0c6', radome: '#3f7a4c', finish: 'metal',
      extra: (c) => (c.part === 'fin' && c.sp > 0.86 ? '#3f7a4c' : c.part === 'fus' && c.zn < 0.055 ? '#9aa1a7' : null) }) },
    { id: 'camo', name: 'Зелёно-коричневый камуфляж', paint: camo({ cols: ['#5d6d3c', '#8a7347', '#3f5432'], under: '#9fc4dc', scale: 1.5, radome: '#3f7a4c' }) },
    { id: 'grey', name: 'Серо-голубой камуфляж', paint: camo({ cols: ['#8795a0', '#687a8a', '#a3b0b8'], under: '#a9c7da', scale: 1.5, radome: '#3f7a4c', seed: 2 }) },
  ],
  build(b) {
    const yc = 1.62;
    b.loft([[0.55, yc, 0.44, 0.44], [1.4, yc, 0.52, 0.52], [3.0, yc, 0.6, 0.6], [5.5, yc, 0.62, 0.64], [10.5, yc, 0.62, 0.62], [12.6, yc, 0.56, 0.56], [13.55, yc, 0.5, 0.5]],
      { n: 12, part: 'fus', capA: { inset: 0.5, s: 0.86, part: 'intake', rim: 'lip' }, capB: { inset: 0.4, s: 0.82, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 5 ? 'nozzle' : null) });
    b.loft([[0, yc, 0.01, 0.01], [0.5, yc, 0.17, 0.17], [1.05, yc, 0.3, 0.3]], { n: 8, part: 'radome' });
    b.nozzleGlow([0, yc, 13.55], 0.4, 3.2);
    // фонарь и гаргрот
    b.canopy([[2.5, 2.08, 0.3, 0.04, 2, 0.04], [3.1, 2.1, 0.38, 0.44, 2.3, 0.04], [3.75, 2.1, 0.38, 0.46, 2.3, 0.04], [4.35, 2.1, 0.36, 0.4, 2.3, 0.04]], { n: 10, frames: [3.1], sill: 0.47, fw: 0.07 });
    b.loft([[4.35, 2.1, 0.36, 0.4, 2.3, 0.3], [6.5, 2.1, 0.32, 0.32, 2, 0.3], [9.5, 2.05, 0.2, 0.24, 2, 0.2], [10.8, 2.05, 0.05, 0.12]], { n: 8, part: 'fus', meta: { a: 0.1 } });
    b.withPart('pitot', () => b.cyl([0.22, 2.02, 1.7], [0.22, 2.08, -0.95], 0.03, 0.015, 4));
    let w;
    b.mirror(() => {
      w = b.wing({ part: 'wing', root: [0.5, 1.5], dih: -2 * D, tr: 0.045, sym: true, sub: 0.8, tipAnchor: true,
        st: [[0, 5.15, 5.3], [3.06, 9.87, 0.62]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 0.12, s1: 1.4, f: 0.2, max: 0.6 }, { name: 'ailR', ch: 'ail', s0: 1.48, s1: 2.9, f: 0.22, max: 0.36 }] });
      b.pylon(w, 0.95, 0.5, 1.5, 0.2);
      b.pylon(w, 1.85, 0.4, 1.2, 0.18);
      b.emblem(w.at(1.75, 0.6, true), 0.75);
      b.emblem(w.at(1.75, 0.6, false), 0.75);
      b.wing({ part: 'htail', root: [0.5, yc], tr: 0.05, sym: true, st: [[0, 11.5, 2.2], [1.38, 13.5, 0.75]], bone: { name: 'stabR', ch: 'elev', max: 0.3, pu: 0.55 } });
      b.gear({ name: 'gearR', pivot: [1.15, 1.42, 7.9], axle: [1.2, 7.9], r: 0.4, w: 0.2, side: 1, axis: [0, 0, 1], max: -1.5, door: 'side' });
    });
    const fin = b.wing({ part: 'fin', root: [0, 2.15], dih: 90 * D, sym: true, tr: 0.05, sub: 0.45, st: [[0, 9.2, 4.7], [1.95, 13.0, 1.65]], ctl: [{ name: 'rud', ch: 'rud', s0: 0.3, s1: 1.8, f: 0.27, max: 0.4 }] });
    b.emblem(fin.at(0.9, 0.42, true), 0.7);
    b.emblem(fin.at(0.9, 0.42, false), 0.7);
    b.wing({ part: 'vfin', root: [0, 1.04], dih: -90 * D, sym: true, tr: 0.05, st: [[0, 10.6, 2.7], [0.5, 11.8, 1.4]] });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 1.05, 3.2], axle: [0, 3.2], r: 0.25, w: 0.14, axis: [1, 0, 0], max: 1.5, door: 'front' });
    const bb = b.addBone('brk', { pivot: [0, 1.0, 8.6], axis: [1, 0, 0], ch: 'brake', max: 0.8, hide: true });
    b.withBone(bb, () => b.door({ pts: [[-0.25, 0.99, 8.6], [0.25, 0.99, 8.6], [0.25, 0.99, 9.6], [-0.25, 0.99, 9.6]], th: 0.04, part: 'fus', inner: 'dark', out: [0, -1, 0] }));
    b.dragChute([0, 2.35, 13.9], 2.25, 9);
    b.lights({ tip: [3.58, 1.38, 10.2], tail: [0, 4.0, 14.6], top: [0, 2.48, 6.0], bottom: [0, 0.98, 6.5], land: [[0.9, 1.4, 6.6]] });
    b.anchors.cockpit = [0, 2.42, 3.55];
    b.anchors.muzzles.push([0, 0.95, 5.2]);
  },
};
