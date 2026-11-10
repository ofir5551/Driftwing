import type { UnlockId } from '../core/Journey';

/**
 * A wingtip trail's colours (sRGB hex). `tip` is the colour at the wingtip, `tail` at the far
 * end of the ribbon. `drift` > 0 makes the colour wander between the two along the ribbon and
 * over time instead (the aurora). `flowTint` is how far the ribbon warms toward the wisp colour
 * as flow builds: the plain white trail shows flow fully, coloured trails keep their own hue.
 * Pure data: the menu reads it for swatches, `Trails` for its uniforms.
 */
export type TrailId = 'breeze' | 'ember' | 'jadeMist' | 'aurora';

export interface TrailDef {
  readonly id: TrailId;
  readonly name: string;
  /** The journey milestone that opens it; null for the starting trail. */
  readonly unlock: UnlockId | null;
  readonly tip: string;
  readonly tail: string;
  readonly drift: number;
  readonly flowTint: number;
}

export const TRAILS: readonly TrailDef[] = [
  {
    id: 'breeze',
    name: 'Breeze',
    unlock: null,
    tip: '#ffffff',
    tail: '#ffffff',
    drift: 0,
    flowTint: 0.6,
  },
  {
    id: 'ember',
    name: 'Ember',
    unlock: 'emberTrail',
    tip: '#ffd9a0',
    tail: '#ff6a3d',
    drift: 0,
    flowTint: 0.2,
  },
  {
    id: 'jadeMist',
    name: 'Jade Mist',
    unlock: 'jadeMistTrail',
    tip: '#e2fff2',
    tail: '#4fd1a0',
    drift: 0,
    flowTint: 0.2,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    unlock: 'auroraTrail',
    tip: '#7dffc4',
    tail: '#b58cff',
    drift: 1,
    flowTint: 0.15,
  },
];

export const DEFAULT_TRAIL: TrailId = 'breeze';

export const isTrailId = (v: unknown): v is TrailId => TRAILS.some((t) => t.id === v);

export const trailDef = (id: TrailId): TrailDef => TRAILS.find((t) => t.id === id) ?? TRAILS[0];
