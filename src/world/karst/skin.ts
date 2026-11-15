import { smoothstep } from '../../core/math';
import { createNoise2D, mulberry32, type Noise2D } from '../noise';
import { profile, SHAPES, type PillarShape } from './KarstLayout';

/**
 * The rock surface of one pillar silhouette (pure, no Three.js): the layout's radius profile
 * times smooth flutes and lumps. Every pillar mesh tier is lathed from this, and things that sit
 * on the rock (vines, wall shrubs) read it, so they touch the stone at any level of detail.
 * Lumps come from smooth noise on (angle, height), never a per-vertex random: every tier lathes
 * the same rock (no pop), and a fine mesh gets a smooth outline rather than a sawtooth. The angle
 * enters as a circle in noise space (or whole frequencies), so the seam closes.
 */
export class PillarSkin {
  private readonly ph: number;
  private readonly ph2: number;
  private readonly lumpy: Noise2D;

  constructor(
    readonly sh: PillarShape,
    seed: number,
  ) {
    const rand = mulberry32(seed);
    this.ph = rand() * 10;
    this.ph2 = rand() * 10;
    this.lumpy = createNoise2D(seed + 500);
  }

  /** How much the walls ripple at height fraction t (the summit dome is smoother). */
  rough(t: number): number {
    const sh = this.sh;
    return 1 - 0.6 * smoothstep(sh.cap - 0.1, sh.cap + 0.04, t);
  }

  /** Multiplier on the profile radius at height fraction t, local angle a. */
  flute(t: number, a: number): number {
    const n = this.lumpy;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return (
      1 +
      this.rough(t) *
        (0.07 * Math.sin(a * 5 + this.ph + t * 4) +
          0.04 * Math.sin(a * 11 + this.ph2 - t * 9) +
          0.05 * n(c * 1.6 + t * 3.1, s * 1.6 - t * 2.3) +
          0.025 * n(c * 3.4 - t * 7, s * 3.4 + t * 5))
    );
  }

  /** Surface radius in base radii at height fraction t, local angle a. */
  radius(t: number, a: number): number {
    return profile(this.sh, Math.max(t, 0)) * this.flute(t, a);
  }

  /** Phase of the rain-streak pattern (the vertex washes follow it). */
  get phase(): number {
    return this.ph;
  }

  get phase2(): number {
    return this.ph2;
  }
}

/** One skin per silhouette, seeded as the meshes are (70 + shape). */
export const SKINS: readonly PillarSkin[] = SHAPES.map((sh, i) => new PillarSkin(sh, 70 + i));
