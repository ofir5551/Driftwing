import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { CityLayout } from './CityLayout';
import { carGeometry, ferryGeometry, tramGeometry } from './shapes';
import { MAX_VEHICLES, TrafficPlan, VEHICLE_STRIDE } from './traffic';

/** Car paint (sRGB): white, silver, black, red, navy, a yellow and a green taxi, sky blue. */
const CARS = [
  '#f4f4f2',
  '#f4f4f2',
  '#b9bec6',
  '#2b2d33',
  '#c8423a',
  '#2f4f7f',
  '#f2c94a',
  '#2f6a4f',
  '#8fbcd8',
].map((h) => new THREE.Color(h));
const TRAMS = ['#7fae6a', '#e0a33a', '#d8d2c2'].map((h) => new THREE.Color(h));
const BOATS = ['#ffffff', '#f2ece0', '#e4eef6'].map((h) => new THREE.Color(h));
const PALETTES = [CARS, TRAMS, BOATS];
/** Instances per vehicle kind. */
const CAP = [1600, 60, 60];

/**
 * Neon Bay's moving traffic: one instanced mesh per vehicle kind (car, tram, ferry; a water
 * taxi is a small ferry), placed every frame from the pure TrafficPlan into preallocated
 * instance buffers. Lanes are replanned when the bird has flown a chunk from the last plan
 * or the preset's distances change. Cars run within smallPropDistance, boats within
 * propDistance; low has none.
 */
export class CityTraffic {
  readonly group = new THREE.Group();
  readonly plan: TrafficPlan;
  private readonly meshes: THREE.InstancedMesh[];
  private readonly out = new Float32Array(MAX_VEHICLES * VEHICLE_STRIDE);
  private readonly n = [0, 0, 0];
  private px = NaN;
  private pz = NaN;
  private roads = -1;
  private water = -1;

  constructor(layout: CityLayout, material: THREE.Material) {
    this.plan = new TrafficPlan(layout);
    this.meshes = [carGeometry(), tramGeometry(), ferryGeometry()].map((g, k) => {
      const m = new THREE.InstancedMesh(g, material, CAP[k]);
      m.count = 0;
      m.frustumCulled = false;
      m.name = `city-traffic-${['car', 'tram', 'ferry'][k]}`;
      m.setColorAt(0, CARS[0]);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      return m;
    });
    this.group.add(...this.meshes);
  }

  /** Replan the lanes if the bird has flown off or the preset changed. */
  update(px: number, pz: number): void {
    const R = Config.render;
    const roads = R.smallPropDistance;
    const water = R.propDistance;
    const pad = Config.world.chunkSize;
    if (
      roads === this.roads &&
      water === this.water &&
      (px - this.px) ** 2 + (pz - this.pz) ** 2 < pad * pad
    )
      return;
    this.px = px;
    this.pz = pz;
    this.roads = roads;
    this.water = water;
    this.plan.plan(px, pz, roads, water, pad * 1.2);
  }

  /** Place every vehicle near (px, pz) at time t. */
  frame(t: number, px: number, pz: number): void {
    const out = this.out;
    const count = this.plan.place(t, px, pz, this.roads, this.water, out);
    const n = this.n;
    n.fill(0);
    for (let v = 0; v < count; v++) {
      const w = v * VEHICLE_STRIDE;
      const kind = out[w];
      const mesh = this.meshes[kind];
      const i = n[kind];
      if (i >= mesh.instanceMatrix.count) continue;
      n[kind] = i + 1;
      const s = out[w + 5];
      const c = Math.cos(out[w + 4]) * s;
      const sn = Math.sin(out[w + 4]) * s;
      // Boats ride the swell a little.
      const y = kind === 2 ? out[w + 2] + Math.sin(t * 1.3 + out[w + 1] * 0.05) * 0.12 : out[w + 2];
      const M = mesh.instanceMatrix.array as Float32Array;
      const o = i * 16;
      M[o] = c;
      M[o + 1] = 0;
      M[o + 2] = -sn;
      M[o + 3] = 0;
      M[o + 4] = 0;
      M[o + 5] = s;
      M[o + 6] = 0;
      M[o + 7] = 0;
      M[o + 8] = sn;
      M[o + 9] = 0;
      M[o + 10] = c;
      M[o + 11] = 0;
      M[o + 12] = out[w + 1];
      M[o + 13] = y;
      M[o + 14] = out[w + 3];
      M[o + 15] = 1;
      const pal = PALETTES[kind];
      const col = pal[Math.floor(out[w + 6] * pal.length) % pal.length];
      const C = mesh.instanceColor!.array as Float32Array;
      C[i * 3] = col.r;
      C[i * 3 + 1] = col.g;
      C[i * 3 + 2] = col.b;
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k];
      mesh.count = n[k];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** Vehicles drawn per kind (debug / tests). */
  get counts(): readonly number[] {
    return this.n;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}
