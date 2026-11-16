import type { CoverStyle, CoverTuft } from '../GroundCover';
import { hash2 } from '../noise';
import { crowberryGeometry, mossGeometry } from './shapes';

/** Cover shapes beside the grass tuft (CoverStyle.shapes, 1-based in `t.shape`). */
export const COVER_CROWBERRY = 1;
export const COVER_MOSS = 2;

/** Petals (sRGB): heather pink, ling purple, cotton grass white, harebell blue, cloudberry. */
const PETALS = ['#c46aa8', '#9a5aa0', '#f3f1e8', '#7f86d0', '#e8902e'] as const;
const HEATHER = 0;
const LING = 1;
const COTTON = 2;

/**
 * Aurora Fjords' ground cover, from the terrain's `aLand` (t.extras: bank, street, waterfall,
 * snow climate; see rock.ts). On the strands: grass with moss cushions and drifts of harebell
 * and cotton grass, lusher round a waterfall's stream; up on the fell: heather in bloom, dark
 * crowberry mats, moss and pale straw grass between bare lichen. Bare on the pebble beach, the
 * village streets and wherever the snow lies.
 */
export function fjordCover(): CoverStyle {
  const paint = (x: number, z: number, y: number, t: CoverTuft): void => {
    const [bank, street, wet, snow] = t.extras;
    if (bank < 5 || street < 1.3 || snow * 1.15 > 0.4) {
      t.bare = true;
      return;
    }
    const h = hash2(Math.round(x * 8), Math.round(z * 8), 917);
    if (wet < 1.2) {
      // Spray-fed: deep green grass and moss.
      if (h < 0.25) return shape(t, 1.15, COVER_MOSS);
      t.r *= 0.7;
      t.g *= 1.15;
      t.b *= 0.7;
      t.scale *= 1.25;
      t.bloom = 0.02;
      return;
    }
    const fell = Math.min(Math.max((y - 22) / 40, 0), 1);
    if (h < 0.12 + 0.12 * fell) {
      t.bare = true; // lichen and bare stones between the plants
      return;
    }
    if (h < 0.2 + 0.18 * fell) return shape(t, 0.9 + h * 0.4, COVER_CROWBERRY);
    if (h < 0.28 + 0.22 * fell) return shape(t, 0.95 + h * 0.2, COVER_MOSS);
    if (h < 0.42 + 0.33 * fell) {
      // Heather: a low russet-purple tuft, in bloom.
      t.r = 0.2 + 0.05 * h;
      t.g = 0.085;
      t.b = 0.1;
      t.scale *= 0.7;
      t.bloom = 0.55;
      t.petal = h < 0.35 ? HEATHER : LING;
      return;
    }
    // Grass: green on the strand, paling to straw up on the fell; cotton grass in the wet.
    t.r = t.r * (1 - fell * 0.5) + fell * 0.3;
    t.g = t.g * (1 - fell * 0.5) + fell * 0.24;
    t.b = t.b * (1 - fell * 0.5) + fell * 0.08;
    if (fell > 0.5 && h > 0.93) {
      t.bloom = 0.9;
      t.petal = COTTON;
    }
  };
  return {
    tint: [1, 1.05, 0.9],
    height: 0.8,
    minY: 0.9,
    maxY: 400,
    flowers: { chance: 0.07, colors: PETALS },
    extra: 'aLand',
    paint,
    shapes: [
      { name: 'cover-crowberry', geometry: crowberryGeometry, cap: 3000 },
      { name: 'cover-moss', geometry: mossGeometry, cap: 3000 },
    ],
  };
}

/** A shape keeps its own colours (instance colour ~white, a touch varied). */
function shape(t: CoverTuft, v: number, k: number): void {
  t.r = t.g = t.b = v;
  t.shape = k;
}
