// Ту-154М: стреловидное крыло с отрицательным V, гондолы шасси за задней кромкой, три двигателя в хвосте
// (боковые гондолы и S-образный канал среднего), Т-образное оперение с «пикой» обтекателя.
import { civil } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'tu154', cgZ: 23.7,
  liveries: [
    { id: 'classic', name: 'Бело-синяя классическая', paint: civil({
      top: '#f4f3ee', belly: '#b1b8bf', ab: 0.6, cheat: '#1d4c98', a0: 0.25, a1: 0.5, z0: 0.035, z1: 0.9, wing: '#c8cdd2',
      finBand: [0.34, 0.6, '#1d4c98'], nac: '#c8cdd2', pod: '#c8cdd2', radome: '#3a3f44' }) },
    { id: 'polar', name: 'Красно-белая полярная', paint: civil({
      top: '#f4f3ee', belly: '#b1b8bf', ab: 0.6, cheat: '#c9291f', a0: 0.25, a1: 0.5, z0: 0.035, z1: 0.9, wing: '#c8cdd2', wingTip: '#c9291f', wingTipFrom: 0.88,
      fin: '#c9291f', tailTip: '#c9291f', nac: '#f4f3ee', pod: '#c8cdd2', radome: '#3a3f44' }) },
    { id: 'modern', name: 'Серебристо-синяя', paint: civil({
      top: '#e9ecee', belly: '#1c3a70', ab: 0.5, cheat: '#e2702a', a0: 0.375, a1: 0.5, z0: 0.035, z1: 0.9, wing: '#c2c8ce',
      fin: '#1c3a70', finBand: [0.62, 0.8, '#e2702a'], nac: '#1c3a70', pod: '#c2c8ce', radome: '#3a3f44' }) },
  ],
  build(b) {
    const yc = 3.6, R = 1.9;
    const fus = b.loft([
      [0, 3.15, 0.03, 0.03], [0.7, 3.2, 0.62, 0.55], [2.0, 3.32, 1.2, 1.1], [3.6, 3.48, 1.65, 1.7, 2, 1.55], [5.5, yc, R, R], [30.0, yc, R, R],
      [34.5, 3.75, 1.75, 1.75, 2, 1.6], [39.5, 4.25, 1.3, 1.25, 2, 1.0], [43.5, 4.8, 0.85, 0.75, 2, 0.6], [45.7, 5.1, 0.62, 0.55],
    ], { n: 16, part: 'fus', capB: { inset: 0.4, s: 0.8, part: 'nozzleIn', rim: 'nozzle' },
      frames: [2.75], fw: 0.1,
      partOf: (i, k, s, a, fr) => (i === 0 ? 'radome' : i === 2 && k >= 1 && k <= 3 && !fr ? 'glass' : i === 8 ? 'nozzle' : null) });
    b.windows(fus, { z0: 6.4, z1: 32.5, count: 30, a: 0.36, w: 0.3, h: 0.42, skip: (i) => i === 9 || i === 20 });
    b.nozzleGlow([0, 5.1, 45.7], 0.5);
    // воздухозаборник и канал среднего двигателя
    b.loft([[33.0, 6.02, 0.72, 0.62], [33.8, 6.05, 0.84, 0.74, 2, 0.8], [36.5, 5.95, 0.76, 0.64, 2, 0.7], [40, 5.75, 0.55, 0.5], [43.2, 5.5, 0.3, 0.3]], { n: 10, part: 'nac', capA: { inset: 0.35, s: 0.8, part: 'intake', rim: 'lip' } });
    b.mirror(() => {
      const an = Math.tan(-1.6 * D);
      const w = b.wing({ part: 'wing', root: [0, 2.55], tr: 0.11, tipAnchor: true, sub: 3.2,
        st: [[0, 15.45, 9.0], [1.9, 16.9, 8.5, 1.9 * an], [5.75, 19.8, 6.1, 5.75 * an], [18.65, 29.55, 2.3, 18.65 * an, 0.09]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 2.05, s1: 5.0, f: 0.24, max: 0.7, slide: [0, -0.1, 0.5] }, { name: 'flapR2', ch: 'flap', s0: 6.55, s1: 12.4, f: 0.27, max: 0.7, slide: [0, -0.1, 0.5] },
          { name: 'ailR', ch: 'ail', s0: 12.6, s1: 18.3, f: 0.27, max: 0.34 }] });
      b.spoiler(w, 'spoilR', 7.0, 12.0, 0.62, 0.72);
      // гондола основного шасси
      b.loft([[21.6, 2.25, 0.05, 0.05], [22.8, 2.2, 0.6, 0.68], [25.5, 2.2, 0.72, 0.8], [29.0, 2.3, 0.6, 0.62], [31.6, 2.4, 0.04, 0.05]], { n: 10, x: 5.75, part: 'pod' });
      b.gear({ name: 'gearR', pivot: [5.75, 2.1, 24.5], axle: [5.75, 24.62], r: 0.465, w: 0.3, simple: true, strut: 0.11, axis: [1, 0, 0], max: -1.55,
        wheels: [[-0.33, -1.05], [0.33, -1.05], [-0.33, 0], [0.33, 0], [-0.33, 1.05], [0.33, 1.05]] });
      // боковой двигатель
      b.loft([[33.6, 4.35, 0.64, 0.64], [34.3, 4.35, 0.8, 0.8], [37.6, 4.35, 0.8, 0.8], [39.0, 4.35, 0.68, 0.68], [39.7, 4.35, 0.52, 0.52]], { n: 12, x: 2.95, part: 'nac',
        capA: { inset: 0.35, s: 0.78, part: 'intake', rim: 'lip' }, capB: { inset: 0.3, s: 0.82, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 3 ? 'nozzle' : null) });
      b.box([1.6, 4.2, 34.9], [2.3, 4.5, 38.0], 'pylon');
      b.nozzleGlow([2.95, 4.35, 39.7], 0.45);
      b.wing({ part: 'htail', root: [0, 11.05], tr: 0.09, sym: true, st: [[0, 41.5, 4.5], [6.7, 46.05, 1.85]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.5, s1: 6.5, f: 0.3, max: 0.4 }] });
    });
    b.wing({ part: 'fin', root: [0, 5.6], dih: 90 * D, sym: true, tr: 0.09, sub: 0.9, st: [[0, 35.2, 8.3], [5.45, 40.9, 4.9]], ctl: [{ name: 'rud', ch: 'rud', s0: 1.0, s1: 5.2, f: 0.28, max: 0.4 }] });
    b.loft([[39.6, 11.05, 0.02, 0.02], [41.0, 11.05, 0.28, 0.3], [44.6, 11.05, 0.3, 0.32], [46.9, 11.05, 0.04, 0.05]], { n: 8, part: 'fin' });
    b.gear({ name: 'gearN', nose: true, pivot: [0, 2.0, 5.7], axle: [0, 5.7], r: 0.4, w: 0.24, axis: [1, 0, 0], max: -1.5, wheels: [[-0.26, 0], [0.26, 0]], door: 'front' });
    b.lights({ tip: [18.75, 2.05, 30.9], tail: [0, 5.1, 45.9], top: [0, 5.52, 14], bottom: [0, 1.68, 17], land: [[1.2, 2.3, 4.2], [-1.2, 2.3, 4.2]], strobe: true, scale: 1.3 });
    b.anchors.cockpit = [0.5, 4.45, 3.0];
  },
};
