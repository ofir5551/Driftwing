import { Config } from '../../core/Config';
import type { LandField } from '../Terrain';

/**
 * The Highlands' plan, pure (no Three scene): the field patchwork (a rotated grid of fields,
 * each a crop from an integer hash the terrain shader shares), which cells are farmed, and the
 * dirt road along every river. Tested in Node.
 */

/** Crops, in the shader's order (Meadow is left unpainted). */
export const Field = { Wheat: 0, Pasture: 1, Plough: 2, Rows: 3, Rapeseed: 4, Meadow: 5 } as const;
export type Field = (typeof Field)[keyof typeof Field];

/** Grid coordinates (in cells, fractional) of world x,z on the rotated field grid. */
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

/** World x,z of the centre of field (i, j): the inverse rotation. */
export function fieldCentre(i: number, j: number, out: { x: number; z: number }) {
  const L = Config.highlands;
  const c = Math.cos(L.fieldAngle);
  const s = Math.sin(L.fieldAngle);
  const u = (i + 0.5) * L.fieldCell;
  const w = (j + 0.5) * L.fieldCell;
  out.x = u * c + w * s;
  out.z = -u * s + w * c;
  return out;
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

export class HighlandsLayout {
  private readonly farmed = new Map<number, boolean>();

  constructor(readonly field: LandField) {}

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

  /** Metres from the middle of the road (along one bank of every river); large when far. */
  roadDist(x: number, z: number): number {
    return Math.abs(this.field.riverDist(x, z) - Config.highlands.roadOffset);
  }
}
