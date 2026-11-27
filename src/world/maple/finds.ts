import { defineFinds, orbitAny, type DiscoveryDef } from '../Discoveries';
import { PAVILION, type MapleLayout, type Temple } from './MapleLayout';

/**
 * Maple Valley's finds: a full turn round the lake pavilion, a skim over a pagoda's finial, and
 * the lake by night, low among the floating lanterns. The opening ribbon only swings past the
 * island, the ribbons ride well over every finial, and none skims the lake that low.
 */
export function mapleFinds(L: MapleLayout): DiscoveryDef[] {
  let near: Temple | null = null;
  return defineFinds('maple', {
    pavilion: {
      around: orbitAny(
        () => L.pavilion,
        (p, x, y, z) => {
          const r = Math.hypot(x - p.x, z - p.z);
          return r > PAVILION.r + 3 && r < 120 && y < p.top + 40;
        },
        (p, out) => {
          out.x = p.x;
          out.z = p.z;
        },
      ),
    },
    pagoda: {
      at: (x, y, z) => {
        if (near === null || Math.hypot(x - near.px, z - near.pz) > 40)
          near = L.nearestTemple(x, z, 40);
        if (near === null) return false;
        return Math.hypot(x - near.px, z - near.pz) < 9 && y > near.top - 3 && y < near.top + 10;
      },
    },
    lanterns: {
      night: true,
      at: (x, y, z) => L.lakeEdge(x, z) < -12 && y < 4,
    },
  });
}
