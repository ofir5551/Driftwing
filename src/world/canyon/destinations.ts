import { Config } from '../../core/Config';
import { clamp } from '../../core/math';
import { FLOCK_TINTS } from '../flockTints';
import type { Destination, DestinationSource } from '../Destinations';
import type { Arch, CanyonLayout } from './CanyonLayout';
import { throughLight } from '../landmarks';

/** m between steps of the walk down a canyon. */
const STEP = 20;
/** Every this many steps the walk leaves a point on the route (40 m apart). */
const KEEP = 2;
/** An arch within this far (m) of the canyon's centre line stands across it. */
const ON_LINE = 45;

/** Arch names are a first word and a kind, picked by the arch's own seed (so each keeps its name). */
const FIRST = [
  'Raven',
  'Saddle',
  'Keyhole',
  'Echo',
  'Sunrise',
  'Swallow',
  'Lantern',
  'Juniper',
  'Cradle',
  'Ember',
  'Sentinel',
  'Turret',
  'Owl',
  'Hidden',
  'Long Bow',
  'Wind',
  'Ghost',
  'Thunder',
  'Morning',
  'Coyote',
  'Cedar',
  'Bell',
  'Fiddle',
  'Horseshoe',
  'Needle',
  'Crow',
  'Hawk',
  'Cliffrose',
  'Sage',
  'Moonrise',
];
const KIND = ['Arch', 'Arch', 'Gate', 'Window', 'Bridge'];

function archName(seed: number): string {
  const k = Math.floor(seed * FIRST.length * KIND.length);
  return `${FIRST[k % FIRST.length]} ${KIND[Math.floor(k / FIRST.length) % KIND.length]}`;
}

const archId = (a: Arch) => `canyon:${Math.round(a.x)},${Math.round(a.z)}`;

/**
 * Red Canyons' journeys lead down the canyons to their arches. From the bird, the walk snaps
 * to the nearest canyon's centre line and follows it the way the bird faces until it meets a
 * canyon arch far enough along: the first of a flight a little under a minute away, later ones
 * a minute or two. Only ahead: a destination behind would turn the ribbon back past the bird,
 * so with none ahead in reach there is none for now, and the tracker asks again further on.
 * The route is the canyon's centre line, so the canyon planner's ribbons, leaning along it, run
 * down the floor and thread the arch at the end. The Great Arch is never a destination: the
 * opening ribbon threads it seconds from the spawn.
 */
export function canyonDestinations(L: CanyonLayout): DestinationSource {
  const c = { x: 0, z: 0 };
  const route: number[] = [];

  return {
    next(x, z, yaw, first, skip) {
      const K = Config.destinations;
      for (let i = 0; i < 8; i++) {
        L.toCentre(x, z, c);
        x = c.x;
        z = c.z;
      }
      // The snap must land on a canyon floor (from far out on the plateau it can wander).
      if (L.canyon(x, z) > -L.cw * 0.5) return null;
      const min = first ? K.firstRoute : K.minRoute;
      let h = L.heading(x, z, yaw);
      route.length = 0;
      route.push(x, z);
      for (let d = STEP, i = 1; d <= K.maxRoute; d += STEP, i++) {
        h = L.heading(x, z, h);
        x += Math.sin(h) * STEP;
        z += Math.cos(h) * STEP;
        L.toCentre(x, z, c);
        x = c.x;
        z = c.z;
        if (i % KEEP === 0) route.push(x, z);
        if (d < min) continue;
        for (const a of L.nearArches(x, z)) {
          if (!a.canyon || a === L.great || skip.has(archId(a))) continue;
          if (Math.hypot(a.x - x, a.z - z) > ON_LINE) continue;
          route.push(a.x, a.z);
          return arrival(L, a, Float64Array.from(route));
        }
      }
      return null;
    },
  };
}

/**
 * The cairn stands on the floor inside the opening, beside one leg, out of the river and clear
 * of the ribbon (which threads the middle, high): seen framed in the arch on the way in.
 */
function roostAt(L: CanyonLayout, a: Arch) {
  const c = Math.cos(a.yaw);
  const s = Math.sin(a.yaw);
  const side = a.seed < 0.5 ? -1 : 1;
  const u = side * clamp(Math.max(L.river(a.x, a.z) + 6, a.r * 0.62), 0, a.r - 4);
  // Along the opening's width: inArch measures it as dx cos(yaw) - dz sin(yaw).
  const x = a.x + u * c;
  const z = a.z - u * s;
  return { x, y: Math.max(L.ground(x, z), 0), z, yaw: a.yaw + side * 0.9 };
}

function arrival(L: CanyonLayout, a: Arch, route: Float64Array): Destination {
  return {
    id: archId(a),
    name: archName(a.seed),
    x: a.x,
    y: a.y0,
    z: a.z,
    route,
    roost: roostAt(L, a),
    tint: Math.floor(((a.seed * 7.31) % 1) * FLOCK_TINTS.length),
    // Through the light, which stands in the opening: the ribbons thread its middle.
    reached: throughLight(a.x, a.y0, a.z),
  };
}
