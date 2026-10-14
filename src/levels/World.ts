import type * as THREE from 'three';
import type { FlightInput, FlightState } from '../player/FlightModel';
import type { DayCycle, SkyKey } from '../world/DayCycle';
import type { Backdrop } from '../world/Sky';
import type { DayKey } from '../audio/scales';
import type { HeightField } from '../world/Terrain';
import type { WispPlanner } from '../world/Wisps';

export type LevelId = 'highlands' | 'city' | 'karst' | 'fjord';

/**
 * Everything level-specific about the world the bird flies through: terrain, scenery, what
 * counts as solid, and a few hooks for gameplay (where wisps and thermals may go). Game and
 * Gameplay only talk to this interface, so a level can be swapped at runtime.
 */
export interface World {
  /** Scene objects owned by the level (removed and disposed on a level switch). */
  readonly group: THREE.Group;
  /** Bare terrain (lakebeds, seabed, hills). */
  readonly field: HeightField;
  /** Soft "ground" for the flight model: terrain plus anything skimmed over (canopy). */
  flightGround(x: number, z: number): number;
  /** Top of whatever is visible under a point at height y (roofs, decks, canopy, terrain). */
  surfaceBelow(x: number, y: number, z: number): number;
  /** Height the wisp path must keep clear of near x,z. */
  wispFloor(x: number, z: number): number;
  /** Synchronously build everything near a point (behind the title screen or a level switch). */
  prime(px: number, pz: number): void;
  /** Per-frame streaming around the camera target. */
  update(px: number, pz: number): void;
  /** Per-frame visuals that follow the time of day (window lights, neon). */
  frame(dt: number, time: number, day: DayCycle): void;
  /** Steering help applied to the input before the flight step (e.g. veer around towers). */
  assist(s: FlightState, input: FlightInput): void;
  /** Soft collision with solid scenery after the flight step. Returns contact strength (0 = none). */
  collide(s: FlightState): number;
  /** Push a point (the camera) out of solid scenery. */
  pushPoint(p: { x: number; y: number; z: number }, margin: number): void;
  /** Whether a thermal column of radius r may stand at x,z. */
  thermalOk(x: number, z: number, r: number): boolean;
  /** Optional level-specific wisp patterns. */
  readonly planner: WispPlanner | null;
  readonly chunkCount: number;
  readonly pending: number;
  dispose(): void;
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface LevelDef {
  id: LevelId;
  name: string;
  blurb: string;
  /** Day phase the level opens at (0 dawn .. 0.68 dusk). */
  startPhase: number;
  /** Multiplier on Config.world.dayLength (the city lingers in its evening). */
  dayScale: number;
  /** Music key and mode per day keyframe. */
  keys: DayKey[];
  /** What is painted into the sky dome beyond the world (Fuji, karst ridges). */
  backdrop: Backdrop;
  /** The level's own palettes per time of day (default: the shared DAY_SKY). */
  sky?: SkyKey[];
  /** Multiplier on the post pass's saturation (an ink-wash level mutes its colour). */
  saturation?: number;
  /** Soft ceiling, m above water (copied into Config.flight.maxAltitude on a level switch). */
  maxAltitude: number;
  create(seed: number): { world: World; spawn: Spawn };
}
