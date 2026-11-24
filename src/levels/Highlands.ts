import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';
import { HIGHLANDS_MUSIC } from '../audio/styles';
import type { FlightState } from '../player/FlightModel';
import { ChunkManager } from '../world/ChunkManager';
import { highlandsCover } from '../world/highlands/crops';
import { ISLAND_CELL, Islands } from '../world/Islands';
import { createHeightField, getToonGradient, type LandField } from '../world/Terrain';
import { withGroundDetail } from '../world/GroundDetail';
import { mistUniforms, withMist } from '../world/Mist';
import { HighlandsDecor, type HighlandsChunk } from '../world/highlands/HighlandsDecor';
import { HighlandsLayout } from '../world/highlands/HighlandsLayout';
import { propTime } from '../world/highlands/materials';
import type { DayCycle } from '../world/DayCycle';
import { createLandGeometry, fillLand, landColor, withLand } from '../world/highlands/Land';
import type { LevelDef, World } from './World';
import type { DiscoveryDef } from '../world/Discoveries';
import { highlandsFinds } from '../world/highlands/finds';
import type { DestinationSource } from '../world/Destinations';
import { landmarkDestinations, landmarkName, type Landmark } from '../world/landmarks';
import { hash2 } from '../world/noise';

/** Names for the floating isles the Highlands' journeys lead to. */
const ISLE_FIRST = [
  'Heron',
  'Thistle',
  'Lark',
  'Fern',
  'Rowan',
  'Heather',
  'Bracken',
  'Willow',
  'Clover',
  'Kestrel',
  'Bramble',
  'Curlew',
  'Hazel',
  'Moss',
  'Sorrel',
  'Wren',
  'Linnet',
  'Birch',
];
const ISLE_KIND = ['Isle', 'Isle', 'Holm', 'Crag', 'Rock'];

const WHITE = new THREE.Color('#fff');

/**
 * The original level, lived in: valleys with rivers, roads and a patchwork of farms, villages
 * along the roads, forests with glades, lakes with boats, and the floating islands above.
 */
export class HighlandsWorld implements World {
  readonly group = new THREE.Group();
  readonly field: LandField;
  readonly planner = null;
  readonly discoveries: readonly DiscoveryDef[];
  readonly destinations: DestinationSource;
  private readonly chunks: ChunkManager<HighlandsChunk>;
  private readonly decor: HighlandsDecor;
  private readonly islands: Islands;
  readonly layout: HighlandsLayout;

  constructor(seed: number) {
    this.field = createHeightField(seed);
    this.layout = new HighlandsLayout(this.field, seed);
    const ground = withLand(
      withGroundDetail(
        withMist(
          new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
        ),
      ),
    );
    this.decor = new HighlandsDecor(this.layout);
    withMist(this.decor.trees.material);
    this.chunks = new ChunkManager(this.field, {
      decor: this.decor,
      color: landColor,
      material: ground,
      createGeometry: createLandGeometry,
      fillExtra: (g, ox, oz, size, res) => fillLand(this.layout, g, ox, oz, size, res),
      cover: highlandsCover(this.layout),
    });
    this.islands = new Islands(this.field);
    this.discoveries = highlandsFinds(() => this.islands.active);
    this.destinations = landmarkDestinations((x, z, R, out) => this.isleLandmarks(x, z, R, out));
    this.group.add(this.chunks.group, this.islands.group);
  }

  /**
   * Terrain plus a soft "canopy" over dense forest (the bird skims treetops instead of clipping
   * trees) and over buildings (it glides over roofs and windmills; wisps keep clear of them).
   */
  flightGround(x: number, z: number): number {
    const h = this.field.height(x, z);
    if (h < 1.2 || h > 115) return h;
    const g = h + smoothstep(0.45, 0.8, this.field.forest(x, z)) * Config.world.canopyHeight;
    return this.layout.builtLift(x, z, g);
  }

  surfaceBelow(x: number, _y: number, z: number): number {
    return this.flightGround(x, z);
  }

  wispFloor(x: number, z: number): number {
    return this.flightGround(x, z);
  }

  prime(px: number, pz: number): void {
    this.chunks.prime(px, pz);
    this.islands.update(px, pz);
  }

  /**
   * The Highlands' journeys lead to its floating isles. The beacon rises from the isle's top and
   * the cairn stands on its turf; the route ends beside the isle, not under it (its hanging rock
   * is a hidden find, and the ribbons fly far below the top), and passing alongside arrives.
   */
  private isleLandmarks(x: number, z: number, R: number, out: Landmark[]): void {
    const C = ISLAND_CELL;
    for (let j = Math.floor((z - R) / C); j <= Math.floor((z + R) / C); j++)
      for (let i = Math.floor((x - R) / C); i <= Math.floor((x + R) / C); i++) {
        const I = this.islands.islandAt(i, j);
        if (!I) continue;
        const a = hash2(i, j, 993) * Math.PI * 2;
        out.push({
          id: `isle:${i},${j}`,
          name: landmarkName(hash2(i, j, 991), ISLE_FIRST, ISLE_KIND),
          x: I.x,
          z: I.z,
          y: I.y,
          top: I.y + 14,
          r: I.r + 48,
          aside: I.r + 24,
          // The cap's top is 0.09 of the radius above the island's surface height.
          roost: {
            x: I.x + Math.sin(a) * I.r * 0.35,
            y: I.y + I.r * 0.09,
            z: I.z + Math.cos(a) * I.r * 0.35,
            yaw: a,
          },
        });
      }
  }

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
    this.islands.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    propTime.value = time;
    // Mist lies in the valleys at first light and lifts by mid-morning; a thin far haze stays
    // all day, so the ridges layer into the distance.
    const H = Config.highlands;
    const morning = Math.pow(0.5 + 0.5 * Math.cos(day.phase * Math.PI * 2), 3);
    const mu = mistUniforms;
    mu.uMist.value = H.mist * morning;
    mu.uMistBase.value = 0;
    mu.uMistTop.value = H.mistTop;
    mu.uMistFar.value = H.mistFar;
    mu.uMistColor.value.copy(day.palette.fog).lerp(day.palette.skyHorizon, 0.3);
    mu.uMistTime.value = time;
    // Chimney smoke takes the sky's light and fades into the fog with distance.
    const p = day.palette;
    const u = this.decor.smokeMaterial.uniforms;
    (u.uColor.value as THREE.Color).copy(p.hemiSky).lerp(WHITE, 0.6);
    (u.uFogColor.value as THREE.Color).copy(p.fog);
    u.uFogFar.value = Config.render.drawDistance * 0.95;
  }

  assist(): void {}

  collide(s: FlightState): number {
    const pushed = this.islands.push(s, Config.flight.clearance);
    if (pushed <= 0) return 0;
    s.liftVy = Math.max(s.liftVy, 3);
    s.speed *= 1 - 0.1 * (1 / 60);
    return pushed * 10;
  }

  pushPoint(): void {}

  thermalOk(): boolean {
    return true;
  }

  get chunkCount(): number {
    return this.chunks.count;
  }

  get pending(): number {
    return this.chunks.pending;
  }

  dispose(): void {
    this.chunks.dispose();
    this.islands.dispose();
    mistUniforms.uMist.value = 0;
    mistUniforms.uMistFar.value = 0;
    mistUniforms.uMistColor.value.copy(WHITE);
  }
}

export const Highlands: LevelDef = {
  id: 'highlands',
  name: 'Highlands',
  blurb: 'Valleys, lakes and floating isles',
  startPhase: 0.06,
  dayScale: 1,
  music: HIGHLANDS_MUSIC,
  backdrop: 'none',
  maxAltitude: 400, // above the cloud layer
  create: (seed) => ({
    world: new HighlandsWorld(seed),
    spawn: { x: 0, y: 45, z: 0, yaw: 0 },
  }),
};
