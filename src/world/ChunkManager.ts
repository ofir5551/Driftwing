import * as THREE from 'three';
import { Config } from '../core/Config';
import { GroundCover, type CoverStyle } from './GroundCover';
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
  /**
   * Deferred scattering (props a chunk only needs once it is near), ahead of a rebuild: scatter
   * up to `budget` chunks and return true while more wait. The rebuild is held back until none
   * do, so new ground costs one chunk's scatter a frame instead of a row of them in one frame.
   */
  prepare?(items: T[], px: number, pz: number, budget: number): boolean;
  dispose?(): void;
}

/** A chunk record with its origin: what `nearestInReach` needs to see. */
export interface ChunkOrigin {
  ox: number;
  oz: number;
}

/**
 * The chunk nearest (px, pz) that is within `reach` (measured to its nearest point) and that
 * `needs` says still wants work; null if there is none. For a decor's `prepare`.
 */
export function nearestInReach<T extends ChunkOrigin>(
  items: readonly T[],
  px: number,
  pz: number,
  reach: number,
  needs: (c: T) => boolean,
): T | null {
  const size = Config.world.chunkSize;
  let best: T | null = null;
  let bestD = reach * reach;
  for (const c of items) {
    if (!needs(c)) continue;
    const dx = Math.max(0, Math.abs(c.ox + size / 2 - px) - size / 2);
    const dz = Math.max(0, Math.abs(c.oz + size / 2 - pz) - size / 2);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = c;
    }
  }
  return best;
}

export interface ChunkOptions<T> {
  decor: ChunkDecor<T>;
  color?: GroundColorFn;
  material?: THREE.Material;
  /** Allocate a chunk geometry (extra attributes) and fill them after the terrain pass. */
  createGeometry?: (res: number) => THREE.BufferGeometry;
  fillExtra?: (g: THREE.BufferGeometry, ox: number, oz: number, size: number, res: number) => void;
  /**
   * Terrain casts sun shadows. Default false; receiving is always on. The shadow map is a box
   * round the bird (Config.light.shadowRange): a tree's shadow fits inside it, a hill's does
   * not. In a low sun a hill's shadow is hundreds of metres long, and the map drew only the
   * part inside the box: a dark patch round the bird with lit land beyond it, unrolling over
   * the ground as the bird flew. The toon shading already darkens slopes turned from the sun.
   */
  castShadow?: boolean;
  /** Grass tufts (and flowers) on the near terrain: the level's opt-in to ground cover. */
  cover?: CoverStyle;
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
  /** The chunk being built, between its stages (see `advance`). */
  private job: { cx: number; cz: number; lod: number; mesh: THREE.Mesh; stage: number } | null =
    null;
  private lastCx = NaN;
  private lastCz = NaN;
  private lastDraw = 0;
  private decorDirty = false;
  private readonly decorItems: T[] = [];
  private readonly decor: ChunkDecor<T>;
  private readonly color: GroundColorFn;
  private readonly cover: GroundCover | null;

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
    this.cover = opts.cover ? new GroundCover(opts.cover, this.nearGeometry) : null;
    if (this.cover) this.group.add(this.cover.group);
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
    while (this.pending > 0 && performance.now() - t0 < budgetMs) this.advance();
    if (this.decorDirty && (this.pending === 0 || performance.now() - t0 < budgetMs))
      this.refreshDecor(px, pz, budgetMs === Infinity ? Infinity : 1);
    // One new chunk of cover per frame in flight; all of it behind the title (prime).
    this.cover?.update(px, pz, budgetMs === Infinity ? Infinity : 1);
  }

  private plan(px: number, pz: number): void {
    const size = Config.world.chunkSize;
    const draw = Config.render.drawDistance;
    const r = Math.ceil(draw / size);
    const ccx = Math.floor(px / size);
    const ccz = Math.floor(pz / size);
    const wanted = new Set<number>();
    this.queue.length = 0;
    // A half-built chunk may no longer be wanted (or wanted at another LOD): drop it. If it
    // still is, it is queued again below.
    if (this.job) {
      this.pools[this.job.lod].push(this.job.mesh);
      this.job = null;
    }
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

  /**
   * One stage of the nearest queued chunk: its terrain, then the level's extra attributes,
   * then its scenery and joining the scene. A chunk built in one go is the longest thing a
   * frame ever does (a level's height field and land painting are heavy); in stages, the
   * frame budget is checked between them, and a chunk shows only once it is whole.
   */
  private advance(): void {
    const size = Config.world.chunkSize;
    if (!this.job) {
      const next = this.queue.pop()!; // sorted far -> near, so pop() takes the nearest
      const res = next.lod === 0 ? Config.world.chunkRes : Config.world.farRes;
      const mesh =
        this.pools[next.lod].pop() ??
        new THREE.Mesh((this.opts.createGeometry ?? createChunkGeometry)(res), this.material);
      this.job = { cx: next.cx, cz: next.cz, lod: next.lod, mesh, stage: 0 };
    }
    const job = this.job;
    const { cx, cz, lod, mesh } = job;
    const res = lod === 0 ? Config.world.chunkRes : Config.world.farRes;
    const ox = cx * size;
    const oz = cz * size;
    const k = key(cx, cz);
    const stage = job.stage++;
    if (stage === 0) {
      mesh.userData.lod = lod;
      mesh.castShadow = this.opts.castShadow ?? false;
      mesh.receiveShadow = true;
      fillChunkGeometry(mesh.geometry, this.field, ox, oz, size, res, this.color);
      if (this.opts.fillExtra) return;
      job.stage++;
    }
    if (stage <= 1) {
      this.opts.fillExtra?.(mesh.geometry, ox, oz, size, res);
      // A chunk changing LOD keeps its scenery: nothing more to make.
      if (!this.chunks.has(k)) return;
    }
    mesh.position.set(ox, 0, oz);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    const old = this.chunks.get(k);
    if (old) {
      this.release(old);
      old.mesh = mesh;
      old.lod = lod;
    } else {
      this.chunks.set(k, { cx, cz, lod, mesh, decor: this.decor.scatter(ox, oz, size) });
    }
    this.job = null;
    this.decorDirty = true;
  }

  private release(c: Chunk<T>): void {
    this.group.remove(c.mesh);
    this.pools[c.mesh.userData.lod as number].push(c.mesh);
  }

  private refreshDecor(px: number, pz: number, scatterBudget: number): void {
    this.decorItems.length = 0;
    for (const c of this.chunks.values()) this.decorItems.push(c.decor);
    // Still scattering: stay dirty and come back next frame.
    if (this.decor.prepare?.(this.decorItems, px, pz, scatterBudget)) return;
    this.decorDirty = false;
    this.decor.rebuild(this.decorItems, px, pz);
  }

  /** The near-LOD geometry of chunk (cx, cz) once built: the lattice ground cover grows on. */
  private readonly nearGeometry = (cx: number, cz: number): THREE.BufferGeometry | null => {
    const c = this.chunks.get(key(cx, cz));
    return c && c.lod === 0 ? c.mesh.geometry : null;
  };

  get pending(): number {
    return this.queue.length + (this.job ? 1 : 0);
  }

  get count(): number {
    return this.chunks.size;
  }

  /** Free GPU memory: chunk geometries (pooled and live), the shared material, the decor. */
  dispose(): void {
    const geos = new Set<THREE.BufferGeometry>();
    for (const c of this.chunks.values()) geos.add(c.mesh.geometry);
    for (const pool of this.pools) for (const m of pool) geos.add(m.geometry);
    if (this.job) geos.add(this.job.mesh.geometry);
    this.job = null;
    for (const g of geos) g.dispose();
    this.chunks.clear();
    this.material.dispose();
    this.decor.dispose?.();
    this.cover?.dispose();
  }
}
