import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { landmarkDestinations, landmarkName } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import { LEAD_IN, type MapleLayout } from './MapleLayout';

const TEMPLE_FIRST = [
  'Maple',
  'Crimson',
  'Moon',
  'Cedar',
  'Ginkgo',
  'Autumn',
  'Heron',
  'Ember',
  'Lantern',
  'Mist',
  'Deer',
];
const TEMPLE_KIND = ['Temple', 'Temple', 'Pagoda', 'Hall'];
const SHRINE_FIRST = ['Fox', 'Rice', 'Hill', 'Moss', 'Cedar', 'Lantern', 'Cloud', 'Pine'];
const SHRINE_KIND = ['Shrine', 'Shrine', 'Gates'];
const TOWN_FIRST = [
  'Willow',
  'Lantern',
  'Ferry',
  'Tea',
  'Persimmon',
  'Bridge',
  'Rice',
  'Riverside',
];
const TOWN_KIND = ['Street', 'Town', 'Row'];

/**
 * Maple Valley's journeys lead across the mountains to the next temple (the beacon in the open
 * before its hall, over the lantern-lined approach; the cairn at the approach's foot) or to the
 * foot of a tunnel of gates (the beacon on the path leading in, so arriving looks straight up
 * the gates to the shrine; the cairn beside the first gate), or to a riverside town (the beacon
 * in the middle of its street, the cairn by the road in). The home temple and the lake's town
 * are the opening's and never a destination.
 */
export function mapleDestinations(L: MapleLayout): DestinationSource {
  const TC = Config.maple.templeCell;
  const GC = Config.maple.gateCell;
  return landmarkDestinations(
    (x, z, R, out) => {
      for (let j = Math.floor((z - R) / TC); j <= Math.floor((z + R) / TC); j++)
        for (let i = Math.floor((x - R) / TC); i <= Math.floor((x + R) / TC); i++) {
          const t = L.temple(i, j);
          if (!t) continue;
          const fx = Math.sin(t.yaw);
          const fz = Math.cos(t.yaw);
          const rx = t.x + fx * 30;
          const rz = t.z + fz * 30;
          out.push({
            id: `maple-temple:${i},${j}`,
            name: landmarkName(hash2(i, j, 781), TEMPLE_FIRST, TEMPLE_KIND),
            x: t.x,
            z: t.z,
            end: { x: t.x + fx * 20, z: t.z + fz * 20 },
            roost: { x: rx, y: L.height(rx, rz), z: rz, yaw: t.yaw + Math.PI },
          });
        }
      for (let j = Math.floor((z - R) / GC); j <= Math.floor((z + R) / GC); j++)
        for (let i = Math.floor((x - R) / GC); i <= Math.floor((x + R) / GC); i++) {
          const t = L.tunnel(i, j);
          if (!t) continue;
          // The beacon at the foot of the gates, on the lead-in; the cairn beside the first gate.
          const G = t.gates;
          const ex = G[0] - Math.sin(G[3]) * LEAD_IN * 0.6;
          const ez = G[2] - Math.cos(G[3]) * LEAD_IN * 0.6;
          const rx = G[0] + Math.cos(G[3]) * 8;
          const rz = G[2] - Math.sin(G[3]) * 8;
          out.push({
            id: `maple-shrine:${i},${j}`,
            name: landmarkName(hash2(i, j, 782), SHRINE_FIRST, SHRINE_KIND),
            x: G[0],
            z: G[2],
            end: { x: ex, z: ez },
            roost: { x: rx, y: L.height(rx, rz), z: rz, yaw: G[3] },
          });
        }
      // Towns: the beacon in the middle of the street, the cairn at the road in.
      const WC = Config.maple.townCell;
      for (let j = Math.floor((z - R) / WC); j <= Math.floor((z + R) / WC); j++)
        for (let i = Math.floor((x - R) / WC); i <= Math.floor((x + R) / WC); i++) {
          const t = L.town(i, j);
          if (!t) continue;
          const rx = t.x - t.ux * (t.half + 8) + t.nx * 6;
          const rz = t.z - t.uz * (t.half + 8) + t.nz * 6;
          out.push({
            id: `maple-town:${i},${j}`,
            name: landmarkName(hash2(i, j, 783), TOWN_FIRST, TOWN_KIND),
            x: t.x,
            z: t.z,
            roost: { x: rx, y: L.height(rx, rz), z: rz, yaw: Math.atan2(t.ux, t.uz) },
          });
        }
    },
    (x, z) => Math.max(L.height(x, z), 0),
  );
}
