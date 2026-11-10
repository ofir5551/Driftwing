import { Config } from '../../core/Config';
import { clamp, lerp, smoothstep } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import type { PeaksLayout, Spire } from './PeaksLayout';

type Spawn = (x: number, y: number, z: number) => void;

/**
 * How far a planned path keeps from rock. Generous: a bird following the ribbon cuts the inside
 * of every bend, and the facets bulge between the checked samples.
 */
const MARGIN = 9;
/** How far over the cloud tops a path keeps (skims run just above them on purpose). */
const GROUND = 3;
/** Headings to try, relative to the trend (radians). */
const SLALOM_TURNS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
const SKIM_TURNS = [0, 0.35, -0.35, 0.7, -0.7];
const GLIDE_TURNS = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3];
/** Hemmed in by rock: wheel round instead (shorter glides, wider turns). */
const WHEEL_TURNS = [1.8, -1.8, 2.4, -2.4, 3.0, -3.0];

/**
 * Sea of Clouds' wisp patterns. The opening ribbon rises gently from the spawn and threads the
 * Sky Gate under its bridge. Then: skims that ride a few metres over the cloud tops, following
 * their swells; slaloms weaving between spires (of the clear candidates, the one passing most
 * rock wins); swings that climb part way round a tall spire and leave over its summit; and
 * glides that sink back toward the sea. Every pattern is planned whole and checked clear of
 * rock and cloud before anything spawns, and a slow trend heading keeps the ribbon from
 * doubling back (as in Jade River).
 */
export class PeaksPlanner implements WispPlanner {
  private introDone = false;
  private readonly pts: number[] = [];
  private readonly best: number[] = [];
  private free = 0;
  private sinceSwing = 0;
  private sinceSkim = 0;
  private lastSpire: Spire | null = null;
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };

  constructor(private readonly L: PeaksLayout) {}

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
      this.introDone = true;
      this.pts.length = 0;
      this.intro(c);
      if (this.commit(c, spawn)) return true;
    }
    // Now and then let the generic patterns run (they bring the thermal spirals), but only out
    // over open cloud: near a spire they lift a path straight up its wall, steeper than any
    // bird can climb (as the fjords found).
    if (rand() < 0.12 && L.skyline(c.x, c.z, 260) === -Infinity) return false;
    this.sinceSwing++;
    if (this.sinceSwing > 3 && rand() < 0.35) {
      this.pts.length = 0;
      if (this.swing(c, base, rand) && this.commit(c, spawn)) {
        this.sinceSwing = 0;
        return true;
      }
    }
    this.sinceSkim++;
    const high = c.y - L.height(c.x, c.z);
    if (high < 90 && (high < 34 ? rand() < 0.6 : this.sinceSkim > 2 && rand() < 0.5)) {
      for (const turn of SKIM_TURNS) {
        this.pts.length = 0;
        this.skim(c, base + turn, rand);
        if (this.commit(c, spawn)) {
          this.sinceSkim = 0;
          return true;
        }
      }
    }
    // High up (after a swing over a summit), glide back down before weaving again.
    if (high < 70 && this.slalom(c, base, rand) && this.commit(c, spawn)) return true;
    for (const turn of GLIDE_TURNS) {
      this.pts.length = 0;
      this.glide(c, base + turn, 9);
      if (this.commit(c, spawn)) return true;
    }
    // Never hand a ribbon among the spires to the generic patterns: they would lift it straight
    // over the nearest summit. Wheel round toward open air instead, from the bird's heading.
    for (const turn of WHEEL_TURNS) {
      this.pts.length = 0;
      this.glide(c, c.heading + turn * 0.5, 4);
      if (this.commit(c, spawn)) return true;
    }
    return false;
  }

  /** From the spawn, a long gentle rise down the corridor and under the Sky Gate's bridge. */
  private intro(c: WispCursor): void {
    const L = this.L;
    const b = L.bridge;
    const sp = Config.wisps.spacing;
    const under = b.y - b.sag - 40;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    while (z < b.z + 75 && this.pts.length < 40 * 3) {
      z += sp;
      // Drift onto the gate's centre line well before it.
      x += clamp((b.x0 + b.x1) / 2 - x, -1.5, 1.5);
      const want = lerp(c.y, under, smoothstep(c.z + 60, b.z - 60, z));
      y += clamp(want - y, -3, Config.wisps.maxRise * 0.6);
      this.pts.push(x, y, z);
    }
  }

  /**
   * Ride the cloud tops a few metres up, rising and falling with the swells and heaps. From
   * higher up it glides straight down to them first and only then starts to weave, so the
   * ribbon never dives and swerves at once.
   */
  private skim(c: WispCursor, heading: number, rand: () => number): void {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const amp = 4 + rand() * 5;
    const phase = rand() * Math.PI * 2;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    let n = 11 + Math.floor(rand() * 4);
    let down = -1; // wisps since the ribbon came down to the cloud tops
    for (let i = 0; i < n && i < 30; i++) {
      x += fx * sp;
      z += fz * sp;
      if (down < 0 && y - L.height(x, z) < 14) down = 0;
      if (down < 0) n++;
      else down++;
      // A lazy S either side of the line, once down.
      const lat = down < 0 ? 0 : amp * Math.sin(down * 0.45 + phase) * Math.min(1, down / 3);
      const wx = x + fz * lat;
      const wz = z - fx * lat;
      // Look a wisp ahead so a heap is met on the way up, not inside it.
      const g = Math.max(L.height(wx, wz), L.height(wx + fx * sp, wz + fz * sp));
      y += clamp(g + 7 + 1.5 * Math.sin(i * 0.9) - y, -4.5, Config.wisps.maxRise);
      this.pts.push(wx, y, wz);
    }
  }

  /**
   * Weave between the spires: a gentle S along each candidate heading at a height among the
   * rock. Of the clear candidates, the one that passes most rock closely wins.
   */
  private slalom(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const n = 10;
    const amp = 8 + rand() * 9;
    const phase = rand() < 0.5 ? 0 : Math.PI;
    // Weave at about the height the ribbon is already flying (among the rock, not over it).
    const alt = clamp(c.y - L.height(c.x, c.z), 28, 60);
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
        y += clamp(L.height(wx, wz) + alt - y, -3.5, Config.wisps.maxRise);
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

  /**
   * Most of the way round a spire ahead, climbing, then over its summit. The ribbon joins the
   * circle on a tangent (no corner), sweeps about 315 degrees (never a full turn: a bird that
   * missed a wisp would face it again next lap) and leaves across the crown, bending only
   * 45 degrees back onto its old heading.
   */
  private swing(c: WispCursor, h: number, rand: () => number): boolean {
    const L = this.L;
    // A spire standing well above the ribbon, but not so tall it can't be climbed in time.
    const p = L.nearestSpire(
      c.x + Math.sin(h) * 120,
      c.z + Math.cos(h) * 120,
      90,
      c.y + 25,
      c.y + 70,
    );
    if (!p || p === this.lastSpire) return false;
    const turn = rand() < 0.5 ? 1 : -1;
    const summit = p.y0 + p.h;
    // The crossing clears the crown (pines, a temple).
    const over = p.top + MARGIN + 3;
    const sp = Config.wisps.spacing;
    const R0 = Math.max(L.axisAt(p, summit - 30), p.crown) + 16;
    const cx = L.ax;
    const cz = L.az;
    // On the circle at angle phi the ribbon heads phi + turn * pi/2: enter heading along h.
    let a = h - (turn * Math.PI) / 2;
    const ex = cx + Math.sin(a) * R0;
    const ez = cz + Math.cos(a) * R0;
    const steps = Math.max(1, Math.round(Math.hypot(ex - c.x, ez - c.z) / sp));
    const sweep = 1.75 * Math.PI;
    const count = Math.max(6, Math.round((sweep * R0) / sp));
    // Climb the whole way at a pace a bird can follow, or leave this spire be.
    const rise = Math.max(0, over - c.y) / (steps + count);
    if (rise > Config.wisps.maxRise * 0.8 || steps + count + 3 > 26) return false;
    let y = c.y;
    for (let i = 1; i <= steps; i++) {
      y += rise;
      this.pts.push(lerp(c.x, ex, i / steps), y, lerp(c.z, ez, i / steps));
    }
    const da = (turn * sweep) / count;
    for (let i = 0; i < count; i++) {
      y += rise;
      a += da;
      const rr = Math.max(L.axisAt(p, Math.min(y, summit - 0.1)), p.crown);
      const R = Math.max(R0, rr + 16);
      this.pts.push(cx + Math.sin(a) * R, y, cz + Math.cos(a) * R);
    }
    // Over the crown (and any temple), then on along the old heading.
    const sx = p.x + p.lx;
    const sz = p.z + p.lz;
    for (const k of [0, 1, 2])
      this.pts.push(sx + Math.sin(h) * k * 15, over, sz + Math.cos(h) * k * 15);
    this.lastSpire = p;
    return true;
  }

  /** A straight glide that sinks toward the cloud sea, rising only to clear rock ahead. */
  private glide(c: WispCursor, heading: number, n: number): void {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (let i = 0; i < n; i++) {
      x += fx * sp;
      z += fz * sp;
      const floor = Math.max(L.height(x, z) + 22, L.skyline(x, z, 10) + 10);
      y += clamp(floor - y, -4.5, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** The planned polyline (from the cursor) keeps MARGIN from rock and GROUND over the cloud. */
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
        const x = lerp(px, P[k], f);
        const y = lerp(py, P[k + 1], f);
        const z = lerp(pz, P[k + 2], f);
        if (!L.clear(x, y, z, MARGIN, GROUND)) return false;
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
    const g = this.L.height(c.x, c.z);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }
}
