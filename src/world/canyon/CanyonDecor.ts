import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { hash2 } from '../noise';
import { Trees } from '../Trees';
import type { Arch, CanyonLayout, Hoodoo } from './CanyonLayout';
import {
  archGeometry,
  cottonwoodGeometry,
  hoodooGeometry,
  juniperGeometry,
  sageGeometry,
} from './geometry';

export interface CanyonChunk {
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  hoodoos: Hoodoo[];
  arches: Arch[];
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/** Tree types in the Trees instance. */
const JUNIPER = 0;
const COTTONWOOD = 1;
const SAGE = 2;

/**
 * Red Canyons' scenery as global instanced meshes refilled from the live chunks: cottonwoods
 * along the river, sagebrush and juniper on the floors, benches and plateau, hoodoos crowding
 * the rims, and the arches (the Great Arch included).
 */
export class CanyonDecor implements ChunkDecor<CanyonChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly hoodoos: THREE.InstancedMesh[];
  private readonly arches: THREE.InstancedMesh[];
  readonly trees = new Trees(12000, [juniperGeometry(), cottonwoodGeometry(), sageGeometry()]);
  private readonly treeLists: number[][] = [];

  constructor(private readonly layout: CanyonLayout) {
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.hoodoos = [this.make(hoodooGeometry(false), 2500), this.make(hoodooGeometry(true), 2500)];
    this.arches = [this.make(archGeometry(0.21), 40), this.make(archGeometry(0.67), 40)];
    // Names show up in scripts/level-shots.mjs's triangle report.
    this.hoodoos.forEach((h, i) => (h.name = `hoodoo-${i}`));
    this.arches.forEach((a, i) => (a.name = `arch-${i}`));
    this.group.add(...this.hoodoos, ...this.arches, this.trees.group);
  }

  private make(geo: THREE.BufferGeometry, cap: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): CanyonChunk {
    const L = this.layout;
    const seed = L.seed;
    const out: CanyonChunk = { trees: [], hoodoos: [], arches: [] };
    const cell = 9;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const y = L.height(x, z);
        if (y < 0.4) continue;
        const d = L.cd;
        const rw = L.river(x, z);
        const steep = Math.abs(L.height(x + 2, z) - y) + Math.abs(L.height(x, z + 2) - y);
        if (steep > 3) continue;
        const h = hash2(i, j, seed);
        let type = -1;
        let s = 1;
        // Cottonwoods in a green band along the river's banks.
        if (y < 3 && d < rw + 20 && h < 0.55 * (1 - smoothstep(rw + 8, rw + 20, d))) {
          type = COTTONWOOD;
          s = 0.8 + 0.5 * hash2(i, j, seed + 14);
        } else {
          const scrub = L.scrub(x, z);
          if (h < scrub * 0.32) {
            type = SAGE;
            s = 0.7 + 0.8 * hash2(i, j, seed + 14);
          } else if (h < scrub * 0.32 + scrub * (y > 20 ? 0.12 : 0.04)) {
            type = JUNIPER;
            s = 0.7 + 0.6 * hash2(i, j, seed + 14);
          }
        }
        if (type < 0) continue;
        out.trees.push(
          type,
          x,
          y - 0.3,
          z,
          s,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
    const H = Config.canyon.hoodooCell;
    for (let j = Math.floor(oz / H); j < Math.ceil((oz + size) / H); j++)
      for (let i = Math.floor(ox / H); i < Math.ceil((ox + size) / H); i++) {
        const hd = L.hoodoo(i, j);
        if (hd && hd.x >= ox && hd.x < ox + size && hd.z >= oz && hd.z < oz + size)
          out.hoodoos.push(hd);
      }
    const A = Config.canyon.archCell;
    for (let j = Math.floor(oz / A); j <= Math.floor((oz + size) / A); j++)
      for (let i = Math.floor(ox / A); i <= Math.floor((ox + size) / A); i++) {
        const a = L.arch(i, j);
        if (a && a.x >= ox && a.x < ox + size && a.z >= oz && a.z < oz + size) out.arches.push(a);
      }
    const G = L.great;
    if (G.x >= ox && G.x < ox + size && G.z >= oz && G.z < oz + size) out.arches.push(G);
    return out;
  }

  rebuild(items: CanyonChunk[], px: number, pz: number): void {
    const hc = [0, 0];
    const ac = [0, 0];
    this.treeLists.length = 0;
    for (const it of items) {
      this.treeLists.push(it.trees);
      for (const hd of it.hoodoos) {
        const k = hd.slim ? 1 : 0;
        const mesh = this.hoodoos[k];
        if (hc[k] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, hd.yaw);
        m.compose(p.set(hd.x, hd.y0, hd.z), q, sc.set(hd.r, hd.h, hd.r));
        mesh.setMatrixAt(hc[k]++, m);
      }
      for (const a of it.arches) {
        const k = a.seed < 0.5 ? 0 : 1;
        const mesh = this.arches[k];
        if (ac[k] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, a.yaw);
        m.compose(p.set(a.x, a.y0, a.z), q, sc.set(a.r, a.h, a.d));
        mesh.setMatrixAt(ac[k]++, m);
      }
    }
    for (let k = 0; k < 2; k++) {
      this.hoodoos[k].count = hc[k];
      this.hoodoos[k].instanceMatrix.needsUpdate = true;
      this.arches[k].count = ac[k];
      this.arches[k].instanceMatrix.needsUpdate = true;
    }
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
  }

  dispose(): void {
    for (const mesh of [...this.hoodoos, ...this.arches]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.trees.dispose();
  }
}
