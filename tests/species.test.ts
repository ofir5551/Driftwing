import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import {
  createFlightState,
  NEUTRAL_TUNING,
  stepFlight,
  type FlightEnv,
  type FlightInput,
  type FlightTuning,
} from '../src/player/FlightModel';
import { startTrick } from '../src/player/Tricks';
import { SPECIES, speciesDef } from '../src/player/Species';
import { CanyonWorld } from '../src/world/canyon/CanyonWorld';
import { CityWorld } from '../src/world/city/CityWorld';
import { flyBot } from './helpers';

const DT = 1 / 60;
const flat = (h: number): FlightEnv => ({ groundAt: () => h, thermalAt: () => 0 });
const TERN = Config.species.tern;
const SWALLOW = Config.species.swallow;

function fly(tune: FlightTuning, seconds: number, inp: FlightInput, y = 60, env = flat(-50)) {
  const s = createFlightState(0, y, 0, 0, tune);
  let water = 0;
  for (let t = 0; t < seconds; t += DT) {
    stepFlight(s, inp, env, DT);
    if (s.contact === 'water') water++;
  }
  return { s, water };
}

describe('Species', () => {
  it('flies the Tern exactly as the bare model', () => {
    for (const k of Object.keys(NEUTRAL_TUNING) as (keyof FlightTuning)[])
      expect(TERN[k]).toBe(NEUTRAL_TUNING[k]);
    const inp: FlightInput = { steerX: 0.6, steerY: 0.3, flap: true };
    expect(fly(TERN, 4, inp).s).toEqual({ ...fly(NEUTRAL_TUNING, 4, inp).s, tune: TERN });
  });

  it('keeps every bird within reach of the wisp planner', () => {
    for (const b of SPECIES)
      for (const k of ['turn', 'flapLift', 'flapCooldown', 'bleed'] as const) {
        expect(b.tuning[k]).toBeGreaterThanOrEqual(0.75);
        expect(b.tuning[k]).toBeLessThanOrEqual(1.25);
      }
  });

  it('turns the Swallow sharper than the Tern', () => {
    const inp: FlightInput = { steerX: 1, steerY: 0, flap: false };
    const tern = fly(TERN, 1, inp).s;
    const swallow = fly(SWALLOW, 1, inp).s;
    expect(Math.abs(swallow.yaw)).toBeGreaterThan(Math.abs(tern.yaw) * 1.15);
  });

  it("darts the Swallow's roll further aside, with a burst of speed", () => {
    const roll = (tune: FlightTuning) => {
      const s = createFlightState(0, 60, 0, 0, tune);
      const env = flat(-50);
      expect(startTrick(s, 'rollR', env)).toBe(true);
      const v0 = s.speed;
      let minX = 0;
      for (let t = 0; t < 1.2; t += DT) {
        stepFlight(s, { steerX: 0, steerY: 0, flap: false }, env, DT);
        minX = Math.min(minX, s.x);
      }
      return { side: -minX, kick: v0 - Config.flight.cruiseSpeed }; // right of +z is -x
    };
    const tern = roll(TERN);
    const swallow = roll(SWALLOW);
    expect(tern.kick).toBe(0);
    expect(swallow.kick).toBe(SWALLOW.rollBoost);
    expect(swallow.side).toBeGreaterThan(tern.side * 2);
  });

  it('speeds the Swallow up low over water, and only over water', () => {
    // Nose down over open water: the bird runs along just above it, bouncing off now and then.
    const inp: FlightInput = { steerX: 0, steerY: -0.8, flap: false };
    const tern = fly(TERN, 6, inp, 12, flat(-30));
    const swallow = fly(SWALLOW, 6, inp, 12, flat(-30));
    expect(swallow.s.speed).toBeGreaterThan(tern.s.speed + 8);
    expect(swallow.s.speed).toBeLessThanOrEqual(Config.flight.maxSpeed);
    // A long skim settles instead of running away to top speed.
    expect(fly(SWALLOW, 30, inp, 12, flat(-30)).s.speed).toBeLessThan(Config.flight.maxSpeed - 8);
    // Over land the same flight gains nothing from it.
    const land = Config.world.waterLevel + 1;
    expect(fly(SWALLOW, 6, inp, 12, flat(land)).s.speed).toBeLessThan(swallow.s.speed - 8);
  });

  it('lets the Swallow fly the ribbons of Neon Bay and the canyons as well as the Tern', () => {
    const city = new CityWorld(42);
    const canyon = new CanyonWorld(42);
    for (const w of [city, canyon]) {
      const solid = () => false;
      const tern = flyBot(w, w.layout.spawn, 42, 90, solid, TERN).got;
      const swallow = flyBot(w, w.layout.spawn, 42, 90, solid, SWALLOW).got;
      expect(swallow).toBeGreaterThan(tern * 0.9);
    }
  });

  it('dresses each bird in its own plumage by default', () => {
    expect(speciesDef('tern').plumage).toBe('sea');
    expect(speciesDef('swallow').plumage).toBe('swallow');
  });
});
