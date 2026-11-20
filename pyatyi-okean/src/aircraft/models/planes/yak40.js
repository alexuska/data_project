// Як-40: прямое крыло большой площади, три двигателя в хвосте (два по бокам + средний с воздухозаборником
// в основании киля), Т-образное оперение со стреловидным килем.
import { civil, plain } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'yak40', cgZ: 9.15,
  liveries: [
    { id: 'classic', name: 'Бело-синяя классическая', paint: civil({
      top: '#f3f2ec', belly: '#b3bac1', ab: 0.62, cheat: '#1f4f9c', a0: 0.25, a1: 0.5, z0: 0.05, z1: 0.86, wing: '#cfd4d8',
      finBand: [0.3, 0.62, '#1f4f9c'], nac: '#cfd4d8', radome: '#3a3f44' }) },
    { id: 'red', name: 'Красно-белая северная', paint: civil({
      top: '#f3f2ec', belly: '#b3bac1', ab: 0.62, cheat: '#c9291f', a0: 0.25, a1: 0.5, z0: 0.05, z1: 0.86, wing: '#cfd4d8', wingTip: '#c9291f', wingTipFrom: 0.86,
      fin: '#c9291f', nac: '#f3f2ec', tailTip: '#c9291f', radome: '#3a3f44' }) },
    { id: 'green', name: 'Зелёная «Тайга»', paint: civil({
      top: '#f3f2ec', belly: '#f3f2ec', ab: 2, cheat: '#1e7a4c', a0: 0.25, a1: 0.5, cheat2: '#e3b21a', b0: 0.5, b1: 0.63, z0: 0.05, z1: 0.86, wing: '#d6dadd',
      finBand: [[0.2, 0.5, '#e3b21a'], [0.5, 2, '#1e7a4c']], nac: '#1e7a4c', radome: '#3a3f44' }) },
  ],
  build(b) {
    const yc = 2.05, R = 1.2;
    const fus = b.loft([
      [0, 1.9, 0.03, 0.03], [0.4, 1.92, 0.5, 0.45], [1.2, 1.98, 0.9, 0.85], [2.3, yc, 1.15, 1.15], [3.3, yc, R, R], [12.5, yc, R, R],
      [15.0, 2.25, 1.0, 1.05, 2, 0.9], [17.3, 2.6, 0.62, 0.8, 2, 0.5], [19.1, 2.95, 0.42, 0.45],
    ], { n: 16, part: 'fus', capB: { inset: 0.3, s: 0.8, part: 'nozzleIn', rim: 'nozzle' },
      frames: [1.72], fw: 0.09,
      partOf: (i, k, s, a, fr) => (i === 0 ? 'radome' : i === 2 && k >= 1 && k <= 3 && !fr ? 'glass' : i === 7 && k >= 2 ? 'nozzle' : null) });
    b.windows(fus, { z0: 4.1, z1: 11.6, count: 9, a: 0.35, w: 0.4, h: 0.46, shape: 'oct' });
    b.nozzleGlow([0, 2.95, 19.1], 0.36);
    // средний двигатель: воздухозаборник в основании киля
    b.loft([[12.3, 3.5, 0.46, 0.44], [12.9, 3.52, 0.54, 0.52], [14.5, 3.45, 0.52, 0.48], [16.5, 3.3, 0.42, 0.42], [18.2, 3.2, 0.25, 0.3]], { n: 10, part: 'nac', capA: { inset: 0.25, s: 0.78, part: 'intake', rim: 'lip' } });
    b.mirror(() => {
      const w = b.wing({ part: 'wing', root: [0, 1.22], dih: 5.5 * D, tr: 0.14, tipAnchor: true, sub: 2.6, round: 0.2,
        st: [[0, 7.25, 4.9], [1.1, 7.33, 4.5], [12.3, 8.4, 1.65, 0, 0.1]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 1.25, s1: 6.6, f: 0.27, max: 0.65, slide: [0, -0.06, 0.3] }, { name: 'ailR', ch: 'ail', s0: 6.75, s1: 12.0, f: 0.27, max: 0.36 }] });
      b.spoiler(w, 'spoilR', 2.0, 5.5, 0.6, 0.71);
      // боковой двигатель на коротком пилоне
      b.loft([[12.9, 2.55, 0.4, 0.4], [13.25, 2.55, 0.5, 0.5], [14.9, 2.55, 0.5, 0.5], [15.6, 2.55, 0.42, 0.42], [15.95, 2.55, 0.35, 0.35]], { n: 10, x: 1.78, part: 'nac',
        capA: { inset: 0.25, s: 0.78, part: 'intake', rim: 'lip' }, capB: { inset: 0.2, s: 0.82, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 3 ? 'nozzle' : null) });
      b.box([1.0, 2.45, 13.5], [1.45, 2.65, 15.2], 'pylon');
      b.nozzleGlow([1.78, 2.55, 15.95], 0.3);
      b.gear({ name: 'gearR', pivot: [1.95, 1.35, 9.85], axle: [1.95, 9.87], r: 0.56, w: 0.4, side: 1, axis: [0, 0, 1], max: -1.5, door: 'side', doorPart: 'wing' });
      b.wing({ part: 'htail', root: [0, 6.52], tr: 0.1, sym: true, round: 0.12, st: [[0, 17.0, 2.9], [3.65, 18.55, 1.3]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.3, s1: 3.6, f: 0.3, max: 0.4 }] });
    });
    b.wing({ part: 'fin', root: [0, 3.3], dih: 90 * D, sym: true, tr: 0.1, sub: 0.7, st: [[0, 13.0, 5.4], [3.2, 16.7, 3.3]], ctl: [{ name: 'rud', ch: 'rud', s0: 0.6, s1: 3.05, f: 0.3, max: 0.4 }] });
    b.loft([[16.5, 6.52, 0.02, 0.02], [17.2, 6.52, 0.2, 0.22], [19.2, 6.52, 0.2, 0.22], [20.35, 6.52, 0.03, 0.03]], { n: 8, part: 'fin' });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 1.2, 2.4], axle: [0, 2.4], r: 0.35, w: 0.24, axis: [1, 0, 0], max: 1.5, door: 'front' });
    b.label(fus, 'RA-87455', 12.2, 0.26, 0.36);
    b.blade(fus.at(6.5, 0.0), 0.3, 0.32); b.blade(fus.at(8, 1.0), 0.28, 0.3);
    b.lights({ tip: [12.55, 2.42, 9.3], tail: [0, 6.52, 20.35], top: [0, 3.3, 7.0], bottom: [0, 0.83, 8.5], land: [[2.2, 1.45, 7.5], [-2.2, 1.45, 7.5]], strobe: true });
    b.anchors.cockpit = [0.35, 2.75, 2.0];
  },
};
