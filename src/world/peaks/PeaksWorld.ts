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
import { beamMaterial, beamUniforms, peaksTime } from './materials';
import { beamLight } from './PeaksSites';
import { hash2 } from '../noise';
import { bridgeGeometry } from './geometry';
import { PeaksDecor, type PeaksChunk } from './PeaksDecor';
import { PeaksLayout } from './PeaksLayout';
import { PeaksPlanner } from './PeaksWisps';
import type { DiscoveryDef } from '../Discoveries';
import { peaksFinds } from './finds';
import { peaksDestinations } from './destinations';
import type { DestinationSource } from '../Destinations';

const C = {
  trough: new THREE.Color('#bdb8d6'),
  crest: new THREE.Color('#fbf8f2'),
  heap: new THREE.Color('#fffaf2'),
};
const WHITE = new THREE.Color('#fff');
/** Most sunbeams standing round the bird at once, and the grid they stand on. */
const BEAMS = 8;
const BEAM_CELL = 230;
const bm = new THREE.Matrix4();
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
  readonly destinations: DestinationSource;
  readonly skimColor = PUFF;
  /** The cloud sea's colour in this light (set each frame): the bird's veil, the plunge puffs. */
  readonly cloudColor = new THREE.Color('#f4f1f6');
  /** Next slot in the cloud sea's ring of plunge ripples. */
  private plungeNext = 0;
  private readonly chunks: ChunkManager<PeaksChunk>;
  private readonly decor: PeaksDecor;
  private readonly seaMaterial: THREE.MeshToonMaterial;
  private readonly banks: Clouds;
  private readonly bridge: THREE.Mesh;
  private readonly bridgeLanterns: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;
  /** Beam feet (x, y, z, width) round the bird, re-picked as it flies (refillBeams). */
  private readonly beamFeet = new Float32Array(BEAMS * 4);
  private beamN = 0;
  private beamX = Infinity;
  private beamZ = Infinity;
  private readonly origin = new THREE.Vector3();
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new PeaksLayout(seed));
    this.discoveries = peaksFinds(L);
    this.destinations = peaksDestinations(L);
    const tint = createNoise2D(seed + 520);
    this.field = {
      // The cloud sea as drawn, with its gaps; the bird flies over `height` (see surface()).
      height: (x, z) => L.surface(x, z),
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
    this.bridge.castShadow = true;
    this.beams = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), beamMaterial(), BEAMS);
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 3; // additive, after the banks
    this.beams.name = 'sunbeams';
    this.planner = new PeaksPlanner(L);
    this.group.add(
      this.chunks.group,
      this.banks.mesh,
      this.bridge,
      this.bridgeLanterns,
      this.beams,
    );
  }

  flightGround(x: number, z: number): number {
    return this.layout.height(x, z);
  }

  /** Open cloud is soft: a dive sinks in and is buoyed out (not near rock or a gap). */
  softGround(x: number, z: number): number {
    return this.layout.softness(x, z);
  }

  /** The cloud swells over the bird while it swims under, so it can be followed. */
  swim(x: number, z: number, yaw: number, depth: number): void {
    cloudSeaUniforms.uCSwim.value.set(x, z, depth, yaw);
  }

  /** A ripple of churned cloud spreading from where the bird went in or burst out. */
  plunge(x: number, z: number, strength: number): void {
    const slots = cloudSeaUniforms.uCPlunge.value;
    slots[this.plungeNext].set(x, z, cloudSeaUniforms.uCTime.value, strength);
    this.plungeNext = (this.plungeNext + 1) % slots.length;
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

  /**
   * Pick the sunbeams' feet round the bird: on a grid, by hash, only out over open cloud (a
   * beam through a spire would show its trick). Re-picked every half cell flown.
   */
  private refillBeams(px: number, pz: number): void {
    if (Math.hypot(px - this.beamX, pz - this.beamZ) < BEAM_CELL / 2) return;
    this.beamX = px;
    this.beamZ = pz;
    const L = this.layout;
    const F = this.beamFeet;
    let n = 0;
    const i0 = Math.floor(px / BEAM_CELL);
    const j0 = Math.floor(pz / BEAM_CELL);
    for (let j = j0 - 3; j <= j0 + 3; j++)
      for (let i = i0 - 3; i <= i0 + 3; i++) {
        if (n >= BEAMS || hash2(i, j, L.seed + 641) > 0.3) continue;
        const x = (i + 0.2 + 0.6 * hash2(i, j, L.seed + 642)) * BEAM_CELL;
        const z = (j + 0.2 + 0.6 * hash2(i, j, L.seed + 643)) * BEAM_CELL;
        if (L.skyline(x, z, 30) !== -Infinity) continue;
        F[n * 4] = x;
        F[n * 4 + 1] = L.height(x, z);
        F[n * 4 + 2] = z;
        F[n * 4 + 3] = 16 + 26 * hash2(i, j, L.seed + 644);
        n++;
      }
    this.beamN = n;
  }

  /** Shafts of sun along the light from the sky's cloud layer down to the sea. */
  private frameBeams(day: DayCycle): void {
    const sun = day.sunDir;
    const k =
      Config.levelLight.peaks.beams *
      Config.render.cloudShadows *
      beamLight(sun.y) *
      (1 - smoothstep(0.05, 0.5, day.palette.stars));
    beamUniforms.uBeamStrength.value = k;
    beamUniforms.uBeamDir.value.copy(sun).negate();
    beamUniforms.uBeamColor.value.copy(day.palette.sun);
    if (k <= 0.001) {
      this.beams.count = 0;
      return;
    }
    // From the sea up toward the sun until it reaches the sky's cloud layer.
    const len = Math.min(700, 300 / Math.max(sun.y, 0.14));
    const F = this.beamFeet;
    for (let i = 0; i < this.beamN; i++) {
      bm.makeScale(F[i * 4 + 3], len, 1).setPosition(F[i * 4], F[i * 4 + 1], F[i * 4 + 2]);
      this.beams.setMatrixAt(i, bm);
    }
    this.beams.count = this.beamN;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const P = Config.peaks;
    const p = day.palette;
    peaksTime.value = time;
    this.refillBeams(this.origin.x, this.origin.z);
    this.frameBeams(day);
    // The cloud sea's warm glow and silver lining, strongest with the sun low.
    const LL = Config.levelLight.peaks;
    const sun = day.sunDir;
    const night = smoothstep(0.05, 0.6, p.stars);
    const cu = cloudSeaUniforms;
    cu.uCSunDir.value.copy(sun);
    cu.uCSunColor.value.copy(p.sun);
    cu.uCWarm.value = LL.warm * (1 - smoothstep(0.12, 0.55, sun.y)) * (1 - night);
    cu.uCLining.value = LL.lining * (1 - 0.6 * night);
    cu.uCHaze.value.copy(p.fog).lerp(p.hemiSky, 0.35).multiplyScalar(0.82);
    const u = mistUniforms;
    u.uMist.value = P.mist;
    u.uMistBase.value = P.cloud;
    u.uMistTop.value = P.cloud + P.mistRise;
    u.uMistFar.value = P.mistFar;
    // The mist is the cloud sea's own colour in this light: its sunlit side toward the fog.
    u.uMistColor.value.copy(p.fog).lerp(p.sun, 0.12).lerp(p.hemiSky, 0.2);
    // The cloud tops in this light: the mist's colour, a little brighter where the sun is on it.
    // Capped: the boost lifts the dim hours (the lit tops outshine the mist most at night), but by
    // day it would push the puffs past the bloom and they would glow like lamps.
    const cc = this.cloudColor
      .copy(u.uMistColor.value)
      .lerp(p.sun, 0.1)
      .multiplyScalar(P.veilLight);
    const top = Math.max(cc.r, cc.g, cc.b);
    if (top > P.veilMax) cc.multiplyScalar(P.veilMax / top);
    u.uMistTime.value = time;
    cloudSeaUniforms.uCTime.value = time;
    // The sea's moving heaps ride the same wind as the banks (Clouds drifts along (1, 0.4)).
    const drift = (P.seaDrift * time) / Math.hypot(1, 0.4);
    cloudSeaUniforms.uCDrift.value.set(drift, drift * 0.4);
    this.banks.churn = P.bankChurn;
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
    return this.layout.skyline(x, z, r + 20) === -Infinity && this.layout.gapAt(x, z) <= 0;
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
    this.beams.geometry.dispose();
    (this.beams.material as THREE.Material).dispose();
    this.beams.dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistBase.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
    for (const v of cloudSeaUniforms.uCPlunge.value) v.set(0, 0, 0, 0);
    cloudSeaUniforms.uCSwim.value.set(0, 0, 0, 0);
  }
}
