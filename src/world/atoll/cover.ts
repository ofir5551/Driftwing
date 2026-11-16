import type { CoverStyle, CoverTuft } from '../GroundCover';
import { hash2 } from '../noise';
import type { AtollLayout } from './AtollLayout';
import { driftwoodGeometry, fernGeometry, shellsGeometry } from './shapes';

/** Cover shapes beside the grass tuft (CoverStyle.shapes, 1-based in `t.shape`). */
export const COVER_FERN = 1;
export const COVER_DRIFTWOOD = 2;
export const COVER_SHELLS = 3;

/** Petals (sRGB): beach morning glory, naupaka white, beach sunflower, hibiscus red. */
const PETALS = ['#d77bd0', '#f7f3ea', '#f2cd4b', '#e2483d'] as const;
const GLORY = 0;

/**
 * Coral Atolls' ground cover, from the terrain's `aAtoll` (t.extras: reef flat, ocean side,
 * seagrass, coral; see land.ts) and height. Seagrass sways on the sandy shallows under the
 * clear water. The wet sand at the waterline is bare but for shells; driftwood lies along the
 * high-tide line. The dry beach grows sparse dune grass and creeping morning glory in pink
 * bloom; under the palms, grass with ferns and the odd flower; in the jungle, ferns and dark
 * undergrowth between the painted crowns. Bare on the exposed reef, round the huts and on rock.
 */
export function atollCover(L: AtollLayout): CoverStyle {
  const paint = (x: number, z: number, y: number, t: CoverTuft): void => {
    const h = hash2(Math.round(x * 8), Math.round(z * 8), 917);
    if (y < -0.4) {
      // Seagrass meadows: long dark blades, only where the meadow is thick.
      if (t.extras[2] < 0.35 || h > 0.8) {
        t.bare = true;
        return;
      }
      t.r = 0.04;
      t.g = 0.15;
      t.b = 0.09;
      t.scale *= 1.5;
      t.bloom = 0;
      return;
    }
    if (t.extras[0] > 0.5 || y < 0.15) {
      t.bare = true; // the reef's rubble, the swash
      return;
    }
    if (y < 0.7) {
      // The wet sand: shells washed up, the odd piece of driftwood stranded high.
      if (h < 0.035) tint(t, 1, COVER_SHELLS);
      else if (h < 0.045 && y > 0.4) tint(t, 1, COVER_DRIFTWOOD);
      else t.bare = true;
      return;
    }
    if (y > 0.7 && y < 3.5 && L.villageAt(x, z) !== -Infinity) {
      t.bare = true; // the swept sand under a hut
      return;
    }
    if (y < 1.5) {
      // The dry beach: mostly bare sand.
      if (h < 0.16) {
        // Dune grass: pale, wiry, taller.
        t.r = 0.36;
        t.g = 0.36;
        t.b = 0.12;
        t.scale *= 1.25;
        t.bloom = 0;
      } else if (h < 0.25) {
        // Beach morning glory creeping over the sand in pink bloom.
        t.r = 0.12;
        t.g = 0.3;
        t.b = 0.08;
        t.scale *= 0.6;
        t.bloom = 0.55;
        t.petal = GLORY;
      } else if (h < 0.262 && y < 1.1) tint(t, 1, COVER_DRIFTWOOD);
      else t.bare = true;
      return;
    }
    // Rock (cliff paint): bare.
    if (t.r > t.g) {
      t.bare = true;
      return;
    }
    if (y < 5) {
      // Under the palms: grass, ferns, a few flowers.
      if (h < 0.06) {
        tint(t, 0.95 + h, COVER_FERN);
        return;
      }
      if (h > 0.75) {
        t.bare = true;
        return;
      }
      t.bloom = 0.03;
      return;
    }
    // The jungle floor between the painted crowns: ferns and dark undergrowth, sparse.
    if (h < 0.1) {
      tint(t, 0.85 + h, COVER_FERN);
      t.scale *= 1.3;
    } else if (h < 0.24) {
      t.r *= 0.7;
      t.g *= 0.8;
      t.b *= 0.7;
      t.scale *= 1.5;
      t.bloom = 0;
    } else t.bare = true;
  };
  return {
    tint: [1, 1.04, 0.92],
    height: 1,
    minY: -3.5,
    maxY: 400,
    flowers: { chance: 0.04, colors: PETALS },
    extra: 'aAtoll',
    paint,
    shapes: [
      { name: 'cover-fern', geometry: fernGeometry, cap: 3000 },
      { name: 'cover-driftwood', geometry: driftwoodGeometry, cap: 500 },
      { name: 'cover-shells', geometry: shellsGeometry, cap: 1200 },
    ],
  };
}

/** A shape keeps its own colours (instance colour ~white, a touch varied). */
function tint(t: CoverTuft, v: number, shape: number): void {
  t.r = t.g = t.b = v;
  t.shape = shape;
}
