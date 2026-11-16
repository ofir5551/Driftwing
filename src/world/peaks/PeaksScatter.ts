import { Config } from '../../core/Config';
import { mulberry32 } from '../noise';
import { Temple, type PeaksLayout, type Spire } from './PeaksLayout';
import { profile, SHAPES } from './profile';
import { LEDGE_EPS, SKINS } from './skin';

/**
 * What grows and stands on Sea of Clouds' rock, per spire (pure, no Three.js, unit-tested):
 * granite pines on the summits and reaching out of the cliffs, the ledge cover (moss cushions,
 * alpine grass, dwarf pines, boulders, old snow above the snowline, now and then a stone
 * shrine), a hermit's hut in the alcove under an overhang, little pavilions on bare summits,
 * the temples and the monastery stair, and where their lanterns and lit windows hang. Every
 * position is read from the spire's skin (skin.ts), so things sit on the drawn stone.
 */

/** Trees in the Trees stride (type, x, y, z, scale, rotY, tint): the granite pine, type 0. */
export const PINE = 0;

/** Prop kinds. */
export const K = {
  Moss: 0,
  Grass: 1,
  Snow: 2,
  Boulder: 3,
  Hut: 4,
  Pavilion: 5,
  Shrine: 6,
  Step: 7,
  Post: 8,
  Dwarf: 9,
} as const;
export const PROP_KINDS = 10;
/** Floats per prop record: kind, x, y, z, yaw, scale, tint. */
export const PROP_STRIDE = 7;

/** One spire's dressing, or a chunk's. */
export interface Dressing {
  trees: number[];
  props: number[];
  /** x, y, z, yaw, kind (Temple) */
  temples: number[];
  /** x, y, z, scale */
  lanterns: number[];
  /** x, y, z, yaw: lit windows */
  windows: number[];
}

/** A point given in a thing's local metres (front +z), placed at (x, y, z) turned by yaw. */
export interface Local {
  x: number;
  y: number;
  z: number;
}

/** World position of local point l of a thing at (x, y, z) turned by yaw (three's Y rotation). */
export function placeLocal(
  x: number,
  y: number,
  z: number,
  yaw: number,
  l: Local,
  s = 1,
): [number, number, number] {
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  return [x + (l.x * c + l.z * n) * s, y + l.y * s, z + (-l.x * n + l.z * c) * s];
}

/** Windows of the gate's monastery and a hermitage, in their local metres. */
export const MONASTERY_WINDOWS: Local[] = [
  { x: -6, y: 3.6, z: 2.05 },
  { x: 2, y: 3.6, z: 2.05 },
  { x: 6, y: 3.2, z: -4.36 },
  { x: 6, y: 7.4, z: -4.91 },
  { x: 9.4, y: 3.3, z: 5.05 },
  { x: 6.6, y: 3.3, z: 5.05 },
];
export const HERMITAGE_WINDOWS: Local[] = [{ x: 1.8, y: 2.7, z: 2.23 }];

export class PeaksScatter {
  constructor(private readonly L: PeaksLayout) {}

  /** Where a thing at local angle a sits on the spire's skin at fraction t, `out` metres out. */
  private onRock(sp: Spire, t: number, a: number, rad: number, out: number[]): void {
    const w = a - sp.yaw; // the mesh's local angle a points along world angle a - yaw
    out[0] = sp.x + sp.lx * t * t + Math.cos(w) * rad;
    out[1] = sp.y0 + (t + SKINS[sp.shape].lift(t, a)) * sp.h;
    out[2] = sp.z + sp.lz * t * t + Math.sin(w) * rad;
  }

  /** Height fraction of the summit dome at distance d from its axis (d inside the dome). */
  private domeT(sp: Spire, d: number): number {
    const sh = SHAPES[sp.shape];
    let lo = sh.cap;
    let hi = 1;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (sp.r * profile(sh, mid) > d) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Does this bare summit carry a pavilion? (A hash, so the pines and the cover agree.) */
  pavilion(sp: Spire): boolean {
    return (
      sp.temple === Temple.None &&
      sp.r * 0.3 >= 3.2 &&
      (sp.seed * 7919.13) % 1 < Config.peaks.pavilions
    );
  }

  /**
   * What a spire shows from afar, appended to `out`: its pines on the summit and the cliffs,
   * and its temple with the temple's lanterns and windows. Cheap: scattered with the chunk.
   */
  dress(sp: Spire, out: Dressing): void {
    const P = Config.peaks;
    const sh = SHAPES[sp.shape];
    const skin = SKINS[sp.shape];
    const rand = mulberry32(Math.floor(sp.seed * 1e9) + 7);
    const pos = [0, 0, 0];
    const tree = (t: number, a: number, rad: number, s: number, rot: number) => {
      this.onRock(sp, t, a, rad, pos);
      out.trees.push(PINE, pos[0], pos[1] - 0.4, pos[2], s, rot, rand());
    };
    // A cliff pine's drawn lean (local +x) points out from the rock: rotY = -(world angle).
    const outward = (a: number) => -(a - sp.yaw) + (rand() - 0.5) * 0.6;

    // Summit pines; a temple or pavilion keeps the middle for itself.
    const span = sp.temple === Temple.None ? 0.9 : 0.35;
    const inner = this.pavilion(sp) ? 0.45 : 0.1;
    const crown = 5 + Math.floor(sp.r / 4);
    for (let k = 0; k < crown; k++) {
      const t = sh.cap + (1 - sh.cap) * span * rand();
      const a = rand() * Math.PI * 2;
      const inset = sp.temple === Temple.None ? inner + (0.95 - inner) * rand() : 0.9;
      const edge = t < sh.cap + 0.04;
      tree(
        t,
        a,
        sp.r * skin.radius(t, a) * inset,
        1.2 + rand() * 0.8,
        edge ? outward(a) : rand() * 6.3,
      );
    }

    // Cliff pines clinging to the walls above the cloud sea, reaching out over the drop.
    const cloudT = (P.cloud + 15 - sp.y0) / sp.h;
    const cliffs = Math.floor(sp.h / 26);
    for (let k = 0; k < cliffs; k++) {
      const t = cloudT + (sh.cap - 0.05 - cloudT) * rand();
      const a = rand() * Math.PI * 2;
      if (t > cloudT) tree(t, a, sp.r * skin.radius(t, a) * 0.97, 0.9 + rand() * 0.5, outward(a));
    }

    // A temple on the summit, with its lanterns and windows.
    if (sp.temple !== Temple.None) {
      const t = 0.985;
      const x = sp.x + sp.lx * t * t;
      const y = sp.y0 + sp.h * t - 0.6;
      const z = sp.z + sp.lz * t * t;
      out.temples.push(x, y, z, sp.yaw, sp.temple);
      const mon = sp.temple === Temple.Monastery;
      for (const l of mon ? MONASTERY_LANTERNS : HERMITAGE_LANTERNS)
        out.lanterns.push(...placeLocal(x, y, z, sp.yaw, l), 1.1);
      for (const l of mon ? MONASTERY_WINDOWS : HERMITAGE_WINDOWS)
        out.windows.push(...placeLocal(x, y, z, sp.yaw, l), sp.yaw);
    }
  }

  /**
   * What a spire shows up close, appended to `out` (props, and their lanterns and windows):
   * turf, snow and boulders on the summit and every ledge wide enough, dwarf pines and shrines,
   * a pavilion, the hermit's hut in the alcove, the monastery's stair. Scattered lazily, the
   * first time the spire's chunk comes within prop distance.
   */
  cover(sp: Spire, out: Dressing): void {
    const P = Config.peaks;
    const sh = SHAPES[sp.shape];
    const skin = SKINS[sp.shape];
    const rand = mulberry32(Math.floor(sp.seed * 1e9) + 11);
    const pos = [0, 0, 0];
    const prop = (kind: number, x: number, y: number, z: number, yaw: number, s: number) =>
      out.props.push(kind, x, y, z, yaw, s, rand());
    const outward = (a: number) => -(a - sp.yaw) + (rand() - 0.5) * 0.6;

    // Summit: turf, grass, boulders and snow round the pines.
    const capR = sp.r * profile(sh, sh.cap);
    const clear = sp.temple === Temple.Monastery ? 16.5 : sp.temple === Temple.Hermitage ? 6.5 : 0;
    const pavilion = this.pavilion(sp);
    const cover = 10 + Math.floor(sp.r / 1.2);
    for (let k = 0; k < cover; k++) {
      const d = Math.sqrt(rand()) * capR * 0.92;
      if (d < clear || (pavilion && d < 3.6)) continue;
      const a = rand() * Math.PI * 2;
      const t = this.domeT(sp, d);
      const w = a - sp.yaw;
      const x = sp.x + sp.lx * t * t + Math.cos(w) * d;
      const y = sp.y0 + t * sp.h;
      const z = sp.z + sp.lz * t * t + Math.sin(w) * d;
      this.piece(x, y, z, rand(), 1 + rand() * 0.9, prop, rand, true);
    }
    if (pavilion) {
      const t = this.domeT(sp, 0.5);
      const x = sp.x + sp.lx * t * t;
      const y = sp.y0 + t * sp.h - 0.2;
      const z = sp.z + sp.lz * t * t;
      const yaw = rand() * Math.PI * 2;
      prop(K.Pavilion, x, y, z, yaw, 1);
      for (const l of PAVILION_LANTERNS) out.lanterns.push(...placeLocal(x, y, z, yaw, l), 0.9);
    }

    // The ledges: where the rock above a joint stands back far enough to hold something.
    const A = skin.alcove;
    for (let j = 0; j < skin.joints.length; j++) {
      const J = skin.joints[j];
      const pr = sp.r * profile(sh, J.t);
      const n = Math.max(12, Math.floor((Math.PI * 2 * pr) / 1.7));
      for (let k = 0; k < n; k++) {
        const a = ((k + rand() * 0.8) / n) * Math.PI * 2;
        const lip = skin.skin(J.t - LEDGE_EPS, a);
        const back = skin.skin(J.t + LEDGE_EPS, a);
        const width = pr * (lip - back);
        if (width < 1.1 || rand() > P.ledgeCover) continue;
        // Not where the hut stands.
        if (j === A.joint && Math.abs(angleDiff(a, A.a)) < A.arc * 0.6) continue;
        // Toward the lip, where a ledge's turf hangs over the drop.
        const rad = pr * (back + (lip - back) * (0.45 + 0.4 * rand()));
        this.onRock(sp, J.t, a, rad, pos);
        const s = Math.min(1.8, width * 0.6) * (0.8 + rand() * 0.5);
        const roll = rand();
        // A dwarf pine leans out over the drop (its drawn lean is local +x).
        if (roll < 0.2) prop(K.Dwarf, pos[0], pos[1] - 0.3, pos[2], outward(a), 0.9 + rand() * 0.7);
        else if (roll < 0.215 && width > 2.2 && pos[1] < P.snowline) {
          prop(K.Shrine, pos[0], pos[1], pos[2], -(a - sp.yaw) + Math.PI / 2, 1);
        } else this.piece(pos[0], pos[1], pos[2], rand(), s, prop, rand, false);
      }
    }

    // A hermit's hut in the alcove, out of the wind under its overhang.
    if (A.joint >= 0 && sp.h > 110 && (sp.temple === Temple.Hermitage || rand() < P.huts)) {
      const J = skin.joints[A.joint];
      const pr = sp.r * profile(sh, J.t);
      const back = skin.skin(J.t + LEDGE_EPS, A.a);
      const lip = skin.skin(J.t - LEDGE_EPS, A.a);
      const depth = pr * (lip - back);
      // The hut is 3 m deep at scale 1 (and its floor reaches out 0.7 m further).
      const s = Math.min(1.1, depth / 3.3);
      if (s > 0.7) {
        this.onRock(sp, J.t, A.a, pr * back + 1.45 * s, pos);
        const yaw = Math.PI / 2 - (A.a - sp.yaw); // front (+z) faces out from the rock
        prop(K.Hut, pos[0], pos[1] + 0.12, pos[2], yaw, s);
        for (const l of HUT_LANTERNS)
          out.lanterns.push(...placeLocal(pos[0], pos[1], pos[2], yaw, l, s), 0.8);
        for (const l of HUT_WINDOWS)
          out.windows.push(...placeLocal(pos[0], pos[1], pos[2], yaw, l, s), yaw);
      }
    }
    if (sp.temple === Temple.Monastery) this.stair(out);
  }

  /** One piece of ledge or summit cover, chosen by `roll`. */
  private piece(
    x: number,
    y: number,
    z: number,
    roll: number,
    s: number,
    prop: (kind: number, x: number, y: number, z: number, yaw: number, s: number) => void,
    rand: () => number,
    summit: boolean,
  ): void {
    const P = Config.peaks;
    const yaw = rand() * Math.PI * 2;
    const high = y + (rand() - 0.5) * P.snowRag * 2 > P.snowline;
    if (high && roll < 0.45) prop(K.Snow, x, y - 0.05, z, yaw, s * 1.1);
    else if (roll < 0.62) prop(K.Moss, x, y - 0.1, z, yaw, s);
    else if (roll < 0.9) prop(K.Grass, x, y - 0.05, z, yaw, s * (summit ? 1.1 : 0.9));
    else prop(K.Boulder, x, y - 0.15, z, yaw, s * 0.7);
  }

  /** The monastery stair's steps, its lamp posts every few metres of climb and their lanterns. */
  private stair(out: Dressing): void {
    const S = this.L.sites.stair;
    for (let k = 0, n = 0; k < S.length; k += 4, n++) {
      out.props.push(K.Step, S[k], S[k + 1], S[k + 2], S[k + 3], 1, (n * 0.37) % 1);
      if (n % 16 === 8) {
        // A post on the outer edge, its lamp facing the drop.
        const yaw = S[k + 3];
        const [x, y, z] = placeLocal(S[k], S[k + 1], S[k + 2], yaw, { x: 0, y: 0, z: 0 });
        const ox = Math.cos(yaw);
        const oz = -Math.sin(yaw);
        // Outward is the step's local +x or -x: the side away from the spire's axis.
        const m = this.L.gate.find((g) => g.temple === Temple.Monastery) ?? this.L.gate[0];
        const sx = (x - m.x) * ox + (z - m.z) * oz > 0 ? 1 : -1;
        const px = x + ox * 0.85 * sx;
        const pz = z + oz * 0.85 * sx;
        out.props.push(K.Post, px, y + 0.27, pz, yaw, 1, 0.5);
        out.lanterns.push(px, y + 0.27 + 1.95, pz, 0.7);
      }
    }
  }
}

/** Signed smallest difference a - b, in (-pi, pi]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Where lanterns hang on the temples and props, in their local metres. */
export const HERMITAGE_LANTERNS: Local[] = [{ x: 2.3, y: 3.6, z: 2.6 }];
export const MONASTERY_LANTERNS: Local[] = [
  { x: -5, y: 5.6, z: 2.6 },
  { x: 1, y: 5.6, z: 2.6 },
  { x: 6, y: 13.4, z: -4.2 },
  { x: 8, y: 4.6, z: 5.3 },
  { x: -12, y: 3.4, z: 8 },
  { x: 12, y: 3.4, z: -8 },
  { x: -4.2, y: 4.2, z: 13.8 },
  { x: 0.2, y: 4.2, z: 13.8 },
  { x: -10.3, y: 4.3, z: 7.5 },
  { x: -7.7, y: 4.3, z: 7.5 },
  { x: -7.9, y: 4.0, z: -1.2 },
];
export const HUT_WINDOWS: Local[] = [{ x: 0.85, y: 1.5, z: 1.1 }];
export const HUT_LANTERNS: Local[] = [{ x: -1.25, y: 2.35, z: 1.9 }];
export const PAVILION_LANTERNS: Local[] = [
  { x: 1.9, y: 2.6, z: 1.1 },
  { x: -1.9, y: 2.6, z: -1.1 },
];
