import type * as THREE from 'three';
import type { FlightInput, FlightState } from '../player/FlightModel';
import type { DayCycle, SkyKey } from '../world/DayCycle';
import type { Backdrop } from '../world/Sky';
import type { MusicStyle } from '../audio/styles';
import type { HeightField } from '../world/Terrain';
import type { WispPlanner } from '../world/Wisps';
import type { DiscoveryDef } from '../world/Discoveries';
import type { DestinationSource } from '../world/Destinations';

export type LevelId =
  | 'highlands'
  | 'city'
  | 'karst'
  | 'fjord'
  | 'jerusalem'
  | 'canyon'
  | 'peaks'
  | 'atoll'
  | 'ringmoon'
  | 'eden';

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
  /** Colour of the puff a ground skim throws up (default: dust, or leaves over canopy). */
  readonly skimColor?: THREE.Color;
  /**
   * 0..1: how far the surface at x,z is soft, something a descent glides into for a breath
   * (`FlightEnv.softAt`): cloud (its top is the ground) or deep water (its top is the water
   * level). Missing: solid ground and skimmed water everywhere.
   */
  softGround?(x: number, z: number): number;
  /**
   * The soft surface's colour in the current light: the bird's veil (it melts into cloud, is
   * tinted under water) and the cloud's plunge puffs.
   */
  readonly softColor?: THREE.Color;
  /** The bird plunged into the soft surface at x,z or burst out of it (ripples on it). */
  plunge?(x: number, z: number, strength: number): void;
  /** Each frame: where the bird is, its heading and how deep under the soft surface (0: out). */
  swim?(x: number, z: number, yaw: number, depth: number): void;
  /** Optional level-specific wisp patterns. */
  readonly planner: WispPlanner | null;
  /** The level's hidden finds (`world/<level>/finds.ts`). */
  readonly discoveries: readonly DiscoveryDef[];
  /** Where the level's journeys lead (null: none yet; see DESIGN's Destinations). */
  readonly destinations?: DestinationSource | null;
  /** A journey of this level's ended at destination `id` (a level's own celebration). */
  arrived?(id: string): void;
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

/**
 * A personal stage (made for someone: a wedding, a birthday): never listed in the players'
 * game, flown on its own build at /<id>/ (see core/channel.ts), with its own title and a
 * finale that offers the full game.
 */
export interface PersonalStage {
  /** The title screen's heading and the line under it. */
  readonly title: string;
  readonly tag: string;
  /** The browser tab's title. */
  readonly pageTitle: string;
  /** The destination whose arrival leads to the finale card, and s after it. */
  readonly finaleAt: string;
  readonly finaleAfter: number;
  /** The finale card's heading and its line. */
  readonly finaleTitle: string;
  readonly finaleText: string;
}

export interface LevelDef {
  id: LevelId;
  name: string;
  blurb: string;
  /** Day phase the level opens at (0 dawn .. 0.68 dusk). */
  startPhase: number;
  /** Multiplier on Config.world.dayLength (the city lingers in its evening). */
  dayScale: number;
  /** The level's score: keys per time of day, tempo, instruments, space. */
  music: MusicStyle;
  /** What is painted into the sky dome beyond the world (Fuji, karst ridges). */
  backdrop: Backdrop;
  /** The level's own palettes per time of day (default: the shared DAY_SKY). */
  sky?: SkyKey[];
  /**
   * Radians added to the sun's path round the sky (default 0), so a level can put its light
   * behind its signature view.
   */
  sunTurn?: number;
  /** Metres the sky's clouds float higher than usual (a level on high ground; default 0). */
  cloudLift?: number;
  /**
   * Lanterns hold a note (world/LanternNotes) shown on reaching one (default true). Eden keeps
   * its own quiet "Lantern reached".
   */
  lanternNotes?: boolean;
  /** The wisps' colour by day (default gold; they still turn moonlit after dark). */
  wispColor?: string;
  /** Multiplier on the post pass's saturation (an ink-wash level mutes its colour). */
  saturation?: number;
  /**
   * How clear the water is: 0 (default) the painted veil, 1 glass-clear so the seabed's colours
   * show through (read every frame, so a getter onto Config stays live in the debug panel).
   */
  readonly waterClarity?: number;
  /** Set on a personal stage (hidden from the players' game; see PersonalStage). */
  readonly personal?: PersonalStage;
  /** Soft ceiling, m above water (copied into Config.flight.maxAltitude on a level switch). */
  maxAltitude: number;
  create(seed: number): { world: World; spawn: Spawn };
}
