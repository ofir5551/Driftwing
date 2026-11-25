import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { slot, spring, toWorld, type Slot } from '../src/world/formation';

const s: Slot = { ahead: 0, right: 0, up: 0 };

describe('flock formation', () => {
  it('keeps every slot ahead of the bird and inside the widening view', () => {
    const F = Config.flock;
    for (let i = 0; i < 40; i++)
      for (const t of [0, 7.3, 51, 300]) {
        slot(i, t, s);
        expect(s.ahead).toBeGreaterThanOrEqual(F.aheadMin - F.drift - 1e-9);
        expect(s.ahead).toBeLessThanOrEqual(F.aheadMax + F.drift + 1e-9);
        expect(Math.abs(s.right)).toBeLessThanOrEqual(
          F.sideMin + F.sideGrow * F.aheadMax + F.drift,
        );
        expect(Math.abs(s.up - F.upMid)).toBeLessThanOrEqual(F.upSpread + F.drift);
      }
  });

  it('spreads the first birds apart', () => {
    const a = { ...slot(0, 0, s) };
    for (let i = 1; i < 6; i++) {
      const b = slot(i, 0, s);
      expect(Math.hypot(b.ahead - a.ahead, b.right - a.right, b.up - a.up)).toBeGreaterThan(1.5);
    }
  });

  it('turns slots into world offsets: ahead along the heading, right is -x facing +z', () => {
    const out = new Float32Array(3);
    toWorld({ ahead: 10, right: 0, up: 0 }, 0, 0, out, 0);
    expect([...out].map((v) => +v.toFixed(5))).toEqual([0, 0, 10]);
    toWorld({ ahead: 0, right: 2, up: 3 }, 0, 0, out, 0);
    expect([...out].map((v) => +v.toFixed(5))).toEqual([-2, 3, 0]);
    toWorld({ ahead: 10, right: 0, up: 0 }, Math.PI / 2, 0, out, 0);
    expect(out[0]).toBeCloseTo(10);
    // Climbing, ahead points up and up tilts back.
    toWorld({ ahead: 0, right: 0, up: 1 }, 0, 0.5, out, 0);
    expect(out[2]).toBeLessThan(0);
  });

  it('springs settle without overshoot, at any step size', () => {
    for (const dt of [1 / 60, 0.1, 0.5]) {
      const x = new Float32Array([10, -4, 0]);
      const v = new Float32Array(3);
      const t = new Float32Array([0, 0, 0]);
      for (let k = 0; k < 5 / dt; k++) {
        spring(x, v, t, 0, 2.2, dt);
        expect(x[0]).toBeGreaterThanOrEqual(-1e-6);
        expect(x[1]).toBeLessThanOrEqual(1e-6);
      }
      expect(Math.abs(x[0]) + Math.abs(x[1])).toBeLessThan(0.05);
    }
  });
});
