import { Config } from '../../core/Config';
import type { CoverStyle, CoverTuft } from '../GroundCover';
import { FLOODED, paddyKind, RIPE } from './KarstLayout';

/** Petals (sRGB): white, pale pink, buttercup, a little violet. */
const PETALS = ['#f7f3ea', '#f1c3cf', '#f2d35a', '#b7a7e6'] as const;

/**
 * Jade River's ground cover, read from the terrain's `aKarst` (see Land): reeds standing tall
 * along the river's edge, grass and wildflowers on the meadows, ferny undergrowth under the
 * groves and bamboo, bare footpaths, and rice on the paddy treads: sparse shoots in the flooded
 * fields, young rice standing green, ripening rice tall and gold. The terrace a tuft stands on
 * and its field are found as the shader finds them (raw height over the step, the field grid),
 * so the rice fills exactly the fields painted under it; bunds and risers keep their grass.
 */
export function karstCover(): CoverStyle {
  const KC = Config.karst;
  const paint = (x: number, z: number, _y: number, t: CoverTuft): void => {
    const m = t.more!;
    const bank = m[0];
    const pg = m[1];
    const raw = m[2];
    const path = m[3];
    if (path < -0.3) {
      // A pillar's scree: moss and the odd fern between the stones.
      if ((((Math.floor(x * 2.1) * 7 + Math.floor(z * 2.1) * 13) % 5) + 5) % 5 > 1) {
        t.bare = true;
        return;
      }
      t.scale *= 0.75;
      t.r *= 0.85;
      t.b *= 0.85;
      t.bloom = 0;
      return;
    }
    if ((path >= 0 && path < KC.pathWidth * 1.1) || bank < 0.3) {
      t.bare = true;
      return;
    }
    if (bank < 4.5) {
      // Reeds at the water's edge: tall, a cooler green, no flowers.
      t.scale *= 2.4 - bank * 0.2;
      t.r *= 0.9;
      t.g *= 1.05;
      t.b *= 0.85;
      t.bloom = 0;
      return;
    }
    if (pg < -0.3) {
      // Undergrowth under the groves and bamboo: lush, dark, a few white flowers.
      t.scale *= 1.25;
      t.r *= 0.82;
      t.g *= 0.95;
      t.b *= 0.82;
      t.bloom = 0.04;
      t.petal = 0;
      return;
    }
    if (pg < 0.6) return; // meadow
    const step = KC.terraceStep;
    const lv = raw / step;
    const ti = Math.floor(lv);
    const fr = lv - ti;
    if (fr > 0.8) return; // the riser: grass
    const fc = KC.fieldCell;
    const cx = Math.floor(x / fc);
    const cz = Math.floor(z / fc);
    // Off the cross bunds (a metre of grass between fields).
    const ex = Math.min(x / fc - cx, cx + 1 - x / fc) * fc;
    const ez = Math.min(z / fc - cz, cz + 1 - z / fc) * fc;
    if (Math.min(ex, ez) < 0.8 || fr < 0.04) return;
    const kind = paddyKind(ti, cx, cz);
    t.bloom = 0;
    if (kind < FLOODED) {
      // Flooded: a few rows of new shoots stand out of the water.
      if ((Math.floor(x * 1.6) + Math.floor(z * 1.6)) % 3 !== 0) {
        t.bare = true;
        return;
      }
      t.r = 0.36;
      t.g = 0.62;
      t.b = 0.2;
      t.scale *= 0.55;
    } else if (kind < RIPE) {
      t.r = 0.32;
      t.g = 0.6;
      t.b = 0.14;
      t.scale *= 1.05;
    } else {
      t.r = 0.78;
      t.g = 0.62;
      t.b = 0.22;
      t.scale *= 1.3;
    }
  };
  return {
    tint: [1.03, 1.06, 0.96],
    height: 1,
    minY: 0.15,
    maxY: 80,
    flowers: { chance: 0.3, colors: PETALS },
    extra: 'aKarst',
    paint,
  };
}
