import type { Destination, DestinationSource } from '../Destinations';
import { Config } from '../../core/Config';
import { VENUE, type EdenLayout, type EdenSite } from './EdenLayout';
import { EDEN_PHOTOS } from './photos';

/** m between route points (as `landmarks`). */
const STEP = 40;
/** The strays' plumages (FLOCK_TINTS): Tal in slate, Hadar in rose. */
const TAL_TINT = 1;
const HADAR_TINT = 6;

interface Stop {
  readonly id: string;
  readonly name: string;
  readonly message: string;
  /** Where the beacon stands (the route's end). */
  readonly ex: number;
  readonly ez: number;
  readonly y: number;
  readonly roost: Destination['roost'];
  readonly tint: number;
}

/**
 * Eden's journeys, always in this order: to Tal's picture, to Hadar's, then to the venue for
 * the two of them. Each flight starts the story again. Once all three are reached, the
 * Highlands' own journeys (its floating isles) take over. Pure.
 */
export function edenDestinations(layout: EdenLayout, after: DestinationSource): DestinationSource {
  const [tal, hadar, venue] = EDEN_PHOTOS;
  const v = layout.toWorld(VENUE.beacon.u, VENUE.beacon.v);
  const stops: Stop[] = [
    photoStop(layout.tal, tal.id, "Tal's Meadow", `Tal ${tal.line}`, TAL_TINT),
    photoStop(layout.hadar, hadar.id, "Hadar's Garden", `Hadar ${hadar.line}`, HADAR_TINT),
    {
      id: venue.id,
      name: 'Eden',
      message: venue.line,
      ex: v.x,
      ez: v.z,
      y: layout.venue.y,
      // The place itself is the end: no cairn, and the two of them are already with you.
      roost: null,
      tint: -1,
    },
  ];
  return {
    next(x, z, yaw, first, skip) {
      const s = stops.find((st) => !skip.has(st.id));
      return s ? toDestination(x, z, s) : after.next(x, z, yaw, first, skip);
    },
  };
}

/**
 * A picture's stop: the beacon stands on the lawn before the picture and off to the right of
 * the way in, so the bird sees the picture ahead as it comes and passes beside it, not into
 * it. The cairn with the stray stands at the picture's foot.
 */
function photoStop(S: EdenSite, id: string, name: string, message: string, tint: number): Stop {
  const fx = Math.sin(S.yaw); // toward the bird
  const fz = Math.cos(S.yaw);
  // Arriving, the bird faces (-fx, -fz); its right is (fz, -fx).
  const rx = fz;
  const rz = -fx;
  return {
    id,
    name,
    message,
    ex: S.x + fx * 30 + rx * 24,
    ez: S.z + fz * 30 + rz * 24,
    y: S.y,
    roost: { x: S.x + fx * 7 - rx * 5, y: S.y, z: S.z + fz * 7 - rz * 5, yaw: S.yaw },
    tint,
  };
}

function toDestination(x: number, z: number, s: Stop): Destination {
  const run = Math.hypot(s.ex - x, s.ez - z);
  const steps = Math.max(1, Math.round(run / STEP));
  const route = new Float64Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    route[i * 2] = x + ((s.ex - x) * i) / steps;
    route[i * 2 + 1] = z + ((s.ez - z) * i) / steps;
  }
  return {
    id: s.id,
    name: s.name,
    message: s.message,
    x: s.ex,
    y: s.y,
    z: s.ez,
    route,
    roost: s.roost,
    tint: s.tint,
    reached: reachedAt(s.ex, s.y, s.ez),
  };
}

/**
 * Through the beacon's light, as everywhere, but a wider column: this is a story to be told,
 * not a course to fly, so passing close by counts.
 */
function reachedAt(x: number, y: number, z: number) {
  return (px: number, py: number, pz: number): boolean => {
    const r = Config.eden.reach;
    return py > y - Config.destinations.reachBelow && (px - x) ** 2 + (pz - z) ** 2 < r * r;
  };
}
