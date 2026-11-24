import { Config } from '../core/Config';
import { angleDelta } from '../core/math';
import type { Destination, DestinationSource } from './Destinations';
import { FLOCK_TINTS } from './flockTints';

/** A place a journey can lead to, as a level describes it (pure data). */
export interface Landmark {
  /** Unique and stable per landmark (from its position or grid cell). */
  id: string;
  name: string;
  x: number;
  z: number;
  /** The lit cairn's spot (ground) and which way its stray faces. */
  roost: { x: number; y: number; z: number; yaw: number };
  /**
   * Metres to one side of (x, z) that the route ends, and the beacon stands (default 0): for a
   * landmark the bird should pass beside, not through or under (a floating isle's rock).
   */
  aside?: number;
  /** Where the route ends and the beacon stands instead: an open way in, by the landmark. */
  end?: { x: number; z: number };
}

/** A level's landmarks within `radius` of (x, z), pushed into `out` (cleared by the caller). */
export type LandmarkQuery = (x: number, z: number, radius: number, out: Landmark[]) => void;

/** m between route points. */
const STEP = 40;
/** Half angle (radians) of the cone ahead of the bird searched first. */
const CONE = 0.9;

/** A small stable hash of a string (picks a landmark's stray plumage from its id). */
function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Journeys for an open level: the landmark ahead of the bird (within a cone, then anywhere)
 * nearest the wanted distance (about 1.3x the least), and a straight route to it. The beacon
 * stands where the route ends (at the landmark, beside it or at its way in), and arriving is
 * flying through its light. The level's
 * planner leans its ribbons along the route; on open ground (unlike the canyons' walls) a
 * straight line is a fine way there. A landmark behind the bird is taken only if none lies
 * ahead, so the ribbon rarely has to turn round.
 */
export function landmarkDestinations(
  query: LandmarkQuery,
  /** Ground (or water) height, for the beacon's foot. */
  ground: (x: number, z: number) => number,
): DestinationSource {
  const found: Landmark[] = [];
  /** Names handed out lately: two different landmarks may share one, but never in a row. */
  const recent: string[] = [];
  const pick = (
    x: number,
    z: number,
    yaw: number,
    min: number,
    cone: number,
    skip: ReadonlySet<string>,
  ): Landmark | null => {
    const want = min * 1.3;
    let best: Landmark | null = null;
    let bs = Infinity;
    for (const l of found) {
      if (skip.has(l.id) || recent.includes(l.name)) continue;
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < min || d > Config.destinations.maxRoute) continue;
      const off = Math.abs(angleDelta(yaw, Math.atan2(l.x - x, l.z - z)));
      if (off > cone) continue;
      const score = Math.abs(d - want) + off * 600;
      if (score < bs) {
        bs = score;
        best = l;
      }
    }
    return best;
  };
  return {
    next(x, z, yaw, first, skip) {
      const K = Config.destinations;
      const min = first ? K.firstRoute : K.minRoute;
      found.length = 0;
      query(x, z, K.maxRoute, found);
      const l =
        pick(x, z, yaw, min, CONE, skip) ??
        pick(x, z, yaw, min, Math.PI, skip) ??
        pick(x, z, yaw, min * 0.5, Math.PI, skip);
      if (!l) return null;
      recent.push(l.name);
      if (recent.length > 6) recent.shift();
      return toDestination(x, z, l, ground);
    },
  };
}

function toDestination(
  x: number,
  z: number,
  l: Landmark,
  ground: (x: number, z: number) => number,
): Destination {
  // The route's end: the landmark, or a point beside it (to the right of the way in).
  const run0 = Math.hypot(l.x - x, l.z - z) || 1;
  const a = l.aside ?? 0;
  const ex = l.end ? l.end.x : l.x - ((l.z - z) / run0) * a;
  const ez = l.end ? l.end.z : l.z + ((l.x - x) / run0) * a;
  const run = Math.hypot(ex - x, ez - z);
  const steps = Math.max(1, Math.round(run / STEP));
  const route = new Float64Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    route[i * 2] = x + ((ex - x) * i) / steps;
    route[i * 2 + 1] = z + ((ez - z) * i) / steps;
  }
  const y = ground(ex, ez);
  return {
    id: l.id,
    name: l.name,
    x: ex,
    y,
    z: ez,
    route,
    roost: l.roost,
    tint: hashId(l.id) % FLOCK_TINTS.length,
    reached: throughLight(ex, y, ez),
  };
}

/** Inside the beacon's column of light at (x, z), foot y: what arriving means. */
export function throughLight(x: number, y: number, z: number) {
  const K = Config.destinations;
  return (px: number, py: number, pz: number): boolean =>
    py > y - K.reachBelow && (px - x) ** 2 + (pz - z) ** 2 < K.reach * K.reach;
}

/**
 * A name from a landmark's own number: a first word and a kind, so each keeps its name and
 * neighbours rarely share one.
 */
export function landmarkName(
  n: number,
  first: readonly string[],
  kinds: readonly string[],
): string {
  const k = Math.floor(Math.abs(n) * first.length * kinds.length) % (first.length * kinds.length);
  return `${first[k % first.length]} ${kinds[Math.floor(k / first.length)]}`;
}
