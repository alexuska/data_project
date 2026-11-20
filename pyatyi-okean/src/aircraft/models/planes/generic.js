// ЗАПАСНАЯ МОДЕЛЬ для самолёта, которого ещё нет в реестре: строится из паспортных данных каталога,
// чтобы игра не ломалась при добавлении новых типов. Заменяется полноценным описанием в planes/<id>.js.
import { civil, camo } from '../paint.js';

const D = Math.PI / 180;

export function genericDef(spec) {
  const L = spec.length, W = spec.span / 2, jet = spec.engine === 'jet', mil = spec.role === 'military';
  const r = Math.max(0.45, L * (jet && mil ? 0.045 : 0.055)), gh = spec.gearHeight, yc = Math.max(gh, r + 0.5);
  const fast = jet && spec.vMax > 220;
  return {
    id: spec.id, cgZ: L * 0.44,
    liveries: [
      mil ? { id: 'default', name: 'Серо-голубой камуфляж', paint: camo({ cols: ['#7f8f9c', '#5f7183', '#9aa9b4'], under: '#a9c9dd' }) }
        : { id: 'default', name: 'Бело-синяя', paint: civil({ cheat: '#1d4e9e', a0: 0.38, a1: 0.56, finBand: [0.45, 0.75, '#1d4e9e'] }) },
    ],
    build(b) {
      b.loft([[0, yc, 0.02, 0.02], [L * 0.06, yc, r * 0.6, r * 0.6], [L * 0.18, yc, r, r], [L * 0.6, yc, r, r], [L * 0.94, yc + r * 0.4, r * 0.3, r * 0.4], [L * 0.99, yc + r * 0.45, 0.03, 0.05]], { n: 12, part: 'fus' });
      b.canopy([[L * 0.13, yc + r * 0.55, r * 0.5, 0.03], [L * 0.19, yc + r * 0.7, r * 0.6, r * 0.6], [L * 0.27, yc + r * 0.7, r * 0.55, r * 0.5], [L * 0.33, yc + r * 0.6, r * 0.3, 0.05]], { n: 8 });
      const sweep = fast ? Math.tan(35 * D) : 0.06, c0 = (spec.wingArea / spec.span) * 1.45, c1 = c0 * 0.4, z0 = L * 0.44 - c0 * 0.3 - (W * sweep) / 3;
      b.mirror(() => {
        b.wing({ part: 'wing', root: [r * 0.7, yc - r * 0.5], dih: 2 * D, tr: fast ? 0.06 : 0.12, tipAnchor: true, sub: 2.5,
          st: [[0, z0, c0], [W - r * 0.7, z0 + (W - r * 0.7) * sweep, c1]],
          ctl: [{ name: 'flapR', ch: 'flap', s0: 0.1, s1: (W - r) * 0.5, max: 0.6 }, { name: 'ailR', ch: 'ail', s0: (W - r) * 0.55, s1: (W - r) * 0.95, max: 0.4 }] });
        b.wing({ part: 'htail', root: [r * 0.3, yc + r * 0.3], tr: 0.07, sym: true, st: [[0, L * 0.86, c0 * 0.55], [W * 0.36, L * 0.86 + W * 0.36 * sweep, c0 * 0.28]], ctl: [{ name: 'elevR', ch: 'elev', s0: 0.05, s1: W * 0.36, f: 0.35, max: 0.4 }] });
        b.gear({ name: 'gearR', pivot: [W * 0.18, yc - r * 0.6, L * 0.47], axle: [W * 0.18, L * 0.47], r: Math.max(0.2, gh * 0.16), w: Math.max(0.12, gh * 0.1), side: 1, axis: [0, 0, 1], max: 1.5 });
      });
      b.wing({ part: 'fin', root: [0, yc + r * 0.6], dih: 90 * D, tr: 0.07, sym: true, st: [[0, L * 0.8, c0 * 0.75], [L * 0.16, L * 0.8 + L * 0.16 * (sweep + 0.35), c0 * 0.35]], ctl: [{ name: 'rud', ch: 'rud', s0: 0.1, s1: L * 0.16, f: 0.35, max: 0.4 }] });
      b.gear({ name: 'gearN', nose: true, pivot: [0, yc - r * 0.8, L * 0.14], axle: [0, L * 0.14], r: Math.max(0.16, gh * 0.12), w: Math.max(0.1, gh * 0.08), max: 1.5 });
      if (jet) { b.withPart('nozzle', () => b.cyl([0, yc + r * 0.4, L * 0.97], [0, yc + r * 0.42, L], r * 0.42, r * 0.36, 8, { capPart: 'nozzleIn' })); b.nozzleGlow([0, yc + r * 0.42, L], r * 0.36); }
      else b.prop({ c: [0, yc, -0.05], r: Math.min(gh * 0.85, r * 2.6), blades: 3 });
      b.lights({ tip: [W, yc - r * 0.4, z0 + W * sweep + c1 * 0.5], tail: [0, yc + r * 0.5, L], top: [0, yc + r * 1.05, L * 0.5], land: [[0, yc - r, L * 0.15]] });
      b.anchors.cockpit = [0, yc + r * 1.0, L * 0.22];
    },
  };
}
