import { Config } from '../../core/Config';
import { defineFinds, type DiscoveryDef } from '../Discoveries';
import type { FjordLayout } from './FjordLayout';

/** Aurora Fjords' finds: a turn round the lighthouse, an iceberg skimmed, the ceiling at night. */
export function fjordFinds(L: FjordLayout): DiscoveryDef[] {
  const h = L.lighthouse;
  return defineFinds('fjord', {
    // The first ribbon runs past it; this is the full circle, close in.
    lighthouse: {
      around: (x, y, z, out) => {
        out.x = h.x;
        out.z = h.z;
        const d = Math.hypot(x - h.x, z - h.z);
        return d > 6 && d < 80 && y < h.y0 + h.h + 50;
      },
    },
    berg: {
      at: (x, y, z) => {
        const ice = L.ice(x, z);
        return ice > 2 && y < ice + 7;
      },
    },
    // Up against the soft ceiling (the level's own, copied into Config on a switch).
    aurora: { night: true, at: (_x, y) => y > Config.flight.maxAltitude - 30 },
  });
}
