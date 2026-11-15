import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { createNoise2D, hash2, type Noise2D } from '../noise';
import type { CanyonLayout } from './CanyonLayout';
import { RANCH_FAN, RANCH_PAD, RANCH_PARTS, type Alcove, type Ranch } from './CanyonSites';

/** Kinds of Red Canyons prop (index into the decor's meshes). */
export const P = {
  Ranch: 0,
  Fan: 1,
  Dwelling: 2,
  Brow: 3,
  Boulder: 4,
  Sage: 5,
  Cow: 6,
  Horse: 7,
  Fence: 8,
  Hawk: 9,
  DustDevil: 10,
} as const;
export const PROP_KINDS = 11;

/** Floats per prop: kind, x, y, z, yaw, tilt (about local z), sx, sy, sz, tint. */
export const PROP_STRIDE = 10;

/** Tree types (Trees' type field). */
export const T = { Juniper: 0, Cottonwood: 1, Willow: 2 } as const;

function push(
  out: number[],
  kind: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  tilt: number,
  sx: number,
  sy: number,
  sz: number,
  tint: number,
): void {
  out.push(kind, x, y, z, yaw, tilt, sx, sy, sz, tint);
}

/** Fence posts stand this far beyond the road's centre line, on its outer side. */
const FENCE_OUT = 1.6;
/** Spacing (m) of the fence's posts (one wire span each, along the dominant axis). */
const FENCE_STEP = 3.6;

/**
 * Red Canyons' scenery per chunk, pure and seeded (unit-tested): the sites (a ranch and its
 * stock, a cliff dwelling and its brow) placed eagerly; trees (cottonwoods along the river,
 * coyote willow at the water's edge, juniper on the benches and plateau); and, lazily within
 * prop distance, the small things: sagebrush, boulders fallen onto the scree, the road's
 * post-and-wire fence, hawks circling, the odd dust devil. Nothing stands on the road, in the
 * river, on a ranch's pad (but its own things) or in a dwelling's shelter.
 */
export class CanyonScatter {
  private readonly nFence: Noise2D;

  constructor(private readonly L: CanyonLayout) {
    this.nFence = createNoise2D(L.seed + 660);
  }

  /** Is (x, z) kept clear: the road, a ranch's pad, a dwelling's shelter? */
  private clearOfSites(x: number, z: number, margin: number): boolean {
    const L = this.L;
    const K = Config.canyon;
    L.canyon(x, z);
    if (L.cd < L.cw + 8 && Math.abs(L.cs - K.roadOffset) < K.roadWidth + margin) return false;
    const S = L.sites;
    const r = S.ranchNear(x, z);
    if (r) {
      const dx = x - r.x;
      const dz = z - r.z;
      if (
        Math.abs(dx * r.ux + dz * r.uz) < RANCH_PAD[0] + margin &&
        Math.abs(dx * r.vx + dz * r.vz) < RANCH_PAD[1] + margin
      )
        return false;
    }
    const a = S.alcoveNear(x, z);
    if (a && Math.hypot(x - a.x, z - a.z) < a.w + margin + 4) return false;
    return true;
  }

  /** The sites whose centre lies in the chunk: ranches and dwellings (with their brows). */
  sites(ox: number, oz: number, size: number, out: number[]): void {
    const S = this.L.sites;
    const K = Config.canyon;
    const inChunk = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const ranch = (r: Ranch | null) => {
      if (r && inChunk(r.x, r.z)) this.ranch(r, out);
    };
    const alcove = (a: Alcove | null) => {
      if (a && inChunk(a.x, a.z)) this.alcove(a, out);
    };
    ranch(S.homeRanch);
    alcove(S.homeAlcove);
    const RC = K.ranchCell;
    for (let j = Math.floor(oz / RC); j <= Math.floor((oz + size) / RC); j++)
      for (let i = Math.floor(ox / RC); i <= Math.floor((ox + size) / RC); i++)
        ranch(S.ranch(i, j));
    const AC = K.alcoveCell;
    for (let j = Math.floor(oz / AC); j <= Math.floor((oz + size) / AC); j++)
      for (let i = Math.floor(ox / AC); i <= Math.floor((ox + size) / AC); i++)
        alcove(S.alcove(i, j));
  }

  /** A ranch: its buildings, the windmill's fan, horses in the corral, cattle on the floor. */
  private ranch(r: Ranch, out: number[]): void {
    const L = this.L;
    const yaw = Math.atan2(r.vx, r.vz);
    push(out, P.Ranch, r.x, r.y - 0.15, r.z, yaw, 0, 1, 1, 1, r.seed);
    const at = (u: number, v: number) => [r.x + r.ux * u + r.vx * v, r.z + r.uz * u + r.vz * v];
    const [fx, fz] = at(RANCH_FAN[0], RANCH_FAN[2]);
    push(out, P.Fan, fx, r.y + RANCH_FAN[1], fz, yaw, 0, 1, 1, 1, 0.5);
    // Horses in the corral.
    const corral = RANCH_PARTS[3];
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + r.seed * 7;
      const [hx, hz] = at(corral[0] + Math.cos(a) * 4.5, corral[1] + Math.sin(a) * 4.5);
      const tint = hash2(k, Math.round(r.x), 31);
      push(out, P.Horse, hx, r.y - 0.05, hz, a * 1.7, 0, 1, 1, 1, tint);
    }
    // Cattle grazing out on the floor round the ranch, off the road and out of the river.
    const n = Config.canyon.cattle;
    let placed = 0;
    for (let k = 0; k < 40 && placed < n; k++) {
      const a = hash2(k, Math.round(r.z), 41) * Math.PI * 2;
      const d = 34 + hash2(k, Math.round(r.x), 42) * 60;
      const x = r.x + Math.sin(a) * d;
      const z = r.z + Math.cos(a) * d;
      if (!this.clearOfSites(x, z, 2)) continue;
      const y = L.height(x, z);
      if (y < 1 || L.canyon(x, z) > -8) continue;
      push(out, P.Cow, x, y - 0.05, z, hash2(k, 7, 43) * 6.28, 0, 1, 1, 1, hash2(k, 9, 44));
      placed++;
    }
  }

  /** A cliff dwelling: its rooms on the bench and the brow of rock over them. */
  private alcove(a: Alcove, out: number[]): void {
    const yaw = Math.atan2(a.nx, a.nz);
    const bx = a.x - a.nx * a.back;
    const bz = a.z - a.nz * a.back;
    push(out, P.Brow, bx, a.y0 + a.h, bz, yaw, 0, a.w, a.reach, a.reach, a.seed);
    push(out, P.Dwelling, a.x, a.y0, a.z, yaw, 0, a.w / 20.6, 1, 1, a.seed);
  }

  /** Trees per chunk (Trees records): cottonwood and willow by the river, juniper up high. */
  trees(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 9;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const y = L.height(x, z);
        if (y < 0.4) continue;
        const d = L.cd;
        const rw = L.river(x, z);
        const steep = Math.abs(L.height(x + 2, z) - y) + Math.abs(L.height(x, z + 2) - y);
        if (steep > 3) continue;
        const h = hash2(i, j, seed);
        let type = -1;
        let s = 1;
        if (y < 3 && d < rw + 6 && h < 0.45) {
          // Coyote willow in thickets right at the water's edge.
          type = T.Willow;
          s = 0.8 + 0.5 * hash2(i, j, seed + 14);
        } else if (y < 3 && d < rw + 22 && h < 0.6 * (1 - smoothstep(rw + 10, rw + 22, d))) {
          // Cottonwoods in a green band along the river's banks.
          type = T.Cottonwood;
          s = 0.8 + 0.5 * hash2(i, j, seed + 14);
        } else if (y > 12) {
          const scrub = L.scrub(x, z);
          if (h < scrub * (y > 20 ? 0.13 : 0.05)) {
            type = T.Juniper;
            s = 0.7 + 0.6 * hash2(i, j, seed + 14);
          }
        }
        if (type < 0 || !this.clearOfSites(x, z, 3)) continue;
        out.push(
          type,
          x,
          y - 0.3,
          z,
          s,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
    // A cottonwood shading each ranch's house.
    const S = L.sites;
    const C = Config.canyon.ranchCell;
    const cells = [S.homeRanch];
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++)
        cells.push(S.ranch(i, j));
    for (const r of cells) {
      if (!r || r.x < ox || r.x >= ox + size || r.z < oz || r.z >= oz + size) continue;
      for (const [u, v] of [
        [-25, -2],
        [-12, 10],
      ]) {
        const x = r.x + r.ux * u + r.vx * v;
        const z = r.z + r.uz * u + r.vz * v;
        out.push(T.Cottonwood, x, L.height(x, z) - 0.3, z, 1.1, u, 0.6);
      }
    }
  }

  /** The small scenery of a chunk (PROP_STRIDE records), scattered lazily within prop range. */
  props(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const K = Config.canyon;
    const seed = L.seed;
    const pre = (K.talusRun * K.wall) / K.bands;
    // Sagebrush on the dry floors, benches and plateau; boulders fallen onto the scree.
    const cell = 7;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 21)) * cell;
        const z = (j + hash2(i, j, seed + 22)) * cell;
        const y = L.height(x, z);
        if (y < 2) continue;
        const bank = L.canyon(x, z);
        const gx = L.height(x + 1.5, z) - y;
        const gz = L.height(x, z + 1.5) - y;
        const slope = Math.hypot(gx, gz) / 1.5;
        const h = hash2(i, j, seed + 23);
        if (bank > -pre && slope > 0.3 && slope < 1.1) {
          // Scree: boulders of every size tumbled down from the cliffs.
          if (h < 0.2 && this.clearOfSites(x, z, 2)) {
            const s = 0.8 + 2.6 * hash2(i, j, seed + 24) ** 2;
            const tilt = Math.atan(slope) * 0.6;
            push(out, P.Boulder, x, y - 0.35 * s, z, Math.atan2(gx, gz), tilt, s * 1.3, s, s, h);
          }
          continue;
        }
        if (slope > 0.35) continue;
        const scrub = L.scrub(x, z);
        if (h < scrub * 0.3 && L.cd > L.river(x, z) + 14 && this.clearOfSites(x, z, 1.5)) {
          const s = 0.7 + 0.8 * hash2(i, j, seed + 25);
          push(out, P.Sage, x, y - 0.15, z, h * 40, 0, s, s * 0.9, s, hash2(i, j, seed + 26));
        } else if (h > 0.996 && bank < -6 && this.clearOfSites(x, z, 2)) {
          // Now and then a boulder out on the floor, rolled far from the wall.
          const s = 1.2 + 1.5 * hash2(i, j, seed + 24);
          push(out, P.Boulder, x, y - 0.3 * s, z, h * 50, 0, s * 1.2, s, s, h);
        }
      }
    this.fence(ox, oz, size, out);
    // Hawks circling over the chunk, or a pair of ravens; the odd dust devil on open ground.
    const ci = Math.round(ox / size);
    const cj = Math.round(oz / size);
    if (hash2(ci, cj, seed + 31) < K.hawks) {
      const x = ox + size * (0.25 + 0.5 * hash2(ci, cj, seed + 32));
      const z = oz + size * (0.25 + 0.5 * hash2(ci, cj, seed + 33));
      const y = L.height(x, z) + 55 + 70 * hash2(ci, cj, seed + 34);
      const ravens = hash2(ci, cj, seed + 35) < 0.4;
      push(
        out,
        P.Hawk,
        x,
        y,
        z,
        0,
        0,
        ravens ? 0.8 : 1,
        ravens ? 0.8 : 1,
        ravens ? 0.8 : 1,
        ravens ? 0 : 1,
      );
      // A raven's mate flies the same circle a little behind (another phase, same radius).
      if (ravens) push(out, P.Hawk, x + 0.37, y + 2, z, 0, 0, 0.8, 0.8, 0.8, 0);
    }
    if (hash2(ci, cj, seed + 36) < K.dustDevils) {
      const x = ox + size * (0.2 + 0.6 * hash2(ci, cj, seed + 37));
      const z = oz + size * (0.2 + 0.6 * hash2(ci, cj, seed + 38));
      const bank = L.canyon(x, z);
      const open = (bank < -10 && L.cd > L.river(x, z) + 12) || bank > K.wall + 40;
      if (open) {
        const s = 0.7 + 0.6 * hash2(ci, cj, seed + 39);
        push(out, P.DustDevil, x, L.height(x, z) - 0.5, z, 0, 0, 9 * s, 38 * s, 9 * s, 0.5);
      }
    }
  }

  /**
   * Post-and-wire fence beside the road, in stretches (and always near a ranch). Posts stand
   * on the fence line at every FENCE_STEP along whichever axis the road runs closer to, each
   * with a wire span to where the next will stand.
   */
  private fence(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const K = Config.canyon;
    const line = K.roadOffset + K.roadWidth + FENCE_OUT;
    // f(x, z): signed distance past the fence line, on the floor (NaN off it).
    const f = (x: number, z: number) => {
      const bank = L.canyon(x, z);
      return bank < -4 ? L.cs - line : NaN;
    };
    for (const alongX of [true, false]) {
      // Columns of x (searching along z for the line), or rows of z (searching along x).
      const a0s = alongX ? ox : oz;
      const b0s = alongX ? oz : ox;
      for (let a = Math.ceil(a0s / FENCE_STEP) * FENCE_STEP; a < a0s + size; a += FENCE_STEP)
        for (let b0 = b0s; b0 < b0s + size; b0 += 8) {
          const px = (b: number) => (alongX ? a : b);
          const pz = (b: number) => (alongX ? b : a);
          const a0 = f(px(b0), pz(b0));
          const a1 = f(px(b0 + 8), pz(b0 + 8));
          if (!(a0 * a1 <= 0)) continue;
          // Bisect onto the line.
          let lo = b0;
          let hi = b0 + 8;
          for (let it = 0; it < 10; it++) {
            const mid = (lo + hi) / 2;
            if (f(px(lo), pz(lo)) * f(px(mid), pz(mid)) <= 0) hi = mid;
            else lo = mid;
          }
          const x = alongX ? a : (lo + hi) / 2;
          const z = alongX ? (lo + hi) / 2 : a;
          // Which axis the line runs closer to: the gradient's minor axis.
          L.canyon(x, z);
          const dominantX = Math.abs(L.cgz) > Math.abs(L.cgx);
          if (dominantX !== alongX) continue;
          const r = L.sites.ranchNear(x, z);
          const near = r !== null && Math.hypot(x - r.x, z - r.z) < 70;
          if (!near && this.nFence(x * 0.004, z * 0.004) < 1 - K.fences * 2) continue;
          if (r && !this.clearOfSites(x, z, 1) && !near) continue;
          // The span runs along the line to the next column's post.
          const g = Math.hypot(L.cgx, L.cgz);
          let tx = -L.cgz / g;
          let tz = L.cgx / g;
          if ((alongX ? tx : tz) < 0) {
            tx = -tx;
            tz = -tz;
          }
          const len = FENCE_STEP / Math.max(Math.abs(alongX ? tx : tz), 0.5);
          const y = L.height(x, z);
          // A turn about y by atan2(-tz, tx) carries the span's local +x onto (tx, tz).
          push(out, P.Fence, x, y - 0.1, z, Math.atan2(-tz, tx), 0, len / 3.6, 1, 1, 0.5);
        }
    }
  }
}
