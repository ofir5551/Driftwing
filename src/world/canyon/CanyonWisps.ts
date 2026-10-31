import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import type { Arch, CanyonLayout } from './CanyonLayout';

type Spawn = (x: number, y: number, z: number) => void;

/** How far a planned path keeps from rock and water (the bird cuts the inside of bends). */
const MARGIN = 9;
/** Glide headings to try, relative to the trend heading (radians). */
const GLIDE_TURNS = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3];
/** Last resort: wheel round. */
const WIDE_TURNS = [1.9, -1.9, 2.5, -2.5, Math.PI];
/** Within this far (m) of an arch, a canyon run lines up to fly through its opening. */
const ARCH_REACH = 95;
/** Share of an arch's rise a ribbon threads it at. */
const ARCH_THREAD = 0.42;

/**
 * Red Canyons' wisp patterns. The canyon is the spine: low ribbons run down it between the
 * walls, swinging from side to side over the river, and line up to thread each arch they come
 * to, the Great Arch first. Glides carry on over the rims and the plateau (or dive back into a
 * canyon), and generic patterns, with their thermal spirals, run only far out in the desert.
 * Every pattern is planned whole and checked clear before anything spawns, and a slowly
 * updated trend heading keeps the ribbon from doubling back (as in Jade River and the fjords).
 */
export class CanyonPlanner implements WispPlanner {
  private introDone = false;
  private readonly pts: number[] = [];
  private free = 0;
  private readonly c2 = { x: 0, z: 0 };
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };

  constructor(private readonly L: CanyonLayout) {}

  pattern(c: WispCursor, rand: () => number, spawn: Spawn, free: number): boolean {
    const L = this.L;
    this.free = free;
    if (Math.abs(c.x - this.expect.x) + Math.abs(c.z - this.expect.z) > 1) {
      this.trendX = Math.sin(c.heading);
      this.trendZ = Math.cos(c.heading);
    }
    const base = Math.atan2(this.trendX, this.trendZ);
    if (!this.introDone) {
      // The opening ribbon runs down the canyon from the spawn and through the Great Arch.
      this.introDone = true;
      this.pts.length = 0;
      this.canyon(c, c.heading, 22, 26, 0);
      if (this.commit(c, spawn)) return true;
    }
    const K = Config.canyon;
    // Now and then let the generic patterns run (they bring the thermal spirals), but only far
    // out in the desert: they know nothing of walls and would ask for a climb no bird can make.
    if (rand() < 0.15 && L.canyon(c.x, c.z) > K.wall + 220) return false;
    const along = L.heading(c.x, c.z, base);
    if (L.canyon(c.x, c.z) < 0 && c.y < 70 && Math.abs(angleDelta(base, along)) < 1.2) {
      this.pts.length = 0;
      this.canyon(c, along, 12 + rand() * 14, 10 + Math.floor(rand() * 6), (rand() - 0.5) * 0.9);
      if (this.commit(c, spawn)) return true;
    }
    for (const turn of GLIDE_TURNS) {
      this.pts.length = 0;
      this.glide(c, base + turn);
      if (this.commit(c, spawn)) return true;
    }
    // Hemmed in (a tight bend, under an arch): follow the canyon either way, or turn wide,
    // rather than hand over to the generic patterns, which would climb straight up the wall.
    if (L.canyon(c.x, c.z) < 0)
      for (const h of [along, along + Math.PI]) {
        this.pts.length = 0;
        this.canyon(c, h, 16, 10, 0);
        if (this.commit(c, spawn)) return true;
      }
    for (const turn of WIDE_TURNS) {
      this.pts.length = 0;
      this.glide(c, base + turn);
      if (this.commit(c, spawn)) return true;
    }
    return false;
  }

  /** The canyon arch nearest (x, z) within ARCH_REACH, if any. */
  private archNear(x: number, z: number): Arch | null {
    let best: Arch | null = null;
    let bd = ARCH_REACH;
    for (const a of this.L.nearArches(x, z)) {
      if (!a.canyon) continue;
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /**
   * Follow the canyon's bends at `alt` over the floor, easing there from the cursor's height,
   * swinging `sway` (fraction of the floor's half width) to one side and back. Near an arch the
   * line pulls to the middle and to the height of the opening, so it threads it.
   */
  private canyon(c: WispCursor, heading: number, alt: number, n: number, sway: number): void {
    const L = this.L;
    const sp = Config.wisps.spacing;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (let i = 0; i < n; i++) {
      heading = L.heading(x, z, heading);
      x += Math.sin(heading) * sp;
      z += Math.cos(heading) * sp;
      // Drift toward a line offset from the centre (a damped Newton step, never a jump).
      L.toCentre(x, z, this.c2);
      const cw = L.cw; // read before archNear, which may run more canyon queries
      const a = this.archNear(x, z);
      const off = a ? 0 : sway * cw * Math.sin((i / n) * Math.PI);
      const tx = this.c2.x + Math.cos(heading) * off;
      const tz = this.c2.z - Math.sin(heading) * off;
      const pull = a ? 0.7 : 0.4;
      x += clamp(tx - x, -7, 7) * pull;
      z += clamp(tz - z, -7, 7) * pull;
      const want = a ? a.y0 + a.h * ARCH_THREAD : alt + 3 * Math.sin(i * 0.7);
      y += clamp(want - y, -4.5, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** A straight glide that sinks toward cruise height, rising only to clear the ground ahead. */
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
      // Look a few wisps ahead so the path starts climbing before a wall, not at its foot.
      let g = Math.max(L.ground(x, z), Config.world.waterLevel);
      for (let k = 1; k <= 3; k++) g = Math.max(g, L.height(x + fx * sp * k, z + fz * sp * k));
      y += clamp(g + 24 - y, -4.5, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** The planned polyline (from the cursor) keeps MARGIN from rock and water all along. */
  private pathClear(c: WispCursor): boolean {
    const P = this.pts;
    const L = this.L;
    let px = c.x;
    let py = c.y;
    let pz = c.z;
    const n = Math.min(P.length, this.free * 3);
    for (let k = 0; k < n; k += 3) {
      const d = Math.hypot(P[k] - px, P[k + 1] - py, P[k + 2] - pz);
      const steps = Math.max(1, Math.ceil(d / 5));
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
    const g = Math.max(this.L.ground(c.x, c.z), Config.world.waterLevel);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }
}
