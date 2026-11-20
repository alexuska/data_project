// Су-25 «Грач»: прямое крыло-«высокоплан» с десятью пилонами и гондолами тормозных щитков на законцовках,
// два двигателя в длинных гондолах по бокам фюзеляжа, горбатая бронированная кабина, высокий киль.
import { camo } from '../paint.js';

const D = Math.PI / 180;

export default {
  id: 'su25', cgZ: 7.35,
  liveries: [
    { id: 'camo', name: 'Зелёно-коричневый камуфляж', paint: camo({ cols: ['#5f6f3b', '#8a7446', '#3f5533', '#a8925a'], under: '#9fc4dc', scale: 1.25, radome: '#3f5533' }) },
    { id: 'grey', name: 'Серый двухцветный', paint: camo({ cols: ['#7f8a92', '#5f6b75', '#98a3aa'], under: '#a9c7da', scale: 1.25, seed: 3, radome: '#5f6b75' }) },
    { id: 'desert', name: 'Песочный', paint: camo({ cols: ['#c2a56c', '#8c6c44', '#d6c08d'], under: '#a9c7da', scale: 1.25, seed: 5, radome: '#8c6c44' }) },
  ],
  build(b) {
    b.loft([
      [0, 1.65, 0.03, 0.03], [0.5, 1.68, 0.3, 0.28, 3], [1.6, 1.75, 0.55, 0.55, 3], [2.8, 1.85, 0.68, 0.75, 3, 0.7], [4.5, 1.9, 0.7, 0.9, 3, 0.75], [6.5, 1.95, 0.68, 0.95, 2.6, 0.7],
      [9.0, 2.0, 0.55, 0.8, 2.4, 0.6], [11.5, 2.1, 0.38, 0.55], [13.5, 2.2, 0.28, 0.36], [14.8, 2.25, 0.2, 0.22],
    ], { n: 12, part: 'fus', capB: true, partOf: (i) => (i === 0 ? 'radome' : null) });
    b.canopy([[2.4, 2.4, 0.34, 0.04, 2, 0.04], [3.05, 2.46, 0.42, 0.44, 2.6, 0.04], [3.75, 2.5, 0.42, 0.46, 2.6, 0.04], [4.5, 2.52, 0.36, 0.3, 2.6, 0.04]], { n: 10, frames: [3.05, 3.8], sill: 0.47, fw: 0.08 });
    b.withPart('pitot', () => { for (const sx of [-1, 1]) b.cyl([sx * 0.14, 1.72, 0.5], [sx * 0.14, 1.74, -0.75], 0.03, 0.015, 4); });
    let w;
    b.mirror(() => {
      // гондола двигателя
      b.loft([[4.2, 1.72, 0.42, 0.46, 2.6], [4.75, 1.72, 0.52, 0.56, 2.6], [9.8, 1.72, 0.52, 0.55], [11.0, 1.74, 0.42, 0.42], [11.45, 1.75, 0.36, 0.36]], { n: 10, x: 1.12, part: 'nac',
        capA: { inset: 0.4, s: 0.8, part: 'intake', rim: 'lip' }, capB: { inset: 0.3, s: 0.8, part: 'nozzleIn', rim: 'nozzle' }, partOf: (i) => (i === 3 ? 'nozzle' : null) });
      b.nozzleGlow([1.12, 1.75, 11.45], 0.3);
      w = b.wing({ part: 'wing', root: [0.7, 2.42], dih: -2.5 * D, tr: 0.1, sub: 1.1,
        st: [[0, 5.4, 3.4], [6.2, 7.6, 1.5]],
        ctl: [{ name: 'flapR', ch: 'flap', s0: 0.55, s1: 3.4, f: 0.26, max: 0.7 }, { name: 'ailR', ch: 'ail', s0: 3.55, s1: 6.1, f: 0.26, max: 0.36 }] });
      // гондола на законцовке с расщепляющимися тормозными щитками
      b.loft([[7.1, 2.15, 0.02, 0.02], [7.5, 2.15, 0.13, 0.17], [8.7, 2.15, 0.14, 0.18], [8.72, 2.15, 0.05, 0.05]], { n: 6, x: 7.02, part: 'wing', meta: { sp: 1 } });
      b.anchors.wingtips.push([7.16, 2.15, 8.3]);
      for (const [nm, sg] of [['brkT', -1], ['brkB', 1]]) {
        const bb = b.addBone(nm + 'R', { pivot: [7.02, 2.15 - sg * 0.12, 8.7], axis: [1, 0, 0], ch: 'brake', max: sg * 0.95 });
        b.withBone(bb, () => b.door({ pts: [[6.88, 2.15 - sg * 0.15, 8.7], [7.16, 2.15 - sg * 0.15, 8.7], [7.12, 2.15 - sg * 0.04, 9.75], [6.92, 2.15 - sg * 0.04, 9.75]], th: 0.04, part: 'wing', inner: 'dark', out: [0, -sg, 0], meta: { sp: 1 } }));
      }
      for (const s of [0.95, 1.9, 2.85, 3.8]) b.pylon(w, s, 0.25, 1.5, 0.3);
      b.pylon(w, 5.2, 0.3, 0.9, 0.22);
      b.emblem(w.at(4.6, 0.55, true), 0.9);
      b.emblem(w.at(4.6, 0.55, false), 0.9);
      b.wing({ part: 'htail', root: [0.25, 2.55], dih: 5 * D, tr: 0.09, sym: true, st: [[0, 12.5, 2.0], [2.1, 13.2, 1.1]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.1, s1: 2.05, f: 0.36, max: 0.42 }] });
      b.gear({ name: 'gearR', pivot: [1.12, 1.25, 7.83], axle: [1.12, 7.83], r: 0.42, w: 0.24, side: 1, axis: [1, 0, 0], max: 1.5, door: 'side', doorPart: 'nac' });
    });
    const fin = b.wing({ part: 'fin', root: [0, 2.4], dih: 90 * D, sym: true, tr: 0.08, sub: 0.5, st: [[0, 10.9, 3.5], [2.42, 12.85, 1.4]], ctl: [{ name: 'rud', ch: 'rud', s0: 0.5, s1: 2.3, f: 0.32, max: 0.42 }] });
    b.emblem(fin.at(1.1, 0.4, true), 0.8);
    b.emblem(fin.at(1.1, 0.4, false), 0.8);
    b.gear({ name: 'gearN', nose: true, pivot: [-0.15, 1.2, 4.25], axle: [-0.15, 4.25], r: 0.33, w: 0.2, axis: [1, 0, 0], max: -1.5, door: 'front' });
    b.dragChute([0, 2.3, 14.85], 2.8, 9);
    b.lights({ tip: [7.16, 2.15, 7.6], tail: [0, 2.3, 14.9], top: [0, 4.85, 13.6], bottom: [0, 1.15, 9.0], land: [[7.02, 2.15, 7.15], [-7.02, 2.15, 7.15]] });
    b.anchors.cockpit = [0, 2.78, 3.45];
    b.anchors.muzzles.push([-0.3, 1.3, 1.6]);
  },
};
