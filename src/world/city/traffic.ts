import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import { harbourAt } from './CityHarbour';
import type { CityLayout } from './CityLayout';

/**
 * Neon Bay's traffic as pure data (unit-tested, no Three): cars down the avenues, the bayside
 * road and the expressway decks, trams on a few avenues, ferries crossing the bay and water
 * taxis along its shores.
 *
 * Every lane is a line the vehicles run along forever: on a lane with spacing D and speed v,
 * vehicle k is at s = k D + jitter(k) + v t, so where a vehicle is depends only on the lane and
 * the time, never on when the lane was planned. Planning (when the chunk set changes) only
 * picks the lanes near the bird, clips them to the road (an avenue ends at the bayside road's
 * kerb; east-west roads stop at their green strip) and samples each one's ground into a
 * preallocated profile, so the per-frame placement reads arrays and allocates nothing. Japan
 * drives on the left.
 */

/** Vehicle kinds (one instanced mesh each). */
export const VEHICLE = { CAR: 0, TRAM: 1, FERRY: 2 } as const;
/** Floats per placed vehicle: kind, x, y, z, yaw, scale, tint (0..1). */
export const VEHICLE_STRIDE = 7;
export const MAX_VEHICLES = 2400;

/** Lane shapes. */
const LINE_Z = 0; // runs along z at x = c (+ offset)
const LINE_X = 1; // runs along x at z = c (+ offset)
const SHORE = 2; // runs along x at a fixed distance from a seawall (profile holds z)
const OVAL = 3; // a ferry's loop across the bay: legs along z at x = c +- r

const MAX_LANES = 192;
const SAMPLES = 160;
const STEP = 8;
/** Floats per lane record. */
const LS = 14;
/** Lane record fields. */
const KIND = 0;
const SHAPE = 1;
const C = 2;
const DIR = 3;
const OFF = 4;
const SPEED = 5;
const SPACING = 6;
const S0 = 7;
const S1 = 8;
const ID = 9;
const Y = 10; // fixed height (decks, water), or NaN: the sampled ground
const SCALE = 11;
const FILL = 12; // share of the slots that hold a vehicle
const N = 13; // samples in the profile

/** Ferry loop half width (m) and how far from each seawall it turns. */
const OVAL_R = 22;
const OVAL_IN = 60;

const tramX = (I: number) => ((I % 3) + 3) % 3 === 2;

export class TrafficPlan {
  private readonly lanes = new Float64Array(MAX_LANES * LS);
  /** Per lane: sampled ground height and (shore lanes) z along the lane. */
  private readonly ys = new Float32Array(MAX_LANES * SAMPLES);
  private readonly zs = new Float32Array(MAX_LANES * SAMPLES);
  private count = 0;

  constructor(private readonly L: CityLayout) {}

  get laneCount(): number {
    return this.count;
  }

  /**
   * Pick the lanes within `roads` of (px, pz) (cars, trams) and `water` (ferries, taxis), plus
   * `pad` metres of flight before the next plan.
   */
  plan(px: number, pz: number, roads: number, water: number, pad: number): void {
    this.count = 0;
    const L = this.L;
    const S = L.S;
    const C2 = Config.city;
    if (roads > 0) {
      const r = roads + pad;
      // North-south avenues: three lanes each way; a tram line keeps the inner lanes.
      for (let I = Math.ceil((px - r) / S); I <= Math.floor((px + r) / S); I++) {
        const x = I * S;
        const tram = tramX(I);
        for (const dir of [1, -1]) {
          // Driving on the left: northbound (+z) keeps to +x.
          this.street(LINE_Z, x, dir, dir * 8.25, pz - r, pz + r, 0, 12.5, 34, I * 7 + dir);
          this.street(LINE_Z, x, dir, dir * 13.0, pz - r, pz + r, 0, 11, 46, I * 7 + dir + 2);
          if (tram)
            this.street(LINE_Z, x, dir, dir * 2.75, pz - r, pz + r, 1, 8.5, 320, I * 7 + dir + 4);
          else
            this.street(LINE_Z, x, dir, dir * 2.75, pz - r, pz + r, 0, 13.5, 40, I * 7 + dir + 4);
        }
        if (L.expressX(I))
          for (const dir of [1, -1])
            for (const o of [2.2, 5.4])
              this.lane(
                LINE_Z,
                0,
                x,
                dir,
                dir * o,
                pz - r,
                pz + r,
                20 + o,
                44,
                I * 13 + o + dir,
                16.6,
                1,
                0.75,
              );
      }
      for (let J = Math.ceil((pz - r) / S); J <= Math.floor((pz + r) / S); J++) {
        const z = J * S;
        const tram = tramX(J);
        for (const dir of [1, -1]) {
          // Eastbound (+x) keeps to -z.
          this.street(LINE_X, z, dir, -dir * 8.25, px - r, px + r, 0, 12.5, 34, J * 11 + dir);
          this.street(LINE_X, z, dir, -dir * 13.0, px - r, px + r, 0, 11, 46, J * 11 + dir + 2);
          if (tram)
            this.street(LINE_X, z, dir, -dir * 2.75, px - r, px + r, 1, 8.5, 320, J * 11 + dir + 4);
          else
            this.street(LINE_X, z, dir, -dir * 2.75, px - r, px + r, 0, 13.5, 40, J * 11 + dir + 4);
        }
        if (L.expressZ(J))
          for (let I = Math.floor((px - r) / S); I <= Math.floor((px + r) / S); I++) {
            // The deck runs only over superblocks the bay never reaches (as the layout builds it).
            let wet = false;
            for (let t = 0; t <= S; t += S / 4) wet ||= L.inSea(I * S + t, z);
            if (wet) continue;
            for (const dir of [1, -1])
              for (const o of [2.2, 5.4])
                this.lane(
                  LINE_X,
                  0,
                  z,
                  dir,
                  -dir * o,
                  Math.max(I * S, px - r),
                  Math.min((I + 1) * S, px + r),
                  20 + o,
                  44,
                  J * 17 + o + dir + I * 3,
                  24.6,
                  1,
                  0.75,
                );
          }
      }
      // The bayside road along each seawall in reach: two lanes each way.
      const prom = C2.promenade;
      const br = C2.bayRoad;
      for (const side of [1, -1]) {
        const e = side > 0 ? L.shoreNear(px) : L.shoreFar(px);
        if (Math.abs(e - pz) > r + 200) continue;
        for (const [sd, dir] of [
          // Near shore (land toward -z): eastbound keeps to -z, the inland half.
          [prom + br * 0.875, side],
          [prom + br * 0.625, side],
          [prom + br * 0.375, -side],
          [prom + br * 0.125, -side],
        ] as const)
          this.shore(side, sd, dir, px - r, px + r, 0, 12, 36, side * 31 + sd, NaN, 1, 0.7);
      }
    }
    if (water > 0) {
      const r = water + pad;
      // Water taxis out beyond the piers, both ways along each shore.
      for (const side of [1, -1]) {
        const e = side > 0 ? L.shoreNear(px) : L.shoreFar(px);
        if (Math.abs(e - pz) > r + 300) continue;
        const a = this.taxiLane(side, 150, px - r, px + r);
        const b = this.taxiLane(side, a + 16, px - r, px + r);
        this.shore(side, -a, side, px - r, px + r, 2, 9, 420, side * 41, -0.2, 0.42, 0.8);
        this.shore(side, -b, -side, px - r, px + r, 2, 8, 520, side * 43, -0.2, 0.36, 0.8);
      }
      // Ferries looping across the bay, two to a route.
      const P = 640;
      for (let k = Math.floor((px - r) / P) - 1; k <= Math.floor((px + r) / P) + 1; k++) {
        const x0 = k * P + 320 + (hash2(k, 5, L.seed + 731) - 0.5) * 160;
        if (!this.ferryRoute(x0)) continue;
        const za = L.shoreNear(x0) + OVAL_IN;
        const zb = L.shoreFar(x0) - OVAL_IN;
        if (Math.max(Math.abs(za - pz), Math.abs(zb - pz)) > r + 2000 && (pz < za || pz > zb))
          continue;
        const per = 2 * (zb - za) + 2 * Math.PI * OVAL_R;
        this.lane(OVAL, 2, x0, 1, 0, za, zb, 7, per / 2, k * 19, -0.3, 1, 1);
      }
    }
  }

  /**
   * How far out (m, from `from` on) a water taxi lane runs so that it passes between the piers
   * of every expressway bridge it crosses in [a, b] (they stand every 40 m, on the 20 m mark).
   */
  private taxiLane(side: number, from: number, a: number, b: number): number {
    const L = this.L;
    const S = L.S;
    for (let d = from; d < from + 40; d += 2) {
      let clear = true;
      for (let I = Math.ceil(a / S); I <= Math.floor(b / S) && clear; I++) {
        if (!L.expressX(I)) continue;
        const x = I * S;
        const z = side > 0 ? L.shoreNear(x) + d : L.shoreFar(x) - d;
        const q = (((z - 20) % 40) + 40) % 40;
        clear = Math.min(q, 40 - q) > 7;
      }
      // And well clear of the torii standing in the bay.
      const g = L.gate;
      if (side > 0 && Math.abs(L.shoreNear(g.x) + d - g.z) < 18) clear = false;
      if (clear) return d;
    }
    return from;
  }

  /** A route clear of the spawn's view of the torii, of harbours and of expressway piers. */
  private ferryRoute(x0: number): boolean {
    const L = this.L;
    const S = L.S;
    if (Math.abs(x0) < 160) return false;
    for (let I = Math.floor((x0 - 120) / S); I <= Math.floor((x0 + 120) / S); I++)
      if (harbourAt(L.seed, I, 1) || harbourAt(L.seed, I, -1)) return false;
    const I = Math.round(x0 / S);
    return !(L.expressX(I) && Math.abs(x0 - I * S) < OVAL_R + 30);
  }

  /** A street lane, clipped to the stretches of road (off the bay and short of the shore). */
  private street(
    shape: number,
    c: number,
    dir: number,
    off: number,
    a: number,
    b: number,
    kind: number,
    speed: number,
    spacing: number,
    id: number,
  ): void {
    const L = this.L;
    const minSd = shape === LINE_Z ? L.roadIn + 2 : L.eastWestIn + 2;
    let run = NaN;
    // Step 10 m along the window; the last step lands past b so an open run is always closed.
    const steps = Math.ceil((b - a) / 10) + 1;
    for (let i = 0; i <= steps; i++) {
      const s = a + i * 10;
      const x = shape === LINE_Z ? c + off : s;
      const z = shape === LINE_Z ? s : c + off;
      const land = i < steps && L.shoreDist(x, z) > minSd;
      if (land && Number.isNaN(run)) run = s;
      if (!land && !Number.isNaN(run)) {
        if (s - run > 40)
          this.lane(
            shape,
            kind,
            c,
            dir,
            off,
            run,
            s - 10,
            speed,
            spacing,
            id,
            NaN,
            1,
            kind === 1 ? 1 : 0.72,
          );
        run = NaN;
      }
    }
  }

  /** A lane along a seawall, `sd` metres inland of it (negative: out on the water). */
  private shore(
    side: number,
    sd: number,
    dir: number,
    a: number,
    b: number,
    kind: number,
    speed: number,
    spacing: number,
    id: number,
    y: number,
    scale: number,
    fill: number,
  ): void {
    this.lane(SHORE, kind, side, dir, sd, a, b, speed, spacing, id, y, scale, fill);
  }

  private lane(
    shape: number,
    kind: number,
    c: number,
    dir: number,
    off: number,
    s0: number,
    s1: number,
    speed: number,
    spacing: number,
    id: number,
    y: number,
    scale: number,
    fill: number,
  ): void {
    if (this.count >= MAX_LANES) return;
    const li = this.count++;
    const R = this.lanes;
    const o = li * LS;
    R[o + KIND] = kind;
    R[o + SHAPE] = shape;
    R[o + C] = c;
    R[o + DIR] = dir;
    R[o + OFF] = off;
    R[o + SPEED] = speed;
    R[o + SPACING] = spacing;
    R[o + S0] = s0;
    R[o + S1] = s1;
    R[o + ID] = id;
    R[o + Y] = y;
    R[o + SCALE] = scale;
    R[o + FILL] = fill;
    // Sample the ground (and a shore lane's z) along the lane, STEP apart.
    const L = this.L;
    const n = shape === OVAL ? 0 : Math.min(SAMPLES, Math.floor((s1 - s0) / STEP) + 2);
    R[o + N] = n;
    const water = Config.world.waterLevel + 0.6;
    for (let i = 0; i < n; i++) {
      const s = Math.min(s1, s0 + i * STEP);
      let x = s;
      let z: number;
      if (shape === LINE_Z) {
        x = c + off;
        z = s;
      } else if (shape === LINE_X) z = c + off;
      else z = c > 0 ? L.shoreNear(s) - off : L.shoreFar(s) + off;
      this.zs[li * SAMPLES + i] = z;
      // Over a river the road is a bridge deck (the layout's decks top out at 3.3 m).
      const g = L.baseHeight(x, z);
      this.ys[li * SAMPLES + i] = L.river(x, z) > 0.001 || g < water ? Math.max(g, 3.3) : g;
    }
  }

  /**
   * Place every vehicle within `roads` (cars, trams) or `water` (boats) of (px, pz) at time t
   * into `out` (VEHICLE_STRIDE floats each). Returns how many. Allocation-free.
   */
  place(
    t: number,
    px: number,
    pz: number,
    roads: number,
    water: number,
    out: Float32Array,
  ): number {
    const R = this.lanes;
    let n = 0;
    const max = Math.min(MAX_VEHICLES, Math.floor(out.length / VEHICLE_STRIDE));
    const seed = this.L.seed;
    for (let li = 0; li < this.count; li++) {
      const o = li * LS;
      const kind = R[o + KIND];
      const shape = R[o + SHAPE];
      const range = kind === 2 ? water : roads;
      const r2 = range * range;
      const dir = R[o + DIR];
      const v = R[o + SPEED] * dir;
      const D = R[o + SPACING];
      const s0 = R[o + S0];
      const s1 = R[o + S1];
      const id = R[o + ID];
      const fill = R[o + FILL];
      const per = shape === OVAL ? 2 * (s1 - s0) + 2 * Math.PI * OVAL_R : 0;
      // Slots k whose vehicle is inside [s0, s1] now: s = k D + jitter + v t, jitter < D / 4.
      const a = shape === OVAL ? 0 : s0;
      const b = shape === OVAL ? per : s1;
      const shift = shape === OVAL ? ((t * R[o + SPEED]) % per) + per : v * t;
      // A loop holds a fixed number of vessels; a lane, whichever slots are in its window.
      const k0 = shape === OVAL ? 0 : Math.ceil((a - shift - D * 0.25) / D);
      const k1 = shape === OVAL ? Math.round(per / D) - 1 : Math.floor((b - shift + D * 0.25) / D);
      for (let k = k0; k <= k1; k++) {
        const h = hash2(k, Math.round(id * 97), seed + 741);
        if (h > fill) continue;
        const jit = (hash2(k, Math.round(id * 97), seed + 742) - 0.5) * D * 0.5;
        let s = k * D + jit + shift;
        if (shape === OVAL) s = ((s % per) + per) % per;
        else if (s < a || s > b) continue;
        let x: number;
        let y: number;
        let z: number;
        let yaw: number;
        let fade = 1;
        if (shape === OVAL) {
          // Out along the west leg (+z), round the far turn, back down the east leg, round.
          const leg = s1 - s0;
          const c = R[o + C];
          const arc = Math.PI * OVAL_R;
          if (s < leg) {
            x = c - OVAL_R;
            z = s0 + s;
            yaw = 0;
          } else if (s < leg + arc) {
            const q = (s - leg) / OVAL_R;
            x = c - OVAL_R * Math.cos(q);
            z = s1 + OVAL_R * Math.sin(q);
            yaw = q;
          } else if (s < 2 * leg + arc) {
            x = c + OVAL_R;
            z = s1 - (s - leg - arc);
            yaw = Math.PI;
          } else {
            const q = (s - 2 * leg - arc) / OVAL_R;
            x = c + OVAL_R * Math.cos(q);
            z = s0 - OVAL_R * Math.sin(q);
            yaw = Math.PI + q;
          }
          y = R[o + Y];
        } else {
          // Ease in and out at the ends of a clipped run (a T at the bayside road).
          fade = Math.min(1, (s - a) / 8, (b - s) / 8);
          if (fade <= 0.05) continue;
          const f = Math.min((s - s0) / STEP, R[o + N] - 1.001);
          const i = Math.floor(f);
          const u = f - i;
          const base = li * SAMPLES;
          const gy = this.ys[base + i] * (1 - u) + this.ys[base + i + 1] * u;
          y = Number.isNaN(R[o + Y]) ? gy : R[o + Y];
          if (shape === LINE_Z) {
            x = R[o + C] + R[o + OFF];
            z = s;
            yaw = dir > 0 ? 0 : Math.PI;
          } else if (shape === LINE_X) {
            x = s;
            z = R[o + C] + R[o + OFF];
            yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          } else {
            x = s;
            const za = this.zs[base + i];
            const zb = this.zs[base + i + 1];
            z = za * (1 - u) + zb * u;
            yaw = Math.atan2(dir, (dir * (zb - za)) / STEP);
          }
        }
        if ((x - px) ** 2 + (z - pz) ** 2 > r2) continue;
        if (n >= max) return n;
        const w = n * VEHICLE_STRIDE;
        out[w] = kind;
        out[w + 1] = x;
        out[w + 2] = y;
        out[w + 3] = z;
        out[w + 4] = yaw;
        out[w + 5] = R[o + SCALE] * fade;
        out[w + 6] = hash2(k, Math.round(id * 97), seed + 743);
        n++;
      }
    }
    return n;
  }
}
