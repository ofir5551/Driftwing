import { hash2 } from '../noise';
import { landmarkDestinations, landmarkName, type Landmark } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import { BK, type CityLayout } from './CityLayout';

const TOWER_FIRST = ['Harbour', 'Sakura', 'Lantern', 'Skyline', 'Neon', 'Heron', 'Moon', 'Tide'];
const TOWER_KIND = ['Tower', 'Spire', 'Mast'];
const SHRINE_FIRST = ['Fox', 'Cedar', 'Maple', 'Crane', 'Pine', 'Willow', 'Plum', 'Mist'];
const SHRINE_KIND = ['Shrine', 'Shrine', 'Grove', 'Gate'];

/**
 * Neon Bay's journeys lead to its landmarks: the lattice broadcast towers (232 m, a beacon
 * shining from the top) and the grand shrines in their wooded parks. Each stands at the centre
 * block of its superblock, ~120 m from the avenues the ribbons fly, so passing along any
 * avenue round it arrives (and on the last stretch the ribbon may circle the tower).
 */
export function cityDestinations(L: CityLayout): DestinationSource {
  return landmarkDestinations((x, z, R, out) => {
    const S = L.S;
    for (let J = Math.floor((z - R) / S); J <= Math.floor((z + R) / S); J++)
      for (let I = Math.floor((x - R) / S); I <= Math.floor((x + R) / S); I++) {
        const kind = L.superKind(I, J);
        if (kind === 0) continue;
        const bi = I * 3 + 1;
        const bj = J * 3 + 1;
        const bk = L.blockKind(bi, bj);
        if (bk !== BK.LANDMARK && bk !== BK.SHRINE) continue;
        const tower = bk === BK.LANDMARK;
        const cx = L.blockX0(bi) + L.B / 2;
        const cz = L.blockZ0(bj) + L.B / 2;
        const g = L.baseHeight(cx, cz);
        // The cairn: in the block's corner, clear of the tower's base and the shrine.
        const sx = hash2(I, J, 731) < 0.5 ? -1 : 1;
        const sz = hash2(I, J, 732) < 0.5 ? -1 : 1;
        const off = L.B * 0.38;
        const rx = cx + sx * off;
        const rz = cz + sz * off;
        const l: Landmark = {
          id: `city:${I},${J}`,
          name: tower
            ? landmarkName(hash2(I, J, 733), TOWER_FIRST, TOWER_KIND)
            : landmarkName(hash2(I, J, 734), SHRINE_FIRST, SHRINE_KIND),
          x: cx,
          z: cz,
          y: tower ? g + 232 : g,
          top: tower ? g + 232 : g + 60,
          r: S * 0.6,
          roost: { x: rx, y: L.baseHeight(rx, rz), z: rz, yaw: Math.atan2(cx - rx, cz - rz) },
        };
        out.push(l);
      }
  });
}
