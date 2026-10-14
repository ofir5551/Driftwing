import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';
import { DAY_KEYS } from '../audio/scales';
import type { FlightState } from '../player/FlightModel';
import { ChunkManager } from '../world/ChunkManager';
import { Islands } from '../world/Islands';
import { createHeightField, type HeightField } from '../world/Terrain';
import { TreeDecor } from '../world/Trees';
import type { LevelDef, World } from './World';

/** The original level: endless valleys, lakes, forests and floating islands. */
class HighlandsWorld implements World {
  readonly group = new THREE.Group();
  readonly field: HeightField;
  readonly planner = null;
  private readonly chunks: ChunkManager<number[]>;
  private readonly islands: Islands;

  constructor(seed: number) {
    this.field = createHeightField(seed);
    this.chunks = new ChunkManager(this.field, { decor: new TreeDecor(this.field) });
    this.islands = new Islands(this.field);
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
  keys: DAY_KEYS,
  backdrop: 'none',
  maxAltitude: 400, // above the cloud layer
  create: (seed) => ({
    world: new HighlandsWorld(seed),
    spawn: { x: 0, y: 45, z: 0, yaw: 0 },
  }),
};
