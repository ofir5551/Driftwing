import { Config } from '../../core/Config';
import { defineFinds, type DiscoveryDef } from '../Discoveries';
import { VENUE, type EdenLayout } from './EdenLayout';

/** Eden's finds, all at the venue: the pier, the chuppah and the lanterns by night. */
export function edenFinds(L: EdenLayout): DiscoveryDef[] {
  const y = L.venue.y;
  const P = VENUE.pier;
  const ch = L.toWorld(VENUE.chuppah.u, VENUE.chuppah.v);
  const pool = L.toWorld(VENUE.pool.u, VENUE.pool.v);
  const pc = Math.cos(P.turn);
  const ps = Math.sin(P.turn);
  return defineFinds('eden', {
    // Skimming the pier's deck, just above the water (the ribbons fly higher).
    pier: {
      at: (x, py, z) => {
        if (py > y + 4 * Config.eden.venueScale) return false;
        const { u, v } = L.toVenue(x, z);
        const a = (u - P.u) * pc - (v - P.v) * ps;
        const b = (u - P.u) * ps + (v - P.v) * pc;
        return Math.abs(a) < P.half + 1 && Math.abs(b) < P.width + 2;
      },
    },
    // A full turn round the chuppah, low over the lawn.
    chuppah: {
      around: (x, py, z, pivot) => {
        pivot.x = ch.x;
        pivot.z = ch.z;
        return py < y + 26 && Math.hypot(x - ch.x, z - ch.z) < 40;
      },
    },
    // Up among the sky lanterns over the pool after dark.
    lanterns: {
      night: true,
      dwell: 1.5,
      at: (x, py, z) =>
        Math.hypot(x - pool.x, z - pool.z) < 45 && py > y + 55 && py < y + Config.eden.lanternTop,
    },
  });
}
