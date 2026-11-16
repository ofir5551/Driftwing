import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { hash2 } from '../noise';
import {
  lifeRadius,
  OUT_LAMP,
  OUT_MAST,
  OUT_STRIDE,
  type Outpost,
  type RingmoonLayout,
} from './RingmoonLayout';

/** Kinds of Ringmoon prop record (index into the decor's meshes). Habs to lamps are OUT_*. */
export const P = {
  Hab: 0,
  Mast: 1,
  Lamp: 2,
  Bulbs: 3,
  Steps: 4,
  Fish: 5,
  Grazer: 6,
  Floater: 7,
} as const;
export const PROP_KINDS = 8;

/** Floats per prop: kind, x, y, z, yaw, scale, tint. */
export const PROP_STRIDE = 7;

/** Plant types in the shared Trees meshes. */
export const COIL = 0;
export const REED = 1;

/** Moving things' kinds in the life material (aAnim.x): fish school, grazer, floater. */
export const ANIM = { Fish: 1, Grazer: 2, Floater: 3 } as const;

function push(
  out: number[],
  kind: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  s: number,
  tint: number,
): void {
  out.push(kind, x, y, z, yaw, s, tint);
}

/**
 * Ringmoon Shallows' scenery per chunk, pure and seeded (unit-tested): the coil fronds and reed
 * fans; the explorers' habs, masts and lamps and the floaters overhead (placed eagerly); and,
 * lazily within prop distance, clusters of glow bulbs in the moss, basalt column steps on the
 * islets' terraces, schools of glowing fish in the shallows and herds of grazers on the hills.
 * Nothing grows on a path or round a hab; moving things keep their whole circle clear (fish in
 * water deep enough to hide them, grazers on level moss clear of stone and the explorers).
 */
export class RingmoonScatter {
  constructor(private readonly L: RingmoonLayout) {}

  /** Coil fronds in loose groves, reed fans between them; none on a path or round a hab. */
  plants(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 10;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 21)) * cell;
        const z = (j + hash2(i, j, seed + 22)) * cell;
        const y = L.height(x, z);
        if (y < 1.4) continue;
        // Inland the plants thin out, so the hills read as open moss and the counts stay low.
        if (y > 10 && hash2(i, j, seed + 27) < smoothstep(10, 30, y) * 0.6) continue;
        const h = hash2(i, j, seed + 23);
        if (h >= 0.7) continue;
        if (L.pathDist(x, z) < 4 || L.propNear(x, z, 3)) continue;
        const rot = hash2(i, j, seed + 25) * Math.PI * 2;
        const tint = hash2(i, j, seed + 26);
        const s = 0.75 + hash2(i, j, seed + 24) * 0.5;
        if (h < 0.4) out.push(COIL, x, y - 0.3, z, s, rot, tint);
        else out.push(REED, x, y - 0.2, z, s, rot, tint);
      }
  }

  /** The explorers' habs, masts and lamps (outposts and the camp) and floaters in the chunk. */
  sites(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const inChunk = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const add = (o: Outpost) => {
      const Q = o.parts;
      for (let k = 0; k < Q.length; k += OUT_STRIDE) {
        const kind = Q[k];
        if (kind > OUT_LAMP || !inChunk(Q[k + 1], Q[k + 2])) continue;
        const x = Q[k + 1];
        const z = Q[k + 2];
        // Sunk a little into the moss (a mast's tripod a little more, on any slope).
        const y = L.height(x, z) - (kind === OUT_MAST ? 0.3 : 0.15);
        push(out, kind, x, y, z, Q[k + 3], Q[k + 4], hash2(k, Math.round(x), Math.round(z)));
      }
    };
    const C = Config.ringmoon.propCell;
    for (let j = Math.floor((oz - 60) / C); j <= Math.floor((oz + size + 60) / C); j++)
      for (let i = Math.floor((ox - 60) / C); i <= Math.floor((ox + size + 60) / C); i++) {
        const o = L.outpost(i, j);
        if (o) add(o);
      }
    add(L.campSite);
    const F = Config.ringmoon.floaterCell;
    for (let j = Math.floor(oz / F); j <= Math.floor((oz + size) / F); j++)
      for (let i = Math.floor(ox / F); i <= Math.floor((ox + size) / F); i++) {
        const f = L.floater(i, j);
        if (f && inChunk(f.x, f.z)) push(out, P.Floater, f.x, f.y, f.z, 0, f.s, hash2(i, j, 5));
      }
  }

  /** Glow bulbs, terrace steps, fish and grazers within prop distance (see the class comment). */
  props(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const R = Config.ringmoon;
    const s = L.seed;
    // Glow bulbs in clusters on the moss: islets, the camp's spit and the hills.
    const bc = 12;
    for (let j = Math.ceil(oz / bc); j < Math.ceil((oz + size) / bc); j++)
      for (let i = Math.ceil(ox / bc); i < Math.ceil((ox + size) / bc); i++) {
        const h = hash2(i, j, s + 701);
        if (h > R.bulbs) continue;
        const x = (i + hash2(i, j, s + 702)) * bc;
        const z = (j + hash2(i, j, s + 703)) * bc;
        const y = L.height(x, z);
        if (y < 1.5) continue;
        if (L.pathDist(x, z) < 2.5 || L.propNear(x, z, 4) || L.skyline(x, z, 3) !== -Infinity)
          continue;
        const tint = hash2(i, j, s + 704);
        push(out, P.Bulbs, x, y - 0.1, z, h * 70, 0.8 + 0.5 * hash2(i, j, s + 705), tint);
      }
    // Basalt column steps where an islet's terrace drops to the next (not on the mainland,
    // whose hills roll), stepping down the riser.
    const sc = 9;
    for (let j = Math.ceil(oz / sc); j < Math.ceil((oz + size) / sc); j++)
      for (let i = Math.ceil(ox / sc); i < Math.ceil((ox + size) / sc); i++) {
        if (hash2(i, j, s + 711) > R.steps) continue;
        const x = (i + hash2(i, j, s + 712)) * sc;
        const z = (j + hash2(i, j, s + 713)) * sc;
        const y = L.height(x, z);
        if (y < 2.4 || y > 9 || L.mainland(x, z) > 0.2 || L.isle(x, z) < 0.5) continue;
        if (L.campMask(x, z) > 0) continue;
        const gx = (L.height(x + 2, z) - L.height(x - 2, z)) / 4;
        const gz = (L.height(x, z + 2) - L.height(x, z - 2)) / 4;
        const g = Math.hypot(gx, gz);
        if (g < 0.35 || g > 1.5) continue;
        if (L.skyline(x, z, 4) !== -Infinity || L.propNear(x, z, 5) || L.pathDist(x, z) < 3)
          continue;
        // Local +z downhill: the columns step down the slope.
        const yaw = Math.atan2(-gx, -gz);
        push(out, P.Steps, x, y, z, yaw, 0.8 + 0.6 * Math.min(g, 1), hash2(i, j, s + 714));
      }
    // Schools of glowing fish on circles over the shallows, deep enough to hide them.
    const fc = 70;
    for (let j = Math.ceil(oz / fc); j < Math.ceil((oz + size) / fc); j++)
      for (let i = Math.ceil(ox / fc); i < Math.ceil((ox + size) / fc); i++) {
        if (hash2(i, j, s + 721) > R.fish) continue;
        const x = (i + hash2(i, j, s + 722)) * fc;
        const z = (j + hash2(i, j, s + 723)) * fc;
        if (this.fishOk(x, z))
          push(out, P.Fish, x, -0.75 - 0.4 * hash2(i, j, s + 724), z, 0, 1, hash2(i, j, s + 725));
      }
    // Herds of grazers on the mainland's hills, each on a small circle over level moss.
    const hc = 220;
    for (let j = Math.ceil(oz / hc); j < Math.ceil((oz + size) / hc); j++)
      for (let i = Math.ceil(ox / hc); i < Math.ceil((ox + size) / hc); i++) {
        if (hash2(i, j, s + 731) > R.herds) continue;
        const cx = (i + 0.15 + 0.7 * hash2(i, j, s + 732)) * hc;
        const cz = (j + 0.15 + 0.7 * hash2(i, j, s + 733)) * hc;
        if (L.mainland(cx, cz) < 0.9) continue;
        const n = 3 + Math.floor(hash2(i, j, s + 734) * 3);
        const herd = out.length;
        for (let k = 0; k < n; k++) {
          const a = hash2(i, j, s + 740) * Math.PI * 2 + k * 2.4;
          const d = k === 0 ? 0 : 15 + 9 * hash2(i, j, s + 750 + k);
          const x = cx + Math.sin(a) * d;
          const z = cz + Math.cos(a) * d;
          const gy = this.grazeY(x, z);
          if (gy === -Infinity || this.crowded(out, herd, x, z)) continue;
          push(out, P.Grazer, x, gy, z, 0, 1.2 + 0.45 * hash2(i, j, s + 760 + k), hash2(k, i, j));
        }
      }
  }

  /** Whether a grazer at (x, z) would walk into one already in `out` (from index `from`). */
  private crowded(out: number[], from: number, x: number, z: number): boolean {
    const r = lifeRadius(ANIM.Grazer, x, z);
    for (let k = from; k < out.length; k += PROP_STRIDE) {
      const ox = out[k + 1];
      const oz = out[k + 3];
      if (Math.hypot(x - ox, z - oz) < r + lifeRadius(ANIM.Grazer, ox, oz) + 5) return true;
    }
    return false;
  }

  /** A school's circle stays over water at least 1.6 m deep, clear of stone, legs and bars. */
  fishOk(x: number, z: number): boolean {
    const L = this.L;
    const r = lifeRadius(ANIM.Fish, x, z);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (L.height(px, pz) > -1.7 || L.skyline(px, pz, 3) !== -Infinity) return false;
    }
    return true;
  }

  /**
   * A grazer's circle stays on moss within 0.6 m of its centre's height (its feet on the
   * ground), clear of stone, the alien things, the explorers' paths and other grazers' circles
   * (herd members stand 12 m or more apart, their circles at most 7 m across).
   */
  grazeOk(x: number, z: number): boolean {
    return this.grazeY(x, z) !== -Infinity;
  }

  /**
   * The height a grazer walks at round its circle (half way between the lowest and highest
   * ground on it: at most 0.6 m off the ground either way, in the moss), or -Infinity where its circle
   * isn't level moss clear of stone, the alien things, the explorers' paths and the water.
   * Herd members stand 15 m or more apart and their circles are at most 10 m across.
   */
  grazeY(x: number, z: number): number {
    const L = this.L;
    const y = L.height(x, z);
    if (y < 4) return -Infinity;
    const r = lifeRadius(ANIM.Grazer, x, z);
    let lo = y;
    let hi = y;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const g = L.height(x + Math.cos(a) * r, z + Math.sin(a) * r);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    if (hi - lo > 1.2 || lo < 3.5) return -Infinity;
    const pad = r + 5;
    if (L.skyline(x, z, pad) !== -Infinity || L.propNear(x, z, pad) || L.pathDist(x, z) < pad)
      return -Infinity;
    return (lo + hi) / 2 - 0.1;
  }
}
