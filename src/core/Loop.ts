/**
 * Fixed-timestep loop with render interpolation ("Fix Your Timestep").
 *
 * Physics always advances in exact STEP increments so flight feel is identical at 30, 60 or
 * 144 fps. Leftover time is passed to render as `alpha` (0..1) so visuals can interpolate
 * between the previous and current physics state and never stutter.
 */
export const STEP = 1 / 60;
const MAX_FRAME = 0.25; // clamp: after a tab switch or hitch, don't try to simulate seconds of catch-up
const MAX_STEPS = 6;

export class Loop {
  private acc = 0;
  private last = -1;
  private raf = 0;
  /** Smoothed frame time in ms, for adaptive quality and the debug readout. */
  frameMs = 16.7;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = this.last < 0 ? STEP : (now - this.last) / 1000;
      this.last = now;
      this.advance(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.last = -1;
  }

  /** Advance by a real frame duration. Public so tests can drive it without rAF. */
  advance(frameDt: number): number {
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME);
    // Ignore hitches (tab switches, GC pauses) so they do not trigger quality drops.
    if (frameDt < 0.1) this.frameMs += (frameDt * 1000 - this.frameMs) * 0.05;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0; // drop the backlog rather than spiral
    this.render(this.acc / STEP, dt);
    return steps;
  }
}
