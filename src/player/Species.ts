import { Config } from '../core/Config';
import type { UnlockId } from '../core/Journey';
import { SWALLOW_SHAPE, TERN_SHAPE, type BirdShape } from './BirdShape';
import type { PlumageId } from './Plumage';

/**
 * The birds a player can fly. Each is a body (`BirdShape`), a way of flying (its
 * `Config.species` entry, read live so the debug panel retunes it) and its own plumage, worn
 * when the bird is picked. A bird's signature is passive or its own version of an existing
 * trick, never a new gesture (phone first: see DESIGN's Species).
 */
export type SpeciesId = 'tern' | 'swallow';

export interface SpeciesDef {
  readonly id: SpeciesId;
  readonly name: string;
  /** What it does differently, in a line (the Aviary). */
  readonly blurb: string;
  /** The journey milestone that opens it; null for the starting bird. */
  readonly unlock: UnlockId | null;
  /** Its own plumage, put on when the bird is picked. */
  readonly plumage: PlumageId;
  readonly shape: BirdShape;
  readonly tuning: (typeof Config.species)[SpeciesId];
}

export const SPECIES: readonly SpeciesDef[] = [
  {
    id: 'tern',
    name: 'Tern',
    blurb: 'The all-rounder. Long glides and a deep dive-bomb.',
    unlock: null,
    plumage: 'sea',
    shape: TERN_SHAPE,
    tuning: Config.species.tern,
  },
  {
    id: 'swallow',
    name: 'Swallow',
    blurb: 'Quick, sharp turns. Its roll darts aside, and it speeds up skimming water.',
    unlock: 'swallow',
    plumage: 'swallow',
    shape: SWALLOW_SHAPE,
    tuning: Config.species.swallow,
  },
];

export const DEFAULT_SPECIES: SpeciesId = 'tern';

export const isSpeciesId = (v: unknown): v is SpeciesId => SPECIES.some((s) => s.id === v);

export const speciesDef = (id: SpeciesId): SpeciesDef =>
  SPECIES.find((s) => s.id === id) ?? SPECIES[0];
