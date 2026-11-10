import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { UNLOCKS, unlockAt } from '../src/core/Journey';
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
const CRANE = Config.species.crane;
const PHOENIX = Config.species.phoenix;

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
    for (const b of SPECIES) {
      // What reaches a wisp is the turning circle (speed / turn rate), not either alone: the
      // Phoenix's speed is matched by its turn.
      const circle = b.tuning.speed / b.tuning.turn;
      expect(circle, b.id).toBeGreaterThanOrEqual(0.8);
      expect(circle, b.id).toBeLessThanOrEqual(1.25);
      for (const k of ['flapLift', 'flapCooldown', 'bleed'] as const) {
        expect(b.tuning[k], `${b.id}.${k}`).toBeGreaterThanOrEqual(0.75);
        expect(b.tuning[k], `${b.id}.${k}`).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it('cruises the Phoenix far faster than every other bird', () => {
    const inp: FlightInput = { steerX: 0, steerY: 0, flap: false };
    const cruise = (tune: FlightTuning) => fly(tune, 10, inp).s.speed;
    const others = SPECIES.filter((b) => b.id !== 'phoenix').map((b) => cruise(b.tuning));
    for (const v of others) expect(v).toBeCloseTo(Config.flight.cruiseSpeed, 0);
    expect(cruise(PHOENIX)).toBeGreaterThan(Math.max(...others) * 1.5);
    // It starts at its own cruise, not the others'.
    expect(createFlightState(0, 60, 0, 0, PHOENIX).speed).toBeCloseTo(
      Config.flight.cruiseSpeed * PHOENIX.speed,
      5,
    );
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

  it('lifts the Crane far higher than the Tern in the same thermal', () => {
    const column: FlightEnv = { groundAt: () => -50, thermalAt: () => 6 };
    const inp: FlightInput = { steerX: 0, steerY: 0, flap: false };
    const climb = (tune: FlightTuning) => fly(tune, 3, inp, 60, column).s.y - 60;
    expect(climb(TERN)).toBeGreaterThan(2);
    expect(climb(CRANE)).toBeGreaterThan(climb(TERN) * 1.5);
    // Out of a thermal it climbs like any bird.
    expect(fly(CRANE, 3, inp).s.y).toBeCloseTo(fly(TERN, 3, inp).s.y, 0);
  });

  it('carries dive speed further on the Crane, less far on the Swallow', () => {
    const after = (tune: FlightTuning) => {
      const s = createFlightState(0, 60, 0, 0, tune);
      s.speed = 55;
      for (let t = 0; t < 3; t += DT)
        stepFlight(s, { steerX: 0, steerY: 0, flap: false }, flat(-50), DT);
      return s.speed;
    };
    expect(after(CRANE)).toBeGreaterThan(after(TERN) + 1.5);
    expect(after(SWALLOW)).toBeLessThan(after(TERN) - 1);
  });

  it('lets every bird fly the ribbons of Neon Bay and the canyons as well as the Tern', () => {
    // A fresh world for every flight: a world's wisp planner keeps state between flights.
    for (const make of [() => new CityWorld(42), () => new CanyonWorld(42)]) {
      const solid = () => false;
      const run = (tune: FlightTuning) => {
        const w = make();
        return flyBot(w, w.layout.spawn, 42, 90, solid, tune).got;
      };
      const tern = run(TERN);
      for (const b of SPECIES) expect(run(b.tuning), b.id).toBeGreaterThan(tern * 0.9);
    }
  });

  it('makes the Phoenix the last thing on the journey', () => {
    const last = [...UNLOCKS].sort((a, b) => unlockAt(a.id) - unlockAt(b.id)).at(-1);
    expect(last?.id).toBe('phoenix');
    for (const b of SPECIES)
      if (b.unlock && b.id !== 'phoenix')
        expect(unlockAt(b.unlock)).toBeLessThan(unlockAt('phoenix'));
  });

  it('dresses each bird in its own plumage by default', () => {
    expect(speciesDef('tern').plumage).toBe('sea');
    expect(speciesDef('swallow').plumage).toBe('swallow');
    expect(speciesDef('crane').plumage).toBe('crane');
    expect(speciesDef('phoenix').plumage).toBe('phoenix');
  });
});
