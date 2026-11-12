import { ATOLL_MUSIC } from '../audio/styles';
import { Config } from '../core/Config';
import { AtollWorld } from '../world/atoll/AtollWorld';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import type { LevelDef } from './World';

/**
 * Coral Atolls' light: a deep, clean tropical blue overhead and a pale horizon, turquoise
 * water, gold and coral in the evening and a warm violet night. Same phases and names as the
 * default day, so the time-of-day picker lands on these too. (The water colour is only a tint
 * here: the seabed's own colours show through the clear water.)
 */
const P = {
  dawn: makePalette({
    skyTop: '#7ea3d8',
    skyHorizon: '#f9d2b8',
    skyBottom: '#f2c8b5',
    fog: '#f3d4c2',
    sun: '#ffd0a4',
    sunIntensity: 1.3,
    hemiSky: '#d6d6f2',
    hemiGround: '#7d9a92',
    hemiIntensity: 1.3,
    sunElevation: 0.12,
    stars: 0.1,
    grade: '#fff3ec',
    water: '#7cc9c8',
  }),
  day: makePalette({
    skyTop: '#3d8ede',
    skyHorizon: '#c4ecf4',
    skyBottom: '#b4e2ea',
    fog: '#bfe5ee',
    sun: '#fff6e0',
    sunIntensity: 1.55,
    hemiSky: '#d8f2ff',
    hemiGround: '#7fae96',
    hemiIntensity: 1.05,
    sunElevation: 1.0,
    stars: 0,
    grade: '#ffffff',
    water: '#3fc6c9',
  }),
  golden: makePalette({
    skyTop: '#6b93d0',
    skyHorizon: '#fbcf98',
    skyBottom: '#f4c49a',
    fog: '#f2cda4',
    sun: '#ffc274',
    sunIntensity: 1.6,
    hemiSky: '#ffe6c2',
    hemiGround: '#8a8a6a',
    hemiIntensity: 1.0,
    sunElevation: 0.22,
    stars: 0,
    grade: '#fff3e0',
    water: '#58b9b0',
  }),
  dusk: makePalette({
    skyTop: '#4a4f98',
    skyHorizon: '#ff9f8a',
    skyBottom: '#d6889c',
    fog: '#de9aa2',
    sun: '#ff8f6e',
    sunIntensity: 1.3,
    hemiSky: '#d2b2e2',
    hemiGround: '#6e6a80',
    hemiIntensity: 1.4,
    sunElevation: 0.14,
    stars: 0.5,
    grade: '#fde8ee',
    water: '#6f86b8',
  }),
  twilight: makePalette({
    skyTop: '#1f2c63',
    skyHorizon: '#6a6fae',
    skyBottom: '#4b5790',
    fog: '#58609a',
    sun: '#b6c2ff',
    sunIntensity: 0.9,
    hemiSky: '#8e98d8',
    hemiGround: '#34405e',
    hemiIntensity: 1.2,
    sunElevation: 0.35, // read as the moon
    stars: 1,
    grade: '#e6eaff',
    water: '#2c4a86',
  }),
};

const ATOLL_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/** Turquoise lagoons, palm islets and coral reefs in the open Pacific, with a high island. */
export const Atoll: LevelDef = {
  id: 'atoll',
  name: 'Coral Atolls',
  blurb: 'Turquoise lagoons and palm isles',
  startPhase: 0.14, // late morning, the lagoons at their brightest
  dayScale: 1.2,
  music: ATOLL_MUSIC,
  backdrop: 'cumulus',
  sky: ATOLL_SKY,
  // The sun goes down ahead of the spawn, behind the high island's fang.
  sunTurn: -2.85,
  saturation: 1.06,
  // Clear water: the seabed paints the lagoons (live, for the debug panel).
  get waterClarity() {
    return Config.atoll.clarity;
  },
  // Room to rise over the fang (~165 m) and see the rings of reef from above.
  maxAltitude: 300,
  create: (seed) => {
    const world = new AtollWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
