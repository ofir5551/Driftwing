import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, type Noise2D } from '../noise';

/**
 * Sea of Clouds' plan as one pure, seeded function of position (no Three.js, unit-tested): a
 * rolling sea of cloud for ground, granite spires rising out of it on a jittered grid, and the
 * Sky Gate ahead of the spawn (two great spires joined by a hanging bridge, a monastery on the
 * taller). The renderer, collisions and wisp planner all read it, so they agree on the rock.
 */

/** A spire silhouette, in base radii: a tapering column with tiers and a summit dome. */
export interface SpireShape {
  /** Height over base radius before the per-spire stretch. */
  aspect: number;
  /** How much the column narrows toward the top. */
  taper: number;
  /** Ledges where the column steps in (granite breaking along its horizontal joints). */
  tiers: number;
  /** Radius lost over all the tiers. */
  step: number;
  /** Fraction of the height where the summit dome starts. */
  cap: number;
  /** Dome flatness: 2 is round, higher is a flat top with a rounded edge. */
  flat: number;
  /** Top offset as a fraction of the height. */
  lean: number;
}

export const SHAPES: SpireShape[] = [
  { aspect: 4.2, taper: 0.18, tiers: 0, step: 0, cap: 0.94, flat: 6, lean: 0.02 }, // column
  { aspect: 6.4, taper: 0.6, tiers: 0, step: 0, cap: 0.85, flat: 1.7, lean: 0.05 }, // needle
  { aspect: 3.6, taper: 0.1, tiers: 3, step: 0.42, cap: 0.93, flat: 5, lean: 0 }, // tiered tower
  { aspect: 2.6, taper: 0.25, tiers: 1, step: 0.2, cap: 0.8, flat: 3.5, lean: 0 }, // massif
  { aspect: 4.8, taper: 0.38, tiers: 1, step: 0.18, cap: 0.9, flat: 3, lean: 0.12 }, // leaning
];

/** Column, the shape the gate spires use. */
export const COLUMN = 0;

/**
 * Radius at fraction t of the height, in base radii. The mesh is lathed from this and the
 * collisions test against it, so the bird meets the rock where it is drawn. Non-increasing in t
 * above the flared foot, which the summit query's bisection relies on.
 */
export function profile(sh: SpireShape, t: number): number {
  if (t >= 1) return 0;
  const foot = t < 0.06 ? 1 + 0.12 * (1 - t / 0.06) : 1;
  let r = foot * (1 - sh.taper * t);
  if (sh.tiers > 0) {
    // Stairs: flat runs, then a quick step in at each joint.
    const s = t * (sh.tiers + 1);
    const i = Math.floor(s);
    r *= 1 - (sh.step * (i + smoothstep(0.86, 1, s - i))) / (sh.tiers + 1);
  }
  if (t > sh.cap) {
    const q = (t - sh.cap) / (1 - sh.cap);
    r *= Math.sqrt(Math.max(0, 1 - Math.pow(q, sh.flat)));
  }
  return r;
}

/** What stands on a summit: nothing but pines, a hermitage, or the gate's monastery. */
export const Temple = { None: 0, Hermitage: 1, Monastery: 2 } as const;
export type Temple = (typeof Temple)[keyof typeof Temple];

export interface Spire {
  x: number;
  z: number;
  /** Base, hidden under the cloud sea. */
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
  /** Highest point anything solid reaches (summit pines, a temple). */
  top: number;
  /** Radius of the solid crown over the summit (pines, a temple). */
  crown: number;
  /** Horizontal reach from (x, z) of any part of the rock. */
  reach: number;
  temple: Temple;
  /** Per-spire random in [0, 1) for decor. */
  seed: number;
}

/** The gate's bridge as a box, plus its deck curve (for decor). */
export interface Bridge {
  x0: number;
  x1: number;
  z: number;
  /** Deck height where it meets the rock, and its sag at midspan. */
  y: number;
  sag: number;
  /** Half width (z) of the solid. */
  w: number;
}

const CELL_CACHE = 6000;

export class PeaksLayout {
  readonly seed: number;
  readonly spawn = { x: 0, y: 80, z: 0, yaw: 0 };
  /** The last solid a query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);
  /** Scratch result of `axisAt()`: the rock's centre at that height. */
  ax = 0;
  az = 0;
  /** The Sky Gate: its two spires (left, the monastery's, then right) and the bridge. */
  readonly gate: Spire[];
  readonly bridge: Bridge;
  private readonly nSwell: Noise2D;
  private readonly nBillow: Noise2D;
  private readonly nDome: Noise2D;
  private readonly nDense: Noise2D;
  private readonly cells = new Map<number, Spire[]>();

  constructor(seed: number) {
    this.seed = seed;
    this.nSwell = createNoise2D(seed + 501);
    this.nBillow = createNoise2D(seed + 502);
    this.nDome = createNoise2D(seed + 503);
    this.nDense = createNoise2D(seed + 504);
    const P = Config.peaks;
    const z = P.gateAhead;
    // Facing +z the bird's left is +x: the taller spire with the monastery stands there.
    this.gate = [
      this.make(P.gateHalf, z, 27, 245, COLUMN, 0.4, Temple.Monastery, 0.31),
      this.make(-P.gateHalf, z + 6, 26, 215, COLUMN, 2.1, Temple.None, 0.77),
    ];
    // The deck runs from rock to rock, its ends a little inside each spire.
    const half = P.gateHalf - 21;
    this.bridge = { x0: -half, x1: half, z: z + 3, y: P.bridgeY, sag: P.bridgeSag, w: 2.2 };
  }

  /** A spire from its plan values (the gate's, or one rolled for a cell). */
  private make(
    x: number,
    z: number,
    r: number,
    h: number,
    shape: number,
    yaw: number,
    temple: Temple,
    seed: number,
  ): Spire {
    const sh = SHAPES[shape];
    const y0 = Config.peaks.cloud - 30;
    const lean = sh.lean * sh.aspect * r;
    const crown = temple === Temple.Monastery ? 16 : temple === Temple.Hermitage ? 7 : r * 0.3;
    return {
      x,
      z,
      y0,
      r,
      h,
      shape,
      yaw,
      k: h / (r * sh.aspect),
      lx: Math.cos(yaw) * lean,
      lz: -Math.sin(yaw) * lean,
      top: y0 + h + (temple === Temple.Monastery ? 17 : temple === Temple.Hermitage ? 10 : 6),
      crown,
      reach: r * 1.13 + lean,
      temple,
      seed,
    };
  }

  // --- The cloud sea --------------------------------------------------------------------------

  /** The cloud sea's surface without the heaps against the rock. */
  cloud(x: number, z: number): number {
    const P = Config.peaks;
    const swell = fbm(this.nSwell, x * 0.0022, z * 0.0022, 2);
    const billow = this.billow(x, z);
    // Heaps of cloud rise off the sea here and there, kept off the opening glide.
    const d = smoothstep(0.2, 0.65, fbm(this.nDome, x * 0.0016, z * 0.0016, 2));
    const away = smoothstep(180, 420, Math.hypot(x - this.spawn.x, z - this.spawn.z));
    return P.cloud + swell * P.swell + (billow - 0.45) * P.billow + d * d * P.dome * away;
  }

  /**
   * 0..1: the cloud sea's heaps. |noise| has rounded tops and sharp creases where it crosses
   * zero, the shape of cumulus seen from above (plain noise rolls like dunes).
   */
  billow(x: number, z: number): number {
    const a = Math.abs(this.nBillow(x * 0.014, z * 0.014));
    const b = Math.abs(this.nBillow(x * 0.037 + 31.7, z * 0.037 - 12.1));
    return Math.min(1, a * 0.75 + b * 0.35);
  }

  /** Ground: the cloud sea, piled up softly against the foot of every spire. */
  height(x: number, z: number): number {
    const y = this.cloud(x, z);
    const C = Config.peaks.spireCell;
    const R = 75;
    const i0 = Math.floor((x - R) / C);
    const i1 = Math.floor((x + R) / C);
    const j0 = Math.floor((z - R) / C);
    const j1 = Math.floor((z + R) / C);
    let heap = 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const list = this.cell(i, j);
        for (let n = 0; n < list.length; n++) {
          const p = list[n];
          const d = Math.hypot(x - p.x, z - p.z);
          if (d > p.r * 1.9) continue;
          const s = 1 - smoothstep(p.r * 0.9, p.r * 1.9, d);
          heap = Math.max(heap, s * s);
        }
      }
    return y + heap * Config.peaks.heap;
  }

  // --- Spires ----------------------------------------------------------------------------------

  /** Is (x, z) kept open for the spawn and the opening glide to the gate? */
  private reserved(x: number, z: number, r: number): boolean {
    const s = this.spawn;
    if (Math.hypot(x - s.x, z - s.z) < 170 + r) return true;
    // The corridor to the gate and a little past it, wide enough to frame it, not crowd it.
    return z > s.z - 60 && z < s.z + Config.peaks.gateAhead + 150 && Math.abs(x - s.x) < 120 + r;
  }

  /** Spires whose centre lies in grid cell (i, j). Cached; a pure function of the seed. */
  cell(i: number, j: number): Spire[] {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let list = this.cells.get(key);
    if (list) return list;
    if (this.cells.size > CELL_CACHE) this.cells.clear();
    list = [];
    const P = Config.peaks;
    const C = P.spireCell;
    const s = this.seed;
    // Offset the hash coordinates: hash2 mirrors through the origin for odd pairs.
    const ci = i + 1013;
    const cj = j + 2029;
    for (let k = 0; k < 2; k++) {
      const ii = ci * 2 + k;
      const x = (i + 0.15 + 0.7 * hash2(ii, cj, s + 511)) * C;
      const z = (j + 0.15 + 0.7 * hash2(ii, cj, s + 512)) * C;
      const dense = fbm(this.nDense, x * 0.0019, z * 0.0019, 2);
      // Ranges of spires with open cloud sea between them.
      const chance =
        k === 0 ? 0.06 + 0.86 * smoothstep(-0.3, 0.3, dense) : 0.4 * smoothstep(0.05, 0.45, dense);
      if (hash2(ii, cj, s + 513) > chance) continue;
      const giant = 1 + 0.3 * smoothstep(0.15, 0.6, dense);
      const r =
        (P.spireMin + (P.spireMax - P.spireMin) * Math.pow(hash2(ii, cj, s + 514), 1.5)) *
        giant *
        (k === 1 ? 0.65 : 1);
      if (this.reserved(x, z, r * 1.3)) continue;
      const shape = Math.floor(hash2(ii, cj, s + 515) * SHAPES.length);
      const sh = SHAPES[shape];
      const y0 = P.cloud - 30;
      const kk = 1.05 + 0.75 * hash2(ii, cj, s + 516);
      const h = Math.min(r * sh.aspect * kk, P.spireTop - 12 - y0);
      const temple = h > 140 && hash2(ii, cj, s + 517) < 0.22 ? Temple.Hermitage : Temple.None;
      list.push(
        this.make(
          x,
          z,
          r,
          h,
          shape,
          hash2(ii, cj, s + 518) * Math.PI * 2,
          temple,
          hash2(ii, cj, s + 519),
        ),
      );
    }
    for (const g of this.gate)
      if (Math.floor(g.x / C) === i && Math.floor(g.z / C) === j) list.push(g);
    this.cells.set(key, list);
    return list;
  }

  /**
   * Rock radius at height y (or -1 above or below the rock); the axis centre at that height is
   * left in ax, az.
   */
  axisAt(p: Spire, y: number): number {
    const t = (y - p.y0) / p.h;
    if (t < 0 || t >= 1) return -1;
    this.ax = p.x + p.lx * t * t;
    this.az = p.z + p.lz * t * t;
    return p.r * profile(SHAPES[p.shape], t);
  }

  /** Height of the summit surface at horizontal distance d from the axis, or -Infinity. */
  private summitY(p: Spire, d: number): number {
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

  /** Calls `fn` for every spire that could reach (x, z) within `pad`; stops when it returns true. */
  private near(x: number, z: number, pad: number, fn: (p: Spire) => boolean): void {
    const C = Config.peaks.spireCell;
    const R = 60 + pad;
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
  private qp: Spire | null = null;

  private readonly solidFn = (p: Spire): boolean => {
    const y = this.qy;
    const m = this.qm;
    if (y < p.y0 - m || y > p.top + m) return false;
    // Above the rock (summit pines, a temple): a short cylinder over the summit.
    const rr = y >= p.y0 + p.h ? -1 : this.axisAt(p, y);
    if (rr < 0) {
      const d = Math.hypot(this.qx - (p.x + p.lx), this.qz - (p.z + p.lz));
      if (d > p.crown + m) return false;
    } else if (Math.hypot(this.qx - this.ax, this.qz - this.az) > rr + m) {
      // Beside the rock at this height; still inside if under the summit dome's skin, or in
      // the crown standing on it.
      const d = Math.hypot(this.qx - this.ax, this.qz - this.az);
      const s = this.summitY(p, d - m);
      const inCrown = d < p.crown + m && y > p.y0 + p.h * SHAPES[p.shape].cap;
      if (!inCrown && (y > s + m || s === -Infinity)) return false;
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

  /** Inside the gate bridge's box grown by m? */
  private inBridge(x: number, y: number, z: number, m: number): boolean {
    const b = this.bridge;
    return (
      x > b.x0 - m &&
      x < b.x1 + m &&
      Math.abs(z - b.z) < b.w + m &&
      y > b.y - b.sag - 1.2 - m &&
      y < b.y + 1.6 + m
    );
  }

  /**
   * Top of the first solid containing the point grown by `margin`, or -Infinity. Its bounds go
   * in `hit` (the same contract as the city's boxes, so the look-ahead and glance are shared).
   * The bridge reports its underside as the box's base, so the look-ahead eases under it.
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    this.qx = x;
    this.qy = y;
    this.qz = z;
    this.qm = margin;
    this.qr = -Infinity;
    this.qp = null;
    if (this.inBridge(x, y, z, margin)) {
      const b = this.bridge;
      const H = this.hit;
      H[0] = b.x0;
      H[1] = b.y - b.sag - 1.2;
      H[2] = b.z - b.w;
      H[3] = b.x1;
      H[4] = b.y + 1.6;
      H[5] = b.z + b.w;
      return H[4];
    }
    this.near(x, z, margin, this.solidFn);
    return this.qr;
  }

  /**
   * Push a point out of the rock (grown by margin): sideways, straight out from the axis, or up
   * onto the summit when that is closer; out of the bridge up or down, whichever is nearer.
   * Returns the distance moved; the normal goes in `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let total = 0;
    for (let iter = 0; iter < 2; iter++) {
      if (this.solidTop(p.x, p.y, p.z, margin) === -Infinity) break;
      const q = this.qp;
      if (!q) {
        // The bridge: leave through the deck or its underside.
        const b = this.bridge;
        const up = b.y + 1.6 + margin - p.y;
        const down = p.y - (b.y - b.sag - 1.2 - margin);
        if (up <= 0 || down <= 0) break;
        n.x = n.z = 0;
        if (up < down) {
          p.y += up;
          n.y = 1;
          total += up;
        } else {
          p.y -= down;
          n.y = -1;
          total += down;
        }
        continue;
      }
      const rr = Math.max(this.axisAt(q, Math.min(p.y, q.y0 + q.h - 0.01)), 0);
      let dx = p.x - this.ax;
      let dz = p.z - this.az;
      let d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const side =
        Math.max(rr, d < q.crown + margin && p.y > q.y0 + q.h ? q.crown : 0) + margin - d;
      // Up onto the summit only where there is one overhead; on the flanks, straight out.
      const crown = d < q.crown + margin ? q.top : this.summitY(q, d);
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
  private readonly summitFn = (p: Spire): boolean => {
    const sh = SHAPES[p.shape];
    // The summit's axis, taken at the middle of the dome.
    const t = (1 + sh.cap) / 2;
    const d = Math.hypot(this.sx - (p.x + p.lx * t * t), this.sz - (p.z + p.lz * t * t));
    const y = d < p.crown ? p.top : this.summitY(p, d);
    if (y > this.best) this.best = y;
    return false;
  };

  /** Top of any summit (or the bridge deck) over (x, z), or -Infinity (shadows, lanterns). */
  summitAt(x: number, z: number): number {
    this.sx = x;
    this.sz = z;
    this.best = -Infinity;
    this.near(x, z, 0, this.summitFn);
    const b = this.bridge;
    if (x > b.x0 && x < b.x1 && Math.abs(z - b.z) < b.w) this.best = Math.max(this.best, b.y + 1.6);
    return this.best;
  }

  private readonly skyFn = (p: Spire): boolean => {
    if (p.top > this.best) this.best = p.top;
    return false;
  };

  /** Highest solid top of any spire (or the bridge) within `r` of (x, z), or -Infinity. */
  skyline(x: number, z: number, r: number): number {
    this.best = -Infinity;
    this.near(x, z, r, this.skyFn);
    const b = this.bridge;
    if (x > b.x0 - r && x < b.x1 + r && Math.abs(z - b.z) < b.w + r)
      this.best = Math.max(this.best, b.y + 1.6);
    return this.best;
  }

  /** Nearest spire to (x, z) whose centre is within `r` and whose top is in [lo, hi], or null. */
  nearestSpire(x: number, z: number, r: number, lo: number, hi: number): Spire | null {
    let best: Spire | null = null;
    let bd = r;
    this.near(x, z, r, (p) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd && p.top >= lo && p.top <= hi) {
        bd = d;
        best = p;
      }
      return false;
    });
    return best;
  }

  /** Clearance for planning: `margin` from rock, `ground` over the cloud sea. */
  clear(x: number, y: number, z: number, margin: number, ground: number): boolean {
    return y > this.height(x, z) + ground && this.solidTop(x, y, z, margin) === -Infinity;
  }
}
