import { defineFinds, orbitAny, type DiscoveryDef } from '../Discoveries';
import type { Landmark } from './JerusalemLayout';
import type { JerusalemLayout } from './JerusalemLayout';

/** City of Gold's finds: over the dome's cap, low along the walls, a turn round a tower. */
export function jerusalemFinds(L: JerusalemLayout): DiscoveryDef[] {
  const d = L.dome;
  return defineFinds('jerusalem', {
    // The first ribbon circles the dome; this is straight over its cap.
    dome: { at: (x, y, z) => Math.hypot(x - d.x, z - d.z) < 14 && y > d.top && y < d.top + 18 },
    // Within 8 m of the wall line, low, for a few seconds: following it, not crossing it.
    walls: {
      dwell: 4,
      at: (x, y, z) => L.inOldCity(x, z, -8) && !L.inOldCity(x, z, 8) && y < L.ground(x, z) + 30,
    },
    // A tight turn round a tower's shaft, below its tip (the wisps' swings pass over the tips).
    tower: {
      around: orbitAny(
        (x, z) => L.landmarkNear(x, z, 30, 20),
        (l: Landmark, x, y, z) => {
          const r = Math.hypot(x - l.x, z - l.z);
          return r > l.reach + 2 && r < 30 && y > l.y0 && y < l.top;
        },
        (l, out) => {
          out.x = l.x;
          out.z = l.z;
        },
      ),
    },
  });
}
