import { Config } from '../../core/Config';
import { hash2, mulberry32 } from '../noise';
import { FLOODED, paddyKind, profile, SHAPES, type KarstLayout, type Pillar } from './KarstLayout';
import { SKINS } from './skin';

/**
 * Jade River's scenery per chunk, as plain number lists (pure: no Three.js, unit-tested): trees
 * on the valley floor and on the rock, the villages, bridges, boats and summit buildings (eager:
 * they are seen from afar), and the small things of a lived-in valley (lazy, within prop
 * distance): scree boulders at the pillars' feet, vines hanging from their ledges, water
 * buffalo in the paddies and the shallows, farmers in conical hats.
 */

/** Tree types in the shared Trees meshes. */
export const ROUND = 0;
export const BAMBOO = 1;
export const PINE = 2;

/** Prop kinds (one instanced mesh each, some with a far shape). */
export const K = {
  House: 0,
  House2: 1,
  Hall: 2,
  Pavilion: 3,
  Pagoda: 4,
  Bridge: 5,
  Raft: 6,
  Sampan: 7,
  Boulder: 8,
  Buffalo: 9,
  Farmer: 10,
} as const;
export const KINDS = 11;
/** Floats per prop record: kind, x, y, z, yaw, tilt, sx, sy, sz, tint. */
export const PROP_STRIDE = 10;
/** Floats per vine: top x, y, z, then the instance basis: across, down-to-top, outward. */
export const VINE_STRIDE = 12;
/** Floats per lantern: x, y, z, size. */
export const LANTERN_STRIDE = 4;

/** Height of each building at scale 1 (m), so the scatter keeps roofs under the flight floor. */
export const BUILT_HEIGHT = [6.9, 9.7, 10.6];
/** Half the footprint's diagonal at scale 1 (m): keeps buildings apart and off the paths. */
export const BUILT_REACH = [5.2, 5.2, 7.6];

/** Where things sit on the shapes, in their local metres. */
export const RAFT_LANTERN = { x: 0, y: 2.75, z: -3.7 };
export const HOUSE_LANTERN = { x: 1.3, y: 2.6, z: 3.45 };
export const HALL_LANTERNS = [
  { x: -2.4, y: 3.4, z: 4.6 },
  { x: 2.4, y: 3.4, z: 4.6 },
];
export const PAVILION_LANTERNS = [
  { x: -2.6, y: 3.6, z: 2.6 },
  { x: 2.6, y: 3.6, z: 2.6 },
];
/** Lanterns hung from the pagoda's lowest eaves (local metres). */
export const PAGODA_LANTERNS = [
  { x: 4.3, y: 3.9, z: 0 },
  { x: -4.3, y: 3.9, z: 0 },
  { x: 0, y: 3.9, z: 4.3 },
  { x: 0, y: 3.9, z: -4.3 },
];
export const SAMPAN_LANTERN = { x: 0, y: 1.9, z: -2.6 };

/** One chunk's Jade River scenery. */
export interface KarstChunk {
  ox: number;
  oz: number;
  pillars: Pillar[];
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** Buildings, bridges and boats (PROP_STRIDE records), scattered when the chunk is built. */
  built: number[];
  /** Lanterns of the built list. */
  lanterns: number[];
  /** Small scenery (PROP_STRIDE), scattered the first time the chunk comes within prop distance. */
  props: number[] | null;
  /** Vines (VINE_STRIDE), with the props. */
  vines: number[] | null;
}

function push(
  out: number[],
  kind: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  tilt: number,
  sx: number,
  sy: number,
  sz: number,
  tint: number,
): void {
  out.push(kind, x, y, z, yaw, tilt, sx, sy, sz, tint);
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

export class KarstScatter {
  constructor(private readonly L: KarstLayout) {}

  /** The eager part of a chunk: pillars and their dressing, trees, buildings, bridges, boats. */
  chunk(ox: number, oz: number, size: number): KarstChunk {
    const out: KarstChunk = {
      ox,
      oz,
      pillars: [],
      trees: [],
      built: [],
      lanterns: [],
      props: null,
      vines: null,
    };
    const L = this.L;
    const C = Config.karst.pillarCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++)
        for (const pl of L.cell(i, j)) {
          if (pl.x < ox || pl.x >= ox + size || pl.z < oz || pl.z >= oz + size) continue;
          out.pillars.push(pl);
          this.dress(pl, out);
        }
    this.houses(ox, oz, size, out);
    this.valleyTrees(ox, oz, size, out.trees);
    this.water(ox, oz, size, out);
    this.bridges(ox, oz, size, out.built);
    return out;
  }

  /** A pillar's pines on the crown, shrubs on the walls, and maybe a pavilion or a pagoda. */
  private dress(pl: Pillar, out: KarstChunk): void {
    const sh = SHAPES[pl.shape];
    const skin = SKINS[pl.shape];
    const rand = mulberry32(Math.floor(pl.seed * 1e9));
    const at = (t: number, a: number, inset: number, type: number, s: number) => {
      // Local lathe angle of world angle a: the instance turns the mesh by the pillar's yaw.
      const r = pl.r * skin.radius(t, a + pl.yaw) * inset;
      out.trees.push(
        type,
        pl.x + pl.lx * t * t + Math.cos(a) * r,
        pl.y0 + t * pl.h - 0.4,
        pl.z + pl.lz * t * t + Math.sin(a) * r,
        s,
        rand() * Math.PI * 2,
        rand(),
      );
    };
    // A summit building keeps the very top clear for itself.
    const span = pl.pavilion || pl.pagoda ? 0.6 : 0.92;
    const pines = 3 + Math.floor(pl.r / 9);
    for (let k = 0; k < pines; k++)
      at(
        sh.cap + (1 - sh.cap) * span * rand(),
        rand() * Math.PI * 2,
        0.9,
        PINE,
        0.7 + rand() * 0.7,
      );
    // Shrubs clinging to the walls, set into the rock so they never float off the flutes.
    const shrubs = Math.floor(pl.h / 32);
    for (let k = 0; k < shrubs; k++)
      at(0.15 + (sh.cap - 0.2) * rand(), rand() * Math.PI * 2, 0.93, ROUND, 0.45 + rand() * 0.35);
    if (pl.pavilion || pl.pagoda) {
      const t = 0.975;
      const x = pl.x + pl.lx * t * t;
      const y = pl.y0 + pl.h * t - 0.5;
      const z = pl.z + pl.lz * t * t;
      if (pl.pavilion) {
        push(out.built, K.Pavilion, x, y, z, pl.yaw, 0, 1, 1, 1, pl.seed);
        for (const l of PAVILION_LANTERNS) place(out.lanterns, x, y, z, pl.yaw, l, 1, 1.2);
      } else {
        push(out.built, K.Pagoda, x, y, z, pl.yaw, 0, 1, 1, 1, pl.seed);
        for (const l of PAGODA_LANTERNS) place(out.lanterns, x, y, z, pl.yaw, l, 1, 0.9);
      }
    }
  }

  /** Bamboo along the banks, broadleaf groves inland, the odd tree in the fields; off the paths. */
  private valleyTrees(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 9;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const g = L.grove(x, z); // leaves the river scratch
        if (hash2(i, j, seed) > g * 0.85 + 0.01) continue;
        const bank = L.rd - L.rw;
        if (L.village(x, z) > 0.3) continue;
        const y = L.height(x, z);
        if (y < 0.6) continue;
        if (L.pathDist(x, z) < Config.karst.pathWidth + 2) continue;
        // Not on a paddy tread (the odd tree stands on the riser or a bund).
        if (L.base(x, z) > 0 && L.pw > 0.5) continue;
        const bamboo = bank < 30 || hash2(i, j, seed + 13) < 0.25;
        const s = bamboo ? 0.8 + hash2(i, j, seed + 14) * 0.5 : 0.7 + hash2(i, j, seed + 14) * 0.7;
        out.push(
          bamboo ? BAMBOO : ROUND,
          x,
          y - 0.3,
          z,
          s,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
  }

  /**
   * Villages: whitewashed houses square to the river (one or two storeys, now and then a hall
   * with a double roof), off the paths and the scree, every roof under the village's flight
   * floor; a lantern by every door; a great shade tree on the odd empty plot.
   */
  private houses(ox: number, oz: number, size: number, out: KarstChunk): void {
    const L = this.L;
    const seed = L.seed;
    const hc = 14;
    for (let j = Math.ceil(oz / hc); j < Math.ceil((oz + size) / hc); j++)
      for (let i = Math.ceil(ox / hc); i < Math.ceil((ox + size) / hc); i++) {
        const x = (i + 0.35 + hash2(i, j, seed + 21) * 0.3) * hc;
        const z = (j + 0.35 + hash2(i, j, seed + 22) * 0.3) * hc;
        L.river(x, z);
        const v = L.village(x, z);
        if (v < 0.45) continue;
        const roll = hash2(i, j, seed + 23);
        const y = L.height(x, z);
        if (y - L.base(x, z) > 0.3) continue; // on a pillar's scree
        if (L.pathDist(x, z) < Config.karst.pathWidth + 4.5) continue;
        if (L.bridgeTop(x, z) !== -Infinity) continue;
        if (roll > 0.72) {
          // An empty plot: now and then the village's great camphor tree.
          if (roll > 0.94 && v > 0.6)
            out.trees.push(ROUND, x, y - 0.3, z, 1.7, roll * 40, hash2(i, j, seed + 28));
          continue;
        }
        const yaw =
          L.riverHeading(x, z, 0) +
          (hash2(i, j, seed + 24) < 0.5 ? 0 : Math.PI / 2) +
          (hash2(i, j, seed + 25) - 0.5) * 0.12;
        const s = 0.9 + hash2(i, j, seed + 26) * 0.2;
        const pick = hash2(i, j, seed + 27);
        let kind: number = pick < 0.05 && v > 0.75 ? K.Hall : pick < 0.4 ? K.House2 : K.House;
        // Every roof under the village's soft ground (its flight floor), corners too.
        if (BUILT_HEIGHT[kind] * s > this.roofRoom(x, y, z, yaw, BUILT_REACH[kind] * s * 0.75))
          kind = K.House;
        if (BUILT_HEIGHT[kind] * s > this.roofRoom(x, y, z, yaw, BUILT_REACH[kind] * s * 0.75))
          continue;
        push(out.built, kind, x, y - 0.2, z, yaw, 0, s, s, s, hash2(i, j, seed + 29));
        if (kind === K.Hall)
          for (const l of HALL_LANTERNS) place(out.lanterns, x, y - 0.2, z, yaw, l, s, 1);
        else place(out.lanterns, x, y - 0.2, z, yaw, HOUSE_LANTERN, s, 0.9);
      }
  }

  /** Least height of the flight floor over a footprint's centre and corners, above y (m). */
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

  /** Cormorant fishers' rafts out on the water, and sampans moored off the villages. */
  private water(ox: number, oz: number, size: number, out: KarstChunk): void {
    const L = this.L;
    const seed = L.seed;
    const rc = 64;
    for (let j = Math.ceil(oz / rc); j < Math.ceil((oz + size) / rc); j++)
      for (let i = Math.ceil(ox / rc); i < Math.ceil((ox + size) / rc); i++) {
        const x = (i + hash2(i, j, seed + 31)) * rc;
        const z = (j + hash2(i, j, seed + 32)) * rc;
        if (hash2(i, j, seed + 33) > 0.5) continue;
        const bank = L.river(x, z);
        if (bank > -L.rw * 0.35) continue;
        if (Math.hypot(x - L.spawn.x, z - L.spawn.z) < 60) continue;
        if (L.bridgeTop(x, z) !== -Infinity) continue;
        const yaw = L.riverHeading(x, z, hash2(i, j, seed + 34) * 7);
        push(out.built, K.Raft, x, 0, z, yaw, 0, 1, 1, 1, hash2(i, j, seed + 35));
        place(out.lanterns, x, 0, z, yaw, RAFT_LANTERN, 1, 0.9);
      }
    const sc = 26;
    for (let j = Math.ceil(oz / sc); j < Math.ceil((oz + size) / sc); j++)
      for (let i = Math.ceil(ox / sc); i < Math.ceil((ox + size) / sc); i++) {
        if (hash2(i, j, seed + 36) > 0.5) continue;
        const x = (i + hash2(i, j, seed + 37)) * sc;
        const z = (j + hash2(i, j, seed + 38)) * sc;
        const bank = L.river(x, z);
        if (bank > -3 || bank < -9) continue;
        // Moored off a village: look 30 m inland (up the river noise's slope, away from the water).
        const g = Math.hypot(L.rgx, L.rgz) || 1;
        const sgn = L.rv >= 0 ? 1 : -1;
        const ix = x + (L.rgx / g) * sgn * (30 - bank);
        const iz = z + (L.rgz / g) * sgn * (30 - bank);
        const yaw = L.riverHeading(x, z, hash2(i, j, seed + 39) * 7);
        L.river(ix, iz);
        if (L.village(ix, iz) < 0.4) continue;
        if (L.bridgeTop(x, z) !== -Infinity) continue;
        push(out.built, K.Sampan, x, 0, z, yaw, 0, 1, 1, 1, hash2(i, j, seed + 40));
        place(out.lanterns, x, 0, z, yaw, SAMPAN_LANTERN, 1, 0.7);
      }
  }

  /** Stone bridges whose centre lies in the chunk (one instance each, scaled to its span). */
  private bridges(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const C = Config.karst.bridgeCell;
    for (let j = Math.floor(oz / C) - 1; j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C) - 1; i <= Math.floor((ox + size) / C); i++) {
        const b = L.bridgeIn(i, j);
        if (!b || b.x < ox || b.x >= ox + size || b.z < oz || b.z >= oz + size) continue;
        // The unit shape spans local x from -1 to 1, its deck from 0 at the ends to 1 at the
        // crown: placed at the end height, scaled to the span, the hump and the width.
        push(
          out,
          K.Bridge,
          b.x,
          b.ends,
          b.z,
          Math.atan2(-b.uz, b.ux),
          0,
          b.half,
          b.crown - b.ends,
          b.width,
          0.5,
        );
      }
  }

  /** The lazy part: boulders, buffalo, farmers and vines. */
  props(c: KarstChunk, size: number): void {
    const props: number[] = [];
    const vines: number[] = [];
    for (const pl of c.pillars) this.pillarFoot(pl, props, vines);
    this.life(c.ox, c.oz, size, props);
    c.props = props;
    c.vines = vines;
  }

  /** Mossy boulders tumbled on a pillar's scree, and vines hanging from its ledges. */
  private pillarFoot(pl: Pillar, props: number[], vines: number[]): void {
    const L = this.L;
    const rand = mulberry32(Math.floor(pl.seed * 1e9) + 7);
    const n = Math.round((6 + pl.r / 3) * Config.karst.boulders);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      // Fallen from the walls: bigger and thicker near the foot, smaller out on the scree.
      const f = rand() * rand();
      const d = pl.r * (1.12 + f * 0.7);
      const x = pl.x + Math.cos(a) * d;
      const z = pl.z + Math.sin(a) * d;
      if (L.river(x, z) < 2) continue;
      const s = (0.7 + rand() * 1.2) * (0.75 + pl.r / 45) * (1.2 - f * 0.6);
      const y = L.height(x, z) - 0.18 * s;
      push(
        props,
        K.Boulder,
        x,
        y,
        z,
        rand() * 7,
        (rand() - 0.5) * 0.5,
        s,
        s * (0.6 + rand() * 0.4),
        s,
        rand(),
      );
    }
    const vn = Math.min(10, Math.round((2 + pl.h / 28) * Config.karst.vines));
    for (let k = 0; k < vn; k++) this.vine(pl, rand, vines);
  }

  /**
   * One curtain of vines down a pillar's wall: from a mossy ledge high on the rock, hanging
   * along the wall (the instance basis runs from its foot to its top, so it follows the rock's
   * slope) and pushed out over any bulge between, so it never sinks into the stone.
   */
  private vine(pl: Pillar, rand: () => number, out: number[]): void {
    const sh = SHAPES[pl.shape];
    const skin = SKINS[pl.shape];
    // Prefer ledges: try a few heights and keep the one where the wall narrows fastest above.
    let t1 = 0;
    let best = -Infinity;
    for (let tr = 0; tr < 3; tr++) {
      const t = 0.18 + (sh.cap - 0.2) * rand();
      const ledge = profile(sh, t) - profile(sh, Math.min(t + 0.03, 0.999));
      if (ledge > best) {
        best = ledge;
        t1 = t;
      }
    }
    let drop = 7 + rand() * 16;
    const a = rand() * Math.PI * 2; // world angle round the axis
    const w = 2 + rand() * 2.5;
    const la = a + pl.yaw; // the lathe's own angle
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Radial distance of the wall from the axis at t.
    const wall = (t: number) => pl.r * skin.radius(t, la);
    const r1 = wall(t1);
    // The strand is straight: pushed out over any bulge between its ends, and shortened where
    // the wall falls away under it (a hollow), so it never sinks into the stone or hangs loose.
    let t0: number;
    let r0: number;
    let push: number;
    for (let tries = 0; ; tries++) {
      t0 = t1 - drop / pl.h;
      if (t0 < 0.07 || tries > 2) return;
      r0 = wall(t0);
      push = 0.45;
      let loose = 0;
      for (let f = 0.2; f < 0.9; f += 0.2) {
        const gap = r1 + (r0 - r1) * f - wall(t1 + (t0 - t1) * f);
        push = Math.max(push, 0.45 - gap);
        loose = Math.max(loose, gap);
      }
      if (loose + push < 1.3) break;
      drop *= 0.5;
    }
    const ax1 = pl.x + pl.lx * t1 * t1;
    const az1 = pl.z + pl.lz * t1 * t1;
    const ax0 = pl.x + pl.lx * t0 * t0;
    const az0 = pl.z + pl.lz * t0 * t0;
    const tx = ax1 + ca * (r1 + push);
    const ty = pl.y0 + t1 * pl.h;
    const tz = az1 + sa * (r1 + push);
    const bx = ax0 + ca * (r0 + push);
    const by = pl.y0 + t0 * pl.h;
    const bz = az0 + sa * (r0 + push);
    // Where two pillars stand close, a strand on one may run into the other: drop it.
    if (this.inOther(pl, tx, ty, tz) || this.inOther(pl, bx, by, bz)) return;
    // Basis: across the wall (tangent), from the foot up to the top, out from the wall.
    out.push(tx, ty, tz, sa * w, 0, -ca * w, tx - bx, ty - by, tz - bz, ca, 0, sa);
  }

  /** Is (x, y, z) within 1.5 m of the rock of a pillar other than `own`? */
  private inOther(own: Pillar, x: number, y: number, z: number): boolean {
    const C = Config.karst.pillarCell;
    for (let j = Math.floor((z - 80) / C); j <= Math.floor((z + 80) / C); j++)
      for (let i = Math.floor((x - 80) / C); i <= Math.floor((x + 80) / C); i++)
        for (const p of this.L.cell(i, j)) {
          if (p === own) continue;
          const t = (y - p.y0) / p.h;
          if (t < 0 || t >= 1) continue;
          const ax = p.x + p.lx * t * t;
          const az = p.z + p.lz * t * t;
          const la = Math.atan2(z - az, x - ax) + p.yaw;
          if (Math.hypot(x - ax, z - az) < p.r * SKINS[p.shape].radius(t, la) + 1.5) return true;
        }
    return false;
  }

  /** Water buffalo in the paddies and wallowing in the shallows; farmers in the fields. */
  private life(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const step = Config.karst.terraceStep;
    const FC = Config.karst.fieldCell;
    const cell = 22;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const roll = hash2(i, j, seed + 51);
        if (roll > Config.karst.life) continue;
        const x = (i + hash2(i, j, seed + 52)) * cell;
        const z = (j + hash2(i, j, seed + 53)) * cell;
        const bank = L.river(x, z);
        const yaw = hash2(i, j, seed + 54) * Math.PI * 2;
        const tint = hash2(i, j, seed + 55);
        if (bank > -6 && bank < -2) {
          // Wallowing in the shallows, only the back and the horns above the water.
          if (L.bridgeTop(x, z) !== -Infinity) continue;
          push(out, K.Buffalo, x, -0.75, z, yaw, 0, 1, 1, 1, tint);
          continue;
        }
        if (bank < 14) continue;
        const ground = L.height(x, z);
        if (ground - L.base(x, z) > 0.3) continue; // scree
        const p = L.pw;
        const raw = L.raw;
        if (p > 0.85) {
          // On a tread (not a riser) of a young or flooded field.
          const f = raw / step;
          const ti = Math.floor(f);
          if (f - ti > 0.7 || f - ti < 0.12) continue;
          const kind = paddyKind(ti, Math.floor(x / FC), Math.floor(z / FC));
          if (roll < Config.karst.life * 0.45)
            push(out, K.Buffalo, x, ground - (kind < FLOODED ? 0.25 : 0), z, yaw, 0, 1, 1, 1, tint);
          else
            push(out, K.Farmer, x, ground - (kind < FLOODED ? 0.2 : 0), z, yaw, 0, 1, 1, 1, tint);
        } else if (L.village(x, z) > 0.2 && roll < Config.karst.life * 0.3) {
          if (L.pathDist(x, z) < 6) push(out, K.Farmer, x, ground, z, yaw, 0, 1, 1, 1, tint);
        } else if (p < 0.05 && L.grove(x, z) < 0.2 && roll < Config.karst.life * 0.2) {
          push(out, K.Buffalo, x, ground, z, yaw, 0, 1, 1, 1, tint); // grazing on the meadow
        }
      }
  }
}
