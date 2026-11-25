import type { CoverStyle } from '../GroundCover';
import { highlandsCover } from '../highlands/crops';
import {
  Field,
  fieldCoords,
  fieldKind,
  type FieldCoords,
  type HighlandsLayout,
} from '../highlands/HighlandsLayout';

/** Eden's fields, painted in the terrain (wheat, pasture, plough, rows, rapeseed). */
export const EDEN_FIELDS = ['#b9a4dc', '#8fc466', '#a98262', '#9cc46c', '#f7c3d1'] as const;

/** Petals (sRGB): white, rose, blush, lavender, coral. */
const PETALS = ['#fbf7ee', '#f27a9b', '#f8c6d2', '#b59ae0', '#f59a84'] as const;
const ROSE = 1;
const LAVENDER = 3;

const fc: FieldCoords = { u: 0, w: 0 };

/**
 * The Highlands' cover turned to a wedding's flowers: the wheat is lavender, the rapeseed is a
 * field of roses, and the meadows' wildflower drifts are thicker and in blush and white.
 */
export function edenCover(layout: HighlandsLayout): CoverStyle {
  const base = highlandsCover(layout);
  const paint = base.paint;
  return {
    ...base,
    flowers: { chance: 0.6, colors: PETALS },
    paint: (x, z, y, t) => {
      paint?.(x, z, y, t);
      if (t.bare) return;
      fieldCoords(x, z, fc);
      const i = Math.floor(fc.u);
      const j = Math.floor(fc.w);
      if (!layout.cellFarmed(i, j)) return;
      const kind = fieldKind(i, j);
      if (kind === Field.Wheat) {
        // Lavender in rows of grey-green bushes, in flower.
        t.r = 0.42;
        t.g = 0.45;
        t.b = 0.5;
        t.scale *= 0.85;
        t.bloom = 0.85;
        t.petal = LAVENDER;
      } else if (kind === Field.Rapeseed) {
        t.bloom = 0.9;
        t.petal = ROSE;
      }
    },
  };
}
