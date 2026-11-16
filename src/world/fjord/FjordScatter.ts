import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { createNoise2D, hash2, type Noise2D } from '../noise';
import type { FjordLayout } from './FjordLayout';
import { P, PROP_STRIDE } from './FjordSites';

/** Tree types (Trees' type field). */
export const T = { Spruce: 0, Birch: 1 } as const;

function push(
  out: number[],
  kind: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  move: number,
  sx: number,
  sy: number,
  sz: number,
  tint: number,
): void {
  out.push(kind, x, y, z, yaw, move, sx, sy, sz, tint);
}

/**
 * Aurora Fjords' scenery per chunk, pure and seeded (unit-tested): the villages' buildings,
 * jetties, moored boats and racks with gulls wheeling over them, and the pans of sea ice,
 * placed eagerly; the forest (spruce on the walls' lower slopes, birch in drifts on the flat
 * strands); and, lazily within prop distance, the small things: boulder beaches along the
 * water and rockfall at the walls' feet, seals hauled out on the bigger floes, fishing boats
 * working out on the water and sea eagles soaring over the walls. Nothing stands in a street,
 * on the water (but boats, ice and seals) or in a waterfall's stream.
 */
export class FjordScatter {
  private readonly nRocky: Noise2D;

  constructor(private readonly L: FjordLayout) {
    this.nRocky = createNoise2D(L.seed + 470);
  }

  /** The village parts (and gulls) whose place lies in the chunk, and its floes. */
  sites(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const S = L.sites;
    const inChunk = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const done = new Set<object>();
    S.near(ox + size / 2, oz + size / 2, size / 2 + Config.fjord.villageReach + 60, (v) => {
      if (done.has(v)) return;
      done.add(v);
      const parts = S.plan(v);
      for (let k = 0; k < parts.length; k += PROP_STRIDE)
        if (inChunk(parts[k + 1], parts[k + 3]))
          for (let q = 0; q < PROP_STRIDE; q++) out.push(parts[k + q]);
      // Gulls wheel over the village's shore, where the fish are landed.
      if (!inChunk(v.x, v.z)) return;
      const n = v.home ? 6 : 3 + Math.floor(v.seed * 3);
      for (let i = 0; i < n; i++) {
        const h = hash2(i, Math.round(v.x), L.seed + 480);
        const a = (h - 0.5) * v.span * 1.6;
        const x = v.x + v.ux * a - v.vx * (14 + 20 * hash2(i, 3, L.seed + 481));
        const z = v.z + v.uz * a - v.vz * (14 + 20 * hash2(i, 3, L.seed + 481));
        const r = 12 + 18 * hash2(i, 4, L.seed + 482);
        push(
          out,
          P.Bird,
          x,
          16 + 14 * hash2(i, 5, L.seed + 483),
          z,
          0,
          h > 0.5 ? r : -r,
          1,
          1,
          1,
          0,
        );
      }
    });
    this.floes(ox, oz, size, (x, z, yaw, s) =>
      push(out, P.Floe, x, 0, z, yaw, 0, s, 1, s * 0.8, 0),
    );
  }

  /** Pans of sea ice drifting on the open water, thicker out in the middle of the fjord. */
  floes(
    ox: number,
    oz: number,
    size: number,
    fn: (x: number, z: number, yaw: number, s: number) => void,
  ): void {
    const L = this.L;
    const seed = L.seed;
    const fc = 30;
    for (let j = Math.ceil(oz / fc); j < Math.ceil((oz + size) / fc); j++)
      for (let i = Math.ceil(ox / fc); i < Math.ceil((ox + size) / fc); i++) {
        const x = (i + hash2(i, j, seed + 31)) * fc;
        const z = (j + hash2(i, j, seed + 32)) * fc;
        const bank = L.fjord(x, z);
        if (bank > -10 || hash2(i, j, seed + 33) > 0.25 + 0.3 * smoothstep(-10, -60, bank))
          continue;
        // Not among a village's jetties and moored boats.
        if (bank > -45 && L.sites.street(x, z, 21) < 30) continue;
        fn(x, z, hash2(i, j, seed + 34) * 7, 2 + 6 * hash2(i, j, seed + 35) ** 2);
      }
  }

  /** Spruce and birch (Trees' stride: type, x, y, z, scale, rotY, tint). */
  trees(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 9;
    const H = L.lighthouse;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const f = L.forest(x, z);
        if (hash2(i, j, seed) > f * 0.85) continue;
        const y = L.height(x, z);
        const slope = (Math.abs(L.height(x + 3, z) - y) + Math.abs(L.height(x, z + 3) - y)) / 6;
        if (slope > 1.33) continue;
        if (Math.hypot(x - H.x, z - H.z) < 14) continue;
        if (L.sites.wet(x, z) < 1) continue;
        const birch = hash2(i, j, seed + 13) < L.birch(x, z, slope) * 0.85;
        out.push(
          birch ? T.Birch : T.Spruce,
          x,
          y - 0.4,
          z,
          (birch ? 0.75 : 0.6) + hash2(i, j, seed + 14) * 0.65,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
  }

  /** The small things, scattered the first time the chunk comes within prop distance. */
  props(ox: number, oz: number, size: number, out: number[]): void {
    this.boulders(ox, oz, size, out);
    this.seals(ox, oz, size, out);
    this.boats(ox, oz, size, out);
    this.eagles(ox, oz, size, out);
  }

  /**
   * Boulder beaches along stretches of the shore (a noise picks the rocky ones), rounded stones
   * at and just above the water's edge, and rockfall at the walls' feet.
   */
  private boulders(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 5;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const h = hash2(i, j, seed + 51);
        if (h > 0.5) continue;
        const x = (i + hash2(i, j, seed + 52)) * cell;
        const z = (j + hash2(i, j, seed + 53)) * cell;
        const bank = L.fjord(x, z);
        if (bank < -1.5 || bank > 70) continue;
        const shelf = L.shelf(x, z);
        const rocky = smoothstep(-0.2, 0.3, this.nRocky(x * 0.006, z * 0.006));
        // The beach: dense on rocky stretches, a few elsewhere; the talus under the wall.
        const beach = (1 - smoothstep(4, 9, bank)) * (0.15 + 0.85 * rocky);
        const talus =
          smoothstep(shelf - 2, shelf + 1, bank) *
          (1 - smoothstep(shelf + 6, shelf + 14, bank)) *
          0.5;
        if (h > 0.5 * Math.max(beach, talus)) continue;
        if (L.sites.street(x, z, bank) < 3 || L.sites.wet(x, z) < 0.8) continue;
        // Out of the villages' built ground.
        if (L.sites.built(x, z) > -Infinity) continue;
        const y = L.height(x, z);
        const s = (bank < 9 ? 0.45 : 0.7) + 1.1 * hash2(i, j, seed + 54) ** 2;
        const yaw = hash2(i, j, seed + 55) * Math.PI * 2;
        push(
          out,
          P.Boulder,
          x,
          y - 0.25 * s,
          z,
          yaw,
          0,
          s,
          s * (0.8 + 0.4 * hash2(i, j, seed + 56)),
          s,
          hash2(i, j, seed + 57),
        );
      }
  }

  /** Seals hauled out on the bigger floes, lying across them. */
  private seals(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    let k = 0;
    this.floes(ox, oz, size, (x, z, yaw, s) => {
      k++;
      if (s < 4 || hash2(Math.round(x), Math.round(z), L.seed + 61) > Config.fjord.seals) return;
      const n = 1 + (hash2(k, 1, L.seed + 62) < 0.35 ? 1 : 0);
      for (let q = 0; q < n; q++) {
        const a = yaw + q * 2.1;
        const r = s * 0.3 * q;
        push(
          out,
          P.Seal,
          x + Math.sin(a) * r,
          0.27,
          z + Math.cos(a) * r,
          a + 1.2,
          0,
          1,
          1,
          1,
          hash2(k, q, L.seed + 63),
        );
      }
    });
  }

  /** Fishing boats working the open water, each steaming slowly round its own circle. */
  private boats(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const K = Config.fjord;
    const C = K.boatCell;
    const seed = L.seed;
    const c = { x: 0, z: 0 };
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++) {
        if (hash2(i, j, seed + 71) > K.boatChance) continue;
        let x = (i + 0.5) * C;
        let z = (j + 0.5) * C;
        for (let n = 0; n < 4; n++) {
          L.toCentre(x, z, c);
          x = c.x;
          z = c.z;
        }
        if (x < ox || x >= ox + size || z < oz || z >= oz + size) continue;
        if (x < i * C || x >= (i + 1) * C || z < j * C || z >= (j + 1) * C) continue;
        if (L.fjord(x, z) > -L.fw * 0.6) continue;
        const r = Math.min(18 + 22 * hash2(i, j, seed + 72), L.fw * 0.5);
        if (!this.openWater(x, z, r + 14)) continue;
        if (Math.hypot(x - L.spawn.x, z - L.spawn.z) < 120) continue;
        const dir = hash2(i, j, seed + 73) < 0.5 ? 1 : -1;
        push(out, P.Boat, x, 0, z, 0, r * dir, 1, 1, 1, hash2(i, j, seed + 74));
      }
  }

  /** Open water within `r` of (x, z): no shore, ice or village (sampled round the circle). */
  private openWater(x: number, z: number, r: number): boolean {
    const L = this.L;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const sx = x + Math.sin(a) * r;
      const sz = z + Math.cos(a) * r;
      if (L.fjord(sx, sz) > -8 || L.ice(sx, sz) > 0) return false;
    }
    let ok = L.ice(x, z) === 0;
    L.sites.near(x, z, 200, (v) => {
      if (Math.hypot(x - v.x, z - v.z) < 160) ok = false;
    });
    return ok;
  }

  /** Sea eagles circling high over the walls and the plateau's edge, one in a cell at most. */
  private eagles(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const C = Config.fjord.eagleCell;
    const seed = L.seed;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++) {
        if (hash2(i, j, seed + 81) > 0.7) continue;
        const x = (i + 0.2 + 0.6 * hash2(i, j, seed + 82)) * C;
        const z = (j + 0.2 + 0.6 * hash2(i, j, seed + 83)) * C;
        if (x < ox || x >= ox + size || z < oz || z >= oz + size) continue;
        const bank = L.fjord(x, z);
        if (bank < 20 || bank > 260) continue;
        const r = 55 + 35 * hash2(i, j, seed + 84);
        let top = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          top = Math.max(top, L.height(x + Math.sin(a) * r, z + Math.cos(a) * r));
        }
        const dir = hash2(i, j, seed + 85) < 0.5 ? 1 : -1;
        push(
          out,
          P.Bird,
          x,
          top + 35 + 20 * hash2(i, j, seed + 86),
          z,
          0,
          r * dir,
          2.6,
          2.6,
          2.6,
          1,
        );
      }
  }
}
