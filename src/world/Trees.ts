import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../core/Config';
import { getToonGradient, type HeightField } from './Terrain';
import { hash2 } from './noise';

/** Floats stored per tree in a chunk's scatter list: type, x, y, z, scale, rotY, tint. */
export const TREE_STRIDE = 7;

function colored(g: THREE.BufferGeometry, hex: string, y = 0): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.translate(0, y, 0);
  const c = new THREE.Color(hex);
  const n = ng.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute('uv');
  ng.computeVertexNormals(); // non-indexed -> per-face normals: crisp low-poly facets
  return ng;
}

/** Low-poly tree shapes built from primitives, merged so each type is one instanced draw. */
export function pineGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 5), '#8a6a5a', 1.2),
    colored(new THREE.ConeGeometry(2.7, 4.6, 6), '#4f8f72', 4.3),
    colored(new THREE.ConeGeometry(2.1, 3.8, 6), '#5a9b78', 6.6),
    colored(new THREE.ConeGeometry(1.4, 3.2, 6), '#67a77e', 8.6),
  ])!;
}

export function roundTreeGeometry(): THREE.BufferGeometry {
  const canopy = new THREE.IcosahedronGeometry(3, 0);
  canopy.scale(1, 0.85, 1);
  const top = new THREE.IcosahedronGeometry(2, 0);
  top.translate(0.6, 1.8, 0.3);
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 5), '#8f6e5c', 1.7),
    colored(canopy, '#94c56d', 5.2),
    colored(top, '#a9d17a', 5.2),
  ])!;
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

/** Two global instanced meshes (pine, round) refilled from active chunks when the set changes. */
export class Trees {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[];

  constructor(capacity = 9000) {
    const mat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonGradient(),
    });
    this.meshes = [roundTreeGeometry(), pineGeometry()].map((g) => {
      const mesh = new THREE.InstancedMesh(g, mat, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false; // instances span the whole view; per-mesh culling would be wrong
      mesh.setColorAt(0, col.set('#fff'));
      return mesh;
    });
    this.group.add(...this.meshes);
  }

  rebuild(lists: Iterable<number[]>, px: number, pz: number, maxDist: number): void {
    const counts = [0, 0];
    const cap = this.meshes[0].instanceMatrix.count;
    const max2 = maxDist * maxDist;
    for (const list of lists)
      for (let k = 0; k < list.length; k += TREE_STRIDE) {
        const x = list[k + 1];
        const z = list[k + 3];
        if ((x - px) ** 2 + (z - pz) ** 2 > max2) continue;
        const type = list[k];
        const idx = counts[type];
        if (idx >= cap) continue;
        const s = list[k + 4];
        q.setFromAxisAngle(up, list[k + 5]);
        m.compose(p.set(x, list[k + 2], z), q, sc.set(s, s * (0.9 + list[k + 6] * 0.3), s));
        const mesh = this.meshes[type];
        mesh.setMatrixAt(idx, m);
        // Per-tree tint: slight hue/brightness drift so groves look painted, not stamped.
        const t = list[k + 6];
        mesh.setColorAt(idx, col.setRGB(0.88 + t * 0.2, 0.92 + t * 0.12, 0.85 + (1 - t) * 0.2));
        counts[type]++;
      }
    for (let t = 0; t < 2; t++) {
      const mesh = this.meshes[t];
      mesh.count = counts[t];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
