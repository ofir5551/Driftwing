import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { World } from '../../levels/World';
import type { FlightInput, FlightState } from '../../player/FlightModel';
import { avoidSolids, glanceOffWall } from '../city/collide';
import { ChunkManager } from '../ChunkManager';
import { withGroundDetail } from '../GroundDetail';
import { Clouds } from '../Clouds';
import type { DayCycle } from '../DayCycle';
import { mistUniforms, withMist } from '../Mist';
import { createNoise2D } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import { karstCover } from './cover';
import { KarstDecor } from './KarstDecor';
import { KarstLayout } from './KarstLayout';
import type { KarstChunk } from './KarstScatter';
import { createKarstGeometry, fillKarst, karstColor, karstLandFrame, withKarstLand } from './Land';
import { KarstPlanner } from './KarstWisps';
import { RiverMist } from './RiverMist';
import type { DiscoveryDef } from '../Discoveries';
import { karstFinds } from './finds';

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
  readonly discoveries: readonly DiscoveryDef[];
  private readonly chunks: ChunkManager<KarstChunk>;
  private readonly decor: KarstDecor;
  private readonly banks: Clouds;
  private readonly riverMist: RiverMist;
  private readonly origin = new THREE.Vector3();
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new KarstLayout(seed));
    this.discoveries = karstFinds(L);
    const tint = createNoise2D(seed + 320);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => L.grove(x, z),
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new KarstDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withKarstLand(
        withGroundDetail(
          withMist(
            new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
          ),
        ),
      ),
      color: (f, x, z, y, _slope, out) => karstColor(L, f, x, z, y, out),
      createGeometry: createKarstGeometry,
      fillExtra: (g, ox, oz, size, res) => fillKarst(L, g, ox, oz, size, res),
      cover: karstCover(),
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
    this.riverMist = new RiverMist(L);
    this.group.add(this.chunks.group, this.banks.mesh, this.riverMist.mesh);
  }

  /** Terrain, the soft canopy over groves and village roofs, and the bridges' decks. */
  flightGround(x: number, z: number): number {
    const L = this.layout;
    const h = L.height(x, z);
    return Math.max(h < 0.5 ? h : h + L.canopy(x, z), L.bridgeTop(x, z));
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
    this.riverMist.update(px, pz);
  }

  update(px: number, pz: number): void {
    this.origin.set(px, 0, pz);
    this.chunks.update(px, pz);
    this.riverMist.update(px, pz);
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
    // The river breathes its own mist at first light; it burns off long before noon.
    this.riverMist.frame(u.uMistColor.value, morning * morning, time);
    karstLandFrame(day, time);
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
    this.riverMist.dispose();
    this.banks.mesh.geometry.dispose();
    (this.banks.mesh.material as THREE.Material).dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}
