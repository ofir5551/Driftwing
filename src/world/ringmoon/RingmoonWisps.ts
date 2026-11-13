import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import type { RingmoonLayout, Spire } from './RingmoonLayout';

type Spawn = (x: number, y: number, z: number) => void;

/**
 * How far a planned path keeps from stone and hull, sideways. Generous: a bird following the
 * ribbon cuts the inside of every bend, and a leaning spire bulges between the samples.
 */
const MARGIN = 9;
/** Slaloms keep further off: in a grove the look-ahead sees stone on both sides at once. */
const SLALOM_MARGIN = 16;
/** And how far above the water and the fronds. */
const ABOVE = 2.5;
/**
 * Most a ribbon drops per wisp (15 m apart): coming down off the mainland's hills a steeper
 * ribbon sent the bird diving to ~40 m/s, too fast to follow the next pattern's bends.
 */
const DESCEND = 3;
/** Headings to try, relative to the trend (radians). */
const TURNS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3];

/**
 * Ringmoon Shallows' wisp patterns. The opening ribbon runs low across the shallows and under
 * the ship's belly, then climbs between the gate spires toward the ringed planet. After that:
 * slaloms through the spire groves, low skims over the water and the islets' fronds, and now
 * and then a long swing round a tall spire, up among its knuckles. Every pattern is planned
 * whole and checked clear before anything spawns, as in the city.
 */
export class RingmoonPlanner implements WispPlanner {
  private introDone = false;
  private readonly pts: number[] = [];
  private readonly best: number[] = [];
  private free = 0;
  private sinceSwing = 2;
  private lastSpire: Spire | null = null;
  /** The ribbon's overall direction (a slow average of its travel), so it never doubles back. */
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };

  constructor(private readonly L: RingmoonLayout) {}

  pattern(c: WispCursor, rand: () => number, spawn: Spawn, free: number): boolean {
    const L = this.L;
    this.free = free;
    if (Math.abs(c.x - this.expect.x) + Math.abs(c.z - this.expect.z) > 1) {
      this.trendX = Math.sin(c.heading);
      this.trendZ = Math.cos(c.heading);
    }
    const base = Math.atan2(this.trendX, this.trendZ);
    if (!this.introDone) {
      this.introDone = true;
      this.pts.length = 0;
      this.underShip(c);
      if (this.commit(c, spawn)) return true;
    }
    // Generic patterns (and their thermal spirals) only out in the open, away from the stone.
    if (rand() < 0.12 && L.skyline(c.x, c.z, 240) === -Infinity) return false;
    this.sinceSwing++;
    if (this.sinceSwing > 3 && rand() < 0.45) {
      this.pts.length = 0;
      if (this.swing(c, base, rand) && this.commit(c, spawn)) {
        this.sinceSwing = 0;
        return true;
      }
    }
    // Slaloms on the flat (water and islets), where the bird arrives at an easy speed.
    const ax = c.x + Math.sin(base) * 120;
    const az = c.z + Math.cos(base) * 120;
    if (this.surface(c.x, c.z) < 16 && this.surface(ax, az) < 16 && L.spiresNear(ax, az, 110) >= 3)
      if (this.slalom(c, base, rand) && this.commit(c, spawn)) return true;
    const n = 11 + Math.floor(rand() * 5);
    const ph = rand();
    for (const turn of TURNS) {
      this.pts.length = 0;
      this.skim(c, base + turn, n, ph);
      if (this.commit(c, spawn)) return true;
    }
    for (const turn of TURNS) {
      this.pts.length = 0;
      this.glide(c, base + turn);
      if (this.commit(c, spawn)) return true;
    }
    return false;
  }

  /** The surface the ribbon rides over: water and the fronds on the islets. */
  private surface(x: number, z: number): number {
    const L = this.L;
    const g = L.height(x, z);
    return Math.max(g + L.canopy(g), Config.world.waterLevel);
  }

  /**
   * The opening run: low over the shallows straight under the middle of the ship's belly, then
   * up and on past it, climbing toward the gate spires' height.
   */
  private underShip(c: WispCursor): void {
    const S = this.L.ship;
    const sp = Config.wisps.spacing;
    const h = Math.atan2(S.x - c.x, S.z - c.z);
    const belly = S.y - S.c;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (let i = 0; i < 26; i++) {
      x += Math.sin(h) * sp;
      z += Math.cos(h) * sp;
      const past = (x - S.x) * Math.sin(h) + (z - S.z) * Math.cos(h);
      // Under the hull: a third of the way up to the belly. Beyond it: climbing away.
      const want =
        past < S.b + 30
          ? Math.min(belly * 0.42, this.surface(x, z) + 9)
          : 12 + (past - S.b - 30) * 0.35;
      y += clamp(want - y, -3, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /**
   * A low skim over the shallows: a gently bending line a few metres over the water or the
   * frond tops, rising and settling in a long, slow swell.
   */
  private skim(c: WispCursor, heading: number, n: number, phase: number): void {
    const sp = Config.wisps.spacing;
    const bend = Math.sin(phase * 9.7) * 0.05;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    let h = heading;
    for (let i = 0; i < n; i++) {
      x += Math.sin(h) * sp;
      z += Math.cos(h) * sp;
      h += bend;
      const want = this.surface(x, z) + 5 + 3 * Math.sin(i * 0.5 + phase * 6);
      y += clamp(want - y, -DESCEND, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /**
   * Weave between the spires: a gentle S along each candidate heading, low over the water. Of
   * the clear candidates, the one that passes most stone closely wins.
   */
  private slalom(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const n = 10;
    const amp = 7 + rand() * 7;
    const ph = rand() < 0.5 ? 0 : Math.PI;
    const lift = 7 + rand() * 10;
    let bestScore = -Infinity;
    for (const turn of TURNS) {
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
        const lat = amp * Math.sin((i / n) * Math.PI * 2 + ph) * Math.min(1, i / 2);
        const wx = x + fz * lat;
        const wz = z - fx * lat;
        y += clamp(this.surface(wx, wz) + lift - y, -DESCEND, Config.wisps.maxRise);
        this.pts.push(wx, y, wz);
        near += L.spiresNear(wx, wz, 40);
      }
      const score = near - Math.abs(turn) * 4;
      if (score <= bestScore || near === 0 || !this.pathClear(c, SLALOM_MARGIN)) continue;
      bestScore = score;
      this.best.length = 0;
      this.best.push(...this.pts);
    }
    if (bestScore === -Infinity) return false;
    this.pts.length = 0;
    this.pts.push(...this.best);
    return true;
  }

  /**
   * Curve round a tall spire ahead: walk forward turning toward a circle round it at a height
   * among its knuckles, far enough out to clear its lean, for about half a turn.
   */
  private swing(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    const P = L.tallSpire(c.x + Math.sin(base) * 170, c.z + Math.cos(base) * 170, 150);
    if (!P || P === this.lastSpire) return false;
    const sp = Config.wisps.spacing;
    const Y = clamp(c.y + 12, 24, P.top * 0.55);
    // The axis at that height, and an orbit clear of the widest the spire gets.
    const ax = P.x + P.lx * (Y - P.y0);
    const az = P.z + P.lz * (Y - P.y0);
    const R0 = P.r * 1.4 + Math.hypot(P.lx, P.lz) * P.h * 0.5 + 24;
    const side = rand() < 0.5 ? 1 : -1;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    let h = c.heading;
    let turned = 0;
    for (let i = 0; i < 24 && turned < Math.PI * 1.05; i++) {
      const dx = x - ax;
      const dz = z - az;
      const d = Math.hypot(dx, dz);
      const tang = Math.atan2(dx, dz) + (side * Math.PI) / 2;
      const want = tang + clamp((d - R0) / 50, -0.9, 0.9) * side;
      const turn = clamp(angleDelta(h, want), -0.3, 0.3);
      h += turn;
      if (d < R0 * 1.7) turned += Math.abs(turn);
      x += Math.sin(h) * sp;
      z += Math.cos(h) * sp;
      y += clamp(Y - y, -DESCEND, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
    if (turned < 1.2) return false;
    this.lastSpire = P;
    return true;
  }

  /** A straight glide easing to a low cruise, rising only to clear stone ahead. */
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
      const floor = Math.max(this.surface(x, z) + 12, L.skyline(x, z, 14) + 10);
      y += clamp(floor - y, -DESCEND, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** The planned polyline (from the cursor) keeps clear of stone, hull and water all along. */
  private pathClear(c: WispCursor, margin = MARGIN): boolean {
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
        if (
          !L.clear(lerp(px, P[k], f), lerp(py, P[k + 1], f), lerp(pz, P[k + 2], f), margin, ABOVE)
        )
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
    const g = this.surface(c.x, c.z);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }
}
