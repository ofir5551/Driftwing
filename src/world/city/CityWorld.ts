import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { World } from '../../levels/World';
import type { FlightInput, FlightState } from '../../player/FlightModel';
import { ChunkManager } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { createChunkGeometry, type HeightField } from '../Terrain';
import { createNoise2D } from '../noise';
import { CityDecor, type CityChunk } from './CityDecor';
import { BK, CityLayout, ZONE_AVENUE, ZONE_STREET } from './CityLayout';
import { CityPlanner } from './CityWisps';
import { avoidSolids, glanceOffWall } from './collide';
import { createCityUniforms, createGroundMaterial, type CityUniforms } from './materials';

const C = {
  seabed: new THREE.Color('#4f6d78'),
  shallows: new THREE.Color('#7d9a9c'),
  road: new THREE.Color('#6d6874'),
  pave: new THREE.Color('#b5ada8'),
  yard: new THREE.Color('#a8a196'),
  grass: new THREE.Color('#93be74'),
  grassDeep: new THREE.Color('#78a868'),
  gravel: new THREE.Color('#d8cfbd'),
  path: new THREE.Color('#ece4d4'),
  plaza: new THREE.Color('#cbc3ba'),
  quay: new THREE.Color('#bdb6ab'),
};

/** The bay city as a World: streamed ground + instanced buildings, solid walls, avenue wisps. */
export class CityWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: CityLayout;
  readonly planner: CityPlanner;
  private readonly uniforms: CityUniforms;
  private readonly chunks: ChunkManager<CityChunk>;
  readonly decor: CityDecor;
  private readonly n = { x: 0, y: 0, z: 0 };
  private readonly block = { bi: 0, bj: 0 };

  constructor(seed: number) {
    const L = (this.layout = new CityLayout(seed));
    this.uniforms = createCityUniforms();
    const tint = createNoise2D(seed + 205);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => (L.canopy(x, z) > 0 ? 1 : 0),
      tint: (x, z) => tint(x * 0.01, z * 0.01),
    };
    this.decor = new CityDecor(L, this.uniforms);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: createGroundMaterial(this.uniforms, L),
      color: (f, x, z, y, _slope, out) => this.groundColor(f, x, z, y, out),
      createGeometry: (res) => {
        const g = createChunkGeometry(res);
        g.setAttribute('aRoad', new THREE.BufferAttribute(new Float32Array((res + 1) ** 2), 1));
        return g;
      },
      fillExtra: (g, ox, oz, size, res) => {
        const a = g.getAttribute('aRoad') as THREE.BufferAttribute;
        const A = a.array as Float32Array;
        const n = res + 1;
        const step = size / res;
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++)
            A[j * n + i] = L.hasStreets(ox + i * step, oz + j * step) ? 1 : 0;
        a.needsUpdate = true;
      },
    });
    this.planner = new CityPlanner(L);
    this.group.add(this.chunks.group);
  }

  /** Vertex colour of the ground: the block's surface under the analytic street pass. */
  private groundColor(
    f: HeightField,
    x: number,
    z: number,
    y: number,
    out: THREE.Color,
  ): THREE.Color {
    const water = Config.world.waterLevel;
    if (y < water - 0.3) return out.copy(C.shallows).lerp(C.seabed, smoothstep(-0.5, -6, y));
    const L = this.layout;
    const t = f.tint(x, z);
    const zone = L.zoneAt(x, z);
    if (zone === ZONE_AVENUE || zone === ZONE_STREET) out.copy(C.road);
    else if (zone === BK.PARK || zone === BK.FOREST)
      out.copy(C.grass).lerp(C.grassDeep, 0.5 + 0.5 * t + (zone === BK.FOREST ? 0.3 : 0));
    else if (zone === BK.SHRINE || zone === BK.TEMPLE) {
      out.copy(C.gravel);
      if (L.blockOf(x, z, this.block)) {
        const fr = L.shrineFrame(this.block.bi, this.block.bj);
        const dx = x - fr.cx;
        const dz = z - fr.cz;
        const a = dx * fr.fx + dz * fr.fz;
        const b = -dx * fr.fz + dz * fr.fx;
        const half = L.B / 2;
        const edge = Math.min(half - Math.abs(a), half - Math.abs(b));
        if (Math.abs(b) < 3.2 && a < 2)
          out.copy(C.path); // the sando, the approach path
        else if (edge < 9) out.copy(C.grassDeep).lerp(C.grass, 0.3); // the sacred grove
      }
    } else if (zone === BK.HOUSES) out.copy(C.yard).lerp(C.grass, 0.25 + 0.15 * t);
    else if (zone === BK.PLAZA || zone === BK.LANDMARK) out.copy(C.plaza);
    else out.copy(C.pave);
    if (y < water + 1.2) out.lerp(C.quay, 0.6);
    return out.multiplyScalar(0.96 + 0.05 * t);
  }

  flightGround(x: number, z: number): number {
    const h = this.layout.height(x, z);
    return h < 1 ? h : h + this.layout.canopy(x, z);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    return Math.max(this.flightGround(x, z), this.layout.roofBelow(x, y, z));
  }

  /** Generic wisp paths look well around for roofs so they rise before a block, not into it. */
  wispFloor(x: number, z: number): number {
    return Math.max(this.flightGround(x, z), this.layout.skyline(x, z, 22) + 2);
  }

  prime(px: number, pz: number): void {
    this.chunks.prime(px, pz);
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const u = this.uniforms;
    const p = day.palette;
    // Lights come on through golden hour into dusk and stay on until dawn.
    u.uCityNight.value = smoothstep(0.02, 0.5, p.stars);
    u.uCityLights.value = Config.city.lights;
    u.uCitySky.value.copy(p.skyHorizon);
    u.uCityTime.value = time;
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d <= 0) return 0;
    if (n.y > 0.5) {
      // Skimming a roof or a deck: the same soft touch as the ground.
      s.liftVy = Math.max(s.liftVy, 2);
      if (s.pitchSpring.x < 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.max(s.pitchSpring.v, 0.8);
      }
      s.speed -= s.speed * Config.flight.skimSlowdown * (1 / 60);
    } else if (n.y < -0.5) {
      // Nosed into an underside (a beam, a deck): ease back down.
      s.liftVy = Math.min(s.liftVy, -1.5);
      if (s.pitchSpring.x > 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.min(s.pitchSpring.v, -0.5);
      }
    } else glanceOffWall(s, n.x, n.z);
    return 1 + d * 10;
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushPoint(p, margin, this.n);
  }

  thermalOk(x: number, z: number, r: number): boolean {
    return this.layout.skyline(x, z, r + 6) < this.layout.height(x, z) + 3;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose();
  }
}
