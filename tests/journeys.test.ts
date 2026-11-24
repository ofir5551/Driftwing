import { describe, expect, it } from 'vitest';
import { LEVEL_LIST } from '../src/levels';
import type { LevelId } from '../src/levels/World';
import { journeyBot } from './helpers';

const SEEDS = [1337, 42, 7, 2024];

/**
 * Per level: the latest first arrival allowed on any seed (s), and the least arrivals over all
 * four seeds in six minutes. The bot never flaps and has no eyes for the beacon, so it loses
 * the ribbon now and then where a player would not; the bars are set below what it manages.
 */
interface Bar {
  /** Latest first arrival allowed (s), on seeds that arrive at all. */
  first: number;
  /** Least arrivals over the four seeds. */
  total: number;
  /** Least arrivals on each seed (default 1). */
  each?: number;
}
const BARS: Partial<Record<LevelId, Bar>> = {
  highlands: { first: 200, total: 7 },
  // The street grid is the hardest to lead through: the bot loses the ribbon at corners.
  city: { first: 330, total: 4 },
  // Rivers meander: a walk down one can loop far round before its bridge or pagoda.
  karst: { first: 220, total: 5, each: 0 },
};

describe('journeys on every level', () => {
  for (const [id, bar] of Object.entries(BARS) as [LevelId, Bar][])
    it(`the bot, following the wisps, reaches destination after destination in ${id}`, () => {
      const def = LEVEL_LIST.find((l) => l.id === id)!;
      let total = 0;
      for (const seed of SEEDS) {
        const { world, spawn } = def.create(seed);
        expect(world.destinations, id).toBeTruthy();
        const r = journeyBot(world, spawn, seed, 360, () => false);
        expect(r.arrivals.length, `${id} seed ${seed}`).toBeGreaterThanOrEqual(bar.each ?? 1);
        if (r.arrivals.length > 0)
          expect(r.arrivals[0], `${id} seed ${seed}`).toBeLessThan(bar.first);
        total += r.arrivals.length;
      }
      expect(total, id).toBeGreaterThanOrEqual(bar.total);
    });
});
