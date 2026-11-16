import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { hash2 } from '../noise';
import type { FjordLayout } from './FjordLayout';

/** Kinds of Aurora Fjords prop (index into the decor's meshes). */
export const P = {
  House: 0,
  Church: 1,
  Boathouse: 2,
  Jetty: 3,
  Rack: 4,
  Boat: 5,
  Boulder: 6,
  Seal: 7,
  Bird: 8,
  Floe: 9,
} as const;
export const PROP_KINDS = 10;

/**
 * Floats per prop: kind, x, y, z, yaw, move (a boat's or bird's circle radius, 0 = still),
 * sx, sy, sz, tint. A prop's local +z faces the water (a door, a gable, a jetty's far end).
 */
export const PROP_STRIDE = 10;

/** Footprint half sizes (x, z) and top at scale 1, per kind (the solids that lift the floor). */
export const FOOT: Record<number, [number, number, number]> = {
  [P.House]: [4.2, 3.4, 7.6],
  [P.Church]: [7.6, 3.9, 19.5],
  [P.Boathouse]: [2.9, 4.7, 5.9],
  [P.Jetty]: [1.3, 10, 1.6],
  [P.Rack]: [6.2, 1.4, 3.4],
};

/** A jetty's deck runs this far either side of its centre, along its local z. */
export const JETTY_HALF = 10;
/** Bank (m from the water's edge) of a village's street, and its half width. */
export const STREET_BANK = 21;
export const STREET_HALF = 2.6;

/** Paint colours of the wooden houses (sRGB): falu red, ochre yellow, white, a few others. */
export const HOUSE_PAINTS = ['#a3343a', '#d6a13f', '#ece6da', '#9e3a2e', '#c98a3a', '#6f8a8f'];

export interface Village {
  /** Centre on the strand, at the street's bank. */
  x: number;
  z: number;
  /** Along the shore (u) and inland (v), unit vectors. */
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  /** Which side of its fjord's centre line it stands (the fjord noise's sign there). */
  side: number;
  /** Metres along the shore either side of the centre that the houses span. */
  span: number;
  home: boolean;
  seed: number;
  /** Prop records (PROP_STRIDE), filled the first time they are asked for. */
  parts: number[] | null;
  /** Solids that lift the flight floor: x, z, cos yaw, sin yaw, half x, half z, top. */
  solids: number[] | null;
  /** Along-shore offsets of the jetties (a lane runs up from each to the street). */
  lanes: number[];
}

export interface Fall {
  /** The lip, the foot of the wall and where the stream meets the water. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Width of the falling water (m). */
  w: number;
  /** Two strands side by side, or one. */
  strands: number;
  /** Inland unit vector at the foot (the wall faces the other way). */
  nx: number;
  nz: number;
  seed: number;
}

const CACHE = 2000;
const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

/** Scratch for `at`: a point on the shore frame and the inland normal there. */
const pt = { x: 0, z: 0, nx: 0, nz: 0 };

/**
 * Aurora Fjords' sites, pure and seeded (unit-tested): fishing villages on the strands (a home
 * village a little down the fjord from the spawn, on the right, and one at most per grid cell
 * elsewhere), each widening its strand to hold two rows of wooden houses either side of a
 * gravel street, boathouses on stilts at the water, jetties with boats moored, fish-drying
 * racks and sometimes a white church; and waterfalls down the walls (the first ahead of the
 * spawn), each from the plateau's lip to the wall's foot and on across the strand as a stream.
 */
export class FjordSites {
  readonly homeVillage: Village;
  readonly homeFall: Fall | null;
  private readonly villages = new Map<number, Village | null>();
  private readonly falls = new Map<number, Fall | null>();

  constructor(private readonly L: FjordLayout) {
    // The home waterfall's walk reads the strand, which villages widen: be readable from here.
    L.sites = this;
    this.homeVillage = this.placeHome();
    this.homeFall = this.placeHomeFall();
  }

  // --- Frames ----------------------------------------------------------------------------------

  /**
   * The point at `bank` metres from the water near (x, z), moved along the local normal of the
   * shore (two Newton steps on the signed distance), and the inland normal there: into `pt`.
   */
  private at(x: number, z: number, bank: number, side: number): typeof pt {
    const L = this.L;
    for (let k = 0; k < 5; k++) {
      const b = L.fjord(x, z);
      const g = Math.max(Math.hypot(L.fgx, L.fgz), 1e-9);
      // Inland: away from the centre line, on this side of it.
      pt.nx = (side * L.fgx) / g;
      pt.nz = (side * L.fgz) / g;
      x += pt.nx * (bank - b);
      z += pt.nz * (bank - b);
    }
    pt.x = x;
    pt.z = z;
    return pt;
  }

  private makeVillage(x: number, z: number, side: number, seed: number, home: boolean): Village {
    const p = this.at(x, z, STREET_BANK, side);
    const span = home ? 70 : 42 + 40 * seed;
    return {
      x: p.x,
      z: p.z,
      ux: -p.nz,
      uz: p.nx,
      vx: p.nx,
      vz: p.nz,
      side,
      span,
      home,
      seed,
      parts: null,
      solids: null,
      lanes: [],
    };
  }

  /** Down the fjord from the spawn, then across to the strand on the bird's right. */
  private placeHome(): Village {
    const L = this.L;
    const S = L.spawn;
    let x = S.x;
    let z = S.z;
    let h = S.yaw;
    for (let d = 0; d < Config.fjord.villageAhead; d += 10) {
      h = L.heading(x, z, h);
      x += Math.sin(h) * 10;
      z += Math.cos(h) * 10;
    }
    // The bird's right is (-cos h, sin h): the side whose inland normal points that way.
    L.fjord(x, z);
    const side = -Math.cos(h) * L.fgx + Math.sin(h) * L.fgz >= 0 ? 1 : -1;
    return this.makeVillage(x, z, side, 0.6, true);
  }

  /** The village whose centre lies in grid cell (i, j), if any (not the home one). Cached. */
  village(i: number, j: number): Village | null {
    const k = key(i, j);
    const hit = this.villages.get(k);
    if (hit !== undefined) return hit;
    if (this.villages.size > CACHE) this.villages.clear();
    const K = Config.fjord;
    const C = K.villageCell;
    const s = this.L.seed;
    let v: Village | null = null;
    if (hash2(i, j, s + 431) < K.villageChance) {
      let x = (i + 0.15 + 0.7 * hash2(i, j, s + 432)) * C;
      let z = (j + 0.15 + 0.7 * hash2(i, j, s + 433)) * C;
      const c = { x: 0, z: 0 };
      for (let n = 0; n < 6; n++) {
        this.L.toCentre(x, z, c);
        x = c.x;
        z = c.z;
      }
      const H = this.homeVillage;
      const inCell = x >= i * C && x < (i + 1) * C && z >= j * C && z < (j + 1) * C;
      // On a fjord (the Newton steps found its centre line), not crowding the home village,
      // the spawn reach or the lighthouse.
      if (
        inCell &&
        this.L.fjord(x, z) < -this.L.fw * 0.6 &&
        Math.hypot(x - H.x, z - H.z) > 650 &&
        Math.hypot(x - this.L.spawn.x, z - this.L.spawn.z) > 450
      ) {
        const side = hash2(i, j, s + 434) < 0.5 ? 1 : -1;
        v = this.makeVillage(x, z, side, hash2(i, j, s + 435), false);
      }
    }
    this.villages.set(k, v);
    return v;
  }

  /**
   * Every village whose reach might cover (x, z), written into `out` (cleared first) and
   * returned. The hot queries (the terrain, the flight floor) each pass their own array, so
   * nothing allocates and a nested query never clobbers an outer one's list.
   */
  gather(x: number, z: number, reach: number, out: Village[]): Village[] {
    out.length = 0;
    const H = this.homeVillage;
    if (Math.abs(x - H.x) < reach && Math.abs(z - H.z) < reach) out.push(H);
    const C = Config.fjord.villageCell;
    for (let j = Math.floor((z - reach) / C); j <= Math.floor((z + reach) / C); j++)
      for (let i = Math.floor((x - reach) / C); i <= Math.floor((x + reach) / C); i++) {
        const v = this.village(i, j);
        if (v && Math.abs(x - v.x) < reach && Math.abs(z - v.z) < reach) out.push(v);
      }
    return out;
  }

  /** Calls `fn` with every village whose reach might cover (x, z) (planning, tests). */
  near(x: number, z: number, reach: number, fn: (v: Village) => void): void {
    for (const v of this.gather(x, z, reach, [])) fn(v);
  }

  private readonly gShelf: Village[] = [];
  private readonly gBuilt: Village[] = [];
  private readonly gStreet: Village[] = [];
  private readonly gFalls: Fall[] = [];

  /** Width the strand widens to round a village at (x, z) on side `side` (0 if none). */
  villageShelf(x: number, z: number, side: number): number {
    const K = Config.fjord;
    const R = K.villageReach;
    let w = 0;
    const list = this.gather(x, z, R, this.gShelf);
    for (let k = 0; k < list.length; k++) {
      const v = list[k];
      if (v.side !== side) continue;
      w = Math.max(w, smoothstep(R, R * 0.5, Math.hypot(x - v.x, z - v.z)));
    }
    return K.villageShelf * w;
  }

  // --- A village's plan --------------------------------------------------------------------------

  /** Its props and solids, planned the first time they are needed (heights read the terrain). */
  plan(v: Village): number[] {
    if (v.parts) return v.parts;
    const parts: number[] = [];
    const solids: number[] = [];
    v.parts = parts;
    v.solids = solids;
    const L = this.L;
    const s = L.seed + Math.round(v.x * 7 + v.z * 13);
    const r = (a: number, b: number) => hash2(a, b, s);
    const put = (
      kind: number,
      along: number,
      bank: number,
      sx: number,
      sy: number,
      sz: number,
      tint: number,
      turn = 0,
    ): boolean => {
      // Copied out of the shared scratch at once: the height queries below can plan another
      // village, whose frame reuses it.
      const q = this.at(v.x + v.ux * along, v.z + v.uz * along, bank, v.side);
      const p = { x: q.x, z: q.z, nx: q.nx, nz: q.nz };
      // A tight bend can defeat the shore frame: skip what did not land where it should.
      if (Math.abs(L.fjord(p.x, p.z) - bank) > 1.5) return false;
      if (Math.hypot(p.x - v.x - v.ux * along, p.z - v.z - v.uz * along) > 60) return false;
      const yaw = Math.atan2(-p.nx, -p.nz) + turn; // local +z toward the water
      const f = FOOT[kind];
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const hx = f ? f[0] * sx : 1;
      const hz = f ? f[1] * sz : 1;
      // Sit on the lowest corner (a foundation or stilts make up the rest).
      let y = Infinity;
      for (const [a, b] of [
        [-hx, -hz],
        [hx, -hz],
        [-hx, hz],
        [hx, hz],
        [0, 0],
      ])
        y = Math.min(y, L.height(p.x + a * c + b * sn, p.z - a * sn + b * c));
      if (kind === P.Boathouse || kind === P.Jetty) y = Math.max(y, 0.2);
      // Keep off the wall's foot: a building wants level ground.
      if (kind !== P.Jetty && kind !== P.Boathouse && L.height(p.x, p.z) - y > 2.5) return false;
      if (f) solids.push(p.x, p.z, c, sn, hx, hz, y + f[2] * sy);
      parts.push(kind, p.x, y, p.z, yaw, 0, sx, sy, sz, tint);
      return true;
    };
    const span = v.span;
    // Jetties and boathouses along the water's edge.
    const nJ = v.home ? 2 : 1 + Math.floor(r(1, 1) * 2.2);
    const taken: number[] = [];
    for (let k = 0; k < nJ; k++) {
      const a = (k + 0.5 - nJ / 2) * ((span * 1.5) / nJ) + (r(2, k) - 0.5) * 10;
      taken.push(a);
      v.lanes.push(a);
      if (!put(P.Jetty, a, -JETTY_HALF + 3, 1, 1, 1, r(3, k))) continue;
      // Boats moored either side of the jetty's far end, bows out.
      for (const sd of [-1, 1]) {
        if (r(4, k * 2 + sd) < 0.35) continue;
        put(P.Boat, a + sd * 4.2, -JETTY_HALF - 2 + r(5, k) * 4, 0.85, 0.85, 0.85, r(6, k + sd));
      }
    }
    const nB = 2 + Math.floor(r(7, 0) * 3);
    for (let k = 0; k < nB; k++) {
      const a = -span + (2 * span * (k + 0.5)) / nB + (r(8, k) - 0.5) * 8;
      if (taken.some((t) => Math.abs(t - a) < 9)) continue;
      taken.push(a);
      // Tarred dark or falu red, gable to the water, its foot in it.
      put(P.Boathouse, a, 1, 1, 0.9 + r(9, k) * 0.25, 1, r(10, k) < 0.6 ? 0.1 : 0.9);
    }
    // Houses: a row facing the water below the street, another above it.
    const church = v.home || r(11, 0) < 0.35;
    for (const [bank, step, skip] of [
      [12.5, 15, 0.22],
      [30, 17, 0.3],
    ] as const)
      for (let a = -span; a <= span; a += step) {
        const i = Math.round(a);
        const aa = a + (r(12, i + bank) - 0.5) * 4;
        if (r(13, i + bank) < skip) continue;
        if (church && bank > 20 && Math.abs(aa) < 15) continue;
        const big = r(14, i + bank);
        const sy = big > 0.7 ? 1.35 : 0.9 + big * 0.2; // now and then a two-storey house
        const tint = Math.floor(r(15, i + bank) * HOUSE_PAINTS.length) / HOUSE_PAINTS.length;
        put(P.House, aa, bank, 0.85 + r(16, i) * 0.35, sy, 0.9 + r(17, i) * 0.2, tint + 0.01);
      }
    if (church) put(P.Church, 0, 34, 1, 1, 1, 0.5);
    // Fish-drying racks beyond the houses at each end of the village, along the shore.
    const nR = 2 + Math.floor(r(18, 0) * 3);
    for (let k = 0; k < nR; k++) {
      const end = k % 2 ? 1 : -1;
      const a = end * (span + 14 + Math.floor(k / 2) * 9 + r(19, k) * 6);
      put(P.Rack, a, 16 + r(20, k) * 10, 0.8 + r(21, k) * 0.4, 1, 1, r(22, k), Math.PI);
    }
    return parts;
  }

  /** Solids of the villages near (x, z): the roof (or deck) top the flight floor rises to. */
  built(x: number, z: number): number {
    let top = -Infinity;
    const m = 2;
    const list = this.gather(x, z, Config.fjord.villageReach + 60, this.gBuilt);
    // Plan first (planning reads heights, which gather villages into their own lists).
    for (let k = 0; k < list.length; k++) if (!list[k].solids) this.plan(list[k]);
    for (let q = 0; q < list.length; q++) {
      const S = list[q].solids!;
      for (let k = 0; k < S.length; k += 7) {
        const dx = x - S[k];
        const dz = z - S[k + 1];
        if (Math.abs(dx) > 24 || Math.abs(dz) > 24) continue;
        const lx = dx * S[k + 2] - dz * S[k + 3];
        const lz = dx * S[k + 3] + dz * S[k + 2];
        if (Math.abs(lx) < S[k + 4] + m && Math.abs(lz) < S[k + 5] + m)
          top = Math.max(top, S[k + 6]);
      }
    }
    return top;
  }

  /**
   * Distance (over its half width) from (x, z) to the street or a lane of a village, or 99.
   * `bank` is the point's distance from the water (the caller has it).
   */
  street(x: number, z: number, bank: number): number {
    let d = 99;
    const list = this.gather(x, z, Config.fjord.villageReach, this.gStreet);
    for (let k = 0; k < list.length; k++) {
      const v = list[k];
      const a = (x - v.x) * v.ux + (z - v.z) * v.uz;
      if (Math.abs(a) > v.span + 30 || Math.hypot(x - v.x, z - v.z) > v.span + 70) continue;
      // Out past the houses the street narrows to a track and fades.
      const fade = smoothstep(v.span + 4, v.span + 30, Math.abs(a));
      d = Math.min(d, Math.abs(bank - STREET_BANK) / STREET_HALF + fade * 3);
      if (bank > 1 && bank < STREET_BANK)
        for (let q = 0; q < v.lanes.length; q++) d = Math.min(d, Math.abs(a - v.lanes[q]) / 1.5);
    }
    return d;
  }

  // --- Waterfalls ----------------------------------------------------------------------------

  /**
   * A waterfall on side `side` of the fjord whose centre line passes near (x, z): walking
   * inland from the water, the stream's mouth, the wall's foot and its lip; null if the wall
   * there drops less than `fallDrop` or the walk finds no wall.
   */
  private makeFall(x: number, z: number, side: number, seed: number): Fall | null {
    const L = this.L;
    const K = Config.fjord;
    let x2 = NaN;
    let z2 = NaN;
    let x1 = NaN;
    let z1 = NaN;
    let nx = 0;
    let nz = 0;
    for (let k = 0; k < 140; k++) {
      const b = L.fjord(x, z);
      const g = Math.max(Math.hypot(L.fgx, L.fgz), 1e-9);
      const sx = (side * L.fgx) / g;
      const sz = (side * L.fgz) / g;
      if (Number.isNaN(x2) && b >= 0.5) {
        x2 = x;
        z2 = z;
      }
      if (Number.isNaN(x1) && b >= L.shelf(x, z) + 1.5) {
        x1 = x;
        z1 = z;
        nx = sx;
        nz = sz;
      }
      if (!Number.isNaN(x1) && b >= L.shelf(x, z) + K.wall * 0.9) {
        if (L.height(x, z) - L.height(x1, z1) < K.fallDrop) return null;
        return {
          x0: x,
          z0: z,
          x1,
          z1,
          x2,
          z2,
          w: 5 + 7 * seed,
          strands: seed > 0.62 ? 2 : 1,
          nx,
          nz,
          seed,
        };
      }
      x += sx * 3;
      z += sz * 3;
    }
    return null;
  }

  /** The first waterfall: down the fjord from the spawn, on whichever wall is tall enough. */
  private placeHomeFall(): Fall | null {
    const L = this.L;
    const S = L.spawn;
    let x = S.x;
    let z = S.z;
    let h = S.yaw;
    const c = { x: 0, z: 0 };
    for (let d = 0; d < Config.fjord.fallAhead + 400; d += 10) {
      h = L.heading(x, z, h);
      x += Math.sin(h) * 10;
      z += Math.cos(h) * 10;
      if (d < Config.fjord.fallAhead || d % 50 !== 0) continue;
      L.toCentre(x, z, c);
      L.fjord(c.x, c.z);
      const right = -Math.cos(h) * L.fgx + Math.sin(h) * L.fgz >= 0 ? 1 : -1;
      for (const side of [right, -right]) {
        const f = this.makeFall(c.x, c.z, side, 0.55);
        if (f && this.fallOk(f)) return f;
      }
    }
    return null;
  }

  /** Clear of the villages (a stream through the houses) and the lighthouse. */
  private fallOk(f: Fall): boolean {
    let ok = true;
    const R = Config.fjord.villageReach;
    this.near(f.x1, f.z1, R + 40, (v) => {
      if (Math.hypot(f.x1 - v.x, f.z1 - v.z) < R + 30) ok = false;
    });
    const H = this.L.lighthouse;
    return ok && Math.hypot(f.x2 - H.x, f.z2 - H.z) > 60;
  }

  /** The waterfall in grid cell (i, j), if any (not the home one). Cached. */
  fall(i: number, j: number): Fall | null {
    const k = key(i, j);
    const hit = this.falls.get(k);
    if (hit !== undefined) return hit;
    if (this.falls.size > CACHE) this.falls.clear();
    const K = Config.fjord;
    const C = K.fallCell;
    const s = this.L.seed;
    let f: Fall | null = null;
    if (hash2(i, j, s + 441) < K.fallChance) {
      let x = (i + 0.1 + 0.8 * hash2(i, j, s + 442)) * C;
      let z = (j + 0.1 + 0.8 * hash2(i, j, s + 443)) * C;
      const c = { x: 0, z: 0 };
      for (let n = 0; n < 6; n++) {
        this.L.toCentre(x, z, c);
        x = c.x;
        z = c.z;
      }
      const H = this.homeFall;
      if (
        x >= i * C &&
        x < (i + 1) * C &&
        z >= j * C &&
        z < (j + 1) * C &&
        this.L.fjord(x, z) < -this.L.fw * 0.6 &&
        (!H || Math.hypot(x - H.x2, z - H.z2) > 300)
      ) {
        f = this.makeFall(x, z, hash2(i, j, s + 444) < 0.5 ? 1 : -1, hash2(i, j, s + 445));
        if (f && !this.fallOk(f)) f = null;
      }
    }
    this.falls.set(k, f);
    return f;
  }

  /** Every waterfall whose cell lies within `reach` of (x, z), into `out` (cleared first). */
  gatherFalls(x: number, z: number, reach: number, out: Fall[]): Fall[] {
    out.length = 0;
    const H = this.homeFall;
    if (H && Math.abs(x - H.x1) < reach + 200 && Math.abs(z - H.z1) < reach + 200) out.push(H);
    const C = Config.fjord.fallCell;
    for (let j = Math.floor((z - reach) / C); j <= Math.floor((z + reach) / C); j++)
      for (let i = Math.floor((x - reach) / C); i <= Math.floor((x + reach) / C); i++) {
        const f = this.fall(i, j);
        if (f) out.push(f);
      }
    return out;
  }

  /**
   * Wetness round the waterfalls: distance from (x, z) to the nearest fall's line (lip to foot
   * to the water) over a band a little wider than the water, or 99. Spray darkens the rock and
   * greens the strand there.
   */
  wet(x: number, z: number): number {
    let d = 99;
    const list = this.gatherFalls(x, z, 200, this.gFalls);
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      const band = f.w * (f.strands > 1 ? 1.4 : 0.8) + 7;
      d = Math.min(
        d,
        segDist(x, z, f.x0, f.z0, f.x1, f.z1) / band,
        segDist(x, z, f.x1, f.z1, f.x2, f.z2) / (band * 0.6),
      );
    }
    return d;
  }
}

/** Distance from (x, z) to the segment a-b. */
export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / l2, 0), 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
