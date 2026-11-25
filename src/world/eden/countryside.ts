import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import type { LandField } from '../Terrain';
import type { EdenLayout } from './EdenLayout';
import { heartPoint } from './heart';

/**
 * Eden's countryside (pure): the wedding scattered through the Highlands, per 300 m cell.
 * Flower arches and strings of fairy lights over the roads, groves of blossom trees planted
 * in the shape of a heart, pink heart clouds, and doves wheeling in small flocks. The stops'
 * meadows and the heart lake are kept clear.
 */

export const CELL = 300;

/** Over a road: an arch of flowers (kind 0) or a string of lights and bunting (kind 1). */
export interface Arch {
  x: number;
  y: number;
  z: number;
  /** Along the road. */
  yaw: number;
  kind: 0 | 1;
}

/** A grove of blossom trees round a heart's outline; its trees as x, y, z triples. */
export interface Grove {
  x: number;
  y: number;
  z: number;
  size: number;
  yaw: number;
  trees: Float64Array;
}

/** A heart of pink cloud, standing upright in the sky. */
export interface HeartCloud {
  x: number;
  y: number;
  z: number;
  scale: number;
}

/** A few doves circling a point. */
export interface Doves {
  x: number;
  y: number;
  z: number;
  r: number;
  /** rad/s round the circle (sign: which way). */
  speed: number;
  phase: number;
  count: number;
}

export interface CountryCell {
  readonly arches: readonly Arch[];
  readonly groves: readonly Grove[];
  readonly clouds: readonly HeartCloud[];
  readonly doves: readonly Doves[];
}

/** Grid spacing (m) of the points tried for arches, and the least gap between two. */
const ROAD_STEP = 75;
const ARCH_GAP = 60;
const TREE_H = 7.5;
const pt = { x: 0, y: 0 };

export class Countryside {
  private readonly cells = new Map<number, CountryCell>();

  constructor(
    private readonly field: LandField,
    private readonly layout: EdenLayout,
    private readonly seed: number,
  ) {}

  /** The cell (i, j), built once and kept (the oldest dropped past a few hundred). */
  cell(i: number, j: number): CountryCell {
    const key = i * 65536 + j;
    let c = this.cells.get(key);
    if (!c) {
      c = this.build(i, j);
      if (this.cells.size > 400) {
        const first = this.cells.keys().next();
        if (!first.done) this.cells.delete(first.value);
      }
      this.cells.set(key, c);
    }
    return c;
  }

  /**
   * The flight floor the groves add at (x, z): a soft crown over each tree (-Infinity: none).
   * Read every step: allocates nothing once the cells round the bird are built.
   */
  liftAt(x: number, z: number): number {
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    let top = -Infinity;
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++) {
        const groves = this.cell(i, j).groves;
        for (let g = 0; g < groves.length; g++) {
          const G = groves[g];
          if ((x - G.x) ** 2 + (z - G.z) ** 2 > (G.size * 1.6) ** 2) continue;
          const T = G.trees;
          for (let k = 0; k < T.length; k += 3) {
            const d2 = (x - T[k]) ** 2 + (z - T[k + 2]) ** 2;
            if (d2 < 25) top = Math.max(top, T[k + 1] + TREE_H + 0.5 - d2 * 0.12);
          }
        }
      }
    return top;
  }

  /** Clear of the story's meadows and the lake (where Eden's own scenery stands). */
  private clear(x: number, z: number, margin: number): boolean {
    const L = this.layout;
    for (const S of [L.tal, L.hadar, L.venue, L.lake])
      if (Math.hypot(x - S.x, z - S.z) < S.blend + margin) return false;
    return true;
  }

  private build(i: number, j: number): CountryCell {
    const E = Config.eden;
    const f = this.field;
    const s = this.seed;
    // Offset cells (hash2 mirrors through the origin: see the level skill's traps).
    const hi = i + 7919;
    const hj = j + 104729;
    const x0 = i * CELL;
    const z0 = j * CELL;

    // Arches and lights where the road crosses the cell: grid points pulled onto the road
    // line (the river's distance at roadOffset) by a first-order step along its gradient.
    const arches: Arch[] = [];
    const R = Config.highlands.roadOffset;
    for (let a = 0; a < CELL / ROAD_STEP; a++)
      for (let b = 0; b < CELL / ROAD_STEP; b++) {
        let x = x0 + (a + 0.5) * ROAD_STEP;
        let z = z0 + (b + 0.5) * ROAD_STEP;
        const d = f.riverDist(x, z) - R;
        if (Math.abs(d) > ROAD_STEP * 0.6) continue;
        const e = 2;
        const gx = (f.riverDist(x + e, z) - f.riverDist(x - e, z)) / (2 * e);
        const gz = (f.riverDist(x, z + e) - f.riverDist(x, z - e)) / (2 * e);
        const g2 = gx * gx + gz * gz;
        if (g2 < 0.25) continue;
        x -= (d * gx) / g2;
        z -= (d * gz) / g2;
        if (x < x0 || x >= x0 + CELL || z < z0 || z >= z0 + CELL) continue;
        if (Math.abs(f.riverDist(x, z) - R) > 1.5) continue;
        if (!this.clear(x, z, 40)) continue;
        const yaw = Math.atan2(gz, -gx); // along the road: across the gradient
        const y = f.height(x, z);
        const ax = Math.sin(yaw) * 6;
        const az = Math.cos(yaw) * 6;
        // On dry, level road only.
        if (y < 1.2 || Math.abs(f.height(x + ax, z + az) - f.height(x - ax, z - az)) > 2.5)
          continue;
        if (arches.some((o) => Math.hypot(o.x - x, o.z - z) < ARCH_GAP)) continue;
        if (hash2(hi * 4 + a, hj * 4 + b, s + 11) > E.roadDecor) continue;
        const kind = hash2(hi * 4 + a, hj * 4 + b, s + 12) < 0.45 ? 0 : 1;
        arches.push({ x, y, z, yaw, kind });
      }

    // A heart grove: on open, gentle, dry ground away from the woods.
    const groves: Grove[] = [];
    if (hash2(hi, hj, s + 21) < E.groves) {
      const x = x0 + (0.2 + 0.6 * hash2(hi, hj, s + 22)) * CELL;
      const z = z0 + (0.2 + 0.6 * hash2(hi, hj, s + 23)) * CELL;
      const size = 20 + 10 * hash2(hi, hj, s + 24);
      const y = f.height(x, z);
      let level = true;
      for (let k = 0; k < 6 && level; k++) {
        const a = (k / 6) * Math.PI * 2;
        level = Math.abs(f.height(x + Math.sin(a) * size, z + Math.cos(a) * size) - y) < 8;
      }
      if (
        level &&
        y > 2 &&
        y < 70 &&
        f.forest(x, z) < 0.4 &&
        Math.abs(f.riverDist(x, z)) > R + size + 8 &&
        this.clear(x, z, size + 20)
      ) {
        const yaw = hash2(hi, hj, s + 25) * Math.PI * 2;
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const n = E.groveTrees;
        const trees = new Float64Array(n * 3);
        for (let k = 0; k < n; k++) {
          heartPoint(k / n, pt);
          const tx = x + (pt.x * c + pt.y * sn) * size;
          const tz = z + (-pt.x * sn + pt.y * c) * size;
          trees[k * 3] = tx;
          trees[k * 3 + 1] = f.height(tx, tz);
          trees[k * 3 + 2] = tz;
        }
        groves.push({ x, y, z, size, yaw, trees });
      }
    }

    // A heart of cloud now and then, high over the land.
    const clouds: HeartCloud[] = [];
    if (hash2(hi, hj, s + 31) < E.heartClouds) {
      const x = x0 + hash2(hi, hj, s + 32) * CELL;
      const z = z0 + hash2(hi, hj, s + 33) * CELL;
      const y = Math.max(f.height(x, z), 0) + 120 + 70 * hash2(hi, hj, s + 34);
      clouds.push({ x, y, z, scale: 12 + 8 * hash2(hi, hj, s + 35) });
    }

    // Doves wheeling over the fields.
    const doves: Doves[] = [];
    if (hash2(hi, hj, s + 41) < E.doveFlocks) {
      const x = x0 + hash2(hi, hj, s + 42) * CELL;
      const z = z0 + hash2(hi, hj, s + 43) * CELL;
      doves.push({
        x,
        y: Math.max(f.height(x, z), 0) + 35 + 35 * hash2(hi, hj, s + 44),
        z,
        r: 18 + 18 * hash2(hi, hj, s + 45),
        speed: (hash2(hi, hj, s + 46) < 0.5 ? -1 : 1) * (0.35 + 0.2 * hash2(hi, hj, s + 47)),
        phase: hash2(hi, hj, s + 48) * Math.PI * 2,
        count: 3 + Math.floor(hash2(hi, hj, s + 49) * 4),
      });
    }
    return { arches, groves, clouds, doves };
  }
}
