// Бе-200: реактивная летающая лодка — корпус с реданом и скулами, высокое стреловидное крыло с винглетами,
// двигатели над крылом у фюзеляжа, подкрыльевые поплавки, Т-образное оперение.
import { civil, plain } from '../paint.js';

const D = Math.PI / 180;

// полуконтур лодки: w — полуширина, t — верх, c — скула, k — киль
const hull = (z, w, t, c, k) => ({ z, pts: [[0, t], [w * 0.5, t - (t - c) * 0.06], [w * 0.9, t - (t - c) * 0.28], [w, t - (t - c) * 0.6], [w * 1.04, c], [w * 0.52, (c + k) / 2 - (c - k) * 0.08], [0, k]] });

export default {
  id: 'be200', cgZ: 14.9,
  liveries: [
    { id: 'rescue', name: 'Спасательная бело-оранжевая', paint: civil({
      top: '#f3f2ec', belly: '#f3f2ec', ab: 2, cheat: '#e8641c', a0: 0.34, a1: 0.5, cheat2: '#1d4c98', b0: 0.5, b1: 0.67, z0: 0.06, z1: 0.93, wing: '#e4e6e6',
      wingTip: '#e8641c', wingTipFrom: 0.9, fin: '#f3f2ec', finBand: [[0.35, 0.58, '#e8641c'], [0.58, 0.72, '#1d4c98']], nac: '#f3f2ec', float: '#e8641c', pylon: '#f3f2ec', radome: '#3a3f44', tailTip: '#e8641c',
      extra: (c) => (c.part === 'fus' && c.a > 0.84 ? '#b9c0c6' : null) }) },
    { id: 'factory', name: 'Бело-сине-красная', paint: civil({
      top: '#f3f2ec', belly: '#1d4c98', ab: 0.67, cheat: '#c9291f', a0: 0.5, a1: 0.67, z0: 0.04, z1: 0.96, wing: '#e4e6e6',
      fin: '#f3f2ec', finBand: [[0.5, 0.68, '#1d4c98'], [0.68, 0.85, '#c9291f']], nac: '#1d4c98', float: '#1d4c98', pylon: '#f3f2ec', radome: '#3a3f44' }) },
    { id: 'navy', name: 'Морская серая', paint: plain({ base: '#8d99a3', under: '#b5c2cb', radome: '#4a4f55',
      extra: (c) => (c.part === 'float' ? '#6f7c88' : c.part === 'fin' && c.sp > 0.8 ? '#e3b21a' : null) }) },
  ],
  build(b) {
    const fus = b.loft([
      hull(0, 0.04, 3.45, 3.35, 3.3), hull(1.2, 0.75, 3.95, 2.8, 2.25), hull(2.2, 1.08, 4.2, 2.45, 1.6), hull(3.1, 1.27, 4.82, 2.22, 1.12), hull(4.2, 1.38, 4.95, 2.05, 0.85), hull(5.5, 1.43, 5.0, 1.95, 0.68), hull(10, 1.43, 5.0, 1.82, 0.56),
      hull(15.5, 1.43, 5.0, 1.82, 0.62), hull(15.62, 1.43, 5.0, 1.98, 0.98), hull(21, 1.2, 5.0, 2.65, 1.95), hull(26, 0.8, 5.05, 3.55, 3.15), hull(30.6, 0.3, 5.2, 4.55, 4.35), hull(31.2, 0.04, 5.25, 4.95, 4.9),
    ], { n: 12, part: 'fus', frames: [3.1, 3.65], fw: 0.09, partOf: (i, k, s, a, fr) => (i === 0 ? 'radome' : fr ? null : (i === 2 && k <= 1) || (i === 3 && k >= 1 && k <= 2) ? 'glass' : null) });
    b.windows(fus, { z0: 6.3, z1: 13.8, count: 7, a: 0.42, w: 0.3, h: 0.4 });
    b.mirror(() => {
      const an = Math.tan(-1.5 * D);
      const w = b.wing({ part: 'wing', root: [0, 5.06], tr: 0.12, sub: 2.8,
        st: [[0, 11.2, 5.4], [4.5, 13.1, 4.0, 4.5 * an], [15.9, 17.95, 1.9, 15.9 * an, 0.1]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 3.6, s1: 9.6, f: 0.27, max: 0.7, slide: [0, -0.1, 0.4] }, { name: 'ailR', ch: 'ail', s0: 10.9, s1: 15.6, f: 0.27, max: 0.36 }] });
      b.spoiler(w, 'spoilR', 5.0, 9.4, 0.6, 0.71);
      // винглет
      b.wing({ part: 'wing', root: [15.9, 4.68, 0], dih: 72 * D, sym: true, tr: 0.08, tipAnchor: true, st: [[0, 18.15, 1.7], [1.45, 19.25, 0.75]], meta: { sp: 1 } });
      // двигатель над крылом у фюзеляжа
      b.loft([[14.9, 6.5, 0.68, 0.68], [15.5, 6.5, 0.84, 0.84], [17.6, 6.5, 0.84, 0.84], [18.8, 6.5, 0.66, 0.66], [19.4, 6.5, 0.5, 0.5]], { n: 12, x: 2.35, part: 'nac',
        capA: { inset: 0.35, s: 0.78, part: 'intake', rim: 'lip' }, capB: { inset: 0.3, s: 0.8, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 3 ? 'nozzle' : null) });
      b.wing({ part: 'pylon', root: [1.0, 5.1, 0], dih: 42 * D, sym: true, tr: 0.12, st: [[0, 14.6, 4.2], [1.6, 15.3, 3.4]] });
      b.nozzleGlow([2.35, 6.5, 19.4], 0.45);
      // поплавок на пилоне
      const fp = w.at(12.3, 0.45, false).p;
      b.loft([[fp[2] - 1.6, 2.95, 0.03, 0.03], [fp[2] - 0.8, 2.9, 0.3, 0.34], [fp[2] + 0.6, 2.9, 0.34, 0.36], [fp[2] + 1.6, 3.0, 0.22, 0.24], [fp[2] + 2.3, 3.1, 0.03, 0.03]], { n: 8, x: 12.3, part: 'float' });
      b.wing({ part: 'pylon', root: [12.3, fp[1] + 0.05, 0], dih: -90 * D, sym: true, tr: 0.1, st: [[0, fp[2] - 0.5, 1.6], [1.5, fp[2] - 0.35, 1.3]] });
      b.gear({ name: 'gearR', pivot: [1.5, 2.3, 16.0], axle: [2.15, 16.14], r: 0.48, w: 0.28, strut: 0.09, axis: [1, 0, 0], max: -1.5, wheels: [[-0.24, 0], [0.24, 0]] });
      b.loft([[14.6, 2.3, 0.03, 0.03], [15.6, 2.3, 0.4, 0.5], [17.4, 2.35, 0.42, 0.52], [19.6, 2.6, 0.03, 0.03]], { n: 8, x: 1.35, part: 'fus', meta: { a: 0.6 } });
      b.wing({ part: 'htail', root: [0, 8.82], tr: 0.1, sym: true, st: [[0, 27.2, 3.6], [5.05, 30.2, 1.7]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.4, s1: 4.9, f: 0.3, max: 0.4 }] });
    });
    b.wing({ part: 'fin', root: [0, 5.15], dih: 90 * D, sym: true, tr: 0.1, sub: 0.7, st: [[0, 24.3, 6.2], [3.6, 27.4, 3.9]], ctl: [{ name: 'rud', ch: 'rud', s0: 0.5, s1: 3.4, f: 0.3, max: 0.4 }] });
    b.loft([[26.4, 8.82, 0.02, 0.02], [27.3, 8.82, 0.24, 0.26], [30.4, 8.82, 0.24, 0.26], [31.9, 8.82, 0.03, 0.03]], { n: 8, part: 'fin' });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 1.6, 5.0], axle: [0, 5.0], r: 0.34, w: 0.22, axis: [1, 0, 0], max: -1.5, wheels: [[-0.22, 0], [0.22, 0]], door: 'front' });
    b.label(fus, 'RA-21512', 19.5, 0.34, 0.42);
    b.blade(fus.at(5.5, 0.0), 0.32, 0.35);
    b.lights({ tip: [16.35, 6.05, 19.5], tail: [0, 5.2, 31.3], top: [0, 5.05, 9], bottom: [0, 0.6, 9], land: [[1.0, 2.6, 3.0], [-1.0, 2.6, 3.0]], strobe: true, scale: 1.2 });
    b.anchors.cockpit = [0.45, 4.45, 3.3];
  },
};
