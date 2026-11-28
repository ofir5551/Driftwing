import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { World } from '../../levels/World';
import type { FlightInput, FlightState } from '../../player/FlightModel';
import { avoidSolids, glanceOffWall } from '../city/collide';
import { ChunkManager } from '../ChunkManager';
import { withGroundDetail } from '../GroundDetail';
import type { DayCycle } from '../DayCycle';
import { mistUniforms, withMist } from '../Mist';
import { createNoise2D } from '../noise';
import { getToonGradient, type HeightField } from '../Terrain';
import type { DiscoveryDef } from '../Discoveries';
import type { DestinationSource } from '../Destinations';
import { mapleCover } from './cover';
import { mapleDestinations } from './destinations';
import { mapleFinds } from './finds';
import { createMapleGeometry, fillMaple, mapleColor, withMapleLand } from './land';
import { Dragonflies } from './Dragonflies';
import { Geese } from './Geese';
import { Leaves } from './Leaves';
import { MapleDecor } from './MapleDecor';
import { MapleLayout } from './MapleLayout';
import type { MapleChunk } from './MapleScatter';
import { MaplePlanner } from './MapleWisps';

const WHITE = new THREE.Color('#fff');
const LEAF = new THREE.Color('#c4502c');

/**
 * Maple Valley as a World: the layout's valley streamed as terrain chunks, the forest and the
 * temples instanced, leaves falling round the bird, geese crossing high overhead, red
 * dragonflies hovering low, crows, boats and smoke (in the decor), and a soft valley haze that lies in the
 * mornings and gathers again at dusk. Pagodas, the lake's gate and its pavilion are solid but
 * soft (the city's look-ahead and glance); the forest, roofs, the tunnels' gates and the
 * bridges are skimmed.
 */
export class MapleWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly layout: MapleLayout;
  readonly planner: MaplePlanner;
  readonly discoveries: readonly DiscoveryDef[];
  readonly destinations: DestinationSource;
  readonly skimColor = LEAF;
  private readonly chunks: ChunkManager<MapleChunk>;
  private readonly decor: MapleDecor;
  private readonly leaves: Leaves;
  private readonly geese: Geese;
  private readonly dragonflies: Dragonflies;
  private readonly n = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    const L = (this.layout = new MapleLayout(seed));
    this.discoveries = mapleFinds(L);
    this.destinations = mapleDestinations(L);
    const tint = createNoise2D(seed + 520);
    this.field = {
      height: (x, z) => L.height(x, z),
      forest: (x, z) => {
        L.land(x, z);
        return L.lForest;
      },
      tint: (x, z) => tint(x * 0.004, z * 0.004),
    };
    this.decor = new MapleDecor(L);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      material: withMapleLand(
        withGroundDetail(
          withMist(
            new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
          ),
        ),
      ),
      color: (f, x, z, y, slope, out) => mapleColor(L, f, x, z, y, slope, out),
      createGeometry: createMapleGeometry,
      fillExtra: (g, ox, oz, size, res) => fillMaple(L, g, ox, oz, size, res),
      cover: mapleCover(),
    });
    this.leaves = new Leaves(seed);
    this.geese = new Geese(seed);
    this.dragonflies = new Dragonflies(seed, (x, z) => Math.max(L.flightGround(x, z), 0.3));
    this.planner = new MaplePlanner(L);
    this.group.add(this.chunks.group, this.leaves.mesh, this.geese.mesh, this.dragonflies.mesh);
  }

  flightGround(x: number, z: number): number {
    return this.layout.flightGround(x, z);
  }

  surfaceBelow(x: number, y: number, z: number): number {
    const g = this.flightGround(x, z);
    const s = this.layout.solidTop(x, y - 0.5, z, 0);
    return s !== -Infinity && s <= y ? Math.max(g, s) : g;
  }

  /** Generic wisp paths ride well over a pagoda's finial and the tunnels' gates. */
  wispFloor(x: number, z: number): number {
    const L = this.layout;
    let f = Math.max(this.flightGround(x, z), L.skyline(x, z, 18) + 14);
    if (L.tunnelAt(x, z) < Config.maple.gateHalf + 12)
      f = Math.max(f, L.tunnelY + Config.maple.gateHeight + 8);
    return f;
  }

  prime(px: number, pz: number): void {
    this.chunks.prime(px, pz);
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    const K = Config.maple;
    const p = day.palette;
    // Haze in the valleys: thickest at first light, thin by midday, back toward evening.
    const ph = day.phase;
    const morning = Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 2);
    const evening = smoothBell(ph, 0.62, 0.14);
    const u = mistUniforms;
    u.uMist.value = K.mist * (0.25 + 0.6 * morning + 0.4 * evening);
    u.uMistTop.value = K.mistTop;
    u.uMistFar.value = K.mistFar;
    u.uMistColor.value.copy(p.fog).lerp(p.skyHorizon, 0.4);
    u.uMistTime.value = time;
    this.decor.frame(day, time);
    this.leaves.frame(time, day);
    this.geese.frame(time, day);
    this.dragonflies.frame(time, day);
  }

  assist(s: FlightState, input: FlightInput): void {
    avoidSolids(s, input, this.layout);
  }

  collide(s: FlightState): number {
    const n = this.n;
    const d = this.layout.pushPoint(s, Config.flight.clearance, n);
    if (d <= 0) return 0;
    if (n.y > 0.5) {
      // Skimming a roof or a finial: the same soft touch as the ground.
      s.liftVy = Math.max(s.liftVy, 2);
      if (s.pitchSpring.x < 0) {
        s.pitchSpring.x *= 0.5;
        s.pitchSpring.v = Math.max(s.pitchSpring.v, 0.8);
      }
      s.speed -= s.speed * Config.flight.skimSlowdown * (1 / 60);
    } else if (n.y < -0.5) {
      // Brushing the underside of the gate's beams: ease the nose down under them.
      s.liftVy = Math.min(s.liftVy, 0);
      if (s.pitchSpring.x > 0) s.pitchSpring.x *= 0.5;
    } else glanceOffWall(s, n.x, n.z);
    return 1 + d * 10;
  }

  pushPoint(p: { x: number; y: number; z: number }, margin: number): void {
    this.layout.pushPoint(p, margin, this.n);
  }

  /** Thermals rise over the open valley floor and the lake, clear of the pagodas. */
  thermalOk(x: number, z: number, r: number): boolean {
    const L = this.layout;
    L.land(x, z);
    return L.lForest < 0.5 && L.lRise < 0.3 && L.skyline(x, z, r + 20) === -Infinity;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose();
    this.leaves.dispose();
    this.geese.dispose();
    this.dragonflies.dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}

/** A soft bump round `at` (day phase) of half width `w`. */
function smoothBell(x: number, at: number, w: number): number {
  const d = Math.abs(x - at) / w;
  return d >= 1 ? 0 : (1 - d * d) ** 2;
}
