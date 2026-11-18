import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import {
  createFlightState,
  stepFlight,
  type FlightEnv,
  type FlightInput,
  type FlightState,
} from '../src/player/FlightModel';
import { trickName, trickScale, type TrickKind } from '../src/player/Tricks';

const DT = 1 / 60;
const flat = (h: number): FlightEnv => ({ groundAt: () => h, thermalAt: () => 0 });

/** Trigger `kind` once, then fly hands-off (gesture held for `hold` s) until it ends. */
function perform(s: FlightState, kind: TrickKind, hold = 0, env = flat(-50)) {
  const inp: FlightInput = { steerX: 0, steerY: 0, flap: false, trick: kind, trickHeld: true };
  const out = { started: false, finished: null as TrickKind | null, size: 0, maxY: s.y };
  out.maxY = s.y;
  let minY = s.y;
  let contacts = 0;
  for (let t = 0; t < 8 && !out.finished; t += DT) {
    inp.trickHeld = t < hold;
    stepFlight(s, inp, env, DT);
    inp.trick = null;
    if (s.trick.started) out.started = true;
    if (s.trick.finished) {
      out.finished = s.trick.finished;
      out.size = s.trick.size;
    }
    if (s.contact !== 'none') contacts++;
    out.maxY = Math.max(out.maxY, s.y);
    minY = Math.min(minY, s.y);
    expect(Number.isFinite(s.x + s.y + s.z + s.speed + s.pitch + s.spin)).toBe(true);
  }
  return { ...out, minY, contacts };
}

describe('barrel roll', () => {
  it('spins a full turn and hops sideways toward the roll', () => {
    const s = createFlightState(0, 100, 0, 0);
    const r = perform(s, 'rollR');
    expect(r.finished).toBe('rollR');
    expect(r.size).toBe(1);
    expect(s.spin).toBe(0);
    // Facing +z, the right is -x.
    expect(s.x).toBeLessThan(-Config.tricks.rollHop * 0.8);
    expect(s.x).toBeGreaterThan(-Config.tricks.rollHop * 1.2);
    const l = createFlightState(0, 100, 0, 0);
    perform(l, 'rollL');
    expect(l.x).toBeGreaterThan(Config.tricks.rollHop * 0.8);
  });

  it('keeps rolling while held, up to maxRolls', () => {
    expect(perform(createFlightState(0, 100, 0, 0), 'rollL', 0.8).size).toBe(2);
    expect(perform(createFlightState(0, 100, 0, 0), 'rollL', 5).size).toBe(Config.tricks.maxRolls);
  });
});

describe('dive-bomb', () => {
  it('stoops past top speed and pulls out above the ground', () => {
    const s = createFlightState(0, 260, 0, 0);
    let top = 0;
    const inp: FlightInput = { steerX: 0, steerY: 0, flap: false, trick: 'dive', trickHeld: true };
    let contacts = 0;
    for (let t = 0; t < 6; t += DT) {
      stepFlight(s, inp, flat(0), DT);
      inp.trick = null;
      top = Math.max(top, s.speed);
      if (s.contact !== 'none') contacts++;
    }
    expect(top).toBeGreaterThan(Config.flight.maxSpeed);
    expect(contacts).toBe(0);
    expect(s.trick.kind).toBe(null);
  });

  it('pulls out early near the ground, however long it is held', () => {
    const r = perform(createFlightState(0, 70, 0, 0), 'dive', 5, flat(0));
    expect(r.finished).toBe('dive');
    expect(r.contacts).toBe(0);
    expect(r.minY).toBeGreaterThan(Config.flight.clearance);
  });

  it('a held dive lasts longer than a tap', () => {
    const tap = perform(createFlightState(0, 300, 0, 0), 'dive', 0, flat(0));
    const held = perform(createFlightState(0, 300, 0, 0), 'dive', 1.6, flat(0));
    expect(tap.size).toBeCloseTo(Config.tricks.diveMin, 1);
    expect(held.size).toBeGreaterThan(1.4);
  });

  it('keeps stooping for as long as it is held, and the multiplier keeps growing', () => {
    // From just under the altitude ceiling, so the only limit is how long the gesture is held.
    const top = Config.flight.maxAltitude - 20;
    const short = perform(createFlightState(0, top, 0, 0), 'dive', 3, flat(0));
    const long = perform(createFlightState(0, top, 0, 0), 'dive', 4.5, flat(0));
    expect(short.size).toBeGreaterThan(2.9);
    expect(long.size).toBeGreaterThan(4.4);
    expect(trickScale('dive', long.size)).toBeGreaterThan(trickScale('dive', short.size));
  });

  it('needs height to start', () => {
    expect(perform(createFlightState(0, 20, 0, 0), 'dive', 0, flat(0)).started).toBe(false);
  });
});

describe('tricks', () => {
  it('one at a time', () => {
    const s = createFlightState(0, 100, 0, 0);
    const inp: FlightInput = { steerX: 0, steerY: 0, flap: false, trick: 'rollL' };
    stepFlight(s, inp, flat(-50), DT);
    inp.trick = 'dive';
    stepFlight(s, inp, flat(-50), DT);
    expect(s.trick.kind).toBe('rollL');
  });
});

describe('trick names and sizes', () => {
  it('bigger tricks have bigger names and pay a little more', () => {
    const c = Config.tricks;
    expect(trickName('rollL', 1)).toBe('Barrel roll');
    expect(trickName('rollR', 3)).toBe('Triple roll');
    expect(trickName('dive', 3)).toBe('Long dive-bomb');
    expect(trickScale('rollL', 1)).toBe(1);
    expect(trickScale('rollL', 2)).toBeGreaterThan(1);
    expect(trickScale('dive', c.diveMin)).toBe(1);
    expect(trickScale('dive', c.diveMin + 5)).toBeCloseTo(1 + 5 * c.diveScalePerSec); // no ceiling
  });
});
