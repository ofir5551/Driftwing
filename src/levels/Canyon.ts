import { CANYON_MUSIC } from '../audio/styles';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import { CanyonWorld } from '../world/canyon/CanyonWorld';
import type { LevelDef } from './World';

/**
 * Red Canyons' light: a high desert. Hot white midday under a deep blue sky with the red rock
 * bouncing warm light into every shadow (hemiGround), a blazing orange sunset, a violet dusk
 * and a clear, starry night. Same phases and names as the default day.
 */
const P = {
  dawn: makePalette({
    skyTop: '#7389c4',
    skyHorizon: '#f7bd92',
    skyBottom: '#e3a98c',
    fog: '#e9bba0',
    sun: '#ffbf8c',
    sunIntensity: 1.3,
    hemiSky: '#cbc4ec',
    hemiGround: '#9a5a4a',
    hemiIntensity: 1.3,
    sunElevation: 0.12,
    stars: 0.15,
    grade: '#fff0ea',
    water: '#6f8f96',
  }),
  day: makePalette({
    skyTop: '#2f6fd0',
    skyHorizon: '#cddbe6', // pale, a little dusty at the horizon
    skyBottom: '#d6cbb6',
    fog: '#dcccb4',
    sun: '#fff6e6',
    sunIntensity: 1.6,
    hemiSky: '#cfe2ff',
    hemiGround: '#b8704c', // light bounced off red rock
    hemiIntensity: 1.05,
    sunElevation: 1.15, // high and hot
    stars: 0,
    grade: '#fff8f0',
    water: '#4e8f80',
  }),
  golden: makePalette({
    skyTop: '#5a6fb4',
    skyHorizon: '#ffa461',
    skyBottom: '#f0915f',
    fog: '#f0ac7c',
    sun: '#ff9550',
    sunIntensity: 1.7,
    hemiSky: '#ffd6b0',
    hemiGround: '#9a4f3a',
    hemiIntensity: 1.0,
    sunElevation: 0.2,
    stars: 0,
    grade: '#ffeedc',
    water: '#6f8a72',
  }),
  dusk: makePalette({
    skyTop: '#2c2c62',
    skyHorizon: '#e26f5a',
    skyBottom: '#8a5070',
    fog: '#9a6078',
    sun: '#ff7a5a',
    sunIntensity: 1.1,
    hemiSky: '#b8a6dc',
    hemiGround: '#5a3046',
    hemiIntensity: 1.3,
    sunElevation: 0.07,
    stars: 0.55,
    grade: '#f6e6ff',
    water: '#3e4a66',
  }),
  twilight: makePalette({
    skyTop: '#0b1430',
    skyHorizon: '#2e3c6c',
    skyBottom: '#25284a',
    fog: '#2e3458',
    sun: '#b8c6f6', // the moon on red rock
    sunIntensity: 0.7,
    hemiSky: '#7484bc',
    hemiGround: '#2e2236',
    hemiIntensity: 1.0,
    sunElevation: 0.5,
    stars: 1,
    grade: '#e6eaff',
    water: '#121d38',
  }),
};

const CANYON_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/** Red sandstone canyons, arches and mesas, after the Colorado Plateau. */
export const Canyon: LevelDef = {
  id: 'canyon',
  name: 'Red Canyons',
  blurb: 'Stone arches over desert canyons',
  startPhase: 0.25, // opens in the midday glare, heading for sunset
  dayScale: 1.2,
  music: CANYON_MUSIC,
  backdrop: 'mesas',
  sky: CANYON_SKY,
  saturation: 1.05,
  // Room to rise over the mesas (~200 m) and see the canyons from above.
  maxAltitude: 360,
  create: (seed) => {
    const world = new CanyonWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
