import * as THREE from 'three';
import { Config } from '../core/Config';
import { clamp, lerp, smoothstep } from '../core/math';
import { createNoise2D, fbm } from './noise';

/**
 * The landscape is a single pure height function shared by the terrain mesh, flight collisions,
 * tree scatter and wisp placement, so everything agrees on where the ground is.
 */
export interface HeightField {
  height(x: number, z: number): number;
  /** 0..1 forest density at x,z (used for tree scatter and ground tint). */
  forest(x: number, z: number): number;
  /** -1..1 low-frequency moisture/variation used for colour. */
  tint(x: number, z: number): number;
}

export function createHeightField(seed: number): HeightField {
  const nC = createNoise2D(seed);
  const nH = createNoise2D(seed + 1);
  const nR = createNoise2D(seed + 2);
  const nV = createNoise2D(seed + 3);
  const nF = createNoise2D(seed + 4);
  const nT = createNoise2D(seed + 5);

  const height = (x: number, z: number): number => {
    const c = fbm(nC, x * 0.0009, z * 0.0009, 3); // broad lowlands vs highlands
    const h = fbm(nH, x * 0.0034, z * 0.0034, 4); // rolling hills
    const r = 1 - Math.abs(nR(x * 0.0016, z * 0.0016)); // ridged mountains
    const mountain = smoothstep(0.05, 0.55, c);
    let y = 22 + c * 40 + h * 20 + r * r * r * mountain * 100;
    // Meandering valleys: where a low-frequency noise crosses zero, carve a soft trough.
    // These become the natural flight corridors (and lakes where they dip below water).
    const v = Math.abs(fbm(nV, x * 0.0011, z * 0.0011, 2));
    const trough = 1 - smoothstep(0, 0.28, v);
    y -= trough * trough * (3 - 2 * trough) * (30 + mountain * 18);
    // Keep a gentle meadow basin at the spawn so the first seconds feel open and calm.
    const d = Math.sqrt(x * x + z * z);
    const spawn = 1 - smoothstep(150, 500, d);
    return lerp(y, Math.min(y, 14 + h * 8), spawn);
  };

  const forest = (x: number, z: number): number =>
    smoothstep(0.05, 0.45, fbm(nF, x * 0.004, z * 0.004, 3));

  const tint = (x: number, z: number): number => nT(x * 0.002, z * 0.002);

  return { height, forest, tint };
}

// Terrain palette (linear-ish sRGB values; the toon material and fog tint them per time of day).
const C = {
  lakebed: new THREE.Color('#6f9c9a'),
  sand: new THREE.Color('#ead7a6'),
  grass: new THREE.Color('#a6d07c'),
  meadow: new THREE.Color('#dbdc8c'),
  forest: new THREE.Color('#6fa36e'),
  rock: new THREE.Color('#a497a9'),
  high: new THREE.Color('#efe6f2'),
};
const tmp = new THREE.Color();

/** Ground colour from height, slope (0 flat..1 cliff) and noise. Soft height banding adds a painted strata feel. */
export function groundColor(
  field: HeightField,
  x: number,
  z: number,
  y: number,
  slope: number,
  out: THREE.Color,
): THREE.Color {
  const t = field.tint(x, z);
  if (y < Config.world.waterLevel - 0.5) {
    out.copy(C.lakebed).lerp(C.sand, smoothstep(-6, -0.5, y));
  } else {
    tmp.copy(C.grass).lerp(C.meadow, clamp(t * 0.8 + 0.35, 0, 1));
    tmp.lerp(C.forest, field.forest(x, z) * 0.75);
    out.copy(C.sand).lerp(tmp, smoothstep(0.5, 4, y));
    out.lerp(C.rock, smoothstep(0.4, 0.75, slope + smoothstep(50, 90, y) * 0.15));
    out.lerp(C.high, smoothstep(105, 140, y + t * 12));
  }
  // Soft banding: a gentle brightness wave every 22 m that reads like brush strokes on the hills.
  const band = Math.sin((y / 22) * Math.PI * 2 + t * 3) * 0.5 + 0.5;
  const shade = 0.93 + smoothstep(0.3, 0.7, band) * 0.07;
  out.multiplyScalar(shade);
  return out;
}

/**
 * Allocates a pooled chunk geometry with an index buffer shared across all chunks of the same
 * resolution. Positions are chunk-local (the mesh is positioned at the chunk origin).
 */
const indexCache = new Map<number, THREE.BufferAttribute>();
export function createChunkGeometry(res: number): THREE.BufferGeometry {
  const n = res + 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  let index = indexCache.get(res);
  if (!index) {
    const idx = new Uint32Array(res * res * 6);
    let k = 0;
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // Alternate the diagonal for a less grid-like, more organic low-poly surface.
        if ((i + j) % 2 === 0) idx.set([a, c, b, b, c, d], k);
        else idx.set([a, c, d, a, d, b], k);
        k += 6;
      }
    index = new THREE.BufferAttribute(idx, 1);
    indexCache.set(res, index);
  }
  g.setIndex(index);
  return g;
}

let heightScratch = new Float32Array(0);
const col = new THREE.Color();

/** Fill a pooled chunk geometry for chunk origin (ox, oz). Normals use a 1-sample border so seams match. */
export function fillChunkGeometry(
  g: THREE.BufferGeometry,
  field: HeightField,
  ox: number,
  oz: number,
  size: number,
  res: number,
): void {
  const n = res + 1;
  const b = n + 2; // with border
  if (heightScratch.length < b * b) heightScratch = new Float32Array(b * b);
  const step = size / res;
  for (let j = 0; j < b; j++)
    for (let i = 0; i < b; i++)
      heightScratch[j * b + i] = field.height(ox + (i - 1) * step, oz + (j - 1) * step);

  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const colr = g.getAttribute('color') as THREE.BufferAttribute;
  const P = pos.array as Float32Array;
  const N = nor.array as Float32Array;
  const Cc = colr.array as Float32Array;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      const h = heightScratch[(j + 1) * b + i + 1];
      P[k] = i * step;
      P[k + 1] = h;
      P[k + 2] = j * step;
      const hl = heightScratch[(j + 1) * b + i];
      const hr = heightScratch[(j + 1) * b + i + 2];
      const hd = heightScratch[j * b + i + 1];
      const hu = heightScratch[(j + 2) * b + i + 1];
      let nx = hl - hr;
      let ny = 2 * step;
      let nz = hd - hu;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      N[k] = nx;
      N[k + 1] = ny;
      N[k + 2] = nz;
      groundColor(field, ox + i * step, oz + j * step, h, 1 - ny, col);
      Cc[k] = col.r;
      Cc[k + 1] = col.g;
      Cc[k + 2] = col.b;
    }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  colr.needsUpdate = true;
  g.computeBoundingSphere();
  g.computeBoundingBox();
}

/** Soft multi-step gradient for MeshToonMaterial: banded light with blurred edges (painterly, not cel). */
let toonGradient: THREE.DataTexture | null = null;
export function getToonGradient(): THREE.DataTexture {
  if (toonGradient) return toonGradient;
  const w = 64;
  const data = new Uint8Array(w * 4);
  const steps = [0.42, 0.62, 0.82, 1.0];
  for (let i = 0; i < w; i++) {
    const x = i / (w - 1);
    // Each band boundary is a smoothstep a few texels wide instead of a hard edge.
    let v = steps[0];
    for (let s = 1; s < steps.length; s++)
      v = lerp(v, steps[s], smoothstep(s / steps.length - 0.06, s / steps.length + 0.06, x));
    const b = Math.round(v * 255);
    data.set([b, b, b, 255], i * 4);
  }
  toonGradient = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
  toonGradient.minFilter = THREE.LinearFilter;
  toonGradient.magFilter = THREE.LinearFilter;
  toonGradient.needsUpdate = true;
  return toonGradient;
}
