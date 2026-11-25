import { EDEN_MUSIC } from '../audio/styles';
import { EdenWorld } from '../world/eden/EdenWorld';
import type { LevelDef } from './World';

/**
 * Eden: a wedding flight for Tal and Hadar over green country in the golden hour. Follow the
 * beacons to Tal's picture, then Hadar's (each joins the flock), then on to the venue, where
 * the two of them wait and lanterns rise. Always open: it is not on the journey track.
 */
export const Eden: LevelDef = {
  id: 'eden',
  name: 'Eden',
  blurb: "Tal & Hadar's wedding flight",
  startPhase: 0.5, // the golden hour
  dayScale: 1.6, // and linger in it
  music: EDEN_MUSIC,
  backdrop: 'none',
  wispColor: '#ffc4cf', // petals, not gold
  maxAltitude: 400,
  create: (seed) => {
    const world = new EdenWorld(seed);
    // Facing Tal's meadow, so the first ribbon already leads the way.
    const { tal } = world.layout;
    return { world, spawn: { x: 0, y: 45, z: 0, yaw: Math.atan2(tal.x, tal.z) } };
  },
};
