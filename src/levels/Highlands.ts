import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';
import { HIGHLANDS_MUSIC } from '../audio/styles';
import type { FlightState } from '../player/FlightModel';
import { ChunkManager } from '../world/ChunkManager';
import { highlandsCover } from '../world/highlands/crops';
import { Islands } from '../world/Islands';
import { createHeightField, getToonGradient, type LandField } from '../world/Terrain';
import { withGroundDetail } from '../world/GroundDetail';
import { HighlandsDecor, type HighlandsChunk } from '../world/highlands/HighlandsDecor';
import { HighlandsLayout } from '../world/highlands/HighlandsLayout';
import { propTime } from '../world/highlands/materials';
import type { DayCycle } from '../world/DayCycle';
import { createLandGeometry, fillLand, landColor, withLand } from '../world/highlands/Land';
import type { LevelDef, World } from './World';
import type { DiscoveryDef } from '../world/Discoveries';
import { highlandsFinds } from '../world/highlands/finds';

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
  private readonly chunks: ChunkManager<HighlandsChunk>;
  private readonly decor: HighlandsDecor;
  private readonly islands: Islands;
  readonly layout: HighlandsLayout;

  constructor(seed: number) {
    this.field = createHeightField(seed);
    this.layout = new HighlandsLayout(this.field, seed);
    const ground = withLand(
      withGroundDetail(
        new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
      ),
    );
    this.decor = new HighlandsDecor(this.layout);
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

  update(px: number, pz: number): void {
    this.chunks.update(px, pz);
    this.islands.update(px, pz);
  }

  frame(_dt: number, time: number, day: DayCycle): void {
    propTime.value = time;
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
