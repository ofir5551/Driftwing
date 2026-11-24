import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { landmarkDestinations, landmarkName } from '../landmarks';
import type { DestinationSource } from '../Destinations';
import { Temple, type PeaksLayout } from './PeaksLayout';

const FIRST = [
  'Crane',
  'Cloud',
  'Jade',
  'Moon',
  'Pine',
  'Dragon',
  'Phoenix',
  'Mist',
  'Wind',
  'Star',
];
const KIND = ['Needle', 'Horn', 'Spire', 'Pillar'];
/** Every this many spire cells (each way) is looked in: tall spires are common, cells many. */
const SAMPLE = 3;
/** m: only spires at least this tall lead a journey (they stand clear above the rest). */
const TALL = 150;

/**
 * Sea of Clouds' journeys lead to its tallest granite spires (never one with a hermitage or the
 * gate's monastery: those are hidden finds). The beacon rises from the summit, where the cairn
 * and its stray stand among the summit pines; the route ends beside the spire (its rock is
 * never clear) and passing it below its top arrives.
 */
export function peaksDestinations(L: PeaksLayout): DestinationSource {
  const C = Config.peaks.spireCell;
  return landmarkDestinations((x, z, R, out) => {
    const i0 = Math.floor((x - R) / C / SAMPLE) * SAMPLE;
    const j0 = Math.floor((z - R) / C / SAMPLE) * SAMPLE;
    for (let j = j0; j <= (z + R) / C; j += SAMPLE)
      for (let i = i0; i <= (x + R) / C; i += SAMPLE)
        for (const s of L.cell(i, j)) {
          if (s.temple !== Temple.None || s.h < TALL) continue;
          const sx = s.x + s.lx;
          const sz = s.z + s.lz;
          const a = s.seed * Math.PI * 2;
          const off = s.crown * 0.6;
          out.push({
            id: `spire:${Math.round(s.x)},${Math.round(s.z)}`,
            name: landmarkName(hash2(i, j, Math.round(s.seed * 1000)), FIRST, KIND),
            x: sx,
            z: sz,
            y: s.y0 + s.h,
            top: s.top,
            r: s.reach + 60,
            aside: s.reach + 26,
            roost: { x: sx + Math.sin(a) * off, y: s.y0 + s.h, z: sz + Math.cos(a) * off, yaw: a },
          });
        }
  });
}
