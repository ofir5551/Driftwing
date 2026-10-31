import { Config } from './Config';

/**
 * The journey: light earned across every flight, and the milestones it opens (levels, species,
 * plumages, trails). Pure logic (no DOM, no storage) so it is unit-tested; main.ts loads and
 * saves it.
 *
 * Nothing here can go backwards. Light only grows, and an unlock once granted is kept for good,
 * even if a retune of `Config.unlocks` later raises its threshold above the player's light.
 */

export type UnlockId = keyof typeof Config.unlocks;
export type UnlockKind = 'level' | 'species' | 'plumage' | 'trail';

export interface Unlock {
  readonly id: UnlockId;
  readonly kind: UnlockKind;
  readonly name: string;
}

/** Every milestone. Level ids are the levels' own ids (the Highlands are always open). */
export const UNLOCKS: readonly Unlock[] = [
  { id: 'emberTrail', kind: 'trail', name: 'Ember trail' },
  { id: 'city', kind: 'level', name: 'Neon Bay' },
  { id: 'duskRosePlumage', kind: 'plumage', name: 'Dusk Rose plumage' },
  { id: 'karst', kind: 'level', name: 'Jade River' },
  { id: 'jadeMistTrail', kind: 'trail', name: 'Jade Mist trail' },
  { id: 'swallow', kind: 'species', name: 'Swallow' },
  { id: 'fjord', kind: 'level', name: 'Aurora Fjords' },
  { id: 'frostPlumage', kind: 'plumage', name: 'Frost plumage' },
  { id: 'jerusalem', kind: 'level', name: 'City of Gold' },
  { id: 'auroraTrail', kind: 'trail', name: 'Aurora trail' },
  { id: 'canyon', kind: 'level', name: 'Red Canyons' },
  { id: 'gildedPlumage', kind: 'plumage', name: 'Gilded plumage' },
  { id: 'crane', kind: 'species', name: 'Crane' },
];

const BY_ID = new Map<string, Unlock>(UNLOCKS.map((u) => [u.id, u]));
const isUnlockId = (v: unknown): v is UnlockId => typeof v === 'string' && BY_ID.has(v);

/** Light at which a milestone opens (read live, so the debug panel can retune the track). */
export const unlockAt = (id: UnlockId): number => Config.unlocks[id];

/** What is saved. Unknown granted ids (from a newer or older track) are dropped on load. */
export interface JourneyData {
  v: 1;
  light: number;
  granted: UnlockId[];
}

/** Reads saved data defensively: anything missing or malformed falls back to a fresh start. */
export function parseJourney(raw: unknown): JourneyData {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof JourneyData, unknown>
  >;
  const light =
    typeof o.light === 'number' && Number.isFinite(o.light) ? Math.max(0, Math.floor(o.light)) : 0;
  const granted = Array.isArray(o.granted) ? [...new Set(o.granted.filter(isUnlockId))] : [];
  return { v: 1, light, granted };
}

const NONE: readonly Unlock[] = [];

export class Journey {
  /** Lifetime light. */
  light = 0;
  /** Light earned since the current flight began. */
  flightLight = 0;
  /** Changed since the last save. */
  dirty = false;
  private readonly granted = new Set<UnlockId>();

  constructor(data?: JourneyData) {
    if (data) {
      this.light = data.light;
      for (const id of data.granted) this.granted.add(id);
    }
    // Milestones already passed but not recorded (a retune lowered one) open quietly.
    if (this.settle().length > 0) this.dirty = true;
  }

  /**
   * Adds light. Returns the milestones this crossed, lowest first (usually none: the shared
   * empty list, so a wisp pickup allocates nothing).
   */
  earn(amount: number): readonly Unlock[] {
    if (!(amount > 0)) return NONE;
    this.light += amount;
    this.flightLight += amount;
    this.dirty = true;
    return this.settle();
  }

  /** Opens a milestone regardless of light (levels already flown before the journey existed). */
  grant(id: string): boolean {
    if (!isUnlockId(id) || this.granted.has(id)) return false;
    this.granted.add(id);
    this.dirty = true;
    return true;
  }

  isUnlocked(id: UnlockId): boolean {
    return this.granted.has(id);
  }

  /** The next milestone still locked, lowest threshold first; null once the track is done. */
  next(): Unlock | null {
    let best: Unlock | null = null;
    for (const u of UNLOCKS)
      if (!this.granted.has(u.id) && (!best || unlockAt(u.id) < unlockAt(best.id))) best = u;
    return best;
  }

  /** How far light has come from the last milestone passed toward the next (0..1, 1 when done). */
  fraction(): number {
    const next = this.next();
    if (!next) return 1;
    let prev = 0;
    for (const u of UNLOCKS) {
      const at = unlockAt(u.id);
      if (at <= this.light && at > prev) prev = at;
    }
    const to = unlockAt(next.id);
    return to > prev ? Math.min(1, Math.max(0, (this.light - prev) / (to - prev))) : 1;
  }

  newFlight(): void {
    this.flightLight = 0;
  }

  toData(): JourneyData {
    return {
      v: 1,
      light: this.light,
      granted: UNLOCKS.filter((u) => this.granted.has(u.id)).map((u) => u.id),
    };
  }

  /** Grants every milestone the light has reached; returns the new ones (sorted by threshold). */
  private settle(): readonly Unlock[] {
    let opened: Unlock[] | null = null;
    for (const u of UNLOCKS) {
      if (this.granted.has(u.id) || unlockAt(u.id) > this.light) continue;
      this.granted.add(u.id);
      (opened ??= []).push(u);
    }
    if (!opened) return NONE;
    return opened.sort((a, b) => unlockAt(a.id) - unlockAt(b.id));
  }
}
