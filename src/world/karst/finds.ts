import { Config } from '../../core/Config';
import { defineFinds, orbitAny, type DiscoveryDef } from '../Discoveries';
import type { KarstLayout, Pillar } from './KarstLayout';

/** Jade River's finds: a pavilion on a summit, a turn round a tall pillar, the paddies at night. */
export function karstFinds(L: KarstLayout): DiscoveryDef[] {
  const C = Config.karst.pillarCell;
  /** The nearest pillar within r of (x, z) that passes `test` (cells are cached: no allocation). */
  const pillar = (x: number, z: number, r: number, test: (p: Pillar) => boolean): Pillar | null => {
    let best: Pillar | null = null;
    let bd = r;
    for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++)
      for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++)
        for (const p of L.cell(i, j)) {
          const d = Math.hypot(x - p.x, z - p.z);
          if (d < bd && test(p)) {
            bd = d;
            best = p;
          }
        }
    return best;
  };
  let px = 0;
  let pz = 0;
  let py = 0;
  const atSummit = (p: Pillar) =>
    p.pavilion &&
    Math.hypot(px - p.x - p.lx, pz - p.z - p.lz) < 22 &&
    py > p.top - 6 &&
    py < p.top + 25;
  const tall = (p: Pillar) => p.h >= 80;
  return defineFinds('karst', {
    pavilion: {
      at: (x, y, z) => {
        px = x;
        py = y;
        pz = z;
        return pillar(x, z, 30, atSummit) !== null;
      },
    },
    // Round the rock below its summit, close enough that it fills the turn.
    pillar: {
      around: orbitAny(
        (x, z) => pillar(x, z, 160, tall),
        (p: Pillar, x, y, z) => {
          const r = Math.hypot(x - p.x - p.lx * 0.5, z - p.z - p.lz * 0.5);
          return r > p.reach && r < p.reach + 90 && y < p.top;
        },
        (p, out) => {
          out.x = p.x + p.lx * 0.5;
          out.z = p.z + p.lz * 0.5;
        },
      ),
    },
    // Low over the terraces, well away from the river the night ribbons follow.
    paddies: {
      night: true,
      at: (x, y, z) => {
        const bank = L.river(x, z); // paddy() reads the river's scratch
        return bank > 60 && L.paddy(x, z) > 0.6 && y < L.height(x, z) + 20;
      },
    },
  });
}
