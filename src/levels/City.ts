import { CITY_MUSIC } from '../audio/styles';
import { CityWorld } from '../world/city/CityWorld';
import type { LevelDef } from './World';

/** A Tokyo/Osaka blend on an endless bay, opening at dusk as the neon comes on. */
export const City: LevelDef = {
  id: 'city',
  name: 'Neon Bay',
  blurb: 'A Japanese bay city at dusk',
  startPhase: 0.655,
  dayScale: 2,
  music: CITY_MUSIC,
  backdrop: 'fuji',
  // ~50 m over the tallest towers (215 m glass, the 232 m lattice tower): room to loop over the
  // skyline and circle the spires, but not so high that the city's edge and the empty bay take
  // over the view.
  maxAltitude: 300,
  create: (seed) => {
    const world = new CityWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
