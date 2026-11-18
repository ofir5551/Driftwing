import { Config } from '../core/Config';
import type { FlightEnv, FlightState } from './FlightModel';

/**
 * Tricks: authored manoeuvres layered on the glide model. Pure (no Three.js, no DOM).
 *
 * A trick never takes the bird away from the player for long and can't fail: it owns only the
 * parts of the motion it shapes (spin for a roll, the nose for a dive-bomb) while the flight
 * model keeps integrating everything else. Sizes are set by the player: holding the gesture adds
 * rolls or lengthens a dive. (There is no loop: it was removed, so "up" has no trick.)
 */
export type TrickKind = 'rollL' | 'rollR' | 'dive';

export interface TrickState {
  kind: TrickKind | null;
  /** Seconds since the trick began. */
  t: number;
  /** Roll: spin so far (rad, unsigned). */
  angle: number;
  /** Roll: spin rate (rad/s). */
  rate: number;
  /** Roll: rolls committed (the hold adds more). */
  turns: number;
  /** Dive-bomb: true once the stoop is over and the bird is pulling out. */
  pulling: boolean;
  /** Dive-bomb: seconds spent stooping (its size). */
  stoop: number;
  cooldown: number;
  /** Set only on the step a trick began. */
  started: TrickKind | null;
  /** Set only on the step a trick ended, with `size` (rolls, stoop seconds). */
  finished: TrickKind | null;
  size: number;
}

export function createTrickState(): TrickState {
  return {
    kind: null,
    t: 0,
    angle: 0,
    rate: 0,
    turns: 0,
    pulling: false,
    stoop: 0,
    cooldown: 0,
    started: null,
    finished: null,
    size: 0,
  };
}

const TAU = Math.PI * 2;

const surface = (env: FlightEnv, x: number, z: number): number =>
  Math.max(env.groundAt(x, z), Config.world.waterLevel);

/** Start a trick if none is running. Returns false when it can't be done here (no room). */
export function startTrick(s: FlightState, kind: TrickKind, env: FlightEnv): boolean {
  const tr = s.trick;
  const c = Config.tricks;
  if (tr.kind !== null || tr.cooldown > 0) return false;
  if (kind === 'dive') {
    if (s.y - surface(env, s.x, s.z) < c.diveMinHeight) return false;
    s.speed += c.diveBoost;
    tr.pulling = false;
    tr.stoop = 0;
  } else {
    tr.turns = 1;
    tr.rate = 0;
    // The Swallow's roll is a dart: it kicks off with a burst (the Tern's adds nothing).
    s.speed += s.tune.rollBoost;
  }
  tr.kind = kind;
  tr.t = 0;
  tr.angle = 0;
  tr.started = kind;
  return true;
}

function finish(s: FlightState, size: number): void {
  const tr = s.trick;
  tr.finished = tr.kind;
  tr.size = size;
  tr.kind = null;
  tr.cooldown = Config.tricks.cooldown;
  s.spin = 0;
}

/**
 * Advance the running trick by dt. Called by stepFlight before it shapes pitch and speed, so
 * `spin` and the dive phase are current for this step.
 */
export function advanceTrick(s: FlightState, held: boolean, env: FlightEnv, dt: number): void {
  const tr = s.trick;
  const c = Config.tricks;
  tr.started = null;
  tr.finished = null;
  tr.cooldown = Math.max(0, tr.cooldown - dt);
  if (tr.kind === null) return;
  tr.t += dt;

  if (tr.kind === 'rollL' || tr.kind === 'rollR') {
    // Holding past the middle of the last roll commits another one, so a double roll never
    // stops between turns: the target moves on before the spin starts to slow.
    const target = tr.turns * TAU;
    if (held && tr.turns < c.maxRolls && target - tr.angle < Math.PI) tr.turns++;
    const remaining = tr.turns * TAU - tr.angle;
    // Accelerate to the peak rate, then brake on the stopping curve (v^2 = 2 a d), so the spin
    // eases in and settles exactly on a whole number of turns.
    const brake = Math.sqrt(2 * c.rollAccel * Math.max(0, remaining));
    tr.rate = Math.min(tr.rate + c.rollAccel * dt, c.rollRate, brake);
    tr.angle += Math.max(tr.rate, 0.5) * dt;
    if (tr.angle >= tr.turns * TAU - 1e-3) {
      finish(s, tr.turns);
      return;
    }
    s.spin = (tr.kind === 'rollR' ? 1 : -1) * tr.angle;
  } else {
    if (!tr.pulling) {
      tr.stoop += dt;
      // Pull out while there is still room to: within divePullTime s of the surface below or
      // where the stoop is heading.
      const ahead = s.speed * c.divePullTime;
      const h = Math.min(
        s.y - surface(env, s.x, s.z),
        s.y -
          surface(env, s.x + Math.sin(s.yaw) * ahead * 0.4, s.z + Math.cos(s.yaw) * ahead * 0.4),
      );
      // No time cap: the stoop runs while the gesture is held, and the terrain look-ahead above
      // is what ends it (speed is already clamped by diveExtraSpeed, so a long hold is safe).
      const wants = tr.stoop < c.diveMin || held;
      if (!wants || h < ahead * 0.9) {
        tr.pulling = true;
        tr.t = 0;
      }
    } else if (tr.t > c.pullTime) {
      finish(s, tr.stoop);
    }
  }
}

/** Rolls either way are one trick for variety scoring. */
export const trickFamily = (kind: TrickKind): string =>
  kind === 'rollL' || kind === 'rollR' ? 'roll' : kind;

/** Score multiplier for a trick's size: committing to a bigger trick pays a little more. */
export function trickScale(kind: TrickKind, size: number): number {
  const c = Config.tricks;
  // Unlike the others a dive has no ceiling: the multiplier grows for as long as it is held.
  if (kind === 'dive') return 1 + c.diveScalePerSec * Math.max(0, size - c.diveMin);
  return 1 + 0.4 * (size - 1);
}

export function trickName(kind: TrickKind, size: number): string {
  if (kind === 'dive') return size > 1.6 ? 'Long dive-bomb' : 'Dive-bomb';
  return size >= 3 ? 'Triple roll' : size >= 2 ? 'Double roll' : 'Barrel roll';
}
