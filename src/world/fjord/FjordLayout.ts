import { Config } from '../../core/Config';
import { lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, type Noise2D } from '../noise';

/**
 * Aurora Fjords' plan as one pure, seeded function of position (no Three.js, unit-tested):
 * fjords along the zero contours of a low-frequency noise, each a strip of black water with a
 * pebble strand along its shore, then a steep glacial wall rounding over onto a snowy plateau
 * with ridged peaks. Icebergs drift on the water and a lighthouse stands on the shore ahead of
 * the spawn. The terrain, collisions and wisp planner all read it.
 */

export interface Berg {
  x: number;
  z: number;
  r: number;
  h: number;
  yaw: number;
  seed: number;
}

const CELL_CACHE = 4000;

export class FjordLayout {
  readonly seed: number;
  readonly spawn = { x: 0, y: 22, z: 0, yaw: 0 };
  readonly lighthouse = { x: 0, y0: 0, z: 0, r: 3.4, h: 24, yaw: 0 };
  /** The last solid a query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);
  /** Scratch results of `fjord()`: noise value, its gradient (per metre), distance, half width. */
  fv = 0;
  fgx = 0;
  fgz = 0;
  fd = 0;
  fw = 0;
  private readonly nFjord: Noise2D;
  private readonly nWidth: Noise2D;
  private readonly nShelf: Noise2D;
  private readonly nPlateau: Noise2D;
  private readonly nPeak: Noise2D;
  private readonly nCrag: Noise2D;
  private readonly nForest: Noise2D;
  private readonly nHamlet: Noise2D;
  private readonly bergs = new Map<number, Berg | null>();

  constructor(seed: number) {
    this.seed = seed;
    this.nFjord = createNoise2D(seed + 401);
    this.nWidth = createNoise2D(seed + 402);
    this.nShelf = createNoise2D(seed + 403);
    this.nPlateau = createNoise2D(seed + 404);
    this.nPeak = createNoise2D(seed + 405);
    this.nCrag = createNoise2D(seed + 406);
    this.nForest = createNoise2D(seed + 407);
    this.nHamlet = createNoise2D(seed + 408);
    this.findSpawn();
    this.placeLighthouse();
  }

  // --- Fjords ----------------------------------------------------------------------------------

  private fjordNoise(x: number, z: number): number {
    const f = Config.fjord.fjordScale;
    return fbm(this.nFjord, x * f, z * f, 2);
  }

  /**
   * Signed distance (m) from (x, z) to the nearest shore: negative on the water. Fjords run
   * along the zero contour of a noise; distance to it is |n| / |grad n| (first order), as with
   * Jade River's rivers. Leaves the noise, gradient, centre-line distance and half width in
   * fv, fgx/fgz, fd and fw.
   */
  fjord(x: number, z: number): number {
    const e = 4;
    const v = this.fjordNoise(x, z);
    const gx = (this.fjordNoise(x + e, z) - v) / e;
    const gz = (this.fjordNoise(x, z + e) - v) / e;
    const g = Math.max(Math.hypot(gx, gz), 1e-6);
    this.fv = v;
    this.fgx = gx;
    this.fgz = gz;
    this.fd = Math.abs(v) / g;
    const K = Config.fjord;
    this.fw =
      K.fjordMin + (K.fjordMax - K.fjordMin) * (0.5 + 0.5 * this.nWidth(x * 6e-4, z * 6e-4));
    return this.fd - this.fw;
  }

  /** Direction along the fjord at (x, z), the one closer to `yaw`. */
  heading(x: number, z: number, yaw: number): number {
    this.fjord(x, z);
    const a = Math.atan2(-this.fgz, this.fgx); // along the contour: perpendicular to the gradient
    return Math.sin(a) * Math.sin(yaw) + Math.cos(a) * Math.cos(yaw) >= 0 ? a : a + Math.PI;
  }

  /** One Newton step from (x, z) toward the fjord's centre line; writes into `out`. */
  toCentre(x: number, z: number, out: { x: number; z: number }): void {
    this.fjord(x, z);
    const g2 = Math.max(this.fgx * this.fgx + this.fgz * this.fgz, 1e-12);
    out.x = x - (this.fv * this.fgx) / g2;
    out.z = z - (this.fv * this.fgz) / g2;
  }

  /** Spawn on the fjord nearest the origin, mid-channel, facing along it. */
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
        if (this.fjord(x, z) < -this.fw * 0.8 && Math.hypot(x, z) < best) {
          best = Math.hypot(x, z);
          bx = x;
          bz = z;
        }
      }
    this.spawn.x = bx;
    this.spawn.z = bz;
    this.spawn.yaw = this.heading(bx, bz, 0);
  }

  /** Down the fjord from the spawn, then across to the shore on the outside of the view. */
  private placeLighthouse(): void {
    const S = this.spawn;
    let x = S.x;
    let z = S.z;
    let h = S.yaw;
    for (let d = 0; d < Config.fjord.lighthouseAhead; d += 10) {
      h = this.heading(x, z, h);
      x += Math.sin(h) * 10;
      z += Math.cos(h) * 10;
    }
    // Step sideways (to the bird's left) until on the strand, a few metres from the water.
    const sx = Math.cos(h);
    const sz = -Math.sin(h);
    for (let k = 0; k < 60 && this.fjord(x, z) < 5; k++) {
      x += sx * 4;
      z += sz * 4;
    }
    const L = this.lighthouse;
    L.x = x;
    L.z = z;
    L.y0 = this.height(x, z) - 0.5;
    L.yaw = h;
  }

  // --- Ground ----------------------------------------------------------------------------------

  /** Width of the flat strand between the water and the wall here (m). */
  shelf(x: number, z: number): number {
    return Config.fjord.shelfMax * smoothstep(-0.1, 0.55, this.nShelf(x * 0.004, z * 0.004));
  }

  /**
   * Terrain: a deep bed under the water, a pebble strand, then a glacial wall (steep at its
   * foot, rounding over at the lip: 1 - (1 - t)^2.2) up to the plateau, which swells and throws
   * up ridged peaks away from the walls. Crags roughen the wall so it never reads as a ramp.
   */
  height(x: number, z: number): number {
    const K = Config.fjord;
    const bank = this.fjord(x, z);
    const shelf = this.shelf(x, z);
    const bed = -26 + 6 * this.nCrag(x * 0.003, z * 0.003);
    const strand = 0.6 + 1.6 * smoothstep(0, shelf + 1, bank);
    let y = lerp(bed, strand, smoothstep(-24, 2, bank));
    const t = Math.min(Math.max((bank - shelf) / K.wall, 0), 1);
    if (t > 0) {
      const u = 1 - Math.pow(1 - t, 2.2);
      const plateau = K.plateau + K.plateauVar * fbm(this.nPlateau, x * 0.0014, z * 0.0014, 3);
      // Crags and gullies: ridged noise scores the walls into buttresses.
      const crag =
        fbm(this.nCrag, x * 0.018, z * 0.018, 2) * 8 +
        (1 - Math.abs(this.nCrag(x * 0.045 + 7, z * 0.045))) * 14 * Math.sin(Math.PI * t);
      const r = 1 - Math.abs(this.nPeak(x * 0.0024, z * 0.0024));
      const peaks = r * r * r * r * K.peaks * smoothstep(K.wall, K.wall + 220, bank - shelf);
      y += (plateau + crag) * u + peaks;
    }
    return y;
  }

  /** 0..1 spruce density: dark stands on the strand and the lower walls, under the treeline. */
  forest(x: number, z: number): number {
    const y = this.height(x, z);
    const bank = this.fd - this.fw;
    const n = fbm(this.nForest, x * 0.006, z * 0.006, 2);
    return (
      smoothstep(-0.5, 0.15, n) *
      smoothstep(1.2, 3, y) *
      (1 - smoothstep(Config.fjord.treeline - 20, Config.fjord.treeline, y)) *
      (1 - this.hamlet(x, z) * smoothstep(0, 10, Math.max(0, this.shelf(x, z) - bank)))
    );
  }

  /** 0..1: where a fishing hamlet's red huts line the strand. */
  hamlet(x: number, z: number): number {
    return smoothstep(0.3, 0.5, fbm(this.nHamlet, x * 0.003, z * 0.003, 2));
  }

  // --- Ice -------------------------------------------------------------------------------------

  /** The iceberg whose centre lies in grid cell (i, j), if any. Cached; pure per seed. */
  berg(i: number, j: number): Berg | null {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    const hit = this.bergs.get(key);
    if (hit !== undefined) return hit;
    if (this.bergs.size > CELL_CACHE) this.bergs.clear();
    const C = Config.fjord.bergCell;
    const s = this.seed;
    let b: Berg | null = null;
    if (hash2(i, j, s + 411) < 0.3) {
      const x = (i + 0.2 + 0.6 * hash2(i, j, s + 412)) * C;
      const z = (j + 0.2 + 0.6 * hash2(i, j, s + 413)) * C;
      const r = 5 + 7 * hash2(i, j, s + 414);
      // Out on open water, and clear of the spawn reach where the first ribbon runs low.
      if (
        this.fjord(x, z) < -(r + 14) &&
        Math.hypot(x - this.spawn.x, z - this.spawn.z) > Config.fjord.lighthouseAhead + 80
      )
        b = {
          x,
          z,
          r,
          h: r * (0.6 + 0.6 * hash2(i, j, s + 415)),
          yaw: hash2(i, j, s + 416) * Math.PI * 2,
          seed: hash2(i, j, s + 417),
        };
    }
    this.bergs.set(key, b);
    return b;
  }

  /** Height of ice over (x, z) (a soft dome per berg), or 0. The bird skims it like ground. */
  ice(x: number, z: number): number {
    const C = Config.fjord.bergCell;
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    let y = 0;
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++) {
        const b = this.berg(i, j);
        if (!b) continue;
        const q = Math.hypot(x - b.x, z - b.z) / b.r;
        if (q < 1) y = Math.max(y, b.h * Math.sqrt(1 - q * q));
      }
    return y;
  }

  /** What the bird flies over: terrain or ice, whichever is higher. */
  ground(x: number, z: number): number {
    return Math.max(this.height(x, z), this.ice(x, z));
  }

  // --- Solids ----------------------------------------------------------------------------------

  /** Inside the lighthouse (grown by margin)? Writes its box into `hit`. */
  private inLighthouse(x: number, y: number, z: number, margin: number): boolean {
    const L = this.lighthouse;
    if (y < L.y0 - margin || y > L.y0 + L.h + margin) return false;
    if (Math.hypot(x - L.x, z - L.z) > L.r + 1.2 + margin) return false;
    const H = this.hit;
    H[0] = L.x - L.r;
    H[1] = L.y0;
    H[2] = L.z - L.r;
    H[3] = L.x + L.r;
    H[4] = L.y0 + L.h;
    H[5] = L.z + L.r;
    return true;
  }

  /**
   * Top of whatever solid contains the point grown by `margin`, or -Infinity: the lighthouse,
   * or a wall (terrain above the strand), so the city's look-ahead veers along the fjord
   * instead of climbing into the rock. Same contract as the city's boxes.
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    if (this.inLighthouse(x, y, z, margin)) return this.hit[4];
    const g = this.height(x, z);
    if (g < 3 || y > g + margin) return -Infinity;
    const H = this.hit;
    H[0] = x - 1;
    H[1] = -Infinity; // walls have no underside to dip beneath
    H[2] = z - 1;
    H[3] = x + 1;
    H[4] = g;
    H[5] = z + 1;
    return g;
  }

  /**
   * Push a point out of the lighthouse (grown by margin): straight out from its axis, or up
   * over the lamp when that is closer. Terrain is the flight model's floor, not pushed here.
   * Returns the distance moved; the normal goes in `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    const L = this.lighthouse;
    if (!this.inLighthouse(p.x, p.y, p.z, margin - 1.2)) return 0;
    let dx = p.x - L.x;
    let dz = p.z - L.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = 1;
      dz = 0;
      d = 1;
    }
    const side = L.r + margin - d;
    const up = L.y0 + L.h + margin - p.y;
    if (up < side) {
      p.y += up;
      n.x = n.z = 0;
      n.y = 1;
      return up;
    }
    p.x += (dx / d) * side;
    p.z += (dz / d) * side;
    n.x = dx / d;
    n.y = 0;
    n.z = dz / d;
    return side;
  }

  /**
   * Clearance check for planning: is the point at least `margin` above ground, water and ice,
   * and as far from any wall (sampled round it) and the lighthouse?
   */
  clear(x: number, y: number, z: number, margin: number): boolean {
    if (y < Math.max(this.ground(x, z), Config.world.waterLevel) + margin) return false;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      if (this.height(x + Math.sin(a) * margin, z + Math.cos(a) * margin) > y - 2) return false;
    }
    return !this.inLighthouse(x, y, z, margin);
  }
}
