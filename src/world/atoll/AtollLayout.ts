import { Config } from '../../core/Config';
import { angleDelta, lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, type Noise2D } from '../noise';

/**
 * Coral Atolls' plan as one pure, seeded function of position (no Three.js, unit-tested): deep
 * ocean with an atoll in most cells of a coarse grid. Each atoll is a wobbly ring of reef with
 * palm islets (motus) along it and a pass or two cut through it, round a turquoise lagoon of
 * sand flats and coral heads. Mushroom rocks stand in the lagoons; some lagoons hold a green
 * volcanic high island, and the home atoll round the spawn always does (its fang ahead of the
 * bird), with a curving pier of overwater bungalows off its shore. The renderer, collisions and
 * wisp planner all read this, so they agree on where the reef and the rock are.
 */

/** A volcanic high island: a ridged cone and a steeper fang beside it. */
export interface Island {
  x: number;
  z: number;
  /** Base radius of the cone (the coast lies a little beyond). */
  r: number;
  /** Height of the cone's summit. */
  h: number;
  /** The fang: centre, base radius and summit. */
  tx: number;
  tz: number;
  tr: number;
  th: number;
  seed: number;
}

export interface Atoll {
  x: number;
  z: number;
  /** Mean radius of the reef's centre line. */
  R: number;
  /** Half width of the reef flat. */
  w: number;
  /** The ring's wobble: amplitude (share of R) and phase of its 2nd, 3rd and 5th harmonics. */
  a2: number;
  p2: number;
  a3: number;
  p3: number;
  a5: number;
  p5: number;
  /** Angles (round the centre, atan2(dx, dz)) of the passes through the reef. */
  passes: number[];
  /** Offset into the motu noise, so every ring has its own islets. */
  motuSeed: number;
  island: Island | null;
  /** Overwater bungalows: x, z, yaw (facing away from the deck) per bungalow. */
  bungalows: number[];
  /** The pier's deck: x, z, yaw, length per straight run. */
  deck: number[];
  home: boolean;
  /** Per-atoll random in [0, 1) for decor. */
  seed: number;
  /** Horizontal reach of anything the atoll shapes, from its centre. */
  reach: number;
}

/** A mushroom rock's silhouette, in cap radii over its height. */
export interface RockShape {
  /** Height (m, before the per-rock stretch) from the base, 9 m under water, to the top. */
  H: number;
  /** Radius of the sea-worn notch at the waterline. */
  notch: number;
  /** Fraction of the height where the domed cap of jungle starts. */
  cap: number;
}

export const ROCK_SHAPES: RockShape[] = [
  { H: 28, notch: 0.62, cap: 0.44 }, // a round bun of jungle
  { H: 36, notch: 0.7, cap: 0.5 }, // tall dome
  { H: 22, notch: 0.6, cap: 0.5 }, // low hump
  { H: 30, notch: 0.5, cap: 0.42 }, // deeply undercut mushroom
];
/** Metres of every rock below the water (before the stretch): the lagoon hides its foot. */
const SUBMERGED = 9;

/**
 * Radius at fraction t of a rock's height, in cap radii: a broader foot under the water, the
 * notch the sea has worn at the waterline, swelling to the cap, then a dome. The mesh is lathed
 * from this and the collisions test against it.
 */
export function rockProfile(sh: RockShape, t: number): number {
  if (t >= 1) return 0;
  const tw = SUBMERGED / sh.H;
  let r =
    sh.notch +
    0.14 * (1 - smoothstep(tw - 0.12, tw, t)) +
    (1 - sh.notch) * smoothstep(tw + 0.04, sh.cap, t);
  if (t > sh.cap) {
    const q = (t - sh.cap) / (1 - sh.cap);
    r *= Math.sqrt(1 - q * q);
  }
  return r;
}

export interface Rock {
  x: number;
  z: number;
  /** Base, under the water. */
  y0: number;
  /** Cap radius. */
  r: number;
  /** Height from y0 to the top of the dome. */
  h: number;
  /** Vertical stretch of the unit mesh. */
  k: number;
  shape: number;
  yaw: number;
  /** Highest point anything solid reaches (the jungle on the cap). */
  top: number;
  seed: number;
}

/** Cell hash with offset coordinates: cells mirrored through the origin never match. */
const cellHash = (i: number, j: number, seed: number) => hash2(i + 7919, j + 4513, seed);
const CELL_CACHE = 6000;
/** Height of a bungalow's roof ridge above the water (soft canopy for the bird). */
export const BUNGALOW_TOP = 7.2;
/** Height of the pier deck above the water. */
export const DECK_Y = 2.1;

export class AtollLayout {
  readonly seed: number;
  readonly spawn = { x: 0, y: 12, z: 0, yaw: 0 };
  /** The last solid a query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);
  /** Scratch results of `ring()`: the nearest atoll, signed distance from its reef's centre
   *  line (negative toward the lagoon), angle round it and the ring's radius there. */
  ra: Atoll | null = null;
  rs = Infinity;
  rth = 0;
  rR = 0;
  private readonly nMotu: Noise2D;
  private readonly nFloor: Noise2D;
  private readonly nBommie: Noise2D;
  private readonly nOcean: Noise2D;
  private readonly nRock: Noise2D;
  private readonly nIsland: Noise2D;
  private readonly atolls = new Map<number, Atoll | null>();
  private readonly cells = new Map<number, Rock[]>();
  /** Atolls near the last `near()` point (at most four can reach any point). */
  private readonly nearList: Atoll[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.nMotu = createNoise2D(seed + 701);
    this.nFloor = createNoise2D(seed + 702);
    this.nBommie = createNoise2D(seed + 703);
    this.nOcean = createNoise2D(seed + 704);
    this.nRock = createNoise2D(seed + 705);
    this.nIsland = createNoise2D(seed + 706);
  }

  // --- Atolls ----------------------------------------------------------------------------------

  /** The atoll of grid cell (i, j), or null for open ocean. Cached; a pure function of the seed. */
  atoll(i: number, j: number): Atoll | null {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    const got = this.atolls.get(key);
    if (got !== undefined) return got;
    const a = this.makeAtoll(i, j);
    this.atolls.set(key, a);
    return a;
  }

  private makeAtoll(i: number, j: number): Atoll | null {
    const A = Config.atoll;
    const C = A.cell;
    const s = this.seed;
    const home = i === 0 && j === 0;
    const h = (salt: number) => cellHash(i, j, s + salt);
    let x: number;
    let z: number;
    let R: number;
    if (home) {
      x = this.spawn.x;
      z = this.spawn.z + A.homeAhead;
      R = A.homeRadius;
    } else {
      if (h(711) < 0.18) return null;
      x = (i + (h(712) - 0.5) * 0.2) * C;
      z = (j + (h(713) - 0.5) * 0.2) * C;
      R = A.radiusMin + (A.radiusMax - A.radiusMin) * h(714);
      // Keep clear of the big home ring.
      const gap = Math.hypot(x - this.spawn.x, z - this.spawn.z - A.homeAhead);
      R = Math.min(R, gap - A.homeRadius - 4 * A.reefWidth - 160);
      if (R < A.radiusMin * 0.8) return null;
    }
    const w = A.reefWidth * (home ? 1.1 : 0.85 + 0.3 * h(715));
    const a: Atoll = {
      x,
      z,
      R,
      w,
      a2: home ? 0.04 : 0.04 + 0.08 * h(716),
      p2: h(717) * 7,
      a3: home ? 0.03 : 0.02 + 0.05 * h(718),
      p3: h(719) * 7,
      a5: 0.01 + 0.025 * h(720),
      p5: h(721) * 7,
      passes: [],
      motuSeed: h(722) * 100,
      island: null,
      bungalows: [],
      deck: [],
      home,
      seed: h(723),
      reach: R * 1.2 + w + 140,
    };
    // One or two passes through the reef (the home atoll's open out ahead-right of the spawn
    // and behind it, so the first view across the lagoon meets an unbroken ring of islets).
    if (home) a.passes.push(-0.95, 2.6);
    else {
      a.passes.push(h(724) * Math.PI * 2 - Math.PI);
      if (h(725) < 0.5) a.passes.push(a.passes[0] + 2 + h(726) * 2.3);
    }
    if (home) {
      const r = A.islandRadius;
      const ix = x + 60;
      const iz = z + 200;
      a.island = {
        x: ix,
        z: iz,
        r,
        h: A.islandHeight * 0.6,
        // The fang stands on the cone's near shoulder, left of the line from the spawn.
        tx: ix + 22,
        tz: iz - 42,
        tr: 72,
        th: A.islandHeight,
        seed: h(727),
      };
    } else if (h(728) < A.islandChance) {
      const r = 85 + 50 * h(729);
      const room = Math.max(0, R - w - r * 1.35 - 40);
      const ang = h(730) * Math.PI * 2;
      const off = room * Math.sqrt(h(731));
      const ix = x + Math.sin(ang) * off;
      const iz = z + Math.cos(ang) * off;
      const hh = 55 + 65 * h(732);
      const fa = h(733) * Math.PI * 2;
      a.island = {
        x: ix,
        z: iz,
        r,
        h: hh * 0.62,
        tx: ix + Math.sin(fa) * r * 0.25,
        tz: iz + Math.cos(fa) * r * 0.25,
        tr: r * 0.42,
        th: hh,
        seed: h(734),
      };
    }
    this.planPier(a, h);
    return a;
  }

  /**
   * A curving pier of overwater bungalows: off the home island's shore toward the spawn's
   * right, elsewhere now and then off the lagoon side of an islet. Bungalows stand on both
   * sides of the deck, only where the water is deep enough for stilts.
   */
  private planPier(a: Atoll, h: (salt: number) => number): void {
    let x: number;
    let z: number;
    let yaw: number;
    if (a.home && a.island) {
      const I = a.island;
      // Toward the spawn's right (-x) and back toward it (-z), from the island's coast.
      const dx = -0.8;
      const dz = -0.6;
      x = I.x + dx * I.r * 1.2;
      z = I.z + dz * I.r * 1.2;
      yaw = Math.atan2(dx, dz);
    } else {
      if (h(740) > 0.5) return;
      // The first islet round the ring from a random angle.
      let th = h(741) * Math.PI * 2;
      let found = false;
      for (let k = 0; k < 24 && !found; k++, th += 0.26) found = this.motuAt(a, th) > 0.85;
      if (!found) return;
      const R = this.ringR(a, th) - a.w * 0.9;
      x = a.x + Math.sin(th) * R;
      z = a.z + Math.cos(th) * R;
      // Into the lagoon, along the ring a little.
      yaw = th + Math.PI + (h(742) < 0.5 ? 0.5 : -0.5);
    }
    const bend = (h(743) - 0.5) * 0.12;
    const step = 13;
    for (let k = 0; k < 14; k++) {
      const nx = x + Math.sin(yaw) * step;
      const nz = z + Math.cos(yaw) * step;
      if (this.atollY(a, nx, nz) > -1.6 && k > 1) {
        if (a.bungalows.length) break;
      }
      a.deck.push((x + nx) / 2, (z + nz) / 2, yaw, step + 0.6);
      // A bungalow either side from the third run on, where the water is deep enough.
      if (k >= 2)
        for (const side of [1, -1]) {
          const bx = nx + Math.cos(yaw) * 8.5 * side;
          const bz = nz - Math.sin(yaw) * 8.5 * side;
          // Facing away from the deck, out over the lagoon.
          if (this.atollY(a, bx, bz) < -1.6) a.bungalows.push(bx, bz, yaw + (side * Math.PI) / 2);
        }
      x = nx;
      z = nz;
      yaw += bend;
    }
  }

  /** Reef centre-line radius at angle th round the atoll. */
  ringR(a: Atoll, th: number): number {
    return (
      a.R *
      (1 +
        a.a2 * Math.sin(2 * th + a.p2) +
        a.a3 * Math.sin(3 * th + a.p3) +
        a.a5 * Math.sin(5 * th + a.p5))
    );
  }

  /** 0..1: how much a pass cuts the reef at angle th. */
  passAt(a: Atoll, th: number): number {
    let p = 0;
    const half = 34 / a.R; // ~34 m either side of the channel's middle
    for (const pa of a.passes)
      p = Math.max(p, 1 - smoothstep(half * 0.5, half, Math.abs(angleDelta(th, pa))));
    return p;
  }

  /** 0..1: how much of an islet the reef carries at angle th (none in the passes). */
  motuAt(a: Atoll, th: number): number {
    // Noise sampled round a circle, so the islets close up seamlessly; ~150 m long each.
    const k = a.R / 160;
    const n = fbm(this.nMotu, Math.sin(th) * k + a.motuSeed, Math.cos(th) * k, 2);
    // fbm sits mostly within +-0.4 of 0: a threshold of 1 - share on 0.5 + n is about right.
    const t = 1 - Config.atoll.motuShare;
    const clear = 1 - smoothstep(0, 1, this.passAt(a, th) * 3);
    return smoothstep(t - 0.05, t + 0.07, 0.5 + n) * clear;
  }

  /** Atolls whose reach covers (x, z) into `nearList`. */
  private near(x: number, z: number): Atoll[] {
    const C = Config.atoll.cell;
    const ci = Math.round(x / C);
    const cj = Math.round(z / C);
    const out = this.nearList;
    out.length = 0;
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++) {
        const a = this.atoll(i, j);
        if (!a) continue;
        const dx = x - a.x;
        const dz = z - a.z;
        if (dx * dx + dz * dz < a.reach * a.reach) out.push(a);
      }
    return out;
  }

  /**
   * The atoll nearest (x, z) by its reef and where the point lies on it: leaves the atoll, the
   * signed distance from the reef's centre line, the angle and the ring radius in ra, rs, rth
   * and rR (ra null and rs Infinity out in the open ocean). Returns rs.
   */
  ring(x: number, z: number): number {
    this.ra = null;
    this.rs = Infinity;
    for (const a of this.near(x, z)) {
      const th = Math.atan2(x - a.x, z - a.z);
      const R = this.ringR(a, th);
      const s = Math.hypot(x - a.x, z - a.z) - R;
      if (Math.abs(s) < Math.abs(this.rs)) {
        this.ra = a;
        this.rs = s;
        this.rth = th;
        this.rR = R;
      }
    }
    return this.rs;
  }

  // --- Ground ----------------------------------------------------------------------------------

  /** Open ocean floor. */
  private oceanY(x: number, z: number): number {
    return -Config.atoll.ocean + 5 * fbm(this.nOcean, x * 0.002, z * 0.002, 2);
  }

  /** 0..1 coral heads on a lagoon floor (they show dark through the clear water). */
  bommie(x: number, z: number): number {
    return smoothstep(0.35, 0.7, fbm(this.nBommie, x * 0.022, z * 0.022, 2));
  }

  /** Lagoon floor: sand in long swells with coral heads rising off it. */
  private lagoonY(x: number, z: number): number {
    const A = Config.atoll;
    return (
      -A.lagoonDepth + 1.8 * fbm(this.nFloor, x * 0.006, z * 0.006, 2) + 3.2 * this.bommie(x, z)
    );
  }

  /** One atoll's seabed, reef and islets at (x, z) (no high island). */
  private atollY(a: Atoll, x: number, z: number): number {
    const th = Math.atan2(x - a.x, z - a.z);
    const s = Math.hypot(x - a.x, z - a.z) - this.ringR(a, th);
    const W = a.w;
    // The reef flat, a hand under the water, rising to its crest on the ocean side.
    let y = -0.8 + 0.45 * smoothstep(-W, W * 0.8, s);
    // Outside: the reef wall drops steeply, then the slope eases onto the ocean floor.
    if (s > W * 0.8)
      y = lerp(y, this.oceanY(x, z), Math.pow(smoothstep(W * 0.8, W * 0.8 + 150, s), 0.55));
    // Inside: pale sand flats deepening into the lagoon.
    else if (s < -W) y = lerp(y, this.lagoonY(x, z), smoothstep(0, 110, -s - W));
    const near = 1 - smoothstep(W, W + 60, Math.abs(s));
    if (near > 0) {
      // A pass: a channel through the reef, deep enough to read blue.
      const p = this.passAt(a, th) * near;
      if (p > 0) y = lerp(y, Math.min(y, -7), p);
      // An islet: sand rising to a low crown of palms, a little toward the lagoon side.
      const m = this.motuAt(a, th);
      if (m > 0) {
        const across = 1 - smoothstep(W * 0.35, W * 0.95, Math.abs(s + W * 0.15));
        const top = Config.atoll.motu + 0.7 * fbm(this.nFloor, x * 0.03, z * 0.03, 2);
        y = lerp(y, Math.max(y, top), m * across);
      }
    }
    return y;
  }

  /** A high island's height at (x, z), or -Infinity beyond its coast. */
  islandY(I: Island, x: number, z: number): number {
    const dx = x - I.x;
    const dz = z - I.z;
    const d = Math.hypot(dx, dz);
    if (d > I.r * 1.32) return -Infinity;
    const q = d / I.r;
    const ang = Math.atan2(dx, dz);
    // Radial ridges between deep gullies, as rain carves a volcano: the valleys run straight
    // down the slopes, wandering a little round the cone.
    const warp = 1.6 * fbm(this.nIsland, Math.sin(ang) * 1.3 + I.seed * 10, Math.cos(ang) * 1.3, 2);
    const ridge = Math.pow(Math.abs(Math.sin(ang * 6 + warp + q * 1.5)), 0.6);
    const gully = 1 - 0.32 * (1 - ridge) * smoothstep(0.08, 0.4, q) * (1 - smoothstep(0.85, 1, q));
    // The fang: a sheer-sided block with a rounded crown, a little longer one way than the other.
    const fx = x - I.tx;
    const fz = z - I.tz;
    const ca = Math.cos(I.seed * 6);
    const sa = Math.sin(I.seed * 6);
    const qt = Math.hypot((fx * ca - fz * sa) * 1.25, (fx * sa + fz * ca) * 0.85) / I.tr;
    // The coast: a skirt of beach and palms round the foot, sinking into the lagoon.
    const coast = lerp(-8, 2.2, 1 - smoothstep(I.r * 0.9, I.r * 1.3, d));
    if (q >= 1 && qt >= 1) return coast;
    // Steep through the middle, rounded at the crown, flaring into the cone at the foot.
    const fang =
      I.th * Math.pow(1 - smoothstep(0, 1, Math.min(qt, 1)), 0.9) * (0.85 + 0.15 * gully);
    let y = Math.max(I.h * Math.pow(Math.max(0, 1 - q), 1.45) * gully, fang);
    y += 7 * fbm(this.nIsland, x * 0.02, z * 0.02, 3) * smoothstep(4, 30, y);
    return Math.max(y, coast);
  }

  /** Terrain: ocean, reefs, islets, lagoons and high islands. */
  height(x: number, z: number): number {
    let y = -Infinity;
    for (const a of this.near(x, z)) {
      y = Math.max(y, this.atollY(a, x, z));
      if (a.island) y = Math.max(y, this.islandY(a.island, x, z));
    }
    return y === -Infinity ? this.oceanY(x, z) : y;
  }

  /** Top of a bungalow roof over (x, z) (soft canopy), or -Infinity. */
  bungalowAt(x: number, z: number): number {
    for (const a of this.near(x, z)) {
      const B = a.bungalows;
      for (let k = 0; k < B.length; k += 3) {
        const dx = x - B[k];
        const dz = z - B[k + 1];
        if (dx * dx + dz * dz < 50) return BUNGALOW_TOP;
      }
    }
    return -Infinity;
  }

  /** Soft canopy: palms on the islets and the coasts, jungle up the high islands. */
  canopy(y: number): number {
    return smoothstep(0.9, 1.9, y) * Config.atoll.canopy;
  }

  // --- Rocks -----------------------------------------------------------------------------------

  /** The mushroom rock (if any) in grid cell (i, j). Cached; a pure function of the seed. */
  cell(i: number, j: number): Rock[] {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let list = this.cells.get(key);
    if (list) return list;
    if (this.cells.size > CELL_CACHE) this.cells.clear();
    list = [];
    this.cells.set(key, list);
    const A = Config.atoll;
    const C = A.rockCell;
    const s = this.seed;
    const x = (i + 0.2 + 0.6 * cellHash(i, j, s + 751)) * C;
    const z = (j + 0.2 + 0.6 * cellHash(i, j, s + 752)) * C;
    const dense = fbm(this.nRock, x * 0.004, z * 0.004, 2);
    if (cellHash(i, j, s + 753) > 0.06 + 0.7 * smoothstep(-0.1, 0.45, dense)) return list;
    const r = A.rockMin + (A.rockMax - A.rockMin) * Math.pow(cellHash(i, j, s + 754), 1.4);
    // Well inside a lagoon, in water deep enough, off the islands and the piers.
    this.ring(x, z);
    const a = this.ra;
    if (!a || this.rs > -a.w - 45 - r) return list;
    if (a.island && Math.hypot(x - a.island.x, z - a.island.z) < a.island.r * 1.35 + 25 + r)
      return list;
    if (this.height(x, z) > -3) return list;
    for (let k = 0; k < a.bungalows.length; k += 3)
      if (Math.hypot(x - a.bungalows[k], z - a.bungalows[k + 1]) < 40 + r) return list;
    // The spawn's opening run across the home lagoon stays open water.
    if (this.nearOpening(x, z, 45 + r)) return list;
    const shape = Math.floor(cellHash(i, j, s + 755) * ROCK_SHAPES.length);
    const sh = ROCK_SHAPES[shape];
    const k = 0.9 + 0.22 * cellHash(i, j, s + 756);
    const y0 = -SUBMERGED * k;
    const h = sh.H * k;
    list.push({
      x,
      z,
      y0,
      r,
      h,
      k,
      shape,
      yaw: cellHash(i, j, s + 757) * Math.PI * 2,
      top: y0 + h + 3,
      seed: cellHash(i, j, s + 758),
    });
    return list;
  }

  /** Whether (x, z) is within `pad` of the opening run, from the spawn to the island's fang. */
  nearOpening(x: number, z: number, pad: number): boolean {
    const home = this.atoll(0, 0)!.island!;
    const sx = this.spawn.x;
    const sz = this.spawn.z;
    const ex = home.tx;
    const ez = home.tz;
    const L2 = (ex - sx) ** 2 + (ez - sz) ** 2;
    const t = Math.max(0, Math.min(1, ((x - sx) * (ex - sx) + (z - sz) * (ez - sz)) / L2));
    return Math.hypot(x - sx - (ex - sx) * t, z - sz - (ez - sz) * t) < pad;
  }

  /** Rock radius at height y, or -1 above or below it. */
  radiusAt(p: Rock, y: number): number {
    const t = (y - p.y0) / p.h;
    if (t < 0 || t >= 1) return -1;
    return p.r * rockProfile(ROCK_SHAPES[p.shape], t);
  }

  /** Height of the cap's dome at horizontal distance d from the axis, or -Infinity. */
  private domeY(p: Rock, d: number): number {
    const sh = ROCK_SHAPES[p.shape];
    if (d >= p.r * rockProfile(sh, sh.cap)) return -Infinity;
    const q = d / (p.r * rockProfile(sh, sh.cap));
    return p.y0 + p.h * (sh.cap + (1 - sh.cap) * Math.sqrt(1 - q * q));
  }

  /** Calls `fn` for every rock that could reach (x, z) within `pad`; stops when it returns true. */
  private nearRocks(x: number, z: number, pad: number, fn: (p: Rock) => boolean): void {
    const C = Config.atoll.rockCell;
    const R = Config.atoll.rockMax + pad;
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
          const R2 = p.r + pad;
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
  private qp: Rock | null = null;

  private readonly solidFn = (p: Rock): boolean => {
    const y = this.qy;
    const m = this.qm;
    if (y < p.y0 - m || y > p.top + m) return false;
    const d = Math.hypot(this.qx - p.x, this.qz - p.z);
    const rr = this.radiusAt(p, Math.min(y, p.y0 + p.h - 0.01));
    if (d > Math.max(rr, 0) + m) {
      // Beside the rock at this height. Up on the cap that is still inside within the margin
      // of the dome's skin; lower down it is the open air under the overhang.
      const sh = ROCK_SHAPES[p.shape];
      if (y < p.y0 + p.h * sh.cap) return false;
      const s = this.domeY(p, d - m);
      if (s === -Infinity || y > s + m) return false;
    }
    if (y > p.y0 + p.h && d > p.r * 0.5 + m) return false;
    const H = this.hit;
    H[0] = p.x - p.r;
    H[1] = p.y0;
    H[2] = p.z - p.r;
    H[3] = p.x + p.r;
    H[4] = p.top;
    H[5] = p.z + p.r;
    this.qr = p.top;
    this.qp = p;
    return true;
  };

  /**
   * Top of the first solid containing the point grown by `margin`, or -Infinity: a mushroom
   * rock, or a high island's steep land (the look-ahead steers round it; the flight model keeps
   * the bird above it). Bounds go in `hit` (the city's contract).
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    this.qx = x;
    this.qy = y;
    this.qz = z;
    this.qm = margin;
    this.qr = -Infinity;
    this.qp = null;
    this.nearRocks(x, z, margin, this.solidFn);
    if (this.qr !== -Infinity) return this.qr;
    const g = this.height(x, z);
    if (g < Config.atoll.solidAbove || y > g + margin) return -Infinity;
    const H = this.hit;
    H[0] = x - 1;
    H[1] = -Infinity; // the land has no underside to dip beneath
    H[2] = z - 1;
    H[3] = x + 1;
    H[4] = g;
    H[5] = z + 1;
    return g;
  }

  /**
   * Push a point out of a mushroom rock (grown by margin): straight out from its axis, or up
   * onto the cap when that is closer. Land is the flight model's floor, not pushed here. Returns
   * the distance moved; the normal goes in `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let total = 0;
    for (let iter = 0; iter < 2; iter++) {
      this.qx = p.x;
      this.qy = p.y;
      this.qz = p.z;
      this.qm = margin;
      this.qp = null;
      this.nearRocks(p.x, p.z, margin, this.solidFn);
      const q = this.qp as Rock | null;
      if (!q) break;
      let dx = p.x - q.x;
      let dz = p.z - q.z;
      let d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const rr = Math.max(this.radiusAt(q, Math.min(p.y, q.y0 + q.h - 0.01)), 0);
      const side = rr + margin - d;
      // Up onto the cap only where there is one overhead; on the flanks, straight out.
      const crown = d < q.r * 0.5 + margin ? q.top : this.domeY(q, d);
      const up = crown === -Infinity ? Infinity : crown + margin - p.y;
      const sh = ROCK_SHAPES[q.shape];
      const crest = (p.y - q.y0) / q.h > sh.cap + (1 - sh.cap) * 0.4;
      if (up !== Infinity && (crest || up < side || side <= 0)) {
        if (up <= 0) break;
        n.x = n.z = 0;
        n.y = 1;
        // A hair past the surface, so the next pass finds the point clear.
        p.y += up + 1e-3;
        total += up;
      } else {
        if (side <= 0) break;
        n.y = 0;
        n.x = dx / d;
        n.z = dz / d;
        p.x += n.x * (side + 1e-3);
        p.z += n.z * (side + 1e-3);
        total += side;
      }
    }
    return total;
  }

  private sx = 0;
  private sz = 0;
  private best = -Infinity;
  private readonly capFn = (p: Rock): boolean => {
    const d = Math.hypot(this.sx - p.x, this.sz - p.z);
    const y = this.domeY(p, d);
    if (y > this.best) this.best = y + (d < p.r * 0.5 ? 3 : 1);
    return false;
  };

  /** Top of any rock's cap over (x, z), or -Infinity (shadows). */
  capAt(x: number, z: number): number {
    this.sx = x;
    this.sz = z;
    this.best = -Infinity;
    this.nearRocks(x, z, 0, this.capFn);
    return this.best;
  }

  private readonly skyFn = (p: Rock): boolean => {
    if (p.top > this.best) this.best = p.top;
    return false;
  };

  /** Highest top of any rock within `r` of (x, z), or -Infinity. */
  skyline(x: number, z: number, r: number): number {
    this.best = -Infinity;
    this.nearRocks(x, z, r, this.skyFn);
    return this.best;
  }

  /** How many rocks stand within `r` of (x, z) (slaloms prefer the rockiest line). */
  rocksNear(x: number, z: number, r: number): number {
    let n = 0;
    this.nearRocks(x, z, r, () => {
      n++;
      return false;
    });
    return n;
  }

  /** Clearance for planning: `above` over ground, canopy and water, `margin` from rock and land. */
  clear(x: number, y: number, z: number, margin: number, above: number): boolean {
    const g = this.height(x, z);
    const top = Math.max(g + this.canopy(g), this.bungalowAt(x, z), Config.world.waterLevel);
    if (y < top + above) return false;
    if (this.solidTop(x, y, z, margin) !== -Infinity) return false;
    // Steep land beside the path (a high island's flank).
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      if (this.height(x + Math.sin(a) * margin, z + Math.cos(a) * margin) > y - 2) return false;
    }
    return true;
  }
}
