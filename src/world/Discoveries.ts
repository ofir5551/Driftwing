import { Config } from '../core/Config';
import type { LevelId } from '../levels/World';

/**
 * Discoveries: a few hidden moments per level (circle the lighthouse, skim a hoodoo's cap),
 * never on the opening ribbon, so following the wisps never stumbles on one. Finding one is a
 * chime and a burst of light in flight; its name waits for the Rest card, and the title's level
 * cards count them. Nothing is timed or missable (the day cycles, so night ones come round).
 *
 * Pure: the names live here (the menu reads them without building a world) and each level's
 * tests live beside its layout (`world/<level>/finds.ts`), so Vitest covers both in Node.
 */

export interface FindInfo {
  /** Unique across levels: `<level>.<key>` (saved in the journey). */
  readonly id: string;
  readonly name: string;
}

/** Every level's finds, in the order its card's marks show them. */
const NAMES = {
  highlands: {
    isle: 'Atop a floating isle',
    under: 'Beneath a floating isle',
    clouds: 'Above the clouds',
  },
  city: {
    crown: 'The crown of a tower',
    river: 'Up the river',
    shore: 'Across the bay',
  },
  karst: {
    pavilion: 'A summit pavilion',
    pillar: 'Round a stone pillar',
    paddies: 'The paddies by moonlight',
  },
  fjord: {
    lighthouse: 'Round the lighthouse',
    berg: "An iceberg's back",
    aurora: 'Under the aurora',
  },
  jerusalem: {
    dome: 'Over the golden dome',
    walls: 'Along the old walls',
    tower: 'Round a tower',
  },
  canyon: {
    great: 'Over the Great Arch',
    arch: 'Through a far arch',
    hoodoo: "A hoodoo's cap",
  },
  peaks: {
    monastery: 'The monastery',
    hermitage: 'A hermitage lantern',
    stars: 'Among the stars',
  },
  atoll: {
    pier: 'Over the bungalows',
    fang: "The fang's summit",
    moonlit: 'Round the fang by moonlight',
  },
  ringmoon: {
    ship: 'Round the old ship',
    back: "Along the ship's back",
    beacon: "Round a beacon's rings",
  },
} as const satisfies Record<LevelId, Record<string, string>>;

type Names = typeof NAMES;
type FindKey<L extends LevelId> = keyof Names[L] & string;

const finds = (level: LevelId): FindInfo[] =>
  Object.entries(NAMES[level]).map(([key, name]) => ({ id: `${level}.${key}`, name }));
export const LEVEL_FINDS: Record<LevelId, readonly FindInfo[]> = {
  highlands: finds('highlands'),
  city: finds('city'),
  karst: finds('karst'),
  fjord: finds('fjord'),
  jerusalem: finds('jerusalem'),
  canyon: finds('canyon'),
  peaks: finds('peaks'),
  atoll: finds('atoll'),
  ringmoon: finds('ringmoon'),
};

const BY_ID = new Map<string, FindInfo>(
  Object.values(LEVEL_FINDS).flatMap((list) => list.map((f) => [f.id, f] as const)),
);
export const isFindId = (v: unknown): v is string => typeof v === 'string' && BY_ID.has(v);
export const findName = (id: string): string => BY_ID.get(id)?.name ?? id;

/** Where an orbit is centred (written by an `around` test). */
export interface Pivot {
  x: number;
  z: number;
}

/** How a find is noticed. Tests are evaluated a few times a second, never per frame. */
export interface FindTest {
  /** Only after dark (the sky's stars past `Config.discoveries.night`). */
  readonly night?: boolean;
  /** Seconds the condition must hold unbroken (default: the moment it holds). */
  readonly dwell?: number;
  /** Found where this holds. */
  readonly at?: (x: number, y: number, z: number) => boolean;
  /**
   * Found after one full turn, either way, round the pivot this writes; it returns whether the
   * bird is within the orbit's band at all (leaving it starts the turn again).
   */
  readonly around?: (x: number, y: number, z: number, pivot: Pivot) => boolean;
}

export interface DiscoveryDef extends FindInfo, FindTest {}

/**
 * An `around` test for orbits round one of many things (pillars, towers, beacons): it keeps
 * the one being circled while the bird stays in its band, and only then picks the nearest, so
 * a neighbour coming closer mid-turn doesn't start the turn over.
 */
export function orbitAny<T>(
  pick: (x: number, z: number) => T | null,
  inBand: (t: T, x: number, y: number, z: number) => boolean,
  centre: (t: T, out: Pivot) => void,
): NonNullable<FindTest['around']> {
  let current: T | null = null;
  return (x, y, z, out) => {
    if (current === null || !inBand(current, x, y, z)) {
      current = pick(x, z);
      if (current === null || !inBand(current, x, y, z)) {
        current = null;
        return false;
      }
    }
    centre(current, out);
    return true;
  };
}

/** A level's finds: its names joined to its tests (every name needs a test, and only those). */
export function defineFinds<L extends LevelId>(
  level: L,
  tests: Record<FindKey<L>, FindTest>,
): DiscoveryDef[] {
  return LEVEL_FINDS[level].map((info) => {
    const key = info.id.slice(level.length + 1) as FindKey<L>;
    return { ...info, ...tests[key] };
  });
}

const TAU = Math.PI * 2;
const pivot: Pivot = { x: 0, z: 0 };

/**
 * Watches the bird for the current level's finds. Its scratch arrays are sized once per level,
 * and a step allocates nothing.
 */
export class DiscoveryTracker {
  /** Already found (in an earlier flight): never tested again. */
  known: (id: string) => boolean = () => false;
  private defs: readonly DiscoveryDef[] = [];
  private done: boolean[] = [];
  private held: number[] = [];
  /** Signed angle turned round the current pivot, the last angle and that pivot. */
  private turned: number[] = [];
  private lastAng: number[] = [];
  private px: number[] = [];
  private pz: number[] = [];
  /** Seconds since the last look. */
  private since = 0;

  setLevel(defs: readonly DiscoveryDef[]): void {
    this.defs = defs;
    const n = defs.length;
    this.done = new Array<boolean>(n).fill(false);
    this.held = new Array<number>(n).fill(0);
    this.turned = new Array<number>(n).fill(0);
    this.lastAng = new Array<number>(n).fill(NaN);
    this.px = new Array<number>(n).fill(NaN);
    this.pz = new Array<number>(n).fill(NaN);
    this.since = 0;
  }

  /** Forget turns and dwells in progress (a new flight; the bird may have been moved). */
  restart(): void {
    this.held.fill(0);
    this.turned.fill(0);
    this.lastAng.fill(NaN);
  }

  /** Advance by dt seconds at the bird's position; returns a find made now, or null. */
  step(dt: number, x: number, y: number, z: number, stars: number): DiscoveryDef | null {
    this.since += dt;
    if (this.since < Config.discoveries.every) return null;
    const span = this.since;
    this.since = 0;
    const night = stars >= Config.discoveries.night;
    for (let i = 0; i < this.defs.length; i++) {
      const d = this.defs[i];
      if (this.done[i] || this.known(d.id)) continue;
      if (d.night && !night) {
        this.held[i] = 0;
        continue;
      }
      if (d.at) {
        if (!d.at(x, y, z)) {
          this.held[i] = 0;
          continue;
        }
        this.held[i] += span;
        if (this.held[i] < (d.dwell ?? 0)) continue;
      } else if (d.around) {
        if (!this.orbit(i, d, x, y, z)) continue;
      } else continue;
      this.done[i] = true;
      return d;
    }
    return null;
  }

  /** One look along an orbit: true once a full turn has been made round the same pivot. */
  private orbit(i: number, d: DiscoveryDef, x: number, y: number, z: number): boolean {
    if (!d.around!(x, y, z, pivot)) {
      this.turned[i] = 0;
      this.lastAng[i] = NaN;
      return false;
    }
    // A different pivot (the bird left one pillar's orbit for the next) starts over.
    if (Math.hypot(pivot.x - this.px[i], pivot.z - this.pz[i]) > 2 || Number.isNaN(this.px[i])) {
      this.px[i] = pivot.x;
      this.pz[i] = pivot.z;
      this.turned[i] = 0;
      this.lastAng[i] = NaN;
    }
    const ang = Math.atan2(x - pivot.x, z - pivot.z);
    const last = this.lastAng[i];
    this.lastAng[i] = ang;
    if (Number.isNaN(last)) return false;
    // The smallest signed step between the two angles; a turn one way then back cancels out.
    let da = ang - last;
    da -= TAU * Math.round(da / TAU);
    this.turned[i] += da;
    return Math.abs(this.turned[i]) >= TAU;
  }
}
