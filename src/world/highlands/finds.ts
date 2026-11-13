import { defineFinds, type DiscoveryDef } from '../Discoveries';
import type { Island } from '../Islands';

/** The Highlands' finds: its floating isles (those streamed in round the bird) and the sky. */
export function highlandsFinds(islands: () => readonly Island[]): DiscoveryDef[] {
  const isle =
    (test: (I: Island, d: number, y: number) => boolean) => (x: number, y: number, z: number) => {
      for (const I of islands()) if (test(I, Math.hypot(x - I.x, z - I.z), y)) return true;
      return false;
    };
  return defineFinds('highlands', {
    // Skimming the turf on its top.
    isle: { at: isle((I, d, y) => d < I.r * 0.9 && y > I.y && y < I.y + 12) },
    // Under the tip of its hanging rock.
    under: { at: isle((I, d, y) => d < I.r * 0.5 && y < I.y - I.depth && y > I.y - I.depth - 40) },
    // Over the high cloud band (150-270 m), under the 400 m ceiling.
    clouds: { at: (_x, y) => y > 290 },
  });
}
