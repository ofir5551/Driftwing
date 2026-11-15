import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import { createNoise2D, hash2, type Noise2D } from '../noise';
import { TREE, type JerusalemLayout } from './JerusalemLayout';
import { PROP, pushProp } from './props';

const pa = { x: 0, z: 0 };
const pb = { x: 0, z: 0 };
const fc = { u: 0, w: 0 };
/** Marching-squares scratch: the terrace grid's raw heights (in steps) and terrace amounts. */
let gridF = new Float64Array(0);
let gridT = new Float64Array(0);
const cross: number[] = [];

/**
 * Deterministic scatter of City of Gold's country for one chunk, pure (no Three): unit-tested.
 * Cells are enumerated by global index, so a seam never doubles or misses anything. Props go to
 * `out` (props.ts records), trees that line the roads to `trees` (TREE_STRIDE records).
 */
export class JerusalemScatter {
  private readonly rocky: Noise2D;
  private readonly scrubby: Noise2D;
  private readonly avenue: Noise2D;

  constructor(private readonly layout: JerusalemLayout) {
    this.rocky = createNoise2D(layout.seed + 31);
    this.scrubby = createNoise2D(layout.seed + 32);
    this.avenue = createNoise2D(layout.seed + 33);
  }

  scatter(ox: number, oz: number, size: number, out: number[], trees: number[]): void {
    out.length = 0;
    trees.length = 0;
    this.terraceWalls(ox, oz, size, out);
    this.fieldWalls(ox, oz, size, out);
    this.rocks(ox, oz, size, out);
    this.scrub(ox, oz, size, out);
    this.oleanders(ox, oz, size, out);
    this.flock(ox, oz, size, out);
    this.swifts(ox, oz, size, out);
    this.cypresses(ox, oz, size, trees);
  }

  /** Open hillside: not built, paved, farmed, planted or on a track. Fills the layout's scratch. */
  private open(x: number, z: number, roadGap: number): boolean {
    const L = this.layout;
    L.at(x, z);
    if (L.sd < 40 || L.town > 0.25 || L.cemetery(x, z) > 0) return false;
    // Clear of the landmarks standing in the open (a windmill, a church, a tower).
    if (L.solidTop(x, L.y + 1, z, 3) !== -Infinity) return false;
    L.track(x, z);
    if (L.roadE < roadGap || L.pathE < roadGap * 0.5) return false;
    return L.fieldAt(x, z) < 0;
  }

  /** Steepness (rise over run) of the terrain at (x, z). */
  private slope(x: number, z: number): number {
    const L = this.layout;
    const e = 2;
    const gx = L.height(x + e, z) - L.height(x - e, z);
    const gz = L.height(x, z + e) - L.height(x, z - e);
    return Math.hypot(gx, gz) / (2 * e);
  }

  /**
   * Dry-stone walls along every terrace: marching squares on a fine grid trace the contour in
   * the middle of each riser (the raw ground at k + 0.9 steps, where the terraced ground climbs
   * from step k to k + 1), and each crossing cell gets one wall piece standing from the lower
   * terrace to just over the upper one.
   */
  private terraceWalls(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.layout;
    const K = Config.jerusalem;
    const G = K.terraceGrid;
    const step = K.terraceStep;
    // A coarse look first: most chunks have no terraces.
    let any = false;
    for (let q = 0; q < 25 && !any; q++) {
      L.at(ox + ((q % 5) + 0.5) * (size / 5), oz + (Math.floor(q / 5) + 0.5) * (size / 5));
      if (L.terrace > 0.4) any = true;
    }
    if (!any) return;
    const i0 = Math.ceil(ox / G);
    const j0 = Math.ceil(oz / G);
    const n = Math.ceil((ox + size) / G) - i0; // cells along a side (their low corner inside)
    const m = n + 1;
    if (gridF.length < m * m) {
      gridF = new Float64Array(m * m);
      gridT = new Float64Array(m * m);
    }
    for (let v = 0; v < m; v++)
      for (let u = 0; u < m; u++) {
        L.at((i0 + u) * G, (j0 + v) * G);
        gridF[v * m + u] = L.yRaw / step;
        gridT[v * m + u] = L.terrace;
      }
    for (let v = 0; v < n; v++)
      for (let u = 0; u < n; u++) {
        const a = v * m + u;
        const f00 = gridF[a];
        const f10 = gridF[a + 1];
        const f01 = gridF[a + m];
        const f11 = gridF[a + m + 1];
        const t = (gridT[a] + gridT[a + 1] + gridT[a + m] + gridT[a + m + 1]) / 4;
        if (t < 0.7) continue;
        const lo = Math.min(f00, f10, f01, f11);
        const hi = Math.max(f00, f10, f01, f11);
        const x0 = (i0 + u) * G;
        const z0 = (j0 + v) * G;
        for (let k = Math.floor(lo - 0.9); k + 0.9 < hi; k++) {
          const lev = k + 0.9;
          if (lev < lo) continue;
          cross.length = 0;
          edge(f00, f10, lev, x0, z0, x0 + G, z0);
          edge(f10, f11, lev, x0 + G, z0, x0 + G, z0 + G);
          edge(f11, f01, lev, x0 + G, z0 + G, x0, z0 + G);
          edge(f01, f00, lev, x0, z0 + G, x0, z0);
          for (let c = 0; c + 3 < cross.length; c += 4)
            this.terraceWall(cross[c], cross[c + 1], cross[c + 2], cross[c + 3], out);
        }
      }
  }

  private terraceWall(ax: number, az: number, bx: number, bz: number, out: number[]): void {
    const L = this.layout;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.4) return;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    L.at(mx, mz);
    if (L.town > 0.3 || L.sd < 40 || L.terrace < 0.5) return;
    L.track(mx, mz);
    if (L.roadE < 0.5 || L.pathE < 0) return; // a track cuts through the terrace
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    // Across the wall: the ground below and above it (the terraced flats either side).
    const ya = L.height(mx - dz * 2.2, mz + dx * 2.2);
    const yb = L.height(mx + dz * 2.2, mz - dx * 2.2);
    const base = Math.min(ya, yb) - 0.5;
    const top = Math.max(ya, yb) + 0.3;
    // A riser retains one step: anything much taller is a slope the terraces gave up on.
    const step = Config.jerusalem.terraceStep;
    if (top - base < 1.2 || top - base > step * 1.7 || len > Config.jerusalem.terraceGrid * 1.5)
      return;
    if (L.solidTop(mx, top, mz, len / 2) !== -Infinity) return;
    pushProp(
      out,
      PROP.Wall,
      mx,
      base,
      mz,
      Math.atan2(-dz, dx),
      0,
      len + 0.5,
      top - base,
      1,
      hash2(Math.round(mx), Math.round(mz), 41),
    );
  }

  /**
   * Dry-stone walls round the walled fields on the valley floors (each piece follows the
   * slope), with gaps for gates and where a road passes. A field draws its four sides, but a
   * side it shares with another field only once (the lower-indexed one).
   */
  private fieldWalls(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.layout;
    const K = Config.jerusalem;
    const seed = L.seed + 720;
    const pieces = 5;
    // The field cells whose centre lies in the chunk (the grid is turned: cover its corners).
    let u0 = Infinity;
    let u1 = -Infinity;
    let w0 = Infinity;
    let w1 = -Infinity;
    for (let c = 0; c < 4; c++) {
      L.fieldCoords(ox + (c & 1) * size, oz + (c >> 1) * size, fc);
      u0 = Math.min(u0, fc.u);
      u1 = Math.max(u1, fc.u);
      w0 = Math.min(w0, fc.w);
      w1 = Math.max(w1, fc.w);
    }
    for (let j = Math.floor(w0) - 1; j <= Math.ceil(w1); j++)
      for (let i = Math.floor(u0) - 1; i <= Math.ceil(u1); i++) {
        L.fieldPoint(i + 0.5, j + 0.5, pa);
        if (pa.x < ox || pa.x >= ox + size || pa.z < oz || pa.z >= oz + size) continue;
        if (L.fieldKind(i, j) < 0) continue;
        // Sides: 0 low-w (j), 1 high-w (j + 1), 2 low-u (i), 3 high-u (i + 1).
        for (let side = 0; side < 4; side++) {
          const ni = side === 2 ? i - 1 : side === 3 ? i + 1 : i;
          const nj = side === 0 ? j - 1 : side === 1 ? j + 1 : j;
          if ((side === 1 || side === 3) && L.fieldKind(ni, nj) >= 0) continue; // theirs
          for (let k = 0; k < pieces; k++) {
            const h = hash2(i * 13 + k + side * 101, j * 7 + side, seed);
            if (h < 0.08) continue; // a gate
            const t0 = k / pieces;
            const t1 = (k + 1) / pieces;
            if (side < 2) {
              const w = j + side;
              L.fieldPoint(i + t0, w, pa);
              L.fieldPoint(i + t1, w, pb);
            } else {
              const u = i + side - 2;
              L.fieldPoint(u, j + t0, pa);
              L.fieldPoint(u, j + t1, pb);
            }
            const xm = (pa.x + pb.x) / 2;
            const zm = (pa.z + pb.z) / 2;
            L.track(xm, zm);
            if (L.roadE < 1 || L.pathE < 0.3) continue;
            const ya = L.height(pa.x, pa.z);
            const yb = L.height(pb.x, pb.z);
            const len = K.fieldCell / pieces;
            if (L.solidTop(xm, (ya + yb) / 2 + 0.5, zm, len / 2) !== -Infinity) continue;
            const yaw = Math.atan2(-(pb.z - pa.z), pb.x - pa.x);
            pushProp(
              out,
              PROP.Wall,
              xm,
              (ya + yb) / 2 - 0.15,
              zm,
              yaw,
              Math.atan2(yb - ya, len),
              len * 1.04,
              1.05 + h * 0.3,
              1,
              hash2(i, j + k, seed + 3),
            );
          }
        }
      }
  }

  /**
   * Pale limestone breaking out of the hills: shelves on the steep and high ground (bedded
   * like the walls built from them), loose boulders round them and along the paths.
   */
  private rocks(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.layout;
    const seed = L.seed + 740;
    const cell = 14;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const r = hash2(i, j, seed);
        if (r > 0.6) continue;
        const x = (i + hash2(i, j, seed + 1)) * cell;
        const z = (j + hash2(i, j, seed + 2)) * cell;
        if (!this.open(x, z, 2)) continue;
        if (L.bedD < Config.jerusalem.bedWidth + 1) continue; // the pebble bed stays clear
        L.at(x, z);
        const y = L.y;
        const terr = L.terrace;
        const sl = this.slope(x, z);
        const rocky = smoothstep(-0.15, 0.45, this.rocky(x * 0.005, z * 0.005));
        const chance =
          0.03 +
          rocky * 0.35 * smoothstep(0.12, 0.4, sl) +
          smoothstep(90, 125, y) * 0.15 +
          smoothstep(0.35, 0.7, sl) * 0.25;
        if (r > chance * (1 - terr * 0.8)) continue;
        const n = 1 + Math.floor(hash2(i, j, seed + 3) * (1.5 + rocky * 3));
        for (let k = 0; k < n; k++) {
          const a = hash2(i, j, seed + 10 + k) * Math.PI * 2;
          const d = k === 0 ? 0 : 2.5 + hash2(i, j, seed + 20 + k) * 4;
          const rx = x + Math.cos(a) * d;
          const rz = z + Math.sin(a) * d;
          if (k > 0 && !this.open(rx, rz, 1.5)) continue;
          const ry = L.height(rx, rz);
          const shelf = k === 0 && (sl > 0.18 || rocky > 0.5);
          const s = (shelf ? 1 : 0.55) * (0.7 + hash2(i, j, seed + 30 + k) * (0.6 + rocky));
          pushProp(
            out,
            shelf ? PROP.Outcrop : PROP.Boulder,
            rx,
            ry - (shelf ? 0.6 : 0.25) * s,
            rz,
            a * 3,
            0,
            s,
            s * (0.8 + hash2(i, j, seed + 50 + k) * 0.4),
            s,
            hash2(i, j, seed + 60 + k),
          );
        }
      }
  }

  /** Garrigue on the open hills: cushions of thorny burnet and sage, in drifts. */
  private scrub(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.layout;
    const seed = L.seed + 760;
    const cell = 7;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const r = hash2(i, j, seed);
        if (r > 0.55) continue;
        const x = (i + hash2(i, j, seed + 1)) * cell;
        const z = (j + hash2(i, j, seed + 2)) * cell;
        const drift = smoothstep(-0.2, 0.4, this.scrubby(x * 0.012, z * 0.012));
        if (r > 0.12 + drift * 0.43) continue;
        if (!this.open(x, z, 1.2)) continue;
        L.at(x, z);
        if (L.olive > 0.55 || L.pine > 0.7 || L.valley > 0.85) continue;
        const y = L.y;
        const s = 0.65 + hash2(i, j, seed + 3) * 0.7;
        pushProp(
          out,
          PROP.Scrub,
          x,
          y - 0.12,
          z,
          hash2(i, j, seed + 4) * Math.PI * 2,
          0,
          s * 1.15,
          s * (0.75 + hash2(i, j, seed + 5) * 0.4),
          s,
          hash2(i, j, seed + 6),
        );
      }
  }

  /** Oleanders in pink flower along the banks of the dry valley beds. */
  private oleanders(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.layout;
    const K = Config.jerusalem;
    const seed = L.seed + 780;
    const cell = 8;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        if (hash2(i, j, seed) > 0.6) continue;
        const x = (i + hash2(i, j, seed + 1)) * cell;
        const z = (j + hash2(i, j, seed + 2)) * cell;
        L.at(x, z);
        if (L.valley < 0.75 || L.town > 0.3 || L.sd < 40) continue;
        const y = L.y;
        L.track(x, z);
        const bank = L.bedD - K.bedWidth;
        if (bank < -0.3 || bank > 4 || L.roadE < 1.5 || L.pathE < 0.5) continue;
        if (L.fieldAt(x, z) >= 0 || L.solidTop(x, y + 1, z, 2.5) !== -Infinity) continue;
        const s = 0.75 + hash2(i, j, seed + 3) * 0.6;
        pushProp(
          out,
          PROP.Oleander,
          x,
          y - 0.15,
          z,
          hash2(i, j, seed + 4) * Math.PI * 2,
          0,
          s,
          s * (0.85 + hash2(i, j, seed + 5) * 0.3),
          s,
          hash2(i, j, seed + 6),
        );
      }
  }

  /** Now and then a flock of goats and sheep grazing an open hillside, its shepherd nearby. */
  private flock(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.layout;
    const seed = L.seed + 800;
    const ci = Math.round(ox / size);
    const cj = Math.round(oz / size);
    if (hash2(ci, cj, seed) >= Config.jerusalem.flocks) return;
    for (let tries = 0; tries < 5; tries++) {
      const hx = ox + 20 + hash2(ci + tries, cj, seed + 1) * (size - 40);
      const hz = oz + 20 + hash2(ci, cj + tries, seed + 2) * (size - 40);
      if (!this.open(hx, hz, 6)) continue;
      L.at(hx, hz);
      if (L.olive > 0.5 || L.pine > 0.4 || L.sd < 120 || this.slope(hx, hz) > 0.35) continue;
      const goats = 0.35 + hash2(ci, cj, seed + 3) * 0.6; // share of goats in the mix
      const n = 7 + Math.floor(hash2(ci, cj, seed + 4) * 10);
      const head = hash2(ci, cj, seed + 5) * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const a = hash2(k, ci, seed + 6) * Math.PI * 2;
        const d = Math.sqrt(hash2(cj, k, seed + 7)) * 11;
        const x = hx + Math.cos(a) * d;
        const z = hz + Math.sin(a) * d;
        if (!this.open(x, z, 1)) continue;
        const goat = hash2(k, cj, seed + 8) < goats;
        const s = 0.85 + hash2(k + 3, ci, seed + 9) * 0.3;
        pushProp(
          out,
          goat ? PROP.Goat : PROP.Sheep,
          x,
          L.height(x, z),
          z,
          head + (hash2(k, k, seed + 10) - 0.5) * 2.2,
          0,
          s,
          s,
          s,
          hash2(k, ci + cj, seed + 11),
        );
      }
      // The shepherd at the flock's edge, leaning on a staff.
      const sx = hx + Math.cos(head + Math.PI) * 13;
      const sz = hz + Math.sin(head + Math.PI) * 13;
      if (this.open(sx, sz, 1))
        pushProp(out, PROP.Shepherd, sx, L.height(sx, sz), sz, head, 0, 1, 1, 1, 0.5);
      return;
    }
  }

  /** Swifts wheeling and screaming over the roofs of the Old City and the towns. */
  private swifts(ox: number, oz: number, size: number, out: number[]): void {
    const L = this.layout;
    const seed = L.seed + 820;
    const ci = Math.round(ox / size);
    const cj = Math.round(oz / size);
    if (hash2(ci, cj, seed) >= Config.jerusalem.swifts) return;
    const fx = ox + size * (0.3 + 0.4 * hash2(ci, cj, seed + 1));
    const fz = oz + size * (0.3 + 0.4 * hash2(ci, cj, seed + 2));
    L.at(fx, fz);
    if (L.fabric < 0.5 && L.town < 0.5) return;
    const fy = L.y + L.canopyH + 22 + hash2(ci, cj, seed + 3) * 18;
    const n = 8 + Math.floor(hash2(ci, cj, seed + 4) * 9);
    for (let k = 0; k < n; k++) {
      const dx = (hash2(k, ci, seed + 5) - 0.5) * 16;
      const dy = (hash2(k, cj, seed + 6) - 0.5) * 6;
      const dz = (hash2(cj, k, seed + 7) - 0.5) * 16;
      pushProp(out, PROP.Swift, fx + dx, fy + dy, fz + dz, 0, 0, 0.55, 0.55, 0.55, 0.5);
    }
  }

  /**
   * Cypresses lining stretches of road, a few metres off the verge: each node of a 10 m grid
   * near a road is moved across to the line along it, and kept if it stays in its own cell (so
   * neighbours never double up).
   */
  private cypresses(ox: number, oz: number, size: number, trees: number[]): void {
    const L = this.layout;
    const K = Config.jerusalem;
    const seed = L.seed + 840;
    const cell = 10;
    const off = 3; // m beyond the road's edge
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + 0.5) * cell;
        const z = (j + 0.5) * cell;
        L.track(x, z);
        const d = L.roadE;
        if (d > cell || d < -K.roadWidth) continue;
        const lined = smoothstep(
          0.55 - K.cypressLines,
          0.75 - K.cypressLines,
          this.avenue(x * 0.004, z * 0.004),
        );
        if (hash2(i, j, seed) > lined * 0.9) continue;
        const e = 2;
        L.track(x + e, z);
        const gx = L.roadE;
        L.track(x, z + e);
        const gz = L.roadE;
        let nx = gx - d;
        let nz = gz - d;
        const l = Math.hypot(nx, nz);
        if (l < 1e-4) continue;
        nx /= l;
        nz /= l;
        const tx = x - nx * (d - off);
        const tz = z - nz * (d - off);
        if (Math.floor(tx / cell) !== i || Math.floor(tz / cell) !== j) continue;
        if (!this.open(tx, tz, 1.5) && L.town < 0.25) continue;
        L.at(tx, tz);
        if (L.sd < 30) continue;
        L.track(tx, tz);
        if (L.roadE < 1.5 || L.pathE < 0.5) continue;
        trees.push(
          TREE.CYPRESS,
          tx,
          L.height(tx, tz) - 0.3,
          tz,
          0.85 + hash2(i, j, seed + 1) * 0.35,
          hash2(i, j, seed + 2) * Math.PI * 2,
          hash2(i, j, seed + 3),
        );
      }
  }
}

/** A marching-squares edge from a (value fa) to b (fb): its crossing of `lev`, if any. */
function edge(
  fa: number,
  fb: number,
  lev: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): void {
  if (fa < lev === fb < lev) return;
  const t = (lev - fa) / (fb - fa);
  cross.push(ax + (bx - ax) * t, az + (bz - az) * t);
}
