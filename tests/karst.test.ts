import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { angleDelta, clamp } from '../src/core/math';
import { KARST_KEYS, MODES } from '../src/audio/scales';
import { createFlightState, stepFlight, type FlightInput } from '../src/player/FlightModel';
import { KarstLayout, profile, SHAPES } from '../src/world/karst/KarstLayout';
import { KarstWorld } from '../src/world/karst/KarstWorld';
import { Wisps } from '../src/world/Wisps';

const L = new KarstLayout(1337);

/** Every pillar centred in a square around the origin. */
function pillarsAround(layout: KarstLayout, half: number) {
  const C = Config.karst.pillarCell;
  const out = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++)
      out.push(...layout.cell(i, j));
  return out;
}

describe('karst layout', () => {
  it('is deterministic per seed', () => {
    const a = new KarstLayout(42);
    const b = new KarstLayout(42);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.cell(3, -2)).toEqual(b.cell(3, -2));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
  });

  it('starts the bird on a river, facing along it with open water ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new KarstLayout(seed);
      const s = l.spawn;
      expect(l.river(s.x, s.z)).toBeLessThan(0);
      expect(l.height(s.x, s.z)).toBeLessThan(0);
      for (let d = 0; d < 150; d += 3) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
      }
    }
  });

  it('scatters plenty of pillars, all clear of the rivers and under the ceiling', () => {
    const ps = pillarsAround(L, 1200);
    expect(ps.length).toBeGreaterThan(250);
    for (const p of ps) {
      expect(L.river(p.x, p.z)).toBeGreaterThan(p.r);
      expect(p.top).toBeLessThan(Config.karst.pillarTop + 15);
    }
    // A forest of peaks, not a uniform field: a good share stands taller than 100 m.
    expect(ps.filter((p) => p.h > 100).length).toBeGreaterThan(ps.length * 0.15);
    expect(ps.some((p) => p.pavilion)).toBe(true);
  });

  it('profiles a closed summit dome with a flared foot', () => {
    for (const sh of SHAPES) {
      expect(profile(sh, 0)).toBeGreaterThan(1);
      expect(profile(sh, 0.999)).toBeLessThan(0.1);
      expect(profile(sh, 1)).toBe(0);
    }
  });

  it('pushes a point out of a pillar: sideways on the flank, up on the summit', () => {
    const p = pillarsAround(L, 600).find((q) => q.h > 90 && q.shape !== 3)!;
    const n = { x: 0, y: 0, z: 0 };
    const mid = p.y0 + p.h * 0.4;
    const r = L.axisAt(p, mid);
    const flank = { x: L.ax + r - 2, y: mid, z: L.az };
    expect(L.pushPoint(flank, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(L.solidTop(flank.x, flank.y, flank.z, 0.99)).toBe(-Infinity);
    const top = { x: p.x + p.lx, y: p.y0 + p.h - 1, z: p.z + p.lz };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(top.y).toBeGreaterThanOrEqual(p.top);
  });
});

describe('karst wisps', () => {
  /** Autopilot (the same steering as the title-screen bot) over the river and pillars. */
  function fly(seed: number, seconds: number) {
    const w = new KarstWorld(seed);
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
    w.dispose();
    return { got, glances, inside };
  }

  it('ribbons never sit inside the rock, and an autopilot flies them among the pillars', () => {
    for (const seed of [42, 2024]) {
      const r = fly(seed, 120);
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

describe('karst music', () => {
  it('walks the Chinese modes, one key per time of day', () => {
    expect(MODES.jue).toEqual([0, 3, 5, 8, 10]);
    expect(KARST_KEYS).toHaveLength(5);
  });
});
