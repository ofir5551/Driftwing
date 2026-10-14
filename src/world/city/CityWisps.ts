import { Config } from '../../core/Config';
import { clamp } from '../../core/math';
import type { WispCursor, WispPlanner } from '../Wisps';
import type { CityLayout, Tower } from './CityLayout';

type Spawn = (x: number, y: number, z: number) => void;

/** Radius of the quarter turn at an avenue crossing. With the open corner plazas the arc (and
 * the chord a bird cuts across it) stays clear of buildings, and it needs only 0.65 rad/s of
 * turn at cruise, so even a bird still fast from a dive (~45 m/s) makes it. */
const TURN_R = 40;
/** How far a planned path keeps from walls, decks and beams. */
const PATH_MARGIN = 3.5;
/**
 * Avenue run heights to try: [altitude, lateral offset]. Altitude < 0 means this run's canyon
 * height above the street; otherwise absolute. 9.5 m slips under both expressway decks (15 m
 * and 23 m), beside the pillars when offset; 32 m clears them both.
 */
/** Rooftop glide headings to try, relative to the cursor's heading (radians). */
const GLIDE_TURNS = [0, 0.5, -0.5, 1, -1, 1.6, -1.6];

const ALTITUDES: [number, number][] = [
  [-1, 0],
  [9.5, 0],
  [9.5, 9],
  [9.5, -9],
  [32, 0],
];

/**
 * City wisp patterns. The point of the city is flying through it, so most patterns run down
 * the avenues at canyon height, turning at crossings; some circle a tower; over the bay, or
 * when no clear way onto an avenue exists, the generic patterns (which ride above the roofs)
 * take over. The first pattern leads from the spawn through the giant torii and up the
 * avenue into the skyline.
 *
 * Every pattern is planned into `pts` first and the whole polyline, from the cursor on, is
 * checked against the scenery before anything spawns, so a ribbon never threads a wall.
 */
export class CityPlanner implements WispPlanner {
  private introDone = false;
  private readonly tower: Tower = { x: 0, z: 0, half: 0, top: 0 };
  private readonly pts: number[] = [];
  private free = 0;
  /**
   * The ribbon's overall heading (a slow average of its travel). Turns go to whichever side
   * keeps making progress along it, alternating when both are level, so the ribbon staircases
   * onward and never doubles back past the bird.
   */
  private trendX = 0;
  private trendZ = 0;
  private readonly expect = { x: NaN, z: NaN };
  private lastSide = 1;
  private turned = false;
  /** Patterns since the last tower spiral, and which tower it circled. */
  private sinceSpiral = 0;
  private lastTower = { x: NaN, z: NaN };

  constructor(private readonly city: CityLayout) {}

  pattern(c: WispCursor, rand: () => number, spawn: Spawn, free: number): boolean {
    const L = this.city;
    this.pts.length = 0;
    this.free = free;
    if (!this.introDone && Math.hypot(c.x - L.gate.x, c.z - L.gate.z) < 400) {
      this.introDone = true;
      this.intro(c);
      return this.commit(c, spawn, false);
    }
    // Out over open water the generic arcs and spirals read better than a street grid.
    const ahead = 150;
    if (
      L.inSea(c.x, c.z) &&
      L.inSea(c.x + Math.sin(c.heading) * ahead, c.z + Math.cos(c.heading) * ahead)
    )
      return false;
    // A cursor that is not where the last pattern left it was re-anchored at the bird (or
    // moved by a generic pattern): restart the trend from its heading.
    if (
      Math.abs(c.x - this.expect.x) + Math.abs(c.z - this.expect.z) > 1 ||
      (!this.trendX && !this.trendZ)
    ) {
      this.trendX = Math.sin(c.heading);
      this.trendZ = Math.cos(c.heading);
    }
    const r = rand();
    this.sinceSpiral++;
    if (r < 0.25 && this.sinceSpiral > 3 && this.spiral(c, rand) && this.commit(c, spawn, true)) {
      this.sinceSpiral = 0;
      this.lastTower.x = this.tower.x;
      this.lastTower.z = this.tower.z;
      return true;
    }
    // Avenue runs: the nearest axis first, then the other; at canyon height, then low (under
    // any expressway, beside its pillars), then high over everything. First clear plan wins.
    const q = c.heading / (Math.PI / 2);
    const near = Math.round(q);
    const axes = [near, q > near ? near + 1 : near - 1];
    const turn = rand() < 0.55;
    const canyon = 12 + rand() * 12;
    const len = 6 + Math.floor(rand() * 6);
    // Turning toward +lateral or -lateral: lateral is x when the run is along z.
    const alongZnow = Math.abs(Math.cos(near * (Math.PI / 2))) > 0.5;
    const lean = alongZnow ? this.trendX : this.trendZ;
    const side = Math.abs(lean) > 0.25 ? Math.sign(lean) : -this.lastSide;
    const low = rand() < 0.35;
    for (const axis of axes)
      for (let k = 0; k < ALTITUDES.length; k++) {
        const [alt, off] = ALTITUDES[low ? (k + 1) % ALTITUDES.length : k];
        this.pts.length = 0;
        this.avenue(c, axis, alt < 0 ? canyon : alt, alt < 0, off, turn, len, side);
        if (this.commit(c, spawn, true)) {
          if (this.turned) this.lastSide = side;
          return true;
        }
      }
    // No clear way onto an avenue: glide over the rooftops, as straight on as possible; last,
    // from above the local roofs (a cursor re-anchored right beside a building).
    const y0 = c.y;
    const lifted = Math.max(y0, this.city.skyline(c.x, c.z, 14) + 10);
    for (const y of y0 === lifted ? [y0] : [y0, lifted])
      for (const turnBy of GLIDE_TURNS) {
        this.pts.length = 0;
        c.y = y;
        this.glide(c, c.heading + turnBy);
        if (this.commit(c, spawn, true)) return true;
      }
    c.y = y0;
    return false;
  }

  /** A straight run over the roofs: holds height or sinks gently, rising only to clear roofs. */
  private glide(c: WispCursor, heading: number): void {
    const L = this.city;
    const sp = Config.wisps.spacing;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (let i = 0; i < 9; i++) {
      x += fx * sp;
      z += fz * sp;
      const floor = Math.max(L.height(x, z), Config.world.waterLevel, L.skyline(x, z, 8)) + 10;
      y += clamp(floor - y, -3, Config.wisps.maxRise);
      this.pts.push(x, y, z);
    }
  }

  /** Check the planned polyline (from the cursor) is clear, then spawn it and move the cursor. */
  private commit(c: WispCursor, spawn: Spawn, check: boolean): boolean {
    const P = this.pts;
    if (P.length > this.free * 3) P.length = this.free * 3;
    if (P.length === 0) return false;
    if (check) {
      let px = c.x;
      let py = c.y;
      let pz = c.z;
      for (let k = 0; k < P.length; k += 3) {
        if (!this.clear(px, py, pz, P[k], P[k + 1], P[k + 2])) return false;
        px = P[k];
        py = P[k + 1];
        pz = P[k + 2];
      }
    }
    for (let k = 0; k < P.length; k += 3) spawn(P[k], P[k + 1], P[k + 2]);
    const n = P.length - 3;
    const dx = P[n] - (n >= 3 ? P[n - 3] : c.x);
    const dz = P[n + 2] - (n >= 3 ? P[n - 1] : c.z);
    // Trend: blend in this pattern's overall displacement.
    const mx = P[n] - c.x;
    const mz = P[n + 2] - c.z;
    const ml = Math.hypot(mx, mz) || 1;
    const tx = this.trendX * 0.6 + (mx / ml) * 0.4;
    const tz = this.trendZ * 0.6 + (mz / ml) * 0.4;
    const tl = Math.hypot(tx, tz) || 1;
    this.trendX = tx / tl;
    this.trendZ = tz / tl;
    c.heading = Math.atan2(dx, dz);
    // Wisps adds a gap along the heading after each pattern, and that stretch would go
    // unchecked: step back by it so the next pattern starts exactly at this one's last wisp.
    this.expect.x = P[n];
    this.expect.z = P[n + 2];
    c.x = P[n] - Math.sin(c.heading) * Config.wisps.gap;
    c.y = P[n + 1];
    c.z = P[n + 2] - Math.cos(c.heading) * Config.wisps.gap;
    const g = Math.max(this.city.height(c.x, c.z), Config.world.waterLevel);
    c.clear = clamp(c.y - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    return true;
  }

  private clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / 4));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const z = z0 + (z1 - z0) * t;
      if (this.city.solidTop(x, y, z, PATH_MARGIN) !== -Infinity) return false;
    }
    return true;
  }

  /** From the cursor straight through the torii, low over the water, then up the x = 0 avenue. */
  private intro(c: WispCursor): void {
    const L = this.city;
    const gate = L.gate;
    let z = c.z;
    let y = 11;
    for (let i = 0; i < 24; i++) {
      // Hold the gate height until well past the torii, then climb to canyon height over the shore.
      if (z < gate.z - 40) y = Math.min(y + 1.6, L.height(gate.x, z) + 22);
      this.pts.push(gate.x, y, z);
      z -= Config.wisps.spacing;
    }
  }

  /**
   * Onto an avenue along cardinal `axis` (0 = +z, 1 = +x, ...) with a shallow merge, down it
   * at `alt` (metres above the street if `relative`, else absolute) offset `off` from the
   * centre line, and optionally a quarter turn toward `side` at the next crossing.
   */
  private avenue(
    c: WispCursor,
    axis: number,
    alt: number,
    relative: boolean,
    off: number,
    turnWanted: boolean,
    len: number,
    side: number,
  ): void {
    const L = this.city;
    const S = L.S;
    const sp = Config.wisps.spacing;
    const dx = Math.round(Math.sin(axis * (Math.PI / 2)));
    const dz = Math.round(Math.cos(axis * (Math.PI / 2)));
    const alongZ = dz !== 0;
    let sgn = alongZ ? dz : dx;
    let along = alongZ ? c.z : c.x;
    let lat = alongZ ? c.x : c.z;
    const line = Math.round(lat / S) * S + off;
    let turn = turnWanted;
    let y = c.y;
    const P = this.pts;
    const emit = (x: number, z: number) => {
      const target = relative ? Math.max(L.height(x, z), Config.world.waterLevel) + alt : alt;
      y += clamp(target - y, -5, Config.wisps.maxRise); // glide down at ~18 degrees at most
      P.push(x, y, z);
    };
    const at = (a: number, l: number, out: number[]) => {
      out[0] = alongZ ? l : a;
      out[1] = alongZ ? a : l;
      return out;
    };
    const xz = [0, 0];
    const merge = clamp(Math.ceil(Math.abs(line - lat) / 11), 0, 8);
    for (let i = 1; i <= merge; i++) {
      along += sgn * sp;
      lat += (line - lat) / (merge - i + 1);
      at(along, lat, xz);
      emit(xz[0], xz[1]);
    }
    lat = line;
    const n = len;
    const cross = sgn > 0 ? Math.ceil((along + 60) / S) * S : Math.floor((along - 60) / S) * S;
    const arcStart = cross - sgn * TURN_R;
    // Keep patterns short (about 20 wisps): only turn if the crossing is near.
    if (turn && (arcStart - along) * sgn > 11 * sp) turn = false;
    for (let i = 0; i < (turn ? 40 : n); i++) {
      const next = along + sgn * sp;
      if (turn && (next - arcStart) * sgn > 0) break;
      along = next;
      at(along, lat, xz);
      emit(xz[0], xz[1]);
    }
    this.turned = turn;
    if (!turn) return;
    // Quarter arc from (arcStart, line) onto the cross avenue, toward `side`.
    at(arcStart, lat, xz);
    const cx = xz[0] + (alongZ ? side * TURN_R : 0);
    const cz = xz[1] + (alongZ ? 0 : side * TURN_R);
    const a0 = Math.atan2(xz[0] - cx, xz[1] - cz);
    // Sweep the radius so the path starts out moving along the travel direction.
    const fx = alongZ ? 0 : sgn;
    const fz = alongZ ? sgn : 0;
    const sweep = Math.sign(Math.sin(a0) * fz - Math.cos(a0) * fx) || 1;
    const steps = Math.round(((Math.PI / 2) * TURN_R) / sp);
    for (let i = 1; i <= steps; i++) {
      const a = a0 - sweep * (i / steps) * (Math.PI / 2);
      emit(cx + Math.sin(a) * TURN_R, cz + Math.cos(a) * TURN_R);
    }
    // Then a few wisps straight on along the cross avenue.
    sgn = side;
    const a1 = a0 - sweep * (Math.PI / 2);
    let px = cx + Math.sin(a1) * TURN_R;
    let pz = cz + Math.cos(a1) * TURN_R;
    for (let i = 0; i < 3; i++) {
      px += (alongZ ? sgn : 0) * sp;
      pz += (alongZ ? 0 : sgn) * sp;
      emit(px, pz);
    }
  }

  /** Circle a tall tower: down from high up (a long swooping descent), or up from low. */
  private spiral(c: WispCursor, rand: () => number): boolean {
    const L = this.city;
    const t = this.tower;
    const ax = c.x + Math.sin(c.heading) * 140;
    const az = c.z + Math.cos(c.heading) * 140;
    if (!L.towerNear(ax, az, 200, t) || t.top < 80) return false;
    if (t.x === this.lastTower.x && t.z === this.lastTower.z) return false;
    const g = Math.max(L.height(t.x, t.z), 0);
    const R = t.half + 38; // a lazy circle: ~0.4 rad/s of turn at cruise
    const down = c.y > g + (t.top - g) * 0.55;
    const count = 18;
    const y0 = down ? Math.min(c.y, t.top + 20) : Math.max(c.y, g + 25);
    const y1 = down ? g + 35 : Math.min(t.top + 25, y0 + count * 2.4);
    const start = Math.atan2(c.x - t.x, c.z - t.z);
    const dir = rand() < 0.5 ? 1 : -1;
    const step = Config.wisps.spacing / R;
    for (let i = 0; i < count; i++) {
      const a = start + dir * i * step;
      this.pts.push(
        t.x + Math.sin(a) * R,
        y0 + ((y1 - y0) * i) / (count - 1),
        t.z + Math.cos(a) * R,
      );
    }
    return true;
  }
}
