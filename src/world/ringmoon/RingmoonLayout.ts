import { Config } from '../../core/Config';
import { clamp, lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, type Noise2D } from '../noise';

/**
 * Ringmoon Shallows' plan as one pure, seeded function of position (no Three.js, unit-tested):
 * a shallow jade sea over beds of moss, flat moss islets in terraced tables, groves of leaning
 * basalt spires, and the ship: an old seed-pod vessel resting on four legs in the shallows
 * ahead of the spawn, its belly high enough to fly under. Two tall spires stand either side of
 * it. The renderer, collisions and wisp planner all read this, so they agree on where the stone
 * and the hull are.
 */

/** A spire's silhouette: how it tapers, where its knuckles bulge and how its crown ends. */
export interface SpireShape {
  /** Share of the base radius lost by the top. */
  taper: number;
  /** Knuckles (bulging joints of the column) up its height, and how far they bulge. */
  knuckles: number;
  bump: number;
  /** Fraction of the height where the crown starts closing. */
  crown: number;
  /** 0 a rounded crown, 1 a point. */
  point: number;
}

export const SPIRE_SHAPES: SpireShape[] = [
  { taper: 0.72, knuckles: 3, bump: 0.08, crown: 0.9, point: 1 }, // needle
  { taper: 0.4, knuckles: 2, bump: 0.12, crown: 0.93, point: 0 }, // stout column, round crown
  { taper: 0.55, knuckles: 4, bump: 0.1, crown: 0.88, point: 0.6 }, // jointed finger
];
/** Most any profile reaches, in base radii (the flared foot plus a knuckle). */
export const SPIRE_REACH = 1.34;

/**
 * Radius at fraction t of a spire's height, in base radii: a flared foot, a taper with
 * knuckles bulging along it, then a crown that rounds over or narrows to a point. The mesh is
 * lathed from this and the collisions test against it.
 */
export function spireProfile(sh: SpireShape, t: number): number {
  if (t >= 1 || t < 0) return 0;
  let r = 1 - sh.taper * Math.pow(t, 1.1);
  r *= 1 + 0.22 * (1 - smoothstep(0, 0.12, t));
  r *= 1 + sh.bump * Math.pow(Math.max(0, Math.sin(t * Math.PI * sh.knuckles)), 6);
  if (t > sh.crown) {
    const q = (t - sh.crown) / (1 - sh.crown);
    r *= lerp(Math.sqrt(1 - q * q), 1 - q, sh.point);
  }
  return r;
}

export interface Spire {
  x: number;
  z: number;
  /** Base, under the sea floor. */
  y0: number;
  /** Base radius. */
  r: number;
  /** Height from y0 to the tip. */
  h: number;
  /** Lean: metres the axis moves along x and z per metre up. */
  lx: number;
  lz: number;
  shape: number;
  yaw: number;
  top: number;
  seed: number;
}

/** The ship's hull (an ellipsoid the drawn seed pod stays inside) and its four legs. */
export interface Ship {
  x: number;
  z: number;
  /** Centre height of the hull. */
  y: number;
  yaw: number;
  /** Semi-axes: along, across, up. */
  a: number;
  b: number;
  c: number;
  /** Legs as segments: top x, y, z, foot x, y, z per leg. */
  legs: number[];
  legR: number;
}

/** Alien things on the land. */
export const PROP_POD = 0;
export const PROP_BEACON = 1;
export const PROP_CRYSTAL = 2;

/**
 * A landing pod, a crystal cluster or a beacon tower. Pods and crystals stand no taller than
 * the frond canopy, so the bird glides over them; beacons are solid.
 */
export interface Prop {
  type: number;
  x: number;
  z: number;
  /** Base (a little into the ground). */
  y0: number;
  /** Uniform scale of the unit shape. */
  s: number;
  yaw: number;
  /** Highest point. */
  top: number;
  /** Footprint radius. */
  r: number;
  seed: number;
}

/** Landing pod height (m, at scale 1): legs, teardrop shell and antenna. */
export const POD_H = 8.4;
/** Crystal cluster height (m, at scale 1). */
export const CRYSTAL_H = 6;
/** A beacon tower at scale 1 (m): mast radius, the ring band and its radius, tip radius. */
export const BEACON = { h: 50, mast: 1.4, foot: 2.8, band0: 0.6, band1: 0.86, ring: 5.4, tip: 1.8 };

/** Radius of a beacon tower (scale 1) at fraction t of its height, or -1 off it. */
export function beaconProfile(t: number): number {
  if (t < 0 || t > 1) return -1;
  if (t > BEACON.band0 && t < BEACON.band1) return BEACON.ring;
  if (t > 0.95) return BEACON.tip;
  return t < 0.07 ? BEACON.foot : BEACON.mast;
}

/** The explorers' things at an outpost or the camp (see `Outpost`). */
export const OUT_HAB = 0;
export const OUT_MAST = 1;
export const OUT_LAMP = 2;
export const OUT_AWNING = 3;
export const OUT_SKIFF = 4;
/** Lowest ground a lamp stands on (m): its 1.7 m stay under the canopy there. */
export const LAMP_GROUND = 1.9;
/** Floats per outpost part: kind, x, z, yaw, scale. */
export const OUT_STRIDE = 5;
/** Tallest of each part at scale 1 (m): hab with its crates, mast, lamp, awning, skiff. */
export const OUT_TOP = [3.6, 7.6, 1.7, 2.8, 1.1];
/** Footprint radius of each part at scale 1 (m). */
export const OUT_R = [4.6, 2.2, 0.4, 3.4, 2.4];

/**
 * A small explorers' outpost by a group of landing pods (or the camp by the ship): domed habs
 * with crates stacked by their doors, a mast with a dish, and a lit path between them, lamps
 * along it. Everything stands under the frond canopy (soft ground, glided over).
 */
export interface Outpost {
  x: number;
  z: number;
  /** OUT_STRIDE floats per part. */
  parts: number[];
  /** The lit path as segments: x0, z0, x1, z1 each. */
  path: number[];
}

/**
 * The circles moving things follow round their instance's origin: speed (m/s) and radius
 * r0 + dr * lifePhase. The life material (materials.ts) moves them by the same numbers, so the
 * scatter can check every circle it hands out. 1 fish school, 2 grazer, 3 floater.
 */
export const LIFE_PATHS: Record<number, { speed: number; r0: number; dr: number }> = {
  1: { speed: 1.8, r0: 6, dr: 8 },
  2: { speed: 0.35, r0: 2.5, dr: 2.5 },
  3: { speed: 1.4, r0: 16, dr: 20 },
};

/** A moving thing's phase from its circle's centre, as the shader computes it. */
export function lifePhase(x: number, z: number): number {
  const v = x * 0.0137 + z * 0.0291;
  return v - Math.floor(v);
}

/** Radius (m) of the circle a moving thing of kind `kind` centred at (x, z) follows. */
export function lifeRadius(kind: number, x: number, z: number): number {
  const p = LIFE_PATHS[kind];
  return p.r0 + p.dr * lifePhase(x, z);
}

/** A jelly-like floater drifting high on a slow circle round (x, z) at height y. */
export interface Floater {
  x: number;
  y: number;
  z: number;
  /** Size (1 = a 3.2 m bell with 8 m of tendrils). */
  s: number;
  /** Its circle's radius (lifeRadius of kind 3). */
  r: number;
}
/** A floater's reach about its circle at scale 1 (m): out, above and below (tendrils). */
export const FLOATER = { out: 4, up: 4.5, down: 10 };
/** How far (m) the wisp ribbons keep from the space a floater drifts through. */
export const FLOATER_CLEAR = 8;

/** Cell hash with offset coordinates: cells mirrored through the origin never match. */
const cellHash = (i: number, j: number, seed: number) => hash2(i + 6113, j + 2729, seed);
const CELL_CACHE = 6000;

export class RingmoonLayout {
  readonly seed: number;
  readonly spawn = { x: 0, y: 14, z: 0, yaw: 0 };
  readonly ship: Ship;
  /** The two tall spires framing the ship (also stored in their cells). */
  readonly gate: Spire[] = [];
  /** The last solid a query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);
  private readonly nIsle: Noise2D;
  private readonly nBed: Noise2D;
  private readonly nSpire: Noise2D;
  private readonly nFine: Noise2D;
  private readonly nLand: Noise2D;
  private readonly nHill: Noise2D;
  private readonly nBar: Noise2D;
  private readonly cells = new Map<number, Spire[]>();
  private readonly propCells = new Map<number, Prop[]>();
  private readonly outpostCells = new Map<number, Outpost | null>();
  private readonly floaterCells = new Map<number, Floater | null>();
  /** The explorers' camp on a sand spit beside the ship: its middle, heading and half length. */
  readonly camp: { x: number; z: number; yaw: number; r: number; top: number };
  /** The camp's habs, masts, lamps, awning and skiff, and its lit paths (as an outpost). */
  readonly campSite: Outpost;
  /** The opening run: from the spawn, under the ship's belly and on beyond it. */
  private readonly runEnd: { x: number; z: number };

  constructor(seed: number) {
    this.seed = seed;
    this.nIsle = createNoise2D(seed + 801);
    this.nBed = createNoise2D(seed + 802);
    this.nSpire = createNoise2D(seed + 803);
    this.nFine = createNoise2D(seed + 804);
    this.nLand = createNoise2D(seed + 805);
    this.nHill = createNoise2D(seed + 806);
    this.nBar = createNoise2D(seed + 807);
    const R = Config.ringmoon;
    const s = this.spawn;
    const a = R.shipLength;
    const b = R.shipWidth;
    const c = R.shipHeight;
    const ship: Ship = {
      x: s.x + 10,
      z: s.z + R.shipAhead,
      y: R.shipBelly + c,
      yaw: R.shipYaw,
      a,
      b,
      c,
      legs: [],
      legR: R.legRadius,
    };
    // Legs from inside the hull near each end, splayed out and down to the sea floor.
    for (const su of [1, -1])
      for (const sv of [1, -1]) {
        const top = this.shipPoint(ship, su * a * 0.66, sv * b * 0.42);
        const foot = this.shipPoint(ship, su * a * 0.8, sv * b * 0.8);
        ship.legs.push(top.x, ship.y - c * 0.42, top.z, foot.x, -R.depth - 1.5, foot.z);
      }
    this.ship = ship;
    this.runEnd = { x: ship.x, z: ship.z + 160 };
    // The gate: a tall spire past either end of the ship, leaning a little toward it.
    const gs: [number, number, number, number][] = [
      [1, 150, 13, 0],
      [-1, 124, 11, 1],
    ];
    for (const [side, h, r, shape] of gs) {
      const p = this.shipPoint(ship, side * (a + 46), 0);
      const lean = 0.06;
      const y0 = -R.depth - 3;
      this.gate.push({
        x: p.x,
        z: p.z,
        y0,
        r,
        h,
        lx: -Math.sin(ship.yaw) * side * lean,
        lz: -Math.cos(ship.yaw) * side * lean,
        shape,
        yaw: side,
        top: y0 + h,
        seed: side > 0 ? 0.2 : 0.7,
      });
    }
    const cp = this.shipPoint(ship, R.campAlong, R.campOut);
    this.camp = { x: cp.x, z: cp.z, yaw: ship.yaw, r: R.campRadius, top: R.isleTop };
    this.campSite = this.buildCamp();
  }

  /** World x, z of a point at (along, across) in the ship's frame. */
  private shipPoint(sh: Ship, u: number, v: number): { x: number; z: number } {
    const sn = Math.sin(sh.yaw);
    const cs = Math.cos(sh.yaw);
    return { x: sh.x + u * sn + v * cs, z: sh.z + u * cs - v * sn };
  }

  // --- Ground ----------------------------------------------------------------------------------

  /** 0..1: how near (x, z) is to the opening run (1 on it, 0 beyond `pad`). */
  openness(x: number, z: number, pad: number): number {
    const sx = this.spawn.x;
    const sz = this.spawn.z;
    const ex = this.runEnd.x;
    const ez = this.runEnd.z;
    const L2 = (ex - sx) ** 2 + (ez - sz) ** 2;
    const t = clamp(((x - sx) * (ex - sx) + (z - sz) * (ez - sz)) / L2, 0, 1);
    const d = Math.hypot(x - sx - (ex - sx) * t, z - sz - (ez - sz) * t);
    return 1 - smoothstep(pad * 0.6, pad, d);
  }

  /** Whether (x, z) is within `pad` of the opening run. */
  nearOpening(x: number, z: number, pad: number): boolean {
    return this.openness(x, z, pad + 1e-6) >= 1;
  }

  /** Distance-like measure from the ship's footprint: < 1 inside the hull's ellipse grown by pad. */
  shipZone(x: number, z: number, pad: number): number {
    const S = this.ship;
    const dx = x - S.x;
    const dz = z - S.z;
    const sn = Math.sin(S.yaw);
    const cs = Math.cos(S.yaw);
    const u = dx * sn + dz * cs;
    const v = dx * cs - dz * sn;
    return Math.hypot(u / (S.a + pad), v / (S.b + pad));
  }

  /** The sea floor: moss beds in long low swells. */
  private bedY(x: number, z: number): number {
    return (
      -Config.ringmoon.depth +
      1.6 * fbm(this.nBed, x * 0.004, z * 0.004, 2) +
      0.35 * Math.sin(x * 0.05 + 2 * fbm(this.nFine, x * 0.01, z * 0.01, 1)) * Math.sin(z * 0.043)
    );
  }

  /** 0..1: how much of an islet stands at (x, z) (none on the opening run or under the ship). */
  isle(x: number, z: number): number {
    const R = Config.ringmoon;
    const n = fbm(this.nIsle, x * R.isleScale, z * R.isleScale, 3);
    const t = 1 - R.isleShare;
    let m = smoothstep(t - 0.02, t + 0.025, 0.5 + n);
    if (m <= 0) return 0;
    m *= 1 - this.openness(x, z, 110);
    m *= smoothstep(1.3, 1.9, this.shipZone(x, z, 0));
    // The camp's spit stands alone in the water.
    m *= smoothstep(1.5, 2.3, this.campDist(x, z));
    return m;
  }

  /** How far inland (x, z) lies on the mainland: < 0 at sea, rising from 0 at the coast. */
  private inland(x: number, z: number): number {
    const R = Config.ringmoon;
    return 0.5 + fbm(this.nLand, x * R.landScale, z * R.landScale, 3) - (1 - R.landShare);
  }

  /**
   * 0..1: how much of the mainland stands at (x, z): broad land a kilometre or two across,
   * kept further off the opening run and the ship than the islets (its hills would wall them in).
   */
  mainland(x: number, z: number): number {
    let m = smoothstep(-0.02, 0.03, this.inland(x, z));
    if (m <= 0) return 0;
    m *= 1 - this.openness(x, z, 240);
    m *= smoothstep(2.4, 3.4, this.shipZone(x, z, 0));
    m *= smoothstep(1.5, 2.5, this.campDist(x, z));
    return m;
  }

  /**
   * The mainland's height: a flat moss shore, then rolling hills rising inland (rounded crowns
   * of different heights from a plain fbm, never cliffs: the bird swoops over them).
   */
  private landY(x: number, z: number): number {
    const R = Config.ringmoon;
    const deep = smoothstep(0.02, 0.2, this.inland(x, z));
    const roll = 0.5 + 0.5 * fbm(this.nHill, x * 0.0018, z * 0.0018, 3);
    const hills = R.hillHeight * Math.pow(smoothstep(0.04, 0.96, roll), 1.25) * deep;
    return R.isleTop + 1.2 + hills + 0.5 * fbm(this.nFine, x * 0.03, z * 0.03, 2);
  }

  /**
   * Terrain: the sea floor, the islets' moss tables rising in a terrace or two, and the
   * mainland's rolling hills.
   */
  height(x: number, z: number): number {
    const R = Config.ringmoon;
    const bed = this.bedY(x, z);
    let y = bed;
    const ml = this.mainland(x, z);
    // Islets belong to the sea: on the mainland their terraces would stand up as steps.
    const m = this.isle(x, z) * (1 - smoothstep(0, 0.5, ml));
    if (m > 0) {
      const n = 0.5 + fbm(this.nIsle, x * R.isleScale, z * R.isleScale, 3) - (1 - R.isleShare);
      const top =
        R.isleTop +
        2.4 * smoothstep(0.07, 0.1, n) +
        2.2 * smoothstep(0.16, 0.19, n) +
        0.5 * fbm(this.nFine, x * 0.03, z * 0.03, 2);
      y = lerp(bed, top, m);
    }
    if (ml > 0) y = Math.max(y, lerp(bed, this.landY(x, z), ml));
    const cm = this.campMask(x, z);
    if (cm > 0)
      y = Math.max(y, lerp(bed, this.camp.top + 0.3 * fbm(this.nFine, x * 0.05, z * 0.05, 1), cm));
    if (y < 0.5) {
      const b = this.sandbar(x, z);
      // A bar's crest is just awash or just clear of the water; elsewhere a pale shoal under it.
      if (b > 0) y = Math.max(y, lerp(bed, -1.6 + 1.95 * this.barRise(x, z), b));
    }
    return y;
  }

  /** 0..1: the camp's sand spit, an ellipse along the ship with a soft beach round it. */
  campMask(x: number, z: number): number {
    const C = this.camp;
    if (Math.abs(x - C.x) > C.r * 1.3 || Math.abs(z - C.z) > C.r * 1.3) return 0;
    return 1 - smoothstep(0.55, 1.05, this.campDist(x, z));
  }

  /** Distance from the camp's middle in its spit's ellipse (1 at the waterline, roughly). */
  campDist(x: number, z: number): number {
    const C = this.camp;
    const dx = x - C.x;
    const dz = z - C.z;
    const sn = Math.sin(C.yaw);
    const cs = Math.cos(C.yaw);
    const u = (dx * sn + dz * cs) / C.r;
    const v = (dx * cs - dz * sn) / (C.r * 0.5);
    return Math.hypot(u, v);
  }

  /**
   * 0..1: a sand bar in the open shallows: the zero contour of a noise stretched one way, a
   * low ridge about 25 m across, away from the land, the opening run and the ship.
   */
  sandbar(x: number, z: number): number {
    const k = Config.ringmoon.sandbars;
    if (k <= 0) return 0;
    const s = fbm(this.nBar, x * 0.0021 + z * 0.0012, z * 0.0052 - x * 0.0014, 2);
    const ridge = 1 - smoothstep(0, 0.07, Math.abs(s));
    if (ridge <= 0) return 0;
    let m = ridge * k * (1 - this.openness(x, z, 90));
    if (m <= 0) return 0;
    m *= smoothstep(1.5, 2.2, this.shipZone(x, z, 0));
    return m;
  }

  /** 0..1 along a bar: where it rises clear of the water (else it stays a pale shoal). */
  private barRise(x: number, z: number): number {
    return smoothstep(0.05, 0.3, this.nBar(x * 0.004 + 31.7, z * 0.004 - 12.3));
  }

  /** Soft canopy: coil fronds and reed fans on the islets. */
  canopy(y: number): number {
    return smoothstep(1.2, 2.6, y) * Config.ringmoon.canopy;
  }

  // --- Spires ----------------------------------------------------------------------------------

  /** The spire (if any) in grid cell (i, j), plus a gate spire centred there. Cached. */
  cell(i: number, j: number): Spire[] {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let list = this.cells.get(key);
    if (list) return list;
    if (this.cells.size > CELL_CACHE) this.cells.clear();
    list = [];
    this.cells.set(key, list);
    const R = Config.ringmoon;
    const C = R.spireCell;
    for (const g of this.gate)
      if (Math.floor(g.x / C) === i && Math.floor(g.z / C) === j) list.push(g);
    const s = this.seed;
    const x = (i + 0.2 + 0.6 * cellHash(i, j, s + 811)) * C;
    const z = (j + 0.2 + 0.6 * cellHash(i, j, s + 812)) * C;
    const dense = fbm(this.nSpire, x * 0.0035, z * 0.0035, 2);
    if (cellHash(i, j, s + 813) > 0.04 + 0.6 * smoothstep(-0.08, 0.38, dense)) return list;
    const tall =
      Math.pow(cellHash(i, j, s + 814), 2.2) * (0.55 + 0.45 * smoothstep(0, 0.35, dense));
    const h = R.spireLow + (R.spireHigh - R.spireLow) * tall;
    const r =
      R.spireMin + (R.spireMax - R.spireMin) * (0.35 * cellHash(i, j, s + 815) + 0.65 * tall);
    const lean = R.lean * cellHash(i, j, s + 816);
    const la = cellHash(i, j, s + 817) * Math.PI * 2;
    const reach = r * SPIRE_REACH + lean * h;
    // The opening run and the ship stay open; the gate spires stand alone.
    if (this.nearOpening(x, z, 40 + reach)) return list;
    if (this.shipZone(x, z, 60 + reach) < 1) return list;
    for (const g of this.gate) if (Math.hypot(x - g.x, z - g.z) < 70 + reach) return list;
    // Standing on the land where there is some (a hill buries the foot, not the spire).
    const y0 = Math.max(-R.depth - 3, this.height(x, z) - 6);
    list.push({
      x,
      z,
      y0,
      r,
      h,
      lx: Math.sin(la) * lean,
      lz: Math.cos(la) * lean,
      shape: Math.floor(cellHash(i, j, s + 818) * SPIRE_SHAPES.length),
      yaw: cellHash(i, j, s + 819) * Math.PI * 2,
      top: y0 + h,
      seed: cellHash(i, j, s + 820),
    });
    return list;
  }

  /** Spire radius at height y, or -1 above or below it. */
  radiusAt(p: Spire, y: number): number {
    const t = (y - p.y0) / p.h;
    if (t < 0 || t >= 1) return -1;
    return p.r * spireProfile(SPIRE_SHAPES[p.shape], t);
  }

  /** Calls `fn` for every spire that could reach (x, z) within `pad`; stops when it returns true. */
  private nearSpires(x: number, z: number, pad: number, fn: (p: Spire) => boolean): void {
    const Rm = Config.ringmoon;
    const C = Rm.spireCell;
    const R = Rm.spireMax * SPIRE_REACH + Rm.lean * Rm.spireHigh + pad;
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
          const R2 = p.r * SPIRE_REACH + Math.hypot(p.lx, p.lz) * p.h + pad;
          if (dx * dx + dz * dz > R2 * R2) continue;
          if (fn(p)) return;
        }
      }
  }

  // --- Alien things ----------------------------------------------------------------------------

  /** Whether a prop of footprint r may stand at (x, z): on fairly level land, clear of things. */
  private propOk(x: number, z: number, r: number, stone: number): boolean {
    const y = this.height(x, z);
    if (y < 1.8) return false;
    if (Math.abs(this.height(x + r, z) - y) + Math.abs(this.height(x, z + r) - y) > r * 0.7)
      return false;
    if (this.nearOpening(x, z, 45 + r) || this.shipZone(x, z, 40 + r) < 1) return false;
    return this.spiresNear(x, z, stone + r) === 0;
  }

  /** The alien things (if any) in grid cell (i, j): pods, crystals or a beacon. Cached. */
  props(i: number, j: number): Prop[] {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let list = this.propCells.get(key);
    if (list) return list;
    if (this.propCells.size > CELL_CACHE) this.propCells.clear();
    list = [];
    this.propCells.set(key, list);
    const R = Config.ringmoon;
    const C = R.propCell;
    const s = this.seed;
    const h = (salt: number) => cellHash(i, j, s + salt);
    const cx = (i + 0.2 + 0.6 * h(851)) * C;
    const cz = (j + 0.2 + 0.6 * h(852)) * C;
    const pick = h(853);
    const add = (
      type: number,
      x: number,
      z: number,
      sc: number,
      r: number,
      H: number,
      k: number,
    ) => {
      const y0 = this.height(x, z) - (type === PROP_BEACON ? 2 : 0.4);
      list!.push({
        type,
        x,
        z,
        y0,
        s: sc,
        yaw: h(860 + k) * Math.PI * 2,
        top: y0 + H * sc,
        r: r * sc,
        seed: h(870 + k),
      });
    };
    if (pick < R.podChance) {
      // A few pods set down near one another.
      const n = 1 + Math.floor(h(854) * 3);
      for (let k = 0; k < n; k++) {
        const a = (h(880) + k / 3) * Math.PI * 2; // spread round, never two in one spot
        const x = cx + (k ? Math.sin(a) * 13 : 0);
        const z = cz + (k ? Math.cos(a) * 13 : 0);
        const sc = 0.85 + 0.2 * h(890 + k);
        if (this.propOk(x, z, 4 * sc, 14)) add(PROP_POD, x, z, sc, 3.6, POD_H, k);
      }
    } else if (pick < R.podChance + R.crystalChance) {
      const n = 1 + Math.floor(h(855) * 2);
      for (let k = 0; k < n; k++) {
        const a = (h(880) + k / 3) * Math.PI * 2; // spread round, never two in one spot
        const x = cx + (k ? Math.sin(a) * 9 : 0);
        const z = cz + (k ? Math.cos(a) * 9 : 0);
        const sc = 0.95 + 0.45 * h(890 + k); // up to ~8.4 m, still under the frond canopy
        if (this.propOk(x, z, 4 * sc, 12)) add(PROP_CRYSTAL, x, z, sc, 4, CRYSTAL_H, k);
      }
    } else if (pick < R.podChance + R.crystalChance + R.beaconChance) {
      // Beacons on bigger land (a hill or a broad islet), well clear of the stone.
      const sc = (R.beaconHeight / BEACON.h) * (0.85 + 0.3 * h(856));
      if (this.height(cx, cz) > 4 && this.propOk(cx, cz, BEACON.ring * sc, 40))
        add(PROP_BEACON, cx, cz, sc, BEACON.ring, BEACON.h, 0);
    }
    return list;
  }

  /** Calls `fn` for every prop that could reach (x, z) within `pad`; stops when it returns true. */
  private nearProps(x: number, z: number, pad: number, fn: (p: Prop) => boolean): void {
    const C = Config.ringmoon.propCell;
    const R = 30 + pad;
    const i0 = Math.floor((x - R) / C);
    const i1 = Math.floor((x + R) / C);
    const j0 = Math.floor((z - R) / C);
    const j1 = Math.floor((z + R) / C);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const list = this.props(i, j);
        for (let n = 0; n < list.length; n++) {
          const p = list[n];
          const R2 = p.r + pad;
          if ((x - p.x) ** 2 + (z - p.z) ** 2 > R2 * R2) continue;
          if (fn(p)) return;
        }
      }
  }

  /** Whether any alien thing (pod, crystal, beacon) stands within `r` of (x, z). */
  propNear(x: number, z: number, r: number): boolean {
    this.pn = false;
    this.nearProps(x, z, r, this.propNearFn);
    return this.pn;
  }

  private pn = false;
  private readonly propNearFn = (): boolean => {
    this.pn = true;
    return true;
  };

  // --- The explorers ---------------------------------------------------------------------------

  /** Whether an outpost part of footprint r may stand at (x, z): level moss, clear of things. */
  private siteOk(x: number, z: number, r: number): boolean {
    const y = this.height(x, z);
    if (y < 2.6) return false;
    if (Math.abs(this.height(x + r, z) - y) + Math.abs(this.height(x, z + r) - y) > r * 0.6)
      return false;
    if (this.nearOpening(x, z, 45 + r) || this.shipZone(x, z, 40 + r) < 1) return false;
    return this.spiresNear(x, z, 12 + r) === 0;
  }

  /**
   * The explorers' outpost (if any) by the landing pods of prop cell (i, j): one or two habs and
   * a mast round the pods, a lit path from the pods to each, lamps along it. Cached.
   */
  outpost(i: number, j: number): Outpost | null {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    const got = this.outpostCells.get(key);
    if (got !== undefined) return got;
    if (this.outpostCells.size > CELL_CACHE) this.outpostCells.clear();
    let o: Outpost | null = null;
    const pods = this.props(i, j).filter((p) => p.type === PROP_POD);
    const h = (salt: number) => cellHash(i, j, this.seed + salt);
    if (pods.length > 0 && h(901) < Config.ringmoon.outposts) {
      let cx = 0;
      let cz = 0;
      for (const p of pods) {
        cx += p.x / pods.length;
        cz += p.z / pods.length;
      }
      o = { x: cx, z: cz, parts: [], path: [] };
      const a0 = h(902) * Math.PI * 2;
      let habs = 0;
      let mast = false;
      let last = -9;
      for (let k = 0; k < 8 && (habs < 2 || !mast); k++) {
        if (k - last < 2) continue;
        const a = a0 + (k * Math.PI) / 4;
        const want = habs < 1 + (h(903) < 0.5 ? 1 : 0) ? OUT_HAB : mast ? -1 : OUT_MAST;
        if (want < 0) break;
        const d = want === OUT_HAB ? 23 : 27;
        const x = cx + Math.sin(a) * d;
        const z = cz + Math.cos(a) * d;
        const r = OUT_R[want];
        if (!this.siteOk(x, z, r) || this.propNear(x, z, r + 5)) continue;
        // The hab's door (local +z) faces the pods.
        o.parts.push(want, x, z, a + Math.PI, want === OUT_HAB ? 0.9 + 0.2 * h(904 + k) : 1);
        this.lamps(o, cx + Math.sin(a) * 7, cz + Math.cos(a) * 7, x, z, d - 7 - r);
        if (want === OUT_HAB) habs++;
        else mast = true;
        last = k;
      }
      if (o.parts.length === 0) o = null;
    }
    this.outpostCells.set(key, o);
    return o;
  }

  /** A lit path from (x0, z0) toward (x1, z1), `len` long, lamps either side along it. */
  private lamps(o: Outpost, x0: number, z0: number, x1: number, z1: number, len: number): void {
    const d = Math.hypot(x1 - x0, z1 - z0) || 1;
    const fx = (x1 - x0) / d;
    const fz = (z1 - z0) / d;
    o.path.push(x0, z0, x0 + fx * (len + 2), z0 + fz * (len + 2));
    let side = 1;
    for (let s = 1.5; s <= len; s += 6.5) {
      const x = x0 + fx * s + fz * 1.6 * side;
      const z = z0 + fz * s - fx * 1.6 * side;
      side = -side;
      if (this.height(x, z) < LAMP_GROUND) continue;
      o.parts.push(OUT_LAMP, x, z, 0, 1);
    }
  }

  /**
   * The camp on its spit beside the ship: three habs in an arc facing the ship, an awning
   * between them, two masts, a skiff drawn up on the beach and a lit path down to it.
   */
  private buildCamp(): Outpost {
    const C = this.camp;
    const sn = Math.sin(C.yaw);
    const cs = Math.cos(C.yaw);
    // Camp frame: u along the spit (the ship's length), v out from the ship (+v toward spawn).
    const at = (u: number, v: number) => ({ x: C.x + u * sn + v * cs, z: C.z + u * cs - v * sn });
    const o: Outpost = { x: C.x, z: C.z, parts: [], path: [] };
    // Facing the ship: local +z toward -v.
    const face = Math.atan2(-cs, sn);
    const put = (kind: number, u: number, v: number, yaw: number, s: number) => {
      const p = at(u, v);
      o.parts.push(kind, p.x, p.z, yaw, s);
    };
    put(OUT_HAB, -13, 5, face + 0.35, 1.05);
    put(OUT_HAB, 1, 9, face, 1.15);
    put(OUT_HAB, 15, 4, face - 0.4, 0.95);
    put(OUT_AWNING, 2, -2, face, 1);
    put(OUT_MAST, -19, 2, 0, 1.05);
    put(OUT_MAST, 19, 7, 0.6, 0.9);
    // The path from the awning down to the beach on the ship's side, a skiff moored off it.
    const a = at(2, -6);
    const b = at(2, -16);
    this.lamps(o, a.x, a.z, b.x, b.z, 9);
    put(OUT_SKIFF, 6, -26, face + Math.PI / 2, 1);
    // And along the spit between the habs.
    const l = at(-17, -2);
    const r = at(19, -2);
    this.lamps(o, l.x, l.z, r.x, r.z, 36);
    return o;
  }

  /** Calls `fn` for every outpost (and the camp) that could reach (x, z) within `pad`. */
  private nearOutposts(x: number, z: number, pad: number, fn: (o: Outpost) => void): void {
    const C = Config.ringmoon.propCell;
    const R = 60 + pad;
    const i0 = Math.floor((x - R) / C);
    const i1 = Math.floor((x + R) / C);
    const j0 = Math.floor((z - R) / C);
    const j1 = Math.floor((z + R) / C);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const o = this.outpost(i, j);
        if (o && Math.abs(o.x - x) < R && Math.abs(o.z - z) < R) fn(o);
      }
    const c = this.campSite;
    if (Math.abs(c.x - x) < R && Math.abs(c.z - z) < R) fn(c);
  }

  private pd = Infinity;
  private readonly pathFn = (o: Outpost): void => {
    const x = this.tx;
    const z = this.tz;
    const P = o.path;
    for (let k = 0; k < P.length; k += 4) {
      const ex = P[k + 2] - P[k];
      const ez = P[k + 3] - P[k + 1];
      const L2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - P[k]) * ex + (z - P[k + 1]) * ez) / L2, 0, 1);
      const d = Math.hypot(x - P[k] - ex * t, z - P[k + 1] - ez * t);
      if (d < this.pd) this.pd = d;
    }
    // Trodden ground round every hab and mast.
    const Q = o.parts;
    for (let k = 0; k < Q.length; k += OUT_STRIDE) {
      if (Q[k] === OUT_LAMP) continue;
      const d = Math.hypot(x - Q[k + 1], z - Q[k + 2]) - OUT_R[Q[k]] * Q[k + 4] - 1;
      if (d < this.pd) this.pd = d;
    }
  };

  /**
   * Distance (m) from (x, z) to the nearest lit path or the trodden ground round a hab or mast
   * (0 inside one), or Infinity when there is none within ~60 m. Paints the paths and keeps the
   * flora off them.
   */
  pathDist(x: number, z: number): number {
    this.pd = Infinity;
    this.tx = x;
    this.tz = z;
    this.nearOutposts(x, z, 0, this.pathFn);
    return Math.max(this.pd, 0);
  }

  /** The floater (if any) of floater cell (i, j). Cached. */
  floater(i: number, j: number): Floater | null {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    const got = this.floaterCells.get(key);
    if (got !== undefined) return got;
    if (this.floaterCells.size > CELL_CACHE) this.floaterCells.clear();
    const R = Config.ringmoon;
    const C = R.floaterCell;
    const h = (salt: number) => cellHash(i, j, this.seed + salt);
    let f: Floater | null = null;
    if (h(931) < R.floaters) {
      const x = (i + 0.2 + 0.6 * h(932)) * C;
      const z = (j + 0.2 + 0.6 * h(933)) * C;
      const s = 1 + 0.7 * h(934);
      const r = lifeRadius(3, x, z);
      // Over the sea or the islets, well up, never over the opening run or the ship.
      if (!this.nearOpening(x, z, 140 + r) && this.shipZone(x, z, 80 + r) >= 1) {
        let floor = -Infinity;
        let stone = -Infinity;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          const g = this.height(px, pz);
          floor = Math.max(floor, g + this.canopy(g), 0);
          stone = Math.max(stone, this.skyline(px, pz, (FLOATER.out + 10) * s));
        }
        const y = floor + 18 + 26 * h(935) + FLOATER.down * s;
        // Clear of every spire and beacon round its circle, tendrils and all.
        if (stone < y - FLOATER.down * s - 12) f = { x, y, z, s, r };
      }
    }
    this.floaterCells.set(key, f);
    return f;
  }

  /** Calls `fn` for every floater whose circle could come within `pad` of (x, z). */
  private nearFloaters(x: number, z: number, pad: number, fn: (f: Floater) => boolean): void {
    const C = Config.ringmoon.floaterCell;
    const R = LIFE_PATHS[3].r0 + LIFE_PATHS[3].dr + FLOATER.out * 1.7 + pad;
    const i0 = Math.floor((x - R) / C);
    const i1 = Math.floor((x + R) / C);
    const j0 = Math.floor((z - R) / C);
    const j1 = Math.floor((z + R) / C);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const f = this.floater(i, j);
        if (f && fn(f)) return;
      }
  }

  private fy = 0;
  private fp = 0;
  private fHit = false;
  private fTop = -Infinity;
  private readonly floaterFn = (f: Floater): boolean => {
    const d = Math.abs(Math.hypot(this.tx - f.x, this.tz - f.z) - f.r);
    if (d > FLOATER.out * f.s + this.fp) return false;
    if (this.fy > f.y + FLOATER.up * f.s + this.fp || this.fy < f.y - FLOATER.down * f.s - this.fp)
      return false;
    this.fHit = true;
    return true;
  };
  private readonly floaterTopFn = (f: Floater): boolean => {
    const d = Math.abs(Math.hypot(this.tx - f.x, this.tz - f.z) - f.r);
    if (d <= FLOATER.out * f.s + this.fp) this.fTop = Math.max(this.fTop, f.y + FLOATER.up * f.s);
    return false;
  };

  /** Whether (x, y, z) comes within `pad` of the space a floater drifts through. */
  floaterNear(x: number, y: number, z: number, pad: number): boolean {
    this.tx = x;
    this.tz = z;
    this.fy = y;
    this.fp = pad;
    this.fHit = false;
    this.nearFloaters(x, z, pad, this.floaterFn);
    return this.fHit;
  }

  /** Top of the space any floater drifts through within `pad` of (x, z), or -Infinity. */
  floaterTop(x: number, z: number, pad: number): number {
    this.tx = x;
    this.tz = z;
    this.fp = pad;
    this.fTop = -Infinity;
    this.nearFloaters(x, z, pad, this.floaterTopFn);
    return this.fTop;
  }

  /** A beacon's radius at height y, or -1 above or below it. */
  beaconRadius(p: Prop, y: number): number {
    const r = beaconProfile((y - p.y0) / (BEACON.h * p.s));
    return r < 0 ? -1 : r * p.s;
  }

  private qb: Prop | null = null;
  private readonly beaconFn = (p: Prop): boolean => {
    if (p.type !== PROP_BEACON) return false;
    const y = this.qy;
    const m = this.qm;
    if (y < p.y0 - m || y > p.top + m) return false;
    const d = Math.hypot(this.qx - p.x, this.qz - p.z);
    const yc = clamp(y, p.y0, p.top);
    // The widest it gets within the margin up or down (so the look-ahead sees the rings coming).
    const r = Math.max(
      this.beaconRadius(p, yc),
      this.beaconRadius(p, Math.min(yc + m, p.top)),
      this.beaconRadius(p, Math.max(yc - m, p.y0)),
    );
    if (d > r + m) return false;
    const H = this.hit;
    H[0] = p.x - p.r;
    H[1] = p.y0;
    H[2] = p.z - p.r;
    H[3] = p.x + p.r;
    H[4] = p.top;
    H[5] = p.z + p.r;
    this.qr = p.top;
    this.qb = p;
    return true;
  };

  private readonly beaconsFn = (p: Prop): boolean => {
    if (p.type === PROP_BEACON && p.top > this.best) this.best = p.top;
    return false;
  };

  private nb: Prop | null = null;
  private nbD = Infinity;
  private readonly nearBeaconFn = (p: Prop): boolean => {
    if (p.type !== PROP_BEACON) return false;
    const d = Math.hypot(p.x - this.tx, p.z - this.tz);
    if (d < this.nbD) {
      this.nbD = d;
      this.nb = p;
    }
    return false;
  };

  /** The nearest beacon tower within `r` of (x, z), or null. */
  beaconNear(x: number, z: number, r: number): Prop | null {
    this.nb = null;
    this.nbD = Infinity;
    this.tx = x;
    this.tz = z;
    this.nearProps(x, z, r, this.nearBeaconFn);
    return this.nb;
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
    const yc = clamp(y, p.y0, p.top - 0.01);
    const ax = p.x + p.lx * (yc - p.y0);
    const az = p.z + p.lz * (yc - p.y0);
    const d = Math.hypot(this.qx - ax, this.qz - az);
    if (y > p.top) {
      // Over the tip: a point within the margin of it.
      if (Math.hypot(d, y - p.top) > m) return false;
    } else if (d > Math.max(this.radiusAt(p, yc), 0) + m) return false;
    const R = p.r * SPIRE_REACH;
    const H = this.hit;
    const tx = p.lx * p.h;
    const tz = p.lz * p.h;
    H[0] = p.x + Math.min(0, tx) - R;
    H[1] = p.y0;
    H[2] = p.z + Math.min(0, tz) - R;
    H[3] = p.x + Math.max(0, tx) + R;
    H[4] = p.top;
    H[5] = p.z + Math.max(0, tz) + R;
    this.qr = p.top;
    this.qp = p;
    return true;
  };

  /** The ship's frame at (x, y, z): along, across and up from the hull's centre. */
  private su = 0;
  private sv = 0;
  private sw = 0;
  private shipFrame(x: number, y: number, z: number): void {
    const S = this.ship;
    const dx = x - S.x;
    const dz = z - S.z;
    const sn = Math.sin(S.yaw);
    const cs = Math.cos(S.yaw);
    this.su = dx * sn + dz * cs;
    this.sv = dx * cs - dz * sn;
    this.sw = y - S.y;
  }

  /** Half the hull's height over (along, across) in its frame, or -1 off its footprint. */
  private hullHalf(u: number, v: number): number {
    const S = this.ship;
    const q = 1 - (u / S.a) ** 2 - (v / S.b) ** 2;
    return q > 0 ? S.c * Math.sqrt(q) : -1;
  }

  /** Index of the leg within `m` of (x, y, z), or -1. */
  private legAt(x: number, y: number, z: number, m: number): number {
    const L = this.ship.legs;
    const R = this.ship.legR + m;
    for (let k = 0; k < L.length; k += 6) {
      if (y > L[k + 1] + m) continue;
      const t = clamp((y - L[k + 4]) / (L[k + 1] - L[k + 4]), 0, 1);
      const ax = lerp(L[k + 3], L[k], t);
      const az = lerp(L[k + 5], L[k + 2], t);
      if ((x - ax) ** 2 + (z - az) ** 2 < R * R) return k;
    }
    return -1;
  }

  /**
   * Top of the first solid containing the point grown by `margin`, or -Infinity: a spire, the
   * ship's hull (whose underside the look-ahead eases beneath) or one of its legs. Bounds go in
   * `hit` (the city's contract).
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    this.qx = x;
    this.qy = y;
    this.qz = z;
    this.qm = margin;
    this.qr = -Infinity;
    this.qp = null;
    this.nearSpires(x, z, margin, this.solidFn);
    if (this.qr !== -Infinity) return this.qr;
    this.nearProps(x, z, margin, this.beaconFn);
    if (this.qr !== -Infinity) return this.qr;
    const S = this.ship;
    const H = this.hit;
    const ext = S.a + S.legR + margin + 30;
    if (Math.abs(x - S.x) > ext || Math.abs(z - S.z) > ext) return -Infinity;
    this.shipFrame(x, y, z);
    const u = this.su;
    const v = this.sv;
    const w = this.sw;
    if ((u / (S.a + margin)) ** 2 + (v / (S.b + margin)) ** 2 + (w / (S.c + margin)) ** 2 < 1) {
      const half = Math.max(this.hullHalf(u, v), 0);
      H[0] = S.x - S.a;
      H[1] = S.y - half;
      H[2] = S.z - S.a;
      H[3] = S.x + S.a;
      H[4] = S.y + half;
      H[5] = S.z + S.a;
      return S.y + half;
    }
    const k = this.legAt(x, y, z, margin);
    if (k < 0) return -Infinity;
    const L = S.legs;
    H[0] = Math.min(L[k], L[k + 3]) - S.legR;
    H[1] = L[k + 4];
    H[2] = Math.min(L[k + 2], L[k + 5]) - S.legR;
    H[3] = Math.max(L[k], L[k + 3]) + S.legR;
    H[4] = L[k + 1];
    H[5] = Math.max(L[k + 2], L[k + 5]) + S.legR;
    return L[k + 1];
  }

  /**
   * Push a point out of a spire, the hull or a leg (grown by margin). A spire: straight out
   * from its axis, or up over the tip when that is closer. The hull: out along the line from
   * its centre (down under the belly, up over the back). Returns the distance moved; the
   * outward normal goes in `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let total = 0;
    for (let iter = 0; iter < 2; iter++) {
      const d = this.pushOnce(p, margin, n);
      if (d <= 0) break;
      total += d;
    }
    return total;
  }

  private pushOnce(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    this.qx = p.x;
    this.qy = p.y;
    this.qz = p.z;
    this.qm = margin;
    this.qp = null;
    this.nearSpires(p.x, p.z, margin, this.solidFn);
    const q = this.qp as Spire | null;
    if (q) {
      const yc = clamp(p.y, q.y0, q.top - 0.01);
      let dx = p.x - (q.x + q.lx * (yc - q.y0));
      let dz = p.z - (q.z + q.lz * (yc - q.y0));
      let d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const side = Math.max(this.radiusAt(q, yc), 0) + margin - d;
      const up = q.top + margin - p.y;
      // Over the tip when that is the shorter way out (only near the crown).
      if ((p.y - q.y0) / q.h > SPIRE_SHAPES[q.shape].crown - 0.05 && up < side) {
        if (up <= 0) return 0;
        n.x = n.z = 0;
        n.y = 1;
        p.y += up + 1e-3;
        return up;
      }
      if (side <= 0) return 0;
      n.y = 0;
      n.x = dx / d;
      n.z = dz / d;
      p.x += n.x * (side + 1e-3);
      p.z += n.z * (side + 1e-3);
      return side;
    }
    this.qb = null;
    this.qr = -Infinity;
    this.nearProps(p.x, p.z, margin, this.beaconFn);
    const b = this.qb as Prop | null;
    if (b) {
      let dx = p.x - b.x;
      let dz = p.z - b.z;
      let d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const yc = clamp(p.y, b.y0, b.top);
      const r = Math.max(
        this.beaconRadius(b, yc),
        this.beaconRadius(b, Math.min(yc + margin, b.top)),
        this.beaconRadius(b, Math.max(yc - margin, b.y0)),
      );
      const side = r + margin - d;
      const up = b.top + margin - p.y;
      if (up < side && up < 4) {
        if (up <= 0) return 0;
        n.x = n.z = 0;
        n.y = 1;
        p.y += up + 1e-3;
        return up;
      }
      if (side <= 0) return 0;
      n.y = 0;
      n.x = dx / d;
      n.z = dz / d;
      p.x += n.x * (side + 1e-3);
      p.z += n.z * (side + 1e-3);
      return side;
    }
    const S = this.ship;
    const ext = S.a + S.legR + margin + 30;
    if (Math.abs(p.x - S.x) > ext || Math.abs(p.z - S.z) > ext) return 0;
    this.shipFrame(p.x, p.y, p.z);
    const A = S.a + margin;
    const B = S.b + margin;
    const C = S.c + margin;
    const u = this.su;
    const v = this.sv;
    const w = this.sw;
    const qq = (u / A) ** 2 + (v / B) ** 2 + (w / C) ** 2;
    const sn = Math.sin(S.yaw);
    const cs = Math.cos(S.yaw);
    if (qq < 1) {
      if (qq < 1e-6) {
        // At the very centre: straight up and out.
        n.x = n.z = 0;
        n.y = 1;
        p.y += C + 1e-3;
        return C;
      }
      // Out along the ray from the centre to the grown surface.
      const k = 1 / Math.sqrt(qq) - 1 + 1e-4;
      const du = u * k;
      const dv = v * k;
      const dw = w * k;
      p.x += du * sn + dv * cs;
      p.z += du * cs - dv * sn;
      p.y += dw;
      // The surface normal there (the ellipsoid's gradient).
      const gu = u / (A * A);
      const gv = v / (B * B);
      const gw = w / (C * C);
      const gl = Math.hypot(gu, gv, gw) || 1;
      n.x = (gu * sn + gv * cs) / gl;
      n.z = (gu * cs - gv * sn) / gl;
      n.y = gw / gl;
      return Math.hypot(du, dv, dw);
    }
    const k = this.legAt(p.x, p.y, p.z, margin);
    if (k < 0) return 0;
    const L = S.legs;
    const t = clamp((p.y - L[k + 4]) / (L[k + 1] - L[k + 4]), 0, 1);
    let dx = p.x - lerp(L[k + 3], L[k], t);
    let dz = p.z - lerp(L[k + 5], L[k + 2], t);
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = 1;
      dz = 0;
      d = 1;
    }
    const side = S.legR + margin - d;
    if (side <= 0) return 0;
    n.y = 0;
    n.x = dx / d;
    n.z = dz / d;
    p.x += n.x * (side + 1e-3);
    p.z += n.z * (side + 1e-3);
    return side;
  }

  /** Top of the ship's hull over (x, z), or -Infinity (shadows, the surface below). */
  shipTop(x: number, z: number): number {
    this.shipFrame(x, 0, z);
    const h = this.hullHalf(this.su, this.sv);
    return h < 0 ? -Infinity : this.ship.y + h * 0.95;
  }

  private best = -Infinity;
  private readonly skyFn = (p: Spire): boolean => {
    if (p.top > this.best) this.best = p.top;
    return false;
  };

  /** Highest top of any spire (or the ship) within `r` of (x, z), or -Infinity. */
  skyline(x: number, z: number, r: number): number {
    this.best = -Infinity;
    this.nearSpires(x, z, r, this.skyFn);
    this.nearProps(x, z, r, this.beaconsFn);
    if (this.shipZone(x, z, r + 10) < 1) this.best = Math.max(this.best, this.ship.y + this.ship.c);
    return this.best;
  }

  /** How many spires stand within `r` of (x, z) (slaloms prefer the stoniest line). */
  spiresNear(x: number, z: number, r: number): number {
    let n = 0;
    this.nearSpires(x, z, r, () => {
      n++;
      return false;
    });
    return n;
  }

  private tall: Spire | null = null;
  private tallD = Infinity;
  private tx = 0;
  private tz = 0;
  private readonly tallFn = (p: Spire): boolean => {
    if (p.h < 90) return false;
    const d = Math.hypot(p.x - this.tx, p.z - this.tz);
    if (d < this.tallD) {
      this.tallD = d;
      this.tall = p;
    }
    return false;
  };

  /** The nearest spire over 90 m tall within `r` of (x, z), or null. */
  tallSpire(x: number, z: number, r: number): Spire | null {
    this.tall = null;
    this.tallD = Infinity;
    this.tx = x;
    this.tz = z;
    this.nearSpires(x, z, r, this.tallFn);
    return this.tall;
  }

  /** Clearance for planning: `above` over the sea and the fronds, `margin` from stone and hull. */
  clear(x: number, y: number, z: number, margin: number, above: number): boolean {
    const g = this.height(x, z);
    const top = Math.max(g + this.canopy(g), Config.world.waterLevel);
    if (y < top + above) return false;
    if (this.solidTop(x, y, z, margin) !== -Infinity) return false;
    // The floaters aren't solid (the bird drifts through them), but no ribbon runs through one.
    return !this.floaterNear(x, y, z, FLOATER_CLEAR);
  }
}
