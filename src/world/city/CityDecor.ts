import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { ChunkDecor } from '../ChunkManager';
import { cherryGeometry, pineGeometry, roundTreeGeometry, Trees } from '../Trees';
import { CITY_TREE_STRIDE, MESH, PART_STRIDE, STYLE, type CityLayout } from './CityLayout';
import {
  boxGeometry,
  cylinderGeometry,
  gableGeometry,
  hipGeometry,
  latticeGeometry,
} from './geometry';
import { createBuildingMaterial, type CityUniforms } from './materials';

export interface CityChunk {
  parts: number[];
  trees: number[];
}

/** Starting instance capacities per mesh (grown on demand). */
const CAPACITY = [30000, 6000, 12000, 3000, 1500, 8];

/**
 * The city's scenery as a handful of global instanced meshes (box, cylinder, gable roof, hip
 * roof, ridge roof, lattice) plus three tree shapes, refilled from the live chunks whenever
 * the chunk set changes, like the highlands trees. Matrices are written straight into the
 * instance buffers: every part is an axis-aligned scale plus a yaw.
 */
export class CityDecor implements ChunkDecor<CityChunk> {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[];
  private readonly material: THREE.Material;
  private readonly latticeMaterial: THREE.Material;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly trees = new Trees(12000, [
    roundTreeGeometry(),
    pineGeometry(),
    cherryGeometry(),
  ]);
  private readonly counts = CAPACITY.map(() => 0);
  private readonly colors = new Map<number, THREE.Color>();
  private readonly treeLists: number[][] = [];

  constructor(
    private readonly city: CityLayout,
    uniforms: CityUniforms,
  ) {
    this.material = createBuildingMaterial(uniforms);
    this.latticeMaterial = createBuildingMaterial(uniforms, THREE.DoubleSide);
    this.geometries = [
      boxGeometry(),
      cylinderGeometry(),
      gableGeometry(),
      hipGeometry(0),
      hipGeometry(0.35),
      latticeGeometry(),
    ];
    for (let m = 0; m < this.geometries.length; m++) this.meshes.push(this.make(m, CAPACITY[m]));
    this.group.add(...this.meshes, this.trees.group);
  }

  private make(m: number, cap: number): THREE.InstancedMesh {
    const geo = this.geometries[m];
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    const mesh = new THREE.InstancedMesh(
      geo,
      m === MESH.LATTICE ? this.latticeMaterial : this.material,
      cap,
    );
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.name = `city-${['box', 'cylinder', 'gable', 'hip', 'ridge', 'lattice'][m]}`;
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): CityChunk {
    const S = this.city.S;
    const pad = 24; // avenue structures sit up to this far outside their owning superblock
    const parts: number[] = [];
    const trees: number[] = [];
    for (let J = Math.floor((oz - pad) / S); J <= Math.floor((oz + size + pad) / S); J++)
      for (let I = Math.floor((ox - pad) / S); I <= Math.floor((ox + size + pad) / S); I++) {
        const sb = this.city.superblock(I, J);
        const P = sb.parts;
        for (let k = 0; k < P.length; k += PART_STRIDE) {
          const x = P[k + 1];
          const z = P[k + 3];
          if (x >= ox && x < ox + size && z >= oz && z < oz + size)
            for (let c = 0; c < PART_STRIDE; c++) parts.push(P[k + c]);
        }
        const T = sb.trees;
        for (let k = 0; k < T.length; k += CITY_TREE_STRIDE) {
          const x = T[k + 1];
          const z = T[k + 3];
          if (x >= ox && x < ox + size && z >= oz && z < oz + size)
            for (let c = 0; c < CITY_TREE_STRIDE; c++) trees.push(T[k + c]);
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

  /** Small parts fade with the trees; towers, landmarks and beacons stay to the horizon. */
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
    return d2 <= near2 || P[k + 5] > 25 || P[k] === MESH.LATTICE || P[k + 9] === STYLE.BEACON;
  }

  rebuild(items: CityChunk[], px: number, pz: number): void {
    const far2 = Config.render.drawDistance ** 2;
    const near2 = Math.max(Config.render.treeDistance, Config.render.drawDistance * 0.7) ** 2;
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

  /** Instances drawn per mesh (debug / tests). */
  get instanceCounts(): readonly number[] {
    return this.counts;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.latticeMaterial.dispose();
    this.trees.dispose();
  }
}
