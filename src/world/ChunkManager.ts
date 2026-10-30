import * as THREE from 'three';
import { Config } from '../core/Config';
import { withGroundDetail } from './GroundDetail';
import {
  createChunkGeometry,
  fillChunkGeometry,
  getToonGradient,
  groundColor,
  type GroundColorFn,
  type HeightField,
} from './Terrain';

/**
 * Scenery scattered per chunk (trees, buildings). `scatter` runs once when a chunk is first
 * built and returns whatever the decor needs; `rebuild` refills the global instanced meshes
 * from every live chunk's data whenever the set of chunks changes.
 */
export interface ChunkDecor<T> {
  readonly group: THREE.Object3D;
  scatter(ox: number, oz: number, size: number): T;
  rebuild(items: T[], px: number, pz: number): void;
  dispose?(): void;
}

export interface ChunkOptions<T> {
  decor: ChunkDecor<T>;
  color?: GroundColorFn;
  material?: THREE.Material;
  /** Allocate a chunk geometry (extra attributes) and fill them after the terrain pass. */
  createGeometry?: (res: number) => THREE.BufferGeometry;
  fillExtra?: (g: THREE.BufferGeometry, ox: number, oz: number, size: number, res: number) => void;
}

interface Chunk<T> {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh;
  decor: T;
}

/** Numeric key (no string allocation): chunk coords are far below +-2^20 in any real session. */
const key = (cx: number, cz: number) => (cx + 0x80000) * 0x100000 + (cz + 0x80000);

/**
 * Streams terrain chunks around the player from a pool. Two LODs: dense near the bird where
 * the shape matters, coarse in the fog. Building is time-sliced (Config.world.buildBudgetMs)
 * nearest-first, and a chunk changing LOD keeps its old mesh until the new one is ready, so
 * there are never holes.
 */
export class ChunkManager<T> {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk<T>>();
  private readonly pools: THREE.Mesh[][] = [[], []];
  private readonly material: THREE.Material;
  private readonly queue: { cx: number; cz: number; lod: number; d: number }[] = [];
  private lastCx = NaN;
  private lastCz = NaN;
  private lastDraw = 0;
  private decorDirty = false;
  private readonly decorItems: T[] = [];
  private readonly decor: ChunkDecor<T>;
  private readonly color: GroundColorFn;

  constructor(
    private readonly field: HeightField,
    private readonly opts: ChunkOptions<T>,
  ) {
    this.decor = opts.decor;
    this.color = opts.color ?? groundColor;
    this.material =
      opts.material ??
      withGroundDetail(
        new THREE.MeshToonMaterial({
          vertexColors: true,
          gradientMap: getToonGradient(),
        }),
      );
    this.group.add(this.decor.group);
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
      this.decorDirty = true;
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const job = this.queue.pop()!; // sorted far -> near, so pop() takes the nearest
      this.build(job.cx, job.cz, job.lod);
      this.decorDirty = true;
    }
    if (this.decorDirty && this.queue.length === 0) this.refreshDecor(px, pz);
    else if (this.decorDirty && performance.now() - t0 < budgetMs) this.refreshDecor(px, pz);
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
    const ox = cx * size;
    const oz = cz * size;
    const mesh =
      this.pools[lod].pop() ??
      new THREE.Mesh((this.opts.createGeometry ?? createChunkGeometry)(res), this.material);
    mesh.userData.lod = lod;
    fillChunkGeometry(mesh.geometry, this.field, ox, oz, size, res, this.color);
    this.opts.fillExtra?.(mesh.geometry, ox, oz, size, res);
    mesh.position.set(ox, 0, oz);
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
      this.chunks.set(k, { cx, cz, lod, mesh, decor: this.decor.scatter(ox, oz, size) });
    }
  }

  private release(c: Chunk<T>): void {
    this.group.remove(c.mesh);
    this.pools[c.mesh.userData.lod as number].push(c.mesh);
  }

  private refreshDecor(px: number, pz: number): void {
    this.decorDirty = false;
    this.decorItems.length = 0;
    for (const c of this.chunks.values()) this.decorItems.push(c.decor);
    this.decor.rebuild(this.decorItems, px, pz);
  }

  get pending(): number {
    return this.queue.length;
  }

  get count(): number {
    return this.chunks.size;
  }

  /** Free GPU memory: chunk geometries (pooled and live), the shared material, the decor. */
  dispose(): void {
    const geos = new Set<THREE.BufferGeometry>();
    for (const c of this.chunks.values()) geos.add(c.mesh.geometry);
    for (const pool of this.pools) for (const m of pool) geos.add(m.geometry);
    for (const g of geos) g.dispose();
    this.chunks.clear();
    this.material.dispose();
    this.decor.dispose?.();
  }
}
