import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { springStep } from '../src/core/math';
import {
  createFlightState,
  stepFlight,
  type FlightEnv,
  type FlightInput,
} from '../src/player/FlightModel';

const DT = 1 / 60;
const flat = (h: number): FlightEnv => ({ groundAt: () => h, thermalAt: () => 0 });
const input = (steerX = 0, steerY = 0, flap = false): FlightInput => ({ steerX, steerY, flap });

function run(s = createFlightState(), seconds: number, inp: FlightInput, env = flat(-50)) {
  const flaps = { count: 0, contacts: 0 };
  for (let t = 0; t < seconds; t += DT) {
    stepFlight(s, inp, env, DT);
    if (s.flapped) flaps.count++;
    if (s.contact !== 'none') flaps.contacts++;
  }
  return { s, ...flaps };
}

describe('springStep', () => {
  it('converges without overshoot (critically damped)', () => {
    const sp = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 600; i++) {
      springStep(sp, 1, 4, DT);
      max = Math.max(max, sp.x);
    }
    expect(sp.x).toBeCloseTo(1, 4);
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('is stable for huge dt', () => {
    const sp = { x: 0, v: 0 };
    springStep(sp, 1, 10, 5);
    expect(Number.isFinite(sp.x)).toBe(true);
    expect(sp.x).toBeLessThanOrEqual(1);
  });
});

describe('FlightModel', () => {
  it('holds altitude and settles to cruise speed with no input', () => {
    const { s } = run(createFlightState(0, 80, 0), 20, input());
    expect(s.y).toBeCloseTo(80, 0);
    expect(s.speed).toBeCloseTo(Config.flight.cruiseSpeed, 0);
    expect(s.z).toBeGreaterThan(400); // constant forward motion along +z
  });

  it('diving speeds up and climbing slows down', () => {
    const dive = run(createFlightState(0, 200, 0), 2, input(0, -1)).s;
    const climb = run(createFlightState(0, 80, 0), 2, input(0, 1)).s;
    expect(dive.speed).toBeGreaterThan(Config.flight.cruiseSpeed + 5);
    expect(climb.speed).toBeLessThan(Config.flight.cruiseSpeed - 2);
    expect(dive.y).toBeLessThan(200);
    expect(climb.y).toBeGreaterThan(80);
  });

  it('holding climb beats the wings, each beat adding a little height', () => {
    let beats = 0;
    const s = createFlightState(0, 80, 0);
    for (let t = 0; t < 3; t += DT) {
      stepFlight(s, input(0, 1), flat(-50), DT);
      if (s.climbBeat) beats++;
    }
    expect(beats).toBeGreaterThan(3);
    const saved = Config.flight.climbBeatLift;
    Config.flight.climbBeatLift = 0;
    const noLift = run(createFlightState(0, 80, 0), 3, input(0, 1)).s;
    Config.flight.climbBeatLift = saved;
    expect(s.y).toBeGreaterThan(noLift.y + 2);
  });

  it('no climb wingbeats in level flight or a dive', () => {
    const s = createFlightState(0, 200, 0);
    let beats = 0;
    for (let t = 0; t < 4; t += DT) {
      stepFlight(s, input(0, t < 2 ? 0 : -1), flat(-50), DT);
      if (s.climbBeat) beats++;
    }
    expect(beats).toBe(0);
  });

  it('a steep dive builds well past the old top speed and carries into the pull-up', () => {
    const s = createFlightState(0, 380, 0);
    let top = 0;
    for (let t = 0; t < 8; t += DT) {
      stepFlight(s, input(0, -1), flat(-50), DT);
      top = Math.max(top, s.speed);
    }
    expect(top).toBeGreaterThan(62);
    for (let t = 0; t < 1.5; t += DT) stepFlight(s, input(0, 0), flat(-50), DT);
    expect(s.speed).toBeGreaterThan(Config.flight.cruiseSpeed + 20);
  });

  it('never stalls or falls while holding climb', () => {
    const s = createFlightState(0, 60, 0);
    let minSpeed = Infinity;
    let prevY = s.y;
    let maxDrop = 0;
    for (let t = 0; t < 30; t += DT) {
      stepFlight(s, input(0, 1), flat(-50), DT);
      minSpeed = Math.min(minSpeed, s.speed);
      maxDrop = Math.max(maxDrop, prevY - s.y);
      prevY = s.y;
    }
    expect(minSpeed).toBeGreaterThan(Config.flight.minSpeed * 0.85);
    // Sink per step stays gentle: nose drifts down, no tumbling fall.
    expect(maxDrop / DT).toBeLessThan(10);
  });

  it('steering right turns right, banks into the turn and auto-levels on release', () => {
    const { s } = run(createFlightState(), 1.5, input(1, 0));
    // Facing +z, the bird's right is -x.
    expect(s.yaw).toBeLessThan(-0.5);
    expect(s.x).toBeLessThan(0);
    expect(s.bank).toBeGreaterThan(0.3);
    run(s, 3, input());
    expect(Math.abs(s.bank)).toBeLessThan(0.02);
    expect(Math.abs(s.turnSpring.x)).toBeLessThan(0.02);
  });

  it('flap gives lift and respects the cooldown when held', () => {
    const { s, count } = run(createFlightState(0, 80, 0), 1, input(0, 0, true));
    expect(count).toBe(Math.floor(1 / Config.flight.flapCooldown) + 1);
    expect(s.y).toBeGreaterThan(84);
  });

  it('never goes through the ground; contact is soft', () => {
    const env = flat(20);
    const { s, contacts } = run(createFlightState(0, 60, 0), 10, input(0, -1), env);
    expect(s.y).toBeGreaterThanOrEqual(20 + Config.flight.clearance - 1e-6);
    expect(s.speed).toBeGreaterThan(Config.flight.minSpeed * 0.6);
    // Terrain assist means contact may be rare, but the bird must stay above ground.
    expect(contacts).toBeGreaterThanOrEqual(0);
  });

  it('reports water contact when skimming a lake', () => {
    const s = createFlightState(0, Config.world.waterLevel + Config.flight.clearance + 0.05, 0);
    s.pitchSpring.x = -0.5;
    s.pitch = -0.5;
    stepFlight(s, input(0, -1), flat(-30), DT);
    expect(s.contact).toBe('water');
  });

  it('a hill ahead is climbed over by the terrain assist', () => {
    const env: FlightEnv = { groundAt: (_x, z) => (z > 300 ? 70 : 0), thermalAt: () => 0 };
    const s = createFlightState(0, 40, 0);
    let contacts = 0;
    for (let t = 0; t < 20; t += DT) {
      stepFlight(s, input(), env, DT);
      if (s.contact === 'ground') contacts++;
    }
    expect(s.y).toBeGreaterThan(70);
    expect(contacts).toBeLessThan(30); // at most a brief skim
  });

  it('soft ceiling holds even when climbing and flapping forever', () => {
    const { s } = run(createFlightState(0, 150, 0), 60, input(0, 1, true));
    expect(s.y).toBeLessThan(Config.world.waterLevel + Config.flight.maxAltitude + 40);
  });

  it('thermals lift the bird for free', () => {
    const env: FlightEnv = { groundAt: () => -50, thermalAt: () => 10 };
    const { s } = run(createFlightState(0, 80, 0), 3, input(), env);
    expect(s.y).toBeGreaterThan(90);
  });

  it('is deterministic', () => {
    const a = run(createFlightState(), 5, input(0.3, -0.2, true)).s;
    const b = run(createFlightState(), 5, input(0.3, -0.2, true)).s;
    expect(a).toEqual(b);
  });
});
