import { beforeEach, describe, expect, it } from 'vitest';
import { AdaptiveScale } from '../src/core/AdaptiveScale';
import { Config } from '../src/core/Config';

const A = Config.adaptive;

/** Feed `seconds` of frames of `ms` each; returns the actions that were not 'none'. */
function run(a: AdaptiveScale, ms: number, seconds: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const r = a.frame(ms / 1000);
    if (r !== 'none') out.push(r);
  }
  return out;
}

describe('AdaptiveScale', () => {
  let a: AdaptiveScale;
  beforeEach(() => {
    a = new AdaptiveScale();
  });

  it('holds full resolution at 60 fps', () => {
    expect(run(a, 16.7, 30)).toEqual([]);
    expect(a.scale).toBe(1);
  });

  it('drops only after several slow seconds in a row', () => {
    expect(run(a, 30, 1.2)).toEqual([]);
    expect(run(a, 30, 1.2)).toEqual(['scale']);
    expect(a.scale).toBeCloseTo(1 - A.dropStep);
  });

  it('ignores a burst of long frames inside a fast second (chunk streaming)', () => {
    for (let s = 0; s < 20; s++) {
      // A quarter of each second in 30 ms frames, the rest at 60 fps.
      for (let i = 0; i < 8; i++) expect(a.frame(0.03)).toBe('none');
      for (let i = 0; i < 46; i++) expect(a.frame(1 / 60)).toBe('none');
    }
    expect(a.scale).toBe(1);
  });

  it('does not count hitches', () => {
    for (let i = 0; i < 50; i++) expect(a.frame(0.2)).toBe('none');
    expect(a.scale).toBe(1);
  });

  it('asks for a lower preset at the floor, and never goes below it', () => {
    const actions = run(a, 30, 40);
    expect(actions).toContain('preset');
    expect(a.scale).toBeCloseTo(A.floor);
    expect(actions.filter((x) => x === 'scale').length).toBe(Math.ceil((1 - A.floor) / A.dropStep));
  });

  it('creeps back up when frames are fast, to at most 1', () => {
    run(a, 30, 2.4);
    const low = a.scale;
    expect(run(a, 16.7, A.raiseAfter + 1.5)).toEqual(['scale']);
    expect(a.scale).toBeCloseTo(low + A.raiseStep);
    run(a, 16.7, 60);
    expect(a.scale).toBe(1);
  });

  it('waits longer before each raise that does not hold', () => {
    // A device that is fast below full resolution and slow at it.
    const changes: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 400; i++) {
      const ms = a.scale > 0.9 ? 30 : 16.7;
      t += ms / 1000;
      if (a.frame(ms / 1000) === 'scale') changes.push(t);
    }
    const gaps = changes.slice(1).map((c, i) => c - changes[i]);
    // The raises thin out: the last gap between changes is far longer than the first.
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[1] * 4);
    expect(changes.length).toBeLessThan(20);
  });

  it('reset returns to full resolution', () => {
    run(a, 30, 10);
    a.reset();
    expect(a.scale).toBe(1);
  });
});
