import { Config } from '../../core/Config';
import { angleDelta, clamp, lerp } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import { GoalLean } from '../goal';
import type { MapleLayout, Temple, Tunnel } from './MapleLayout';

type Spawn = (x: number, y: number, z: number) => void;

/** How far a planned path keeps from solids and the ground (the bird cuts inside bends). */
const MARGIN = 9;
/** Glide headings to try, relative to the trend (radians). */
const GLIDE_TURNS = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2];

/**
 * Maple Valley's wisp patterns. The opening ribbon runs down the river into the lake, through
 * the great gate standing in the water and across past the pavilion's island. Then: low runs
 * along the river's bends; now and then a climb up a tunnel of gates on its mountainside (in
 * at the foot, up the bench through every other gate, out over the shrine at the top); a swing
 * round a temple's pagoda; and glides that pick the lowest way through the mountains (a valley
 * or a pass rather than over a summit), planned with a look past their end so they never ask
 * for a climb the bird can't make. Every pattern is planned whole and checked clear first.
 */
export class MaplePlanner implements WispPlanner {
  private introDone = false;
  private readonly pts: number[] = [];
  private readonly best: number[] = [];
  private readonly ys: number[] = [];
  private free = 0;
  private sinceTunnel = 3;
  private sinceSwing = 2;
  private lastTunnel: Tunnel | null = null;
  private lastTemple: Temple | null = null;
  private readonly c2 = { x: 0, z: 0 };
  /** The ribbon's overall direction (a slow average of its travel): no doubling back. */
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };
  private lean = new GoalLean();
  private onJourney = false;

  constructor(private readonly L: MapleLayout) {}

  setGoal(lean: GoalLean): void {
    this.lean = lean;
  }

  pattern(c: WispCursor, rand: () => number, spawn: Spawn, free: number): boolean {
    const L = this.L;
    this.free = free;
    if (Math.abs(c.x - this.expect.x) + Math.abs(c.z - this.expect.z) > 1) {
      this.trendX = Math.sin(c.heading);
      this.trendZ = Math.cos(c.heading);
    }
    const goal = this.lean.heading(c.x, c.z);
    this.onJourney = goal !== null;
    if (goal !== null) {
      this.trendX = Math.sin(goal);
      this.trendZ = Math.cos(goal);
    }
    const base = Math.atan2(this.trendX, this.trendZ);
    if (!this.introDone) {
      this.introDone = true;
      this.pts.length = 0;
      this.opening(c);
      if (this.commit(c, spawn, 5)) return true;
    }
    const end = this.lean.endDist(c.x, c.z);
    if (goal !== null && end < Config.wisps.goalLineUp) {
      // Straight through the beacon's light, ending a little past it (a beacon at a tunnel's
      // foot has the gates just beyond).
      this.pts.length = 0;
      const n = Math.min(9, Math.max(2, Math.ceil(end / Config.wisps.spacing) + 1));
      if (this.glide(c, goal, 0, n) && this.commit(c, spawn)) return true;
    }
    if (rand() < 0.1) return false;
    this.sinceTunnel++;
    this.sinceSwing++;
    if (this.sinceTunnel > 3) {
      this.pts.length = 0;
      if (this.tunnel(c, base, goal !== null) && this.commit(c, spawn, 4)) {
        this.sinceTunnel = 0;
        return true;
      }
    }
    if (goal === null && this.sinceSwing > 3 && rand() < 0.35) {
      this.pts.length = 0;
      if (this.swing(c, base, rand) && this.commit(c, spawn)) {
        this.sinceSwing = 0;
        return true;
      }
    }
    if (goal === null && this.sinceTunnel > 3) {
      this.pts.length = 0;
      if (this.approach(c, base) && this.commit(c, spawn)) return true;
    }
    const along = L.riverHeading(c.x, c.z, base);
    if (
      L.water(c.x, c.z) < 20 &&
      c.y < 60 &&
      Math.abs(angleDelta(base, along)) < (goal !== null && this.lean.onRoute ? 1.4 : 1.0)
    ) {
      this.pts.length = 0;
      this.river(c, along, 10 + rand() * 6, 9 + Math.floor(rand() * 5));
      if (this.commit(c, spawn)) return true;
    }
    if (this.bestGlide(c, base)) return this.commit(c, spawn);
    return false;
  }

  /**
   * When it is time for a tunnel and one lies roughly ahead: glide to a point well back along
   * its lead-in, from where the next pattern flies in at its foot. NaN-free: false if none.
   */
  private approach(c: WispCursor, base: number): boolean {
    const L = this.L;
    const t = L.nearestTunnel(c.x + Math.sin(base) * 380, c.z + Math.cos(base) * 380, 600);
    if (!t || t === this.lastTunnel) return false;
    const G = t.gates;
    const ax = G[0] - Math.sin(G[3]) * 100;
    const az = G[2] - Math.cos(G[3]) * 100;
    const d = Math.hypot(ax - c.x, az - c.z);
    if (d < 40) return false;
    const h = Math.atan2(ax - c.x, az - c.z);
    if (Math.abs(angleDelta(base, h)) > 1.3) return false;
    // Arriving from behind the lead-in, more or less: not across the mountain from the far side.
    if (Math.abs(angleDelta(h, G[3])) > 1.6) return false;
    const n = Math.min(9, Math.max(2, Math.round(d / Config.wisps.spacing)));
    return this.glide(c, h, 0, n) && this.pathClear(c, MARGIN);
  }

  /** The opening run: down the river, through the gate in the lake, across past the island. */
  private opening(c: WispCursor): void {
    const L = this.L;
    const O = L.opening;
    const sp = Config.wisps.spacing;
    const G = L.gate;
    let y = c.y;
    let travelled = 0;
    for (let k = 3; k < O.length; k += 3) {
      travelled += Math.hypot(O[k] - O[k - 3], O[k + 1] - O[k - 2]);
      if (travelled < sp) continue;
      travelled -= sp;
      const x = O[k];
      const z = O[k + 1];
      // Low over the water, lowest through the gate (under its beams, between its posts).
      const dg = Math.hypot(x - G.x, z - G.z);
      const want = lerp(7, 11, Math.min(1, dg / 90));
      y += clamp(want - y, -3, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** Follow the river's bends at `alt` over the water, hopping its bridges. */
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
      L.toCentre(x, z, this.c2);
      x += clamp(this.c2.x - x, -6, 6) * 0.4;
      z += clamp(this.c2.z - z, -6, 6) * 0.4;
      let want = alt + 3 * Math.sin(i * 0.7);
      for (let a = 0; a <= 4; a++) {
        const top = L.bridgeTop(x + Math.sin(heading) * sp * a, z + Math.cos(heading) * sp * a);
        want = Math.max(want, top + MARGIN + 2);
      }
      y += clamp(want - y, -4, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /**
   * Up a tunnel of gates ahead: in at its foot along its first stretch, through every other
   * gate a little over halfway up their posts, then over the shrine and off the mountain the
   * way the trend goes. Only when the foot lies ahead and the way in needs no hard turn.
   */
  private tunnel(c: WispCursor, base: number, journey: boolean): boolean {
    const L = this.L;
    const t = L.nearestTunnel(c.x + Math.sin(base) * 230, c.z + Math.cos(base) * 230, 320);
    if (!t || t === this.lastTunnel) return false;
    const G = t.gates;
    const fx = G[0];
    const fz = G[2];
    const toFoot = Math.atan2(fx - c.x, fz - c.z);
    // Ahead of where the ribbon is going now, and not back the way the trend came.
    if (Math.abs(angleDelta(c.heading, toFoot)) > 1.0) return false;
    if (Math.abs(angleDelta(base, toFoot)) > 1.6) return false;
    const d0 = G[3];
    if (Math.abs(angleDelta(toFoot, d0)) > 1.0) return false;
    // Mid-journey only if the tunnel heads the journey's way (its top is nearer the goal).
    if (journey && Math.abs(angleDelta(base, Math.atan2(t.sx - fx, t.sz - fz))) > 1.2) return false;
    const K = Config.maple;
    const sp = Config.wisps.spacing;
    // The way in: from the cursor to a point 45 m before the foot, along the first stretch.
    const ax = fx - Math.sin(d0) * 45;
    const az = fz - Math.cos(d0) * 45;
    const ay = G[1] + K.gateClear + 2;
    const run = Math.hypot(ax - c.x, az - c.z);
    // Whole or not at all: a ribbon cut short inside the gates would leave the next pattern
    // nowhere clear to start.
    if (run < 30 || Math.ceil(run / sp) + 1 + Math.ceil(t.n / 2) + 3 > this.free) return false;
    const n = Math.ceil(run / sp);
    let y = c.y;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const x = lerp(c.x, ax, f);
      const z = lerp(c.z, az, f);
      const floor = L.flightGround(x, z) + 6;
      y = Math.max(lerp(c.y, ay, f), floor);
      this.pts.push(x, y, z);
    }
    // In along the first stretch, then every other gate.
    this.pts.push(fx - Math.sin(d0) * 22, lerp(y, G[1] + K.gateClear, 0.6), fz - Math.cos(d0) * 22);
    for (let k = 0; k < t.n; k += 2)
      this.pts.push(G[k * 4], G[k * 4 + 1] + K.gateClear, G[k * 4 + 2]);
    // Over the shrine's roof and away along the last stretch, climbing off the bench as the
    // bird can; where the mountain rises faster than that, the ribbon ends and a glide follows.
    const sy = t.syaw;
    let ey = this.pts[this.pts.length - 2];
    for (let k = 0; k < 3; k++) {
      const x = t.sx + Math.sin(sy) * sp * k;
      const z = t.sz + Math.cos(sy) * sp * k;
      const want = L.flightGround(x, z) + 6;
      if (want - ey > Config.wisps.maxRise + 1) break;
      ey += clamp(want - ey, -3, Config.wisps.maxRise);
      this.pts.push(x, ey, z);
    }
    if (!this.steady()) return false;
    this.lastTunnel = t;
    return true;
  }

  /** No leg of the planned path climbs or drops more than the bird can follow. */
  private steady(): boolean {
    const P = this.pts;
    for (let k = 3; k < P.length; k += 3) {
      const d = Math.hypot(P[k] - P[k - 3], P[k + 2] - P[k - 1]) || 1;
      const dy = P[k + 1] - P[k - 2];
      if (dy > (d * Config.wisps.maxRise) / Config.wisps.spacing + 1.5 || dy < -d * 0.5)
        return false;
    }
    return true;
  }

  /** Round a temple's pagoda ahead, half way up it, and on along the trend. */
  private swing(c: WispCursor, base: number, rand: () => number): boolean {
    const L = this.L;
    const t = L.nearestTemple(c.x + Math.sin(base) * 160, c.z + Math.cos(base) * 160, 130);
    if (!t || t === this.lastTemple) return false;
    const R = 30;
    const y = t.y + 17;
    const turn = rand() < 0.5 ? 1 : -1;
    let a = Math.atan2(c.x - t.px, c.z - t.pz);
    const sp = Config.wisps.spacing;
    // Ease in toward the circle, then round it about 200 degrees.
    const steps = Math.round((Math.PI * 1.1 * R) / sp);
    for (let i = 0; i <= steps; i++) {
      a += (turn * sp) / R;
      this.pts.push(t.px + Math.sin(a) * R, y, t.pz + Math.cos(a) * R);
    }
    // Leave along the trend.
    const lx = this.pts[this.pts.length - 3];
    const lz = this.pts[this.pts.length - 1];
    for (let k = 1; k <= 2; k++)
      this.pts.push(lx + Math.sin(base) * sp * k, y + 3 * k, lz + Math.cos(base) * sp * k);
    if (!this.steady()) return false;
    this.lastTemple = t;
    return true;
  }

  /**
   * Of the glide headings round the trend, the clear one that keeps lowest over the land (a
   * valley or a pass), a turn costing a little.
   */
  private bestGlide(c: WispCursor, base: number): boolean {
    let bestScore = Infinity;
    for (const turn of GLIDE_TURNS) {
      this.pts.length = 0;
      if (!this.glide(c, base + turn, Math.abs(turn))) continue;
      let sum = 0;
      for (let k = 1; k < this.pts.length; k += 3) sum += this.pts[k];
      const score = sum / (this.pts.length / 3) + Math.abs(turn) * (this.onJourney ? 90 : 30);
      if (score >= bestScore || !this.pathClear(c, MARGIN)) continue;
      bestScore = score;
      this.best.length = 0;
      this.best.push(...this.pts);
    }
    if (bestScore === Infinity) return false;
    this.pts.length = 0;
    this.pts.push(...this.best);
    return true;
  }

  /**
   * A glide along `heading` that hugs the land at cruise height over the canopy, its heights
   * planned backward from a look past its end (each point at least what the next needs less
   * one climb), so a mountainside ahead is met by an early, steady rise.
   */
  private glide(c: WispCursor, heading: number, _turn: number, n = 9): boolean {
    const L = this.L;
    const sp = Config.wisps.spacing;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    // On a journey the way runs straight over the ranges: look far enough ahead to start
    // climbing for the next ridge in time. Free, a shorter look keeps the ribbon low in valleys.
    const look = this.onJourney ? 26 : 8;
    const ys = this.ys;
    ys.length = 0;
    for (let i = 1; i <= n + look; i++) {
      const x = c.x + fx * sp * i;
      const z = c.z + fz * sp * i;
      const floor = Math.max(L.flightGround(x, z), Config.world.waterLevel) + 20;
      ys.push(Math.max(floor, L.skyline(x, z, 16) + 14));
    }
    const rise = Config.wisps.maxRise * 0.9;
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.max(ys[i], ys[i + 1] - rise);
    let y = c.y;
    for (let i = 0; i < n; i++) {
      y += clamp(ys[i] - y, -4.5, rise);
      if (y < ys[i] - 8) return false; // can't climb in time from here
      this.pts.push(c.x + fx * sp * (i + 1), y, c.z + fz * sp * (i + 1));
    }
    return true;
  }

  /** The planned polyline (from the cursor) keeps `margin` from solids, ground and gates. */
  private pathClear(c: WispCursor, margin: number): boolean {
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
        if (!L.clear(lerp(px, P[k], f), lerp(py, P[k + 1], f), lerp(pz, P[k + 2], f), margin))
          return false;
      }
      px = P[k];
      py = P[k + 1];
      pz = P[k + 2];
    }
    return true;
  }

  /**
   * A tunnel's own check: the ribbon is meant to be among the gates, so only the ground (a
   * few metres under it), the canopy and the solids count.
   */
  private tunnelClear(c: WispCursor): boolean {
    const P = this.pts;
    const L = this.L;
    let px = c.x;
    let py = c.y;
    let pz = c.z;
    const n = Math.min(P.length, this.free * 3);
    for (let k = 0; k < n; k += 3) {
      const d = Math.hypot(P[k] - px, P[k + 1] - py, P[k + 2] - pz);
      const steps = Math.max(1, Math.ceil(d / 3));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        const x = lerp(px, P[k], f);
        const y = lerp(py, P[k + 1], f);
        const z = lerp(pz, P[k + 2], f);
        if (y < L.flightGround(x, z) + 3.5 || y < Config.world.waterLevel + 3) return false;
        if (L.solidTop(x, y, z, 6) !== -Infinity) return false;
      }
      px = P[k];
      py = P[k + 1];
      pz = P[k + 2];
    }
    return true;
  }

  /**
   * Spawn the planned wisps if the whole path is clear (with `margin`; the tunnels and the
   * opening check their own way) and move the cursor to its end.
   */
  private commit(c: WispCursor, spawn: Spawn, margin = MARGIN): boolean {
    const P = this.pts;
    if (P.length > this.free * 3) P.length = this.free * 3;
    if (P.length < 6) return false;
    const ok = margin === 4 ? this.tunnelClear(c) : this.pathClear(c, margin);
    if (!ok) return false;
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
    // Step back by the gap Wisps adds after each pattern (it would go unchecked).
    c.x = P[n] - Math.sin(c.heading) * Config.wisps.gap;
    c.y = P[n + 1];
    c.z = P[n + 2] - Math.cos(c.heading) * Config.wisps.gap;
    const g = Math.max(this.L.height(c.x, c.z), Config.world.waterLevel);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }
}
