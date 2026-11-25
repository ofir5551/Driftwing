import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { landmarkDestinations, landmarkName } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import type { RingmoonLayout } from './RingmoonLayout';

const FIRST = ['Halo', 'Ember', 'Tidewater', 'Moss', 'Glimmer', 'Basalt', 'Drift', 'Lumen', 'Kelp'];
const KIND = ['Outpost', 'Outpost', 'Camp', 'Station'];
/** Every this many prop cells (each way) is looked in: outposts are common, cells many. */
const SAMPLE = 3;

/**
 * Ringmoon Shallows' journeys lead to the explorers' outposts by their landing pods (never a
 * beacon tower or the ship: hidden finds). The beacon rises from the outpost, flying over it
 * arrives, and the cairn and its stray stand at the end of its lit path.
 */
export function ringmoonDestinations(L: RingmoonLayout): DestinationSource {
  const C = Config.ringmoon.propCell;
  return landmarkDestinations(
    (x, z, R, out) => {
      const i0 = Math.floor((x - R) / C / SAMPLE) * SAMPLE;
      const j0 = Math.floor((z - R) / C / SAMPLE) * SAMPLE;
      for (let j = j0; j <= (z + R) / C; j += SAMPLE)
        for (let i = i0; i <= (x + R) / C; i += SAMPLE) {
          const o = L.outpost(i, j);
          if (!o) continue;
          const P = o.path;
          // The cairn at the lit path's far end (or beside the outpost without one).
          const rx = P.length >= 4 ? P[P.length - 2] : o.x + 10;
          const rz = P.length >= 4 ? P[P.length - 1] : o.z;
          out.push({
            id: `outpost:${i},${j}`,
            name: landmarkName(hash2(i, j, 781), FIRST, KIND),
            x: o.x,
            z: o.z,
            roost: {
              x: rx,
              y: Math.max(L.height(rx, rz), 0),
              z: rz,
              yaw: Math.atan2(o.x - rx, o.z - rz),
            },
          });
        }
    },
    (x, z) => Math.max(L.height(x, z), 0),
  );
}
