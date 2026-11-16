import { smoothstep } from '../../core/math';

/** Sea of Clouds' spire silhouettes (pure): the layout, the skin and the meshes share them. */

/** A spire silhouette, in base radii: a tapering column with tiers and a summit dome. */
export interface SpireShape {
  /** Height over base radius before the per-spire stretch. */
  aspect: number;
  /** How much the column narrows toward the top. */
  taper: number;
  /** Ledges where the column steps in (granite breaking along its horizontal joints). */
  tiers: number;
  /** Radius lost over all the tiers. */
  step: number;
  /** Fraction of the height where the summit dome starts. */
  cap: number;
  /** Dome flatness: 2 is round, higher is a flat top with a rounded edge. */
  flat: number;
  /** Top offset as a fraction of the height. */
  lean: number;
}

export const SHAPES: SpireShape[] = [
  { aspect: 4.2, taper: 0.18, tiers: 0, step: 0, cap: 0.94, flat: 6, lean: 0.02 }, // column
  { aspect: 6.4, taper: 0.6, tiers: 0, step: 0, cap: 0.85, flat: 1.7, lean: 0.05 }, // needle
  { aspect: 3.6, taper: 0.1, tiers: 3, step: 0.42, cap: 0.93, flat: 5, lean: 0 }, // tiered tower
  { aspect: 2.6, taper: 0.25, tiers: 1, step: 0.2, cap: 0.8, flat: 3.5, lean: 0 }, // massif
  { aspect: 4.8, taper: 0.38, tiers: 1, step: 0.18, cap: 0.9, flat: 3, lean: 0.12 }, // leaning
];

/** Column, the shape the gate spires use. */
export const COLUMN = 0;

/**
 * Radius at fraction t of the height, in base radii. The mesh is lathed from this and the
 * collisions test against it, so the bird meets the rock where it is drawn. Non-increasing in t
 * above the flared foot, which the summit query's bisection relies on.
 */
export function profile(sh: SpireShape, t: number): number {
  if (t >= 1) return 0;
  const foot = t < 0.06 ? 1 + 0.12 * (1 - t / 0.06) : 1;
  let r = foot * (1 - sh.taper * t);
  if (sh.tiers > 0) {
    // Stairs: flat runs, then a quick step in at each joint.
    const s = t * (sh.tiers + 1);
    const i = Math.floor(s);
    r *= 1 - (sh.step * (i + smoothstep(0.86, 1, s - i))) / (sh.tiers + 1);
  }
  if (t > sh.cap) {
    const q = (t - sh.cap) / (1 - sh.cap);
    r *= Math.sqrt(Math.max(0, 1 - Math.pow(q, sh.flat)));
  }
  return r;
}
