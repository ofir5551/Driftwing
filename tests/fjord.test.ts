import { describe, expect, it } from 'vitest';
import { FJORD_KEYS, MODES } from '../src/audio/scales';
import { Config } from '../src/core/Config';
import { FjordLayout } from '../src/world/fjord/FjordLayout';
import { FjordWorld } from '../src/world/fjord/FjordWorld';
import { flyBot } from './helpers';

const L = new FjordLayout(1337);

describe('fjord layout', () => {
  it('is deterministic per seed', () => {
    const a = new FjordLayout(42);
    const b = new FjordLayout(42);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.lighthouse).toEqual(b.lighthouse);
    expect(a.berg(3, -2)).toEqual(b.berg(3, -2));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
  });

  it('starts the bird mid-fjord, facing along it with open water ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new FjordLayout(seed);
      const s = l.spawn;
      expect(l.fjord(s.x, s.z)).toBeLessThan(-40);
      for (let d = 0; d < 200; d += 4) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.height(x, z)).toBeLessThan(0);
        expect(l.ice(x, z)).toBe(0);
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
      }
    }
  });

  it('raises tall walls to a snowy plateau beside the water', () => {
    const s = L.spawn;
    // Straight across the fjord from the spawn, on either side, the ground climbs high.
    for (const side of [1, -1]) {
      let top = -Infinity;
      for (let d = 0; d < 500; d += 10)
        top = Math.max(
          top,
          L.height(s.x + Math.cos(s.yaw) * d * side, s.z - Math.sin(s.yaw) * d * side),
        );
      expect(top).toBeGreaterThan(100);
    }
  });

  it('floats icebergs only on open water, and puts the lighthouse on the shore', () => {
    let n = 0;
    for (let j = -12; j <= 12; j++)
      for (let i = -12; i <= 12; i++) {
        const b = L.berg(i, j);
        if (!b) continue;
        n++;
        expect(L.fjord(b.x, b.z)).toBeLessThan(-b.r);
      }
    expect(n).toBeGreaterThan(3);
    const h = L.lighthouse;
    expect(L.fjord(h.x, h.z)).toBeGreaterThan(0);
    expect(h.y0).toBeGreaterThan(-1);
  });

  it('pushes a point out of the lighthouse: sideways on the tower, up over the top', () => {
    const h = L.lighthouse;
    const n = { x: 0, y: 0, z: 0 };
    const side = { x: h.x + h.r - 1, y: h.y0 + 10, z: h.z };
    expect(L.pushPoint(side, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(side.x).toBeGreaterThanOrEqual(h.x + h.r + 1 - 1e-9);
    const top = { x: h.x, y: h.y0 + h.h - 0.5, z: h.z };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(top.y).toBeGreaterThanOrEqual(h.y0 + h.h);
  });
});

describe('fjord wisps', () => {
  it('ribbons never sit inside rock or ice, and an autopilot flies them down the fjords', () => {
    for (const seed of [42, 2024]) {
      const w = new FjordWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) => y < w.layout.ground(x, z) || w.layout.solidTop(x, y, z, 0) > y,
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

describe('fjord music', () => {
  it('has a dorian colour and one key per time of day', () => {
    expect(MODES.dorianPenta).toEqual([0, 2, 3, 7, 9]);
    expect(FJORD_KEYS).toHaveLength(5);
    expect(Config.fjord.aurora).toBeGreaterThan(0);
  });
});
