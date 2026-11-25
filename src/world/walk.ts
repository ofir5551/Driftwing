import { Config } from '../core/Config';
import type { Destination, DestinationSource } from './Destinations';
import { throughLight, type Landmark } from './landmarks';
import { FLOCK_TINTS } from './flockTints';

/** A level whose natural ways are channels along a noise's zero contour (rivers, fjords). */
export interface Channels {
  /** Direction along the channel at (x, z), the one closer to `yaw`. */
  heading(x: number, z: number, yaw: number): number;
  /** One step from (x, z) toward the channel's centre line, into `out`. */
  toCentre(x: number, z: number, out: { x: number; z: number }): void;
  /** Is (x, z) in a channel (on the water)? */
  inside(x: number, z: number): boolean;
  /** Ground (or water) height, for the beacon's foot. */
  ground(x: number, z: number): number;
  /** Landmarks beside the channel near (x, z) (the walk's point), pushed into `out`. */
  near(x: number, z: number, out: Landmark[]): void;
}

/** m between steps of the walk. */
const STEP = 20;
/** Every this many steps the walk leaves a point on the route (40 m apart). */
const KEEP = 2;

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Journeys down the channel the bird is in (as Red Canyons' to its arches): snap to the nearest
 * centre line, walk along it the way the bird faces, and take the first landmark beside it far
 * enough along. The route is the centre line, the way the level's ribbons already run, and the
 * beacon stands on it beside the landmark: arriving is flying through its light. Only
 * ahead: with none in reach, none for now (the tracker asks again further on).
 */
export function walkDestinations(W: Channels): DestinationSource {
  const c = { x: 0, z: 0 };
  const route: number[] = [];
  const found: Landmark[] = [];
  const recent: string[] = [];
  return {
    next(x, z, yaw, first, skip) {
      const K = Config.destinations;
      for (let i = 0; i < 8; i++) {
        W.toCentre(x, z, c);
        x = c.x;
        z = c.z;
      }
      if (!W.inside(x, z)) return null;
      const min = first ? K.firstRoute : K.minRoute;
      let h = W.heading(x, z, yaw);
      route.length = 0;
      route.push(x, z);
      for (let d = STEP, i = 1; d <= K.maxRoute; d += STEP, i++) {
        h = W.heading(x, z, h);
        x += Math.sin(h) * STEP;
        z += Math.cos(h) * STEP;
        W.toCentre(x, z, c);
        x = c.x;
        z = c.z;
        if (i % KEEP === 0) route.push(x, z);
        if (d < min) continue;
        found.length = 0;
        W.near(x, z, found);
        for (const l of found) {
          if (skip.has(l.id) || recent.includes(l.name)) continue;
          recent.push(l.name);
          if (recent.length > 6) recent.shift();
          route.push(x, z);
          // The beacon stands on the channel beside the landmark, where the ribbons run.
          const y = W.ground(x, z);
          const dest: Destination = {
            id: l.id,
            name: l.name,
            x,
            y,
            z,
            route: Float64Array.from(route),
            roost: l.roost,
            tint: hashId(l.id) % FLOCK_TINTS.length,
            reached: throughLight(x, y, z),
          };
          return dest;
        }
      }
      return null;
    },
  };
}
