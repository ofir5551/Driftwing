import type { CoverStyle, CoverTuft } from '../GroundCover';
import { hash2 } from '../noise';
import { sageGeometry } from './geometry';
import { cactusGeometry, tumbleweedGeometry } from './shapes';

/** Cover shapes beside the grass tuft (CoverStyle.shapes, 1-based in `t.shape`). */
export const COVER_SAGE = 1;
export const COVER_CACTUS = 2;
export const COVER_TUMBLEWEED = 3;

/**
 * Petals (sRGB) of the desert after rain: globemallow orange, desert marigold, sand verbena,
 * penstemon red, evening primrose white. Rabbitbrush blooms marigold yellow.
 */
const PETALS = ['#f08a4b', '#f4d03f', '#b67fd0', '#e0533d', '#f6f1e6'] as const;
const MARIGOLD = 1;

/**
 * Red Canyons' ground cover, from the terrain's `aLand` (t.ex: road, wash, slickrock, a brow's
 * shade; see rock.ts). The river's banks grow lush green grass; the dry floors and the plateau
 * a sparse desert of pale bunchgrass, grey-green rabbitbrush in yellow bloom, sagebrush mounds,
 * prickly pear and the odd tumbleweed caught against them; the wash beds, where the rain runs,
 * fill with wildflowers. Bare on the road, the slickrock and under a dwelling's brow.
 */
export function canyonCover(): CoverStyle {
  const paint = (x: number, z: number, _y: number, t: CoverTuft): void => {
    const road = t.ex[0];
    const wash = t.ex[1];
    if (road < 1.15 || t.ex[2] > 0.3 || t.ex[3] > 0.15) {
      t.bare = true;
      return;
    }
    // The bank's green shows in the ground colour (green over red): lush grass, few flowers.
    if (t.g > t.r * 0.92) {
      t.scale *= 1.2;
      t.r *= 0.92;
      t.g *= 1.08;
      t.bloom = 0.04;
      return;
    }
    const h = hash2(Math.round(x * 8), Math.round(z * 8), 913);
    if (wash < 1) {
      // A wash bed after rain: grass and wildflowers in drifts, a tumbleweed fetched up.
      if (h < 0.25) {
        t.bare = true;
        return;
      }
      if (h > 0.985) {
        tint(t, 1, COVER_TUMBLEWEED);
        return;
      }
      t.r = t.r * 0.6 + 0.2;
      t.g = t.g * 0.6 + 0.24;
      t.b = t.b * 0.6 + 0.08;
      t.bloom = 0.42;
      return;
    }
    // The open desert: mostly bare sand between the plants.
    if (h < 0.55) {
      t.bare = true;
      return;
    }
    if (h < 0.6) {
      tint(t, 0.95 + (h - 0.55) * 2, COVER_SAGE);
      t.scale *= 1.1;
      return;
    }
    if (h < 0.615) {
      tint(t, 1, COVER_CACTUS);
      return;
    }
    if (h < 0.62) {
      tint(t, 1, COVER_TUMBLEWEED);
      return;
    }
    if (h < 0.7) {
      // Rabbitbrush: a taller grey-green tuft in yellow bloom.
      t.r = 0.36;
      t.g = 0.4;
      t.b = 0.24;
      t.scale *= 1.45;
      t.bloom = 0.8;
      t.petal = MARIGOLD;
      return;
    }
    // Bunchgrass: pale straw, picking up a little of the ground's colour.
    t.r = t.r * 0.35 + 0.42;
    t.g = t.g * 0.35 + 0.36;
    t.b = t.b * 0.35 + 0.16;
    t.bloom = 0.05;
  };
  return {
    tint: [1, 1.04, 0.9],
    height: 0.9,
    minY: 0.4,
    maxY: 400,
    flowers: { chance: 0.1, colors: PETALS },
    extra: 'aLand',
    paint,
    shapes: [
      { name: 'cover-sage', geometry: sageGeometry, cap: 2500 },
      { name: 'cover-cactus', geometry: cactusGeometry, cap: 1200 },
      { name: 'cover-tumbleweed', geometry: tumbleweedGeometry, cap: 800 },
    ],
  };
}

/** A shape keeps its own colours (instance colour ~white, a touch varied). */
function tint(t: CoverTuft, v: number, shape: number): void {
  t.r = t.g = t.b = v;
  t.shape = shape;
}
