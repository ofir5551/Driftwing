import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { createNoise2D, hash2, type Noise2D } from '../noise';
import type { LandField } from '../Terrain';

/**
 * The Highlands' plan, pure (no Three scene): the field patchwork (a rotated grid of fields,
 * each a crop from an integer hash the terrain shader shares), which fields are farmed, the
 * dirt road along every river, and the buildings (villages along the roads, lone farmsteads),
 * which the flight floor and the wisps keep clear of. Tested in Node.
 */

/** Crops, in the shader's order (Meadow is left unpainted). */
export const Field = { Wheat: 0, Pasture: 1, Plough: 2, Rows: 3, Rapeseed: 4, Meadow: 5 } as const;
export type Field = (typeof Field)[keyof typeof Field];

/** Highlands prop kinds; the first three are buildings (placed eagerly, solid to flight). */
export const P = {
  Cottage: 0,
  Barn: 1,
  Windmill: 2,
  Sails: 3,
  Boulder: 4,
  Slab: 5,
  Bush: 6,
  Log: 7,
  Hay: 8,
  Wall: 9,
  Fence: 10,
  Sheep: 11,
  Boat: 12,
  Reeds: 13,
  Flock: 14,
} as const;
export const PROP_KINDS = 15;

/** Floats per prop: kind, x, y, z, yaw, tilt (about local z), sx, sy, sz, tint. */
export const PROP_STRIDE = 10;

/** Footprint radius and roof height (m) of each building kind, for the flight floor. */
export const BUILT_SIZE: readonly (readonly [number, number])[] = [
  [5.5, 8.5], // cottage
  [7.5, 8.5], // barn
  [8, 19], // windmill, sails included
];
/** Metres round a building over which the flight floor eases back down to the ground. */
export const LIFT_EASE = 8;
/** Farthest a building's lift reaches from its centre. */
const REACH = 8 + LIFT_EASE;

export function pushProp(
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

/** Grid coordinates (in fields, fractional) of world x,z on the rotated field grid. */
export interface FieldCoords {
  u: number;
  w: number;
}

export function fieldCoords(x: number, z: number, out: FieldCoords): FieldCoords {
  const L = Config.highlands;
  const c = Math.cos(L.fieldAngle);
  const s = Math.sin(L.fieldAngle);
  out.u = (x * c - z * s) / L.fieldCell;
  out.w = (x * s + z * c) / L.fieldCell;
  return out;
}

/** World x,z of grid point (u, w) (in fields): the inverse rotation. */
export function fieldPoint(u: number, w: number, out: { x: number; z: number }) {
  const L = Config.highlands;
  const c = Math.cos(L.fieldAngle);
  const s = Math.sin(L.fieldAngle);
  out.x = (u * c + w * s) * L.fieldCell;
  out.z = (-u * s + w * c) * L.fieldCell;
  return out;
}

/** World x,z of the centre of field (i, j). */
export function fieldCentre(i: number, j: number, out: { x: number; z: number }) {
  return fieldPoint(i + 0.5, j + 0.5, out);
}

/**
 * Crop of field (i, j): an integer hash exact in float32 for fields within ~20 km of the origin,
 * so the GLSL copy in Land.ts picks the same crop.
 */
export function fieldKind(i: number, j: number): Field {
  const n = i * i * 31 + j * j * 17 + i * j * 7 + i * 13 + j * 29;
  const h = ((n % 97) + 97) % 97;
  return (h % 6) as Field;
}

const key = (i: number, j: number) => (i + 0x80000) * 0x100000 + (j + 0x80000);
const at = { x: 0, z: 0 };
const fc: FieldCoords = { u: 0, w: 0 };

export class HighlandsLayout {
  private readonly farmed = new Map<number, boolean>();
  private readonly builtCache = new Map<number, number[]>();
  private readonly villages: Noise2D;
  /** Scratch: fields whose centre lies in the chunk being scattered (i, j, x, z quads). */
  private readonly cells: number[] = [];

  constructor(
    readonly field: LandField,
    readonly seed: number,
  ) {
    this.villages = createNoise2D(seed + 23);
  }

  /**
   * Whether field (i, j) is farmland, decided once at its centre. Whole fields are farmed or not
   * (no field fades out halfway across a triangle), and walls, crops and hay follow the same
   * answer. Cached; the cache is dropped when it grows large.
   */
  cellFarmed(i: number, j: number): boolean {
    const k = key(i, j);
    let v = this.farmed.get(k);
    if (v === undefined) {
      if (this.farmed.size > 20000) this.farmed.clear();
      fieldCentre(i, j, at);
      v = this.field.farm(at.x, at.z) > Config.highlands.fieldFarm;
      this.farmed.set(k, v);
    }
    return v;
  }

  /**
   * The 3x3 farmed flags round field (i, j) as bits (bit (dj + 1) * 3 + (di + 1)). A terrain
   * vertex carries its field's mask, flat-shaded, so a fragment in a neighbouring field can
   * still look its own field up across a triangle that straddles the border.
   */
  farmMask(i: number, j: number): number {
    let m = 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++)
        if (this.cellFarmed(i + di, j + dj)) m += 2 ** ((dj + 1) * 3 + di + 1);
    return m;
  }

  /** The field at world x,z (into `out`: i in u, j in w). */
  fieldAt(x: number, z: number, out: FieldCoords): FieldCoords {
    fieldCoords(x, z, out);
    out.u = Math.floor(out.u);
    out.w = Math.floor(out.w);
    return out;
  }

  /** Metres from the middle of the road (along one bank of every river); large when far. */
  roadDist(x: number, z: number): number {
    return Math.abs(this.field.riverDist(x, z) - Config.highlands.roadOffset);
  }

  /** Height change over 3 m east plus 3 m north: a cheap steepness. */
  slope(x: number, z: number, y: number): number {
    const f = this.field;
    return Math.abs(f.height(x + 3, z) - y) + Math.abs(f.height(x, z + 3) - y);
  }

  /**
   * Fields whose centre lies in the chunk at (ox, oz): (i, j, x, z) quads in a scratch array
   * (valid until the next call), so every field belongs to exactly one chunk.
   */
  fieldsIn(ox: number, oz: number, size: number): readonly number[] {
    const out = this.cells;
    out.length = 0;
    let u0 = Infinity;
    let u1 = -Infinity;
    let w0 = Infinity;
    let w1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      fieldCoords(ox + (k & 1) * size, oz + (k >> 1) * size, fc);
      u0 = Math.min(u0, fc.u);
      u1 = Math.max(u1, fc.u);
      w0 = Math.min(w0, fc.w);
      w1 = Math.max(w1, fc.w);
    }
    for (let j = Math.floor(w0) - 1; j <= Math.ceil(w1); j++)
      for (let i = Math.floor(u0) - 1; i <= Math.ceil(u1); i++) {
        fieldCentre(i, j, at);
        if (at.x < ox || at.x >= ox + size || at.z < oz || at.z >= oz + size) continue;
        out.push(i, j, at.x, at.z);
      }
    return out;
  }

  /** The buildings of chunk (cx, cz) (PROP_STRIDE records); cached, a pure function of the seed. */
  built(cx: number, cz: number): readonly number[] {
    const k = key(cx, cz);
    let b = this.builtCache.get(k);
    if (!b) {
      if (this.builtCache.size > 2000) this.builtCache.clear();
      const size = Config.world.chunkSize;
      b = this.placeBuildings(cx * size, cz * size, size);
      this.builtCache.set(k, b);
    }
    return b;
  }

  /**
   * The flight floor over the buildings near x,z: `ground` lifted to clear the roofs, easing
   * back down over LIFT_EASE metres round each. Buildings sit well inside their chunk's
   * neighbours' reach, so only the chunks within REACH of x,z are scanned (usually one).
   */
  builtLift(x: number, z: number, ground: number): number {
    const size = Config.world.chunkSize;
    const cx0 = Math.floor((x - REACH) / size);
    const cx1 = Math.floor((x + REACH) / size);
    const cz0 = Math.floor((z - REACH) / size);
    const cz1 = Math.floor((z + REACH) / size);
    let top = ground;
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = this.built(cx, cz);
        for (let k = 0; k < b.length; k += PROP_STRIDE) {
          const dx = x - b[k + 1];
          const dz = z - b[k + 3];
          if (dx > REACH || dx < -REACH || dz > REACH || dz < -REACH) continue;
          const dims = BUILT_SIZE[b[k]];
          const r = dims[0];
          const h = dims[1];
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < r + LIFT_EASE)
            top = Math.max(top, ground + (b[k + 2] + h - ground) * smoothstep(r + LIFT_EASE, r, d));
        }
      }
    return top;
  }

  private clear(out: number[], x: number, z: number, r: number): boolean {
    for (let k = 0; k < out.length; k += PROP_STRIDE)
      if (Math.hypot(x - out[k + 1], z - out[k + 3]) < r) return false;
    return true;
  }

  private placeBuildings(ox: number, oz: number, size: number): number[] {
    const f = this.field;
    const L = Config.highlands;
    const seed = this.seed + 300;
    const out: number[] = [];
    // Villages: houses strung along the road, set back on either side, facing it.
    const cell = 8;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        // Villages cluster where a slow noise peaks; a few houses stand alone in between.
        const vx = (i + 0.5) * cell;
        const vz = (j + 0.5) * cell;
        const hub = smoothstep(0.2, 0.55, this.villages(vx * 0.0028, vz * 0.0028));
        if (hash2(i, j, seed) > L.village * (0.12 + 1.6 * hub)) continue;
        const x = vx + (hash2(i, j, seed + 1) - 0.5) * 5;
        const z = vz + (hash2(i, j, seed + 2) - 0.5) * 5;
        const rd = f.riverDist(x, z);
        const side = rd - L.roadOffset;
        const as = Math.abs(side);
        // A row each side of the road, and in a village's heart a second row behind it.
        if (as < 8 || (as > 15 && (hub < 0.5 || as < 23 || as > 31))) continue;
        if (f.farm(x, z) < 0.3) continue;
        const y = f.height(x, z);
        if (y < 1.6 || y > 50 || this.slope(x, z, y) > 1.4) continue;
        const r = hash2(i, j, seed + 3);
        const kind = r < 0.68 ? P.Cottage : r < 0.9 ? P.Barn : P.Windmill;
        if (!this.clear(out, x, z, kind === P.Cottage ? 9.5 : 13)) continue;
        // Face the road: across the gradient of the river distance.
        const gx = f.riverDist(x + 2, z) - rd;
        const gz = f.riverDist(x, z + 2) - rd;
        const s = side > 0 ? -1 : 1;
        pushProp(
          out,
          kind,
          x,
          y - 0.25,
          z,
          Math.atan2(gx * s, gz * s),
          0,
          1,
          1,
          1,
          hash2(i, j, seed + 4),
        );
      }
    // Lone farmsteads in the patchwork: a cottage and a barn squared to the field grid.
    const fields = this.fieldsIn(ox, oz, size);
    for (let q = 0; q < fields.length; q += 4) {
      const i = fields[q];
      const j = fields[q + 1];
      const x = fields[q + 2];
      const z = fields[q + 3];
      if (hash2(i, j, seed + 9) > L.farmsteads) continue;
      const kind = fieldKind(i, j);
      if (kind !== Field.Pasture && kind !== Field.Meadow) continue;
      if (!this.cellFarmed(i, j) || f.farm(x, z) < 0.5) continue;
      const y = f.height(x, z);
      if (y < 1.6 || this.slope(x, z, y) > 1.2 || !this.clear(out, x, z, 16)) continue;
      if (this.roadDist(x, z) < L.roadWidth + 8) continue;
      const yaw = L.fieldAngle + (hash2(i, j, seed + 10) > 0.5 ? Math.PI : 0);
      pushProp(out, P.Cottage, x, y - 0.25, z, yaw, 0, 1, 1, 1, hash2(i, j, seed + 11));
      const bx = x + Math.cos(L.fieldAngle) * 10;
      const bz = z - Math.sin(L.fieldAngle) * 10;
      const by = f.height(bx, bz);
      if (by > 1.4)
        pushProp(
          out,
          P.Barn,
          bx,
          by - 0.3,
          bz,
          yaw + Math.PI / 2,
          0,
          1,
          1,
          1,
          hash2(i, j, seed + 12),
        );
    }
    return out;
  }
}
