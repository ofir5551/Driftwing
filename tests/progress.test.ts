import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { Progress } from '../src/core/Progress';

const FlowTuning = Config.flow;

describe('Progress / flow', () => {
  it('chains pickups made in quick succession and builds flow', () => {
    const p = new Progress();
    for (let i = 0; i < 5; i++) {
      p.collect();
      p.update(0.6);
    }
    expect(p.chain).toBe(5);
    expect(p.flow).toBeGreaterThan(5 * FlowTuning.gain);
  });

  it('breaks the chain after the window and starts draining flow', () => {
    const p = new Progress();
    p.collect();
    p.collect();
    const flow = p.flow;
    p.update(FlowTuning.chainWindow + 0.1);
    expect(p.chain).toBe(0);
    expect(p.flow).toBeLessThan(flow); // past grace too (grace < window)
    p.collect();
    expect(p.chain).toBe(1);
  });

  it('decays slowly and never below zero', () => {
    const p = new Progress();
    for (let i = 0; i < 30; i++) p.collect();
    expect(p.flow).toBe(1);
    p.update(FlowTuning.grace + 5);
    expect(p.flow).toBeGreaterThan(0.5); // slow: after 5 s of draining most flow remains
    for (let i = 0; i < 100; i++) p.update(1);
    expect(p.flow).toBe(0);
  });

  it('flow multiplies points', () => {
    const p = new Progress();
    const first = p.collect().points;
    for (let i = 0; i < 30; i++) p.collect();
    const later = p.collect().points;
    expect(first).toBeGreaterThanOrEqual(FlowTuning.basePoints);
    expect(later).toBe(FlowTuning.basePoints * (1 + FlowTuning.flowMultiplier));
  });

  it('lights a lantern every N wisps and tracks best', () => {
    const p = new Progress();
    let lanterns = 0;
    for (let i = 0; i < FlowTuning.wispsPerLantern * 2; i++) if (p.collect().lantern) lanterns++;
    expect(lanterns).toBe(2);
    expect(p.lanterns).toBe(2);
    const best = p.best;
    p.reset();
    expect(p.score).toBe(0);
    p.best = best;
    expect(p.best).toBeGreaterThan(0);
  });
});

describe('Progress / tricks', () => {
  it('a trick builds flow and points but no lantern progress', () => {
    const p = new Progress();
    const { points } = p.trick('loop', 1, false);
    expect(points).toBeGreaterThan(FlowTuning.basePoints);
    expect(p.flow).toBeGreaterThan(FlowTuning.gain);
    expect(p.count).toBe(0);
  });

  it('repeats pay less, variety pays more', () => {
    const p = new Progress();
    p.trick('roll', 1, false);
    expect(p.trick('roll', 1, false).variety).toBe(FlowTuning.trickRepeat);
    expect(p.trick('loop', 1, false).variety).toBe(FlowTuning.trickVariety);
    expect(p.trick('roll', 1, false).variety).toBe(1); // one of the last two
  });

  it('an arch multiplies a trick', () => {
    const a = new Progress();
    const b = new Progress();
    const plain = a.trick('dive', 1, false).points;
    const arched = b.trick('dive', 1, true).points;
    expect(arched).toBeGreaterThan(plain * (FlowTuning.archMultiplier - 0.5));
    expect(b.flow).toBeCloseTo(a.flow * FlowTuning.archMultiplier, 5);
  });

  it('tricks keep a wisp chain alive', () => {
    const p = new Progress();
    p.collect();
    p.update(FlowTuning.chainWindow * 0.7);
    p.trick('roll', 1, false);
    p.update(FlowTuning.chainWindow * 0.7);
    p.collect();
    expect(p.chain).toBe(2);
  });
});
