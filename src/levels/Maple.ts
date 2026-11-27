import { MAPLE_MUSIC } from '../audio/styles';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import { MapleWorld } from '../world/maple/MapleWorld';
import type { LevelDef } from './World';

/**
 * Maple Valley's light: autumn's. A pale, misty rose dawn; a clear, deep blue afternoon over
 * warm haze; a long amber golden hour that sets the forest glowing; a rose and violet dusk as
 * the lanterns light; an indigo night. Same phases and names as the default day, so the
 * time-of-day picker lands on these too.
 */
const P = {
  dawn: makePalette({
    skyTop: '#8d9fc4',
    skyHorizon: '#f3cdb8',
    skyBottom: '#dcbfb4',
    fog: '#e6cbbd',
    sun: '#ffcca2',
    sunIntensity: 1.2,
    hemiSky: '#d2cde4',
    hemiGround: '#8a6658',
    hemiIntensity: 1.3,
    sunElevation: 0.1,
    stars: 0.1,
    grade: '#fff3ea',
    water: '#5e7f86',
  }),
  day: makePalette({
    skyTop: '#5f93cf',
    skyHorizon: '#e9e2cf',
    skyBottom: '#d9d2bf',
    fog: '#ddd6c3',
    sun: '#fff0d6',
    sunIntensity: 1.4,
    hemiSky: '#dfe7f2',
    hemiGround: '#8a6a4c',
    hemiIntensity: 1.05,
    sunElevation: 0.75,
    stars: 0,
    grade: '#fff9f0',
    water: '#4f7f8c',
  }),
  golden: makePalette({
    skyTop: '#7f93bd',
    skyHorizon: '#f5c27e',
    skyBottom: '#e8b788',
    fog: '#e9c597',
    sun: '#ffb25c',
    sunIntensity: 1.55,
    hemiSky: '#f4dcbc',
    hemiGround: '#8c5a3c',
    hemiIntensity: 0.95,
    sunElevation: 0.2,
    stars: 0,
    grade: '#fff0dc',
    water: '#6f7f78',
  }),
  dusk: makePalette({
    skyTop: '#4d5688',
    skyHorizon: '#eaa08a',
    skyBottom: '#b38f9a',
    fog: '#bf9a9e',
    sun: '#ff9c78',
    sunIntensity: 1.15,
    hemiSky: '#c6b4d4',
    hemiGround: '#5e4650',
    hemiIntensity: 1.3,
    sunElevation: 0.12,
    stars: 0.5,
    grade: '#faecec',
    water: '#55627a',
  }),
  twilight: makePalette({
    skyTop: '#1c2443',
    skyHorizon: '#5a5a84',
    skyBottom: '#464868',
    fog: '#4e5070',
    sun: '#b7c2ff',
    sunIntensity: 0.8,
    hemiSky: '#8a90c4',
    hemiGround: '#3a3040',
    hemiIntensity: 1.15,
    sunElevation: 0.35,
    stars: 1,
    grade: '#e8eaff',
    water: '#283a52',
  }),
};

const MAPLE_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/**
 * A mountain valley in full autumn colour, after Kyoto's Arashiyama and Nikko: maples on every
 * slope, a temple lake with a gate standing in the water, tunnels of gates up the mountains.
 */
export const Maple: LevelDef = {
  id: 'maple',
  name: 'Maple Valley',
  blurb: 'Autumn hills and a temple lake',
  startPhase: 0.4, // late afternoon, the light lowering and turning gold
  dayScale: 1.3, // linger in the autumn afternoon
  music: MAPLE_MUSIC,
  backdrop: 'maples',
  sky: MAPLE_SKY,
  saturation: 1.06,
  // Room to rise over the ranges (150 m) and see the colour roll away.
  maxAltitude: 340,
  create: (seed) => {
    const world = new MapleWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
