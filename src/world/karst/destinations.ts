import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { landmarkName } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import { walkDestinations } from '../walk';
import type { KarstLayout } from './KarstLayout';

const FIRST = [
  'Jade',
  'Cloud',
  'Crane',
  'Bamboo',
  'Lotus',
  'Moon',
  'Mist',
  'Pine',
  'Heron',
  'Plum',
];
const KIND = ['Pagoda', 'Pagoda', 'Tower', 'Peak'];
const BRIDGE_FIRST = [
  'Willow',
  'Moon',
  'Jade',
  'Old',
  'Lantern',
  'Ferry',
  'Stone',
  'Lotus',
  'Reed',
];
const BRIDGE_KIND = ['Bridge', 'Bridge', 'Crossing'];
/** m from a walk point within which a pagoda pillar's foot stands beside the river. */
const BESIDE = 60;

/**
 * Jade River's journeys lead down the river the bird is on to the next stone bridge, or pagoda
 * standing over the water (never a summit pavilion: those are a hidden find). Deep in the pillar forest the ribbons
 * could not thread their way to one; down the river they always can. The beacon rises from the
 * pagoda's roof, the cairn and its stray stand at the pillar's foot, and passing it on the river
 * arrives.
 */
export function karstDestinations(L: KarstLayout): DestinationSource {
  const C = Config.karst.pillarCell;
  return walkDestinations({
    heading: (x, z, yaw) => L.riverHeading(x, z, yaw),
    toCentre: (x, z, out) => L.toCentre(x, z, out),
    ground: (x, z) => Math.max(L.height(x, z), 0),
    inside: (x, z) => L.river(x, z) < 0,
    near: (x, z, out) => {
      // A stone bridge over the river: under or over it arrives; the cairn on its bank.
      const b = L.bridgeNear(x, z);
      if (b && Math.hypot(b.x - x, b.z - z) < 30) {
        const ex = b.x + b.ux * (b.half + 4);
        const ez = b.z + b.uz * (b.half + 4);
        out.push({
          id: `karst-bridge:${Math.round(b.x)},${Math.round(b.z)}`,
          name: landmarkName(
            hash2(Math.round(b.x), Math.round(b.z), 741),
            BRIDGE_FIRST,
            BRIDGE_KIND,
          ),
          x: b.x,
          z: b.z,
          roost: { x: ex, y: Math.max(L.height(ex, ez), 0), z: ez, yaw: b.yaw },
        });
      }
      const R = 160;
      for (let j = Math.floor((z - R) / C); j <= Math.floor((z + R) / C); j++)
        for (let i = Math.floor((x - R) / C); i <= Math.floor((x + R) / C); i++)
          for (const p of L.cell(i, j)) {
            if (!p.pagoda) continue;
            const d = Math.hypot(p.x - x, p.z - z);
            if (d > p.reach + BESIDE) continue;
            // The cairn: at the foot, toward the river.
            const a = Math.atan2(x - p.x, z - p.z);
            const fx = p.x + Math.sin(a) * (p.reach + 5);
            const fz = p.z + Math.cos(a) * (p.reach + 5);
            out.push({
              id: `karst:${Math.round(p.x)},${Math.round(p.z)}`,
              name: landmarkName(hash2(i, j, Math.round(p.seed * 1000)), FIRST, KIND),
              x: p.x + p.lx,
              z: p.z + p.lz,
              roost: { x: fx, y: Math.max(L.height(fx, fz), 0), z: fz, yaw: a },
            });
          }
    },
  });
}
