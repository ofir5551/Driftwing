import { JERUSALEM_MUSIC } from '../audio/styles';
import { DAY_SKY, makePalette, type SkyKey } from '../world/DayCycle';
import { JerusalemWorld } from '../world/jerusalem/JerusalemWorld';
import type { LevelDef } from './World';

/**
 * City of Gold's light: a dry, dusty-blue day, a long apricot golden hour that turns the
 * limestone to gold, the rose "Jerusalem pink" of dusk, and a deep indigo night over the
 * floodlit walls. Same phases and names as the default day, so the time-of-day picker lands
 * on these too.
 */
const P = {
  dawn: makePalette({
    skyTop: '#8ea3c8',
    skyHorizon: '#f4cdb0',
    skyBottom: '#e2c3b0',
    fog: '#e8cdb9',
    sun: '#ffcfa2',
    sunIntensity: 1.25,
    hemiSky: '#d8d0e6',
    hemiGround: '#8a7466',
    hemiIntensity: 1.3,
    sunElevation: 0.1,
    stars: 0.12,
    grade: '#fff2ea',
    water: '#9fb2c8',
  }),
  day: makePalette({
    skyTop: '#6f9fd4',
    skyHorizon: '#e3e4dc',
    skyBottom: '#d8d4c4',
    fog: '#ded9ca',
    sun: '#fff2d8',
    sunIntensity: 1.55,
    hemiSky: '#dfe8f2',
    hemiGround: '#8f8466',
    hemiIntensity: 1.05,
    sunElevation: 0.95,
    stars: 0,
    grade: '#fffbf2',
    water: '#86aeca',
  }),
  golden: makePalette({
    skyTop: '#7d93c6',
    skyHorizon: '#fbc98a',
    skyBottom: '#f2c08a',
    fog: '#f0c896',
    sun: '#ffbd66',
    sunIntensity: 1.75,
    hemiSky: '#ffe0b2',
    hemiGround: '#8d6a50',
    hemiIntensity: 1.0,
    sunElevation: 0.2,
    stars: 0,
    grade: '#fff0d8',
    water: '#c8a888',
  }),
  dusk: makePalette({
    skyTop: '#4f5590',
    skyHorizon: '#f2a08e',
    skyBottom: '#c48a98',
    fog: '#d09a98',
    sun: '#ff8e70',
    sunIntensity: 1.25,
    hemiSky: '#cdb0d8',
    hemiGround: '#6e5868',
    hemiIntensity: 1.4,
    sunElevation: 0.12,
    stars: 0.55,
    grade: '#fde8ea',
    water: '#8a7aa8',
  }),
  twilight: makePalette({
    skyTop: '#1f2a55',
    skyHorizon: '#665c84',
    skyBottom: '#40456a',
    fog: '#4d4f72',
    sun: '#b8b4ff',
    sunIntensity: 0.85,
    hemiSky: '#8a8cc8',
    hemiGround: '#3a3650',
    hemiIntensity: 1.15,
    sunElevation: 0.4,
    stars: 1,
    grade: '#ece6ff',
    water: '#3d4a7a',
  }),
};

const JERUSALEM_SKY: SkyKey[] = DAY_SKY.map((k) => ({ ...k, p: P[k.name as keyof typeof P] }));

/** A walled city of golden stone on its hills, after Jerusalem's Old City and the Judean hills. */
export const Jerusalem: LevelDef = {
  id: 'jerusalem',
  name: 'City of Gold',
  blurb: 'Golden stone on the hills of Jerusalem',
  startPhase: 0.47, // opens as the light turns gold
  dayScale: 1.4, // linger in the golden hour
  music: JERUSALEM_MUSIC,
  backdrop: 'hills',
  sky: JERUSALEM_SKY,
  // The sun rides behind the Mount of Olives, so from its slope the Old City glows gold.
  sunTurn: Math.PI,
  // The city stands 60-110 m up: keep the low clouds off its roofs.
  cloudLift: 70,
  // Room to rise over the Mount of Olives' towers and see the Old City whole.
  maxAltitude: 380,
  create: (seed) => {
    const world = new JerusalemWorld(seed);
    return { world, spawn: { ...world.layout.spawn } };
  },
};
