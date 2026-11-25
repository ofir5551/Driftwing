import { Config } from '../../core/Config';
import { clamp, lerp, smoothstep } from '../../core/math';
import type { LandField } from '../Terrain';
import { heartField } from './heart';

/**
 * Eden's plan (pure): where Tal's photo, Hadar's photo and the venue stand, the level meadows
 * they stand on (the Highlands' land reshaped round them), and the venue's parts in its own
 * frame. Everything Eden adds is placed from here, so the scenery, the flight floor, the
 * journeys and the finds agree.
 */

/** A level patch of land with something on it, facing the way the bird comes from. */
export interface EdenSite {
  readonly x: number;
  readonly z: number;
  /** The meadow's height. */
  readonly y: number;
  /** Which way the site faces: toward the bird arriving (from the previous stop). */
  readonly yaw: number;
  /** Radius of the level ground, and where it has blended back into the hills. */
  readonly flat: number;
  readonly blend: number;
}

/** A picture on its easel: centre of the picture, its size and which way it faces. */
export interface Frame {
  readonly x: number;
  readonly z: number;
  /** Ground under it. */
  readonly ground: number;
  /** The picture's bottom and top (m). */
  readonly y0: number;
  readonly y1: number;
  /** Half the picture's width (m). */
  readonly half: number;
  readonly yaw: number;
}

/** A soft dome the bird glides over (a tree's crown, the chuppah): centre, radius, top. */
export interface Lift {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly top: number;
}

/**
 * The venue in its own frame, metres: +v toward the arriving bird, +u to its right as it
 * comes in (u = right, v = toward the bird). After the photo of the venue: the glass hall under
 * a white wave roof at the back, the round pool before it with a pier, the lawn with the
 * ceremony's chairs and chuppah to one side, stone paving, an olive tree, tall trees round.
 */
export const VENUE = {
  pool: { u: 0, v: 8, r: 26 },
  /** The pier: from the rim into the pool (centre, half length, half width, turn). */
  pier: { u: -10, v: 2, half: 11, width: 2.4, turn: 0.55 },
  hall: { u: 0, v: -32, halfU: 20, halfV: 9, height: 6.5 },
  /** The roof's footprint (an ellipse) and its crown's rise above the hall. */
  roof: { u: 0, v: -31, a: 27, b: 15, rise: 6.5 },
  chuppah: { u: 44, v: -6, half: 2.4, height: 4.2 },
  /** The ceremony's chairs, facing the chuppah: rows, chairs per side of the aisle. */
  chairs: { u: 44, v: 6, rows: 8, perSide: 5, pitch: 1.5, gap: 1.2, aisle: 2.6 },
  olive: { u: 22, v: 30 },
  /** The couple's picture: on the lawn left of the pool, turned toward the way in. */
  frame: { u: -40, v: 18, turn: 0.45 },
  /** Where the journey ends and the beacon stands: over the lawn before the pool. */
  beacon: { u: 0, v: 48 },
  /** Tall trees in a horseshoe round the back (radius, the gap's half angle toward the bird). */
  trees: { radius: 88, count: 22, gap: 0.85 },
} as const;

const TAU = Math.PI * 2;

export class EdenLayout {
  readonly tal: EdenSite;
  readonly hadar: EdenSite;
  readonly venue: EdenSite;
  /**
   * The heart-shaped lake by the way to Tal: a low meadow with the lake in it, the heart's
   * lobes pointing away from the spawn (so it reads upright from the first glide), `size` m
   * from its centre to a lobe's edge.
   */
  readonly lake: EdenSite & { readonly size: number };
  /** The three pictures: Tal's, Hadar's and the two of them (at the venue). */
  readonly frames: readonly [Frame, Frame, Frame];
  /** Soft domes over the venue's trees and chuppah (the flight floor). */
  readonly lifts: readonly Lift[];
  /** The land reshaped round the sites (what the Highlands build on). */
  readonly field: LandField;
  private readonly sites: readonly EdenSite[];
  private readonly c: number;
  private readonly s: number;

  constructor(
    private readonly base: LandField,
    seed: number,
  ) {
    const E = Config.eden;
    // Alternate sides so the way zigzags gently (a straight line would hide each stop
    // behind the last); the seed only flips the first side.
    const side = seed % 2 === 0 ? 1 : -1;
    this.tal = this.pick(side * E.swing * 0.6, E.talAt, 0, 0, E.siteFlat, E.siteBlend);
    this.hadar = this.pick(
      -side * E.swing,
      E.hadarAt,
      this.tal.x,
      this.tal.z,
      E.siteFlat,
      E.siteBlend,
    );
    this.venue = this.pick(
      side * E.swing * 0.4,
      E.venueAt,
      this.hadar.x,
      this.hadar.z,
      E.venueFlat,
      E.venueBlend,
    );
    const size = E.lakeSize;
    const lake = this.pick(-side * E.lakeAside, E.lakeAt, 0, 0, size * 1.6, size * 3.2, 4, 2.5, 9);
    this.lake = { ...lake, yaw: lake.yaw + Math.PI, size };
    this.sites = [this.tal, this.hadar, this.venue, this.lake];
    this.c = Math.cos(this.venue.yaw);
    this.s = Math.sin(this.venue.yaw);
    const ph = E.photoHeight;
    const portrait = (S: EdenSite): Frame => ({
      x: S.x,
      z: S.z,
      ground: S.y,
      y0: S.y + E.photoLift,
      y1: S.y + E.photoLift + ph,
      half: ph * 0.375, // 3:4
      yaw: S.yaw,
    });
    const F = VENUE.frame;
    const fp = this.toWorld(F.u, F.v);
    this.frames = [
      portrait(this.tal),
      portrait(this.hadar),
      {
        x: fp.x,
        z: fp.z,
        ground: this.venue.y,
        y0: this.venue.y + E.photoLift,
        y1: this.venue.y + E.photoLift + ph * 1.0125, // 16:9 at 1.8x the width
        half: ph * 0.9,
        yaw: this.venue.yaw + F.turn,
      },
    ];
    this.lifts = this.buildLifts();
    this.field = this.reshape();
  }

  /** A point in the venue's frame (u right, v toward the bird) in the world. */
  toWorld(u: number, v: number): { x: number; z: number } {
    // +v is the venue's facing (sin, cos), toward the bird. Arriving, the bird faces
    // (-sin, -cos), and facing (fx, fz) its right is (-fz, fx): so +u is (cos, -sin).
    const c = this.c;
    const s = this.s;
    return { x: this.venue.x + s * v + c * u, z: this.venue.z + c * v - s * u };
  }

  /** A world point in the venue's frame. */
  toVenue(x: number, z: number): { u: number; v: number } {
    const dx = x - this.venue.x;
    const dz = z - this.venue.z;
    return { u: this.c * dx - this.s * dz, v: this.s * dx + this.c * dz };
  }

  /**
   * The wave roof's top at venue-frame (u, v), or -Infinity off its footprint: a crown over
   * the middle with a dip either side and rising ends, as the venue's white shell.
   */
  roofTop(u: number, v: number): number {
    const R = VENUE.roof;
    const H = VENUE.hall;
    const p = ((u - R.u) / R.a) ** 2 + ((v - R.v) / R.b) ** 2;
    if (p >= 1) return -Infinity;
    const crown = Math.sqrt(1 - p);
    const wave = 0.5 + 0.5 * Math.cos(((u - R.u) / R.a) * Math.PI * 2.4);
    return this.venue.y + H.height + R.rise * crown * (0.55 + 0.45 * wave);
  }

  /** The flight floor Eden adds at (x, z): roof, crowns, chuppah (-Infinity: nothing). */
  liftAt(x: number, z: number): number {
    const V = this.venue;
    const dx = x - V.x;
    const dz = z - V.z;
    if (dx * dx + dz * dz > (V.flat + 30) ** 2) return -Infinity;
    // toVenue, inline: the flight floor is read every step and must not allocate.
    const u = this.c * dx - this.s * dz;
    const v = this.s * dx + this.c * dz;
    let top = this.roofTop(u, v);
    for (const L of this.lifts) {
      const d2 = (x - L.x) ** 2 + (z - L.z) ** 2;
      if (d2 >= L.r * L.r) continue;
      top = Math.max(top, L.top - (d2 / (L.r * L.r)) * (L.top - V.y) * 0.6);
    }
    return top;
  }

  /**
   * Push a point out of a picture (its frame and easel, as an upright slab): out through the
   * nearer face, front or back, else over the top. Returns how far it moved (0: not inside).
   */
  pushFrame(p: { x: number; y: number; z: number }, margin: number): number {
    for (const F of this.frames) {
      if (p.y > F.y1 + 1 + margin || p.y < F.ground - margin) continue;
      const dx = p.x - F.x;
      const dz = p.z - F.z;
      const c = Math.cos(F.yaw);
      const s = Math.sin(F.yaw);
      const n = dx * s + dz * c; // along its facing
      const w = dx * c - dz * s; // across it
      const depth = 0.8 + margin;
      if (Math.abs(n) > depth || Math.abs(w) > F.half + 1 + margin) continue;
      const out = depth - Math.abs(n);
      const up = F.y1 + 1 + margin - p.y;
      if (up < out) {
        p.y += up;
        return up;
      }
      const sgn = n >= 0 ? 1 : -1;
      p.x += s * out * sgn;
      p.z += c * out * sgn;
      return out;
    }
    return 0;
  }

  /**
   * The best spot round (ahead `along`, `aside` to the right of the spawn's heading): level,
   * dry, low ground nearest the nominal point. Faces the previous stop (px, pz).
   */
  private pick(
    aside: number,
    along: number,
    px: number,
    pz: number,
    flat: number,
    blend: number,
    /** The height wanted, and the meadow's least and greatest. */
    want = 20,
    lowest = Config.eden.plateauMin,
    highest = Config.eden.plateauMax,
  ): EdenSite {
    const E = Config.eden;
    const f = this.base;
    // Spawn faces +z; its right is -x.
    const nx = -aside;
    const nz = along;
    let best = { x: nx, z: nz, score: Infinity };
    const rings = 5;
    for (let r = 0; r <= rings; r++) {
      const rad = (E.search * r) / rings;
      const n = r === 0 ? 1 : 6 + r * 4;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const x = nx + Math.sin(a) * rad;
        const z = nz + Math.cos(a) * rad;
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = 0; j < 8; j++) {
          const b = (j / 8) * TAU;
          for (const q of [0.5, 1]) {
            const h = f.height(x + Math.sin(b) * flat * q, z + Math.cos(b) * flat * q);
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        const h = f.height(x, z);
        const wet = Math.abs(f.riverDist(x, z)) < Config.highlands.plainWidth + flat ? 60 : 0;
        const score = (hi - lo) * 1.5 + Math.abs(h - want) + wet + rad * 0.04;
        if (score < best.score) best = { x, z, score };
      }
    }
    const y = clamp(f.height(best.x, best.z), lowest, highest);
    return {
      x: best.x,
      z: best.z,
      y,
      yaw: Math.atan2(px - best.x, pz - best.z),
      flat,
      blend,
    };
  }

  /** The lake's heart field at (x, z): below 0 inside (see `heartField`). */
  lakeField(x: number, z: number): number {
    const L = this.lake;
    const c = Math.cos(L.yaw);
    const s = Math.sin(L.yaw);
    const dx = x - L.x;
    const dz = z - L.z;
    // The heart's y (its lobes) along the lake's facing, its x across it.
    return heartField((dx * c - dz * s) / L.size, (dx * s + dz * c) / L.size);
  }

  /** Soft domes over the venue's tall trees, olive tree and chuppah. */
  private buildLifts(): Lift[] {
    const out: Lift[] = [];
    const y = this.venue.y;
    for (const t of this.venueTrees()) out.push({ x: t.x, z: t.z, r: 9, top: y + t.h + 1 });
    const o = this.toWorld(VENUE.olive.u, VENUE.olive.v);
    out.push({ x: o.x, z: o.z, r: 8, top: y + 7 });
    const ch = this.toWorld(VENUE.chuppah.u, VENUE.chuppah.v);
    out.push({ x: ch.x, z: ch.z, r: 6, top: y + VENUE.chuppah.height + 1 });
    return out;
  }

  /**
   * The venue's tall trees, in a horseshoe round the back with the open side toward the bird:
   * eucalyptus-like crowns and dark cypresses between them. Stable (no seed): it is one place.
   */
  venueTrees(): { x: number; z: number; h: number; cypress: boolean }[] {
    const T = VENUE.trees;
    const out: { x: number; z: number; h: number; cypress: boolean }[] = [];
    for (let i = 0; i < T.count; i++) {
      // Angle from +v (toward the bird) round to the back and on to the other side.
      const a = T.gap + ((TAU - 2 * T.gap) * (i + 0.5)) / T.count;
      const wob = Math.sin(i * 7.3) * 9;
      const u = Math.sin(a) * (T.radius + wob);
      const v = Math.cos(a) * (T.radius + wob);
      const p = this.toWorld(u, v);
      const cypress = i % 3 === 1;
      out.push({ x: p.x, z: p.z, h: cypress ? 15 + (i % 4) : 13 + ((i * 5) % 7), cypress });
    }
    return out;
  }

  /** The Highlands' land with a level meadow at each site, dry and unfarmed. */
  private reshape(): LandField {
    const base = this.base;
    const sites = this.sites;
    /** 0..1 how much of site i's meadow covers (x, z). */
    const weight = (S: EdenSite, x: number, z: number): number => {
      const d = Math.hypot(x - S.x, z - S.z);
      if (d >= S.blend) return 0;
      return 1 - smoothstep(S.flat, S.blend, d);
    };
    const height = (x: number, z: number): number => {
      let h = base.height(x, z);
      for (const S of sites) {
        const w = weight(S, x, z);
        if (w > 0) h = lerp(h, S.y, w);
      }
      // The heart-shaped lake, with soft banks.
      const L = this.lake;
      const dx = x - L.x;
      const dz = z - L.z;
      if (dx * dx + dz * dz < (L.size * 1.4) ** 2) {
        const m = smoothstep(0.05, -0.08, this.lakeField(x, z));
        if (m > 0) h = lerp(h, -Config.eden.lakeDepth, m);
      }
      return h;
    };
    const cover = (x: number, z: number): number => {
      let w = 0;
      for (const S of sites) w = Math.max(w, weight(S, x, z));
      return w;
    };
    return {
      height,
      tint: (x, z) => base.tint(x, z),
      forest: (x, z) => base.forest(x, z) * (1 - cover(x, z)),
      farm: (x, z) => base.farm(x, z) * (1 - cover(x, z)),
      // Rivers keep away from the meadows (the road and reeds follow).
      riverDist: (x, z) => {
        const d = base.riverDist(x, z);
        const w = cover(x, z);
        if (w <= 0) return d;
        const far = Math.max(Math.abs(d), w * 600);
        return d < 0 ? -far : far;
      },
    };
  }
}
