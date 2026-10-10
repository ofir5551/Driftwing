import { describe, expect, it } from 'vitest';
import { createNoise2D, fbm, hash2, mulberry32 } from '../src/world/noise';

describe('noise', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
    for (const v of sa) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('simplex noise is deterministic, seed-dependent and bounded', () => {
    const n1 = createNoise2D(7);
    const n2 = createNoise2D(7);
    const n3 = createNoise2D(8);
    let diff = 0;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37 - 50;
      const y = i * 0.11 + 3;
      const v = n1(x, y);
      expect(v).toBe(n2(x, y));
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
      diff += Math.abs(v - n3(x, y));
    }
    expect(diff).toBeGreaterThan(10);
  });

  it('noise is continuous', () => {
    const n = createNoise2D(1);
    for (let i = 0; i < 100; i++) {
      const x = i * 1.3;
      expect(Math.abs(n(x, 2) - n(x + 0.001, 2))).toBeLessThan(0.01);
    }
  });

  it('fbm stays in range and hash2 is stable', () => {
    const n = createNoise2D(3);
    for (let i = 0; i < 200; i++)
      expect(Math.abs(fbm(n, i * 0.7, -i * 0.3, 5))).toBeLessThanOrEqual(1);
    expect(hash2(10, -4, 9)).toBe(hash2(10, -4, 9));
    expect(hash2(10, -4, 9)).not.toBe(hash2(11, -4, 9));
  });
});
