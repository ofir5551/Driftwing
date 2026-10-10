import { describe, expect, it } from 'vitest';
import { Loop, STEP } from '../src/core/Loop';

describe('Loop', () => {
  it('steps physics at a fixed rate regardless of frame rate and reports interpolation alpha', () => {
    let steps = 0;
    let alpha = -1;
    const loop = new Loop(
      () => steps++,
      (a) => (alpha = a),
    );
    for (let i = 0; i < 30; i++) loop.advance(1 / 30); // 1 s at 30 fps
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });

  it('clamps huge frame times instead of spiralling', () => {
    let steps = 0;
    const loop = new Loop(
      () => steps++,
      () => {},
    );
    loop.advance(10);
    expect(steps).toBeLessThanOrEqual(6);
    expect(STEP).toBeCloseTo(1 / 60);
  });
});
