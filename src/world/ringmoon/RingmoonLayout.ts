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
  private readonly cells = new Map<number, Spire[]>();
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
    return y;
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
    return this.solidTop(x, y, z, margin) === -Infinity;
  }
}
