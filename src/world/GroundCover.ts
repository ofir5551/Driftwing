import * as THREE from 'three';
import { Config } from '../core/Config';
import { withMist } from './Mist';
import { createNoise2D, hash2, type Noise2D } from './noise';
import { getToonGradient } from './Terrain';

/**
 * What a level's ground cover looks like and where it grows. Tufts take the colour of the
 * ground vertex under them, scaled by `tint`; they grow wherever the lattice is above `minY`,
 * below `maxY`, not steep (rock) and `accept` agrees.
 */
export interface CoverStyle {
  /** Multiplier on the ground colour (linear rgb): a touch lighter and warmer reads as turf. */
  tint: readonly [number, number, number];
  /** Tuft height scale (1 = ~0.4-0.7 m). */
  height: number;
  /** Lowest ground (m) that grows cover: above beaches and water. */
  minY: number;
  /** Highest ground (m) that grows cover: below the snow and bare rock. */
  maxY: number;
  /** Wildflowers in drifts: chance per tuft at the heart of a drift, and petal colours (sRGB). */
  flowers?: { chance: number; colors: readonly string[] };
  /** Extra rule (roads, fields, paved ground): false keeps the spot bare. */
  accept?: (x: number, z: number, y: number) => boolean;
  /**
   * Per-tuft look (crops, bare soil): called with the tuft's place and its default look in `t`
   * (ground-tinted colour, scale), which it may change, or set `t.bare` to skip the tuft.
   */
  paint?: (x: number, z: number, y: number, t: CoverTuft) => void;
  /**
   * A terrain vertex attribute whose first component reaches `paint` as `t.extra` (and every
   * component, up to four, as `t.extras`).
   */
  extra?: string;
}

/** One tuft's look, handed to CoverStyle.paint (a reused scratch object). */
export interface CoverTuft {
  /** Linear rgb (instance colour over the blade's own shading). */
  r: number;
  g: number;
  b: number;
  /** Size (1 = the style's height). */
  scale: number;
  /** Leave the spot bare. */
  bare: boolean;
  /** Chance of a flower here (-1: the drifts decide). */
  bloom: number;
  /** Petal colour index (-1: the drifts' hue decides). */
  petal: number;
  /** The style's `extra` attribute here, bilinear in the lattice cell (0 without one). */
  extra: number;
  /** Every component of it (up to four; the rest 0). */
  extras: [number, number, number, number];
}

const tuft: CoverTuft = {
  r: 0,
  g: 0,
  b: 0,
  scale: 1,
  bare: false,
  bloom: -1,
  petal: -1,
  extra: 0,
  extras: [0, 0, 0, 0],
};

/** A terrain chunk's vertex lattice: (res + 1)^2 chunk-local positions and ground colours. */
export interface CoverLattice {
  ox: number;
  oz: number;
  size: number;
  res: number;
  positions: ArrayLike<number>;
  colors: ArrayLike<number>;
  /** The style's `extra` attribute, if it has one, and its item size. */
  extra?: ArrayLike<number>;
  extraSize?: number;
}

/** Floats per cover item: x, y, z, scale, r, g, b, keep (0..1, tested against coverDensity). */
export const COVER_STRIDE = 8;

/**
 * Scatter one chunk's cover from its lattice (pure: unit-tested). Cells are enumerated by
 * global index, so a seam never doubles or misses tufts. Heights and colours are bilinear in
 * the lattice cell, which is the drawn surface to a few centimetres (tufts sink 6 cm into it).
 * Tufts go to `tufts`, blossoms (coloured from `petalRgb`, linear rgb triples) to `flowers`;
 * both are cleared first.
 */
export function scatterCover(
  lat: CoverLattice,
  style: CoverStyle,
  seed: number,
  drift: Noise2D,
  hue: Noise2D,
  petalRgb: ArrayLike<number>,
  tufts: number[],
  flowers: number[],
): void {
  tufts.length = 0;
  flowers.length = 0;
  const tint = style.tint;
  const chance = style.flowers?.chance ?? 0;
  const X = lat.extra;
  const xs = lat.extraSize ?? 1;
  const { ox, oz, size, res } = lat;
  const P = lat.positions;
  const C = lat.colors;
  const n = res + 1;
  const step = size / res;
  const cell = Config.cover.cell;
  const steep = Config.cover.steep * step;
  for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
    for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
      const x = (i + hash2(i, j, seed)) * cell;
      const z = (j + hash2(i, j, seed + 1)) * cell;
      const fx = Math.min(Math.max((x - ox) / step, 0), res - 1e-4);
      const fz = Math.min(Math.max((z - oz) / step, 0), res - 1e-4);
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      const ya = P[a * 3 + 1];
      const yb = P[b * 3 + 1];
      const yc = P[c * 3 + 1];
      const yd = P[d * 3 + 1];
      if (Math.max(ya, yb, yc, yd) - Math.min(ya, yb, yc, yd) > steep) continue; // rock
      const y = (ya * (1 - tx) + yb * tx) * (1 - tz) + (yc * (1 - tx) + yd * tx) * tz;
      if (y < style.minY || y > style.maxY) continue;
      if (style.accept && !style.accept(x, z, y)) continue;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;
      const a3 = a * 3;
      const b3 = b * 3;
      const c3 = c * 3;
      const d3 = d * 3;
      const t = tuft;
      t.r = (C[a3] * w00 + C[b3] * w10 + C[c3] * w01 + C[d3] * w11) * tint[0];
      t.g = (C[a3 + 1] * w00 + C[b3 + 1] * w10 + C[c3 + 1] * w01 + C[d3 + 1] * w11) * tint[1];
      t.b = (C[a3 + 2] * w00 + C[b3 + 2] * w10 + C[c3 + 2] * w01 + C[d3 + 2] * w11) * tint[2];
      t.scale = (0.7 + hash2(i, j, seed + 3) * 0.55) * style.height;
      t.bare = false;
      t.bloom = -1;
      t.petal = -1;
      for (let q = 0; q < 4; q++)
        t.extras[q] =
          X && q < xs
            ? X[a * xs + q] * w00 + X[b * xs + q] * w10 + X[c * xs + q] * w01 + X[d * xs + q] * w11
            : 0;
      t.extra = t.extras[0];
      if (style.paint) {
        style.paint(x, z, y, t);
        if (t.bare) continue;
      }
      const keep = hash2(i, j, seed + 2);
      tufts.push(x, y - 0.06, z, t.scale, t.r, t.g, t.b, keep);
      if (petalRgb.length === 0) continue;
      // Drifts: one colour family per drift, densest at its heart (or the style's own bloom).
      const heart = Math.max(0, drift(x * 0.03, z * 0.03) - 0.15) * 2.2;
      if (hash2(i, j, seed + 4) >= (t.bloom >= 0 ? t.bloom : chance * heart)) continue;
      const nc = petalRgb.length / 3;
      const pi =
        (t.petal >= 0
          ? Math.min(nc - 1, t.petal)
          : Math.min(nc - 1, Math.floor((hue(x * 0.012, z * 0.012) * 0.5 + 0.5) * nc))) * 3;
      const fs = 0.9 + hash2(i, j, seed + 5) * 0.5;
      flowers.push(x, y - 0.05, z, fs, petalRgb[pi], petalRgb[pi + 1], petalRgb[pi + 2], keep);
    }
}

/**
 * Grass tuft (~9 tris): blades fanning out from a point. Normals point straight up, so a tuft
 * is lit like the ground it stands on and melts into it at a distance; tips are lighter.
 */
export function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (k % 2) * 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 0.38 + ((k * 53) % 7) * 0.055;
    const lean = 0.14 + (k % 3) * 0.08;
    const w = 0.085;
    const bx = ca * 0.12;
    const bz = sa * 0.12;
    // A blade: two base corners side by side, the tip leaning outward.
    pos.push(
      bx - sa * w,
      0,
      bz + ca * w,
      bx + sa * w,
      0,
      bz - ca * w,
      bx + ca * lean,
      h,
      bz + sa * lean,
    );
    col.push(0.7, 0.72, 0.68, 0.7, 0.72, 0.68, 1.24, 1.24, 1.12);
  }
  return upright(pos, col);
}

/** Wildflowers (~10 tris): five small flat blossoms at grass height (instance colour = petals). */
export function flowersGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = k * 2.4;
    const r = 0.15 + (k % 3) * 0.2;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const y = 0.38 + (k % 3) * 0.1;
    const s = 0.14;
    const t = Math.PI / 4 + k;
    // A diamond of colour: at this size it reads as a blossom.
    const px = (u: number) => cx + Math.cos(t + u) * s;
    const pz = (u: number) => cz + Math.sin(t + u) * s;
    const h = Math.PI / 2;
    pos.push(px(0), y, pz(0), px(h), y, pz(h), px(2 * h), y, pz(2 * h));
    pos.push(px(0), y, pz(0), px(2 * h), y, pz(2 * h), px(3 * h), y, pz(3 * h));
    for (let v = 0; v < 6; v++) col.push(1, 1, 1);
  }
  return upright(pos, col);
}

function upright(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

/**
 * The cover's material: toon, double-sided blades, swaying in the vertex shader. Each tuft's
 * push grows with the square of its height up the blade; a gust front rolls along the wind
 * across the land (phase from world position), with a slower swell in its strength, so a meadow
 * ripples in waves instead of every tuft nodding on its own. Instances carry no rotation, so
 * the push stays in world space.
 */
function coverMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonGradient(),
    side: THREE.DoubleSide,
  });
  const time = { value: 0 };
  m.userData.time = time;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCoverTime = time;
    shader.uniforms.uCoverSway = {
      get value() {
        return Config.cover.sway;
      },
    };
    shader.uniforms.uCoverGust = {
      get value() {
        return Config.cover.gustSpeed;
      },
    };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uCoverTime;\nuniform float uCoverSway;\nuniform float uCoverGust;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 iPos = instanceMatrix[3].xyz;
  float along = dot(iPos.xz, vec2(0.8, 0.6));
  float t = uCoverTime;
  float swell = 0.55 + 0.45 * sin(along * 0.035 - t * uCoverGust);
  float wave = sin(along * 0.22 - t * 2.9 * uCoverGust) * 0.6 + 0.4 + sin(t * 3.7 + iPos.x * 0.37) * 0.15;
  transformed.xz += vec2(0.8, 0.6) * wave * swell * transformed.y * transformed.y * uCoverSway;
}
#endif`,
      );
    // Double-sided blades would flip the normal on their back faces and go dark (lit from
    // below); every blade face keeps the up normal, lit like the ground it grows from.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\nnormal = normalize(vNormal);',
    );
  };
  m.customProgramCacheKey = () => 'ground-cover';
  return withMist(m);
}

/** Reads a terrain chunk's near-LOD geometry (ChunkManager), or null until it is built. */
export type LatticeSource = (cx: number, cz: number) => THREE.BufferGeometry | null;

interface CoverChunk {
  tufts: Float32Array;
  flowers: Float32Array;
}

const key = (cx: number, cz: number) => (cx + 0x80000) * 0x100000 + (cz + 0x80000);
const lattice: CoverLattice = { ox: 0, oz: 0, size: 0, res: 0, positions: [], colors: [] };
const col = new THREE.Color();

/**
 * Ground cover round the bird: grass tufts (and wildflowers, if the style has them) on the
 * terrain chunks' own lattices. Each chunk's cover is scattered once, the first time it comes
 * within range (one chunk per frame), and cached; the ring is refilled by matrix writes alone
 * whenever the bird has moved `cover.refresh` metres. Range and density come from the preset
 * (render.coverDistance, render.coverDensity); low has none. A level opts in by handing its
 * ChunkManager a CoverStyle.
 */
export class GroundCover {
  readonly group = new THREE.Group();
  private readonly tufts: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly material = coverMaterial();
  private readonly cache = new Map<number, CoverChunk>();
  private readonly drift: Noise2D;
  private readonly hue: Noise2D;
  private readonly petalRgb: number[] = [];
  private readonly scratchT: number[] = [];
  private readonly scratchF: number[] = [];
  private readonly seed: number;
  private lastX = NaN;
  private lastZ = NaN;
  private lastR = -1;
  private lastD = -1;
  private nt = 0;
  private nf = 0;
  /** Chunk bounds whose cover is kept (x = min cx, y = min cz, z = max cx, w = max cz). */
  private readonly keep = new THREE.Vector4();
  private readonly evict = (_c: CoverChunk, k: number): void => {
    const cx = Math.floor(k / 0x100000) - 0x80000;
    const cz = (k % 0x100000) - 0x80000;
    const b = this.keep;
    if (cx < b.x || cx > b.z || cz < b.y || cz > b.w) this.cache.delete(k);
  };

  constructor(
    private readonly style: CoverStyle,
    private readonly source: LatticeSource,
  ) {
    this.seed = Config.world.seed + 700;
    this.drift = createNoise2D(Config.world.seed + 41);
    this.hue = createNoise2D(Config.world.seed + 42);
    for (const hex of style.flowers?.colors ?? []) {
      col.set(hex);
      this.petalRgb.push(col.r, col.g, col.b);
    }
    this.tufts = this.make(tuftGeometry(), 36000, 'cover-grass');
    this.flowers = this.make(flowersGeometry(), style.flowers ? 8000 : 1, 'cover-flowers');
    const time = this.material.userData.time as { value: number };
    this.tufts.onBeforeRender = () => (time.value = performance.now() / 1000);
  }

  private make(g: THREE.BufferGeometry, cap: number, name: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(g, this.material, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    mesh.setColorAt(0, col.set('#fff'));
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Refill the ring if the bird moved or the preset changed; scatter at most `budget` new
   * chunks this call (Infinity behind the title screen).
   */
  update(px: number, pz: number, budget = 1): void {
    const R = Config.render.coverDistance;
    const D = Config.render.coverDensity;
    if (R <= 0 || D <= 0) {
      this.tufts.count = this.flowers.count = 0;
      this.lastR = R;
      this.lastD = D;
      return;
    }
    const moved = Math.hypot(px - this.lastX, pz - this.lastZ);
    if (!(moved > Config.cover.refresh) && R === this.lastR && D === this.lastD) return;
    const size = Config.world.chunkSize;
    const c0x = Math.floor((px - R) / size);
    const c1x = Math.floor((px + R) / size);
    const c0z = Math.floor((pz - R) / size);
    const c1z = Math.floor((pz + R) / size);
    let missing = false;
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        if (this.cache.has(key(cx, cz))) continue;
        const g = budget > 0 ? this.source(cx, cz) : null;
        if (!g) {
          missing = true;
          continue;
        }
        this.scatterChunk(cx, cz, size, g);
        budget--;
      }
    // Forget chunks well outside the ring (forEach with a bound callback: no iterator garbage).
    this.keep.set(c0x - 1, c0z - 1, c1x + 1, c1z + 1);
    this.cache.forEach(this.evict);
    this.nt = 0;
    this.nf = 0;
    for (let cz = c0z; cz <= c1z; cz++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = this.cache.get(key(cx, cz));
        if (c) this.fill(c, px, pz, R, D);
      }
    this.finish(this.tufts, this.nt);
    this.finish(this.flowers, this.nf);
    // Keep trying every frame until every chunk in the ring has its cover.
    this.lastX = missing ? NaN : px;
    this.lastZ = pz;
    this.lastR = R;
    this.lastD = D;
  }

  private scatterChunk(cx: number, cz: number, size: number, g: THREE.BufferGeometry): void {
    const res = Math.round(Math.sqrt(g.getAttribute('position').count)) - 1;
    lattice.ox = cx * size;
    lattice.oz = cz * size;
    lattice.size = size;
    lattice.res = res;
    lattice.positions = g.getAttribute('position').array;
    lattice.colors = g.getAttribute('color').array;
    const ex = this.style.extra ? g.getAttribute(this.style.extra) : undefined;
    lattice.extra = ex?.array;
    lattice.extraSize = ex?.itemSize ?? 1;
    scatterCover(
      lattice,
      this.style,
      this.seed,
      this.drift,
      this.hue,
      this.petalRgb,
      this.scratchT,
      this.scratchF,
    );
    this.cache.set(key(cx, cz), {
      tufts: new Float32Array(this.scratchT),
      flowers: new Float32Array(this.scratchF),
    });
  }

  /** Copy one chunk's items within the ring into the instance buffers (no allocation). */
  private fill(c: CoverChunk, px: number, pz: number, R: number, D: number): void {
    const R2 = R * R;
    const rim = R2 * Config.cover.rimFade;
    const t = c.tufts;
    const tm = this.tufts.instanceMatrix.array as Float32Array;
    const tc = this.tufts.instanceColor!.array as Float32Array;
    const capT = this.tufts.instanceMatrix.count;
    for (let k = 0; k < t.length && this.nt < capT; k += COVER_STRIDE) {
      if (t[k + 7] > D) continue;
      const d2 = (t[k] - px) ** 2 + (t[k + 2] - pz) ** 2;
      if (d2 > R2) continue;
      // Tufts shrink toward the rim so the ring has no hard edge.
      const fade = Math.min(1, (R2 - d2) / rim);
      write(tm, tc, this.nt++, t, k, t[k + 3] * (0.35 + 0.65 * fade));
    }
    const f = c.flowers;
    const fm = this.flowers.instanceMatrix.array as Float32Array;
    const fcol = this.flowers.instanceColor!.array as Float32Array;
    const capF = this.flowers.instanceMatrix.count;
    for (let k = 0; k < f.length && this.nf < capF; k += COVER_STRIDE) {
      if (f[k + 7] > D) continue;
      if ((f[k] - px) ** 2 + (f[k + 2] - pz) ** 2 > R2 - rim) continue;
      write(fm, fcol, this.nf++, f, k, f[k + 3]);
    }
  }

  private finish(mesh: THREE.InstancedMesh, n: number): void {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    this.tufts.geometry.dispose();
    this.flowers.geometry.dispose();
    this.tufts.dispose();
    this.flowers.dispose();
    this.material.dispose();
  }
}

/** Instance i: scale and translation only (no rotation keeps the gust in world space). */
function write(M: Float32Array, C: Float32Array, i: number, a: Float32Array, k: number, s: number) {
  const o = i * 16;
  M[o] = s;
  M[o + 1] = 0;
  M[o + 2] = 0;
  M[o + 3] = 0;
  M[o + 4] = 0;
  M[o + 5] = s * (0.8 + a[k + 7] * 0.5);
  M[o + 6] = 0;
  M[o + 7] = 0;
  M[o + 8] = 0;
  M[o + 9] = 0;
  M[o + 10] = s;
  M[o + 11] = 0;
  M[o + 12] = a[k];
  M[o + 13] = a[k + 1];
  M[o + 14] = a[k + 2];
  M[o + 15] = 1;
  C[i * 3] = a[k + 4];
  C[i * 3 + 1] = a[k + 5];
  C[i * 3 + 2] = a[k + 6];
}
