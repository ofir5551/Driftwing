import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';
import { HIGHLANDS_MUSIC } from '../audio/styles';
import type { FlightState } from '../player/FlightModel';
import { ChunkManager } from '../world/ChunkManager';
import type { CoverStyle } from '../world/GroundCover';
import { Islands } from '../world/Islands';
import { createHeightField, getToonGradient, type LandField } from '../world/Terrain';
import { withGroundDetail } from '../world/GroundDetail';
import { HighlandsLayout } from '../world/highlands/HighlandsLayout';
import { createLandGeometry, fillLand, landColor, withLand } from '../world/highlands/Land';
import { TreeDecor } from '../world/Trees';
import type { LevelDef, World } from './World';
import type { DiscoveryDef } from '../world/Discoveries';
import { highlandsFinds } from '../world/highlands/finds';

/**
 * Meadow grass over the hills, from the beaches (sand gives way to grass by ~1.5 m) up to where
 * the high ground pales; wildflowers in drifts: white, buttercup, pink, harebell, poppy.
 */
const HIGHLANDS_COVER: CoverStyle = {
  tint: [1.04, 1.06, 0.95],
  height: 1,
  minY: 1.4,
  maxY: 100,
  flowers: { chance: 0.42, colors: ['#fbf7ee', '#f7d34a', '#f3a6c4', '#a9b6f2', '#ef7a5c'] },
};

/** The original level: endless valleys, rivers and lakes, forests and floating islands. */
export class HighlandsWorld implements World {
  readonly group = new THREE.Group();
  readonly field: LandField;
  readonly planner = null;
  readonly discoveries: readonly DiscoveryDef[];
  private readonly chunks: ChunkManager<number[]>;
  private readonly islands: Islands;
  readonly layout: HighlandsLayout;

  constructor(seed: number) {
    this.field = createHeightField(seed);
    this.layout = new HighlandsLayout(this.field);
    const ground = withLand(
      withGroundDetail(
        new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() }),
      ),
    );
    this.chunks = new ChunkManager(this.field, {
      decor: new TreeDecor(this.field),
      color: landColor,
      material: ground,
      createGeometry: createLandGeometry,
      fillExtra: (g, ox, oz, size, res) => fillLand(this.layout, g, ox, oz, size, res),
      cover: HIGHLANDS_COVER,
    });
    this.islands = new Islands(this.field);
    this.discoveries = highlandsFinds(() => this.islands.active);
    this.group.add(this.chunks.group, this.islands.group);
  }

  /** Terrain plus a soft "canopy" over dense forest, so the bird skims treetops instead of clipping trees. */
  flightGround(x: number, z: number): number {
    const h = this.field.height(x, z);
    if (h < 1.2 || h > 115) return h;
    return h + smoothstep(0.45, 0.8, this.field.forest(x, z)) * Config.world.canopyHeight;
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

  frame(): void {}

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
