import type { CoverStyle, CoverTuft } from '../GroundCover';
import { hash2 } from '../noise';
import { BK, CityLayout, ZONE_AVENUE, ZONE_STREET } from './CityLayout';

/** Bedding plants (sRGB): tulip red, marigold, white, pink, violet, then wildflowers. */
const PETALS = ['#e2453a', '#f3b13a', '#f7f2e8', '#ef8fb4', '#8f6fd0', '#f6e27a'] as const;

/**
 * `aCityLand` (per terrain vertex): 1 parks and groves, 0.85 the green strips by the bayside
 * road, 0.6 house gardens, 0 paved.
 */
export function cityLand(L: CityLayout, x: number, z: number): number {
  if (L.shoreDist(x, z) < L.roadIn + 3 || L.bankDist(x, z) < L.riverWalk) return 0;
  const zone = L.zoneAt(x, z);
  if (zone === ZONE_AVENUE || zone === ZONE_STREET)
    // The green strip where an east-west road stops short of the bayside road.
    return !L.northSouthRoad(x) && L.shoreDist(x, z) < L.eastWestIn ? 0.85 : 0;
  if (zone === BK.PARK || zone === BK.FOREST) return 1;
  if (zone === BK.HOUSES) return 0.6;
  if (zone === BK.SHRINE || zone === BK.TEMPLE) {
    // The sacred grove round the block's edge (the gravel court and the approach stay bare).
    const S = L.S;
    const u = x - Math.floor(x / S) * S;
    const v = z - Math.floor(z / S) * S;
    const edge = (w: number) => {
      const k = L.blockIndex(w);
      const s = L.AH + k * (L.B + 2 * L.SH);
      return Math.min(w - s, s + L.B - w);
    };
    return Math.min(edge(u), edge(v)) < 9 ? 1 : 0;
  }
  return 0;
}

/**
 * Neon Bay's ground cover (`aCityLand` reaches `paint` as `t.extra`): lawns in the parks, the
 * shrine groves and the green strips by the bayside road, shorter grass in the house gardens,
 * bare on the paving. Parks get bedding plants: a ring of flower beds round each park's centre
 * in one colour per park, and wildflowers in drifts under the trees.
 */
export function cityCover(L: CityLayout): CoverStyle {
  const S = L.S;
  const paint = (x: number, z: number, _y: number, t: CoverTuft): void => {
    if (t.extra < 0.45) {
      t.bare = true;
      return;
    }
    // Keep sidewalks bare to the line (the lattice blurs the mask over 4 m).
    const u = x - Math.floor(x / S) * S;
    const v = z - Math.floor(z / S) * S;
    const edge = L.SH + 2.6;
    if (
      (t.extra < 0.75 || t.extra > 0.95) &&
      (Math.abs(u - L.c1) < edge ||
        Math.abs(u - L.c2) < edge ||
        Math.abs(v - L.c1) < edge ||
        Math.abs(v - L.c2) < edge)
    ) {
      t.bare = true;
      return;
    }
    if (t.extra < 0.95) {
      if (t.extra > 0.75) return; // the green strip: plain grass
      // House gardens: short, clipped and a little greener.
      t.scale *= 0.65;
      t.g *= 1.05;
      t.bloom = 0.04;
      return;
    }
    // Park flower beds: a ring 8-10.5 m from the block's centre, one colour per park.
    const k = L.blockIndex(u);
    const l = L.blockIndex(v);
    if (k < 0 || l < 0) return;
    const I = Math.floor(x / S);
    const J = Math.floor(z / S);
    const cx = I * S + L.AH + k * (L.B + 2 * L.SH) + L.B / 2;
    const cz = J * S + L.AH + l * (L.B + 2 * L.SH) + L.B / 2;
    const r = Math.hypot(x - cx, z - cz);
    if (r > 8 && r < 10.5) {
      const h = hash2(I * 3 + k, J * 3 + l, 977);
      t.scale *= 0.75;
      t.bloom = 0.85;
      t.petal = Math.floor(h * 5);
      return;
    }
    if (r < 8) {
      // Mown lawn inside the beds.
      t.scale *= 0.7;
      t.bloom = 0;
    }
  };
  return {
    tint: [1.02, 1.04, 0.92],
    height: 0.85,
    minY: 0.8,
    maxY: 60,
    flowers: { chance: 0.18, colors: PETALS },
    extra: 'aCityLand',
    paint,
  };
}
