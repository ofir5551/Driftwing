import { Config } from '../../core/Config';
import type { CoverStyle, CoverTuft } from '../GroundCover';
import {
  Field,
  fieldCoords,
  fieldKind,
  type FieldCoords,
  type HighlandsLayout,
} from './HighlandsLayout';

/** Petals (sRGB): white, buttercup, pink, harebell, poppy; rapeseed blooms buttercup. */
const PETALS = ['#fbf7ee', '#f7d34a', '#f3a6c4', '#a9b6f2', '#ef7a5c'] as const;
const BUTTERCUP = 1;

const fc: FieldCoords = { u: 0, w: 0 };

/**
 * The Highlands' ground cover: meadow grass with wildflower drifts, from the beaches (sand gives
 * way to grass by ~1.5 m) to where the high ground pales; bare on the road (the terrain's
 * `aLand.x` is the distance from the river, the road runs at roadOffset) and on ploughed
 * fields; standing crops on the farmed fields: tall golden wheat, rapeseed in yellow bloom,
 * short crop rows. Fields keep their edges bare, where the walls stand.
 */
export function highlandsCover(layout: HighlandsLayout): CoverStyle {
  const H = Config.highlands;
  const paint = (x: number, z: number, _y: number, t: CoverTuft): void => {
    if (Math.abs(t.extra - H.roadOffset) < H.roadWidth * 0.95) {
      t.bare = true;
      return;
    }
    fieldCoords(x, z, fc);
    const i = Math.floor(fc.u);
    const j = Math.floor(fc.w);
    if (!layout.cellFarmed(i, j)) return;
    const kind = fieldKind(i, j);
    if (kind === Field.Meadow) return;
    if (kind === Field.Pasture) {
      t.bloom = 0; // grazed: grass, no flowers
      return;
    }
    if (kind === Field.Plough) {
      t.bare = true;
      return;
    }
    // Keep a metre bare along the walls.
    const eu = Math.min(fc.u - i, i + 1 - fc.u);
    const ew = Math.min(fc.w - j, j + 1 - fc.w);
    if (Math.min(eu, ew) * H.fieldCell < 0.9) {
      t.bare = true;
      return;
    }
    if (kind === Field.Wheat) {
      // Standing wheat: tall, golden, no flowers.
      t.r = 0.82;
      t.g = 0.6;
      t.b = 0.2;
      t.scale *= 1.35;
      t.bloom = 0;
    } else {
      t.r *= 0.85;
      t.g *= 0.95;
      t.b *= 0.7;
      if (kind === Field.Rows) {
        t.scale *= 0.8;
        t.bloom = 0;
      } else {
        t.scale *= 1.1;
        t.bloom = 0.75;
        t.petal = BUTTERCUP;
      }
    }
  };
  return {
    tint: [1.04, 1.06, 0.95],
    height: 1,
    minY: 1.4,
    maxY: 100,
    flowers: { chance: 0.42, colors: PETALS },
    extra: 'aLand',
    paint,
  };
}
