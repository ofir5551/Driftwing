import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { World } from '../../levels/World';
import type { FlightInput, FlightState } from '../../player/FlightModel';
import { avoidSolids, glanceOffWall } from '../city/collide';
import { ChunkManager } from '../ChunkManager';
import type { DayCycle } from '../DayCycle';
import { withGroundDetail } from '../GroundDetail';
import { mistUniforms, withMist } from '../Mist';
import { createNoise2D } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import { AtollDecor, type AtollChunk } from './AtollDecor';
import { AtollLayout } from './AtollLayout';
import { AtollPlanner } from './AtollWisps';
import { Surf } from './Surf';

/**
 * Seabed and land colours. The water over them is nearly clear (the level's water clarity), so
 * these are what paint the lagoons: white sand, aqua shallows, turquoise, the blue of the deep.
 */
const C = {
  sand: new THREE.Color('#f4ecd4'),
  shallow: new THREE.Color('#bfeadb'),
  lagoon: new THREE.Color('#5fd0cb'),
  channel: new THREE.Color('#2aa0bd'),
  deep: new THREE.Color('#1b5d9a'),
  abyss: new THREE.Color('#163f7c'),
  coral: new THREE.Color('#3f948f'),
  coralWarm: new THREE.Color('#b88f86'),
  reef: new THREE.Color('#e4d6bd'),
  beach: new THREE.Color('#f7efdb'),
  grass: new THREE.Color('#9cc95f'),
  jungle: new THREE.Color('#4c9447'),
  jungleDark: new THREE.Color('#33703f'),
  cliff: new THREE.Color('#948a72'),
};
const WHITE = new THREE.Color('#fff');
/** A skim over the lagoon throws up spray, not dust. */
const SPRAY = new THREE.Color('#e9fbf8');

/**
 * Coral Atolls as a World: the layout's seabed, reefs and islands streamed as terrain chunks
 * under nearly clear water, the surf breaking round every reef, and instanced rocks, palms,
 * piers and boats. Mushroom rocks are solid but soft, flown with the city's look-ahead and
 * wall glance; the high islands are land the look-ahead steers round.
 */
export class AtollWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: AtollLayout;
  readonly planner: AtollPlanner;
  readonly skimColor = SPRAY;
  private readonly chunks: ChunkManager<AtollChunk>;
  private readonly decor: AtollDecor;
  private readonly surf: Surf;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new AtollLayout(seed));
    const tint = createNoise2D(seed + 720);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: () => 0,
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new AtollDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
      color: (f, x, z, y, slope, out) => this.groundColor(f, x, z, y, slope, out),
    });
    this.surf = new Surf(L);
    this.planner = new AtollPlanner(L);
    this.group.add(this.chunks.group, this.surf.group);
  }

  private groundColor(
    f: HeightField,
    x: number,
    z: number,
    y: number,
    slope: number,
    out: THREE.Color,
  ): THREE.Color {
    const L = this.layout;
    const t = f.tint(x, z);
    if (y < 0.4) {
      // Under the water, by depth: sand, shallows, lagoon, channel, deep and the abyss.
      out.copy(C.sand).lerp(C.shallow, smoothstep(-0.6, -2.5, y));
      out.lerp(C.lagoon, smoothstep(-3, -6.5, y));
      out.lerp(C.channel, smoothstep(-8, -14, y));
      out.lerp(C.deep, smoothstep(-14, -26, y));
      out.lerp(C.abyss, smoothstep(-28, -40, y));
      // The reef flat: pale coral rubble with darker heads; coral heads in the lagoons.
      const rs = L.ring(x, z);
      const a = L.ra;
      if (a) {
        const flat = 1 - smoothstep(a.w * 0.6, a.w * 1.1, Math.abs(rs));
        out.lerp(C.reef, flat * 0.55 * smoothstep(-3, -0.5, y));
        const b = L.bommie(x, z);
        if (rs < -a.w && b > 0)
          out.lerp(t > 0.35 ? C.coralWarm : C.coral, b * 0.45 * smoothstep(-1.5, -4, y));
      }
      return out.multiplyScalar(0.96 + 0.06 * t);
    }
    // Land: bright beach, then grass and palms, then jungle and dark rock up the islands.
    out.copy(C.beach).lerp(C.grass, smoothstep(1.1, 2.2, y));
    out.lerp(C.jungle, smoothstep(4, 14, y));
    out.lerp(C.jungleDark, smoothstep(30, 120, y) * 0.6 + 0.15 * (0.5 + 0.5 * t));
    // Cliffs show bare rock, but the jungle clings on in streaks down even the steepest.
    const cling = 0.5 + 0.5 * Math.sin(x * 0.11 + z * 0.07 + t * 4);
    const bare = smoothstep(0.3, 0.6, slope) + smoothstep(70, 140, y) * 0.35;
    out.lerp(C.cliff, Math.min(bare, 1) * smoothstep(6, 20, y) * (0.9 - 0.5 * cling));
    return out.multiplyScalar(0.95 + 0.07 * t);
  }

  flightGround(x: number, z: number): number {
    const L = this.layout;
    const h = L.height(x, z);
    return Math.max(h + L.canopy(h), L.bungalowAt(x, z));
  }

  surfaceBelow(x: number, y: number, z: number): number {
    const s = this.layout.capAt(x, z);
    const g = this.flightGround(x, z);
    return s <= y ? Math.max(g, s) : g;
  }

  /** Generic wisp paths ride over any rock near their line rather than into it. */
  wispFloor(x: number, z: number): number {
    return Math.max(this.flightGround(x, z), this.layout.skyline(x, z, 18) + 6);
  }

  prime(px: number, pz: number): void {
    this.chunks.prime(px, pz);
    this.surf.update(px, pz);
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
    this.surf.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const A = Config.atoll;
    const p = day.palette;
    // No valley mist on open water, only a sea haze that fades the far atolls.
    const u = mistUniforms;
    u.uMist.value = 0;
    u.uMistFar.value = A.mistFar;
    u.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.4);
    u.uMistTime.value = time;
    this.decor.frame(day);
    this.surf.frame(time, day);
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d <= 0) return 0;
    if (n.y > 0.5) {
      // Skimming a rock's jungle cap: the same soft touch as the ground.
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

  /** Thermals rise off the sun-warmed islets and islands, clear of the rocks. */
  thermalOk(x: number, z: number, r: number): boolean {
    const L = this.layout;
    return L.height(x, z) > 1.2 && L.skyline(x, z, r + 20) === -Infinity;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose();
    this.surf.dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}
