import { smoothstep } from '../../core/math';
import { mulberry32 } from '../noise';
import { profile, SHAPES, type SpireShape } from './profile';

/**
 * The granite surface of one spire silhouette (pure, no Three.js): the layout's radius profile
 * times what the rock does between its joints. Every spire mesh tier is lathed from this, and
 * whatever sits on the rock (ledge moss, cliff pines, alcove huts, the monastery stair) reads
 * it, so things touch the stone at any level of detail.
 *
 * Granite towers break along two sets of joints: horizontal sheeting joints, where the rock
 * above steps back to leave a ledge (only round part of the spire: a mask of whole angular
 * frequencies, so the seam closes) with a groove undercut just beneath it, and vertical
 * fractures weathered into chimneys. One joint per shape is a deep alcove under an overhang,
 * where a hermit can hang a hut. Everything here only cuts into the rock (the skin is at most a
 * hair over 1), so the collision profile, which is the skin's envelope, stays outside what is
 * drawn and the bird never passes through drawn stone.
 */

export interface Joint {
  /** Height fraction of the ledge. */
  t: number;
  /** Depth of the groove under it (base radii share). */
  notch: number;
  /** Half height of the groove (height fraction). */
  w: number;
  /** How far the rock above steps back, where the mask is full. */
  shelf: number;
  /** Height fraction over which the rock above leans back out to the full radius. */
  rise: number;
  /** Mask phases: the ledge runs round part of the spire. */
  ph: number;
  ph2: number;
}

export interface Crack {
  /** Local angle of the chimney (wanders with height). */
  a: number;
  /** Half width (radians). */
  w: number;
  /** Depth (base radii share). */
  d: number;
  ph: number;
}

/** The deep ledge under an overhang (a hut's alcove), centred on local angle `a`. */
export interface Alcove {
  joint: number;
  a: number;
  /** Half the arc it spans (radians). */
  arc: number;
  depth: number;
}

/** Height fraction just above a joint (the ledge's inner edge) and below it (its lip). */
export const LEDGE_EPS = 0.0025;

export class SpireSkin {
  readonly joints: Joint[] = [];
  readonly cracks: Crack[] = [];
  readonly alcove: Alcove;
  private readonly ph: number;

  constructor(
    readonly sh: SpireShape,
    seed: number,
  ) {
    const rand = mulberry32(seed);
    this.ph = rand() * 10;
    // The tiered shapes already step in at each tier (the profile): their ledges are joints too.
    const tiers: number[] = [];
    for (let i = 1; i <= sh.tiers; i++) tiers.push(i / (sh.tiers + 1));
    const lo = 0.16;
    const hi = sh.cap - 0.05;
    const n = 4 + Math.floor(rand() * 3);
    const ts: number[] = [...tiers];
    for (let j = 0; j < n; j++) {
      const t = lo + ((hi - lo) * (j + 0.5 + (rand() - 0.5) * 0.7)) / n;
      if (ts.every((u) => Math.abs(u - t) > 0.05)) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (const t of ts) {
      const tier = tiers.includes(t);
      this.joints.push({
        t,
        notch: 0.03 + rand() * 0.035,
        w: 0.006 + rand() * 0.006,
        // A tier already has its step; a little more round part of it.
        shelf: tier ? 0.03 + rand() * 0.03 : 0.05 + rand() * 0.05,
        rise: 0.025 + rand() * 0.035,
        ph: rand() * Math.PI * 2,
        ph2: rand() * Math.PI * 2,
      });
    }
    // The alcove: a mid-height joint that is not a tier (the tier's own step would show).
    const mids = this.joints
      .map((j, i) => ({ j, i }))
      .filter(({ j }) => j.t > 0.35 && j.t < sh.cap - 0.12 && !tiers.includes(j.t));
    const pick = mids.length ? mids[Math.floor(rand() * mids.length)] : { i: -1 };
    this.alcove = { joint: pick.i, a: rand() * Math.PI * 2, arc: 0.45 + rand() * 0.2, depth: 0.15 };
    const k = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < k; i++)
      this.cracks.push({
        a: ((i + 0.2 + rand() * 0.6) / k) * Math.PI * 2,
        w: 0.12 + rand() * 0.12,
        d: 0.05 + rand() * 0.05,
        ph: rand() * 10,
      });
  }

  /** How much of the joints' and cracks' cut shows at height fraction t (none on the dome). */
  private rough(t: number): number {
    const sh = this.sh;
    return smoothstep(0.02, 0.08, t) * (1 - smoothstep(sh.cap - 0.06, sh.cap + 0.02, t));
  }

  /** 0..1: how much of joint j's ledge there is at local angle a (whole frequencies: no seam). */
  ledgeMask(j: number, a: number): number {
    const J = this.joints[j];
    const s = 0.55 * Math.sin(a + J.ph) + 0.45 * Math.sin(3 * a + J.ph2);
    let m = smoothstep(0.2, 0.55, s);
    const A = this.alcove;
    if (A.joint === j) m = Math.max(m, 1 - smoothstep(A.arc * 0.6, A.arc, angleTo(a, A.a)));
    return m;
  }

  /** 0..1: how deep joint j's groove is at local angle a (it fades in and out round the rock). */
  grooveMask(j: number, a: number): number {
    const J = this.joints[j];
    return smoothstep(-0.3, 0.6, Math.sin(a * 2 + J.ph2 * 1.7) * 0.6 + Math.sin(a * 3 - J.ph) * 0.4);
  }

  /**
   * Height fraction the rock at (t, a) is lifted by: the joints dip a little across the spire
   * (the granite's sheeting is never quite level), so the ledges slope and wander instead of
   * ringing the rock. Zero at the foot and on the dome, so the summit query is unchanged.
   */
  lift(t: number, a: number): number {
    const w = smoothstep(0.03, 0.12, t) * (1 - smoothstep(this.sh.cap - 0.08, this.sh.cap - 0.02, t));
    return w * (0.02 * Math.sin(a + this.ph) + 0.01 * Math.sin(2 * a - this.ph * 1.3 + t * 6));
  }

  /** How far the rock above joint j steps back at angle a (base radii share). */
  shelfDepth(j: number, a: number): number {
    const A = this.alcove;
    const J = this.joints[j];
    const deep = A.joint === j ? (1 - smoothstep(A.arc * 0.5, A.arc, angleTo(a, A.a))) : 0;
    return (J.shelf + (A.depth - J.shelf) * deep) * this.ledgeMask(j, a) * this.rough(J.t);
  }

  /** Multiplier on the profile radius at height fraction t, local angle a. */
  skin(t: number, a: number): number {
    const r = this.rough(t);
    if (r <= 0) return 1 + 0.012 * Math.sin(3 * a + this.ph) * (1 - smoothstep(0.9, 1, t));
    let cut = 0;
    const A = this.alcove;
    for (let j = 0; j < this.joints.length; j++) {
      const J = this.joints[j];
      // The joint's groove, all round: the blocks' edges are rounded into it.
      const g = (t - J.t) / J.w;
      if (g > -1 && g < 1)
        cut += J.notch * (1 - g * g) * (1 - g * g) * (0.25 + 0.75 * this.grooveMask(j, a));
      // The ledge: the rock above stands back, then leans out to the full radius again.
      const u = (t - J.t) / (A.joint === j ? J.rise * 1.6 : J.rise);
      if (u >= 0 && u < 1) cut += this.shelfDepth(j, a) * (1 - smoothstep(0.1, 1, u));
    }
    for (const c of this.cracks) {
      const ca = c.a + 0.08 * Math.sin(t * 9 + c.ph);
      const x = angleTo(a, ca) / c.w;
      if (x < 1) cut += c.d * (1 - x * x) * (1 - x * x) * (0.6 + 0.4 * Math.sin(t * 13 + c.ph));
    }
    // Broad columns: the faces between the chimneys bulge a little.
    const lobe = 0.015 * Math.sin(3 * a + this.ph + t * 2) + 0.01 * Math.sin(5 * a - this.ph);
    return Math.min(1.02, 1 + lobe * r - cut * r);
  }

  /** Surface radius in base radii at height fraction t, local angle a. */
  radius(t: number, a: number): number {
    return profile(this.sh, Math.max(t, 0)) * this.skin(t, a);
  }
}

/** Unsigned angle between two angles, in [0, pi]. */
export function angleTo(a: number, b: number): number {
  const d = Math.abs((((a - b) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
  return d;
}

/** One skin per silhouette, seeded as the meshes are (90 + shape). */
export const SKINS: readonly SpireSkin[] = SHAPES.map((sh, i) => new SpireSkin(sh, 90 + i));
