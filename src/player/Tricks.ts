import { Config } from '../core/Config';
import type { FlightEnv, FlightState } from './FlightModel';

/**
 * Tricks: authored manoeuvres layered on the glide model. Pure (no Three.js, no DOM).
 *
 * A trick never takes the bird away from the player for long and can't fail: it owns only the
 * parts of the motion it shapes (spin for a roll, the loop angle and speed for a loop, the nose
 * for a dive-bomb) while the flight model keeps integrating everything else. Sizes are set by
 * the player: holding the gesture adds rolls or lengthens a dive, and entry speed sizes a loop.
 */
export type TrickKind = 'rollL' | 'rollR' | 'loop' | 'dive';

export interface TrickState {
  kind: TrickKind | null;
  /** Seconds since the trick began. */
  t: number;
  /** Roll: spin so far (rad, unsigned). Loop: angle round the circle (rad). */
  angle: number;
  /** Roll: spin rate (rad/s). */
  rate: number;
  /** Roll: rolls committed (the hold adds more). */
  turns: number;
  /** Loop: radius (m). */
  radius: number;
  /** Loop: speed on entry (it leaves at the same speed). */
  entrySpeed: number;
  /** Dive-bomb: true once the stoop is over and the bird is pulling out. */
  pulling: boolean;
  /** Dive-bomb: seconds spent stooping (its size). */
  stoop: number;
  cooldown: number;
  /** Set only on the step a trick began. */
  started: TrickKind | null;
  /** Set only on the step a trick ended, with `size` (rolls, loop radius, stoop seconds). */
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
    radius: 0,
    entrySpeed: 0,
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

/**
 * The largest loop radius up to `r` that clears the ground all the way round (sampled on the
 * predicted circle, drift included) and fits under the ceiling. 0 if not even a small loop fits.
 */
export function fitLoop(s: FlightState, env: FlightEnv, r: number): number {
  const c = Config.tricks;
  const room = Config.world.waterLevel + Config.flight.maxAltitude - 8 - s.y;
  r = Math.min(r, room / 2);
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  for (let tries = 0; tries < 3 && r >= c.loopMin * 0.75; tries++, r *= 0.75) {
    let clear = true;
    for (let k = 1; k < 12 && clear; k++) {
      const a = (k / 12) * TAU;
      // Ahead by the circle plus the drift so far; drift time ~ arc length / speed.
      const f = r * Math.sin(a) + c.loopDrift * r * a;
      const up = r * (1 - Math.cos(a));
      if (surface(env, s.x + fx * f, s.z + fz * f) + Config.flight.clearance * 2 > s.y + up)
        clear = false;
    }
    if (clear) return r;
  }
  return 0;
}

/** Start a trick if none is running. Returns false when it can't be done here (no room). */
export function startTrick(s: FlightState, kind: TrickKind, env: FlightEnv): boolean {
  const tr = s.trick;
  const c = Config.tricks;
  if (tr.kind !== null || tr.cooldown > 0) return false;
  if (kind === 'loop') {
    const r = fitLoop(
      s,
      env,
      Math.min(c.loopMax, Math.max(c.loopMin, s.speed * c.loopRadiusPerSpeed)),
    );
    if (r === 0) return false;
    tr.radius = r;
    // Speed is scripted round the loop; entering below cruise would make a sluggish circle.
    tr.entrySpeed = Math.max(s.speed, Config.flight.cruiseSpeed * 0.9);
  } else if (kind === 'dive') {
    if (s.y - surface(env, s.x, s.z) < c.diveMinHeight) return false;
    s.speed += c.diveBoost;
    tr.pulling = false;
    tr.stoop = 0;
  } else {
    tr.turns = 1;
    tr.rate = 0;
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
  s.trickPitch = 0;
}

/**
 * Advance the running trick by dt. Called by stepFlight before it shapes pitch and speed, so
 * `trickPitch`, `spin` and the dive phase are current for this step.
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
  } else if (tr.kind === 'loop') {
    // Constant radius: the angle advances at v / r, so the path is a true circle at any speed.
    tr.angle += (s.speed / tr.radius) * dt;
    if (tr.angle >= TAU) {
      s.speed = tr.entrySpeed;
      finish(s, tr.radius);
      return;
    }
    s.trickPitch = tr.angle;
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

/** Speed round a loop: a gentle dip over the top instead of the stall real energy would give. */
export function loopSpeed(tr: TrickState): number {
  return tr.entrySpeed * (1 - Config.tricks.loopDip * 0.5 * (1 - Math.cos(tr.angle)));
}

/** Rolls either way are one trick for variety scoring. */
export const trickFamily = (kind: TrickKind): string =>
  kind === 'rollL' || kind === 'rollR' ? 'roll' : kind;

const range01 = (v: number, lo: number, hi: number): number =>
  Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

/** Score multiplier for a trick's size: committing to a bigger trick pays a little more. */
export function trickScale(kind: TrickKind, size: number): number {
  const c = Config.tricks;
  if (kind === 'loop') return 1 + 0.5 * range01(size, c.loopMin, c.loopMax);
  // Unlike the others a dive has no ceiling: the multiplier grows for as long as it is held.
  if (kind === 'dive') return 1 + c.diveScalePerSec * Math.max(0, size - c.diveMin);
  return 1 + 0.4 * (size - 1);
}

export function trickName(kind: TrickKind, size: number): string {
  const c = Config.tricks;
  if (kind === 'loop') return range01(size, c.loopMin, c.loopMax) > 0.6 ? 'Big loop' : 'Loop';
  if (kind === 'dive') return size > 1.6 ? 'Long dive-bomb' : 'Dive-bomb';
  return size >= 3 ? 'Triple roll' : size >= 2 ? 'Double roll' : 'Barrel roll';
}
