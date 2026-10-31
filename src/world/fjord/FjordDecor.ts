import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { hash2 } from '../noise';
import { Trees } from '../Trees';
import {
  bergGeometry,
  floeGeometry,
  hutGeometry,
  hutWindowGeometry,
  spruceDetailGeometry,
  spruceGeometry,
} from './geometry';
import type { Berg, FjordLayout } from './FjordLayout';

export interface FjordChunk {
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** x, y, z, yaw, scale */
  huts: number[];
  /** x, z, yaw, scale */
  floes: number[];
  bergs: Berg[];
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const DAY_WINDOW = new THREE.Color('#3a4250');
// HDR (> 1) so bloom halos the windows after dark.
const NIGHT_WINDOW = new THREE.Color(3.4, 2.0, 0.8);

/**
 * Aurora Fjords' scenery as global instanced meshes refilled from the live chunks: spruce on
 * the strands and lower walls, red rorbu huts in hamlets along the shore (their windows warm
 * after dark), pans of sea ice and icebergs out on the water.
 */
export class FjordDecor implements ChunkDecor<FjordChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly windowMaterial: THREE.MeshBasicMaterial;
  private readonly huts: THREE.InstancedMesh;
  private readonly windows: THREE.InstancedMesh;
  private readonly floes: THREE.InstancedMesh;
  private readonly bergs: THREE.InstancedMesh[];
  readonly trees = new Trees(9000, [spruceGeometry()], [spruceDetailGeometry()]);
  private readonly treeLists: number[][] = [];

  constructor(private readonly layout: FjordLayout) {
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.windowMaterial = new THREE.MeshBasicMaterial({ color: DAY_WINDOW.clone() });
    this.huts = this.make(hutGeometry(), 1500);
    this.windows = this.make(hutWindowGeometry(), 1500, this.windowMaterial);
    this.floes = this.make(floeGeometry(), 2500);
    this.bergs = [this.make(bergGeometry(4), 300), this.make(bergGeometry(7), 300)];
    // Names show up in scripts/level-shots.mjs's triangle report.
    this.huts.name = 'hut';
    this.windows.name = 'hut-window';
    this.floes.name = 'floe';
    this.bergs.forEach((b, i) => (b.name = `berg-${i}`));
    this.group.add(this.huts, this.windows, this.floes, ...this.bergs, this.trees.group);
  }

  private make(
    geo: THREE.BufferGeometry,
    cap: number,
    mat: THREE.Material = this.material,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): FjordChunk {
    const L = this.layout;
    const seed = L.seed;
    const out: FjordChunk = { trees: [], huts: [], floes: [], bergs: [] };
    // Spruce: dense stands on the strand and the lower walls, clinging on even where it's steep.
    const cell = 10;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        if (hash2(i, j, seed) > L.forest(x, z) * 0.8) continue;
        const y = L.height(x, z);
        if (Math.abs(L.height(x + 3, z) - y) + Math.abs(L.height(x, z + 3) - y) > 8) continue;
        out.trees.push(
          0,
          x,
          y - 0.4,
          z,
          0.6 + hash2(i, j, seed + 14) * 0.7,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
    // Hamlets: red huts along the strand, a row facing the water.
    const hc = 16;
    for (let j = Math.ceil(oz / hc); j < Math.ceil((oz + size) / hc); j++)
      for (let i = Math.ceil(ox / hc); i < Math.ceil((ox + size) / hc); i++) {
        const x = (i + 0.2 + hash2(i, j, seed + 21) * 0.6) * hc;
        const z = (j + 0.2 + hash2(i, j, seed + 22) * 0.6) * hc;
        if (L.hamlet(x, z) < 0.5 || hash2(i, j, seed + 23) > 0.7) continue;
        const bank = L.fjord(x, z);
        if (bank < 3 || bank > L.shelf(x, z) - 4) continue;
        // Face the water: the fjord noise falls toward the centre line.
        const s = L.fv > 0 ? -1 : 1;
        const yaw = Math.atan2(L.fgx * s, L.fgz * s) + (hash2(i, j, seed + 24) - 0.5) * 0.25;
        out.huts.push(x, L.height(x, z) - 0.2, z, yaw, 0.85 + hash2(i, j, seed + 26) * 0.3);
      }
    // Sea ice: pans drifting on the open water, thicker out in the middle of the fjord.
    const fc = 30;
    for (let j = Math.ceil(oz / fc); j < Math.ceil((oz + size) / fc); j++)
      for (let i = Math.ceil(ox / fc); i < Math.ceil((ox + size) / fc); i++) {
        const x = (i + hash2(i, j, seed + 31)) * fc;
        const z = (j + hash2(i, j, seed + 32)) * fc;
        const bank = L.fjord(x, z);
        if (bank > -10 || hash2(i, j, seed + 33) > 0.25 + 0.3 * smoothstep(-10, -60, bank))
          continue;
        out.floes.push(x, z, hash2(i, j, seed + 34) * 7, 2 + 6 * hash2(i, j, seed + 35) ** 2);
      }
    const C = Config.fjord.bergCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++) {
        const b = L.berg(i, j);
        if (b && b.x >= ox && b.x < ox + size && b.z >= oz && b.z < oz + size) out.bergs.push(b);
      }
    return out;
  }

  rebuild(items: FjordChunk[], px: number, pz: number): void {
    let hc = 0;
    let fc = 0;
    const bc = [0, 0];
    this.treeLists.length = 0;
    for (const it of items) {
      this.treeLists.push(it.trees);
      const H = it.huts;
      for (let i = 0; i < H.length && hc < this.huts.instanceMatrix.count; i += 5) {
        q.setFromAxisAngle(up, H[i + 3]);
        const s = H[i + 4];
        m.compose(p.set(H[i], H[i + 1], H[i + 2]), q, sc.set(s, s, s));
        this.huts.setMatrixAt(hc, m);
        this.windows.setMatrixAt(hc++, m);
      }
      const F = it.floes;
      for (let i = 0; i < F.length && fc < this.floes.instanceMatrix.count; i += 4) {
        q.setFromAxisAngle(up, F[i + 2]);
        const s = F[i + 3];
        m.compose(p.set(F[i], 0, F[i + 1]), q, sc.set(s, 1, s * 0.8));
        this.floes.setMatrixAt(fc++, m);
      }
      for (const b of it.bergs) {
        const k = b.seed < 0.5 ? 0 : 1;
        const mesh = this.bergs[k];
        if (bc[k] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, b.yaw);
        m.compose(p.set(b.x, 0, b.z), q, sc.set(b.r, b.h, b.r));
        mesh.setMatrixAt(bc[k]++, m);
      }
    }
    const counts: [THREE.InstancedMesh, number][] = [
      [this.huts, hc],
      [this.windows, hc],
      [this.floes, fc],
      [this.bergs[0], bc[0]],
      [this.bergs[1], bc[1]],
    ];
    for (const [mesh, n] of counts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
  }

  /** Hut windows: dark glass by day, warm lamplight as the light goes. */
  frame(day: DayCycle): void {
    const night = smoothstep(0.08, 0.6, day.palette.stars) * Config.fjord.windows;
    this.windowMaterial.color.copy(DAY_WINDOW).lerp(NIGHT_WINDOW, night);
  }

  dispose(): void {
    for (const mesh of [this.huts, this.windows, this.floes, ...this.bergs]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.windowMaterial.dispose();
    this.trees.dispose();
  }
}
