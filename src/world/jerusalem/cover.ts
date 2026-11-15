import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { CoverStyle, CoverTuft } from '../GroundCover';
import { createNoise2D } from '../noise';
import { FIELD, type JerusalemLayout } from './JerusalemLayout';

/**
 * Spring flowers of the Judean hills (sRGB): red anemone, yellow crown daisy, white, the pink of
 * cyclamen, the purple of wild iris. Drifts pick a family by place; orchards favour anemones.
 */
const PETALS = ['#d8342b', '#f2c94a', '#d8342b', '#f6f0e4', '#e98cb3', '#9d6fc8'] as const;
const ANEMONE = 0;
const DAISY = 1;

/**
 * City of Gold's ground cover (the terrain's `aJLand` reaches `paint` as `t.extras`: road and
 * path centre distances, the valley bed's, and the habitat): dry golden grass on the open
 * hills broken by bare, stony patches and low cushions of grey-green thyme and sage; greener
 * grass with drifts of red anemones under the olives on the terraces; wildflowers in drifts
 * elsewhere. Bare on the roads, paths and pebble beds, the risers, the paved and built ground;
 * stubble, green crops and bare plough on the walled fields.
 */
export function jerusalemCover(layout: JerusalemLayout): CoverStyle {
  const K = Config.jerusalem;
  const patches = createNoise2D(layout.seed + 61);
  const paint = (x: number, z: number, y: number, t: CoverTuft): void => {
    const [road, path, bed, hab] = t.extras;
    if (
      hab < -0.4 ||
      Math.abs(road) < K.roadWidth + 0.6 ||
      Math.abs(path) < 1.2 ||
      Math.abs(bed) < K.bedWidth + 0.3
    ) {
      t.bare = true;
      return;
    }
    if (hab > 0.4) {
      // Terraces: bare on the stone risers (between the flats), greener under the olives.
      const f = y / K.terraceStep;
      if (Math.abs(f - Math.round(f)) > 0.12) {
        t.bare = true;
        return;
      }
      t.r *= 0.9;
      t.g *= 1.06;
      t.b *= 0.85;
      t.bloom = 0.22;
      t.petal = ANEMONE;
      return;
    }
    const field = layout.fieldAt(x, z);
    if (field >= 0) {
      if (field === FIELD.PLOUGH) t.bare = true;
      else if (field === FIELD.STUBBLE) {
        t.r = 0.78;
        t.g = 0.58;
        t.b = 0.26;
        t.scale *= 0.6;
        t.bloom = 0;
      } else if (field === FIELD.GREEN) {
        t.r = 0.3;
        t.g = 0.42;
        t.b = 0.14;
        t.scale *= 0.9;
        t.bloom = 0;
      } else {
        t.bloom = 0.1;
        t.petal = DAISY;
      }
      return;
    }
    // Open hills: the stony ground shows through in patches; elsewhere golden grass, and in
    // between, cushions of thyme and sage.
    const n = patches(x * 0.05, z * 0.05);
    if (n < -0.25) {
      t.bare = true;
      return;
    }
    const thyme = smoothstep(-0.25, -0.05, n) * (1 - smoothstep(-0.05, 0.15, n));
    if (thyme > 0.5) {
      t.r *= 0.72;
      t.g *= 0.86;
      t.b *= 0.82;
      t.scale *= 0.7;
      t.bloom = 0.05;
      t.petal = 5;
      return;
    }
    // Dry golden grass, taller and paler.
    t.r *= 1.08;
    t.g *= 1.0;
    t.b *= 0.78;
    t.scale *= 1.15;
  };
  return {
    tint: [1.02, 1.0, 0.86],
    height: 0.95,
    minY: 10,
    maxY: 400,
    flowers: { chance: 0.3, colors: PETALS },
    extra: 'aJLand',
    paint,
  };
}
