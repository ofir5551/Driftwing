import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { WingBeat } from '../src/player/WingBeat';
import { mulberry32 } from '../src/world/noise';

const DT = 1 / 60;
const CRUISE = Config.flight.cruiseSpeed;

/** Runs a steady glide and counts bursts (transitions from gliding to beating). */
function glide(seconds: number, speed: number, pitch: number, tuck = 0, seed = 7) {
  const w = new WingBeat(mulberry32(seed));
  let bursts = 0;
  let wasBeating = false;
  let edge = 0; // largest |arm| on a frame where a burst starts or ends
  for (let t = 0; t < seconds; t += DT) {
    w.update(DT, 99 + t, 99 + t, speed, pitch, tuck);
    const beating = w.beatsLeft > 0;
    if (beating && !wasBeating) bursts++;
    if (beating !== wasBeating) edge = Math.max(edge, Math.abs(w.arm));
    wasBeating = beating;
  }
  return { bursts, edge };
}

describe('WingBeat', () => {
  it('flaps on its own every few seconds while gliding', () => {
    const { bursts } = glide(60, CRUISE, 0);
    expect(bursts).toBeGreaterThanOrEqual(60 / (Config.bird.idleGapMax * 1.3 + 2));
  });

  it('flaps more often when slow or climbing than in fast level flight', () => {
    const fast = glide(120, CRUISE + 6, 0).bursts;
    expect(glide(120, Config.flight.minSpeed, 0).bursts).toBeGreaterThan(fast);
    expect(glide(120, CRUISE, 0.4).bursts).toBeGreaterThan(fast);
  });

  it('never beats with wings tucked in a dive', () => {
    expect(glide(60, Config.flight.maxSpeed, -0.7, 1).bursts).toBe(0);
  });

  it('blends in and out without snapping', () => {
    // Strokes start and end on the glide pose, and the envelope is near zero at the edges.
    expect(glide(60, Config.flight.minSpeed, 0.3).edge).toBeLessThan(0.05);
  });

  it('a player flap triggers one full-strength stroke', () => {
    const w = new WingBeat(() => 0.99); // long first gap: no idle burst in the way
    for (let t = 0; t < 0.5; t += DT) w.update(DT, 99, 99, CRUISE, 0, 0);
    expect(w.beatsLeft).toBe(0);
    let since = 0;
    let down = 0;
    for (let t = 0; t < Config.bird.flapPeriod * 1.5; t += DT) {
      w.update(DT, since, 99, CRUISE, 0, 0);
      since += DT;
      down = Math.min(down, w.arm);
    }
    expect(down).toBeLessThan(-0.85); // a strong downstroke
    expect(w.beatsLeft).toBe(0);
  });

  it('climb wingbeats keep the wings beating steadily, softer than a flap', () => {
    const w = new WingBeat(() => 0.99);
    let since = 0;
    let beating = 0;
    let down = 0;
    let frames = 0;
    for (let t = 0; t < 3; t += DT) {
      if (since >= Config.flight.climbBeatInterval) since = 0;
      w.update(DT, 99, since, CRUISE, 0.3, 0);
      since += DT;
      frames++;
      if (w.beatsLeft > 0) beating++;
      down = Math.min(down, w.arm);
    }
    expect(beating / frames).toBeGreaterThan(0.8);
    expect(down).toBeLessThan(-0.5);
    expect(down).toBeGreaterThan(-0.9);
  });

  it('only a dive folds the wings, never speed in level or climbing flight', () => {
    const fast = Config.flight.maxSpeed;
    expect(WingBeat.tuck(fast, 0)).toBe(0); // boosted to top speed, level
    expect(WingBeat.tuck(fast, 0.3)).toBe(0); // zooming up out of a dive
    expect(WingBeat.tuck(CRUISE, -0.6)).toBe(1); // steep dive
    expect(WingBeat.tuck(fast, -0.15)).toBeGreaterThan(WingBeat.tuck(CRUISE, -0.15));
  });
});
