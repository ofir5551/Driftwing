import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import type { KarstLayout, Pillar } from './KarstLayout';

type Spawn = (x: number, y: number, z: number) => void;

/**
 * How far a planned path keeps from rock and ground. Generous: a bird following the ribbon
 * cuts the inside of every bend, and the rock bulges between the checked samples.
 */
const MARGIN = 9;
/** Slalom headings to try, relative to the cursor's heading (radians). */
const SLALOM_TURNS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
/** Straight glide headings, the last resort before the generic patterns. */
const GLIDE_TURNS = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3];

/**
 * Jade River's wisp patterns. The river is the spine: low ribbons follow its bends just above
 * the water. Between pillars, slaloms weave through the gaps (the clear candidate passing
 * closest to the most rock wins). Now and then a ribbon spirals up round a tall pillar and over
 * its summit, then glides down off the top. Every pattern is planned whole and checked clear of
 * rock and ground before anything spawns, as in the city.
 */
export class KarstPlanner implements WispPlanner {
  private introDone = false;
  private readonly pts: number[] = [];
  private readonly best: number[] = [];
  private free = 0;
  private sinceSpiral = 0;
  private lastPillar: Pillar | null = null;
  private readonly c2 = { x: 0, z: 0 };
  /**
   * The ribbon's overall direction (a slow average of its travel). Every pattern heads within
   * a turn or so of it, so slaloms and river bends wander but the ribbon never doubles back.
   */
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };

  constructor(private readonly L: KarstLayout) {}

  pattern(c: WispCursor, rand: () => number, spawn: Spawn, free: number): boolean {
    const L = this.L;
    this.free = free;
    // A cursor that is not where the last pattern left it was re-anchored at the bird (or
    // moved by a generic pattern): restart the trend from its heading.
    if (Math.abs(c.x - this.expect.x) + Math.abs(c.z - this.expect.z) > 1) {
      this.trendX = Math.sin(c.heading);
      this.trendZ = Math.cos(c.heading);
    }
    const base = Math.atan2(this.trendX, this.trendZ);
    if (!this.introDone) {
      // The opening ribbon follows the river from the spawn, low over the water.
      this.introDone = true;
      this.pts.length = 0;
      this.river(c, c.heading, 14, 14);
      if (this.commit(c, spawn)) return true;
    }
    // Now and then let the generic patterns run (they bring the thermal spirals).
    if (rand() < 0.1) return false;
    this.sinceSpiral++;
    if (this.sinceSpiral > 4 && rand() < 0.3) {
      this.pts.length = 0;
      if (this.spiral(c, base, rand) && this.commit(c, spawn)) {
        this.sinceSpiral = 0;
        return true;
      }
    }
    const along = L.riverHeading(c.x, c.z, base);
    if (L.river(c.x, c.z) < 15 && c.y < 60 && Math.abs(angleDelta(base, along)) < 1.1) {
      this.pts.length = 0;
      this.river(c, along, 9 + rand() * 7, 9 + Math.floor(rand() * 5));
      if (this.commit(c, spawn)) return true;
    }
    if (this.slalom(c, base, rand) && this.commit(c, spawn)) return true;
    for (const turn of GLIDE_TURNS) {
      this.pts.length = 0;
      this.glide(c, base + turn);
      if (this.commit(c, spawn)) return true;
    }
    return false;
  }

  /** Follow the river's bends at `alt` over the water, easing there from the cursor's height. */
  private river(c: WispCursor, heading: number, alt: number, n: number): void {
    const L = this.L;
    const sp = Config.wisps.spacing;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (let i = 0; i < n; i++) {
      heading = L.riverHeading(x, z, heading);
      x += Math.sin(heading) * sp;
      z += Math.cos(heading) * sp;
      // Drift toward the centre line (a damped Newton step, never a jump).
      L.toCentre(x, z, this.c2);
      x += clamp(this.c2.x - x, -6, 6) * 0.4;
      z += clamp(this.c2.z - z, -6, 6) * 0.4;
      y += clamp(alt + 3 * Math.sin(i * 0.7) - y, -4, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /**
   * Weave through the pillars: a gentle S along each candidate heading at a height among the
   * rock. Of the clear candidates, the one that passes most pillar walls closely wins.
   */
  private slalom(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const n = 10;
    const amp = 8 + rand() * 9;
    const phase = rand() < 0.5 ? 0 : Math.PI;
    let bestScore = -Infinity;
    for (const turn of SLALOM_TURNS) {
      this.pts.length = 0;
      const h = base + turn;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      let x = c.x;
      let z = c.z;
      let y = c.y;
      let near = 0;
      for (let i = 0; i < n; i++) {
        x += fx * sp;
        z += fz * sp;
        const lat = amp * Math.sin((i / n) * Math.PI * 2 + phase) * Math.min(1, i / 2);
        const wx = x + fz * lat;
        const wz = z - fx * lat;
        const g = Math.max(L.height(wx, wz), Config.world.waterLevel);
        y += clamp(g + 24 - y, -3.5, Config.wisps.maxRise);
        this.pts.push(wx, y, wz);
        if (L.solidTop(wx, y, wz, 30) !== -Infinity) near++;
      }
      const score = near - Math.abs(turn) * 4;
      if (score <= bestScore || !this.pathClear(c)) continue;
      bestScore = score;
      this.best.length = 0;
      this.best.push(...this.pts);
    }
    if (bestScore === -Infinity) return false;
    this.pts.length = 0;
    this.pts.push(...this.best);
    return true;
  }

  /** Up round a tall pillar ahead and over its summit, leaving along the old heading. */
  private spiral(c: WispCursor, h: number, rand: () => number): boolean {
    const L = this.L;
    const p = L.nearestPillar(c.x + Math.sin(h) * 150, c.z + Math.cos(h) * 150, 120, 60);
    if (!p || p === this.lastPillar) return false;
    const turn = rand() < 0.5 ? 1 : -1;
    let a = Math.atan2(c.x - p.x, c.z - p.z);
    const summit = p.y0 + p.h;
    // Join the pillar at most ~100 m below its summit, so the climb stays a flourish.
    let y = Math.max(clamp(c.y, Math.max(p.y0, 0) + 16, summit - 20), summit - 100);
    // Tall pillars climb a little faster so the spiral fits in the pool.
    const rise = clamp((summit + 10 - y) / 20, 4, 6.5);
    while (y < summit + 6 && this.pts.length < 66) {
      const rr = Math.max(L.axisAt(p, Math.min(y, summit - 0.1)), p.r * 0.3);
      const R = rr + 15;
      this.pts.push(L.ax + Math.sin(a) * R, y, L.az + Math.cos(a) * R);
      a += (turn * Config.wisps.spacing) / R;
      y += rise;
    }
    // Over the crown (and any pavilion) along the way the ribbon was going.
    const sx = p.x + p.lx;
    const sz = p.z + p.lz;
    for (const k of [-1, 0, 1, 2])
      this.pts.push(sx + Math.sin(h) * k * 15, p.top + 9, sz + Math.cos(h) * k * 15);
    this.lastPillar = p;
    return true;
  }

  /** A straight glide that sinks toward cruise height, rising only to clear rock ahead. */
  private glide(c: WispCursor, heading: number): void {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (let i = 0; i < 9; i++) {
      x += fx * sp;
      z += fz * sp;
      const g = Math.max(L.height(x, z), Config.world.waterLevel) + 26;
      const floor = Math.max(g, L.skyline(x, z, 10) + 10);
      y += clamp(floor - y, -4.5, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** The planned polyline (from the cursor) keeps MARGIN from rock and ground all along. */
  private pathClear(c: WispCursor): boolean {
    const P = this.pts;
    const L = this.L;
    let px = c.x;
    let py = c.y;
    let pz = c.z;
    const n = Math.min(P.length, this.free * 3);
    for (let k = 0; k < n; k += 3) {
      const d = Math.hypot(P[k] - px, P[k + 1] - py, P[k + 2] - pz);
      const steps = Math.max(1, Math.ceil(d / 4));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        if (!L.clear(lerp(px, P[k], f), lerp(py, P[k + 1], f), lerp(pz, P[k + 2], f), MARGIN))
          return false;
      }
      px = P[k];
      py = P[k + 1];
      pz = P[k + 2];
    }
    return true;
  }

  /** Spawn the planned wisps if the whole path is clear and move the cursor to its end. */
  private commit(c: WispCursor, spawn: Spawn): boolean {
    const P = this.pts;
    if (P.length > this.free * 3) P.length = this.free * 3;
    if (P.length < 6 || !this.pathClear(c)) return false;
    for (let k = 0; k < P.length; k += 3) spawn(P[k], P[k + 1], P[k + 2]);
    const n = P.length - 3;
    // Trend: blend in a little of this pattern's overall displacement.
    const mx = P[n] - c.x;
    const mz = P[n + 2] - c.z;
    const ml = Math.hypot(mx, mz) || 1;
    const tx = this.trendX * 0.75 + (mx / ml) * 0.25;
    const tz = this.trendZ * 0.75 + (mz / ml) * 0.25;
    const tl = Math.hypot(tx, tz) || 1;
    this.trendX = tx / tl;
    this.trendZ = tz / tl;
    this.expect.x = P[n];
    this.expect.z = P[n + 2];
    c.heading = Math.atan2(P[n] - P[n - 3], P[n + 2] - P[n - 1]);
    // Wisps adds a gap along the heading after each pattern, which would go unchecked: step
    // back by it so the next pattern starts exactly at this one's last wisp.
    c.x = P[n] - Math.sin(c.heading) * Config.wisps.gap;
    c.y = P[n + 1];
    c.z = P[n + 2] - Math.cos(c.heading) * Config.wisps.gap;
    const g = Math.max(this.L.height(c.x, c.z), Config.world.waterLevel);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }
}
