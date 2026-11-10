import { PEAKS_MUSIC } from '../audio/styles';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import { PeaksWorld } from '../world/peaks/PeaksWorld';
import type { LevelDef } from './World';

/**
 * Sea of Clouds' light: high-altitude air over a sea of cloud. The ground light (hemiGround)
 * is the cloud's bounce, never earth: lilac at sunrise, pale blue-grey by day, honey in the
 * golden hour. The sky's top is a deeper blue than below, as it is up high, and the fog is the
 * far cloud sea's colour, so the horizon melts into it. Same phases and names as the default.
 */
const P = {
  dawn: makePalette({
    skyTop: '#5f6fa8',
    skyHorizon: '#ffc39a',
    skyBottom: '#f1b9a8',
    fog: '#f3c3b2',
    sun: '#ffb98a',
    sunIntensity: 1.35,
    hemiSky: '#c7c2ee',
    hemiGround: '#a8879f',
    hemiIntensity: 1.3,
    sunElevation: 0.06, // just risen over the cloud sea
    stars: 0.2,
    grade: '#fff0ea',
    water: '#ecbdb4',
  }),
  day: makePalette({
    skyTop: '#3f7fd6',
    skyHorizon: '#d6e8f5',
    skyBottom: '#e6edf5',
    fog: '#dce7f2',
    sun: '#fff6e6',
    sunIntensity: 1.35,
    hemiSky: '#d2e4fb',
    hemiGround: '#9ea6c2',
    hemiIntensity: 1.0,
    sunElevation: 0.95,
    stars: 0,
    grade: '#ffffff',
    water: '#e3ebf4',
  }),
  golden: makePalette({
    skyTop: '#6f8cd0',
    skyHorizon: '#ffd29a',
    skyBottom: '#f6d2a4',
    fog: '#f4d3ab',
    sun: '#ffc277',
    sunIntensity: 1.6,
    hemiSky: '#ffe6c4',
    hemiGround: '#a8909c', // the cloud's lilac shade, so it never reads as sand
    hemiIntensity: 1.05,
    sunElevation: 0.2,
    stars: 0,
    grade: '#fff3df',
    water: '#efcfa6',
  }),
  dusk: makePalette({
    skyTop: '#454c8c',
    skyHorizon: '#f59f8a',
    skyBottom: '#c9879b',
    fog: '#d495a0',
    sun: '#ff8f74',
    sunIntensity: 1.25,
    hemiSky: '#c8b0e2',
    hemiGround: '#82698e',
    hemiIntensity: 1.4,
    sunElevation: 0.12,
    stars: 0.5,
    grade: '#fbe7f0',
    water: '#c991a4',
  }),
  twilight: makePalette({
    skyTop: '#1c2554',
    skyHorizon: '#5f6c9e',
    skyBottom: '#4b5583',
    fog: '#56628f',
    sun: '#c2ccff',
    sunIntensity: 0.95,
    hemiSky: '#909cd6',
    hemiGround: '#4a5078',
    hemiIntensity: 1.2,
    sunElevation: 0.4, // read as the moon over a silver sea
    stars: 1,
    grade: '#e6eaff',
    water: '#4c5786',
  }),
};

const PEAKS_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/** Granite spires rising out of a sea of clouds at sunrise, after Huangshan's summits. */
export const Peaks: LevelDef = {
  id: 'peaks',
  name: 'Sea of Clouds',
  blurb: 'Granite spires above the clouds',
  startPhase: 0, // the sun has just risen over the cloud sea
  dayScale: 1.3, // linger in the morning light
  music: PEAKS_MUSIC,
  backdrop: 'summits',
  sky: PEAKS_SKY,
  // The sun comes up ahead and a little right of the spawn, beside the Sky Gate.
  sunTurn: -1.05,
  // The sky's own clouds float well above the spires: the cloud sea is below.
  cloudLift: 140,
  // Room to rise over the tallest summits (~330 m) and look out over the sea.
  maxAltitude: 420,
  create: (seed) => {
    const world = new PeaksWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
