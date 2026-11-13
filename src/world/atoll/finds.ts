import { defineFinds, type DiscoveryDef } from '../Discoveries';
import { BUNGALOW_TOP, type AtollLayout } from './AtollLayout';

/** Coral Atolls' finds: over the bungalow roofs, the home fang's summit, round it at night. */
export function atollFinds(L: AtollLayout): DiscoveryDef[] {
  const home = L.atoll(0, 0)?.island ?? null;
  return defineFinds('atoll', {
    pier: { at: (x, y, z) => L.bungalowAt(x, z) > 0 && y < BUNGALOW_TOP + 10 },
    // The first ribbon runs at the fang; this is over its summit.
    fang: {
      at: (x, y, z) =>
        home !== null &&
        Math.hypot(x - home.tx, z - home.tz) < 45 &&
        y > home.th - 6 &&
        y < home.th + 30,
    },
    // A full turn round the fang below its summit, after dark (the wisps only swing past it).
    moonlit: {
      night: true,
      around: (x, y, z, out) => {
        if (home === null) return false;
        out.x = home.tx;
        out.z = home.tz;
        const r = Math.hypot(x - home.tx, z - home.tz);
        return r > home.tr && r < home.tr + 140 && y < home.th;
      },
    },
  });
}
