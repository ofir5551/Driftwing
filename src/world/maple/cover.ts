import { Config } from '../../core/Config';
import type { CoverStyle, CoverTuft } from '../GroundCover';

/** Petals (sRGB): red spider lilies, white ones, bush clover's mauve, a little gold. */
const PETALS = ['#d8302b', '#f2e8d6', '#b98ac4', '#e8b93c'] as const;

/**
 * Maple Valley's ground cover, read from the terrain's `aMaple` (see land): pampas grass
 * standing tall and pale gold in drifts across the meadows, autumn grass and red spider lilies
 * along the field edges, sparse russet tufts under the forest (the floor is mostly leaves),
 * reeds at the water's edge; bare on the roads, the paths and the raked gravel.
 */
export function mapleCover(): CoverStyle {
  const K = Config.maple;
  const paint = (x: number, z: number, _y: number, t: CoverTuft): void => {
    const m = t.extras;
    const water = m[0];
    const forest = m[1];
    const path = m[2];
    const pad = m[3];
    if (water < 0.4 || path < K.roadWidth * 1.15 || pad > 0.5) {
      t.bare = true;
      return;
    }
    if (pad < -0.4) {
      // The rice fields: short golden stubble, sparse (the paint carries the rows).
      if ((((Math.floor(x * 1.3) * 5 + Math.floor(z * 1.3) * 11) % 3) + 3) % 3 > 0) {
        t.bare = true;
        return;
      }
      t.scale *= 0.55;
      t.r = 0.72;
      t.g = 0.6;
      t.b = 0.32;
      t.bloom = 0;
      return;
    }
    if (water < 4) {
      // Reeds at the water's edge, gone straw-coloured.
      t.scale *= 2.2 - water * 0.25;
      t.r *= 1.05;
      t.g *= 0.98;
      t.b *= 0.8;
      t.bloom = 0;
      return;
    }
    if (forest > 0.45) {
      // Under the trees: mostly leaves, the odd russet tuft or fern.
      if ((((Math.floor(x * 1.9) * 7 + Math.floor(z * 1.9) * 13) % 4) + 4) % 4 > 0) {
        t.bare = true;
        return;
      }
      t.scale *= 0.8;
      t.r *= 1.05;
      t.g *= 0.7;
      t.b *= 0.6;
      t.bloom = 0;
      return;
    }
    // Pampas in drifts: tall, pale, its plumes catching the low sun.
    const drift = Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) + Math.sin(z * 0.052 - x * 0.02);
    if (drift > 0.9) {
      t.scale *= 2.3;
      t.r = 0.86;
      t.g = 0.74;
      t.b = 0.48;
      t.bloom = 0;
      return;
    }
    // Spider lilies along the paths' edges.
    if (path < K.roadWidth * 3.5) {
      t.bloom = 0.35;
      t.petal = 0;
    }
  };
  return {
    tint: [1.05, 1.0, 0.9],
    height: 1,
    minY: 0.2,
    maxY: 160,
    flowers: { chance: 0.14, colors: PETALS },
    extra: 'aMaple',
    paint,
  };
}
