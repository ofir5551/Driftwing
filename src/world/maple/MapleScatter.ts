import { Config } from '../../core/Config';
import { hash2, mulberry32 } from '../noise';
import { type MapleLayout, type Temple, type Tunnel } from './MapleLayout';
import { lakeBoatRadius, lifePhase } from './materials';
import { CENSER_SMOKE, FARM_HEIGHT, FARM_REACH, FARM_SMOKE, STONE_LANTERN_LIGHT } from './shapes';

/**
 * Maple Valley's scenery per chunk, as plain number lists (pure: no Three.js, unit-tested):
 * the forest (crimson and flame maples, trees still turning, golden ginkgos, dark cedars on the
 * heights), the temples, the gates of every tunnel and its shrine, the bridges, the home lake's
 * gate, pavilion and floating lanterns, farmhouses (eager: they are seen from afar), and the
 * small life of the valley (lazy, within prop distance): boulders, herons, deer and farmers.
 */

/** Tree types in the Trees meshes. */
export const CRIMSON = 0;
export const FLAME = 1;
export const TURNING = 2;
export const GINKGO = 3;
export const CEDAR = 4;

/** Prop kinds (one instanced mesh each, some with a far shape). */
export const K = {
  Pagoda: 0,
  Hall: 1,
  Shrine: 2,
  Gate: 3,
  WaterGate: 4,
  Bridge: 5,
  Pavilion: 6,
  StoneLantern: 7,
  Farmhouse: 8,
  Boulder: 9,
  Heron: 10,
  Deer: 11,
  Farmer: 12,
  Censer: 13,
  Crow: 14,
  LakeBoat: 15,
  RiverBoat: 16,
} as const;
export const KINDS = 17;
/** Floats per smoke source: x, y, z, size. */
export const SMOKE_STRIDE = 4;
/** Floats per prop record: kind, x, y, z, yaw, tilt, sx, sy, sz, tint. */
export const PROP_STRIDE = 10;
/** Floats per lantern light: x, y, z, size. */
export const LANTERN_STRIDE = 4;
/** Floats per floating lantern: centre x, z, drift radius, angular speed, phase, size. */
export const FLOAT_STRIDE = 6;

/** Hanging lanterns at a hall's front corners, and a farmhouse's door (local metres). */
export const HALL_LANTERNS = [
  { x: -6.8, y: 4.6, z: 5.9 },
  { x: 6.8, y: 4.6, z: 5.9 },
];
export const FARM_LANTERN = { x: 1.8, y: 2.9, z: 3.5 };
export const SHRINE_LANTERNS = [
  { x: -3.13, y: 1.61, z: 4.24 },
  { x: 3.13, y: 1.61, z: 4.24 },
];

/** One chunk's Maple Valley scenery. */
export interface MapleChunk {
  ox: number;
  oz: number;
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** Buildings, gates, bridges (PROP_STRIDE records), scattered when the chunk is built. */
  built: number[];
  /** Lantern lights of the built list. */
  lanterns: number[];
  /** Floating lanterns on the water. */
  floats: number[];
  /** Smoke sources (SMOKE_STRIDE): farm roofs and the temples' incense. */
  smoke: number[];
  /** Small life (PROP_STRIDE), scattered the first time the chunk comes within prop distance. */
  props: number[] | null;
}

function push(
  out: number[],
  kind: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx: number,
  sy: number,
  sz: number,
  tint: number,
): void {
  out.push(kind, x, y, z, yaw, 0, sx, sy, sz, tint);
}

/** Push local point l of a thing at (x, y, z) turned by yaw and scaled by s, plus a size. */
export function place(
  out: number[],
  x: number,
  y: number,
  z: number,
  yaw: number,
  l: { x: number; y: number; z: number },
  s: number,
  size: number,
): void {
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  out.push(x + (l.x * c + l.z * n) * s, y + l.y * s, z + (-l.x * n + l.z * c) * s, size);
}

const inside = (x: number, z: number, ox: number, oz: number, size: number) =>
  x >= ox && x < ox + size && z >= oz && z < oz + size;

export class MapleScatter {
  constructor(private readonly L: MapleLayout) {}

  /** The eager part of a chunk. */
  chunk(ox: number, oz: number, size: number): MapleChunk {
    const out: MapleChunk = {
      ox,
      oz,
      trees: [],
      built: [],
      lanterns: [],
      floats: [],
      smoke: [],
      props: null,
    };
    const L = this.L;
    const K = Config.maple;
    const TC = K.templeCell;
    for (let j = Math.floor((oz - 40) / TC); j <= Math.floor((oz + size + 40) / TC); j++)
      for (let i = Math.floor((ox - 40) / TC); i <= Math.floor((ox + size + 40) / TC); i++) {
        const t = L.temple(i, j);
        if (t) this.temple(t, ox, oz, size, out);
      }
    if (L.home) this.temple(L.home, ox, oz, size, out);
    const GC = K.gateCell;
    for (let j = Math.floor(oz / GC); j <= Math.floor((oz + size) / GC); j++)
      for (let i = Math.floor(ox / GC); i <= Math.floor((ox + size) / GC); i++) {
        const t = L.tunnel(i, j);
        if (t) this.tunnel(t, ox, oz, size, out);
      }
    this.lake(ox, oz, size, out);
    this.boats(ox, oz, size, out.built);
    this.bridges(ox, oz, size, out.built);
    this.farms(ox, oz, size, out);
    this.forest(ox, oz, size, out.trees);
    return out;
  }

  /** A temple: hall, pagoda, a lantern-lined approach toward the water, ginkgos either side. */
  private temple(t: Temple, ox: number, oz: number, size: number, out: MapleChunk): void {
    const y = t.y;
    if (inside(t.x, t.z, ox, oz, size)) {
      push(out.built, K.Hall, t.x, y - 0.3, t.z, t.yaw, 1, 1, 1, t.seed);
      for (const l of HALL_LANTERNS) place(out.lanterns, t.x, y - 0.3, t.z, t.yaw, l, 1, 0.9);
      for (const s of [-1, 1])
        for (let k = 0; k < 3; k++) {
          const l = { x: s * 4.2, y: 0, z: 13 + k * 6 };
          const p: number[] = [];
          place(p, t.x, y - 0.1, t.z, t.yaw, l, 1, 0);
          push(out.built, K.StoneLantern, p[0], y - 0.1, p[2], t.yaw, 1, 1, 1, t.seed);
          out.lanterns.push(p[0], y - 0.1 + STONE_LANTERN_LIGHT.y, p[2], 0.55);
        }
      // The incense burner on the approach, its smoke rising.
      const cz: number[] = [];
      place(cz, t.x, y - 0.1, t.z, t.yaw, { x: 0, y: 0, z: 10 }, 1, 0);
      push(out.built, K.Censer, cz[0], y - 0.1, cz[2], t.yaw, 1, 1, 1, t.seed);
      out.smoke.push(cz[0], y - 0.1 + CENSER_SMOKE.y, cz[2], 0.9);
      // Ginkgos either side of the hall, gold against the dark roofs.
      for (const s of [-1, 1]) {
        const c = Math.cos(t.yaw);
        const n = Math.sin(t.yaw);
        const lx = s * 15;
        const lz = -4;
        out.trees.push(
          GINKGO,
          t.x + lx * c + lz * n,
          y - 0.3,
          t.z - lx * n + lz * c,
          1.25,
          s * 2,
          t.seed,
        );
      }
    }
    if (inside(t.px, t.pz, ox, oz, size)) {
      push(out.built, K.Pagoda, t.px, y - 0.3, t.pz, t.yaw, 1, 1, 1, t.seed);
      // Crows wheeling round the pagoda's upper storeys: each circles its own origin a few
      // metres off the axis (so each gets its own phase, radius and way round).
      const rand = mulberry32(Math.floor(t.seed * 1e9) + 3);
      for (let k = 0; k < Config.maple.crows; k++) {
        const x = t.px + (rand() - 0.5) * 8;
        const z = t.pz + (rand() - 0.5) * 8;
        push(out.built, K.Crow, x, t.top - 4 - rand() * 10, z, 0, 1.7, 1.7, 1.7, rand());
      }
    }
  }

  /** A tunnel's gates (a stone lantern beside every fifth) and its shrine at the top. */
  private tunnel(t: Tunnel, ox: number, oz: number, size: number, out: MapleChunk): void {
    const G = t.gates;
    const KM = Config.maple;
    for (let k = 0; k < t.n; k++) {
      const x = G[k * 4];
      const z = G[k * 4 + 2];
      if (!inside(x, z, ox, oz, size)) continue;
      const y = G[k * 4 + 1];
      const yaw = G[k * 4 + 3];
      // The gate spans across the path: its local x is the path's side.
      push(out.built, K.Gate, x, y - 0.2, z, yaw, 1, 1, 1, (k * 0.37 + t.seed) % 1);
      if (k % 5 === 2) {
        const s = k % 10 === 2 ? 1 : -1;
        const lx = s * (KM.gateHalf + 1.6);
        const c = Math.cos(yaw);
        const n = Math.sin(yaw);
        const px = x + lx * c;
        const pz = z - lx * n;
        push(out.built, K.StoneLantern, px, y - 0.1, pz, yaw, 0.9, 0.9, 0.9, t.seed);
        out.lanterns.push(px, y - 0.1 + STONE_LANTERN_LIGHT.y * 0.9, pz, 0.5);
      }
    }
    if (inside(t.sx, t.sz, ox, oz, size)) {
      // The shrine faces back down the way up.
      const yaw = t.syaw + Math.PI;
      push(out.built, K.Shrine, t.sx, t.sy - 0.2, t.sz, yaw, 1, 1, 1, t.seed);
      for (const l of SHRINE_LANTERNS) place(out.lanterns, t.sx, t.sy - 0.2, t.sz, yaw, l, 1, 0.5);
    }
  }

  /**
   * The home lake: its gate in the water, the pavilion on the island, stone lanterns round the
   * shore path, and the floating lanterns drifting on the water.
   */
  private lake(ox: number, oz: number, size: number, out: MapleChunk): void {
    const L = this.L;
    const G = L.gate;
    if (inside(G.x, G.z, ox, oz, size))
      push(out.built, K.WaterGate, G.x, -1.5, G.z, G.yaw, 1, 1, 1, 0.5);
    const P = L.pavilion;
    if (inside(P.x, P.z, ox, oz, size)) {
      push(out.built, K.Pavilion, P.x, P.y - 0.3, P.z, P.yaw, 1, 1, 1, 0.5);
      // Maples and a cedar round the pavilion, leaving its front (and its deck) open.
      const ring = [
        [2.2, 18, CRIMSON, 1.25],
        [2.9, 19, FLAME, 1.1],
        [3.6, 17, CRIMSON, 1.35],
        [4.2, 19, CEDAR, 0.9],
        [-2.3, 18, FLAME, 1.2],
        [-3.1, 18, CRIMSON, 1.15],
      ];
      for (const [a, r, type, sc] of ring)
        out.trees.push(
          type,
          P.x + Math.sin(P.yaw + a) * r,
          P.y - 0.3,
          P.z + Math.cos(P.yaw + a) * r,
          sc,
          a * 3,
          0.5,
        );
      for (const s of [-1, 1]) {
        const l = { x: s * 3.2, y: 0, z: 14 };
        const p: number[] = [];
        place(p, P.x, P.y, P.z, P.yaw, l, 1, 0);
        out.lanterns.push(p[0], 1.6, p[2], 0.6);
      }
    }
    const Lk = L.lake;
    if (Lk.r <= 0) return;
    // Stone lanterns round the shore path, every ~30 m.
    const R = Lk.r;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      // Walk out from the centre to the shore path along this angle.
      let lo = 0;
      let hi = R * 2.2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        if (L.lakeEdge(Lk.x + dx * mid, Lk.z + dz * mid) < 9.5) lo = mid;
        else hi = mid;
      }
      const x = Lk.x + dx * lo;
      const z = Lk.z + dz * lo;
      if (!inside(x, z, ox, oz, size)) continue;
      if (L.river(x, z) < 12 || L.nearOpening(x, z, 30)) continue;
      const y = L.height(x, z);
      if (y < 0.8) continue;
      push(out.built, K.StoneLantern, x, y - 0.1, z, a, 1, 1, 1, k / 64);
      out.lanterns.push(x, y - 0.1 + STONE_LANTERN_LIGHT.y, z, 0.55);
    }
    // Floating lanterns: a seeded scatter over the lake, clear of the island and the gate.
    const rand = mulberry32(L.seed * 31 + 7);
    const I = L.island;
    for (let k = 0, n = 0; k < 900 && n < Config.maple.lakeLanterns; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * R * 1.3;
      const x = Lk.x + Math.sin(a) * d;
      const z = Lk.z + Math.cos(a) * d;
      const r = 2 + rand() * 5;
      const sp = (0.02 + rand() * 0.05) * (rand() < 0.5 ? 1 : -1);
      const ph = rand() * Math.PI * 2;
      const s = 0.85 + rand() * 0.35;
      if (L.lakeEdge(x, z) > -10 - r) continue;
      if (Math.hypot(x - I.x, z - I.z) < I.r + 10 + r) continue;
      if (Math.hypot(x - G.x, z - G.z) < 20 + r) continue;
      n++;
      if (inside(x, z, ox, oz, size)) out.floats.push(x, z, r, sp, ph, s);
    }
    // Boats poled round slow circles on the lake: the whole circle (its radius is the
    // shader's, from where the boat is placed) on open water, clear of the island and the gate.
    const brand = mulberry32(L.seed * 17 + 3);
    for (let k = 0, n = 0; k < 600 && n < Config.maple.lakeBoats; k++) {
      const a = brand() * Math.PI * 2;
      const d = Math.sqrt(brand()) * R * 1.1;
      const x = Lk.x + Math.sin(a) * d;
      const z = Lk.z + Math.cos(a) * d;
      if (!this.lakeCircle(x, z, lakeBoatRadius(lifePhase(x, z)))) continue;
      n++;
      if (inside(x, z, ox, oz, size)) push(out.built, K.LakeBoat, x, 0, z, 0, 1, 1, 1, brand());
    }
  }

  /** Is the circle of radius r round (x, z) all on the lake's open water, clear of the gate? */
  lakeCircle(x: number, z: number, r: number): boolean {
    const L = this.L;
    const I = L.island;
    const G = L.gate;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (L.lakeEdge(px, pz) > -7) return false;
      if (Math.hypot(px - I.x, pz - I.z) < I.r + 8) return false;
      if (Math.hypot(px - G.x, pz - G.z) < 20) return false;
    }
    return true;
  }

  /**
   * Boats poled up and down straight reaches of the river: one per 200 m cell now and then,
   * where the river runs wide and straight enough for the whole reach to be on the water, away
   * from the bridges, the lake and the opening.
   */
  private boats(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 200;
    const reach = Config.maple.boatReach + 4;
    const c = { x: 0, z: 0 };
    for (let j = Math.floor(oz / cell); j <= Math.floor((oz + size) / cell); j++)
      for (let i = Math.floor(ox / cell); i <= Math.floor((ox + size) / cell); i++) {
        if (hash2(i + 7, j - 5, seed + 80) > Config.maple.riverBoats) continue;
        let x = (i + 0.5) * cell;
        let z = (j + 0.5) * cell;
        for (let it = 0; it < 6; it++) {
          L.toCentre(x, z, c);
          x += Math.max(-60, Math.min(60, c.x - x));
          z += Math.max(-60, Math.min(60, c.z - z));
        }
        if (Math.floor(x / cell) !== i || Math.floor(z / cell) !== j) continue;
        if (!inside(x, z, ox, oz, size)) continue;
        if (L.river(x, z) > -L.rw * 0.6 || L.lakeEdge(x, z) < 40 || L.nearOpening(x, z, 80))
          continue;
        const yaw = L.riverHeading(x, z, hash2(i, j, seed + 81) * 7);
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        let ok = true;
        for (let f = -1; f <= 1 && ok; f += 0.25)
          if (L.river(x + fx * reach * f, z + fz * reach * f) > -4) ok = false;
        const b = L.bridgeNear(x, z);
        if (b && Math.hypot(b.x - x, b.z - z) < reach + b.width + 20) ok = false;
        if (ok) push(out, K.RiverBoat, x, 0, z, yaw, 1, 1, 1, hash2(i, j, seed + 82));
      }
  }

  /** Arched bridges whose centre lies in the chunk (one instance each, scaled to its span). */
  private bridges(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const C = Config.maple.bridgeCell;
    for (let j = Math.floor(oz / C) - 1; j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C) - 1; i <= Math.floor((ox + size) / C); i++) {
        const b = L.bridgeIn(i, j);
        if (!b || !inside(b.x, b.z, ox, oz, size)) continue;
        push(
          out,
          K.Bridge,
          b.x,
          b.ends,
          b.z,
          Math.atan2(-b.uz, b.ux),
          b.half,
          b.crown - b.ends,
          b.width,
          0.5,
        );
      }
  }

  /**
   * Farmhouses on the valley floor's farmland, square to the river, off the roads, every roof
   * under the farmland's soft floor; a lantern by each door, a persimmon-gold ginkgo or a maple
   * on the odd empty plot.
   */
  private farms(ox: number, oz: number, size: number, out: MapleChunk): void {
    const L = this.L;
    const seed = L.seed;
    const hc = 18;
    for (let j = Math.ceil(oz / hc); j < Math.ceil((oz + size) / hc); j++)
      for (let i = Math.ceil(ox / hc); i < Math.ceil((ox + size) / hc); i++) {
        const x = (i + 0.3 + hash2(i, j, seed + 61) * 0.4) * hc;
        const z = (j + 0.3 + hash2(i, j, seed + 62) * 0.4) * hc;
        L.land(x, z);
        const v = L.lVillage;
        if (v < 0.5) continue;
        if (L.lPath < Config.maple.roadWidth + 6 || L.lPad > 0) continue;
        if (L.bridgeTop(x, z) !== -Infinity) continue;
        const roll = hash2(i, j, seed + 63);
        const y = L.height(x, z);
        if (roll > 0.55) {
          if (roll > 0.9)
            out.trees.push(
              roll > 0.95 ? GINKGO : CRIMSON,
              x,
              y - 0.3,
              z,
              1.3,
              roll * 40,
              hash2(i, j, seed + 64),
            );
          continue;
        }
        const yaw =
          L.riverHeading(x, z, 0) +
          (hash2(i, j, seed + 65) < 0.5 ? 0 : Math.PI / 2) +
          (hash2(i, j, seed + 66) - 0.5) * 0.15;
        const s = 0.9 + hash2(i, j, seed + 67) * 0.2;
        if (FARM_HEIGHT * s > this.roofRoom(x, y, z, yaw, FARM_REACH * s * 0.75)) continue;
        push(out.built, K.Farmhouse, x, y - 0.2, z, yaw, s, s, s, hash2(i, j, seed + 68));
        place(out.lanterns, x, y - 0.2, z, yaw, FARM_LANTERN, s, 0.7);
        // Smoke from the hearth, out under the ridge (not every house has its fire lit).
        if (hash2(i, j, seed + 69) < 0.6) place(out.smoke, x, y - 0.2, z, yaw, FARM_SMOKE, s, 1.2);
        // Now and then a few crows over the farm.
        if (hash2(i, j, seed + 70) < 0.12)
          for (let k = 0; k < 3; k++)
            push(
              out.built,
              K.Crow,
              x + k * 2.3,
              y + 24 + k * 2,
              z - k * 1.7,
              0,
              1.7,
              1.7,
              1.7,
              k / 3,
            );
      }
  }

  /** Least height of the soft floor over a footprint's centre and corners, above y (m). */
  private roofRoom(x: number, y: number, z: number, yaw: number, r: number): number {
    const L = this.L;
    const c = Math.cos(yaw) * r;
    const n = Math.sin(yaw) * r;
    let room = L.height(x, z) + L.canopy(x, z);
    for (let k = 0; k < 4; k++) {
      const dx = k & 1 ? 1 : -1;
      const dz = k & 2 ? 1 : -1;
      const px = x + dx * c + dz * n;
      const pz = z - dx * n + dz * c;
      room = Math.min(room, L.height(px, pz) + L.canopy(px, pz));
    }
    return room - y - 0.3;
  }

  /**
   * The forest on a jittered 11 m grid, as dense as the land's forest share, with a stray tree
   * in the meadows: cedars where the layout says (the heights, the odd grove), the odd ginkgo,
   * and maples whose colour follows the autumn's turn (crimson hillsides, flame and gold ones,
   * a few still green-gold). Off the roads, paths, pads and roofs.
   */
  private forest(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 11;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        L.land(x, z);
        const f = L.lForest;
        if (hash2(i, j, seed) > f * 0.92 + 0.02) continue;
        if (L.lWater < 4 || L.lPath < 9 || L.lPad > 0.1 || L.lVillage > 0.4) continue;
        const y = L.height(x, z);
        if (y < 0.6) continue;
        if (L.roofAt(x, z) !== -Infinity) continue;
        const r = hash2(i, j, seed + 13);
        const t = L.lTurn;
        let type: number;
        if (r < L.lCedar) type = CEDAR;
        else if (r > 0.95) type = GINKGO;
        else {
          const q = hash2(i, j, seed + 17);
          type = q < 0.7 - 0.45 * t ? CRIMSON : q < 0.93 - 0.05 * t ? FLAME : TURNING;
        }
        const k = hash2(i, j, seed + 14);
        const s =
          type === CEDAR ? 0.75 + k * 0.3 : type === GINKGO ? 0.9 + k * 0.35 : 0.9 + k * 0.55;
        out.push(
          type,
          x,
          y - 0.3,
          z,
          s,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
  }

  /** The lazy part: boulders, herons, deer and farmers. */
  props(c: MapleChunk, size: number): void {
    const out: number[] = [];
    const L = this.L;
    const seed = L.seed;
    const cell = 20;
    const life = Config.maple.life;
    for (let j = Math.ceil(c.oz / cell); j < Math.ceil((c.oz + size) / cell); j++)
      for (let i = Math.ceil(c.ox / cell); i < Math.ceil((c.ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 71)) * cell;
        const z = (j + hash2(i, j, seed + 72)) * cell;
        const roll = hash2(i, j, seed + 73);
        const yaw = hash2(i, j, seed + 74) * Math.PI * 2;
        const tint = hash2(i, j, seed + 75);
        L.land(x, z);
        const w = L.lWater;
        if (w > -4 && w < -0.8) {
          // A heron fishing in the shallows.
          if (roll < life * 0.4 && L.bridgeTop(x, z) === -Infinity && !L.nearOpening(x, z, 20))
            push(out, K.Heron, x, -0.55, z, yaw, 1, 1, 1, tint);
          continue;
        }
        if (w < 2 || L.lPath < 3 || L.lPad > 0.1) continue;
        const y = L.height(x, z);
        if (L.lForest > 0.4) {
          // Mossy boulders on the forest floor, more on the slopes.
          if (roll < 0.12 + 0.25 * L.lRise) {
            const s = 0.8 + hash2(i, j, seed + 76) * 1.6;
            push(out, K.Boulder, x, y - 0.2 * s, z, yaw, s, s * 0.8, s, tint);
          } else if (roll > 1 - life * 0.25 && L.lForest < 0.7)
            push(out, K.Deer, x, y, z, yaw, 1, 1, 1, tint); // at the forest's edge
          continue;
        }
        if (L.lVillage > 0.3) {
          if (roll < life * 0.5) push(out, K.Farmer, x, y, z, yaw, 1, 1, 1, tint);
        } else if (roll < life * 0.3) push(out, K.Deer, x, y, z, yaw, 1, 1, 1, tint);
      }
    c.props = out;
  }
}
