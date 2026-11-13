import { defineFinds, orbitAny, type DiscoveryDef } from '../Discoveries';
import type { Prop, RingmoonLayout } from './RingmoonLayout';

/** Ringmoon Shallows' finds: a turn round the ship, its back skimmed, a turn round a beacon. */
export function ringmoonFinds(L: RingmoonLayout): DiscoveryDef[] {
  const S = L.ship;
  return defineFinds('ringmoon', {
    // The first ribbon runs under the ship; this is all the way round it.
    ship: {
      around: (x, y, z, out) => {
        out.x = S.x;
        out.z = S.z;
        const d = Math.hypot(x - S.x, z - S.z);
        return d > 40 && d < 240 && y < S.y + S.c + 80;
      },
    },
    back: {
      at: (x, y, z) => {
        const t = L.shipTop(x, z);
        return y > t && y < t + 10;
      },
    },
    beacon: {
      around: orbitAny(
        (x, z) => L.beaconNear(x, z, 90),
        (b: Prop, x, y, z) => {
          const r = Math.hypot(x - b.x, z - b.z);
          return r > b.r + 4 && r < 90 && y < b.top + 40;
        },
        (b, out) => {
          out.x = b.x;
          out.z = b.z;
        },
      ),
    },
  });
}
