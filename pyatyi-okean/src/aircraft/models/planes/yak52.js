// Як-52: низкоплан, звездообразный М-14П, двухлопастный винт, длинный «парник» двухместной кабины,
// шасси убирается не полностью — колёса остаются снаружи под крылом и под капотом.
import { civil, plain } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'yak52', cgZ: 2.5,
  liveries: [
    { id: 'dosaaf', name: 'Спортивная красно-белая', paint: civil({
      top: '#f3f1ea', belly: '#f3f1ea', ab: 2, cheat: '#c8281f', a0: 0.42, a1: 0.66, z0: 0.2, z1: 0.9, wing: '#f3f1ea', wingTip: '#c8281f', wingTipFrom: 0.74,
      tailTip: '#c8281f', finBand: [0.55, 2, '#c8281f'], rudder: '#c8281f', spinner: '#c8281f', frame: '#e9e7e0',
      extra: (c) => (c.part === 'cowl' && c.zn < 0.105 ? '#c8281f' : c.part === 'wing' && c.sp < 0.74 && c.top && c.ch < 0.1 ? '#c8281f' : null) }) },
    { id: 'sport', name: 'Пилотажная жёлто-синяя', paint: civil({
      top: '#f2c21b', belly: '#1c3f8c', ab: 0.62, wing: '#f2c21b', wingTip: '#1c3f8c', wingTipFrom: 0.8, tailTip: '#1c3f8c', fin: '#1c3f8c', rudder: '#f2c21b',
      cowl: '#1c3f8c', spinner: '#f3f1ea', frame: '#f2c21b',
      extra: (c) => (c.part === 'wing' && c.top === false ? '#1c3f8c' : null) }) },
    { id: 'army', name: 'Учебная зелёная', paint: plain({ base: '#5c6e3f', under: '#9fc4dc',
      extra: (c) => (c.part === 'fin' && c.ctl && c.sp > 0.45 && c.sp < 0.7 ? '#f3f1ea' : c.part === 'spinner' ? '#c8281f' : c.part === 'fus' && c.zn > 0.66 && c.zn < 0.7 ? '#e7c41c' : null) }) },
  ],
  build(b) {
    const yc = 1.3;
    // капот со «звездой»
    b.loft([[0.4, yc, 0.4, 0.4], [0.5, yc, 0.5, 0.5], [0.72, yc, 0.545, 0.545], [1.4, yc, 0.55, 0.56]], { n: 12, part: 'cowl', capA: { inset: 0.1, s: 0.74, part: 'intake', rim: 'cowl' } });
    b.loft([[0.0, yc, 0.02, 0.02], [0.12, yc, 0.12, 0.12], [0.3, yc, 0.17, 0.17], [0.46, yc, 0.18, 0.18]], { n: 8, part: 'spinner' });
    b.loft([[1.4, yc, 0.53, 0.55, 2.3], [1.95, yc - 0.02, 0.5, 0.56, 2.6, 0.5], [3.0, yc - 0.03, 0.48, 0.52, 2.6, 0.5], [4.5, yc, 0.42, 0.5, 2.4, 0.44], [5.6, yc + 0.08, 0.28, 0.4, 2.2, 0.32], [6.7, yc + 0.17, 0.13, 0.3, 2, 0.2], [7.45, yc + 0.22, 0.03, 0.14]], { n: 12, part: 'fus' });
    // длинный фонарь двух кабин
    b.canopy([[1.82, 1.74, 0.3, 0.04, 2, 0.04], [2.3, 1.74, 0.37, 0.5, 2.5, 0.04], [3.0, 1.74, 0.38, 0.53, 2.5, 0.04], [3.7, 1.74, 0.38, 0.53, 2.5, 0.04], [4.25, 1.74, 0.36, 0.48, 2.5, 0.04], [4.9, 1.74, 0.26, 0.06, 2, 0.04]], { n: 10, frames: [2.3, 3.02, 3.7, 4.25], sill: 0.47, fw: 0.07 });
    b.withPart('exhaust', () => { for (const sx of [-1, 1]) b.cyl([sx * 0.2, 0.86, 1.2], [sx * 0.22, 0.74, 1.62], 0.05, 0.05, 5); });
    let w;
    b.mirror(() => {
      w = b.wing({ part: 'wing', root: [0.4, 0.88], dih: 3.2 * D, tr: 0.145, round: 0.14, tipAnchor: true, sub: 1.4,
        st: [[0, 1.8, 2.0], [4.1, 2.2, 1.12, 0, 0.1]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 0.08, s1: 1.9, f: 0.24, max: 0.8 }, { name: 'ailR', ch: 'ail', s0: 1.98, s1: 4.05, f: 0.27, max: 0.4 }] });
      b.wing({ part: 'htail', root: [0.1, 1.58], tr: 0.09, sym: true, round: 0.1, st: [[0, 6.12, 1.2], [1.38, 6.4, 0.7]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.06, s1: 1.42, f: 0.42, max: 0.45 }] });
      b.gear({ name: 'gearR', pivot: [1.26, 0.86, 2.62], axle: [1.26, 2.72], r: 0.25, w: 0.15, side: 1, axis: [1, 0, 0], max: 1.42, noHide: true });
    });
    b.wing({ part: 'fin', root: [0, 1.55], dih: 90 * D, sym: true, tr: 0.08, round: 0.12, sub: 0.4, st: [[-0.05, 5.7, 2.0], [0.5, 6.25, 1.48], [1.04, 6.78, 0.95]], ctl: [{ name: 'rud', ch: 'rud', s0: -0.05, s1: 1.1, f: 0.46, max: 0.45 }] });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 0.9, 1.05], axle: [0, 0.98], r: 0.2, w: 0.13, axis: [1, 0, 0], max: -1.35, noHide: true });
    b.prop({ c: [0, yc, 0.28], r: 1.2, blades: 2, chord: 0.2 });
    b.lights({ tip: [4.66, 1.13, 2.75], tail: [0, 1.75, 7.75], top: [0, 2.3, 3.4], land: [[-1.9, 0.92, 2.05]] });
    b.anchors.cockpit = [0, 2.0, 2.65];
  },
};
