import { FJORD_MUSIC } from '../audio/styles';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import { FjordWorld } from '../world/fjord/FjordWorld';
import type { LevelDef } from './World';

/**
 * Aurora Fjords' light: a high-latitude winter day. The sun barely clears the walls, the snow
 * takes every colour of the sky, and the night is a deep blue (never black) with the aurora
 * over it. Same phases and names as the default day, so the time-of-day picker lands on these.
 */
const P = {
  dawn: makePalette({
    skyTop: '#6f86b8',
    skyHorizon: '#f3c2b0',
    skyBottom: '#c8b6c8',
    fog: '#d3c3cf',
    sun: '#ffc4a0',
    sunIntensity: 1.2,
    hemiSky: '#d0d4f0',
    hemiGround: '#646a86',
    hemiIntensity: 1.35,
    sunElevation: 0.1,
    stars: 0.2,
    grade: '#fff2f2',
    water: '#4f6a90',
  }),
  day: makePalette({
    skyTop: '#5f8fc8',
    skyHorizon: '#d6e6f0',
    skyBottom: '#c4d6e2',
    fog: '#cbdae8',
    sun: '#fff1dc',
    sunIntensity: 1.4,
    hemiSky: '#e0eeff',
    hemiGround: '#6f7f90',
    hemiIntensity: 1.1,
    sunElevation: 0.45, // a low winter sun, even at noon
    stars: 0,
    grade: '#fbfdff',
    water: '#355f86',
  }),
  golden: makePalette({
    skyTop: '#6f86c0',
    skyHorizon: '#f6c891',
    skyBottom: '#e2b996',
    fog: '#e3c4a8',
    sun: '#ffbd73',
    sunIntensity: 1.5,
    hemiSky: '#ffe0c0',
    hemiGround: '#6e5e66',
    hemiIntensity: 1.0,
    sunElevation: 0.15,
    stars: 0,
    grade: '#fff0dc',
    water: '#4d5f84',
  }),
  dusk: makePalette({
    skyTop: '#2a3463',
    skyHorizon: '#d98f8a', // alpenglow
    skyBottom: '#7a6a8e',
    fog: '#86789a',
    sun: '#ff9a7a',
    sunIntensity: 1.1,
    hemiSky: '#b6b0dc',
    hemiGround: '#4a4a66',
    hemiIntensity: 1.35,
    sunElevation: 0.08,
    stars: 0.6,
    grade: '#f2eaff',
    water: '#2e3a62',
  }),
  twilight: makePalette({
    skyTop: '#101b3c',
    skyHorizon: '#3a5c7c',
    skyBottom: '#1f324c',
    fog: '#2c4360',
    sun: '#b4caff', // the moon: cool light on the snow
    sunIntensity: 0.95,
    hemiSky: '#8aa6d6',
    hemiGround: '#243048',
    hemiIntensity: 1.2,
    sunElevation: 0.42,
    stars: 1,
    grade: '#e2ecff',
    water: '#0e1d33',
  }),
};

const FJORD_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/** Deep fjords under the northern lights, after Lofoten and the Norwegian west coast. */
export const Fjord: LevelDef = {
  id: 'fjord',
  name: 'Aurora Fjords',
  blurb: 'Northern lights over still fjords',
  startPhase: 0.84, // opens under the aurora
  dayScale: 2, // a long polar night: linger under the aurora
  music: FJORD_MUSIC,
  backdrop: 'aurora',
  sky: FJORD_SKY,
  // Room to rise over the plateau's peaks (~300 m) and into the aurora's glow.
  maxAltitude: 380,
  create: (seed) => {
    const world = new FjordWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
