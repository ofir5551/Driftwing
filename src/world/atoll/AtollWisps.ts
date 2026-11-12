import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import type { AtollLayout, Island } from './AtollLayout';

type Spawn = (x: number, y: number, z: number) => void;

/**
 * How far a planned path keeps from rock and steep land, sideways. Generous: a bird following
 * the ribbon cuts the inside of every bend, and the rock bulges between the checked samples.
 */
const MARGIN = 9;
/** And how far above the water, the palms and the roofs: low, this level is for skimming. */
const ABOVE = 2.5;
/** Headings to try, relative to the trend (radians). */
const TURNS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3];
/** Height over the surface of a hop's lowest wisps: a bird skims the water between them. */
const HOP_LOW = 4;

/**
 * Coral Atolls' wisp patterns, all low and bouncy. Skipping-stone hops: the ribbon dips to the
 * water and bounds up again, over and over, across lagoons and open sea. Rim runs: an arc along
 * a reef, over the surf and the palm tops. Slaloms weave between mushroom rocks, and now and
 * then a swing curves round a high island's shoulder. Every pattern is planned whole and
 * checked clear before anything spawns, as in the city.
 */
export class AtollPlanner implements WispPlanner {
  private introDone = false;
  private readonly pts: number[] = [];
  private readonly best: number[] = [];
  private free = 0;
  /** Patterns since the last swing (starts high: the first chance follows the opening run). */
  private sinceSwing = 9;
  private lastIsland: Island | null = null;
  /**
   * The ribbon's overall direction (a slow average of its travel). Every pattern heads within
   * a turn or so of it, so hops and arcs wander but the ribbon never doubles back.
   */
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };

  constructor(private readonly L: AtollLayout) {}

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
      // The opening ribbon skips across the home lagoon toward the island's fang.
      this.introDone = true;
      const I = L.atoll(0, 0)!.island!;
      this.pts.length = 0;
      this.hops(c, Math.atan2(I.tx - c.x, I.tz - c.z), 15, 0, 3.5);
      if (this.commit(c, spawn)) return true;
    }
    // Now and then let the generic patterns run (they bring the thermal spirals).
    if (rand() < 0.1) return false;
    this.sinceSwing++;
    if (this.sinceSwing > 3 && rand() < 0.5) {
      this.pts.length = 0;
      if (this.swing(c, base, rand) && this.commit(c, spawn)) {
        this.sinceSwing = 0;
        return true;
      }
    }
    // Near a reef: now and then run along it a while.
    const rs = L.ring(c.x, c.z);
    if (Math.abs(rs) < 150 && rand() < 0.6) {
      this.pts.length = 0;
      if (this.rim(c, base, rand) && this.commit(c, spawn)) return true;
    }
    if (L.rocksNear(c.x + Math.sin(base) * 120, c.z + Math.cos(base) * 120, 110) >= 3)
      if (this.slalom(c, base, rand) && this.commit(c, spawn)) return true;
    // Hops, first toward the next atoll ahead, then fanning out round the trend.
    const k = 3 + Math.floor(rand() * 2);
    const n = 11 + Math.floor(rand() * 5);
    const ph = rand();
    const aim = this.aim(c, base);
    if (aim !== null) {
      this.pts.length = 0;
      this.hops(c, aim, n, ph, k);
      if (this.commit(c, spawn)) return true;
    }
    for (const turn of TURNS) {
      this.pts.length = 0;
      this.hops(c, base + turn, n, ph, k);
      if (this.commit(c, spawn)) return true;
    }
    for (const turn of TURNS) {
      this.pts.length = 0;
      this.glide(c, base + turn);
      if (this.commit(c, spawn)) return true;
    }
    return false;
  }

  /**
   * Heading toward the next atoll ahead, within a turn of the trend: at its nearest pass when
   * one faces the cursor (the ribbon skips in through the gap), else at its middle. Null when
   * no atoll lies that way, or while the cursor is still crossing a lagoon.
   */
  private aim(c: WispCursor, base: number): number | null {
    const L = this.L;
    L.ring(c.x, c.z);
    const here = L.ra && L.rs < -L.ra.w ? L.ra : null;
    if (here) return null;
    const C = Config.atoll.cell;
    const ci = Math.round(c.x / C);
    const cj = Math.round(c.z / C);
    let best: number | null = null;
    let bestScore = Infinity;
    for (let j = cj - 2; j <= cj + 2; j++)
      for (let i = ci - 2; i <= ci + 2; i++) {
        const a = L.atoll(i, j);
        if (!a) continue;
        let tx = a.x;
        let tz = a.z;
        const th = Math.atan2(c.x - a.x, c.z - a.z);
        for (const pa of a.passes)
          if (Math.abs(angleDelta(th, pa)) < 0.7) {
            const R = L.ringR(a, pa);
            tx = a.x + Math.sin(pa) * R;
            tz = a.z + Math.cos(pa) * R;
          }
        const d = Math.hypot(tx - c.x, tz - c.z);
        if (d < 60 || d > 2000) continue;
        const h = Math.atan2(tx - c.x, tz - c.z);
        const da = Math.abs(angleDelta(base, h));
        if (da > 0.9) continue;
        const score = d * (1 + da);
        if (score < bestScore) {
          bestScore = score;
          best = h;
        }
      }
    return best;
  }

  /** The surface the ribbon rides over: water, palm tops, roofs. */
  private surface(x: number, z: number): number {
    const L = this.L;
    const g = L.height(x, z);
    return Math.max(g + L.canopy(g), L.bungalowAt(x, z), Config.world.waterLevel);
  }

  /**
   * Skipping-stone hops: a gently bending line whose wisps dip to just over the surface and
   * bound up again every `k` wisps, easing down to the water first from wherever the cursor is.
   */
  private hops(c: WispCursor, heading: number, n: number, phase: number, k: number): void {
    const sp = Config.wisps.spacing;
    const bend = Math.sin(phase * 9.7) * 0.05;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    let h = heading;
    const hop = 6 + 4 * phase;
    for (let i = 0; i < n; i++) {
      x += Math.sin(h) * sp;
      z += Math.cos(h) * sp;
      h += bend;
      const want = this.surface(x, z) + HOP_LOW + hop * Math.abs(Math.sin((Math.PI * (i + 1)) / k));
      y += clamp(want - y, -5, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** An arc along the nearest reef, over the surf and the palm tops, the way the trend goes. */
  private rim(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    L.ring(c.x, c.z);
    const a = L.ra;
    if (!a) return false;
    let th = L.rth;
    // Increasing th runs along (cos th, -sin th); pick the way closer to the trend.
    const fwd = Math.atan2(Math.cos(th), -Math.sin(th));
    const dir = Math.abs(angleDelta(base, fwd)) < Math.PI / 2 ? 1 : -1;
    if (Math.abs(angleDelta(base, dir > 0 ? fwd : fwd + Math.PI)) > 1.35) return false;
    const sp = Config.wisps.spacing;
    // Ride a little outside the reef's centre line, over the surf (or the islets' palm tops).
    const target = a.w * (0.3 + 0.4 * rand());
    let s = L.rs;
    let y = c.y;
    const n = 11 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const R = L.ringR(a, th);
      th += (dir * sp) / Math.max(R + s, 60);
      s += clamp(target - s, -9, 9);
      const R2 = L.ringR(a, th) + s;
      const x = a.x + Math.sin(th) * R2;
      const z = a.z + Math.cos(th) * R2;
      const want = this.surface(x, z) + 6 + 2 * Math.sin(i * 0.9);
      y += clamp(want - y, -4.5, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
    return true;
  }

  /**
   * Weave between the mushroom rocks: a gentle S along each candidate heading, low over the
   * lagoon. Of the clear candidates, the one that passes most rock closely wins.
   */
  private slalom(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const n = 10;
    const amp = 8 + rand() * 8;
    const ph = rand() < 0.5 ? 0 : Math.PI;
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
        y += clamp(this.surface(wx, wz) + 8 - y, -4.5, Config.wisps.maxRise);
        this.pts.push(wx, y, wz);
        near += L.rocksNear(wx, wz, 28);
      }
      const score = near - Math.abs(turn) * 4;
      if (score <= bestScore || near === 0 || !this.pathClear(c)) continue;
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
   * Curve round a high island ahead: walk forward turning toward a circle round it at a height
   * among its shoulders, as far out as the land needs, for about half a turn.
   */
  private swing(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    const fx = c.x + Math.sin(base) * 180;
    const fz = c.z + Math.cos(base) * 180;
    let I: Island | null = null;
    let bd = 320;
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) {
        const C = Config.atoll.cell;
        const a = L.atoll(Math.round(fx / C) + dx, Math.round(fz / C) + dz);
        if (!a?.island) continue;
        const d = Math.hypot(a.island.x - fx, a.island.z - fz);
        if (d < bd) {
          bd = d;
          I = a.island;
        }
      }
    if (!I || I === this.lastIsland) return false;
    const sp = Config.wisps.spacing;
    const Y = clamp(c.y + 10, 30, Math.max(40, I.th * 0.55));
    // Orbit radius: out to where the land is well below the ribbon, all the way round.
    let R0 = I.r * 0.4;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      while (R0 < I.r * 1.6 && L.height(I.x + Math.sin(a) * R0, I.z + Math.cos(a) * R0) > Y - 26)
        R0 += 6;
    }
    R0 += 12;
    const side = rand() < 0.5 ? 1 : -1;
    let x = c.x;
    let y = c.y;
    let z = c.z;
    let h = c.heading;
    let turned = 0;
    for (let i = 0; i < 26 && turned < Math.PI * 1.1; i++) {
      const dx = x - I.x;
      const dz = z - I.z;
      const d = Math.hypot(dx, dz);
      // Tangent heading round the island, leaning in or out to close on the orbit.
      const tang = Math.atan2(dx, dz) + (side * Math.PI) / 2;
      const want = tang + clamp((d - R0) / 60, -0.9, 0.9) * side;
      const turn = clamp(angleDelta(h, want), -0.32, 0.32);
      h += turn;
      if (d < R0 * 1.6) turned += Math.abs(turn);
      x += Math.sin(h) * sp;
      z += Math.cos(h) * sp;
      y += clamp(Y - y, -4, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
    if (turned < 1.2) return false;
    this.lastIsland = I;
    return true;
  }

  /** A straight glide easing to a low cruise, rising only to clear rock and land ahead. */
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
      const floor = Math.max(this.surface(x, z) + 12, L.skyline(x, z, 12) + 10);
      y += clamp(floor - y, -4.5, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** The planned polyline (from the cursor) keeps clear of rock, land and water all along. */
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
        if (!L.clear(x, y, z, MARGIN, ABOVE)) return false;
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
    const g = this.surface(c.x, c.z);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }
}
