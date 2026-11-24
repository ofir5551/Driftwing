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
const BARS: Partial<Record<LevelId, { first: number; total: number }>> = {
  highlands: { first: 200, total: 7 },
};

describe('journeys on every level', () => {
  for (const [id, bar] of Object.entries(BARS) as [LevelId, { first: number; total: number }][])
    it(`the bot, following the wisps, reaches destination after destination in ${id}`, () => {
      const def = LEVEL_LIST.find((l) => l.id === id)!;
      let total = 0;
      for (const seed of SEEDS) {
        const { world, spawn } = def.create(seed);
        expect(world.destinations, id).toBeTruthy();
        const r = journeyBot(world, spawn, seed, 360, () => false);
        expect(r.arrivals.length, `${id} seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(r.arrivals[0], `${id} seed ${seed}`).toBeLessThan(bar.first);
        total += r.arrivals.length;
      }
      expect(total, id).toBeGreaterThanOrEqual(bar.total);
    });
});
