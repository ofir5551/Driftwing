import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { World } from '../../levels/World';
import type { FlightInput, FlightState } from '../../player/FlightModel';
import { avoidSolids, glanceOffWall } from '../city/collide';
import { ChunkManager } from '../ChunkManager';
import { Clouds } from '../Clouds';
import type { DayCycle } from '../DayCycle';
import { mistUniforms, withMist } from '../Mist';
import { createNoise2D, hash2 } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import { KarstDecor, type KarstChunk } from './KarstDecor';
import { KarstLayout } from './KarstLayout';
import { KarstPlanner } from './KarstWisps';

const C = {
  bed: new THREE.Color('#4f7268'),
  shallows: new THREE.Color('#87a596'),
  shore: new THREE.Color('#cdc5ae'),
  grass: new THREE.Color('#98bd78'),
  meadow: new THREE.Color('#b9c987'),
  grove: new THREE.Color('#6c9663'),
  scree: new THREE.Color('#82917a'),
  earth: new THREE.Color('#c6baa0'),
  flooded: new THREE.Color('#c3d5d2'),
  young: new THREE.Color('#a8cd6f'),
  ripe: new THREE.Color('#d9d08a'),
  bund: new THREE.Color('#82a160'),
};
const WHITE = new THREE.Color('#fff');

/**
 * Jade River as a World: the layout's valley streamed as terrain chunks, instanced pillars and
 * village life, low mist banks drifting between the rock, and the shared valley-mist shader
 * tuned to the hour (thick at dawn, thin by midday). Pillars are solid but soft, flown with the
 * city's look-ahead and wall glance.
 */
export class KarstWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: KarstLayout;
  readonly planner: KarstPlanner;
  private readonly chunks: ChunkManager<KarstChunk>;
  private readonly decor: KarstDecor;
  private readonly banks: Clouds;
  private readonly origin = new THREE.Vector3();
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new KarstLayout(seed));
    const tint = createNoise2D(seed + 320);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => L.grove(x, z),
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new KarstDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withMist(
        new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
      ),
      color: (f, x, z, y, _slope, out) => this.groundColor(f, x, z, y, out),
    });
    // Low banks of mist that drift between the pillars; the bird can fly through them.
    this.banks = new Clouds(seed + 9, 44, {
      lowShare: 1,
      low: [10, 42],
      size: [70, 140],
      squash: 0.3,
      opacity: 0.5,
      share: 0.8,
    });
    this.planner = new KarstPlanner(L);
    this.group.add(this.chunks.group, this.banks.mesh);
  }

  private groundColor(
    f: HeightField,
    x: number,
    z: number,
    y: number,
    out: THREE.Color,
  ): THREE.Color {
    if (y < -0.4) return out.copy(C.shallows).lerp(C.bed, smoothstep(-0.4, -3, y));
    const L = this.layout;
    const t = f.tint(x, z);
    const scree = y - L.base(x, z); // also leaves the river scratch for (x, z)
    const bank = L.rd - L.rw;
    out.copy(C.grass).lerp(C.meadow, 0.5 + 0.5 * t);
    // Paddies: a patchwork of flooded mirrors, young rice and ripening gold, with green bunds.
    const p = L.paddy(x, z);
    if (p > 0.05) {
      const ci = Math.floor(x / 22);
      const cj = Math.floor(z / 17);
      const h = hash2(ci, cj, L.seed + 330);
      const fx = x / 22 - ci;
      const fz = z / 17 - cj;
      const edge = Math.min(fx, 1 - fx, fz, 1 - fz);
      const field = h < 0.4 ? C.flooded : h < 0.75 ? C.young : C.ripe;
      out.lerp(edge < 0.08 ? C.bund : field, p);
    }
    out.lerp(C.grove, L.grove(x, z) * 0.7);
    L.river(x, z);
    out.lerp(C.earth, L.village(x, z) * 0.6);
    out.lerp(C.scree, smoothstep(0.4, 5, scree));
    out.lerp(C.shore, 1 - smoothstep(1, 8, bank));
    return out.multiplyScalar(0.95 + 0.06 * t);
  }

  flightGround(x: number, z: number): number {
    const h = this.layout.height(x, z);
    return h < 0.5 ? h : h + this.layout.canopy(x, z);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    const s = this.layout.summitAt(x, z);
    const g = this.flightGround(x, z);
    return s <= y ? Math.max(g, s) : g;
  }

  /** Generic wisp paths ride over any pillar near their line rather than into it. */
  wispFloor(x: number, z: number): number {
    return Math.max(this.flightGround(x, z), this.layout.skyline(x, z, 18) + 6);
  }

  prime(px: number, pz: number): void {
    this.origin.set(px, 0, pz);
    this.chunks.prime(px, pz);
  }

  update(px: number, pz: number): void {
    this.origin.set(px, 0, pz);
    this.chunks.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const K = Config.karst;
    const p = day.palette;
    // Thickest at first light, thinnest at midday, gathering again toward night.
    const morning = Math.pow(0.5 + 0.5 * Math.cos(day.phase * Math.PI * 2), 1.5);
    const u = mistUniforms;
    u.uMist.value = K.mist * (0.45 + 0.55 * morning);
    u.uMistTop.value = K.mistTop;
    u.uMistFar.value = K.mistFar;
    u.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.35);
    u.uMistTime.value = time;
    this.decor.frame(day);
    this.banks.update(day, this.origin, time);
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d <= 0) return 0;
    if (n.y > 0.5) {
      // Skimming a summit: the same soft touch as the ground.
      s.liftVy = Math.max(s.liftVy, 2);
      if (s.pitchSpring.x < 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.max(s.pitchSpring.v, 0.8);
      }
      s.speed -= s.speed * Config.flight.skimSlowdown * (1 / 60);
    } else glanceOffWall(s, n.x, n.z);
    return 1 + d * 10;
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushPoint(p, margin, this.n);
  }

  /** Thermals rise over open land, clear of the rock. */
  thermalOk(x: number, z: number, r: number): boolean {
    return this.layout.river(x, z) > 0 && this.layout.skyline(x, z, r + 20) === -Infinity;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose();
    this.banks.mesh.geometry.dispose();
    (this.banks.mesh.material as THREE.Material).dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}
