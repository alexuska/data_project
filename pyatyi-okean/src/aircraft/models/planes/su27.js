// Су-27: интегральная компоновка с опущенным носом-«клювом», большой каплевидный фонарь, наплывы,
// разнесённые гондолы под несущим корпусом, два вертикальных киля, подфюзеляжные гребни и длинная хвостовая балка.
import { camo, plain } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'su27', cgZ: 11.6,
  liveries: [
    { id: 'blue', name: 'Серо-голубой камуфляж', paint: camo({ cols: ['#8fb0cc', '#5f86ad', '#b9cfdc', '#7399bd'], under: '#b5d3e6', scale: 1.0, radome: '#e8e8e2' }) },
    { id: 'aerobatic', name: 'Пилотажная бело-сине-красная', paint: plain({ base: '#f3f2ec', radome: '#f3f2ec', emblemA: '#e3b21a', emblemB: '#c9291f',
      extra: (c) => (c.part === 'fin' ? (c.sp > 0.62 ? '#c9291f' : '#1d4c98') : (c.part === 'wing' || c.part === 'htail') ? (c.sp > 0.7 ? '#c9291f' : c.top ? '#1d4c98' : null)
        : c.part === 'fus' && c.ny > 0.6 && c.zn > 0.25 ? '#1d4c98' : c.part === 'nac' && c.ny < -0.3 ? '#1d4c98' : c.part === 'vfin' ? '#c9291f' : null) }) },
    { id: 'navy', name: 'Морской тёмно-серый', paint: camo({ cols: ['#6f7f8c', '#55636f', '#8494a0'], under: '#9fb3c2', scale: 1.0, seed: 2.6, radome: '#d9d9d2' }) },
  ],
  build(b) {
    b.loft([
      [0, 2.5, 0.02, 0.02], [1.0, 2.55, 0.3, 0.3], [2.6, 2.7, 0.52, 0.52], [4.0, 2.85, 0.6, 0.66, 2.2], [5.5, 2.95, 0.64, 0.75, 2.4, 0.6], [7.5, 2.95, 0.68, 0.72, 2.4, 0.5],
      [10, 2.85, 0.75, 0.55, 2.4, 0.35], [14, 2.75, 0.6, 0.4, 2, 0.3], [18, 2.65, 0.4, 0.3], [20.5, 2.6, 0.26, 0.24], [21.9, 2.6, 0.08, 0.1],
    ], { n: 12, part: 'fus', capB: true, partOf: (i) => (i < 2 ? 'radome' : null) });
    b.canopy([[3.45, 3.36, 0.3, 0.04, 2, 0.04], [4.3, 3.43, 0.44, 0.56, 2.2, 0.04], [5.2, 3.48, 0.46, 0.62, 2.2, 0.04], [6.2, 3.48, 0.42, 0.48, 2.2, 0.04], [7.1, 3.44, 0.3, 0.12, 2, 0.04]], { n: 10, frames: [4.3], sill: 0.47, fw: 0.08 });
    b.withPart('dark', () => b.cyl([0, 3.42, 3.25], [0, 3.42, 3.45], 0.1, 0.1, 6));
    b.withPart('pitot', () => b.cyl([0, 2.5, 0.05], [0, 2.48, -0.6], 0.03, 0.012, 4));
    let w;
    b.mirror(() => {
      // несущий корпус с наплывом и хвостовыми балками
      b.wing({ part: 'fus', root: [0, 2.55], tr: 0.03, sym: true, f: 0.12, capTip: false,
        st: [[0.4, 4.9, 15.0], [1.2, 6.6, 12.9], [1.9, 8.2, 10.9], [2.32, 9.3, 9.5]] });
      b.loft([[8.0, 1.9, 0.52, 0.55, 5, 0.55, 5, -0.9], [9.5, 1.9, 0.6, 0.62, 4], [12, 1.95, 0.64, 0.62, 3], [16.5, 2.05, 0.62, 0.58, 2], [18.4, 2.1, 0.58, 0.58], [19.4, 2.1, 0.5, 0.5]], { n: 12, x: 1.3, part: 'nac',
        capA: { inset: 0.6, s: 0.86, part: 'intake', rim: 'nac' }, capB: { inset: 0.4, s: 0.82, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 4 ? 'nozzle' : null) });
      b.nozzleGlow([1.3, 2.1, 19.4], 0.44, 4.2);
      w = b.wing({ part: 'wing', root: [2.3, 2.55], tr: 0.045, sym: true, sub: 1.0,
        st: [[0, 9.3, 6.0], [4.85, 13.65, 1.9]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 0.3, s1: 1.7, f: 0.2, max: 0.5 }, { name: 'ailR', ch: 'ail', s0: 1.8, s1: 3.3, f: 0.2, max: 0.34 }] });
      // пусковое устройство на законцовке
      b.withPart('pylon', () => b.cyl([7.25, 2.55, 13.3], [7.25, 2.55, 16.1], 0.07, 0.07, 5));
      b.anchors.wingtips.push([7.32, 2.55, 14.7]);
      b.anchors.hardpoints.push([7.25, 2.45, 14.7]);
      for (const s of [1.0, 2.3, 3.6]) b.pylon(w, s, 0.3, 1.8, 0.22);
      b.anchors.hardpoints.push([1.3, 1.3, 13.5]);
      b.emblem(w.at(2.9, 0.55, true), 1.1);
      b.emblem(w.at(2.9, 0.55, false), 1.1);
      const fin = b.wing({ part: 'fin', root: [2.15, 2.7], dih: 90 * D, sym: true, tr: 0.045, sub: 0.6, st: [[0, 13.9, 4.2], [3.22, 16.6, 1.5]], ctl: [{ name: 'rudR', ch: 'rud', s0: 0.35, s1: 2.6, f: 0.27, max: 0.4 }] });
      b.emblem(fin.at(1.5, 0.42, false), 0.9);
      b.wing({ part: 'vfin', root: [2.15, 2.42], dih: -90 * D, sym: true, tr: 0.05, st: [[0, 16.6, 2.4], [0.75, 17.3, 1.5]] });
      b.wing({ part: 'htail', root: [2.2, 2.5], tr: 0.045, sym: true, st: [[0, 17.0, 3.3], [2.75, 19.6, 1.1]], bone: { name: 'stabR', ch: 'elev', max: 0.3, pu: 0.5 } });
      b.gear({ name: 'gearR', pivot: [2.02, 2.3, 12.15], axle: [2.02, 12.3], r: 0.52, w: 0.3, side: 1, axis: [1, 0, 0], max: 1.5, door: 'side', doorPart: 'nac', doorDir: 1 });
    });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 2.2, 6.45], axle: [0, 6.5], r: 0.34, w: 0.2, axis: [1, 0, 0], max: 1.5, door: 'front' });
    // большой тормозной щиток на спине
    const bb = b.addBone('brk', { pivot: [0, 3.35, 7.6], axis: [1, 0, 0], ch: 'brake', max: -0.95, hide: true });
    b.withBone(bb, () => b.door({ pts: [[-0.55, 3.3, 7.6], [0.55, 3.3, 7.6], [0.5, 3.12, 10.4], [-0.5, 3.12, 10.4]], th: 0.06, part: 'fus', inner: 'dark', out: [0, 1, 0] }));
    b.dragChute([0, 2.62, 21.95], 3.4, 11);
    b.lights({ tip: [7.32, 2.55, 14.9], tail: [0, 2.6, 22.0], top: [0, 3.36, 8.6], bottom: [0, 2.05, 10.5], land: [[0, 1.5, 6.3]] });
    b.anchors.cockpit = [0, 3.8, 4.95];
    b.anchors.muzzles.push([0.95, 2.95, 5.6]);
  },
};
