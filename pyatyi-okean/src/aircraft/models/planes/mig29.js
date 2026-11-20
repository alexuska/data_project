// МиГ-29: интегральная компоновка — наплывы от кабины к крылу, несущий центроплан, две разнесённые гондолы
// с клиновидными воздухозаборниками под ним, два киля с развалом, цельноповоротный стабилизатор.
import { camo, plain } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'mig29', cgZ: 9.3,
  liveries: [
    { id: 'grey', name: 'Серо-голубой камуфляж', paint: camo({ cols: ['#8d9aa3', '#6f8090', '#a7b3ba'], under: '#a9c7da', scale: 1.3, radome: '#555c63' }) },
    { id: 'green', name: 'Зелёно-серый камуфляж', paint: camo({ cols: ['#5f7256', '#8b9a93', '#465a48'], under: '#a9c7da', scale: 1.3, seed: 1.7, radome: '#555c63' }) },
    { id: 'aerobatic', name: 'Пилотажная бело-синяя', paint: plain({ base: '#f3f2ec', radome: '#f3f2ec', emblemA: '#e3b21a', emblemB: '#c9291f',
      extra: (c) => (c.part === 'fin' ? (c.sp > 0.6 ? '#c9291f' : '#1d4c98') : (c.part === 'wing' || c.part === 'htail') ? (c.top ? (c.sp > 0.72 ? '#c9291f' : '#1d4c98') : c.sp > 0.72 ? '#c9291f' : null)
        : c.part === 'fus' && c.ny > 0.6 && c.zn > 0.2 ? '#1d4c98' : c.part === 'nac' && c.ny < -0.3 ? '#c9291f' : null) }) },
  ],
  build(b) {
    b.loft([
      [0, 2.2, 0.02, 0.02], [0.6, 2.2, 0.18, 0.18], [1.8, 2.2, 0.36, 0.38], [3.0, 2.22, 0.46, 0.5, 2.2, 0.5], [4.5, 2.25, 0.5, 0.56, 2.4, 0.55], [6.0, 2.3, 0.55, 0.62, 2.4, 0.5],
      [8.0, 2.3, 0.6, 0.55, 2.4, 0.4], [11.5, 2.25, 0.5, 0.38, 2, 0.3], [14.6, 2.15, 0.3, 0.2, 2, 0.15], [15.6, 2.1, 0.05, 0.06],
    ], { n: 12, part: 'fus', partOf: (i) => (i < 2 ? 'radome' : null) });
    b.canopy([[2.7, 2.64, 0.3, 0.04, 2, 0.04], [3.4, 2.68, 0.4, 0.52, 2.2, 0.04], [4.2, 2.7, 0.42, 0.58, 2.2, 0.04], [5.0, 2.72, 0.38, 0.44, 2.2, 0.04], [5.8, 2.7, 0.28, 0.12, 2, 0.04]], { n: 10, frames: [3.4], sill: 0.47, fw: 0.07 });
    b.withPart('pitot', () => b.cyl([0, 2.2, 0.05], [0, 2.2, -0.7], 0.03, 0.012, 4));
    let w;
    b.mirror(() => {
      // несущий центроплан с наплывом
      b.wing({ part: 'fus', root: [0, 2.05], tr: 0.034, sym: true, f: 0.15, capTip: false,
        st: [[0.3, 3.5, 12.0], [0.9, 4.7, 10.5], [1.35, 6.0, 9.2], [1.78, 7.4, 7.6]] });
      // гондола двигателя с клиновидным воздухозаборником
      b.loft([[6.25, 1.5, 0.5, 0.52, 5, 0.52, 5, -0.9], [7.5, 1.5, 0.56, 0.55, 4], [10, 1.55, 0.58, 0.55, 3], [13.5, 1.65, 0.56, 0.52, 2], [15.3, 1.7, 0.5, 0.5], [16.3, 1.7, 0.42, 0.42]], { n: 12, x: 0.95, part: 'nac',
        capA: { inset: 0.6, s: 0.86, part: 'intake', rim: 'nac' }, capB: { inset: 0.35, s: 0.82, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 4 ? 'nozzle' : null) });
      b.nozzleGlow([0.95, 1.7, 16.3], 0.36, 3.4);
      w = b.wing({ part: 'wing', root: [1.75, 2.05], dih: -2 * D, tr: 0.05, sym: true, sub: 0.95, round: 0.14, tipAnchor: true,
        st: [[0, 7.4, 5.2], [3.78, 10.8, 1.45]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 0.2, s1: 1.85, f: 0.22, max: 0.55 }, { name: 'ailR', ch: 'ail', s0: 1.95, s1: 3.5, f: 0.22, max: 0.36 }] });
      for (const s of [0.75, 1.75, 2.75]) b.pylon(w, s, 0.3, 1.5, 0.2);
      b.emblem(w.at(2.2, 0.55, true), 0.85);
      b.emblem(w.at(2.2, 0.55, false), 0.85);
      // киль с развалом наружу
      const fin = b.wing({ part: 'fin', root: [1.55, 2.15], dih: 84 * D, sym: true, tr: 0.05, sub: 0.5, st: [[0, 10.3, 4.8], [0.35, 11.75, 3.4], [2.55, 14.0, 1.25]], ctl: [{ name: 'rudR', ch: 'rud', s0: 0.6, s1: 2.3, f: 0.25, max: 0.4 }] });
      b.emblem(fin.at(1.3, 0.45, false), 0.7);
      b.wing({ part: 'htail', root: [1.5, 1.95], tr: 0.05, sym: true, st: [[0, 13.7, 3.0], [2.4, 16.15, 0.95]], bone: { name: 'stabR', ch: 'elev', max: 0.3, pu: 0.5 } });
      b.gear({ name: 'gearR', pivot: [1.5, 1.85, 9.75], axle: [1.42, 9.85], r: 0.42, w: 0.22, side: 1, axis: [1, 0, 0], max: 1.5, door: 'side', doorPart: 'nac', doorDir: 1 });
    });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 1.75, 6.1], axle: [0, 6.2], r: 0.29, w: 0.16, axis: [1, 0, 0], max: -1.5, wheels: [[-0.17, 0], [0.17, 0]], door: 'front' });
    const bb = b.addBone('brk', { pivot: [0, 2.3, 14.3], axis: [1, 0, 0], ch: 'brake', max: -0.9, hide: true });
    b.withBone(bb, () => b.door({ pts: [[-0.4, 2.36, 14.3], [0.4, 2.36, 14.3], [0.28, 2.3, 15.7], [-0.28, 2.3, 15.7]], th: 0.05, part: 'fus', inner: 'dark', out: [0, 1, 0] }));
    b.dragChute([0, 2.12, 15.65], 2.3, 9);
    b.lights({ tip: [5.68, 1.92, 11.7], tail: [0, 2.1, 15.7], top: [0, 2.72, 7.5], bottom: [0, 1.6, 9.0], land: [[0, 1.3, 6.0]] });
    b.anchors.cockpit = [0, 3.0, 3.95];
    b.anchors.muzzles.push([-0.85, 2.2, 4.3]);
  },
};
