import { hash2 } from '../noise';
import { landmarkName } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import { walkDestinations } from '../walk';
import type { FjordLayout } from './FjordLayout';
import type { Fall, Village } from './FjordSites';

const VILLAGE_FIRST = ['Gull', 'Seal', 'Herring', 'Birch', 'Eider', 'Fern', 'Rune', 'Tern', 'Elk'];
const VILLAGE_KIND = ['Harbour', 'Haven', 'Wick', 'Landing'];
const FALL_FIRST = ['Bride', 'Silver', 'Raven', 'Seven', 'Mist', 'Thunder', 'Echo', 'Snow'];
const FALL_KIND = ['Falls', 'Falls', 'Force', 'Veil'];
/** m beyond the fjord's half width within which a site counts as beside the walk. */
const BESIDE = 90;

/**
 * Aurora Fjords' journeys lead down the fjord the bird is on (as the canyons' to their arches)
 * to the next fishing village on its strand or waterfall down its wall (never the lighthouse:
 * a hidden find). The beacon rises from the village or the waterfall's foot; the cairn and its
 * stray stand on the strand at the village's end or by the stream's mouth.
 */
export function fjordDestinations(L: FjordLayout): DestinationSource {
  const villages: Village[] = [];
  const falls: Fall[] = [];
  return walkDestinations({
    heading: (x, z, yaw) => L.heading(x, z, yaw),
    toCentre: (x, z, out) => L.toCentre(x, z, out),
    inside: (x, z) => L.fjord(x, z) < 0,
    near: (x, z, out) => {
      L.fjord(x, z);
      const reach = L.fw + BESIDE;
      for (const v of L.sites.gather(x, z, reach, villages)) {
        if (v.home) continue;
        const d = Math.hypot(v.x - x, v.z - z);
        if (d > reach) continue;
        const ex = v.x + v.ux * (v.span + 10);
        const ez = v.z + v.uz * (v.span + 10);
        out.push({
          id: `fjord-village:${Math.round(v.x)},${Math.round(v.z)}`,
          name: landmarkName(v.seed, VILLAGE_FIRST, VILLAGE_KIND),
          x: v.x,
          z: v.z,
          y: Math.max(L.ground(v.x, v.z), 0),
          top: Math.max(L.ground(v.x, v.z), 0) + 30,
          r: d + 50,
          roost: {
            x: ex,
            y: Math.max(L.ground(ex, ez), 0),
            z: ez,
            yaw: Math.atan2(-v.vx, -v.vz),
          },
        });
      }
      for (const f of L.sites.gatherFalls(x, z, reach, falls)) {
        const d = Math.hypot(f.x2 - x, f.z2 - z);
        if (d > reach) continue;
        const rx = f.x2 + f.nx * 4;
        const rz = f.z2 + f.nz * 4;
        out.push({
          id: `fjord-fall:${Math.round(f.x1)},${Math.round(f.z1)}`,
          name: landmarkName(hash2(Math.round(f.x1), Math.round(f.z1), 751), FALL_FIRST, FALL_KIND),
          x: f.x1,
          z: f.z1,
          y: Math.max(L.ground(f.x1, f.z1), 0),
          top: L.ground(f.x0, f.z0) + 10,
          r: Math.hypot(f.x1 - x, f.z1 - z) + 50,
          roost: { x: rx, y: Math.max(L.ground(rx, rz), 0), z: rz, yaw: Math.atan2(-f.nx, -f.nz) },
        });
      }
    },
  });
}
