import { Config } from '../../core/Config';
import { clamp, lerp, smoothstep } from '../../core/math';
import { createNoise2D, fbm, hash2, mulberry32, type Noise2D } from '../noise';

/**
 * City of Gold's plan as one pure, seeded function of position (no Three.js, unit-tested),
 * shared by the terrain, the instanced stone, collisions and the wisp planner.
 *
 * Map orientation: +z is north and -x is east (facing north, the bird's right is -x), so the
 * Old City reads like a map of Jerusalem. Around the origin the land is designed: the walled
 * Old City on its plateau, the Temple Mount platform in its south-east corner, the Kidron
 * valley under the east wall with the Mount of Olives beyond it, the Hinnom valley wrapping
 * round the west and south, the new city on the hills to the west. Further out it becomes
 * endless Judean hills: rounded limestone ridges cut by wadis, terraced olive orchards, pine
 * forest, and stone hill towns. Low roofs are soft ground (skimmed like a canopy); walls,
 * towers, domes and minarets are solid.
 */

/** Instanced mesh a part is drawn with. */
export const MESH = {
  BOX: 0,
  DOME: 1,
  PDOME: 2,
  ONION: 3,
  CYL: 4,
  CONE: 5,
  PYRAMID: 6,
  OCT: 7,
  MERLONS: 8,
  SOLAR: 9,
  HIP: 10,
  SAILS: 11,
  ARCH: 12,
} as const;
export const MESH_COUNT = 13;

/** Surface treatment in the stone shader. */
export const STYLE = {
  STONE: 0, // ashlar courses
  HOUSE: 1, // ashlar with small arched windows
  FLATS: 2, // ashlar with rows of windows
  FLOOD: 3, // ashlar, floodlit from below after dark (walls, landmarks)
  GOLD: 4, // gilded: sun glints by day, glowing after dark
  METAL: 5, // lead and silver domes
  TILE: 6, // glazed or fired tiles (the Dome's blue, red roofs)
  LAMP: 7, // emits after dark
  PLAIN: 8,
} as const;

/** Tree shapes (index into the level's Trees meshes). */
export const TREE = { OLIVE: 0, CYPRESS: 1, PINE: 2, PALM: 3 } as const;

/** Floats per part: mesh, x, y (base), z, sx, sy, sz, yaw, colour (0xRRGGBB), style, seed. */
export const PART_STRIDE = 11;
/** Floats per tree: type, x, y, z, scale, rotY, tint (the shared Trees stride). */
export const TREE_STRIDE = 7;

/**
 * Something solid: an oriented box, or a round body (minaret, drum) with an optional dome
 * cap. Box local axes: +x is world (c, -s), +z is world (s, c), as in the instance matrices.
 */
export interface Solid {
  round: boolean;
  x: number;
  z: number;
  /** Half sizes of a box; `hx` is the radius of a round body. */
  hx: number;
  hz: number;
  c: number;
  s: number;
  y0: number;
  /** Top of the body; a round body's dome cap rises `cap` above it. */
  y1: number;
  cap: number;
  top: number;
  /** Horizontal reach from (x, z) of any part of it. */
  reach: number;
}

/** A tall solid the wisps may spiral round. */
export interface Landmark {
  x: number;
  z: number;
  y0: number;
  top: number;
  reach: number;
}

export interface Block {
  parts: number[];
  trees: number[];
  solids: Solid[];
  landmarks: Landmark[];
}

/** Content lives in blocks of this size (centre-in-block); no solid reaches further than it. */
export const BLOCK = 64;
const CACHE = 5000;
const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

/** The Old City wall, clockwise from the north-east corner. */
const WALL: [number, number][] = [
  [-300, 300],
  [60, 320],
  [330, 290],
  [340, -60],
  [320, -300],
  [-300, -290],
];
/** The Temple Mount platform (raised, flat), in the south-east corner inside the walls. */
const PLAT = { x0: -300, x1: -120, z0: -284, z1: 40 };
const PLAT_RECT = { x: -210, z: -122, hx: 90, hz: 162 };
/** Valley floors as polylines: the Kidron under the east wall, the Hinnom round the west. */
const KIDRON: [number, number][] = [
  [-400, 1500],
  [-430, 600],
  [-440, 300],
  [-452, -100],
  [-440, -420],
  [-380, -800],
  [-300, -1500],
];
const HINNOM: [number, number][] = [
  [640, 760],
  [470, 330],
  [425, 100],
  [425, -200],
  [370, -420],
  [150, -505],
  [-150, -540],
  [-424, -520],
];
const CEMETERY = { x: -605, z: -195, hx: 95, hz: 125 };

interface Rect {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

/** Old City quarters' open ground: no houses (plazas, church courts, landmark lots). */
const LOTS: Rect[] = [
  PLAT_RECT, // the platform
  { x: -88, z: -102, hx: 32, hz: 46 }, // Western Wall plaza
  { x: 95, z: 32, hx: 25, hz: 26 }, // Holy Sepulchre and its court
  { x: 130, z: 72, hx: 14, hz: 10 }, // Church of the Redeemer
  { x: 45, z: -175, hx: 15, hz: 15 }, // Hurva
  { x: 330, z: -105, hx: 30, hz: 44 }, // the Citadel
  { x: 60, z: 296, hx: 16, hz: 12 }, // inside Damascus Gate
  { x: 318, z: -40, hx: 20, hz: 12 }, // inside Jaffa Gate
];
/** Open ground outside the walls that town houses keep off. */
const KEEP_OUT: Rect[] = [
  { x: 190, z: -380, hx: 34, hz: 30 }, // Dormition Abbey
  { x: -520, z: 70, hx: 22, hz: 22 }, // Mary Magdalene
  { x: -465, z: -5, hx: 50, hz: 45 }, // Gethsemane and the Church of All Nations
  { x: -770, z: 70, hx: 22, hz: 22 }, // the Russian tower
  { x: -795, z: 470, hx: 42, hz: 26 }, // Augusta Victoria
  { x: 540, z: -250, hx: 14, hz: 14 }, // the windmill
  { x: 640, z: -70, hx: 50, hz: 22 }, // the grand hotel
  { x: 700, z: -150, hx: 18, hz: 14 }, // the YMCA tower
  CEMETERY,
];

const STONE = [0xe6d3ad, 0xdcc59c, 0xd2b88f, 0xe4cfa6, 0xcdb48a, 0xeadcc0, 0xc9ae86, 0xdfc8a2];
const WALL_STONE = 0xd5bb8e;
const PALE = 0xece4d2;
const MARBLE = 0xece7dc;
const GOLD = 0xe8b84a;
const LEAD = 0x9ba3aa;
const BLUE = 0x3c76ad;
const DARK = 0x3b302a;
const TILE_RED = 0xb4553a;
const SLATE = 0x6c7077;

const pick = <T>(a: readonly T[], r: number): T =>
  a[Math.min(a.length - 1, Math.floor(r * a.length))];

/** Distance from (x, z) to segment a-b; its parameter at the nearest point goes in `segT`. */
let segT = 0;
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  segT = t;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Distance to a polyline; the nearest segment's index goes in `lineSeg`. */
let lineSeg = 0;
function lineDist(x: number, z: number, P: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < P.length; i++) {
    const d = segDist(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
    if (d < best) {
      best = d;
      lineSeg = i;
    }
  }
  return best;
}

/** Signed distance to the wall polygon: negative inside. */
function wallSd(x: number, z: number): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = WALL.length - 1; i < WALL.length; j = i++) {
    const [ax, az] = WALL[j];
    const [bx, bz] = WALL[i];
    d = Math.min(d, segDist(x, z, ax, az, bx, bz));
    if (bz > z !== az > z && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
  }
  return inside ? -d : d;
}

/** Signed distance to an axis-aligned rectangle (negative inside). */
function rectSd(x: number, z: number, r: Rect): number {
  const dx = Math.abs(x - r.x) - r.hx;
  const dz = Math.abs(z - r.z) - r.hz;
  return dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);
}

/** Valley cross-section: 1 on the floor, easing to 0 at half width w. */
const trough = (d: number, w: number) => 1 - smoothstep(0.12, 1, d / w);

export class JerusalemLayout {
  readonly seed: number;
  /**
   * On the Mount of Olives above the cemetery, facing the Old City across the Kidron: the
   * golden dome dead ahead, the city rising behind it, the sun at the bird's back.
   */
  readonly spawn = { x: -640, y: 128, z: -95, yaw: Math.PI / 2 };
  /** Height of the Temple Mount platform. */
  readonly platformY: number;
  /** The Dome of the Rock (wisps circle it first). */
  readonly dome: Landmark;
  /** The last solid a query hit, as a box: x0, y0, z0, x1, y1, z1 (y0 = base, y1 = top). */
  readonly hit = new Float64Array(6);

  // Scratch results of `at()`, for the point it was last called with.
  private ax = NaN;
  private az = NaN;
  /** Weight of the designed land round the Old City (1) against the endless hills (0). */
  w = 0;
  /** Signed distance to the Old City wall (negative inside). */
  sd = 0;
  /** Valley floors: 1 on the floor of the Kidron, Hinnom or a wadi, 0 up on the hills. */
  valley = 0;
  /** Final terrain height. */
  y = 0;
  /** 0..1 terraced orchard, and how much of a terrace's stone riser (x, z) is. */
  terrace = 0;
  riser = 0;
  /** 0..1 Old City roofscape (houses packed wall to wall). */
  fabric = 0;
  /** 0..1 town (new city, hill towns, villages) and its kind: modern flats, red roofs. */
  town = 0;
  modern = 0;
  red = 0;
  /** 0..1 olive orchard and pine forest. */
  olive = 0;
  pine = 0;
  /** Soft roof and canopy height over the terrain. */
  canopyH = 0;

  private readonly nHill: Noise2D;
  private readonly nDetail: Noise2D;
  private readonly nWadi: Noise2D;
  private readonly nTown: Noise2D;
  private readonly nStyle: Noise2D;
  private readonly nRoof: Noise2D;
  private readonly nOlive: Noise2D;
  private readonly nPine: Noise2D;
  private readonly nNear: Noise2D;
  private readonly statics = new Map<number, Block>();
  private readonly blocks = new Map<number, Block>();
  private readonly hitCells = new Map<number, Solid[]>();

  constructor(seed: number) {
    this.seed = seed;
    this.nHill = createNoise2D(seed + 501);
    this.nDetail = createNoise2D(seed + 502);
    this.nWadi = createNoise2D(seed + 503);
    this.nTown = createNoise2D(seed + 504);
    this.nStyle = createNoise2D(seed + 505);
    this.nRoof = createNoise2D(seed + 506);
    this.nOlive = createNoise2D(seed + 507);
    this.nPine = createNoise2D(seed + 508);
    this.nNear = createNoise2D(seed + 509);
    this.platformY = this.plateau(-210, -120) + 7;
    const Hp = this.platformY;
    this.dome = { x: -205, z: -95, y0: Hp, top: Hp + 32.5, reach: 19 };
    this.buildOldCity();
    this.buildLandmarks();
  }

  // --- Ground ----------------------------------------------------------------------------------

  /** The Old City's ground: it falls gently from the north-west to the south-east. */
  plateau(x: number, z: number): number {
    return Config.jerusalem.plateau + 0.012 * x + 0.014 * z;
  }

  private wadiNoise(x: number, z: number): number {
    const f = Config.jerusalem.wadiScale;
    return fbm(this.nWadi, x * f, z * f, 2);
  }

  /** Distance to a wadi's floor line: the zero contour of a noise, |n| / |grad n|. */
  private wadiDist(x: number, z: number): number {
    const e = 4;
    const v = this.wadiNoise(x, z);
    const gx = (this.wadiNoise(x + e, z) - v) / e;
    const gz = (this.wadiNoise(x, z + e) - v) / e;
    this.wgx = gx;
    this.wgz = gz;
    this.wv = v;
    return Math.abs(v) / Math.max(Math.hypot(gx, gz), 1e-6);
  }
  private wgx = 0;
  private wgz = 0;
  private wv = 0;

  /**
   * Fill the scratch fields for (x, z): terrain, valleys, the Old City, towns, orchards and
   * forest, the soft canopy. Every query goes through here, so they all agree.
   */
  at(x: number, z: number): void {
    if (x === this.ax && z === this.az) return;
    this.ax = x;
    this.az = z;
    const K = Config.jerusalem;
    const r = Math.hypot(x, z);
    const w = (this.w = 1 - smoothstep(1000, 1600, r));
    let y = 0;
    let valley = 0;
    let townP = 0;
    if (w < 1) {
      // Endless Judean hills: broad rounded ridges, cut by wadis.
      const s = K.hillScale;
      const hills = 72 + K.hills * fbm(this.nHill, x * s, z * s, 3);
      const d = this.wadiDist(x, z);
      const wadi = trough(d, K.wadiWidth);
      const yp = Math.max(
        hills + 12 * fbm(this.nDetail, x * 0.0045, z * 0.0045, 2) - K.wadiDepth * wadi,
        10,
      );
      y = yp;
      valley = wadi;
      // Towns crown the hills and keep out of the wadis.
      townP =
        (smoothstep(0.05, 0.4, fbm(this.nTown, x * 0.0012, z * 0.0012, 2)) * 0.8 +
          0.35 * smoothstep(85, 115, yp)) *
        (1 - smoothstep(0.2, 0.6, wadi));
    }
    let townD = 0;
    if (w > 0) {
      // The designed land round the Old City.
      let yd = 68 + 9 * fbm(this.nDetail, x * 0.004, z * 0.004, 2) + 0.012 * Math.max(0, x - 450);
      yd += 44 * Math.exp(-(((x + 780) / 240) ** 2)) * smoothstep(-1500, -700, z);
      yd += 30 * Math.exp(-((x + 560) ** 2 + (z - 820) ** 2) / 300 ** 2);
      const kid = trough(lineDist(x, z, KIDRON), 150);
      const hin = trough(lineDist(x, z, HINNOM), 105);
      yd = Math.max(yd - 44 * kid - 36 * hin, 14);
      y = lerp(y, yd, w);
      const vd = Math.max(kid, hin);
      valley = lerp(valley, vd, w);
      // The new city on the western hills and the north, villages on the Mount of Olives and
      // the Kidron's east slope, all clear of the valley floors.
      const dry = 1 - smoothstep(0.25, 0.6, vd);
      const west = smoothstep(470, 560, x);
      const north = smoothstep(390, 470, z) * smoothstep(-640, -520, x);
      const ridge = smoothstep(-690, -760, x) * (1 - smoothstep(520, 700, Math.abs(z - 80)));
      const silwan =
        0.75 * smoothstep(-450, -500, x) * smoothstep(-700, -620, z) * smoothstep(-300, -380, z);
      const zion = 0.7 * (1 - smoothstep(60, 120, Math.hypot(x - 160, z + 400)));
      townD = Math.max(west, north, ridge, silwan, zion) * 0.85 * dry;
    }
    this.valley = valley;
    // The Old City: a flat plateau inside the walls, the platform raised in its corner. (Far
    // out none of it is near: skip the polygon and the lots.)
    const near = r < 1300;
    const sd = (this.sd = near ? wallSd(x, z) : r - 300);
    if (sd < 34) y = lerp(this.plateau(x, z), y, smoothstep(-4, 34, sd));
    const ps = near ? rectSd(x, z, PLAT_RECT) : Infinity;
    if (ps < 4) y = lerp(this.platformY, y, smoothstep(0, 4, ps));
    // Soft roofscape over the Old City's houses (open lots excepted).
    let lot = 0;
    let keep = 0;
    if (near) {
      for (const L of LOTS) lot = Math.max(lot, 1 - smoothstep(0, 8, rectSd(x, z, L)));
      for (const R of KEEP_OUT) keep = Math.max(keep, 1 - smoothstep(0, 10, rectSd(x, z, R)));
    }
    this.fabric = smoothstep(6, 16, -sd) * (1 - lot);
    const town = lerp(townP, townD, w) * smoothstep(30, 70, sd) * (1 - keep);
    this.town = smoothstep(0.42, 0.62, town);
    this.modern = lerp(
      smoothstep(-0.15, 0.35, fbm(this.nStyle, x * 0.002, z * 0.002, 2)),
      smoothstep(470, 560, x) * (1 - smoothstep(60, 110, Math.hypot(x - 560, z + 250))),
      w,
    );
    this.red = smoothstep(0.3, 0.55, fbm(this.nRoof, x * 0.003, z * 0.003, 2)) * (1 - this.modern);
    // Orchards on the slopes and valley sides, pine forest on the hills between the towns.
    const open = (1 - this.town) * smoothstep(20, 60, sd) * (1 - keep * 0.7);
    const nO = fbm(this.nOlive, x * 0.003, z * 0.003, 2);
    this.olive = smoothstep(-0.1, 0.25, nO + valley * 0.35) * open;
    this.pine =
      smoothstep(0.15, 0.45, fbm(this.nPine, x * 0.0022, z * 0.0022, 2) - this.olive * 0.4) *
      open *
      (1 - smoothstep(0.3, 0.7, valley)) *
      (near ? 1 - this.cemetery(x, z) : 1);
    // Terraced orchards: the slope is cut into level steps with dry-stone risers.
    this.terrace = smoothstep(0.3, 0.6, this.olive) * (near ? 1 - this.cemetery(x, z) : 1);
    this.riser = 0;
    if (this.terrace > 0) {
      const step = K.terraceStep;
      const f = y / step;
      const i = Math.floor(f);
      const fr = f - i;
      const q = (i + smoothstep(0.8, 1, fr)) * step;
      y = lerp(y, q, this.terrace);
      this.riser = this.terrace * smoothstep(0.74, 0.84, fr);
    }
    this.y = y;
    // Soft ground over the roofs and treetops.
    const townH = K.townRoof * lerp(0.75, 1.3, this.modern);
    this.canopyH = Math.max(
      this.fabric * K.fabricRoof,
      this.town * townH,
      smoothstep(0.5, 0.8, this.pine) * K.forestCanopy,
      smoothstep(0.55, 0.85, this.olive) * 4,
    );
    // Fine variation for colour (kept here so one call fills everything a vertex needs).
    this.tint = this.nNear(x * 0.01, z * 0.01);
  }
  tint = 0;

  /** Terrain height. */
  height(x: number, z: number): number {
    this.at(x, z);
    return this.y;
  }

  /** Terrain plus the soft canopy (roofs, treetops) the bird skims. */
  ground(x: number, z: number): number {
    this.at(x, z);
    return this.y + this.canopyH;
  }

  /**
   * Nearest valley floor line (Kidron, Hinnom or a wadi) and its direction, the one closer to
   * `yaw`. Returns the distance; the heading goes in `vh`.
   */
  valleyAt(x: number, z: number, yaw: number): number {
    const w = 1 - smoothstep(1000, 1600, Math.hypot(x, z));
    let d: number;
    let a: number;
    if (w > 0.5) {
      const dk = lineDist(x, z, KIDRON);
      const sk = lineSeg;
      const dh = lineDist(x, z, HINNOM);
      const P = dk < dh ? KIDRON : HINNOM;
      const i = dk < dh ? sk : lineSeg;
      d = Math.min(dk, dh);
      a = Math.atan2(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    } else {
      d = this.wadiDist(x, z);
      a = Math.atan2(-this.wgz, this.wgx); // along the contour
    }
    this.vh = Math.sin(a) * Math.sin(yaw) + Math.cos(a) * Math.cos(yaw) >= 0 ? a : a + Math.PI;
    return d;
  }
  vh = 0;

  /** One damped step from (x, z) toward the nearest valley floor line; writes into `out`. */
  toValley(x: number, z: number, out: { x: number; z: number }): void {
    const w = 1 - smoothstep(1000, 1600, Math.hypot(x, z));
    out.x = x;
    out.z = z;
    if (w > 0.5) {
      const dk = lineDist(x, z, KIDRON);
      const sk = lineSeg;
      const dh = lineDist(x, z, HINNOM);
      const P = dk < dh ? KIDRON : HINNOM;
      const i = dk < dh ? sk : lineSeg;
      // The nearest point on the winning segment.
      segDist(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
      out.x = lerp(P[i][0], P[i + 1][0], segT);
      out.z = lerp(P[i][1], P[i + 1][1], segT);
    } else {
      this.wadiDist(x, z);
      const g2 = Math.max(this.wgx * this.wgx + this.wgz * this.wgz, 1e-12);
      out.x = x - (this.wv * this.wgx) / g2;
      out.z = z - (this.wv * this.wgz) / g2;
    }
  }

  /** On the Temple Mount platform. */
  inPlatform(x: number, z: number): boolean {
    return x > PLAT.x0 && x < PLAT.x1 && z > PLAT.z0 && z < PLAT.z1;
  }

  /** 1 on the Dome of the Rock's raised dais, easing to 0 just off it. */
  onDais(x: number, z: number): number {
    return 1 - smoothstep(30, 34, Math.max(Math.abs(x - this.dome.x), Math.abs(z - this.dome.z)));
  }

  /** Distance through the Mount of Olives cemetery: 0 at its heart, 1 at its ragged edge. */
  cemeteryD(x: number, z: number): number {
    const T = CEMETERY;
    const u = (x - T.x) / T.hx;
    const v = (z - T.z) / T.hz;
    const a = Math.atan2(u, v);
    return Math.hypot(u, v) * (1 + 0.12 * Math.sin(3 * a + 1) + 0.07 * Math.sin(7 * a + 2));
  }

  /** 1 in the cemetery, easing to 0 just outside it. */
  cemetery(x: number, z: number): number {
    return 1 - smoothstep(0.92, 1.12, this.cemeteryD(x, z));
  }

  /** Inside the Old City walls (with a margin). */
  inOldCity(x: number, z: number, margin = 0): boolean {
    return wallSd(x, z) < -margin;
  }

  // --- Content ---------------------------------------------------------------------------------

  private bucket(x: number, z: number): Block {
    const k = key(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
    let b = this.statics.get(k);
    if (!b) {
      b = { parts: [], trees: [], solids: [], landmarks: [] };
      this.statics.set(k, b);
    }
    return b;
  }

  private part(
    out: Block,
    mesh: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    color: number,
    style: number,
    seed = 0.5,
  ): void {
    out.parts.push(mesh, x, y, z, sx, sy, sz, yaw, color, style, seed);
  }

  /** A static part (bucketed by its position). */
  private sp(
    mesh: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    color: number,
    style: number,
    seed = 0.5,
  ): void {
    this.part(this.bucket(x, z), mesh, x, y, z, sx, sy, sz, yaw, color, style, seed);
  }

  private solidBox(
    out: Block,
    x: number,
    z: number,
    hx: number,
    hz: number,
    yaw: number,
    y0: number,
    y1: number,
  ): void {
    out.solids.push({
      round: false,
      x,
      z,
      hx,
      hz,
      c: Math.cos(yaw),
      s: Math.sin(yaw),
      y0,
      y1,
      cap: 0,
      top: y1,
      reach: Math.hypot(hx, hz),
    });
  }

  private solidRound(
    out: Block,
    x: number,
    z: number,
    r: number,
    y0: number,
    y1: number,
    cap = 0,
  ): void {
    out.solids.push({
      round: true,
      x,
      z,
      hx: r,
      hz: r,
      c: 1,
      s: 0,
      y0,
      y1,
      cap,
      top: y1 + cap,
      reach: r,
    });
  }

  /** A solid stone box drawn and collided as one (static). */
  private block3(
    x: number,
    z: number,
    sx: number,
    sz: number,
    y0: number,
    y1: number,
    yaw: number,
    color: number,
    style: number,
  ): void {
    const b = this.bucket(x, z);
    this.part(b, MESH.BOX, x, y0, z, sx, y1 - y0, sz, yaw, color, style, hash2(x, z, 9));
    this.solidBox(b, x, z, sx / 2, sz / 2, yaw, y0, y1);
  }

  /** A round body (drum, tower) with an optional dome on it (static, solid). */
  private drum(
    x: number,
    z: number,
    r: number,
    y0: number,
    h: number,
    color: number,
    style: number,
    dome: { mesh: number; h: number; color: number; style: number; r?: number } | null,
    mesh: number = MESH.CYL,
  ): void {
    const b = this.bucket(x, z);
    this.part(b, mesh, x, y0, z, r * 2, h, r * 2, 0, color, style);
    let cap = 0;
    if (dome) {
      const dr = dome.r ?? r;
      this.part(b, dome.mesh, x, y0 + h, z, dr * 2, dome.h, dr * 2, 0, dome.color, dome.style);
      cap = dome.h;
    }
    this.solidRound(b, x, z, r, y0, y0 + h, cap);
  }

  private landmark(x: number, z: number, y0: number, top: number, reach: number): void {
    this.bucket(x, z).landmarks.push({ x, z, y0, top, reach });
  }

  private tree(type: number, x: number, z: number, s: number, out?: Block): void {
    const t = out ?? this.bucket(x, z);
    t.trees.push(
      type,
      x,
      this.height(x, z) - 0.3,
      z,
      s,
      hash2(x * 7, z * 7, 31) * Math.PI * 2,
      hash2(x * 7, z * 7, 32),
    );
  }

  /** Minimum terrain under a footprint (corners and centre), for a base that never floats. */
  private footing(x: number, z: number, hx: number, hz: number, yaw: number): number {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let m = this.height(x, z);
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const lx = a * hx;
      const lz = b * hz;
      m = Math.min(m, this.height(x + lx * c + lz * s, z - lx * s + lz * c));
    }
    return m;
  }

  /** The walls, gates and the houses packed inside them, with the quarters' landmarks. */
  private buildOldCity(): void {
    const K = Config.jerusalem;
    const rand = mulberry32(this.seed + 77);
    // Gates: [x, z, edge index] (Damascus sits on the corner between edges 0 and 1).
    const gates: [number, number, number, boolean][] = [
      [60, 320, 0, true], // Damascus
      [-120, 310, 0, false], // Herod's
      [300, 293.3, 1, false], // New
      [339.4, -40, 2, true], // Jaffa
      [130, -296.9, 4, false], // Zion
      [-80, -293.5, 4, false], // Dung
      [-300, 160, 5, false], // Lions
    ];
    const nearGate = (x: number, z: number, r: number) =>
      gates.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < r) || Math.hypot(x + 300, z + 20) < r; // the Golden Gate
    for (let e = 0; e < WALL.length; e++) {
      const [ax, az] = WALL[e];
      const [bx, bz] = WALL[(e + 1) % WALL.length];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const yaw = Math.atan2(-dz, dx);
      const n = Math.ceil(len / K.towerEvery);
      const piece = len / n;
      for (let k = 0; k < n; k++) {
        const t0 = k * piece;
        const mx = ax + dx * (t0 + piece / 2);
        const mz = az + dz * (t0 + piece / 2);
        const top = this.plateau(mx, mz) + K.wallHeight;
        let base = Infinity;
        for (let s = -piece / 2; s <= piece / 2; s += 4)
          for (const o of [-2, 3])
            base = Math.min(base, this.height(mx + dx * s - dz * o, mz + dz * s + dx * o));
        // One piece of curtain wall, a walkway behind the merlons.
        this.block3(mx, mz, piece + 1, 3.2, base - 2, top, yaw, WALL_STONE, STYLE.FLOOD);
        for (let m = 0; m < Math.floor(piece / 8); m++) {
          const s = -piece / 2 + 4 + m * 8 + (piece % 8) / 2;
          this.sp(
            MESH.MERLONS,
            mx + dx * s,
            top,
            mz + dz * s,
            1,
            1,
            1,
            yaw,
            WALL_STONE,
            STYLE.FLOOD,
          );
        }
        // A square tower at the start of each piece, standing out from the wall.
        const tx = ax + dx * t0 - dz * 2.2;
        const tz = az + dz * t0 + dx * 2.2;
        if (nearGate(tx, tz, 16)) continue;
        const tb = this.footing(tx, tz, 4.5, 4.5, yaw) - 2;
        this.block3(tx, tz, 9, 9, tb, top + 3.5, yaw, WALL_STONE, STYLE.FLOOD);
        for (let q = 0; q < 4; q++) {
          const a = yaw + (q * Math.PI) / 2;
          // Merlons round the tower's top, each row on its outer edge.
          this.sp(
            MESH.MERLONS,
            tx + Math.sin(a) * 3.4,
            top + 3.5,
            tz + Math.cos(a) * 3.4,
            1.05,
            1,
            1,
            a,
            WALL_STONE,
            STYLE.FLOOD,
          );
        }
      }
    }
    for (const [gx, gz, e, grand] of gates) {
      const [ax, az] = WALL[e];
      const [bx, bz] = WALL[(e + 1) % WALL.length];
      let dx = bx - ax;
      let dz = bz - az;
      if (e === 0 && grand) {
        // On the corner: square to both edges.
        const [cx, cz] = WALL[2];
        dx = cx - ax;
        dz = cz - az;
      }
      const l = Math.hypot(dx, dz);
      this.gatehouse(gx, gz, dx / l, dz / l, grand);
    }
    this.goldenGate();
    // Houses: a jittered grid, flat roofs a storey or two above the alleys, small domes. Sizes
    // and offsets vary enough that neighbours merge into irregular blocks, as in the real
    // quarters, rather than reading as a grid from the air.
    const C = 11;
    for (let j = Math.floor(-300 / C); j <= Math.ceil(325 / C); j++)
      for (let i = Math.floor(-305 / C); i <= Math.ceil(345 / C); i++) {
        const x = (i + 0.5) * C + (hash2(i, j, this.seed + 81) - 0.5) * 4;
        const z = (j + 0.5) * C + (hash2(i, j, this.seed + 82) - 0.5) * 4;
        this.at(x, z);
        if (this.fabric < 0.97) continue;
        const big = hash2(i, j, this.seed + 89) < 0.18 ? 1.45 : 1;
        const sx = (6.8 + 4.2 * hash2(i, j, this.seed + 84)) * big;
        const sz = (6.8 + 4.2 * hash2(i, j, this.seed + 85)) * big;
        // The main streets (~7 m wide): David Street from Jaffa Gate, the Cardo from Damascus
        // Gate, the way in from Lions Gate, the lane up from Zion Gate.
        if (Math.abs(z + 42) < 3.5 + sz / 2 && x > -120) continue;
        if (Math.abs(x - 60) < 3.5 + sx / 2) continue;
        if (Math.abs(z - 160) < 3 + sz / 2 && x < 60) continue;
        if (Math.abs(x - 130) < 3 + sx / 2 && z < -42) continue;
        const h = hash2(i, j, this.seed + 83);
        if (h < 0.07) {
          // A courtyard with a tree.
          this.tree(h < 0.02 ? TREE.PALM : h < 0.045 ? TREE.CYPRESS : TREE.OLIVE, x, z, 0.8);
          continue;
        }
        const yaw = (hash2(i, j, this.seed + 86) - 0.5) * 0.14;
        const g = this.height(x, z);
        const roof = g + K.fabricRoof - 0.7 - 2.6 * hash2(i, j, this.seed + 87);
        const base = this.footing(x, z, sx / 2, sz / 2, yaw) - 1;
        const col = pick(STONE, hash2(i, j, this.seed + 88));
        const b = this.bucket(x, z);
        this.part(b, MESH.BOX, x, base, z, sx, roof - base, sz, yaw, col, STYLE.HOUSE, rand());
        const r = rand();
        if (r < 0.32) {
          const dr = Math.min(sx, sz) * (0.48 + 0.12 * rand());
          this.part(b, MESH.DOME, x, roof, z, dr, dr * 0.42, dr, 0, col, STYLE.STONE, rand());
        } else if (r < 0.55)
          this.part(
            b,
            MESH.SOLAR,
            x + 1.5,
            roof,
            z - 1,
            1,
            1,
            1,
            yaw + rand() * 0.6,
            0xffffff,
            STYLE.PLAIN,
          );
        else if (r < 0.65)
          this.part(
            b,
            MESH.BOX,
            x - 1.6,
            roof,
            z + 1.2,
            3.4,
            2.3,
            3.2,
            yaw,
            col,
            STYLE.HOUSE,
            rand(),
          );
      }
    this.oldCityLandmarks();
  }

  /** A gatehouse astride the wall: taller than the curtain, merlons, a dark arch outside. */
  private gatehouse(x: number, z: number, dx: number, dz: number, grand: boolean): void {
    const K = Config.jerusalem;
    const yaw = Math.atan2(-dz, dx);
    const top = this.plateau(x, z) + K.wallHeight + (grand ? 5 : 3);
    const len = grand ? 26 : 18;
    const cx = x - dz * 1.5;
    const cz = z + dx * 1.5;
    const base = this.footing(cx, cz, len / 2, 5, yaw) - 2;
    this.block3(cx, cz, len, 10, base, top, yaw, WALL_STONE, STYLE.FLOOD);
    for (const s of [-1, 1])
      for (let m = 0; m < len / 8 - 0.5; m++) {
        const o = -len / 2 + 4 + m * 8 + (len % 8) / 2;
        this.sp(
          MESH.MERLONS,
          cx + dx * o - dz * s * 3.8,
          top,
          cz + dz * o + dx * s * 3.8,
          1,
          1,
          1,
          s > 0 ? yaw : yaw + Math.PI,
          WALL_STONE,
          STYLE.FLOOD,
        );
      }
    const g = this.height(cx - dz * 6, cz + dx * 6);
    this.sp(
      MESH.ARCH,
      cx - dz * 5.05,
      g - 0.5,
      cz + dx * 5.05,
      grand ? 6 : 4.6,
      grand ? 9 : 7.5,
      0.3,
      yaw,
      DARK,
      STYLE.PLAIN,
    );
    if (grand)
      for (const s of [-1, 1])
        this.drum(cx + dx * s * 11, cz + dz * s * 11, 1.8, top, 4, WALL_STONE, STYLE.FLOOD, {
          mesh: MESH.CONE,
          h: 2.5,
          color: WALL_STONE,
          style: STYLE.FLOOD,
          r: 2.1,
        });
  }

  /** The Golden Gate on the east wall: a double gate under two domes, sealed for centuries. */
  private goldenGate(): void {
    const Hp = this.platformY;
    const x = -303;
    const z = -20;
    const base = this.footing(x, z, 7, 11, 0) - 2;
    this.block3(x, z, 14, 24, base, Hp + 9, 0, WALL_STONE, STYLE.FLOOD);
    for (const s of [-1, 1]) {
      this.sp(MESH.DOME, x, Hp + 9, z + s * 6, 9, 3.8, 9, 0, LEAD, STYLE.METAL);
      this.sp(
        MESH.ARCH,
        x - 7.05,
        Hp - 4,
        z + s * 6,
        5,
        9,
        0.4,
        Math.PI / 2,
        0xc3a67c,
        STYLE.STONE,
      );
    }
  }

  private oldCityLandmarks(): void {
    const Hp = this.platformY;
    const g = (x: number, z: number) => this.height(x, z);
    // The platform's retaining walls (the Western Wall faces the plaza).
    const P = PLAT;
    for (let z = P.z0; z < P.z1 - 1; z += 54) {
      const z1 = Math.min(z + 54, P.z1);
      const zm = (z + z1) / 2;
      this.block3(
        P.x1 - 1.5,
        zm,
        3,
        z1 - z,
        g(P.x1 + 4, zm) - 2,
        Hp + 1.2,
        0,
        0xd2b98d,
        STYLE.FLOOD,
      );
    }
    for (let x = P.x0 + 4; x < P.x1 - 1; x += 58) {
      const x1 = Math.min(x + 58, P.x1);
      const xm = (x + x1) / 2;
      this.block3(
        xm,
        P.z1 + 1.5,
        x1 - x,
        3,
        g(xm, P.z1 + 5) - 2,
        Hp + 1.2,
        0,
        0xd2b98d,
        STYLE.FLOOD,
      );
    }
    // The Dome of the Rock: an octagon of marble below and blue tile above, a tiled drum and
    // the gilded dome, on a raised stone dais.
    const D = this.dome;
    const b = this.bucket(D.x, D.z);
    this.part(b, MESH.BOX, D.x, Hp - 0.5, D.z, 64, 2.1, 64, 0, 0xe2d7bf, STYLE.STONE);
    this.solidBox(b, D.x, D.z, 32, 32, 0, Hp - 0.5, Hp + 1.6);
    const oy = Hp + 1.6;
    this.part(b, MESH.OCT, D.x, oy, D.z, 38, 4.6, 38, 0, MARBLE, STYLE.STONE);
    this.part(b, MESH.OCT, D.x, oy + 4.6, D.z, 38, 6.6, 38, 0, BLUE, STYLE.TILE);
    this.part(b, MESH.OCT, D.x, oy + 11.2, D.z, 38.8, 0.8, 38.8, 0, 0x2a5684, STYLE.TILE);
    this.part(b, MESH.CONE, D.x, oy + 12, D.z, 38, 2.2, 38, 0, LEAD, STYLE.METAL);
    this.part(b, MESH.CYL, D.x, oy + 12.6, D.z, 22.4, 6.6, 22.4, 0, BLUE, STYLE.TILE);
    this.part(b, MESH.PDOME, D.x, oy + 19.2, D.z, 23, 11.7, 23, 0, GOLD, STYLE.GOLD);
    this.part(b, MESH.CYL, D.x, oy + 30.6, D.z, 0.5, 3, 0.5, 0, GOLD, STYLE.GOLD);
    this.solidRound(b, D.x, D.z, 19.3, Hp, oy + 14.2);
    this.solidRound(b, D.x, D.z, 11.5, oy + 14.2, oy + 19.2, 11.7);
    this.landmark(D.x, D.z, Hp, D.top, D.reach);
    // The Dome of the Chain beside it.
    this.part(b, MESH.OCT, D.x + 44, oy, D.z, 11, 4, 11, 0, MARBLE, STYLE.TILE);
    this.part(b, MESH.DOME, D.x + 44, oy + 4, D.z, 8, 3.6, 8, 0, LEAD, STYLE.METAL);
    this.solidRound(b, D.x + 44, D.z, 5.6, Hp, oy + 4, 3.6);
    // Arcades at the head of the dais stairs.
    for (const [cx, cz, alongX] of [
      [D.x + 32, D.z - 14, 0],
      [D.x - 14, D.z + 32, 1],
      [D.x + 14, D.z - 32, 1],
    ])
      for (let k = -2; k <= 2; k++)
        this.sp(
          MESH.CYL,
          cx + (alongX ? k * 3.4 : 0),
          oy,
          cz + (alongX ? 0 : k * 3.4),
          0.7,
          4.2,
          0.7,
          0,
          MARBLE,
          STYLE.STONE,
        );
    // Al-Aqsa at the south end: a long hall, a raised nave, a porch, the silver dome.
    const ax = -205;
    const az = -246;
    this.block3(ax, az, 30, 62, Hp - 1, Hp + 11, 0, 0xd8c6a2, STYLE.HOUSE);
    this.block3(ax, az, 12, 62, Hp - 1, Hp + 15, 0, 0xd8c6a2, STYLE.HOUSE);
    this.block3(ax, az + 35, 30, 8, Hp - 1, Hp + 9, 0, 0xdccba8, STYLE.FLOOD);
    this.drum(ax, az + 16, 7.2, Hp + 15, 3.2, 0xd8c6a2, STYLE.STONE, {
      mesh: MESH.PDOME,
      h: 8,
      color: LEAD,
      style: STYLE.METAL,
      r: 7.4,
    });
    // Minarets at the platform's corners and gates.
    this.minaret(-127, 33, Hp, 34, true);
    this.minaret(-126, -82, g(-126, -82), 30, true);
    this.minaret(-128, -278, g(-128, -278), 26, true);
    this.minaret(-292, 34, Hp, 32, false);
    // Trees on the platform: cypress rows and olives, clear of the dais and the mosque.
    for (let k = 0; k < 90; k++) {
      const x = lerp(P.x0 + 10, P.x1 - 10, hash2(k, 1, this.seed + 91));
      const z = lerp(P.z0 + 10, P.z1 - 10, hash2(k, 2, this.seed + 91));
      if (Math.abs(x - D.x) < 40 && Math.abs(z - D.z) < 40) continue;
      if (Math.abs(x - ax) < 22 && z < az + 46) continue;
      if (Math.abs(x - D.x - 44) < 10 && Math.abs(z - D.z) < 10) continue;
      this.tree(hash2(k, 3, this.seed) < 0.35 ? TREE.CYPRESS : TREE.OLIVE, x, z, 0.9);
    }
    // The Western Wall plaza: a few palms at its edge.
    for (let k = 0; k < 5; k++) this.tree(TREE.PALM, -62, -142 + k * 22, 1);
    // The Church of the Holy Sepulchre: the great grey rotunda dome, a smaller one, a squat
    // bell tower, in weathered stone.
    const hx = 95;
    const hz = 40;
    const hg = g(hx, hz);
    this.block3(hx, hz, 34, 40, hg - 1, hg + 13, 0, 0xc7b18c, STYLE.FLOOD);
    this.drum(hx + 9, hz + 2, 11, hg + 13, 6, 0xc7b18c, STYLE.STONE, {
      mesh: MESH.PDOME,
      h: 9.5,
      color: LEAD,
      style: STYLE.METAL,
      r: 11.4,
    });
    this.drum(hx - 9, hz + 4, 5.6, hg + 13, 4, 0xc7b18c, STYLE.STONE, {
      mesh: MESH.DOME,
      h: 5,
      color: LEAD,
      style: STYLE.METAL,
    });
    this.block3(hx - 12, hz - 17, 7, 7, hg - 1, hg + 24, 0, 0xc2ab86, STYLE.FLOOD);
    this.sp(MESH.PYRAMID, hx - 12, hg + 24, hz - 17, 7.4, 2, 7.4, 0, 0xc2ab86, STYLE.STONE);
    this.landmark(hx + 9, hz + 2, hg, hg + 28.5, 11.4);
    // The Lutheran Church of the Redeemer's tall tower, the Old City's highest.
    const rg = g(130, 72);
    this.block3(130, 66, 24, 14, rg - 1, rg + 14, 0, 0xdac3a0, STYLE.HOUSE);
    this.block3(130, 76, 8, 8, rg - 1, rg + 40, 0, 0xdac3a0, STYLE.FLOOD);
    this.sp(MESH.PYRAMID, 130, rg + 40, 76, 8.6, 7, 8.6, 0, SLATE, STYLE.METAL);
    this.solidRound(this.bucket(130, 76), 130, 76, 3.2, rg + 40, rg + 47);
    this.landmark(130, 76, rg, rg + 47, 5.7);
    // The Hurva synagogue: a tall white dome on a square hall in the Jewish quarter.
    const ug = g(45, -175);
    this.block3(45, -175, 22, 22, ug - 1, ug + 15, 0, 0xe4d7bc, STYLE.FLOOD);
    this.drum(45, -175, 8.4, ug + 15, 5.5, 0xe8ddc4, STYLE.HOUSE, {
      mesh: MESH.DOME,
      h: 9.5,
      color: PALE,
      style: STYLE.FLOOD,
      r: 8.8,
    });
    this.landmark(45, -175, ug, ug + 30, 11);
    // The Citadel by Jaffa Gate: the Tower of David's great keep, two more towers, and the
    // slender Ottoman minaret that gave it its name.
    const cg = g(332, -100);
    this.block3(348, -76, 16, 16, cg - 4, cg + 24, 0.05, WALL_STONE, STYLE.FLOOD);
    this.block3(350, -134, 12, 12, cg - 4, cg + 19, 0.05, WALL_STONE, STYLE.FLOOD);
    this.block3(318, -142, 12, 12, cg - 4, cg + 17, 0.05, WALL_STONE, STYLE.FLOOD);
    this.block3(334, -108, 30, 52, cg - 4, cg + 10, 0.05, 0xcfb58a, STYLE.FLOOD);
    for (const [tx, tz, ty] of [
      [348, -76, 24],
      [350, -134, 19],
      [318, -142, 17],
    ])
      for (let q = 0; q < 4; q++) {
        const a = 0.05 + (q * Math.PI) / 2;
        const s = tx === 348 ? 6.2 : 4.2;
        this.sp(
          MESH.MERLONS,
          tx + Math.sin(a) * s,
          cg + ty,
          tz + Math.cos(a) * s,
          tx === 348 ? 1.6 : 1.2,
          1,
          1,
          a,
          WALL_STONE,
          STYLE.FLOOD,
        );
      }
    this.minaret(326, -112, cg + 10, 26, false);
    // Minarets and bell towers rising out of the quarters.
    this.minaret(-40, 190, g(-40, 190), 26, false); // Muslim quarter
    this.minaret(-170, 230, g(-170, 230), 24, false);
    this.minaret(150, 220, g(150, 220), 22, true); // Christian quarter (Mosque of Omar)
    this.minaret(20, -120, g(20, -120), 22, false); // Jewish quarter (by the Hurva)
    this.bellTower(210, 140, g(210, 140), 30); // the Latin Patriarchate
    this.bellTower(240, -200, g(240, -200), 26); // St James (Armenian quarter)
    this.bellTower(-60, 120, g(-60, 120), 24);
  }

  /** A minaret: a shaft, a gallery, a slimmer lantern and a cap. Square (Mamluk) or round. */
  private minaret(x: number, z: number, g: number, h: number, square: boolean): void {
    const b = this.bucket(x, z);
    const s = square ? 5 : 4.6;
    const col = square ? 0xd9c29b : 0xe2d2b2;
    this.part(b, square ? MESH.BOX : MESH.CYL, x, g - 1, z, s, h + 1, s, 0, col, STYLE.FLOOD);
    this.part(
      b,
      square ? MESH.BOX : MESH.CYL,
      x,
      g + h - 6,
      z,
      s + 1.8,
      1.1,
      s + 1.8,
      0,
      col,
      STYLE.STONE,
    );
    this.part(
      b,
      square ? MESH.OCT : MESH.CYL,
      x,
      g + h,
      z,
      s * 0.7,
      4.5,
      s * 0.7,
      0,
      col,
      STYLE.HOUSE,
    );
    this.part(
      b,
      square ? MESH.DOME : MESH.CONE,
      x,
      g + h + 4.5,
      z,
      s * 0.8,
      square ? 2.6 : 5,
      s * 0.8,
      0,
      square ? LEAD : SLATE,
      STYLE.METAL,
    );
    this.part(
      b,
      MESH.CYL,
      x,
      g + h + (square ? 7.1 : 9.5),
      z,
      0.25,
      1.6,
      0.25,
      0,
      GOLD,
      STYLE.GOLD,
    );
    if (square) this.solidBox(b, x, z, s / 2 + 0.9, s / 2 + 0.9, 0, g - 1, g + h + 7);
    else this.solidRound(b, x, z, s / 2 + 0.9, g - 1, g + h + 9.5);
    this.landmark(x, z, g, g + h + 9.5, s / 2 + 0.9);
  }

  /** A square bell tower with an open belfry and a pyramid roof. */
  private bellTower(x: number, z: number, g: number, h: number): void {
    const b = this.bucket(x, z);
    this.part(b, MESH.BOX, x, g - 1, z, 6, h + 1, 6, 0, 0xdcc6a1, STYLE.FLOOD);
    this.part(b, MESH.BOX, x, g + h - 7, z, 6.6, 0.8, 6.6, 0, 0xcfb894, STYLE.STONE);
    this.part(b, MESH.PYRAMID, x, g + h, z, 6.6, 4.5, 6.6, 0, SLATE, STYLE.METAL);
    this.part(b, MESH.CYL, x, g + h + 4.5, z, 0.25, 2, 0.25, 0, GOLD, STYLE.GOLD);
    this.solidBox(b, x, z, 3.3, 3.3, 0, g - 1, g + h + 4.5);
    this.landmark(x, z, g, g + h + 6.5, 4.7);
  }

  /** Landmarks outside the walls: Mount Zion, the Mount of Olives, the new city. */
  private buildLandmarks(): void {
    const g = (x: number, z: number) => this.height(x, z);
    // Dormition Abbey on Mount Zion: a round church under a grey cone, corner turrets, a tall
    // bell tower with a spire.
    let x = 185;
    let z = -385;
    let y = g(x, z);
    this.drum(x, z, 14, y - 2, 18, 0xdcc6a3, STYLE.FLOOD, {
      mesh: MESH.CONE,
      h: 8.5,
      color: SLATE,
      style: STYLE.METAL,
      r: 15,
    });
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + (q * Math.PI) / 2;
      const tx = x + Math.sin(a) * 14;
      const tz = z + Math.cos(a) * 14;
      this.drum(tx, tz, 2.5, y - 2, 21, 0xdcc6a3, STYLE.FLOOD, {
        mesh: MESH.CONE,
        h: 4.5,
        color: SLATE,
        style: STYLE.METAL,
        r: 2.9,
      });
    }
    this.drum(x + 19, z + 14, 4, y - 2, 36, 0xdcc6a3, STYLE.FLOOD, {
      mesh: MESH.CONE,
      h: 10,
      color: SLATE,
      style: STYLE.METAL,
      r: 4.4,
    });
    this.landmark(x + 19, z + 14, y, y + 44, 4.4);
    // The Church of Mary Magdalene: white walls under seven golden onion domes.
    x = -520;
    z = 70;
    y = g(x, z);
    this.block3(x, z, 16, 20, y - 2, y + 10, 0, PALE, STYLE.FLOOD);
    this.drum(x, z, 3, y + 10, 7, PALE, STYLE.HOUSE, {
      mesh: MESH.ONION,
      h: 7,
      color: GOLD,
      style: STYLE.GOLD,
      r: 3.6,
    });
    for (const [ox, oz] of [
      [-5.5, -7.5],
      [5.5, -7.5],
      [-5.5, 7.5],
      [5.5, 7.5],
      [0, -8],
      [0, 8],
    ])
      this.drum(x + ox, z + oz, 1.4, y + 10, 3, PALE, STYLE.HOUSE, {
        mesh: MESH.ONION,
        h: 3.6,
        color: GOLD,
        style: STYLE.GOLD,
        r: 1.8,
      });
    this.landmark(x, z, y, y + 24, 12.5);
    // The Church of All Nations in Gethsemane: a row of small domes, a gilded mosaic front.
    x = -462;
    z = -12;
    y = g(x, z);
    this.block3(x, z, 22, 30, y - 2, y + 11, 0, 0xd8c3a0, STYLE.FLOOD);
    this.sp(MESH.BOX, x + 11.1, y + 6, z, 0.4, 5, 26, 0, GOLD, STYLE.GOLD);
    for (let a = 0; a < 3; a++)
      for (let c = 0; c < 4; c++)
        this.sp(
          MESH.DOME,
          x - 6 + a * 6,
          y + 11,
          z - 10.5 + c * 7,
          5,
          2.6,
          5,
          0,
          LEAD,
          STYLE.METAL,
        );
    // Gethsemane's olive grove round it.
    for (let k = 0; k < 70; k++) {
      const tx = x + 6 + (hash2(k, 5, this.seed + 92) - 0.5) * 80;
      const tz = z + (hash2(k, 6, this.seed + 92) - 0.5) * 80;
      if (Math.abs(tx - x) < 16 && Math.abs(tz - z) < 20) continue;
      this.tree(TREE.OLIVE, tx, tz, 0.9 + 0.4 * hash2(k, 7, this.seed));
    }
    // The Russian Church of the Ascension's belfry, the "candle" on the ridge.
    x = -770;
    z = 70;
    y = g(x, z);
    this.block3(x, z, 9, 9, y - 2, y + 28, 0, PALE, STYLE.FLOOD);
    this.block3(x, z, 7, 7, y + 28, y + 42, 0, PALE, STYLE.FLOOD);
    this.block3(x, z, 5, 5, y + 42, y + 52, 0, PALE, STYLE.HOUSE);
    this.sp(MESH.PYRAMID, x, y + 52, z, 5.4, 9, 5.4, 0, 0x5f7f6c, STYLE.METAL);
    this.solidRound(this.bucket(x, z), x, z, 2, y + 52, y + 61);
    this.landmark(x, z, y, y + 61, 6.4);
    // Augusta Victoria: a long hospice and its square tower at the north of the ridge.
    x = -795;
    z = 470;
    y = g(x, z);
    this.block3(x - 18, z, 30, 26, y - 2, y + 16, 0, 0xd2bf9e, STYLE.FLOOD);
    this.block3(x + 16, z, 26, 26, y - 2, y + 14, 0, 0xd2bf9e, STYLE.FLOOD);
    this.block3(x + 4, z - 14, 9, 9, y - 2, y + 50, 0, 0xd2bf9e, STYLE.FLOOD);
    this.sp(MESH.PYRAMID, x + 4, y + 50, z - 14, 9.6, 8, 9.6, 0, SLATE, STYLE.METAL);
    this.solidRound(this.bucket(x + 4, z - 14), x + 4, z - 14, 3.5, y + 50, y + 58);
    this.landmark(x + 4, z - 14, y, y + 58, 6.4);
    // The Jewish cemetery on the Mount of Olives: rows of pale slabs facing the city.
    const T = CEMETERY;
    for (let j = Math.ceil((T.z - T.hz) / 2.1); j < (T.z + T.hz) / 2.1; j++)
      for (let i = Math.ceil((T.x - T.hx) / 3.2); i < (T.x + T.hx) / 3.2; i++) {
        if (hash2(i, j, this.seed + 95) > 0.68) continue;
        const tx = i * 3.2 + (hash2(i, j, this.seed + 96) - 0.5) * 0.6;
        const tz = j * 2.1;
        if (hash2(i, j, this.seed + 97) < smoothstep(0.75, 0.97, this.cemeteryD(tx, tz))) continue;
        this.sp(MESH.BOX, tx, g(tx, tz) - 0.3, tz, 1.9, 0.75, 0.95, 0, PALE, STYLE.PLAIN);
      }
    // The Montefiore windmill above Yemin Moshe.
    x = 540;
    z = -250;
    y = g(x, z);
    this.drum(x, z, 4, y - 1, 12, 0xeae2cf, STYLE.HOUSE, {
      mesh: MESH.DOME,
      h: 3.4,
      color: 0x55595e,
      style: STYLE.METAL,
      r: 4.3,
    });
    this.sp(MESH.SAILS, x - 4.6, y + 12.5, z, 22, 22, 1, Math.PI / 2, 0xd8d3c8, STYLE.PLAIN);
    this.landmark(x, z, y, y + 15.4, 4.6);
    // The grand hotel and the YMCA tower across from it.
    x = 640;
    z = -70;
    y = g(x, z);
    this.block3(x, z - 22, 26, 36, y - 2, y + 22, 0, 0xdcc29c, STYLE.FLATS);
    this.block3(x, z + 22, 26, 36, y - 2, y + 22, 0, 0xdcc29c, STYLE.FLATS);
    this.block3(x, z, 30, 14, y - 2, y + 28, 0, 0xdcc29c, STYLE.FLOOD);
    x = 700;
    z = -150;
    y = g(x, z);
    this.block3(x, z, 30, 20, y - 2, y + 12, 0, 0xd6bf98, STYLE.HOUSE);
    this.block3(x, z + 2, 9, 9, y - 2, y + 46, 0, 0xd6bf98, STYLE.FLOOD);
    this.drum(x, z + 2, 3.6, y + 46, 2.5, 0xd6bf98, STYLE.STONE, {
      mesh: MESH.DOME,
      h: 3.6,
      color: GOLD,
      style: STYLE.GOLD,
      r: 3.8,
    });
    this.landmark(x, z + 2, y, y + 52, 6.4);
  }

  /** Content whose centre lies in block (i, j): the static plan plus the hills' towns and trees. */
  block(i: number, j: number): Block {
    const k = key(i, j);
    let b = this.blocks.get(k);
    if (b) return b;
    if (this.blocks.size > CACHE) {
      this.blocks.clear();
      this.hitCells.clear();
    }
    const st = this.statics.get(k);
    b = {
      parts: st ? st.parts.slice() : [],
      trees: st ? st.trees.slice() : [],
      solids: st ? st.solids.slice() : [],
      landmarks: st ? st.landmarks.slice() : [],
    };
    this.fill(i, j, b);
    this.blocks.set(k, b);
    return b;
  }

  /** Town buildings on 16 m lots, square to the slope, and the block's trees. */
  private fill(i: number, j: number, b: Block): void {
    const s = this.seed;
    const L = 16;
    const n = BLOCK / L;
    let tallDone = false;
    for (let v = 0; v < n; v++)
      for (let u = 0; u < n; u++) {
        const li = i * n + u;
        const lj = j * n + v;
        const x = (li + 0.5) * L + (hash2(li, lj, s + 601) - 0.5) * 3;
        const z = (lj + 0.5) * L + (hash2(li, lj, s + 602) - 0.5) * 3;
        this.at(x, z);
        const town = this.town;
        if (town < 0.35 || hash2(li, lj, s + 603) > 0.25 + town * 0.75) continue;
        const modern = this.modern;
        const red = this.red;
        const g = this.y;
        const room = this.canopyH - 0.6;
        if (room < 3.6) continue;
        // Square to the slope, so rows of houses step down the hillside along the contours.
        const e = 3;
        const gx = this.height(x + e, z) - this.height(x - e, z);
        const gz = this.height(x, z + e) - this.height(x, z - e);
        const yaw =
          Math.abs(gx) + Math.abs(gz) > 0.3
            ? Math.atan2(gx, gz) + (hash2(li, lj, s + 604) - 0.5) * 0.15
            : Math.round(hash2(li, lj, s + 605) * 4) * (Math.PI / 2) +
              (hash2(li, lj, s + 606) - 0.5) * 0.3;
        const r = hash2(li, lj, s + 607);
        const col = pick(STONE, hash2(li, lj, s + 608));
        const kind = modern > 0.55 && r < 0.8 ? 0 : red > 0.5 && r < 0.75 ? 2 : 1;
        const sx = kind === 0 ? 11 + 4 * hash2(li, lj, s + 609) : 7.5 + 3 * hash2(li, lj, s + 609);
        const sz = kind === 0 ? 8 + 3 * hash2(li, lj, s + 610) : 7 + 3 * hash2(li, lj, s + 610);
        const base = this.footing(x, z, sx / 2, sz / 2, yaw) - 0.6;
        const want = kind === 0 ? 4 + Math.floor(hash2(li, lj, s + 611) * 4) * 3 : 3.3 + r * 3.5;
        const roof = g + Math.min(want, room - (kind === 2 ? 2.4 : 0));
        if (roof - base < 3) continue;
        this.part(
          b,
          MESH.BOX,
          x,
          base,
          z,
          sx,
          roof - base,
          sz,
          yaw,
          col,
          kind === 0 ? STYLE.FLATS : STYLE.HOUSE,
          hash2(li, lj, s + 612),
        );
        if (kind === 2) {
          this.part(b, MESH.HIP, x, roof, z, sx + 0.8, 2.3, sz + 0.8, yaw, TILE_RED, STYLE.TILE, r);
        } else if (kind === 0) {
          // Rooftop water heaters, the hills' signature.
          const k = 1 + Math.floor(r * 3);
          for (let q = 0; q < k; q++) {
            const o = (q - (k - 1) / 2) * 3;
            this.part(
              b,
              MESH.SOLAR,
              x + Math.cos(yaw) * o,
              roof,
              z - Math.sin(yaw) * o,
              1,
              1,
              1,
              yaw,
              0xffffff,
              STYLE.PLAIN,
            );
          }
        } else if (r < 0.35) {
          const dr = Math.min(sx, sz) * 0.5;
          this.part(b, MESH.DOME, x, roof, z, dr, dr * 0.42, dr, 0, col, STYLE.STONE);
        } else if (r < 0.6)
          this.part(b, MESH.SOLAR, x, roof, z, 1, 1, 1, yaw, 0xffffff, STYLE.PLAIN);
        // Now and then a minaret or a bell tower over the roofs (solid, and a wisp landmark).
        if (!tallDone && town > 0.8 && hash2(li, lj, s + 613) < 0.035) {
          tallDone = true;
          const tx = x + Math.cos(yaw) * (sx / 2 + 3.5);
          const tz = z - Math.sin(yaw) * (sx / 2 + 3.5);
          this.townTower(b, tx, tz, this.height(tx, tz), red > 0.5 && modern < 0.5, r);
        }
      }
    // Trees on a 9 m grid: olives in the orchards, pines in the forest, cypress and the odd
    // palm in town gardens.
    const T = 9;
    const m = BLOCK / T;
    for (let v = 0; v <= Math.ceil(m); v++)
      for (let u = 0; u <= Math.ceil(m); u++) {
        const ti = Math.floor((i * BLOCK) / T) + u;
        const tj = Math.floor((j * BLOCK) / T) + v;
        const x = (ti + hash2(ti, tj, s + 621)) * T;
        const z = (tj + hash2(ti, tj, s + 622)) * T;
        if (Math.floor(x / BLOCK) !== i || Math.floor(z / BLOCK) !== j) continue;
        this.at(x, z);
        if (this.sd < 20) continue; // the Old City plants its own
        const h = hash2(ti, tj, s + 623);
        let type = -1;
        let sc = 0.7 + 0.6 * hash2(ti, tj, s + 624);
        if (h < this.olive * 0.65) type = TREE.OLIVE;
        else if (h < this.pine * 0.85) type = TREE.PINE;
        else if (this.town > 0.3 && h < 0.07) type = h < 0.012 ? TREE.PALM : TREE.CYPRESS;
        else if (h < 0.012) type = TREE.CYPRESS;
        if (type < 0) continue;
        if (type === TREE.OLIVE) sc *= 0.9;
        b.trees.push(type, x, this.y - 0.3, z, sc, h * 40, hash2(ti, tj, s + 625));
      }
  }

  /** A hill town's minaret or bell tower. */
  private townTower(b: Block, x: number, z: number, g: number, bell: boolean, r: number): void {
    const h = 20 + r * 14;
    const col = 0xddc7a2;
    if (bell) {
      this.part(b, MESH.BOX, x, g - 1, z, 5.5, h + 1, 5.5, 0, col, STYLE.FLOOD);
      this.part(b, MESH.PYRAMID, x, g + h, z, 6, 4, 6, 0, TILE_RED, STYLE.TILE);
      this.solidBox(b, x, z, 3, 3, 0, g - 1, g + h + 4);
      b.landmarks.push({ x, z, y0: g, top: g + h + 4, reach: 4.3 });
    } else {
      this.part(b, MESH.CYL, x, g - 1, z, 3.8, h + 1, 3.8, 0, col, STYLE.FLOOD);
      this.part(b, MESH.CYL, x, g + h - 5, z, 5.4, 1, 5.4, 0, col, STYLE.STONE);
      this.part(b, MESH.CYL, x, g + h, z, 2.6, 3.5, 2.6, 0, col, STYLE.HOUSE);
      this.part(b, MESH.CONE, x, g + h + 3.5, z, 3, 4.5, 3, 0, 0x6f8f83, STYLE.METAL);
      this.solidRound(b, x, z, 2.7, g - 1, g + h + 8);
      b.landmarks.push({ x, z, y0: g, top: g + h + 8, reach: 2.7 });
    }
  }

  // --- Queries (no allocation) -----------------------------------------------------------------

  /** Solids overlapping collision cell (i, j) (gathered from the 3x3 blocks round it). */
  private cell(i: number, j: number): Solid[] {
    const k = key(i, j);
    let list = this.hitCells.get(k);
    if (list) return list;
    list = [];
    const x0 = i * BLOCK;
    const z0 = j * BLOCK;
    for (let v = j - 1; v <= j + 1; v++)
      for (let u = i - 1; u <= i + 1; u++)
        for (const s of this.block(u, v).solids)
          if (
            s.x + s.reach > x0 &&
            s.x - s.reach < x0 + BLOCK &&
            s.z + s.reach > z0 &&
            s.z - s.reach < z0 + BLOCK
          )
            list.push(s);
    this.hitCells.set(k, list);
    return list;
  }

  /** Surface height of a solid at horizontal distance d from a round one's axis. */
  private static roundTop(s: Solid, d: number): number {
    if (s.cap <= 0 || d >= s.hx) return s.y1;
    return s.y1 + s.cap * Math.sqrt(1 - (d / s.hx) ** 2);
  }

  /** Whether (x, y, z) is inside solid s grown by m. */
  private static inside(s: Solid, x: number, y: number, z: number, m: number): boolean {
    if (y < s.y0 - m || y > s.top + m) return false;
    const dx = x - s.x;
    const dz = z - s.z;
    if (s.round) {
      const d = Math.hypot(dx, dz);
      if (d > s.hx + m) return false;
      return y < JerusalemLayout.roundTop(s, Math.max(d - m, 0)) + m;
    }
    return Math.abs(dx * s.c - dz * s.s) < s.hx + m && Math.abs(dx * s.s + dz * s.c) < s.hz + m;
  }

  private qs: Solid | null = null;

  /**
   * Top of the first solid containing the point grown by `margin`, or -Infinity. Its bounds
   * go in `hit` (the city's contract, so the look-ahead and glance are shared).
   */
  solidTop(x: number, y: number, z: number, margin: number): number {
    const i0 = Math.floor((x - margin) / BLOCK);
    const i1 = Math.floor((x + margin) / BLOCK);
    const j0 = Math.floor((z - margin) / BLOCK);
    const j1 = Math.floor((z + margin) / BLOCK);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const list = this.cell(i, j);
        for (let n = 0; n < list.length; n++) {
          const s = list[n];
          if (!JerusalemLayout.inside(s, x, y, z, margin)) continue;
          const H = this.hit;
          H[0] = s.x - s.reach;
          H[1] = s.y0;
          H[2] = s.z - s.reach;
          H[3] = s.x + s.reach;
          H[4] = s.top;
          H[5] = s.z + s.reach;
          this.qs = s;
          return s.top;
        }
      }
    return -Infinity;
  }

  /**
   * Push a point out of solids (grown by margin): through the nearest side of a box, straight
   * out from a round body's axis, or up onto a roof or dome when that is closer. Returns the
   * distance moved; the normal goes in `n`.
   */
  pushPoint(
    p: { x: number; y: number; z: number },
    margin: number,
    n: { x: number; y: number; z: number },
  ): number {
    let total = 0;
    for (let iter = 0; iter < 3; iter++) {
      if (this.solidTop(p.x, p.y, p.z, margin) === -Infinity) break;
      const s = this.qs!;
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      if (s.round) {
        let d = Math.hypot(dx, dz);
        let ux = dx;
        let uz = dz;
        if (d < 1e-3) {
          ux = 1;
          uz = 0;
          d = 1e-3;
        } else {
          ux /= d;
          uz /= d;
        }
        const side = s.hx + margin - d;
        const up = JerusalemLayout.roundTop(s, Math.max(d - margin, 0)) + margin - p.y;
        // Over a dome's shoulder the stone faces the sky: leave upward.
        const crest = s.cap > 0 && p.y > s.y1;
        if (crest || up < side) {
          if (up <= 0) break;
          n.x = n.z = 0;
          n.y = 1;
          p.y += up;
          total += up;
        } else {
          if (side <= 0) break;
          n.y = 0;
          n.x = ux;
          n.z = uz;
          p.x += ux * side;
          p.z += uz * side;
          total += side;
        }
        continue;
      }
      const lx = dx * s.c - dz * s.s;
      const lz = dx * s.s + dz * s.c;
      const east = s.hx + margin - lx;
      const west = s.hx + margin + lx;
      const north = s.hz + margin - lz;
      const south = s.hz + margin + lz;
      const up = s.y1 + margin - p.y;
      const m = Math.min(east, west, north, south, up);
      if (m <= 0) break;
      n.x = n.y = n.z = 0;
      if (m === up) {
        p.y += up;
        n.y = 1;
      } else {
        // Local +x is world (c, -s), local +z is world (s, c).
        const ax = m === east ? 1 : m === west ? -1 : 0;
        const az = m === north ? 1 : m === south ? -1 : 0;
        n.x = ax * s.c + az * s.s;
        n.z = -ax * s.s + az * s.c;
        p.x += n.x * m;
        p.z += n.z * m;
      }
      total += m;
    }
    return total;
  }

  /** Highest solid top within `r` (horizontally) of (x, z); -Infinity if none. */
  skyline(x: number, z: number, r: number): number {
    let best = -Infinity;
    for (let j = Math.floor((z - r) / BLOCK); j <= Math.floor((z + r) / BLOCK); j++)
      for (let i = Math.floor((x - r) / BLOCK); i <= Math.floor((x + r) / BLOCK); i++) {
        const list = this.cell(i, j);
        for (let n = 0; n < list.length; n++) {
          const s = list[n];
          if (s.top <= best) continue;
          const R = s.reach + r;
          if ((x - s.x) ** 2 + (z - s.z) ** 2 < R * R) best = s.top;
        }
      }
    return best;
  }

  /** Highest solid top under (x, z) no higher than y (roofs, domes, wall walks); or -Infinity. */
  roofBelow(x: number, y: number, z: number): number {
    let best = -Infinity;
    const list = this.cell(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
    for (let n = 0; n < list.length; n++) {
      const s = list[n];
      if (s.top > y + 1 || s.top <= best) continue;
      if (JerusalemLayout.inside(s, x, s.y0 + 0.01, z, 0)) best = s.top;
    }
    return best;
  }

  /** The tallest landmark within r of (x, z) at least minH tall, or null. */
  landmarkNear(x: number, z: number, r: number, minH: number): Landmark | null {
    let best: Landmark | null = null;
    for (let j = Math.floor((z - r) / BLOCK); j <= Math.floor((z + r) / BLOCK); j++)
      for (let i = Math.floor((x - r) / BLOCK); i <= Math.floor((x + r) / BLOCK); i++)
        for (const l of this.block(i, j).landmarks) {
          if (l.top - l.y0 < minH || Math.hypot(l.x - x, l.z - z) > r) continue;
          if (!best || l.top - l.y0 > best.top - best.y0) best = l;
        }
    return best;
  }

  /** Clearance check for planning: is the point at least `margin` above the roofs and clear of stone? */
  clear(x: number, y: number, z: number, margin: number): boolean {
    return y > this.ground(x, z) + margin && this.solidTop(x, y, z, margin) === -Infinity;
  }
}
