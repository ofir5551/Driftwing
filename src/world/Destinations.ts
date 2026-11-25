import { Config } from '../core/Config';

/**
 * A flight's destination: a landmark far down the level that a beacon marks, that the wisps
 * lean toward, and that ends a journey when the bird reaches it. Pure data (no Three.js).
 */
export interface Destination {
  /** Unique per landmark (so a flight never sends the bird back to one it has reached). */
  readonly id: string;
  /** What the HUD and the Rest card call it ("Raven Arch"). */
  readonly name: string;
  /** Where the beacon stands: x, z and the foot of its beam. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * The way there, as x, z pairs from near where it was chosen to the landmark (the level's
   * natural line: a canyon's centre). Wisp planners lean their ribbons along it.
   */
  readonly route: Float64Array;
  /**
   * The lit cairn where its stray perches: ground point, and which way the bird faces. Null:
   * no cairn and no stray (a journey whose end is the place itself).
   */
  readonly roost: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
  } | null;
  /** What the arrival says (default "<name> reached"). */
  readonly message?: string;
  /** The stray's plumage (an index into the flock's tints; the save keeps it). */
  readonly tint: number;
  /** Has a bird at (x, y, z) arrived? Generous: through, under or over the landmark counts. */
  reached(x: number, y: number, z: number): boolean;
}

/** A level's destinations (`World.destinations`). */
export interface DestinationSource {
  /**
   * The next destination for a bird at (x, z) heading `yaw`, or null if none can be found
   * from here (the tracker asks again a little later). `first` is the flight's first journey,
   * which may be nearer; `skip` holds the ids already reached this flight.
   */
  next(
    x: number,
    z: number,
    yaw: number,
    first: boolean,
    skip: ReadonlySet<string>,
  ): Destination | null;
}

export type DestinationChange = 'set' | 'arrived' | null;

/**
 * The flight's journey state: one destination at a time, a pause after each arrival before the
 * next is chosen, and a quiet re-choice if the bird strays so far that the old one no longer
 * makes sense. Calm by design: nothing is timed, nothing is lost, and a missed approach is
 * just circling back.
 */
export class DestinationTracker {
  current: Destination | null = null;
  /** The destination last reached (set as `step` returns 'arrived'). */
  last: Destination | null = null;
  /** Names of the destinations reached this flight (the Rest card lists them). */
  readonly reachedNames: string[] = [];
  private source: DestinationSource | null = null;
  private readonly reachedIds = new Set<string>();
  private wait = 0;
  private first = true;

  /** A new level's source (null: the level has no destinations yet). */
  setSource(source: DestinationSource | null): void {
    this.source = source;
    this.current = null;
    this.restart();
  }

  /** A new flight: forget the old journey; the first destination appears after a moment. */
  restart(): void {
    this.current = this.last = null;
    this.reachedNames.length = 0;
    this.reachedIds.clear();
    this.first = true;
    this.wait = Config.destinations.firstDelay;
  }

  /**
   * Advance by dt at the bird's position. Returns 'set' when a new destination was chosen
   * (`current`), 'arrived' when the current one was reached (now `last`), or null.
   */
  step(dt: number, x: number, y: number, z: number, yaw: number): DestinationChange {
    const src = this.source;
    if (!src) return null;
    const cur = this.current;
    if (cur) {
      if (cur.reached(x, y, z)) {
        this.reachedNames.push(cur.name);
        this.reachedIds.add(cur.id);
        this.first = false;
        this.wait = Config.destinations.nextDelay;
        this.last = cur;
        this.current = null;
        return 'arrived';
      }
      // Wandered far off: the beacon would be a speck behind the hills. Choose afresh.
      if (Math.hypot(x - cur.x, z - cur.z) > Config.destinations.stray) {
        this.current = null;
        this.wait = 0;
      } else return null;
    }
    this.wait -= dt;
    if (this.wait > 0) return null;
    const d = src.next(x, z, yaw, this.first, this.reachedIds);
    if (!d) {
      this.wait = Config.destinations.retry;
      return null;
    }
    this.current = d;
    return 'set';
  }
}
