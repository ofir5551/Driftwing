import type { CoverStyle, CoverTuft } from '../GroundCover';
import { hash2 } from '../noise';
import { cushionGeometry, puffsGeometry, trumpetGeometry } from './shapes';

/** Cover shapes beside the moss tuft (CoverStyle.shapes, 1-based in `t.shape`). */
export const COVER_CUSHION = 1;
export const COVER_TRUMPET = 2;
export const COVER_PUFFS = 3;

/** Petals (sRGB): teal star-moss, magenta cups, pale gold bells, lilac-white sprays. */
const PETALS = ['#7ff5e6', '#e86bd2', '#f6e08a', '#efe2ff'] as const;

/**
 * Ringmoon Shallows' ground cover, from the terrain's `aRing` (t.extras: path distance, sand
 * bar, mainland, islet; see land.ts) and height. Under the clear water, dark sea moss grows in
 * the moss beds (not on the sand or the bars). The wet sand and the paths are bare. On the
 * islets: violet moss tufts with cushions, trumpet flowers and spore puffs among them, and
 * drifts of odd blossoms; on the hills, teal moss, more cushions and puffs, fewer flowers. Bare
 * on the rock of the terrace risers and the rust ledges.
 */
export function ringCover(): CoverStyle {
  const paint = (x: number, z: number, y: number, t: CoverTuft): void => {
    const h = hash2(Math.round(x * 8), Math.round(z * 8), 613);
    const lum = t.r + t.g + t.b;
    if (y < -0.5) {
      // Sea moss in the beds: the ground there is dark (violet, amber); sand and bars are bare.
      if (lum > 1.5 || t.extras[1] > 0.3 || h > 0.55) {
        t.bare = true;
        return;
      }
      t.r *= 0.55;
      t.g *= 0.7;
      t.b *= 0.75;
      t.scale *= 1.35;
      t.bloom = 0;
      return;
    }
    if (y < 1.3 || t.extras[0] < 0.62) {
      t.bare = true; // the wet sand, the swash, the paths and the trodden ground
      return;
    }
    // Rust ledges and basalt on the risers: the ground paints warm and dark there.
    if (t.r > t.b * 1.25 && t.r > t.g) {
      t.bare = true;
      return;
    }
    const hills = t.extras[2] > 0.5;
    if (y < 2) {
      // The upper beach: sparse, the odd trumpet in the sand.
      if (h < 0.04) shape(t, 1, COVER_TRUMPET);
      else if (h < 0.3) t.scale *= 0.7;
      else t.bare = true;
      return;
    }
    if (h < (hills ? 0.08 : 0.055)) {
      shape(t, 0.95 + h, COVER_CUSHION);
      // Cushions take the moss's own hue: violet on the islets, teal on the hills.
      if (hills) {
        t.r = 0.55;
        t.g = 1.25;
        t.b = 1.0;
      }
      t.scale *= 1 + h * 6;
      return;
    }
    if (h < (hills ? 0.1 : 0.085)) {
      shape(t, 1, COVER_TRUMPET);
      return;
    }
    if (h < (hills ? 0.15 : 0.12)) {
      shape(t, 1, COVER_PUFFS);
      return;
    }
    if (h > (hills ? 0.62 : 0.68)) {
      t.bare = true;
      return;
    }
    // Moss tufts: short and soft, a touch lighter than the carpet.
    t.scale *= hills ? 0.75 : 0.8;
    if (hills) t.bloom = 0.012;
  };
  return {
    tint: [1.06, 1.02, 1.08],
    height: 0.85,
    minY: -4.5,
    maxY: 400,
    flowers: { chance: 0.05, colors: PETALS },
    extra: 'aRing',
    paint,
    shapes: [
      { name: 'cover-cushion', geometry: cushionGeometry, cap: 2600 },
      { name: 'cover-trumpet', geometry: trumpetGeometry, cap: 1600 },
      { name: 'cover-puffs', geometry: puffsGeometry, cap: 2000 },
    ],
  };
}

/** A shape keeps its own colours (instance colour ~white, a touch varied). */
function shape(t: CoverTuft, v: number, k: number): void {
  t.r = t.g = t.b = v;
  t.shape = k;
}
