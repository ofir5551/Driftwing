import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';
import { getToonGradient, type HeightField } from './Terrain';
import { hash2 } from './noise';

/** Floats stored per tree in a chunk's scatter list: type, x, y, z, scale, rotY, tint. */
export const TREE_STRIDE = 7;

/** Non-indexed copy lifted by y, painted one flat colour, with crisp per-face normals. */
export function colored(g: THREE.BufferGeometry, hex: string, y = 0): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  return painted(g, (_x, _y, _z, out) => out.copy(c), y);
}

/** As `colored`, with the colour a function of the (unlifted) vertex position. */
export function painted(
  g: THREE.BufferGeometry,
  colorAt: (x: number, y: number, z: number, out: THREE.Color) => void,
  y = 0,
): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    colorAt(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    col.set([c.r, c.g, c.b], i * 3);
  }
  ng.translate(0, y, 0);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute('uv');
  ng.computeVertexNormals(); // non-indexed -> per-face normals: crisp low-poly facets
  return ng;
}

/**
 * Nudges every vertex by a hash of where it sits, so coincident corners (a polyhedron's faces
 * share none) move together and the surface stays closed: lumpy, not cracked.
 */
export function jitter(
  g: THREE.BufferGeometry,
  amount: number,
  seed: number,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const qx = Math.round(x * 1000);
    const qy = Math.round(y * 1000);
    const qz = Math.round(z * 1000);
    pos.setXYZ(
      i,
      x + (hash2(qx ^ qy, qz, seed) - 0.5) * amount,
      y + (hash2(qy ^ qz, qx, seed + 1) - 0.5) * amount,
      z + (hash2(qz ^ qx, qy, seed + 2) - 0.5) * amount,
    );
  }
  return g;
}

/**
 * Light from above, painted in: vertex colours darken toward the bottom of the whole shape (the
 * shaded underside of a crown, the foot of the trunk) and lift at the top, so a tree reads as a
 * rounded mass in the sun even where the toon bands are flat. Returns the same geometry.
 */
export function topLit(g: THREE.BufferGeometry, dark = 0.62, light = 1.12): THREE.BufferGeometry {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / (max.y - min.y || 1);
    const f = dark + (light - dark) * Math.pow(t, 0.7);
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  return g;
}

/** Ball of foliage: a lumpy icosahedron whose facets go lighter toward its sunlit top. */
export function lobe(
  r: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  seed: number,
  squash = 0.82,
) {
  const c = new THREE.Color(hex);
  const cool = new THREE.Color(hex).offsetHSL(0.03, 0.02, -0.08);
  const g = jitter(new THREE.IcosahedronGeometry(r, 0), r * 0.32, seed);
  g.scale(1, squash, 1);
  return painted(
    g,
    (_x, py, _z, out) => out.copy(cool).lerp(c, smoothstep(-r, r * 0.6, py)),
    y,
  ).translate(x, 0, z);
}

/** Tapered limb from (0, y0, 0) out to (x, y1, z): makes the crown sit on a real branch. */
export function limb(x: number, y0: number, y1: number, z: number, r: number, hex: string) {
  const dir = new THREE.Vector3(x, y1 - y0, z);
  const g = new THREE.CylinderGeometry(r * 0.5, r, dir.length(), 4).translate(
    0,
    dir.length() / 2,
    0,
  );
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
  );
  return colored(g, hex, y0);
}

/** Low-poly tree shapes built from primitives, merged so each type is one instanced draw. */
export function pineGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 5), '#8a6a5a', 1.2),
      colored(new THREE.ConeGeometry(2.7, 4.6, 6), '#4f8f72', 4.3),
      colored(new THREE.ConeGeometry(2.1, 3.8, 6), '#5a9b78', 6.6),
      colored(new THREE.ConeGeometry(1.4, 3.2, 6), '#67a77e', 8.6),
    ])!,
    0.72,
    1.1,
  );
}

/**
 * Near pine (~110 triangles): five ragged tiers whose skirts droop and fray, each tier darker
 * underneath and catching light at its shoulders, on a trunk that shows below the lowest skirt.
 */
export function pineDetailGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.CylinderGeometry(0.24, 0.42, 3.4, 6), '#7c5f51', 1.7)];
  const tiers = 5;
  const hues = ['#4a876b', '#4f8f72', '#569675', '#5e9e7a', '#68a87f'];
  for (let i = 0; i < tiers; i++) {
    const u = i / (tiers - 1);
    const r = 2.9 - u * 2.0;
    const h = 3.1 - u * 0.9;
    const g = new THREE.ConeGeometry(r, h, 8, 1);
    // Skirt: the rim droops and frays, alternate points longer, so the tier isn't a clean cone.
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) > -h / 2 + 0.01) continue;
      const a = Math.atan2(pos.getZ(k), pos.getX(k));
      const fray = 1 + (Math.round(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 ? 0.14 : -0.06);
      pos.setXYZ(k, pos.getX(k) * fray, pos.getY(k) - 0.35 * fray, pos.getZ(k) * fray);
    }
    g.rotateY(i * 0.7);
    const base = new THREE.Color(hues[i]);
    const under = base.clone().offsetHSL(0.02, 0, -0.12);
    parts.push(
      painted(
        g,
        (_x, y, _z, out) => out.copy(under).lerp(base, smoothstep(-h / 2, h / 4, y)),
        3.6 + u * 6.2,
      ),
    );
  }
  return topLit(mergeGeometries(parts)!, 0.74, 1.08);
}

export function roundTreeGeometry(): THREE.BufferGeometry {
  const canopy = new THREE.IcosahedronGeometry(3, 0);
  canopy.scale(1, 0.85, 1);
  const top = new THREE.IcosahedronGeometry(2, 0);
  top.translate(0.6, 1.8, 0.3);
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 5), '#8f6e5c', 1.7),
      colored(canopy, '#94c56d', 5.2),
      colored(top, '#a9d17a', 5.2),
    ])!,
  );
}

/** Crown lobes for the near broadleaf: [radius, x, y, z, colour]. */
const ROUND_LOBES: [number, number, number, number, string][] = [
  [2.5, 0, 5.0, 0, '#8fc068'],
  [1.9, 1.7, 4.5, 0.7, '#98c76e'],
  [2.0, -1.6, 4.7, -0.5, '#86b862'],
  [1.8, 0.3, 4.3, -1.7, '#8fc068'],
  [1.8, -0.5, 4.4, 1.7, '#9ccb73'],
  [1.9, 0.5, 6.6, 0.3, '#a9d17a'],
  [1.4, -0.9, 6.1, -0.7, '#a2ce76'],
  [1.2, 1.2, 6.0, -0.6, '#b0d680'],
];

/**
 * Near broadleaf (~220 triangles): a crown of eight lumpy lobes (cool and shaded beneath, warm
 * on top) on a trunk that forks into two limbs, so the silhouette is a cloud of foliage, not a ball.
 */
export function roundTreeDetailGeometry(): THREE.BufferGeometry {
  return crown(ROUND_LOBES, '#8a6a58', 0.62, 1.14, 0.5);
}

function crown(
  lobes: [number, number, number, number, string][],
  bark: string,
  dark: number,
  light: number,
  trunkR: number,
): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(trunkR * 0.65, trunkR, 3.6, 6), bark, 1.8),
    limb(1.3, 3.0, 4.6, 0.6, trunkR * 0.55, bark),
    limb(-1.2, 3.2, 4.8, -0.4, trunkR * 0.5, bark),
  ];
  lobes.forEach(([r, x, y, z, hex], i) => parts.push(lobe(r, x, y, z, hex, 40 + i)));
  return topLit(mergeGeometries(parts)!, dark, light);
}

/** Sakura: the round tree's shape in blossom pinks on a darker trunk. */
export function cherryGeometry(): THREE.BufferGeometry {
  const canopy = new THREE.IcosahedronGeometry(3.2, 0);
  canopy.scale(1.15, 0.7, 1.15);
  const top = new THREE.IcosahedronGeometry(2.1, 0);
  top.translate(-0.7, 1.4, 0.4);
  const side = new THREE.IcosahedronGeometry(1.8, 0);
  side.translate(1.6, 0.3, -0.8);
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.3, 0.55, 3.2, 5), '#6d5058', 1.6),
      colored(canopy, '#f2b6c6', 4.6),
      colored(top, '#f8cfd9', 4.6),
      colored(side, '#eaa2b6', 4.6),
    ])!,
    0.75,
    1.08,
  );
}

/** Near sakura: a wide, flat-topped spread of blossom lobes over a dark, forked trunk. */
export function cherryDetailGeometry(): THREE.BufferGeometry {
  return crown(
    [
      [2.4, 0, 4.7, 0, '#f2b6c6'],
      [2.0, 2.1, 4.3, -0.6, '#eaa2b6'],
      [2.0, -2.0, 4.4, 0.6, '#f0aec0'],
      [1.8, 0.5, 4.1, 2.0, '#f6c3d0'],
      [1.8, -0.4, 4.2, -2.0, '#eaa2b6'],
      [1.8, -0.7, 5.9, 0.4, '#f8cfd9'],
      [1.5, 1.2, 5.6, 0.9, '#fbd9e1'],
      [1.3, 1.0, 5.5, -1.3, '#f8cfd9'],
    ],
    '#5f454d',
    0.72,
    1.1,
    0.55,
  );
}

/**
 * Deterministic scatter for one chunk. Cells are enumerated by global index so every cell
 * belongs to exactly one chunk and seams never double up or leave gaps.
 */
export function scatterTrees(
  field: HeightField,
  ox: number,
  oz: number,
  size: number,
  out: number[],
): number {
  out.length = 0;
  const cell = Config.world.treeCell;
  const seed = Config.world.seed;
  const i0 = Math.ceil(ox / cell);
  const i1 = Math.ceil((ox + size) / cell);
  const j0 = Math.ceil(oz / cell);
  const j1 = Math.ceil((oz + size) / cell);
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const r = hash2(i, j, seed);
      const x = (i + hash2(i, j, seed + 11)) * cell;
      const z = (j + hash2(i, j, seed + 12)) * cell;
      const density = field.forest(x, z) * 0.75 + 0.025; // dense groves plus a few lone trees
      if (r > density) continue;
      const y = field.height(x, z);
      if (y < 1.2 || y > 115) continue;
      const slope = Math.abs(field.height(x + 3, z) - y) + Math.abs(field.height(x, z + 3) - y);
      if (slope > 3.6) continue;
      const pine = y > 55 || hash2(i, j, seed + 13) > 0.62 ? 1 : 0;
      const s = 0.65 + hash2(i, j, seed + 14) * 0.75;
      out.push(
        pine,
        x,
        y - 0.3,
        z,
        s,
        hash2(i, j, seed + 15) * Math.PI * 2,
        hash2(i, j, seed + 16),
      );
    }
  return out.length / TREE_STRIDE;
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();

/**
 * One global instanced mesh per tree shape (by default round and pine; a scatter list's type
 * field indexes `geometries`), refilled from active chunks when the set changes. A type may
 * also have a detailed shape (`near`), used for trees within Config.render.treeDetail.
 */
export class Trees {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Per type: index into `meshes` of its far and near mesh (-1: no near shape). */
  private readonly far: number[];
  private readonly near: number[];
  private readonly counts: number[];
  readonly material: THREE.MeshToonMaterial;

  constructor(
    capacity = 9000,
    geometries = [roundTreeGeometry(), pineGeometry()],
    near: (THREE.BufferGeometry | undefined)[] = [],
  ) {
    const mat = (this.material = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonGradient(),
    }));
    // Crowns sway in the wind while trunks stay planted: the push grows with the square of the
    // height up the tree, and each tree's phase comes from where it stands, so a grove ripples.
    const windTime = { value: 0 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windTime;
      shader.uniforms.uSway = {
        get value() {
          return Config.world.treeSway;
        },
      };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uWindTime;\nuniform float uSway;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 wPh = instanceMatrix[3].xz * 0.045;
  float wBend = transformed.y * transformed.y * uSway;
  transformed.x += sin(uWindTime * 1.1 + wPh.x + wPh.y) * wBend;
  transformed.z += sin(uWindTime * 0.83 + wPh.y * 1.3) * wBend * 0.6;
#endif`,
        );
    };
    const tick = () => (windTime.value = performance.now() / 1000);
    const make = (g: THREE.BufferGeometry, cap: number, name: string) => {
      const mesh = new THREE.InstancedMesh(g, mat, cap);
      mesh.onBeforeRender = tick;
      mesh.name = name;
      mesh.count = 0;
      mesh.frustumCulled = false; // instances span the whole view; per-mesh culling would be wrong
      mesh.setColorAt(0, col.set('#fff'));
      return this.meshes.push(mesh) - 1;
    };
    this.far = geometries.map((g) => make(g, capacity, 'tree'));
    // The near ring holds a small share of the trees in view; overflow falls back to far shapes.
    this.near = geometries.map((_, i) => {
      const g = near[i];
      return g ? make(g, Math.ceil(capacity / 3), 'tree-near') : -1;
    });
    this.counts = this.meshes.map(() => 0);
    this.group.add(...this.meshes);
  }

  rebuild(lists: Iterable<number[]>, px: number, pz: number, maxDist: number): void {
    const counts = this.counts;
    counts.fill(0);
    const max2 = maxDist * maxDist;
    const near2 = Config.render.treeDetail ** 2;
    for (const list of lists)
      for (let k = 0; k < list.length; k += TREE_STRIDE) {
        const x = list[k + 1];
        const z = list[k + 3];
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 > max2) continue;
        const type = list[k];
        let mi = this.near[type] >= 0 && d2 < near2 ? this.near[type] : this.far[type];
        if (counts[mi] >= this.meshes[mi].instanceMatrix.count) mi = this.far[type];
        const mesh = this.meshes[mi];
        const idx = counts[mi];
        if (idx >= mesh.instanceMatrix.count) continue;
        const s = list[k + 4];
        q.setFromAxisAngle(up, list[k + 5]);
        m.compose(p.set(x, list[k + 2], z), q, sc.set(s, s * (0.9 + list[k + 6] * 0.3), s));
        mesh.setMatrixAt(idx, m);
        // Per-tree tint: slight hue/brightness drift so groves look painted, not stamped.
        const t = list[k + 6];
        mesh.setColorAt(idx, col.setRGB(0.88 + t * 0.2, 0.92 + t * 0.12, 0.85 + (1 - t) * 0.2));
        counts[mi]++;
      }
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
  }
}

/** The highlands' chunk decor: the forest scatter feeding the two global tree meshes. */
export class TreeDecor {
  readonly trees = new Trees(
    9000,
    [roundTreeGeometry(), pineGeometry()],
    [roundTreeDetailGeometry(), pineDetailGeometry()],
  );
  readonly group = this.trees.group;

  constructor(private readonly field: HeightField) {}

  scatter(ox: number, oz: number, size: number): number[] {
    const out: number[] = [];
    scatterTrees(this.field, ox, oz, size, out);
    return out;
  }

  rebuild(items: number[][], px: number, pz: number): void {
    this.trees.rebuild(items, px, pz, Config.render.treeDistance);
  }

  dispose(): void {
    this.trees.dispose();
  }
}
