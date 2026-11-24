import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { angleDelta } from '../src/core/math';
import { CanyonLayout } from '../src/world/canyon/CanyonLayout';
import { CanyonWorld } from '../src/world/canyon/CanyonWorld';
import { canyonDestinations } from '../src/world/canyon/destinations';
import {
  DestinationTracker,
  type Destination,
  type DestinationSource,
} from '../src/world/Destinations';
import { flyBot } from './helpers';

const SEEDS = [1337, 42, 7, 2024, 99, 5];

/** A destination 1 km north of wherever it is asked from, reached within 30 m. */
function fakeSource(log: { first: boolean; skip: number }[]): DestinationSource {
  let n = 0;
  return {
    next(x, z, _yaw, first, skip) {
      log.push({ first, skip: skip.size });
      const id = `d${n++}`;
      const d: Destination = {
        id,
        name: id,
        x,
        y: 0,
        z: z + 1000,
        route: Float64Array.of(x, z, x, z + 1000),
        roost: { x, y: 0, z: z + 1000, yaw: 0 },
        tint: 0,
        reached: (px, _py, pz) => Math.hypot(px - x, pz - (z + 1000)) < 30,
      };
      return d;
    },
  };
}

describe('destination tracker', () => {
  it('raises the first beacon after a moment, then one after each arrival', () => {
    const log: { first: boolean; skip: number }[] = [];
    const t = new DestinationTracker();
    t.setSource(fakeSource(log));
    const K = Config.destinations;
    expect(t.step(K.firstDelay - 0.5, 0, 20, 0, 0)).toBeNull();
    expect(t.step(1, 0, 20, 0, 0)).toBe('set');
    expect(log[0]).toEqual({ first: true, skip: 0 });
    expect(t.step(1 / 60, 0, 20, 500, 0)).toBeNull();
    expect(t.step(1 / 60, 0, 20, 995, 0)).toBe('arrived');
    expect(t.current).toBeNull();
    expect(t.last!.name).toBe('d0');
    expect(t.reachedNames).toEqual(['d0']);
    // A pause to enjoy it, then the next (no longer the first, the reached one skipped).
    expect(t.step(K.nextDelay - 0.5, 0, 20, 1000, 0)).toBeNull();
    expect(t.step(1, 0, 20, 1000, 0)).toBe('set');
    expect(log[1]).toEqual({ first: false, skip: 1 });
  });

  it('chooses afresh when the bird strays far, and starts over on a new flight', () => {
    const t = new DestinationTracker();
    t.setSource(fakeSource([]));
    t.step(Config.destinations.firstDelay + 1, 0, 20, 0, 0);
    const a = t.current!;
    expect(t.step(1 / 60, Config.destinations.stray + 100, 20, 0, 0)).toBe('set');
    expect(t.current).not.toBe(a);
    t.restart();
    expect(t.current).toBeNull();
    expect(t.reachedNames).toEqual([]);
  });

  it('asks again later when no destination can be found', () => {
    let asked = 0;
    const t = new DestinationTracker();
    t.setSource({
      next: () => {
        asked++;
        return null;
      },
    });
    t.step(Config.destinations.firstDelay + 0.1, 0, 0, 0, 0);
    expect(asked).toBe(1);
    t.step(Config.destinations.retry - 0.5, 0, 0, 0, 0);
    expect(asked).toBe(1);
    t.step(1, 0, 0, 0, 0);
    expect(asked).toBe(2);
  });

  it('does nothing on a level without destinations', () => {
    const t = new DestinationTracker();
    t.setSource(null);
    expect(t.step(100, 0, 0, 0, 0)).toBeNull();
  });
});

describe('canyon destinations', () => {
  it('lead down the canyon ahead to an arch across it, never the Great Arch', () => {
    for (const seed of SEEDS) {
      const L = new CanyonLayout(seed);
      const s = L.spawn;
      const d = canyonDestinations(L).next(s.x, s.z, s.yaw, true, new Set())!;
      expect(d, `seed ${seed}`).not.toBeNull();
      expect(Math.hypot(d.x - L.great.x, d.z - L.great.z)).toBeGreaterThan(100);
      const R = d.route;
      const n = R.length / 2;
      // From the bird's canyon, ahead of it, to the arch, along the canyon floor.
      expect(Math.hypot(R[0] - s.x, R[1] - s.z)).toBeLessThan(60);
      expect(Math.abs(angleDelta(s.yaw, Math.atan2(R[4] - R[0], R[5] - R[1])))).toBeLessThan(1);
      expect(R[n * 2 - 2]).toBe(d.x);
      expect(R[n * 2 - 1]).toBe(d.z);
      let len = 0;
      for (let i = 1; i < n; i++) {
        len += Math.hypot(R[i * 2] - R[i * 2 - 2], R[i * 2 + 1] - R[i * 2 - 1]);
        expect(L.canyon(R[i * 2], R[i * 2 + 1])).toBeLessThan(0);
      }
      expect(len).toBeGreaterThan(Config.destinations.firstRoute - 50);
      expect(len).toBeLessThan(Config.destinations.maxRoute + 100);
      // Through the opening counts; far off or high above it does not.
      expect(d.reached(d.x, d.y + 10, d.z)).toBe(true);
      expect(d.reached(d.x + 200, d.y + 10, d.z)).toBe(false);
      expect(d.reached(d.x, d.y + 400, d.z)).toBe(false);
      // The cairn: on dry floor inside the opening, beside a leg, well under the ribbon's line.
      const a = L.nearArches(d.x, d.z).find((q) => q.x === d.x && q.z === d.z)!;
      const ro = d.roost;
      const u = (ro.x - a.x) * Math.cos(a.yaw) - (ro.z - a.z) * Math.sin(a.yaw);
      const v = (ro.x - a.x) * Math.sin(a.yaw) + (ro.z - a.z) * Math.cos(a.yaw);
      expect(Math.abs(v)).toBeLessThan(0.01);
      expect(Math.abs(u)).toBeLessThanOrEqual(a.r - 4 + 1e-9);
      expect(Math.abs(u)).toBeGreaterThan(L.river(a.x, a.z) + 5);
      expect(ro.y).toBeGreaterThan(0.2);
      expect(ro.y + 3).toBeLessThan(a.y0 + a.h * 0.42);
      expect(L.solidTop(ro.x, ro.y + 1, ro.z, 0)).toBe(-Infinity);
      expect(d.tint).toBeGreaterThanOrEqual(0);
      // Each arch keeps its id and name.
      const again = canyonDestinations(new CanyonLayout(seed)).next(
        s.x,
        s.z,
        s.yaw,
        true,
        new Set(),
      )!;
      expect(again.id).toBe(d.id);
      expect(again.name).toBe(d.name);
      // Once reached, the next is a different arch.
      const next = canyonDestinations(L).next(d.x, d.z, s.yaw, false, new Set([d.id]));
      if (next) expect(next.id).not.toBe(d.id);
    }
  });

  it('the bot, only following the wisps, reaches one destination after another', () => {
    let total = 0;
    for (const seed of SEEDS) {
      const w = new CanyonWorld(seed);
      const t = new DestinationTracker();
      t.setSource(w.destinations);
      const arrivals: number[] = [];
      let time = 0;
      let px = NaN;
      let pz = NaN;
      let yaw = w.layout.spawn.yaw;
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        360,
        (x, y, z) => y < w.layout.ground(x, z) || w.layout.solidTop(x, y, z, 0) > y,
        undefined,
        (x, y, z, wisps) => {
          time += 1 / 60;
          if (Math.hypot(x - px, z - pz) > 0.01) yaw = Math.atan2(x - px, z - pz);
          px = x;
          pz = z;
          const ch = t.step(1 / 60, x, y, z, yaw);
          if (ch === 'set') wisps.setGoal(t.current!.route);
          else if (ch === 'arrived') {
            wisps.setGoal(null);
            arrivals.push(time);
          }
        },
      );
      // The first journey ends within a minute and a half, and more follow. The bot (no
      // flaps, no eyes for the beacon) can lose the ribbon round a tight hairpin, which a
      // player looking at the beacon would not; so each seed only needs two, all six a dozen
      // and a half (about four in six minutes on most).
      expect(arrivals[0], `seed ${seed}`).toBeLessThan(90);
      expect(arrivals.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      total += arrivals.length;
      expect(r.inside).toBe(0);
      expect(r.glances).toBeLessThanOrEqual(3);
    }
    expect(total).toBeGreaterThanOrEqual(18);
  });
});
