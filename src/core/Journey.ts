import { Config } from './Config';
import type { LevelId } from '../levels/World';

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

/**
 * Every milestone. Level ids are the levels' own ids (the Highlands are always open). Only
 * what can be used goes on the track: the birds (`species`) join it when they can be flown.
 */
export const UNLOCKS: readonly Unlock[] = [
  { id: 'emberTrail', kind: 'trail', name: 'Ember trail' },
  { id: 'city', kind: 'level', name: 'Neon Bay' },
  { id: 'swallow', kind: 'species', name: 'Swallow' },
  { id: 'karst', kind: 'level', name: 'Jade River' },
  { id: 'duskRosePlumage', kind: 'plumage', name: 'Dusk Rose plumage' },
  { id: 'jadeMistTrail', kind: 'trail', name: 'Jade Mist trail' },
  { id: 'fjord', kind: 'level', name: 'Aurora Fjords' },
  { id: 'frostPlumage', kind: 'plumage', name: 'Frost plumage' },
  { id: 'crane', kind: 'species', name: 'Crane' },
  { id: 'jerusalem', kind: 'level', name: 'City of Gold' },
  { id: 'auroraTrail', kind: 'trail', name: 'Aurora trail' },
  { id: 'canyon', kind: 'level', name: 'Red Canyons' },
  { id: 'gildedPlumage', kind: 'plumage', name: 'Gilded plumage' },
  { id: 'phoenix', kind: 'species', name: 'Phoenix' },
];

const BY_ID = new Map<string, Unlock>(UNLOCKS.map((u) => [u.id, u]));

/** Milestones added to the track after saves began recording what they had seen. */
const ADDED_LATER: ReadonlySet<string> = new Set(['swallow', 'crane', 'phoenix']);
/** The track as it stood before saves recorded what they had seen. */
const LEGACY_SEEN: readonly UnlockId[] = UNLOCKS.map((u) => u.id).filter(
  (id) => !ADDED_LATER.has(id),
);
export const isUnlockId = (v: unknown): v is UnlockId => typeof v === 'string' && BY_ID.has(v);

/** Light at which a milestone opens (read live, so the debug panel can retune the track). */
export const unlockAt = (id: UnlockId): number => Config.unlocks[id];

/** What is saved. Unknown granted ids (from a newer or older track) are dropped on load. */
export interface JourneyData {
  v: 1;
  light: number;
  granted: UnlockId[];
  /** Unlocks already shown on a Rest card (each is shown once). */
  revealed: UnlockId[];
  /** Every milestone on the track when this was saved. One added since (a new bird) that the
   *  light has already passed still gets its card; one a retune lowered opens quietly. */
  seen: UnlockId[];
}

/** Reads saved data defensively: anything missing or malformed falls back to a fresh start. */
export function parseJourney(raw: unknown): JourneyData {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof JourneyData, unknown>
  >;
  const light =
    typeof o.light === 'number' && Number.isFinite(o.light) ? Math.max(0, Math.floor(o.light)) : 0;
  const granted = Array.isArray(o.granted) ? [...new Set(o.granted.filter(isUnlockId))] : [];
  // Saves from before Rest cards existed have no list: their unlocks were already announced.
  const revealed = Array.isArray(o.revealed)
    ? [...new Set(o.revealed.filter(isUnlockId))]
    : [...granted];
  const seen = Array.isArray(o.seen) ? [...new Set(o.seen.filter(isUnlockId))] : [...LEGACY_SEEN];
  return { v: 1, light, granted, revealed, seen };
}

const NONE: readonly Unlock[] = [];

export class Journey {
  /** Lifetime light. */
  light = 0;
  /** Light earned since the current flight began. */
  flightLight = 0;
  /** Milestones opened by light during the current flight. */
  flightOpened = 0;
  /** Light and journey-bar fill when the current flight began (the Rest card fills on from there). */
  startLight = 0;
  startFraction = 0;
  /** Changed since the last save. */
  dirty = false;
  /** Every level, plumage and trail can be picked whatever the light (`?unlocked`, for
   *  testing). Never saved: nothing is granted, so the real journey is untouched. */
  allOpen = false;
  private readonly granted = new Set<UnlockId>();
  private readonly revealed = new Set<UnlockId>();

  constructor(data?: JourneyData) {
    const seen = new Set<UnlockId>(data ? data.seen : UNLOCKS.map((u) => u.id));
    if (data) {
      this.light = data.light;
      for (const id of data.granted) this.granted.add(id);
      for (const id of data.revealed) this.revealed.add(id);
    }
    // Milestones already passed but not recorded open now: quietly if a retune lowered one,
    // with a card still to come if it is new to the track (a bird added since the save).
    const quiet = this.settle();
    for (const u of quiet) if (seen.has(u.id)) this.revealed.add(u.id);
    if (quiet.length > 0 || UNLOCKS.some((u) => !seen.has(u.id))) this.dirty = true;
    this.newFlight();
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
    const opened = this.settle();
    this.flightOpened += opened.length;
    return opened;
  }

  /** Opens a milestone regardless of light (levels already flown before the journey existed). */
  grant(id: string): boolean {
    if (!isUnlockId(id) || this.granted.has(id)) return false;
    this.granted.add(id);
    this.revealed.add(id); // already the player's: nothing to announce
    this.dirty = true;
    return true;
  }

  isUnlocked(id: UnlockId): boolean {
    return this.granted.has(id);
  }

  /** A level can be picked once its milestone is passed; one off the track (the Highlands) always. */
  isLevelOpen(id: LevelId): boolean {
    return this.allOpen || !isUnlockId(id) || this.granted.has(id);
  }

  /** Whatever a milestone opens can be picked (null: no milestone, open from the start). */
  isOpen(id: UnlockId | null): boolean {
    return this.allOpen || id === null || this.granted.has(id);
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

  /** Unlocks not yet shown on a Rest card, lowest first: this flight's, and any from flights that
   *  ended without a rest (the tab closed, or back to the title). */
  unrevealed(): Unlock[] {
    return UNLOCKS.filter((u) => this.granted.has(u.id) && !this.revealed.has(u.id)).sort(
      (a, b) => unlockAt(a.id) - unlockAt(b.id),
    );
  }

  /** Marks every unlock as shown. */
  reveal(): void {
    for (const id of this.granted) {
      if (this.revealed.has(id)) continue;
      this.revealed.add(id);
      this.dirty = true;
    }
  }

  newFlight(): void {
    this.flightLight = 0;
    this.flightOpened = 0;
    this.startLight = this.light;
    this.startFraction = this.fraction();
  }

  toData(): JourneyData {
    const ids = (set: Set<UnlockId>) => UNLOCKS.filter((u) => set.has(u.id)).map((u) => u.id);
    return {
      v: 1,
      light: this.light,
      granted: ids(this.granted),
      revealed: ids(this.revealed),
      seen: UNLOCKS.map((u) => u.id),
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
