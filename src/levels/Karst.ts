import { KARST_KEYS } from '../audio/scales';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import { KarstWorld } from '../world/karst/KarstWorld';
import type { LevelDef } from './World';

/**
 * Jade River's light: paper-pale mist and jade water, a scroll painting's muted washes. Same
 * phases and names as the default day, so the time-of-day picker lands on these too.
 */
const P = {
  dawn: makePalette({
    skyTop: '#9fb0c6',
    skyHorizon: '#f2dccb',
    skyBottom: '#ddd4ca',
    fog: '#dfd8ce',
    sun: '#ffd4ad',
    sunIntensity: 1.15,
    hemiSky: '#d2d8de',
    hemiGround: '#6d7a71',
    hemiIntensity: 1.35,
    sunElevation: 0.1,
    stars: 0.08,
    grade: '#fff6ec',
    water: '#5f9283',
  }),
  day: makePalette({
    skyTop: '#89abc6',
    skyHorizon: '#dfe7e3',
    skyBottom: '#d3dcd8',
    fog: '#d5ddd9',
    sun: '#fff4e2',
    sunIntensity: 1.35,
    hemiSky: '#e2ecf0',
    hemiGround: '#6c7f6c',
    hemiIntensity: 1.1,
    sunElevation: 0.9,
    stars: 0,
    grade: '#fbfffc',
    water: '#4f8e7c',
  }),
  golden: makePalette({
    skyTop: '#92a3be',
    skyHorizon: '#f3d6ab',
    skyBottom: '#e6d0b0',
    fog: '#e6d4b6',
    sun: '#ffc98a',
    sunIntensity: 1.45,
    hemiSky: '#f6e4c8',
    hemiGround: '#76705b',
    hemiIntensity: 1.0,
    sunElevation: 0.22,
    stars: 0,
    grade: '#fff4e4',
    water: '#7f9a7c',
  }),
  dusk: makePalette({
    skyTop: '#5e6890',
    skyHorizon: '#e6b5a4',
    skyBottom: '#b3a3b0',
    fog: '#bcaeb4',
    sun: '#ffa486',
    sunIntensity: 1.2,
    hemiSky: '#c8bcd6',
    hemiGround: '#5c5865',
    hemiIntensity: 1.35,
    sunElevation: 0.14,
    stars: 0.5,
    grade: '#f8eef0',
    water: '#5d7280',
  }),
  twilight: makePalette({
    skyTop: '#26314e',
    skyHorizon: '#6e7b97',
    skyBottom: '#56617a',
    fog: '#5d6881',
    sun: '#b9c8ff',
    sunIntensity: 0.85,
    hemiSky: '#8f9cc8',
    hemiGround: '#343a4c',
    hemiIntensity: 1.15,
    sunElevation: 0.35,
    stars: 1,
    grade: '#e6ecff',
    water: '#2f4658',
  }),
};

const KARST_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/** Misty limestone pillars along a jade river, after the Li River at Guilin and Yangshuo. */
export const Karst: LevelDef = {
  id: 'karst',
  name: 'Jade River',
  blurb: 'Misty peaks on a jade river',
  startPhase: 0.02,
  dayScale: 1.5, // linger in the morning mist
  keys: KARST_KEYS,
  backdrop: 'karst',
  sky: KARST_SKY,
  saturation: 0.82,
  // Room to rise over the tallest summits (250 m) and see the forest of peaks from above.
  maxAltitude: 320,
  create: (seed) => {
    const world = new KarstWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
