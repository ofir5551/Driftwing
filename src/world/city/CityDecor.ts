import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { ChunkDecor } from '../ChunkManager';
import { withMist } from '../Mist';
import { ShadowCasters } from '../ShadowCasters';
import { Trees } from '../Trees';
import { CITY_TREE_STRIDE, MESH, PART_STRIDE, STYLE, type CityLayout } from './CityLayout';
import {
  boxGeometry,
  cityTreeShapes,
  cylinderGeometry,
  gableGeometry,
  hipGeometry,
  latticeGeometry,
} from './geometry';
import { createBuildingMaterial, createPropMaterial, type CityUniforms } from './materials';
import { PROP, PROP_KINDS, PROP_SMALL, PROP_STRIDE } from './props';
import { propGeometries } from './shapes';
import { ContactShadows } from '../ContactShadows';
import { commitInstances } from '../instances';

export interface CityChunk {
  parts: number[];
  trees: number[];
  /** Street furniture, rooftop clutter and moored boats (props.ts records). */
  props: number[];
}

/** Starting instance capacities per mesh (grown on demand). */
const CAPACITY = [30000, 6000, 12000, 3000, 1500, 8];
/** Building casters' capacity per mesh near the bird, on high (0: casts no shadow). The
 * lattice is cut in its shader, so its solid shell would cast a slab: it casts none. */
const CASTS = [9000, 2000, 2500, 400, 300, 0];
const mat4 = new THREE.Matrix4();

/** Per prop kind: most instances drawn at once. */
const PROP_CAP = [3000, 3000, 3000, 1500, 1500, 2000, 600, 6000, 1500, 4000, 4000, 6000, 800];
/** Per prop kind: casts a sun shadow near the bird on high (lamps, poles, signals, shelters,
 * rooftop kits). */
const PROP_CASTS = [1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0];
/** Per prop kind: contact-shadow radius (0 = none). */
const PROP_BLOB = [0.45, 0.55, 0, 0.55, 1.2, 1.1, 2.1, 0, 1.5, 2.6, 2.4, 0, 0];
/** Vending machine bodies (sRGB): the drinks makers' white, red, blue and the odd yellow. */
const VENDING = ['#f6f4f0', '#e2483e', '#3d6fc4', '#f6f4f0', '#f2c94a'].map(
  (h) => new THREE.Color(h),
);
const BOATS = ['#ffffff', '#f2ece0', '#e4eef6', '#f6e8e4'].map((h) => new THREE.Color(h));
const tint = new THREE.Color();

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
  private readonly boxMaterial: THREE.Material;
  private readonly latticeMaterial: THREE.Material;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly casters: (ShadowCasters | null)[] = [];
  private readonly trees: Trees;
  private readonly counts = CAPACITY.map(() => 0);
  private readonly colors = new Map<number, THREE.Color>();
  private readonly treeLists: number[][] = [];
  // Props: one instanced mesh per kind, casters on high, contact shadows on medium and high.
  readonly propMaterial: THREE.MeshToonMaterial;
  private readonly props: THREE.InstancedMesh[] = [];
  private readonly propCasters: (ShadowCasters | null)[] = [];
  private readonly propCount = new Array<number>(PROP_KINDS).fill(0);
  private readonly contact = new ContactShadows(4000);

  constructor(
    private readonly city: CityLayout,
    uniforms: CityUniforms,
  ) {
    const shapes = cityTreeShapes();
    this.trees = new Trees(12000, shapes.far, shapes.near, shapes.distant);
    this.trees.ground = (x, z) => city.height(x, z); // contact shadows lie on the slope
    withMist(this.trees.material);
    this.material = withMist(createBuildingMaterial(uniforms));
    this.boxMaterial = withMist(createBuildingMaterial(uniforms, THREE.FrontSide, true));
    this.latticeMaterial = withMist(createBuildingMaterial(uniforms, THREE.DoubleSide));
    this.geometries = [
      boxGeometry(),
      cylinderGeometry(),
      gableGeometry(),
      hipGeometry(0),
      hipGeometry(0.35),
      latticeGeometry(),
    ];
    for (let m = 0; m < this.geometries.length; m++) {
      this.meshes.push(this.make(m, CAPACITY[m]));
      // Towers cast across the streets on high (shadow-only copies of the parts near the bird).
      const c = CASTS[m] ? new ShadowCasters(this.geometries[m], this.material, CASTS[m]) : null;
      this.casters.push(c);
      if (c) this.group.add(c.mesh);
    }
    this.group.add(...this.meshes, this.trees.group);
    this.propMaterial = withMist(createPropMaterial(uniforms));
    const pg = propGeometries();
    for (let k = 0; k < PROP_KINDS; k++) {
      const mesh = new THREE.InstancedMesh(pg[k], this.propMaterial, PROP_CAP[k]);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = `city-prop-${k}`;
      mesh.setColorAt(0, tint.set('#fff'));
      this.props.push(mesh);
      const c = PROP_CASTS[k] ? new ShadowCasters(pg[k], this.propMaterial, PROP_CAP[k]) : null;
      this.propCasters.push(c);
      if (c) this.group.add(c.mesh);
    }
    this.group.add(...this.props, this.contact.mesh);
  }

  private make(m: number, cap: number): THREE.InstancedMesh {
    const geo = this.geometries[m];
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    const mesh = new THREE.InstancedMesh(
      geo,
      m === MESH.LATTICE ? this.latticeMaterial : m === MESH.BOX ? this.boxMaterial : this.material,
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
    const props: number[] = [];
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
        const Q = sb.props;
        for (let k = 0; k < Q.length; k += PROP_STRIDE) {
          const x = Q[k + 1];
          const z = Q[k + 3];
          if (x >= ox && x < ox + size && z >= oz && z < oz + size)
            for (let c = 0; c < PROP_STRIDE; c++) props.push(Q[k + c]);
        }
      }
    return { parts, trees, props };
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
    for (const c of this.casters) c?.begin(px, pz, Config.world.chunkSize);
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
        const caster = this.casters[m];
        if (caster) caster.add(P[k + 1], P[k + 3], mat4.fromArray(M, o));
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
      commitInstances(mesh, counts[m]);
      mesh.geometry.getAttribute('aStyle').needsUpdate = true;
      this.casters[m]?.end();
    }
    this.treeLists.length = 0;
    for (const it of items) this.treeLists.push(it.trees);
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
    this.placeProps(items, px, pz);
  }

  /** Refill every prop mesh, its casters and the contact shadows from the live chunks. */
  private placeProps(items: CityChunk[], px: number, pz: number): void {
    const R = Config.render;
    const big2 = R.propDistance ** 2;
    const small2 = R.smallPropDistance ** 2;
    const n = this.propCount;
    n.fill(0);
    for (const c of this.propCasters) c?.begin(px, pz, Config.world.chunkSize);
    this.contact.begin(px, pz);
    const ground = this.trees.ground;
    for (const it of items) {
      const L = it.props;
      for (let k = 0; k < L.length; k += PROP_STRIDE) {
        const kind = L[k];
        const x = L[k + 1];
        const y = L[k + 2];
        const z = L[k + 3];
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 > (PROP_SMALL[kind] ? small2 : big2)) continue;
        const mesh = this.props[kind];
        const i = n[kind];
        if (i >= mesh.instanceMatrix.count) continue;
        n[kind] = i + 1;
        const M = mesh.instanceMatrix.array as Float32Array;
        const o = i * 16;
        const sx = L[k + 5];
        const sy = L[k + 6];
        const sz = L[k + 7];
        const c = Math.cos(L[k + 4]);
        const s = Math.sin(L[k + 4]);
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
        M[o + 12] = x;
        M[o + 13] = y;
        M[o + 14] = z;
        M[o + 15] = 1;
        const t = L[k + 8];
        if (kind === PROP.Vending) tint.copy(VENDING[Math.floor(t * VENDING.length) % 5]);
        else if (kind === PROP.Boat) tint.copy(BOATS[Math.floor(t * 4) % 4]);
        else tint.setRGB(0.93 + t * 0.12, 0.93 + t * 0.09, 0.94 + (1 - t) * 0.08);
        const C = mesh.instanceColor!.array as Float32Array;
        C[i * 3] = tint.r;
        C[i * 3 + 1] = tint.g;
        C[i * 3 + 2] = tint.b;
        const caster = this.propCasters[kind];
        if (caster) caster.add(x, z, mat4.fromArray(M, o));
        if (PROP_BLOB[kind] > 0) this.contact.add(x, y, z, PROP_BLOB[kind], ground);
      }
    }
    for (let k = 0; k < PROP_KINDS; k++) {
      const mesh = this.props[k];
      commitInstances(mesh, n[k]);
      this.propCasters[k]?.end();
    }
    this.contact.end();
  }

  /** Props drawn per kind (debug / tests). */
  get propCounts(): readonly number[] {
    return this.propCount;
  }

  /** Instances drawn per mesh (debug / tests). */
  get instanceCounts(): readonly number[] {
    return this.counts;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const c of this.casters) c?.dispose();
    for (const m of this.props) {
      m.geometry.dispose();
      m.dispose();
    }
    for (const c of this.propCasters) c?.dispose();
    this.contact.dispose();
    this.propMaterial.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.boxMaterial.dispose();
    this.latticeMaterial.dispose();
    this.trees.dispose();
  }
}
