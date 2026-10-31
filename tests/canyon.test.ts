import { describe, expect, it } from 'vitest';
import { CANYON_KEYS, MODES } from '../src/audio/scales';
import { CANYON_MUSIC } from '../src/audio/styles';
import { Config } from '../src/core/Config';
import { ARCH_OUT_X, CanyonLayout } from '../src/world/canyon/CanyonLayout';
import { CanyonWorld } from '../src/world/canyon/CanyonWorld';
import { flyBot } from './helpers';

const L = new CanyonLayout(1337);

describe('canyon layout', () => {
  it('is deterministic per seed', () => {
    const a = new CanyonLayout(42);
    const b = new CanyonLayout(42);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.great).toEqual(b.great);
    expect(a.arch(3, -2)).toEqual(b.arch(3, -2));
    expect(a.hoodoo(30, -12)).toEqual(b.hoodoo(30, -12));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
  });

  it('starts the bird mid-canyon, facing along it with a clear run ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new CanyonLayout(seed);
      const s = l.spawn;
      expect(l.canyon(s.x, s.z)).toBeLessThan(-25);
      for (let d = 0; d < 150; d += 4) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.height(x, z)).toBeLessThan(5);
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
      }
    }
  });

  it('walls the canyon with rock up to a plateau on both sides', () => {
    const s = L.spawn;
    for (const side of [1, -1]) {
      let top = -Infinity;
      for (let d = 0; d < 400; d += 10)
        top = Math.max(
          top,
          L.height(s.x + Math.cos(s.yaw) * d * side, s.z - Math.sin(s.yaw) * d * side),
        );
      expect(top).toBeGreaterThan(Config.canyon.plateau - Config.canyon.plateauVar * 1.5);
    }
  });

  it('stands the Great Arch across the floor ahead, with the way through it open', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new CanyonLayout(seed);
      const G = l.great;
      expect(Math.hypot(G.x - l.spawn.x, G.z - l.spawn.z)).toBeGreaterThan(200);
      // Both legs on the floor, not in the wall.
      for (const side of [-1, 1]) {
        const u = side * G.r * ARCH_OUT_X;
        const h = l.height(G.x + u * Math.cos(G.yaw), G.z - u * Math.sin(G.yaw));
        expect(h).toBeLessThan(5);
      }
      // Through the middle of the opening, along the way it faces: clear of its rock.
      const y = G.y0 + G.h * 0.42;
      for (let v = -30; v <= 30; v += 2)
        expect(l.inArch(G, G.x + Math.sin(G.yaw) * v, y, G.z + Math.cos(G.yaw) * v, 3)).toBe(false);
      // Its crown and its legs are rock.
      expect(l.inArch(G, G.x, G.y0 + G.h * 1.12, G.z, 0)).toBe(true);
      const u = G.r * 1.15;
      expect(l.inArch(G, G.x + u * Math.cos(G.yaw), G.y0 + 5, G.z - u * Math.sin(G.yaw), 0)).toBe(
        true,
      );
    }
  });

  it('places arches across canyon floors and out on the plateau, and hoodoos on level rock', () => {
    let canyon = 0;
    let plateau = 0;
    for (let j = -10; j <= 10; j++)
      for (let i = -10; i <= 10; i++) {
        const a = L.arch(i, j);
        if (!a) continue;
        if (a.canyon) {
          canyon++;
          expect(L.canyon(a.x, a.z)).toBeLessThan(-a.r);
        } else {
          plateau++;
          expect(L.canyon(a.x, a.z)).toBeGreaterThan(Config.canyon.wall);
        }
      }
    expect(canyon).toBeGreaterThan(5);
    expect(plateau).toBeGreaterThan(5);
    let hoodoos = 0;
    for (let j = -60; j <= 60; j++)
      for (let i = -60; i <= 60; i++) {
        const hd = L.hoodoo(i, j);
        if (!hd) continue;
        hoodoos++;
        expect(L.height(hd.x, hd.z)).toBeGreaterThan(10);
      }
    expect(hoodoos).toBeGreaterThan(50);
  });

  it('pushes a point out of an arch: over its back, under its span, off its legs', () => {
    const G = L.great;
    const n = { x: 0, y: 0, z: 0 };
    const back = { x: G.x, y: G.y0 + G.h * 1.2, z: G.z };
    expect(L.pushPoint(back, 1, n)).toBeGreaterThan(0);
    expect(n.y).toBeGreaterThan(0.9);
    expect(L.inArch(G, back.x, back.y, back.z, 1)).toBe(false);
    const under = { x: G.x, y: G.y0 + G.h + 1.5, z: G.z };
    L.pushPoint(under, 1, n);
    expect(n.y).toBeLessThan(-0.9);
    expect(L.inArch(G, under.x, under.y, under.z, 1)).toBe(false);
    const u = G.r * 1.04;
    const leg = { x: G.x + u * Math.cos(G.yaw), y: G.y0 + 4, z: G.z - u * Math.sin(G.yaw) };
    L.pushPoint(leg, 1, n);
    expect(Math.abs(n.y)).toBeLessThan(0.1);
    expect(L.inArch(G, leg.x, leg.y, leg.z, 1)).toBe(false);
    for (const p of [back, under, leg]) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
  });
});

describe('canyon wisps', () => {
  it('ribbons never sit inside rock, and an autopilot flies them down the canyons', () => {
    for (const seed of [42, 2024]) {
      const w = new CanyonWorld(seed);
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

describe('canyon music', () => {
  it('has a mixolydian twang and one key per time of day', () => {
    expect(MODES.dominantPenta).toEqual([0, 2, 4, 7, 10]);
    expect(CANYON_KEYS).toHaveLength(5);
    expect(CANYON_MUSIC.voice).toBe('guitar');
  });
});
