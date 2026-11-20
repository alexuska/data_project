// Л-39 «Альбатрос»: тандемная кабина с длинным ступенчатым фонарём, боковые воздухозаборники над крылом,
// прямое крыло с несъёмными концевыми баками, один двигатель.
import { camo, plain } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'l39', cgZ: 6.25,
  liveries: [
    { id: 'trainer', name: 'Учебная серебристая', paint: plain({ base: '#c3c9ce', radome: '#c3c9ce',
      extra: (c) => (c.part === 'tank' ? '#e8611c' : c.part === 'fin' && c.sp > 0.72 ? '#e8611c' : c.part === 'fus' && c.zn > 0.035 && c.zn < 0.1 ? '#e8611c'
        : c.part === 'wing' && c.sp > 0.8 ? '#e8611c' : c.part === 'fus' && c.a != null && c.a < 0.17 && c.zn < 0.2 ? '#2b2f33' : null) }) },
    { id: 'aerobatic', name: 'Пилотажная сине-белая', paint: plain({ base: '#f3f2ec', radome: '#1d4c98', emblemA: '#e3b21a', emblemB: '#c9291f',
      extra: (c) => (c.part === 'tank' ? '#c9291f' : c.part === 'fin' ? (c.sp > 0.55 ? '#c9291f' : '#1d4c98') : c.part === 'fus' && c.a != null && c.a < 0.34 ? '#1d4c98'
        : (c.part === 'wing' || c.part === 'htail') && c.top ? (c.ch < 0.3 ? '#c9291f' : '#1d4c98') : c.part === 'frame' ? '#1d4c98' : null) }) },
    { id: 'camo', name: 'Зелёно-коричневый камуфляж', paint: camo({ cols: ['#5d6d3c', '#8a7347', '#3f5432'], under: '#9fc4dc', scale: 1.5, radome: '#3f5432' }) },
  ],
  build(b) {
    const fus = b.loft([
      [0, 1.25, 0.02, 0.02], [0.6, 1.28, 0.2, 0.2], [1.6, 1.36, 0.36, 0.4], [2.6, 1.42, 0.45, 0.52, 2.4], [4.2, 1.45, 0.5, 0.6, 2.6, 0.55], [5.6, 1.5, 0.52, 0.62, 2.6, 0.55],
      [7.6, 1.55, 0.5, 0.58, 2.4, 0.5], [9.5, 1.65, 0.4, 0.45], [11.0, 1.72, 0.3, 0.3], [11.45, 1.72, 0.27, 0.27],
    ], { n: 12, part: 'fus', capB: { inset: 0.25, s: 0.8, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 0 ? 'radome' : i === 8 ? 'nozzle' : null) });
    b.nozzleGlow([0, 1.72, 11.45], 0.22);
    // ступенчатый фонарь двух кабин и гаргрот за ним
    b.canopy([[1.95, 1.74, 0.3, 0.04, 2, 0.04], [2.6, 1.78, 0.4, 0.5, 2.4, 0.04], [3.4, 1.85, 0.42, 0.56, 2.4, 0.04], [4.2, 1.92, 0.42, 0.62, 2.4, 0.04], [4.9, 1.95, 0.4, 0.56, 2.4, 0.04], [5.5, 1.95, 0.36, 0.48, 2.4, 0.04]],
      { n: 10, frames: [2.6, 3.5, 3.72, 4.9], sill: 0.47, fw: 0.07 });
    b.loft([[5.5, 1.95, 0.36, 0.48, 2.4, 0.2], [6.6, 1.95, 0.3, 0.3, 2, 0.2], [8.4, 1.9, 0.15, 0.2, 2, 0.1], [9.3, 1.9, 0.03, 0.08]], { n: 8, part: 'fus', meta: { a: 0.1 } });
    let w, fin;
    b.mirror(() => {
      // воздухозаборник на борту над крылом
      b.loft([[4.85, 1.78, 0.2, 0.3, 2.6], [5.3, 1.78, 0.25, 0.34, 2.6], [6.8, 1.72, 0.13, 0.2], [7.7, 1.66, 0.02, 0.05]], { n: 8, x: 0.62, part: 'fus', capA: { inset: 0.2, s: 0.75, part: 'intake', rim: 'lip' }, meta: { a: 0.4 } });
      w = b.wing({ part: 'wing', root: [0.4, 1.03], dih: 2.5 * D, tr: 0.12, sym: true, sub: 1.3,
        st: [[0, 4.95, 2.75], [4.05, 5.45, 1.42]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 0.15, s1: 2.0, f: 0.26, max: 0.75 }, { name: 'ailR', ch: 'ail', s0: 2.1, s1: 3.98, f: 0.26, max: 0.38 }] });
      b.loft([[4.55, 1.2, 0.02, 0.02], [5.0, 1.2, 0.17, 0.17], [6.0, 1.2, 0.21, 0.21], [6.8, 1.2, 0.16, 0.16], [7.35, 1.2, 0.02, 0.02]], { n: 8, x: 4.52, part: 'tank' });
      b.anchors.wingtips.push([4.73, 1.2, 6.0]);
      b.pylon(w, 1.55, 0.3, 1.1, 0.2);
      b.emblem(w.at(2.9, 0.52, true), 0.8);
      b.emblem(w.at(2.9, 0.52, false), 0.8);
      b.gear({ name: 'gearR', pivot: [1.08, 0.98, 6.6], axle: [1.1, 6.64], r: 0.3, w: 0.18, side: 1, axis: [0, 0, 1], max: -1.5, door: 'side' });
      b.wing({ part: 'htail', root: [0.1, 2.25], tr: 0.08, sym: true, st: [[0, 10.15, 1.55], [2.1, 10.9, 0.75]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.15, s1: 2.05, f: 0.36, max: 0.42 }] });
    });
    fin = b.wing({ part: 'fin', root: [0, 1.95], dih: 90 * D, sym: true, tr: 0.08, sub: 0.5, st: [[0, 8.6, 3.2], [2.75, 10.85, 1.25]], ctl: [{ name: 'rud', ch: 'rud', s0: 0.45, s1: 2.6, f: 0.3, max: 0.42 }] });
    b.emblem(fin.at(1.3, 0.4, true), 0.7);
    b.emblem(fin.at(1.3, 0.4, false), 0.7);
    b.gear({ name: 'gearN', nose: true, pivot: [0, 1.0, 2.25], axle: [0, 2.25], r: 0.22, w: 0.14, axis: [1, 0, 0], max: 1.5, door: 'front' });
    // тормозные щитки под фюзеляжем
    for (const sx of [-1, 1]) {
      const bb = b.addBone('brk' + sx, { pivot: [sx * 0.25, 0.93, 4.1], axis: [1, 0, 0], ch: 'brake', max: 0.95, hide: true });
      b.withBone(bb, () => b.door({ pts: [[sx * 0.06, 0.92, 4.1], [sx * 0.44, 0.95, 4.1], [sx * 0.44, 0.95, 4.9], [sx * 0.06, 0.92, 4.9]], th: 0.04, part: 'fus', inner: 'dark', out: [0, -1, 0] }));
    }
    b.label(fus, '07', 2.3, 0.45, 0.3, 'bort');
    b.lights({ tip: [4.73, 1.2, 6.0], tail: [0, 2.0, 12.0], top: [0, 4.75, 11.7], bottom: [0, 0.92, 6.0], land: [[0, 1.0, 1.9]] });
    b.anchors.cockpit = [0, 2.2, 3.05];
    b.anchors.muzzles.push([0, 0.95, 2.6]);
  },
};
