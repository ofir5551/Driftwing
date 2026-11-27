import { Config } from '../../core/Config';
import { clamp, lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, type Noise2D } from '../noise';

/**
 * Maple Valley's plan as one pure, seeded function of position (no Three.js, unit-tested): a
 * river winding along the zero contour of a low noise, its valley floor of meadows and farms,
 * and wooded mountains rising on both sides. The home lake sits on the river ahead of the
 * spawn with a great gate standing in the water and a pavilion on its island; temples stand on
 * levelled pads above the valley floor, tunnels of gates climb the mountainsides on benches cut
 * into the slope, and arched bridges cross the river. The renderer, collisions and wisp planner
 * all read it, so they agree on where everything is.
 */

/** A solid part: an upright cylinder, or a box turned to (ux, uz). y0 = base, y1 = top. */
export interface Solid {
  box: boolean;
  x: number;
  z: number;
  /** Cylinder radius. */
  r: number;
  /** Box: unit vector along its length, half length and half width. */
  ux: number;
  uz: number;
  ha: number;
  hb: number;
  y0: number;
  y1: number;
  /** Horizontal reach from (x, z) of any part. */
  reach: number;
}

export interface Temple {
  x: number;
  z: number;
  /** Height of the levelled pad. */
  y: number;
  /** The hall faces this way (toward the water). */
  yaw: number;
  /** The pagoda's foot, a little to the side of the hall. */
  px: number;
  pz: number;
  /** Top of the pagoda's finial. */
  top: number;
  solids: Solid[];
  /** The home temple, across the lake from the spawn. */
  home: boolean;
  seed: number;
}

/** A tunnel of gates climbing a mountainside on a bench cut into the slope. */
export interface Tunnel {
  /** Per gate: x, y (the bench), z, yaw (the way up). */
  gates: Float64Array;
  n: number;
  /** The shrine at the top. */
  sx: number;
  sy: number;
  sz: number;
  syaw: number;
  /** Bounding box of the path and the shrine, grown by the bench's blend. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  seed: number;
}

/** An arched bridge across the river (as Jade River's, in vermilion). */
export interface Bridge {
  x: number;
  z: number;
  ux: number;
  uz: number;
  yaw: number;
  half: number;
  crown: number;
  ends: number;
  width: number;
}

/** Deck top of a bridge at u in [-1, 1] along its span: a high drum arch. */
export function deckY(b: Bridge, u: number): number {
  const w = 1 - u * u;
  return b.ends + (b.crown - b.ends) * Math.sqrt(w);
}

/** Pagoda height from its pad to the finial (m, at scale 1). */
export const PAGODA_HEIGHT = 31;
/** The pagoda's widest eave, as a solid's radius (m). */
export const PAGODA_R = 6.4;
/** A temple hall's half length and width, and its ridge over the pad (m). */
export const HALL = { a: 9.5, b: 6.8, h: 11.5 };
/** The shrine at a tunnel's top. */
export const SHRINE = { a: 4.2, b: 3.4, h: 6.8 };
/** The lake pavilion: radius of its widest eave and its height over the island (m). */
export const PAVILION = { r: 9.5, h: 17 };
/** The great gate in the lake: half span between its posts, beams' underside and top (m). */
export const WATER_GATE = { half: 10, post: 1.3, under: 13, top: 18.4, over: 5 };

const CELL_CACHE = 4000;
/** m of open path leading up to a tunnel's first gate. */
export const LEAD_IN = 50;
const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

export class MapleLayout {
  readonly seed: number;
  readonly spawn = { x: 0, y: 16, z: 0, yaw: 0 };
  /** The home lake: centre, the river's direction through it (unit), radius. */
  readonly lake = { x: 0, z: 0, ux: 0, uz: 1, r: 0 };
  readonly island = { x: 0, z: 0, r: 0, y: 2.4 };
  /** The pavilion on the island: foot, facing (toward the spawn), top. */
  readonly pavilion = { x: 0, y: 0, z: 0, yaw: 0, top: 0 };
  /** The great gate standing in the lake, across the way in from the spawn. */
  readonly gate = { x: 0, z: 0, yaw: 0, ux: 0, uz: 1 };
  /** The opening run: from the spawn down the river, through the gate, across the lake. */
  readonly opening: number[] = [];
  /** The temple across the lake from the spawn. */
  home: Temple | null = null;
  /** The last solid a query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);
  /** Scratch results of `river()`: noise value, gradient, centre-line distance, half width. */
  rv = 0;
  rgx = 0;
  rgz = 0;
  rd = 0;
  rw = 0;
  /** Scratch of `base()`: how far up the mountains the point is (0 valley floor, 1 slopes). */
  rise = 0;
  private readonly homeSolids: Solid[] = [];
  private readonly nRiver: Noise2D;
  private readonly nWidth: Noise2D;
  private readonly nHills: Noise2D;
  private readonly nMount: Noise2D;
  private readonly nRange: Noise2D;
  private readonly nValley: Noise2D;
  private readonly nForest: Noise2D;
  private readonly nVillage: Noise2D;
  private readonly nTurn: Noise2D;
  private readonly nCedar: Noise2D;
  private readonly temples = new Map<number, Temple | null>();
  private readonly tunnels = new Map<number, Tunnel | null>();
  private readonly bridges = new Map<number, Bridge | null>();
  private ready = false;

  constructor(seed: number) {
    this.seed = seed;
    this.nRiver = createNoise2D(seed + 501);
    this.nWidth = createNoise2D(seed + 502);
    this.nHills = createNoise2D(seed + 503);
    this.nMount = createNoise2D(seed + 504);
    this.nRange = createNoise2D(seed + 505);
    this.nValley = createNoise2D(seed + 506);
    this.nForest = createNoise2D(seed + 507);
    this.nVillage = createNoise2D(seed + 508);
    this.nTurn = createNoise2D(seed + 509);
    this.nCedar = createNoise2D(seed + 510);
    this.plan();
    this.ready = true;
  }

  // --- River and lake --------------------------------------------------------------------------

  private riverNoise(x: number, z: number): number {
    const f = Config.maple.riverScale;
    return fbm(this.nRiver, x * f, z * f, 2);
  }

  /**
   * Signed distance (m) from (x, z) to the nearest river bank, negative in the water (|n| /
   * |grad n| to the noise's zero contour, as Jade River's). Leaves the noise, its gradient, the
   * centre-line distance and the half width in rv, rgx/rgz, rd and rw.
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
    const K = Config.maple;
    this.rw =
      K.riverMin + (K.riverMax - K.riverMin) * (0.5 + 0.5 * this.nWidth(x * 7e-4, z * 7e-4));
    return this.rd - this.rw;
  }

  /** Along the river at (x, z), the way closer to `yaw`. Uses river() scratch. */
  riverHeading(x: number, z: number, yaw: number): number {
    this.river(x, z);
    const a = Math.atan2(-this.rgz, this.rgx);
    return Math.sin(a) * Math.sin(yaw) + Math.cos(a) * Math.cos(yaw) >= 0 ? a : a + Math.PI;
  }

  /** One Newton step from (x, z) toward the river's centre line, into `out`. */
  toCentre(x: number, z: number, out: { x: number; z: number }): void {
    this.river(x, z);
    const g2 = Math.max(this.rgx * this.rgx + this.rgz * this.rgz, 1e-12);
    out.x = x - (this.rv * this.rgx) / g2;
    out.z = z - (this.rv * this.rgz) / g2;
  }

  /** Signed distance (m) to the home lake's shore, negative on the water (first order). */
  lakeEdge(x: number, z: number): number {
    const L = this.lake;
    const dx = x - L.x;
    const dz = z - L.z;
    const R = L.r;
    if (R <= 0) return Infinity;
    const d = Math.hypot(dx, dz);
    if (d > R * 2.2) return d - R * 1.6;
    const a = (dx * L.ux + dz * L.uz) / (R * 1.3);
    const b = (dx * L.uz - dz * L.ux) / R;
    const th = Math.atan2(b, a);
    const f = 1 + 0.12 * Math.sin(2 * th + 1.3) + 0.07 * Math.sin(3 * th + 0.4);
    const e = (Math.hypot(a, b) - f) * R;
    // The island is land: its shore is water's edge too.
    const I = this.island;
    return I.r > 0 ? Math.max(e, I.r * 0.85 - Math.hypot(x - I.x, z - I.z)) : e;
  }

  /** Signed distance to the nearest open water (river or lake). Leaves the river scratch. */
  water(x: number, z: number): number {
    return Math.min(this.river(x, z), this.lakeEdge(x, z));
  }

  // --- Ground ----------------------------------------------------------------------------------

  /**
   * The land before temples and tunnels cut into it: a valley floor beside the water, and
   * wooded mountains rising beyond it (rounded, of varied heights; never a wall). Leaves how
   * far up the slopes the point is in `rise`, and the river scratch.
   */
  base(x: number, z: number): number {
    const K = Config.maple;
    const w = this.water(x, z);
    const hills = fbm(this.nHills, x * 0.004, z * 0.004, 2);
    const floor = 2.2 + hills * 1.3 + smoothstep(8, 70, w) * 1.6;
    const valley = K.valley * (1.1 + 0.4 * this.nValley(x * 6e-4, z * 6e-4));
    const rise = smoothstep(22, valley, w);
    this.rise = rise;
    const m = smoothstep(
      -0.55,
      0.75,
      fbm(this.nMount, x * K.mountainScale, z * K.mountainScale, 4),
    );
    const range = 0.35 + 0.65 * smoothstep(-0.6, 0.6, this.nRange(x * 4e-4, z * 4e-4));
    const y = floor + K.mountain * range * (0.18 + 0.82 * m) * rise;
    let g = lerp(-3.4 + hills * 0.5, y, smoothstep(-7, 9, w));
    // The pavilion's island: a low, level table with a shore round it.
    const I = this.island;
    if (I.r > 0) {
      const d = Math.hypot(x - I.x, z - I.z);
      if (d < I.r * 1.3) g = lerp(I.y, Math.min(g, -1.5), smoothstep(I.r * 0.75, I.r * 1.3, d));
    }
    return g;
  }

  /** The land with the temples' pads levelled into it (tunnels are planned on this). */
  private padded(x: number, z: number): number {
    let y = this.base(x, z);
    if (!this.ready) return y;
    const pad = Config.maple.templePad;
    const C = Config.maple.templeCell;
    for (let j = Math.floor((z - 120) / C); j <= Math.floor((z + 120) / C); j++)
      for (let i = Math.floor((x - 120) / C); i <= Math.floor((x + 120) / C); i++) {
        const t = this.temple(i, j);
        if (t) y = this.levelPad(t, x, z, y, pad);
      }
    const h = this.home;
    if (h) y = this.levelPad(h, x, z, y, pad);
    return y;
  }

  private levelPad(t: Temple, x: number, z: number, y: number, pad: number): number {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d > pad * 1.9) return y;
    return lerp(y, t.y, 1 - smoothstep(pad, pad * 1.9, d));
  }

  /** Terrain: the land, the temples' pads, and the tunnels' benches and shrine terraces. */
  height(x: number, z: number): number {
    let y = this.padded(x, z);
    if (!this.ready) return y;
    if (this.tunnelAt(x, z) < 15) {
      // The bench: level across the path, blending back into the slope.
      y = lerp(y, this.tunnelY, 1 - smoothstep(6, 15, this.tunnelD));
    }
    return y;
  }

  /** 0..1: the farmland with houses on the valley floor. Uses the river scratch and `rise`. */
  village(x: number, z: number, w: number, rise: number): number {
    return (
      smoothstep(0.2, 0.36, fbm(this.nVillage, x * 0.0026, z * 0.0026, 2)) *
      smoothstep(16, 30, w) *
      (1 - smoothstep(0.08, 0.3, rise)) *
      smoothstep(60, 120, this.lakeEdge(x, z))
    );
  }

  /** Scratch of `land()`. */
  lBase = 0;
  lWater = 0;
  lRise = 0;
  lForest = 0;
  lVillage = 0;
  lPath = 0;
  lTurn = 0;
  lCedar = 0;
  lPad = 0;

  /**
   * Everything the ground's colour, the trees and the cover need at (x, z) in one pass: the
   * land, water distance, rise, forest, village, path distance, the autumn's turn (0 crimson ..
   * 1 gold) and the cedars' share, in the l* fields.
   */
  land(x: number, z: number): void {
    this.lBase = this.base(x, z);
    const w = Math.min(this.rd - this.rw, this.lakeEdge(x, z));
    const rise = this.rise;
    this.lWater = w;
    this.lRise = rise;
    this.lPath = this.pathDist(x, z, w);
    // No farm where a tunnel's path starts (its foot stays open to fly in along).
    const v =
      this.village(x, z, w, rise) * (this.tunnelD < 30 ? smoothstep(8, 30, this.tunnelD) : 1);
    this.lVillage = v;
    this.lPad = this.onPad(x, z);
    const f = fbm(this.nForest, x * 0.004, z * 0.004, 3);
    // The valley floor is meadow, farm and copse; the slopes are wooded almost unbroken.
    const valley = smoothstep(-0.25, 0.3, f) * smoothstep(10, 30, w);
    const slope = smoothstep(0.15, 0.5, rise) * smoothstep(-0.75, -0.45, f);
    let forest = Math.max(valley, slope) * (1 - v) * (1 - this.lPad);
    forest *= smoothstep(6, 16, this.lPath);
    if (this.island.r > 0 && Math.hypot(x - this.island.x, z - this.island.z) < this.island.r)
      forest = 0;
    this.lForest = forest;
    this.lTurn = 0.5 + 0.5 * fbm(this.nTurn, x * 0.0016, z * 0.0016, 2);
    // Dark cedars take the high ground and the odd steep grove; maples keep the rest.
    this.lCedar = clamp(
      smoothstep(70, 150, this.lBase) * 0.75 +
        smoothstep(0.35, 0.65, this.nCedar(x * 0.003, z * 0.003)) * 0.6,
      0,
      0.9,
    );
  }

  /** Soft canopy over the forest and the villages' roofs: the bird skims the treetops. */
  canopy(x: number, z: number): number {
    this.land(x, z);
    const K = Config.maple;
    return Math.max(
      smoothstep(0.35, 0.75, this.lForest) * K.canopy,
      smoothstep(0.25, 0.6, this.lVillage) * K.roofs,
    );
  }

  /** Metres from (x, z) to the nearest road or path: by the river, round the lake, up a tunnel. */
  pathDist(x: number, z: number, w: number): number {
    const K = Config.maple;
    let d = Math.abs(this.rd - this.rw - K.road);
    // The shore path round the lake (none on the river's way through it).
    const le = this.lakeEdge(x, z);
    if (le < 30) d = Math.min(d, Math.abs(le - 7));
    if (w < -2) d = Math.max(d, 4);
    if (this.ready && this.tunnelAt(x, z) < d) d = this.tunnelD;
    return d;
  }

  /** 0..1: on a temple's pad or a shrine's terrace (no forest; the cover is raked gravel). */
  onPad(x: number, z: number): number {
    if (!this.ready) return 0;
    const pad = Config.maple.templePad;
    let best = 0;
    const C = Config.maple.templeCell;
    for (let j = Math.floor((z - 80) / C); j <= Math.floor((z + 80) / C); j++)
      for (let i = Math.floor((x - 80) / C); i <= Math.floor((x + 80) / C); i++) {
        const t = this.temple(i, j);
        if (t)
          best = Math.max(
            best,
            1 - smoothstep(pad * 0.85, pad * 1.25, Math.hypot(x - t.x, z - t.z)),
          );
      }
    const h = this.home;
    if (h)
      best = Math.max(best, 1 - smoothstep(pad * 0.85, pad * 1.25, Math.hypot(x - h.x, z - h.z)));
    return best;
  }

  // --- The plan round the spawn ----------------------------------------------------------------

  /**
   * The spawn on the river nearest the origin, the lake on the river ahead of it, the gate in
   * the lake on the way in, the island beside the river's line, and the home temple on the far
   * shore. The opening run is walked down the river through all of it.
   */
  private plan(): void {
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
    const K = Config.maple;
    this.spawn.x = bx;
    this.spawn.z = bz;
    this.spawn.yaw = this.riverHeading(bx, bz, 0);
    // Walk down the river: the gate at 0.7 lake-lengths before the centre, the lake beyond.
    const R = K.lakeRadius;
    const gateAt = Math.round((K.lakeAhead - R * 1.3 * 0.72) / 10) * 10;
    let x = bx;
    let z = bz;
    let h = this.spawn.yaw;
    const run = this.opening;
    for (let d = 0; d <= K.lakeAhead + R * 1.6; d += 10) {
      if (d > 0) {
        h = this.riverHeading(x, z, h);
        x += Math.sin(h) * 10;
        z += Math.cos(h) * 10;
        this.toCentre(x, z, c);
        x += clamp(c.x - x, -5, 5) * 0.5;
        z += clamp(c.z - z, -5, 5) * 0.5;
      }
      run.push(x, z, h);
      if (d === gateAt) {
        const G = this.gate;
        G.x = x;
        G.z = z;
        G.yaw = h;
        G.ux = Math.sin(h);
        G.uz = Math.cos(h);
      }
      if (d === K.lakeAhead) {
        this.lake.x = x;
        this.lake.z = z;
        this.lake.ux = Math.sin(h);
        this.lake.uz = Math.cos(h);
      }
    }
    // The lake's axis: from the gate to the centre, so the way in is straight through it.
    const Lk = this.lake;
    const ax = Lk.x - this.gate.x;
    const az = Lk.z - this.gate.z;
    const al = Math.hypot(ax, az) || 1;
    Lk.ux = ax / al;
    Lk.uz = az / al;
    Lk.r = R;
    this.gate.ux = Lk.ux;
    this.gate.uz = Lk.uz;
    this.gate.yaw = Math.atan2(Lk.ux, Lk.uz);
    // The island off to one side of the way across.
    const side = hash2(3, 7, this.seed + 520) < 0.5 ? 1 : -1;
    const I = this.island;
    I.r = K.islandRadius;
    I.x = Lk.x + Lk.uz * side * R * 0.45;
    I.z = Lk.z - Lk.ux * side * R * 0.45;
    const P = this.pavilion;
    P.x = I.x;
    P.z = I.z;
    P.y = I.y;
    P.yaw = Math.atan2(this.spawn.x - I.x, this.spawn.z - I.z);
    P.top = I.y + PAVILION.h;
    this.homeSolids.push(cylinder(P.x, P.z, PAVILION.r, -1, P.top));
    // The gate: two posts in the water and the beams across them.
    const G = this.gate;
    const W = WATER_GATE;
    for (const s of [-1, 1])
      this.homeSolids.push(
        cylinder(G.x + G.uz * s * W.half, G.z - G.ux * s * W.half, W.post, -4, W.top),
      );
    this.homeSolids.push(box(G.x, G.z, G.uz, -G.ux, W.half + W.over, 1.2, W.under, W.top));
    // The home temple on the far shore from the island, looking across the water.
    const home = this.homeTemple(-side);
    if (home) {
      this.home = home;
      this.homeSolids.push(...home.solids);
    }
  }

  private homeTemple(side: number): Temple | null {
    const Lk = this.lake;
    const R = Lk.r;
    // Across the water from the island first, then the island's side; along the shore both ways.
    for (const sd of [side, -side])
      for (let k = 0; k < 12; k++) {
        const along = (0.1 + 0.16 * (k >> 1)) * (k % 2 ? 1 : -1) * R;
        const x = Lk.x + Lk.uz * sd * R * 1.25 + Lk.ux * along;
        const z = Lk.z - Lk.ux * sd * R * 1.25 + Lk.uz * along;
        const t = this.siteTemple(x, z, hash2(k, 11, this.seed + 521), true);
        if (t && this.lakeEdge(t.x, t.z) > 30 && !this.nearOpening(t.x, t.z, 90)) return t;
      }
    return null;
  }

  /**
   * A temple near (x, z): moved to the foot of the slopes (50-130 m from the water), on ground
   * level enough to pad, its hall facing the water and its pagoda beside it. Null if none fits.
   */
  private siteTemple(x: number, z: number, seed: number, home: boolean): Temple | null {
    const e = 4;
    for (let it = 0; it < 6; it++) {
      const w = this.water(x, z);
      const gx = (this.water(x + e, z) - w) / e;
      const gz = (this.water(x, z + e) - w) / e;
      const g = Math.hypot(gx, gz) || 1;
      const move = clamp(75 - w, -120, 120);
      x += (gx / g) * move;
      z += (gz / g) * move;
    }
    const w = this.water(x, z);
    if (w < 45 || w > 130) return null;
    const y = this.base(x, z);
    if (y < 3) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (let a = 0; a < 8; a++) {
      const h = this.base(x + Math.sin(a * 0.785) * 30, z + Math.cos(a * 0.785) * 30);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (hi - lo > (home ? 40 : 20)) return null;
    // Face the water: down the water distance's slope.
    const gx = this.water(x + e, z) - this.water(x - e, z);
    const gz = this.water(x, z + e) - this.water(x, z - e);
    const yaw = Math.atan2(-gx, -gz);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const side = seed < 0.5 ? 1 : -1;
    const px = x + fz * side * 17 + fx * 5;
    const pz = z - fx * side * 17 + fz * 5;
    const top = y + PAGODA_HEIGHT;
    return {
      x,
      z,
      y,
      yaw,
      px,
      pz,
      top,
      solids: [cylinder(px, pz, PAGODA_R, y - 1, top)],
      home,
      seed,
    };
  }

  // --- Temples, tunnels and bridges on their grids ---------------------------------------------

  /** The temple of temple cell (i, j), or null. Cached; pure. */
  temple(i: number, j: number): Temple | null {
    const k = key(i, j);
    const hit = this.temples.get(k);
    if (hit !== undefined) return hit;
    if (this.temples.size > CELL_CACHE) this.temples.clear();
    const t = this.findTemple(i, j);
    this.temples.set(k, t);
    return t;
  }

  private findTemple(i: number, j: number): Temple | null {
    const K = Config.maple;
    const C = K.templeCell;
    const s = this.seed;
    if (hash2(i + 401, j - 223, s + 530) > K.templeChance) return null;
    const x = (i + 0.25 + 0.5 * hash2(i, j, s + 531)) * C;
    const z = (j + 0.25 + 0.5 * hash2(i, j, s + 532)) * C;
    const t = this.siteTemple(x, z, hash2(i, j, s + 533), false);
    if (!t) return null;
    // Keep the opening and the lake to themselves, and the temple inside its own cell.
    if (this.nearOpening(t.x, t.z, 160) || this.lakeEdge(t.x, t.z) < 140) return null;
    if (t.x < i * C || t.x >= (i + 1) * C || t.z < j * C || t.z >= (j + 1) * C) return null;
    const h = this.home;
    if (h && Math.hypot(t.x - h.x, t.z - h.z) < 300) return null;
    return t;
  }

  /** Is (x, z) within `r` of the opening run (spawn, gate, lake crossing)? */
  nearOpening(x: number, z: number, r: number): boolean {
    const O = this.opening;
    for (let k = 0; k < O.length; k += 3)
      if ((O[k] - x) ** 2 + (O[k + 1] - z) ** 2 < r * r) return true;
    return false;
  }

  /** The tunnel of gate cell (i, j), or null. Cached; pure. */
  tunnel(i: number, j: number): Tunnel | null {
    const k = key(i, j);
    const hit = this.tunnels.get(k);
    if (hit !== undefined) return hit;
    if (this.tunnels.size > CELL_CACHE) this.tunnels.clear();
    const t = this.findTunnel(i, j);
    this.tunnels.set(k, t);
    return t;
  }

  /**
   * A tunnel of gates up a mountainside: from the foot of the slopes it climbs at most
   * gateGrade, turning across the slope as it steepens (always to the same side, gently, so the
   * way up curves but never zigzags), a gate every gateSpacing m, to a shrine where the slope
   * eases or the gates run out. Kept inside its cell, off the opening, the lake and the
   * temples' pads.
   */
  private findTunnel(i: number, j: number): Tunnel | null {
    const K = Config.maple;
    const C = K.gateCell;
    const s = this.seed;
    if (hash2(i - 91, j + 57, s + 540) > K.gateChance) return null;
    let x = (i + 0.3 + 0.4 * hash2(i, j, s + 541)) * C;
    let z = (j + 0.3 + 0.4 * hash2(i, j, s + 542)) * C;
    const e = 4;
    for (let it = 0; it < 6; it++) {
      const w = this.water(x, z);
      const gx = (this.water(x + e, z) - w) / e;
      const gz = (this.water(x, z + e) - w) / e;
      const g = Math.hypot(gx, gz) || 1;
      const move = clamp(55 - w, -150, 150);
      x += (gx / g) * move;
      z += (gz / g) * move;
    }
    const w = this.water(x, z);
    if (Math.abs(w - 55) > 15) return null;
    const inCell = (px: number, pz: number) =>
      px > i * C + 30 && px < (i + 1) * C - 30 && pz > j * C + 30 && pz < (j + 1) * C - 30;
    if (!inCell(x, z)) return null;
    if (this.nearOpening(x, z, 260) || this.lakeEdge(x, z) < 160) return null;
    const side = hash2(i, j, s + 543) < 0.5 ? 1 : -1;
    const gates: number[] = [];
    const step = 2;
    let heading = NaN;
    let along = K.gateSpacing; // a gate at the very foot
    for (let k = 0; k < (K.gateMax * K.gateSpacing) / step; k++) {
      const y = this.padded(x, z);
      const n = gates.length / 4;
      if (Number.isNaN(heading)) {
        // The first heading: up the slope, turned across it until it climbs at the grade.
        const gx = (this.padded(x + 3, z) - this.padded(x - 3, z)) / 6;
        const gz = (this.padded(x, z + 3) - this.padded(x, z - 3)) / 6;
        const sl = Math.hypot(gx, gz);
        heading = Math.atan2(gx, gz) + side * (sl > K.gateGrade ? Math.acos(K.gateGrade / sl) : 0);
      } else {
        // Each step: of a few gentle turns, the one whose climb comes nearest the grade (the
        // actual climb, so a slope that steepens round a bend is met by turning across it).
        let best = heading;
        let bd = Infinity;
        for (let t = -2; t <= 2; t++) {
          const h = heading + t * 0.03;
          const rise = (this.padded(x + Math.sin(h) * step, z + Math.cos(h) * step) - y) / step;
          const d = Math.abs(rise - K.gateGrade) + Math.abs(t) * 0.004;
          if (d < bd) {
            bd = d;
            best = h;
          }
        }
        heading = best;
        // The slope eases off (a summit) or turns too steep to hold: the shrine goes here.
        if (bd > K.gateGrade * 0.6 && n >= K.gateMin) break;
        if (bd > K.gateGrade * 0.9) break;
      }
      if (along >= K.gateSpacing) {
        along -= K.gateSpacing;
        gates.push(x, y, z, heading);
        if (gates.length / 4 >= K.gateMax) break;
      }
      x += Math.sin(heading) * step;
      z += Math.cos(heading) * step;
      along += step;
      if (!inCell(x, z) || this.water(x, z) < 30 || this.onPad(x, z) > 0) break;
    }
    const n = gates.length / 4;
    if (n < K.gateMin) return null;
    // The lead-in stays in the cell and on dry land.
    const ix = gates[0] - Math.sin(gates[3]) * LEAD_IN;
    const iz = gates[2] - Math.cos(gates[3]) * LEAD_IN;
    if (!inCell(ix, iz) || this.water(ix, iz) < 14) return null;
    // The climb must actually climb (a level walk along a shelf is no tunnel up a mountain).
    if (gates[(n - 1) * 4 + 1] - gates[1] < n * K.gateSpacing * K.gateGrade * 0.45) return null;
    const last = (n - 1) * 4;
    const sy0 = gates[last + 3];
    const sx = gates[last] + Math.sin(sy0) * 11;
    const sz = gates[last + 2] + Math.cos(sy0) * 11;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    const lx = gates[0] - Math.sin(gates[3]) * LEAD_IN;
    const lz = gates[2] - Math.cos(gates[3]) * LEAD_IN;
    x0 = Math.min(x0, lx);
    x1 = Math.max(x1, lx);
    z0 = Math.min(z0, lz);
    z1 = Math.max(z1, lz);
    for (let k = 0; k < gates.length; k += 4) {
      x0 = Math.min(x0, gates[k]);
      x1 = Math.max(x1, gates[k]);
      z0 = Math.min(z0, gates[k + 2]);
      z1 = Math.max(z1, gates[k + 2]);
    }
    const pad = 30;
    return {
      gates: Float64Array.from(gates),
      n,
      sx,
      sy: gates[last + 1] + 0.3,
      sz,
      syaw: sy0,
      x0: Math.min(x0, sx) - pad,
      z0: Math.min(z0, sz) - pad,
      x1: Math.max(x1, sx) + pad,
      z1: Math.max(z1, sz) + pad,
      seed: hash2(i, j, s + 544),
    };
  }

  /** Scratch of `tunnelAt`: distance to the path, the bench's height there, and the tunnel. */
  tunnelD = Infinity;
  tunnelY = 0;
  tunnelT: Tunnel | null = null;
  /** Fraction along the tunnel (0 foot .. 1 the last gate) of the nearest point. */
  tunnelU = 0;

  /**
   * Distance (m) from (x, z) to the nearest tunnel's path (its gates' polyline and the shrine's
   * terrace, a disc), or Infinity; the bench's height and the tunnel go in the scratch.
   */
  tunnelAt(x: number, z: number): number {
    this.tunnelD = Infinity;
    this.tunnelT = null;
    const C = Config.maple.gateCell;
    const i = Math.floor(x / C);
    const j = Math.floor(z / C);
    // A tunnel stays inside its cell, so only this cell's can be near.
    const t = this.tunnel(i, j);
    if (!t || x < t.x0 || x > t.x1 || z < t.z0 || z > t.z1) return Infinity;
    const G = t.gates;
    let best = Infinity;
    let by = 0;
    let bu = 0;
    for (let k = 0; k + 4 < G.length; k += 4) {
      const ax = G[k];
      const az = G[k + 2];
      const dx = G[k + 4] - ax;
      const dz = G[k + 6] - az;
      const l2 = dx * dx + dz * dz || 1;
      const f = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const d = Math.hypot(x - ax - dx * f, z - az - dz * f);
      if (d < best) {
        best = d;
        by = lerp(G[k + 1], G[k + 5], f);
        bu = (k / 4 + f) / (t.n - 1);
      }
    }
    // The lead-in: the path comes up to the first gate along its line, open for the bird.
    {
      const lx = G[0] - Math.sin(G[3]) * LEAD_IN;
      const lz = G[2] - Math.cos(G[3]) * LEAD_IN;
      const dx = G[0] - lx;
      const dz = G[2] - lz;
      const f = clamp(((x - lx) * dx + (z - lz) * dz) / (dx * dx + dz * dz), 0, 1);
      const d = Math.hypot(x - lx - dx * f, z - lz - dz * f);
      if (d < best) {
        best = d;
        by = G[1];
        bu = 0;
      }
    }
    // The shrine's terrace (and the last stretch of path up to it).
    const last = (t.n - 1) * 4;
    const ds = Math.max(0, Math.hypot(x - t.sx, z - t.sz) - 7);
    if (ds < best) {
      best = ds;
      by = t.sy;
      bu = 1;
    }
    const lx = G[last];
    const lz = G[last + 2];
    const dx = t.sx - lx;
    const dz = t.sz - lz;
    const f = clamp(((x - lx) * dx + (z - lz) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const dl = Math.hypot(x - lx - dx * f, z - lz - dz * f);
    if (dl < best) {
      best = dl;
      by = lerp(G[last + 1], t.sy, f);
      bu = 1;
    }
    this.tunnelD = best;
    this.tunnelY = by;
    this.tunnelT = t;
    this.tunnelU = bu;
    return best;
  }

  /**
   * Is (x, y, z) within `margin` of a tunnel's gates (between and round their posts, up to
   * their beams)? The gates are soft, but the generic ribbons keep clear of them.
   */
  inGates(x: number, y: number, z: number, margin: number): boolean {
    const K = Config.maple;
    if (this.tunnelAt(x, z) > K.gateHalf + 2 + margin) return false;
    return y < this.tunnelY + K.gateHeight + margin;
  }

  /** The bridge of bridge cell (i, j), or null: across a narrow reach, off the opening. */
  bridgeIn(i: number, j: number): Bridge | null {
    const k = key(i, j);
    const hit = this.bridges.get(k);
    if (hit !== undefined) return hit;
    const b = this.findBridge(i, j);
    this.bridges.set(k, b);
    return b;
  }

  private findBridge(i: number, j: number): Bridge | null {
    const K = Config.maple;
    const C = K.bridgeCell;
    if (hash2(i + 17, j - 3, this.seed + 550) > K.bridgeChance) return null;
    let x = (i + 0.5) * C;
    let z = (j + 0.5) * C;
    const c = { x: 0, z: 0 };
    for (let it = 0; it < 10; it++) {
      this.toCentre(x, z, c);
      x += clamp(c.x - x, -150, 150);
      z += clamp(c.z - z, -150, 150);
    }
    if (x < i * C || x >= (i + 1) * C || z < j * C || z >= (j + 1) * C) return null;
    this.river(x, z);
    const rw = this.rw;
    if (this.rd > 2 || rw > K.bridgeMaxHalf) return null;
    if (this.nearOpening(x, z, 200) || this.lakeEdge(x, z) < 120) return null;
    const g = Math.hypot(this.rgx, this.rgz);
    const ux = this.rgx / g;
    const uz = this.rgz / g;
    const half = rw + 12;
    const ends = Math.max(
      this.base(x + ux * half, z + uz * half),
      this.base(x - ux * half, z - uz * half),
      1,
    );
    if (ends > 6) return null;
    return {
      x,
      z,
      ux,
      uz,
      yaw: Math.atan2(ux, uz),
      half,
      crown: Math.max(K.bridgeRise, ends + 3),
      ends,
      width: K.bridgeWidth / 2,
    };
  }

  /** The nearest bridge whose span may reach (x, z), or null. */
  bridgeNear(x: number, z: number): Bridge | null {
    const K = Config.maple;
    const C = K.bridgeCell;
    const R = K.riverMax + 12 + K.bridgeEase;
    let best: Bridge | null = null;
    let bd = Infinity;
    for (let j = Math.floor((z - R) / C); j <= Math.floor((z + R) / C); j++)
      for (let i = Math.floor((x - R) / C); i <= Math.floor((x + R) / C); i++) {
        const b = this.bridgeIn(i, j);
        if (!b) continue;
        const d = Math.hypot(x - b.x, z - b.z);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
    return best;
  }

  /** Flight floor over a bridge, eased up and down along the river (as Jade River's). */
  bridgeTop(x: number, z: number): number {
    const b = this.bridgeNear(x, z);
    if (!b) return -Infinity;
    const dx = x - b.x;
    const dz = z - b.z;
    const a = (dx * b.ux + dz * b.uz) / b.half;
    if (a <= -1 || a >= 1) return -Infinity;
    const c = Math.abs(dx * b.uz - dz * b.ux);
    const ease = Config.maple.bridgeEase;
    if (c > b.width + ease) return -Infinity;
    const top = deckY(b, a) + 1.3;
    return top - (top + 4) * (1 - smoothstep(b.width + ease, b.width, c));
  }

  // --- Roofs -----------------------------------------------------------------------------------

  /**
   * Soft roofs: a temple's hall and a shrine (the bird glides over them as over the canopy),
   * eased in over a few metres round the footprint. Absolute height, or -Infinity.
   */
  roofAt(x: number, z: number): number {
    let best = -Infinity;
    const C = Config.maple.templeCell;
    for (let j = Math.floor((z - 40) / C); j <= Math.floor((z + 40) / C); j++)
      for (let i = Math.floor((x - 40) / C); i <= Math.floor((x + 40) / C); i++) {
        const t = this.temple(i, j);
        if (t) best = Math.max(best, footprint(t.x, t.z, t.yaw, HALL, t.y, x, z));
      }
    if (this.home)
      best = Math.max(
        best,
        footprint(this.home.x, this.home.z, this.home.yaw, HALL, this.home.y, x, z),
      );
    if (this.tunnelAt(x, z) < 12 && this.tunnelT) {
      const t = this.tunnelT;
      best = Math.max(best, footprint(t.sx, t.sz, t.syaw, SHRINE, t.sy, x, z));
    }
    return best;
  }

  // --- Solids ----------------------------------------------------------------------------------

  /** Calls `fn` for every solid that could reach (x, z) within `pad`; stops when it returns true. */
  private near(x: number, z: number, pad: number, fn: (s: Solid) => boolean): void {
    const H = this.homeSolids;
    for (let k = 0; k < H.length; k++) {
      const s = H[k];
      const R = s.reach + pad;
      if ((x - s.x) ** 2 + (z - s.z) ** 2 <= R * R && fn(s)) return;
    }
    const C = Config.maple.templeCell;
    const R = 60 + pad;
    for (let j = Math.floor((z - R) / C); j <= Math.floor((z + R) / C); j++)
      for (let i = Math.floor((x - R) / C); i <= Math.floor((x + R) / C); i++) {
        const t = this.temple(i, j);
        if (!t) continue;
        for (let k = 0; k < t.solids.length; k++) {
          const s = t.solids[k];
          const r2 = s.reach + pad;
          if ((x - s.x) ** 2 + (z - s.z) ** 2 <= r2 * r2 && fn(s)) return;
        }
      }
  }

  private qx = 0;
  private qy = 0;
  private qz = 0;
  private qm = 0;
  private qr = -Infinity;
  private qs: Solid | null = null;

  private readonly solidFn = (s: Solid): boolean => {
    const m = this.qm;
    if (this.qy < s.y0 - m || this.qy > s.y1 + m) return false;
    const dx = this.qx - s.x;
    const dz = this.qz - s.z;
    if (s.box) {
      if (Math.abs(dx * s.ux + dz * s.uz) > s.ha + m) return false;
      if (Math.abs(dx * s.uz - dz * s.ux) > s.hb + m) return false;
    } else if (dx * dx + dz * dz > (s.r + m) ** 2) return false;
    const H = this.hit;
    H[0] = s.x - s.reach;
    H[1] = s.y0;
    H[2] = s.z - s.reach;
    H[3] = s.x + s.reach;
    H[4] = s.y1;
    H[5] = s.z + s.reach;
    this.qr = s.y1;
    this.qs = s;
    return true;
  };

  /**
   * Top of the first solid containing the point grown by `margin`, or -Infinity. Its bounds go
   * in `hit` (the city's contract, so the look-ahead and glance are shared; a beam's underside
   * is its y0, which the look-ahead eases under).
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    this.qx = x;
    this.qy = y;
    this.qz = z;
    this.qm = margin;
    this.qr = -Infinity;
    this.qs = null;
    this.near(x, z, margin, this.solidFn);
    return this.qr;
  }

  /**
   * Push a point out of the solids (grown by margin) the shortest way: sideways off a post, a
   * pagoda's eaves or a beam's face, up onto a top, or down under a beam. Returns the distance
   * moved; the normal goes in `n`. Every branch moves a finite amount (or none).
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let total = 0;
    for (let iter = 0; iter < 2; iter++) {
      if (this.solidTop(p.x, p.y, p.z, margin) === -Infinity) break;
      const s = this.qs!;
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      let sx: number;
      let sz: number;
      let side: number;
      if (s.box) {
        const a = dx * s.ux + dz * s.uz;
        const b = dx * s.uz - dz * s.ux;
        const ea = s.ha + margin - Math.abs(a);
        const eb = s.hb + margin - Math.abs(b);
        if (ea < eb) {
          side = ea;
          const sg = a >= 0 ? 1 : -1;
          sx = s.ux * sg;
          sz = s.uz * sg;
        } else {
          side = eb;
          const sg = b >= 0 ? 1 : -1;
          sx = s.uz * sg;
          sz = -s.ux * sg;
        }
      } else {
        let d = Math.hypot(dx, dz);
        sx = dx;
        sz = dz;
        if (d < 1e-3) {
          sx = 1;
          sz = 0;
          d = 1;
        }
        sx /= d;
        sz /= d;
        side = s.r + margin - d;
      }
      const up = s.y1 + margin - p.y;
      // Down only from under a raised beam (never through the ground under a post).
      const down = s.box && s.y0 > 2 ? p.y - (s.y0 - margin) : Infinity;
      if (up <= side && up <= down) {
        if (up <= 0) break;
        n.x = n.z = 0;
        n.y = 1;
        p.y += up;
        total += up;
      } else if (down < side) {
        if (down <= 0) break;
        n.x = n.z = 0;
        n.y = -1;
        p.y -= down;
        total += down;
      } else {
        if (side <= 0) break;
        n.y = 0;
        n.x = sx;
        n.z = sz;
        p.x += sx * side;
        p.z += sz * side;
        total += side;
      }
    }
    return total;
  }

  private best = -Infinity;
  private readonly skyFn = (s: Solid): boolean => {
    if (s.y1 > this.best) this.best = s.y1;
    return false;
  };

  /** Highest solid top within `r` of (x, z), or -Infinity. */
  skyline(x: number, z: number, r: number): number {
    this.best = -Infinity;
    this.near(x, z, r, this.skyFn);
    return this.best;
  }

  /** The nearest temple (home included) within `r` of (x, z), or null. */
  nearestTemple(x: number, z: number, r: number): Temple | null {
    let best: Temple | null = null;
    let bd = r;
    const C = Config.maple.templeCell;
    for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++)
      for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) {
        const t = this.temple(i, j);
        if (!t) continue;
        const d = Math.hypot(x - t.px, z - t.pz);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
    const h = this.home;
    if (h && Math.hypot(x - h.px, z - h.pz) < bd) best = h;
    return best;
  }

  /** The nearest tunnel whose foot is within `r` of (x, z), or null. */
  nearestTunnel(x: number, z: number, r: number): Tunnel | null {
    let best: Tunnel | null = null;
    let bd = r;
    const C = Config.maple.gateCell;
    for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++)
      for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) {
        const t = this.tunnel(i, j);
        if (!t) continue;
        const d = Math.hypot(x - t.gates[0], z - t.gates[2]);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
    return best;
  }

  /** Terrain plus the soft canopy, roofs and bridge decks: the floor the bird glides over. */
  flightGround(x: number, z: number): number {
    const h = this.height(x, z);
    const g = h < 0.5 ? h : h + this.canopy(x, z);
    return Math.max(g, this.bridgeTop(x, z), this.roofAt(x, z));
  }

  /** Planning: is the point `margin` clear of the ground, the canopy, solids and the gates? */
  clear(x: number, y: number, z: number, margin: number): boolean {
    return (
      y > Math.max(this.height(x, z), Config.world.waterLevel, this.bridgeTop(x, z)) + margin &&
      y > this.flightGround(x, z) + 3 &&
      this.solidTop(x, y, z, margin) === -Infinity &&
      !this.inGates(x, y, z, Math.min(margin, 4))
    );
  }
}

function cylinder(x: number, z: number, r: number, y0: number, y1: number): Solid {
  return { box: false, x, z, r, ux: 1, uz: 0, ha: 0, hb: 0, y0, y1, reach: r };
}

function box(
  x: number,
  z: number,
  ux: number,
  uz: number,
  ha: number,
  hb: number,
  y0: number,
  y1: number,
): Solid {
  return { box: true, x, z, r: 0, ux, uz, ha, hb, y0, y1, reach: Math.hypot(ha, hb) };
}

/**
 * Height of a soft roof over (x, z): a hipped mass `h` over the pad at the centre falling to
 * the eaves at the footprint's edge, eased to nothing a few metres beyond. -Infinity outside.
 */
function footprint(
  cx: number,
  cz: number,
  yaw: number,
  F: { a: number; b: number; h: number },
  y: number,
  x: number,
  z: number,
): number {
  const dx = x - cx;
  const dz = z - cz;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // The hall's length runs across its facing.
  const a = Math.abs(dx * fz - dz * fx) / (F.a + 4);
  const b = Math.abs(dx * fx + dz * fz) / (F.b + 4);
  const q = Math.max(a, b);
  if (q >= 1) return -Infinity;
  return y + F.h * (1 - smoothstep(0.55, 1, q)) - 4 * smoothstep(0.8, 1, q);
}
