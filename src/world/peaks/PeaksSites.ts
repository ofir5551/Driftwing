import { Config } from '../../core/Config';
import { clamp, smoothstep } from '../../core/math';
import { hash2 } from '../noise';
import { Temple, type PeaksLayout, type Spire } from './PeaksLayout';
import { SHAPES } from './profile';
import { SKINS } from './skin';

/**
 * Sea of Clouds' signs of life that span the air or climb the rock (pure, no Three.js,
 * unit-tested): rope bridges and strings of prayer flags between neighbouring spires, the
 * monastery's stair cut round its spire from the gate bridge to the summit, and flocks of
 * cranes wheeling over the cloud sea. The renderer and the wisp planner read the same records,
 * so ribbons keep clear of every rope.
 *
 * Ropes are soft (the bird brushes through a flag line as through a cloud bank): the planner
 * keeps every ribbon `ropeClear` metres off them, so they are never in the way of the flow.
 */

/** A sagging rope between two anchors: a plank bridge (kind 0) or a line of prayer flags (1). */
export interface Rope {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Sag at midspan, metres. */
  sag: number;
  kind: 0 | 1;
  /** Per-rope random in [0, 1). */
  seed: number;
}

/** A crane flock wheeling round a circle: centre, height, radius, birds, direction, phase. */
export interface Flock {
  x: number;
  y: number;
  z: number;
  r: number;
  n: number;
  /** +1 counter-clockwise seen from above, -1 clockwise. */
  dir: number;
  seed: number;
}

/** A point on a sagging rope at u in [0, 1] (parabolic sag; plenty for a rope this taut). */
export function ropeAt(r: Rope, u: number, out: { x: number; y: number; z: number }): void {
  out.x = r.x0 + (r.x1 - r.x0) * u;
  out.y = r.y0 + (r.y1 - r.y0) * u - r.sag * 4 * u * (1 - u);
  out.z = r.z0 + (r.z1 - r.z0) * u;
}

const CELL_CACHE = 4000;
/** Rope ends hold this share of the rock's radius in from its profile (into the stone). */
const ANCHOR = 0.86;

export class PeaksSites {
  /** The monastery stair: x, y, z, heading (along the climb) per step, bottom to top. */
  readonly stair: number[] = [];
  /** Flag lines the gate carries (summit to summit). */
  readonly gateRopes: Rope[] = [];
  private readonly ropeCells = new Map<number, Rope[]>();
  private readonly flockCells = new Map<number, Flock | null>();
  private readonly pt = { x: 0, y: 0, z: 0 };

  constructor(private readonly L: PeaksLayout) {
    this.buildStair();
    // A long line of flags from the monastery's terrace across to the other gate summit.
    const [a, b] = L.gate;
    const ya = a.y0 + a.h + 2;
    const yb = b.y0 + b.h * 0.97;
    const ra = a.r * 0.5;
    const rb = b.r * 0.4;
    this.gateRopes.push({
      x0: a.x + a.lx - ra,
      y0: ya,
      z0: a.z + a.lz,
      x1: b.x + b.lx + rb,
      y1: yb,
      z1: b.z + b.lz,
      sag: 9,
      kind: 1,
      seed: 0.37,
    });
  }

  // --- The monastery stair ----------------------------------------------------------------------

  /**
   * Steps cut round the monastery's spire from the gate bridge's deck to the summit: one turn
   * and a little more, climbing at a stair's pitch, set into the rock's skin (where a chimney
   * cuts deep the step's wall carries it across).
   */
  private buildStair(): void {
    const L = this.L;
    const p = L.gate.find((g) => g.temple === Temple.Monastery) ?? L.gate[0];
    const skin = SKINS[p.shape];
    const b = L.bridge;
    const y0 = b.y + 0.3;
    const y1 = p.y0 + p.h * 0.975;
    // Start where the deck meets the rock (the side facing the other spire) and wind round.
    const w0 = Math.atan2(b.z - p.z, (p.x > 0 ? b.x1 : b.x0) - p.x);
    const rise = 0.55;
    const tread = 1.05;
    let w = w0;
    let y = y0;
    const turn = p.x > 0 ? -1 : 1;
    while (y < y1 && this.stair.length < 4 * 400) {
      const t = (y - p.y0) / p.h;
      const a = w + p.yaw; // the skin's local angle
      const rr = p.r * skin.radius(t, a);
      const rc = Math.max(rr, 0.97 * L.axisAt(p, y)) + 1.1;
      const cx = L.ax;
      const cz = L.az;
      const x = cx + Math.cos(w) * rc;
      const z = cz + Math.sin(w) * rc;
      // Heading along the climb: the tangent of the circle in the turning direction.
      const hx = -Math.sin(w) * turn;
      const hz = Math.cos(w) * turn;
      this.stair.push(x, y, z, Math.atan2(hx, hz));
      w += (turn * tread) / rc;
      y += rise;
    }
  }

  // --- Ropes ------------------------------------------------------------------------------------

  /** Ropes whose owning spire stands in spire cell (i, j). Cached; pure in the seed. */
  ropes(i: number, j: number): Rope[] {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    let list = this.ropeCells.get(key);
    if (list) return list;
    if (this.ropeCells.size > CELL_CACHE) this.ropeCells.clear();
    list = [];
    const L = this.L;
    const P = Config.peaks;
    const s = L.seed;
    for (const p of L.cell(i, j)) {
      if (p.temple === Temple.Monastery) continue;
      const hb = hash2(Math.floor(p.x * 7), Math.floor(p.z * 7), s + 601);
      if (hb < P.ropeBridges) this.pair(p, i, j, 0, list);
      else if (hb < P.ropeBridges + P.flagLines) this.pair(p, i, j, 1, list);
    }
    this.ropeCells.set(key, list);
    return list;
  }

  /** The nearest neighbour of p that a bridge (kind 0) or flag line (1) can span to. */
  private pair(p: Spire, i: number, j: number, kind: 0 | 1, out: Rope[]): void {
    const L = this.L;
    const P = Config.peaks;
    const shp = SHAPES[p.shape];
    if (p.h < (kind === 0 ? 120 : 90)) return;
    let best: Rope | null = null;
    let bestD = Infinity;
    for (let jj = j - 1; jj <= j + 1; jj++)
      for (let ii = i - 1; ii <= i + 1; ii++)
        for (const q of L.cell(ii, jj)) {
          // Each pair once: from the spire that comes first.
          if (q === p || q.x < p.x || (q.x === p.x && q.z <= p.z)) continue;
          if (q.temple === Temple.Monastery) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < (kind === 0 ? 45 : 40) || d > (kind === 0 ? P.ropeSpan : P.ropeSpan * 1.2))
            continue;
          if (d >= bestD) continue;
          const shq = SHAPES[q.shape];
          // A bridge hangs among the walls, a flag line from near the summits.
          const topP = p.y0 + p.h * (shp.cap - 0.04);
          const topQ = q.y0 + q.h * (shq.cap - 0.04);
          const r = hash2(Math.floor(p.x), Math.floor(q.z), L.seed + 603);
          const y =
            kind === 0 ? Math.min(topP, topQ) - 12 - r * 40 : Math.min(topP, topQ) - 2 - r * 8;
          if (y < P.cloud + (kind === 0 ? 70 : 55)) continue;
          const ra = L.axisAt(p, y);
          const ax = L.ax;
          const az = L.az;
          const rb = L.axisAt(q, y);
          const bx = L.ax;
          const bz = L.az;
          if (ra < 0 || rb < 0) continue;
          const dx = bx - ax;
          const dz = bz - az;
          const dl = Math.hypot(dx, dz);
          const span = dl - (ra + rb) * ANCHOR;
          if (span < 12 || span > 95) continue;
          const ux = dx / dl;
          const uz = dz / dl;
          const rope: Rope = {
            x0: ax + ux * ra * ANCHOR,
            y0: y,
            z0: az + uz * ra * ANCHOR,
            x1: bx - ux * rb * ANCHOR,
            y1: y,
            z1: bz - uz * rb * ANCHOR,
            sag: span * (kind === 0 ? 0.07 : 0.1),
            kind,
            seed: r,
          };
          if (!this.ropeFree(rope, p, q)) continue;
          best = rope;
          bestD = d;
        }
    if (best) out.push(best);
  }

  /** Is the rope clear of every other spire and of the opening run? */
  private ropeFree(r: Rope, p: Spire, q: Spire): boolean {
    const L = this.L;
    const pt = this.pt;
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const n = Math.max(2, Math.ceil(len / 3));
    for (let k = 0; k <= n; k++) {
      ropeAt(r, k / n, pt);
      if (L.reserved(pt.x, pt.z, 40)) return false;
      if (L.solidTop(pt.x, pt.y, pt.z, 3) !== -Infinity) {
        const h = L.hitSpire;
        if (h !== p && h !== q) return false;
      }
    }
    return true;
  }

  /** Every rope (gate lines included) that may come within `pad` of (x, z), passed to `fn`. */
  forRopes(x: number, z: number, pad: number, fn: (r: Rope) => void): void {
    const C = Config.peaks.spireCell;
    const R = Config.peaks.ropeSpan + 60 + pad;
    for (let j = Math.floor((z - R) / C); j <= Math.floor((z + R) / C); j++)
      for (let i = Math.floor((x - R) / C); i <= Math.floor((x + R) / C); i++)
        for (const r of this.ropes(i, j)) fn(r);
    for (const r of this.gateRopes) fn(r);
  }

  private nearHit = false;
  private nx = 0;
  private ny = 0;
  private nz = 0;
  private nm = 0;
  private readonly nearFn = (r: Rope): void => {
    if (this.nearHit) return;
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const l2 = dx * dx + dz * dz;
    const u = clamp(((this.nx - r.x0) * dx + (this.nz - r.z0) * dz) / l2, 0, 1);
    ropeAt(r, u, this.pt);
    const pt = this.pt;
    if (Math.hypot(this.nx - pt.x, this.ny - pt.y, this.nz - pt.z) < this.nm) this.nearHit = true;
  };

  /** Is (x, y, z) within `margin` of any rope (a bridge or a flag line)? */
  ropeNear(x: number, y: number, z: number, margin: number): boolean {
    this.nearHit = false;
    this.nx = x;
    this.ny = y;
    this.nz = z;
    this.nm = margin;
    this.forRopes(x, z, margin, this.nearFn);
    return this.nearHit;
  }

  // --- Cranes -----------------------------------------------------------------------------------

  /** The crane flock wheeling in flock cell (i, j), or null. Cached; pure in the seed. */
  flock(i: number, j: number): Flock | null {
    const key = (i + 0x8000) * 0x10000 + (j + 0x8000);
    const hit = this.flockCells.get(key);
    if (hit !== undefined) return hit;
    if (this.flockCells.size > CELL_CACHE) this.flockCells.clear();
    const L = this.L;
    const P = Config.peaks;
    const C = P.flockCell;
    const s = L.seed;
    let f: Flock | null = null;
    if (hash2(i + 77, j - 31, s + 611) < P.flockChance) {
      const x = (i + 0.25 + 0.5 * hash2(i, j, s + 612)) * C;
      const z = (j + 0.25 + 0.5 * hash2(i, j, s + 613)) * C;
      const r = 150 + 110 * hash2(i, j, s + 614);
      // High enough to clear every summit under its circle, by a margin.
      let top = P.cloud + 80;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        top = Math.max(top, L.skyline(x + Math.cos(a) * r, z + Math.sin(a) * r, 30) + 30);
      }
      if (top < P.flockTop)
        f = {
          x,
          y: top + 10 * hash2(i, j, s + 615),
          z,
          r,
          n: 5 + Math.floor(hash2(i, j, s + 616) * 5),
          dir: hash2(i, j, s + 617) < 0.5 ? 1 : -1,
          seed: hash2(i, j, s + 618),
        };
    }
    this.flockCells.set(key, f);
    return f;
  }
}

/**
 * 0..1: how strongly the sun's beams show for a sun at height sunY: from mid-morning to the
 * golden hour, when they slant down through the haze. Lower, they would lie along the sea and
 * sweep the whole view (the screen-space shafts take over there); at noon the air is clear.
 */
export function beamLight(sunY: number): number {
  return smoothstep(0.14, 0.26, sunY) * (1 - smoothstep(0.55, 0.8, sunY));
}
