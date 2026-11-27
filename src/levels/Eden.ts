import { EDEN_MUSIC } from '../audio/styles';
import { Config } from '../core/Config';
import { EdenWorld } from '../world/eden/EdenWorld';
import type { LevelDef } from './World';

/**
 * Eden: a wedding flight for Tal and Hadar over green country in the golden hour. Follow the
 * beacons to Tal's picture, then Hadar's (each joins the flock), then on to the venue, where
 * the two of them wait and lanterns rise. A personal stage: never in the players' game, it has
 * its own link (/eden/), the wedding invitation. Always open: it is not on the journey track.
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
  lanternNotes: false, // the wedding flight keeps its lanterns plain
  personal: {
    title: 'Tal ♥ Hadar',
    tag: 'Follow the light to the wedding.',
    pageTitle: 'Tal ♥ Hadar · Driftwing',
    finaleAt: 'eden:venue',
    // Once the invitation's card has had its time.
    get finaleAfter() {
      return Config.eden.inviteSeconds + Config.eden.finaleDelay;
    },
    finaleTitle: 'Mazal tov!',
    finaleText: "You flew to Tal and Hadar's wedding. Eden is one of many places in Driftwing.",
  },
  maxAltitude: 400,
  create: (seed) => {
    const world = new EdenWorld(seed);
    // Facing Tal's meadow, so the first ribbon already leads the way.
    const { tal } = world.layout;
    return { world, spawn: { x: 0, y: 45, z: 0, yaw: Math.atan2(tal.x, tal.z) } };
  },
};
