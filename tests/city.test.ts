import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { angleDelta } from '../src/core/math';
import { CITY_KEYS, MODES } from '../src/audio/scales';
import { createFlightState, stepFlight, type FlightInput } from '../src/player/FlightModel';
import {
  BK,
  BOX_STRIDE,
  CITY_TREE_STRIDE,
  DECK_STRIDE,
  CityLayout,
  PART_STRIDE,
  ZONE_AVENUE,
} from '../src/world/city/CityLayout';
import { avoidSolids, glanceOffWall, type Solids } from '../src/world/city/collide';
import { CityWorld } from '../src/world/city/CityWorld';
import { flyBot } from './helpers';

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

  it('ends the grid at a bayside road: nothing is built on it or on the promenade', () => {
    let boxes = 0;
    let trees = 0;
    for (let I = -6; I <= 6; I++)
      for (const J of [-1, 0, 1, 6, 7, 8]) {
        const sb = city.superblock(I, J);
        const B = sb.boxes;
        for (let k = 0; k < B.length; k += BOX_STRIDE) {
          const d = city.shoreDist((B[k] + B[k + 3]) / 2, (B[k + 2] + B[k + 5]) / 2);
          if (d < 0 || d > city.roadIn + 3) continue;
          // Only a bridge deck (over a river mouth, or a road's ending there) or an expressway
          // deck overhead.
          const deck = city.deckAt((B[k] + B[k + 3]) / 2, (B[k + 2] + B[k + 5]) / 2);
          expect(B[k + 4] <= Math.max(3.4, deck + 0.2) || B[k + 1] >= 14).toBe(true);
          boxes++;
        }
        const T = sb.trees;
        for (let k = 0; k < T.length; k += CITY_TREE_STRIDE) {
          const d = city.shoreDist(T[k + 1], T[k + 3]);
          // The promenade's own row stands 6.5 m in from the railing; the road is bare.
          if (d > 8 && d < city.roadIn + 1.5) trees++;
        }
      }
    expect(trees).toBe(0);
    expect(boxes).toBeGreaterThan(0); // the expressway crossing the bay at least
    // Blocks the shore cuts into are waterfront parks (or a harbour's container yard).
    for (let bi = -20; bi < 20; bi++)
      for (let bj = -3; bj < 3; bj++) {
        const x = city.blockX0(bi) + city.B / 2;
        const z = city.blockZ0(bj) + city.B / 2;
        if (city.shoreDist(x, z) < city.roadIn)
          expect([BK.PARK, BK.HARBOUR]).toContain(city.blockKind(bi, bj));
      }
  });

  it('carries roads over the river on decks that meet the road at both banks', () => {
    let bridges = 0;
    let walls = 0;
    for (let I = -6; I <= 6; I++)
      for (let J = -6; J <= 0; J++) {
        const D = city.superblock(I, J).decks;
        for (let k = 0; k < D.length; k += DECK_STRIDE) {
          const [cx, cz, dx, dz, ha, hw, yA, yB] = D.slice(k, k + DECK_STRIDE);
          if (hw !== city.AH && hw !== city.SH + 2.5) continue; // the bayside road's segments
          bridges++;
          // Each end sits just above the road beside it: no step up, nothing poking through.
          for (const [e, y] of [
            [-1, yA],
            [1, yB],
          ]) {
            const g = city.baseHeight(cx + dx * e * (ha + 1), cz + dz * e * (ha + 1));
            expect(y).toBeGreaterThan(g - 0.05);
            expect(y).toBeLessThan(g + 0.45);
          }
          // Its middle is over the river, and the cars' height query finds the surface there (or
          // a crossing road's deck just above it, where two cross over the water).
          expect(city.river(cx, cz)).toBeGreaterThan(0);
          const y = city.deckAt(cx, cz);
          expect(y).toBeGreaterThan((yA + yB) / 2 - 0.001);
          expect(y).toBeLessThan((yA + yB) / 2 + 0.5);
        }
      }
    // Stone embankments line the river (their coping is the flight floor beside the channel).
    for (let z = -400; z < 0; z += 3) if (city.embankmentTop(0.5 * z + 100, z) > 1) walls++;
    expect(bridges).toBeGreaterThan(5);
    expect(walls).toBeGreaterThan(0);
  });

  it('sets buildings back from the river walk', () => {
    let near = 0;
    for (let I = -6; I <= 6; I++)
      for (let J = -6; J <= 0; J++) {
        const B = city.superblock(I, J).boxes;
        for (let k = 0; k < B.length; k += BOX_STRIDE) {
          const w = B[k + 3] - B[k];
          const dz = B[k + 5] - B[k + 2];
          // Buildings: tall boxes standing on the ground (not decks, pillars or lamps).
          if (B[k + 4] - B[k + 1] < 6 || B[k + 1] > 5 || Math.min(w, dz) < 4) continue;
          const d = city.bankDist((B[k] + B[k + 3]) / 2, (B[k + 2] + B[k + 5]) / 2);
          expect(d).toBeGreaterThan(city.riverWalk);
          if (d < 40) near++;
        }
      }
    expect(near).toBeGreaterThan(0); // the river does run through these superblocks
  });

  it('runs east-west expressways only where the bay never reaches their avenue', () => {
    let lines = 0;
    for (let J = -20; J <= 20; J++) {
      if (!city.expressZ(J)) continue;
      lines++;
      for (let x = -4000; x <= 4000; x += 40) expect(city.inSea(x, J * city.S)).toBe(false);
    }
    expect(lines).toBeGreaterThan(0);
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
  it('ribbons never sit inside buildings, and an autopilot flies them through the streets', () => {
    // Runs change lanes and turn often, so the city asks for steering. Over 25 minutes on five
    // seeds the bot gathers ~1.3 wisps/s and glances off a wall about once a minute (about half
    // of those while chasing a wisp it missed mid-swerve, which a person would let go). These
    // two minutes guard against regressions.
    for (const seed of [42, 2024]) {
      const w = new CityWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) => w.layout.solidTop(x, y, z, 0) !== -Infinity,
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(140);
      expect(r.glances).toBeLessThanOrEqual(5);
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
