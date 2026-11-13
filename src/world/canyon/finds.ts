import { defineFinds, type DiscoveryDef } from '../Discoveries';
import type { Arch, CanyonLayout } from './CanyonLayout';

/** Inside an arch's opening (well clear of the rock), in its frame as `inArch` measures it. */
function throughArch(a: Arch, x: number, y: number, z: number): boolean {
  const dx = x - a.x;
  const dz = z - a.z;
  const c = Math.cos(a.yaw);
  const s = Math.sin(a.yaw);
  const u = Math.abs(dx * c - dz * s);
  const v = dx * s + dz * c;
  if (Math.abs(v) > a.d / 2 + 2 || u > a.r * 0.85) return false;
  return y - a.y0 < a.h * 0.85 * Math.sqrt(1 - (u / a.r) ** 2);
}

/** Red Canyons' finds: over the Great Arch, through any other arch, a hoodoo's cap. */
export function canyonFinds(L: CanyonLayout): DiscoveryDef[] {
  return defineFinds('canyon', {
    // The first ribbon threads it; this is over the top.
    great: {
      at: (x, y, z) => {
        const t = L.archTop(L.great, x, z);
        return y > t && y < t + 20;
      },
    },
    arch: {
      at: (x, y, z) => {
        for (const a of L.nearArches(x, z))
          if (a !== L.great && throughArch(a, x, y, z)) return true;
        return false;
      },
    },
    hoodoo: {
      at: (x, y, z) => {
        const t = L.hoodooTop(x, z);
        return y > t && y < t + 8;
      },
    },
  });
}
