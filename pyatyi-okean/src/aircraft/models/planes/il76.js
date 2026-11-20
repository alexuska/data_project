// Ил-76ТД: высокоплан со стреловидным крылом и отрицательным V, четыре двигателя на пилонах, Т-образное оперение,
// остеклённая кабина штурмана под носовым обтекателем, вздёрнутый хвост с рампой, обтекатели шасси по бортам.
import { civil, plain } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'il76', cgZ: 20.6,
  liveries: [
    { id: 'classic', name: 'Бело-синяя классическая', paint: civil({
      top: '#f3f2ec', belly: '#aeb5bc', ab: 0.56, cheat: '#1d4c98', a0: 0.31, a1: 0.44, z0: 0.05, z1: 0.9, wing: '#c6cbd0',
      finBand: [0.3, 0.55, '#1d4c98'], nac: '#c6cbd0', pylon: '#c6cbd0', radome: '#3a3f44' }) },
    { id: 'rescue', name: 'Спасательная бело-оранжевая', paint: civil({
      top: '#f3f2ec', belly: '#f3f2ec', ab: 2, cheat: '#e8641c', a0: 0.3, a1: 0.4, cheat2: '#1d4c98', b0: 0.4, b1: 0.5, z0: 0.05, z1: 0.9, wing: '#d2d6da',
      wingTip: '#e8641c', wingTipFrom: 0.9, finBand: [[0.3, 0.5, '#e8641c'], [0.5, 0.62, '#1d4c98']], nac: '#f3f2ec', pylon: '#d2d6da', radome: '#3a3f44', tailTip: '#e8641c' }) },
    { id: 'army', name: 'Серая транспортная', paint: plain({ base: '#8b949a', under: '#a8b4bc', radome: '#4a4f55',
      extra: (c) => (c.part === 'fin' && c.sp > 0.3 && c.sp < 0.42 ? '#e3b21a' : null) }) },
  ],
  build(b) {
    const yc = 3.35, R = 2.4;
    const fus = b.loft([
      [0, 3.0, 0.03, 0.03], [0.8, 3.0, 0.9, 0.75, 2, 0.85], [2.2, 3.1, 1.7, 1.45, 2, 1.6], [4.2, 3.25, 2.2, 2.2, 2, 2.15], [6.0, yc, R, R], [24.0, yc, R, R],
      [30, 3.95, 2.2, 1.85, 2, 1.7], [36, 4.8, 1.6, 1.3, 2, 1.0], [41, 5.5, 0.95, 0.8, 2, 0.6], [44.3, 5.9, 0.4, 0.45], [44.9, 5.95, 0.05, 0.06],
    ], { n: 16, part: 'fus',
      frames: [1.5, 3.2], fw: 0.11,
      partOf: (i, k, s, a, fr) => (i === 0 ? 'radome' : fr ? null : i === 1 && k >= 4 && k <= 6 ? 'glass' : i === 2 && k >= 1 && k <= 3 ? 'glass' : i === 2 && k >= 6 ? 'radome' : null) });
    // обтекатель центроплана сверху и обтекатели шасси по бортам
    b.loft([[12.2, 5.5, 0.1, 0.05], [14.0, 5.55, 1.7, 0.6], [19.5, 5.6, 2.0, 0.75], [23.0, 5.55, 1.6, 0.5], [26.0, 5.5, 0.1, 0.05]], { n: 10, part: 'fus', meta: { a: 0 } });
    b.mirror(() => {
      b.loft([[15.8, 1.75, 0.05, 0.05], [17.6, 1.7, 0.7, 0.95], [21.5, 1.7, 0.85, 1.05], [25.0, 1.8, 0.7, 0.9], [28.0, 2.0, 0.05, 0.05]], { n: 10, x: 2.25, part: 'fus', meta: { a: 0.9 } });
      const an = Math.tan(-3 * D);
      const w = b.wing({ part: 'wing', root: [0, 5.85], tr: 0.12, tipAnchor: true, sub: 3.6,
        st: [[0, 13.6, 9.6], [2.4, 14.85, 8.6, 2.4 * an], [25.05, 26.6, 3.0, 25.05 * an, 0.09]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 2.9, s1: 9.9, f: 0.27, max: 0.75, slide: [0, -0.15, 0.7] }, { name: 'flapR2', ch: 'flap', s0: 11.6, s1: 17.4, f: 0.27, max: 0.75, slide: [0, -0.15, 0.7] },
          { name: 'ailR', ch: 'ail', s0: 17.7, s1: 24.6, f: 0.26, max: 0.34 }] });
      b.spoiler(w, 'spoilR', 11.8, 17.2, 0.6, 0.71);
      // двигатели на пилонах
      for (const x of [6.35, 10.6]) {
        const le = w.at(x, 0, false).p, y = le[1] - 1.55, z0 = le[2] - 3.7;
        b.loft([[z0, y, 0.76, 0.76], [z0 + 0.6, y, 0.95, 0.95], [z0 + 2.9, y, 0.95, 0.95], [z0 + 4.6, y, 0.76, 0.76], [z0 + 5.4, y, 0.56, 0.56]], { n: 12, x, part: 'nac',
          capA: { inset: 0.4, s: 0.78, part: 'intake', rim: 'lip' }, capB: { inset: 0.3, s: 0.8, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 3 ? 'nozzle' : null) });
        b.wing({ part: 'pylon', root: [x, le[1] - 0.25, 0], dih: -90 * D, sym: true, tr: 0.06, st: [[0, le[2] - 0.9, 3.6], [0.75, le[2] - 2.5, 3.9]] });
        b.nozzleGlow([x, y, z0 + 5.4], 0.5);
      }
      for (const [nm, z] of [['gearR', 20.4], ['gearR2', 22.8]]) {
        b.gear({ name: nm, pivot: [2.6, 1.5, z], axle: [2.6, z], r: 0.65, w: 0.42, simple: true, strut: 0.12, axis: [1, 0, 0], max: 1.5,
          wheels: [[-0.95, 0], [-0.4, 0], [0.4, 0], [0.95, 0]] });
      }
      b.wing({ part: 'htail', root: [0, 14.35], tr: 0.1, sym: true, st: [[0, 40.0, 5.2], [8.65, 44.6, 2.0]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.6, s1: 8.4, f: 0.3, max: 0.38 }] });
    });
    b.wing({ part: 'fin', root: [0, 6.2], dih: 90 * D, sym: true, tr: 0.1, sub: 1.1, st: [[0, 33.8, 8.2], [8.1, 40.4, 5.0]], ctl: [{ name: 'rud', ch: 'rud', s0: 1.0, s1: 7.8, f: 0.32, max: 0.4 }] });
    b.loft([[38.4, 14.35, 0.02, 0.02], [39.8, 14.35, 0.36, 0.4], [44.0, 14.35, 0.36, 0.4], [46.3, 14.35, 0.04, 0.05]], { n: 8, part: 'fin' });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 1.4, 7.3], axle: [0, 7.3], r: 0.55, w: 0.3, simple: true, strut: 0.12, axis: [1, 0, 0], max: 1.5, wheels: [[-0.85, 0], [-0.4, 0], [0.4, 0], [0.85, 0]], door: 'front' });
    b.label(fus, 'RA-76512', 27.5, 0.28, 0.62);
    b.blade(fus.at(9, 0.0), 0.5, 0.55); b.blade(fus.at(28, 0.0), 0.4, 0.45);
    b.lights({ tip: [25.2, 4.55, 28.2], tail: [0, 6.0, 44.9], top: [0, 6.4, 18], bottom: [0, 0.93, 14], land: [[2.2, 2.4, 5.0], [-2.2, 2.4, 5.0]], strobe: true, scale: 1.4 });
    b.anchors.cockpit = [0.6, 4.6, 3.6];
  },
};
