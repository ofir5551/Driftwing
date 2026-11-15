import { Config } from '../../core/Config';
import { angleDelta, smoothstep } from '../../core/math';
import { hash2 } from '../noise';
import type { CanyonLayout } from './CanyonLayout';

/**
 * Red Canyons' inhabited places, pure and seeded: ranches on the wide stretches of canyon floor
 * (beyond the road, away from the river) and cliff dwellings tucked under a brow of rock at the
 * foot of a cliff. Each is placed in its own grid cell, well inside it, so a query only ever
 * looks in the cell it is in; the first of each is placed along the canyon ahead of the spawn.
 */

/**
 * A ranch: barn, house, a windmill pumping into a stock tank, and a corral, laid out in the
 * site's frame (u along the canyon, v across it, away from the river) on a levelled pad.
 */
export interface Ranch {
  x: number;
  z: number;
  /** The pad's level (m). */
  y: number;
  /** Unit vectors of the site's frame: u along the canyon, v away from the river. */
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  seed: number;
}

/**
 * The ranch's parts in its frame: u, v (m), footprint radius and roof height over the pad
 * (m), for the flight floor. The decor's merged ranch shape is built to the same table.
 */
export const RANCH_PARTS: readonly (readonly [number, number, number, number])[] = [
  [0, 6, 7.5, 8.2], // barn
  [-18, 3, 5, 5.6], // house
  [10, -1, 3.5, 11.5], // windmill (tower and wheel)
  [20, 6, 10, 1.8], // corral
];
/** Windmill's wheel hub in the ranch frame: u, height, v (the fan spins round the hub). */
export const RANCH_FAN = [10, 10.2, -1] as const;
/** Half size of the levelled pad along u and v (m), and how far the levelling eases out. */
export const RANCH_PAD = [32, 15, 10] as const;
/** A ranch's centre stands this far from the canyon's centre line (the road runs by its yard). */
export const RANCH_OFFSET = 10;
/** Metres round a ranch building over which the flight floor eases back down to the ground. */
const LIFT_EASE = 8;

/**
 * A cliff dwelling: stone rooms on a bench at the foot of a cliff, under a brow of rock that
 * juts out over them. (x, z) is the cliff's foot (the shelter's mouth), n points out of the
 * cliff toward the canyon, y0 is the bench level. The brow's back sits on the cliff where it
 * reaches y0 + h, `back` metres in from the foot; it juts out `reach` metres from there.
 */
export interface Alcove {
  x: number;
  z: number;
  nx: number;
  nz: number;
  y0: number;
  /** Half width along the cliff (m). */
  w: number;
  /** Height of the brow's lip over the bench (m). */
  h: number;
  back: number;
  reach: number;
  seed: number;
}

/** Height of the brow's dome over its lip as a share of its reach. */
export const BROW_RISE = 0.85;

/** Keep a site's centre this far inside its cell, so a query only checks its own cell. */
const RANCH_MARGIN = 80;
const ALCOVE_MARGIN = 60;

export class CanyonSites {
  readonly homeRanch: Ranch | null;
  readonly homeAlcove: Alcove | null;
  private readonly ranches = new Map<number, Ranch | null>();
  private readonly alcoves = new Map<number, Alcove | null>();
  private readonly c = { x: 0, z: 0 };

  constructor(private readonly L: CanyonLayout) {
    this.homeRanch = this.placeHomeRanch();
    this.homeAlcove = this.placeHomeAlcove();
  }

  // --- Queries ---------------------------------------------------------------------------------

  /** The ranch whose pad may reach (x, z), or null. */
  ranchNear(x: number, z: number): Ranch | null {
    const H = this.homeRanch;
    if (H && Math.abs(x - H.x) < 60 && Math.abs(z - H.z) < 60) return H;
    const C = Config.canyon.ranchCell;
    const r = this.ranch(Math.floor(x / C), Math.floor(z / C));
    return r && Math.abs(x - r.x) < 60 && Math.abs(z - r.z) < 60 ? r : null;
  }

  /** The cliff dwelling whose shelter may reach (x, z), or null. */
  alcoveNear(x: number, z: number): Alcove | null {
    const H = this.homeAlcove;
    if (H && Math.abs(x - H.x) < 50 && Math.abs(z - H.z) < 50) return H;
    const C = Config.canyon.alcoveCell;
    const a = this.alcove(Math.floor(x / C), Math.floor(z / C));
    return a && Math.abs(x - a.x) < 50 && Math.abs(z - a.z) < 50 ? a : null;
  }

  /** The ranch in grid cell (i, j), if any. Cached; pure per seed. */
  ranch(i: number, j: number): Ranch | null {
    const k = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let r = this.ranches.get(k);
    if (r === undefined) {
      if (this.ranches.size > 4000) this.ranches.clear();
      // None while it is placed: placing reads heights, which ask for the ranch here.
      this.ranches.set(k, null);
      r = this.L.preserving(() => this.makeRanch(i, j));
      this.ranches.set(k, r);
    }
    return r;
  }

  /** The cliff dwelling in grid cell (i, j), if any. Cached; pure per seed. */
  alcove(i: number, j: number): Alcove | null {
    const k = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let a = this.alcoves.get(k);
    if (a === undefined) {
      if (this.alcoves.size > 4000) this.alcoves.clear();
      this.alcoves.set(k, null);
      a = this.L.preserving(() => this.makeAlcove(i, j));
      this.alcoves.set(k, a);
    }
    return a;
  }

  /** The ground levelled for a ranch's pad and cut back at a dwelling's foot. */
  shape(x: number, z: number, y: number): number {
    const r = this.ranchNear(x, z);
    if (r) {
      const dx = x - r.x;
      const dz = z - r.z;
      const u = Math.abs(dx * r.ux + dz * r.uz);
      const v = Math.abs(dx * r.vx + dz * r.vz);
      const e = RANCH_PAD[2];
      const m =
        smoothstep(RANCH_PAD[0] + e, RANCH_PAD[0], u) *
        smoothstep(RANCH_PAD[1] + e, RANCH_PAD[1], v);
      if (m > 0) y += (r.y - y) * m;
    }
    const a = this.alcoveNear(x, z);
    if (a) {
      const dx = x - a.x;
      const dz = z - a.z;
      const along = Math.abs(dx * a.nz - dz * a.nx);
      const m = smoothstep(a.w * 1.05, a.w * 0.8, along);
      if (m > 0) {
        // The bench in front of the cliff levelled (no scree under the rooms), the cliff rising
        // straight from it: inward distance d > 0 is into the cliff.
        const d = -(dx * a.nx + dz * a.nz);
        if (d > -14) {
          const cut = a.y0 + Math.max(0, d - 0.5) * 5;
          if (cut < y) y += (cut - y) * m;
        }
      }
    }
    return y;
  }

  /** 0..1 shade on the ground (height y) under a dwelling's brow: the hollow behind its rooms. */
  shade(x: number, z: number, y: number): number {
    const a = this.alcoveNear(x, z);
    if (!a) return 0;
    const dx = x - a.x;
    const dz = z - a.z;
    const along = Math.abs(dx * a.nz - dz * a.nx) / a.w;
    const out = dx * a.nx + dz * a.nz; // outward from the foot
    const lip = a.reach - a.back; // the brow's lip juts this far out past the foot
    return (
      smoothstep(1, 0.75, along) *
      smoothstep(lip + 1, lip - 2, out) *
      smoothstep(a.y0 + a.h + 2, a.y0 + a.h * 0.7, y) *
      smoothstep(a.y0 - 3, a.y0 - 0.5, y)
    );
  }

  /**
   * The flight floor over a ranch's buildings and a dwelling's brow: `ground` lifted to clear
   * the roofs (easing back down over LIFT_EASE metres round each) and to the brow's top.
   */
  lift(x: number, z: number, ground: number): number {
    let top = ground;
    const r = this.ranchNear(x, z);
    if (r) {
      const dx = x - r.x;
      const dz = z - r.z;
      const u = dx * r.ux + dz * r.uz;
      const v = dx * r.vx + dz * r.vz;
      for (const [pu, pv, rad, roof] of RANCH_PARTS) {
        const d = Math.hypot(u - pu, v - pv);
        if (d < rad + LIFT_EASE)
          top = Math.max(top, ground + (r.y + roof - ground) * smoothstep(rad + LIFT_EASE, rad, d));
      }
    }
    const a = this.alcoveNear(x, z);
    if (a) top = Math.max(top, browTop(a, x, z));
    return top;
  }

  // --- Placement -------------------------------------------------------------------------------

  /** Walk down the canyon from the spawn, calling `ok` every 10 m from `from` to `to` metres. */
  private walk<T>(from: number, to: number, ok: (x: number, z: number, h: number) => T | null) {
    const L = this.L;
    const S = L.spawn;
    let x = S.x;
    let z = S.z;
    let h = S.yaw;
    for (let d = 0; d < to; d += 10) {
      h = L.heading(x, z, h);
      x += Math.sin(h) * 10;
      z += Math.cos(h) * 10;
      L.toCentre(x, z, this.c);
      x = this.c.x;
      z = this.c.z;
      if (d < from) continue;
      const got = ok(x, z, h);
      if (got) return got;
    }
    return null;
  }

  /** Snap (x, z) onto its canyon's centre line; null if the snap wandered off the floor. */
  private snap(x: number, z: number): { x: number; z: number } | null {
    const L = this.L;
    for (let k = 0; k < 6; k++) {
      L.toCentre(x, z, this.c);
      x = this.c.x;
      z = this.c.z;
    }
    if (L.canyon(x, z) > -L.cw * 0.8) return null;
    return { x, z };
  }

  /** Straight for `len` metres either way along the canyon from (x, z), heading `yaw`. */
  private straight(x: number, z: number, yaw: number, len: number): boolean {
    for (const d of [-len, len]) {
      const h = this.L.heading(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d, yaw);
      if (Math.abs(angleDelta(yaw, h)) > 0.3) return false;
    }
    return true;
  }

  /**
   * A ranch beside the centre-line point (x, z), beyond the river's trees, on the road's side
   * if the floor is wide enough there (and either way along it), else on the other side; clear
   * of the arches.
   */
  private ranchAt(x: number, z: number, yaw: number, seed: number): Ranch | null {
    const L = this.L;
    const K = Config.canyon;
    if (!this.straight(x, z, yaw, 40)) return null;
    // The road's side is toward increasing canyon noise (its gradient).
    L.canyon(x, z);
    const g = Math.hypot(L.cgx, L.cgz);
    const gx = L.cgx / g;
    const gz = L.cgz / g;
    const ux = Math.sin(yaw);
    const uz = Math.cos(yaw);
    const G = L.great;
    for (const side of [1, -1]) {
      const vx = gx * side;
      const vz = gz * side;
      const off = K.roadOffset + RANCH_OFFSET;
      const cx = x + vx * off;
      const cz = z + vz * off;
      // The pad (and a margin) on the floor, short of the wall's scree.
      let fits = true;
      for (const su of [-1, 0, 1])
        for (const sv of [-1, 1]) {
          const px = cx + ux * su * RANCH_PAD[0] + vx * sv * RANCH_PAD[1];
          const pz = cz + uz * su * RANCH_PAD[0] + vz * sv * RANCH_PAD[1];
          if (L.canyon(px, pz) > -6) fits = false;
        }
      if (!fits) continue;
      if (Math.hypot(cx - G.x, cz - G.z) < G.r * 1.3 + 70) return null;
      for (const a of L.nearArches(cx, cz))
        if (Math.hypot(cx - a.x, cz - a.z) < a.r * 1.3 + 60) return null;
      // u = v turned a quarter right (x = v.z, z = -v.x): the frame of a turn about y by
      // atan2(vx, vz), so the decor places the ranch with a plain yaw. It runs along the canyon.
      return { x: cx, z: cz, y: L.terrain(cx, cz), ux: vz, uz: -vx, vx, vz, seed };
    }
    return null;
  }

  private placeHomeRanch(): Ranch | null {
    const K = Config.canyon;
    return this.L.preserving(() =>
      this.walk(K.ranchAhead, K.ranchAhead + 1500, (x, z, h) => this.ranchAt(x, z, h, 0.5)),
    );
  }

  private makeRanch(i: number, j: number): Ranch | null {
    const K = Config.canyon;
    const C = K.ranchCell;
    const s = this.L.seed;
    if (hash2(i, j, s + 641) > K.ranchChance) return null;
    const p = this.snap(
      (i + 0.25 + 0.5 * hash2(i, j, s + 642)) * C,
      (j + 0.25 + 0.5 * hash2(i, j, s + 643)) * C,
    );
    if (!p) return null;
    const yaw = this.L.heading(p.x, p.z, hash2(i, j, s + 644) * Math.PI * 2);
    const r = this.ranchAt(p.x, p.z, yaw, hash2(i, j, s + 645));
    if (!r) return null;
    const m = RANCH_MARGIN;
    if (r.x < i * C + m || r.x > (i + 1) * C - m || r.z < j * C + m || r.z > (j + 1) * C - m)
      return null;
    const H = this.homeRanch;
    if (H && Math.hypot(r.x - H.x, r.z - H.z) < 400) return null;
    return r;
  }

  /**
   * A cliff dwelling on the wall beside the centre-line point (x, z), on side `side` (+1 the
   * right-hand wall looking along `yaw`), at the
   * foot of the second cliff (its rooms on the first bench), if that cliff stands straight.
   */
  private alcoveAt(x: number, z: number, yaw: number, side: number, seed: number): Alcove | null {
    const L = this.L;
    const K = Config.canyon;
    if (!this.straight(x, z, yaw, 50)) return null;
    // Out of the cliff, toward the centre line. The bird's right is (-cos yaw, sin yaw), and
    // side +1 is the right-hand wall, so n is minus that.
    const nx = Math.cos(yaw) * side;
    const nz = -Math.sin(yaw) * side;
    // Find the second cliff's foot by bisection on the wall's band coordinate along the ray.
    const k = 1 / K.bands;
    let lo = 0;
    let hi = L.cw + K.wall;
    if (L.wallT(x - nx * hi, z - nz * hi) < k) return null;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2;
      if (L.wallT(x - nx * mid, z - nz * mid) < k) lo = mid;
      else hi = mid;
    }
    const fx = x - nx * lo;
    const fz = z - nz * lo;
    const w = 17 + 6 * seed;
    // The foot must run straight along the cliff: the band coordinate the same either side.
    for (const sa of [-1, 1]) {
      const t = L.wallT(fx + nz * w * sa, fz - nx * w * sa);
      if (Math.abs(t - k) > 0.03) return null;
    }
    const y0 = L.terrain(fx + nx * 5, fz + nz * 5);
    const h = 10 + 3 * seed;
    // Where the raw cliff reaches the brow's lip height: the brow's back.
    let a = 0;
    let b = 30;
    for (let it = 0; it < 18; it++) {
      const mid = (a + b) / 2;
      if (L.terrain(fx - nx * mid, fz - nz * mid) < y0 + h) a = mid;
      else b = mid;
    }
    if (a > 20) return null;
    // Clear of an arch's legs (it stands on the floor, the dwelling up on the wall).
    for (const ar of L.nearArches(fx, fz))
      if (Math.hypot(fx - ar.x, fz - ar.z) < ar.r * 1.3 + 30) return null;
    return { x: fx, z: fz, nx, nz, y0, w, h, back: a, reach: a + 6, seed };
  }

  private placeHomeAlcove(): Alcove | null {
    const K = Config.canyon;
    const H = this.homeRanch;
    const S = this.L.spawn;
    // On a wall facing back up the canyon toward the spawn, so it is seen on the way in (past
    // the Great Arch, the bend's outer wall frames it in the opening).
    return this.L.preserving(() =>
      this.walk(K.alcoveAhead, K.alcoveAhead + 900, (x, z, h) => {
        for (const side of [1, -1]) {
          const a = this.alcoveAt(x, z, h, side, 0.6);
          if (!a || (H && Math.hypot(a.x - H.x, a.z - H.z) < 70)) continue;
          const tx = S.x - a.x;
          const tz = S.z - a.z;
          if ((a.nx * tx + a.nz * tz) / Math.hypot(tx, tz) > 0.35) return a;
        }
        return null;
      }),
    );
  }

  private makeAlcove(i: number, j: number): Alcove | null {
    const K = Config.canyon;
    const C = K.alcoveCell;
    const s = this.L.seed;
    if (hash2(i, j, s + 651) > K.alcoveChance) return null;
    const p = this.snap(
      (i + 0.25 + 0.5 * hash2(i, j, s + 652)) * C,
      (j + 0.25 + 0.5 * hash2(i, j, s + 653)) * C,
    );
    if (!p) return null;
    const yaw = this.L.heading(p.x, p.z, hash2(i, j, s + 654) * Math.PI * 2);
    const side = hash2(i, j, s + 655) < 0.5 ? 1 : -1;
    const a = this.alcoveAt(p.x, p.z, yaw, side, hash2(i, j, s + 656));
    if (!a) return null;
    const m = ALCOVE_MARGIN;
    if (a.x < i * C + m || a.x > (i + 1) * C - m || a.z < j * C + m || a.z > (j + 1) * C - m)
      return null;
    const H = this.homeAlcove;
    if (H && Math.hypot(a.x - H.x, a.z - H.z) < 300) return null;
    const R = this.ranchNear(a.x, a.z);
    if (R && Math.hypot(a.x - R.x, a.z - R.z) < 70) return null;
    return a;
  }
}

/**
 * Top of a dwelling's brow over (x, z), or -Infinity off it. The brow is a half dome: `w` along
 * the cliff, jutting `reach` out from its back (on the cliff at the lip's height), rising
 * BROW_RISE x reach over the lip, and running a little way back into the rock.
 */
export function browTop(a: Alcove, x: number, z: number): number {
  const dx = x - a.x;
  const dz = z - a.z;
  const along = dx * a.nz - dz * a.nx;
  const out = dx * a.nx + dz * a.nz + a.back; // from the brow's back, outward
  const q = (along / a.w) ** 2 + (Math.max(out, 0) / a.reach) ** 2;
  if (q >= 1 || out < -a.reach * 0.5) return -Infinity;
  return a.y0 + a.h + a.reach * BROW_RISE * Math.sqrt(1 - q);
}
