import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { springStep } from '../src/core/math';
import {
  createFlightState,
  floorMargin,
  gust,
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

  it('keeps a press that comes just before the cooldown ends, drops one well before it', () => {
    const { flapCooldown, flapBuffer } = Config.flight;
    const tapAt = (t: number) => {
      const s = createFlightState(0, 150, 0);
      stepFlight(s, input(0, 0, true), flat(-50), DT); // the first flap
      let flaps = 0;
      for (let k = 1; k * DT < flapCooldown + 0.3; k++) {
        const press = Math.abs(k * DT - t) < DT / 2;
        stepFlight(s, input(0, 0, press), flat(-50), DT);
        if (s.flapped) flaps++;
      }
      return flaps;
    };
    expect(tapAt(flapCooldown - flapBuffer * 0.5)).toBe(1); // kept: flaps when the cooldown ends
    expect(tapAt(flapCooldown - flapBuffer - 0.1)).toBe(0); // too early: dropped
  });

  it('nonstop flapping is a burst, not a dive: it stops adding speed at the cap', () => {
    const cap = Config.flight.flapSpeedCap;
    const { s } = run(createFlightState(0, 150, 0), 20, input(0, 0, true));
    expect(s.speed).toBeLessThanOrEqual(cap + 1e-6);
    expect(s.speed).toBeGreaterThan(cap - 8);
    // A dive still goes well past it.
    const dive = run(createFlightState(0, 380, 0), 5, input(0, -1)).s;
    expect(dive.speed).toBeGreaterThan(cap + 15);
  });

  it('a flap never takes speed away above the cap', () => {
    const s = createFlightState(0, 150, 0);
    s.speed = Config.flight.flapSpeedCap + 20;
    const before = s.speed;
    stepFlight(s, input(0, 0, true), flat(-50), DT);
    expect(s.flapped).toBe(true);
    expect(s.speed).toBeGreaterThan(before - 1);
  });

  it('never goes through the ground; contact is soft', () => {
    const env = flat(20);
    const { s } = run(createFlightState(0, 60, 0), 10, input(0, -1), env);
    expect(s.y).toBeGreaterThanOrEqual(20 + Config.flight.groundHeight - 1e-6);
    expect(s.speed).toBeGreaterThan(Config.flight.minSpeed * 0.6);
  });

  it('holding dive over land eases level above the floor without touching it', () => {
    const env = flat(20);
    const s = createFlightState(0, 60, 0);
    let minH = Infinity;
    let contacts = 0;
    for (let t = 0; t < 12; t += DT) {
      stepFlight(s, input(0, -1), env, DT);
      minH = Math.min(minH, s.y - 20);
      if (s.contact !== 'none') contacts++;
    }
    expect(minH).toBeGreaterThanOrEqual(Config.flight.groundHeight - 1e-6);
    // The cushion levels the bird out; the floor clamp is only a backstop.
    expect(contacts).toBe(0);
    // And it settles into a glide just above the floor, not hovering high.
    expect(s.y - 20).toBeLessThan(Config.flight.groundHeight + Config.flight.groundCushion + 1);
  });

  it('a steep slope never puts the bird below the land floor', () => {
    // A wall of rising ground in the bird's path: the bird is carried up it, never into it.
    const env: FlightEnv = {
      groundAt: (_x, z) => Math.max(0, (z - 100) * 1.5),
      thermalAt: () => 0,
    };
    const s = createFlightState(0, 30, 0);
    for (let t = 0; t < 15; t += DT) {
      stepFlight(s, input(0, -1), env, DT);
      const g = env.groundAt(s.x, s.z);
      expect(s.y).toBeGreaterThanOrEqual(
        Math.max(g, Config.world.waterLevel) + floorMargin(g) - 1e-6,
      );
    }
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

  it('a lantern gust surges forward and up, then bleeds back toward cruise', () => {
    const s = createFlightState(0, 120, 0);
    run(s, 3, input());
    const speed = s.speed;
    gust(s, Config.lantern.boost, Config.lantern.lift);
    expect(s.speed).toBeCloseTo(speed + Config.lantern.boost);
    expect(s.liftVy).toBeGreaterThan(0);
    const y = s.y;
    run(s, 1, input());
    expect(s.y).toBeGreaterThan(y);
    run(s, 20, input());
    expect(Math.abs(s.speed - Config.flight.cruiseSpeed)).toBeLessThan(3);
  });

  it('gust lift shares the flap cap', () => {
    const s = createFlightState(0, 120, 0);
    for (let i = 0; i < 5; i++) gust(s, 0, Config.lantern.lift);
    expect(s.liftVy).toBeLessThanOrEqual(Config.flight.flapLift * 1.6);
  });
});

describe('soft cloud', () => {
  const cloud = (soft: number): FlightEnv => ({
    groundAt: () => 40,
    thermalAt: () => 0,
    softAt: () => soft,
  });

  /** Fly with `steerY` held for `hold` s then let go; the deepest dip and the time spent under. */
  function dip(y0: number, steerY: number, hold: number, env: FlightEnv) {
    const s = createFlightState(0, y0, 0);
    let deepest = 0;
    let under = 0;
    let after = 0;
    for (let t = 0; t < 12; t += DT) {
      stepFlight(s, input(0, t < hold ? steerY : 0), env, DT);
      deepest = Math.max(deepest, s.cloud);
      if (s.cloud > Config.flight.cloudIn) under += DT;
      else if (under > 0) after = Math.max(after, s.y - 40);
    }
    return { s, deepest, under, after };
  }

  it('any descent glides into the cloud, stays a breath and glides back out with no leap', () => {
    const c = Config.flight;
    // Start height, stick, seconds held (until a little after it goes in), then let go.
    for (const [y0, steer, hold] of [
      [50, -0.25, 5],
      [60, -0.5, 3.5],
      [90, -1, 3],
      [150, -1, 5],
    ]) {
      const d = dip(y0, steer, hold, cloud(1));
      expect(d.deepest).toBeGreaterThan(2);
      expect(d.deepest).toBeLessThan(c.cloudDepth + 1.5);
      expect(d.under).toBeGreaterThan(1);
      expect(d.under).toBeLessThan(c.cloudHold + 1.5);
      // Surfaces level: no higher than its resting skim (and a little for the pitch's lag).
      expect(d.after).toBeLessThan(c.cloudSkim + 0.6);
      expect(d.s.cloud).toBe(0);
    }
  });

  it('held down, the cloud still eases the bird out once its breath is spent', () => {
    const s = createFlightState(0, 70, 0);
    let longest = 0;
    let run = 0;
    for (let t = 0; t < 14; t += DT) {
      stepFlight(s, input(0, -1), cloud(1), DT);
      run = s.cloud > Config.flight.cloudIn ? run + DT : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeGreaterThan(1.5);
    expect(longest).toBeLessThan(Config.flight.cloudHold + 2);
  });

  it('let go under the cloud, the bird glides straight back out to its skim', () => {
    const d = dip(90, -1, 3.2, cloud(1));
    expect(d.under).toBeGreaterThan(0.3);
    expect(d.s.cloud).toBe(0);
    expect(d.s.y - 40).toBeCloseTo(Config.flight.cloudSkim, 0);
  });

  it('level flight over the cloud keeps skimming the tops', () => {
    const s = createFlightState(0, 40 + Config.flight.cloudSkim, 0);
    run(s, 8, input(), cloud(1));
    expect(s.cloud).toBe(0);
    expect(s.y - 40).toBeCloseTo(Config.flight.cloudSkim, 0);
  });

  it('solid ground (no softness) keeps the usual floor', () => {
    const d = dip(110, -1, 12, cloud(0));
    expect(d.deepest).toBe(0);
    expect(d.s.y - 40).toBeGreaterThanOrEqual(Config.flight.groundHeight - 1e-6);
  });
});
