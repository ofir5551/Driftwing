import { RINGMOON_MUSIC } from '../audio/styles';
import { Config } from '../core/Config';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import { RingmoonWorld } from '../world/ringmoon/RingmoonWorld';
import type { LevelDef } from './World';

/**
 * Ringmoon Shallows' light: another world's sky. A jade-green afternoon over a teal sea, a long
 * gold double sunset, a turquoise and violet dusk and a deep blue-green night lit by the
 * giant's rings. Same phases and names as the default day, so the time-of-day picker lands on
 * these too.
 */
const P = {
  dawn: makePalette({
    skyTop: '#5f8f99',
    skyHorizon: '#efcdb0',
    skyBottom: '#d9c2ae',
    fog: '#e2cdb8',
    sun: '#ffd3a8',
    sunIntensity: 1.25,
    hemiSky: '#cfe0d8',
    hemiGround: '#7a6f8a',
    hemiIntensity: 1.3,
    sunElevation: 0.12,
    stars: 0.15,
    grade: '#fff4ea',
    water: '#5aa59a',
  }),
  day: makePalette({
    skyTop: '#3f8f7a',
    skyHorizon: '#cfeed6',
    skyBottom: '#bfe4cc',
    fog: '#c4e6d0',
    sun: '#fff3d6',
    sunIntensity: 1.5,
    hemiSky: '#d8f4e4',
    hemiGround: '#8a7aa6',
    hemiIntensity: 1.05,
    sunElevation: 0.85,
    stars: 0,
    grade: '#fbfff8',
    water: '#2f9c8c',
  }),
  golden: makePalette({
    skyTop: '#4d8774',
    skyHorizon: '#f4d595',
    skyBottom: '#e6cf98',
    fog: '#e8d6a2',
    sun: '#ffc778',
    sunIntensity: 1.6,
    hemiSky: '#f6ecc8',
    hemiGround: '#8e7468',
    hemiIntensity: 1.0,
    sunElevation: 0.2,
    stars: 0,
    grade: '#fff4e0',
    water: '#5a9a80',
  }),
  dusk: makePalette({
    skyTop: '#33467a',
    skyHorizon: '#7fd2bc',
    skyBottom: '#a48fc0',
    fog: '#9fb8bc',
    sun: '#ffa98a',
    sunIntensity: 1.25,
    hemiSky: '#bcb4e0',
    hemiGround: '#5e5a7c',
    hemiIntensity: 1.4,
    sunElevation: 0.14,
    stars: 0.5,
    grade: '#f0ecfa',
    water: '#4d7f98',
  }),
  twilight: makePalette({
    skyTop: '#0f2433',
    skyHorizon: '#2f6466',
    skyBottom: '#234a55',
    fog: '#2d5a5e',
    sun: '#b8f0dc',
    sunIntensity: 0.85,
    hemiSky: '#86c4b8',
    hemiGround: '#2e3a4a',
    hemiIntensity: 1.2,
    sunElevation: 0.35, // read as the ringlight
    stars: 1,
    grade: '#e4fff6',
    water: '#1f4a58',
  }),
};

const RINGMOON_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/** A shallow jade sea of leaning spires on a moon of a ringed giant, with an old ship in it. */
export const Ringmoon: LevelDef = {
  id: 'ringmoon',
  name: 'Ringmoon Shallows',
  blurb: 'Two suns and a ringed giant',
  startPhase: 0.36, // the afternoon, the giant high and half lit
  dayScale: 1.4, // a long, slow day for a vast place
  music: RINGMOON_MUSIC,
  backdrop: 'giant',
  sky: RINGMOON_SKY,
  // The suns go down to the right of the ship, the giant hanging on its left.
  sunTurn: 2.4,
  saturation: 1.04,
  // Clear-ish shallows: the moss beds show through (live, for the debug panel).
  get waterClarity() {
    return Config.ringmoon.clarity;
  },
  // Room to rise over the gate spires (150 m) and see the groves from high above.
  maxAltitude: 320,
  create: (seed) => {
    const world = new RingmoonWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
