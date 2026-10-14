import { Config } from '../../core/Config';
import { lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, type Noise2D } from '../noise';

/**
 * Jade River's plan as one pure, seeded function of position (no Three.js, unit-tested): a
 * valley floor of paddies and groves, rivers along the zero contours of a low-frequency noise,
 * and limestone pillars scattered on a jittered grid that keeps clear of the water. The
 * renderer, collisions and wisp planner all read it, so they agree on where the rock is.
 */

/** A pillar silhouette, in base radii: radius profile, summit dome, lean. */
export interface PillarShape {
  /** Height over base radius before the per-pillar stretch. */
  aspect: number;
  /** Belly: extra radius halfway up the body. */
  bulge: number;
  /** How much the body narrows toward the top. */
  neck: number;
  /** Fraction of the height where the rounded summit dome starts. */
  cap: number;
  /** Top offset as a fraction of the height (karst towers rarely stand straight). */
  lean: number;
}

export const SHAPES: PillarShape[] = [
  { aspect: 3.6, bulge: 0.12, neck: 0.3, cap: 0.74, lean: 0.03 }, // sugarloaf
  { aspect: 2.1, bulge: 0.2, neck: 0.2, cap: 0.55, lean: 0 }, // dome
  { aspect: 5.0, bulge: 0.06, neck: 0.42, cap: 0.84, lean: 0.07 }, // needle
  { aspect: 3.2, bulge: 0.16, neck: 0.25, cap: 0.7, lean: 0.14 }, // leaning
  { aspect: 2.8, bulge: 0.3, neck: 0.45, cap: 0.66, lean: 0.05 }, // pot-bellied
];

/**
 * Radius at fraction t of the height, in base radii. The mesh is lathed from this and the
 * collisions test against it, so the bird meets the rock where it is drawn.
 */
export function profile(sh: PillarShape, t: number): number {
  if (t >= 1) return 0;
  const foot = t < 0.08 ? 1 + 0.15 * (1 - t / 0.08) : 1; // a flared, scree-buried foot
  let r = foot * (1 + sh.bulge * Math.sin(Math.PI * Math.min(t / sh.cap, 1))) * (1 - sh.neck * t);
  if (t > sh.cap) {
    const q = (t - sh.cap) / (1 - sh.cap);
    r *= Math.sqrt(1 - q * q);
  }
  return r;
}

export interface Pillar {
  x: number;
  z: number;
  /** Base, a little below the ground so the foot never floats. */
  y0: number;
  /** Base radius. */
  r: number;
  /** Height of the rock from y0. */
  h: number;
  shape: number;
  yaw: number;
  /** Vertical stretch of the unit mesh (h = r * aspect * k). */
  k: number;
  /** World offset of the summit from the base axis (the lean), metres. */
  lx: number;
  lz: number;
  /** Highest point anything solid reaches (summit trees, a pavilion). */
  top: number;
  /** Horizontal reach from (x, z) of any part of the rock. */
  reach: number;
  pavilion: boolean;
  /** Per-pillar random in [0, 1) for decor. */
  seed: number;
}

const CELL_CACHE = 6000;

export class KarstLayout {
  readonly seed: number;
  readonly spawn = { x: 0, y: 24, z: 0, yaw: 0 };
  /** The last pillar a solid query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);
  /** Scratch results of `river()`: noise value, its gradient (per metre), distance, half width. */
  rv = 0;
  rgx = 0;
  rgz = 0;
  rd = 0;
  rw = 0;
  /** Scratch result of `axisAt()`: the rock's centre at that height. */
  ax = 0;
  az = 0;
  private readonly nRiver: Noise2D;
  private readonly nWidth: Noise2D;
  private readonly nHills: Noise2D;
  private readonly nLand: Noise2D;
  private readonly nDense: Noise2D;
  private readonly nGrove: Noise2D;
  private readonly nVillage: Noise2D;
  private readonly nPaddy: Noise2D;
  private readonly cells = new Map<number, Pillar[]>();

  constructor(seed: number) {
    this.seed = seed;
    this.nRiver = createNoise2D(seed + 301);
    this.nWidth = createNoise2D(seed + 302);
    this.nHills = createNoise2D(seed + 303);
    this.nLand = createNoise2D(seed + 304);
    this.nDense = createNoise2D(seed + 305);
    this.nGrove = createNoise2D(seed + 306);
    this.nVillage = createNoise2D(seed + 307);
    this.nPaddy = createNoise2D(seed + 308);
    this.findSpawn();
  }

  // --- Rivers ----------------------------------------------------------------------------------

  private riverNoise(x: number, z: number): number {
    const f = Config.karst.riverScale;
    return fbm(this.nRiver, x * f, z * f, 2);
  }

  /**
   * Signed distance (m) from (x, z) to the nearest river bank: negative in the water. Rivers run
   * along the zero contour of a noise; distance to it is |n| / |grad n| (first order), so they
   * meander endlessly in every direction. Leaves the noise, gradient, centre-line distance and
   * half width in rv, rgx/rgz, rd and rw.
   */
  river(x: number, z: number): number {
    const e = 4;
    const v = this.riverNoise(x, z);
    const gx = (this.riverNoise(x + e, z) - v) / e;
    const gz = (this.riverNoise(x, z + e) - v) / e;
    const g = Math.max(Math.hypot(gx, gz), 1e-6);
    this.rv = v;
    this.rgx = gx;
    this.rgz = gz;
    this.rd = Math.abs(v) / g;
    const K = Config.karst;
    this.rw =
      K.riverMin + (K.riverMax - K.riverMin) * (0.5 + 0.5 * this.nWidth(x * 7e-4, z * 7e-4));
    return this.rd - this.rw;
  }

  /** Downstream-ish direction of the river at (x, z), the one closer to `yaw`. Uses river() scratch. */
  riverHeading(x: number, z: number, yaw: number): number {
    this.river(x, z);
    // Along the contour: perpendicular to the gradient.
    const a = Math.atan2(-this.rgz, this.rgx);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    return Math.sin(a) * fx + Math.cos(a) * fz >= 0 ? a : a + Math.PI;
  }

  /** One Newton step from (x, z) toward the river's centre line; writes into `out`. */
  toCentre(x: number, z: number, out: { x: number; z: number }): void {
    this.river(x, z);
    const g2 = Math.max(this.rgx * this.rgx + this.rgz * this.rgz, 1e-12);
    out.x = x - (this.rv * this.rgx) / g2;
    out.z = z - (this.rv * this.rgz) / g2;
  }

  /** Spawn on the river nearest the origin, facing along it, with open water ahead. */
  private findSpawn(): void {
    const c = { x: 0, z: 0 };
    let bx = 0;
    let bz = 0;
    let best = Infinity;
    for (let r = 0; r < 3000 && best === Infinity; r += 40)
      for (let a = 0; a < 16; a++) {
        let x = Math.sin((a / 16) * Math.PI * 2) * r;
        let z = Math.cos((a / 16) * Math.PI * 2) * r;
        for (let i = 0; i < 6; i++) {
          this.toCentre(x, z, c);
          x = c.x;
          z = c.z;
        }
        if (this.river(x, z) < -this.rw * 0.8 && Math.hypot(x, z) < best) {
          best = Math.hypot(x, z);
          bx = x;
          bz = z;
        }
      }
    this.spawn.x = bx;
    this.spawn.z = bz;
    this.spawn.yaw = this.riverHeading(bx, bz, 0);
  }

  // --- Ground ----------------------------------------------------------------------------------

  /** Valley floor without the pillars' scree skirts. */
  base(x: number, z: number): number {
    const bank = this.river(x, z);
    const hills = fbm(this.nHills, x * 0.003, z * 0.003, 3);
    const land = 0.5 + 0.5 * fbm(this.nLand, x * 0.0012, z * 0.0012, 2);
    let y = 3 + hills * 1.4 + smoothstep(10, 420, bank) * (2 + 9 * land);
    // Paddies: shallow terraces stepping up from the river, each a level field.
    const p = this.paddy(x, z);
    if (p > 0) {
      const step = 0.8;
      const f = y / step;
      const i = Math.floor(f);
      y = lerp(y, (i + smoothstep(0.82, 1, f - i)) * step, p);
    }
    // The channel: a soft bank down to a riverbed under the water.
    return lerp(-3.2 + hills * 0.6, y, smoothstep(-8, 12, bank));
  }

  /** Terrain: the valley floor plus a scree mound round every pillar's foot. */
  height(x: number, z: number): number {
    let y = this.base(x, z);
    const C = Config.karst.pillarCell;
    const i0 = Math.floor((x - 80) / C);
    const i1 = Math.floor((x + 80) / C);
    const j0 = Math.floor((z - 80) / C);
    const j1 = Math.floor((z + 80) / C);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const list = this.cell(i, j);
        for (let n = 0; n < list.length; n++) {
          const p = list[n];
          const d = Math.hypot(x - p.x, z - p.z);
          if (d > p.r * 1.9) continue;
          const s = 1 - smoothstep(p.r * 0.85, p.r * 1.9, d);
          y = Math.max(y, p.y0 + 2 + 10 * s * s);
        }
      }
    return y;
  }

  /** 0..1: how much of a terraced paddy field (x, z) is. */
  paddy(x: number, z: number): number {
    const bank = this.rd - this.rw; // river() was just called by base()
    return (
      smoothstep(0.05, 0.25, fbm(this.nPaddy, x * 0.0035, z * 0.0035, 2)) *
      smoothstep(16, 40, bank) *
      (1 - this.village(x, z))
    );
  }

  /** 0..1 grove density: bamboo lining the river banks, broadleaf woods inland. */
  grove(x: number, z: number): number {
    const bank = this.river(x, z);
    const n = fbm(this.nGrove, x * 0.005, z * 0.005, 3);
    const bamboo =
      smoothstep(-3, 2, bank) * (1 - smoothstep(10, 28, bank)) * smoothstep(-0.35, 0, n);
    const wood = smoothstep(0.2, 0.5, n) * smoothstep(30, 60, bank);
    return Math.max(bamboo, wood) * (1 - this.village(x, z));
  }

  /** 0..1 village: small clusters of houses near the water. Uses river() scratch. */
  village(x: number, z: number): number {
    const bank = this.rd - this.rw;
    return (
      smoothstep(0.42, 0.55, fbm(this.nVillage, x * 0.0028, z * 0.0028, 2)) *
      smoothstep(12, 22, bank) *
      (1 - smoothstep(110, 170, bank))
    );
  }

  /** Soft canopy over groves and villages: the bird skims treetops and roofs. */
  canopy(x: number, z: number): number {
    const g = this.grove(x, z);
    return Math.max(smoothstep(0.45, 0.8, g) * Config.karst.canopy, this.village(x, z) * 8);
  }

  // --- Pillars ---------------------------------------------------------------------------------

  /** Pillars whose centre lies in grid cell (i, j). Cached; a pure function of the seed. */
  cell(i: number, j: number): Pillar[] {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let list = this.cells.get(key);
    if (list) return list;
    if (this.cells.size > CELL_CACHE) this.cells.clear();
    list = [];
    const K = Config.karst;
    const C = K.pillarCell;
    const s = this.seed;
    for (let k = 0; k < 2; k++) {
      const ii = i * 2 + k;
      const x = (i + 0.15 + 0.7 * hash2(ii, j, s + 311)) * C;
      const z = (j + 0.15 + 0.7 * hash2(ii, j, s + 312)) * C;
      const dense = fbm(this.nDense, x * 0.0022, z * 0.0022, 2);
      const chance =
        k === 0 ? 0.12 + 0.85 * smoothstep(-0.35, 0.3, dense) : 0.35 * smoothstep(0.1, 0.5, dense);
      if (hash2(ii, j, s + 313) > chance) continue;
      const giant = 1 + 0.25 * smoothstep(0.15, 0.6, dense);
      const r =
        (K.pillarMin + (K.pillarMax - K.pillarMin) * Math.pow(hash2(ii, j, s + 314), 1.5)) *
        giant *
        (k === 1 ? 0.6 : 1);
      // Keep the river open (and the spawn reach of it, where the first wisps run).
      if (this.river(x, z) < r * 1.3 + 10) continue;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 140 + r) continue;
      const shape = Math.floor(hash2(ii, j, s + 315) * SHAPES.length);
      const sh = SHAPES[shape];
      const ground = this.base(x, z);
      const y0 = ground - 3;
      const kk = 0.85 + 0.35 * hash2(ii, j, s + 316);
      const h = Math.min(r * sh.aspect * kk, K.pillarTop - y0);
      const k2 = h / (r * sh.aspect);
      const yaw = hash2(ii, j, s + 317) * Math.PI * 2;
      const lean = sh.lean * sh.aspect * r;
      const pavilion = h > 75 && hash2(ii, j, s + 318) < 0.2;
      list.push({
        x,
        z,
        y0,
        r,
        h,
        shape,
        yaw,
        k: k2,
        lx: Math.cos(yaw) * lean,
        lz: -Math.sin(yaw) * lean,
        top: y0 + h + (pavilion ? 10 : 4),
        reach: r * (1.15 + sh.bulge) + lean,
        pavilion,
        seed: hash2(ii, j, s + 319),
      });
    }
    this.cells.set(key, list);
    return list;
  }

  /**
   * Rock radius at height y (or -1 above or below the rock); the axis centre at that height is
   * left in ax, az.
   */
  axisAt(p: Pillar, y: number): number {
    const t = (y - p.y0) / p.h;
    if (t < 0 || t >= 1) return -1;
    this.ax = p.x + p.lx * t * t;
    this.az = p.z + p.lz * t * t;
    return p.r * profile(SHAPES[p.shape], t);
  }

  /** Height of the summit surface at horizontal distance d from the axis, or -Infinity. */
  private summitY(p: Pillar, d: number): number {
    const sh = SHAPES[p.shape];
    if (d >= p.r * profile(sh, sh.cap)) return -Infinity;
    // The dome narrows monotonically: bisect for the height where its radius is d.
    let lo = sh.cap;
    let hi = 1;
    for (let it = 0; it < 10; it++) {
      const mid = (lo + hi) / 2;
      if (p.r * profile(sh, mid) > d) lo = mid;
      else hi = mid;
    }
    return p.y0 + lo * p.h;
  }

  /** Calls `fn` for every pillar that could reach (x, z) within `pad`; stops when it returns true. */
  private near(x: number, z: number, pad: number, fn: (p: Pillar) => boolean): void {
    const C = Config.karst.pillarCell;
    const R = 75 + pad;
    const i0 = Math.floor((x - R) / C);
    const i1 = Math.floor((x + R) / C);
    const j0 = Math.floor((z - R) / C);
    const j1 = Math.floor((z + R) / C);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const list = this.cell(i, j);
        for (let n = 0; n < list.length; n++) {
          const p = list[n];
          const dx = x - p.x;
          const dz = z - p.z;
          const R2 = p.reach + pad;
          if (dx * dx + dz * dz > R2 * R2) continue;
          if (fn(p)) return;
        }
      }
  }

  // Query state for the closures below (kept on the instance so queries never allocate).
  private qx = 0;
  private qy = 0;
  private qz = 0;
  private qm = 0;
  private qr = -Infinity;
  private qp: Pillar | null = null;

  private readonly solidFn = (p: Pillar): boolean => {
    const y = this.qy;
    const m = this.qm;
    if (y < p.y0 - m || y > p.top + m) return false;
    // Above the rock (summit trees, a pavilion): a short cylinder over the summit.
    const rr = y >= p.y0 + p.h ? -1 : this.axisAt(p, y);
    if (rr < 0) {
      const d = Math.hypot(this.qx - (p.x + p.lx), this.qz - (p.z + p.lz));
      if (d > p.r * 0.3 + m) return false;
    } else if (Math.hypot(this.qx - this.ax, this.qz - this.az) > rr + m) {
      // Beside the rock at this height; still inside if under the summit dome's skin.
      const s = this.summitY(p, Math.hypot(this.qx - this.ax, this.qz - this.az) - m);
      if (y > s + m || s === -Infinity) return false;
    }
    const H = this.hit;
    H[0] = p.x - p.reach;
    H[1] = p.y0;
    H[2] = p.z - p.reach;
    H[3] = p.x + p.reach;
    H[4] = p.top;
    H[5] = p.z + p.reach;
    this.qr = p.top;
    this.qp = p;
    return true;
  };

  /**
   * Top of the first pillar containing the point grown by `margin`, or -Infinity. Its bounds go
   * in `hit` (the same contract as the city's boxes, so the look-ahead and glance are shared).
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    this.qx = x;
    this.qy = y;
    this.qz = z;
    this.qm = margin;
    this.qr = -Infinity;
    this.qp = null;
    this.near(x, z, margin, this.solidFn);
    return this.qr;
  }

  /**
   * Push a point out of the rock (grown by margin): sideways, straight out from the axis, or up
   * onto the summit when that is closer. Returns the distance moved; the normal goes in `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let total = 0;
    for (let iter = 0; iter < 2; iter++) {
      if (this.solidTop(p.x, p.y, p.z, margin) === -Infinity) break;
      const q = this.qp!;
      const rr = Math.max(this.axisAt(q, Math.min(p.y, q.y0 + q.h - 0.01)), 0);
      let dx = p.x - this.ax;
      let dz = p.z - this.az;
      let d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const side = rr + margin - d;
      // Up onto the summit only where there is one overhead; on the flanks, straight out.
      const crown = d < q.r * 0.3 + margin ? q.top : this.summitY(q, d);
      const up = crown === -Infinity ? Infinity : crown + margin - p.y;
      // High on the summit dome the rock faces the sky: leave upward.
      const sh = SHAPES[q.shape];
      const crest = (p.y - q.y0) / q.h > sh.cap + (1 - sh.cap) * 0.5;
      if (up !== Infinity && (crest || up < side || side <= 0)) {
        if (up <= 0) break;
        n.x = n.z = 0;
        p.y += up;
        n.y = 1;
        total += up;
      } else {
        if (side <= 0) break;
        n.y = 0;
        p.x += (dx / d) * side;
        p.z += (dz / d) * side;
        n.x = dx / d;
        n.z = dz / d;
        total += side;
      }
    }
    return total;
  }

  private sx = 0;
  private sz = 0;
  private best = -Infinity;
  private readonly summitFn = (p: Pillar): boolean => {
    const sh = SHAPES[p.shape];
    // The summit's axis, taken at the middle of the dome.
    const t = (1 + sh.cap) / 2;
    const d = Math.hypot(this.sx - (p.x + p.lx * t * t), this.sz - (p.z + p.lz * t * t));
    const y = this.summitY(p, d);
    if (y > this.best) this.best = y + (d < p.r * 0.3 ? p.top - p.y0 - p.h : 2);
    return false;
  };

  /** Top of any pillar summit over (x, z), or -Infinity (shadows, lanterns). */
  summitAt(x: number, z: number): number {
    this.sx = x;
    this.sz = z;
    this.best = -Infinity;
    this.near(x, z, 0, this.summitFn);
    return this.best;
  }

  private readonly skyFn = (p: Pillar): boolean => {
    if (p.top > this.best) this.best = p.top;
    return false;
  };

  /** Highest solid top of any pillar within `r` of (x, z), or -Infinity. */
  skyline(x: number, z: number, r: number): number {
    this.best = -Infinity;
    this.near(x, z, r, this.skyFn);
    return this.best;
  }

  /** Nearest pillar to (x, z) whose centre is within `r`, or null. */
  nearestPillar(x: number, z: number, r: number, minH: number): Pillar | null {
    let best: Pillar | null = null;
    let bd = r;
    this.near(x, z, r, (p) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd && p.h >= minH) {
        bd = d;
        best = p;
      }
      return false;
    });
    return best;
  }

  /** Clearance check for planning: is the point at least `margin` from rock and ground? */
  clear(x: number, y: number, z: number, margin: number): boolean {
    return (
      y > Math.max(this.height(x, z), Config.world.waterLevel) + margin &&
      this.solidTop(x, y, z, margin) === -Infinity
    );
  }
}
