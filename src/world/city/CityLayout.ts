import { Config } from '../../core/Config';
import { clamp, lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, mulberry32, type Noise2D } from '../noise';

/**
 * The bay city as pure data: one seeded function of space, no Three.js, so it is unit-tested
 * and shared by the ground mesh, the instanced buildings, collisions and wisp planning.
 *
 * Plan: an endless grid of 240 m superblocks bounded by 40 m avenues. Each superblock holds
 * 3x3 blocks separated by 12 m local streets. A low-frequency density field (peaking at the
 * core near the spawn) picks each block's kind: glass towers, narrow neon-signed mid-rises,
 * apartment slabs, tiled-roof houses, parks, shrines and temples. A bay runs east-west through
 * the world (the spawn is out on the water, facing the skyline), a river meanders through,
 * and a few avenues carry elevated expressways. Landmarks: a giant torii standing in the bay,
 * a lattice broadcast tower every few kilometres and grand shrines in wooded parks.
 */

/** Block kinds. */
export const BK = {
  TOWERS: 0,
  PLAZA: 1,
  MIDRISE: 2,
  HOUSES: 3,
  APARTMENTS: 4,
  PARK: 5,
  FOREST: 6,
  SHRINE: 7,
  TEMPLE: 8,
  LANDMARK: 9,
} as const;
export type BlockKind = (typeof BK)[keyof typeof BK];

/** Zone codes returned by zoneAt for the street network (blocks return their BlockKind). */
export const ZONE_AVENUE = -1;
export const ZONE_STREET = -2;

/** Instanced mesh a part is drawn with. */
export const MESH = { BOX: 0, CYL: 1, GABLE: 2, HIP: 3, RIDGE: 4, LATTICE: 5 } as const;
/** Facade treatment in the building shader. */
export const STYLE = {
  GLASS: 0,
  OFFICE: 1,
  APART: 2,
  HOUSE: 3,
  PLAIN: 4,
  SIGN: 5,
  LAMP: 6,
  LATTICE: 7,
  BEACON: 8,
} as const;
/** Tree shapes (index into the city's Trees meshes). */
export const TREE = { ROUND: 0, PINE: 1, CHERRY: 2 } as const;

/** Floats per part: mesh, x, y (base), z, sx, sy, sz, rotY, colour (0xRRGGBB), style, seed. */
export const PART_STRIDE = 11;
/** Floats per tree, same layout as the highlands scatter: type, x, y, z, scale, rotY, tint. */
export const CITY_TREE_STRIDE = 7;
/** Floats per solid box: x0, y0, z0, x1, y1, z1. */
export const BOX_STRIDE = 6;

export interface Superblock {
  readonly I: number;
  readonly J: number;
  readonly parts: number[];
  readonly trees: number[];
  readonly boxes: number[];
  /** Box indices per collision cell (GRID x GRID over the superblock plus PAD). */
  readonly cells: number[][];
  /** Tall towers for wisp spirals: x, z, half diagonal, top. */
  readonly towers: number[];
}

export interface Tower {
  x: number;
  z: number;
  half: number;
  top: number;
}

/** Collision cells: each superblock indexes its boxes on a grid that also covers PAD metres
 * around it, because avenue structures and the bay torii straddle superblock edges. */
const GRID = 8;
const PAD = 24;
/** Boxes are entered into every cell they touch grown by this much, so point queries with a
 * margin up to it only need the one cell that holds the point. */
const INFLATE = 4;
const CACHE = 400;
/** Open corner plaza at every avenue crossing (m from the block corner), so turns have room. */
const CORNER = 16;

const GLASS = [0x6f8aa3, 0x7f97ad, 0x8ba3b5, 0x5f7891, 0x93a4b0, 0x7d8c9e, 0x9fb5bc, 0x6c7f8f];
const STONE = [0xd9cfc2, 0xcbbfb0, 0xe3dbd0, 0xbfb6ad, 0xc9c2bb, 0xd6c4ae];
const SHOPS = [
  0xe8dccb, 0xd8c3ad, 0xc9b3a3, 0xb9c2c7, 0xe0cfc0, 0xcfd3cc, 0xe6c7b3, 0xbfb0c4, 0xd9d0b8,
];
const FLATS = [0xece6da, 0xe0dbd1, 0xd8d4cb, 0xe8dcc6, 0xd5dbe0];
const WALLS = [0xece4d6, 0xdcd3c3, 0xcfc6b5, 0xe6dccb, 0xbfb8a8, 0xd9cdb8];
const TILES = [0x4a5163, 0x56627a, 0x3f4656, 0x6b5f5c, 0x8a5b4a, 0x5d6b73];
const NEON = [0xff4fa3, 0x46d9ff, 0xffb347, 0xb36bff, 0x5cff9d, 0xff5a4f, 0xfff07a];
const VERMILION = 0xd8452b;
const INK = 0x2b2833;
const STONE_GREY = 0xb9b3a8;
const LANTERN = 0xffc978;
const CONCRETE = 0xa9a4ad;

const pick = <T>(a: readonly T[], r: number): T =>
  a[Math.min(a.length - 1, Math.floor(r * a.length))];
const mod3 = (n: number) => ((n % 3) + 3) % 3;

/** A block-local frame for oriented layouts: `a` runs from the entrance inward, `b` to the right. */
interface Frame {
  cx: number;
  cz: number;
  fx: number;
  fz: number;
  g: number;
}

export class CityLayout {
  readonly S: number;
  readonly AH: number;
  readonly SH: number;
  /** Block side length. */
  readonly B: number;
  /** Local street centre lines (offsets inside a superblock). */
  readonly c1: number;
  readonly c2: number;
  readonly land = 2.8;
  /** Where the giant torii stands in the bay, and where the bird starts. */
  readonly gate: { x: number; z: number };
  readonly spawn: { x: number; y: number; z: number; yaw: number };
  private readonly core: { x: number; z: number };
  private readonly spawnTower = { I: 2, J: 0 };
  /** Expressway lines guaranteed near the spawn, so the first minute shows one of each. */
  private readonly nearExpress: { I: number; J: number };
  private readonly nH: Noise2D;
  private readonly nR: Noise2D;
  private readonly nD: Noise2D;
  private readonly nS: Noise2D;
  private readonly cache = new Map<number, Superblock>();
  /** The last box a query hit: x0, y0, z0, x1, y1, z1. */
  readonly hit = new Float64Array(6);
  /** Keep-out rectangle (corner plaza) of the block being generated, or empty. */
  private readonly keep = [0, 0, 0, 0];

  constructor(private readonly seed: number) {
    const c = Config.city;
    this.S = c.superblock;
    this.AH = c.avenueHalf;
    this.SH = c.streetHalf;
    this.B = (this.S - 2 * this.AH - 4 * this.SH) / 3;
    this.c1 = this.AH + this.B + this.SH;
    this.c2 = this.AH + 2 * this.B + 3 * this.SH;
    this.nH = createNoise2D(seed + 201);
    this.nR = createNoise2D(seed + 202);
    this.nD = createNoise2D(seed + 203);
    this.nS = createNoise2D(seed + 204);
    const shore = this.shoreNear(0);
    this.gate = { x: 0, z: shore + 120 };
    // Out on the bay facing south, down the x = 0 avenue: the torii, then the skyline, with
    // the evening sun setting behind it.
    this.spawn = { x: 0, y: 13, z: shore + 330, yaw: Math.PI };
    this.core = { x: 0, z: shore - 520 };
    // The landmark tower the bird sees ahead-right of the spawn: the first dry superblock.
    const J0 = Math.floor((shore - 780) / this.S);
    search: for (let r = 0; r < 4; r++)
      for (const [I, J] of [
        [2, J0 - r],
        [3, J0 - r],
        [1, J0 - r],
      ]) {
        this.spawnTower.I = I;
        this.spawnTower.J = J;
        if (this.landmarkSite(I, J)) break search;
      }
    this.nearExpress = { I: -2, J: Math.round((shore - 700) / this.S) };
  }

  // --- Terrain ---------------------------------------------------------------------------------

  /** Southern shore of the bay (the city side of the spawn). */
  shoreNear(x: number): number {
    return 150 + 110 * this.nS(x * 0.0011, 0.3);
  }

  shoreFar(x: number): number {
    return 1750 + 180 * this.nS(x * 0.0009, 7.1);
  }

  inSea(x: number, z: number): boolean {
    return z > this.shoreNear(x) && z < this.shoreFar(x);
  }

  /** 0..1, 1 in the river channel. Like the highlands valleys: where a noise crosses zero. */
  river(x: number, z: number): number {
    const v = Math.abs(fbm(this.nR, x * 0.00065 + 3.1, z * 0.00065 - 1.7, 2));
    return 1 - smoothstep(0.016, 0.03, v);
  }

  /** Terrain without park ponds (used where block kinds are still being decided). */
  baseHeight(x: number, z: number): number {
    let h = this.land + 1.4 * fbm(this.nH, x * 0.0021, z * 0.0021, 2);
    const r = this.river(x, z);
    if (r > 0) h = lerp(h, -3.2, r);
    const near = this.shoreNear(x);
    const far = this.shoreFar(x);
    if (z > near - 1 && z < far + 1) {
      // A seawall: the shore drops to the seabed within ~10 m.
      const d = Math.min(z - near, far - z);
      h = lerp(h, -7, smoothstep(0, 10, d));
    }
    return h;
  }

  height(x: number, z: number): number {
    const h = this.baseHeight(x, z);
    const k = this.zoneAt(x, z);
    if (k !== BK.PARK && k !== BK.FOREST) return h;
    // Ponds in some parks: an ellipse per block, carved below the water line.
    const bi = Math.floor(x / this.S) * 3 + this.blockIndex(x - Math.floor(x / this.S) * this.S);
    const bj = Math.floor(z / this.S) * 3 + this.blockIndex(z - Math.floor(z / this.S) * this.S);
    const s = this.seed;
    if (hash2(bi, bj, s + 220) > 0.5) return h;
    const cx = this.blockX0(bi) + this.B / 2 + (hash2(bi, bj, s + 221) - 0.5) * 14;
    const cz = this.blockZ0(bj) + this.B / 2 + (hash2(bi, bj, s + 222) - 0.5) * 14;
    const rx = 10 + hash2(bi, bj, s + 223) * 7;
    const rz = 9 + hash2(bi, bj, s + 224) * 6;
    const e = Math.hypot((x - cx) / rx, (z - cz) / rz);
    return lerp(h, -1.4, 1 - smoothstep(0.75, 1, e));
  }

  /** Park and forest canopy above the terrain, eased in from the block edge. */
  canopy(x: number, z: number): number {
    const k = this.zoneAt(x, z);
    if (k !== BK.PARK && k !== BK.FOREST) return 0;
    const I = Math.floor(x / this.S);
    const J = Math.floor(z / this.S);
    const bi = I * 3 + this.blockIndex(x - I * this.S);
    const bj = J * 3 + this.blockIndex(z - J * this.S);
    const x0 = this.blockX0(bi);
    const z0 = this.blockZ0(bj);
    const edge = Math.min(x - x0, x0 + this.B - x, z - z0, z0 + this.B - z);
    return Config.city.canopy * (k === BK.FOREST ? 1 : 0.7) * smoothstep(3, 12, edge);
  }

  // --- Plan ------------------------------------------------------------------------------------

  /** Which block (0..2) an offset inside a superblock falls in, or -1 on an avenue or street. */
  blockIndex(u: number): number {
    for (let k = 0; k < 3; k++) {
      const s = this.AH + k * (this.B + 2 * this.SH);
      if (u >= s && u < s + this.B) return k;
    }
    return -1;
  }

  blockX0(bi: number): number {
    const I = Math.floor(bi / 3);
    return I * this.S + this.AH + mod3(bi) * (this.B + 2 * this.SH);
  }

  blockZ0(bj: number): number {
    return this.blockX0(bj);
  }

  /** Avenue, street, or the kind of block at a point. */
  zoneAt(x: number, z: number): number {
    const S = this.S;
    const I = Math.floor(x / S);
    const J = Math.floor(z / S);
    const u = x - I * S;
    const v = z - J * S;
    if (u < this.AH || u >= S - this.AH || v < this.AH || v >= S - this.AH) return ZONE_AVENUE;
    const k = this.blockIndex(u);
    const l = this.blockIndex(v);
    if (k < 0 || l < 0) return ZONE_STREET;
    return this.blockKind(I * 3 + k, J * 3 + l);
  }

  /** Block indices at a point (false on an avenue or street). */
  blockOf(x: number, z: number, out: { bi: number; bj: number }): boolean {
    const I = Math.floor(x / this.S);
    const J = Math.floor(z / this.S);
    const k = this.blockIndex(x - I * this.S);
    const l = this.blockIndex(z - J * this.S);
    if (k < 0 || l < 0) return false;
    out.bi = I * 3 + k;
    out.bj = J * 3 + l;
    return true;
  }

  /** Superblocks whose local streets are not drawn (one big park or landmark ground). */
  hasStreets(x: number, z: number): boolean {
    return this.superKind(Math.floor(x / this.S), Math.floor(z / this.S)) === 0;
  }

  /** 0..1+ building density: the low-frequency city fabric plus the core near the spawn. */
  density(I: number, J: number): number {
    const S = this.S;
    const cx = (I + 0.5) * S;
    const cz = (J + 0.5) * S;
    let d = 0.42 + 0.5 * fbm(this.nD, cx * 0.00042, cz * 0.00042, 2);
    const dx = cx - this.core.x;
    const dz = cz - this.core.z;
    d += 0.5 * Math.exp(-(dx * dx + dz * dz) / (650 * 650));
    return d;
  }

  /** A landmark needs dry ground under its whole base (no river through it). */
  private landmarkSite(I: number, J: number): boolean {
    const cx = (I + 0.5) * this.S;
    const cz = (J + 0.5) * this.S;
    return this.dry(cx - 40, cz - 40, cx + 40, cz + 40);
  }

  isLandmark(I: number, J: number): boolean {
    if (I === this.spawnTower.I && J === this.spawnTower.J) return true;
    const s = this.seed;
    const rI = Math.floor(I / 7);
    const rJ = Math.floor(J / 7);
    if (hash2(rI, rJ, s + 311) > 0.55) return false;
    const li = rI * 7 + 1 + Math.floor(hash2(rI, rJ, s + 312) * 5);
    const lj = rJ * 7 + 1 + Math.floor(hash2(rI, rJ, s + 313) * 5);
    if (I !== li || J !== lj) return false;
    const cx = (I + 0.5) * this.S;
    const cz = (J + 0.5) * this.S;
    return this.landmarkSite(I, J) && Math.hypot(cx - this.spawn.x, cz - this.spawn.z) > 900;
  }

  /** 0 ordinary, 1 a grand shrine in a wooded park, 2 a landmark tower in a park. */
  superKind(I: number, J: number): number {
    if (this.isLandmark(I, J)) return 2;
    const cx = (I + 0.5) * this.S;
    const cz = (J + 0.5) * this.S;
    if (
      hash2(I, J, this.seed + 303) < 0.06 &&
      Math.hypot(cx - this.core.x, cz - this.core.z) > 1000
    )
      return 1;
    return 0;
  }

  blockKind(bi: number, bj: number): BlockKind {
    const I = Math.floor(bi / 3);
    const J = Math.floor(bj / 3);
    const centre = mod3(bi) === 1 && mod3(bj) === 1;
    const r = hash2(bi, bj, this.seed + 211);
    const sk = this.superKind(I, J);
    if (sk === 2) return centre ? BK.LANDMARK : r < 0.55 ? BK.PARK : BK.PLAZA;
    if (sk === 1) return centre ? BK.SHRINE : r < 0.65 ? BK.FOREST : BK.PARK;
    const d = this.density(I, J);
    if (d > 0.66) {
      if (r < 0.07) return BK.PLAZA;
      if (r < 0.12) return BK.PARK;
      if (r < 0.16) return BK.SHRINE; // a tiny shrine wedged between towers
      return BK.TOWERS;
    }
    if (d > 0.44) {
      if (r < 0.07) return BK.PARK;
      if (r < 0.13) return BK.SHRINE;
      if (r < 0.16) return BK.TEMPLE;
      if (r < 0.3) return BK.APARTMENTS;
      if (r < 0.36) return BK.TOWERS;
      return BK.MIDRISE;
    }
    if (r < 0.09) return BK.PARK;
    if (r < 0.17) return BK.SHRINE;
    if (r < 0.21) return BK.TEMPLE;
    if (r < 0.38) return BK.APARTMENTS;
    if (r < 0.48) return BK.MIDRISE; // a shopping street
    return BK.HOUSES;
  }

  /** N-S expressway along the avenue at x = I*S (never the spawn avenue). */
  expressX(I: number): boolean {
    return I === this.nearExpress.I || (I !== 0 && hash2(I, 7, this.seed + 401) < 0.12);
  }

  /** E-W expressway along the avenue at z = J*S. */
  expressZ(J: number): boolean {
    return J === this.nearExpress.J || hash2(J, 9, this.seed + 402) < 0.12;
  }

  /** Shrines and temples face the avenue they sit on (or a hashed side in a centre block). */
  shrineFrame(bi: number, bj: number): Frame {
    const k = mod3(bi);
    const l = mod3(bj);
    let fx = 0;
    let fz = 0;
    if (k === 0) fx = 1;
    else if (k === 2) fx = -1;
    else if (l === 0) fz = 1;
    else if (l === 2) fz = -1;
    else {
      const side = Math.floor(hash2(bi, bj, this.seed + 230) * 4);
      fx = side === 0 ? 1 : side === 1 ? -1 : 0;
      fz = side === 2 ? 1 : side === 3 ? -1 : 0;
    }
    const cx = this.blockX0(bi) + this.B / 2;
    const cz = this.blockZ0(bj) + this.B / 2;
    return { cx, cz, fx, fz, g: this.baseHeight(cx, cz) };
  }

  // --- Superblock generation -------------------------------------------------------------------

  superblock(I: number, J: number): Superblock {
    const key = (I + 0x8000) * 0x10000 + (J + 0x8000);
    let sb = this.cache.get(key);
    if (sb) return sb;
    sb = this.generate(I, J);
    if (this.cache.size >= CACHE) {
      // Maps iterate in insertion order: drop the oldest quarter.
      let n = CACHE / 4;
      for (const k of this.cache.keys()) {
        this.cache.delete(k);
        if (--n <= 0) break;
      }
    }
    this.cache.set(key, sb);
    return sb;
  }

  private generate(I: number, J: number): Superblock {
    const sb: Superblock = { I, J, parts: [], trees: [], boxes: [], cells: [], towers: [] };
    for (let l = 0; l < 3; l++)
      for (let k = 0; k < 3; k++) {
        const bi = I * 3 + k;
        const bj = J * 3 + l;
        this.genBlock(sb, bi, bj, this.blockKind(bi, bj));
      }
    this.genAvenues(sb, I, J);
    this.genBridges(sb, I, J);
    const S = this.S;
    if (
      this.gate.x >= I * S &&
      this.gate.x < (I + 1) * S &&
      this.gate.z >= J * S &&
      this.gate.z < (J + 1) * S
    )
      this.genBayTorii(sb);
    this.index(sb);
    return sb;
  }

  /** Bucket boxes into collision cells. */
  private index(sb: Superblock): void {
    const cs = (this.S + 2 * PAD) / GRID;
    const ox = sb.I * this.S - PAD;
    const oz = sb.J * this.S - PAD;
    for (let c = 0; c < GRID * GRID; c++) sb.cells.push([]);
    const B = sb.boxes;
    for (let b = 0; b < B.length / BOX_STRIDE; b++) {
      const k = b * BOX_STRIDE;
      const i0 = clamp(Math.floor((B[k] - INFLATE - ox) / cs), 0, GRID - 1);
      const i1 = clamp(Math.floor((B[k + 3] + INFLATE - ox) / cs), 0, GRID - 1);
      const j0 = clamp(Math.floor((B[k + 2] - INFLATE - oz) / cs), 0, GRID - 1);
      const j1 = clamp(Math.floor((B[k + 5] + INFLATE - oz) / cs), 0, GRID - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) sb.cells[j * GRID + i].push(b);
    }
  }

  private part(
    sb: Superblock,
    mesh: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rot: number,
    color: number,
    style: number,
    seed: number,
  ): void {
    sb.parts.push(mesh, x, y, z, sx, sy, sz, rot, color, style, seed);
  }

  private solid(
    sb: Superblock,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): void {
    sb.boxes.push(x0, y0, z0, x1, y1, z1);
  }

  /** Box part from a footprint rectangle and heights; solid unless told otherwise. */
  private box(
    sb: Superblock,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    color: number,
    style: number,
    seed: number,
    solid = true,
  ): void {
    this.part(
      sb,
      MESH.BOX,
      (x0 + x1) / 2,
      y0,
      (z0 + z1) / 2,
      x1 - x0,
      y1 - y0,
      z1 - z0,
      0,
      color,
      style,
      seed,
    );
    if (solid) this.solid(sb, x0, y0, z0, x1, y1, z1);
  }

  private tree(sb: Superblock, type: number, x: number, z: number, scale: number, r: number): void {
    const y = this.height(x, z);
    if (y < Config.world.waterLevel + 0.4) return;
    sb.trees.push(type, x, y - 0.3, z, scale, r * Math.PI * 2, (r * 7.13) % 1);
  }

  /** Dry land and clear of the block's corner plaza. */
  private fits(x0: number, z0: number, x1: number, z1: number): boolean {
    const k = this.keep;
    const overlaps = x0 < k[2] && x1 > k[0] && z0 < k[3] && z1 > k[1];
    return !overlaps && this.dry(x0, z0, x1, z1);
  }

  /** Shrink a footprint [x0, z0, x1, z1] off the corner plaza, keeping the larger remainder. */
  private trim(r: number[]): void {
    const k = this.keep;
    if (!(r[0] < k[2] && r[2] > k[0] && r[1] < k[3] && r[3] > k[1])) return;
    // Either give up the plaza's width in x or its depth in z, whichever costs less area.
    const nx0 = k[0] <= r[0] ? k[2] : r[0];
    const nx1 = k[0] <= r[0] ? r[2] : k[0];
    const nz0 = k[1] <= r[1] ? k[3] : r[1];
    const nz1 = k[1] <= r[1] ? r[3] : k[1];
    if ((nx1 - nx0) * (r[3] - r[1]) >= (r[2] - r[0]) * (nz1 - nz0)) {
      r[0] = nx0;
      r[2] = nx1;
    } else {
      r[1] = nz0;
      r[3] = nz1;
    }
  }

  /** Every corner and the centre of a footprint is dry land. */
  private dry(x0: number, z0: number, x1: number, z1: number): boolean {
    const w = Config.world.waterLevel + 0.7;
    return (
      this.baseHeight(x0, z0) > w &&
      this.baseHeight(x1, z0) > w &&
      this.baseHeight(x0, z1) > w &&
      this.baseHeight(x1, z1) > w &&
      this.baseHeight((x0 + x1) / 2, (z0 + z1) / 2) > w
    );
  }

  private genBlock(sb: Superblock, bi: number, bj: number, kind: BlockKind): void {
    const x0 = this.blockX0(bi);
    const z0 = this.blockZ0(bj);
    const rnd = mulberry32((hash2(bi, bj, this.seed + 777) * 4294967296) >>> 0);
    const inset = 3; // sidewalk
    const ix0 = x0 + inset;
    const iz0 = z0 + inset;
    const ix1 = x0 + this.B - inset;
    const iz1 = z0 + this.B - inset;
    const d = this.density(Math.floor(bi / 3), Math.floor(bj / 3));
    // Blocks on a superblock corner leave the corner by the avenue crossing open.
    const k = mod3(bi);
    const l = mod3(bj);
    const keep = this.keep;
    keep[0] = keep[1] = keep[2] = keep[3] = 0;
    if (k !== 1 && l !== 1) {
      keep[0] = k === 0 ? x0 - 1 : x0 + this.B - CORNER;
      keep[2] = keep[0] + CORNER + 1;
      keep[1] = l === 0 ? z0 - 1 : z0 + this.B - CORNER;
      keep[3] = keep[1] + CORNER + 1;
      if (kind !== BK.PARK && kind !== BK.FOREST && kind !== BK.LANDMARK && kind !== BK.PLAZA)
        this.cornerPlaza(
          sb,
          (keep[0] + keep[2]) / 2,
          (keep[1] + keep[3]) / 2,
          k === 0 ? 1 : -1,
          l === 0 ? 1 : -1,
          rnd,
        );
    }
    switch (kind) {
      case BK.TOWERS:
        return this.genTowers(sb, ix0, iz0, ix1, iz1, d, rnd);
      case BK.MIDRISE:
        return this.genMidrise(sb, ix0, iz0, ix1, iz1, d, rnd);
      case BK.HOUSES:
        return this.genHouses(sb, ix0, iz0, ix1, iz1, rnd);
      case BK.APARTMENTS:
        return this.genApartments(sb, ix0, iz0, ix1, iz1, rnd);
      case BK.PARK:
      case BK.FOREST:
        return this.genPark(sb, ix0, iz0, ix1, iz1, kind === BK.FOREST, rnd);
      case BK.PLAZA:
        return this.genPlaza(sb, ix0, iz0, ix1, iz1, rnd);
      case BK.SHRINE:
        return this.genShrine(sb, bi, bj, rnd);
      case BK.TEMPLE:
        return this.genTemple(sb, bi, bj, rnd);
      case BK.LANDMARK:
        return this.genLatticeTower(sb, (x0 + x0 + this.B) / 2, (z0 + z0 + this.B) / 2);
    }
  }

  /** A kōban (police box) or a couple of trees on the open corner by a crossing. */
  private cornerPlaza(
    sb: Superblock,
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    rnd: () => number,
  ): void {
    if (!this.dry(cx - 4, cz - 4, cx + 4, cz + 4)) return;
    const g = this.baseHeight(cx, cz);
    if (rnd() < 0.35) {
      const bx = cx + sx * 3;
      const bz = cz + sz * 3;
      this.box(
        sb,
        bx - 2.2,
        bz - 2.2,
        bx + 2.2,
        bz + 2.2,
        g - 1,
        g + 3.4,
        0xf1ece4,
        STYLE.HOUSE,
        rnd(),
      );
      this.part(sb, MESH.HIP, bx, g + 3.4, bz, 5, 0.8, 5, 0, 0x5a6270, STYLE.PLAIN, 0);
      this.part(
        sb,
        MESH.BOX,
        bx - sx * 2.3,
        g + 2.6,
        bz - sz * 2.3,
        0.5,
        0.5,
        0.5,
        0,
        0xff4a3a,
        STYLE.LAMP,
        0,
      );
    } else {
      this.tree(
        sb,
        rnd() < 0.5 ? TREE.CHERRY : TREE.ROUND,
        cx + sx * 3,
        cz + sz * 3,
        0.7 + rnd() * 0.3,
        rnd(),
      );
    }
  }

  private genTowers(
    sb: Superblock,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    d: number,
    rnd: () => number,
  ): void {
    const lots: number[] = [];
    if (rnd() < 0.45) lots.push(ix0, iz0, ix1, iz1);
    else if (rnd() < 0.5) {
      const m = (ix0 + ix1) / 2;
      lots.push(ix0, iz0, m - 2, iz1, m + 2, iz0, ix1, iz1);
    } else {
      const m = (iz0 + iz1) / 2;
      lots.push(ix0, iz0, ix1, m - 2, ix0, m + 2, ix1, iz1);
    }
    const boost = clamp((d - 0.6) / 0.45, 0, 1);
    for (let i = 0; i < lots.length; i += 4) {
      const r = [lots[i], lots[i + 1], lots[i + 2], lots[i + 3]];
      this.trim(r);
      const [lx0, lz0, lx1, lz1] = r;
      if (lx1 - lx0 < 14 || lz1 - lz0 < 14 || !this.fits(lx0, lz0, lx1, lz1)) continue;
      const g = this.baseHeight((lx0 + lx1) / 2, (lz0 + lz1) / 2);
      const seed = rnd();
      const podium = 9 + rnd() * 9;
      this.box(
        sb,
        lx0 + 1,
        lz0 + 1,
        lx1 - 1,
        lz1 - 1,
        g - 3,
        g + podium,
        pick(STONE, rnd()),
        STYLE.OFFICE,
        seed,
      );
      const w = (lx1 - lx0) * (0.5 + 0.3 * rnd());
      const dd = (lz1 - lz0) * (0.5 + 0.3 * rnd());
      const cx = lx0 + w / 2 + 1.5 + rnd() * (lx1 - lx0 - w - 3);
      const cz = lz0 + dd / 2 + 1.5 + rnd() * (lz1 - lz0 - dd - 3);
      const H = clamp((55 + 140 * Math.pow(rnd(), 1.6)) * (0.6 + 0.55 * boost), 40, 215);
      const glass = pick(GLASS, rnd());
      this.box(
        sb,
        cx - w / 2,
        cz - dd / 2,
        cx + w / 2,
        cz + dd / 2,
        g + podium - 1,
        g + H,
        glass,
        STYLE.GLASS,
        seed,
      );
      let top = g + H;
      let tw = w;
      let td = dd;
      if (rnd() < 0.5) {
        // Setback crown tier.
        tw *= 0.68;
        td *= 0.68;
        const h2 = H * (0.1 + rnd() * 0.15);
        this.box(
          sb,
          cx - tw / 2,
          cz - td / 2,
          cx + tw / 2,
          cz + td / 2,
          top - 0.5,
          top + h2,
          glass,
          STYLE.GLASS,
          seed + 0.31,
        );
        top += h2;
      }
      const crown = rnd();
      if (crown < 0.35) {
        const ah = 10 + rnd() * 14;
        this.part(sb, MESH.CYL, cx, top, cz, 1, ah, 1, 0, 0xd8d4d0, STYLE.PLAIN, 0);
        this.part(sb, MESH.BOX, cx, top + ah, cz, 1.3, 1.3, 1.3, 0, 0xff3b30, STYLE.BEACON, rnd());
      } else if (crown < 0.65) {
        this.box(
          sb,
          cx - tw * 0.3,
          cz - td * 0.25,
          cx + tw * 0.1,
          cz + td * 0.25,
          top,
          top + 3.5,
          CONCRETE,
          STYLE.PLAIN,
          0,
          false,
        );
        this.part(
          sb,
          MESH.CYL,
          cx + tw * 0.28,
          top,
          cz - td * 0.2,
          4,
          3,
          4,
          0,
          0xc9c4bd,
          STYLE.PLAIN,
          0,
        );
      } else if (crown < 0.8) {
        const ph = Math.min(tw, td) * 0.45;
        this.part(sb, MESH.HIP, cx, top, cz, tw * 1.02, ph, td * 1.02, 0, 0x4c5566, STYLE.PLAIN, 0);
        top += ph * 0.6;
      }
      if (H > 100) {
        // Red aviation lights blinking on the corners: the city's night pulse.
        for (const sx of [-1, 1])
          this.part(
            sb,
            MESH.BOX,
            cx + (sx * tw) / 2.3,
            top,
            cz + (sx * td) / 2.3,
            1,
            1,
            1,
            0,
            0xff3b30,
            STYLE.BEACON,
            rnd(),
          );
      }
      sb.towers.push(cx, cz, Math.hypot(w, dd) / 2, top);
    }
  }

  private genMidrise(
    sb: Superblock,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    d: number,
    rnd: () => number,
  ): void {
    // Two rows of narrow "pencil" buildings back to back, each facing its street. Blade signs
    // stick out over the sidewalk; more of them (and rooftop billboards) along the river.
    const mz = (iz0 + iz1) / 2;
    const riverside = Math.max(
      this.river(ix0 - 20, mz),
      this.river(ix1 + 20, mz),
      this.river((ix0 + ix1) / 2, iz0 - 20),
      this.river((ix0 + ix1) / 2, iz1 + 20),
    );
    const signP = 0.4 + 0.45 * riverside + (d > 0.55 ? 0.15 : 0);
    const tall = 0.6 + clamp(d, 0, 1) * 0.8;
    for (const facing of [-1, 1]) {
      const front = facing < 0 ? iz0 : iz1;
      let x = ix0;
      while (x < ix1 - 5) {
        const w = Math.min(ix1 - x, 8 + rnd() * 8);
        const depth = (mz - iz0 - 1) * (0.7 + 0.3 * rnd());
        const back = front - facing * depth;
        const za = Math.min(front, back);
        const zb = Math.max(front, back);
        x += w;
        const xa = x - w + 0.4;
        const xb = x - 0.4;
        if (!this.fits(xa, za, xb, zb)) continue;
        const g = this.baseHeight((xa + xb) / 2, (za + zb) / 2);
        const h = (11 + 34 * Math.pow(rnd(), 1.3)) * tall;
        const seed = rnd();
        this.box(sb, xa, za, xb, zb, g - 3, g + h, pick(SHOPS, rnd()), STYLE.OFFICE, seed);
        if (rnd() < signP) {
          const sx = rnd() < 0.5 ? xa + 1 : xb - 1;
          const sh = clamp(h * (0.45 + rnd() * 0.3), 5, 16);
          const sz = front + facing * 1.25;
          this.part(
            sb,
            MESH.BOX,
            sx,
            g + 4,
            sz,
            0.5,
            sh,
            2.2,
            0,
            pick(NEON, rnd()),
            STYLE.SIGN,
            rnd(),
          );
        }
        if (rnd() < 0.12 + 0.3 * riverside) {
          // Rooftop billboard facing the street.
          this.part(
            sb,
            MESH.BOX,
            (xa + xb) / 2,
            g + h + 1,
            front - facing * 1.5,
            (xb - xa) * 0.85,
            4.5,
            0.5,
            0,
            pick(NEON, rnd()),
            STYLE.SIGN,
            rnd(),
          );
          this.part(
            sb,
            MESH.BOX,
            (xa + xb) / 2,
            g + h,
            front - facing * 1.5,
            (xb - xa) * 0.6,
            1,
            0.3,
            0,
            INK,
            STYLE.PLAIN,
            0,
          );
        } else if (rnd() < 0.3) {
          this.part(
            sb,
            MESH.CYL,
            (xa + xb) / 2,
            g + h,
            (za + zb) / 2,
            3.2,
            2.6,
            3.2,
            0,
            0xc9c4bd,
            STYLE.PLAIN,
            0,
          );
        }
      }
    }
  }

  private genHouses(
    sb: Superblock,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    rnd: () => number,
  ): void {
    const nx = Math.max(1, Math.round((ix1 - ix0) / 11));
    const nz = Math.max(1, Math.round((iz1 - iz0) / 11));
    const lw = (ix1 - ix0) / nx;
    const ld = (iz1 - iz0) / nz;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const lx = ix0 + i * lw;
        const lz = iz0 + j * ld;
        const r = rnd();
        if (r < 0.1) {
          // A garden: a tree or two instead of a house.
          this.tree(
            sb,
            rnd() < 0.5 ? TREE.CHERRY : TREE.ROUND,
            lx + lw / 2,
            lz + ld / 2,
            0.55 + rnd() * 0.3,
            rnd(),
          );
          continue;
        }
        const w = lw - 2.2 - rnd() * 2;
        const dd = ld - 2.2 - rnd() * 2;
        const cx = lx + lw / 2 + (rnd() - 0.5) * (lw - w - 1.5);
        const cz = lz + ld / 2 + (rnd() - 0.5) * (ld - dd - 1.5);
        const xa = cx - w / 2;
        const xb = cx + w / 2;
        const za = cz - dd / 2;
        const zb = cz + dd / 2;
        if (!this.fits(xa, za, xb, zb)) continue;
        const g = this.baseHeight(cx, cz);
        const seed = rnd();
        if (r > 0.92) {
          // A narrow three-storey flat-roofed house.
          this.box(sb, xa, za, xb, zb, g - 3, g + 9, pick(FLATS, rnd()), STYLE.APART, seed);
          continue;
        }
        const floors = rnd() < 0.2 ? 1 : 2;
        const bh = floors * 2.9 + 0.4;
        const rh = 2 + rnd() * 1.4;
        this.box(sb, xa, za, xb, zb, g - 3, g + bh, pick(WALLS, rnd()), STYLE.HOUSE, seed, false);
        const alongX = w >= dd;
        this.part(
          sb,
          MESH.GABLE,
          cx,
          g + bh,
          cz,
          (alongX ? w : dd) + 0.8,
          rh,
          (alongX ? dd : w) + 0.9,
          alongX ? 0 : Math.PI / 2,
          pick(TILES, rnd()),
          STYLE.PLAIN,
          0,
        );
        this.solid(sb, xa, g - 3, za, xb, g + bh + rh * 0.55, zb);
        if (rnd() < 0.3) {
          const tx = rnd() < 0.5 ? lx + 1.6 : lx + lw - 1.6;
          const tz = rnd() < 0.5 ? lz + 1.6 : lz + ld - 1.6;
          this.tree(sb, rnd() < 0.4 ? TREE.PINE : TREE.ROUND, tx, tz, 0.4 + rnd() * 0.2, rnd());
        }
      }
  }

  private genApartments(
    sb: Superblock,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    rnd: () => number,
  ): void {
    const alongX = rnd() < 0.5;
    const len = (alongX ? ix1 - ix0 : iz1 - iz0) * (0.7 + rnd() * 0.15);
    const depth = 11 + rnd() * 2;
    const span = alongX ? iz1 - iz0 : ix1 - ix0;
    const two = rnd() < 0.6;
    const offsets = two ? [-span / 2 + depth / 2 + 3, span / 2 - depth / 2 - 3] : [0];
    const cx = (ix0 + ix1) / 2;
    const cz = (iz0 + iz1) / 2;
    for (const o of offsets) {
      const sx = alongX ? len : depth;
      const sz = alongX ? depth : len;
      const px = alongX ? cx : cx + o;
      const pz = alongX ? cz + o : cz;
      const r = [px - sx / 2, pz - sz / 2, px + sx / 2, pz + sz / 2];
      this.trim(r);
      const [xa, za, xb, zb] = r;
      if (xb - xa < 10 || zb - za < 10 || !this.fits(xa, za, xb, zb)) continue;
      const g = this.baseHeight((xa + xb) / 2, (za + zb) / 2);
      const ex = (xa + xb) / 2;
      const ez = (za + zb) / 2;
      const h = (5 + Math.floor(rnd() * 10)) * 2.9 + 1;
      this.box(sb, xa, za, xb, zb, g - 3, g + h, pick(FLATS, rnd()), STYLE.APART, rnd());
      this.box(
        sb,
        ex - 2,
        ez - 2,
        ex + 2,
        ez + 2,
        g + h,
        g + h + 3,
        CONCRETE,
        STYLE.PLAIN,
        0,
        false,
      );
    }
    // Courtyard trees.
    for (let i = 0; i < 5; i++) {
      const tx = lerp(ix0 + 3, ix1 - 3, rnd());
      const tz = lerp(iz0 + 3, iz1 - 3, rnd());
      if (two || Math.abs(alongX ? tz - cz : tx - cx) > depth)
        this.tree(sb, TREE.ROUND, tx, tz, 0.6 + rnd() * 0.3, rnd());
    }
  }

  private genPark(
    sb: Superblock,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    forest: boolean,
    rnd: () => number,
  ): void {
    const cell = forest ? 7.5 : 8.5;
    const density = forest ? 0.8 : 0.42;
    for (let z = iz0 + cell / 2; z < iz1; z += cell)
      for (let x = ix0 + cell / 2; x < ix1; x += cell) {
        if (rnd() > density) continue;
        const tx = x + (rnd() - 0.5) * cell * 0.8;
        const tz = z + (rnd() - 0.5) * cell * 0.8;
        const t = rnd();
        const type = forest
          ? t < 0.4
            ? TREE.PINE
            : t < 0.8
              ? TREE.ROUND
              : TREE.CHERRY
          : t < 0.45
            ? TREE.CHERRY
            : t < 0.8
              ? TREE.ROUND
              : TREE.PINE;
        this.tree(sb, type, tx, tz, (forest ? 0.9 : 0.7) + rnd() * 0.5, rnd());
      }
    if (!forest && rnd() < 0.35) {
      // An azumaya: a little open pavilion.
      const px = lerp(ix0 + 8, ix1 - 8, rnd());
      const pz = lerp(iz0 + 8, iz1 - 8, rnd());
      const g = this.height(px, pz);
      if (g > Config.world.waterLevel + 0.6) {
        for (const ox of [-2, 2])
          for (const oz of [-2, 2])
            this.part(sb, MESH.CYL, px + ox, g, pz + oz, 0.4, 3, 0.4, 0, 0x8c5f44, STYLE.PLAIN, 0);
        this.part(sb, MESH.HIP, px, g + 3, pz, 6.4, 1.9, 6.4, 0, 0x4e5a5c, STYLE.PLAIN, 0);
        this.solid(sb, px - 3, g, pz - 3, px + 3, g + 4.9, pz + 3);
      }
    }
  }

  private genPlaza(
    sb: Superblock,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    rnd: () => number,
  ): void {
    const cx = (ix0 + ix1) / 2;
    const cz = (iz0 + iz1) / 2;
    const g = this.baseHeight(cx, cz);
    if (g < Config.world.waterLevel + 0.7) return;
    this.part(sb, MESH.CYL, cx, g - 0.5, cz, 11, 1.2, 11, 0, 0xc9c2ba, STYLE.PLAIN, 0);
    this.part(sb, MESH.CYL, cx, g, cz, 2, 3.2, 2, 0, 0xd8d2ca, STYLE.PLAIN, 0);
    this.part(sb, MESH.CYL, cx, g + 3.2, cz, 0.6, 1.2, 0.6, 0, LANTERN, STYLE.LAMP, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = 17 + rnd() * 5;
      this.tree(
        sb,
        rnd() < 0.3 ? TREE.CHERRY : TREE.ROUND,
        cx + Math.cos(a) * r,
        cz + Math.sin(a) * r,
        0.6 + rnd() * 0.25,
        rnd(),
      );
    }
  }

  // --- Shrines, temples, landmarks ------------------------------------------------------------

  /** Map frame-local (a, b) to world x, z. */
  private fx(f: Frame, a: number, b: number): number {
    return f.cx + f.fx * a - f.fz * b;
  }

  private fz(f: Frame, a: number, b: number): number {
    return f.cz + f.fz * a + f.fx * b;
  }

  private fbox(
    sb: Superblock,
    f: Frame,
    a0: number,
    a1: number,
    b0: number,
    b1: number,
    y0: number,
    y1: number,
    color: number,
    style: number,
    solid = true,
  ): void {
    const xa = this.fx(f, a0, b0);
    const xb = this.fx(f, a1, b1);
    const za = this.fz(f, a0, b0);
    const zb = this.fz(f, a1, b1);
    this.box(
      sb,
      Math.min(xa, xb),
      Math.min(za, zb),
      Math.max(xa, xb),
      Math.max(za, zb),
      f.g + y0,
      f.g + y1,
      color,
      style,
      0,
      solid,
    );
  }

  /** Collision-only volume in frame coordinates. */
  private fsolid(
    sb: Superblock,
    f: Frame,
    a0: number,
    a1: number,
    b0: number,
    b1: number,
    y0: number,
    y1: number,
  ): void {
    const xa = this.fx(f, a0, b0);
    const xb = this.fx(f, a1, b1);
    const za = this.fz(f, a0, b0);
    const zb = this.fz(f, a1, b1);
    this.solid(
      sb,
      Math.min(xa, xb),
      f.g + y0,
      Math.min(za, zb),
      Math.max(xa, xb),
      f.g + y1,
      Math.max(za, zb),
    );
  }

  /** A ridge roof whose ridge runs across the frame (parallel to the entrance). */
  private froof(
    sb: Superblock,
    f: Frame,
    mesh: number,
    a: number,
    y: number,
    along: number,
    depth: number,
    h: number,
    color: number,
  ): void {
    const rot = Math.abs(f.fz) > 0.5 ? 0 : Math.PI / 2;
    this.part(
      sb,
      mesh,
      this.fx(f, a, 0),
      f.g + y,
      this.fz(f, a, 0),
      along,
      h,
      depth,
      rot,
      color,
      STYLE.PLAIN,
      0,
    );
  }

  private torii(sb: Superblock, f: Frame, a: number, s: number, solid: boolean): void {
    const half = 3.4 * s;
    for (const b of [-half, half])
      this.part(
        sb,
        MESH.CYL,
        this.fx(f, a, b),
        f.g - 0.5,
        this.fz(f, a, b),
        0.9 * s,
        8 * s + 0.5,
        0.9 * s,
        0,
        VERMILION,
        STYLE.PLAIN,
        0,
      );
    this.fbox(
      sb,
      f,
      a - 0.5 * s,
      a + 0.5 * s,
      -5.3 * s,
      5.3 * s,
      7.4 * s,
      8.1 * s,
      VERMILION,
      STYLE.PLAIN,
      solid,
    );
    this.fbox(
      sb,
      f,
      a - 0.65 * s,
      a + 0.65 * s,
      -5.8 * s,
      5.8 * s,
      8.1 * s,
      8.6 * s,
      INK,
      STYLE.PLAIN,
      false,
    );
    this.fbox(
      sb,
      f,
      a - 0.3 * s,
      a + 0.3 * s,
      -4.4 * s,
      4.4 * s,
      6.1 * s,
      6.55 * s,
      VERMILION,
      STYLE.PLAIN,
      false,
    );
    if (solid)
      for (const b of [-half, half]) {
        const x = this.fx(f, a, b);
        const z = this.fz(f, a, b);
        this.solid(sb, x - 0.5 * s, f.g - 0.5, z - 0.5 * s, x + 0.5 * s, f.g + 8 * s, z + 0.5 * s);
      }
  }

  private stoneLantern(sb: Superblock, f: Frame, a: number, b: number): void {
    const x = this.fx(f, a, b);
    const z = this.fz(f, a, b);
    this.part(sb, MESH.BOX, x, f.g, z, 0.8, 1.5, 0.8, 0, STONE_GREY, STYLE.PLAIN, 0);
    this.part(sb, MESH.BOX, x, f.g + 1.5, z, 0.7, 0.7, 0.7, 0, LANTERN, STYLE.LAMP, 0);
    this.part(sb, MESH.HIP, x, f.g + 2.2, z, 1.5, 0.6, 1.5, 0, STONE_GREY, STYLE.PLAIN, 0);
  }

  /** Trees in a band around the block edge, leaving the approach open. */
  private grove(sb: Superblock, f: Frame, half: number, band: number, rnd: () => number): void {
    for (let a = -half; a <= half; a += 7)
      for (let b = -half; b <= half; b += 7) {
        const edge = Math.min(half - Math.abs(a), half - Math.abs(b));
        if (edge > band || rnd() > 0.8) continue;
        if (Math.abs(b) < 7 && a < -half + 16) continue;
        const ja = a + (rnd() - 0.5) * 4;
        const jb = b + (rnd() - 0.5) * 4;
        this.tree(
          sb,
          rnd() < 0.55 ? TREE.PINE : TREE.ROUND,
          this.fx(f, ja, jb),
          this.fz(f, ja, jb),
          0.9 + rnd() * 0.5,
          rnd(),
        );
      }
  }

  private genShrine(sb: Superblock, bi: number, bj: number, rnd: () => number): void {
    const f = this.shrineFrame(bi, bj);
    const half = this.B / 2 - 3;
    if (!this.dry(f.cx - half, f.cz - half, f.cx + half, f.cz + half))
      return this.genPark(sb, f.cx - half, f.cz - half, f.cx + half, f.cz + half, true, rnd);
    const grand = this.superKind(Math.floor(bi / 3), Math.floor(bj / 3)) === 1;
    const s = grand ? 1.3 : 1;
    this.torii(sb, f, -half + 4, grand ? 1.6 : 1, true);
    if (!grand && rnd() < 0.4) {
      // Inari style: a tunnel of small torii along the approach.
      for (let a = -half + 9; a < -4; a += 1.8) {
        for (const b of [-1.3, 1.3])
          this.part(
            sb,
            MESH.CYL,
            this.fx(f, a, b),
            f.g,
            this.fz(f, a, b),
            0.36,
            3.4,
            0.36,
            0,
            VERMILION,
            STYLE.PLAIN,
            0,
          );
        this.fbox(sb, f, a - 0.22, a + 0.22, -1.9, 1.9, 3.2, 3.5, VERMILION, STYLE.PLAIN, false);
        this.fbox(sb, f, a - 0.26, a + 0.26, -2.05, 2.05, 3.5, 3.68, INK, STYLE.PLAIN, false);
      }
    } else {
      for (const a of [-half + 11, -2]) for (const b of [-4.2, 4.2]) this.stoneLantern(sb, f, a, b);
    }
    const wood = rnd() < 0.5;
    const body = wood ? 0x9b6b4a : VERMILION;
    const roof = rnd() < 0.5 ? 0x4f7d71 : 0x5a4840;
    // Haiden (hall of worship) on a stone platform, the honden (main sanctuary) behind it.
    this.fbox(sb, f, 0, 12 * s, -8 * s, 8 * s, 0, 0.9, STONE_GREY, STYLE.PLAIN);
    this.fbox(sb, f, 1.5 * s, 9.5 * s, -6 * s, 6 * s, 0.9, 4.9 * s, body, STYLE.PLAIN, false);
    this.froof(sb, f, MESH.RIDGE, 5.5 * s, 4.9 * s, 16 * s, 11.5 * s, 4.2 * s, roof);
    this.fsolid(sb, f, 0, 11 * s, -7.5 * s, 7.5 * s, 0, 9 * s);
    this.fbox(sb, f, 13 * s, 19.5 * s, -4 * s, 4 * s, 0, 1.2, STONE_GREY, STYLE.PLAIN, false);
    this.fbox(sb, f, 13.5 * s, 19 * s, -3.2 * s, 3.2 * s, 1.2, 5 * s, body, STYLE.PLAIN, false);
    this.froof(sb, f, MESH.RIDGE, 16.25 * s, 5 * s, 10 * s, 8.5 * s, 3.6 * s, roof);
    this.fsolid(sb, f, 13 * s, 19.5 * s, -5 * s, 5 * s, 0, 8.6 * s);
    this.grove(sb, f, half, grand ? 14 : 8, rnd);
  }

  private genTemple(sb: Superblock, bi: number, bj: number, rnd: () => number): void {
    const f = this.shrineFrame(bi, bj);
    const half = this.B / 2 - 3;
    if (!this.dry(f.cx - half, f.cz - half, f.cx + half, f.cz + half))
      return this.genPark(sb, f.cx - half, f.cz - half, f.cx + half, f.cz + half, false, rnd);
    const dark = 0x45464f;
    // Sanmon gate.
    this.fbox(sb, f, -half + 2, -half + 7, -6, 6, 0, 5, VERMILION, STYLE.PLAIN);
    this.froof(sb, f, MESH.RIDGE, -half + 4.5, 5, 15, 8, 3.5, dark);
    // Main hall.
    this.fbox(sb, f, 4, 20, -11, 11, 0, 1.2, STONE_GREY, STYLE.PLAIN, false);
    this.fbox(sb, f, 6.5, 17.5, -9, 9, 1.2, 7, 0x8a6446, STYLE.PLAIN, false);
    this.froof(sb, f, MESH.RIDGE, 12, 7, 24, 16, 7.5, dark);
    this.fsolid(sb, f, 4, 20, -12, 12, 0, 13);
    // Five-storey pagoda off to one side of the approach.
    const pb = rnd() < 0.5 ? -13 : 13;
    const px = this.fx(f, -6, pb);
    const pz = this.fz(f, -6, pb);
    let y = f.g;
    for (let i = 0; i < 5; i++) {
      const bw = 7.5 - i * 0.8;
      const bh = i === 0 ? 4 : 3;
      this.part(sb, MESH.BOX, px, y, pz, bw, bh, bw, 0, VERMILION, STYLE.PLAIN, 0);
      const rw = bw + 4.6;
      this.part(sb, MESH.HIP, px, y + bh, pz, rw, 1.5, rw, 0, dark, STYLE.PLAIN, 0);
      this.solid(sb, px - rw / 2, y, pz - rw / 2, px + rw / 2, y + bh + 1.5, pz + rw / 2);
      y += bh + 0.9;
    }
    this.part(sb, MESH.CYL, px, y, pz, 0.7, 9, 0.7, 0, 0x8f7d5a, STYLE.PLAIN, 0);
    for (const a of [-half + 11, -2]) for (const b of [-4.2, 4.2]) this.stoneLantern(sb, f, a, b);
    this.grove(sb, f, half, 5, rnd);
  }

  /** Width (fraction of the base) of the lattice tower at height fraction t of its lattice. */
  static latticeProfile(t: number): number {
    const u = 1 - clamp(t, 0, 1);
    return Math.max(0.06, 0.85 * Math.pow(u, 1.6) + 0.15 * u);
  }

  private genLatticeTower(sb: Superblock, cx: number, cz: number): void {
    const g = this.baseHeight(cx, cz);
    const H = 232;
    const lat = H * 0.86;
    const base = 46;
    this.box(sb, cx - 17, cz - 17, cx + 17, cz + 17, g - 3, g + 12, 0xe9e4dc, STYLE.OFFICE, 0.5);
    this.part(sb, MESH.LATTICE, cx, g, cz, base, lat, base, 0, 0xff6a2b, STYLE.LATTICE, 0);
    for (let i = 0; i < 8; i++) {
      const t0 = i / 8;
      const t1 = (i + 1) / 8;
      const w = (base * CityLayout.latticeProfile(t0)) / 2;
      this.solid(sb, cx - w, g + t0 * lat, cz - w, cx + w, g + t1 * lat, cz + w);
    }
    const deck = (t: number, w: number, h: number) => {
      const y = g + t * H;
      this.box(
        sb,
        cx - w / 2,
        cz - w / 2,
        cx + w / 2,
        cz + w / 2,
        y,
        y + h,
        0xf4efe6,
        STYLE.GLASS,
        0.77,
      );
    };
    deck(0.45, 20, 8);
    deck(0.72, 9.5, 5);
    this.part(sb, MESH.CYL, cx, g + lat, cz, 2.4, H - lat, 2.4, 0, 0xf2eee8, STYLE.PLAIN, 0);
    this.solid(sb, cx - 1.2, g + lat, cz - 1.2, cx + 1.2, g + H, cz + 1.2);
    this.part(sb, MESH.BOX, cx, g + H, cz, 1.6, 1.6, 1.6, 0, 0xff3b30, STYLE.BEACON, 0.2);
    sb.towers.push(cx, cz, 20, g + H);
  }

  /** The giant torii standing in the bay (after Itsukushima), the first thing the bird flies through. */
  private genBayTorii(sb: Superblock): void {
    const { x, z } = this.gate;
    const g = -3;
    const col = (px: number, pz: number, r: number, h: number) => {
      this.part(sb, MESH.CYL, px, g, pz, r * 2, h - g, r * 2, 0, VERMILION, STYLE.PLAIN, 0);
      this.solid(sb, px - r, g, pz - r, px + r, h, pz + r);
    };
    col(x - 11, z, 1.4, 25);
    col(x + 11, z, 1.4, 25);
    // Ryobu-style bracing legs fore and aft of each pillar.
    for (const sx of [-11, 11]) for (const sz of [-5, 5]) col(x + sx, z + sz, 0.7, 13);
    for (const sx of [-11, 11])
      this.box(
        sb,
        x + sx - 0.4,
        z - 5,
        x + sx + 0.4,
        z + 5,
        11.5,
        12.4,
        VERMILION,
        STYLE.PLAIN,
        0,
        false,
      );
    this.box(sb, x - 17, z - 1.2, x + 17, z + 1.2, 23.6, 25.4, VERMILION, STYLE.PLAIN, 0);
    this.box(sb, x - 19, z - 1.5, x + 19, z + 1.5, 25.4, 26.6, INK, STYLE.PLAIN, 0);
    this.box(sb, x - 14, z - 0.8, x + 14, z + 0.8, 18.2, 19.6, VERMILION, STYLE.PLAIN, 0);
    this.box(sb, x - 1.1, z - 0.7, x + 1.1, z + 0.7, 19.6, 23.6, INK, STYLE.PLAIN, 0, false);
  }

  // --- Avenues: street trees, expressways, bridges ---------------------------------------------

  private genAvenues(sb: Superblock, I: number, J: number): void {
    const S = this.S;
    const AH = this.AH;
    const rnd = mulberry32((hash2(I, J, this.seed + 888) * 4294967296) >>> 0);
    const ax = I * S; // this superblock owns the N-S avenue on its west edge...
    const az = J * S; // ...and the E-W avenue on its south edge
    // Ginkgo rows on the avenue sidewalks.
    for (let t = AH + 6; t < S - AH - 4; t += 11)
      for (const side of [-1, 1]) {
        const off = side * (AH - 2);
        if (this.baseHeight(ax + off, az + t) > 1.2)
          this.tree(sb, TREE.ROUND, ax + off, az + t, 0.5 + rnd() * 0.2, rnd());
        if (this.baseHeight(ax + t, az + off) > 1.2)
          this.tree(sb, TREE.ROUND, ax + t, az + off, 0.5 + rnd() * 0.2, rnd());
      }
    if (this.expressX(I)) this.expressway(sb, ax, az, true);
    if (this.expressZ(J)) {
      let wet = false;
      for (let t = 0; t <= S; t += S / 4) wet ||= this.inSea(ax + t, az);
      if (!wet) this.expressway(sb, ax, az, false);
    }
  }

  /** One superblock-long expressway segment: deck, barriers, lamps and T-pillars. */
  private expressway(sb: Superblock, ax: number, az: number, northSouth: boolean): void {
    const S = this.S;
    const y0 = northSouth ? 15 : 23;
    const y1 = y0 + 1.6;
    const hw = 7.5;
    const rect = (
      a0: number,
      a1: number,
      b0: number,
      b1: number,
      ya: number,
      yb: number,
      color: number,
      style: number,
      solid: boolean,
    ) => {
      // a runs along the expressway, b across it.
      if (northSouth)
        this.box(sb, ax + b0, az + a0, ax + b1, az + a1, ya, yb, color, style, 0, solid);
      else this.box(sb, ax + a0, az + b0, ax + a1, az + b1, ya, yb, color, style, 0, solid);
    };
    rect(0, S, -hw, hw, y0, y1, 0xa8a3ab, STYLE.PLAIN, true);
    rect(0, S, -hw, -hw + 0.4, y1, y1 + 1.1, 0xc9c5c9, STYLE.PLAIN, false);
    rect(0, S, hw - 0.4, hw, y1, y1 + 1.1, 0xc9c5c9, STYLE.PLAIN, false);
    for (let a = 20; a < S; a += 40) {
      const px = northSouth ? ax : ax + a;
      const pz = northSouth ? az + a : az;
      this.part(sb, MESH.CYL, px, -7, pz, 2.6, y0 - 1.2 + 7, 2.6, 0, 0xb4afb6, STYLE.PLAIN, 0);
      this.solid(sb, px - 1.3, -7, pz - 1.3, px + 1.3, y0, pz + 1.3);
      rect(a - 1.3, a + 1.3, -6, 6, y0 - 1.4, y0, 0xb4afb6, STYLE.PLAIN, false);
      // Sodium lamps on the barrier.
      rect(a - 0.12, a + 0.12, hw - 0.3, hw - 0.06, y1, y1 + 5, 0x8d8a93, STYLE.PLAIN, false);
      rect(a - 0.35, a + 0.35, hw - 1.4, hw - 0.1, y1 + 5, y1 + 5.4, 0xffb070, STYLE.LAMP, false);
    }
  }

  /** Flat bridges where avenues and streets cross the river. */
  private genBridges(sb: Superblock, I: number, J: number): void {
    const S = this.S;
    const ax = I * S;
    const az = J * S;
    this.bridgeLine(sb, ax, az, 0, S, true, this.AH);
    this.bridgeLine(sb, ax, az, 0, S, false, this.AH);
    if (this.superKind(I, J) !== 0) return;
    for (const c of [this.c1, this.c2]) {
      this.bridgeLine(sb, ax + c, az, this.AH, S - this.AH, true, this.SH);
      this.bridgeLine(sb, ax, az + c, this.AH, S - this.AH, false, this.SH);
    }
  }

  private bridgeLine(
    sb: Superblock,
    x: number,
    z: number,
    a0: number,
    a1: number,
    northSouth: boolean,
    hw: number,
  ): void {
    const step = 4;
    let run = -1;
    const flush = (end: number) => {
      if (run < 0 || end - run > 150) return; // longer than a river: that's the bay
      const s0 = run - 5;
      const s1 = end + 5;
      const deck = (
        b0: number,
        b1: number,
        ya: number,
        yb: number,
        color: number,
        solid: boolean,
      ) => {
        if (northSouth)
          this.box(sb, x + b0, z + s0, x + b1, z + s1, ya, yb, color, STYLE.PLAIN, 0, solid);
        else this.box(sb, x + s0, z + b0, x + s1, z + b1, ya, yb, color, STYLE.PLAIN, 0, solid);
      };
      deck(-hw, hw, 1.8, 3.3, 0xb7b0aa, true);
      deck(-hw, -hw + 0.5, 3.3, 4.4, 0xd5cfc8, false);
      deck(hw - 0.5, hw, 3.3, 4.4, 0xd5cfc8, false);
    };
    for (let a = a0; a <= a1; a += step) {
      const px = northSouth ? x : x + a;
      const pz = northSouth ? z + a : z;
      const wet = this.baseHeight(px, pz) < Config.world.waterLevel + 0.6 && !this.inSea(px, pz);
      if (wet && run < 0) run = a;
      if (!wet && run >= 0) {
        flush(a);
        run = -1;
      }
    }
    if (run >= 0) flush(a1);
  }

  // --- Queries (no allocation) -----------------------------------------------------------------

  /**
   * Top of the first solid box containing the point grown by `margin` (<= 4 m), or -Infinity.
   * The box itself is left in `hit`.
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    const S = this.S;
    const cs = (S + 2 * PAD) / GRID;
    const i0 = Math.floor((x - PAD) / S);
    const i1 = Math.floor((x + PAD) / S);
    const j0 = Math.floor((z - PAD) / S);
    const j1 = Math.floor((z + PAD) / S);
    for (let J = j0; J <= j1; J++)
      for (let I = i0; I <= i1; I++) {
        const ci = Math.floor((x - (I * S - PAD)) / cs);
        const cj = Math.floor((z - (J * S - PAD)) / cs);
        if (ci < 0 || cj < 0 || ci >= GRID || cj >= GRID) continue;
        const sb = this.superblock(I, J);
        const cell = sb.cells[cj * GRID + ci];
        const B = sb.boxes;
        for (let n = 0; n < cell.length; n++) {
          const k = cell[n] * BOX_STRIDE;
          if (
            x > B[k] - margin &&
            x < B[k + 3] + margin &&
            z > B[k + 2] - margin &&
            z < B[k + 5] + margin &&
            y > B[k + 1] - margin &&
            y < B[k + 4] + margin
          ) {
            for (let c = 0; c < 6; c++) this.hit[c] = B[k + c];
            return B[k + 4];
          }
        }
      }
    return -Infinity;
  }

  /**
   * Push a point out of every solid box (grown by margin) through the nearest face. Undersides
   * count only for boxes that float (decks, beams). Returns the distance moved; the last face
   * normal is written into `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let total = 0;
    for (let iter = 0; iter < 3; iter++) {
      if (this.solidTop(p.x, p.y, p.z, margin) === -Infinity) break;
      const h = this.hit;
      const west = p.x - (h[0] - margin);
      const east = h[3] + margin - p.x;
      const south = p.z - (h[2] - margin);
      const north = h[5] + margin - p.z;
      const up = h[4] + margin - p.y;
      const down = h[1] > 4 ? p.y - (h[1] - margin) : Infinity;
      const m = Math.min(west, east, south, north, up, down);
      n.x = n.y = n.z = 0;
      if (m === up) {
        p.y += up;
        n.y = 1;
      } else if (m === down) {
        p.y -= down;
        n.y = -1;
      } else if (m === west) {
        p.x -= west;
        n.x = -1;
      } else if (m === east) {
        p.x += east;
        n.x = 1;
      } else if (m === south) {
        p.z -= south;
        n.z = -1;
      } else {
        p.z += north;
        n.z = 1;
      }
      total += m;
    }
    return total;
  }

  /** Highest box top under (x, z) that is no higher than y (roofs, decks); -Infinity if none. */
  roofBelow(x: number, y: number, z: number): number {
    let best = -Infinity;
    const S = this.S;
    const cs = (S + 2 * PAD) / GRID;
    for (let J = Math.floor((z - PAD) / S); J <= Math.floor((z + PAD) / S); J++)
      for (let I = Math.floor((x - PAD) / S); I <= Math.floor((x + PAD) / S); I++) {
        const ci = Math.floor((x - (I * S - PAD)) / cs);
        const cj = Math.floor((z - (J * S - PAD)) / cs);
        if (ci < 0 || cj < 0 || ci >= GRID || cj >= GRID) continue;
        const sb = this.superblock(I, J);
        const cell = sb.cells[cj * GRID + ci];
        const B = sb.boxes;
        for (let n = 0; n < cell.length; n++) {
          const k = cell[n] * BOX_STRIDE;
          if (
            x > B[k] &&
            x < B[k + 3] &&
            z > B[k + 2] &&
            z < B[k + 5] &&
            B[k + 4] <= y + 1 &&
            B[k + 4] > best
          )
            best = B[k + 4];
        }
      }
    return best;
  }

  /** Highest box top within r metres (horizontally) of x, z; -Infinity if none. */
  skyline(x: number, z: number, r: number): number {
    let best = -Infinity;
    const S = this.S;
    for (let J = Math.floor((z - r - PAD) / S); J <= Math.floor((z + r + PAD) / S); J++)
      for (let I = Math.floor((x - r - PAD) / S); I <= Math.floor((x + r + PAD) / S); I++) {
        const B = this.superblock(I, J).boxes;
        for (let k = 0; k < B.length; k += BOX_STRIDE)
          if (
            x > B[k] - r &&
            x < B[k + 3] + r &&
            z > B[k + 2] - r &&
            z < B[k + 5] + r &&
            B[k + 4] > best
          )
            best = B[k + 4];
      }
    return best;
  }

  /** Tallest tower within r of x, z (written into out). */
  towerNear(x: number, z: number, r: number, out: Tower): boolean {
    let found = false;
    const S = this.S;
    for (let J = Math.floor((z - r) / S); J <= Math.floor((z + r) / S); J++)
      for (let I = Math.floor((x - r) / S); I <= Math.floor((x + r) / S); I++) {
        const T = this.superblock(I, J).towers;
        for (let k = 0; k < T.length; k += 4) {
          if (Math.hypot(T[k] - x, T[k + 1] - z) > r) continue;
          if (found && T[k + 3] <= out.top) continue;
          out.x = T[k];
          out.z = T[k + 1];
          out.half = T[k + 2];
          out.top = T[k + 3];
          found = true;
        }
      }
    return found;
  }
}
