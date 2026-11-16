import { Config } from './Config';

/** What the frame that was just fed asks for. */
export type ScaleAction = 'none' | 'scale' | 'preset';

/**
 * Adaptive resolution, as pure logic (no renderer): feed it every frame's duration and it says
 * when to render fewer or more pixels (`scale`), or when the floor is reached and only a lower
 * quality preset can help (`preset`).
 *
 * It judges whole one-second windows by the share of slow frames, not by an average: streaming a
 * row of chunks costs a short burst of long frames, and an average turns that burst into a
 * resolution drop that helps nothing. A drop needs several slow windows in a row. Every change
 * of scale reallocates the post-processing targets (a small hitch of its own), so steps are
 * coarse, and a raise that is undone straight away doubles the wait before the next try: the
 * scale settles instead of sawing up and down for the whole flight.
 */
export class AdaptiveScale {
  /** Resolution multiplier, floor..1. */
  scale = 1;
  private timer = 0;
  private frames = 0;
  private slowFrames = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  private raiseWait = Config.adaptive.raiseAfter;
  private sinceRaise = Infinity;

  /** Back to full resolution and a clean history (a new preset). */
  reset(): void {
    this.scale = 1;
    this.timer = this.frames = this.slowFrames = 0;
    this.slowWindows = this.fastWindows = 0;
    this.raiseWait = Config.adaptive.raiseAfter;
    this.sinceRaise = Infinity;
  }

  /** Feed one frame (seconds). Returns what changed, if anything. */
  frame(dt: number): ScaleAction {
    const A = Config.adaptive;
    // A hitch (tab switch, GC pause, shader compile) says nothing about the steady load.
    if (dt > A.hitchMs / 1000) return 'none';
    this.timer += dt;
    this.frames++;
    if (dt * 1000 > A.slowMs) this.slowFrames++;
    if (this.timer < 1) return 'none';
    const share = this.slowFrames / this.frames;
    this.timer = this.frames = this.slowFrames = 0;
    this.sinceRaise += 1;
    if (share > A.slowShare) {
      this.fastWindows = 0;
      if (++this.slowWindows < A.dropAfter) return 'none';
      this.slowWindows = 0;
      if (this.scale <= A.floor + 1e-6) return 'preset';
      // The last raise did not hold: wait longer before trying again.
      if (this.sinceRaise <= A.raiseHold) this.raiseWait = Math.min(A.raiseMax, this.raiseWait * 2);
      this.scale = Math.max(A.floor, this.scale - A.dropStep);
      return 'scale';
    }
    this.slowWindows = 0;
    if (share < A.fastShare && this.scale < 1) {
      if (++this.fastWindows < this.raiseWait) return 'none';
      this.fastWindows = 0;
      this.sinceRaise = 0;
      this.scale = Math.min(1, this.scale + A.raiseStep);
      return 'scale';
    }
    return 'none';
  }
}
