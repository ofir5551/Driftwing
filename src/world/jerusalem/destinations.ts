import { hash2 } from '../noise';
import { landmarkDestinations, landmarkName } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import type { JerusalemLayout } from './JerusalemLayout';

const FIRST = [
  'Olive',
  'Fig',
  'Almond',
  'Cedar',
  'Dove',
  'Lark',
  'Vine',
  'Sage',
  'Myrtle',
  'Pomegranate',
];
const KIND = ['Hill', 'Hill', 'Village', 'Terraces', 'Spring'];
/** m, grid on which the hills are sampled for a town's heart (one jittered look per cell). */
const CELL = 420;
/** Town share above which a sample is a town's heart. */
const HEART = 0.85;
/** m from the origin inside which the designed land round the Old City lies (no journeys). */
const OLD_CITY = 1700;

/**
 * City of Gold's journeys lead out over the Judean hills to the towns that crown them. A town's
 * towers stand in its blocks, too costly to build for a search across kilometres, so the hills
 * are sampled on a coarse grid for a town's heart instead: the beacon rises from it, flying over
 * the town arrives, and the cairn and its stray stand among its roofs. The Old City is the
 * opening ribbon's, never a destination.
 */
export function jerusalemDestinations(L: JerusalemLayout): DestinationSource {
  return landmarkDestinations((x, z, R, out) => {
    for (let j = Math.floor((z - R) / CELL); j <= Math.floor((z + R) / CELL); j++)
      for (let i = Math.floor((x - R) / CELL); i <= Math.floor((x + R) / CELL); i++) {
        const tx = (i + 0.2 + 0.6 * hash2(i, j, 761)) * CELL;
        const tz = (j + 0.2 + 0.6 * hash2(i, j, 762)) * CELL;
        if (Math.hypot(tx, tz) < OLD_CITY) continue;
        L.at(tx, tz);
        if (L.town < HEART) continue;
        const g = L.ground(tx, tz);
        out.push({
          id: `town:${i},${j}`,
          name: landmarkName(hash2(i, j, 763), FIRST, KIND),
          x: tx,
          z: tz,
          y: g,
          top: g + 40,
          r: 110,
          roost: { x: tx, y: g, z: tz, yaw: hash2(i, j, 764) * Math.PI * 2 },
        });
      }
  });
}
