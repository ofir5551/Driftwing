import { CITY_KEYS } from '../audio/scales';
import { CityWorld } from '../world/city/CityWorld';
import type { LevelDef } from './World';

/** A Tokyo/Osaka blend on an endless bay, opening at dusk as the neon comes on. */
export const City: LevelDef = {
  id: 'city',
  name: 'Neon Bay',
  blurb: 'A Japanese bay city at dusk',
  startPhase: 0.655,
  dayScale: 2,
  keys: CITY_KEYS,
  mountain: true,
  create: (seed) => {
    const world = new CityWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
