import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../core/Config';
import { withGroundDetail } from './GroundDetail';
import { getToonGradient, type HeightField } from './Terrain';
import { hash2, mulberry32 } from './noise';
import { smoothstep } from '../core/math';
import { colored, jitter, painted, pineDetailGeometry, roundTreeDetailGeometry } from './Trees';

export interface Island {
  x: number;
  y: number; // top surface height
  z: number;
  r: number; // top radius
  depth: number; // how far the rock hangs below the top
  mesh: THREE.Mesh | null;
}

const CELL = 560;

const ROCK_LIGHT = new THREE.Color('#c2abbf');
const ROCK_DARK = new THREE.Color('#7a6a8b');
const ROCK_WARM = new THREE.Color('#c9a99a');
const GRASS = new THREE.Color('#a8d17d');
const GRASS_EDGE = new THREE.Color('#86b866');
const VINE = new THREE.Color('#5f8f5c');

/**
 * One island shape (unit top radius): a grassy cap whose turf spills over the lip, on a jagged
 * hanging rock banded in warm and cool strata that darken toward the tip, with vines trailing
 * from the rim, a few boulders and two or three trees on top. Islands are few, so they can
 * afford the detailed tree shapes.
 */
function islandGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const phase = rand() * 10;
  // Rock: an inverted cone with jittered vertices for a hand-carved look.
  const rock = new THREE.ConeGeometry(1, 1.6, 16, 7, false);
  rock.rotateX(Math.PI);
  rock.translate(0, -0.8, 0);
  const rp = rock.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const y = rp.getY(i);
    if (y > -0.01) continue; // keep the rim flat so the cap sits cleanly
    const j = 0.26 * (1 + y * 0.25);
    rp.setXYZ(
      i,
      rp.getX(i) * (1 + (rand() - 0.5) * j * 2),
      y * (1 + (rand() - 0.5) * 0.12),
      rp.getZ(i) * (1 + (rand() - 0.5) * j * 2),
    );
  }
  const rockPainted = painted(rock, (x, y, z, out) => {
    // Strata: wavy horizontal layers alternating warm and cool, the turf dripping over the lip.
    const band = Math.sin(y * 6.5 + Math.sin(Math.atan2(z, x) * 3 + phase) * 1.2);
    out.copy(ROCK_DARK).lerp(ROCK_LIGHT, smoothstep(-1.5, -0.1, y));
    out.lerp(ROCK_WARM, smoothstep(0.1, 0.8, band) * 0.7);
    out.multiplyScalar(1 - smoothstep(0.4, 1, -band) * 0.2);
    const drip = -0.12 - 0.1 * (0.5 + 0.5 * Math.sin(Math.atan2(z, x) * 5 + phase));
    out.lerp(GRASS_EDGE, smoothstep(drip - 0.05, drip + 0.05, y));
  });
  const cap = painted(
    new THREE.CylinderGeometry(1.06, 1.0, 0.18, 16, 1),
    (x, y, z, out) =>
      out
        .copy(GRASS_EDGE)
        .lerp(GRASS, smoothstep(0.85, 0.6, Math.hypot(x, z)) * 0.6 + smoothstep(0, 0.09, y) * 0.4),
    0.06,
  );
  const parts = [rockPainted, cap];
  // Vines: thin tapering strands hanging from the rim, longer where the rock overhangs most.
  const vines = 5 + Math.floor(rand() * 4);
  for (let v = 0; v < vines; v++) {
    const a = rand() * Math.PI * 2;
    const len = 0.25 + rand() * 0.45;
    const g = new THREE.ConeGeometry(0.035, len, 3).rotateX(Math.PI).translate(0, -len / 2, 0);
    parts.push(
      colored(g, VINE.getStyle(), -0.04).translate(Math.cos(a) * 0.97, 0, Math.sin(a) * 0.97),
    );
  }
  // Boulders on the turf.
  for (let b = 0; b < 2 + Math.floor(rand() * 3); b++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.7;
    const s = 0.05 + rand() * 0.06;
    const g = jitter(new THREE.IcosahedronGeometry(s, 0), s * 0.5, seed + b).scale(1, 0.7, 1);
    parts.push(
      colored(g, '#b4a4b5', 0.15 + s * 0.3).translate(Math.cos(a) * r, 0, Math.sin(a) * r),
    );
  }
  const trees = 2 + Math.floor(rand() * 2);
  for (let t = 0; t < trees; t++) {
    const g = rand() < 0.5 ? pineDetailGeometry() : roundTreeDetailGeometry();
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
    // The terrain's painted detail gives the rock its strata and dabs of light too.
    this.material = withGroundDetail(
      new THREE.MeshToonMaterial({
        vertexColors: true,
        gradientMap: getToonGradient(),
      }),
    );
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

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
