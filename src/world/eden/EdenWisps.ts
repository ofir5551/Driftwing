import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp } from '../../core/math';
import type { GoalLean } from '../goal';
import type { WispCursor, WispPlanner } from '../Wisps';

/** Headings tried round the way to a stop (radians), straight on first. */
const WAYS = [0, 0.35, -0.35, 0.7, -0.7];

/**
 * Eden's ribbons. With no stop ahead, the Highlands' own patterns. On the way to a stop, gentle
 * swaying runs that always make way toward it (the lowest of a few headings round the way, so
 * a ribbon goes round a hill rather than over it), and on the last stretch one straight,
 * unhurried ribbon through the beacon's light and on past it, gliding down to a low pass. The
 * generic patterns lean toward a goal only a little each pattern; between the zigzagging stops
 * their arcs and thermal spirals could wander off for minutes, and here every stop is part of
 * the story.
 */
export class EdenWisps implements WispPlanner {
  private lean: GoalLean | null = null;

  constructor(private readonly floor: (x: number, z: number) => number) {}

  setGoal(lean: GoalLean): void {
    this.lean = lean;
  }

  pattern(
    c: WispCursor,
    rand: () => number,
    spawn: (x: number, y: number, z: number) => void,
    free: number,
  ): boolean {
    const lean = this.lean;
    if (!lean?.route || lean.threaded) return false;
    const R = lean.route;
    const ex = R[R.length - 2];
    const ez = R[R.length - 1];
    const left = Math.hypot(ex - c.x, ez - c.z);
    return left <= Config.eden.runIn
      ? this.runIn(c, ex, ez, left, spawn, free)
      : this.toward(c, ex, ez, rand, spawn, free);
  }

  /** A swaying run of a few wisps, turning toward the stop by the lowest way. */
  private toward(
    c: WispCursor,
    ex: number,
    ez: number,
    rand: () => number,
    spawn: (x: number, y: number, z: number) => void,
    free: number,
  ): boolean {
    const T = Config.wisps;
    const n = Math.min(free, 8);
    if (n < 3) return false;
    const goal = this.lowWay(c.x, c.z, Math.atan2(ex - c.x, ez - c.z));
    // Turn there over the run, never sharply: a bird must follow it, and a ribbon that turns
    // back on itself lands behind the bird and restarts there, again and again.
    const turn = clamp(angleDelta(c.heading, goal), -0.5, 0.5);
    const sway = (rand() - 0.5) * 18;
    for (let i = 0; i < n; i++) {
      c.heading += turn / n;
      c.x += Math.sin(c.heading) * T.spacing;
      c.z += Math.cos(c.heading) * T.spacing;
      c.clear = clamp(c.clear - T.glideSink, T.cruiseClearance, T.maxClearance);
      this.lift(c, c.clear);
      const s = Math.sin((i / (n - 1)) * Math.PI) * sway;
      spawn(c.x + Math.cos(c.heading) * s, c.y, c.z - Math.sin(c.heading) * s);
    }
    return true;
  }

  /** Straight through the light and a little past, so the ribbon carries the bird out. */
  private runIn(
    c: WispCursor,
    ex: number,
    ez: number,
    left: number,
    spawn: (x: number, y: number, z: number) => void,
    free: number,
  ): boolean {
    const E = Config.eden;
    const T = Config.wisps;
    c.heading = Math.atan2(ex - c.x, ez - c.z);
    const n = Math.min(free, Math.ceil((left + E.runOut) / T.spacing));
    if (n < 3) return false;
    const sx = Math.sin(c.heading) * T.spacing;
    const sz = Math.cos(c.heading) * T.spacing;
    for (let i = 0; i < n; i++) {
      c.x += sx;
      c.z += sz;
      // Ease down toward a low pass at the beacon (it sits on the meadow: no hill to clear).
      const d = Math.hypot(ex - c.x, ez - c.z);
      this.lift(c, lerp(E.passHeight, T.cruiseClearance, clamp(d / 400, 0, 1)));
      c.clear = clamp(c.y - Math.max(this.floor(c.x, c.z), 0), T.cruiseClearance, T.maxClearance);
      spawn(c.x, c.y, c.z);
    }
    return true;
  }

  /** Ease the path's height toward `clear` over the floor, rising no faster than a bird can. */
  private lift(c: WispCursor, clear: number): void {
    const T = Config.wisps;
    const g = Math.max(this.floor(c.x, c.z), Config.world.waterLevel);
    c.y += Math.min((g + clear - c.y) * 0.25, T.maxRise);
    c.y = Math.max(c.y, g + T.minClearance);
  }

  /** Of headings round `goal`, the one whose next ~300 m is lowest (straying costs a little). */
  private lowWay(x: number, z: number, goal: number): number {
    let best = goal;
    let bc = Infinity;
    for (const off of WAYS) {
      const h = goal + off;
      let hi = -Infinity;
      for (let d = 60; d <= 300; d += 60)
        hi = Math.max(hi, this.floor(x + Math.sin(h) * d, z + Math.cos(h) * d));
      const cost = hi + Math.abs(off) * 25;
      if (cost < bc) {
        bc = cost;
        best = h;
      }
    }
    return best;
  }
}
