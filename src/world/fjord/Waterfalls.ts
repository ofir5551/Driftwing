import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { FjordLayout } from './FjordLayout';
import type { Fall } from './FjordSites';
import { fallMaterial, sprayMaterial } from './materials';

/** Points down a strand: on the wall from the lip to the foot, then the stream to the water. */
const WALL = 22;
const STREAM = 6;
const PTS = WALL + STREAM + 1;
/** Floats per point in a strand's cached path: x, y, z, half width, way (0..1), across x, z. */
const PS = 7;
const MAX_STRANDS = 40;
const PUFFS = 7;

/**
 * Where a strand of a waterfall runs (pure; cached per fall): sampled down the line from the
 * lip to the wall's foot, held off the rock toward the water by how steep it is there (so it
 * hangs in front of the face, never inside it), then across the strand to the water's edge as
 * a stream lying on the ground. `strand` -1, 0 or 1 offsets it along the wall.
 */
export function strandPath(L: FjordLayout, f: Fall, strand: number, out: Float32Array): void {
  const ux = -f.nz;
  const uz = f.nx;
  const hw = f.strands > 1 ? f.w * 0.3 : f.w * 0.5;
  const shift = strand * f.w * 0.55;
  for (let k = 0; k < PTS; k++) {
    const onWall = k <= WALL;
    const t = onWall ? k / WALL : (k - WALL) / STREAM;
    let x: number;
    let z: number;
    if (onWall) {
      x = f.x0 + (f.x1 - f.x0) * t + ux * shift;
      z = f.z0 + (f.z1 - f.z0) * t + uz * shift;
    } else {
      // The stream gathers its strands as it crosses the strand.
      const s = shift * (1 - t) * 0.6;
      x = f.x1 + (f.x2 - f.x1) * t + ux * s;
      z = f.z1 + (f.z2 - f.z1) * t + uz * s;
    }
    const e = 1.5;
    const y = L.height(x, z);
    const g =
      Math.hypot(L.height(x + e, z) - L.height(x - e, z), L.height(x, z + e) - L.height(x, z - e)) /
      (2 * e);
    const off = onWall ? 2.2 * Math.min(g, 1.5) : 0;
    const o = k * PS;
    out[o] = x - f.nx * off;
    out[o + 1] = y + (onWall ? 0.4 : 0.18);
    out[o + 2] = z - f.nz * off;
    // Wider as it falls and spreads, a narrow stream on the strand.
    out[o + 3] = onWall ? hw * (0.7 + 0.6 * t) : Math.max(1.4, hw * 0.45) * (1 - 0.3 * t);
    out[o + 4] = onWall ? t * 0.86 : 0.86 + t * 0.14;
    out[o + 5] = ux;
    out[o + 6] = uz;
  }
}

/**
 * The waterfalls round the bird: one ribbon draw for every strand (positions, uv and the way
 * down written into preallocated buffers whenever the chunk set changes) and one instanced
 * draw of spray puffs at their feet. Paths are computed once per fall and cached.
 */
export class Waterfalls {
  readonly group = new THREE.Group();
  private readonly ribbon: THREE.Mesh;
  private readonly spray: THREE.InstancedMesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly uv: THREE.BufferAttribute;
  private readonly way: THREE.BufferAttribute;
  private readonly paths = new Map<Fall, Float32Array[]>();
  private readonly m = new THREE.Matrix4();
  private ns = 0;
  private np = 0;

  constructor(private readonly L: FjordLayout) {
    const g = new THREE.BufferGeometry();
    const nv = MAX_STRANDS * PTS * 2;
    this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    this.uv = new THREE.BufferAttribute(new Float32Array(nv * 2), 2);
    this.way = new THREE.BufferAttribute(new Float32Array(nv * 2), 2);
    for (const a of [this.pos, this.uv, this.way]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('uv', this.uv);
    g.setAttribute('aFall', this.way);
    const idx = new Uint32Array(MAX_STRANDS * (PTS - 1) * 6);
    let w = 0;
    for (let s = 0; s < MAX_STRANDS; s++)
      for (let k = 0; k < PTS - 1; k++) {
        const a = (s * PTS + k) * 2;
        idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], w);
        w += 6;
      }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.ribbon = new THREE.Mesh(g, fallMaterial());
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 2;
    this.ribbon.name = 'waterfalls';
    this.spray = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      sprayMaterial(),
      MAX_STRANDS * PUFFS,
    );
    this.spray.count = 0;
    this.spray.frustumCulled = false;
    this.spray.renderOrder = 3;
    this.spray.name = 'waterfall-spray';
    this.group.add(this.ribbon, this.spray);
  }

  /** Start a refill. */
  begin(): void {
    this.ns = 0;
    this.np = 0;
  }

  /** Add a fall's strands and its spray. */
  add(f: Fall): void {
    let list = this.paths.get(f);
    if (!list) {
      list = [];
      const strands = f.strands > 1 ? [-1, 1] : [0];
      for (const s of strands) {
        const p = new Float32Array(PTS * PS);
        strandPath(this.L, f, s, p);
        list.push(p);
      }
      if (this.paths.size > 200) this.paths.clear();
      this.paths.set(f, list);
    }
    const P = this.pos.array as Float32Array;
    const U = this.uv.array as Float32Array;
    const W = this.way.array as Float32Array;
    for (const p of list) {
      if (this.ns >= MAX_STRANDS) return;
      let along = 0;
      for (let k = 0; k < PTS; k++) {
        const o = k * PS;
        if (k > 0)
          along += Math.hypot(p[o] - p[o - PS], p[o + 1] - p[o + 1 - PS], p[o + 2] - p[o + 2 - PS]);
        const v = (this.ns * PTS + k) * 2;
        const hw = p[o + 3];
        for (let side = 0; side < 2; side++) {
          const sgn = side ? 1 : -1;
          P[(v + side) * 3] = p[o] + p[o + 5] * hw * sgn;
          P[(v + side) * 3 + 1] = p[o + 1];
          P[(v + side) * 3 + 2] = p[o + 2] + p[o + 6] * hw * sgn;
          U[(v + side) * 2] = side;
          U[(v + side) * 2 + 1] = along;
          W[(v + side) * 2] = p[o + 4];
        }
      }
      // Spray billows at the foot, where the fall meets the strand.
      const o = WALL * PS;
      for (let q = 0; q < PUFFS && this.np < this.spray.instanceMatrix.count; q++) {
        const a = q * 2.4 + this.ns;
        const r = (q / PUFFS) * p[o + 3] * 1.2;
        const s = 3 + (q % 3) * 1.6 + p[o + 3] * 0.4;
        this.m
          .makeScale(s, s, s)
          .setPosition(p[o] + Math.sin(a) * r, p[o + 1] + 1, p[o + 2] + Math.cos(a) * r);
        this.spray.setMatrixAt(this.np++, this.m);
      }
      this.ns++;
    }
  }

  end(): void {
    this.ribbon.geometry.setDrawRange(0, this.ns * (PTS - 1) * 6);
    for (const a of [this.pos, this.uv, this.way]) a.needsUpdate = true;
    this.spray.count = this.np;
    this.spray.instanceMatrix.needsUpdate = true;
    this.ribbon.visible = this.ns > 0 && Config.fjord.falls > 0;
    this.spray.visible = this.ribbon.visible;
  }

  dispose(): void {
    this.ribbon.geometry.dispose();
    (this.ribbon.material as THREE.Material).dispose();
    this.spray.geometry.dispose();
    (this.spray.material as THREE.Material).dispose();
    this.spray.dispose();
  }
}
