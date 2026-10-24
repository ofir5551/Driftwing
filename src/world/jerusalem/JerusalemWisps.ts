import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import type { JerusalemLayout, Landmark } from './JerusalemLayout';

type Spawn = (x: number, y: number, z: number) => void;

/**
 * How far a planned path keeps from stone, roofs and ground. Generous: a bird following the
 * ribbon cuts the inside of every bend.
 */
const MARGIN = 9;
/** Swoop headings to try, relative to the trend (radians). */
const TURNS = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1];
/** Height a swoop keeps over the soft ground: lower over roofs, where the view is. */
const OVER_ROOFS = 12;
const OVER_LAND = 16;
/** Most a ribbon sinks per wisp (a glide down, never a plunge). */
const SINK = 4;

/**
 * City of Gold's wisp patterns. The opening ribbon glides down off the Mount of Olives,
 * across the Kidron and over the east wall, swings round the golden dome and runs low over the
 * roofs down David Street to Jaffa Gate. After that: swoops that hug the land (over the roofs, down into the valleys and
 * up over the ridges) weaving gently either side of a slowly turning trend; runs along the
 * Kidron, the Hinnom and the wadis; and now and then a climbing swing round a minaret, a bell
 * tower or a dome. Every pattern is planned whole and checked clear of stone and ground before
 * anything spawns.
 */
export class JerusalemPlanner implements WispPlanner {
  /**
   * Opening stages: 0 down off the Mount of Olives and across the Kidron, 1 round the golden
   * dome, 2 west along David Street to Jaffa Gate, 3 done.
   */
  private intro = 0;
  private readonly pts: number[] = [];
  private readonly best: number[] = [];
  private readonly req: number[] = [];
  private free = 0;
  private sinceSwing = 0;
  private lastLandmark: Landmark | null = null;
  private readonly c2 = { x: 0, z: 0 };
  /** The ribbon's overall direction (a slow average of its travel), so it never doubles back. */
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };

  constructor(private readonly L: JerusalemLayout) {}

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
    if (this.intro < 3) {
      const stage = this.intro++;
      this.pts.length = 0;
      if (stage === 0) this.run(c, [[-335, -92]], OVER_LAND);
      else if (stage === 1) this.swing(c, Math.PI / 2, L.dome);
      else
        this.run(
          c,
          [
            [-110, -42],
            [315, -42],
          ],
          OVER_ROOFS,
        );
      if (this.commit(c, spawn)) return true;
      this.intro = 3;
    }
    // Now and then let the generic patterns run (they bring the thermal spirals), but only
    // over open land: they don't plan round stone.
    const ax = c.x + Math.sin(base) * 120;
    const az = c.z + Math.cos(base) * 120;
    if (rand() < 0.12 && L.skyline(ax, az, 200) === -Infinity && !L.inOldCity(ax, az, -200))
      return false;
    this.sinceSwing++;
    if (this.sinceSwing > 3 && rand() < 0.4) {
      this.pts.length = 0;
      if (this.swing(c, base) && this.commit(c, spawn)) {
        this.sinceSwing = 0;
        return true;
      }
    }
    // Down a valley, low over its floor, when it runs the way the ribbon is going.
    const vd = L.valleyAt(c.x, c.z, base);
    if (vd < 60 && Math.abs(angleDelta(base, L.vh)) < 1.0 && rand() < 0.7) {
      this.pts.length = 0;
      this.valley(c, L.vh, 10 + Math.floor(rand() * 5));
      this.lift(c, OVER_ROOFS);
      if (this.commit(c, spawn)) return true;
    }
    if (this.swoop(c, base, rand, 4 + rand() * 7) && this.commit(c, spawn)) return true;
    // Hemmed in: a straight glide, still clear of everything, before the generic patterns.
    if (this.swoop(c, base, rand, 0) && this.commit(c, spawn)) return true;
    return false;
  }

  /** A straight run through `way` points from the cursor, `clear` over the ground. */
  private run(c: WispCursor, way: [number, number][], clear: number): void {
    const sp = Config.wisps.spacing;
    let x = c.x;
    let z = c.z;
    for (const [wx, wz] of way) {
      const n = Math.max(1, Math.round(Math.hypot(wx - x, wz - z) / sp));
      const x0 = x;
      const z0 = z;
      for (let k = 1; k <= n; k++) {
        x = lerp(x0, wx, k / n);
        z = lerp(z0, wz, k / n);
        this.pts.push(x, 0, z);
      }
    }
    this.lift(c, clear);
  }

  /** Along a valley's floor line, drifting toward its centre. */
  private valley(c: WispCursor, heading: number, n: number): void {
    const L = this.L;
    const sp = Config.wisps.spacing;
    let x = c.x;
    let z = c.z;
    for (let i = 0; i < n; i++) {
      L.valleyAt(x, z, heading);
      heading += clamp(angleDelta(heading, L.vh), -0.25, 0.25);
      x += Math.sin(heading) * sp;
      z += Math.cos(heading) * sp;
      L.toValley(x, z, this.c2);
      x += clamp(this.c2.x - x, -8, 8) * 0.35;
      z += clamp(this.c2.z - z, -8, 8) * 0.35;
      this.pts.push(x, 0, z);
    }
  }

  /**
   * Swoop along each candidate heading: a gentle S either side of it that hugs the land.
   * Of the clear candidates, the one passing most roofs and stone (the view) wins.
   */
  private swoop(c: WispCursor, base: number, rand: () => number, amp: number): boolean {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const n = 10;
    const phase = rand() < 0.5 ? 0 : Math.PI;
    let bestScore = -Infinity;
    for (const turn of TURNS) {
      this.pts.length = 0;
      const h = base + turn;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      let x = c.x;
      let z = c.z;
      for (let i = 0; i < n; i++) {
        x += fx * sp;
        z += fz * sp;
        const lat = amp * Math.sin((i / n) * Math.PI * 2 + phase) * Math.min(1, i / 2);
        this.pts.push(x + fz * lat, 0, z - fx * lat);
      }
      this.lift(c, OVER_LAND);
      // Prefer the trend, and above all a smooth join to the last pattern: a sharp corner
      // between two ribbons is where a bird (and the bot) overshoots.
      let score = -Math.abs(turn) * 2 - Math.abs(angleDelta(c.heading, h)) * 5;
      const P = this.pts;
      for (let k = 0; k < P.length; k += 3) {
        L.at(P[k], P[k + 2]);
        score += (L.fabric + L.town) * 0.25 + L.valley * 0.2;
        if (L.solidTop(P[k], P[k + 1], P[k + 2], 28) !== -Infinity) score += 0.5;
      }
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

  /**
   * Heights for the planned x, z: `clear` over the soft ground (less over roofs), hopping
   * walls and towers with room to spare. A backward pass starts climbs early enough that no
   * wisp rises more than a bird can follow, and it looks on past the pattern's end along its
   * last heading, so a ribbon never dives into a valley it cannot climb out of (the far side
   * of the Kidron is steeper than a ribbon may rise). Descents are limited to a glide.
   */
  private lift(c: WispCursor, clear: number): void {
    const P = this.pts;
    const R = this.req;
    const n = P.length / 3;
    const rise = Config.wisps.maxRise * 0.9;
    const sp = Config.wisps.spacing;
    R.length = n;
    for (let i = 0; i < n; i++) R[i] = this.need(P[i * 3], P[i * 3 + 2], clear);
    if (n >= 2) {
      const lx = P[n * 3 - 3];
      const lz = P[n * 3 - 1];
      const dx = lx - P[n * 3 - 6];
      const dz = lz - P[n * 3 - 4];
      const dl = Math.hypot(dx, dz) || 1;
      let ahead = -Infinity;
      for (let k = 8; k >= 1; k--)
        ahead = Math.max(
          ahead - rise,
          this.need(lx + (dx / dl) * sp * k, lz + (dz / dl) * sp * k, clear),
        );
      R[n - 1] = Math.max(R[n - 1], ahead - rise);
    }
    for (let i = n - 2; i >= 0; i--) R[i] = Math.max(R[i], R[i + 1] - rise);
    let y = c.y;
    for (let i = 0; i < n; i++) {
      y = Math.min(Math.max(R[i], y - SINK), y + Config.wisps.maxRise);
      P[i * 3 + 1] = y;
    }
  }

  /** Lowest a wisp may fly at (x, z): over the soft ground, well over any wall or tower. */
  private need(x: number, z: number, clear: number): number {
    const L = this.L;
    L.at(x, z);
    const over = L.fabric + L.town > 0.5 ? OVER_ROOFS : clear;
    return Math.max(L.y + L.canopyH + over, L.skyline(x, z, 14) + 11);
  }

  /**
   * Swing round a landmark ahead (a minaret, a bell tower, a dome), or the one given: in
   * from behind it, round one flank climbing toward its top, out ahead along heading h. Never
   * more than a half turn, so the bird never faces back down its own ribbon (a full spiral
   * had the bot circling back for every wisp it missed).
   */
  private swing(c: WispCursor, h: number, given?: Landmark): boolean {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const p = given ?? L.landmarkNear(c.x + Math.sin(h) * 150, c.z + Math.cos(h) * 150, 110, 18);
    if (!p || p === this.lastLandmark) return false;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const R = p.reach + 16;
    if (Math.hypot(dx, dz) < R + 20) return false;
    if (!given && Math.abs(angleDelta(h, Math.atan2(dx, dz))) > 0.8) return false;
    // Keep it on the side it already lies (right of the heading is (-cos h, sin h)).
    const s = -dx * Math.cos(h) + dz * Math.sin(h) > 0 ? 1 : -1;
    const sweep = Math.PI - 0.7;
    const n = Math.max(5, Math.round((R * sweep) / sp));
    const lo = L.ground(p.x, p.z) + 20;
    let y = Math.max(lo, Math.min(c.y, Math.max(lo, p.top - 15)));
    const rise = Math.min(Config.wisps.maxRise * 0.8, Math.max(0, (p.top + 9 - y) / n));
    // Step in from the cursor to the arc's start, then round the flank.
    let a = h + s * (Math.PI - 0.35);
    const sx = p.x + Math.sin(a) * R;
    const sz = p.z + Math.cos(a) * R;
    const gap = Math.hypot(sx - c.x, sz - c.z);
    for (let k = 1; k < gap / sp; k++)
      this.pts.push(lerp(c.x, sx, (k * sp) / gap), y, lerp(c.z, sz, (k * sp) / gap));
    for (let k = 0; k <= n; k++) {
      a = h + s * (Math.PI - 0.35 - (k / n) * sweep);
      this.pts.push(p.x + Math.sin(a) * R, y, p.z + Math.cos(a) * R);
      y += rise;
    }
    const ex = p.x + Math.sin(a) * R;
    const ez = p.z + Math.cos(a) * R;
    for (const k of [1, 2]) this.pts.push(ex + Math.sin(h) * k * sp, y, ez + Math.cos(h) * k * sp);
    this.lastLandmark = p;
    return true;
  }

  /** The planned polyline (from the cursor) keeps MARGIN from stone and ground all along. */
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
    const g = this.L.ground(c.x, c.z);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }
}
