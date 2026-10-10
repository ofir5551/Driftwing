import * as THREE from 'three';
import { Config } from '../core/Config';
import {
  createChunkGeometry,
  fillChunkGeometry,
  getToonGradient,
  type HeightField,
} from './Terrain';
import { scatterTrees, Trees } from './Trees';

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh;
  trees: number[];
}

/** Numeric key (no string allocation): chunk coords are far below +-2^20 in any real session. */
const key = (cx: number, cz: number) => (cx + 0x80000) * 0x100000 + (cz + 0x80000);

/**
 * Streams terrain chunks around the player from a pool. Two LODs: dense near the bird where
 * the shape matters, coarse in the fog. Building is time-sliced (Config.world.buildBudgetMs)
 * nearest-first, and a chunk changing LOD keeps its old mesh until the new one is ready, so
 * there are never holes.
 */
export class ChunkManager {
  readonly group = new THREE.Group();
  readonly trees = new Trees();
  private readonly chunks = new Map<number, Chunk>();
  private readonly pools: THREE.Mesh[][] = [[], []];
  private readonly material: THREE.MeshToonMaterial;
  private readonly queue: { cx: number; cz: number; lod: number; d: number }[] = [];
  private lastCx = NaN;
  private lastCz = NaN;
  private lastDraw = 0;
  private treesDirty = false;
  private readonly treeLists: number[][] = [];

  constructor(private readonly field: HeightField) {
    this.material = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonGradient(),
    });
    this.group.add(this.trees.group);
  }

  /** Synchronously build everything near the player (used behind the start screen). */
  prime(px: number, pz: number): void {
    this.update(px, pz, Infinity);
  }

  update(px: number, pz: number, budgetMs = Config.world.buildBudgetMs): void {
    const size = Config.world.chunkSize;
    const cx = Math.floor(px / size);
    const cz = Math.floor(pz / size);
    if (cx !== this.lastCx || cz !== this.lastCz || Config.render.drawDistance !== this.lastDraw) {
      this.lastCx = cx;
      this.lastCz = cz;
      this.lastDraw = Config.render.drawDistance;
      this.plan(px, pz);
      this.treesDirty = true;
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const job = this.queue.pop()!; // sorted far -> near, so pop() takes the nearest
      this.build(job.cx, job.cz, job.lod);
      this.treesDirty = true;
    }
    if (this.treesDirty && this.queue.length === 0) this.refreshTrees(px, pz);
    else if (this.treesDirty && performance.now() - t0 < budgetMs) this.refreshTrees(px, pz);
  }

  private plan(px: number, pz: number): void {
    const size = Config.world.chunkSize;
    const draw = Config.render.drawDistance;
    const r = Math.ceil(draw / size);
    const ccx = Math.floor(px / size);
    const ccz = Math.floor(pz / size);
    const wanted = new Set<number>();
    this.queue.length = 0;
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        const x = ccx + i;
        const z = ccz + j;
        // Distance from the player to the chunk's nearest point decides visibility and LOD.
        const nx = Math.max(x * size, Math.min(px, (x + 1) * size));
        const nz = Math.max(z * size, Math.min(pz, (z + 1) * size));
        const d = Math.hypot(nx - px, nz - pz);
        if (d > draw) continue;
        const k = key(x, z);
        wanted.add(k);
        const lod = d < Config.world.lodDistance ? 0 : 1;
        const existing = this.chunks.get(k);
        if (!existing || existing.lod !== lod) this.queue.push({ cx: x, cz: z, lod, d });
      }
    this.queue.sort((a, b) => b.d - a.d);
    for (const [k, c] of this.chunks) {
      if (!wanted.has(k)) {
        this.release(c);
        this.chunks.delete(k);
      }
    }
  }

  private build(cx: number, cz: number, lod: number): void {
    const size = Config.world.chunkSize;
    const res = lod === 0 ? Config.world.chunkRes : Config.world.farRes;
    const mesh = this.pools[lod].pop() ?? new THREE.Mesh(createChunkGeometry(res), this.material);
    mesh.userData.lod = lod;
    fillChunkGeometry(mesh.geometry, this.field, cx * size, cz * size, size, res);
    mesh.position.set(cx * size, 0, cz * size);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    const k = key(cx, cz);
    const old = this.chunks.get(k);
    if (old) {
      this.release(old);
      old.mesh = mesh;
      old.lod = lod;
    } else {
      const trees: number[] = [];
      scatterTrees(this.field, cx * size, cz * size, size, trees);
      this.chunks.set(k, { cx, cz, lod, mesh, trees });
    }
  }

  private release(c: Chunk): void {
    this.group.remove(c.mesh);
    this.pools[c.mesh.userData.lod as number].push(c.mesh);
  }

  private refreshTrees(px: number, pz: number): void {
    this.treesDirty = false;
    this.treeLists.length = 0;
    for (const c of this.chunks.values()) this.treeLists.push(c.trees);
    this.trees.rebuild(this.treeLists, px, pz, Config.render.treeDistance);
  }

  get pending(): number {
    return this.queue.length;
  }

  get count(): number {
    return this.chunks.size;
  }
}
