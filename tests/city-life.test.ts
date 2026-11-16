import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { CityLayout, ZONE_AVENUE, ZONE_STREET } from '../src/world/city/CityLayout';
import { CityWorld } from '../src/world/city/CityWorld';
import { cityCover, cityLand } from '../src/world/city/cover';
import { PROP, PROP_KINDS, PROP_STRIDE } from '../src/world/city/props';
import { MAX_VEHICLES, TrafficPlan, VEHICLE, VEHICLE_STRIDE } from '../src/world/city/traffic';
import { scatterCover } from '../src/world/GroundCover';
import { createNoise2D } from '../src/world/noise';
import { flyBot } from './helpers';

const city = new CityLayout(1337);

/** Rough heights of each prop kind (m), for keeping them off the wisp ribbons. */
const TALL = [7.2, 10.4, 1, 6, 2, 1, 2.6, 0.2, 1.4, 3.2, 6.5, 1.3, 2.5];
const STREET: number[] = [PROP.Lamp, PROP.Pole, PROP.Signal, PROP.Vending, PROP.BusStop, PROP.Pit];

describe('a lived-in city', () => {
  it('scatters the same props for the same seed', () => {
    const a = new CityLayout(42).superblock(-2, 0);
    const b = new CityLayout(42).superblock(-2, 0);
    expect(a.props.length).toBeGreaterThan(0);
    expect(a.props.length % PROP_STRIDE).toBe(0);
    expect(a.props).toEqual(b.props);
  });

  it('keeps street furniture on the sidewalks, out of buildings, and roof kits on roofs', () => {
    const seen = new Array<number>(PROP_KINDS).fill(0);
    for (let I = -4; I <= 3; I++)
      for (let J = -4; J <= 1; J++) {
        const P = city.superblock(I, J).props;
        for (let k = 0; k < P.length; k += PROP_STRIDE) {
          const [kind, x, y, z] = [P[k], P[k + 1], P[k + 2], P[k + 3]];
          seen[kind]++;
          if (STREET.includes(kind) && !city.inSea(x, z)) {
            const zone = city.zoneAt(x, z);
            expect(zone).not.toBe(ZONE_STREET);
            if (zone === ZONE_AVENUE) {
              // On the 4 m sidewalk, never the carriageway.
              const u = Math.abs(x - Math.round(x / city.S) * city.S);
              const v = Math.abs(z - Math.round(z / city.S) * city.S);
              expect(Math.min(u, v)).toBeGreaterThan(city.AH - 4);
            }
            const sd = city.shoreDist(x, z);
            expect(sd < Config.city.promenade || sd > city.roadIn).toBe(true);
          }
          // Poles and cables are their own thin solids; a parapet is a ring round its roof
          // (its centre may lie under a tower standing on a podium).
          if (kind === PROP.Pole || kind === PROP.Wire || kind === PROP.Parapet) continue;
          // Nothing stands inside a building (a roof kit sits on its roof).
          expect(city.solidTop(x, y + 0.6, z, 0)).toBe(-Infinity);
        }
      }
    for (let k = 0; k < PROP_KINDS; k++) expect(seen[k]).toBeGreaterThan(0);
  });

  it('gives poles, cables and cranes solids, and keeps the wisps off every prop', () => {
    // A pole is solid up its height; the harbour west of the spawn has its cranes.
    const P = city.superblock(-2, 0).props;
    let poles = 0;
    for (let k = 0; k < P.length; k += PROP_STRIDE)
      if (P[k] === PROP.Pole) {
        poles++;
        expect(city.solidTop(P[k + 1], P[k + 2] + 8, P[k + 3], 0)).toBeGreaterThan(P[k + 2] + 9);
      }
    expect(poles).toBeGreaterThan(0);
    let crane = -Infinity;
    for (let x = -480; x < -240; x += 3)
      for (let z = 220; z < 340; z += 3) crane = Math.max(crane, city.solidTop(x, 30, z, 1.6));
    expect(crane).toBeGreaterThan(34);
    const nearProp = (x: number, y: number, z: number): boolean => {
      for (let J = Math.floor((z - 30) / city.S); J <= Math.floor((z + 30) / city.S); J++)
        for (let I = Math.floor((x - 30) / city.S); I <= Math.floor((x + 30) / city.S); I++) {
          const Q = city.superblock(I, J).props;
          for (let k = 0; k < Q.length; k += PROP_STRIDE) {
            const reach = Q[k] === PROP.Wire ? Q[k + 5] / 2 : 3;
            if (Math.hypot(Q[k + 1] - x, Q[k + 3] - z) > reach + 2) continue;
            if (y > Q[k + 2] - 1 && y < Q[k + 2] + TALL[Q[k]] + 1.5) return true;
          }
        }
      return false;
    };
    const w = new CityWorld(1337);
    const L = w.layout;
    const r = flyBot(
      w,
      L.spawn,
      7,
      90,
      (x, y, z) => L.solidTop(x, y, z, 0) !== -Infinity || nearProp(x, y, z),
    );
    expect(r.inside).toBe(0);
    expect(r.got).toBeGreaterThan(90);
  });

  it('grows lawns and flower beds in the parks, not on the paving', () => {
    // A park block near the spawn and the paved towers beside it.
    expect(cityLand(city, 110, -430)).toBe(1);
    const res = 40;
    const size = 160;
    const n = res + 1;
    const lattice = (ox: number, oz: number) => {
      const pos = new Float32Array(n * n * 3);
      const ex = new Float32Array(n * n);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const x = ox + (i * size) / res;
          const z = oz + (j * size) / res;
          pos[(j * n + i) * 3 + 1] = city.height(x, z);
          ex[j * n + i] = cityLand(city, x, z);
        }
      const col = new Float32Array(n * n * 3).fill(0.4);
      return { ox, oz, size, res, positions: pos, colors: col, extra: ex, extraSize: 1 };
    };
    const tufts: number[] = [];
    const flowers: number[] = [];
    const style = cityCover(city);
    const scatter = (ox: number, oz: number) =>
      scatterCover(
        lattice(ox, oz),
        style,
        1,
        createNoise2D(1),
        createNoise2D(2),
        [1, 0, 0, 0, 1, 0],
        tufts,
        flowers,
      );
    scatter(0, -480);
    expect(tufts.length / 9).toBeGreaterThan(1000);
    expect(flowers.length / 9).toBeGreaterThan(50);
    for (let k = 0; k < tufts.length; k += 9) {
      const [x, z] = [tufts[k], tufts[k + 2]];
      // The green strip where an east-west road stops short of the bayside road is grass.
      if (!city.northSouthRoad(x) && city.shoreDist(x, z) < city.eastWestIn) continue;
      const zone = city.zoneAt(x, z);
      expect(zone).not.toBe(ZONE_AVENUE);
      expect(zone).not.toBe(ZONE_STREET);
    }
  });
});

describe('city traffic', () => {
  const out = new Float32Array(MAX_VEHICLES * VEHICLE_STRIDE);

  it('places the same vehicles for the same plan and time, and moves them on', () => {
    const a = new TrafficPlan(new CityLayout(9));
    const b = new TrafficPlan(new CityLayout(9));
    a.plan(30, -300, 320, 650, 160);
    b.plan(30, -300, 320, 650, 160);
    const na = a.place(12.5, 30, -300, 320, 650, out);
    const first = out.slice(0, na * VEHICLE_STRIDE);
    const nb = b.place(12.5, 30, -300, 320, 650, out);
    expect(nb).toBe(na);
    expect(out.slice(0, nb * VEHICLE_STRIDE)).toEqual(first);
    expect(na).toBeGreaterThan(50);
    // Replanning elsewhere and back changes nothing: where a car is depends only on the time.
    b.plan(400, 100, 320, 650, 160);
    b.plan(30, -300, 320, 650, 160);
    expect(b.place(12.5, 30, -300, 320, 650, out)).toBe(na);
    expect(out.slice(0, na * VEHICLE_STRIDE)).toEqual(first);
    // A second later the first car has moved about its speed along its lane.
    b.place(13.5, 30, -300, 320, 650, out);
    const moved = Math.hypot(out[1] - first[1], out[3] - first[3]);
    expect(moved).toBeGreaterThan(5);
    expect(moved).toBeLessThan(30);
  });

  it('keeps cars and trams on the roads and boats on open water', () => {
    const t = new TrafficPlan(city);
    let cars = 0;
    let boats = 0;
    for (const [px, pz] of [
      [0, -200],
      [-350, 150],
      [500, -700],
      [0, 600],
      [-200, 1800],
    ]) {
      t.plan(px, pz, 320, 650, 160);
      for (const time of [0, 37, 211]) {
        const n = t.place(time, px, pz, 320, 650, out);
        for (let v = 0; v < n; v++) {
          const w = v * VEHICLE_STRIDE;
          const [kind, x, y, z] = [out[w], out[w + 1], out[w + 2], out[w + 3]];
          if (kind === VEHICLE.FERRY) {
            boats++;
            expect(city.inSea(x, z)).toBe(true);
            // Clear of piers, ships and the expressway's bridge piers.
            expect(city.solidTop(x, 1, z, 2)).toBe(-Infinity);
            continue;
          }
          cars++;
          if (y > 14) {
            // On an expressway deck.
            const I = Math.round(x / city.S);
            const J = Math.round(z / city.S);
            const onX = city.expressX(I) && Math.abs(x - I * city.S) < 7.5;
            const onZ = city.expressZ(J) && Math.abs(z - J * city.S) < 7.5;
            expect(onX || onZ).toBe(true);
            continue;
          }
          const sd = city.shoreDist(x, z);
          const onBay = sd > Config.city.promenade && sd < city.roadIn;
          const u = Math.abs(x - Math.round(x / city.S) * city.S);
          const v2 = Math.abs(z - Math.round(z / city.S) * city.S);
          const onAvenue = Math.min(u, v2) < city.AH - 4;
          expect(onBay || onAvenue).toBe(true);
          expect(city.inSea(x, z)).toBe(false);
          // Riding the road: on the ground, or up on a bridge deck (3.3 m) over the river.
          const h = city.height(x, z);
          expect(y).toBeGreaterThan(h - 0.5);
          expect(y).toBeLessThan(Math.max(h, 3.3) + 0.3);
        }
      }
    }
    expect(cars).toBeGreaterThan(300);
    expect(boats).toBeGreaterThan(5);
  });
});
