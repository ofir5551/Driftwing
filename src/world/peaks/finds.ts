import { Config } from '../../core/Config';
import { defineFinds, type DiscoveryDef } from '../Discoveries';
import { Temple, type PeaksLayout, type Spire } from './PeaksLayout';

/** Close over a spire's summit (where its temple stands). */
const atSummit = (p: Spire, x: number, y: number, z: number, pad: number): boolean =>
  Math.hypot(x - p.x - p.lx, z - p.z - p.lz) < p.crown + pad && y > p.top - 8 && y < p.top + 30;

/** Sea of Clouds' finds: the gate's monastery, any hermitage, the heights at night. */
export function peaksFinds(L: PeaksLayout): DiscoveryDef[] {
  const C = Config.peaks.spireCell;
  // The gate's taller spire carries the monastery; the first ribbon flies under its bridge.
  const monastery = L.gate.find((p) => p.temple === Temple.Monastery) ?? L.gate[0];
  return defineFinds('peaks', {
    monastery: { at: (x, y, z) => atSummit(monastery, x, y, z, 14) },
    hermitage: {
      at: (x, y, z) => {
        const i0 = Math.floor((x - 60) / C);
        const j0 = Math.floor((z - 60) / C);
        for (let j = j0; j <= Math.floor((z + 60) / C); j++)
          for (let i = i0; i <= Math.floor((x + 60) / C); i++)
            for (const p of L.cell(i, j))
              if (p.temple === Temple.Hermitage && atSummit(p, x, y, z, 12)) return true;
        return false;
      },
    },
    // High over the summits after dark, near the soft ceiling (the level's own, in Config).
    stars: { night: true, at: (_x, y) => y > Config.flight.maxAltitude - 40 },
  });
}
