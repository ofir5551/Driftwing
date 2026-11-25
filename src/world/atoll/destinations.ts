import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { landmarkDestinations, landmarkName, type Landmark } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import type { AtollLayout } from './AtollLayout';

const ISLE_FIRST = ['Turtle', 'Frigate', 'Coconut', 'Pearl', 'Manta', 'Coral', 'Tern', 'Reef'];
const ISLE_KIND = ['Peak', 'Island', 'Fang', 'Crown'];
const VILLAGE_FIRST = ['Shell', 'Lagoon', 'Palm', 'Net', 'Canoe', 'Driftwood', 'Sandbar', 'Tide'];
const VILLAGE_KIND = ['Village', 'Landing', 'Cove'];

/**
 * Coral Atolls' journeys lead across the open sea to the next atoll: to its high island (the
 * beacon from the fang's summit, the cairn on its beach; the route ends beside the island) or,
 * without one, to its fishing village of stilt huts (the cairn on the sand behind). The home
 * atoll is the opening ribbon's, and its fang and bungalows are hidden finds: never a
 * destination.
 */
export function atollDestinations(L: AtollLayout): DestinationSource {
  const C = Config.atoll.cell;
  return landmarkDestinations(
    (x, z, R, out) => {
      for (let j = Math.floor((z - R) / C); j <= Math.floor((z + R) / C); j++)
        for (let i = Math.floor((x - R) / C); i <= Math.floor((x + R) / C); i++) {
          const A = L.atoll(i, j);
          if (!A || A.home) continue;
          const I = A.island;
          if (I) {
            // The cairn: on the island's shore, on the side toward the atoll's centre.
            const a = Math.atan2(A.x - I.x, A.z - I.z);
            // Walk in from the cone's foot to dry sand (the coast lies a little beyond it).
            let f = 1.3;
            while (
              f > 0.7 &&
              L.height(I.x + Math.sin(a) * I.r * f, I.z + Math.cos(a) * I.r * f) < 0.6
            )
              f -= 0.02;
            const rx = I.x + Math.sin(a) * I.r * f;
            const rz = I.z + Math.cos(a) * I.r * f;
            const l: Landmark = {
              id: `atoll-isle:${i},${j}`,
              name: landmarkName(hash2(i, j, 771), ISLE_FIRST, ISLE_KIND),
              x: I.tx,
              z: I.tz,
              aside: I.r + 35,
              roost: { x: rx, y: Math.max(L.height(rx, rz), 0.2), z: rz, yaw: a },
            };
            out.push(l);
            continue;
          }
          const V = A.village;
          if (!V) continue;
          // The cairn: on the sand behind the walkway's start.
          const rx = V.x - Math.sin(V.yaw) * 8;
          const rz = V.z - Math.cos(V.yaw) * 8;
          out.push({
            id: `atoll-village:${i},${j}`,
            name: landmarkName(hash2(i, j, 772), VILLAGE_FIRST, VILLAGE_KIND),
            x: V.x,
            z: V.z,
            roost: { x: rx, y: Math.max(L.height(rx, rz), 0.2), z: rz, yaw: V.yaw },
          });
        }
    },
    (x, z) => Math.max(L.height(x, z), 0),
  );
}
