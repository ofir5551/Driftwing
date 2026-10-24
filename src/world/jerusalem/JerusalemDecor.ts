import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { ChunkDecor } from '../ChunkManager';
import { withMist } from '../Mist';
import { Trees } from '../Trees';
import {
  aleppoPineGeometry,
  archGeometry,
  boxGeometry,
  coneGeometry,
  cylinderGeometry,
  cypressGeometry,
  domeGeometry,
  hipGeometry,
  merlonsGeometry,
  octagonGeometry,
  oliveGeometry,
  onionGeometry,
  palmGeometry,
  pointedDomeGeometry,
  pyramidGeometry,
  sailsGeometry,
  solarGeometry,
} from './geometry';
import {
  BLOCK,
  MESH_COUNT,
  PART_STRIDE,
  STYLE,
  TREE_STRIDE,
  type JerusalemLayout,
} from './JerusalemLayout';
import { createStoneMaterial, type StoneUniforms } from './materials';

export interface JerusalemChunk {
  parts: number[];
  trees: number[];
}

/** Starting instance capacities per mesh (grown on demand). */
const CAPACITY = [24000, 3000, 32, 32, 600, 600, 200, 32, 1500, 4000, 2000, 8, 64];
const NAMES = [
  'box',
  'dome',
  'great-dome',
  'onion',
  'cylinder',
  'cone',
  'pyramid',
  'octagon',
  'merlons',
  'solar',
  'hip-roof',
  'sails',
  'arch',
];

/**
 * City of Gold's scenery as a dozen global instanced meshes (boxes, domes, drums, spires,
 * battlements, rooftop water heaters, tile roofs) in one stone material, plus four tree
 * shapes, refilled from the live chunks whenever the chunk set changes, as in the city.
 * Matrices are written straight into the instance buffers: every part is a scale and a yaw.
 */
export class JerusalemDecor implements ChunkDecor<JerusalemChunk> {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[];
  private readonly material: THREE.Material;
  private readonly meshes: THREE.InstancedMesh[] = [];
  readonly trees = new Trees(14000, [
    oliveGeometry(),
    cypressGeometry(),
    aleppoPineGeometry(),
    palmGeometry(),
  ]);
  private readonly counts = CAPACITY.map(() => 0);
  private readonly colors = new Map<number, THREE.Color>();
  private readonly treeLists: number[][] = [];

  constructor(
    private readonly layout: JerusalemLayout,
    uniforms: StoneUniforms,
  ) {
    this.material = createStoneMaterial(uniforms);
    withMist(this.trees.material);
    this.geometries = [
      boxGeometry(),
      domeGeometry(),
      pointedDomeGeometry(),
      onionGeometry(),
      cylinderGeometry(),
      coneGeometry(),
      pyramidGeometry(),
      octagonGeometry(),
      merlonsGeometry(),
      solarGeometry(),
      hipGeometry(),
      sailsGeometry(),
      archGeometry(),
    ];
    for (let m = 0; m < MESH_COUNT; m++) this.meshes.push(this.make(m, CAPACITY[m]));
    this.group.add(...this.meshes, this.trees.group);
  }

  private make(m: number, cap: number): THREE.InstancedMesh {
    const geo = this.geometries[m];
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.name = `jerusalem-${NAMES[m]}`;
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): JerusalemChunk {
    const parts: number[] = [];
    const trees: number[] = [];
    const L = this.layout;
    for (let j = Math.floor(oz / BLOCK); j < Math.ceil((oz + size) / BLOCK); j++)
      for (let i = Math.floor(ox / BLOCK); i < Math.ceil((ox + size) / BLOCK); i++) {
        const b = L.block(i, j);
        const P = b.parts;
        for (let k = 0; k < P.length; k += PART_STRIDE) {
          const x = P[k + 1];
          const z = P[k + 3];
          if (x >= ox && x < ox + size && z >= oz && z < oz + size)
            for (let c = 0; c < PART_STRIDE; c++) parts.push(P[k + c]);
        }
        const T = b.trees;
        for (let k = 0; k < T.length; k += TREE_STRIDE) {
          const x = T[k + 1];
          const z = T[k + 3];
          if (x >= ox && x < ox + size && z >= oz && z < oz + size)
            for (let c = 0; c < TREE_STRIDE; c++) trees.push(T[k + c]);
        }
      }
    return { parts, trees };
  }

  private color(hex: number): THREE.Color {
    let c = this.colors.get(hex);
    if (!c) {
      c = new THREE.Color().setHex(hex); // sRGB in, linear stored
      this.colors.set(hex, c);
    }
    return c;
  }

  /** Small parts fade with the trees; walls, towers and landmarks stay to the horizon. */
  private visible(
    P: number[],
    k: number,
    px: number,
    pz: number,
    near2: number,
    far2: number,
  ): boolean {
    const d2 = (P[k + 1] - px) ** 2 + (P[k + 3] - pz) ** 2;
    if (d2 > far2) return false;
    if (d2 <= near2) return true;
    const st = P[k + 9];
    return P[k + 5] > 9 || st === STYLE.FLOOD || st === STYLE.GOLD;
  }

  rebuild(items: JerusalemChunk[], px: number, pz: number): void {
    const far2 = Config.render.drawDistance ** 2;
    const near2 = Math.max(Config.render.treeDistance, Config.render.drawDistance * 0.6) ** 2;
    const counts = this.counts;
    counts.fill(0);
    for (const it of items)
      for (let k = 0; k < it.parts.length; k += PART_STRIDE)
        if (this.visible(it.parts, k, px, pz, near2, far2)) counts[it.parts[k]]++;
    for (let m = 0; m < this.meshes.length; m++) {
      const cap = this.meshes[m].instanceMatrix.count;
      if (counts[m] <= cap) continue;
      const old = this.meshes[m];
      this.meshes[m] = this.make(m, Math.ceil(counts[m] * 1.4));
      this.group.remove(old);
      old.dispose();
      this.group.add(this.meshes[m]);
    }
    counts.fill(0);
    for (const it of items) {
      const P = it.parts;
      for (let k = 0; k < P.length; k += PART_STRIDE) {
        if (!this.visible(P, k, px, pz, near2, far2)) continue;
        const m = P[k];
        const mesh = this.meshes[m];
        const i = counts[m]++;
        const M = mesh.instanceMatrix.array as Float32Array;
        const o = i * 16;
        const sx = P[k + 4];
        const sy = P[k + 5];
        const sz = P[k + 6];
        const c = Math.cos(P[k + 7]);
        const s = Math.sin(P[k + 7]);
        // Scale then yaw (same layout as Matrix4.makeRotationY), translation to the part's base.
        M[o] = c * sx;
        M[o + 1] = 0;
        M[o + 2] = -s * sx;
        M[o + 3] = 0;
        M[o + 4] = 0;
        M[o + 5] = sy;
        M[o + 6] = 0;
        M[o + 7] = 0;
        M[o + 8] = s * sz;
        M[o + 9] = 0;
        M[o + 10] = c * sz;
        M[o + 11] = 0;
        M[o + 12] = P[k + 1];
        M[o + 13] = P[k + 2];
        M[o + 14] = P[k + 3];
        M[o + 15] = 1;
        const col = this.color(P[k + 8]);
        const C = mesh.instanceColor!.array as Float32Array;
        C[i * 3] = col.r;
        C[i * 3 + 1] = col.g;
        C[i * 3 + 2] = col.b;
        const st = mesh.geometry.getAttribute('aStyle').array as Float32Array;
        st[i * 2] = P[k + 9];
        st[i * 2 + 1] = P[k + 10];
      }
    }
    for (let m = 0; m < this.meshes.length; m++) {
      const mesh = this.meshes[m];
      mesh.count = counts[m];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.geometry.getAttribute('aStyle').needsUpdate = true;
    }
    this.treeLists.length = 0;
    for (const it of items) this.treeLists.push(it.trees);
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.trees.dispose();
  }
}
