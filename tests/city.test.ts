import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { angleDelta, clamp } from '../src/core/math';
import { CITY_KEYS, MODES } from '../src/audio/scales';
import { createFlightState, stepFlight, type FlightInput } from '../src/player/FlightModel';
import { BK, BOX_STRIDE, CityLayout, PART_STRIDE, ZONE_AVENUE } from '../src/world/city/CityLayout';
import { avoidSolids, glanceOffWall, type Solids } from '../src/world/city/collide';
import { CityWorld } from '../src/world/city/CityWorld';
import { Wisps } from '../src/world/Wisps';

const city = new CityLayout(1337);

/** One axis-aligned wall for the pure flight helpers. */
function wall(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solids {
  const hit = [x0, y0, z0, x1, y1, z1];
  return {
    hit,
    solidTop: (x, y, z, m) =>
      x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m && z > z0 - m && z < z1 + m
        ? y1
        : -Infinity,
  };
}

describe('city layout', () => {
  it('is deterministic per seed', () => {
    const a = new CityLayout(42).superblock(1, -2);
    const b = new CityLayout(42).superblock(1, -2);
    expect(a.parts).toEqual(b.parts);
    expect(a.boxes).toEqual(b.boxes);
    expect(a.parts.length % PART_STRIDE).toBe(0);
    expect(a.boxes.length % BOX_STRIDE).toBe(0);
  });

  it('starts the bird out on the bay, facing the torii and the x = 0 avenue', () => {
    const { spawn, gate } = city;
    expect(city.inSea(spawn.x, spawn.z)).toBe(true);
    expect(city.inSea(gate.x, gate.z)).toBe(true);
    expect(spawn.yaw).toBeCloseTo(Math.PI);
    expect(spawn.z).toBeGreaterThan(gate.z);
    // Straight down the middle, at gate height, nothing is in the way until well inland.
    for (let z = spawn.z; z > city.shoreNear(0) - 400; z -= 2)
      expect(city.solidTop(0, 11, z, 3)).toBe(-Infinity);
  });

  it('frames the gate with the torii (solid pillars and beams either side of the path)', () => {
    const { gate } = city;
    expect(city.solidTop(gate.x - 11, 10, gate.z, 0)).toBeGreaterThan(20);
    expect(city.solidTop(gate.x + 11, 10, gate.z, 0)).toBeGreaterThan(20);
    expect(city.solidTop(gate.x, 19, gate.z, 0)).toBeGreaterThan(18);
  });

  it('keeps avenues free of buildings', () => {
    let sampled = 0;
    for (let i = 0; i < 4000; i++) {
      const x = ((i * 7919) % 4800) - 2400;
      const z = ((i * 104729) % 4800) - 2400;
      if (city.zoneAt(x, z) !== ZONE_AVENUE) continue;
      // Away from expressway lines and the bay torii, nothing stands at street level.
      const I = Math.round(x / city.S);
      const J = Math.round(z / city.S);
      if (city.expressX(I) && Math.abs(x - I * city.S) < 10) continue;
      if (city.expressZ(J) && Math.abs(z - J * city.S) < 10) continue;
      if (city.inSea(x, z)) continue;
      const g = city.height(x, z);
      if (g < 1) continue; // river: bridges are fine
      expect(city.solidTop(x, g + 6, z, 0)).toBe(-Infinity);
      sampled++;
    }
    expect(sampled).toBeGreaterThan(100);
  });

  it('mixes block kinds: towers near the core, houses, shrines, temples and parks', () => {
    const seen = new Set<number>();
    for (let bj = -30; bj < 30; bj++)
      for (let bi = -30; bi < 30; bi++) seen.add(city.blockKind(bi, bj));
    for (const k of [
      BK.TOWERS,
      BK.MIDRISE,
      BK.HOUSES,
      BK.APARTMENTS,
      BK.PARK,
      BK.SHRINE,
      BK.TEMPLE,
    ])
      expect(seen.has(k)).toBe(true);
    // The core sits just inland of the spawn.
    expect(city.density(0, -2)).toBeGreaterThan(0.66);
  });

  it('pushes a point out of a building through the nearest face', () => {
    const sb = city.superblock(0, -2);
    const B = sb.boxes;
    // A building standing on the ground: aim for a point just inside its east face.
    let k = -1;
    for (let b = 0; b < B.length; b += BOX_STRIDE)
      if (
        B[b + 4] - B[b + 1] > 12 &&
        B[b + 1] < 5 &&
        B[b + 3] - B[b] > 6 &&
        B[b + 5] - B[b + 2] > 6
      )
        k = b;
    expect(k).toBeGreaterThanOrEqual(0);
    const p = { x: B[k + 3] - 0.5, y: (B[k + 1] + B[k + 4]) / 2, z: (B[k + 2] + B[k + 5]) / 2 };
    const n = { x: 0, y: 0, z: 0 };
    const d = city.pushPoint(p, 1.6, n);
    expect(d).toBeGreaterThan(0);
    expect(n.x).toBe(1);
    expect(city.solidTop(p.x, p.y, p.z, 1.5)).toBe(-Infinity);
    // And the roof is what's below a point above it.
    expect(
      city.roofBelow((B[k] + B[k + 3]) / 2, 1000, (B[k + 2] + B[k + 5]) / 2),
    ).toBeGreaterThanOrEqual(B[k + 4]);
  });
});

describe('flying among buildings', () => {
  it('glancing off a wall turns the bird along it and costs some speed', () => {
    const s = createFlightState(0, 20, 0, Math.PI / 4); // heading +x+z
    const speed = s.speed;
    glanceOffWall(s, -1, 0); // a wall facing -x, ahead to the east
    expect(s.turnSpring.x).toBeLessThan(0); // yaw decreasing: swinging round to +z and away
    expect(s.speed).toBeLessThan(speed);
    // Heading away from the wall already: nothing happens.
    const t = createFlightState(0, 20, 0, -Math.PI / 2);
    glanceOffWall(t, -1, 0);
    expect(t.turnSpring.x).toBe(0);
  });

  it('a soft glance never stops the bird: it slides off a wall it flies into', () => {
    const solids = wall(30, -5, -50, 40, 200, 50);
    const s = createFlightState(0, 20, 0, Math.PI / 2 - 0.3); // into the wall at a shallow angle
    const env = { groundAt: () => 0, thermalAt: () => 0 };
    const inp: FlightInput = { steerX: 0, steerY: 0, flap: false };
    for (let i = 0; i < 240; i++) {
      stepFlight(s, inp, env, 1 / 60);
      if (solids.solidTop(s.x, s.y, s.z, 1.6) !== -Infinity) {
        s.x = Math.min(s.x, 30 - 1.6);
        glanceOffWall(s, -1, 0);
      }
    }
    expect(s.x).toBeLessThan(30);
    expect(s.speed).toBeGreaterThan(Config.flight.minSpeed);
    expect(Math.abs(angleDelta(s.yaw, 0))).toBeLessThan(Math.PI / 2); // now running along it
  });

  it('look-ahead pulls up over a low roof and veers from a tall wall', () => {
    const s = createFlightState(0, 20, 0, 0);
    const low: FlightInput = { steerX: 0, steerY: 0, flap: false };
    avoidSolids(s, low, wall(-20, -5, 15, 20, 24, 40));
    expect(low.steerY).toBeGreaterThan(0.2);
    const tall: FlightInput = { steerX: 0, steerY: 0, flap: false };
    // A tower slab ahead, more open to the right (-x) side.
    avoidSolids(s, tall, wall(-4, -5, 15, 60, 200, 40));
    expect(tall.steerX).toBeGreaterThan(0.2); // +1 = turn right
    // Clear air: no change at all.
    const clear: FlightInput = { steerX: 0.1, steerY: -0.2, flap: false };
    avoidSolids(s, clear, wall(100, 0, 100, 110, 50, 110));
    expect(clear).toEqual({ steerX: 0.1, steerY: -0.2, flap: false });
  });
});

describe('city wisps', () => {
  /** Autopilot (the same steering as the title-screen bot) over city ribbons for a while. */
  function fly(seed: number, seconds: number) {
    const w = new CityWorld(seed);
    const sp = w.layout.spawn;
    const s = createFlightState(sp.x, sp.y, sp.z, sp.yaw);
    const wisps = new Wisps(
      seed,
      (x, z) => w.wispFloor(x, z),
      () => null,
    );
    wisps.planner = w.planner;
    const env = { groundAt: (x: number, z: number) => w.flightGround(x, z), thermalAt: () => 0 };
    const inp: FlightInput = { steerX: 0, steerY: 0, flap: false };
    let got = 0;
    let glances = 0;
    let touching = false;
    let inside = 0;
    for (let i = 0; i < 60 * seconds; i++) {
      const t = wisps.nextTarget(s.x, s.z, s.yaw);
      if (t) {
        inp.steerX = clamp(-angleDelta(s.yaw, Math.atan2(t.x - s.x, t.z - s.z)) * 2.2, -1, 1);
        inp.steerY = clamp((t.y - s.y) * 0.08, -0.8, 0.8);
      }
      w.assist(s, inp);
      stepFlight(s, inp, env, 1 / 60);
      const hit = w.collide(s) > 0;
      if (hit && !touching) glances++;
      touching = hit;
      wisps.update(1 / 60, s.x, s.y, s.z, s.yaw, () => got++);
      if (i % 30 === 0)
        for (const v of wisps.list)
          if (v.alive && w.layout.solidTop(v.x, v.y, v.z, 0) !== -Infinity) inside++;
    }
    return { got, glances, inside };
  }

  it('ribbons never sit inside buildings, and an autopilot flies them through the streets', () => {
    // Over 10 minutes on five seeds the bot gathers ~1.6 wisps/s and glances off a wall 0-6
    // times; these two minutes guard against regressions.
    for (const seed of [42, 2024]) {
      const r = fly(seed, 120);
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(1);
    }
  });
});

describe('city music', () => {
  it('uses Japanese pentatonics, one key per time of day', () => {
    expect(MODES.yo).toEqual([0, 2, 5, 7, 9]);
    expect(MODES.hirajoshi).toEqual([0, 2, 3, 7, 8]);
    expect(CITY_KEYS).toHaveLength(5);
  });
});
