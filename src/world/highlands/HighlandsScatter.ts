import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { createNoise2D, hash2, type Noise2D } from '../noise';
import {
  BUILT_SIZE,
  Field,
  P,
  PROP_STRIDE,
  fieldKind,
  fieldPoint,
  pushProp,
  type HighlandsLayout,
} from './HighlandsLayout';

/** Tree species (index into the Highlands' tree meshes). */
export const Tree = { Broadleaf: 0, Pine: 1, Birch: 2 } as const;

const pt = { x: 0, z: 0 };
const pa = { x: 0, z: 0 };
const pb = { x: 0, z: 0 };

/**
 * Deterministic scatter of the Highlands' trees and small scenery for one chunk, pure (no
 * Three): unit-tested. Cells are enumerated by global index, so a seam never doubles or misses.
 */
export class HighlandsScatter {
  private readonly glades: Noise2D;
  private readonly rocky: Noise2D;

  constructor(private readonly layout: HighlandsLayout) {
    this.glades = createNoise2D(layout.seed + 21);
    this.rocky = createNoise2D(layout.seed + 22);
  }

  /** True when (x, z) is at least `r` metres clear of every building's footprint in `built`. */
  private clearOfBuilt(built: readonly number[], x: number, z: number, r: number): boolean {
    for (let k = 0; k < built.length; k += PROP_STRIDE) {
      const kind = built[k];
      if (kind > P.Windmill) continue;
      if (Math.hypot(x - built[k + 1], z - built[k + 3]) < r + BUILT_SIZE[kind][0]) return false;
    }
    return true;
  }

  /**
   * Forests with edges and glades, birches lighting their edges, pines up high; lone trees in
   * the open but none in fields, on roads or on top of buildings. TREE_STRIDE records.
   */
  trees(ox: number, oz: number, size: number, built: readonly number[], out: number[]): void {
    out.length = 0;
    const L = this.layout;
    const f = L.field;
    const H = Config.highlands;
    const cell = Config.world.treeCell;
    const seed = L.seed;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const r = hash2(i, j, seed);
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const forest = f.forest(x, z);
        // Glades: round openings, so a forest has rooms rather than an even carpet.
        const glade = smoothstep(0.25, 0.5, this.glades(x * 0.011, z * 0.011)) * H.clearings * 2.4;
        const density = forest * 0.78 * Math.max(0, 1 - glade) + (forest > 0.1 ? 0.02 : 0.006);
        if (r > density) continue;
        const y = f.height(x, z);
        if (y < 1.2 || y > 115) continue;
        if (L.slope(x, z, y) > 3.6) continue;
        if (L.roadDist(x, z) < H.roadWidth + 2.5) continue;
        if (!this.clearOfBuilt(built, x, z, 4)) continue;
        const sp = hash2(i, j, seed + 13);
        const kind =
          y > 55 || sp > 0.62
            ? Tree.Pine
            : sp < (forest < 0.5 ? 0.3 : 0.1)
              ? Tree.Birch
              : Tree.Broadleaf;
        const s = 0.65 + hash2(i, j, seed + 14) * 0.75;
        out.push(
          kind,
          x,
          y - 0.3,
          z,
          s,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
  }

  /**
   * The small scenery of a chunk: rocks and outcrops, bushes and logs, walls and fences round
   * the farmed fields (with gates and hedge breaks), hay on the wheat, sheep on the pasture,
   * reeds on the shore, boats off it, a flock overhead. Props go to `out` (PROP_STRIDE),
   * hedgerow trees to `hedge` (TREE_STRIDE).
   */
  props(
    ox: number,
    oz: number,
    size: number,
    built: readonly number[],
    out: number[],
    hedge: number[],
  ): void {
    out.length = 0;
    hedge.length = 0;
    this.rocks(ox, oz, size, built, out);
    this.undergrowth(ox, oz, size, built, out);
    this.farms(ox, oz, size, built, out, hedge);
    this.shore(ox, oz, size, out);
    this.flock(ox, oz, size, out);
  }

  /** Outcrops on steep and high ground, boulders by the rivers and a few in the meadows. */
  private rocks(
    ox: number,
    oz: number,
    size: number,
    built: readonly number[],
    out: number[],
  ): void {
    const L = this.layout;
    const f = L.field;
    const H = Config.highlands;
    const seed = L.seed + 500;
    const cell = 13;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const r = hash2(i, j, seed);
        if (r > 0.5) continue;
        const x = (i + hash2(i, j, seed + 1)) * cell;
        const z = (j + hash2(i, j, seed + 2)) * cell;
        const y = f.height(x, z);
        if (y < -0.5) continue;
        const sl = L.slope(x, z, y);
        const rocky = smoothstep(-0.1, 0.5, this.rocky(x * 0.006, z * 0.006));
        const bank = Math.abs(f.riverDist(x, z));
        const nearBank = bank > H.riverWidth * 0.8 && bank < H.riverWidth * 2.6 ? 0.35 : 0;
        const chance =
          0.012 +
          rocky * smoothstep(0.5, 2.5, sl) * 0.3 +
          smoothstep(1.2, 4, sl) * 0.3 +
          smoothstep(50, 100, y) * 0.1 +
          nearBank;
        if (r > chance || f.farm(x, z) > 0.4 || L.roadDist(x, z) < H.roadWidth + 1.5) continue;
        if (!this.clearOfBuilt(built, x, z, 4)) continue;
        const n = 1 + Math.floor(hash2(i, j, seed + 3) * (2 + rocky * 3));
        for (let k = 0; k < n; k++) {
          const a = hash2(i, j, seed + 10 + k) * Math.PI * 2;
          const d = k === 0 ? 0 : 1.5 + hash2(i, j, seed + 20 + k) * 3.5;
          const rx = x + Math.cos(a) * d;
          const rz = z + Math.sin(a) * d;
          const ry = f.height(rx, rz);
          const big =
            (k === 0 ? 1.4 : 0.7) * (0.7 + hash2(i, j, seed + 30 + k) * (1 + rocky * 1.6));
          const steep = sl > 3;
          const s = steep ? big * 1.5 : big;
          const tall = 0.8 + hash2(i, j, seed + 50 + k) * 0.5;
          const tilt = (hash2(i, j, seed + 40 + k) - 0.5) * 0.4;
          pushProp(
            out,
            steep ? P.Slab : P.Boulder,
            rx,
            ry - s * 0.25,
            rz,
            a * 3,
            tilt,
            s,
            s * tall,
            s,
            hash2(i, j, seed + 60 + k),
          );
        }
      }
  }

  /** Bushes along forest edges, in glades and a few in the open; logs on the forest floor. */
  private undergrowth(
    ox: number,
    oz: number,
    size: number,
    built: readonly number[],
    out: number[],
  ): void {
    const L = this.layout;
    const f = L.field;
    const H = Config.highlands;
    const seed = L.seed + 600;
    const cell = 9;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const r = hash2(i, j, seed);
        if (r > 0.45) continue;
        const x = (i + hash2(i, j, seed + 1)) * cell;
        const z = (j + hash2(i, j, seed + 2)) * cell;
        const fo = f.forest(x, z);
        const edge = fo > 0.08 && fo < 0.55 ? 0.42 : fo >= 0.55 ? 0.08 : 0.03;
        const log = fo > 0.5 && r < 0.05;
        if (r > edge && !log) continue;
        const y = f.height(x, z);
        if (y < 1.0 || y > 110 || L.slope(x, z, y) > 3.2) continue;
        if (f.farm(x, z) > 0.4 || L.roadDist(x, z) < H.roadWidth + 1.5) continue;
        if (!this.clearOfBuilt(built, x, z, 3)) continue;
        const s = 0.8 + hash2(i, j, seed + 3) * 0.9;
        const yaw = hash2(i, j, seed + 4) * Math.PI * 2;
        if (log) pushProp(out, P.Log, x, y, z, yaw, 0, s * 0.8, s * 0.8, s * 0.8, 0.5);
        else
          pushProp(out, P.Bush, x, y - 0.15, z, yaw, 0, s * 1.2, s, s * 1.2, hash2(i, j, seed + 5));
      }
  }

  /** Walls and fences round the farmed fields, hay on the wheat, sheep on the pasture. */
  private farms(
    ox: number,
    oz: number,
    size: number,
    built: readonly number[],
    out: number[],
    hedge: number[],
  ): void {
    const L = this.layout;
    const f = L.field;
    const H = Config.highlands;
    const seed = L.seed + 700;
    const fields = L.fieldsIn(ox, oz, size);
    const pieces = H.wallPieces;
    for (let q = 0; q < fields.length; q += 4) {
      const i = fields[q];
      const j = fields[q + 1];
      if (!L.cellFarmed(i, j)) continue;
      const kind = fieldKind(i, j);
      if (kind !== Field.Meadow) {
        // The field's own two edges (its low-u and low-w sides): every edge belongs to one field.
        const fence = hash2(i, j, seed) < 0.35;
        for (let axis = 0; axis < 2; axis++) {
          for (let k = 0; k < pieces; k++) {
            if (hash2(i * 13 + k, j * 7 + axis, seed + 1) < 0.1) continue; // a gate
            const t0 = k / pieces;
            const t1 = (k + 1) / pieces;
            fieldPoint(axis === 0 ? i + t0 : i, axis === 0 ? j : j + t0, pa);
            fieldPoint(axis === 0 ? i + t1 : i, axis === 0 ? j : j + t1, pb);
            const xm = (pa.x + pb.x) / 2;
            const zm = (pa.z + pb.z) / 2;
            const ya = f.height(pa.x, pa.z);
            const yb = f.height(pb.x, pb.z);
            const len = H.fieldCell / pieces;
            if (Math.min(ya, yb) < 0.9 || Math.abs(ya - yb) > len * 0.45) continue;
            if (L.roadDist(xm, zm) < H.roadWidth + 1) continue;
            if (!this.clearOfBuilt(built, xm, zm, 2)) continue;
            const yaw = Math.atan2(pb.x - pa.x, pb.z - pa.z) - Math.PI / 2;
            const tilt = Math.atan2(yb - ya, len);
            const ym = (ya + yb) / 2;
            const breakChance = hash2(i * 5 + k, j * 11 + axis, seed + 2);
            if (breakChance < 0.12) {
              pushProp(out, P.Bush, xm, ym - 0.2, zm, yaw, 0, 1.3, 1.1, 1.3, breakChance * 8);
              continue;
            }
            pushProp(
              out,
              fence ? P.Fence : P.Wall,
              xm,
              ym - 0.1,
              zm,
              yaw,
              tilt,
              len * 1.02,
              1,
              1,
              hash2(i, j + k, seed + 3),
            );
          }
        }
        // A hedgerow tree at some field corners.
        if (hash2(i, j, seed + 4) < 0.35) {
          fieldPoint(i, j, pt);
          const tx = pt.x + 1.5;
          const tz = pt.z + 1.5;
          const ty = f.height(tx, tz);
          if (
            ty > 1.2 &&
            L.roadDist(tx, tz) > H.roadWidth + 2 &&
            this.clearOfBuilt(built, tx, tz, 6)
          ) {
            const ts = 0.9 + hash2(i, j, seed + 5) * 0.5;
            hedge.push(
              Tree.Broadleaf,
              tx,
              ty - 0.3,
              tz,
              ts,
              hash2(i, j, seed + 6) * 6.28,
              hash2(i, j, seed + 7),
            );
          }
        }
      }
      if (kind === Field.Wheat && hash2(i, j, seed + 10) < 0.65) {
        const n = 3 + Math.floor(hash2(i, j, seed + 11) * 7);
        for (let k = 0; k < n; k++) {
          this.inside(i, j, k, seed + 12, pt);
          const y = f.height(pt.x, pt.z);
          if (y < 1) continue;
          pushProp(out, P.Hay, pt.x, y, pt.z, H.fieldAngle + (k % 2) * 0.3, 0, 1, 1, 1, 0.5);
        }
      }
      if (kind === Field.Pasture && hash2(i, j, seed + 20) < 0.6) {
        const n = 4 + Math.floor(hash2(i, j, seed + 21) * 9);
        this.inside(i, j, 99, seed + 22, pt);
        const hx = pt.x;
        const hz = pt.z;
        for (let k = 0; k < n; k++) {
          const a = hash2(i + k, j, seed + 23) * Math.PI * 2;
          const d = hash2(i, j + k, seed + 24) * 9;
          const x = hx + Math.cos(a) * d;
          const z = hz + Math.sin(a) * d;
          const y = f.height(x, z);
          if (y < 1 || !this.clearOfBuilt(built, x, z, 1)) continue;
          const sh = 0.9 + hash2(i + k, j + k, seed + 25) * 0.3;
          pushProp(
            out,
            P.Sheep,
            x,
            y,
            z,
            a + hash2(k, i, seed + 26) * 2,
            0,
            sh,
            sh,
            sh,
            0.7 + hash2(k, j, seed + 27) * 0.3,
          );
        }
      }
    }
  }

  /** A point inside field (i, j), 4 m in from its walls. */
  private inside(i: number, j: number, k: number, salt: number, out: { x: number; z: number }) {
    const inset = 4 / Config.highlands.fieldCell;
    const u = i + inset + hash2(i * 31 + k, j, salt) * (1 - 2 * inset);
    const w = j + inset + hash2(i, j * 31 + k, salt + 1) * (1 - 2 * inset);
    return fieldPoint(u, w, out);
  }

  /**
   * Reeds along the shore (only where a coarse cell straddles it, so dry or deep cells cost four
   * height samples), and boats out on the water a little way from the bank.
   */
  private shore(ox: number, oz: number, size: number, out: number[]): void {
    const f = this.layout.field;
    const seed = this.layout.seed + 800;
    const coarse = 20;
    for (let j = Math.ceil(oz / coarse); j < Math.ceil((oz + size) / coarse); j++)
      for (let i = Math.ceil(ox / coarse); i < Math.ceil((ox + size) / coarse); i++) {
        const x0 = i * coarse;
        const z0 = j * coarse;
        const h00 = f.height(x0, z0);
        const h10 = f.height(x0 + coarse, z0);
        const h01 = f.height(x0, z0 + coarse);
        const h11 = f.height(x0 + coarse, z0 + coarse);
        const lo = Math.min(h00, h10, h01, h11);
        const hi = Math.max(h00, h10, h01, h11);
        if (lo < -1.8 && hi > -0.4 && hash2(i, j, seed) < 0.12) {
          const bx = x0 + coarse * (h00 + h01 < h10 + h11 ? 0.25 : 0.75);
          const bz = z0 + coarse * (h00 + h10 < h01 + h11 ? 0.25 : 0.75);
          if (f.height(bx, bz) < -1.2)
            pushProp(
              out,
              P.Boat,
              bx,
              0.02,
              bz,
              hash2(i, j, seed + 1) * 6.28,
              0,
              1,
              1,
              1,
              hash2(i, j, seed + 2),
            );
        }
        if (lo > 1.2 || hi < -0.8) continue;
        for (let k = 0; k < 14; k++) {
          const x = x0 + hash2(i * 17 + k, j, seed + 10) * coarse;
          const z = z0 + hash2(i, j * 17 + k, seed + 11) * coarse;
          const y = f.height(x, z);
          if (y < -0.7 || y > 0.6) continue;
          const s = 0.7 + hash2(i + k, j, seed + 12) * 0.6;
          pushProp(
            out,
            P.Reeds,
            x,
            y - 0.1,
            z,
            hash2(i, j + k, seed + 13) * 6.28,
            0,
            s,
            s,
            s,
            hash2(k, i, seed + 14),
          );
        }
      }
  }

  /** A flock wheeling over some chunks (its birds circle the instance origins in the shader). */
  private flock(ox: number, oz: number, size: number, out: number[]): void {
    const f = this.layout.field;
    const seed = this.layout.seed + 900;
    const ci = Math.round(ox / size);
    const cj = Math.round(oz / size);
    if (hash2(ci, cj, seed) >= Config.highlands.flocks) return;
    const fx = ox + size * 0.5;
    const fz = oz + size * 0.5;
    const fy = Math.max(f.height(fx, fz), 0) + 38 + hash2(ci, cj, seed + 1) * 30;
    const n = 7 + Math.floor(hash2(ci, cj, seed + 2) * 7);
    for (let k = 0; k < n; k++) {
      const dx = (hash2(k, ci, seed + 3) - 0.5) * 12;
      const dy = (hash2(k, cj, seed + 4) - 0.5) * 4;
      const dz = (hash2(cj, k, seed + 5) - 0.5) * 12;
      pushProp(out, P.Flock, fx + dx, fy + dy, fz + dz, 0, 0, 0.8, 0.8, 0.8, 0.5);
    }
  }
}
