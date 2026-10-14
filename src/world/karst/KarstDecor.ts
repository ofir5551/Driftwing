import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { ChunkDecor } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { hash2, mulberry32 } from '../noise';
import { pineGeometry, roundTreeGeometry, Trees } from '../Trees';
import {
  bambooGeometry,
  houseGeometry,
  HOUSE_LANTERN,
  lanternGeometry,
  pavilionGeometry,
  PAVILION_LANTERNS,
  pillarGeometry,
  raftGeometry,
  RAFT_LANTERN,
} from './geometry';
import { profile, SHAPES, type KarstLayout, type Pillar } from './KarstLayout';

/** Tree types in the shared Trees meshes. */
const ROUND = 0;
const BAMBOO = 1;
const PINE = 2;

export interface KarstChunk {
  pillars: Pillar[];
  /** Trees in the Trees stride: type, x, y, z, scale, rotY, tint. */
  trees: number[];
  /** x, y, z, yaw, scale, storeys - 1 */
  houses: number[];
  /** x, z, yaw */
  rafts: number[];
  /** x, y, z, yaw */
  pavilions: number[];
  /** x, y, z, scale */
  lanterns: number[];
}

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const DAY_LANTERN = new THREE.Color('#b8463b');
// HDR (> 1) so bloom halos the lanterns after dark.
const NIGHT_LANTERN = new THREE.Color(4.2, 1.7, 0.6);

/** Push local point (lx, ly, lz) of a thing at (x, y, z) turned by yaw, plus a size, into `out`. */
function place(
  out: number[],
  x: number,
  y: number,
  z: number,
  yaw: number,
  l: { x: number; y: number; z: number },
  s: number,
  size: number,
): void {
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  out.push(x + (l.x * c + l.z * n) * s, y + l.y * s, z + (-l.x * n + l.z * c) * s, size);
}

/**
 * Jade River's scenery as global instanced meshes refilled from the live chunks: five pillar
 * silhouettes, trees (round, bamboo, pine) on the valley floor and clinging to the rock, village
 * houses, fishing rafts, hilltop pavilions, and the paper lanterns that glow on all of them
 * after dark.
 */
export class KarstDecor implements ChunkDecor<KarstChunk> {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshToonMaterial;
  private readonly lanternMaterial: THREE.MeshBasicMaterial;
  /** Pillar meshes: per shape, a detailed one near the bird and a coarse one in the haze. */
  private readonly pillars: THREE.InstancedMesh[];
  private readonly farPillars: THREE.InstancedMesh[];
  private readonly houses: THREE.InstancedMesh[];
  private readonly rafts: THREE.InstancedMesh;
  private readonly pavilions: THREE.InstancedMesh;
  private readonly lanterns: THREE.InstancedMesh;
  readonly trees = new Trees(12000, [roundTreeGeometry(), bambooGeometry(), pineGeometry()]);
  private readonly treeLists: number[][] = [];

  constructor(private readonly layout: KarstLayout) {
    this.material = withMist(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    withMist(this.trees.material);
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: DAY_LANTERN.clone() });
    this.pillars = SHAPES.map((sh, i) => this.make(pillarGeometry(sh, 70 + i), 600));
    this.farPillars = SHAPES.map((sh, i) => this.make(pillarGeometry(sh, 70 + i, 9, 11), 1600));
    this.houses = [this.make(houseGeometry(1), 2500), this.make(houseGeometry(2), 1200)];
    this.rafts = this.make(raftGeometry(), 500);
    this.pavilions = this.make(pavilionGeometry(), 300);
    this.lanterns = this.make(lanternGeometry(), 5000, this.lanternMaterial);
    this.group.add(
      ...this.pillars,
      ...this.farPillars,
      ...this.houses,
      this.rafts,
      this.pavilions,
      this.lanterns,
      this.trees.group,
    );
  }

  private make(
    geo: THREE.BufferGeometry,
    cap: number,
    mat: THREE.Material = this.material,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole view
    return mesh;
  }

  scatter(ox: number, oz: number, size: number): KarstChunk {
    const L = this.layout;
    const seed = L.seed;
    const out: KarstChunk = {
      pillars: [],
      trees: [],
      houses: [],
      rafts: [],
      pavilions: [],
      lanterns: [],
    };
    // Pillars whose centre lies in this chunk, with their crowns, clinging shrubs and pavilions.
    const C = Config.karst.pillarCell;
    for (let j = Math.floor(oz / C); j <= Math.floor((oz + size) / C); j++)
      for (let i = Math.floor(ox / C); i <= Math.floor((ox + size) / C); i++)
        for (const pl of L.cell(i, j)) {
          if (pl.x < ox || pl.x >= ox + size || pl.z < oz || pl.z >= oz + size) continue;
          out.pillars.push(pl);
          this.dress(pl, out);
        }
    // Valley floor: bamboo along the banks, broadleaf groves inland.
    const cell = 9;
    for (let j = Math.ceil(oz / cell); j < Math.ceil((oz + size) / cell); j++)
      for (let i = Math.ceil(ox / cell); i < Math.ceil((ox + size) / cell); i++) {
        const x = (i + hash2(i, j, seed + 11)) * cell;
        const z = (j + hash2(i, j, seed + 12)) * cell;
        const g = L.grove(x, z);
        if (hash2(i, j, seed) > g * 0.85 + 0.01) continue;
        const bank = L.river(x, z);
        const y = L.height(x, z);
        if (y < 0.6) continue;
        const bamboo = bank < 30 || hash2(i, j, seed + 13) < 0.25;
        const s = bamboo ? 0.8 + hash2(i, j, seed + 14) * 0.5 : 0.7 + hash2(i, j, seed + 14) * 0.7;
        out.trees.push(
          bamboo ? BAMBOO : ROUND,
          x,
          y - 0.3,
          z,
          s,
          hash2(i, j, seed + 15) * Math.PI * 2,
          hash2(i, j, seed + 16),
        );
      }
    // Villages: whitewashed houses square to the river, a lantern by every door.
    const hc = 15;
    for (let j = Math.ceil(oz / hc); j < Math.ceil((oz + size) / hc); j++)
      for (let i = Math.ceil(ox / hc); i < Math.ceil((ox + size) / hc); i++) {
        const x = (i + 0.2 + hash2(i, j, seed + 21) * 0.6) * hc;
        const z = (j + 0.2 + hash2(i, j, seed + 22) * 0.6) * hc;
        L.river(x, z);
        if (L.village(x, z) < 0.5 || hash2(i, j, seed + 23) > 0.6) continue;
        const y = L.height(x, z);
        if (y - L.base(x, z) > 0.4) continue; // on a pillar's scree
        const yaw =
          L.riverHeading(x, z, 0) +
          (hash2(i, j, seed + 24) < 0.5 ? 0 : Math.PI / 2) +
          (hash2(i, j, seed + 25) - 0.5) * 0.2;
        const s = 0.85 + hash2(i, j, seed + 26) * 0.3;
        const two = hash2(i, j, seed + 27) < 0.3 ? 1 : 0;
        out.houses.push(x, y - 0.2, z, yaw, s, two);
        place(out.lanterns, x, y - 0.2, z, yaw, HOUSE_LANTERN, s, 0.9);
      }
    // Cormorant fishers' rafts out on the water, lying along the current.
    const rc = 64;
    for (let j = Math.ceil(oz / rc); j < Math.ceil((oz + size) / rc); j++)
      for (let i = Math.ceil(ox / rc); i < Math.ceil((ox + size) / rc); i++) {
        const x = (i + hash2(i, j, seed + 31)) * rc;
        const z = (j + hash2(i, j, seed + 32)) * rc;
        if (hash2(i, j, seed + 33) > 0.5) continue;
        const bank = L.river(x, z);
        if (bank > -L.rw * 0.35) continue;
        if (Math.hypot(x - L.spawn.x, z - L.spawn.z) < 60) continue;
        const yaw = L.riverHeading(x, z, hash2(i, j, seed + 34) * 7);
        out.rafts.push(x, z, yaw);
        place(out.lanterns, x, 0, z, yaw, RAFT_LANTERN, 1, 0.9);
      }
    return out;
  }

  /** A pillar's pines on the crown, shrubs on the walls, and maybe a pavilion on the summit. */
  private dress(pl: Pillar, out: KarstChunk): void {
    const sh = SHAPES[pl.shape];
    const rand = mulberry32(Math.floor(pl.seed * 1e9));
    const at = (t: number, a: number, inset: number, type: number, s: number) => {
      const r = pl.r * profile(sh, t) * inset;
      out.trees.push(
        type,
        pl.x + pl.lx * t * t + Math.sin(a) * r,
        pl.y0 + t * pl.h - 0.4,
        pl.z + pl.lz * t * t + Math.cos(a) * r,
        s,
        rand() * Math.PI * 2,
        rand(),
      );
    };
    // A pavilion keeps the very top clear for itself.
    const span = pl.pavilion ? 0.6 : 0.92;
    const pines = 3 + Math.floor(pl.r / 9);
    for (let k = 0; k < pines; k++)
      at(
        sh.cap + (1 - sh.cap) * span * rand(),
        rand() * Math.PI * 2,
        0.88,
        PINE,
        0.7 + rand() * 0.7,
      );
    // Shrubs clinging to the walls, set into the rock so they never float off the flutes.
    const shrubs = Math.floor(pl.h / 32);
    for (let k = 0; k < shrubs; k++)
      at(0.15 + (sh.cap - 0.2) * rand(), rand() * Math.PI * 2, 0.86, ROUND, 0.45 + rand() * 0.35);
    if (pl.pavilion) {
      const t = 0.975;
      const x = pl.x + pl.lx * t * t;
      const y = pl.y0 + pl.h * t - 0.5;
      const z = pl.z + pl.lz * t * t;
      out.pavilions.push(x, y, z, pl.yaw);
      for (const l of PAVILION_LANTERNS) place(out.lanterns, x, y, z, pl.yaw, l, 1, 1.2);
    }
  }

  rebuild(items: KarstChunk[], px: number, pz: number): void {
    const pc = this.pillars.map(() => 0);
    const fc = this.pillars.map(() => 0);
    const near2 = Config.karst.pillarLod ** 2;
    const hc = [0, 0];
    let rc = 0;
    let vc = 0;
    let lc = 0;
    this.treeLists.length = 0;
    for (const it of items) {
      this.treeLists.push(it.trees);
      for (const pl of it.pillars) {
        const near = (pl.x - px) ** 2 + (pl.z - pz) ** 2 < near2;
        const mesh = (near ? this.pillars : this.farPillars)[pl.shape];
        const counter = near ? pc : fc;
        const k = counter[pl.shape];
        if (k >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, pl.yaw);
        m.compose(p.set(pl.x, pl.y0, pl.z), q, sc.set(pl.r, pl.r * pl.k, pl.r));
        mesh.setMatrixAt(k, m);
        // Each pillar a slightly different stone: greyer, greener or warmer.
        const s = pl.seed;
        mesh.setColorAt(
          k,
          col.setRGB(0.9 + s * 0.14, 0.93 + (1 - s) * 0.1, 0.92 + ((s * 7) % 1) * 0.1),
        );
        counter[pl.shape]++;
      }
      const H = it.houses;
      for (let i = 0; i < H.length; i += 6) {
        const t = H[i + 5];
        const mesh = this.houses[t];
        if (hc[t] >= mesh.instanceMatrix.count) continue;
        q.setFromAxisAngle(up, H[i + 3]);
        const s = H[i + 4];
        m.compose(p.set(H[i], H[i + 1], H[i + 2]), q, sc.set(s, s, s));
        mesh.setMatrixAt(hc[t]++, m);
      }
      const R = it.rafts;
      for (let i = 0; i < R.length && rc < this.rafts.instanceMatrix.count; i += 3) {
        q.setFromAxisAngle(up, R[i + 2]);
        m.compose(p.set(R[i], 0, R[i + 1]), q, sc.set(1, 1, 1));
        this.rafts.setMatrixAt(rc++, m);
      }
      const V = it.pavilions;
      for (let i = 0; i < V.length && vc < this.pavilions.instanceMatrix.count; i += 4) {
        q.setFromAxisAngle(up, V[i + 3]);
        m.compose(p.set(V[i], V[i + 1], V[i + 2]), q, sc.set(1, 1, 1));
        this.pavilions.setMatrixAt(vc++, m);
      }
      const N = it.lanterns;
      for (let i = 0; i < N.length && lc < this.lanterns.instanceMatrix.count; i += 4) {
        const s = N[i + 3];
        m.makeScale(s, s, s).setPosition(N[i], N[i + 1], N[i + 2]);
        this.lanterns.setMatrixAt(lc++, m);
      }
    }
    const counts: [THREE.InstancedMesh, number][] = [
      ...this.pillars.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, pc[i]]),
      ...this.farPillars.map((mesh, i): [THREE.InstancedMesh, number] => [mesh, fc[i]]),
      [this.houses[0], hc[0]],
      [this.houses[1], hc[1]],
      [this.rafts, rc],
      [this.pavilions, vc],
      [this.lanterns, lc],
    ];
    for (const [mesh, n] of counts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
  }

  /** Lanterns: red paper by day, glowing warm as the light goes. */
  frame(day: DayCycle): void {
    const night = smoothstep(0.08, 0.6, day.palette.stars) * Config.karst.lanterns;
    this.lanternMaterial.color.copy(DAY_LANTERN).lerp(NIGHT_LANTERN, night);
  }

  dispose(): void {
    for (const mesh of [
      ...this.pillars,
      ...this.farPillars,
      ...this.houses,
      this.rafts,
      this.pavilions,
      this.lanterns,
    ]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
    this.lanternMaterial.dispose();
    this.trees.dispose();
  }
}
