import { defineFinds, type DiscoveryDef } from '../Discoveries';
import type { CityLayout, Tower } from './CityLayout';

const tower: Tower = { x: 0, z: 0, half: 0, top: 0 };

/** Neon Bay's finds: a tall tower's top, the river through the city, the bay's far shore. */
export function cityFinds(L: CityLayout): DiscoveryDef[] {
  return defineFinds('city', {
    crown: {
      at: (x, y, z) =>
        L.towerNear(x, z, 30, tower) && tower.top > 120 && y > tower.top - 4 && y < tower.top + 30,
    },
    // Low along the channel (not the bay) for a few seconds: following it, not crossing it.
    river: {
      dwell: 3,
      at: (x, y, z) => L.river(x, z) > 0.8 && !L.inSea(x, z) && y < L.height(x, z) + 14,
    },
    // The spawn faces the city across the bay; this is the land behind the bird.
    shore: { at: (x, _y, z) => z > L.shoreFar(x) + 30 },
  });
}
