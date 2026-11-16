import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { HUT_STRIDE, type AtollLayout } from './AtollLayout';

/** Kinds of Coral Atolls prop (index into the decor's meshes). */
export const P = {
  Hut: 0,
  Walk: 1,
  Fire: 2,
  Canoe: 3,
  Paddler: 4,
  Net: 5,
  Coral: 6,
  Fish: 7,
  Turtle: 8,
  Ray: 9,
  Bird: 10,
} as const;
export const PROP_KINDS = 11;

/** Floats per prop: kind, x, y, z, yaw, scale, tint. */
export const PROP_STRIDE = 7;

/** Tree types (Trees' type field). */
export const T = { Palm: 0, Shrub: 1, Jungle: 2 } as const;

/**
 * Per kind of moving thing (its aAnim kind): speed (m/s) and the circle it follows round its
 * instance's origin, radius r0 + dr * pathPhase. 1 seabird, 2 fish school, 3 turtle, 4 ray,
 * 5 paddled canoe. The life material (materials.ts) moves them by the same numbers.
 */
export const PATHS: Record<number, { speed: number; r0: number; dr: number }> = {
  1: { speed: 9, r0: 26, dr: 36 },
  2: { speed: 1.6, r0: 7, dr: 10 },
  3: { speed: 0.7, r0: 12, dr: 16 },
  4: { speed: 1.3, r0: 14, dr: 18 },
  5: { speed: 1.9, r0: 26, dr: 22 },
};

/**
 * A moving thing's phase from its circle's centre, as the shader computes it (fract of a
 * small linear form: float32 agrees with the JS double to well under a part in a thousand at
 * these coordinates), so the scatter can check the circle it will follow.
 */
export function pathPhase(x: number, z: number): number {
  const v = x * 0.0137 + z * 0.0291;
  return v - Math.floor(v);
}

/** Radius (m) of the circle a thing of aAnim kind `kind` centred at (x, z) follows. */
export function pathRadius(kind: number, x: number, z: number): number {
  const p = PATHS[kind];
  return p.r0 + p.dr * pathPhase(x, z);
}

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
 * Coral Atolls' scenery per chunk, pure and seeded (unit-tested): the palms, shrubs and jungle;
 * each village's huts, walkways and cooking fires (placed eagerly); and, lazily within prop
 * distance, the life of the lagoons: outrigger canoes pulled up on the beaches and a few out
 * paddling, fishing nets on poles in the shallows, coral heads on the lagoon knolls, schools
 * of fish, turtles and rays, frigatebirds and terns overhead. Nothing stands on a hut, in the
 * rock, or in the spawn's opening run; moving things keep their whole circle in open water.
 */
export class AtollScatter {
  constructor(private readonly L: AtollLayout) {}

  /** Within `r` of a hut (or a village walkway, over the water)? */
  private onVillage(x: number, z: number, r: number): boolean {
    const L = this.L;
    if (!L.nearVillage(x, z, r)) return false;
    return (
      L.villageAt(x, z) !== -Infinity ||
      L.villageAt(x + r, z) !== -Infinity ||
      L.villageAt(x - r, z) !== -Infinity ||
      L.villageAt(x, z + r) !== -Infinity ||
      L.villageAt(x, z - r) !== -Infinity
    );
  }

  /** Palms with shrubs between them on the islets and coasts; jungle up the high islands. */
  trees(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const seed = L.seed;
    const cell = 6.5;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const y = L.height(x, z);
        if (y < 0.9) continue;
        const h = hash2(i, j, seed + 13);
        const rot = hash2(i, j, seed + 15) * Math.PI * 2;
        const tint = hash2(i, j, seed + 16);
        if (y < 5.5) {
          if (h >= 0.72 || this.onVillage(x, z, 3.5)) continue;
          if (h < 0.5)
            out.push(T.Palm, x, y - 0.2, z, 0.8 + hash2(i, j, seed + 14) * 0.45, rot, tint);
          else out.push(T.Shrub, x, y - 0.3, z, 0.7 + tint * 0.6, rot, tint);
          continue;
        }
        // On the island: jungle, thinning out on the cliffs (about one cell in three: the
        // ground paints the carpet of crowns between them).
        if (h > Config.atoll.jungle) continue;
        const slope = Math.abs(L.height(x + 2, z) - y) + Math.abs(L.height(x, z + 2) - y);
        if (slope > 3.2) continue;
        out.push(T.Jungle, x, y - 0.5, z, 1.1 + hash2(i, j, seed + 14) * 0.6, rot, tint);
      }
  }

  /** The villages' huts, walkways and fires whose place lies in the chunk. */
  sites(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const inChunk = (x: number, z: number) => x >= ox && x < ox + size && z >= oz && z < oz + size;
    const AC = Config.atoll.cell;
    for (let j = Math.round((oz - 700) / AC); j <= Math.round((oz + size + 700) / AC); j++)
      for (let i = Math.round((ox - 700) / AC); i <= Math.round((ox + size + 700) / AC); i++) {
        const v = L.atoll(i, j)?.village;
        if (!v) continue;
        const H = v.huts;
        for (let k = 0; k < H.length; k += HUT_STRIDE)
          if (inChunk(H[k], H[k + 1]))
            push(out, P.Hut, H[k], H[k + 3], H[k + 1], H[k + 2], H[k + 4], hash2(k, i, j));
        const W = v.walks;
        for (let k = 0; k < W.length; k += 4)
          if (inChunk(W[k], W[k + 1])) push(out, P.Walk, W[k], 0, W[k + 1], W[k + 2], W[k + 3], 0);
        // Cooking fires on the sand behind the beach, among the huts on land.
        for (let k = 0; k < 3; k++) {
          const back = 6 + 7 * k;
          const off = (hash2(k, i + 3, j) - 0.5) * 30;
          const x = v.x - Math.sin(v.yaw) * back + Math.cos(v.yaw) * off;
          const z = v.z - Math.cos(v.yaw) * back - Math.sin(v.yaw) * off;
          if (!inChunk(x, z)) continue;
          const y = L.height(x, z);
          if (y < 0.6 || y > 4 || this.onVillage(x, z, 3)) continue;
          push(out, P.Fire, x, y, z, hash2(k, i, j + 5) * 6.28, 1, 0.5);
        }
      }
  }

  /** The lagoons' life within prop distance (see the class comment). */
  props(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.L;
    const A = Config.atoll;
    const s = L.seed;
    const free = (x: number, z: number, r: number) =>
      L.skyline(x, z, r) === -Infinity &&
      L.roofAt(x, z) === -Infinity &&
      !L.nearVillage(x, z, r * 0.3);
    // Canoes pulled up on the beaches (many by a village), bows to the water; nets on poles
    // in the shallows off them; now and then a fire on an islet's beach.
    const sc = 18;
    for (let j = Math.ceil(oz / sc); j < Math.ceil((oz + size) / sc); j++)
      for (let i = Math.ceil(ox / sc); i < Math.ceil((ox + size) / sc); i++) {
        const x = (i + hash2(i, j, s + 801)) * sc;
        const z = (j + hash2(i, j, s + 802)) * sc;
        const y = L.height(x, z);
        if (y < -1.6 || y > 2.4) continue;
        const gx = L.height(x + 2, z) - L.height(x - 2, z);
        const gz = L.height(x, z + 2) - L.height(x, z - 2);
        const g = Math.hypot(gx, gz);
        if (g < 0.02) continue;
        // Downhill, toward the water.
        const dx = -gx / g;
        const dz = -gz / g;
        const village = L.nearVillage(x, z, 90);
        const h = hash2(i, j, s + 803);
        if (y > 0.25 && y < 1.0) {
          if (h > (village ? A.villageCanoes : A.canoes)) continue;
          if (L.height(x + dx * 7, z + dz * 7) > -0.1 || this.onVillage(x, z, 5)) continue;
          if (L.nearOpening(x, z, 10)) continue;
          push(out, P.Canoe, x, y - 0.05, z, Math.atan2(dx, dz), 1, h);
        } else if (y < -0.3 && y > -1.5) {
          if (h > (village ? 0.35 : A.nets)) continue;
          if (!free(x, z, 12) || this.onVillage(x, z, 10)) continue;
          // The net runs along the shore: local x along (-dz, dx).
          push(out, P.Net, x, 0, z, Math.atan2(dz, -dx), 1, h);
        } else if (y > 1.0 && y < 2.2 && !village && h < A.fires) {
          if (L.ring(x, z) === Infinity || this.onVillage(x, z, 4)) continue;
          push(out, P.Fire, x, y, z, h * 40, 1, 0.5);
        }
      }
    // Coral heads on the lagoon's knolls, where the water is shallow enough to see them.
    const cc = 7;
    for (let j = Math.ceil(oz / cc); j < Math.ceil((oz + size) / cc); j++)
      for (let i = Math.ceil(ox / cc); i < Math.ceil((ox + size) / cc); i++) {
        const x = (i + hash2(i, j, s + 811)) * cc;
        const z = (j + hash2(i, j, s + 812)) * cc;
        const b = L.bommie(x, z);
        if (b < 0.2 || hash2(i, j, s + 813) > b * A.coral) continue;
        const y = L.height(x, z);
        if (y > -1.3 || y < -6) continue;
        const rs = L.ring(x, z);
        if (!L.ra || rs > -L.ra.w) continue;
        if (L.skyline(x, z, 2) !== -Infinity) continue;
        push(
          out,
          P.Coral,
          x,
          y - 0.1,
          z,
          hash2(i, j, s + 814) * 6.28,
          0.7 + 0.9 * b,
          hash2(i, j, s + 815),
        );
      }
    // Moving things, each on a circle that must stay over open water deep enough to hide them.
    const circleOk = (x: number, z: number, kind: number, below: number, pad: number) => {
      const r = pathRadius(kind, x, z);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (L.height(px, pz) > below || L.skyline(px, pz, pad) !== -Infinity) return false;
        if (L.roofAt(px, pz) !== -Infinity || L.nearVillage(px, pz, pad)) return false;
      }
      return true;
    };
    const lc = 80;
    for (let j = Math.ceil(oz / lc); j < Math.ceil((oz + size) / lc); j++)
      for (let i = Math.ceil(ox / lc); i < Math.ceil((ox + size) / lc); i++) {
        const x = (i + hash2(i, j, s + 821)) * lc;
        const z = (j + hash2(i, j, s + 822)) * lc;
        const rs = L.ring(x, z);
        const a = L.ra;
        // Inside the reef: the lagoons and the flats' inner edge.
        if (!a || rs > -a.w * 0.5) continue;
        const h = hash2(i, j, s + 823);
        if (h < A.fish) {
          if (circleOk(x, z, 2, -2.6, 3))
            push(out, P.Fish, x, -1.7 - hash2(i, j, s + 824) * 0.6, z, 0, 1, hash2(i, j, s + 825));
        } else if (h < A.fish + A.turtles) {
          if (circleOk(x, z, 3, -2.4, 4)) push(out, P.Turtle, x, -1.1, z, 0, 1, 0.5);
        } else if (h < A.fish + A.turtles + A.rays) {
          if (circleOk(x, z, 4, -3.2, 4)) push(out, P.Ray, x, -2.2, z, 0, 1, 0.5);
        } else if (h < A.fish + A.turtles + A.rays + A.paddlers) {
          if (circleOk(x, z, 5, -1.2, 8) && !L.nearOpening(x, z, 70))
            push(out, P.Paddler, x, 0, z, 0, 1, 0.5);
        }
      }
    // Seabirds: frigatebirds hanging high over the islands and islets, terns low over the reef
    // and the lagoons in twos and threes. One chance per chunk.
    const h = hash2(Math.round(ox / size), Math.round(oz / size), s + 831);
    if (h < A.seabirds) {
      const x = ox + size * (0.25 + 0.5 * hash2(ox, oz, s + 832));
      const z = oz + size * (0.25 + 0.5 * hash2(ox, oz, s + 833));
      const land = L.height(x, z);
      if (land > 0.5 || h < A.seabirds * 0.35) {
        const y = Math.max(land, 0) + 45 + 40 * hash2(ox, oz, s + 834);
        push(out, P.Bird, x, y, z, 0, 1.25, 0);
      } else {
        const n = 2 + Math.floor(hash2(ox, oz, s + 835) * 2);
        for (let k = 0; k < n; k++) {
          const tx = x + (hash2(k, ox, s + 836) - 0.5) * 30;
          const tz = z + (hash2(k, oz, s + 837) - 0.5) * 30;
          push(out, P.Bird, tx, 9 + 10 * hash2(k, ox + oz, s + 838), tz, 0, 0.6, 1);
        }
      }
    }
  }
}
