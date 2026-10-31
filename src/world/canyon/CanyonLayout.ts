import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, type Noise2D } from '../noise';

/**
 * Red Canyons' plan as one pure, seeded function of position (no Three.js, unit-tested):
 * canyons along the zero contours of a low-frequency noise, each a sandy floor with a green
 * river down its middle, walled by bands of rock (a cliff over a bench, four times) up to a
 * desert plateau that throws up flat-topped mesas away from the rims. Stone arches stand
 * across the canyon floors (the Great Arch ahead of the spawn) and out on the plateau, and
 * hoodoos crowd the rims and benches. The terrain, collisions and wisp planner all read it.
 */

/**
 * A stone arch. Its opening is half an ellipse `r` wide either side of the centre and `h`
 * high above the springing line `y0`, facing along `yaw` (the way through it); the rock is
 * the band out to ARCH_OUT_X / ARCH_OUT_Y times that, `d` deep, and its legs reach ARCH_LEG
 * times `h` below the springing line into the ground.
 */
export interface Arch {
  x: number;
  z: number;
  y0: number;
  yaw: number;
  r: number;
  h: number;
  d: number;
  seed: number;
  /** Stands across a canyon floor (ribbons thread it), not out on the plateau. */
  canyon: boolean;
}

/** A hoodoo: a banded spire with a cap rock, radius `r` at its foot, `h` tall from `y0`. */
export interface Hoodoo {
  x: number;
  z: number;
  y0: number;
  r: number;
  h: number;
  yaw: number;
  slim: boolean;
}

export const ARCH_OUT_X = 1.3;
export const ARCH_OUT_Y = 1.24;
export const ARCH_LEG = 0.45;
/** A hoodoo's solid radius as a share of its foot (it waists in above the base). */
export const HOODOO_CORE = 0.62;

const CELL_CACHE = 6000;
/**
 * hash2 of a grid cell, offset far from the origin: hash2(-x, -z) equals hash2(x, z) when both
 * are odd, which would stand identical arches in cells mirrored through the spawn.
 */
const cellHash = (i: number, j: number, seed: number) => hash2(i + 7919, j + 4513, seed);
/** Floor heights reach this at most (dunes included): anything higher is wall, rim or mesa. */
const FLOOR_TOP = 4.8;

export class CanyonLayout {
  readonly seed: number;
  readonly spawn = { x: 0, y: 26, z: 0, yaw: 0 };
  readonly great: Arch = { x: 0, z: 0, y0: 0, yaw: 0, r: 1, h: 1, d: 1, seed: 0, canyon: true };
  /** The last solid a query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);
  /** Scratch results of `canyon()`: noise value, its gradient (per metre), distance, half width. */
  cv = 0;
  cgx = 0;
  cgz = 0;
  cd = 0;
  cw = 0;
  private greatOn = false;
  private widen = 0;
  private readonly nCanyon: Noise2D;
  private readonly nWidth: Noise2D;
  private readonly nRiver: Noise2D;
  private readonly nPlateau: Noise2D;
  private readonly nMesa: Noise2D;
  private readonly nLedge: Noise2D;
  private readonly nDune: Noise2D;
  private readonly nScrub: Noise2D;
  private readonly nHoodoo: Noise2D;
  private readonly arches = new Map<number, Arch | null>();
  private readonly hoodoos = new Map<number, Hoodoo | null>();
  /** Scratch list of the arches near the last `nearArches` query (great arch included). */
  private readonly near: Arch[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.nCanyon = createNoise2D(seed + 601);
    this.nWidth = createNoise2D(seed + 602);
    this.nRiver = createNoise2D(seed + 603);
    this.nPlateau = createNoise2D(seed + 604);
    this.nMesa = createNoise2D(seed + 605);
    this.nLedge = createNoise2D(seed + 606);
    this.nDune = createNoise2D(seed + 607);
    this.nScrub = createNoise2D(seed + 608);
    this.nHoodoo = createNoise2D(seed + 609);
    this.findSpawn();
    this.placeGreat();
  }

  // --- Canyons ---------------------------------------------------------------------------------

  private canyonNoise(x: number, z: number): number {
    const f = Config.canyon.canyonScale;
    return fbm(this.nCanyon, x * f, z * f, 2);
  }

  /**
   * Signed distance (m) from (x, z) to the foot of the nearest canyon wall: negative on the
   * floor. Canyons run along the zero contour of a noise; distance to it is |n| / |grad n|
   * (first order), as with the fjords. Leaves the noise, gradient, centre-line distance and the
   * floor's half width in cv, cgx/cgz, cd and cw.
   */
  canyon(x: number, z: number): number {
    const e = 4;
    const v = this.canyonNoise(x, z);
    const gx = (this.canyonNoise(x + e, z) - v) / e;
    const gz = (this.canyonNoise(x, z + e) - v) / e;
    const g = Math.max(Math.hypot(gx, gz), 1e-6);
    this.cv = v;
    this.cgx = gx;
    this.cgz = gz;
    this.cd = Math.abs(v) / g;
    const K = Config.canyon;
    let w = K.floorMin + (K.floorMax - K.floorMin) * (0.5 + 0.5 * this.nWidth(x * 7e-4, z * 7e-4));
    // The floor opens out round the Great Arch so its legs stand on sand, not in the wall.
    if (this.greatOn) {
      const q = ((x - this.great.x) ** 2 + (z - this.great.z) ** 2) / (170 * 170);
      if (q < 9) w += this.widen * Math.exp(-q);
    }
    this.cw = w;
    return this.cd - w;
  }

  /** Half width of the river down the middle of the floor here (m). */
  river(x: number, z: number): number {
    const K = Config.canyon;
    return K.riverMin + (K.riverMax - K.riverMin) * (0.5 + 0.5 * this.nRiver(x * 0.003, z * 0.003));
  }

  /** Direction along the canyon at (x, z), the one closer to `yaw`. */
  heading(x: number, z: number, yaw: number): number {
    this.canyon(x, z);
    const a = Math.atan2(-this.cgz, this.cgx); // along the contour: perpendicular to the gradient
    return Math.sin(a) * Math.sin(yaw) + Math.cos(a) * Math.cos(yaw) >= 0 ? a : a + Math.PI;
  }

  /** One Newton step from (x, z) toward the canyon's centre line; writes into `out`. */
  toCentre(x: number, z: number, out: { x: number; z: number }): void {
    this.canyon(x, z);
    const g2 = Math.max(this.cgx * this.cgx + this.cgz * this.cgz, 1e-12);
    out.x = x - (this.cv * this.cgx) / g2;
    out.z = z - (this.cv * this.cgz) / g2;
  }

  /** Spawn on the canyon nearest the origin, mid-channel, facing along it. */
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
        if (this.canyon(x, z) < -this.cw * 0.8 && Math.hypot(x, z) < best) {
          best = Math.hypot(x, z);
          bx = x;
          bz = z;
        }
      }
    this.spawn.x = bx;
    this.spawn.z = bz;
    this.spawn.yaw = this.heading(bx, bz, 0);
  }

  /** The Great Arch stands across the floor down the canyon from the spawn, facing up it. */
  private placeGreat(): void {
    const K = Config.canyon;
    const S = this.spawn;
    const c = { x: 0, z: 0 };
    let x = S.x;
    let z = S.z;
    let h = S.yaw;
    for (let d = 0; d < K.greatAhead; d += 10) {
      h = this.heading(x, z, h);
      x += Math.sin(h) * 10;
      z += Math.cos(h) * 10;
      this.toCentre(x, z, c);
      x = c.x;
      z = c.z;
    }
    const G = this.great;
    G.x = x;
    G.z = z;
    G.yaw = this.heading(x, z, h);
    G.r = K.greatSpan;
    G.h = K.greatRise;
    G.d = 16;
    G.seed = 0.37;
    this.canyon(x, z);
    // Room for the legs plus a strip of sand beyond them.
    this.widen = Math.max(0, K.greatSpan * ARCH_OUT_X + 14 - this.cw);
    this.greatOn = true;
    G.y0 = this.legFloor(G) - 0.4;
  }

  /** Lowest ground under either leg of an arch (sampled across each leg's foot). */
  private legFloor(a: Arch): number {
    const c = Math.cos(a.yaw);
    const s = Math.sin(a.yaw);
    let lo = Infinity;
    for (const side of [-1, 1])
      for (const f of [1, 1.15, 1.3]) {
        const u = side * a.r * f;
        lo = Math.min(lo, this.height(a.x + u * c, a.z - u * s));
      }
    return lo;
  }

  // --- Ground ----------------------------------------------------------------------------------

  /** 0..1 rock band profile up a wall: four cliffs, each over a bench, at uneven heights. */
  private stepped(t: number): number {
    const K = Config.canyon;
    const n = K.bands;
    const tt = t * n;
    const k = Math.min(Math.floor(tt), n - 1);
    const f = tt - k;
    const band = (i: number) => (i <= 0 ? 0 : i >= n ? 1 : (i + 0.22 * Math.sin(i * 2.3 + 1)) / n);
    const lo = band(k);
    const hi = band(k + 1);
    return lo + (hi - lo) * (smoothstep(0, K.cliff, f) * 0.88 + 0.12 * smoothstep(K.cliff, 1, f));
  }

  /** Height of the rim (and the plateau behind it, before mesas) here. */
  rim(x: number, z: number): number {
    const K = Config.canyon;
    return K.plateau + K.plateauVar * fbm(this.nPlateau, x * 0.0012, z * 0.0012, 3);
  }

  /** 0..1 how much a mesa rises here (before fading toward the canyons). */
  private mesaShape(x: number, z: number): number {
    const m = fbm(this.nMesa, x * 0.0016, z * 0.0016, 2);
    // A talus skirt, the sheer walls of the table, then now and then a butte stepped on top.
    return (
      0.12 * smoothstep(0.16, 0.3, m) +
      0.58 * smoothstep(0.3, 0.325, m) +
      0.3 * smoothstep(0.43, 0.45, m)
    );
  }

  /**
   * Terrain: a river bed, a sandy floor rising gently to the wall's foot, then the wall's rock
   * bands up to the rim. The ledges meander (the band profile is read at a shifted distance,
   * so the strata stay level), and beyond the rim the plateau swells into mesas.
   */
  height(x: number, z: number): number {
    const K = Config.canyon;
    const bank = this.canyon(x, z);
    const d = this.cd;
    const w = this.cw;
    const rw = this.river(x, z);
    const s = d - rw;
    const dune = this.nDune(x * 0.02, z * 0.02);
    const floor =
      0.6 + 2.6 * smoothstep(0, Math.max(w - rw, 1), s) + 0.7 * dune * smoothstep(3, 12, s);
    let y = lerp(-5 + 1.5 * this.nDune(x * 0.01, z * 0.01), floor, smoothstep(-7, 1.5, s));
    if (bank > 0) {
      const t0 = bank / K.wall;
      const wob = fbm(this.nLedge, x * 0.011, z * 0.011, 2) * 0.07 * smoothstep(0, 0.12, t0);
      const t = clamp(t0 + wob, 0, 1);
      y = floor + (this.rim(x, z) - floor) * this.stepped(t);
      // Fallen blocks and gullies roughen the cliffs a little without tilting the strata.
      y += 2.2 * this.nLedge(x * 0.06, z * 0.06) * Math.sin(Math.PI * t);
      if (bank > K.wall + 50)
        y += this.mesaShape(x, z) * K.mesa * smoothstep(K.wall + 50, K.wall + 240, bank);
    }
    return y;
  }

  /** What the bird flies over: the terrain (scrub and juniper are too small to skim). */
  ground(x: number, z: number): number {
    return this.height(x, z);
  }

  /** 0..1 sagebrush and juniper cover: patchy everywhere dry, thickest on the plateau. */
  scrub(x: number, z: number): number {
    return smoothstep(-0.35, 0.4, fbm(this.nScrub, x * 0.008, z * 0.008, 2));
  }

  // --- Arches ----------------------------------------------------------------------------------

  /** The arch in grid cell (i, j), if any (the Great Arch is separate). Cached; pure per seed. */
  arch(i: number, j: number): Arch | null {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    const got = this.arches.get(key);
    if (got !== undefined) return got;
    if (this.arches.size > CELL_CACHE) this.arches.clear();
    const a = this.makeArch(i, j);
    this.arches.set(key, a);
    return a;
  }

  private makeArch(i: number, j: number): Arch | null {
    const K = Config.canyon;
    const C = K.archCell;
    const s = this.seed;
    if (cellHash(i, j, s + 611) > 0.7) return null;
    let x = (i + 0.2 + 0.6 * cellHash(i, j, s + 612)) * C;
    let z = (j + 0.2 + 0.6 * cellHash(i, j, s + 613)) * C;
    const bank = this.canyon(x, z);
    const S = this.spawn;
    const G = this.great;
    if (bank < K.wall * 0.6) {
      // In a canyon: snap to its centre line and stand across the floor.
      const c = { x: 0, z: 0 };
      for (let k = 0; k < 6; k++) {
        this.toCentre(x, z, c);
        x = c.x;
        z = c.z;
      }
      // Keep to the cell's middle (so neighbours never crowd), clear of the opening reach and
      // the Great Arch, on a straight stretch (ribbons thread it head on).
      const m = 0.15 * C;
      if (x < i * C + m || x > (i + 1) * C - m || z < j * C + m || z > (j + 1) * C - m) return null;
      if (Math.hypot(x - S.x, z - S.z) < K.greatAhead + 160) return null;
      if (Math.hypot(x - G.x, z - G.z) < 300) return null;
      const yaw = this.heading(x, z, cellHash(i, j, s + 614) * Math.PI * 2);
      for (const d of [-60, 60]) {
        const h = this.heading(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d, yaw);
        if (Math.abs(angleDelta(yaw, h)) > 0.3) return null;
      }
      // The snap must have landed on the centre line (from far off it can wander).
      if (this.canyon(x, z) > -this.cw * 0.8) return null;
      const floor = this.cw;
      const rw = this.river(x, z);
      const r = Math.min((floor * 0.88) / ARCH_OUT_X, 40);
      if (r < Math.max(rw + 5, 20)) return null;
      const a: Arch = {
        x,
        z,
        y0: 0,
        yaw,
        r,
        h: r * (0.95 + 0.45 * cellHash(i, j, s + 615)),
        d: 9 + 6 * cellHash(i, j, s + 616),
        seed: cellHash(i, j, s + 617),
        canyon: true,
      };
      a.y0 = this.legFloor(a) - 0.4;
      return a;
    }
    if (bank < K.wall + 120) return null;
    // Out on the plateau: a fin of rock with a window through it, on level ground.
    const r = 12 + 14 * cellHash(i, j, s + 615);
    const a: Arch = {
      x,
      z,
      y0: 0,
      yaw: cellHash(i, j, s + 614) * Math.PI * 2,
      r,
      h: r * (0.9 + 0.6 * cellHash(i, j, s + 616)),
      d: 6 + 4 * cellHash(i, j, s + 618),
      seed: cellHash(i, j, s + 617),
      canyon: false,
    };
    const lo = this.legFloor(a);
    const c = Math.cos(a.yaw);
    const sn = Math.sin(a.yaw);
    let hi = -Infinity;
    for (const f of [-1.3, -0.6, 0, 0.6, 1.3]) {
      const u = f * r;
      hi = Math.max(hi, this.height(x + u * c, z - u * sn));
    }
    if (hi - lo > Math.min(6, a.h * 0.2)) return null;
    a.y0 = lo - 0.5;
    return a;
  }

  /** Every arch whose rock might lie near (x, z): the Great Arch and the nearby cells' arches. */
  nearArches(x: number, z: number): Arch[] {
    const N = this.near;
    N.length = 0;
    const G = this.great;
    if (Math.abs(x - G.x) < 160 && Math.abs(z - G.z) < 160) N.push(G);
    const C = Config.canyon.archCell;
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++) {
        const a = this.arch(i, j);
        if (a && Math.abs(x - a.x) < 120 && Math.abs(z - a.z) < 120) N.push(a);
      }
    return N;
  }

  /**
   * Is the point inside the arch's rock grown by `margin`? Writes the rock's top over the
   * point and its underside (the opening's roof, or the legs' foot) into `hit`.
   */
  inArch(a: Arch, x: number, y: number, z: number, margin: number): boolean {
    const dx = x - a.x;
    const dz = z - a.z;
    const c = Math.cos(a.yaw);
    const s = Math.sin(a.yaw);
    const u = Math.abs(dx * c - dz * s);
    const v = dx * s + dz * c;
    if (Math.abs(v) > a.d / 2 + margin) return false;
    const ox = a.r * ARCH_OUT_X + margin;
    const oy = a.h * ARCH_OUT_Y + margin;
    const yy = y - a.y0;
    if (u > ox || yy < -a.h * ARCH_LEG - margin || yy > oy) return false;
    if (yy > 0 && (u / ox) ** 2 + (yy / oy) ** 2 > 1) return false;
    const ix = a.r - margin;
    const iy = a.h - margin;
    const open = ix > 0 && iy > 0 && u < ix;
    if (open && (yy < 0 || (u / ix) ** 2 + (yy / iy) ** 2 < 1)) return false;
    const H = this.hit;
    H[0] = a.x - ox;
    H[1] = open ? a.y0 + iy * Math.sqrt(Math.max(0, 1 - (u / ix) ** 2)) : a.y0 - a.h * ARCH_LEG;
    H[2] = a.z - ox;
    H[3] = a.x + ox;
    H[4] = a.y0 + oy * Math.sqrt(Math.max(0, 1 - (u / ox) ** 2));
    H[5] = a.z + ox;
    return true;
  }

  /** Top of the arch's rock over (x, z), or -Infinity if the point is off its footprint. */
  archTop(a: Arch, x: number, z: number): number {
    const dx = x - a.x;
    const dz = z - a.z;
    const u = Math.abs(dx * Math.cos(a.yaw) - dz * Math.sin(a.yaw));
    const v = dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw);
    const ox = a.r * ARCH_OUT_X;
    if (Math.abs(v) > a.d / 2 || u > ox) return -Infinity;
    return a.y0 + a.h * ARCH_OUT_Y * Math.sqrt(1 - (u / ox) ** 2);
  }

  // --- Hoodoos ---------------------------------------------------------------------------------

  /** The hoodoo in grid cell (i, j), if any. Cached; pure per seed. */
  hoodoo(i: number, j: number): Hoodoo | null {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    const got = this.hoodoos.get(key);
    if (got !== undefined) return got;
    if (this.hoodoos.size > CELL_CACHE * 4) this.hoodoos.clear();
    const hd = this.makeHoodoo(i, j);
    this.hoodoos.set(key, hd);
    return hd;
  }

  private makeHoodoo(i: number, j: number): Hoodoo | null {
    const K = Config.canyon;
    const C = K.hoodooCell;
    const s = this.seed;
    const x = (i + 0.15 + 0.7 * cellHash(i, j, s + 621)) * C;
    const z = (j + 0.15 + 0.7 * cellHash(i, j, s + 622)) * C;
    // Crowds of them along the rims (the breaks), thinner on the benches below.
    const crowd = smoothstep(-0.05, 0.45, fbm(this.nHoodoo, x * 0.006, z * 0.006, 2));
    if (crowd <= 0) return null;
    const bank = this.canyon(x, z);
    let p = 0;
    if (bank > K.wall + 4 && bank < K.wall + 170) p = 0.55 * crowd;
    else if (bank > K.wall * 0.3 && bank < K.wall) p = 0.25 * crowd;
    if (cellHash(i, j, s + 623) > p) return null;
    const r = 1.8 + 2.4 * cellHash(i, j, s + 624);
    const y = this.height(x, z);
    // Only on a level spot: a bench or the flat behind the rim, not a cliff face.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      if (Math.abs(this.height(x + Math.sin(a) * r * 1.5, z + Math.cos(a) * r * 1.5) - y) > 2.5)
        return null;
    }
    const tall = cellHash(i, j, s + 625);
    const hd: Hoodoo = {
      x,
      z,
      y0: y - 1,
      r,
      h: 9 + 22 * tall * tall,
      yaw: cellHash(i, j, s + 626) * Math.PI * 2,
      slim: cellHash(i, j, s + 627) < 0.5,
    };
    // Never inside an arch's rock.
    for (const a of this.nearArches(x, z))
      if (this.inArch(a, x, hd.y0 + hd.h * 0.5, z, r + 4)) return null;
    return hd;
  }

  /** Inside a hoodoo (grown by margin)? Writes its box into `hit`. */
  private inHoodoo(hd: Hoodoo, x: number, y: number, z: number, margin: number): boolean {
    if (y < hd.y0 - margin || y > hd.y0 + hd.h + margin) return false;
    const rc = hd.r * HOODOO_CORE;
    if (Math.hypot(x - hd.x, z - hd.z) > rc + margin) return false;
    const H = this.hit;
    H[0] = hd.x - rc;
    H[1] = hd.y0;
    H[2] = hd.z - rc;
    H[3] = hd.x + rc;
    H[4] = hd.y0 + hd.h;
    H[5] = hd.z + rc;
    return true;
  }

  /** The hoodoo whose core contains the point grown by margin, or null. */
  private hoodooAt(x: number, y: number, z: number, margin: number): Hoodoo | null {
    const C = Config.canyon.hoodooCell;
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++) {
        const hd = this.hoodoo(i, j);
        if (hd && this.inHoodoo(hd, x, y, z, margin)) return hd;
      }
    return null;
  }

  /** Highest top of any hoodoo within `radius` (m) of (x, z), or -Infinity. */
  hoodooTopNear(x: number, z: number, radius: number): number {
    const C = Config.canyon.hoodooCell;
    const n = Math.ceil(radius / C) + 1;
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    let top = -Infinity;
    for (let j = cj - n; j <= cj + n; j++)
      for (let i = ci - n; i <= ci + n; i++) {
        const hd = this.hoodoo(i, j);
        if (hd && Math.hypot(x - hd.x, z - hd.z) < radius + hd.r) top = Math.max(top, hd.y0 + hd.h);
      }
    return top;
  }

  /** Top of a hoodoo standing under (x, z), or -Infinity. */
  hoodooTop(x: number, z: number): number {
    const hd = this.hoodooAt(x, -Infinity, z, 0);
    return hd ? hd.y0 + hd.h : -Infinity;
  }

  // --- Solids ----------------------------------------------------------------------------------

  /**
   * Top of whatever solid contains the point grown by `margin`, or -Infinity: an arch, a
   * hoodoo, or a wall (terrain above the floor), so the city's look-ahead veers along the
   * canyon instead of climbing into the rock, and eases under an arch's span. Same contract
   * as the city's boxes.
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    for (const a of this.nearArches(x, z)) if (this.inArch(a, x, y, z, margin)) return this.hit[4];
    if (y < Config.canyon.plateau + Config.canyon.mesa + 60 && this.hoodooAt(x, y, z, margin))
      return this.hit[4];
    const g = this.height(x, z);
    if (g < FLOOR_TOP || y > g + margin) return -Infinity;
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
   * Push a point out of an arch or a hoodoo (grown by margin), the shortest way: for an arch
   * up over its back, down under its span, out of its legs or off its faces; for a hoodoo
   * straight out from its axis or up over its cap. Terrain is the flight model's floor, not
   * pushed here. Returns the distance moved; the normal goes in `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let moved = 0;
    // An arch's surface is curved, so one step can land just short: settle in a few.
    for (let k = 0; k < 4; k++) {
      let any = false;
      for (const a of this.nearArches(p.x, p.z))
        if (this.inArch(a, p.x, p.y, p.z, margin)) {
          moved += this.pushArch(a, p, margin, n);
          any = true;
          break;
        }
      if (!any) break;
    }
    const hd = this.hoodooAt(p.x, p.y, p.z, margin);
    if (hd) moved += this.pushHoodoo(hd, p, margin, n);
    return moved;
  }

  private pushArch(
    a: Arch,
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    const c = Math.cos(a.yaw);
    const s = Math.sin(a.yaw);
    const dx = p.x - a.x;
    const dz = p.z - a.z;
    const u = dx * c - dz * s;
    const v = dx * s + dz * c;
    const yy = p.y - a.y0;
    const ox = a.r * ARCH_OUT_X + margin;
    const oy = a.h * ARCH_OUT_Y + margin;
    const ix = a.r - margin;
    const iy = a.h - margin;
    // Candidate exits, each as a distance and a direction (u, y, v) in the arch's frame.
    let best = a.d / 2 + margin - Math.abs(v) + 0.01;
    let nu = 0;
    let ny = 0;
    let nv = v >= 0 ? 1 : -1;
    const take = (d: number, du: number, dy: number) => {
      if (d < best) {
        best = d;
        nu = du;
        ny = dy;
        nv = 0;
      }
    };
    // Out over the back (or out of a leg's outer side, below the springing line).
    if (yy > 0) {
      const q = Math.hypot(u / ox, yy / oy);
      const gu = u / (ox * ox);
      const gy = yy / (oy * oy);
      const gl = Math.max(Math.hypot(gu, gy), 1e-9);
      take(((1 - q) * q) / gl + 0.01, gu / gl, gy / gl);
    } else take(ox - Math.abs(u) + 0.01, Math.sign(u) || 1, 0);
    // In under the span (or into the opening between the legs).
    if (ix > 0 && iy > 0) {
      if (yy > 0) {
        const q = Math.hypot(u / ix, yy / iy);
        const gu = u / (ix * ix);
        const gy = yy / (iy * iy);
        const gl = Math.max(Math.hypot(gu, gy), 1e-9);
        take(((q - 1) * q) / gl + 0.01, -gu / gl, -gy / gl);
      } else take(Math.abs(u) - ix + 0.01, -(Math.sign(u) || 1), 0);
    }
    if (!(best > 0) || !Number.isFinite(best)) return 0;
    p.x += (nu * c + nv * s) * best;
    p.y += ny * best;
    p.z += (-nu * s + nv * c) * best;
    n.x = nu * c + nv * s;
    n.y = ny;
    n.z = -nu * s + nv * c;
    return best;
  }

  private pushHoodoo(
    hd: Hoodoo,
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let dx = p.x - hd.x;
    let dz = p.z - hd.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = 1;
      dz = 0;
      d = 1;
    }
    const side = hd.r * HOODOO_CORE + margin - d;
    const up = hd.y0 + hd.h + margin - p.y;
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
   * Clearance check for planning: is the point at least `margin` above ground and water, as
   * far from any wall (sampled round it), and clear of arches and hoodoos by as much?
   */
  clear(x: number, y: number, z: number, margin: number): boolean {
    if (y < Math.max(this.ground(x, z), Config.world.waterLevel) + margin) return false;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      if (this.height(x + Math.sin(a) * margin, z + Math.cos(a) * margin) > y - 2) return false;
    }
    for (const a of this.nearArches(x, z)) if (this.inArch(a, x, y, z, margin)) return false;
    return !this.hoodooAt(x, y, z, margin);
  }
}
