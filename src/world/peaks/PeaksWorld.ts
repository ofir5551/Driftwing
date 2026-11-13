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
import { createNoise2D } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import { cloudSeaUniforms, withCloudSea } from './cloudSea';
import { bridgeGeometry } from './geometry';
import { PeaksDecor, type PeaksChunk } from './PeaksDecor';
import { PeaksLayout } from './PeaksLayout';
import { PeaksPlanner } from './PeaksWisps';
import type { DiscoveryDef } from '../Discoveries';
import { peaksFinds } from './finds';

const C = {
  trough: new THREE.Color('#bdb8d6'),
  crest: new THREE.Color('#fbf8f2'),
  heap: new THREE.Color('#fffaf2'),
};
const WHITE = new THREE.Color('#fff');
/** A skim over the cloud tops throws up cloud, not dust. */
const PUFF = new THREE.Color('#f4f1f6');

/**
 * Sea of Clouds as a World: the cloud sea streamed as terrain chunks (painted by its own shader)
 * that the bird skims like water, granite spires and their pines and temples instanced over it,
 * the Sky Gate's bridge, banks of cloud drifting round the spires' waists, and the shared mist
 * resting on the cloud tops so the rock dissolves into them. Spires and the bridge are solid but
 * soft, flown with the city's look-ahead and wall glance.
 */
export class PeaksWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: PeaksLayout;
  readonly planner: PeaksPlanner;
  readonly discoveries: readonly DiscoveryDef[];
  readonly skimColor = PUFF;
  private readonly chunks: ChunkManager<PeaksChunk>;
  private readonly decor: PeaksDecor;
  private readonly seaMaterial: THREE.MeshToonMaterial;
  private readonly banks: Clouds;
  private readonly bridge: THREE.Mesh;
  private readonly bridgeLanterns: THREE.InstancedMesh;
  private readonly origin = new THREE.Vector3();
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new PeaksLayout(seed));
    this.discoveries = peaksFinds(L);
    const tint = createNoise2D(seed + 520);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: () => 0,
      tint: (x, z) => tint(x * 0.003, z * 0.003),
    };
    this.decor = new PeaksDecor(L);
    // The sea takes the scene's fog but not the low mist: the mist rests on it (dissolving the
    // spires' feet), and on the sea itself it would flatten every billow to one wash.
    this.seaMaterial = withCloudSea(
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
    );
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: this.seaMaterial,
      color: (f, x, z, y, _slope, out) => {
        // Creases between the heaps a cool lilac, their tops and the big heaps nearly white.
        const P = Config.peaks;
        const t = f.tint(x, z);
        out.copy(C.trough).lerp(C.crest, smoothstep(0.08, 0.55, L.billow(x, z)));
        out.lerp(C.heap, smoothstep(P.cloud + P.swell, P.cloud + P.dome * 0.6, y));
        return out.multiplyScalar(0.97 + 0.04 * t);
      },
    });
    // Banks of cloud drifting round the spires' waists; the bird can fly through them.
    this.banks = new Clouds(seed + 19, 32, {
      lowShare: 1,
      low: [Config.peaks.cloud + 18, Config.peaks.cloud + 70],
      high: [200, 260],
      size: [70, 150],
      squash: 0.32,
      opacity: Config.peaks.banks,
      share: 0.8,
    });
    // The Sky Gate's bridge: one mesh in world space, with its own string of lanterns.
    const b = bridgeGeometry(L.bridge);
    this.bridge = new THREE.Mesh(
      b.geometry,
      withMist(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() })),
    );
    this.bridge.name = 'bridge';
    this.bridgeLanterns = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.4, 8, 6).scale(1, 1.25, 1),
      this.decor.lanternMaterial,
      b.lanterns.length,
    );
    const mm = new THREE.Matrix4();
    b.lanterns.forEach((l, i) =>
      this.bridgeLanterns.setMatrixAt(i, mm.makeTranslation(l.x, l.y, l.z)),
    );
    this.bridgeLanterns.name = 'bridge-lantern';
    this.planner = new PeaksPlanner(L);
    this.group.add(this.chunks.group, this.banks.mesh, this.bridge, this.bridgeLanterns);
  }

  flightGround(x: number, z: number): number {
    return this.layout.height(x, z);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    const s = this.layout.summitAt(x, z);
    const g = this.layout.height(x, z);
    return s <= y ? Math.max(g, s) : g;
  }

  /** Generic wisp paths ride over any spire near their line rather than into it. */
  wispFloor(x: number, z: number): number {
    return Math.max(this.layout.height(x, z) + 4, this.layout.skyline(x, z, 18) + 6);
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
    const P = Config.peaks;
    const p = day.palette;
    const u = mistUniforms;
    u.uMist.value = P.mist;
    u.uMistBase.value = P.cloud;
    u.uMistTop.value = P.cloud + P.mistRise;
    u.uMistFar.value = P.mistFar;
    // The mist is the cloud sea's own colour in this light: its sunlit side toward the fog.
    u.uMistColor.value.copy(p.fog).lerp(p.sun, 0.12).lerp(p.hemiSky, 0.2);
    u.uMistTime.value = time;
    cloudSeaUniforms.uCTime.value = time;
    // Cloud is never dark: it glows with the sky's light, faintly blue in the shade.
    this.seaMaterial.emissive
      .copy(p.hemiSky)
      .lerp(p.fog, 0.5)
      .lerp(WHITE, 0.3)
      .multiplyScalar(P.glow);
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
      // Skimming a summit or the bridge deck: the same soft touch as the ground.
      s.liftVy = Math.max(s.liftVy, 2);
      if (s.pitchSpring.x < 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.max(s.pitchSpring.v, 0.8);
      }
      s.speed -= s.speed * Config.flight.skimSlowdown * (1 / 60);
    } else if (n.y < -0.5) {
      // Brushed the bridge's underside: ease the nose down and away.
      s.liftVy = Math.min(s.liftVy, 0);
      if (s.pitchSpring.x > 0) s.pitchSpring.x *= 0.5;
    } else glanceOffWall(s, n.x, n.z);
    return 1 + d * 10;
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushPoint(p, margin, this.n);
  }

  /** Updrafts rise off the open cloud sea, clear of the rock. */
  thermalOk(x: number, z: number, r: number): boolean {
    return this.layout.skyline(x, z, r + 20) === -Infinity;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose(); // also the decor and the sea's material
    this.banks.mesh.geometry.dispose();
    (this.banks.mesh.material as THREE.Material).dispose();
    this.bridge.geometry.dispose();
    (this.bridge.material as THREE.Material).dispose();
    this.bridgeLanterns.geometry.dispose();
    this.bridgeLanterns.dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistBase.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}
