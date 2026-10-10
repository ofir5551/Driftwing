import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../core/Config';
import { getToonGradient, type HeightField } from './Terrain';
import { hash2, mulberry32 } from './noise';
import { pineGeometry, roundTreeGeometry } from './Trees';

export interface Island {
  x: number;
  y: number; // top surface height
  z: number;
  r: number; // top radius
  depth: number; // how far the rock hangs below the top
  mesh: THREE.Mesh | null;
}

const CELL = 560;

/** One island shape: a grassy cap on a jagged hanging rock, with a couple of trees. */
function islandGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const paint = (g: THREE.BufferGeometry, top: string, bottom: string, split: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const pos = ng.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const a = new THREE.Color(top);
    const b = new THREE.Color(bottom);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.lerpColors(b, a, THREE.MathUtils.smoothstep(pos.getY(i), split - 0.6, split + 0.1));
      col.set([c.r, c.g, c.b], i * 3);
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ng.deleteAttribute('uv');
    ng.computeVertexNormals();
    return ng;
  };
  // Rock: an inverted cone with jittered vertices for a hand-carved look.
  const rock = new THREE.ConeGeometry(1, 1.6, 11, 4, false);
  rock.rotateX(Math.PI);
  rock.translate(0, -0.8, 0);
  const rp = rock.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const y = rp.getY(i);
    if (y > -0.01) continue; // keep the rim flat so the cap sits cleanly
    const j = 0.32 * (1 + y * 0.25);
    rp.setXYZ(
      i,
      rp.getX(i) * (1 + (rand() - 0.5) * j * 2),
      y * (1 + (rand() - 0.5) * 0.25),
      rp.getZ(i) * (1 + (rand() - 0.5) * j * 2),
    );
  }
  const cap = new THREE.CylinderGeometry(1.06, 1.0, 0.18, 9, 1);
  cap.translate(0, 0.06, 0);
  const parts = [paint(rock, '#b9a2b8', '#7f6f8f', -0.1), paint(cap, '#a8d17d', '#a8d17d', 0)];
  const trees = 1 + Math.floor(rand() * 3);
  for (let t = 0; t < trees; t++) {
    const g = (rand() < 0.5 ? pineGeometry() : roundTreeGeometry()).clone();
    const s = 0.035 + rand() * 0.02;
    g.scale(s, s, s);
    const ang = rand() * Math.PI * 2;
    const rad = rand() * 0.6;
    g.translate(Math.cos(ang) * rad, 0.12, Math.sin(ang) * rad);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

/**
 * Sparse floating islands on a coarse grid. Deterministic per cell, pooled meshes, and a soft
 * ellipsoid push so the bird glances off them instead of clipping through.
 */
export class Islands {
  readonly group = new THREE.Group();
  readonly active: Island[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly pool: THREE.Mesh[] = [];
  private readonly material: THREE.MeshToonMaterial;
  private lastCx = NaN;
  private lastCz = NaN;

  constructor(private readonly field: HeightField) {
    this.material = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonGradient(),
    });
    for (let i = 0; i < 4; i++) this.geometries.push(islandGeometry(Config.world.seed + i * 7));
  }

  /** Island for a grid cell, or null. Pure function of the seed, so islands never move. */
  private islandAt(i: number, j: number): Island | null {
    const seed = Config.world.seed;
    if (hash2(i, j, seed + 40) > 0.45 || (i === 0 && j === 0)) return null;
    const x = (i + 0.2 + hash2(i, j, seed + 41) * 0.6) * CELL;
    const z = (j + 0.2 + hash2(i, j, seed + 42) * 0.6) * CELL;
    const ground = Math.max(this.field.height(x, z), Config.world.waterLevel);
    const r = 16 + hash2(i, j, seed + 43) * 22;
    const y = Math.min(ground + 60 + hash2(i, j, seed + 44) * 70, Config.flight.maxAltitude - 25);
    return { x, y, z, r, depth: r * 1.6, mesh: null };
  }

  update(px: number, pz: number): void {
    const cx = Math.floor(px / CELL);
    const cz = Math.floor(pz / CELL);
    if (cx === this.lastCx && cz === this.lastCz) return;
    this.lastCx = cx;
    this.lastCz = cz;
    for (const isl of this.active) {
      if (isl.mesh) {
        this.group.remove(isl.mesh);
        this.pool.push(isl.mesh);
      }
    }
    this.active.length = 0;
    const r = Math.ceil(Config.render.drawDistance / CELL);
    for (let j = cz - r; j <= cz + r; j++)
      for (let i = cx - r; i <= cx + r; i++) {
        const isl = this.islandAt(i, j);
        if (!isl) continue;
        const geo = this.geometries[Math.floor(hash2(i, j, 77) * this.geometries.length)];
        const mesh = this.pool.pop() ?? new THREE.Mesh(geo, this.material);
        mesh.geometry = geo;
        mesh.position.set(isl.x, isl.y, isl.z);
        mesh.scale.set(isl.r, isl.r, isl.r);
        mesh.rotation.y = hash2(i, j, 78) * Math.PI * 2;
        isl.mesh = mesh;
        this.group.add(mesh);
        this.active.push(isl);
      }
  }

  /**
   * Soft push out of any island the point is inside. Returns how far it pushed (0 = none) and
   * writes the corrected position into `p`.
   */
  push(p: { x: number; y: number; z: number }, clearance: number): number {
    for (const isl of this.active) {
      const dx = p.x - isl.x;
      const dz = p.z - isl.z;
      const horiz = Math.hypot(dx, dz);
      const R = isl.r * 1.02 + clearance;
      if (horiz > R) continue;
      const top = isl.y + 0.2 * isl.r + clearance;
      // The rock tapers toward its tip: allowed radius shrinks with depth below the top.
      const below = isl.y - p.y;
      if (p.y > top || below > isl.depth) continue;
      const allowed = below <= 0 ? R : R * (1 - below / isl.depth);
      if (horiz > allowed) continue;
      // Leave through the nearest face: up onto the cap, or sideways off the rock.
      const upDist = top - p.y;
      const sideDist = allowed - horiz;
      if (upDist < sideDist || horiz < 1e-3) {
        p.y = top;
        return upDist;
      }
      p.x = isl.x + (dx / horiz) * allowed;
      p.z = isl.z + (dz / horiz) * allowed;
      return sideDist;
    }
    return 0;
  }
}
