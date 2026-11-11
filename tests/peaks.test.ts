import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { MODES, PEAKS_KEYS } from '../src/audio/scales';
import { PeaksLayout, profile, SHAPES, Temple } from '../src/world/peaks/PeaksLayout';
import { PeaksWorld } from '../src/world/peaks/PeaksWorld';
import { flyBot } from './helpers';

const L = new PeaksLayout(1337);

/** Every spire centred in a square around the origin. */
function spiresAround(layout: PeaksLayout, half: number) {
  const C = Config.peaks.spireCell;
  const out = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++)
      out.push(...layout.cell(i, j));
  return out;
}

describe('peaks layout', () => {
  it('is deterministic per seed', () => {
    const a = new PeaksLayout(42);
    const b = new PeaksLayout(42);
    expect(a.cell(3, -2)).toEqual(b.cell(3, -2));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
    expect(new PeaksLayout(43).cell(3, -2)).not.toEqual(a.cell(9, 9));
  });

  it('starts the bird over the cloud sea with a clear run to the Sky Gate and through it', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new PeaksLayout(seed);
      const s = l.spawn;
      expect(s.y).toBeGreaterThan(l.height(s.x, s.z) + 25);
      for (let d = 0; d < 600; d += 3) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
        // Under the bridge too: the opening ribbon passes 26 m below its deck.
        expect(l.solidTop(x, Config.peaks.bridgeY - 30, z, 3)).toBe(-Infinity);
      }
      // The bridge spans the gap: solid at mid-span, anchored into both spires.
      const b = l.bridge;
      expect(l.solidTop(0, b.y - b.sag, b.z, 0)).toBeGreaterThan(b.y);
      for (const x of [b.x0 + 0.5, b.x1 - 0.5]) {
        const g = l.gate.find((p) => Math.sign(p.x) === Math.sign(x))!;
        expect(Math.abs(x - g.x)).toBeLessThan(l.axisAt(g, b.y));
      }
    }
  });

  it('raises plenty of spires out of the cloud, all under the ceiling', () => {
    const ps = spiresAround(L, 1500);
    expect(ps.length).toBeGreaterThan(150);
    for (const p of ps) {
      expect(p.top).toBeLessThan(Config.peaks.spireTop + 10);
      // The foot is hidden in the cloud sea.
      expect(p.y0).toBeLessThan(L.height(p.x, p.z) - 5);
    }
    expect(ps.filter((p) => p.y0 + p.h > 180).length).toBeGreaterThan(ps.length * 0.15);
    expect(ps.some((p) => p.temple === Temple.Hermitage)).toBe(true);
    expect(ps.filter((p) => p.temple === Temple.Monastery)).toHaveLength(1);
  });

  it('profiles columns that only narrow going up, closed by a summit', () => {
    for (const sh of SHAPES) {
      expect(profile(sh, 0)).toBeGreaterThan(1);
      expect(profile(sh, 0.999)).toBeLessThan(0.4);
      expect(profile(sh, 1)).toBe(0);
      for (let t = 0.06; t < 0.995; t += 0.005)
        expect(profile(sh, t + 0.005)).toBeLessThanOrEqual(profile(sh, t) + 1e-9);
    }
  });

  it('pushes a point out: sideways off a wall, up off a summit, out of the bridge', () => {
    const p = spiresAround(L, 800).find((q) => q.h > 150 && q.shape !== 4)!;
    const n = { x: 0, y: 0, z: 0 };
    const mid = p.y0 + p.h * 0.5;
    const r = L.axisAt(p, mid);
    const flank = { x: L.ax + r - 2, y: mid, z: L.az };
    expect(L.pushPoint(flank, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(L.solidTop(flank.x, flank.y, flank.z, 0.99)).toBe(-Infinity);
    const top = { x: p.x + p.lx, y: p.y0 + p.h - 1, z: p.z + p.lz };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(top.y).toBeGreaterThanOrEqual(p.top);
    const b = L.bridge;
    const under = { x: 0, y: b.y - b.sag - 1, z: b.z };
    expect(L.pushPoint(under, 1, n)).toBeGreaterThan(0);
    expect(n.y).toBe(-1);
    expect(Number.isFinite(under.y)).toBe(true);
  });
});

describe('peaks wisps', () => {
  it('ribbons never sit inside the rock, and an autopilot flies them among the spires', () => {
    for (const seed of [42, 2024]) {
      const w = new PeaksWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) => w.layout.solidTop(x, y, z, 0) !== -Infinity,
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

describe('peaks music', () => {
  it('floats on lydian at sunrise, one key per time of day', () => {
    expect(MODES.lydianPenta).toEqual([0, 2, 4, 6, 9]);
    expect(PEAKS_KEYS).toHaveLength(5);
    expect(PEAKS_KEYS[0].mode).toBe('lydianPenta');
  });
});
